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
const SKIP = new Set(['node_modules', 'data', '.git', 'launch', 'desktop']);
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

// Getting cloudflared for people who don't have it: a checked download.
{
  const { download } = await import(path.join(APP, 'server', 'cloudflared.js'));
  const { createHash } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const http = (await import('node:http')).default;
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const files = path.join(tmp, 'release');
  fs.mkdirSync(path.join(files, 'pkg'), { recursive: true });
  const binBody = Buffer.from('#!/bin/sh\necho fake cloudflared\n');
  fs.writeFileSync(path.join(files, 'plain'), binBody);
  fs.writeFileSync(path.join(files, 'pkg', 'cloudflared'), binBody);
  execFileSync('tar', ['-czf', path.join(files, 'pack.tgz'), '-C', path.join(files, 'pkg'), 'cloudflared']);
  const srv = http.createServer((req, res) => {
    const f = path.join(files, path.basename(req.url));
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200); res.end(fs.readFileSync(f));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const at = (n) => `http://127.0.0.1:${srv.address().port}/${n}`;
  const dl = path.join(tmp, 'dl');
  await check('a download with the right checksum is installed and runnable', async () => {
    const dest = path.join(dl, 'a', 'cloudflared');
    await download({ url: at('plain'), sha256: sha(binBody), dest });
    assert(fs.readFileSync(dest).equals(binBody) && (fs.statSync(dest).mode & 0o111), 'not installed');
  });
  await check('a .tgz is unpacked and its binary checked too', async () => {
    const dest = path.join(dl, 'b', 'cloudflared');
    await download({ url: at('pack.tgz'), sha256: sha(fs.readFileSync(path.join(files, 'pack.tgz'))), inner: sha(binBody), dest, tgz: true });
    assert(fs.readFileSync(dest).equals(binBody), 'wrong binary');
  });
  await check('a wrong checksum is refused and leaves nothing behind', async () => {
    const dest = path.join(dl, 'c', 'cloudflared');
    let err = null;
    try { await download({ url: at('plain'), sha256: '0'.repeat(64), dest }); } catch (e) { err = e; }
    assert(err && /checksum/.test(err.message) && !fs.existsSync(dest), 'accepted');
    assert(!fs.existsSync(path.dirname(dest)) || fs.readdirSync(path.dirname(dest)).length === 0, 'left files');
  });
  await check('a .tgz whose binary is wrong is refused', async () => {
    const dest = path.join(dl, 'd', 'cloudflared');
    let err = null;
    try { await download({ url: at('pack.tgz'), sha256: sha(fs.readFileSync(path.join(files, 'pack.tgz'))), inner: '0'.repeat(64), dest, tgz: true }); } catch (e) { err = e; }
    assert(err && !fs.existsSync(dest), 'accepted');
  });
  await check('a failed download says so', async () => {
    let err = null;
    try { await download({ url: at('missing'), sha256: '0'.repeat(64), dest: path.join(dl, 'e', 'x') }); } catch (e) { err = e; }
    assert(err && /404/.test(err.message), String(err));
  });
  srv.close();
}

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

// The public address, against a stand-in cloudflared that prints a name the
// way the real one does and then stays up.
const stub = path.join(tmp, 'cloudflared');
const pidFile = path.join(tmp, 'stub.pid');
fs.writeFileSync(stub, `#!${process.execPath}
require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
require('fs').writeFileSync(${JSON.stringify(pidFile)} + '.args', JSON.stringify(process.argv.slice(2)));
console.error('INF Requesting new quick Tunnel on trycloudflare.com...');
setTimeout(() => console.error('INF |  https://quiet-river-demo.trycloudflare.com  |'), 300);
setTimeout(() => console.error('INF Registered tunnel connection connIndex=0'), 900);
setInterval(() => {}, 1000);
`, { mode: 0o755 });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const HOST = 'quiet-river-demo.trycloudflare.com';
const raw = (port, host, headers = {}) => new Promise((resolve, reject) => {
  import('node:http').then(({ default: http }) => http.get({ host: '127.0.0.1', port, path: '/api/repos', headers: { host, ...headers } }, (r) => { r.resume(); resolve(r); }).on('error', reject));
});

await run('tunnel', { OFFICE_CLOUDFLARED: stub, OFFICE_TUNNEL_CHECK: 'off' }, async ({ port, key }) => {
  const cookie = () => `office_key_${port}=${key()}`;
  const base = `http://127.0.0.1:${port}`;
  const status = async () => (await (await fetch(`${base}/api/phone`, { headers: { cookie: cookie() } })).json());
  const toggle = (on) => fetch(`${base}/api/phone/tunnel`, { method: 'POST', headers: { cookie: cookie(), 'content-type': 'application/json' }, body: JSON.stringify({ on }) });
  await check('the tunnel is off until asked', async () => {
    const r = await status();
    assert(r.tunnel.state === 'off' && r.links.length === 0 && !fs.existsSync(pidFile), JSON.stringify(r.tunnel));
  });
  await check('its name is refused before it exists', async () => assert((await raw(port, HOST, { cookie: cookie() })).statusCode === 403, 'accepted'));
  await check('turning it on gives the public link and its QR, once connected', async () => {
    await toggle(true);
    await sleep(500); // the name is out, the connection isn't
    assert((await status()).tunnel.state === 'starting', 'called it on before Cloudflare was connected');
    let r;
    for (let i = 0; i < 40; i++) { r = await status(); if (r.tunnel.state === 'on') break; await sleep(150); }
    assert(r.tunnel.state === 'on' && r.tunnel.url === `https://${HOST}`, JSON.stringify(r.tunnel));
    assert(r.links[0].url === `https://${HOST}/?key=${key()}` && r.links[0].svg.startsWith('<svg'), JSON.stringify(r.links[0]).slice(0, 160));
  });
  await check('cloudflared gets an empty config, not ~/.cloudflared/config.yml', async () => {
    const args = JSON.parse(fs.readFileSync(pidFile + '.args', 'utf8'));
    const cfg = args[args.indexOf('--config') + 1];
    assert(args.includes('--config') && fs.existsSync(cfg) && fs.readFileSync(cfg, 'utf8') === '', JSON.stringify(args));
  });
  await check('the tunnel’s name is served, with the key, and not without it', async () => {
    assert((await raw(port, HOST, { cookie: cookie() })).statusCode === 200, 'refused with key');
    assert((await raw(port, HOST)).statusCode === 401, 'open without key');
    assert((await raw(port, 'other.trycloudflare.com', { cookie: cookie() })).statusCode === 403, 'another tunnel name accepted');
  });
  await check('the key cookie is Secure when it arrives over https', async () => {
    const res = await raw(port, HOST, { 'x-forwarded-proto': 'https' }).then(() => new Promise((resolve, reject) => import('node:http').then(({ default: http }) => http.get({ host: '127.0.0.1', port, path: `/?key=${key()}`, headers: { host: HOST, 'x-forwarded-proto': 'https' } }, (r) => { r.resume(); resolve(r); }).on('error', reject))));
    assert(/;\s*Secure/.test(res.headers['set-cookie']?.[0] || ''), String(res.headers['set-cookie']));
  });
  await check('turning it off closes the tunnel and forgets the name', async () => {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    await toggle(false);
    await sleep(500);
    assert(!alive(pid), 'cloudflared still running');
    assert((await raw(port, HOST, { cookie: cookie() })).statusCode === 403, 'name still accepted');
    assert((await status()).tunnel.state === 'off', 'not off');
  });
});
await run('tunnel-missing', { OFFICE_CLOUDFLARED: path.join(tmp, 'nope'), OFFICE_TUNNEL_CHECK: 'off' }, async ({ port, key }) => {
  await check('without cloudflared it says so, and stays safe', async () => {
    const h = { cookie: `office_key_${port}=${key()}`, 'content-type': 'application/json' };
    await fetch(`http://127.0.0.1:${port}/api/phone/tunnel`, { method: 'POST', headers: h, body: '{"on":true}' });
    await sleep(500);
    const r = await (await fetch(`http://127.0.0.1:${port}/api/phone`, { headers: h })).json();
    assert(r.tunnel.state === 'error' && /couldn.t be started/.test(r.tunnel.error), JSON.stringify(r.tunnel));
  });
  await check('and another website cannot flip the switch', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/phone/tunnel`, { method: 'POST', headers: { cookie: `office_key_${port}=${key()}`, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{"on":true}' });
    assert(res.status === 403, `status ${res.status}`);
  });
});

fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nAll phone checks passed.');
