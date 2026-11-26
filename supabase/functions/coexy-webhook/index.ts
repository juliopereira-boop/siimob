// coexy-webhook: recebe os avisos da Coexy (WhatsApp oficial). Publicada com
// verify_jwt desligado (quem chama é a Coexy); a autenticação é a assinatura
// HMAC do corpo. O segredo vem do banco (a1_wa_coexy, gravado quando
// atendimento-conectores cria o webhook) ou do segredo COEXY_HMAC_SECRET.
import { createHandler } from './handler.mjs';

const base = Deno.env.get('SUPABASE_URL') || '';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function db(path: string, init: RequestInit = {}) {
  if (!base || !key) throw new Error('not configured');
  const r = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error(`database error ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const rpc = (fn: string, args: unknown) => db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

// O segredo muda raramente: guarda por 5 minutos.
let cache: { valor: string | null; ate: number } = { valor: null, ate: 0 };
async function segredo() {
  const env = Deno.env.get('COEXY_HMAC_SECRET');
  if (env) return env;
  if (cache.valor && cache.ate > Date.now()) return cache.valor;
  const r = await db('a1_wa_coexy?id=eq.1&select=hmac_secret');
  cache = { valor: r?.[0]?.hmac_secret || null, ate: Date.now() + 300000 };
  return cache.valor;
}

Deno.serve(
  createHandler({
    segredo,
    tenantDoNumero: (pnid: string) => rpc('a1_wa_oficial_tenant', { p_phone_number_id: pnid }),
    receber: (m: {
      tenant: string;
      numero: string;
      nome: string | null;
      texto: string;
      externo: string;
      deMim: boolean;
    }) =>
      rpc('a1_wa_receber_oficial', {
        p_tenant: m.tenant,
        p_numero: m.numero,
        p_nome: m.nome,
        p_texto: m.texto,
        p_externo: m.externo,
        p_de_mim: m.deMim
      }),
    status: (tenant: string, wamid: string, status: string, em: string | null) =>
      rpc('a1_wa_status', { p_tenant: tenant, p_externo: wamid, p_status: status, p_em: em }),
    canal: (
      channel: string,
      status: string,
      pnid: string | null,
      waba: string | null,
      numero: string | null
    ) =>
      rpc('a1_wa_oficial_evento', {
        p_channel: channel,
        p_status: status,
        p_phone_number_id: pnid,
        p_waba_id: waba,
        p_numero: numero
      }),
    saude: (
      channel: string,
      saude: string | null,
      motivo: string | null,
      qualidade: string | null,
      limite: string | null
    ) =>
      rpc('a1_wa_oficial_saude', {
        p_channel: channel,
        p_saude: saude,
        p_motivo: motivo,
        p_qualidade: qualidade,
        p_limite: limite
      }),
    log: (m: string) => console.error(m)
  })
);
