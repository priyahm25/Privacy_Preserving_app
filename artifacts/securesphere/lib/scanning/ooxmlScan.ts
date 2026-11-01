/**
 * DOCX / PPTX package inspection: bounded ZIP extraction, required-part
 * validation, and deterministic checks for active or external content.
 * Pure (fflate only) so it runs in tests under plain Node.
 */
import { unzipSync, type UnzipFileInfo } from "fflate";
import { ScanFormatError } from "./officeValidation";
import type { ScanFinding } from "./verdict";

export type OoxmlKind = "docx" | "pptx";

export const ZIP_LIMITS = {
  maxEntries: 2000,
  maxEntryBytes: 50 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  /** Uncompressed/compressed ratio above which an entry is treated as a bomb. */
  maxRatio: 200,
};

/**
 * Unzips only after the central directory passes the size limits, then checks
 * the real decompressed sizes too (headers can lie). Throws ScanFormatError.
 */
export function safeUnzip(bytes: Uint8Array, limits = ZIP_LIMITS): Record<string, Uint8Array> {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ScanFormatError("CORRUPTED", "The file is not an Office Open XML (ZIP) package.");
  }
  const entries: UnzipFileInfo[] = [];
  try {
    unzipSync(bytes, { filter: (info) => { entries.push(info); return false; } });
  } catch {
    throw new ScanFormatError("CORRUPTED", "The Office package is not a readable ZIP archive.");
  }
  if (entries.length === 0 || entries.length > limits.maxEntries) {
    throw new ScanFormatError("UNSUPPORTED", "The Office package has too many parts to inspect safely.");
  }
  let declared = 0;
  for (const entry of entries) {
    declared += entry.originalSize;
    const ratio = entry.size > 0 ? entry.originalSize / entry.size : 0;
    if (entry.originalSize > limits.maxEntryBytes || declared > limits.maxTotalBytes || ratio > limits.maxRatio) {
      throw new ScanFormatError("UNSUPPORTED", "The Office package expands beyond safe inspection limits (possible ZIP bomb).");
    }
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    // Includes encrypted entries and unsupported compression methods.
    throw new ScanFormatError("CORRUPTED", "The Office package could not be decompressed for inspection.");
  }
  let actual = 0;
  for (const data of Object.values(files)) {
    actual += data.length;
    if (data.length > limits.maxEntryBytes || actual > limits.maxTotalBytes) {
      throw new ScanFormatError("UNSUPPORTED", "The Office package expands beyond safe inspection limits (possible ZIP bomb).");
    }
  }
  return files;
}

const REQUIRED: Record<OoxmlKind, { main: string; mainType: RegExp; part: RegExp }> = {
  docx: { main: "word/document.xml", mainType: /wordprocessingml\.document\.main\+xml/, part: /^word\/document\.xml$/ },
  pptx: { main: "ppt/presentation.xml", mainType: /presentationml\.presentation\.main\+xml/, part: /^ppt\/slides\/slide\d+\.xml$/ },
};

const EXECUTABLE_NAME = /\.(exe|dll|scr|com|bat|cmd|ps1|vbs|vbe|js|jse|wsf|wsh|hta|jar|msi|lnk|cpl|pif)$/i;
const DANGEROUS_SCHEME = /\b(ms-msdt|search-ms|ms-officecmd|ms-word|ms-excel|ms-powerpoint|mhtml|vbscript|javascript):/i;
const decoder = new TextDecoder("utf-8");

/** XML attribute value; XML allows single or double quotes and spaces around "=". */
function xmlAttr(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}\\s*=\\s*("|')([\\s\\S]*?)\\1`).exec(tag)?.[2] ?? null;
}

