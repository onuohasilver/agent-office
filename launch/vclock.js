// Injected before the app loads. Puts the page on a virtual clock that only
// moves when the capture script calls window.__step(ms), so every captured
// frame is exactly 1/30 s after the last however slowly it rendered.
// Covers performance.now, requestAnimationFrame, setTimeout/setInterval and
// CSS/Web animations. Date stays real so it agrees with the server's timestamps.
// Math.random is seeded so idle wandering and break-room picks repeat.
(() => {
  let seed = 0x2545f491;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const realNow = performance.now.bind(performance);
  const p0 = realNow();
  let vt = 0;
  performance.now = () => p0 + vt;

  const timers = new Map();
  let nextId = 1;
  const call = (fn, args) => {
    try { typeof fn === 'function' ? fn(...args) : (0, eval)(String(fn)); } catch (e) { console.error(e); }
  };
  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = nextId++;
    timers.set(id, { at: vt + Math.max(0, Number(ms) || 0), fn, args, every: 0, seq: id });
    return id;
  };
  window.setInterval = (fn, ms = 0, ...args) => {
    const id = nextId++;
    const every = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: vt + every, fn, args, every, seq: id });
    return id;
  };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };

  let raf = new Map();
  window.requestAnimationFrame = (cb) => { const id = nextId++; raf.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { raf.delete(id); };

  function runTimers(until) {
    for (;;) {
      let best = null;
      for (const [id, t] of timers) {
        if (t.at <= until && (!best || t.at < best[1].at || (t.at === best[1].at && t.seq < best[1].seq))) best = [id, t];
      }
      if (!best) return;
      const [id, t] = best;
      vt = Math.max(vt, t.at);
      if (t.every) t.at += t.every; else timers.delete(id);
      call(t.fn, t.args);
    }
  }

  function stepAnimations(ms) {
    for (const a of document.getAnimations()) {
      if (!a.__v) {
        a.__v = true;
        try { a.pause(); } catch {}
        continue;
      }
      const end = a.effect?.getComputedTiming?.().endTime;
      const now = (a.currentTime || 0) + ms;
      if (Number.isFinite(end) && now >= end) { try { a.finish(); } catch {} continue; }
      a.currentTime = now;
    }
  }

  window.__step = (ms = 1000 / 30) => {
    const until = vt + ms;
    runTimers(until);
    vt = until;
    const q = raf;
    raf = new Map();
    const t = performance.now();
    for (const cb of q.values()) { try { cb(t); } catch (e) { console.error(e); } }
    stepAnimations(ms);
    return vt;
  };
  window.__steps = (n, ms = 1000 / 30) => { for (let i = 0; i < n; i++) window.__step(ms); return vt; };
  window.__vt = () => vt;
})();
