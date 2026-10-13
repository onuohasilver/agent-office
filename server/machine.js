// Keeping the agents from sinking the machine they run on: how hard it is
// swapping right now, and cleaning up what an agent left running.

import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { ps, tree } from './procstat.js';

// ---------- pressure ----------

// Swap traffic is the signal that matters: "free memory" on macOS stays near
// zero by design, and its memory level reads healthy while the disk thrashes.
// Pages swapped in and out, as running totals.
function swapPages() {
  if (process.platform === 'linux') {
    try {
      const v = fs.readFileSync('/proc/vmstat', 'utf8');
      const n = (k) => Number(v.match(new RegExp(`^${k} (\\d+)`, 'm'))?.[1] || 0);
      return Promise.resolve({ pages: n('pswpin') + n('pswpout'), pageSize: 4096 });
    } catch { return Promise.resolve(null); }
  }
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('/usr/bin/vm_stat', { timeout: 3000 }, (err, out) => {
      if (err) return resolve(null);
      const n = (k) => Number(out.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] || 0);
      const pageSize = Number(out.match(/page size of (\d+)/)?.[1] || 16384);
      resolve({ pages: n('Swapins') + n('Swapouts'), pageSize });
    });
  });
}

// Readings over the last minute or so; the rate is taken across all of them
// so one burst doesn't hold the queue.
const WINDOW_MS = 60_000;
const readings = [];

export async function samplePressure() {
  const r = await swapPages();
  if (!r) return;
  const now = Date.now();
  readings.push({ at: now, ...r });
  while (readings.length > 2 && now - readings[1].at > WINDOW_MS) readings.shift();
}

// MB a second swapped over the window, or null with too little to go on.
export function swapRate() {
  if (readings.length < 2) return null;
  const a = readings[0], b = readings[readings.length - 1];
  const secs = (b.at - a.at) / 1000;
  if (secs < 5 || b.pages < a.pages) return null;
  return ((b.pages - a.pages) * b.pageSize) / secs / (1 << 20);
}

export function resetPressure() {
  readings.length = 0;
}

// Above these the machine is thrashing: swap traffic of a size that stalls
// everything, or three times more runnable work than there are cores.
export const LIMITS = { swapMBs: 100, loadPerCore: 3 };

// Why a new agent should not start now, in words for the boss, or null.
export function overloaded() {
  if (process.env.OFFICE_PRESSURE_CHECK === 'off') return null;
  const swap = swapRate();
  if (swap !== null && swap > LIMITS.swapMBs) return `the machine is swapping memory to disk (about ${Math.round(swap)} MB/s)`;
  const cores = os.cpus().length;
  const load = os.loadavg()[0];
  if (load > cores * LIMITS.loadPerCore) return `the processor is overloaded (load ${load.toFixed(0)} on ${cores} cores)`;
  return null;
}

// ---------- leftovers ----------

// What each job's agent has started, from the process samples taken while it
// works: jobId -> Map(pid -> { cmd, pgid }). Kept across the sessions of one
// job (a cleared context or a model switch), so a dev server started before
// the clear is still the job's.
const started = new Map();
// And the process groups they ran in: jobId -> Map(pgid -> leader as seen, or
// null if it wasn't). Each command an
// agent runs gets a group of its own, and whatever it puts in the background
// stays in that group after the shell exits, so the group finds those too.
const groups = new Map();

export function remember(jobId, procs, root) {
  let mine = started.get(jobId);
  if (!mine) started.set(jobId, (mine = new Map()));
  let gs = groups.get(jobId);
  if (!gs) groups.set(jobId, (gs = new Map()));
  // The agent's own group is the office's, which is nobody's to clean up.
  const own = procs.find((p) => p.pid === root)?.pgid;
  for (const p of procs) {
    if (p.pid === root) continue;
    if (!mine.has(p.pid)) mine.set(p.pid, { cmd: p.cmd, pgid: p.pgid, start: p.start });
    if (p.pgid > 1 && p.pgid !== own && !gs.get(p.pgid)) gs.set(p.pgid, p.pid === p.pgid ? { cmd: p.cmd, start: p.start } : null);
  }
}

// Whether a process is the job's: seen under it, or in a group it ran.
export function startedByJob(jobId, p) {
  if (started.get(jobId)?.get(p.pid)?.cmd === p.cmd) return true;
  // A new group leader that merely reuses an old group's number is not.
  return !!groups.get(jobId)?.has(p.pgid) && p.pid !== p.pgid;
}

export function forget(jobId) {
  started.delete(jobId);
  groups.delete(jobId);
}

const name = (cmd) => {
  const words = String(cmd).split(/\s+/);
  const bin = (words[0] || '').split('/').pop();
  // "node .../vite" says less than "vite".
  const script = /^(node|python\d?|ruby|sh|bash|zsh|npm|npx|pnpm|yarn|bun|deno)$/.test(bin) && words.slice(1).find((w) => w && !w.startsWith('-'));
  return (script ? script.split('/').pop() : bin).slice(0, 40) || 'process';
};

// Daemons that any build or tool connects to, whoever started them. Stopping
// one under another agent's running build fails that build, so they are only
// stopped when nobody else is working.
const SHARED = /GradleDaemon|KotlinCompileDaemon|GradleWrapperMain.*--daemon|\bwatchman\b|\badb\b.*(fork-server|server)/;

// Stop whatever the job started that is still running, except what the agent
// asked to keep and anything inside `live` (another agent's process tree).
// A pid only counts if its command and start are the ones recorded, so a
// reused pid is left alone. Returns the names of what was stopped.
const same = (now, was) => !!now && !!was && now.cmd === was.cmd && (now.start == null || was.start == null || Math.abs(now.start - was.start) < 2000);
export async function reap(jobId, { keep = [], live = [] } = {}) {
  const mine = started.get(jobId);
  const gs = groups.get(jobId) || new Map();
  forget(jobId);
  if (!mine?.size) return [];
  const snap = await ps();
  if (!snap) return [];
  // Never the office itself or what runs it.
  const spare = new Set();
  for (let pid = process.pid; pid > 1 && !spare.has(pid); pid = snap.procs.get(pid)?.ppid) spare.add(pid);
  for (const root of [...live, ...keep]) for (const p of tree(snap, root)) spare.add(p.pid);
  const roots = [];
  for (const [pid, was] of mine) if (same(snap.procs.get(pid), was)) roots.push(pid);
  // A group's number can't be reused while anything is still in it, so one
  // with no leader left is the job's. One with a leader is only if that
  // leader is the one seen while the job worked, not a newcomer with its pid.
  const ours = (g) => !snap.procs.has(g) || same(snap.procs.get(g), gs.get(g));
  for (const p of snap.procs.values()) if (gs.has(p.pgid) && p.pid !== p.pgid && ours(p.pgid)) roots.push(p.pid);
  const doomed = new Map();
  for (const pid of roots) {
    if (spare.has(pid)) continue;
    for (const p of tree(snap, pid)) if (!spare.has(p.pid) && !(live.length && SHARED.test(p.cmd))) doomed.set(p.pid, p);
  }
  if (!doomed.size) return [];
  for (const pid of doomed.keys()) try { process.kill(pid, 'SIGTERM'); } catch {}
  // Whatever ignores a polite stop gets a firm one, if it is still the same process.
  setTimeout(async () => {
    const later = await ps();
    for (const [pid, p] of doomed) if (same(later?.procs.get(pid), p)) try { process.kill(pid, 'SIGKILL'); } catch {}
  }, 5000).unref();
  return [...doomed.values()].map((p) => name(p.cmd));
}

export { name as procName };
