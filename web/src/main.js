import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildOffice, drawScreen, drawBoard, drawWhiteboard } from './office.js';
import { Agent } from './agent.js';
import { Confetti } from './fx.js';
import { Hud } from './hud.js';
import { sound } from './sound.js';

// ---------- renderer, camera, light ----------

const stage = document.getElementById('stage');
const labels = document.getElementById('labels');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e7e1d8');
scene.fog = new THREE.Fog('#e7e1d8', 80, 140);

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 300);
camera.position.set(19, 27, 36.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-1, 0, 2.5);
controls.enableDamping = true;
controls.maxPolarAngle = 1.22;
controls.minPolarAngle = 0.3;
controls.minDistance = 10;
controls.maxDistance = 95;
controls.screenSpacePanning = false;

scene.add(new THREE.HemisphereLight('#fff8ef', '#b9ab99', 1.1));
const sun = new THREE.DirectionalLight('#fff1dc', 1.9);
sun.position.set(-16, 30, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 24, bottom: -24, near: 1, far: 90 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const office = buildOffice(scene);
const confetti = new Confetti(scene);

// ---------- state ----------

const CHIEF = { id: 'chief', name: 'Chief', shirt: '#2b2d42', hair: '#8d8d8d', skin: '#a8714a' };

const app = {
  staff: [],
  chiefCost: 0,
  modes: {},
  progress: null,
  jobs: new Map(),
  agents: new Map(),
  selected: null,
  job: (id) => app.jobs.get(id),
  staffName: (id) => app.staff.find((s) => s.id === id)?.name || '',
  person: (from) => {
    if (from === 'you') return { name: 'You', color: '#c9c1b4' };
    if (from === 'chief') return { name: 'Chief of Staff', color: CHIEF.shirt };
    const s = app.staff.find((x) => x.id === from);
    return { name: s?.name || from, color: s?.shirt || '#999' };
  },
  roster: () => app.staff.slice(0, app.progress?.capacity || 0).map((s) => {
    const job = [...app.jobs.values()].find((j) => j.status === 'working' && j.agentId === s.id);
    return { name: s.name, color: s.shirt, note: job ? `on ${job.repo}` : 'free' };
  }),
  busyIn: (repo) => {
    const names = [...app.jobs.values()].filter((j) => j.status === 'working' && j.repo === repo).map((j) => app.staffName(j.agentId));
    return names.length ? `${names.join(', ')} here` : '';
  },
};
const world = { scene, ...office, agentIndex: (id) => app.staff.findIndex((s) => s.id === id) };
const hud = new Hud(app);
const chief = new Agent(CHIEF, world, labels, { desk: office.reception, face: 0 });
chief.want = 'desk';
chief.teleport('desk');

app.mergeLog = (full) => {
  const job = app.jobs.get(full.id);
  if (job) job.log = full.log;
  else app.jobs.set(full.id, full);
};

app.refreshLists = () => {
  const jobs = [...app.jobs.values()];
  hud.renderJobs(jobs, app.staffName);
  hud.renderStats(jobs, app.chiefCost);
  drawBoard(office.board, jobs);
};

app.openJob = (id) => {
  hud.openDetail(id);
  const job = app.jobs.get(id);
  const agent = job?.status === 'working' && app.agents.get(job.agentId);
  if (agent) { app.select(agent.id, false); focus(); }
};

app.select = (agentId, openJob = true) => {
  for (const a of app.agents.values()) a.setSelected(a.id === agentId);
  app.selected = agentId;
  if (!agentId) follow = false;
  if (!agentId || !openJob) return;
  const agent = app.agents.get(agentId);
  focus();
  hud.focusInput(`@${agent.name} `);
  const mine = [...app.jobs.values()].filter((j) => j.agentId === agentId);
  const current = mine.find((j) => j.status === 'working') || mine.sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0];
  if (current) hud.openDetail(current.id);
  else hud.toast(`${agent.name} is between jobs. Press N to give them one.`);
};

function hire(firstLoad) {
  app.staff.slice(0, app.progress.capacity).forEach((s) => {
    if (app.agents.has(s.id)) return;
    const a = new Agent(s, world, labels);
    app.agents.set(s.id, a);
    if (firstLoad) a.teleport('lounge');
    else { a.teleport('door'); a.say(`Hi, I'm ${s.name}!`, 'good', 5000); }
  });
}

