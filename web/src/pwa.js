// Only in a real build: the dev server has no service worker to serve.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
