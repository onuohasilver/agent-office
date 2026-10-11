import * as THREE from 'three';
import { Grid } from './nav.js';
import { SEAT } from './figure.js';

export const W = 40, D = 30;

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

function buildDesk(scene, grid, x, z, index) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  box(g, 2.5, 0.1, 1.15, C.wood, 0, 0.78, 0);
  for (const [lx, lz] of [[-1.15, -0.48], [1.15, -0.48], [-1.15, 0.48], [1.15, 0.48]]) box(g, 0.07, 0.76, 0.07, C.metal, lx, 0.38, lz);
  box(g, 0.12, 0.32, 0.12, C.metal, 0, 0.98, -0.3);
  box(g, 1.42, 0.86, 0.06, C.metal, 0, 1.45, -0.32);
  box(g, 0.75, 0.03, 0.26, '#e9e6e1', 0, 0.845, 0.15);
  box(g, 0.14, 0.03, 0.2, '#e9e6e1', 0.58, 0.845, 0.17);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 12), mat(['#e07a5f', '#3d7ea6', '#f2cc8f', '#81b29a'][index % 4]));
  mug.position.set(-0.9, 0.91, 0.1);
  g.add(mug);
  // Something personal on every desk.
  [() => deskLamp(g, 0.95, 0.83, -0.35), () => succulent(g, 0.95, 0.83, -0.2), () => bookStack(g, 0.9, 0.83, -0.22)][index % 3]();

  // chair
  const chair = deskChair(C.chair);
  chair.position.set(0, 0, 1.05);
  g.add(chair);

  const screen = canvasPlane(g, 1.3, 0.74, 512, 292);
  screen.mesh.position.set(0, 1.45, -0.285);

  scene.add(g);
  grid.block(x - 1.3, x + 1.3, z - 0.7, z + 0.5);
  return { index, x, z, seat: new THREE.Vector3(x, 0, z + 1.05), seatY: SEAT, screen, chair };
}

// ---------- seating ----------
//
// Every seat in the office is built to the same height, SEAT, and every
// sit-down spot carries that height with it, so the figures rest on top of
// the cushion instead of sinking through it.

