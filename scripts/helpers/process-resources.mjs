import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const ticksPerSecond = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
const pageSize = Number(execFileSync("getconf", ["PAGESIZE"], { encoding: "utf8" }).trim());

// Count the entire isolated process group, including FFmpeg children. A parent's
// waited-child CPU fields retain work after those children exit.
export async function groupResources(group) {
  let rss = 0, ticks = 0;
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = await readFile(`/proc/${name}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(fields[2]) !== group) continue; // field 5: process group
      ticks += [11, 12, 13, 14].reduce((sum, i) => sum + Number(fields[i]), 0);
      rss += Number(fields[21]) * pageSize; // field 24: RSS pages
    } catch { /* A short-lived decoder may exit during sampling. */ }
  }
  return { rss, cpuSeconds: ticks / ticksPerSecond };
}

export function monitorGroup(group) {
  let peakRss = 0, maxCpu = 0, first, previous, last, busy = false;
  const sample = async () => {
    if (busy) return;
    busy = true;
    try {
      const value = { ...await groupResources(group), at: performance.now() };
      if (!first) first = value;
      peakRss = Math.max(peakRss, value.rss);
      last = value;
      if (!previous) previous = value;
      if (value.at - previous.at >= 1000) {
        maxCpu = Math.max(maxCpu, 100 * Math.max(0, value.cpuSeconds - previous.cpuSeconds) / ((value.at - previous.at) / 1000));
        previous = value;
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => void sample(), 50);
  return { finish: async () => {
    clearInterval(timer);
    while (busy) await new Promise(r => setTimeout(r, 5));
    await sample();
    return { peakRssMiB: Math.round(peakRss / 1048576),
      peakCpuPercentOneCore: Math.round(maxCpu),
      cpuSeconds: Number(Math.max(0, (last?.cpuSeconds ?? 0) - (first?.cpuSeconds ?? 0)).toFixed(2)),
      wallSeconds: Number(((last.at - first.at) / 1000).toFixed(2)), sampleIntervalMs: 50, cpuWindowMs: 1000 };
  } };
}

// Approximation only: descendants inherit one-core affinity, and the whole group
// is paused every other 100 ms. This is NOT a Replit VM CPU quota or memory cap.
export function halfCoreThrottle(group) {
  let stopped = false;
  const timer = setInterval(() => {
    stopped = !stopped;
    try { process.kill(-group, stopped ? "SIGSTOP" : "SIGCONT"); } catch {}
  }, 100);
  return () => { clearInterval(timer); try { process.kill(-group, "SIGCONT"); } catch {} };
}
