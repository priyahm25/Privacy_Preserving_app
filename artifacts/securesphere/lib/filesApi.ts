import { useAuthenticatedApi } from "./authenticatedApi";
import type { FileType } from "@/data/mockData";

export interface ShareRecipient {
  clerkId: string;
  name: string | null;
  email: string;
  permission: "viewer" | "editor";
  createdAt: string;
}

export interface SecureFileRecord {
  id: string;
  ownerId: string;
  name: string;
  mimeType: string;
  type: FileType;
  sizeBytes: number;
  encrypted: boolean;
  encryptionAlgorithm: string;
  scan: { verdict: "clean" | "flagged" | null; riskScore: number };
  createdAt: string;
  modifiedAt: string;
  shares?: ShareRecipient[];
  permission?: "viewer" | "editor";
  sharedAt?: string;
  sharedBy?: Pick<ShareRecipient, "clerkId" | "name" | "email">;
  /** Owned files only: true when the owner hid it from their Shared-by-Me list. */
  hiddenFromShared?: boolean;
  /** Shared-with-me files only: the owner's real filename when a personal rename is set. */
  originalName?: string;
  /** Shared-with-me files only: true when the current user set a personal name. */
  hasCustomName?: boolean;
}

export interface TeammateSummary {
  clerkId: string;
  name: string | null;
  email: string;
}

export interface DevicePublicKey {
  id: string;
  publicKey: JsonWebKey | string;
}

export interface KeySharePayload {
  wrappedFileKey: string;
  wrappingIv: string;
  wrappingAlgorithm: string;
  ownerPublicKey: JsonWebKey | string;
  ownerDeviceKeyId: string;
  recipientDeviceKeyId: string;
  fileIv: string;
}

export interface FileDetailsResponse {
  file: SecureFileRecord;
  isOwner: boolean;
  sharedWith: ShareRecipient[];
}

export interface SearchFilesResponse {
  files: SecureFileRecord[];
  nextPage: number | null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parsePublicKey(value: JsonWebKey | string): JsonWebKey {
  return typeof value === "string" ? JSON.parse(value) as JsonWebKey : value;
}

export function useFilesApi() {
  const { request } = useAuthenticatedApi();
  const listFiles = async (): Promise<{ owned: SecureFileRecord[]; sharedWithMe: SecureFileRecord[] }> => {
    const response = await request("/api/files");
    if (!response.ok) throw new Error(`Failed to load files (${response.status}).`);
    const data = await response.json();
    return { owned: data.owned ?? [], sharedWithMe: data.sharedWithMe ?? [] };
  };
  const getFile = async (id: string): Promise<FileDetailsResponse> => {
    const response = await request(`/api/files/${id}`);
    if (!response.ok) throw new Error(`Failed to load file (${response.status}).`);
    return await response.json();
  };
  const listTeammates = async (): Promise<TeammateSummary[]> => {
    const response = await request("/api/teammates/list");
    if (!response.ok) return [];
    return (await response.json()).teammates ?? [];
  };
  const getMyDeviceKey = async (publicKey?: JsonWebKey): Promise<DevicePublicKey> => {
    const response = publicKey
      ? await request("/api/keys/register", { method: "POST", body: JSON.stringify({ publicKey }) })
      : await request("/api/keys/me");
    if (!response.ok) throw new Error("Your active device key is unavailable.");
    return await response.json();
  };
  const getTeammateDeviceKey = async (userId: string): Promise<DevicePublicKey> => {
    const response = await request(`/api/keys/teammates/${userId}`);
    if (!response.ok) throw new Error("This teammate has no active secure device key.");
    const value = await response.json();
    return { ...value, publicKey: parsePublicKey(value.publicKey) };
  };
  const createSecureShare = async (fileId: string, payload: {
    recipientId: string; recipientDeviceKeyId: string; ownerDeviceKeyId: string;
    wrappedFileKey: string; wrappingIv: string; wrappingAlgorithm: string;
    permission?: "viewer" | "editor";
  }): Promise<void> => {
    const response = await request(`/api/files/${fileId}/share`, { method: "POST", body: JSON.stringify(payload) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to create secure share (${response.status}).`);
    }
  };
  const getKeyShare = async (fileId: string): Promise<KeySharePayload> => {
    const response = await request(`/api/files/${fileId}/key-share`);
    if (!response.ok) throw new Error("The secure key share is unavailable.");
    const value = await response.json();
    return { ...value, ownerPublicKey: parsePublicKey(value.ownerPublicKey) };
  };
  const downloadCiphertext = async (fileId: string): Promise<Uint8Array> => {
    const response = await request(`/api/files/${fileId}/content`);
    if (!response.ok) throw new Error(`Failed to download ciphertext (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const searchFiles = async (tokens: string[], mode: "AND" | "OR", page = 0, pageSize = 25): Promise<SearchFilesResponse> => {
    const response = await request("/api/files/search", { method: "POST", body: JSON.stringify({ tokens, mode, page, pageSize }) });
    if (!response.ok) throw new Error(`Failed to search files (${response.status}).`);
    const data = await response.json();
    return { files: data.files ?? [], nextPage: typeof data.nextPage === "number" ? data.nextPage : null };
  };
  const parseError = async (response: Response, fallback: string): Promise<string> => {
    const body = await response.json().catch(() => ({}));
    return body?.error || fallback;
  };
  // Owner renames the file (extension preserved server-side). Owner-only.
  const renameFile = async (id: string, filename: string): Promise<void> => {
    const response = await request(`/api/files/${id}`, { method: "PATCH", body: JSON.stringify({ filename }) });
    if (!response.ok) throw new Error(await parseError(response, "Could not rename the file."));
  };
  // Recipient sets their personal display name for a shared file.
  const setDisplayName = async (id: string, name: string): Promise<void> => {
    const response = await request(`/api/files/${id}/display-name`, { method: "PATCH", body: JSON.stringify({ name }) });
    if (!response.ok) throw new Error(await parseError(response, "Could not rename the file."));
  };
  // Owner "Delete for Me": hide from own Shared-by-Me list; keeps file + shares.
  const hideFromShared = async (id: string): Promise<void> => {
    const response = await request(`/api/files/${id}/hide`, { method: "POST" });
    if (!response.ok) throw new Error(await parseError(response, "Could not update the file."));
  };
  // Recipient "Delete for Me": revoke only the current user's access.
  const removeSharedWithMe = async (id: string): Promise<void> => {
    const response = await request(`/api/files/${id}/share/me`, { method: "DELETE" });
    if (!response.ok) throw new Error(await parseError(response, "Could not remove the shared file."));
  };
  // Owner "Delete for Everyone": delete the file and revoke all shares.
  const deleteFile = async (id: string): Promise<boolean> => (await request(`/api/files/${id}`, { method: "DELETE" })).ok;
  return { listFiles, getFile, listTeammates, getMyDeviceKey, getTeammateDeviceKey, createSecureShare, getKeyShare, downloadCiphertext, searchFiles, renameFile, setDisplayName, hideFromShared, removeSharedWithMe, deleteFile };
}
