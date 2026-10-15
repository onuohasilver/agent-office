// Edit a project's files from the office: list a folder, read a text file,
// save it back. Everything stays inside one project folder (symlinks that
// lead out are refused), .git is off limits, and a save only lands if the
// file is still as it was when it was opened, so an agent mid-job and the
// boss never silently overwrite each other.

import fs from 'node:fs';
import path from 'node:path';

export const MAX_BYTES = 1024 * 1024;
const HIDDEN = new Set(['.git', 'node_modules', '.DS_Store']);

const fail = (code, message) => Object.assign(new Error(message), { code });

// The real path of `rel` inside `root`, or an error. A file that doesn't
// exist yet is checked through its nearest folder that does.
function resolve(root, rel, { mustExist = true } = {}) {
  if (typeof rel !== 'string' || rel.includes('\0')) throw fail(400, 'Bad path.');
  const parts = rel.split(/[\/\\]+/).filter((p) => p && p !== '.');
  if (parts.includes('..')) throw fail(403, 'That path leads outside the project.');
  if (parts.some((p) => p.toLowerCase() === '.git')) throw fail(403, 'The .git folder is off limits.');
  const realRoot = fs.realpathSync(root);
  const abs = path.join(realRoot, ...parts);
  let probe = abs;
  for (;;) {
    try { fs.lstatSync(probe); break; } catch {
      if (mustExist && probe === abs) throw fail(404, 'No such file.');
      const up = path.dirname(probe);
      if (up === probe) throw fail(404, 'No such file.');
      probe = up;
    }
  }
  const real = fs.realpathSync(probe);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw fail(403, 'That path leads outside the project.');
  return { abs, rel: parts.join('/'), realRoot };
}

export function list(root, rel = '') {
  const { abs, rel: at } = resolve(root, rel);
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (err) {
    throw fail(err.code === 'ENOTDIR' ? 400 : 404, err.code === 'ENOTDIR' ? 'That is a file, not a folder.' : 'No such folder.');
  }
  const out = [];
  for (const e of entries) {
    if (HIDDEN.has(e.name)) continue;
    // A link is shown as what it points to, if that is still inside.
    let st;
    try { st = fs.statSync(path.join(abs, e.name)); resolve(root, [at, e.name].filter(Boolean).join('/')); } catch { continue; }
    out.push({ name: e.name, dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size });
  }
  out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { path: at, entries: out };
}

export function read(root, rel) {
  const { abs, rel: at } = resolve(root, rel);
  const st = fs.statSync(abs);
  if (!st.isFile()) throw fail(400, 'That is a folder, not a file.');
  if (st.size > MAX_BYTES) throw fail(413, `Too big to edit here (${Math.round(st.size / 1024)} KB; the limit is ${MAX_BYTES / 1024} KB).`);
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) throw fail(415, 'That looks like a binary file, so it can’t be edited here.');
  return { path: at, text: buf.toString('utf8'), mtime: st.mtimeMs, size: st.size };
}

// A PDF to show in the viewer: its real path and size, or an error. Only files
// that are really PDFs are served, whatever they are called.
export function pdf(root, rel) {
  const { abs } = resolve(root, rel);
  const st = fs.statSync(abs);
  if (!st.isFile()) throw fail(400, 'That is a folder, not a file.');
  if (!/\.pdf$/i.test(abs)) throw fail(415, 'That is not a PDF.');
  const fd = fs.openSync(abs, 'r');
  const head = Buffer.alloc(5);
  try { fs.readSync(fd, head, 0, 5, 0); } finally { fs.closeSync(fd); }
  if (head.toString('latin1') !== '%PDF-') throw fail(415, 'That file is not a valid PDF.');
  return { abs, size: st.size };
}

// `mtime` is what read() gave; null means the file must not exist yet.
export function write(root, rel, text, mtime) {
  if (typeof text !== 'string') throw fail(400, 'Nothing to save.');
  if (Buffer.byteLength(text) > MAX_BYTES) throw fail(413, `Too big to save here (the limit is ${MAX_BYTES / 1024} KB).`);
  const { abs, rel: at } = resolve(root, rel, { mustExist: false });
  if (!at) throw fail(400, 'Which file?');
  let st = null;
  try { st = fs.statSync(abs); } catch {}
  if (st?.isDirectory()) throw fail(400, 'That is a folder.');
  if (st && mtime !== st.mtimeMs) throw fail(409, 'This file changed on disk since you opened it. Reload it to see what changed.');
  if (!st && mtime != null) throw fail(409, 'This file was deleted since you opened it.');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // Written beside it and renamed, so a crash never leaves half a file, and
  // the file keeps its permissions.
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: st ? st.mode & 0o7777 : 0o644 });
    fs.renameSync(tmp, abs);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw fail(500, `Could not save: ${err.message}`);
  }
  const now = fs.statSync(abs);
  return { path: at, mtime: now.mtimeMs, size: now.size };
}
