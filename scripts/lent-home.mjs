// A lent agent in the borrower's own project: we (boss) are a guest of
// friend (L1, borrowing its agents) and friend is a guest of ours (L2, its
// agents allowed in our projects). `@Ada@friend #mine` runs Ada at friend as
// an away job whose files come back to us over L2.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Guests } from '../server/guests.js';
let failed = 0; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${ok ? '' : x}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lent-'));

let boss, friend;
const fakeLinks = (handle, links, policies, deliver) => ({
  links, policies, visitors: new Map(),
  guestPolicy(id) { return this.policies[id] || null; },
  presentAt() { return null; },
  status() { return { connected: true, handle }; },
  send(f) { setImmediate(() => deliver(f)); return true; },
});
// Each office's side of each link.
const BOSS = { L1: { id: 'L1', peer: 'friend', kind: 'guest', role: 'guest' }, L2: { id: 'L2', peer: 'friend', kind: 'guest', role: 'host' } };
const FRIEND = { L1: { id: 'L1', peer: 'boss', kind: 'guest', role: 'host' }, L2: { id: 'L2', peer: 'boss', kind: 'guest', role: 'guest' } };
const bossPolicy = { L2: { repos: ['mine'], clearance: 'edit', tokensPerDay: 1e6, ourAgents: false, theirAgents: 'edit' } };
const bossLinks = fakeLinks('boss', Object.values(BOSS), bossPolicy, (f) => friend.onGuest(FRIEND[f.link], f));
const friendLinks = fakeLinks('friend', Object.values(FRIEND), { L1: { repos: ['windows'], clearance: 'edit', tokensPerDay: 1e6 } }, (f) => boss.onGuest(BOSS[f.link], f));

const friendJobs = [];
const office = (jobs, repos) => ({
  jobs: () => jobs,
  createJob(body, extra) { const j = { id: `j${jobs.length + 1}`, ...body, ...extra, title: body.prompt, status: 'queued', log: [] }; jobs.push(j); return j; },
  staff: () => [{ id: 'ada', name: 'Ada' }],
  modes: () => ({ plan: 'Plan only', edit: 'Edit files', auto: 'Full autonomy' }),
  repoPath: (n) => (repos.includes(n) ? `/x/${n}` : null),
  send: () => {},
});
friend = new Guests(tmp(), { links: friendLinks, office: office(friendJobs, ['windows']), visits: {} });
boss = new Guests(tmp(), { links: bossLinks, office: office([], ['mine', 'other']), visits: {} });

boss.syncRemote();
await sleep(30);
const staff = boss.remoteStatus()[0].staff[0];
const ask = (text) => boss.startRemote({ link: 'L1', staff, text, mode: 'edit', model: '', thread: 'm1', channel: 'general' });

const r = await ask('what is #mine about');
const j = friendJobs.at(-1);
check('the lent agent runs at the lender, in our project', j?.away?.link === 'L2' && j.away.host === 'boss' && j.away.repo === 'mine' && j.away.access === 'edit' && j.repo === 'mine@boss', JSON.stringify(j));
check('as our job there, counted to us', j.guest?.link === 'L1' && j.from === '@boss' && j.agentId === 'ada' && j.prompt === 'what is about', JSON.stringify(j));
check('we’re told it’s our project', r.home === true && r.repo === 'mine');
check('a project of theirs still works as before', (await ask('tidy #windows')).home === false && friendJobs.at(-1).repo === 'windows' && !friendJobs.at(-1).away);

await ask('look at #other').then(() => check('a project we haven’t shared with them is refused here', false), (e) => check('a project we haven’t shared with them is refused here', /haven’t shared other/.test(e.message), e.message));

bossPolicy.L2.theirAgents = 'off';
await ask('look at #mine').then(() => check('their agents off in ours: refused, with what to change', false), (e) => check('their agents off in ours: refused, with what to change', /let their agents work in your projects/.test(e.message), e.message));
bossPolicy.L2.theirAgents = 'edit';

// The lender checks for itself: a guest can't name a project it hasn't shared.
await boss.request('L1', 'createJob', { home: 'other', prompt: 'x', mode: 'edit', agentId: 'ada' })
  .then(() => check('the lender refuses a project not shared with it', false), (e) => check('the lender refuses a project not shared with it', e.code === 403 && /haven’t shared other/.test(e.message), e.message));

boss.remote.get('L1').home = false;
await ask('look at #mine').then(() => check('an older lender is named, not quietly used', false), (e) => check('an older lender is named, not quietly used', /older version/.test(e.message), e.message));

console.log(failed ? `${failed} failed` : 'all passed'); process.exit(failed ? 1 : 0);
