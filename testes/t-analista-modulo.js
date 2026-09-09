// O cadastro de Analista de Crédito depende de módulo.
//
// Analista existe para analisar processo. Sem Repasse e sem Pré-análise não há
// processo nenhum, e o cartão vira uma porta para um cadastro que não serve
// para nada naquele cliente — o gestor cadastra gente que nunca vai ver tela.
//
// A prova que importa é a NEGATIVA, e ela precisa dos DOIS módulos ausentes:
// com um só faltando o cartão continua, e um teste que negasse só um passaria
// sem provar coisa alguma.
//
// A outra metade é igualmente importante: "não consegui perguntar" não pode
// virar "não tem". a1HasModule devolve null quando o servidor não responde, e
// nesse caso o cartão TEM de continuar — cliente sem cadastro de analista por
// causa de rede ruim seria pior que o problema original.
const { abrir, checa, resumo } = require('./comum');

(async () => {
  const todosErros = [];

  // ── Com Repasse (a situação de todo cliente de hoje) ─────────────────────
  {
    const { b, p, erros } = await abrir('configuracoes.html');
    console.log('\n== COM REPASSE, O CARTÃO CONTINUA ==');
    checa('o cartão de Analistas de Crédito está no hub',
          await p.locator('#cfg-card-analistas').count() === 1);
    await p.evaluate(() => openCfgView('analistas'));
    await p.waitForTimeout(600);
    checa('e a sub-tela abre', await p.locator('#cfg-view-analistas').isVisible());
    todosErros.push(...erros);
    await b.close();
  }

  // ── Só Pré-análise, sem Repasse ──────────────────────────────────────────
  {
    const { b, p, erros } = await abrir('configuracoes.html',
      { modulos:['PRE_ANALISE'], semModulos:['repasse'] });
    console.log('\n== SÓ COM PRÉ-ANÁLISE, O CARTÃO CONTINUA ==');
    checa('um módulo dos dois já basta',
          await p.locator('#cfg-card-analistas').count() === 1);
    todosErros.push(...erros);
    await b.close();
  }

  // ── Sem nenhum dos dois ──────────────────────────────────────────────────
  {
    const { b, p, erros } = await abrir('configuracoes.html', { semModulos:['repasse'] });
    console.log('\n== SEM REPASSE E SEM PRÉ-ANÁLISE, O CARTÃO SAI DO DOM ==');
    checa('o cartão não existe mais',
          await p.locator('#cfg-card-analistas').count() === 0);
    // O que não está no DOM a busca do hub também não acha.
    await p.fill('#cfg-busca', 'analista');
    await p.waitForTimeout(300);
    const achou = await p.$$eval('.cfg-hub-card',
      els => els.filter(e => !e.classList.contains('oculto') && e.offsetParent !== null)
                .map(e => e.textContent.trim()));
    checa('a busca do hub não oferece o cadastro',
          !achou.some(t => /Analista/i.test(t)), achou.join(' | '));

    // E o link direto também não passa.
    await p.evaluate(() => openCfgView('analistas'));
    await p.waitForTimeout(400);
    const abriu = await p.locator('#cfg-view-analistas').isVisible();
    checa('e abrir a sub-tela por código não abre nada', abriu === false);

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros));
})();
