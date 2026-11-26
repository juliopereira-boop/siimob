// ─── Cliente da Coexy (WhatsApp oficial, API da Meta) ────────────────────────
// Só roda no servidor. Duas credenciais, que não se misturam:
//   - COEXY_API_KEY (x-api-key): canais e webhooks da conta da plataforma.
//   - channel_token (Bearer) de cada canal: envio pelo meta-proxy, que repassa
//     para a Cloud API v23 da Meta com o mesmo corpo da documentação dela.
// O navegador nunca vê nenhuma das duas. `fetch` é injetável para os testes.

export class ErroCoexy extends Error {
  /**
   * @param {string} motivo  código curto (canal_inativo, fora_da_janela...)
   * @param {number} status  status HTTP (0 sem resposta)
   * @param {boolean} reserva  a Evolution pode tentar no lugar
   * @param {string|null} detalhe  mensagem da Meta, sem dado pessoal
   */
  constructor(motivo, status = 0, reserva = false, detalhe = null) {
    super(motivo);
    this.motivo = motivo;
    this.status = status;
    this.reserva = reserva;
    this.detalhe = detalhe;
  }
}

const BASE = 'https://api.coexy.com.br/functions/v1';
const ID = /^[0-9]{5,30}$/;
const UUID = /^[0-9a-f-]{36}$/;
const NOME_MODELO = /^[a-z0-9_]{1,512}$/;

/** Classifica a resposta de erro do meta-proxy (ou da Meta, repassada). */
export function classificar(status, body) {
  const b = body && typeof body === 'object' ? body : {};
  const metaErro = b.error && typeof b.error === 'object' ? b.error : null;
  const code = metaErro ? Number(metaErro.code) : NaN;
  const sub = metaErro ? Number(metaErro.error_subcode) : NaN;
  const detalhe = metaErro && typeof metaErro.message === 'string' ? metaErro.message.slice(0, 200) : null;
  const coexyCode = String(
    b.code || (b.coexy && b.coexy.code) || (typeof b.error === 'string' ? b.error : '')
  );
  const r = (motivo, reserva) => new ErroCoexy(motivo, status, reserva, detalhe);

  if (code === 133010 || coexyCode === 'PHONE_NOT_REGISTERED') return r('numero_desconectado', true);
  if (code === 131047) return r('fora_da_janela', true);
  if (code === 131026) return r('nao_entregavel', false);
  if (code === 131042 || code === 141006) return r('pagamento_meta', true);
  if ([130429, 131048, 131056, 80007, 4, 80004].includes(code)) return r('limite_meta', true);
  if (code >= 132000 && code < 133000) return r('modelo_invalido', false);
  if (code === 131049) return r('meta_segurou', false); // a Meta segurou marketing para esta pessoa: respeita
  if (status === 401) return r('token_canal', true);
  if (status === 402) return r('assinatura_coexy', true);
  if (status === 403 && /managed_by_coexy/.test(coexyCode)) return r('gerenciado', false);
  if (status === 403) return r('canal_inativo', true);
  if (status === 429) return r('limite_meta', true);
  if (status === 503 || /CHANNEL_DISCONNECTED/.test(coexyCode)) return r('canal_desconectado', true);
  if (status >= 500) return r('sem_resposta', true);
  if (Number.isFinite(sub) && sub === 2494010) return r('nao_entregavel', false);
  return r('recusado', false);
}

/** Só dígitos de "+55 11 99999-9999". */
const digitos = v => {
  const d = String(v || '').replace(/\D/g, '');
  return /^[0-9]{8,15}$/.test(d) ? d : null;
};

