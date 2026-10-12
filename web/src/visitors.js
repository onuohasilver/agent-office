import * as THREE from 'three';
import { Agent } from './agent.js';
import { LOOKS } from './figure.js';
import './visitors.css';

// Agents from linked offices, walking around ours. The server sends
// `{ t: 'visitors', offices: [{ link, handle, agents: [...] }] }` whenever a
// linked office's presence changes (see docs/proposals/linked-offices.md).
//
// Visitors never sit at our desks: they have the guest wing (see guestWing in
// office.js). Working, they take a guest desk. On a break they go to the pool
// table or the guest coffee bar. In a meeting they stand at the guest table. Away, unlinked or no longer listed, they walk
// out. At most MAX are on the floor at once; the rest are counted on a sign
// at the door. Agent ids are only unique per office, so a visitor is keyed by
// link and id.

const MAX = 10;
// One tint per linked office, so two Kais from two offices can be told apart.
const TINTS = ['#7c5cff', '#0e9f9a', '#d9488f', '#c98a12', '#3b82f6', '#65a30d'];
const COLOR = /^#[0-9a-f]{6}$/i;
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const color = (v, fallback) => (COLOR.test(v) ? v : fallback);
const STATES = new Set(['working', 'idle', 'break', 'meeting', 'away']);

// Everything here came from another machine: check the shape, cut the text,
// and only ever put it on the page as text.
function clean(offices) {
  if (!Array.isArray(offices)) return [];
  return offices.filter((o) => o && typeof o.link === 'string' && o.link).map((o) => ({
    link: clip(o.link, 80),
    handle: clip(o.handle, 40) || 'friend',
    agents: (Array.isArray(o.agents) ? o.agents : []).filter((a) => a && typeof a.id === 'string' && a.id).map((a) => ({
      id: clip(a.id, 40),
      name: clip(a.name, 40) || 'Visitor',
      role: clip(a.role, 60),
      state: STATES.has(a.state) ? a.state : 'idle',
      look: { shirt: color(a.look?.shirt, '#8a8f9c'), hair: color(a.look?.hair, '#3b2f2a'), skin: color(a.look?.skin, '#c68e63') },
      job: a.job && typeof a.job === 'object' ? { title: clip(a.job.title, 120) } : null,
    })),
  }));
}

class Visitor extends Agent {
  constructor(office, info, tint, world, labels, instant) {
    // The look (hair, trousers, extras) follows the agent's id, as it does at
    // home; ids we don't know get the default.
    const lookId = Object.hasOwn(LOOKS, info.id) ? info.id : 'visitor';
    super({ id: lookId, name: '', ...info.look }, world, labels, { desk: { seat: world.door.clone(), seatY: 0 } });
    this.key = `${office.link}:${info.id}`;
    this.id = this.key;
    this.root.traverse((o) => { o.userData.agentId = this.key; o.userData.visitor = this.key; });
    this.tint = tint;
    this.chatAt = Infinity; // our office's small talk isn't theirs
    this.hangout = Math.random() < 0.5 ? 'poolside' : 'coffee';

    // A wash of the office's tint over the figure, and a ring underfoot.
    const tc = new THREE.Color(tint);
    this.fig.group.traverse((o) => {
      if (!o.isMesh || !o.material?.color) return;
      o.material = o.material.clone();
      o.material.color.lerp(tc, 0.16);
      if (o.material.emissive) { o.material.emissive.copy(tc); o.material.emissiveIntensity = 0.07; }
    });
    this.ring.material.color.set(tint);
    this.ring.material.opacity = 0.6;
    this.ring.visible = true;

    this.label.classList.add('visitor');
    this.label.style.setProperty('--tint', tint);
    const name = this.label.querySelector('.name');
    name.replaceChildren();
    const dot = document.createElement('i');
    dot.style.background = tint;
    this.nameEl = document.createElement('span');
    this.handleEl = document.createElement('span');
    this.handleEl.className = 'handle';
    name.append(dot, this.nameEl, this.handleEl);
    this.set(office, info);
    if (instant) { this.teleport(this.want); return; }
    this.teleport('door');
    this.say(`Hi from @${office.handle}`, 'good', 4000);
  }

