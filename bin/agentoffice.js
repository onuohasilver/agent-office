#!/usr/bin/env node
// `agentoffice` starts the office. Projects are the folders next to where you
// run it; the office's own state lives in ~/.agent-office, so upgrading the
// package never touches it. OFFICE_ROOT and OFFICE_DATA override both.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
const arg = process.argv[2];

if (arg === '--version' || arg === '-v') {
  console.log(pkg.version);
  process.exit(0);
}
if (arg === '--help' || arg === '-h') {
  console.log(`agentoffice ${pkg.version}

Usage: agentoffice   (or agentstudio)

Starts the office at http://localhost:\${PORT:-4317}. Needs Claude Code
(\`claude\`) installed and signed in.

  OFFICE_ROOT   folder whose subfolders are your projects (default: this folder)
  OFFICE_DATA   where the office keeps its state (default: ~/.agent-office)
  PORT          port to listen on (default: 4317)

Docs: ${pkg.homepage}`);
  process.exit(0);
}

process.env.OFFICE_ROOT ||= process.cwd();
process.env.OFFICE_DATA ||= path.join(os.homedir(), '.agent-office');

await import('../server/supervise.js');
