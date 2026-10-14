#!/usr/bin/env node
// Regression tests for the second security pass: a project's git filters never
// run when the office snapshots or copies it, visits don't pile up copies, link
// ids can't name a prototype, and reaping leaves a reused process group alone.
// Runs the committed code (git archive HEAD, or GATE_REF) from a temp copy, so
// work in progress in the tree can't change the result. Costs no tokens.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-hardening-')));
const app = path.join(tmp, 'app');
fs.mkdirSync(app);
const REF = process.env.GATE_REF || 'HEAD';
execFileSync('/bin/sh', ['-c', `git -C "${APP}" archive "${REF}" server shared package.json | tar -x -C "${app}"`]);
fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'), 'dir');
const load = (f) => import(pathToFileURL(path.join(app, 'server', f)).href);

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok    ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}: ${err.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const refused = async (p, code) => { try { await p; return false; } catch (e) { return e.code === code; } };

const { snapshotTree } = await load('changes.js');
const { Visits } = await load('visits.js');
const { Links } = await load('links.js');
const { Guests } = await load('guests.js');
const { remember, reap } = await load('machine.js');
const { ps } = await load('procstat.js');

// ---------- a project whose config names a filter that runs code ----------
const project = path.join(tmp, 'web');
const marker = path.join(tmp, 'filter-ran');
fs.mkdirSync(project);
const g = (...a) => execFileSync('git', a, { cwd: project, encoding: 'utf8' });
g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
fs.writeFileSync(path.join(project, 'app.js'), 'export default 1;\n');
g('add', '-A'); g('commit', '-qm', 'init');
fs.writeFileSync(path.join(project, '.gitattributes'), '* filter=evil\n');
g('config', 'filter.evil.clean', `touch "${marker}"; cat`);
g('config', 'filter.evil.smudge', `touch "${marker}"; cat`);
g('config', 'filter.evil.required', 'true');
fs.writeFileSync(path.join(project, 'app.js'), 'export default 2;\n');

await check('control: git add -A with this config does run the filter', async () => {
  const idx = path.join(tmp, 'control-index');
  execFileSync('git', ['add', '-A'], { cwd: project, env: { ...process.env, GIT_INDEX_FILE: idx } });
  assert(fs.existsSync(marker), 'the filter never ran, so the checks below prove nothing');
  fs.rmSync(marker); fs.rmSync(idx);
});

await check('snapshotTree runs no clean filter', async () => {
  const sha = await snapshotTree(project);
  assert(/^[0-9a-f]{40}$/.test(sha || ''), `no tree: ${sha}`);
  assert(!fs.existsSync(marker), 'the clean filter ran');
});

// ---------- visits: copies made, recorded and capped without filters ----------
const data = path.join(tmp, 'visits-data');
fs.mkdirSync(data);
const visits = new Visits(data, { office: { repoPath: (n) => (n === 'web' ? project : null), send() {}, post() {}, feed() {} } });
const L = { id: 'L1', peer: 'friend', kind: 'guest', role: 'host' };
const policy = { repos: ['web'], theirAgents: 'edit' };
const open = (job) => visits.open(L, policy, { repo: 'web', job, agent: { name: 'Ada' } });
const write = (sid, content) => visits.fs(L, { sid, op: 'write', path: 'app.js', content }, policy);

await check('copying a project for a visit runs no smudge filter', async () => {
  const { sid } = await open('j0');
  assert(!fs.existsSync(marker), 'the smudge filter ran on checkout');
  await write(sid, 'export default 3;\n');
  await visits.close(L, { sid, status: 'done' });
  assert(!fs.existsSync(marker), 'the clean filter ran on recording the copy');
  const v = visits.list.find((x) => x.theirJob === 'j0');
  assert(v.changes?.count === 1, `changes not recorded: ${JSON.stringify(v.changes)}`);
});

await check('a visit that changed nothing leaves no copy behind', async () => {
  const { sid } = await open('j-nothing');
  const v = visits.list.find((x) => x.theirJob === 'j-nothing');
  assert(fs.existsSync(v.dir), 'no copy made');
  await visits.close(L, { sid, status: 'done' });
  assert(!fs.existsSync(v.dir), 'the empty copy is still on disk');
});

await check('a guest can keep at most 6 copies waiting for review', async () => {
  // j0 above is one already.
  for (let i = 1; i < 6; i++) {
    const { sid } = await open(`j${i}`);
    await write(sid, `export default ${10 + i};\n`);
    await visits.close(L, { sid, status: 'done' });
  }
  assert(await refused(open('j-seventh'), 429), 'a seventh copy was made');
  visits.discard(visits.list.find((x) => x.theirJob === 'j1'));
  const { sid } = await open('j-after-discard');
  assert(sid, 'discarding one did not free a slot');
});

// ---------- link ids that name a prototype ----------
const linkData = path.join(tmp, 'links-data');
fs.mkdirSync(linkData);
fs.writeFileSync(path.join(linkData, 'links.json'), JSON.stringify({ links: [{ id: 'constructor', role: 'host', kind: 'guest' }], guests: {} }));
const links = new Links(linkData, { board: { me: {}, endpoint() { throw new Error('offline'); } }, presence: () => [] });
links.disconnect();

await check('guestPolicy finds no limits on a link named constructor', async () => {
  assert(links.guestPolicy('constructor') === null, `got ${typeof links.guestPolicy('constructor')}`);
});

await check('the relay cannot list a link or invite named after a prototype', async () => {
  links.receive({ t: 'links', links: [
    { id: '__proto__', role: 'host' }, { id: 'constructor', role: 'host' }, { id: 'prototype' },
    { id: 'ok-1', role: 'host', invite: '__proto__' },
  ] });
  const ids = links.links.map((l) => l.id);
  assert(ids.join() === 'ok-1', `kept ${ids}`);
  assert(links.links[0].invite === null, `invite kept: ${links.links[0].invite}`);
  links.receive({ t: 'link', link: { id: '__proto__', role: 'host' } });
  assert(links.links.length === 1, 'a single link frame got through');
});

await check('saved token use keyed __proto__ does not reach Object.prototype, and is saved 0600', async () => {
  const gData = path.join(tmp, 'guests-data');
  fs.mkdirSync(gData);
  fs.writeFileSync(path.join(gData, 'guests.json'), '{"used":{"__proto__":{"polluted":1},"L2":{"tokens":5}}}');
  const guests = new Guests(gData, { links, office: {} });
  assert(Object.getPrototypeOf(guests.used) === null, 'used has a prototype');
  assert(({}).polluted === undefined && guests.used.toString === undefined, 'prototype reached');
  assert(guests.used.L2?.tokens === 5, 'real entries lost');
  // A guests.json from before the fix is 0644; the next save leaves it 0600.
  fs.chmodSync(path.join(gData, 'guests.json'), 0o644);
  guests.save();
  const m = fs.statSync(path.join(gData, 'guests.json')).mode & 0o777;
  assert(m === 0o600, `guests.json ${m.toString(8)} after a save`);
});

// ---------- reap: a process group number reused by a stranger ----------
// A stand-in for the agent's own process, so reap has a root to skip.
const root = { pid: process.pid, pgid: -1 };
const spawnGroup = () => {
  // A leader in its own group with a child in the same group, as a backgrounded shell leaves.
  const c = spawn('/bin/sh', ['-c', 'sleep 303 & wait'], { detached: true, stdio: 'ignore' });
  c.unref();
  return c.pid;
};
const procOf = async (pid) => { for (let i = 0; i < 20; i++) { const s = await ps(); const kid = [...s.procs.values()].find((p) => p.ppid === pid); if (kid) return { leader: s.procs.get(pid), kid }; await sleep(100); } throw new Error('no child'); };
const strays = [];

await check('a group whose leader started at another time is not reaped', async () => {
  const pid = spawnGroup(); strays.push(-pid);
  const { leader, kid } = await procOf(pid);
  // What the job saw: the same pid and command, but long before. A newcomer with its pid.
  remember('job-reuse', [root, { ...leader, start: leader.start - 600_000 }], process.pid);
  const stopped = await reap('job-reuse');
  await sleep(300);
  assert(alive(pid) && alive(kid.pid), `stopped ${stopped}`);
});

await check('control: the same group, as seen, is reaped', async () => {
  const pid = spawnGroup(); strays.push(-pid);
  const { leader, kid } = await procOf(pid);
  remember('job-own', [root, leader], process.pid);
  await reap('job-own');
  for (let i = 0; i < 30 && (alive(pid) || alive(kid.pid)); i++) await sleep(100);
  assert(!alive(kid.pid), 'the job\'s background child is still running');
});

for (const p of strays) try { process.kill(p, 'SIGKILL'); } catch {}

// ---------- the real server: attach_files and the data folder ----------
execFileSync('/bin/sh', ['-c', `git -C "${APP}" archive "${REF}" bin web/index.html leaderboard/src/worker.js | tar -x -C "${app}"`]);
fs.mkdirSync(path.join(app, 'dist', 'assets'), { recursive: true });
fs.writeFileSync(path.join(app, 'dist', 'index.html'), '<!doctype html><title>Office</title><script type="module" src="/assets/app.js"></script>');
fs.writeFileSync(path.join(app, 'dist', 'assets', 'app.js'), 'export {};');

// A stand-in `claude`: records how it was started, and on ATTACH <json list>
// asks attach_files for each path in turn.
const record = path.join(tmp, 'record.jsonl');
const stub = path.join(tmp, 'claude');
fs.writeFileSync(stub, `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
const mcpFile = args[args.indexOf('--mcp-config') + 1];
const env = JSON.parse(fs.readFileSync(mcpFile, 'utf8')).mcpServers.office.env;
const rec = (o) => fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ job: env.OFFICE_JOB, ...o }) + '\\n');
const call = (tool, body) => fetch(env.OFFICE_URL + '/api/agent/' + tool, { method: 'POST', headers: { 'content-type': 'application/json', 'x-office-job': env.OFFICE_JOB, 'x-office-token': env.OFFICE_TOKEN }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
rec({ args, mcpFile });
let busy = Promise.resolve();
require('readline').createInterface({ input: process.stdin }).on('line', (line) => { busy = busy.then(() => turn(JSON.parse(line).message.content)); });
process.stdin.on('end', () => busy.then(() => process.exit(0)));
async function turn(text) {
  out({ type: 'system', subtype: 'init', session_id: 's-' + env.OFFICE_JOB, model: 'stub' });
  const m = text.match(/ATTACH (\\[.*?\\])/);
  if (m) for (const p of JSON.parse(m[1])) rec({ path: p, res: await call('attach_files', { paths: [p] }) });
  rec({ done: true });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 's-' + env.OFFICE_JOB, total_cost_usd: 0, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 } });
}
`, { mode: 0o755 });

const recs = () => (fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const mode = (p) => fs.statSync(p).mode & 0o777;
const octal = (n) => n.toString(8).padStart(3, '0');
const gitRepo = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  for (const a of [['init', '-q'], ['add', '.'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']]) execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
};

async function serve(name, { root, data }, body) {
  const port = 4300 + Math.floor(Math.random() * 600);
  const env = { ...process.env, PORT: String(port), OFFICE_ROOT: root, OFFICE_DATA: data, CLAUDE_BIN: stub, STANDUP_AT: 'off', BANTER: 'off', OFFICE_PRESSURE_CHECK: 'off', OFFICE_LEADERBOARD_URL: 'http://127.0.0.1:9' };
  delete env.ANTHROPIC_API_KEY; delete env.OFFICE_LAN; delete env.OFFICE_DESKTOP; delete env.OFFICE_ALLOWED_HOSTS;
  const server = spawn(process.execPath, ['server/index.js'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const exited = new Promise((r) => server.on('exit', r));
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 100 && !/Agent Office open/.test(log); i++) await sleep(150);
    if (!/Agent Office open/.test(log)) throw new Error(`${name} never started: ${log.slice(-800)}`);
    const key = fs.readFileSync(path.join(data, 'office-key'), 'utf8').trim();
    const crypto = await import('node:crypto');
    // The cookie holds a MAC of the key; before 3ea8432 it held the key, which a GATE_REF that old still wants.
    const cookies = [crypto.createHmac('sha256', key).update(`office-cookie:${port}`).digest('hex'), key].map((v) => `office_key_${port}=${v}`);
    const job = async (repo, prompt, m = 'edit') => {
      const post = (cookie) => fetch(`http://127.0.0.1:${port}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ repo, prompt, mode: m }) });
      let r = await post(cookies[0]);
      if (r.status === 401) r = await post(cookies[1]);
      const j = await r.json();
      if (!j.id) throw new Error(`no job: ${r.status} ${JSON.stringify(j)}`);
      for (let i = 0; i < 150 && !recs().some((x) => x.job === j.id && x.done); i++) await sleep(100);
      return recs().filter((x) => x.job === j.id);
    };
    await body({ job, log: () => log });
  } catch (err) {
    failed++; console.log(`FAIL  ${name}: ${err.message}`);
  } finally { server.kill('SIGTERM'); await Promise.race([exited, sleep(3000)]); }
}

// Data outside the projects folder, as the agentoffice command sets it.
{
  const root = path.join(tmp, 'projects');
  const data = path.join(tmp, 'data');
  const shop = path.join(root, 'storefront');
  gitRepo(shop);
  const secret = path.join(tmp, 'id_rsa');
  fs.writeFileSync(secret, 'PRIVATE KEY\n');
  fs.symlinkSync(secret, path.join(shop, 'leak'));
  await serve('data outside the projects folder', { root, data }, async ({ job }) => {
    const r = await job('storefront', `ATTACH ${JSON.stringify([path.join(shop, 'README.md'), secret, path.join(shop, 'leak'), path.join(data, 'office-key'), path.join(shop, '..', 'storefront', '..', '..', 'id_rsa')])}`);
    const of = (p) => r.find((x) => x.path === p)?.res;
    await check('attach_files takes a file in the job\'s project', async () => {
      const res = of(path.join(shop, 'README.md'));
      assert(res?.status === 200 && /1 file/.test(res.text), JSON.stringify(res));
    });
    await check('attach_files refuses a file outside the project below Full autonomy', async () => {
      for (const p of [secret, path.join(data, 'office-key'), path.join(shop, '..', 'storefront', '..', '..', 'id_rsa')]) {
        const res = of(p);
        assert(res && res.status !== 200 && /only files in this job/.test(res.error || ''), `${p}: ${JSON.stringify(res)}`);
      }
    });
    await check('attach_files refuses a link in the project that points out of it', async () => {
      const res = of(path.join(shop, 'leak'));
      assert(res && res.status !== 200 && /only files in this job/.test(res.error || ''), JSON.stringify(res));
    });
    await check('control: at Full autonomy attach_files takes any file', async () => {
      const res = (await job('storefront', `ATTACH ${JSON.stringify([secret])}`, 'auto')).find((x) => x.path === secret)?.res;
      assert(res?.status === 200, JSON.stringify(res));
    });
    await sleep(800); // the state save is debounced
    await check('the data folder is 0700 and state.json 0600', async () => {
      assert(mode(data) === 0o700, `data ${octal(mode(data))}`);
      assert(mode(path.join(data, 'state.json')) === 0o600, `state.json ${octal(mode(path.join(data, 'state.json')))}`);
    });
    await check('an attached file is copied private: 0700 folder, 0600 file', async () => {
      const ups = path.join(data, 'uploads');
      const dirs = fs.readdirSync(ups).map((d) => path.join(ups, d));
      assert(dirs.length >= 1, 'nothing staged');
      for (const d of dirs) {
        assert(mode(d) === 0o700, `${d} ${octal(mode(d))}`);
        for (const f of fs.readdirSync(d)) assert(mode(path.join(d, f)) === 0o600, `${f} ${octal(mode(path.join(d, f)))}`);
      }
    });
    await check('job tokens sit in a private folder in the data folder', async () => {
      const { mcpFile } = r.find((x) => x.mcpFile);
      assert(mcpFile.startsWith(path.join(data, 'mcp') + path.sep), mcpFile);
      assert(mode(path.dirname(mcpFile)) === 0o700, `mcp ${octal(mode(path.dirname(mcpFile)))}`);
    });
  });
}

// Data inside the projects folder, as a clone keeps it: a job in the office's own project.
{
  const root = path.join(tmp, 'clone-root');
  const office = path.join(root, 'office');
  const data = path.join(office, 'data');
  gitRepo(office);
  await serve('data inside the projects folder', { root, data }, async ({ job, log }) => {
    const r = await job('office', `ATTACH ${JSON.stringify([path.join(office, 'README.md'), path.join(data, 'office-key')])}`);
    const of = (p) => r.find((x) => x.path === p)?.res;
    const { args, mcpFile } = r.find((x) => x.args);
    await check('the server warns that data sits in the projects folder', async () => {
      assert(/inside the projects folder/.test(log()), 'no warning');
    });
    await check('job tokens are kept outside the projects folder', async () => {
      assert(!fs.realpathSync(mcpFile).startsWith(fs.realpathSync(root) + path.sep), mcpFile);
      assert(mode(path.dirname(mcpFile)) === 0o700, `mcp ${octal(mode(path.dirname(mcpFile)))}`);
    });
    await check('a job there is denied the office key and state by its file tools', async () => {
      const i = args.indexOf('--settings');
      assert(i >= 0, 'no --settings');
      const deny = JSON.parse(args[i + 1]).permissions?.deny || [];
      for (const n of ['office-key', 'state.json', 'links.json', 'mcp']) {
        for (const t of ['Read', 'Edit']) assert(deny.includes(`${t}(/${path.join(data, n)})`) && deny.includes(`${t}(/${path.join(data, n)}/**)`), `${t} ${n} not denied: ${deny.slice(0, 4)}`);
      }
      assert(!deny.some((d) => d.includes(path.join(data, 'uploads'))), 'uploads denied, but the job is given them');
    });
    await check('attach_files there takes the project\'s files but not the office key', async () => {
      assert(of(path.join(office, 'README.md'))?.status === 200, JSON.stringify(of(path.join(office, 'README.md'))));
      const res = of(path.join(data, 'office-key'));
      assert(res && res.status !== 200 && /only files in this job/.test(res.error || ''), JSON.stringify(res));
    });
  });
}

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
