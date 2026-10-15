#!/usr/bin/env node
// Keeping the agents from sinking the laptop: what a job leaves running is
// stopped when it ends (unless kept), heavy runs go one at a time, and jobs
// wait while too many agents are working, with the boss told each time.
// Runs the real server from a temp copy against a stand-in `claude`. Costs
// no tokens.

import fs from 'node:fs';
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-machine-'));
const app = path.join(tmp, 'app');
const root = path.join(tmp, 'projects');
const record = path.join(tmp, 'record.jsonl');

const SKIP = new Set(['node_modules', 'data', '.git', 'launch', 'desktop']);
fs.cpSync(APP, app, { recursive: true, filter: (src) => !SKIP.has(path.relative(APP, src).split(path.sep)[0]) });
fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'), 'dir');

const project = path.join(root, 'storefront');
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(project, 'README.md'), 'hello\n');
const git = (...args) => execFileSync('git', args, { cwd: project, stdio: 'ignore' });
git('init', '-q');
git('add', '.');
git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init');

// The stand-in acts on words in each message it gets, and stays up between
// turns the way a real session does until the office closes its stdin.
const stub = path.join(tmp, 'claude');
fs.writeFileSync(stub, `#!${process.execPath}
const fs = require('fs');
const { spawn } = require('child_process');
const args = process.argv.slice(2);
const env = JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.office.env;
const rec = (o) => fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ job: env.OFFICE_JOB, ...o }) + '\\n');
const call = (tool, body) => fetch(env.OFFICE_URL + '/api/agent/' + tool, { method: 'POST', headers: { 'content-type': 'application/json', 'x-office-job': env.OFFICE_JOB, 'x-office-token': env.OFFICE_TOKEN }, body: JSON.stringify(body) }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Left behind the way a background shell is: in its own group, outliving us.
const leave = (secs) => { const c = spawn('/bin/sleep', [String(secs)], { detached: true, stdio: 'ignore' }); c.unref(); return c.pid; };
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let busy = Promise.resolve();
require('readline').createInterface({ input: process.stdin }).on('line', (line) => { busy = busy.then(() => turn(JSON.parse(line).message.content)); });
process.stdin.on('end', () => busy.then(() => process.exit(0)));
let started = false;
async function turn(text) {
  if (!started) { started = true; out({ type: 'system', subtype: 'init', session_id: 's-' + env.OFFICE_JOB, model: 'stub' }); }
  if (text.includes('LEAVE')) { rec({ left: leave(301) }); await sleep(4000); }
  if (text.includes('KEEP')) { const pid = leave(302); await sleep(4000); rec({ kept: pid, said: (await call('keep_running', { pid, why: 'the boss is looking at it' })).text }); }
  if (text.includes('HEAVY-A')) { rec({ a: (await call('heavy_work', { action: 'start', what: 'build A' })).text }); await sleep(5000); await call('heavy_work', { action: 'done' }); }
  if (text.includes('HEAVY-B')) { await sleep(1500); rec({ b: (await call('heavy_work', { action: 'start', what: 'build B' })).text }); }
  if (text.includes('Your turn')) { rec({ turn: text }); await call('heavy_work', { action: 'done' }); }
  if (text.includes('SLOW')) await sleep(5000);
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 's-' + env.OFFICE_JOB, total_cost_usd: 0, duration_ms: 1000, usage: { input_tokens: 1, output_tokens: 1 } });
}
`, { mode: 0o755 });

