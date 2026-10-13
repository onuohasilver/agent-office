// A project's user journeys, drawn as a flow canvas over the office view:
// steps as cards, arrows between them, one journey at a time. Drag to pan,
// scroll or pinch to zoom, click a step for what it is and where it lives.
//
// The map is written by an agent (server/journeys.js); with none yet, the
// canvas offers to have one drawn and shows the job while it runs.

import dagre from '@dagrejs/dagre';
import { api } from './hud.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND = {
  entry: { name: 'Entry', icon: '<path d="M5 12h12M13 7l5 5-5 5"/>' },
  screen: { name: 'Screen', icon: '<rect x="4" y="5" width="16" height="12" rx="2"/><path d="M9 20h6"/>' },
  action: { name: 'Action', icon: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a5 5 0 0 1-5 5h-1a5 5 0 0 1-4.3-2.5L5.5 14a1.5 1.5 0 0 1 2.5-1.6L9 14"/>' },
  decision: { name: 'Decision', icon: '<path d="M12 3l9 9-9 9-9-9z"/>' },
  system: { name: 'System', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>' },
  end: { name: 'End', icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>' },
};
const W = 208, H = 64;
const ago = (ms) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

let app = null;
let root = null;
let repo = null;
let data = null;      // { map, job } from /api/journeys
let pick = 0;         // which journey
let chosen = null;    // the step id open in the inspector
let view = { x: 0, y: 0, k: 1 };
let error = '';
let onClose = null;  // where to go back to (the Projects list, on a phone)

export function initJourneys(a) { app = a; }

export async function openJourneys(name, back = null) {
  onClose = back;
  repo = name; data = null; pick = 0; chosen = null; error = '';
  if (!root) build();
  root.hidden = false;
  root.parentElement.classList.add('jm-open');
  paint();
  await load();
  root.querySelector('.jm-x').focus();
}

export function closeJourneys() {
  if (!root || root.hidden) return;
  root.hidden = true;
  root.parentElement.classList.remove('jm-open');
  repo = null;
  onClose?.();
}

// Every job update: when the mapping job ends, fetch what it drew.
export function journeyJobs(jobs) {
  if (!repo || !data?.job) return;
  const j = jobs.find((x) => x.id === data.job);
  if (!j || (j.status !== 'working' && j.status !== 'queued')) load();
  else if (!data.map?.journeys.length) paintBody();
}

async function load() {
  const want = repo;
  try {
    const next = await api(`/api/journeys?name=${encodeURIComponent(want)}`);
    if (want !== repo) return;
    data = next; error = '';
  } catch (e) {
    if (want !== repo) return;
    data ||= { map: null, job: null };
    error = /404|Not found/i.test(e.message) ? 'Restart the office to use journey maps.' : e.message;
  }
  if (pick >= (data.map?.journeys.length || 0)) pick = 0;
  paint();
}

async function draw() {
  try {
    data = await api('/api/journeys', { name: repo });
    error = '';
  } catch (e) { error = e.message; }
  paint();
}

function build() {
  root = document.createElement('section');
  root.className = 'jmap';
  root.setAttribute('aria-label', 'User journeys');
  root.hidden = true;
  document.getElementById('view').append(root);
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'close') closeJourneys();
    else if (act === 'draw') draw();
    else if (act === 'job') app?.openJob(data.job);
    else if (act === 'pick') {
      pick = +t.dataset.i; chosen = null;
      root.querySelectorAll('.jm-picks [data-i]').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.i === pick)));
      paintBody(true);
    }
    else if (act === 'step') { chosen = chosen === t.dataset.id ? null : t.dataset.id; paintSteps(); }
    else if (act === 'fit') { fit(true); place(); }
    else if (act === 'in' || act === 'out') zoomAt(act === 'in' ? 1.2 : 1 / 1.2);
    else if (act === 'unpick') { chosen = null; paintSteps(); }
  });
  addEventListener('keydown', (e) => {
    if (root.hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (e.key === 'Escape') { e.stopPropagation(); chosen ? (chosen = null, paintSteps()) : closeJourneys(); }
    if (e.key === 'f') { fit(true); place(); }
  }, true);
}

