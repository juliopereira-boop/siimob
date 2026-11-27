// fin-lembretes: lembrete de parcela da carteira pelo WhatsApp (oficial com
// reserva na Evolution). Publicada com verify_jwt desligado: quem chama é o
// agendador do banco, com um código de uso único (x-fin-codigo) que o banco
// confere. Segredos usados (os mesmos de atendimento-conectores):
//   COEXY_API_KEY, SIIMOB_EVOLUTION_URL, SIIMOB_EVOLUTION_KEY
import { createHandler } from './handler.mjs';
import { criarEvolution } from '../atendimento-conectores/evolution.mjs';
import { criarCoexy } from '../atendimento-conectores/coexy.mjs';

const base = Deno.env.get('SUPABASE_URL') || '';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const eq = (v: string) => `eq.${encodeURIComponent(v)}`;

async function db(path: string, init: RequestInit = {}) {
  if (!base || !key) throw new Error('not configured');
  const r = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
    signal: AbortSignal.timeout(12000)
  });
  if (!r.ok) throw new Error(`database error ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const rpc = (fn: string, args: unknown) => db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

Deno.serve(
  createHandler({
    coexy: criarCoexy({ chave: Deno.env.get('COEXY_API_KEY') || '' }),
    evolution: criarEvolution({
      url: Deno.env.get('SIIMOB_EVOLUTION_URL') || '',
      chave: Deno.env.get('SIIMOB_EVOLUTION_KEY') || ''
    }),
    codigoValido: async (c: string) => (await rpc('a1_fin_lembrete_codigo_valido', { p_codigo: c })) === true,
    devidos: (n: number) => rpc('a1_fin_lembretes_devidos', { p_limite: n }),
    async oficialLer(t: string) {
      const r = await db(
        `a1_wa_oficial?tenant_id=${eq(t)}&select=channel_id,status,phone_number_id,channel_token,reserva_auto`
      );
      return r?.[0] || null;
    },
    async waLer(t: string) {
      const r = await db(`a1_whatsapp_conexoes?tenant_id=${eq(t)}&select=instancia,estado,pausado_ate`);
      return r?.[0] || null;
    },
    uso: (t: string) => rpc('a1_wa_uso', { p_tenant: t }),
    pausar: (t: string, ate: string, motivo: string) =>
      rpc('a1_wa_pausar', { p_tenant: t, p_ate: ate, p_motivo: motivo }),
    falha: (t: string, canal: string) =>
      rpc('a1_wa_envio_falha', { p_tenant: t, p_tipo: 'iniciado', p_atendimento: null, p_canal: canal }),
    envioOk: (t: string, canal: string, id: string | null) =>
      rpc('a1_wa_envio_ok', {
        p_tenant: t,
        p_atendimento: null,
        p_corpo: null,
        p_autor: 'Financeiro',
        p_externo: id,
        p_tipo: 'iniciado',
        p_autor_tipo: 'atendente',
        p_canal: canal
      }),
    registrar: (t: string, parcela: string, gatilho: string, canal: string | null, ok: boolean, detalhe: string | null) =>
      rpc('a1_fin_lembrete_registrar', {
        p_tenant: t,
        p_parcela: parcela,
        p_gatilho: gatilho,
        p_canal: canal,
        p_ok: ok,
        p_detalhe: detalhe
      }),
    log: (m: string) => console.error(m)
  })
);
