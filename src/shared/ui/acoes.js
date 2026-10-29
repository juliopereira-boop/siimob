// @ts-check
// ─── Ações do HTML ───────────────────────────────────────────────────────────
//
// O HTML não chama função pelo nome. Um elemento DECLARA a ação:
//
//   <button data-acao="abrirCaso" data-id="...">      clique
//   <select data-acao-change="filtrar">                outro evento: data-acao-<evento>
//   <input data-acao-enter="buscar">                   tecla Enter (keydown)
//
// e o módulo dono da tela diz o que ela faz:
//
//   acoes({ abrirCaso: el => abrirCaso(el.dataset.id) });
//
// Os argumentos vão em atributos data-* do próprio elemento, escapados com
// esc(): o valor chega à função exatamente como foi escrito, sem passar por um
// parser de JavaScript (o que antes exigia escJs dentro do onclick).
//
// Um ouvinte por tipo de evento, no document, atende a página inteira,
// inclusive o que for desenhado depois por innerHTML.
//
// FIDELIDADE AO onclick ANTIGO
// - O ouvinte fica na fase de captura do document: a ação roda antes de
//   qualquer ouvinte de elemento, como o handler inline rodava antes dos
//   ouvintes dos ancestrais. Um ancestral que pare a propagação não engole a
//   ação.
// - Ações aninhadas rodam da mais interna para a mais externa, como no
//   inline. ev.stopPropagation() numa ação impede as externas (e os ouvintes
//   de elemento), exatamente como antes.
// - Eventos que não sobem (focus, blur, load, error, mouseenter, mouseleave,
//   scroll, ou qualquer um disparado com bubbles: false) só disparam a ação do
//   próprio alvo.

/** @typedef {(el: HTMLElement, ev: Event) => unknown} Acao */

/** @type {Map<string, Acao>} */
const registro = new Map();

const SOBEM = [
  'click',
  'dblclick',
  'contextmenu',
  'change',
  'input',
  'submit',
  'keydown',
  'keyup',
  'paste',
  'dragstart',
  'dragend',
  'dragenter',
  'dragover',
  'dragleave',
  'drop',
  'mouseover',
  'mouseout'
];
const NAO_SOBEM = ['focus', 'blur', 'load', 'error', 'mouseenter', 'mouseleave', 'scroll'];

/** Atributo que declara a ação para o evento: data-acao (clique) ou data-acao-<evento>. */
function atributo(tipo) {
  return tipo === 'click' ? 'data-acao' : 'data-acao-' + tipo;
}

function rodar(el, nome, ev) {
  const acao = registro.get(nome);
  if (!acao) throw new Error(`Ação "${nome}" sem registro (${ev.type})`);
  acao(el, ev);
}

function aoEventoQueSobe(ev) {
  percorrer(ev, atributo(ev.type));
  if (ev.type === 'keydown' && /** @type {KeyboardEvent} */ (ev).key === 'Enter' && !ev.cancelBubble) {
    percorrer(ev, 'data-acao-enter');
  }
}

function percorrer(ev, attr) {
  // O caminho é o do momento do evento, como no inline: se a ação redesenha a
  // lista e o alvo sai da página, os ancestrais originais ainda são visitados.
  // Evento disparado sem bolha (new Event('change')) só chega ao próprio alvo.
  const caminho = ev.bubbles ? ev.composedPath() : [ev.target];
  for (const no of caminho) {
    if (!(no instanceof Element)) continue;
    const nome = no.getAttribute(attr);
    if (!nome) continue;
    rodar(/** @type {HTMLElement} */ (no), nome, ev);
    if (ev.cancelBubble) break;
  }
}

function aoEventoQueNaoSobe(ev) {
  const el = ev.target;
  if (!(el instanceof Element)) return;
  const nome = el.getAttribute(atributo(ev.type));
  if (nome) rodar(/** @type {HTMLElement} */ (el), nome, ev);
}

SOBEM.forEach(t => document.addEventListener(t, aoEventoQueSobe, true));
NAO_SOBEM.forEach(t => document.addEventListener(t, aoEventoQueNaoSobe, true));

// Ações de DOM puro, sem regra de negócio, que mais de uma tela usa.
registro.set('pararPropagacao', (el, ev) => ev.stopPropagation());
registro.set('selecionarTexto', el => /** @type {HTMLInputElement} */ (el).select());
// <input type="file"> escondido aberto por outro botão: data-alvo="<id do input>"
registro.set('clicarAlvo', el => document.getElementById(el.dataset.alvo).click());

/**
 * Registra as ações de um módulo. Nome repetido entre módulos é erro de
 * programação: avisa na hora, em vez de uma ação engolir a outra em silêncio.
 * @param {Record<string, Acao>} mapa
 */
export function acoes(mapa) {
  for (const [nome, acao] of Object.entries(mapa)) {
    if (registro.has(nome)) throw new Error(`Ação "${nome}" registrada duas vezes`);
    registro.set(nome, acao);
  }
}
