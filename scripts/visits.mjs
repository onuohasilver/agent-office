// A guest office's own agents working in a copy of one of our projects:
// the host's Visits on a real git repo (the copy, the path jail, read only vs
// edit, review and apply), then two Guests joined by a fake relay, the guest's
// agent reaching the host's files through visit.* requests.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Guests } from '../server/guests.js';
import { Visits, globRe } from '../server/visits.js';
let failed = 0; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${ok ? '' : x}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'visits-')));
const refused = async (p, code, re) => { try { await p; return false; } catch (e) { return e.code === code && (!re || re.test(e.message)); } };

// ---------- a project to share ----------
const root = tmp();
const web = path.join(root, 'web');
const outside = path.join(root, 'private');
fs.mkdirSync(path.join(web, 'src'), { recursive: true });
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, 'diary.txt'), 'keep out\n');
const g = (...a) => execFileSync('git', a, { cwd: web, encoding: 'utf8' });
g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
fs.writeFileSync(path.join(web, '.gitignore'), 'node_modules/\n.env\n');
fs.writeFileSync(path.join(web, 'src', 'app.js'), 'const title = "Hello";\nexport default title;\n');
fs.writeFileSync(path.join(web, 'README.md'), '# web\n');
g('add', '-A'); g('commit', '-qm', 'init');
// Uncommitted and untracked work is shared; ignored files are not.
fs.writeFileSync(path.join(web, 'README.md'), '# web\nwork in progress\n');
fs.writeFileSync(path.join(web, 'notes.txt'), 'untracked notes\n');
fs.writeFileSync(path.join(web, '.env'), 'SECRET=hunter2\n');
fs.mkdirSync(path.join(web, 'node_modules')); fs.writeFileSync(path.join(web, 'node_modules', 'x.js'), 'x');
// A committed key file and a link pointing out of the project.
fs.writeFileSync(path.join(web, 'deploy.pem'), 'PRIVATE KEY');
fs.symlinkSync(outside, path.join(web, 'escape'));
g('add', '-f', 'deploy.pem', 'escape'); g('commit', '-qm', 'oops');

const posted = [], sent = [], fed = [];
const data = tmp();
const visits = new Visits(data, { office: {
  repoPath: (n) => (n === 'web' ? web : n === 'plain' ? root : null),
  send: (m) => sent.push(m), post: (text, extra) => posted.push({ text, ...extra }), feed: (link, m) => fed.push({ link, m }),
} });
const L = { id: 'L1', peer: 'friend', kind: 'guest', role: 'host' };
const edit = { repos: ['web', 'plain'], theirAgents: 'edit' };
const read = { repos: ['web'], theirAgents: 'read' };

check('a project not shared is refused', await refused(visits.open(L, edit, { repo: 'api', job: 'j1' }), 403));
check('a host that lets no agents in refuses', await refused(visits.open(L, { repos: ['web'], theirAgents: 'off' }, { repo: 'web', job: 'j1' }), 403));
check('a folder that isn’t git is refused', await refused(visits.open(L, edit, { repo: 'plain', job: 'j1' }), 409, /git/));

const { sid, access } = await visits.open(L, edit, { repo: 'web', job: 'j1', title: 'Fix the header', agent: { name: 'Ada', role: 'Frontend' } });
check('open gives a session', /^[0-9a-f]{32}$/.test(sid) && access === 'edit');
const v = visits.list[0];
check('the visit is a job on our list', sent.some((m) => m.t === 'job' && m.job.id === v.id && m.job.visitor.name === 'Ada' && !('sid' in m.job) && !('dir' in m.job)), JSON.stringify(sent[0]));
check('the boss is told', posted.some((p) => /Ada from @friend is working in a copy of web/.test(p.text) && p.jobId === v.id));
const again = await visits.open(L, edit, { repo: 'web', job: 'j1' });
check('the same job gets the same session', again.sid === sid && visits.list.length === 1);

const fsop = (op, args = {}, p = edit) => visits.fs(L, { sid, op, ...args }, p).then((r) => r.text);
const list = await fsop('list', { depth: 3 });
check('the copy has tracked and untracked files', /src\/app\.js/.test(list) && /notes\.txt/.test(list), list);
check('ignored files stay home', !/\.env/.test(list) && !/node_modules/.test(list), list);
check('key files aren’t listed', !/deploy\.pem/.test(list), list);
check('uncommitted work is in the copy', /work in progress/.test(await fsop('read', { path: 'README.md' })));
check('reading has line numbers', /^\s+1\tconst title/.test(await fsop('read', { path: 'src/app.js' })));
check('reading a piece', /^\s+2\texport/.test(await fsop('read', { path: 'src/app.js', offset: 2, limit: 1 })));
check('search finds text', /src\/app\.js:1:const title/.test(await fsop('search', { pattern: 'title' })));
check('search skips secrets', !/pem/.test(await fsop('search', { pattern: 'PRIVATE' })));
check('find matches names', (await fsop('find', { pattern: '*.js' })).trim() === 'src/app.js');
check('a bad pattern is an error, not a crash', await refused(fsop('search', { pattern: '(' }), 400));

