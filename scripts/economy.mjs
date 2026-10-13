#!/usr/bin/env node
// The office economy's books: pay, the pot's cut, the shop and milestones.
// No server, no tokens; it drives server/economy.js directly.

import assert from 'node:assert/strict';
import { Economy, emptyBooks } from '../server/economy.js';
import { PAY, split } from '../shared/shop.js';

let now = Date.parse('2026-10-13T12:00:00Z');
const make = () => new Economy(emptyBooks(), { now: () => now });
const job = (over = {}) => ({ id: 'j' + Math.random().toString(36).slice(2, 7), agentId: 'mira', title: 'A job', model: 'sonnet', status: 'done', ...over });
let n = 0, failed = 0;
const test = (name, fn) => {
  n++;
  try { fn(); console.log(`ok ${n} ${name}`); }
  catch (err) { failed++; console.log(`not ok ${n} ${name}\n  ${String(err.message).split('\n').join('\n  ')}`); }
};

// Every coin is accounted for: what's in the wallets and the pot is what was
// earned, less what was spent.
function balanced(e) {
  const earned = e.books.ledger.filter((x) => x.gross).reduce((a, x) => a + x.gross, 0);
  const spent = e.books.ledger.filter((x) => x.kind === 'buy').reduce((a, x) => a + x.price, 0);
  const held = e.books.pot + Object.values(e.books.wallets).reduce((a, x) => a + x, 0);
  assert.equal(held, earned - spent);
}

test('split keeps 60% and always adds up', () => {
  for (const g of [0, 1, 7, 25, 99, 100, 1234]) {
    const s = split(g);
    assert.equal(s.agent + s.pot, g);
    assert.equal(s.agent, Math.floor(g * (1 - PAY.potShare)));
  }
});

test('a finished job pays by the active minute, scaled by model', () => {
  const e = make();
  const j = job({ model: 'sonnet' });
  e.accrue(j, 4 * 60000, 'sonnet');
  const { pay } = e.pay(j);
  const gross = Math.round(4 * 1.75 * PAY.perMinute + PAY.finishBonus * 1.75);
  assert.equal(pay.gross, gross);
  assert.equal(pay.agent + pay.pot, gross);
  assert.equal(j.payMinutes, 0);
  balanced(e);
});

test('the same work earns more on a lighter model', () => {
  const run = (model) => { const e = make(); const j = job({ model }); e.accrue(j, 5 * 60000, model); return e.pay(j).pay.gross; };
  assert.ok(run('haiku') > run('sonnet'));
  assert.ok(run('sonnet') > run('claude-opus-5-5'));
});

test('minutes past the cap are not paid', () => {
  const e = make();
  const long = job({ model: 'opus' });
  e.accrue(long, 600 * 60000, 'opus');
  const q = e.quote(long);
  assert.equal(Math.round(q.wage), PAY.maxMinutes * PAY.perMinute);
});

test('milestones pay once and a streak counts days', () => {
  const e = make();
  const first = e.pay(job());
  assert.deepEqual(first.achievements.map((a) => a.id), ['first-job']);
  assert.equal(e.pay(job()).achievements.length, 0);
  now += 86400000; e.pay(job());
  now += 86400000; const third = e.pay(job());
  assert.ok(third.achievements.some((a) => a.id === 'streak-3'));
  balanced(e);
});

test('agents buy for their own desk only, and not twice', () => {
  const e = make();
  assert.throws(() => e.buy('duck', { by: 'mira' }), /costs 30/);
  e.books.wallets.mira = 100;
  const r = e.buy('duck', { by: 'mira' });
  assert.equal(e.wallet('mira'), 70 + split(15).agent); // the duck, then the shopper bonus
  assert.deepEqual(e.books.desks.mira, ['duck']);
  assert.ok(r.achievements.some((a) => a.id === 'shopper'));
  assert.throws(() => e.buy('duck', { by: 'mira' }), /already/);
  assert.throws(() => e.buy('arcade', { by: 'mira' }), /only the boss/);
});

test('the boss buys from the pot, for a desk or the office', () => {
  const e = make();
  e.books.pot = 600;
  e.buy('cat', { by: 'boss', forAgent: 'amara' });
  assert.equal(e.books.pot, 200);
  assert.deepEqual(e.books.desks.amara, ['cat']);
  assert.equal(e.wallet('amara'), 0);
  assert.throws(() => e.buy('neon', { by: 'boss' }), /pot has 200/);
  assert.throws(() => e.buy('lamp', { by: 'boss' }), /whose desk/);
});

