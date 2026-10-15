// Before first paint, so a saved theme never flashes the default. theme.js owns it after that.
// A file rather than inline, so the page's CSP can be script-src 'self'.
(function () {
  try {
    var t = localStorage.getItem('office.theme') || 'paper';
    var m = localStorage.getItem('office.mode') || 'auto';
    var d = m === 'dark' || (m === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    var r = document.documentElement;
    r.dataset.theme = t;
    r.dataset.mode = d ? 'dark' : 'light';
    r.dataset.nav = localStorage.getItem('office.nav') === 'sidebar' ? 'sidebar' : 'dock';
  } catch (e) {}
})();
