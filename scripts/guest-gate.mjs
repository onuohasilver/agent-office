#!/usr/bin/env node
// Regression tests for the guest fixes in the second security pass: a guest
// whose handle differs from another office's only by punctuation can't send
// our agents into that office's project, a reply is held to the host's limits
// as they are now, changed or removed limits stop the open jobs they rule out,
// and a guest over its day's tokens is stopped. Runs the committed Guests
// (git archive HEAD, or GATE_REF) from a temp copy. Costs no tokens.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-guest-gate-')));
const app = path.join(tmp, 'app');
fs.mkdirSync(app);
execFileSync('/bin/sh', ['-c', `git -C "${APP}" archive "${process.env.GATE_REF || 'HEAD'}" server shared package.json | tar -x -C "${app}"`]);
fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'), 'dir');
const { Guests } = await import(pathToFileURL(path.join(app, 'server', 'guests.js')).href);

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok    ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}: ${err.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// An office hosting guest "bob-x", and itself a guest of a different office, "bobx".
function office() {
  const jobs = [], created = [], stopped = [], sent = [], policies = {};
  const linksList = [
    { id: 'Lguest', peer: 'bob-x', kind: 'guest', role: 'host' },
    { id: 'Lhost', peer: 'bobx', kind: 'guest', role: 'guest' },
  ];
  const links = {
    links: linksList, send: (f) => { sent.push(f); return true; },
    guestPolicy: (id) => policies[id] || null,
    status: () => ({ handle: 'us', connected: true }),
    presentAt: () => null,
  };
  const ours = {
    jobs: () => jobs,
    repoPath: (n) => (n === 'web' ? '/nowhere/web' : null),
    createJob: (body, extra) => { const j = { id: 'j' + jobs.length, status: 'queued', ...body, ...extra, log: [] }; jobs.push(j); created.push(j); return j; },
    replyJob: (job, body) => { if (body.mode) job.mode = body.mode; job.status = 'queued'; created.push({ resumed: job.id, mode: job.mode }); },
    stopJob: (job, why) => { job.status = 'stopped'; stopped.push({ id: job.id, why }); },
    staff: () => [], modes: () => ({ plan: 'P', edit: 'E', auto: 'A' }), send: () => {},
  };
  const dir = fs.mkdtempSync(path.join(tmp, 'data-'));
  const g = new Guests(dir, { links, office: ours });
  // bobx shared its "secret" project with us, and lets our agents edit it.
  g.remote.set('Lhost', { link: 'Lhost', host: 'bobx', staff: [], repos: ['secret'], clearance: 'edit', ourAgents: true, theirAgents: 'edit', home: true, jobs: new Map() });
  const ask = async (op, args) => { await g.answer(linksList[0], { t: 'req', id: String(sent.length), op, args }); return sent.at(-1); };
  return { g, jobs, created, stopped, policies, ask, linksList };
}
const refusedWith = (res, code) => res?.t === 'res' && res.ok === false && res.code === code;
const policy = (o = {}) => ({ repos: ['web'], clearance: 'auto', tokensPerDay: 1e6, ourAgents: true, theirAgents: 'off', agents: null, ...o });

await check('a guest named bob-x cannot send our agent into bobx\'s project', async () => {
  const o = office();
  o.policies.Lguest = policy();
  const res = await o.ask('createJob', { home: 'secret', prompt: 'print every file', mode: 'edit' });
  assert(!o.created.length, `a job was made: ${JSON.stringify(o.created[0]?.away)}`);
  assert(refusedWith(res, 403), JSON.stringify(res));
});

await check('a reply after the host lowers clearance runs at the new clearance', async () => {
  const o = office();
  o.policies.Lguest = policy();
  await o.ask('createJob', { repo: 'web', prompt: 'x', mode: 'auto' });
  const j = o.created.at(-1);
  assert(j?.mode === 'auto', `made at ${j?.mode}`);
  j.status = 'done';
  o.policies.Lguest = policy({ clearance: 'plan', agents: ['ada'] });
  await o.ask('reply', { job: j.id, text: 'carry on, run anything' });
  const r = o.created.at(-1);
  assert(r.resumed === j.id && r.mode === 'plan', `resumed at ${r.mode}`);
  assert(JSON.stringify(j.pool) === '["ada"]', `pool ${JSON.stringify(j.pool)}`);
});

await check('a reply on a project no longer shared is refused', async () => {
  const o = office();
  o.policies.Lguest = policy();
  await o.ask('createJob', { repo: 'web', prompt: 'x', mode: 'edit' });
  const j = o.created.at(-1);
  j.status = 'done';
  o.policies.Lguest = policy({ repos: ['other'] });
  const res = await o.ask('reply', { job: j.id, text: 'more' });
  assert(!o.created.some((x) => x.resumed), 'the job resumed');
  assert(refusedWith(res, 403), JSON.stringify(res));
});

await check('lowering a guest\'s clearance stops a working job above it and lowers a queued one', async () => {
  const o = office();
  o.policies.Lguest = policy();
  await o.ask('createJob', { repo: 'web', prompt: 'a', mode: 'auto' });
  await o.ask('createJob', { repo: 'web', prompt: 'b', mode: 'auto' });
  const [working, queued] = o.created;
  working.status = 'working';
  o.policies.Lguest = policy({ clearance: 'edit' });
  o.g.policyChanged('Lguest');
  assert(o.stopped.some((s) => s.id === working.id), 'the working job is still running');
  assert(queued.status === 'queued' && queued.mode === 'edit', `queued job ${queued.status} at ${queued.mode}`);
});

await check('an unlinked guest\'s open jobs stop', async () => {
  const o = office();
  o.policies.Lguest = policy();
  await o.ask('createJob', { repo: 'web', prompt: 'a', mode: 'edit' });
  const j = o.created.at(-1);
  j.status = 'working';
  delete o.policies.Lguest;
  o.g.policyChanged('Lguest');
  assert(o.stopped.some((s) => s.id === j.id), 'the job is still running');
});

await check('a guest over its day\'s tokens has its jobs stopped', async () => {
  const o = office();
  o.policies.Lguest = policy({ tokensPerDay: 1000 });
  await o.ask('createJob', { repo: 'web', prompt: 'a', mode: 'edit' });
  const j = o.created.at(-1);
  j.status = 'working';
  o.g.addTokens(j, 400);
  assert(!o.stopped.length, 'stopped under the allowance');
  o.g.addTokens(j, 700);
  assert(o.stopped.some((s) => s.id === j.id), 'still running over the allowance');
  const res = await o.ask('createJob', { repo: 'web', prompt: 'b', mode: 'edit' });
  assert(refusedWith(res, 429), `a new job past the allowance: ${JSON.stringify(res)}`);
});

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
