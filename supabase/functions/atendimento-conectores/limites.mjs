// ─── Limites de envio do WhatsApp (Evolution / Baileys) ──────────────────────
//
// O PEDIDO DO DONO
//   "preciso que conheça os limites de envio de mensagem, para que não
//    percamos o número do cliente, então se você verificar que está chegando no
//    limite, pause, mostre um aviso, e continue quando der (...) principalmente
//    no uso das campanhas."
//
// O QUE SE SABE (pesquisa de 21/11/2026)
//   O WhatsApp NÃO publica limite para conexão não oficial (Baileys, que é o
//   que a Evolution usa). Todo número abaixo é heurística da comunidade, e
//   nenhum deles garante que o número não será bloqueado. O que as fontes
//   repetem:
//   - número novo precisa "aquecer": começar com 10 a 30 conversas iniciadas
//     por dia e subir aos poucos ao longo de semanas;
//   - número aquecido: algo entre 80 e 200 disparos frios por dia;
//   - ritmo: no máximo ~8 por minuto, com intervalo aleatório; em disparo,
//     20 a 60 s entre mensagens e pausas longas a cada lote;
//   - responder quem escreveu é muito menos arriscado que iniciar conversa;
//   - mensagem idêntica para muita gente, IP de datacenter e lista fria são os
//     maiores gatilhos de bloqueio.
//   Por isso os tetos aqui são conservadores e separam RESPOSTA (o lead
//   escreveu nas últimas 24 h) de FRIO (conversa iniciada por nós e campanha).
//
// COMO USAR
//   avaliar({ uso, tipo, agora }) -> { pode, motivo, esperarAte, pausarGeral, alerta, ... }
//   `uso` é o JSON de a1_wa_uso(tenant). Se `pode` for false, quem chamou não
//   envia; se `pausarGeral`, grava a pausa (a1_wa_pausar) para a tela avisar.
//   Quando a hora passa, o envio volta sozinho.

export const TETOS = Object.freeze({
  porMinuto: 8, // qualquer mensagem
  porHora: 150, // qualquer mensagem
  porDia: 800, // qualquer mensagem, inclusive respostas
  falhasPorHora: 5, // falhas seguidas são o primeiro sinal de restrição
  aviso: 0.8 // a partir de 80% do teto, a tela avisa
});

// Disparo frio (iniciado + campanha) conforme a idade do número no SIIMOB.
export const AQUECIMENTO = Object.freeze([
  { ateDias: 3, porDia: 20, porHora: 8, rotulo: 'Número novo (dias 1 a 3)' },
  { ateDias: 7, porDia: 40, porHora: 12, rotulo: 'Aquecendo (dias 4 a 7)' },
  { ateDias: 14, porDia: 80, porHora: 20, rotulo: 'Aquecendo (dias 8 a 14)' },
  { ateDias: 30, porDia: 150, porHora: 30, rotulo: 'Quase aquecido (dias 15 a 30)' },
  { ateDias: Infinity, porDia: 250, porHora: 40, rotulo: 'Aquecido (mais de 30 dias)' }
]);

// Campanha: intervalo aleatório entre mensagens e pausa longa a cada lote.
export const CAMPANHA = Object.freeze({
  intervalo: [20, 60], // segundos
  lote: 20,
  pausaLote: [300, 900] // segundos (5 a 15 min)
});

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

/** Em que fase de aquecimento o número está. */
export function faseAquecimento(primeiraConexao, agora = Date.now()) {
  const t = primeiraConexao ? new Date(primeiraConexao).getTime() : NaN;
  const dias = Number.isFinite(t) ? Math.max(0, Math.floor((agora - t) / DIA)) + 1 : 1;
  const fase = AQUECIMENTO.find(f => dias <= f.ateDias) || AQUECIMENTO[AQUECIMENTO.length - 1];
  return { dias, ...fase, ateDias: Number.isFinite(fase.ateDias) ? fase.ateDias : null };
}

const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const quando = (base, soma, agora) => {
  const t = base ? new Date(base).getTime() : NaN;
  return new Date(Number.isFinite(t) ? Math.max(t + soma, agora + 1000) : agora + soma).toISOString();
};

