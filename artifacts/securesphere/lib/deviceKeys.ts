import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const PREFIX = "securesphere_ecdh_private_";
type AuthenticatedRequest = (path: string, init?: RequestInit) => Promise<Response>;
const provisioning = new Map<string, Promise<void>>();

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  return bytes.slice().buffer;
};

const b64 = (bytes: ArrayBuffer | Uint8Array): string => {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  return btoa(String.fromCharCode(...array));
};

const fromB64 = (value: string): Uint8Array => {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
};

const storage = () => (Platform.OS === "web" ? window.localStorage : null);

async function save(id: string, value: string) {
  const s = storage();

  if (s) {
    s.setItem(PREFIX + id, value);
  } else {
    await SecureStore.setItemAsync(PREFIX + id, value);
  }
}

async function load(id: string) {
  const s = storage();

  return s ? s.getItem(PREFIX + id) : SecureStore.getItemAsync(PREFIX + id);
}

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure device keys are unavailable on this platform.");
  }

  return globalThis.crypto.subtle;
}

const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

/**
 * Derive a non-exportable HMAC key for blind search indexes from the device's
 * existing private ECDH key. The private key never leaves local secure storage.
 *
 * This application has no user-level master secret. Consequently this search
 * key is device-bound: another device, key rotation, or device-key loss cannot
 * reproduce existing tokens. Do not replace this with a user-id-derived key,
 * because a user ID is public and would make the blind index guessable.
 */
export async function deriveSearchHmacKey(userId: string): Promise<CryptoKey> {
  const stored = await load(userId);
  if (!stored) throw new Error("Secure device key is unavailable for encrypted search.");

  const privateKey = JSON.parse(stored).privateKey as JsonWebKey | undefined;
  if (!privateKey?.d) throw new Error("Secure device key is unavailable for encrypted search.");

  const material = await subtle().importKey(
    "raw",
    toArrayBuffer(fromBase64Url(privateKey.d)),
    "HKDF",
    false,
    ["deriveKey"],
  );

  return subtle().deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      // The user id is public, so it is only a context-binding salt. Security
      // comes from the device private scalar, which never leaves the device.
      salt: toArrayBuffer(new TextEncoder().encode(`SecureSphere/search/salt/v1/${userId}`)),
      // Keep this separate from every other HKDF use (for example, file-key
      // wrapping) and version it so a future token format cannot collide.
      info: toArrayBuffer(new TextEncoder().encode("SecureSphere/search/hmac-key/v1")),
    },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

export async function ensureDeviceKey(
  userId: string,
  options: { replace?: boolean } = {},
): Promise<{ publicKey: JsonWebKey }> {
  const existing = options.replace ? null : await load(userId);

  if (existing) {
    try {
      const record = JSON.parse(existing) as { privateKey?: JsonWebKey; publicKey?: JsonWebKey };
      if (record.privateKey?.d && record.publicKey?.kty === "EC" && record.publicKey.crv === "P-256") {
        return { publicKey: record.publicKey };
      }
    } catch {
      // Treat malformed local material as unusable. Never overwrite it with a
      // new key and accidentally hide a device-recovery problem.
    }
    throw new Error("The local secure device key is invalid. Clear this device's app data and sign in again.");
  }

  const pair = await subtle().generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"],
  );

  const record = {
    privateKey: await subtle().exportKey("jwk", pair.privateKey),
    publicKey: await subtle().exportKey("jwk", pair.publicKey),
  };

  await save(userId, JSON.stringify(record));

  return {
    publicKey: record.publicKey,
  };
}

function keyFingerprint(publicKey: JsonWebKey): string {
  if (publicKey.kty !== "EC" || publicKey.crv !== "P-256" || typeof publicKey.x !== "string" || typeof publicKey.y !== "string") {
    throw new Error("The device generated an invalid public key.");
  }
  return JSON.stringify({ kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, y: publicKey.y });
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && "error" in body && typeof body.error === "string"
    ? body.error
    : fallback;
}

/**
 * Ensure this signed-in device has a usable private key and its matching public
 * key is active on the API. Private key material never enters `request`.
 */
