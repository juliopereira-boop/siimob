// Limites anti-bloqueio do WhatsApp (supabase/functions/atendimento-conectores/limites.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avaliar,
  faseAquecimento,
  intervaloCampanha,
  AQUECIMENTO,
  TETOS
} from '../../supabase/functions/atendimento-conectores/limites.mjs';

const AGORA = Date.parse('2026-11-22T12:00:00Z');
const DIA = 86400000;
const dias = n => new Date(AGORA - n * DIA).toISOString();

test('aquecimento: número novo começa no teto mais baixo e sobe com os dias', () => {
  assert.equal(faseAquecimento(null, AGORA).porDia, AQUECIMENTO[0].porDia);
  assert.equal(faseAquecimento(dias(0), AGORA).dias, 1);
  assert.equal(faseAquecimento(dias(5), AGORA).porDia, 40);
  assert.equal(faseAquecimento(dias(10), AGORA).porDia, 80);
  assert.equal(faseAquecimento(dias(20), AGORA).porDia, 150);
  assert.equal(faseAquecimento(dias(90), AGORA).porDia, 250);
  assert.equal(faseAquecimento(dias(90), AGORA).ateDias, null);
});

test('disparo frio para no teto do dia da fase; resposta a quem escreveu continua', () => {
  const uso = {
    primeira_conexao_em: dias(1),
    dia: 20,
    dia_frio: 20,
    hora: 3,
    hora_frio: 3,
    antigo_dia_frio: dias(0.5)
  };
  const c = avaliar({ uso, tipo: 'campanha', agora: AGORA });
  assert.equal(c.pode, false);
  assert.equal(c.motivo, 'limite_de_disparos_do_dia');
  assert.equal(c.pausarGeral, false);
  // a vaga abre 24 h depois do mais antigo
  assert.equal(c.esperarAte, new Date(AGORA - 0.5 * DIA + DIA).toISOString());
  const r = avaliar({ uso, tipo: 'resposta', agora: AGORA });
  assert.equal(r.pode, true);
});

test('teto da hora de disparo e ritmo por minuto', () => {
  const base = { primeira_conexao_em: dias(60) };
  const h = avaliar({
    uso: { ...base, hora_frio: 40, hora: 40, dia: 40, dia_frio: 40 },
    tipo: 'iniciado',
    agora: AGORA
  });
  assert.equal(h.motivo, 'limite_de_disparos_da_hora');
  const m = avaliar({
    uso: { ...base, minuto: TETOS.porMinuto, antigo_minuto: new Date(AGORA - 30000).toISOString() },
    tipo: 'resposta',
    agora: AGORA
  });
  assert.equal(m.pode, false);
  assert.equal(m.motivo, 'ritmo');
  assert.equal(m.esperarAte, new Date(AGORA + 30000).toISOString());
});

test('tetos gerais e falhas seguidas pedem pausa geral (a tela avisa)', () => {
  const d = avaliar({ uso: { dia: TETOS.porDia, antigo_dia: dias(0.9) }, tipo: 'resposta', agora: AGORA });
  assert.equal(d.motivo, 'limite_do_dia');
  assert.equal(d.pausarGeral, true);
  const h = avaliar({ uso: { hora: TETOS.porHora }, tipo: 'resposta', agora: AGORA });
  assert.equal(h.motivo, 'limite_da_hora');
  assert.equal(h.pausarGeral, true);
  const f = avaliar({ uso: { falhas_hora: TETOS.falhasPorHora }, tipo: 'resposta', agora: AGORA });
  assert.equal(f.motivo, 'falhas_seguidas');
  assert.equal(f.esperarAte, new Date(AGORA + 3600000).toISOString());
});

test('pausa gravada segura tudo até a hora; depois, volta sozinha', () => {
  const ate = new Date(AGORA + 600000).toISOString();
  const p = avaliar({
    uso: { pausado_ate: ate, pausa_motivo: 'limite_da_hora' },
    tipo: 'resposta',
    agora: AGORA
  });
  assert.equal(p.pode, false);
  assert.equal(p.esperarAte, ate);
  assert.equal(p.pausarGeral, false, 'não regrava a pausa');
  const depois = avaliar({ uso: { pausado_ate: ate }, tipo: 'resposta', agora: AGORA + 700000 });
  assert.equal(depois.pode, true);
});

test('alerta a partir de 80% do teto, sem bloquear', () => {
  const a = avaliar({
    uso: { primeira_conexao_em: dias(1), dia_frio: 16, dia: 16 },
    tipo: 'campanha',
    agora: AGORA
  });
  assert.equal(a.pode, true);
  assert.equal(a.alerta, true);
  assert.equal(a.restanteFrioHoje, 4);
  const b = avaliar({
    uso: { primeira_conexao_em: dias(1), dia_frio: 2, dia: 2 },
    tipo: 'campanha',
    agora: AGORA
  });
  assert.equal(b.alerta, false);
});

test('intervalo de campanha: 20 a 60 s, com pausa longa a cada 20', () => {
  assert.equal(
    intervaloCampanha(1, () => 0),
    20
  );
  assert.equal(
    intervaloCampanha(1, () => 1),
    60
  );
  assert.equal(
    intervaloCampanha(20, () => 0),
    20 + 300
  );
  assert.equal(
    intervaloCampanha(40, () => 1),
    60 + 900
  );
  assert.equal(
    intervaloCampanha(0, () => 0),
    20
  );
});
