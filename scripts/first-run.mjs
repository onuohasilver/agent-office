#!/usr/bin/env node
// The first-run experience: `agentoffice doctor` and the startup preflight,
// project discovery (git repo, subfolders, folders added from the UI) and the
// plan-only first job. Needs a build (`npm run build`) for the CLI half, which
// runs the real `agentoffice` from a copy of the app in a temp folder with its
// own data, against a stand-in `claude`. Costs no tokens.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runPreflight, formatReport, formatWarnings, tryPort } from '../server/preflight.js';
import { startupProjects, projectMap, acceptFolder, gitTop } from '../server/projects.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok    ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}: ${err.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const same = (a, b, what = '') => assert(JSON.stringify(a) === JSON.stringify(b), `${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-firstrun-')));
const dir = (...p) => { const d = path.join(tmp, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const gitRepo = (...p) => {
  const d = dir(...p);
  execFileSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, 'README.md'), 'hi\n');
  execFileSync('git', ['add', '.'], { cwd: d });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: d });
  return d;
};

// A stand-in claude. STUB_AUTH=out makes `auth status` say signed out. It
// answers a job with a finished turn and records how it was called.
const record = path.join(tmp, 'claude-calls.jsonl');
const stub = path.join(tmp, 'claude');
fs.writeFileSync(stub, `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('9.9.9 (stand-in)'); process.exit(0); }
if (args[0] === 'auth') {
  const out = process.env.STUB_AUTH === 'out';
  console.log(JSON.stringify({ loggedIn: !out }));
  process.exit(out ? 1 : 0);
}
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
process.stdin.once('data', () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'system', subtype: 'init', session_id: 's1', model: 'stub' });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'A summary.', session_id: 's1', total_cost_usd: 0, duration_ms: 10, usage: { input_tokens: 1, output_tokens: 1 } });
  process.exit(0);
});
`, { mode: 0o755 });
const nothing = path.join(tmp, 'does-not-exist');
const baseEnv = { ...process.env, CLAUDE_BIN: stub, OFFICE_DATA: dir('data0'), STANDUP_AT: 'off', BANTER: 'off' };
delete baseEnv.ANTHROPIC_API_KEY;
delete baseEnv.OFFICE_ROOT;
delete baseEnv.OFFICE_PROJECT;

// ---------- preflight ----------

const pre = (o = {}) => runPreflight({ env: baseEnv, claudeBin: stub, dataDir: baseEnv.OFFICE_DATA, ...o });
const failing = (r) => r.checks.filter((c) => !c.ok).map((c) => c.id);

await check('preflight: a ready machine has nothing to fix', async () => {
  const r = await pre({ port: await tryPort(0) });
  assert(r.ok, JSON.stringify(failing(r)));
  same(r.checks.map((c) => c.id), ['node', 'git', 'claude', 'auth', 'port'], 'checks');
});
await check('preflight: an old node names the fix', async () => {
  const r = await pre({ nodeVersion: '18.19.0' });
  same(failing(r), ['node']);
  assert(/Node 20/.test(r.checks[0].fix) && /18\.19\.0/.test(r.checks[0].problem), JSON.stringify(r.checks[0]));
});
await check('preflight: no git', async () => {
  same(failing(await pre({ gitBin: nothing })), ['git']);
});
await check('preflight: no claude is one problem, not two', async () => {
  const r = await pre({ claudeBin: nothing });
  same(failing(r), ['claude']);
  assert(/npm install -g @anthropic-ai\/claude-code/.test(r.checks.find((c) => c.id === 'claude').fix), 'fix');
});
await check('preflight: signed out, then an API key in the environment', async () => {
  same(failing(await pre({ env: { ...baseEnv, STUB_AUTH: 'out' } })), ['auth']);
  const withKey = await pre({ env: { ...baseEnv, STUB_AUTH: 'out', ANTHROPIC_API_KEY: 'sk-ant-x' } });
  assert(withKey.ok, JSON.stringify(failing(withKey)));
});
await check('preflight: an API key saved in the office counts as signed in', async () => {
  const data = dir('data-key');
  fs.writeFileSync(path.join(data, 'auth.json'), JSON.stringify({ mode: 'apikey', key: 'sk-ant-x' }));
  assert((await pre({ env: { ...baseEnv, STUB_AUTH: 'out' }, dataDir: data })).ok, 'not signed in');
});
await check('preflight: a chosen port that is taken', async () => {
  const busy = net.createServer();
  await new Promise((r) => busy.listen(0, '127.0.0.1', r));
  const port = busy.address().port;
  try {
    const r = await pre({ port });
    same(failing(r), ['port']);
    assert(r.checks.at(-1).problem.includes(String(port)) && /--port/.test(r.checks.at(-1).fix), JSON.stringify(r.checks.at(-1)));
  } finally { busy.close(); }
});
await check('preflight: skip leaves checks out; the report and warnings read well', async () => {
  const r = await pre({ claudeBin: nothing, nodeVersion: '18.0.0', skip: ['port', 'git'] });
  same(r.checks.map((c) => c.id), ['node', 'claude']);
  const text = formatReport(r);
  assert(text.split('\n').filter((l) => l.includes('FAIL')).length === 2 && /Fix: /.test(text) && /2 problems/.test(text), text);
  const warnings = formatWarnings(r);
  assert(warnings.length === 2 && warnings.every((w) => w.startsWith('Warning: ')), JSON.stringify(warnings));
  assert(formatWarnings(await pre()).length === 0, 'warned on a good machine');
});

