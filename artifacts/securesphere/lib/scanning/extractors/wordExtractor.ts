/**
 * Word (.docx) feature extractor.
 * Extracts the 43 features expected by the trained Word LightGBM model.
 *
 * DOCX files are ZIP archives containing XML files.
 * We use fflate (pure JS) to unzip, then parse the XML.
 *
 * All extraction happens on-device.
 * Features with complex OLE dependencies default to 0 safely (see comments).
 *
 * IMPORTANT: Never transmit file content or features to any server.
 */

import { unzipSync } from "fflate";
import { ScanFormatError } from "../officeValidation";

export interface WordFeatures {
  ole_object_count: number;
  ole_object_type_count: number;
  macro_present: number;
  dde_present: number;
  vba_keywords_count: number;
  entropy: number;
  struct_ContentType: number;
  struct_PartName: number;
  file_size: number;
  struct_pos: number;
  struct_val: number;
  struct_typeface: number;
  struct_script: number;
  "path_/w-p": number;
  "path_w-r": number;
  "path_/w-r": number;
  "path_a-hlink": number;
  "path_w-p": number;
  "path_a-accent3": number;
  struct_ang: number;
  "path_/a-effectLst": number;
  "path_a-themeElements": number;
  struct_dist: number;
  "path_a-alpha": number;
  struct_Extension: number;
  "path_a-dk1": number;
  "path_a-ln": number;
  "path_/a-accent6": number;
  struct_w: number;
  struct_name: number;
  "path_a-lt2": number;
  "path_/a-outerShdw": number;
  "path_a-accent4": number;
  "path_/a-dk1": number;
  "path_a-accent1": number;
  "path_a-sysClr": number;
  "path_a-lt1": number;
  "path_/a-accent4": number;
  "struct_{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sz": number;
  "path_a-solidFill": number;
  "struct_{http://schemas.openxmlformats.org/wordprocessingml/2006/main}themeFill": number;
  "struct_{http://schemas.openxmlformats.org/wordprocessingml/2006/main}csb1": number;
  "struct_{http://schemas.openxmlformats.org/wordprocessingml/2006/main}styleId": number;
}

const VBA_KEYWORDS = [
  "AutoOpen",
  "AutoClose",
  "Document_Open",
  "Workbook_Open",
  "Shell",
  "CreateObject",
  "WScript",
  "PowerShell",
  "cmd.exe",
  "GetObject",
  "environ",
  "kill",
  "FileCopy",
  "URLDownloadToFile",
  "ADODB.Stream",
  "WinHttp",
  "RegWrite",
  "RegRead",
  "Exec",
];

function calculateEntropy(data: Uint8Array): number {
  const freq = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) freq[data[i]]++;
  const len = data.length;
  if (len === 0) return 0;
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (freq[i] > 0) {
      const p = freq[i] / len;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

function countOccurrences(text: string, pattern: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(pattern, pos)) !== -1) {
    count++;
    pos += pattern.length;
  }
  return count;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

