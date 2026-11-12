const enc = new TextEncoder();
const origin = 'https://siimob.com';
export const redirectUri = `${origin}/meta-callback.html`;
const appId = '29432161913068502';
const configId = '1549929046901619';
const requiredScopes = ['leads_retrieval', 'pages_show_list', 'pages_manage_metadata'];
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))), x => x.toString(16).padStart(2, '0')).join('');
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':origin, 'Vary':'Origin' } }); }

// Dependencies are server-side only, and are injected for isolated tests.
export function createHandler({ context, insertState, consumeState, exchange, saveConnection, getStatus, getConnection, listPages, listForms, getSelectedPages, getSelectedForms, replacePages, replaceForms, now = () => Date.now() }) {
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
      if (body.action === 'pages' || body.action === 'save_pages' || body.action === 'forms' || body.action === 'save_forms') {
        const connection = await getConnection(user.tenant_id);
        if (!connection || !connection.access_token) return json({error:'not_connected'}, 409);
        const expired = [connection.token_expires_at, connection.data_access_expires_at].some(v => v && new Date(v).getTime() <= now());
        if (expired) return json({error:'reconnect'}, 409);
        if (body.action === 'save_pages' && (!Array.isArray(body.page_ids) || body.page_ids.length > 500 || body.page_ids.some(id => typeof id !== 'string' || !/^\d{1,32}$/.test(id)) || new Set(body.page_ids).size !== body.page_ids.length)) return json({error:'invalid_request'},400);
        if (body.action === 'forms' || body.action === 'save_forms') {
          if (typeof body.page_id !== 'string' || !/^\d{1,32}$/.test(body.page_id)) return json({error:'invalid_request'},400);
          if (body.action === 'save_forms' && (!Array.isArray(body.form_ids) || body.form_ids.length > 500 || body.form_ids.some(id => typeof id !== 'string' || !/^\d{1,32}$/.test(id)) || new Set(body.form_ids).size !== body.form_ids.length)) return json({error:'invalid_request'},400);
          const selected = await getSelectedPages(user.tenant_id);
          if (!selected.some(p => p.page_id === body.page_id)) return json({error:'page_not_selected'},403);
          const available = await listPages(connection.access_token);
          if (!available.some(p => p.id === body.page_id)) return json({error:'page_not_authorized'},403);
          const forms = await listForms(connection.access_token, body.page_id);
          if (body.action === 'forms') {
            const chosen = await getSelectedForms(user.tenant_id, body.page_id);
            const ids = new Set(chosen.map(f => f.form_id));
            const availableIds = new Set(forms.map(f => f.id));
            return json({forms:forms.map(f => ({...f,selected:ids.has(f.id)})), unavailable:chosen.filter(f=>!availableIds.has(f.form_id)).length});
          }
          const byId = new Map(forms.map(f => [f.id,f]));
          if (!body.form_ids.every(id => byId.has(id))) return json({error:'form_not_authorized'},403);
          const result = await replaceForms(user.tenant_id,connection.connected_at,body.page_id,body.form_ids.map(id=>byId.get(id)));
          if (result === 'connection_changed' || result === 'page_not_selected') return json({error:result},409);
          if (result !== 'ok') return json({error:'invalid_request'},400);
          return json({ok:true});
        }
        const pages = await listPages(connection.access_token);
        if (body.action === 'pages') {
          const selected = await getSelectedPages(user.tenant_id);
          const ids = new Set(selected.map(p => p.page_id));
          const available = new Set(pages.map(p => p.id));
          return json({pages:pages.map(p => ({id:p.id,name:p.name,selected:ids.has(p.id)})), unavailable:selected.filter(p=>!available.has(p.page_id)).length});
        }
        const byId = new Map(pages.map(p => [p.id, p]));
        if (!body.page_ids.every(id => byId.has(id))) return json({error:'page_not_authorized'},403);
        const result = await replacePages(user.tenant_id, connection.connected_at, body.page_ids.map(id=>byId.get(id)));
        if (result === 'page_conflict') return json({error:'page_conflict'},409);
        if (result === 'connection_changed') return json({error:'connection_changed'},409);
        if (result !== 'ok') return json({error:'invalid_request'},400);
        return json({ok:true});
      }
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
    } catch (error) {
      if (error?.code === 'forms_permission') return json({error:'forms_permission'},403);
      return json({error:'temporarily_unavailable'},503);
    }
  };
}
