import { unzipSync } from "fflate";
export type ScanFormatVerdict = "CORRUPTED" | "UNSUPPORTED";

export class ScanFormatError extends Error {
  readonly verdict: ScanFormatVerdict;

  constructor(verdict: ScanFormatVerdict, message: string) {
    super(message);
    this.verdict = verdict;
    this.name = "ScanFormatError";
  }
}

/** Validate that bytes have the package parts required by Office extractors. */
export function validateOfficePackage(
  bytes: Uint8Array,
  fileType: "word" | "excel",
): void {
  // Encrypted OOXML Office documents may use the legacy OLE container. They
  // cannot be inspected here, but that does not make them malformed.
  if (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 && bytes[5] === 0xb1 && bytes[6] === 0x1a && bytes[7] === 0xe1
  ) {
    throw new ScanFormatError("UNSUPPORTED", "This Office document is encrypted or uses a legacy format the scanner cannot inspect.");
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ScanFormatError("CORRUPTED", "The Office file is not a readable ZIP package.");
  }
  const names = Object.keys(files);
  const valid = fileType === "word"
    ? Boolean(files["[Content_Types].xml"] && files["word/document.xml"])
    : Boolean(files["[Content_Types].xml"] && files["xl/workbook.xml"] &&
      names.some((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)));
  if (!valid) {
    throw new ScanFormatError(
      "CORRUPTED",
      fileType === "word"
        ? "The DOCX package is missing required document parts."
        : "The XLSX package is missing required workbook parts.",
    );
  }
}
