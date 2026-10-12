// Linked offices, from this machine's side.
//
// One socket, opened outwards to the relay (the leaderboard service), carries
// everything: our presence out to linked offices, theirs back in, and links
// being made and broken. Nothing listens for the outside world. What goes out
// is names, roles, looks and states, so a linked office sees whether an agent
// is busy but not on what; job titles only with OFFICE_SHARE_JOB_TITLES=1
// (presence() in index.js decides). No repos, logs, prompts or chat. Everything that comes in is checked against the shapes in
// docs/proposals/linked-offices.md and cut down to size before the browser
// sees it.
//
// Guest frames (req, res, feed) are handed to `onGuest`; this file only
// carries them.

import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const PRESENCE_GAP_MS = 5000;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 60_000;
const REPLACED = 4000; // the relay closes with this when another copy of this office connects
const DELETED = 4001; // and with this when the office deleted itself on the service
const PING_MS = 30_000; // the relay answers { t: 'ping' } without waking up; silence means a dead socket
const MAX_AGENTS = 16;
const STATES = new Set(['working', 'idle', 'break', 'meeting', 'away']);
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const CLEARANCES = new Set(['plan', 'edit', 'auto']); // MODES in index.js: auto is Full autonomy

const fail = (code, message) => Object.assign(new Error(message), { code });
// Plain text of at most `n` characters, with control characters dropped.
const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');

