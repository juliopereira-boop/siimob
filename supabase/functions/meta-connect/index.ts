import { createHandler } from './handler.mjs';
import { listMetaPages, listMetaPagesWithTokens } from './pages.mjs';
import { listMetaForms } from './forms.mjs';

const base = Deno.env.get('SUPABASE_URL') || '';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const secret = Deno.env.get('SIIMOB_META_APP_SECRET') || '';
const appId = '29432161913068502';
const headers = () => ({ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' });
async function db(path: string, init: RequestInit = {}) {
  if (!base || !key) throw new Error('not configured');
  const response = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...headers(), ...init.headers } });
  if (!response.ok) throw new Error('database error');
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}
function filters(values: Record<string, string>) {
  const p = new URLSearchParams();
  for (const [k,v] of Object.entries(values)) p.set(k, `eq.${v}`);
  return p;
}
async function graph(path: string, params: Record<string,string>) {
  const url = new URL(`https://graph.facebook.com/v27.0/${path}`);
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
  const response = await fetch(url, { headers: { 'Accept':'application/json' }, redirect:'error' });
  if (!response.ok) throw new Error('Meta error');
  return response.json();
}
Deno.serve(createHandler({
  async context(token: string) {
    const result = await db('rpc/siimob_meta_session_context', { method:'POST', body:JSON.stringify({p_token:token}) });
    return result?.[0] || null;
  },
  async insertState(row: unknown) { await db('siimob_meta_oauth_states', {method:'POST', body:JSON.stringify(row)}); },
  async consumeState({expires_after, ...equal}: Record<string,string>) {
    const query = filters(equal); query.set('expires_at', `gt.${expires_after}`); query.set('select','state_hash');
    const rows = await db(`siimob_meta_oauth_states?${query}`, {method:'DELETE', headers:{Prefer:'return=representation'}});
    return Array.isArray(rows) && rows.length === 1;
  },
  async exchange(code: string, redirectUri: string) {
    if (!secret) throw new Error('not configured');
    const short = await graph('oauth/access_token', {client_id:appId, client_secret:secret, redirect_uri:redirectUri, code});
    if (!short.access_token) throw new Error('missing token');
    const long = await graph('oauth/access_token', {grant_type:'fb_exchange_token', client_id:appId, client_secret:secret, fb_exchange_token:short.access_token});
    if (!long.access_token) throw new Error('missing token');
    const info = await graph('debug_token', {input_token:long.access_token, access_token:`${appId}|${secret}`});
    return {...info.data, access_token:long.access_token};
  },
  async saveConnection(row: unknown) {
    await db('siimob_meta_connections?on_conflict=tenant_id', {method:'POST', headers:{Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify(row)});
  },
  async getConnection(tenantId: string) {
    const q = filters({tenant_id:tenantId});
    q.set('select','access_token,connected_at,token_expires_at,data_access_expires_at');
    const rows = await db(`siimob_meta_connections?${q}`);
    return rows?.[0] || null;
  },
  listPages: listMetaPages,
  listPagesWithTokens: (token: string) => listMetaPagesWithTokens(token),
  listForms: listMetaForms,
  async getSelectedPages(tenantId: string) {
    const q = filters({tenant_id:tenantId}); q.set('select','page_id');
    return await db(`siimob_meta_pages?${q}`);
  },
  async getSelectedForms(tenantId: string, pageId: string) {
    const q = filters({tenant_id:tenantId,page_id:pageId,selected:'true'}); q.set('select','form_id,funil');
    return await db(`siimob_meta_forms?${q}`);
  },
  async replaceForms(tenantId: string, version: string, pageId: string, forms: unknown) {
    return await db('rpc/siimob_meta_replace_forms', {method:'POST', body:JSON.stringify({p_tenant:tenantId,p_version:version,p_page:pageId,p_forms:forms})});
  },
  async replacePages(tenantId: string, version: string, pages: unknown) {
    return await db('rpc/siimob_meta_replace_pages', {method:'POST', body:JSON.stringify({p_tenant:tenantId,p_version:version,p_pages:pages})});
  },
  // Liga a página ao recebimento de avisos de lead (campo leadgen do webhook
  // do app). Usa o token da página, que nunca sai do servidor.
  async subscribePage(pageId: string, pageToken: string) {
    if (!/^\d{1,32}$/.test(pageId)) return false;
    const url = new URL(`https://graph.facebook.com/v27.0/${pageId}/subscribed_apps`);
    url.searchParams.set('subscribed_fields', 'leadgen');
    const r = await fetch(url, { method:'POST', headers:{ Authorization:`Bearer ${pageToken}`, Accept:'application/json' }, redirect:'error', signal: AbortSignal.timeout(8000) });
    const body = await r.json().catch(() => ({}));
    return r.ok && body?.success === true;
  },
  // Os últimos avisos de lead da empresa, com o resultado e o nome do lead.
  async recentLeads(tenantId: string) {
    const q = filters({tenant_id:tenantId});
    q.set('select','leadgen_id,form_id,status,detalhe,received_at,processado_em,case_id');
    q.set('order','received_at.desc'); q.set('limit','20');
    const rows = (await db(`siimob_meta_webhook_events?${q}`)) || [];
    const ids = rows.map((r: {case_id?: string}) => r.case_id).filter((x: unknown) => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x as string));
    const nomes = new Map<string, string>();
    if (ids.length) {
      const c = new URLSearchParams(); c.set('id', `in.(${ids.join(',')})`); c.set('tenant_id', `eq.${tenantId}`); c.set('select','id,client_name,stage_name');
      for (const x of (await db(`a1_cases?${c}`)) || []) nomes.set(x.id, `${x.client_name}${x.stage_name ? ' · ' + x.stage_name : ''}`);
    }
    const fq = filters({tenant_id:tenantId}); fq.set('select','form_id,form_name');
    const forms = new Map(((await db(`siimob_meta_forms?${fq}`)) || []).map((f: {form_id: string; form_name: string}) => [f.form_id, f.form_name]));
    return rows.map((r: Record<string, string>) => ({
      quando: r.received_at, status: r.status, detalhe: r.detalhe || null,
      formulario: forms.get(r.form_id) || `Formulário ${r.form_id}`,
      lead: r.case_id ? nomes.get(r.case_id) || null : null, case_id: r.case_id || null
    }));
  },
  // Pede ao webhook para tentar de novo os avisos pendentes desta empresa.
  async retryPending(tenantId: string) {
    const r = await fetch(`${base}/functions/v1/meta-leads-webhook/processar`, {
      method:'POST', headers:{ 'Content-Type':'application/json', 'x-siimob-interno': key, apikey:key, Authorization:`Bearer ${key}` },
      body: JSON.stringify({tenant_id: tenantId}), signal: AbortSignal.timeout(25000)
    });
    if (!r.ok) throw new Error('retry failed');
    return await r.json();
  },
  async getStatus(tenantId: string) {
    const q = filters({tenant_id:tenantId}); q.set('select','connected_at,token_expires_at,data_access_expires_at');
    const rows = await db(`siimob_meta_connections?${q}`);
    return rows?.[0] ? {connected:true, ...rows[0]} : {connected:false};
  }
}));
