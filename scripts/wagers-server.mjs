#!/usr/bin/env node
// The team goal and agent bets through the real server: the HTTP goal
// endpoint, and a stand-in `claude` that calls place_bet / take_bet as two
// agents, then the subject's job finishes (settles) or fails (refunds).
// Runs from a copy of the app with seeded books; costs no tokens.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyBooks } from '../server/economy.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-wagers-'));
const app = path.join(tmp, 'app');
const root = path.join(tmp, 'projects');
const SKIP = new Set(['node_modules', 'data', '.git', 'launch', 'desktop']);
fs.cpSync(APP, app, { recursive: true, filter: (src) => !SKIP.has(path.relative(APP, src).split(path.sep)[0]) });
fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'), 'dir');
const project = path.join(root, 'storefront');
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(project, 'README.md'), 'hello\n');
const git = (...args) => execFileSync('git', args, { cwd: project, stdio: 'ignore' });
git('init', '-q'); git('add', '.'); git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init');

// Two bettors with money, and a pot a long way from the goal.
const books = emptyBooks();
books.wallets = { ada: 10000, mira: 10000 };
books.totals.earned = 20000;
fs.mkdirSync(path.join(app, 'data'), { recursive: true });
fs.writeFileSync(path.join(app, 'data', 'state.json'), JSON.stringify({ economy: books }));

const out = path.join(tmp, 'tool-out.jsonl');
const stub = path.join(tmp, 'claude');
fs.writeFileSync(stub, `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
const mcp = JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'));
const env = mcp.mcpServers.office.env;
const tool = async (name, body = {}) => {
  const r = await fetch(env.OFFICE_URL + '/api/agent/' + name, { method: 'POST', headers: { 'content-type': 'application/json', 'x-office-job': env.OFFICE_JOB, 'x-office-token': env.OFFICE_TOKEN }, body: JSON.stringify(body) });
  const j = await r.json();
  fs.appendFileSync(${JSON.stringify(out)}, JSON.stringify({ name, status: r.status, ...j }) + '\\n');
  return j.text || '';
};
process.stdin.once('data', (buf) => setTimeout(async () => {
  const p = String(buf);
  if (p.includes('PLACE')) { await tool('place_bet', { on: 'tunde', minutes: 5, stake: 1000 }); await tool('place_bet', { on: 'tunde', minutes: 5, stake: 100000 }); await tool('place_bet', { on: 'ada', minutes: 5, stake: 500 }); }
  if (p.includes('TAKE')) { const id = (await tool('bets')).match(/- (b[a-z0-9]+):/)?.[1]; await tool('take_bet', { id }); await tool('take_bet', { id: 'nope' }); }
  const o = (x) => process.stdout.write(JSON.stringify(x) + '\\n');
  o({ type: 'system', subtype: 'init', session_id: 's' + process.pid, model: 'stub' });
  const bad = p.includes('BREAK');
  o({ type: 'result', subtype: bad ? 'error_during_execution' : 'success', is_error: bad, result: bad ? 'It broke.' : 'Done.', session_id: 's' + process.pid, total_cost_usd: 0, duration_ms: 3000, usage: { input_tokens: 10, output_tokens: 10 } });
  process.exit(0);
}, 1200));
`, { mode: 0o755 });

const env = { ...process.env, PORT: String(PORT), OFFICE_ROOT: root, CLAUDE_BIN: stub, STANDUP_AT: 'off', BANTER: 'off' };
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
const get = (p) => fetch(BASE + p, { headers: { cookie: cookie() } });
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie() }, body: JSON.stringify(body) });
const econ = async () => (await get('/api/economy')).json();
const tools = () => (fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
async function until(what, fn, ms = 20000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) { const v = await fn(); if (v) return v; }
  throw new Error(`timed out waiting for ${what}`);
}
const books2 = (e) => e.pot + Object.values(e.wallets).reduce((a, x) => a + x, 0) + e.escrow;
// Jobs pay their own agents too, so a wallet is its seed, plus what the ledger says it earned, plus bet moves.
const earnedBy = (e, id) => e.ledger.filter((x) => x.gross && x.agentId === id).reduce((a, x) => a + x.agent, 0);
const job = async (agentId, prompt) => { const r = await post('/api/jobs', { repo: 'storefront', prompt, mode: 'edit', agentId }); assert(r.status === 201, `job ${r.status}`); return (await r.json()).id; };
const ended = (id) => until(`job ${id} to end`, async () => { const x = await (await get(`/api/jobs/${id}`)).json(); return ['done', 'failed', 'stopped'].includes(x.status) && x; });

