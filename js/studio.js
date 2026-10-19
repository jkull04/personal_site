(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state, db, busy = false, saveQueue = Promise.resolve();
  const previews = {};
  const status = message => { $('studio-status').textContent = message; };
  function save() {
    const snapshot = structuredClone(state);
    saveQueue = saveQueue.catch(()=>{}).then(()=>new Promise((resolve,reject)=>{
      const tx = db.transaction('drafts','readwrite');
      tx.objectStore('drafts').put(snapshot,'current');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    }));
    saveQueue.then(()=>status('Draft saved in this browser. Publish when ready.')).catch(()=>status('Browser storage is full or unavailable. Download a backup now; your latest edits are only in memory.'));
    return saveQueue;
  }
  function setBusy(value) {
    busy = value;
    document.querySelectorAll('main button, main input, main textarea, main select').forEach(el=>el.disabled=value);
  }
  async function api(path, method='GET', body) {
    const token = $('github-token').value.trim();
    if (!token) throw Error('Paste your GitHub token under GitHub connection to publish.');
    const response = await fetch('https://api.github.com/repos/jkull04/personal_site'+path,{method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:body ? JSON.stringify(body) : undefined,cache:'no-store'});
    if (!response.ok) {
      if (response.status===401 || response.status===403) throw Error('GitHub could not authorize this update. Check the token’s expiration, personal_site repository access, and Contents: Read and write permission.');
      if (response.status===409 || response.status===422) throw Error('GitHub rejected the update, possibly because the site changed while publishing. Your draft is safe. Retry; if content changed, reload it after downloading a backup.');
      throw Error('GitHub request failed ('+response.status+'). Your local draft is safe.');
    }
    return response.json();
  }
  async function fetchPublished() {
    // Read from GitHub, avoiding an older Pages deployment or a cached JSON file.
    const response = await fetch('https://api.github.com/repos/jkull04/personal_site/git/ref/heads/main',{cache:'no-store'});
    if (!response.ok) throw Error('Cannot load the latest site from GitHub. Try again shortly.');
    const ref = await response.json();
    const data = {};
    for (const kind of ['books','photography']) {
      const r = await fetch('https://api.github.com/repos/jkull04/personal_site/contents/data/'+kind+'.json?ref='+ref.object.sha,{cache:'no-store'});
      if (!r.ok) throw Error('Cannot load '+kind+' from GitHub. Try again after deployment.');
      const file = await r.json();
      data[kind] = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g,'')), c=>c.charCodeAt(0))));
    }
    StudioCore.validate(data);
    return {version:1,data,baseline:structuredClone(data),images:{}};
  }
  function field(kind,e,key,label,type='text',wide=false) {
    const id = e.id+'-'+key;
    let control;
    if (type==='textarea') control = `<textarea id="${id}" data-key="${key}" maxlength="10000">${esc(e[key])}</textarea>`;
    else if (type==='status') control = `<select id="${id}" data-key="${key}">${['Reading','Read','Want to read'].map(v=>`<option ${e[key]===v?'selected':''}>${v}</option>`).join('')}</select>`;
    else if (type==='rating') control = `<select id="${id}" data-key="${key}"><option value="">No rating</option>${[1,2,3,4,5].map(v=>`<option value="${v}" ${String(e[key])===String(v)?'selected':''}>${v} / 5</option>`).join('')}</select>`;
    else control = `<input id="${id}" type="${type}" data-key="${key}" value="${esc(e[key])}" maxlength="500" />`;
    return `<label class="${wide?'wide':''}" for="${id}">${label}${control}</label>`;
  }
  function actions(kind,e,i) {
    return `<div class="studio-actions"><button type="button" data-action="up" ${i===0?'disabled':''}>Move up</button><button type="button" data-action="down" ${i===state.data[kind].length-1?'disabled':''}>Move down</button><button type="button" data-action="remove">Remove</button></div><label class="checkbox"><input type="checkbox" data-key="published" ${e.published!==false?'checked':''} />Include on public site</label>`;
  }
  function render() {
    for (const kind of ['books','photography']) {
      const holder = $(kind==='books'?'book-edit-list':'photo-edit-list');
      holder.innerHTML = state.data[kind].map((e,i)=>{
        const fields = kind==='books' ? field(kind,e,'title','Title')+field(kind,e,'author','Author')+field(kind,e,'status','Shelf','status')+field(kind,e,'rating','Rating (optional)','rating')+field(kind,e,'finished','Date finished (newest appear first)','date')+field(kind,e,'note','Your reading note','textarea',true) : field(kind,e,'title','Title')+field(kind,e,'collection','Collection')+field(kind,e,'location','Place (optional)')+field(kind,e,'date','Date taken (optional)','date')+field(kind,e,'alt','Image description (required when publishing)','text',true)+field(kind,e,'caption','Caption (optional)','textarea',true);
        const thumb = kind==='photography' ? ((state.images[e.thumb.slice(1)] || previews[e.thumb.slice(1)]) ? 'data:image/jpeg;base64,'+(state.images[e.thumb.slice(1)] || previews[e.thumb.slice(1)]) : e.thumb) : BookData.coverURL(e.coverId);
        const cover = kind==='books' ? bookCover(thumb,e.title) : (thumb?`<img src="${esc(thumb)}" alt="${esc(e.alt || 'Uploaded photograph preview')}" />`:'');
        return `<article class="edit-card" data-kind="${kind}" data-id="${e.id}"><h3>${kind==='books'?'Book':'Photograph'} ${i+1}</h3><div class="${kind==='photography'?'edit-photo':'edit-book'}">${cover}<div><div class="edit-fields">${fields}</div>${actions(kind,e,i)}</div></div></article>`;
      }).join('') || `<p>No ${kind==='books'?'books':'photographs'} yet. Add your first one above.</p>`;
    }
  }
  function bookCover(url,title) {
    return `<div class="catalog-cover">${url?`<img src="${esc(url)}" alt="Cover of ${esc(title)}" loading="lazy" referrerpolicy="no-referrer" />`:''}<span ${url?'hidden':''}>No cover available</span></div>`;
  }
  document.querySelector('main').addEventListener('error',event=>{
    if(event.target.matches('.catalog-cover img')) {event.target.hidden=true;event.target.nextElementSibling.hidden=false;}
  },true);
  let catalogMatches=[], catalogController, catalogTimer, catalogVersion=0, lastSearch=0;
  const catalogCache=new Map();
  function showCatalog(matches) {
    catalogMatches=matches;
    $('catalog-results').innerHTML=matches.map((book,i)=>`<button class="catalog-result" type="button" data-catalog-index="${i}" ${busy?'disabled':''}>${bookCover(BookData.coverURL(book.coverId),book.title)}<span><strong>${esc(book.title)}</strong><span>${esc(book.author || 'Author unavailable')}</span><small>${esc(book.year)}</small></span></button>`).join('');
    $('catalog-status').textContent=matches.length?'Choose the book you finished.':'No matches found. Try another title, or add the book manually.';
  }
  async function searchBooks(version) {
    if(busy || version!==catalogVersion) return;
    const query=$('book-search').value.trim();
    if(query.length<2) return;
    if(catalogCache.has(query.toLowerCase())) {showCatalog(catalogCache.get(query.toLowerCase()));return;}
    catalogController=new AbortController();
    const controller=catalogController;
    const timeout=setTimeout(()=>controller.abort(),15000);
    lastSearch=Date.now(); $('catalog-status').textContent='Searching the catalog…';
    try {
      const params=new URLSearchParams({title:query,fields:'key,title,author_name,cover_i,first_publish_year',limit:'8',lang:'en'});
      const response=await fetch('https://openlibrary.org/search.json?'+params,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok) throw Error();
      const matches=BookData.catalogResults(await response.json());
      if(version!==catalogVersion) return;
      catalogCache.set(query.toLowerCase(),matches); showCatalog(matches);
    } catch(error) {
      if(version===catalogVersion) $('catalog-status').textContent='The catalog is unavailable right now. Try Search again, or add the book manually.';
    } finally {clearTimeout(timeout);}
  }
  function queueBookSearch(immediate=false) {
    clearTimeout(catalogTimer); catalogController?.abort(); const version=++catalogVersion;
    catalogMatches=[]; $('catalog-results').innerHTML='';
    if($('book-search').value.trim().length<2) {$('catalog-status').textContent='Enter at least two characters.';return;}
    $('catalog-status').textContent='Looking for matching books…';
    catalogTimer=setTimeout(()=>searchBooks(version),Math.max(immediate?0:650,1100-(Date.now()-lastSearch)));
  }
  $('book-search').oninput=()=>queueBookSearch();
  $('book-search').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();queueBookSearch(true);}};
  $('search-books').onclick=()=>queueBookSearch(true);
  $('catalog-results').onclick=event=>{
    const button=event.target.closest('[data-catalog-index]'); if(!button || busy) return;
    const book=catalogMatches[Number(button.dataset.catalogIndex)]; if(!book) return;
    if(book.catalogKey && state.data.books.some(e=>e.catalogKey===book.catalogKey)) {$('catalog-status').textContent='This book is already on your shelf. Edit its existing entry below.';return;}
    const today=new Date(); today.setMinutes(today.getMinutes()-today.getTimezoneOffset());
    state.data.books.unshift({...book,id:crypto.randomUUID(),status:'Read',finished:today.toISOString().slice(0,10),rating:'',note:'',published:true});
    render(); save().catch(()=>{});
    $('catalog-status').textContent='Added to your draft as finished today. Adjust the date below, then publish when ready.';
    $('book-edit-list').querySelector('input').focus();
  };
  function downloadBackup() {
    const blob = new Blob([JSON.stringify(state)],{type:'application/json'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href=url; a.download='jameskull-studio-'+new Date().toISOString().slice(0,10)+'.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{
    if (busy) return;
    document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    $('books-editor').hidden=button.dataset.tab!=='books'; $('photography-editor').hidden=button.dataset.tab!=='photography';
  });
  document.querySelector('main').addEventListener('input',event=>{
    if (busy || !event.target.dataset.key) return;
    const card = event.target.closest('[data-id]');
    const entry = state.data[card.dataset.kind].find(e=>e.id===card.dataset.id);
    entry[event.target.dataset.key] = event.target.type==='checkbox' ? event.target.checked : event.target.value;
    save().catch(()=>{});
  });
  document.querySelector('main').addEventListener('click',event=>{
    const action = event.target.dataset.action;
    if (!action || busy) return;
    const card = event.target.closest('[data-id]'), entries = state.data[card.dataset.kind];
    const i = entries.findIndex(e=>e.id===card.dataset.id);
    if (action==='remove') {
      if (!confirm('Remove this entry from your draft? The live site changes only when you publish.')) return;
      const [removed] = entries.splice(i,1);
      if (removed.src) { delete state.images[removed.src.slice(1)]; delete state.images[removed.thumb.slice(1)]; }
    } else {
      const j = i+(action==='up'?-1:1);
      if (j<0 || j>=entries.length) return;
      [entries[i],entries[j]]=[entries[j],entries[i]];
    }
    render(); save().catch(()=>{});
  });
  $('add-book').onclick=()=>{
    state.data.books.unshift({id:crypto.randomUUID(),title:'',author:'',status:'Reading',rating:'',finished:'',note:'',published:false});
    render(); save().catch(()=>{}); $('book-edit-list').querySelector('input').focus();
  };
  async function resizePhoto(file) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('Please use JPEG, PNG, or WebP.');
    if (file.size>35*1024*1024) throw Error('Image exceeds 35 MB. Export a smaller JPEG.');
    const bitmap = await createImageBitmap(file,{imageOrientation:'from-image'});
    if (bitmap.width*bitmap.height>100000000) { bitmap.close(); throw Error('Image exceeds 100 megapixels. Export a smaller JPEG.'); }
    function encode(max) {
      const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas'); canvas.width=Math.round(bitmap.width*scale); canvas.height=Math.round(bitmap.height*scale);
      const ctx=canvas.getContext('2d'); ctx.fillStyle='#F7F5F0'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      return {content:canvas.toDataURL('image/jpeg',.86).split(',')[1],width:canvas.width,height:canvas.height};
    }
    try { return {full:encode(2400),thumb:encode(960)}; } finally { bitmap.close(); }
  }
  async function upload(files) {
    if (busy || !state) return;
    if (files.length>20) { $('upload-status').textContent='Choose up to 20 photos at a time.'; return; }
    setBusy(true); let added=0; const errors=[];
    for (const file of files) {
      $('upload-status').textContent='Preparing '+file.name+'…';
      try {
        const photo=await resizePhoto(file); const id=crypto.randomUUID();
        const path='assets/photography/'+id;
        const total=Object.values(state.images).reduce((n,v)=>n+v.length,0)+photo.full.content.length+photo.thumb.content.length;
        if(total>45*1024*1024) throw Error('Publish this batch or remove photos before adding more.');
        state.images[path+'.jpg']=photo.full.content; state.images[path+'-thumb.jpg']=photo.thumb.content;
        state.data.photography.push({id,title:file.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' '),collection:'',location:'',date:'',caption:'',alt:'',src:'/'+path+'.jpg',thumb:'/'+path+'-thumb.jpg',width:photo.full.width,height:photo.full.height,published:false});
        added++;
      } catch(error) { errors.push(file.name+': '+error.message); }
    }
    render(); await save().catch(()=>{}); setBusy(false);
    $('photo-upload').value=''; $('upload-status').textContent=`${added} photo${added===1?'':'s'} added. Add descriptions and check “Include on public site” when ready.`+(errors.length?'\n'+errors.join('\n'):'');
  }
  $('photo-upload').onchange=event=>upload([...event.target.files]);
  const drop=$('drop-zone');
  drop.ondragover=event=>{event.preventDefault();drop.classList.add('dragging');};
  drop.ondragleave=()=>drop.classList.remove('dragging');
  drop.ondrop=event=>{event.preventDefault();drop.classList.remove('dragging');upload([...event.dataTransfer.files]);};
  $('backup').onclick=downloadBackup;
  $('disconnect').onclick=()=>{ $('github-token').value=''; status('GitHub token cleared. Your draft is still saved.'); };
  window.addEventListener('pagehide',()=>{ $('github-token').value=''; });
  $('restore').onchange=async event=>{
    const file=event.target.files[0]; if (!file || busy) return;
    try {
      if(file.size>70*1024*1024) throw Error('Backup is too large.');
      const imported=JSON.parse(await file.text());
      if(imported.version!==1 || !imported.images || typeof imported.images!=='object') throw Error('Unsupported backup.');
      StudioCore.validate(imported.data); StudioCore.validate(imported.baseline);
      for(const [path,content] of Object.entries(imported.images)) if(!StudioCore.imagePath.test(path) || typeof content!=='string' || !/^[A-Za-z0-9+/=]+$/.test(content)) throw Error('Invalid image in backup.');
      if(!confirm('Replace this browser’s draft with the backup? Download the current draft first if you want to keep it.')) return;
      state={version:1,data:imported.data,baseline:imported.baseline,images:imported.images}; render(); await save(); setBusy(false);
    } catch(error) { status('Could not restore: '+error.message); }
    event.target.value='';
  };
  $('reload').onclick=async()=>{
    if(!confirm('Replace your local draft with the published collections? Download a backup first to keep unpublished edits and photos.')) return;
    setBusy(true);
    try { const next=await fetchPublished(); state=next; render(); await save(); status('Loaded the latest published content.'); } catch(error) {status(error.message);} finally {setBusy(false);}
  };
  $('publish').onclick=async()=>{
    if(!$('github-token').value.trim()) { $('connection').open=true; $('github-token').focus(); status('Connect GitHub below to publish.'); return; }
    setBusy(true); $('publish-result').textContent='Publishing your included entries…';
    try {
      const result=await StudioCore.publish({data:state.data,baseline:state.baseline,images:state.images,api});
      state.baseline=structuredClone(result.published);
      // Uploaded images no longer count against the pending upload budget.
      // Keep a memory-only preview while GitHub Pages finishes deploying.
      for (const photo of result.published.photography) {
        for (const path of [photo.src.slice(1),photo.thumb.slice(1)]) {
          if (state.images[path]) { previews[path]=state.images[path]; delete state.images[path]; }
        }
      }
      await save().catch(()=>{});
      $('publish-result').innerHTML=result.unchanged?'No public changes to publish.':`Saved to GitHub. The website will update after deployment finishes. <a href="https://github.com/jkull04/personal_site/actions" target="_blank" rel="noopener">Check deployment ↗</a>`;
    } catch(error) { $('publish-result').textContent=error.message; } finally {setBusy(false);}
  };
  async function init() {
    try {
      db=await new Promise((resolve,reject)=>{const request=indexedDB.open('jameskull-studio',1); request.onupgradeneeded=()=>request.result.createObjectStore('drafts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      state=await new Promise((resolve,reject)=>{const request=db.transaction('drafts').objectStore('drafts').get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      if(!state) {state=await fetchPublished(); await save();}
      StudioCore.validate(state.data); render(); setBusy(false); status('Your draft is ready. Changes save automatically in this browser.');
    } catch(error) { status('Could not open Studio: '+error.message+' Refresh to try again.'); }
  }
  init();
})();
