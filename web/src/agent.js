import * as THREE from 'three';
import { Figure } from './figure.js';

const lerp = (a, b, k) => a + (b - a) * k;
const angleLerp = (a, b, k) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
};
const rand = (a, b) => a + Math.random() * (b - a);

// Overhead bubbles are a glance, not a transcript: one clause, a few words.
// The full line still goes to the agent's log panel.
function brief(text, max = 34) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  const cut = t.search(/[,;:]| \u2014 | - | and | with | so that | in order /i);
  if (cut > 11) t = t.slice(0, cut);
  if (t.length <= max) return t;
  const space = t.lastIndexOf(' ', max);
  return t.slice(0, space > max * 0.6 ? space : max).replace(/[,.;:]$/, '') + '\u2026';
}

const IDLE_LINES = ['coffee?', 'anyone seen my mug', 'back in 5', 'nice weather', 'who broke main', 'lunch soon?', 'reading the docs, honestly', 'standup when'];

let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(40, 28, 16, 0.32)');
  grad.addColorStop(1, 'rgba(40, 28, 16, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return (blobTex = new THREE.CanvasTexture(c));
}

// Rank glyph for the name tag: n 0-2 stack 1-3 chevrons, n 3-5 show 1-3 stars.
function rankIcon(n) {
  const NS = 'http://www.w3.org/2000/svg';
  const stars = n >= 3;
  const count = (stars ? n - 2 : n + 1);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', stars ? `0 0 ${count * 10} 10` : '0 0 10 12');
  svg.setAttribute('class', 'rank');
  svg.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const el = document.createElementNS(NS, 'path');
    if (stars) {
      el.setAttribute('d', 'M5 .8l1.3 2.9 3.1.3-2.3 2.1.7 3.1L5 7.6 2.2 9.2l.7-3.1L.6 4l3.1-.3z');
      el.setAttribute('transform', `translate(${i * 10} 0)`);
      el.setAttribute('fill', 'currentColor');
    } else {
      el.setAttribute('d', `M1 ${6 - i * 3 + 3.5}L5 ${6 - i * 3 + 0.5}l4 3`);
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', 'currentColor');
      el.setAttribute('stroke-width', '1.6');
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
    }
    svg.append(el);
  }
  return svg;
}

