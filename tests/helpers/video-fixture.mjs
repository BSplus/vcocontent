import express from "express";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { Storage } from "@google-cloud/storage";
import { Client } from "@replit/object-storage";
import { storage } from "../../server/storage.ts";
import { registerRoutes } from "../../server/routes.ts";
import { pageMetadata } from "../../shared/pagination.ts";

// The real video bucket is process-cached. Its mocked methods must resolve the
// current fixture rather than keep serving a previous test's objects forever.
let activeVideoFixture;

/** Isolated test server: synthetic identities/data and real file route handlers.
 * No sessions, files, database rows, buckets or provider calls are modified. */
export async function videoFixture({ register = registerRoutes, store = storage } = {}) {
  const temp = await mkdtemp(path.join(tmpdir(), "video-playback-"));
  const filename = path.join(temp, "moving.mp4");
  await promisify(execFile)("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
    "testsrc2=size=160x90:rate=12:duration=24", "-threads", "1", "-c:v", "libx264",
    "-pix_fmt", "yuv420p", "-g", "12", filename]);
  const clip = await readFile(filename);
  const unsupportedFile = path.join(temp, "unsupported.mp4");
  await promisify(execFile)("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
    "testsrc2=size=160x90:rate=12:duration=3", "-threads", "1", "-c:v", "mpeg4", unsupportedFile]);
  const unsupported = await readFile(unsupportedFile);
  const codec = JSON.parse((await promisify(execFile)("ffprobe", ["-v", "error", "-show_entries",
    "stream=codec_name,pix_fmt:format=duration", "-of", "json", filename])).stdout);
  const id = "12345678-1234-4234-8234-123456789012";
  const keys = [`media-${id}.mp4`, `media-${id.slice(0,-1)}3.mp4`, `media-${id.slice(0,-1)}4.mp4`];
  const objects = new Map([[keys[0], clip], [keys[1], Buffer.from("Damaged MP4 fixture")], [keys[2], unsupported]]);
  const poster = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#234"/></svg>');
  const event = { id: 91001, title: "Playback fixture", description: "Disposable", creatorId: null,
    date: new Date(Date.now()-86400000).toISOString(), isPremium: false };
  const media = [
    { id: 91101, eventId: event.id, type: "video", url: `/api/media/files/${keys[0]}`, thumbnail: poster,
      caption: "Moving H264 fixture", downloadCount: 10, tags: [], isPremium: false },
    { id: 91102, eventId: event.id, type: "video", url: `/api/media/legacy/91102/file`, thumbnail: poster,
      caption: "Legacy H264 fixture", downloadCount: 9, tags: [], isPremium: false },
    { id: 91103, eventId: event.id, type: "video", url: "", thumbnail: poster,
      caption: "Missing source fixture", tags: [], isPremium: false },
    { id: 91104, eventId: event.id, type: "video", url: `/api/media/files/${keys[1]}`, thumbnail: poster,
      caption: "Damaged fixture", tags: [], isPremium: false },
    { id: 91105, eventId: event.id, type: "video", url: `/api/media/files/${keys[2]}`, thumbnail: poster,
      caption: "Unsupported codec fixture", tags: [], isPremium: false },
  ];
  const roles = {
    admin: { id: 91002, username: "Fixture admin", isAdmin: true },
    user: { id: 91003, username: "Fixture user" },
    owner: { id: 91004, username: "Fixture owner", isCreator: true, creatorStatus: "approved" },
    suspended: { id: 91005, username: "Fixture suspended", suspended: true },
  };
  const requests = [], streams = [], objectRanges = [];
  const originals = { fetch: globalThis.fetch, bucket: Storage.prototype.bucket,
    read: Client.prototype.downloadAsStream, getMediaItem: store.getMediaItem,
    findMediaByKey: store.findMediaByKey, getEvent: store.getEvent, cleanupObjects: store.cleanupObjects,
    getUser: store.getUser };
  let slow = false, fail = false, failAfter = false, metadataReads = 0;
  const open = (key, range = {}) => {
    if (fail || !objects.has(key)) return new Readable({read(){this.destroy(new Error("Synthetic storage outage"));}});
    const bytes = objects.get(key).subarray(range.start || 0, range.end === undefined ? undefined : range.end + 1);
    let offset = 0, timer;
    const stream = new Readable({
      read() {
        const push = () => {
          if (failAfter && offset >= 1024) { this.destroy(new Error("Synthetic mid-transfer failure")); return; }
          if (offset >= bytes.length) { this.push(null); return; }
          const end = Math.min(bytes.length, offset + 1024);
          this.push(bytes.subarray(offset, end)); offset = end;
        };
        if (slow) timer = setTimeout(push, 20); else push();
      },
      destroy(error, callback) { clearTimeout(timer); callback(error); },
    });
    streams.push(stream);
    return stream;
  };
  activeVideoFixture = { objects, open, objectRanges, metadataRead: () => metadataReads++ };
  Storage.prototype.bucket = () => ({
    file: (key, options={}) => ({
      async getMetadata() {
        activeVideoFixture.metadataRead();
        if (!activeVideoFixture.objects.has(key)) throw new Error("Missing object");
        return [{ size: String(activeVideoFixture.objects.get(key).length), generation: "1" }];
      },
      createReadStream: range => {
        activeVideoFixture.objectRanges.push({key,options,range});
        return activeVideoFixture.open(key, range);
      },
    }),
  });
  Client.prototype.downloadAsStream = key => open(key);
  globalThis.fetch = (url, options) => String(url) === "http://127.0.0.1:1106/object-storage/default-bucket"
    ? Promise.resolve(Response.json({ bucketId: "synthetic-video-fixture" })) : originals.fetch(url, options);
  store.getEvent = async id => id === event.id ? event : undefined;
  store.getUser = async id => Object.values(roles).find(role=>role.id===id);
  store.getMediaItem = async id => {
    const item = media.find(item => item.id === id);
    return item?.id === 91102 ? { ...item, url: `data:video/mp4;base64,${clip.toString("base64")}` } : item;
  };
  store.findMediaByKey = async key => media.find(item => item.url === `/api/media/files/${key}`);
  store.cleanupObjects = async () => {};
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const role = /fixture-role=(\w+)/.exec(req.headers.cookie || "")?.[1];
    req.user = roles[role];
    req.isAuthenticated = () => !!req.user;
    res.on("finish", () => requests.push({path:req.path, method:req.method, range:req.headers.range,
      status:res.statusCode, contentRange:res.getHeader("Content-Range"), length:res.getHeader("Content-Length")}));
    next();
  });
  app.get("/fixture/login/:role", (req, res) => {
    res.setHeader("Set-Cookie", `fixture-role=${req.params.role}; Path=/; SameSite=Lax`);
    res.json({ok:true});
  });
  app.get("/api/user", (req, res) => req.user ? res.json(req.user) : res.status(401).json({message:"Sign in required"}));
  app.get("/api/events", (_req,res)=>res.json([event]));
  app.get(`/api/events/${event.id}`, (_req,res)=>res.json(event));
  const mediaList = (req, res) => {
    if (req.query.pagination !== "true") return res.json(media);
    const meta = pageMetadata(media.length, Number(req.query.page || 1), 48);
    res.json({ ...meta, items: media.slice((meta.page - 1) * 48, meta.page * 48) });
  };
  app.get(`/api/events/${event.id}/media`, mediaList);
  app.get(`/api/events/${event.id}/community-galleries`, (_req,res)=>res.json([]));
  app.get("/api/media/top-shots", (_req,res)=>res.json(media.slice(0,2)));
  app.get("/api/media/creator-top", (_req,res)=>res.json([]));
  app.get("/api/media", mediaList);
  app.get("/api/media/:id", (req,res,next)=>{
    if (!/^\d+$/.test(req.params.id)) return next();
    const item = media.find(item=>item.id===Number(req.params.id));
    item ? res.json(item) : res.status(404).end();
  });
  app.get("/api/media/:id/analysis", (_req,res)=>res.json({status:"not_requested",tags:[]}));
  app.get("/api/community/*", (_req,res)=>res.json({count:0,liked:false,saved:false}));
  app.get("/api/credits", (_req,res)=>res.json({credits:0}));
  const server = await register(app,{workers:false});
  app.use(express.static(path.resolve(process.env.VIDEO_TEST_STATIC || "dist/public"), {index:false}));
  app.get("*", async (_req,res) => res.type("html").send(await readFile(path.resolve(process.env.VIDEO_TEST_STATIC || "dist/public","index.html"))));
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, clip, codec, event, media, objects, requests, streams, objectRanges, roles, keys,
    get metadataReads(){return metadataReads;},
    set slow(value){slow=value;}, set fail(value){fail=value;}, set failAfter(value){failAfter=value;},
    api: (url, role="user", options={}) => originals.fetch(base+url,{...options,
      headers:{...(role && {cookie:`fixture-role=${role}`}),...options.headers}}),
    async close() {
      server.closeAllConnections(); server.close(); await once(server,"close");
      Object.assign(store,{getMediaItem:originals.getMediaItem,findMediaByKey:originals.findMediaByKey,
        getEvent:originals.getEvent,cleanupObjects:originals.cleanupObjects,getUser:originals.getUser});
      globalThis.fetch=originals.fetch; Storage.prototype.bucket=originals.bucket;
      Client.prototype.downloadAsStream=originals.read;
      activeVideoFixture = undefined;
      await rm(temp,{recursive:true,force:true});
    },
  };
}
