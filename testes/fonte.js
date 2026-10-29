// @ts-check
// ─── O código-fonte, para os testes que conferem o que está escrito ──────────
//
// Alguns testes não abrem navegador: leem o arquivo e conferem uma regra no
// texto (o destino do login, as declarações de esc(), o catálogo de permissões).
// Desde a reestruturação, uma tela é uma PASTA: src/pages/<tela>/ com o HTML e
// o JS dela. lerPagina devolve tudo junto, na ordem em que o HTML carrega, para
// que "está escrito na tela" continue significando a tela inteira.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const lerFonte = rel => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

function lerPagina(tela) {
  const dir = path.join('src/pages', tela.replace(/\.html$/, ''));
  const html = lerFonte(path.join(dir, 'index.html'));
  // O módulo da tela (<script type="module">) e algum script clássico irmão.
  const scripts = [
    ...html.matchAll(/<script (?:type="module" )?src="\/(src\/pages\/[^"]+\.js)"><\/script>/g)
  ].map(m => m[1]);
  return [html, ...scripts.map(f => lerFonte(f))].join('\n');
}

// O código de um módulo ES, pronto para rodar fora do navegador (new Function):
// sem os import (o teste injeta as dependências como parâmetros), sem `export`
// e sem a exposição ao window (expor/exporVariavel). Os testes que conferem uma
// função de verdade, e não uma cópia dela, leem o arquivo e passam por aqui.
function comoScript(codigo) {
  return codigo
    .replace(/^import\s[\s\S]*?;[ \t]*$/gm, '')
    .replace(/^expor\(\{[\s\S]*?\}\);[ \t]*$/gm, '')
    .replace(/^exporVariavel\([\s\S]*?\);[ \t]*$/gm, '')
    .replace(/^export\s+/gm, '');
}

module.exports = { RAIZ, lerFonte, lerPagina, comoScript };
