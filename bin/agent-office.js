#!/usr/bin/env node
// The `agent-office` command: checks the machine is ready, then starts the
// office over a folder of projects and opens it in the browser.
//
// A clone run with `npm start` keeps its data beside the code. An installed
// package can't (an upgrade replaces its folder), so this keeps it in
// ~/.agent-office unless told otherwise.

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));

const VOICES = ['en_GB-cori-high', 'en_US-amy-medium', 'en_GB-alan-medium', 'en_US-kristin-medium', 'en_US-ryan-high',
  'en_GB-alba-medium', 'en_GB-aru-medium', 'en_US-john-medium', 'en_US-hfc_female-medium'];
const WHISPER_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';

const HELP = `Agent Office ${PKG.version} — a 3D office where the staff are Claude Code agents.

Usage
  agent-office [folder]      Start the office. Its projects are the folders
                             inside [folder] (default: the current folder).
  agent-office doctor        Check this machine is ready, and change nothing.
  agent-office voice         Download the speech models for talking out loud.

Options
  -p, --port <n>     Port to serve on (default 4317, or the next free one)
  --no-open          Don't open the browser
  --terminal         Turn on the in-app terminal (gives the browser a shell)
  --data <dir>       Where the office keeps its state (default ~/.agent-office)
  -v, --version      Print the version
  -h, --help         Print this

Docs: ${PKG.homepage}`;

// ---------- arguments ----------

function parse(argv) {
  const o = { cmd: 'start', folder: null, port: null, open: true, terminal: false, data: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) fail(`${a} needs a value.`);
      return v;
    };
    if (a === '-h' || a === '--help') o.cmd = 'help';
    else if (a === '-v' || a === '--version') o.cmd = 'version';
    else if (a === '-p' || a === '--port') o.port = Number(value());
    else if (a === '--no-open') o.open = false;
    else if (a === '--terminal') o.terminal = true;
    else if (a === '--data') o.data = value();
    else if (a.startsWith('-')) fail(`Unknown option ${a}. See agent-office --help.`);
    else if (o.cmd === 'start' && !o.folder && ['doctor', 'voice'].includes(a)) o.cmd = a;
    else if (!o.folder) o.folder = a;
    else fail(`Unexpected ${a}. See agent-office --help.`);
  }
  if (o.port !== null && !(Number.isInteger(o.port) && o.port > 0 && o.port < 65536)) fail('--port must be a port number.');
  o.root = path.resolve(o.folder || process.cwd());
  o.data = path.resolve(o.data || process.env.OFFICE_DATA || path.join(os.homedir(), '.agent-office'));
  return o;
}

function fail(msg) {
  console.error(`agent-office: ${msg}`);
  process.exit(1);
}

// ---------- checks ----------

const has = (bin, args = ['--version']) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 15000 });
  return r.status === 0 ? (r.stdout || r.stderr || '').trim().split('\n')[0] || 'found' : null;
};

// Present at all, whatever it exits with: some tools exit non-zero on --help.
const exists = (bin) => !spawnSync(bin, ['--help'], { stdio: 'ignore', timeout: 15000 }).error;
const WHISPER = process.env.WHISPER_BIN || 'whisper-cli';

function checks(o) {
  const claude = process.env.CLAUDE_BIN || 'claude';
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const list = [
    { name: 'Node.js 20 or newer', ok: nodeMajor >= 20, detail: `v${process.versions.node}`, fix: 'Install Node.js 20 or newer: https://nodejs.org', required: true },
  ];
  const cv = has(claude);
  list.push({ name: 'Claude Code', ok: !!cv, detail: cv || `\`${claude}\` not found`, required: true,
    fix: 'Install it (https://docs.anthropic.com/en/docs/claude-code), then run `claude` once to sign in — or set CLAUDE_BIN to where it is.' });
  const gv = has('git');
  list.push({ name: 'git', ok: !!gv, detail: gv || 'not found', fix: 'Install git to get the "what changed" card on each job.' });
  let folders = [];
  try { folders = fs.readdirSync(o.root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')); } catch {}
  list.push({ name: 'Projects folder', ok: folders.length > 0, detail: `${o.root} (${folders.length} folder${folders.length === 1 ? '' : 's'})`, required: false,
    fix: 'Run agent-office from the folder that holds your projects, or pass it: agent-office ~/code' });
  // Importing node-pty succeeds even when its native half was never built,
  // so only starting a shell proves the terminal will work.
  const probe = "const p = await import('node-pty'); const t = p.spawn('/bin/sh', ['-c', 'exit 0'], {}); t.onExit(() => process.exit(0)); setTimeout(() => process.exit(1), 5000);";
  const pty = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: APP, stdio: 'ignore', timeout: 10000 }).status === 0;
  list.push({ name: 'Terminal support (optional)', ok: pty, detail: pty ? 'node-pty can start a shell' : 'node-pty missing or not built', optional: true,
    fix: 'Only needed for --terminal. Reinstall with build tools present (macOS: xcode-select --install) and, on npm 11+, with --allow-scripts=node-pty.' });
  const whisper = exists(WHISPER);
  const model = fs.existsSync(path.join(o.data, 'whisper')) && fs.readdirSync(path.join(o.data, 'whisper')).some((f) => f.endsWith('.bin'));
  list.push({ name: 'Voice (optional)', ok: whisper && model, detail: !whisper ? 'whisper-cli not found' : model ? 'ready' : 'no speech model yet', optional: true,
    fix: 'brew install ffmpeg whisper-cpp, then: agent-office voice' });
  return list;
}

