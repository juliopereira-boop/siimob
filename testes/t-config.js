const { abrir, checa, resumo } = require('./comum');
(async () => {
  const { b, p, erros } = await abrir('configuracoes.html');
  console.log('== CONFIGURAÇÕES ==');
  const VIEWS = ['wf','flags','regionais','empreendimentos','imobiliarias','doctypes','comissao','analistas',
                 'corretores','precad','gestores','convenios','coordenadores','agencias','correspondentes',
                 'despachantes','bancos','cartorios'];
  for (const v of VIEWS) {
    await p.evaluate(x => openCfgView(x), v);
    await p.waitForTimeout(420);
    const vis = await p.locator(`#cfg-view-${v}`).isVisible();
    const txt = (await p.locator(`#cfg-view-${v}`).textContent()).trim();
    const travado = /Carregando\.\.\.|Carregando…/.test(txt);
    checa(`view ${v} abre e carrega`, vis && !travado, travado ? '(preso em Carregando)' : '(não abriu)');
  }
  // busca dos três cadastros
  await p.evaluate(() => openCfgView('bancos')); await p.waitForTimeout(500);
  const antes = await p.locator('#bancos-list .cfg-list-row').count();
  await p.fill('#banco-search', 'caixa'); await p.waitForTimeout(300);
  const depois = await p.locator('#bancos-list .cfg-list-row').count();
  checa('busca de bancos filtra', antes === 2 && depois === 1, `antes=${antes} depois=${depois}`);
  await p.fill('#banco-search', 'zzzz'); await p.waitForTimeout(250);
  checa('busca sem resultado avisa', (await p.locator('#bancos-list').textContent()).includes('Nenhum banco encontrado'));

  await p.evaluate(() => openCfgView('cartorios')); await p.waitForTimeout(500);
  checa('cartórios lista', (await p.locator('#cartorios-list .cfg-list-row').count()) === 1);
  await p.evaluate(() => openCfgView('despachantes')); await p.waitForTimeout(500);
  checa('despachantes lista', (await p.locator('#desp-list .cfg-list-row').count()) === 1);

  // modais
  await p.evaluate(() => openCfgView('corretores')); await p.waitForTimeout(600);
  await p.evaluate(() => openCorretor(null)); await p.waitForTimeout(400);
  checa('modal novo corretor abre', await p.locator('#modal-corretor-bg').isVisible());
  checa('etapas listadas no corretor', (await p.locator('#co-etapas-list').textContent()).includes('Análise'));
  await p.evaluate(() => closeModal('modal-corretor-bg'));
  await p.evaluate(() => openCorretor('p3')); await p.waitForTimeout(400);
  checa('editar corretor carrega nome', (await p.inputValue('#co-name')) === 'Ana Souza');
  checa('coordenador vinculado', (await p.inputValue('#co-coordenador')) === 'p7');
  await p.evaluate(() => closeModal('modal-corretor-bg'));

  await p.evaluate(() => openCfgView('precad')); await p.waitForTimeout(600);
  checa('fila de validação lista pendente', (await p.locator('#precad-tbody tr').count()) === 1);
  checa('links gerados listam', (await p.locator('#precad-links-tbody tr').count()) === 1);
  await p.evaluate(() => openPrecadLink()); await p.waitForTimeout(400);
  checa('modal de link abre', await p.locator('#modal-precad-bg').isVisible());
  // Conferido pelo CONTEÚDO, não pela contagem: contar quebrava toda vez que
  // alguém acrescentava uma imobiliária na base de teste.
  { const ops = await p.locator('#pl-imob option').allTextContents();
    checa('select traz todas as imobiliárias cadastradas',
      ops.some(o=>/Imob Alfa/.test(o)) && ops.some(o=>/Imob Recem Cadastrada/.test(o)), ops.join('|'));
    checa('e a opção de nenhuma', ops.some(o=>/Sem imobiliária/i.test(o)), ops.join('|')); }
  await p.evaluate(() => closeModal('modal-precad-bg'));

  await p.evaluate(() => openCfgView('empreendimentos')); await p.waitForTimeout(600);
  await p.evaluate(() => editEmpreendimento('d1')); await p.waitForTimeout(700);
  checa('empreendimento: UF carregada', (await p.inputValue('#empr-f-estado')) === 'SP');
  checa('empreendimento: cidade carregada', (await p.inputValue('#empr-f-cidade')) === 'Campinas');
  await p.selectOption('#empr-f-estado','MG'); await p.waitForTimeout(500);
  checa('trocar UF recarrega cidades', (await p.locator('#empr-f-cidade option').allTextContents()).includes('Uberlândia'));

  await p.evaluate(() => openCfgView('convenios')); await p.waitForTimeout(500);
  await p.evaluate(() => openSimples('convenio', null)); await p.waitForTimeout(300);
  checa('modal convênio abre sem campo número', await p.locator('#modal-simples-bg').isVisible()
        && !(await p.locator('#simples-numero-wrap').isVisible()));
  await p.evaluate(() => closeModal('modal-simples-bg'));
  await p.evaluate(() => { openCfgView('agencias'); }); await p.waitForTimeout(500);
  await p.evaluate(() => openSimples('agencia', null)); await p.waitForTimeout(300);
  checa('modal agência tem campo número', await p.locator('#simples-numero-wrap').isVisible());
  await p.evaluate(() => closeModal('modal-simples-bg'));

  await p.evaluate(() => openCfgView('coordenadores')); await p.waitForTimeout(500);
  await p.evaluate(() => openCoordenador(null)); await p.waitForTimeout(400);
  checa('modal coordenador lista corretores', (await p.locator('#coord-corretores input').count()) >= 1);
  await p.evaluate(() => closeModal('modal-coordenador-bg'));

  const xss = await p.evaluate(() => window.__XSS||0);
  checa('nenhum XSS executou', xss === 0, `(__XSS=${xss})`);
  const n = resumo(erros); await b.close(); process.exit(n?1:0);
})();
