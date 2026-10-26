import JSZip from "jszip";

export type CreatorUsage = {
  bytes: number; photos: number; galleries: number; unknown: number;
  pendingCleanup: number; reservedBytes?: number;
  limits: { bytes: number; photos: number; galleries: number; imageBytes: number };
};
export type SelectionEntry = { file: File; error?: string; sourceBytes?: number };
const formats: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
// Matches resumable initiation's reservation, slightly above the 100-kB output.
export const PREVIEW_ALLOWANCE = 100 * 1024;
export const uploadBytesLabel = (bytes: number) => `${(bytes / 1_000_000).toFixed(2)} MB (${bytes.toLocaleString("en-US")} bytes)`;

/** Advisory only. Reservations and final quota enforcement remain server-side. */
export function creatorUploadPlan(files: { size: number; recovery?: boolean }[], usage?: CreatorUsage) {
  let bytes = usage ? Math.max(0, usage.limits.bytes - usage.bytes) : 0;
  let photos = usage ? Math.max(0, usage.limits.photos - usage.photos) : 0;
  return files.map(file => {
    if (file.recovery) return undefined; // Resolve the existing receipt, not a new allocation.
    if (!usage) return "Capacity could not be checked. Retry the capacity check before uploading.";
    if (usage.unknown) return usage.pendingCleanup
      ? "Storage cleanup is pending. Recheck capacity shortly."
      : "Some stored file sizes are unknown. Ask an administrator to check storage.";
    if (file.size > usage.limits.imageBytes) return `Image exceeds ${uploadBytesLabel(usage.limits.imageBytes)}.`;
    if (!photos) return "Photo allowance reached. Delete unwanted photos or ask for more capacity.";
    if (file.size + PREVIEW_ALLOWANCE > bytes)
      return "Not uploaded—storage allowance reached (including space for a preview).";
    photos--; bytes -= file.size + PREVIEW_ALLOWANCE;
    return undefined;
  });
}

/** Only use for a CONFIRMED rejection, never a lost/finalization response. */
export function creatorQuotaMessage(message: string) {
  return /your storage is full|maximum of [\d,]+ photos|storage cleanup is pending|storage usage needs an administrator check/i.test(message);
}

/** Bounded ZIP extraction; invalid members never discard accepted siblings. */
export async function creatorSelection(files: File[], limits: { imageBytes: number; zipBytes: number; zipCount: number }, existing: number) {
  const entries: SelectionEntry[] = [];
  const warnings: string[] = [];
  let accepted = existing, expanded = 0;
  const reject = (file: File, error: string, sourceBytes = file.size) => entries.push({ file, error, sourceBytes });
  const admit = (file: File) => {
    if (accepted >= limits.zipCount) return reject(file, `Selection limit reached: ${limits.zipCount} photos per batch. Upload this file in another batch.`);
    if (!formats[file.name.toLowerCase().split(".").pop() || ""] && !Object.values(formats).includes(file.type)) return reject(file, "Unsupported file. Creator galleries accept JPEG, PNG, GIF and WebP photos; no videos.");
    if (!file.size || file.size > limits.imageBytes) return reject(file, `Image must be between 1 byte and ${uploadBytesLabel(limits.imageBytes)}.`);
    accepted++; entries.push({ file });
  };
  for (const file of files) {
    if (!/\.zip$/i.test(file.name) && file.type !== "application/zip") { admit(file); continue; }
    if (file.size > limits.zipBytes) { reject(file, `ZIP exceeds ${uploadBytesLabel(limits.zipBytes)}.`); continue; }
    try {
      const archive = await JSZip.loadAsync(await file.arrayBuffer());
      const members = Object.values(archive.files).filter(member => !member.dir && !member.name.startsWith("__MACOSX/"));
      // Bound card count as well as extraction work for hostile archives.
      const maximum = Math.max(1, limits.zipCount * 2);
      if (members.length > maximum) warnings.push(`${file.name}: ${members.length - maximum} additional entries were not read. Split the archive into smaller batches.`);
      for (const member of members.slice(0, maximum)) {
        const declared = (member as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
        const mime = formats[member.name.toLowerCase().split(".").pop() || ""];
        const placeholder = () => new File([], `${file.name}/${member.name}`, { type: mime || "application/octet-stream" });
        if (!mime) { reject(placeholder(), "Unsupported ZIP member; only JPEG, PNG, GIF and WebP photos are accepted.", declared || 0); continue; }
        if (accepted >= limits.zipCount) { reject(placeholder(), `Selection limit reached: ${limits.zipCount} photos per batch.`, declared || 0); continue; }
        if (!Number.isSafeInteger(declared) || declared! < 1 || declared! > limits.imageBytes) {
          reject(placeholder(), `ZIP image exceeds the ${uploadBytesLabel(limits.imageBytes)} limit or has an invalid declared size.`, declared || 0); continue;
        }
        if (expanded + declared! > limits.zipBytes) {
          reject(placeholder(), `Combined ZIP expansion limit reached: ${uploadBytesLabel(limits.zipBytes)}.`, declared); continue;
        }
        // Charge attempted expansion even if a member is corrupt.
        expanded += declared!;
        try {
          const blob = await member.async("blob");
          if (blob.size !== declared) { reject(placeholder(), "ZIP image does not match its declared size.", declared); continue; }
          admit(new File([blob], `${file.name}/${member.name}`, { type: mime }));
        } catch { reject(placeholder(), "This ZIP image could not be read.", declared); }
      }
      if (!members.length) reject(file, "ZIP contains no files.");
    } catch { reject(file, "ZIP could not be read. Other selected files are unchanged."); }
  }
  return { entries, warnings };
}
