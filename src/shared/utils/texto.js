// ─── Escapar texto do banco antes de pôr na tela ─────────────────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// Cada tela tinha o seu esc(), e eram quatro versões: só duas escapavam a aspa
// simples. Num atributo entre aspas simples (title='...'), um nome com ' abria
// caminho para injetar marcação. Uma função só, a mais segura, carregada por
// todas as telas antes do código delas.
//
// Duas funções, porque são dois lugares diferentes:
//   esc(x)    texto dentro do HTML: conteúdo e valor de atributo.
//   escJs(x)  texto dentro de uma string JavaScript que está dentro de um
//             atributo HTML: onclick="abrir('${escJs(x)}')". O navegador
//             decodifica o atributo ANTES de rodar o JS, então escapar só para
//             HTML não basta: &#39; vira ' de novo e fecha a string. escJs
//             escapa para JS primeiro e para HTML por cima, as duas camadas.

import { expor } from './expor.js';

// Chamadas pelo HTML (onclick="...") ou pela suíte de testes. Ver src/shared/utils/expor.js.
expor({ escJs });
// Ausente vira vazio; 0 e false continuam aparecendo (String(x || '') engolia
// o zero, e a tela mostrava em branco um dado que era 0).
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escJs(s) {
  return esc(
    String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
  );
}
