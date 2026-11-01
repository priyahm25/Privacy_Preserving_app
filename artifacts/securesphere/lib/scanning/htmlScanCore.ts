export type HtmlScanVerdict = "SAFE" | "MALICIOUS" | "CORRUPTED" | "UNSUPPORTED" | "ERROR";

export interface HtmlScanResult {
  verdict: HtmlScanVerdict;
  confidence: number;
  reasonCode?: "EMPTY_HTML" | "HTML_CONTENT_SIGNATURE_MISMATCH" | "HTML_MODEL_VERDICT" | "HTML_SCAN_ERROR";
  error?: string;
}

/** Shared HTML inference boundary: parser and model errors never become SAFE. */
export function scanHtmlBytes(
  bytes: Uint8Array,
  extract: (bytes: Uint8Array, actualByteLength: number) => Record<string, number>,
  infer: (features: Record<string, number>) => number,
): HtmlScanResult {
  if (bytes.byteLength === 0) {
    return {
      verdict: "CORRUPTED",
      confidence: 0,
      reasonCode: "EMPTY_HTML",
      error: "The selected HTML file is empty and cannot be scanned.",
    };
  }

  const signature = (value: string) =>
    bytes.length >= value.length &&
    [...value].every((character, index) => bytes[index] === character.charCodeAt(0));
  if (
    signature("%PDF-") ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3])) ||
    (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) ||
    (bytes[0] === 0x4d && bytes[1] === 0x5a) ||
    (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46)
  ) {
    return {
      verdict: "UNSUPPORTED",
      confidence: 0,
      reasonCode: "HTML_CONTENT_SIGNATURE_MISMATCH",
      error: "The file bytes match a different supported or executable format, not HTML.",
    };
  }

  try {
    const probability = infer(extract(bytes, bytes.byteLength));
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error("The HTML scanner returned an invalid model score.");
    }
    return {
      verdict: probability >= 0.5 ? "MALICIOUS" : "SAFE",
      confidence: probability,
      reasonCode: "HTML_MODEL_VERDICT",
    };
  } catch (error) {
    return {
      verdict: "ERROR",
      confidence: 0,
      reasonCode: "HTML_SCAN_ERROR",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
