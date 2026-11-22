// Avisos da Evolution (supabase/functions/whatsapp-webhook/handler.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, textoDe, numeroDe } from '../../supabase/functions/whatsapp-webhook/handler.mjs';

const TK = 'a'.repeat(64);
const req = (body, { i = 'siimob-thecred', t = TK, metodo = 'POST' } = {}) =>
  new Request(`https://x.supabase.co/functions/v1/whatsapp-webhook?i=${i}&t=${t}`, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: metodo === 'POST' ? JSON.stringify(body) : undefined
  });
const msg = (extra = {}, key = {}) => ({
  event: 'messages.upsert',
  instance: 'siimob-thecred',
  data: {
    key: { remoteJid: '5598981234567@s.whatsapp.net', fromMe: false, id: 'ABCDEF123456', ...key },
    pushName: 'Joana',
    message: { conversation: 'Oi, quero saber do Jardins' },
    ...extra
  }
});

function montar() {
  const recebidas = [];
  const estados = [];
  const logs = [];
  const h = createHandler({
    tenantDo: async (i, t) => (i === 'siimob-thecred' && t === TK ? 'tenant-a' : null),
    receber: async m => {
      recebidas.push(m);
      return { ok: true };
    },
    estado: async (...a) => estados.push(a),
    log: m => logs.push(m)
  });
  return { h, recebidas, estados, logs };
}

test('sem token certo, nada entra', async () => {
  const { h, recebidas } = montar();
  assert.equal((await h(req(msg(), { t: 'b'.repeat(64) }))).status, 401);
  assert.equal((await h(req(msg(), { t: 'curto' }))).status, 401);
  assert.equal((await h(req(msg(), { i: 'OUTRA instancia' }))).status, 401);
  assert.equal((await h(req(msg(), { metodo: 'GET' }))).status, 405);
  assert.equal(
    (await h(req({ ...msg(), instance: 'siimob-outra' }))).status,
    401,
    'corpo de outra instância'
  );
  assert.equal(recebidas.length, 0);
});

test('mensagem recebida entra com número, nome, texto e id; o log não leva o texto', async () => {
  const { h, recebidas, logs } = montar();
  const r = await h(req(msg()));
  assert.equal(r.status, 200);
  assert.deepEqual(recebidas, [
    {
      tenant: 'tenant-a',
      numero: '5598981234567',
      nome: 'Joana',
      texto: 'Oi, quero saber do Jardins',
      externo: 'ABCDEF123456',
      deMim: false
    }
  ]);
  assert.ok(!logs.join(' ').includes('Jardins') && !logs.join(' ').includes('98981234567'));
});

test('enviada pelo celular da empresa entra como "de mim" e sem nome', async () => {
  const { h, recebidas } = montar();
  await h(req(msg({}, { fromMe: true })));
  assert.equal(recebidas[0].deMim, true);
  assert.equal(recebidas[0].nome, null);
});

test('grupo, status, canal e reação são ignorados', async () => {
  const { h, recebidas } = montar();
  await h(req(msg({}, { remoteJid: '1203630@g.us' })));
  await h(req(msg({}, { remoteJid: 'status@broadcast' })));
  await h(req(msg({}, { remoteJid: '1203@newsletter' })));
  await h(req(msg({ message: { reactionMessage: { text: '👍' } } })));
  assert.equal(recebidas.length, 0);
});

test('LID: usa o número alternativo quando vem; sem número, não entra', async () => {
  const { h, recebidas } = montar();
  await h(req(msg({}, { remoteJid: '123456789@lid', senderPn: '5598977771111@s.whatsapp.net' })));
  await h(req(msg({}, { remoteJid: '123456789@lid' })));
  assert.equal(recebidas.length, 1);
  assert.equal(recebidas[0].numero, '5598977771111');
  assert.equal(numeroDe({ remoteJid: '5598981234567:12@s.whatsapp.net' }), '5598981234567');
});

test('mídia vira marcador legível', () => {
  assert.equal(textoDe({ imageMessage: { caption: 'planta' } }), '[imagem] planta');
  assert.equal(textoDe({ audioMessage: {} }), '[áudio]');
  assert.equal(textoDe({ documentMessage: { fileName: 'rg.pdf' } }), '[documento] rg.pdf');
  assert.equal(textoDe({ extendedTextMessage: { text: 'oi' } }), 'oi');
  assert.equal(textoDe({ ephemeralMessage: { message: { conversation: 'some' } } }), 'some');
  assert.equal(textoDe({ protocolMessage: {} }), null);
});

test('conexão aberta grava conectado com o número; QR novo volta para aguardando', async () => {
  const { h, estados } = montar();
  await h(
    req({
      event: 'connection.update',
      instance: 'siimob-thecred',
      data: { state: 'open', wuid: '5598900001111@s.whatsapp.net', profileName: 'The Cred' }
    })
  );
  await h(req({ event: 'CONNECTION_UPDATE', data: { state: 'close' } }));
  await h(req({ event: 'qrcode.updated', data: { qrcode: { base64: 'x' } } }));
  assert.deepEqual(estados, [
    ['tenant-a', 'conectado', '5598900001111', 'The Cred'],
    ['tenant-a', 'desconectado', null, null],
    ['tenant-a', 'aguardando_qr', null, null]
  ]);
});

test('falha no banco devolve 500 (a Evolution tenta de novo)', async () => {
  const h = createHandler({
    tenantDo: async () => 'tenant-a',
    receber: async () => {
      throw new Error('db');
    },
    estado: async () => {}
  });
  assert.equal((await h(req(msg()))).status, 500);
});
