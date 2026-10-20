/* Public presentation settings, shared by Studio and the publishing service. */
((root) => {
  'use strict';
  const asset = /^\/assets\/[a-zA-Z0-9_/-]+\.(?:png|jpe?g|webp)$/;
  const cloud = /^https:\/\/jameskull-studio-storage\.fitzykull\.workers\.dev\/photos\/[a-f0-9]{64}\.jpg$/;
  const imageURL = value => typeof value==='string' && (asset.test(value) || cloud.test(value)) ? value : '';
  function linkURL(value) {
    if(typeof value!=='string' || /[\u0000-\u0020\\]/.test(value)) return '';
    if(/^\/(?!\/)/.test(value)) return value;
    try {const url=new URL(value);return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';} catch {return '';}
  }
  function validate(entry) {
    const home=entry.id==='home';
    const fields=home?['id','projectId','writingId','album']:['id','projectId','imageSrc','imageAlt','demoUrl'];
    for(const [key,value] of Object.entries(entry)) {
      if(!fields.includes(key) || typeof value!=='string' || value.length>1000) throw Error('Invalid showcase field: '+key);
    }
    if(!home && (!entry.projectId || entry.id!=='project-'+entry.projectId))throw Error('Invalid project presentation.');
    for(const key of ['projectId','writingId'])if(entry[key] && !/^[a-zA-Z0-9_-]+$/.test(entry[key]))throw Error('Choose a valid '+key+'.');
    if(entry.imageSrc && !imageURL(entry.imageSrc))throw Error('Choose a valid project image.');
    if(entry.imageSrc && !entry.imageAlt?.trim())throw Error('Describe each project image before publishing.');
    if(entry.demoUrl && !linkURL(entry.demoUrl))throw Error('Use a website URL or a path on this site for the project demo.');
  }
  function project(entry, settings=[]) {
    const display=settings.find(s=>s.id==='project-'+entry.id) || {};
    return {...entry,imageSrc:imageURL(display.imageSrc),imageAlt:display.imageAlt || '',demoUrl:linkURL(display.demoUrl)};
  }
  function selections(settings=[],projects=[],writings=[],photos=[]) {
    const home=settings.find(s=>s.id==='home') || {};
    const newest=items=>items.filter(e=>e.published!==false).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    const works=newest(projects),texts=newest(writings),pictures=photos.filter(e=>e.published!==false);
    const groups=[...new Set(pictures.map(p=>(p.collection||'').trim()))];
    const album=groups.includes(home.album)?home.album:groups[0];
    return {project:works.find(e=>e.id===home.projectId)||works[0],writing:texts.find(e=>e.id===home.writingId)||texts[0],album,photos:pictures.filter(p=>(p.collection||'').trim()===album)};
  }
  const api={imageURL,linkURL,validate,project,selections};root.ShowcaseData=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
