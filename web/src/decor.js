// What the office economy buys, drawn into the room.
//
// decorateDesk() puts an agent's desk items on their desk; placeOfficeItems()
// stands the office's own purchases in the slots the layout leaves free.
// Both can be called again with a new list: what was drawn before is taken
// away first, so a purchase shows up without rebuilding the room.
//
// Every desk item has its own spot, picked to stay clear of the monitor arm,
// the keyboard and mouse in front, the mug and the nameplate, so two items
// never land on top of each other however many are bought.

import * as THREE from 'three';
import { mat } from './office.js';
import { SEAT } from './figure.js';

const TOP = 0.83; // the desk surface

function box(parent, w, h, d, color, x, y, z, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts instanceof THREE.Material ? opts : mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function cyl(parent, rt, rb, h, color, x, y, z, seg = 14, opts) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), opts instanceof THREE.Material ? opts : mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function ball(parent, r, color, x, y, z, opts, seg = 10) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)), opts instanceof THREE.Material ? opts : mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const glow = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });

// A canvas drawn once, as a texture.
function painted(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Throw away what a group drew. Shared materials (mat()) stay; geometry and
// one-off textures go.
function clear(g) {
  g.traverse((o) => {
    o.geometry?.dispose();
    const m = o.material;
    if (m && !m.userData?.shared && (m.map || m instanceof THREE.MeshBasicMaterial)) { m.map?.dispose(); m.dispose(); }
  });
  g.parent?.remove(g);
}

// ---------- desk items ----------
//
// Desk-local: x along the desk (+x is the chair's right, where the drawers
// are), z towards the chair, y up. The surface is at TOP.

const DESK = {
  // A tall travel tumbler, front left, clear of the keyboard.
  mug(g) {
    cyl(g, 0.055, 0.045, 0.2, '#2f8f83', -0.74, TOP + 0.1, 0.34);
    cyl(g, 0.058, 0.058, 0.035, '#e9e6e1', -0.74, TOP + 0.215, 0.34);
    box(g, 0.012, 0.03, 0.03, '#2f3440', -0.74, TOP + 0.245, 0.32);
  },

  // The duck, under the right of the monitor, looking at whoever's sitting there.
  duck(g) {
    const y = mat('#f4c430', { roughness: 0.45 });
    const b = ball(g, 0.065, null, 0.3, TOP + 0.055, -0.4, y, 12);
    b.scale.set(1, 0.85, 1.2);
    ball(g, 0.045, null, 0.3, TOP + 0.13, -0.36, y, 12);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 8), mat('#e8833a', { roughness: 0.5 }));
    beak.position.set(0.3, TOP + 0.125, -0.3);
    beak.rotation.x = Math.PI / 2;
    g.add(beak);
    for (const ex of [-0.018, 0.018]) ball(g, 0.007, '#1a1a1a', 0.3 + ex, TOP + 0.145, -0.325, undefined, 6);
  },

  // A saguaro in a terracotta pot, under the left of the monitor.
  cactus(g) {
    const x = -0.52, z = -0.4;
    cyl(g, 0.06, 0.045, 0.07, '#c96f4a', x, TOP + 0.035, z, 12);
    const green = mat('#5f9e6e', { flatShading: true });
    cyl(g, 0.028, 0.03, 0.15, null, x, TOP + 0.14, z, 8, green);
    ball(g, 0.028, null, x, TOP + 0.215, z, green, 8);
    for (const [dx, h] of [[-1, 0.05], [1, 0.035]]) {
      cyl(g, 0.015, 0.015, 0.04, null, x + dx * 0.035, TOP + 0.13, z, 6, green);
      cyl(g, 0.015, 0.015, h, null, x + dx * 0.05, TOP + 0.15 + h / 2, z, 6, green);
    }
    ball(g, 0.012, '#f3a6b2', x, TOP + 0.245, z, undefined, 6);
  },

  // A framed photo at the back left, angled at the chair.
  photo(g) {
    const f = new THREE.Group();
    f.position.set(-0.8, TOP, -0.4);
    f.rotation.y = 0.35;
    g.add(f);
    box(f, 0.2, 0.16, 0.02, '#c39a6b', 0, 0.09, 0);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), new THREE.MeshBasicMaterial({
      toneMapped: false,
      map: painted(64, 48, (c, w, h) => {
        c.fillStyle = '#f6d7b0'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#e07a5f'; c.beginPath(); c.arc(w * 0.35, h * 0.55, 9, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#3d7ea6'; c.beginPath(); c.arc(w * 0.62, h * 0.5, 10, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#81b29a'; c.fillRect(0, h * 0.8, w, h * 0.2);
      }),
    }));
    pic.position.set(0, 0.09, 0.011);
    f.add(pic);
    const foot = box(f, 0.02, 0.09, 0.02, '#8c6440', 0, 0.045, -0.04);
    foot.rotation.x = 0.35;
  },

  // A tall arc lamp in the back left corner, leaning in over the side screen.
  lamp(g) {
    const metal = mat('#c9a04a', { roughness: 0.35, metalness: 0.4 });
    cyl(g, 0.09, 0.1, 0.03, null, -1.12, TOP + 0.015, -0.47, 16, metal);
    cyl(g, 0.014, 0.014, 0.7, null, -1.12, TOP + 0.36, -0.47, 8, metal);
    const arm = cyl(g, 0.012, 0.012, 0.42, null, -1.12, TOP + 0.78, -0.3, 8, metal);
    arm.rotation.x = 1.1;
    const shade = cyl(g, 0.04, 0.1, 0.12, null, -1.12, TOP + 0.82, -0.12, 16, mat('#2f3440', { roughness: 0.5 }));
    shade.rotation.x = 0.25;
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.085, 16), glow('#fff3c9'));
    bulb.position.set(-1.12, TOP + 0.755, -0.105);
    bulb.rotation.x = Math.PI / 2 + 0.25;
    g.add(bulb);
  },

  // Studio headphones on a hook off the right-hand edge of the desk.
  headphones(g) {
    const dark = mat('#23272f', { roughness: 0.6 });
    box(g, 0.05, 0.02, 0.05, '#8d94a3', 1.27, TOP - 0.06, 0.25);
    box(g, 0.015, 0.06, 0.015, '#8d94a3', 1.29, TOP - 0.1, 0.25);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 16, Math.PI), mat('#e07a5f', { roughness: 0.5 }));
    band.position.set(1.3, TOP - 0.15, 0.25);
    band.rotation.y = Math.PI / 2;
    band.castShadow = true;
    g.add(band);
    for (const ez of [-0.1, 0.1]) {
      const cup = cyl(g, 0.06, 0.06, 0.05, null, 1.3, TOP - 0.17, 0.25 + ez, 14, dark);
      cup.rotation.x = Math.PI / 2;
    }
  },

  // A lava lamp in the back right corner, glowing a little.
  lava(g) {
    const x = 1.16, z = -0.48;
    cyl(g, 0.05, 0.07, 0.08, '#8d94a3', x, TOP + 0.04, z, 12, mat('#8d94a3', { roughness: 0.3, metalness: 0.5 }));
    cyl(g, 0.035, 0.05, 0.2, null, x, TOP + 0.18, z, 12, new THREE.MeshStandardMaterial({ color: '#b04fd6', emissive: '#b04fd6', emissiveIntensity: 0.5, roughness: 0.2, transparent: true, opacity: 0.85 }));
    for (const [dy, r] of [[0.13, 0.022], [0.21, 0.016], [0.17, 0.012]]) ball(g, r, null, x + (r - 0.016), TOP + dy, z, glow('#ffb347'), 8);
    cyl(g, 0.02, 0.035, 0.05, '#8d94a3', x, TOP + 0.305, z, 12);
  },

  // A bonsai on a little slate, just left of the monitor arm.
  bonsai(g) {
    const x = -0.26, z = -0.42;
    box(g, 0.2, 0.04, 0.12, '#3b404c', x, TOP + 0.02, z);
    const trunk = cyl(g, 0.012, 0.02, 0.1, '#6b4a2f', x, TOP + 0.09, z, 6);
    trunk.rotation.z = 0.35;
    const leaf = mat('#477d55', { flatShading: true });
    for (const [dx, dy, s] of [[-0.03, 0.15, 0.05], [0.04, 0.13, 0.04], [-0.07, 0.12, 0.035]]) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), leaf);
      c.position.set(x + dx, TOP + dy, z);
      c.scale.y = 0.6;
      c.castShadow = true;
      g.add(c);
    }
  },

  // A mechanical keyboard over the stock one, with a few bright caps and an underglow.
  keyboard(g) {
    box(g, 0.84, 0.035, 0.29, '#23272f', -0.02, TOP + 0.04, 0.15);
    const caps = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.25), new THREE.MeshStandardMaterial({
      roughness: 0.6,
      map: painted(160, 50, (c) => {
        c.fillStyle = '#23272f'; c.fillRect(0, 0, 160, 50);
        const cols = ['#e9e6e1', '#e9e6e1', '#e9e6e1', '#cfd4dc'];
        for (let r = 0; r < 5; r++) for (let k = 0; k < 16; k++) {
          c.fillStyle = r === 0 && k === 0 ? '#e07a5f' : r === 4 && k > 4 && k < 11 ? '#cfd4dc' : cols[(r + k) % 4];
          if (r === 4 && k > 5 && k < 11) continue;
          c.fillRect(k * 10 + 1, r * 10 + 1, 8, 8);
        }
        c.fillStyle = '#cfd4dc'; c.fillRect(51, 41, 58, 8);
        c.fillStyle = '#3d7ea6'; c.fillRect(141, 31, 18, 8);
      }),
    }));
    caps.rotation.x = -Math.PI / 2;
    caps.position.set(-0.02, TOP + 0.059, 0.15);
    g.add(caps);
    box(g, 0.86, 0.006, 0.31, null, -0.02, TOP + 0.022, 0.15, glow('#56c7ff')).castShadow = false;
  },

  // A little gold trophy, under the right of the monitor.
  trophy(g) {
    const gold = mat('#e2b33c', { roughness: 0.3, metalness: 0.6 });
    const x = 0.55, z = -0.4;
    box(g, 0.1, 0.04, 0.1, '#3b3330', x, TOP + 0.02, z);
    cyl(g, 0.012, 0.02, 0.06, null, x, TOP + 0.07, z, 8, gold);
    cyl(g, 0.055, 0.025, 0.08, null, x, TOP + 0.14, z, 14, gold);
    for (const ex of [-0.06, 0.06]) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 10), gold);
      h.position.set(x + ex, TOP + 0.15, z);
      g.add(h);
    }
  },

  // A portrait monitor on its own pole off the back right, above the clutter.
  monitor(g) {
    const metal = mat('#3b404c');
    box(g, 0.12, 0.06, 0.14, null, 0.98, TOP + 0.03, -0.5, metal);
    cyl(g, 0.025, 0.025, 0.6, null, 0.98, TOP + 0.33, -0.5, 10, metal);
    const s = new THREE.Group();
    s.position.set(1.02, TOP + 0.72, -0.4);
    s.rotation.y = -0.45;
    g.add(s);
    box(s, 0.4, 0.66, 0.04, '#1e2128', 0, 0, 0);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.62), new THREE.MeshBasicMaterial({
      toneMapped: false,
      map: painted(72, 124, (c, w, h) => {
        c.fillStyle = '#16202c'; c.fillRect(0, 0, w, h);
        const cols = ['#7bd389', '#56c7ff', '#f2cc8f', '#c9c1b4'];
        for (let r = 0; r < 14; r++) {
          c.fillStyle = cols[(r * 7) % 4];
          c.fillRect(6 + (r % 3) * 6, 8 + r * 8, 16 + ((r * 13) % 36), 3);
        }
      }),
    }));
    face.position.z = 0.021;
    s.add(face);
  },

  // Racing wings, a headrest and stripes, bolted on to the desk chair itself.
  chair(g, desk, accent) {
    if (!desk.chair) return;
    const c = new THREE.Group();
    c.name = 'decor-chair';
    desk.chair.add(c);
    const back = new THREE.Group();
    back.position.set(0, SEAT, 0.3);
    back.rotation.x = 0.12;
    c.add(back);
    const col = mat(accent);
    for (const sx of [-0.31, 0.31]) box(back, 0.07, 0.62, 0.13, null, sx, 0.42, 0.01, col);
    box(back, 0.4, 0.2, 0.11, '#1e2128', 0, 0.94, 0.0);
    box(back, 0.06, 0.6, 0.012, null, 0, 0.5, -0.03, col).castShadow = false;
    for (const sx of [-0.3, 0.3]) box(c, 0.06, 0.07, 0.56, null, sx, SEAT + 0.02, 0, col);
    return c;
  },

  // The desk cat, curled up asleep at the front right.
  cat(g) {
    const fur = mat('#e39b52', { roughness: 0.95 });
    const x = 1.02, z = 0.1;
    const body = ball(g, 0.13, null, x, TOP + 0.07, z, fur, 12);
    body.scale.set(1.25, 0.6, 0.95);
    const head = ball(g, 0.075, null, x - 0.13, TOP + 0.1, z + 0.05, fur, 12);
    head.scale.set(1, 0.85, 1);
    for (const ez of [-0.035, 0.035]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.05, 4), fur);
      ear.position.set(x - 0.14, TOP + 0.17, z + 0.05 + ez);
      ear.castShadow = true;
      g.add(ear);
    }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 6, 14, Math.PI * 0.9), fur);
    tail.position.set(x + 0.02, TOP + 0.025, z + 0.03);
    tail.rotation.x = -Math.PI / 2;
    tail.rotation.z = -0.4;
    tail.castShadow = true;
    g.add(tail);
    for (const ez of [-0.022, 0.022]) box(g, 0.004, 0.004, 0.025, '#3b3330', x - 0.2, TOP + 0.11, z + 0.05 + ez).castShadow = false;
  },
};

