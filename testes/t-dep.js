const { abrir, checa, resumo } = require('./comum');
(async () => {
  let f = 0;
  { const { b, p, erros } = await abrir('repasse.html');
    console.log('== FILTROS REFLETEM OS CADASTROS (o bug relatado) ==');
    const opc = async id => (await p.locator(`#${id} option`).allTextContents());
    checa('imobiliária cadastrada SEM processo aparece (dashboard)',
      (await opc('df-re')).includes('Imob Recem Cadastrada'), (await opc('df-re')).join('|'));
    checa('imobiliária cadastrada SEM processo aparece (listagem)',
      (await opc('f-re')).includes('Imob Recem Cadastrada'));
    checa('correspondente cadastrado sem processo aparece',
      (await opc('df-parceiro')).includes('Correspondente Sem Processo'));
    checa('empreendimento cadastrado sem processo aparece',
      (await opc('df-empr')).includes('Empreendimento Sem Processo'));
    checa('usuário correspondente cadastrado aparece',
      (await opc('f-usuario')).includes('Usuario Novo CCA'));
    checa('corretor cadastrado sem processo aparece',
      (await opc('df-corretor')).includes('Sem Equipe'));
    checa('valor em uso sem cadastro NÃO some',
      (await opc('df-re')).includes('Imob Alfa'), 'perdeu o valor antigo');

    console.log('\n== TEMPO DA VENDA ATÉ CADA ETAPA ==');
    const sub = await p.locator('#tempo-etapa-sub').textContent();
    checa('rodapé conta quem tem e quem não tem data', /3 processos com data preenchida/.test(sub) && /1 sem data/.test(sub), sub);
    const linhas = await p.locator('#tempo-etapa-list .dist-row').count();
    checa('desenha uma linha por etapa com dados', linhas === 3, 'linhas='+linhas);
    const vals = await p.locator('#tempo-etapa-list .dist-val').allTextContents();
    checa('mostra dias', vals.every(v=>/^\d+d$/.test(v)), vals.join('|'));
    // c1: venda 01/07 -> etapa em 01/08 = 31d
    const t1 = await p.locator('#tempo-etapa-list .dist-row').first().locator('.dist-val').textContent();
    checa('conta certo os dias da 1ª etapa', t1.trim() === '31d', t1);

    console.log('\n== DATA DA VENDA NO CADASTRO ==');
    await p.evaluate(() => openNewCase()); await p.waitForTimeout(900);
    checa('campo no Novo Repasse', await p.locator('#n-data-venda').count() === 1);
    await p.fill('#n-data-venda','2026-08-10');
    await p.fill('#n-name','Cliente Data');
    await p.selectOption('#n-development','d1'); await p.waitForTimeout(300);
    await p.evaluate(() => { const s=document.getElementById('n-stage'); if(s&&s.options.length>1) s.selectedIndex=1;
      ['n-partner','n-re'].forEach(i=>{const e=document.getElementById(i); if(e&&e.options.length>1) e.selectedIndex=1;}); });
    await p.evaluate(() => { window.__POSTS=[]; });
    await p.evaluate(() => createCase()); await p.waitForTimeout(900);
    const post = (await p.evaluate(()=>window.__POSTS||[])).find(x=>x.m==='POST' && /a1_cases/.test(x.url));
    checa('POST leva a data da venda', post && JSON.parse(post.body).payload.data_venda === '2026-08-10',
          post ? JSON.stringify(JSON.parse(post.body).payload) : 'sem POST');
    checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
    f += resumo(erros); await b.close(); }

  { const { b, p, erros } = await abrir('configuracoes.html');
    console.log('\n== ID EM TODOS OS CADASTROS ==');
    const casos = [['imobiliarias','#imob-tbody'],['gestores','#gestor-tbody'],['empreendimentos','#empr-list'],
                   ['despachantes','#desp-list'],['bancos','#bancos-list'],['cartorios','#cartorios-list'],
                   ['analistas','#analista-tbody'],['corretores','#corretor-tbody'],
                   ['convenios','#convenio-tbody'],['agencias','#agencia-tbody'],
                   ['modalidades','#modalidade-tbody'],['coordenadores','#coordenador-tbody']];
    for (const [view, sel] of casos) {
      await p.evaluate(v => openCfgView(v), view); await p.waitForTimeout(400);
      const n = await p.locator(`${sel} code[onclick^="copiarId"]`).count();
      checa(`${view} mostra ID`, n >= 1, `chips=${n}`);
    }
    await p.evaluate(() => openCfgView('flags')); await p.waitForTimeout(400);
    checa('flags mostram ID', (await p.locator('#flags-list code[onclick^="copiarId"]').count()) >= 1);
    f += resumo(erros); await b.close(); }
  process.exit(f ? 1 : 0);
})();
