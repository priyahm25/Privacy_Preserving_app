export interface ProfileFileState {
  ownerClerkId: string;
  sizeBytes: number | null;
  encrypted: boolean;
  iv: string;
}

export interface ProfileShareState {
  ownerClerkId: string;
  wrappedFileKey: string | null;
  wrappingIv: string | null;
  wrappingAlgorithm: string | null;
}

export function summarizeProfileState(
  clerkId: string,
  files: ProfileFileState[],
  shares: ProfileShareState[],
) {
  const ownedFiles = files.filter((file) => file.ownerClerkId === clerkId);
  const ownedShares = shares.filter((share) => share.ownerClerkId === clerkId);
  return {
    storageBytes: ownedFiles.reduce((total, file) => total + (Number.isSafeInteger(file.sizeBytes) && (file.sizeBytes ?? 0) > 0 ? file.sizeBytes! : 0), 0),
    files: {
      count: ownedFiles.length,
      encryptedCount: ownedFiles.filter((file) => file.encrypted && /^[0-9a-f]{24}$/i.test(file.iv)).length,
    },
    shares: {
      count: ownedShares.length,
      wrappedKeyCount: ownedShares.filter((share) => Boolean(share.wrappedFileKey && share.wrappingIv && share.wrappingAlgorithm)).length,
    },
  };
}
