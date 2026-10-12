import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import './style.css';
import './pwa.js';
import './theme.js';
import { setAccess } from './account.js';
import { setLeaderboard } from './leaderboard.js';
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildOffice, drawScreen, dressDesk, drawBoard, drawWhiteboard } from './office.js';
import { Agent } from './agent.js';
import { BreakRoom } from './breakroom.js';
import { PoolRoom } from './pool.js';
import { Confetti } from './fx.js';
import { Hud, api } from './hud.js';
import { TerminalDrawer } from './terminal.js';
import { sound } from './sound.js';
import { speech, recorder } from './voice.js';

// ---------- renderer, camera, light ----------

const view = document.getElementById('view');
const stage = document.getElementById('stage');
const labels = document.getElementById('labels');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = backdrop();
// Soft studio light from a virtual room, so surfaces read as materials.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

scene.add(new THREE.HemisphereLight('#fff8ef', '#b9ab99', 0.55));
const sun = new THREE.DirectionalLight('#fff0d8', 1.75);
sun.position.set(-18, 34, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 28, bottom: -28, near: 1, far: 100 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.03;
scene.add(sun);

// Map-style camera: drag moves you around, right-drag (or Q/E) turns
// around whatever is in the middle of the view, scroll zooms to the cursor.
const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
const HOME = { target: new THREE.Vector3(0, 0, 0.5), radius: 60, phi: 0.86, theta: Math.PI / 4 };
camera.position.setFromSpherical(new THREE.Spherical(HOME.radius, HOME.phi, HOME.theta)).add(HOME.target);
const controls = new MapControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
Object.assign(controls, {
  enableDamping: true, dampingFactor: 0.09, minPolarAngle: 0.25, maxPolarAngle: 1.22,
  minDistance: 12, maxDistance: 260, zoomToCursor: true, rotateSpeed: 0.55, zoomSpeed: 0.9, panSpeed: 1.1,
});

// How far back the camera must sit for the whole office to fit the view.
const CORNERS = [];
for (const x of [-20.3, 20.3]) for (const z of [-15.3, 15.3]) for (const y of [-0.7, 3]) CORNERS.push(new THREE.Vector3(x, y, z));
// On a tall, narrow screen the whole room can only fit very small, so let the
// sides run off the edge: the room fills the width and you pan to the rest.
function fitRadius(phi, theta, target) {
  const limX = camera.aspect < 0.9 ? 1.7 : 0.93;
  const probe = camera.clone();
  let lo = 15, hi = 260;
  for (let i = 0; i < 20; i++) {
    const r = (lo + hi) / 2;
    probe.position.setFromSpherical(new THREE.Spherical(r, phi, theta)).add(target);
    probe.lookAt(target);
    probe.updateMatrixWorld();
    const fits = CORNERS.every((c) => {
      const v = c.clone().project(probe);
      return Math.abs(v.x) < limX && Math.abs(v.y) < 0.88;
    });
    if (fits) hi = r; else lo = r;
  }
  return hi;
}

// Ambient occlusion: soft shade where things meet, which is most of what
// makes a miniature read as solid. Rendered with 4x MSAA.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, 1, 1);
ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.5, scale: 1.1, samples: 16 });
ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
ao.blendIntensity = 0.85;
composer.addPass(ao);
composer.addPass(new OutputPass());

function backdrop() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(256, 190, 20, 256, 230, 400);
  grad.addColorStop(0, '#f7f3ec');
  grad.addColorStop(0.6, '#ece5da');
  grad.addColorStop(1, '#d9d0c2');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let viewW = 1, viewH = 1;
