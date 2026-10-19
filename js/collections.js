(() => {
  'use strict';
  if (!document.querySelector('[data-collection="photography"]')) return;
  const $ = id => document.getElementById(id);
  const list = $('collection-list'), search = $('collection-search'), count = $('collection-count');
  const dialog = $('photo-viewer');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeImage = path => /^\/assets\/photography\/[a-zA-Z0-9_-]+\.jpg$/.test(path || '') ? path : '';
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const batchSize = 24;
  let entries = [], albums = [], visible = [], current = 0;
  let panel = null, activeIndex = -1, activeSubgroup = '', shown = batchSize, switchVersion = 0;
  const photoWord = n => n === 1 ? 'photo' : 'photos';
  function showPhoto(index) {
    if (!visible.length) return;
    current = (index + visible.length) % visible.length;
    const photo = visible[current], image = $('viewer-image');
    image.src = safeImage(photo.src); image.alt = photo.alt || photo.title;
    $('viewer-caption').textContent = [photo.title, photo.location, photo.caption].filter(Boolean).join(' · ');
    $('viewer-count').textContent = `${current + 1} / ${visible.length}`;
    if (!dialog.open) dialog.showModal();
  }
  dialog.querySelector('.viewer-close').onclick = () => dialog.close();
  $('viewer-prev').onclick = () => showPhoto(current - 1);
  $('viewer-next').onclick = () => showPhoto(current + 1);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); showPhoto(current + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  function placePanel() {
    if (!panel || activeIndex < 0) return;
    const columns = getComputedStyle(list).gridTemplateColumns.split(/\s+/).length;
    const tiles = [...list.querySelectorAll('.album-tile')];
    const rowEnd = Math.min(tiles.length - 1, Math.floor(activeIndex / columns) * columns + columns - 1);
    if (tiles[rowEnd]?.nextElementSibling !== panel) tiles[rowEnd]?.after(panel);
  }
  function closePanel({instant = false, focus = false} = {}) {
    const old = panel, button = list.querySelector(`[data-album="${activeIndex}"]`);
    panel = null; activeIndex = -1;
    if (button) { button.setAttribute('aria-expanded','false'); button.removeAttribute('aria-controls'); }
    if (focus) button?.focus({preventScroll:true});
    if (!old) return Promise.resolve();
    old.inert = true; old.classList.remove('is-open');
    if (instant || reducedMotion()) { old.remove(); return Promise.resolve(); }
    return new Promise(resolve => setTimeout(() => { old.remove(); resolve(); }, 280));
  }
  function photoCard(photo, index) {
    return `<figure class="photo-card"><button type="button" data-photo="${index}" aria-label="View ${esc(photo.title)}"><img src="${esc(safeImage(photo.thumb || photo.src))}" alt="${esc(photo.alt || photo.title)}" width="${Number(photo.width)||1600}" height="${Number(photo.height)||1200}" loading="lazy" decoding="async" /></button><figcaption><h3>${esc(photo.title)}</h3>${photo.location ? `<p>${esc(photo.location)}</p>` : ''}</figcaption></figure>`;
  }
  function renderDetails() {
    if (!panel || activeIndex < 0) return;
    const album = albums[activeIndex];
    const child = activeSubgroup ? JSON.parse(activeSubgroup) : undefined;
    visible = album.subgroups.filter(s => child === undefined || s.name === child).flatMap(s => s.photos);
    let index = 0;
    const sections = album.subgroups.filter(s => child === undefined || s.name === child).map(s => {
      const start = index; index += s.photos.length;
      const photos = s.photos.slice(0,Math.max(0,shown-start));
      if (!photos.length) return '';
      return `<section class="album-photo-section" aria-label="${esc(s.name || album.name || 'Other photos')}">${s.name && child === undefined ? `<h3 class="album-subheading">${esc(s.name)}</h3>` : ''}<div class="album-photo-grid">${photos.map((p,i)=>photoCard(p,start+i)).join('')}</div></section>`;
    }).join('');
    const total = visible.length, loaded = Math.min(shown,total);
    panel.innerHTML = `<div class="album-expansion-clip"><div class="album-detail">
      <div class="album-detail-head"><div><h2 id="album-detail-title">${esc(album.name || 'Other photos')}</h2><p>${total} ${photoWord(total)}${child ? ' · '+esc(child) : ''}</p></div><button type="button" class="album-close" data-close-album aria-label="Close ${esc(album.name || 'Other photos')}">Close <span aria-hidden="true">×</span></button></div>
      ${album.subgroups.some(s=>s.name) ? `<div class="album-subfilters" role="group" aria-label="Filter subgroups"><button type="button" data-subgroup="" aria-pressed="${!activeSubgroup}">All</button>${album.subgroups.map(s=>`<button type="button" data-subgroup="${esc(JSON.stringify(s.name))}" aria-pressed="${child===s.name}">${esc(s.name || 'Other photos')} <span>${s.photos.length}</span></button>`).join('')}</div>` : ''}
      ${sections}<div class="album-pagination"><p role="status">Showing ${loaded} of ${total} ${photoWord(total)}</p>${loaded < total ? `<button type="button" data-more-photos>Show ${Math.min(batchSize,total-loaded)} more</button>` : ''}</div>
    </div></div>`;
  }
  async function openAlbum(index) {
    const version = ++switchVersion, same = index === activeIndex;
    await closePanel();
    if (version !== switchVersion || same || !albums[index]) return;
    activeIndex = index; activeSubgroup = ''; shown = batchSize;
    panel = document.createElement('section');
    panel.className = 'album-expansion'; panel.id = 'album-expansion';
    panel.setAttribute('aria-labelledby','album-detail-title');
    renderDetails(); placePanel();
    const button = list.querySelector(`[data-album="${index}"]`);
    button.setAttribute('aria-expanded','true'); button.setAttribute('aria-controls',panel.id);
    // Only the opened category creates photo thumbnails; collapsed categories load previews only.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (version !== switchVersion || !panel) return;
      panel.classList.add('is-open');
      const heading = panel.querySelector('.album-detail-head');
      if (heading.getBoundingClientRect().top > innerHeight - 100) heading.scrollIntoView({block:'nearest',behavior:reducedMotion()?'instant':'smooth'});
    }));
  }
  function render() {
    ++switchVersion; closePanel({instant:true});
    const term = search.value.trim().toLowerCase();
    const matches = entries.filter(photo => [photo.title,photo.caption,photo.location,photo.collection,photo.subgroup].join(' ').toLowerCase().includes(term));
    albums = PhotoData.grouped(matches);
    count.textContent = `${albums.length} ${albums.length === 1 ? 'category' : 'categories'} · ${matches.length} ${photoWord(matches.length)}`;
    if (!matches.length) {
      list.innerHTML = `<div class="collection-empty"><h2>${entries.length ? 'No matching photos.' : 'A collection in the making.'}</h2><p>${entries.length ? 'Try another title, place, or category.' : 'Selected photographs will appear here.'}</p></div>`;
      return;
    }
    list.innerHTML = albums.map((album,index) => {
      const photos = album.subgroups.flatMap(s=>s.photos), preview = photos.slice(0,4);
      const title = album.name || 'Other photos';
      return `<article class="album-tile"><button type="button" class="album-trigger" data-album="${index}" aria-expanded="false" aria-label="${esc(title)}, ${photos.length} ${photoWord(photos.length)}"><span class="album-mosaic mosaic-${preview.length}" aria-hidden="true">${preview.map(photo=>`<img src="${esc(safeImage(photo.thumb || photo.src))}" alt="" width="240" height="240" loading="lazy" decoding="async" />`).join('')}</span><span class="album-label"><strong>${esc(title)}</strong><span>${photos.length} ${photoWord(photos.length)}</span></span><span class="album-open-icon" aria-hidden="true">+</span></button></article>`;
    }).join('');
  }
  list.addEventListener('click',event=>{
    const button=event.target.closest('button'); if(!button) return;
    if(button.hasAttribute('data-album')) { openAlbum(Number(button.dataset.album)); return; }
    if(button.hasAttribute('data-close-album')) { ++switchVersion; closePanel({focus:true}); return; }
    if(button.hasAttribute('data-photo')) { showPhoto(Number(button.dataset.photo)); return; }
    if(button.hasAttribute('data-subgroup')) {
      activeSubgroup=button.dataset.subgroup; shown=batchSize; renderDetails();
      [...panel.querySelectorAll('[data-subgroup]')].find(b=>b.dataset.subgroup===activeSubgroup)?.focus({preventScroll:true});
    }
    if(button.hasAttribute('data-more-photos')) {
      const firstNew=shown; shown+=batchSize; renderDetails();
      (panel.querySelector('[data-more-photos]') || panel.querySelector(`[data-photo="${firstNew}"]`))?.focus({preventScroll:true});
    }
  });
  list.addEventListener('keydown',event=>{
    if(event.key==='Escape' && panel && !dialog.open) { event.preventDefault(); ++switchVersion; closePanel({focus:true}); }
  });
  let previousWidth=0;
  new ResizeObserver(([entry])=>{
    if(entry.contentRect.width !== previousWidth) { previousWidth=entry.contentRect.width; placePanel(); }
  }).observe(list);
  search.oninput=render;
  fetch('/data/photography.json').then(response=>{if(!response.ok)throw Error();return response.json();}).then(data=>{
    if(!Array.isArray(data))throw Error();
    entries=data.filter(photo=>photo.published!==false);render();
  }).catch(()=>{list.innerHTML='<div class="collection-empty"><h2>Unable to load the gallery.</h2><p>Please refresh to try again.</p></div>';count.textContent='';});
})();