const env = { ...process.env, PORT: String(PORT), OFFICE_ROOT: root, CLAUDE_BIN: stub, STANDUP_AT: 'off', BANTER: 'off', OFFICE_PRESSURE_CHECK: 'off', OFFICE_LEADERBOARD_URL: 'http://127.0.0.1:9' };
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
const keyFile = path.join(app, 'data', 'office-key');
const cookie = () => (fs.existsSync(keyFile) ? `office_key_${PORT}=${fs.readFileSync(keyFile, 'utf8').trim()}` : '');
const get = (p) => fetch(BASE + p, { headers: { cookie: cookie() } });
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie() }, body: JSON.stringify(body) });
const recs = () => (fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const state = () => { try { return JSON.parse(fs.readFileSync(path.join(app, 'data', 'state.json'), 'utf8')); } catch { return null; } };
const jobOf = (id) => state()?.jobs.find((j) => j.id === id);
const chat = (re) => (state()?.chat || []).filter((m) => re.test(m.text));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(what, fn, ms = 30000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
    const v = await fn();
    if (v) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
}
const job = async (prompt) => (await (await post('/api/jobs', { repo: 'storefront', prompt, mode: 'edit' })).json()).id;
const ended = (id) => until(`job ${id} to end`, () => { const j = jobOf(id); return j && j.status !== 'working' && j.status !== 'queued' && j; });

const strays = [];
try {
  await until('the server to listen', async () => { try { return (await get('/api/repos')).ok; } catch { return false; } });

  await check('stops what a finished job left running, except what it kept', async () => {
    const id = await job('LEAVE one process and KEEP another');
    const j = await ended(id);
    const left = recs().find((r) => r.job === id && r.left)?.left;
    const kept = recs().find((r) => r.job === id && r.kept);
    strays.push(left, kept?.kept);
    assert(left && kept, JSON.stringify(recs()));
    assert(/left running when this job ends/.test(kept.said), kept.said);
    await until('the leftover to be stopped', () => !alive(left), 8000);
    assert(alive(kept.kept), 'the kept process was stopped');
    await until('the log line', () => jobOf(id).log.some((l) => /Stopped 1 process left running by this job: sleep/.test(l.summary)), 3000);
    await until('the boss to hear what was kept', () => chat(/Left running.*sleep \(pid \d+\): the boss is looking at it/).length, 3000);
    assert(j.status === 'done', j.status);
  });

  await check('keep_running refuses a process the job did not start', async () => {
    const res = await fetch(BASE + '/api/agent/keep_running', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: process.pid }) });
    assert(res.status === 403, `status ${res.status}`);
  });

  await check('heavy runs go one at a time, and the boss hears of the wait', async () => {
    const a = await job('HEAVY-A');
    const b = await job('HEAVY-B');
    const told = await until('B to be told to wait', () => recs().find((r) => r.job === b && r.b));
    assert(/build A is running/.test(told.b) && /Do not start yours/.test(told.b), told.b);
    await until('the delay notice', () => chat(/Delayed.*build B.*waiting for .*build A/).length === 1, 3000);
    const turn = await until('B to get its turn', () => recs().find((r) => r.job === b && r.turn), 20000);
    assert(/slot is yours for build B/.test(turn.turn), turn.turn);
    await ended(a);
    const jb = await ended(b);
    assert(jb.status === 'done', jb.status);
  });

  // This laptop's own load decides the pressure check, so it is off for the
  // checks above and asserted on its own terms here.
  await check('jobs over the agent limit wait, and the boss is told why', async () => {
    const res = await post('/api/settings', { maxAgents: 1 });
    assert(res.ok, `settings ${res.status}`);
    const first = await job('SLOW one');
    await until('the first to start', () => jobOf(first)?.status === 'working');
    const second = await job('SLOW two');
    await until('the hold notice', () => chat(/On hold.*SLOW two.*1 agents are already working, the limit set in Settings/).length);
    assert(jobOf(second).status === 'queued', jobOf(second).status);
    await ended(first);
    const j = await ended(second);
    assert(j.status === 'done' && j.log.some((l) => /Starting now, after waiting/.test(l.summary)), JSON.stringify(j.log.map((l) => l.summary)));
  });
} finally {
  server.kill('SIGTERM');
  for (const pid of strays) if (pid) try { process.kill(pid, 'SIGKILL'); } catch {}
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failed) console.log('\n--- server log ---\n' + log.slice(-3000));
}
process.exit(failed ? 1 : 0);
