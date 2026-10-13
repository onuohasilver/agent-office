#!/usr/bin/env node
// The office economy's team goal and agent-to-agent bets. No server, no
// tokens; it drives server/economy.js directly. Every test ends by checking
// that the books still add up: wallets + pot + escrow = earned - spent.

import assert from 'node:assert/strict';
import { Economy, emptyBooks, BET } from '../server/economy.js';

let now = Date.parse('2026-10-13T12:00:00Z');
const make = (books = emptyBooks()) => new Economy(books, { now: () => now });
let seq = 0;
const job = (over = {}) => ({ id: 'j' + ++seq, agentId: 'val', title: 'A job', model: 'sonnet', status: 'done', startedAt: now, ...over });
const fund = (e, id, v) => { e.books.wallets[id] = (e.books.wallets[id] || 0) + v; e.books.totals.earned += v; };
let n = 0, failed = 0;
const test = (name, fn) => {
  n++;
  try { fn(); console.log(`ok ${n} ${name}`); }
  catch (err) { failed++; console.log(`not ok ${n} ${name}\n  ${String(err.message).split('\n').join('\n  ')}`); }
};
function balanced(e) {
  const b = e.books;
  const held = b.pot + Object.values(b.wallets).reduce((a, x) => a + x, 0) + b.escrow;
  assert.equal(held, b.totals.earned - b.totals.spent, 'the books do not add up');
  for (const [id, w] of Object.entries(b.wallets)) assert.ok(w >= 0, `${id} went negative: ${w}`);
  const locked = b.bets.filter((x) => x.state === 'open').reduce((a, x) => a + x.stake, 0) + b.bets.filter((x) => x.state === 'live').reduce((a, x) => a + 2 * x.stake, 0);
  assert.equal(b.escrow, locked, 'escrow is not what the open bets hold');
}
// A job for `id` that ran `min` active minutes, paid as the server would.
const run = (e, id, min, over = {}) => { const j = job({ agentId: id, ...over }); e.accrue(j, min * 60000, 'sonnet'); return { j, r: e.pay(j) }; };
const live = (e, { stake = 1000, minutes = 10, subject = 'val' } = {}) => {
  const bet = e.offerBet({ by: 'amara', subject, minutes, stake });
  e.takeBet(bet.id, { by: 'obi' });
  now += 1000;
  return bet;
};
const rig = () => { const e = make(); fund(e, 'amara', 10000); fund(e, 'obi', 10000); return e; };

// ---- team goal

test('the boss sets a goal and progress follows the pot', () => {
  const e = make();
  e.books.pot = 1000000;
  const g = e.setGoal({ name: 'Pool party', target: 5000000 });
  assert.equal(g.name, 'Pool party');
  assert.equal(g.progress, 0.2);
  assert.ok(e.books.ledger.some((x) => x.kind === 'goal' && x.phase === 'set'));
  assert.equal(e.status().goal.target, 5000000);
});

test('a goal needs a name, a sane target, and a pot still short of it', () => {
  const e = make();
  e.books.pot = 5000;
  assert.throws(() => e.setGoal({ name: '  ', target: 9000 }), /name/);
  assert.throws(() => e.setGoal({ name: 'x', target: 'lots' }), /at least/);
  assert.throws(() => e.setGoal({ name: 'x', target: -5 }), /at least/);
  assert.throws(() => e.setGoal({ name: 'x', target: 1e12 }), /at most/);
  assert.throws(() => e.setGoal({ name: 'x', target: 5000 }), /already has/);
  assert.equal(e.status().goal, null);
});

test('reaching the goal is recorded once and not again when the pot is spent and refilled', () => {
  const e = make();
  e.books.pot = 1000;
  e.setGoal({ name: 'Pool party', target: 5000 });
  fund(e, 'val', 0);
  const reached = () => e.books.ledger.filter((x) => x.kind === 'goal' && x.phase === 'reached');
  run(e, 'val', 1); // small: well under target
  assert.equal(reached().length, 0);
  e.books.pot = 4999;
  run(e, 'val', 3);
  assert.equal(reached().length, 1);
  assert.equal(e.status().goal.progress, 1);
  assert.ok(e.status().goal.reachedAt);
  e.books.pot = 0; // the boss spends it all in the shop
  for (let i = 0; i < 8; i++) run(e, 'val', 5);
  assert.equal(reached().length, 1, 'the goal celebrated twice');
  assert.equal(e.books.goalsDone.length, 1);
});

