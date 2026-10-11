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
import { nextcloudFiles, nextcloudJobs, mediaItems, mediaAnalysisJobs, insertMediaItemSchema } from "@shared/schema";
import { storage } from "./storage";
import { mediaPolicy, MediaLimitError } from "./media-policy";
import { createMediaKeys, uploadMedia, type MediaType } from "./media-storage";
import { enqueueAnalysis } from "./analysis-jobs";
import { encryptManifest, decryptManifest } from "./import-manifest";

export class NextcloudError extends Error {}
export type SourceInput = { link: string; password?: string };
type Source = { base: URL; root: URL; auth: string };
type Found = { href: URL; name: string; bytes: number; type: MediaType; mime: string };
const MAX_FILES = Math.min(500, mediaPolicy.eventCount);
const MAX_BYTES = Math.min(500 * 1048576, mediaPolicy.eventBytes);
const MAX_DIRS = 300;
const MAX_MS = 10 * 60 * 1000;
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
const mime: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};

function mediaForName(name: string): { type: MediaType; mime: string } | undefined {
  const contentType = mime[name.toLowerCase().split(".").pop() || ""];
  return contentType ? { type: contentType.startsWith("image/") ? "image" : "video", mime: contentType } : undefined;
}

const PUBLIC_INSTANCES = [
  new URL("https://nextcloud.bs-plus.de/"),
  new URL("https://nextcloud.vco-motorsports.com/"),
];

function instance(): URL | undefined {
  const value = process.env.NEXTCLOUD_BASE_URL;
  if (!value) return undefined;
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
  if (input.link.length > 2048 || (input.password?.length ?? 0) > 256)
    throw new NextcloudError("Nextcloud-Link oder Freigabepasswort ist zu lang.");
  let link: URL;
  try { link = new URL(input.link); } catch { throw new NextcloudError("Bitte einen gültigen Nextcloud-Ordnerlink angeben."); }
  if (link.protocol !== "https:" || link.username || link.password || link.hash)
    throw new NextcloudError("Nur sichere HTTPS-Ordnerlinks ohne Zugangsdaten im Link sind erlaubt.");
  // These public instances are trusted independently of account configuration.
  // Other hosts are accepted only when explicitly configured as the operator's instance.
  const configuredBase = instance();
  const publicBase = PUBLIC_INSTANCES.find(candidate => candidate.origin === link.origin);
  const base = publicBase &&
    (!configuredBase || configuredBase.origin !== link.origin ||
      !link.pathname.startsWith(prefix(configuredBase) + "/"))
    ? publicBase : configuredBase;
  if (!base || link.origin !== base.origin)
    throw new NextcloudError("Diese Nextcloud-Instanz wird nicht unterstützt.");
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
    return { base, root, auth: "Basic " + Buffer.from(`${share[1]}:${input.password || ""}`).toString("base64") };
  }
  if (!configuredBase || configuredBase.origin !== link.origin || prefix(configuredBase) !== prefix(base))
    throw new NextcloudError("Interner Nextcloud-Zugang ist noch nicht eingerichtet.");
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
  return { base, root, auth: "Basic " + Buffer.from(`${username}:${password}`).toString("base64") };
}

async function request(url: URL, source: Source, method: string, signal?: AbortSignal): Promise<Response> {
  safePath(url, source.base);
  // Every DAV href must stay beneath its selected folder, including encoded segments.
  if (url.pathname !== source.root.pathname && !url.pathname.startsWith(source.root.pathname.replace(/\/$/, "") + "/"))
    throw new NextcloudError("Datei liegt außerhalb des ausgewählten Ordners.");
  let response: Response;
  try {
    response = await fetch(url, {
      method, redirect: "manual", signal: signal ?? AbortSignal.timeout(20000),
      headers: { Authorization: source.auth, ...(method === "PROPFIND" ? { Depth: "1", "Content-Type": "application/xml" } : {}) },
      ...(method === "PROPFIND" ? { body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>' } : {}),
    });
  } catch {
    throw new NextcloudError("Nextcloud-Freigabe ist derzeit nicht erreichbar. Netzwerkverbindung prüfen.");
  }
  if (response.status >= 300 && response.status < 400)
    throw new NextcloudError("Nextcloud hat auf eine andere Adresse umgeleitet; die Freigabe kann nicht sicher abgerufen werden.");
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
        safePath(href, source.base);
        if (href.pathname !== source.root.pathname && !href.pathname.startsWith(source.root.pathname.replace(/\/$/, "") + "/"))
          throw new NextcloudError("Nextcloud-Antwort verweist außerhalb des Ordners.");
        if (href.search || href.hash) throw new NextcloudError("Ungültiger Dateilink in Nextcloud-Antwort.");
        if (href.pathname.replace(/\/$/, "") === folder.pathname.replace(/\/$/, "")) continue;
        const propstat = Array.isArray(row.propstat) ? row.propstat.find((p: any) => String(p.status).includes(" 200 ")) : row.propstat;
        const prop = propstat?.prop;
        if (!prop) { skipped++; continue; }
        if (prop.resourcetype?.collection !== undefined) { queue.push(href); continue; }
        const name = decodeURIComponent(href.pathname.split("/").pop() || "").slice(0, 200);
        const media = mediaForName(name);
        if (!media) { skipped++; continue; }
        const length = Number(prop.getcontentlength);
        if (prop.getcontentlength == null || !Number.isSafeInteger(length) || length < 1 ||
            length > (media.type === "image" ? mediaPolicy.imageBytes : mediaPolicy.videoBytes)) { skipped++; continue; }
        const key = createHash("sha256").update(href.href).digest("hex");
        if (seen.has(key)) continue;
        seen.add(key);
        if (files.length >= MAX_FILES || bytes + length > MAX_BYTES)
          throw new NextcloudError(`Importgrenze erreicht (${MAX_FILES} Medien oder ${Math.floor(MAX_BYTES / 1048576)} MiB).`);
        bytes += length;
        files.push({ href, name, bytes: length, ...media });
      }
    }
  }
  return { sources, files, skipped };
}

