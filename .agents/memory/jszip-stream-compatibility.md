---
name: JSZip stream compatibility
description: Why bounded XLSX extraction needs a native Node stream wrapper
---

Do not assume a JSZip nodeStream supports native async iteration.

**Why:** The installed JSZip dependency returned a legacy readable-stream object without Symbol.asyncIterator, despite exposing normal stream methods. A for-await loop failed at runtime.

**How to apply:** Wrap that legacy readable in a native Node Readable before async iteration, retaining streamed byte limits. Test actual XLSX archives, not only mocked streams or TypeScript compilation.
