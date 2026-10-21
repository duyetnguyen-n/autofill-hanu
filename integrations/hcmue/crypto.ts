import { fingerprintInput, type EncryptedBox } from "./protocol";
const enc = new TextEncoder(),
  dec = new TextDecoder();
function b64(bytes: ArrayBuffer | Uint8Array) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let result = "";
  for (const b of array) result += String.fromCharCode(b);
  return btoa(result);
}
function bytes(value: string) {
  return Uint8Array.from(atob(value), (v) => v.charCodeAt(0));
}
export const newReplyKey = () =>
  b64(crypto.getRandomValues(new Uint8Array(32)));
export async function fingerprint(jwk: JsonWebKey) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", enc.encode(fingerprintInput(jwk))),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .match(/.{1,4}/g)!
    .join(" ");
}
export async function identityKeys() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  );
  return {
    publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
    privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
}
export async function seal(
  key: string,
  value: unknown,
  aad: string,
): Promise<EncryptedBox> {
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    cryptoKey = await crypto.subtle.importKey(
      "raw",
      bytes(key),
      "AES-GCM",
      false,
      ["encrypt"],
    );
  return {
    iv: b64(iv),
    data: b64(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: enc.encode(aad) },
        cryptoKey,
        enc.encode(JSON.stringify(value)),
      ),
    ),
  };
}
export async function open<T>(
  key: string,
  box: EncryptedBox,
  aad: string,
): Promise<T> {
  if (box.data.length > 3_000_000) throw new Error("Thông điệp quá lớn.");
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    bytes(key),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return JSON.parse(
    dec.decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes(box.iv), additionalData: enc.encode(aad) },
        cryptoKey,
        bytes(box.data),
      ),
    ),
  );
}
export async function box(publicKey: JsonWebKey, value: unknown, aad: string) {
  const key = newReplyKey(),
    encrypted = await seal(key, value, aad),
    rsa = await crypto.subtle.importKey(
      "jwk",
      publicKey,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    );
  return {
    ...encrypted,
    key: b64(await crypto.subtle.encrypt("RSA-OAEP", rsa, bytes(key))),
  };
}
export async function unbox<T>(
  privateKey: JsonWebKey,
  value: EncryptedBox,
  aad: string,
) {
  if (!value.key) throw new Error("Thiếu khóa thông điệp.");
  const rsa = await crypto.subtle.importKey(
      "jwk",
      privateKey,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"],
    ),
    key = await crypto.subtle.decrypt("RSA-OAEP", rsa, bytes(value.key));
  return open<T>(b64(key), value, aad);
}
