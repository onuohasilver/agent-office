import * as THREE from 'three';
import { Grid } from './nav.js';
import { SEAT } from './figure.js';

// The floor runs x0..x1 and z0..z1. The team's floor is x -20..20; east of
// that is the guest wing, where visitors from linked offices work.
export const W = 52, D = 30;
export const FLOOR = { x0: -20, x1: 32, z0: -D / 2, z1: D / 2, cx: 6 };
const WING = 20.4; // the glass line between our floor and the guest wing
const DOOR_X = 27;
// Where the pool table stands, and how high its cloth is. The layout moves
// it, so buildOffice sets x and z before anything else reads them.
export const POOL = { x: 7.6, z: 10.9, felt: 0.84 };

// Floor plans, bought with the office pot (see shared/shop.js). The walls,
// library, server room, lounge, reception and guest wing stay where they
// are; a layout moves the desks, the communal table, the pool table and the
// whiteboard huddle. A desk is [x, z, turned]: a turned desk faces south,
// its chair on the north side. `slots` are open floor for office items.
const ROWS = [[-9, -3], [-3, -3], [3, -3], [9, -3], [-9, 5], [-3, 5], [3, 5], [9, 5]];
export const LAYOUTS = {
  'layout-classic': {
    desks: ROWS.map(([x, z]) => [x, z, false]),
    table: [-1, 11.6], pool: [7.6, 10.9],
    slots: [[14.5, 5.5], [-6, -11.2], [3, -11.2], [16.5, 10.5], [-7, 9], [13, 1.5]],
  },
  // Two clusters of four, back to back, with a rug for the lounge between.
  'layout-pods': {
    desks: [-1, 1].flatMap((side) => {
      const cx = side * 6.5;
      return [[cx - 1.3, -1.4, false], [cx + 1.3, -1.4, false], [cx - 1.3, -2.6, true], [cx + 1.3, -2.6, true]];
    }),
    table: [0, 5.5], pool: [7.6, 10.9],
    slots: [[0, -2], [-6, -9.5], [6, -9.5], [14.5, 5.5], [16.5, 10.5], [-7, 9]],
    rug: [0, 5.5, 8, 4.2, '#b9c7a5'],
  },
  // One long row of desks, the open floor given over to the lounge and games.
  'layout-studio': {
    desks: Array.from({ length: 8 }, (_, i) => [-9.1 + i * 2.6, -6.5, false]),
    table: [-4, 3.5], pool: [4.5, 3.5],
    slots: [[12, 3.5], [-12, 2.5], [14.5, 8], [0, 9], [5, 12.5], [16.5, 11.5]],
    rug: [0, 3.5, 16, 5, '#d7b49e'],
  },
  // Desks round a courtyard, facing in, the pool table at its heart.
  'layout-campus': {
    desks: [[-6.6, -4, true], [-3.3, -4, true], [3.3, -4, true], [6.6, -4, true], [-6.6, 6, false], [-3.3, 6, false], [3.3, 6, false], [6.6, 6, false]],
    table: [-1, 11.6], pool: [0, 1],
    slots: [[-9.5, 1], [9.5, 1], [14.5, 5.5], [-6, -11.2], [3, -11.2], [16.5, 10.5]],
    rug: [0, 1, 11, 5.6, '#c9b79c'],
  },
};
export const layoutOf = (id) => LAYOUTS[id] || LAYOUTS['layout-classic'];

// The paint and floor bought from the shop. The floor is a tint over the
// planks, so oak is no tint at all.
const FLOOR_TINT = { 'floor-oak': '#ffffff', 'floor-walnut': '#a77c55', 'floor-terrazzo': '#f2efea', 'floor-concrete': '#b8b9b6' };
const WALL_PAINT = { 'wall-cream': '#f5f0e8', 'wall-sage': '#d6e2d0', 'wall-navy': '#4a5d80', 'wall-blush': '#f1d9d2' };
const wallMat = new THREE.MeshStandardMaterial({ color: '#f5f0e8', roughness: 0.82 });

const C = {
  floor: '#ece3d4', wall: '#f5f0e8', trim: '#d9cdbb', wood: '#c39a6b', woodDark: '#8c6440',
  metal: '#3b404c', rack: '#262a33', plant: '#5f9e6e', plantDark: '#477d55', pot: '#e4d6c1',
  couch: '#5b7fa6', rug: '#c99b84', glass: '#cfe6f2', board: '#fbfaf7', chair: '#30343d',
};

const mats = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...opts }));
  return mats.get(key);
}

function box(parent, w, h, d, color, x, y, z, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts instanceof THREE.Material ? opts : mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function canvasPlane(parent, w, h, px, py) {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = py;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  parent.add(mesh);
  return { canvas, ctx: canvas.getContext('2d'), tex, mesh };
}

const FONT = '"Inter Variable", Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

function cyl(parent, rt, rb, h, color, x, y, z, seg = 16, opts) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), opts instanceof THREE.Material ? opts : mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const GREENS = ['#5f9e6e', '#477d55', '#6fae74', '#3f7350', '#7dbb7a'];

// Three kinds of plant so the room doesn't look like it bought in bulk:
// a leafy bush, a tall fiddle-leaf on a stem, and a spiky snake plant.
function plant(scene, grid, x, z, s = 1, kind = 'bush') {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = x * 1.7 + z;
  g.scale.setScalar(s);
  cyl(g, 0.35, 0.27, 0.6, C.pot, 0, 0.3, 0, 18);
  cyl(g, 0.37, 0.37, 0.06, '#d8c8b0', 0, 0.6, 0, 18);
  cyl(g, 0.31, 0.31, 0.02, '#5a4130', 0, 0.62, 0, 18);
  const leaf = (r, px, py, pz, c) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(GREENS[c % GREENS.length], { flatShading: true }));
    m.position.set(px, py, pz);
    m.rotation.set(px * 3, pz * 5, py);
    m.castShadow = true;
    g.add(m);
  };
  if (kind === 'tall') {
    cyl(g, 0.035, 0.05, 1.5, C.woodDark, 0, 1.35, 0, 6);
    leaf(0.42, 0.12, 1.55, 0.05, 1);
    leaf(0.48, -0.15, 1.95, -0.08, 0);
    leaf(0.38, 0.18, 2.3, 0.1, 2);
    leaf(0.3, -0.05, 2.6, 0, 4);
  } else if (kind === 'snake') {
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2, h = 0.8 + ((k * 37) % 5) * 0.12;
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.07, h, 4), mat(k % 2 ? '#4e8a5c' : '#6f9f5a', { flatShading: true }));
      blade.position.set(Math.cos(a) * 0.12, 0.62 + h / 2, Math.sin(a) * 0.12);
      blade.rotation.set(Math.sin(a) * 0.18, a, -Math.cos(a) * 0.18);
      blade.scale.z = 0.35;
      blade.castShadow = true;
      g.add(blade);
    }
  } else {
    leaf(0.55, 0, 1.0, 0, 0);
    leaf(0.4, 0.3, 1.25, 0.1, 1);
    leaf(0.38, -0.28, 1.2, -0.12, 2);
    leaf(0.36, 0.05, 1.5, -0.2, 3);
  }
  scene.add(g);
  grid.block(x - 0.45 * s, x + 0.45 * s, z - 0.45 * s, z + 0.45 * s);
  return g;
}

// A little potted succulent for desks and shelves.
function succulent(parent, x, y, z) {
  cyl(parent, 0.09, 0.07, 0.12, '#e8dccb', x, y + 0.06, z, 12);
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), mat('#7aa874', { flatShading: true }));
  m.position.set(x, y + 0.17, z);
  m.scale.y = 0.7;
  m.castShadow = true;
  parent.add(m);
}

function bookStack(parent, x, y, z, n = 3) {
  const cols = ['#e07a5f', '#3d7ea6', '#f2cc8f', '#81b29a', '#9c6ade'];
  for (let k = 0; k < n; k++) {
    const b = box(parent, 0.34 - k * 0.03, 0.05, 0.25, cols[(k + Math.round(x * 7)) % cols.length], x, y + 0.025 + k * 0.05, z);
    b.rotation.y = (k - 1) * 0.15;
  }
}

function deskLamp(parent, x, y, z) {
  const metal = mat('#2f3440', { roughness: 0.5 });
  cyl(parent, 0.11, 0.12, 0.03, null, x, y + 0.015, z, 16, metal);
  const arm = box(parent, 0.03, 0.42, 0.03, null, x, y + 0.22, z, metal);
  arm.rotation.x = -0.25;
  const fore = box(parent, 0.03, 0.03, 0.3, null, x, y + 0.42, z + 0.13, metal);
  fore.rotation.x = 0.35;
  const shade = cyl(parent, 0.05, 0.12, 0.14, null, x, y + 0.36, z + 0.27, 16, mat('#e9b949', { roughness: 0.45 }));
  shade.rotation.x = 0.4;
  const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshBasicMaterial({ color: '#fff3c9' }));
  bulb.position.set(x, y + 0.3, z + 0.3);
  bulb.rotation.x = -Math.PI / 2 + 0.4;
  parent.add(bulb);
}

// A framed print hung on a wall; paint() draws the picture.
function framedArt(wall, lx, y, w, h, paint, frame = '#3b3330') {
  const items = [box(wall.g, w + 0.14, h + 0.14, 0.05, frame, lx, y, 0.18)];
  const pic = canvasPlane(wall.g, w, h, Math.round(256 * w), Math.round(256 * h));
  pic.mesh.position.set(lx, y, 0.21);
  pic.mesh.material = new THREE.MeshStandardMaterial({ map: pic.tex, roughness: 0.9 });
  paint(pic.ctx, pic.canvas.width, pic.canvas.height);
  pic.tex.needsUpdate = true;
  items.push(pic.mesh);
  wall.attach.push(...items);
}

