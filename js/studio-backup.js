/* Authenticated encrypted backups; legacy plaintext imports remain supported. */
((root)=>{
  'use strict';
  const format='jameskull-encrypted-backup';
  async function encode(value,access) {
    const sealed=await access.seal(value), bytes=new Uint8Array(sealed.ciphertext);
    let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return {format,version:1,iv:Array.from(sealed.iv),ciphertext:btoa(binary)};
  }
  async function decode(value,access) {
    if(value?.format!==format)return value;
    if(value.version!==1 || !Array.isArray(value.iv) || value.iv.length!==12 || value.iv.some(v=>!Number.isInteger(v)||v<0||v>255) || typeof value.ciphertext!=='string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.ciphertext))throw Error('Invalid encrypted backup.');
    try {return await access.open({encrypted:1,iv:Uint8Array.from(value.iv),ciphertext:Uint8Array.from(atob(value.ciphertext),c=>c.charCodeAt(0))});}
    catch {throw Error('This backup cannot be decrypted with the current Studio password, or it is damaged.');}
  }
  root.StudioBackup={encode,decode};
  if(typeof module!=='undefined')module.exports=root.StudioBackup;
})(globalThis);
