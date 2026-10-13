// The team goal: a shared target for the office pot, set by the boss, with a
// progress bar beside the pot in the HUD and a little celebration when the
// pot gets there. Bets between agents are listed in the same dialog.
//
// The server keeps the books (server/economy.js: setGoal, checkGoal, offerBet…)
// and fires the goal once; this only draws what it is told. main.js calls
// showGoals(economy, entry) wherever it already hands the books to the shop.

import { naira } from '../../shared/shop.js';
import { api } from './hud.js';
import './goals.css';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let econ = null;
let chip = null;
let dlg = null;
let error = '';
let busy = false;
const celebrated = new Set();
const nameOf = (id) => id ? id.charAt(0).toUpperCase() + id.slice(1) : 'someone';

function mount() {
  if (chip) return;
  const anchor = document.getElementById('shopBtn');
  if (!anchor) return;
  chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip pot goal-chip';
  chip.hidden = true;
  chip.setAttribute('aria-haspopup', 'dialog');
  chip.addEventListener('click', openDialog);
  anchor.after(chip);
}

function paintChip() {
  mount();
  if (!chip) return;
  const g = econ?.goal;
  chip.hidden = !econ || document.getElementById('shopBtn')?.hidden;
  if (chip.hidden) return;
  const pct = g ? Math.floor(g.progress * 100) : 0;
  chip.classList.toggle('done', !!g?.reachedAt);
  chip.title = g ? `${g.name}: ${naira(g.pot)} of ${naira(g.target)}` : 'Set a team goal for the pot';
  chip.setAttribute('aria-label', g ? `Team goal ${g.name}, ${g.reachedAt ? 'reached' : `${pct} percent`}` : 'Set a team goal');
  chip.innerHTML = g
    ? `<i aria-hidden="true">${g.reachedAt ? '🎉' : '🎯'}</i><span class="goal-name">${esc(g.name)}</span><span class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><u style="width:${pct}%"></u></span><b>${g.reachedAt ? 'Done' : `${pct}%`}</b>`
    : '<i aria-hidden="true">🎯</i><span>Team goal</span>';
}

function confetti() {
  if (reduced()) return;
  const layer = document.createElement('div');
  layer.className = 'goal-confetti';
  layer.setAttribute('aria-hidden', 'true');
  const hues = [12, 45, 140, 205, 280, 330];
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('i');
    p.style.setProperty('--x', `${Math.random() * 100}vw`);
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 30}vw`);
    p.style.setProperty('--d', `${2.2 + Math.random() * 1.8}s`);
    p.style.setProperty('--w', `${Math.random() * 0.6}s`);
    p.style.background = `hsl(${hues[i % hues.length]} 80% 55%)`;
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 5000);
}

// From the hello and every economy event. A goal is celebrated only when its
// "reached" entry arrives live, and never twice for the same one.
export function showGoals(next, entry) {
  if (!next) return;
  econ = next;
  paintChip();
  if (dlg?.open && !busy) renderDialog();
  if (entry?.kind === 'goal' && entry.phase === 'reached') {
    const key = `${entry.title}|${entry.at}`;
    if (celebrated.has(key)) return;
    celebrated.add(key);
    confetti();
  }
}

function betLine(b) {
  const what = `${esc(nameOf(b.by))} backs ${esc(nameOf(b.subject))} under ${b.minutes} min · ${naira(b.stake)} each`;
  const state = b.state === 'open' ? 'Open' : b.state === 'live' ? `Against ${esc(nameOf(b.against))}` : b.state === 'void' ? 'Refunded' : `${esc(nameOf(b.winner))} won`;
  const cancel = b.state === 'open' ? `<button type="button" class="ghost small" data-cancel-bet="${esc(b.id)}">Take back</button>` : '';
  return `<li class="bet ${b.state}"><span>${what}</span><em>${state}</em>${cancel}</li>`;
}

function renderDialog() {
  const g = econ?.goal;
  const bets = [...(econ?.bets || [])].reverse().slice(0, 12);
  dlg.innerHTML = `<form method="dialog" class="goal-form">
    <h2>Team goal</h2>
    <p class="hint-t">Everyone earns towards the pot. Name something to spend it on and set the target; the office celebrates once it gets there.</p>
    ${g ? `<div class="goal-now"><b>${esc(g.name)}</b> ${naira(g.pot)} of ${naira(g.target)}${g.reachedAt ? ' · reached 🎉' : ''}
      <span class="goal-bar big"><u style="width:${Math.floor(g.progress * 100)}%"></u></span></div>` : ''}
    <label>What for<input name="name" maxlength="40" placeholder="Pool party" value="${esc(g?.reachedAt ? '' : g?.name || '')}" required autocomplete="off" /></label>
    <label>Target in naira<input name="target" type="number" min="1000" step="1000" inputmode="numeric" placeholder="5000000" value="${g && !g.reachedAt ? g.target : ''}" required /></label>
    ${error ? `<p class="goal-error" role="alert">${esc(error)}</p>` : ''}
    <div class="row">
      ${g ? '<button type="button" class="ghost small" data-clear>Clear goal</button>' : ''}
      <button type="button" class="ghost small" data-close>Close</button>
      <button type="submit" class="primary small">${g && !g.reachedAt ? 'Update goal' : 'Set goal'}</button>
    </div>
    <h3>Bets between agents</h3>
    <ul class="bets">${bets.length ? bets.map(betLine).join('') : '<li class="bet empty">None yet. Agents stake their own pay on each other’s next job.</li>'}</ul>
  </form>`;
}

async function send(path, body) {
  if (busy) return;
  busy = true;
  error = '';
  try { showGoals(await api(path, body)); } catch (err) { error = err.message; }
  busy = false;
  renderDialog();
}

function openDialog() {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'goal-dialog';
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
      if (e.target.closest('[data-clear]')) return send('/api/economy/goal', { clear: true });
      const c = e.target.closest('[data-cancel-bet]');
      if (c) send('/api/economy/bet/cancel', { id: c.dataset.cancelBet });
    });
    dlg.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      send('/api/economy/goal', { name: f.get('name'), target: Number(f.get('target')) });
    });
    document.body.append(dlg);
  }
  error = '';
  renderDialog();
  dlg.showModal();
}
