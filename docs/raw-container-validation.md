# RAW container validation — isolated DNG evaluation

This is the next **P2-6 preparation slice**, not RAW feature activation.
No route, upload finalizer or Studio control invokes the new validator yet.
Generic delivery still rejects RAW keys. There is no schema/configuration
change, R2 operation, decoder, AI request or public RAW delivery.

## Scope actually tested

`server/raw-container-validation.ts` evaluates a narrow DNG subset:
classic TIFF byte order, DNG version 1.1–1.7, uncompressed 16-bit,
single-sample CFA sensor data stored in bounded strips.
ExifTool must report a DNG MIME/type and clean structural validation.
Strip extents/counts, pixel dimensions and total sensor bytes are checked.
Compressed/tiled DNG, BigTIFF and CR2/CR3/NEF/ARW/RAF/ORF/RW2 are not enabled.

The positive fixture is an authored 32×24 synthetic sensor ramp, generated in
`tests/helpers/synthetic-dng.mjs`. It contains no photograph, private metadata
or externally licensed content. **This is not representative real-camera
compatibility evidence, an approved RAW allowlist or proof of full DNG support.**
No rendering or aesthetic/safety inspection of sensor content occurs.

## File integrity and privacy

The internal caller supplies an owned staging directory, file, durable expected
size/hash and explicit byte ceiling. The validator:

1. Rejects path-like/deceptive names and incompatible MIME/extension metadata.
2. Opens a regular, non-symlink file directly inside the resolved staging root.
3. Checks TIFF header/first-directory bounds and streams its SHA-256.
4. Passes only an inherited read-only descriptor to ExifTool, never a
   user-controlled command/path argument.
5. Checks allowed structural output, streams SHA-256 again and compares
   descriptor size/inode/timestamps and the current path's inode.

The source is never rewritten/recompressed. Concurrent mutation or path
replacement fails. A matching upload hash is still not proof that a provider
object has the same bytes; later persistence must independently verify those.
No GPS, serial, author, arbitrary EXIF snapshot or source path is returned.
Only format/subset, dimensions, byte count, checksum and MIME are returned.

## Resource boundary

The existing shared media-work budget retains its two active slots and bounded
waiting queue. Source hashing streams 64 KiB blocks, with a required ceiling
no greater than the previously approved **250 MiB isolated evaluation limit**.
No runtime upload limit is changed or inferred from that ceiling.

The parser uses installed ExifTool through `prlimit` and Perl:

- Read-only flags, no user configuration (`-config ""`), no shell execution.
- Minimal child environment, without application secrets.
- 256 MiB virtual-address limit, four CPU seconds, 32 descriptors and zero-byte
  regular-file-write limit.
- Eight-second child watchdog, 64 KiB stdout, 8 KiB stderr.
- No retained/logged raw stderr, source metadata or parser diagnostics.
- A private process group is killed on cancellation/output/deadline limits;
  settlement waits for process close before releasing the work slot.
- A 16-second abort watchdog surrounds admitted validation, including hashing.

These are process and admission bounds, **not a general filesystem/network
sandbox**. Filesystem operations can outlast abort notification, and no
host-wide wall-clock/resource guarantee is claimed. The source must remain
inside a server-owned staging area. Missing tools fail explicitly with no
permissive fallback. The current Linux workspace was tested; deployment-host
availability/resource suitability must be verified before activation.

## Verification

```sh
npm run check
node --import tsx --test tests/raw-container-validation.test.mjs \
  tests/raw-pairing.test.mjs tests/media-asset.test.mjs
npm run build
```

**29 checks passed, zero failures/skips.** Type checking and production build
passed. The validator tests use actual installed ExifTool and Linux resource
limits, including a real stalled child, real CPU-cap termination, output
overflow, cancellation, missing tools, file mutation and path replacement.
Malformed/truncated TIFF, non-DNG input, invalid sensor offsets/lengths, size/hash
mismatches, unsupported compression, deceptive names and invalid scope fail.
No connected database, live provider or existing media was used.
The application workflow restarted cleanly and its public page rendered
correctly. No signed-in Studio screen was changed or newly verified.

## Remaining before usable RAW intake

An authorized real-camera pair has now been inspected locally:
see `raw-camera-compatibility-evidence.md`. It is Sony lossless-compressed ARW,
not the accepted synthetic DNG subset. Its exported JPEG lacks capture/camera
EXIF, so it provides manual-pairing evidence, not automatic matching evidence.
ARW remains unsupported by this validator.

Obtain representative authorized JPEG/RAW camera pairs and verify initial
formats/compression variants. Define any additional supported subset and
resource policy from that evidence, not the extension list. Then connect
validation to gated reservations/persistence, explicit Studio pairing,
independent safety/original-privacy policy and lifecycle recovery.
RAW-only publication, safe reassignment/snapshots and protected downloads remain
unimplemented in this slice. RAW pairing metadata extraction is also separate:
this validator intentionally does not supply camera/EXIF facts to suggestions.
