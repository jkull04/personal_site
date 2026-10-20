const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const backup=require('../js/studio-backup.js');

async function access() {
  const key=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  return {
    async seal(value){const iv=webcrypto.getRandomValues(new Uint8Array(12));return {encrypted:1,iv,ciphertext:await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)))};},
    async open(value){return JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:value.iv},key,value.ciphertext)));}
  };
}
test('encrypted backup round trips private text and photos without plaintext leakage',async()=>{
  const a=await access(),state={version:1,data:{writings:[{body:'private unpublished writing'}]},images:{'photo.jpg':'confidential-image-payload'}};
  const envelope=await backup.encode(state,a), serialized=JSON.stringify(envelope);
  assert.ok(!serialized.includes('private unpublished writing'));
  assert.ok(!serialized.includes('confidential-image-payload'));
  assert.deepEqual(await backup.decode(JSON.parse(serialized),a),state);
  const second=await backup.encode(state,a);assert.notDeepEqual(second.iv,envelope.iv);
});
test('encrypted backup rejects wrong keys, corruption, and malformed envelopes',async()=>{
  const a=await access(),other=await access(),encoded=await backup.encode({secret:'draft'},a);
  await assert.rejects(()=>backup.decode(encoded,other),/cannot be decrypted/);
  const corrupt={...encoded,ciphertext:(encoded.ciphertext[0]==='A'?'B':'A')+encoded.ciphertext.slice(1)};
  await assert.rejects(()=>backup.decode(corrupt,a),/cannot be decrypted/);
  await assert.rejects(()=>backup.decode({...encoded,iv:[1]},a),/Invalid/);
});
test('legacy backup imports remain readable and do not mutate the original',async()=>{
  const old={version:1,data:{books:[],photography:[]},baseline:{books:[],photography:[]},images:{}};
  assert.deepEqual(await backup.decode(old,{open(){throw Error('Must not decrypt legacy JSON');}}),old);
});
test('Studio never opens draft storage or resumes credentials in a frame',()=>{
  const context={window:{top:{},self:{}},document:{getElementById(){throw Error('Framed editor must stay inert');}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/studio-access.js'),'utf8'),context);
  assert.equal(context.window.StudioAccess,undefined);
  assert.match(fs.readFileSync(require.resolve('../studio/index.html'),'utf8'),/id="studio-gate" hidden/);
});
