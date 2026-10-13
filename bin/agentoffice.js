#!/usr/bin/env node
// `agentoffice` starts the office. Projects are the folders next to where you
// run it; the office's own state lives in ~/.agent-office, so upgrading the
// package never touches it. OFFICE_ROOT and OFFICE_DATA override both.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

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

// Can we listen on this port (0 asks the system for any free one)? Returns the
// port we got, or null when it is taken.
const tryPort = (port) => new Promise((resolve) => {
  const probe = net.createServer();
  probe.once('error', () => resolve(null));
  probe.listen(port, '127.0.0.1', () => {
    const got = probe.address().port;
    probe.close(() => resolve(got));
  });
});

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
if (arg === '--help' || arg === '-h') {
  console.log(`agentoffice ${pkg.version}

Usage: agentoffice [--port <n>] [--phone]   (or agentstudio)
       agentoffice --link         print the running office's link, with its key

Starts the office on a free port: ${DEFAULT_PORT} if it is open, otherwise any
free one. Choose your own with --port or PORT; that one is used as given.
--phone also listens on your local network and prints a QR code that opens the
office on a phone on the same Wi-Fi (plain http: trusted networks only).
Needs Claude Code (\`claude\`) installed and signed in.

  OFFICE_ROOT   folder whose subfolders are your projects (default: this folder)
  OFFICE_DATA   where the office keeps its state (default: ~/.agent-office)
  PORT          port to listen on (default: ${DEFAULT_PORT}, or any free port)
  OFFICE_LAN    1 does what --phone does

Docs: ${pkg.homepage}`);
  process.exit(0);
}

if (args.includes('--phone')) process.env.OFFICE_LAN = '1';

const chosen = portFlag() ?? process.env.PORT;
if (chosen !== undefined && chosen !== '') {
  const n = Number(chosen);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`"${chosen}" is not a valid port (1-65535).`);
    process.exit(2);
  }
  if (await tryPort(n) === null) {
    console.error(`Port ${n} is already in use. Pick another with --port, or leave it out and one is chosen for you.`);
    process.exit(1);
  }
  process.env.PORT = String(n);
} else {
  process.env.PORT = String(await tryPort(DEFAULT_PORT) ?? await tryPort(0));
}

process.env.OFFICE_ROOT ||= process.cwd();
process.env.OFFICE_DATA ||= path.join(os.homedir(), '.agent-office');

await import('../server/supervise.js');
