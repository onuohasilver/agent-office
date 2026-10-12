// Visits: a guest office's own agents working in one of our projects. The
// agent runs on the guest's machine and the guest's Claude account; only its
// file tools reach us, as `visit.*` requests over the guest link. We answer
// them here, against the limits on the link (Guests checks the policy first).
//
// An agent never sees the project folder itself. Each visit gets a scratch
// copy under data/visits/<id>: the working tree as it stood (tracked and
// untracked files, not ignored ones, so .env and node_modules stay home),
// checked out from a throwaway index. Every path is held inside that copy,
// symlinks included, and .git and key files are refused. What the agent
// changes stays in the copy until the boss applies it from the job card.
//
// Each visit shows in our job list as a job of its own (`visit-<hex>`), with a
// log of every file the agent touched.
// See docs/linked-offices.md, "Their agents in your projects".

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { snapshotTree, summarize, fileDiff } from './changes.js';

export const ACCESS = ['off', 'read', 'edit'];
const MAX_OPEN = 3; // working visits per guest link
const MAX_READ = 24 * 1024; // what one answer carries, under the relay's 64 KB a frame
const MAX_WRITE = 40 * 1024; // what one write may carry, likewise
const MAX_FILE = 2 * 1024 * 1024; // the most a file may grow to
const MAX_WRITTEN = 50 * 1024 * 1024; // the most one visit may write in all
const MAX_LIST = 400;
const MAX_LOG = 300;
const SEARCH_MS = 10_000;
const IDLE_MS = 60 * 60 * 1000; // a visit nobody has used for this long is closed
const VISIT_ID = /^visit-[0-9a-f]{8}$/;
// Never read or written, wherever they sit in the copy.
const SECRET = [/^\.env(\..*)?$/i, /\.(pem|key|p12|pfx|keystore|jks)$/i, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, /^\.(npmrc|netrc|pypirc)$/i];
const fail = (code, message) => Object.assign(new Error(message), { code });

const git = (cwd, args, env = {}, input) => new Promise((resolve, reject) => {
  // As in changes.js: nothing the project's config names should run.
  const child = execFile('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }, (err, out, errOut) => {
    if (err) reject(Object.assign(err, { stderr: String(errOut || '') })); else resolve(out);
  });
  if (input !== undefined) child.stdin.end(input);
});

const tmpIndex = () => path.join(os.tmpdir(), `office-visit-${process.pid}-${crypto.randomUUID().slice(0, 8)}`);

// What the boss's page shows of a visit: job-shaped, so it sits in the job
// list. The capability (sid), the copy's path and the base stay here.
export function visitJob(v, tail = 40) {
  const { sid: _s, dir: _d, base: _b, theirJob: _t, written: _w, usedAt: _u, ...rest } = v;
  return { ...rest, log: v.log.slice(-tail) };
}

