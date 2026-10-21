/* Public content only; no credentials, subscriber data, API fees, or email sending. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const N=require('../js/newsletter-data.js');
const files={local:'data/writings-local.json',writings:'data/writings.json',projects:'data/works-substack.json',photography:'data/photography.json'};
const fields=['title','type','abstract','subtitle','body','summary','problem','approach','output','outcome','links','caption','alt','src','thumb','collection','subgroup','location'];
function stable(value) {
  if(Array.isArray(value))return value.map(stable);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
function signatures(source) {
  const result=new Map();
  for(const kind of Object.keys(files))for(const raw of source[kind]||[]) {
    if(raw.published===false)continue;
    const ids=kind==='photography'?['photo:'+raw.id]:N.inventory({[kind]:[raw]}).flatMap(e=>e.keys);
    const signature=JSON.stringify(stable(Object.fromEntries(fields.filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]]))));
    for(const id of ids)if(!result.has(id))result.set(id,signature);
  }
  return result;
}
function changedHighlights(before,after) {
  const old=signatures(before),current=signatures(after);
  return N.inventory(after).flatMap(entry=>{
    const changed=entry.keys.filter(k=>old.get(k)!==current.get(k));
    if(!changed.length)return [];
    const added=changed.filter(k=>!old.has(k)).length;
    let summary=entry.summary;
    if(entry.kind==='photo') {
      const bits=[];
      if(added)bits.push(added+' new photograph'+(added===1?'':'s'));
      if(changed.length>added)bits.push((changed.length-added)+' updated');
      summary=bits.join(' and ')+' in this collection.';
    } else if(!added)summary='Updated'+(summary?': '+summary:'.');
    return [{...entry,keys:changed,summary}];
  });
}
function period(month,now=new Date()) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Use a YYYY-MM month.');
  const [year,m]=month.split('-').map(Number);
  const start=new Date(Date.UTC(year,m-1,1)),end=new Date(Date.UTC(year,m,1));
  if(end>now)throw Error('Only completed calendar months can be drafted.');
  return {start,end};
}
function makeIssue({month,now=new Date(),initial,snapshotAt,snapshotRef}) {
  const {start,end}=period(month,now),installed=new Date(initial.createdAt);
  if(!Number.isFinite(+installed))throw Error('Missing mailing-list start date.');
  if(end<=installed)return {month,status:'quiet',draft:null};
  const before=start<installed?snapshotRef(initial.startCommit):snapshotAt(start);
  const after=snapshotAt(end);
  const entries=changedHighlights(before.data,after.data);
  const draft=entries.length?N.draft(entries,new Date(month+'-15T12:00:00Z')):null;
  if(draft) {
    draft.month=month;
    draft.intro='A few things I’ve written, built, and photographed this month.';
  }
  return {month,status:draft?'ready':'quiet',fromCommit:before.ref,toCommit:after.ref,draft};
}
function run({root=path.resolve(__dirname,'..'),month,now=new Date()}={}) {
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
  if(git('rev-parse','--is-shallow-repository')==='true')throw Error('Fetch full Git history before drafting.');
  month ||= new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,15)).toISOString().slice(0,7);
  const initial=JSON.parse(fs.readFileSync(path.join(root,'data/newsletter-baseline.json'),'utf8'));
  if(!/^[a-f0-9]{40}$/.test(initial.startCommit||''))throw Error('Missing initial public content commit.');
  const commits=git('log','--first-parent','--format=%H %ct','HEAD').split('\n').map(line=>{const [ref,seconds]=line.split(' ');return {ref,time:Number(seconds)*1000};});
  const snapshotRef=ref=>{
    if(!/^[a-f0-9]{40}$/.test(ref||''))throw Error('Missing content history for this month.');
    const data={};
    for(const [key,file] of Object.entries(files)) {
      data[key]=git('ls-tree','--name-only',ref,'--',file)?JSON.parse(git('show',ref+':'+file)):[];
      if(!Array.isArray(data[key]))throw Error('Invalid public content: '+file);
    }
    return {ref,data};
  };
  const snapshotAt=date=>snapshotRef(commits.find(c=>c.time<+date)?.ref);
  const issue=makeIssue({month,now,initial,snapshotAt,snapshotRef});
  const target=path.join(root,'data/newsletter-monthly.json');
  const archive=JSON.parse(fs.readFileSync(target,'utf8'));
  if(archive.version!==1 || !Array.isArray(archive.issues))throw Error('Invalid monthly draft archive.');
  // Reruns are idempotent. The edited personal copy lives only in encrypted Studio storage.
  const issues=[...archive.issues.filter(i=>i.month!==month),issue].sort((a,b)=>a.month.localeCompare(b.month)).slice(-24);
  fs.writeFileSync(target,JSON.stringify({version:1,issues},null,2)+'\n');
  return issue;
}
module.exports={changedHighlights,period,makeIssue,run};
if(require.main===module) {
  try {
    const args=process.argv.slice(2);
    if(args.length && (args.length!==2 || args[0]!=='--month'))throw Error('Usage: node scripts/build_monthly_newsletter.cjs [--month YYYY-MM]');
    const issue=run({month:args[1]});
    process.stdout.write(issue.month+': '+(issue.draft?N.render(issue.draft).count+' highlights drafted':'quiet month; no email draft')+'\n');
  } catch(error) {process.stderr.write(error.message+'\n');process.exitCode=1;}
}
