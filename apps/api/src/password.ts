import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  return deriveKey(password, salt).then(key => `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`);
}

export async function verifyPassword(password: string, encoded: string) {
  const [scheme, saltText, keyText] = encoded.split("$");
  if (scheme !== "scrypt" || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, "base64url");
  const actual = await deriveKey(password, Buffer.from(saltText, "base64url"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function deriveKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key as Buffer)));
}
