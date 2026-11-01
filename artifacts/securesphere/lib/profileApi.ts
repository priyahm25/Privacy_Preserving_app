import { useAuthenticatedApi } from "./authenticatedApi";
import { verifyLocalDeviceKey } from "./deviceKeys";
import type { CheckStatus } from "./profileSecurity";

export interface ProfileSummary {
  storageBytes: number;
  files: { count: number; encryptedCount: number };
  shares: { count: number; wrappedKeyCount: number };
}

export function useProfileApi() {
  const { request } = useAuthenticatedApi();
  const getSummary = async (): Promise<ProfileSummary> => {
    const response = await request("/api/profile/summary");
    if (!response.ok) throw new Error(`Account summary request failed (${response.status}).`);
    return await response.json() as ProfileSummary;
  };
  const checkDeviceKey = async (userId: string): Promise<Exclude<CheckStatus, "not_applicable">> => {
    try {
      const response = await request("/api/keys/me");
      if (response.status === 404) return "failed";
      if (!response.ok) return "unknown";
      const data = await response.json() as { publicKey?: JsonWebKey | string };
      const publicKey = typeof data.publicKey === "string" ? JSON.parse(data.publicKey) as JsonWebKey : data.publicKey;
      return publicKey && await verifyLocalDeviceKey(userId, publicKey) ? "passed" : "failed";
    } catch {
      return "unknown";
    }
  };
  return { getSummary, checkDeviceKey };
}
