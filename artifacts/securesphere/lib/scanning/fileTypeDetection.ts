/**
 * Supported formats are frozen to TXT, DOCX, PDF and PPTX. Everything else -
 * including HTML, XLS/XLSX and legacy DOC/PPT - is UNSUPPORTED and blocked.
 * The scanner also checks each file's bytes against the detected type.
 */
export type SupportedFileType =
  | "pdf"
  | "word"
  | "powerpoint"
  | "text"
  | "unsupported";

const BY_EXTENSION: Record<string, Exclude<SupportedFileType, "unsupported">> = {
  pdf: "pdf",
  docx: "word",
  pptx: "powerpoint",
  txt: "text",
};

const BY_MIME: Record<string, Exclude<SupportedFileType, "unsupported">> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "powerpoint",
  "text/plain": "text",
};

const LEGACY_OFFICE_EXTENSIONS = new Set(["doc", "ppt", "xls", "dot", "pot", "pps"]);
const LEGACY_OFFICE_MIMES = new Set(["application/msword", "application/vnd.ms-powerpoint", "application/vnd.ms-excel"]);

function extensionOf(fileName: string): string {
  const name = fileName.toLowerCase();
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
}

function normalizedMime(mimeType?: string): string {
  return (mimeType || "").split(";", 1)[0].trim().toLowerCase();
}

/** A known extension decides; the MIME type is used only when there is no extension. */
export function detectFileType(fileName: string, mimeType?: string): SupportedFileType {
  const extension = extensionOf(fileName);
  if (extension) return BY_EXTENSION[extension] ?? "unsupported";
  return BY_MIME[normalizedMime(mimeType)] ?? "unsupported";
}

export type UnsupportedFileReasonCode = "LEGACY_OFFICE_FORMAT" | "UNSUPPORTED_FILE_TYPE";

export function getUnsupportedFileReason(
  fileName: string,
  mimeType: string | undefined,
  resolvedType: SupportedFileType,
): UnsupportedFileReasonCode | null {
  if (resolvedType !== "unsupported") return null;
  const extension = extensionOf(fileName);
  if (LEGACY_OFFICE_EXTENSIONS.has(extension) || (!extension && LEGACY_OFFICE_MIMES.has(normalizedMime(mimeType)))) {
    return "LEGACY_OFFICE_FORMAT";
  }
  return "UNSUPPORTED_FILE_TYPE";
}