function syncAgents(instant) {
  for (const a of app.agents.values()) {
    const job = [...app.jobs.values()].find((j) => j.status === 'working' && j.agentId === a.id);
    if (job && a.job?.id !== job.id) {
      a.assign(job, instant);
      job.log.forEach((e) => a.onLog(e));
    } else if (!job && a.job) {
      a.finish(app.jobs.get(a.job.id)?.status || 'stopped');
    }
  }
}

// ---------- network ----------

let firstHello = true;
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = () => {
    hud.toast('Lost the office line. Reconnecting…', 'bad');
    setTimeout(connect, 1500);
  };
}

function handle(msg) {
  if (msg.t === 'hello') {
    app.staff = msg.staff;
    app.modes = msg.modes;
    app.progress = msg.progress;
    app.chiefCost = msg.chiefCost || 0;
    app.jobs = new Map(msg.jobs.map((j) => [j.id, j]));
    hud.renderChat(msg.chat || []);
    hud.chiefBusy(msg.chiefBusy);
    hire(firstHello);
    syncAgents(firstHello);
    firstHello = false;
    hud.renderLevel(app.progress);
    app.refreshLists();
    const todos = latestTodos();
    drawWhiteboard(office.scribble, todos);
    if (hud.openId) app.jobs.has(hud.openId) ? hud.openDetail(hud.openId) : hud.closeDetail();
  } else if (msg.t === 'job') {
    const prev = app.jobs.get(msg.job.id);
    const job = { ...msg.job, log: prev?.log || [] };
    app.jobs.set(job.id, job);
    if (job.status === 'working') {
      const a = app.agents.get(job.agentId);
      if (a && a.job?.id !== job.id) a.assign(job);
      else if (a) a.job = job;
    } else {
      for (const a of app.agents.values()) {
        if (a.job?.id !== job.id) continue;
        a.finish(job.status);
        if (job.status === 'done') confetti.burst(a.pos, [a.staff.shirt, '#f2cc8f', '#81b29a', '#3d7ea6', '#ffffff']);
        if (job.status === 'done') { sound.ship(); notify(`${a.name} shipped`, job.title); }
        if (job.status === 'failed') { sound.fail(); notify(`${a.name} hit a wall`, job.title); }
      }
    }
    if (prev?.status !== job.status) {
      if (hud.openId === job.id) hud.renderDetail();
      if (job.status === 'done' && prev?.status === 'working') hud.toast(`${app.staffName(job.agentId)} shipped “${job.title}”`, 'good');
      if (job.status === 'failed' && prev?.status === 'working') hud.toast(`${app.staffName(job.agentId)} hit a wall on “${job.title}”`, 'bad');
    }
    app.refreshLists();
  } else if (msg.t === 'log') {
    const job = app.jobs.get(msg.jobId);
    if (!job) return;
    job.log.push(msg.entry);
    if (job.log.length > 600) job.log.shift();
    for (const a of app.agents.values()) if (a.job?.id === job.id) a.onLog(msg.entry);
    if (msg.entry.todos) drawWhiteboard(office.scribble, msg.entry.todos);
    hud.appendLog(job.id, msg.entry);
  } else if (msg.t === 'chat') {
    hud.addMessage(msg.msg);
    const from = app.agents.get(msg.msg.from), to = app.agents.get(msg.msg.to);
    if (from && to) { from.visit(to, msg.msg.text); sound.knock(); }
    if (msg.msg.from === 'chief') {
      chief.job = null;
      chief.say(msg.msg.text.length > 90 ? msg.msg.text.slice(0, 89) + '…' : msg.msg.text, '', 6000);
    }
  } else if (msg.t === 'chief') {
    hud.chiefBusy(msg.busy);
    if (msg.busy) { chief.job = { id: 'routing' }; chief.say('Reading your message…', 'thinking'); }
    else chief.job = null;
    if (msg.cost !== undefined) { app.chiefCost = msg.cost; app.refreshLists(); }
  } else if (msg.t === 'xp') {
    app.progress = msg.progress;
    hud.renderLevel(app.progress);
    const a = app.agents.get(msg.agentId);
    if (a) {
      const f = document.createElement('span');
      f.className = 'xpfloat';
      f.textContent = `+${msg.gained} XP`;
      a.label.appendChild(f);
      setTimeout(() => f.remove(), 1800);
    }
    if (msg.levelUp) {
      setTimeout(() => sound.levelUp(), 700);
      const hiredName = app.staff[app.progress.capacity - 1]?.name;
      const hiring = !app.agents.has(app.staff[app.progress.capacity - 1]?.id);
      hud.banner(`Level ${app.progress.level}`, hiring ? `${hiredName} just joined the office.` : 'The office is fully staffed.');
      hire(false);
    }
  }
}

