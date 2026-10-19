(() => {
  'use strict';
  if (!document.querySelector('[data-collection="photography"]')) return;
  const $ = id => document.getElementById(id);
  const list = $('collection-list'), search = $('collection-search'), count = $('collection-count');
  const dialog = $('photo-viewer');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeImage = path => /^(?:\/assets\/photography\/[a-zA-Z0-9_-]+\.jpg|https:\/\/jameskull-studio-storage\.fitzykull\.workers\.dev\/photos\/[a-f0-9]{64}\.jpg)$/.test(path || '') ? path : '';
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const batchSize = 8;
  let keyboardInput = false, photoOrigin = null, photoClosing = false;
  function setInputMode(keyboard) {
    keyboardInput = keyboard;
    list.dataset.input = keyboard?'keyboard':'pointer';
    [panel,dialog].filter(Boolean).forEach(el=>el.dataset.input=keyboard?'keyboard':'pointer');
  }
  document.addEventListener('pointerdown',()=>setInputMode(false),{passive:true});
  document.addEventListener('keydown',event=>{if(event.key==='Tab' || event.key.startsWith('Arrow'))setInputMode(true);});
  let entries = [], albums = [], visible = [], current = 0;
  let panel = null, activeIndex = -1, activeSubgroup = '', page = 0, origin = null, closing = false;
  const photoWord = n => n === 1 ? 'photo' : 'photos';
  function showPhoto(index) {
    if (!visible.length) return;
    current = (index + visible.length) % visible.length;
    const photo = visible[current], image = $('viewer-image');
    image.src = safeImage(photo.src); image.alt = photo.alt || photo.title;
    $('viewer-count').textContent = `${current + 1} / ${visible.length}`;
    if (!dialog.open) {
      photoOrigin = panel?.querySelector(`[data-photo="${current}"]`) || document.activeElement;
      dialog.dataset.input=keyboardInput?'keyboard':'pointer';
      dialog.classList.remove('is-closing'); dialog.showModal();
      dialog.querySelector('.viewer-close').focus({preventScroll:true});
    }
    $('viewer-prev').disabled = visible.length < 2;
    $('viewer-next').disabled = visible.length < 2;
  }
  async function closePhoto() {
    if (!dialog.open || photoClosing) return;
    photoClosing = true;
    if (!reducedMotion()) {
      dialog.classList.add('is-closing');
      await Promise.all(dialog.getAnimations().map(animation=>animation.finished.catch(()=>{})));
    }
    dialog.close(); dialog.classList.remove('is-closing'); photoClosing = false;
    if (photoOrigin?.isConnected) photoOrigin.focus({preventScroll:true});
  }
  dialog.querySelector('.viewer-close').onclick = closePhoto;
  dialog.addEventListener('cancel',event=>{event.preventDefault();closePhoto();});
  dialog.addEventListener('click',event=>{if(event.target===dialog)closePhoto();});
  $('viewer-prev').onclick = () => showPhoto(current - 1);
  $('viewer-next').onclick = () => showPhoto(current + 1);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); showPhoto(current + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  async function animateSpread(reverse = false) {
    if (!panel) return;
    if (reducedMotion()) { panel.classList.remove('is-entering'); return; }
    const activePanel = panel;
    if (!reverse) {
      const images = [...activePanel.querySelectorAll('.photo-card img')];
      await Promise.race([Promise.all(images.map(image=>image.decode().catch(()=>{}))),new Promise(resolve=>setTimeout(resolve,180))]);
      if (panel !== activePanel || closing) return;
    }
    const centerRect = activePanel.querySelector('.album-center').getBoundingClientRect();
    const center = {x:centerRect.x+centerRect.width/2,y:centerRect.y+centerRect.height/2};
    await Promise.all([...activePanel.querySelectorAll('.photo-card')].map((card,i) => {
      const r = card.getBoundingClientRect();
      const dx = Math.max(-150,Math.min(150,(center.x-r.x-r.width/2)*.45));
      const dy = Math.max(-100,Math.min(100,(center.y-r.y-r.height/2)*.45));
      const collapsed = {transform:`translate(${dx}px,${dy}px) scale(.8)`,opacity:0};
      const expanded = {transform:'translate(0,0) scale(1)',opacity:1};
      return card.animate(reverse ? [expanded,collapsed] : [collapsed,expanded], {
        duration:reverse ? 260 : 560, delay:reverse ? 0 : i*18,
        easing:reverse ? 'cubic-bezier(.4,0,1,1)' : 'cubic-bezier(.22,1,.36,1)',fill:'both'
      }).finished.catch(()=>{});
    }));
    activePanel.classList.remove('is-entering');
  }
  async function closePanel() {
    if (!panel || closing) return;
    closing = true;
    const old = panel, button = list.querySelector(`[data-album="${activeIndex}"]`);
    old.classList.add('is-closing');
    await animateSpread(true);
    old.close(); old.remove(); panel = null; activeIndex = -1; closing = false;
    document.documentElement.style.overflow = '';
    button?.setAttribute('aria-expanded','false'); button?.removeAttribute('aria-controls');
    button?.focus({preventScroll:true});
  }
  function photoCard(photo, index) {
    return `<figure class="photo-card"><button type="button" data-photo="${index}" aria-label="View ${esc(photo.title)}"><img src="${esc(safeImage(photo.thumb || photo.src))}" alt="${esc(photo.alt || photo.title)}" width="${Number(photo.width)||1600}" height="${Number(photo.height)||1200}" loading="eager" decoding="async" /></button></figure>`;
  }
  function renderDetails(animate = true) {
    if (!panel || activeIndex < 0) return;
    const album = albums[activeIndex];
    const child = activeSubgroup ? JSON.parse(activeSubgroup) : undefined;
    visible = album.subgroups.filter(s => child === undefined || s.name === child).flatMap(s => s.photos);
    const start = page*batchSize, photos = visible.slice(start,start+batchSize), total = visible.length;
    panel.innerHTML = `<div class="album-spread-shell">
      <button type="button" class="album-dismiss" data-close-album aria-label="Close ${esc(album.name || 'Other photos')}"><span aria-hidden="true">×</span></button>
      ${album.subgroups.some(s=>s.name) ? `<div class="album-subfilters" role="group" aria-label="Filter subgroups"><button type="button" data-subgroup="" aria-pressed="${!activeSubgroup}">All</button>${album.subgroups.map(s=>`<button type="button" data-subgroup="${esc(JSON.stringify(s.name))}" aria-pressed="${child===s.name}">${esc(s.name || 'Other photos')} <span>${s.photos.length}</span></button>`).join('')}</div>` : ''}
      <div class="album-spread" data-count="${photos.length}" style="--spread-rows:${Math.ceil(photos.length/2)}"><div class="album-center"><h2 id="album-detail-title">${esc(album.name || 'Other photos')}</h2><p>${child ? esc(child)+' · ' : ''}${total} ${photoWord(total)}</p><span class="album-center-rule" aria-hidden="true"></span></div>${photos.map((p,i)=>photoCard(p,start+i)).join('')}</div>
      ${total > batchSize ? `<nav class="album-pagination" aria-label="Album pages"><button type="button" data-page="-1" ${page===0?'disabled':''}>← Previous</button><p role="status">${start+1}–${Math.min(start+batchSize,total)} of ${total}</p><button type="button" data-page="1" ${start+batchSize>=total?'disabled':''}>Next →</button></nav>` : ''}
    </div>`;
    if (animate) { panel.classList.add('is-entering'); animateSpread(); }
  }
  function openAlbum(index) {
    if (panel || !albums[index]) return;
    activeIndex = index; activeSubgroup = ''; page = 0;
    const button = list.querySelector(`[data-album="${index}"]`), r = button.getBoundingClientRect();
    origin = {x:r.x+r.width/2,y:r.y+r.height/2};
    panel = document.createElement('dialog'); panel.className = 'album-explorer is-entering'; panel.dataset.input=keyboardInput?'keyboard':'pointer'; panel.id = 'album-expansion';
    panel.setAttribute('aria-labelledby','album-detail-title');
    document.body.append(panel); renderDetails(false);
    panel.addEventListener('click',event=>{if(event.target===panel)closePanel();else handleDetails(event);});
    panel.addEventListener('cancel',event=>{event.preventDefault();closePanel();});
    button.setAttribute('aria-expanded','true'); button.setAttribute('aria-controls',panel.id);
    document.documentElement.style.overflow = 'hidden';
    panel.showModal(); panel.querySelector('[data-close-album]').focus({preventScroll:true}); animateSpread();
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
