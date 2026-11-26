// ─── coexy-webhook: avisos do WhatsApp oficial (Coexy) entram no SIIMOB ──────
//
// Um webhook só, da plataforma: a Coexy entrega os eventos de todos os canais
// (um por cliente). O cliente sai do phone_number_id (metadata) ou do id do
// canal (eventos da Coexy). A assinatura HMAC-SHA256 do corpo é conferida
// antes de qualquer coisa (X-Hub-Signature-256 ou X-Coexy-Signature).
//
// O que entra: mensagem recebida (texto, botão, lista; mídia vira marcador),
// mensagem enviada pelo app WhatsApp Business no celular (coexistência),
// status de entrega, status e saúde do canal. Reação, mensagem de grupo e
// tipos sem conteúdo são ignorados.
//
// Responde em poucos milissegundos (algumas chamadas ao banco). Se o banco
// falhar, devolve 500 e a Coexy tenta de novo: tudo aqui é idempotente
// (wamid único por cliente; status só anda para a frente).
// O log nunca leva texto de mensagem nem número de telefone.

const enc = new TextEncoder();

/** HMAC-SHA256 do corpo, comparado em tempo constante (crypto.subtle.verify). */
export async function assinaturaValida(corpo, cabecalho, segredo) {
  const h = String(cabecalho || '');
  if (!segredo || !h.startsWith('sha256=')) return false;
  const hex = h.slice(7);
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  const chave = await crypto.subtle.importKey(
    'raw',
    enc.encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 64; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return crypto.subtle.verify('HMAC', chave, bytes, enc.encode(corpo));
}

/** Formato "meta" ({object, entry:[{changes:[{field, value}]}]}) ou "coexy" (só o value). */
export function lerEventos(body) {
  if (!body || typeof body !== 'object') return [];
  if (!Array.isArray(body.entry)) return [{ field: null, value: body }];
  return body.entry
    .flatMap(e => (e && Array.isArray(e.changes) ? e.changes : []))
    .filter(c => c && c.value && typeof c.value === 'object')
    .map(c => ({ field: typeof c.field === 'string' ? c.field : null, value: c.value }));
}

const s = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** O texto que vai para a Central. null = não entra. */
export function textoDe(m) {
  if (!m || typeof m !== 'object') return null;
  switch (m.type) {
    case 'text':
      return s(m.text && m.text.body);
    case 'button':
      return s(m.button && (m.button.text || m.button.payload));
    case 'interactive': {
      const i = m.interactive || {};
      if (i.button_reply) return s(i.button_reply.title);
      if (i.list_reply) return s(i.list_reply.title);
      if (i.nfm_reply) return '[formulário respondido]';
      return null;
    }
    case 'image':
      return s(m.image && m.image.caption) ? `[imagem] ${m.image.caption.trim()}` : '[imagem]';
    case 'video':
      return s(m.video && m.video.caption) ? `[vídeo] ${m.video.caption.trim()}` : '[vídeo]';
    case 'audio':
      return '[áudio]';
    case 'voice':
      return '[áudio]';
    case 'document':
      return `[documento] ${s(m.document && m.document.filename) || s(m.document && m.document.caption) || ''}`.trim();
    case 'sticker':
      return '[figurinha]';
    case 'location': {
      const l = m.location || {};
      return `[localização] ${s(l.name) || s(l.address) || ''}`.trim();
    }
    case 'contacts':
      return '[contato]';
    case 'order':
      return '[pedido]';
    default:
      return null; // reaction, system, unsupported, request_welcome...
  }
}

const NUMERO = /^\d{8,15}$/;
const WAMID = /^[A-Za-z0-9._=:+/-]{6,120}$/;

/**
 * Dependências: segredo() -> string|null; tenantDoNumero(phone_number_id) -> uuid|null;
 * receber({tenant, numero, nome, texto, externo, deMim}); status(tenant, wamid, status, em);
 * canal(channel_id, status, pnid, waba, numero); saude(channel_id, saude, motivo, qualidade, limite);
 * log(msg).
 */
export function createHandler(d) {
  const log = d.log || (() => {});
  const resp = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });

  return async req => {
    if (req.method !== 'POST') return resp({ error: 'method' }, 405);
    const corpo = await req.text();
    if (corpo.length > 2_000_000) return resp({ error: 'too_large' }, 413);
    let segredo;
    try {
      segredo = await d.segredo();
    } catch {
      return resp({ error: 'temporarily_unavailable' }, 503);
    }
    // sem segredo guardado ainda: a Coexy tenta de novo mais tarde
    if (!segredo) return resp({ error: 'not_ready' }, 503);
    const assinatura = req.headers.get('x-hub-signature-256') || req.headers.get('x-coexy-signature') || '';
    if (!(await assinaturaValida(corpo, assinatura, segredo))) return resp({ error: 'unauthorized' }, 401);
    let body;
    try {
      body = JSON.parse(corpo);
    } catch {
      return resp({ error: 'invalid_request' }, 400);
    }

    const tenants = new Map();
    const tenantDe = async pnid => {
      if (!/^[0-9]{5,30}$/.test(String(pnid || ''))) return null;
      if (!tenants.has(pnid)) tenants.set(pnid, await d.tenantDoNumero(String(pnid)));
      return tenants.get(pnid);
    };

    let entrou = 0;
    try {
      for (const { field, value } of lerEventos(body).slice(0, 50)) {
        // ── eventos da Coexy ──
        if (value.event === 'channel_status_update' || field === 'channel_status_update') {
          if (typeof value.channel_id === 'string')
            await d.canal(
              value.channel_id,
              String(value.status || ''),
              value.phone_number_id ? String(value.phone_number_id) : null,
              value.waba_id ? String(value.waba_id) : null,
              typeof value.display_phone_number === 'string' ? value.display_phone_number : null
            );
          log(`coexy: canal ${String(value.status || '?').slice(0, 20)}`);
          continue;
        }
        if (value.event === 'channel_health_update' || field === 'channel_health_update') {
          if (typeof value.channel_id === 'string') {
            const issues = Array.isArray(value.issues) ? value.issues : [];
            const motivo =
              issues
                .map(i => (i && typeof i.description === 'string' ? i.description : ''))
                .filter(Boolean)
                .join(' · ')
                .slice(0, 500) || null;
            await d.saude(
              value.channel_id,
              typeof value.health_state === 'string' ? value.health_state : null,
              motivo,
              typeof value.quality_rating === 'string' ? value.quality_rating : null,
              typeof value.messaging_limit_tier === 'string' ? value.messaging_limit_tier : null
            );
          }
          log(`coexy: saúde ${String(value.health_state || '?').slice(0, 20)}`);
          continue;
        }

        // ── eventos da Meta ──
        const pnid = value.metadata && value.metadata.phone_number_id;
        const recebidas = Array.isArray(value.messages) ? value.messages : [];
        const ecos = Array.isArray(value.message_echoes) ? value.message_echoes : [];
        const statuses = Array.isArray(value.statuses) ? value.statuses : [];
        if (!recebidas.length && !ecos.length && !statuses.length) continue;
        const tenant = await tenantDe(pnid);
        if (!tenant) {
          log('coexy: aviso de número sem cliente (ou sem licença)');
          continue;
        }
        const nomes = new Map(
          (Array.isArray(value.contacts) ? value.contacts : []).map(c => [
            String((c && c.wa_id) || ''),
            c && c.profile && typeof c.profile.name === 'string' ? c.profile.name.slice(0, 120) : null
          ])
        );
        const entra = async (m, deMim) => {
          if (!m || m.group_id) return;
          const numero = String((deMim ? m.to : m.from) || '').replace(/\D/g, '');
          const texto = textoDe(m);
          const externo = typeof m.id === 'string' && WAMID.test(m.id) ? m.id : null;
          if (!NUMERO.test(numero) || !texto || !externo) return;
          const r = await d.receber({
            tenant,
            numero,
            nome: deMim ? null : nomes.get(numero) || null,
            texto: texto.slice(0, 4000),
            externo,
            deMim
          });
          if (r && r.ok) entrou++;
          else log(`coexy: mensagem recusada (${(r && r.erro) || 'erro'})`);
        };
        for (const m of recebidas.slice(0, 50)) await entra(m, false);
        for (const m of ecos.slice(0, 50)) await entra(m, true);
        for (const st of statuses.slice(0, 100)) {
          if (!st || typeof st.id !== 'string' || !WAMID.test(st.id)) continue;
          if (!['sent', 'delivered', 'read', 'failed'].includes(st.status)) continue;
          const ts = Number(st.timestamp);
          await d.status(
            tenant,
            st.id,
            st.status,
            Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null
          );
          if (st.status === 'failed') {
            const e = Array.isArray(st.errors) && st.errors[0] ? st.errors[0] : {};
            log(`coexy: entrega falhou (${Number(e.code) || '?'})`);
          }
        }
      }
    } catch {
      log('coexy: falha ao gravar');
      return resp({ error: 'temporarily_unavailable' }, 500);
    }
    return resp({ ok: true, entrou });
  };
}
