// @ts-check
// ─── Markdown do blog, sem abrir porta para HTML ────────────────────────────
//
// O texto do post é escrito no superadmin e aparece para qualquer visitante.
// Por isso o renderizador escapa TUDO primeiro e só então reconhece a marcação
// que conhece: títulos (## e ###), parágrafos, listas, citação, linha, negrito,
// itálico, código, link e imagem. HTML digitado no texto aparece como texto.
// Link e imagem só com endereço seguro (http/https, ou caminho do próprio site);
// "javascript:" vira texto puro.
import { esc } from '../../shared/utils/texto.js';

const SEGURO = /^(https?:\/\/|\/(?!\/)|mailto:)/i;

/** Marcação dentro de uma linha. Recebe texto JÁ escapado. */
function emLinha(/** @type {string} */ t) {
  const codigos = /** @type {string[]} */ ([]);
  // Código primeiro: o que está entre crases não é interpretado.
  t = t.replace(/`([^`]+)`/g, (_, c) => {
    codigos.push(`<code>${c}</code>`);
    return `\uE000${codigos.length - 1}\uE000`;
  });
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const u = url.replace(/&amp;/g, '&');
    return SEGURO.test(u) && !/^mailto:/i.test(u)
      ? `<img src="${esc(u)}" alt="${alt}" loading="lazy" decoding="async">`
      : m;
  });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => {
    const u = url.replace(/&amp;/g, '&');
    if (!SEGURO.test(u)) return txt;
    const fora = /^https?:\/\//i.test(u);
    return `<a href="${esc(u)}"${fora ? ' target="_blank" rel="noopener noreferrer"' : ''}>${txt}</a>`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>');
  return t.replace(/\uE000(\d+)\uE000/g, (_, i) => codigos[Number(i)]);
}

/** Converte o texto do post em HTML seguro. */
export function markdown(/** @type {string} */ fonte) {
  const linhas = String(fonte || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const out = /** @type {string[]} */ ([]);
  /** @type {string[]} */ let para = [];
  /** @type {{tipo:'ul'|'ol', itens:string[]}|null} */ let lista = null;
  /** @type {string[]} */ let citacao = [];

  const fecharPara = () => {
    if (para.length) out.push(`<p>${emLinha(esc(para.join(' ')))}</p>`);
    para = [];
  };
  const fecharLista = () => {
    if (lista)
      out.push(
        `<${lista.tipo}>${lista.itens.map(i => `<li>${emLinha(esc(i))}</li>`).join('')}</${lista.tipo}>`
      );
    lista = null;
  };
  const fecharCitacao = () => {
    if (citacao.length) out.push(`<blockquote><p>${emLinha(esc(citacao.join(' ')))}</p></blockquote>`);
    citacao = [];
  };
  const fecharTudo = () => {
    fecharPara();
    fecharLista();
    fecharCitacao();
  };

  for (const bruta of linhas) {
    const l = bruta.trimEnd();
    if (!l.trim()) {
      // Linha em branco fecha parágrafo e citação; a lista continua se o
      // próximo item vier depois dela (lista "solta", como no Markdown comum).
      fecharPara();
      fecharCitacao();
      continue;
    }
    let m;
    if ((m = /^(#{1,4})\s+(.+)$/.exec(l))) {
      fecharTudo();
      // # e ## viram h2 (o h1 da página é o título do post), ### h3, #### h4.
      const n = Math.max(2, m[1].length);
      out.push(`<h${n}>${emLinha(esc(m[2]))}</h${n}>`);
    } else if (/^(\*{3,}|-{3,}|_{3,})$/.test(l.trim())) {
      fecharTudo();
      out.push('<hr>');
    } else if ((m = /^\s*>\s?(.*)$/.exec(l))) {
      fecharPara();
      fecharLista();
      citacao.push(m[1]);
    } else if ((m = /^\s*[-*+]\s+(.+)$/.exec(l))) {
      fecharPara();
      fecharCitacao();
      if (!lista || lista.tipo !== 'ul') {
        fecharLista();
        lista = { tipo: 'ul', itens: [] };
      }
      lista.itens.push(m[1]);
    } else if ((m = /^\s*\d+[.)]\s+(.+)$/.exec(l))) {
      fecharPara();
      fecharCitacao();
      if (!lista || lista.tipo !== 'ol') {
        fecharLista();
        lista = { tipo: 'ol', itens: [] };
      }
      lista.itens.push(m[1]);
    } else if (/^!\[[^\]]*\]\([^)\s]+\)$/.test(l.trim())) {
      // Imagem sozinha na linha vira figura, sem parágrafo em volta.
      fecharTudo();
      out.push(`<figure>${emLinha(esc(l.trim()))}</figure>`);
    } else {
      fecharLista();
      fecharCitacao();
      para.push(l.trim());
    }
  }
  fecharTudo();
  return out.join('\n');
}

/** Minutos de leitura (220 palavras por minuto, mínimo 1). */
export function minutosDeLeitura(/** @type {string} */ fonte) {
  const palavras = String(fonte || '')
    .replace(/[#>*_`[\]()!-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(palavras / 220));
}

/** "Como montar um funil" → "como-montar-um-funil" */
export function slugDe(/** @type {string} */ t) {
  return String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}