check('.. can’t leave the copy', await refused(fsop('read', { path: '../../private/diary.txt' }), 403));
check('an absolute path is held inside', await refused(fsop('read', { path: `/${outside}/diary.txt` }), 404));
check('a link out of the project is refused', await refused(fsop('read', { path: 'escape/diary.txt' }), 403, /outside/));
check('a link out can’t be listed through', await refused(fsop('list', { path: 'escape' }), 403));
check('a link out can’t be written through', await refused(fsop('write', { path: 'escape/diary.txt', content: 'x' }), 403));
check('.git is off limits', await refused(fsop('write', { path: '.git/config', content: 'x' }), 403));
check('.GIT is too', await refused(fsop('write', { path: '.GIT/hooks/pre-commit', content: 'x' }), 403));
check('.env can’t be written', await refused(fsop('write', { path: 'sub/.env.local', content: 'x' }), 403));
check('key files can’t be read', await refused(fsop('read', { path: 'deploy.pem' }), 403));
check('a missing file is a 404', await refused(fsop('read', { path: 'nope.js' }), 404));
check('the real folder outside is untouched', fs.readFileSync(path.join(outside, 'diary.txt'), 'utf8') === 'keep out\n');

check('edit replaces exact text', /Updated/.test(await fsop('edit', { path: 'src/app.js', old: '"Hello"', new: '"Hi there"' })));
check('edit refuses text that isn’t there', await refused(fsop('edit', { path: 'src/app.js', old: '"Hello"', new: 'x' }), 400));
check('write creates a file', /Created/.test(await fsop('write', { path: 'src/new/header.js', content: 'export const h = 1;\n' })));
check('append adds to it', /Updated/.test(await fsop('write', { path: 'src/new/header.js', content: 'export const i = 2;\n', append: true })));
check('a write over the cap is refused', await refused(fsop('write', { path: 'big.txt', content: 'x'.repeat(41 * 1024) }), 413));
check('the real project is untouched while they work', fs.readFileSync(path.join(web, 'src', 'app.js'), 'utf8').includes('"Hello"'));
check('every call is logged', v.log.filter((e) => e.kind === 'tool').length >= 10);
check('the owner turning edits off holds at once', await refused(fsop('write', { path: 'a.txt', content: 'x' }, read), 403) && v.access === 'read');
v.access = 'edit';

await visits.close(L, { sid, status: 'done', summary: 'Changed the header.' });
check('closing records the changes', v.status === 'done' && v.changes?.count === 2 && v.changes.files.map((f) => f.path).join() === 'src/app.js,src/new/header.js', JSON.stringify(v.changes));
check('a finished visit is marked ok', v.log.some((e) => e.kind === 'result' && e.ok === true));
check('the boss hears it finished', posted.some((p) => /finished “Fix the header” in web\. 2 files changed/.test(p.text)));
check('a closed session takes no more calls', await refused(fsop('read', { path: 'README.md' }), 410));
check('the diff of one file', /-const title = "Hello";\n\+const title = "Hi there";/.test(await visits.diff(v, 'src/app.js')));
check('a diff of a file they didn’t touch is refused', await visits.diff(v, 'README.md').then(() => false, () => true));

const back = await visits.open(L, edit, { repo: 'web', job: 'j1', title: 'and the footer' });
check('a follow-up goes back to the same copy', visits.list.length === 1 && v.status === 'working' && back.sid !== sid && /Hi there/.test((await visits.fs(L, { sid: back.sid, op: 'read', path: 'src/app.js' }, edit)).text));
check('applying while they work is refused', await refused(visits.apply(v), 409));
await visits.close(L, { sid: back.sid, status: 'done' });

await visits.apply(v);
check('apply puts the changes in the real folder', fs.readFileSync(path.join(web, 'src', 'app.js'), 'utf8').includes('"Hi there"') && fs.existsSync(path.join(web, 'src', 'new', 'header.js')));
check('apply keeps the boss’s own uncommitted work', fs.readFileSync(path.join(web, 'README.md'), 'utf8').includes('work in progress') && fs.readFileSync(path.join(web, '.env'), 'utf8') === 'SECRET=hunter2\n');
check('the copy is gone after apply', !fs.existsSync(v.dir) && v.applied);
check('apply twice is refused', await refused(visits.apply(v), 409));

