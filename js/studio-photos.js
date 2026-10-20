((root)=>{
  'use strict';
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const fromBase64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  async function duplicateIndex(photos,images,fingerprints={}) {
    const index=new Map();
    for(const photo of photos) {
      const source=fingerprints[photo.id];
      if(/^[a-f0-9]{64}$/.test(source || ''))index.set('source:'+source,photo);
      const remote=photo.src?.match(/^https:\/\/jameskull-studio-storage\.fitzykull\.workers\.dev\/photos\/([a-f0-9]{64})\.jpg$/);
      if(remote)index.set('image:'+remote[1],photo);
      const pending=images[photo.src?.slice(1)];
      if(pending)index.set('image:'+await digest(fromBase64(pending)),photo);
    }
    return index;
  }
  function baseStatus(photo,photos,baseline) {
    const saved=baseline.find(p=>p.id===photo.id);
    if(photo.published===false)return saved?{phase:'pending',label:'Removal pending'}:{phase:'private',label:'Private draft'};
    if(!saved)return {phase:'pending',label:'Ready to publish'};
    const order=photos.filter(p=>p.published!==false).findIndex(p=>p.id===photo.id);
    return JSON.stringify(photo)===JSON.stringify(saved) && order===baseline.findIndex(p=>p.id===photo.id)
      ? {phase:'published',label:'Published'} : {phase:'pending',label:'Changes to publish'};
  }
  function status(photo,photos,baseline,transfers={}) {
    const base=baseStatus(photo,photos,baseline), transfer=transfers[photo.id];
    if(!transfer || transfer.signature!==JSON.stringify(photo) || photo.published===false)return base;
    const labels={queued:'Waiting to upload',uploading:'Uploading…',uploaded:'Uploaded · awaiting publish',publishing:'Publishing…',failed:'Failed · retry publish',waiting:'Waiting for retry',deploying:'Saved · deployment pending'};
    return labels[transfer.phase]?{...transfer,label:labels[transfer.phase]}:base;
  }
  function isLive(photo,data,live) {
    const included=data.filter(p=>p.published!==false), index=included.findIndex(p=>p.id===photo.id);
    return index>=0 && JSON.stringify(live[index])===JSON.stringify(photo);
  }
  root.StudioPhotos={digest,fromBase64,duplicateIndex,baseStatus,status,isLive};
  if(typeof module!=='undefined')module.exports=root.StudioPhotos;
})(globalThis);
