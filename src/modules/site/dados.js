// @ts-check
// ─── O site público lê o banco com a chave pública ───────────────────────────
//
// Quem visita /links, /contato e /blog não tem login. A RLS das tabelas do site
// (database/migrations/2026-11-12_site_links_blog.sql) entrega só o que está no
// ar; aqui não há filtro de segurança, só de apresentação. Toda leitura que
// falha devolve "sem dado", e a página mostra o seu estado vazio em vez de
// quebrar: um link na bio do Instagram não pode abrir uma tela de erro.
import { A1_KEY, A1_URL } from '../../shared/api/config.js';

const H = { apikey: A1_KEY, Authorization: 'Bearer ' + A1_KEY };

/** @param {string} caminho @returns {Promise<any[]|null>} null = não deu para ler */
async function ler(caminho) {
  try {
    const r = await fetch(`${A1_URL}/rest/v1/${caminho}`, { headers: H });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{links_titulo?: string, links_frase?: string, whatsapp?: string|null,
 *   whatsapp_msg?: string|null, email?: string|null, telefone?: string|null,
 *   horario?: string|null, endereco?: string|null, instagram?: string|null,
 *   linkedin?: string|null, youtube?: string|null, facebook?: string|null,
 *   tiktok?: string|null}} ConfigSite
 */

/** @type {Promise<ConfigSite>|null} */
let configPedida = null;
/** A configuração do site (uma linha). Pedida uma vez por página. */
export function lerConfig() {
  if (!configPedida) configPedida = ler('a1_site_config?id=eq.1&select=*').then(l => (l && l[0]) || {});
  return configPedida;
}

/** Os itens da página de links, na ordem. null quando a leitura falhou. */
export function lerLinks() {
  return ler(
    'a1_site_links?select=id,tipo,titulo,subtitulo,url,imagem_url,icone,nova_aba,ordem&order=ordem.asc,criado_em.asc'
  );
}

const CAMPOS_POST = 'id,slug,titulo,resumo,capa_url,categoria,autor,tempo_leitura,destaque,publicado_em';
/** Posts publicados, do mais novo ao mais antigo (sem o texto, que pesa). */
export function lerPosts() {
  return ler(`a1_blog_posts?select=${CAMPOS_POST}&order=publicado_em.desc`);
}
/** Um post inteiro pelo endereço. */
export async function lerPost(/** @type {string} */ slug) {
  const l = await ler(`a1_blog_posts?slug=eq.${encodeURIComponent(slug)}&select=${CAMPOS_POST},conteudo`);
  return l ? l[0] || null : undefined;
}

/** Conta o clique sem segurar a navegação: o pedido sobrevive à troca de página. */
export function contarClique(/** @type {string} */ id) {
  try {
    fetch(`${A1_URL}/rest/v1/rpc/a1_site_link_clique`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id }),
      keepalive: true
    }).catch(() => {});
  } catch {
    /* contar clique nunca atrapalha o clique */
  }
}

/**
 * O formulário de contato grava em a1_leads, a mesma tabela do formulário da LP,
 * que só o superadmin lê (aba Interessados).
 * @param {{name:string, email:string, phone?:string, company?:string, segment?:string, message?:string}} d
 */
export async function enviarContato(d) {
  const r = await fetch(`${A1_URL}/rest/v1/a1_leads`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      name: d.name.trim(),
      email: d.email.trim(),
      phone: (d.phone || '').trim() || null,
      company: (d.company || '').trim() || null,
      segment: d.segment || null,
      message: (d.message || '').trim() || null,
      source: 'contato'
    })
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}

/** wa.me com a mensagem pronta, ou '' quando não há número. */
export function linkWhatsapp(/** @type {ConfigSite} */ c, /** @type {string=} */ msg) {
  const n = String(c.whatsapp || '').replace(/\D/g, '');
  if (n.length < 10) return '';
  const texto = msg || c.whatsapp_msg || '';
  return `https://wa.me/${n}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;
}

/** Só deixa passar endereço que um link pode abrir com segurança. */
export function urlSegura(/** @type {any} */ u) {
  const s = String(u || '').trim();
  if (/^https?:\/\//i.test(s) || /^(mailto|tel):/i.test(s)) return s;
  if (/^\/(?!\/)/.test(s)) return s;
  return '';
}

/** 12 de novembro de 2026 */
export function dataLonga(/** @type {any} */ iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(+d) ? '' : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}
