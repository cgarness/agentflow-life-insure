import {handle,PATH,TEST_ID,signedContent} from './handler.ts';
function assert(v: unknown){if(!v)throw new Error('assertion failed');}
Deno.test('signed alert boundary: valid, tampered, expired, scoped, bounded',async()=>{
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair;
 const pub=await crypto.subtle.exportKey('jwk',pair.publicKey);
 let invoked=0;
 const run=async()=>{invoked++;return {success:true};};
 const create=async(payload:unknown,time=String(Math.floor(Date.now()/1000)),path=PATH)=>{
  const body=JSON.stringify(payload),sig=await crypto.subtle.sign('Ed25519',pair.privateKey,signedContent(time,body));
  return new Request('https://example.test'+path,{method:'POST',body,headers:{'x-alert-time':time,'x-alert-signature':btoa(String.fromCharCode(...new Uint8Array(sig)))}});
 };
 const valid={id:TEST_ID,kind:'test',action:'send'};
 assert((await handle(await create(valid),run,pub as typeof import('./handler.ts').PUBLIC_KEY)).status===200);
 assert((await handle(await create(valid,undefined,'/clearpath-lead-alert'),run,pub as typeof import('./handler.ts').PUBLIC_KEY)).status===200);
 for(const req of [await create(valid,'1000000000'),await create(valid,undefined,PATH+'/evil'),await create({...valid,to:'+12025550100'}),await create({...valid,kind:'lead'}),await create({...valid,id:crypto.randomUUID()}),await create({...valid,action:'delete'}),await create({padding:'x'.repeat(600)})])assert((await handle(req,run,pub as typeof import('./handler.ts').PUBLIC_KEY)).status>=400);
 const tampered=await create(valid);tampered.headers.set('x-alert-signature',btoa('x'.repeat(64)));assert((await handle(tampered,run,pub as typeof import('./handler.ts').PUBLIC_KEY)).status===403);
 assert((await handle(new Request('https://example.test'+PATH,{method:'POST'}),run)).status===403);
 assert(invoked===2);
});