// Draws `itemIds` on one desk, replacing what it drew last time. `accent`
// colours what is meant to be theirs (the gaming chair).
export function decorateDesk(desk, itemIds = [], { accent = '#d6453d' } = {}) {
  if (!desk?.group) return;
  const ids = [...new Set(itemIds)].filter((id) => DESK[id]).sort();
  const key = `${ids.join(',')}|${accent}`;
  if (desk.decorKey === key) return;
  desk.decorKey = key;
  if (desk.decor) for (const g of desk.decor) clear(g);
  const g = new THREE.Group();
  g.name = 'decor';
  desk.group.add(g);
  desk.decor = [g];
  for (const id of ids) {
    const extra = DESK[id](g, desk, accent);
    if (extra) desk.decor.push(extra);
  }
}

// ---------- office items ----------
//
// Built facing +z, centred on the origin, then turned to the slot's `face`.

const OFFICE = {
  // A neon sign on a black board, on legs.
  neon(g) {
    for (const x of [-0.7, 0.7]) box(g, 0.06, 1.2, 0.06, '#2f3440', x, 0.6, -0.05);
    box(g, 1.7, 0.75, 0.06, '#1b1d22', 0, 1.55, -0.05);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.65), new THREE.MeshBasicMaterial({
      toneMapped: false, transparent: true,
      map: painted(320, 130, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.font = '700 54px "Inter Variable", Inter, system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.shadowColor = '#ff4fa3';
        c.shadowBlur = 18;
        c.strokeStyle = '#ffd1ea';
        c.lineWidth = 3;
        c.strokeText('SHIP IT', w / 2, h / 2);
        c.fillStyle = '#ff7ac0';
        c.fillText('SHIP IT', w / 2, h / 2);
      }),
    }));
    sign.position.set(0, 1.55, -0.015);
    g.add(sign);
  },

  vending(g) {
    box(g, 0.95, 1.95, 0.8, '#c8423b', 0, 0.975, 0);
    box(g, 0.6, 1.35, 0.02, null, -0.1, 1.2, 0.4, new THREE.MeshStandardMaterial({ color: '#cfe6f2', roughness: 0.1, transparent: true, opacity: 0.55 }));
    const cans = ['#3d7ea6', '#f2cc8f', '#81b29a', '#e07a5f', '#9c6ade'];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) cyl(g, 0.045, 0.045, 0.14, cans[(r + k) % cans.length], -0.32 + k * 0.145, 0.68 + r * 0.32, 0.3, 10);
    box(g, 0.2, 0.6, 0.02, '#2f3440', 0.33, 1.3, 0.41);
    box(g, 0.6, 0.18, 0.02, '#1b1d22', -0.1, 0.3, 0.41);
    box(g, 0.08, 0.05, 0.02, null, 0.33, 1.5, 0.425, glow('#7bd389'));
  },

  arcade(g) {
    const body = mat('#3d4f6e');
    box(g, 0.72, 0.95, 0.75, null, 0, 0.475, 0, body);
    const panel = box(g, 0.72, 0.08, 0.4, '#1b1d22', 0, 1.0, 0.2);
    panel.rotation.x = 0.25;
    box(g, 0.72, 0.85, 0.5, null, 0, 1.45, -0.12, body);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.44), new THREE.MeshBasicMaterial({
      toneMapped: false,
      map: painted(112, 88, (c, w, h) => {
        c.fillStyle = '#0c0f1a'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#f4c430';
        c.beginPath(); c.moveTo(40, 44); c.arc(40, 44, 14, 0.5, Math.PI * 2 - 0.5); c.fill();
        c.fillStyle = '#ffffff';
        for (let k = 0; k < 4; k++) c.fillRect(62 + k * 12, 42, 4, 4);
        c.fillStyle = '#e07a5f'; c.fillRect(8, 8, 30, 5);
      }),
    }));
    screen.position.set(0, 1.42, 0.135);
    screen.rotation.x = -0.12;
    g.add(screen);
    box(g, 0.72, 0.16, 0.42, null, 0, 1.95, -0.08, glow('#ff7ac0'));
    ball(g, 0.03, '#e07a5f', -0.15, 1.08, 0.22);
    for (const [k, c] of [['#3d7ea6', 0.06], ['#7bd389', 0.16]]) ball(g, 0.025, k, c, 1.07, 0.2);
  },

  jukebox(g) {
    box(g, 0.9, 1.0, 0.6, '#8c6440', 0, 0.5, 0);
    const top = cyl(g, 0.45, 0.45, 0.6, '#8c6440', 0, 1.0, 0, 24);
    top.rotation.x = Math.PI / 2;
    top.scale.set(1, 1, 0.9);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 8, 24, Math.PI), glow('#ffb347'));
    arch.position.set(0, 1.0, 0.31);
    g.add(arch);
    box(g, 0.62, 0.32, 0.02, '#f5f0e8', 0, 0.78, 0.31);
    for (let k = 0; k < 5; k++) box(g, 0.06, 0.4, 0.02, null, -0.24 + k * 0.12, 0.3, 0.31, glow(['#e07a5f', '#f2cc8f', '#7bd389', '#56c7ff', '#b04fd6'][k]));
  },

  aquarium(g) {
    box(g, 1.5, 0.75, 0.55, '#2f3440', 0, 0.375, 0);
    const tank = box(g, 1.44, 0.6, 0.5, null, 0, 1.05, 0, new THREE.MeshStandardMaterial({ color: '#6fc3e0', roughness: 0.1, transparent: true, opacity: 0.45 }));
    tank.castShadow = false;
    box(g, 1.4, 0.06, 0.46, '#e8dccb', 0, 0.79, 0);
    box(g, 1.5, 0.05, 0.55, '#2f3440', 0, 1.375, 0);
    const weed = mat('#3f7350', { flatShading: true });
    for (const x of [-0.55, -0.4, 0.5]) {
      const w = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 5), weed);
      w.position.set(x, 1.0, -0.1);
      g.add(w);
    }
    for (const [x, y, c] of [[-0.15, 1.08, '#f28c38'], [0.2, 0.98, '#f4c430'], [0.35, 1.15, '#e07a5f']]) {
      const f = ball(g, 0.045, c, x, y, 0.05, undefined, 8);
      f.scale.set(1.5, 1, 0.6);
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 4), mat(c));
      t.position.set(x - 0.08, y, 0.05);
      t.rotation.z = Math.PI / 2;
      g.add(t);
    }
  },

  // Turned side-on to its slot so it takes depth, not width, off the wall.
  pingpong(g) {
    const t = new THREE.Group();
    t.rotation.y = Math.PI / 2;
    t.position.z = 0.9;
    g.add(t);
    box(t, 2.2, 0.05, 1.2, '#2a6f97', 0, 0.74, 0);
    box(t, 0.02, 0.005, 1.2, '#ffffff', 0, 0.768, 0).castShadow = false;
    box(t, 0.02, 0.15, 1.28, '#f5f0e8', 0, 0.84, 0);
    for (const [x, z] of [[-0.95, -0.5], [0.95, -0.5], [-0.95, 0.5], [0.95, 0.5]]) box(t, 0.06, 0.72, 0.06, '#2f3440', x, 0.36, z);
    for (const [x, c] of [[-0.6, '#d6453d'], [0.6, '#1b1d22']]) {
      cyl(t, 0.08, 0.08, 0.015, c, x, 0.775, 0.3, 14);
      box(t, 0.025, 0.012, 0.1, '#c39a6b', x, 0.775, 0.42);
    }
    ball(t, 0.02, '#ffffff', 0.2, 0.79, -0.1, undefined, 8);
  },
};

