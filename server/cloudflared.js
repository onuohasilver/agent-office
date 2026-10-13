// Where the office gets `cloudflared` for the phone's public address, so that
// nobody has to install it: the one on the PATH if there is one, otherwise a
// pinned release downloaded once from Cloudflare's GitHub into the data
// folder and checked against the checksum below before it is ever run.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const VERSION = '2026.10.0';
export const BASE = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}`;
// Checked against the downloads themselves. For macOS the release notes give
// the binary inside the .tgz (`inner`); `sha256` is always the file fetched,
// and matches GitHub's own digest for it.
export const ASSETS = {
  'darwin-arm64': { name: 'cloudflared-darwin-arm64.tgz', sha256: 'a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70', inner: '72edfd3eea463aef4d5cb89e2e209cecb048cc756c2b01915de2e0ad7cb39830' },
  'darwin-x64': { name: 'cloudflared-darwin-amd64.tgz', sha256: '903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f', inner: '0560c9ab7281ac3f746055323623ed23bc0405b6dab9400474020cba33a978da' },
  'linux-x64': { name: 'cloudflared-linux-amd64', sha256: 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db' },
  'linux-arm64': { name: 'cloudflared-linux-arm64', sha256: 'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08' },
  'linux-arm': { name: 'cloudflared-linux-arm', sha256: '1dbe8e4ec17e74bb7f49cf91db6a4903bd0f9fe41984556c7503e40b765fd099' },
  'win32-x64': { name: 'cloudflared-windows-amd64.exe', sha256: '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c' },
  'win32-ia32': { name: 'cloudflared-windows-386.exe', sha256: '0630a8779e9823a1a3b091698b8e71874e0f7b205559219f52fdd301466b5546' },
};

const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

function onPath() {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir, exe('cloudflared'));
    try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Fetch url to dest, refusing it unless its SHA-256 is sha256. A .tgz is
// unpacked and its cloudflared kept, which must match inner. Nothing
// half-written is left at dest.
export async function download({ url, sha256, inner, dest, tgz = false }) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok) throw new Error(`Couldn’t download cloudflared (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== sha256) throw new Error('The cloudflared download didn’t match its checksum, so it wasn’t used.');
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  const work = fs.mkdtempSync(path.join(dir, '.dl-'));
  try {
    let bin;
    if (tgz) {
      const archive = path.join(work, 'cf.tgz');
      fs.writeFileSync(archive, buf);
      const r = spawnSync('tar', ['-xzf', archive, '-C', work], { stdio: 'ignore' });
      bin = path.join(work, 'cloudflared');
      if (r.status !== 0 || !fs.existsSync(bin)) throw new Error('Couldn’t unpack cloudflared.');
      if (sha(fs.readFileSync(bin)) !== inner) throw new Error('The cloudflared download didn’t match its checksum, so it wasn’t used.');
    } else {
      bin = path.join(work, 'bin');
      fs.writeFileSync(bin, buf);
    }
    fs.chmodSync(bin, 0o755);
    fs.renameSync(bin, dest);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return dest;
}

let pending = null;
// The cloudflared to run. onStep('download') says a download is starting.
export function findCloudflared({ dataDir, onStep = () => {} }) {
  if (process.env.OFFICE_CLOUDFLARED) return Promise.resolve(process.env.OFFICE_CLOUDFLARED);
  const found = onPath();
  if (found) return Promise.resolve(found);
  const dest = path.join(dataDir, 'bin', exe(`cloudflared-${VERSION}`));
  if (fs.existsSync(dest)) return Promise.resolve(dest);
  const asset = ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) return Promise.reject(new Error(`There’s no cloudflared for ${process.platform}-${process.arch} to download. Install it yourself and try again.`));
  onStep('download');
  pending ||= download({ url: `${BASE}/${asset.name}`, sha256: asset.sha256, inner: asset.inner, dest, tgz: asset.name.endsWith('.tgz') }).finally(() => { pending = null; });
  return pending;
}
