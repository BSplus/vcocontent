import { isCreatorOriginal } from "./image-provenance";

export type AssetKind = "PHOTO" | "VIDEO";
export type AssetPurpose = "original" | "legacy_source" | "preview" | "thumbnail" | "raw" | "poster";

export function assetKind(type: string): AssetKind {
  if (type === "image") return "PHOTO";
  if (type === "video") return "VIDEO";
  throw new Error("Unsupported media identity");
}

export function assertAssetPurpose(kind: AssetKind, purpose: string): asserts purpose is AssetPurpose {
  if (!["original", "legacy_source", "preview", "thumbnail", "raw", "poster"].includes(purpose) ||
      (kind === "PHOTO" && purpose === "poster") || (kind === "VIDEO" && purpose === "raw"))
    throw new Error("Unsupported asset purpose");
}

/** Metadata coherence only; this never substitutes for byte/container safety validation. */
export function assertAssetObjectFormat(kind: AssetKind, purpose: AssetPurpose, key:string, mime:string) {
  assertAssetPurpose(kind,purpose);
  const match = /^(?:media|thumb)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.([a-z0-9]+)$/.exec(key);
  const formats:Record<string,string> = {jpg:"image/jpeg",png:"image/png",gif:"image/gif",webp:"image/webp",
    mp4:"video/mp4",mov:"video/quicktime",webm:"video/webm",dng:"image/x-adobe-dng",
    cr2:"image/x-canon-cr2",cr3:"image/x-canon-cr3",nef:"image/x-nikon-nef",arw:"image/x-sony-arw",
    raf:"image/x-fuji-raf",orf:"image/x-olympus-orf",rw2:"image/x-panasonic-rw2"};
  const extension = match?.[1] ?? "";
  const raw = ["dng","cr2","cr3","nef","arw","raf","orf","rw2"].includes(extension);
  const video = ["mp4","mov","webm"].includes(extension);
  const needsVideo = kind === "VIDEO" && ["original","legacy_source","preview"].includes(purpose);
  if (!match || formats[extension] !== mime || (purpose === "raw" ? !raw : raw || video !== needsVideo))
    throw new Error("Object format does not match its asset purpose");
}

export function assetTitle(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length > 200) throw new Error("Invalid asset title");
  return value.trim() || null;
}

/** Honest compatibility view: an optimized historical high file is not an original. */
export function legacyAssetVariants(item: {type:string;url:string;thumbnail:string}) {
  const kind = assetKind(item.type);
  return [
    {purpose: kind === "PHOTO" && isCreatorOriginal(item.url) ? "original" : "legacy_source",
      url:item.url, provenance:kind === "PHOTO" && isCreatorOriginal(item.url)
        ? "creator_original" : "legacy_available_source"},
    {purpose:kind === "VIDEO" ? "poster" : "thumbnail", url:item.thumbnail, provenance:"legacy_derivative"},
  ] as const;
}
