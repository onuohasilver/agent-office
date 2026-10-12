// Working with a linked office's agents from our own office: two Guests (a
// host and its guest) joined by a fake relay, the guest's chat-side calls
// (tagged, startRemote, remoteOp) and the host's feed folding into our list.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Guests } from '../server/guests.js';
let failed = 0; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${ok ? '' : x}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'remote-'));

let host, guest;
const fakeLinks = (link, policies, deliver) => ({
  links: [link], policies, visitors: new Map(),
  guestPolicy(id) { return this.policies[id] || null; },
  presentAt(id) { return this.visitors.get(id)?.agents || null; },
  status() { return { connected: true }; },
  send(f) { setImmediate(() => deliver(f)); return true; },
});
const HL = { id: 'L1', peer: 'boss', kind: 'guest', role: 'host' };
const GL = { id: 'L1', peer: 'friend', kind: 'guest', role: 'guest' };
const hostLinks = fakeLinks(HL, { L1: { repos: ['api', 'web'], clearance: 'edit', tokensPerDay: 1e6 } }, (f) => guest.onGuest(GL, f));
const guestLinks = fakeLinks(GL, {}, (f) => host.onGuest(HL, f));
guestLinks.visitors.set('L1', { agents: [{ id: 'ada' }, { id: 'tunde' }] });

const hostJobs = [];
let n = 0;
const hostOffice = {
  jobs: () => hostJobs,
  createJob(body, extra) { const j = { id: `h${++n}`, ...body, ...extra, title: body.prompt, status: 'queued', log: [] }; hostJobs.push(j); return j; },
  replyJob(job, body) { job.lastReply = body; },
  stopJob(job) { job.status = 'stopped'; },
  diff: async () => 'DIFF',
  staff: () => [{ id: 'ada', name: 'Ada' }, { id: 'tunde', name: 'Tunde' }, { id: 'kai', name: 'Kai' }],
  modes: () => ({ plan: 'Plan only', edit: 'Edit files', auto: 'Full autonomy' }),
  send: () => {},
};
const out = [];
const ended = [];
const guestOffice = { ...hostOffice, jobs: () => [], send: (m) => out.push(m), remoteEnded: (j) => ended.push(j), repoPath: (n) => (n === 'mine' ? '/x/mine' : null) };
host = new Guests(tmp(), { links: hostLinks, office: hostOffice });
const gdir = tmp();
guest = new Guests(gdir, { links: guestLinks, office: guestOffice });

guest.syncRemote();
await sleep(30);
const st = guest.remoteStatus();
check('the host’s agents arrive without a visit', st.length === 1 && st[0].host === 'friend' && st[0].staff.map((s) => s.id).join() === 'L1.ada,L1.tunde,L1.kai', JSON.stringify(st));
check('only agents on the host’s floor can be tagged', st[0].staff.find((s) => s.name === 'Kai').here === false);
check('our page was told', out.some((m) => m.t === 'remote' && m.offices.length === 1));

const local = (name) => name.toLowerCase() === 'tunde';
let t = guest.tagged('@Ada fix the login bug', local);
check('a bare @Name finds their agent', t?.staff.id === 'L1.ada' && t.clean === 'fix the login bug', JSON.stringify(t));
check('our own agent wins a bare @Name', guest.tagged('@Tunde look at this', local) === null);
t = guest.tagged('@Tunde@friend look at this', local);
check('@Name@host reaches theirs', t?.staff.id === 'L1.tunde' && t.clean === 'look at this', JSON.stringify(t));
check('an agent not on their floor can’t be tagged', guest.tagged('@Kai hi', local) === null);
check('an email address isn’t a tag', guest.tagged('mail me at x@Ada', local) === null);
guest.remote.get('L1').staff.push({ id: 'ad', name: 'Ad' });
check('an unknown @Name@host isn’t read as a shorter name', guest.tagged('@Ada@nobody hi', local) === null);
guest.remote.get('L1').staff.pop();

await guest.startRemote({ link: 'L1', staff: t.staff, text: 'tidy it', mode: 'edit', model: '', thread: 'm1', channel: 'general' })
  .then(() => check('two shared projects and none named asks which', false), (e) => check('two shared projects and none named asks which', /api, web/.test(e.message), e.message));
