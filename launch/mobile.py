"""Captures the mobile shot of the launch video: the office on a phone.

    /opt/homebrew/bin/python3.13 -I mobile.py [cinedir]

Run after cine.py, against the same sandbox (port 4399), so the phone sees
the office cine.py left behind: Ada's checkout fix shipped, the others done.
The real app runs in a 390x844 iframe, so it gets its own phone layout (the
office and the sidebar take turns over a bottom tab bar). The iframe sits in
a device frame on a 1920x804 stage, captured at 2x and scaled down so the
small type stays crisp. The iframe runs on the same virtual clock as the
film (vclock.js), stepped 1/60 s a frame.
"""
import os
import re
import shutil
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import GPU, HERE, URL, W, H, patch_bundle  # noqa: E402
from cine import clamp, ease, ease_out, fade, mix, span  # noqa: E402

CINE = sys.argv[1] if len(sys.argv) > 1 else '/tmp/office-demo/cine'
SHOT = '06b_mobile'
FPS = 60
SECONDS = 7.4
BG = os.path.join(CINE, '01_open', '00419.jpg')     # the office from above, blurred behind
PW, PH, SCALE = 390, 844, 0.87                       # the phone viewport, and its size on stage

STAGE = f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: 'Inter Variable'; font-weight: 100 900; src: url(/assets/{{INTER}}) format('woff2-variations'); }}
html, body {{ margin: 0; width: {W}px; height: {H}px; overflow: hidden; background: #efe7dc; }}
#bg {{ position: absolute; inset: -40px; background: url(/__bg.jpg) center / cover; filter: blur(26px) saturate(0.9); opacity: 0.75; }}
#wash {{ position: absolute; inset: 0; background: radial-gradient(ellipse at 66% 50%, rgba(252,248,241,0.55), rgba(240,232,220,0.9)); }}
#title {{ position: absolute; left: 190px; top: 50%; transform: translateY(-50%); color: #1d1b18; opacity: 0;
  font: 640 76px/1.04 'Inter Variable', Inter, sans-serif; white-space: nowrap; }}
#title small {{ display: block; margin-top: 22px; font: 450 30px/1.3 'Inter Variable', Inter, sans-serif; color: #5b5348; letter-spacing: -0.005em; }}
#phone {{ position: absolute; left: 1230px; top: 50%; width: {PW + 28}px; height: {PH + 28}px; box-sizing: border-box;
  transform-origin: 50% 50%; padding: 14px; border-radius: 62px; background: #1d1b18;
  box-shadow: 0 0 0 2px #3a3530 inset, 0 40px 80px -30px rgba(40, 28, 15, 0.55), 0 12px 30px -12px rgba(40, 28, 15, 0.35); }}
#phone iframe {{ display: block; width: {PW}px; height: {PH}px; border: 0; border-radius: 48px; background: #fbf9f5; }}
#island {{ position: absolute; left: 50%; top: 26px; width: 118px; height: 34px; margin-left: -59px; border-radius: 20px; background: #0d0c0b; z-index: 2; }}
#touch {{ position: absolute; left: 0; top: 0; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; z-index: 5;
  background: rgba(29, 27, 24, 0.22); box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85); opacity: 0; pointer-events: none; }}
