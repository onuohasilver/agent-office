// Injected after load: the lower-third caption and a visible cursor, both
// drawn per frame by the capture script (window.__cap / window.__cursor).
// Also hides what shouldn't be in a launch video: the controls hint (the
// captions take its place), and the plan-usage and host CPU/memory meters,
// which read this machine and its Claude login rather than the sandbox.
(() => {
  const css = document.createElement('style');
  css.textContent = `
    #usage, #load, .hint { display: none !important; }
    #lt-cap {
      position: absolute; left: 50%; bottom: 44px; z-index: 60; pointer-events: none;
      transform: translate(-50%, 10px); opacity: 0; white-space: nowrap;
      font: 500 26px/1.25 var(--sans, 'Inter Variable', Inter, sans-serif); letter-spacing: -0.012em;
      color: #1d1b18; background: rgba(255, 253, 249, 0.92);
      padding: 15px 26px 16px; border-radius: 16px;
      box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 10px 30px -12px rgba(60, 45, 25, 0.35), 0 0 0 1px rgba(60, 45, 25, 0.07);
    }
    #lt-cap code { font: 500 0.86em/1 var(--mono, 'JetBrains Mono', monospace); background: rgba(29,27,24,0.07); padding: 3px 7px; border-radius: 6px; }
    #lt-cursor {
      position: fixed; left: 0; top: 0; z-index: 9999; pointer-events: none; width: 26px; height: 26px;
      transform-origin: 3px 2px; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.28)); opacity: 0;
    }`;
  document.head.appendChild(css);

  const cap = document.createElement('div');
  cap.id = 'lt-cap';
  document.getElementById('view').appendChild(cap);
  let capText = null;
  window.__cap = (html, a) => {
    if (html !== capText) { cap.innerHTML = html || ''; capText = html; }
    const k = Math.max(0, Math.min(1, a || 0));
    cap.style.opacity = String(k);
    cap.style.transform = `translate(-50%, ${(1 - k) * 10}px)`;
  };

  const cur = document.createElement('div');
  cur.id = 'lt-cursor';
  cur.innerHTML = '<svg viewBox="0 0 26 26" width="26" height="26"><path d="M3 2 L3 21 L8.2 16.4 L11.6 24 L15 22.5 L11.7 15 L18.6 15 Z" fill="#1d1b18" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cur);
  window.__cursor = (x, y, a, press) => {
    cur.style.opacity = String(a);
    cur.style.transform = `translate(${x - 3}px, ${y - 2}px) scale(${press ? 0.86 : 1})`;
  };
})();
