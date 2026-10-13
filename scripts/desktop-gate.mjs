#!/usr/bin/env node
// What the desktop app relies on before it hands the office its key: the
// proof route, no key in the output it logs, the port file going away with
// the server, and a CSP on the page. Runs the committed server (git archive
// HEAD, or GATE_REF) from a temp copy with its own data, so work in progress in the tree
// can't change the result. Costs no tokens. Needs no build: it makes a
// two-file dist of its own.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-desktop-gate-'));
const app = path.join(tmp, 'app');
fs.mkdirSync(app);
const REF = process.env.GATE_REF || 'HEAD';
execFileSync('/bin/sh', ['-c', `git -C "${APP}" archive "${REF}" server shared bin package.json web/index.html leaderboard/src/worker.js | tar -x -C "${app}"`]);
fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'), 'dir');
fs.mkdirSync(path.join(tmp, 'projects'));
fs.mkdirSync(path.join(app, 'dist', 'assets'), { recursive: true });
fs.writeFileSync(path.join(app, 'dist', 'index.html'), '<!doctype html><title>Office</title><script type="module" src="/assets/app.js"></script>');
fs.writeFileSync(path.join(app, 'dist', 'assets', 'app.js'), 'export {};');

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok    ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}: ${err.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('hex');

async function run(name, extra, body) {
  const port = 4300 + Math.floor(Math.random() * 600);
  const data = path.join(tmp, `data-${name}`);
  const env = { ...process.env, PORT: String(port), OFFICE_ROOT: path.join(tmp, 'projects'), OFFICE_DATA: data, CLAUDE_BIN: '/usr/bin/true', STANDUP_AT: 'off', BANTER: 'off' };
  delete env.OFFICE_LAN; delete env.OFFICE_DESKTOP; delete env.OFFICE_ALLOWED_HOSTS;
  Object.assign(env, extra);
  const server = spawn(process.execPath, ['server/index.js'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const exited = new Promise((r) => server.on('exit', r));
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const portFile = path.join(data, 'office-port');
  try {
    for (let i = 0; i < 100 && !(/Agent Office open/.test(log) && fs.existsSync(portFile)); i++) await sleep(150);
    assert(/Agent Office open/.test(log), `never started: ${log}`);
    const key = fs.readFileSync(path.join(data, 'office-key'), 'utf8').trim();
    const get = (p, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, { headers, redirect: 'manual' });
    await body({ port, key, get, log: () => log, portFile, stop: async () => { server.kill('SIGTERM'); await exited; } });
  } finally { server.kill('SIGTERM'); await Promise.race([exited, sleep(2000)]); }
}

await run('desktop', { OFFICE_DESKTOP: '1' }, async ({ port, key, get, log, portFile, stop }) => {
  const nonce = crypto.randomBytes(32).toString('hex');

  await check('the proof is HMAC(key, "agent-office-proof:<port>:<nonce>"), asked without the key', async () => {
    const r = await get(`/api/desktop/proof?nonce=${nonce}`);
    assert(r.status === 200, `status ${r.status}`);
    const { proof } = await r.json();
    assert(proof === hmac(key, `agent-office-proof:${port}:${nonce}`), 'proof does not match');
  });
  await check('the port is inside the signed text, so a relayed answer fails on another port', async () => {
    const { proof } = await (await get(`/api/desktop/proof?nonce=${nonce}`)).json();
    assert(proof !== hmac(key, `agent-office-proof:${port + 1}:${nonce}`), 'answer is valid for another port');
    assert(proof !== hmac(key, nonce), 'answer is a bare HMAC of the nonce');
  });
  await check('a fresh nonce gets a fresh answer', async () => {
    const other = crypto.randomBytes(32).toString('hex');
    const a = (await (await get(`/api/desktop/proof?nonce=${nonce}`)).json()).proof;
    const b = (await (await get(`/api/desktop/proof?nonce=${other}`)).json()).proof;
    assert(a !== b, 'same answer for two nonces');
  });
  for (const [label, bad] of [['missing', ''], ['too short', 'ab'.repeat(15)], ['too long', 'ab'.repeat(65)], ['not hex', 'zz'.repeat(16)], ['upper case', 'AB'.repeat(16)], ['with a key smuggled in', `${'a'.repeat(32)}&key=${'0'.repeat(64)}`]]) {
    await check(`a bad nonce (${label}) gets a 400, not a proof`, async () => {
      const r = await get(`/api/desktop/proof?nonce=${encodeURIComponent(bad)}`);
      assert(r.status === 400, `status ${r.status}`);
      assert(!('proof' in (await r.json())), 'answered anyway');
    });
  }
  await check('the proof route still refuses a rebinding Host', async () => {
    // fetch drops a Host header, so this one goes by hand.
    const status = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: `/api/desktop/proof?nonce=${nonce}`, headers: { host: 'evil.example' } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject);
    });
    assert(status === 403, `status ${status}`);
  });
  await check('the proof route still refuses another site', async () => {
    const r = await get(`/api/desktop/proof?nonce=${nonce}`, { origin: 'http://localhost:3000' });
    assert(r.status === 403, `status ${r.status}`);
  });
  await check('the proof route is the only way past the lock: the API still wants the key', async () => {
    const r = await get('/api/settings');
    assert(r.status === 401, `status ${r.status}`);
  });

  await check('with OFFICE_DESKTOP=1 the key is nowhere in the output', () => {
    assert(!log().includes(key), 'key printed');
    assert(!/[?&]key=/.test(log()), 'a ?key= link printed');
    assert(!/On your phone/.test(log()), 'phone QR printed');
    assert(log().includes(`http://localhost:${port}/`), `start line missing: ${log()}`);
  });

  const cookie = { cookie: `office_key_${port}=${key}` };
  await check('the page carries the CSP', async () => {
    const r = await get('/', cookie);
    const csp = r.headers.get('content-security-policy') || '';
    assert(r.status === 200, `status ${r.status}`);
    for (const d of ["script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) assert(csp.includes(d), `missing ${d}: ${csp}`);
    assert(!/unsafe-inline|unsafe-eval/.test(csp.match(/script-src[^;]*/)?.[0] || ''), `script-src loosened: ${csp}`);
  });
  await check('a deep link falls back to the page, CSP included', async () => {
    const r = await get('/some/deep/link', cookie);
    assert(r.status === 200 && (r.headers.get('content-security-policy') || '').includes("script-src 'self'"), `status ${r.status}, csp ${r.headers.get('content-security-policy')}`);
  });
  await check('assets go without the page CSP', async () => {
    const r = await get('/assets/app.js');
    assert(r.status === 200, `status ${r.status}`);
    assert(!r.headers.get('content-security-policy'), 'asset has a CSP');
  });

  await check('office-port names this server while it runs', () => {
    assert(fs.readFileSync(portFile, 'utf8').trim() === String(port), 'wrong port in the file');
  });
  await stop();
  await check('office-port goes when the server stops', () => assert(!fs.existsSync(portFile), 'office-port left behind'));
});

await run('other-port', {}, async ({ port, key, log, portFile, stop }) => {
  await check('without OFFICE_DESKTOP the terminal still gets the key link', () => {
    assert(log().includes(`?key=${key}`), 'no key link for the terminal');
  });
  fs.writeFileSync(portFile, String(port + 1));
  await stop();
  await check("office-port is kept when another office has rewritten it", () => {
    assert(fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').trim() === String(port + 1), 'deleted another office\'s port file');
  });
});

await check('the page source has no inline script for the CSP to block', () => {
  const html = fs.readFileSync(path.join(app, 'web', 'index.html'), 'utf8');
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) || body.trim());
  assert(!inline.length, `inline script: ${inline.map((m) => m[0].slice(0, 80)).join(' | ')}`);
  assert(!/\son[a-z]+\s*=/i.test(html), 'inline event handler');
});

