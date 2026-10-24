import {test} from 'node:test';
import assert from 'node:assert/strict';
import {github} from '../backend/storage/github.mjs';
test('failed, missing and untrusted checks never authorize a main update',async()=>{
  for(const check of [null,{name:'Security checks',head_sha:'proposed',status:'completed',conclusion:'failure',app:{slug:'github-actions'}},{name:'Security checks',head_sha:'proposed',status:'completed',conclusion:'success',app:{slug:'untrusted'}}]){
    const api=github({GITHUB_TOKEN:'test'},async()=>Response.json({check_runs:check?[check]:[]}),async()=>{});
    await assert.rejects(()=>api.checkCommit('proposed'),/Security checks/);
  }
});
test('the precise commit requires a passing GitHub Actions security check',async()=>{
  const api=github({GITHUB_TOKEN:'test'},async()=>Response.json({check_runs:[{name:'Security checks',head_sha:'proposed',status:'completed',conclusion:'success',app:{slug:'github-actions'}}]}),async()=>{});
  await api.checkCommit('proposed');
  await assert.rejects(()=>api.checkCommit('different'),/still running/);
});
test('a retry reuses the verified proposed tree and parent instead of restarting CI',async()=>{
  const calls=[];
  const api=github({GITHUB_TOKEN:'test'},async(url,options)=>{
    calls.push({url,options});
    if(url.includes('/git/ref/heads/'))return Response.json({object:{sha:'pending'}});
    if(url.endsWith('/git/commits/pending'))return Response.json({tree:{sha:'tree'},parents:[{sha:'head'}]});
    throw Error('Unexpected mutation');
  });
  assert.deepEqual(await api('/git/commits','POST',{tree:'tree',parents:['head']}),{sha:'pending'});
  assert.ok(calls.every(c=>c.options.method==='GET'));
});
test('GitHub API and check requests use edge-compatible manual redirects',async()=>{
 const calls=[];
 const api=github({GITHUB_TOKEN:'test'},async(url,options)=>{
  assert.equal(options.redirect,'manual');calls.push(url);
  return Response.json(url.endsWith('/check-runs')?{check_runs:[{name:'Security checks',head_sha:'proposed',status:'completed',conclusion:'success',app:{slug:'github-actions'}}]}:{object:{sha:'head'}});
 });
 await api('/git/ref/heads/main');await api.checkCommit('proposed');assert.equal(calls.length,2);
});
test('redirect responses stop publication and checks without following the Location',async()=>{
 for(const status of [301,302,303,307,308]) {
  let requests=0;
  const api=github({GITHUB_TOKEN:'test'},async(url,options)=>{
   requests++;assert.equal(options.redirect,'manual');
   return new Response(null,{status,headers:{Location:'https://unexpected.example/token-trap'}});
  },async()=>{});
  await assert.rejects(()=>api('/git/ref/heads/main'),/redirect/);
  await assert.rejects(()=>api.checkCommit('proposed'),/redirect/);
  assert.equal(requests,2);
 }
});
