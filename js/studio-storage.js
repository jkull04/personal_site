/* Optional R2 service. Disabled configurations retain the existing GitHub workflow. */
(() => {
  'use strict';
  let config, token;
  const sessionKey = 'jameskull-storage-session-v1';
  const ready = fetch('/data/studio-storage.json', {cache:'no-store'})
    .then(r => { if (!r.ok) throw Error('Cannot load photo storage settings. Reload Studio before publishing.'); return r.json(); })
    .then(value => {
      if (value.apiOrigin !== 'https://jameskull-studio-storage.fitzykull.workers.dev' || value.mediaOrigin !== 'https://jameskull-studio-storage.fitzykull.workers.dev') throw Error('Invalid photo storage settings.');
      config=value;
      try { token=sessionStorage.getItem(sessionKey); } catch {}
      return config;
    });
  async function request(path, options={}, retry=true) {
    await ready;
    if (!config.enabled) throw Error('Cloud photo storage is not connected yet.');
    if (!token) await login();
    const response=await fetch(config.apiOrigin+path,{...options,headers:{...options.headers,Authorization:'Bearer '+token},credentials:'omit',cache:'no-store'});
    if (response.status===401 && retry) { clear(); return request(path,options,false); }
    const result=await response.json();
    if (!response.ok) throw Error(result.error || 'Photo storage request failed. Your browser draft is safe.');
    return result;
  }
  async function login() {
    const credential=await StudioAccess.serviceCredential();
    const response=await fetch(config.apiOrigin+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential}),credentials:'omit',cache:'no-store'});
    const result=await response.json();
    if(!response.ok) throw Error(result.error || 'Storage sign-in failed.');
    token=result.token;
    try {sessionStorage.setItem(sessionKey,token);} catch {}
  }
  function clear() {token=null;try {sessionStorage.removeItem(sessionKey);} catch {}}
  async function upload(blob) {
    return (await request('/photos',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob})).url;
  }
  async function publish({data,baseline,images,migrate=false,progress=()=>{}}) {
    StudioCore.validate(data,true);
    // Never send private drafts or unrelated pending images to the service.
    const publicData=Object.fromEntries(Object.entries(data).map(([kind,entries])=>[kind,entries.filter(e=>e.published!==false).map(e=>({...e}))]));
    const uploaded=new Map();
    for(const [i,photo] of publicData.photography.entries()) {
      for(const field of ['src','thumb']) {
        const path=photo[field];
        if(uploaded.has(path)) {photo[field]=uploaded.get(path);continue;}
        const pending=images[path.slice(1)];
        if(!pending && !(migrate && path.startsWith('/assets/photography/'))) continue;
        progress(`Uploading photo ${i+1} of ${publicData.photography.length}…`);
        let blob;
        if(pending) blob=new Blob([Uint8Array.from(atob(pending),c=>c.charCodeAt(0))],{type:'image/jpeg'});
        else {
          const response=await fetch(path,{cache:'no-store'});
          if(!response.ok) throw Error('Cannot read an existing photo. Migration stopped; the current site is unchanged.');
          blob=await response.blob();
        }
        const url=await upload(blob);uploaded.set(path,url);photo[field]=url;
      }
    }
    progress('Publishing your collections…');
    return request('/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:publicData,baseline})});
  }
  const usage=()=>request('/usage');
  // Install a rejection handler immediately; callers still receive configuration errors.
  ready.catch(()=>{});
  window.StudioStorage={ready,get enabled(){return Boolean(config?.enabled);},publish,clear,usage};
})();
