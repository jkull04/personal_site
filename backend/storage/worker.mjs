import {github} from './github.mjs';
import '../../js/writing-data.js';
import '../../js/studio-core.js';
export {StorageBudget} from './quota.mjs';

const encoder=new TextEncoder();
const media='https://jameskull-studio-storage.fitzykull.workers.dev';
const repo='https://api.github.com/repos/jkull04/personal_site';
const keyPattern=/^photos\/[a-f0-9]{64}\.jpg$/;
const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/../g)||[],v=>parseInt(v,16));
const hash=async value=>hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?encoder.encode(value):value));
const failure=(message,status=400)=>Object.assign(Error(message),{status});
async function signingKey(env) {return crypto.subtle.importKey('raw',encoder.encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function credentialKey(env) {
  return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode('studio-session-credential-v2:'+env.SESSION_SECRET)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function session(env,githubToken) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await credentialKey(env),encoder.encode(githubToken));
  const credential={iv:hex(iv),data:hex(encrypted)};
  const exp=Date.now()+12*60*60*1000, sid=crypto.randomUUID();
  await budget(env,{action:'session-create',sessionId:sid,expires:exp,credential,authVersion:env.AUTH_VERSION||'2'});
  const payload=btoa(JSON.stringify({v:2,exp,sid}));
  return payload+'.'+hex(await crypto.subtle.sign('HMAC',await signingKey(env),encoder.encode(payload)));
}
async function authorized(request,env) {
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  const [payload,signature,...extra]=token.split('.');
  if(extra.length || !payload || !/^[a-f0-9]{64}$/.test(signature||'')) return false;
  if(!await crypto.subtle.verify('HMAC',await signingKey(env),unhex(signature),encoder.encode(payload))) return false;
  let value;try {value=JSON.parse(atob(payload));}catch{return false;}
  if(value.v!==2 || !Number.isSafeInteger(value.exp) || value.exp<=Date.now() || value.exp>Date.now()+12*60*60*1000 || !/^[a-f0-9-]{36}$/.test(value.sid||''))return false;
  const record=await budget(env,{action:'session-check',sessionId:value.sid,authVersion:env.AUTH_VERSION||'2'});
  try {value.githubToken=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(record.credential.iv)},await credentialKey(env),unhex(record.credential.data)));}catch{return false;}
  return value;
}
async function readBody(request,max) {
  if(Number(request.headers.get('Content-Length'))>max) throw failure('Request too large.',413);
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const chunks=[];let total=0;
  while(true) {const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();throw failure('Request too large.',413);}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function jsonBody(request,max) {try {return JSON.parse(new TextDecoder().decode(await readBody(request,max)));} catch(error) {if(error.status)throw error;throw failure('Invalid request.');}}
async function budget(env,body) {
  if(!env.BUDGET) throw failure('Storage budget unavailable. Requests are paused for safety.',503);
  const stub=env.BUDGET.get(env.BUDGET.idFromName('photos-v1'));
  const response=await stub.fetch(new Request('https://budget/',{method:'POST',body:JSON.stringify(body)}));
  const result=await response.json();if(!response.ok)throw failure(result.error,response.status);return result;
}
async function servePhoto(request,env,ctx) {
  const url=new URL(request.url),key=url.pathname.slice(1);
  if(!['GET','HEAD'].includes(request.method)||!keyPattern.test(key)||url.search)return new Response('Not found',{status:404});
  if(env.PAUSED==='true')return new Response('Photos temporarily paused',{status:503});
  const cache=globalThis.caches?.default;
  const cacheKey=new Request(url.origin+url.pathname);
  const cached=cache && await cache.match(cacheKey);
  if(cached)return request.method==='HEAD'?new Response(null,cached):cached;
  try {
    if(!env.READ_LIMITER)throw failure('Photo protection unavailable.',503);
    const limit=await env.READ_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});
    if(!limit.success)throw failure('Too many photo requests. Try again shortly.',429);
    await budget(env,{action:'read',key});
    const object=await env.PHOTOS.get(key);
    if(!object)return new Response('Not found',{status:404});
    const headers={'Content-Type':'image/jpeg','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'};
    if(object.httpEtag)headers.ETag=object.httpEtag;
    const response=new Response(object.body,{headers});
    if(cache && ctx?.waitUntil)ctx.waitUntil(cache.put(cacheKey,response.clone()));
    return request.method==='HEAD'?new Response(null,{headers}):response;
  } catch(error) {return new Response(error.message||'Photos temporarily unavailable',{status:error.status||503,headers:{'Cache-Control':'no-store'}});}
}
export function createHandler(fetcher=fetch) {
  return async(request,env,ctx)=>{
    const url=new URL(request.url);
    if(url.origin===media && url.pathname.startsWith('/photos/'))return servePhoto(request,env,ctx);
    const origin=request.headers.get('Origin');
    const allowed=(env.ALLOWED_ORIGINS||'').split(',').includes(origin);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
    if(allowed) headers['Access-Control-Allow-Origin']=origin;
    const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(!allowed) return respond({error:'Origin not allowed.'},403);
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600'}});
    try {
      if(env.PAUSED==='true')throw failure('Cloud storage is temporarily paused.',503);
      if(!env.SESSION_SECRET || !env.PHOTOS || !env.LOGIN_LIMITER || !env.BUDGET) throw failure('Cloud storage setup is incomplete.',503);
      const path=new URL(request.url).pathname;
      if(path==='/session' && request.method==='POST') {
        const limit=await env.LOGIN_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});
        if(!limit.success) throw failure('Too many sign-in attempts. Wait a minute and try again.',429);
        const body=await jsonBody(request,2048);
        if(typeof body.githubToken!=='string' || !/^(?:github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,})$/.test(body.githubToken))throw failure('Connect using a repository-scoped GitHub token.',401);
        const options={headers:{Authorization:'Bearer '+body.githubToken,Accept:'application/vnd.github+json','User-Agent':'JamesKull-Studio'},redirect:'error'};
        const identity=await fetcher('https://api.github.com/user',options);
        if(!identity.ok || (await identity.json()).login!=='jkull04')throw failure('Only the site owner can connect Studio.',401);
        const access=await fetcher(repo,options);
        if(!access.ok || !(await access.json()).permissions?.push)throw failure('The token must have write access to personal_site.',403);
        return respond({token:await session(env,body.githubToken)});
      }
      const identity=await authorized(request,env);
      if(!identity) throw failure('Connect GitHub to Studio again.',401);
      if(path==='/logout' && request.method==='POST'){await budget(env,{action:'session-revoke',sessionId:identity.sid});return respond({revoked:true});}
      if(path==='/photos' && request.method==='POST') {
        if(request.headers.get('Content-Type')!=='image/jpeg') throw failure('Only optimized JPEG photos are supported.');
        const bytes=await readBody(request,12*1024*1024);
        if(bytes.length<4 || bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255 || bytes.at(-2)!==255 || bytes.at(-1)!==217) throw failure('Invalid JPEG image.');
        const key='photos/'+await hash(bytes)+'.jpg';
        // Content-addressed keys make retries idempotent and never replace another image.
        const reservation=await budget(env,{action:'reserve',key,size:bytes.length});
        if(reservation.upload) {
          await env.PHOTOS.put(key,bytes,{httpMetadata:{contentType:'image/jpeg',cacheControl:'public, max-age=31536000, immutable'}});
          await budget(env,{action:'complete',key});
        }
        return respond({url:media+'/'+key});
      }
      if(path==='/publish' && request.method==='POST') {
        const body=await jsonBody(request,16*1024*1024);
        if(!body.data || !body.baseline) throw failure('Collections and baseline are required.');
        globalThis.StudioCore.validate(body.data,true);
        globalThis.StudioCore.validate(body.baseline);
        // Verify new remote references exist before exposing them in the site's metadata.
        const previous=new Set(body.baseline.photography.flatMap(p=>[p.src,p.thumb]));
        const needed=new Set(body.data.photography.filter(p=>p.published!==false).flatMap(p=>[p.src,p.thumb]));
        const fresh=[...needed].filter(url=>url.startsWith(media+'/')&&!previous.has(url));
        if(fresh.length>900) throw failure('Publish at most 450 new photos in one batch.');
        if(fresh.length)await budget(env,{action:'known',keys:fresh.map(url=>url.slice(media.length+1))});
        const result=await globalThis.StudioCore.publish({data:body.data,baseline:body.baseline,images:{},api:github({...env,GITHUB_TOKEN:identity.githubToken},fetcher)});
        return respond(result);
      }
      if(path==='/usage' && request.method==='GET') {
        return respond(await budget(env,{action:'usage'}));
      }
      return respond({error:'Not found.'},404);
    } catch(error) {return respond({error:error.status?error.message:(error.message||'Request failed.')},error.status||400);}
  };
}
export default {fetch:createHandler()};

