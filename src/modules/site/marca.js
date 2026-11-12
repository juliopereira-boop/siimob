// @ts-check
// ─── Marca e ícones do site público ──────────────────────────────────────────
//
// O símbolo oficial do SIIMOB (quatro peças que formam um S, ver public/logo.svg)
// em duas versões: a "clara", em degradê branco, para fundo escuro, e a
// "oficial", em degradê verde-mar, para fundo claro. Cada uso recebe um prefixo
// próprio nos ids dos degradês: dois SVGs na mesma página com o mesmo id fazem
// o segundo herdar o degradê do primeiro.

/** @param {{claro?: boolean, tamanho?: number, id: string}} o */
export function marcaSvg(o) {
  const t = o.tamanho || 28;
  const p = o.id;
  const pares = o.claro
    ? [
        ['rgba(255,255,255,.62)', 'rgba(255,255,255,.86)', '#FFFFFF'],
        ['rgba(255,255,255,.58)', 'rgba(255,255,255,.84)', '#FFFFFF'],
        ['#FFFFFF', 'rgba(255,255,255,.84)', 'rgba(255,255,255,.58)'],
        ['rgba(255,255,255,.62)', 'rgba(255,255,255,.86)', '#FFFFFF']
      ]
    : [
        ['#04201D', '#149287', '#33E9D7'],
        ['#04201D', '#159A8E', '#3BF0DE'],
        ['#3BF0DE', '#159A8E', '#04201D'],
        ['#04201D', '#149287', '#33E9D7']
      ];
  const g = (/** @type {string} */ n, /** @type {string} */ coords, /** @type {string[]} */ c) =>
    `<linearGradient id="${p}${n}" ${coords} gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${c[0]}"/><stop offset="55%" stop-color="${c[1]}"/><stop offset="100%" stop-color="${c[2]}"/></linearGradient>`;
  return `<svg width="${t}" height="${t}" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs>${g('a', 'x1="13.4" y1="41.4" x2="36.4" y2="15.6"', pares[0])}${g('b', 'x1="64" y1="12.7" x2="64" y2="35.5"', pares[1])}${g('c', 'x1="36" y1="64.5" x2="36" y2="87.1"', pares[2])}${g('d', 'x1="86.6" y1="58.6" x2="63.6" y2="84.4"', pares[3])}</defs><path d="M36.4 12.9 A22.66 22.66 0 0 0 36.4 58.2 Z" fill="url(#${p}a)"/><rect x="41.4" y="12.7" width="45.3" height="22.8" rx="11.4" fill="url(#${p}b)"/><rect x="13.4" y="64.5" width="45.3" height="22.7" rx="11.3" fill="url(#${p}c)"/><path d="M63.9 41.8 A22.66 22.66 0 0 1 63.9 87.1 Z" fill="url(#${p}d)"/></svg>`;
}

/** O nome escrito, com o segundo I no verde-mar. */
export const NOME_MARCA = '<span class="sx-nome">SI<i>I</i>MOB</span>';

// Ícones de traço (24×24, stroke = currentColor). Cada chave aqui é uma opção
// do campo "ícone" dos botões no superadmin.
const T = (/** @type {string} */ d) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;

/** @type {Record<string, {rotulo: string, svg: string}>} */
export const ICONES = {
  site: {
    rotulo: 'Site',
    svg: T('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>')
  },
  whatsapp: {
    rotulo: 'WhatsApp',
    svg: T(
      '<path d="M3.5 20.5l1.3-4.1A8.5 8.5 0 1 1 8 19.6z"/><path d="M9 8.8c.2 2.6 3.6 6 6.2 6.2l1.1-1.4-2-1.1-.9.8c-1-.4-2.3-1.7-2.7-2.7l.8-.9-1.1-2z"/>'
    )
  },
  instagram: {
    rotulo: 'Instagram',
    svg: T(
      '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.8"/><circle cx="17.3" cy="6.7" r=".6" fill="currentColor"/>'
    )
  },
  linkedin: {
    rotulo: 'LinkedIn',
    svg: T(
      '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 10.5V16M8 7.8v.1M11.5 16v-5.5M11.5 13c0-1.6 1-2.6 2.4-2.6s2.1 1 2.1 2.6V16"/>'
    )
  },
  youtube: {
    rotulo: 'YouTube',
    svg: T(
      '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10.3 9.4v5.2l4.4-2.6z" fill="currentColor"/>'
    )
  },
  facebook: {
    rotulo: 'Facebook',
    svg: T(
      '<path d="M14.5 8.5H16V5.6h-2a3.6 3.6 0 0 0-3.6 3.6v1.7H8.6v2.9h1.8V20h3v-6.2h2l.5-2.9h-2.5V9.6c0-.6.5-1.1 1.1-1.1z"/>'
    )
  },
  tiktok: {
    rotulo: 'TikTok',
    svg: T('<path d="M14 4v10.2a3.3 3.3 0 1 1-3.3-3.3"/><path d="M14 4c.4 2.3 2 3.9 4.5 4.1"/>')
  },
  blog: {
    rotulo: 'Blog',
    svg: T('<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8.5 12h7M8.5 15.5h7M8.5 8.5h3"/>')
  },
  mensagem: {
    rotulo: 'Mensagem',
    svg: T('<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9.5h8M8 12.5h5"/>')
  },
  contato: {
    rotulo: 'Contato',
    svg: T('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>')
  },
  telefone: {
    rotulo: 'Telefone',
    svg: T(
      '<path d="M5 4.5h3.2l1.5 4-2 1.3a10.6 10.6 0 0 0 6.5 6.5l1.3-2 4 1.5V19a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 3.5 6.1 1.5 1.5 0 0 1 5 4.5z"/>'
    )
  },
  calendario: {
    rotulo: 'Agenda / demonstração',
    svg: T(
      '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4M8 13.5h3"/>'
    )
  },
  sistema: {
    rotulo: 'Acesso ao sistema',
    svg: T('<rect x="3.5" y="4.5" width="17" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>')
  },
  presente: {
    rotulo: 'Oferta / presente',
    svg: T(
      '<rect x="3.5" y="9" width="17" height="4" rx="1"/><path d="M5 13v7.5h14V13M12 9v11.5M12 9c-1-3-5-4-5-1.5S11 9 12 9zm0 0c1-3 5-4 5-1.5S13 9 12 9z"/>'
    )
  },
  video: {
    rotulo: 'Vídeo',
    svg: T('<rect x="3" y="5.5" width="13" height="13" rx="2.5"/><path d="M16 10l5-3v10l-5-3z"/>')
  },
  link: {
    rotulo: 'Link',
    svg: T(
      '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>'
    )
  }
};

/** @param {string|null|undefined} k */
export const icone = k => (k && ICONES[k] ? ICONES[k].svg : '');

export const SETA = T('<path d="M9 6l6 6-6 6"/>');