// ---------- notifications ----------

let unseen = 0;
function notify(title, body) {
  if (!document.hidden) return;
  unseen++;
  document.title = `(${unseen}) Agent Office`;
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, silent: true });
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { unseen = 0; document.title = 'Agent Office'; }
});
// Ask once, on the first message you send.
document.getElementById('composer').addEventListener('submit', () => {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
}, { once: true });

const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>';
const soundBtn = document.getElementById('sound');
function paintSound() {
  soundBtn.innerHTML = sound.muted ? ICON_OFF : ICON_ON;
  const label = sound.muted ? 'Sound off' : 'Sound on';
  soundBtn.title = label;
  soundBtn.setAttribute('aria-label', label);
}
soundBtn.onclick = () => {
  sound.setMuted(!sound.muted);
  paintSound();
  if (!sound.muted) sound.ship();
};
paintSound();

function latestTodos() {
  let best = null;
  for (const j of app.jobs.values()) for (const e of j.log) if (e.todos && (!best || e.ts > best.ts)) best = e;
  return best?.todos || [];
}

// ---------- camera focus + picking ----------

// The camera follows whoever is selected, framed in the space left of the
// detail drawer. Panning hands control back to you.
let follow = false;
function focus() { follow = true; }
function framePoint(pos) {
  const p = new THREE.Vector3(pos.x, 0, pos.z);
  const drawer = document.getElementById('detail');
  if (drawer.hidden) return p;
  const dist = camera.position.distanceTo(controls.target);
  const perPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / innerHeight;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  return p.addScaledVector(right, (drawer.offsetWidth / 2 + 8) * perPx);
}

const ray = new THREE.Raycaster();
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  down = [e.clientX, e.clientY];
  if (e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey) follow = false;
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObjects([...app.agents.values(), chief].map((a) => a.root), true)[0];
  if (!hit) return;
  if (hit.object.userData.agentId === 'chief') {
    hud.focusInput();
    chief.say('Tell me what you need.', '', 3000);
  } else app.select(hit.object.userData.agentId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const over = ray.intersectObjects([...app.agents.values(), chief].map((a) => a.root), true).length > 0;
  renderer.domElement.style.cursor = over ? 'pointer' : '';
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- loop ----------

const clock = new THREE.Clock();
let screenTimer = 0, ledTimer = 0;

function drawScreens(t) {
  office.desks.forEach((desk, i) => {
    const staff = app.staff[i];
    const agent = staff && app.agents.get(staff.id);
    if (agent?.job) {
      drawScreen(desk, { title: agent.job.repo, subtitle: agent.job.title, lines: agent.lines, accent: staff.shirt, t });
      desk.idleKey = null;
      return;
    }
    const key = agent ? `${staff.name}` : `open`;
    if (desk.idleKey === key) return;
    desk.idleKey = key;
    const unlock = app.progress ? i - 1 : 0;
    drawScreen(desk, agent ? { idle: true, title: staff.name, subtitle: 'on a break' } : { idle: true, title: 'Open desk', subtitle: `hires at level ${unlock}` });
  });
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  const followed = follow && app.agents.get(app.selected);
  if (followed) {
    const delta = framePoint(followed.pos).sub(controls.target).multiplyScalar(Math.min(1, dt * 3));
    controls.target.add(delta);
    camera.position.add(delta);
  }
  controls.update();

  for (const a of app.agents.values()) a.update(dt, t);
  chief.update(dt, t);
  confetti.update(dt);
  office.globe.rotation.y += dt * 0.4;

  if ((screenTimer -= dt) <= 0) { screenTimer = 0.4; drawScreens(t); }
  if ((ledTimer -= dt) <= 0) {
    ledTimer = 0.15;
    for (const led of office.blinkers) if (Math.random() < 0.25) led.material.emissiveIntensity = Math.random() < 0.5 ? 0.15 : 1.4;
  }

  renderer.render(scene, camera);
  for (const a of app.agents.values()) a.placeLabel(camera, innerWidth, innerHeight);
  chief.placeLabel(camera, innerWidth, innerHeight);
  requestAnimationFrame(frame);
}

drawBoard(office.board, []);
drawWhiteboard(office.scribble, []);
connect();
frame();
