import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { ScanFormatError, validateOfficePackage } from "../../artifacts/securesphere/lib/scanning/officeValidation.ts";
import { detectFileType, getUnsupportedFileReason } from "../../artifacts/securesphere/lib/scanning/fileTypeDetection.ts";
import { scanHtmlBytes } from "../../artifacts/securesphere/lib/scanning/htmlScanCore.ts";
import { scanTextBytes } from "../../artifacts/securesphere/lib/scanning/textScanCore.ts";
import { isUploadScanApproved } from "../../artifacts/securesphere/lib/scanning/uploadPolicy.ts";
import { extractHTMLFeatures } from "../../artifacts/securesphere/lib/scanning/extractors/htmlExtractor.ts";
import { extractPDFFeatures } from "../../artifacts/securesphere/lib/scanning/extractors/pdfExtractor.ts";
import { buildFeatureVector, lgbmPredict, type LGBMModel } from "../../artifacts/securesphere/lib/scanning/lgbmInference.ts";

const requireFromApp = createRequire(fileURLToPath(new URL("../../artifacts/securesphere/package.json", import.meta.url)));
const { zipSync } = requireFromApp("fflate") as typeof import("fflate");

const docxBytes = zipSync({
  "[Content_Types].xml": new TextEncoder().encode("<Types></Types>"),
  "word/document.xml": new TextEncoder().encode("<w:document><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:document>"),
});
const xlsxBytes = zipSync({
  "[Content_Types].xml": new TextEncoder().encode("<Types></Types>"),
  "xl/workbook.xml": new TextEncoder().encode("<workbook><sheets><sheet name=\"Sheet1\"/></sheets></workbook>"),
  "xl/worksheets/sheet1.xml": new TextEncoder().encode("<worksheet><sheetData><row><c r=\"A1\"><v>1</v></c></row></sheetData></worksheet>"),
});

function rejectedFormat(bytes: Uint8Array, type: "word" | "excel"): ScanFormatError {
  try {
    validateOfficePackage(bytes, type);
  } catch (error) {
    assert.ok(error instanceof ScanFormatError);
    return error;
  }
  assert.fail("expected format validation to reject the file");
}

test("valid DOCX and XLSX packages pass the pre-inference format checks", () => {
  validateOfficePackage(docxBytes, "word");
  validateOfficePackage(xlsxBytes, "excel");
});

test("malformed Office bytes and missing package parts are reported as corrupted", () => {
  assert.equal(rejectedFormat(new Uint8Array([1, 2, 3]), "word").verdict, "CORRUPTED");
  const incomplete = zipSync({ "[Content_Types].xml": new TextEncoder().encode("<Types/>") });
  assert.equal(rejectedFormat(incomplete, "word").verdict, "CORRUPTED");
  assert.equal(rejectedFormat(incomplete, "excel").verdict, "CORRUPTED");
});

test("legacy OLE Office documents are unsupported, not classified as malformed", () => {
  const oleHeader = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.equal(rejectedFormat(oleHeader, "word").verdict, "UNSUPPORTED");
});

function htmlModel(): LGBMModel {
  const modelPath = fileURLToPath(new URL("../../artifacts/securesphere/assets/models/html.json", import.meta.url));
  return JSON.parse(readFileSync(modelPath, "utf8")) as LGBMModel;
}

function modelScan(bytes: Uint8Array, model = htmlModel()) {
  return scanHtmlBytes(
    bytes,
    (input, size) => extractHTMLFeatures(input, size) as unknown as Record<string, number>,
    (features) => lgbmPredict(model, buildFeatureVector(model, features)),
  );
}

test("a suspicious HTML fixture still receives the model's suspicious verdict", () => {
  const model = htmlModel();
  const html = new TextEncoder().encode(`<html><body><form action="http://198.51.100.7/login"><iframe hidden src="http://198.51.100.7"></iframe><script>eval(atob('Y29va2ll'));window.location='http://198.51.100.7';</script>Verify your password now</body></html>`);
  const result = modelScan(html, model);
  assert.equal(result.verdict, "MALICIOUS");
  assert.equal(isUploadScanApproved(result.verdict), false);
});