// A swivel chair, seat facing +z.
function deskChair(color) {
  const chair = new THREE.Group();
  box(chair, 0.62, 0.08, 0.6, color, 0, SEAT - 0.04, 0);
  box(chair, 0.62, 0.58, 0.08, color, 0, SEAT + 0.29, 0.3);
  for (const ax of [-0.33, 0.33]) {
    box(chair, 0.05, 0.2, 0.42, color, ax, SEAT + 0.1, 0.04);
    box(chair, 0.07, 0.05, 0.46, '#5a5f6b', ax, SEAT + 0.2, 0.04);
  }
  cyl(chair, 0.05, 0.05, SEAT - 0.08, C.metal, 0, (SEAT - 0.08) / 2, 0, 10);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const foot = box(chair, 0.07, 0.04, 0.3, C.metal, Math.sin(a) * 0.14, 0.05, Math.cos(a) * 0.14);
    foot.rotation.y = a;
    foot.position.set(Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15);
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

export function drawScreen(desk, { title = '', subtitle = '', lines = [], accent = '#7bd389', idle = false, t = 0 }) {
  const { ctx, canvas, tex } = desk.screen;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#10161f';
  ctx.fillRect(0, 0, W, H);
  if (idle) {
    ctx.fillStyle = '#2a3442';
    ctx.font = `600 34px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, H / 2 + 4);
    ctx.font = `400 20px ${FONT}`;
    ctx.fillText(subtitle, W / 2, H / 2 + 36);
    ctx.textAlign = 'left';
    tex.needsUpdate = true;
    return;
  }
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 6);
  ctx.fillStyle = '#e8edf3';
  ctx.font = `650 26px ${FONT}`;
  ctx.fillText(title, 22, 44);
  ctx.fillStyle = '#7d8a9c';
  ctx.font = `400 18px ${FONT}`;
  ctx.fillText(subtitle, 22, 70);
  ctx.font = `400 18px ${MONO}`;
  const shown = lines.slice(-8);
  shown.forEach((l, i) => {
    const fresh = i === shown.length - 1;
    ctx.fillStyle = l.color || (fresh ? '#e8edf3' : '#8b98aa');
    let text = l.text;
    while (ctx.measureText(text).width > W - 44 && text.length > 4) text = text.slice(0, -2);
    if (text !== l.text) text = text.slice(0, -1) + '…';
    ctx.fillText(text, 22, 104 + i * 23);
  });
  if (Math.floor(t * 2) % 2 === 0) {
    ctx.fillStyle = accent;
    ctx.fillRect(22, 104 + shown.length * 23 - 15, 10, 18);
  }
  tex.needsUpdate = true;
}

// ---------- the room ----------

export function buildOffice(scene) {
  const grid = new Grid(W, D);
  const blinkers = [];

  // The office sits on a thick wooden slab, like a model on a table.
  const edge = mat('#a97a50');
  const top = new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.7 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.7, D + 0.6), [edge, edge, top, edge, edge, edge]);
  slab.position.y = -0.35;
  slab.receiveShadow = true;
  slab.castShadow = true;
  scene.add(slab);
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.ShadowMaterial({ opacity: 0.14 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = -0.72;
  catcher.receiveShadow = true;
  scene.add(catcher);
  scene.add(contactShadow(W + 16, D + 16));
  const carpet = box(scene, 24.5, 0.02, 12.6, null, 0, 0.011, 1.2, new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 1 }));
  carpet.castShadow = false;

  // Four walls. The ones between the camera and the room drop to a stub so
  // you can always see in, whichever way you turn.
  const walls = [
    buildWall(scene, W + 0.6, 0, -D / 2 - 0.15, 0, [0, 0, -1]),
    buildWall(scene, W + 0.6, 0, D / 2 + 0.15, Math.PI, [0, 0, 1], [[-W / 2 - 0.3, -19.2], [-16.8, W / 2 + 0.3]]),
    buildWall(scene, D, -W / 2 - 0.15, 0, Math.PI / 2, [-1, 0, 0]),
    buildWall(scene, D, W / 2 + 0.15, 0, -Math.PI / 2, [1, 0, 0]),
  ];
  const [north, , west, east] = walls;
  grid.block(-W / 2, W / 2, -D / 2, -D / 2 + 0.2);
  grid.block(-W / 2, -W / 2 + 0.2, -D / 2, D / 2);

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
  [[-9, -3], [-3, -3], [3, -3], [9, -3], [-9, 5], [-3, 5], [3, 5], [9, 5]].forEach(([x, z], i) => desks.push(buildDesk(scene, grid, x, z, i)));

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
  north.attach.push(box(north.g, 9.4, 3.5, 0.08, '#d9cdbb', 0, 2.2, 0.2));
  const board = canvasPlane(north.g, 9, 3.2, 1536, 546);
  board.mesh.position.set(0, 2.2, 0.26);
  north.attach.push(board.mesh);

  // reception — the chief of staff
  const reception = new THREE.Group();
  reception.position.set(15.5, 0, 10.6);
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
  grid.block(13.7, 17.3, 10.1, 11.1);

  // entrance
  const mat0 = box(scene, 2.4, 0.02, 1.6, '#b9a58f', 18.2, 0.01, 13.4);
  mat0.castShadow = false;

  // wall art and a clock — they fold away with their wall
  framedArt(north, -7.6, 2.5, 1.6, 1.1, ART.sunset);
  wallClock(north, 7.6, 2.7);
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
  table.position.set(-1, 0, 11.6);
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
  grid.block(-3.8, 1.8, 10.3, 12.9);

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
  const lobby = box(scene, 5, 0.02, 3.2, '#c9b79c', 15.5, 0.012, 12.6, { roughness: 1 });
  lobby.castShadow = false;
  const lobbyBorder = box(scene, 4.6, 0.022, 2.8, '#ddd0bb', 15.5, 0.013, 12.6, { roughness: 1 });
  lobbyBorder.castShadow = false;

  const plants = [[-19, -9.5, 1.1, 'tall'], [10, -14, 1, 'snake'], [-9.8, -14.2, 0.9, 'bush'], [19, -11, 1.2, 'tall'], [-10.3, 14, 1, 'bush'], [6.2, 13.8, 1.1, 'tall'], [19, 8.5, 1, 'snake'], [19.2, 0, 0.9, 'bush'], [-19.1, 14.2, 0.8, 'snake'], [11.6, 13.9, 1, 'bush']];
  for (const [x, z, s, kind] of plants) plant(scene, grid, x, z, s, kind);

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
        [-2.7, 10.55, 's', 'sit', SEAT], [-1, 10.55, 's', 'sit', SEAT], [0.7, 10.55, 's', 'sit', SEAT],
        [-2.7, 12.65, 'n', 'sit', SEAT], [-1, 12.65, 'n', 'sit', SEAT], [0.7, 12.65, 'n', 'sit', SEAT],
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

  const updateWalls = (camera, target, dt) => cutaway(walls, camera, target, dt);
  return { grid, desks, stations, standup, board, scribble, blinkers, globe: land, slab, updateWalls, door: new THREE.Vector3(18.6, 0, 14.4), reception: { seat: new THREE.Vector3(15.5, 0, 9.6), seatY: SEAT } };
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
    const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, WALL_H, 0.3), mat(C.wall));
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