export class Agent {
  constructor(staff, world, labels, opts = {}) {
    this.staff = staff;
    this.id = staff.id;
    this.name = staff.name;
    this.world = world;
    this.desk = opts.desk || world.desks[world.agentIndex(staff.id)];
    this.deskFace = opts.face ?? this.desk?.face ?? Math.PI;

    this.root = new THREE.Group();
    this.fig = new Figure(staff);
    this.root.add(this.fig.group);
    this.body = this.fig.body;

    // A soft shadow blob keeps them grounded even where the sun's shadow is thin.
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.015;
    this.root.add(blob);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 40), new THREE.MeshBasicMaterial({ color: staff.shirt, transparent: true, opacity: 0.9 }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.ring.visible = false;
    this.root.add(this.ring);

    this.root.traverse((o) => { o.userData.agentId = staff.id; });
    world.scene.add(this.root);

    this.pos = this.root.position;
    this.heading = 0;
    this.path = [];
    this.goal = null;
    this.placeKey = null;
    this.spot = null;
    this.pose = 'stand';
    this.want = 'lounge';
    this.dwellUntil = 0;
    this.wanderAt = 0;
    this.chatAt = rand(8, 30);
    this.anim = null;
    this.job = null;
    this.lines = [];
    this.phase = Math.random() * 10;

    this.label = document.createElement('div');
    this.label.className = 'agent-label';
    // Built from nodes, not HTML: when visiting a linked office, staff come
    // from another machine.
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const name = document.createElement('div');
    name.className = 'name';
    const dot = document.createElement('i');
    if (/^#[0-9a-f]{3,8}$/i.test(staff.shirt ?? '')) dot.style.background = staff.shirt;
    this.nameText = document.createTextNode(String(staff.name ?? ''));
    name.append(dot, this.nameText);
    this.perkEl = document.createElement('span');
    this.perkEl.className = 'perk';
    this.perkEl.hidden = true;
    name.append(this.perkEl);
    this.label.append(bubble, name);
    this.bubbleEl = this.label.querySelector('.bubble');
    labels.appendChild(this.label);
    this.say('');
  }

  // ---------- speech ----------

  rename(name) {
    this.name = name;
    this.nameText.data = name;
    this.labelDirty = true;
  }

  // Level glyph and streak on the name tag, from the economy's books. The
  // title word lives in the tooltip; the tag shows rank chevrons (levels 1-3)
  // or stars (levels 4-6).
  setPerks(p) {
    const key = p ? `${p.n}|${p.streak >= 2 ? p.streak : 0}` : '';
    if (this.perkKey === key) {
      if (p) this.perkEl.title = this.perkTitle(p);
      return;
    }
    this.perkKey = key;
    this.perkEl.replaceChildren();
    if (p) {
      this.perkEl.append(rankIcon(p.n));
      if (p.streak >= 2) this.perkEl.append(document.createTextNode(`🔥${p.streak}`));
      this.perkEl.title = this.perkTitle(p);
    } else this.perkEl.title = '';
    this.perkEl.hidden = !p;
    this.labelDirty = true;
  }

  perkTitle(p) {
    return `Level ${p.n} ${p.title}${p.streak >= 2 ? `, ${p.streak}-day streak${p.boost ? ` (+${Math.round(p.boost * 100)}% wage)` : ''}` : ''}`;
  }

  say(text, kind = '', ms = 0) {
    if (text !== this.bubbleText) this.labelDirty = true;
    this.bubbleText = text;
    this.bubbleEl.textContent = text;
    this.bubbleEl.className = 'bubble' + (kind ? ' ' + kind : '');
    this.bubbleEl.style.display = text ? '' : 'none';
    this.bubbleUntil = ms ? (this.now || 0) + ms / 1000 : 0;
  }

  // ---------- placement ----------

  teleport(key) {
    const target = this.resolve(key);
    if (!target) return;
    this.pos.copy(target.pos);
    this.heading = target.face;
    this.root.rotation.y = target.face;
    this.goal = target;
    this.path = [];
    this.arrive(0);
  }

  resolve(key, fresh = false) {
    if (key === 'desk') return { key, pos: this.desk.seat.clone(), face: this.deskFace, pose: 'desk', seatY: this.desk.seatY };
    if (key === 'visit') return this.visitTarget;
    if (key === 'standup') return this.meeting;
    if (key === 'door') return { key, pos: this.world.door.clone(), face: Math.PI, pose: 'stand' };
    const station = this.world.stations[key];
    if (!station) return null;
    let spot = !fresh && this.spot && station.spots.includes(this.spot) ? this.spot : null;
    if (!spot) {
      const free = station.spots.filter((s) => !s.game && (!s.taken || s.taken === this.id));
      const choices = fresh ? free.filter((s) => s !== this.spot) : free;
      spot = (choices.length ? choices : free)[Math.floor(Math.random() * (choices.length || free.length))];
    }
    if (!spot) return key === 'lounge' ? null : this.resolve('desk');
    if (this.spot && this.spot !== spot) this.spot.taken = null;
    spot.taken = this.id;
    this.spot = spot;
    const jitter = key === 'lounge' || spot.seatY ? 0 : 0.12;
    return { key, pos: spot.pos.clone().add(new THREE.Vector3(rand(-jitter, jitter), 0, rand(-jitter, jitter))), face: spot.face, pose: spot.pose, seatY: spot.seatY };
  }

  goTo(key, now, fresh = false) {
    if (key === 'desk' && this.spot) { this.spot.taken = null; this.spot = null; }
    const target = this.resolve(key, fresh);
    if (!target) return;
    this.goal = target;
    this.placeKey = null;
    this.path = this.world.grid.path(this.pos.x, this.pos.z, target.pos.x, target.pos.z);
    if (!this.path.length) this.arrive(now);
  }

  arrive(now) {
    const g = this.goal;
    this.pos.set(g.pos.x, 0, g.pos.z);
    this.placeKey = g.key;
    this.pose = g.pose;
    // How high whatever they're sitting on is, so they sit on it, not in it.
    this.seatY = g.seatY;
    this.dwellUntil = now + (g.key === 'desk' ? 0.8 : g.key === 'lounge' ? 0 : g.key === 'visit' ? 3.4 : g.key === 'standup' ? 0.5 : 2.4);
    if (g.key === 'lounge') this.wanderAt = now + rand(18, 40);
  }

  // ---------- job lifecycle ----------

  assign(job, instant = false) {
    this.job = job;
    this.anim = null;
    this.want = 'desk';
    this.lines = [];
    this.say('On it', '', 0);
    if (instant) this.teleport('desk');
  }

  // Walk over to a colleague's side to talk to them.
  visit(other, text) {
    const grid = this.world.grid;
    const spots = [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1], [0.9, 0.9], [-0.9, 0.9]];
    const [dx, dz] = spots.find(([x, z]) => !grid.blocked(...grid.cellOf(other.pos.x + x, other.pos.z + z))) || [1.1, 0];
    const pos = new THREE.Vector3(other.pos.x + dx, 0, other.pos.z + dz);
    this.visitTarget = { key: 'visit', pos, face: Math.atan2(other.pos.x - pos.x, other.pos.z - pos.z), pose: 'talk' };
    this.afterVisit = this.want === 'visit' ? this.afterVisit : this.want;
    this.want = 'visit';
    this.placeKey = null;
    this.path = [];
    if (this.spot) { this.spot.taken = null; this.spot = null; }
    this.say(brief(text, 52), 'talk', 0);
  }

