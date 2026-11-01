import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractPDFFeatures } from "../../artifacts/securesphere/lib/scanning/extractors/pdfExtractor.ts";
import { buildFeatureVector, lgbmPredict } from "../../artifacts/securesphere/lib/scanning/lgbmInference.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MODEL = path.join(ROOT, "artifacts/securesphere/assets/models/pdf.json");

export function validateModelSchema(model) {
  if (!Number.isInteger(model?.num_features) || model.num_features < 1 ||
      !Array.isArray(model.feature_names) || model.feature_names.length !== model.num_features ||
      new Set(model.feature_names).size !== model.feature_names.length) {
    throw new Error("INVALID_MODEL_SCHEMA");
  }
}

export function validateFeatureMap(features, featureNames) {
  if (!features || Object.keys(features).length !== featureNames.length ||
      Object.keys(features).some((name, i) => name !== featureNames[i])) {
    throw new Error("FEATURE_NAME_OR_ORDER_MISMATCH");
  }
  for (const name of featureNames) {
    if (typeof features[name] !== "number" || !Number.isFinite(features[name])) {
      throw new Error("INVALID_FEATURE_VALUE");
    }
  }
}

export function evaluatePdfBytes(bytes, model, extractor = extractPDFFeatures) {
  validateModelSchema(model);
  if (!(bytes instanceof Uint8Array)) {
    return { status: "processing_error", verdict: "ERROR", reason: "INVALID_INPUT" };
  }
  if (bytes.byteLength === 0) {
    return { status: "corrupted", verdict: "CORRUPTED", reason: "EMPTY_FILE" };
  }
  if (bytes.byteLength < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
    // This is the evaluator's signature guard, not a verdict emitted by the app scanner.
    return { status: "unsupported", verdict: "UNSUPPORTED", reason: "PDF_HEADER_NOT_RECOGNIZED" };
  }
  let features;
  try {
    features = extractor(bytes, bytes.byteLength);
    validateFeatureMap(features, model.feature_names);
  } catch (error) {
    return {
      status: "processing_error",
      verdict: "ERROR",
      reason: error instanceof Error && error.message === "INVALID_FEATURE_VALUE"
        ? "INVALID_FEATURE_VALUE"
        : error instanceof Error && error.message === "FEATURE_NAME_OR_ORDER_MISMATCH"
          ? "FEATURE_NAME_OR_ORDER_MISMATCH"
          : "EXTRACTION_FAILED",
    };
  }
  try {
    const vector = buildFeatureVector(model, features);
    if (vector.length !== model.num_features || vector.some((value) => !Number.isFinite(value))) {
      return { status: "processing_error", verdict: "ERROR", reason: "INVALID_FEATURE_VECTOR" };
    }
    const probability = lgbmPredict(model, vector);
    if (!Number.isFinite(probability)) return { status: "processing_error", verdict: "ERROR", reason: "NON_FINITE_PROBABILITY" };
    return {
      status: "evaluated",
      verdict: probability >= 0.5 ? "MALICIOUS" : "SAFE",
      features,
      probability,
      prediction: probability >= 0.5 ? "MALICIOUS" : "SAFE",
    };
  } catch {
    return { status: "processing_error", verdict: "ERROR", reason: "INFERENCE_FAILED" };
  }
}

export function compareFeatureMaps(appFeatures, referenceFeatures, featureNames) {
  validateFeatureMap(appFeatures, featureNames);
  validateFeatureMap(referenceFeatures, featureNames);
  return featureNames.flatMap((name) => {
    const difference = Math.abs(appFeatures[name] - referenceFeatures[name]);
    return difference === 0 ? [] : [{ feature: name, app: appFeatures[name], reference: referenceFeatures[name], absoluteDifference: difference }];
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function collectPdfs(directory) {
  const result = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) result.push(absolute);
    }
  }
  await walk(directory);
  return result.sort((a, b) => a.localeCompare(b));
}

function validateLabelManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("INVALID_LABEL_MANIFEST");
  }
  for (const [digest, label] of Object.entries(manifest)) {
    if (!/^[a-f0-9]{64}$/i.test(digest) || !["BENIGN", "MALICIOUS", "UNCERTAIN"].includes(label)) {
      throw new Error("INVALID_LABEL_MANIFEST");
    }
  }
}

