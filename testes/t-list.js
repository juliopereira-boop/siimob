const { abrir, checa, resumo } = require('./comum');
(async () => {
  let falhas = 0;
  { // ── LISTAGEM + relatório ──
    const { b, p, erros } = await abrir('listagem.html');
    console.log('== LISTAGEM ==');
    await p.evaluate(()=>{['dash','lista'].forEach(q=>{const b=document.getElementById(q==='dash'?'dash-filter-bar':'filter-bar'); if(b) b.style.display='';});});
    checa('tabela desenha linhas', (await p.locator('#cases-tbody tr').count()) >= 2);
    checa('filtro agência na listagem', await p.locator('#f-agencia').count() === 1);
    checa('botão de relatório existe', (await p.locator('button:has-text("Gerar relatório")').count()) === 1);

    // intercepta o download do CSV
    await p.evaluate(() => {
      window.__CSV = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = b => { window.__BLOB = b; return orig.call(URL, b); };
      const clique = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function(){ if(this.download) window.__BAIXOU = this.download; else clique.call(this); };
    });
    await p.evaluate(() => exportarPlanilha()); await p.waitForTimeout(700);
    const csv = await p.evaluate(async () => window.__BLOB ? await window.__BLOB.text() : null);
    checa('relatório gerou arquivo', !!csv);
    if (csv) {
      const cab = csv.split('\n')[0];
      checa('relatório traz coluna Agência', cab.includes('Agência'), cab.slice(0,140));
      checa('relatório traz Estado e Cidade', cab.includes('Estado') && cab.includes('Cidade'));
      checa('relatório com todos os processos', csv.trim().split('\n').length === 5, `linhas=${csv.trim().split('\n').length}`);
      checa('separador ; para Excel BR', cab.includes(';'));
    }
    // relatório respeita o filtro
    await p.selectOption('#f-agencia','1234 - Centro');
    await p.evaluate(() => { document.getElementById('f-agencia').dispatchEvent(new Event('change',{bubbles:true})); });
    await p.waitForTimeout(500);
    await p.evaluate(() => exportarPlanilha()); await p.waitForTimeout(600);
    const csv2 = await p.evaluate(async () => window.__BLOB ? await window.__BLOB.text() : null);
    checa('relatório respeita o filtro', csv2 && csv2.trim().split('\n').length === 2, `linhas=${csv2?csv2.trim().split('\n').length:'-'}`);
    checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
    falhas += resumo(erros); await b.close();
  }
  { // ── ANDAMENTO ──
    const { b, p, erros } = await abrir('andamento.html');
    console.log('\n== ANDAMENTO ==');
    checa('pipeline desenha', (await p.locator('.k-card').count()) === 4);
    checa('colunas por etapa', (await p.locator('.k-col-body').count()) >= 3);
    checa('rolagem própria por coluna', await p.locator('.k-col-body').first().evaluate(el=>getComputedStyle(el).overflowY) === 'auto');
    checa('filtro agência', await p.locator('#f-agencia').count() === 1);
    checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
    falhas += resumo(erros); await b.close();
  }
  { // ── WORKFLOW / TENANT-ADMIN ──
    const { b, p, erros } = await abrir('workflow.html?module=repasse');
    console.log('\n== WORKFLOW ==');
    const txt = await p.content();
    checa('etapas desenhadas', (await p.locator('.node-name').count()) >= 3);
    checa('nome de etapa escapado', !txt.includes('<img src=x onerror'), 'HTML cru na tela');
    checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
    falhas += resumo(erros); await b.close();
  }
  { const { b, p, erros } = await abrir('tenant-admin.html');
    console.log('\n== TENANT-ADMIN ==');
    checa('usuários listados', (await p.locator('#users-tbody tr').count()) >= 1);
    checa('parceiros listados', (await p.locator('#partners-tbody tr').count()) >= 1);
    checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
    falhas += resumo(erros); await b.close();
  }
  process.exit(falhas ? 1 : 0);
})();
