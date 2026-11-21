// ─── LGPD: dado pessoal fica fosco até o mouse chegar ────────────────────────
//
// O PEDIDO DO DONO
//   "devido a LGPD, dados sensíveis ficam embaçados, somente aparece se estiver
//    com o mouse em cima (...) vale para o sistema inteiro: telefone, cpf,
//    e-mail, endereço"
//
// COMO FUNCIONA
//   - Texto: um observador do DOM procura CPF, telefone, e-mail e endereço nos
//     textos que entram na tela (inclusive os que chegam depois, como a lista
//     ao vivo) e embrulha só o trecho achado num <span class="lgpd">. O texto
//     não muda: busca, cópia, testes e exportação continuam iguais. Nada passa
//     por innerHTML, então não abre porta para XSS.
//   - Campos: input/textarea de telefone, e-mail, CPF e endereço (pelo tipo ou
//     pelo id/nome) ficam foscos até o mouse chegar ou o campo ganhar o foco.
//   - Toque (celular): tocar mostra por 6 s e embaça de novo.
//   - Impressão sai nítida: documento impresso precisa do dado.
//   - Quem precisa marcar um dado que o detector não reconhece usa
//     class="lgpd" direto; trecho que não deve ser tocado leva data-lgpd-livre.
//
// Entra em todas as telas internas (pelo modulo-shell e nas que não usam o
// casco). O site público, o cadastro e o login ficam de fora: lá a pessoa
// digita o próprio dado.

const ESTILO = `
.lgpd{filter:blur(4.5px);transition:filter .15s ease;border-radius:3px;cursor:default;-webkit-user-select:text;user-select:text}
.lgpd:hover,.lgpd.lgpd-ver,.lgpd:focus{filter:none}
input.lgpd-campo:not(:hover):not(:focus),textarea.lgpd-campo:not(:hover):not(:focus),
input[type="tel"]:not(:hover):not(:focus),input[type="email"]:not(:hover):not(:focus){filter:blur(4px)}
input.lgpd-campo,textarea.lgpd-campo,input[type="tel"],input[type="email"]{transition:filter .15s ease}
@media print{.lgpd,input,textarea{filter:none!important}}
@media (prefers-reduced-motion:reduce){.lgpd,input,textarea{transition:none}}
`;

// Ordem importa: e-mail e CPF antes do telefone (CPF sem pontos tem 11
// dígitos, como um celular; o que importa é embaçar, não acertar o rótulo).
const PADROES = [
  // e-mail
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  // CPF, inclusive já mascarado (***.456.789-**)
  /(?<![\d*])[\d*]{3}\.[\d*]{3}\.[\d*]{3}-[\d*]{2}(?![\d*])/,
  // telefone: (98) 99999-0000, 98 99999 0000, +55 98..., 98999990000
  /(?<!\d)(?:\+?55[\s-]?)?(?:\(\d{2}\)\s?|\d{2}[\s-]?)9?\d{4}[\s-]?\d{4}(?!\d)/,
  // CEP
  /(?<!\d)\d{5}-\d{3}(?!\d)/,
  // endereço: logradouro + nome, até a vírgula do número e o número
  /\b(?:Rua|R\.|Avenida|Av\.?|Travessa|Tv\.|Alameda|Al\.|Rodovia|Estrada|Praça|Largo|Quadra|Qd\.)\s+[A-ZÀ-Úa-zà-ú0-9][^\n;|•]{1,60}?(?:,\s*(?:n[º°o.]?\s*)?\d+[A-Za-z]?)?(?=$|[\n;|•]|\s{2}|,\s*[A-ZÀ-Ú])/
];
const QUALQUER = new RegExp(PADROES.map(r => `(${r.source})`).join('|'), 'u');

// Onde não mexer: código, campos, opções de select (não aceitam filho), o
// próprio embrulho, e o que pediu para ficar livre.
const PULA = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'TITLE',
  'CODE',
  'PRE'
]);
function proibido(/** @type {Node|null} */ n) {
  for (let el = n && n.parentElement; el; el = el.parentElement) {
    if (PULA.has(el.tagName)) return true;
    if (el.classList.contains('lgpd') || el.hasAttribute('data-lgpd-livre') || el.isContentEditable)
      return true;
    if (el.namespaceURI === 'http://www.w3.org/2000/svg') return true;
  }
  return false;
}

