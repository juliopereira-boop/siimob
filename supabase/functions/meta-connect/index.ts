import { createHandler } from './handler.mjs';

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
  async getStatus(tenantId: string) {
    const q = filters({tenant_id:tenantId}); q.set('select','connected_at,token_expires_at,data_access_expires_at');
    const rows = await db(`siimob_meta_connections?${q}`);
    return rows?.[0] ? {connected:true, ...rows[0]} : {connected:false};
  }
}));