await guest.startRemote({ link: 'L1', staff: t.staff, text: 'what is #mine about', mode: 'edit', model: '', thread: 'm1', channel: 'general' })
  .then(() => check('our own #project isn’t quietly swapped for theirs', false), (e) => check('our own #project isn’t quietly swapped for theirs', /one of your own projects/.test(e.message), e.message));
let r = await guest.startRemote({ link: 'L1', staff: t.staff, text: 'tidy the #web header', mode: 'auto', model: '', thread: 'm1', channel: 'general' });
const hj = hostJobs.at(-1);
check('a #tag picks the project and leaves the brief', hj.repo === 'web' && hj.prompt === 'tidy the header' && hj.agentId === 'tunde', JSON.stringify(hj));
check('clearance is capped to the host’s, not refused', hj.mode === 'edit' && r.capped);
check('our copy is namespaced and knows its thread', r.job.id === `L1.${hj.id}` && r.job.agentId === 'L1.tunde' && r.job.thread === 'm1' && r.job.remote.host === 'friend' && !('from' in r.job), JSON.stringify(r.job));
r = await guest.startRemote({ link: 'L1', staff: t.staff, text: 'and the footer', mode: 'edit', model: '', thread: 'm2', channel: 'general' });
check('next time the last project is used', hostJobs.at(-1).repo === 'web');
r = await guest.startRemote({ link: 'L1', staff: t.staff, text: 'bump the api version', mode: 'edit', model: '', thread: 'm3', channel: 'general' });
check('a project named in the brief is used', hostJobs.at(-1).repo === 'api');

check('a thread finds its job', guest.threadJob('m1') === `L1.${hj.id}`);
await guest.remoteOp(`L1.${hj.id}`, 'reply', { message: 'also the logo', mode: 'auto' });
check('replies reach the host, capped', hj.lastReply?.message === 'also the logo' && hj.lastReply.mode === 'edit', JSON.stringify(hj.lastReply));
await guest.remoteOp(`L1.${hj.id}`, 'reply', { message: 'x', files: ['f'] }).then(() => check('files don’t cross', false), (e) => check('files don’t cross', e.code === 400));
const full = await guest.remoteOp(`L1.${hj.id}`, 'job');
check('opening a job fetches it from the host', full.id === `L1.${hj.id}` && full.repo === 'web');
check('diffs come from the host', (await guest.remoteOp(`L1.${hj.id}`, 'diff', { path: 'a' })).diff === 'DIFF');
await guest.remoteOp('L1.nope', 'stop').then(() => check('another job is refused by the host', false), (e) => check('another job is refused by the host', e.code === 404));
await guest.remoteOp('L9.h1', 'job').then(() => check('an unknown office is a 404', false), (e) => check('an unknown office is a 404', e.code === 404));

out.length = 0;
hj.status = 'working';
host.feed({ t: 'job', job: hj });
host.feed({ t: 'log', jobId: hj.id, entry: { kind: 'text', summary: 'on it' } });
await sleep(300);
check('the host’s feed lands in our list, namespaced', out.some((m) => m.t === 'job' && m.job.id === `L1.${hj.id}` && m.job.status === 'working') && out.some((m) => m.t === 'log' && m.jobId === `L1.${hj.id}`), JSON.stringify(out));
hj.status = 'done';
host.feed({ t: 'log', jobId: hj.id, entry: { kind: 'result', ok: true, summary: 'Header tidied.' } });
host.feed({ t: 'job', job: hj });
await sleep(300);
check('a finished job is reported where it was asked', ended.length === 1 && ended[0].thread === 'm1' && ended[0].log.at(-1)?.summary === 'Header tidied.', JSON.stringify(ended));
check('snapshot jobs include theirs', guest.remoteJobs().length === 3);

const again = new Guests(gdir, { links: guestLinks, office: guestOffice });
check('threads survive a restart', again.asked.threads[`L1.${hj.id}`]?.thread === 'm1' && again.asked.lastRepo.L1 === 'api');

guestLinks.links = [];
out.length = 0;
guest.linksChanged();
check('unlinking drops their agents and tells the page', guest.remoteStatus().length === 0 && out.some((m) => m.t === 'remote' && !m.offices.length));
check('and their tags stop working', guest.tagged('@Ada hi', local) === null);

console.log(failed ? `${failed} failed` : 'all passed'); process.exit(failed ? 1 : 0);