export function extractWordFeatures(
  fileBytes: Uint8Array,
  fileSize: number,
): WordFeatures {
  // Base defaults — all 43 features default to 0
  const features: WordFeatures = {
    ole_object_count: 0,
    ole_object_type_count: 0,
    macro_present: 0,
    dde_present: 0,
    vba_keywords_count: 0,
    entropy: 0,
    struct_ContentType: 0,
    struct_PartName: 0,
    file_size: fileSize,
    struct_pos: 0,
    struct_val: 0,
    struct_typeface: 0,
    struct_script: 0,
    "path_/w-p": 0,
    "path_w-r": 0,
    "path_/w-r": 0,
    "path_a-hlink": 0,
    "path_w-p": 0,
    "path_a-accent3": 0,
    struct_ang: 0,
    "path_/a-effectLst": 0,
    "path_a-themeElements": 0,
    struct_dist: 0,
    "path_a-alpha": 0,
    struct_Extension: 0,
    "path_a-dk1": 0,
    "path_a-ln": 0,
    "path_/a-accent6": 0,
    struct_w: 0,
    struct_name: 0,
    "path_a-lt2": 0,
    "path_/a-outerShdw": 0,
    "path_a-accent4": 0,
    "path_/a-dk1": 0,
    "path_a-accent1": 0,
    "path_a-sysClr": 0,
    "path_a-lt1": 0,
    "path_/a-accent4": 0,
    "struct_{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sz": 0,
    "path_a-solidFill": 0,
    "struct_{http://schemas.openxmlformats.org/wordprocessingml/2006/main}themeFill": 0,
    "struct_{http://schemas.openxmlformats.org/wordprocessingml/2006/main}csb1": 0,
    "struct_{http://schemas.openxmlformats.org/wordprocessingml/2006/main}styleId": 0,
  };

  // Compute entropy of raw file bytes
  features.entropy = calculateEntropy(fileBytes);

  // DOCX is a ZIP archive — attempt to unzip
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(fileBytes);
  } catch {
    // If unzip fails, it may be a legacy .doc (OLE compound) or corrupt
    // Return what we have — the model fills missing with 0
    throw new ScanFormatError("CORRUPTED", "The Word document is not a readable DOCX package.");
  }

  const fileNames = Object.keys(files);
  if (!files["[Content_Types].xml"] || !files["word/document.xml"]) {
    throw new ScanFormatError("CORRUPTED", "The DOCX package is missing required document parts.");
  }

  // macro_present: check for vbaProject.bin or macros/ directory
  features.macro_present = fileNames.some(
    (f) => f.includes("vbaProject.bin") || f.includes("macros/"),
  )
    ? 1
    : 0;

  // Process [Content_Types].xml for struct_ContentType and struct_PartName
  const ctXml = files["[Content_Types].xml"];
  if (ctXml) {
    const ctText = decodeUtf8(ctXml);
    features.struct_ContentType = countOccurrences(ctText, "ContentType=");
    features.struct_PartName = countOccurrences(ctText, "PartName=");
  }

  // Process word/document.xml for main content features
  const docXml = files["word/document.xml"];
  if (docXml) {
    const docText = decodeUtf8(docXml);

    // DDE detection: DDEAUTO or DDE in document
    features.dde_present =
      docText.includes("DDEAUTO") || docText.includes("DDE ") ? 1 : 0;

    // Path counts in document XML
    features["path_/w-p"] = countOccurrences(docText, "</w:p>");
    features["path_w-r"] = countOccurrences(docText, "<w:r>");
    features["path_/w-r"] = countOccurrences(docText, "</w:r>");
    features["path_w-p"] = countOccurrences(docText, "<w:p>");

    // Struct attribute counts
    features.struct_pos = countOccurrences(docText, "pos=");
    features.struct_val = countOccurrences(docText, "val=");
    features.struct_w = countOccurrences(docText, " w=");
    features.struct_name = countOccurrences(docText, " name=");
    features[
      "struct_{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sz"
    ] = countOccurrences(docText, "w:sz=") + countOccurrences(docText, "w:sz ");
    features[
      "struct_{http://schemas.openxmlformats.org/wordprocessingml/2006/main}themeFill"
    ] = countOccurrences(docText, "w:themeFill");
    features[
      "struct_{http://schemas.openxmlformats.org/wordprocessingml/2006/main}csb1"
    ] = countOccurrences(docText, "w:csb1");
    features[
      "struct_{http://schemas.openxmlformats.org/wordprocessingml/2006/main}styleId"
    ] = countOccurrences(docText, "w:styleId");
  }

  // Process word/styles.xml or word/theme/theme1.xml for theme features
  const themeXml =
    files["word/theme/theme1.xml"] || files["ppt/theme/theme1.xml"];
  if (themeXml) {
    const themeText = decodeUtf8(themeXml);
    features["path_a-accent3"] = countOccurrences(themeText, "<a:accent3>");
    features["path_a-themeElements"] = countOccurrences(
      themeText,
      "<a:themeElements>",
    );
    features["path_/a-effectLst"] = countOccurrences(
      themeText,
      "<a:effectLst>",
    );
    features["path_a-alpha"] = countOccurrences(themeText, "<a:alpha");
    features["path_a-dk1"] = countOccurrences(themeText, "<a:dk1>");
    features["path_a-ln"] = countOccurrences(themeText, "<a:ln");
    features["path_/a-accent6"] = countOccurrences(themeText, "</a:accent6>");
    features["path_a-lt2"] = countOccurrences(themeText, "<a:lt2>");
    features["path_/a-outerShdw"] = countOccurrences(
      themeText,
      "</a:outerShdw>",
    );
    features["path_a-accent4"] = countOccurrences(themeText, "<a:accent4>");
    features["path_/a-dk1"] = countOccurrences(themeText, "</a:dk1>");
    features["path_a-accent1"] = countOccurrences(themeText, "<a:accent1>");
    features["path_a-sysClr"] = countOccurrences(themeText, "<a:sysClr");
    features["path_a-lt1"] = countOccurrences(themeText, "<a:lt1>");
    features["path_/a-accent4"] = countOccurrences(themeText, "</a:accent4>");
    features["path_a-solidFill"] = countOccurrences(themeText, "<a:solidFill>");
    features.struct_ang = countOccurrences(themeText, "ang=");
    features.struct_dist = countOccurrences(themeText, "dist=");
    features.struct_typeface = countOccurrences(themeText, "typeface=");
    features.struct_script = countOccurrences(themeText, "script=");
  }

  // Process word/styles.xml for font/style attributes
  const stylesXml = files["word/styles.xml"];
  if (stylesXml) {
    const stylesText = decodeUtf8(stylesXml);
    features.struct_Extension = countOccurrences(stylesText, "Extension");
    features["path_a-hlink"] = countOccurrences(stylesText, "hlink");
  }

  // OLE object detection
  let oleCount = 0;
  const oleTypes = new Set<string>();
  for (const fname of fileNames) {
    if (
      fname.includes("embeddings/") ||
      fname.includes(".bin") ||
      fname.endsWith(".emf")
    ) {
      oleCount++;
    }
    if (fname.includes("embeddings/")) {
      const ext = fname.split(".").pop() || "";
      oleTypes.add(ext);
    }
  }
  features.ole_object_count = oleCount;
  features.ole_object_type_count = oleTypes.size;

  // VBA keywords: scan vbaProject.bin as raw bytes
  const vbaFile = files["word/vbaProject.bin"];
  if (vbaFile) {
    features.macro_present = 1;
    const vbaText = String.fromCharCode(
      ...vbaFile.subarray(0, Math.min(vbaFile.length, 100000)),
    );
    let kwCount = 0;
    for (const kw of VBA_KEYWORDS) {
      kwCount += countOccurrences(vbaText, kw);
    }
    features.vba_keywords_count = kwCount;
  }

  return features;
}