// ---------- project discovery ----------

await check('startup: OFFICE_ROOT always wins, a git repo is the project, else the folder', () => {
  const repo = gitRepo('code', 'web');
  const plain = dir('plain');
  same(startupProjects({ cwd: repo, env: { OFFICE_ROOT: '/x' } }), { root: '/x', project: '' }, 'explicit');
  same(startupProjects({ cwd: dir('code', 'web', 'sub'), env: {} }), { root: repo, project: repo }, 'inside a repo');
  same(startupProjects({ cwd: plain, env: {} }), { root: plain, project: '' }, 'elsewhere');
  assert(gitTop(plain) === null, 'plain folder reported as a repo');
});
await check('projects: subfolders as before, hidden and files left out', () => {
  const root = dir('many');
  for (const d of ['web', 'api', '.git', 'node_modules', 'Docs']) dir('many', d);
  fs.writeFileSync(path.join(root, 'notes.txt'), 'x');
  same([...projectMap({ root }).keys()], ['api', 'Docs', 'web']);
});
await check('projects: a repo is the single project, and added folders join it', () => {
  const repo = gitRepo('solo');
  const extra = dir('elsewhere', 'storefront');
  const map = projectMap({ root: repo, project: repo, added: [extra, path.join(tmp, 'unplugged')] });
  same([...map], [['solo', repo], ['storefront', extra]]);
});
await check('projects: two folders with one name stay apart', () => {
  const a = dir('one', 'api'); const b = dir('two', 'api'); const c = dir('three', 'api');
  const root = dir('base');
  const names = [...projectMap({ root, added: [a, b, c] }).keys()];
  same(names, ['api', 'two-api', 'three-api']);
  const dup = [...projectMap({ root: dir('base2'), added: [dir('base2', 'api')] }).keys()];
  same(dup, ['api'], 'a folder already listed is not added twice');
});
await check('projects: only a real, specific folder can be added', () => {
  const home = dir('home');
  const real = dir('code', 'shop');
  fs.writeFileSync(path.join(tmp, 'afile'), 'x');
  const bad = (input, re) => { try { acceptFolder(input, { home }); } catch (e) { assert(e.code === 400 && re.test(e.message), `${input}: ${e.message}`); return; } throw new Error(`${input} was accepted`); };
  bad('', /path/); bad('shop', /full path/); bad(path.join(tmp, 'nope'), /no folder/);
  bad(path.join(tmp, 'afile'), /file/); bad('/', /too broad/); bad(home, /too broad/); bad('~', /too broad/);
  bad(dir('code', '.hidden'), /dot/);
  assert(acceptFolder(real, { home }) === real, 'real folder');
  fs.mkdirSync(path.join(home, 'code'), { recursive: true });
  assert(acceptFolder('~/code', { home }) === fs.realpathSync(path.join(home, 'code')), '~ not expanded');
});

// ---------- the command ----------

const bin = (args, { cwd = tmp, env = {} } = {}) => spawnSync(process.execPath, [path.join(APP, 'bin', 'agentoffice.js'), ...args], { cwd, env: { ...baseEnv, ...env }, encoding: 'utf8', timeout: 30000 });