/** Embrulha os trechos sensíveis de um nó de texto. */
function embrulhar(/** @type {Text} */ t) {
  const s = t.nodeValue || '';
  if (s.length < 6 || !QUALQUER.test(s) || proibido(t)) return;
  const frag = document.createDocumentFragment();
  let resto = s;
  let achou = false;
  for (;;) {
    const m = QUALQUER.exec(resto);
    if (!m || !m[0].trim()) break;
    achou = true;
    if (m.index) frag.appendChild(document.createTextNode(resto.slice(0, m.index)));
    const sp = document.createElement('span');
    sp.className = 'lgpd';
    sp.textContent = m[0];
    frag.appendChild(sp);
    resto = resto.slice(m.index + m[0].length);
  }
  if (!achou) return;
  if (resto) frag.appendChild(document.createTextNode(resto));
  t.parentNode && t.parentNode.replaceChild(frag, t);
}

const CAMPO = /(cpf|fone|phone|celular|whats|e-?mail|endere|address|logradouro|\bcep\b|_cep|-cep|cep-|cep_)/i;
function marcarCampo(/** @type {Element} */ el) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  if (el.classList.contains('lgpd-campo') || el.hasAttribute('data-lgpd-livre')) return;
  if (
    el instanceof HTMLInputElement &&
    ['hidden', 'checkbox', 'radio', 'button', 'submit', 'file', 'password'].includes(el.type)
  )
    return;
  const chave = `${el.id} ${el.name} ${el.getAttribute('autocomplete') || ''}`;
  if (CAMPO.test(chave) || /^(tel|email)$/.test(el.getAttribute('type') || ''))
    el.classList.add('lgpd-campo');
}

function varrer(/** @type {Node} */ raiz) {
  if (raiz.nodeType === Node.TEXT_NODE) {
    embrulhar(/** @type {Text} */ (raiz));
    return;
  }
  if (raiz.nodeType !== Node.ELEMENT_NODE && raiz.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  const el = /** @type {Element} */ (raiz);
  if (el.nodeType === Node.ELEMENT_NODE) {
    marcarCampo(el);
    if (PULA.has(el.tagName) || el.classList.contains('lgpd')) return;
  }
  if (el.querySelectorAll) el.querySelectorAll('input,textarea').forEach(marcarCampo);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textos = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) textos.push(/** @type {Text} */ (n));
  textos.forEach(embrulhar);
}

let pendentes = /** @type {Set<Node>} */ (new Set());
let agendado = false;
function processar() {
  agendado = false;
  const lote = pendentes;
  pendentes = new Set();
  lote.forEach(n => n.isConnected && varrer(n));
}
function agendar(/** @type {Node} */ n) {
  pendentes.add(n);
  if (!agendado) {
    agendado = true;
    requestAnimationFrame(processar);
  }
}

function ligar() {
  if (document.getElementById('lgpd-estilo')) return;
  const st = document.createElement('style');
  st.id = 'lgpd-estilo';
  st.textContent = ESTILO;
  document.head.appendChild(st);
  varrer(document.body);
  new MutationObserver(lista => {
    for (const m of lista) {
      if (m.type === 'characterData') agendar(m.target);
      else m.addedNodes.forEach(agendar);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  // Toque: não existe "mouse em cima" no celular.
  document.addEventListener(
    'pointerdown',
    ev => {
      if (ev.pointerType === 'mouse') return;
      const sp = /** @type {HTMLElement|null} */ (
        ev.target instanceof Element ? ev.target.closest('.lgpd') : null
      );
      if (!sp) return;
      sp.classList.add('lgpd-ver');
      setTimeout(() => sp.classList.remove('lgpd-ver'), 6000);
    },
    true
  );
}

if (typeof document !== 'undefined') {
  if (document.body) ligar();
  else document.addEventListener('DOMContentLoaded', ligar, { once: true });
}

/** Para quem monta HTML e quer marcar um dado que o detector não pega. */
export const LGPD_CLASSE = 'lgpd';
