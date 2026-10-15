// Guest access (server/guests.js) against fake links and a fake office: the
// host enforcing a guest's limits, and the guest cleaning what a host sends.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Guests } from '../server/guests.js';
let failed = 0; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${ok ? '' : x}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guests-'));

const HOST = { id: 'L1', peer: 'friend', kind: 'guest', role: 'host' };
const OTHER = { id: 'L2', peer: 'stranger', kind: 'guest', role: 'host' };
const sent = [];
const links = {
  links: [HOST, OTHER],
  policies: { L1: { repos: ['shared'], clearance: 'edit', tokensPerDay: 1000 } },
  guestPolicy(id) { return this.policies[id] || null; },
  connected: true,
  status() { return { connected: this.connected }; },
  send(f) { sent.push(f); return this.connected; },
};
const jobs = [{ id: 'mine', repo: 'secret', title: 'boss job', status: 'working', log: [] }];
const stopped = [];
let n = 0;
const office = {
  jobs: () => jobs,
  createJob(body, extra) { const j = { id: `j${++n}`, ...body, ...extra, title: body.prompt, status: 'queued', log: [] }; jobs.push(j); return j; },
  replyJob(job, body) { job.lastReply = body; },
  stopJob(job, why) { job.status = 'stopped'; job.error = why; stopped.push(job.id); },
  diff: async () => 'DIFF',
  staff: () => [{ id: 'tunde', name: 'Tunde' }],
  modes: () => ({ plan: 'Plan only', edit: 'Edit files', auto: 'Full autonomy' }),
};
const g = new Guests(dir, { links, office });
const ask = async (link, op, args) => { sent.length = 0; await g.onGuest(link, { t: 'req', id: 'r', op, args }); return sent.find((f) => f.t === 'res'); };

let r = await ask(HOST, 'hello');
check('hello caps modes and shares the policy', r.ok && !('auto' in r.body.modes) && r.body.modes.edit && r.body.policy.repos[0] === 'shared' && r.body.policy.tokensToday === 0, JSON.stringify(r));
check('hello shows none of the host’s jobs', r.body.jobs.length === 0);
r = await ask(OTHER, 'hello');
check('no policy, no access', !r.ok && r.code === 403, JSON.stringify(r));
// Lending only some agents.
const PICK = { id: 'L9', peer: 'pal', kind: 'guest', role: 'host' };
links.policies.L9 = { repos: ['shared'], clearance: 'edit', tokensPerDay: 1000, agents: ['mira'] };
office.staff = () => [{ id: 'tunde', name: 'Tunde' }, { id: 'mira', name: 'Mira' }];
r = await ask(PICK, 'hello');
check('hello lists only the lent agents', r.ok && r.body.staff.length === 1 && r.body.staff[0].id === 'mira' && r.body.policy.agents[0] === 'mira', JSON.stringify(r));
r = await ask(PICK, 'createJob', { repo: 'shared', prompt: 'x', agentId: 'tunde' });
check('an agent that isn’t lent is refused', !r.ok && r.code === 403, JSON.stringify(r));
r = await ask(PICK, 'createJob', { repo: 'shared', prompt: 'x', agentId: 'mira' });
check('a lent agent works, and the job is held to the lent pool', r.ok && jobs.at(-1).wantAgent === undefined && jobs.at(-1).pool?.[0] === 'mira' && jobs.at(-1).agentId === 'mira', JSON.stringify(r));
r = await ask(PICK, 'createJob', { repo: 'shared', prompt: 'y' });
check('no agent named: still limited to the pool', r.ok && jobs.at(-1).pool?.length === 1);
r = await ask(HOST, 'hello');
check('a guest with no list gets every agent', r.body.staff.length === 2 && r.body.policy.agents === null);
office.staff = () => [{ id: 'tunde', name: 'Tunde' }];
for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].guest?.link === 'L9') jobs.splice(i, 1);
r = await ask(HOST, 'createJob', { repo: 'secret', prompt: 'x' });
check('only shared repos', !r.ok && r.code === 403, JSON.stringify(r));
r = await ask(HOST, 'createJob', { repo: 'shared', prompt: 'x', mode: 'auto' });
check('clearance is capped', !r.ok && r.code === 403, JSON.stringify(r));
r = await ask(HOST, 'createJob', { repo: 'shared', prompt: 'first', mode: 'plan' });
const j1 = jobs.find((j) => j.id === r.body?.job?.id);
check('a guest job starts, tagged', r.ok && j1?.from === '@friend' && j1.guest?.link === 'L1' && j1.mode === 'plan', JSON.stringify(r));
r = await ask(HOST, 'createJob', { repo: 'shared', prompt: 'p' });
check('mode defaults to edit', jobs.at(-1).mode === 'edit');
await ask(HOST, 'createJob', { repo: 'shared', prompt: 'p' });
r = await ask(HOST, 'createJob', { repo: 'shared', prompt: 'p' });
check('3 open jobs at most', !r.ok && r.code === 429, JSON.stringify(r));
r = await ask(HOST, 'hello');
check('hello lists only the guest’s jobs', r.body.jobs.length === 3 && r.body.jobs.every((j) => j.guest.link === 'L1'));
r = await ask(HOST, 'stop', { job: 'mine' });
check('can’t stop the host’s job', !r.ok && r.code === 404 && jobs[0].status === 'working', JSON.stringify(r));
r = await ask(HOST, 'job', { job: 'mine' });
check('can’t read the host’s job', !r.ok && r.code === 404);
r = await ask(HOST, 'diff', { job: j1.id });
check('can read its own diff', r.ok && r.body.diff === 'DIFF');
r = await ask(HOST, 'reply', { job: j1.id, text: 'more', mode: 'auto' });
check('a reply can’t raise the mode', !r.ok && r.code === 403);
r = await ask(HOST, 'reply', { job: j1.id, text: 'more' });
check('a reply goes to its own job', r.ok && j1.lastReply?.message === 'more');
r = await ask(HOST, 'terminal');
check('anything else is refused', !r.ok && r.code === 400);

