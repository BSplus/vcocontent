import test from "node:test";
import assert from "node:assert/strict";
import { downloadFilename } from "../server/download-filename.ts";

const event = { id: 7, title: "Event name", date: new Date("2026-10-13T00:00:00Z") };
const name = (changes = {}, quality = "low", mime = "image/jpeg") =>
  downloadFilename({ id: 797 }, { ...event, ...changes }, quality, mime);

test("readable ASCII names transliterate umlauts, accents and unsafe header/path characters", () => {
  assert.equal(name(), "vco_2026-10-13_event-name_m797_low.jpg");
  const title = '../Ä Ö Ü ß / Café \\ "Finale"\r\n🚗';
  assert.equal(name({ title }), "vco_2026-10-13_ae-oe-ue-ss-cafe-finale_m797_low.jpg");
  assert.equal(name({ title: title.normalize("NFD") }), name({ title }));
  assert.match(name({ title }), /^[a-z0-9_.-]+$/);
});

test("long and empty event slugs are bounded and have stable event-ID fallbacks", () => {
  for (const title of ["", "💥", "/\\\r\n\" .."]) {
    assert.equal(name({ title }), "vco_2026-10-13_event-7_m797_low.jpg");
  }
  assert.equal(name({ title: "x".repeat(5000) }), `vco_2026-10-13_${"x".repeat(80)}_m797_low.jpg`);
  assert.equal(name({ title: `${"x".repeat(79)} -- y` }), `vco_2026-10-13_${"x".repeat(79)}_m797_low.jpg`);
});

test("saved event dates use UTC across day boundaries and server timezones", () => {
  const old = process.env.TZ;
  try {
    for (const tz of ["UTC", "Europe/Berlin", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      assert.match(name({ date: new Date("2026-10-13T00:15:00+02:00") }), /^vco_2026-10-12_/);
      assert.match(name({ date: new Date("2026-10-13T23:45:00-02:00") }), /^vco_2026-10-14_/);
    }
  } finally {
    if (old === undefined) delete process.env.TZ; else process.env.TZ = old;
  }
  assert.throws(() => name({ date: new Date(NaN) }));
});

test("extensions come only from the delivered format for photos and unmodified videos", () => {
  for (const [mime, ext] of Object.entries({
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  })) assert.equal(name({}, "high", mime), `vco_2026-10-13_event-name_m797_high.${ext}`);
  assert.equal(name({}, "high", "IMAGE/JPEG; charset=binary"), name({}, "high"));
  assert.throws(() => name({}, "high", "application/octet-stream"), /Unsupported/);
});
