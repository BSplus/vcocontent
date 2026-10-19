# P2-6 — authorized Sony JPEG/RAW compatibility evidence

Local inspection performed on 19 October 2026. The operator supplied a JPEG/RAW
pair and explicitly authorized local testing. Neither file was uploaded to a
provider or sent to AI. The samples are excluded from Git and deployment;
no copy of private EXIF or original camera files is committed in this report.

## Actual results

| Check | Result |
| --- | --- |
| Camera reported by RAW | SONY ILCE-7M4 (Sony α7 IV). |
| RAW | ARW, `image/x-sony-arw`, 47,345,664 bytes; Sony Lossless Compressed RAW 2; 14-bit, one sample/pixel. |
| RAW reported dimensions | 7168 × 5120 container ImageWidth/ImageHeight. These are not a decoded visible sensor/crop measurement. |
| JPEG | `image/jpeg`, 10,411,825 bytes, 7028 × 4688, 8-bit. |
| JPEG structural inspection | ExifTool validation: zero errors, zero warnings. |
| JPEG actual decode | Sharp decoded/resized to an in-memory 640 × 427 WebP preview, 34,916 bytes; no preview persisted. |
| RAW structural inspection | ExifTool recognized ARW; zero reported errors and seven warnings. The surfaced warning concerns TileWidth tag order in SubIFD. This is not evidence that all seven warnings are benign. |
| Current prepared validator | Correctly returned `unsupported` for ARW. Its accepted subset remains synthetic uncompressed CFA16 DNG only. |
| Original integrity | Streamed SHA-256 before/after inspection matched for each file. No rewrite/recompression of originals. |
| Pairing evidence | RAW contains camera, capture-time, timezone and serial metadata. JPEG contains none of those fields. No GPS coordinates were returned by the selected latitude/longitude check for either file; this is not a complete privacy clearance. |
| Publication/delivery | Not tested or enabled. No RAW upload, storage reservation, R2 operation, RAW sensor decode or download occurred. |

ExifTool ran through the existing isolated tool runner: 256 MiB address-space
limit, four CPU seconds, 32 descriptors, zero-byte regular-file-write limit,
eight-second watchdog and bounded output. Approximate observed inspection times
were 1.18 seconds for JPEG and 0.78 seconds for ARW (excluding source hashing).
The JPEG thumbnail operation took approximately 0.23 seconds. These are single
workspace observations, not deployment resource guarantees or full RAW decode
benchmarks.

## Pairing and usability consequence

This is a useful real-world **exported-JPEG/manual-pairing case**, not evidence
for automatic capture-metadata matching. Do not fabricate capture timestamps
or camera facts for the JPEG, and do not require equal JPEG/RAW dimensions:
an editorial JPEG can be resized/cropped.

The supplied attachment filenames have different transport prefixes/suffixes.
Do not silently strip arbitrary name fragments to force a filename match.
Even matching camera stems would not replace missing capture evidence.
Offer explicit selection of an existing owned JPEG in the same gallery;
recheck its current revision and both object hashes when attaching.
The prepared domain selection checks permit this, but Studio controls and
approved ARW intake are not yet implemented. The local test does not prove
pixel-level correspondence between the two files.

## Next implementation boundary

1. Prepare and test a narrow Sony lossless-compressed ARW structural profile,
   including TIFF/SubIFD and tile/strip extents, truncation and malformed
   fixtures. ExifTool type detection alone is insufficient.
2. Review the exact warnings and distinguish tolerated camera layout quirks
   from corruption; do not globally ignore parser warnings.
3. Add trusted, privacy-minimized pairing evidence extraction and explicit
   manual Studio pairing without making EXIF a mandatory upload field.
4. Connect only reviewed formats to gated intake, quota, safety, recovery and
   exact-original privacy controls. Obtain activation approval separately.

One Sony pair does not establish support for every ARW compression/camera,
other vendors, or real-camera DNG. P2-6 remains open.

## Regression verification

TypeScript checking and 31 validator/pairing/asset tests passed. Added synthetic
regressions cover manual selection with stripped JPEG EXIF and refusal to
normalize attachment transport filenames into invented camera stems.
The unchanged public application page also rendered successfully; no signed-in
Studio flow or connected RAW intake was verified.