// Footprints, half-width and depth from the slot, to keep people walking round.
const FOOT = { neon: [0.9, 0.3], vending: [0.5, 0.45], arcade: [0.4, 0.45], jukebox: [0.5, 0.35], aquarium: [0.8, 0.35], pingpong: [0.7, 2.1] };
// The floor an item takes at (x, z) turned to `face`, as [x0, x1, z0, z1].
export function footRect(id, x, z, face = 0) {
  const [hw, d] = FOOT[id];
  const c = Math.cos(face), s = Math.sin(face);
  const pts = [[-hw, -0.4], [hw, -0.4], [-hw, d], [hw, d]].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
}
// Each item always takes the same slot, so buying one never moves another.
const ORDER = Object.keys(OFFICE);

// `scene` is where they stand; buildOffice's return doesn't carry it.
export function placeOfficeItems(office, itemIds = [], scene = office?.scene) {
  const slots = office?.decorSlots;
  if (!slots?.length || !scene) return;
  const ids = ORDER.filter((id) => itemIds.includes(id));
  const key = ids.join(',');
  if (office.decorKey === key) return;
  office.decorKey = key;
  for (const g of office.decor || []) clear(g);
  office.decor = [];
  ids.forEach((id) => {
    // The boss's own spot for it, if they've moved it, else its slot.
    const own = office.custom?.items?.[id];
    const slot = own ? { x: own[0], z: own[1], face: own[2] || 0 } : slots[ORDER.indexOf(id) % slots.length];
    if (!slot) return;
    const g = new THREE.Group();
    g.name = `decor-${id}`;
    g.position.set(slot.x, 0, slot.z);
    g.rotation.y = slot.face || 0;
    OFFICE[id](g);
    scene.add(g);
    office.decor.push(g);
    // Nothing is ever sold back, so once blocked a spot stays blocked.
    const [x0, x1, z0, z1] = footRect(id, slot.x, slot.z, slot.face);
    if (!slot.blocked) office.grid?.block(x0, x1, z0, z1);
    slot.blocked = true;
  });
}

export const DESK_ITEMS = Object.keys(DESK);
export const OFFICE_ITEMS = ORDER;