function report(list) {
  for (const c of list) {
    const mark = c.ok ? 'ok  ' : c.optional ? 'skip' : c.required ? 'FAIL' : 'warn';
    console.log(`  ${mark}  ${c.name} — ${c.detail}`);
    if (!c.ok) console.log(`        ${c.fix}`);
  }
}

// ---------- ports ----------

const free = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

async function pickPort(wanted) {
  if (wanted) {
    if (await free(wanted)) return wanted;
    fail(`Port ${wanted} is in use. Pick another with --port.`);
  }
  for (let p = 4317; p < 4327; p++) if (await free(p)) return p;
  fail('Ports 4317–4326 are all in use. Pick one with --port.');
}

// ---------- browser ----------

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}

async function whenUp(port, ms = 30000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/repos`)).ok) return true; } catch {}
  }
  return false;
}

// ---------- commands ----------

async function start(o) {
  console.log(`Agent Office ${PKG.version}`);
  const list = checks(o);
  const blocking = list.filter((c) => c.required && !c.ok);
  if (blocking.length) {
    report(list);
    fail('Fix the above, then start again. `agent-office doctor` re-checks without starting.');
  }
  for (const c of list) if (!c.ok && !c.optional) console.log(`  warn  ${c.name} — ${c.detail}\n        ${c.fix}`);
  if (!fs.existsSync(path.join(APP, 'dist', 'index.html'))) fail('This install has no web build. Reinstall the package, or run `npm run build` in a clone.');

  fs.mkdirSync(o.data, { recursive: true });
  const port = await pickPort(o.port);
  if (!o.port && port !== 4317) console.log(`  Port 4317 is busy; using ${port}.`);

  // The supervisor, where there is one, lets the office restart itself.
  const supervisor = path.join(APP, 'server', 'supervise.js');
  const entry = fs.existsSync(supervisor) ? supervisor : path.join(APP, 'server', 'index.js');
  const env = { ...process.env, PORT: String(port), OFFICE_ROOT: o.root, OFFICE_DATA: o.data };
  if (o.terminal) env.OFFICE_TERMINAL = '1';
  const child = spawn(process.execPath, [entry], { cwd: APP, env, stdio: 'inherit' });

  // Ctrl-C reaches the server through the terminal; this just waits for it.
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {});
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

  if (o.open && (await whenUp(port))) openBrowser(`http://localhost:${port}`);
}

function voice(o) {
  const dir = o.data;
  console.log(`Installing the speech models into ${dir}`);
  const run = (cmd, args) => {
    console.log(`  $ ${cmd} ${args.join(' ')}`);
    const r = spawnSync(cmd, args, { stdio: 'inherit' });
    if (r.error) fail(`${cmd} is not available: ${r.error.message}`);
    if (r.status !== 0) fail(`${cmd} failed (exit ${r.status}).`);
  };

  // Ears: whisper.cpp's model.
  const model = path.join(dir, 'whisper', 'ggml-base.en.bin');
  if (fs.existsSync(model)) console.log('  The listening model is already here.');
  else {
    fs.mkdirSync(path.dirname(model), { recursive: true });
    run('curl', ['-fL', '--progress-bar', '-o', model, WHISPER_URL]);
  }

  // Voices: Piper, in its own Python environment.
  const venv = path.join(dir, 'piper', 'venv');
  const py = path.join(venv, 'bin', 'python');
  if (!fs.existsSync(py)) run('python3', ['-m', 'venv', venv]);
  run(path.join(venv, 'bin', 'pip'), ['install', '-q', 'piper-tts']);
  run(py, ['-m', 'piper.download_voices', '--data-dir', path.join(dir, 'piper', 'voices'), ...VOICES]);

  if (!exists(WHISPER) || !exists(process.env.FFMPEG_BIN || 'ffmpeg')) {
    console.log('\nOne more thing: the office needs whisper-cli and ffmpeg to hear you.\n  macOS: brew install ffmpeg whisper-cpp');
  }
  console.log('\nDone. Restart the office to use them.');
}

const o = parse(process.argv.slice(2));
if (o.cmd === 'help') console.log(HELP);
else if (o.cmd === 'version') console.log(PKG.version);
else if (o.cmd === 'doctor') {
  const list = checks(o);
  console.log(`Agent Office ${PKG.version}\n`);
  report(list);
  process.exit(list.some((c) => c.required && !c.ok) ? 1 : 0);
} else if (o.cmd === 'voice') voice(o);
else await start(o);