// A copy whose project moved on underneath: apply refuses and changes nothing.
const s2 = (await visits.open(L, edit, { repo: 'web', job: 'j2', title: 'Rename' })).sid;
const v2 = visits.list.at(-1);
await visits.fs(L, { sid: s2, op: 'edit', path: 'src/app.js', old: '"Hi there"', new: '"Yo"' }, edit);
await visits.close(L, { sid: s2, status: 'done' });
fs.writeFileSync(path.join(web, 'src', 'app.js'), 'const title = "Changed meanwhile";\nexport default title;\n');
check('a conflicting apply is refused', await refused(visits.apply(v2), 409, /don’t apply cleanly/));
check('and leaves the folder as it was', fs.readFileSync(path.join(web, 'src', 'app.js'), 'utf8').includes('Changed meanwhile'));
visits.discard(v2);
check('discard throws the copy away', !fs.existsSync(v2.dir) && v2.discarded);

// Read only, then stopped by the boss.
const s3 = (await visits.open(L, read, { repo: 'web', job: 'j3', title: 'Look around' })).sid;
const v3 = visits.list.at(-1);
check('read only refuses writes', await refused(visits.fs(L, { sid: s3, op: 'write', path: 'x.txt', content: 'x' }, read), 403, /read only/));
check('read only still reads', /Changed meanwhile/.test((await visits.fs(L, { sid: s3, op: 'read', path: 'src/app.js' }, read)).text));
check('another guest can’t use the session', await refused(visits.fs({ ...L, id: 'L2' }, { sid: s3, op: 'read', path: 'src/app.js' }, read), 404));
check('a project unshared since stops the visit', await refused(visits.fs(L, { sid: s3, op: 'read', path: 'src/app.js' }, { repos: [], theirAgents: 'read' }), 403) && v3.status === 'stopped');

const s4 = (await visits.open(L, read, { repo: 'web', job: 'j4', title: 'Again' })).sid;
const v4 = visits.list.at(-1);
await visits.stop(v4);
check('the boss can stop a visit', v4.status === 'stopped' && fed.some((f) => f.link === 'L1' && f.m.t === 'visit' && f.m.job === 'j4'));
check('their next call is told it was stopped', await refused(visits.fs(L, { sid: s4, op: 'list' }, read), 410, /stopped/));

const { sid: s5 } = await visits.open(L, read, { repo: 'web', job: 'p1' });
const v5 = visits.list.find((x) => x.sid === s5);
visits.policyChanged('L2', { repos: [], theirAgents: 'off' });
check('another guest’s policy leaves it alone', v5.status === 'working');
visits.policyChanged('L1', { repos: ['plain'], theirAgents: 'read' });
await sleep(100);
check('unsharing the project stops it at once', v5.status === 'stopped' && fed.some((f) => f.m.t === 'visit' && f.m.job === 'p1'));
const { sid: s6 } = await visits.open(L, read, { repo: 'web', job: 'p2' });
visits.policyChanged('L1', { repos: ['web'], theirAgents: 'off' });
await sleep(100);
check('turning their agents off stops it at once', visits.list.find((x) => x.sid === s6).status === 'stopped');

for (let i = 0; i < 3; i++) await visits.open(L, read, { repo: 'web', job: `k${i}` });
check('at most three at once per guest', await refused(visits.open(L, read, { repo: 'web', job: 'k9' }), 429));
check('the opening line is the system, not the boss', visits.list.every((x) => x.log[0]?.kind === 'system'));
check('a stopped visit isn’t marked ok', visits.list.filter((x) => x.status === 'stopped').every((x) => x.log.some((e) => e.kind === 'result' && e.ok === false)));
visits.linksChanged(new Set());
await sleep(200);
check('unlinking stops them all', visits.list.every((x) => x.status !== 'working'));
const reloaded = new Visits(data, { office: { repoPath: () => web, send() {}, post() {}, feed() {} } });
check('visits survive a restart', reloaded.list.length === visits.list.length && reloaded.get(v.id)?.applied);
clearInterval(visits.sweeper); clearInterval(reloaded.sweeper);

check('globs', globRe('**/*.test.js').test('a/b/c.test.js') && globRe('*.js').test('src/app.js') && !globRe('src/*.js').test('src/a/b.js') && globRe('src/**').test('src/a/b.js'));

