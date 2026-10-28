// ─── As rotas da Vercel no servidor de desenvolvimento e no preview ──────────
//
// `npm run dev` abre /cliente/repasse do mesmo jeito que a produção. No
// desenvolvimento a tela é servida direto da fonte (src/pages/<tela>/index.html);
// no preview, do build (dist/<tela>.html), que é exatamente o que vai ao ar.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { carregarRotas, reescrever } = require('../rotas.js');

function middleware(paraFonte) {
  const rotas = carregarRotas();
  return (req, _res, next) => {
    const [caminho, busca] = req.url.split('?');
    let alvo = reescrever(decodeURIComponent(caminho), rotas);
    const tela = paraFonte && alvo.match(/^\/([\w-]+)\.html$/);
    if (tela) alvo = `/src/pages/${tela[1]}/index.html`;
    if (alvo !== caminho) req.url = alvo + (busca ? '?' + busca : '');
    next();
  };
}

export default function rotasVercel() {
  return {
    name: 'siimob:rotas-vercel',
    configureServer(server) {
      server.middlewares.use(middleware(true));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(false));
    }
  };
}
