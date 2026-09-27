import { readMediaStream } from "./media-storage";

export async function analysisImageInput(url: string): Promise<string> {
  const key = /^\/api\/media\/files\/(thumb-[0-9a-f-]{36}\.webp)$/.exec(url)?.[1];
  if (!key) {
    if (/^https:\/\//.test(url) || /^data:image\/(jpeg|png|webp);base64,/.test(url)) return url;
    throw new Error("No analyzable image thumbnail");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of readMediaStream(key)) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 5 * 1024 * 1024) throw new Error("Thumbnail exceeds analysis limit");
    chunks.push(bytes);
  }
  return `data:image/webp;base64,${Buffer.concat(chunks).toString("base64")}`;
}