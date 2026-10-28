// Troca de vista sem "flash".
//
// O relato do dono (27/10): no Repasse, toda troca de vista mostrava o
// Dashboard por um instante antes do Andamento ou da Listagem. Nas outras telas
// (Venda, Pré-análise) o que piscava era a marca do SIIMOB, gigante.
//
// As duas causas eram de marcação, não de dado:
// - andamento.html e listagem.html são cópias de repasse.html e herdaram o
//   #tab-dashboard visível de saída; ele só sumia depois da carga inteira.
// - comercial.html e pre-analise.html não traziam o CSS do cabeçalho no
//   <head>; o shell o injetava depois de desenhar, e o SVG da marca, sem
//   tamanho, ocupava a largura da tela até o estilo chegar.
//
// Por isso este teste não usa abrir(): ele precisa olhar a tela DURANTE a
// carga. A leitura dos processos é atrasada de propósito, e um vigia na página
// anota tudo o que ficou visível enquanto isso. Sem o atraso, a carga do banco
// falso é instantânea e o flash não teria tempo de existir, que é o jeito de
// um teste passar mentindo.
const { chromium } = require('playwright');
const {
  responder,
  liberarModulos,
  usarExtras,
  negarModulos,
  usarDocTypes,
  usarManutencao
} = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);
const ATRASO = 1500;

async function abrirDevagar(pag, modulos, atrasarCss) {
  usarExtras(false);
  liberarModulos(modulos);
  negarModulos([]);
  usarDocTypes(undefined);
  usarManutencao(undefined);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.addInitScript(() => {
    localStorage.setItem('a1_token', 'tok');
    localStorage.setItem('a1_slug', 'thecred');
    localStorage.setItem(
      'a1_user',
      JSON.stringify({ id: 'u1', tenant_id: 't1', name: 'Julio', role: 'owner', cpf: '99999999999' })
    );
    window.__XSS = 0;
    window.__VIGIA = { dash: false, maiorMarca: 0 };
    const visivel = el =>
      !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const olha = () => {
      const v = window.__VIGIA;
      if (visivel(document.getElementById('tab-dashboard'))) v.dash = true;
      const m = document.querySelector('.sb-marca svg');
      if (m) v.maiorMarca = Math.max(v.maiorMarca, m.getBoundingClientRect().width);
      requestAnimationFrame(olha);
    };
    requestAnimationFrame(olha);
  });
  await p.route(/supabase\.co/, async r => {
    const url = r.request().url();
    if (/a1_cases/.test(url) && r.request().method() === 'GET') {
      await new Promise(ok => setTimeout(ok, ATRASO));
    }
    let d;
    try {
      d = responder(url, r.request().method(), r.request().postData());
    } catch (e) {
      d = [];
    }
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-1/2' },
      body: JSON.stringify(d)
    });
  });
  if (atrasarCss) {
    // Rede lenta para o estilo: é aí que a marca sem tamanho aparecia.
    await p.route(/\/css\/siimob\.css$/, async r => {
      await new Promise(ok => setTimeout(ok, ATRASO));
      r.continue();
    });
  }
  await p.goto(BASE + '/' + pag, { waitUntil: 'commit' });
  return { b, p, erros };
}

(async () => {
  const todosErros = [];

  for (const [pag, vista] of [
    ['andamento.html', 'view-andamento'],
    ['listagem.html', 'view-listagem']
  ]) {
    console.log(`\n${pag}`);
    const { b, p, erros } = await abrirDevagar(pag, [], false);
    await p.waitForTimeout(ATRASO / 2);
    const meio = await p.evaluate(() => ({
      repasse: getComputedStyle(document.getElementById('tab-repasse')).display !== 'none',
      texto: document.getElementById('tab-repasse').innerText
    }));
    checa('durante a carga, a área do repasse já está à vista', meio.repasse);
    checa('durante a carga, a tela avisa que está carregando', /Carregando/.test(meio.texto));
    await p.waitForTimeout(ATRASO + 1500);
    const fim = await p.evaluate(
      v => ({
        vigia: window.__VIGIA,
        vista: getComputedStyle(document.getElementById(v)).display !== 'none',
        dash: getComputedStyle(document.getElementById('tab-dashboard')).display
      }),
      vista
    );
    checa('o Dashboard não aparece em momento nenhum da carga', fim.vigia.dash === false);
    checa('depois da carga, a vista certa está aberta', fim.vista);
    checa('depois da carga, o Dashboard segue escondido', fim.dash === 'none');
    checa('nenhum XSS disparou', (await p.evaluate(() => window.__XSS)) === 0);
    todosErros.push(...erros.map(e => pag + ': ' + e));
    await b.close();
  }

  for (const [pag, mod] of [
    ['comercial.html', 'COMERCIAL'],
    ['pre-analise.html', 'PRE_ANALISE']
  ]) {
    console.log(`\n${pag}`);
    const { b, p, erros } = await abrirDevagar(pag, [mod], true);
    await p.waitForTimeout(ATRASO * 2 + 1500);
    const v = await p.evaluate(() => window.__VIGIA);
    checa(
      'a marca do SIIMOB nunca passa do tamanho do cabeçalho',
      v.maiorMarca > 0 && v.maiorMarca <= 40,
      `(maior largura vista: ${Math.round(v.maiorMarca)}px)`
    );
    todosErros.push(...erros.map(e => pag + ': ' + e));
    await b.close();
  }

  process.exit(resumo(todosErros) ? 1 : 0);
})();
