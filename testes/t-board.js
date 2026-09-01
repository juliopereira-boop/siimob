const { abrir, checa, resumo } = require('./comum');
(async () => {
  let falhas = 0;
  // ── REPASSE (dashboard + pipeline) ──
  {
    const { b, p, erros } = await abrir('repasse.html');
    console.log('== REPASSE ==');
    await p.evaluate(()=>{['dash','lista'].forEach(q=>{const b=document.getElementById(q==='dash'?'dash-filter-bar':'filter-bar'); if(b) b.style.display='';});});
    checa('KPI total preenchido', /\d/.test(await p.locator('#kpi-total').textContent()));
    checa('filtro de agência existe no dashboard', await p.locator('#df-agencia').count() === 1);
    checa('agência populada no dashboard',
      (await p.locator('#df-agencia option').allTextContents()).includes('1234 - Centro'));
    checa('convênio populado no dashboard',
      (await p.locator('#df-convenio option').allTextContents()).includes('Convênio Alfa'));

    await p.selectOption('#df-agencia','1234 - Centro'); await p.waitForTimeout(500);
    const t1 = await p.locator('#kpi-total').textContent();
    checa('filtrar por agência reduz o total', t1.trim() === '1', `total=${t1}`);
    await p.evaluate(() => clearDashFilters()); await p.waitForTimeout(500);
    checa('limpar filtros volta ao total', (await p.locator('#kpi-total').textContent()).trim() === '4');

    await p.evaluate(() => switchTab('repasse', document.querySelector('.tab-btn')));
    await p.waitForTimeout(700);
    checa('pipeline desenha cartões', (await p.locator('.k-card').count()) >= 4);
    await p.locator('.k-card').first().click(); await p.waitForTimeout(700);
    checa('cartão abre o modal', await p.locator('#modal-card-bg').isVisible());
    await p.evaluate(() => closeModal('modal-card-bg')); await p.waitForTimeout(200);

    await p.evaluate(() => openNewCase()); await p.waitForTimeout(900);
    checa('novo repasse abre', await p.locator('#modal-new-bg').isVisible());
    checa('agência no novo repasse',
      (await p.locator('#n-agencia option').allTextContents()).includes('1234 - Centro'));
    await p.selectOption('#n-development','d1'); await p.waitForTimeout(350);
    checa('estado automático', (await p.inputValue('#n-estado')) === 'SP');
    checa('cidade automática', (await p.inputValue('#n-cidade')) === 'Campinas');
    checa('blocos carregam', (await p.locator('#n-block option').count()) === 2);
    await p.selectOption('#n-block','B1'); await p.waitForTimeout(300);
    checa('unidades carregam', (await p.locator('#n-unit option').count()) === 3);

    // cria de verdade (contra o Supabase falso) e confere o corpo enviado
    await p.fill('#n-name','Cliente Teste');
    await p.selectOption('#n-unit','B1-101');
    await p.selectOption('#n-agencia','1234 - Centro');
    await p.evaluate(() => { const s=document.getElementById('n-stage'); if(s&&s.options.length>1) s.selectedIndex=1; });
    const opts = await p.locator('#n-partner option').count();
    if (opts>1) await p.evaluate(()=>{document.getElementById('n-partner').selectedIndex=1;});
    const re = await p.locator('#n-re option').count();
    if (re>1) await p.evaluate(()=>{document.getElementById('n-re').selectedIndex=1;});
    await p.evaluate(() => createCase()); await p.waitForTimeout(900);
    const posts = await p.evaluate(() => window.__POSTS||[]);
    const criou = posts.find(x=>/a1_cases/.test(x.url) && x.m==='POST');
    checa('criar repasse envia POST', !!criou);
    if (criou) {
      const body = JSON.parse(criou.body);
      checa('POST leva agência',  body.payload.agencia === '1234 - Centro', JSON.stringify(body.payload));
      checa('POST leva estado',   body.payload.estado === 'SP');
      checa('POST leva cidade',   body.payload.cidade === 'Campinas');
    }

    // config embutida nas telas do pipeline
    await p.evaluate(() => switchTab('config', document.querySelectorAll('.tab-btn')[2]));
    await p.waitForTimeout(400);
    for (const v of ['despachantes','bancos','cartorios']) {
      await p.evaluate(x => openCfgView(x), v); await p.waitForTimeout(500);
      const txt = await p.locator(`#cfg-view-${v}`).textContent();
      checa(`pipeline: ${v} lista`, !/Carregando/.test(txt) && !/Erro ao carregar/.test(txt), txt.slice(0,60));
    }
    checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
    falhas += resumo(erros); await b.close();
  }
  process.exit(falhas ? 1 : 0);
})();
