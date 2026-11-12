// ─── sa-proxy: o superadmin entra com o autenticador, a chave fica aqui ─────
//
// O painel do superadmin falava com o banco usando a Service Role Key colada no
// navegador. Agora ele entra com o código do app autenticador e recebe uma
// sessão; esta função confere a sessão e repassa o pedido ao REST e ao Storage
// do Supabase com a chave de serviço, que nunca sai do servidor.
//
//   GET  /sa-proxy/status        o autenticador já foi cadastrado?
//   POST /sa-proxy/login         { codigo } -> { token, expira_em }
//   POST /sa-proxy/sair          encerra a sessão do cabeçalho x-sa-sessao
//   *    /sa-proxy/rest/v1/...   repassado ao PostgREST (exige sessão)
//   *    /sa-proxy/storage/v1/...repassado ao Storage (exige sessão)
//
// Quem confere o código, trava tentativas e guarda a sessão é o banco
// (database/migrations/2026-11-12_superadmin_autenticador.sql). Este arquivo é
// JavaScript puro, sem nada do Deno, para ser testado em Node
// (testes/t-sa-proxy.js); index.ts só liga o servidor. É .mjs para o Node não
// precisar adivinhar o tipo do módulo.

const ORIGENS_PADRAO = [
  'https://siimob.com',
  'https://www.siimob.com',
  'https://siimob.com.br',
  'https://www.siimob.com.br',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:8098',
  'http://localhost:8099',
  'http://127.0.0.1:8098',
  'http://127.0.0.1:8099'
];

// Cabeçalhos que o painel manda e que o PostgREST/Storage precisam. O resto
// (inclusive Authorization e apikey do navegador) não passa.
const REPASSA = [
  'content-type',
  'prefer',
  'range',
  'range-unit',
  'accept',
  'accept-profile',
  'content-profile',
  'x-upsert',
  'cache-control'
];
const DEVOLVE = ['content-type', 'content-range', 'content-location', 'preference-applied'];

/**
 * @param {{url: string, chave: string, origens?: string, fetch?: typeof fetch, cacheMs?: number}} cfg
 * @returns {(req: Request) => Promise<Response>}
 */
export function criarTratador(cfg) {
  const base = String(cfg.url || '').replace(/\/$/, '');
  const chave = String(cfg.chave || '');
  const buscar = cfg.fetch || fetch;
  const origens = cfg.origens
    ? cfg.origens
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : ORIGENS_PADRAO;
  const cacheMs = cfg.cacheMs ?? 30000;
  /** Sessões conferidas há pouco: poupa uma ida ao banco por pedido. */
  const conferidas = new Map();

  const cors = (/** @type {Request} */ req) => {
    const o = req.headers.get('origin') || '';
    /** @type {Record<string,string>} */
    const h = {
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'authorization, apikey, x-client-info, x-sa-sessao, content-type, prefer, range, range-unit, accept, accept-profile, content-profile, x-upsert, cache-control',
      'Access-Control-Expose-Headers': 'content-range, content-location, preference-applied',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin'
    };
    if (origens.includes(o)) h['Access-Control-Allow-Origin'] = o;
    return h;
  };
  const json = (/** @type {Request} */ req, /** @type {any} */ corpo, status = 200) =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { ...cors(req), 'Content-Type': 'application/json' }
    });

  /** Chama uma função do banco com a chave de serviço. */
  async function rpc(/** @type {string} */ nome, /** @type {any} */ corpo) {
    const r = await buscar(`${base}/rest/v1/rpc/${nome}`, {
      method: 'POST',
      headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo || {})
    });
    if (!r.ok) throw new Error(`rpc ${nome}: HTTP ${r.status}`);
    // Função void: o PostgREST responde 204 sem corpo.
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  }

  async function sessaoValida(/** @type {string} */ token) {
    if (!/^[0-9a-f]{64}$/.test(token)) return false;
    const ate = conferidas.get(token);
    if (ate && ate > Date.now()) return true;
    const ok = (await rpc('a1_sa_sessao_valida', { p_token: token })) === true;
    if (ok) conferidas.set(token, Date.now() + cacheMs);
    else conferidas.delete(token);
    return ok;
  }

  const ipDe = (/** @type {Request} */ req) =>
    (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || '').split(',')[0].trim() ||
    null;

  return async function tratar(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (!base || !chave) return json(req, { message: 'sa-proxy sem configuração' }, 500);
    const u = new URL(req.url);
    // O Supabase entrega o caminho com o nome da função na frente.
    const i = u.pathname.indexOf('/sa-proxy');
    const rota = i >= 0 ? u.pathname.slice(i + '/sa-proxy'.length) || '/' : u.pathname;

    try {
      if (rota === '/status' && req.method === 'GET') return json(req, await rpc('a1_sa_totp_status', {}));

      if (rota === '/login' && req.method === 'POST') {
        const corpo = await req.json().catch(() => ({}));
        const codigo = String((corpo && corpo.codigo) || '').replace(/\D/g, '');
        const r = await rpc('a1_sa_login', {
          p_codigo: codigo,
          p_ip: ipDe(req),
          p_agente: (req.headers.get('user-agent') || '').slice(0, 300)
        });
        const status =
          r && r.ok ? 200 : r && r.erro === 'bloqueado' ? 429 : r && r.erro === 'nao_configurado' ? 409 : 401;
        return json(req, r, status);
      }

      const token = (req.headers.get('x-sa-sessao') || '').trim();

      if (rota === '/sair' && req.method === 'POST') {
        if (/^[0-9a-f]{64}$/.test(token)) await rpc('a1_sa_sair', { p_token: token });
        conferidas.delete(token);
        return json(req, { ok: true });
      }

      if (!/^\/(rest|storage)\/v1\//.test(rota)) return json(req, { message: 'rota_desconhecida' }, 404);
      if (!(await sessaoValida(token))) return json(req, { message: 'sessao_invalida' }, 401);

      /** @type {Record<string,string>} */
      const h = { apikey: chave, Authorization: `Bearer ${chave}` };
      REPASSA.forEach(k => {
        const v = req.headers.get(k);
        if (v) h[k] = v;
      });
      const temCorpo = !['GET', 'HEAD'].includes(req.method);
      const r = await buscar(`${base}${rota}${u.search}`, {
        method: req.method,
        headers: h,
        body: temCorpo ? await req.arrayBuffer() : undefined
      });
      /** @type {Record<string,string>} */
      const volta = { ...cors(req) };
      DEVOLVE.forEach(k => {
        const v = r.headers.get(k);
        if (v) volta[k] = v;
      });
      return new Response(r.status === 204 ? null : await r.arrayBuffer(), {
        status: r.status,
        headers: volta
      });
    } catch (e) {
      return json(req, { message: 'falha_no_proxy', detalhe: String((e && e.message) || e) }, 502);
    }
  };
}
