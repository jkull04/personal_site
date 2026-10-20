(() => {
  'use strict';
  const list=document.getElementById('collection-list'),dialog=document.getElementById('book-detail');
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let books=[],origin;
  function stars(book) {
    const rating=Number(book.rating);
    if(!Number.isInteger(rating*2)||rating<.5||rating>5)return '';
    return `<span class="book-rating" role="img" aria-label="${rating} out of 5 stars">${Array.from({length:5},(_,i)=>rating>=i+1?'★':rating>i?'<span class="book-star-half" aria-hidden="true">☆</span>':'☆').join('')}</span>`;
  }
  function cover(book) {
    const url=BookData.imageURL(book,'L'),fallback=BookData.imageURL({...book,coverSrc:'',coverId:0},'L');
    return `${url?`<img src="${esc(url)}" alt="Cover of ${esc(book.title)}" data-cover-fallback="${esc(fallback)}" width="240" height="360" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}<span class="book-cover-fallback" ${url?'hidden':''}><span>${esc(book.title)}</span><small>${esc(book.author)}</small></span>`;
  }
  function wireCovers(holder) {
    holder.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{
      if(img.dataset.coverFallback && img.src!==img.dataset.coverFallback){const url=img.dataset.coverFallback;delete img.dataset.coverFallback;img.src=url;return;}
      img.hidden=true;img.nextElementSibling.hidden=false;
    }));
  }
  function openBook(book,button,keyboard) {
    origin=button;
    const date=/^\d{4}-\d{2}-\d{2}$/.test(book.finished||'')?new Date(book.finished+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):(BookData.finishYear(book)==='Undated'?'':BookData.finishYear(book));
    dialog.querySelector('[data-book-content]').innerHTML=`<div class="book-detail-cover">${cover(book)}</div><div class="book-detail-copy"><h2 id="book-detail-title">${esc(book.title)}</h2><p class="book-author">${esc(book.author)}</p><div class="book-detail-meta">${stars(book)}${date?`<span>Finished ${esc(date)}</span>`:''}</div>${book.recommended===true?'<p class="book-recommendation">Especially recommend</p>':''}<div class="book-note">${book.note?.trim()?'<h3>My reading notes</h3><p>'+esc(book.note)+'</p>':'<p class="book-no-note">No reading note added yet.</p>'}</div></div>`;
    wireCovers(dialog);dialog.showModal();document.body.classList.add('book-modal-open');
    dialog.dataset.input=keyboard?'keyboard':'pointer';
    (keyboard?dialog.querySelector('[data-close-book]'):dialog).focus({preventScroll:true});
  }
  dialog?.querySelector('[data-close-book]').addEventListener('click',()=>dialog.close());
  dialog?.addEventListener('close',()=>{document.body.classList.remove('book-modal-open');origin?.focus({preventScroll:true});});
  dialog?.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  list.addEventListener('click',event=>{const button=event.target.closest('[data-book]');if(!button||!dialog)return;const book=books.find(b=>b.id===button.dataset.book);if(book)openBook(book,button,event.detail===0);});
  function openLinkedBook() {
    const book=books.find(b=>window.location.hash==='#book-'+encodeURIComponent(b.id));
    if(!book||!dialog||dialog.open)return;
    const button=[...list.querySelectorAll('[data-book]')].find(node=>node.dataset.book===book.id);
    openBook(book,button,true);
  }
  window.addEventListener('hashchange',openLinkedBook);
  fetch('/data/books.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{
    if(!Array.isArray(data))throw Error();
    const groups=BookData.finishedByYear(data);books=groups.flatMap(([,entries])=>entries);
    list.innerHTML=groups.length?groups.map(([year,entries])=>`<section class="book-year" aria-labelledby="year-${year}"><h2 id="year-${year}">${esc(year)}</h2><div class="book-cover-grid">${entries.map(book=>`<button type="button" class="book-cover" data-book="${esc(book.id)}" aria-haspopup="dialog" aria-label="Read about ${esc(book.title)} by ${esc(book.author)}">${cover(book)}<span class="book-caption">${esc(book.title)}${stars(book)}</span>${book.recommended===true?'<span class="book-recommendation">Especially recommend</span>':''}</button>`).join('')}</div></section>`).join(''):'<p class="books-empty">Finished books will appear here.</p>';
    wireCovers(list);openLinkedBook();
  }).catch(()=>{list.innerHTML='<p>Could not load the bookshelf. Please refresh to try again.</p>';});
})();
