const { abrir, checa, resumo } = require('./comum');
(async () => {
  const { b, p, erros } = await abrir('configuracoes.html');
  console.log('== HUB ORGANIZADO ==');
  const grupos = await p.evaluate(() => [...document.querySelectorAll('#cfg-hub .cfg-grupo')].map(g => ({
    titulo: g.querySelector('.cfg-section-hdr').textContent.trim(),
    sub: g.querySelector('.cfg-section-sub')?.textContent.trim() || '',
    cards: [...g.querySelectorAll('.cfg-hub-card .cfg-card-label')].map(c=>c.textContent.trim())
  })));
  grupos.forEach(g => { console.log(`\n  [${g.titulo}] ${g.sub}`); g.cards.forEach(c=>console.log('     · '+c)); });
  checa('5 grupos', grupos.length === 5, 'n='+grupos.length);
  checa('todo grupo tem explicação', grupos.every(g=>g.sub.length > 10));
  checa('21 cards no total', grupos.reduce((a,g)=>a+g.cards.length,0) === 21);
  checa('nenhum card órfão fora de grupo',
    (await p.locator('#cfg-hub .cfg-hub-card').count()) === (await p.locator('#cfg-hub .cfg-grupo .cfg-hub-card').count()));

  console.log('\n== BUSCA ==');
  await p.fill('#cfg-busca','corret'); await p.waitForTimeout(300);
  const vis = await p.locator('#cfg-hub .cfg-hub-card:not(.oculto)').count();
  checa('busca filtra os cards', vis === 2, 'visíveis='+vis);
  const gruposVis = await p.evaluate(() => [...document.querySelectorAll('#cfg-hub .cfg-grupo')].filter(g=>g.style.display!=='none').length);
  checa('grupo vazio some', gruposVis === 1, 'grupos visíveis='+gruposVis);
  await p.fill('#cfg-busca','zzzzz'); await p.waitForTimeout(250);
  checa('avisa quando não acha nada', await p.locator('#cfg-busca-vazio').isVisible());
  await p.fill('#cfg-busca',''); await p.waitForTimeout(250);
  checa('limpar devolve tudo', (await p.locator('#cfg-hub .cfg-hub-card:not(.oculto)').count()) === 21);

  console.log('\n== AS TELAS CONTINUAM ABRINDO ==');
  const VIEWS = ['wf','flags','regionais','empreendimentos','imobiliarias','doctypes','comissao','analistas',
                 'corretores','precad','gestores','convenios','modalidades','coordenadores','agencias',
                 'correspondentes','despachantes','bancos','cartorios'];
  let ruins = [];
  for (const v of VIEWS) {
    await p.evaluate(x => openCfgView(x), v); await p.waitForTimeout(200);
    if (!(await p.locator(`#cfg-view-${v}`).isVisible())) ruins.push(v);
  }
  checa('as 19 telas abrem', ruins.length === 0, ruins.join(','));
  await p.evaluate(() => closeCfgView()); await p.waitForTimeout(200);
  checa('voltar mostra o hub', await p.locator('#cfg-hub').isVisible());
  checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
  const n = resumo(erros); await b.close(); process.exit(n?1:0);
})();
