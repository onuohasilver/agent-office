import * as THREE from 'three';
import { mat } from './office.js';

const lerp = (a, b, k) => a + (b - a) * k;
const angleLerp = (a, b, k) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
};
const rand = (a, b) => a + Math.random() * (b - a);

const IDLE_LINES = ['coffee?', 'anyone seen my mug', 'back in 5', 'nice weather', 'who broke main', 'lunch soon?', 'reading the docs, honestly', 'standup when'];

function limb(parent, x, y, w, h, d, color, handColor) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.y = -h / 2;
  m.castShadow = true;
  pivot.add(m);
  if (handColor) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(w * 0.62, 10, 8), mat(handColor));
    hand.position.y = -h - 0.02;
    hand.castShadow = true;
    pivot.add(hand);
  }
  parent.add(pivot);
  return pivot;
}

export class Agent {
  constructor(staff, world, labels) {
    this.staff = staff;
    this.id = staff.id;
    this.name = staff.name;
    this.world = world;
    this.desk = world.desks[world.agentIndex(staff.id)];

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const shirtDark = new THREE.Color(staff.shirt).multiplyScalar(0.82).getStyle();

    this.legL = limb(this.body, -0.14, 0.78, 0.2, 0.74, 0.24, '#2d3140');
    this.legR = limb(this.body, 0.14, 0.78, 0.2, 0.74, 0.24, '#2d3140');
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.42, 6, 16), mat(staff.shirt));
    torso.position.y = 1.22;
    torso.scale.z = 0.8;
    torso.castShadow = true;
    this.body.add(torso);
    this.armL = limb(this.body, -0.4, 1.5, 0.15, 0.56, 0.17, shirtDark, staff.skin);
    this.armR = limb(this.body, 0.4, 1.5, 0.15, 0.56, 0.17, shirtDark, staff.skin);

    this.head = new THREE.Group();
    this.head.position.y = 1.98;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), mat(staff.skin));
    skull.castShadow = true;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.315, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(staff.hair));
    hair.position.set(0, 0.02, -0.02);
    hair.rotation.x = -0.25;
    this.head.add(skull, hair);
    for (const ex of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat('#15171c'));
      eye.position.set(ex, 0.02, 0.275);
      this.head.add(eye);
    }
    this.body.add(this.head);

    this.book = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.3), mat('#3d7ea6'));
    this.book.position.set(0, 1.12, 0.42);
    this.book.rotation.x = -0.5;
    this.book.visible = false;
    this.body.add(this.book);
    this.mug = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.15, 10), mat('#ffffff'));
    this.mug.position.set(0, -0.62, 0.06);
    this.mug.visible = false;
    this.armR.add(this.mug);

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
    this.bubbleUntil = ms ? performance.now() / 1000 + ms / 1000 : 0;
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
    if (key === 'desk') return { key, pos: this.desk.seat.clone(), face: Math.PI, pose: 'desk' };
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
    this.dwellUntil = now + (g.key === 'desk' ? 0.8 : g.key === 'lounge' ? 0 : 2.4);
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

  onLog(entry) {
    if (!this.job) return;
    const color = { tool: null, text: '#e8edf3', error: '#f87171', thinking: '#64748b', system: '#64748b' }[entry.kind];
    if (entry.kind === 'tool') {
      this.want = entry.station === 'desk' ? 'desk' : entry.station;
      this.say(entry.summary);
      this.lines.push({ text: '› ' + entry.summary, color });
    } else if (entry.kind === 'text') {
      this.want = 'desk';
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
    }
    if (this.lines.length > 40) this.lines.splice(0, this.lines.length - 40);
  }

  finish(status) {
    const now = performance.now() / 1000;
    this.anim = { kind: status === 'done' ? 'celebrate' : 'slump', until: now + 2.2 };
    this.say(status === 'done' ? 'Shipped it!' : status === 'stopped' ? 'Okay, stopping' : 'Hit a wall', status === 'done' ? 'good' : 'warn', 4000);
    this.job = null;
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
    if (this.want !== this.placeKey) this.goTo(this.want, now);
    else if (this.want === 'lounge' && now > this.wanderAt) this.goTo('lounge', now, true);

    if (!this.job && now > this.chatAt) {
      this.chatAt = now + rand(25, 60);
      if (Math.random() < 0.5) this.say(IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)], 'idle', 3500);
    }
  }

  update(dt, now) {
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
    const k = Math.min(1, dt * 10);
    const p = (t + this.phase);
    let legL = 0, legR = 0, armL = 0, armR = 0, y = 0, headX = 0, headY = 0;
    this.book.visible = pose === 'read';
    this.mug.visible = pose === 'mug';

    switch (pose) {
      case 'walk': {
        const s = Math.sin(p * 10);
        legL = s * 0.55; legR = -s * 0.55; armL = -s * 0.45; armR = s * 0.45;
        y = Math.abs(Math.cos(p * 10)) * 0.06;
        break;
      }
      case 'desk':
        legL = legR = -1.5; y = -0.27; headX = 0.12;
        armL = -1.15 + Math.sin(p * 19) * 0.12;
        armR = -1.15 + Math.sin(p * 19 + 1.7) * 0.12;
        if (!this.job) armL = armR = -0.3;
        break;
      case 'couch':
        legL = legR = -1.45; y = -0.3; armL = armR = -0.25; headY = Math.sin(p * 0.3) * 0.4;
        break;
      case 'read':
        armL = armR = -1.0; headX = 0.38; headY = Math.sin(p * 0.7) * 0.1;
        break;
      case 'type':
        armL = -1.3 + Math.sin(p * 16) * 0.15;
        armR = -1.3 + Math.sin(p * 16 + 2) * 0.15;
        headX = 0.05;
        break;
      case 'gaze':
        armL = armR = 0.3; headX = -0.18; headY = Math.sin(p * 0.5) * 0.35;
        break;
      case 'write':
        armR = -2.4 + Math.sin(p * 7) * 0.25; armL = 0.05; headY = Math.sin(p * 1.3) * 0.08;
        break;
      case 'mug':
        armR = Math.sin(p * 0.9) > 0.8 ? -2.1 : -1.3; headX = 0.05;
        break;
      case 'celebrate':
        armL = armR = -2.9 + Math.sin(p * 14) * 0.15; y = Math.abs(Math.sin(p * 9)) * 0.35;
        break;
      case 'slump':
        headX = 0.5; armL = armR = 0.06; y = -0.04;
        break;
      default:
        armL = Math.sin(p * 1.6) * 0.04; armR = -armL; y = Math.sin(p * 1.6) * 0.01;
    }
    this.legL.rotation.x = lerp(this.legL.rotation.x, legL, k);
    this.legR.rotation.x = lerp(this.legR.rotation.x, legR, k);
    this.armL.rotation.x = lerp(this.armL.rotation.x, armL, k);
    this.armR.rotation.x = lerp(this.armR.rotation.x, armR, k);
    this.head.rotation.x = lerp(this.head.rotation.x, headX, k);
    this.head.rotation.y = lerp(this.head.rotation.y, headY, k * 0.5);
    this.body.position.y = pose === 'walk' || pose === 'celebrate' ? y : lerp(this.body.position.y, y, k);
  }

  placeLabel(camera, w, h) {
    const v = new THREE.Vector3(this.pos.x, this.body.position.y + 2.55, this.pos.z).project(camera);
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