// ---------- over a link: our agent at a host ----------
let host, guest;
const fakeLinks = (link, policies, deliver) => ({
  links: [link], policies, visitors: new Map(),
  guestPolicy(id) { return this.policies[id] || null; },
  presentAt() { return null; },
  status() { return { connected: true }; },
  send(f) { setImmediate(() => deliver(f)); return true; },
});
const HL = { id: 'L1', peer: 'friend', kind: 'guest', role: 'host' };
const GL = { id: 'L1', peer: 'boss', kind: 'guest', role: 'guest' };
const policy = { repos: ['web'], clearance: 'edit', tokensPerDay: 1e6, ourAgents: false, theirAgents: 'edit' };
const hostLinks = fakeLinks(HL, { L1: policy }, (f) => guest.onGuest(GL, f.t === 'feed' ? f : f));
const guestLinks = fakeLinks(GL, {}, (f) => host.onGuest(HL, f));
const office = { jobs: () => [], createJob() { throw new Error('should not'); }, staff: () => [{ id: 'kai', name: 'Kai' }], modes: () => ({ plan: 'Plan only', edit: 'Edit files', auto: 'Full autonomy' }), send() {} };
const hv = new Visits(tmp(), { office: { repoPath: (n) => (n === 'web' ? web : null), send() {}, post() {}, feed: (link, m) => hostLinks.send({ t: 'feed', link, msgs: [m] }) } });
host = new Guests(tmp(), { links: hostLinks, office, visits: hv });
const stopped = [];
guest = new Guests(tmp(), { links: guestLinks, office: { ...office, awayStopped: (job, link) => stopped.push({ job, link }) } });

guest.syncRemote();
await sleep(30);
check('the host’s shared projects reach us', guest.awayFolder('web', 'boss')?.access === 'edit' && guest.awayFolders().length === 1, JSON.stringify(guest.awayFolders()));
check('a host that doesn’t lend agents shows none to tag', guest.remoteStatus()[0].staff.length === 0);
check('nor takes jobs for them', await refused(guest.request('L1', 'createJob', { repo: 'web', prompt: 'x' }), 403, /doesn’t lend/));
check('an unknown project at the host is null', guest.awayFolder('api', 'boss') === null && guest.awayFolder('web', 'nobody') === null);

const job = { id: 'job1', title: 'Fix it', away: { link: 'L1', host: 'boss', repo: 'web', access: 'edit' } };
const agent = { name: 'Kai', role: 'Mobile' };
check('our agent reads the host’s file', /Changed meanwhile/.test(await guest.awayFs(job, agent, 'read', { path: 'src/app.js' })));
check('and edits its copy', /Updated/.test(await guest.awayFs(job, agent, 'edit', { path: 'src/app.js', old: 'Changed meanwhile', new: 'From Kai' })));
check('the host sees who is working', hv.list[0].visitor.name === 'Kai' && hv.list[0].visitor.handle === 'friend');
check('the jail holds over the link too', await refused(guest.awayFs(job, agent, 'read', { path: '../private/diary.txt' }), 403));
await guest.awayClose(job, 'done', 'Renamed the title.');
await sleep(20);
check('closing ends the host’s side with changes', hv.list[0].status === 'done' && hv.list[0].changes?.count === 1);
check('the real folder waits for review', fs.readFileSync(path.join(web, 'src', 'app.js'), 'utf8').includes('Changed meanwhile'));

await guest.awayFs(job, agent, 'list', {});
await hv.stop(hv.list[0]);
await sleep(30);
check('the host stopping it reaches our office', stopped.some((s) => s.job === 'job1' && s.link === 'L1'), JSON.stringify(stopped));

policy.theirAgents = 'off';
check('turning it off refuses the next call', await refused(guest.awayFs({ ...job, id: 'job2' }, agent, 'list', {}), 403));
host.links.send({ t: 'feed', link: 'L1', msgs: [{ t: 'policy' }] });
await sleep(50);
check('a policy change is picked up', guest.awayFolder('web', 'boss') === null && guest.awayFolders().length === 0, JSON.stringify(guest.awayFolders()));
clearInterval(hv.sweeper);

const before = visits.list.length;
const pending = visits.list.filter((x) => x.status !== 'working' && x.access === 'edit' && x.changes?.count && !x.applied && !x.discarded).length;
visits.clear();
check('clear finished keeps only work in progress or awaiting review', visits.list.length === pending + visits.list.filter((x) => x.status === 'working').length && visits.list.length < before, `${before} -> ${visits.list.length}`);
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
