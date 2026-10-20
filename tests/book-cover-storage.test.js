const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('cloud publishing uploads only included custom covers and substitutes returned URLs',async()=>{
 const calls=[], origin='https://jameskull-studio-storage.fitzykull.workers.dev';
 const fetch=async(url,options={})=>{calls.push({url,options});let data;
 if(url==='/data/studio-storage.json')data={enabled:true,apiOrigin:origin,mediaOrigin:origin};
 else if(url.endsWith('/session'))data={token:'test'};
 else if(url.endsWith('/photos'))data={url:origin+'/photos/'+'a'.repeat(64)+'.jpg'};
 else if(url.endsWith('/publish'))data={published:JSON.parse(options.body).data};
 else throw Error(url);
 return {ok:true,status:200,json:async()=>data};};
 const context={window:{},fetch,StudioCore:require('../js/studio-core.js'),StudioAccess:{serviceCredential:async()=> 'test'},sessionStorage:{getItem(){return 'session';},setItem(){}},Blob,Uint8Array,atob,Map};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/studio-storage.js'),'utf8'),context);
 const service=context.window.StudioStorage;await service.ready;
 const book={id:'book',title:'Title',author:'Author',status:'Read',rating:'5',finished:'2026-09-01',coverSrc:'/assets/photography/book-cover-1.jpg'};
 const result=await service.publish({data:{books:[book,{...book,id:'private',published:false,coverSrc:'/assets/photography/private.jpg'}],photography:[]},baseline:{books:[],photography:[]},images:{'assets/photography/book-cover-1.jpg':'YWJj','assets/photography/private.jpg':'YWJj'}});
 assert.equal(calls.filter(c=>c.url.endsWith('/photos')).length,1);
 assert.equal(result.published.books.length,1);assert.match(result.published.books[0].coverSrc,/photos\/a{64}\.jpg$/);assert.equal(result.published.books[0].rating,'5');assert.equal(book.coverSrc,'/assets/photography/book-cover-1.jpg');
});

