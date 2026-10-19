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
