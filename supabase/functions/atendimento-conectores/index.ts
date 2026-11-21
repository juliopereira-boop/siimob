// atendimento-conectores: liga o handler ao banco (chave de serviço), à
// OpenAI e à Evolution. Segredos (Supabase › Edge Functions › Secrets):
//   SIIMOB_EVOLUTION_URL   endereço https do servidor da Evolution (Hostinger)
//   SIIMOB_EVOLUTION_KEY   a chave global (AUTHENTICATION_API_KEY) da Evolution
//   SIIMOB_OPENAI_API_KEY  opcional: chave da plataforma para quem não tem a sua
import { createHandler } from './handler.mjs';
import { criarEvolution } from './evolution.mjs';

const base = Deno.env.get('SUPABASE_URL') || '';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
const headers = () => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });

async function db(path: string, init: RequestInit = {}) {
  if (!base || !key) throw new Error('not configured');
  const r = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...headers(), ...init.headers } });
  if (!r.ok) throw new Error(`database error ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const rpc = (fn: string, args: unknown) => db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
const eq = (v: string) => `eq.${encodeURIComponent(v)}`;

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), x => x.toString(16).padStart(2, '0')).join('');
}

const evolution = criarEvolution({
  url: Deno.env.get('SIIMOB_EVOLUTION_URL') || '',
  chave: Deno.env.get('SIIMOB_EVOLUTION_KEY') || ''
});

Deno.serve(
  createHandler({
    evolution,
    chavePlataforma: Deno.env.get('SIIMOB_OPENAI_API_KEY') || '',
    log: (m: string) => console.error(m),
    async context(token: string) {
      const r = await rpc('a1_conector_contexto', { p_token: token });
      return r?.[0] || null;
    },
    async iaLer(tenant: string) {
      const r = await db(`a1_ia_conexoes?tenant_id=${eq(tenant)}&select=chave,modelo,teste_ok,testado_em`);
      return r?.[0] || null;
    },
    async iaSalvar(tenant: string, v: { chave: string | null; modelo: string; user: string; teste_ok: boolean | null }) {
      await db('a1_ia_conexoes?on_conflict=tenant_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          tenant_id: tenant,
          chave: v.chave,
          modelo: v.modelo,
          atualizado_por: v.user,
          atualizado_em: new Date().toISOString(),
          teste_ok: v.teste_ok,
          testado_em: v.teste_ok === null ? null : new Date().toISOString()
        })
      });
    },
    async iaMarcarTeste(tenant: string, ok: boolean) {
      // sem linha (usando a chave da plataforma), cria a linha só com o teste
      await db('a1_ia_conexoes?on_conflict=tenant_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ tenant_id: tenant, teste_ok: ok, testado_em: new Date().toISOString() })
      });
    },
    async openaiModelos(chave: string) {
      let r: Response;
      try {
        r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${chave}` },
          redirect: 'error',
          signal: AbortSignal.timeout(10000)
        });
      } catch {
        throw new Error('openai_indisponivel');
      }
      if (r.status === 401 || r.status === 403) throw new Error('chave_recusada');
      if (!r.ok) throw new Error('openai_indisponivel');
      const b = await r.json().catch(() => ({}));
      return (Array.isArray(b?.data) ? b.data : [])
        .map((m: { id?: unknown }) => m?.id)
        .filter((id: unknown) => typeof id === 'string' && /^[a-zA-Z0-9._:-]{2,60}$/.test(id as string));
    },
    async waLer(tenant: string) {
      const r = await db(
        `a1_whatsapp_conexoes?tenant_id=${eq(tenant)}&select=instancia,estado,numero,perfil_nome,criar_leads,primeira_conexao_em,conectado_em,pausado_ate,pausa_motivo`
      );
      return r?.[0] || null;
    },
    async waCriar(row: Record<string, string>) {
      await db('a1_whatsapp_conexoes', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    },
    async waToken(tenant: string, hash: string) {
      await db(`a1_whatsapp_conexoes?tenant_id=${eq(tenant)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ webhook_token_hash: hash, atualizado_em: new Date().toISOString() })
      });
    },
    async waOpcoes(tenant: string, criar: boolean) {
      await db(`a1_whatsapp_conexoes?tenant_id=${eq(tenant)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ criar_leads: criar, atualizado_em: new Date().toISOString() })
      });
    },
    waEstado: (tenant: string, estado: string, numero?: string | null, nome?: string | null) =>
      rpc('a1_wa_estado', { p_tenant: tenant, p_estado: estado, p_numero: numero || null, p_nome: nome || null }),
    waUso: (tenant: string) => rpc('a1_wa_uso', { p_tenant: tenant }),
    waPausar: (tenant: string, ate: string, motivo: string) => rpc('a1_wa_pausar', { p_tenant: tenant, p_ate: ate, p_motivo: motivo }),
    // Roda com a sessão de quem pede: as regras de posse ficam no banco.
    async alvo(token: string, atendimento: string) {
      const r = await fetch(`${base}/rest/v1/rpc/a1_atend_wa_alvo`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json', 'x-session-token': token },
        body: JSON.stringify({ p_atendimento: atendimento })
      });
      const b = await r.json().catch(() => null);
      if (!r.ok) throw new Error(String(b?.message || 'sem_permissao').slice(0, 60));
      return b;
    },
    registrarEnvio: (tenant: string, atendimento: string, corpo: string, autor: string, externo: string | null, tipo: string) =>
      rpc('a1_wa_registrar_envio', {
        p_tenant: tenant,
        p_atendimento: atendimento,
        p_corpo: corpo,
        p_autor: autor,
        p_externo: externo,
        p_tipo: tipo
      }),
    registrarFalha: (tenant: string, tipo: string, atendimento: string | null) =>
      rpc('a1_wa_registrar_falha', { p_tenant: tenant, p_tipo: tipo, p_atendimento: atendimento }),
    gerarToken() {
      const b = new Uint8Array(32);
      crypto.getRandomValues(b);
      return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    },
    hash: sha256,
    webhookUrl: (instancia: string, token: string) =>
      `${base}/functions/v1/whatsapp-webhook?i=${encodeURIComponent(instancia)}&t=${token}`
  })
);
