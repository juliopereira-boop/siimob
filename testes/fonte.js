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
  const scripts = [...html.matchAll(/<script src="\/(src\/pages\/[^"]+\.js)"><\/script>/g)].map(m => m[1]);
  return [html, ...scripts.map(f => lerFonte(f))].join('\n');
}

module.exports = { RAIZ, lerFonte, lerPagina };
