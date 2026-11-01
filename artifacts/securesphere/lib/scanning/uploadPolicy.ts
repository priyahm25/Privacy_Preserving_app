import type { ScanVerdict } from "./verdict";

export type UploadScanVerdict = ScanVerdict;

/**
 * Upload proceeds only after a completed scan returned an explicit SAFE
 * (the BENIGN outcome). MALICIOUS, UNCERTAIN, CORRUPTED, UNSUPPORTED and
 * ERROR are all blocked.
 */
export function isUploadScanApproved(
  verdict: UploadScanVerdict,
): verdict is "SAFE" {
  return verdict === "SAFE";
}