try {
  await until('the server', async () => { try { return (await get('/api/repos')).ok; } catch { return false; } });

  await check('the boss sets a team goal, and bad ones are refused', async () => {
    assert((await post('/api/economy/goal', { name: '', target: 5000 })).status === 400, 'empty name accepted');
    assert((await post('/api/economy/goal', { name: 'x', target: 5 })).status === 400, 'tiny target accepted');
    const r = await post('/api/economy/goal', { name: 'Pool party', target: 5000000 });
    const e = await r.json();
    assert(r.status === 200 && e.goal.name === 'Pool party' && e.goal.progress === 0, JSON.stringify(e.goal));
    assert((await post('/api/economy/goal', { clear: true })).status === 200, 'clear failed');
    assert((await econ()).goal === null, 'goal not cleared');
    await post('/api/economy/goal', { name: 'Pool party', target: 5000000 });
  });

  await check('agents place and take a bet; caps and self-bets are refused', async () => {
    await ended(await job('ada', 'PLACE the bets'));
    const placed = tools().filter((t) => t.name === 'place_bet');
    assert(placed[0].status === 200, JSON.stringify(placed[0]));
    assert(placed[1].status >= 400 && /between/.test(placed[1].error), `over-cap stake: ${JSON.stringify(placed[1])}`);
    assert(placed[2].status >= 400 && /own job/.test(placed[2].error), `self bet: ${JSON.stringify(placed[2])}`);
    let e = await econ();
    assert(e.wallets.ada === 10000 + earnedBy(e, 'ada') - 1000 && e.escrow === 1000, `ada ${e.wallets.ada}, escrow ${e.escrow}`);
    await ended(await job('mira', 'TAKE the bet'));
    e = await econ();
    assert(e.wallets.mira === 10000 + earnedBy(e, 'mira') - 1000 && e.escrow === 2000, `mira ${e.wallets.mira}, escrow ${e.escrow}`);
    assert(e.bets[0].state === 'live', e.bets[0].state);
  });

  await check("the subject's next job settles it: the backer wins both stakes", async () => {
    await sleep(1100); // a later start than the take
    await ended(await job('tunde', 'Do the thing'));
    const e = await until('settlement', async () => { const x = await econ(); return x.bets[0].state !== 'live' && x; });
    assert(e.bets[0].state === 'won' && e.bets[0].winner === 'ada', JSON.stringify(e.bets[0]));
    assert(e.wallets.ada === 10000 + earnedBy(e, 'ada') + 1000 && e.wallets.mira === 10000 + earnedBy(e, 'mira') - 1000 && e.escrow === 0, `ada ${e.wallets.ada} mira ${e.wallets.mira} escrow ${e.escrow}`);
    assert(books2(e) === 20000 + e.ledger.filter((x) => x.gross).reduce((a, x) => a + x.gross, 0), 'the books do not add up');
    assert(e.ledger.some((x) => x.kind === 'bet' && x.phase === 'won'), 'no ledger line for the win');
  });

  await check('a bet on a job that fails is refunded', async () => {
    await ended(await job('ada', 'PLACE again'));
    await ended(await job('mira', 'TAKE again'));
    const before = await econ();
    const live = before.bets.find((b) => b.state === 'live');
    assert(live, 'no live bet');
    await sleep(1100);
    await ended(await job('tunde', 'BREAK it'));
    const e = await until('refund', async () => { const x = await econ(); return x.bets.find((b) => b.id === live.id).state === 'void' && x; });
    assert(e.escrow === 0 && e.wallets.ada === before.wallets.ada + 1000 + earnedBy(e, 'ada') - earnedBy(before, 'ada') && e.wallets.mira === before.wallets.mira + 1000 + earnedBy(e, 'mira') - earnedBy(before, 'mira'), `ada ${e.wallets.ada} mira ${e.wallets.mira}`);
  });

  await check('the goal and the bets are in the books', async () => {
    const e = await econ();
    assert(e.goal?.name === 'Pool party' && e.bets.length >= 2, 'goal or bets missing');
  });
} catch (err) {
  failed++;
  console.log(`FAIL  ${err.message}\n${log.split('\n').slice(-15).join('\n')}`);
}
server.kill();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