export async function importStatus(eventId: number) {
  const [job] = await db.select().from(nextcloudJobs).where(eq(nextcloudJobs.eventId, eventId));
  const files = await db.select({ name: nextcloudFiles.name, status: nextcloudFiles.status,
    message: nextcloudFiles.message, aiWarning: nextcloudFiles.aiWarning, mediaId: nextcloudFiles.mediaId,
    analysisStatus: mediaAnalysisJobs.status, analysisError: mediaAnalysisJobs.error })
    .from(nextcloudFiles).leftJoin(mediaAnalysisJobs, eq(nextcloudFiles.mediaId, mediaAnalysisJobs.mediaId))
    .where(eq(nextcloudFiles.eventId, eventId)).orderBy(nextcloudFiles.id).limit(500);
  const typedFiles = files.map(file => ({ ...file,
    aiWarning: file.analysisStatus && file.analysisStatus !== "failed" ? null : file.aiWarning,
    type: mediaForName(file.name)?.type }));
  return { status: job?.status || "idle", error: job?.error, total: files.length,
    imported: files.filter(f => f.status === "saved").length,
    importedImages: typedFiles.filter(f => f.status === "saved" && f.type === "image").length,
    importedVideos: typedFiles.filter(f => f.status === "saved" && f.type === "video").length,
    skipped: (job?.skipped || 0) + files.filter(f => f.status === "skipped").length,
    failed: files.filter(f => f.status === "error").length,
    warnings: typedFiles.filter(f => f.aiWarning || f.analysisStatus === "failed").length,
    analysisPending: files.filter(f => f.analysisStatus === "queued" || f.analysisStatus === "running").length,
    analysisCompleted: files.filter(f => f.analysisStatus === "completed").length,
    files: typedFiles };
}

type Manifest = { sources: { base: string; root: string; auth: string }[];
  files: (Omit<Found, "href"> & { href: string })[] };

export async function startImport(eventId: number, inputs: SourceInput[]): Promise<void> {
  const target = await storage.getEvent(eventId);
  if (!target || target.creatorId) throw new NextcloudError("Nextcloud imports are available for official VCO galleries only.");
  const { sources, files, skipped } = await discover(inputs);
  const manifest = encryptManifest({
    sources: sources.map(s => ({ base: s.base.href, root: s.root.href, auth: s.auth })),
    files: files.map(f => ({ ...f, href: f.href.href })),
  } satisfies Manifest);
  await db.transaction(async tx => {
    await tx.insert(nextcloudJobs).values({ eventId }).onConflictDoNothing();
    const [locked] = await tx.update(nextcloudJobs).set({ status: "queued", skipped, manifest,
      manifestExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      workerToken: null, error: null, updatedAt: new Date() })
      .where(and(eq(nextcloudJobs.eventId, eventId), sql`${nextcloudJobs.status} not in ('queued','running')`)).returning();
    if (!locked) throw new NextcloudError("Für dieses Album läuft bereits ein Import.");
    for (const file of files) {
      const sourceKey = createHash("sha256").update(file.href.href).digest("hex");
      await tx.insert(nextcloudFiles).values({ eventId, sourceKey, name: file.name }).onConflictDoNothing();
    }
  });
  startImportWorker();
  void kickImportWorker();
}

