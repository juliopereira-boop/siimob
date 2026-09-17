#!/usr/bin/env node
// ─── O SIIMOB rodando na sua máquina ────────────────────────────────────────
//
//   node servidor-local.js          →  http://localhost:3000
//   node servidor-local.js 8080     →  outra porta
//
// POR QUE ESTE ARQUIVO EXISTE
// `python -m http.server` serve os arquivos, mas NÃO faz as reescritas de rota.
// E as rotas do SIIMOB não são enfeite: o apelido do cliente é lido do próprio
// caminho (A1.slug → getSlugFromURL). Sem a reescrita, /thecred/repasse dá 404;
// e abrir /repasse.html direto faz o sistema não saber de que cliente é a
// sessão. Este servidor aplica as MESMAS regras de vercel.json — lendo o
// arquivo, não copiando-as, para não existir uma terceira verdade sobre as
// rotas quando alguém acrescentar uma.
//
// O QUE ELE NÃO É
// Não é para pôr cliente no ar. Ouve só em 127.0.0.1, não tem HTTPS e não tem
// controle de acesso. É bancada de trabalho: você abre no seu navegador, entra
// com o seu login e usa o sistema contra o Supabase de VERDADE.
//
// ⚠ O BANCO É O DE PRODUÇÃO. js/config.js aponta para o projeto real do
// Supabase, e não há um banco de desenvolvimento separado. O que você criar,
// mover ou apagar aqui acontece na base dos clientes. Para experimentar sem
// tocar em nada, use a suíte de testes (`npm test`), que finge ser o Supabase.

const http = require('http');
const fs   = require('fs');
const path = require('path');

const RAIZ  = __dirname;
const PORTA = Number(process.argv[2] || process.env.PORTA || 3000);

// As regras saem de vercel.json. `/:slug/repasse` vira uma expressão que casa
// um pedaço do caminho sem barra — do mesmo jeito que a Vercel entende.
const REGRAS = (() => {
  let conf;
  try { conf = JSON.parse(fs.readFileSync(path.join(RAIZ, 'vercel.json'), 'utf8')); }
  catch (e) { console.error('Não consegui ler vercel.json:', e.message); process.exit(1); }
  return (conf.rewrites || []).map(r => ({
    re: new RegExp('^' + r.source
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/:\w+/g, '[^/]+')
          .replace(/\*/g, '.*') + '/?$'),
    fonte: r.source,
    destino: r.destination
  }));
})();

const TIPOS = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff',
  '.pdf':'application/pdf', '.txt':'text/plain; charset=utf-8', '.webmanifest':'application/manifest+json'
};

const servidor = http.createServer((req, res) => {
  const caminho = decodeURIComponent(req.url.split('?')[0]);

  // A reescrita vem ANTES de procurar arquivo: é isso que a Vercel faz, e é o
  // que faz /thecred/repasse chegar em repasse.html com o slug preservado na
  // barra de endereço.
  const regra = REGRAS.find(r => r.re.test(caminho));
  const alvo  = regra ? regra.destino : caminho;

  const arquivo = path.resolve(RAIZ, '.' + alvo);
  // Nada fora da pasta do projeto. `..` no endereço é a forma clássica de
  // pedir /etc/passwd a um servidor de arquivos escrito às pressas.
  if (!arquivo.startsWith(RAIZ)) { res.writeHead(403).end('fora da pasta'); return; }

  fs.readFile(arquivo, (erro, dados) => {
    if (erro) {
      res.writeHead(404, { 'Content-Type':'text/html; charset=utf-8' });
      res.end(`<meta charset="utf-8"><body style="font:15px system-ui;padding:3rem;color:#09201D">
        <h2 style="margin:0 0 .5rem">404 — ${caminho}</h2>
        <p style="color:#47615C">Nenhuma regra de <code>vercel.json</code> casou com este caminho,
        e não existe arquivo em <code>${alvo}</code>.</p>
        <p style="color:#6B827D;font-size:.85rem">Rota de cliente é <code>/apelido-do-cliente/tela</code>,
        por exemplo <code>/thecred/geral</code>.</p></body>`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream',
      // Sem cache: você está editando arquivo e recarregando. Cache aqui faria
      // você depurar a versão anterior do próprio código.
      'Cache-Control': 'no-store'
    });
    res.end(dados);
  });
});

servidor.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  A porta ${PORTA} já está ocupada. Tente outra:  node servidor-local.js 3001\n`);
    process.exit(1);
  }
  throw e;
});

// 127.0.0.1 e não 0.0.0.0: ouvir em todas as interfaces publicaria o sistema
// para a rede do escritório inteiro, com o banco de produção atrás.
servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`
  SIIMOB rodando em  http://localhost:${PORTA}
  ${REGRAS.length} rotas carregadas de vercel.json

  Abra pelo login do cliente, por exemplo:
     http://localhost:${PORTA}/demo-correspondente/login
     http://localhost:${PORTA}/thecred/login

  O banco é o SUPABASE DE PRODUÇÃO. O que você fizer aqui é real.
  Ctrl+C para parar.
`);
});
