const encoder = new TextEncoder();

export function concat(...arrays) {
  const result = new Uint8Array(arrays.reduce((total, value) => total + value.byteLength, 0));
  let offset = 0;
  for (const value of arrays) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    result.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return result;
}

export function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(`${normalized}${"=".repeat((4 - normalized.length % 4) % 4)}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function toBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(keyData, value) {
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, value));
}

export async function hkdfExtract(salt, ikm) {
  return hmac(salt, ikm);
}

export async function hkdfExpand(prk, info, length) {
  const output = new Uint8Array(length);
  let previous = new Uint8Array();
  let offset = 0;
  let counter = 1;
  while (offset < length) {
    previous = await hmac(prk, concat(previous, info, new Uint8Array([counter++])));
    const take = Math.min(previous.length, length - offset);
    output.set(previous.subarray(0, take), offset);
    offset += take;
  }
  return output;
}

export async function deserializeVapidKeys({ publicKey, privateKey }) {
  return {
    publicKey: await crypto.subtle.importKey("raw", fromBase64Url(publicKey), { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]),
    privateKey: await crypto.subtle.importKey("pkcs8", fromBase64Url(privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]),
  };
}

async function createJwt(vapidKeys, endpoint, subject) {
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = toBase64Url(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  })));
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, vapidKeys.privateKey, encoder.encode(unsigned));
  return `${unsigned}.${toBase64Url(signature)}`;
}

export async function encryptAes128Gcm(payload, subscriptionKeys) {
  const userPublicBytes = fromBase64Url(subscriptionKeys.p256dh);
  const authSecret = fromBase64Url(subscriptionKeys.auth);
  const userPublicKey = await crypto.subtle.importKey("raw", userPublicBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const serverKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: userPublicKey }, serverKeys.privateKey, 256));
  const authPrk = await hkdfExtract(authSecret, sharedSecret);
  const keyInfo = concat(encoder.encode("WebPush: info\0"), userPublicBytes, serverPublicBytes);
  const ikm = await hkdfExpand(authPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, encoder.encode("Content-Encoding: nonce\0"), 12);
  const plaintext = concat(encoder.encode(payload), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));
  if (ciphertext.byteLength > 4080) throw new Error("Push payload is too large.");
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const body = concat(salt, recordSize, new Uint8Array([serverPublicBytes.byteLength]), serverPublicBytes, ciphertext);
  return { body, salt, serverPublicBytes };
}

export async function createPushRequest(vapidKeys, subscription, subject, payload) {
  const encrypted = await encryptAes128Gcm(payload, subscription.keys);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", vapidKeys.publicKey));
  const jwt = await createJwt(vapidKeys, subscription.endpoint, subject);
  return new Request(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${jwt}, k=${toBase64Url(publicKey)}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "86400",
      urgency: "normal",
    },
    body: encrypted.body,
  });
}

export async function sendPushNotification(vapidKeys, subscription, subject, payload) {
  return fetch(await createPushRequest(vapidKeys, subscription, subject, payload));
}