function summarizeRows(rows) {
  const counts = { SAFE: 0, MALICIOUS: 0, UNSUPPORTED: 0, CORRUPTED: 0, PROCESSING_ERROR: 0 };
  for (const row of rows) {
    if (row.verdict === "SAFE" || row.verdict === "MALICIOUS" || row.verdict === "UNSUPPORTED" || row.verdict === "CORRUPTED") {
      counts[row.verdict]++;
    } else {
      counts.PROCESSING_ERROR++;
    }
  }
  const eligible = rows.filter((row) =>
    (row.independentLabel === "BENIGN" || row.independentLabel === "MALICIOUS") &&
    (row.verdict === "SAFE" || row.verdict === "MALICIOUS"),
  );
  const benign = eligible.filter((row) => row.independentLabel === "BENIGN");
  const malicious = eligible.filter((row) => row.independentLabel === "MALICIOUS");
  const falsePositives = benign.filter((row) => row.verdict === "MALICIOUS").length;
  const falseNegatives = malicious.filter((row) => row.verdict === "SAFE").length;
  return {
    counts,
    labeled: {
      eligibleCount: eligible.length,
      falsePositives,
      falsePositiveRate: benign.length ? falsePositives / benign.length : null,
      benignDenominator: benign.length,
      falseNegatives,
      falseNegativeRate: malicious.length ? falseNegatives / malicious.length : null,
      maliciousDenominator: malicious.length,
      excludedCount: rows.length - eligible.length,
    },
  };
}

function formatRate(value) {
  return value === null ? "not available (no eligible labeled samples)" : `${(value * 100).toFixed(2)}%`;
}

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!["--input-dir", "--output-dir", "--reference-json", "--labels-json", "--model"].includes(key) || !args[i + 1]) {
      throw new Error("USAGE: --input-dir DIR --output-dir DIR [--labels-json FILE] [--reference-json FILE] [--model FILE]");
    }
    result[key.slice(2)] = args[++i];
  }
  if (!result["input-dir"] || !result["output-dir"]) {
    throw new Error("USAGE: --input-dir DIR --output-dir DIR [--labels-json FILE] [--reference-json FILE] [--model FILE]");
  }
  return result;
}

