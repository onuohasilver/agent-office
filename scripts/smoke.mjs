#!/usr/bin/env node
// A smoke test: start the office for real, against a stand-in `claude`, and
// check the things that would make it useless if they broke. Needs a build
// (`npm run build`) first. Costs no tokens.
//
// It runs from a copy of the app in a temp folder, with its own data, so it
// can never pick up a live office's state and resume its jobs.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4300 + Math.floor(Math.random() * 600);
const BASE = `http://127.0.0.1:${PORT}`;

if (!fs.existsSync(path.join(APP, 'dist', 'index.html'))) {
  console.error('No build. Run `npm run build` first.');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-smoke-'));
const app = path.join(tmp, 'app');
const root = path.join(tmp, 'projects');
const record = path.join(tmp, 'claude-calls.jsonl');

// The app, minus anything stateful.
const SKIP = new Set(['node_modules', 'data', '.git', 'launch']);
fs.cpSync(APP, app, { recursive: true, filter: (src) => !SKIP.has(path.relative(APP, src).split(path.sep)[0]) });
fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'), 'dir');

// One project, a git repo, so "what changed" has something to snapshot.
const project = path.join(root, 'storefront');
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(project, 'README.md'), 'hello\n');
const git = (...args) => execFileSync('git', args, { cwd: project, stdio: 'ignore' });
git('init', '-q');
git('add', '.');
git('-c', 'user.email=smoke@example.com', '-c', 'user.name=smoke', 'commit', '-qm', 'init');

// The stand-in records how it was called and what it was given, edits a file
// the way an agent would, and reports a finished turn.
const stub = path.join(tmp, 'claude');
fs.writeFileSync(stub, `#!${process.execPath}
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), key: process.env.ANTHROPIC_API_KEY || null }) + '\\n');
// The office snapshots the tree as the job starts; a real agent takes seconds
// to make its first edit, so wait like one rather than racing the snapshot.
process.stdin.once('data', () => setTimeout(() => {
  fs.appendFileSync('README.md', 'edited by the stub\\n');
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'system', subtype: 'init', session_id: 'smoke-session', model: 'stub' });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 'smoke-session', total_cost_usd: 0 });
  process.exit(0);
}, 2000));
`, { mode: 0o755 });

const env = { ...process.env, PORT: String(PORT), OFFICE_ROOT: root, CLAUDE_BIN: stub, STANDUP_AT: 'off', BANTER: 'off' };
delete env.ANTHROPIC_API_KEY;
const server = spawn(process.execPath, ['server/index.js'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok    ${name}`); }
  catch (err) { failed++; console.log(`FAIL  ${name}: ${err.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const get = (p, headers) => fetch(BASE + p, { headers });
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const calls = () => (fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
async function until(what, fn, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
    const v = await fn();
    if (v) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
}

try {
  await until('the server to listen', async () => { try { return (await get('/api/repos')).ok; } catch { return false; } });

  await check('serves the web app', async () => {
    const html = await (await get('/')).text();
    assert(html.includes('<title>Agent Office</title>'), 'no app shell');
  });
  await check('lists projects from OFFICE_ROOT', async () => {
    const { repos } = await (await get('/api/repos')).json();
    assert(JSON.stringify(repos).includes('storefront'), `got ${JSON.stringify(repos)}`);
  });
  await check('refuses other origins', async () => {
    const res = await get('/api/repos', { origin: 'https://evil.example' });
    assert(res.status === 403, `status ${res.status}`);
  });
  await check('refuses other hosts', async () => {
    // fetch won't send a Host header of our choosing, so this one goes raw.
    const status = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: PORT, path: '/api/repos', headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert(status === 403, `status ${status}`);
  });
  await check('starts on the Claude Code login, no key', async () => {
    const a = await (await get('/api/auth')).json();
    assert(a.mode === 'login' && !a.keySet, JSON.stringify(a));
  });
  await check('rejects a malformed API key without calling out', async () => {
    const res = await post('/api/auth', { mode: 'apikey', key: 'not-a-key' });
    assert(res.status === 400, `status ${res.status}`);
  });

  let job;
  await check('runs a job through claude', async () => {
    const res = await post('/api/jobs', { repo: 'storefront', prompt: 'Add a line to the README', mode: 'edit' });
    assert(res.status === 201, `status ${res.status}`);
    job = await res.json();
    const call = await until('claude to be started', () => calls()[0]);
    assert(call.args.includes('-p'), 'not headless');
    assert(call.args.join(' ').includes('--permission-mode acceptEdits'), 'clearance not passed');
    assert(fs.realpathSync(call.cwd) === fs.realpathSync(project), `ran in ${call.cwd}`);
    assert(call.key === null, 'an API key reached claude in login mode');
  });
  await check('the job finishes and records what changed', async () => {
    assert(job, 'no job');
    const state = path.join(app, 'data', 'state.json');
    const done = await until('the job to finish with its changes', () => {
      try {
        const j = JSON.parse(fs.readFileSync(state, 'utf8')).jobs.find((x) => x.id === job.id);
        return j && j.status !== 'working' && j.status !== 'queued' && j.changes ? j : null;
      } catch { return null; }
    });
    assert(done.changes.count === 1 && done.changes.files[0].path === 'README.md', JSON.stringify(done.changes));
  });
  // The terminal's native half. node-pty is optional, so a machine without it
  // skips this; one with it must be able to start a shell. (1.1.0 installed
  // fine, then couldn't spawn anything on macOS.)
  let pty = null;
  try { pty = await import('node-pty'); } catch {}
  if (pty) {
    await check('node-pty can start a shell', async () => {
      const out = await new Promise((resolve, reject) => {
        let text = '';
        const p = pty.spawn('/bin/sh', ['-c', 'echo pty-$((40+2))'], { cols: 80, rows: 10, cwd: tmp, env: process.env });
        p.onData((d) => (text += d));
        p.onExit(() => resolve(text));
        setTimeout(() => reject(new Error('no exit within 5s')), 5000);
      });
      assert(out.includes('pty-42'), `got ${JSON.stringify(out)}`);
    });
  } else console.log('skip  node-pty is not installed');
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.log(`\n${failed} failed. Server output:\n${log}`);
  process.exit(1);
}
console.log('\nall good');
