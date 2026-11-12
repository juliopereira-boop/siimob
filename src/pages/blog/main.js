// @ts-check
// ─── /blog e /blog/:post ─────────────────────────────────────────────────────
//
// Uma página só para a lista e para o post: o endereço decide. A lista filtra
// por categoria e busca na própria tela (o blog é pequeno, e um post a mais não
// pede ida ao banco), com a página e a categoria no endereço para o link
// compartilhado abrir no mesmo lugar. O texto do post é Markdown escrito no
// superadmin e vira HTML pelo renderizador que escapa tudo antes
// (src/modules/site/markdown.js).
import { esc } from '../../shared/utils/texto.js';
import { acoes } from '../../shared/ui/acoes.js';
import { montarCasca, observarEntrada } from '../../modules/site/casca.js';
import { marcaSvg, icone } from '../../modules/site/marca.js';
import { dataLonga, lerPost, lerPosts, urlSegura } from '../../modules/site/dados.js';
import { markdown } from '../../modules/site/markdown.js';

const POR_PAGINA = 9;
/** @type {any[]} */
let POSTS = [];
const F = { categoria: '', busca: '', pagina: 1 };

acoes({
  blCategoria: el => {
    F.categoria = el.dataset.cat || '';
    F.pagina = 1;
    pintarLista(true);
  },
  blPagina: el => {
    F.pagina = Number(el.dataset.p) || 1;
    pintarLista(true);
    document.getElementById('bl-lista-topo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  blBusca: el => {
    F.busca = /** @type {HTMLInputElement} */ (el).value;
    F.pagina = 1;
    pintarGrade();
  },
  blCopiar: () => copiarLink()
});

const vista = () => /** @type {HTMLElement} */ (document.getElementById('bl-vista'));
const slugDaUrl = () => {
  const m = /^\/blog\/([a-z0-9-]+)\/?$/.exec(location.pathname);
  return m ? m[1] : '';
};
const norm = (/** @type {string} */ s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// ─── Capa ────────────────────────────────────────────────────────────────────
// Post sem imagem ganha uma capa desenhada na identidade do SIIMOB, com o
// título: a grade nunca fica com um buraco cinza.
function capa(/** @type {any} */ p, /** @type {string} */ classe, /** @type {boolean=} */ grande) {
  const url = urlSegura(p.capa_url);
  if (url)
    return `<div class="${classe}"><img src="${esc(url)}" alt="" loading="${grande ? 'eager' : 'lazy'}" decoding="async"></div>`;
  return `<div class="${classe} bl-capa-gerada" aria-hidden="true">
    <span class="bl-cg-cat">${esc(p.categoria || 'SIIMOB')}</span>
    <span class="bl-cg-tit">${esc(p.titulo)}</span>
    <span class="bl-cg-marca">${marcaSvg({
      id:
        'cg' +
        String(p.id || p.slug)
          .replace(/[^a-z0-9]/gi, '')
          .slice(0, 10),
      tamanho: 26,
      claro: true
    })}</span>
  </div>`;
}

function meta(/** @type {any} */ p) {
  return [dataLonga(p.publicado_em), p.tempo_leitura ? `${p.tempo_leitura} min de leitura` : '']
    .filter(Boolean)
    .map(esc)
    .join('<i aria-hidden="true">·</i>');
}

function cartao(/** @type {any} */ p) {
  return `<article class="bl-card sx-rv">
    <a href="/blog/${esc(p.slug)}" class="bl-card-link" aria-label="${esc(p.titulo)}"></a>
    ${capa(p, 'bl-card-capa')}
    <div class="bl-card-corpo">
      <span class="bl-cat">${esc(p.categoria || '')}</span>
      <h3>${esc(p.titulo)}</h3>
      ${p.resumo ? `<p>${esc(p.resumo)}</p>` : ''}
      <div class="bl-meta">${meta(p)}</div>
    </div>
  </article>`;
}

// ─── Lista ───────────────────────────────────────────────────────────────────
function lerFiltrosDaUrl() {
  const q = new URLSearchParams(location.search);
  F.categoria = q.get('categoria') || '';
  F.pagina = Math.max(1, Number(q.get('pagina')) || 1);
}
function gravarFiltrosNaUrl() {
  const q = new URLSearchParams();
  if (F.categoria) q.set('categoria', F.categoria);
  if (F.pagina > 1) q.set('pagina', String(F.pagina));
  history.replaceState(null, '', '/blog' + (q.toString() ? '?' + q : ''));
}

function filtrados() {
  const b = norm(F.busca).trim();
  return POSTS.filter(
    p =>
      (!F.categoria || p.categoria === F.categoria) &&
      (!b || norm(`${p.titulo} ${p.resumo || ''} ${p.categoria || ''}`).includes(b))
  );
}

function pintarLista(/** @type {boolean=} */ soGrade) {
  if (soGrade && document.getElementById('bl-grade')) {
    document.querySelectorAll('.bl-pilula').forEach(b => {
      const el = /** @type {HTMLElement} */ (b);
      const on = (el.dataset.cat || '') === F.categoria;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    pintarGrade();
    return;
  }
  const categorias = [...new Set(POSTS.map(p => p.categoria).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR')
  );
  if (F.categoria && !categorias.includes(F.categoria)) F.categoria = '';
  vista().innerHTML = `
    <header class="bl-hero">
      <div class="bl-hero-fundo" aria-hidden="true"></div>
      <div class="sx-wrap bl-hero-in">
        <span class="bl-sobre">Blog do SIIMOB</span>
        <h1>Conteúdo <em>SIIMOB</em></h1>
        <p>Ideias práticas para organizar a operação, vender mais e acompanhar o cliente do lead ao registro.</p>
      </div>
    </header>
    <section class="sx-wrap bl-lista" id="bl-lista-topo">
      ${
        POSTS.length
          ? `<div class="bl-barra">
              <div class="bl-pilulas" role="group" aria-label="Categorias">
                ${['', ...categorias]
                  .map(
                    c =>
                      `<button type="button" class="bl-pilula${c === F.categoria ? ' on' : ''}" data-acao="blCategoria" data-cat="${esc(c)}" aria-pressed="${c === F.categoria}">${esc(c || 'Todos')}</button>`
                  )
                  .join('')}
              </div>
              <label class="bl-busca"><span class="sx-sr">Buscar no blog</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
                <input type="search" placeholder="Buscar artigo" value="${esc(F.busca)}" data-acao-input="blBusca">
              </label>
            </div>
            <div id="bl-grade"></div>`
          : `<div class="bl-vazio">
              <span class="bl-vazio-ic" aria-hidden="true">${icone('blog')}</span>
              <h2>Os primeiros artigos estão chegando</h2>
              <p>Enquanto isso, conheça como o SIIMOB organiza a operação do lead ao registro.</p>
              <a class="sx-btn sx-btn-mar" href="/conheca">Conhecer o SIIMOB</a>
            </div>`
      }
    </section>`;
  if (POSTS.length) pintarGrade();
  observarEntrada();
}

function pintarGrade() {
  const alvo = document.getElementById('bl-grade');
  if (!alvo) return;
  const lista = filtrados();
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  if (F.pagina > paginas) F.pagina = paginas;
  gravarFiltrosNaUrl();
  // O destaque abre a primeira página quando não há filtro: é a vitrine.
  const semFiltro = !F.categoria && !F.busca.trim() && F.pagina === 1;
  let pagina = lista.slice((F.pagina - 1) * POR_PAGINA, F.pagina * POR_PAGINA);
  let destaque = '';
  if (semFiltro && pagina.length) {
    const d = pagina.find(p => p.destaque) || pagina[0];
    pagina = pagina.filter(p => p !== d);
    destaque = `<article class="bl-destaque sx-rv">
      <a href="/blog/${esc(d.slug)}" class="bl-card-link" aria-label="${esc(d.titulo)}"></a>
      ${capa(d, 'bl-destaque-capa', true)}
      <div class="bl-destaque-corpo">
        <span class="bl-cat">${esc(d.categoria || '')}</span>
        <h2>${esc(d.titulo)}</h2>
        ${d.resumo ? `<p>${esc(d.resumo)}</p>` : ''}
        <div class="bl-meta">${meta(d)}</div>
        <span class="bl-ler">Ler artigo <span aria-hidden="true">→</span></span>
      </div>
    </article>`;
  }
  alvo.innerHTML = lista.length
    ? `${destaque}
       ${pagina.length ? `<div class="bl-grade">${pagina.map(cartao).join('')}</div>` : ''}
       ${paginas > 1 ? paginacao(paginas) : ''}`
    : `<div class="bl-nada">Nenhum artigo encontrado${F.busca.trim() ? ` para “${esc(F.busca.trim())}”` : ''}.</div>`;
  observarEntrada();
}

function paginacao(/** @type {number} */ total) {
  const b = (
    /** @type {number} */ p,
    /** @type {string} */ rot,
    /** @type {boolean=} */ off,
    /** @type {string=} */ classe
  ) =>
    `<button type="button" class="${classe || 'bl-pg'}${p === F.pagina && !classe ? ' on' : ''}" data-acao="blPagina" data-p="${p}"${off ? ' disabled' : ''}${p === F.pagina && !classe ? ' aria-current="page"' : ''}>${rot}</button>`;
  return `<nav class="bl-paginacao" aria-label="Páginas">
    ${b(F.pagina - 1, '← Anterior', F.pagina === 1, 'bl-pg-seta')}
    ${Array.from({ length: total }, (_, i) => b(i + 1, String(i + 1))).join('')}
    ${b(F.pagina + 1, 'Próxima →', F.pagina === total, 'bl-pg-seta')}
  </nav>`;
}

// ─── Post ────────────────────────────────────────────────────────────────────
function definirMeta(/** @type {any} */ p) {
  document.title = `${p.titulo} | Blog SIIMOB`;
  const pares = [
    ['name', 'description', p.resumo || p.titulo],
    ['property', 'og:title', p.titulo],
    ['property', 'og:description', p.resumo || ''],
    ['property', 'og:type', 'article']
  ];
  const capaUrl = urlSegura(p.capa_url);
  if (capaUrl) pares.push(['property', 'og:image', capaUrl]);
  pares.forEach(([attr, nome, valor]) => {
    let m = document.head.querySelector(`meta[${attr}="${nome}"]`);
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute(attr, nome);
      document.head.appendChild(m);
    }
    m.setAttribute('content', valor);
  });
}

async function pintarPost(/** @type {string} */ slug) {
  const [p, todos] = await Promise.all([lerPost(slug), lerPosts()]);
  POSTS = todos || [];
  if (!p) {
    document.title = 'Artigo não encontrado | Blog SIIMOB';
    vista().innerHTML = `<section class="sx-wrap bl-vazio bl-404">
      <span class="bl-vazio-ic" aria-hidden="true">${icone('blog')}</span>
      <h1>${p === null ? 'Artigo não encontrado' : 'Não deu para abrir o artigo'}</h1>
      <p>${p === null ? 'O endereço pode ter mudado ou o artigo saiu do ar.' : 'Tente de novo em instantes.'}</p>
      <a class="sx-btn sx-btn-mar" href="/blog">Ver todos os artigos</a>
    </section>`;
    return;
  }
  definirMeta(p);
  const url = location.origin + '/blog/' + p.slug;
  const zap = `https://wa.me/?text=${encodeURIComponent(`${p.titulo} ${url}`)}`;
  const lin = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  const outros = POSTS.filter(x => x.slug !== p.slug);
  const relacionados = [
    ...outros.filter(x => x.categoria === p.categoria),
    ...outros.filter(x => x.categoria !== p.categoria)
  ].slice(0, 3);
  vista().innerHTML = `
    <article class="bl-post">
      <header class="bl-post-cab">
        <div class="sx-wrap bl-post-cab-in">
          <nav class="bl-trilha" aria-label="Você está em">
            <a href="/blog">Blog</a><span aria-hidden="true">›</span>
            ${p.categoria ? `<a href="/blog?categoria=${encodeURIComponent(p.categoria)}">${esc(p.categoria)}</a>` : ''}
          </nav>
          <h1>${esc(p.titulo)}</h1>
          ${p.resumo ? `<p class="bl-post-lede">${esc(p.resumo)}</p>` : ''}
          <div class="bl-post-meta">
            <span class="bl-autor"><span class="bl-autor-av" aria-hidden="true">${marcaSvg({ id: 'mav', tamanho: 18, claro: true })}</span>${esc(p.autor || 'Equipe SIIMOB')}</span>
            <span class="bl-meta">${meta(p)}</span>
          </div>
        </div>
      </header>
      <div class="sx-wrap">
        ${capa(p, 'bl-post-capa', true)}
        <div class="bl-post-grade">
          <div class="bl-texto">${markdown(p.conteudo || '')}</div>
          <aside class="bl-lado">
            <div class="bl-partilha">
              <span>Compartilhe</span>
              <a href="${esc(zap)}" target="_blank" rel="noopener noreferrer" aria-label="Compartilhar no WhatsApp">${icone('whatsapp')}</a>
              <a href="${esc(lin)}" target="_blank" rel="noopener noreferrer" aria-label="Compartilhar no LinkedIn">${icone('linkedin')}</a>
              <button type="button" data-acao="blCopiar" aria-label="Copiar o link do artigo">${icone('link')}</button>
            </div>
            <div class="bl-cta-lado">
              ${marcaSvg({ id: 'mcl', tamanho: 34, claro: true })}
              <b>O SIIMOB organiza a operação do lead ao registro.</b>
              <p>Leads, disposição, reserva, venda, repasse e registro, num sistema só.</p>
              <a class="sx-btn sx-btn-mar" href="/conheca">Conhecer o sistema</a>
            </div>
          </aside>
        </div>
      </div>
    </article>
    ${
      relacionados.length
        ? `<section class="bl-relacionados">
            <div class="sx-wrap">
              <div class="bl-rel-cab"><h2>Continue lendo</h2><a href="/blog">Ver todos →</a></div>
              <div class="bl-grade">${relacionados.map(cartao).join('')}</div>
            </div>
          </section>`
        : ''
    }`;
  observarEntrada();
}

async function copiarLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    avisar('Link copiado');
  } catch {
    avisar('Não deu para copiar o link');
  }
}
function avisar(/** @type {string} */ msg) {
  const a = /** @type {HTMLElement} */ (document.getElementById('bl-aviso'));
  a.textContent = msg;
  a.classList.add('on');
  setTimeout(() => a.classList.remove('on'), 2200);
}

async function iniciar() {
  montarCasca({ ativo: 'blog' });
  const slug = slugDaUrl();
  if (slug) {
    await pintarPost(slug);
    return;
  }
  lerFiltrosDaUrl();
  POSTS = (await lerPosts()) || [];
  pintarLista();
}

iniciar();
