const {test}=require('node:test');
const assert=require('node:assert/strict');
const {catalogResults,coverURL,recentlyFinished}=require('../js/book-data.js');
test('catalog selection retains author, cover and work identifier; incomplete records remain editable',()=>{
  const [book,missing]=catalogResults({docs:[{title:'The Odyssey',author_name:['Homer','Translator'],cover_i:123,key:'/works/OL42W'}, {title:'Unknown'}, {title:null}]});
  assert.equal(book.author,'Homer, Translator');assert.equal(book.coverId,123);assert.equal(book.catalogKey,'/works/OL42W');
  assert.equal(missing.author,'');assert.equal(missing.coverId,0);
  assert.deepEqual(catalogResults({}),[]);
});
test('cover references cannot become arbitrary URLs or markup',()=>{
  for(const id of ['https://evil.test/x','1/../../x','1" onerror="bad',-1,Infinity]) assert.equal(coverURL(id),'');
  assert.equal(coverURL(123,'L'),'https://covers.openlibrary.org/b/id/123-L.jpg?default=false');
});
test('public shelf includes only published finished books, newest first, without mutating the draft',()=>{
  const books=[{id:'old',status:'Read',finished:'2025-01-01'}, {id:'reading',status:'Reading',finished:'2026-10-19'}, {id:'draft',status:'Read',finished:'2026-10-19',published:false}, {id:'new',status:'Read',finished:'2026-10-18'}, {id:'undated',status:'Read'}];
  const original=JSON.stringify(books);
  assert.deepEqual(recentlyFinished(books).map(b=>b.id),['new','old','undated']);assert.equal(JSON.stringify(books),original);
  assert.equal(recentlyFinished(Array.from({length:20},(_,i)=>({status:'Read',title:String(i)}))).length,12);
});
