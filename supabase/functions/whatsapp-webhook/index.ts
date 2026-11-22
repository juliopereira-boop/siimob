// whatsapp-webhook: recebe os avisos da Evolution. Publicada com verify_jwt
// desligado (quem chama é o servidor da Evolution); a autenticação é o token
// da conexão no endereço, conferido no banco pelo hash.
import { createHandler } from './handler.mjs';

const base = Deno.env.get('SUPABASE_URL') || '';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
async function rpc(fn: string, args: unknown) {
  if (!base || !key) throw new Error('not configured');
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  if (!r.ok) throw new Error(`database error ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

Deno.serve(
  createHandler({
    tenantDo: (instancia: string, token: string) => rpc('a1_wa_webhook_tenant', { p_instancia: instancia, p_token: token }),
    receber: (m: { tenant: string; numero: string; nome: string | null; texto: string; externo: string; deMim: boolean }) =>
      rpc('a1_wa_receber', {
        p_tenant: m.tenant,
        p_numero: m.numero,
        p_nome: m.nome,
        p_texto: m.texto,
        p_externo: m.externo,
        p_de_mim: m.deMim
      }),
    estado: (tenant: string, estado: string, numero: string | null, nome: string | null) =>
      rpc('a1_wa_estado', { p_tenant: tenant, p_estado: estado, p_numero: numero, p_nome: nome }),
    log: (m: string) => console.error(m)
  })
);
