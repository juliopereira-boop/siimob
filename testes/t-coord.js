const { abrir, checa, resumo } = require('./comum');
(async () => {
  let falhas = 0;
  { const { b, p, erros } = await abrir('repasse.html');
    console.log('== DASHBOARD ==');
    await p.evaluate(()=>{['dash','lista'].forEach(q=>{const b=document.getElementById(q==='dash'?'dash-filter-bar':'filter-bar'); if(b) b.style.display='';});});
    checa('filtro de coordenador existe', await p.locator('#df-coordenador').count() === 1);
    const opts = await p.locator('#df-coordenador option').allTextContents();
    checa('lista os coordenadores cadastrados', opts.includes('Marcos Lima') && opts.includes('Rita Alves'), opts.join('|'));
    checa('total sem filtro = 4', (await p.locator('#kpi-total').textContent()).trim() === '4');

    await p.selectOption('#df-coordenador','Marcos Lima'); await p.waitForTimeout(600);
    checa('Marcos traz a EQUIPE (Ana + Carla) = 2', (await p.locator('#kpi-total').textContent()).trim() === '2',
          'total='+(await p.locator('#kpi-total').textContent()).trim());
    await p.selectOption('#df-coordenador','Rita Alves'); await p.waitForTimeout(600);
    checa('Rita traz só o Diego = 1', (await p.locator('#kpi-total').textContent()).trim() === '1');
    await p.evaluate(() => clearDashFilters()); await p.waitForTimeout(600);
    checa('limpar volta para 4', (await p.locator('#kpi-total').textContent()).trim() === '4');
    checa('limpar zera o select', (await p.inputValue('#df-coordenador')) === '');

    console.log('\n== PIPELINE ==');
    await p.evaluate(()=>{const b=document.getElementById('filter-bar'); if(b) b.style.display='';});
    await p.evaluate(() => switchTab('repasse', document.querySelector('.tab-btn'))); await p.waitForTimeout(700);
    checa('filtro na barra do pipeline', await p.locator('#f-coordenador').count() === 1);
    checa('4 cartões sem filtro', (await p.locator('.k-card').count()) === 4);
    await p.selectOption('#f-coordenador','Marcos Lima');
    await p.evaluate(()=>document.getElementById('f-coordenador').dispatchEvent(new Event('change',{bubbles:true})));
    await p.waitForTimeout(600);
    checa('pipeline filtra pela equipe = 2', (await p.locator('.k-card').count()) === 2);
    await p.evaluate(() => clearFilters()); await p.waitForTimeout(600);
    checa('limpar volta 4 cartões', (await p.locator('.k-card').count()) === 4);
    checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
    falhas += resumo(erros); await b.close(); }

  { const { b, p, erros } = await abrir('listagem.html');
    console.log('\n== LISTAGEM + RELATÓRIO ==');
    checa('filtro existe', await p.locator('#f-coordenador').count() === 1);
    await p.evaluate(() => {
      const orig = URL.createObjectURL;
      URL.createObjectURL = bb => { window.__BLOB = bb; return orig.call(URL, bb); };
      HTMLAnchorElement.prototype.click = function(){};
    });
    await p.evaluate(() => exportarPlanilha()); await p.waitForTimeout(600);
    let csv = await p.evaluate(async () => window.__BLOB ? await window.__BLOB.text() : null);
    checa('relatório tem coluna Coordenador', csv && csv.split('\n')[0].includes('Coordenador'));
    checa('relatório preenche o coordenador do corretor', csv && /Marcos Lima/.test(csv) && /Rita Alves/.test(csv));
    checa('corretor sem equipe fica em branco', csv && csv.trim().split('\n').length === 5);

    await p.selectOption('#f-coordenador','Marcos Lima');
    await p.evaluate(()=>document.getElementById('f-coordenador').dispatchEvent(new Event('change',{bubbles:true})));
    await p.waitForTimeout(600);
    await p.evaluate(() => exportarPlanilha()); await p.waitForTimeout(600);
    csv = await p.evaluate(async () => window.__BLOB ? await window.__BLOB.text() : null);
    checa('relatório respeita o filtro de coordenador', csv && csv.trim().split('\n').length === 3,
          'linhas='+(csv?csv.trim().split('\n').length:'-'));
    falhas += resumo(erros); await b.close(); }
  process.exit(falhas ? 1 : 0);
})();
