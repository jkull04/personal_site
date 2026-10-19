// One durable instance owns the budget. Transactions prevent simultaneous uploads
// from racing past the ceiling. Failed uploads retain their reservation (fail safe).
export const LIMITS=Object.freeze({bytes:8000000000,warningBytes:6000000000,objects:40000,writesPerDay:1000,readsPerDay:20000});
export class StorageBudget {
  constructor(state) {this.storage=state.storage;}
  async fetch(request) {
    try {
      const {action,key,size,keys}=await request.json();
      const day=new Date().toISOString().slice(0,10);
      const result=await this.storage.transaction(async tx=>{
        const total=await tx.get('total')||{bytes:0,objects:0};
        const stored=await tx.get('daily');
        const daily=stored?.day===day?stored:{day,reads:0,writes:0};
        const snapshot=()=>({bytes:total.bytes,objects:total.objects,daily,limits:LIMITS});
        if(action==='usage')return snapshot();
        if(action==='read') {
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
      return Response.json(result,{status:result.status||200});
    } catch {return Response.json({error:'Storage budget unavailable. Requests are paused for safety.'},{status:503});}
  }
}
