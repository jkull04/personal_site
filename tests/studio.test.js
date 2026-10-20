const {test} = require('node:test');
const assert = require('node:assert/strict');
const {publish,validate} = require('../js/studio-core.js');
const empty = () => ({books:[],photography:[]});
const book = () => ({id:'book-1',title:'A test book',author:'An author',status:'Reading',published:true});
function mockApi(remote=empty(),rejectUpdate=false) {
  const calls=[];
  async function api(path,method='GET',body) {
    calls.push({path,method,body});
    if(path==='/git/ref/heads/main') return {object:{sha:'head'}};
    if(path.startsWith('/contents/')) {const kind=path.includes('books')?'books':'photography';return {content:Buffer.from(JSON.stringify(remote[kind])).toString('base64')};}
    if(path==='/git/commits/head') return {tree:{sha:'base-tree'}};
    if(path==='/git/blobs') return {sha:'image-blob'};
    if(path==='/git/trees') return {sha:'new-tree'};
    if(path==='/git/commits') return {sha:'new-commit'};
    if(path==='/git/refs/heads/main') {if(rejectUpdate) throw Error('Concurrent commit');return {};}
    throw Error('Unexpected request '+path);
  }
  return {api,calls};
}
test('publishes one atomic commit with the current tree as its base',async()=>{
  const {api,calls}=mockApi();
  const result=await publish({data:{books:[book()],photography:[]},baseline:empty(),images:{},api});
  assert.equal(result.sha,'new-commit');
  const tree=calls.find(c=>c.path==='/git/trees').body;
  assert.equal(tree.base_tree,'base-tree');assert.deepEqual(tree.tree.map(e=>e.path),['data/books.json']);
  assert.deepEqual(calls.at(-1).body,{sha:'new-commit',force:false});
});
test('rejects newer remote content before writing any objects',async()=>{
  const remote={books:[book()],photography:[]};const {api,calls}=mockApi(remote);
  await assert.rejects(()=>publish({data:empty(),baseline:empty(),images:{},api}),/another device/);
  assert.ok(calls.every(c=>c.method==='GET'));
});
test('unpublished entries and their images never leave the draft',async()=>{
  const {api,calls}=mockApi();
  const data={books:[book(),{...book(),id:'private',published:false}],photography:[{id:'photo',title:'Private',src:'/assets/photography/private.jpg',thumb:'/assets/photography/private-thumb.jpg',published:false}]};
  await publish({data,baseline:empty(),images:{'assets/photography/private.jpg':'YWJj'},api});
  assert.ok(!calls.some(c=>c.path==='/git/blobs'));
  const tree=calls.find(c=>c.path==='/git/trees');assert.ok(!JSON.stringify(tree).includes('private'));
});
test('no changes creates no commit',async()=>{
  const {api,calls}=mockApi();const result=await publish({data:empty(),baseline:empty(),images:{},api});
  assert.equal(result.unchanged,true);assert.ok(calls.every(c=>c.method==='GET'));
});
test('photo payload and metadata are committed together; unrelated files survive',async()=>{
  const {api,calls}=mockApi();
  const photo={id:'p',title:'Landscape',alt:'A mountain at dawn',src:'/assets/photography/p.jpg',thumb:'/assets/photography/p-thumb.jpg',published:true};
  await publish({data:{books:[],photography:[photo]},baseline:empty(),images:{'assets/photography/p.jpg':'YWJj','assets/photography/p-thumb.jpg':'YWJj','assets/photography/unused.jpg':'YWJj'},api});
  assert.equal(calls.filter(c=>c.path==='/git/blobs').length,2);
  assert.equal(calls.find(c=>c.path==='/git/trees').body.tree.length,3);
});
test('concurrent commits reject safely, never force overwriting',async()=>{
  const {api,calls}=mockApi(empty(),true);
  await assert.rejects(()=>publish({data:{books:[book()],photography:[]},baseline:empty(),images:{},api}),/Concurrent/);
  assert.equal(calls.at(-1).body.force,false);
});
test('a failed required check prevents the production ref update',async()=>{
  const {api,calls}=mockApi();
  api.checkCommit=async sha=>{assert.equal(sha,'new-commit');throw Error('Checks failed');};
  await assert.rejects(()=>publish({data:{books:[book()],photography:[]},baseline:empty(),images:{},api}),/Checks failed/);
  assert.ok(!calls.some(c=>c.path==='/git/refs/heads/main'));
});
test('validation rejects missing descriptions, invalid paths, and duplicate IDs',()=>{
  assert.throws(()=>validate({books:[book(),book()],photography:[]}),/unique/);
  assert.throws(()=>validate({books:[],photography:[{id:'p',src:'https://evil.test/x.jpg',thumb:'/assets/photography/p.jpg'}]}),/path/);
  assert.throws(()=>validate({books:[],photography:[{id:'p',title:'Photo',src:'/assets/photography/p.jpg',thumb:'/assets/photography/p.jpg',published:true}]},true),/description/);
});
test('UTF-8 content compares without false conflicts',async()=>{
  const data={books:[{...book(),title:'Ἰλιάς · Café'}],photography:[]};
  const {api}=mockApi(data);const result=await publish({data,baseline:structuredClone(data),images:{},api});
  assert.equal(result.unchanged,true);
});
test('replacement covers publish atomically, excluding private and unused uploads',async()=>{
 const {api,calls}=mockApi();
 const data={books:[{...book(),rating:'5',finished:'2026-09-01',coverSrc:'/assets/photography/book-cover-new.jpg'},{...book(),id:'private',published:false,coverSrc:'/assets/photography/book-cover-private.jpg'}],photography:[]};
 await publish({data,baseline:empty(),images:{'assets/photography/book-cover-new.jpg':'YWJj','assets/photography/book-cover-private.jpg':'YWJj','assets/photography/unused.jpg':'YWJj'},api});
 const tree=calls.find(c=>c.path==='/git/trees').body.tree;
 assert.deepEqual(tree.map(x=>x.path),['data/books.json','assets/photography/book-cover-new.jpg']);
 const saved=JSON.parse(tree[0].content)[0];assert.equal(saved.rating,'5');assert.equal(saved.finished,'2026-09-01');
 assert.throws(()=>validate({books:[{...book(),coverSrc:'https://evil.test/c.jpg'}],photography:[]}),/cover path/);
});

