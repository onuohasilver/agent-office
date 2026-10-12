// Guests: another office running jobs with our agents over a guest link, and
// the other way round, us visiting an office that made us its guest.
//
// As host, everything a guest asks for comes in as a `req` frame and is
// checked here against the limits the boss set on the invite (repos,
// clearance cap, tokens per day). The guest's office is never trusted: it
// only ever sees its own jobs, and the feed it gets is cut down to them.
//
// As guest, the browser opens /ws/visit/:link. We ask the host for a hello,
// then pass on its feed; the composer's posts become `req` frames.
// See docs/proposals/linked-offices.md, "Guests".

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CLEARANCE = ['plan', 'edit', 'auto'];
const MAX_OPEN_JOBS = 3; // queued or working, per guest
const MAX_PROMPT = 20_000;
const REQ_TIMEOUT_MS = 15_000;
const CONNECT_WAIT_MS = 5_000;
const FEED_EVERY_MS = 250;
const FEED_BYTES = 48 * 1024; // under the relay's 64 KB a frame
const FEED_TYPES = new Set(['job', 'log', 'staff']);
const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const fail = (code, message) => Object.assign(new Error(message), { code });

// ---------- what a host may put on our page ----------
//
// As guest, everything from the host lands in our own localhost page, which
// can start jobs on this machine. So nothing it sends is passed on as it is:
// each message is rebuilt from known fields, text is capped, ids and colours
// must match their patterns, enums must be ours, and anything that doesn't fit
// is dropped.

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const REPO = /^[^/\\\0<>"'`]{1,100}$/;
const HANDLE = /^@?[a-z0-9][a-z0-9_-]{2,19}$/i;
const STATUSES = new Set(['queued', 'working', 'done', 'failed', 'stopped']);
const LOG_KINDS = new Set(['user', 'system', 'thinking', 'tool', 'text', 'error', 'result']);
const STATIONS = new Set(['library', 'servers', 'window', 'whiteboard', 'desk']);
const FILE_STATUSES = new Set(['added', 'modified', 'deleted']);
const ASKING = new Set(['question', 'decision', 'blocker']);

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const optStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const id = (v) => (typeof v === 'string' && ID.test(v) ? v : null);
const bool = (v) => v === true;
const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export function cleanStaff(s) {
  if (!s || typeof s !== 'object' || !id(s.id)) return null;
  const colour = (v) => (typeof v === 'string' && COLOUR.test(v) ? v : undefined);
  return drop({
    id: s.id, name: str(s.name, 40) || s.id, role: str(s.role, 60),
    shirt: colour(s.shirt), hair: colour(s.hair), skin: colour(s.skin),
    personality: str(s.personality, 300), background: str(s.background, 300),
  });
}

export function cleanEntry(e) {
  if (!e || typeof e !== 'object' || !LOG_KINDS.has(e.kind)) return null;
  return drop({
    kind: e.kind, summary: str(e.summary, 8000), ts: num(e.ts) ?? undefined,
    ok: e.kind === 'result' ? bool(e.ok) : undefined,
    ms: num(e.ms) ?? undefined, cost: num(e.cost) ?? undefined,
    station: STATIONS.has(e.station) ? e.station : undefined,
    blocked: e.blocked === true ? true : undefined, wait: e.wait === true ? true : undefined,
  });
}

function cleanChanges(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.files)) return null;
  const sha = (v) => (typeof v === 'string' && /^[0-9a-f]{4,64}$/.test(v) ? v : null);
  return {
    base: sha(c.base), end: sha(c.end), count: count(c.count), add: count(c.add), del: count(c.del),
    files: c.files.slice(0, 200).filter((f) => f && typeof f.path === 'string' && f.path && !f.path.includes('\0')).map((f) => ({
      path: f.path.slice(0, 500), status: FILE_STATUSES.has(f.status) ? f.status : 'modified', add: count(f.add), del: count(f.del), binary: bool(f.binary),
    })),
  };
}

export function cleanJob(j) {
  if (!j || typeof j !== 'object' || !id(j.id) || !STATUSES.has(j.status)) return null;
  const from = typeof j.from === 'string' && HANDLE.test(j.from) ? j.from : undefined;
  return drop({
    id: j.id, repo: typeof j.repo === 'string' && REPO.test(j.repo) ? j.repo : '', title: str(j.title, 200),
    mode: CLEARANCE.includes(j.mode) ? j.mode : 'plan', model: typeof j.model === 'string' && /^[\w.:-]{0,60}$/.test(j.model) ? j.model : '',
    status: j.status, createdAt: num(j.createdAt), queuedAt: num(j.queuedAt), startedAt: num(j.startedAt), endedAt: num(j.endedAt),
    agentId: id(j.agentId), turns: count(j.turns), tools: count(j.tools), context: count(j.context),
    error: optStr(j.error, 500), waiting: bool(j.waiting), awaitingBoss: bool(j.awaitingBoss),
    asking: j.asking && ASKING.has(j.asking.kind) ? { kind: j.asking.kind, summary: str(j.asking.summary, 500) } : null,
    changes: cleanChanges(j.changes), from, guest: j.guest && id(j.guest.link) ? { link: j.guest.link } : undefined,
    log: Array.isArray(j.log) ? j.log.slice(-500).map(cleanEntry).filter(Boolean) : [],
  });
}