let touched = false;
function resize() {
  // The stage, not the whole column: the terminal drawer takes a bite out of
  // the bottom of the view and the camera should be framed for what's left.
  const prevH = viewH;
  viewW = stage.clientWidth;
  viewH = stage.clientHeight;
  renderer.setSize(viewW, viewH, false);
  composer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  composer.setSize(viewW, viewH);
  camera.aspect = viewW / viewH;
  camera.updateProjectionMatrix();
  // Until you've moved the camera yourself, keep the whole office framed.
  if (!touched) {
    HOME.radius = fitRadius(HOME.phi, HOME.theta, HOME.target);
    camera.position.setFromSpherical(new THREE.Spherical(HOME.radius, HOME.phi, HOME.theta)).add(HOME.target);
    controls.target.copy(HOME.target);
  } else if (prevH > 1 && viewH > 1 && viewH !== prevH) {
    // The vertical field of view is fixed, so a shorter stage would shrink the
    // whole room — open the terminal and the desk you were leaning into halves
    // in size. Pull the camera in by the same ratio so your zoom survives: the
    // drawer takes a bite out of the view instead of rescaling it.
    const off = camera.position.clone().sub(controls.target);
    const r = THREE.MathUtils.clamp(off.length() * (viewH / prevH), controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(off.setLength(r));
  }
}
new ResizeObserver(resize).observe(stage);
resize();

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
  dismissed: new Set(),
  selected: null,
  job: (id) => app.jobs.get(id),
  staffName: (id) => app.staff.find((s) => s.id === id)?.name || '',
  person: (from) => {
    if (from === 'you') return { name: 'You', color: '#c9c1b4' };
    if (from === 'chief') return { name: 'Chief of Staff', color: CHIEF.shirt };
    const s = app.staff.find((x) => x.id === from);
    return { name: s?.name || from, color: s?.shirt || '#999' };
  },
  onFloor: () => app.staff.slice(0, app.progress?.capacity || 0).filter((s) => !app.dismissed.has(s.id)),
  roster: () => app.onFloor().map((s) => {
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
const terminal = new TerminalDrawer({ api, toast: (t, k) => hud.toast(t, k) });
const chief = new Agent(CHIEF, world, labels, { desk: office.reception, face: 0 });
const breakRoom = new BreakRoom();
const poolRoom = new PoolRoom(scene, office);
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
  if (current?.status !== 'working') hud.toast(`${agent.name} is between jobs. Press N to give them one.`, '', { label: 'Send home', run: () => app.dismiss(agent.id) });
};

app.dismiss = (id) => hud.post(`/api/staff/${id}/dismiss`);
app.recall = (id) => hud.post(`/api/staff/${id}/recall`);

function hire(firstLoad, greeting) {
  app.onFloor().forEach((s) => {
    const here = app.agents.get(s.id);
    if (here) { if (here.leaving) here.stay(); return; }
    const a = new Agent(s, world, labels);
    app.agents.set(s.id, a);
    if (firstLoad) a.teleport('lounge');
    else { a.teleport('door'); a.say(greeting || `Hi, I'm ${s.name}!`, 'good', 5000); }
  });
}

// Dismissed agents walk out; recalled ones walk back in.
function syncStaff(dismissed, firstLoad) {
  app.dismissed = new Set(dismissed || []);
  for (const a of app.agents.values()) {
    if (!app.dismissed.has(a.id) || a.leaving || a.job) continue;
    if (firstLoad) a.gone = true; else a.leave();
  }
  hire(firstLoad, 'Back in!');
  hud.renderAway(app.staff.filter((s) => app.dismissed.has(s.id)));
  hud.renderTeam();
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

// ---------- standup ----------

// Everyone named gathers in the ring, spread evenly; the chief takes the
// spot by the whiteboard.
function gather(who = [], instant = false) {
  const ring = office.standup;
  chief.meet(ring[0], instant);
  who.forEach((id, i) => app.agents.get(id)?.meet(ring[1 + Math.round((i * (ring.length - 2)) / Math.max(1, who.length - 1))], instant));
  app.standupOn = true;
  document.getElementById('standup').disabled = true;
}

function adjourn() {
  chief.adjourn();
  for (const a of app.agents.values()) a.adjourn();
  app.standupOn = false;
  document.getElementById('standup').disabled = false;
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
    app.voice = msg.voice;
    tts = msg.tts || tts;
    paintSpeak();
    app.modes = msg.modes;
    app.progress = msg.progress;
    app.chiefCost = msg.chiefCost || 0;
    app.jobs = new Map(msg.jobs.map((j) => [j.id, j]));
    hud.renderChannels(msg.channels || [{ id: 'general', name: 'general' }]);
    hud.renderChat(msg.chat || []);
    hud.chiefBusy(msg.chiefBusy);
    syncStaff(msg.dismissed, firstHello);
    syncAgents(firstHello);
    if (msg.standup) gather(msg.standup.who, firstHello);
    else if (app.standupOn) adjourn();
    firstHello = false;
    hud.renderLevel(app.progress);
    hud.renderUsage(msg.usage);
    setAccess(msg.auth);
    setLeaderboard(msg.leaderboard);
    hud.renderProc(msg.procs, msg.machine);
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
        const shipped = job.status === 'done' && !job.awaitingBoss;
        a.finish(shipped ? 'done' : job.awaitingBoss ? 'waiting' : job.status);
        if (shipped) confetti.burst(a.pos, [a.staff.shirt, '#f2cc8f', '#81b29a', '#3d7ea6', '#ffffff']);
        if (shipped) { sound.ship(); notify(`${a.name} shipped`, job.title); }
        if (job.status === 'failed') { sound.fail(); notify(`${a.name} hit a wall`, job.title); }
      }
    }
    if (prev?.status !== job.status) {
      if (hud.openId === job.id) hud.renderDetail();
      if (job.awaitingBoss && prev?.status === 'working') hud.toast(`${app.staffName(job.agentId)} is waiting on you: “${job.title}”`, 'warn');
      else if (job.status === 'done' && prev?.status === 'working') hud.toast(`${app.staffName(job.agentId)} shipped “${job.title}”`, 'good');
      if (job.status === 'failed' && prev?.status === 'working') hud.toast(`${app.staffName(job.agentId)} hit a wall on “${job.title}”`, 'bad');
    }
    else if (hud.openId === job.id && prev?.changes?.end !== job.changes?.end) hud.renderChanges(job);
    app.refreshLists();
  } else if (msg.t === 'log') {
    const job = app.jobs.get(msg.jobId);
    if (!job) return;
    job.log.push(msg.entry);
    if (job.log.length > 600) job.log.shift();
    for (const a of app.agents.values()) if (a.job?.id === job.id) a.onLog(msg.entry);
    if (msg.entry.todos) drawWhiteboard(office.scribble, msg.entry.todos);
    hud.appendLog(job.id, msg.entry);
  } else if (msg.t === 'channels') {
    hud.renderChannels(msg.channels);
  } else if (msg.t === 'chat') {
    hud.addMessage(msg.msg);
    const from = app.agents.get(msg.msg.from), to = app.agents.get(msg.msg.to);
    if (from && to) { from.visit(to, msg.msg.text); sound.knock(); }
    sayAloud(msg.msg);
    if (msg.msg.kind === 'flag') { sound.knock(); notify('The boss is needed', msg.msg.text.replace(/\*\*/g, '')); }
    if (msg.msg.kind === 'standup') {
      const text = msg.msg.say || msg.msg.text;
      (msg.msg.from === 'chief' ? chief : from)?.speak(text.length > 90 ? text.slice(0, 89) + '…' : text);
    } else if (msg.msg.from === 'chief') {
      chief.job = null;
      chief.say(msg.msg.text.length > 90 ? msg.msg.text.slice(0, 89) + '…' : msg.msg.text, '', 6000);
    }
  } else if (msg.t === 'forget') {
    hud.forget(msg.ids);
  } else if (msg.t === 'voice') {
    const el = hud.addVoice(msg.id, msg.file);
    // Play it as it lands, the way you'd hear someone speak — but never over
    // your own recording, and not for a tab you aren't looking at.
    if (el && tts.replies && !recorder.active && !document.hidden) el.play().catch(() => {});
  } else if (msg.t === 'tts') {
    tts = { ...tts, ...msg };
    paintSpeak();
  } else if (msg.t === 'react') {
    hud.setReactions(msg.id, msg.reactions);
  } else if (msg.t === 'standup') {
    if (msg.phase === 'start') { gather(msg.who); hud.banner('Standup', 'Everyone to the whiteboard.'); sound.knock(); }
    else adjourn();
  } else if (msg.t === 'chief') {
    hud.chiefBusy(msg.busy);
    if (msg.busy) { chief.job = { id: 'routing' }; chief.say('Reading your message…', 'thinking'); }
    else chief.job = null;
    if (msg.cost !== undefined) { app.chiefCost = msg.cost; app.refreshLists(); }
  } else if (msg.t === 'staff') {
    syncStaff(msg.dismissed, false);
  } else if (msg.t === 'profile') {
    const s = app.staff.find((x) => x.id === msg.id);
    if (s) Object.assign(s, msg.profile);
    hud.renderTeam();
  } else if (msg.t === 'auth') {
    setAccess(msg.auth);
  } else if (msg.t === 'leaderboard') {
    setLeaderboard(msg.leaderboard);
  } else if (msg.t === 'usage') {
    hud.renderUsage(msg.usage);
  } else if (msg.t === 'proc') {
    hud.renderProc(msg.procs, msg.machine);
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

// Reading replies aloud is its own switch: the cues and the voices are
// different kinds of noise, and you may well want one without the other.
const VOICE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
const VOICE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9V6a3 3 0 0 1 5.6-1.5M15 11a3 3 0 0 1-4.5 2.6"/><path d="M5 11a7 7 0 0 0 11 5.7M19 11v0"/><path d="M12 18v3"/><path d="m3 3 18 18"/></svg>';
const speakBtn = document.getElementById('speak');
// Piper records the agents in their own voices, which sound far better but
// take a few seconds. Without it the browser's own voices stand in, instantly
// and worse. The one button means the same thing either way.
let tts = { ok: false, replies: false };
const voiceLive = () => (tts.ok ? tts.replies : speech.on);
function paintSpeak() {
  const on = voiceLive();
  speakBtn.innerHTML = on ? VOICE_ON : VOICE_OFF;
  speakBtn.classList.toggle('on', on);
  const label = on ? (tts.ok ? 'Agents reply with voice notes' : 'Replies read aloud') : 'Replies are silent';
  speakBtn.title = label;
  speakBtn.setAttribute('aria-label', label);
}
if (!speech.supported) speakBtn.hidden = true;
speakBtn.onclick = async () => {
  const want = !voiceLive();
  if (!tts.ok) {
    speech.setOn(want);
    paintSpeak();
    if (want) speech.speak('Voice on. I will read replies out as they land.', 'chief', { force: true });
    return;
  }
  tts = { ...tts, replies: want };
  paintSpeak();
  try {
    const res = await fetch('/api/voice/replies', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: want }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  } catch (err) {
    tts = { ...tts, replies: !want };
    paintSpeak();
    hud.toast(err.message, 'bad');
  }
};
paintSpeak();

// Whose words get spoken: the chief and the agents reporting back to you.
// Agent-to-agent asides already have their own knock, and talking over your
// own recording would only feed the microphone.
function sayAloud(m) {
  if (tts.ok) return; // the server is recording this one properly
  if (!speech.on || m.from === 'you' || m.to || m.kind === 'chill' || recorder.active) return;
  speech.speak(m.text, m.from);
}

function latestTodos() {
  let best = null;
  for (const j of app.jobs.values()) for (const e of j.log) if (e.todos && (!best || e.ts > best.ts)) best = e;
  return best?.todos || [];
}

// ---------- camera ----------

const sph = new THREE.Spherical();
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
let tween = null;
let follow = false;
function focus() { follow = true; tween = null; touched = true; }

function camTo({ target, radius, phi, theta }, dur = 0.7) {
  sph.setFromVector3(camera.position.clone().sub(controls.target));
  tween = {
    t: 0, dur,
    target0: controls.target.clone(), target1: (target || controls.target).clone().setY(0),
    r0: sph.radius, r1: radius ?? sph.radius, p0: sph.phi, p1: phi ?? sph.phi, th0: sph.theta, th1: theta ?? sph.theta,
  };
}
function turn(dir) {
  touched = true;
  sph.setFromVector3(camera.position.clone().sub(controls.target));
  const from = tween ? tween.th1 : sph.theta;
  camTo({ theta: from + (dir * Math.PI) / 4, target: tween?.target1 }, 0.55);
}
function recenter() {
  follow = false;
  sph.setFromVector3(camera.position.clone().sub(controls.target));
  let th = HOME.theta;
  while (th - sph.theta > Math.PI) th -= Math.PI * 2;
  while (sph.theta - th > Math.PI) th += Math.PI * 2;
  camTo({ target: HOME.target, radius: fitRadius(HOME.phi, th, HOME.target), phi: HOME.phi, theta: th }, 0.9);
}
controls.addEventListener('start', () => {
  touched = true;
  tween = null;
  follow = false;
  setTimeout(() => document.querySelector('.hint')?.classList.add('gone'), 5000);
});
document.getElementById('turnLeft').onclick = () => turn(-1);
document.getElementById('turnRight').onclick = () => turn(1);
document.getElementById('recenter').onclick = () => recenter();
document.getElementById('standup').onclick = () => hud.post('/api/standup');

const held = new Set();
addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === 'q') turn(-1);
  else if (k === 'e') turn(1);
  else if (k === 'r') recenter();
  else if ('wasd'.includes(k) && k.length === 1) { held.add(k); tween = null; follow = false; }
});
addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
addEventListener('blur', () => held.clear());

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
function steer(dt) {
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / tween.dur);
    const k = ease(tween.t);
    const target = tween.target0.clone().lerp(tween.target1, k);
    sph.set(THREE.MathUtils.lerp(tween.r0, tween.r1, k), THREE.MathUtils.lerp(tween.p0, tween.p1, k), THREE.MathUtils.lerp(tween.th0, tween.th1, k));
    controls.target.copy(target);
    camera.position.setFromSpherical(sph).add(target);
    if (tween.t >= 1) tween = null;
  }
  move.set(0, 0, 0);
  const followed = follow && app.agents.get(app.selected);
  if (followed) move.set(followed.pos.x - controls.target.x, 0, followed.pos.z - controls.target.z).multiplyScalar(Math.min(1, dt * 3));
  if (held.size) {
    fwd.subVectors(controls.target, camera.position).setY(0).normalize();
    right.crossVectors(fwd, camera.up).normalize();
    const speed = 0.45 * camera.position.distanceTo(controls.target) * dt;
    if (held.has('w')) move.addScaledVector(fwd, speed);
    if (held.has('s')) move.addScaledVector(fwd, -speed);
    if (held.has('d')) move.addScaledVector(right, speed);
    if (held.has('a')) move.addScaledVector(right, -speed);
  }
  controls.target.add(move);
  camera.position.add(move);
  controls.update();
  // Never lose the office: keep the point you're looking at on the floor.
  const t = controls.target;
  move.set(THREE.MathUtils.clamp(t.x, -19, 19) - t.x, -t.y, THREE.MathUtils.clamp(t.z, -14, 14) - t.z);
  t.add(move);
  camera.position.add(move);
}

