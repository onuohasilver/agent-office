// The shop: the office pot, everyone's wallet and desk, the office's own
// things, its looks, achievements and the books.
//
// The server keeps the books (server/economy.js); this only draws them and
// asks it to buy or switch things. Prices, names and milestones all come from
// shared/shop.js, the same list the server charges by.

import { ITEMS, ACHIEVEMENTS, PAY, MODEL_PAY, itemById, naira } from '../../shared/shop.js';
import { api, portrait } from './hud.js';
import { visiting } from './links.js';

const dlg = document.getElementById('shop');
const btn = document.getElementById('shopBtn');
// Labelled ways in to the shop's Forbes list and its office looks.
const doors = [...document.querySelectorAll('[data-shop-tab]')];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => Math.round(Number(v) || 0).toLocaleString();
const coins = (v, cls = '') => `<span class="coins ${cls}">${naira(v)}</span>`;
const ago = (t) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const TIER = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' };

const TABS = [
  ['desks', 'Desks'],
  ['rich', 'Forbes list'],
  ['looks', 'Layout & paint'],
  ['office', 'Furniture'],
  ['wins', 'Achievements'],
  ['ledger', 'Ledger'],
];

let app = null;
let toast = () => {};
let econ = null;
let tab = 'desks';
let openDesk = null; // the agent whose "buy for them" shelf is out
let arming = null;   // the item a first tap armed: { key, timer }
let busy = false;

// The agents who have a desk right now, in desk order.
const hired = () => (app?.staff || []).slice(0, app?.progress?.capacity || 0);
const name = (id) => (id === 'boss' ? 'You' : app?.staffName(id) || id);
const staffOf = (id) => app?.staff.find((s) => s.id === id);

// ---------- the panes ----------

