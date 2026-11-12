import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createHandler } from '../supabase/functions/meta-leads-webhook/handler.mjs';

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
test('rejects invalid signature and mismatched page without storing', async () => {
  let saves = 0;
  const handle = createHandler({ appSecret: secret, saveEvents: async () => { saves++; } });
  assert.equal((await handle(post(payload, signature(payload + 'x')))).status, 403);
  const body = JSON.parse(payload); body.entry[0].id = '999';
  assert.equal((await handle(post(JSON.stringify(body)))).status, 400);
  assert.equal(saves, 0);
});
test('storage errors trigger retry and missing secret fails closed', async () => {
  const handle = createHandler({ appSecret: secret, saveEvents: async () => { throw new Error('down'); } });
  assert.equal((await handle(post(payload))).status, 503);
  assert.equal((await createHandler({})(post(payload))).status, 503);
});
