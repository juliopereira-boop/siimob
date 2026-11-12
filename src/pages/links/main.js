// @ts-check
// ─── /links: a página da bio do Instagram ────────────────────────────────────
//
// Tudo o que aparece aqui o superadmin monta (aba Site): o título e a frase do
// topo, os banners, o botão de destaque, os botões, os separadores e as redes.
// Se o banco não responder, a página mostra os três caminhos fixos do site:
// quem clicou no link da bio nunca chega numa tela vazia.
import { esc } from '../../shared/utils/texto.js';
import { acoes } from '../../shared/ui/acoes.js';
import { NOME_MARCA, SETA, icone, ICONES, marcaSvg } from '../../modules/site/marca.js';
import { contarClique, lerConfig, lerLinks, linkWhatsapp, urlSegura } from '../../modules/site/dados.js';
import { redesDe } from '../../modules/site/casca.js';

const PADRAO = [
  {
    id: '',
    tipo: 'destaque',
    titulo: 'Conheça o SIIMOB',
    subtitulo: 'CRM imobiliário do lead ao registro',
    url: '/conheca',
    icone: 'site',
    nova_aba: false
  },
  { id: '', tipo: 'link', titulo: 'Blog', url: '/blog', icone: 'blog', nova_aba: false },
  { id: '', tipo: 'link', titulo: 'Contato', url: '/contato', icone: 'contato', nova_aba: false }
];

acoes({
  lkClique: el => {
    const id = el.dataset.id;
    if (id) contarClique(id);
  },
  lkCompartilhar: () => compartilhar()
});

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

function alvo(/** @type {any} */ it, /** @type {string} */ url) {
  // Endereço do próprio site abre na mesma aba; o resto, como o superadmin pediu.
  return it.nova_aba !== false && /^https?:/i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
}

/** @param {any} it */
function itemHtml(it) {
  if (it.tipo === 'secao') return `<h2 class="lk-secao">${esc(it.titulo)}</h2>`;
  const url = urlSegura(it.url);
  if (!url) return '';
  const comum = `href="${esc(url)}"${alvo(it, url)} data-acao="lkClique" data-id="${esc(it.id || '')}"`;
  if (it.tipo === 'banner') {
    const img = urlSegura(it.imagem_url);
    if (!img) return '';
    return `<a class="lk-banner" ${comum}>
      <img src="${esc(img)}" alt="${esc(it.titulo)}" loading="eager" decoding="async">
      ${it.subtitulo ? `<span class="lk-banner-leg"><b>${esc(it.titulo)}</b><span>${esc(it.subtitulo)}</span></span>` : ''}
    </a>`;
  }
  const ic = icone(it.icone);
  return `<a class="lk-botao${it.tipo === 'destaque' ? ' lk-destaque' : ''}" ${comum}>
    <span class="lk-ic" aria-hidden="true">${ic}</span>
    <span class="lk-txt"><b>${esc(it.titulo)}</b>${it.subtitulo ? `<small>${esc(it.subtitulo)}</small>` : ''}</span>
    <span class="lk-seta" aria-hidden="true">${SETA}</span>
  </a>`;
}

function pintarLista(/** @type {any[]} */ itens) {
  const lista = $('lk-lista');
  const html = itens.map(itemHtml).filter(Boolean);
  lista.innerHTML = html.length ? html.join('') : PADRAO.map(itemHtml).join('');
  lista.setAttribute('aria-busy', 'false');
  // Entrada em cascata: cada item chega um pouco depois do anterior.
  [...lista.children].forEach((el, i) => {
    /** @type {HTMLElement} */ (el).style.animationDelay = `${Math.min(i, 10) * 55}ms`;
  });
}

function pintarRedes(/** @type {import('../../modules/site/dados.js').ConfigSite} */ c) {
  const itens = redesDe(c).map(([k, u]) => [k, u, ICONES[k].rotulo]);
  const zap = linkWhatsapp(c);
  if (zap) itens.unshift(['whatsapp', zap, 'WhatsApp']);
  const email = String(c.email || '').trim();
  if (email) itens.push(['contato', 'mailto:' + email, 'E-mail']);
  $('lk-redes').innerHTML = itens
    .map(
      ([k, u, rot]) =>
        `<a href="${esc(u)}"${/^https?:/i.test(u) ? ' target="_blank" rel="noopener noreferrer"' : ''} aria-label="${esc(rot)}" title="${esc(rot)}">${icone(k)}</a>`
    )
    .join('');
}

async function compartilhar() {
  const dados = { title: document.title, url: location.origin + location.pathname };
  try {
    if (navigator.share) {
      await navigator.share(dados);
      return;
    }
    await navigator.clipboard.writeText(dados.url);
    avisar('Link copiado');
  } catch (e) {
    if (e && /** @type {any} */ (e).name !== 'AbortError') avisar('Não deu para copiar o link');
  }
}

function avisar(/** @type {string} */ msg) {
  const a = $('lk-aviso');
  a.textContent = msg;
  a.classList.add('on');
  setTimeout(() => a.classList.remove('on'), 2200);
}

async function iniciar() {
  $('lk-selo').innerHTML = marcaSvg({ id: 'mlk', tamanho: 46, claro: true });
  $('lk-pe-marca').innerHTML = `${marcaSvg({ id: 'mpe', tamanho: 18, claro: true })}${NOME_MARCA}`;
  const [c, itens] = await Promise.all([lerConfig(), lerLinks()]);
  // O nome da marca sai com o segundo I no verde-mar, como no logo.
  const titulo = String(c.links_titulo || 'SIIMOB').trim();
  if (titulo.toUpperCase() === 'SIIMOB') $('lk-titulo').innerHTML = NOME_MARCA;
  else $('lk-titulo').textContent = titulo;
  if (c.links_frase) $('lk-frase').textContent = c.links_frase;
  pintarLista(itens && itens.length ? itens : PADRAO);
  pintarRedes(c);
}

iniciar();
