import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../../supabase/functions/meta-connect/handler.mjs';
import { listMetaForms } from '../../supabase/functions/meta-connect/forms.mjs';
const request = page_id => new Request('https://example.test/',{method:'POST',headers:{origin:'https://siimob.com','x-session-token':'session','content-type':'application/json'},body:JSON.stringify({action:'forms',page_id})});
test('only the selected page of the authenticated tenant can list forms',async()=>{
 let calls=0;
 const handler=createHandler({context:async()=>({tenant_id:'tenant-a',user_id:'user-a',slug:'a'}),getConnection:async()=>({access_token:'private'}),getSelectedPages:async tenant=>{assert.equal(tenant,'tenant-a');return [{page_id:'11'}]},listPages:async()=>[{id:'11',name:'A'}],listForms:async()=>{calls++;return [{id:'22',name:'Form'}]},getSelectedForms:async()=>[]});
 assert.equal((await handler(request('12'))).status,403);assert.equal(calls,0);
 const res=await handler(request('11'));assert.equal(res.status,200);assert.deepEqual(await res.json(),{forms:[{id:'22',name:'Form',selected:false}],unavailable:0});
});
test('uses a page token server-side and returns only form data',async()=>{
 const requests=[];
 const forms=await listMetaForms('user-secret','11',async(url,opts)=>{requests.push({url:String(url),auth:opts.headers.Authorization});return Response.json(requests.length===1?{access_token:'page-secret'}:{data:[{id:'22',name:'Form',status:'ACTIVE',access_token:'not-returned'}]})});
 assert.deepEqual(forms,[{id:'22',name:'Form',status:'ACTIVE'}]);
 assert.equal(requests[0].auth,'Bearer user-secret');assert.equal(requests[1].auth,'Bearer page-secret');assert.ok(requests.every(r=>!r.url.includes('secret')));
});
test('reports Meta permission errors without leaking the response',async()=>{
 await assert.rejects(listMetaForms('token','11',async()=>Response.json({error:{code:200,message:'sensitive'}},{status:403})),e=>e.code==='forms_permission'&&!e.message.includes('sensitive'));
});

test('form selection is revalidated and scoped to the authenticated tenant and page',async()=>{
 let saved;
 const handler=createHandler({context:async()=>({tenant_id:'tenant-a',user_id:'user-a',slug:'a'}),getConnection:async()=>({access_token:'private',connected_at:'v1'}),getSelectedPages:async()=>[{page_id:'11'}],listPages:async()=>[{id:'11',name:'Page'}],listForms:async()=>[{id:'22',name:'Form'}],replaceForms:async (tenant,version,page,forms)=>{saved={tenant,version,page,forms};return 'ok'}});
 const send = form_ids=>new Request('https://example.test/',{method:'POST',headers:{origin:'https://siimob.com','x-session-token':'session','content-type':'application/json'},body:JSON.stringify({action:'save_forms',tenant_id:'other',page_id:'11',form_ids})});
 assert.equal((await handler(send(['33']))).status,403);assert.equal(saved,undefined);
 assert.equal((await handler(send(['22','22']))).status,400);assert.equal(saved,undefined);
 assert.equal((await handler(send(['22']))).status,200);assert.deepEqual(saved,{tenant:'tenant-a',version:'v1',page:'11',forms:[{id:'22',name:'Form'}]});
});
