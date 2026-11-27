// fin-lembretes: lembrete de parcela pelo WhatsApp (oficial com reserva).
//   supabase/functions/fin-lembretes/handler.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHandler,
  montar,
  brl,
  dataBr,
  telefone
} from '../../supabase/functions/fin-lembretes/handler.mjs';
import { ErroCoexy } from '../../supabase/functions/atendimento-conectores/coexy.mjs';

const CODIGO = 'a'.repeat(48);
const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';
const MODELO = {
  nome: 'lembrete_parcela',
  idioma: 'pt_BR',
  corpo: 'Olá {{1}}, sua parcela de {{2}} vence em {{3}} ({{4}}).'
};
const OFICIAL = {
  status: 'active',
  phone_number_id: '877101502158610',
  channel_token: 'tok_canal_segredo_123456',
  reserva_auto: true
};
const linha = (o = {}) => ({
  tenant_id: T1,
  parcela_id: 'p-' + Math.random().toString(16).slice(2),
  gatilho: 'D-3',
  telefone: '98981234567',
  cliente_nome: 'Ana Souza',
  empreendimento: 'Residencial Sol',
  unidade: 'A-101',
  vencimento: '2026-11-29',
  total: 1234.5,
  modelo: MODELO,
  ...o
});

function cenario(over = {}) {
  const st = { of: [], evo: [], reg: [], ok: [], falhas: [], codigos: [] };
  const coexy = {
    configurado: true,
    async enviarModelo(...a) {
      st.of.push(a);
      if (over.erroOficial) throw over.erroOficial;
      return { id: 'wamid.L' + st.of.length };
    },
    async enviarTexto(...a) {
      st.of.push(a);
      return { id: 'wamid.T' };
    }
  };
  const evolution = {
    configurado: true,
    async enviarTexto(...a) {
      st.evo.push(a);
      return { id: 'BAE' + st.evo.length };
    }
  };
  let t = 0;
  const d = {
    coexy,
    evolution,
    codigoValido: async c => {
      st.codigos.push(c);
      return over.codigoValido !== false;
    },
    devidos: async () => over.lista || [linha()],
    oficialLer: async tn => (over.oficial ? over.oficial(tn) : OFICIAL),
    waLer: async tn => (over.conexao ? over.conexao(tn) : { estado: 'conectado', instancia: 'siimob-x' }),
    uso: async () => over.uso || { primeira_conexao_em: '2026-01-01T00:00:00Z' },
    pausar: async () => {},
    falha: async (tn, canal) => st.falhas.push([tn, canal]),
    envioOk: async (...a) => st.ok.push(a),
    registrar: async (...a) => st.reg.push(a),
    now: over.now || (() => Date.parse('2026-11-26T12:13:00Z') + (t += 10)),
    prazo: over.prazo,
    log: () => {}
  };
  return { h: createHandler(d), st };
}
const pedir = (h, codigo = CODIGO, metodo = 'POST') =>
  h(
    new Request('https://x/functions/v1/fin-lembretes', {
      method: metodo,
      headers: { 'x-fin-codigo': codigo }
    })
  );

test('formatos: dinheiro, data e telefone', () => {
  assert.equal(brl(1234.5), 'R$ 1.234,50');
  assert.equal(brl(1234567.891), 'R$ 1.234.567,89');
  assert.equal(brl(0), 'R$ 0,00');
  assert.equal(dataBr('2026-11-29'), '29/11/2026');
  assert.equal(telefone('(98) 98123-4567'), '5598981234567');
  assert.equal(telefone('5598981234567'), '5598981234567');
  assert.equal(telefone('123'), null);
});

test('montar: parâmetros na ordem, só os que o modelo usa, e o texto preenchido', () => {
  const m = montar(linha());
  assert.deepEqual(m.modelo.parametros, [
    'Ana Souza',
    'R$ 1.234,50',
    '29/11/2026',
    'Residencial Sol · A-101'
  ]);
  assert.equal(
    m.texto,
    'Olá Ana Souza, sua parcela de R$ 1.234,50 vence em 29/11/2026 (Residencial Sol · A-101).'
  );
  const dois = montar(linha({ modelo: { ...MODELO, corpo: 'Oi {{1}}, valor {{2}}.' } }));
  assert.deepEqual(dois.modelo.parametros, ['Ana Souza', 'R$ 1.234,50'], 'a Meta recusa parâmetro a mais');
  assert.equal(montar(linha({ modelo: null })), null);
  assert.equal(montar(linha({ modelo: { nome: '../x', idioma: 'pt_BR', corpo: 'Oi {{1}}' } })).modelo, null);
});

