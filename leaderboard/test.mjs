#!/usr/bin/env node
// Checks the service end to end. Start it first (`npm run db:local && npm run dev`),
// then: node test.mjs [http://localhost:8787]
// Run it against a fresh local database; it claims handles it can't release
// except by deleting them, which it does at the end.

import crypto from 'node:crypto';
const BASE = process.argv[2] || 'http://localhost:8787';
const secret = () => crypto.randomBytes(32).toString('hex');
const call = async (method, path, { key, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) failed++; };
const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const tag = crypto.randomBytes(3).toString('hex');

const a = secret(), b = secret();
const A = `ada-${tag}`, B = `bo-${tag}`;

let r = await call('POST', '/v1/claim', { key: a, body: { handle: A } });
check('claims a free handle', r.status === 201 && r.body.handle === A, JSON.stringify(r));
r = await call('POST', '/v1/claim', { key: a, body: { handle: A } });
check('claiming again with the same secret is harmless', r.status === 200, JSON.stringify(r));
r = await call('POST', '/v1/claim', { key: b, body: { handle: A.toUpperCase() } });
check('a taken handle is refused, any case', r.status === 409, JSON.stringify(r));
r = await call('POST', '/v1/claim', { key: a, body: { handle: `other-${tag}` } });
check('one secret holds one handle', r.status === 409, JSON.stringify(r));
r = await call('POST', '/v1/claim', { key: b, body: { handle: 'no spaces' } });
check('a bad handle is refused', r.status === 400, JSON.stringify(r));
r = await call('POST', '/v1/claim', { key: b, body: { handle: 'Claude' } });
check('a reserved handle is refused', r.status === 409, JSON.stringify(r));
r = await call('POST', '/v1/claim', { key: 'short', body: { handle: B } });
check('a weak secret is refused', r.status === 401, JSON.stringify(r));
r = await call('POST', '/v1/claim', { key: b, body: { handle: B } });
check('second user claims theirs', r.status === 201, JSON.stringify(r));

r = await call('GET', '/v1/me', { key: a });
check('me knows the handle', r.status === 200 && r.body.handle === A);
r = await call('GET', '/v1/me', { key: secret() });
check('me refuses an unknown secret', r.status === 401);

r = await call('PUT', '/v1/days', { key: a, body: { days: [{ day: day(), jobs: 3, tokens: 12000, seconds: 600 }, { day: day(-1), jobs: 1, tokens: 500, seconds: 60 }] } });
check('accepts days', r.status === 200, JSON.stringify(r));
r = await call('PUT', '/v1/days', { key: a, body: { days: [{ day: day(), jobs: 4, tokens: 15000, seconds: 700 }] } });
check('a second sync inside the gap is slowed', r.status === 429, JSON.stringify(r));
r = await call('PUT', '/v1/days', { key: b, body: { days: [{ day: day(), jobs: 9999, tokens: 1, seconds: 1 }] } });
r = await call('PUT', '/v1/days', { key: b, body: { days: [{ day: day(), jobs: 1, tokens: 1 }] } });
check('a day without agent time is refused', r.status === 400, JSON.stringify(r));
check('absurd jobs are refused', r.status === 400, JSON.stringify(r));
r = await call('PUT', '/v1/days', { key: b, body: { days: [{ day: day(-60), jobs: 1, tokens: 1, seconds: 1 }] } });
check('old days are refused', r.status === 400, JSON.stringify(r));
r = await call('PUT', '/v1/days', { key: b, body: { days: [{ day: day(), jobs: 1, tokens: 1, seconds: 1 }, { day: day(), jobs: 1, tokens: 1, seconds: 1 }] } });
check('a day twice is refused', r.status === 400, JSON.stringify(r));
r = await call('PUT', '/v1/days', { key: b, body: { days: [{ day: '2026-02-30', jobs: 1, tokens: 1, seconds: 1 }] } });
check('an impossible date is refused', r.status === 400, JSON.stringify(r));
r = await call('PUT', '/v1/days', { key: b, body: { days: [{ day: day(), jobs: 1.5, tokens: 1, seconds: 1 }] } });
check('fractions are refused', r.status === 400, JSON.stringify(r));
r = await call('PUT', '/v1/days', { key: secret(), body: { days: [{ day: day(), jobs: 1, tokens: 1, seconds: 1 }] } });
check('sync needs a claimed handle', r.status === 401, JSON.stringify(r));
r = await call('PUT', '/v1/days', { key: b, body: { days: [{ day: day(), jobs: 7, tokens: 99000, seconds: 300 }] } });
check('second user syncs', r.status === 200, JSON.stringify(r));

r = await call('GET', '/v1/board?period=all');
const mine = (list, h) => list.find((p) => p.handle === h);
check('board lists both, ranked by jobs', r.status === 200 && mine(r.body.jobs, B)?.rank < mine(r.body.jobs, A)?.rank, JSON.stringify(r.body).slice(0, 300));
check('board ranks tokens on their own', mine(r.body.tokens, B)?.tokens === 99000 && mine(r.body.tokens, A)?.tokens === 12500, JSON.stringify(mine(r.body.tokens, A)));
check('agent time is ranked on its own', mine(r.body.time, A)?.seconds === 660 && mine(r.body.time, A).rank < mine(r.body.time, B).rank, JSON.stringify(r.body.time));
check('active days are counted', mine(r.body.jobs, A)?.activeDays === 2);
r = await call('GET', '/v1/board?period=week');
check('the weekly board answers', r.status === 200 && r.body.since && Array.isArray(r.body.jobs));

r = await call('DELETE', '/v1/me', { key: a });
check('delete forgets me', r.status === 200);
r = await call('GET', '/v1/board?period=all');
check('and I am off the board', !mine(r.body.jobs, A) && !mine(r.body.tokens, A));
r = await call('GET', '/v1/me', { key: a });
check('and my secret no longer works', r.status === 401);
await call('DELETE', '/v1/me', { key: b });

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
