const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const Showcase=require('../js/showcase-data.js'),Core=require('../js/studio-core.js');
const empty=()=>({books:[],photography:[],writings:[],showcase:[]});
const display=(extra={})=>({id:'project-demo',projectId:'demo',imageSrc:'/assets/photography/project-demo.jpg',imageAlt:'Project dashboard',demoUrl:'https://example.com/',...extra});
test('latest homepage selections use reading and content dates, exclude private entries, and preserve source order',()=>{
 const books=[{id:'old',status:'Read',finished:'2024-12-31'},{id:'year',status:'Read',finishedYear:'2025'},{id:'latest',status:'Read',finished:'2026-10-17',year:'1592'},{id:'reading',status:'Reading',finished:'2027-01-01'},{id:'private',status:'Read',finished:'2027-01-01',published:false}];
 const projects=[{id:'old',date:'2025-01-01'},{id:'new',date:'2026-01-01'},{id:'draft',date:'2027-01-01',published:false}];
 const photos=[{id:'old',collection:'Old',date:'2025-01-01'},{id:'first',collection:' New ',date:'2024-01-01'},{id:'latest',collection:'New',date:'2026-01-01'},{id:'draft',collection:'Private',date:'2027-01-01',published:false},{id:'loose',date:'2028-01-01'}];
 const before=JSON.stringify({books,projects,photos}),result=Showcase.latest(books,projects,photos);
 assert.equal(result.book.id,'latest');assert.equal(result.project.id,'new');assert.equal(result.album,'New');assert.deepEqual(result.photos.map(p=>p.id),['first','latest']);
 assert.equal(Showcase.latest(books.slice(0,2)).book.id,'year');assert.equal(JSON.stringify({books,projects,photos}),before);
 assert.deepEqual(Showcase.latest(),{book:undefined,project:undefined,album:'',photos:[]});
});
test('homepage resolves choices and replaces removed/private selections without changing data',()=>{
 const projects=[{id:'old',date:'2025-01-01'},{id:'latest',date:'2026-01-01'},{id:'private',published:false,date:'2027-01-01'}];
 const photos=[{id:'secret',collection:'Private',published:false},{id:'a',collection:'Italy'}];
 let result=Showcase.selections([{id:'home',projectId:'old',writingId:'gone',album:'Private'}],projects,[{id:'essay'}],photos);
 assert.equal(result.project.id,'old');assert.equal(result.writing.id,'essay');assert.equal(result.album,'Italy');
 assert.equal(Showcase.selections([{id:'home',projectId:'private'}],projects).project.id,'latest');
 assert.deepEqual(projects.map(p=>p.id),['old','latest','private']);
});
test('presentation validation rejects unsafe images, links and inconsistent records',()=>{
 for(const imageSrc of ['javascript:alert(1)','//evil.test/x.jpg','/assets/../private.jpg','https://evil.test/x.jpg'])assert.throws(()=>Showcase.validate(display({imageSrc})),/image/);
 for(const demoUrl of ['javascript:alert(1)','//evil.test/','/\\evil.test/','https://user:pass@example.com'])assert.throws(()=>Showcase.validate(display({demoUrl})),/URL/);
 assert.throws(()=>Showcase.validate(display({imageAlt:''})),/Describe/);
 assert.throws(()=>Showcase.validate(display({id:'other'})),/presentation/);
 assert.doesNotThrow(()=>Showcase.validate(display({demoUrl:'/projects/'})));
});
test('showcase merges preserve concurrent independent edits and reject conflicting choices',()=>{
 const baseline={...empty(),showcase:[{id:'home',projectId:'one',writingId:'essay',album:'Italy'}]};
 const local=structuredClone(baseline),remote=structuredClone(baseline);
 local.showcase[0].projectId='two';remote.showcase[0].album='Greece';
 const result=Core.mergePublished(local,baseline,remote);assert.equal(result.showcase[0].projectId,'two');assert.equal(result.showcase[0].album,'Greece');
 remote.showcase[0].projectId='three';assert.throws(()=>Core.mergePublished(local,baseline,remote),/both here/);
 assert.doesNotThrow(()=>Core.validate({books:[],photography:[]}));
});
test('a private project keeps its screenshot out of both public metadata and upload requests',async()=>{
 const calls=[],origin='https://jameskull-studio-storage.fitzykull.workers.dev';
 const data={...empty(),writings:[{id:'demo',title:'Private project',type:'project',published:false}],showcase:[display()]};
 const context={window:{},StudioCore:Core,StudioAccess:{serviceCredential:async()=> 'test'},sessionStorage:{getItem(){return "test-session";},setItem(){}},Blob,Uint8Array,atob,Map,fetch:async(url,options={})=>{
  calls.push(url);return {ok:true,status:200,json:async()=>url.includes('studio-storage.json')?{enabled:true,apiOrigin:origin,mediaOrigin:origin}:url.endsWith('/session')?{token:'test'}:{published:JSON.parse(options.body).data}};
 }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/studio-storage.js'),'utf8'),context);
 await context.window.StudioStorage.ready;
 const result=await context.window.StudioStorage.publish({data,baseline:empty(),images:{'assets/photography/project-demo.jpg':'YWJj'}});
 assert.equal(result.published.showcase.length,0);assert.ok(!calls.some(url=>url.endsWith('/photos')));assert.equal(data.showcase[0].imageSrc,display().imageSrc);
});
test('project screenshots and homepage settings publish atomically alongside book notes',async()=>{
 const calls=[],data={...empty(),showcase:[{id:'home',projectId:'demo',writingId:'',album:''},display()],books:[{id:'book',title:'Title',author:'Author',status:'Read',note:'A thoughtful note',recommended:true,rating:'4.5'}]};
 const api=async(path,method='GET',body)=>{calls.push({path,method,body});if(path==='/git/ref/heads/main')return {object:{sha:'head'}};if(path.startsWith('/contents/'))return [];if(path==='/git/commits/head')return {tree:{sha:'base'}};return {sha:'new'};};
 await Core.publish({data,baseline:empty(),images:{'assets/photography/project-demo.jpg':'YWJj'},api});
 const tree=calls.find(c=>c.path==='/git/trees').body.tree;
 assert.deepEqual(tree.map(e=>e.path),['data/books.json','data/showcase.json','assets/photography/project-demo.jpg']);
 assert.equal(JSON.parse(tree[0].content)[0].rating,'4.5');assert.equal(JSON.parse(tree[0].content)[0].recommended,true);
 assert.deepEqual(calls.at(-1).body,{sha:'new',force:false});
});
