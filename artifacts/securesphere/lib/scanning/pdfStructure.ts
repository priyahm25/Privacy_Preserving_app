/**
 * Local PDF structure analysis: header check, bounded decompression of
 * object streams (/ObjStm), page/Info parsing, and deterministic findings.
 *
 * Modern PDFs keep page and action dictionaries inside compressed object
 * streams. Reading only raw bytes missed them, which (a) gave page_count 0 -
 * the strongest "malicious" signal the PDF model learned - and (b) hid
 * /JavaScript or /Launch actions from inspection.
 */
import { inflateSync, unzlibSync } from "fflate";
import { ScanFormatError } from "./officeValidation";
import type { ScanFinding } from "./verdict";

export const PDF_LIMITS = {
  maxObjectStreams: 5000,
  maxDecompressedBytes: 64 * 1024 * 1024,
};

export interface PdfInfo {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  creationDate: string;
  modDate: string;
  trapped: string;
}

export interface PdfAnalysis {
  version: string;
  /** Raw bytes as latin-1 plus decompressed object-stream contents, names de-escaped. */
  analysisText: string;
  pageCount: number;
  imageCount: number;
  encrypted: boolean;
  info: PdfInfo;
  findings: ScanFinding[];
}

const EMPTY_INFO: PdfInfo = { title: "", author: "", subject: "", keywords: "", creator: "", producer: "", creationDate: "", modDate: "", trapped: "" };

export function bytesToLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 65536) out += String.fromCharCode(...bytes.subarray(i, i + 65536));
  return out;
}

/** "/J#61vaScript" -> "/JavaScript": hex escapes in names are a common keyword-evasion trick. */
export function normalizeNames(text: string): string {
  return text.replace(/\/[^\s/<>\[\]()%{}]*#[0-9A-Fa-f]{2}[^\s/<>\[\]()%{}]*/g,
    (name) => name.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))));
}

function inflate(data: Uint8Array): Uint8Array {
  try { return unzlibSync(data); } catch { return inflateSync(data); }
}

/** Decodes a PDF text string: UTF-16BE with BOM, otherwise PDFDocEncoding (~latin-1). */
function decodePdfString(bytes: number[]): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  return String.fromCharCode(...bytes);
}

/** Reads a literal "(...)" or hex "<...>" string starting at `start`. */
function readPdfString(text: string, start: number): string | null {
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === "<" && text[i + 1] !== "<") {
    const end = text.indexOf(">", i);
    if (end < 0) return null;
    const hex = text.slice(i + 1, end).replace(/\s+/g, "");
    const bytes: number[] = [];
    for (let j = 0; j < hex.length; j += 2) bytes.push(parseInt((hex[j] + (hex[j + 1] ?? "0")), 16));
    return decodePdfString(bytes);
  }
  if (text[i] !== "(") return null;
  const bytes: number[] = [];
  let depth = 1;
  for (i++; i < text.length && depth > 0; i++) {
    const c = text[i];
    if (c === "\\") {
      const n = text[++i];
      const map: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
      if (n in map) bytes.push(map[n]);
      else if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(text[i + 1])) oct += text[++i];
        bytes.push(parseInt(oct, 8) & 0xff);
      } else if (n === "\r" || n === "\n") { if (n === "\r" && text[i + 1] === "\n") i++; }
      else if (n !== undefined) bytes.push(n.charCodeAt(0));
      continue;
    }
    if (c === "(") depth++;
    if (c === ")" && --depth === 0) break;
    bytes.push(c.charCodeAt(0) & 0xff);
  }
  return decodePdfString(bytes);
}

/** Returns the body text of object `num`, from the raw file or an object stream. */
function findObject(raw: string, objStmObjects: Map<number, string>, num: number): string | null {
  const m = new RegExp(`(?:^|[^0-9])${num}\\s+\\d+\\s+obj\\b([\\s\\S]*?)endobj`).exec(raw);
  return m ? m[1] : objStmObjects.get(num) ?? null;
}

