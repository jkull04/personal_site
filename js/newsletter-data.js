/* Monthly digests use public content only. No addresses, credentials, or sending API. */
((root) => {
  'use strict';
  const writing=root.WritingData || (typeof require==='function'?require('./writing-data.js'):null);
  const photos=root.PhotoData || (typeof require==='function'?require('./photo-data.js'):null);
  const site='https://www.jameskull.com';
  const publication='https://jameskull.substack.com';
  const esc=writing.esc;
  const text=(value,max=2000)=>typeof value==='string'?value.slice(0,max):'';
  const month=value=>typeof value==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)?value:'';
  function url(value,image=false) {
    if(typeof value!=='string' || !value || value.length>2000 || /[\u0000-\u001f\\]/.test(value))return '';
    try {
      const u=new URL(value,site);
      if(u.protocol!=='https:' || u.username || u.password) return '';
      const allowed=image
        ? (u.origin===site && u.pathname.startsWith('/assets/')) || (u.origin==='https://jameskull-studio-storage.fitzykull.workers.dev' && /^\/photos\/[a-f0-9]{64}\.jpg$/.test(u.pathname))
        : [site,publication].includes(u.origin);
      return allowed?u.href:'';
    } catch {return '';}
  }
  const keys=value=>Array.isArray(value)?[...new Set(value.filter(k=>typeof k==='string' && /^(writing|photo):/.test(k) && k.length<=500))].slice(0,20000):[];
  function item(value) {
    if(!value || typeof value!=='object')return null;
    const href=url(value.href),id=text(value.id,500),kind=['essay','note','project','photo'].includes(value.kind)?value.kind:'';
    if(!href || !id || !kind)return null;
    return {id,kind,title:text(value.title,300),summary:text(value.summary),href,keys:keys(value.keys),image:url(value.image,true),alt:text(value.alt,500),selected:value.selected===true,featured:value.featured===true};
  }
  function normalize(value={}) {
    if(!value || typeof value!=='object')value={};
    const history=Array.isArray(value.history)?value.history.filter(h=>h && typeof h==='object').slice(-24).map(h=>({subject:text(h.subject,160),url:writing.substackURL(h.url),sentAt:text(h.sentAt,40),keys:keys(h.keys),month:month(h.month)})):[];
    const draft=value.draft && typeof value.draft==='object'?{
      subject:text(value.draft.subject,160),intro:text(value.draft.intro,5000),closing:text(value.draft.closing,2000),month:month(value.draft.month),
      items:Array.isArray(value.draft.items)?value.draft.items.slice(0,500).map(item).filter(Boolean):[]
    }:null;
    return {version:1,sentKeys:keys(value.sentKeys),history,draft};
  }
  function inventory({local=[],writings=[],projects=[],photography=[]}) {
    writings=writings.filter(e=>e.published!==false);projects=projects.filter(e=>e.published!==false);
    const included=local.filter(e=>e.published!==false);
    const key=e=>'writing:'+(writing.substackURL(e.substackUrl)||writing.substackURL(e.href)||(e.links||[]).map(l=>writing.substackURL(l.href)).find(Boolean)||e.id);
    const texts=writing.listing(included,writings).map(e=>({id:key(e),keys:[key(e)],kind:e.type==='blog'?'note':'essay',title:e.title,summary:e.abstract||e.subtitle||'',href:e.href,date:e.date}));
    const works=writing.projects(included,projects).map(e=>({id:key(e),keys:[key(e)],kind:'project',title:e.title,summary:e.summary||e.output||'',href:'/projects/#work-'+encodeURIComponent(e.id),date:e.date}));
    const publicPhotos=photography.filter(p=>p.published!==false);
    const albums=photos.grouped(publicPhotos).map(group=>{
      const members=publicPhotos.filter(p=>photos.group(p)===group.name);
      const cover=photos.preview(members)[0]||members[0];
      return {id:'album:'+group.name,keys:members.map(p=>'photo:'+p.id),kind:'photo',title:group.name||'Photographs',summary:members.length+' photographs on the site.',href:'/photography/'+photos.link(publicPhotos,group.name),image:cover.thumb||cover.src,alt:cover.alt||cover.title||group.name,date:members.map(p=>p.date||'').sort().at(-1)};
    });
    const unique=new Map();
    for(const entry of [...texts,...works,...albums].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))) {
      const safe=item(entry);if(safe && !unique.has(safe.id))unique.set(safe.id,safe);
    }
    return [...unique.values()];
  }
  function candidates(entries,baseline=[],sent=[]) {
    const seen=new Set([...keys(baseline),...keys(sent)]);
    return entries.map(e=>({...e,newKeys:e.keys.filter(k=>!seen.has(k))})).filter(e=>e.newKeys.length);
  }
  function liveDraft(draftValue,entries) {
    const d=normalize({draft:draftValue}).draft;if(!d)return null;
    const current=new Map(entries.flatMap(e=>e.keys.map(k=>[k,e])));
    d.items=d.items.flatMap(e=>{
      const live=current.get(e.keys.find(k=>current.has(k)));if(!live)return [];
      const covered=e.keys.filter(k=>live.keys.includes(k));
      return covered.length?[{...e,href:live.href,image:live.image,alt:live.alt,keys:covered}]:[];
    });
    return d;
  }
  function monthlyDraft(feed,entries,newsletter={}) {
    const recorded=new Set(normalize(newsletter).history.map(h=>h.month));
    if(!feed || feed.version!==1 || !Array.isArray(feed.issues))return null;
    for(const issue of [...feed.issues].filter(i=>i && month(i.month) && !recorded.has(i.month)).sort((a,b)=>b.month.localeCompare(a.month))) {
      const d=liveDraft(issue.draft,entries);
      if(d && render(d).count)return {...d,month:issue.month};
    }
    return null;
  }
  function draft(entries,date=new Date(),select=true) {
    let featured=false;
    return {subject:new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'America/New_York'}).format(date)+' · James Kull',
      intro:'A few things I’ve been writing, building, and photographing.',closing:'Thanks for following along.\nJames',
      items:entries.map(e=>{const firstPhoto=!featured && e.kind==='photo';if(firstPhoto)featured=true;return {...e,keys:e.newKeys||e.keys,selected:select,featured:firstPhoto};})};
  }
  function render(draftValue) {
    const d=normalize({draft:draftValue}).draft;
    if(!d)return {html:'',text:'',count:0};
    const selected=d.items.filter(e=>e.selected);
    const paragraphs=value=>value.trim()?value.trim().split(/\n\s*\n/).map(p=>'<p>'+esc(p).replace(/\n/g,'<br>')+'</p>').join('\n'):'';
    const html=[paragraphs(d.intro)],plain=[d.intro.trim()];
    for(const [kind,label] of [['essay','Essays'],['note','Notes'],['project','Projects'],['photo','Photographs']]) {
      const group=selected.filter(e=>e.kind===kind);if(!group.length)continue;
      html.push('<h2>'+label+'</h2>');plain.push(label);
      for(const e of group) {
        if(e.kind==='photo' && e.featured && e.image)html.push('<p><a href="'+esc(e.href)+'"><img src="'+esc(e.image)+'" alt="'+esc(e.alt)+'" width="600" style="max-width:100%;height:auto"></a></p>');
        html.push('<h3><a href="'+esc(e.href)+'">'+esc(e.title)+'</a></h3>'+paragraphs(e.summary));
        plain.push(e.title+(e.summary?'\n'+e.summary:'')+'\n'+e.href);
      }
    }
    html.push(paragraphs(d.closing),'<p><a href="'+site+'/">Visit jameskull.com</a></p>');plain.push(d.closing.trim(),'Visit jameskull.com: '+site+'/');
    return {html:html.filter(Boolean).join('\n'),text:plain.filter(Boolean).join('\n\n'),count:selected.length};
  }
  function recordSent(state,publishedURL,now=new Date()) {
    const next=normalize(state),valid=writing.substackURL(publishedURL);
    if(!valid)throw Error('Paste the published issue URL from jameskull.substack.com/p/…');
    if(!next.draft || !next.draft.subject.trim() || !render(next.draft).count)throw Error('Select at least one highlight and add a subject first.');
    if(next.history.some(h=>h.url===valid))throw Error('That issue is already recorded.');
    const covered=keys(next.draft.items.filter(e=>e.selected).flatMap(e=>e.keys));
    next.sentKeys=keys([...next.sentKeys,...covered]);
    next.history.push({subject:next.draft.subject,url:valid,sentAt:now.toISOString(),keys:covered,month:month(next.draft.month)});
    next.history=next.history.slice(-24);next.draft=null;
    return next;
  }
  const api={site,publication,url,normalize,inventory,candidates,draft,render,recordSent,keys,liveDraft,monthlyDraft};
  root.NewsletterData=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
