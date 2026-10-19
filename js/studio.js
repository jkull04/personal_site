(async () => {
  'use strict';
  if(!window.StudioAccess) return;
  await StudioAccess.ready;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state, db, busy = false, saveQueue = Promise.resolve();
  const previews = {};
  const status = message => { $('studio-status').textContent = message; };
  function save() {
    StudioAccess.requireUnlocked();
    refreshBookOverview();
    refreshManagementSummary();
    const snapshot = structuredClone(state);
    saveQueue = saveQueue.catch(()=>{}).then(async()=>{
      const encrypted=await StudioAccess.seal(snapshot);
      return new Promise((resolve,reject)=>{
      const tx = db.transaction('drafts','readwrite');
      tx.objectStore('drafts').put(encrypted,'current');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    });
    saveQueue.then(()=>status('Draft saved in this browser. Publish when ready.')).catch(()=>status('Browser storage is full or unavailable. Download a backup now; your latest edits are only in memory.'));
    return saveQueue;
  }
  function setBusy(value) {
    busy = value;
    document.querySelectorAll('#studio-editor button, #studio-editor input, #studio-editor textarea, #studio-editor select').forEach(el=>el.disabled=value);
    updateBatchButton();
    if(state) { refreshManagerOptions(); managedKinds.forEach(updateSelectionControls); }
  }
  async function api(path, method='GET', body) {
    StudioAccess.requireUnlocked();
    const token = $('github-token').value.trim();
    if (!token) throw Error('Paste your GitHub token under GitHub connection to publish.');
    const response = await fetch('https://api.github.com/repos/jkull04/personal_site'+path,{method,headers:{Accept:path.startsWith('/contents/')?'application/vnd.github.raw+json':'application/vnd.github+json',Authorization:'Bearer '+token,'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:body ? JSON.stringify(body) : undefined,cache:'no-store'});
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
    for (const kind of ['books','photography','writings']) {
      const r = await fetch('https://api.github.com/repos/jkull04/personal_site/contents/data/'+(kind==='writings'?'writings-local':kind)+'.json?ref='+ref.object.sha,{cache:'no-store',headers:{Accept:'application/vnd.github.raw+json'}});
      if (!r.ok) throw Error('Cannot load '+kind+' from GitHub. Try again after deployment.');
      data[kind] = await r.json();
    }
    StudioCore.validate(data);
    return {version:1,data,baseline:structuredClone(data),images:{}};
  }
  async function upgradeWritings(value,current) {
    if(value.data.writings===undefined || value.baseline.writings===undefined) {
      const source=current || await fetchPublished();
      value.data.writings=structuredClone(source.data.writings);
      value.baseline.writings=structuredClone(source.baseline.writings);
    }
    return value;
  }
  function field(kind,e,key,label,type='text',wide=false) {
    const id = e.id+'-'+key;
    let control;
    if (type==='textarea') control = `<textarea id="${id}" data-key="${key}" maxlength="10000">${esc(e[key])}</textarea>`;
    else if (type==='status') control = `<select id="${id}" data-key="${key}">${['Reading','Read','Want to read'].map(v=>`<option ${e[key]===v?'selected':''}>${v}</option>`).join('')}</select>`;
    else if (type==='rating') control = `<select id="${id}" data-key="${key}"><option value="">No rating</option>${[1,2,3,4,5].map(v=>`<option value="${v}" ${String(e[key])===String(v)?'selected':''}>${v} / 5</option>`).join('')}</select>`;
    else control = `<input id="${id}" type="${type}" data-key="${key}" value="${esc(e[key])}" maxlength="${['collection','subgroup'].includes(key)?100:500}" ${key==='collection'?'list="photo-groups"':key==='subgroup'?'list="photo-subgroups"':''} />`;
    return `<label class="${wide?'wide':''}" for="${id}">${label}${control}</label>`;
  }
  function actions(kind,e,i) {
    return `<div class="studio-actions"><button type="button" data-action="up" ${i===0?'disabled':''}>Move up</button><button type="button" data-action="down" ${i===state.data[kind].length-1?'disabled':''}>Move down</button><button type="button" data-action="remove">Remove</button></div><label class="checkbox"><input type="checkbox" data-key="published" ${e.published!==false?'checked':''} />Include on public site</label>`;
  }
  function render() {
    const openIds=new Set([...document.querySelectorAll('.edit-card details[open]')].map(d=>d.closest('[data-id]').dataset.id));
    for (const kind of ['books','photography']) {
      const holder = $(kind==='books'?'book-edit-list':'photo-edit-list');
      holder.innerHTML = state.data[kind].map((e,i)=>{
        const fields = kind==='books' ? field(kind,e,'title','Title')+field(kind,e,'author','Author')+field(kind,e,'status','Shelf','status')+field(kind,e,'rating','Rating (optional)','rating')+field(kind,e,'finished','Date finished (optional)','date')+field(kind,e,'finishedYear','Finish year (if date unknown)','number')+field(kind,e,'note','Your reading note','textarea',true) : field(kind,e,'title','Title')+field(kind,e,'collection','Group')+field(kind,e,'subgroup','Subgroup (optional)')+field(kind,e,'location','Place (optional)')+field(kind,e,'date','Date taken (optional)','date')+field(kind,e,'alt','Image description (required when publishing)','text',true)+field(kind,e,'caption','Caption (optional)','textarea',true);
        const thumb = kind==='photography' ? ((state.images[e.thumb.slice(1)] || previews[e.thumb.slice(1)]) ? 'data:image/jpeg;base64,'+(state.images[e.thumb.slice(1)] || previews[e.thumb.slice(1)]) : e.thumb) : BookData.coverURL(e.coverId);
        const cover = kind==='books' ? `<div>${bookCover(thumb,e.title)}<button type="button" data-lookup-book="${e.id}">Find cover &amp; author</button></div>` : (thumb?`<img src="${esc(thumb)}" alt="${esc(e.alt || 'Uploaded photograph preview')}" />`:'');
        return `<article class="edit-card" data-kind="${kind}" data-id="${e.id}"><label class="entry-select"><input type="checkbox" data-select-entry aria-label="Select ${esc(e.title || 'untitled entry')}" ${selection[kind].has(e.id)?'checked':''} /></label><details ${openIds.has(e.id)?'open':''}><summary class="entry-summary">${kind==='books'?bookCover(thumb,e.title):`<img class="entry-thumb" src="${esc(thumb)}" alt="" loading="lazy" />`}<span><strong class="entry-title">${esc(e.title || 'Untitled')}</strong><span class="entry-meta">${esc(entryLabel(kind,e))}</span><span class="entry-state book-badge">${esc(publication(kind,e))}</span></span><span class="entry-edit-hint">Edit</span></summary><div class="${kind==='photography'?'edit-photo':'edit-book'}">${cover}<div><div class="edit-fields">${fields}</div>${actions(kind,e,i)}</div></div></details></article>`;
      }).join('') || `<p>No ${kind==='books'?'books':'photographs'} yet. Add your first one above.</p>`;
    }
    writingEditor.render();
    refreshBookOverview();
    if(catalogMatches.length) showCatalog(catalogMatches,false);
    renderBatch();
    refreshManagerOptions();
    managedKinds.forEach(applyManagerView);
    refreshManagementSummary();
  }
  function bookCover(url,title) {
    return `<div class="catalog-cover">${url?`<img src="${esc(url)}" alt="Cover of ${esc(title)}" loading="lazy" referrerpolicy="no-referrer" />`:''}<span ${url?'hidden':''}>No cover available</span></div>`;
  }
  document.querySelector('main').addEventListener('error',event=>{
    if(event.target.matches('.catalog-cover img')) {
      const img=event.target;
      if(img.src.includes('-M.jpg')) {img.src=img.src.replace('-M.jpg','-L.jpg');return;}
      img.hidden=true;img.nextElementSibling.hidden=false;
    }
  },true);
  let catalogMatches=[], catalogController, catalogTimer, catalogVersion=0, lastSearch=0, catalogTarget='';
  const catalogCache=new Map();
  const existingBook=book=>BookData.findExisting(state.data.books,book);
  const bookStatus=book=>BookData.publicationStatus(book,state.baseline.books);
  function refreshBookOverview() {
    if(!state) return;
    const books=state.data.books;
    $('shelf-count').textContent=`${books.length} book${books.length===1?'':'s'} added`;
    $('shelf-overview').innerHTML=books.map(book=>`<button type="button" class="shelf-item" data-edit-book="${book.id}" ${busy?'disabled':''}>${bookCover(BookData.coverURL(book.coverId),book.title)}<strong>${esc(book.title || 'Untitled book')}</strong><span class="book-badge">${esc(bookStatus(book))}</span></button>`).join('') || '<p>Your added books will appear here.</p>';
  }
  function focusBook(id) {
    const input=$(id+'-title');
    if(input) {const card=input.closest('.edit-card'); card.hidden=false;card.querySelector('details').open=true;input.closest('.edit-card').scrollIntoView({block:'start'});input.focus({preventScroll:true});}
  }
  $('shelf-overview').onclick=event=>{
    const button=event.target.closest('[data-edit-book]');
    if(button && !busy) focusBook(button.dataset.editBook);
  };
  function showCatalog(matches,announce=true) {
    catalogMatches=matches;
    $('catalog-results').innerHTML=matches.map((book,i)=>{
      const existing=existingBook(book);
      const label=catalogTarget ? 'Use this edition' : existing ? '✓ Added · Edit book' : '+ Add book';
      return `<button class="catalog-result ${existing?'is-added':''}" type="button" data-catalog-index="${i}" ${busy?'disabled':''}>${bookCover(BookData.coverURL(book.coverId),book.title)}<span><strong>${esc(book.title)}</strong><span>${esc(book.author || 'Author unavailable')}</span><small>${esc(book.year)}</small><span class="book-badge">${label}</span></span></button>`;
    }).join('');
    if(announce) $('catalog-status').textContent=matches.length?'Choose a book to add. Books already on your shelf are marked.':'No matches found. Try another title, turn off English editions only, or add the book manually.';
  }
  const searchKey=title=>($('english-only').checked?'eng:':'all:')+title.toLowerCase();
  $('english-only').onchange=()=>{
    batchController?.abort();batchRows=[];renderBatch();
    $('batch-status').textContent='Language filter changed. Find books again to refresh batch matches.';
    if($('book-search').value.trim().length>=2) queueBookSearch(true);
  };
  async function searchBooks(version) {
    if(busy || version!==catalogVersion) return;
    const query=$('book-search').value.trim();
    if(query.length<2) return;
    if(catalogCache.has(searchKey(query))) {showCatalog(catalogCache.get(searchKey(query)));return;}
    catalogController=new AbortController();
    const controller=catalogController;
    const timeout=setTimeout(()=>controller.abort(),15000);
    lastSearch=Date.now(); $('catalog-status').textContent='Searching the catalog…';
    try {
      const params=BookData.searchParams(query,$('english-only').checked);
      const response=await fetch('https://openlibrary.org/search.json?'+params,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok) throw Error();
      const matches=BookData.catalogResults(await response.json());
      if(version!==catalogVersion) return;
      catalogCache.set(searchKey(query),matches); showCatalog(matches);
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
  $('book-search').oninput=()=>{catalogTarget='';queueBookSearch();};
  $('book-search').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();queueBookSearch(true);}};
  $('search-books').onclick=()=>queueBookSearch(true);
  document.querySelector('main').addEventListener('click',event=>{
    const button=event.target.closest('[data-lookup-book]'); if(!button || busy) return;
    const entry=state.data.books.find(book=>book.id===button.dataset.lookupBook); if(!entry) return;
    catalogTarget=entry.id; $('book-search').value=entry.title; queueBookSearch(true);
    $('book-search').scrollIntoView({block:'center'}); $('book-search').focus();
  });
  $('catalog-results').onclick=event=>{
    const button=event.target.closest('[data-catalog-index]'); if(!button || busy) return;
    const book=catalogMatches[Number(button.dataset.catalogIndex)]; if(!book) return;
    const duplicate=existingBook(book);
    if(duplicate && duplicate.id!==catalogTarget) {
      $('catalog-status').textContent=`“${duplicate.title}” is already added. ${bookStatus(duplicate)}.`;
      focusBook(duplicate.id);return;
    }
    const existing=state.data.books.find(e=>e.id===catalogTarget);
    if(existing) {
      undoDraft=null;Object.assign(existing,book); catalogTarget=''; render(); save().catch(()=>{});
      $('catalog-status').textContent='Author and cover filled in. Your shelf, date, and notes are unchanged.';
      focusBook(existing.id); return;
    }
    const today=new Date(); today.setMinutes(today.getMinutes()-today.getTimezoneOffset());
    undoDraft=null;state.data.books.unshift({...book,id:crypto.randomUUID(),status:'Read',finished:today.toISOString().slice(0,10),rating:'',note:'',published:true});
    render(); save().catch(()=>{});
    $('catalog-status').textContent='Added to your draft as finished today. Adjust the date below, then publish when ready.';
    $('catalog-results').querySelector(`[data-catalog-index="${button.dataset.catalogIndex}"]`)?.focus({preventScroll:true});
  };
  let batchRows=[], batchController;
  $('batch-year').value=String(new Date().getFullYear());
  function pendingBatchPicks() {
    const picks=[];
    for(const row of batchRows) {
      const book=row.selected===null ? null : row.matches[row.selected];
      if(book && !existingBook(book) && !BookData.findExisting(picks,book)) picks.push(book);
    }
    return picks;
  }
  function updateBatchButton() {
    const count=pendingBatchPicks().length;
    $('batch-add').hidden=!batchRows.some(row=>row.matches.length);
    $('batch-add').disabled=busy || !count;
    $('batch-add').textContent=count ? `Add ${count} book${count===1?'':'s'}` : 'Choose books to add';
  }
  function renderBatch() {
    $('batch-results').innerHTML=batchRows.map((row,i)=>{
      const book=row.selected===null ? null : row.matches[row.selected];
      const existing=book && existingBook(book);
      return `<div class="batch-row ${existing?'is-added':''}"><div>${bookCover(book?BookData.coverURL(book.coverId):'',book?.title || row.title)}</div><div><label for="batch-match-${i}">${esc(row.title)}</label><select id="batch-match-${i}" data-batch-row="${i}" ${busy?'disabled':''}><option value="">${row.error?'Search unavailable — retry below':'Choose a match or leave out'}</option>${row.matches.map((match,j)=>`<option value="${j}" ${row.selected===j?'selected':''}>${existingBook(match)?'✓ Already added · ':''}${esc(match.title)} — ${esc(match.author || 'Unknown author')}${match.year?' ('+esc(match.year)+')':''}</option>`).join('')}</select><p class="book-badge">${existing?'✓ Added · '+esc(bookStatus(existing)):book?'Selected · not added yet':'Not added · choose a match'}</p></div></div>`;
    }).join('');
    updateBatchButton();
  }
  $('batch-results').onchange=event=>{
    if(busy || !event.target.matches('[data-batch-row]')) return;
    const index=Number(event.target.dataset.batchRow); if(!Number.isInteger(index) || !batchRows[index]) return;
    batchRows[index].selected=event.target.value===''?null:Number(event.target.value);
    renderBatch();$('batch-match-'+index).focus({preventScroll:true});
  };
  $('batch-cancel').onclick=()=>batchController?.abort();
  $('batch-find').onclick=async()=>{
    if(busy) return;
    const titles=$('batch-titles').value.split(/\r?\n/).map(title=>title.trim()).filter(Boolean);
    if(!titles.length || titles.length>20) {$('batch-status').textContent='Enter between 1 and 20 titles, one per line.';return;}
    if(!/^\d{4}$/.test($('batch-year').value)) {$('batch-status').textContent='Enter a four-digit finish year.';return;}
    clearTimeout(catalogTimer); catalogController?.abort(); ++catalogVersion;
    batchRows=[]; renderBatch(); batchController=new AbortController();
    const signal=batchController.signal;
    setBusy(true); $('batch-cancel').hidden=false; $('batch-cancel').disabled=false;
    let failures=0;
    try {
      for(const [i,title] of titles.entries()) {
        if(signal.aborted) break;
        $('batch-status').textContent=`Finding ${i+1} of ${titles.length}: ${title}…`;
        let matches=catalogCache.get(searchKey(title)),failed=false;
        if(!matches) {
          await new Promise(resolve=>setTimeout(resolve,Math.max(0,1100-(Date.now()-lastSearch))));
          if(signal.aborted) break;
          const request=new AbortController();
          const abort=()=>request.abort(); signal.addEventListener('abort',abort,{once:true});
          const timeout=setTimeout(abort,15000);
          try {
            lastSearch=Date.now();
            const params=BookData.searchParams(title,$('english-only').checked);
            const response=await fetch('https://openlibrary.org/search.json?'+params,{signal:request.signal,credentials:'omit',referrerPolicy:'no-referrer'});
            if(!response.ok) throw Error();
            matches=BookData.catalogResults(await response.json());catalogCache.set(searchKey(title),matches);
          } catch(error) {if(signal.aborted) break; matches=[];failed=true;failures++;}
          finally {clearTimeout(timeout);signal.removeEventListener('abort',abort);}
        }
        batchRows.push({title,matches,selected:null,error:failed});
      }
    } finally {
      renderBatch();setBusy(false);$('batch-cancel').hidden=true;
      $('batch-status').textContent=(signal.aborted?'Search cancelled. ':'')+`Found results for ${batchRows.filter(row=>row.matches.length).length} of ${titles.length} titles. Choose a match for each book you want to add.`+(failures?' Some searches failed; Find books retries them.':'');
    }
  };
  $('batch-add').onclick=()=>{
    if(busy) return;
    const picks=batchRows.filter(row=>row.selected!==null).map(row=>row.matches[row.selected]).filter(Boolean);
    if(!picks.length) {$('batch-status').textContent='Choose at least one catalog match first.';return;}
    try {
      const result=BookData.addBatch(state.data.books,picks,$('batch-year').value,()=>crypto.randomUUID());
      undoDraft=null;state.data.books=result.books;render();save().catch(()=>{});
      renderBatch();
      $('batch-status').textContent=`${result.added} books added to your draft for ${$('batch-year').value}. ${result.skipped?result.skipped+' already on your shelf were skipped. ':''}Publish when ready.`;
    } catch(error) {$('batch-status').textContent=error.message;}
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
    $('books-editor').hidden=button.dataset.tab!=='books'; $('photography-editor').hidden=button.dataset.tab!=='photography'; $('writings-editor').hidden=button.dataset.tab!=='writings';
  });
  document.querySelector('main').addEventListener('input',event=>{
    if (busy || !event.target.dataset.key) return;
    const card = event.target.closest('[data-id]');
    const entry = state.data[card.dataset.kind].find(e=>e.id===card.dataset.id);
    undoDraft=null;managedKinds.forEach(updateSelectionControls);
    entry[event.target.dataset.key] = event.target.type==='checkbox' ? event.target.checked : event.target.value;
    if(card.dataset.kind==='photography' && event.target.dataset.key==='collection' && !entry.collection.trim()) {entry.subgroup='';$(entry.id+'-subgroup').value='';}
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
    undoDraft=null;selection[card.dataset.kind].delete(card.dataset.id);
    render(); save().catch(()=>{});
  });
  $('add-book').onclick=()=>{
    undoDraft=null;
    state.data.books.unshift({id:crypto.randomUUID(),title:'',author:'',status:'Reading',rating:'',finished:'',note:'',published:false});
    render(); save().catch(()=>{}); focusBook(state.data.books[0].id);
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
    if($('upload-subgroup').value.trim() && !$('upload-group').value.trim()) { $('upload-status').textContent='Choose a group before adding a subgroup.'; return; }
    if (files.length>20) { $('upload-status').textContent='Choose up to 20 photos at a time.'; return; }
    undoDraft=null;setBusy(true); let added=0; const errors=[];
    for (const file of files) {
      $('upload-status').textContent='Preparing '+file.name+'…';
      try {
        const photo=await resizePhoto(file); const id=crypto.randomUUID();
        const path='assets/photography/'+id;
        const total=Object.values(state.images).reduce((n,v)=>n+v.length,0)+photo.full.content.length+photo.thumb.content.length;
        if(total>45*1024*1024) throw Error('Publish this batch or remove photos before adding more.');
        state.images[path+'.jpg']=photo.full.content; state.images[path+'-thumb.jpg']=photo.thumb.content;
        state.data.photography.push({id,title:file.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' '),collection:$('upload-group').value.trim(),subgroup:$('upload-subgroup').value.trim(),location:'',date:'',caption:'',alt:'',src:'/'+path+'.jpg',thumb:'/'+path+'-thumb.jpg',width:photo.full.width,height:photo.full.height,published:false});
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
  $('lock-studio').onclick=async()=>{
    if(busy) return;
    setBusy(true);
    try {
      await saveQueue;
      $('github-token').value=''; StudioStorage.clear(); StudioAccess.lock(); location.reload();
    } catch { status('Draft could not be saved. Download a backup before locking.'); setBusy(false); }
  };
  $('backup').onclick=downloadBackup;
  $('disconnect').onclick=()=>{ $('github-token').value=''; status('GitHub token cleared. Your draft is still saved.'); };
  window.addEventListener('pagehide',()=>{ $('github-token').value=''; });
  $('restore').onchange=async event=>{
    const file=event.target.files[0]; if (!file || busy) return;
    try {
      if(file.size>70*1024*1024) throw Error('Backup is too large.');
      const imported=JSON.parse(await file.text());
      if(imported.version!==1 || !imported.images || typeof imported.images!=='object') throw Error('Unsupported backup.');
      await upgradeWritings(imported,state);
      StudioCore.validate(imported.data); StudioCore.validate(imported.baseline);
      for(const [path,content] of Object.entries(imported.images)) if(!StudioCore.imagePath.test(path) || typeof content!=='string' || !/^[A-Za-z0-9+/=]+$/.test(content)) throw Error('Invalid image in backup.');
      if(!confirm('Replace this browser’s draft with the backup? Download the current draft first if you want to keep it.')) return;
      state={version:1,data:imported.data,baseline:imported.baseline,images:imported.images}; undoDraft=null;managedKinds.forEach(k=>selection[k].clear());render(); await save(); setBusy(false);
    } catch(error) { status('Could not restore: '+error.message); }
    event.target.value='';
  };
  $('reload').onclick=async()=>{
    if(!confirm('Replace your local draft with the published collections? Download a backup first to keep unpublished edits and photos.')) return;
    setBusy(true);
    try { const next=await fetchPublished(); state=next;undoDraft=null;managedKinds.forEach(k=>selection[k].clear());render(); await save(); status('Loaded the latest published content.'); } catch(error) {status(error.message);} finally {setBusy(false);}
  };
  async function publishUpdates(migrate=false) {
    if(busy)return;
    try {await StudioStorage.ready;} catch(error) {status(error.message);return;}
    if(!StudioStorage.enabled && !$('github-token').value.trim()) { $('connection').open=true; $('github-token').focus(); status('Connect GitHub below to publish.'); return; }
    setBusy(true); $('publish-result').textContent='Publishing your included entries…';
    try {
      const previousPhotos=structuredClone(state.data.photography);
      const result=StudioStorage.enabled
        ? await StudioStorage.publish({data:state.data,baseline:state.baseline,images:state.images,migrate,progress:text=>$('publish-result').textContent=text})
        : await StudioCore.publish({data:state.data,baseline:state.baseline,images:state.images,api});
      state.baseline=structuredClone(result.published);
      writingEditor.render();
      undoDraft=null;
      // Uploaded images no longer count against the pending upload budget.
      // Keep a memory-only preview while GitHub Pages finishes deploying.
      for (const photo of previousPhotos.filter(p=>result.published.photography.some(e=>e.id===p.id))) {
        for (const path of [photo.src.slice(1),photo.thumb.slice(1)]) {
          if (state.images[path]) { previews[path]=state.images[path]; delete state.images[path]; }
        }
      }
      for(const photo of result.published.photography) {
        const local=state.data.photography.find(p=>p.id===photo.id);
        if(local) {local.src=photo.src;local.thumb=photo.thumb;}
      }
      render();
      const retained=new Set(state.data.photography.flatMap(p=>[p.src.slice(1),p.thumb.slice(1)]));
      for(const path of Object.keys(state.images)) if(!retained.has(path)) delete state.images[path];
      await save().catch(()=>{});
      if(StudioStorage.enabled) refreshStorage();
      $('publish-result').innerHTML=result.unchanged?'No public changes to publish.':`Saved to GitHub. The website will update after deployment finishes. <a href="https://github.com/jkull04/personal_site/actions" target="_blank" rel="noopener">Check deployment ↗</a>`;
    } catch(error) { $('publish-result').textContent=error.message; } finally {setBusy(false);}
  };
  $('publish').onclick=()=>publishUpdates();
  $('storage-migrate').onclick=()=>{
    if(confirm('Move included photos to cloud storage and publish your current included changes? Existing photos stay available during deployment.')) publishUpdates(true);
  };
  async function refreshStorage() {
    try {const usage=await StudioStorage.usage();$('storage-status').textContent=`Cloud photos: ${(usage.bytes/1000000000).toFixed(3)} / 8 GB reserved · ${usage.objects} image files · ${usage.daily.writes}/1,000 uploads today. `+(usage.bytes>=usage.limits.warningBytes?'Storage is nearing its safety limit. New uploads stop at 8 GB.':'Safety limits active. Uncached image requests stop at 20,000 per day.');}
    catch(error) {$('storage-status').textContent=error.message;}
  }
  $('storage-refresh').onclick=refreshStorage;
  StudioStorage.ready.then(config=>{
    $('connection').hidden=config.enabled;
    $('cloud-storage').hidden=!config.enabled;
    if(config.enabled) refreshStorage();
  }).catch(error=>status(error.message));
  const selection = {books:new Set(), photography:new Set()};
  let undoDraft = null;
  const managedKinds = ['books','photography'];
  const managerValue = (kind, key) => $(kind+'-'+key).value;
  const selectedGroup = value => value === '' ? undefined : JSON.parse(value);
  function entryLabel(kind, entry) {
    if(kind === 'books') return [entry.author, entry.status, BookData.finishYear(entry)].filter(Boolean).join(' · ');
    return [PhotoData.group(entry) || 'Ungrouped', PhotoData.subgroup(entry), entry.location].filter(Boolean).join(' · ');
  }
  function publication(kind, entry) {
    if(kind === 'books') return bookStatus(entry);
    const saved=state.baseline[kind].find(e=>e.id===entry.id);
    if(entry.published===false) return saved ? 'Removal pending' : 'Private draft';
    if(!saved) return 'Not published';
    return JSON.stringify(entry)===JSON.stringify(saved) ? 'Published' : 'Changes to publish';
  }
  function setupManagers() {
    for(const kind of managedKinds) {
      const photo=kind==='photography';
      const field=(key,label,control)=>`<label for="${kind}-${key}">${label}${control.replace('CONTROL',`id="${kind}-${key}"`)}</label>`;
      const select=(key,label,options)=>field(key,label,`<select CONTROL>${options}</select>`);
      const option=(value,label)=>`<option value="${value}">${label}</option>`;
      $(kind+'-manager').innerHTML=`<section class="manager-panel" aria-label="Manage ${photo?'photos':'books'}"><h3>Manage ${photo?'photos':'books'}</h3><div class="manager-filters">
        ${field('search','Search your '+(photo?'photos':'shelf'),'<input CONTROL type="search" placeholder="'+(photo?'Title, place, group…':'Title or author…')+'" />')}
        ${select('visibility','Visibility',option('','All entries')+option('pending','Pending changes')+option('included','Included on site')+option('private','Private drafts'))}
        ${photo?select('group','Group',option('','All groups'))+select('subgroup','Subgroup',option('','All subgroups')):select('shelf','Reading status',option('','All statuses')+['Read','Reading','Want to read'].map(v=>option(v,v)).join(''))+select('year','Year finished',option('','All years'))}
        ${select('sort','Sort',option('order','Your order')+option('title','Title A–Z')+option('date','Newest '+(photo?'photo':'finish')+' first'))}
      </div><p id="${kind}-count" role="status"></p><div class="studio-actions"><button type="button" data-manage="select" data-kind="${kind}">Select shown</button><button type="button" data-manage="clear" data-kind="${kind}">Clear selection</button><button type="button" data-manage="undo" data-kind="${kind}" disabled>Undo last bulk action</button></div>
      <details class="bulk-panel"><summary>Update selected <span id="${kind}-selected">(0)</span></summary><p>Changes affect every selected entry. Publish when ready.</p><div class="manager-filters">
      ${photo?field('move-group','Move to group','<input CONTROL list="photo-groups" maxlength="100" placeholder="Blank = ungrouped" />')+field('move-subgroup','Move to subgroup','<input CONTROL list="photo-subgroups" maxlength="100" placeholder="Optional" />'):select('bulk-shelf','Reading status',option('','Keep current')+['Read','Reading','Want to read'].map(v=>option(v,v)).join(''))+field('bulk-year','Finish year (replaces exact date)','<input CONTROL type="number" min="1000" max="9999" placeholder="Keep current" />')+select('bulk-rating','Rating',option('','Keep current')+option('none','No rating')+[1,2,3,4,5].map(v=>option(v,v+' / 5')).join(''))}
      </div><div class="studio-actions"><button type="button" data-manage="apply" data-kind="${kind}">${photo?'Move selected':'Apply to selected'}</button><button type="button" data-manage="include" data-kind="${kind}">Include on site</button><button type="button" data-manage="private" data-kind="${kind}">Make private</button><button type="button" data-manage="remove" data-kind="${kind}">Remove selected</button></div></details>
      ${photo?'<details class="group-tools"><summary>Rename a group or subgroup</summary><p>Choose a group in the filters above. Select a subgroup too to rename only that subgroup. Matching photos move together; an existing name combines the groups.</p><label for="rename-group">New name<input id="rename-group" maxlength="100" /></label><button type="button" data-manage="rename" data-kind="photography">Rename filtered group</button></details>':''}<p id="${kind}-feedback" role="status"></p></section>`;
      for(const key of ['search','visibility','sort',...(photo?['group','subgroup']:['shelf','year'])]) {
        $(kind+'-'+key).addEventListener(key==='search'?'input':'change',()=>{
          selection[kind].clear();
          if(key==='group') { $(kind+'-subgroup').value=''; refreshManagerOptions(); }
          applyManagerView(kind);
        });
      }
    }
  }
  function optionList(id, values, label, blankLabel) {
    const select=$(id), previous=select.value;
    select.replaceChildren(new Option(label,''));
    values.forEach(value=>select.add(new Option(value || blankLabel,JSON.stringify(value))));
    select.value=[...select.options].some(o=>o.value===previous)?previous:'';
  }
  function refreshManagerOptions() {
    if(!state) return;
    optionList('books-year',[...new Set(state.data.books.map(BookData.finishYear))].sort().reverse(),'All years');
    const groups=[...new Set(state.data.photography.map(PhotoData.group))].sort();
    optionList('photography-group',groups,'All groups','Ungrouped');
    const parent=selectedGroup(managerValue('photography','group'));
    optionList('photography-subgroup',[...new Set(state.data.photography.filter(e=>parent!==undefined && PhotoData.group(e)===parent).map(PhotoData.subgroup))].sort(),'All subgroups','No subgroup');
    $('photography-subgroup').disabled=busy || parent===undefined;
    $('photo-groups').innerHTML=groups.filter(Boolean).map(v=>`<option value="${esc(v)}"></option>`).join('');
    $('photo-subgroups').innerHTML=[...new Set(state.data.photography.map(PhotoData.subgroup))].filter(Boolean).sort().map(v=>`<option value="${esc(v)}"></option>`).join('');
  }
  function managerEntries(kind) {
    const term=managerValue(kind,'search').trim().toLowerCase(), visibility=managerValue(kind,'visibility');
    let entries=state.data[kind].filter(e=>{
      if(![e.title,e.author,e.location,e.caption,e.note,e.collection,e.subgroup].join(' ').toLowerCase().includes(term)) return false;
      if(visibility==='private' && e.published!==false || visibility==='included' && e.published===false) return false;
      if(visibility==='pending' && ['Published','Published · not finished','Private draft'].includes(publication(kind,e))) return false;
      if(kind==='photography') return PhotoData.matches(e,selectedGroup(managerValue(kind,'group')),selectedGroup(managerValue(kind,'subgroup')));
      return (!managerValue(kind,'shelf') || e.status===managerValue(kind,'shelf')) && (!managerValue(kind,'year') || BookData.finishYear(e)===selectedGroup(managerValue(kind,'year')));
    });
    const sort=managerValue(kind,'sort');
    if(sort==='title') entries.sort((a,b)=>(a.title||'').localeCompare(b.title||''));
    if(sort==='date') entries.sort((a,b)=>String(b.finished||b.finishedYear||b.date||'').localeCompare(String(a.finished||a.finishedYear||a.date||'')));
    return entries;
  }
  function updateSelectionControls(kind) {
    const size=selection[kind].size;
    $(kind+'-selected').textContent=`(${size})`;
    document.querySelectorAll(`[data-manage][data-kind="${kind}"]`).forEach(button=>{
      const action=button.dataset.manage;
      button.disabled=busy || (action==='undo'? !undoDraft : ['clear','apply','include','private','remove'].includes(action)?!size:false);
    });
    document.querySelectorAll(`.edit-card[data-kind="${kind}"] [data-select-entry]`).forEach(input=>input.checked=selection[kind].has(input.closest('[data-id]').dataset.id));
  }
  function applyManagerView(kind) {
    if(!state) return;
    const entries=managerEntries(kind), ids=new Set(entries.map(e=>e.id));
    const holder=$(kind==='books'?'book-edit-list':'photo-edit-list');
    const cards=new Map([...holder.querySelectorAll('.edit-card')].map(card=>[card.dataset.id,card]));
    cards.forEach((card,id)=>card.hidden=!ids.has(id));
    entries.forEach(e=>{if(cards.has(e.id))holder.append(cards.get(e.id));});
    $(''+kind+'-count').textContent=`${entries.length} of ${state.data[kind].length} ${kind==='books'?'books':'photos'} shown`;
    updateSelectionControls(kind);
  }
  function refreshManagementSummary() {
    if(!state) return;
    let pending=0, included=0;
    for(const kind of managedKinds) {
      for(const entry of state.data[kind]) {
        if(entry.published!==false) included++;
        if(['Removal pending','Not published','Changes to publish'].includes(publication(kind,entry))) pending++;
        const card=document.querySelector(`.edit-card[data-id="${entry.id}"]`);
        if(card) {
          card.querySelector('.entry-title').textContent=entry.title || 'Untitled';
          card.querySelector('.entry-meta').textContent=entryLabel(kind,entry);
          card.querySelector('.entry-state').textContent=publication(kind,entry);
        }
      }
      pending+=state.baseline[kind].filter(e=>!state.data[kind].some(d=>d.id===e.id)).length;
    }
    for(const entry of state.data.writings || []) {
      if(entry.published!==false) included++;
      if(['Removal pending','Not published','Changes to publish'].includes(publication('writings',entry))) pending++;
    }
    pending+=(state.baseline.writings || []).filter(e=>!state.data.writings.some(d=>d.id===e.id)).length;
    writingEditor.refresh();
    $('draft-summary').textContent=`${pending} pending ${pending===1?'change':'changes'} · ${included} entries included in the next publish`;
  }
  function rememberBulk() { undoDraft=structuredClone(state.data); }
  document.querySelector('main').addEventListener('change',event=>{
    if(busy) return;
    if(event.target.matches('[data-select-entry]')) {
      const card=event.target.closest('[data-id]'), chosen=selection[card.dataset.kind];
      event.target.checked?chosen.add(card.dataset.id):chosen.delete(card.dataset.id);
      updateSelectionControls(card.dataset.kind);
    }
    if(event.target.dataset.key) {refreshManagerOptions();}
  });
  document.querySelector('main').addEventListener('click',event=>{
    const button=event.target.closest('[data-manage]'); if(!button || busy) return;
    const kind=button.dataset.kind, action=button.dataset.manage, ids=selection[kind];
    try {
      if(action==='select') { managerEntries(kind).forEach(e=>ids.add(e.id)); updateSelectionControls(kind); return; }
      if(action==='clear') {ids.clear();updateSelectionControls(kind);return;}
      if(action==='undo') {
        if(!undoDraft) return;
        state.data=undoDraft;undoDraft=null;
        managedKinds.forEach(k=>selection[k].clear());
      } else if(action==='rename') {
        const parent=selectedGroup(managerValue(kind,'group')), child=selectedGroup(managerValue(kind,'subgroup'));
        if(parent===undefined || !parent) throw Error('Choose a named group in the filters first.');
        const next=PhotoData.rename(state.data.photography,parent,child,$('rename-group').value);
        rememberBulk();state.data.photography=next;
        $('photography-group').value='';$('photography-subgroup').value='';
      } else {
        if(!ids.size) throw Error('Select at least one entry first.');
        let next=state.data[kind];
        if(action==='remove') {
          if(!confirm(`Remove ${ids.size} selected ${kind==='books'?'books':'photos'} from this draft? You can undo this before publishing.`)) return;
          next=next.filter(e=>!ids.has(e.id));
        } else if(action==='apply' && kind==='photography') {
          next=PhotoData.move(next,ids,managerValue(kind,'move-group'),managerValue(kind,'move-subgroup'));
        } else {
          const patch={};
          if(action==='include' || action==='private') patch.published=action==='include';
          else {
            const year=managerValue(kind,'bulk-year'), shelf=managerValue(kind,'bulk-shelf'), rating=managerValue(kind,'bulk-rating');
            if(year && !/^\d{4}$/.test(year)) throw Error('Enter a four-digit finish year.');
            if(year) Object.assign(patch,{finished:'',finishedYear:year});
            if(shelf) patch.status=shelf;
            if(rating) patch.rating=rating==='none'?'':rating;
            if(!Object.keys(patch).length) throw Error('Choose at least one field to update.');
          }
          next=next.map(e=>ids.has(e.id)?{...e,...patch}:e);
        }
        const data={...state.data,[kind]:next};StudioCore.validate(data);
        rememberBulk();state.data=data;
        if(action==='remove') ids.clear();
      }
      render();save().catch(()=>{});
      $(kind+'-feedback').textContent=action==='undo'?'Restored the draft from before the last bulk action.':'Draft updated. Review your entries, then publish when ready.';
    } catch(error) {$(kind+'-feedback').textContent=error.message;}
  });
  const writingEditor=createWritingEditor({getState:()=>state,save,isBusy:()=>busy,onChange:()=>{undoDraft=null;managedKinds.forEach(updateSelectionControls);}});
  setupManagers();

  async function init() {
    try {
      db=await new Promise((resolve,reject)=>{const request=indexedDB.open('jameskull-studio',1); request.onupgradeneeded=()=>request.result.createObjectStore('drafts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      state=await new Promise((resolve,reject)=>{const request=db.transaction('drafts').objectStore('drafts').get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      state=await StudioAccess.open(state);
      if(!state) state=await fetchPublished();
      await upgradeWritings(state);
      StudioCore.validate(state.data);
      await save();
      StudioCore.validate(state.data); render(); setBusy(false); status('Your draft is ready. Changes save automatically in this browser.');
    } catch(error) { status('Could not open Studio: '+error.message+' Refresh to try again.'); }
  }
  setBusy(true);
  init();
})();
