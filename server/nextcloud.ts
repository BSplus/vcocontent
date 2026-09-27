import { createHash, randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { unlink, stat } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable, Transform } from "stream";
import { XMLParser } from "fast-xml-parser";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { nextcloudFiles, nextcloudJobs, insertMediaItemSchema } from "@shared/schema";
import { storage } from "./storage";
import { mediaPolicy, MediaLimitError } from "./media-policy";
import { createMediaKeys, uploadMedia } from "./media-storage";
import { analysisImageInput } from "./image-analysis";
import { generateTagsForImage, categorizeContent, isAITaggingConfigured } from "./utils/ai-tagger";

export class NextcloudError extends Error {}
export type SourceInput = { link: string; password?: string };
type Source = { root: URL; auth: string };
type Found = { href: URL; name: string; bytes: number };
const MAX_FILES = Math.min(500, mediaPolicy.eventCount);
const MAX_BYTES = Math.min(500 * 1048576, mediaPolicy.eventBytes);
const MAX_DIRS = 300;
const MAX_MS = 10 * 60 * 1000;
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
const mime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

function instance(): URL {
  const value = process.env.NEXTCLOUD_BASE_URL;
  if (!value) throw new NextcloudError("Nextcloud ist noch nicht vom Betreiber eingerichtet.");
  let url: URL;
  try { url = new URL(value); } catch { throw new NextcloudError("Nextcloud-Konfiguration ist ungültig."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.hostname)
    throw new NextcloudError("Nextcloud-Konfiguration benötigt eine HTTPS-Basisadresse.");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}

function prefix(base: URL): string {
  return base.pathname === "/" ? "" : base.pathname.replace(/\/+$/, "");
}

function safePath(url: URL, base: URL): void {
  if (url.origin !== base.origin || url.username || url.password || !url.pathname.startsWith(prefix(base) + "/") ||
      /%(?:2f|5c|00|25(?:2e|2f|5c))/i.test(url.pathname) || url.pathname.split("/").some(part => {
        let decoded: string;
        try { decoded = decodeURIComponent(part); } catch { return true; }
        return decoded === "." || decoded === ".." || decoded.includes("\\") || decoded.includes("/");
      })) throw new NextcloudError("Nicht unterstützter oder unsicherer Nextcloud-Pfad.");
}

export function resolveSource(input: SourceInput): Source {
  const base = instance();
  if (input.link.length > 2048 || (input.password?.length ?? 0) > 256)
    throw new NextcloudError("Nextcloud-Link oder Freigabepasswort ist zu lang.");
  let link: URL;
  try { link = new URL(input.link); } catch { throw new NextcloudError("Bitte einen gültigen Nextcloud-Ordnerlink angeben."); }
  if (link.protocol !== "https:" || link.origin !== base.origin || link.username || link.password || link.hash)
    throw new NextcloudError("Nur HTTPS-Ordnerlinks der eingerichteten Nextcloud-Instanz sind erlaubt.");
  safePath(link, base);
  const relative = link.pathname.slice(prefix(base).length);
  const share = /^\/(?:index\.php\/)?s\/([A-Za-z0-9_-]+)\/?$/.exec(relative);
  if (share) {
    if (Array.from(link.searchParams.keys()).some(key => key !== "path"))
      throw new NextcloudError("Dieser Freigabelink wird nicht unterstützt.");
    const folder = link.searchParams.get("path") || "/";
    const parts = folder.split("/").filter(Boolean);
    if (parts.some(part => part === "." || part === ".." || part.includes("\\")))
      throw new NextcloudError("Ungültiger Unterordner.");
    const root = new URL(`${prefix(base)}/public.php/dav/files/${share[1]}/${parts.map(encodeURIComponent).join("/")}${parts.length ? "/" : ""}`, base);
    safePath(root, base);
    return { root, auth: "Basic " + Buffer.from(`${share[1]}:${input.password || ""}`).toString("base64") };
  }
  const username = process.env.NEXTCLOUD_USERNAME;
  const password = process.env.NEXTCLOUD_APP_PASSWORD;
  if (!username || !password || /[/\\]/.test(username))
    throw new NextcloudError("Interner Nextcloud-Zugang ist noch nicht eingerichtet.");
  let folder: string;
  const dav = /^\/remote\.php\/dav\/files\/([^/]+)(\/.*)?$/.exec(relative);
  if (dav) {
    if (decodeURIComponent(dav[1]) !== username || link.search)
      throw new NextcloudError("Interner Link gehört nicht zum eingerichteten Nextcloud-Konto.");
    folder = dav[2] || "/";
  } else if (/^\/apps\/files\/files\/\d+\/?$/.test(relative)) {
    if (Array.from(link.searchParams.keys()).some(key => key !== "dir") || !link.searchParams.has("dir"))
      throw new NextcloudError("Interner Ordnerlink benötigt einen dir-Pfad.");
    folder = link.searchParams.get("dir") || "/";
  } else throw new NextcloudError("Nur Nextcloud-Freigaben und interne Ordnerlinks werden unterstützt.");
  const parts = folder.split("/").filter(Boolean).map(part => {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { throw new NextcloudError("Ungültiger Ordnerpfad."); }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\"))
      throw new NextcloudError("Ungültiger Ordnerpfad.");
    return encodeURIComponent(decoded);
  });
  const root = new URL(`${prefix(base)}/remote.php/dav/files/${encodeURIComponent(username)}/${parts.join("/")}${parts.length ? "/" : ""}`, base);
  safePath(root, base);
  return { root, auth: "Basic " + Buffer.from(`${username}:${password}`).toString("base64") };
}

async function request(url: URL, source: Source, method: string, signal?: AbortSignal): Promise<Response> {
  const base = instance();
  safePath(url, base);
  // Every DAV href must stay beneath its selected folder, including encoded segments.
  if (url.pathname !== source.root.pathname && !url.pathname.startsWith(source.root.pathname.replace(/\/$/, "") + "/"))
    throw new NextcloudError("Datei liegt außerhalb des ausgewählten Ordners.");
  const response = await fetch(url, {
    method, redirect: "manual", signal: signal ?? AbortSignal.timeout(20000),
    headers: { Authorization: source.auth, ...(method === "PROPFIND" ? { Depth: "1", "Content-Type": "application/xml" } : {}) },
    ...(method === "PROPFIND" ? { body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>' } : {}),
  });
  if (response.status === 401 || response.status === 403) throw new NextcloudError("Kein Zugriff auf den Nextcloud-Ordner. Freigabepasswort oder Konto prüfen.");
  if (response.status === 404) throw new NextcloudError("Nextcloud-Ordner nicht gefunden.");
  if (!response.ok) throw new NextcloudError(`Nextcloud-Abruf fehlgeschlagen (HTTP ${response.status}).`);
  return response;
}

async function bounded(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new NextcloudError("Nextcloud lieferte keine Daten.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of Readable.fromWeb(response.body as any)) {
    size += chunk.length;
    if (size > limit) throw new NextcloudError("Nextcloud-Antwort überschreitet die Größenbegrenzung.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function discover(inputs: SourceInput[]): Promise<{ sources: Source[]; files: Found[]; skipped: number }> {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 10)
    throw new NextcloudError("Bitte 1 bis 10 Ordnerlinks angeben.");
  const sources = inputs.map(resolveSource);
  const files: Found[] = [];
  let skipped = 0, directories = 0, bytes = 0;
  const deadline = AbortSignal.timeout(60000);
  const seen = new Set<string>();
  for (const source of sources) {
    const queue = [source.root];
    const visited = new Set<string>();
    while (queue.length) {
      const folder = queue.shift()!;
      if (visited.has(folder.pathname)) continue;
      visited.add(folder.pathname);
      if (++directories > MAX_DIRS) throw new NextcloudError("Zu viele Unterordner (maximal 300).");
      const response = await request(folder, source, "PROPFIND", deadline);
      const xml = (await bounded(response, 2 * 1048576)).toString("utf8");
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new NextcloudError("Ungültige Nextcloud-Ordnerantwort.");
      const document = parser.parse(xml);
      const rows = document.multistatus?.response;
      if (!rows) throw new NextcloudError("Nextcloud lieferte keine gültige Ordnerliste.");
      for (const row of Array.isArray(rows) ? rows : [rows]) {
        if (typeof row.href !== "string") continue;
        const href = new URL(row.href, folder.origin);
        safePath(href, instance());
        if (href.pathname !== source.root.pathname && !href.pathname.startsWith(source.root.pathname.replace(/\/$/, "") + "/"))
          throw new NextcloudError("Nextcloud-Antwort verweist außerhalb des Ordners.");
        if (href.search || href.hash) throw new NextcloudError("Ungültiger Dateilink in Nextcloud-Antwort.");
        if (href.pathname.replace(/\/$/, "") === folder.pathname.replace(/\/$/, "")) continue;
        const propstat = Array.isArray(row.propstat) ? row.propstat.find((p: any) => String(p.status).includes(" 200 ")) : row.propstat;
        const prop = propstat?.prop;
        if (!prop) { skipped++; continue; }
        if (prop.resourcetype?.collection !== undefined) { queue.push(href); continue; }
        const name = decodeURIComponent(href.pathname.split("/").pop() || "").slice(0, 200);
        const ext = name.toLowerCase().split(".").pop() || "";
        if (!mime[ext]) { skipped++; continue; }
        const length = Number(prop.getcontentlength);
        if (!Number.isSafeInteger(length) || length < 1 || length > mediaPolicy.imageBytes) { skipped++; continue; }
        const key = createHash("sha256").update(href.href).digest("hex");
        if (seen.has(key)) continue;
        seen.add(key);
        if (files.length >= MAX_FILES || bytes + length > MAX_BYTES)
          throw new NextcloudError("Importgrenze erreicht (500 Bilder oder 500 MiB).");
        bytes += length;
        files.push({ href, name, bytes: length });
      }
    }
  }
  return { sources, files, skipped };
}

export async function importStatus(eventId: number) {
  const [job] = await db.select().from(nextcloudJobs).where(eq(nextcloudJobs.eventId, eventId));
  const files = await db.select({ name: nextcloudFiles.name, status: nextcloudFiles.status,
    message: nextcloudFiles.message, aiWarning: nextcloudFiles.aiWarning })
    .from(nextcloudFiles).where(eq(nextcloudFiles.eventId, eventId)).orderBy(nextcloudFiles.id).limit(500);
  return { status: job?.status || "idle", error: job?.error, total: files.length,
    imported: files.filter(f => f.status === "saved").length,
    skipped: (job?.skipped || 0) + files.filter(f => f.status === "skipped").length,
    failed: files.filter(f => f.status === "error").length,
    warnings: files.filter(f => f.aiWarning).length, files };
}

export async function startImport(eventId: number, inputs: SourceInput[]): Promise<void> {
  const { sources, files, skipped } = await discover(inputs);
  await db.insert(nextcloudJobs).values({ eventId }).onConflictDoNothing();
  const [locked] = await db.update(nextcloudJobs).set({ status: "running", skipped, error: null, updatedAt: new Date() })
    .where(and(eq(nextcloudJobs.eventId, eventId), sql`(${nextcloudJobs.status} != 'running' or ${nextcloudJobs.updatedAt} < now() - interval '30 seconds')`)).returning();
  if (!locked) throw new NextcloudError("Für dieses Album läuft bereits ein Import.");
  try {
    for (const file of files) {
      const sourceKey = createHash("sha256").update(file.href.href).digest("hex");
      await db.insert(nextcloudFiles).values({ eventId, sourceKey, name: file.name }).onConflictDoNothing();
    }
  } catch {
    await db.update(nextcloudJobs).set({ status: "error", error: "Importliste konnte nicht gespeichert werden." })
      .where(eq(nextcloudJobs.eventId, eventId));
    throw new NextcloudError("Importliste konnte nicht gespeichert werden.");
  }
  void runImport(eventId, sources, files).catch(async () => {
    await db.update(nextcloudJobs).set({ status: "error", error: "Import unterbrochen. Bitte mit denselben Links erneut starten.", updatedAt: new Date() })
      .where(eq(nextcloudJobs.eventId, eventId));
  });
}

async function runImport(eventId: number, sources: Source[], files: Found[]) {
  const started = Date.now();
  let failed = 0, downloaded = 0;
  const heartbeat = setInterval(() => {
    void db.update(nextcloudJobs).set({ updatedAt: new Date() }).where(eq(nextcloudJobs.eventId, eventId)).catch(() => {});
  }, 10000);
  heartbeat.unref();
  try {
  for (const file of files) {
    if (Date.now() - started > MAX_MS) throw new NextcloudError("Import-Zeitlimit erreicht.");
    const source = sources.find(s => file.href.pathname === s.root.pathname || file.href.pathname.startsWith(s.root.pathname.replace(/\/$/, "") + "/"))!;
    const key = createHash("sha256").update(file.href.href).digest("hex");
    await db.insert(nextcloudFiles).values({ eventId, sourceKey: key, name: file.name }).onConflictDoNothing();
    const [record] = await db.select().from(nextcloudFiles).where(and(eq(nextcloudFiles.eventId, eventId), eq(nextcloudFiles.sourceKey, key)));
    if (record.status === "saved" && record.mediaId) continue;
    if (record.status !== "pending") {
      await db.update(nextcloudFiles).set({ status: "pending", mediaId: null, message: null, aiWarning: null })
        .where(eq(nextcloudFiles.id, record.id));
    }
    const tmp = path.join(tmpdir(), `nextcloud-${randomUUID()}`);
    let reservation: string | undefined;
    try {
      const response = await request(file.href, source, "GET");
      if (Number(response.headers.get("content-length")) > mediaPolicy.imageBytes || !response.body)
        throw new MediaLimitError("Bild überschreitet das Dateilimit.");
      let received = 0;
      await pipeline(Readable.fromWeb(response.body as any), new Transform({
        transform(chunk, _enc, cb) {
          received += chunk.length;
          downloaded += chunk.length;
          cb(received > mediaPolicy.imageBytes || downloaded > MAX_BYTES
            ? new MediaLimitError("Bild oder gesamter Import überschreitet das Datenlimit.") : null, chunk);
        },
      }), createWriteStream(tmp));
      const ext = file.name.toLowerCase().split(".").pop()!;
      const fileUpload = { path: tmp, size: (await stat(tmp)).size, mimetype: mime[ext] } as Express.Multer.File;
      const keys = createMediaKeys(fileUpload.mimetype);
      reservation = randomUUID();
      await storage.reserveMedia(reservation, eventId, null, 4 * 1048576 + 100 * 1024, keys.storageKey, keys.thumbnailKey);
      const saved = await uploadMedia(fileUpload, "image", keys);
      const item = await storage.finishMedia(reservation, insertMediaItemSchema.parse({
        eventId, type: "image", url: saved.url, thumbnail: saved.thumbnail, storedBytes: saved.storedBytes,
        objectCount: saved.objectCount, caption: file.name, tags: [], isPremium: false,
      }), record.id);
      reservation = undefined;
      try {
        if (!isAITaggingConfigured()) throw new Error("not configured");
        const tags = await generateTagsForImage(await analysisImageInput(item.thumbnail));
        if (!tags.length) throw new Error("no matching tags");
        await storage.updateMediaItem(item.id, { tags, category: await categorizeContent(tags) });
      } catch {
        await db.update(nextcloudFiles).set({ aiWarning: "KI-Analyse nicht verfügbar oder fehlgeschlagen; Bild noch nicht analysiert." }).where(eq(nextcloudFiles.id, record.id));
      }
    } catch (error) {
      const [current] = await db.select({ status: nextcloudFiles.status }).from(nextcloudFiles).where(eq(nextcloudFiles.id, record.id));
      if (current?.status !== "saved") {
        failed++;
        await db.update(nextcloudFiles).set({ status: "error", message: error instanceof MediaLimitError ? error.message : "Datei konnte nicht importiert werden." })
          .where(eq(nextcloudFiles.id, record.id));
      }
    } finally {
      if (reservation) await storage.abandonMedia(reservation).catch(() => {});
      await unlink(tmp).catch(() => {});
      await db.update(nextcloudJobs).set({ updatedAt: new Date() }).where(eq(nextcloudJobs.eventId, eventId));
    }
  }
  await db.update(nextcloudJobs).set({ status: failed ? "partial" : "completed", updatedAt: new Date() }).where(eq(nextcloudJobs.eventId, eventId));
  } finally {
    clearInterval(heartbeat);
  }
}