function desksPane() {
  const pot = econ.pot || 0;
  const people = hired();
  if (!people.length) return '<p class="shop-empty">Nobody’s hired yet.</p>';
  const deskItems = ITEMS.filter((i) => i.scope === 'desk');
  return `<p class="shop-lede">Agents spend their own pay on their desks. You can treat them out of the pot.</p>
    <ul class="shop-people">${people.map((s) => {
    const mine = econ.desks?.[s.id] || [];
    const st = econ.stats?.[s.id] || {};
    const open = openDesk === s.id;
    const left = deskItems.filter((i) => !mine.includes(i.id));
    return `<li class="shop-person${open ? ' open' : ''}">
      <div class="sp-head">
        <span class="sp-face">${portrait(s)}</span>
        <span class="sp-who"><b>${esc(s.name)}</b><small>${n(st.jobs || 0)} job${st.jobs === 1 ? '' : 's'} · ${naira(st.earned || 0)} earned</small></span>
        ${coins(econ.wallets?.[s.id] || 0, 'sp-wallet')}
      </div>
      <div class="sp-items" aria-label="On ${esc(s.name)}’s desk">${mine.length
        ? mine.map((id) => { const it = itemById(id); return it ? `<span class="sp-item" title="${esc(it.name)}">${it.icon}</span>` : ''; }).join('')
        : '<span class="sp-none">Nothing on the desk yet</span>'}
        ${left.length && !visiting.on ? `<button type="button" class="sp-treat" data-treat="${esc(s.id)}" aria-expanded="${open}">${open ? 'Done' : 'Buy for them'}</button>` : ''}
      </div>
      ${open ? `<div class="shop-grid sp-shelf">${left.map((it) => card(it, { for: s.id, short: pot < it.price })).join('')}</div>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

// One thing for sale. `state` is what the button says.
function card(it, { for: who = '', short = false, owned = false, using = false, swatch = false, blurb = '' } = {}) {
  const key = `${it.id}|${who}`;
  const armed = arming?.key === key;
  const action = visiting.on ? ''
    : using ? '<span class="sc-state on">In use</span>'
    : owned ? (swatch || it.scope === 'layout' ? `<button type="button" class="sc-btn" data-use="${esc(it.id)}">Use</button>` : '<span class="sc-state">Owned</span>')
    : short ? `<span class="sc-state short" title="The pot is ${n(it.price - (econ.pot || 0))} short">${n(it.price - (econ.pot || 0))} short</span>`
    : `<button type="button" class="sc-btn buy${armed ? ' armed' : ''}" data-buy="${esc(it.id)}" data-for="${esc(who)}">${armed ? `Confirm ${naira(it.price)}` : it.price ? 'Buy' : 'Use'}</button>`;
  return `<div class="shop-card${using ? ' using' : ''}${owned && !using ? ' owned' : ''}">
    <span class="sc-art">${swatch ? `<i class="sc-swatch" style="background:${esc(it.color)}"></i>` : `<span class="sc-icon" aria-hidden="true">${it.icon}</span>`}</span>
    <span class="sc-name">${esc(it.name)}</span>
    ${blurb ? `<small class="sc-blurb">${esc(blurb)}</small>` : ''}
    <span class="sc-foot">${it.price ? coins(it.price, 'sc-price') : '<span class="sc-free">Free</span>'}${action}</span>
  </div>`;
}

function officePane() {
  const pot = econ.pot || 0;
  const have = econ.office || [];
  return `<p class="shop-lede">Paid for out of the pot, for everyone. They turn up in the room as soon as you buy them.</p>
    <div class="shop-grid">${ITEMS.filter((i) => i.scope === 'office').map((it) => card(it, { owned: have.includes(it.id), short: pot < it.price })).join('')}</div>`;
}

function looksPane() {
  const pot = econ.pot || 0;
  const have = econ.office || [];
  const using = econ.using || {};
  const section = (scope, title, note) => `<h3 class="shop-h">${title}</h3>${note ? `<p class="shop-lede">${note}</p>` : ''}
    <div class="shop-grid${scope === 'layout' ? ' wide' : ''}">${ITEMS.filter((i) => i.scope === scope).map((it) => card(it, {
    owned: it.price === 0 || have.includes(it.id),
    using: using[scope] === it.id,
    short: pot < it.price,
    swatch: scope !== 'layout',
    blurb: it.blurb,
  })).join('')}</div>`;
  return section('layout', 'Layout', 'A new floor plan. Everyone’s desk comes with them, and the page reloads to move in.')
    + section('floor', 'Floor') + section('wall', 'Walls');
}

function richPane() {
  const people = hired();
  if (!people.length) return '<p class="shop-empty">Nobody’s hired yet.</p>';
  const by = new Map((econ.rich || []).map((r) => [r.id, r]));
  const rows = people.map((s) => ({ s, ...(by.get(s.id) || { worth: 0, wallet: 0, desk: 0, earned: 0, jobs: 0 }) }))
    .sort((a, b) => b.worth - a.worth || b.earned - a.earned);
  const mover = (r) => {
    if (r.moved == null) return '<span class="sr-move" title="No snapshot to compare with yet">–</span>';
    if (!r.moved) return '<span class="sr-move" title="Same place as at the start of the week">=</span>';
    const up = r.moved > 0, k = Math.abs(r.moved);
    return `<span class="sr-move ${up ? 'up' : 'down'}" title="${up ? 'Up' : 'Down'} ${k} place${k === 1 ? '' : 's'} this week">${up ? '▲' : '▼'}${k}</span>`;
  };
  // The neighbour on the list as shown: who to catch, or for the leader, who is catching up.
  const rival = (i) => {
    const up = rows[i - 1], down = rows[i + 1];
    if (up) return `Rival: ${esc(up.s.name)}, ${naira(up.worth - rows[i].worth)} ahead`;
    if (down) return `Chased by ${esc(down.s.name)}, ${naira(rows[i].worth - down.worth)} behind`;
    return '';
  };
  const total = rows.reduce((a, r) => a + r.worth, 0);
  const first = !!econ.week?.first || rows.every((r) => r.moved == null);
  return `<p class="shop-lede">Net worth is cash in hand plus what’s on the desk, at shop price. The team holds ${coins(total)} between them.${first ? ' Arrows show up after the first full week.' : ' Arrows show places moved since Monday.'}</p>
    <ol class="shop-rich">${rows.map((r, i) => `<li class="${i === 0 && r.worth > 0 ? 'top' : ''}">
      <span class="sr-rank" aria-label="Rank ${i + 1}">${i === 0 && r.worth > 0 ? '👑' : i + 1}</span>
      <span class="sp-face">${portrait(r.s)}</span>
      <span class="sp-who"><b>${esc(r.s.name)}</b><small>${naira(r.wallet)} in hand · ${naira(r.desk)} on the desk · ${n(r.jobs)} job${r.jobs === 1 ? '' : 's'}</small>${rival(i) ? `<small class="sr-rival">${rival(i)}</small>` : ''}</span>
      ${mover(r)}${r.comeback ? '<span class="sr-comeback" title="Climbed the most places this week">Comeback</span>' : ''}
      ${coins(r.worth, 'sr-worth')}
    </li>`).join('')}</ol>`;
}

function winsPane() {
  const got = econ.achievements || {};
  return `<p class="shop-lede">Each pays a one-off bonus, split with the pot like any pay.</p>
    <ul class="shop-wins">${ACHIEVEMENTS.map((a) => {
    const who = hired().filter((s) => (got[s.id] || []).includes(a.id));
    return `<li class="${who.length ? 'won' : ''}">
      <span class="sw-badge" aria-hidden="true">${who.length ? '★' : '☆'}</span>
      <span class="sw-text"><b>${esc(a.name)}</b><small>${esc(a.blurb)}</small></span>
      <span class="sw-who">${who.map((s) => `<span class="sw-face" title="${esc(s.name)}">${portrait(s)}</span>`).join('')}</span>
      ${coins(a.bonus, 'sw-bonus')}
    </li>`;
  }).join('')}</ul>`;
}

function line(e) {
  const t = `“${esc(e.title)}”`;
  switch (e.kind) {
    case 'pay': return {
      text: `<b>${esc(name(e.agentId))}</b> was paid for ${t}`,
      sub: [e.minutes != null && `${e.minutes} active min`, e.tier && `${TIER[e.tier] || e.tier} ×${e.mult}`, e.boost && `🔥 ${e.streak}-day streak +${Math.round(e.boost * 100)}% wage`, `${n(e.agent)} kept, ${n(e.pot)} to the pot`].filter(Boolean).join(' · '),
      amt: `+${n(e.gross)}`, cls: 'in',
    };
    case 'achievement': return { text: `<b>${esc(name(e.agentId))}</b> unlocked ${esc(e.title)}`, sub: `${n(e.agent)} kept, ${n(e.pot)} to the pot`, amt: `+${n(e.gross)}`, cls: 'in' };
    case 'kudos': return { text: `Kudos to <b>${esc(name(e.agentId))}</b> for ${t}`, sub: `${n(e.agent)} kept, ${n(e.pot)} to the pot`, amt: `+${n(e.gross)}`, cls: 'in' };
    case 'buy': {
      const it = itemById(e.item);
      const what = `${it?.icon || ''} ${esc(e.title)}`;
      const text = e.by === 'boss'
        ? e.agentId ? `You bought <b>${esc(name(e.agentId))}</b> a ${what}` : `You bought ${what} for the office`
        : `<b>${esc(name(e.by))}</b> bought ${what} for their desk`;
      return { text, sub: e.from === 'pot' ? 'From the pot' : 'From their wallet', amt: e.price ? `−${n(e.price)}` : '', cls: 'out' };
    }
    case 'tip': return { text: `You tipped <b>${esc(name(e.agentId))}</b>`, sub: 'From the pot', amt: `−${n(e.amount)}`, cls: 'out' };
    case 'use': return { text: `Switched to ${esc(e.title)}`, sub: '', amt: '', cls: '' };
    default: return { text: esc(e.title || e.kind), sub: '', amt: '', cls: '' };
  }
}

function ledgerPane() {
  const rows = [...(econ.ledger || [])].reverse();
  const rate = Object.entries(MODEL_PAY).map(([k, v]) => `${TIER[k]} ×${v}`).join(', ');
  return `<p class="shop-lede">A finished job pays ${naira(PAY.perMinute)} a working minute plus ${naira(PAY.finishBonus)} for finishing, times the model: ${rate}. ${Math.round(PAY.potShare * 100)}% of it goes to the pot.</p>
    ${rows.length ? `<ul class="shop-ledger">${rows.map((e) => {
    const l = line(e);
    return `<li><span class="sl-text">${l.text}${l.sub ? `<small>${l.sub} · ${ago(e.at)}</small>` : `<small>${ago(e.at)}</small>`}</span><span class="sl-amt ${l.cls}">${l.amt}</span></li>`;
  }).join('')}</ul>` : '<p class="shop-empty">Nothing yet. The first finished job starts the books.</p>'}`;
}

const PANES = { desks: desksPane, rich: richPane, office: officePane, looks: looksPane, wins: winsPane, ledger: ledgerPane };

// ---------- drawing ----------

function render() {
  if (!dlg?.open) return;
  const body = dlg.querySelector('.shop-body');
  const top = body.scrollTop;
  dlg.querySelector('.shop-pot').innerHTML = econ ? `${coins(econ.pot)}<small>in the pot</small>` : '';
  for (const b of dlg.querySelectorAll('.shop-tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  body.innerHTML = econ ? PANES[tab]() : '<p class="shop-empty">Opening the books…</p>';
  body.scrollTop = top;
}

function paintButton() {
  if (!btn) return;
  btn.hidden = !econ || visiting.on;
  for (const d of doors) d.hidden = btn.hidden;
  const b = btn.querySelector('b');
  if (b && econ) b.textContent = naira(econ.pot);
  btn.setAttribute('aria-label', econ ? `Shop. ${naira(econ.pot)} in the office pot.` : 'Shop');
}

// From the hello and every economy event.
export function setEconomy(next) {
  if (!next) return;
  econ = next;
  paintButton();
  if (!busy) render();
}

export const economy = () => econ;

// The pot chip gives a little hop when money lands in it.
export function bumpPot() {
  if (!btn || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  btn.classList.remove('bump');
  void btn.offsetWidth;
  btn.classList.add('bump');
}

async function send(path, body, done) {
  if (busy) return;
  busy = true;
  try {
    setEconomy(await api(path, body));
    if (done) toast(done, 'good');
  } catch (err) {
    toast(err.message, 'bad');
  }
  busy = false;
  render();
}

function buy(id, forAgent) {
  const it = itemById(id);
  if (!it) return;
  const key = `${id}|${forAgent || ''}`;
  // Two taps to spend: the first arms the button, the second buys. A stray
  // tap on a phone shouldn't cost ₦400,000.
  if (it.price && arming?.key !== key) {
    clearTimeout(arming?.timer);
    arming = { key, timer: setTimeout(() => { arming = null; render(); }, 3500) };
    render();
    return;
  }
  clearTimeout(arming?.timer);
  arming = null;
  const msg = forAgent ? `${it.icon} ${it.name} for ${name(forAgent)}’s desk`
    : it.scope === 'layout' ? `${it.name} layout bought. Moving in…`
    : `${it.icon} ${it.name}${it.scope === 'office' ? ' for the office' : ''}`;
  send('/api/economy/buy', forAgent ? { item: id, for: forAgent } : { item: id }, msg);
}

function open(which) {
  if (which) tab = which;
  dlg.showModal();
  btn?.setAttribute('aria-expanded', 'true');
  render();
  if (!econ) api('/api/economy').then(setEconomy, () => toast('Restart the office server to open the shop.', 'bad'));
  dlg.querySelector(`.shop-tabs [data-tab="${tab}"]`)?.focus();
}

export function openShop(which) { if (dlg && !dlg.open) open(which); }

export function initShop(a, { toast: t }) {
  app = a;
  toast = t;
  if (!dlg || !btn) return;
  dlg.innerHTML = `
    <header class="shop-head">
      <h2>Shop</h2>
      <span class="shop-pot" role="status"></span>
      <button type="button" class="theme-btn shop-x" aria-label="Close the shop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </header>
    <nav class="shop-tabs" role="tablist" aria-label="Shop">${TABS.map(([k, v]) => `<button type="button" role="tab" data-tab="${k}">${v}</button>`).join('')}</nav>
    <div class="shop-body" role="tabpanel"></div>`;
  btn.addEventListener('click', () => open());
  for (const d of doors) d.addEventListener('click', () => open(d.dataset.shopTab));
  dlg.querySelector('.shop-x').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) return dlg.close();
    const tb = e.target.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; dlg.querySelector('.shop-body').scrollTop = 0; return render(); }
    const treat = e.target.closest('[data-treat]');
    if (treat) { openDesk = openDesk === treat.dataset.treat ? null : treat.dataset.treat; return render(); }
    const b = e.target.closest('[data-buy]');
    if (b) return buy(b.dataset.buy, b.dataset.for || undefined);
    const u = e.target.closest('[data-use]');
    if (u) {
      const it = itemById(u.dataset.use);
      return send('/api/economy/use', { item: u.dataset.use }, it?.scope === 'layout' ? `Moving to ${it.name}…` : `${it?.name} it is`);
    }
  });
  // Arrow keys walk the tabs.
  dlg.querySelector('.shop-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex(([k]) => k === tab);
    tab = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
    render();
    dlg.querySelector(`.shop-tabs [data-tab="${tab}"]`)?.focus();
  });
  dlg.addEventListener('close', () => {
    btn.setAttribute('aria-expanded', 'false');
    clearTimeout(arming?.timer);
    arming = null;
    openDesk = null;
  });
  paintButton();
}