test('a new goal after a reached one can be reached on its own', () => {
  const e = make();
  e.books.pot = 100;
  e.setGoal({ name: 'One', target: 2000 });
  run(e, 'val', 5);
  e.books.pot = 3000;
  run(e, 'val', 1);
  e.setGoal({ name: 'Two', target: 9000 });
  assert.equal(e.status().goal.reachedAt, null);
  e.books.pot = 9500;
  run(e, 'val', 1);
  assert.equal(e.books.goalsDone.length, 2);
});

test('clearing a goal leaves nothing to reach', () => {
  const e = make();
  e.setGoal({ name: 'Pool party', target: 5000 });
  e.clearGoal();
  e.books.pot = 99999;
  run(e, 'val', 5);
  assert.equal(e.status().goal, null);
  assert.ok(!e.books.ledger.some((x) => x.phase === 'reached'));
});

test('old books and damaged goal fields load safely', () => {
  const e = make({ pot: 5, goal: null, bets: {}, escrow: NaN, goalsDone: 'x' });
  assert.deepEqual(e.books.goal, {});
  assert.deepEqual(e.books.bets, []);
  assert.equal(e.books.escrow, 0);
  assert.equal(e.status().goal, null);
});

// ---- bets

test('an offer locks the stake out of the wallet, and a take locks the match', () => {
  const e = rig();
  const bet = e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: 1500 });
  assert.equal(e.wallet('amara'), 8500);
  assert.equal(e.books.escrow, 1500);
  e.takeBet(bet.id, { by: 'obi' });
  assert.equal(e.wallet('obi'), 8500);
  assert.equal(e.books.escrow, 3000);
  assert.equal(bet.state, 'live');
  balanced(e);
});

test('wallets never go negative and stakes are capped', () => {
  const e = rig();
  assert.throws(() => e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: BET.maxStake + 1 }), /between/);
  assert.throws(() => e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: BET.minStake - 1 }), /between/);
  assert.throws(() => e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: -500 }), /between/);
  assert.throws(() => e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: NaN }), /between/);
  assert.throws(() => e.offerBet({ by: 'poor', subject: 'val', minutes: 10, stake: 500 }), /more than/);
  const bet = e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: 5000 });
  e.books.wallets.obi = 4999; e.books.totals.earned -= 5001; // obi is now just short
  assert.throws(() => e.takeBet(bet.id, { by: 'obi' }), /more than/);
  assert.equal(e.wallet('obi'), 4999);
  assert.equal(bet.state, 'open');
  balanced(e);
});

test('nobody bets on their own job, against themselves, or on a silly time', () => {
  const e = rig();
  assert.throws(() => e.offerBet({ by: 'val', subject: 'val', minutes: 10, stake: 500 }), /own job/);
  assert.throws(() => e.offerBet({ by: 'amara', subject: 'val', minutes: 0, stake: 500 }), /minutes/);
  assert.throws(() => e.offerBet({ by: 'amara', subject: 'val', minutes: 9999, stake: 500 }), /minutes/);
  const bet = e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: 500 });
  assert.throws(() => e.takeBet(bet.id, { by: 'amara' }), /your own/);
  fund(e, 'val', 5000);
  assert.throws(() => e.takeBet(bet.id, { by: 'val' }), /own job/);
  assert.throws(() => e.takeBet('nope', { by: 'obi' }), /not open/);
  balanced(e);
});

test('a few bets at a time per agent', () => {
  const e = rig();
  for (let i = 0; i < BET.maxOpen; i++) e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: 100 });
  assert.throws(() => e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: 100 }), /already have/);
  balanced(e);
});

test('a job under the time wins both stakes for the backer, with no cut', () => {
  const e = rig();
  const bet = live(e, { minutes: 10 });
  const before = e.books.pot;
  run(e, 'val', 4, { startedAt: now });
  assert.equal(bet.state, 'won');
  assert.equal(bet.winner, 'amara');
  assert.equal(e.wallet('amara'), 11000);
  assert.equal(e.wallet('obi'), 9000);
  assert.equal(e.books.escrow, 0);
  assert.ok(e.books.pot > before); // only the job's own pay moved the pot
  balanced(e);
});

test('a job at or over the time pays the doubter', () => {
  const e = rig();
  const bet = live(e, { minutes: 5 });
  run(e, 'val', 5, { startedAt: now }); // exactly N is not under N
  assert.equal(bet.state, 'lost');
  assert.equal(bet.winner, 'obi');
  assert.equal(e.wallet('obi'), 11000);
  balanced(e);
});