function paint() {
  if (!root || root.hidden) return;
  const m = data?.map;
  root.innerHTML = `
    <header class="jm-bar">
      <button type="button" class="jm-x" data-act="close" aria-label="Close journeys (Esc)" title="Close (Esc)"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div class="jm-title"><b>${esc(repo)}</b><span>${m ? `${m.journeys.length} journey${m.journeys.length === 1 ? '' : 's'} · mapped ${ago(m.updatedAt)}` : 'User journeys'}</span></div>
      ${m?.journeys.length ? `<div class="jm-picks" role="tablist" aria-label="Journeys">${m.journeys.map((j, i) => `
        <button type="button" role="tab" data-act="pick" data-i="${i}" aria-selected="${i === pick}" title="${esc(j.summary || j.name)}">${esc(j.name)}<i>${j.steps.length}</i></button>`).join('')}</div>` : '<span class="jm-fill"></span>'}
      ${m ? `<button type="button" class="ghost small" data-act="${data.job ? 'job' : 'draw'}">${data.job ? 'Remapping…' : 'Remap'}</button>` : ''}
    </header>
    <div class="jm-body"></div>`;
  paintBody(true);
}

function paintBody(refit) {
  const body = root?.querySelector('.jm-body');
  if (!body) return;
  const m = data?.map;
  const busy = data?.job && app?.jobs.get(data.job);
  if (!data) { body.innerHTML = skeleton('Opening the map…'); return; }
  if (!m?.journeys.length) {
    body.innerHTML = busy
      ? skeleton(`${esc(app.doer(busy))} is reading ${esc(repo)} and mapping its journeys.`, true)
      : `<div class="jm-empty">
          <svg viewBox="0 0 64 40" aria-hidden="true"><rect x="2" y="12" width="16" height="16" rx="4"/><rect x="46" y="2" width="16" height="16" rx="4"/><rect x="46" y="22" width="16" height="16" rx="4"/><path d="M18 20c14 0 14-10 28-10M18 20c14 0 14 10 28 10"/></svg>
          <h3>No journey map for ${esc(repo)} yet</h3>
          <p>An agent reads the code and draws every route a person takes through it: signing up, the main tasks, the dead ends. It leaves the project untouched and takes a few minutes.</p>
          ${error ? `<p class="jm-err">${esc(error)}</p>` : ''}
          <button type="button" class="primary" data-act="draw">Map the journeys</button>
        </div>`;
    return;
  }
  const j = m.journeys[pick];
  body.innerHTML = `
    <div class="jm-canvas" tabindex="-1">
      <div class="jm-world"><svg class="jm-wires" aria-hidden="true"></svg><div class="jm-steps"></div></div>
    </div>
    ${j.summary ? `<p class="jm-sum">${esc(j.summary)}</p>` : ''}
    <div class="jm-zoom chip tools">
      <button type="button" data-act="out" aria-label="Zoom out" title="Zoom out"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button>
      <button type="button" data-act="fit" aria-label="Fit to screen (F)" title="Fit (F)"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg></button>
      <button type="button" data-act="in" aria-label="Zoom in" title="Zoom in"><svg viewBox="0 0 24 24"><path d="M6 12h12M12 6v12"/></svg></button>
    </div>
    <aside class="jm-card" hidden></aside>`;
  layout(j);
  bindPan(body.querySelector('.jm-canvas'));
  paintSteps();
  if (refit || !j._fit) { fit(); j._fit = true; }
  place();
}

