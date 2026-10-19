((root) => {
  'use strict';
  const coverURL = (value, size='M') => Number.isSafeInteger(Number(value)) && Number(value)>0
    ? `https://covers.openlibrary.org/b/id/${Number(value)}-${size === 'L' ? 'L' : 'M'}.jpg?default=false` : '';
  function catalogResults(data) {
    return (Array.isArray(data?.docs) ? data.docs : []).filter(book => typeof book.title === 'string').slice(0,8).map(book => ({
      title: book.title.slice(0,500),
      author: (Array.isArray(book.author_name) ? book.author_name.filter(a=>typeof a==='string').join(', ') : '').slice(0,500),
      catalogKey: /^\/?(?:works\/)?OL\d+W$/.test(book.key || '') ? '/works/'+book.key.split('/').pop() : '',
      coverId: coverURL(book.cover_i) ? Number(book.cover_i) : 0,
      year: Number.isInteger(book.first_publish_year) ? String(book.first_publish_year) : ''
    }));
  }
  function recentlyFinished(books, limit=12) {
    return books.filter(book=>book.published!==false && book.status==='Read')
      .map((book,index)=>({book,index}))
      .sort((a,b)=>String(b.book.finished || '').localeCompare(String(a.book.finished || '')) || a.index-b.index)
      .slice(0,limit).map(({book})=>book);
  }
  root.BookData = {coverURL,catalogResults,recentlyFinished};
  if (typeof module !== 'undefined') module.exports = root.BookData;
})(globalThis);
