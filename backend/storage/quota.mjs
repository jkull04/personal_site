// One durable instance owns the budget. Transactions prevent simultaneous uploads
// from racing past the ceiling. Failed uploads retain their reservation (fail safe).
export const LIMITS=Object.freeze({bytes:8000000000,warningBytes:6000000000,objects:40000,writesPerDay:1000,readsPerDay:20000});
export class StorageBudget {
  constructor(state) {this.storage=state.storage;}
  async alarm() {
    let after;
    do {
      const entries=await this.storage.list({prefix:'session:',limit:1000,...(after?{startAfter:after}:{})});
      for(const [key,value] of entries)if(value.expires<=Date.now())await this.storage.delete(key);
      after=entries.size===1000?[...entries.keys()].at(-1):undefined;
    } while(after);
    await this.storage.setAlarm(Date.now()+60*60*1000);
  }
  async fetch(request) {
    try {
      const {action,key,size,keys,sessionId,expires,authVersion,credential}=await request.json();
      const day=new Date().toISOString().slice(0,10);
      const result=await this.storage.transaction(async tx=>{
        if(action.startsWith('session-')) {
          if(!/^[a-f0-9-]{36}$/.test(sessionId||''))return {error:'Invalid session.',status:401};
          const name='session:'+sessionId, current=await tx.get(name);
          if(action==='session-create') {
            if(!Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+12*60*60*1000)return {error:'Invalid session expiry.',status:400};
            await tx.put(name,{expires,authVersion,credential});return {allowed:true};
          }
          if(action==='session-revoke'){await tx.delete(name);return {allowed:true};}
          if(action==='session-check' && current?.expires>Date.now() && current.authVersion===authVersion)return {allowed:true,credential:current.credential};
          if(current)await tx.delete(name);
          return {error:'Session expired or revoked. Connect GitHub again.',status:401};
        }
        const total=await tx.get('total')||{bytes:0,objects:0};
        const stored=await tx.get('daily');
        const daily=stored?.day===day?stored:{day,reads:0,writes:0};
        const snapshot=()=>({bytes:total.bytes,objects:total.objects,daily,limits:LIMITS});
        if(action==='usage')return snapshot();
        if(action==='read') {
          if(!/^photos\/[a-f0-9]{64}\.jpg$/.test(key||'') || !(await tx.get('object:'+key))?.complete)return {error:'Not found',status:404};
          if(daily.reads>=LIMITS.readsPerDay)return {error:'Daily photo request limit reached. Please try again tomorrow.',status:429};
          daily.reads++;await tx.put('daily',daily);return {allowed:true};
        }
        if(action==='known') {
          if(!Array.isArray(keys)||keys.length>900)return {error:'Too many photo references.',status:400};
          for(const key of keys)if(!(await tx.get('object:'+key))?.complete)return {error:'An image upload is incomplete. Retry publishing.',status:400};
          return {allowed:true};
        }
        if(!/^photos\/[a-f0-9]{64}\.jpg$/.test(key||''))return {error:'Invalid image key.',status:400};
        const entry=await tx.get('object:'+key);
        if(action==='complete') {
          if(!entry)return {error:'Missing upload reservation.',status:409};
          await tx.put('object:'+key,{...entry,complete:true});return {allowed:true};
        }
        if(action!=='reserve'||!Number.isSafeInteger(size)||size<4||size>12*1024*1024)return {error:'Invalid upload.',status:400};
        if(entry?.complete)return {upload:false};
        if(entry && entry.size!==size)return {error:'Upload size does not match reservation.',status:409};
        if(daily.writes>=LIMITS.writesPerDay)return {error:'Daily upload limit reached. Your draft is safe; try tomorrow.',status:429};
        if(!entry && (total.bytes+size>LIMITS.bytes || total.objects>=LIMITS.objects))return {error:'Photo storage safety limit reached. No more images will be uploaded until storage is reviewed.',status:413};
        if(!entry){total.bytes+=size;total.objects++;await tx.put('total',total);await tx.put('object:'+key,{size,complete:false});}
        daily.writes++;await tx.put('daily',daily);return {upload:true};
      });
      if(action==='session-create' && this.storage.setAlarm && !await this.storage.getAlarm())await this.storage.setAlarm(Date.now()+60*60*1000);
      return Response.json(result,{status:result.status||200});
    } catch {return Response.json({error:'Storage budget unavailable. Requests are paused for safety.'},{status:503});}
  }
}

