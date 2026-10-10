import { Client } from "@replit/object-storage";
import { randomUUID } from "crypto";
import { Readable } from "stream";

const client = new Client();
const pattern = /^reference-[0-9a-f-]{36}\.(csv|xlsx|pdf|jpg|jpeg|png|webp)$/;
export function referenceSourceKey(name: string) {
  const extension = name.toLowerCase().split(".").pop();
  if (!extension || !["csv", "xlsx", "pdf", "jpg", "jpeg", "png", "webp"].includes(extension)) {
    throw new Error("Use CSV, XLSX, PDF, JPEG, PNG or WebP.");
  }
  return `reference-${randomUUID()}.${extension}`;
}
function assertKey(key: string) {
  if (!pattern.test(key)) throw new Error("Invalid reference source");
}
export async function storeReferenceSource(key: string, bytes: Buffer) {
  assertKey(key);
  const result = await client.uploadFromBytes(key, bytes);
  if (!result.ok) throw new Error("Reference source could not be stored. Please retry.");
}
export async function deleteReferenceSource(key: string) {
  assertKey(key);
  const result = await client.delete(key, { ignoreNotFound: true });
  if (!result.ok) throw new Error("Reference source cleanup failed");
}
export function readReferenceSource(key: string): Readable {
  assertKey(key);
  return client.downloadAsStream(key);
}
