#!/usr/bin/env node
// The office economy's books: pay, the pot's cut, the shop and milestones.
// No server, no tokens; it drives server/economy.js directly.

import assert from 'node:assert/strict';
import { Economy, emptyBooks } from '../server/economy.js';
import { PAY, split } from '../shared/shop.js';

let now = Date.parse('2026-10-13T12:00:00Z');
const make = () => new Economy(emptyBooks(), { now: () => now });
const job = (over = {}) => ({ id: 'j' + Math.random().toString(36).slice(2, 7), agentId: 'mira', title: 'A job', model: 'sonnet', status: 'done', ...over });
let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };

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

console.log(`\n${n} passed`);
