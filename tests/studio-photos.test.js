const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const Photos=require('../js/studio-photos.js');
const Core=require('../js/studio-core.js');
const photo=(id,extra={})=>({id,title:id,alt:'A landscape',collection:'Trip',subgroup:'Greece',src:'/assets/photography/'+id+'.jpg',thumb:'/assets/photography/'+id+'-thumb.jpg',published:true,...extra});
test('duplicates match original bytes, pending resized bytes, and content-addressed cloud photos',async()=>{
 const bytes=Buffer.from('same image'), hash=await Photos.digest(bytes),source=await Photos.digest(Buffer.from('original upload'));
 const items=[photo('draft'),photo('live',{src:'https://jameskull-studio-storage.fitzykull.workers.dev/photos/'+hash+'.jpg'})];
 const index=await Photos.duplicateIndex(items,{'assets/photography/draft.jpg':bytes.toString('base64')},{draft:source});
 assert.equal(index.get('source:'+source).id,'draft');assert.equal(index.get('image:'+hash).id,'live');
 assert.equal(index.get('image:'+await Photos.digest(Buffer.from('different image'))),undefined);
 const privateIndex=await Photos.duplicateIndex([photo('private',{published:false})],{'assets/photography/private.jpg':bytes.toString('base64')});
 assert.equal(privateIndex.get('image:'+hash).id,'private');
});
test('photo statuses distinguish private, changed, failed, and not-yet-deployed photos',()=>{
 const p=photo('one');assert.equal(Photos.status(p,[p],[]).label,'Ready to publish');
 assert.equal(Photos.status({...p,published:false},[p],[]).label,'Private draft');
 assert.equal(Photos.status(p,[p],[p]).label,'Published');
 assert.equal(Photos.status(p,[p],[p],{one:{phase:'deploying',signature:JSON.stringify(p)}}).label,'Saved · deployment pending');
 const transfer={one:{phase:'failed',error:'Offline',signature:JSON.stringify(p)}};
 assert.equal(Photos.status(p,[p],[],transfer).error,'Offline');
 assert.equal(Photos.status({...p,title:'Edited'},[p],[],transfer).label,'Ready to publish');
 assert.equal(Photos.isLive(p,[p],[]),false);assert.equal(Photos.isLive(p,[p],[p]),true);
 assert.equal(Photos.isLive(p,[p,photo('two')],[photo('two'),p]),false);
});
async function storageHarness(failUploadAt=0,failPublish=false) {
 const counters={uploads:0,publishes:0}, bodies=[];let failed=false;
 const response=body=>({ok:true,status:200,json:async()=>body});
 const sandbox={window:{},Map,Blob,Uint8Array,atob,JSON,StudioCore:Core,StudioAccess:{serviceCredential:async()=> 'fixture-only'},sessionStorage:{getItem:()=>'fixture-session',setItem:()=>{},removeItem:()=>{}},fetch:async(url,options)=>{
  if(url==='/data/studio-storage.json')return response({enabled:true,apiOrigin:'https://jameskull-studio-storage.fitzykull.workers.dev',mediaOrigin:'https://jameskull-studio-storage.fitzykull.workers.dev'});
  if(url.endsWith('/session'))return response({token:'fixture-only'});
  if(url.endsWith('/photos')){counters.uploads++;if(counters.uploads===failUploadAt)throw TypeError('offline');return response({url:'https://jameskull-studio-storage.fitzykull.workers.dev/photos/'+String(counters.uploads).padStart(64,'0')+'.jpg'});}
  if(url.endsWith('/publish')){counters.publishes++;const body=JSON.parse(options.body);bodies.push(body);if(failPublish&&!failed){failed=true;throw TypeError('offline');}return response({sha:'saved',published:body.data});}
  throw Error('Unexpected request '+url);
 }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/studio-storage.js'),'utf8'),sandbox);await sandbox.window.StudioStorage.ready;
 return {storage:sandbox.window.StudioStorage,counters,bodies};
}
const payload=()=>({data:{books:[],photography:[photo('one'),photo('private',{published:false})]},baseline:{books:[],photography:[]},images:{'assets/photography/one.jpg':'YWJj','assets/photography/one-thumb.jpg':'ZGVm','assets/photography/private.jpg':'eHl6'}});
test('failed image upload preserves draft bytes and retry reuses completed upload',async()=>{
 const {storage,counters,bodies}=await storageHarness(2),input=payload(),before=structuredClone(input),events=[];
 await assert.rejects(()=>storage.publish({...input,onPhoto:e=>events.push(e)}),/could not connect/);
 assert.deepEqual(input,before);assert.equal(events.at(-1).phase,'failed');assert.equal(events.at(-1).id,'one');assert.equal(counters.publishes,0);
 const result=await storage.publish({...input,onPhoto:e=>events.push(e)});
 assert.equal(counters.uploads,3);assert.equal(result.published.photography.length,1);assert.equal(events.at(-1).phase,'publishing');
 assert.ok(!events.some(e=>e.id==='private'));assert.ok(!JSON.stringify(bodies).includes('private'));assert.deepEqual(input,before);
});
test('failed commit retries publishing without uploading the same images again',async()=>{
 const {storage,counters}=await storageHarness(0,true),input=payload(),before=structuredClone(input);
 await assert.rejects(()=>storage.publish(input),/could not connect/);assert.equal(counters.uploads,2);
 await storage.publish(input);assert.equal(counters.uploads,2);assert.equal(counters.publishes,2);assert.deepEqual(input,before);
});
