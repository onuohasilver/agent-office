// Is this machine ready to run the office? Used by `agentoffice doctor` and,
// quietly, at every start. Each check answers on its own, so a caller can show
// them, bundle them, or look at one. Nothing here exits the process or prints:
// that is the caller's job. Every external command is bounded by a timeout, so
// a hung `claude` can slow a report but never wedge it.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const MIN_NODE = 20;
export const DEFAULT_PORT = 4317;
const RUN_MS = 8000;

// Runs a command; resolves { ok, out, missing } and never rejects.
function run(bin, args, { env, timeout = RUN_MS } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { env, timeout, encoding: 'utf8', windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        missing: err?.code === 'ENOENT',
        timedOut: !!err?.killed,
        out: `${stdout || ''}${stderr || ''}`.trim(),
      });
    });
  });
}

// Can we listen on this port? 0 asks the system for any free one. Resolves the
// port we got, or null when it is taken.
export const tryPort = (port) => new Promise((resolve) => {
  const probe = net.createServer();
  probe.once('error', () => resolve(null));
  probe.listen(port, '127.0.0.1', () => {
    const got = probe.address().port;
    probe.close(() => resolve(got));
  });
});

const ok = (id, label, detail = '') => ({ id, label, ok: true, detail });
const bad = (id, label, problem, fix) => ({ id, label, ok: false, problem, fix });

function checkNode(version) {
  const major = Number(String(version).split('.')[0]);
  return major >= MIN_NODE
    ? ok('node', 'Node.js', `v${version}`)
    : bad('node', 'Node.js', `Node ${version} is too old; the office needs ${MIN_NODE} or newer.`,
      `Install Node ${MIN_NODE}+ from https://nodejs.org, or run: nvm install ${MIN_NODE}`);
}

async function checkGit(gitBin, env) {
  const r = await run(gitBin, ['--version'], { env });
  return r.ok
    ? ok('git', 'git', r.out.replace(/^git version\s*/, ''))
    : bad('git', 'git', 'git was not found, so jobs cannot show what changed.',
      'Install git: https://git-scm.com/downloads (macOS: xcode-select --install)');
}

async function checkClaude(claudeBin, env) {
  const r = await run(claudeBin, ['--version'], { env });
  return r.ok
    ? ok('claude', 'Claude Code', r.out.split('\n')[0])
    : bad('claude', 'Claude Code', `Claude Code (\`${claudeBin}\`) was not found on your PATH.`,
      'Install it: npm install -g @anthropic-ai/claude-code   (or point CLAUDE_BIN at it)');
}

// Signed in means one of: a key in the environment, an API key saved in the
// office's own data folder, or a Claude Code login that says so.
async function checkSignedIn(claudeBin, env, dataDir, claudeFound) {
  if (String(env.ANTHROPIC_API_KEY || '').trim()) return ok('auth', 'Claude sign-in', 'ANTHROPIC_API_KEY is set');
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'auth.json'), 'utf8'));
    if (saved.mode === 'apikey' && saved.key) return ok('auth', 'Claude sign-in', 'API key saved in the office');
  } catch {}
  const fix = 'Sign in: run `claude` once and follow the prompts, or export ANTHROPIC_API_KEY=sk-ant-…';
  // Not installed is already reported; one line per problem.
  if (!claudeFound) return null;
  const r = await run(claudeBin, ['auth', 'status'], { env });
  let loggedIn = null;
  try { loggedIn = JSON.parse(r.out).loggedIn; } catch {}
  if (loggedIn === true) return ok('auth', 'Claude sign-in', 'Claude Code login');
  // An older `claude` has no `auth status`; its silence proves nothing, so say
  // so rather than send someone off to sign in again.
  if (loggedIn === null && r.ok) return ok('auth', 'Claude sign-in', 'could not be checked (older Claude Code)');
  return bad('auth', 'Claude sign-in', 'Claude Code is not signed in.', fix);
}

async function checkPort(port, probe) {
  if (port === undefined) {
    const got = await probe(DEFAULT_PORT);
    return ok('port', 'Port', got === null ? `${DEFAULT_PORT} is busy; another free port will be used` : String(got));
  }
  return (await probe(port)) === null
    ? bad('port', 'Port', `Port ${port} is already in use.`,
      `Pick another with --port <n>, or leave --port out and a free one is chosen. See what has it: lsof -i :${port}`)
    : ok('port', 'Port', String(port));
}

// options (all optional; the defaults describe the real machine):
//   port      a port the user chose. Left out, the default is tried and any
//             free port will do, so that never fails.
//   skip      check ids to leave out
//   env, claudeBin, gitBin, nodeVersion, dataDir, tryPort   for tests
// Resolves { ok, checks }: one entry per check, in a fixed order, each
// { id, label, ok, detail } or { id, label, ok: false, problem, fix }.
export async function runPreflight(options = {}) {
  const env = options.env || process.env;
  const claudeBin = options.claudeBin || env.CLAUDE_BIN || 'claude';
  const gitBin = options.gitBin || 'git';
  const dataDir = options.dataDir || env.OFFICE_DATA || path.join(os.homedir(), '.agent-office');
  const skip = new Set(options.skip || []);
  const probe = options.tryPort || tryPort;

  const claude = skip.has('claude') ? null : await checkClaude(claudeBin, env);
  const rest = await Promise.all([
    skip.has('node') ? null : checkNode(options.nodeVersion || process.versions.node),
    skip.has('git') ? null : checkGit(gitBin, env),
    claude,
    skip.has('auth') ? null : checkSignedIn(claudeBin, env, dataDir, !!claude?.ok || skip.has('claude')),
    skip.has('port') ? null : checkPort(options.port, probe),
  ]);
  const checks = rest.filter(Boolean);
  return { ok: checks.every((c) => c.ok), checks };
}

// The report `agentoffice doctor` prints: a line per check, problems with the
// exact fix underneath.
export function formatReport(report) {
  const lines = [];
  for (const c of report.checks) {
    if (c.ok) lines.push(`  ok    ${c.label}${c.detail ? `: ${c.detail}` : ''}`);
    else lines.push(`  FAIL  ${c.problem}`, `        Fix: ${c.fix}`);
  }
  const n = report.checks.filter((c) => !c.ok).length;
  lines.push('', n ? `${n} problem${n === 1 ? '' : 's'} to fix before the office will work properly.` : 'All good. Start the office with: agentoffice');
  return lines.join('\n');
}

// What startup says: problems only, as warnings, nothing when all is well.
export function formatWarnings(report) {
  return report.checks.filter((c) => !c.ok).map((c) => `Warning: ${c.problem} ${c.fix}`);
}
