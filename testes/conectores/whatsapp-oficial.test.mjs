// WhatsApp oficial (Coexy) com a Evolution de reserva:
//   supabase/functions/atendimento-conectores/{coexy,rota,handler}.mjs
//   supabase/functions/coexy-webhook/handler.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  criarCoexy,
  classificar,
  normalizarCanal,
  normalizarModelo,
  ErroCoexy
} from '../../supabase/functions/atendimento-conectores/coexy.mjs';
import { enviarWhatsapp, ErroEnvio } from '../../supabase/functions/atendimento-conectores/rota.mjs';
import { createHandler, EVENTOS_COEXY } from '../../supabase/functions/atendimento-conectores/handler.mjs';
import { createHandler as criarReceptor, textoDe } from '../../supabase/functions/coexy-webhook/handler.mjs';

const TOKEN = 'tok_canal_segredo_123456';
const OFICIAL = {
  channel_id: 'ef36a5e8-c5b1-4e5e-98cc-93be36b425f6',
  status: 'active',
  phone_number_id: '877101502158610',
  waba_id: '1167313124901077',
  channel_token: TOKEN,
  reserva_auto: true
};

// ─── Cliente da Coexy ───────────────────────────────────────────────────────
test('classificar: o que pode ir para a reserva e o que não', () => {
  const c = (st, b) => classificar(st, b);
  assert.deepEqual(
    [c(400, { error: { code: 131047 } }).motivo, c(400, { error: { code: 131047 } }).reserva],
    ['fora_da_janela', true]
  );
  assert.equal(
    c(400, { error: { code: 133010 }, coexy: { code: 'PHONE_NOT_REGISTERED' } }).motivo,
    'numero_desconectado'
  );
  assert.equal(c(400, { error: { code: 141006 } }).motivo, 'pagamento_meta');
  assert.equal(
    c(400, { error: { code: 131026 } }).reserva,
    false,
    'número sem WhatsApp: a Evolution também falharia'
  );
  assert.equal(c(400, { error: { code: 132001 } }).motivo, 'modelo_invalido');
  assert.equal(c(400, { error: { code: 131049 } }).reserva, false, 'a Meta segurou marketing: não contorna');
  assert.equal(c(401, { error: 'Channel token expired', code: 'token_expired' }).motivo, 'token_canal');
  assert.equal(c(403, { error: 'Channel is not active' }).motivo, 'canal_inativo');
  assert.equal(c(403, { error: 'x', code: 'managed_by_coexy' }).reserva, false);
  assert.equal(c(429, {}).motivo, 'limite_meta');
  assert.equal(c(503, { error: 'CHANNEL_DISCONNECTED' }).motivo, 'canal_desconectado');
  assert.equal(c(400, { error: { code: 100, message: 'Invalid parameter' } }).detalhe, 'Invalid parameter');
});

test('normalizar canal: formato da API e do MCP, saúde com o motivo que bloqueia primeiro', () => {
  const c = normalizarCanal({
    id: OFICIAL.channel_id,
    status: 'active',
    phone_number: '+55 98 8446-6040',
    phone_number_id: '877101502158610',
    waba_id: '1167313124901077',
    channel_token: TOKEN,
    health: {
      state: 'blocked',
      issues: [
        { description: 'Nome ainda não aprovado', blocking: false },
        { description: 'Pagamento recusado na Meta', blocking: true }
      ]
    },
    messaging_limit_tier: 'TIER_250'
  });
  assert.equal(c.numero, '559884466040');
  assert.equal(c.saude, 'blocked');
  assert.match(c.saude_motivo, /^Pagamento recusado/);
  assert.equal(c.limite, 'TIER_250');
  assert.equal(normalizarCanal({ status: 'qualquer' }).status, 'pending');
});

test('modelo: variáveis, cabeçalho e o que dá para mandar daqui', () => {
  const ok = normalizarModelo({
    name: 'boas_vindas',
    language: 'pt_BR',
    status: 'APPROVED',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Olá!' },
      { type: 'BODY', text: 'Oi {{1}}, temos {{2}} novidades.' },
      { type: 'FOOTER', text: 'SIIMOB' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Quero' }] }
    ]
  });
  assert.equal(ok.variaveis, 2);
  assert.equal(ok.suportado, true);
  assert.equal(ok.cabecalho, 'Olá!');
  const midia = normalizarModelo({
    name: 'x',
    language: 'pt_BR',
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'a' }
    ]
  });
  assert.equal(midia.suportado, false);
  const nomeado = normalizarModelo({
    name: 'y',
    parameter_format: 'NAMED',
    components: [{ type: 'BODY', text: 'Oi {{nome}}' }]
  });
  assert.equal(nomeado.suportado, false);
  const pulado = normalizarModelo({ name: 'z', components: [{ type: 'BODY', text: 'Oi {{2}}' }] });
  assert.equal(pulado.suportado, false);
});

