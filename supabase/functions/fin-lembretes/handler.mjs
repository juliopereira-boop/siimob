// ─── fin-lembretes: lembrete de parcela pelo WhatsApp ───────────────────────
//
// Quem chama é o agendador do banco (a1_fin_lembretes_disparar), com um código
// de uso único no cabeçalho x-fin-codigo. O código é conferido e queimado no
// banco (a1_fin_lembrete_codigo_valido): não há segredo guardado.
//
// Para cada parcela devida (a1_fin_lembretes_devidos): manda o modelo aprovado
// pelo canal oficial; sem oficial, ou com o oficial fora e a reserva ligada,
// manda o texto do modelo pela Evolution (rota.mjs decide). Todo resultado,
// bom ou ruim, fica em a1_fin_lembretes: a mesma parcela não recebe o mesmo
// lembrete duas vezes.
//
// Sem rede e sem banco aqui: tudo injetado (testes/conectores/fin-lembretes.test.mjs).
import { enviarWhatsapp, ErroEnvio } from '../atendimento-conectores/rota.mjs';
import { preencher, variaveis } from '../atendimento-conectores/coexy.mjs';

const CODIGO = /^[0-9a-f]{48}$/;
const NOME_MODELO = /^[a-z0-9_]{1,60}$/;
const IDIOMA = /^[a-z]{2}(_[A-Z]{2})?$/;
// Erros que valem para o cliente inteiro: não adianta tentar as próximas.
const PARA_CLIENTE = new Set(['whatsapp_desconectado', 'limite']);

export function brl(v) {
  const n = Math.round(Number(v || 0) * 100) / 100;
  const [i, c] = n.toFixed(2).split('.');
  return `R$ ${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${c}`;
}

export function dataBr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function telefone(t) {
  const n = String(t || '').replace(/\D/g, '');
  if (/^\d{10,11}$/.test(n)) return '55' + n;
  return /^\d{12,13}$/.test(n) ? n : null;
}

/** O que vai na mensagem: os valores {{1}}..{{4}} e o texto preenchido. */
export function montar(l) {
  const m = l.modelo || {};
  const corpo = typeof m.corpo === 'string' ? m.corpo.slice(0, 1024) : '';
  const onde = [l.empreendimento, l.unidade].filter(Boolean).join(' · ');
  const valores = [l.cliente_nome || 'cliente', brl(l.total), dataBr(l.vencimento), onde || '-'];
  const n = Math.max(0, ...variaveis(corpo));
  const texto = preencher(corpo, valores).trim();
  if (!texto) return null;
  const temModelo = NOME_MODELO.test(String(m.nome || '')) && IDIOMA.test(String(m.idioma || ''));
  return {
    texto,
    modelo: temModelo ? { nome: m.nome, idioma: m.idioma, parametros: valores.slice(0, n), texto } : null
  };
}

/**
 * @param {{codigoValido:(c:string)=>Promise<boolean>, devidos:(n:number)=>Promise<any[]>,
 *          oficialLer:(t:string)=>Promise<any>, waLer:(t:string)=>Promise<any>,
 *          uso:(t:string)=>Promise<any>, pausar:(t:string, ate:string, motivo:string)=>Promise<any>,
 *          falha:(t:string, canal:string)=>Promise<any>, envioOk:(t:string, canal:string, id:string|null)=>Promise<any>,
 *          registrar:(t:string, parcela:string, gatilho:string, canal:string|null, ok:boolean, detalhe:string|null)=>Promise<any>,
 *          coexy:any, evolution:any, now?:()=>number, prazo?:number, limite?:number, log?:(m:string)=>void}} d
 */
export function createHandler(d) {
  const log = d.log || (() => {});
  const now = d.now || (() => Date.now());
  const prazo = d.prazo || 100000;
  const json = (v, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });

  return async function handler(req) {
    if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);
    const codigo = req.headers.get('x-fin-codigo') || '';
    if (!CODIGO.test(codigo) || !(await d.codigoValido(codigo))) return json({ erro: 'nao_autorizado' }, 401);

    const inicio = now();
    const lista = (await d.devidos(d.limite || 200)) || [];
    const canais = new Map();
    const parados = new Map();
    const r = { devidos: lista.length, enviados: 0, falhas: 0, pulados: 0, sobra: 0 };

    for (const l of lista) {
      if (now() - inicio > prazo) {
        // Sem registrar: a próxima rodada (de hora em hora) continua daqui.
        r.sobra++;
        continue;
      }
      const t = l.tenant_id;
      const reg = (canal, ok, detalhe) => d.registrar(t, l.parcela_id, l.gatilho, canal, ok, detalhe);
      if (parados.has(t)) {
        r.pulados++;
        continue;
      }
      const numero = telefone(l.telefone);
      const msg = montar(l);
      if (!numero || !msg) {
        await reg(null, false, !numero ? 'sem_telefone' : 'sem_modelo');
        r.falhas++;
        continue;
      }
      if (!canais.has(t)) canais.set(t, await Promise.all([d.oficialLer(t), d.waLer(t)]));
      const [oficial, conexao] = canais.get(t);
      try {
        const e = await enviarWhatsapp(
          {
            coexy: d.coexy,
            evolution: d.evolution,
            oficial,
            conexao,
            uso: () => d.uso(t),
            pausar: (ate, motivo) => d.pausar(t, ate, motivo),
            falha: canal => d.falha(t, canal),
            log
          },
          {
            numero,
            tipo: 'iniciado',
            janela: false,
            texto: msg.texto,
            modelo: msg.modelo,
            agora: now(),
            atraso: 2500
          }
        );
        await d.envioOk(t, e.canal, e.id);
        await reg(e.canal, true, e.reserva ? `reserva: ${e.motivo_oficial}` : null);
        r.enviados++;
      } catch (e) {
        if (!(e instanceof ErroEnvio)) throw e;
        const det = [e.codigo, e.extra && e.extra.motivo].filter(Boolean).join(': ');
        if (PARA_CLIENTE.has(e.codigo)) {
          // Canal fora ou limite do dia: segura o resto do cliente para a próxima rodada.
          parados.set(t, e.codigo);
          r.pulados++;
          log(`fin-lembretes: cliente ${t} parado (${det})`);
          continue;
        }
        await reg(null, false, det.slice(0, 300));
        r.falhas++;
      }
    }
    return json({ ok: true, ...r });
  };
}
