// @ts-check
// ─── Acesso do superadmin por autenticador ──────────────────────────────────
//
// O painel inteiro fala com o banco por fetch em `${SA_URL}/rest/v1/...` e
// `${SA_URL}/storage/v1/...`, com a chave no cabeçalho. Com a sessão do
// autenticador, a chave não está mais no navegador: este módulo desvia esses
// pedidos para a Edge Function sa-proxy, com o token da sessão no cabeçalho
// x-sa-sessao, e a função os repassa com a chave de serviço. Assim nenhum dos
// pontos do painel que monta URL precisou mudar, e os endereços públicos do
// Storage (que vão gravados no banco) continuam apontando para o Supabase.
//
// A sessão fica no sessionStorage: sobrevive a recarregar a página e morre ao
// fechar a aba. Vale 12 horas no banco.
import qrcode from 'qrcode-generator';
import { A1_KEY, A1_URL } from '../../shared/api/config.js';

export const PROXY = `${A1_URL}/functions/v1/sa-proxy`;
const GUARDA = 'a1_sa_sessao';

/** @type {{token: string, expira_em: string}|null} */
let SESSAO = null;
/** @type {() => void} */
let aoExpirar = () => {};
const nativo = window.fetch.bind(window);

/** O autenticador já foi cadastrado? null = a função não respondeu. */
export async function statusAutenticador() {
  try {
    const r = await nativo(`${PROXY}/status`, {
      headers: { apikey: A1_KEY, Authorization: `Bearer ${A1_KEY}` }
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j === 'object' && !Array.isArray(j) ? { configurado: j.configurado === true } : null;
  } catch {
    return null;
  }
}

/**
 * Troca o código de 6 dígitos por uma sessão.
 * @returns {Promise<{ok: boolean, sessao?: {token: string, expira_em: string}, erro?: string, restantes?: number}>}
 */
export async function entrarComCodigo(/** @type {string} */ codigo) {
  try {
    const r = await nativo(`${PROXY}/login`, {
      method: 'POST',
      headers: { apikey: A1_KEY, Authorization: `Bearer ${A1_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo })
    });
    const j = await r.json().catch(() => ({}));
    if (j && j.ok && j.token) {
      const sessao = { token: j.token, expira_em: j.expira_em };
      guardar(sessao);
      return { ok: true, sessao };
    }
    return {
      ok: false,
      erro: (j && j.erro) || (r.status >= 500 ? 'servidor' : 'codigo_invalido'),
      restantes: j && j.restantes
    };
  } catch {
    return { ok: false, erro: 'servidor' };
  }
}

function guardar(/** @type {{token:string, expira_em:string}} */ s) {
  SESSAO = s;
  try {
    sessionStorage.setItem(GUARDA, JSON.stringify(s));
  } catch {
    /* sem armazenamento: a sessão vive só nesta página */
  }
}

/** A sessão guardada nesta aba, se ainda não venceu. */
export function sessaoSalva() {
  try {
    const s = JSON.parse(sessionStorage.getItem(GUARDA) || 'null');
    if (s && /^[0-9a-f]{64}$/.test(s.token) && new Date(s.expira_em).getTime() > Date.now() + 60000) return s;
  } catch {
    /* nada guardado */
  }
  return null;
}

export const emSessao = () => !!SESSAO;

const desvia = (/** @type {string} */ url) =>
  url.startsWith(A1_URL + '/rest/v1/') ||
  (url.startsWith(A1_URL + '/storage/v1/') && !url.includes('/storage/v1/object/public/'));

/**
 * Liga a sessão: daqui em diante os pedidos do painel vão pela função.
 * @param {{token:string, expira_em:string}} s
 * @param {() => void} expirou chamado quando a função disser que a sessão acabou
 */
export function ligarSessao(s, expirou) {
  guardar(s);
  aoExpirar = expirou;
  if (/** @type {any} */ (window.fetch).__sa) return;
  /** @type {any} */
  const f = (/** @type {RequestInfo|URL} */ entrada, /** @type {RequestInit=} */ init = {}) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (!SESSAO || !desvia(url)) return nativo(entrada, init);
    const h = new Headers(init.headers || undefined);
    h.set('apikey', A1_KEY);
    h.set('Authorization', `Bearer ${A1_KEY}`);
    h.set('x-sa-sessao', SESSAO.token);
    return nativo(PROXY + url.slice(A1_URL.length), { ...init, headers: h }).then(r => {
      if (r.status === 401)
        r.clone()
          .json()
          .then(j => {
            if (j && j.message === 'sessao_invalida') aoExpirar();
          })
          .catch(() => {});
      return r;
    });
  };
  f.__sa = true;
  window.fetch = f;
}

/** Encerra a sessão no banco e esquece o token. */
export async function sairDaSessao() {
  const s = SESSAO;
  SESSAO = null;
  try {
    sessionStorage.removeItem(GUARDA);
  } catch {
    /* nada */
  }
  if (!s) return;
  try {
    await nativo(`${PROXY}/sair`, {
      method: 'POST',
      headers: { apikey: A1_KEY, Authorization: `Bearer ${A1_KEY}`, 'x-sa-sessao': s.token }
    });
  } catch {
    /* a sessão vence sozinha em 12 horas */
  }
}

// ─── Cadastro do autenticador ────────────────────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 20 bytes aleatórios: em hex para o banco, em base32 para o app. */
export function gerarSegredo() {
  const b = crypto.getRandomValues(new Uint8Array(20));
  const hex = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  let bits = '';
  b.forEach(x => (bits += x.toString(2).padStart(8, '0')));
  let base32 = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) base32 += B32[parseInt(bits.slice(i, i + 5), 2)];
  return { hex, base32 };
}

/** O endereço otpauth:// que o app lê no QR. */
export function uriOtp(/** @type {string} */ base32) {
  const rotulo = encodeURIComponent('SIIMOB:Superadmin');
  return `otpauth://totp/${rotulo}?secret=${base32}&issuer=SIIMOB&algorithm=SHA1&digits=6&period=30`;
}

/** O QR code em SVG. */
export function qrSvg(/** @type {string} */ texto) {
  const q = qrcode(0, 'M');
  q.addData(texto);
  q.make();
  return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}

/** "ABCD EFGH ..." para digitar à mão, se a câmera não ajudar. */
export const segredoLegivel = (/** @type {string} */ b32) => b32.replace(/(.{4})/g, '$1 ').trim();
