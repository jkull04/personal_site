const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const N=require('../js/newsletter-data.js');
const B=require('../scripts/build_monthly_newsletter.cjs');
const essay={id:'one',title:'One essay',type:'essay',body:'First version',date:'2001-01-01',published:true};
const photo={id:'p1',title:'A photograph',collection:'Italy',src:'/assets/photography/one.jpg',date:'1999-01-01',published:true};
test('monthly changes detect body updates and old-dated additions, ignoring order and date-only edits',()=>{
  const before={local:[essay],photography:[photo]};
  const reordered={local:[{...essay,date:'2026-10-25'}],photography:[{...photo,date:'2026-10-25'}]};
  assert.deepEqual(B.changedHighlights(before,reordered),[]);
  const after={local:[{...essay,body:'A revised argument'},{...essay,id:'private',published:false}],photography:[photo,{...photo,id:'p2'},{...photo,id:'private',published:false}]};
  const changed=B.changedHighlights(before,after);
  assert.equal(changed.length,2);
  assert.equal(changed.find(e=>e.kind==='essay').summary,'Updated.');
  assert.deepEqual(changed.find(e=>e.kind==='photo').keys,['photo:p2']);
  assert.match(changed.find(e=>e.kind==='photo').summary,/1 new photograph/);
  assert.deepEqual(B.changedHighlights(after,before).map(e=>e.kind),['essay']);
});
test('completed months only, setup baseline, and quiet months',()=>{
  assert.throws(()=>B.period('2026-13',new Date('2027-01-01')),/YYYY-MM/);
  assert.throws(()=>B.period('2026-10',new Date('2026-10-21')),/completed/);
  assert.equal(+B.period('2026-12',new Date('2027-01-01')).end,+new Date('2027-01-01'));
  const initial={createdAt:'2026-10-21T00:00:00Z',startCommit:'baseline'};
  let usedBaseline=false;
  const issue=B.makeIssue({month:'2026-10',now:new Date('2026-11-01'),initial,snapshotRef:ref=>{assert.equal(ref,'baseline');usedBaseline=true;return {ref,data:{local:[essay]}};},snapshotAt:date=>{assert.equal(date.toISOString(),'2026-11-01T00:00:00.000Z');return {ref:'end',data:{local:[essay]}};}});
  assert.equal(usedBaseline,true);assert.equal(issue.status,'quiet');assert.equal(issue.draft,null);
});
test('full Git history produces a reproducible month draft excluding next-month and private content',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-newsletter-'));
  const git=(args,date)=>execFileSync('git',args,{cwd:root,encoding:'utf8',env:{...process.env,...(date?{GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date}:{})}}).trim();
  const write=(file,data)=>fs.writeFileSync(path.join(root,file),JSON.stringify(data));
  try {
    git(['init','-q']);git(['config','user.name','Newsletter test']);git(['config','user.email','test@example.invalid']);fs.mkdirSync(path.join(root,'data'));
    for(const name of ['writings-local','writings','works-substack','photography'])write('data/'+name+'.json',name==='writings-local'?[essay]:[]);
    git(['add','.']);git(['commit','-qm','Initial public content'],'2026-10-20T12:00:00Z');
    const startCommit=git(['rev-parse','HEAD']);
    write('data/newsletter-baseline.json',{createdAt:'2026-10-20T12:00:00Z',startCommit});write('data/newsletter-monthly.json',{version:1,issues:[]});
    write('data/photography.json',[photo,{...photo,id:'secret',published:false}]);
    git(['add','.']);git(['commit','-qm','Publish old-dated photo'],'2026-10-31T23:59:59Z');
    write('data/writings-local.json',[essay,{...essay,id:'november'}]);git(['add','.']);git(['commit','-qm','November essay'],'2026-11-01T00:00:00Z');
    const issue=B.run({root,month:'2026-10',now:new Date('2026-11-02')});
    assert.equal(issue.draft.month,'2026-10');assert.equal(issue.draft.items.length,1);assert.deepEqual(issue.draft.items[0].keys,['photo:p1']);
    const first=fs.readFileSync(path.join(root,'data/newsletter-monthly.json'),'utf8');
    B.run({root,month:'2026-10',now:new Date('2026-11-03')});assert.equal(fs.readFileSync(path.join(root,'data/newsletter-monthly.json'),'utf8'),first);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('Studio automatically imports a monthly draft, preserves edits, and excludes recorded months',async()=>{
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,addEventListener(){}});return elements.get(id);};
  const generated=N.draft(N.inventory({local:[essay]}));generated.subject='October 2026 · James Kull';
  const source={'/data/writings-local.json':[essay],'/data/writings.json':[],'/data/works-substack.json':[],'/data/photography.json':[],'/data/newsletter-baseline.json':{keys:['writing:one']},'/data/newsletter-monthly.json':{version:1,issues:[{month:'2026-10',draft:generated}]}};
  const state={data:{untouched:true}};
  const context={window:{},document:{getElementById:get},NewsletterData:N,WritingData:require('../js/writing-data.js'),URL,Blob,Date,setTimeout,confirm:()=>true,navigator:{},fetch:async p=>({ok:true,json:async()=>source[p]})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/newsletter-editor.js'),'utf8'),context);
  const editor=context.window.createNewsletterEditor({getState:()=>state,save:async()=>{},isBusy:()=>false});
  await editor.load();assert.equal(state.newsletter.draft.month,'2026-10');assert.equal(state.newsletter.draft.items.length,1);
  state.newsletter.draft.intro='My personal edits';await editor.load();assert.equal(state.newsletter.draft.intro,'My personal edits');assert.equal(state.data.untouched,true);
  state.newsletter=N.recordSent(state.newsletter,'https://jameskull.substack.com/p/october');await editor.load();assert.equal(state.newsletter.draft,null);
  // Updating the same essay next month is allowed even though its identity was sent before.
  source['/data/newsletter-monthly.json'].issues.push({month:'2026-11',draft:generated});await editor.load();assert.equal(state.newsletter.draft.month,'2026-11');
  source['/data/writings-local.json']=[];await editor.load();assert.equal(state.newsletter.draft.items.length,0);assert.equal(get('newsletter-copy').disabled,true);
});
