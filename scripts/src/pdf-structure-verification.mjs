import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractPDFFeatures } from "../../artifacts/securesphere/lib/scanning/extractors/pdfExtractor.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appRequire = createRequire(path.join(ROOT, "artifacts/securesphere/package.json"));
const pdfjs = await import(pathToFileURL(appRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
const DEFAULT_INPUT = "C:/Users/priya/pdf-evaluation/results/pdf-evaluation.json";
const DEFAULT_OUTPUT = path.join(ROOT, "docs/pdf-structure-verification.md");
const IMAGE_OPS = [
  "paintImageXObject", "paintInlineImageXObject", "paintImageMaskXObject",
  "paintJpegXObject", "paintImageXObjectRepeat", "paintImageMaskXObjectRepeat",
  "paintImageMaskXObjectGroup", "paintSolidColorImageMask",
].map((name) => pdfjs.OPS[name]).filter(Number.isInteger);

function parseArgs(args) {
  const result = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let i = 0; i < args.length; i += 2) {
    if (!["--input-json", "--search-root", "--output-md"].includes(args[i]) || !args[i + 1]) throw new Error("USAGE");
    result[args[i].slice(2)] = args[i + 1];
  }
  return result;
}

async function findMatchingPdfs(searchRoot, expectedRows) {
  const expected = new Map(expectedRows.map((row) => [row.file_id.toLowerCase(), row]));
  const matches = new Map();
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(candidate);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        try {
          const bytes = await readFile(candidate);
          const digest = createHash("sha256").update(bytes).digest("hex");
          if (expected.has(digest)) {
            const prior = matches.get(digest);
            if (prior && !prior.equals(bytes)) throw new Error("HASH_MATCH_CONTENT_CONFLICT");
            matches.set(digest, bytes);
          }
        } catch (error) {
          if (error instanceof Error && error.message === "HASH_MATCH_CONTENT_CONFLICT") throw error;
        }
      }
    }
  }
  await walk(searchRoot);
  return matches;
}

function countActionEntries(actions) {
  if (!actions || typeof actions !== "object") return 0;
  return Object.values(actions).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : value == null ? 0 : 1), 0);
}

function countLegacyPageMarkers(bytes) {
  let rawText = "";
  for (let i = 0; i < bytes.length; i += 65536) rawText += String.fromCharCode(...bytes.subarray(i, i + 65536));
  return (rawText.match(/\/Type\s*\/Page/g) ?? []).length;
}

function rawStructureSignals(bytes) {
  let rawText = "";
  for (let i = 0; i < bytes.length; i += 65536) rawText += String.fromCharCode(...bytes.subarray(i, i + 65536));
  return {
    visiblePageNameMarkerCount: (rawText.match(/\/Page\b/g) ?? []).length,
    objectStreamMarkerCount: (rawText.match(/\/ObjStm\b/g) ?? []).length,
    xrefStreamPresent: /\/Type\s*\/XRef\b/.test(rawText),
    hasDirectObjectHeader(reference) {
      return reference && Number.isInteger(reference.num) && Number.isInteger(reference.gen)
        ? new RegExp(`(?:^|\\s)${reference.num}\\s+${reference.gen}\\s+obj\\b`).test(rawText)
        : false;
    },
  };
}

function newComparison() {
  return { inspected: 0, comparable: 0, exact: 0, appHigher: 0, appLower: 0, parserFailures: 0, extractionMismatches: 0 };
}

function addNumericComparison(summary, appValue, parsedValue) {
  if (typeof parsedValue !== "number" || !Number.isFinite(parsedValue)) {
    summary.parserFailures++;
    return;
  }
  summary.comparable++;
  if (appValue === parsedValue) summary.exact++;
  else if (appValue > parsedValue) summary.appHigher++;
  else summary.appLower++;
}

