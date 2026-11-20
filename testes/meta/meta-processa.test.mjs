import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  criarProcessador,
  criarGraph,
  mapearCampos,
  ErroMeta
} from '../../supabase/functions/meta-leads-webhook/processa.mjs';
import { createHandler as webhook } from '../../supabase/functions/meta-leads-webhook/handler.mjs';
import { createHandler as connect } from '../../supabase/functions/meta-connect/handler.mjs';

const EV = { page_id: '111', leadgen_id: '555', form_id: '901' };
const FIELD_DATA = [
  { name: 'full_name', values: ['Maria Souza'] },
  { name: 'phone_number', values: ['+5598999990001'] },
  { name: 'email', values: ['maria@exemplo.com'] },
  { name: 'qual_sua_renda?', values: ['R$ 5 mil'] },
  { name: 'empreendimento_de_interesse', values: ['Jardins'] }
];

function dbFalso(extra = {}) {
  const chamadas = [];
  return {
    chamadas,
    pagina: async () => ({ tenant_id: 't1' }),
    formulario: async () => ({ selected: true, funil: 'lancamentos', form_name: 'Lançamento Jardins' }),
    conexao: async () => ({ access_token: 'user-token', token_expires_at: '2099-01-01T00:00:00Z' }),
    criarLead: async a => (chamadas.push(a), { ok: true, duplicado: false, case_id: 'c1' }),
    ...extra
  };
}
const graphFalso = (lead = { field_data: FIELD_DATA, campaign_name: 'Campanha Nov' }) => ({
  tokenDaPagina: async (u, p) => (assert.equal(u, 'user-token'), assert.equal(p, '111'), 'page-token'),
  lead: async (id, tok) => (assert.equal(id, '555'), assert.equal(tok, 'page-token'), lead)
});

test('mapeia nome, telefone, e-mail e guarda o resto como respostas', () => {
  const m = mapearCampos(FIELD_DATA);
  assert.equal(m.nome, 'Maria Souza');
  assert.equal(m.telefone, '+5598999990001');
  assert.equal(m.email, 'maria@exemplo.com');
  assert.deepEqual(
    m.respostas.map(r => r.pergunta),
    ['qual sua renda?', 'empreendimento de interesse']
  );
  assert.equal(
    mapearCampos([
      { name: 'first_name', values: ['Ana'] },
      { name: 'last_name', values: ['Lima'] }
    ]).nome,
    'Ana Lima'
  );
  assert.equal(
    mapearCampos([
      { name: 'Nome Completo', values: ['José'] },
      { name: 'WhatsApp', values: ['98 9999'] }
    ]).telefone,
    '98 9999'
  );
});

test('aviso de formulário marcado vira lead no funil do formulário, com a campanha como origem', async () => {
  const db = dbFalso();
  const r = await criarProcessador({ db, graph: graphFalso() })(EV);
  assert.deepEqual(r, { tenant_id: 't1', status: 'criado', case_id: 'c1' });
  const a = db.chamadas[0];
  assert.equal(a.p_tenant, 't1');
  assert.equal(a.p_origem, 'meta');
  assert.equal(a.p_externo, '555');
  assert.equal(a.p_funil, 'lancamentos');
  assert.equal(a.p_nome, 'Maria Souza');
  assert.equal(a.p_detalhes.rotulo, 'Meta · Campanha Nov');
  assert.match(a.p_detalhes.observacoes, /Formulário: Lançamento Jardins/);
  assert.match(a.p_detalhes.observacoes, /qual sua renda\?: R\$ 5 mil/);
  assert.equal(a.p_detalhes.dados.formulario, '901');
  assert.ok(!JSON.stringify(a).includes('token'), 'nenhum token vai para o banco');
});