export async function resumeImport(eventId: number) {
  const [job] = await db.update(nextcloudJobs).set({ status: "queued", error: null, workerToken: null, updatedAt: new Date() })
    .where(and(eq(nextcloudJobs.eventId, eventId), sql`${nextcloudJobs.status} in ('partial', 'error') and ${nextcloudJobs.manifest} is not null
      and ${nextcloudJobs.manifestExpiresAt} > now()`)).returning();
  if (!job) throw new NextcloudError("Kein fortsetzbarer Import vorhanden. Bitte Links erneut prüfen.");
  startImportWorker();
  void kickImportWorker();
}

let workerTimer: NodeJS.Timeout | undefined;
let workerRunning = false;
const importsInFlight = new Set<Promise<unknown>>();
function kickImportWorker() {
  const work = drainImportQueue().catch(() => { console.error("Import queue unavailable"); return false; });
  importsInFlight.add(work);
  void work.finally(() => importsInFlight.delete(work));
  return work;
}
export function startImportWorker() {
  if (workerRunning) return;
  workerRunning = true;
  const tick = async () => {
    const active = await kickImportWorker();
    if (!workerRunning) return;
    workerTimer = setTimeout(tick, active ? 1000 : 30000);
    workerTimer.unref();
  };
  void tick();
}

export async function stopImportWorker() {
  workerRunning = false;
  if (workerTimer) clearTimeout(workerTimer);
  workerTimer = undefined;
  await Promise.allSettled(Array.from(importsInFlight));
}