// One feed message, or null.
export function cleanFeed(m) {
  if (!m || typeof m !== 'object') return null;
  if (m.t === 'job') { const job = cleanJob(m.job); return job && { t: 'job', job }; }
  if (m.t === 'log') { const entry = cleanEntry(m.entry); return entry && id(m.jobId) && { t: 'log', jobId: m.jobId, entry }; }
  if (m.t === 'staff') return Array.isArray(m.dismissed) ? { t: 'staff', dismissed: m.dismissed.filter((x) => id(x)).slice(0, 50) } : null;
  return null;
}

// The host's answer to each request, rebuilt.
const CLEAN_BODY = {
  createJob: (b) => { const job = cleanJob(b.job); if (!job) throw fail(502, 'The host sent back a job that doesn’t look right.'); return { job }; },
  job: (b) => { const job = cleanJob(b.job); if (!job) throw fail(502, 'The host sent back a job that doesn’t look right.'); return { job }; },
  diff: (b) => ({ diff: str(b.diff, 2_000_000) }),
  reply: () => ({ ok: true }),
  stop: () => ({ ok: true }),
  hello: (b) => b,
};

// What a guest may see of one of its own jobs.
export function guestJob(j, tail = 40) {
  const { id, repo, title, mode, model, status, createdAt, queuedAt, startedAt, endedAt, agentId, turns, tools, error, waiting, asking, awaitingBoss, changes, context, from, guest } = j;
  return { id, repo, title, mode, model, status, createdAt, queuedAt, startedAt, endedAt, agentId, turns, tools, error, waiting, asking, awaitingBoss, changes, context, from, guest, log: (j.log || []).slice(-tail) };
}

export class Guests {
  // office: { jobs(), createJob(body, extra), replyJob(job, body), stopJob(job), diff(job, path), staff(), modes() }
  constructor(dataDir, { links, office }) {
    this.links = links;
    this.office = office;
    this.file = path.join(dataDir, 'guests.json');
    this.used = {};
    try { this.used = JSON.parse(fs.readFileSync(this.file, 'utf8')).used || {}; } catch {}
    this.queue = new Map(); // link id -> messages waiting for the next feed frame
    this.flushTimer = null;
    this.visits = new Map(); // link id -> Set of browser sockets (as guest)
    this.pending = new Map(); // req id -> { resolve, reject, timer } (as guest)
  }

  // Every req, res and feed frame on a guest link comes through here.
  onGuest(link, msg) {
    if (link.role === 'host' && msg.t === 'req') return this.answer(link, msg);
    if (link.role === 'guest' && msg.t === 'res') return this.settle(msg);
    if (link.role === 'guest' && msg.t === 'feed') return this.fromHost(link, msg);
  }

  // ---------- as host ----------

  policy(link) {
    const p = this.links.guestPolicy(link.id);
    if (!p) throw fail(403, 'This office has no guest access set up for you.');
    return p;
  }

  tokensToday(linkId) {
    const u = this.used[linkId];
    return u?.day === utcDay() ? u.tokens : 0;
  }

  // The guest's own jobs, open ones only if asked.
  jobsOf(linkId, open = false) {
    return this.office.jobs().filter((j) => j.guest?.link === linkId && (!open || j.status === 'queued' || j.status === 'working'));
  }

  ownJob(link, id) {
    const job = this.office.jobs().find((j) => j.id === String(id ?? '') && j.guest?.link === link.id);
    if (!job) throw fail(404, 'No such job of yours.');
    return job;
  }

  capMode(p, mode = 'edit') {
    if (!CLEARANCE.includes(mode)) throw fail(400, 'Unknown mode.');
    if (CLEARANCE.indexOf(mode) > CLEARANCE.indexOf(p.clearance)) throw fail(403, `Your host allows up to ${p.clearance === 'plan' ? 'Plan only' : 'Edit files'}.`);
    return mode;
  }

  checkTokens(link, p) {
    if (this.tokensToday(link.id) >= p.tokensPerDay) throw fail(429, 'You have used today’s tokens for this office. They reset at midnight UTC.');
  }