  set(office, info) {
    this.office = office;
    this.info = info;
    this.name = info.name;
    if (this.nameEl.textContent !== info.name) { this.nameEl.textContent = info.name; this.labelDirty = true; }
    if (this.handleEl.textContent !== ` · @${office.handle}`) { this.handleEl.textContent = ` · @${office.handle}`; this.labelDirty = true; }
    if (this.leaving) { this.leaving = false; this.say('Forgot something', 'idle', 2500); }
    this.want = this.place(info.state);
  }

  // Where this state belongs, falling back to anywhere with room.
  place(state) {
    const order = state === 'working' ? ['hotdesk', 'huddle', this.hangout]
      : state === 'meeting' ? ['huddle', 'hotdesk']
      : [this.hangout, this.hangout === 'coffee' ? 'poolside' : 'coffee', 'huddle'];
    return order.find((k) => this.roomAt(k)) || order[0];
  }

  roomAt(key) {
    return this.world.stations[key].spots.some((s) => !s.game && (!s.taken || s.taken === this.id));
  }

  // A visitor has no desk. If every spot at a station is taken, they wait in
  // the lobby instead.
  resolve(key, fresh) {
    if (key === 'desk') {
      if (this.spot) { this.spot.taken = null; this.spot = null; }
      const lobby = this.world.door.clone().add(new THREE.Vector3(1.4 + Math.random() * 1.8, 0, -1.6 + Math.random() * 0.8));
      return { key, pos: lobby, face: Math.atan2(-lobby.x, -lobby.z), pose: 'stand' };
    }
    return super.resolve(key, fresh);
  }

  leave() {
    if (this.leaving) return;
    super.leave();
    this.say(`Back to @${this.office.handle}`, 'idle', 3000);
  }

  dispose() {
    this.fig.group.traverse((o) => { if (o.isMesh) o.material.dispose(); });
    super.dispose();
  }
}

export class Visitors {
  constructor({ world, labels, camera, canvas }) {
    Object.assign(this, { world, labels, camera, canvas });
    this.on = new Map(); // key -> Visitor, including those walking out
    this.offices = [];
    this.tints = new Map();
    this.list = [];
    this.first = true;

    this.sign = document.createElement('div');
    this.sign.className = 'door-sign';
    this.sign.hidden = true;
    labels.appendChild(this.sign);

    this.card = document.createElement('div');
    this.card.className = 'visitor-card';
    this.card.hidden = true;
    labels.appendChild(this.card);
    this.ray = new THREE.Raycaster();
    canvas.addEventListener('pointermove', (e) => this.hover(e));
    canvas.addEventListener('pointerleave', () => { this.card.hidden = true; });

    if (import.meta.env.DEV) import('./visitors-dev.js').then((m) => m.install(this));
  }

  // Returns true when the message was ours alone.
  handle(msg) {
    if (msg.t === 'visitors') { this.receive(msg.offices); return true; }
    // A reload: whoever is already visiting is already in place.
    if (msg.t === 'hello' && Array.isArray(msg.visitors)) this.receive(msg.visitors, this.first);
    if (msg.t === 'hello') this.first = false;
    // An unlinked office leaves straight away, even before its last presence is dropped.
    if (msg.t === 'links' && Array.isArray(msg.links)) {
      const ids = new Set(msg.links.map((l) => l?.id));
      this.receive(this.offices.filter((o) => ids.has(o.link)));
    }
    return false;
  }

  tintOf(link) {
    if (!this.tints.has(link)) this.tints.set(link, TINTS[this.tints.size % TINTS.length]);
    return this.tints.get(link);
  }

