# Sony ARW — isolated structural evaluation

Prepared for P2-6 on 19 October 2026. **No route, upload finalizer, UI, format
allowlist or download path was enabled.** The default `validateRawContainer`
still rejects ARW. `validateSonyArwContainer` is a separate internal evaluation
entry point, not production approval.

## Narrow profile and actual evidence

The authorized Sony ILCE-7M4 sample passes the new profile:
47,345,664 bytes; SonyRawFileType 4; little-endian classic TIFF;
7168 × 5120 CFA14; lossless JPEG compression; 140 tiles of 512 × 512 CFA
samples, represented by four 256 × 256 component planes per compressed tile.
Other camera models, dimensions and compression variants are unsupported.
The original SHA-256 remains unchanged.

The initial seven ExifTool warnings have now been enumerated using repeated
text tags rather than JSON with duplicate Warning keys:

- `Entries in SubIFD are out of order [x6]`
- `XResolution`, `SonyRawFileType`, `StripOffsets`, `SonyCropTopLeft`,
  `BitsPerSample` and `TileWidth` out of sequence in SubIFD, with the exact
  tag IDs/messages stored in the profile.

Only clean zero-warning validation or this **exact seven-warning set** is
accepted. Unknown, missing, duplicated, differently counted warnings and any
reported error fail. Tag-order tolerance is paired with independent bounds
checks; it does not suppress truncated data or other container warnings.

## Independent container checks

The read-only scanner bounds and traverses classic TIFF next-IFD, SubIFD,
EXIF, GPS and interoperability directory pointers. It rejects cycles,
duplicate tags, unknown field types, bad external value extents and excessive
directory/entry counts. Proprietary MakerNote payloads remain opaque bounded
data; their internal private subformats are not exhaustively decoded.

It requires exactly one observed Sony RAW directory/profile and exactly
140 offset/count pairs. Tile ranges must stay inside both file and declared
RAW strip bounds, must not overlap each other or known metadata extents,
and need the expected SOI/SOF3 precision/component framing and EOI with up to
15 trailing alignment bytes. Tile-table order need not be physical file order.
Metadata privacy/publication safety are separate concerns.

**This is not full JPEG entropy/sensor decoding**, a malware scanner, proof that
every embedded preview is decodable, or pixel-level proof of JPEG/RAW pairing.
The authored positive unit fixture has structural frames, not real sensor
entropy; only the separately supplied camera file is real-camera evidence.
Do not infer general Sony/DNG/vendor support or publication safety from it.

## Resource and integrity boundary

Reuses the existing two-slot media budget, shared queue, 250 MiB isolated
evaluation ceiling, immutable source/hash checks and 16-second abort watchdog.
ExifTool retains its existing process/address-space/CPU/output restrictions.
The independent scanner allows at most 32 directories, 4096 total entries,
1024 entries per directory, 16 child pointers per pointer field, 1024 numeric
array elements and 256 KiB total reads; a single read is at most 64 KiB.
Allocation and traversal bounds do not establish a hard filesystem deadline.
There is no new native RAW renderer or provider operation.

## Verification

TypeScript checking, production build and **42 unit/regression tests** passed.
The 11 new scanner/warning tests use authored private-data-free fixtures.
Existing DNG/integrity/resource/pairing behavior remains covered.

Run the optional real-camera acceptance only with an authorized local sample:

```sh
node --import tsx scripts/check-sony-arw-sample.mjs PATH_TO_AUTHORIZED_ARW
```

The supplied real sample passed. The command uses temporary copies, then tests
default-API rejection, checksum mismatch, truncation *inside declared RAW data*,
out-of-bounds tile offset, zero tile count and a damaged tile header.
Altered-byte cases use fresh size/hash evidence so rejection is not merely an
old-checksum failure. All six negative cases passed; temporary copies were
removed and original integrity checked. The complete local acceptance batch
took approximately 8.4 seconds, not a per-upload performance guarantee.
No hashes, filenames, GPS, camera serials or private parser diagnostics are
printed by the acceptance command.

## Remaining P2-6 work

Trusted minimal pairing evidence extraction; explicit Studio attachment and
reassignment; gated session/reservation/persistence integration; independent
safety and exact-original privacy policy; RAW lifecycle recovery and protected
delivery tests. Runtime format/size activation requires separate approval.
