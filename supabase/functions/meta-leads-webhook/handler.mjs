// Meta webhook: handshake, signed receipt and, once stored, the processing that
// turns each notice into a lead (processa.mjs). The response to Meta never
// waits for that processing: it runs in the background (defer), and a stored
// notice that failed can be retried later through the internal route.
//
//   GET  /                     handshake (hub.challenge)
//   POST /                     signed notices from Meta
//   POST /processar            internal: retries a tenant's pending notices.
//   POST /sincronizar          internal: asks the Graph for the recent leads of
//                              the tenant's forms ({tenant_id}) or of every
//                              connected tenant ({todos:true}), without waiting
//                              for Meta's notice. Both internal routes are
//                              accepted only with the service credential.
const encoder = new TextEncoder();
const idPattern = /^\d{1,32}$/;
const maxBody = 1024 * 1024;

function reply(message, status) {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

async function verifySignature(secret, bytes, header) {
  if (!/^sha256=[a-f0-9]{64}$/i.test(header || '')) return false;
  const signature = Uint8Array.from(header.slice(7).match(/../g), x => parseInt(x, 16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, signature, bytes);
}

// Só dígitos e no máximo 32: o que vai para o log nunca é texto livre.
const idLog = v => (/^\d{1,32}$/.test(String(v ?? '')) ? String(v) : typeof v);

export function createHandler({ verifyToken, appSecret, saveEvents, processEvents, retryPending, syncTenant, syncAll, internalKey, defer = p => p, log = () => {} }) {
  return async function handle(req) {
    if (req.method === 'GET') {
      if (!verifyToken) return reply('Not configured', 503);
      const params = new URL(req.url).searchParams;
      const challenge = params.get('hub.challenge');
      if (params.get('hub.mode') !== 'subscribe' || params.get('hub.verify_token') !== verifyToken || !challenge) return reply('Forbidden', 403);
      return reply(challenge, 200);
    }
    if (req.method !== 'POST') return reply('Method not allowed', 405);
    if (new URL(req.url).pathname.endsWith('/sincronizar')) {
      if (!internalKey || !syncTenant || req.headers.get('x-siimob-interno') !== internalKey) return reply('Forbidden', 403);
      let pedido;
      try { pedido = await req.json(); } catch { return reply('Invalid payload', 400); }
      const umaEmpresa = typeof pedido?.tenant_id === 'string' && /^[0-9a-f-]{36}$/.test(pedido.tenant_id);
      if (!umaEmpresa && !(pedido?.todos === true && syncAll)) return reply('Invalid payload', 400);
      try {
        const r = umaEmpresa ? await syncTenant(pedido.tenant_id) : await syncAll();
        return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      } catch { return reply('Temporary error', 503); }
    }
    if (new URL(req.url).pathname.endsWith('/processar')) {
      if (!internalKey || !retryPending || req.headers.get('x-siimob-interno') !== internalKey) return reply('Forbidden', 403);
      let pedido;
      try { pedido = await req.json(); } catch { return reply('Invalid payload', 400); }
      if (typeof pedido?.tenant_id !== 'string' || !/^[0-9a-f-]{36}$/.test(pedido.tenant_id)) return reply('Invalid payload', 400);
      try {
        const resumo = await retryPending(pedido.tenant_id);
        return new Response(JSON.stringify(resumo), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      } catch { return reply('Temporary error', 503); }
    }
    if (!appSecret) return reply('Not configured', 503);
    const declared = Number(req.headers.get('content-length') || 0);
    if (declared > maxBody) return reply('Payload too large', 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > maxBody) return reply('Payload too large', 413);
    if (!await verifySignature(appSecret, bytes, req.headers.get('x-hub-signature-256'))) return reply('Forbidden', 403);
    // Daqui em diante o aviso é comprovadamente da Meta: a resposta é sempre
    // 200, mesmo para o que não serve. Recusar faz a Meta reenviar por horas e
    // pode desativar a assinatura do webhook. O que não serve vai para o log.
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { log('meta webhook: corpo ilegível'); return reply('EVENT_RECEIVED', 200); }
    if (body?.object !== 'page' || !Array.isArray(body.entry)) {
      log(`meta webhook: objeto ${typeof body?.object === 'string' ? body.object.slice(0, 20) : typeof body?.object} ignorado`);
      return reply('EVENT_RECEIVED', 200);
    }
    const events = new Map();
    for (const entry of body.entry) {
      if (!Array.isArray(entry?.changes)) { log('meta webhook: entrada sem changes'); continue; }
      for (const change of entry.changes) {
        if (change?.field !== 'leadgen') continue;
        const v = change.value || {};
        // A página vem no próprio aviso; o id da entrada é só conferência.
        const page = String(v.page_id ?? entry.id ?? '');
        const lead = String(v.leadgen_id ?? '');
        const form = String(v.form_id ?? '');
        if (![page, lead, form].every(x => idPattern.test(x))) {
          log(`meta webhook: aviso incompleto ignorado page=${idLog(v.page_id ?? entry.id)} lead=${idLog(v.leadgen_id)} form=${idLog(v.form_id)}`);
          continue;
        }
        if (String(entry.id ?? '') !== page) log(`meta webhook: entrada ${idLog(entry.id)} diferente da página ${page}, usando a página`);
        // Retain identifiers only; lead details and tokens are not part of webhook storage.
        events.set(`${page}:${lead}`, { page_id: page, leadgen_id: lead, form_id: form });
      }
    }
    if (events.size) {
      try { await saveEvents([...events.values()]); }
      catch { log('meta webhook: falha ao guardar, a Meta vai reenviar'); return reply('Temporary error', 503); }
      log(`meta webhook: ${events.size} aviso(s) guardado(s): ${[...events.values()].map(e => `page=${e.page_id} lead=${e.leadgen_id} form=${e.form_id}`).join('; ')}`);
      // Stored first, processed after: a failure here never loses the notice.
      if (processEvents) defer(Promise.resolve().then(() => processEvents([...events.values()])).catch(() => {}));
    }
    return reply('EVENT_RECEIVED', 200);
  };
}
