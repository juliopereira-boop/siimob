// Renderiza as peças do Instagram em 1080x1350 — o formato que o Instagram
// entrega maior no feed. Resolução nativa, sem reamostragem: o Chromium
// desenha o texto direto no tamanho final, que é o que mantém a serifa fina
// legível depois da compressão do app.
const { chromium } = require('playwright');
const path = require('path');

const PECAS = process.argv.slice(2);
if (!PECAS.length) { console.error('uso: node render.js post-01 post-02'); process.exit(1); }

(async () => {
  const b = await chromium.launch();
  for (const nome of PECAS) {
    const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
    const erros = [];
    p.on('pageerror', e => erros.push(e.message));
    await p.goto('file://' + path.join(__dirname, nome + '.html'), { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(__dirname, nome + '.png') });
    console.log(nome + '.png' + (erros.length ? '  ERROS: ' + erros.join(' | ') : '  ok'));
    await p.close();
  }
  await b.close();
})();