// ---------- picking ----------

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function aim(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
const people = () => [...app.agents.values(), chief].map((a) => a.root);

let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || e.button !== 0) return;
  aim(e);
  const hit = ray.intersectObjects(people(), true)[0];
  if (!hit) return;
  if (hit.object.userData.agentId === 'chief') {
    hud.focusInput();
    chief.say('Tell me what you need.', '', 3000);
  } else app.select(hit.object.userData.agentId);
});
renderer.domElement.addEventListener('dblclick', (e) => {
  aim(e);
  const hit = ray.intersectObject(office.slab, false)[0];
  if (hit) {
    follow = false;
    camTo({ target: hit.point, radius: Math.min(camera.position.distanceTo(controls.target), 34) }, 0.8);
  }
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  aim(e);
  renderer.domElement.style.cursor = ray.intersectObjects(people(), true).length ? 'pointer' : '';
});

// ---------- loop ----------

const clock = new THREE.Clock();
let screenTimer = 0, ledTimer = 0;

function drawScreens(t) {
  office.desks.forEach((desk, i) => {
    const staff = app.staff[i];
    const agent = staff && app.agents.get(staff.id);
    const away = !agent && staff && app.dismissed.has(staff.id);
    // The nameplate and second screen only change when the desk changes
    // hands, so they're redrawn on the state, not on every frame.
    const state = agent?.job ? 'working' : agent ? 'break' : away ? 'away' : 'open';
    const owned = state !== 'open';
    const plateKey = `${staff?.name || ''} ${state}`;
    if (desk.plateKey !== plateKey) {
      desk.plateKey = plateKey;
      dressDesk(desk, { name: owned ? staff.name : 'Open desk', accent: owned ? staff.shirt : '#7d8a9c', state });
    }
    if (agent?.job) {
      drawScreen(desk, { title: agent.job.repo, subtitle: agent.job.title, lines: agent.lines, accent: staff.shirt, t });
      desk.idleKey = null;
      return;
    }
    const key = agent ? `${staff.name}` : away ? `away ${staff.name}` : `open`;
    if (desk.idleKey === key) return;
    desk.idleKey = key;
    const unlock = app.progress ? i - 1 : 0;
    drawScreen(desk, agent ? { idle: true, title: staff.name, subtitle: 'on a break' }
      : away ? { idle: true, title: staff.name, subtitle: 'gone home' }
      : { idle: true, title: 'Open desk', subtitle: `hires at level ${unlock}` });
  });
}

