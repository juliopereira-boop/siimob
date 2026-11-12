// Only the Meta webhook handshake and durable receipt are implemented here.
// The events are deliberately not associated with a tenant or turned into leads.
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

export function createHandler({ verifyToken, appSecret, saveEvents }) {
  return async function handle(req) {
    if (req.method === 'GET') {
      if (!verifyToken) return reply('Not configured', 503);
      const params = new URL(req.url).searchParams;
      const challenge = params.get('hub.challenge');
      if (params.get('hub.mode') !== 'subscribe' || params.get('hub.verify_token') !== verifyToken || !challenge) return reply('Forbidden', 403);
      return reply(challenge, 200);
    }
    if (req.method !== 'POST') return reply('Method not allowed', 405);
    if (!appSecret) return reply('Not configured', 503);
    const declared = Number(req.headers.get('content-length') || 0);
    if (declared > maxBody) return reply('Payload too large', 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > maxBody) return reply('Payload too large', 413);
    if (!await verifySignature(appSecret, bytes, req.headers.get('x-hub-signature-256'))) return reply('Forbidden', 403);
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { return reply('Invalid payload', 400); }
    if (body?.object !== 'page' || !Array.isArray(body.entry)) return reply('Invalid payload', 400);
    const events = new Map();
    for (const entry of body.entry) {
      if (!Array.isArray(entry?.changes)) return reply('Invalid payload', 400);
      for (const change of entry.changes) {
        if (change?.field !== 'leadgen') continue;
        const v = change.value;
        const page = String(v?.page_id ?? '');
        const lead = String(v?.leadgen_id ?? '');
        const form = String(v?.form_id ?? '');
        if (![page, lead, form].every(x => idPattern.test(x)) || String(entry.id ?? '') !== page) return reply('Invalid payload', 400);
        // Retain identifiers only; lead details and tokens are not part of webhook storage.
        events.set(`${page}:${lead}`, { page_id: page, leadgen_id: lead, form_id: form });
      }
    }
    if (events.size) {
      try { await saveEvents([...events.values()]); }
      catch { return reply('Temporary error', 503); }
    }
    return reply('EVENT_RECEIVED', 200);
  };
}