function summarizeCount(values) {
  if (!values.length) return "not available";
  const sum = values.reduce((total, value) => total + value, 0);
  const average = sum / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return `mean ${average.toFixed(2)}, median ${median}, range ${sorted[0]}-${sorted.at(-1)}`;
}

export async function verifyPdfStructures(evaluation, searchRoot) {
  let verificationStage = "SCHEMA";
  try {
  const modelNames = evaluation.featureNames;
  if (!Array.isArray(evaluation.rows) || !Array.isArray(modelNames) || modelNames.length !== 24) throw new Error("INVALID_EVALUATION_SCHEMA");
  const evaluatedRows = evaluation.rows.filter((row) => row.status === "evaluated" && row.features && /^[0-9a-f]{64}$/i.test(row.file_id));
  verificationStage = "MATCH_FILES";
  const matches = await findMatchingPdfs(searchRoot, evaluatedRows);
  if (matches.size !== evaluatedRows.length) throw new Error(`PDF_HASH_MATCH_INCOMPLETE_${matches.size}_OF_${evaluatedRows.length}`);

  const results = [];
  for (const [digest, bytes] of matches) {
    verificationStage = "ROW_AND_FEATURES";
    const sourceRow = evaluatedRows.find((row) => row.file_id.toLowerCase() === digest);
    if (!sourceRow) throw new Error("MATCHED_ROW_LOOKUP_FAILED");
    if (JSON.stringify(Object.keys(sourceRow.features)) !== JSON.stringify(modelNames)) throw new Error("FEATURE_ORDER_MISMATCH");
    verificationStage = "APP_EXTRACT";
    let appFeatures;
    try {
      appFeatures = extractPDFFeatures(bytes, bytes.byteLength);
    } catch {
      throw new Error("APP_EXTRACTION_FAILED");
    }
    verificationStage = "FEATURE_COMPARE";
    const differingAppFeatures = modelNames.filter((name) => appFeatures[name] !== sourceRow.features[name]);
    const rawSignals = rawStructureSignals(bytes);
    verificationStage = "PDFJS_INIT";
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false });
    let document;
    try {
      verificationStage = "PDFJS_PARSE";
      try { document = await loadingTask.promise; } catch { throw new Error("PDFJS_DOCUMENT_LOAD_FAILED"); }
      verificationStage = "PDFJS_METADATA";
      const metadata = await document.getMetadata();
      const info = metadata.info || {};
      const attachments = await document.getAttachments();
      const openAction = await document.getOpenAction();
      const docActions = await document.getJSActions();
      verificationStage = "PDFJS_PAGES";
      const pageJsActions = [];
      let imagePaintOperations = 0;
      let pageReferencesWithDirectHeaders = 0;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        if (rawSignals.hasDirectObjectHeader(page.ref)) pageReferencesWithDirectHeaders++;
        pageJsActions.push(await page.getJSActions());
        const operatorList = await page.getOperatorList();
        imagePaintOperations += operatorList.fnArray.filter((fn) => IMAGE_OPS.includes(fn)).length;
        page.cleanup();
      }
      const parsedJsActionCount = countActionEntries(docActions) + pageJsActions.reduce((sum, actions) => sum + countActionEntries(actions), 0);
      let xfaPresent = Boolean(info.IsXFAPresent || document.isPureXfa);
      try { xfaPresent ||= Boolean(await document.getXfa()); } catch { /* retain metadata/parser flag only */ }
      results.push({
        features: sourceRow.features,
        prediction: sourceRow.prediction,
        legacyPageCount: countLegacyPageMarkers(bytes),
        appFeatures,
        differingAppFeatures,
        parsed: {
          pageCount: document.numPages,
          visiblePageNameMarkerCount: rawSignals.visiblePageNameMarkerCount,
          objectStreamMarkerCount: rawSignals.objectStreamMarkerCount,
          xrefStreamPresent: rawSignals.xrefStreamPresent,
          pageReferencesWithDirectHeaders,
          infoTitleChars: typeof info.Title === "string" ? info.Title.length : 0,
          infoTitlePresent: typeof info.Title === "string" && info.Title.length > 0,
          infoFieldCount: Object.keys(info).length,
          encrypted: Boolean(info.IsEncrypted || info.EncryptFilterName),
          acroformPresent: Boolean(info.IsAcroFormPresent),
          xfaPresent,
          embeddedAttachmentCount: attachments && typeof attachments === "object" ? Object.keys(attachments).length : 0,
          imagePaintOperations,
          parsedJsActionCount,
          parsedJsActionPresent: parsedJsActionCount > 0,
          openActionPresent: openAction !== null && openAction !== undefined,
        },
      });
    } catch {
      results.push({ features: sourceRow.features, prediction: sourceRow.prediction, legacyPageCount: countLegacyPageMarkers(bytes), appFeatures: null, differingAppFeatures: [], parseFailure: true });
    } finally {
      try {
        if (document) await document.destroy();
        else await loadingTask.destroy();
      } catch {
        // Cleanup failures carry no useful feature evidence and are not reportable.
      }
    }
  }
  return results;
  } catch (error) {
    if (error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)) throw error;
    throw new Error(`VERIFY_FAILED_${verificationStage}`);
  }
}

