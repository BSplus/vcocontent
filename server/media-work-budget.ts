// Per-process CPU/memory budget, shared by multipart uploads and imports.
// Waiting files already live on disk; never collect their contents in RAM.
const LIMIT = 2;
const MAX_WAITING = 8;
let active = 0;
const waiting: (() => void)[] = [];
export class MediaBusyError extends Error {}

export async function withMediaWorkBudget<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (active >= LIMIT) {
    if (waiting.length >= MAX_WAITING) throw new MediaBusyError("Media processing is busy. Please retry shortly.");
    await new Promise<void>((resolve, reject) => {
      const start = () => { signal?.removeEventListener("abort", cancel); resolve(); };
      const cancel = () => {
        const index = waiting.indexOf(start);
        if (index !== -1) waiting.splice(index, 1);
        reject(signal?.reason);
      };
      waiting.push(start);
      signal?.addEventListener("abort", cancel, { once: true });
    });
  } else active++;
  try { signal?.throwIfAborted(); return await work(); }
  finally {
    const next = waiting.shift();
    if (next) next(); // Transfer this occupied slot to the oldest waiting file.
    else active--;
  }
}
