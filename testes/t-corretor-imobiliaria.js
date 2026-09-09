// A imobiliária do corretor.
//
// O vínculo sempre existiu no banco: o pré-cadastro por link grava
// extra.imobiliaria_id desde que existe. O que não existia era o gestor
// conseguir VER e MUDAR isso — e, por consequência, o seletor de corretor dos
// formulários de processo listava a agência inteira, imobiliária nenhuma.
//
// Cenário na base falsa, montado para que o teste FALHE se o filtro sumir:
//   Imob Alfa (p1)              → Carla Dias
//   Imob Recem Cadastrada (p20) → Diego Melo
//   sem imobiliária             → Ana Souza, Sem Equipe, Clara Perfil
// Com uma imobiliária só, qualquer filtro devolveria tudo e passaria à toa.
const { abrir, checa, resumo } = require('./comum');

const opcoes = async (p, sel) =>
  (await p.locator(sel + ' option').allTextContents()).filter(x => !/Selecione|—/.test(x));

// O nome da Imob Alfa na base falsa carrega a carga de XSS (aspa e atributo),
// então casar por rótulo literal é frágil. Escolhe pelo começo do nome.
async function escolherImob(p, prefixo){
  const valor = await p.$eval('#n-re', (el, pre) => {
    const o = [...el.options].find(x => x.value.startsWith(pre));
    return o ? o.value : '';
  }, prefixo);
  await p.selectOption('#n-re', valor);
  await p.waitForTimeout(400);
  return valor;
}

(async () => {
  const todosErros = [];

  // ── Cadastro: o campo existe, vem preenchido e é gravado ─────────────────
  {
    const { b, p, erros } = await abrir('configuracoes.html');
    console.log('\n== CADASTRO DE CORRETOR ==');
    await p.evaluate(() => openCfgView('corretores'));
    await p.waitForTimeout(800);

    const cab = await p.$$eval('#cfg-view-corretores thead th', els => els.map(e => e.textContent.trim()));
    checa('a lista ganhou a coluna Imobiliária', cab.includes('Imobiliária'), cab.join(' | '));
    const linhas = await p.$eval('#corretor-tbody', e => e.textContent);
    checa('e a linha da Carla mostra a imobiliária dela', /Imob Alfa/.test(linhas));

    await p.evaluate(() => openCorretor('p10'));       // Carla Dias
    await p.waitForTimeout(600);
    checa('o formulário tem o seletor de imobiliária', await p.locator('#co-imob').count() === 1);
    checa('já vem com a imobiliária do cadastro', (await p.inputValue('#co-imob')) === 'p1',
          'valor=' + (await p.inputValue('#co-imob')));

    await p.selectOption('#co-imob', 'p20');
    await p.evaluate(() => { window.__POSTS = []; });
    await p.evaluate(() => saveCorretor());
    await p.waitForTimeout(700);
    const corpo = await p.evaluate(() => {
      const x = (window.__POSTS || []).find(y => /a1_partners/.test(y.url) && y.m === 'PATCH');
      return x ? JSON.parse(x.body) : null;
    });
    checa('salvar grava extra.imobiliaria_id', corpo && corpo.extra && corpo.extra.imobiliaria_id === 'p20',
          JSON.stringify(corpo && corpo.extra));
    checa('e não perde o coordenador que já estava lá',
          corpo && corpo.extra && corpo.extra.coordenador_id === 'p7', JSON.stringify(corpo && corpo.extra));

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  // ── Formulário de processo: escolher a imobiliária filtra o corretor ─────
  {
    const { b, p, erros } = await abrir('repasse.html');
    console.log('\n== NOVO PROCESSO: A IMOBILIÁRIA FILTRA O CORRETOR ==');
    await p.evaluate(() => openNewCase());
    await p.waitForTimeout(1000);

    const todos = await opcoes(p, '#n-broker');
    checa('sem imobiliária escolhida, lista todos', todos.includes('Carla Dias') && todos.includes('Diego Melo'),
          todos.join('|'));

    await escolherImob(p, 'Imob Recem Cadastrada');
    const daImob = await opcoes(p, '#n-broker');
    checa('escolher a imobiliária traz o corretor dela', daImob.includes('Diego Melo'), daImob.join('|'));
    checa('e tira o corretor da outra imobiliária', !daImob.includes('Carla Dias'), daImob.join('|'));
    checa('corretor sem vínculo continua disponível', daImob.includes('Sem Equipe'), daImob.join('|'));

    // O caminho inverso: escolher o corretor preenche a imobiliária dele.
    await p.selectOption('#n-broker', 'Sem Equipe');
    await p.waitForTimeout(300);
    await escolherImob(p, 'Imob Alfa');
    const daAlfa = await opcoes(p, '#n-broker');
    checa('trocar de imobiliária troca a lista', daAlfa.includes('Carla Dias') && !daAlfa.includes('Diego Melo'),
          daAlfa.join('|'));

    await p.selectOption('#n-broker', 'Carla Dias');
    await p.waitForTimeout(400);
    checa('escolher o corretor mantém a imobiliária dele',
          /Imob Alfa/.test(await p.inputValue('#n-re')), await p.inputValue('#n-re'));

    // Corretor de OUTRA imobiliária, escolhido primeiro, corrige o seletor —
    // senão o processo nasceria com o par errado.
    await p.evaluate(() => { const s = document.getElementById('n-broker');
      if (![...s.options].some(o => o.value === 'Diego Melo')) s.add(new Option('Diego Melo','Diego Melo')); });
    await p.selectOption('#n-broker', 'Diego Melo');
    await p.waitForTimeout(400);
    checa('corretor de outra imobiliária arruma o campo',
          (await p.inputValue('#n-re')) === 'Imob Recem Cadastrada', await p.inputValue('#n-re'));

    // A imobiliária não substitui o coordenador: os dois filtros valem juntos.
    await escolherImob(p, 'Imob Alfa');
    await p.selectOption('#n-coordenador', 'Marcos Lima');
    await p.waitForTimeout(400);
    const dois = await opcoes(p, '#n-broker');
    checa('imobiliária e coordenador filtram juntos',
          dois.includes('Carla Dias') && !dois.includes('Diego Melo') && !dois.includes('Sem Equipe'),
          dois.join('|'));

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros));
})();