  async answer(link, msg) {
    const id = String(msg.id ?? '').slice(0, 64);
    const args = msg.args && typeof msg.args === 'object' ? msg.args : {};
    let body;
    try {
      const p = this.policy(link);
      body = await this.op(link, p, String(msg.op ?? ''), args);
    } catch (err) {
      if (!err.code) console.error('[guests] request failed', link.id, msg.op, err);
      return this.links.send({ t: 'res', link: link.id, id, ok: false, code: err.code || 400, error: err.message });
    }
    this.links.send({ t: 'res', link: link.id, id, ok: true, body });
  }

  async op(link, p, op, args) {
    switch (op) {
      case 'hello':
        return {
          staff: this.office.staff(),
          modes: Object.fromEntries(Object.entries(this.office.modes()).filter(([k]) => CLEARANCE.indexOf(k) <= CLEARANCE.indexOf(p.clearance))),
          jobs: this.jobsOf(link.id).map((j) => guestJob(j)),
          policy: { repos: p.repos, clearance: p.clearance, tokensPerDay: p.tokensPerDay, tokensToday: this.tokensToday(link.id) },
        };
      case 'createJob': {
        if (!p.repos.includes(args.repo)) throw fail(403, 'That project isn’t shared with you.');
        const mode = this.capMode(p, args.mode);
        this.checkTokens(link, p);
        if (this.jobsOf(link.id, true).length >= MAX_OPEN_JOBS) throw fail(429, `You can have ${MAX_OPEN_JOBS} jobs going at once here. Wait for one to finish.`);
        const prompt = String(args.prompt ?? '').slice(0, MAX_PROMPT);
        const job = this.office.createJob(
          { repo: args.repo, prompt, mode, model: typeof args.model === 'string' ? args.model : '', agentId: typeof args.agentId === 'string' ? args.agentId : '' },
          { from: `@${link.peer}`, guest: { link: link.id } },
        );
        return { job: guestJob(job) };
      }
      case 'reply': {
        const job = this.ownJob(link, args.job);
        const mode = args.mode === undefined ? undefined : this.capMode(p, args.mode);
        this.checkTokens(link, p);
        this.office.replyJob(job, { message: String(args.text ?? '').slice(0, MAX_PROMPT), mode });
        return { ok: true };
      }
      case 'stop':
        this.office.stopJob(this.ownJob(link, args.job));
        return { ok: true };
      case 'job':
        return { job: guestJob(this.ownJob(link, args.job), 500) };
      case 'diff':
        return { diff: await this.office.diff(this.ownJob(link, args.job), String(args.path ?? '')) };
      default:
        throw fail(400, 'Guests can’t do that here.');
    }
  }

  // Tokens a guest job used: counted against its guest, and a guest over its
  // day's allowance has its running jobs stopped.
  addTokens(job, n) {
    const linkId = job.guest?.link;
    if (!linkId || !(n > 0)) return;
    const day = utcDay();
    const u = this.used[linkId]?.day === day ? this.used[linkId] : { day, tokens: 0 };
    u.tokens += n;
    this.used[linkId] = u;
    this.save();
    const p = this.links.guestPolicy(linkId);
    if (p && u.tokens >= p.tokensPerDay) {
      for (const j of this.jobsOf(linkId, true)) this.office.stopJob(j, 'Stopped: the guest used today’s tokens.');
    }
  }