const ART = {
  sunset(g, w, h) {
    g.fillStyle = '#f4e3c8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e9967a'; g.beginPath(); g.arc(w * 0.62, h * 0.45, w * 0.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8fb0a0'; g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * 0.62); g.quadraticCurveTo(w * 0.35, h * 0.4, w * 0.7, h * 0.66); g.lineTo(w, h * 0.58); g.lineTo(w, h); g.fill();
    g.fillStyle = '#4f7c74'; g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * 0.8); g.quadraticCurveTo(w * 0.5, h * 0.6, w, h * 0.82); g.lineTo(w, h); g.fill();
  },
  blocks(g, w, h) {
    g.fillStyle = '#f7f1e6'; g.fillRect(0, 0, w, h);
    const cols = ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f'];
    g.fillStyle = cols[0]; g.fillRect(w * 0.12, h * 0.12, w * 0.42, h * 0.4);
    g.fillStyle = cols[1]; g.fillRect(w * 0.54, h * 0.12, w * 0.34, h * 0.22);
    g.fillStyle = cols[2]; g.fillRect(w * 0.54, h * 0.34, w * 0.34, h * 0.54);
    g.fillStyle = cols[3]; g.fillRect(w * 0.12, h * 0.52, w * 0.42, h * 0.36);
    g.fillStyle = '#3d405b'; g.beginPath(); g.arc(w * 0.33, h * 0.7, w * 0.1, 0, Math.PI * 2); g.fill();
  },
  arcs(g, w, h) {
    g.fillStyle = '#efe6d8'; g.fillRect(0, 0, w, h);
    const cols = ['#c8553d', '#f28f3b', '#ffd5c2', '#588b8b'];
    cols.forEach((c, i) => {
      g.strokeStyle = c; g.lineWidth = w * 0.07;
      g.beginPath(); g.arc(w / 2, h * 0.85, w * (0.38 - i * 0.09), Math.PI, 0); g.stroke();
    });
  },
  leaf(g, w, h) {
    g.fillStyle = '#e7ece4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5f8f6b';
    g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.18, h * 0.36, 0.35, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#e7ece4'; g.lineWidth = w * 0.015;
    g.beginPath(); g.moveTo(w * 0.38, h * 0.82); g.lineTo(w * 0.62, h * 0.18); g.stroke();
  },
};

function wallClock(wall, lx, y) {
  const face = canvasPlane(wall.g, 0.9, 0.9, 256, 256);
  face.mesh.geometry = new THREE.CircleGeometry(0.45, 40);
  face.mesh.position.set(lx, y, 0.22);
  const rim = cyl(wall.g, 0.5, 0.5, 0.08, '#3b3330', lx, y, 0.17, 40);
  rim.rotation.x = Math.PI / 2;
  wall.attach.push(rim, face.mesh);
  const draw = () => {
    const { ctx: g, tex } = face;
    g.fillStyle = '#fbf8f2'; g.fillRect(0, 0, 256, 256);
    g.translate(128, 128);
    g.fillStyle = '#3b3330';
    for (let k = 0; k < 12; k++) {
      g.save(); g.rotate((k / 12) * Math.PI * 2);
      g.fillRect(-3, -112, 6, k % 3 ? 12 : 22);
      g.restore();
    }
    const d = new Date(), m = d.getMinutes(), hr = (d.getHours() % 12) + m / 60;
    const hand = (a, len, wd, col) => { g.save(); g.rotate(a); g.fillStyle = col; g.fillRect(-wd / 2, -len, wd, len + 14); g.restore(); };
    hand((hr / 12) * Math.PI * 2, 62, 9, '#3b3330');
    hand((m / 60) * Math.PI * 2, 92, 6, '#3b3330');
    g.fillStyle = '#e07a5f'; g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
    tex.needsUpdate = true;
  };
  draw();
  setInterval(draw, 30000);
}

// Low carpet tiles, each a hair off the next, so the work floor reads as a
// rug rather than a flat grey slab.
function carpetTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const n = 8, s = 512 / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      g.fillStyle = `hsl(${170 + Math.random() * 8}, ${9 + Math.random() * 4}%, ${82 + Math.random() * 2.5}%)`;
      g.fillRect(i * s, j * s, s, s);
      g.globalAlpha = 0.05;
      for (let k = 0; k < 40; k++) {
        g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
        g.fillRect(i * s + Math.random() * s, j * s + Math.random() * s, 2, 2);
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(60, 80, 80, 0.09)';
      g.fillRect(i * s, j * s, s, 1.5);
      g.fillRect(i * s, j * s, 1.5, s);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24.5 / 8, 12.6 / 8);
  tex.anisotropy = 8;
  return tex;
}

// Soft warm patch of daylight on the floor under a window.
let sunTex;
function sunPatch(scene, x, z, w, d) {
  if (!sunTex) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, 'rgba(255, 236, 200, 0.55)');
    grad.addColorStop(1, 'rgba(255, 236, 200, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 64);
    sunTex = new THREE.CanvasTexture(c);
    sunTex.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.025, z);
  scene.add(m);
}

// ---------- desks ----------

// One sheet of grain, shared by every desktop: the tops read as real wood
// instead of flat tan, and it costs a single texture for the whole room.
let topMat;
function deskTopMaterial() {
  if (!topMat) {
    const tex = plankTexture();
    tex.repeat.set(0.5, 0.22);
    topMat = new THREE.MeshStandardMaterial({ map: tex, color: '#f0d6b4', roughness: 0.52 });
  }
  return topMat;
}

// Keycaps, drawn once and laid over the keyboard as a texture. Modelling
// sixty keys per desk would be sixty meshes nobody can see from the camera.
let keyTex;
function keycapTexture() {
  if (keyTex) return keyTex;
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 128;
  const g = c.getContext('2d');
  const cols = 15, rows = 5, cw = c.width / cols, ch = c.height / rows, pad = 3;
  g.fillStyle = '#cfcac1';
  g.fillRect(0, 0, c.width, c.height);
  const cap = (x, y, w, h) => {
    g.fillStyle = '#f7f5f1';
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(88, 84, 78, 0.22)';
    g.fillRect(x, y + h - 2, w, 2);
  };
  for (let r = 0; r < rows - 1; r++)
    for (let i = 0; i < cols; i++) cap(i * cw + pad, r * ch + pad, cw - pad * 2, ch - pad * 2);
  // bottom row: modifiers either side of one long space bar
  const last = (rows - 1) * ch;
  for (const i of [0, 1, 2, 11, 12, 13, 14]) cap(i * cw + pad, last + pad, cw - pad * 2, ch - pad * 2);
  cap(3 * cw + pad, last + pad, cw * 8 - pad * 2, ch - pad * 2);
  keyTex = new THREE.CanvasTexture(c);
  keyTex.colorSpace = THREE.SRGBColorSpace;
  keyTex.anisotropy = 4;
  return keyTex;
}

// A flat screen: dark shell, thin bezel, canvas face. Returns the group so
// the caller can tilt the whole thing, face and all.
function flatPanel(parent, w, h, px, py, pz, pxPerM = 500) {
  const g = new THREE.Group();
  g.position.set(px, py, pz);
  parent.add(g);
  // The back of a monitor is what most of the room sees, so it gets the
  // lighter graphite shell and the bezel keeps the near-black.
  const shell = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.12, 0.05),
    ['#272d38', '#272d38', '#272d38', '#272d38', '#1e232c', '#3c4352'].map((c) => mat(c)));
  shell.position.set(0, -0.015, -0.03);
  shell.castShadow = true;
  shell.receiveShadow = true;
  g.add(shell);
  box(g, (w + 0.08) * 0.55, 0.035, 0.012, '#323a47', 0, -h * 0.34, -0.056).castShadow = false;
  const face = canvasPlane(g, w, h, Math.round(w * pxPerM), Math.round(h * pxPerM));
  face.mesh.position.set(0, 0.015, 0.002);
  return { g, face };
}

// Headphones resting on a little hook stand.
function headphones(parent, x, y, z) {
  const dark = mat('#23272f', { roughness: 0.6 });
  cyl(parent, 0.11, 0.13, 0.025, '#2f3440', x, y + 0.012, z, 14);
  cyl(parent, 0.022, 0.022, 0.3, '#2f3440', x, y + 0.16, z, 10);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 6, 16, Math.PI), dark);
  band.position.set(x, y + 0.3, z);
  band.castShadow = true;
  parent.add(band);
  for (const ex of [-0.11, 0.11]) {
    const cup = cyl(parent, 0.065, 0.065, 0.05, null, x + ex, y + 0.28, z, 14, dark);
    cup.rotation.z = Math.PI / 2;
    cup.castShadow = true;
  }
}

// The rubber duck. Every office has one; it listens better than most.
function duck(parent, x, y, z) {
  const yellow = mat('#f4c430', { roughness: 0.45 });
  const bodyM = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), yellow);
  bodyM.position.set(x, y + 0.06, z);
  bodyM.scale.set(1, 0.85, 1.25);
  bodyM.castShadow = true;
  parent.add(bodyM);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), yellow);
  head.position.set(x, y + 0.15, z - 0.05);
  head.castShadow = true;
  parent.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 8), mat('#e8833a', { roughness: 0.5 }));
  beak.position.set(x, y + 0.14, z - 0.11);
  beak.rotation.x = -Math.PI / 2;
  parent.add(beak);
  for (const ex of [-0.02, 0.02]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), mat('#1a1a1a'));
    eye.position.set(x + ex, y + 0.17, z - 0.085);
    parent.add(eye);
  }
}

// A small framed photo, angled towards whoever is sitting there.
function photoFrame(parent, x, y, z, index) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = -0.4 + (index % 2) * 0.8;
  parent.add(g);
  box(g, 0.26, 0.21, 0.02, '#3b3330', 0, 0.12, 0);
  const pic = canvasPlane(g, 0.21, 0.16, 84, 64);
  pic.mesh.position.set(0, 0.125, 0.012);
  const { ctx: p, canvas } = pic;
  p.fillStyle = '#cfe3ef';
  p.fillRect(0, 0, canvas.width, canvas.height);
  p.fillStyle = '#8fb0a0';
  p.beginPath();
  p.moveTo(0, canvas.height);
  p.quadraticCurveTo(canvas.width * 0.5, canvas.height * 0.35, canvas.width, canvas.height);
  p.fill();
  p.fillStyle = '#f2cc8f';
  p.beginPath();
  p.arc(canvas.width * 0.72, canvas.height * 0.3, 7, 0, Math.PI * 2);
  p.fill();
  pic.tex.needsUpdate = true;
  const foot = box(g, 0.02, 0.1, 0.02, '#3b3330', 0, 0.05, -0.04);
  foot.rotation.x = 0.35;
}