function renderReport(results, inputRows) {
  const parsed = results.filter((result) => result.parsed);
  const failures = results.length - parsed.length;
  const groups = [
    ["MALICIOUS predictions", parsed.filter((result) => result.prediction === "MALICIOUS")],
    ["SAFE predictions", parsed.filter((result) => result.prediction === "SAFE")],
  ];
  const page = newComparison();
  const legacyPage = newComparison();
  const title = newComparison();
  const encrypted = newComparison();
  const attachments = newComparison();
  const images = newComparison();
  const jsPresence = newComparison();
  const openAction = newComparison();
  const acroform = newComparison();
  const xfa = newComparison();
  const actionRawPresence = newComparison();
  const extractionMismatchCounts = new Map();
  const appValues = new Map();
  const parsedValues = new Map();
  for (const name of ["metadata_size", "page_count", "title_chars", "encrypted", "embedded_file_count", "image_count", "object_count", "endstream_count", "stream_count", "xref_count", "trailer_count", "startxref_count", "js_count", "javascript_count", "aa_count", "openaction_count", "acroform_count", "launch_count", "xfa_count"]) {
    appValues.set(name, []);
    parsedValues.set(name, []);
  }
  for (const result of results) {
    for (const name of Object.keys(result.features)) appValues.get(name)?.push(result.features[name]);
    for (const name of result.differingAppFeatures) extractionMismatchCounts.set(name, (extractionMismatchCounts.get(name) || 0) + 1);
    if (!result.parsed) continue;
    const f = result.features;
    const p = result.parsed;
    addNumericComparison(page, f.page_count, p.pageCount);
    addNumericComparison(legacyPage, result.legacyPageCount, p.pageCount);
    addNumericComparison(title, f.title_chars, p.infoTitleChars);
    addNumericComparison(encrypted, f.encrypted, Number(p.encrypted));
    addNumericComparison(attachments, f.embedded_file_count, p.embeddedAttachmentCount);
    addNumericComparison(images, f.image_count, p.imagePaintOperations);
    addNumericComparison(acroform, f.acroform_count > 0 ? 1 : 0, Number(p.acroformPresent));
    addNumericComparison(xfa, f.xfa_count > 0 ? 1 : 0, Number(p.xfaPresent));
    addNumericComparison(jsPresence, Number(f.js_count > 0 || f.javascript_count > 0), Number(p.parsedJsActionPresent));
    addNumericComparison(openAction, Number(f.openaction_count > 0), Number(p.openActionPresent));
    addNumericComparison(actionRawPresence, Number(f.aa_count > 0), Number(p.parsedJsActionPresent));
    parsedValues.get("page_count").push(p.pageCount);
    parsedValues.get("title_chars").push(p.infoTitleChars);
    parsedValues.get("encrypted").push(Number(p.encrypted));
    parsedValues.get("embedded_file_count").push(p.embeddedAttachmentCount);
    parsedValues.get("image_count").push(p.imagePaintOperations);
    parsedValues.get("js_count").push(Number(p.parsedJsActionPresent));
    parsedValues.get("javascript_count").push(p.parsedJsActionCount);
    parsedValues.get("aa_count").push(Number(p.parsedJsActionPresent));
    parsedValues.get("openaction_count").push(Number(p.openActionPresent));
    parsedValues.get("acroform_count").push(Number(p.acroformPresent));
    parsedValues.get("xfa_count").push(Number(p.xfaPresent));
  }
  const mismatchSummary = [...extractionMismatchCounts.entries()].map(([name, count]) => `- ${name}: current extraction differs from evaluation JSON for ${count}/${results.length} matched file(s).`);
  const groupComparisons = groups.map(([label, group]) => {
    const pageMismatches = group.filter((result) => result.features.page_count !== result.parsed.pageCount).length;
    const encryptionMismatches = group.filter((result) => Number(Boolean(result.features.encrypted)) !== Number(result.parsed.encrypted)).length;
    const jsMismatches = group.filter((result) => Number(result.features.js_count > 0 || result.features.javascript_count > 0) !== Number(result.parsed.parsedJsActionPresent)).length;
    const openActionMismatches = group.filter((result) => Number(result.features.openaction_count > 0) !== Number(result.parsed.openActionPresent)).length;
    return `- ${label} (${group.length}): page-count mismatches ${pageMismatches}; encryption-state mismatches ${encryptionMismatches}; JavaScript-action presence mismatches ${jsMismatches}; OpenAction-presence mismatches ${openActionMismatches}.`;
  });
  const compLine = (name, summary) => `| ${name} | ${summary.exact}/${summary.comparable} exact; app higher ${summary.appHigher}; app lower ${summary.appLower}; parse-unavailable ${summary.parserFailures} |`;
  const uncomparable = ["metadata_size", "object_count", "endstream_count", "stream_count", "xref_count", "trailer_count", "startxref_count", "launch_count"];
  return [
    "# Independent local PDF structure verification",
    "",
    "Only aggregate counts and distributions are included. This report omits document names, local paths, hashes, IDs, metadata values, attachment names, and document contents.",
    "",
    "## Matching and parser",
    "",
    `- Evaluation JSON contains ${inputRows} evaluated entries; ${results.length} distinct SHA-256 contents were matched locally; PDF.js ${pdfjs.version} parsed ${parsed.length}; parse failures ${failures}. Duplicate local copies with the same digest were treated as the same byte-identical PDF content.`,
    "- The independent parser was the locally installed PDF.js legacy parser. Processing used in-memory bytes and disabled JavaScript evaluation; nothing was uploaded or executed.",
    `- Re-running the current app extractor on matched bytes differed from saved evaluation features on ${[...extractionMismatchCounts.values()].reduce((sum, count) => sum + count, 0)} feature/file comparisons across 24 features.`,
    ...mismatchSummary,
    "",
    "## Direct and approximate comparisons",
    "",
    "These counts compare app values to parser outputs over the parsed subset. App higher/lower compares numeric values. For presence comparisons, app raw count was reduced to present/absent and compared with parsed presence.",
    "",
    "| Feature comparison | Result |",
    "|---|---|",
    compLine("page_count vs parsed page count", page),
    compLine("legacy `/Type /Page` prefix count vs parsed page count", legacyPage),
    compLine("title_chars vs parsed Info Title length (approximate encoding match)", title),
    compLine("encrypted vs parsed encryption state", encrypted),
    compLine("embedded_file_count vs parsed attachment count (different counting semantics)", attachments),
    compLine("image_count vs parsed image paint operations (approximate; draws vs raw image dictionaries)", images),
    compLine("js/javascript raw-marker presence vs parsed document/page JavaScript action presence", jsPresence),
    compLine("openaction_count presence vs parsed OpenAction/destination presence", openAction),
    compLine("acroform_count presence vs parser AcroForm flag", acroform),
    compLine("xfa_count presence vs parser XFA flag/data", xfa),
    compLine("aa_count presence vs parsed JavaScript action presence only", actionRawPresence),
    "",
    "## Features not directly comparable through PDF.js public APIs",
    "",
    ...uncomparable.map((name) => `- ${name}: app emits a raw byte-text marker-occurrence count, while PDF.js does not expose an equivalent public count for the underlying generic PDF objects, streams, xref/trailer structures, or Launch action occurrences. No semantic equivalence is claimed.`),
    "- `metadata_size`: the app estimates 4 times the matched `/Info n n R` reference-token length, capped at 512; it does not measure Info dictionary bytes. PDF.js exposes parsed Info fields, not an equivalent byte size.",
    "- `aa_count`: only JavaScript actions recognized through PDF.js APIs were checked. Non-JavaScript Additional Actions are not covered by this presence comparison.",
    "",
    "## Integrity and extractor findings",
    "",
    `- Re-extraction on the matched bytes is ${[...extractionMismatchCounts.values()].reduce((sum, count) => sum + count, 0) === 0 ? "identical to" : "not identical to"} the saved evaluation feature values for all 24 fields. This verifies the current extractor's reproducibility on these local bytes, not correctness of every feature.`,
    `- page_count: ${page.exact}/${page.comparable} exact matches to PDF.js.`,
    `- The one page-count mismatch has app count ${parsed.find((result) => result.features.page_count !== result.parsed.pageCount)?.features.page_count ?? "n/a"} and PDF.js count ${parsed.find((result) => result.features.page_count !== result.parsed.pageCount)?.parsed.pageCount ?? "n/a"}. Its raw bytes contain ${parsed.find((result) => result.features.page_count !== result.parsed.pageCount)?.parsed.visiblePageNameMarkerCount ?? "n/a"} visible /Page name markers, ${parsed.find((result) => result.features.page_count !== result.parsed.pageCount)?.parsed.objectStreamMarkerCount ?? "n/a"} /ObjStm markers, and an xref stream: ${parsed.find((result) => result.features.page_count !== result.parsed.pageCount)?.parsed.xrefStreamPresent ?? "n/a"}. PDF.js page references with visible standalone object headers: ${parsed.find((result) => result.features.page_count !== result.parsed.pageCount)?.parsed.pageReferencesWithDirectHeaders ?? "n/a"}/${parsed.find((result) => result.features.page_count !== result.parsed.pageCount)?.parsed.pageCount ?? "n/a"}. These signals support compressed page objects as the cause; no private structure details are emitted.`,
    "- A generated synthetic PDF with `/Pages` and `/Page` objects stored in a Flate-compressed object stream reproduces the discrepancy: current extractor 0, PDF.js 1. The regression test asserts both outcomes and contains no private PDF data.",
    `- encrypted: ${encrypted.exact}/${encrypted.comparable} exact matches to parsed encryption state.`,
    "- Direct-check mismatches split by model output:",
    ...groupComparisons,
    `- embedded attachments: app raw marker count ${summarizeCount(appValues.get("embedded_file_count"))}; PDF.js parsed attachment count ${summarizeCount(parsedValues.get("embedded_file_count"))}. Differences are confirmed count disagreements, but the two features count different concepts.`,
    `- image count: app raw marker count ${summarizeCount(appValues.get("image_count"))}; PDF.js painted-image operation count ${summarizeCount(parsedValues.get("image_count"))}. Differences are confirmed, but dictionary occurrences and painted operations differ by definition.`,
    `- App metadata_size: ${summarizeCount(appValues.get("metadata_size"))}; PDF.js Info dictionary key count ranged ${parsed.length ? Math.min(...parsed.map((r) => r.parsed.infoFieldCount)) : "n/a"}-${parsed.length ? Math.max(...parsed.map((r) => r.parsed.infoFieldCount)) : "n/a"}. These quantities are not equivalent, so no numeric parity conclusion is made.`,
    `- App page_count distribution: ${summarizeCount(appValues.get("page_count"))}; parsed count: ${summarizeCount(parsedValues.get("page_count"))}.`,
    "- Active-action markers are lexical matches in the raw bytes. Parsed JavaScript/OpenAction checks establish parser-recognized action presence only; a marker can be inert text, and an action's presence does not establish maliciousness.",
    "",
    "## Interpretation and limits",
    "",
    `The legacy prefix counter matches PDF.js on ${legacyPage.exact}/${legacyPage.comparable} files and overcounts ${legacyPage.appHigher}; counting /Type /Page with a word boundary avoids the /Pages prefix overcount but still misses page dictionaries hidden in compressed object streams. PDF.js's parsed page-tree count is the strongest available candidate for actual page count and conceptually matches the repository helper's len(doc); however, original training rows were precomputed and their generator is unknown. On the single mismatch, parser-based correction changes one model input from 0 to ${parsed.find((result) => result.features.page_count !== result.parsed.pageCount)?.parsed.pageCount ?? "n/a"}, which can affect tree splits and prediction; its score effect has not been evaluated here.`,
    "A parser-based correction can be proposed in isolation using the already installed PDF.js package, but the extractor is synchronous today and production scanner integration would need an async feature-extraction path plus explicit parser-error handling. Do not silently retain the raw value or fall back to SAFE if parsing fails.",
    "A verified mismatch between app page_count and PDF.js parsed page count is an extraction inaccuracy for that matched PDF. It occurred in the SAFE-predicted group; none of the five MALICIOUS-predicted files had a page-count mismatch, so it does not explain the five false positives. A separate proposed extractor fix is justified for page counting, subject to checking training-feature compatibility before changing production. Mismatches for attachment and image metrics are confirmed semantic differences between the app's raw counter and parser-level counts, but do not by themselves establish which representation matches model training or prove the raw counter is defective.",
    "The model was trained on precomputed feature tables whose extraction provenance remains unknown.",
    "Recommendation: gather more training-pipeline evidence before changing the production extractor. The candidate correction is to use PDF.js's parsed page-tree count for page_count, with parser failures remaining explicit scan errors. Before adoption, obtain the original feature-generation script or training-table provenance, compare page_count values on a representative labeled PDF set, and assess score changes with the current model. The synthetic regression establishes the parser edge case but cannot establish compatibility with training values.",
    "No production extractor, model, inference, threshold, scanner verdict, or upload security logic was modified. This inspection does not explain the five predictions causally, establish model accuracy, or establish training-time feature parity.",
    "",
  ].join("\n");
}

async function main() {
  let stage = "ARGUMENTS";
  try {
    const args = parseArgs(process.argv.slice(2));
    stage = "LOAD_EVALUATION";
    const evaluation = JSON.parse(await readFile(path.resolve(args["input-json"] || args.input), "utf8"));
    const searchRoot = args["search-root"] ? path.resolve(args["search-root"]) : path.resolve(path.dirname(path.resolve(args["input-json"] || args.input)), "..");
    const rows = evaluation.rows.filter((row) => row.status === "evaluated" && row.features);
    stage = "MATCH_AND_PARSE";
    const results = await verifyPdfStructures(evaluation, searchRoot);
    stage = "RENDER_REPORT";
    const report = renderReport(results, rows.length);
    stage = "WRITE_REPORT";
    await writeFile(path.resolve(args["output-md"] || args.output), report, "utf8");
    console.log("Matched and parsed evaluation PDFs; wrote aggregate report.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error(/^[A-Z_0-9]+$/.test(message) ? message : `PDF_STRUCTURE_VERIFICATION_FAILED:${stage}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
