import * as THREE from 'three';
import { Figure } from './figure.js';

const lerp = (a, b, k) => a + (b - a) * k;
const angleLerp = (a, b, k) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
};
const rand = (a, b) => a + Math.random() * (b - a);

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

export class Agent {
  constructor(staff, world, labels, opts = {}) {
    this.staff = staff;
    this.id = staff.id;
    this.name = staff.name;
    this.world = world;
    this.desk = opts.desk || world.desks[world.agentIndex(staff.id)];
    this.deskFace = opts.face ?? Math.PI;

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
    this.label.innerHTML = `<div class="bubble"></div><div class="name"><i style="background:${staff.shirt}"></i>${staff.name}</div>`;
    this.bubbleEl = this.label.querySelector('.bubble');
    labels.appendChild(this.label);
    this.say('');
  }

  // ---------- speech ----------

  say(text, kind = '', ms = 0) {
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
    if (key === 'desk') return { key, pos: this.desk.seat.clone(), face: this.deskFace, pose: 'desk' };
    if (key === 'visit') return this.visitTarget;
    if (key === 'door') return { key, pos: this.world.door.clone(), face: Math.PI, pose: 'stand' };
    const station = this.world.stations[key];
    if (!station) return null;
    let spot = !fresh && this.spot && station.spots.includes(this.spot) ? this.spot : null;
    if (!spot) {
      const free = station.spots.filter((s) => !s.taken || s.taken === this.id);
      const choices = fresh ? free.filter((s) => s !== this.spot) : free;
      spot = (choices.length ? choices : free)[Math.floor(Math.random() * (choices.length || free.length))];
    }
    if (!spot) return key === 'lounge' ? null : this.resolve('desk');
    if (this.spot && this.spot !== spot) this.spot.taken = null;
    spot.taken = this.id;
    this.spot = spot;
    const jitter = key === 'lounge' ? 0 : 0.12;
    return { key, pos: spot.pos.clone().add(new THREE.Vector3(rand(-jitter, jitter), 0, rand(-jitter, jitter))), face: spot.face, pose: spot.pose };
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
    this.dwellUntil = now + (g.key === 'desk' ? 0.8 : g.key === 'lounge' ? 0 : g.key === 'visit' ? 3.4 : 2.4);
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
    this.say(text.length > 90 ? text.slice(0, 89) + '…' : text, 'talk', 0);
  }

  onLog(entry) {
    if (!this.job) return;
    const color = { tool: null, text: '#e8edf3', error: '#f87171', thinking: '#64748b', system: '#64748b' }[entry.kind];
    const goTo = (where) => { if (this.want === 'visit') this.afterVisit = where; else this.want = where; };
    if (entry.kind === 'tool') {
      goTo(entry.station === 'desk' ? 'desk' : entry.station);
      this.say(entry.summary);
      this.lines.push({ text: '› ' + entry.summary, color });
    } else if (entry.kind === 'text') {
      goTo('desk');
      const first = entry.summary.split(/(?<=[.!?])\s|\n/)[0];
      this.say(first.length > 80 ? first.slice(0, 79) + '…' : first);
      this.lines.push({ text: first, color });
    } else if (entry.kind === 'thinking') {
      this.say('thinking…', 'thinking');
    } else if (entry.kind === 'error') {
      this.say(entry.blocked ? 'Needs clearance' : 'Hm, that failed', 'warn');
      this.lines.push({ text: '✕ ' + entry.summary.split('\n')[0], color });
    } else if (entry.kind === 'system') {
      this.lines.push({ text: entry.summary, color });
      if (entry.wait) { goTo('desk'); this.say(entry.summary + '…', 'thinking'); }
    }
    if (this.lines.length > 40) this.lines.splice(0, this.lines.length - 40);
  }

  finish(status) {
    const now = this.now || 0;
    this.anim = { kind: status === 'done' ? 'celebrate' : 'slump', until: now + 2.2 };
    this.say(status === 'done' ? 'Shipped it!' : status === 'stopped' ? 'Okay, stopping' : 'Hit a wall', status === 'done' ? 'good' : 'warn', 4000);
    this.job = null;
    this.afterVisit = null;
    this.want = 'lounge';
  }

  // ---------- per-frame ----------

  think(now) {
    if (this.anim && now < this.anim.until) return;
    this.anim = null;
    if (this.bubbleUntil && now > this.bubbleUntil) this.say('');

    if (this.path.length) {
      // Someone handed us a job on the way to the couch: turn around now.
      if (this.goal?.key === 'lounge' && this.want !== 'lounge') this.goTo(this.want, now);
      return;
    }
    if (now < this.dwellUntil) return;
    if (this.placeKey === 'visit' && this.want === 'visit') {
      this.want = this.job ? this.afterVisit || 'desk' : 'lounge';
      this.afterVisit = null;
      if (this.bubbleEl.classList.contains('talk')) this.say('');
    }
    if (this.want !== this.placeKey) this.goTo(this.want, now);
    else if (this.want === 'lounge' && now > this.wanderAt) this.goTo('lounge', now, true);

    if (!this.job && now > this.chatAt) {
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

  placeLabel(camera, w, h) {
    const v = new THREE.Vector3(this.pos.x, this.body.position.y + 2.5 + (this.fig.look.hair === 'afro' ? 0.2 : 0), this.pos.z).project(camera);
    if (v.z > 1) { this.label.style.display = 'none'; return; }
    this.label.style.display = '';
    this.label.style.transform = `translate(-50%, -100%) translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
    this.label.style.zIndex = String(Math.round((1 - v.z) * 10000));
  }

  setSelected(on) {
    this.ring.visible = on;
    this.label.classList.toggle('selected', on);
  }
}