// A notebook with a pen laid across it.
function notebook(parent, x, y, z) {
  const b = box(parent, 0.3, 0.035, 0.38, '#44506b', x, y + 0.018, z);
  b.rotation.y = 0.18;
  const pages = box(parent, 0.27, 0.02, 0.35, '#f6f2e8', x, y + 0.028, z + 0.01);
  pages.rotation.y = 0.18;
  const pen = cyl(parent, 0.009, 0.009, 0.24, '#e07a5f', x + 0.04, y + 0.045, z, 8);
  pen.rotation.set(0, 0.5, Math.PI / 2);
}

function buildDesk(scene, grid, x, z, index, turned = false) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  if (turned) g.rotation.y = Math.PI;

  // top: 2.5 x 1.15, surface at 0.83, with a darker lip so the edge catches
  const top = box(g, 2.5, 0.1, 1.15, null, 0, 0.78, 0, deskTopMaterial());
  top.receiveShadow = true;
  box(g, 2.54, 0.03, 1.19, C.woodDark, 0, 0.742, 0);

  // a steel T-frame, a tie beam between the legs, and a modesty panel
  for (const lx of [-1.08, 1.08]) {
    box(g, 0.09, 0.72, 0.16, C.metal, lx, 0.37, 0);
    box(g, 0.13, 0.06, 1.0, C.metal, lx, 0.03, 0);
    box(g, 0.13, 0.05, 0.86, C.metal, lx, 0.715, 0);
  }
  box(g, 1.95, 0.07, 0.08, C.metal, 0, 0.67, -0.18);
  box(g, 2.0, 0.3, 0.04, C.woodDark, 0, 0.57, -0.5);
  const tray = box(g, 1.3, 0.05, 0.12, '#2a2e38', 0, 0.5, -0.3);
  tray.castShadow = false;

  // drawer pedestal, handles and all
  box(g, 0.58, 0.62, 0.56, '#e6ded0', 0.78, 0.31, -0.2);
  for (const dy of [0.17, 0.45]) {
    box(g, 0.5, 0.24, 0.02, '#f1ebe0', 0.78, dy, 0.09);
    const pull = cyl(g, 0.013, 0.013, 0.16, '#8d94a3', 0.78, dy, 0.105, 8);
    pull.rotation.z = Math.PI / 2;
  }

  // monitor on an arm, clamped to the back edge and tilted down a touch
  box(g, 0.17, 0.07, 0.2, C.metal, 0, 0.87, -0.47);
  cyl(g, 0.03, 0.035, 0.52, C.metal, 0, 1.12, -0.47, 12);
  const upper = box(g, 0.055, 0.055, 0.32, C.metal, 0, 1.35, -0.38);
  upper.rotation.x = 0.3;
  box(g, 0.14, 0.14, 0.05, C.metal, 0, 1.42, -0.31);
  const main = flatPanel(g, 1.5, 0.84, 0, 1.46, -0.295);
  main.g.rotation.x = 0.05;
  const ledMat = new THREE.MeshBasicMaterial({ color: '#2a3442', toneMapped: false });
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.014, 12), ledMat);
  led.position.set(0.68, -0.47, 0.03);
  main.g.add(led);
  // a couple of stickies on the bezel, on some desks
  if (index % 3 === 1)
    [['#f6d365', -0.04, 0.09], ['#f3a6b2', -0.19, -0.06]].forEach(([c, sy, rot]) => {
      const note = box(main.g, 0.11, 0.11, 0.004, c, 0.8, sy, 0.02);
      note.rotation.z = rot;
      note.castShadow = false;
    });

  // second screen, angled in towards the chair
  const side = flatPanel(g, 0.6, 0.36, -0.99, 1.08, -0.02, 500);
  side.g.rotation.y = 0.62;
  box(side.g, 0.3, 0.03, 0.2, C.metal, 0, -0.25, 0);
  box(side.g, 0.06, 0.2, 0.06, C.metal, 0, -0.14, 0);

  // desk mat, keyboard, mouse
  const padM = box(g, 1.18, 0.008, 0.42, '#454d5e', 0, 0.834, 0.16);
  padM.castShadow = false;
  box(g, 0.8, 0.022, 0.27, '#e9e6e1', -0.02, 0.849, 0.15);
  const caps = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.23), new THREE.MeshStandardMaterial({ map: keycapTexture(), roughness: 0.7 }));
  caps.rotation.x = -Math.PI / 2;
  caps.position.set(-0.02, 0.861, 0.15);
  caps.receiveShadow = true;
  g.add(caps);
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), mat('#e9e6e1'));
  mouse.position.set(0.52, 0.843, 0.18);
  mouse.scale.set(1, 0.6, 1.45);
  mouse.castShadow = true;
  g.add(mouse);
  box(g, 0.012, 0.004, 0.05, '#9aa3b2', 0.52, 0.874, 0.15).castShadow = false;

  // mug, with a handle this time
  const mugColor = ['#e07a5f', '#3d7ea6', '#f2cc8f', '#81b29a'][index % 4];
  const mug = cyl(g, 0.07, 0.065, 0.16, mugColor, 0.66, 0.91, -0.08, 14);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI * 1.2), mat(mugColor));
  handle.position.set(0.73, 0.92, -0.08);
  handle.rotation.y = Math.PI / 2;
  handle.rotation.z = -0.3;
  g.add(handle);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.062, 14), mat('#4a3328', { roughness: 0.3 }));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.set(0.66, 0.985, -0.08);
  g.add(coffee);

  // Something personal on every desk, so no two look the same.
  [() => deskLamp(g, 0.98, 0.83, -0.38),
   () => succulent(g, 1.0, 0.83, -0.3),
   () => bookStack(g, 0.98, 0.83, -0.32),
   () => headphones(g, 1.0, 0.83, -0.3),
   () => duck(g, 1.0, 0.83, -0.28),
   () => photoFrame(g, 1.0, 0.83, -0.3, index)][index % 6]();
  if (index % 4 === 2) notebook(g, -0.55, 0.835, -0.18);

  // the nameplate, on the front edge where the room can read it
  const plateG = new THREE.Group();
  plateG.position.set(0.86, 0.835, 0.44);
  g.add(plateG);
  box(plateG, 0.46, 0.022, 0.1, '#2f343f', 0, 0.011, 0);
  const plate = canvasPlane(plateG, 0.42, 0.11, 256, 67);
  plate.mesh.position.set(0, 0.07, 0.015);
  plate.mesh.rotation.x = -0.42;
  plate.mesh.material = new THREE.MeshStandardMaterial({ map: plate.tex, roughness: 0.75 });

  const chair = deskChair(C.chair);
  chair.position.set(0, 0, 1.05);
  g.add(chair);

  scene.add(g);
  if (turned) grid.block(x - 1.3, x + 1.3, z - 0.5, z + 0.7);
  else grid.block(x - 1.3, x + 1.3, z - 0.7, z + 0.5);
  // `face` is which way someone sitting there looks: at the screen.
  const desk = { index, x, z, group: g, face: turned ? 0 : Math.PI, seat: new THREE.Vector3(x, 0, z + (turned ? -1.05 : 1.05)), seatY: SEAT, screen: main.face, side: side.face, plate, led: ledMat, chair };
  dressDesk(desk, {});
  return desk;
}

// ---------- seating ----------
//
// Every seat in the office is built to the same height, SEAT, and every
// sit-down spot carries that height with it, so the figures rest on top of
// the cushion instead of sinking through it.

// A swivel chair, seat facing +z: mesh back, headrest, padded arms, casters.
function deskChair(color) {
  const chair = new THREE.Group();
  const pad = mat('#3c4250', { roughness: 0.9 });
  box(chair, 0.6, 0.07, 0.58, color, 0, SEAT - 0.035, 0);
  const cushion = box(chair, 0.56, 0.05, 0.54, null, 0, SEAT + 0.01, 0.01, pad);
  cushion.castShadow = false;

  // The back leans away from the desk, in one piece so it tilts together.
  const back = new THREE.Group();
  back.position.set(0, SEAT, 0.3);
  back.rotation.x = 0.12;
  chair.add(back);
  box(back, 0.56, 0.3, 0.09, color, 0, 0.19, 0);
  box(back, 0.52, 0.34, 0.05, null, 0, 0.52, 0.005, pad);
  for (const sx of [-0.25, 0.25]) box(back, 0.05, 0.36, 0.06, color, sx, 0.52, 0);
  box(back, 0.34, 0.13, 0.06, color, 0, 0.79, -0.01);

  for (const ax of [-0.33, 0.33]) {
    box(chair, 0.05, 0.22, 0.4, color, ax, SEAT + 0.09, 0.06);
    const rest = box(chair, 0.09, 0.05, 0.44, null, ax, SEAT + 0.21, 0.04, pad);
    rest.castShadow = false;
  }

  cyl(chair, 0.055, 0.055, 0.18, '#6e7684', 0, SEAT - 0.14, 0, 12);
  cyl(chair, 0.042, 0.042, SEAT - 0.22, C.metal, 0, (SEAT - 0.22) / 2 + 0.06, 0, 10);
  cyl(chair, 0.11, 0.13, 0.05, C.metal, 0, 0.08, 0, 14);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const foot = box(chair, 0.07, 0.045, 0.3, C.metal, 0, 0.075, 0);
    foot.position.set(Math.sin(a) * 0.17, 0.075, Math.cos(a) * 0.17);
    foot.rotation.y = a;
    const caster = cyl(chair, 0.035, 0.035, 0.025, '#22262e', Math.sin(a) * 0.31, 0.04, Math.cos(a) * 0.31, 10);
    caster.rotation.z = Math.PI / 2;
    caster.rotation.y = a;
  }
  return chair;
}

