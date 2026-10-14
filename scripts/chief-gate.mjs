// Chief's several-jobs dispatch never hands out more jobs than the roster
// holds. A real office from a copy of this tree, temp data and a stub claude
// whose routing answer asks for 40 jobs.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let failed = 0; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${ok ? '' : x}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) { const v = await fn(); if (v) return v; } return null; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chief-gate-'));
const app = path.join(tmp, 'app');
const SKIP = new Set(['node_modules', 'data', '.git', 'launch', 'site', 'leaderboard', 'desktop', 'dist']);
fs.cpSync(APP, app, { recursive: true, filter: (src) => !SKIP.has(path.relative(APP, src).split(path.sep)[0]) });
fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'), 'dir');
const record = path.join(tmp, 'routes.jsonl');
const stub = path.join(tmp, 'claude');
// Routing calls carry --json-schema; everything else is an agent's turn.
fs.writeFileSync(stub, `#!${process.execPath}
const fs = require('fs');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const routing = process.argv.includes('--json-schema');
process.stdin.resume();
process.stdin.on('end', () => {
  if (routing) {
    fs.appendFileSync(${JSON.stringify(record)}, 'route\\n');
    const jobs = Array.from({ length: 40 }, (_, i) => ({ repo: 'proj', brief: 'Piece ' + i, agentId: '', model: 'haiku', say: 'piece ' + i }));
    out({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'new', jobs, say: 'On it.' }, total_cost_usd: 0 });
    return process.exit(0);
  }
  setTimeout(() => {
    out({ type: 'system', subtype: 'init', session_id: 's', model: 'stub' });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 's', total_cost_usd: 0, duration_ms: 100, usage: { input_tokens: 1, output_tokens: 1 } });
    process.exit(0);
  }, 200);
});
`, { mode: 0o755 });

const root = path.join(tmp, 'projects', 'proj'); fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, 'README.md'), 'hi\n');
const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
git('init', '-q'); git('add', '.'); git('-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'init');

const port = 4931;
const data = path.join(tmp, 'data');
const env = { ...process.env, PORT: String(port), OFFICE_ROOT: path.dirname(root), OFFICE_DATA: data, CLAUDE_BIN: stub, STANDUP_AT: 'off', BANTER: 'off', OFFICE_LEADERBOARD_URL: 'http://127.0.0.1:9' };
delete env.ANTHROPIC_API_KEY;
const proc = spawn(process.execPath, ['server/index.js'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
proc.log = ''; proc.stdout.on('data', (d) => (proc.log += d)); proc.stderr.on('data', (d) => (proc.log += d));
const finish = async (code) => { proc.kill('SIGTERM'); await until(() => proc.exitCode !== null || proc.signalCode, 5000); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(code); };
process.on('uncaughtException', (e) => { console.error(e); console.error(proc.log.slice(-1500)); finish(1); });

const base = `http://127.0.0.1:${port}`;
const key = await until(() => { try { return fs.readFileSync(path.join(data, 'office-key'), 'utf8').trim(); } catch { return null; } }, 15000);
const cookie = `office_key_${port}=${key}`;
await until(() => fetch(base + '/api/repos', { headers: { cookie } }).then((r) => r.ok, () => false), 15000);

const r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ text: 'Split the backlog into as many jobs as you like' }) });
check('the boss message is taken', r.status === 202, `status ${r.status}`);
check('the chief was asked', !!(await until(() => fs.existsSync(record), 10000)));
await until(() => /handing out \d+, the roster size/.test(proc.log), 5000);
await sleep(500);
proc.kill('SIGTERM');
await until(() => proc.exitCode !== null || proc.signalCode, 8000);
const state = JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8'));
const jobs = state.jobs.filter((j) => j.repo === 'proj');
const m = /asked for 40 jobs; handing out (\d+), the roster size/.exec(proc.log);
const cap = m ? Number(m[1]) : NaN;
check('the trim is logged', !!m, proc.log.slice(-800));
check('jobs made are the roster size, not 40', cap >= 2 && cap < 40 && jobs.length === cap, `made ${jobs.length}, cap ${cap}`);
await finish(failed ? 1 : 0);
