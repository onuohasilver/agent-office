// A real terminal inside the office: a pty on this machine, driven from the
// browser over a socket of its own.
//
// Shell access is the sharpest thing in the building — the one door that
// doesn't care what clearance a job was given — so it is fenced four ways:
//
//   * It is shut until you open it. `OFFICE_TERMINAL=1` on the server, or
//     there is no terminal at all.
//   * Only a browser on this machine can start a session. A socket carries no
//     proof of its own; it has to present a ticket, and tickets are only
//     minted on a POST that passed the host and origin checks in index.js.
//     One use, ten seconds.
//   * No agent can reach it. There is no office tool and no /api/agent route
//     that opens a session, and nothing here spawns one on an agent's behalf.
//     If you are adding agent-facing routes later: not this one.
//   * Nothing typed or printed here is kept. It never reaches state.json, the
//     chat, or the main socket. Scrollback lives in the tab and dies with it.
//
// What this is not is a sandbox. The shell runs as you, and `cd ..` leaves
// whichever folder it started in. Choosing the folder is a convenience, not a
// boundary — the boundary is the four points above.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TICKET_MS = 10_000;
const COLS = [20, 500];
const ROWS = [5, 200];
// How far the socket may fall behind the pty before we stop reading it. A
// `yes` or a cat of something huge outruns any browser; pausing the pty is
// what a real terminal's flow control does, and it keeps the server's memory
// flat instead of queueing megabytes per session.
const BACKPRESSURE = 1 << 20;
const DRAIN_MS = 50;
const KILL_GRACE_MS = 2000;

const SHELL = process.env.OFFICE_TERMINAL_SHELL || process.env.SHELL || '/bin/zsh';

const clamp = (n, [lo, hi], fallback) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

// node-pty is a native module, so it is an optional dependency: a machine
// without build tools still gets the whole office, just no terminal, and says
// so instead of failing to boot.
let pty = null;
let ptyError = '';
async function loadPty() {
  if (pty || ptyError) return pty;
  try {
    const mod = await import('node-pty');
    pty = typeof mod.spawn === 'function' ? mod : mod.default;
    if (typeof pty?.spawn !== 'function') throw new Error('no spawn export');
  } catch (err) {
    ptyError = /Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(err?.message))
      ? 'node-pty is not installed. Run `npm install` with the Xcode command line tools present (`xcode-select --install`).'
      : `node-pty would not load: ${err.message}`;
    pty = null;
  }
  return pty;
}

export class Terminals {
  constructor({ root, dataDir, folders }) {
    this.root = path.resolve(root);
    this.folders = folders;
    this.logFile = path.join(dataDir, 'terminal.log');
    this.on = process.env.OFFICE_TERMINAL === '1';
    this.max = clamp(process.env.OFFICE_TERMINAL_MAX, [1, 16], 4);
    // A shell you forgot about is a shell someone else could walk up to, so
    // one that has neither taken input nor printed anything closes itself.
    this.idleMs = clamp(process.env.OFFICE_TERMINAL_IDLE_MIN, [0, 1440], 30) * 60_000;
    this.tickets = new Map();
    this.sessions = new Set();
  }

  async status() {
    if (!this.on) {
      return { enabled: false, reason: 'The terminal is off. Start the office with --terminal (or OFFICE_TERMINAL=1) to open it.' };
    }
    if (!(await loadPty())) return { enabled: false, reason: ptyError };
    let folders = [];
    try { folders = this.folders(); } catch {}
    return {
      enabled: true,
      shell: SHELL,
      root: path.basename(this.root),
      folders,
      open: this.sessions.size,
      max: this.max,
      idleMinutes: this.idleMs / 60_000,
    };
  }

  // Where a session may start. One of the project folders, or the folder they
  // all sit in — never a path handed to us from the socket.
  resolve(folder) {
    if (!folder) return this.root;
    if (typeof folder !== 'string' || /[\/\\]/.test(folder) || folder.startsWith('.')) return null;
    const p = path.join(this.root, folder);
    if (p !== this.root && !p.startsWith(this.root + path.sep)) return null;
    try { return fs.statSync(p).isDirectory() ? p : null; } catch { return null; }
  }

  async ticket({ folder = '' } = {}) {
    const status = await this.status();
    if (!status.enabled) throw Object.assign(new Error(status.reason), { code: 403 });
    if (this.sessions.size >= this.max) {
      throw Object.assign(new Error(`${this.max} terminals are already open.`), { code: 429 });
    }
    const cwd = this.resolve(folder);
    if (!cwd) throw Object.assign(new Error('Not a project folder.'), { code: 400 });

    const id = crypto.randomBytes(24).toString('hex');
    const timer = setTimeout(() => this.tickets.delete(id), TICKET_MS);
    timer.unref?.();
    this.tickets.set(id, { cwd, timer });
    return { ticket: id, folder, cwd: folder || status.root, expiresIn: TICKET_MS };
  }

