import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

const enc = new TextEncoder();
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const un64 = (value) => new Uint8Array(Buffer.from(value, "base64"));
const info = enc.encode("SecureSphere/chat/ECDH-P256/AES-256-GCM-wrap/v1");
const wrap = async (messageId, senderPrivate, recipientPublic, rawKey) => {
  const shared = await webcrypto.subtle.deriveBits({ name: "ECDH", public: recipientPublic }, senderPrivate, 256);
  const material = await webcrypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode(`SecureSphere/chat/message-key/v1/${messageId}`), info }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  return { wrappedKey: b64(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, rawKey)), wrappingIv: b64(iv) };
};
const unwrap = async (messageId, recipientPrivate, senderPublic, copy) => {
  const shared = await webcrypto.subtle.deriveBits({ name: "ECDH", public: senderPublic }, recipientPrivate, 256);
  const material = await webcrypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode(`SecureSphere/chat/message-key/v1/${messageId}`), info }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  return webcrypto.subtle.decrypt({ name: "AES-GCM", iv: un64(copy.wrappingIv) }, key, un64(copy.wrappedKey));
};

test("AES-GCM message encrypt/decrypt and per-device wrapping work across multiple devices", async () => {
  const sender = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const senderOtherDevice = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const recipient = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const recipientOtherDevice = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const devices = [sender, senderOtherDevice, recipient, recipientOtherDevice];
  const messageId = webcrypto.randomUUID();
  const rawKey = webcrypto.getRandomValues(new Uint8Array(32));
  const wraps = await Promise.all(devices.map((device) => wrap(messageId, sender.privateKey, device.publicKey, rawKey)));
  assert.equal(wraps.length, 4);
  for (let i = 0; i < devices.length; i++) assert.deepEqual(new Uint8Array(await unwrap(messageId, devices[i].privateKey, sender.publicKey, wraps[i])), rawKey);
  const aes = await webcrypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode("Hello, encrypted world")));
  const recipientAes = await webcrypto.subtle.importKey("raw", await unwrap(messageId, recipient.privateKey, sender.publicKey, wraps[2]), { name: "AES-GCM" }, false, ["decrypt"]);
  assert.equal(new TextDecoder().decode(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, recipientAes, cipher)), "Hello, encrypted world");
});

test("unrelated private key and modified ciphertext fail authenticated decryption", async () => {
  const sender = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const recipient = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const unrelated = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const messageId = webcrypto.randomUUID(); const rawKey = webcrypto.getRandomValues(new Uint8Array(32));
  const copy = await wrap(messageId, sender.privateKey, recipient.publicKey, rawKey);
  await assert.rejects(() => unwrap(messageId, unrelated.privateKey, sender.publicKey, copy));
  const aes = await webcrypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12)); const cipher = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode("secret")));
  cipher[0] ^= 1;
  await assert.rejects(() => webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, cipher));
});
