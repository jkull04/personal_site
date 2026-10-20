/* Optional R2 service. Disabled configurations retain the existing GitHub workflow. */
(() => {
  'use strict';
  if(window.top !== window.self) return;
  let config, token;
  const uploadedImages=new Map();
  const sessionKey = 'jameskull-storage-session-v2';
  const ready = fetch('/data/studio-storage.json', {cache:'no-store'})
    .then(r => { if (!r.ok) throw Error('Cannot load photo storage settings. Reload Studio before publishing.'); return r.json(); })
    .then(value => {
      if (value.apiOrigin !== 'https://jameskull-studio-storage.fitzykull.workers.dev' || value.mediaOrigin !== 'https://jameskull-studio-storage.fitzykull.workers.dev') throw Error('Invalid photo storage settings.');
      config=value;
      try { token=sessionStorage.getItem(sessionKey); } catch {}
      return config;
    });
  async function networkFetch(url,options,label) {
    try {return await fetch(url,options);}
    catch {throw Error(label+' could not connect. Your draft and uploaded photos are safe. Check your connection and click Publish updates again; do not reload published content.');}
  }
  async function request(path, options={}, retry=true) {
    await ready;
    if (!config.enabled) throw Error('Cloud photo storage is not connected yet.');
    if (!token) throw Error('Connect GitHub to authorize publishing. Your local draft is safe.');
    const response=await networkFetch(config.apiOrigin+path,{...options,headers:{...options.headers,Authorization:'Bearer '+token},credentials:'omit',cache:'no-store'},path==='/publish'?'Publishing':path==='/photos'?'Photo upload':'Cloud storage');
    if (response.status===401) { clear(); throw Error('Your publishing session expired. Connect GitHub again; your draft is safe.'); }
    let result;try {result=await response.json();}catch {throw Error('Cloud storage returned an incomplete response. Your draft and photos are safe. Retry publishing.');}
    if (!response.ok) throw Error(result.error || 'Photo storage request failed. Your browser draft is safe.');
    return result;
  }
  async function connect(githubToken) {
    await ready;
    if(!config.enabled) throw Error('Cloud publishing is not enabled.');
    const response=await networkFetch(config.apiOrigin+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({githubToken}),credentials:'omit',cache:'no-store'},'Cloud storage sign-in');
    let result;try {result=await response.json();}catch {throw Error('Cloud storage returned an incomplete response. Your draft and photos are safe. Retry publishing.');}
    if(!response.ok) throw Error(result.error || 'Storage sign-in failed.');
    token=result.token;
    try {sessionStorage.setItem(sessionKey,token);} catch {}
  }
  function clear() {token=null;try {sessionStorage.removeItem(sessionKey);} catch {}}
  async function logout() {
    await ready;
    if(!token){clear();return;}
    const response=await networkFetch(config.apiOrigin+'/logout',{method:'POST',headers:{Authorization:'Bearer '+token},credentials:'omit',cache:'no-store'},'Session revocation');
    if(!response.ok && response.status!==401)throw Error('Could not revoke publishing access. Please retry Disconnect or Lock Studio.');
    clear();
  }
  async function upload(blob) {
    return (await request('/photos',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob})).url;
  }
  async function publish({data,baseline,images,migrate=false,progress=()=>{},onPhoto=()=>{}}) {
    StudioCore.validate(data,true);
    // Never send private drafts or unrelated pending images to the service.
    const publicData=Object.fromEntries(Object.entries(StudioCore.publicData(data)).map(([kind,entries])=>[kind,entries.map(e=>({...e}))]));
    const uploaded=new Map();
    const media=[...publicData.photography.map(entry=>({entry,fields:['src','thumb']})),...publicData.books.filter(b=>b.coverSrc).map(entry=>({entry,fields:['coverSrc']})),...(publicData.showcase||[]).filter(s=>s.imageSrc?.startsWith('/assets/photography/')||s.imageSrc?.startsWith('https://')).map(entry=>({entry,fields:['imageSrc']}))];
    for(const [i,{entry:photo,fields}] of media.entries()) {
      const isPhoto=fields.includes('src');
      let touched=false;
      try {
      for(const field of fields) {
        const path=photo[field];
        if(uploaded.has(path)) {photo[field]=uploaded.get(path);continue;}
        const pending=images[path.slice(1)];
        const cached=uploadedImages.get(path);
        if(pending && cached?.content===pending){photo[field]=cached.url;touched=true;continue;}
        if(!pending && !(migrate && path.startsWith('/assets/photography/'))) continue;
        touched=true;if(isPhoto)onPhoto({id:photo.id,phase:'uploading'});
        progress(`Uploading image ${i+1} of ${media.length}…`);
        let blob;
        if(pending) blob=new Blob([Uint8Array.from(atob(pending),c=>c.charCodeAt(0))],{type:'image/jpeg'});
        else {
          const response=await fetch(path,{cache:'no-store'});
          if(!response.ok) throw Error('Cannot read an existing photo. Migration stopped; the current site is unchanged.');
          blob=await response.blob();
        }
        const url=await upload(blob);uploaded.set(path,url);photo[field]=url;
        if(pending)uploadedImages.set(path,{content:pending,url});
      }
      if(isPhoto && touched)onPhoto({id:photo.id,phase:'uploaded'});
      } catch(error) {if(isPhoto)onPhoto({id:photo.id,phase:'failed',error:error.message});throw error;}
    }
    publicData.photography.forEach(photo=>onPhoto({id:photo.id,phase:'publishing'}));
    progress('Publishing your collections…');
    const result=await request('/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:publicData,baseline})});
    uploadedImages.clear();return result;
  }
  const usage=()=>request('/usage');
  // Install a rejection handler immediately; callers still receive configuration errors.
  ready.catch(()=>{});
  window.StudioStorage={ready,get enabled(){return Boolean(config?.enabled);},publish,connect,logout,clear,usage,get connected(){return Boolean(token);}};
})();

