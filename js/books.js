(() => {
  'use strict';
  const list = document.getElementById('collection-list');
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  fetch('/data/books.json',{cache:'no-store'}).then(response=>{if(!response.ok) throw Error(); return response.json();}).then(data=>{
    if(!Array.isArray(data)) throw Error();
    const groups = BookData.finishedByYear(data);
    list.innerHTML = groups.length ? groups.map(([year,books])=>`<section class="book-year" aria-labelledby="year-${year}"><h2 id="year-${year}">${esc(year)}</h2><div class="book-cover-grid">${books.map(book=>{
      const cover=BookData.imageURL(book,'L');
      const fallback=BookData.imageURL({...book,coverSrc:'',coverId:0},'L');
      const label=[book.title,book.author].filter(Boolean).join(' — ');
      const rating=Number(book.rating);
      const stars=Number.isInteger(rating) && rating>=1 && rating<=5 ? `<span class="book-rating" role="img" aria-label="${rating} out of 5 stars" title="${rating} out of 5 stars">${'★'.repeat(rating)}${'☆'.repeat(5-rating)}</span>` : '';
      return `<figure class="book-cover" title="${esc(label)}">${cover?`<img src="${esc(cover)}" alt="${esc(label)}" data-cover-fallback="${esc(fallback)}" width="240" height="360" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`:''}<div class="book-cover-fallback" ${cover?'hidden':''}><span>${esc(book.title)}</span><small>Cover unavailable</small></div><figcaption class="book-caption">${esc(book.title)}${stars}</figcaption></figure>`;
    }).join('')}</div></section>`).join('') : '<p class="books-empty">Finished books will appear here.</p>';
    list.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{if(img.dataset.coverFallback && img.src!==img.dataset.coverFallback){const fallback=img.dataset.coverFallback;delete img.dataset.coverFallback;img.src=fallback;return;}img.hidden=true;img.nextElementSibling.hidden=false;}));
  }).catch(()=>{list.innerHTML='<p>Could not load the bookshelf. Please refresh to try again.</p>';});
})();
