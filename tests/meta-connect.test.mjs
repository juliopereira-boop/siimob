import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler, redirectUri} from '../supabase/functions/meta-connect/handler.mjs';
const origin='https://siimob.com', scopes=['leads_retrieval','pages_show_list','pages_manage_metadata'];
const request = (action, extra={}, session='session-a', src=origin) => new Request('https://api.example/',{method:'POST',headers:{origin:src,'x-session-token':session,'content-type':'application/json'},body:JSON.stringify({action,...extra})});
function setup() {
 let states=[], connections=[];
 const handler=createHandler({context:async s=>s==='session-a'?{tenant_id:'tenant-a',user_id:'user-a',slug:'empresa-a'}:s==='session-b'?{tenant_id:'tenant-b',user_id:'user-b',slug:'empresa-b'}:null,
 insertState:async row=>states.push(row), consumeState:async match=>{const i=states.findIndex(s=>s.state_hash===match.state_hash&&s.session_hash===match.session_hash&&s.tenant_id===match.tenant_id&&s.user_id===match.user_id&&s.expires_at>match.expires_after); if(i<0)return false;states.splice(i,1);return true},
 exchange:async()=>({app_id:'29432161913068502',type:'USER',is_valid:true,user_id:'123',access_token:'secret-token',scopes,expires_at:2000000000}),saveConnection:async row=>connections.push(row),getStatus:async()=>({connected:false}),now:()=>1800000000000});
 return {handler,connections};
}
test('state binds callback to original tenant, user and session, and is single-use',async()=>{
 const {handler,connections}=setup();const start=await handler(request('start'));const url=new URL((await start.json()).url);const state=url.searchParams.get('state');assert.equal(url.searchParams.get('redirect_uri'),redirectUri); assert.equal(url.searchParams.get('config_id'),'1549929046901619');
 assert.equal((await handler(request('complete',{state,code:'code'},'session-b'))).status,403);
 const ok=await handler(request('complete',{state,code:'code'}));assert.equal(ok.status,200);assert.equal(connections[0].tenant_id,'tenant-a');assert.equal(JSON.stringify(await ok.json()).includes('secret-token'),false);
 assert.equal((await handler(request('complete',{state,code:'code'}))).status,403);
});
test('blocks unauthorized sessions and other origins',async()=>{const {handler}=setup();assert.equal((await handler(request('start',{},'unknown'))).status,403);assert.equal((await handler(request('start',{},'session-a','https://evil.example'))).status,403)});
test('rejects insufficient permissions before storing credentials',async()=>{
 let saved=false;const h=createHandler({context:async()=>({tenant_id:'a',user_id:'b',slug:'a'}),insertState:async()=>{},consumeState:async()=>true,exchange:async()=>({app_id:'29432161913068502',type:'USER',is_valid:true,user_id:'1',access_token:'x',scopes:[]}),saveConnection:async()=>{saved=true}});
 const res=await h(request('complete',{state:'a'.repeat(64),code:'x'}));assert.equal(res.status,400);assert.equal(saved,false);
});