function skeleton(say, live) {
  return `<div class="jm-skel" aria-busy="true">
    <div class="jm-ghosts" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<i style="--i:${i}"></i>`).join('<b></b>')}</div>
    <p>${say}</p>
    ${live ? '<button type="button" class="ghost small" data-act="job">Watch the job</button>' : ''}
  </div>`;
}

// Left to right, the way a person moves through it, laid out by dagre: rows
// stay straight, a wire that skips a column runs through the gap between
// cards rather than behind one, and every edge label gets room of its own.
// Wires back to an earlier step (a retry, "try again") are left out of the
// layout so they can't bend it, and run along lanes underneath instead.
function layout(j) {
  const out = new Map(j.steps.map((s) => [s.id, []]));
  const indeg = new Map(j.steps.map((s) => [s.id, 0]));
  for (const e of j.edges) { out.get(e.from).push(e.to); indeg.set(e.to, indeg.get(e.to) + 1); }
  const seen = new Set(), onPath = new Set(), back = new Set();
  const walk = (id) => {
    seen.add(id); onPath.add(id);
    for (const to of out.get(id)) {
      if (onPath.has(to)) back.add(`${id}>${to}`);
      else if (!seen.has(to)) walk(to);
    }
    onPath.delete(id);
  };
  const starts = j.steps.filter((s) => s.kind === 'entry' || !indeg.get(s.id));
  for (const s of (starts.length ? starts : [j.steps[0]])) if (!seen.has(s.id)) walk(s.id);
  for (const s of j.steps) if (!seen.has(s.id)) walk(s.id);

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 64, edgesep: 18, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const s of j.steps) g.setNode(s.id, { width: W, height: H });
  j.edges.forEach((e, i) => {
    if (back.has(`${e.from}>${e.to}`)) return;
    g.setEdge(e.from, e.to, e.label ? { width: tagWidth(e.label), height: 22, labelpos: 'c' } : {}, `e${i}`);
  });
  dagre.layout(g);
  j._pos = new Map(j.steps.map((s) => { const n = g.node(s.id); return [s.id, { x: n.x - W / 2, y: n.y - H / 2 }]; }));
  j._route = new Map();
  j.edges.forEach((e, i) => {
    const r = g.edge({ v: e.from, w: e.to, name: `e${i}` });
    if (r) j._route.set(i, { points: r.points, lx: r.x, ly: r.y });
  });
  j._back = back;
}

// Roughly how wide a label pill is, so the layout can leave room for it.
const tagWidth = (t) => Math.min(120, 18 + t.length * 6.4);

// A run of S-curves through the points, leaving and arriving level, the way
// node editors draw a wire.
function curve(pts) {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const c = Math.max(12, Math.abs(b.x - a.x) / 2);
    d += ` C${a.x + c},${a.y} ${b.x - c},${b.y} ${b.x},${b.y}`;
  }
  return d;
}

function paintSteps() {
  const j = data?.map?.journeys[pick];
  const steps = root?.querySelector('.jm-steps');
  if (!j || !steps) return;
  const near = new Set(chosen ? j.edges.flatMap((e) => (e.from === chosen ? [e.to] : e.to === chosen ? [e.from] : [])) : []);
  steps.innerHTML = j.steps.map((s) => {
    const p = j._pos.get(s.id);
    const k = KIND[s.kind];
    const cls = [s.kind, s.id === chosen && 'on', chosen && s.id !== chosen && !near.has(s.id) && 'dim'].filter(Boolean).join(' ');
    return `<button type="button" class="jm-step ${cls}" data-act="step" data-id="${esc(s.id)}" style="left:${p.x}px;top:${p.y}px" aria-pressed="${s.id === chosen}">
      <span class="k"><svg viewBox="0 0 24 24" aria-hidden="true">${k.icon}</svg></span>
      <span class="t"><b>${esc(s.label)}</b><small>${k.name}</small></span>
    </button>`;
  }).join('');
  let minX = Infinity, minY = Infinity, maxY = -Infinity, maxX = -Infinity;
  for (const p of j._pos.values()) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + W);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + H);
  }
  // Forward wires leave from the right port and land on the left one, through
  // the bends dagre found. Loops back run underneath, one lane each.
  let lane = 0;
  const wires = j.edges.map((e, i) => {
    const a = j._pos.get(e.from), b = j._pos.get(e.to);
    let d, lx, ly, loop = false;
    const r = j._route.get(i);
    if (r) {
      const mids = r.points.slice(1, -1);
      d = curve([{ x: a.x + W, y: a.y + H / 2 }, ...mids, { x: b.x, y: b.y + H / 2 }]);
      lx = r.lx; ly = r.ly;
    } else {
      loop = true;
      const under = maxY + 30 + lane++ * 18;
      const x1 = a.x + W / 2, x2 = b.x + W / 2, y1 = a.y + H, y2 = b.y + H;
      const t = Math.sign(x2 - x1) * Math.min(14, Math.abs(x2 - x1) / 2);
      d = `M${x1},${y1} L${x1},${under - 14} Q${x1},${under} ${x1 + t},${under} L${x2 - t},${under} Q${x2},${under} ${x2},${under - 14} L${x2},${y2}`;
      lx = (x1 + x2) / 2; ly = under;
    }
    const lit = chosen && (e.from === chosen || e.to === chosen);
    return { d, lx, ly, label: e.label, cls: [lit ? 'lit' : chosen ? 'dim' : '', loop && 'loop'].filter(Boolean).join(' ') };
  });
  if (lane) maxY += 30 + lane * 18;
  const svg = root.querySelector('.jm-wires');
  const pad = 80, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
  svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${w} ${h}`);
  Object.assign(svg.style, { left: `${minX - pad}px`, top: `${minY - pad}px`, width: `${w}px`, height: `${h}px` });
  svg.innerHTML = `<defs><marker id="jm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1l8 4-8 4"/></marker></defs>` +
    wires.map((w) => `<path class="${w.cls}" d="${w.d}" marker-end="url(#jm-arrow)"/>`).join('') +
    wires.filter((w) => w.label).map((w) => `<foreignObject x="${w.lx - 60}" y="${w.ly - 11}" width="120" height="22" class="${w.cls}"><span class="jm-tag">${esc(w.label)}</span></foreignObject>`).join('');
  j._box = { minX, minY, maxY, maxX };
  paintCard(j);
}

