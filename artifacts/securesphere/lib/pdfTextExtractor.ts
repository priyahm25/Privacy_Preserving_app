import { decompressSync } from "fflate";

export type PdfTextExtraction = {
  text: string;
  pageCount: number;
};

/** Kept in both platform modules so upload can distinguish parser failures. */
export class PdfTextExtractionError extends Error {
  constructor() {
    super("PDF.js could not extract text from this PDF.");
    this.name = "PdfTextExtractionError";
  }
}

// This is intentionally bounded: PDF content streams are untrusted input and
// PDF text extraction happens in the app process on the user's device.
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_DECOMPRESSED_CONTENT_BYTES = 8 * 1024 * 1024;

function decodePdfLiteral(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      result += character;
      continue;
    }

    const escaped = value[++index];
    if (!escaped) break;
    const controls: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    if (controls[escaped] !== undefined) {
      result += controls[escaped];
    } else if (/[0-7]/.test(escaped)) {
      const octal = escaped + value.slice(index + 1, index + 3).match(/^[0-7]{0,2}/)?.[0];
      result += String.fromCharCode(parseInt(octal, 8));
      index += octal.length - 1;
    } else if (escaped !== "\r" && escaped !== "\n") {
      result += escaped;
    }
  }
  return result;
}

function decodePdfHex(value: string): string {
  const compact = value.replace(/\s/g, "");
  if (!/^[0-9a-f]*$/i.test(compact)) return "";
  const padded = compact.length % 2 === 0 ? compact : `${compact}0`;
  const bytes = Uint8Array.from(padded.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    }
    return text;
  }
  return new TextDecoder("latin1").decode(bytes);
}

function stringsFromTextOperator(value: string): string[] {
  return Array.from(value.matchAll(/\((?:\\.|[^\\)])*\)|<[0-9a-f\s]+>/gi), (match) => {
    const token = match[0];
    return token.startsWith("(")
      ? decodePdfLiteral(token.slice(1, -1))
      : decodePdfHex(token.slice(1, -1));
  }).filter(Boolean);
}

function isLinePositioning(value: string): boolean {
  return /(?:\b(?:Td|TD|Tm)\b|\bT\*|['"]\s*)/.test(value);
}

function textFromContentStream(bytes: Uint8Array<ArrayBufferLike>): string {
  const content = new TextDecoder("latin1").decode(bytes);
  let text = "";
  let previousEnd = 0;

  // PDF text is painted by Tj, TJ, ' and \". Keep adjacent painted runs
  // together: writers commonly split a visual word across several Tj/TJ
  // operations. Positioning operators retain a line boundary for later
  // hyphenation and whitespace cleanup.
  for (const match of content.matchAll(/\[([\s\S]*?)\]\s*TJ|((?:\((?:\\.|[^\\)])*\)|<[0-9a-f\s]+>)\s*(?:Tj|'|\"))/gi)) {
    const raw = match[0];
    const between = content.slice(previousEnd, match.index);
    const needsLineBreak = Boolean(text) && (isLinePositioning(between) || /(?:'|\")\s*$/.test(raw));
    if (needsLineBreak) text += "\n";
    text += stringsFromTextOperator(match[1] ?? match[2] ?? "").join("");
    previousEnd = (match.index ?? 0) + raw.length;
  }
  return text;
}

function normalizeExtractedPdfText(value: string): string {
  return value
    .replace(/\u00ad/g, "")
    .replace(/([\p{L}\p{N}])[-\u2010-\u2015]\s*\n\s*([\p{L}\p{N}])/gu, "$1$2")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts painted text from common, text-based PDFs entirely in JavaScript.
 * It supports uncompressed and Flate-compressed content streams, which cover
 * normal PDFs produced by browsers and office suites. Scanned/image-only,
 * encrypted, malformed, and unsupported-filter PDFs deliberately return no
 * text so they cannot create a misleading blind index.
 */
export function extractPdfText(bytes: Uint8Array): PdfTextExtraction {
  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) return { text: "", pageCount: 0 };

  const source = new TextDecoder("latin1").decode(bytes);
  if (!source.startsWith("%PDF-")) return { text: "", pageCount: 0 };

  const pageCount = (source.match(/\/Type\s*\/Page\b/g) ?? []).length;
  const streamPattern = /<<[\s\S]*?>>\s*stream\r?\n/g;
  const text: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(source)) !== null) {
    const streamStart = streamPattern.lastIndex;
    const endStream = source.indexOf("endstream", streamStart);
    if (endStream < 0) break;
    streamPattern.lastIndex = endStream + "endstream".length;

    let streamEnd = endStream;
    if (source[streamEnd - 1] === "\n") streamEnd -= 1;
    if (source[streamEnd - 1] === "\r") streamEnd -= 1;
    const streamBytes = bytes.slice(streamStart, streamEnd);
    const dictionary = match[0];
    let content: Uint8Array<ArrayBufferLike> = streamBytes;
    if (/\/Filter\s*(?:\/FlateDecode\b|\[\s*\/FlateDecode\s*\])/.test(dictionary)) {
      try {
        content = decompressSync(streamBytes);
      } catch {
        continue;
      }
    } else if (/\/Filter\b/.test(dictionary)) {
      continue;
    }

    if (content.length <= MAX_DECOMPRESSED_CONTENT_BYTES) {
      text.push(textFromContentStream(content));
    }
  }

  return { text: normalizeExtractedPdfText(text.join("\n")), pageCount };
}
