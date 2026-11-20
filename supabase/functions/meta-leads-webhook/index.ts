// Edge Function meta-leads-webhook (verify_jwt = false). A lógica está em
// handler.mjs (recebimento) e processa.mjs (aviso → lead), testadas em Node.
// Aqui só se ligam o banco (chave de serviço) e a Graph API.
import { createHandler } from './handler.mjs';
import { criarGraph, criarProcessador } from './processa.mjs';

const base = Deno.env.get('SUPABASE_URL') || '';
const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const cab = (extra: Record<string, string> = {}) => ({ apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json', ...extra });

async function rest(caminho: string, init: RequestInit = {}) {
  if (!base || !chave) throw new Error('Database unavailable');
  const r = await fetch(`${base}/rest/v1/${caminho}`, { ...init, headers: cab((init.headers as Record<string, string>) || {}) });
  if (!r.ok) throw new Error(`database ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const q = (v: Record<string, string>) => {
  const p = new URLSearchParams();
  for (const [k, x] of Object.entries(v)) p.set(k, `eq.${x}`);
  return p;
};

const db = {
  async pagina(pageId: string) {
    const p = q({ page_id: pageId }); p.set('select', 'tenant_id');
    return (await rest(`siimob_meta_pages?${p}`))?.[0] || null;
  },
  async formulario(tenantId: string, pageId: string, formId: string) {
    const p = q({ tenant_id: tenantId, page_id: pageId, form_id: formId }); p.set('select', 'selected,funil,form_name');
    return (await rest(`siimob_meta_forms?${p}`))?.[0] || null;
  },
  async conexao(tenantId: string) {
    const p = q({ tenant_id: tenantId }); p.set('select', 'access_token,token_expires_at,data_access_expires_at');
    return (await rest(`siimob_meta_connections?${p}`))?.[0] || null;
  },
  async criarLead(args: Record<string, unknown>) {
    return await rest('rpc/a1_integracao_criar_lead', { method: 'POST', body: JSON.stringify(args) });
  }
};

const processar = criarProcessador({ db, graph: criarGraph() });

async function marcar(ev: { page_id: string; leadgen_id: string }, r: Record<string, unknown>, tentativas: number) {
  const p = q({ page_id: ev.page_id, leadgen_id: ev.leadgen_id });
  await rest(`siimob_meta_webhook_events?${p}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      tenant_id: r.tenant_id ?? null,
      status: r.status,
      detalhe: r.detalhe ?? null,
      case_id: r.case_id ?? null,
      tentativas,
      processado_em: new Date().toISOString()
    })
  });
}

async function processarLista(eventos: Array<{ page_id: string; leadgen_id: string; form_id: string; tentativas?: number }>) {
  const resumo: Record<string, number> = {};
  for (const ev of eventos) {
    let r: Record<string, unknown>;
    try {
      r = await processar(ev);
    } catch {
      r = { status: 'erro', detalhe: 'falha_interna' };
    }
    resumo[String(r.status)] = (resumo[String(r.status)] || 0) + 1;
    try {
      await marcar(ev, r, (ev.tentativas || 0) + 1);
    } catch {
      /* o aviso fica como estava e pode ser tentado de novo */
    }
  }
  return resumo;
}

const handler = createHandler({
  verifyToken: Deno.env.get('SIIMOB_META_VERIFY_TOKEN') || '',
  appSecret: Deno.env.get('SIIMOB_META_APP_SECRET') || '',
  internalKey: chave,
  async saveEvents(events: Array<{ page_id: string; leadgen_id: string; form_id: string }>) {
    const url = new URL('/rest/v1/siimob_meta_webhook_events', base);
    url.searchParams.set('on_conflict', 'page_id,leadgen_id');
    const res = await fetch(url, {
      method: 'POST',
      headers: cab({ Prefer: 'resolution=ignore-duplicates,return=minimal' }),
      body: JSON.stringify(events)
    });
    if (!res.ok) throw new Error('Event storage failed');
  },
  async processEvents(events: Array<{ page_id: string; leadgen_id: string; form_id: string }>) {
    // Só os que ainda não viraram lead (a Meta pode reenviar o mesmo aviso).
    const pendentes = [];
    for (const ev of events) {
      const p = q({ page_id: ev.page_id, leadgen_id: ev.leadgen_id }); p.set('select', 'page_id,leadgen_id,form_id,status,tentativas');
      const row = (await rest(`siimob_meta_webhook_events?${p}`))?.[0];
      if (row && ['recebido', 'erro'].includes(row.status)) pendentes.push(row);
    }
    return processarLista(pendentes);
  },
  async retryPending(tenantId: string) {
    // Avisos da empresa que falharam, e os sem empresa ainda (página escolhida
    // depois do aviso), dos últimos 7 dias, até 5 tentativas cada.
    const desde = new Date(Date.now() - 7 * 86400000).toISOString();
    const paginas = await rest(`siimob_meta_pages?tenant_id=eq.${tenantId}&select=page_id`);
    const ids = (paginas || []).map((p: { page_id: string }) => p.page_id).filter((x: string) => /^\d{1,32}$/.test(x));
    if (!ids.length) return {};
    const p = new URLSearchParams();
    p.set('page_id', `in.(${ids.join(',')})`);
    p.set('status', 'in.(recebido,erro,ignorado)');
    p.set('tentativas', 'lt.5');
    p.set('received_at', `gte.${desde}`);
    p.set('select', 'page_id,leadgen_id,form_id,status,tentativas');
    p.set('order', 'received_at.asc');
    p.set('limit', '50');
    const lista = await rest(`siimob_meta_webhook_events?${p}`);
    return processarLista(lista || []);
  },
  // Responde à Meta na hora; o processamento continua depois da resposta.
  defer(p: Promise<unknown>) {
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(p);
  }
});

Deno.serve(handler);