function paintCard(j) {
  const card = root.querySelector('.jm-card');
  const s = chosen && j.steps.find((x) => x.id === chosen);
  card.hidden = !s;
  if (!s) return;
  const ins = j.edges.filter((e) => e.to === s.id), outs = j.edges.filter((e) => e.from === s.id);
  const name = (id) => esc(j.steps.find((x) => x.id === id)?.label || id);
  const list = (es, side) => es.map((e) => `<li><button type="button" class="link" data-act="step" data-id="${esc(e[side])}">${name(e[side])}</button>${e.label ? ` <small>${esc(e.label)}</small>` : ''}</li>`).join('');
  card.innerHTML = `
    <header><span class="jm-kind ${s.kind}">${KIND[s.kind].name}</span><button type="button" class="x" data-act="unpick" aria-label="Close">×</button></header>
    <h4>${esc(s.label)}</h4>
    ${s.detail ? `<p>${esc(s.detail)}</p>` : ''}
    ${s.where ? `<code>${esc(s.where)}</code>` : ''}
    ${ins.length ? `<h5>Comes from</h5><ul>${list(ins, 'from')}</ul>` : ''}
    ${outs.length ? `<h5>Leads to</h5><ul>${list(outs, 'to')}</ul>` : ''}`;
}

// ---------- pan and zoom ----------

// The whole journey when it fits at a size you can read; a long one opens
// at its entry instead, and `all` (Fit, F, double-click) zooms out to see it.
function fit(all) {
  const j = data?.map?.journeys[pick];
  const c = root?.querySelector('.jm-canvas');
  if (!j?._box || !c) return;
  const { width, height } = c.getBoundingClientRect();
  const { minX, minY, maxX, maxY } = j._box;
  const w = maxX - minX, h = maxY - minY;
  const whole = Math.min(1.1, (width - 120) / w, (height - 160) / h);
  const k = Math.max(all ? 0.2 : 0.62, whole);
  // Too wide: start at the entry. Too tall: start at the top.
  const x = w * k > width - 120 ? 60 : (width - w * k) / 2;
  const y = h * k > height - 160 ? 80 : (height - h * k) / 2;
  view = { k, x: x - minX * k, y: y - minY * k };
}

function place() {
  const w = root?.querySelector('.jm-world');
  const c = root?.querySelector('.jm-canvas');
  if (!w) return;
  w.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  // The dot grid moves with the map, so panning feels like moving paper.
  c.style.backgroundPosition = `${view.x}px ${view.y}px`;
  c.style.backgroundSize = `${22 * view.k}px ${22 * view.k}px`;
}

function zoomAt(f, cx, cy) {
  const c = root.querySelector('.jm-canvas').getBoundingClientRect();
  cx ??= c.width / 2; cy ??= c.height / 2;
  const k = Math.min(2.5, Math.max(0.2, view.k * f));
  view.x = cx - (cx - view.x) * (k / view.k);
  view.y = cy - (cy - view.y) * (k / view.k);
  view.k = k;
  place();
}

function bindPan(c) {
  const ptrs = new Map();
  let pinch = 0;
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = c.getBoundingClientRect();
    // A pinch on a trackpad arrives as a wheel with ctrl held; two-finger scroll pans.
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else { view.x -= e.deltaX; view.y -= e.deltaY; place(); }
  }, { passive: false });
  c.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.jm-step')) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    c.setPointerCapture(e.pointerId);
    c.classList.add('grab');
  });
  c.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a2, b2] = [...ptrs.values()];
      const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      const r = c.getBoundingClientRect();
      if (before && pinch++) zoomAt(after / before, (a2.x + b2.x) / 2 - r.left, (a2.y + b2.y) / 2 - r.top);
      return;
    }
    view.x += e.clientX - p.x; view.y += e.clientY - p.y;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    place();
  });
  const up = (e) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = 0;
    if (!ptrs.size) c.classList.remove('grab');
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
  c.addEventListener('dblclick', (e) => { if (!e.target.closest('.jm-step')) { fit(true); place(); } });
}

addEventListener('resize', () => { if (root && !root.hidden) place(); });
