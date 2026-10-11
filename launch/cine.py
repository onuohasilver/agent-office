"""Captures the cinematic launch-video shots, frame by frame at 60 fps.

    ./setup.sh                                   # reset the sandbox (port 4399)
    /opt/homebrew/bin/python3.13 -I cine.py [outdir]

Each shot is a contiguous run of frames in <outdir>/<nn_name>/. The page runs
on a virtual clock (vclock.js), the camera is placed by our own rig every
frame (cine.js, via the hook harness.py adds), and the stub `claude` only takes
its next step when this script opens its gate. events.json records when the
sends, clicks and the ship happen, for the sound design.
"""
import io
import json
import math
import os
import shutil
import sys

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import HERE, open_office  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/office-demo/cine'
GATE = '/tmp/office-demo/gate'
FPS = 60


# ---------- easing and interpolation ----------

def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease(t):          # ease-in-out cubic
    t = clamp(t)
    return 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def ease_out(t):
    t = clamp(t)
    return 1 - (1 - t) ** 3


def ease_in(t):
    t = clamp(t)
    return t * t * t


def span(t, a, b):
    """0..1 progress of t through [a, b]."""
    return clamp((t - a) / (b - a)) if b > a else float(t >= b)


def mix(a, b, k):
    if isinstance(a, (list, tuple)):
        return [mix(x, y, k) for x, y in zip(a, b)]
    return a + (b - a) * k


def rig_mix(a, b, k):
    out = dict(a)
    for key in ('look', 'r', 'phi', 'theta', 'fov'):
        if key in a and key in b:
            out[key] = mix(a[key], b[key], k)
    return out


def fade(t, a_in, b_in, a_out, b_out):
    """Opacity: eased in over [a_in, b_in], out over [a_out, b_out]."""
    return ease_out(span(t, a_in, b_in)) * (1 - ease(span(t, a_out, b_out)))


# ---------- the director ----------

class Director:
    def __init__(self, page):
        self.p = page
        self.events = []
        self.shot = None
        self.n = 0
        self.ui = [0.0, 0.0, 0.0, 0.0]          # sidebar, drawer, focus px, wash
        self.title = (None, 0.0, 0.0)
        self.end = (0.0, 0.0, 0.0, 0.0)
        self.cur = [1300.0, 520.0]
        self.cur_a = 0.0
        self.press = 0
        self.speed = 1.0

    def begin(self, name):
        self.shot = name
        self.dir = os.path.join(OUT, name)
        shutil.rmtree(self.dir, ignore_errors=True)
        os.makedirs(self.dir)
        self.n = 0
        print(f'shot {name}', flush=True)

    def event(self, kind):
        self.events.append({'shot': self.shot, 'frame': self.n, 'kind': kind})

    def frame(self, rig, sub=1, rig_at=None):
        """Renders and saves one output frame (1/60 s), optionally as the
        average of `sub` sub-frames for motion blur on fast moves."""
        acc = None
        for s in range(sub):
            r = rig_at(s / sub) if (rig_at and sub > 1) else rig
            self.p.evaluate('''([rig, ui, title, end, cur, step]) => {
                __rig(rig); __ui(...ui); __title(...title); __end(...end); __cursor(...cur);
                __step(step);
            }''', [r, self.ui, list(self.title), list(self.end),
                   [self.cur[0], self.cur[1], self.cur_a, self.press > 0], 1000 / FPS / sub * self.speed])
            if sub == 1:
                self.p.screenshot(path=os.path.join(self.dir, f'{self.n:05d}.jpg'), type='jpeg', quality=95)
            else:
                img = np.asarray(Image.open(io.BytesIO(self.p.screenshot(type='png'))).convert('RGB'), dtype=np.float32)
                acc = img if acc is None else acc + img
        if sub > 1:
            Image.fromarray((acc / sub).round().astype(np.uint8)).save(os.path.join(self.dir, f'{self.n:05d}.jpg'), quality=95)
        if self.press:
            self.press -= 1
        self.n += 1

    def ff(self, seconds):
        steps = int(seconds * 30)
        while steps > 0:
            k = min(10, steps)
            self.p.evaluate('k => __steps(k)', k)
            self.p.wait_for_timeout(15)
            steps -= k

    @staticmethod
    def gate(name, steps):
        with open(os.path.join(GATE, name), 'w') as f:
            f.write(str(steps))

    def center(self, selector):
        b = self.p.locator(selector).first.bounding_box()
        return [b['x'] + b['width'] / 2, b['y'] + b['height'] / 2]