/** O canal como o SIIMOB guarda (aceita o formato da API e o do MCP). */
export function normalizarCanal(c) {
  const x = c && typeof c === 'object' ? c : {};
  const saude = (x.health && x.health.state) || x.health_state || null;
  const issues = Array.isArray(x.health && x.health.issues)
    ? x.health.issues
    : Array.isArray(x.issues)
      ? x.issues
      : [];
  const motivo =
    issues
      .slice()
      .sort((a, b) => Number(!!(b && b.blocking)) - Number(!!(a && a.blocking)))
      .map(i => (i && typeof i.description === 'string' ? i.description : ''))
      .filter(Boolean)
      .join(' · ')
      .slice(0, 500) || null;
  return {
    id: typeof x.id === 'string' && UUID.test(x.id) ? x.id : null,
    status: ['pending', 'active', 'disconnected', 'suspended'].includes(x.status) ? x.status : 'pending',
    phone_number_id: ID.test(String(x.phone_number_id || '')) ? String(x.phone_number_id) : null,
    waba_id: ID.test(String(x.waba_id || '')) ? String(x.waba_id) : null,
    numero: digitos(x.display_phone_number || x.phone_number),
    connect_url:
      typeof x.connect_url === 'string' && /^https:\/\//.test(x.connect_url)
        ? x.connect_url.slice(0, 600)
        : null,
    channel_token:
      typeof x.channel_token === 'string' && x.channel_token.length >= 10 ? x.channel_token : null,
    saude: ['healthy', 'warning', 'restricted', 'blocked', 'banned'].includes(saude) ? saude : null,
    saude_motivo: motivo,
    qualidade: typeof x.quality_rating === 'string' ? x.quality_rating.slice(0, 20) : null,
    limite: typeof x.messaging_limit_tier === 'string' ? x.messaging_limit_tier.slice(0, 30) : null
  };
}

/** Variáveis {{1}}, {{2}}... do texto, em ordem. */
export function variaveis(texto) {
  const s = new Set();
  for (const m of String(texto || '').matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g)) s.add(Number(m[1]));
  return [...s].sort((a, b) => a - b);
}

/** Troca {{n}} pelos valores (para gravar na conversa o texto que saiu). */
export function preencher(texto, valores) {
  return String(texto || '').replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (m, n) => {
    const v = valores[Number(n) - 1];
    return v === undefined ? m : String(v);
  });
}

