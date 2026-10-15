#!/usr/bin/env node
// Click-an-agent chat: the endpoint answers in character from one cheap call,
// knows what the agent is doing, carries the chat so far, and refuses what it
// can't do. Runs from a copy of the app with a stand-in `claude`; costs no tokens.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4900 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-talk-'));
const app = path.join(tmp, 'app');
const SKIP = new Set(['node_modules', 'data', '.git', 'launch', 'desktop']);
fs.cpSync(APP, app, { recursive: true, filter: (src) => !SKIP.has(path.relative(APP, src).split(path.sep)[0]) });
fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'), 'dir');
fs.mkdirSync(path.join(tmp, 'projects'));

const seen = path.join(tmp, 'stdin.jsonl');
const stub = path.join(tmp, 'claude');
fs.writeFileSync(stub, `#!${process.execPath}
let buf = '';
process.stdin.on('data', (d) => (buf += d));
process.stdin.on('end', () => {
  require('fs').appendFileSync(${JSON.stringify(seen)}, JSON.stringify({ args: process.argv.slice(2), buf }) + '\\n');
  const reply = buf.includes('Boss: fail') ? '' : 'All good over here.';
  process.stdout.write(JSON.stringify({ structured_output: { reply }, total_cost_usd: 0.001 }));
});
`, { mode: 0o755 });

const env = { ...process.env, PORT: String(PORT), OFFICE_ROOT: path.join(tmp, 'projects'), CLAUDE_BIN: stub, STANDUP_AT: 'off', BANTER: 'off' };
delete env.ANTHROPIC_API_KEY;
const server = spawn(process.execPath, ['server/index.js'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`ok    ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}: ${err.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const keyFile = path.join(app, 'data', 'office-key');
const cookie = () => (fs.existsSync(keyFile) ? `office_key_${PORT}=${fs.readFileSync(keyFile, 'utf8').trim()}` : '');
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie() }, body: JSON.stringify(body) });
const calls = () => (fs.existsSync(seen) ? fs.readFileSync(seen, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

try {
  for (const end = Date.now() + 15000; ; await sleep(150)) {
    try { if ((await fetch(BASE + '/api/repos', { headers: { cookie: cookie() } })).ok) break; } catch {}
    if (Date.now() > end) throw new Error('server did not start');
  }

  await check('an agent on the floor answers', async () => {
    const r = await post('/api/staff/tunde/talk', { text: 'how is it going?' });
    const body = await r.json();
    assert(r.status === 200 && body.reply === 'All good over here.', `${r.status} ${JSON.stringify(body)}`);
  });
  await check('the call is sheet, state and question, with no tools', async () => {
    const { args, buf } = calls().at(-1);
    assert(args.includes('--tools') && args[args.indexOf('--tools') + 1] === '', 'tools not switched off');
    assert(buf.includes('You are Tunde') && buf.includes('between jobs') && buf.includes('Boss: how is it going?'), buf);
    assert(buf.includes('This chat has just started.'), 'no fresh-chat line');
  });
  await check('earlier turns ride along, capped', async () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ who: i % 2 ? 'them' : 'you', text: `turn ${i}` }));
    await post('/api/staff/tunde/talk', { text: 'and now?', history });
    const { buf } = calls().at(-1);
    assert(buf.includes('Boss: turn 4') && buf.includes('Tunde: turn 9') && !buf.includes('turn 3'), buf);
  });
  await check('an empty message is refused without a call', async () => {
    const n = calls().length;
    const r = await post('/api/staff/tunde/talk', { text: '   ' });
    assert(r.status === 400 && calls().length === n, `status ${r.status}, calls ${calls().length - n}`);
  });
  await check('someone who is not here is refused', async () => {
    const n = calls().length;
    const r = await post('/api/staff/nobody/talk', { text: 'hi' });
    assert(r.status === 400 && calls().length === n, `status ${r.status}`);
  });
  await check('a failed call is a clean error and frees the agent', async () => {
    const r = await post('/api/staff/tunde/talk', { text: 'fail' });
    assert(r.status === 400 && typeof (await r.json()).error === 'string', `status ${r.status}`);
    const again = await post('/api/staff/tunde/talk', { text: 'ok now' });
    assert(again.status === 200, `status ${again.status}`);
  });
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) { console.log(`\n${failed} failed. Server output:\n${log}`); process.exit(1); }
console.log('\nall good');
