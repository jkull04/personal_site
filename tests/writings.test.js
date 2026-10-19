const {test}=require('node:test');
const assert=require('node:assert/strict');
const Writing=require('../js/writing-data.js');
const {publish,validate}=require('../js/studio-core.js');
const essay=(patch={})=>({id:'test-essay',type:'essay',title:'A new essay',subtitle:'A subtitle',abstract:'Short summary',date:'2026-10-19',tags:'Classics, Economics',body:'# A heading\n\nA **bold** idea and *italic* text.\n\n- First\n- Second\n\n> A quotation',substackUrl:'',published:true,...patch});
const collections=writings=>({books:[],photography:[],writings});
function remote(baseline,reject=false){
 const calls=[];return {calls,api:async(path,method='GET',body)=>{
  calls.push({path,method,body});
  if(path==='/git/ref/heads/main')return {object:{sha:'head'}};
  if(path.startsWith('/contents/')){const kind=path.includes('writings-local')?'writings':path.includes('books')?'books':'photography';return {content:Buffer.from(JSON.stringify(baseline[kind])).toString('base64')};}
  if(path==='/git/commits/head')return {tree:{sha:'base'}};
  if(path==='/git/trees')return {sha:'tree'};
  if(path==='/git/commits')return {sha:'commit'};
  if(path==='/git/refs/heads/main'){if(reject)throw Error('Concurrent update');return {};}
  throw Error('Unexpected request '+path);
 }};
}
test('publishing writes the full article and listing atomically, excluding private drafts',async()=>{
 const baseline=collections([]),{api,calls}=remote(baseline);
 await publish({data:collections([essay(),essay({id:'secret',body:'PRIVATE DRAFT',published:false})]),baseline,images:{},api});
 const tree=calls.find(c=>c.path==='/git/trees').body;
 assert.equal(tree.base_tree,'base');
 assert.deepEqual(tree.tree.map(e=>e.path),['data/writings-local.json','writings/posts/test-essay/index.html']);
 assert.ok(tree.tree[1].content.includes('<strong>bold</strong>'));
 assert.ok(!JSON.stringify(calls).includes('PRIVATE DRAFT'));
 assert.deepEqual(calls.at(-1).body,{sha:'commit',force:false});
});
test('removing a published writing removes the static page and listing together',async()=>{
 const baseline=collections([essay()]),{api,calls}=remote(baseline);
 await publish({data:collections([essay({published:false})]),baseline,images:{},api});
 const tree=calls.find(c=>c.path==='/git/trees').body.tree;
 assert.equal(tree[0].content,'[]\n');assert.deepEqual(tree[1],{path:'writings/posts/test-essay/index.html',mode:'100644',type:'blob',sha:null});
});
test('remote writing changes and concurrent commits reject without force',async()=>{
 let baseline=collections([]),mock=remote(collections([essay()]));
 await assert.rejects(publish({data:collections([essay()]),baseline,images:{},api:mock.api}),/another device/);
 assert.ok(mock.calls.every(c=>c.method==='GET'));
 mock=remote(baseline,true);
 await assert.rejects(publish({data:collections([essay()]),baseline,images:{},api:mock.api}),/Concurrent/);
 assert.equal(mock.calls.at(-1).body.force,false);
});
test('draft-only writings produce no public changes',async()=>{
 const baseline=collections([]),{api,calls}=remote(baseline);
 const result=await publish({data:collections([essay({published:false,title:'',body:''})]),baseline,images:{},api});
 assert.equal(result.unchanged,true);assert.ok(calls.every(c=>c.method==='GET'));
});
test('validation catches incomplete entries, invalid dates, unsafe IDs and foreign crossposts',()=>{
 for(const patch of [{title:''},{body:''},{date:'2026-02-30'},{id:'../../index'},{substackUrl:'https://evil.test/p/essay'},{substackUrl:'javascript:alert(1)'}])assert.throws(()=>validate(collections([essay(patch)]),true));
 assert.doesNotThrow(()=>validate(collections([essay({body:'a'.repeat(50000)})]),true));
});
test('safe formatting never turns raw HTML or unsafe URLs into executable markup',()=>{
 const body=Writing.markdown('<script>alert(1)</script>\n\n[x](javascript:alert) **<img src=x onerror=alert(1)>**\n\n[safe](https://example.com/?a=1&b=2)');
 assert.ok(!body.includes('<script>'));assert.ok(!body.includes('<img'));assert.ok(!body.includes('href="javascript:'));
 assert.ok(body.includes('href="https://example.com/?a=1&amp;b=2"'));
 const page=Writing.page(essay({title:'</title><script>bad</script>',subtitle:'<img src=x>'}));
 assert.ok(!page.includes('<script>'));assert.ok(!page.includes('<img'));
});
test('crosspost deduplication uses the exact linked URL and keeps unrelated Substack posts',()=>{
 const local=essay({substackUrl:'https://jameskull.substack.com/p/crosspost?utm_source=test'});
 const remote=[{id:'remote',title:local.title,href:'https://jameskull.substack.com/p/crosspost/'},{id:'unrelated',title:local.title,href:'https://jameskull.substack.com/p/different'}];
 const merged=Writing.listing([local,essay({id:'draft',published:false})],remote);
 assert.equal(merged.length,2);assert.equal(merged[0].href,'/writings/posts/test-essay/');assert.deepEqual(merged[0].tags,['Classics','Economics']);assert.equal(merged[1].id,'unrelated');
});
test('Substack handoff contains formatted body and a link to the original',()=>{
 const content=Writing.bodyForSubstack(essay());assert.ok(content.html.includes('<h2>A heading</h2>'));assert.ok(content.html.includes('https://www.jameskull.com/writings/posts/test-essay/'));assert.ok(!content.html.includes('<h1>'));
});
