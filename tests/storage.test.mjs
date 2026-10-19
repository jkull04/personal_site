import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {StorageBudget,LIMITS} from '../backend/storage/quota.mjs';
import {createHandler} from '../backend/storage/worker.mjs';
import core from '../js/studio-core.js';
import vm from 'node:vm';
import fs from 'node:fs';

const digest=s=>createHash('sha256').update(s).digest('hex');
const credential='a'.repeat(64), origin='https://www.jameskull.com';
const empty=()=>({books:[],photography:[],writings:[]});
const image=Uint8Array.from([255,216,255,224,0,16,255,217]);
const imageURL='https://images.jameskull.com/photos/'+digest(image)+'.jpg';
const photo=(extra={})=>({id:'p',title:'Photo',alt:'A mountain',src:'/assets/photography/p.jpg',thumb:'/assets/photography/p-thumb.jpg',published:true,...extra});
class MemoryStorage {
  data=new Map(); queue=Promise.resolve();
  get=async key=>structuredClone(this.data.get(key));
  put=async(key,value)=>this.data.set(key,structuredClone(value));
  transaction(fn) {const run=this.queue.then(()=>fn(this));this.queue=run.catch(()=>{});return run;}
}
function setup() {
  const objects=new Map(),calls=[];
  const env={ALLOWED_ORIGINS:origin,STUDIO_AUTH_SHA256:digest(credential),SESSION_SECRET:'test-only-session-secret-with-sufficient-length',GITHUB_TOKEN:'test-only',LOGIN_LIMITER:{limit:async()=>({success:true})},PHOTOS:{
    head:async key=>objects.get(key)||null,
    put:async(key,bytes)=>objects.set(key,{size:bytes.length}),
    list:async()=>({objects:[...objects.values()],truncated:false})
  }};
  const storage=new MemoryStorage(),budget=new StorageBudget({storage});
  env.BUDGET={idFromName:name=>name,get:()=>budget};
  env.PHOTOS.get=async key=>objects.has(key)?{body:image,httpEtag:'etag'}:null;
  const handler=createHandler(async(url,options)=>{
    const path=url.replace('https://api.github.com/repos/jkull04/personal_site','');calls.push({path,...options});
    let value;
    if(path==='/git/ref/heads/main')value={object:{sha:'head'}};
    else if(path.startsWith('/contents/'))value=[];
    else if(path==='/git/commits/head')value={tree:{sha:'base'}};
    else value={sha:'new'};
    return Response.json(value);
  });
  const call=(path,body,token,method=body===undefined?'GET':'POST',requestOrigin=origin)=>handler(new Request('https://studio-api.jameskull.com'+path,{method,headers:{Origin:requestOrigin,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':body instanceof Uint8Array?'image/jpeg':'application/json'},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)}),env);
  const login=async()=>{const response=await call('/session',{credential});assert.equal(response.status,200);return (await response.json()).token;};
  return {call,login,env,objects,calls,storage,budget,handler};
}
test('storage rejects unauthorized origins, missing sessions and invalid credentials',async()=>{
  const {call}=setup();
  assert.equal((await call('/usage',undefined,undefined,'GET','https://evil.test')).status,403);
  assert.equal((await call('/photos',image)).status,401);
  assert.equal((await call('/session',{credential:'b'.repeat(64)})).status,401);
});
test('session signatures cannot be forged or extended',async()=>{
  const {call,login}=setup();const token=await login();
  assert.equal((await call('/usage',undefined,token)).status,200);
  const forged=btoa(JSON.stringify({exp:Date.now()+999999999})) +'.'+token.split('.')[1];
  assert.equal((await call('/usage',undefined,forged)).status,401);
});
test('login rate limits and incomplete setup fail closed',async()=>{
  const {call,env}=setup();env.LOGIN_LIMITER.limit=async()=>({success:false});
  assert.equal((await call('/session',{credential})).status,429);
  delete env.STUDIO_AUTH_SHA256;
  assert.equal((await call('/session',{credential})).status,503);
});
test('photo uploads are content-addressed and safe to retry; invalid bytes fail',async()=>{
  const {call,login,objects}=setup();const token=await login();
  for(let i=0;i<2;i++){const r=await call('/photos',image,token);assert.equal(r.status,200);assert.equal((await r.json()).url,imageURL);}
  assert.equal(objects.size,1);
  assert.equal((await call('/photos',new Uint8Array([1,2,3,4]),token)).status,400);
});
test('publishing refuses missing R2 objects before GitHub writes',async()=>{
  const {call,login,calls}=setup();const token=await login();
  const r=await call('/publish',{data:{...empty(),photography:[photo({src:imageURL,thumb:imageURL})]},baseline:empty()},token);
  assert.equal(r.status,400);assert.equal(calls.length,0);
});
test('cloud publication uses raw metadata reads and atomic non-forced commit without image blobs',async()=>{
  const {call,login,calls}=setup();const token=await login();await call('/photos',image,token);
  const r=await call('/publish',{data:{...empty(),photography:[photo({src:imageURL,thumb:imageURL})]},baseline:empty()},token);
  assert.equal(r.status,200);assert.equal((await r.json()).sha,'new');
  assert.ok(!calls.some(c=>c.path==='/git/blobs'));
  assert.ok(calls.filter(c=>c.path.startsWith('/contents/')).every(c=>c.headers.Accept==='application/vnd.github.raw+json'));
  assert.deepEqual(JSON.parse(calls.at(-1).body),{sha:'new',force:false});
});
test('remote image allowlist rejects other hosts, queries, credentials and path traversal',()=>{
  for(const src of ['https://evil.test/photos/a.jpg',imageURL+'?x=1',imageURL.replace('https://','https://a@'),imageURL.replace('/photos/','/photos/../')])assert.equal(core.validPhoto(src),false);
  assert.equal(core.validPhoto(imageURL),true);
});
test('collections exceeding the old 1,000-entry and 1MB thresholds remain readable',async()=>{
  const books=Array.from({length:1200},(_,i)=>({id:'b'+i,title:'Book '+i,author:'Author',status:'Read',note:'x'.repeat(1000)}));
  core.validate({...empty(),books});assert.ok(JSON.stringify(books).length>1000000);
  assert.deepEqual(await core.readCollection(async()=>books,'/contents/data/books.json'),books);
});
function browser(fetcher) {
  const context={window:{},fetch:fetcher,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},StudioAccess:{serviceCredential:async()=>credential},StudioCore:core,Blob,Uint8Array,atob,Map,Error,Boolean,encodeURIComponent};
  vm.runInNewContext(fs.readFileSync(new URL('../js/studio-storage.js',import.meta.url),'utf8'),context);
  return context.window.StudioStorage;
}
test('Studio sends only public metadata and required images; drafts stay unchanged',async()=>{
  const calls=[];
  const service=browser(async(url,options={})=>{
    calls.push({url,...options});
    if(url==='/data/studio-storage.json')return Response.json({enabled:true,apiOrigin:'https://studio-api.jameskull.com',mediaOrigin:'https://images.jameskull.com'});
    if(url.endsWith('/session'))return Response.json({token:'session'});
    if(url.endsWith('/photos'))return Response.json({url:imageURL});
    if(url.endsWith('/publish'))return Response.json({published:JSON.parse(options.body).data,sha:'new'});
    throw Error(url);
  });
  await service.ready;
  const data={...empty(),photography:[photo(),photo({id:'private',title:'Private secret',src:'/assets/photography/secret.jpg',thumb:'/assets/photography/secret.jpg',published:false})]};
  const before=JSON.stringify(data);
  const result=await service.publish({data,baseline:empty(),images:{'assets/photography/p.jpg':Buffer.from(image).toString('base64'),'assets/photography/p-thumb.jpg':Buffer.from(image).toString('base64'),'assets/photography/secret.jpg':Buffer.from(image).toString('base64')}});
  assert.equal(JSON.stringify(data),before);assert.equal(result.published.photography[0].src,imageURL);
  assert.equal(calls.filter(c=>c.url.endsWith('/photos')).length,2);
  assert.ok(!calls.find(c=>c.url.endsWith('/publish')).body.includes('Private secret'));
});
test('failed upload stops before publication and preserves local draft paths',async()=>{
  const calls=[];
  const service=browser(async(url)=>{
    calls.push(url);
    if(url==='/data/studio-storage.json')return Response.json({enabled:true,apiOrigin:'https://studio-api.jameskull.com',mediaOrigin:'https://images.jameskull.com'});
    if(url.endsWith('/session'))return Response.json({token:'session'});
    return Response.json({error:'Upload interrupted'},{status:503});
  });
  await service.ready;const data={...empty(),photography:[photo()]};
  await assert.rejects(()=>service.publish({data,baseline:empty(),images:{'assets/photography/p.jpg':Buffer.from(image).toString('base64')}}),/interrupted/);
  assert.ok(!calls.some(url=>url.endsWith('/publish')));assert.equal(data.photography[0].src,'/assets/photography/p.jpg');
});

test('concurrent reservations cannot cross the 8 GB ceiling',async()=>{
  const {storage,budget}=setup();await storage.put('total',{bytes:LIMITS.bytes-10,objects:1});
  const reserve=key=>budget.fetch(new Request('https://budget/',{method:'POST',body:JSON.stringify({action:'reserve',key:'photos/'+key.repeat(64)+'.jpg',size:8})}));
  const results=await Promise.all([reserve('a'),reserve('b')]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,413]);
  assert.equal((await storage.get('total')).bytes,LIMITS.bytes-2);
});
test('upload and image-read limits stop operations, not merely warn',async()=>{
  const {storage,call,login,env,handler,objects}=setup();const token=await login();
  await storage.put('daily',{day:new Date().toISOString().slice(0,10),writes:LIMITS.writesPerDay,reads:LIMITS.readsPerDay});
  assert.equal((await call('/photos',image,token)).status,429);assert.equal(objects.size,0);
  assert.equal((await handler(new Request(imageURL),env)).status,429);
});
test('failed R2 uploads retain their budget reservation and retries do not double count bytes',async()=>{
  const {call,login,env,storage}=setup();const token=await login();env.PHOTOS.put=async()=>{throw Error('Network interrupted');};
  await call('/photos',image,token);await call('/photos',image,token);
  assert.equal((await storage.get('total')).bytes,image.length);
  assert.equal((await storage.get('daily')).writes,2);
});
test('private R2 media is served only through budgeted reads and emergency pause closes access',async()=>{
  const {call,login,env,storage,handler}=setup();const token=await login();await call('/photos',image,token);
  const response=await handler(new Request(imageURL),env);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/jpeg');
  assert.equal((await storage.get('daily')).reads,1);
  env.PAUSED='true';assert.equal((await handler(new Request(imageURL),env)).status,503);
  assert.equal((await call('/photos',image,token)).status,503);
});
test('migration uploads existing published images and preserves source paths until commit succeeds',async()=>{
  const calls=[];
  const service=browser(async(url,options={})=>{
    calls.push(url);
    if(url==='/data/studio-storage.json')return Response.json({enabled:true,apiOrigin:'https://studio-api.jameskull.com',mediaOrigin:'https://images.jameskull.com'});
    if(url.startsWith('/assets/photography/'))return new Response(image,{headers:{'Content-Type':'image/jpeg'}});
    if(url.endsWith('/session'))return Response.json({token:'session'});
    if(url.endsWith('/photos'))return Response.json({url:imageURL});
    if(url.endsWith('/publish'))return Response.json({published:JSON.parse(options.body).data,sha:'new'});
    throw Error(url);
  });
  await service.ready;const data={...empty(),photography:[photo()]};
  const result=await service.publish({data,baseline:structuredClone(data),images:{},migrate:true});
  assert.equal(result.published.photography[0].src,imageURL);
  assert.equal(data.photography[0].src,'/assets/photography/p.jpg');
  assert.equal(calls.filter(url=>url.startsWith('/assets/')).length,2);
});
test('exhausted or unavailable budget never falls back to unrestricted R2 access',async()=>{
  const {handler,env}=setup();let reads=0;
  env.PHOTOS.get=async()=>{reads++;return {body:image};};
  env.BUDGET.get=()=>({fetch:async()=>{throw Error('Budget offline');}});
  assert.equal((await handler(new Request(imageURL),env)).status,503);assert.equal(reads,0);
});
