/* Browser privacy gate. GitHub authorization remains the live-write boundary. */
(() => {
  'use strict';
  const SESSION = 'jameskull-studio-session-v1';
  const SALT = '601cb088adc81b2f8a946e07b8d74399';
  const VERIFIER = '22ad1206e7d460ce6314fda9dcd3bce651b1239a613077c9e9af5a3349eea5ec';
  const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
  const bytes = value => {
    if(typeof value !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(value)) throw Error('Invalid session');
    return Uint8Array.from(value.match(/../g), b => parseInt(b,16));
  };
  function createAccess(storage) {
    let key;
    const requireUnlocked = () => { if(!key) throw Error('Unlock Studio first.'); };
    async function accept(raw) {
      if(raw.byteLength !== 32 || hex(await crypto.subtle.digest('SHA-256',raw)) !== VERIFIER) return false;
      key = await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
      return true;
    }
    return {
      requireUnlocked,
      async unlock(password) {
        const material = await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
        const raw = await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(SALT),iterations:600000,hash:'SHA-256'},material,256);
        if(!await accept(raw)) return false;
        try { storage.setItem(SESSION,hex(raw)); } catch { /* Memory-only if session storage is blocked. */ }
        return true;
      },
      async resume() {
        try { const raw=storage.getItem(SESSION); if(raw && await accept(bytes(raw))) return true; } catch {}
        try { storage.removeItem(SESSION); } catch {}
        return false;
      },
      lock() { key=undefined; try { storage.removeItem(SESSION); } catch {} },
      async seal(value) {
        requireUnlocked();
        const iv=crypto.getRandomValues(new Uint8Array(12));
        const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));
        return {encrypted:1,iv,ciphertext};
      },
      async open(value) {
        requireUnlocked();
        if(!value || value.encrypted!==1) return value; // Migrate existing drafts after unlock.
        const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:value.iv},key,value.ciphertext);
        return JSON.parse(new TextDecoder().decode(plain));
      }
    };
  }
  if(typeof module !== 'undefined' && module.exports) { module.exports={createAccess}; return; }
  // Fail closed in frames, including sandboxed frames and sessions already unlocked elsewhere.
  if(window.top !== window.self) return;
  document.getElementById('studio-gate').hidden=false;
  const access=createAccess({getItem:k=>sessionStorage.getItem(k),setItem:(k,v)=>sessionStorage.setItem(k,v),removeItem:k=>sessionStorage.removeItem(k)});
  const ready=new Promise(resolve=>{
    const form=document.getElementById('studio-login');
    const input=document.getElementById('studio-password');
    const message=document.getElementById('login-status');
    const showEditor=()=>{
      input.value=''; document.getElementById('studio-gate').hidden=true;
      const editor=document.getElementById('studio-editor'); editor.hidden=false; editor.inert=false;
      resolve();
    };
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const button=form.querySelector('button'); button.disabled=true; message.textContent='Unlocking…';
      try {
        if(await access.unlock(input.value)) { showEditor(); return; }
        message.textContent='Incorrect password. Try again.';
      } catch { message.textContent='Studio requires a secure connection and a browser with Web Crypto support.'; }
      finally { button.disabled=false; input.value=''; }
      input.focus();
    });
    access.resume().then(ok=>{ if(ok) showEditor(); else input.focus(); });
  });
  window.StudioAccess=Object.freeze({...access,ready});
  window.addEventListener('pageshow',event=>{ if(event.persisted) location.reload(); });
})();