// Codes are typed by people: any case, dashes and spaces are fine, and the
// letters people mix up with digits read as those digits (Crockford).
export function normaliseCode(code) {
  return String(code ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

function cleanLink(l) {
  if (!l || !ID_RE.test(String(l.id))) return null;
  return {
    id: String(l.id),
    peer: text(l.peer, 20),
    kind: l.kind === 'guest' ? 'guest' : 'link',
    role: ['host', 'guest'].includes(l.role) ? l.role : 'peer',
    invite: ID_RE.test(String(l.invite ?? '')) ? String(l.invite) : null,
    createdAt: Number.isFinite(l.createdAt) ? l.createdAt : null,
  };
}

function cleanAgent(a) {
  if (!a || !ID_RE.test(String(a.id))) return null;
  const look = {};
  for (const k of ['shirt', 'hair', 'skin']) if (HEX_RE.test(a.look?.[k] ?? '')) look[k] = a.look[k];
  const title = text(a.job?.title, 120);
  return {
    id: String(a.id),
    name: text(a.name, 40) || String(a.id),
    role: text(a.role, 60),
    look,
    state: STATES.has(a.state) ? a.state : 'idle',
    job: title ? { title } : null,
  };
}

export class Links {
  // board: the Leaderboard, which owns the handle, the secret and the service address.
  // presence(): this office's agents, as the presence frame lists them.
  constructor(dataDir, { board, presence, onChange = () => {}, onGuest = () => {} }) {
    this.file = path.join(dataDir, 'links.json');
    this.board = board;
    this.presence = presence;
    this.onChange = onChange;
    this.onGuest = onGuest;
    // What we keep: the last list the relay gave us, so the panel has
    // something to show offline; guest limits by invite id, then by link id
    // once the guest arrives; and when our newest open invite runs out, so we
    // stay connected to hear it being used.
    this.saved = { links: [], guests: {}, invitesUntil: 0 };
    try { this.saved = { ...this.saved, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch {}
    this.visitors = new Map(); // link id -> { link, handle, agents }
    this.ws = null;
    this.listed = false; // the relay has sent this socket its list of links
    this.backoff = BACKOFF_MIN_MS;
    this.retry = null;
    this.replaced = false;
    this.lastSent = '';
    this.sentAt = 0;
    this.presenceTimer = null;
    this.pingTimer = null;
    this.error = null;
    this.connect();
  }

  get links() { return this.saved.links; }

  status() {
    return {
      handle: this.board.me.handle || null,
      connected: this.ws?.readyState === WebSocket.OPEN,
      error: this.error,
      links: this.links.map((l) => ({ ...l, guest: l.role === 'host' ? this.saved.guests[l.id] || null : undefined })),
    };
  }

  visiting() {
    return [...this.visitors.values()];
  }

  // A guest link's limits, as the host set them. Null if this isn't one we host.
  guestPolicy(linkId) {
    const l = this.links.find((x) => x.id === linkId);
    return l?.role === 'host' ? this.saved.guests[l.id] || null : null;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.saved), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  // ---------- the socket ----------

  // Worth holding a socket only if there is someone to talk to, or someone
  // who might turn up with one of our codes.
  get wanted() {
    return this.board.named && !this.replaced && (this.links.length > 0 || this.saved.invitesUntil > Date.now());
  }

  connect() {
    clearTimeout(this.retry);
    if (this.ws || !this.wanted) return;
    let base;
    try { base = this.board.endpoint(); } catch (err) { this.error = err.message; return; }
    const url = base.replace(/^http/, 'ws') + '/v1/socket';
    this.listed = false;
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.board.me.secret}` }, maxPayload: 64 * 1024, handshakeTimeout: 10_000 });
    this.ws = ws;
    ws.on('open', () => {
      let unanswered = 0;
      ws.on('message', () => { unanswered = 0; });
      this.pingTimer = setInterval(() => {
        if (++unanswered > 2) return ws.terminate();
        ws.send('{"t":"ping"}');
      }, PING_MS);
      this.pingTimer.unref?.();
      this.backoff = BACKOFF_MIN_MS;
      this.error = null;
      this.lastSent = '';
      this.sendPresence(true);
      this.onChange();
    });
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg && typeof msg === 'object') this.receive(msg);
    });
    ws.on('unexpected-response', (_req, res) => {
      this.error = res.statusCode === 401 ? 'The relay doesn’t know this office.' : `The relay answered ${res.statusCode}.`;
    });
    ws.on('error', () => { this.error ||= 'Couldn’t reach the relay.'; });
    ws.on('close', (code) => {
      clearInterval(this.pingTimer);
      if (this.ws === ws) this.ws = null;
      if (code === REPLACED || code === DELETED) {
        // Another copy of this office took over, and connecting again would
        // only knock it off in turn; or the office is gone from the service.
        this.replaced = true;
        this.error = code === DELETED ? 'This office was deleted from the relay.' : 'Another copy of this office is connected to the relay.';
      }
      this.visitors.clear();
      this.onChange();
      if (!this.wanted) return;
      const wait = this.backoff * (0.75 + Math.random() / 2);
      this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
      this.retry = setTimeout(() => this.connect(), wait);
      this.retry.unref?.();
    });
  }

  disconnect() {
    clearTimeout(this.retry);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    this.visitors.clear();
  }

  send(frame) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  receive(msg) {
    switch (msg.t) {
      case 'links':
        this.listed = true;
        this.setLinks((Array.isArray(msg.links) ? msg.links : []).map(cleanLink).filter(Boolean));
        break;
      case 'link': {
        const l = cleanLink(msg.link);
        if (l) this.setLinks([...this.links.filter((x) => x.id !== l.id), l]);
        break;
      }
      case 'unlink':
        this.setLinks(this.links.filter((x) => x.id !== String(msg.link?.id)));
        break;
      case 'presence': {
        const link = this.links.find((x) => x.id === String(msg.link));
        if (!link) return;
        const agents = (Array.isArray(msg.agents) ? msg.agents : []).slice(0, MAX_AGENTS).map(cleanAgent).filter(Boolean);
        this.visitors.set(link.id, { link: link.id, handle: text(msg.from, 20) || link.peer, agents });
        break;
      }
      case 'want-presence':
        this.sendPresence(true);
        return;
      case 'req': case 'res': case 'feed': {
        // Only on a guest link the relay listed for this socket, and only the
        // way round the roles allow: what we saved from an earlier socket may
        // hold a link that has since been ended.
        if (!this.listed) return;
        const link = this.links.find((x) => x.id === String(msg.link));
        if (link?.kind !== 'guest') return;
        if (msg.t === 'req' ? link.role !== 'host' : link.role !== 'guest') return;
        this.onGuest(link, msg);
        return;
      }
      case 'error':
        console.warn('[links] the relay dropped a frame:', text(msg.error, 200));
        return;
      default:
        return;
    }
    this.onChange();
  }

  // The relay's list is the truth. Guest limits move from the invite that
  // made a link to the link itself, and go when the link does.
  setLinks(links) {
    const guests = {};
    for (const l of links) {
      if (l.role !== 'host') continue;
      const policy = this.saved.guests[l.id] || (l.invite && this.saved.guests[`invite:${l.invite}`]);
      if (policy) guests[l.id] = policy;
    }
    for (const [k, v] of Object.entries(this.saved.guests)) {
      if (k.startsWith('invite:') && v.expiresAt > Date.now() && !links.some((l) => `invite:${l.invite}` === k)) guests[k] = v;
    }
    const ids = new Set(links.map((l) => l.id));
    for (const id of this.visitors.keys()) if (!ids.has(id)) this.visitors.delete(id);
    const grew = links.length > this.links.length;
    this.saved = { ...this.saved, links, guests };
    this.save();
    if (grew) this.sendPresence(true);
    if (!this.wanted) this.disconnect();
  }

  // Called whenever something an agent is doing might have changed. Sends
  // only real changes, at most once per PRESENCE_GAP_MS, unless `now`.
  sendPresence(now = false) {
    if (!this.links.length) return;
    const agents = this.presence().slice(0, MAX_AGENTS).map(cleanAgent).filter(Boolean);
    const body = JSON.stringify(agents);
    if (!now && body === this.lastSent) return;
    clearTimeout(this.presenceTimer);
    const wait = now ? 0 : this.sentAt + PRESENCE_GAP_MS - Date.now();
    if (wait > 0) {
      this.presenceTimer = setTimeout(() => this.sendPresence(), wait);
      this.presenceTimer.unref?.();
      return;
    }
    if (this.send({ t: 'presence', all: true, agents })) {
      this.lastSent = body;
      this.sentAt = Date.now();
    }
  }

  // ---------- what the panel asks for ----------

  async ensureHandle(handle) {
    if (!this.board.named) await this.board.claim(handle);
    if (!this.board.named) throw fail(400, 'Pick a handle first.');
  }

  async refresh() {
    if (!this.board.named) return this.status();
    const out = await this.board.call('GET', '/v1/links');
    this.setLinks((out.links || []).map(cleanLink).filter(Boolean));
    this.connect();
    return this.status();
  }

  async invite({ kind = 'link', guest, handle } = {}) {
    await this.ensureHandle(handle);
    kind = kind === 'guest' ? 'guest' : 'link';
    let policy = null;
    if (kind === 'guest') {
      const repos = Array.isArray(guest?.repos) ? [...new Set(guest.repos.map(String).filter(Boolean))] : [];
      if (!repos.length) throw fail(400, 'Pick at least one project the guest can use.');
      const clearance = CLEARANCES.has(guest?.clearance) ? guest.clearance : 'edit';
      const tokensPerDay = Number.isInteger(guest?.tokensPerDay) && guest.tokensPerDay > 0 ? guest.tokensPerDay : 2_000_000;
      policy = { repos, clearance, tokensPerDay };
    }
    const out = await this.board.call('POST', '/v1/invites', { body: { kind } });
    const expiresAt = Number(out.expiresAt) || Date.now() + 86_400_000;
    if (policy) this.saved.guests[`invite:${out.id}`] = { ...policy, expiresAt };
    this.saved.invitesUntil = Math.max(this.saved.invitesUntil, expiresAt);
    this.save();
    this.connect();
    const code = normaliseCode(out.code);
    return { id: out.id, code: `${code.slice(0, 4)}-${code.slice(4)}`, kind, expiresAt, guest: policy };
  }

  async redeem({ code, handle } = {}) {
    code = normaliseCode(code);
    if (!CODE_RE.test(code)) throw fail(400, 'A code is 8 letters and numbers, like K7QX-M2PD.');
    await this.ensureHandle(handle);
    const out = await this.board.call('POST', '/v1/invites/redeem', { body: { code } });
    const link = cleanLink(out.link);
    if (link) this.setLinks([...this.links.filter((x) => x.id !== link.id), link]);
    this.connect();
    return this.status();
  }

  async unlink(id) {
    id = String(id);
    if (!this.links.some((l) => l.id === id)) throw fail(404, 'No such link.');
    try { await this.board.call('DELETE', `/v1/links/${encodeURIComponent(id)}`); }
    catch (err) { if (err.code !== 404) throw err; } // already gone on the relay's side
    this.setLinks(this.links.filter((l) => l.id !== id));
    this.onChange();
    return this.status();
  }

  // The handle was forgotten (left the board without keeping it): the relay
  // has dropped our links with it.
  forget() {
    this.disconnect();
    this.saved = { links: [], guests: {}, invitesUntil: 0 };
    try { fs.rmSync(this.file, { force: true }); } catch {}
    this.onChange();
  }
}
