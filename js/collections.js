(() => {
  'use strict';
  const root = document.querySelector('[data-collection="photography"]');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const list = $('collection-list'), search = $('collection-search'), filter = $('collection-filter'), subfilter = $('collection-subgroup'), count = $('collection-count');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeImage = path => /^\/assets\/photography\/[a-zA-Z0-9_-]+\.jpg$/.test(path || '') ? path : '';
  let entries = [], visible = [], current = 0;
  const dialog = $('photo-viewer');
  const selected = select => select.value === '' ? undefined : JSON.parse(select.value);
  function showPhoto(index) {
    if (!visible.length) return;
    current = (index + visible.length) % visible.length;
    const p = visible[current];
    const img = $('viewer-image');
    img.src = safeImage(p.src); img.alt = p.alt;
    $('viewer-caption').textContent = [p.title, p.location, p.caption].filter(Boolean).join(' · ');
    $('viewer-count').textContent = `${current + 1} / ${visible.length}`;
    if (!dialog.open) dialog.showModal();
  }
  dialog.querySelector('.viewer-close').onclick = () => dialog.close();
  $('viewer-prev').onclick = () => showPhoto(current - 1);
  $('viewer-next').onclick = () => showPhoto(current + 1);
  dialog.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); showPhoto(current + (e.key === 'ArrowLeft' ? -1 : 1)); } });
  function updateSubgroups() {
    const parent = selected(filter);
    subfilter.replaceChildren(new Option('All subgroups', ''));
    if (parent !== undefined) {
      [...new Set(entries.filter(p => PhotoData.group(p) === parent).map(PhotoData.subgroup))].sort().forEach(name => subfilter.add(new Option(name || 'No subgroup', JSON.stringify(name))));
    }
    subfilter.disabled = parent === undefined || subfilter.options.length < 2;
  }
  function render() {
    const term = search.value.trim().toLowerCase();
    const groups = PhotoData.grouped(entries.filter(e => PhotoData.matches(e, selected(filter), selected(subfilter)) && [e.title,e.caption,e.location,e.collection,e.subgroup].join(' ').toLowerCase().includes(term)));
    // The lightbox follows the same order as the grouped gallery.
    visible = groups.flatMap(g => g.subgroups.flatMap(s => s.photos));
    count.textContent = `${visible.length} ${visible.length === 1 ? 'photograph' : 'photographs'}`;
    if (!visible.length) {
      list.innerHTML = `<div class="collection-empty"><h2>${entries.length ? 'Nothing here matches yet.' : 'A collection in the making.'}</h2><p>${entries.length ? 'Try another search or filter.' : 'Selected photographs will appear here.'}</p></div>`;
      return;
    }
    let index = 0;
    const card = e => `<figure class="photo-card"><button type="button" data-photo="${index++}" aria-label="View ${esc(e.title)}"><img src="${esc(safeImage(e.thumb || e.src))}" alt="${esc(e.alt)}" width="${Number(e.width)||1600}" height="${Number(e.height)||1200}" loading="lazy" decoding="async" /></button><figcaption><h4>${esc(e.title)}</h4><p>${esc([e.location,e.date].filter(Boolean).join(' · '))}</p>${e.caption ? `<p>${esc(e.caption)}</p>` : ''}</figcaption></figure>`;
    list.innerHTML = groups.map((g, i) => `<section class="photo-group" aria-labelledby="photo-group-${i}"><h2 id="photo-group-${i}">${esc(g.name || 'Other photos')}</h2>${g.subgroups.map(s => `<div class="photo-subgroup">${s.name ? `<h3>${esc(s.name)}</h3>` : ''}<div class="photo-grid">${s.photos.map(card).join('')}</div></div>`).join('')}</section>`).join('');
  }
  list.onclick = event => { const button = event.target.closest('[data-photo]'); if (button) showPhoto(Number(button.dataset.photo)); };
  search.oninput = render;
  filter.onchange = () => { updateSubgroups(); render(); };
  subfilter.onchange = render;
  fetch('/data/photography.json').then(r => { if (!r.ok) throw Error(); return r.json(); }).then(data => {
    if (!Array.isArray(data)) throw Error();
    entries = data.filter(e => e.published !== false);
    [...new Set(entries.map(PhotoData.group))].sort().forEach(name => filter.add(new Option(name || 'Other photos', JSON.stringify(name))));
    updateSubgroups(); render();
  }).catch(() => { list.innerHTML = '<div class="collection-empty"><h2>Unable to load the collection.</h2><p>Please refresh to try again.</p></div>'; count.textContent = ''; });
})();
