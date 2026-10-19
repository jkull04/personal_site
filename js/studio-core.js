/* No credentials or drafts are stored by this module. */
((root) => {
  'use strict';
  const writing = root.WritingData || (typeof require === 'function' ? require('./writing-data.js') : null);
  const paths = {writings:'data/writings-local.json',books:'data/books.json', photography:'data/photography.json'};
  const imagePath = /^assets\/photography\/[a-zA-Z0-9_-]+\.jpg$/;
  const canonical = value => JSON.stringify(value);
  function validate(data, publishing = false) {
    for (const kind of Object.keys(paths)) {
      if (kind==='writings' && data[kind]===undefined) continue; // Older browser drafts and backups.
      if (!Array.isArray(data[kind]) || data[kind].length > 1000) throw Error('Invalid '+kind+' collection.');
      const ids = new Set();
      for (const entry of data[kind]) {
        if (!entry || typeof entry !== 'object' || !/^[a-zA-Z0-9_-]+$/.test(entry.id) || ids.has(entry.id)) throw Error('Every entry needs a unique ID.');
        ids.add(entry.id);
        if(kind==='writings') {writing.validate(entry,publishing);continue;}
        for (const [key, value] of Object.entries(entry)) {
          if (!['string','boolean','number'].includes(typeof value) || String(value).length > 20000) throw Error('Invalid entry field: '+key);
        }
        if (publishing && entry.published !== false && (!entry.title?.trim() || (kind === 'books' ? !entry.author?.trim() : !entry.alt?.trim()))) throw Error(kind === 'books' ? 'Add a title and author to every included book.' : 'Add a title and image description to every included photo.');
        if (kind === 'books' && !['Reading','Read','Want to read'].includes(entry.status)) throw Error('Choose a valid reading status.');
        if (kind === 'books' && entry.rating && !['1','2','3','4','5'].includes(String(entry.rating))) throw Error('Ratings must be from 1 to 5.');
        if (kind === 'books' && entry.finishedYear && !/^\d{4}$/.test(String(entry.finishedYear))) throw Error('Use four digits for the finish year.');
        if (kind === 'photography') {
          if (['collection','subgroup'].some(key=>entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].length > 100))) throw Error('Group names must be 100 characters or fewer.');
          if (publishing && entry.published !== false && entry.subgroup?.trim() && !entry.collection?.trim()) throw Error('Choose a group for every photo with a subgroup.');
        }
        if (kind === 'photography' && (!imagePath.test(String(entry.src).replace(/^\//,'')) || !imagePath.test(String(entry.thumb).replace(/^\//,'')))) throw Error('Invalid photograph path.');
      }
    }
  }
  async function publish({data, baseline, images, api}) {
    validate(data, true);
    const kinds = Object.keys(paths).filter(k=>data[k]!==undefined);
    const published = Object.fromEntries(kinds.map(k=>[k,data[k].filter(e=>e.published !== false)]));
    if(published.writings && new TextEncoder().encode(JSON.stringify(published.writings,null,2)).length>900000) throw Error('The published writing collection is too large (900 KB maximum). Shorten the articles or keep some as private drafts before publishing.');
    const ref = await api('/git/ref/heads/main');
    const head = ref.object.sha;
    // Read at one immutable commit. Never overwrite another device's content changes.
    for (const kind of kinds) {
      const file = await api('/contents/'+paths[kind]+'?ref='+head);
      const raw = new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g,'')), c=>c.charCodeAt(0)));
      if (canonical(JSON.parse(raw)) !== canonical(baseline[kind])) throw Error('Published content changed on another device. Download your backup, then reload published content before applying your edits. Nothing was overwritten.');
    }
    const changed = kinds.filter(k=>canonical(published[k]) !== canonical(baseline[k]));
    if (!changed.length) return {unchanged:true, published};
    const commit = await api('/git/commits/'+head);
    const tree = changed.map(k=>({path:paths[k],mode:'100644',type:'blob',content:JSON.stringify(published[k],null,2)+'\n'}));
    if(changed.includes('writings')) {
      for(const entry of published.writings) tree.push({path:writing.href(entry).slice(1)+'index.html',mode:'100644',type:'blob',content:writing.page(entry)});
      for(const entry of baseline.writings) {
        if(!published.writings.some(e=>e.id===entry.id)) {
          if(!/^[a-zA-Z0-9_-]+$/.test(entry.id)) throw Error('Invalid writing ID in baseline.');
          tree.push({path:writing.href(entry).slice(1)+'index.html',mode:'100644',type:'blob',sha:null});
        }
      }
    }
    const needed = new Set(published.photography.flatMap(p=>[p.src.slice(1),p.thumb.slice(1)]));
    for (const [path, content] of Object.entries(images)) {
      if (!needed.has(path)) continue;
      if (!imagePath.test(path) || !/^[A-Za-z0-9+/=]+$/.test(content)) throw Error('Invalid image upload.');
      const blob = await api('/git/blobs','POST',{content,encoding:'base64'});
      tree.push({path,mode:'100644',type:'blob',sha:blob.sha});
    }
    const createdTree = await api('/git/trees','POST',{base_tree:commit.tree.sha,tree});
    const createdCommit = await api('/git/commits','POST',{message:'Update writings, books and photography from Studio',tree:createdTree.sha,parents:[head]});
    // Non-forced update is atomic; a concurrent commit rejects this operation.
    await api('/git/refs/heads/main','PATCH',{sha:createdCommit.sha,force:false});
    return {sha:createdCommit.sha,published};
  }
  const core = {validate,publish,imagePath};
  root.StudioCore = core;
  if (typeof module !== 'undefined') module.exports = core;
})(globalThis);
