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
  function finishYear(book) {
    const date=/^(\d{4})-\d{2}-\d{2}$/.exec(book.finished || '');
    return date ? date[1] : /^\d{4}$/.test(String(book.finishedYear || '')) ? String(book.finishedYear) : 'Undated';
  }
  function finishedByYear(books) {
    const groups=new Map();
    for(const book of recentlyFinished(books,Infinity)) {
      const year=finishYear(book);
      if(!groups.has(year)) groups.set(year,[]);
      groups.get(year).push(book);
    }
    return [...groups].sort(([a],[b])=>a==='Undated'?1:b==='Undated'?-1:b.localeCompare(a));
  }
  function addBatch(current,picks,year,makeId) {
    if(!/^\d{4}$/.test(String(year))) throw Error('Enter a four-digit finish year.');
    const books=[...current]; let added=0,skipped=0;
    const norm=value=>String(value || '').trim().toLowerCase();
    for(const book of picks) {
      if(books.some(existing=>(book.catalogKey && existing.catalogKey===book.catalogKey) ||
        (norm(existing.title)===norm(book.title) && (!existing.author || norm(existing.author)===norm(book.author))))) {skipped++;continue;}
      books.push({...book,id:makeId(),status:'Read',finished:'',finishedYear:String(year),rating:'',note:'',published:true}); added++;
    }
    return {books,added,skipped};
  }
  root.BookData = {coverURL,catalogResults,recentlyFinished,finishYear,finishedByYear,addBatch};
  if (typeof module !== 'undefined') module.exports = root.BookData;
})(globalThis);
