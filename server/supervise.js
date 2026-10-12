// Keeps the office running across restarts it asks for. The server can't
// start its own successor (its shutdown ends every agent, and the shell that
// launched it is gone), so this sits above it: when the server exits with
// RESTART, start it again. A clean exit or a signal is the boss closing up,
// so go too; a crash gets another go.

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RESTART = 75;
const FATAL = 78; // a setup problem (port taken) that another go won't fix
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
// A server that falls over this soon after a restart won't fare better on
// the next go, so a few of those in a row ends it rather than spinning.
const BOOT_MS = 10 * 1000;
const MAX_QUICK_FAILS = 3;

let child = null;
let quickFails = 0;

function run() {
  const startedAt = Date.now();
  child = spawn(process.execPath, [SERVER, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, OFFICE_SUPERVISED: '1' },
  });
  child.on('exit', (code, signal) => {
    child = null;
    if (code === RESTART) {
      quickFails = 0;
      console.log('Restarting the office…');
      return run();
    }
    if (code === FATAL) return process.exit(1);
    // Ctrl-C reaches the server too, and it exits 0: that's closing time.
    if (code === 0 || signal) return process.exit(code ?? 0);
    if (Date.now() - startedAt < BOOT_MS && ++quickFails >= MAX_QUICK_FAILS) {
      console.error(`The office failed to start ${quickFails} times in a row. Giving up.`);
      return process.exit(code);
    }
    console.error(`The office stopped unexpectedly (exit ${code}). Starting it again…`);
    setTimeout(run, 1000);
  });
}

// The server handles these itself and saves on the way out; this only waits
// for it. A signal sent to this process alone is passed on.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { if (child) child.kill(sig); else process.exit(0); });
}

run();