test('cliente: x-api-key só na API, Bearer do canal só no meta-proxy, idempotência e upload', async () => {
  const chamadas = [];
  const f = async (url, init) => {
    chamadas.push({ url, init });
    if (url.endsWith('/api/channels') && init.method === 'POST')
      return new Response(
        JSON.stringify({
          id: OFICIAL.channel_id,
          status: 'pending',
          channel_token: TOKEN,
          connect_url: 'https://coexy.com.br/connect/abc'
        }),
        { status: 201 }
      );
    if (url.endsWith('/media')) return new Response(JSON.stringify({ id: 'media-1' }));
    if (url.endsWith('/messages')) return new Response(JSON.stringify({ messages: [{ id: 'wamid.ABC' }] }));
    if (url.includes('/message_templates'))
      return new Response(
        JSON.stringify({
          data: [
            {
              name: 'boas_vindas',
              language: 'pt_BR',
              status: 'APPROVED',
              components: [{ type: 'BODY', text: 'Oi {{1}}' }]
            }
          ]
        })
      );
    return new Response('{}');
  };
  const c = criarCoexy({ chave: 'crt_pk_teste_000', fetch: f, base: 'https://api.test/fn' });
  const canal = await c.criarCanal('SIIMOB thecred');
  assert.equal(canal.connect_url, 'https://coexy.com.br/connect/abc');
  assert.equal(chamadas[0].init.headers['x-api-key'], 'crt_pk_teste_000');
  assert.equal(chamadas[0].init.headers.Authorization, undefined);

  assert.deepEqual(await c.enviarTexto(OFICIAL.phone_number_id, TOKEN, '5598981234567', 'Olá', 'k1'), {
    id: 'wamid.ABC'
  });
  const env = chamadas[1];
  assert.equal(env.url, `https://api.test/fn/meta-proxy/${OFICIAL.phone_number_id}/messages`);
  assert.equal(env.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(env.init.headers['x-api-key'], undefined, 'a chave da plataforma não vai para o meta-proxy');
  const b = JSON.parse(env.init.body);
  assert.deepEqual(
    [b.messaging_product, b.to, b.type, b.text.body, b.idempotency_key],
    ['whatsapp', '5598981234567', 'text', 'Olá', 'k1']
  );

  await c.enviarMidia(
    OFICIAL.phone_number_id,
    TOKEN,
    '5598981234567',
    { dados: 'JVBERg==', mime: 'application/pdf', nome: 'ficha.pdf' },
    'Segue'
  );
  assert.ok(chamadas[2].url.endsWith('/media') && chamadas[2].init.body instanceof FormData);
  const doc = JSON.parse(chamadas[3].init.body);
  assert.deepEqual(doc.document, { id: 'media-1', caption: 'Segue', filename: 'ficha.pdf' });

  await c.enviarMidia(
    OFICIAL.phone_number_id,
    TOKEN,
    '5598981234567',
    { url: 'https://x/img.png', mime: 'image/png', nome: 'a.png' },
    ''
  );
  assert.deepEqual(JSON.parse(chamadas[4].init.body).image, { link: 'https://x/img.png' });

  await c.enviarModelo(OFICIAL.phone_number_id, TOKEN, '5598981234567', 'boas_vindas', 'pt_BR', ['Ana']);
  const t = JSON.parse(chamadas[5].init.body).template;
  assert.deepEqual(t, {
    name: 'boas_vindas',
    language: { code: 'pt_BR' },
    components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }]
  });

  const modelos = await c.modelos(OFICIAL.waba_id, TOKEN);
  assert.equal(modelos[0].nome, 'boas_vindas');
  assert.ok(chamadas[6].url.includes(`/meta-proxy/${OFICIAL.waba_id}/message_templates`));

  await assert.rejects(() => c.enviarTexto(OFICIAL.phone_number_id, TOKEN, '12', 'x'), /numero_invalido/);
  await assert.rejects(
    () => c.enviarModelo(OFICIAL.phone_number_id, TOKEN, '5598981234567', '../x', 'pt_BR', []),
    /modelo_invalido/
  );
  assert.equal(criarCoexy({ chave: '', fetch: f }).configurado, false);
});