test('it settles once: a reopened job cannot settle or pay a bet again', () => {
  const e = rig();
  const bet = live(e, { minutes: 5 });
  const { j } = run(e, 'val', 2, { startedAt: now });
  assert.equal(bet.state, 'won');
  const w = e.wallet('amara');
  e.accrue(j, 30 * 60000, 'sonnet');
  e.pay(j);
  assert.equal(e.wallet('amara'), w);
  assert.equal(e.books.ledger.filter((x) => x.kind === 'bet' && x.phase === 'won').length, 1);
  balanced(e);
});

test('a job already running when the bet was taken does not count', () => {
  const e = rig();
  const started = now - 60000;
  const bet = live(e, { minutes: 5 });
  run(e, 'val', 1, { startedAt: started });
  assert.equal(bet.state, 'live');
  run(e, 'val', 9, { startedAt: now }); // the next job
  assert.equal(bet.state, 'lost');
  balanced(e);
});

test('other agents jobs do not settle the bet', () => {
  const e = rig();
  const bet = live(e);
  run(e, 'mira', 1, { startedAt: now });
  assert.equal(bet.state, 'live');
  balanced(e);
});

test('a failed, stopped or cancelled job voids the bet and refunds both', () => {
  const e = rig();
  const bet = live(e);
  e.voidBets(job({ agentId: 'val', startedAt: now }), 'stopped');
  assert.equal(bet.state, 'void');
  assert.equal(e.wallet('amara'), 10000);
  assert.equal(e.wallet('obi'), 10000);
  e.voidBets(job({ agentId: 'val', startedAt: now }));
  assert.equal(e.wallet('amara'), 10000, 'a void paid out twice');
  balanced(e);
});

test('a job with no recorded working time voids rather than handing the backer a free win', () => {
  const e = rig();
  const bet = live(e);
  e.pay(job({ agentId: 'val', startedAt: now })); // nothing accrued
  assert.equal(bet.state, 'void');
  assert.equal(e.wallet('amara'), 10000);
  balanced(e);
});

test('an offer nobody takes can be taken back, only by its maker or the boss', () => {
  const e = rig();
  const a = e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: 700 });
  assert.throws(() => e.cancelBet(a.id, { by: 'obi' }), /Only whoever/);
  e.cancelBet(a.id, { by: 'amara' });
  assert.equal(e.wallet('amara'), 10000);
  assert.throws(() => e.takeBet(a.id, { by: 'obi' }), /not open/);
  const b = e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: 700 });
  e.cancelBet(b.id, { by: 'boss' });
  const c = live(e);
  assert.throws(() => e.cancelBet(c.id, { by: 'amara' }), /not open/, 'a taken bet was cancelled');
  balanced(e);
});

test('stale bets expire and refund', () => {
  const e = rig();
  const open = e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: 500 });
  const taken = live(e, { stake: 800 });
  now += BET.openMs + 1;
  e.sweep();
  assert.equal(open.state, 'void');
  assert.equal(taken.state, 'live');
  now += BET.liveMs;
  e.sweep();
  assert.equal(taken.state, 'void');
  assert.equal(e.wallet('amara'), 10000);
  assert.equal(e.wallet('obi'), 10000);
  balanced(e);
});

test('several bets on one job all settle on it', () => {
  const e = rig();
  fund(e, 'mira', 3000);
  const a = live(e, { minutes: 5 });
  const b = e.offerBet({ by: 'mira', subject: 'val', minutes: 20, stake: 500 });
  e.takeBet(b.id, { by: 'obi' });
  now += 1000;
  run(e, 'val', 8, { startedAt: now });
  assert.equal(a.state, 'lost');
  assert.equal(b.state, 'won');
  balanced(e);
});

test('the rich list counts money held in a bet, so staking does not drop an agent down', () => {
  const e = rig();
  const before = e.richList().find((r) => r.id === 'amara').worth;
  e.offerBet({ by: 'amara', subject: 'val', minutes: 10, stake: 2000 });
  assert.equal(e.richList().find((r) => r.id === 'amara').worth, before);
});

test('a lot of bets keep the books balanced and the list short', () => {
  const e = rig();
  for (let i = 0; i < 80; i++) {
    const subject = 'val';
    const bet = e.offerBet({ by: 'amara', subject, minutes: 1 + (i % 12), stake: 100 + (i % 7) * 100 });
    e.takeBet(bet.id, { by: 'obi' });
    now += 1000;
    if (i % 5 === 0) e.voidBets(job({ agentId: subject, startedAt: now }));
    else run(e, subject, i % 15, { startedAt: now });
    fund(e, 'amara', 500); fund(e, 'obi', 500);
  }
  assert.ok(e.books.bets.length <= BET.keep + 3);
  balanced(e);
});

console.log(`\n${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
