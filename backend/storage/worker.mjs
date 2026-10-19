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
function equal(a,b) {if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function signingKey(env) {return crypto.subtle.importKey('raw',encoder.encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function session(env) {
  const payload=btoa(JSON.stringify({exp:Date.now()+12*60*60*1000,nonce:crypto.randomUUID()}));
  return payload+'.'+hex(await crypto.subtle.sign('HMAC',await signingKey(env),encoder.encode(payload)));
}
async function authorized(request,env) {
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  const [payload,signature,...extra]=token.split('.');
  if(extra.length || !payload || !/^[a-f0-9]{64}$/.test(signature||'')) return false;
  if(!await crypto.subtle.verify('HMAC',await signingKey(env),unhex(signature),encoder.encode(payload))) return false;
  try {const value=JSON.parse(atob(payload));return value.exp>Date.now() && value.exp<=Date.now()+12*60*60*1000;} catch {return false;}
}
async function readBody(request,max) {
  if(Number(request.headers.get('Content-Length'))>max) throw failure('Request too large.',413);
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const chunks=[];let total=0;
  while(true) {const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();throw failure('Request too large.',413);}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function jsonBody(request,max) {try {return JSON.parse(new TextDecoder().decode(await readBody(request,max)));} catch(error) {if(error.status)throw error;throw failure('Invalid request.');}}
function github(env,fetcher) {
  return async(path,method='GET',body)=>{
    const response=await fetcher(repo+path,{method,headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:path.startsWith('/contents/')?'application/vnd.github.raw+json':'application/vnd.github+json','User-Agent':'JamesKull-Studio','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:body===undefined?undefined:JSON.stringify(body)});
    if(!response.ok) throw failure(response.status===409||response.status===422?'The site changed while publishing. Reload published content after backing up your draft.':'GitHub publishing is unavailable. Your draft is safe.',response.status===409||response.status===422?409:502);
    return response.json();
  };
}
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
    await budget(env,{action:'read'});
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
      if(!env.STUDIO_AUTH_SHA256 || !env.SESSION_SECRET || !env.GITHUB_TOKEN || !env.PHOTOS || !env.LOGIN_LIMITER || !env.BUDGET) throw failure('Cloud storage setup is incomplete.',503);
      const path=new URL(request.url).pathname;
      if(path==='/session' && request.method==='POST') {
        const limit=await env.LOGIN_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});
        if(!limit.success) throw failure('Too many sign-in attempts. Wait a minute and try again.',429);
        const body=await jsonBody(request,1024);
        if(!/^[a-f0-9]{64}$/.test(body.credential||'') || !equal(await hash(body.credential),env.STUDIO_AUTH_SHA256)) throw failure('Studio could not authorize cloud storage.',401);
        return respond({token:await session(env)});
      }
      if(!await authorized(request,env)) throw failure('Sign in to Studio again.',401);
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
        const result=await globalThis.StudioCore.publish({data:body.data,baseline:body.baseline,images:{},api:github(env,fetcher)});
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