  onLog(entry) {
    if (!this.job) return;
    // At standup, work goes on but doesn't talk over the meeting.
    const say = (...a) => !this.meeting && this.say(...a);
    const color = { tool: null, text: '#e8edf3', error: '#f87171', thinking: '#64748b', system: '#64748b' }[entry.kind];
    const goTo = (where) => { if (this.want === 'visit') this.afterVisit = where; else this.want = where; };
    if (entry.kind === 'tool') {
      // Work happens seated at the desk, whatever the tool.
      goTo('desk');
      say(brief(entry.summary));
      this.lines.push({ text: '› ' + entry.summary, color });
    } else if (entry.kind === 'text') {
      goTo('desk');
      const first = entry.summary.split(/(?<=[.!?])\s|\n/)[0];
      say(brief(first, 44));
      this.lines.push({ text: first, color });
    } else if (entry.kind === 'thinking') {
      say('thinking…', 'thinking');
    } else if (entry.kind === 'error') {
      say(entry.blocked ? 'Needs clearance' : 'Hm, that failed', 'warn');
      this.lines.push({ text: '✕ ' + entry.summary.split('\n')[0], color });
    } else if (entry.kind === 'system') {
      this.lines.push({ text: entry.summary, color });
      if (entry.wait) { goTo('desk'); say(brief(entry.summary, 30) + '…', 'thinking'); }
    }
    if (this.lines.length > 40) this.lines.splice(0, this.lines.length - 40);
  }

  // Standup: head to a spot in the ring until it's over. Work carries on
  // underneath; they go back to it afterwards.
  meet(spot, instant = false) {
    this.meeting = { key: 'standup', pos: spot.pos.clone(), face: spot.face, pose: 'stand' };
    if (this.spot) { this.spot.taken = null; this.spot = null; }
    if (instant) return this.teleport('standup');
    if (this.want !== 'visit') { this.path = []; this.placeKey = null; }
  }

  adjourn() {
    this.meeting = null;
    if (this.placeKey === 'standup') this.placeKey = null;
  }

  speak(text) {
    this.say(text, 'talk', 5200);
    this.anim = { kind: 'talk', until: (this.now || 0) + 4.8 };
  }

  // Dismissed: walk out the door, then disappear (see main.js).
  leave() {
    this.leaving = true;
    this.want = 'door';
    if (this.spot) { this.spot.taken = null; this.spot = null; }
    this.say('Heading home', 'idle', 3000);
  }

  stay() {
    this.leaving = false;
    this.want = 'lounge';
    this.say('Oh, staying!', 'good', 2500);
  }

  dispose() {
    if (this.spot) this.spot.taken = null;
    this.world.scene.remove(this.root);
    this.label.remove();
  }

  finish(status) {
    const now = this.now || 0;
    this.anim = { kind: status === 'done' ? 'celebrate' : 'slump', until: now + 2.2 };
    this.say(status === 'done' ? 'Shipped it!' : status === 'waiting' ? 'Need your answer' : status === 'stopped' ? 'Okay, stopping' : 'Hit a wall', status === 'done' ? 'good' : 'warn', 4000);
    this.job = null;
    this.afterVisit = null;
    this.want = 'lounge';
  }

  // ---------- per-frame ----------