// The feed: only the guest's own jobs, batched.
sent.length = 0;
g.feed({ t: 'log', jobId: 'mine', entry: { summary: 'secret stuff' } });
g.feed({ t: 'job', job: jobs[0] });
g.feed({ t: 'chat', text: 'hi' });
g.feed({ t: 'log', jobId: j1.id, entry: { summary: 'guest work' } });
g.feed({ t: 'job', job: { ...j1, baseTree: { big: true } } });
await sleep(400);
const feeds = sent.filter((f) => f.t === 'feed');
const toL1 = feeds.filter((f) => f.link === 'L1').flatMap((f) => f.msgs);
check('the feed carries only the guest’s job', toL1.length === 2 && toL1.every((m) => m.jobId === j1.id || m.job?.id === j1.id), JSON.stringify(feeds));
check('and strips internals', !('baseTree' in toL1.find((m) => m.t === 'job').job));
check('another guest gets none of it', !feeds.some((f) => f.link === 'L2'));

// Tokens.
j1.status = 'working';
g.addTokens(j1, 600);
r = await ask(HOST, 'hello');
check('tokens are counted', r.body.policy.tokensToday === 600);
g.addTokens(j1, 500);
check('over the day’s tokens stops its jobs', stopped.includes(j1.id) && jobs.filter((j) => j.guest && j.status !== 'stopped').length === 0, JSON.stringify(stopped));
r = await ask(HOST, 'createJob', { repo: 'shared', prompt: 'p' });
check('and refuses new ones', !r.ok && r.code === 429);
check('tokens survive a restart', new Guests(dir, { links, office }).tokensToday('L1') === 1100);

// Unlinking stops a guest's work.
const j9 = office.createJob({ repo: 'shared', prompt: 'late' }, { from: '@friend', guest: { link: 'L1' } });
links.links = [OTHER];
g.linksChanged();
check('unlinking stops the guest’s jobs', j9.status === 'stopped' && /unlinked/.test(j9.error));