test("supported formats are frozen to TXT, DOCX, PDF and PPTX", () => {
  assert.equal(detectFileType("notes.txt"), "text");
  assert.equal(detectFileType("report.docx"), "word");
  assert.equal(detectFileType("paper.pdf"), "pdf");
  assert.equal(detectFileType("slides.pptx"), "powerpoint");
  // A known extension wins over a conflicting MIME type.
  assert.equal(detectFileType("paper.pdf", "text/html"), "pdf");
  for (const name of ["page.html", "page.htm", "sheet.xlsx", "sheet.xls", "macro.docm", "deck.pptm", "photo.png", "app.exe"]) {
    const type = detectFileType(name, "application/octet-stream");
    assert.equal(type, "unsupported", name);
    assert.ok(getUnsupportedFileReason(name, undefined, type));
  }
  assert.equal(detectFileType("page.data", "text/html; charset=utf-8"), "unsupported");
});

test("legacy DOC, PPT and XLS are reported as legacy formats", () => {
  for (const [name, mime] of [["legacy.doc", "application/msword"], ["legacy.ppt", "application/vnd.ms-powerpoint"], ["legacy.xls", "application/vnd.ms-excel"]]) {
    assert.equal(getUnsupportedFileReason(name, mime, detectFileType(name, mime)), "LEGACY_OFFICE_FORMAT");
  }
  assert.equal(getUnsupportedFileReason("photo.png", "image/png", "unsupported"), "UNSUPPORTED_FILE_TYPE");
});

test("plain-text extensions and MIME types resolve to the text scanner path", () => {
  assert.equal(detectFileType("notes.txt", "text/plain"), "text");
  assert.equal(detectFileType("notes.txt", "text/plain; charset=utf-8"), "text");
  assert.equal(detectFileType("notes", "text/plain; charset=utf-8"), "text");
});

test("normal UTF-8 and multiline text pass the deterministic text rules", () => {
  for (const value of ["A normal text note with UTF-8: café.", "First line\r\nSecond line\nThird line\twith a tab."]) {
    const result = scanTextBytes(new TextEncoder().encode(value));
    assert.equal(result.verdict, "SAFE");
    assert.equal(result.reasonCode, "TEXT_RULES_CLEAN");
    assert.equal(isUploadScanApproved(result.verdict), true);
  }
});

test("empty, invalid UTF-8, and binary-looking .txt content are not SAFE", () => {
  assert.equal(scanTextBytes(new Uint8Array()).reasonCode, "EMPTY_TEXT_FILE");
  assert.equal(scanTextBytes(new Uint8Array([0xc3, 0x28])).reasonCode, "INVALID_UTF8_TEXT");
  assert.equal(scanTextBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])).reasonCode, "TEXT_BINARY_CONTENT");
});

test("suspicious command text is UNCERTAIN and never approved", () => {
  const suspiciousText = "Run this command: powershell -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAKQA=; then disable antivirus.";
  const result = scanTextBytes(new TextEncoder().encode(suspiciousText));
  assert.equal(result.verdict, "UNCERTAIN");
  assert.equal(result.reasonCode, "TEXT_ENCODED_POWERSHELL");
  assert.equal(isUploadScanApproved(result.verdict), false);
});

test("unexpected text validation failures remain scanner errors", () => {
  const result = scanTextBytes(new TextEncoder().encode("text"), () => {
    throw new Error("simulated decoder failure");
  });
  assert.equal(result.verdict, "ERROR");
  assert.equal(result.reasonCode, "TEXT_SCAN_ERROR");
  assert.equal(isUploadScanApproved(result.verdict), false);
});

test("HTML-looking metadata cannot make non-HTML file bytes pass the HTML scanner", () => {
  const disguisedPdf = new TextEncoder().encode("%PDF-1.7\n");
  const result = modelScan(disguisedPdf);
  assert.equal(result.verdict, "UNSUPPORTED");
  assert.equal(result.reasonCode, "HTML_CONTENT_SIGNATURE_MISMATCH");
});

test("empty HTML is corrupted; incomplete but nonempty HTML is still assessed", () => {
  assert.equal(modelScan(new Uint8Array()).verdict, "CORRUPTED");
  const malformedMarkup = new TextEncoder().encode("<html><body><p>unfinished");
  assert.notEqual(modelScan(malformedMarkup).verdict, "CORRUPTED");
});

test("an inference failure remains an ERROR and never becomes SAFE", () => {
  const model = htmlModel();
  const html = new TextEncoder().encode("<html><body><p>Read me</p></body></html>");
  const failedModel = { ...model, num_features: model.num_features + 1 };
  const result = modelScan(html, failedModel);
  assert.equal(result.verdict, "ERROR");
  assert.match(result.error || "", /Feature count mismatch/);
});

