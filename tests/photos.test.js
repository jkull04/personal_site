const {test}=require('node:test');
const assert=require('node:assert/strict');
const {grouped,matches,move,rename}=require('../js/photo-data.js');
const {validate}=require('../js/studio-core.js');
const photo=(id,collection,subgroup='')=>({id,title:id,alt:'Mountain',collection,subgroup,src:'/assets/photography/p.jpg',thumb:'/assets/photography/p-thumb.jpg',published:true});
const photos=()=>[photo('a','New Zealand','South Island'),photo('b','Italy','Rome'),photo('c','New Zealand','North Island'),photo('d','New Zealand','South Island'),photo('e','')];
test('existing collections become parent groups and keep the first-seen order',()=>{
 const groups=grouped(photos());
 assert.deepEqual(groups.map(g=>g.name),['New Zealand','Italy','']);
 assert.deepEqual(groups[0].subgroups.map(s=>s.name),['South Island','North Island']);
 assert.deepEqual(groups[0].subgroups[0].photos.map(p=>p.id),['a','d']);
 assert.equal(grouped([{id:'legacy',collection:'Travel'}])[0].subgroups[0].name,'');
});
test('parent filtering includes all descendants; child names remain scoped to their parent',()=>{
 const source=[...photos(),photo('f','Italy','South Island')];
 assert.deepEqual(source.filter(p=>matches(p,'New Zealand',undefined)).map(p=>p.id),['a','c','d']);
 assert.deepEqual(source.filter(p=>matches(p,'New Zealand','South Island')).map(p=>p.id),['a','d']);
 assert.deepEqual(source.filter(p=>matches(p,'',undefined)).map(p=>p.id),['e']);
});
test('bulk move only changes selected photos and rejects invalid destinations atomically',()=>{
 const source=photos();const before=structuredClone(source);
 const moved=move(source,['a','b'],' Trips ',' Mountains ');
 assert.equal(moved[0].collection,'Trips');assert.equal(moved[1].subgroup,'Mountains');assert.deepEqual(moved[2],source[2]);
 assert.deepEqual(source,before);
 assert.throws(()=>move(source,['a'],'','Orphan'),/group/);assert.deepEqual(source,before);
 assert.equal(move(moved,['a'],'','')[0].subgroup,'');
});
test('rename parent preserves subgroups; rename child does not rename matching names elsewhere',()=>{
 const source=[...photos(),photo('f','Italy','South Island')];
 const changed=rename(source,'New Zealand','South Island','Southern Alps');
 assert.equal(changed[0].subgroup,'Southern Alps');assert.equal(changed[5].subgroup,'South Island');
 const parent=rename(source,'New Zealand',undefined,'NZ');
 assert.equal(parent[0].subgroup,'South Island');assert.equal(parent[2].collection,'NZ');assert.equal(parent[1].collection,'Italy');
});
test('publishing rejects orphan subgroups while old collections remain valid',()=>{
 assert.doesNotThrow(()=>validate({books:[],photography:[photo('a','Travel')]},true));
 assert.throws(()=>validate({books:[],photography:[photo('a','','Mountains')]},true),/Choose a group/);
 assert.doesNotThrow(()=>validate({books:[],photography:[photo('a','','Mountains')]}));
});
test('category preview chooses exactly the selected published photos and falls back to four',()=>{
 const {preview,setPreview}=require('../js/photo-data.js');
 const source=[photo('a','Trip'),photo('b','Trip'),photo('c','Trip'),photo('d','Trip'),photo('e','Trip')];
 const chosen=setPreview(source,['b','d']);
 assert.deepEqual(preview(chosen).map(p=>p.id),['b','d']);
 assert.deepEqual(preview(source).map(p=>p.id),['a','b','c','d']);
 assert.deepEqual(preview(chosen.map(p=>({...p,published:p.id!=='b'}))).map(p=>p.id),['d']);
 assert.throws(()=>setPreview(source,source.map(p=>p.id)),/four/);
 assert.throws(()=>setPreview(photos(),['a','b']),/one group/);
 assert.throws(()=>setPreview([{...source[0],published:false}],['a']),/Include/);
 assert.equal(source[1].preview,undefined);
});
test('drag reorder keeps hidden photos fixed and preserves all photo metadata',()=>{
 const {reorder}=require('../js/photo-data.js');const source=photos(), before=structuredClone(source);
 const next=reorder(source,['a','c','d'],'d','a');
 assert.deepEqual(next.map(p=>p.id),['d','b','a','c','e']);
 assert.deepEqual(source,before);assert.deepEqual(next.find(p=>p.id==='d'),source[3]);
 assert.equal(reorder(source,['a','c'],'missing','a'),source);
});
test('photo links survive group renames and moves; encoded subgroup and empty group roundtrip',()=>{
 const {link,resolveLink}=require('../js/photo-data.js');const source=photos();
 const hash=link(source,'New Zealand','South Island','d',2);
 assert.deepEqual(resolveLink(source,hash),{parent:'New Zealand',child:'South Island',photoId:'d',page:2});
 const moved=move(source,['d'],'France & Italy','A/B');
 assert.deepEqual(resolveLink(moved,hash),{parent:'France & Italy',child:undefined,photoId:'d',page:2});
 assert.equal(resolveLink(rename(source,'New Zealand',undefined,'NZ'),hash).parent,'NZ');
 assert.equal(resolveLink(source,link(source,'',undefined,'e')).parent,'');
 assert.equal(resolveLink(source,'#photo=unknown'),null);
 assert.equal(resolveLink(source,'#group=New+Zealand&page=Infinity').page,0);
});