// As guest.
const GUEST = { id: 'G1', peer: 'host', kind: 'guest', role: 'guest' };
links.links = [GUEST];
sent.length = 0;
const p = g.request('G1', 'createJob', { repo: 'x' });
const req = sent.find((f) => f.t === 'req');
check('a guest request goes out', req?.link === 'G1' && req.op === 'createJob');
g.onGuest(GUEST, { t: 'res', id: req.id, ok: false, code: 403, error: 'nope' });
const err = await p.catch((e) => e);
check('and the host’s refusal comes back with its code', err.code === 403 && err.message === 'nope');
links.connected = false;
sent.length = 0;
setTimeout(() => { links.connected = true; }, 300);
const pw = g.request('G1', 'stop', { job: 'x' });
await sleep(150);
check('a request waits for the relay socket to open', sent.length === 0);
await sleep(300);
const wreq = sent.find((f) => f.t === 'req');
check('and goes once it does', !!wreq);
g.onGuest(GUEST, { t: 'res', id: wreq.id, ok: true, body: {} });
await pw;
await g.request('H9', 'hello').then(() => check('unknown link refused', false), (e) => check('a request needs a guest link', e.code === 404));

const fakeWs = () => { const w = { readyState: 1, out: [], closed: null, h: {}, send(d) { this.out.push(JSON.parse(d)); }, close(c) { this.closed = c; this.readyState = 3; this.h.close?.(); }, on(e, f) { this.h[e] = f; } }; return w; };
let ws = fakeWs();
await g.visit(ws, 'nope');
check('visiting a non-host closes 4404', ws.closed === 4404);
ws = fakeWs();
sent.length = 0;
const v = g.visit(ws, 'G1', () => ({ auth: {}, jobs: ['ours'] }));
await sleep(10);
const hreq = sent.find((f) => f.op === 'hello');
g.onGuest(GUEST, { t: 'res', id: hreq.id, ok: true, body: { staff: [{ id: 'a' }], modes: { plan: 'Plan only' }, jobs: [{ id: 'g', status: 'done' }], policy: { repos: ['shared'], clearance: 'plan', tokensPerDay: 5, tokensToday: 1 } } });
await v;
const hello = ws.out[0];
check('the visit hello is the host’s, labelled', hello?.t === 'hello' && hello.jobs[0].id === 'g' && hello.visiting.host === 'host' && hello.visiting.clearance === 'plan' && hello.chat.length === 0 && 'auth' in hello, JSON.stringify(hello));
g.onGuest(GUEST, { t: 'feed', msgs: [{ t: 'job', job: { id: 'g', status: 'working' } }, { t: 'terminal', data: 'x' }] });
check('the host’s feed reaches the page, filtered', ws.out.length === 2 && ws.out[1].t === 'job');

// A hostile host: script in every field. Nothing of it may reach the page as
// anything but capped text, and nothing that isn't ours gets through.
const X = '<img src=x onerror=alert(1)>';
const evilJob = { id: X, status: 'done', title: X };
const job2 = { id: 'ok-job', status: X, title: 't' };
const job3 = { id: 'j3', status: 'working', title: X, repo: `../${X}`, mode: X, model: X, agentId: X, error: X, from: X, guest: { link: X },
  turns: X, cost: X, changes: { base: X, files: [{ path: X, status: X, add: X }] }, asking: { kind: X, summary: X },
  log: [{ kind: X, summary: 'x' }, { kind: 'tool', station: X, summary: X, cost: X, ms: X }, { kind: 'result', ok: X, summary: X, cost: X }], extra: X };