test('formulário não marcado, página sem empresa e conexão vencida não criam lead', async () => {
  const nunca = {
    tokenDaPagina: async () => assert.fail('não devia chamar a Meta'),
    lead: async () => assert.fail()
  };
  assert.deepEqual(await criarProcessador({ db: dbFalso({ pagina: async () => null }), graph: nunca })(EV), {
    status: 'ignorado',
    detalhe: 'pagina_sem_empresa'
  });
  assert.equal(
    (
      await criarProcessador({
        db: dbFalso({ formulario: async () => ({ selected: false }) }),
        graph: nunca
      })(EV)
    ).detalhe,
    'formulario_nao_marcado'
  );
  assert.equal(
    (await criarProcessador({ db: dbFalso({ formulario: async () => null }), graph: nunca })(EV)).detalhe,
    'formulario_nao_marcado'
  );
  const vencida = dbFalso({
    conexao: async () => ({ access_token: 'x', token_expires_at: '2000-01-01T00:00:00Z' })
  });
  assert.deepEqual(await criarProcessador({ db: vencida, graph: nunca })(EV), {
    tenant_id: 't1',
    status: 'erro',
    detalhe: 'reconectar'
  });
});

test('erro da Meta e da criação viram motivo legível no aviso', async () => {
  const negado = {
    tokenDaPagina: async () => {
      throw new ErroMeta('permissao_meta');
    },
    lead: async () => ({})
  };
  assert.deepEqual(await criarProcessador({ db: dbFalso(), graph: negado })(EV), {
    tenant_id: 't1',
    status: 'erro',
    detalhe: 'permissao_meta'
  });
  const semModulo = dbFalso({ criarLead: async () => ({ ok: false, erro: 'sem_modulo_leads' }) });
  assert.equal((await criarProcessador({ db: semModulo, graph: graphFalso() })(EV)).status, 'ignorado');
  const dup = dbFalso({ criarLead: async () => ({ ok: true, duplicado: true, case_id: 'c1' }) });
  assert.equal((await criarProcessador({ db: dup, graph: graphFalso() })(EV)).status, 'duplicado');
});

test('a Graph manda token no cabeçalho e, sem permissão de anúncio, pede só os campos do formulário', async () => {
  const pedidos = [];
  const g = criarGraph(async (url, opts) => {
    pedidos.push({ url: String(url), auth: opts.headers.Authorization });
    if (pedidos.length === 1) return Response.json({ access_token: 'page-token' });
    if (pedidos.length === 2)
      return Response.json({ error: { code: 200, message: 'needs ads_read' } }, { status: 403 });
    return Response.json({ field_data: FIELD_DATA });
  });
  const tok = await g.tokenDaPagina('user-token', '111');
  const lead = await g.lead('555', tok);
  assert.equal(lead.field_data.length, 5);
  assert.equal(pedidos[0].auth, 'Bearer user-token');
  assert.equal(pedidos[1].auth, 'Bearer page-token');
  assert.match(pedidos[1].url, /campaign_name/);
  assert.doesNotMatch(pedidos[2].url, /campaign_name/);
  assert.ok(
    pedidos.every(p => !/user-token|page-token/.test(p.url)),
    'token nunca na URL'
  );
  const expirado = criarGraph(async () => Response.json({ error: { code: 190 } }, { status: 401 }));
  await assert.rejects(expirado.tokenDaPagina('x', '111'), e => e.motivo === 'reconectar');
});

const secret = 'test-app-secret';
const corpo = JSON.stringify({
  object: 'page',
  entry: [{ id: '111', changes: [{ field: 'leadgen', value: EV }] }]
});
const assinado = b =>
  new Request('https://example.test/', {
    method: 'POST',
    body: b,
    headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(b).digest('hex') }
  });

