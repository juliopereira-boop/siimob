const { abrir, checa, resumo } = require('./comum');
(async () => {
  let f = 0;
  { const { b, p, erros } = await abrir('configuracoes.html');
    console.log('== CADASTRO: Modalidade de Imóvel ==');
    await p.evaluate(() => openCfgView('modalidades')); await p.waitForTimeout(600);
    checa('tela abre', await p.locator('#cfg-view-modalidades').isVisible());
    checa('lista as modalidades', (await p.locator('#modalidade-tbody tr').count()) === 2,
          'linhas='+(await p.locator('#modalidade-tbody tr').count()));
    await p.evaluate(() => openSimples('modalidade', null)); await p.waitForTimeout(400);
    checa('modal abre sem campo de número', await p.locator('#modal-simples-bg').isVisible()
          && !(await p.locator('#simples-numero-wrap').isVisible()));
    checa('título certo', /modalidade/i.test(await p.locator('#simples-title').textContent()));
    await p.evaluate(() => closeModal('modal-simples-bg'));
    checa('card no hub', (await p.locator('#cfg-hub').textContent()).includes('Modalidades de Imóvel'));
    f += resumo(erros); await b.close(); }

  { const { b, p, erros } = await abrir('repasse.html', {filtros:false});
    console.log('\n== FILTROS RECOLHIDOS ==');
    checa('barra do dashboard começa escondida', !(await p.locator('#dash-filter-bar').isVisible()));
    checa('botão Filtrar aparece', await p.locator('#btn-filtrar-dash').isVisible());
    await p.click('#btn-filtrar-dash'); await p.waitForTimeout(300);
    checa('clicar abre a barra', await p.locator('#dash-filter-bar').isVisible());
    await p.click('#btn-filtrar-dash'); await p.waitForTimeout(300);
    checa('clicar de novo fecha', !(await p.locator('#dash-filter-bar').isVisible()));
    checa('estado guardado no navegador',
      (await p.evaluate(() => localStorage.getItem('a1_filtros_dash'))) === 'fechado');

    console.log('\n== CONTADOR DE FILTROS ATIVOS ==');
    checa('sem filtro, sem contador', (await p.locator('#filtros-ativos-dash').textContent()).trim() === '');
    await p.click('#btn-filtrar-dash'); await p.waitForTimeout(250);
    await p.selectOption('#df-modalidade','Imóvel na planta'); await p.waitForTimeout(500);
    const txt = await p.locator('#filtros-ativos-dash').textContent();
    checa('contador mostra 1 filtro', /1\s*filtro aplicado/.test(txt), txt.trim());
    checa('filtro de modalidade funciona', (await p.locator('#kpi-total').textContent()).trim() === '1');
    await p.selectOption('#df-corretor','Ana Souza'); await p.waitForTimeout(500);
    checa('contador vai para 2', /2\s*filtros aplicados/.test(await p.locator('#filtros-ativos-dash').textContent()));
    await p.locator('#filtros-ativos-dash .filtros-limpar').click(); await p.waitForTimeout(500);
    checa('limpar pelo contador zera', (await p.locator('#filtros-ativos-dash').textContent()).trim() === '');
    checa('e devolve o total', (await p.locator('#kpi-total').textContent()).trim() === '4');

    console.log('\n== KPI: PROCESSOS POR COORDENADOR ==');
    const painel = await p.locator('#coord-dist-list').textContent();
    checa('painel existe e tem dados', painel.includes('Marcos Lima') && painel.includes('Rita Alves'), painel.slice(0,90));
    const linhas = await p.locator('#coord-dist-list .dist-row').count();
    checa('só coordenadores com processo', linhas === 2, 'linhas='+linhas);
    const marcos = await p.locator('#coord-dist-list .dist-row').filter({hasText:'Marcos Lima'}).locator('.dist-val').textContent();
    checa('Marcos conta a equipe inteira = 2', marcos.trim() === '2', 'valor='+marcos);
    checa('painel de modalidade também', (await p.locator('#modalidade-dist-list').textContent()).includes('Imóvel na planta'));

    console.log('\n== BARRA DA LISTAGEM ==');
    await p.evaluate(() => switchTab('repasse', document.querySelector('.tab-btn'))); await p.waitForTimeout(600);
    checa('barra da listagem começa escondida', !(await p.locator('#filter-bar').isVisible()));
    await p.click('#btn-filtrar-lista'); await p.waitForTimeout(300);
    checa('abre', await p.locator('#filter-bar').isVisible());
    checa('modalidade está na barra', await p.locator('#f-modalidade').count() === 1);
    await p.selectOption('#f-modalidade','Imóvel na planta');
    await p.evaluate(()=>document.getElementById('f-modalidade').dispatchEvent(new Event('change',{bubbles:true})));
    await p.waitForTimeout(500);
    checa('filtra o pipeline', (await p.locator('.k-card').count()) === 1);
    checa('contador da listagem', /1\s*filtro aplicado/.test(await p.locator('#filtros-ativos-lista').textContent()));

    console.log('\n== NOVO REPASSE ==');
    await p.evaluate(() => clearFilters()); await p.waitForTimeout(400);
    await p.evaluate(() => openNewCase()); await p.waitForTimeout(900);
    checa('campo de modalidade existe',
      (await p.locator('#n-modalidade option').allTextContents()).includes('Imóvel na planta'));
    checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
    f += resumo(erros); await b.close(); }

  process.exit(f ? 1 : 0);
})();
