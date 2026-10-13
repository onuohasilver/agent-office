// The office economy: pay, the office pot, the shop and achievements.
//
// Agents are paid when a job finishes, by the active minute and scaled by the
// model that did the work (see shared/shop.js). Of every naira earned, the
// pot takes its share for the boss to spend on the office; the agent keeps
// the rest and can spend it on their own desk. The boss can also buy an
// agent something, out of the pot.
//
// Everything lives in one plain object, kept in state.json with the rest of
// the office, and every change to a balance goes through credit() or charge()
// and leaves a line in the ledger, so the books always add up.

import { PAY, ITEMS, ACHIEVEMENTS, DEFAULTS, SINGLE, itemById, levelOf, streakBoost, TIP, modelPay, modelTier, split, naira } from '../shared/shop.js';

const LEDGER_MAX = 400;
// Weeks start on Monday 00:00 UTC (1970-01-01 was a Thursday).
const weekStart = (ms) => { const d = Math.floor(ms / 86400000); return (d - ((d + 3) % 7)) * 86400000; };
// Bets are small and slow on purpose. A stake is locked out of the wallet the
// moment it is offered, so a wallet can never go below zero.
export const BET = { minStake: 100, maxStake: 5000, maxOpen: 3, maxMinutes: 60, openMs: 6 * 3600000, liveMs: 24 * 3600000, keep: 40 };
export const GOAL = { minTarget: 1000, maxTarget: 1e9, maxName: 40 };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