export async function runEvaluation({ inputDir, outputDir, referenceJson, labelsJson, modelPath = DEFAULT_MODEL }) {
  const model = JSON.parse(await readFile(modelPath, "utf8"));
  validateModelSchema(model);
  if (model.num_features !== 24) throw new Error("EXPECTED_24_MODEL_FEATURES");
  const pdfPaths = await collectPdfs(inputDir);
  const reference = referenceJson ? JSON.parse(await readFile(referenceJson, "utf8")) : null;
  if (referenceJson && (!reference || typeof reference !== "object" || Array.isArray(reference))) {
    throw new Error("INVALID_REFERENCE_MANIFEST");
  }
  const labels = labelsJson ? JSON.parse(await readFile(labelsJson, "utf8")) : null;
  if (labelsJson) validateLabelManifest(labels);
  const seen = new Set();
  const rows = [];
  let nextCase = 1;
  for (const pdfPath of pdfPaths) {
    let bytes;
    let digest;
    try {
      bytes = await readFile(pdfPath);
      digest = createHash("sha256").update(bytes).digest("hex");
    } catch {
      rows.push({ caseId: `PDF-${String(nextCase++).padStart(6, "0")}`, status: "processing_error", verdict: "ERROR", reason: "FILE_READ_FAILED" });
      continue;
    }
    if (seen.has(digest)) continue;
    seen.add(digest);
    const evaluated = evaluatePdfBytes(bytes, model);
    bytes.fill(0);
    const row = {
      caseId: `PDF-${String(nextCase++).padStart(6, "0")}`,
      ...evaluated,
      ...(labels?.[digest] ? { independentLabel: labels[digest] } : {}),
    };
    if (evaluated.status === "evaluated" && reference && reference[digest]) {
      try {
        row.referenceDifferenceCount = compareFeatureMaps(evaluated.features, reference[digest], model.feature_names).length;
      } catch {
        row.referenceDifferenceError = true;
      }
    }
    rows.push(row);
  }
  await mkdir(outputDir, { recursive: true });
  const summary = summarizeRows(rows);
  const referenceDifferenceCount = rows.reduce((sum, row) => sum + (row.referenceDifferenceCount || 0), 0);
  const referenceErrorCount = rows.filter((row) => row.referenceDifferenceError).length;
  const outputFiles = ["pdf-evaluation.json", "pdf-evaluation.csv", "pdf-evaluation-report.md"];
  for (const filename of outputFiles) {
    try {
      await access(path.join(outputDir, filename));
      throw new Error("OUTPUT_EXISTS");
    } catch (error) {
      if (error instanceof Error && error.message === "OUTPUT_EXISTS") throw error;
    }
  }
  const publicRows = rows.map(({ features: _features, referenceDifferenceCount: _diffs, referenceDifferenceError: _refError, ...row }) => row);
  const json = JSON.stringify({
    model: model.model_name,
    threshold: 0.5,
    uniquePdfCount: seen.size,
    processedCaseCount: rows.length,
    summary,
    referenceComparison: referenceJson ? { differingFeatureValues: referenceDifferenceCount, invalidManifests: referenceErrorCount } : null,
    rows: publicRows,
  }, null, 2);
  const columns = ["caseId", "status", "verdict", "probability", "reason", "independentLabel"];
  const csv = [columns.map(csvCell).join(","), ...publicRows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
  const report = [
    "# Local PDF model evaluation",
    "",
    `- Bundled model: ${model.model_name}; features: ${model.num_features}; tree count: ${model.num_trees}.`,
    "- Decision threshold: 0.5 (unchanged production threshold).",
    `- Cases processed: ${rows.length}; SAFE: ${summary.counts.SAFE}; MALICIOUS: ${summary.counts.MALICIOUS}; UNSUPPORTED: ${summary.counts.UNSUPPORTED}; CORRUPTED: ${summary.counts.CORRUPTED}; processing errors: ${summary.counts.PROCESSING_ERROR}.`,
    `- Labeled eligible samples: ${summary.labeled.eligibleCount}; false positives: ${summary.labeled.falsePositives}/${summary.labeled.benignDenominator} (${formatRate(summary.labeled.falsePositiveRate)}); false negatives: ${summary.labeled.falseNegatives}/${summary.labeled.maliciousDenominator} (${formatRate(summary.labeled.falseNegativeRate)}).`,
    `- Labeled samples excluded from FP/FN metrics (uncertain, unsupported, corrupted, or error): ${summary.labeled.excludedCount}.`,
    `- Reference comparison: ${referenceDifferenceCount} differing feature values; ${referenceErrorCount} invalid per-file reference entries.`,
    "- Labels are supplied by the caller; this tool does not validate their independence or correctness.",
    "- UNSUPPORTED here means the evaluator's PDF header guard rejected the input; it is not a production scanner verdict.",
    "- This offline harness runs PDF feature extraction and model inference only. It does not exercise picker, native app routing, API, or upload behavior.",
    "- File paths, names, hashes, document contents, and extracted feature vectors are omitted. Case IDs are assigned in sorted input-path order.",
    "- Processing errors, unsupported inputs, and corrupted inputs are never counted as SAFE.",
  ].join("\n");
  const contents = [json, `${csv}\n`, report];
  for (let i = 0; i < outputFiles.length; i++) {
    await writeFile(path.join(outputDir, outputFiles[i]), contents[i], { flag: "wx" });
  }
  return { uniquePdfCount: seen.size, processedCaseCount: rows.length, rows: publicRows, summary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await runEvaluation({
      inputDir: path.resolve(args["input-dir"]),
      outputDir: path.resolve(args["output-dir"]),
      referenceJson: args["reference-json"] ? path.resolve(args["reference-json"]) : undefined,
      labelsJson: args["labels-json"] ? path.resolve(args["labels-json"]) : undefined,
      modelPath: args.model ? path.resolve(args.model) : DEFAULT_MODEL,
    });
    console.log(`Evaluated ${result.rows.length} unique PDF(s). See local output directory.`);
  } catch (error) {
    const safeMessage = error instanceof Error && error.message.startsWith("USAGE:")
      ? "USAGE: --input-dir DIR --output-dir DIR [--labels-json FILE] [--reference-json FILE] [--model FILE]"
      : "PDF_EVALUATION_FAILED";
    console.error(safeMessage);
    process.exitCode = 1;
  }
}