let far = false;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  steer(dt);
  office.updateWalls(camera, controls.target, dt);

  for (const a of app.agents.values()) {
    a.update(dt, t);
    if (!a.gone) continue;
    a.dispose();
    app.agents.delete(a.id);
    if (app.selected === a.id) app.select(null);
  }
  breakRoom.update([...app.agents.values()], t);
  poolRoom.update([...app.agents.values()], t, dt);
  chief.update(dt, t);
  confetti.update(dt);
  office.globe.rotation.y += dt * 0.4;

  if ((screenTimer -= dt) <= 0) { screenTimer = 0.4; drawScreens(t); }
  if ((ledTimer -= dt) <= 0) {
    ledTimer = 0.15;
    for (const led of office.blinkers) if (Math.random() < 0.25) led.material.emissiveIntensity = Math.random() < 0.5 ? 0.15 : 1.4;
  }

  composer.render(dt);
  // Zoomed far out, names stay but speech bubbles step back.
  const isFar = camera.position.distanceTo(controls.target) > 74;
  const onScreen = [];
  for (const a of [...app.agents.values(), chief]) {
    if (isFar !== far) { a.label.classList.toggle('far', isFar); a.labelDirty = true; }
    a.placeLabel(camera, viewW, viewH);
    if (a.onScreen) onScreen.push(a);
  }
  declutter(onScreen, dt, t);
  far = isFar;
  requestAnimationFrame(frame);
}

