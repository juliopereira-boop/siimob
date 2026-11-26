// ─── Por onde a mensagem sai: oficial primeiro, Evolution de reserva ─────────
//
// Decisão do dono: "Oficial com reserva automática".
//   1. Canal oficial ativo:
//      - modelo aprovado, ou o lead escreveu nas últimas 24 h: sai pelo oficial;
//      - texto livre fora da janela de 24 h: a Meta não aceita; vai pela
//        Evolution se a reserva estiver ligada, senão pede um modelo.
//      - o oficial recusou por motivo de canal (caiu, token, pagamento,
//        limite da Meta, fora da janela): tenta a Evolution, se houver reserva.
//        Recusa que a Evolution também teria (número sem WhatsApp, modelo
//        inválido) não vai para a reserva.
//   2. Sem oficial ativo: a Evolution é o canal (com os limites anti-bloqueio
//      de sempre). "Reserva automática" desligada só vale com o oficial ativo:
//      quem ainda não tem o oficial continua atendendo pela Evolution.
//
// Sem rede e sem banco aqui: tudo vem injetado (testes/conectores/rota.test.mjs).
import { avaliar, MOTIVO_TEXTO } from './limites.mjs';
import { ErroCoexy } from './coexy.mjs';

export class ErroEnvio extends Error {
  /** @param {string} codigo @param {Record<string, unknown>} extra */
  constructor(codigo, extra = {}) {
    super(codigo);
    this.codigo = codigo;
    this.extra = extra;
  }
}

/** O canal oficial pode enviar? */
export function oficialPronto(o, coexy) {
  return !!(
    coexy &&
    coexy.configurado &&
    o &&
    o.status === 'active' &&
    /^[0-9]{5,30}$/.test(String(o.phone_number_id || '')) &&
    typeof o.channel_token === 'string' &&
    o.channel_token.length >= 10
  );
}

/**
 * @param {{coexy:any, evolution:any, oficial:any, conexao:any,
 *          uso:()=>Promise<any>, pausar:(ate:string, motivo:string)=>Promise<any>,
 *          falha:(canal:string)=>Promise<any>, log?:(m:string)=>void}} d
 * @param {{numero:string, tipo:'resposta'|'iniciado'|'campanha', janela:boolean,
 *          texto?:string, anexo?:any, modelo?:{nome:string, idioma:string, parametros:string[], texto:string}|null,
 *          atraso?:number, agora?:number, chave?:string}} p
 * @returns {Promise<{canal:'oficial'|'evolution', id:string|null, alerta:boolean, reserva:boolean, motivo_oficial:string|null}>}
 */
export async function enviarWhatsapp(d, p) {
  const log = d.log || (() => {});
  const agora = p.agora || Date.now();
  const of = oficialPronto(d.oficial, d.coexy);
  const evo = !!(d.conexao && d.conexao.estado === 'conectado' && d.evolution && d.evolution.configurado);
  const reservaLigada = !d.oficial || d.oficial.reserva_auto !== false;
  let motivoOficial = null;

  if (of) {
    const o = d.oficial;
    if (p.modelo || p.janela) {
      try {
        const r = p.modelo
          ? await d.coexy.enviarModelo(
              o.phone_number_id,
              o.channel_token,
              p.numero,
              p.modelo.nome,
              p.modelo.idioma,
              p.modelo.parametros,
              p.chave
            )
          : p.anexo
            ? await d.coexy.enviarMidia(
                o.phone_number_id,
                o.channel_token,
                p.numero,
                p.anexo,
                p.texto,
                p.chave
              )
            : await d.coexy.enviarTexto(o.phone_number_id, o.channel_token, p.numero, p.texto, p.chave);
        return { canal: 'oficial', id: r.id, alerta: false, reserva: false, motivo_oficial: null };
      } catch (e) {
        if (!(e instanceof ErroCoexy)) throw e;
        await d.falha('oficial');
        log(`whatsapp: oficial recusou (${e.motivo}${e.status ? ` ${e.status}` : ''})`);
        if (!e.reserva || !reservaLigada || !evo)
          throw new ErroEnvio(e.motivo === 'fora_da_janela' ? 'fora_da_janela' : 'falha_oficial', {
            motivo: e.motivo,
            detalhe: e.detalhe
          });
        motivoOficial = e.motivo;
      }
    } else {
      if (!reservaLigada || !evo) throw new ErroEnvio('fora_da_janela');
      motivoOficial = 'fora_da_janela';
    }
  } else if (!evo) {
    throw new ErroEnvio('whatsapp_desconectado');
  }

  // ── Evolution (canal principal sem oficial, ou reserva) ──
  const texto = p.modelo ? p.modelo.texto : p.texto || '';
  const lim = avaliar({ uso: await d.uso(), tipo: p.tipo, agora });
  if (!lim.pode) {
    if (lim.pausarGeral) await d.pausar(lim.esperarAte, lim.motivo);
    log(`whatsapp: envio segurado (${lim.motivo})`);
    throw new ErroEnvio('limite', {
      motivo: MOTIVO_TEXTO[lim.motivo] || lim.motivo,
      volta_em: lim.esperarAte
    });
  }
  let r;
  try {
    r = p.anexo
      ? await d.evolution.enviarMidia(
          d.conexao.instancia,
          p.numero,
          p.anexo.url || p.anexo.dados,
          p.anexo.mime,
          p.anexo.nome,
          texto
        )
      : await d.evolution.enviarTexto(d.conexao.instancia, p.numero, texto, p.atraso || 1200);
  } catch (e) {
    await d.falha('evolution');
    log(`whatsapp: evolution recusou (${(e && e.motivo) || 'erro'})`);
    throw new ErroEnvio('falha_envio');
  }
  return {
    canal: 'evolution',
    id: r.id,
    alerta: !!lim.alerta,
    reserva: !!motivoOficial,
    motivo_oficial: motivoOficial
  };
}
