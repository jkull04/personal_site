(() => {
  'use strict';
  if (!document.querySelector('[data-collection="photography"]')) return;
  const $ = id => document.getElementById(id);
  const list = $('collection-list'), search = $('collection-search'), count = $('collection-count');
  const dialog = $('photo-viewer');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeImage = path => /^(?:\/assets\/photography\/[a-zA-Z0-9_-]+\.jpg|https:\/\/jameskull-studio-storage\.fitzykull\.workers\.dev\/photos\/[a-f0-9]{64}\.jpg)$/.test(path || '') ? path : '';
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const compact = matchMedia('(max-width:700px), (max-height:540px)');
  let batchSize = compact.matches ? 4 : 8, imageVersion=0, routeVersion=0;
  const preloaded=new Map();
  function fitViewport() {
    const height=document.querySelector('.page-header')?.getBoundingClientRect().height || 80;
    document.documentElement.style.setProperty('--gallery-top',Math.ceil(height+12)+'px');
  }
  fitViewport(); window.addEventListener('resize',fitViewport,{passive:true});
  const placeKey='jameskull-photo-places';
  let savedPlaces={};
  try { const saved=JSON.parse(sessionStorage.getItem(placeKey)); if(saved && typeof saved==='object' && !Array.isArray(saved)) savedPlaces=saved; } catch {}
  function rememberPlace() {
    if(!panel || activeIndex<0) return;
    const name=albums[activeIndex].name;
    savedPlaces={...savedPlaces,[name]:{subgroup:activeSubgroup,anchor:visible[page*batchSize]?.id}};
    try { sessionStorage.setItem(placeKey,JSON.stringify(savedPlaces)); } catch {}
  }
  function updateFilterOverflow(reveal=false) {
    const strip=panel?.querySelector('.album-subfilters');
    if(!strip) return;
    if(reveal) {
      const selected=strip.querySelector('[aria-pressed="true"]'), bounds=strip.getBoundingClientRect(), item=selected?.getBoundingClientRect();
      if(item && item.right>bounds.right-20) strip.scrollLeft+=item.right-bounds.right+20;
      else if(item && item.left<bounds.left+20) strip.scrollLeft-=bounds.left-item.left+20;
    }
    strip.parentElement.classList.toggle('can-scroll-left',strip.scrollLeft>2);
    strip.parentElement.classList.toggle('can-scroll-right',strip.scrollWidth-strip.clientWidth-strip.scrollLeft>2);
  }
  window.addEventListener('resize',()=>updateFilterOverflow(),{passive:true});
  function updateLink(push=false) {
    rememberPlace();
    const hash=panel ? PhotoData.link(entries,albums[activeIndex].name,activeSubgroup?JSON.parse(activeSubgroup):undefined,dialog.open?visible[current]?.id:'',page) : '';
    if(location.hash!==hash) history[push?'pushState':'replaceState'](null,'',location.pathname+location.search+hash);
  }
  async function copyLink(button) {
    const label=button.textContent;
    try {await navigator.clipboard.writeText(location.href);button.textContent='Copied';}
    catch {button.textContent='Copy the address above';}
    setTimeout(()=>{if(button.isConnected)button.textContent=label;},2000);
  }
  function preloadNext() {
    if(navigator.connection?.saveData || visible.length<2) return;
    const url=safeImage(visible[(current+1)%visible.length].src);
    if(!url || preloaded.has(url))return;
    const image=new Image(); image.decoding='async'; image.src=url;
    preloaded.set(url,image);
    if(preloaded.size>3)preloaded.delete(preloaded.keys().next().value);
  }
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
  function showPhoto(index, sync=true) {
    if (!visible.length || photoClosing) return;
    current = (index + visible.length) % visible.length;
    const photo = visible[current], image = $('viewer-image'), version=++imageVersion;
    const full=safeImage(photo.src), thumb=safeImage(photo.thumb) || full;
    image.alt = photo.alt || photo.title;
    image.src=thumb;
    image.width=Number(photo.width)||1600; image.height=Number(photo.height)||1200;
    const high=preloaded.get(full) || new Image(); high.decoding='async'; high.src=full;
    high.decode().then(()=>{if(version===imageVersion && dialog.open){image.src=full;preloadNext();}}).catch(()=>{});
    $('viewer-count').textContent = `${current + 1} / ${visible.length}`;
    const opening=!dialog.open;
    if (opening) {
      photoOrigin = panel?.querySelector(`[data-photo="${current}"]`) || document.activeElement;
      dialog.dataset.input=keyboardInput?'keyboard':'pointer';
      dialog.classList.remove('is-closing'); dialog.showModal();
      dialog.querySelector('.viewer-close').focus({preventScroll:true});
    }
    $('viewer-prev').disabled = visible.length < 2;
    $('viewer-next').disabled = visible.length < 2;
    if(sync)updateLink(opening);
  }
  async function closePhoto(sync=true, animate=true) {
    if (!dialog.open || photoClosing) return;
    photoClosing = true;
    if (animate && !reducedMotion()) {
      dialog.classList.add('is-closing');
      await Promise.all(dialog.getAnimations().map(animation=>animation.finished.catch(()=>{})));
    }
    ++imageVersion; dialog.close(); dialog.classList.remove('is-closing'); photoClosing = false;
    if(sync)updateLink();
    if (photoOrigin?.isConnected) photoOrigin.focus({preventScroll:true});
  }
  dialog.querySelector('.viewer-close').onclick = () => closePhoto();
  $('viewer-share').onclick=event=>copyLink(event.currentTarget);
  dialog.addEventListener('cancel',event=>{event.preventDefault();closePhoto();});
  dialog.addEventListener('click',event=>{if(event.target===dialog)closePhoto();});
  $('viewer-prev').onclick = () => showPhoto(current - 1);
  $('viewer-next').onclick = () => showPhoto(current + 1);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); showPhoto(current + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  let touchStart=null;
  dialog.addEventListener('touchstart',event=>{
    touchStart=event.touches.length===1 && event.target.id==='viewer-image' ? {x:event.touches[0].clientX,y:event.touches[0].clientY,time:Date.now()} : null;
  },{passive:true});
  dialog.addEventListener('touchmove',event=>{if(event.touches.length!==1)touchStart=null;},{passive:true});
  dialog.addEventListener('touchcancel',()=>{touchStart=null;},{passive:true});
  dialog.addEventListener('touchend',event=>{
    const start=touchStart;touchStart=null;
    if(!start || !event.changedTouches.length || window.visualViewport?.scale>1.05) return;
    const dx=event.changedTouches[0].clientX-start.x,dy=event.changedTouches[0].clientY-start.y;
    if(Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.5 && Date.now()-start.time<800)showPhoto(current+(dx<0?1:-1));
  },{passive:true});
  compact.addEventListener('change',()=>{
    const first=dialog.open?current:page*batchSize;batchSize=compact.matches?4:8;page=Math.floor(first/batchSize);
    if(panel){renderDetails(false);if(dialog.open)photoOrigin=panel.querySelector(`[data-photo="${current}"]`);updateLink();}
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
    const centerRect = activePanel.querySelector('.album-spread').getBoundingClientRect();
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
  async function closePanel(sync=true, animate=true) {
    if (!panel || closing) return;
    rememberPlace();
    closing = true;
    const old = panel, button = list.querySelector(`[data-album="${activeIndex}"]`);
    old.classList.add('is-closing');
    if(dialog.open)await closePhoto(false,false);
    if(animate)await animateSpread(true);
    old.close(); old.remove(); panel = null; activeIndex = -1; closing = false;
    document.documentElement.style.overflow = '';
    button?.setAttribute('aria-expanded','false'); button?.removeAttribute('aria-controls');
    button?.focus({preventScroll:true});
    if(sync)updateLink();
  }
  function photoCard(photo, index) {
    return `<figure class="photo-card" style="--photo-ratio:${PhotoData.ratio(photo)}"><button type="button" data-photo="${index}" aria-label="View ${esc(photo.title)}"><img src="${esc(safeImage(photo.thumb || photo.src))}" alt="${esc(photo.alt || photo.title)}" width="${Number(photo.width)||1600}" height="${Number(photo.height)||1200}" loading="eager" decoding="async" /></button></figure>`;
  }
  function renderDetails(animate = true) {
    if (!panel || activeIndex < 0) return;
    const album = albums[activeIndex];
    const child = activeSubgroup ? JSON.parse(activeSubgroup) : undefined;
    visible = entries.filter(photo=>PhotoData.matches(photo,album.name,child));
    const start = page*batchSize, photos = visible.slice(start,start+batchSize), total = visible.length;
    const previousScroll=panel.querySelector('.album-subfilters')?.scrollLeft || 0;
    let offset=start;
    const rows=PhotoData.rows(photos,compact.matches).map(row=>`<div class="photo-row">${row.map(photo=>photoCard(photo,offset++)).join('')}</div>`).join('');
    panel.innerHTML = `<div class="album-spread-shell">
      <div class="album-heading"><h2 id="album-detail-title">${esc(album.name || 'Other photos')}</h2><p>${total} ${photoWord(total)}</p></div>
      <button type="button" class="album-share" data-share-album aria-label="Copy category link">Copy link</button>
      <button type="button" class="album-dismiss" data-close-album aria-label="Close ${esc(album.name || 'Other photos')}"><span aria-hidden="true">×</span></button>
      ${album.subgroups.some(s=>s.name) ? `<div class="album-subfilters-wrap"><div class="album-subfilters" role="group" aria-label="Filter subgroups"><button type="button" data-subgroup="" aria-pressed="${!activeSubgroup}">All</button>${album.subgroups.map(s=>`<button type="button" data-subgroup="${esc(JSON.stringify(s.name))}" aria-pressed="${child===s.name}">${esc(s.name || 'Other photos')} <span>${s.photos.length}</span></button>`).join('')}</div></div>` : ''}
      <div class="album-spread" data-count="${photos.length}">${rows}</div>
      ${total > batchSize ? `<nav class="album-pagination" aria-label="Album pages"><button type="button" data-page="-1" ${page===0?'disabled':''}>← Previous</button><p role="status">${start+1}–${Math.min(start+batchSize,total)} of ${total}</p><button type="button" data-page="1" ${start+batchSize>=total?'disabled':''}>Next →</button></nav>` : ''}
    </div>`;
    const strip=panel.querySelector('.album-subfilters');
    if(strip) {
      strip.scrollLeft=previousScroll;
      strip.addEventListener('scroll',()=>updateFilterOverflow(),{passive:true});
      requestAnimationFrame(()=>updateFilterOverflow(true));
    }
    if (animate) { panel.classList.add('is-entering'); animateSpread(); }
  }
  function openAlbum(index, sync=true) {
    if (panel || !albums[index]) return;
    activeIndex = index; activeSubgroup = ''; page = 0;
    const saved=sync && Object.hasOwn(savedPlaces,albums[index].name) ? savedPlaces[albums[index].name] : null;
    if(saved && typeof saved==='object') {
      const subgroup=albums[index].subgroups.find(s=>JSON.stringify(s.name)===saved.subgroup);
      activeSubgroup=subgroup?JSON.stringify(subgroup.name):'';
      const photos=entries.filter(photo=>PhotoData.matches(photo,albums[index].name,subgroup?.name));
      page=Math.floor(Math.max(0,photos.findIndex(photo=>photo.id===saved.anchor))/batchSize);
    }
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
    if(sync)updateLink(true);
  }
  function handleDetails(event) {
    const button = event.target.closest('button'); if (!button || closing) return;
    if (button.hasAttribute('data-close-album')) { closePanel(); return; }
    if (button.hasAttribute('data-share-album')) { copyLink(button); return; }
    if (button.hasAttribute('data-photo')) { showPhoto(Number(button.dataset.photo)); return; }
    if (button.hasAttribute('data-subgroup')) {
      activeSubgroup=button.dataset.subgroup; page=0; renderDetails(); updateLink();
      [...panel.querySelectorAll('[data-subgroup]')].find(b=>b.dataset.subgroup===activeSubgroup)?.focus({preventScroll:true});
    }
    if (button.hasAttribute('data-page')) {
      const direction = Number(button.dataset.page); page+=direction; renderDetails(); updateLink();
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
      const photos = matches.filter(photo=>PhotoData.group(photo)===album.name), preview = PhotoData.preview(photos);
      const title = album.name || 'Other photos';
      return `<article class="album-tile"><button type="button" class="album-trigger" data-album="${index}" aria-expanded="false" aria-label="${esc(title)}, ${photos.length} ${photoWord(photos.length)}"><span class="album-mosaic mosaic-${preview.length}" aria-hidden="true">${preview.map(photo=>`<img src="${esc(safeImage(photo.thumb || photo.src))}" alt="" width="240" height="240" loading="lazy" decoding="async" />`).join('')}</span><span class="album-label"><strong>${esc(title)}</strong><span>${photos.length} ${photoWord(photos.length)}</span></span><span class="album-open-icon" aria-hidden="true">+</span></button></article>`;
    }).join('');
  }
  list.addEventListener('click',event=>{
    const button=event.target.closest('[data-album]');
    if(button) openAlbum(Number(button.dataset.album));
  });
  async function restoreLink() {
    const version=++routeVersion, route=PhotoData.resolveLink(entries,location.hash);
    if(dialog.open)await closePhoto(false,false);
    if(version!==routeVersion)return;
    if(panel)await closePanel(false,false);
    if(version!==routeVersion || !route)return;
    search.value='';render();
    const index=albums.findIndex(album=>album.name===route.parent);
    if(index<0)return;
    openAlbum(index,false);
    activeSubgroup=route.child===undefined?'':JSON.stringify(route.child);
    renderDetails(false);
    const photoIndex=visible.findIndex(p=>p.id===route.photoId);
    page=Math.min(Math.floor(Math.max(0,visible.length-1)/batchSize),photoIndex>=0?Math.floor(photoIndex/batchSize):route.page);
    renderDetails(false);
    if(photoIndex>=0)showPhoto(photoIndex,false);
  }
  let routeTimer;
  const queueRoute=()=>{clearTimeout(routeTimer);routeTimer=setTimeout(restoreLink,0);};
  window.addEventListener('popstate',queueRoute);
  window.addEventListener('hashchange',queueRoute);
  list.addEventListener('error',event=>{const img=event.target;if(img.tagName==='IMG')img.style.visibility='hidden';},true);
  search.oninput=render;
  fetch('/data/photography.json').then(response=>{if(!response.ok)throw Error();return response.json();}).then(data=>{
    if(!Array.isArray(data))throw Error();
    entries=data.filter(photo=>photo.published!==false);render();restoreLink();
  }).catch(()=>{list.innerHTML='<div class="collection-empty"><h2>Unable to load the gallery.</h2><p>Please refresh to try again.</p></div>';count.textContent='';});
})();
