// Uma tela por módulo, o endereço decide a vista.
//
// Fase 2 da reestruturação: Dashboard, Andamento e Listagem do Repasse eram três
// arquivos 96% iguais; Quadro e Listagem do Registro, dois. Viraram uma tela
// cada, e quem decide o que aparece é a rota. Este teste confere:
//
//   1. cada endereço (o bonito, /cliente/x, e o antigo, /x.html) abre a vista
//      certa, com o título e o item da sub-barra certos;
//   2. o que era exclusivo de uma cópia continua onde deve: a seleção em lote e
//      o relatório em planilha são da Listagem; o seletor de painel é do
//      Dashboard;
//   3. as correções que existiam só numa cópia valem para todas as vistas. A
//      prova principal é a do Registro: criar processo PELA LISTAGEM perdia o
//      telefone e os vínculos, porque a cópia da Listagem tinha ficado para trás.
const { abrir, checa, resumo } = require('./comum');

const visivel = (p, id) =>
  p.evaluate(i => {
    const e = document.getElementById(i);
    return !!e && e.getClientRects().length > 0;
  }, id);
const subAtivo = p =>
  p.evaluate(() => (document.querySelector('.sb-sub-item.ativo') || {}).textContent || '');

(async () => {
  const todosErros = [];

  console.log('== REPASSE: cada endereço abre a sua vista ==');
  for (const [rota, vista] of [
    ['thecred/repasse', 'dashboard'],
    ['thecred/andamento', 'andamento'],
    ['thecred/listagem', 'listagem'],
    ['andamento.html', 'andamento'],
    ['listagem.html', 'listagem']
  ]) {
    const { b, p, erros } = await abrir(rota, { filtros: false });
    const estado = {
      dash: await visivel(p, 'tab-dashboard'),
      quadro: await visivel(p, 'view-andamento'),
      lista: await visivel(p, 'view-listagem'),
      // O botão mora na barra de filtros, que nasce recolhida (como na Listagem
      // de antes): o que se confere é o estado dele, não o da barra.
      exportar: await p.evaluate(() => {
        const e = document.getElementById('btn-exportar');
        return !!e && getComputedStyle(e).display !== 'none';
      }),
      titulo: await p.title(),
      sub: (await subAtivo(p)).trim()
    };
    const esperado = {
      dashboard: { dash: true, quadro: false, lista: false, titulo: /^Repasse/, sub: /Dashboard/ },
      andamento: { dash: false, quadro: true, lista: false, titulo: /^Andamento/, sub: /Andamento/ },
      listagem: { dash: false, quadro: false, lista: true, titulo: /^Listagem/, sub: /Listagem/ }
    }[vista];
    checa(
      `/${rota} mostra só a vista ${vista}`,
      estado.dash === esperado.dash && estado.quadro === esperado.quadro && estado.lista === esperado.lista,
      JSON.stringify(estado)
    );
    checa(`/${rota} tem o título certo`, esperado.titulo.test(estado.titulo), estado.titulo);
    checa(`/${rota} marca o item certo na sub-barra`, esperado.sub.test(estado.sub), estado.sub);
    checa(
      `/${rota}: o relatório em planilha só aparece na Listagem`,
      estado.exportar === (vista === 'listagem'),
      String(estado.exportar)
    );
    if (vista === 'listagem') {
      checa(
        'a Listagem tem a seleção em lote (caixa de marcar em cada linha)',
        (await p.locator('#cases-tbody .row-chk').count()) > 0
      );
    }
    if (vista === 'dashboard') {
      checa(
        'o Dashboard tem o seletor de painel (escondido quando há um módulo só)',
        (await p.locator('#seletor-painel').count()) === 1
      );
    }
    checa(`/${rota}: nenhum XSS disparou`, (await p.evaluate(() => window.__XSS)) === 0);
    todosErros.push(...erros.map(e => rota + ': ' + e));
    await b.close();
  }

  console.log('\n== REGISTRO: cada endereço abre a sua vista ==');
  for (const [rota, vista] of [
    ['thecred/registro', 'kanban'],
    ['thecred/registro-listagem', 'lista'],
    ['registro-listagem.html', 'lista']
  ]) {
    const { b, p, erros } = await abrir(rota, { filtros: false });
    const estado = {
      dash: await visivel(p, 'tab-dashboard'),
      quadro: await visivel(p, 'tab-kanban'),
      lista: await visivel(p, 'tab-lista'),
      titulo: await p.title()
    };
    checa(
      `/${rota} mostra só a vista ${vista}`,
      !estado.dash && estado.quadro === (vista === 'kanban') && estado.lista === (vista === 'lista'),
      JSON.stringify(estado)
    );
    checa(
      `/${rota} tem o título certo`,
      vista === 'lista' ? /Listagem/.test(estado.titulo) : !/Listagem/.test(estado.titulo),
      estado.titulo
    );
    todosErros.push(...erros.map(e => rota + ': ' + e));
    await b.close();
  }

  console.log('\n== REGISTRO: criar pela Listagem não perde telefone nem vínculo ==');
  {
    const { b, p, erros } = await abrir('thecred/registro-listagem', { filtros: false });
    await p.evaluate(() => openNewModal());
    await p.waitForTimeout(200);
    checa('o formulário da Listagem tem os campos de vínculo', (await p.locator('#n-empresa').count()) === 1);
    await p.fill('#n-name', 'Cliente Teste');
    await p.fill('#n-phone', '(98) 99999-0000');
    await p.evaluate(() => {
      const s = document.getElementById('n-stage');
      const op = [...s.options].find(o => o.value);
      if (op) s.value = op.value;
      const e = document.getElementById('n-empresa');
      const oe = e && [...e.options].find(o => o.value);
      if (oe) e.value = oe.value;
    });
    await p.evaluate(() => createCase());
    await p.waitForTimeout(500);
    const post = await p.evaluate(() =>
      (window.__POSTS || []).find(x => /a1_cases/.test(x.url) && x.m === 'POST')
    );
    const corpo = post ? JSON.parse(post.body) : {};
    checa('o processo é criado', !!post);
    checa(
      'com o telefone digitado',
      corpo.client_phone === '(98) 99999-0000',
      JSON.stringify(corpo.client_phone)
    );
    checa('e com a empresa vinculada', !!corpo.empresa_id, JSON.stringify(corpo.empresa_id));
    todosErros.push(...erros.map(e => 'registro-listagem: ' + e));
    await b.close();
  }

  process.exit(resumo(todosErros) ? 1 : 0);
})();
