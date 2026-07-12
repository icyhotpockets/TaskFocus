import test from "node:test";
import assert from "node:assert/strict";
import {
  concat,
  createPushRequest,
  hkdfExpand,
  hkdfExtract,
  toBase64Url,
} from "../src/webpush.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("RFC 8291 aes128gcm request decrypts to the original payload", async () => {
  const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const receiverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const subscription = {
    endpoint: "https://push.example.test/send/abc",
    keys: { p256dh: toBase64Url(receiverPublic), auth: toBase64Url(auth) },
  };
  const payload = JSON.stringify({ title: "TaskFocus test", body: "aes128gcm arrived" });
  const request = await createPushRequest(vapid, subscription, "mailto:test@example.com", payload);
  assert.equal(request.headers.get("content-encoding"), "aes128gcm");
  assert.match(request.headers.get("authorization"), /^vapid t=.+, k=.+$/);

  const body = new Uint8Array(await request.arrayBuffer());
  const salt = body.slice(0, 16);
  assert.equal(new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false), 4096);
  const keyLength = body[20];
  assert.equal(keyLength, 65);
  const serverPublicBytes = body.slice(21, 21 + keyLength);
  const ciphertext = body.slice(21 + keyLength);
  const serverPublicKey = await crypto.subtle.importKey("raw", serverPublicBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: serverPublicKey }, receiver.privateKey, 256));
  const authPrk = await hkdfExtract(auth, shared);
  const ikm = await hkdfExpand(authPrk, concat(encoder.encode("WebPush: info\0"), receiverPublic, serverPublicBytes), 32);
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, encoder.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  assert.equal(decrypted.at(-1), 2);
  assert.equal(decoder.decode(decrypted.slice(0, -1)), payload);
});
