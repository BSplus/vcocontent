// Per-process CPU/memory budget, shared by multipart uploads and imports.
// Waiting files already live on disk; never collect their contents in RAM.
const LIMIT = 2;
const MAX_WAITING = 8;
let active = 0;
const waiting: (() => void)[] = [];
export class MediaBusyError extends Error {}

export async function withMediaWorkBudget<T>(work: () => Promise<T>): Promise<T> {
  if (active >= LIMIT) {
    if (waiting.length >= MAX_WAITING) throw new MediaBusyError("Media processing is busy. Please retry shortly.");
    await new Promise<void>(resolve => waiting.push(resolve));
  } else active++;
  try { return await work(); }
  finally {
    const next = waiting.shift();
    if (next) next(); // Transfer this occupied slot to the oldest waiting file.
    else active--;
  }
}