// The leaderboard's IPv6 rate-limit key. worker.js imports cloudflare: modules
// node can't load, so the one function is lifted out of the source.
{
  const src = fs.readFileSync(path.join(app, 'leaderboard', 'src', 'worker.js'), 'utf8');
  const m = /export function addressPrefix\(ip\) \{[\s\S]*?\n\}/.exec(src);
  await check('addressPrefix is where the test expects it', () => assert(m, 'not found in worker.js'));
  if (m) {
    const addressPrefix = new Function(`${m[0].replace(/^export /, '')}; return addressPrefix;`)();
    const cases = [
      ['203.0.113.7', '203.0.113.7'],
      ['::ffff:203.0.113.7', '::ffff:203.0.113.7'],
      ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
      ['2001:db8:1:2:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
      ['2001:0DB8:0001:0002::9', '2001:db8:1:2::/64'],
      ['2001:db8::1', '2001:db8:0:0::/64'],
      ['2001:db8:1::', '2001:db8:1:0::/64'],
      ['fe80::1%en0', 'fe80:0:0:0::/64'],
      ['::1', '0:0:0:0::/64'],
      ['unknown', 'unknown'],
    ];
    for (const [ip, want] of cases) await check(`addressPrefix(${ip}) is ${want}`, () => { const got = addressPrefix(ip); assert(got === want, got); });
    await check('two addresses in one /64 share a limit; the next /64 does not', () => {
      assert(addressPrefix('2001:db8:1:2::a') === addressPrefix('2001:db8:1:2:dead:beef:0:1'), 'same /64 split');
      assert(addressPrefix('2001:db8:1:2::a') !== addressPrefix('2001:db8:1:3::a'), 'different /64s merged');
    });
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
