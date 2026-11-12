const enc = new TextEncoder();
const origin = 'https://siimob.com';
export const redirectUri = `${origin}/meta-callback.html`;
const appId = '29432161913068502';
const configId = '1549929046901619';
const requiredScopes = ['leads_retrieval', 'pages_show_list', 'pages_manage_metadata'];
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))), x => x.toString(16).padStart(2, '0')).join('');
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':origin, 'Vary':'Origin' } }); }

// Dependencies are server-side only, and are injected for isolated tests.
export function createHandler({ context, insertState, consumeState, exchange, saveConnection, getStatus, now = () => Date.now() }) {
  return async req => {
    if (req.headers.get('origin') !== origin) return json({error:'origin'}, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status:204, headers:{ 'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'content-type, apikey, authorization, x-session-token', 'Vary':'Origin' } });
    if (req.method !== 'POST') return json({error:'method'}, 405);
    const session = req.headers.get('x-session-token') || '';
    if (!session || session.length > 512) return json({error:'unauthorized'}, 401);
    try {
      const user = await context(session);
      if (!user || !/^[a-z0-9-]+$/.test(user.slug)) return json({error:'unauthorized'}, 403);
      let body; try { body = await req.json(); } catch { return json({error:'invalid_request'}, 400); }
      if (body.action === 'status') return json(await getStatus(user.tenant_id));
      if (body.action === 'start') {
        const random = crypto.getRandomValues(new Uint8Array(32));
        const state = Array.from(random, x => x.toString(16).padStart(2,'0')).join('');
        await insertState({ state_hash:await digest(state), session_hash:await digest(session), tenant_id:user.tenant_id, user_id:user.user_id, expires_at:new Date(now()+10*60*1000).toISOString() });
        const url = new URL('https://www.facebook.com/v27.0/dialog/oauth');
        for (const [k,v] of Object.entries({client_id:appId, config_id:configId, redirect_uri:redirectUri, response_type:'code', state})) url.searchParams.set(k,v);
        return json({url:url.toString()});
      }
      if (body.action === 'complete') {
        if (typeof body.state !== 'string' || !/^[0-9a-f]{64}$/.test(body.state) || typeof body.code !== 'string' || !body.code || body.code.length > 4096) return json({error:'invalid_request'},400);
        const used = await consumeState({ state_hash:await digest(body.state), session_hash:await digest(session), tenant_id:user.tenant_id, user_id:user.user_id, expires_after:new Date(now()).toISOString() });
        if (!used) return json({error:'expired_or_invalid_state'},403);
        const meta = await exchange(body.code, redirectUri);
        if (String(meta.app_id) !== appId || meta.type !== 'USER' || meta.is_valid !== true || !meta.user_id || typeof meta.access_token !== 'string' || !meta.access_token || !Array.isArray(meta.scopes) || !requiredScopes.every(s=>meta.scopes.includes(s)) || (meta.expires_at && meta.expires_at*1000 <= now()) || (meta.data_access_expires_at && meta.data_access_expires_at*1000 <= now())) return json({error:'invalid_meta_authorization'},400);
        const dateOrNull = n => Number.isFinite(n) && n > 0 ? new Date(n*1000).toISOString() : null;
        await saveConnection({tenant_id:user.tenant_id, connected_by:user.user_id, meta_user_id:String(meta.user_id), access_token:meta.access_token, scopes:meta.scopes, token_expires_at:dateOrNull(meta.expires_at), data_access_expires_at:dateOrNull(meta.data_access_expires_at), connected_at:new Date(now()).toISOString()});
        return json({ok:true, slug:user.slug});
      }
      return json({error:'invalid_request'},400);
    } catch { return json({error:'temporarily_unavailable'},503); }
  };
}
