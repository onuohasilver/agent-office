// The Agent Office leaderboard: a Cloudflare Worker over D1.
//
// It keeps a claimed handle and, per UTC day, a count of jobs completed,
// tokens used and seconds of agent time. Nothing else is accepted. A user is identified by the hash of a
// secret their office made up; the secret itself is never stored.
//
//   POST   /v1/claim   { handle }                    Authorization: Bearer <secret>
//   PUT    /v1/days    { days: [{ day, jobs, tokens, seconds }] }
//   GET    /v1/me                                   who the secret belongs to
//   DELETE /v1/me                                   forget me
//   GET    /v1/board?period=week|all                public, cached for a minute

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,19}$/i;
const RESERVED = new Set(['admin', 'administrator', 'anthropic', 'claude', 'office', 'agent-office', 'chief', 'staff', 'support', 'system', 'root', 'null', 'undefined']);

// A day no honest office reaches. Rejecting beats clamping: a clamped number
// still looks earned.
export const LIMITS = { jobsPerDay: 500, tokensPerDay: 500_000_000, secondsPerDay: 1_000_000, daysBack: 14, daysAhead: 1, daysPerSync: 15, minSyncGapMs: 20_000, claimsPerHour: 10, boardRows: 50 };

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const fail = (status, error) => json({ error }, status);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

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

async function readJson(request) {
  const text = await request.text();
  if (text.length > 20_000) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function claim(request, env, now) {
  const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('authorization') || '');
  if (!m) return fail(401, 'Missing secret.');
  const body = await readJson(request);
  const handle = String(body?.handle ?? '').trim();
  if (!HANDLE_RE.test(handle)) return fail(400, 'A handle is 3 to 20 letters, numbers, - or _.');
  if (RESERVED.has(handle.toLowerCase())) return fail(409, 'That handle is taken.');

  const bucket = await sha256(`${request.headers.get('cf-connecting-ip') || 'unknown'}|${Math.floor(now / 3_600_000)}`);
  const seen = await env.DB.prepare(
    'INSERT INTO claims (bucket, n) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n',
  ).bind(bucket).first();
  if (seen.n > LIMITS.claimsPerHour) return fail(429, 'Too many tries. Wait a while.');

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
      if (url.pathname === '/v1/me') {
        const user = await who(request, env);
        if (!user) return fail(401, 'Unknown secret.');
        if (request.method === 'GET') return json({ handle: user.handle });
        if (request.method === 'DELETE') {
          await env.DB.batch([
            env.DB.prepare('DELETE FROM days WHERE user_id = ?').bind(user.id),
            env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
          ]);
          return json({ ok: true });
        }
      }
      if (url.pathname === '/' && request.method === 'GET') return json({ name: 'agent-office-leaderboard', ok: true });
      return fail(404, 'Not found.');
    } catch (err) {
      console.error(err);
      return fail(500, 'Something broke on our side.');
    }
  },
};
