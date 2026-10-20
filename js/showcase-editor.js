window.createShowcaseEditor = ({getState,save,isBusy,onChange,uploadImage}) => {
  const $=id=>document.getElementById(id),esc=WritingData.esc;
  let remoteProjects=[],remoteWritings=[],loaded=false;
  const settings=()=>getState().data.showcase ||= [];
  function home() {let entry=settings().find(e=>e.id==='home');if(!entry){entry={id:'home',projectId:'',writingId:'',album:''};settings().unshift(entry);}return entry;}
  const projects=()=>WritingData.projects(getState().data.writings,remoteProjects);
  function display(id) {let entry=settings().find(e=>e.id==='project-'+id);if(!entry){entry={id:'project-'+id,projectId:id,imageSrc:'',imageAlt:'',demoUrl:''};settings().push(entry);}return entry;}
  function options(select,items,current,automatic) {
    select.replaceChildren(new Option(automatic,''));
    items.forEach(([value,label])=>select.add(new Option(label,value)));
    if(current && !items.some(([value])=>value===current))select.add(new Option('Unavailable selection — automatic fallback',current));
    select.value=current||'';
  }
  function refreshPreview() {
    const selected=ShowcaseData.selections(settings(),projects(),WritingData.listing(getState().data.writings,remoteWritings),getState().data.photography);
    $('homepage-selection-preview').textContent=[selected.project?'Project: '+selected.project.title:'No published project yet',selected.writing?'Writing: '+selected.writing.title:'No published writing yet',selected.photos.length?'Photos: '+(selected.album||'Ungrouped'):'No published photo collection yet'].join(' · ');
  }
  function render() {
    if(!getState())return;
    const values=settings().find(e=>e.id==='home')||{};
    options($('homepage-project'),projects().map(p=>[p.id,p.title]),values.projectId,'Latest project');
    options($('homepage-writing'),WritingData.listing(getState().data.writings,remoteWritings).map(w=>[w.id,w.title]),values.writingId,'Latest writing');
    const groups=[...new Set(getState().data.photography.filter(p=>p.published!==false).map(PhotoData.group))];
    options($('homepage-album'),groups.filter(Boolean).map(g=>[g,g]),values.album,'First photo collection');
    const opened=new Set([...$('project-presentations').querySelectorAll('details[open]')].map(el=>el.dataset.project));
    $('project-presentations').innerHTML=projects().map(project=>{
      const entry=settings().find(e=>e.id==='project-'+project.id)||{},pending=getState().images[entry.imageSrc?.slice(1)];
      const src=pending?'data:image/jpeg;base64,'+pending:ShowcaseData.imageURL(entry.imageSrc);
      return `<details class="project-presentation studio-panel" data-project="${esc(project.id)}" ${opened.has(project.id)?'open':''}><summary>${esc(project.title)}</summary><div class="project-presentation-layout"><div>${src?`<img class="project-image-preview" src="${esc(src)}" alt="${esc(entry.imageAlt||'Project preview')}">`:'<p class="project-image-placeholder">The site’s pixel art appears until you add an image.</p>'}<label class="cover-upload">Add screenshot or image<input type="file" data-project-image accept="image/jpeg,image/png,image/webp"></label><button type="button" data-project-reset ${src?'':'hidden'}>Use default artwork</button></div><div class="edit-fields"><label class="wide">Image description<input data-presentation-key="imageAlt" value="${esc(entry.imageAlt||'')}" maxlength="1000" placeholder="Describe what the screenshot shows"></label><label class="wide">Try it — website or demo URL<input data-presentation-key="demoUrl" value="${esc(entry.demoUrl||'')}" maxlength="1000" placeholder="https://…"></label><p class="wide">The project’s existing write-up remains linked. Images and links appear on Projects and in homepage selections.</p></div></div><p data-project-feedback role="status"></p></details>`;
    }).join('')||'<p>Publish a project from Writings to add its image here.</p>';
    refreshPreview();
  }
  for(const [id,key] of [['homepage-project','projectId'],['homepage-writing','writingId'],['homepage-album','album']])$(id).addEventListener('change',()=>{if(isBusy())return;onChange();home()[key]=$(id).value;refreshPreview();save().catch(()=>{});});
  $('project-presentations').addEventListener('input',event=>{
    const key=event.target.dataset.presentationKey;if(!key||isBusy())return;
    onChange();display(event.target.closest('[data-project]').dataset.project)[key]=event.target.value;save().catch(()=>{});
  });
  $('project-presentations').addEventListener('change',async event=>{
    if(!event.target.matches('[data-project-image]')||isBusy())return;
    const file=event.target.files[0];if(!file)return;
    const card=event.target.closest('[data-project]'),id=card.dataset.project;
    try {onChange();const path=await uploadImage(file);const entry=display(id);entry.imageSrc=path;if(!entry.imageAlt)entry.imageAlt='Screenshot of '+projects().find(p=>p.id===id).title;await save();render();}
    catch(error){card.querySelector('[data-project-feedback]').textContent=error.message;}
  });
  $('project-presentations').addEventListener('click',event=>{
    if(!event.target.matches('[data-project-reset]')||isBusy())return;
    const entry=display(event.target.closest('[data-project]').dataset.project);onChange();entry.imageSrc='';entry.imageAlt='';save().catch(()=>{});render();
  });
  async function load() {
    if(loaded){render();return;}
    const read=path=>fetch(path,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Could not load existing projects and writings.');return r.json();});
    try {const results=await Promise.all([read('/data/works-substack.json'),read('/data/writings.json')]);[remoteProjects,remoteWritings]=results;loaded=true;$('showcase-status').textContent='';render();}
    catch(error){$('showcase-status').textContent=error.message+' Reopen this tab to retry.';render();}
  }
  return {render,load};
};
