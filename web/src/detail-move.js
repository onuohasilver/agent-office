// The job card floats over the office in Dock mode, so it can be dragged by its
// top (the status row and the title) out of the way of whatever is behind it,
// and pulled out by any edge or corner to resize it. Arrow keys nudge it from
// the status row (Shift resizes), double-click puts it back. Where you left it
// and how big it is are remembered. In Sidebar mode and on a phone it is a docked column
// and none of this applies.

const KEY = 'office.detailMove';
const KEEP = 72; // how much must stay on screen, so it can always be dragged back
const STEP = 16;
const MIN_W = 320, MIN_H = 240;
const GRAB = 7; // how close to an edge counts as the edge
const el = document.getElementById('detail');
const root = document.documentElement;

// x, y: how far it has moved from where the stylesheet puts it; w, h: its size, or null for the stylesheet's.
let at = { x: 0, y: 0, w: null, h: null };
try {
  const s = JSON.parse(localStorage.getItem(KEY));
  if (Number.isFinite(s?.x) && Number.isFinite(s?.y)) at = { x: s.x, y: s.y, w: Number.isFinite(s.w) ? s.w : null, h: Number.isFinite(s.h) ? s.h : null };
} catch { /* first visit */ }

const floating = () => matchMedia('(min-width: 861px)').matches && getComputedStyle(el).position === 'fixed';
const apply = () => {
  el.style.setProperty('--dx', `${at.x}px`);
  el.style.setProperty('--dy', `${at.y}px`);
  el.style.width = at.w ? `${at.w}px` : '';
  el.style.height = at.h ? `${at.h}px` : '';
};
// Put the card at offset (x, y), kept far enough on screen to be grabbed again.
const place = (x, y) => {
  const r = el.getBoundingClientRect();
  const left = r.left - at.x, top = r.top - at.y; // where it sits with no offset
  at = {
    ...at,
    x: Math.min(innerWidth - KEEP - left, Math.max(KEEP - r.width - left, x)),
    y: Math.min(innerHeight - 44 - top, Math.max(-top, y)),
  };
  apply();
};
// Resize to w by h, from the corner or edge `mode` names: the opposite side stays put.
const resize = (mode, from, dx, dy) => {
  const maxW = Math.max(MIN_W, innerWidth - 16), maxH = Math.max(MIN_H, innerHeight - 16);
  let { x, y, w, h } = from;
  // The card is pinned to the right of the screen, so its right edge stays put
  // when its width changes; dragging the east edge has to move it to follow.
  if (mode.includes('e')) { w = Math.min(maxW, Math.max(MIN_W, from.w + dx)); x = from.x + w - from.w; }
  if (mode.includes('s')) h = Math.min(maxH, Math.max(MIN_H, from.h + dy));
  if (mode.includes('w')) w = Math.min(maxW, Math.max(MIN_W, from.w - dx));
  if (mode.includes('n')) { h = Math.min(maxH, Math.max(MIN_H, from.h - dy)); y = from.y + from.h - h; }
  at = { x, y, w, h };
  apply();
};
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(at)); } catch { /* it just won't stick */ } };
const handle = (t) => t.closest('.d-head, h2') && !t.closest('button, a, input');

const edgeAt = (e) => {
  const r = el.getBoundingClientRect();
  const n = e.clientY - r.top < GRAB, so = r.bottom - e.clientY < GRAB;
  const w = e.clientX - r.left < GRAB, ea = r.right - e.clientX < GRAB;
  return (n ? 'n' : so ? 's' : '') + (w ? 'w' : ea ? 'e' : '');
};
const CURSOR = { n: 'ns', s: 'ns', e: 'ew', w: 'ew', ne: 'nesw', sw: 'nesw', nw: 'nwse', se: 'nwse' };

apply();
let drag = null;
el.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !floating()) return;
  const edge = edgeAt(e);
  if (!edge && !handle(e.target)) return;
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  const r = el.getBoundingClientRect();
  drag = { id: e.pointerId, mode: edge || 'move', px: e.clientX, py: e.clientY, from: { x: at.x, y: at.y, w: r.width, h: r.height } };
  el.classList.add('moving');
});
el.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (!e.buttons && floating()) el.style.cursor = CURSOR[edgeAt(e)] ? `${CURSOR[edgeAt(e)]}-resize` : '';
    return;
  }
  if (e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
  if (drag.mode === 'move') place(drag.from.x + dx, drag.from.y + dy);
  else resize(drag.mode, drag.from, dx, dy);
});
const end = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null;
  el.classList.remove('moving');
  keep();
};
el.addEventListener('pointerup', end);
el.addEventListener('pointercancel', end);
el.addEventListener('dblclick', (e) => {
  // A drag captures the pointer, so the event's own target is the card itself.
  if (!floating() || edgeAt(e) || !handle(document.elementFromPoint(e.clientX, e.clientY) || e.target)) return;
  at = { x: 0, y: 0, w: null, h: null };
  apply();
  keep();
});
el.addEventListener('keydown', (e) => {
  if (!floating() || !e.target.matches?.('.d-head')) return;
  const dx = e.key === 'ArrowLeft' ? -STEP : e.key === 'ArrowRight' ? STEP : 0;
  const dy = e.key === 'ArrowUp' ? -STEP : e.key === 'ArrowDown' ? STEP : 0;
  if (!dx && !dy) return;
  e.preventDefault();
  if (e.shiftKey) {
    const r = el.getBoundingClientRect();
    resize('se', { x: at.x, y: at.y, w: r.width, h: r.height }, dx, dy);
  } else place(at.x + dx, at.y + dy);
  keep();
});
addEventListener('resize', () => { if (floating() && !el.hidden) { place(at.x, at.y); } });
new MutationObserver(() => { if (floating() && !el.hidden) place(at.x, at.y); }).observe(root, { attributes: true, attributeFilter: ['data-nav'] });
