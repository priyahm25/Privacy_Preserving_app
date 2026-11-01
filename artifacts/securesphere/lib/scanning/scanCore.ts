/**
 * Format-specific scanning of in-memory bytes, shared by the app scanner and
 * the tests. Every path ends in SAFE (benign), MALICIOUS or UNCERTAIN, or in
 * CORRUPTED / UNSUPPORTED / ERROR - and only SAFE may be encrypted and uploaded.
 *
 *   TXT   deterministic rules only (no text model exists)
 *   PDF   structure rules + LightGBM PDF model
 *   DOCX  bounded unzip + OOXML rules + LightGBM Word model
 *   PPTX  bounded unzip + OOXML rules only (no PowerPoint model exists)
 */
import { buildFeatureVector, lgbmPredict, type LGBMModel } from "./lgbmInference";
import { extractPDFFeatures } from "./extractors/pdfExtractor";
import { extractWordFeatures } from "./extractors/wordExtractor";
import { ScanFormatError } from "./officeValidation";
import { safeUnzip, scanOoxmlPackage } from "./ooxmlScan";
import { analyzePdf } from "./pdfStructure";
import { scanTextBytes } from "./textScanCore";
import { combineVerdict, type ScanVerdict } from "./verdict";
import type { SupportedFileType } from "./fileTypeDetection";

export interface CoreScanResult {
  verdict: ScanVerdict;
  /** Model probability of malicious; 0 when no model ran. */
  confidence: number;
  reasonCode: string;
  findings?: string[];
  error?: string;
}

export type ModelLoader = (type: "pdf" | "word") => LGBMModel | Promise<LGBMModel>;

const MESSAGES: Partial<Record<ScanVerdict, string>> = {
  MALICIOUS: "The file contains content that is known to be dangerous or was flagged by the on-device model.",
  UNCERTAIN: "The file contains active or uninspectable content, or the model score is inconclusive. It needs further inspection before it can be shared.",
};

function withMessage(result: CoreScanResult): CoreScanResult {
  return result.verdict in MESSAGES && !result.error ? { ...result, error: MESSAGES[result.verdict] } : result;
}

export async function scanFileBytes(
  bytes: Uint8Array,
  fileType: Exclude<SupportedFileType, "unsupported">,
  loadModel: ModelLoader,
): Promise<CoreScanResult> {
  if (fileType === "text") return scanTextBytes(bytes);
  if (bytes.byteLength === 0) {
    return { verdict: "CORRUPTED", confidence: 0, reasonCode: "EMPTY_FILE", error: "The selected file is empty and cannot be validated." };
  }
  try {
    if (fileType === "pdf") {
      const analysis = analyzePdf(bytes);
      const model = await loadModel("pdf");
      const probability = lgbmPredict(model, buildFeatureVector(model, extractPDFFeatures(bytes, bytes.byteLength, analysis) as unknown as Record<string, number>));
      return withMessage(combineVerdict(analysis.findings, probability, "PDF"));
    }
    const files = safeUnzip(bytes);
    if (fileType === "powerpoint") {
      return withMessage(combineVerdict(scanOoxmlPackage(files, "pptx"), null, "PPTX"));
    }
    const findings = scanOoxmlPackage(files, "docx");
    const model = await loadModel("word");
    const probability = lgbmPredict(model, buildFeatureVector(model, extractWordFeatures(bytes, bytes.byteLength) as unknown as Record<string, number>));
    return withMessage(combineVerdict(findings, probability, "DOCX"));
  } catch (error) {
    if (error instanceof ScanFormatError) {
      return {
        verdict: error.verdict,
        confidence: 0,
        reasonCode: error.verdict === "UNSUPPORTED" ? `${fileType.toUpperCase()}_NOT_INSPECTABLE` : `${fileType.toUpperCase()}_FORMAT_INVALID`,
        error: error.message,
      };
    }
    // Model loading, extraction and inference failures never become SAFE.
    return { verdict: "ERROR", confidence: 0, reasonCode: "SCAN_ERROR", error: error instanceof Error ? error.message : String(error) };
  }
}
