// ─── Escapar texto do banco antes de pôr na tela ─────────────────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// Cada tela tinha o seu esc(), e eram quatro versões: só duas escapavam a aspa
// simples. Num atributo entre aspas simples (title='...'), um nome com ' abria
// caminho para injetar marcação. Uma função só, a mais segura, importada por
// todas as telas.
//
// Vale para conteúdo e para valor de atributo, inclusive os data-* que levam
// os argumentos de uma ação (src/shared/ui/acoes.js): o navegador decodifica o
// atributo e a função recebe o texto exatamente como veio do banco. Antes, com
// onclick="abrir('${...}')", o texto ia para dentro de uma string JavaScript e
// precisava de um segundo escape (escJs), que saiu junto com os onclick.

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
