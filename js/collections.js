(() => {
  'use strict';
  if (!document.querySelector('[data-collection="photography"]')) return;
  const $ = id => document.getElementById(id);
  const list = $('collection-list'), search = $('collection-search'), count = $('collection-count');
  const dialog = $('photo-viewer');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeImage = path => /^\/assets\/photography\/[a-zA-Z0-9_-]+\.jpg$/.test(path || '') ? path : '';
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const batchSize = 8;
  let entries = [], albums = [], visible = [], current = 0;
  let panel = null, activeIndex = -1, activeSubgroup = '', page = 0, origin = null, closing = false;
  const photoWord = n => n === 1 ? 'photo' : 'photos';
  function showPhoto(index) {
    if (!visible.length) return;
    current = (index + visible.length) % visible.length;
    const photo = visible[current], image = $('viewer-image');
    image.src = safeImage(photo.src); image.alt = photo.alt || photo.title;
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
  function animateSpread(reverse = false) {
    if (!panel || reducedMotion()) return Promise.resolve();
    const center = origin || {x:innerWidth/2,y:innerHeight/2};
    return Promise.all([...panel.querySelectorAll('.photo-card')].map((card,i) => {
      const r = card.getBoundingClientRect();
      const collapsed = {transform:`translate(${center.x-r.x-r.width/2}px,${center.y-r.y-r.height/2}px) scale(.12) rotate(${i%2 ? 12 : -12}deg)`,opacity:0};
      const expanded = {transform:'translate(0,0) scale(1) rotate(0deg)',opacity:1};
      return card.animate(reverse ? [expanded,collapsed] : [collapsed,expanded], {
        duration:reverse ? 260 : 620, delay:reverse ? 0 : i*35,
        easing:reverse ? 'ease-in' : 'cubic-bezier(.16,1,.3,1)',fill:'both'
      }).finished.catch(()=>{});
    }));
  }
  async function closePanel() {
    if (!panel || closing) return;
    closing = true;
    const old = panel, button = list.querySelector(`[data-album="${activeIndex}"]`);
    await animateSpread(true);
    old.close(); old.remove(); panel = null; activeIndex = -1; closing = false;
    document.documentElement.style.overflow = '';
    button?.setAttribute('aria-expanded','false'); button?.removeAttribute('aria-controls');
    button?.focus({preventScroll:true});
  }
  function photoCard(photo, index) {
    return `<figure class="photo-card"><button type="button" data-photo="${index}" aria-label="View ${esc(photo.title)}"><img src="${esc(safeImage(photo.thumb || photo.src))}" alt="${esc(photo.alt || photo.title)}" width="${Number(photo.width)||1600}" height="${Number(photo.height)||1200}" loading="lazy" decoding="async" /></button></figure>`;
  }
  function renderDetails(animate = true) {
    if (!panel || activeIndex < 0) return;
    const album = albums[activeIndex];
    const child = activeSubgroup ? JSON.parse(activeSubgroup) : undefined;
    visible = album.subgroups.filter(s => child === undefined || s.name === child).flatMap(s => s.photos);
    const start = page*batchSize, photos = visible.slice(start,start+batchSize), total = visible.length;
    panel.innerHTML = `<div class="album-spread-shell">
      <div class="album-spread-bar"><span>Photos <span aria-hidden="true">/</span> ${esc(album.name || 'Other photos')}</span><button type="button" data-close-album aria-label="Close ${esc(album.name || 'Other photos')}">Back to categories <span aria-hidden="true">×</span></button></div>
      ${album.subgroups.some(s=>s.name) ? `<div class="album-subfilters" role="group" aria-label="Filter subgroups"><button type="button" data-subgroup="" aria-pressed="${!activeSubgroup}">All</button>${album.subgroups.map(s=>`<button type="button" data-subgroup="${esc(JSON.stringify(s.name))}" aria-pressed="${child===s.name}">${esc(s.name || 'Other photos')} <span>${s.photos.length}</span></button>`).join('')}</div>` : ''}
      <div class="album-spread" data-count="${photos.length}"><div class="album-center"><h2 id="album-detail-title">${esc(album.name || 'Other photos')}</h2><p>${child ? esc(child)+' · ' : ''}${total} ${photoWord(total)}</p><span class="album-center-rule" aria-hidden="true"></span></div>${photos.map((p,i)=>photoCard(p,start+i)).join('')}</div>
      ${total > batchSize ? `<nav class="album-pagination" aria-label="Album pages"><button type="button" data-page="-1" ${page===0?'disabled':''}>← Previous</button><p role="status">${start+1}–${Math.min(start+batchSize,total)} of ${total}</p><button type="button" data-page="1" ${start+batchSize>=total?'disabled':''}>Next →</button></nav>` : ''}
    </div>`;
    if (animate) { origin = {x:innerWidth/2,y:innerHeight/2}; animateSpread(); }
  }
  function openAlbum(index) {
    if (panel || !albums[index]) return;
    activeIndex = index; activeSubgroup = ''; page = 0;
    const button = list.querySelector(`[data-album="${index}"]`), r = button.getBoundingClientRect();
    origin = {x:r.x+r.width/2,y:r.y+r.height/2};
    panel = document.createElement('dialog'); panel.className = 'album-explorer'; panel.id = 'album-expansion';
    panel.setAttribute('aria-labelledby','album-detail-title');
    document.body.append(panel); renderDetails(false);
    panel.addEventListener('click',handleDetails);
    panel.addEventListener('cancel',event=>{event.preventDefault();closePanel();});
    button.setAttribute('aria-expanded','true'); button.setAttribute('aria-controls',panel.id);
    document.documentElement.style.overflow = 'hidden';
    panel.showModal(); animateSpread();
  }
  function handleDetails(event) {
    const button = event.target.closest('button'); if (!button || closing) return;
    if (button.hasAttribute('data-close-album')) { closePanel(); return; }
    if (button.hasAttribute('data-photo')) { showPhoto(Number(button.dataset.photo)); return; }
    if (button.hasAttribute('data-subgroup')) {
      activeSubgroup=button.dataset.subgroup; page=0; renderDetails();
      [...panel.querySelectorAll('[data-subgroup]')].find(b=>b.dataset.subgroup===activeSubgroup)?.focus({preventScroll:true});
    }
    if (button.hasAttribute('data-page')) {
      const direction = Number(button.dataset.page); page+=direction; renderDetails();
      const target=panel.querySelector(`[data-page="${direction}"]:not(:disabled)`) || panel.querySelector('[data-page]:not(:disabled)');
      target?.focus({preventScroll:true}); panel.scrollTop=0;
    }
  }
  function render() {
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
    const button=event.target.closest('[data-album]');
    if(button) openAlbum(Number(button.dataset.album));
  });
  search.oninput=render;
  fetch('/data/photography.json').then(response=>{if(!response.ok)throw Error();return response.json();}).then(data=>{
    if(!Array.isArray(data))throw Error();
    entries=data.filter(photo=>photo.published!==false);render();
  }).catch(()=>{list.innerHTML='<div class="collection-empty"><h2>Unable to load the gallery.</h2><p>Please refresh to try again.</p></div>';count.textContent='';});
})();