  receive(raw, instant = false) {
    this.offices = clean(raw);
    const wanted = new Map(); // key -> [office, info], in arrival order
    const queues = this.offices.map((o) => o.agents.filter((a) => a.state !== 'away').map((a) => [`${o.link}:${a.id}`, o, a]));
    for (const q of queues) for (const [key, o, a] of q) wanted.set(key, [o, a]);

    // Whoever is already in stays in; the free places go round the offices in
    // turn, so one big office can't fill the room by itself.
    const shown = new Set([...this.on.values()].filter((v) => !v.leaving && wanted.has(v.key)).map((v) => v.key).slice(0, MAX));
    for (let i = 0; shown.size < MAX && queues.some((q) => q.length > i); i++) {
      for (const q of queues) if (q[i] && shown.size < MAX) shown.add(q[i][0]);
    }

    for (const v of this.on.values()) if (!shown.has(v.key)) v.leave();
    for (const key of shown) {
      const [o, a] = wanted.get(key);
      const v = this.on.get(key);
      if (v) v.set(o, a);
      else this.on.set(key, new Visitor(o, a, this.tintOf(o.link), this.world, this.labels, instant));
    }

    // Everyone listed and in, but not on the floor, is counted at the door.
    const extra = new Map();
    for (const [key, [o]] of wanted) if (!shown.has(key)) extra.set(o.handle, (extra.get(o.handle) || 0) + 1);
    this.sign.replaceChildren(...[...extra].map(([handle, n]) => {
      const line = document.createElement('div');
      line.textContent = `+${n} from @${handle}`;
      return line;
    }));
    this.sign.hidden = !extra.size;
    this.list = [...this.on.values()];
  }

  update(dt, t) {
    for (const v of this.on.values()) {
      v.update(dt, t);
      if (!v.gone) continue;
      v.dispose();
      this.on.delete(v.key);
      this.list = [...this.on.values()];
    }
  }

  // Labels go through main.js's declutter with everyone else's; the door sign
  // is placed here.
  placeSign(w, h) {
    if (this.sign.hidden) return;
    const v = this.world.door.clone().setY(2.7).project(this.camera);
    if (v.z > 1) { this.sign.style.display = 'none'; return; }
    this.sign.style.display = '';
    this.sign.style.transform = `translate(-50%, -100%) translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
  }

  hover(e) {
    if (e.buttons || !this.list.length) { this.card.hidden = true; return; }
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(this.list.map((v) => v.root), true)[0];
    const v = hit && this.on.get(hit.object.userData.visitor);
    if (!v) { this.card.hidden = true; return; }
    if (this.card.dataset.key !== v.key || this.card.dataset.stamp !== JSON.stringify(v.info)) this.fillCard(v);
    this.card.hidden = false;
    // Keep it on screen: flip to the other side of the cursor near an edge.
    let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    if (x + this.card.offsetWidth > r.width - 8) x -= this.card.offsetWidth + 28;
    if (y + this.card.offsetHeight > r.height - 8) y -= this.card.offsetHeight + 28;
    this.card.style.transform = `translate(${x}px, ${y}px)`;
  }

  fillCard(v) {
    const { info, office } = v;
    this.card.dataset.key = v.key;
    this.card.dataset.stamp = JSON.stringify(info);
    this.card.style.setProperty('--tint', v.tint);
    const row = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; return d; };
    const state = { working: 'Working', idle: 'Between jobs', break: 'On a break', meeting: 'In a meeting', away: 'Heading home' }[info.state];
    this.card.replaceChildren(
      row('vc-who', `${info.name} · @${office.handle}`),
      row('vc-role', info.role || 'Agent'),
      row('vc-job', info.job?.title || (info.state === 'working' ? 'On a job' : 'No job right now')),
      row('vc-state', `${state} · visiting from @${office.handle}`),
    );
  }
}