test('sem código, código errado ou outro método: 401/405, e nada sai', async () => {
  const a = cenario();
  assert.equal((await pedir(a.h, '')).status, 401);
  assert.equal((await pedir(a.h, 'curto')).status, 401);
  assert.deepEqual(a.st.codigos, [], 'código mal formado nem chega ao banco');
  assert.equal((await pedir(a.h, CODIGO, 'GET')).status, 405);
  const b = cenario({ codigoValido: false });
  assert.equal((await pedir(b.h)).status, 401);
  assert.equal(b.st.of.length + b.st.evo.length + b.st.reg.length, 0);
});

test('oficial ativo: sai o modelo aprovado e fica registrado', async () => {
  const { h, st } = cenario();
  const r = await (await pedir(h)).json();
  assert.deepEqual([r.devidos, r.enviados, r.falhas], [1, 1, 0]);
  assert.deepEqual(st.of[0].slice(0, 6), [
    OFICIAL.phone_number_id,
    OFICIAL.channel_token,
    '5598981234567',
    'lembrete_parcela',
    'pt_BR',
    ['Ana Souza', 'R$ 1.234,50', '29/11/2026', 'Residencial Sol · A-101']
  ]);
  assert.equal(st.evo.length, 0);
  assert.deepEqual(st.reg[0].slice(2), ['D-3', 'oficial', true, null]);
  assert.deepEqual(st.ok[0], [T1, 'oficial', 'wamid.L1']);
});

test('sem oficial: vai o texto pela Evolution', async () => {
  const { h, st } = cenario({ oficial: () => null });
  const r = await (await pedir(h)).json();
  assert.equal(r.enviados, 1);
  assert.equal(st.of.length, 0);
  assert.equal(st.evo[0][1], '5598981234567');
  assert.match(st.evo[0][2], /^Olá Ana Souza, sua parcela de R\$ 1\.234,50/);
  assert.deepEqual(st.reg[0].slice(3, 5), ['evolution', true]);
});

test('oficial caiu: reserva na Evolution, e o registro diz que foi reserva', async () => {
  const { h, st } = cenario({ erroOficial: new ErroCoexy('canal_desconectado', 503, true) });
  await pedir(h);
  assert.equal(st.evo.length, 1);
  assert.deepEqual(st.reg[0].slice(3), ['evolution', true, 'reserva: canal_desconectado']);
  assert.deepEqual(st.falhas, [[T1, 'oficial']]);
});

test('recusa que a reserva não resolve (número sem WhatsApp): falha registrada, não repete', async () => {
  const { h, st } = cenario({ erroOficial: new ErroCoexy('numero_invalido', 400, false) });
  const r = await (await pedir(h)).json();
  assert.equal(r.falhas, 1);
  assert.equal(st.evo.length, 0);
  assert.deepEqual(st.reg[0].slice(3, 5), [null, false]);
  assert.match(st.reg[0][5], /^falha_oficial/);
});

test('sem telefone ou sem modelo: falha registrada sem tentar enviar', async () => {
  const { h, st } = cenario({ lista: [linha({ telefone: null }), linha({ modelo: null })] });
  const r = await (await pedir(h)).json();
  assert.equal(r.falhas, 2);
  assert.deepEqual(
    st.reg.map(x => x[5]),
    ['sem_telefone', 'sem_modelo']
  );
  assert.equal(st.of.length + st.evo.length, 0);
});

test('cliente sem WhatsApp nenhum: segura o resto dele sem registrar (tenta na próxima rodada), e o outro cliente segue', async () => {
  const { h, st } = cenario({
    lista: [linha(), linha(), linha({ tenant_id: T2 })],
    oficial: tn => (tn === T1 ? null : OFICIAL),
    conexao: tn => (tn === T1 ? null : { estado: 'conectado', instancia: 'x' })
  });
  const r = await (await pedir(h)).json();
  assert.deepEqual([r.enviados, r.pulados, r.falhas], [1, 2, 0]);
  assert.equal(st.reg.length, 1);
  assert.equal(st.reg[0][0], T2);
});

test('passou do prazo da rodada: para, não registra o que sobrou', async () => {
  let t = 0;
  const { h, st } = cenario({
    lista: [linha(), linha(), linha()],
    now: () => (t += 60000),
    prazo: 100000
  });
  const r = await (await pedir(h)).json();
  assert.ok(r.sobra >= 1);
  assert.equal(st.reg.length, r.enviados);
});
