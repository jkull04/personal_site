/* No credentials or drafts are stored by this module. */
((root) => {
  'use strict';
  const writing = root.WritingData || (typeof require === 'function' ? require('./writing-data.js') : null);
  const showcase = root.ShowcaseData || (typeof require === 'function' ? require('./showcase-data.js') : null);
  const paths = {writings:'data/writings-local.json',books:'data/books.json', photography:'data/photography.json',showcase:'data/showcase.json'};
  const imagePath = /^assets\/photography\/[a-zA-Z0-9_-]+\.jpg$/;
  const remoteImage = /^https:\/\/jameskull-studio-storage\.fitzykull\.workers\.dev\/photos\/[a-f0-9]{64}\.jpg$/;
  const validPhoto = path => imagePath.test(String(path).replace(/^\//,'')) || remoteImage.test(path);
  async function readCollection(api,path) {
    const file=await api(path);
    if(Array.isArray(file)) return file; // Raw Contents API response, including files over 1 MB.
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));
  }
  const canonical = value => JSON.stringify(value);
  function validate(data, publishing = false) {
    for (const kind of Object.keys(paths)) {
      if (['writings','showcase'].includes(kind) && data[kind]===undefined) continue; // Older browser drafts and backups.
      if (!Array.isArray(data[kind]) || data[kind].length > (kind==='writings'?1000:50000)) throw Error('Invalid '+kind+' collection.');
      const ids = new Set();
      for (const entry of data[kind]) {
        if (!entry || typeof entry !== 'object' || !/^[a-zA-Z0-9_-]+$/.test(entry.id) || ids.has(entry.id)) throw Error('Every entry needs a unique ID.');
        ids.add(entry.id);
        if(kind==='writings') {writing.validate(entry,publishing);continue;}
        if(kind==='showcase') {showcase.validate(entry);continue;}
        for (const [key, value] of Object.entries(entry)) {
          if (!['string','boolean','number'].includes(typeof value) || String(value).length > 20000) throw Error('Invalid entry field: '+key);
        }
        if (publishing && entry.published !== false && (!entry.title?.trim() || (kind === 'books' ? !entry.author?.trim() : !entry.alt?.trim()))) throw Error(kind === 'books' ? 'Add a title and author to every included book.' : 'Add a title and image description to every included photo.');
        if (kind === 'books' && entry.coverSrc && !validPhoto(entry.coverSrc)) throw Error('Invalid book cover path.');
        if (kind === 'books' && !['Reading','Read','Want to read'].includes(entry.status)) throw Error('Choose a valid reading status.');
        if (kind === 'books' && entry.rating !== undefined && entry.rating !== '' && !['0.5','1','1.5','2','2.5','3','3.5','4','4.5','5'].includes(String(entry.rating))) throw Error('Ratings must be from 0.5 to 5 in half-star steps.');
        if (kind === 'books' && entry.recommended !== undefined && typeof entry.recommended !== 'boolean') throw Error('Book recommendations must be true or false.');
        if (kind === 'books' && entry.finishedYear && !/^\d{4}$/.test(String(entry.finishedYear))) throw Error('Use four digits for the finish year.');
        if (kind === 'photography') {
          if (['collection','subgroup'].some(key=>entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].length > 100))) throw Error('Group names must be 100 characters or fewer.');
          if (publishing && entry.published !== false && entry.subgroup?.trim() && !entry.collection?.trim()) throw Error('Choose a group for every photo with a subgroup.');
        }
        if (kind === 'photography' && (!validPhoto(entry.src) || !validPhoto(entry.thumb))) throw Error('Invalid photograph path.');
      }
    }
  }
  // Reconcile at field level without changing any input or discarding browser images.
  // A genuine edit to the same field on both sides stops the whole operation.
  function mergePublished(data,baseline,remote) {
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const result={};
    const conflict=(entry,field)=>{throw Error(`“${entry?.title || entry?.id || 'Entry'}” changed ${field} both here and on the site. Your draft and uploaded images are safe. Download a backup before resolving this conflict; do not reload published content.`);};
    for(const kind of Object.keys(paths).filter(k=>data[k]!==undefined)) {
      const local=data[kind],base=baseline[kind] || [],latest=remote[kind] || [];
      const bmap=new Map(base.map(e=>[e.id,e])),lmap=new Map(local.map(e=>[e.id,e])),rmap=new Map(latest.map(e=>[e.id,e]));
      const merged=new Map();
      for(const id of new Set([...lmap.keys(),...rmap.keys()])) {
        const b=bmap.get(id),l=lmap.get(id),r=rmap.get(id);
        if(!l){if(b && !same(b,r))conflict(r,'after you removed it');if(!b)merged.set(id,structuredClone(r));continue;}
        if(!r){if(b && !same(b,l))conflict(l,'after it was removed on the site');if(!b)merged.set(id,structuredClone(l));continue;}
        const entry={};
        for(const key of new Set([...Object.keys(b || {}),...Object.keys(l),...Object.keys(r)])) {
          let value;
          if(same(l[key],r[key]) || same(r[key],b?.[key]))value=l[key];
          else if(same(l[key],b?.[key]))value=r[key];
          else conflict(l,key);
          if(value!==undefined)entry[key]=structuredClone(value);
        }
        merged.set(id,entry);
      }
      const common=base.filter(e=>lmap.has(e.id)&&rmap.has(e.id)).map(e=>e.id),commonSet=new Set(common);
      const order=entries=>entries.map(e=>e.id).filter(id=>commonSet.has(id));
      const localOrder=order(local),remoteOrder=order(latest);
      const localMoved=!same(localOrder,common),remoteMoved=!same(remoteOrder,common);
      if(localMoved && remoteMoved && !same(localOrder,remoteOrder))conflict({title:kind},'order');
      const primary=remoteMoved&&!localMoved?latest:local,secondary=primary===local?latest:local;
      const ids=[...new Set([...primary,...secondary].map(e=>e.id))];
      result[kind]=ids.filter(id=>merged.has(id)).map(id=>merged.get(id));
    }
    validate(result);
    return result;
  }
  function publicData(data) {
    const privateProjects=new Set((data.writings||[]).filter(w=>w.type!=='project'||w.published===false).map(w=>w.id));
    return Object.fromEntries(Object.keys(paths).filter(k=>data[k]!==undefined).map(k=>[k,data[k].filter(e=>e.published!==false && (k!=='showcase'||e.id==='home'||!privateProjects.has(e.projectId)))]));
  }
  async function publish({data, baseline, images, api, onPhoto=()=>{}}) {
    validate(data, true);
    const kinds = Object.keys(paths).filter(k=>data[k]!==undefined);
    const published = publicData(data);
    if(published.writings && new TextEncoder().encode(JSON.stringify(published.writings,null,2)).length>900000) throw Error('The published writing collection is too large (900 KB maximum). Shorten the articles or keep some as private drafts before publishing.');
    const ref = await api('/git/ref/heads/main');
    const head = ref.object.sha;
    // Read at one immutable commit. Never overwrite another device's content changes.
    for (const kind of kinds) {
      const remote = await readCollection(api,'/contents/'+paths[kind]+'?ref='+head);
      if (canonical(remote) !== canonical(baseline[kind])) throw Error('Published content changed on another device while publishing. Your draft and images are safe. Click Publish updates again to merge the latest changes safely.');
    }
    const changed = kinds.filter(k=>canonical(published[k]) !== canonical(baseline[k]));
    if (!changed.length) return {unchanged:true, published};
    const commit = await api('/git/commits/'+head);
    const tree = changed.map(k=>({path:paths[k],mode:'100644',type:'blob',content:JSON.stringify(published[k],null,2)+'\n'}));
    if(published.writings && (changed.includes('writings') || changed.includes('showcase'))) {
      for(const entry of published.writings) tree.push({path:writing.href(entry).slice(1)+'index.html',mode:'100644',type:'blob',content:writing.page(entry,showcase.project(entry,published.showcase))});
      for(const entry of baseline.writings) {
        if(!published.writings.some(e=>e.id===entry.id)) {
          if(!/^[a-zA-Z0-9_-]+$/.test(entry.id)) throw Error('Invalid writing ID in baseline.');
          tree.push({path:writing.href(entry).slice(1)+'index.html',mode:'100644',type:'blob',sha:null});
        }
      }
    }
    const needed = new Set([...published.photography.flatMap(p=>[p.src.slice(1),p.thumb.slice(1)]),...published.books.filter(b=>b.coverSrc).map(b=>b.coverSrc.slice(1)),...(published.showcase||[]).filter(s=>s.imageSrc).map(s=>s.imageSrc.slice(1))]);
    for (const [path, content] of Object.entries(images)) {
      if (!needed.has(path)) continue;
      if (!imagePath.test(path) || !/^[A-Za-z0-9+/=]+$/.test(content)) throw Error('Invalid image upload.');
      const owners=published.photography.filter(p=>[p.src.slice(1),p.thumb.slice(1)].includes(path));
      owners.forEach(p=>onPhoto({id:p.id,phase:'uploading'}));
      let blob;
      try {blob=await api('/git/blobs','POST',{content,encoding:'base64'});}
      catch(error){owners.forEach(p=>onPhoto({id:p.id,phase:'failed',error:error.message}));throw error;}
      tree.push({path,mode:'100644',type:'blob',sha:blob.sha});
    }
    published.photography.forEach(p=>onPhoto({id:p.id,phase:'publishing'}));
    const createdTree = await api('/git/trees','POST',{base_tree:commit.tree.sha,tree});
    const createdCommit = await api('/git/commits','POST',{message:'Update writings, books and photography from Studio',tree:createdTree.sha,parents:[head]});
    if(api.checkCommit) await api.checkCommit(createdCommit.sha);
    // Non-forced update is atomic; a concurrent commit rejects this operation.
    await api('/git/refs/heads/main','PATCH',{sha:createdCommit.sha,force:false});
    return {sha:createdCommit.sha,published};
  }
  const core = {validate,mergePublished,publish,publicData,imagePath,validPhoto,readCollection};
  root.StudioCore = core;
  if (typeof module !== 'undefined') module.exports = core;
})(globalThis);

