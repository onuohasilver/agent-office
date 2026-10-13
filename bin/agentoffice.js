#!/usr/bin/env node
// `agentoffice` starts the office. Run inside a git repo, that repo is the
// project; anywhere else, projects are the folders in the one you run it from.
// The office's own state lives in ~/.agent-office, so upgrading the package
// never touches it. OFFICE_ROOT and OFFICE_DATA override both.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPreflight, formatReport, formatWarnings, tryPort } from '../server/preflight.js';
import { startupProjects } from '../server/projects.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const arg = args[0];
const DEFAULT_PORT = 4317;

// --port 4400, --port=4400 or -p 4400; the PORT variable works too.
function portFlag() {
  for (let i = 0; i < args.length; i++) {
    const m = /^(?:--port|-p)(?:=(.*))?$/.exec(args[i]);
    if (m) return m[1] ?? args[i + 1] ?? '';
  }
  return undefined;
}

if (arg === '--version' || arg === '-v') {
  console.log(pkg.version);
  process.exit(0);
}
// The running office's link, key included, for a browser that lost it.
// `npm start` from a checkout keeps its state in the checkout's data folder
// instead, so look there when the usual place has no key.
if (arg === '--link') {
  const homeData = process.env.OFFICE_DATA || path.join(os.homedir(), '.agent-office');
  const repoData = path.join(HERE, '..', 'data');
  const hasKey = (dir) => fs.existsSync(path.join(dir, 'office-key'));
  const data = !process.env.OFFICE_DATA && !hasKey(homeData) && hasKey(repoData) ? repoData : homeData;
  try {
    const key = fs.readFileSync(path.join(data, 'office-key'), 'utf8').trim();
    let port = DEFAULT_PORT;
    try { port = Number(fs.readFileSync(path.join(data, 'office-port'), 'utf8')) || DEFAULT_PORT; } catch {}
    console.log(`http://localhost:${port}/?key=${key}`);
    process.exit(0);
  } catch {
    console.error(`No office key in ${data}. Start the office once, and it prints its link.`);
    process.exit(1);
  }
}
// The port the user asked for, validated; undefined when they did not.
function chosenPort() {
  const chosen = portFlag() ?? process.env.PORT;
  if (chosen === undefined || chosen === '') return undefined;
  const n = Number(chosen);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`"${chosen}" is not a valid port (1-65535).`);
    process.exit(2);
  }
  return n;
}

// Is this machine ready? One line per problem with the fix; exit 1 if any.
if (arg === 'doctor') {
  const report = await runPreflight({ port: chosenPort() });
  console.log(`agentoffice ${pkg.version} doctor\n\n${formatReport(report)}`);
  process.exit(report.ok ? 0 : 1);
}
if (arg === '--help' || arg === '-h') {
  console.log(`agentoffice ${pkg.version}

Usage: agentoffice [--port <n>]   (or agentstudio)
       agentoffice doctor [--port <n>]
                                  check this machine is ready; exits 1 if not
       agentoffice --link         print the running office's link, with its key

Starts the office on a free port: ${DEFAULT_PORT} if it is open, otherwise any
free one. Choose your own with --port or PORT; that one is used as given.
Needs Claude Code (\`claude\`) installed and signed in.

Run inside a git repo and that repo is your project. Run anywhere else and the
folders in it are your projects. Add more from the Projects tab.

  OFFICE_ROOT   folder whose subfolders are your projects (always wins over the
                git repo; default: this folder)
  OFFICE_DATA   where the office keeps its state (default: ~/.agent-office)
  PORT          port to listen on (default: ${DEFAULT_PORT}, or any free port)

Docs: ${pkg.homepage}`);
  process.exit(0);
}

const chosen = chosenPort();
if (chosen !== undefined) {
  if (await tryPort(chosen) === null) {
    console.error(`Port ${chosen} is already in use. Pick another with --port, or leave it out and one is chosen for you.`);
    process.exit(1);
  }
  process.env.PORT = String(chosen);
} else {
  process.env.PORT = String(await tryPort(DEFAULT_PORT) ?? await tryPort(0));
}

const where = startupProjects({ cwd: process.cwd() });
process.env.OFFICE_ROOT ||= where.root;
if (where.project) process.env.OFFICE_PROJECT = where.project;
process.env.OFFICE_DATA ||= path.join(os.homedir(), '.agent-office');

// The same checks as `doctor`, but only as warnings and never in the way: the
// office starts regardless, and a missing sign-in can be fixed while it runs.
// The port is settled above, so it is not checked again.
runPreflight({ skip: ['port'] })
  .then((report) => { for (const line of formatWarnings(report)) console.warn(line); })
  .catch(() => {});

await import('../server/supervise.js');
