import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { evaluatePdfBytes, validateFeatureMap, compareFeatureMaps, runEvaluation } from "./pdf-evaluation.mjs";
import { extractPDFFeatures } from "../../artifacts/securesphere/lib/scanning/extractors/pdfExtractor.ts";
import { lgbmPredict } from "../../artifacts/securesphere/lib/scanning/lgbmInference.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const featureNames = [
  "file_size", "metadata_size", "page_count", "title_chars", "encrypted",
  "embedded_file_count", "image_count", "object_count", "endstream_count",
  "stream_count", "xref_count", "trailer_count", "startxref_count", "objstm_count",
  "js_count", "javascript_count", "aa_count", "openaction_count", "acroform_count",
  "jbig2decode_count", "richmedia_count", "launch_count", "xfa_count", "colors_count",
];
const features = Object.fromEntries(featureNames.map((name, i) => [name, i]));
const model = {
  model_name: "synthetic-test-model",
  num_features: 24,
  feature_names: featureNames,
  num_trees: 1,
  trees: [{
    shrinkage: 1,
    root: {
      split_feature: 0,
      threshold: 0,
      decision_type: "<=",
      default_left: true,
      missing_type: "None",
      left: { leaf_value: -1 },
      right: { leaf_value: 1 },
    },
  }],
};

test("synthetic PDF bytes pass extraction and fixed-vector inference is deterministic", () => {
  const bytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF");
  const first = evaluatePdfBytes(bytes, model, () => ({ ...features }));
  const second = evaluatePdfBytes(bytes, model, () => ({ ...features }));
  assert.equal(first.status, "evaluated");
  assert.deepEqual(first, second);
  assert.ok(first.probability > 0 && first.probability < 1);
  const appFeatures = extractPDFFeatures(bytes, bytes.byteLength);
  assert.equal(appFeatures.page_count, 1);
  assert.equal(appFeatures.file_size, bytes.byteLength);
});

test("non-PDF and synthetic extractor failures stay explicit without fabricated features", () => {
  assert.deepEqual(evaluatePdfBytes(new TextEncoder().encode("not a PDF"), model), {
    status: "unsupported",
    verdict: "UNSUPPORTED",
    reason: "PDF_HEADER_NOT_RECOGNIZED",
  });
  assert.deepEqual(evaluatePdfBytes(new Uint8Array(), model), {
    status: "corrupted",
    verdict: "CORRUPTED",
    reason: "EMPTY_FILE",
  });
  const extractionFailure = evaluatePdfBytes(new TextEncoder().encode("%PDF-1.4\n"), model, () => {
    throw new Error("synthetic parse failure");
  });
  assert.deepEqual(extractionFailure, { status: "processing_error", verdict: "ERROR", reason: "EXTRACTION_FAILED" });
});

test("feature names, order, missing values, and non-finite values are rejected", () => {
  const reversed = Object.fromEntries(Object.entries(features).reverse());
  assert.throws(() => validateFeatureMap(reversed, featureNames), /FEATURE_NAME_OR_ORDER_MISMATCH/);
  assert.throws(() => validateFeatureMap({ ...features, [featureNames[0]]: Number.NaN }, featureNames), /INVALID_FEATURE_VALUE/);
  const missing = { ...features };
  delete missing[featureNames[2]];
  assert.throws(() => validateFeatureMap(missing, featureNames), /FEATURE_NAME_OR_ORDER_MISMATCH/);
});

test("reference comparison reports exact per-feature absolute differences", () => {
  const reference = { ...features, [featureNames[3]]: 10 };
  assert.deepEqual(compareFeatureMaps(features, reference, featureNames), [
    { feature: "title_chars", app: 3, reference: 10, absoluteDifference: 7 },
  ]);
});

test("bundled model schema is 24 features and fixed-vector inference is repeatable", async () => {
  const modelPath = path.join(ROOT, "artifacts/securesphere/assets/models/pdf.json");
  const bundled = JSON.parse(await readFile(modelPath, "utf8"));
  assert.equal(bundled.num_features, 24);
  assert.deepEqual(bundled.feature_names, featureNames);
  const vector = bundled.feature_names.map(() => 0);
  assert.equal(lgbmPredict(bundled, vector), lgbmPredict(bundled, vector));
  const bytes = new TextEncoder().encode("%PDF-1.4\n%%EOF");
  const first = evaluatePdfBytes(bytes, bundled);
  const second = evaluatePdfBytes(bytes, bundled);
  assert.deepEqual(first, second);
  assert.equal(first.status, "evaluated");
});

