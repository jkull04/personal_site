(() => {
  'use strict';
  const list = document.getElementById('collection-list');
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  fetch('/data/books.json',{cache:'no-store'}).then(response=>{if(!response.ok) throw Error(); return response.json();}).then(data=>{
    if(!Array.isArray(data)) throw Error();
    const groups = BookData.finishedByYear(data);
    list.innerHTML = groups.length ? groups.map(([year,books])=>`<section class="book-year" aria-labelledby="year-${year}"><h2 id="year-${year}">${esc(year)}</h2><div class="book-cover-grid">${books.map(book=>{
      const cover=BookData.coverURL(book.coverId,'L');
      const label=[book.title,book.author].filter(Boolean).join(' — ');
      return `<figure class="book-cover" title="${esc(label)}">${cover?`<img src="${esc(cover)}" alt="${esc(label)}" width="240" height="360" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`:''}<div class="book-cover-fallback" ${cover?'hidden':''}><span>${esc(book.title)}</span><small>Cover unavailable</small></div><figcaption class="book-caption">${esc(book.title)}</figcaption></figure>`;
    }).join('')}</div></section>`).join('') : '<p class="books-empty">Finished books will appear here.</p>';
    list.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;img.nextElementSibling.hidden=false;}));
  }).catch(()=>{list.innerHTML='<p>Could not load the bookshelf. Please refresh to try again.</p>';});
})();
