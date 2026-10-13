// Guests: another office running jobs with our agents over a guest link, and
// the other way round, us visiting an office that made us its guest.
//
// As host, everything a guest asks for comes in as a `req` frame and is
// checked here against the limits the boss set on the invite (repos,
// clearance cap, tokens per day). The guest's office is never trusted: it
// only ever sees its own jobs, and the feed it gets is cut down to them.
//
// As guest, we keep the host's hello (its agents, the projects and clearance
// it shares, our jobs there) for as long as the link lives, and fold its feed
// into our own office: the boss tags the host's agents in our chat like our
// own, and their jobs sit in our list. Ids are namespaced `<link>.<id>` so a
// host can never name one of our jobs or agents. The older /ws/visit/:link
// page still works off the same requests.
// See docs/proposals/linked-offices.md, "Guests".

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CLEARANCE = ['plan', 'edit', 'auto'];
const MAX_OPEN_JOBS = 3; // queued or working, per guest
const MAX_PROMPT = 20_000;
const REQ_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 60_000; // telling a host the work ended isn't on anyone's clock, and the relay can be slow to carry it
const CONNECT_WAIT_MS = 5_000;
const FEED_EVERY_MS = 250;
const FEED_BYTES = 48 * 1024; // under the relay's 64 KB a frame
const FEED_TYPES = new Set(['job', 'log', 'staff']);
const HELLO_RETRY_MS = 30_000;
const REMOTE_LOG = 600;
const MAX_THREADS = 300;
const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const fail = (code, message) => Object.assign(new Error(message), { code });
// Handles and project names match exactly, ignoring case only: the relay
// treats bob-x and bobx as two people, and so must we.
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

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
  // The host changed what we may do there; we ask for its hello again.
  if (m.t === 'policy') return { t: 'policy' };
  // The host stopped one of our agents working in its project.
  if (m.t === 'visit') return id(m.job) && m.ended === 'stopped' ? { t: 'visit', job: m.job, ended: 'stopped' } : null;
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
  'visit.open': (b) => {
    if (typeof b.sid !== 'string' || !/^[0-9a-f]{32}$/.test(b.sid)) throw fail(502, 'The host sent back a session that doesn’t look right.');
    return { sid: b.sid, access: b.access === 'edit' ? 'edit' : 'read' };
  },
  // What the host says about its own files goes only to our agent, as text.
  'visit.fs': (b) => ({ text: str(b.text, 64 * 1024) }),
  'visit.close': () => ({ ok: true }),
};

// What a guest may see of one of its own jobs.
export function guestJob(j, tail = 40) {
  const { id, repo, title, mode, model, status, createdAt, queuedAt, startedAt, endedAt, agentId, turns, tools, error, waiting, asking, awaitingBoss, changes, context, from, guest } = j;
  return { id, repo, title, mode, model, status, createdAt, queuedAt, startedAt, endedAt, agentId, turns, tools, error, waiting, asking, awaitingBoss, changes, context, from, guest, log: (j.log || []).slice(-tail) };
}

