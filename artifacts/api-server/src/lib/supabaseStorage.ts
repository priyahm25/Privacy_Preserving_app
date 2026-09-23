import crypto from "node:crypto";

/**
 * Supabase Storage client for encrypted file objects.
 *
 * This module is the ONLY place file bytes leave this process, and by contract
 * every byte that passes through it is already AES-256-GCM ciphertext. Nothing
 * here ever sees a key or a plaintext buffer:
 *
 *   - Client file-encryption keys are not available to this process and are
 *     never sent to Supabase in any form (not in a header, path, or metadata).
 *   - Object keys are random UUIDs, never derived from the filename, so the
 *     bucket listing leaks nothing about what a file contains or is called.
 *   - The bucket must be PRIVATE. We only ever talk to it with the service-role
 *     key over the server-side REST API; no public URL is generated and no
 *     signed URL is handed to the client, so downloads are mediated by the API
 *     for authorization while decryption remains on the client.
 *
 * Deliberately written against the Storage REST API with `fetch` rather than
 * pulling in `@supabase/supabase-js`: fewer dependencies handling ciphertext,
 * and the exact request shape stays auditable.
 */

const DEFAULT_BUCKET = "secure-files";

export interface StorageConfig {
  url: string;
  serviceKey: string;
  bucket: string;
}

export class StorageOperationError extends Error {
  constructor(
    message: string,
    public readonly context: {
      operation: "upload" | "download" | "delete";
      bucket: string;
      path: string;
      status: number;
      detail: string;
    },
  ) {
    super(message);
    this.name = "StorageOperationError";
  }
}

/**
 * Read and validate config. Throws with actionable text rather than letting a
 * half-configured server accept an upload it cannot store.
 */
export function getStorageConfig(): StorageConfig {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_BUCKET?.trim() || DEFAULT_BUCKET;

  if (!url) {
    throw new Error(
      "SUPABASE_URL is not set. It looks like https://<project-ref>.supabase.co",
    );
  }

  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Use the service-role key (server-side only - " +
        "never the anon key, and never an EXPO_PUBLIC_ variable).",
    );
  }

  return { url, serviceKey, bucket };
}

/** True when Storage is usable, without throwing. */
export function isStorageConfigured(): boolean {
  try {
    getStorageConfig();
    return true;
  } catch {
    return false;
  }
}

function authHeaders(config: StorageConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.serviceKey}`,
    apikey: config.serviceKey,
  };
}

/**
 * Build an opaque object key. The filename is intentionally NOT part of the
 * path - a bucket listing must not reveal that a user stored
 * "2026 salary review.pdf". The owner prefix is metadata Supabase already holds
 * in the `owner_clerk_id` column and makes per-user Storage policies possible.
 */
export function buildObjectPath(ownerClerkId: string): string {
  const safeOwner = ownerClerkId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${safeOwner}/${crypto.randomUUID()}.enc`;
}

function objectUrl(config: StorageConfig, path: string): string {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodedPath}`;
}

/**
 * Upload an encrypted blob.
 *
 * `blob` must already be ciphertext. Content type is always
 * application/octet-stream: telling Storage the original MIME type would leak
 * what the plaintext is, and the object is opaque bytes as far as Supabase is
 * concerned.
 */
export async function uploadEncryptedObject(
  path: string,
  blob: Buffer,
): Promise<void> {
  const config = getStorageConfig();

  const response = await fetch(objectUrl(config, path), {
    method: "POST",
    headers: {
      ...authHeaders(config),
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      // Refuse to silently overwrite an existing object.
      "x-upsert": "false",
    },
    body: new Uint8Array(blob),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new StorageOperationError(
      `Supabase Storage upload failed (${response.status}). ${detail}`.trim(),
      { operation: "upload", bucket: config.bucket, path, status: response.status, detail },
    );
  }
}

/** Download an encrypted blob. The caller decrypts; this returns raw ciphertext. */
export async function downloadEncryptedObject(path: string): Promise<Buffer> {
  const config = getStorageConfig();

  const response = await fetch(objectUrl(config, path), {
    method: "GET",
    headers: authHeaders(config),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new StorageOperationError(
      `Supabase Storage download failed (${response.status}). ${detail}`.trim(),
      { operation: "download", bucket: config.bucket, path, status: response.status, detail },
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Delete an object. Used both for real deletions and to roll back an upload
 * whose database insert failed - an orphaned blob in the bucket would be a
 * ciphertext nobody can account for.
 */
export async function deleteEncryptedObject(path: string): Promise<void> {
  const config = getStorageConfig();

  const response = await fetch(objectUrl(config, path), {
    method: "DELETE",
    headers: authHeaders(config),
  });

  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => "");
    throw new StorageOperationError(
      `Supabase Storage delete failed (${response.status}). ${detail}`.trim(),
      { operation: "delete", bucket: config.bucket, path, status: response.status, detail },
    );
  }
}