await check('doctor: exit 0 and a line per check on a ready machine', () => {
  const r = bin(['doctor']);
  assert(r.status === 0, `status ${r.status}\n${r.stdout}${r.stderr}`);
  assert(/Node\.js/.test(r.stdout) && /Claude sign-in/.test(r.stdout) && /All good/.test(r.stdout), r.stdout);
});
await check('doctor: exit 1, one line per problem, each with its fix', () => {
  const r = bin(['doctor'], { env: { CLAUDE_BIN: nothing } });
  assert(r.status === 1, `status ${r.status}`);
  assert(r.stdout.split('\n').filter((l) => l.includes('FAIL')).length === 1 && /Fix: Install it/.test(r.stdout), r.stdout);
  const out = bin(['doctor'], { env: { STUB_AUTH: 'out' } });
  assert(out.status === 1 && /not signed in/.test(out.stdout) && /ANTHROPIC_API_KEY/.test(out.stdout), out.stdout);
});
await check('doctor: a taken --port fails, a free one passes, nonsense is refused', async () => {
  const busy = net.createServer();
  await new Promise((r) => busy.listen(0, '127.0.0.1', r));
  try {
    const taken = bin(['doctor', '--port', String(busy.address().port)]);
    assert(taken.status === 1 && /already in use/.test(taken.stdout), taken.stdout);
  } finally { busy.close(); }
  assert(bin(['doctor', '--port', String(await tryPort(0))]).status === 0, 'free port failed');
  assert(bin(['doctor', '--port', 'abc']).status === 2, 'bad port accepted');
});

