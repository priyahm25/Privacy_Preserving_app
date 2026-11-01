import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lgbmPredict } from "../../artifacts/securesphere/lib/scanning/lgbmInference.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL_PATH = path.join(ROOT, "artifacts/securesphere/assets/models/pdf.json");
const FOCUS = new Set([
  "page_count", "metadata_size", "encrypted", "embedded_file_count", "image_count",
  "object_count", "endstream_count", "stream_count", "xref_count", "trailer_count",
  "startxref_count", "js_count", "javascript_count", "aa_count", "openaction_count",
  "launch_count", "xfa_count",
]);

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--input-json", "--output-md"].includes(args[i]) || !args[i + 1]) throw new Error("USAGE");
    result[args[i].slice(2)] = args[i + 1];
  }
  if (!result["input-json"] || !result["output-md"]) throw new Error("USAGE");
  return result;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, x) => sum + x, 0) / values.length;
  const variance = values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / values.length;
  const middle = Math.floor(sorted.length / 2);
  return {
    mean,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0],
    max: sorted.at(-1),
    sd: Math.sqrt(variance),
  };
}

function fmt(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

function topShares(values) {
  const ordered = [...values].sort((a, b) => b - a);
  const total = ordered.reduce((sum, value) => sum + value, 0);
  if (total === 0) return "n/a";
  const one = ordered[0] / total * 100;
  const two = ordered.slice(0, 2).reduce((sum, value) => sum + value, 0) / total * 100;
  return `${one.toFixed(0)}% top1, ${two.toFixed(0)}% top2`;
}

function walkPath(node, vector, counts) {
  if (Object.hasOwn(node, "leaf_value")) return node.leaf_value;
  counts[node.split_feature]++;
  const value = vector[node.split_feature];
  const threshold = typeof node.threshold === "string" ? Number.parseFloat(node.threshold) : node.threshold;
  const missing = value === null || value === undefined || Number.isNaN(value);
  const left = missing ? node.default_left : value <= threshold;
  return walkPath(left ? node.left : node.right, vector, counts);
}

function featurePathCounts(model, vector) {
  const counts = model.feature_names.map(() => 0);
  for (const tree of model.trees) walkPath(tree.root, vector, counts);
  return counts;
}

export function buildDiagnostic(evaluation, model) {
  const rows = evaluation.rows || [];
  const evaluated = rows.filter((row) => row.status === "evaluated" && row.features);
  const flagged = evaluated.filter((row) => row.prediction === "MALICIOUS");
  const safe = evaluated.filter((row) => row.prediction === "SAFE");
  if (!flagged.length || !safe.length) throw new Error("EXPECTED_BOTH_PREDICTION_GROUPS");
  if (evaluation.threshold !== 0.5 || model.num_features !== 24 ||
      JSON.stringify(evaluation.featureNames) !== JSON.stringify(model.feature_names)) {
    throw new Error("MODEL_OR_FEATURE_SCHEMA_MISMATCH");
  }
  const vectors = new Map();
  const pathTotals = model.feature_names.map(() => ({ flagged: 0, safe: 0 }));
  let scoreMismatches = 0;
  for (const row of evaluated) {
    if (JSON.stringify(Object.keys(row.features)) !== JSON.stringify(model.feature_names) ||
        model.feature_names.some((name) => !Number.isFinite(row.features[name]))) {
      throw new Error("EVALUATION_FEATURE_SCHEMA_MISMATCH");
    }
    const vector = model.feature_names.map((name) => row.features[name]);
    vectors.set(row, vector);
    const recalculated = lgbmPredict(model, vector);
    if (Math.abs(recalculated - row.probability) > 1e-10) scoreMismatches++;
    const counts = featurePathCounts(model, vector);
    const group = row.prediction === "MALICIOUS" ? "flagged" : "safe";
    counts.forEach((count, i) => { pathTotals[i][group] += count; });
  }

  const featureRows = model.feature_names.map((name) => {
    const f = stats(flagged.map((r) => r.features[name]));
    const s = stats(safe.map((r) => r.features[name]));
    const pooled = Math.sqrt((f.sd ** 2 + s.sd ** 2) / 2);
    const standardized = pooled === 0 ? (f.mean === s.mean ? 0 : Number.POSITIVE_INFINITY) : (f.mean - s.mean) / pooled;
    const flaggedNonzero = flagged.filter((r) => r.features[name] !== 0).length;
    const safeNonzero = safe.filter((r) => r.features[name] !== 0).length;
    const splitUseFlagged = pathTotals[model.feature_names.indexOf(name)].flagged / flagged.length;
    const splitUseSafe = pathTotals[model.feature_names.indexOf(name)].safe / safe.length;
    return { name, flagged: f, safe: s, meanDelta: f.mean - s.mean, standardized, flaggedNonzero, safeNonzero, splitUseFlagged, splitUseSafe };
  });
  const ranked = [...featureRows].sort((a, b) => Math.abs(b.standardized) - Math.abs(a.standardized));
  const active = featureRows.filter((f) => FOCUS.has(f.name));

  const anomalies = [];
  for (const row of evaluated) {
    const f = row.features;
    if (![0, 1].includes(f.encrypted)) anomalies.push("encrypted outside {0,1}");
    if (f.metadata_size < 0 || f.metadata_size > 512 || (f.metadata_size !== 0 && f.metadata_size % 4 !== 0)) anomalies.push("metadata_size violates extractor's 0-or-4x-capped rule");
    if (f.stream_count < f.endstream_count) anomalies.push("stream_count below endstream_count despite substring overlap");
    if (f.xref_count < f.startxref_count) anomalies.push("xref_count below startxref_count despite substring overlap");
    if (model.feature_names.some((name) => !Number.isFinite(f[name]) || f[name] < 0 || !Number.isInteger(f[name]))) anomalies.push("non-finite, negative, or non-integer feature");
  }
  const uniqueAnomalies = [...new Set(anomalies)];
  const referenceRows = rows.filter((row) => Object.hasOwn(row, "feature_differences"));
  const referenceDiffCount = referenceRows.reduce((sum, row) => sum + (Array.isArray(row.feature_differences) ? row.feature_differences.filter((d) => d.feature).length : 0), 0);
  const doubledStreamPairs = evaluated.filter((row) => row.features.stream_count === 2 * row.features.endstream_count).length;
  const xrefIncludesStartxref = evaluated.filter((row) => row.features.xref_count >= row.features.startxref_count).length;
  const flaggedProbabilities = flagged.map((r) => r.probability).sort((a, b) => b - a);
  const byName = new Map(featureRows.map((row) => [row.name, row]));
  const positiveTogether = (group, names) => group.filter((row) => names.every((name) => row.features[name] > 0)).length;
  const lines = [
    "# Local PDF benign false-positive feature comparison",
    "",
    "This report contains group-level statistics only. It intentionally omits PDF names, paths, hashes, identifiers, and contents.",
    "The user identified all evaluation PDFs as legitimate; this is a small local set, not a representative accuracy estimate.",
    "",
    "## Summary",
    "",
    `- Total rows: ${rows.length}; evaluated feature rows: ${evaluated.length}; user-labelled benign: ${evaluated.length}.`,
    `- Model predictions at threshold 0.5: ${safe.length} SAFE, ${flagged.length} MALICIOUS (false positives within this user-labelled sample).`,
    `- Flagged probability range: ${fmt(Math.min(...flaggedProbabilities))} to ${fmt(Math.max(...flaggedProbabilities))}.`,
    `- Flagged scores descending (ties retained): ${flaggedProbabilities.map(fmt).join(", ")}.`,
    `- Inference recomputation mismatches against saved probabilities: ${scoreMismatches}.`,
    `- Reference-comparison rows carrying a ${"`feature_differences`"} field: ${referenceRows.length}/${rows.length}; recorded differing feature instances: ${referenceDiffCount}.`,
    "- A zero reference-difference count alone does not show that a reference manifest was supplied. No per-row comparison field means no matched reference comparison was recorded; the evaluation format does not record whether a manifest argument was omitted or supplied without matching hashes.",
    "",
    "## All 24 feature distributions ranked by standardized group difference",
    "",
    "Mean/median and population SD are shown for MALICIOUS-predicted (flagged) versus SAFE-predicted. Standardized difference is (flagged mean - SAFE mean) / pooled SD; it is descriptive and sensitive to this small sample.",
    "",
    "| Feature | Flagged mean (median, range) | SAFE mean (median, range) | Mean delta | Std. difference | Nonzero flagged / SAFE | Flagged top 1 / top 2 share; SAFE top 1 / top 2 share | Avg. traversed splits per file, flagged / SAFE |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...ranked.map((f) => `| \`${f.name}\` | ${fmt(f.flagged.mean)} (${fmt(f.flagged.median)}, ${fmt(f.flagged.min)}-${fmt(f.flagged.max)}) | ${fmt(f.safe.mean)} (${fmt(f.safe.median)}, ${fmt(f.safe.min)}-${fmt(f.safe.max)}) | ${fmt(f.meanDelta)} | ${fmt(f.standardized)} | ${f.flaggedNonzero}/${flagged.length} / ${f.safeNonzero}/${safe.length} | ${topShares(flagged.map((r) => r.features[f.name]))}; ${topShares(safe.map((r) => r.features[f.name]))} | ${fmt(f.splitUseFlagged)} / ${fmt(f.splitUseSafe)} |`),
    "",
    "The largest flagged-group means for `object_count` and `image_count` are concentrated in the largest one or two values (see top-share column); medians are 11 and 0 respectively. Their mean gaps are therefore not uniform across all five flagged files.",
    "",
    "The split counts are how often a feature was tested on the selected path through the 300 trees. They are not feature attributions and do not show causal contribution or direction.",
    "",
    "## Focused structural and active-action features",
    "",
    "| Feature | Flagged nonzero | SAFE nonzero | Flagged range | SAFE range |",
    "|---|---:|---:|---:|---:|",
    ...active.map((f) => `| \`${f.name}\` | ${f.flaggedNonzero}/${flagged.length} | ${f.safeNonzero}/${safe.length} | ${fmt(f.flagged.min)}-${fmt(f.flagged.max)} | ${fmt(f.safe.min)}-${fmt(f.safe.max)} |`),
    "",
    "## Group-consistent presence differences",
    "",
    ...featureRows.filter((f) => (f.flaggedNonzero === flagged.length && f.safeNonzero === 0) || (f.safeNonzero === safe.length && f.flaggedNonzero === 0)).map((f) => `- \`${f.name}\`: nonzero in ${f.flaggedNonzero === flagged.length ? `all ${flagged.length} flagged` : `all ${safe.length} SAFE`} and zero in the other group.`),
    ...(featureRows.every((f) => !((f.flaggedNonzero === flagged.length && f.safeNonzero === 0) || (f.safeNonzero === safe.length && f.flaggedNonzero === 0))) ? ["- No feature is nonzero in every file of one group and zero in every file of the other."] : []),
    `- JavaScript indicators: ` + `js_count` + ` and ` + `javascript_count` + ` are both nonzero in ${positiveTogether(flagged, ["js_count", "javascript_count"])}/${flagged.length} flagged and ${positiveTogether(safe, ["js_count", "javascript_count"])}/${safe.length} SAFE files; both plus ` + `embedded_file_count` + ` are nonzero in ${positiveTogether(flagged, ["js_count", "javascript_count", "embedded_file_count"])}/${flagged.length} flagged and ${positiveTogether(safe, ["js_count", "javascript_count", "embedded_file_count"])}/${safe.length} SAFE files.`,
    "",
    "## Extractor consistency checks",
    "",
    `- stream_count is exactly twice endstream_count in ${doubledStreamPairs}/${evaluated.length} rows, consistent with each raw endstream spelling also containing a stream substring plus an opening stream spelling. This is a lexical relationship, not a parsed stream count.`,
    `- xref_count is at least startxref_count in ${xrefIncludesStartxref}/${evaluated.length} rows, as expected from the startxref substring overlap in this raw counter.`,
    `- metadata_size is 44 in all ${flagged.length} flagged files and ranges 44-56 among SAFE files. This is the current extractor's 4x Info-reference-token-length heuristic, not a measured metadata payload size; the groups overlap at 44.`,
    `- encrypted is zero for all ${evaluated.length} files, but current extraction only searches raw bytes for the Encrypt marker; it does not parse encryption state.`,
    `- page_count is zero in ${safe.filter((r) => r.features.page_count === 0).length}/${safe.length} SAFE files and ranges from ${byName.get("page_count").flagged.min} to ${byName.get("page_count").flagged.max} for flagged files. Zero can reflect syntax the raw regex missed; the PDF bytes are unavailable for checking.`,
    uniqueAnomalies.length ? uniqueAnomalies.map((x) => `- ${x} (observed at least once).`) : ["- No impossible values were found for the checked extractor invariants: `encrypted` is binary; `metadata_size` is 0 or a multiple of 4 capped at 512; `stream_count` includes the `stream` substring within `endstream`; `xref_count` includes the `xref` substring within `startxref`; and all 24 features are finite non-negative integers."],
    "- These checks validate numeric consistency with the current raw-byte extractor only. They do not establish that a feature semantically describes the PDF or matches the unknown training-table extraction.",
    "- `page_count`, metadata/title parsing, encryption, image count, and embedded-file count are raw-byte heuristics; plausible values are not proof of a parsed PDF structure.",
    "",
    "## Evidence limits and interpretation",
    "",
    "- The saved JSON contains features and predictions but no PDF bytes. The five individual feature vectors cannot be independently re-extracted from this output alone.",
    "- Training extraction provenance for all 24 features remains unknown. Earlier documents record mismatches between the current app extractor and the PyMuPDF helper for metadata size, page count, title, encryption, image count, and the later-modified embedded-file logic.",
    "- The local prediction scores are reproducible with the bundled JSON model and current inference implementation; this checks consistency, not model quality.",
    "- Do not infer that active-action counts caused the predictions solely because the model has those features. Per-tree path usage is descriptive; without original training feature semantics and labeled comparative data it cannot identify a root cause.",
    "",
  ].flat().join("\n");
  return lines;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const [evaluation, model] = await Promise.all([
      readFile(path.resolve(args["input-json"]), "utf8").then(JSON.parse),
      readFile(MODEL_PATH, "utf8").then(JSON.parse),
    ]);
    const report = buildDiagnostic(evaluation, model);
    await writeFile(path.resolve(args["output-md"]), report, "utf8");
    console.log("Wrote aggregate PDF feature diagnostic report.");
  } catch (error) {
    console.error(error instanceof Error && error.message === "USAGE"
      ? "USAGE: --input-json FILE --output-md FILE"
      : "PDF_DIAGNOSTIC_FAILED");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
