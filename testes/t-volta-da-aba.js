// Voltar para a aba do navegador não pode desfazer o que a pessoa escolheu.
//
// O relato (THE CRED, 27/10): em Repasse › Listagem a operadora escolhia uma
// etapa, ia para outra aba do navegador e, ao voltar, a página "atualizava":
// a etapa voltava para "Todas" e ela tinha de recomeçar.
//
// A causa: na volta para a aba, as telas buscam os dados de novo (de propósito,
// para pegar o que mudou em outra aba) e, no caminho, reconstroem os <select>
// de filtro com innerHTML, o que apaga a escolha. O mesmo valia para o salvar
// de um processo, e para Registro, que remontava a etapa da lista com ''.
//
// A volta para a aba é simulada no próprio documento: o Playwright não esconde
// uma aba sozinha, mas o que a tela escuta é só o evento e o visibilityState.
const { abrir, checa, resumo } = require('./comum');

async function sairEVoltar(p, mudarDado) {
  await p.evaluate(mudar => {
    // Para provar também o caminho que redesenha: um processo "mudou" lá fora.
    if (mudar && G.cases[0]) G.__mudar = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    if (G.__mudar) {
      const carga = window.loadData;
      window.loadData = async () => {
        await carga();
        if (G.cases[0]) G.cases[0].updated_at = 'mudou-' + Date.now();
      };
    }
    document.dispatchEvent(new Event('visibilitychange'));
  }, mudarDado);
  await p.waitForTimeout(900);
}

(async () => {
  const todosErros = [];

  // ── Repasse: Listagem e Andamento ────────────────────────────────────────
  for (const pag of ['listagem.html', 'andamento.html']) {
    for (const mudar of [false, true]) {
      console.log(`\n${pag} (${mudar ? 'com dado novo, redesenha' : 'sem mudança'})`);
      const { b, p, erros } = await abrir(pag, { filtros: false });
      if (pag === 'andamento.html') await p.evaluate(() => switchView('listagem'));
      const escolha = await p.evaluate(() => {
        const s = document.getElementById('tbl-stage-filter');
        // Escolhe a etapa que tem processo: filtrar por etapa vazia não prova nada.
        const comCaso = new Set(G.cases.map(c => c.stage_id));
        const op = [...s.options].find(o => o.value && comCaso.has(o.value));
        s.value = op.value;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          valor: op.value,
          linhas: document.querySelectorAll('#cases-tbody tr').length,
          total: G.cases.length
        };
      });
      checa(
        'a etapa escolhida filtra a lista',
        escolha.linhas > 0 && escolha.linhas < escolha.total,
        `(${escolha.linhas} de ${escolha.total})`
      );
      await sairEVoltar(p, mudar);
      const depois = await p.evaluate(() => ({
        valor: document.getElementById('tbl-stage-filter').value,
        linhas: document.querySelectorAll('#cases-tbody tr').length
      }));
      checa(
        'depois de voltar para a aba, a etapa continua escolhida',
        depois.valor === escolha.valor,
        `(ficou "${depois.valor}")`
      );
      checa(
        'e a lista continua filtrada por ela',
        depois.linhas === escolha.linhas,
        `(${depois.linhas} linhas)`
      );
      checa('nenhum XSS disparou', (await p.evaluate(() => window.__XSS)) === 0);
      todosErros.push(...erros.map(e => pag + ': ' + e));
      await b.close();
    }
  }

  // ── Repasse: Dashboard, filtro do painel ─────────────────────────────────
  {
    console.log('\nrepasse.html (filtro do dashboard)');
    const { b, p, erros } = await abrir('repasse.html');
    const valor = await p.evaluate(() => {
      const s = document.getElementById('df-empr');
      const op = [...s.options].find(o => o.value);
      s.value = op.value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return op.value;
    });
    await sairEVoltar(p, true);
    checa(
      'o empreendimento do filtro do dashboard continua escolhido',
      (await p.evaluate(() => document.getElementById('df-empr').value)) === valor
    );
    todosErros.push(...erros.map(e => 'repasse.html: ' + e));
    await b.close();
  }

  // ── Andamento: o quadro não volta para o começo ──────────────────────────
  {
    console.log('\nandamento.html (rolagem do quadro)');
    const { b, p, erros } = await abrir('andamento.html', { filtros: false });
    await p.setViewportSize({ width: 700, height: 900 });
    const antes = await p.evaluate(() => {
      const q = document.getElementById('kanban-board');
      q.scrollLeft = 260;
      return q.scrollLeft;
    });
    checa('o quadro rola na horizontal (senão a prova é vazia)', antes > 0);
    await sairEVoltar(p, true);
    const depois = await p.evaluate(() => document.getElementById('kanban-board').scrollLeft);
    checa(
      'depois de voltar para a aba, o quadro está no mesmo lugar',
      depois === antes,
      `(${depois} vs ${antes})`
    );
    todosErros.push(...erros.map(e => 'andamento.html: ' + e));
    await b.close();
  }

  // ── Registro ─────────────────────────────────────────────────────────────
  // A etapa da lista do Registro só ganha opções quando o painel é desenhado
  // (renderDashboard), então a prova desenha o painel primeiro, como quando a
  // pessoa passa por ele, e depois remonta tudo como numa nova carga.
  for (const pag of ['registro.html', 'registro-listagem.html']) {
    console.log('\n' + pag);
    const { b, p, erros } = await abrir(pag, { filtros: false });
    const valor = await p.evaluate(() => {
      renderDashboard();
      const s = document.getElementById('rg-list-stage');
      const op = [...s.options].find(o => o.value);
      if (!op) return null;
      s.value = op.value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return op.value;
    });
    checa('há etapa para escolher no Registro', !!valor);
    await sairEVoltar(p, true);
    checa(
      'depois de voltar para a aba, a etapa do Registro continua escolhida',
      (await p.evaluate(() => document.getElementById('rg-list-stage').value)) === valor
    );
    await p.evaluate(() => renderDashboard());
    checa(
      'e continua depois de o painel remontar as opções',
      (await p.evaluate(() => document.getElementById('rg-list-stage').value)) === valor
    );
    todosErros.push(...erros.map(e => pag + ': ' + e));
    await b.close();
  }

  process.exit(resumo(todosErros) ? 1 : 0);
})();
