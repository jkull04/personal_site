const {test}=require('node:test');
const assert=require('node:assert/strict');
const N=require('../js/newsletter-data.js');
const fs=require('node:fs');
const photo=(id,collection='Italy')=>({id,title:'A view',collection,thumb:'/assets/photography/'+id+'.jpg',alt:'An arch',date:'2026-04-01',published:true});
const essay={id:'e1',title:'One essay',body:'Content',date:'2026-10-20',type:'essay',abstract:'A summary',published:true};
test('inventory excludes unpublished entries and combines albums into one highlight',()=>{
  const entries=N.inventory({local:[essay,{...essay,id:'private',published:false}],photography:[photo('p1'),photo('p2'),{...photo('secret'),published:false}]});
  assert.equal(entries.length,2);
  assert.deepEqual(entries.find(e=>e.kind==='photo').keys,['photo:p1','photo:p2']);
  assert.ok(entries.every(e=>!e.keys.includes('photo:secret')&&e.id!=='writing:private'));
});
test('small edits, reordering and collection renames do not make new content; an old-dated new photo does',()=>{
  const source={local:[essay],photography:[photo('p1'),photo('p2')]};
  const baseline=N.inventory(source).flatMap(e=>e.keys);
  const edits=N.inventory({local:[{...essay,title:'Edited title',date:'2026-10-21'}],photography:[photo('p2','Rome'),photo('p1','Rome')]});
  assert.deepEqual(N.candidates(edits,baseline),[]);
  const additions=N.inventory({local:[essay],photography:[photo('p1'),photo('p2'),photo('new')]});
  const fresh=N.candidates(additions,baseline);assert.equal(fresh.length,1);assert.deepEqual(fresh[0].newKeys,['photo:new']);
});
test('crossposted writing is included once and retains its identity when synced',()=>{
  const href='https://jameskull.substack.com/p/one';
  const entries=N.inventory({local:[{...essay,substackUrl:href}],writings:[{...essay,id:'remote',href}]});
  assert.equal(entries.length,1);assert.equal(entries[0].id,'writing:'+href);
  assert.equal(N.candidates(N.inventory({writings:[{...essay,id:'remote',href}]}),entries.flatMap(e=>e.keys)).length,0);
});
test('public projects and notes have usable links and separate digest sections',()=>{
  const entries=N.inventory({local:[{...essay,type:'project'},{...essay,id:'note',type:'blog'}]});
  const r=N.render(N.draft(entries));assert.match(r.html,/<h2>Projects<\/h2>/);assert.match(r.html,/<h2>Notes<\/h2>/);
  assert.match(r.html,/https:\/\/www.jameskull.com\/projects\/#work-e1/);
});
test('initial setup produces no old announcements and first issue is opt-in selection',()=>{
  const entries=N.inventory({local:[essay]});
  assert.deepEqual(N.candidates(entries,entries.flatMap(e=>e.keys)),[]);
  assert.equal(N.render(N.draft(entries,new Date(),false)).count,0);
});
test('sent history covers only selected content; copy/render never advances history',()=>{
  const entries=N.inventory({local:[essay,{...essay,id:'e2'}]});
  const state=N.normalize({draft:N.draft(entries)});state.draft.items[1].selected=false;
  const before=structuredClone(state);N.render(state.draft);assert.deepEqual(state,before);
  const sent=N.recordSent(state,'https://jameskull.substack.com/p/october');
  assert.equal(sent.draft,null);assert.equal(sent.history.length,1);assert.equal(sent.sentKeys.length,1);
  assert.equal(N.candidates(entries,[],sent.sentKeys).length,1);assert.deepEqual(state,before);
});
test('sent issues require a selected highlight, subject, valid publication URL and unique issue',()=>{
  const state=N.normalize({draft:N.draft(N.inventory({local:[essay]}))});
  for(const url of ['javascript:alert(1)','https://evil.example/p/one','https://jameskull.substack.com/subscribe'])assert.throws(()=>N.recordSent(state,url));
  const sent=N.recordSent(state,'https://jameskull.substack.com/p/one');sent.draft=state.draft;
  assert.throws(()=>N.recordSent(sent,'https://jameskull.substack.com/p/one'),/already/);
  state.draft.items[0].selected=false;assert.throws(()=>N.recordSent(state,'https://jameskull.substack.com/p/two'));
});
test('rendering escapes editable text and rejects malicious links and images',()=>{
  const d=N.draft(N.inventory({local:[{...essay,title:'<img src=x onerror=alert(1)>',abstract:'<script>alert(1)</script>'}]}));
  d.intro='<iframe src="javascript:alert(1)">';
  const html=N.render(d).html;assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<iframe'));assert.match(html,/&lt;script&gt;/);
  for(const value of [undefined,'','javascript:alert(1)','https://user:pass@www.jameskull.com/','//evil.example/x','https://jameskull.com.evil.example/'])assert.equal(N.url(value),'');
  assert.equal(N.url('https://evil.example/pixel.jpg',true),'');
  assert.equal(N.url('/data/private.json',true),'');
});
test('normalization handles old backups and discards unrelated fields',()=>{
  assert.deepEqual(N.normalize(null),N.normalize());
  const state=N.normalize({token:'secret',sentKeys:['bad','photo:one','photo:one'],history:[]});
  assert.deepEqual(state.sentKeys,['photo:one']);assert.equal(state.token,undefined);
});
test('empty months have nothing to send; one photo is featured by default',()=>{
  assert.equal(N.render(N.draft([])).count,0);
  const d=N.draft(N.inventory({photography:[photo('p1','Italy'),photo('p2','Peru')]}));
  assert.equal(d.items.filter(e=>e.featured).length,1);assert.equal((N.render(d).html.match(/<img /g)||[]).length,1);
});
test('signup never collects addresses in site code and editor has no send request',()=>{
  const page=fs.readFileSync(require.resolve('../index.html'),'utf8');
  assert.match(page,/https:\/\/jameskull.substack.com\/embed/);
  assert.ok(!page.includes('<input'));
  const editor=fs.readFileSync(require.resolve('../js/newsletter-editor.js'),'utf8');
  assert.ok(!/method\s*:\s*['"]POST/.test(editor));
});

test('the real editor loads live content, creates a draft and preserves other Studio work',async()=>{
  const vm=require('node:vm'),W=require('../js/writing-data.js');
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,handlers:{},addEventListener(k,fn){this.handlers[k]=fn;}});return elements.get(id);};
  const source={ '/data/writings-local.json':[essay], '/data/writings.json':[], '/data/works-substack.json':[], '/data/photography.json':[], '/data/newsletter-baseline.json':{keys:[]}, '/data/newsletter-monthly.json':{version:1,issues:[]} };
  const state={data:{books:[{id:'private-book',note:'Keep this draft'}]},images:{pending:'untouched'}};
  let saves=0,fail=false;
  const context={window:{},document:{getElementById:get},NewsletterData:N,WritingData:W,URL,Blob,Date,setTimeout,confirm:()=>true,navigator:{},fetch:async path=>({ok:!fail,json:async()=>source[path]})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/newsletter-editor.js'),'utf8'),context);
  const editor=context.window.createNewsletterEditor({getState:()=>state,save:async()=>{saves++;},isBusy:()=>false});
  editor.render();assert.equal(get('newsletter-copy').disabled,true);
  await editor.load();assert.equal(get('newsletter-new').disabled,false);
  get('newsletter-new').onclick();assert.equal(state.newsletter.draft.items.length,1);
  assert.match(get('newsletter-preview-body').innerHTML,/One essay/);assert.equal(get('newsletter-copy').disabled,false);
  assert.equal(state.images.pending,'untouched');assert.equal(state.data.books[0].note,'Keep this draft');assert.ok(saves>=2);
  const before=JSON.stringify(state.newsletter);fail=true;await editor.load();
  assert.equal(get('newsletter-copy').disabled,true);assert.equal(JSON.stringify(state.newsletter),before);
  assert.match(get('newsletter-status').textContent,/draft is safe/);
});
