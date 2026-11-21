// ─── Cliente da Evolution API (v2) ───────────────────────────────────────────
// Só roda no servidor: a chave global da Evolution (SIIMOB_EVOLUTION_KEY) e o
// endereço do servidor (SIIMOB_EVOLUTION_URL) nunca chegam ao navegador.
// `fetch` é injetável para os testes.

export class ErroEvolution extends Error {
  constructor(motivo, status = 0) {
    super(motivo);
    this.motivo = motivo;
    this.status = status;
  }
}

const EVENTOS = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'];
const NOME = /^[a-z0-9-]{3,60}$/;
const QR = /^data:image\/png;base64,[A-Za-z0-9+/=]{100,400000}$/;

/** Só dígitos do JID ("5598...@s.whatsapp.net" -> "5598..."). */
export function digitosDoJid(jid) {
  const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(String(jid || ''));
  return m ? m[1] : null;
}

export function criarEvolution({ url, chave, fetch: f = fetch, espera = 15000 }) {
  const base = String(url || '').replace(/\/+$/, '');
  const configurado = /^https:\/\/[^\s/]+/.test(base) && !!chave;

  async function chamar(metodo, caminho, corpo) {
    if (!configurado) throw new ErroEvolution('servidor_nao_configurado');
    let r;
    try {
      r = await f(`${base}${caminho}`, {
        method: metodo,
        headers: { apikey: chave, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(espera)
      });
    } catch {
      throw new ErroEvolution('servidor_sem_resposta');
    }
    const txt = await r.text().catch(() => '');
    let body = null;
    try {
      body = txt ? JSON.parse(txt) : null;
    } catch {
      body = null;
    }
    if (!r.ok)
      throw new ErroEvolution(
        r.status === 404
          ? 'instancia_nao_encontrada'
          : r.status === 401 || r.status === 403
            ? 'chave_recusada'
            : 'erro_evolution',
        r.status
      );
    return body;
  }
  const nome = i => {
    if (!NOME.test(i)) throw new ErroEvolution('instancia_invalida');
    return encodeURIComponent(i);
  };
  const qrDe = b => {
    const q = (b && (b.qrcode || b)) || {};
    return {
      qr: typeof q.base64 === 'string' && QR.test(q.base64) ? q.base64 : null,
      codigo:
        typeof q.pairingCode === 'string' && /^[A-Z0-9-]{4,16}$/.test(q.pairingCode) ? q.pairingCode : null
    };
  };

  async function definirWebhook(instancia, webhookUrl) {
    try {
      await chamar('POST', `/webhook/set/${nome(instancia)}`, {
        webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: EVENTOS }
      });
    } catch (e) {
      if (e instanceof ErroEvolution && e.motivo === 'servidor_nao_configurado') throw e;
      // versões mais antigas da v2 usam o formato plano
      await chamar('POST', `/webhook/set/${nome(instancia)}`, {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: EVENTOS
      });
    }
  }

  return {
    configurado,
    async criar(instancia, webhookUrl) {
      const b = await chamar('POST', '/instance/create', {
        instanceName: instancia,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        groupsIgnore: true,
        rejectCall: false,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false
      });
      await definirWebhook(instancia, webhookUrl);
      return qrDe(b);
    },
    definirWebhook,
    async qr(instancia) {
      return qrDe(await chamar('GET', `/instance/connect/${nome(instancia)}`));
    },
    async estado(instancia) {
      const b = await chamar('GET', `/instance/connectionState/${nome(instancia)}`);
      const s = String((b && b.instance && b.instance.state) || (b && b.state) || '');
      return s === 'open' ? 'conectado' : s === 'connecting' ? 'conectando' : 'desconectado';
    },
    async perfil(instancia) {
      const b = await chamar('GET', `/instance/fetchInstances?instanceName=${nome(instancia)}`);
      const i = Array.isArray(b) ? b[0] : b && b.instance ? b.instance : b;
      return {
        numero: digitosDoJid(i && (i.ownerJid || i.owner)),
        nome: typeof (i && i.profileName) === 'string' ? i.profileName.slice(0, 120) : null
      };
    },
    async sair(instancia) {
      try {
        await chamar('DELETE', `/instance/logout/${nome(instancia)}`);
      } catch (e) {
        if (!(e instanceof ErroEvolution) || e.motivo === 'servidor_nao_configurado') throw e;
      }
      try {
        await chamar('DELETE', `/instance/delete/${nome(instancia)}`);
      } catch (e) {
        if (!(e instanceof ErroEvolution) || e.motivo !== 'instancia_nao_encontrada') throw e;
      }
    },
    /** Envia texto; devolve o id da mensagem no WhatsApp. */
    async enviarTexto(instancia, numero, texto, atraso = 1200) {
      if (!/^\d{10,15}$/.test(String(numero))) throw new ErroEvolution('numero_invalido');
      const b = await chamar('POST', `/message/sendText/${nome(instancia)}`, {
        number: String(numero),
        text: String(texto),
        delay: atraso
      });
      const id = b && b.key && typeof b.key.id === 'string' ? b.key.id.slice(0, 120) : null;
      return { id };
    }
  };
}
