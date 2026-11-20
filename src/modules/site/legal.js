// @ts-check
// ─── Páginas legais (/privacidade, /termos) ─────────────────────────────────
//
// O texto mora no HTML (lê sem JavaScript e o Google indexa). Aqui só entram o
// cabeçalho e o rodapé do site, o índice montado a partir das seções e a
// marcação da seção que está na tela.
import { esc } from '../../shared/utils/texto.js';
import { montarCasca } from './casca.js';

export function montarLegal() {
  montarCasca({ ativo: '' });
  const lista = document.getElementById('lg-indice-lista');
  const secoes = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.lg-texto section[id]')]);
  if (!lista || !secoes.length) return;
  lista.innerHTML = secoes
    .map(s => {
      const t = (s.querySelector('h2')?.textContent || '').replace(/^\s*\d+\.\s*/, '');
      return `<li><a href="#${esc(s.id)}">${esc(t)}</a></li>`;
    })
    .join('');
  if (!('IntersectionObserver' in window)) return;
  const links = new Map(
    [...lista.querySelectorAll('a')].map(a => [a.getAttribute('href')?.slice(1) || '', a])
  );
  const obs = new IntersectionObserver(
    entradas => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        links.forEach(a => a.removeAttribute('aria-current'));
        links.get(e.target.id)?.setAttribute('aria-current', 'true');
      }
    },
    { rootMargin: '-90px 0px -65% 0px' }
  );
  secoes.forEach(s => obs.observe(s));
}