function parseInfo(dict: string): PdfInfo {
  const info = { ...EMPTY_INFO };
  const keys: [keyof PdfInfo, string][] = [["title", "Title"], ["author", "Author"], ["subject", "Subject"], ["keywords", "Keywords"],
    ["creator", "Creator"], ["producer", "Producer"], ["creationDate", "CreationDate"], ["modDate", "ModDate"], ["trapped", "Trapped"]];
  for (const [field, key] of keys) {
    const m = new RegExp(`/${key}(?![A-Za-z])`).exec(dict);
    if (!m) continue;
    const value = readPdfString(dict, m.index + m[0].length);
    if (value !== null) info[field] = value;
    else if (field === "trapped") info.trapped = /^\s*\/(\w+)/.exec(dict.slice(m.index + m[0].length))?.[1] ?? "";
  }
  return info;
}

/** Python repr() of a str, as PyMuPDF's metadata dict prints it. */
function pyRepr(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  const escaped = value.replace(/\\/g, "\\\\").replace(quote === "'" ? /'/g : /"/g, `\\${quote}`)
    .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  return quote + escaped + quote;
}

/**
 * Size of `str(doc.metadata).encode("utf-8")` as the training extractor
 * (ml/pdf-malware/pdf_features.py, PyMuPDF) computed `metadata_size`.
 */
export function pymupdfMetadataSize(version: string, info: PdfInfo, encrypted: boolean): number {
  const fields: [string, string][] = [["format", `PDF ${version}`], ["title", info.title], ["author", info.author], ["subject", info.subject],
    ["keywords", info.keywords], ["creator", info.creator], ["producer", info.producer], ["creationDate", info.creationDate],
    ["modDate", info.modDate], ["trapped", info.trapped]];
  const body = fields.map(([k, v]) => `'${k}': ${pyRepr(v)}`).join(", ");
  const repr = `{${body}, 'encryption': ${encrypted ? "'Standard'" : "None"}}`;
  return new TextEncoder().encode(repr).length;
}

const EXECUTABLE_NAME = /\.(exe|dll|scr|com|bat|cmd|ps1|vbs|vbe|js|jse|wsf|hta|jar|msi|lnk|cpl|pif)\b/i;

export function analyzePdf(bytes: Uint8Array, limits = PDF_LIMITS): PdfAnalysis {
  const head = bytesToLatin1(bytes.subarray(0, 1024));
  const headerAt = head.indexOf("%PDF-");
  if (headerAt < 0) throw new ScanFormatError("CORRUPTED", "The file does not start with a PDF header.");
  const version = /^%PDF-(\d\.\d)/.exec(head.slice(headerAt))?.[1] ?? "1.4";

  const raw = bytesToLatin1(bytes);
  const findings: ScanFinding[] = [];
  const add = (severity: ScanFinding["severity"], code: string) => {
    if (!findings.some((f) => f.code === code)) findings.push({ severity, code });
  };

  // Decompress object streams only: they hold dictionaries (pages, actions,
  // Info). Content streams are page drawing data and are not decompressed.
  const objStmObjects = new Map<number, string>();
  const decompressedParts: string[] = [];
  let decompressed = 0;
  let objStmCount = 0;
  const streamStart = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamStart.exec(raw))) {
    if (raw.slice(Math.max(0, match.index - 3), match.index) === "end") continue;
    const dictStart = raw.lastIndexOf("obj", match.index);
    const dict = dictStart >= 0 ? normalizeNames(raw.slice(dictStart, match.index)) : "";
    if (!/\/Type\s*\/ObjStm/.test(dict)) continue;
    if (++objStmCount > limits.maxObjectStreams) { add("uncertain", "PDF_UNINSPECTABLE_STREAM"); break; }
    const dataStart = match.index + match[0].length;
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    const dataEnd = length ? dataStart + Number(length[1]) : raw.indexOf("endstream", dataStart);
    if (dataEnd < dataStart) { add("uncertain", "PDF_UNINSPECTABLE_STREAM"); continue; }
    if (!/\/FlateDecode/.test(dict) || /\/DecodeParms/.test(dict) || /\[\s*\/\w+\s+\/\w+/.test(/\/Filter\s*(\[[^\]]*\])?/.exec(dict)?.[0] ?? "")) {
      // Other or chained filters are not decoded here, so contents stay unseen.
      add("uncertain", "PDF_UNINSPECTABLE_STREAM");
      continue;
    }
    let data: Uint8Array;
    try {
      data = inflate(bytes.subarray(dataStart, dataEnd));
    } catch {
      add("uncertain", "PDF_UNINSPECTABLE_STREAM");
      continue;
    }
    decompressed += data.length;
    if (decompressed > limits.maxDecompressedBytes) { add("uncertain", "PDF_UNINSPECTABLE_STREAM"); break; }
    const text = bytesToLatin1(data);
    decompressedParts.push(text);
    const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1] ?? NaN);
    const n = Number(/\/N\s+(\d+)/.exec(dict)?.[1] ?? NaN);
    if (Number.isFinite(first) && Number.isFinite(n)) {
      const nums = text.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i + 1 < nums.length && i / 2 < n; i += 2) {
        const end = i + 3 < nums.length ? first + nums[i + 3] : text.length;
        objStmObjects.set(nums[i], text.slice(first + nums[i + 1], end));
      }
    }
  }

  const analysisText = normalizeNames(raw + "\n" + decompressedParts.join("\n"));
  const pageCount = (analysisText.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  const imageCount = (analysisText.match(/\/Subtype\s*\/Image\b/g) ?? []).length;
  const encrypted = /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(analysisText);

  let info = { ...EMPTY_INFO };
  const infoRef = /\/Info\s+(\d+)\s+\d+\s+R/.exec(analysisText);
  if (infoRef) {
    const body = findObject(raw, objStmObjects, Number(infoRef[1]));
    if (body) info = parseInfo(body);
  }

  // High-confidence malicious: actions that start external programs, and
  // attached executables.
  if (/\/Launch\b/.test(analysisText)) add("malicious", "PDF_LAUNCH_ACTION");
  for (const m of analysisText.matchAll(/\/(UF|F)\s*(\([^)]*\)|<[0-9A-Fa-f\s]*>)/g)) {
    const name = readPdfString(m[2], 0) ?? "";
    if (EXECUTABLE_NAME.test(name) && /\/EmbeddedFile|\/Filespec/.test(analysisText)) add("malicious", "PDF_EMBEDDED_EXECUTABLE");
  }
  // Active or uninspectable content: blocked for further inspection, not
  // declared malicious (forms, attachments and scripts have benign uses).
  if (/\/(JS|JavaScript)\b/.test(analysisText)) add("uncertain", "PDF_JAVASCRIPT");
  if (/\/EmbeddedFile\b/.test(analysisText)) add("uncertain", "PDF_EMBEDDED_FILE");
  if (/\/RichMedia\b/.test(analysisText)) add("uncertain", "PDF_RICH_MEDIA");
  if (/\/XFA\b/.test(analysisText)) add("uncertain", "PDF_XFA_FORM");
  if (/\/JBIG2Decode\b/.test(analysisText)) add("uncertain", "PDF_JBIG2_STREAM");
  if (/\/URI\s*\(\s*(file:|\\\\|ms-msdt:|search-ms:)/i.test(analysisText)) add("uncertain", "PDF_NON_WEB_URI");
  if (encrypted) add("uncertain", "PDF_ENCRYPTED");
  if (pageCount === 0) add("uncertain", "PDF_NO_PAGES_FOUND");
  if (!raw.includes("%%EOF") && !raw.includes("startxref")) add("uncertain", "PDF_TRUNCATED");

  return { version, analysisText, pageCount, imageCount, encrypted, info, findings };
}
