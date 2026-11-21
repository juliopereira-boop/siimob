// ─── Canal de origem do lead: o ícone de onde ele veio ───────────────────────
//
// O PEDIDO DO DONO
//   "Cada lead que chega precisa ter o ícone de onde veio, exemplo: instagram,
//    whatsapp, facebook."
//
// DE ONDE VEM A RESPOSTA, em ordem
//   1. Lead de integração: payload.integracao.origem ('meta', 'whatsapp', ...).
//      Na Meta, payload.integracao.dados.plataforma diz se o formulário foi
//      preenchido no Instagram ('ig') ou no Facebook ('fb').
//   2. Lead cadastrado à mão: o nome da origem escolhida (partner_name), quando
//      ele fala por si ("Instagram", "Facebook", "WhatsApp", "Site", "Indicação").
//   3. O resto: "Cadastro manual".
//
// Só devolve HTML montado aqui, com rótulo fixo: nada do lead entra no HTML.

/** @typedef {{k:string, rot:string}} Canal */

const SVG = {
  facebook:
    '<path fill="currentColor" d="M13.4 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.7v3h2.6V21z"/>',
  instagram:
    '<path fill="currentColor" d="M12 7.3A4.7 4.7 0 1 0 16.7 12 4.7 4.7 0 0 0 12 7.3zm0 7.7a3 3 0 1 1 3-3 3 3 0 0 1-3 3zm6-7.9a1.1 1.1 0 1 1-1.1-1.1A1.1 1.1 0 0 1 18 7.1zM21.9 8c-.1-1.6-.4-3-1.6-4.2S17.6 2.2 16 2.1C14.4 2 9.6 2 8 2.1 6.4 2.2 5 2.5 3.8 3.7S2.2 6.4 2.1 8C2 9.6 2 14.4 2.1 16c.1 1.6.4 3 1.6 4.2s2.6 1.5 4.2 1.6c1.6.1 6.4.1 8 0 1.6-.1 3-.4 4.2-1.6s1.5-2.6 1.6-4.2c.1-1.6.1-6.4.2-8z"/>',
  whatsapp:
    '<path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.4 13.9c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.6 2.1 1.1 1 2 1.3 2.3 1.4.3.2.5.1.6 0l.9-1c.2-.3.4-.2.7-.1l2 .9c.3.2.5.2.6.4.1.1.1.7-.2 1.4z"/>',
  meta: '<path fill="currentColor" d="M6.9 6C4 6 2 9.4 2 12.7 2 15.2 3.3 17 5.4 17c1.8 0 3-1.2 4.8-4.2l1.1-1.9 1 1.7c1.8 3 3 4.4 5.2 4.4 2.3 0 4.5-1.9 4.5-5.4C22 9 20.1 6 17.2 6c-1.9 0-3.4 1.3-5 3.7C10.5 7.2 9 6 6.9 6zm-.2 2.2c1.2 0 2.2 1 3.8 3.4l-1 1.7C8 15.6 7.2 16 6.2 16 5 16 4.2 14.9 4.2 12.8c0-2.5 1.1-4.6 2.5-4.6zm10.4 0c1.5 0 2.7 2 2.7 4.7 0 1.9-.8 2.9-2 2.9-1.1 0-2-.8-3.6-3.5l-.8-1.4c1.4-2 2.4-2.7 3.7-2.7z"/>',
  site: '<g fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></g>',
  indicacao:
    '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M17 8v6M14 11h6"/></g>',
  manual:
    '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></g>'
};

const ROTULO = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  meta: 'Meta (Facebook/Instagram)',
  site: 'Site',
  indicacao: 'Indicação',
  manual: 'Cadastro manual'
};

/**
 * De onde o lead veio.
 * @param {{payload?: any, partner_name?: string|null}|null|undefined} l
 * @returns {Canal}
 */
export function canalDoLead(l) {
  const integ = l && l.payload && typeof l.payload === 'object' ? l.payload.integracao : null;
  const origem = integ && typeof integ.origem === 'string' ? integ.origem.toLowerCase() : '';
  if (origem === 'meta') {
    const pl = String((integ.dados && integ.dados.plataforma) || '').toLowerCase();
    const k =
      pl === 'ig' || pl === 'instagram'
        ? 'instagram'
        : pl === 'fb' || pl === 'facebook'
          ? 'facebook'
          : 'meta';
    return { k, rot: `${ROTULO[k]} · anúncio` };
  }
  if (origem === 'whatsapp' || origem === 'instagram' || origem === 'facebook')
    return { k: origem, rot: ROTULO[origem] };
  if (origem === 'site') return { k: 'site', rot: ROTULO.site };
  const nome = String((l && l.partner_name) || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (/insta|\big\b/.test(nome)) return { k: 'instagram', rot: ROTULO.instagram };
  if (/whats|wpp|\bzap\b|wa\.me/.test(nome)) return { k: 'whatsapp', rot: ROTULO.whatsapp };
  if (/face|\bfb\b/.test(nome)) return { k: 'facebook', rot: ROTULO.facebook };
  if (/\bmeta\b/.test(nome)) return { k: 'meta', rot: ROTULO.meta };
  if (/site|landing|google|portal|internet/.test(nome)) return { k: 'site', rot: ROTULO.site };
  if (/indica/.test(nome)) return { k: 'indicacao', rot: ROTULO.indicacao };
  return { k: 'manual', rot: ROTULO.manual };
}

/**
 * O selo redondo com o ícone do canal. `tam` é o diâmetro em px.
 * @param {Canal} c
 * @param {number} [tam]
 */
export function seloCanal(c, tam = 18) {
  const k = Object.prototype.hasOwnProperty.call(SVG, c.k) ? c.k : 'manual';
  const i = Math.round(tam * 0.62);
  ligarEstilo();
  return `<span class="canal-selo canal-${k}" style="width:${tam}px;height:${tam}px" title="Origem: ${esc(c.rot)}" role="img" aria-label="Origem: ${esc(c.rot)}"><svg viewBox="0 0 24 24" width="${i}" height="${i}" aria-hidden="true">${SVG[k]}</svg></span>`;
}

/** Atalho: o selo de um lead. */
export function seloCanalDoLead(l, tam) {
  return seloCanal(canalDoLead(l), tam);
}

function esc(/** @type {string} */ s) {
  return String(s).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
}

const ESTILO = `
.canal-selo{display:inline-flex;align-items:center;justify-content:center;flex:none;border-radius:50%;color:#fff;vertical-align:middle;line-height:0}
.canal-facebook{background:#1877f2}
.canal-instagram{background:radial-gradient(circle at 30% 107%,#fdf497 0%,#fd5949 45%,#d6249f 60%,#285aeb 95%)}
.canal-whatsapp{background:#25d366}
.canal-meta{background:#0866ff}
.canal-site{background:#3f6f9e}
.canal-indicacao{background:#b5651d}
.canal-manual{background:#8a9a97}
`;
function ligarEstilo() {
  if (typeof document === 'undefined' || document.getElementById('canal-estilo')) return;
  const st = document.createElement('style');
  st.id = 'canal-estilo';
  st.textContent = ESTILO;
  document.head.appendChild(st);
}
