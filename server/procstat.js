// What each agent is costing this machine: CPU and memory for the whole
// process tree under its `claude` process — the agent itself, its MCP
// servers, and anything a tool it ran is still doing.

import os from 'node:os';
import { execFile } from 'node:child_process';

// The user's PATH may shadow ps with something else; ask for the real one.
const PS = '/bin/ps';

// "45:01.95", "1:02:03.45" and "2-01:02:03" all mean seconds here.
function cpuSeconds(s) {
  const [days, rest] = s.includes('-') ? s.split('-') : [0, s];
  return Number(days) * 86400 + rest.split(':').reduce((a, p) => a * 60 + parseFloat(p), 0);
}

export function ps() {
  return new Promise((resolve) => {
    execFile(PS, ['-axo', 'pid=,ppid=,pgid=,rss=,cputime=,etime=,command='], { timeout: 4000, maxBuffer: 16 << 20 }, (err, out) => {
      if (err) return resolve(null);
      const at = Date.now();
      const procs = new Map();
      const kids = new Map();
      for (const line of out.split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/);
        if (!m) continue;
        const pid = Number(m[1]), ppid = Number(m[2]);
        // start: when it began, to the second, so a reused pid can be told apart.
        procs.set(pid, { pid, ppid, pgid: Number(m[3]), rss: Number(m[4]) * 1024, cpu: cpuSeconds(m[5]), start: at - cpuSeconds(m[6]) * 1000, cmd: m[7] });
        if (!kids.has(ppid)) kids.set(ppid, []);
        kids.get(ppid).push(pid);
      }
      resolve({ procs, kids, at });
    });
  });
}

export function tree(snap, root) {
  const out = [];
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const pid = queue.pop();
    if (seen.has(pid) || !snap.procs.has(pid)) continue;
    seen.add(pid);
    out.push(snap.procs.get(pid));
    for (const kid of snap.kids.get(pid) || []) queue.push(kid);
  }
  return out;
}

// ps reports CPU time since the process started, so a percentage only exists
// between two samples: busy seconds over wall-clock seconds, per core.
let prev = null;

export const machine = { cores: os.cpus().length, mem: os.totalmem() };

export async function sampleProcs(roots) {
  const snap = await ps();
  if (!snap) { prev = null; return null; }
  const span = prev ? (snap.at - prev.at) / 1000 : 0;
  const by = {};
  for (const [key, pid] of roots) {
    const procs = tree(snap, pid);
    if (!procs.length) continue;
    const busy = procs.reduce((a, p) => {
      const was = prev?.procs.get(p.pid);
      // A process that started since the last sample counts all of its time.
      return a + (was && was.cpu <= p.cpu ? p.cpu - was.cpu : p.cpu);
    }, 0);
    by[key] = {
      // Null until a span exists to measure over, so the UI can wait rather
      // than flash a zero.
      cpu: span >= 0.5 ? Math.round((busy / span) * 1000) / 10 : null,
      mem: procs.reduce((a, p) => a + p.rss, 0),
      procs: procs.length,
    };
  }
  prev = snap;
  return by;
}

// Every process under `root` as of the last sample, for remembering what an
// agent started so it can be cleaned up once the agent is gone.
export const lastTree = (root) => (prev ? tree(prev, root) : []);

// Starting fresh after a quiet spell: the next sample has nothing to diff
// against, so don't report a percentage for it.
export function resetProcs() {
  prev = null;
}