/**
 * Pode mandar mais uma mensagem agora?
 * @param {{uso:any, tipo:'resposta'|'iniciado'|'campanha', agora?:number}} p
 */
export function avaliar({ uso, tipo, agora = Date.now() }) {
  const u = uso || {};
  const fase = faseAquecimento(u.primeira_conexao_em, agora);
  const frio = tipo !== 'resposta';
  const contas = {
    minuto: n(u.minuto),
    hora: n(u.hora),
    dia: n(u.dia),
    hora_frio: n(u.hora_frio),
    dia_frio: n(u.dia_frio),
    falhas_hora: n(u.falhas_hora)
  };
  const tetos = {
    minuto: TETOS.porMinuto,
    hora: TETOS.porHora,
    dia: TETOS.porDia,
    hora_frio: fase.porHora,
    dia_frio: fase.porDia
  };
  const base = { fase, contas, tetos, restanteFrioHoje: Math.max(0, fase.porDia - contas.dia_frio) };
  const nao = (motivo, esperarAte, pausarGeral) => ({
    ...base,
    pode: false,
    motivo,
    esperarAte,
    pausarGeral,
    alerta: true
  });

  const pausa = u.pausado_ate ? new Date(u.pausado_ate).getTime() : NaN;
  if (Number.isFinite(pausa) && pausa > agora)
    return nao(u.pausa_motivo || 'pausado', new Date(pausa).toISOString(), false);
  if (contas.falhas_hora >= TETOS.falhasPorHora)
    return nao('falhas_seguidas', quando(null, HORA, agora), true);
  if (contas.dia >= tetos.dia) return nao('limite_do_dia', quando(u.antigo_dia, DIA, agora), true);
  if (contas.hora >= tetos.hora) return nao('limite_da_hora', quando(u.antigo_hora, HORA, agora), true);
  if (frio && contas.dia_frio >= tetos.dia_frio)
    return nao('limite_de_disparos_do_dia', quando(u.antigo_dia_frio, DIA, agora), false);
  if (frio && contas.hora_frio >= tetos.hora_frio)
    return nao('limite_de_disparos_da_hora', quando(u.antigo_hora_frio, HORA, agora), false);
  if (contas.minuto >= tetos.minuto) return nao('ritmo', quando(u.antigo_minuto, MIN, agora), false);

  // Perto do teto: a próxima ainda pode, mas a tela avisa.
  const chaves = frio ? Object.keys(tetos) : ['minuto', 'hora', 'dia'];
  const alerta = chaves.some(k => (contas[k] + 1) / tetos[k] >= TETOS.aviso);
  return { ...base, pode: true, motivo: null, esperarAte: null, pausarGeral: false, alerta };
}

/**
 * Quantos segundos esperar antes da próxima mensagem da campanha.
 * `enviadas` é quantas já saíram nesta campanha; `rnd` é injetável (testes).
 */
export function intervaloCampanha(enviadas, rnd = Math.random) {
  const entre = ([a, b]) => Math.round(a + (b - a) * rnd());
  let s = entre(CAMPANHA.intervalo);
  if (enviadas > 0 && enviadas % CAMPANHA.lote === 0) s += entre(CAMPANHA.pausaLote);
  return s;
}

/** O texto da tela para cada motivo. */
export const MOTIVO_TEXTO = Object.freeze({
  pausado: 'Envios pausados para proteger o número.',
  falhas_seguidas: 'Muitas falhas de envio na última hora: pausado por 1 hora para proteger o número.',
  limite_do_dia: 'Limite de mensagens do dia atingido. Os envios voltam sozinhos quando abrir vaga.',
  limite_da_hora: 'Limite de mensagens da hora atingido. Os envios voltam sozinhos em seguida.',
  limite_de_disparos_do_dia:
    'Limite de conversas iniciadas/campanha do dia atingido para a fase de aquecimento do número. Respostas a quem escreveu continuam liberadas.',
  limite_de_disparos_da_hora:
    'Limite de conversas iniciadas/campanha da hora atingido. Respostas a quem escreveu continuam liberadas.',
  ritmo: 'Muitas mensagens no mesmo minuto: aguarde alguns segundos.'
});