/** Um modelo da Meta como a tela usa. "suportado": dá para mandar daqui. */
export function normalizarModelo(t) {
  const comps = Array.isArray(t && t.components) ? t.components : [];
  const corpo = comps.find(c => c && c.type === 'BODY') || {};
  const cab = comps.find(c => c && c.type === 'HEADER');
  const rodape = comps.find(c => c && c.type === 'FOOTER');
  const botoes = comps.find(c => c && c.type === 'BUTTONS');
  const vars = variaveis(corpo.text);
  const sequencial = vars.every((n, i) => n === i + 1);
  const cabSimples = !cab || (cab.format === 'TEXT' && variaveis(cab.text).length === 0);
  const botoesSimples =
    !botoes ||
    (Array.isArray(botoes.buttons) &&
      botoes.buttons.every(
        b =>
          b &&
          (b.type === 'QUICK_REPLY' ||
            b.type === 'PHONE_NUMBER' ||
            (b.type === 'URL' && !/\{\{/.test(b.url || '')))
      ));
  return {
    nome: String((t && t.name) || ''),
    idioma: String((t && t.language) || ''),
    categoria: String((t && t.category) || ''),
    status: String((t && t.status) || ''),
    corpo: typeof corpo.text === 'string' ? corpo.text : '',
    cabecalho: cab && cab.format === 'TEXT' && typeof cab.text === 'string' ? cab.text : null,
    rodape: rodape && typeof rodape.text === 'string' ? rodape.text : null,
    variaveis: vars.length,
    suportado:
      (t && t.parameter_format) !== 'NAMED' && sequencial && cabSimples && botoesSimples && !!corpo.text
  };
}

export function criarCoexy({ chave, fetch: f = fetch, espera = 15000, base = BASE }) {
  const configurado = typeof chave === 'string' && chave.length >= 10;

  async function chamar(url, init) {
    let r;
    try {
      r = await f(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(espera) });
    } catch {
      throw new ErroCoexy('sem_resposta', 0, true);
    }
    const txt = await r.text().catch(() => '');
    let body = null;
    try {
      body = txt ? JSON.parse(txt) : null;
    } catch {
      body = null;
    }
    return { r, body };
  }

  // Management API (x-api-key)
  async function api(metodo, caminho, corpo) {
    if (!configurado) throw new ErroCoexy('coexy_nao_configurado');
    const { r, body } = await chamar(`${base}/api${caminho}`, {
      method: metodo,
      headers: { 'x-api-key': chave, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    if (!r.ok) {
      const msg = String((body && (body.error || body.message)) || '');
      throw new ErroCoexy(
        r.status === 404
          ? 'nao_encontrado'
          : r.status === 401
            ? 'chave_coexy'
            : /trial_channel_limit/.test(msg)
              ? 'limite_canais'
              : r.status === 402
                ? 'assinatura_coexy'
                : 'erro_coexy',
        r.status
      );
    }
    return body;
  }

  // meta-proxy (Bearer channel_token)
  async function proxy(token, metodo, caminho, corpo) {
    if (typeof token !== 'string' || token.length < 10) throw new ErroCoexy('token_canal', 401, true);
    const form = typeof FormData !== 'undefined' && corpo instanceof FormData;
    const { r, body } = await chamar(`${base}/meta-proxy${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(corpo && !form ? { 'Content-Type': 'application/json' } : {})
      },
      body: corpo ? (form ? corpo : JSON.stringify(corpo)) : undefined
    });
    if (!r.ok) throw classificar(r.status, body);
    return body;
  }

  const pnid = id => {
    if (!ID.test(String(id || ''))) throw new ErroCoexy('canal_inativo', 0, true);
    return String(id);
  };
  const numeroOk = n => {
    if (!/^\d{10,15}$/.test(String(n))) throw new ErroCoexy('numero_invalido');
    return String(n);
  };
  const wamid = b => {
    const id = b && Array.isArray(b.messages) && b.messages[0] && b.messages[0].id;
    return typeof id === 'string' ? id.slice(0, 120) : null;
  };
  async function enviar(phoneId, token, corpo, idem) {
    const b = await proxy(token, 'POST', `/${pnid(phoneId)}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...corpo,
      ...(idem ? { idempotency_key: String(idem).slice(0, 120) } : {})
    });
    return { id: wamid(b) };
  }

  return {
    configurado,

    // ── Canais ──
    async criarCanal(nome) {
      return normalizarCanal(await api('POST', '/channels', { name: String(nome).slice(0, 80) }));
    },
    async canal(id) {
      if (!UUID.test(String(id))) throw new ErroCoexy('nao_encontrado', 404);
      return normalizarCanal(await api('GET', `/channels/${id}`));
    },
    async apagarCanal(id) {
      if (!UUID.test(String(id))) return;
      try {
        await api('DELETE', `/channels/${id}?force=true`);
      } catch (e) {
        if (!(e instanceof ErroCoexy) || e.motivo !== 'nao_encontrado') throw e;
      }
    },

    // ── Webhook da plataforma ──
    async webhooks() {
      const b = await api('GET', '/webhooks');
      return (Array.isArray(b) ? b : Array.isArray(b && b.webhooks) ? b.webhooks : []).map(w => ({
        id: String((w && w.id) || ''),
        url: String((w && w.url) || '')
      }));
    },
    async criarWebhook(url, eventos) {
      const b = await api('POST', '/webhooks', {
        name: 'SIIMOB',
        url,
        events: eventos,
        payload_format: 'meta'
      });
      if (!b || typeof b.id !== 'string' || typeof b.hmac_secret !== 'string')
        throw new ErroCoexy('erro_coexy', 502);
      return { id: b.id, hmac_secret: b.hmac_secret };
    },
    async apagarWebhook(id) {
      if (!UUID.test(String(id))) return;
      try {
        await api('DELETE', `/webhooks/${id}`);
      } catch (e) {
        if (!(e instanceof ErroCoexy) || e.motivo !== 'nao_encontrado') throw e;
      }
    },

    // ── Envio ──
    async enviarTexto(phoneId, token, numero, texto, idem) {
      return enviar(
        phoneId,
        token,
        {
          to: numeroOk(numero),
          type: 'text',
          text: { body: String(texto).slice(0, 4096), preview_url: true }
        },
        idem
      );
    },
    /** anexo: {dados(base64), mime, nome} ou {url, mime, nome}. */
    async enviarMidia(phoneId, token, numero, anexo, legenda, idem) {
      const tipo = String(anexo.mime || '').startsWith('image/') ? 'image' : 'document';
      let ref;
      if (anexo.url) ref = { link: anexo.url };
      else {
        const bytes = Uint8Array.from(atob(anexo.dados), c => c.charCodeAt(0));
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('type', anexo.mime);
        form.append('file', new Blob([bytes], { type: anexo.mime }), anexo.nome || 'arquivo');
        const up = await proxy(token, 'POST', `/${pnid(phoneId)}/media`, form);
        if (!up || typeof up.id !== 'string') throw new ErroCoexy('recusado', 400);
        ref = { id: up.id };
      }
      const media = {
        ...ref,
        ...(legenda ? { caption: String(legenda).slice(0, 1024) } : {}),
        ...(tipo === 'document' ? { filename: String(anexo.nome || 'arquivo').slice(0, 120) } : {})
      };
      return enviar(phoneId, token, { to: numeroOk(numero), type: tipo, [tipo]: media }, idem);
    },
    async enviarModelo(phoneId, token, numero, nome, idioma, parametros, idem) {
      if (!NOME_MODELO.test(String(nome))) throw new ErroCoexy('modelo_invalido');
      const valores = (Array.isArray(parametros) ? parametros : []).map(v => ({
        type: 'text',
        text: String(v).slice(0, 1024)
      }));
      return enviar(
        phoneId,
        token,
        {
          to: numeroOk(numero),
          type: 'template',
          template: {
            name: String(nome),
            language: { code: String(idioma || 'pt_BR') },
            ...(valores.length ? { components: [{ type: 'body', parameters: valores }] } : {})
          }
        },
        idem
      );
    },

    // ── Modelos de mensagem (na conta WhatsApp Business do cliente) ──
    async modelos(waba, token) {
      if (!ID.test(String(waba || ''))) return [];
      const lista = [];
      let caminho = `/${waba}/message_templates?fields=name,status,category,language,components,parameter_format&limit=100`;
      for (let i = 0; i < 5 && caminho; i++) {
        const b = await proxy(token, 'GET', caminho);
        for (const t of Array.isArray(b && b.data) ? b.data : []) lista.push(normalizarModelo(t));
        const depois = b && b.paging && b.paging.cursors && b.paging.cursors.after;
        caminho =
          b && b.paging && b.paging.next && typeof depois === 'string'
            ? `/${waba}/message_templates?fields=name,status,category,language,components,parameter_format&limit=100&after=${encodeURIComponent(depois)}`
            : null;
      }
      return lista.filter(m => m.nome);
    },
    async criarModelo(waba, token, { nome, categoria, idioma, corpo, exemplos, rodape }) {
      if (!ID.test(String(waba || ''))) throw new ErroCoexy('canal_inativo');
      const components = [
        {
          type: 'BODY',
          text: corpo,
          ...(exemplos.length ? { example: { body_text: [exemplos] } } : {})
        },
        ...(rodape ? [{ type: 'FOOTER', text: rodape }] : [])
      ];
      const b = await proxy(token, 'POST', `/${waba}/message_templates`, {
        name: nome,
        category: categoria,
        language: idioma,
        components
      });
      return { id: b && b.id ? String(b.id) : null, status: b && b.status ? String(b.status) : 'PENDING' };
    },
    async apagarModelo(waba, token, nome) {
      if (!ID.test(String(waba || '')) || !NOME_MODELO.test(String(nome)))
        throw new ErroCoexy('modelo_invalido');
      await proxy(token, 'DELETE', `/${waba}/message_templates?name=${encodeURIComponent(nome)}`);
    }
  };
}
