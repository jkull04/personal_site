const {test}=require('node:test');
const assert=require('node:assert/strict');
const {catalogResults,coverURL,recentlyFinished,finishedByYear,addBatch}=require('../js/book-data.js');
test('catalog selection retains author, cover and work identifier; incomplete records remain editable',()=>{
  const [book,missing]=catalogResults({docs:[{title:'The Odyssey',author_name:['Homer','Translator'],cover_i:123,key:'/works/OL42W'}, {title:'Unknown'}, {title:null}]});
  assert.equal(book.author,'Homer, Translator');assert.equal(book.coverId,123);assert.equal(book.catalogKey,'/works/OL42W');
  assert.equal(missing.author,'');assert.equal(missing.coverId,0);
  assert.deepEqual(catalogResults({}),[]);
});
test('year groups use finish dates, support year-only entries and retain more than twelve books',()=>{
  const entries=Array.from({length:15},(_,i)=>({title:String(i),status:'Read',finishedYear:'2025'}));
  entries.push({title:'Latest',status:'Read',finished:'2026-01-02',finishedYear:'2024',year:'1900'}, {title:'Unknown',status:'Read'}, {title:'Draft',status:'Read',finishedYear:'2027',published:false});
  const groups=finishedByYear(entries);
  assert.deepEqual(groups.map(([year])=>year),['2026','2025','Undated']);assert.equal(groups[1][1].length,15);
});
test('batch import skips duplicates within the batch and existing shelf while preserving existing data',()=>{
  const current=[{id:'existing',title:'The Odyssey',author:'',status:'Reading',note:'Keep me'}];
  const picks=[{title:'The Odyssey',author:'Homer',catalogKey:'/works/OL1W'},{title:'Red Rising',author:'Pierce Brown',catalogKey:'/works/OL2W',coverId:123},{title:'Red Rising',author:'Pierce Brown',catalogKey:'/works/OL2W'}];
  const result=addBatch(current,picks,'2024',()=> 'new');
  assert.equal(result.added,1);assert.equal(result.skipped,2);assert.equal(result.books[1].finishedYear,'2024');assert.equal(result.books[1].coverId,123);assert.equal(result.books[1].finished,'');assert.equal(result.books[0].note,'Keep me');assert.equal(current.length,1);
  assert.throws(()=>addBatch([],picks,'24',()=> 'new'),/four-digit/);
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