test('a bought look goes into use, and only owned looks can be used', () => {
  const e = make();
  assert.throws(() => e.use('layout-pods'), /doesn't own/);
  e.books.pot = 5000;
  e.buy('layout-pods', { by: 'boss' });
  assert.equal(e.books.using.layout, 'layout-pods');
  e.use('layout-classic');
  assert.equal(e.books.using.layout, 'layout-classic');
  assert.throws(() => e.use('arcade'), /floor, wall or layout/);
});

test('kudos pays once, only on a finished job', () => {
  const e = make();
  const j = job({ model: 'haiku' });
  const r = e.kudos(j);
  assert.equal(r.pay.gross, PAY.finishBonus * 3);
  assert.throws(() => e.kudos(j), /already/);
  assert.throws(() => e.kudos(job({ status: 'failed' })), /finished/);
  assert.throws(() => e.kudos(job({ awaitingBoss: true })), /finished/);
  balanced(e);
});

test('old state without books is filled in', () => {
  const books = { pot: 12 };
  const e = new Economy(books);
  assert.equal(e.books.pot, 12);
  assert.deepEqual(e.books.using, { floor: 'floor-oak', wall: 'wall-cream', layout: 'layout-classic' });
  assert.ok(Array.isArray(books.ledger));
});

// Adversarial pass (Tolu). Each of these is a way to make coins appear,
// count twice, or stop the books being checkable.

test('a job reopened by a reply pays its new minutes, not a second finish bonus', () => {
  // finish() calls payday() each time the job ends done, and a boss reply or
  // a colleague's message_colleague reopens a recently finished job. A
  // one-word "thanks!" on a Haiku job paid 76 coins again in a live office.
  const e = make();
  const j = job({ model: 'haiku' });
  e.accrue(j, 3 * 60000, 'haiku');
  e.pay(j);
  e.accrue(j, 1000, 'haiku'); // the reopened turn: one second
  const again = e.pay(j);
  const wage = Math.round((1000 / 60000) * 3 * PAY.perMinute);
  assert.equal(again.pay?.gross || 0, wage, 'the finish bonus was paid a second time');
  assert.equal(e.statsOf('mira').jobs, 1, 'one job counted as two');
  balanced(e);
});

test('reopening a job cannot farm job-count milestones', () => {
  const e = make();
  const j = job({ model: 'haiku' });
  for (let i = 0; i < 10; i++) { e.accrue(j, 1000, 'haiku'); e.pay(j); }
  const have = e.books.achievements.mira || [];
  assert.ok(!have.includes('ten-jobs'), 'Regular unlocked by one job and nine replies');
  assert.ok(!have.includes('haiku-hero'), 'Haiku hero unlocked by one job and four replies');
});

test('kudos stays once per job after the kudos list is trimmed', () => {
  const e = make();
  const first = job();
  e.kudos(first);
  for (let i = 0; i < 2000; i++) e.kudos(job());
  assert.throws(() => e.kudos(first), /already/, 'kudos paid twice for one job once 2000 more were given');
});

test('the books still add up after the ledger is trimmed', () => {
  // wallets + pot must equal everything earned less everything spent. The
  // ledger keeps the last 400 lines and nothing else keeps a running total of
  // what was spent, so after that the books can no longer be checked.
  const e = make();
  for (let i = 0; i < 300; i++) {
    const j = job();
    e.accrue(j, 60000, 'sonnet');
    e.pay(j);
    e.books.desks.mira = []; // so the mug can be bought again
    if (e.wallet('mira') >= 20) e.buy('mug', { by: 'mira' });
  }
  const t = e.books.totals;
  assert.ok(t, 'no running totals in the books (earned, spent) to check against');
  const held = e.books.pot + Object.values(e.books.wallets).reduce((a, x) => a + x, 0);
  assert.equal(held, t.earned - t.spent);
});

test('damaged books from an old or hand-edited state.json load safely', () => {
  // typeof null and typeof [] are both 'object', and NaN is a number, so the
  // shape check in the constructor lets these through.
  const e = new Economy({ wallets: null, stats: null, desks: [], ledger: {}, pot: NaN, kudos: {} });
  assert.equal(e.wallet('mira'), 0);
  assert.ok(Number.isFinite(e.books.pot), `pot is ${e.books.pot}`);
  const j = job();
  e.accrue(j, 60000, 'opus');
  e.pay(j);
  e.kudos(job());
  assert.ok(Array.isArray(e.books.ledger));
  assert.ok(Number.isFinite(e.books.pot));
});

test('the rich list ranks by wallet plus desk, ties by lifetime earnings', () => {
  const e = make();
  for (const id of ['mira', 'val']) { const j = { ...job(), agentId: id }; e.accrue(j, 600000, 'sonnet'); e.pay(j); }
  const j2 = { ...job(), agentId: 'val' }; e.accrue(j2, 600000, 'sonnet'); e.pay(j2);
  const before = e.richList();
  assert.equal(before[0].id, 'val');
  e.buy('mug', { by: 'val' });
  const after = e.richList().find((r) => r.id === 'val');
  assert.ok(after.worth >= before[0].worth, 'buying for the desk should not lower net worth (a first purchase may pay a bonus)');
  assert.equal(after.desk, 20);
  assert.deepEqual(e.status().rich.map((r) => r.id), e.richList().map((r) => r.id));
});

console.log(`\n${n - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
