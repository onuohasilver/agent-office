// Stages the office that the desktop bundle ships, into src-tauri/app. It
// builds from the last commit (git archive HEAD) in a scratch folder, so
// uncommitted work in the tree never reaches an installer and the repo's own
// dist/ (which a running office serves) is left alone. Ships the launcher,
// server, shared code, the built web app and production dependencies only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(REPO, 'desktop', 'src-tauri', 'app');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-stage-'));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: SCRATCH, stdio: 'inherit' });

try {
  execSync(`git -C "${REPO}" archive HEAD | tar -x -C "${SCRATCH}"`, { stdio: 'inherit' });
  run('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts']);
  run('npx', ['vite', 'build']);
  run('npm', ['prune', '--omit=dev', '--no-audit', '--no-fund']);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const item of ['bin', 'server', 'shared', 'dist', 'node_modules', 'package.json', 'LICENSE']) {
    fs.cpSync(path.join(SCRATCH, item), path.join(OUT, item), { recursive: true });
  }
  const rev = execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD']).toString().trim();
  console.log(`Staged the office at ${rev} in ${path.relative(REPO, OUT)}`);
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}
