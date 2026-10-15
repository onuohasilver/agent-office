import * as THREE from 'three';
import { deskRect, tableRect, poolRect, FLOOR } from './office.js';
import { footRect } from './decor.js';

// Build mode, the way The Sims does it: pick a thing up, slide it about on a
// snapped grid with a green or red patch under it, put it down. Desks, the
// communal table, the pool table and anything the office has bought can all
// be moved. The room's grid, stations and seats are worked out when it is
// built, so the arrangement is saved per layout and the page reloads once
// you're done (see arrangedKey).

const SNAP = 0.5;
const LIFT = 0.18;
// The team's floor, short of the glass line to the guest wing.
const BOUNDS = [FLOOR.x0 + 0.2, 20.2, FLOOR.z0 + 0.2, FLOOR.z1 - 0.2];

const arrangedKey = (layoutId) => `office.arrange.${layoutId || 'layout-classic'}`;
export function loadArrangement(layoutId) {
  try { return JSON.parse(localStorage.getItem(arrangedKey(layoutId)) || 'null') || undefined; } catch { return undefined; }
}
const save = (layoutId, custom) => {
  try {
    if (Object.keys(custom.desks || {}).length || custom.table || custom.pool || Object.keys(custom.items || {}).length) localStorage.setItem(arrangedKey(layoutId), JSON.stringify(custom));
    else localStorage.removeItem(arrangedKey(layoutId));
  } catch { /* private mode: it just won't stick */ }
};

const overlaps = (a, b) => a[0] < b[1] - 1e-3 && a[1] > b[0] + 1e-3 && a[2] < b[3] - 1e-3 && a[3] > b[2] + 1e-3;
const snap = (v) => Math.round(v / SNAP) * SNAP;

