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

test('projects require their sections and publish a complete page in the same commit',async()=>{
 const project=essay({type:'project',body:'',problem:'A problem',approach:'An approach',output:'A result'});
 assert.doesNotThrow(()=>validate(collections([project]),true));
 assert.throws(()=>validate(collections([{...project,output:''}]),true),/Problem, Approach, and Output/);
 const baseline=collections([]),{api,calls}=remote(baseline);
 await publish({data:collections([project]),baseline,images:{},api});
 const page=calls.find(c=>c.path==='/git/trees').body.tree.find(e=>e.path.endsWith('index.html')).content;
 assert.ok(page.includes('← All projects'));assert.ok(page.includes('<h4>Problem</h4>'));
 assert.ok(page.includes('<h4>Approach</h4>'));assert.ok(page.includes('<h4>Output</h4>'));
 const crosspost=Writing.bodyForSubstack(project);
 assert.ok(crosspost.html.includes('<h4>Problem</h4>'));assert.ok(crosspost.text.includes('### Output\n\nA result'));
});
test('projects route to Projects, retain existing posts, and deduplicate linked Substack copies',()=>{
 const project=essay({type:'project',problem:'Why',approach:'How',output:'Result',substackUrl:'https://jameskull.substack.com/p/example'});
 const posts=[{id:'copy',links:[{href:project.substackUrl}]},{id:'original',links:[{href:'https://jameskull.substack.com/p/other'}]}];
 const result=Writing.projects([project,essay({id:'essay'}),{...project,id:'private',published:false}],posts);
 assert.deepEqual(result.map(e=>e.id),['test-essay','original']);
 assert.equal(result[0].links[0].href,Writing.href(project));
 assert.equal(Writing.listing([project],[]).length,0);
 assert.equal(Writing.listing([project],[{href:project.substackUrl}]).length,0);
});
test('the real Projects renderer loads existing Substack and Studio projects without errors',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const element=()=>({innerHTML:'',style:{setProperty(){}},classList:{remove(){},toggle(){}},querySelectorAll:()=>[],setAttribute(){},removeAttribute(){},addEventListener(){},scrollTop:0,scrollHeight:0,clientHeight:0});
 const list=element();let hydrate;
 const document={getElementById:id=>id==='works-list'?list:null,querySelector:()=>null,querySelectorAll:()=>[],createElement:element,body:{appendChild(){}},addEventListener:(name,fn)=>{if(name==='DOMContentLoaded')hydrate=fn;}};
 const local=essay({type:'project',title:'Local project',problem:'Local problem',approach:'Local approach',output:'Local output'});
 const existing={id:'old-project',title:'Existing Substack project',date:'2026-01-01',summary:'Summary',problem:'Why',approach:'How',output:'Result',tags:['Projects'],links:[{href:'https://jameskull.substack.com/p/existing'}]};
 const window={addEventListener(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},innerHeight:800,scrollY:0};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/content.js'),'utf8'),{document,window,WritingData:Writing,ShowcaseData:require('../js/showcase-data.js'),fetch:async path=>({ok:true,json:async()=>path.includes('showcase')?[]:path.includes('works-substack')?[existing]:[local]})});
 await hydrate();
 assert.ok(list.innerHTML.includes('Existing Substack project'));assert.ok(list.innerHTML.includes('Local project'));
 assert.ok(list.innerHTML.includes('Published here'));assert.ok(list.innerHTML.includes('Published on Substack'));
 assert.ok(list.innerHTML.includes('Local problem'));
});
