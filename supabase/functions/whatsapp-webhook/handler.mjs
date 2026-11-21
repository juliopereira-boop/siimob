// ─── whatsapp-webhook: avisos da Evolution entram no SIIMOB ──────────────────
//
// A Evolution chama esta função a cada mensagem recebida (ou enviada pelo
// celular da empresa), a cada mudança de conexão e a cada QR novo. O endereço
// leva a instância e um token só desta conexão (?i=...&t=...): o banco guarda
// só o hash do token (a1_wa_webhook_tenant).
//
// O que entra: mensagem de conversa individual. Grupo, status, canal
// (newsletter), reação e mensagem de protocolo são ignorados.
// O log nunca leva texto de mensagem nem número de telefone.

const INSTANCIA = /^[a-z0-9-]{3,60}$/;
const TOKEN = /^[0-9a-f]{64}$/;

function ok(body = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

/** Só dígitos de um JID individual; null para grupo, status, LID sem número. */
export function numeroDe(key = {}, data = {}) {
  const jids = [key.remoteJid, key.remoteJidAlt, key.senderPn, data.senderPn, key.participantAlt];
  for (const j of jids) {
    const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(String(j || ''));
    if (m) return m[1];
  }
  return null;
}

export function ignorarJid(jid) {
  const j = String(jid || '');
  return (
    !j ||
    j.endsWith('@g.us') ||
    j.endsWith('@broadcast') ||
    j.endsWith('@newsletter') ||
    j === 'status@broadcast'
  );
}

/** O texto que vai para a Central (mídia vira um marcador). null = não entra. */
export function textoDe(message) {
  const m = message && typeof message === 'object' ? message : {};
  const inner =
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.documentWithCaptionMessage?.message;
  if (inner) return textoDe(inner);
  if (
    m.reactionMessage ||
    m.protocolMessage ||
    (m.senderKeyDistributionMessage && Object.keys(m).length === 1)
  )
    return null;
  const s = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const t =
    s(m.conversation) ||
    s(m.extendedTextMessage?.text) ||
    s(m.buttonsResponseMessage?.selectedDisplayText) ||
    s(m.listResponseMessage?.title) ||
    s(m.templateButtonReplyMessage?.selectedDisplayText);
  if (t) return t;
  if (m.imageMessage)
    return s(m.imageMessage.caption) ? `[imagem] ${m.imageMessage.caption.trim()}` : '[imagem]';
  if (m.videoMessage)
    return s(m.videoMessage.caption) ? `[vídeo] ${m.videoMessage.caption.trim()}` : '[vídeo]';
  if (m.audioMessage) return '[áudio]';
  if (m.documentMessage)
    return `[documento] ${s(m.documentMessage.fileName) || s(m.documentMessage.caption) || ''}`.trim();
  if (m.stickerMessage) return '[figurinha]';
  if (m.locationMessage || m.liveLocationMessage) return '[localização]';
  if (m.contactMessage || m.contactsArrayMessage) return '[contato]';
  return null;
}

/**
 * Dependências: tenantDo(instancia, token) -> uuid|null;
 * receber({tenant, numero, nome, texto, externo, deMim}) -> resposta de a1_wa_receber;
 * estado(tenant, estado, numero, nome); log(msg).
 */
export function createHandler({ tenantDo, receber, estado, log = () => {} }) {
  return async req => {
    if (req.method !== 'POST') return ok({ error: 'method' }, 405);
    const u = new URL(req.url);
    const instancia = u.searchParams.get('i') || '';
    const token = u.searchParams.get('t') || '';
    if (!INSTANCIA.test(instancia) || !TOKEN.test(token)) return ok({ error: 'unauthorized' }, 401);
    let tenant;
    try {
      tenant = await tenantDo(instancia, token);
    } catch {
      return ok({ error: 'temporarily_unavailable' }, 503);
    }
    if (!tenant) return ok({ error: 'unauthorized' }, 401);

    let body;
    try {
      body = await req.json();
    } catch {
      return ok({ error: 'invalid_request' }, 400);
    }
    // Aviso de outra instância com o token desta: recusa.
    if (body && typeof body.instance === 'string' && body.instance !== instancia)
      return ok({ error: 'unauthorized' }, 401);
    const evento = String((body && body.event) || '')
      .toLowerCase()
      .replace(/_/g, '.');

    try {
      if (evento === 'messages.upsert') {
        const lista = Array.isArray(body.data)
          ? body.data
          : Array.isArray(body.data?.messages)
            ? body.data.messages
            : [body.data];
        let entrou = 0;
        for (const data of lista.slice(0, 50)) {
          const key = (data && data.key) || {};
          if (ignorarJid(key.remoteJid)) continue;
          const numero = numeroDe(key, data);
          const texto = textoDe(data && data.message);
          const externo = typeof key.id === 'string' && /^[A-Za-z0-9_-]{6,120}$/.test(key.id) ? key.id : null;
          if (!numero || !texto || !externo) continue;
          const deMim = key.fromMe === true;
          const r = await receber({
            tenant,
            numero,
            nome: deMim ? null : typeof data.pushName === 'string' ? data.pushName.slice(0, 120) : null,
            texto: texto.slice(0, 4000),
            externo,
            deMim
          });
          if (r && r.ok) entrou++;
          else log(`whatsapp: mensagem recusada (${(r && r.erro) || 'erro'})`);
        }
        return ok({ ok: true, entrou });
      }
      if (evento === 'connection.update') {
        const s = String(body.data?.state || '');
        const novo =
          s === 'open'
            ? 'conectado'
            : s === 'connecting'
              ? 'conectando'
              : s === 'close'
                ? 'desconectado'
                : null;
        if (novo) {
          const jid = body.data?.wuid || body.sender || '';
          const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(String(jid));
          await estado(
            tenant,
            novo,
            novo === 'conectado' && m ? m[1] : null,
            typeof body.data?.profileName === 'string' ? body.data.profileName : null
          );
          log(`whatsapp: conexão ${novo}`);
        }
        return ok();
      }
      if (evento === 'qrcode.updated') {
        await estado(tenant, 'aguardando_qr', null, null);
        return ok();
      }
      return ok({ ok: true, ignorado: true });
    } catch {
      log('whatsapp: falha ao gravar');
      // 500: a Evolution tenta de novo; a1_wa_receber não duplica.
      return ok({ error: 'temporarily_unavailable' }, 500);
    }
  };
}