def run_shot(d, name, seconds, rig_fn, cues=(), overlay=None, whips=()):
    """rig_fn(t) -> rig dict; cues: [(t, fn)] fired once when reached;
    overlay(t) sets d.ui/d.title/...; whips: [(t0, t1)] get 4x sub-frames."""
    d.begin(name)
    cues = sorted(cues, key=lambda c: c[0])
    ci = 0
    n = int(round(seconds * FPS))
    for f in range(n):
        t = f / FPS
        while ci < len(cues) and cues[ci][0] <= t + 1e-9:
            cues[ci][1](t)
            ci += 1
        if overlay:
            overlay(t)
        whip = any(a <= t < b for a, b in whips)
        if whip:
            d.frame(None, sub=4, rig_at=lambda s, t=t: rig_fn(t + s / FPS))
        else:
            d.frame(rig_fn(t))
    print(f'  {n} frames', flush=True)


def send_quietly(d, text):
    """Sends a chat message off camera, making sure it really went."""
    p = d.p
    p.click('#input', force=True)
    p.keyboard.type(text + ' ')
    d.ff(0.3)
    for _ in range(5):
        if p.eval_on_selector('#ac', 'e => !e.hidden'):
            p.keyboard.press('Escape')
            d.ff(0.1)
        p.keyboard.press('Enter')
        d.ff(0.3)
        if p.input_value('#input') == '':
            p.evaluate('document.activeElement && document.activeElement.blur()')
            return
    raise RuntimeError(f'could not send: {text}')


# ---------- the film ----------