// The office itself, started the way a user starts it, from a copy of the app.
const hasBuild = fs.existsSync(path.join(APP, 'dist', 'index.html'));
if (!hasBuild) {
  console.log('skip  office start-up checks: no build (run `npm run build`)');
} else {
  const app = path.join(tmp, 'app');
  const SKIP = new Set(['node_modules', 'data', '.git', 'launch']);
  fs.cpSync(APP, app, { recursive: true, filter: (src) => !SKIP.has(path.relative(APP, src).split(path.sep)[0]) });
  fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'), 'dir');

  // Starts `agentoffice` in `cwd`; resolves { get, post, del, repos, stop, log }.
  async function office({ cwd, data, env = {} }) {
    const port = await tryPort(0);
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [path.join(app, 'bin', 'agentoffice.js'), '--port', String(port)], {
      cwd, env: { ...baseEnv, OFFICE_DATA: data, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const o = { log: '', port };
    child.stdout.on('data', (d) => (o.log += d));
    child.stderr.on('data', (d) => (o.log += d));
    const key = () => { try { return fs.readFileSync(path.join(data, 'office-key'), 'utf8').trim(); } catch { return ''; } };
    const call = (method, p, body) => fetch(base + p, {
      method, headers: { 'content-type': 'application/json', cookie: `office_key_${port}=${key()}` }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    o.get = (p) => call('GET', p);
    o.post = (p, body) => call('POST', p, body);
    o.del = (p) => call('DELETE', p);
    o.repos = async () => (await o.get('/api/repos')).json();
    o.stop = async () => {
      if (child.exitCode !== null) return;
      const gone = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      await gone;
    };
    for (const end = Date.now() + 20000; ; await sleep(150)) {
      try { if ((await o.get('/api/repos')).ok) break; } catch {}
      if (Date.now() > end) { await o.stop(); throw new Error(`the office never came up:\n${o.log}`); }
    }
    return o;
  }

  const repo = gitRepo('mine', 'storefront');
  fs.mkdirSync(path.join(repo, 'packages', 'ui'), { recursive: true });
  const data = dir('data1');
  let o = await office({ cwd: path.join(repo, 'packages', 'ui'), data });
  try {
    await check('start in a git repo: the repo is the project, whichever folder you are in', async () => {
      const r = await o.repos();
      same(r.repos, ['storefront']);
      assert(r.single === true, 'single not set');
    });
    await check('start: the banner says which project', () => assert(o.log.includes(`project: ${repo}`), o.log));

    await check('a folder added from the UI is listed, and refusals say why', async () => {
      const lib = dir('elsewhere', 'billing');
      const added = await o.post('/api/projects', { path: lib });
      assert(added.status === 201, `status ${added.status}`);
      same((await added.json()).repos, ['storefront', 'billing']);
      const bad = await o.post('/api/projects', { path: 'billing' });
      assert(bad.status === 400 && /full path/.test((await bad.json()).error), `status ${bad.status}`);
      assert((await o.post('/api/projects', { path: lib })).status === 201, 'adding it twice failed');
      same((await o.repos()).repos, ['storefront', 'billing'], 'after adding twice');
    });
    await check('the first job runs with Plan only clearance, in the project', async () => {
      const res = await o.post('/api/jobs', { repo: 'billing', mode: 'plan', prompt: '#billing Summarise this project for me, read only.' });
      assert(res.status === 201, `status ${res.status}`);
      const job = await res.json();
      assert(job.mode === 'plan', `mode ${job.mode}`);
      let call;
      for (const end = Date.now() + 15000; !call && Date.now() < end; await sleep(150)) {
        call = fs.existsSync(record) && fs.readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((c) => c.args.includes('--permission-mode'));
      }
      assert(call, 'claude was never started');
      assert(call.args[call.args.indexOf('--permission-mode') + 1] === 'plan', call.args.join(' '));
      assert(fs.realpathSync(call.cwd) === fs.realpathSync(path.join(tmp, 'elsewhere', 'billing')), `ran in ${call.cwd}`);
    });
  } finally { await o.stop(); }

  await check('the added folder is remembered across a restart, and can be forgotten', async () => {
    o = await office({ cwd: repo, data });
    try {
      same((await o.repos()).repos, ['storefront', 'billing']);
      const gone = await o.del(`/api/projects?path=${encodeURIComponent(path.join(tmp, 'elsewhere', 'billing'))}`);
      assert(gone.status === 200, `status ${gone.status}`);
      same((await o.repos()).repos, ['storefront']);
      assert((await o.del('/api/projects?path=/nope')).status === 404, 'forgetting a stranger');
    } finally { await o.stop(); }
  });

  await check('start in an ordinary folder: its subfolders are the projects, as before', async () => {
    const root = dir('workspace');
    for (const d of ['blog', 'shop']) dir('workspace', d);
    o = await office({ cwd: root, data: dir('data2') });
    try {
      const r = await o.repos();
      same(r.repos, ['blog', 'shop']);
      assert(!r.single, 'single set');
    } finally { await o.stop(); }
  });
  await check('OFFICE_ROOT still means subfolders, even inside a git repo', async () => {
    for (const d of ['alpha', 'beta']) dir('mine', 'storefront', d);
    o = await office({ cwd: repo, data: dir('data3'), env: { OFFICE_ROOT: repo } });
    try {
      const r = await o.repos();
      assert(!r.single && r.repos.includes('alpha') && r.repos.includes('beta') && !r.repos.includes('storefront'), JSON.stringify(r));
    } finally { await o.stop(); }
  });
  await check('start-up warns when signed out, and starts anyway', async () => {
    o = await office({ cwd: dir('workspace2'), data: dir('data4'), env: { STUB_AUTH: 'out' } });
    try {
      for (const end = Date.now() + 10000; !o.log.includes('Warning:') && Date.now() < end; await sleep(100));
      assert(/Warning: Claude Code is not signed in/.test(o.log) && /ANTHROPIC_API_KEY/.test(o.log), o.log);
      assert((await o.get('/api/repos')).ok, 'office is not serving');
    } finally { await o.stop(); }
  });
  await check('start-up says nothing when all is well', async () => {
    o = await office({ cwd: dir('workspace3'), data: dir('data5') });
    try {
      await sleep(1500);
      assert(!o.log.includes('Warning:'), o.log);
    } finally { await o.stop(); }
  });
}

// ---------- the web app ----------

await check('the first-job card asks for Plan only, and can be dismissed', () => {
  const hud = fs.readFileSync(path.join(APP, 'web', 'src', 'hud.js'), 'utf8');
  assert(/firstJobCard\(\)/.test(hud) && /mode: 'plan'/.test(hud) && /data-first-skip/.test(hud), 'card not wired');
  assert(/FIRST_JOB = '[^']*read only[^']*Don’t change anything/.test(hud), 'brief');
  assert(fs.readFileSync(path.join(APP, 'web', 'index.html'), 'utf8').includes('id="addFolder"'), 'no add-folder form');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
