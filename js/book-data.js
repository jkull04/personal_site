((root) => {
  'use strict';
  const coverURL = (value, size='M') => Number.isSafeInteger(Number(value)) && Number(value)>0
    ? `https://covers.openlibrary.org/b/id/${Number(value)}-${size === 'L' ? 'L' : 'M'}.jpg?default=false` : '';
  function catalogResults(data) {
    return (Array.isArray(data?.docs) ? data.docs : []).filter(book => typeof book.title === 'string').slice(0,8).map(book => {
      const edition=book.editions?.docs?.find(e=>e.language?.includes('eng')) || book.editions?.docs?.[0];
      return {
      title: (typeof edition?.title==='string' ? edition.title : book.title).slice(0,500),
      author: (Array.isArray(book.author_name) ? book.author_name.filter(a=>typeof a==='string').join(', ') : '').slice(0,500),
      catalogKey: /^\/?(?:works\/)?OL\d+W$/.test(book.key || '') ? '/works/'+book.key.split('/').pop() : '',
      coverId: coverURL(edition?.cover_i) ? Number(edition.cover_i) : coverURL(book.cover_i) ? Number(book.cover_i) : 0,
      year: Number.isInteger(book.first_publish_year) ? String(book.first_publish_year) : ''
    }; });
  }
  function searchParams(title,english=true) {
    const quoted=String(title).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
    return new URLSearchParams({q:`title:"${quoted}"${english?' language:eng':''}`,fields:'key,title,author_name,cover_i,first_publish_year,editions,editions.title,editions.cover_i,editions.language',limit:'8',lang:'en'});
  }
  function findExisting(books,book) {
    const norm=value=>String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
    return books.find(existing=>(book.catalogKey && existing.catalogKey===book.catalogKey) ||
      (norm(book.title) && norm(existing.title)===norm(book.title) && (!existing.author || norm(existing.author)===norm(book.author))));
  }
  function publicationStatus(book,baseline) {
    const saved=baseline.find(e=>e.id===book.id);
    if(book.published===false) return saved ? 'Removal pending' : 'Private draft';
    if(!saved) return 'Not published';
    const keys=new Set([...Object.keys(book),...Object.keys(saved)]);
    if([...keys].some(key=>book[key]!==saved[key])) return 'Changes to publish';
    return book.status==='Read' ? 'Published' : 'Published · not finished';
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
    for(const book of picks) {
      if(findExisting(books,book)) {skipped++;continue;}
      books.push({...book,id:makeId(),status:'Read',finished:'',finishedYear:String(year),rating:'',note:'',published:true}); added++;
    }
    return {books,added,skipped};
  }
  root.BookData = {coverURL,catalogResults,searchParams,findExisting,publicationStatus,recentlyFinished,finishYear,finishedByYear,addBatch};
  if (typeof module !== 'undefined') module.exports = root.BookData;
})(globalThis);