// A soft single seat, facing +z. Same cushion height as the couch.
function armchair(scene, grid, x, z, rotY) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  box(g, 1.35, SEAT - 0.14, 1.2, C.couch, 0, (SEAT - 0.14) / 2, 0);
  box(g, 1.15, 0.14, 1.0, '#6c8fb6', 0, SEAT - 0.07, 0.05);
  box(g, 1.35, 0.78, 0.26, C.couch, 0, SEAT + 0.25, -0.47);
  for (const ax of [-0.54, 0.54]) box(g, 0.27, 0.56, 1.2, C.couch, ax, SEAT - 0.06, 0);
  for (const [lx, lz] of [[-0.55, -0.5], [0.55, -0.5], [-0.55, 0.5], [0.55, 0.5]]) cyl(g, 0.05, 0.04, 0.12, C.woodDark, lx, 0.06, lz, 8);
  scene.add(g);
  const half = 0.75;
  grid.block(x - half, x + half, z - half, z + half);
  return g;
}

// A round stool for the communal table.
function stool(parent, x, z, color) {
  cyl(parent, 0.26, 0.26, 0.08, color, x, SEAT - 0.04, z, 20);
  cyl(parent, 0.035, 0.035, SEAT - 0.09, C.metal, x, (SEAT - 0.09) / 2, z, 8);
  cyl(parent, 0.2, 0.22, 0.03, C.metal, x, 0.015, z, 16);
}

// Everything on a screen is laid out against a 512-wide reference, so the
// canvas can get sharper without the type changing size.
export function drawScreen(desk, { title = '', subtitle = '', lines = [], accent = '#7bd389', idle = false, t = 0 }) {
  const { ctx, canvas, tex } = desk.screen;
  const W = canvas.width, H = canvas.height, u = W / 512;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#141c26');
  grad.addColorStop(1, '#0d131b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  if (idle) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2f3a49';
    ctx.font = `600 ${34 * u}px ${FONT}`;
    ctx.fillText(title, W / 2, H / 2 + 4 * u);
    ctx.fillStyle = '#263040';
    ctx.font = `400 ${20 * u}px ${FONT}`;
    ctx.fillText(subtitle, W / 2, H / 2 + 36 * u);
    ctx.textAlign = 'left';
    tex.needsUpdate = true;
    return;
  }
  // title bar: accent rule, a live dot, the repo and what it's doing
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 5 * u);
  ctx.globalAlpha = 0.09;
  ctx.fillRect(0, 5 * u, W, 76 * u);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(30 * u, 40 * u, 6 * u, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 3);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#eaeff5';
  ctx.font = `650 ${26 * u}px ${FONT}`;
  ctx.fillText(title, 46 * u, 48 * u);
  ctx.fillStyle = '#7d8a9c';
  ctx.font = `400 ${18 * u}px ${FONT}`;
  ctx.fillText(subtitle, 46 * u, 73 * u);

  // the log, newest line brightest, with a gutter rule down the left
  ctx.fillStyle = 'rgba(125, 138, 156, 0.22)';
  ctx.fillRect(24 * u, 92 * u, 1.5 * u, H - 104 * u);
  ctx.font = `400 ${18 * u}px ${MONO}`;
  const shown = lines.slice(-8);
  shown.forEach((l, i) => {
    const fresh = i === shown.length - 1;
    const y = 116 * u + i * 23 * u;
    ctx.globalAlpha = fresh ? 1 : 0.45 + i * 0.06;
    ctx.fillStyle = l.color || (fresh ? '#eaeff5' : '#8b98aa');
    let text = l.text;
    while (ctx.measureText(text).width > W - 56 * u && text.length > 4) text = text.slice(0, -2);
    if (text !== l.text) text = text.slice(0, -1) + '…';
    ctx.fillText(text, 38 * u, y);
    ctx.globalAlpha = 1;
  });
  if (Math.floor(t * 2) % 2 === 0) {
    ctx.fillStyle = accent;
    ctx.fillRect(38 * u, 116 * u + shown.length * 23 * u - 14 * u, 9 * u, 17 * u);
  }
  tex.needsUpdate = true;
}

