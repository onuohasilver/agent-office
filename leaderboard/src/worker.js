// The Agent Office service: the leaderboard and the linked-offices relay, a
// Cloudflare Worker over D1 with a Mailbox Durable Object per office.
//
// It keeps a claimed handle and, per UTC day, a count of jobs completed,
// tokens used and seconds of agent time. Nothing else is accepted. A user is identified by the hash of a
// secret their office made up; the secret itself is never stored.
//
//   POST   /v1/claim   { handle }                    Authorization: Bearer <secret>
//   PUT    /v1/days    { days: [{ day, jobs, tokens, seconds }] }
//   DELETE /v1/days                                 off the board, keeping the handle and links
//   GET    /v1/me                                   who the secret belongs to
//   DELETE /v1/me                                   forget me, my links and invites
//   GET    /v1/board?period=week|all                public, cached for a minute
//
// Linked offices (docs/proposals/linked-offices.md):
//
//   POST   /v1/invites         { kind: link|guest } a one-time code for 24 hours
//   POST   /v1/invites/redeem  { code }             link with whoever made it
//   GET    /v1/links
//   DELETE /v1/links/:id                            both sides get an unlink frame
//   GET    /v1/socket                               WebSocket, held by the office's Mailbox
//
// Bodies are 20 KB at most. Addresses are only ever kept as an HMAC under the
// IP_KEY secret (`wrangler secret put IP_KEY`), and only for an hour.

import { linkView, linksOf, linkById } from './links.js';
import { RELAY } from './mailbox.js';

export { Mailbox } from './mailbox.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,19}$/i;
const RESERVED = new Set(['admin', 'administrator', 'anthropic', 'claude', 'office', 'agent-office', 'chief', 'staff', 'support', 'system', 'root', 'null', 'undefined']);

// A day no honest office reaches. Rejecting beats clamping: a clamped number
// still looks earned.
export const LIMITS = { jobsPerDay: 500, tokensPerDay: 500_000_000, secondsPerDay: 1_000_000, daysBack: 14, daysAhead: 1, daysPerSync: 15, minSyncGapMs: 20_000, claimsPerHour: 100, boardRows: 50, openInvites: 20, inviteMs: 24 * 3_600_000, redeemsPerMinute: 3, redeemsPerMinutePerAddress: 10, redeemsPerMinuteInAll: 300, bodyBytes: 20_000, ...RELAY };

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const fail = (status, error) => json({ error }, status);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const hmac = async (key, text) => {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text)));
};

// The caller's address, keyed so a leaked table can't be walked back to it by
// hashing every IPv4 address. Without IP_KEY (local dev) it is a plain hash.
const addressOf = (request, env) => {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  return env.IP_KEY ? hmac(env.IP_KEY, ip) : sha256(`ip|${ip}`);
};

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Monday of the week `ms` falls in, as YYYY-MM-DD.
export function weekStart(ms) {
  const d = new Date(utcDay(ms) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const validDay = (s) => DAY_RE.test(s) && utcDay(Date.parse(s + 'T00:00:00Z')) === s;
const wholeNumber = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;

async function who(request, env) {
  const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('authorization') || '');
  if (!m) return null;
  const id = await sha256(m[1]);
  return env.DB.prepare('SELECT id, handle, synced_at FROM users WHERE id = ?').bind(id).first();
}

const tooBig = () => Object.assign(new Error('Body too big.'), { status: 413 });

// JSON or null. Refused unread when it says it is too big, and cut off as soon
// as it turns out to be, whatever it said.
async function readJson(request) {
  if (Number(request.headers.get('content-length')) > LIMITS.bodyBytes) throw tooBig();
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.bodyBytes) { reader.cancel().catch(() => {}); throw tooBig(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

// A counter per key and time window, for slowing down guessing. Rows carry
// when their window ends and the hourly cron clears them.
async function bump(env, key, windowMs, now) {
  const slot = Math.floor(now / windowMs);
  const row = await env.DB.prepare(
    'INSERT INTO throttles (bucket, n, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n',
  ).bind(await sha256(`${key}|${slot}`), (slot + 1) * windowMs).first();
  return row.n;
}

async function claim(request, env, now) {
  const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('authorization') || '');
  if (!m) return fail(401, 'Missing secret.');
  const body = await readJson(request);
  const handle = String(body?.handle ?? '').trim();
  if (!HANDLE_RE.test(handle)) return fail(400, 'A handle is 3 to 20 letters, numbers, - or _.');
  if (RESERVED.has(handle.toLowerCase())) return fail(409, 'That handle is taken.');

  if (await bump(env, `claim|${await addressOf(request, env)}`, 3_600_000, now) > LIMITS.claimsPerHour) return fail(429, 'Too many tries. Wait a while.');

  const id = await sha256(m[1]);
  const mine = await env.DB.prepare('SELECT handle FROM users WHERE id = ?').bind(id).first();
  // The same office asking again gets the same answer, so a lost response is harmless.
  if (mine) return mine.handle.toLowerCase() === handle.toLowerCase() ? json({ handle: mine.handle }) : fail(409, `This office already holds ${mine.handle}.`);
  try {
    await env.DB.prepare('INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)').bind(id, handle, now).run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err.message))) return fail(409, 'That handle is taken.');
    throw err;
  }
  return json({ handle }, 201);
}