test("PDF page count excludes the /Pages tree and counts only /Page dictionaries", () => {
  const bytes = new TextEncoder().encode([
    "%PDF-1.7",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R >> endobj",
    "4 0 obj << /Type /Page /Parent 2 0 R >> endobj",
    "%%EOF",
  ].join("\n"));

  assert.equal(extractPDFFeatures(bytes, bytes.byteLength).page_count, 2);
});

test("a page stored in an object stream is counted, matching PDF.js", async () => {
  const objectBodies = "<< /Type /Pages /Kids [4 0 R] /Count 1 >> << /Type /Page /Parent 3 0 R /MediaBox [0 0 100 100] >>";
  const objectHeader = `3 0 4 ${Buffer.byteLength("<< /Type /Pages /Kids [4 0 R] /Count 1 >> ") } `;
  const compressedObjects = deflateSync(Buffer.from(objectHeader + objectBodies, "latin1"));
  const chunks: Buffer[] = [];
  let offset = Buffer.byteLength("%PDF-1.5\n%\xE2\xE3\xCF\xD3\n", "latin1");
  const append = (chunk: Buffer) => {
    chunks.push(chunk);
    offset += chunk.byteLength;
  };
  append(Buffer.from("%PDF-1.5\n%\xE2\xE3\xCF\xD3\n", "latin1"));

  const objectOffsets: Record<number, number> = {};
  objectOffsets[1] = offset;
  append(Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n", "latin1"));
  objectOffsets[2] = offset;
  append(Buffer.from(`2 0 obj\n<< /Type /ObjStm /N 2 /First ${Buffer.byteLength(objectHeader)} /Length ${compressedObjects.byteLength} /Filter /FlateDecode >>\nstream\n`, "latin1"));
  append(compressedObjects);
  append(Buffer.from("\nendstream\nendobj\n", "latin1"));
  objectOffsets[5] = offset;

  const xrefEntries: Buffer[] = [];
  const addXrefEntry = (type: number, field1: number, field2: number) => {
    const entry = Buffer.alloc(7);
    entry[0] = type;
    entry.writeUInt32BE(field1, 1);
    entry.writeUInt16BE(field2, 5);
    xrefEntries.push(entry);
  };
  addXrefEntry(0, 0, 65535);
  addXrefEntry(1, objectOffsets[1], 0);
  addXrefEntry(1, objectOffsets[2], 0);
  addXrefEntry(2, 2, 0);
  addXrefEntry(2, 2, 1);
  addXrefEntry(1, objectOffsets[5], 0);
  const xrefStream = Buffer.concat(xrefEntries);
  append(Buffer.from(`5 0 obj\n<< /Type /XRef /Size 6 /W [1 4 2] /Root 1 0 R /Index [0 6] /Length ${xrefStream.byteLength} >>\nstream\n`, "latin1"));
  append(xrefStream);
  append(Buffer.from(`\nendstream\nendobj\nstartxref\n${objectOffsets[5]}\n%%EOF`, "latin1"));
  const bytes = Buffer.concat(chunks);

  const features = extractPDFFeatures(bytes, bytes.byteLength);
  assert.equal(features.page_count, 1);

  const pdfjs = await import(pathToFileURL(requireFromApp.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    assert.equal(document.numPages, 1);
  } finally {
    await document.destroy();
  }
});

test("LightGBM inference sums dumped leaf values without re-applying shrinkage", () => {
  // dump_model() leaf values already include the learning rate; see
  // lgbm-parity.test.ts for the check against real booster predictions.
  const model: LGBMModel = {
    model_name: "shrinkage-regression",
    feature_names: ["x"],
    num_features: 1,
    num_trees: 1,
    trees: [{ shrinkage: 0.05, root: { leaf_value: 2 } }],
  };

  const probability = lgbmPredict(model, [0]);
  assert.ok(Math.abs(probability - (1 / (1 + Math.exp(-2)))) < 1e-12);
});

test("only an explicit SAFE scanner verdict is allowed into encryption and upload", () => {
  assert.equal(isUploadScanApproved("SAFE"), true);
  assert.equal(isUploadScanApproved("MALICIOUS"), false);
  assert.equal(isUploadScanApproved("CORRUPTED"), false);
  assert.equal(isUploadScanApproved("UNSUPPORTED"), false);
  assert.equal(isUploadScanApproved("ERROR"), false);
});