// The nameplate, the second screen and the monitor's status light all say who
// is sitting here, so they're drawn together whenever a desk changes hands.
export function dressDesk(desk, { name = '', accent = '#7d8a9c', state = 'open' } = {}) {
  const live = state === 'working';
  if (desk.led) desk.led.color.set(live ? accent : state === 'open' ? '#232a35' : '#39455a');

  const p = desk.plate;
  if (p) {
    const { ctx: g, canvas: c, tex } = p;
    g.fillStyle = '#2c323d';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = state === 'open' ? '#454c5a' : accent;
    g.fillRect(0, 0, 9, c.height);
    g.fillStyle = state === 'open' ? '#8d97a6' : '#f3f1ed';
    g.font = `650 30px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillText(name, 26, c.height / 2 + 1);
    g.textBaseline = 'alphabetic';
    tex.needsUpdate = true;
  }

  const s = desk.side;
  if (s) {
    const { ctx: g, canvas: c, tex } = s;
    const W = c.width, H = c.height;
    g.fillStyle = state === 'open' ? '#0b0f15' : '#121a24';
    g.fillRect(0, 0, W, H);
    if (state === 'open') {
      g.fillStyle = '#1b2430';
      g.beginPath();
      g.arc(W / 2, H / 2, 5, 0, Math.PI * 2);
      g.fill();
      tex.needsUpdate = true;
      return;
    }
    g.fillStyle = accent;
    g.globalAlpha = 0.85;
    g.fillRect(0, 0, W, 4);
    g.globalAlpha = 1;
    g.font = `600 ${Math.round(H * 0.1)}px ${FONT}`;
    g.fillStyle = '#6f7d8f';
    g.fillText(name.toUpperCase(), 14, 26);
    g.textAlign = 'right';
    g.fillStyle = live ? accent : '#4d5a6b';
    g.fillText(live ? 'ACTIVE' : state === 'away' ? 'OFFLINE' : 'IDLE', W - 14, 26);
    g.textAlign = 'left';
    // a quiet little activity read-out, steady per person
    let h = 0;
    for (const ch of name + state) h = (h * 31 + ch.charCodeAt(0)) % 9973;
    for (let r = 0; r < 6; r++) {
      const y = 44 + r * Math.round((H - 58) / 6);
      const bh = Math.max(4, Math.round(H * 0.045));
      g.fillStyle = '#1b2531';
      g.fillRect(14, y, W - 28, bh);
      h = (h * 31 + 17) % 9973;
      const frac = live ? 0.25 + (h % 70) / 100 : 0.08 + (h % 25) / 100;
      g.fillStyle = r === 0 && live ? accent : '#35445a';
      g.fillRect(14, y, Math.round((W - 28) * frac), bh);
    }
    tex.needsUpdate = true;
  }
}

// ---------- the room ----------

export function buildOffice(scene, layoutId) {
  const L = layoutOf(layoutId);
  POOL.x = L.pool[0];
  POOL.z = L.pool[1];
  const [TX, TZ] = L.table;
  const grid = new Grid(W, D, FLOOR.x0, FLOOR.z0);
  const blinkers = [];

  // The office sits on a thick wooden slab, like a model on a table.
  const edge = mat('#a97a50');
  const top = new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.7 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.7, D + 0.6), [edge, edge, top, edge, edge, edge]);
  slab.position.set(FLOOR.cx, -0.35, 0);
  slab.receiveShadow = true;
  slab.castShadow = true;
  scene.add(slab);
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.ShadowMaterial({ opacity: 0.14 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = -0.72;
  catcher.receiveShadow = true;
  scene.add(catcher);
  const shade = contactShadow(W + 16, D + 16);
  shade.position.x = FLOOR.cx;
  scene.add(shade);
  const carpet = box(scene, 24.5, 0.02, 12.6, null, 0, 0.011, 1.2, new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 1 }));
  carpet.castShadow = false;
  carpet.visible = !L.rug;

  // Four walls. The ones between the camera and the room drop to a stub so
  // you can always see in, whichever way you turn.
  // The south wall turns round, so its local x runs west: the door's gap
  // sits at -(DOOR_X - cx).
  const doorL = -(DOOR_X - FLOOR.cx);
  const walls = [
    buildWall(scene, W + 0.6, FLOOR.cx, FLOOR.z0 - 0.15, 0, [0, 0, -1]),
    buildWall(scene, W + 0.6, FLOOR.cx, FLOOR.z1 + 0.15, Math.PI, [0, 0, 1], [[-W / 2 - 0.3, doorL - 1.2], [doorL + 1.2, W / 2 + 0.3]]),
    buildWall(scene, D, FLOOR.x0 - 0.15, 0, Math.PI / 2, [-1, 0, 0]),
    buildWall(scene, D, FLOOR.x1 + 0.15, 0, -Math.PI / 2, [1, 0, 0]),
  ];
  const [north, , west, east] = walls;
  // Things on the north wall are placed in world x; the wall is centred on cx.
  const nx = (x) => x - FLOOR.cx;
  grid.block(FLOOR.x0, FLOOR.x1, FLOOR.z0, FLOOR.z0 + 0.2);
  grid.block(FLOOR.x0, FLOOR.x0 + 0.2, FLOOR.z0, FLOOR.z1);

  // Windows on the west wall (local x runs along -z there).
  for (const wz of [-6, 0, 6]) {
    const lx = -wz;
    west.attach.push(
      box(west.g, 3.6, 2.2, 0.06, C.glass, lx, 2.2, 0.15, { emissive: '#bfe3f5', emissiveIntensity: 0.45, roughness: 0.15 }),
      box(west.g, 3.8, 0.12, 0.14, C.trim, lx, 1.08, 0.2),
      box(west.g, 3.8, 0.12, 0.14, C.trim, lx, 3.32, 0.2),
      box(west.g, 0.1, 2.3, 0.14, C.trim, lx, 2.2, 0.2),
    );
  }

  for (const wz of [-6, 0, 6]) sunPatch(scene, -17.4, wz, 5, 3.6);

  // desks
  const desks = [];
  L.desks.forEach(([x, z, turned], i) => desks.push(buildDesk(scene, grid, x, z, i, turned)));
  if (L.rug) {
    const [rx, rz, rw, rd, rc] = L.rug;
    box(scene, rw, 0.02, rd, rc, rx, 0.012, rz, { roughness: 1 }).castShadow = false;
  }

  // library — read, grep, glob
  const bookColors = ['#e07a5f', '#3d7ea6', '#f2cc8f', '#81b29a', '#9c6ade', '#e5989b', '#2a9d8f', '#577590'];
  for (const sx of [-18.4, -16.2, -14, -11.8]) {
    box(scene, 2, 3.2, 0.7, C.woodDark, sx, 1.6, -14.5);
    for (let shelf = 0; shelf < 4; shelf++) {
      const y = 0.45 + shelf * 0.75;
      box(scene, 1.86, 0.05, 0.62, C.wood, sx, y - 0.04, -14.42);
      let bx = sx - 0.85;
      while (bx < sx + 0.8) {
        const bw = 0.1 + Math.random() * 0.1, bh = 0.4 + Math.random() * 0.22;
        box(scene, bw, bh, 0.45, bookColors[Math.floor(Math.random() * bookColors.length)], bx + bw / 2, y + bh / 2, -14.4);
        bx += bw + 0.02;
      }
    }
  }
  grid.block(-19.6, -10.7, -15, -14);

  // server room — bash
  for (const rx of [12, 13.4, 14.8, 16.2, 17.6]) {
    box(scene, 1.2, 2.7, 1, C.rack, rx, 1.35, -14.4);
    for (let k = 0; k < 9; k++) {
      const led = box(scene, 0.07, 0.07, 0.03, '#000', rx - 0.4 + (k % 3) * 0.12, 0.5 + Math.floor(k / 3) * 0.7 + Math.random() * 0.2, -13.88,
        new THREE.MeshStandardMaterial({ color: '#0a0a0a', emissive: ['#4ade80', '#60a5fa', '#fbbf24'][k % 3], emissiveIntensity: 1.2 }));
      led.castShadow = false;
      blinkers.push(led);
    }
    for (let k = 0; k < 6; k++) box(scene, 1.0, 0.02, 0.02, '#4b5261', rx, 0.35 + k * 0.42, -13.89);
  }
  grid.block(11.2, 18.4, -15, -13.7);

  // research window — web
  const globe = new THREE.Group();
  globe.position.set(-18.6, 0, 0);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.9, 16), mat(C.woodDark));
  stand.position.y = 0.45;
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), mat('#4f8fc0', { roughness: 0.5 }));
  sphere.position.y = 1.35;
  const land = new THREE.Mesh(new THREE.IcosahedronGeometry(0.46, 1), mat('#7fb069', { flatShading: true, transparent: true, opacity: 0.85 }));
  land.position.y = 1.35;
  land.scale.set(1, 0.9, 0.7);
  for (const m of [stand, sphere, land]) { m.castShadow = true; globe.add(m); }
  scene.add(globe);
  grid.block(-19.2, -18, -0.6, 0.6);

  // whiteboard — planning
  const wb = new THREE.Group();
  wb.position.set(15.6, 0, -8);
  box(wb, 5, 2.4, 0.08, C.board, 0, 1.9, 0, { roughness: 0.4 });
  box(wb, 5.2, 0.1, 0.14, C.metal, 0, 0.66, 0.02);
  box(wb, 0.08, 1.9, 0.08, C.metal, -2.3, 0.6, 0);
  box(wb, 0.08, 1.9, 0.08, C.metal, 2.3, 0.6, 0);
  const scribble = canvasPlane(wb, 4.8, 2.2, 640, 290);
  scribble.mesh.position.set(0, 1.9, 0.045);
  scene.add(wb);
  grid.block(13, 18.2, -8.4, -7.6);

  // lounge
  const rug = box(scene, 9, 0.02, 5.4, C.rug, -14, 0.01, 10.6);
  rug.castShadow = false;
  const couch = new THREE.Group();
  couch.position.set(-14.5, 0, 8.4);
  box(couch, 5, SEAT - 0.14, 1.2, C.couch, 0, (SEAT - 0.14) / 2, 0);
  box(couch, 5, 0.8, 0.3, C.couch, 0, SEAT + 0.26, -0.48);
  for (const ax of [-2.35, 2.35]) box(couch, 0.3, 0.6, 1.2, C.couch, ax, SEAT - 0.08, 0);
  for (const cx of [-1.5, 0, 1.5]) box(couch, 1.4, 0.14, 1.0, '#6c8fb6', cx, SEAT - 0.07, 0.05);
  for (const [lx, lz] of [[-2.2, -0.5], [2.2, -0.5], [-2.2, 0.5], [2.2, 0.5]]) cyl(couch, 0.05, 0.04, 0.12, C.woodDark, lx, 0.06, lz, 8);
  scene.add(couch);
  grid.block(-17, -12, 7.8, 9);

  // Two armchairs turn the couch into somewhere a few people can sit together.
  armchair(scene, grid, -17.3, 10.9, Math.PI / 2);
  armchair(scene, grid, -12, 10.9, -Math.PI / 2);
  box(scene, 2.4, 0.08, 1.2, C.wood, -14.5, 0.48, 10.6);
  for (const [lx, lz] of [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]]) box(scene, 0.06, 0.44, 0.06, C.metal, -14.5 + lx, 0.22, 10.6 + lz);
  grid.block(-15.8, -13.2, 10, 11.2);

  box(scene, 1.3, 0.95, 3.2, '#efe9df', -19.3, 0.475, 12);
  box(scene, 0.55, 0.65, 0.5, '#2c2f36', -19.35, 1.28, 11.4);
  box(scene, 0.12, 0.08, 0.12, '#c0392b', -19.05, 1.4, 11.4, { emissive: '#c0392b', emissiveIntensity: 0.6 });
  for (let k = 0; k < 3; k++) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.14, 10), mat('#ffffff'));
    cup.position.set(-19.2, 1.02, 12.5 + k * 0.25);
    scene.add(cup);
  }
  grid.block(-20, -18.6, 10.4, 13.6);

  // break room: a tall table to stand around with a coffee
  const bistro = new THREE.Group();
  bistro.position.set(-11, 0, 12);
  cyl(bistro, 0.3, 0.34, 0.04, C.metal, 0, 0.02, 0, 20);
  cyl(bistro, 0.04, 0.04, 1.05, C.metal, 0, 0.55, 0, 10);
  cyl(bistro, 0.48, 0.48, 0.05, C.wood, 0, 1.08, 0, 28);
  for (const [cx, cz, color] of [[-0.18, 0.08, '#e07a5f'], [0.2, -0.1, '#3d7ea6']]) cyl(bistro, 0.06, 0.05, 0.13, color, cx, 1.17, cz, 12);
  scene.add(bistro);
  grid.block(-11.5, -10.5, 11.5, 12.5);

  // kanban wall
  north.attach.push(box(north.g, 9.4, 3.5, 0.08, '#d9cdbb', nx(0), 2.2, 0.2));
  const board = canvasPlane(north.g, 9, 3.2, 1536, 546);
  board.mesh.position.set(nx(0), 2.2, 0.26);
  north.attach.push(board.mesh);

  // reception — the chief of staff
  const reception = new THREE.Group();
  reception.position.set(23.4, 0, 12.4);
  box(reception, 3.4, 1.05, 0.9, '#efe9df', 0, 0.525, 0);
  box(reception, 3.5, 0.06, 1.0, C.wood, 0, 1.08, 0);
  box(reception, 0.9, 0.55, 0.05, C.metal, -0.8, 1.4, -0.25);
  const sign = canvasPlane(reception, 1.6, 0.34, 400, 85);
  sign.mesh.position.set(0, 0.62, 0.456);
  sign.ctx.fillStyle = '#efe9df';
  sign.ctx.fillRect(0, 0, 400, 85);
  sign.ctx.fillStyle = '#1d1b18';
  sign.ctx.font = `650 38px ${FONT}`;
  sign.ctx.textAlign = 'center';
  sign.ctx.fillText('Chief of Staff', 200, 56);
  sign.tex.needsUpdate = true;
  const deskSeat = deskChair(C.chair);
  deskSeat.position.set(0, 0, -1.0);
  deskSeat.rotation.y = Math.PI;
  reception.add(deskSeat);
  scene.add(reception);
  grid.block(21.6, 25.2, 11.9, 12.9);

  // entrance
  const mat0 = box(scene, 2.4, 0.02, 1.6, '#b9a58f', DOOR_X, 0.01, 14);
  mat0.castShadow = false;

  // wall art and a clock — they fold away with their wall
  // The Forbes list, framed between the library and the kanban (drawForbes).
  north.attach.push(box(north.g, 5.6, 3.3, 0.06, '#2b2620', nx(-7.75), 2.25, 0.18));
  const forbes = canvasPlane(north.g, 5.4, 3.1, 1170, 672);
  forbes.mesh.position.set(nx(-7.75), 2.25, 0.22);
  north.attach.push(forbes.mesh);
  wallClock(north, nx(7.6), 2.7);
  framedArt(east, 1.4, 2.4, 1.0, 1.4, ART.arcs);
  framedArt(east, 3.0, 2.4, 1.0, 1.4, ART.blocks);
  framedArt(east, 4.6, 2.4, 1.0, 1.4, ART.leaf);
  framedArt(west, 11, 2.5, 1.2, 0.9, ART.blocks, '#c39a6b');

  // east credenza under the prints
  const cred = new THREE.Group();
  cred.position.set(19.35, 0, 3);
  box(cred, 0.7, 0.75, 3.6, C.woodDark, 0, 0.4, 0);
  box(cred, 0.76, 0.05, 3.7, C.wood, 0, 0.8, 0);
  for (const cz of [-1.2, 0, 1.2]) box(cred, 0.02, 0.6, 1.1, '#9a7350', -0.36, 0.4, cz);
  for (const [lz] of [[-1.7], [1.7]]) box(cred, 0.6, 0.06, 0.06, C.metal, 0, 0.03, lz);
  bookStack(cred, 0, 0.82, -1.1, 4);
  succulent(cred, 0, 0.82, 0.2);
  cyl(cred, 0.11, 0.08, 0.38, '#3d7ea6', 0.05, 1.01, 1.2, 14, { roughness: 0.35 });
  for (let k = 0; k < 3; k++) {
    const stem = cyl(cred, 0.008, 0.008, 0.5, '#5f8f6b', 0.05 + (k - 1) * 0.04, 1.4, 1.2, 4);
    stem.rotation.z = (k - 1) * 0.3;
    const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), mat(['#f2cc8f', '#e5989b', '#fff'][k], { flatShading: true }));
    bloom.position.set(0.05 + (k - 1) * 0.12, 1.64, 1.2);
    cred.add(bloom);
  }
  scene.add(cred);
  grid.block(18.9, 20, 1.1, 4.9);

  // communal table on the open floor by the front wall
  const table = new THREE.Group();
  table.position.set(TX, 0, TZ);
  box(table, 5.2, 0.08, 1.4, C.wood, 0, 0.78, 0);
  for (const lx of [-2.3, 2.3]) {
    box(table, 0.08, 0.74, 1.1, C.metal, lx, 0.38, 0);
  }
  for (const sx of [-1.7, 0, 1.7]) {
    for (const sz of [-1.05, 1.05]) stool(table, sx, sz, ['#e07a5f', '#f2cc8f', '#81b29a'][Math.round(sx + 2) % 3]);
  }
  bookStack(table, -1.4, 0.82, 0.1, 2);
  cyl(table, 0.06, 0.06, 0.14, '#ffffff', 0.5, 0.89, -0.2, 12);
  const laptop = new THREE.Group();
  laptop.position.set(1.3, 0.82, 0.1);
  box(laptop, 0.5, 0.025, 0.35, '#c7ccd4', 0, 0.012, 0);
  const lid = box(laptop, 0.5, 0.34, 0.02, '#c7ccd4', 0, 0.17, -0.17);
  lid.rotation.x = -0.25;
  table.add(laptop);
  for (const px of [-1.6, 1.6]) {
    cyl(table, 0.02, 0.02, 1.6, '#2f3440', px, 3.4, 0, 6);
    const shade = cyl(table, 0.06, 0.32, 0.28, '#2f3440', px, 2.55, 0, 20, { roughness: 0.5 });
    shade.castShadow = false;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.29, 20), new THREE.MeshBasicMaterial({ color: '#fff1c4' }));
    glow.rotation.x = Math.PI / 2;
    glow.position.set(px, 2.405, 0);
    table.add(glow);
  }
  scene.add(table);
  grid.block(TX - 2.8, TX + 2.8, TZ - 1.3, TZ + 1.3);

  // pool table on the open floor beside the lobby. Table space is the sim's
  // (cloth middle at the origin, long side along x), so the balls can be
  // placed straight from it.
  const pool = new THREE.Group();
  pool.position.set(POOL.x, 0, POOL.z);
  const FELT = 0.84;
  box(pool, 3.7, 0.22, 2.1, C.woodDark, 0, 0.71, 0);
  for (const [lx, lz] of [[-1.55, -0.85], [1.55, -0.85], [-1.55, 0.85], [1.55, 0.85]]) box(pool, 0.2, 0.62, 0.2, C.woodDark, lx, 0.31, lz);
  box(pool, 3.5, 0.03, 1.9, '#2f7a57', 0, FELT - 0.015, 0, { roughness: 1 });
  const rails = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) rails.push([1.32, 0.1, 0.25, sx * 0.82, sz * 0.925]);
    rails.push([0.25, 0.1, 1.36, sx * 1.725, 0]);
  }
  for (const [w, h, d, x, z] of rails) box(pool, w, h, d, C.wood, x, FELT + 0.05, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(pool, 0.3, 0.1, 0.3, C.wood, sx * 1.83, FELT + 0.05, sz * 0.98);
  for (const [w, d, x, z] of [[1.28, 0.06, 0.82, 0.83], [1.28, 0.06, 0.82, -0.83], [1.28, 0.06, -0.82, 0.83], [1.28, 0.06, -0.82, -0.83]]) {
    box(pool, w, 0.05, d, '#256646', x, FELT + 0.025, z).castShadow = false;
  }
  for (const sx of [-1, 1]) box(pool, 0.06, 0.05, 1.3, '#256646', sx * 1.57, FELT + 0.025, 0).castShadow = false;
  const hole = new THREE.MeshBasicMaterial({ color: '#0c0d10' });
  for (const [hx, hz] of [[-1.6, -0.8], [1.6, -0.8], [-1.6, 0.8], [1.6, 0.8], [0, -0.835], [0, 0.835]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 20), hole);
    m.position.set(hx, FELT + 0.002, hz);
    pool.add(m);
  }
  scene.add(pool);
  grid.block(POOL.x - 1.95, POOL.x + 1.95, POOL.z - 1.15, POOL.z + 1.15);

  // lounge floor lamp
  const lamp = new THREE.Group();
  lamp.position.set(-18, 0, 8.2);
  cyl(lamp, 0.22, 0.24, 0.04, '#2f3440', 0, 0.02, 0, 20);
  cyl(lamp, 0.025, 0.025, 1.7, '#2f3440', 0, 0.87, 0, 8);
  const lshade = cyl(lamp, 0.22, 0.3, 0.38, '#f3e7d3', 0, 1.85, 0, 24, { emissive: '#ffe2a8', emissiveIntensity: 0.35, roughness: 0.9 });
  lshade.castShadow = false;
  scene.add(lamp);
  grid.block(-18.4, -17.6, 7.8, 8.6);

  // rug by reception, so the entrance feels like a lobby
  const lobby = box(scene, 6.4, 0.02, 3.2, '#c9b79c', 25.4, 0.012, 12.9, { roughness: 1 });
  lobby.castShadow = false;
  const lobbyBorder = box(scene, 6, 0.022, 2.8, '#ddd0bb', 25.4, 0.013, 12.9, { roughness: 1 });
  lobbyBorder.castShadow = false;

  const wing = guestWing(scene, grid, north, east, nx);

  const plants = [[-19, -9.5, 1.1, 'tall'], [10, -14, 1, 'snake'], [-9.8, -14.2, 0.9, 'bush'], [19, -11, 1.2, 'tall'], [-10.3, 14, 1, 'bush'], [6.2, 13.8, 1.1, 'tall'], [19, 8.5, 1, 'snake'], [19.2, 0, 0.9, 'bush'], [-19.1, 14.2, 0.8, 'snake'], [11.6, 13.9, 1, 'bush']];
  for (const [x, z, s, kind] of plants) if (!grid.blocked(...grid.cellOf(x, z))) plant(scene, grid, x, z, s, kind);

  // Open floor for whatever the office buys, facing the middle of the room.
  // Anything that ended up under furniture is dropped.
  const decorSlots = L.slots.filter(([x, z]) => !grid.blocked(...grid.cellOf(x, z)))
    .map(([x, z]) => ({ x, z, face: Math.atan2(0 - x, 1 - z) }));
  const setFinish = ({ floor, wall } = {}) => {
    top.color.set(FLOOR_TINT[floor] || '#ffffff');
    wallMat.color.set(WALL_PAINT[wall] || C.wall);
  };

  const face = { n: Math.PI, s: 0, w: -Math.PI / 2, e: Math.PI / 2 };
  // A spot is a place to be: where to stand, which way to look, what to do
  // there, and — for anything with a seat — how high that seat is.
  const spots = (list) => list.map(([x, z, f, pose, seatY]) => ({ pos: new THREE.Vector3(x, 0, z), face: face[f], pose, seatY, taken: null }));
  const stations = {
    library: { label: 'Library', spots: spots([[-17.6, -12.9, 'n', 'read'], [-15.3, -12.9, 'n', 'read'], [-13.1, -12.9, 'n', 'read'], [-11, -12.9, 'n', 'read']]) },
    servers: { label: 'Server room', spots: spots([[12.7, -12.6, 'n', 'type'], [14.1, -12.6, 'n', 'type'], [15.5, -12.6, 'n', 'type'], [16.9, -12.6, 'n', 'type']]) },
    window: { label: 'Research window', spots: spots([[-17.5, -6, 'w', 'gaze'], [-17.5, -2.6, 'w', 'gaze'], [-17.5, 2.6, 'w', 'gaze'], [-17.5, 6, 'w', 'gaze']]) },
    whiteboard: { label: 'Whiteboard', spots: spots([[13.9, -6.4, 'n', 'write'], [15.2, -6.4, 'n', 'write'], [16.5, -6.4, 'n', 'write'], [17.8, -6.4, 'n', 'write']]) },
    // Enough seats for a full office: three on the couch, two armchairs and
    // six places at the communal table, with the coffee machine and the
    // standing table for anyone who'd rather be on their feet.
    lounge: {
      label: 'Break room',
      spots: spots([
        [-16, 8.5, 's', 'couch', SEAT], [-14.5, 8.5, 's', 'couch', SEAT], [-13, 8.5, 's', 'couch', SEAT],
        [-17.2, 10.9, 'e', 'couch', SEAT], [-11.9, 10.9, 'w', 'couch', SEAT],
        ...[-1.7, 0, 1.7].flatMap((dx) => [[TX + dx, TZ - 1.05, 's', 'sit', SEAT], [TX + dx, TZ + 1.05, 'n', 'sit', SEAT]]),
        [-17.9, 11.4, 'w', 'mug'], [-17.9, 12.8, 'w', 'mug'],
        [-11.95, 12, 'e', 'mug'], [-10.05, 12, 'w', 'mug'],
      ]),
    },
  };

  // Standup: a ring on the open floor in front of the whiteboard, everyone
  // facing the middle. The chief takes the spot nearest the board.
  const huddle = new THREE.Vector3(15.3, 0, -2.4);
  const standup = Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI + (i / 10) * Math.PI * 2;
    const pos = new THREE.Vector3(huddle.x + Math.sin(a) * 2.3, 0, huddle.z + Math.cos(a) * 2.3);
    return { pos, face: Math.atan2(huddle.x - pos.x, huddle.z - pos.z) };
  });

  // Two places at the pool table. Nobody is sent to these by chance (see
  // resolve in agent.js); a game hands them out.
  stations.lounge.spots.push(
    { pos: new THREE.Vector3(POOL.x - 0.9, 0, POOL.z - 1.65), face: face.s, pose: 'stand', taken: null, game: true },
    { pos: new THREE.Vector3(POOL.x + 0.9, 0, POOL.z + 1.65), face: face.n, pose: 'stand', taken: null, game: true },
  );

  // Visitors from linked offices never take one of our desks. Working, they
  // sit at the guest benches in their wing. On a break they watch the pool
  // or have a coffee at the guest bar. In a meeting they gather at the guest
  // table. See guestWing.
  const toward = (x, z, cx, cz, pose) => ({ pos: new THREE.Vector3(x, 0, z), face: Math.atan2(cx - x, cz - z), pose, taken: null });
  stations.poolside = { label: 'Pool table', spots: [[-2.7, 0], [2.7, 0], [2, -2.1], [-2, -2.1]].map(([dx, dz]) => toward(POOL.x + dx, POOL.z + dz, POOL.x, POOL.z, 'mug')) };
  Object.assign(stations, wing.stations);

  const updateWalls = (camera, target, dt) => cutaway(walls, camera, target, dt);
  return { grid, desks, stations, pool, standup, board, forbes, scribble, blinkers, globe: land, slab, updateWalls, decorSlots, setFinish, layout: L, door: new THREE.Vector3(DOOR_X, 0, 14.4), reception: { seat: new THREE.Vector3(23.4, 0, 11.4), seatY: SEAT } };
}


// ---------- guest wing ----------

// Where visitors from linked offices spend their time, east of the glass:
// two benches of hot desks, a coffee bar with a sofa, and a standing table
// for their meetings. The door opens into it, so guests arrive in their own
// space and never queue for one of ours.
function guestWing(scene, grid, north, east, nx) {
  const toward = (x, z, cx, cz, pose, seatY) => ({ pos: new THREE.Vector3(x, 0, z), face: Math.atan2(cx - x, cz - z), pose, seatY, taken: null });
  const BX = 26.2; // the benches' middle

  // Glass between our floor and theirs, down to where the whiteboard stands.
  const glassMat = new THREE.MeshStandardMaterial({ color: C.glass, transparent: true, opacity: 0.28, roughness: 0.08, metalness: 0.1, depthWrite: false });
  const g0 = FLOOR.z0, g1 = -3.6;
  const pane = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.3, g1 - g0), glassMat);
  pane.position.set(WING, 1.25, (g0 + g1) / 2);
  scene.add(pane);
  box(scene, 0.1, 0.1, g1 - g0, C.metal, WING, 2.42, (g0 + g1) / 2);
  box(scene, 0.12, 0.1, g1 - g0, C.metal, WING, 0.05, (g0 + g1) / 2);
  for (let z = g0 + 0.2; z <= g1 + 0.01; z += (g1 - g0 - 0.2) / 4) box(scene, 0.08, 2.45, 0.08, C.metal, WING, 1.22, z);
  grid.block(WING - 0.15, WING + 0.15, g0, g1);

  // A sage rug marks the wing without a wall.
  box(scene, 10.4, 0.02, 10.8, '#c9d3c4', BX, 0.011, -8.6, { roughness: 1 }).castShadow = false;
  box(scene, 10, 0.022, 10.4, '#d6ddd1', BX, 0.012, -8.6, { roughness: 1 }).castShadow = false;

  // "Guest wing" over the benches, on the north wall so it folds away too.
  north.attach.push(box(north.g, 5.4, 1.5, 0.08, '#2f3440', nx(BX), 2.65, 0.2));
  const sign = canvasPlane(north.g, 5.2, 1.3, 800, 200);
  sign.mesh.position.set(nx(BX), 2.65, 0.25);
  sign.ctx.fillStyle = '#2f3440';
  sign.ctx.fillRect(0, 0, 800, 200);
  sign.ctx.textAlign = 'center';
  sign.ctx.fillStyle = '#f5f0e8';
  sign.ctx.font = `680 76px ${FONT}`;
  sign.ctx.fillText('Guest wing', 400, 104);
  sign.ctx.fillStyle = '#b9c7b4';
  sign.ctx.font = `500 30px ${FONT}`;
  sign.ctx.fillText('Visitors from linked offices work here', 400, 158);
  sign.tex.needsUpdate = true;
  north.attach.push(sign.mesh);

  // Two windows on the east wall (local x runs along +z there).
  for (const wz of [-10.4, -5.2]) {
    east.attach.push(
      box(east.g, 3.2, 2.2, 0.06, C.glass, wz, 2.2, 0.15, { emissive: '#bfe3f5', emissiveIntensity: 0.45, roughness: 0.15 }),
      box(east.g, 3.4, 0.12, 0.14, C.trim, wz, 1.08, 0.2),
      box(east.g, 3.4, 0.12, 0.14, C.trim, wz, 3.32, 0.2),
      box(east.g, 0.1, 2.3, 0.14, C.trim, wz, 2.2, 0.2),
    );
  }

  // Hot-desk benches: three seats a side, a laptop at each.
  const hotdesk = [];
  for (const bz of [-11, -6.2]) {
    const bench = new THREE.Group();
    bench.position.set(BX, 0, bz);
    box(bench, 6.2, 0.08, 1.2, C.wood, 0, 0.78, 0);
    box(bench, 6.24, 0.03, 1.24, C.woodDark, 0, 0.742, 0);
    for (const lx of [-2.8, 2.8]) box(bench, 0.08, 0.74, 1.0, C.metal, lx, 0.38, 0);
    box(bench, 5.5, 0.26, 0.04, C.woodDark, 0, 0.6, 0);
    for (const sx of [-2, 0, 2]) {
      for (const side of [-1, 1]) {
        stool(bench, sx, side * 1.05, ['#7c5cff', '#0e9f9a', '#d9488f', '#c98a12', '#3b82f6', '#65a30d'][(sx / 2 + 1) * 2 + (side + 1) / 2]);
        const laptop = new THREE.Group();
        laptop.position.set(sx, 0.82, side * 0.3);
        laptop.rotation.y = side > 0 ? 0 : Math.PI;
        box(laptop, 0.5, 0.025, 0.35, '#c7ccd4', 0, 0.012, 0);
        const lid = box(laptop, 0.5, 0.34, 0.02, '#c7ccd4', 0, 0.17, -0.17);
        lid.rotation.x = -0.25;
        bench.add(laptop);
        hotdesk.push(toward(BX + sx, bz + side * 1.05, BX + sx, bz, 'desk', SEAT));
      }
    }
    for (const px of [-2, 2]) {
      cyl(bench, 0.02, 0.02, 1.6, '#2f3440', px, 3.4, 0, 6);
      cyl(bench, 0.06, 0.32, 0.28, '#2f3440', px, 2.55, 0, 20, { roughness: 0.5 }).castShadow = false;
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.29, 20), new THREE.MeshBasicMaterial({ color: '#fff1c4' }));
      glow.rotation.x = Math.PI / 2;
      glow.position.set(px, 2.405, 0);
      bench.add(glow);
    }
    scene.add(bench);
    grid.block(BX - 3.1, BX + 3.1, bz - 0.6, bz + 0.6);
  }

  // A sofa for a sit-down break, with a low table in front.
  const sofa = new THREE.Group();
  sofa.position.set(24.4, 0, -2.2);
  const teal = '#3f8f8a', tealLight = '#5aa8a2';
  box(sofa, 4, SEAT - 0.14, 1.1, teal, 0, (SEAT - 0.14) / 2, 0);
  box(sofa, 4, 0.78, 0.28, teal, 0, SEAT + 0.25, -0.44);
  for (const ax of [-1.86, 1.86]) box(sofa, 0.28, 0.58, 1.1, teal, ax, SEAT - 0.07, 0);
  for (const cx of [-1.1, 0, 1.1]) box(sofa, 1.05, 0.14, 0.92, tealLight, cx, SEAT - 0.07, 0.05);
  for (const [lx, lz] of [[-1.8, -0.45], [1.8, -0.45], [-1.8, 0.45], [1.8, 0.45]]) cyl(sofa, 0.05, 0.04, 0.12, C.woodDark, lx, 0.06, lz, 8);
  scene.add(sofa);
  grid.block(22.3, 26.5, -2.8, -1.6);
  box(scene, 1.8, 0.06, 0.7, C.wood, 24.4, 0.4, -0.5);
  for (const [lx, lz] of [[-0.8, -0.28], [0.8, -0.28], [-0.8, 0.28], [0.8, 0.28]]) box(scene, 0.05, 0.38, 0.05, C.metal, 24.4 + lx, 0.19, -0.5 + lz);
  bookStack(scene, 24, 0.43, -0.5, 2);
  grid.block(23.4, 25.4, -0.9, -0.1);

  // Coffee bar against the east wall, under the prints.
  const bar = new THREE.Group();
  bar.position.set(31.35, 0, 3);
  box(bar, 1.0, 0.95, 3.6, '#efe9df', 0, 0.475, 0);
  box(bar, 1.06, 0.05, 3.7, C.wood, 0, 0.97, 0);
  box(bar, 0.55, 0.65, 0.5, '#2c2f36', 0.1, 1.32, -0.9);
  box(bar, 0.12, 0.08, 0.12, '#0e9f9a', -0.2, 1.44, -0.9, { emissive: '#0e9f9a', emissiveIntensity: 0.6 });
  for (let k = 0; k < 3; k++) cyl(bar, 0.07, 0.06, 0.14, '#ffffff', -0.1, 1.06, 0.1 + k * 0.28, 10);
  succulent(bar, 0, 0.99, 1.3);
  scene.add(bar);
  grid.block(30.8, FLOOR.x1, 1.1, 4.9);

  // A tall table to stand at with a cup.
  const bistro = new THREE.Group();
  bistro.position.set(27.6, 0, 3);
  cyl(bistro, 0.3, 0.34, 0.04, C.metal, 0, 0.02, 0, 20);
  cyl(bistro, 0.04, 0.04, 1.05, C.metal, 0, 0.55, 0, 10);
  cyl(bistro, 0.48, 0.48, 0.05, C.wood, 0, 1.08, 0, 28);
  cyl(bistro, 0.06, 0.05, 0.13, '#d9488f', 0.15, 1.17, 0.1, 12);
  scene.add(bistro);
  grid.block(27.1, 28.1, 2.5, 3.5);

  const coffee = [
    toward(30.2, 2, 31.35, 2, 'mug'), toward(30.2, 3, 31.35, 3, 'mug'), toward(30.2, 4, 31.35, 4, 'mug'),
    toward(26.65, 3, 27.6, 3, 'mug'), toward(28.55, 3, 27.6, 3, 'mug'),
    ...[23.2, 24.4, 25.6].map((x) => ({ pos: new THREE.Vector3(x, 0, -2.1), face: 0, pose: 'couch', seatY: SEAT, taken: null })),
  ];

  // Their meeting table: round, standing height, room for six.
  const MT = { x: 27.6, z: 8.4 };
  const meet = new THREE.Group();
  meet.position.set(MT.x, 0, MT.z);
  cyl(meet, 0.42, 0.48, 0.05, C.metal, 0, 0.025, 0, 24);
  cyl(meet, 0.07, 0.07, 1.02, C.metal, 0, 0.53, 0, 12);
  cyl(meet, 0.9, 0.9, 0.06, C.wood, 0, 1.06, 0, 36);
  notebook(meet, -0.2, 1.09, 0.1);
  scene.add(meet);
  grid.block(MT.x - 0.9, MT.x + 0.9, MT.z - 0.9, MT.z + 0.9);
  const huddle = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    return toward(MT.x + Math.sin(a) * 1.55, MT.z + Math.cos(a) * 1.55, MT.x, MT.z, 'stand');
  });

  for (const [x, z, sz, kind] of [[31.2, -14.2, 1.1, 'tall'], [21.1, -4.6, 0.9, 'bush'], [31.2, 13.8, 1, 'snake'], [31.3, -1.2, 0.9, 'bush'], [21.2, 6.2, 1, 'tall']]) plant(scene, grid, x, z, sz, kind);

  return {
    stations: {
      hotdesk: { label: 'Guest desks', spots: hotdesk },
      coffee: { label: 'Guest coffee', spots: coffee },
      huddle: { label: 'Guest table', spots: huddle },
    },
  };
}

// ---------- floor, walls, shadow ----------

function plankTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const rows = 16, h = c.height / rows;
  for (let r = 0; r < rows; r++) {
    let x = -Math.random() * 400;
    while (x < c.width) {
      const len = 380 + Math.random() * 520;
      const l = 73 + Math.random() * 3.5;
      g.fillStyle = `hsl(${32 + Math.random() * 3}, ${33 + Math.random() * 5}%, ${l}%)`;
      g.fillRect(x, r * h, len, h);
      g.globalAlpha = 0.045;
      for (let k = 0; k < 6; k++) {
        g.fillStyle = Math.random() < 0.5 ? '#7a5634' : '#fff6e8';
        g.fillRect(x, r * h + Math.random() * h, len, 1 + Math.random() * 2);
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(90, 60, 35, 0.22)';
      g.fillRect(x, r * h, 2, h);
      x += len;
    }
    g.fillStyle = 'rgba(90, 60, 35, 0.18)';
    g.fillRect(0, r * h, c.width, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(W / 8, D / 8);
  tex.anisotropy = 8;
  return tex;
}

function contactShadow(w, d) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  grad.addColorStop(0, 'rgba(60, 40, 20, 0.28)');
  grad.addColorStop(0.6, 'rgba(60, 40, 20, 0.12)');
  grad.addColorStop(1, 'rgba(60, 40, 20, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.715;
  return m;
}

const WALL_H = 4.2, STUB_H = 0.5;

// A wall runs along its local x; local +z faces into the room.
function buildWall(scene, len, x, z, rotY, outward, segments = [[-len / 2, len / 2]]) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  const body = new THREE.Group();
  const cap = new THREE.Group();
  g.add(body, cap);
  for (const [a, b] of segments) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, WALL_H, 0.3), wallMat);
    m.position.set((a + b) / 2, WALL_H / 2, 0);
    m.castShadow = m.receiveShadow = true;
    body.add(m);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(b - a, 0.1, 0.36), mat('#cbbba3'));
    trim.position.set((a + b) / 2, 0.05, 0);
    cap.add(trim);
    const skirting = new THREE.Mesh(new THREE.BoxGeometry(b - a, 0.22, 0.04), mat(C.trim));
    skirting.position.set((a + b) / 2, 0.11, 0.17);
    g.add(skirting);
  }
  scene.add(g);
  const wall = { g, body, cap, outward: new THREE.Vector3(...outward), h: WALL_H, attach: [] };
  cap.position.y = WALL_H;
  return wall;
}

const view = new THREE.Vector3();
function cutaway(walls, camera, target, dt) {
  view.subVectors(camera.position, target).setY(0).normalize();
  for (const w of walls) {
    const goal = w.outward.dot(view) > 0.2 ? STUB_H : WALL_H;
    w.h += (goal - w.h) * Math.min(1, dt * 7);
    w.body.scale.y = w.h / WALL_H;
    w.cap.position.y = w.h;
    for (const a of w.attach) a.visible = w.h > 3.4;
  }
}

// ---------- kanban + whiteboard drawing ----------

const STATUS_COL = { queued: 0, working: 1, done: 2, failed: 2, stopped: 2 };
const NOTE = { queued: '#fde68a', working: '#bfdbfe', done: '#bbf7d0', failed: '#fecaca', stopped: '#e5e7eb' };

export function drawBoard(board, jobs) {
  const { ctx, canvas, tex } = board;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, W, H);
  const cols = ['Queued', 'Working', 'Shipped'];
  const cw = W / 3;
  cols.forEach((name, c) => {
    ctx.fillStyle = '#1d1b18';
    ctx.font = `650 34px ${FONT}`;
    ctx.fillText(name, c * cw + 28, 54);
    if (c) { ctx.fillStyle = '#e7e1d7'; ctx.fillRect(c * cw, 20, 3, H - 40); }
    const items = jobs.filter((j) => STATUS_COL[j.status] === c).sort((a, b) => (b.endedAt || b.queuedAt) - (a.endedAt || a.queuedAt)).slice(0, 6);
    items.forEach((j, k) => {
      const x = c * cw + 28 + (k % 2) * (cw / 2 - 18);
      const y = 80 + Math.floor(k / 2) * 150;
      const w = cw / 2 - 36, h = 130;
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(((j.id.charCodeAt(0) % 7) - 3) * 0.008);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(-w / 2 + 4, -h / 2 + 6, w, h);
      ctx.fillStyle = NOTE[j.status];
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#1d1b18';
      ctx.font = `600 22px ${FONT}`;
      wrap(ctx, j.title, -w / 2 + 14, -h / 2 + 34, w - 28, 26, 3);
      ctx.fillStyle = '#5b554c';
      ctx.font = `400 18px ${FONT}`;
      ctx.fillText(j.repo.slice(0, 22), -w / 2 + 14, h / 2 - 14);
      ctx.restore();
    });
  });
  tex.needsUpdate = true;
}

function wrap(ctx, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(/\s+/);
  let line = '', n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      if (n === maxLines - 1) { ctx.fillText(line + '…', x, y + n * lh); return; }
      ctx.fillText(line, x, y + n * lh);
      line = words[i];
      n++;
    } else line = test;
  }
  ctx.fillText(line, x, y + n * lh);
}

// The Forbes list on the wall: the five richest agents by net worth.
// `rows` is [{ name, worth, shirt }], richest first.
export function drawForbes(board, rows) {
  const { ctx, canvas, tex } = board;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#f7f2e7';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1d1b18';
  ctx.fillRect(0, 0, W, 150);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f2c14e';
  ctx.font = `italic 700 84px Georgia, "Times New Roman", serif`;
  ctx.fillText('The Forbes List', 48, 100);
  ctx.fillStyle = '#cfc6b6';
  ctx.font = `500 28px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText('net worth', W - 48, 96);
  const top = rows.slice(0, 5);
  if (!top.some((r) => r.worth > 0)) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8a8172';
    ctx.font = `500 40px ${FONT}`;
    ctx.fillText('Nobody’s been paid yet.', W / 2, H / 2 + 60);
  }
  else top.forEach((r, i) => {
    const y = 150 + 22 + i * 100;
    if (i) { ctx.fillStyle = '#e4dccd'; ctx.fillRect(48, y - 20, W - 96, 2); }
    const mid = y + 44;
    ctx.textAlign = 'center';
    ctx.fillStyle = i === 0 ? '#c98f1c' : '#8a8172';
    ctx.font = `700 52px Georgia, serif`;
    ctx.fillText(String(i + 1), 92, mid + 18);
    ctx.fillStyle = r.shirt || '#999';
    ctx.beginPath(); ctx.arc(170, mid, 22, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1d1b18';
    ctx.font = `${i === 0 ? 700 : 600} 56px ${FONT}`;
    ctx.fillText(`${r.name}${i === 0 ? '  👑' : ''}`, 218, mid + 20);
    ctx.textAlign = 'right';
    ctx.fillStyle = i === 0 ? '#a8740f' : '#3a352e';
    ctx.font = `700 54px ${FONT}`;
    ctx.fillText(r.money, W - 48, mid + 20);
  });
  tex.needsUpdate = true;
}

export function drawWhiteboard(wb, items) {
  const { ctx, canvas, tex } = wb;
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#2f5d8a';
  ctx.font = `600 30px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
  ctx.fillText('Today', 26, 46);
  ctx.font = `400 24px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
  items.slice(0, 7).forEach((it, i) => {
    ctx.fillStyle = it.done ? '#6b8f71' : '#3a3a3a';
    const text = (it.done ? '✓ ' : '• ') + it.text;
    ctx.fillText(text.length > 44 ? text.slice(0, 43) + '…' : text, 30, 86 + i * 30);
  });
  tex.needsUpdate = true;
}