/** Validates the package and returns deterministic findings. Throws ScanFormatError when it can't be inspected. */
export function scanOoxmlPackage(files: Record<string, Uint8Array>, kind: OoxmlKind): ScanFinding[] {
  const names = Object.keys(files);
  const required = REQUIRED[kind];
  const contentTypes = files["[Content_Types].xml"] ? decoder.decode(files["[Content_Types].xml"]) : "";
  if (!contentTypes || !files[required.main] || !names.some((n) => required.part.test(n))) {
    throw new ScanFormatError("CORRUPTED", `The ${kind.toUpperCase()} package is missing required parts.`);
  }

  const findings: ScanFinding[] = [];
  const add = (severity: ScanFinding["severity"], code: string) => {
    if (!findings.some((f) => f.code === code)) findings.push({ severity, code });
  };

  if (!required.mainType.test(contentTypes)) add("uncertain", "OOXML_UNEXPECTED_MAIN_CONTENT_TYPE");
  if (/macroEnabled/i.test(contentTypes)) add("uncertain", "OOXML_MACRO_ENABLED_CONTENT_TYPE");

  for (const name of names) {
    const lower = name.toLowerCase();
    const data = files[name];
    if (EXECUTABLE_NAME.test(lower)) add("malicious", "OOXML_EMBEDDED_EXECUTABLE");
    if (data.length >= 2 && data[0] === 0x4d && data[1] === 0x5a) add("malicious", "OOXML_EMBEDDED_EXECUTABLE");
    if (lower.endsWith("vbaproject.bin") || lower.includes("/macros/")) add("uncertain", "OOXML_MACROS");
    if (lower.includes("/activex/")) add("uncertain", "OOXML_ACTIVEX");
    if (lower.includes("/embeddings/")) add("uncertain", "OOXML_EMBEDDED_OBJECT");
  }

  for (const name of names.filter((n) => n.endsWith(".rels"))) {
    const xml = decoder.decode(files[name]);
    for (const rel of xml.match(/<Relationship\b[^>]*>/g) ?? []) {
      const type = xmlAttr(rel, "Type") ?? "";
      const target = xmlAttr(rel, "Target") ?? "";
      if (DANGEROUS_SCHEME.test(target)) add("malicious", "OOXML_DANGEROUS_URI_SCHEME");
      if (xmlAttr(rel, "TargetMode") !== "External") continue;
      const kindOfRel = type.split("/").pop() ?? "";
      const remote = /^(https?:|\\\\|\/\/)/i.test(target);
      if (/^(attachedTemplate|oleObject|frame|subDocument|package)$/i.test(kindOfRel)) {
        // Remote templates/OLE links are the template-injection/Follina pattern;
        // a local template path (common in corporate documents) is only unexplained.
        add(remote ? "malicious" : "uncertain", "OOXML_EXTERNAL_ACTIVE_RELATIONSHIP");
      } else if (kindOfRel !== "hyperlink") {
        add("uncertain", "OOXML_EXTERNAL_RESOURCE");
      } else if (!/^(https?:|mailto:|#)/i.test(target)) {
        add("uncertain", "OOXML_NONWEB_HYPERLINK");
      }
    }
  }

  for (const name of names.filter((n) => n.endsWith(".xml") && (n.startsWith("word/") || n.startsWith("ppt/")))) {
    const xml = decoder.decode(files[name]);
    // DDE/DDEAUTO field codes run commands when fields update.
    if (/<w:instrText\b[^>]*>\s*DDE(AUTO)?\b/i.test(xml) || /w:instr\s*=\s*["']\s*DDE(AUTO)?\b/i.test(xml)) add("malicious", "DOCX_DDE_FIELD");
    if (/ppaction:\/\/program/i.test(xml)) add("malicious", "PPTX_RUN_PROGRAM_ACTION");
    if (/ppaction:\/\/macro/i.test(xml)) add("uncertain", "PPTX_MACRO_ACTION");
    if (/<(o:OLEObject|p:oleObj|w:object)\b/.test(xml)) add("uncertain", "OOXML_EMBEDDED_OBJECT");
    // URI schemes are checked only in relationship targets (real links), so a
    // document that merely mentions "javascript:" in its text is not flagged.
  }
  return findings;
}