async function putDays(request, env, now) {
  const user = await who(request, env);
  if (!user) return fail(401, 'Unknown secret. Claim a handle first.');
  if (now - user.synced_at < LIMITS.minSyncGapMs) return fail(429, 'Slow down.');
  const body = await readJson(request);
  if (!Array.isArray(body?.days) || !body.days.length || body.days.length > LIMITS.daysPerSync) return fail(400, 'Send between 1 and 15 days.');

  const today = Date.parse(utcDay(now) + 'T00:00:00Z');
  const earliest = today - LIMITS.daysBack * 86_400_000;
  const latest = today + LIMITS.daysAhead * 86_400_000;
  const seen = new Set();
  for (const d of body.days) {
    if (typeof d?.day !== 'string' || !validDay(d.day)) return fail(400, 'Days look like 2026-10-11.');
    const at = Date.parse(d.day + 'T00:00:00Z');
    if (at < earliest || at > latest) return fail(400, `${d.day} is outside the days that can be sent.`);
    if (seen.has(d.day)) return fail(400, `${d.day} is in there twice.`);
    seen.add(d.day);
    if (!wholeNumber(d.jobs, LIMITS.jobsPerDay) || !wholeNumber(d.tokens, LIMITS.tokensPerDay) || !wholeNumber(d.seconds, LIMITS.secondsPerDay)) return fail(400, `${d.day} is out of range.`);
  }

  // A day's numbers are set, not added to, so a retry can't double anything.
  await env.DB.batch([
    ...body.days.map((d) => env.DB.prepare(
      'INSERT INTO days (user_id, day, jobs, tokens, seconds) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET jobs = excluded.jobs, tokens = excluded.tokens, seconds = excluded.seconds',
    ).bind(user.id, d.day, d.jobs, d.tokens, d.seconds)),
    env.DB.prepare('UPDATE users SET synced_at = ? WHERE id = ?').bind(now, user.id),
  ]);
  return json({ ok: true, handle: user.handle });
}

// ---------- linked offices ----------

// Crockford base32: no I, L, O or U. 8 characters is 40 bits.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KINDS = new Set(['link', 'guest']);
const box = (env, uid) => env.MAILBOX.get(env.MAILBOX.idFromName(uid));
const codeHash = (code) => sha256(`invite|${code}`);

