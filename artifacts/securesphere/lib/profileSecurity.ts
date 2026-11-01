export type CheckStatus = "passed" | "failed" | "unknown" | "not_applicable";
export interface SecurityCheck { id: string; label: string; points: number; status: CheckStatus; detail: string; }

export function calculateSecurityScore(input: {
  deviceKey: CheckStatus;
  fileCount: number | null;
  encryptedFileCount: number | null;
  shareCount: number | null;
  wrappedShareCount: number | null;
}): { score: number | null; checks: SecurityCheck[] } {
  const checks: SecurityCheck[] = [
    { id: "device-key", label: "This device key matches the active server key", points: 40, status: input.deviceKey, detail: input.deviceKey === "passed" ? "Local private key verified against the authenticated account's active public key." : input.deviceKey === "failed" ? "The local key is missing, unusable, or does not match the active account key." : "Could not verify the local and server device keys." },
    { id: "files-encrypted", label: "Owned files have encryption metadata", points: 35, status: input.fileCount === null ? "unknown" : input.fileCount === 0 ? "not_applicable" : input.encryptedFileCount === input.fileCount ? "passed" : "failed", detail: input.fileCount === null ? "File metadata could not be checked." : input.fileCount === 0 ? "No owned files to check." : `${input.encryptedFileCount ?? 0} of ${input.fileCount} files have encrypted metadata and a valid AES-GCM IV.` },
    { id: "shares-wrapped", label: "Owned shares have wrapped file-key metadata", points: 25, status: input.shareCount === null ? "unknown" : input.shareCount === 0 ? "not_applicable" : input.wrappedShareCount === input.shareCount ? "passed" : "failed", detail: input.shareCount === null ? "Share metadata could not be checked." : input.shareCount === 0 ? "No owned shares to check." : `${input.wrappedShareCount ?? 0} of ${input.shareCount} shares have wrapped-key metadata.` },
  ];
  const awarded = checks.reduce((sum, check) => sum + (check.status === "passed" ? check.points : 0), 0);
  return { score: checks.some((check) => check.status === "passed" || check.status === "failed") ? awarded : null, checks };
}

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(1)} ${units[index]}`;
}
