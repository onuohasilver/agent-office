// Small synthesized cues, so there are no audio files to ship. Browsers only
// allow sound after the page has been interacted with, so the context is
// unlocked on the first click or key press.

let ctx = null, master = null;
let muted = false;
try { muted = localStorage.getItem('office.muted') === '1'; } catch {}

function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

function tone(freq, at, dur, { type = 'sine', gain = 0.2 } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const ready = () => !muted && ctx && ctx.state === 'running';

export const sound = {
  get muted() { return muted; },
  setMuted(on) {
    muted = on;
    try { localStorage.setItem('office.muted', on ? '1' : '0'); } catch {}
  },
  // Someone shipped: a bright rising triad with a soft shimmer on top.
  ship() {
    if (!ready()) return;
    [659.25, 830.61, 987.77].forEach((f, i) => {
      tone(f, i * 0.085, 0.55, { gain: 0.16 });
      tone(f * 2, i * 0.085, 0.3, { type: 'triangle', gain: 0.035 });
    });
    tone(1318.5, 0.26, 0.9, { gain: 0.09 });
  },
  fail() {
    if (!ready()) return;
    tone(293.66, 0, 0.35, { type: 'triangle', gain: 0.12 });
    tone(246.94, 0.14, 0.5, { type: 'triangle', gain: 0.12 });
  },
  levelUp() {
    if (!ready()) return;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.07, 0.7, { gain: 0.13 }));
  },
  // A soft knock when agents talk to each other.
  knock() {
    if (!ready()) return;
    tone(880, 0, 0.09, { gain: 0.06 });
    tone(1174.7, 0.07, 0.12, { gain: 0.05 });
  },
};
