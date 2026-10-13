// Inside the Tauri desktop shell the webview drops target=_blank links and window.open,
// so hand every external URL to the shell's opener plugin. A plain browser is untouched.
const opener = () => window.__TAURI__?.opener;

export const isDesktop = () => !!opener();

const external = (href) => {
  try {
    const u = new URL(href, location.href);
    return /^(https?|mailto):$/.test(u.protocol) && (u.protocol === 'mailto:' || u.origin !== location.origin) ? u.href : null;
  } catch { return null; }
};

const open = (url) => opener()?.openUrl(url).catch((e) => console.warn('openUrl failed', e));

if (isDesktop()) {
  document.documentElement.classList.add('desktop');
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const url = external(a.href);
    if (!url) return;
    e.preventDefault();
    open(url);
  });
  const native = window.open.bind(window);
  window.open = (url, ...rest) => {
    let target = null;
    try { target = url ? external(String(url)) : null; } catch {}
    if (!target) return native(url, ...rest);
    open(target);
    return null;
  };
}