export class Visits {
  // office: { repoPath(name), send(msg), post(text, extra), feed(linkId, msg) }
  constructor(dataDir, { office }) {
    this.office = office;
    this.root = path.join(dataDir, 'visits');
    this.file = path.join(dataDir, 'visits.json');
    this.list = [];
    try { this.list = JSON.parse(fs.readFileSync(this.file, 'utf8')).visits || []; } catch {}
    this.sweeper = setInterval(() => this.sweep(), 5 * 60 * 1000);
    this.sweeper.unref?.();
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ visits: this.list }), { mode: 0o600 });
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (err) { console.error('[visits] could not save', err.message); }
  }

  push(v) {
    this.office.send({ t: 'job', job: visitJob(v, 0) });
    this.save();
  }

  log(v, summary, kind = 'tool', extra = {}) {
    const entry = { kind, summary, ts: Date.now(), ...extra };
    v.log.push(entry);
    if (v.log.length > MAX_LOG) v.log.splice(0, v.log.length - MAX_LOG);
    this.office.send({ t: 'log', jobId: v.id, entry });
  }

  jobs() { return this.list.map((v) => visitJob(v)); }
  get(id) { return VISIT_ID.test(String(id)) ? this.list.find((v) => v.id === id) || null : null; }

  // ---------- requests from the guest's office ----------

  // A guest's agent starting (or, on a follow-up, going back to) work in one
  // of our projects. The same job of theirs gets the same copy until the
  // boss applies or throws it away, so a reply carries on where it stopped.
  async open(link, policy, args) {
    const repo = String(args.repo ?? '');
    if (!policy.repos.includes(repo)) throw fail(403, 'That project isn’t shared with you.');
    if (!ACCESS.includes(policy.theirAgents) || policy.theirAgents === 'off') throw fail(403, 'This office doesn’t let your agents work in its projects.');
    const theirJob = String(args.job ?? '').slice(0, 64);
    const agent = { name: String(args.agent?.name ?? '').slice(0, 40) || 'Their agent', role: String(args.agent?.role ?? '').slice(0, 60) };
    const title = String(args.title ?? '').slice(0, 200) || 'Work in progress';
    const access = policy.theirAgents;
    let v = this.list.find((x) => x.guest.link === link.id && x.theirJob === theirJob && x.repo === repo && !x.applied && !x.discarded);
    if (v && v.status === 'working') return { sid: v.sid, access: v.access };
    if (this.list.filter((x) => x.guest.link === link.id && x.status === 'working').length >= MAX_OPEN) {
      throw fail(429, `You can have ${MAX_OPEN} agents working here at once. Wait for one to finish.`);
    }
    if (v && fs.existsSync(v.dir)) {
      Object.assign(v, { status: 'working', access, sid: crypto.randomBytes(16).toString('hex'), endedAt: null, error: null, usedAt: Date.now(), title });
      this.log(v, `${agent.name} came back to it.`, 'system');
      this.push(v);
      return { sid: v.sid, access };
    }
    const src = this.office.repoPath(repo);
    if (!src) throw fail(404, 'That project folder is gone.');
    const base = await snapshotTree(src);
    if (!base) throw fail(409, `${repo} isn’t a git repository, so it can’t be shared with visiting agents.`);
    const id = `visit-${crypto.randomBytes(4).toString('hex')}`;
    const dir = path.join(this.root, id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const idx = tmpIndex();
    try {
      await git(src, ['read-tree', base], { GIT_INDEX_FILE: idx });
      await git(src, [`--work-tree=${dir}`, 'checkout-index', '-a', '-f'], { GIT_INDEX_FILE: idx });
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw fail(500, `Could not copy ${repo}: ${String(err.stderr || err.message).slice(0, 200)}`);
    } finally {
      fs.rmSync(idx, { force: true });
    }
    const now = Date.now();
    v = {
      id, repo, title, mode: access === 'edit' ? 'edit' : 'plan', access, status: 'working',
      createdAt: now, queuedAt: now, startedAt: now, endedAt: null, agentId: null,
      visitor: { ...agent, handle: link.peer }, from: `@${link.peer}`, guest: { link: link.id },
      turns: 0, tools: 0, error: null, changes: null, applied: null, discarded: null, log: [],
      sid: crypto.randomBytes(16).toString('hex'), dir, base, theirJob, written: 0, usedAt: now,
    };
    this.list.push(v);
    this.log(v, `${agent.name} from @${link.peer} started on a copy of ${repo} (${access === 'edit' ? 'can edit the copy' : 'read only'}): ${title}`, 'system');
    this.push(v);
    this.office.post(`**Visitor** · ${agent.name} from @${link.peer} is working in a copy of ${repo}, ${access === 'edit' ? 'and can edit it. Nothing reaches the real folder until you apply it.' : 'read only.'} “${title}”`, { jobId: id });
    return { sid: v.sid, access };
  }

  // The visit a request names, if it's this guest's and still open.
  session(link, sid) {
    const v = this.list.find((x) => x.guest.link === link.id && x.sid && x.sid === String(sid ?? ''));
    if (!v) throw fail(404, 'That work session has ended. Start the job again.');
    if (v.status !== 'working') throw fail(410, v.status === 'stopped' ? 'The project’s owner stopped this. Stop work and say so.' : 'That work session has ended.');
    v.usedAt = Date.now();
    return v;
  }

  async fs(link, args, policy) {
    const v = this.session(link, args.sid);
    if (policy && !policy.repos.includes(v.repo)) {
      await this.end(v, 'stopped', '', 'Stopped: that project isn’t shared with them any more.');
      throw fail(403, 'That project isn’t shared with you any more.');
    }
    if (policy?.theirAgents === 'read' && v.access === 'edit') {
      v.access = 'read';
      this.log(v, 'The owner made this read only.', 'system');
    }
    const op = String(args.op ?? '');
    v.tools += 1;
    try {
      const text = await this.run(v, op, args);
      return { text };
    } catch (err) {
      this.log(v, `${op} refused: ${err.message}`, 'error');
      throw err.code ? err : fail(400, err.message);
    } finally {
      this.save();
    }
  }

  async run(v, op, args) {
    const rel = typeof args.path === 'string' ? args.path : '';
    switch (op) {
      case 'list': {
        const { abs, shown } = this.resolve(v, rel || '.');
        const depth = Math.min(Math.max(Number.isInteger(args.depth) ? args.depth : 1, 1), 4);
        const out = [];
        this.walk(v, abs, depth, out);
        this.log(v, `Listed ${shown}`);
        if (!out.length) return '(empty)';
        return out.slice(0, MAX_LIST).join('\n') + (out.length > MAX_LIST ? `\n… ${out.length - MAX_LIST} more. List a subfolder.` : '');
      }
      case 'read': {
        const { abs, shown } = this.resolve(v, rel);
        const st = this.stat(abs, shown);
        if (!st.isFile()) throw fail(400, `${shown} is not a file.`);
        if (st.size > MAX_FILE) throw fail(413, `${shown} is ${Math.round(st.size / 1024)} KB, too big to read here.`);
        const buf = fs.readFileSync(abs);
        if (buf.subarray(0, 8000).includes(0)) return `${shown} is a binary file (${st.size} bytes).`;
        const lines = buf.toString('utf8').split('\n');
        const from = Math.max(Number.isInteger(args.offset) ? args.offset : 1, 1);
        const want = Math.min(Math.max(Number.isInteger(args.limit) ? args.limit : 2000, 1), 2000);
        let out = '', i = from - 1;
        for (; i < lines.length && i < from - 1 + want; i++) {
          const row = `${String(i + 1).padStart(6)}\t${lines[i].length > 2000 ? `${lines[i].slice(0, 2000)}…` : lines[i]}\n`;
          if (out.length + row.length > MAX_READ) break;
          out += row;
        }
        this.log(v, `Read ${shown}`);
        if (i < lines.length) out += `… ${lines.length - i} more lines. Read on with offset ${i + 1}.`;
        return out || `(${shown} is empty${from > 1 ? ' past that line' : ''})`;
      }
      case 'search': {
        const pattern = String(args.pattern ?? '');
        if (!pattern || pattern.length > 500) throw fail(400, 'Give a pattern to search for.');
        const { abs, shown } = this.resolve(v, rel || '.');
        const glob = typeof args.glob === 'string' && args.glob && !args.glob.includes('\0') ? ['--include', args.glob.slice(0, 200)] : [];
        const out = await this.grep(v, ['-rnIE', '--exclude-dir=.git', ...glob, '-e', pattern, '--', path.relative(v.dir, abs) || '.']);
        this.log(v, `Searched ${shown} for “${pattern.slice(0, 80)}”`);
        return out || 'No matches.';
      }
      case 'find': {
        const pattern = String(args.pattern ?? '');
        if (!pattern || pattern.length > 200) throw fail(400, 'Give a file name pattern, like **/*.test.js.');
        const re = globRe(pattern);
        const out = [];
        this.walk(v, v.dir, 12, out, true);
        const hits = out.filter((p) => re.test(p));
        this.log(v, `Looked for ${pattern}`);
        if (!hits.length) return 'No files match.';
        return hits.slice(0, MAX_LIST).join('\n') + (hits.length > MAX_LIST ? `\n… ${hits.length - MAX_LIST} more.` : '');
      }
      case 'write': case 'edit': {
        if (v.access !== 'edit') throw fail(403, 'This project is shared read only. You can’t change files in it.');
        const { abs, shown } = this.resolve(v, rel, true);
        let before = null;
        try { const st = fs.lstatSync(abs); if (!st.isFile()) throw fail(400, `${shown} is not a file.`); before = fs.readFileSync(abs, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
        let after;
        if (op === 'write') {
          const content = String(args.content ?? '');
          if (Buffer.byteLength(content) > MAX_WRITE) throw fail(413, `Write at most ${MAX_WRITE / 1024} KB at a time. Write the first part, then add the rest with append.`);
          after = args.append === true ? (before ?? '') + content : content;
        } else {
          if (before === null) throw fail(404, `${shown} doesn’t exist. Create it with files_write.`);
          const old = String(args.old ?? ''), now = String(args.new ?? '');
          if (!old) throw fail(400, 'Say which text to replace.');
          if (Buffer.byteLength(now) > MAX_WRITE) throw fail(413, `Replace at most ${MAX_WRITE / 1024} KB at a time.`);
          const n = before.split(old).length - 1;
          if (!n) throw fail(400, `That text isn’t in ${shown}. Read the file again and copy it exactly.`);
          if (n > 1 && args.all !== true) throw fail(400, `That text is in ${shown} ${n} times. Add more around it so it’s unique, or set all.`);
          after = args.all === true ? before.split(old).join(now) : before.replace(old, () => now);
        }
        const size = Buffer.byteLength(after);
        if (size > MAX_FILE) throw fail(413, `${shown} would be over ${MAX_FILE / 1024 / 1024} MB.`);
        if (v.written + size > MAX_WRITTEN) throw fail(413, 'This visit has written as much as it may.');
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, after);
        v.written += size;
        this.log(v, `${before === null ? 'Created' : 'Changed'} ${shown}`);
        return `${before === null ? 'Created' : 'Updated'} ${shown}.`;
      }
      default:
        throw fail(400, 'Unknown file operation.');
    }
  }

  // A path the agent named, as an absolute path inside the copy, or a refusal.
  // `forWrite` lets the last parts not exist yet.
  resolve(v, rel, forWrite = false) {
    if (typeof rel !== 'string' || rel.includes('\0') || rel.length > 1000) throw fail(400, 'That isn’t a path.');
    const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    const abs = path.resolve(v.dir, clean || '.');
    const inside = (p) => p === v.dir || p.startsWith(v.dir + path.sep);
    if (!inside(abs)) throw fail(403, 'Paths stay inside the project.');
    const shown = path.relative(v.dir, abs) || '.';
    for (const part of shown.split(path.sep)) {
      if (part.toLowerCase() === '.git') throw fail(403, 'The .git folder is off limits.');
      if (SECRET.some((re) => re.test(part))) throw fail(403, `${shown} looks like a secret, so it isn’t shared.`);
    }
    // Symlinks: what the path really points at must be inside the copy too.
    const realRoot = fs.realpathSync(v.dir);
    let probe = abs;
    while (!fs.existsSync(probe)) {
      if (!forWrite) throw fail(404, `${shown} doesn’t exist.`);
      probe = path.dirname(probe);
    }
    const real = fs.realpathSync(probe);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw fail(403, 'That path leads outside the project.');
    if (forWrite && probe === abs && fs.lstatSync(abs).isSymbolicLink()) throw fail(403, 'Links can’t be written through.');
    return { abs, shown };
  }

  stat(abs, shown) {
    try { return fs.statSync(abs); } catch { throw fail(404, `${shown} doesn’t exist.`); }
  }

  // Paths under `abs`, relative to the copy, folders with a trailing slash.
  // Links are listed but not followed; .git and secrets are left out.
  walk(v, abs, depth, out, filesOnly = false) {
    if (out.length > 20_000) return;
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.toLowerCase() === '.git' || SECRET.some((re) => re.test(e.name))) continue;
      const rel = path.relative(v.dir, path.join(abs, e.name)).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (!filesOnly) out.push(`${rel}/`);
        if (depth > 1) this.walk(v, path.join(abs, e.name), depth - 1, out, filesOnly);
      } else out.push(rel);
    }
  }

  // grep in the copy, with a deadline and a cap on what comes back. grep's
  // matcher doesn't backtrack, so a pattern can't hang it the way it could a
  // JavaScript RegExp.
  grep(v, args) {
    return new Promise((resolve, reject) => {
      const child = spawn('grep', args, { cwd: v.dir, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', cut = false, errOut = '';
      const timer = setTimeout(() => { cut = true; child.kill('SIGKILL'); }, SEARCH_MS);
      child.stdout.on('data', (d) => {
        if (out.length >= MAX_READ) return;
        out += d;
        if (out.length >= MAX_READ) { cut = true; child.kill('SIGKILL'); }
      });
      child.stderr.on('data', (d) => { errOut += d; });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 2 && !out && !cut) return reject(fail(400, `Search failed: ${errOut.trim().slice(0, 200) || 'bad pattern'}`));
        // Matches in secret-looking files don't go out either.
        const rows = out.slice(0, MAX_READ).split('\n').filter((r) => r && !r.split(':')[0].split('/').some((p) => SECRET.some((re) => re.test(p))));
        resolve(rows.join('\n') + (cut ? '\n… more matches cut. Narrow the search.' : ''));
      });
    });
  }

  // The guest's job ended (or the agent finished a turn and the job closed).
  async close(link, args) {
    const v = this.session(link, args.sid);
    await this.end(v, ['done', 'failed', 'stopped'].includes(args.status) ? args.status : 'done', typeof args.summary === 'string' ? args.summary.slice(0, 2000) : '');
    return { ok: true };
  }

  async end(v, status, summary = '', error = null) {
    if (v.status !== 'working') return;
    Object.assign(v, { status, endedAt: Date.now(), error });
    if (summary) this.log(v, summary, 'text');
    await this.record(v);
    const n = v.changes?.count || 0;
    const what = v.access !== 'edit' ? '' : n ? ` ${n} file${n === 1 ? '' : 's'} changed in the copy. Review them on the job and apply or discard.` : ' Nothing changed.';
    this.log(v, `${{ done: 'Finished', failed: 'Hit a wall', stopped: 'Stopped' }[status] || 'Ended'}.${what}`, 'result', { ok: status === 'done' });
    this.push(v);
    if (status !== 'stopped' || error) {
      this.office.post(`**Visitor** · ${v.visitor.name} from @${v.visitor.handle} ${status === 'done' ? 'finished' : status === 'failed' ? 'hit a wall on' : 'stopped'} “${v.title}” in ${v.repo}.${what}`, { jobId: v.id });
    }
  }

  async record(v) {
    if (!fs.existsSync(v.dir)) return;
    const src = this.office.repoPath(v.repo);
    if (!src) return;
    const end = await this.snapshot(v, src).catch(() => null);
    if (end) v.changes = await summarize(src, v.base, end);
  }

  // The copy as a tree in the project's object store, from a throwaway index
  // seeded with the base so it's quick.
  async snapshot(v, src) {
    const idx = tmpIndex();
    try {
      await git(src, ['read-tree', v.base], { GIT_INDEX_FILE: idx });
      await git(src, [`--work-tree=${v.dir}`, 'add', '-A'], { GIT_INDEX_FILE: idx });
      return (await git(src, ['write-tree'], { GIT_INDEX_FILE: idx })).trim();
    } finally {
      fs.rmSync(idx, { force: true });
    }
  }

  // ---------- the boss ----------

  stop(v, why = 'Stopped by you.') {
    if (v.status !== 'working') return;
    this.office.feed(v.guest.link, { t: 'visit', job: v.theirJob, ended: 'stopped' });
    return this.end(v, 'stopped', '', why);
  }

  async diff(v, file) {
    const src = this.office.repoPath(v.repo);
    if (!src) throw fail(404, 'That project folder is gone.');
    return fileDiff(src, v.changes, file);
  }

  // The copy's changes onto the real folder. git apply takes all of it or
  // none, so a project that has moved on underneath gets a clear refusal.
  async apply(v) {
    if (v.status === 'working') throw fail(409, 'Wait for them to finish, or stop them first.');
    if (v.applied || v.discarded) throw fail(409, 'Already dealt with.');
    if (!v.changes?.count) throw fail(400, 'Nothing changed.');
    const src = this.office.repoPath(v.repo);
    if (!src) throw fail(404, 'That project folder is gone.');
    const patch = await git(src, ['diff', '--binary', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', v.changes.base, v.changes.end]);
    try {
      await git(src, ['apply', '--binary', '--whitespace=nowarn', '-'], {}, patch);
    } catch (err) {
      throw fail(409, `Those changes don’t apply cleanly: ${String(err.stderr || err.message).split('\n')[0].slice(0, 200)}. The project has moved on since; nothing was changed.`);
    }
    v.applied = Date.now();
    this.log(v, `Applied to ${v.repo}.`, 'system');
    this.drop(v);
    this.push(v);
    return { ok: true };
  }

  discard(v) {
    if (v.status === 'working') throw fail(409, 'Stop them first.');
    if (v.applied || v.discarded) throw fail(409, 'Already dealt with.');
    v.discarded = Date.now();
    this.log(v, 'Thrown away.', 'system');
    this.drop(v);
    this.push(v);
    return { ok: true };
  }

  // Clear finished: visits that are dealt with go. One with changes still
  // waiting for review stays, so a click can't throw work away unseen.
  clear() {
    const done = (v) => v.status !== 'working' && (v.applied || v.discarded || !v.changes?.count || v.access !== 'edit');
    for (const v of this.list) if (done(v)) this.drop(v);
    this.list = this.list.filter((v) => !done(v));
    this.save();
  }

  drop(v) {
    fs.rmSync(v.dir, { recursive: true, force: true });
  }

  // ---------- housekeeping ----------

  // Links that went: their visits stop at once.
  linksChanged(live) {
    for (const v of this.list) if (v.status === 'working' && !live.has(v.guest.link)) this.end(v, 'stopped', '', 'Stopped: the guest was unlinked.').catch(() => {});
  }

  // The boss changed a guest's limits: visits they no longer allow stop now,
  // not at the guest's next call.
  policyChanged(linkId, policy) {
    for (const v of this.list) {
      if (v.status !== 'working' || v.guest.link !== linkId) continue;
      if (!['read', 'edit'].includes(policy?.theirAgents)) this.stop(v, 'Stopped: you turned their agents off.')?.catch(() => {});
      else if (!policy.repos.includes(v.repo)) this.stop(v, 'Stopped: that project isn’t shared with them any more.')?.catch(() => {});
    }
  }

  // A visit nobody has touched in a while is closed, so a guest office that
  // went away mid-job doesn't leave one open for ever.
  sweep() {
    const now = Date.now();
    for (const v of this.list) if (v.status === 'working' && now - (v.usedAt || v.startedAt) > IDLE_MS) this.end(v, 'stopped', '', 'Closed: nothing happened in it for an hour.').catch(() => {});
  }
}

// A glob (`*`, `**`, `?`) as a RegExp over slash paths. Built by hand from
// escaped literals, so it can't backtrack badly.
export function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:[^/]*/)*' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // A bare name matches at any depth, as people expect from `*.js`.
  return new RegExp(glob.includes('/') ? `^${re}$` : `(?:^|/)${re}$`);
}
