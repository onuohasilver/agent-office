// The office economy: pay, the office pot, the shop and achievements.
//
// Agents are paid when a job finishes, by the active minute and scaled by the
// model that did the work (see shared/shop.js). Of every coin earned, the
// pot takes its share for the boss to spend on the office; the agent keeps
// the rest and can spend it on their own desk. The boss can also buy an
// agent something, out of the pot.
//
// Everything lives in one plain object, kept in state.json with the rest of
// the office, and every change to a balance goes through credit() or charge()
// and leaves a line in the ledger, so the books always add up.

import { PAY, ITEMS, ACHIEVEMENTS, DEFAULTS, SINGLE, itemById, modelPay, modelTier, split } from '../shared/shop.js';

const LEDGER_MAX = 400;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

export function emptyBooks() {
  return { wallets: {}, pot: 0, stats: {}, desks: {}, office: [], using: { ...DEFAULTS }, achievements: {}, kudos: [], ledger: [] };
}

export class Economy {
  // `books` is the stored object, filled in where older state lacks a part.
  // `onChange` gets each ledger entry as it happens, to save and broadcast.
  constructor(books, { now = () => Date.now(), onChange = () => {} } = {}) {
    const b = books && typeof books === 'object' ? books : {};
    const fresh = emptyBooks();
    for (const k of Object.keys(fresh)) if (b[k] === undefined || typeof b[k] !== typeof fresh[k]) b[k] = fresh[k];
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
    this.statsOf(agentId).earned += s.gross;
    return this.record({ ...entry, agentId, gross: s.gross, agent: s.agent, pot: s.pot });
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
    const e = this.credit(job.agentId, q.wage + q.bonus, { kind: 'pay', jobId: job.id, title: job.title, minutes: Math.round(q.minutes * 10) / 10, tier: q.tier, mult: q.mult });
    if (e) job.earned = (job.earned || 0) + e.gross;
    const s = this.statsOf(job.agentId);
    s.jobs++;
    if (q.tier) s.byTier[q.tier] = (s.byTier[q.tier] || 0) + 1;
    const today = day(this.now());
    if (s.lastDay !== today) {
      const yesterday = day(this.now() - 86400000);
      s.streak = s.lastDay === yesterday ? s.streak + 1 : 1;
      s.lastDay = today;
    }
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
    if (this.b.kudos.includes(job.id)) throw new Error('That job already got kudos.');
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
    if (balance < item.price) throw new Error(`${item.name} costs ${item.price} coins and ${boss ? 'the pot has' : 'you have'} ${balance}.`);
    if (boss) this.b.pot -= item.price;
    else this.b.wallets[by] = balance - item.price;
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

  status() {
    const b = this.b;
    return {
      pot: b.pot, wallets: b.wallets, stats: b.stats, desks: b.desks, office: b.office, using: b.using,
      achievements: b.achievements, kudos: b.kudos.slice(-200), ledger: b.ledger.slice(-60),
    };
  }
}
