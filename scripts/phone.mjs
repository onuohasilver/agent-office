#!/usr/bin/env node
// The phone link: the QR the office prints and shows, and what OFFICE_LAN
// does and does not let in. Runs the real server twice from a temp copy with
// its own data, once as it ships (loopback only) and once with the LAN on.
// Costs no tokens. Needs a build.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!fs.existsSync(path.join(APP, 'dist', 'index.html'))) { console.error('No build. Run `npm run build` first.'); process.exit(1); }

const { lanAddresses, phoneLinks, qrText } = await import(path.join(APP, 'server', 'phone.js'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-phone-'));
const app = path.join(tmp, 'app');
const SKIP = new Set(['node_modules', 'data', '.git', 'launch']);
fs.cpSync(APP, app, { recursive: true, filter: (src) => !SKIP.has(path.relative(APP, src).split(path.sep)[0]) });
fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'), 'dir');
fs.mkdirSync(path.join(tmp, 'projects'));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok    ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}: ${err.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Which private addresses this machine has: without one, the LAN half can't run.
const lan = lanAddresses();

await check('only private IPv4 addresses are offered', () => {
  const fake = { en0: [{ family: 'IPv4', internal: false, address: '192.168.1.9' }, { family: 'IPv4', internal: false, address: '100.64.0.2' }, { family: 'IPv4', internal: false, address: '169.254.1.1' }, { family: 'IPv4', internal: false, address: '8.8.8.8' }, { family: 'IPv6', internal: false, address: 'fe80::1' }, { family: 'IPv4', internal: true, address: '127.0.0.1' }, { family: 'IPv4', internal: false, address: '172.31.0.4' }, { family: 'IPv4', internal: false, address: '172.32.0.4' }, { family: 'IPv4', internal: false, address: '10.0.0.7' }] };
  assert(JSON.stringify(lanAddresses(fake)) === JSON.stringify(['192.168.1.9', '172.31.0.4', '10.0.0.7']), JSON.stringify(lanAddresses(fake)));
});
await check('a named host comes before the LAN, and localhost is never offered', () => {
  const l = phoneLinks({ key: 'k', port: 4317, lan: true, hosts: ['localhost', 'my-mac.ts.net'], addresses: ['192.168.1.9'] });
  assert(l[0].url === 'https://my-mac.ts.net/?key=k' && l[1].url === 'http://192.168.1.9:4317/?key=k' && l.length === 2, JSON.stringify(l));
});
await check('no link, and so no QR, unless the boss opted in', () => {
  assert(phoneLinks({ key: 'k', port: 1, lan: false, hosts: [], addresses: ['10.0.0.1'] }).length === 0, 'offered a link');
});
await check('the terminal QR is drawn', () => {
  const t = qrText('http://10.0.0.7:4317/?key=' + 'a'.repeat(64));
  assert(t.split('\n').length > 15 && /[▀▄█]/.test(t), 'nothing drawn');
});

async function run(name, extra, body) {
  const port = 4300 + Math.floor(Math.random() * 600);
  const data = path.join(tmp, `data-${name}`);
  const env = { ...process.env, PORT: String(port), OFFICE_ROOT: path.join(tmp, 'projects'), OFFICE_DATA: data, CLAUDE_BIN: '/usr/bin/true', STANDUP_AT: 'off', BANTER: 'off', ...extra };
  delete env.OFFICE_LAN; Object.assign(env, extra);
  const server = spawn(process.execPath, ['server/index.js'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 100 && !/Agent Office open/.test(log); i++) await sleep(150);
    assert(/Agent Office open/.test(log), `never started: ${log}`);
    await body({ port, log: () => log, key: () => fs.readFileSync(path.join(data, 'office-key'), 'utf8').trim() });
  } finally { server.kill('SIGTERM'); await sleep(200); }
}

await run('default', {}, async ({ port, log, key }) => {
  const cookie = () => `office_key_${port}=${key()}`;
  await check('as shipped, nothing is printed for a phone', () => assert(!/On your phone/.test(log()), log()));
  await check('as shipped, there are no phone links', async () => {
    const r = await (await fetch(`http://127.0.0.1:${port}/api/phone`, { headers: { cookie: cookie() } })).json();
    assert(r.lan === false && r.links.length === 0, JSON.stringify(r));
  });
  if (!lan.length) return;
  await check('as shipped, the LAN address does not connect', async () => {
    let got = 'connected';
    try { await fetch(`http://${lan[0]}:${port}/`, { signal: AbortSignal.timeout(3000) }); } catch { got = 'refused'; }
    assert(got === 'refused', 'the office answered on the LAN');
  });
});

if (!lan.length) console.log('skip  LAN mode: this machine has no private network address');
else await run('lan', { OFFICE_LAN: '1' }, async ({ port, log, key }) => {
  const addr = lan[0], cookie = () => `office_key_${port}=${key()}`;
  const link = `http://${addr}:${port}/?key=${key()}`;
  await check('prints the link and its QR at start', () => {
    assert(log().includes(`On your phone, scan this (${addr}:${port})`) && log().includes(link) && /[▀▄█]/.test(log()), log());
  });
  await check('the phone link opens the office and hands over the cookie', async () => {
    const res = await fetch(link, { redirect: 'manual' });
    assert(res.status === 303 && /office_key_\d+=/.test(res.headers.get('set-cookie') || ''), `status ${res.status}`);
    const page = await fetch(`http://${addr}:${port}/`, { headers: { cookie: cookie() } });
    assert(page.status === 200 && (await page.text()).includes('<title>Office</title>'), 'no app shell');
  });
  await check('the LAN address without the key is locked', async () => {
    assert((await fetch(`http://${addr}:${port}/`)).status === 401, 'not locked');
    assert((await fetch(`http://${addr}:${port}/api/jobs`)).status === 401, 'api not locked');
  });
  await check('/api/phone gives the link with a QR', async () => {
    const r = await (await fetch(`http://${addr}:${port}/api/phone`, { headers: { cookie: cookie() } })).json();
    assert(r.lan && r.links[0].url === link && r.links[0].svg.startsWith('<svg'), JSON.stringify(r).slice(0, 200));
  });
  await check('a made-up Host is still refused (rebinding)', async () => {
    const res = await new Promise((resolve, reject) => {
      import('node:http').then(({ default: http }) => http.get({ host: addr, port, path: '/api/repos', headers: { host: `evil.example:${port}`, cookie: cookie() } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject));
    });
    assert(res === 403, `status ${res}`);
  });
  await check('another site on the LAN address is refused', async () => {
    const res = await fetch(`http://${addr}:${port}/api/repos`, { headers: { cookie: cookie(), origin: `http://${addr}:9999` } });
    assert(res.status === 403, `status ${res.status}`);
  });
  await check('a LAN address that is not this machine is refused as Host', async () => {
    const res = await new Promise((resolve, reject) => {
      import('node:http').then(({ default: http }) => http.get({ host: addr, port, path: '/api/repos', headers: { host: `10.254.254.254:${port}`, cookie: cookie() } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject));
    });
    assert(res === 403, `status ${res}`);
  });
});

fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nAll phone checks passed.');
