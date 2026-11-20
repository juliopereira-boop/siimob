// Inativar, desconectar e "todos os formulários" (meta-connect).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../../supabase/functions/meta-connect/handler.mjs';

const origin = 'https://siimob.com';
const request = (action, extra = {}) =>
  new Request('https://api.example/', {
    method: 'POST',
    headers: { origin, 'x-session-token': 'session-a', 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...extra })
  });
const contexto = async () => ({ tenant_id: 'tenant-a', user_id: 'user-a', slug: 'empresa-a' });

test('set_active pausa e retoma só a empresa da sessão, e exige booleano', async () => {
  const chamadas = [];
  const h = createHandler({
    context: contexto,
    setActive: async (t, a) => {
      chamadas.push([t, a]);
      return 'ok';
    }
  });
  const r = await h(request('set_active', { ativo: false, tenant_id: 'tenant-b' }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, ativo: false });
  assert.deepEqual(chamadas, [['tenant-a', false]]);
  assert.equal((await h(request('set_active', { ativo: 'false' }))).status, 400);
  assert.equal(chamadas.length, 1);
  const sem = createHandler({ context: contexto, setActive: async () => 'not_connected' });
  assert.equal((await sem(request('set_active', { ativo: true }))).status, 409);
});

test('disconnect desliga as páginas escolhidas na Meta e apaga a conexão', async () => {
  const desligou = [];
  let apagou = null;
  const h = createHandler({
    context: contexto,
    getConnection: async () => ({ access_token: 'user-token', connected_at: 'v1' }),
    getSelectedPages: async () => [{ page_id: '11' }],
    listPagesWithTokens: async t => {
      assert.equal(t, 'user-token');
      return [
        { id: '11', name: 'A', access_token: 'page-token-11' },
        { id: '22', name: 'B', access_token: 'page-token-22' }
      ];
    },
    unsubscribePage: async (id, token) => {
      desligou.push([id, token]);
      return true;
    },
    disconnect: async t => {
      apagou = t;
      return 'ok';
    }
  });
  const r = await h(request('disconnect'));
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.deepEqual(corpo, { ok: true, pages: [{ id: '11', desligada: true }] });
  assert.deepEqual(desligou, [['11', 'page-token-11']]);
  assert.equal(apagou, 'tenant-a');
  assert.equal(JSON.stringify(corpo).includes('token'), false);
});

test('disconnect apaga a conexão mesmo se a Meta não responder', async () => {
  let apagou = false;
  const logs = [];
  const h = createHandler({
    context: contexto,
    getConnection: async () => ({ access_token: 'user-token' }),
    getSelectedPages: async () => [{ page_id: '11' }],
    listPagesWithTokens: async () => {
      throw new Error('Meta pages unavailable (500)');
    },
    disconnect: async () => {
      apagou = true;
      return 'ok';
    },
    log: m => logs.push(m)
  });
  const r = await h(request('disconnect'));
  assert.equal(r.status, 200);
  assert.equal(apagou, true);
  assert.match(logs[0], /disconnect: Meta pages unavailable \(500\)/);
  const nada = createHandler({ context: contexto, getConnection: async () => null });
  assert.equal((await nada(request('disconnect'))).status, 409);
});

test('page_options grava a opção da página da empresa e valida a entrada', async () => {
  const gravou = [];
  const h = createHandler({
    context: contexto,
    pageOptions: async (t, p, v) => {
      gravou.push([t, p, v]);
      return p === '11' ? 'ok' : 'page_not_selected';
    }
  });
  assert.equal((await h(request('page_options', { page_id: '11', todos_formularios: true }))).status, 200);
  assert.equal((await h(request('page_options', { page_id: '99', todos_formularios: true }))).status, 409);
  assert.equal((await h(request('page_options', { page_id: 'x', todos_formularios: true }))).status, 400);
  assert.equal((await h(request('page_options', { page_id: '11', todos_formularios: 1 }))).status, 400);
  assert.deepEqual(gravou, [
    ['tenant-a', '11', true],
    ['tenant-a', '99', true]
  ]);
});

test('pages devolve a opção "todos os formulários" de cada página escolhida', async () => {
  const h = createHandler({
    context: contexto,
    getConnection: async () => ({ access_token: 't' }),
    listPages: async () => [
      { id: '11', name: 'A' },
      { id: '22', name: 'B' }
    ],
    getSelectedPages: async () => [{ page_id: '11', todos_formularios: true }]
  });
  const d = await (await h(request('pages'))).json();
  assert.deepEqual(d.pages, [
    { id: '11', name: 'A', selected: true, todos_formularios: true },
    { id: '22', name: 'B', selected: false, todos_formularios: false }
  ]);
});

test('erro inesperado vai para o log com a ação e só códigos, e a resposta não vaza nada', async () => {
  const logs = [];
  const h = createHandler({
    context: contexto,
    getConnection: async () => ({ access_token: 't' }),
    getSelectedPages: async () => [{ page_id: '11' }],
    listPages: async () => [{ id: '11', name: 'A' }],
    listForms: async () => {
      throw new Error('Meta unavailable (400/100/33)');
    },
    log: m => logs.push(m)
  });
  const r = await h(request('forms', { page_id: '11' }));
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'temporarily_unavailable' });
  assert.deepEqual(logs, ['meta-connect forms: Meta unavailable (400/100/33)']);
});
