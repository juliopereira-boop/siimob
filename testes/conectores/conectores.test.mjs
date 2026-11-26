// OpenAI e WhatsApp da Central (supabase/functions/atendimento-conectores/handler.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../../supabase/functions/atendimento-conectores/handler.mjs';
import { criarEvolution, ErroEvolution } from '../../supabase/functions/atendimento-conectores/evolution.mjs';

const origin = 'https://siimob.com';
const AT = '11111111-2222-3333-4444-555555555555';
const req = (action, extra = {}, token = 'tk-gestor') =>
  new Request('https://api.example/', {
    method: 'POST',
    headers: { origin, 'x-session-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...extra })
  });
const QR = 'data:image/png;base64,' + 'A'.repeat(200);

function montar(over = {}) {
  const st = {
    ia: null,
    wa: null,
    uso: { primeira_conexao_em: new Date().toISOString() },
    envios: [],
    falhas: [],
    pausas: [],
    estados: [],
    criados: [],
    logs: [],
    evo: [],
    ...over.st
  };
  const evolution = {
    configurado: true,
    async criar(i, url) {
      st.evo.push(['criar', i, url]);
      return { qr: QR, codigo: 'ABCD-1234' };
    },
    async definirWebhook(i, url) {
      st.evo.push(['webhook', i, url]);
    },
    async qr(i) {
      st.evo.push(['qr', i]);
      return { qr: QR, codigo: null };
    },
    async estado() {
      return 'conectado';
    },
    async perfil() {
      return { numero: '5598900001111', nome: 'The Cred' };
    },
    async sair(i) {
      st.evo.push(['sair', i]);
    },
    async enviarTexto(i, n, t, atraso) {
      st.evo.push(['enviar', i, n, t, atraso]);
      return { id: 'wamid-1' };
    },
    ...over.evolution
  };
  const h = createHandler({
    evolution,
    chavePlataforma: over.chavePlataforma ?? '',
    log: m => st.logs.push(m),
    context: async t =>
      ({
        'tk-gestor': { tenant_id: 'tenant-a', user_id: 'u1', slug: 'thecred', gestor: true },
        'tk-ana': { tenant_id: 'tenant-a', user_id: 'u2', slug: 'thecred', gestor: false }
      })[t] || null,
    iaLer: async () => st.ia,
    iaSalvar: async (t, v) => {
      st.ia = { chave: v.chave, modelo: v.modelo, teste_ok: v.teste_ok, testado_em: null };
    },
    iaMarcarTeste: async (t, ok) => {
      st.ia = { ...(st.ia || { chave: null, modelo: 'gpt-4o-mini' }), teste_ok: ok };
    },
    openaiModelos: async chave => {
      if (chave.includes('ruim')) throw new Error('chave_recusada');
      return [
        'gpt-4o-mini',
        'gpt-4.1-mini',
        'whisper-1',
        'gpt-4o-realtime-preview',
        'text-embedding-3-small'
      ];
    },
    waLer: async () => st.wa,
    waCriar: async row => {
      st.criados.push(row);
      st.wa = { ...row, estado: 'aguardando_qr', criar_leads: true };
    },
    waToken: async (t, hash) => {
      st.wa.webhook_token_hash = hash;
    },
    waOpcoes: async (t, c) => {
      st.wa.criar_leads = c;
    },
    waEstado: async (t, e, n, nome) => {
      st.estados.push([e, n || null, nome || null]);
      if (st.wa) st.wa.estado = e;
    },
    waUso: async () => st.uso,
    waPausar: async (t, ate, motivo) => st.pausas.push([ate, motivo]),
    alvo: async (token, at) => {
      if (token === 'tk-ana') throw new Error('sem_permissao');
      return {
        tenant_id: 'tenant-a',
        atendimento_id: at,
        telefone: '5598981234567',
        autor: 'Gestor',
        lead_escreveu_24h: st.leadEscreveu ?? true
      };
    },
    registrarEnvio: async (...a) => {
      st.envios.push(a);
      return { ok: true, id: 'msg-1' };
    },
    registrarFalha: async (...a) => st.falhas.push(a),
    gerarToken: () => 'f'.repeat(64),
    hash: async s => `h(${s.slice(0, 4)})`,
    webhookUrl: (i, t) => `https://x/functions/v1/whatsapp-webhook?i=${i}&t=${t}`,
    now: () => Date.parse('2026-11-22T12:00:00Z')
  });
  return { h, st };
}

test('só origem do SIIMOB e sessão válida; corretor não mexe nas integrações', async () => {
  const { h } = montar();
  const fora = new Request('https://api.example/', {
    method: 'POST',
    headers: { origin: 'https://mal.com', 'x-session-token': 'tk-gestor' },
    body: '{}'
  });
  assert.equal((await h(fora)).status, 403);
  assert.equal((await h(req('status', {}, 'tk-nada'))).status, 403);
  assert.equal((await h(req('status', {}, 'tk-ana'))).status, 403);
  assert.equal((await h(req('ia_salvar', { chave: 'sk-' + 'a'.repeat(30) }, 'tk-ana'))).status, 403);
  assert.equal((await h(req('wa_conectar', {}, 'tk-ana'))).status, 403);
});

test('status nunca devolve a chave da OpenAI, só os 4 últimos', async () => {
  const { h } = montar({
    st: { ia: { chave: 'sk-proj-segredoSEGREDO1234abcd', modelo: 'gpt-4o-mini', teste_ok: true } }
  });
  const r = await (await h(req('status'))).json();
  assert.equal(r.ia.final, 'abcd');
  assert.equal(r.ia.propria, true);
  assert.ok(!JSON.stringify(r).includes('segredo'));
  assert.equal(r.whatsapp.estado, 'nao_criado');
});

test('salvar chave: formato, teste antes de guardar, e chave recusada não é salva', async () => {
  const { h, st } = montar();
  assert.equal((await (await h(req('ia_salvar', { chave: 'abc' }))).json()).error, 'chave_invalida');
  const ruim = await h(req('ia_salvar', { chave: 'sk-ruim' + 'x'.repeat(30) }));
  assert.equal((await ruim.json()).error, 'chave_recusada');
  assert.equal(st.ia, null);
  const boa = await (
    await h(req('ia_salvar', { chave: 'sk-proj-' + 'b'.repeat(30) + 'wxyz', modelo: 'gpt-4.1-mini' }))
  ).json();
  assert.equal(boa.ok, true);
  assert.equal(boa.ia.final, 'wxyz');
  assert.equal(st.ia.modelo, 'gpt-4.1-mini');
  assert.equal(
    (await (await h(req('ia_salvar', { modelo: 'gpt 4; drop' }))).json()).error,
    'invalid_request'
  );
});

test('sem chave própria e sem chave da plataforma, não salva; com a da plataforma, pode remover a própria', async () => {
  const { h } = montar();
  assert.equal((await (await h(req('ia_salvar', { chave: null }))).json()).error, 'sem_chave');
  const { h: h2, st: st2 } = montar({
    chavePlataforma: 'sk-plataforma',
    st: { ia: { chave: 'sk-' + 'c'.repeat(30), modelo: 'gpt-4o-mini' } }
  });
  const r = await (await h2(req('ia_salvar', { chave: null }))).json();
  assert.equal(r.ok, true);
  assert.equal(st2.ia.chave, null);
  assert.equal(r.ia.propria, false);
  assert.equal(r.ia.configurada, true);
});

test('testar lista só modelos de conversa e sugere o preferido', async () => {
  const { h } = montar({ chavePlataforma: 'sk-plataforma' });
  const r = await (await h(req('ia_testar'))).json();
  assert.equal(r.ok, true);
  assert.deepEqual(r.modelos, ['gpt-4.1-mini', 'gpt-4o-mini']);
  assert.equal(r.sugerido, 'gpt-4.1-mini');
});

test('conectar o WhatsApp: cria a instância com o aviso e devolve o QR; o token só vai em hash para o banco', async () => {
  const { h, st } = montar();
  const r = await (await h(req('wa_conectar'))).json();
  assert.equal(r.ok, true);
  assert.equal(r.qr, QR);
  assert.equal(r.codigo, 'ABCD-1234');
  assert.equal(st.criados[0].instancia, 'siimob-thecred');
  assert.equal(st.criados[0].webhook_token_hash, 'h(ffff)');
  assert.deepEqual(st.evo[0], [
    'criar',
    'siimob-thecred',
    `https://x/functions/v1/whatsapp-webhook?i=siimob-thecred&t=${'f'.repeat(64)}`
  ]);
  assert.ok(!JSON.stringify(r).includes('f'.repeat(64)), 'o token não volta para a tela');
  // reconectar: troca o token e pede QR novo, sem criar outra instância
  const r2 = await (await h(req('wa_conectar'))).json();
  assert.equal(r2.ok, true);
  assert.equal(st.criados.length, 1);
  assert.deepEqual(
    st.evo.slice(1).map(x => x[0]),
    ['webhook', 'qr']
  );
});

test('sem servidor da Evolution configurado, avisa', async () => {
  const { h } = montar({ evolution: { configurado: false } });
  assert.equal((await (await h(req('wa_conectar'))).json()).error, 'servidor_nao_configurado');
});

test('enviar pela Central: corretor sem posse é barrado; desconectado não envia', async () => {
  const { h, st } = montar();
  assert.equal((await h(req('wa_enviar', { atendimento_id: AT, texto: 'oi' }, 'tk-ana'))).status, 403);
  assert.equal(
    (await (await h(req('wa_enviar', { atendimento_id: AT, texto: 'oi' }))).json()).error,
    'whatsapp_desconectado'
  );
  assert.equal((await h(req('wa_enviar', { atendimento_id: 'x', texto: 'oi' }))).status, 400);
  assert.equal(st.evo.length, 0);
});

test('enviar: resposta sai rápido, grava com o id do WhatsApp e conta como resposta', async () => {
  const { h, st } = montar({ st: { wa: { instancia: 'siimob-thecred', estado: 'conectado' } } });
  const r = await (await h(req('wa_enviar', { atendimento_id: AT, texto: '  Olá Joana!  ' }))).json();
  assert.equal(r.ok, true);
  assert.equal(r.tipo, 'resposta');
  assert.deepEqual(st.evo[0], ['enviar', 'siimob-thecred', '5598981234567', 'Olá Joana!', 1200]);
  assert.deepEqual(st.envios[0], [
    'tenant-a',
    AT,
    'Olá Joana!',
    'Gestor',
    'wamid-1',
    'resposta',
    'evolution'
  ]);
});

test('enviar no limite: segura, grava a pausa geral e devolve quando volta', async () => {
  const { h, st } = montar({
    st: {
      wa: { instancia: 'siimob-thecred', estado: 'conectado' },
      uso: { hora: 150, antigo_hora: '2026-11-22T11:30:00Z' }
    }
  });
  const res = await h(req('wa_enviar', { atendimento_id: AT, texto: 'oi' }));
  assert.equal(res.status, 429);
  const r = await res.json();
  assert.equal(r.error, 'limite');
  assert.equal(r.volta_em, '2026-11-22T12:30:00.000Z');
  assert.match(r.motivo, /hora/);
  assert.deepEqual(st.pausas, [['2026-11-22T12:30:00.000Z', 'limite_da_hora']]);
  assert.equal(st.evo.length, 0);
});

test('conversa iniciada por nós (lead não escreveu) usa o teto de disparo do aquecimento', async () => {
  const { h, st } = montar({
    st: {
      leadEscreveu: false,
      wa: { instancia: 'siimob-thecred', estado: 'conectado' },
      uso: { primeira_conexao_em: '2026-11-22T00:00:00Z', dia_frio: 20, dia: 20 }
    }
  });
  const res = await h(req('wa_enviar', { atendimento_id: AT, texto: 'oi' }));
  assert.equal(res.status, 429);
  assert.equal(st.pausas.length, 0, 'teto de disparo não pausa as respostas');
});

test('falha da Evolution conta como falha e não grava mensagem', async () => {
  const { h, st } = montar({
    st: { wa: { instancia: 'siimob-thecred', estado: 'conectado' } },
    evolution: {
      async enviarTexto() {
        throw new ErroEvolution('erro_evolution', 500);
      }
    }
  });
  assert.equal((await h(req('wa_enviar', { atendimento_id: AT, texto: 'oi' }))).status, 502);
  assert.equal(st.falhas.length, 1);
  assert.equal(st.envios.length, 0);
});

test('cliente da Evolution: chave no cabeçalho, QR validado, id da mensagem', async () => {
  const chamadas = [];
  const f = async (url, init) => {
    chamadas.push([init.method, url, init.headers.apikey, init.body ? JSON.parse(init.body) : null]);
    if (url.endsWith('/instance/create'))
      return new Response(JSON.stringify({ qrcode: { base64: QR, pairingCode: 'WXYZ-9876' } }));
    if (url.includes('/message/sendText/')) return new Response(JSON.stringify({ key: { id: 'BAE5ABC' } }));
    if (url.includes('/instance/connect/'))
      return new Response(JSON.stringify({ base64: '<script>', pairingCode: 'x' }));
    if (url.includes('/connectionState/'))
      return new Response(JSON.stringify({ instance: { state: 'open' } }));
    return new Response('{}');
  };
  const e = criarEvolution({ url: 'https://evo.exemplo.com/', chave: 'chave-global', fetch: f });
  const q = await e.criar('siimob-thecred', 'https://hook');
  assert.equal(q.qr, QR);
  assert.equal(q.codigo, 'WXYZ-9876');
  assert.equal(chamadas[0][1], 'https://evo.exemplo.com/instance/create');
  assert.equal(chamadas[0][2], 'chave-global');
  assert.equal(chamadas[1][1], 'https://evo.exemplo.com/webhook/set/siimob-thecred');
  assert.equal(chamadas[1][3].webhook.url, 'https://hook');
  assert.deepEqual(await e.qr('siimob-thecred'), { qr: null, codigo: null }, 'QR que não é PNG não passa');
  assert.equal(await e.estado('siimob-thecred'), 'conectado');
  assert.deepEqual(await e.enviarTexto('siimob-thecred', '5598981234567', 'oi'), { id: 'BAE5ABC' });
  await assert.rejects(() => e.enviarTexto('siimob-thecred', '12', 'oi'), /numero_invalido/);
  await assert.rejects(() => e.qr('../admin'), /instancia_invalida/);
  assert.equal(criarEvolution({ url: 'http://inseguro', chave: 'x', fetch: f }).configurado, false);
});

test('arquivo usa a mesma permissão do texto e registra o envio sem guardar base64', async () => {
  const calls = [];
  const { h, st } = montar({
    st: { wa: { estado: 'conectado', instancia: 'siimob-thecred' } },
    evolution: {
      enviarMidia: async (...args) => {
        calls.push(args);
        return { id: 'midia-1' };
      }
    }
  });
  const anexo = { nome: 'ficha.pdf', mime: 'application/pdf', dados: 'JVBERg==' };
  const payload = { atendimento_id: AT, texto: '', anexo };
  assert.equal((await h(req('wa_anexo', payload, 'tk-ana'))).status, 403);
  assert.equal(
    (await h(req('wa_anexo', { ...payload, anexo: { ...anexo, dados: 'https://example.com/file' } }))).status,
    400
  );
  assert.equal((await h(req('wa_anexo', payload))).status, 200);
  assert.deepEqual(calls, [['siimob-thecred', '5598981234567', anexo.dados, anexo.mime, anexo.nome, '']]);
  assert.deepEqual(st.envios[0], [
    'tenant-a',
    AT,
    '📎 ficha.pdf',
    'Gestor',
    'midia-1',
    'resposta',
    'evolution'
  ]);
});