test('cliente: erro da Meta vira ErroCoexy com o motivo; sem rede vai para a reserva', async () => {
  const c = criarCoexy({
    chave: 'crt_pk_teste_000',
    fetch: async () =>
      new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), {
        status: 400
      })
  });
  await assert.rejects(
    () => c.enviarTexto(OFICIAL.phone_number_id, TOKEN, '5598981234567', 'oi'),
    e => e instanceof ErroCoexy && e.motivo === 'fora_da_janela' && e.reserva
  );
  const off = criarCoexy({
    chave: 'crt_pk_teste_000',
    fetch: async () => {
      throw new Error('rede');
    }
  });
  await assert.rejects(
    () => off.enviarTexto(OFICIAL.phone_number_id, TOKEN, '5598981234567', 'oi'),
    e => e instanceof ErroCoexy && e.motivo === 'sem_resposta' && e.reserva
  );
});

// ─── Rota: oficial primeiro, Evolution de reserva ───────────────────────────
function rota(over = {}) {
  const st = { of: [], evo: [], falhas: [], pausas: [] };
  const coexy = {
    configurado: true,
    async enviarTexto(...a) {
      st.of.push(['texto', ...a]);
      if (over.erroOficial) throw over.erroOficial;
      return { id: 'wamid.OF' };
    },
    async enviarMidia(...a) {
      st.of.push(['midia', ...a]);
      return { id: 'wamid.OFM' };
    },
    async enviarModelo(...a) {
      st.of.push(['modelo', ...a]);
      if (over.erroOficial) throw over.erroOficial;
      return { id: 'wamid.OFT' };
    },
    ...over.coexy
  };
  const evolution = {
    configurado: true,
    async enviarTexto(...a) {
      st.evo.push(['texto', ...a]);
      return { id: 'BAE5' };
    },
    async enviarMidia(...a) {
      st.evo.push(['midia', ...a]);
      return { id: 'BAE6' };
    }
  };
  const d = {
    coexy,
    evolution,
    oficial: 'oficial' in over ? over.oficial : OFICIAL,
    conexao: 'conexao' in over ? over.conexao : { estado: 'conectado', instancia: 'siimob-thecred' },
    uso: async () => over.uso || { primeira_conexao_em: '2026-01-01T00:00:00Z' },
    pausar: async (...a) => st.pausas.push(a),
    falha: async canal => st.falhas.push(canal),
    log: () => {}
  };
  return { d, st };
}
const P = {
  numero: '5598981234567',
  tipo: 'resposta',
  janela: true,
  texto: 'Olá',
  agora: Date.parse('2026-11-26T12:00:00Z')
};

test('rota: oficial ativo e janela aberta sai pelo oficial, sem contar nos limites da Evolution', async () => {
  const { d, st } = rota();
  const r = await enviarWhatsapp(d, P);
  assert.deepEqual([r.canal, r.id, r.reserva], ['oficial', 'wamid.OF', false]);
  assert.equal(st.evo.length, 0);
  assert.deepEqual(st.of[0].slice(0, 5), ['texto', OFICIAL.phone_number_id, TOKEN, '5598981234567', 'Olá']);
});

test('rota: fora da janela, texto livre vai pela reserva; com a reserva desligada, pede modelo', async () => {
  const { d, st } = rota();
  const r = await enviarWhatsapp(d, { ...P, janela: false, tipo: 'iniciado' });
  assert.deepEqual([r.canal, r.reserva, r.motivo_oficial], ['evolution', true, 'fora_da_janela']);
  assert.equal(st.of.length, 0);
  const sem = rota({ oficial: { ...OFICIAL, reserva_auto: false } });
  await assert.rejects(
    () => enviarWhatsapp(sem.d, { ...P, janela: false }),
    e => e instanceof ErroEnvio && e.codigo === 'fora_da_janela'
  );
  assert.equal(sem.st.evo.length, 0);
});

test('rota: modelo aprovado sai pelo oficial mesmo fora da janela', async () => {
  const { d, st } = rota();
  const modelo = { nome: 'boas_vindas', idioma: 'pt_BR', parametros: ['Ana'], texto: 'Oi Ana' };
  const r = await enviarWhatsapp(d, { ...P, janela: false, modelo });
  assert.equal(r.canal, 'oficial');
  assert.deepEqual(st.of[0].slice(0, 7), [
    'modelo',
    OFICIAL.phone_number_id,
    TOKEN,
    '5598981234567',
    'boas_vindas',
    'pt_BR',
    ['Ana']
  ]);
});

