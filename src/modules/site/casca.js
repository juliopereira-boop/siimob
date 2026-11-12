// @ts-check
// ─── Cabeçalho e rodapé do site público ─────────────────────────────────────
//
// Contato e Blog usam o mesmo cabeçalho (claro, fixo no topo) e o mesmo rodapé
// (escuro, com as redes que o superadmin cadastrou). As redes chegam depois da
// página: o rodapé nasce sem elas e ganha os ícones quando a configuração chega.
import { esc } from '../../shared/utils/texto.js';
import { ICONES, NOME_MARCA, marcaSvg } from './marca.js';
import { lerConfig, linkWhatsapp, urlSegura } from './dados.js';
import { acoes } from '../../shared/ui/acoes.js';

const MENU = [
  ['/', 'O SIIMOB', 'conheca'],
  ['/#modulos', 'Módulos', 'modulos'],
  ['/blog', 'Blog', 'blog'],
  ['/contato', 'Contato', 'contato']
];

acoes({
  sxMenu: el => {
    const g = document.getElementById('sx-gaveta');
    if (!g) return;
    const abrir = !g.classList.contains('aberta');
    g.classList.toggle('aberta', abrir);
    el.setAttribute('aria-expanded', String(abrir));
  }
});

/** As redes que têm endereço, na ordem em que aparecem. */
export function redesDe(/** @type {import('./dados.js').ConfigSite} */ c) {
  return /** @type {const} */ (['instagram', 'linkedin', 'youtube', 'facebook', 'tiktok'])
    .map(k => [k, urlSegura(c[k])])
    .filter(([, u]) => u && /^https?:/i.test(u));
}

/** @param {{ativo: string}} o */
export function montarCasca(o) {
  const nav = document.getElementById('sx-nav');
  const rod = document.getElementById('sx-rodape');
  const itens = MENU.map(
    ([href, rot, k]) => `<a href="${href}"${k === o.ativo ? ' aria-current="page"' : ''}>${rot}</a>`
  ).join('');
  if (nav)
    nav.innerHTML = `<div class="sx-wrap sx-nav-in">
      <a class="sx-marca" href="/" aria-label="SIIMOB, início">${marcaSvg({ id: 'mnav', tamanho: 30 })}${NOME_MARCA}</a>
      <nav class="sx-nav-links" aria-label="Principal">${itens}</nav>
      <div class="sx-nav-cta">
        <a class="sx-nav-entrar" href="/login">Entrar</a>
        <a class="sx-btn sx-btn-mar" href="/#interesse">Quero conhecer</a>
      </div>
      <button class="sx-menu" type="button" data-acao="sxMenu" aria-expanded="false" aria-controls="sx-gaveta" aria-label="Abrir menu">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
    </div>
    <div class="sx-gaveta" id="sx-gaveta">${itens}
      <a href="/login">Entrar no sistema</a>
      <a class="sx-btn sx-btn-mar" href="/#interesse">Quero conhecer</a>
    </div>`;
  if (rod) {
    rod.innerHTML = rodapeHtml({});
    lerConfig().then(c => {
      rod.innerHTML = rodapeHtml(c);
    });
  }
  observarEntrada();
}

function rodapeHtml(/** @type {import('./dados.js').ConfigSite} */ c) {
  const zap = linkWhatsapp(c);
  const email = String(c.email || '').trim();
  const redes = redesDe(c);
  const ano = new Date().getFullYear();
  return `<div class="sx-wrap">
    <div class="sx-rodape-grade">
      <div class="sx-rodape-marca sx-escuro">
        <a class="sx-marca" href="/">${marcaSvg({ id: 'mrod', tamanho: 30, claro: true })}${NOME_MARCA}</a>
        <p>Sistema de Integração Imobiliária. Construtora, imobiliária, correspondente e despachante no mesmo fluxo, do lead ao registro.</p>
        ${
          redes.length
            ? `<div class="sx-redes">${redes
                .map(
                  ([k, u]) =>
                    `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(ICONES[k].rotulo)}">${ICONES[k].svg}</a>`
                )
                .join('')}</div>`
            : ''
        }
      </div>
      <div>
        <h4>Produto</h4>
        <ul>
          <li><a href="/">O SIIMOB</a></li>
          <li><a href="/#jornada">Do lead ao registro</a></li>
          <li><a href="/#perfis">Perfis</a></li>
          <li><a href="/#seguranca">Segurança</a></li>
        </ul>
      </div>
      <div>
        <h4>Conteúdo</h4>
        <ul>
          <li><a href="/blog">Blog</a></li>
          <li><a href="/links">Links</a></li>
        </ul>
      </div>
      <div>
        <h4>Atendimento</h4>
        <ul>
          <li><a href="/contato">Fale com a gente</a></li>
          ${zap ? `<li><a href="${esc(zap)}" target="_blank" rel="noopener noreferrer">WhatsApp</a></li>` : ''}
          ${email ? `<li><a href="mailto:${esc(email)}">${esc(email)}</a></li>` : ''}
          <li><a href="/login">Já é cliente? Entrar</a></li>
        </ul>
      </div>
    </div>
    <div class="sx-rodape-base">
      <span>© ${ano} SIIMOB. Todos os direitos reservados.</span>
      <span>Tecnologia que conecta. Inteligência que transforma.</span>
    </div>
  </div>`;
}

/** Os blocos marcados com .sx-rv aparecem ao entrar na tela. */
export function observarEntrada() {
  const els = document.querySelectorAll('.sx-rv:not(.sx-vis)');
  if (!('IntersectionObserver' in window)) {
    els.forEach(e => e.classList.add('sx-vis'));
    return;
  }
  const io = new IntersectionObserver(
    ents =>
      ents.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('sx-vis');
          io.unobserve(e.target);
        }
      }),
    { threshold: 0.08 }
  );
  els.forEach(e => io.observe(e));
}
