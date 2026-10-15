// Chat, Jobs, Projects and Team each get their own window on a wide screen: drag
// the title bar, pull any edge or corner to resize, close with the x, click to
// bring one to the front. Where each one sits is remembered. On a phone there is
// no room for windows, so the same sections go back into the sidebar and take
// turns like they always did.

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const app = $('app');
const side = document.querySelector('.side');

const KEY = 'office.panes';
const Z = 21000; // above the agent name labels (20000), below the dock and the brand card (30000)
const MIN_W = 300, MIN_H = 220;
const KEEP = 72; // how much of a window must stay on screen, so it can always be dragged back
const BOTTOM = 84; // leave the dock room
const STEP = 16;
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const DEFS = {
  chat: { title: 'Chat', sections: ['chatPane', 'threadPane'], w: 440 },
  jobs: { title: 'Jobs', sections: ['jobsPane'], w: 400 },
  projects: { title: 'Projects', sections: ['projectsPane'], w: 400 },
  team: { title: 'Team', sections: ['teamPane'], w: 400 },
  needs: { title: 'Needs you', sections: ['needsPane'], w: 400 },
  // The file editor and document reader: it mounts itself in this window (see body()).
  doc: { title: 'Document', sections: [], w: 640 },
};
const NAMES = Object.keys(DEFS);
// The order the sections sit in inside the sidebar, which is where a phone wants them.
const SIDEBAR_ORDER = ['chatPane', 'threadPane', 'teamPane', 'projectsPane', 'jobsPane', 'needsPane'];

const mq = matchMedia('(max-width: 860px)');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
const state = { order: NAMES.filter((n) => (saved.order || []).includes(n)) };
for (const n of NAMES) {
  const s = saved[n] || {};
  state[n] = { open: s.open ?? n === 'chat', geo: ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(s[k])) ? { x: s.x, y: s.y, w: s.w, h: s.h } : null };
}
for (const n of NAMES) if (!state.order.includes(n)) state.order.push(n);

const save = () => {
  const out = { order: state.order };
  for (const n of NAMES) out[n] = { open: state[n].open, ...(state[n].geo || {}) };
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch {}
};

// ---------- geometry ----------

const fit = (g) => {
  const w = clamp(g.w, MIN_W, Math.max(MIN_W, innerWidth - 16));
  const h = clamp(g.h, MIN_H, Math.max(MIN_H, innerHeight - 16));
  return { w, h, x: clamp(g.x, KEEP - w, innerWidth - KEEP), y: clamp(g.y, 0, innerHeight - 44) };
};

// Chat starts under the brand card on the left; the rest cascade to its right.
const home = (name) => {
  const top = Math.max(16, Math.round(side.getBoundingClientRect().bottom) + 12);
  const room = Math.max(MIN_H, innerHeight - top - BOTTOM);
  if (name === 'chat') return fit({ x: 16, y: top, w: DEFS.chat.w, h: room });
  const k = NAMES.indexOf(name) - 1;
  const y = top + k * 28;
  return fit({ x: 16 + DEFS.chat.w + 16 + k * 28, y, w: DEFS[name].w, h: Math.min(640, Math.max(MIN_H, innerHeight - y - BOTTOM)) });
};

const wins = {};

const paint = (name) => {
  const g = state[name].geo;
  const el = wins[name];
  el.style.left = `${g.x}px`;
  el.style.top = `${g.y}px`;
  el.style.width = `${g.w}px`;
  el.style.height = `${g.h}px`;
};

const setGeo = (name, g) => { state[name].geo = fit(g); paint(name); };

const stack = () => {
  state.order.forEach((n, i) => { wins[n].style.zIndex = String(Z + i); });
  const top = [...state.order].reverse().find((n) => state[n].open);
  for (const n of NAMES) wins[n].classList.toggle('front', n === top);
};

// ---------- state the rest of the app asks about ----------

const desktop = () => !mq.matches;
// The dock puts the panels away behind the Office button; their open state is kept.
const stowed = () => root.dataset.nav === 'dock' && app.dataset.m === 'office';
const isOpen = (name) => desktop() && state[name].open;
const visible = (name) => (desktop()
  ? state[name].open && !stowed()
  : !$(DEFS[name].sections[0]).hidden);

const launchers = (name) => document.querySelectorAll(`.tabs [data-tab="${name}"], #mnav [data-m="${name}"]`);

// The tab row and the dock show which windows are up.
const sync = () => {
  if (!desktop()) return;
  const stow = stowed();
  for (const n of NAMES) {
    const on = state[n].open && !stow;
    launchers(n).forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }
  const office = document.querySelector('#mnav [data-m="office"]');
  office?.classList.toggle('on', stow);
};

// ---------- opening, closing, raising ----------

const raise = (name) => {
  if (state.order[state.order.length - 1] === name) return;
  state.order = state.order.filter((n) => n !== name).concat(name);
  stack();
  save();
};

const show = (name) => {
  if (!desktop()) return;
  const s = state[name];
  if (!s.geo) setGeo(name, home(name));
  s.open = true;
  wins[name].hidden = false;
  raise(name);
  stack();
  save();
  sync();
};

