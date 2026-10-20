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