export function emptyBooks() {
  return { wallets: {}, pot: 0, stats: {}, desks: {}, office: [], using: { ...DEFAULTS }, achievements: {}, kudos: [], ledger: [], weekly: {}, totals: { earned: 0, spent: 0 },
    // The team goal ({} when none), the goals already reached, agent-to-agent
    // bets, and the stakes held on them (wallets + pot + escrow = earned - spent).
    goal: {}, goalsDone: [], bets: [], escrow: 0 };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export class Economy {
  // `books` is the stored object, filled in where older state lacks a part.
  // `onChange` gets each ledger entry as it happens, to save and broadcast.
  constructor(books, { now = () => Date.now(), onChange = () => {} } = {}) {
    const b = isObj(books) ? books : {};
    const fresh = emptyBooks();
    // typeof says 'object' for null and arrays and 'number' for NaN, so check
    // the real shape of each part, and start that part over if it is damaged.
    for (const k of Object.keys(fresh)) {
      const ok = Array.isArray(fresh[k]) ? Array.isArray(b[k]) : isObj(fresh[k]) ? isObj(b[k]) : isNum(b[k]);
      if (!ok) b[k] = fresh[k];
    }
    for (const id of Object.keys(b.wallets)) if (!isNum(b.wallets[id])) b.wallets[id] = 0;
    // Books from before the running totals: what is held now counts as earned.
    if (!isNum(b.totals.earned) || !isNum(b.totals.spent)) {
      b.totals = { earned: b.pot + Object.values(b.wallets).reduce((a, x) => a + x, 0), spent: 0 };
    }
    b.using = { ...DEFAULTS, ...b.using };
    this.b = b;
    this.now = now;
    this.onChange = onChange;
  }

  get books() { return this.b; }
  wallet(id) { return this.b.wallets[id] || 0; }
  statsOf(id) {
    return (this.b.stats[id] ||= { jobs: 0, earned: 0, byTier: {}, kudos: 0, bought: 0, streak: 0, lastDay: '' });
  }

  record(entry) {
    const e = { at: this.now(), ...entry };
    this.b.ledger.push(e);
    if (this.b.ledger.length > LEDGER_MAX) this.b.ledger.splice(0, this.b.ledger.length - LEDGER_MAX);
    this.onChange(e);
    return e;
  }

  // Money in: split between the agent and the pot.
  credit(agentId, gross, entry) {
    const s = split(gross);
    if (!s.gross) return null;
    this.b.wallets[agentId] = this.wallet(agentId) + s.agent;
    this.b.pot += s.pot;
    this.b.totals.earned += s.gross;
    this.statsOf(agentId).earned += s.gross;
    const e = this.record({ ...entry, agentId, gross: s.gross, agent: s.agent, pot: s.pot });
    this.checkGoal();
    return e;
  }

  // A turn of work, as it ends: `ms` of model time on `model`. Kept on the
  // job until it finishes, since only a finished job pays.
  accrue(job, ms, model) {
    const min = Math.max(0, Number(ms) || 0) / 60000;
    if (!min) return;
    job.payMinutes = (job.payMinutes || 0) + min;
    job.payWeighted = (job.payWeighted || 0) + min * modelPay(model);
  }

  // What a finished job earns, without paying it.
  quote(job) {
    const minutes = job.payMinutes || 0;
    const capped = minutes > PAY.maxMinutes ? (job.payWeighted || 0) * (PAY.maxMinutes / minutes) : job.payWeighted || 0;
    const mult = modelPay(job.model);
    return { minutes, tier: modelTier(job.model), mult, wage: capped * PAY.perMinute, bonus: PAY.finishBonus * mult };
  }

  // A job finished. Pays it, counts it, and checks for milestones.
  pay(job) {
    if (!job?.agentId) return null;
    const q = this.quote(job);
    job.payMinutes = 0;
    job.payWeighted = 0;
    // A reply can reopen a finished job. The new minutes are paid, but the
    // finish bonus, the job count and the milestones are for the first finish.
    const again = !!job.payCounted;
    job.payCounted = true;
    const s = this.statsOf(job.agentId);
    let boost = 0;
    if (!again) {
      // The day's first finish keeps or restarts the streak, and the
      // streak lifts this job's wage.
      const today = day(this.now());
      if (s.lastDay !== today) {
        const yesterday = day(this.now() - 86400000);
        s.streak = s.lastDay === yesterday ? s.streak + 1 : 1;
        s.lastDay = today;
      }
      boost = streakBoost(s.streak);
    }
    const e = this.credit(job.agentId, q.wage * (1 + boost) + (again ? 0 : q.bonus), { kind: 'pay', jobId: job.id, title: job.title, minutes: Math.round(q.minutes * 10) / 10, tier: q.tier, mult: q.mult, ...(boost ? { streak: s.streak, boost } : {}) });
    if (e) job.earned = (job.earned || 0) + e.gross;
    if (again) return { pay: e, achievements: this.milestones(job.agentId) };
    // A bet that cannot be settled cleanly must never hold up the pay.
    try { this.settleBets(job, q.minutes); } catch (err) { this.record({ kind: 'bet', phase: 'error', jobId: job.id, why: err.message }); }
    s.jobs++;
    if (q.tier) s.byTier[q.tier] = (s.byTier[q.tier] || 0) + 1;
    const won = this.milestones(job.agentId, q);
    return { pay: e, achievements: won };
  }

  // Unlocked milestones pay their bonus once each.
  milestones(agentId, job) {
    const have = (this.b.achievements[agentId] ||= []);
    const won = [];
    // Twice round, since a bonus can push `earned` past the next milestone.
    for (let pass = 0; pass < 2; pass++) {
      for (const a of ACHIEVEMENTS) {
        if (have.includes(a.id) || !a.test(this.statsOf(agentId), job)) continue;
        have.push(a.id);
        won.push(a);
        this.credit(agentId, a.bonus, { kind: 'achievement', achievement: a.id, title: a.name });
      }
    }
    return won;
  }

  // The boss liked a finished job: its finish bonus again, once.
  kudos(job) {
    if (!job || job.status !== 'done' || job.awaitingBoss) throw new Error('Only a finished job can get kudos.');
    if (job.guest) throw new Error('That job belongs to another office.');
    if (job.kudosPaid || this.b.kudos.includes(job.id)) throw new Error('That job already got kudos.');
    job.kudosPaid = true;
    this.b.kudos.push(job.id);
    if (this.b.kudos.length > 2000) this.b.kudos.splice(0, 1000);
    this.statsOf(job.agentId).kudos++;
    const e = this.credit(job.agentId, PAY.finishBonus * modelPay(job.model), { kind: 'kudos', jobId: job.id, title: job.title });
    return { pay: e, achievements: this.milestones(job.agentId) };
  }

  owns(item, agentId) {
    if (item.price === 0 && SINGLE.has(item.scope)) return true;
    if (item.scope === 'desk') return (this.b.desks[agentId] || []).includes(item.id);
    return this.b.office.includes(item.id);
  }

  // `by` is 'boss' or an agent's id; `forAgent` is whose desk a desk item
  // goes on. Agents pay from their own wallet and only for their own desk;
  // the boss pays from the pot.
  buy(itemId, { by, forAgent } = {}) {
    const item = itemById(itemId);
    if (!item) throw new Error(`Nothing in the shop is called "${itemId}".`);
    const boss = by === 'boss';
    if (!boss && item.scope !== 'desk') throw new Error(`${item.name} is for the office, and only the boss can buy those, out of the pot.`);
    const owner = item.scope === 'desk' ? (boss ? forAgent : by) : null;
    if (item.scope === 'desk' && !owner) throw new Error('Say whose desk it is for.');
    if (this.owns(item, owner)) throw new Error(owner ? `${item.name} is already on that desk.` : `The office already has ${item.name}.`);
    const balance = boss ? this.b.pot : this.wallet(by);
    if (balance < item.price) throw new Error(`${item.name} costs ${naira(item.price)} and ${boss ? 'the pot has' : 'you have'} ${naira(balance)}.`);
    if (boss) this.b.pot -= item.price;
    else this.b.wallets[by] = balance - item.price;
    this.b.totals.spent += item.price;
    if (owner) (this.b.desks[owner] ||= []).push(item.id);
    else this.b.office.push(item.id);
    // Buying a new look puts it straight into use.
    if (SINGLE.has(item.scope)) this.b.using[item.scope] = item.id;
    const e = this.record({ kind: 'buy', item: item.id, title: item.name, price: item.price, by, agentId: owner || undefined, from: boss ? 'pot' : 'wallet' });
    let won = [];
    if (owner && !boss) {
      this.statsOf(owner).bought++;
      won = this.milestones(owner);
    }
    return { buy: e, achievements: won };
  }

  // The boss tips an agent out of the pot. A plain transfer: it is not
  // earned, so it neither splits nor counts toward totals.
  tip(agentId, amount) {
    const n = Math.floor(Number(amount));
    if (!agentId) throw new Error('Say who the tip is for.');
    if (!(n >= TIP.min && n <= TIP.max)) throw new Error(`A tip is between ${naira(TIP.min)} and ${naira(TIP.max)}.`);
    if (this.b.pot < n) throw new Error(`The pot has ${naira(this.b.pot)}.`);
    this.b.pot -= n;
    this.b.wallets[agentId] = this.wallet(agentId) + n;
    return this.record({ kind: 'tip', agentId, amount: n, by: 'boss', title: 'Tip from the boss' });
  }

  // Title and streak, per agent. A streak only counts while it is alive:
  // finished a job today or yesterday.
  perks(id) {
    const st = this.b.stats[id] || {};
    const live = st.lastDay === day(this.now()) || st.lastDay === day(this.now() - 86400000);
    const streak = live ? st.streak || 0 : 0;
    return { ...levelOf(st.earned || 0), streak, boost: streakBoost(streak) };
  }

  // Switch to a floor, wall or layout the office owns.
  use(itemId) {
    const item = itemById(itemId);
    if (!item || !SINGLE.has(item.scope)) throw new Error('Only a floor, wall or layout can be put into use.');
    if (!this.owns(item)) throw new Error(`The office doesn't own ${item.name} yet.`);
    this.b.using[item.scope] = item.id;
    this.record({ kind: 'use', item: item.id, title: item.name, by: 'boss' });
    return this.b.using;
  }

  // Desk items an agent could buy right now.
  affordable(agentId) {
    return ITEMS.filter((i) => i.scope === 'desk' && i.price <= this.wallet(agentId) && !this.owns(i, agentId));
  }

  // The rank each agent held when the week began, kept in the books so a
  // restart doesn't lose it. Older state has none: the first look takes one,
  // and from then on it rolls over every Monday.
  rollWeek() {
    const w = this.b.weekly;
    const start = weekStart(this.now());
    const ok = isNum(w.start) && isObj(w.ranks);
    if (ok && w.start >= start) return w;
    const ranks = {};
    this.richList().forEach((r, i) => { ranks[r.id] = i + 1; });
    // The very first snapshot has nothing to compare against, so it is
    // marked `first` and shows no movement until a week has passed.
    this.b.weekly = { start, ranks, first: !ok };
    return this.b.weekly;
  }

  // Net worth is what an agent holds plus what they have bought for their
  // desk, at shop price. Ties go to whoever has earned more over their time.
  richList() {
    const b = this.b;
    const ids = new Set([...Object.keys(b.wallets), ...Object.keys(b.desks), ...Object.keys(b.stats)]);
    return [...ids].map((id) => {
      const wallet = this.wallet(id);
      const desk = (b.desks[id] || []).reduce((a, x) => a + (itemById(x)?.price || 0), 0);
      const st = b.stats[id] || {};
      const locked = this.staked(id);
      return { id, worth: wallet + desk + locked, wallet, desk, earned: st.earned || 0, jobs: st.jobs || 0 };
    }).sort((a, c) => c.worth - a.worth || c.earned - a.earned || a.id.localeCompare(c.id));
  }

  // The rich list with the week's movement: `moved` is places climbed since
  // the week began (negative for places lost), `rival` the agents just above
  // and below with the gap in naira, and `comeback` marks whoever climbed
  // most (ties go to the higher rank; nobody if nobody climbed). Agents who
  // joined the list this week, and the whole list in the first week, have
  // `moved: null`.
  weekly() {
    const w = this.rollWeek();
    const list = this.richList();
    const rows = list.map((r, i) => {
      const was = !w.first && isNum(w.ranks[r.id]) ? w.ranks[r.id] : null;
      const above = list[i - 1], below = list[i + 1];
      return {
        ...r, rank: i + 1, was, moved: was === null ? null : was - (i + 1),
        rival: { above: above ? { id: above.id, gap: above.worth - r.worth } : null, below: below ? { id: below.id, gap: r.worth - below.worth } : null },
        comeback: false,
      };
    });
    const best = rows.reduce((m, r) => (r.moved > (m?.moved || 0) ? r : m), null);
    if (best) best.comeback = true;
    return { since: w.start, first: !!w.first, rows };
  }

  // ---------- team goal ----------

  // The boss names a target for the pot ("pool party", ₦5,000,000). Reaching
  // it is celebrated once; the goal then stays as reached until replaced.
  setGoal({ name, target } = {}) {
    name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, GOAL.maxName);
    target = Math.round(Number(target));
    if (!name) throw new Error('Give the goal a name.');
    if (!Number.isFinite(target) || target < GOAL.minTarget) throw new Error(`The target must be at least ${naira(GOAL.minTarget)}.`);
    if (target > GOAL.maxTarget) throw new Error(`The target can be at most ${naira(GOAL.maxTarget)}.`);
    if (target <= this.b.pot) throw new Error(`The pot already has ${naira(this.b.pot)}. Aim higher than that.`);
    this.b.goal = { name, target, setAt: this.now(), reachedAt: null };
    this.record({ kind: 'goal', phase: 'set', title: name, target, by: 'boss' });
    return this.goalStatus();
  }

  clearGoal() {
    if (!this.b.goal.target) return this.goalStatus();
    const was = this.b.goal;
    this.b.goal = {};
    this.record({ kind: 'goal', phase: 'cleared', title: was.name, target: was.target, by: 'boss' });
    return this.goalStatus();
  }

  // Called whenever the pot grows. Fires once per goal: reachedAt is the latch,
  // and it survives the pot being spent down afterwards.
  checkGoal() {
    const g = this.b.goal;
    if (!g.target || g.reachedAt || this.b.pot < g.target) return null;
    g.reachedAt = this.now();
    this.b.goalsDone.push({ name: g.name, target: g.target, reachedAt: g.reachedAt });
    if (this.b.goalsDone.length > 20) this.b.goalsDone.splice(0, this.b.goalsDone.length - 20);
    return this.record({ kind: 'goal', phase: 'reached', title: g.name, target: g.target, pot: this.b.pot });
  }

  goalStatus() {
    const g = this.b.goal;
    if (!g.target) return null;
    const pot = this.b.pot;
    return { name: g.name, target: g.target, setAt: g.setAt, reachedAt: g.reachedAt || null, pot, progress: g.reachedAt ? 1 : Math.min(1, pot / g.target), done: this.b.goalsDone.length };
  }

  // ---------- bets ----------
  //
  // One agent (the backer) says another agent's next job will finish in under
  // N active minutes and stakes naira on it; a second agent (the doubter) takes
  // the other side with a matching stake. Both stakes are locked in escrow, and
  // when the job first finishes the winner gets both. Nobody can be the subject
  // of their own bet, so nobody gains by dragging a job out or rushing it for a
  // bet. Money only ever moves wallet -> escrow -> wallet, never through the
  // pot, so earned and spent do not change.

  staked(agentId) {
    return this.b.bets.reduce((a, x) => a + (x.state === 'open' && x.by === agentId ? x.stake : x.state === 'live' && (x.by === agentId || x.against === agentId) ? x.stake : 0), 0);
  }

  // Wallet -> escrow. Never lets a wallet go below zero.
  charge(agentId, amount, entry) {
    if (!(amount > 0) || this.wallet(agentId) < amount) throw new Error(`${naira(amount)} is more than ${agentId} has (${naira(this.wallet(agentId))}).`);
    this.b.wallets[agentId] = this.wallet(agentId) - amount;
    this.b.escrow += amount;
    return this.record({ ...entry, agentId, amount: -amount });
  }

  // Escrow -> wallet.
  release(agentId, amount, entry) {
    if (!(amount > 0)) return null;
    if (this.b.escrow < amount) throw new Error('The escrow is short; refusing to pay out more than is held.');
    this.b.escrow -= amount;
    this.b.wallets[agentId] = this.wallet(agentId) + amount;
    return this.record({ ...entry, agentId, amount });
  }

  offerBet({ by, subject, minutes, stake } = {}) {
    this.sweep();
    minutes = Math.round(Number(minutes));
    stake = Math.round(Number(stake));
    if (!by || !subject) throw new Error('Say who is betting and on whom.');
    if (by === subject) throw new Error('You cannot bet on your own job.');
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > BET.maxMinutes) throw new Error(`Pick a time between 1 and ${BET.maxMinutes} minutes.`);
    if (!Number.isFinite(stake) || stake < BET.minStake || stake > BET.maxStake) throw new Error(`A stake is between ${naira(BET.minStake)} and ${naira(BET.maxStake)}.`);
    const mine = this.b.bets.filter((x) => (x.state === 'open' || x.state === 'live') && (x.by === by || x.against === by)).length;
    if (mine >= BET.maxOpen) throw new Error(`You already have ${BET.maxOpen} bets going. Wait for one to settle.`);
    const bet = { id: 'b' + this.now().toString(36) + Math.random().toString(36).slice(2, 6), by, subject, minutes, stake, against: null, state: 'open', createdAt: this.now() };
    this.charge(by, stake, { kind: 'bet', phase: 'stake', betId: bet.id, subject, minutes });
    this.b.bets.push(bet);
    return bet;
  }

  takeBet(id, { by } = {}) {
    this.sweep();
    const bet = this.b.bets.find((x) => x.id === id);
    if (!bet || bet.state !== 'open') throw new Error('That bet is not open.');
    if (by === bet.by) throw new Error('That is your own bet.');
    if (by === bet.subject) throw new Error('You cannot bet against your own job.');
    const mine = this.b.bets.filter((x) => (x.state === 'open' || x.state === 'live') && (x.by === by || x.against === by)).length;
    if (mine >= BET.maxOpen) throw new Error(`You already have ${BET.maxOpen} bets going. Wait for one to settle.`);
    this.charge(by, bet.stake, { kind: 'bet', phase: 'stake', betId: bet.id, subject: bet.subject, minutes: bet.minutes });
    Object.assign(bet, { against: by, state: 'live', acceptedAt: this.now() });
    return bet;
  }

  // The backer (or the boss) takes back an offer nobody has taken.
  cancelBet(id, { by } = {}) {
    const bet = this.b.bets.find((x) => x.id === id);
    if (!bet || bet.state !== 'open') throw new Error('That bet is not open.');
    if (by !== 'boss' && by !== bet.by) throw new Error('Only whoever offered it can take it back.');
    return this.close(bet, 'void', 'taken back');
  }

  // Ends a bet and moves the money. Winner takes both stakes; a void gives
  // each their own back. Idempotent: a bet that is closed stays closed.
  close(bet, state, why, winner) {
    if (bet.state !== 'open' && bet.state !== 'live') return bet;
    const parties = [bet.by, bet.against].filter(Boolean);
    if (this.b.escrow < bet.stake * (state === 'void' ? parties.length : 2)) throw new Error('The escrow is short; refusing to move any of it.');
    const entry = { kind: 'bet', phase: state, betId: bet.id, subject: bet.subject, minutes: bet.minutes, stake: bet.stake, why };
    if (state === 'void') for (const id of parties) this.release(id, bet.stake, { ...entry });
    else this.release(winner, bet.stake * 2, { ...entry, winner, loser: parties.find((x) => x !== winner) });
    Object.assign(bet, { state, why, winner: winner || null, settledAt: this.now() });
    const old = this.b.bets.filter((x) => x.state !== 'open' && x.state !== 'live');
    if (old.length > BET.keep) for (const x of old.slice(0, old.length - BET.keep)) this.b.bets.splice(this.b.bets.indexOf(x), 1);
    return bet;
  }

  // A bet belongs to the subject's first job that started after it was taken.
  boundTo(bet, job) {
    return bet.state === 'live' && bet.subject === job.agentId && Number.isFinite(job.startedAt) && bet.acceptedAt <= job.startedAt;
  }

  // The job finished for the first time, in `minutes` of active work.
  settleBets(job, minutes) {
    this.sweep();
    for (const bet of this.b.bets.filter((x) => this.boundTo(x, job))) {
      if (!(minutes > 0)) { this.close(bet, 'void', 'no working time was recorded'); continue; }
      const under = minutes < bet.minutes;
      this.close(bet, under ? 'won' : 'lost', `${Math.round(minutes * 10) / 10} min on "${job.title}"`, under ? bet.by : bet.against);
    }
  }

  // The job did not finish (failed, stopped, cancelled): stakes come back.
  voidBets(job, why = 'the job did not finish') {
    for (const bet of this.b.bets.filter((x) => this.boundTo(x, job))) this.close(bet, 'void', why);
  }

  // Bets nobody took, or that never settled, run out and refund.
  sweep() {
    const t = this.now();
    for (const bet of this.b.bets.slice()) {
      if (bet.state === 'open' && t - bet.createdAt > BET.openMs) this.close(bet, 'void', 'nobody took it');
      else if (bet.state === 'live' && t - bet.acceptedAt > BET.liveMs) this.close(bet, 'void', 'the job never finished');
    }
  }

  betsStatus() {
    return this.b.bets.slice(-BET.keep - 12);
  }

  status() {
    const wk = this.weekly();
    const b = this.b;
    return {
      rich: wk.rows.map((r) => ({ ...r, ...this.perks(r.id) })), goal: this.goalStatus(), bets: this.betsStatus(), escrow: b.escrow, week: { since: wk.since, first: wk.first }, pay: { perMinute: PAY.perMinute, finishBonus: PAY.finishBonus },
      pot: b.pot, wallets: b.wallets, stats: b.stats, desks: b.desks, office: b.office, using: b.using,
      achievements: b.achievements, kudos: b.kudos.slice(-200), ledger: b.ledger.slice(-60),
    };
  }
}
