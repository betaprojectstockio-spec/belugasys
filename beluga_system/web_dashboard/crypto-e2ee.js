/**
 * Tarayici tarafi E2EE yardimcisi (Web Crypto API / SubtleCrypto).
 * Local Agent tarafindaki crypto_utils.py ile BIREBIR AYNI anahtar
 * turetme (PBKDF2-HMAC-SHA256, 200000 iterasyon, ayni statik salt)
 * ve AES-256-GCM sifreleme semasini kullanir.
 */

const BELUGA_SALT = new TextEncoder().encode("beluga-e2ee-salt-v1");
const PBKDF2_ITERATIONS = 200000;

async function deriveKey(pairingSecret) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pairingSecret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: BELUGA_SALT, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function encryptPayload(key, dataObj) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(dataObj));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext);
  return { nonce: bufToB64(nonce), ciphertext: bufToB64(ciphertext) };
}

async function decryptPayload(key, payload) {
  const nonce = b64ToBuf(payload.nonce);
  const ciphertext = b64ToBuf(payload.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}
