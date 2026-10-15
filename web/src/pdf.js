// Reads a PDF in the page (pdf.js), since the desktop shell's webview has no
// PDF viewer of its own and would download the file instead. Loaded on the
// first PDF opened. Pages are drawn as they scroll into view.

let lib = null;
async function load() {
  if (lib) return lib;
  const [pdfjs, { default: Worker }] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?worker')]);
  pdfjs.GlobalWorkerOptions.workerPort = new Worker();
  return (lib = pdfjs);
}

// Shows `url` inside `host`. Returns { destroy }.
export async function mountPdf(host, url) {
  const pdfjs = await load();
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not open the PDF (${res.status}).`);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
  let dead = false;
  const pages = [];
  const seen = new IntersectionObserver((hits) => {
    for (const h of hits) if (h.isIntersecting) { seen.unobserve(h.target); draw(h.target); }
  }, { root: host, rootMargin: '600px 0px' });

  async function draw(box) {
    const page = await doc.getPage(+box.dataset.n);
    if (dead) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const fit = Math.min(host.clientWidth - 24, 980) / page.getViewport({ scale: 1 }).width;
    const vp = page.getViewport({ scale: fit * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    canvas.style.width = `${Math.floor(vp.width / dpr)}px`; canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
    box.style.minHeight = canvas.style.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
    if (!dead) box.replaceChildren(canvas);
  }

  host.replaceChildren();
  const one = (await doc.getPage(1)).getViewport({ scale: 1 });
  const guess = Math.round((Math.min(host.clientWidth - 24, 980) / one.width) * one.height);
  for (let n = 1; n <= doc.numPages; n++) {
    const box = document.createElement('div');
    box.className = 'fe-pdf-page'; box.dataset.n = n;
    box.style.minHeight = `${guess}px`;
    host.append(box); pages.push(box); seen.observe(box);
  }
  return { pages: doc.numPages, destroy() { dead = true; seen.disconnect(); doc.destroy(); } };
}
