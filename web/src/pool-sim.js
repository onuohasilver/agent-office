// Eight-ball, with no graphics in it: the table, the balls, the rules and the
// players' aim. pool.js dresses it up and walks the agents over; keeping the
// maths apart means whole games can be run headless to see they finish.
//
// Units are the office's own. The table is long in x, and everything here is
// in table space, with the middle of the cloth at the origin.

export const L = 3.2;          // cloth length
export const W = 1.6;          // cloth width
export const R = 0.075;        // ball radius (a little fat, so it reads from across the office)
const DECEL = 0.9;             // rolling drag, units per second squared
const REST = 0.78;             // how much speed a cushion gives back
const BALL_REST = 0.96;
export const MAX_SPEED = 7;
const STEP = 1 / 240;

const CORNER = 0.15, SIDE = 0.135;
export const POCKETS = [
  { x: -L / 2, z: -W / 2, r: CORNER }, { x: L / 2, z: -W / 2, r: CORNER },
  { x: -L / 2, z: W / 2, r: CORNER }, { x: L / 2, z: W / 2, r: CORNER },
  { x: 0, z: -W / 2 - 0.035, r: SIDE }, { x: 0, z: W / 2 + 0.035, r: SIDE },
];

// 0 is the cue ball, 1-7 solids, 8 the eight, 9-15 stripes.
export const kindOf = (n) => (n === 0 ? 'cue' : n === 8 ? 'eight' : n < 8 ? 'solids' : 'stripes');

export function rack() {
  const balls = [{ n: 0, x: -L / 4, z: 0, vx: 0, vz: 0, in: false }];
  // Apex on the foot spot, eight in the middle, a solid and a stripe at the
  // back corners; the rest shuffled.
  const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].sort(() => Math.random() - 0.5);
  const order = new Array(15);
  order[4] = 8;
  const corners = [10, 14];
  order[corners[0]] = rest.splice(rest.findIndex((n) => n < 8), 1)[0];
  order[corners[1]] = rest.splice(rest.findIndex((n) => n > 8), 1)[0];
  for (let i = 0; i < 15; i++) if (!order[i]) order[i] = rest.pop();
  const gap = R * 2 * 1.002;
  let i = 0;
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      balls.push({ n: order[i++], x: L / 4 + row * gap * 0.866, z: (k - row / 2) * gap, vx: 0, vz: 0, in: false });
    }
  }
  return balls;
}

// ---------- physics ----------

// Runs the table forward by dt. `events` hears about what happens: the first
// ball the cue touches, balls going down and balls touching a cushion.
export function advance(balls, dt, events = {}) {
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(STEP, left);
    left -= h;
    for (const b of balls) {
      if (b.in) continue;
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0) {
        const ns = Math.max(0, sp - DECEL * h);
        const f = ns / sp;
        b.vx *= f; b.vz *= f;
        if (ns < 0.012) { b.vx = 0; b.vz = 0; }
      }
      b.x += b.vx * h;
      b.z += b.vz * h;
      // Cushions, except where a pocket is open.
      const lx = L / 2 - R, lz = W / 2 - R;
      let hit = false;
      if (b.x < -lx) { b.x = -lx; b.vx = Math.abs(b.vx) * REST; hit = true; }
      else if (b.x > lx) { b.x = lx; b.vx = -Math.abs(b.vx) * REST; hit = true; }
      if (b.z < -lz) { b.z = -lz; b.vz = Math.abs(b.vz) * REST; hit = true; }
      else if (b.z > lz) { b.z = lz; b.vz = -Math.abs(b.vz) * REST; hit = true; }
      if (hit) events.cushion?.(b);
      for (const p of POCKETS) {
        if (Math.hypot(b.x - p.x, b.z - p.z) < p.r) {
          b.in = true; b.vx = 0; b.vz = 0; b.pocket = p;
          events.pocket?.(b, p);
          break;
        }
      }
    }
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.in) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const c = balls[j];
        if (c.in) continue;
        const dx = c.x - a.x, dz = c.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= 4 * R * R || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
        const push = (2 * R - d) / 2;
        a.x -= nx * push; a.z -= nz * push; c.x += nx * push; c.z += nz * push;
        const rv = (c.vx - a.vx) * nx + (c.vz - a.vz) * nz;
        if (rv < 0) {
          const imp = -(1 + BALL_REST) * rv / 2;
          a.vx -= imp * nx; a.vz -= imp * nz; c.vx += imp * nx; c.vz += imp * nz;
          events.hit?.(a, c, -rv);
        }
      }
    }
  }
}

export const moving = (balls) => balls.some((b) => !b.in && (b.vx || b.vz));
export const speedOf = (b) => Math.hypot(b.vx, b.vz);

// ---------- the game ----------

