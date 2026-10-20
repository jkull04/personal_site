(() => {
  'use strict';
  const section=document.getElementById('home-selections'),list=document.getElementById('selected-things');
  if(!section || !list)return;
  const esc=WritingData.esc;
  const read=path=>fetch(path).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>Array.isArray(data)?data:[]).catch(()=>[]);
  const image=(src,alt,style='')=>`<div class="selection-image ${style}">${src?`<img src="${esc(src)}" alt="${esc(alt)}" width="640" height="400" loading="lazy" decoding="async">`:''}</div>`;
  function card(kind,title,description,url,visual,cta) {
    const safe=ShowcaseData.linkURL(url);if(!safe)return '';
    return `<article class="selection-card"><a class="selection-link" href="${esc(safe)}">${visual}<div class="selection-copy"><p class="eyebrow">${kind}</p><h3>${esc(title)}</h3><p class="selection-description">${esc(description)}</p><span class="selection-cta">${cta} <span aria-hidden="true">↗</span></span></div></a></article>`;
  }
  Promise.all(['/data/showcase.json','/data/works-substack.json','/data/books.json','/data/writings-local.json','/data/photography.json'].map(read)).then(([settings,remoteProjects,books,local,photos])=>{
    const projects=WritingData.projects(local,remoteProjects).map(p=>ShowcaseData.project(p,settings));
    const selected=ShowcaseData.latest(books,projects,photos);
    const cards=[];
    if(selected.book){const b=selected.book;cards.push(card('Latest book',b.title,b.author||'', '/books/#book-'+encodeURIComponent(b.id),image(BookData.imageURL(b,'L'),'Cover of '+b.title,'selection-book'),'View book'));}
    if(selected.photos.length){const p=PhotoData.preview(selected.photos)[0]||selected.photos[0],src=ShowcaseData.imageURL(p.thumb)||ShowcaseData.imageURL(p.src);cards.push(card('Latest collection',selected.album,`${selected.photos.length} photograph${selected.photos.length===1?'':'s'}`, '/photography/'+PhotoData.link(selected.photos,selected.album),image(src,p.alt||''),'Open collection'));}
    if(selected.project){const p=selected.project;cards.push(card('Latest project',p.title,p.summary||p.output||'', '/projects/#work-'+p.id, image(p.imageSrc||'/assets/illustrations/runtime/hero-projects-forum-960.webp',p.imageAlt||'',!p.imageSrc||p.imageSrc.includes('/illustrations/')?'selection-art':''),'Explore project'));}
    list.innerHTML=cards.join('');section.hidden=!cards.length;
    list.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;img.parentElement.classList.add('image-unavailable');}));
  });
})();