export async function drainImportQueue() {
  const job = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(761021)`);
    await tx.execute(sql`update nextcloud_jobs set manifest=null, manifest_expires_at=null,
      status='error', worker_token=null, error='Gespeicherter Importzugang ist abgelaufen. Links erneut prüfen.'
      where manifest is not null and manifest_expires_at < now()`);
    const active = await tx.execute(sql`select count(*)::int as count from nextcloud_jobs where status='running'
      and updated_at >= now() - interval '90 seconds'`);
    if (Number(active.rows[0]?.count) >= 1) return undefined;
    const [row] = await tx.select().from(nextcloudJobs)
      .where(sql`${nextcloudJobs.manifest} is not null and (${nextcloudJobs.status}='queued' or
        (${nextcloudJobs.status}='running' and ${nextcloudJobs.updatedAt}<now()-interval '90 seconds'))`)
      .orderBy(nextcloudJobs.updatedAt).limit(1).for("update", { skipLocked: true });
    if (!row) return undefined;
    const token = randomUUID();
    await tx.update(nextcloudJobs).set({ status: "running", workerToken: token, updatedAt: new Date() }).where(eq(nextcloudJobs.id, row.id));
    return { ...row, workerToken: token };
  });
  if (!job) return false;
  try {
    const data = decryptManifest<Manifest>(job.manifest!);
    const sources = data.sources.map(s => ({ ...s, base: new URL(s.base), root: new URL(s.root) }));
    const files = data.files.map(f => ({ ...f, href: new URL(f.href) }));
    await runImport(job.eventId, sources, files, job.workerToken);
  } catch {
    await db.update(nextcloudJobs).set({ status: "error", workerToken: null,
      error: "Import unterbrochen. Fortsetzen ist möglich; bei geänderten Zugangsdaten Links erneut prüfen.", updatedAt: new Date() })
      .where(and(eq(nextcloudJobs.id, job.id), eq(nextcloudJobs.workerToken, job.workerToken)));
  }
  return true;
}

async function runImport(eventId: number, sources: Source[], files: Found[], workerToken: string) {
  const started = Date.now();
  let failed = 0, downloaded = 0;
  const owned = and(eq(nextcloudJobs.eventId, eventId), eq(nextcloudJobs.workerToken, workerToken));
  const target = await storage.getEvent(eventId);
  if (!target || target.creatorId) {
    await db.update(nextcloudJobs).set({status:"failed",workerToken:null,error:"Only official VCO galleries support this import."}).where(owned);
    return true;
  }
  const heartbeat = setInterval(() => {
    void db.update(nextcloudJobs).set({ updatedAt: new Date() }).where(owned).catch(() => {});
  }, 10000);
  heartbeat.unref();
  try {
   // One import globally, two transfers/conversions within it. AI has its own
   // separate budget and never blocks the next transfer.
   let cursor = 0;
   const processFile = async (file: Found) => {
    if (Date.now() - started > MAX_MS) throw new NextcloudError("Import-Zeitlimit erreicht.");
    const [lease] = await db.select({ token: nextcloudJobs.workerToken }).from(nextcloudJobs).where(owned);
    if (!lease) throw new NextcloudError("Import lease expired");
    const source = sources.find(s => file.href.origin === s.root.origin &&
      (file.href.pathname === s.root.pathname || file.href.pathname.startsWith(s.root.pathname.replace(/\/$/, "") + "/")))!;
    const key = createHash("sha256").update(file.href.href).digest("hex");
    await db.insert(nextcloudFiles).values({ eventId, sourceKey: key, name: file.name }).onConflictDoNothing();
    const [record] = await db.select().from(nextcloudFiles).where(and(eq(nextcloudFiles.eventId, eventId), eq(nextcloudFiles.sourceKey, key)));
    const queueTags = async (mediaId: number) => {
      try {
        const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, mediaId));
        if (!item) return;
        await enqueueAnalysis(item);
        await db.update(nextcloudFiles).set({ aiWarning: null }).where(eq(nextcloudFiles.id, record.id));
      } catch {
        await db.update(nextcloudFiles).set({ aiWarning: "KI-Analyse nicht gestartet. Im Mediendialog gezielt erneut versuchen." }).where(eq(nextcloudFiles.id, record.id));
      }
    };
    if (record.status === "saved" && record.mediaId) { await queueTags(record.mediaId); return; }
    if (record.status !== "pending") {
      await db.update(nextcloudFiles).set({ status: "pending", mediaId: null, message: null, aiWarning: null })
        .where(eq(nextcloudFiles.id, record.id));
    }
    const tmp = path.join(tmpdir(), `nextcloud-${randomUUID()}`);
    let reservation: string | undefined;
    try {
       const limit = file.type === "image" ? mediaPolicy.imageBytes : mediaPolicy.videoBytes;
      const response = await request(file.href, source, "GET");
       if (Number(response.headers.get("content-length")) > limit || !response.body)
         throw new MediaLimitError(`${file.type === "image" ? "Bild" : "Video"} überschreitet das Dateilimit.`);
      let received = 0;
      await pipeline(Readable.fromWeb(response.body as any), new Transform({
        transform(chunk, _enc, cb) {
          received += chunk.length;
          downloaded += chunk.length;
           cb(received > limit || downloaded > MAX_BYTES
             ? new MediaLimitError("Medium oder gesamter Import überschreitet das Datenlimit.") : null, chunk);
        },
      }), createWriteStream(tmp));
       const fileUpload = { path: tmp, size: (await stat(tmp)).size, mimetype: file.mime } as Express.Multer.File;
      const keys = createMediaKeys(fileUpload.mimetype);
      reservation = randomUUID();
       await storage.reserveMedia(reservation, eventId, null,
         file.type === "image" ? 4 * 1048576 + 100 * 1024 : fileUpload.size + 100 * 1024,
         keys.storageKey, keys.thumbnailKey);
       const saved = await uploadMedia(fileUpload, file.type, keys);
      const item = await storage.finishMedia(reservation, insertMediaItemSchema.parse({
         eventId, type: saved.mediaType, url: saved.url, thumbnail: saved.thumbnail, storedBytes: saved.storedBytes,
          highBytes: saved.highBytes, lowBytes: saved.lowBytes,
        objectCount: saved.objectCount, caption: file.name, tags: [], isPremium: false,
       }), record.id, workerToken, true);
      reservation = undefined;
       await queueTags(item.id);
    } catch (error) {
      const [current] = await db.select({ status: nextcloudFiles.status }).from(nextcloudFiles).where(eq(nextcloudFiles.id, record.id));
      if (current?.status !== "saved") {
        failed++;
        await db.update(nextcloudFiles).set({ status: "error", message: error instanceof MediaLimitError ? error.message : "Datei konnte nicht importiert werden." })
          .where(and(eq(nextcloudFiles.id, record.id), eq(nextcloudFiles.status, "pending")));
      }
    } finally {
      if (reservation) await storage.abandonMedia(reservation).catch(() => {});
      await unlink(tmp).catch(() => {});
       await db.update(nextcloudJobs).set({ updatedAt: new Date() }).where(owned);
    }
   };
   let stopped = false;
   const outcomes = await Promise.allSettled(Array.from({ length: 2 }, async () => {
     try { while (!stopped && cursor < files.length) { const file = files[cursor++]; await processFile(file); } }
     catch (error) { stopped = true; throw error; }
   }));
   const rejected = outcomes.find(result => result.status === "rejected");
   if (rejected?.status === "rejected") throw rejected.reason;
   await db.update(nextcloudJobs).set({ status: failed ? "partial" : "completed",
     manifest: failed ? undefined : null, manifestExpiresAt: failed ? undefined : null,
     workerToken: null, updatedAt: new Date() }).where(owned);
  } finally {
    clearInterval(heartbeat);
  }
}