(() => {
  'use strict';
  const section=document.getElementById('home-selections'),list=document.getElementById('selected-things');
  if(!section || !list)return;
  const esc=WritingData.esc;
  const read=path=>fetch(path).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>Array.isArray(data)?data:[]).catch(()=>[]);
  const image=(src,alt,art=false)=>`<div class="selection-image ${art?'selection-art':''}"><img src="${esc(src)}" alt="${esc(alt)}" width="640" height="400" loading="lazy" decoding="async"></div>`;
  function card(kind,title,description,url,visual,cta) {
    const safe=ShowcaseData.linkURL(url);if(!safe)return '';
    return `<article class="selection-card"><a class="selection-link" href="${esc(safe)}">${visual}<div class="selection-copy"><p class="eyebrow">${kind}</p><h3>${esc(title)}</h3><p class="selection-description">${esc(description)}</p><span class="selection-cta">${cta} <span aria-hidden="true">↗</span></span></div></a></article>`;
  }
  Promise.all(['/data/showcase.json','/data/works-substack.json','/data/writings.json','/data/writings-local.json','/data/photography.json'].map(read)).then(([settings,remoteProjects,remoteWritings,local,photos])=>{
    const projects=WritingData.projects(local,remoteProjects).map(p=>ShowcaseData.project(p,settings));
    const selected=ShowcaseData.selections(settings,projects,WritingData.listing(local,remoteWritings),photos);
    const cards=[];
    if(selected.project){const p=selected.project;cards.push(card('Project',p.title,p.summary||p.output||'', '/projects/#work-'+p.id, image(p.imageSrc||'/assets/illustrations/runtime/hero-projects-forum-960.webp',p.imageAlt||'',!p.imageSrc||p.imageSrc.includes('/illustrations/')),'Explore project'));}
    if(selected.writing){const w=selected.writing;cards.push(card(w.type==='blog'?'Note':'Essay',w.title,w.abstract||'',w.href,image('/assets/illustrations/runtime/hero-writings-pantheon-960.webp','',true),w.type==='blog'?'Read note':'Read essay'));}
    if(selected.photos.length){const p=PhotoData.preview(selected.photos)[0]||selected.photos[0],src=ShowcaseData.imageURL(p.thumb)||ShowcaseData.imageURL(p.src);if(src)cards.push(card('Photographs',selected.album||'Photographs',`${selected.photos.length} photographs`, '/photography/'+PhotoData.link(photos,selected.album),image(src,p.alt||''),'Open collection'));}
    list.innerHTML=cards.join('');section.hidden=!cards.length;
    list.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;img.parentElement.classList.add('image-unavailable');}));
  });
})();