export class Guests {
  // office: { jobs(), repoPath(name), createJob(body, extra), replyJob(job, body), stopJob(job), diff(job, path), staff(), modes() }
  // office also has send(msg), which broadcasts to our own browsers.
  // visits (as host): our side of a guest's own agents working in our
  // projects; see visits.js.
  constructor(dataDir, { links, office, visits = null }) {
    this.links = links;
    this.office = office;
    this.copies = visits;
    this.file = path.join(dataDir, 'guests.json');
    this.used = {};
    // Where each of our jobs at a host was asked for (chat thread and
    // channel), and the project last used at each host.
    this.asked = { threads: {}, lastRepo: {} };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.used = saved.used || {};
      this.asked = { threads: saved.asked?.threads || {}, lastRepo: saved.asked?.lastRepo || {} };
    } catch {}
    this.remote = new Map(); // link id -> { link, host, staff, repos, clearance, jobs: Map(host job id -> job) }
    this.helloing = new Map(); // link id -> retry-after time, while asking or after a failure
    this.queue = new Map(); // link id -> messages waiting for the next feed frame
    this.flushTimer = null;
    this.visits = new Map(); // link id -> Set of browser sockets (as guest)
    this.pending = new Map(); // req id -> { resolve, reject, timer } (as guest)
    this.away = new Map(); // our job id -> { sid, access } while one of our agents works in a host's project
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
          policy: {
            repos: p.repos, clearance: p.clearance, tokensPerDay: p.tokensPerDay, tokensToday: this.tokensToday(link.id),
            ourAgents: p.ourAgents !== false, theirAgents: this.copies ? p.theirAgents || 'off' : 'off',
          },
          // We can run a lent agent in one of the guest's own projects (createJob's `home`).
          home: true,
        };
      case 'visit.open': case 'visit.fs': case 'visit.close': {
        if (!this.copies) throw fail(400, 'Guests can’t do that here.');
        if (op === 'visit.open') return this.copies.open(link, p, args);
        // Every file call is held to the limits as they are now, not as they
        // were when the work started.
        if (!['read', 'edit'].includes(p.theirAgents)) throw fail(403, 'This office no longer lets your agents work in its projects.');
        return op === 'visit.fs' ? this.copies.fs(link, args, p) : this.copies.close(link, args);
      }
      case 'createJob': {
        if (p.ourAgents === false) throw fail(403, 'This office lets your own agents work in its projects, but doesn’t lend its agents. Send one of yours instead.');
        // `home`: the guest's own project, not one of ours. The agent runs here
        // and its file tools go back to the guest over the link where we are
        // theirs (an away job), so it needs that link too, and that project shared on it.
        const home = typeof args.home === 'string' && args.home ? await this.homeFolder(link, args.home) : null;
        if (!home && !p.repos.includes(args.repo)) throw fail(403, 'That project isn’t shared with you.');
        const mode = this.capMode(p, args.mode);
        this.checkTokens(link, p);
        if (this.jobsOf(link.id, true).length >= MAX_OPEN_JOBS) throw fail(429, `You can have ${MAX_OPEN_JOBS} jobs going at once here. Wait for one to finish.`);
        const prompt = String(args.prompt ?? '').slice(0, MAX_PROMPT);
        const job = this.office.createJob(
          { repo: home ? `${home.repo}@${home.host}` : args.repo, prompt, mode, model: typeof args.model === 'string' ? args.model : '', agentId: typeof args.agentId === 'string' ? args.agentId : '' },
          { from: `@${link.peer}`, guest: { link: link.id }, ...(home && { away: home }) },
        );
        return { job: guestJob(job) };
      }
      case 'reply': {
        if (p.ourAgents === false) throw fail(403, 'This office doesn’t lend its agents any more.');
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

  // The guest's project `repo`, reached over the link where the guest is our
  // host, as an away job's `away`. The relay names both ends of a link, so a
  // guest can only point us at its own office.
  async homeFolder(link, repo) {
    let e = [...this.remote.values()].find((x) => same(x.host, link.peer));
    const back = !e && this.links.links.find((l) => l.kind === 'guest' && l.role === 'guest' && same(l.peer, link.peer));
    if (back) e = await this.remoteHello(back).catch(() => null);
    if (!e) throw fail(403, `To use our agents in your own projects, make @${this.links.status().handle || 'us'} your guest too, with their agents allowed in your projects.`);
    if (!['read', 'edit'].includes(e.theirAgents)) throw fail(403, `You haven’t let @${this.links.status().handle || 'us'}’s agents work in your projects. Turn that on where we’re your guest.`);
    const r = e.repos.find((x) => same(x, repo));
    if (!r) throw fail(403, `You haven’t shared ${repo} with @${this.links.status().handle || 'us'}. Add it where we’re your guest.`);
    return { link: e.link, host: e.host, repo: r, access: e.theirAgents };
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
      const threads = Object.entries(this.asked.threads);
      if (threads.length > MAX_THREADS) this.asked.threads = Object.fromEntries(threads.slice(-MAX_THREADS));
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ used: this.used, asked: this.asked }));
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
    this.syncRemote();
  }

  // ---------- as guest ----------

  guestLink(linkId) {
    const link = this.links.links.find((l) => l.id === linkId && l.kind === 'guest' && l.role === 'guest');
    if (!link) throw fail(404, 'You aren’t a guest of that office.');
    return link;
  }

  async request(linkId, op, args = {}, timeoutMs = REQ_TIMEOUT_MS) {
    const link = this.guestLink(linkId);
    // Just after linking (or a reconnect) the relay socket can still be
    // opening; a visit started then shouldn't fail for it.
    for (const end = Date.now() + CONNECT_WAIT_MS; !this.links.status().connected && Date.now() < end;) await new Promise((r) => setTimeout(r, 100));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(fail(504, `@${link.peer} didn’t answer.`)); }, timeoutMs);
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
    if (!Array.isArray(msg.msgs)) return;
    const socks = this.visits.get(link.id);
    for (const raw of msg.msgs.slice(0, 500)) {
      const m = cleanFeed(raw);
      if (!m) continue;
      this.remoteFeed(link, m);
      if (!socks?.size) continue;
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
        ourAgents: policy.ourAgents !== false, theirAgents: ['read', 'edit'].includes(policy.theirAgents) ? policy.theirAgents : 'off',
        home: hello?.home === true,
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

  // ---------- a host's agents, from our own office ----------

  // Ask every host that made us its guest for its hello, once per link (and
  // again after a failure, no sooner than HELLO_RETRY_MS). Cheap to call on
  // every links change: it does nothing for hosts it already knows.
  syncRemote() {
    const hosts = this.links.links.filter((l) => l.kind === 'guest' && l.role === 'guest');
    let gone = false;
    for (const id of this.remote.keys()) if (!hosts.some((l) => l.id === id)) { this.remote.delete(id); gone = true; }
    if (gone) this.office.send({ t: 'remote', offices: this.remoteStatus(), away: this.awayFolders() });
    if (!this.links.status().connected) return;
    for (const l of hosts) {
      if (this.remote.has(l.id) || (this.helloing.get(l.id) || 0) > Date.now()) continue;
      this.remoteHello(l).catch(() => {});
    }
  }

  async remoteHello(link) {
    this.helloing.set(link.id, Infinity);
    try {
      const hello = this.cleanHello(link, await this.request(link.id, 'hello'));
      const entry = {
        link: link.id, host: link.peer, staff: hello.staff, repos: hello.visiting.repos, clearance: hello.visiting.clearance,
        ourAgents: hello.visiting.ourAgents, theirAgents: hello.visiting.theirAgents, home: hello.visiting.home,
        jobs: new Map(hello.jobs.map((j) => [j.id, j])),
      };
      if (!this.guestLinkOrNull(link.id)) return null; // unlinked while we asked
      this.remote.set(link.id, entry);
      this.helloing.delete(link.id);
      this.office.send({ t: 'remote', offices: this.remoteStatus(), away: this.awayFolders() });
      for (const j of entry.jobs.values()) this.office.send({ t: 'job', job: this.localJob(entry, j) });
      return entry;
    } catch (err) {
      this.helloing.set(link.id, Date.now() + HELLO_RETRY_MS);
      throw err;
    }
  }

  guestLinkOrNull(linkId) {
    try { return this.guestLink(linkId); } catch { return null; }
  }

  // A host's job as our page sees it: namespaced ids, where it was asked
  // for, and which office it runs in. `from` is us, so it's dropped.
  localJob(entry, j, tail = 40) {
    const key = `${entry.link}.${j.id}`;
    const { guest: _g, from: _f, ...rest } = j;
    return {
      ...rest, id: key, agentId: j.agentId ? `${entry.link}.${j.agentId}` : null,
      remote: { link: entry.link, host: entry.host }, ...this.asked.threads[key],
      log: (j.log || []).slice(-tail),
    };
  }

  // The host's agents, for our page. `here` says who it has on the floor,
  // from its presence; staff it hasn't hired can't be tagged.
  remoteStatus() {
    return [...this.remote.values()].map((e) => {
      const present = this.links.presentAt(e.link);
      const here = present && new Set(present.map((a) => a.id));
      return {
        link: e.link, host: e.host, repos: e.repos, clearance: e.clearance, theirAgents: e.theirAgents || 'off',
        // A host that only lets our own agents in has none of its to tag.
        staff: e.ourAgents === false ? [] : e.staff.map((s) => ({ ...s, id: `${e.link}.${s.id}`, here: here ? here.has(s.id) : true })),
      };
    });
  }

  remoteJobs() {
    return [...this.remote.values()].flatMap((e) => [...e.jobs.values()].map((j) => this.localJob(e, j)));
  }

  // One feed message from a host, folded into our office.
  remoteFeed(link, m) {
    if (m.t === 'policy') {
      this.remote.delete(link.id);
      this.helloing.delete(link.id);
      this.syncRemote();
      return;
    }
    if (m.t === 'visit') {
      this.office.awayStopped?.(m.job, link.id);
      return;
    }
    const entry = this.remote.get(link.id);
    if (!entry) return;
    if (m.t === 'job') {
      const prev = entry.jobs.get(m.job.id);
      const job = { ...m.job, log: prev?.log || [] };
      entry.jobs.set(job.id, job);
      this.office.send({ t: 'job', job: this.localJob(entry, job, 0) });
      if (prev?.status === 'working' && job.status !== 'working' && job.status !== 'queued') this.office.remoteEnded?.(this.localJob(entry, job, 1), prev);
    } else if (m.t === 'log') {
      const job = entry.jobs.get(m.jobId);
      if (!job) return;
      job.log.push(m.entry);
      if (job.log.length > REMOTE_LOG) job.log.splice(0, job.log.length - REMOTE_LOG);
      this.office.send({ t: 'log', jobId: `${entry.link}.${job.id}`, entry: m.entry });
    }
  }

  // `<link>.<host job id>` -> the host and its id, or null if it isn't one.
  remoteKey(key) {
    const m = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{1,64})$/.exec(String(key ?? ''));
    const entry = m && this.remote.get(m[1]);
    return entry ? { entry, id: m[2] } : null;
  }

  // The remote job a chat thread is about, if any.
  threadJob(root) {
    const key = Object.keys(this.asked.threads).findLast((k) => this.asked.threads[k].thread === root);
    return key && this.remoteKey(key) ? key : null;
  }

  // The highest clearance at or below `mode` that the host allows.
  capRemote(entry, mode) {
    const want = CLEARANCE.includes(mode) ? mode : 'edit';
    return CLEARANCE[Math.min(CLEARANCE.indexOf(want), CLEARANCE.indexOf(entry.clearance))];
  }

  // What /api/jobs/<link>.<id> does for a host's job.
  async remoteOp(key, op, args = {}) {
    const r = this.remoteKey(key);
    if (!r) throw fail(404, 'No such job.');
    const { entry, id } = r;
    if (op === 'job') {
      const { job } = await this.request(entry.link, 'job', { job: id });
      entry.jobs.set(job.id, job);
      return this.localJob(entry, job, 500);
    }
    if (op === 'diff') return this.request(entry.link, 'diff', { job: id, path: String(args.path ?? '') });
    if (op === 'stop') return this.request(entry.link, 'stop', { job: id });
    if (op === 'reply') {
      if (Array.isArray(args.files) && args.files.length) throw fail(400, `Files can’t go to @${entry.host}’s office. Paste the text instead.`);
      const text = String(args.message ?? args.text ?? '').trim();
      if (!text) throw fail(400, 'Say something first.');
      return this.request(entry.link, 'reply', { job: id, text, mode: args.mode === undefined ? undefined : this.capRemote(entry, args.mode) });
    }
    throw fail(400, 'Can’t do that with a linked office’s job.');
  }

  // A host agent tagged in `text`. `@Name@host` always means the host's;
  // a bare `@Name` only when none of ours answers to it (isLocal).
  tagged(text, isLocal) {
    const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
    const offices = this.remoteStatus();
    const find = (name, host) => {
      for (const o of offices) {
        if (host && !same(o.host, host)) continue;
        const s = o.staff.find((x) => x.here && norm(x.name) === norm(name));
        if (s) return { link: o.link, host: o.host, staff: s };
      }
      return null;
    };
    for (const m of text.matchAll(/@([\w-]+)@([\w-]+)/g)) {
      const hit = find(m[1], m[2]);
      if (hit) return { ...hit, clean: text.replace(m[0], ' ').replace(/[ \t]+/g, ' ').trim() };
    }
    for (const m of text.matchAll(/(^|[^\w@])@([\w-]+)(?![\w@-])/g)) {
      if (isLocal(m[2])) continue;
      const hit = find(m[2]);
      if (hit) {
        const re = new RegExp(`@${m[2]}(?![\\w@-])`);
        return { ...hit, clean: text.replace(re, ' ').replace(/[ \t]+/g, ' ').trim() };
      }
    }
    return null;
  }

  // One of our own projects, for a host's lent agent: the host runs it and its
  // file tools come back to us over the link where the host is our guest
  // (visits.js), so that link must let their agents into this project.
  lentHome(entry, repo) {
    const h = entry.host;
    if (!entry.home) throw fail(400, `@${h}’s office is on an older version that can only run its agents in its own projects. Ask @${h} to update.`);
    const back = this.links.links.find((l) => l.kind === 'guest' && l.role === 'host' && same(l.peer, h));
    const p = back && this.links.guestPolicy(back.id);
    if (!p) throw fail(400, `To use @${h}’s agents in #${repo}, make @${h} your guest too, with their agents allowed in your projects.`);
    if (!['read', 'edit'].includes(p.theirAgents)) throw fail(400, `To use @${h}’s agents in #${repo}, let their agents work in your projects: Change, where @${h} is your guest.`);
    const r = p.repos.find((x) => same(x, repo));
    if (!r) throw fail(400, `You haven’t shared ${repo} with @${h}. Add it under Change, where @${h} is your guest, and ask again.`);
    return r;
  }

  // The project a job at a host goes in: the only one it shares, one tagged
  // or named in the brief, or the one used there last time.
  remoteRepo(entry, text) {
    const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
    const { repos } = entry;
    if (!repos.length) throw fail(403, `@${entry.host} hasn’t shared any projects with you.`);
    const tags = [...text.matchAll(/(^|\s)#([\w.-]+)/g)];
    // A project of ours, not theirs: their agent would run in their folder
    // and never see ours. Say so, rather than quietly working somewhere else.
    const ours = tags.find((t) => !repos.some((r) => same(r, t[2])) && this.office.repoPath(t[2]));
    if (ours) return { repo: this.lentHome(entry, ours[2]), home: true, text: text.replace(ours[0], ' ').replace(/[ \t]+/g, ' ').trim() };
    if (repos.length === 1) return { repo: repos[0], text };
    for (const t of tags) {
      const repo = repos.find((r) => same(r, t[2]));
      if (repo) return { repo, text: text.replace(t[0], ' ').replace(/[ \t]+/g, ' ').trim() };
    }
    const said = norm(text);
    const named = repos.filter((r) => norm(r).length >= 3 && said.includes(norm(r)));
    if (named.length === 1) return { repo: named[0], text };
    const last = this.asked.lastRepo[entry.link];
    if (repos.includes(last)) return { repo: last, text };
    throw fail(400, `Which of @${entry.host}’s projects is that for? Say ${repos.map((r) => r).join(', ')} in the message.`);
  }

  // ---------- our agents in a host's projects ----------
  //
  // A host can let our own agents work in its projects: the agent runs here,
  // on our account, and its file tools are requests to the host (visit.*),
  // which works on a copy and answers in text. See visits.js for the host's side.

  // `#web@friend`: a host's project our agents may work in, or null.
  awayFolder(repo, host) {
    for (const e of this.remote.values()) {
      if (!same(e.host, host) || !['read', 'edit'].includes(e.theirAgents)) continue;
      const r = e.repos.find((x) => same(x, repo));
      if (r) return { link: e.link, host: e.host, repo: r, access: e.theirAgents };
    }
    return null;
  }

  // Every host project our agents may work in, for the page's # menu.
  awayFolders() {
    return [...this.remote.values()].filter((e) => ['read', 'edit'].includes(e.theirAgents))
      .flatMap((e) => e.repos.map((repo) => ({ link: e.link, host: e.host, repo, access: e.theirAgents })));
  }

  // One file call from our agent's job, as a request to the host. The first
  // opens the session there; a session the host has lost is opened again once.
  async awayFs(job, agent, op, args) {
    const { link, repo } = job.away;
    const open = async () => {
      const s = await this.request(link, 'visit.open', { repo, job: job.id, title: job.title, agent });
      this.away.set(job.id, s);
      job.away.access = s.access;
      return s;
    };
    let s = this.away.get(job.id) || await open();
    try {
      return (await this.request(link, 'visit.fs', { ...args, sid: s.sid, op })).text;
    } catch (err) {
      if (err.code !== 404 || !/session has ended/.test(err.message)) throw err;
      this.away.delete(job.id);
      s = await open();
      return (await this.request(link, 'visit.fs', { ...args, sid: s.sid, op })).text;
    }
  }

  // Our job ended: the host closes its side and works out what changed.
  async awayClose(job, status, summary) {
    const s = this.away.get(job.id);
    if (!s) return;
    this.away.delete(job.id);
    const args = { sid: s.sid, status, summary: String(summary || '').slice(0, 2000) };
    // A close that outruns the wait may still land, so ask again once. The
    // host ends a visit once, and an answer that says it already has is fine.
    for (let tries = 0; ; tries++) {
      try {
        await this.request(job.away.link, 'visit.close', args, CLOSE_TIMEOUT_MS);
        return;
      } catch (err) {
        if (err.code === 404 || err.code === 410) return;
        if (err.code !== 504 || tries) throw err;
      }
    }
  }

  // Start a job with one of a host's agents, from our chat.
  async startRemote({ link, staff, text, mode, model, thread, channel }) {
    const entry = this.remote.get(link) || await this.remoteHello(this.guestLink(link));
    const { repo, home, text: brief } = this.remoteRepo(entry, text);
    if (!brief) throw fail(400, 'Say what the job is, as well as who it’s for.');
    const agentId = staff.id.slice(link.length + 1);
    const { job } = await this.request(link, 'createJob', { ...(home ? { home: repo } : { repo }), prompt: brief, mode: this.capRemote(entry, mode), model, agentId });
    this.asked.threads[`${link}.${job.id}`] = { thread, channel };
    if (!home) this.asked.lastRepo[link] = repo;
    this.save();
    entry.jobs.set(job.id, job);
    const local = this.localJob(entry, job);
    this.office.send({ t: 'job', job: local });
    return { job: local, entry, repo, home: !!home, capped: this.capRemote(entry, mode) !== mode };
  }
}
