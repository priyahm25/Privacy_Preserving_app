/**
 * Main on-device file scanner.
 * Orchestrates: file type detection → local structure checks and
 * deterministic rules → LightGBM inference where a model exists.
 *
 * The plaintext file bytes are NEVER transmitted anywhere.
 * Only scan results (metadata) are returned to the caller.
 */

import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import type { LGBMModel } from "./lgbmInference";
import { detectFileType, getUnsupportedFileReason, type SupportedFileType } from "./fileTypeDetection";
import { scanFileBytes } from "./scanCore";
import type { ScanVerdict } from "./verdict";

export type { SupportedFileType } from "./fileTypeDetection";

export interface ScanResult {
  fileType: SupportedFileType;
  verdict: ScanVerdict;
  confidence: number;
  reasonCode?: string;
  findings?: string[];
  error?: string;
}

// Model cache — loaded once per session. Models are bundled JSON assets, so
// scanning works offline.
const modelCache: Partial<Record<"pdf" | "word", LGBMModel>> = {};

function loadModel(fileType: "pdf" | "word"): LGBMModel {
  if (!modelCache[fileType]) {
    modelCache[fileType] = fileType === "pdf"
      ? require("../../assets/models/pdf.json") as LGBMModel
      : require("../../assets/models/word.json") as LGBMModel;
  }
  return modelCache[fileType]!;
}

export { detectFileType } from "./fileTypeDetection";

let nextDiagnosticScanId = 1;

function logDevelopmentScan(event: string, details: Record<string, string | number | boolean | null>): void {
  if (__DEV__) {
    console.info("[SecureSphere scan]", event, details);
  }
}

function fileExtension(fileName: string): string {
  const leafName = fileName.split(/[\\/]/).pop() || "";
  const dot = leafName.lastIndexOf(".");
  return dot >= 0 ? leafName.slice(dot + 1).toLowerCase() : "";
}

/**
 * Read a local file URI as a Uint8Array.
 * Uses expo-file-system readAsStringAsync with base64 encoding.
 */
export async function readFileBytes(uri: string): Promise<Uint8Array> {
  // On web, DocumentPicker gives us a browser-readable URI/blob URL.
  // Use fetch() instead of expo-file-system because
  // readAsStringAsync() is not available on Expo Web.
  if (Platform.OS === "web") {
    const response = await fetch(uri);

    if (!response.ok) {
      throw new Error(`Unable to read selected file: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  // On Android/iOS, use Expo FileSystem.
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);

  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  return bytes;
}

/**
 * Scan a file for malware on the device.
 * @param fileUri - Local file:// URI from DocumentPicker
 * @param fileName - Original filename (for type detection)
 * @param fileSize - File size in bytes
 * @param mimeType - MIME type string (optional)
 * @returns ScanResult — verdict and confidence. File bytes are never transmitted.
 */
export async function scanFile(
  fileUri: string,
  fileName: string,
  fileSize: number,
  mimeType?: string,
): Promise<ScanResult> {
  const scanId = nextDiagnosticScanId++;
  const fileType = detectFileType(fileName, mimeType);
  logDevelopmentScan("type-detected", {
    scanId,
    extension: fileExtension(fileName) || null,
    reportedMimeType: mimeType || null,
    fileSizeBytes: Number.isFinite(fileSize) ? fileSize : null,
    detectedType: fileType,
  });

  const unsupportedReason = getUnsupportedFileReason(fileName, mimeType, fileType);
  if (unsupportedReason || fileType === "unsupported") {
    const result: ScanResult = { fileType, verdict: "UNSUPPORTED", confidence: 0, reasonCode: unsupportedReason ?? "UNSUPPORTED_FILE_TYPE" };
    logDevelopmentScan("scan-result", { scanId, verdict: result.verdict, reasonCode: result.reasonCode ?? null });
    return result;
  }

  let fileBytes: Uint8Array | null = null;
  try {
    // Read file bytes (plaintext stays on device)
    fileBytes = await readFileBytes(fileUri);
    const core = await scanFileBytes(fileBytes, fileType, loadModel);
    const result: ScanResult = { fileType, ...core };
    // Findings are rule codes only - never document content.
    logDevelopmentScan("scan-result", {
      scanId,
      verdict: result.verdict,
      confidence: result.confidence,
      reasonCode: result.reasonCode ?? null,
      findings: result.findings?.join(",") || null,
    });
    return result;
  } catch (error) {
    const result: ScanResult = {
      fileType,
      verdict: "ERROR",
      confidence: 0,
      reasonCode: "SCAN_ERROR",
      error: error instanceof Error ? error.message : String(error),
    };
    logDevelopmentScan("scan-result", { scanId, verdict: result.verdict, reasonCode: result.reasonCode ?? null });
    return result;
  } finally {
    // Explicitly clear plaintext bytes after local scanning.
    fileBytes?.fill(0);
  }
}
