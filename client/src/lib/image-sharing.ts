export type SharingAsset = { kind: "media" | "event"; id: number };
export const sharingLimit = 5 * 1024 * 1024;
export const sharingTimeout = 12_000;

export function supportsImageSharing(): boolean {
  try {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [new File(["test"], "preview.webp", { type: "image/webp" })] });
  } catch { return false; }
}

async function boundedBody(response: Response, signal: AbortSignal): Promise<Blob> {
  if (!response.ok || !response.body) throw new Error("The public preview could not be loaded. Please try again.");
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!mime || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime))
    throw new Error("This preview format cannot be shared as an image.");
  if (Number(response.headers.get("content-length")) > sharingLimit) {
    await response.body.cancel();
    throw new Error("This preview is too large to share.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > sharingLimit) throw new Error("This preview is too large to share.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw new Error("The public preview is empty.");
  const blob = new Blob(chunks, { type: mime });
  // Reject HTML/error payloads incorrectly labelled as images before handing a file to another app.
  await new Promise<void>((resolve, reject) => {
    const aborted = () => reject(new DOMException("Image preparation cancelled", "AbortError"));
    signal.addEventListener("abort", aborted, { once: true });
    void createImageBitmap(blob).then(bitmap => {
      bitmap.close(); resolve();
    }, () => reject(new Error("The public preview could not be decoded. Please try again.")))
      .finally(() => signal.removeEventListener("abort", aborted));
  });
  signal.throwIfAborted();
  return blob;
}

export async function prepareSharingImage(asset: SharingAsset, signal: AbortSignal) {
  const descriptor = await fetch(`/api/sharing/${asset.kind}/${asset.id}`, {
    credentials: "omit", cache: "no-store", signal, redirect: "error",
  });
  if (!descriptor.ok) throw new Error("A public image preview is not available for this item.");
  const selected = await descriptor.json();
  if (typeof selected.image !== "string" || !/^\/(?:api\/(?:sharing\/media\/[1-9]\d*\/image$|events\/[1-9]\d*\/thumbnail\?)|brand\/vco-social\.jpg$|attached_assets\/)/.test(selected.image))
    throw new Error("The public preview address is not supported.");
  const imageUrl = new URL(selected.image, location.origin);
  if (imageUrl.origin !== location.origin) throw new Error("The public preview address is not supported.");
  const response = await fetch(imageUrl, { credentials: "omit", cache: "no-store", signal });
  if (new URL(response.url).origin !== location.origin) throw new Error("The public preview address is not supported.");
  const blob = await boundedBody(response, signal);
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[blob.type]!;
  const file = new File([blob], `vco-${asset.kind}-${asset.id}.${extension}`, { type: blob.type });
  if (!navigator.canShare({ files: [file] })) throw new Error("Your device cannot share this image file. Use Copy Link or an available download option instead.");
  return { file, credit: typeof selected.credit === "string" ? selected.credit : undefined };
}