test("extractor values are validated against model keys rather than zero-filled", () => {
  const bytes = new TextEncoder().encode("%PDF-1.4\n");
  const result = evaluatePdfBytes(bytes, model, () => ({ ...features, [featureNames[1]]: undefined }));
  assert.equal(result.status, "processing_error");
  assert.equal(result.verdict, "ERROR");
  assert.equal(result.reason, "INVALID_FEATURE_VALUE");
  assert.equal(extractPDFFeatures(bytes, bytes.byteLength).file_size, bytes.byteLength);
});

test("inference exceptions remain distinct from extraction failures", () => {
  const bytes = new TextEncoder().encode("%PDF-1.4\n");
  const brokenModel = { ...model, trees: [undefined] };
  assert.deepEqual(evaluatePdfBytes(bytes, brokenModel, () => ({ ...features })), {
    status: "processing_error",
    verdict: "ERROR",
    reason: "INFERENCE_FAILED",
  });
});

test("evaluation anonymizes recursive results and calculates metrics only for eligible labels", async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), "securesphere-pdf-eval-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const inputDir = path.join(temp, "private-source-folder");
  const outputDir = path.join(temp, "results");
  const nestedDir = path.join(inputDir, "nested");
  await mkdir(nestedDir, { recursive: true });
  const safeBytes = Buffer.from("%PDF-1.4\nsmall fixture\n%%EOF");
  const maliciousBytes = Buffer.from(`%PDF-1.4\n${"x".repeat(80)}\n%%EOF`);
  const unsupportedBytes = Buffer.from("not a pdf");
  const emptyBytes = Buffer.alloc(0);
  await writeFile(path.join(inputDir, "confidential-name.pdf"), safeBytes);
  await writeFile(path.join(nestedDir, "malicious-label.pdf"), maliciousBytes);
  await writeFile(path.join(inputDir, "unsupported.pdf"), unsupportedBytes);
  await writeFile(path.join(nestedDir, "empty.pdf"), emptyBytes);
  await writeFile(path.join(inputDir, "duplicate.pdf"), safeBytes);
  const testModel = structuredClone(model);
  testModel.trees[0].root.threshold = 40;
  const modelPath = path.join(temp, "synthetic-model.json");
  await writeFile(modelPath, JSON.stringify(testModel));
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const labelsPath = path.join(temp, "private-label-manifest.json");
  await writeFile(labelsPath, JSON.stringify({
    [digest(safeBytes)]: "BENIGN",
    [digest(maliciousBytes)]: "MALICIOUS",
    [digest(unsupportedBytes)]: "BENIGN",
    [digest(emptyBytes)]: "MALICIOUS",
  }));
  const result = await runEvaluation({ inputDir, outputDir, modelPath, labelsJson: labelsPath });
  assert.equal(result.uniquePdfCount, 4);
  assert.deepEqual(result.summary.counts, { SAFE: 1, MALICIOUS: 1, UNSUPPORTED: 1, CORRUPTED: 1, PROCESSING_ERROR: 0 });
  assert.deepEqual(result.summary.labeled, {
    eligibleCount: 2,
    falsePositives: 0,
    falsePositiveRate: 0,
    benignDenominator: 1,
    falseNegatives: 0,
    falseNegativeRate: 0,
    maliciousDenominator: 1,
    excludedCount: 2,
  });
  const json = await readFile(path.join(outputDir, "pdf-evaluation.json"), "utf8");
  const csv = await readFile(path.join(outputDir, "pdf-evaluation.csv"), "utf8");
  const report = await readFile(path.join(outputDir, "pdf-evaluation-report.md"), "utf8");
  const outputs = `${json}\n${csv}\n${report}`;
  const parsed = JSON.parse(json);
  assert.deepEqual(parsed.summary, result.summary);
  assert.ok(parsed.rows.every((row) => /^PDF-\d{6}$/.test(row.caseId)));
  assert.match(csv, /caseId,status,verdict,probability,reason,independentLabel/);
  assert.doesNotMatch(outputs, /confidential-name|private-source-folder|malicious-label|unsupported\.pdf|empty\.pdf|[a-f0-9]{64}|file_size/);
  assert.match(report, /false positives: 0\/1/);
  assert.match(report, /UNSUPPORTED here means the evaluator's PDF header guard/);
  assert.match(report, /never counted as SAFE/);
});

test("evaluation refuses to overwrite existing reports", async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), "securesphere-pdf-eval-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const inputDir = path.join(temp, "input");
  const outputDir = path.join(temp, "output");
  await mkdir(inputDir);
  await mkdir(outputDir);
  await writeFile(path.join(inputDir, "one.pdf"), "%PDF-1.4\n%%EOF");
  const protectedFile = path.join(outputDir, "pdf-evaluation.json");
  await writeFile(protectedFile, "preserve this report");
  await assert.rejects(runEvaluation({ inputDir, outputDir }), /OUTPUT_EXISTS/);
  assert.equal(await readFile(protectedFile, "utf8"), "preserve this report");
});
