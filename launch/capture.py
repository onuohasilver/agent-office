"""Captures the office scenes of the launch video, frame by frame.

Run setup.sh first (it resets the sandbox on port 4399), then:
    /opt/homebrew/bin/python3.13 -I capture.py [outdir]

The page runs on a virtual clock (vclock.js): each captured frame advances
it exactly 1/30 s, so motion is smooth however long a frame takes to render.
The stub `claude` (stub.mjs) only takes its next step when this script
writes to its gate file, so the work happens on cue.
"""
import json
import math
import os
import shutil
import sys
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'http://localhost:4399'          # the sandbox, never the live office
GATE = '/tmp/office-demo/gate'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/office-demo/frames'
DT = 1000 / 30
GPU = ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']


def ease_out(t):
    return 1 - (1 - t) ** 3


def ease_in_out(t):
    return 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


class Director:
    def __init__(self, page):
        self.p = page
        self.dir = None
        self.n = 0
        self.total = 0
        self.cap = None           # (html, first frame, frames)
        self.cur = [1180.0, 700.0]
        self.cur_a = 0.0
        self.press = 0

    # ---------- scenes and frames ----------

    def scene(self, name):
        self.dir = os.path.join(OUT, name)
        shutil.rmtree(self.dir, ignore_errors=True)
        os.makedirs(self.dir)
        self.n = 0
        self.cap = None
        print(f'scene {name}', flush=True)

    def cut(self):
        print(f'  {self.n} frames', flush=True)
        self.dir = None
        self.cap = None

    def caption(self, html, seconds):
        self.cap = (html, self.n, int(seconds * 30))

    def cap_alpha(self):
        if not self.cap:
            return None, 0
        html, start, length = self.cap
        f = self.n - start
        fade = 10
        if f < 0 or f >= length:
            return html, 0
        a = ease_out(min(1, f / fade)) * (1 - ease_out(max(0, (f - (length - fade)) / fade)))
        return html, a

    def tick(self, k=1, hook=None):
        for _ in range(k):
            if hook:
                hook()
            html, a = self.cap_alpha()
            self.p.evaluate('([h, a, x, y, ca, pr]) => { __step(); __cap(h, a); __cursor(x, y, ca, pr); }',
                            [html, a, self.cur[0], self.cur[1], self.cur_a, self.press > 0])
            if self.press:
                self.press -= 1
            if self.dir:
                self.p.screenshot(path=os.path.join(self.dir, f'{self.n:05d}.jpg'), type='jpeg', quality=94)
                self.n += 1
                self.total += 1

    def seconds(self, s, hook=None):
        self.tick(int(round(s * 30)), hook)

    def ff(self, seconds):
        """Fast-forward without capturing, letting network events land."""
        steps = int(seconds * 30)
        while steps > 0:
            k = min(10, steps)
            self.p.evaluate('k => __steps(k)', k)
            self.p.wait_for_timeout(15)
            steps -= k

    # ---------- the stub ----------

    @staticmethod
    def gate(name, steps):
        with open(os.path.join(GATE, name), 'w') as f:
            f.write(str(steps))

    # ---------- the cursor ----------

    def show_cursor(self, frames=8):
        for i in range(frames):
            self.cur_a = ease_out((i + 1) / frames)
            self.tick()

    def hide_cursor(self, frames=8):
        for i in range(frames):
            self.cur_a = 1 - ease_out((i + 1) / frames)
            self.tick()

    def move(self, x, y, frames=14):
        x0, y0 = self.cur
        for i in range(frames):
            k = ease_in_out((i + 1) / frames)
            self.cur = [x0 + (x - x0) * k, y0 + (y - y0) * k]
            self.p.mouse.move(*self.cur)
            self.tick()

    def center(self, selector):
        b = self.p.locator(selector).first.bounding_box()
        return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2

    def click(self, selector=None, xy=None, frames=14, dbl=False):
        x, y = xy or self.center(selector)
        self.move(x, y, frames)
        self.tick(3)
        self.press = 5
        if dbl:
            self.p.mouse.dblclick(x, y)
        else:
            self.p.mouse.click(x, y)
        self.tick(1)

    def type(self, text, cps=26):
        """Types at roughly `cps` characters a second, a few keys per frame."""
        acc = 0.0
        for ch in text:
            if ch == '\t':
                self.p.keyboard.press('Tab')
            else:
                self.p.keyboard.type(ch)
            acc += 30 / cps
            while acc >= 1:
                self.tick()
                acc -= 1

    # ---------- the camera, through the app's own controls ----------

    def wheel(self, x, y, dy, frames):
        """Scroll-zoom toward (x, y), spread over `frames` frames."""
        self.p.mouse.move(x, y)
        for i in range(frames):
            self.p.mouse.wheel(0, dy)
            self.tick()

    def orbit(self, x, y, dx, frames, hook=None):
        """Right-drag by dx pixels over `frames` frames, with easing."""
        self.p.mouse.move(x, y)
        self.p.mouse.down(button='right')
        for i in range(frames):
            k = ease_in_out((i + 1) / frames)
            self.p.mouse.move(x + dx * k, y)
            self.tick(hook=hook)
        self.p.mouse.up(button='right')

    def label_xy(self, name):
        """Where an agent's name label sits on screen (above their head)."""
        return self.p.evaluate('''name => {
          const el = [...document.querySelectorAll('.agent-label')].find(l => l.querySelector('.name')?.textContent.trim() === name);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return [r.x + r.width / 2, r.bottom];
        }''', name)


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=GPU)
        ctx = browser.new_context(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
        ctx.add_init_script(path=os.path.join(HERE, 'vclock.js'))
        page = ctx.new_page()
        page.on('console', lambda m: m.type == 'error' and print('  page error:', m.text, flush=True))
        claims = []
        def on_response(r):
            if r.url.endswith('/api/chill') and r.request.method == 'POST':
                try:
                    claims.append({**json.loads(r.request.post_data or '{}'), 'id': r.json().get('id')})
                except Exception:
                    pass
        page.on('response', on_response)
        page.goto(URL, wait_until='domcontentloaded')
        page.wait_for_selector('.agent-label')
        page.add_script_tag(path=os.path.join(HERE, 'overlay.js'))
        d = Director(page)
        d.ff(3)
        run(d, claims)
        browser.close()
    print(f'{d.total} frames in {OUT}')


def send_quietly(d, text):
    """Sends a chat message off camera, making sure it really went."""
    p = d.p
    p.click('#input')
    p.keyboard.type(text + ' ')
    d.ff(0.3)
    for _ in range(5):
        if p.eval_on_selector('#ac', 'e => !e.hidden'):
            p.keyboard.press('Escape')
            d.ff(0.1)
        p.keyboard.press('Enter')
        d.ff(0.3)
        if p.input_value('#input') == '':
            return
    raise RuntimeError(f'could not send: {text}')


def zoom_profile(total, frames):
    """Per-frame wheel deltas summing to `total`, eased in and out."""
    out, prev = [], 0.0
    for i in range(frames):
        k = ease_in_out((i + 1) / frames)
        out.append(total * (k - prev))
        prev = k
    return out


def run(d, claims):
    p = d.p
    # ---------- B: the whole office, pushing in ----------
    d.scene('b_office')
    d.caption('Three Claude Code agents and a chief of staff, in one small office.', 5.8)
    d.seconds(0.4)
    # Push in with the scroll wheel (zooms toward the cursor). OrbitControls
    # ignores the wheel mid-drag, so this is a pure push-in.
    zoom = zoom_profile(-1035, 160)
    p.mouse.move(1010, 600)
    for i in range(160):
        p.mouse.wheel(0, zoom[i])
        d.tick()
    d.seconds(0.4)
    d.cut()

    # ---------- C: ask the chief ----------
    d.scene('c_chief')
    d.cur = [1250, 700]
    d.show_cursor()
    d.click('#input', frames=18)
    d.caption('Ask in plain words. The chief of staff decides who takes it.', 8.8)
    d.type('The checkout button gets cut off on small phones. Can someone fix it?', cps=30)
    d.tick(6)
    p.keyboard.press('Enter')
    d.tick(1)
    assert p.input_value('#input') == '', 'chief message did not send'
    d.move(1450, 900, 20)
    d.hide_cursor()
    d.seconds(1.2)
    d.gate('chief', 1)
    d.seconds(1.6)
    d.gate('ada', 1)                             # plans: the whiteboard
    d.seconds(1.6)
    d.gate('ada', 2)
    d.seconds(1.2)
    d.cut()

    # Off camera: Mira gets the changelog, everyone settles.
    send_quietly(d, '@Mira #docs-site add the 2.4.0 changelog entry')
    d.ff(1.5)
    d.gate('ada', 3)
    d.ff(2)
    d.gate('mira', 1)
    d.ff(2.5)

    # ---------- D: tag someone, and the floor at work ----------
    d.scene('d_work')
    d.cur = [1300, 640]
    d.show_cursor(6)
    d.click(xy=(1120, 520), frames=12, dbl=True)   # glide in over the desks
    d.seconds(0.6)
    d.click('#input', frames=18)
    d.caption('Tag <b>@someone</b> and a <b>#project</b> to hand it over yourself.', 4.6)
    d.type('@Tu', cps=14)
    d.tick(8)
    d.type('\t', cps=14)
    d.type('#pay', cps=14)
    d.tick(8)
    d.type('\t', cps=14)
    d.type('retry failed webhook sends', cps=30)
    d.tick(6)
    p.keyboard.press('Enter')
    d.tick(1)
    assert p.input_value('#input') == '', 'Tunde message did not send'
    d.gate('ada', 4)
    d.move(1500, 820, 18)
    d.hide_cursor()
    d.caption('Every job is a real <code>claude -p</code> run in that project’s folder.', 5.0)
    d.seconds(1.2)
    d.gate('mira', 2)
    d.seconds(1.0)
    d.gate('ada', 5)
    d.gate('tunde', 1)
    d.seconds(1.4)
    d.gate('tunde', 2)
    d.gate('mira', 3)
    d.seconds(1.4)
    d.cut()

    d.gate('ada', 6)
    d.gate('tunde', 3)
    d.ff(2)

    # ---------- E: Ada ships; the thread and what changed ----------
    d.scene('e_ship')
    d.gate('ada', 7)
    d.seconds(1.2)
    d.gate('ada', 8)                             # the result
    d.caption('Results come back in a thread, with what changed.', 7.6)
    d.seconds(2.4)
    d.cur = [1300, 700]
    d.show_cursor(6)
    d.click('#msgs .thread-sum', frames=16)
    d.seconds(1.0)
    d.click('#threadMsgs [data-open]', frames=12)
    d.seconds(1.0)
    d.click('#changes .c-head', frames=14)
    d.seconds(1.8)
    d.cut()

    # Off camera: back to the whole office.
    p.click('#detail .x')
    p.click('#threadBack')
    p.click('#recenter')
    d.ff(2)

    # ---------- F: Mira ships, the office levels up, Kai walks in ----------
    d.scene('f_level')
    d.seconds(0.5)
    d.gate('mira', 4)                            # Mira's result: enough XP for level 2
    d.caption('Shipped work earns XP. Each level hires another agent.', 6.0)
    zoom = zoom_profile(-900, 170)
    p.mouse.move(1180, 820)
    for i in range(170):
        p.mouse.wheel(0, zoom[i])
        d.tick()
    d.seconds(0.6)
    d.cut()

    # Off camera: Tunde ships too, then wait for two idle agents to start a
    # game of pool (seeded, so this repeats). The server allows one
    # break-room claim at a time, so only a granted game claim counts.
    d.gate('tunde', 4)
    d.ff(1)
    d.gate('tunde', 5)
    d.ff(2)
    p.click('#channels [data-channel="general"]')
    games = len([c for c in claims if c.get('game') and c.get('id')])
    waited = 0
    while len([c for c in claims if c.get('game') and c.get('id')]) == games and waited < 400:
        d.ff(1)
        waited += 1
    print(f'  pool game granted after {waited}s', flush=True)
    p.click('#recenter')
    d.ff(1.2)
    p.mouse.dblclick(1090, 745)                  # glide over to the pool table
    d.ff(1.2)

    # ---------- G: the break room ----------
    d.scene('g_break')
    d.cur = [1250, 640]
    d.show_cursor(6)
    d.click('#channels [data-channel="chill-room"]', frames=20)
    d.move(1500, 900, 16)
    d.hide_cursor()
    d.caption('Between jobs they take a break. The small talk lands in <b>#chill-room</b>.', 7.2)
    d.orbit(1200, 600, -70, 230)
    d.seconds(0.5)
    d.cut()


if __name__ == '__main__':
    main()