  think(now) {
    if (this.anim && now < this.anim.until) return;
    this.anim = null;
    if (this.bubbleUntil && now > this.bubbleUntil) this.say('');

    // A standup outranks everything but leaving and a conversation.
    const dest = this.meeting && !this.leaving && this.want !== 'visit' ? 'standup' : this.want;
    if (this.path.length) {
      // Someone handed us a job on the way to the couch: turn around now.
      if (this.goal?.key === 'lounge' && dest !== 'lounge') this.goTo(dest, now);
      return;
    }
    if (now < this.dwellUntil) return;
    if (this.leaving && this.placeKey === 'door') { this.gone = true; return; }
    if (this.placeKey === 'visit' && this.want === 'visit') {
      this.want = this.job ? this.afterVisit || 'desk' : 'lounge';
      this.afterVisit = null;
      if (this.bubbleEl.classList.contains('talk')) this.say('');
    }
    const next = this.meeting && !this.leaving && this.want !== 'visit' ? 'standup' : this.want;
    if (next !== this.placeKey) this.goTo(next, now);
    else if (next === 'lounge' && now > this.wanderAt) this.goTo('lounge', now, true);

    if (!this.job && !this.meeting && !this.chatting && now > this.chatAt) {
      this.chatAt = now + rand(25, 60);
      if (Math.random() < 0.5) this.say(IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)], 'idle', 3500);
    }
  }

  update(dt, now) {
    this.now = now;
    this.think(now);

    let moving = false;
    if (this.path.length) {
      const [tx, tz] = this.path[0];
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      const dist = Math.hypot(dx, dz);
      const step = 3.4 * dt;
      if (dist <= step) {
        this.pos.x = tx;
        this.pos.z = tz;
        this.path.shift();
        if (!this.path.length) this.arrive(now);
      } else {
        this.pos.x += (dx / dist) * step;
        this.pos.z += (dz / dist) * step;
        this.heading = angleLerp(this.heading, Math.atan2(dx, dz), Math.min(1, dt * 12));
        moving = true;
      }
    }
    if (!moving && this.goal && !this.path.length) this.heading = angleLerp(this.heading, this.goal.face, Math.min(1, dt * 8));
    this.root.rotation.y = this.heading;

    this.animate(moving ? 'walk' : this.anim?.kind || this.pose, dt, now);
  }

  animate(pose, dt, t) {
    this.fig.pose(pose, dt, t + this.phase, {
      typing: !!this.job && !this.job.waiting && this.job.id !== 'idle',
      waiting: !!this.job?.waiting,
      seatY: this.seatY,
    });
    const kind = this.bubbleEl.className;
    const mood = pose === 'celebrate' ? 'happy'
      : pose === 'slump' || kind.includes('warn') ? 'worried'
      : pose === 'talk' || (kind.includes('idle') && this.bubbleText) ? 'talk'
      : kind.includes('thinking') ? 'think'
      : kind.includes('good') ? 'happy'
      : 'neutral';
    this.fig.express(mood, dt, t + this.phase);
  }

  // Work out where the label wants to sit. How far it ends up lifted off that
  // point is settled later, once every label's box is known (see declutter).
  placeLabel(camera, w, h) {
    const v = new THREE.Vector3(this.pos.x, this.body.position.y + 2.5 + (this.fig.look.hair === 'afro' ? 0.2 : 0), this.pos.z).project(camera);
    this.onScreen = v.z <= 1;
    if (!this.onScreen) { this.label.style.display = 'none'; this.lift = 0; return; }
    this.label.style.display = '';
    this.anchorX = (v.x * 0.5 + 0.5) * w;
    this.anchorY = (-v.y * 0.5 + 0.5) * h;
    this.depth = v.z;
    this.label.style.zIndex = String(Math.round((1 - v.z) * 10000));
    if (this.labelDirty || !this.labelW) this.measureLabel();
  }

  measureLabel() {
    // A hidden label measures zero; keep the last real size rather than a
    // box that fits anywhere. (Buried labels stay measurable on purpose.)
    if (!this.label.offsetWidth) return;
    this.labelDirty = false;
    this.labelW = this.label.offsetWidth;
    this.labelH = this.label.offsetHeight;
  }

  // The label's screen box if it were lifted this far above its anchor.
  labelBox(lift) {
    const bottom = this.anchorY - lift;
    return { left: this.anchorX - this.labelW / 2, right: this.anchorX + this.labelW / 2, top: bottom - this.labelH, bottom };
  }

  setLift(lift, dt) {
    const k = this.lift === undefined ? 1 : Math.min(1, dt * 9);
    this.lift = (this.lift || 0) + (lift - (this.lift || 0)) * k;
    if (Math.abs(this.lift - lift) < 0.4) this.lift = lift;
    this.label.style.transform = `translate(-50%, -100%) translate(${this.anchorX}px, ${this.anchorY - this.lift}px)`;
  }

  // When a label can't find clear air, it drops its bubble and keeps its name.
  setBuried(on) {
    if (on === this.buried) return;
    this.buried = on;
    this.label.classList.toggle('buried', on);
  }

  setCrowded(on, now) {
    if (on) this.uncrowdAt = now + 0.6;
    else if (this.crowded && now < (this.uncrowdAt || 0)) on = true;
    if (on !== this.crowded) {
      this.crowded = on;
      this.label.classList.toggle('crowded', on);
      this.measureLabel();
    }
  }

  setSelected(on) {
    this.ring.visible = on;
    this.label.classList.toggle('selected', on);
  }
}
