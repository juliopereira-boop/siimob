// Tipos de documento em Configurações.
//
// Três coisas, e as três vieram de pedido do dono:
//
// 1. A ORDEM das abas é a ordem do processo — Pré-análise → Comercial →
//    Repasse — em todo lugar do sistema em que os módulos aparecem juntos.
//    Aqui o Comercial não entra: ele guarda contrato, não documento tipado.
// 2. A LISTA PADRÃO deixou de ser invisível. Ela sempre existiu dentro da tela
//    de Pré-análise: cliente que não configurou nada via uma lista útil em vez
//    de um seletor vazio. O problema é que ela sumia no instante em que ele
//    cadastrava o primeiro tipo próprio, e não havia como trazê-la de volta.
// 3. A aba de cada módulo continua atrás da LICENÇA. Sem ela a aba não existe —
//    e a verificação negativa é a que importa, porque é a situação de quase
//    todo cliente.
const { abrir, checa, resumo } = require('./comum');

const idsAbas = p => p.$$eval('#cfg-view-doctypes .dt-mod-btn',
  els => els.map(e => e.id || 'sem-id'));

(async () => {
  const todosErros = [];

  // ── Sem licença dos módulos novos: só Repasse e Registro ─────────────────
  {
    const { b, p, erros } = await abrir('configuracoes.html');
    console.log('\n== SEM LICENÇA, AS ABAS DOS MÓDULOS NOVOS NÃO APARECEM ==');
    await p.evaluate(() => openCfgView('doctypes'));
    await p.waitForTimeout(500);

    const visiveis = await p.$$eval('#cfg-view-doctypes .dt-mod-btn',
      els => els.filter(e => e.offsetParent !== null).map(e => e.id || 'sem-id'));
    checa('a aba de Pré-análise não aparece', !visiveis.includes('dt-mod-PRE_ANALISE'), visiveis.join(','));
    checa('a de Repasse continua ali',         visiveis.includes('dt-mod-repasse'), visiveis.join(','));

    // Repasse não tem lista padrão de fábrica — e botão que não faz nada é pior
    // que botão ausente.
    const botao = await p.$eval('#dt-padrao-wrap', e => e.offsetParent !== null).catch(() => null);
    checa('sem lista padrão para Repasse, o botão não aparece', botao === false, String(botao));

    todosErros.push(...erros);
    await b.close();
  }

  // ── Com as duas licenças: ordem completa e lista padrão da Pré-análise ────
  {
    const { b, p, erros } = await abrir('configuracoes.html', { modulos:['PRE_ANALISE','COMERCIAL'] });
    console.log('\n== COM LICENÇA: A ORDEM DO PROCESSO, E A LISTA PADRÃO ==');
    await p.evaluate(() => openCfgView('doctypes'));
    await p.waitForTimeout(500);

    const ordem = await idsAbas(p);
    checa('Pré-análise vem antes de Repasse',
      ordem.indexOf('dt-mod-PRE_ANALISE') < ordem.indexOf('dt-mod-repasse'), ordem.join(' > '));
    checa('e Registro fica depois do Repasse',
      ordem.indexOf('dt-mod-repasse') < ordem.indexOf('dt-mod-registro'), ordem.join(' > '));
    // O Comercial guarda contrato, não documento tipado: aba dele aqui seria
    // uma tela de cadastro que nenhuma outra tela lê.
    checa('o Comercial não tem aba de tipos de documento',
      !ordem.includes('dt-mod-COMERCIAL'), ordem.join(' > '));

    // A base falsa tem doc_types sem nenhum tipo de Pré-análise: é o cliente
    // que acabou de ganhar a licença.
    await p.evaluate(() => switchDocTypeModule('PRE_ANALISE',
      document.getElementById('dt-mod-PRE_ANALISE')));
    await p.waitForTimeout(300);

    const visivel = await p.$eval('#dt-padrao-wrap', e => e.offsetParent !== null);
    checa('na Pré-análise o botão da lista padrão aparece', visivel === true);
    const dica = await p.$eval('#dt-padrao-hint', e => e.textContent);
    checa('e a dica nomeia os documentos sugeridos', /RG \/ CNH/.test(dica) && /Extrato FGTS/.test(dica), dica);

    // Adotar a lista: o que vai para o banco tem de ser o conteúdo, não a
    // contagem — nome errado com quantidade certa passaria por uma contagem.
    await p.evaluate(() => usarDocTypesPadrao());
    await p.waitForTimeout(500);

    const gravado = await p.evaluate(() => {
      const posts = (window.__POSTS || []).filter(x => /a1_config/.test(x.url));
      if (!posts.length) return null;
      try { return JSON.parse(JSON.parse(posts[posts.length-1].body).value); } catch { return null; }
    });
    const daPA = (gravado || []).filter(t => t && t.module === 'PRE_ANALISE').map(t => t.name);
    checa('gravou os tipos da lista padrão em a1_config', daPA.length > 0, String(daPA.length));
    checa('e o RG / CNH está entre eles', daPA.includes('RG / CNH'), daPA.join(', '));
    checa('e o Comprovante de renda também', daPA.includes('Comprovante de renda'), daPA.join(', '));
    checa('sem inventar tipo para outro módulo',
      (gravado || []).filter(t => t && t.module && t.module !== 'PRE_ANALISE').length === 0);
    // Ids repetidos apagariam um tipo ao apagar o outro.
    const ids = daPA.length ? (gravado||[]).filter(t=>t.module==='PRE_ANALISE').map(t=>t.id) : [];
    checa('cada tipo nasceu com id próprio', new Set(ids).size === ids.length, ids.join(','));

    // Adotada a lista, o botão não tem mais o que acrescentar.
    const aindaVisivel = await p.$eval('#dt-padrao-wrap', e => e.offsetParent !== null);
    checa('com a lista já adotada, o botão sai de cena', aindaVisivel === false);

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros));
})();
