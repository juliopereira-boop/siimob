// Corredor único da suíte. Sobe o servidor estático, roda cada arquivo t-*.js
// num processo separado e devolve saída != 0 se qualquer um falhar — é isso que
// a CI lê para reprovar um push.
//
//   npm test                 roda tudo
//   npm test -- t-gerente    roda só os que casarem com o filtro
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const RAIZ = path.join(__dirname, '..');
const PORTA = Number(process.env.PORTA_TESTE || 8099);
const filtro = process.argv[2] || '';

const TIPOS = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8' };

// Servidor mínimo em Node: um a menos entre "rodar o teste" e "ter python".
function servir() {
  return new Promise((ok, erro) => {
    const s = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const alvo = path.resolve(RAIZ, rel || 'index.html');
      if (!alvo.startsWith(RAIZ)) { res.writeHead(403).end(); return; }   // nada fora da pasta
      fs.readFile(alvo, (e, dados) => {
        if (e) { res.writeHead(404).end('não encontrado'); return; }
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
    const p = spawn(process.execPath, [path.join(__dirname, arquivo)],
      { stdio: 'inherit', env: { ...process.env, PORTA_TESTE: String(PORTA) } });
    p.on('close', codigo => ok(codigo === 0));
  });
}

(async () => {
  const suites = fs.readdirSync(__dirname)
    .filter(f => /^t-.*\.js$/.test(f))
    .filter(f => !filtro || f.includes(filtro))
    .sort();

  if (!suites.length) { console.error('nenhuma suíte casou com "' + filtro + '"'); process.exit(1); }

  const servidor = await servir();
  console.log(`servindo ${RAIZ} em http://localhost:${PORTA}\n`);

  const falharam = [];
  for (const s of suites) {
    console.log('\n' + '━'.repeat(70) + '\n  ' + s + '\n' + '━'.repeat(70));
    if (!await rodar(s)) falharam.push(s);
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
