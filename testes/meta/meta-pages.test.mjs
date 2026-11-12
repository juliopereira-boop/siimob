import test from 'node:test';
import assert from 'node:assert/strict';
import { listMetaPages } from '../../supabase/functions/meta-connect/pages.mjs';

test('paginates using only the fixed Meta endpoint and never returns tokens', async () => {
  const seen=[];
  const pages=await listMetaPages('secret',async (url,options)=>{
    seen.push({url:String(url),auth:options.headers.Authorization});
    return Response.json(seen.length===1?{data:[{id:'11',name:'A',access_token:'ignore'}],paging:{next:'https://evil.example/',cursors:{after:'abc'}}}:{data:[{id:'22',name:'B'}]});
  });
  assert.deepEqual(pages,[{id:'11',name:'A'},{id:'22',name:'B'}]);
  assert.ok(seen.every(item=>new URL(item.url).hostname==='graph.facebook.com' && item.auth==='Bearer secret'));
  assert.equal(new URL(seen[1].url).searchParams.get('after'),'abc');
});
test('fails without returning a partial list when pagination fails',async()=>{
 let calls=0;
 await assert.rejects(listMetaPages('secret',async()=>{calls++; return calls===1?Response.json({data:[{id:'11',name:'A'}],paging:{next:'x',cursors:{after:'abc'}}}):new Response('error',{status:500})}));
});
