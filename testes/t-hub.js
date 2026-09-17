const { abrir, checa, resumo } = require('./comum');
(async () => {
  const { b, p, erros } = await abrir('configuracoes.html');
  console.log('== HUB ORGANIZADO ==');
  const grupos = await p.evaluate(() => [...document.querySelectorAll('#cfg-hub .cfg-grupo')].map(g => ({
    titulo: g.querySelector('.cfg-section-hdr').textContent.trim(),
    sub: g.querySelector('.cfg-section-sub')?.textContent.trim() || '',
    cards: [...g.querySelectorAll('.cfg-hub-card .cfg-card-label')].map(c=>c.textContent.trim()),
    visivel: g.style.display !== 'none'
  })));
  grupos.forEach(g => { console.log(`\n  [${g.titulo}] ${g.sub}`); g.cards.forEach(c=>console.log('     · '+c)); });
  // 5 de sempre + "Regras gerais" (as configurações-mãe do cliente) + "Área de
  // risco", o grupo da Exclusão definitiva. Este último é montado por JS e só
  // existe para gestor — por isso não está no HTML.
  // Só os VISÍVEIS: o grupo Leads existe no HTML mas nasce escondido, e só
  // aparece quando cfgModsLiberar('crm') confirma a licença. Contar os ocultos
  // faria o teste acusar um grupo que o gestor não vê.
  const visiveis = grupos.filter(g => g.visivel);
  checa('7 grupos sem a licença de Leads', visiveis.length === 7, 'n='+visiveis.length
    + ' · ' + JSON.stringify(grupos.map(g=>g.titulo)));
  // Regras gerais vem PRIMEIRO, e isso é decisão de leitura: o que está lá vale
  // acima de qualquer permissão dos cadastros que vêm depois. Se um grupo novo
  // furar a fila, esta linha avisa.
  checa('e "Regras gerais" abre o hub', visiveis[0].titulo === 'Regras gerais', visiveis[0].titulo);
  checa('todo grupo tem explicação', visiveis.every(g=>g.sub.length > 10));
  // Aqui havia uma CONTAGEM ("23 cards no total"), e ela apodreceu exatamente
  // como a skill avisa: entrou o cartão do Checklist operacional — decisão
  // legítima, com sub-tela e tudo — e o número passou a acusar um defeito que
  // não existia, enquanto NÃO diria qual cartão mudou.
  //
  // A lista abaixo diz QUAIS cartões o hub tem. Ela protege a mesma coisa que
  // a contagem protegia (cartão que some sem ninguém notar, cartão que aparece
  // sem dono) e, quando muda, a falha mostra o nome — quem lê decide se foi
  // decisão ou descuido. Cartão de módulo licenciado não entra: sem licença ele
  // nem chega ao DOM, e é t-config-modulos.js que vigia isso.
  const CARTOES = [
    // Regras gerais
    'Configurações Gerais',
    // Workflow e etapas
    'Editor de Workflow', 'Flags de Etapa', 'Tipos de documento',
    'Checklist operacional', 'Configuração de Comissão',
    // Usuários e acesso
    'Perfis de acesso', 'Usuários Gestores', 'Analistas de Crédito', 'Corretores',
    'Validação de corretores', 'Coordenadores', 'Correspondentes / CCA',
    // Empreendimentos e parceiros
    'Empreendimentos', 'Regionais', 'Imobiliárias', 'Despachantes',
    // Cadastros do repasse
    'Convênios', 'Modalidades de Imóvel', 'Agências', 'Bancos', 'Cartórios',
    // Ferramentas e suporte
    'Importar base', 'Sugerir melhoria',
    // Área de risco
    'Exclusão definitiva',
  ];
  const naTela  = grupos.flatMap(g => g.cards);
  const faltam  = CARTOES.filter(c => !naTela.includes(c));
  const sobram  = naTela.filter(c => !CARTOES.includes(c));
  checa('o hub tem exatamente os cartões previstos', !faltam.length && !sobram.length,
        `faltam: ${faltam.join(', ') || '—'} | sobram: ${sobram.join(', ') || '—'}`);
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
  checa('limpar devolve tudo',
    (await p.locator('#cfg-hub .cfg-hub-card:not(.oculto)').count()) === naTela.length,
    'esperado=' + naTela.length);

  console.log('\n== AS TELAS CONTINUAM ABRINDO ==');
  // 'checklist' entrou junto com o cartão dele: cartão que o hub mostra e que
  // não abre é a pior versão da caixa decorativa — a que o gestor clica.
  const VIEWS = ['wf','flags','regionais','empreendimentos','imobiliarias','doctypes','checklist','comissao','analistas',
                 'corretores','precad','gestores','convenios','modalidades','coordenadores','agencias',
                 'correspondentes','despachantes','bancos','cartorios'];
  let ruins = [];
  for (const v of VIEWS) {
    await p.evaluate(x => openCfgView(x), v); await p.waitForTimeout(200);
    if (!(await p.locator(`#cfg-view-${v}`).isVisible())) ruins.push(v);
  }
  checa(`as ${VIEWS.length} telas abrem`, ruins.length === 0, ruins.join(','));
  await p.evaluate(() => closeCfgView()); await p.waitForTimeout(200);
  checa('voltar mostra o hub', await p.locator('#cfg-hub').isVisible());
  checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
  const n = resumo(erros); await b.close(); process.exit(n?1:0);
})();
