const root='https://api.github.com/repos/jkull04/personal_site';
const failure=(message,status=502)=>Object.assign(Error(message),{status});

// Proposed content is tested on an isolated branch before main moves. Retry the
// same tree/parent on the same branch, so a slow CI run does not restart forever.
export function github(env,fetcher,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  let stagedBranch;
  async function call(path,method='GET',body,optional=false) {
    const response=await fetcher(root+path,{method,headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:path.startsWith('/contents/')?'application/vnd.github.raw+json':'application/vnd.github+json','User-Agent':'JamesKull-Studio','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
    if(response.status>=300 && response.status<400)throw failure('GitHub returned an unexpected redirect. Your draft is safe; retry publishing later.');
    if(optional && response.status===404)return null;
    if(!response.ok)throw failure(response.status===409||response.status===422?'The site changed while publishing. Your draft is safe; retry publishing.':'GitHub publishing is unavailable. Your draft is safe.',response.status===409||response.status===422?409:502);
    return response.status===204?null:response.json();
  }
  const api=async(path,method='GET',body)=>{
    if(env.REQUIRE_CHECKS!=='false' && path==='/git/commits' && method==='POST') {
      stagedBranch='studio-check/'+body.parents[0]+'-'+body.tree;
      const existing=await call('/git/ref/heads/'+stagedBranch,'GET',undefined,true);
      if(existing) {
        const commit=await call('/git/commits/'+existing.object.sha);
        if(commit.tree.sha!==body.tree || commit.parents?.length!==1 || commit.parents[0].sha!==body.parents[0])throw failure('The pending publication changed unexpectedly. Your draft is safe.',409);
        return {sha:existing.object.sha};
      }
      const commit=await call(path,method,body);
      await call('/git/refs','POST',{ref:'refs/heads/'+stagedBranch,sha:commit.sha});
      return commit;
    }
    const result=await call(path,method,body);
    if(stagedBranch && path==='/git/refs/heads/main' && method==='PATCH') {
      // A leftover test branch is harmless; never report a successful publish as failed.
      try {await call('/git/refs/heads/'+stagedBranch,'DELETE');}catch{}
    }
    return result;
  };
  if(env.REQUIRE_CHECKS!=='false')api.checkCommit=async sha=>{
    for(let attempt=0;attempt<22;attempt++) {
      // Checks on this public repository are readable without exposing the write token.
      const response=await fetcher(root+'/commits/'+sha+'/check-runs',{headers:{Accept:'application/vnd.github+json','User-Agent':'JamesKull-Studio'},redirect:'manual'});
      if(response.status>=300 && response.status<400)throw failure('GitHub redirected publication checks. Nothing was published; your draft is safe.');
      if(!response.ok)throw failure('Could not verify publication checks. Your draft is safe. Retry shortly.');
      const checks=(await response.json()).check_runs||[];
      const check=checks.find(c=>c.name==='Security checks' && c.app?.slug==='github-actions' && c.head_sha===sha);
      if(check?.status==='completed') {
        if(check.conclusion==='success')return;
        throw failure('Security checks did not pass. Nothing was published; your draft is safe.',409);
      }
      await wait(5000);
    }
    throw failure('Security checks are still running. Your draft and uploads are safe. Wait a minute, then publish again.',409);
  };
  return api;
}
