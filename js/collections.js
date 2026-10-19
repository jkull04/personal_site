(() => {
  'use strict';
  const root = document.querySelector('[data-collection]');
  if (!root) return;
  const kind = root.dataset.collection;
  const list = document.getElementById('collection-list');
  const search = document.getElementById('collection-search');
  const filter = document.getElementById('collection-filter');
  const count = document.getElementById('collection-count');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeImage = path => /^\/assets\/photography\/[a-zA-Z0-9_-]+\.jpg$/.test(path || '') ? path : '';
  let entries = [], visible = [], current = 0;
  const dialog = document.getElementById('photo-viewer');
  function showPhoto(index) {
    current = (index + visible.length) % visible.length;
    const p = visible[current];
    const img = document.getElementById('viewer-image');
    img.src = safeImage(p.src); img.alt = p.alt;
    document.getElementById('viewer-caption').textContent = [p.title, p.location, p.caption].filter(Boolean).join(' · ');
    document.getElementById('viewer-count').textContent = `${current + 1} / ${visible.length}`;
    if (!dialog.open) dialog.showModal();
  }
  dialog.querySelector('.viewer-close').onclick = () => dialog.close();
  document.getElementById('viewer-prev').onclick = () => showPhoto(current - 1);
  document.getElementById('viewer-next').onclick = () => showPhoto(current + 1);
  dialog.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); showPhoto(current + (e.key === 'ArrowLeft' ? -1 : 1)); } });
  function render() {
    const term = search.value.trim().toLowerCase();
    visible = entries.filter(e => (!filter.value || (kind === 'books' ? e.status : e.collection) === filter.value) && [e.title,e.author,e.note,e.caption,e.location,e.collection].join(' ').toLowerCase().includes(term));
    count.textContent = `${visible.length} ${kind === 'books' ? (visible.length === 1 ? 'book' : 'books') : (visible.length === 1 ? 'photograph' : 'photographs')}`;
    if (!visible.length) {
      list.innerHTML = `<div class="collection-empty"><h2>${entries.length ? 'Nothing here matches yet.' : kind === 'books' ? 'The shelf is taking shape.' : 'A collection in the making.'}</h2><p>${entries.length ? 'Try another search or filter.' : kind === 'books' ? 'Books and reading notes will appear here.' : 'Selected photographs will appear here.'}</p></div>`;
      return;
    }
    list.innerHTML = visible.map((e,i) => kind === 'books' ? `<article class="book-entry"><span class="book-number">${String(i+1).padStart(2,'0')}</span><div><h2>${esc(e.title)}</h2><p class="book-author">${esc(e.author)}</p>${e.note ? `<p class="book-note">${esc(e.note)}</p>` : ''}<p class="book-meta">${esc([e.finished ? 'Finished '+e.finished : '', e.rating ? e.rating+' / 5' : ''].filter(Boolean).join(' · '))}</p></div><span class="book-status">${esc(e.status)}</span></article>` : `<figure class="photo-card"><button type="button" data-photo="${i}" aria-label="View ${esc(e.title)}"><img src="${esc(safeImage(e.thumb || e.src))}" alt="${esc(e.alt)}" width="${Number(e.width)||1600}" height="${Number(e.height)||1200}" loading="lazy" decoding="async" /></button><figcaption><h2>${esc(e.title)}</h2><p>${esc([e.location,e.date].filter(Boolean).join(' · '))}</p>${e.caption ? `<p>${esc(e.caption)}</p>` : ''}</figcaption></figure>`).join('');
    list.querySelectorAll('[data-photo]').forEach(b => b.onclick = () => showPhoto(Number(b.dataset.photo)));
  }
  search.oninput = render; filter.onchange = render;
  fetch(`/data/${kind}.json`).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(data => {
    if (!Array.isArray(data)) throw Error();
    entries = data.filter(e => e.published !== false);
    if (kind === 'photography') [...new Set(entries.map(e=>e.collection).filter(Boolean))].sort().forEach(v => { const o = new Option(v,v); filter.add(o); });
    render();
  }).catch(() => { list.innerHTML = '<div class="collection-empty"><h2>Unable to load the collection.</h2><p>Please refresh to try again.</p></div>'; count.textContent = ''; });
})();