const staff = [{ id: X, name: 'n' }, { id: 'ada', name: X, role: X, shirt: `red;background:url(${X})`, hair: '#123456', onclick: X }];
ws = fakeWs();
sent.length = 0;
const v2 = g.visit(ws, 'G1', () => ({}));
await sleep(10);
const hreq2 = sent.find((f) => f.op === 'hello');
g.onGuest(GUEST, { t: 'res', id: hreq2.id, ok: true, body: { staff, modes: { plan: X, edit: X, auto: X, [X]: X }, jobs: [evilJob, job2, job3], policy: { repos: ['shared', X, '../etc'], clearance: X, tokensPerDay: X } } });
await v2;
const h2 = ws.out[0];
check('a job with a bad id is dropped', !h2.jobs.some((j) => j.id === X));
check('a job with a bad status is dropped', !h2.jobs.some((j) => j.id === 'ok-job'));
const c3 = h2.jobs.find((j) => j.id === 'j3');
check('bad enums, ids and numbers are replaced', c3 && c3.mode === 'plan' && c3.model === '' && c3.agentId === null && c3.repo === '' && !('from' in c3) && !('guest' in c3) && c3.turns === 0 && !('extra' in c3) && !('cost' in c3), JSON.stringify(c3));
check('text stays text, capped', c3.title === X && c3.error === X);
check('change lists are rebuilt', c3.changes.base === null && c3.changes.files[0].status === 'modified' && c3.changes.files[0].add === 0);
check('asking with a bad kind is dropped', c3.asking === null);
check('log entries of unknown kinds are dropped', c3.log.length === 2 && c3.log.every((e) => ['tool', 'result'].includes(e.kind)));
check('station and numbers in logs are checked', !('station' in c3.log[0]) && !('cost' in c3.log[0]) && !('ms' in c3.log[0]) && c3.log[1].ok === false);
check('staff with a bad id is dropped', h2.staff.length === 1 && h2.staff[0].id === 'ada');
check('staff colours must be #rrggbb', !('shirt' in h2.staff[0]) && h2.staff[0].hair === '#123456' && !('onclick' in h2.staff[0]));
check('mode labels are ours, not the host’s', JSON.stringify(h2.modes) === JSON.stringify({ plan: 'Plan only' }), JSON.stringify(h2.modes));
check('the policy is rebuilt', h2.visiting.repos.join() === 'shared' && h2.visiting.clearance === 'plan' && h2.visiting.tokensPerDay === 0, JSON.stringify(h2.visiting));
ws.out.length = 0;
g.onGuest(GUEST, { t: 'feed', msgs: [{ t: 'log', jobId: X, entry: { kind: 'text', summary: 'x' } }, { t: 'log', jobId: 'j3', entry: { kind: X } }, { t: 'job', job: evilJob }, { t: 'staff', dismissed: [X, 'ada'] }, { t: 'log', jobId: 'j3', entry: { kind: 'text', summary: X, html: X } }] });
check('the feed is cleaned the same way', ws.out.length === 2 && ws.out[0].t === 'staff' && ws.out[0].dismissed.join() === 'ada' && ws.out[1].entry.summary === X && !('html' in ws.out[1].entry), JSON.stringify(ws.out));
sent.length = 0;
const pj = g.request('G1', 'job', { job: 'j3' });
await sleep(5);
g.onGuest(GUEST, { t: 'res', id: sent.at(-1).id, ok: true, body: { job: job3, extra: X } });
const got = await pj;
check('request answers are cleaned too', got.job.mode === 'plan' && !('extra' in got));
sent.length = 0;
const pc = g.request('G1', 'createJob', {});
await sleep(5);
g.onGuest(GUEST, { t: 'res', id: sent.at(-1).id, ok: true, body: { job: evilJob } });
check('a bad job in an answer is an error, not passed on', (await pc.catch((e) => e)).code === 502);
sent.length = 0;
const pe = g.request('G1', 'stop', {});
await sleep(5);
g.onGuest(GUEST, { t: 'res', id: sent.at(-1).id, ok: false, code: X, error: { html: X } });
const ee = await pe.catch((e) => e);
check('a bad error is replaced', ee.code === 400 && ee.message === 'The host refused.', JSON.stringify(ee));

links.links = [];
g.linksChanged();
check('unlinked visits close 4404', ws.closed === 4404);

console.log(failed ? `${failed} failed` : 'all passed'); process.exit(failed ? 1 : 0);