test('rota: oficial caiu (motivo de canal) vai para a reserva e registra a falha do oficial', async () => {
  const { d, st } = rota({ erroOficial: new ErroCoexy('canal_desconectado', 503, true) });
  const r = await enviarWhatsapp(d, P);
  assert.deepEqual([r.canal, r.reserva, r.motivo_oficial], ['evolution', true, 'canal_desconectado']);
  assert.deepEqual(st.falhas, ['oficial']);
  assert.deepEqual(st.evo[0], ['texto', 'siimob-thecred', '5598981234567', 'Olá', 1200]);
});

test('rota: modelo que caiu no oficial vai pela reserva com o texto preenchido', async () => {
  const { d, st } = rota({ erroOficial: new ErroCoexy('pagamento_meta', 400, true) });
  const r = await enviarWhatsapp(d, {
    ...P,
    janela: false,
    modelo: { nome: 'm', idioma: 'pt_BR', parametros: ['Ana'], texto: 'Oi Ana' }
  });
  assert.equal(r.canal, 'evolution');
  assert.equal(st.evo[0][3], 'Oi Ana');
});

test('rota: recusa que a Evolution também teria não vai para a reserva', async () => {
  const { d, st } = rota({ erroOficial: new ErroCoexy('nao_entregavel', 400, false) });
  await assert.rejects(
    () => enviarWhatsapp(d, P),
    e => e instanceof ErroEnvio && e.codigo === 'falha_oficial'
  );
  assert.equal(st.evo.length, 0);
});

test('rota: sem oficial a Evolution é o canal, com os limites; sem nada, desconectado', async () => {
  const { d } = rota({ oficial: null });
  assert.equal((await enviarWhatsapp(d, P)).canal, 'evolution');
  const pendente = rota({ oficial: { ...OFICIAL, status: 'pending', reserva_auto: false } });
  assert.equal(
    (await enviarWhatsapp(pendente.d, P)).canal,
    'evolution',
    'reserva desligada só vale com o oficial ativo'
  );
  const nada = rota({ oficial: null, conexao: null });
  await assert.rejects(
    () => enviarWhatsapp(nada.d, P),
    e => e.codigo === 'whatsapp_desconectado'
  );
  const limite = rota({ oficial: null, uso: { hora: 150, antigo_hora: '2026-11-26T11:30:00Z' } });
  await assert.rejects(
    () => enviarWhatsapp(limite.d, P),
    e => e.codigo === 'limite' && !!e.extra.volta_em
  );
  assert.equal(limite.st.pausas.length, 1);
});

test('rota: oficial ativo mas sem a chave da Coexy no servidor cai na Evolution', async () => {
  const { d } = rota({ coexy: { configurado: false } });
  assert.equal((await enviarWhatsapp(d, P)).canal, 'evolution');
});

// ─── Receptor dos avisos da Coexy ───────────────────────────────────────────
const SEGREDO = 'hmac-segredo-de-teste-000000';
const assinar = corpo => 'sha256=' + createHmac('sha256', SEGREDO).update(corpo).digest('hex');
const aviso = (body, assinatura) => {
  const corpo = JSON.stringify(body);
  return new Request('https://x/functions/v1/coexy-webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': assinatura ?? assinar(corpo),
      'webhook-id': 'w1'
    },
    body: corpo
  });
};
function receptor(over = {}) {
  const st = { recebidas: [], status: [], canais: [], saude: [], logs: [] };
  const h = criarReceptor({
    segredo: async () => ('segredo' in over ? over.segredo : SEGREDO),
    tenantDoNumero: async pnid => (pnid === OFICIAL.phone_number_id ? 'tenant-a' : null),
    receber: async m => {
      if (over.bancoFora) throw new Error('db');
      st.recebidas.push(m);
      return { ok: true };
    },
    status: async (...a) => st.status.push(a),
    canal: async (...a) => st.canais.push(a),
    saude: async (...a) => st.saude.push(a),
    log: m => st.logs.push(m)
  });
  return { h, st };
}
const meta = value => ({
  object: 'whatsapp_business_account',
  entry: [{ id: OFICIAL.waba_id, changes: [{ field: 'messages', value }] }]
});
const metadata = { display_phone_number: '559884466040', phone_number_id: OFICIAL.phone_number_id };