def film(d, claims):
    p = d.p

    # 1. Open: high above the office, settling into the iso view. "Hire a team."
    A = {'look': [0, 0, 1.5], 'r': 112, 'phi': 0.30, 'theta': 0.10, 'fov': 30}
    B = {'look': [-1, 0, 2.5], 'r': 66, 'phi': 0.80, 'theta': 0.66, 'fov': 28}

    def open_overlay(t):
        d.title = ('Hire a team.', fade(t, 1.4, 2.3, 5.0, 5.8), ease_out(span(t, 1.4, 5.2)))
    run_shot(d, '01_open', 7.0, lambda t: rig_mix(A, B, ease(t / 7.0)), overlay=open_overlay)
    d.title = (None, 0, 0)

    # 2. Crane down to the lounge: the team, idle. Ends on a whip to reception.
    L0 = {'look': [-14.6, 0.9, 9.0], 'r': 12.5, 'phi': 1.10, 'theta': 1.05, 'fov': 30}
    L1 = {'look': [-14.6, 0.9, 9.0], 'r': 9.5, 'phi': 1.20, 'theta': 0.62, 'fov': 30}

    def lounge(t):
        r = rig_mix(L0, L1, ease_out(t / 4.75))
        u = span(t, 4.75, 5.0)
        r['theta'] = r['theta'] - 1.3 * ease_in(u)
        return r
    run_shot(d, '02_lounge', 5.0, lounge, whips=[(4.75, 5.0)])

    # 3. Reception: "Hand over the work." The chat floats in, a message is
    # typed (speed-ramped), sent, and the chief routes it.
    R0 = {'look': [15.2, 1.05, 9.6], 'r': 8.6, 'phi': 1.13, 'theta': 0.42, 'fov': 30}
    R1 = {'look': [15.2, 1.05, 9.6], 'r': 6.8, 'phi': 1.15, 'theta': 0.62, 'fov': 30}

    def recep(t):
        r = rig_mix(R0, R1, ease(t / 7.2))
        r['theta'] += 1.2 * (1 - ease_out(span(t, 0, 0.3)))   # the whip lands
        return r

    msg = 'The checkout button gets cut off on small phones. Can someone fix it?'
    typed = {'i': 0}

    def recep_overlay(t):
        d.title = ('Hand over the work.', fade(t, 0.45, 1.05, 2.15, 2.7), ease_out(span(t, 0.45, 2.5)))
        k = ease(span(t, 2.55, 2.95)) * (1 - ease(span(t, 4.75, 5.2)))
        d.ui = [k, 0, 6 * k, 0]
        d.cur_a = ease_out(span(t, 2.6, 2.85)) * (1 - ease(span(t, 4.65, 4.9)))
        if 2.6 <= t <= 2.95:   # glide to the composer
            x0, y0 = 760, 520
            x1, y1 = d.center('#input')
            q = ease(span(t, 2.6, 2.95))
            d.cur = [mix(x0, x1 - 60, q), mix(y0, y1, q)]
        if 3.05 <= t <= 4.35:  # ~55 characters a second
            want = int(len(msg) * span(t, 3.05, 4.3))
            if want > typed['i']:
                p.keyboard.type(msg[typed['i']:want])
                typed['i'] = want

    def click_input(t):
        d.press = 6
        p.mouse.click(*d.center('#input'))
        d.event('click')

    def send(t):
        if typed['i'] < len(msg):
            p.keyboard.type(msg[typed['i']:])
        p.keyboard.press('Enter')
        d.event('send')

    def blur_input(t):
        p.evaluate('document.activeElement && document.activeElement.blur()')

    def route(t):
        d.gate('chief', 1)
        d.event('route')
    run_shot(d, '03_ask', 7.2, recep, overlay=recep_overlay,
             cues=[(2.95, click_input), (4.45, send), (4.9, blur_input), (5.6, route)], whips=[(0, 0.3)])
    d.ui = [0, 0, 0, 0]
    d.title = (None, 0, 0)
    assert p.input_value('#input') == '', 'the chief message did not send'

    # 4. Follow Ada to her desk, speed-ramped through the walk.
    def walk(t):
        return {'look': [0, 0.95, 0], 'follow': 'ada', 'fw': 1, 'k': 0.07,
                'r': mix(7.8, 6.2, ease(t / 4.6)), 'phi': 1.2, 'theta': mix(1.25, 0.55, ease(t / 4.6)), 'fov': 30}

    def walk_overlay(t):
        d.speed = 1 + 0.6 * math.sin(math.pi * span(t, 0.2, 2.6))
    run_shot(d, '04_walk', 4.6, walk, overlay=walk_overlay, cues=[(3.0, lambda t: d.gate('ada', 1))])
    d.speed = 1.0

    # Off camera: the rest of the team gets work; the floor fills up.
    send_quietly(d, '@Mira #docs-site add the 2.4.0 changelog entry')
    send_quietly(d, '@Tunde #payments-api retry failed webhook sends')
    d.ff(1.5)
    d.gate('ada', 3)
    d.gate('mira', 1)
    d.gate('tunde', 1)
    d.ff(5)

    # 5. "Watch it get done." Close on Ada at work, a whip to the row of desks.
    W0 = {'look': [-9, 1.0, -1.95], 'r': 5.4, 'phi': 1.17, 'theta': 0.12, 'fov': 30}
    W1 = {'look': [-9, 1.0, -1.95], 'r': 4.6, 'phi': 1.12, 'theta': 0.50, 'fov': 30}
    W2 = {'look': [-2.6, 1.0, -1.95], 'r': 8.0, 'phi': 1.16, 'theta': 0.30, 'fov': 30}
    W3 = {'look': [1.8, 1.0, -1.95], 'r': 7.4, 'phi': 1.14, 'theta': 0.12, 'fov': 30}

    def work(t):
        if t < 3.6:
            return rig_mix(W0, W1, ease(t / 3.6))
        if t < 3.95:
            u = span(t, 3.6, 3.95)
            r = rig_mix(W1, W2, ease(u))
            r['theta'] += 0.7 * math.sin(math.pi * u)
            return r
        return rig_mix(W2, W3, ease(span(t, 3.95, 8.4)))

    def work_overlay(t):
        d.title = ('Watch it get done.', fade(t, 0.4, 1.0, 2.6, 3.1), ease_out(span(t, 0.4, 2.9)))
    run_shot(d, '05_work', 8.4, work, overlay=work_overlay, whips=[(3.6, 3.95)], cues=[
        (0.5, lambda t: d.gate('ada', 4)), (2.3, lambda t: d.gate('ada', 5)),
        (4.4, lambda t: d.gate('tunde', 2)), (5.0, lambda t: d.gate('mira', 2)),
        (6.2, lambda t: d.gate('tunde', 3)), (6.9, lambda t: d.gate('mira', 3))])
    d.title = (None, 0, 0)

    d.gate('ada', 6)
    d.ff(1.5)

    # 6. The payoff: Ada ships. Then what changed, with the office behind it
    # softening as the job drawer comes forward.
    S0 = {'look': [-9, 1.1, -1.95], 'r': 4.9, 'phi': 1.14, 'theta': 0.55, 'fov': 30}
    S1 = {'look': [-9, 1.1, -1.95], 'r': 3.9, 'phi': 1.16, 'theta': 0.78, 'fov': 30}
    shipped = {'at': None}

    def ship_overlay(t):
        if shipped['at'] is None and t > 1.0 and p.evaluate(
                "() => [...__office.app.jobs.values()].some(j => j.agentId === 'ada' && j.status === 'done')"):
            shipped['at'] = t
            d.event('ship')
        k = ease(span(t, 3.7, 4.15)) * (1 - ease(span(t, 7.7, 8.2)))
        d.ui = [0, k, 6 * k, 0]
        d.cur_a = ease_out(span(t, 4.4, 4.65)) * (1 - ease(span(t, 6.6, 6.9)))
        if 4.4 <= t <= 5.0:
            q = ease(span(t, 4.45, 4.95))
            x1, y1 = d.center('#changes .c-head')
            d.cur = [mix(1180, x1 - 40, q), mix(560, y1, q)]

    def open_drawer(t):
        p.evaluate("() => { const j = [...__office.app.jobs.values()].find(j => j.agentId === 'ada'); __office.app.openJob(j.id); }")

    def expand(t):
        d.press = 6
        p.mouse.click(*d.center('#changes .c-head'))
        d.event('click')
    run_shot(d, '06_ship', 8.6, lambda t: rig_mix(S0, S1, ease(t / 8.6)), overlay=ship_overlay, cues=[
        (0.2, lambda t: d.gate('ada', 7)), (1.6, lambda t: d.gate('ada', 8)),
        (3.55, open_drawer), (5.0, expand)])
    d.ui = [0, 0, 0, 0]
    d.cur_a = 0

    # Off camera: the other two ship (the XP brings a new hire, Kai), and we
    # wait until two idle agents get a game of pool going.
    p.click('#detail .x', force=True)
    d.gate('mira', 4)
    d.gate('tunde', 4)
    d.ff(1)
    d.gate('tunde', 5)
    d.ff(3)
    granted = lambda: len([c for c in claims if c.get('game') and c.get('id')])
    before, waited = granted(), 0
    while granted() == before and waited < 400:
        d.ff(1)
        waited += 1
    print(f'  pool game granted after {waited}s', flush=True)
    d.ff(1.0)

    # 7. A beat of calm at the pool table, then the crane up to the end card.
    P0 = {'look': [7.6, 0.85, 10.9], 'r': 10.0, 'phi': 1.12, 'theta': -0.30, 'fov': 30}
    P1 = {'look': [7.6, 0.85, 10.9], 'r': 8.2, 'phi': 1.18, 'theta': -0.78, 'fov': 30}
    E1 = {'look': [0, 0, 1.0], 'r': 92, 'phi': 0.52, 'theta': -0.15, 'fov': 30}

    def calm(t):
        if t < 8.0:
            return rig_mix(P0, P1, ease(t / 8.0))
        return rig_mix(P1, E1, ease(span(t, 8.0, 15.5)))

    def calm_overlay(t):
        d.title = ('Take a break.', fade(t, 1.0, 1.6, 3.4, 3.95), ease_out(span(t, 1.0, 3.6)))
        w = ease(span(t, 9.4, 11.0))
        d.ui = [0, 0, 5 * w, w]
        d.end = (ease_out(span(t, 10.2, 11.1)), ease_out(span(t, 11.2, 11.8)), ease_out(span(t, 11.9, 12.5)),
                 ease_out(span(t, 10.2, 13.0)))
    run_shot(d, '07_break_end', 15.5, calm, overlay=calm_overlay)


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    with sync_playwright() as pw:
        claims = []
        browser, page = open_office(pw, lambda m: m.type == 'error' and '404' not in m.text and print('  page error:', m.text, flush=True))

        def on_response(r):
            if r.url.endswith('/api/chill') and r.request.method == 'POST':
                try:
                    claims.append({**json.loads(r.request.post_data or '{}'), 'id': r.json().get('id')})
                except Exception:
                    pass
        page.on('response', on_response)
        page.add_script_tag(path=os.path.join(HERE, 'cine.js'))
        d = Director(page)
        d.ff(3)
        film(d, claims)
        with open(os.path.join(OUT, 'events.json'), 'w') as f:
            json.dump(d.events, f, indent=1)
        browser.close()
    print('done', OUT)


if __name__ == '__main__':
    main()
