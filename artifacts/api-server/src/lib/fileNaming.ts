// Pure filename helpers for rename. No imports, so they are unit-testable and
// used as the single source of truth by the rename route.

const MAX_NAME_LENGTH = 255;

/** The extension of a filename including the dot (".pdf"), or "" if none. */
export function fileExtension(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? "";
  const dot = leaf.lastIndexOf(".");
  // No extension for a dotless name or a dotfile like ".env".
  return dot > 0 ? leaf.slice(dot) : "";
}

export class RenameError extends Error {}

/**
 * Builds the new filename from the owner's requested base name, always keeping
 * the ORIGINAL file's extension. The request can't change the extension (which
 * would change the detected file type and break the format tabs): any
 * extension the user types that matches the original is ignored, and a
 * different one is treated as part of the base name.
 */
export function applyRename(originalFilename: string, requested: string): string {
  const ext = fileExtension(originalFilename);
  // Drop any path and control characters a client might send.
  let base = (requested ?? "").split(/[\\/]/).pop() ?? "";
  base = base.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  // If the user re-typed the original extension, strip it so it isn't doubled.
  if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) {
    base = base.slice(0, base.length - ext.length).trim();
  }
  if (!base) {
    throw new RenameError("The file name cannot be empty.");
  }
  const result = base + ext;
  if (result.length > MAX_NAME_LENGTH) {
    throw new RenameError(`The file name is too long (max ${MAX_NAME_LENGTH} characters).`);
  }
  return result;
}

/** Trim/validate a recipient's personal display name (no extension rules). */
export function sanitizeDisplayName(requested: string): string {
  const name = (requested ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!name) throw new RenameError("The display name cannot be empty.");
  if (name.length > MAX_NAME_LENGTH) {
    throw new RenameError(`The display name is too long (max ${MAX_NAME_LENGTH} characters).`);
  }
  return name;
}