  save() {
    // Old days and gone links aren't worth keeping.
    const day = utcDay();
    for (const [id, u] of Object.entries(this.used)) if (u.day !== day) delete this.used[id];
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ used: this.used }));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (err) { console.error('[guests] could not save', err.message); }
  }

  // Everything the office broadcasts passes here; a guest gets only its own
  // jobs (and staff changes), batched so a busy log stays under the relay's
  // frame rate.
  feed(msg) {
    if (!FEED_TYPES.has(msg.t)) return;
    const hosting = this.links.links.filter((l) => l.kind === 'guest' && l.role === 'host');
    if (!hosting.length) return;
    let linkId = null;
    if (msg.t === 'job') linkId = msg.job?.guest?.link;
    if (msg.t === 'log') linkId = this.office.jobs().find((j) => j.id === msg.jobId)?.guest?.link;
    for (const l of hosting) {
      if (msg.t !== 'staff' && l.id !== linkId) continue;
      const out = msg.t === 'job' ? { t: 'job', job: guestJob(msg.job, 0) } : msg;
      this.queue.set(l.id, [...(this.queue.get(l.id) || []), out]);
    }
    if (this.queue.size && !this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FEED_EVERY_MS);
  }

  flush() {
    this.flushTimer = null;
    for (const [linkId, msgs] of this.queue) {
      let batch = [], size = 0;
      for (const m of msgs) {
        const n = JSON.stringify(m).length;
        if (n > FEED_BYTES) continue; // one oversized log entry is not worth a dropped frame
        if (size + n > FEED_BYTES) { this.links.send({ t: 'feed', link: linkId, msgs: batch }); batch = []; size = 0; }
        batch.push(m);
        size += n;
      }
      if (batch.length) this.links.send({ t: 'feed', link: linkId, msgs: batch });
    }
    this.queue.clear();
  }

  // The relay's list changed. A guest whose link has gone loses its running
  // jobs at once, and anyone visiting over a gone link is sent home.
  linksChanged() {
    const live = new Set(this.links.links.map((l) => l.id));
    for (const j of this.office.jobs()) {
      if (j.guest && !live.has(j.guest.link) && (j.status === 'queued' || j.status === 'working')) this.office.stopJob(j, 'Stopped: the guest was unlinked.');
    }
    for (const [linkId, socks] of this.visits) {
      if (live.has(linkId)) continue;
      for (const ws of socks) ws.close(4404, 'This office unlinked you.');
      this.visits.delete(linkId);
    }
  }

  // ---------- as guest ----------

  guestLink(linkId) {
    const link = this.links.links.find((l) => l.id === linkId && l.kind === 'guest' && l.role === 'guest');
    if (!link) throw fail(404, 'You aren’t a guest of that office.');
    return link;
  }

  async request(linkId, op, args = {}) {
    const link = this.guestLink(linkId);
    // Just after linking (or a reconnect) the relay socket can still be
    // opening; a visit started then shouldn't fail for it.
    for (const end = Date.now() + CONNECT_WAIT_MS; !this.links.status().connected && Date.now() < end;) await new Promise((r) => setTimeout(r, 100));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(fail(504, `@${link.peer} didn’t answer.`)); }, REQ_TIMEOUT_MS);
      const clean = CLEAN_BODY[op] || (() => ({}));
      this.pending.set(id, { resolve: (body) => { try { resolve(clean(body)); } catch (err) { reject(err); } }, reject, timer });
      if (!this.links.send({ t: 'req', link: link.id, id, op, args })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(fail(502, 'Not connected to the relay.'));
      }
    });
  }

  settle(msg) {
    const p = this.pending.get(String(msg.id));
    if (!p) return;
    this.pending.delete(String(msg.id));
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.body && typeof msg.body === 'object' ? msg.body : {});
    else p.reject(fail(Number.isInteger(msg.code) && msg.code >= 400 && msg.code < 600 ? msg.code : 400, typeof msg.error === 'string' && msg.error ? msg.error.slice(0, 300) : 'The host refused.'));
  }

  fromHost(link, msg) {
    const socks = this.visits.get(link.id);
    if (!socks?.size || !Array.isArray(msg.msgs)) return;
    for (const raw of msg.msgs.slice(0, 500)) {
      const m = cleanFeed(raw);
      if (!m) continue;
      const data = JSON.stringify(m);
      for (const ws of socks) if (ws.readyState === 1) ws.send(data);
    }
  }

  // The host's hello, rebuilt. Mode labels are ours, not the host's.
  cleanHello(link, hello) {
    const policy = hello?.policy && typeof hello.policy === 'object' ? hello.policy : {};
    const clearance = CLEARANCE.includes(policy.clearance) ? policy.clearance : 'plan';
    const offered = hello?.modes && typeof hello.modes === 'object' ? hello.modes : {};
    const ours = this.office.modes();
    return {
      t: 'hello',
      staff: (Array.isArray(hello?.staff) ? hello.staff : []).slice(0, 50).map(cleanStaff).filter(Boolean),
      modes: Object.fromEntries(CLEARANCE.filter((k) => Object.hasOwn(offered, k) && CLEARANCE.indexOf(k) <= CLEARANCE.indexOf(clearance)).map((k) => [k, ours[k]])),
      jobs: (Array.isArray(hello?.jobs) ? hello.jobs : []).slice(0, 200).map(cleanJob).filter(Boolean),
      chat: [],
      channels: [],
      visiting: {
        link: link.id, host: link.peer,
        repos: (Array.isArray(policy.repos) ? policy.repos : []).filter((r) => typeof r === 'string' && REPO.test(r)).slice(0, 50),
        clearance, tokensPerDay: count(policy.tokensPerDay), tokensToday: count(policy.tokensToday),
      },
    };
  }

  // A browser opened /ws/visit/:link. The host's hello, cut down and labelled.
  async visit(ws, linkId, extra = () => ({})) {
    let link;
    try { link = this.guestLink(linkId); } catch { return ws.close(4404, 'You aren’t a guest of that office.'); }
    const socks = this.visits.get(link.id) || new Set();
    this.visits.set(link.id, socks);
    socks.add(ws);
    ws.on('close', () => { socks.delete(ws); if (!socks.size) this.visits.delete(link.id); });
    let hello;
    try { hello = await this.request(link.id, 'hello'); }
    catch (err) { return ws.close(4502, String(err.message).slice(0, 120)); }
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({ ...extra(), ...this.cleanHello(link, hello) }));
  }
}