test('o webhook guarda, responde sem esperar o processamento e processa o que guardou', async () => {
  const ordem = [];
  let adiado;
  const h = webhook({
    appSecret: secret,
    saveEvents: async () => ordem.push('salvou'),
    // Processamento que nunca termina: a resposta à Meta não pode depender dele.
    processEvents: ev => (ordem.push('processando:' + ev[0].leadgen_id), new Promise(() => {})),
    defer: p => {
      adiado = p;
    }
  });
  const r = await h(assinado(corpo));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'EVENT_RECEIVED');
  assert.ok(adiado instanceof Promise, 'o processamento foi entregue ao defer');
  await new Promise(ok => setTimeout(ok, 10));
  assert.deepEqual(ordem, ['salvou', 'processando:555']);
});

test('falha ao guardar não processa nada (a Meta reenvia)', async () => {
  let processou = false;
  const h = webhook({
    appSecret: secret,
    saveEvents: async () => {
      throw new Error('db');
    },
    processEvents: async () => {
      processou = true;
    }
  });
  assert.equal((await h(assinado(corpo))).status, 503);
  assert.equal(processou, false);
});

test('a rota interna de reprocessar exige a credencial do servidor', async () => {
  let pediu;
  const h = webhook({
    appSecret: secret,
    internalKey: 'chave-servico',
    saveEvents: async () => {},
    retryPending: async t => ((pediu = t), { criado: 1 })
  });
  const req = key =>
    new Request('https://example.test/meta-leads-webhook/processar', {
      method: 'POST',
      headers: key ? { 'x-siimob-interno': key } : {},
      body: JSON.stringify({ tenant_id: '00000000-0000-0000-0000-000000000001' })
    });
  assert.equal((await h(req())).status, 403);
  assert.equal((await h(req('errada'))).status, 403);
  const ok = await h(req('chave-servico'));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { criado: 1 });
  assert.equal(pediu, '00000000-0000-0000-0000-000000000001');
});