export function provisionDeviceKey(userId: string, request: AuthenticatedRequest): Promise<void> {
  const active = provisioning.get(userId);
  if (active) return active;

  const task = (async () => {
    const current = await request("/api/keys/me");
    if (current.ok) {
      const server = await current.json() as { publicKey?: JsonWebKey | string };
      if (!await load(userId)) {
        throw new Error("This device does not have the private key matching the active device key. Clear this device's app data and sign in again.");
      }
      const local = await ensureDeviceKey(userId);
      const serverKey = typeof server.publicKey === "string" ? JSON.parse(server.publicKey) as JsonWebKey : server.publicKey;
      if (!serverKey || keyFingerprint(local.publicKey) !== keyFingerprint(serverKey)) {
        throw new Error("This device does not have the private key matching the active device key. Clear this device's app data and sign in again.");
      }
      return;
    }
    if (current.status !== 404) {
      throw new Error(await errorMessage(current, "Could not check the active device key."));
    }

    // No active server key means a first run or a revoked key. Generate a fresh
    // local pair so a revoked public key is never reused.
    const { publicKey } = await ensureDeviceKey(userId, { replace: true });
    const registration = await request("/api/keys/register", {
      method: "POST",
      body: JSON.stringify({ publicKey }),
    });
    if (!registration.ok) {
      throw new Error(await errorMessage(registration, "Could not register this device key."));
    }
  })();

  provisioning.set(userId, task);
  return task.finally(() => provisioning.delete(userId));
}

export async function wrapFileKey(
  userId: string,
  recipientPublicKey: JsonWebKey,
  fileId: string,
  keyHex: string,
) {
  const stored = await load(userId);

  if (!stored) {
    throw new Error(
      "Encryption key unavailable on this device. This file cannot be shared from this device.",
    );
  }

  const record = JSON.parse(stored);

  if (!record.privateKey) {
    throw new Error(
      "Encryption key unavailable on this device. This file cannot be shared from this device.",
    );
  }

  const own = await subtle().importKey(
    "jwk",
    record.privateKey,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    false,
    ["deriveBits"],
  );

  const recipient = await subtle().importKey(
    "jwk",
    recipientPublicKey,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    false,
    [],
  );

  const secret = await subtle().deriveBits(
    {
      name: "ECDH",
      public: recipient,
    },
    own,
    256,
  );

  const material = await subtle().importKey(
    "raw",
    toArrayBuffer(new Uint8Array(secret)),
    "HKDF",
    false,
    ["deriveKey"],
  );

  const salt = new TextEncoder().encode(fileId);
  const info = new TextEncoder().encode("SecureSphere file-key wrap v1");

  const wrapping = await subtle().deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(info),
    },
    material,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const raw = Uint8Array.from(keyHex.match(/.{1,2}/g) ?? [], (x) =>
    parseInt(x, 16),
  );

  const ciphertext = await subtle().encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
    },
    wrapping,
    toArrayBuffer(raw),
  );

  return {
    wrappedFileKey: b64(ciphertext),
    wrappingIv: b64(iv),
    wrappingAlgorithm: "ECDH-P256/HKDF-SHA256/AES-256-GCM",
  };
}

/** Reverse wrapFileKey locally; no key material is sent to the API. */
export async function unwrapFileKey(userId: string, ownerPublicKey: JsonWebKey, fileId: string, wrappedFileKey: string, wrappingIv: string): Promise<string> {
  const stored = await load(userId);
  if (!stored) throw new Error("This device does not have the private key required for this share.");
  const record = JSON.parse(stored);
  const own = await subtle().importKey("jwk", record.privateKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const owner = await subtle().importKey("jwk", ownerPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await subtle().deriveBits({ name: "ECDH", public: owner }, own, 256);
  const material = await subtle().importKey("raw", toArrayBuffer(new Uint8Array(secret)), "HKDF", false, ["deriveKey"]);
  const wrapping = await subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: toArrayBuffer(new TextEncoder().encode(fileId)), info: toArrayBuffer(new TextEncoder().encode("SecureSphere file-key wrap v1")) }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const raw = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: toArrayBuffer(fromB64(wrappingIv)) }, wrapping, toArrayBuffer(fromB64(wrappedFileKey))));
  return Array.from(raw).map(x => x.toString(16).padStart(2, "0")).join("");
}