export class Game {
  // `players` are two ids; the first breaks.
  constructor(players) {
    this.players = players;
    this.balls = rack();
    this.turn = 0;
    this.groups = null;            // { [id]: 'solids' | 'stripes' } once the table closes
    this.shots = 0;
    this.winner = null;
    this.over = null;               // why: 'eight', 'foul-eight', 'early-eight', 'worn-out'
    this.inHand = true;             // the break is taken from behind the head string
    this.begin();
  }

  get cue() { return this.balls[0]; }
  get shooter() { return this.players[this.turn]; }
  get other() { return this.players[1 - this.turn]; }

  // What the shooter may hit is fixed before the balls move.
  begin() { this.log = { first: null, potted: [], cushion: false, legal: this.targets().map((b) => b.n) }; }

  // The balls this player may hit first right now.
  targets(id = this.shooter) {
    const live = this.balls.filter((b) => b.n && !b.in);
    if (!this.groups) return live.filter((b) => b.n !== 8);
    const mine = live.filter((b) => kindOf(b.n) === this.groups[id]);
    return mine.length ? mine : live.filter((b) => b.n === 8);
  }

  remaining(id) {
    if (!this.groups) return 7;
    return this.balls.filter((b) => b.n && !b.in && kindOf(b.n) === this.groups[id]).length;
  }

  // Hooks to hand to advance() while a shot plays out.
  recorder() {
    return {
      hit: (a, c) => {
        if (this.log.first === null && (a.n === 0 || c.n === 0)) this.log.first = a.n === 0 ? c.n : a.n;
      },
      pocket: (b) => this.log.potted.push(b.n),
      cushion: () => { this.log.cushion = true; },
    };
  }

  // Called once the balls are still. Works out what the shot was worth and
  // whose turn it is. Returns { foul, why, potted, continues, assigned }.
  settle() {
    this.shots++;
    const { first, potted } = this.log;
    const me = this.shooter, wasBreak = this.shots === 1;
    const scratch = potted.includes(0);
    const eightIn = potted.includes(8);
    const legalBefore = this.log.legal;
    const out = { foul: false, why: '', potted: potted.filter((n) => n), continues: false, assigned: null, eight: eightIn };

    // The eight on the break goes back on the table.
    if (wasBreak && eightIn) {
      const e = this.balls.find((b) => b.n === 8);
      e.in = false; e.x = L / 4; e.z = 0; e.vx = e.vz = 0;
      potted.splice(potted.indexOf(8), 1);
      out.eight = false;
    }

    if (first === null) { out.foul = true; out.why = 'missed everything'; }
    else if (!legalBefore.includes(first)) { out.foul = true; out.why = first === 8 ? 'hit the eight first' : 'wrong ball first'; }
    if (scratch) { out.foul = true; out.why = 'scratched'; }
    if (!out.foul && !wasBreak && !potted.length && !this.log.cushion) { out.foul = true; out.why = 'nothing reached a cushion'; }

    if (out.eight) {
      const cleared = this.groups && legalBefore.every((n) => n === 8);
      if (cleared && !out.foul) { this.finish(me, 'eight'); }
      else this.finish(this.other, cleared ? 'foul-eight' : 'early-eight');
      out.over = this.over;
      return out;
    }

    // The table closes on the first fair pot after the break.
    if (!this.groups && !out.foul && !wasBreak) {
      const first = potted.find((n) => n && n !== 8);
      if (first) {
        const kind = kindOf(first);
        this.groups = { [me]: kind, [this.other]: kind === 'solids' ? 'stripes' : 'solids' };
        out.assigned = kind;
      }
    }

    if (scratch) {
      const c = this.cue;
      c.in = false; c.vx = c.vz = 0;
    }

    const own = potted.filter((n) => n && n !== 8 && (!this.groups || kindOf(n) === this.groups[me]));
    out.continues = !out.foul && own.length > 0;
    this.inHand = out.foul;
    if (!out.continues) this.turn = 1 - this.turn;
    if (this.shots >= 80 && !this.winner) {
      const mine = this.remaining(this.players[0]), theirs = this.remaining(this.players[1]);
      this.finish(mine <= theirs ? this.players[0] : this.players[1], 'worn-out');
      out.over = this.over;
    }
    this.begin();
    return out;
  }

  finish(id, why) { this.winner = id; this.over = why; }