test('receptor: sem assinatura válida não entra nada; sem segredo guardado pede para tentar depois', async () => {
  const { h, st } = receptor();
  const body = meta({
    metadata,
    messages: [{ from: '5598981234567', id: 'wamid.A1', type: 'text', text: { body: 'oi' } }]
  });
  assert.equal((await h(aviso(body, 'sha256=' + '0'.repeat(64)))).status, 401);
  assert.equal((await h(aviso(body, ''))).status, 401);
  assert.equal(st.recebidas.length, 0);
  assert.equal((await receptor({ segredo: null }).h(aviso(body))).status, 503);
});

test('receptor: mensagem recebida com o nome do contato; eco do app entra como da empresa; status de entrega', async () => {
  const { h, st } = receptor();
  const r = await h(
    aviso(
      meta({
        metadata,
        contacts: [{ wa_id: '5598981234567', profile: { name: 'Joana' } }],
        messages: [
          { from: '5598981234567', id: 'wamid.A1', type: 'text', text: { body: 'Quero saber do Jardins' } },
          { from: '5598981234567', id: 'wamid.A2', type: 'reaction', reaction: { emoji: '👍' } },
          { from: '5598981234567', id: 'wamid.A3', type: 'image', image: { id: 'm1', caption: 'planta' } }
        ],
        statuses: [
          { id: 'wamid.ENV1', status: 'read', timestamp: '1764158400', recipient_id: '5598981234567' }
        ]
      })
    )
  );
  assert.equal(r.status, 200);
  assert.deepEqual(
    st.recebidas.map(m => [m.texto, m.nome, m.deMim]),
    [
      ['Quero saber do Jardins', 'Joana', false],
      ['[imagem] planta', 'Joana', false]
    ]
  );
  assert.deepEqual(st.status[0], ['tenant-a', 'wamid.ENV1', 'read', '2025-11-26T12:00:00.000Z']);
  await h(
    aviso({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'smb_message_echoes',
              value: {
                metadata,
                message_echoes: [
                  {
                    from: '559884466040',
                    to: '5598981234567',
                    id: 'wamid.E1',
                    type: 'text',
                    text: { body: 'Respondi pelo celular' }
                  }
                ]
              }
            }
          ]
        }
      ]
    })
  );
  assert.deepEqual([st.recebidas[2].numero, st.recebidas[2].deMim], ['5598981234567', true]);
});

test('receptor: status e saúde do canal (eventos da Coexy) e formato "coexy" sem envelope', async () => {
  const { h, st } = receptor();
  await h(
    aviso({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'channel_status_update',
              value: {
                event: 'channel_status_update',
                channel_id: OFICIAL.channel_id,
                status: 'active',
                phone_number_id: OFICIAL.phone_number_id,
                waba_id: OFICIAL.waba_id,
                display_phone_number: '+55 98 8446-6040'
              }
            }
          ]
        }
      ]
    })
  );
  assert.deepEqual(st.canais[0], [
    OFICIAL.channel_id,
    'active',
    OFICIAL.phone_number_id,
    OFICIAL.waba_id,
    '+55 98 8446-6040'
  ]);
  await h(
    aviso({
      event: 'channel_health_update',
      channel_id: OFICIAL.channel_id,
      health_state: 'blocked',
      issues: [{ description: 'Pagamento recusado' }],
      quality_rating: 'GREEN',
      messaging_limit_tier: 'TIER_250'
    })
  );
  assert.deepEqual(st.saude[0], [OFICIAL.channel_id, 'blocked', 'Pagamento recusado', 'GREEN', 'TIER_250']);
});

test('receptor: número de outro sistema é ignorado; banco fora devolve 500 para a Coexy tentar de novo', async () => {
  const { h, st } = receptor();
  const outro = meta({
    metadata: { phone_number_id: '999999999' },
    messages: [{ from: '5598981234567', id: 'wamid.X', type: 'text', text: { body: 'oi' } }]
  });
  assert.equal((await h(aviso(outro))).status, 200);
  assert.equal(st.recebidas.length, 0);
  assert.ok(st.logs.some(l => /sem cliente/.test(l)));
  assert.ok(!st.logs.join(' ').includes('5598981234567'), 'log sem telefone');
  const fora = receptor({ bancoFora: true });
  const body = meta({
    metadata,
    messages: [{ from: '5598981234567', id: 'wamid.A1', type: 'text', text: { body: 'oi' } }]
  });
  assert.equal((await fora.h(aviso(body))).status, 500);
});

