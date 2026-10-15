#!/usr/bin/env node
// A smoke test: start the office for real, against a stand-in `claude`, and
// check the things that would make it useless if they broke. Needs a build
// (`npm run build`) first. Costs no tokens.
//
// It runs from a copy of the app in a temp folder, with its own data, so it
// can never pick up a live office's state and resume its jobs.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

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
const SKIP = new Set(['node_modules', 'data', '.git', 'launch', 'desktop']);
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
const args = process.argv.slice(2);
const mcpAt = args[args.indexOf('--mcp-config') + 1];
let mcp = null;
try { mcp = { path: mcpAt, mode: fs.statSync(mcpAt).mode & 0o777, body: JSON.parse(fs.readFileSync(mcpAt, 'utf8')) }; } catch {}
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ args, cwd: process.cwd(), key: process.env.ANTHROPIC_API_KEY || null, mcp }) + '\\n');
// The office snapshots the tree as the job starts; a real agent takes seconds
// to make its first edit, so wait like one rather than racing the snapshot.
process.stdin.once('data', (buf) => setTimeout(async () => {
  fs.appendFileSync(${JSON.stringify(record + '.prompts')}, JSON.stringify(String(buf)) + '\\n');
  if (String(buf).includes('CLEAR-ME') && !String(buf).includes('The clear is DONE')) {
    const env = mcp.body.mcpServers.office.env;
    await fetch(env.OFFICE_URL + '/api/agent/clear_context', { method: 'POST', headers: { 'content-type': 'application/json', 'x-office-job': env.OFFICE_JOB, 'x-office-token': env.OFFICE_TOKEN }, body: JSON.stringify({ notes: 'step one is done' }) });
  }
  fs.appendFileSync('README.md', 'edited by the stub\\n');
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'system', subtype: 'init', session_id: 'smoke-session', model: 'stub' });
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it.' }], usage: { input_tokens: 120, cache_read_input_tokens: 5000 } } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 'smoke-session', total_cost_usd: 0, duration_ms: 3000, usage: { input_tokens: 120, output_tokens: 80, cache_read_input_tokens: 5000 } });
  process.exit(0);
}, 2000));
`, { mode: 0o755 });

// A stand-in leaderboard service that remembers what it was sent. The real one
// is checked by leaderboard/test.mjs; this checks what the office sends it.
const sent = [];
const service = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    sent.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body: body ? JSON.parse(body) : null });
    const out = req.url === '/v1/claim' ? { handle: JSON.parse(body).handle } : { ok: true };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});
await new Promise((r) => service.listen(0, '127.0.0.1', r));

const env = { ...process.env, PORT: String(PORT), OFFICE_ROOT: root, CLAUDE_BIN: stub, STANDUP_AT: 'off', AGENT_CLEAR_TOKENS: '1000', BANTER: 'off', OFFICE_LEADERBOARD_URL: `http://127.0.0.1:${service.address().port}` };
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
// The office key, as the browser holds it after opening the printed link.
const keyFile = path.join(app, 'data', 'office-key');
const cookie = () => (fs.existsSync(keyFile) ? `office_key_${PORT}=${fs.readFileSync(keyFile, 'utf8').trim()}` : '');
const get = (p, headers = {}) => fetch(BASE + p, { headers: { cookie: cookie(), ...headers } });
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie() }, body: JSON.stringify(body) });
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
    assert(html.includes('<title>Office</title>'), 'no app shell');
  });
  await check('lists projects from OFFICE_ROOT', async () => {
    const { repos } = await (await get('/api/repos')).json();
    assert(JSON.stringify(repos).includes('storefront'), `got ${JSON.stringify(repos)}`);
  });
  await check('refuses other origins', async () => {
    const res = await get('/api/repos', { origin: 'https://evil.example' });
    assert(res.status === 403, `status ${res.status}`);
  });
  await check('locks the office without its key', async () => {
    const page = await fetch(BASE + '/');
    assert(page.status === 401 && (await page.text()).includes('locked'), `page: status ${page.status}`);
    const api = await fetch(BASE + '/api/repos');
    assert(api.status === 401, `api: status ${api.status}`);
    const wrong = await fetch(BASE + '/?key=' + '0'.repeat(64), { redirect: 'manual' });
    assert(wrong.status === 401 && !wrong.headers.get('set-cookie'), `wrong key: status ${wrong.status}`);
    const asset = await fetch(BASE + '/manifest.webmanifest');
    assert(asset.status === 200, `asset: status ${asset.status}`);
    const st = fs.statSync(keyFile);
    assert((st.mode & 0o077) === 0, `key file mode ${(st.mode & 0o777).toString(8)}`);
  });
  await check('the printed link opens it', async () => {
    const link = /Agent Office open on (\S+)/.exec(log)?.[1];
    assert(link?.includes('?key='), 'no key in the startup line');
    const res = await fetch(link.replace(/localhost/, '127.0.0.1'), { redirect: 'manual' });
    const set = res.headers.get('set-cookie') || '';
    assert(res.status === 303 && res.headers.get('location') === '/', `status ${res.status}`);
    // A MAC of the key, never the key itself.
    const key = fs.readFileSync(keyFile, 'utf8').trim();
    const mac = `office_key_${PORT}=${crypto.createHmac('sha256', key).update(`office-cookie:${PORT}`).digest('hex')}`;
    assert(set.startsWith(mac + ';') && !set.includes(key) && /HttpOnly/.test(set) && /SameSite=Strict/.test(set), set);
    const page = await fetch(BASE + '/', { headers: { cookie: mac } });
    assert(page.status === 200 && !page.headers.get('set-cookie'), `with the cookie: status ${page.status}`);
  });
  await check('swaps a cookie that holds the key for its MAC', async () => {
    const res = await fetch(BASE + '/', { headers: { cookie: cookie() } });
    const set = res.headers.get('set-cookie') || '';
    assert(res.status === 200 && set.startsWith(`office_key_${PORT}=`) && !set.includes(fs.readFileSync(keyFile, 'utf8').trim()), `status ${res.status}, ${set}`);
  });
  await check('the socket needs the key too', async () => {
    const open = (headers) => new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers });
      ws.on('message', (d) => { ws.close(); resolve(JSON.parse(d).t); });
      ws.on('error', () => resolve('refused'));
      ws.on('unexpected-response', (_, res) => resolve(`refused ${res.statusCode}`));
    });
    const without = await open({});
    assert(without.startsWith('refused'), `without the key: ${without}`);
    const withKey = await open({ cookie: cookie() });
    assert(withKey === 'hello', `with the key: ${withKey}`);
  });
  await check('refuses other localhost ports', async () => {
    const res = await get('/api/repos', { origin: 'http://localhost:3000' });
    assert(res.status === 403, `status ${res.status}`);
    const own = await get('/api/repos', { origin: `http://localhost:${PORT}` });
    assert(own.status === 200, `own origin: status ${own.status}`);
  });
  await check('survives a malformed path', async () => {
    const res = await get('/%E0');
    assert(res.status === 400, `status ${res.status}`);
    assert((await get('/api/repos')).ok, 'server down after it');
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
  await check("keeps the job's office token off claude's command line", async () => {
    const call = calls()[0];
    assert(call?.mcp, 'no readable --mcp-config file');
    const token = call.mcp.body.mcpServers?.office?.env?.OFFICE_TOKEN;
    assert(token && call.mcp.body.mcpServers.office.env.OFFICE_JOB, 'the config file has no job or token');
    assert(!call.args.join(' ').includes(token), 'the token is on the command line');
    assert(call.mcp.mode === 0o600, `config file mode ${call.mcp.mode.toString(8)}`);
    await until('the config file to go with the session', () => !fs.existsSync(call.mcp.path));
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

  await check('counts the job, tokens and agent time, without cached context', async () => {
    const lb = await (await get('/api/leaderboard')).json();
    assert(lb.configured && !lb.joined, JSON.stringify(lb));
    assert(lb.today.jobs === 1 && lb.today.tokens === 200 && lb.today.seconds === 3, JSON.stringify(lb.today));
  });
  await check('sends nothing before joining', async () => {
    await sleep(500);
    assert(sent.length === 0, JSON.stringify(sent));
  });
  await check('joining claims a handle and shares only the day counters', async () => {
    const res = await post('/api/leaderboard', { handle: 'smoke-tester' });
    assert(res.status === 200 && (await res.json()).joined, `status ${res.status}`);
    const put = await until('the counters to be sent', () => sent.find((r) => r.method === 'PUT'));
    const claim = sent.find((r) => r.url === '/v1/claim');
    assert(claim && claim.body.handle === 'smoke-tester', JSON.stringify(sent));
    assert(/^Bearer [0-9a-f]{64}$/.test(put.auth) && put.auth === claim.auth, 'secret not used consistently');
    assert(put.body.days.length === 1 && Object.keys(put.body).join() === 'days', JSON.stringify(put.body));
    const day = put.body.days[0];
    assert(Object.keys(day).sort().join() === 'day,jobs,seconds,tokens' && day.jobs === 1 && day.tokens === 200 && day.seconds === 3, JSON.stringify(day));
    const idFile = path.join(app, 'data', 'leaderboard.json');
    assert((fs.statSync(idFile).mode & 0o077) === 0, 'identity file is readable by others');
  });
  await check('leaving asks the service to forget and clears the identity', async () => {
    const res = await fetch(BASE + '/api/leaderboard', { method: 'DELETE', headers: { cookie: cookie() } });
    assert(res.status === 200 && !(await res.json()).joined, `status ${res.status}`);
    assert(sent.some((r) => r.method === 'DELETE' && r.url === '/v1/me'), JSON.stringify(sent));
    assert(!fs.existsSync(path.join(app, 'data', 'leaderboard.json')), 'identity kept');
  });
  await check('clear_context restarts the job in a fresh session with the notes', async () => {
    const before = calls().length;
    const res = await post('/api/jobs', { repo: 'storefront', prompt: 'CLEAR-ME then finish', mode: 'edit' });
    const j = await res.json();
    await until('a second session', () => calls().length >= before + 2);
    const [first, second] = calls().slice(before);
    assert(!first.args.includes('--resume') && !second.args.includes('--resume'), 'the cleared session was resumed');
    const state = path.join(app, 'data', 'state.json');
    const done = await until('the job to finish', () => {
      try { const x = JSON.parse(fs.readFileSync(state, 'utf8')).jobs.find((y) => y.id === j.id); return x && x.status === 'done' ? x : null; } catch { return null; }
    });
    assert(done.clears === 1 && !done.clearNote, JSON.stringify({ clears: done.clears, note: done.clearNote }));
    assert(done.log.some((l) => /Cleared context/.test(l.summary)), 'no log line');
  });
  await check('a heavy session is nudged to clear on its next message, once', async () => {
    const prompts = () => fs.readFileSync(record + '.prompts', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const res = await post('/api/jobs', { repo: 'storefront', prompt: 'Heavy job', mode: 'edit' });
    const j = await res.json();
    const state = path.join(app, 'data', 'state.json');
    const at = () => { try { return JSON.parse(fs.readFileSync(state, 'utf8')).jobs.find((y) => y.id === j.id); } catch { return null; } };
    await until('the job to finish', () => (at()?.status === 'done' ? true : null));
    const n = prompts().length;
    assert(!prompts().at(-1).includes('Office note'), 'nudged on the first brief');
    const r = await post(`/api/jobs/${j.id}/reply`, { message: 'one more thing' });
    assert(r.status < 300, `reply status ${r.status}`);
    await until('the resumed session', () => prompts().length > n);
    const got = prompts().at(-1);
    assert(got.includes('one more thing') && /Office note: your context is at 5k tokens/.test(got), got);
  });
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
  service.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.log(`\n${failed} failed. Server output:\n${log}`);
  process.exit(1);
}
console.log('\nall good');
