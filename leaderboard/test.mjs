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

const a = secret(), b = secret(), c = secret();
// Whatever happens, take the test's handles off the service, so a failed run
// against a real deployment leaves nothing on the public board.
const cleanup = () => Promise.allSettled([a, b, c].map((key) => call('DELETE', '/v1/me', { key })));
process.on('uncaughtException', async (err) => {
  console.error(err);
  await cleanup();
  process.exit(1);
});
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

r = await call('POST', '/v1/claim', { key: b, body: { handle: B, pad: 'x'.repeat(30_000) } });
check('a body over 20 KB is refused', r.status === 413, JSON.stringify(r));
r = await fetch(BASE + '/v1/claim', { method: 'POST', headers: { authorization: `Bearer ${b}`, 'content-type': 'application/json' }, duplex: 'half',
  body: new ReadableStream({ start(c) { for (let i = 0; i < 3; i++) c.enqueue(new TextEncoder().encode('x'.repeat(10_000))); c.close(); } }) });
check('so is one that only turns out to be', r.status === 413, String(r.status));

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

r = await call('DELETE', '/v1/days', { key: a });
check('leaving the board drops the counters', r.status === 200, JSON.stringify(r));
r = await call('GET', '/v1/board?period=all');
check('and only them', !mine(r.body.jobs, A) && (await call('GET', '/v1/me', { key: a })).body?.handle === A);

// ---------- linked offices ----------

const WS = BASE.replace(/^http/, 'ws') + '/v1/socket';
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
// A socket that keeps every frame, and waits for one that matches.
function open(key) {
  const ws = new WebSocket(WS, { headers: { authorization: `Bearer ${key}` } });
  ws.frames = [];
  ws.closed = null;
  ws.addEventListener('message', (e) => ws.frames.push(JSON.parse(e.data)));
  ws.addEventListener('close', (e) => { ws.closed = e.code; });
  ws.next = async (match, ms = 3000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) {
      const i = ws.frames.findIndex(match);
      if (i >= 0) return ws.frames.splice(i, 1)[0];
    }
    return null;
  };
  ws.put = (frame) => ws.send(JSON.stringify(frame));
  return new Promise((res, rej) => { ws.addEventListener('open', () => res(ws)); ws.addEventListener('error', rej); });
}
const isErr = (f) => f.t === 'error';

const C = `cy-${tag}`;
await call('POST', '/v1/claim', { key: c, body: { handle: C } });

r = await call('POST', '/v1/invites', { key: a, body: { kind: 'party' } });
check('an invite has a kind', r.status === 400, JSON.stringify(r));
r = await call('POST', '/v1/invites', { key: a, body: { kind: 'link' } });
const inv = r.body;
check('makes a link invite', r.status === 201 && /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(inv.code) && inv.id && Math.abs(inv.expiresAt - Date.now() - 86_400_000) < 60_000, JSON.stringify(r));
r = await call('POST', '/v1/invites/redeem', { key: a, body: { code: inv.code } });
check('your own code is refused', r.status === 400, JSON.stringify(r));

let sa = await open(a);
let sb = await open(b);
let f = await sa.next((f) => f.t === 'links');
check('a socket opens with its links', f && Array.isArray(f.links) && f.links.length === 0, JSON.stringify(f));
check('a socket needs a claimed handle', await open(secret()).then((ws) => { ws.close(); return false; }, () => true));

// Lower case, spaced, and 0/1 written as O/L: still the same code.
const messy = inv.code.toLowerCase().replace('-', ' ').replace(/0/g, 'o').replace(/1/g, 'l');
r = await call('POST', '/v1/invites/redeem', { key: b, body: { code: messy } });
const link = r.body?.link;
check('redeeming a messy code links', r.status === 201 && link?.peer === A && link.kind === 'link' && link.role === 'peer' && !('invite' in link), JSON.stringify(r));
f = await sa.next((f) => f.t === 'link');
check('the inviter hears of it, with the invite id', f?.link.id === link?.id && f.link.peer === B && f.link.invite === inv.id, JSON.stringify(f));
f = await sb.next((f) => f.t === 'link');
check('so does the redeemer, without it', f?.link.id === link?.id && !('invite' in f.link), JSON.stringify(f));
check('both are asked for presence', !!(await sa.next((f) => f.t === 'want-presence')) && !!(await sb.next((f) => f.t === 'want-presence')));
r = await call('POST', '/v1/invites/redeem', { key: c, body: { code: inv.code } });
check('a code works once', r.status === 404, JSON.stringify(r));
r = await call('POST', '/v1/invites', { key: a, body: { kind: 'link' } });
r = await call('POST', '/v1/invites/redeem', { key: b, body: { code: r.body.code } });
check('linking twice is refused', r.status === 409, JSON.stringify(r));

sa.put({ t: 'presence', all: true, agents: [{ id: 'tunde', name: 'Tunde', state: 'working' }] });
f = await sb.next((f) => f.t === 'presence');
check('presence reaches the peer, stamped', f?.from === A && f.link === link?.id && !('all' in f) && f.agents?.[0]?.name === 'Tunde', JSON.stringify(f));
sb.put({ t: 'presence', all: true, agents: [], from: 'someone-else' });
f = await sa.next((f) => f.t === 'presence');
check('a claimed from is overwritten', f?.from === B, JSON.stringify(f));

sb.close();
f = await sa.next((f) => f.t === 'presence' && f.agents.length === 0);
check('a peer that goes away empties its presence', f?.from === B, JSON.stringify(f));
sb = await open(b);
f = await sb.next((f) => f.t === 'links');
check('reconnecting lists the link', f?.links?.length === 1 && f.links[0].id === link?.id, JSON.stringify(f));
f = await sb.next((f) => f.t === 'presence');
check('and replays the peer’s last presence', f?.from === A && f.agents?.[0]?.id === 'tunde', JSON.stringify(f));

