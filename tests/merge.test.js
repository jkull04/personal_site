const {test}=require('node:test');const assert=require('node:assert/strict');const {mergePublished}=require('../js/studio-core.js');
const photo={id:'old',title:'Mountain',alt:'Mountain',collection:'Abroad',src:'/assets/photography/old.jpg',thumb:'/assets/photography/old-thumb.jpg'};
const collection=photos=>({books:[],photography:photos,writings:[]});
const remote='https://jameskull-studio-storage.fitzykull.workers.dev/photos/'+'a'.repeat(64)+'.jpg';
test('storage migration merges with local organization and new uploads without mutating inputs',()=>{
 const base=collection([photo]),local=collection([{...photo,collection:'Study Abroad',subgroup:'Peru'},{...photo,id:'new',src:'/assets/photography/new.jpg'}]),latest=collection([{...photo,src:remote,thumb:remote}]);
 const before=JSON.stringify([base,local,latest]);const result=mergePublished(local,base,latest);
 assert.equal(result.photography.length,2);assert.equal(result.photography[0].src,remote);assert.equal(result.photography[0].collection,'Study Abroad');assert.equal(result.photography[1].src,'/assets/photography/new.jpg');assert.equal(JSON.stringify([base,local,latest]),before);
});
test('same-field conflicts stop the entire merge without dropping local changes',()=>{
 const base=collection([photo]),local=collection([{...photo,title:'Local'}]),latest=collection([{...photo,title:'Remote'}]);
 assert.throws(()=>mergePublished(local,base,latest),/title both here/);assert.equal(local.photography[0].title,'Local');
});
test('remote additions and private drafts survive; changed removals conflict',()=>{
 const base=collection([photo]),local=collection([photo,{...photo,id:'private',published:false}]),latest=collection([photo,{...photo,id:'remote'}]);
 assert.deepEqual(mergePublished(local,base,latest).photography.map(p=>p.id),['old','private','remote']);
 assert.throws(()=>mergePublished(collection([{...photo,title:'Edited'}]),base,collection([])),/removed on the site/);
 assert.deepEqual(mergePublished(collection([]),base,base).photography,[]);
});
test('remote-only reordering is adopted; conflicting reorder is refused',()=>{
 const list=['a','b','c'].map(id=>({...photo,id}));
 assert.deepEqual(mergePublished(collection(list),collection(list),collection([...list].reverse())).photography.map(p=>p.id),['c','b','a']);
 assert.throws(()=>mergePublished(collection([list[1],list[0],list[2]]),collection(list),collection([...list].reverse())),/order both/);
});
