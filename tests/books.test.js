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
test('English search requests matching editions and uses their title and cover',()=>{
  const {searchParams}=require('../js/book-data.js');
  const params=searchParams('Crime and Punishment');
  assert.match(params.get('q'),/language:eng/);
  assert.equal(searchParams('978-0-345-53980-9').get('q'),'isbn:9780345539809 language:eng');
  assert.match(params.get('fields'),/editions.cover_i/);
  assert.doesNotMatch(searchParams('Crime and Punishment',false).get('q'),/language:eng/);
  const [book]=catalogResults({docs:[{title:'Преступление и наказание',key:'/works/OL1W',cover_i:1,author_name:['Dostoevsky'],editions:{docs:[{title:'Crime and Punishment',cover_i:2,language:['eng']}]}}]});
  assert.equal(book.title,'Crime and Punishment'); assert.equal(book.coverId,2);assert.equal(book.catalogKey,'/works/OL1W');
});
test('existing book detection shares rules between single search and batch import',()=>{
  const {findExisting}=require('../js/book-data.js');
  const books=[{id:'a',title:' The   Odyssey ',author:'Homer'},{id:'b',title:'Foreign title',catalogKey:'/works/OL1W'}];
  assert.equal(findExisting(books,{title:'the odyssey',author:'Homer'}).id,'a');
  assert.equal(findExisting(books,{title:'English title',catalogKey:'/works/OL1W'}).id,'b');
  assert.equal(findExisting(books,{title:'The Odyssey',author:'Another author'}),undefined);
});
test('publication labels distinguish drafts, pending changes, removals and finished published books',()=>{
  const {publicationStatus}=require('../js/book-data.js');
  const book={id:'a',title:'Odyssey',status:'Read',published:true};
  assert.equal(publicationStatus(book,[]),'Not published');
  assert.equal(publicationStatus({...book,published:false},[]),'Private draft');
  assert.equal(publicationStatus(book,[{...book}]),'Published');
  assert.equal(publicationStatus({...book,title:'The Odyssey'},[book]),'Changes to publish');
  assert.equal(publicationStatus({...book,published:false},[book]),'Removal pending');
  const reading={...book,status:'Reading'};
  assert.equal(publicationStatus(reading,[reading]),'Published · not finished');
});
test('reviewed batch preserves individual completion dates and ratings; year-only stays undated',()=>{
 const result=addBatch([],[{title:'A',author:'One',finished:'2026-09-01',rating:'5'},{title:'B',author:'Two',rating:'3'}],'2024',(()=>{let i=0;return()=>String(++i);})());
 assert.equal(result.books[0].finished,'2026-09-01');assert.equal(result.books[0].finishedYear,'2026');assert.equal(result.books[0].rating,'5');
 assert.equal(result.books[1].finished,'');assert.equal(result.books[1].finishedYear,'2024');assert.equal(result.books[1].rating,'3');
 for(const finished of ['2026-02-30','2026-13-01','bad'])assert.throws(()=>addBatch([],[{title:'Bad',finished}],'2026',()=> 'id'),/completion date/);
 assert.throws(()=>addBatch([],[{title:'Bad',rating:'6'}],'2026',()=> 'id'),/rating/);
});