  // Where the cue ball goes when the shooter has it in hand: the break comes
  // from behind the head string; after a foul, anywhere clear.
  placeCue(onBreak) {
    const c = this.cue;
    const free = (x, z) => this.balls.every((b) => b === c || b.in || Math.hypot(b.x - x, b.z - z) > R * 2.4);
    const tries = onBreak ? [[-L / 4, 0], [-L / 4, 0.2], [-L / 4, -0.2]]
      : [[-L / 4, 0], [-L / 3, 0.3], [-L / 3, -0.3], [0.3, 0.3], [0.3, -0.3], [-0.2, 0.5], [-0.2, -0.5], [-L / 2 + 0.3, 0.2]];
    for (const [x, z] of tries) if (free(x, z)) { c.x = x; c.z = z; c.vx = c.vz = 0; c.in = false; return; }
    for (let i = 0; i < 200; i++) {
      const x = (Math.random() - 0.5) * (L - 0.4), z = (Math.random() - 0.5) * (W - 0.4);
      if (free(x, z)) { c.x = x; c.z = z; c.vx = c.vz = 0; c.in = false; return; }
    }
  }
}

// ---------- aiming ----------

const clearLine = (balls, ax, az, bx, bz, skip, gap) => {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1e-9;
  for (const b of balls) {
    if (b.in || skip.includes(b)) continue;
    const t = Math.max(0, Math.min(1, ((b.x - ax) * dx + (b.z - az) * dz) / len2));
    if (Math.hypot(b.x - (ax + t * dx), b.z - (az + t * dz)) < gap) return false;
  }
  return true;
};

// Decides a shot: { angle, speed, target, pocket, clean }. `skill` runs from
// about 0.3 (wild) to 1 (steady); it only changes how far off the line the
// shot lands, never how the shot is picked.
export function plan(game, skill = 0.7) {
  const balls = game.balls, cue = game.cue;
  const targets = game.targets();
  let best = null;
  if (game.shots === 0) {
    // The break: into the head of the rack, hard.
    const apex = balls.find((b) => b.n !== 0 && b.x === Math.min(...balls.filter((q) => q.n).map((q) => q.x)));
    best = { angle: Math.atan2(apex.z - cue.z, apex.x - cue.x), speed: 5.6 + Math.random() * 1.2, target: apex, pocket: null, clean: false, power: 'break' };
  } else {
    for (const t of targets) {
      for (const p of POCKETS) {
        // Aim at the pocket's mouth, a touch inside the cloth.
        const px = p.x * 0.97, pz = p.z * 0.97;
        const tx = px - t.x, tz = pz - t.z, td = Math.hypot(tx, tz) || 1e-9;
        const gx = t.x - (tx / td) * 2 * R, gz = t.z - (tz / td) * 2 * R;
        if (Math.abs(gx) > L / 2 - R || Math.abs(gz) > W / 2 - R) continue;
        const cx = gx - cue.x, cz = gz - cue.z, cd = Math.hypot(cx, cz);
        if (cd < R * 2) continue;
        const cos = (cx * tx + cz * tz) / (cd * td);
        if (cos < 0.34) continue;        // too thin a cut to trust
        if (!clearLine(balls, cue.x, cue.z, gx, gz, [cue, t], R * 2 * 0.98)) continue;
        if (!clearLine(balls, t.x, t.z, px, pz, [cue, t], R * 2 * 0.98)) continue;
        const score = cos * 2 - (cd + td) * 0.35 - (t.n === 8 ? 0 : 0);
        if (!best || score > best.score) {
          best = { angle: Math.atan2(cz, cx), speed: Math.min(MAX_SPEED * 0.8, Math.sqrt(2 * DECEL * (cd + td * 1.3)) + 1.1), target: t, pocket: p, clean: true, score };
        }
      }
    }
    if (!best) {
      // Nothing to pot: tap the nearest legal ball and hope for a cushion.
      const pool = targets.length ? targets : balls.filter((b) => b.n && !b.in);
      const open = pool.filter((t) => clearLine(balls, cue.x, cue.z, t.x, t.z, [cue, t], R * 2 * 0.98));
      const list = open.length ? open : pool;
      list.sort((a, b) => Math.hypot(a.x - cue.x, a.z - cue.z) - Math.hypot(b.x - cue.x, b.z - cue.z));
      const t = list[0];
      best = { angle: Math.atan2(t.z - cue.z, t.x - cue.x), speed: 2.6 + Math.random() * 1.2, target: t, pocket: null, clean: false };
    }
  }
  // Nobody's perfect; the further the shot, the more it shows.
  const dist = Math.hypot(best.target.x - cue.x, best.target.z - cue.z);
  const sigma = (0.006 + 0.026 * (1 - skill)) * (0.8 + dist * 0.35);
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.4;
  best.angle += gauss() * sigma * (best.power === 'break' ? 0.6 : 1);
  best.speed = Math.min(MAX_SPEED, Math.max(1.2, best.speed * (1 + gauss() * 0.06 * (1.2 - skill))));
  return best;
}

export function strike(game, angle, speed) {
  game.cue.vx = Math.cos(angle) * speed;
  game.cue.vz = Math.sin(angle) * speed;
}