test('receptor: texto de botão, lista, documento e localização', () => {
  assert.equal(textoDe({ type: 'button', button: { text: 'Quero visitar' } }), 'Quero visitar');
  assert.equal(
    textoDe({ type: 'interactive', interactive: { list_reply: { title: '2 quartos' } } }),
    '2 quartos'
  );
  assert.equal(textoDe({ type: 'document', document: { filename: 'rg.pdf' } }), '[documento] rg.pdf');
  assert.equal(textoDe({ type: 'location', location: { name: 'Stand' } }), '[localização] Stand');
  assert.equal(textoDe({ type: 'unsupported' }), null);
});

// ─── Integrações e Central (handler) ────────────────────────────────────────
const origin = 'https://siimob.com';
const AT = '11111111-2222-3333-4444-555555555555';
const req = (action, extra = {}, token = 'tk-gestor') =>
  new Request('https://api.example/', {
    method: 'POST',
    headers: { origin, 'x-session-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...extra })
  });
const MODELOS = [
  {
    nome: 'boas_vindas',
    idioma: 'pt_BR',
    categoria: 'MARKETING',
    status: 'APPROVED',
    corpo: 'Oi {{1}}, tudo bem?',
    cabecalho: null,
    rodape: 'SIIMOB',
    variaveis: 1,
    suportado: true
  },
  {
    nome: 'em_revisao',
    idioma: 'pt_BR',
    categoria: 'UTILITY',
    status: 'PENDING',
    corpo: 'x',
    cabecalho: null,
    rodape: null,
    variaveis: 0,
    suportado: true
  }
];

function central(over = {}) {
  const st = {
    oficial: null,
    webhook: null,
    wa: null,
    envios: [],
    falhas: [],
    eventos: [],
    coexy: [],
    leadEscreveu: true,
    ...over.st
  };
  const coexy = {
    configurado: true,
    async webhooks() {
      st.coexy.push(['webhooks']);
      return over.webhooks || [];
    },
    async apagarWebhook(id) {
      st.coexy.push(['apagarWebhook', id]);
    },
    async criarWebhook(url, eventos) {
      st.coexy.push(['criarWebhook', url, eventos]);
      return { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', hmac_secret: 'segredo-hmac-1234567890' };
    },
    async criarCanal(nome) {
      st.coexy.push(['criarCanal', nome]);
      return {
        id: OFICIAL.channel_id,
        status: 'pending',
        channel_token: TOKEN,
        connect_url: 'https://coexy.com.br/connect/abc'
      };
    },
    async canal() {
      return { status: 'pending', connect_url: 'https://coexy.com.br/connect/abc', channel_token: TOKEN };
    },
    async apagarCanal(id) {
      st.coexy.push(['apagarCanal', id]);
    },
    async modelos() {
      return MODELOS;
    },
    async enviarTexto(...a) {
      st.coexy.push(['texto', ...a]);
      return { id: 'wamid.OF1' };
    },
    async enviarModelo(...a) {
      st.coexy.push(['modelo', ...a]);
      return { id: 'wamid.OFT' };
    },
    async criarModelo(...a) {
      st.coexy.push(['criarModelo', ...a]);
      return { status: 'PENDING' };
    },
    ...over.coexy
  };
  const h = createHandler({
    coexy,
    evolution: {
      configurado: true,
      async enviarTexto() {
        return { id: 'BAE' };
      }
    },
    log: () => {},
    context: async t =>
      ({
        'tk-gestor': { tenant_id: 'tenant-a', user_id: 'u1', slug: 'thecred', gestor: true },
        'tk-ana': { tenant_id: 'tenant-a', user_id: 'u2', slug: 'thecred', gestor: false }
      })[t] || null,
    iaLer: async () => null,
    waLer: async () => st.wa,
    waOpcoes: async (t, c) => {
      st.wa.criar_leads = c;
    },
    waUso: async () => ({}),
    waPausar: async () => {},
    alvo: async (token, at) => ({
      tenant_id: 'tenant-a',
      atendimento_id: at,
      telefone: '5598981234567',
      autor: 'Gestor',
      lead_escreveu_24h: st.leadEscreveu
    }),
    registrarEnvio: async (...a) => {
      st.envios.push(a);
      return { ok: true, id: 'msg-1' };
    },
    registrarFalha: async (...a) => st.falhas.push(a),
    coexyWebhookUrl: 'https://proj.supabase.co/functions/v1/coexy-webhook',
    coexyWebhookLer: async () => st.webhook,
    coexyWebhookSalvar: async v => {
      st.webhook = v;
    },
    oficialLer: async () => st.oficial,
    oficialCriar: async row => {
      st.oficial = { ...row, reserva_auto: true, criar_leads: true };
    },
    oficialAtualizar: async (t, patch) => Object.assign(st.oficial, patch),
    oficialApagar: async () => {
      st.oficial = null;
    },
    oficialEvento: async (...a) => st.eventos.push(a),
    oficialSaude: async () => {},
    now: () => Date.parse('2026-11-26T12:00:00Z')
  });
  return { h, st };
}

test('conectar o oficial: cria o webhook (segredo só no banco) e o canal; a tela recebe o link, nunca o token', async () => {
  const { h, st } = central();
  const res = await h(req('oficial_conectar'));
  const r = await res.json();
  assert.equal(r.ok, true);
  assert.equal(r.oficial.estado, 'pending');
  assert.equal(r.oficial.connect_url, 'https://coexy.com.br/connect/abc');
  const txt = JSON.stringify(r);
  assert.ok(
    !txt.includes(TOKEN) && !txt.includes('segredo-hmac'),
    'nem token do canal nem segredo do webhook vão para a tela'
  );
  assert.deepEqual(
    st.coexy.find(c => c[0] === 'criarWebhook'),
    ['criarWebhook', 'https://proj.supabase.co/functions/v1/coexy-webhook', EVENTOS_COEXY]
  );
  assert.equal(st.webhook.hmac_secret, 'segredo-hmac-1234567890');
  assert.deepEqual(
    st.coexy.find(c => c[0] === 'criarCanal'),
    ['criarCanal', 'SIIMOB thecred']
  );
  // de novo: não cria outro canal nem outro webhook
  await h(req('oficial_conectar'));
  assert.equal(st.coexy.filter(c => c[0] === 'criarCanal').length, 1);
  assert.equal(st.coexy.filter(c => c[0] === 'criarWebhook').length, 1);
});

test('webhook nosso sem segredo guardado é trocado por um novo', async () => {
  const { h, st } = central({
    webhooks: [
      { id: 'w-velho', url: 'https://proj.supabase.co/functions/v1/coexy-webhook' },
      { id: 'w-outro', url: 'https://outro.app/hook' }
    ]
  });
  await h(req('oficial_conectar'));
  assert.deepEqual(
    st.coexy.filter(c => c[0] === 'apagarWebhook'),
    [['apagarWebhook', 'w-velho']]
  );
});

test('oficial: só o gestor conecta, remove e muda opções; sem a chave da Coexy avisa', async () => {
  const { h, st } = central();
  assert.equal((await h(req('oficial_conectar', {}, 'tk-ana'))).status, 403);
  assert.equal((await h(req('oficial_opcoes', { reserva_auto: false }, 'tk-ana'))).status, 403);
  const sem = central({ coexy: { configurado: false } });
  assert.equal((await (await sem.h(req('oficial_conectar'))).json()).error, 'coexy_nao_configurado');
  await h(req('oficial_conectar'));
  st.wa = { instancia: 'siimob-thecred', estado: 'conectado', criar_leads: true };
  const op = await (await h(req('oficial_opcoes', { reserva_auto: false, criar_leads: false }))).json();
  assert.deepEqual([op.oficial.reserva_auto, op.oficial.criar_leads], [false, false]);
  assert.equal(st.wa.criar_leads, false, '"criar leads" vale para a reserva também');
  assert.equal((await h(req('oficial_opcoes', { reserva_auto: 'sim' }))).status, 400);
  const rm = await (await h(req('oficial_remover'))).json();
  assert.equal(rm.oficial.estado, 'nao_criado');
  assert.deepEqual(
    st.coexy.find(c => c[0] === 'apagarCanal'),
    ['apagarCanal', OFICIAL.channel_id]
  );
});

test('status mostra o oficial ativo sem token e sem link de conexão', async () => {
  const { h } = central({
    st: {
      oficial: {
        ...OFICIAL,
        numero: '559884466040',
        saude: 'blocked',
        saude_motivo: 'Pagamento recusado',
        connect_url: 'https://c/x'
      }
    }
  });
  const r = await (await h(req('status'))).json();
  assert.equal(r.oficial.estado, 'active');
  assert.equal(r.oficial.connect_url, null);
  assert.equal(r.oficial.saude_motivo, 'Pagamento recusado');
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});

test('Central: com o oficial ativo a resposta sai pelo oficial e grava o canal', async () => {
  const { h, st } = central({ st: { oficial: { ...OFICIAL } } });
  const r = await (await h(req('wa_enviar', { atendimento_id: AT, texto: 'Olá Joana' }))).json();
  assert.deepEqual([r.ok, r.canal, r.reserva], [true, 'oficial', false]);
  assert.deepEqual(st.envios[0], ['tenant-a', AT, 'Olá Joana', 'Gestor', 'wamid.OF1', 'resposta', 'oficial']);
});

test('Central: fora da janela sem reserva pede modelo (409)', async () => {
  const { h } = central({ st: { oficial: { ...OFICIAL, reserva_auto: false }, leadEscreveu: false } });
  const res = await h(req('wa_enviar', { atendimento_id: AT, texto: 'Olá' }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'fora_da_janela');
});

test('Central: modelo aprovado, com as variáveis certas, grava o texto preenchido', async () => {
  const { h, st } = central({ st: { oficial: { ...OFICIAL }, leadEscreveu: false } });
  const ok = await (
    await h(
      req('wa_modelo', {
        atendimento_id: AT,
        modelo: { nome: 'boas_vindas', idioma: 'pt_BR' },
        parametros: ['Joana']
      })
    )
  ).json();
  assert.deepEqual([ok.ok, ok.canal, ok.tipo], [true, 'oficial', 'iniciado']);
  assert.deepEqual(st.envios[0].slice(2, 7), [
    'Oi Joana, tudo bem?\nSIIMOB',
    'Gestor',
    'wamid.OFT',
    'iniciado',
    'oficial'
  ]);
  assert.equal(
    (
      await h(
        req('wa_modelo', {
          atendimento_id: AT,
          modelo: { nome: 'boas_vindas', idioma: 'pt_BR' },
          parametros: []
        })
      )
    ).status,
    400
  );
  assert.equal(
    (
      await (
        await h(
          req('wa_modelo', {
            atendimento_id: AT,
            modelo: { nome: 'em_revisao', idioma: 'pt_BR' },
            parametros: []
          })
        )
      ).json()
    ).error,
    'modelo_indisponivel'
  );
  assert.equal(
    (
      await h(
        req('wa_modelo', {
          atendimento_id: AT,
          modelo: { nome: 'boas_vindas', idioma: 'pt_BR' },
          parametros: ['a\nb']
        })
      )
    ).status,
    400,
    'a Meta recusa quebra de linha em variável'
  );
});

test('modelos: o corretor vê só os aprovados; o gestor vê todos e cria com validação', async () => {
  const { h, st } = central({ st: { oficial: { ...OFICIAL } } });
  assert.deepEqual(
    (await (await h(req('wa_modelos', {}, 'tk-ana'))).json()).modelos.map(m => m.nome),
    ['boas_vindas']
  );
  assert.equal((await (await h(req('wa_modelos'))).json()).modelos.length, 2);
  const base = {
    nome: 'novidade_semana',
    categoria: 'MARKETING',
    idioma: 'pt_BR',
    corpo: 'Oi {{1}}, temos {{2}}.',
    exemplos: ['Ana', 'casas']
  };
  assert.equal((await (await h(req('modelo_criar', base))).json()).status, 'PENDING');
  assert.equal(st.coexy.find(c => c[0] === 'criarModelo')[1], OFICIAL.waba_id);
  assert.equal(
    (await h(req('modelo_criar', { ...base, exemplos: ['Ana'] }))).status,
    400,
    'um exemplo por variável'
  );
  assert.equal((await h(req('modelo_criar', { ...base, nome: 'Com Espaço' }))).status, 400);
  assert.equal((await h(req('modelo_criar', { ...base, categoria: 'AUTHENTICATION' }))).status, 400);
  assert.equal(
    (await h(req('modelo_criar', { ...base, corpo: 'Oi {{2}}', exemplos: ['x'] }))).status,
    400,
    'variáveis em sequência'
  );
  assert.equal((await h(req('modelo_criar', base, 'tk-ana'))).status, 403);
  const off = central();
  assert.deepEqual((await (await off.h(req('wa_modelos'))).json()).modelos, []);
});