const close = (name) => {
  const el = wins[name];
  const hadFocus = el.contains(document.activeElement);
  state[name].open = false;
  el.hidden = true;
  document.dispatchEvent(new CustomEvent('pane:closed', { detail: name }));
  stack();
  save();
  sync();
  if (hadFocus) [...launchers(name)].find((b) => b.offsetParent)?.focus();
};

// A launcher press closes a window that is already on top and says so; for any
// other window it does nothing, and the caller opens or raises it.
const toggle = (name) => {
  const onTop = state[name].open && !stowed() && wins[name].classList.contains('front');
  if (onTop) close(name);
  return onTop;
};

// ---------- building the windows ----------

const build = (name) => {
  const d = DEFS[name];
  const el = document.createElement('section');
  el.className = 'win';
  el.dataset.pane = name;
  el.hidden = true;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', d.title);
  el.innerHTML = `
    <header class="win-bar" tabindex="0" aria-label="${d.title} window. Drag to move, arrow keys nudge it, Shift and arrows resize it, double-click puts it back.">
      <b class="win-title">${d.title}</b>
      <span class="win-badge" aria-hidden="true"></span>
      <button type="button" class="win-x" aria-label="Close ${d.title}" title="Close ${d.title}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </header>
    <div class="win-body"></div>
    ${EDGES.map((e) => `<i class="win-rz" data-edge="${e}" aria-hidden="true"></i>`).join('')}`;
  wins[name] = el;

  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    raise(name);
    if (e.button !== 0 || e.target.closest('.win-x')) return;
    const edge = e.target.closest('.win-rz')?.dataset.edge;
    const mode = edge || (e.target.closest('.win-bar') ? 'move' : null);
    if (!mode) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, mode, px: e.clientX, py: e.clientY, from: { ...state[name].geo } };
    app.classList.add('pane-drag');
    el.classList.add('moving');
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
    const { mode, from } = drag;
    let { x, y, w, h } = from;
    if (mode === 'move') { x += dx; y += dy; }
    else {
      if (mode.includes('e')) w = Math.max(MIN_W, from.w + dx);
      if (mode.includes('s')) h = Math.max(MIN_H, from.h + dy);
      if (mode.includes('w')) { w = Math.max(MIN_W, from.w - dx); x = from.x + from.w - w; }
      if (mode.includes('n')) { y = Math.max(0, from.y + dy); h = Math.max(MIN_H, from.y + from.h - y); y = from.y + from.h - h; }
    }
    setGeo(name, { x, y, w, h });
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    app.classList.remove('pane-drag');
    el.classList.remove('moving');
    save();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);

  const bar = el.querySelector('.win-bar');
  bar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.win-x')) return;
    setGeo(name, home(name));
    save();
  });
  bar.addEventListener('keydown', (e) => {
    if (e.target !== bar) return;
    const dx = e.key === 'ArrowLeft' ? -STEP : e.key === 'ArrowRight' ? STEP : 0;
    const dy = e.key === 'ArrowUp' ? -STEP : e.key === 'ArrowDown' ? STEP : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const g = state[name].geo;
    setGeo(name, e.shiftKey ? { ...g, w: g.w + dx, h: g.h + dy } : { ...g, x: g.x + dx, y: g.y + dy });
    save();
  });
  el.querySelector('.win-x').addEventListener('click', () => close(name));
  return el;
};

const layer = document.createElement('div');
layer.id = 'wins';
for (const n of NAMES) layer.append(build(n));
document.body.append(layer);

// Sections live in their windows on a wide screen and in the sidebar on a phone.
const place = () => {
  if (desktop()) {
    for (const n of NAMES) {
      const body = wins[n].querySelector('.win-body');
      for (const id of DEFS[n].sections) body.append($(id));
    }
  } else {
    for (const id of SIDEBAR_ORDER) side.append($(id));
  }
};

const refit = () => {
  for (const n of NAMES) if (state[n].geo) setGeo(n, state[n].geo);
};

// Settings can flip between Dock and Sidebar, which changes whether the windows are stowed.
const changed = () => { sync(); document.dispatchEvent(new Event('panes:mode')); };

const setup = () => {
  place();
  for (const n of NAMES) {
    if (desktop() && state[n].open) {
      if (!state[n].geo) setGeo(n, home(n));
      else paint(n);
      wins[n].hidden = false;
    } else wins[n].hidden = true;
  }
  stack();
  sync();
};

mq.addEventListener('change', () => { setup(); changed(); });
new MutationObserver(changed).observe(root, { attributes: true, attributeFilter: ['data-nav'] });
addEventListener('resize', refit);

// A tab's count rides on its window's title.
for (const [pane, id] of [['jobs', 'jobCount'], ['needs', 'needsCount']]) {
  const count = $(id);
  const badge = wins[pane].querySelector('.win-badge');
  const copy = () => { badge.textContent = count.textContent; };
  new MutationObserver(copy).observe(count, { childList: true, characterData: true, subtree: true });
  copy();
}

setup();

const body = (name) => wins[name].querySelector('.win-body');

export const panes = { body, desktop, stowed, isOpen, visible, show, close, toggle, sync };
