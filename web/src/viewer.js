// The office's own image viewer: a click on any attached image opens it here
// instead of in a new tab. Images in the same message can be paged through.

let box = null;
let items = [];
let at = 0;

const make = () => {
  box = document.createElement('div');
  box.className = 'viewer';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Image viewer');
  box.innerHTML = `
    <div class="viewer-bar">
      <span class="viewer-name"></span><span class="viewer-count"></span>
      <a class="viewer-tab" target="_blank" rel="noreferrer">Open in new tab</a>
      <button type="button" class="viewer-x" aria-label="Close">×</button>
    </div>
    <button type="button" class="viewer-nav prev" aria-label="Previous image">‹</button>
    <div class="viewer-stage"><img alt=""></div>
    <button type="button" class="viewer-nav next" aria-label="Next image">›</button>`;
  document.body.append(box);
  box.addEventListener('click', (e) => {
    if (e.target.closest('.viewer-x') || e.target.classList.contains('viewer-stage')) close();
    else if (e.target.closest('.prev')) show(at - 1);
    else if (e.target.closest('.next')) show(at + 1);
    else if (e.target.tagName === 'IMG') box.classList.toggle('actual');
  });
};

const show = (i) => {
  at = (i + items.length) % items.length;
  const { href, name } = items[at];
  const img = box.querySelector('img');
  img.src = href;
  img.alt = name;
  box.classList.remove('actual');
  box.querySelector('.viewer-name').textContent = name;
  box.querySelector('.viewer-count').textContent = items.length > 1 ? `${at + 1} / ${items.length}` : '';
  box.querySelector('.viewer-tab').href = href;
  box.classList.toggle('single', items.length < 2);
};

const close = () => {
  if (!box || box.hidden) return;
  box.hidden = true;
  box.querySelector('img').removeAttribute('src');
  document.body.classList.remove('viewing');
};

document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a.thumb');
  // Modified clicks keep their usual meaning (new tab, download).
  if (!a || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const group = a.closest('.files') || a.parentElement;
  const thumbs = [...group.querySelectorAll('a.thumb')];
  items = thumbs.map((t) => ({ href: t.getAttribute('href'), name: t.title || t.querySelector('img')?.alt || '' }));
  if (!box) make();
  box.hidden = false;
  document.body.classList.add('viewing');
  show(Math.max(0, thumbs.indexOf(a)));
  box.querySelector('.viewer-x').focus();
});

document.addEventListener('keydown', (e) => {
  if (!box || box.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  else if (e.key === 'ArrowLeft' && items.length > 1) show(at - 1);
  else if (e.key === 'ArrowRight' && items.length > 1) show(at + 1);
}, true);
