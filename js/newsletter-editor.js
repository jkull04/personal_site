window.createNewsletterEditor = ({getState,save,isBusy}) => {
  const $=id=>document.getElementById(id),N=NewsletterData,esc=WritingData.esc;
  let entries=[],baseline=[],feed=null,loaded=false,loading=false;
  const state=()=>getState().newsletter ||= N.normalize();
  const status=message=>$('newsletter-status').textContent=message;
  const persist=()=>save().catch(()=>status('Could not save this draft. Download an encrypted Studio backup before leaving.'));
  const pending=()=>N.candidates(entries,baseline,state().sentKeys);
  const monthly=()=>N.monthlyDraft(feed,entries,state());
  function syncControls() {
    const d=getState()?.newsletter?.draft,count=d?N.render(d).count:0;
    for(const id of ['newsletter-copy-subject','newsletter-copy','newsletter-download','newsletter-record'])$(id).disabled=isBusy()||loading||!loaded||!count||!d.subject.trim();
    $('newsletter-new').disabled=isBusy()||loading||!loaded||!pending().length;
    $('newsletter-all').disabled=isBusy()||loading||!loaded;
    $('newsletter-refresh').disabled=isBusy()||loading;
    $('newsletter-auto').disabled=isBusy()||loading||!loaded||!monthly();
  }
  function preview() {
    const d=state().draft,result=N.render(d);
    $('newsletter-preview-subject').textContent=d?.subject||'Your monthly update';
    $('newsletter-preview-body').innerHTML=result.count?result.html:'<p class="newsletter-empty">Choose a few highlights to preview your email.</p>';
    $('newsletter-count').textContent=result.count?`${result.count} highlight${result.count===1?'':'s'} selected. Preview and copy do not send email.`:'Nothing selected. Skip this month if there is nothing new.';
    syncControls();
  }
  function render() {
    if(!getState())return;
    const s=state(),d=s.draft;
    $('newsletter-compose').hidden=!d;
    $('newsletter-subject').value=d?.subject||'';
    $('newsletter-intro').value=d?.intro||'';
    $('newsletter-closing').value=d?.closing||'';
    const fresh=loaded?pending().length:0;
    const automatic=loaded?monthly():null;
    $('newsletter-summary').textContent=!loaded?'Open this tab to load published content.':automatic?`${automatic.subject} is ready. ${d?'Your current draft is kept until you choose to replace it.':''}`:fresh?`${fresh} new ${fresh===1?'highlight':'highlights'} so far. Your monthly draft will arrive after the month ends.`:'No monthly draft waiting. Quiet months stay quiet.';
    $('newsletter-items').innerHTML=(d?.items||[]).map((e,i)=>`<article class="newsletter-item" data-newsletter-item="${i}"><p class="newsletter-kind">${e.kind==='photo'?'Photo collection':esc(e.kind)}</p><label class="checkbox"><input type="checkbox" data-newsletter-field="selected" ${e.selected?'checked':''}><strong>${esc(e.title)}</strong></label><a href="${esc(e.href)}" target="_blank" rel="noopener noreferrer">View on site ↗</a><label>Title<input data-newsletter-field="title" maxlength="300" value="${esc(e.title)}"></label><label>A sentence about it<textarea data-newsletter-field="summary" maxlength="2000" rows="3">${esc(e.summary)}</textarea></label>${e.kind==='photo'&&e.image?`<label class="checkbox"><input type="checkbox" data-newsletter-field="featured" ${e.featured?'checked':''}>Include a photograph</label>`:''}</article>`).join('');
    $('newsletter-history').innerHTML=s.history.slice().reverse().map(h=>`<li>${h.url?`<a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">${esc(h.subject)}</a>`:esc(h.subject)} <small>— recorded ${esc(h.sentAt.slice(0,10))}</small></li>`).join('')||'<li>No sent issues recorded in this browser.</li>';
    preview();
  }
  async function load() {
    if(loading || isBusy())return;
    loading=true;syncControls();status('Checking what is live on the site…');
    try {
      const read=async path=>{const r=await fetch(path,{cache:'no-store',credentials:'omit'});if(!r.ok)throw Error('Could not load the live site. Your draft is safe; try Refresh again.');const d=await r.json();return d;};
      const [local,writings,projects,photography,initial,monthlyFeed]=await Promise.all(['/data/writings-local.json','/data/writings.json','/data/works-substack.json','/data/photography.json','/data/newsletter-baseline.json','/data/newsletter-monthly.json'].map(read));
      if(![local,writings,projects,photography].every(Array.isArray)||!Array.isArray(initial.keys)||monthlyFeed?.version!==1||!Array.isArray(monthlyFeed.issues))throw Error('The site content could not be read. Your draft is unchanged.');
      entries=N.inventory({local,writings,projects,photography});baseline=N.keys(initial.keys);
      feed=monthlyFeed;
      getState().newsletter=N.normalize(getState().newsletter);
      // Import automatically only when no personal draft exists. Never overwrite edits.
      state().draft=state().draft?N.liveDraft(state().draft,entries):monthly();
      loaded=true;
      await save();
      status('Live content loaded. Unpublished Studio drafts are never included.');
    } catch(error) {loaded=false;status(error.message);}
    finally {loading=false;render();}
  }
  function create(all=false) {
    if(isBusy()||!loaded)return;
    if(state().draft && !confirm('Replace the current email draft? Sent history and your other Studio drafts will be kept.'))return;
    const choices=all?entries:pending();
    state().draft=N.draft(choices,new Date(),!all);
    render();persist();status(all?'Choose a few published highlights for your first issue.':'New highlights added. Edit the introduction and summaries before sending.');
  }
  $('newsletter-new').onclick=()=>create();
  $('newsletter-auto').onclick=()=>{
    if(isBusy()||!loaded)return;
    const d=monthly();if(!d)return;
    if(state().draft && !confirm('Replace the current email draft with '+d.subject+'?'))return;
    state().draft=d;render();persist();status('Monthly draft loaded. Review it, then copy to Substack.');
  };
  $('newsletter-all').onclick=()=>create(true);
  $('newsletter-refresh').onclick=load;
  for(const key of ['subject','intro','closing'])$('newsletter-'+key).addEventListener('input',event=>{
    if(isBusy()||!state().draft)return;state().draft[key]=event.target.value;preview();persist();
  });
  $('newsletter-items').addEventListener('input',event=>{
    const control=event.target.closest('[data-newsletter-field]');if(!control||isBusy())return;
    const entry=state().draft?.items[Number(control.closest('[data-newsletter-item]').dataset.newsletterItem)];if(!entry)return;
    const key=control.dataset.newsletterField;if(!['selected','featured','title','summary'].includes(key))return;
    entry[key]=control.type==='checkbox'?control.checked:control.value;preview();persist();
  });
  async function copy(subject=false) {
    try {
      if(isBusy()||!loaded)return;
      const d=state().draft,result=N.render(d);
      if(!result.count || !d.subject.trim())throw Error('Choose at least one highlight and add a subject.');
      if(subject)await navigator.clipboard.writeText(d.subject);
      else if(window.ClipboardItem && navigator.clipboard?.write)await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([result.html],{type:'text/html'}),'text/plain':new Blob([result.text],{type:'text/plain'})})]);
      else await navigator.clipboard.writeText(result.text);
      status(subject?'Subject copied. Paste it into Substack’s title field.':'Email body copied. Paste into a new Substack post, review, then send there.');
    } catch(error) {status('Clipboard unavailable. Use Download email, or select and copy the preview.');}
  }
  $('newsletter-copy-subject').onclick=()=>copy(true);
  $('newsletter-copy').onclick=()=>copy(false);
  $('newsletter-download').onclick=()=>{
    const d=state().draft;if(isBusy()||!loaded||!d)return;
    const result=N.render(d);if(!result.count||!d.subject.trim())return;
    const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(d.subject)+'</title></head><body><h1>'+esc(d.subject)+'</h1>'+result.html+'</body></html>';
    const href=URL.createObjectURL(new Blob([html],{type:'text/html'})),a=document.createElement('a');a.href=href;a.download='james-kull-monthly-update.html';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
    status('Email downloaded. This is a draft; downloading does not send or record it.');
  };
  $('newsletter-record').onclick=async()=>{
    if(isBusy()||!loaded)return;
    try {
      const next=N.recordSent(state(),$('newsletter-sent-url').value.trim());
      if(!confirm('Confirm you have already sent this issue on Substack. Record these selected highlights as sent? This button does not send email.'))return;
      getState().newsletter=next;await save();$('newsletter-sent-url').value='';render();status('Issue recorded. These highlights will be excluded from the next digest.');
    } catch(error) {status(error.message);}
  };
  return {load,render,syncControls};
};
