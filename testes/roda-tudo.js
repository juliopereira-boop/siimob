// Corredor único da suíte. Sobe o servidor estático, roda cada arquivo t-*.js
// num processo separado e devolve saída != 0 se qualquer um falhar — é isso que
// a CI lê para reprovar um push.
//
//   npm test                 roda tudo
//   npm test -- t-gerente    roda só os que casarem com o filtro
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { carregarRotas, reescrever } = require('../tools/rotas');

const PROJETO = path.join(__dirname, '..');
// A suíte roda contra o BUILD (dist/), não contra a fonte: é o dist que a
// Vercel publica. Testar a fonte provaria um sistema que ninguém usa — um erro
// do build (arquivo que não foi para o dist, ordem de CSS trocada) passaria.
const RAIZ = path.join(PROJETO, 'dist');
const PORTA = Number(process.env.PORTA_TESTE || 8099);
const filtro = process.argv[2] || '';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// AS ROTAS DE PRODUÇÃO VALEM AQUI TAMBÉM.
// O servidor de teste servia arquivo cru: `/repasse.html` funcionava,
// `/thecred/repasse` dava 404. Só que em produção é SEMPRE a segunda forma — e
// o apelido do cliente é lido do próprio caminho (getSlugFromURL). Sem a
// reescrita, nenhum teste exercitava esse caminho, e um defeito ali passaria
// pela suíte inteira sem ninguém ver. As regras saem de vercel.json, por
// tools/rotas.js — o mesmo leitor do servidor de desenvolvimento.
const REGRAS = carregarRotas(PROJETO);

// SEM_BUILD=1 pula o build (útil quando você acabou de rodar `npm run build`).
function construir() {
  if (process.env.SEM_BUILD === '1' && fs.existsSync(RAIZ)) return;
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'build', '--logLevel', 'error'],
    { cwd: PROJETO, stdio: 'inherit' }
  );
  if (r.status !== 0) {
    console.error('\n>>> o build falhou; a suíte não roda contra código que não compila.');
    process.exit(1);
  }
}

// Servidor mínimo em Node: um a menos entre "rodar o teste" e "ter python".
function servir() {
  return new Promise((ok, erro) => {
    const s = http.createServer((req, res) => {
      const caminho = decodeURIComponent(req.url.split('?')[0]);
      const rel = reescrever(caminho, REGRAS).replace(/^\/+/, '');
      const alvo = path.resolve(RAIZ, rel || 'index.html');
      if (!alvo.startsWith(RAIZ)) {
        res.writeHead(403).end();
        return;
      } // nada fora da pasta
      fs.readFile(alvo, (e, dados) => {
        if (e) {
          res.writeHead(404).end('não encontrado');
          return;
        }
        res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream' });
        res.end(dados);
      });
    });
    s.on('error', erro);
    s.listen(PORTA, () => ok(s));
  });
}

function rodar(arquivo) {
  return new Promise(ok => {
    const p = spawn(process.execPath, [path.join(__dirname, arquivo)], {
      stdio: 'inherit',
      env: { ...process.env, PORTA_TESTE: String(PORTA) }
    });
    p.on('close', codigo => ok(codigo === 0));
  });
}

(async () => {
  const suites = fs
    .readdirSync(__dirname)
    .filter(f => /^t-.*\.js$/.test(f))
    .filter(f => !filtro || f.includes(filtro))
    .sort();

  if (!suites.length) {
    console.error('nenhuma suíte casou com "' + filtro + '"');
    process.exit(1);
  }

  construir();
  const servidor = await servir();
  console.log(`servindo ${RAIZ} em http://localhost:${PORTA}\n`);

  const falharam = [];
  for (const s of suites) {
    console.log('\n' + '━'.repeat(70) + '\n  ' + s + '\n' + '━'.repeat(70));
    if (!(await rodar(s))) falharam.push(s);
  }
  servidor.close();

  console.log('\n' + '═'.repeat(70));
  if (falharam.length) {
    console.log(`REPROVADO — ${falharam.length} de ${suites.length} suítes falharam:`);
    falharam.forEach(s => console.log('  · ' + s));
    process.exit(1);
  }
  console.log(`APROVADO — ${suites.length} suítes, todas verdes.`);
})();