export function initBuild({ renderer, camera, controls, scene, office, layoutId, aim, ray }) {
  const custom = structuredClone(office.custom || {});
  custom.desks ||= {};
  custom.items ||= {};
  const el = renderer.domElement;
  const state = { on: false, dirty: false };

  // Everything that can be picked up, read fresh each time: the office's
  // items arrive after the economy does.
  function things() {
    const out = office.desks.map((d, i) => ({
      key: `desk${i}`, group: d.group, turn: Math.PI, label: `Desk ${i + 1}`,
      rect: (g) => deskRect(g.position.x, g.position.z, turned(g)),
      commit: (g) => { custom.desks[i] = [g.position.x, g.position.z, turned(g)]; },
    }));
    out.push({ key: 'table', group: office.table, label: 'Table', rect: (g) => tableRect(g.position.x, g.position.z), commit: (g) => { custom.table = [g.position.x, g.position.z]; } });
    out.push({ key: 'pool', group: office.pool, label: 'Pool table', rect: (g) => poolRect(g.position.x, g.position.z), commit: (g) => { custom.pool = [g.position.x, g.position.z]; } });
    for (const g of office.decor || []) {
      const id = g.name.replace(/^decor-/, '');
      out.push({
        key: id, group: g, turn: Math.PI / 2, label: id[0].toUpperCase() + id.slice(1),
        rect: (o) => footRect(id, o.position.x, o.position.z, o.rotation.y),
        commit: (o) => { custom.items[id] = [o.position.x, o.position.z, o.rotation.y]; },
      });
    }
    return out;
  }
  // A desk is turned when it has been spun half way round.
  const turned = (g) => Math.cos(g.rotation.y) < 0;

  // Why `t` can't stand where it is, or '' if it can.
  function problem(t, all) {
    const r = t.rect(t.group);
    if (r[0] < BOUNDS[0] || r[1] > BOUNDS[1] || r[2] < BOUNDS[2] || r[3] > BOUNDS[3]) return 'that is off the floor';
    const f = office.fixed;
    const [i0, j0] = f.cellOf(r[0], r[2]);
    const [i1, j1] = f.cellOf(r[1] - 1e-6, r[3] - 1e-6);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (f.blocked(i, j)) return 'something fixed is in the way';
    const o = all.find((x) => x.key !== t.key && overlaps(r, x.rect(x.group)));
    return o ? `${o.label} is in the way` : '';
  }
  const fits = (t, all) => !problem(t, all);

  // ---------- the patches on the floor ----------

  const patches = new Map();
  const mats = {
    rest: new THREE.MeshBasicMaterial({ color: '#7aa2ff', transparent: true, opacity: 0.16, depthWrite: false }),
    ok: new THREE.MeshBasicMaterial({ color: '#38c172', transparent: true, opacity: 0.5, depthWrite: false }),
    bad: new THREE.MeshBasicMaterial({ color: '#e5484d', transparent: true, opacity: 0.55, depthWrite: false }),
  };
  const plane = new THREE.PlaneGeometry(1, 1);
  function patch(t, kind = 'rest') {
    let m = patches.get(t.key);
    if (!m) {
      m = new THREE.Mesh(plane, mats.rest);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 5;
      scene.add(m);
      patches.set(t.key, m);
    }
    const r = t.rect(t.group);
    m.scale.set(r[1] - r[0], r[3] - r[2], 1);
    m.position.set((r[0] + r[1]) / 2, 0.045, (r[2] + r[3]) / 2);
    m.material = mats[kind];
    m.visible = true;
  }
  function paintAll() {
    const keep = new Set();
    for (const t of things()) { keep.add(t.key); patch(t, t.key === picked?.key ? 'ok' : 'rest'); }
    for (const [k, m] of patches) if (!keep.has(k)) { scene.remove(m); patches.delete(k); }
  }
  const hidePatches = () => { for (const m of patches.values()) m.visible = false; };

  // ---------- picking up and putting down ----------

  let picked = null; // the last thing touched: R and the Turn button act on it
  let held = null; // { t, from: [x, z, rotY], dx, dz }
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const at = new THREE.Vector3();

  function hit(e) {
    aim(e);
    const all = things();
    const h = ray.intersectObjects(all.map((t) => t.group), true)[0];
    if (!h) return null;
    return all.find((t) => { for (let o = h.object; o; o = o.parent) if (o === t.group) return true; return false; });
  }
  const ground = (e) => { aim(e); return ray.ray.intersectPlane(floor, at) ? at : null; };

  function status(text, bad) {
    hint.textContent = text;
    hint.classList.toggle('bad', !!bad);
  }

  function down(e) {
    if (!state.on || e.button !== 0) return;
    const t = hit(e);
    if (!t) return;
    const p = ground(e);
    if (!p) return;
    controls.enabled = false;
    e.stopImmediatePropagation();
    picked = t;
    held = { t, from: [t.group.position.x, t.group.position.z, t.group.rotation.y], dx: p.x - t.group.position.x, dz: p.z - t.group.position.z };
    t.group.position.y = LIFT;
    el.style.cursor = 'grabbing';
    el.setPointerCapture?.(e.pointerId);
    status(`${t.label}: drop it where you want it`);
    paintAll();
    patch(t, 'ok');
  }
  function move(e) {
    if (!state.on) return;
    if (!held) {
      if (e.buttons) return;
      el.style.cursor = hit(e) ? 'grab' : '';
      return;
    }
    const p = ground(e);
    if (!p) return;
    const { t } = held;
    t.group.position.x = snap(p.x - held.dx);
    t.group.position.z = snap(p.z - held.dz);
    patch(t, fits(t, things()) ? 'ok' : 'bad');
  }
  function up() {
    controls.enabled = true;
    if (!held) return;
    const { t, from } = held;
    held = null;
    const why = problem(t, things());
    if (why) {
      t.group.position.x = from[0];
      t.group.position.z = from[1];
      t.group.rotation.y = from[2];
      status(`${t.label} went back: ${why}`, true);
    } else if (t.group.position.x !== from[0] || t.group.position.z !== from[1]) {
      t.commit(t.group);
      mark();
      status(`${t.label} moved`);
    }
    t.group.position.y = 0;
    el.style.cursor = '';
    paintAll();
  }
  function cancel() {
    if (!held) return;
    const { t, from } = held;
    t.group.position.set(from[0], 0, from[1]);
    t.group.rotation.y = from[2];
    held = null;
    controls.enabled = true;
    paintAll();
    status('Put back');
  }
  function mark() {
    state.dirty = true;
    save(layoutId, custom);
  }

  // Turn what's picked, or what's under the pointer. A turn that wouldn't fit
  // is undone.
  function turn() {
    const t = held?.t || picked;
    if (!t) return status('Click something first, then turn it');
    if (!t.turn) return status(`${t.label} can't be turned`, true);
    const was = t.group.rotation.y;
    t.group.rotation.y = was + t.turn;
    if (held) { patch(t, fits(t, things()) ? 'ok' : 'bad'); return; }
    if (!fits(t, things())) {
      t.group.rotation.y = was;
      return status(`There's no room to turn ${t.label} there`, true);
    }
    t.commit(t.group);
    mark();
    paintAll();
    status(`${t.label} turned`);
  }

  // ---------- the bar ----------

  const bar = document.createElement('div');
  bar.className = 'build-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Arrange the office');
  bar.innerHTML = `
    <b>Arrange</b>
    <span class="build-hint" role="status" aria-live="polite"></span>
    <button type="button" data-do="turn" title="Turn it (R)">Turn</button>
    <button type="button" data-do="reset" title="Put everything back where this layout had it">Reset</button>
    <button type="button" class="primary" data-do="done">Done</button>`;
  document.querySelector('.view')?.appendChild(bar);
  const hint = bar.querySelector('.build-hint');
  const DEFAULT_HINT = 'Drag anything to move it. R turns it.';

  function start() {
    if (state.on) return;
    state.on = true;
    document.body.classList.add('building');
    bar.hidden = false;
    picked = null;
    status(DEFAULT_HINT);
    paintAll();
    button?.setAttribute('aria-pressed', 'true');
  }
  function stop() {
    if (!state.on) return;
    cancel();
    state.on = false;
    document.body.classList.remove('building');
    bar.hidden = true;
    hidePatches();
    el.style.cursor = '';
    button?.setAttribute('aria-pressed', 'false');
    // The grid, the seats and the stations were laid out for the old plan.
    if (state.dirty) location.reload();
  }
  bar.addEventListener('click', (e) => {
    const what = e.target.closest('[data-do]')?.dataset.do;
    if (what === 'turn') turn();
    else if (what === 'done') stop();
    else if (what === 'reset') {
      try { localStorage.removeItem(arrangedKey(layoutId)); } catch { /* nothing to undo */ }
      state.dirty = false;
      location.reload();
    }
  });

  const button = document.getElementById('arrange');
  button?.addEventListener('click', () => (state.on ? stop() : start()));

  // Capture phase, so these get in ahead of the camera's own drag and the
  // office's click-to-chat.
  el.addEventListener('pointerdown', down, true);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  addEventListener('keydown', (e) => {
    if (!state.on || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === 'r') { e.stopImmediatePropagation(); e.preventDefault(); turn(); }
    else if (k === 'escape') { e.stopImmediatePropagation(); held ? cancel() : stop(); }
  }, true);

  return state;
}