// Any case, dashes and spaces ignored, I and L read as 1, O as 0.
export function normaliseCode(text) {
  const code = String(text ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(code) ? code : null;
}

async function createInvite(request, env, now) {
  const user = await who(request, env);
  if (!user) return fail(401, 'Unknown secret. Claim a handle first.');
  const body = await readJson(request);
  if (!KINDS.has(body?.kind)) return fail(400, 'An invite is a link or a guest invite.');
  await env.DB.prepare('DELETE FROM invites WHERE expires_at <= ?').bind(now).run();
  const open = await env.DB.prepare('SELECT COUNT(*) AS n FROM invites WHERE user_id = ?').bind(user.id).first();
  if (open.n >= LIMITS.openInvites) return fail(429, `You have ${LIMITS.openInvites} open invites. Let some expire or use them first.`);
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = [...bytes].map((b) => CROCKFORD[b & 31]).join('');
  const id = crypto.randomUUID();
  const expiresAt = now + LIMITS.inviteMs;
  await env.DB.prepare('INSERT INTO invites (id, code_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, await codeHash(code), user.id, body.kind, expiresAt).run();
  return json({ id, code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt }, 201);
}

// Codes are 40 bits. Guessing is slowed per office, per address and across
// the whole service, so many offices on many addresses still can't sweep them.
async function redeem(request, env, now) {
  const slow = () => fail(429, 'Too many tries. Wait a minute.');
  if (await bump(env, `redeem-from|${await addressOf(request, env)}`, 60_000, now) > LIMITS.redeemsPerMinutePerAddress) return slow();
  const user = await who(request, env);
  if (!user) return fail(401, 'Unknown secret. Claim a handle first.');
  if (await bump(env, `redeem|${user.id}`, 60_000, now) > LIMITS.redeemsPerMinute) return slow();
  if (await bump(env, 'redeem-all', 60_000, now) > LIMITS.redeemsPerMinuteInAll) return slow();
  const body = await readJson(request);
  const code = normaliseCode(body?.code);
  if (!code) return fail(400, 'A code looks like K7QX-M2PD.');
  const hash = await codeHash(code);
  const gone = () => fail(404, 'That code doesn’t work. It may have expired or already been used.');
  const invite = await env.DB.prepare('SELECT id, user_id, kind FROM invites WHERE code_hash = ? AND expires_at > ?').bind(hash, now).first();
  if (!invite) return gone();
  if (invite.user_id === user.id) return fail(400, 'That is your own code. Send it to the other office.');
  const same = invite.kind === 'guest'
    ? await env.DB.prepare("SELECT id FROM links WHERE kind = 'guest' AND a_user = ? AND b_user = ?").bind(invite.user_id, user.id).first()
    : await env.DB.prepare("SELECT id FROM links WHERE kind = 'link' AND ((a_user = ? AND b_user = ?) OR (a_user = ? AND b_user = ?))").bind(invite.user_id, user.id, user.id, invite.user_id).first();
  if (same) return fail(409, 'You are already linked with that office.');
  // Used up here, so two offices racing for one code can't both have it.
  const taken = await env.DB.prepare('DELETE FROM invites WHERE code_hash = ? AND expires_at > ? RETURNING id').bind(hash, now).first();
  if (!taken) return gone();
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO links (id, a_user, b_user, kind, invite_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, invite.user_id, user.id, invite.kind, invite.id, now).run();
  const row = await linkById(env.DB, id);
  await Promise.allSettled([
    box(env, row.a_user).linked(linkView(row, row.a_user), row.b_user),
    box(env, row.b_user).linked(linkView(row, row.b_user), row.a_user),
  ]);
  return json({ link: linkView(row, user.id) }, 201);
}

async function unlink(id, request, env) {
  const user = await who(request, env);
  if (!user) return fail(401, 'Unknown secret.');
  const row = await linkById(env.DB, id);
  if (!row || (row.a_user !== user.id && row.b_user !== user.id)) return fail(404, 'No such link.');
  await env.DB.prepare('DELETE FROM links WHERE id = ?').bind(id).run();
  await Promise.allSettled([box(env, row.a_user).unlinked(id), box(env, row.b_user).unlinked(id)]);
  return json({ ok: true });
}

async function socket(request, env) {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return fail(426, 'This is a WebSocket.');
  const user = await who(request, env);
  if (!user) return fail(401, 'Unknown secret. Claim a handle first.');
  // Who the office is comes from here, never from the office.
  const headers = new Headers(request.headers);
  headers.set('x-office-user', user.id);
  headers.set('x-office-handle', user.handle);
  return box(env, user.id).fetch(new Request(request, { headers }));
}

async function forgetMe(user, env) {
  const links = await linksOf(env.DB, user.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM days WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM invites WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM links WHERE a_user = ? OR b_user = ?').bind(user.id, user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  await Promise.allSettled([
    ...links.map((l) => box(env, l.peerUid).unlinked(l.view.id)),
    box(env, user.id).forget(),
  ]);
  return json({ ok: true });
}

async function board(url, env, now) {
  const period = url.searchParams.get('period') === 'all' ? 'all' : 'week';
  const from = period === 'week' ? weekStart(now) : '0000-00-00';
  const { results } = await env.DB.prepare(
    `SELECT u.handle AS handle, SUM(d.jobs) AS jobs, SUM(d.tokens) AS tokens, SUM(d.seconds) AS seconds, SUM(d.jobs > 0) AS activeDays
       FROM days d JOIN users u ON u.id = d.user_id
      WHERE d.day >= ?
      GROUP BY d.user_id
      HAVING jobs > 0 OR tokens > 0 OR seconds > 0`,
  ).bind(from).all();
  const rows = results.map((r) => ({ handle: r.handle, jobs: r.jobs, tokens: r.tokens, seconds: r.seconds, activeDays: r.activeDays }));
  const top = (metric) => rows
    .toSorted((a, b) => b[metric] - a[metric] || b.activeDays - a.activeDays || a.handle.localeCompare(b.handle))
    .slice(0, LIMITS.boardRows)
    .map((r, i) => ({ rank: i + 1, ...r }));
  return json(
    { period, since: period === 'week' ? from : null, players: rows.length, jobs: top('jobs'), tokens: top('tokens'), time: top('seconds'), at: now },
    200,
    { 'cache-control': 'public, max-age=60' },
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const now = Date.now();
    try {
      if (request.method === 'GET' && url.pathname === '/v1/board') return await board(url, env, now);
      if (request.method === 'POST' && url.pathname === '/v1/claim') return await claim(request, env, now);
      if (request.method === 'PUT' && url.pathname === '/v1/days') return await putDays(request, env, now);
      if (request.method === 'DELETE' && url.pathname === '/v1/days') {
        const user = await who(request, env);
        if (!user) return fail(401, 'Unknown secret.');
        await env.DB.prepare('DELETE FROM days WHERE user_id = ?').bind(user.id).run();
        return json({ ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/v1/invites') return await createInvite(request, env, now);
      if (request.method === 'POST' && url.pathname === '/v1/invites/redeem') return await redeem(request, env, now);
      if (request.method === 'GET' && url.pathname === '/v1/links') {
        const user = await who(request, env);
        if (!user) return fail(401, 'Unknown secret.');
        return json({ links: (await linksOf(env.DB, user.id)).map((l) => l.view) });
      }
      const linkPath = /^\/v1\/links\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (request.method === 'DELETE' && linkPath) return await unlink(linkPath[1], request, env);
      if (request.method === 'GET' && url.pathname === '/v1/socket') return await socket(request, env);
      if (url.pathname === '/v1/me') {
        const user = await who(request, env);
        if (!user) return fail(401, 'Unknown secret.');
        if (request.method === 'GET') return json({ handle: user.handle });
        if (request.method === 'DELETE') return await forgetMe(user, env);
      }
      if (url.pathname === '/' && request.method === 'GET') return json({ name: 'agent-office-leaderboard', ok: true });
      return fail(404, 'Not found.');
    } catch (err) {
      if (err.status === 413) return fail(413, `Too big: ${LIMITS.bodyBytes / 1000} KB at most.`);
      console.error(err);
      return fail(500, 'Something broke on our side.');
    }
  },

  // Hourly: drop spent throttle counters and expired invites.
  async scheduled(_event, env) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM throttles WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM invites WHERE expires_at <= ?').bind(now),
    ]);
  },
};