</style></head><body>
<div id="bg"></div><div id="wash"></div>
<div id="title">Check in from<br>your phone.<small>The whole office, in your pocket.</small></div>
<div id="phone"><div id="island"></div><iframe id="app" src="/"></iframe></div>
<div id="touch"></div>
</body></html>'''

# Inside the phone: hide the machine-specific meters (as the film does), and
# a camera rig like cine.js's, so the office view moves rather than sits.
INNER = '''(() => {
  const css = document.createElement('style');
  // What env(safe-area-inset-top) gives on a real phone, which an iframe can't.
  css.textContent = '#usage, #load, .hint, .toasts, .toast, #toast { display: none !important; }'
    + ' .hud { top: 54px !important; } .side { padding-top: 44px !important; } .detail { padding-top: 58px !important; }';
  document.head.appendChild(css);
  const o = window.__office, cam = o.camera, controls = o.controls;
  Object.assign(controls, { enabled: false, enableDamping: false, minDistance: 0.05, maxDistance: 2000, minPolarAngle: 0, maxPolarAngle: Math.PI });
  let rig = null;
  window.__rig = (r) => { rig = r; };
  window.__preRender = () => {
    if (!rig) return;
    const [lx, ly, lz] = rig.look, { r, phi, theta } = rig;
    cam.position.set(lx + r * Math.sin(phi) * Math.sin(theta), ly + r * Math.cos(phi), lz + r * Math.sin(phi) * Math.cos(theta));
    cam.lookAt(lx, ly, lz);
    if (cam.fov !== rig.fov) { cam.fov = rig.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    controls.target.set(lx, 0, lz);
  };
})();'''


def main():
    out = os.path.join(CINE, SHOT)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    inter = next(f for f in os.listdir('/tmp/office-demo/app/dist/assets') if f.startswith('inter-latin-wght'))
    stage = STAGE.replace('{INTER}', inter)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=GPU)
        ctx = browser.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2, has_touch=True)
        ctx.add_init_script(path=os.path.join(HERE, 'vclock.js'))

        def bundle(r):
            resp = r.fetch()
            r.fulfill(response=resp, body=patch_bundle(resp.text()), headers={**resp.headers, 'cache-control': 'no-store'})
        ctx.route(re.compile(r'.*/assets/index-[^/]+\.js$'), bundle)
        ctx.route(re.compile(r'.*/sw\.js$'), lambda r: r.fulfill(status=404, body=''))
        ctx.route(f'{URL}/__stage', lambda r: r.fulfill(status=200, content_type='text/html', body=stage))
        ctx.route(f'{URL}/__bg.jpg', lambda r: r.fulfill(status=200, content_type='image/jpeg', body=open(BG, 'rb').read()))

        page = ctx.new_page()
        page.on('console', lambda m: m.type == 'error' and '404' not in m.text and print('  page error:', m.text, flush=True))
        page.goto(f'{URL}/__stage', wait_until='domcontentloaded')
        fr = page.frame_locator('#app')
        fr.locator('.agent-label').first.wait_for()
        app = next(f for f in page.frames if f.url.rstrip('/') == URL)
        app.wait_for_function('() => !!window.__office && !!window.__office.app')
        app.evaluate(INNER)
        app.evaluate('() => document.fonts.ready')
        page.evaluate('() => document.fonts.ready')
        app.evaluate('k => __steps(k)', 90)

        ada = app.evaluate("() => [...__office.app.jobs.values()].filter(j => j.agentId === 'ada').pop().id")

        def screen_xy(sel):
            """Where an element inside the phone sits on the stage."""
            b = app.locator(sel).first.bounding_box()      # page coordinates, transform included
            return [b['x'] + b['width'] / 2, b['y'] + b['height'] / 2]

        # The camera: over the desks, drifting round toward the pool table.
        # Framed on wherever the team is right now (after shipping they drift
        # to the lounge and the pool table), pushing in and drifting round.
        cx, cz = app.evaluate('''() => { const a = [...__office.app.agents.values()].map(a => a.pos);
          const near = (p) => a.filter(q => Math.hypot(q.x - p.x, q.z - p.z) < 7);
          const c = near(a.reduce((b, p) => near(p).length > near(b).length ? p : b, a[0]));
          return [c.reduce((s, p) => s + p.x, 0) / c.length, c.reduce((s, p) => s + p.z, 0) / c.length]; }''')
        print(f'  team centred at {cx:.1f}, {cz:.1f}', flush=True)
        C0 = {'look': [cx, 0.8, cz], 'r': 30, 'phi': 0.92, 'theta': 0.10, 'fov': 30}
        C1 = {'look': [cx, 0.8, cz], 'r': 24, 'phi': 0.98, 'theta': 0.42, 'fov': 30}
        taps = [(2.55, '#mnav [data-m="jobs"]'), (4.0, f'#jobsPane .job[data-id="{ada}"]'), (5.35, '#changes .c-head')]
        touch = {'xy': None, 'at': -9}
        n = int(SECONDS * FPS)
        ti = 0
        for f in range(n):
            t = f / FPS
            while ti < len(taps) and taps[ti][0] <= t:
                sel = taps[ti][1]
                touch['xy'] = screen_xy(sel)
                touch['at'] = t
                app.locator(sel).first.click()
                ti += 1
            rig = {k: (mix(C0[k], C1[k], ease(t / 2.6)) if k != 'fov' else 30) for k in C0}
            up = ease_out(span(t, 0.0, 0.9))
            tf = fade(t, 0.35, 1.0, 6.6, 7.2)
            tk = ease_out(span(t, 0.35, 3.2))
            dt = t - touch['at']
            ta = clamp(1 - abs(dt - 0.12) / 0.3) if 0 <= dt < 0.45 else 0
            page.evaluate('''([tf, tk, up, scale, touch, ta]) => {
                const ti = document.getElementById('title');
                ti.style.opacity = tf; ti.style.letterSpacing = `${(0.12 - 0.14 * tk).toFixed(4)}em`;
                ti.style.filter = `blur(${((1 - tf) * 6).toFixed(2)}px)`;
                const ph = document.getElementById('phone');
                ph.style.transform = `translateY(calc(-50% + ${(1 - up) * 60}px)) scale(${scale})`;
                ph.style.opacity = Math.min(1, up * 1.6);
                const d = document.getElementById('touch');
                if (touch) { d.style.left = touch[0] + 'px'; d.style.top = touch[1] + 'px'; }
                d.style.opacity = ta; d.style.transform = `scale(${0.7 + 0.3 * ta})`;
            }''', [tf, tk, up, SCALE, touch['xy'], ta])
            app.evaluate('([rig, step]) => { __rig(rig); __step(step); }', [rig, 1000 / FPS])
            png = page.screenshot(type='png')
            Image.open(__import__('io').BytesIO(png)).convert('RGB').resize((W, H), Image.LANCZOS) \
                .save(os.path.join(out, f'{f:05d}.jpg'), quality=95)
        browser.close()
    print(f'{SHOT}: {n} frames')


if __name__ == '__main__':
    main()