const pedidoConnect = body =>
  new Request('https://example.test/', {
    method: 'POST',
    headers: {
      origin: 'https://siimob.com',
      'x-session-token': 'session',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
const baseConnect = extra =>
  connect({
    context: async () => ({ tenant_id: 'tenant-a', user_id: 'user-a', slug: 'a' }),
    getConnection: async () => ({ access_token: 'private', connected_at: 'v1' }),
    listPages: async () => [
      { id: '111', name: 'Página' },
      { id: '222', name: 'Outra' }
    ],
    listPagesWithTokens: async () => [
      { id: '111', name: 'Página', access_token: 'page-secret' },
      { id: '222', name: 'Outra', access_token: 'p2' }
    ],
    getSelectedPages: async () => [{ page_id: '111' }],
    ...extra
  });

test('salvar páginas liga cada uma ao recebimento e não devolve token da página', async () => {
  const ligadas = [];
  const h = baseConnect({
    replacePages: async (t, v, pages) => (assert.ok(pages.every(p => !('access_token' in p))), 'ok'),
    subscribePage: async (id, tok) => (ligadas.push(id + ':' + tok), id === '111')
  });
  const r = await h(pedidoConnect({ action: 'save_pages', page_ids: ['111', '222'] }));
  const corpoR = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(ligadas, ['111:page-secret', '222:p2']);
  assert.deepEqual(corpoR.pages, [
    { id: '111', recebendo: true },
    { id: '222', recebendo: false }
  ]);
  assert.ok(!JSON.stringify(corpoR).includes('secret'));
  const lista = await (await h(pedidoConnect({ action: 'pages' }))).json();
  assert.ok(!JSON.stringify(lista).includes('secret'), 'a lista de páginas não leva token');
});

test('subscribe liga só as páginas escolhidas pela empresa', async () => {
  const ligadas = [];
  const h = baseConnect({ subscribePage: async id => (ligadas.push(id), true) });
  const r = await (await h(pedidoConnect({ action: 'subscribe' }))).json();
  assert.deepEqual(ligadas, ['111']);
  assert.deepEqual(r.pages, [{ id: '111', recebendo: true }]);
});

test('salvar formulários grava o funil de cada um e recusa funil estranho', async () => {
  let salvo;
  const h = baseConnect({
    listForms: async () => [
      { id: '901', name: 'Jardins' },
      { id: '902', name: 'Geral' }
    ],
    getSelectedForms: async () => [{ form_id: '901', funil: 'lancamentos' }],
    replaceForms: async (t, v, page, forms) => ((salvo = forms), 'ok')
  });
  const lista = await (await h(pedidoConnect({ action: 'forms', page_id: '111' }))).json();
  assert.deepEqual(
    lista.forms.map(f => `${f.id}:${f.selected}:${f.funil}`),
    ['901:true:lancamentos', '902:false:null']
  );
  assert.equal(
    (
      await h(
        pedidoConnect({ action: 'save_forms', page_id: '111', form_ids: ['901'], funis: { 901: 'x y;' } })
      )
    ).status,
    400
  );
  assert.equal(salvo, undefined);
  const ok = await h(
    pedidoConnect({
      action: 'save_forms',
      page_id: '111',
      form_ids: ['901', '902'],
      funis: { 901: 'locacao' }
    })
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(salvo, [
    { id: '901', name: 'Jardins', funil: 'locacao' },
    { id: '902', name: 'Geral', funil: null }
  ]);
});

test('leads recentes e reprocessar são da empresa da sessão', async () => {
  let tenants = [];
  const h = baseConnect({
    recentLeads: async t => (tenants.push(t), [{ status: 'criado' }]),
    retryPending: async t => (tenants.push(t), { criado: 2 })
  });
  assert.deepEqual(await (await h(pedidoConnect({ action: 'leads', tenant_id: 'outra' }))).json(), {
    leads: [{ status: 'criado' }]
  });
  assert.deepEqual(await (await h(pedidoConnect({ action: 'reprocessar', tenant_id: 'outra' }))).json(), {
    resumo: { criado: 2 }
  });
  assert.deepEqual(tenants, ['tenant-a', 'tenant-a']);
});

test('integração pausada guarda o aviso sem chamar a Meta nem criar lead', async () => {
  const nunca = {
    tokenDaPagina: async () => assert.fail('não devia chamar a Meta'),
    lead: async () => assert.fail()
  };
  const db = dbFalso({
    conexao: async () => ({
      access_token: 'user-token',
      token_expires_at: '2099-01-01T00:00:00Z',
      ativo: false
    })
  });
  assert.deepEqual(await criarProcessador({ db, graph: nunca })(EV), {
    tenant_id: 't1',
    status: 'ignorado',
    detalhe: 'integracao_inativa'
  });
  assert.equal(db.chamadas.length, 0);
});

test('"todos os formulários" aceita formulário novo, no primeiro funil', async () => {
  const novo = dbFalso({
    pagina: async () => ({ tenant_id: 't1', todos_formularios: true }),
    formulario: async () => null
  });
  const r = await criarProcessador({ db: novo, graph: graphFalso() })(EV);
  assert.equal(r.status, 'criado');
  assert.equal(novo.chamadas[0].p_funil, null);
  assert.match(novo.chamadas[0].p_detalhes.observacoes, /Formulário: Formulário 901/);
  // desmarcado com funil antigo: entra, mas no primeiro funil (a escolha era do marcado)
  const desmarcado = dbFalso({
    pagina: async () => ({ tenant_id: 't1', todos_formularios: true }),
    formulario: async () => ({ selected: false, funil: 'locacao', form_name: 'Antigo' })
  });
  await criarProcessador({ db: desmarcado, graph: graphFalso() })(EV);
  assert.equal(desmarcado.chamadas[0].p_funil, null);
  // marcado continua no funil escolhido
  const marcado = dbFalso({ pagina: async () => ({ tenant_id: 't1', todos_formularios: true }) });
  await criarProcessador({ db: marcado, graph: graphFalso() })(EV);
  assert.equal(marcado.chamadas[0].p_funil, 'lancamentos');
});
