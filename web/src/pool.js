// Eight-ball in the break room. When two agents have nothing on, every so
// often they walk over to the table and play a proper game: real balls, real
// rules (pool-sim.js), turns taken one shot at a time with a cue to watch.
// Anyone handed work, called to standup or sent home drops the cue and the
// game is called off.
//
// Like the break-room chats, a game is claimed from the server first, so the
// office open in two windows plays one game rather than two, and the start
// and the result land in #chill-room once.

import * as THREE from 'three';
import { Game, advance, moving, plan, strike, rack, R, POCKETS } from './pool-sim.js';
import { api } from './breakroom.js';
import { sound } from './sound.js';
import { mat, POOL } from './office.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const COLORS = ['#f2c230', '#2f5fb3', '#d6402f', '#6a3a9c', '#e8803a', '#2f8a4f', '#8a2a2e'];

function ballTexture(n) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const color = n === 0 ? '#f4f1ea' : n === 8 ? '#1b1b1f' : COLORS[(n - 1) % 7];
  g.fillStyle = n > 8 ? '#f4f1ea' : color;
  g.fillRect(0, 0, 128, 64);
  if (n > 8) { g.fillStyle = color; g.fillRect(0, 14, 128, 36); }
  if (n) {
    g.font = '700 17px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const x of [32, 96]) {
      g.fillStyle = '#f4f1ea';
      g.beginPath(); g.arc(x, 32, 13, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1b1b1f';
      g.fillText(String(n), x, 33);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const POCKET_NAMES = ['corner', 'corner', 'corner', 'corner', 'side', 'side'];
const nameOf = (p) => POCKET_NAMES[POCKETS.indexOf(p)] || 'pocket';

const OPENERS = [
  ['Eight ball? Loser buys the coffee.', 'You are on.'],
  ['Quick game of eight ball?', 'Rack them up.'],
  ['Pool table is free. That never happens.', 'Then we have to.'],
  ['Break is yours.', 'Bold of you to give me the break.'],
];
const GOOD = ['Nice.', 'Smooth.', 'That one dropped.', 'Clean.', 'In.'];
const MISS = ['So close.', 'Rolled out.', 'Unlucky.', 'The table is tilted.'];
const FOUL = ['Scratch.', 'Ugh, foul.', 'The cue ball had other plans.'];
const HAND = ['Ball in hand.', 'Your table.', 'Thank you.'];
const THINK = ['Here goes.', 'Let me see this one.', 'Easy.', 'Trust the line.'];
const WIN = ['Good game.', 'That was fun.', 'Rematch later?'];
const LOSE = ['Rematch.', 'Good game. Coffee is on me.', 'The table was tilted.'];

export class PoolRoom {
  // `office` is what buildOffice returned: the table's place and its seats.
  constructor(scene, office) {
    this.spots = office.stations.lounge.spots.filter((s) => s.game);
    this.root = new THREE.Group();
    this.root.position.set(POOL.x, 0, POOL.z);
    scene.add(this.root);

    const geo = new THREE.SphereGeometry(R, 20, 14);
    this.meshes = [];
    for (let n = 0; n <= 15; n++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: ballTexture(n), roughness: 0.22, metalness: 0.02 }));
      m.castShadow = true;
      m.userData = { x: 0, z: 0, sunk: null };
      this.root.add(m);
      this.meshes.push(m);
    }

    // The cue: tip at the origin of `cue`, butt out behind it along -x.
    this.cue = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.026, 1.9, 8), mat('#d9b27a'));
    stick.rotation.z = Math.PI / 2;
    stick.position.x = -0.95;
    stick.castShadow = true;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.04, 8), mat('#5b8fb0'));
    tip.rotation.z = Math.PI / 2;
    tip.position.x = -0.02;
    this.cue.add(stick, tip);
    this.cueOuter = new THREE.Group();
    this.cueOuter.add(this.cue);
    this.cue.rotation.z = -0.12;
    this.cueOuter.visible = false;
    this.root.add(this.cueOuter);

    this.resting = rack();
    this.view = this.resting;
    this.next = rand(25, 45);
    this.s = null;
    this.claiming = false;
  }

  get playing() { return !!this.s; }

  // ---------- who plays ----------

  update(agents, now, dt) {
    if (this.s) this.run(now, dt);
    else if (!this.claiming && now >= this.next) this.tryStart(agents, now);
    this.draw(now, dt);
  }

  tryStart(agents, now) {
    const ok = (a) => !a.gone && !a.job && !a.meeting && !a.leaving && a.want === 'lounge' && !a.playing && !a.chatting;
    const idle = agents.filter(ok);
    this.next = now + rand(15, 30);
    if (idle.length < 2) return;
    const a = pick(idle);
    const b = pick(idle.filter((x) => x !== a));
    this.claim(a, b, now);
  }

  async claim(a, b, now) {
    this.claiming = true;
    let id = null;
    try { ({ id } = await api('/api/chill', { who: [a.id, b.id], game: true })); } catch {}
    this.claiming = false;
    if (!id) return;
    const ready = (x) => !x.gone && !x.job && !x.meeting && !x.leaving && x.want === 'lounge' && !x.playing && !x.chatting;
    if (!ready(a) || !ready(b)) return this.release(id);
    this.begin(a, b, id, now);
  }

  begin(a, b, id, now) {
    const players = [a, b];
    players.forEach((p, i) => {
      const spot = this.spots[i];
      if (p.spot && p.spot !== spot) p.spot.taken = null;
      p.spot = spot;
      spot.taken = p.id;
      p.playing = true;
      p.chatting = true;
      p.wanderAt = Infinity;
      p.goTo('lounge', now);
    });
    const skill = (p) => 0.45 + (([...p.id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) >>> 0) % 50) / 100;
    this.s = { id, players, skill: players.map(skill), phase: 'walk', deadline: now + 60, game: null, plan: null, shots: 0 };
  }

  // The game is called off the moment either player is needed elsewhere.
  called(p) { return p.gone || p.job || p.meeting || p.leaving || p.want !== 'lounge'; }

  // ---------- the game ----------

  run(now, dt) {
    const s = this.s;
    if (s.players.some((p) => this.called(p))) return this.stop(now, false);
    for (const p of s.players) p.wanderAt = Infinity;
    // The claim goes stale on the server unless the game keeps saying it is on.
    if (now - (s.pinged ?? 0) > 30) { s.pinged = now; api(`/api/chill/${s.id}/ping`, {}).catch(() => {}); }
    const [a, b] = s.players;
    const at = (p) => p.placeKey === 'lounge' && !p.path.length && p.spot?.game;

    switch (s.phase) {
      case 'walk': {
        if (now > s.deadline) return this.stop(now, false);
        if (!at(a) || !at(b)) return;
        s.game = new Game([a.id, b.id]);
        this.view = s.game.balls;
        for (const m of this.meshes) m.userData.sunk = null;
        const [first, reply] = pick(OPENERS);
        a.say(first, 'idle', 3200);
        s.phase = 'rack'; s.until = now + 1.2;
        s.line = reply; s.said = false;
        api(`/api/chill/${s.id}/line`, { from: a.id, text: first }).catch(() => {});
        return;
      }
      case 'rack':
        if (!s.said && now > s.until - 0.4) { b.say(s.line, 'idle', 2600); s.said = true; }
        if (now > s.until) this.aim(now);
        return;
      case 'aim':
        return this.aiming(now);
      case 'roll': {
        const rec = s.rec;
        s.clicks = 0;
        advance(s.game.balls, Math.min(dt, 0.05), rec);
        s.rolled += dt;
        if (s.rolled > 0.3) this.cueOuter.visible = false;
        if (moving(s.game.balls) && s.rolled < 22) return;
        for (const ball of s.game.balls) { ball.vx = 0; ball.vz = 0; }
        return this.settled(now);
      }
      case 'pause':
        if (now > s.until) this.aim(now);
        return;
      case 'over':
        if (now > s.until) this.stop(now, true);
    }
  }

  agentOf(id) { return this.s.players.find((p) => p.id === id); }

  aim(now) {
    const s = this.s, game = s.game;
    const shooter = this.agentOf(game.shooter), other = this.agentOf(game.other);
    const idx = s.players.indexOf(shooter);
    if (game.inHand) game.placeCue(game.shots === 0);
    s.plan = plan(game, s.skill[idx]);
    s.t0 = now;
    s.dur = rand(1.5, 2.2);
    s.struck = false;
    s.phase = 'aim';
    s.shooter = shooter; s.waiter = other;
    const cx = POOL.x + game.cue.x, cz = POOL.z + game.cue.z;
    shooter.goal = { ...shooter.goal, face: Math.atan2(cx - shooter.pos.x, cz - shooter.pos.z) };
    other.goal = { ...other.goal, face: Math.atan2(cx - other.pos.x, cz - other.pos.z) };
    const where = s.plan.pocket && nameOf(s.plan.pocket);
    const call = where && Math.random() < 0.4
      ? (s.plan.target.n === 8 ? `Eight ball, ${where} pocket.` : `${where[0].toUpperCase()}${where.slice(1)} pocket.`)
      : Math.random() < 0.18 ? pick(THINK) : '';
    if (call) shooter.say(call, 'idle', 2400);
    this.cueOuter.visible = true;
  }

  aiming(now) {
    const s = this.s, game = s.game;
    const k = Math.min(1, (now - s.t0) / s.dur);
    s.shooter.anim = { kind: 'cue', until: now + 0.5 };
    s.waiter.anim = { kind: 'mug', until: now + 0.5 };
    // Lined up, drawn back, then through.
    const offset = k < 0.55 ? 0.07 + Math.sin(k * 40) * 0.006
      : k < 0.85 ? 0.07 + ((k - 0.55) / 0.3) ** 2 * 0.34
      : 0.41 * (1 - ((k - 0.85) / 0.15)) + 0.02;
    this.placeCue(offset, s.plan.angle);
    if (k >= 1 && !s.struck) {
      s.struck = true;
      strike(game, s.plan.angle, s.plan.speed);
      sound.click(Math.min(1, s.plan.speed / 6));
      s.rec = this.recorder(game);
      s.rolled = 0;
      s.clicks = 0;
      s.phase = 'roll';
      s.shooter.anim = null;
    }
  }

  recorder(game) {
    const rec = game.recorder();
    return {
      hit: (a, c, v) => {
        rec.hit(a, c, v);
        if (this.s.clicks++ < 2) sound.click(Math.min(1, v / 4));
      },
      pocket: (b, p) => { rec.pocket(b, p); sound.pocket(); },
      cushion: rec.cushion,
    };
  }

  settled(now) {
    const s = this.s, game = s.game;
    const shooter = s.shooter, other = s.waiter;
    const out = game.settle();
    s.shots++;
    const mine = out.potted.length > 0;
    if (out.over) return this.over(now, out);

    if (out.assigned) shooter.say(`${out.assigned === 'solids' ? 'Solids' : 'Stripes'} for me.`, 'idle', 2800);
    else if (out.foul) {
      shooter.say(pick(FOUL), 'warn', 2400);
      if (Math.random() < 0.5) setTimeout(() => this.s && other.say(pick(HAND), 'idle', 2200), 700);
    } else if (mine && out.continues) {
      if (Math.random() < 0.45) shooter.say(pick(GOOD), 'good', 2200);
    } else if (Math.random() < 0.22) shooter.say(pick(MISS), 'idle', 2200);

    s.phase = 'pause';
    s.until = now + 1.1 + (out.foul ? 0.6 : 0);
  }

  over(now, out) {
    const s = this.s, game = s.game;
    const w = this.agentOf(game.winner), l = s.players.find((p) => p !== w);
    const text = {
      eight: `Eight ball down. Good game, ${l.name}.`,
      'early-eight': `${l.name} dropped the eight early, so that one is mine. Good game.`,
      'foul-eight': `The eight went in with a foul, ${l.name}. Still a good game.`,
      'worn-out': `Called it after ${game.shots} shots, fewer balls left. Good game, ${l.name}.`,
    }[game.over];
    w.say(pick(WIN), 'good', 3600);
    l.say(pick(LOSE), 'idle', 3600);
    w.anim = { kind: 'celebrate', until: now + 2.2 };
    l.anim = { kind: 'slump', until: now + 1.8 };
    api(`/api/chill/${s.id}/line`, { from: w.id, text }).catch(() => {});
    s.phase = 'over';
    s.until = now + 5;
  }

  // Ends the game, played out or not, and sends both players back to life.
  stop(now, finished) {
    const s = this.s;
    if (!s) return;
    this.release(s.id);
    for (const p of s.players) {
      p.playing = false;
      p.chatting = false;
      p.anim = null;
      if (p.spot?.game) { p.spot.taken = null; p.spot = null; }
      if (!p.gone && !p.job && !p.meeting && p.want === 'lounge') p.wanderAt = now + rand(5, 12);
      else p.wanderAt = 0;
    }
    this.cueOuter.visible = false;
    this.resting = rack();
    this.view = this.resting;
    for (const m of this.meshes) m.userData.sunk = null;
    this.s = null;
    this.next = now + (finished ? rand(60, 150) : rand(30, 60));
  }

  release(id) { api(`/api/chill/${id}`, undefined, 'DELETE').catch(() => {}); }

  // ---------- drawing ----------

  placeCue(offset, angle) {
    const c = this.s.game.cue;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    this.cueOuter.position.set(c.x - dx * (R + offset), POOL.felt + R, c.z - dz * (R + offset));
    this.cueOuter.rotation.y = -angle;
  }

  draw(now, dt) {
    const felt = POOL.felt;
    for (const b of this.view) {
      const m = this.meshes[b.n];
      const u = m.userData;
      if (b.in) {
        if (u.sunk === null) u.sunk = now;
        const k = Math.min(1, (now - u.sunk) / 0.35);
        const p = b.pocket;
        m.visible = k < 1;
        m.position.set(b.x + ((p?.x ?? b.x) - b.x) * k, felt + R - k * 0.22, b.z + ((p?.z ?? b.z) - b.z) * k);
        m.scale.setScalar(1 - k * 0.5);
        continue;
      }
      u.sunk = null;
      m.visible = true;
      m.scale.setScalar(1);
      m.position.set(b.x, felt + R, b.z);
      // Roll along the way it is going.
      const dx = b.x - u.x, dz = b.z - u.z, d = Math.hypot(dx, dz);
      if (d > 1e-5 && d < 0.5) {
        const axis = new THREE.Vector3(dz, 0, -dx).normalize();
        m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, d / R));
      }
      u.x = b.x; u.z = b.z;
    }
  }
}
