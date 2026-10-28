// @ts-check
// ─── Scripts clássicos no build ──────────────────────────────────────────────
//
// POR QUE ESTE PLUGIN EXISTE
// O código das telas ainda é script clássico: as funções são globais porque os
// `onclick="..."` do HTML as chamam pelo nome. O Vite só empacota
// <script type="module">; um script clássico ele deixa como está, e o arquivo
// nem chega ao dist. Converter tudo para módulo de uma vez quebraria ~1.350
// handlers — isso é a fase 3, feita tela por tela.
//
// Até lá, este plugin dá aos scripts clássicos o que o Vite dá aos módulos:
// minificação e nome com hash (o navegador nunca fica com a versão velha em
// cache). Sem mudar a semântica: o esbuild, sem formato de saída, NÃO renomeia
// nada do nível de cima, então todo global que um onclick chama continua com o
// mesmo nome. E o alvo é `esnext`: nenhuma sintaxe é reescrita, só compactada.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename, relative, sep } from 'node:path';
import { transform } from 'esbuild';

const MARCA = /<script data-classico="([^"]+)"><\/script>/g;

/** @returns {import('vite').Plugin} */
export default function scriptsClassicos() {
  let raiz;
  return {
    name: 'siimob:scripts-classicos',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      raiz = c.root;
    },

    // Antes de o Vite ler o HTML, cada <script src> local vira uma marca sem
    // src. Assim ele não tenta (e não reclama de) empacotar o que não é módulo.
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        return html.replace(/<script src="([^"]+)"><\/script>/g, (tag, src) => {
          if (/^(https?:)?\/\//.test(src)) return tag; // CDN: fica como está
          const abs = src.startsWith('/') ? resolve(raiz, '.' + src) : resolve(dirname(ctx.filename), src);
          return `<script data-classico="${relative(raiz, abs).split(sep).join('/')}"></script>`;
        });
      }
    },

    async generateBundle(_, bundle) {
      const emitidos = new Map();
      for (const item of Object.values(bundle)) {
        if (item.type !== 'asset' || !item.fileName.endsWith('.html')) continue;
        let html = String(item.source);
        for (const [tag, rel] of [...html.matchAll(MARCA)]) {
          if (!emitidos.has(rel)) {
            const codigo = readFileSync(resolve(raiz, rel), 'utf8');
            const { code } = await transform(codigo, {
              loader: 'js',
              minify: true,
              target: 'esnext',
              charset: 'utf8',
              legalComments: 'none'
            });
            const hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
            const partes = rel.split('/');
            const nome =
              partes[1] === 'pages' ? `${partes[2]}-${basename(rel, '.js')}` : basename(rel, '.js');
            const fileName = `static/js/${nome}-${hash}.js`;
            this.emitFile({ type: 'asset', fileName, source: code });
            emitidos.set(rel, fileName);
          }
          html = html.replace(tag, `<script src="/${emitidos.get(rel)}"></script>`);
        }
        item.source = html;
      }
    }
  };
}
