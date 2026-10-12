import fs from 'node:fs';
import path from 'node:path';

// Finds a project's own app icon or favicon so the office can show it beside
// the project's name. Looks in the usual places, then a shallow scan.

const TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.expo', 'Pods', 'vendor', 'coverage', 'out', 'target', 'data', 'DerivedData']);
const NAME = /^(favicon|app-?icon|apple-touch-icon|icon|logo|ic_launcher)([-_.@x\d\w]*)\.(svg|png|ico|jpe?g|webp)$/i;
const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 4;
const MAX_VISITS = 1500;

const score = (rel, size) => {
  const parts = rel.split(path.sep);
  const base = parts[parts.length - 1].toLowerCase();
  const ext = path.extname(base);
  let s = 0;
  if (/^(app-?icon|icon)\./.test(base)) s += 40;
  else if (/^apple-touch-icon/.test(base)) s += 36;
  else if (/^favicon/.test(base)) s += 30;
  else if (/^logo/.test(base)) s += 20;
  else s += 10;
  if (ext === '.svg') s += 12; else if (ext === '.png') s += 8; else if (ext === '.ico') s -= 4;
  if (parts.some((p) => /^(public|assets|static|resources|app|icons?|images|web)$/i.test(p))) s += 6;
  if (parts.some((p) => /^(test|tests|__tests__|docs?|examples?|fixtures?|storybook|screenshots?)$/i.test(p))) s -= 25;
  s -= (parts.length - 1) * 3;
  s += Math.min(size / 20000, 4); // among equals, the sharper one
  return s;
};

function scan(root) {
  const found = [];
  let visits = 0;
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++visits > MAX_VISITS) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.') && depth < MAX_DEPTH) {
          // iOS keeps its icons in an appiconset; the biggest PNG is the one to use.
          if (e.name === 'AppIcon.appiconset') {
            try {
              const pngs = fs.readdirSync(full).filter((f) => /\.png$/i.test(f)).map((f) => [f, fs.statSync(path.join(full, f)).size]).sort((a, b) => b[1] - a[1]);
              if (pngs[0] && pngs[0][1] <= MAX_BYTES) found.push({ full: path.join(full, pngs[0][0]), score: 38 - depth * 3 });
            } catch {}
          } else walk(full, depth + 1);
        }
      } else if (e.isFile() && NAME.test(e.name)) {
        try {
          const size = fs.statSync(full).size;
          if (size > 0 && size <= MAX_BYTES) found.push({ full, score: score(path.relative(root, full), size) });
        } catch {}
      }
    }
  };
  walk(root, 0);
  return found.sort((a, b) => b.score - a.score)[0]?.full || null;
}

const cache = new Map(); // repo dir -> { at, file }
const TTL = 5 * 60 * 1000;

// Returns { file, type } for a project folder, or null when it has no icon.
export function findIcon(dir) {
  const hit = cache.get(dir);
  if (hit && Date.now() - hit.at < TTL) return hit.file;
  let file = null;
  try {
    const found = scan(dir);
    const real = found && fs.realpathSync(found);
    // A symlink must not lead out of the project.
    if (real && real.startsWith(fs.realpathSync(dir) + path.sep)) {
      const type = TYPES[path.extname(real).toLowerCase()];
      if (type) file = { file: real, type };
    }
  } catch {}
  cache.set(dir, { at: Date.now(), file });
  return file;
}