  // Single use. The socket has nothing else to show, so a replayed or expired
  // ticket has to get nothing.
  claim(id) {
    const t = typeof id === 'string' && id ? this.tickets.get(id) : null;
    if (!t) return null;
    clearTimeout(t.timer);
    this.tickets.delete(id);
    return t;
  }

  async open(ws, ticketId) {
    const claim = this.claim(ticketId);
    if (!claim) return ws.close(4003, 'No ticket.');
    if (this.sessions.size >= this.max) return ws.close(4029, 'Too many terminals.');
    const lib = await loadPty();
    if (!lib) return ws.close(4003, 'No terminal.');
    // Ten seconds is long enough for a socket to follow its ticket, but the
    // tab can still be gone by now.
    if (ws.readyState !== ws.OPEN) return;

    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', OFFICE_TERMINAL: '1' };
    // This shell is yours, not an agent's: never let it inherit credentials
    // that would let it call the office's own agent API.
    delete env.OFFICE_JOB;
    delete env.OFFICE_TOKEN;
    delete env.OFFICE_URL;

    let child;
    try {
      child = lib.spawn(SHELL, ['-l'], { name: 'xterm-256color', cwd: claim.cwd, cols: 80, rows: 24, env });
    } catch (err) {
      this.log(`fail  cwd=${claim.cwd} ${err.message}`);
      return ws.close(4000, 'The shell would not start.');
    }

    const session = { child, ws };
    this.sessions.add(session);
    this.log(`open  pid=${child.pid} shell=${SHELL} cwd=${claim.cwd}`);

    const send = (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };

    let done = false;
    let idle = null;
    let paused = false;
    const subs = [];

    const touch = () => {
      clearTimeout(idle);
      if (!this.idleMs || done) return;
      idle = setTimeout(() => {
        const mins = Math.round(this.idleMs / 60_000);
        send({ t: 'exit', why: `closed after ${mins} ${mins === 1 ? 'minute' : 'minutes'} with nothing happening` });
        end('idle');
      }, this.idleMs);
      idle.unref?.();
    };

    const drain = () => {
      if (done || paused === false) return;
      if (ws.readyState !== ws.OPEN) return end('gone');
      if (ws.bufferedAmount > BACKPRESSURE) return setTimeout(drain, DRAIN_MS).unref?.();
      paused = false;
      try { child.resume(); } catch {}
    };

    const end = (why) => {
      if (done) return;
      done = true;
      clearTimeout(idle);
      this.sessions.delete(session);
      for (const s of subs) { try { s.dispose(); } catch {} }
      if (why !== 'exit') {
        // SIGHUP is what closing a terminal window sends, so shells and the
        // jobs under them get their usual chance to tidy up first.
        try { child.kill('SIGHUP'); } catch {}
        const hard = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, KILL_GRACE_MS);
        hard.unref?.();
        this.log(`close pid=${child.pid} why=${why}`);
      }
      try { ws.close(1000, 'Terminal closed.'); } catch {}
    };

    subs.push(child.onData((d) => {
      touch();
      send({ t: 'out', d });
      if (!paused && ws.bufferedAmount > BACKPRESSURE) {
        paused = true;
        try { child.pause(); } catch { paused = false; }
        if (paused) setTimeout(drain, DRAIN_MS).unref?.();
      }
    }));

    subs.push(child.onExit(({ exitCode, signal }) => {
      this.log(`exit  pid=${child.pid} code=${exitCode}${signal ? ` signal=${signal}` : ''}`);
      send({ t: 'exit', code: exitCode });
      end('exit');
    }));

    ws.on('message', (raw) => {
      if (done) return;
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (m?.t === 'in' && typeof m.d === 'string') {
        touch();
        try { child.write(m.d); } catch {}
      } else if (m?.t === 'size') {
        try { child.resize(clamp(m.cols, COLS, 80), clamp(m.rows, ROWS, 24)); } catch {}
      }
    });
    ws.on('close', () => end('closed'));
    ws.on('error', () => end('error'));

    touch();
    send({ t: 'ready', pid: child.pid, shell: SHELL, cwd: claim.cwd });
  }

  // When a session opened and closed, and where — never what was typed. A
  // keystroke log of a terminal is a file full of passwords, which would make
  // the audit trail more dangerous than the thing it audits.
  log(line) {
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      fs.appendFileSync(this.logFile, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
    } catch {}
  }

  killAll() {
    for (const { child } of this.sessions) { try { child.kill('SIGHUP'); } catch {} }
    this.sessions.clear();
  }
}
