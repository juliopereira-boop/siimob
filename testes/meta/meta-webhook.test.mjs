import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createHandler } from '../../supabase/functions/meta-leads-webhook/handler.mjs';

const secret = 'test-app-secret';
const payload = JSON.stringify({ object: 'page', entry: [{ id: '123', changes: [{ field: 'leadgen', value: { page_id: '123', leadgen_id: '456', form_id: '789' } }] }] });
const signature = body => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
const post = (body, sig = signature(body)) => new Request('https://example.test/', { method: 'POST', body, headers: { 'x-hub-signature-256': sig } });

test('challenge validates token and mode', async () => {
  const handle = createHandler({ verifyToken: 'test-token', appSecret: secret, saveEvents: async () => {} });
  let res = await handle(new Request('https://example.test/?hub.mode=subscribe&hub.verify_token=test-token&hub.challenge=abc'));
  assert.equal(res.status, 200); assert.equal(await res.text(), 'abc');
  res = await handle(new Request('https://example.test/?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc'));
  assert.equal(res.status, 403);
});
test('valid signature persists minimal identifiers and ignores duplicate batch events', async () => {
  let saved;
  const handle = createHandler({ appSecret: secret, saveEvents: async events => { saved = events; } });
  const body = JSON.parse(payload); body.entry[0].changes.push(body.entry[0].changes[0]);
  const res = await handle(post(JSON.stringify(body)));
  assert.equal(res.status, 200); assert.deepEqual(saved, [{ page_id:'123', leadgen_id:'456', form_id:'789' }]);
});
test('rejects invalid signature without storing', async () => {
  let saves = 0;
  const handle = createHandler({ appSecret: secret, saveEvents: async () => { saves++; } });
  assert.equal((await handle(post(payload, signature(payload + 'x')))).status, 403);
  assert.equal((await handle(post(payload, ''))).status, 403);
  assert.equal(saves, 0);
});
// Bug de produção (20/11): a Meta entregou com assinatura válida e o SIIMOB
// respondeu 400 porque entry.id não batia com o page_id (o "Testar" do painel
// manda entry.id "0"). A Meta reenviou e desistiu. Aviso assinado é sempre 200.
test('signed notice with entry.id different from page_id is stored by the page in the notice', async () => {
  let saved; const logs = [];
  const handle = createHandler({ appSecret: secret, saveEvents: async e => { saved = e; }, log: m => logs.push(m) });
  const body = JSON.parse(payload); body.entry[0].id = '0';
  const res = await handle(post(JSON.stringify(body)));
  assert.equal(res.status, 200);
  assert.deepEqual(saved, [{ page_id: '123', leadgen_id: '456', form_id: '789' }]);
  assert.ok(logs.some(m => /entrada 0 diferente da página 123/.test(m)));
});
test('Meta panel sample payload (numeric ids, extra fields) is accepted', async () => {
  let saved;
  const handle = createHandler({ appSecret: secret, saveEvents: async e => { saved = e; } });
  const body = JSON.stringify({ object: 'page', entry: [{ id: '0', time: 1795000000, changes: [{ field: 'leadgen', value: { ad_id: '444444444', form_id: '444444444444', leadgen_id: 444444444444, created_time: 1795000000, page_id: '444444444444', adgroup_id: '44444444444' } }] }] });
  assert.equal((await handle(post(body))).status, 200);
  assert.deepEqual(saved, [{ page_id: '444444444444', leadgen_id: '444444444444', form_id: '444444444444' }]);
});
test('signed but unusable notices answer 200, store nothing and log only ids', async () => {
  let saves = 0; const logs = [];
  const handle = createHandler({ appSecret: secret, saveEvents: async () => { saves++; }, log: m => logs.push(m) });
  for (const b of [
    '{nao json',
    JSON.stringify({ object: 'instagram', entry: [] }),
    JSON.stringify({ object: 'page', entry: [{ id: '1' }] }),
    JSON.stringify({ object: 'page', entry: [{ id: '1', changes: [{ field: 'leadgen', value: { page_id: '1', leadgen_id: 'x"; drop', form_id: '2' } }] }] }),
    JSON.stringify({ object: 'page', entry: [{ id: '1', changes: [{ field: 'feed', value: {} }] }] })
  ]) assert.equal((await handle(post(b))).status, 200, b);
  assert.equal(saves, 0);
  assert.ok(logs.length >= 4);
  assert.ok(logs.every(m => !m.includes('drop')), 'texto do aviso não vai para o log');
});
test('storage errors trigger retry and missing secret fails closed', async () => {
  const handle = createHandler({ appSecret: secret, saveEvents: async () => { throw new Error('down'); } });
  assert.equal((await handle(post(payload))).status, 503);
  assert.equal((await createHandler({})(post(payload))).status, 503);
});
