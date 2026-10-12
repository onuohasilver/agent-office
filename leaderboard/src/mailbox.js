// One Mailbox per office: it holds that office's relay socket and passes
// frames to and from the Mailboxes of the offices it is linked with.
//
// The socket hibernates, so this object can be evicted between frames and
// lose everything in memory. Who the office is rides on the socket itself;
// its links are read back from D1 and trusted for 30 seconds at most, and a
// req, res or feed frame is only passed on once D1 still has its link; its
// last presence is kept in memory only,
// and when it is gone the office is asked for it again (`want-presence`).
// Nothing is written to storage. See docs/proposals/linked-offices.md.

import { DurableObject } from 'cloudflare:workers';
import { linksOf, linkAlive } from './links.js';

export const RELAY = { maxFrameBytes: 64 * 1024, ratePerSec: 20, burst: 60, linksTtlMs: 30_000 };

// What an office may send, by its role on the link. Presence goes anywhere;
// requests only from a guest, answers and the feed only from the host.
const ALLOWED = {
  presence: () => true,
  req: (role) => role === 'guest',
  res: (role) => role === 'host',
  feed: (role) => role === 'host',
};

const byteLength = (text) => (text.length * 3 <= RELAY.maxFrameBytes ? text.length : new TextEncoder().encode(text).length);

export class Mailbox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.links = null; // Map of link id -> { view, peerUid }, read from D1 when needed
    this.linksAt = 0; // when they were read
    this.presence = null; // the office's last presence sent to everyone
    this.tokens = RELAY.burst;
    this.filledAt = Date.now();
    // Keepalives are answered by the runtime without waking this object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  // ---------- the office's socket ----------

  async fetch(request) {
    const uid = request.headers.get('x-office-user');
    const handle = request.headers.get('x-office-handle');
    for (const old of this.ctx.getWebSockets()) {
      old.serializeAttachment({ ...old.deserializeAttachment(), replaced: true });
      try { old.close(4000, 'Replaced by a newer connection from this office.'); } catch {}
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ uid, handle });
    this.uid = uid;
    this.handle = handle;
    this.presence = null;
    this.links = null; // read afresh: links may have changed while no one was connected
    this.hello(server).catch((err) => console.error('hello failed', uid, err));
    return new Response(null, { status: 101, webSocket: client });
  }

  // A fresh socket gets its links, then the latest presence of each peer.
  async hello(ws) {
    await this.loadLinks();
    ws.send(JSON.stringify({ t: 'links', links: [...this.links.values()].map((l) => l.view) }));
    await Promise.allSettled([...this.links.values()].map((l) => this.box(l.peerUid).share(this.uid, l.view.id)));
  }

  async webSocketMessage(ws, message) {
    this.identify(ws);
    const error = (text) => { try { ws.send(JSON.stringify({ t: 'error', error: text })); } catch {} };
    if (typeof message !== 'string') return error('Frames are JSON text.');
    if (byteLength(message) > RELAY.maxFrameBytes) return error('Frame too big: 64 KB at most.');
    if (!this.take()) return error('Too many frames: 20 a second on average, bursts of 60.');
    let frame;
    try { frame = JSON.parse(message); } catch { return error('Frames are JSON.'); }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) || !Object.hasOwn(ALLOWED, frame.t)) return error(`Unknown frame type: ${String(frame?.t).slice(0, 40)}.`);

    if (frame.all === true) {
      if (frame.t !== 'presence') return error('Only presence can go to all links.');
      if (!Array.isArray(frame.agents)) return error('Presence needs agents.');
      const { all, link, from, ...body } = frame;
      this.presence = body;
      await this.loadLinks();
      await Promise.allSettled([...this.links.values()].map((l) => this.send(l, body)));
      return;
    }
    if (typeof frame.link !== 'string') return error('Say which link, or all: true for presence.');
    await this.loadLinks();
    const l = this.links.get(frame.link);
    if (!l) return error('Not on that link.');
    if (!ALLOWED[frame.t](l.view.role)) return error(`A ${l.view.role} can't send ${frame.t} on this link.`);
    // A missed unlink must not leave a guest able to reach a host's office.
    if (frame.t !== 'presence' && !(await linkAlive(this.env.DB, l.view.id, this.uid))) {
      this.links.delete(l.view.id);
      return error('Not on that link.');
    }
    const { all, link, from, ...body } = frame;
    await this.send(l, body).catch((err) => { console.error('deliver failed', l.view.id, err); error('Couldn’t deliver that.'); });
  }

  async webSocketClose(ws, code) {
    const me = ws.deserializeAttachment() || {};
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch {}
    if (me.replaced) return;
    this.identify(ws);
    // The office has gone: its visitors leave every linked office.
    this.presence = null;
    await this.loadLinks();
    await Promise.allSettled([...this.links.values()].map((l) => this.send(l, { t: 'presence', agents: [] })));
  }

  async webSocketError(ws, err) {
    console.error('socket error', ws.deserializeAttachment()?.uid, err);
  }

  // ---------- calls from the Worker and other Mailboxes ----------

  // A frame for this office.
  deliver(text) {
    for (const ws of this.live()) { try { ws.send(text); } catch {} }
  }

  // Send this office's presence to `toUid` on `linkId`, or ask the office
  // for it if hibernation dropped it.
  async share(toUid, linkId) {
    const ws = this.live()[0];
    if (this.presence && this.handle) return this.box(toUid).deliver(JSON.stringify({ ...this.presence, from: this.handle, link: linkId }));
    if (ws) ws.send('{"t":"want-presence"}');
  }

  async linked(view, peerUid) {
    if (this.links) this.links.set(view.id, { view, peerUid });
    this.deliver(JSON.stringify({ t: 'link', link: view }));
    await this.share(peerUid, view.id);
  }

  unlinked(id) {
    this.links?.delete(id);
    this.deliver(JSON.stringify({ t: 'unlink', link: { id } }));
  }

  // The office has deleted itself: drop its socket and everything held.
  forget() {
    for (const ws of this.ctx.getWebSockets()) {
      ws.serializeAttachment({ ...ws.deserializeAttachment(), replaced: true });
      try { ws.close(4001, 'This office was deleted.'); } catch {}
    }
    this.links = null;
    this.presence = null;
  }

  // ---------- helpers ----------

  box(uid) { return this.env.MAILBOX.get(this.env.MAILBOX.idFromName(uid)); }

  live() { return this.ctx.getWebSockets().filter((ws) => !ws.deserializeAttachment()?.replaced && ws.readyState === WebSocket.OPEN); }

  identify(ws) {
    if (this.uid) return;
    const me = ws.deserializeAttachment() || {};
    this.uid = me.uid;
    this.handle = me.handle;
  }

  async loadLinks() {
    if (!this.uid || (this.links && Date.now() - this.linksAt < RELAY.linksTtlMs)) return;
    const at = Date.now();
    this.links = new Map((await linksOf(this.env.DB, this.uid)).map((l) => [l.view.id, l]));
    this.linksAt = at;
  }

  send(l, body) {
    return this.box(l.peerUid).deliver(JSON.stringify({ ...body, from: this.handle, link: l.view.id }));
  }

  take() {
    const now = Date.now();
    this.tokens = Math.min(RELAY.burst, this.tokens + ((now - this.filledAt) / 1000) * RELAY.ratePerSec);
    this.filledAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
