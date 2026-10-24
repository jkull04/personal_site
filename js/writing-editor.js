/* Studio-only UI; storage and publishing stay in the existing protected workflow. */
window.createWritingEditor = ({getState,save,isBusy,onChange,uploadImage}) => {
  const $=id=>document.getElementById(id), esc=WritingData.esc;
  const holder=$('writing-edit-list');
  const entryFor=target=>getState().data.writings.find(e=>e.id===target.closest('[data-writing-id]')?.dataset.writingId);
  function presentation(entry,create=false) {
    const settings=getState().data.showcase ||= [];
    let display=settings.find(s=>s.id==='project-'+entry.id);
    if(!display && create){display={id:'project-'+entry.id,projectId:entry.id,imageSrc:'',imageAlt:'',demoUrl:''};settings.push(display);}
    return display || {};
  }
  function imageSource(entry) {
    const display=presentation(entry),pending=getState().images[display.imageSrc?.slice(1)];
    return pending?'data:image/jpeg;base64,'+pending:ShowcaseData.imageURL(display.imageSrc);
  }
  function stateLabel(entry) {
    const saved=getState().baseline.writings.find(e=>e.id===entry.id);
    if(entry.published===false)return saved?'Removal pending':'Private draft';
    if(!saved)return 'Not published';
    const display=presentation(entry),previous=getState().baseline.showcase?.find(s=>s.id==='project-'+entry.id)||{};
    return JSON.stringify(entry)===JSON.stringify(saved) && (entry.type!=='project'||JSON.stringify(display)===JSON.stringify(previous))?'Published':'Changes to publish';
  }
  function control(entry,key,label,type='text',wide=false) {
    const id='writing-'+entry.id+'-'+key;
    const attrs=`id="${id}" data-writing-key="${key}"`;
    let input;
    if(type==='textarea')input=`<textarea ${attrs} rows="${key==='body'?18:3}" maxlength="${key==='body'?200000:2000}">${esc(entry[key])}</textarea>`;
    else if(type==='category')input=`<select ${attrs}><option value="essay" ${entry.type==='essay'?'selected':''}>Essay</option><option value="blog" ${entry.type==='blog'?'selected':''}>Note</option><option value="project" ${entry.type==='project'?'selected':''}>Project</option></select>`;
    else input=`<input ${attrs} type="${type}" value="${esc(entry[key])}" maxlength="2000" />`;
    return `<label class="${wide?'wide':''}" for="${id}">${label}${input}</label>`;
  }
  function refresh() {
    const entries=getState().data.writings;
    $('writing-count').textContent=`${entries.length} writing${entries.length===1?'':'s'} · ${entries.filter(e=>e.published===false).length} private drafts`;
    for(const card of holder.querySelectorAll('[data-writing-id]')) {
      const entry=entries.find(e=>e.id===card.dataset.writingId);if(!entry)continue;
      card.querySelector('[data-writing-title]').textContent=entry.title||'Untitled writing';
      card.querySelector('[data-writing-state]').textContent=stateLabel(entry)+(entry.substackUrl?' · Substack link saved':'');
      card.querySelector('[data-project-fields]').hidden=entry.type!=='project';
      card.querySelector('[data-project-presentation]').hidden=entry.type!=='project';
      card.querySelector('[data-project-crosspost]').hidden=entry.type!=='project';
      card.querySelector('[data-writing-destination]').textContent=entry.type==='project'?'This project will appear on the Projects page. Add Problem, Approach, and Output below; the main writing field is optional for additional detail.':'This writing will appear on the Writings page.';
      const preview=card.querySelector('[data-writing-preview]');
      if(preview.open)renderPreview(card,entry);
    }
  }
  function renderPreview(card,entry) {
    card.querySelector('[data-preview-content]').innerHTML=`<h2>${esc(entry.title||'Untitled writing')}</h2>${entry.subtitle?'<p class="writing-subtitle">'+esc(entry.subtitle)+'</p>':''}${entry.type==='project'&&imageSource(entry)?`<img class="project-image-preview" src="${esc(imageSource(entry))}" alt="${esc(presentation(entry).imageAlt)}">`:''}<div class="writing-prose">${WritingData.markdown(WritingData.articleBody(entry))}</div>`;
  }
  function render() {
    const open=new Set([...holder.querySelectorAll('[data-writing-id] > details[open]')].map(el=>el.parentElement.dataset.writingId));
    holder.innerHTML=getState().data.writings.map(entry=>`<article class="writing-edit-card" data-writing-id="${entry.id}"><details ${open.has(entry.id)?'open':''}><summary><strong data-writing-title>${esc(entry.title||'Untitled writing')}</strong><span class="book-badge" data-writing-state></span></summary><div class="edit-fields">
      ${control(entry,'title','Title','text',true)}${control(entry,'subtitle','Subtitle (optional)','text',true)}${control(entry,'type','Category','category')}${control(entry,'date','Publication date','date')}${control(entry,'tags','Topics (comma separated)','text',true)}${control(entry,'abstract','Short description for the website','textarea',true)}
      </div><p class="writing-format-help" data-writing-destination></p>
      <section class="studio-panel" data-project-presentation ${entry.type==='project'?'':'hidden'} aria-label="Project image">
        <h3>Project image</h3>
        ${imageSource(entry)?`<img class="project-image-preview" src="${esc(imageSource(entry))}" alt="${esc(presentation(entry).imageAlt||'Project preview')}">`:''}
        <label class="cover-upload" for="writing-${entry.id}-image">${imageSource(entry)?'Replace image':'Add image'}<input id="writing-${entry.id}-image" type="file" data-writing-image accept="image/jpeg,image/png,image/webp"></label>
        <p class="writing-format-help">JPEG, PNG, or WebP. Appears on your project card and full article.</p>
        <div class="edit-fields"><label class="wide" for="writing-${entry.id}-image-alt">Image description<input id="writing-${entry.id}-image-alt" data-writing-presentation="imageAlt" value="${esc(presentation(entry).imageAlt||'')}" maxlength="1000" placeholder="Describe what the image shows"></label></div>
        <button type="button" data-writing-action="remove-image" ${imageSource(entry)?'':'hidden'}>Remove image</button>
        <p data-writing-image-feedback role="status"></p>
      </section>
      <div class="edit-fields" data-project-fields ${entry.type==='project'?'':'hidden'}>${control(entry,'problem','Problem — what did you set out to solve?','textarea',true)}${control(entry,'approach','Approach — how did you tackle it?','textarea',true)}${control(entry,'output','Output — what did you make or learn?','textarea',true)}</div>
      <div class="edit-fields">${control(entry,'body','Writing / additional project detail','textarea',true)}</div>
      <p class="writing-format-help">Plain text works. For formatting use # Heading, **bold**, *italic*, - bullet, &gt; quotation, or [link text](https://…). Separate paragraphs with a blank line.</p>
      <details data-writing-preview class="writing-preview"><summary>Preview article</summary><div data-preview-content></div></details>
      <label class="checkbox writing-inclusion"><input type="checkbox" data-writing-key="published" ${entry.published!==false?'checked':''} />Include on public site</label>
      <p class="writing-format-help">Check this box, then use “Publish updates” above. Leaving it unchecked keeps a new writing in this browser only. Unchecking a published writing removes its page on the next publish.</p>
      <div class="studio-actions"><a href="${WritingData.href(entry)}" target="_blank" rel="noopener" ${getState().baseline.writings.some(e=>e.id===entry.id)?'':'hidden'}>View website article ↗</a><button type="button" data-writing-action="download">Download Markdown</button><button type="button" data-writing-action="remove">Remove writing</button></div>
      <section class="writing-crosspost-panel" aria-label="Crosspost to Substack"><h3>Crosspost to Substack</h3><p data-project-crosspost ${entry.type==='project'?'':'hidden'}>For projects, add the “Projects” tag in Substack. The copied body includes the Problem, Approach, and Output headings used by the site’s sync.</p><p>After publishing here, copy the title, subtitle, and formatted body into a new Substack post. Review it and publish there; nothing is sent to subscribers from Studio.</p><div class="studio-actions"><button type="button" data-writing-action="title">Copy title</button><button type="button" data-writing-action="subtitle">Copy subtitle</button><button type="button" data-writing-action="body">Copy for Substack</button><a href="https://jameskull.substack.com/publish" target="_blank" rel="noopener noreferrer">Open Substack ↗</a></div><p class="writing-format-help">The body includes a link to the original article on your website. After publishing on Substack, save the post URL below and publish updates again to link the two versions and avoid a duplicate listing.</p>${control(entry,'substackUrl','Published Substack post URL (optional)','url',true)}</section>
      <p data-writing-feedback role="status" aria-live="polite"></p>
      </details></article>`).join('')||'<p class="studio-panel">Your essays, notes, and projects start here. Add a writing to open a draft.</p>';
    holder.querySelectorAll('[data-writing-preview]').forEach(details=>details.ontoggle=()=>{if(details.open){const card=details.closest('[data-writing-id]');renderPreview(card,entryFor(details));}});
    refresh();
  }
  $('add-writing').onclick=()=>{
    if(isBusy())return;
    const today=new Date();today.setMinutes(today.getMinutes()-today.getTimezoneOffset());
    const entry={id:crypto.randomUUID(),title:'',subtitle:'',abstract:'',date:today.toISOString().slice(0,10),type:'essay',tags:'',body:'',substackUrl:'',published:false};
    onChange();getState().data.writings.unshift(entry);render();save().catch(()=>{});
    const input=$('writing-'+entry.id+'-title');input.closest('details').open=true;input.focus();
  };
  holder.addEventListener('change',async event=>{
    if(!event.target.matches('[data-writing-image]')||isBusy())return;
    const file=event.target.files[0],entry=entryFor(event.target);if(!file||!entry)return;
    const feedback=event.target.closest('[data-writing-id]').querySelector('[data-writing-image-feedback]');
    feedback.textContent='Preparing image…';
    try {
      StudioAccess.requireUnlocked();
      const path=await uploadImage(file);
      onChange();const display=presentation(entry,true);display.imageSrc=path;
      if(!display.imageAlt)display.imageAlt='Screenshot of '+(entry.title||'project');
      await save();render();
    } catch(error){feedback.textContent=error.message;}
    finally {event.target.value='';}
  });
  holder.addEventListener('input',event=>{
    if(isBusy())return;
    if(event.target.dataset.writingPresentation) {
      const entry=entryFor(event.target);if(!entry)return;
      onChange();presentation(entry,true)[event.target.dataset.writingPresentation]=event.target.value;
      refresh();save().catch(()=>{});return;
    }
    if(!event.target.dataset.writingKey)return;
    const entry=entryFor(event.target);if(!entry)return;
    onChange();entry[event.target.dataset.writingKey]=event.target.type==='checkbox'?event.target.checked:event.target.value;
    refresh();save().catch(()=>{});
  });
  holder.addEventListener('click',async event=>{
    const button=event.target.closest('[data-writing-action]');if(!button || isBusy())return;
    const entry=entryFor(button),card=button.closest('[data-writing-id]'),feedback=card.querySelector('[data-writing-feedback]');
    const action=button.dataset.writingAction;
    try {
      StudioAccess.requireUnlocked();
      if(action==='remove-image') {
        onChange();const display=presentation(entry,true);display.imageSrc='';display.imageAlt='';
        await save();render();return;
      }
      if(action==='remove') {
        if(!confirm('Remove this writing from your draft? Its website page is removed only after you publish updates. Its Substack post is unchanged.'))return;
        onChange();getState().data.writings=getState().data.writings.filter(e=>e.id!==entry.id);getState().data.showcase=(getState().data.showcase||[]).filter(s=>s.id!=='project-'+entry.id);render();await save();return;
      }
      if(action==='download') {
        const content='# '+entry.title+'\n\n'+(entry.subtitle?entry.subtitle+'\n\n':'')+WritingData.articleBody(entry)+'\n';
        const url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'}));
        const a=document.createElement('a');a.href=url;a.download=(entry.title.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,80)||'writing')+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
      }
      if(stateLabel(entry)!=='Published')throw Error('Publish this writing’s latest changes to your website first, then copy it for Substack.');
      if(action==='body') {
        const body=WritingData.bodyForSubstack(entry);
        if(navigator.clipboard?.write && window.ClipboardItem) {
          // Invoke write directly in the click event for Safari user activation.
          await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([body.html],{type:'text/html'}),'text/plain':new Blob([body.text],{type:'text/plain'})})]);
          feedback.textContent='Formatted body copied. Open Substack, start a new post, paste into its body, and review before publishing.';
        } else {await navigator.clipboard.writeText(body.text);feedback.textContent='Copied as plain text with Markdown. Paste in Substack and check formatting before publishing.';}
      } else {
        if(!entry[action])throw Error('This writing has no '+action+'.');
        await navigator.clipboard.writeText(entry[action]);feedback.textContent=action==='title'?'Title copied. Paste into Substack’s title field.':'Subtitle copied. Paste into Substack’s subtitle field.';
      }
    } catch(error) {feedback.textContent=error.name==='NotAllowedError'?'Clipboard permission was denied. Allow clipboard access or use Download Markdown and copy from that file.':error.message;}
  });
  return {render,refresh};
};