sa.put({ t: 'presence', link: 'not-a-link', agents: [] });
check('a link you are not on is refused', /Not on that link/.test((await sa.next(isErr))?.error));
sa.put({ t: 'req', link: link?.id, id: '1', op: 'createJob', args: {} });
check('requests only go guest to host', /can't send req/.test((await sa.next(isErr))?.error));
sa.put({ t: 'gossip', link: link?.id });
check('unknown frames are refused', /Unknown frame/.test((await sa.next(isErr))?.error));
sa.put({ t: 'req', all: true });
check('only presence goes to all', /Only presence/.test((await sa.next(isErr))?.error));
sa.put({ t: 'presence', link: link?.id, agents: [], pad: 'x'.repeat(70 * 1024) });
check('a frame over 64 KB is refused', /too big/.test((await sa.next(isErr))?.error));
sa.send('{"t":"ping"}');
check('ping is answered', !!(await sa.next((f) => f.t === 'pong')));
sa.frames.length = 0;
for (let i = 0; i < 90; i++) sa.send('{}');
await sleep(500);
check('a flood is slowed', sa.frames.some((f) => isErr(f) && /Too many frames/.test(f.error)), JSON.stringify(sa.frames.slice(-2)));
await sleep(3500); // let the bucket refill
sa.frames.length = 0;

r = await call('POST', '/v1/invites', { key: a, body: { kind: 'guest' } });
const ginv = r.body;
r = await call('POST', '/v1/invites/redeem', { key: c, body: { code: ginv.code } });
const glink = r.body?.link;
check('a guest invite links as guest', r.status === 201 && glink?.role === 'guest' && glink.kind === 'guest' && glink.peer === A, JSON.stringify(r));
r = await call('GET', '/v1/links', { key: a });
const hostSide = r.body?.links?.find((l) => l.id === glink?.id);
check('the host lists both links', r.body?.links?.length === 2 && hostSide?.role === 'host' && hostSide.invite === ginv.id, JSON.stringify(r.body));
const sc = await open(c);
check('the guest gets the host’s presence on connect', (await sc.next((f) => f.t === 'presence'))?.from === A);
sc.put({ t: 'req', link: glink?.id, id: 'r1', op: 'createJob', args: { title: 'hi' } });
f = await sa.next((f) => f.t === 'req');
check('a guest request reaches the host', f?.from === C && f.link === glink?.id && f.op === 'createJob', JSON.stringify(f));
sc.put({ t: 'feed', link: glink?.id, msg: {} });
check('a guest can’t send the feed', /can't send feed/.test((await sc.next(isErr))?.error));
sa.put({ t: 'res', link: glink?.id, id: 'r1', ok: true, body: { job: 'j1' } });
f = await sc.next((f) => f.t === 'res');
check('the host answers', f?.from === A && f.ok === true && f.body?.job === 'j1', JSON.stringify(f));
sa.put({ t: 'feed', link: glink?.id, msg: { t: 'job' } });
check('the host feeds the guest', (await sc.next((f) => f.t === 'feed'))?.from === A);
check('a peer never sees the guest link', !sb.frames.some((f) => f.link === glink?.id || f.link?.id === glink?.id));

r = await call('DELETE', `/v1/links/${link?.id}`, { key: c });
check('only the two offices can unlink', r.status === 404, JSON.stringify(r));
r = await call('DELETE', `/v1/links/${link?.id}`, { key: b });
check('unlinking', r.status === 200, JSON.stringify(r));
check('both sides hear of it', (await sa.next((f) => f.t === 'unlink'))?.link?.id === link?.id && (await sb.next((f) => f.t === 'unlink'))?.link?.id === link?.id);
sa.put({ t: 'presence', link: link?.id, agents: [] });
check('and the link is closed', /Not on that link/.test((await sa.next(isErr))?.error));

let tries = [];
for (let i = 0; i < 5; i++) tries.push((await call('POST', '/v1/invites/redeem', { key: c, body: { code: 'ZZZZ-ZZZZ' } })).status);
check('guessing codes is slowed', tries.includes(429), JSON.stringify(tries));
tries = [];
for (let i = 0; i < 22; i++) tries.push((await call('POST', '/v1/invites', { key: b, body: { kind: 'link' } })).status);
check('20 open invites at most', tries.filter((s) => s === 201).length === 20 && tries.at(-1) === 429, JSON.stringify(tries));

const sa2 = await open(a);
await sleep(300);
check('a second socket replaces the first', sa.closed === 4000, String(sa.closed));
r = await call('DELETE', '/v1/me', { key: c });
check('deleting an office unlinks its peers', (await sa2.next((f) => f.t === 'unlink'))?.link?.id === glink?.id);
await sleep(300);
check('and closes its socket', sc.closed === 4001, String(sc.closed));
r = await call('GET', '/v1/links', { key: a });
check('and its links are gone', r.body?.links?.length === 0, JSON.stringify(r.body));
for (const ws of [sa2, sb]) ws.close();

r = await call('DELETE', '/v1/me', { key: a });
check('delete forgets me', r.status === 200);
r = await call('GET', '/v1/board?period=all');
check('and I am off the board', !mine(r.body.jobs, A) && !mine(r.body.tokens, A));
r = await call('GET', '/v1/me', { key: a });
check('and my secret no longer works', r.status === 401);
await cleanup();

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
