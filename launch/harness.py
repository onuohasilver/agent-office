"""Shared browser setup for the launch video.

The office bundle is served to the capture browser with two small additions,
made in flight by page.route (nothing on disk changes):
  * window.__office: getters for the camera, controls, app state and office
    layout, so the capture can drive the camera itself;
  * window.__preRender(): called right before each frame is rendered, which
    is where the camera rig places the camera.
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'http://localhost:4399'          # the sandbox, never the live office on 4317
GPU = ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
W, H = 1920, 804                       # 2.39:1, padded to 1920x1080 in the grade

EXPOSE = ('window.__office={get camera(){return ye},get controls(){return Se},get app(){return et},'
          'get office(){return ln},get chief(){return an},get renderer(){return Ne},get scene(){return Un}};')
ANCHOR_EXPOSE = 'Object.assign(Se,{enableDamping'
ANCHOR_RENDER = 'Ds.render(i);const e=ye.position.distanceTo(Se.target)>74'


def patch_bundle(js):
    assert js.count(ANCHOR_EXPOSE) == 1 and js.count(ANCHOR_RENDER) == 1, 'bundle changed; update anchors'
    js = js.replace(ANCHOR_EXPOSE, EXPOSE + ANCHOR_EXPOSE)
    js = js.replace(ANCHOR_RENDER, 'window.__preRender&&window.__preRender();' + ANCHOR_RENDER)
    return js


def open_office(pw, on_console=None):
    browser = pw.chromium.launch(args=GPU)
    ctx = browser.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1)
    ctx.add_init_script(path=os.path.join(HERE, 'vclock.js'))

    def route(r):
        resp = r.fetch()
        r.fulfill(response=resp, body=patch_bundle(resp.text()), headers={**resp.headers, 'cache-control': 'no-store'})
    ctx.route(re.compile(r'.*/assets/index-[^/]+\.js$'), route)
    # No service worker: it would serve the unpatched bundle from its cache.
    ctx.route(re.compile(r'.*/sw\.js$'), lambda r: r.fulfill(status=404, body=''))
    page = ctx.new_page()
    if on_console:
        page.on('console', on_console)
    page.goto(URL, wait_until='domcontentloaded')
    page.wait_for_selector('.agent-label')
    page.wait_for_function('() => !!window.__office && !!window.__office.app')
    return browser, page
