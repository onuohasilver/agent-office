// Two real offices (host and guest) from a copy of this tree, temp data and a
// stub claude, linked through a relay: RELAY, default a local `npm run dev` in
// leaderboard/. Not part of npm test, since it needs the relay running.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RELAY = process.env.RELAY || 'http://localhost:8787';
console.log(`relay: ${RELAY}`);
let failed = 0; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${ok ? '' : x}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) { const v = await fn(); if (v) return v; } return null; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guests-e2e-'));
const app = path.join(tmp, 'app');
const SKIP = new Set(['node_modules', 'data', '.git', 'launch', 'site', 'leaderboard']);
fs.cpSync(APP, app, { recursive: true, filter: (src) => !SKIP.has(path.relative(APP, src).split(path.sep)[0]) });
fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'), 'dir');
const record = path.join(tmp, 'calls.jsonl');
const stub = path.join(tmp, 'claude');
fs.writeFileSync(stub, `#!${process.execPath}
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
process.stdin.once('data', () => setTimeout(() => {
  fs.appendFileSync('README.md', 'edited by the stub\\n');
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'system', subtype: 'init', session_id: 's', model: 'stub' });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 's', total_cost_usd: 0, duration_ms: 1000, usage: { input_tokens: 100, output_tokens: 50 } });
  process.exit(0);
}, 700));
`, { mode: 0o755 });
function project(root, name) {
  const p = path.join(root, name); fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'README.md'), 'hi\n');
  const git = (...a) => execFileSync('git', a, { cwd: p, stdio: 'ignore' });
  git('init', '-q'); git('add', '.'); git('-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'init');
}
const procs = [];
async function office(name, port, repos) {
  const root = path.join(tmp, name, 'projects'); repos.forEach((r) => project(root, r));
  const env = { ...process.env, PORT: String(port), OFFICE_ROOT: root, OFFICE_DATA: path.join(tmp, name, 'data'), CLAUDE_BIN: stub, STANDUP_AT: 'off', BANTER: 'off', OFFICE_LEADERBOARD_URL: RELAY };
  delete env.ANTHROPIC_API_KEY;
  const p = spawn(process.execPath, ['server/index.js'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = ''; p.stdout.on('data', (d) => (p.log += d)); p.stderr.on('data', (d) => (p.log += d));
  procs.push(p);
  const base = `http://127.0.0.1:${port}`;
  // The office key, which the page and API need (it signs a browser in).
  const keyFile = path.join(env.OFFICE_DATA, 'office-key');
  const key = await until(() => { try { return fs.readFileSync(keyFile, 'utf8').trim(); } catch { return null; } }, 15000);
  const cookie = `office_key_${port}=${key}`;
  await until(() => fetch(base + '/api/repos', { headers: { cookie } }).then((r) => r.ok, () => false), 15000);
  const api = async (method, route, body) => { const r = await fetch(base + route, { method, headers: { 'content-type': 'application/json', cookie }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  return { base, api, cookie, proc: p };
}
const done = async (code) => { for (const p of procs) p.kill('SIGTERM'); await sleep(300); process.exit(code); };
process.on('uncaughtException', (e) => { console.error(e); for (const p of procs) console.error(p.log.slice(-1500)); done(1); });

const tag = crypto.randomBytes(2).toString('hex');
const host = await office('host', 4911, ['shared', 'private']);
const guest = await office('guest', 4912, ['mine']);

let r = await host.api('POST', '/api/links/invite', { kind: 'guest', handle: `gh-${tag}`, guest: { repos: ['shared'], clearance: 'edit', tokensPerDay: 2_000_000 } });
check('the host makes a guest invite', r.status === 201 && r.body.code, JSON.stringify(r));
r = await guest.api('POST', '/api/links/redeem', { code: r.body.code, handle: `gg-${tag}` });
const link = r.body?.links?.find((l) => l.kind === 'guest');
check('the guest redeems it', r.status === 200 && link?.role === 'guest', JSON.stringify(r));
check('the host sees the guest link', await until(async () => (await host.api('GET', '/api/links')).body?.links?.some((l) => l.id === link.id && l.role === 'host')));

// The visit.
const ws = new WebSocket(guest.base.replace('http', 'ws') + `/ws/visit/${link.id}`, { headers: { cookie: guest.cookie } });
ws.msgs = []; ws.closed = null;
ws.onmessage = (e) => ws.msgs.push(JSON.parse(e.data));
ws.onclose = (e) => { ws.closed = e.code; ws.reason = e.reason; };
const hello = await until(() => ws.msgs.find((m) => m.t === 'hello'));
check('the visit opens with the host’s hello', hello?.visiting?.host === `gh-${tag}` && hello.visiting.repos.join() === 'shared' && hello.visiting.clearance === 'edit' && hello.jobs.length === 0, JSON.stringify(hello?.visiting) + ` closed: ${ws.closed} ${ws.reason || ''}`);
check('modes are capped', hello && !('auto' in hello.modes) && 'edit' in hello.modes, JSON.stringify(hello?.modes));

// The host's own work, which the guest must never see.
r = await host.api('POST', '/api/jobs', { repo: 'private', prompt: 'the host’s secret job' });
const hostJob = r.body?.id;

r = await guest.api('POST', `/api/visit/${link.id}/jobs`, { repo: 'private', prompt: 'peek' });
check('a repo that isn’t shared is refused', r.status === 403, JSON.stringify(r));
r = await guest.api('POST', `/api/visit/${link.id}/jobs`, { repo: 'shared', prompt: 'go wild', mode: 'auto' });
check('full autonomy over the cap is refused', r.status === 403, JSON.stringify(r));
r = await guest.api('POST', `/api/visit/${link.id}/jobs`, { repo: 'shared', prompt: 'fix the readme' });
const gj = r.body?.job;
check('a guest job is accepted', r.status === 201 && gj?.id && gj.from === `@gg-${tag}`, JSON.stringify(r));
r = await host.api('GET', `/api/jobs/${gj?.id}`);
check('the host runs it, tagged from the guest', r.body?.from === `@gg-${tag}` && r.body.repo === 'shared', JSON.stringify(r.body).slice(0, 200));
check('the guest’s page sees it finish', await until(() => ws.msgs.some((m) => m.t === 'job' && m.job.id === gj?.id && m.job.status === 'done'), 15000));
r = await guest.api('GET', `/api/visit/${link.id}/jobs/${gj?.id}`);
check('the guest reads its job', r.status === 200 && r.body.job?.log?.length > 0, JSON.stringify(r).slice(0, 200));
r = await guest.api('GET', `/api/visit/${link.id}/jobs/${gj?.id}/diff?path=README.md`);
check('and its diff', r.status === 200 && /edited by the stub/.test(JSON.stringify(r.body)), JSON.stringify(r).slice(0, 300));
r = await guest.api('GET', `/api/visit/${link.id}/jobs/${hostJob}`);
check('but not the host’s job', r.status === 404, JSON.stringify(r));
r = await guest.api('POST', `/api/visit/${link.id}/jobs/${hostJob}/stop`);
check('and can’t stop it', r.status === 404, JSON.stringify(r));
check('the host’s job never reaches the page', !ws.msgs.some((m) => m.job?.id === hostJob || m.jobId === hostJob || JSON.stringify(m).includes('secret job')));

const calls = fs.readFileSync(record, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const gcall = calls.find((c) => c.cwd.endsWith(`${path.sep}shared`));
const tools = gcall?.args[gcall.args.indexOf('--allowedTools') + 1];
check('the guest job’s agent gets only roster and flag', tools === 'mcp__office__office_roster,mcp__office__flag_for_boss', tools);
check('and no access to the boss’s uploads', gcall && !gcall.args.includes('--add-dir'), JSON.stringify(gcall?.args));
const hcall = calls.find((c) => c.cwd.endsWith(`${path.sep}private`));
check('the host’s own job keeps every tool', hcall?.args[hcall.args.indexOf('--allowedTools') + 1].includes('message_colleague'));

r = await guest.api('POST', `/api/visit/${link.id}/jobs/${gj?.id}/reply`, { text: 'one more thing', mode: 'auto' });
check('a reply can’t raise the mode', r.status === 403, JSON.stringify(r));
r = await guest.api('POST', `/api/visit/${link.id}/jobs/${gj?.id}/reply`, { text: 'one more thing' });
check('a reply goes through', r.status === 200, JSON.stringify(r));

// Unlinking ends it.
r = await host.api('DELETE', `/api/links/${link.id}`);
check('the host unlinks', r.status === 200, JSON.stringify(r));
check('and the visit closes 4404', await until(() => ws.closed === 4404), String(ws.closed));
r = await guest.api('POST', `/api/visit/${link.id}/jobs`, { repo: 'shared', prompt: 'again' });
check('no more jobs after unlinking', r.status === 404, JSON.stringify(r));

// Leaving keeps the handle while any link is left, so wait for the unlink to
// reach both offices; then each forgets its handle on the relay.
for (const o of [host, guest]) await until(async () => (await o.api('GET', '/api/links')).body?.links?.length === 0);
for (const o of [host, guest]) await o.api('DELETE', '/api/leaderboard');
check('both handles are forgotten', (await Promise.all([host, guest].map((o) => o.api('GET', '/api/leaderboard')))).every((r) => !r.body?.handle));
console.log(failed ? `${failed} failed` : 'all passed');
if (failed) for (const p of procs) console.error(p.log.slice(-1500));
await done(failed ? 1 : 0);
