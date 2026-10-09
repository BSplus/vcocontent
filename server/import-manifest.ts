import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function key() {
  if (!process.env.SESSION_SECRET) throw new Error("Import recovery encryption is not configured");
  return createHash("sha256").update(`vco-import-v1:${process.env.SESSION_SECRET}`).digest();
}

export function encryptManifest(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString("base64")).join(".");
}

export function decryptManifest<T>(value: string): T {
  const [iv, tag, data] = value.split(".").map(v => Buffer.from(v, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
}