// Agents bunch up — on the couch, round the standup ring — and their labels
// land on top of each other. Walk them nearest-first and lift anyone who
// lands on a label already placed; whoever still can't fit loses their bubble.
const GAP = 4;
const hits = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;

function declutter(list, dt, now) {
  const placed = [];
  // Nearest first, but whoever is selected always gets their pick of the space.
  const order = (x) => (x.id === app.selected ? -1 : x.depth);
  for (const a of [...list].sort((x, y) => order(x) - order(y))) {
    let lift = 0;
    let crowded = false;
    for (let pass = 0; pass < 2; pass++) {
      // Lift far enough and a label stops reading as that agent's, so cap it —
      // a bare name can ride higher than a bubble — and never lift one off the
      // top of the view.
      const ceiling = Math.max(0, Math.min(crowded ? 140 : 80, a.anchorY - a.labelH - 6));
      lift = 0;
      for (let i = 0; i < 10 && lift <= ceiling; i++) {
        const box = a.labelBox(lift);
        const hit = placed.find((p) => hits(p, box));
        if (!hit) break;
        lift += box.bottom - hit.top + GAP;
      }
      if (lift <= ceiling || crowded) { lift = Math.min(lift, ceiling); break; }
      crowded = true;
      a.setCrowded(true, now);
    }
    if (!crowded) a.setCrowded(false, now);
    a.setLift(lift, dt);
    // Out of room even as a bare name: they're standing behind someone, so
    // their label waits its turn rather than printing over the one in front.
    const box = a.labelBox(a.lift);
    const buried = placed.some((p) => hits(p, box));
    a.setBuried(buried);
    if (!buried) placed.push(box);
  }
}

drawBoard(office.board, []);
drawWhiteboard(office.scribble, []);
connect();
frame();
