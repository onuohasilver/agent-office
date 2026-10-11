// Injected after the office loads (see harness.py). Turns the app into a
// film set:
//  * window.__rig({...}) places the camera every frame: a look-at point
//    (optionally following an agent, smoothed), spherical r/phi/theta, fov.
//  * The sidebar and job drawer float over a full-bleed office instead of
//    taking columns, so they can fade in and out (--ui, --ui2) while the office
//    behind softens (--focus, a rack-focus feel) with no reflow.
//  * __title / __end draw the big centered type; __cursor a pointer.
// Hidden throughout: the HUD chips, the controls hint, toasts, and the plan
// usage / host CPU meters (they read this machine, not the sandbox).
(() => {
  const o = window.__office;
  const cam = o.camera, controls = o.controls;
  Object.assign(controls, { enabled: false, enableDamping: false, minDistance: 0.05, maxDistance: 2000, minPolarAngle: 0, maxPolarAngle: Math.PI });

  const css = document.createElement('style');
  css.textContent = `
    :root { --ui: 0; --ui2: 0; --focus: 0px; --wash: 0; }
    .app { display: block !important; position: relative; height: 100vh; overflow: hidden; }
    .view { position: absolute !important; inset: 0; }
    .side {
      position: absolute !important; left: 0; top: 0; bottom: 0; width: 400px; z-index: 40;
      opacity: var(--ui); transform: translateX(calc((1 - var(--ui)) * -24px));
      box-shadow: 0 0 60px -10px rgba(60, 45, 25, 0.35); border-right: 0 !important;
    }
    .detail {
      position: absolute !important; right: 0; top: 0; bottom: 0; z-index: 40; width: 460px !important;
      opacity: var(--ui2); transform: translateX(calc((1 - var(--ui2)) * 24px));
      box-shadow: 0 0 60px -10px rgba(60, 45, 25, 0.35);
    }
    .hud, .hint, #usage, #load, .toasts, .toast, #toast { display: none !important; }
    #stage { filter: blur(var(--focus)); transform: scale(calc(1 + var(--wash) * 0.02)); }
    #labels { filter: blur(var(--focus)); }
    .agent-label .name { font-size: 15px !important; padding: 3px 10px 3px 8px !important; }
    .agent-label .name i { width: 9px !important; height: 9px !important; }
    .bubble { font-size: 16px !important; max-width: 260px !important; padding: 7px 12px !important; border-radius: 14px !important; }
    #cine-wash { position: absolute; inset: 0; z-index: 30; pointer-events: none; opacity: var(--wash);
      background: radial-gradient(ellipse at 50% 50%, rgba(252, 248, 241, 0.92), rgba(240, 232, 220, 0.82)); }
    #cine-title {
      position: absolute; left: 50%; top: 50%; z-index: 60; pointer-events: none; white-space: nowrap;
      transform: translate(-50%, -50%); opacity: 0;
      font: 640 76px/1.05 'Inter Variable', Inter, sans-serif; color: #1d1b18;
      text-shadow: 0 0 40px rgba(255, 249, 240, 0.95), 0 0 14px rgba(255, 249, 240, 0.8);
    }
    #cine-end { position: absolute; inset: 0; z-index: 61; pointer-events: none; display: grid; place-content: center; text-align: center; color: #1d1b18; }
    #cine-end h1 { margin: 0; font: 680 104px/1 'Inter Variable', Inter, sans-serif; opacity: 0; }
    #cine-end p { margin: 22px 0 0; font: 450 30px/1.3 'Inter Variable', Inter, sans-serif; color: #5b5348; opacity: 0; letter-spacing: -0.005em; }
    #cine-end code { display: inline-block; margin-top: 46px; padding: 16px 28px; border-radius: 14px; opacity: 0;
      font: 500 30px/1 'JetBrains Mono', ui-monospace, monospace; color: #fbf9f5; background: #1d1b18;
      box-shadow: 0 18px 40px -18px rgba(29, 27, 24, 0.6); }
    #lt-cursor { position: fixed; left: 0; top: 0; z-index: 9999; pointer-events: none; width: 30px; height: 30px;
      transform-origin: 3px 2px; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.28)); opacity: 0; }`;
  document.head.appendChild(css);

  const view = document.getElementById('view');
  const wash = Object.assign(document.createElement('div'), { id: 'cine-wash' });
  const title = Object.assign(document.createElement('div'), { id: 'cine-title' });
  const end = Object.assign(document.createElement('div'), { id: 'cine-end' });
  end.innerHTML = '<h1>Agent Office</h1><p>A tiny office where your Claude agents actually work.</p><div><code>npm install &amp;&amp; npm start</code></div>';
  view.append(wash, title, end);
  const cur = Object.assign(document.createElement('div'), { id: 'lt-cursor' });
  cur.innerHTML = '<svg viewBox="0 0 26 26" width="30" height="30"><path d="M3 2 L3 21 L8.2 16.4 L11.6 24 L15 22.5 L11.7 15 L18.6 15 Z" fill="#1d1b18" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cur);

  const root = document.documentElement.style;
  window.__ui = (ui, ui2, focus, washA) => {
    root.setProperty('--ui', ui); root.setProperty('--ui2', ui2);
    root.setProperty('--focus', `${focus}px`); root.setProperty('--wash', washA);
  };

  let titleText = null;
  // a: opacity 0..1; k: 0..1 progress of the tracking-in (wide to tight).
  window.__title = (text, a, k) => {
    if (text !== titleText) { title.textContent = text || ''; titleText = text; }
    title.style.opacity = a;
    title.style.letterSpacing = `${(0.16 - 0.185 * k).toFixed(4)}em`;
    title.style.filter = `blur(${((1 - a) * 6).toFixed(2)}px)`;
  };
  window.__end = (h, p, c, track) => {
    const [eh, ep, ec] = end.children;
    eh.style.opacity = h; eh.style.letterSpacing = `${(0.12 - 0.15 * track).toFixed(4)}em`;
    eh.style.filter = `blur(${((1 - h) * 8).toFixed(2)}px)`;
    ep.style.opacity = p; ep.style.transform = `translateY(${(1 - p) * 10}px)`;
    end.querySelector('code').style.opacity = c;
    end.querySelector('code').style.transform = `translateY(${(1 - c) * 12}px)`;
  };
  window.__cursor = (x, y, a, press) => {
    cur.style.opacity = a;
    cur.style.transform = `translate(${x - 3}px, ${y - 2}px) scale(${press ? 0.86 : 1})`;
  };

  // ---------- the camera rig ----------
  let rig = null;
  const smooth = {};
  window.__rig = (r) => { rig = r; };
  function subject(id) {
    if (id === 'chief') return o.chief;
    return o.app.agents.get(id);
  }
  function place() {
    if (!rig) return;
    let [lx, ly, lz] = rig.look;
    if (rig.follow) {
      const a = subject(rig.follow);
      if (a) {
        const s = (smooth[rig.follow] ||= { x: a.pos.x, z: a.pos.z });
        if (!rig.held) { s.x += (a.pos.x - s.x) * (rig.k ?? 0.08); s.z += (a.pos.z - s.z) * (rig.k ?? 0.08); }
        const w = rig.fw ?? 1;
        lx = lx * (1 - w) + (s.x + (rig.off?.[0] || 0)) * w;
        lz = lz * (1 - w) + (s.z + (rig.off?.[2] || 0)) * w;
      }
    }
    const { r, phi, theta } = rig;
    cam.position.set(lx + r * Math.sin(phi) * Math.sin(theta), ly + r * Math.cos(phi), lz + r * Math.sin(phi) * Math.cos(theta));
    cam.lookAt(lx, ly, lz);
    if (rig.fov && cam.fov !== rig.fov) { cam.fov = rig.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    // Keep the app's own controls agreeing, so steer() leaves it alone and
    // the walls nearest the lens drop as they would for a user.
    controls.target.set(lx, 0, lz);
  }
  window.__preRender = place;
  window.__subject = (id) => { const a = subject(id); return a ? [a.pos.x, a.pos.y, a.pos.z] : null; };
})();
