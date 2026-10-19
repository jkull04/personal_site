/* Shared, dependency-free writing rendering. Raw HTML is always treated as text. */
((root) => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const href = entry => '/writings/posts/'+entry.id+'/';
  function safeURL(value) {
    try { const url=new URL(value); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  }
  function substackURL(value) {
    if(!value) return '';
    try { const url=new URL(value); return url.protocol==='https:' && url.hostname==='jameskull.substack.com' && /^\/p\/[^/]+\/?$/.test(url.pathname) && !url.username && !url.password ? url.origin+url.pathname.replace(/\/$/,'') : ''; } catch { return ''; }
  }
  function inline(value) {
    const pattern=/`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
    let result='',last=0;
    for(const match of value.matchAll(pattern)) {
      result+=esc(value.slice(last,match.index));
      if(match[1]) result+='<code>'+esc(match[1])+'</code>';
      else if(match[2]) {const url=safeURL(match[3]);result+=url?'<a href="'+esc(url)+'" rel="noopener noreferrer">'+esc(match[2])+'</a>':esc(match[0]);}
      else if(match[4]) result+='<strong>'+esc(match[4])+'</strong>';
      else result+='<em>'+esc(match[5])+'</em>';
      last=match.index+match[0].length;
    }
    return result+esc(value.slice(last));
  }
  function markdown(value) {
    const lines=String(value||'').replace(/\r\n?/g,'\n').split('\n');
    let out=[],paragraph=[],list=[],listTag='',quote=[],code=null;
    const flushParagraph=()=>{if(paragraph.length){out.push('<p>'+paragraph.map(inline).join('<br>')+'</p>');paragraph=[];}};
    const flushList=()=>{if(list.length){out.push('<'+listTag+'>'+list.map(v=>'<li>'+inline(v)+'</li>').join('')+'</'+listTag+'>');list=[];listTag='';}};
    const flushQuote=()=>{if(quote.length){out.push('<blockquote><p>'+quote.map(inline).join('<br>')+'</p></blockquote>');quote=[];}};
    const flush=()=>{flushParagraph();flushList();flushQuote();};
    for(const line of lines) {
      if(/^```/.test(line)) {flush();if(code===null) code=[];else {out.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');code=null;}continue;}
      if(code!==null){code.push(line);continue;}
      if(!line.trim()){flush();continue;}
      const heading=line.match(/^(#{1,3})\s+(.+)$/),item=line.match(/^\s*(?:([-*])|\d+\.)\s+(.+)$/),quotation=line.match(/^>\s?(.*)$/);
      if(heading){flush();const level=heading[1].length+1;out.push('<h'+level+'>'+inline(heading[2])+'</h'+level+'>');}
      else if(item){flushParagraph();flushQuote();const tag=item[1]?'ul':'ol';if(listTag && listTag!==tag)flushList();listTag=tag;list.push(item[2]);}
      else if(quotation){flushParagraph();flushList();quote.push(quotation[1]);}
      else {flushList();flushQuote();paragraph.push(line);}
    }
    flush();if(code!==null)out.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');
    return out.join('\n');
  }
  function validate(entry,publishing=false) {
    if(!/^[a-zA-Z0-9_-]+$/.test(entry.id))throw Error('Invalid writing ID.');
    const allowed=['id','title','subtitle','abstract','date','type','tags','body','substackUrl','published'];
    for(const [key,value] of Object.entries(entry)) {
      if(!allowed.includes(key) || (key==='published'?typeof value!=='boolean':typeof value!=='string') || String(value).length>(key==='body'?200000:2000)) throw Error('Invalid writing field: '+key);
    }
    if(!['essay','blog'].includes(entry.type)) throw Error('Choose Essay or Note for each writing.');
    if(entry.date && (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(Date.parse(entry.date)) || new Date(entry.date).toISOString().slice(0,10)!==entry.date)) throw Error('Choose a valid writing date.');
    if(entry.substackUrl && !substackURL(entry.substackUrl)) throw Error('Use a published post URL from https://jameskull.substack.com/p/…');
    if(publishing && entry.published!==false && (!entry.title?.trim() || !entry.body?.trim() || !entry.date)) throw Error('Add a title, date, and body to every included writing.');
  }
  function listing(entries,remote) {
    const local=(entries||[]).filter(e=>e.published!==false);
    const linked=new Set(local.map(e=>substackURL(e.substackUrl)).filter(Boolean));
    return [...local.map(e=>({...e,source:'studio',href:href(e),tags:(e.tags||'').split(',').map(t=>t.trim()).filter(Boolean),abstract:e.abstract||e.subtitle||''})),...(remote||[]).filter(e=>!linked.has(substackURL(e.href)))];
  }
  function bodyForSubstack(entry) {
    const url='https://www.jameskull.com'+href(entry);
    return {html:markdown(entry.body)+'\n<p>Originally published on <a href="'+url+'">jameskull.com</a>.</p>',text:entry.body+'\n\nOriginally published on jameskull.com: '+url};
  }
  function page(entry) {
    validate(entry,true);
    const url='https://www.jameskull.com'+href(entry);
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(entry.title)} | James Kull</title><meta name="description" content="${esc(entry.abstract||entry.subtitle||'Writing by James Kull')}"><link rel="canonical" href="${url}"><meta property="og:title" content="${esc(entry.title)}"><meta property="og:type" content="article"><meta property="og:url" content="${url}"><meta property="og:description" content="${esc(entry.abstract||entry.subtitle||'Writing by James Kull')}"><link rel="icon" href="/assets/icons/favicon-32.png"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap"><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/writing.css"></head>
<body><a class="skip-link" href="#main">Skip to content</a><header class="page-header site-shell"><nav class="top-nav" aria-label="Primary"><a class="brand" href="/">JFK</a><ul class="nav-links"><li><a href="/">Home</a></li><li><a class="is-active" href="/writings/">Writings</a></li><li><a href="/books/">Books</a></li><li><a href="/photography/">Photos</a></li><li><a href="/contact/">Contact</a></li></ul></nav></header>
<main id="main" class="site-shell"><article class="writing-article"><a href="/writings/">← All writings</a><header><p class="eyebrow">${entry.type==='blog'?'Note':'Essay'} · <time datetime="${esc(entry.date)}">${esc(entry.date)}</time></p><h1>${esc(entry.title)}</h1>${entry.subtitle?'<p class="writing-subtitle">'+esc(entry.subtitle)+'</p>':''}<p class="meta-line">James Kull</p></header><div class="writing-prose">${markdown(entry.body)}</div>${entry.substackUrl?'<p class="writing-crosspost"><a href="'+esc(substackURL(entry.substackUrl))+'" target="_blank" rel="noopener noreferrer">Also on Substack ↗</a></p>':''}</article></main><footer class="footer site-shell"><p>James Kull | Classics and Economics, Washington and Lee University.</p></footer></body></html>\n`;
  }
  const api={esc,href,markdown,validate,listing,page,substackURL,bodyForSubstack};root.WritingData=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
