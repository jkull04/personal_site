const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAccess}=require('../js/studio-access.js');
const storage=()=>{
  const values=new Map();
  return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
};
test('locked sessions cannot read or save drafts',async()=>{
  const access=createAccess(storage());
  assert.equal(await access.resume(),false);
  assert.throws(()=>access.requireUnlocked(),/Unlock/);
  await assert.rejects(()=>access.seal({private:'draft'}),/Unlock/);
  await assert.rejects(()=>access.open({version:1}),/Unlock/);
});
test('incorrect passwords and forged session values never unlock Studio',async()=>{
  const store=storage();
  const access=createAccess(store);
  assert.equal(await access.unlock('incorrect-test-password'),false);
  for(const value of ['true','1','00'.repeat(32)]) {
    store.setItem('jameskull-studio-session-v1',value);
    assert.equal(await access.resume(),false);
    assert.throws(()=>access.requireUnlocked(),/Unlock/);
  }
});
test('valid session encrypts drafts, survives refresh, and locks explicitly', {skip:!process.env.STUDIO_TEST_PASSWORD},async()=>{
  const store=storage(), access=createAccess(store);
  assert.equal(await access.unlock(process.env.STUDIO_TEST_PASSWORD),true);
  const draft={version:1,data:{books:[{title:'Private draft'}],photography:[]}};
  const sealed=await access.seal(draft);
  assert.equal(sealed.encrypted,1);
  assert.notDeepEqual(sealed,draft);
  assert.deepEqual(await access.open(sealed),draft);
  const refreshed=createAccess(store);
  assert.equal(await refreshed.resume(),true);
  assert.deepEqual(await refreshed.open(sealed),draft);
  const damaged=structuredClone(sealed);
  new Uint8Array(damaged.ciphertext)[0]^=1;
  await assert.rejects(()=>refreshed.open(damaged));
  refreshed.lock();
  await assert.rejects(()=>refreshed.open(sealed),/Unlock/);
  assert.equal(await createAccess(store).resume(),false);
  assert.equal(await createAccess(storage()).resume(),false);
});
