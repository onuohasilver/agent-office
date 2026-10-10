import * as THREE from 'three';
import { Grid } from './nav.js';

export const W = 40, D = 30;

const C = {
  floor: '#ece3d4', wall: '#f5f0e8', trim: '#d9cdbb', wood: '#c39a6b', woodDark: '#8c6440',
  metal: '#3b404c', rack: '#262a33', plant: '#5f9e6e', plantDark: '#477d55', pot: '#e4d6c1',
  couch: '#5b7fa6', rug: '#d8bfa8', glass: '#cfe6f2', board: '#fbfaf7', chair: '#30343d',
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

function plant(scene, grid, x, z, s = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * s, 0.28 * s, 0.6 * s, 16), mat(C.pot));
  pot.position.y = 0.3 * s;
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.65 * s, 0), mat(C.plant, { flatShading: true }));
  leaves.position.y = 1.05 * s;
  const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 * s, 0), mat(C.plantDark, { flatShading: true }));
  top.position.set(0.15 * s, 1.55 * s, -0.05 * s);
  for (const m of [pot, leaves, top]) { m.castShadow = true; g.add(m); }
  scene.add(g);
  grid.block(x - 0.45, x + 0.45, z - 0.45, z + 0.45);
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

  // chair
  const chair = new THREE.Group();
  chair.position.set(0, 0, 1.05);
  box(chair, 0.62, 0.08, 0.6, C.chair, 0, 0.5, 0);
  box(chair, 0.62, 0.6, 0.08, C.chair, 0, 0.84, 0.3);
  box(chair, 0.06, 0.46, 0.06, C.metal, 0, 0.24, 0);
  g.add(chair);

  const screen = canvasPlane(g, 1.3, 0.74, 512, 292);
  screen.mesh.position.set(0, 1.45, -0.285);

  scene.add(g);
  grid.block(x - 1.3, x + 1.3, z - 0.7, z + 0.5);
  return { index, x, z, seat: new THREE.Vector3(x, 0, z + 1.05), screen, chair };
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

  // floor + walls
  const floor = box(scene, W, 0.2, D, C.floor, 0, -0.1, 0);
  floor.castShadow = false;
  box(scene, W + 0.3, 4.2, 0.3, C.wall, -0.15, 2.1, -D / 2 - 0.15);
  box(scene, 0.3, 4.2, D, C.wall, -W / 2 - 0.15, 2.1, 0);
  box(scene, W, 0.22, 0.06, C.trim, 0, 0.11, -D / 2 + 0.03);
  box(scene, 0.06, 0.22, D, C.trim, -W / 2 + 0.03, 0.11, 0);
  grid.block(-W / 2, W / 2, -D / 2, -D / 2 + 0.2);
  grid.block(-W / 2, -W / 2 + 0.2, -D / 2, D / 2);

  // left-wall windows
  for (const wz of [-6, 0, 6]) {
    box(scene, 0.08, 2.2, 3.6, C.glass, -W / 2 + 0.02, 2.2, wz, { emissive: '#bfe3f5', emissiveIntensity: 0.35, roughness: 0.2 });
    box(scene, 0.14, 0.12, 3.8, C.trim, -W / 2 + 0.06, 1.08, wz);
    box(scene, 0.14, 0.12, 3.8, C.trim, -W / 2 + 0.06, 3.32, wz);
    box(scene, 0.14, 2.3, 0.1, C.trim, -W / 2 + 0.06, 2.2, wz);
  }

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
  box(couch, 5, 0.45, 1.2, C.couch, 0, 0.32, 0);
  box(couch, 5, 0.8, 0.3, C.couch, 0, 0.75, -0.48);
  box(couch, 0.3, 0.65, 1.2, C.couch, -2.35, 0.55, 0);
  box(couch, 0.3, 0.65, 1.2, C.couch, 2.35, 0.55, 0);
  for (const cx of [-1.5, 0, 1.5]) box(couch, 1.4, 0.14, 1.0, '#6c8fb6', cx, 0.6, 0.05);
  scene.add(couch);
  grid.block(-17, -12, 7.8, 9);
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

  // kanban wall
  box(scene, 9.4, 3.5, 0.08, '#d9cdbb', 0, 2.2, -14.94);
  const board = canvasPlane(scene, 9, 3.2, 1536, 546);
  board.mesh.position.set(0, 2.2, -14.88);

  // entrance
  const mat0 = box(scene, 2.4, 0.02, 1.6, '#b9a58f', 18.2, 0.01, 13.4);
  mat0.castShadow = false;

  for (const [x, z, s] of [[-19, -9.5, 1.1], [10, -14, 1], [-9.8, -14.2, 0.9], [19, -11, 1.2], [-10.3, 14, 1], [6.2, 13.8, 1.1], [19, 8.5, 1]]) plant(scene, grid, x, z, s);

  const face = { n: Math.PI, s: 0, w: -Math.PI / 2, e: Math.PI / 2 };
  const spots = (list) => list.map(([x, z, f, pose]) => ({ pos: new THREE.Vector3(x, 0, z), face: face[f], pose, taken: null }));
  const stations = {
    library: { label: 'Library', spots: spots([[-17.6, -12.9, 'n', 'read'], [-15.3, -12.9, 'n', 'read'], [-13.1, -12.9, 'n', 'read'], [-11, -12.9, 'n', 'read']]) },
    servers: { label: 'Server room', spots: spots([[12.7, -12.6, 'n', 'type'], [14.1, -12.6, 'n', 'type'], [15.5, -12.6, 'n', 'type'], [16.9, -12.6, 'n', 'type']]) },
    window: { label: 'Research window', spots: spots([[-17.5, -6, 'w', 'gaze'], [-17.5, -2.6, 'w', 'gaze'], [-17.5, 2.6, 'w', 'gaze'], [-17.5, 6, 'w', 'gaze']]) },
    whiteboard: { label: 'Whiteboard', spots: spots([[13.9, -6.4, 'n', 'write'], [15.2, -6.4, 'n', 'write'], [16.5, -6.4, 'n', 'write'], [17.8, -6.4, 'n', 'write']]) },
    lounge: {
      label: 'Lounge',
      spots: spots([
        [-16, 8.55, 's', 'couch'], [-14.5, 8.55, 's', 'couch'], [-13, 8.55, 's', 'couch'],
        [-17.9, 11.4, 'w', 'mug'], [-17.9, 12.8, 'w', 'mug'],
        [-11, 10.6, 'w', 'stand'], [-15.6, 12.7, 'n', 'stand'], [-13.2, 12.7, 'n', 'stand'],
      ]),
    },
  };

  return { grid, desks, stations, board, scribble, blinkers, globe: land, door: new THREE.Vector3(18.6, 0, 14.4) };
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
