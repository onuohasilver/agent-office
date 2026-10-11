// "What changed" for a job: snapshot the working tree when the job starts and
// again when it ends, then diff the two. Snapshots are tree objects built from
// a throwaway index, so nothing in the repo's own index, stash or history is
// touched, and untracked files are included (ignored ones are not).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const MAX_FILES = 200;
const MAX_DIFF = 400 * 1024;

const git = (cwd, args, env = {}) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 60000 }, (err, out) => {
    if (err) reject(err); else resolve(out);
  });
});

// A tree sha for the working tree as it is right now, or null outside a repo.
export async function snapshotTree(cwd) {
  const tmp = path.join(os.tmpdir(), `office-index-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    const real = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])).trim();
    // Seeding from the real index keeps `add -A` quick on a big tree.
    try { fs.copyFileSync(real, tmp); } catch {}
    const env = { GIT_INDEX_FILE: tmp };
    await git(cwd, ['add', '-A'], env);
    return (await git(cwd, ['write-tree'], env)).trim();
  } catch {
    return null;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const LETTER = { A: 'added', M: 'modified', D: 'deleted', T: 'modified' };

// The summary the card shows: per-file status and line counts, no diff bodies.
export async function summarize(cwd, base, end) {
  if (!base || !end) return null;
  try {
    const [stat, num] = await Promise.all([
      git(cwd, ['diff', '--no-renames', '--name-status', '-z', base, end]),
      git(cwd, ['diff', '--no-renames', '--numstat', '-z', base, end]),
    ]);
    const parts = stat.split('\0').filter(Boolean);
    const files = new Map();
    for (let i = 0; i + 1 < parts.length; i += 2) files.set(parts[i + 1], { path: parts[i + 1], status: LETTER[parts[i][0]] || 'modified', add: 0, del: 0, binary: false });
    // -z numstat: "add\tdel\tpath\0"
    for (const row of num.split('\0').filter(Boolean)) {
      const [a, d, ...p] = row.split('\t');
      const f = files.get(p.join('\t'));
      if (!f) continue;
      if (a === '-') f.binary = true; else { f.add = +a; f.del = +d; }
    }
    const all = [...files.values()].sort((x, y) => x.path.localeCompare(y.path));
    return {
      base, end, count: all.length,
      add: all.reduce((n, f) => n + f.add, 0), del: all.reduce((n, f) => n + f.del, 0),
      files: all.slice(0, MAX_FILES),
    };
  } catch {
    return null;
  }
}

// The patch for one file, only when the boss asks for it.
export async function fileDiff(cwd, changes, file) {
  if (!changes?.files.some((f) => f.path === file)) throw new Error('That file is not part of this job’s changes.');
  const out = await git(cwd, ['diff', '--no-renames', '--no-color', changes.base, changes.end, '--', file]);
  return out.length > MAX_DIFF ? `${out.slice(0, MAX_DIFF)}\n… diff cut at ${MAX_DIFF / 1024} KB` : out;
}
