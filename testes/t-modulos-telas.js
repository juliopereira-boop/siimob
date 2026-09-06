// Telas dos módulos novos: Pré-análise e Comercial.
//
// A primeira seção é a mesma de sempre e a mais importante: com a licença
// ausente — que é a situação de todo cliente hoje — as telas não abrem, as
// abas não aparecem e as tabelas não são consultadas.
const { abrir, checa, resumo } = require('./comum');

(async () => {
  const todosErros = [];

  console.log('== SEM LICENÇA, NÃO EXISTE ==');
  {
    // Sem módulo, a1RequireModule manda o usuário para a home do cliente.
    const { b, p } = await abrir('pre-analise.html');
    checa('sem licença, a Pré-análise não fica de pé',
      !/\/pre-analise/.test(p.url()), p.url());
    await b.close();
  }
  {
    const { b, p } = await abrir('comercial.html');
    checa('sem licença, o Comercial não fica de pé',
      !/\/comercial/.test(p.url()), p.url());
    await b.close();
  }
  {
    const { b, p, erros } = await abrir('repasse.html');
    checa('a aba Pré-análise não aparece no sistema do cliente',
      !(await p.locator('#link-pre-analise').isVisible()));
    checa('nem a aba Comercial',
      !(await p.locator('#link-comercial').isVisible()));
    checa('e nenhuma tabela dos módulos novos é consultada',
      await p.evaluate(() => !performance.getEntriesByType('resource')
        .some(r => /a1_pre_analises|a1_comerciais|a1_pa_|a1_co_/.test(r.name))));
    checa('o Repasse segue funcionando', (await p.locator('#kpi-total').textContent()).trim() !== '');
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }
  {
    const { b, p, erros } = await abrir('configuracoes.html');
    checa('Configurações abre e não mostra as abas novas',
      !(await p.locator('#link-pre-analise').isVisible())
      && !(await p.locator('#link-comercial').isVisible()));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }
  {
    const { b, p } = await abrir('repasse.html', { modulos:['PRE_ANALISE','COMERCIAL'] });
    checa('com a licença liberada, as duas abas aparecem',
      (await p.locator('#link-pre-analise').isVisible())
      && (await p.locator('#link-comercial').isVisible()));
    checa('e apontam para o endereço do cliente',
      (await p.locator('#link-pre-analise').getAttribute('href')) === '/thecred/pre-analise');
    await b.close();
  }

  console.log('\n== O CABEÇALHO É O MESMO DO RESTO DO SISTEMA ==');
  {
    // O dono reclamou de "ficar esquisito" ao entrar nas telas novas: elas
    // desenhavam um cabeçalho próprio. Agora vem do shell, e a barra tem de
    // trazer as mesmas abas de qualquer outra tela do produto.
    const { b, p, erros } = await abrir('pre-analise.html', { modulos:['PRE_ANALISE'] });
    const abas = await p.evaluate(() =>
      Array.from(document.querySelectorAll('#shell .tabs-bar .tab-btn'))
        .map(a => a.textContent.replace(/[▾\s]+/g, ' ').trim()));
    checa('a barra traz Dashboard, Repasse e Pré-análise, como no resto do sistema',
      abas.includes('Dashboard') && abas.includes('Repasse') && abas.includes('Pré-análise'),
      JSON.stringify(abas));
    checa('a aba da Pré-análise está marcada como a atual',
      await p.evaluate(() => {
        const a = Array.from(document.querySelectorAll('#shell .tab-btn'))
          .find(x => /Pré-análise/.test(x.textContent));
        return !!a && a.classList.contains('active');
      }));

    // Fila/Esteira/Painel saíram: quem escolhe a vista é o menu do shell.
    const itens = await p.evaluate(() => {
      const g = Array.from(document.querySelectorAll('#shell .tab-group'))
        .find(x => /Pré-análise/.test(x.querySelector('.tab-btn').textContent));
      return g ? Array.from(g.querySelectorAll('.dd-item')).map(i => i.textContent.trim()) : [];
    });
    checa('e o menu da Pré-análise oferece exatamente Andamento e Listagem',
      itens.length === 2 && itens[0] === 'Andamento' && itens[1] === 'Listagem',
      JSON.stringify(itens));
    checa('a tela não desenha mais um cabeçalho próprio',
      await p.evaluate(() => document.querySelectorAll('.hdr').length === 1
                          && document.querySelectorAll('.tabs-bar').length === 1));
    checa('e o botão de criar continua à mão, agora como ação do cabeçalho',
      (await p.locator('#shell #btn-nova').count()) === 1);
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== ANDAMENTO DA PRÉ-ANÁLISE ==');
  {
    // Sem ?vista, a tela abre no Andamento — o quadro por situação.
    const { b, p, erros } = await abrir('pre-analise.html', { modulos:['PRE_ANALISE'] });
    checa('a tela abre', /Pré-análise/i.test(await p.title()));
    checa('e continua se apresentando como Pré-análise',
      /Pré-análise/.test(await p.locator('.pg-titulo').textContent()));
    checa('o andamento mostra uma coluna por situação',
      (await p.locator('.k-col').count()) === 4);
    checa('e distribui os processos pelas colunas',
      (await p.locator('.pa-card').count()) === 4);
    checa('a listagem fica escondida', !(await p.locator('#vista-listagem').isVisible()));

    // Os filtros são os mesmos nas duas vistas — aqui eles têm de mexer no quadro.
    await p.click('#sla-ex'); await p.waitForTimeout(250);
    checa('filtrar por prazo estourado também filtra o quadro',
      (await p.locator('.pa-card').count()) === 1);
    await p.click('#sla-todos'); await p.waitForTimeout(250);
    await p.fill('#f-busca', 'Maria'); await p.waitForTimeout(250);
    checa('e a busca também', (await p.locator('.pa-card').count()) === 2);
    await p.fill('#f-busca', ''); await p.waitForTimeout(250);

    checa('nenhum XSS', await p.evaluate(() => window.__XSS === 0));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== LISTAGEM DA PRÉ-ANÁLISE ==');
  {
    // A vista vem do endereço, não de um clique guardado em variável: é isso
    // que faz o link direto e o botão "voltar" do navegador continuarem valendo.
    const { b, p, erros } = await abrir('pre-analise.html?vista=listagem', { modulos:['PRE_ANALISE'] });
    const corpo = await p.evaluate(() => document.body.innerText);
    checa('o endereço decide a vista: ?vista=listagem abre a tabela',
      (await p.locator('table.fila').count()) === 1
      && !(await p.locator('#vista-andamento').isVisible()));
    checa('lista as quatro pré-análises', /4 de 4 pré-análises/.test(corpo), corpo.slice(0,200));
    checa('mostra o nome do titular, que vem dos participantes', /Maria Titular/.test(corpo));
    checa('mostra o CPF formatado', /529\.982\.247-25/.test(corpo));
    checa('mostra a situação de cada uma', /Em análise/.test(corpo) && /Aprovada/.test(corpo));

    // pa1 está há 72h numa etapa de SLA 24h: tem de estar vermelho.
    checa('o prazo estourado é contado a partir de quando ENTROU na etapa',
      await p.evaluate(() => !!document.querySelector('.sla-ex')));
    checa('e o que entrou há pouco fica verde',
      await p.evaluate(() => !!document.querySelector('.sla-ok')));
    checa('o KPI de estourado bate com o que a fila pinta de vermelho',
      await p.evaluate(() => {
        const kpi = Array.from(document.querySelectorAll('#kpis .kpi-card'))
          .find(c => /Estourado/i.test(c.textContent));
        const n = kpi ? parseInt(kpi.querySelector('.kpi-value').textContent, 10) : -1;
        return n === document.querySelectorAll('table.fila .sla-ex').length && n === 1;
      }));

    // Filtro por prazo
    await p.click('#sla-ex'); await p.waitForTimeout(200);
    checa('filtrar por estourado deixa só uma linha',
      (await p.locator('table.fila tbody tr').count()) === 1);
    await p.click('#sla-todos'); await p.waitForTimeout(200);
    checa('e voltar para todos traz as quatro de volta',
      (await p.locator('table.fila tbody tr').count()) === 4);

    // Busca
    await p.fill('#f-busca', 'Maria'); await p.waitForTimeout(250);
    checa('a busca acha pelo nome do titular — e só quem tem esse nome',
      (await p.locator('table.fila tbody tr').count()) === 2);
    await p.fill('#f-busca', 'PA-002'); await p.waitForTimeout(250);
    checa('e pelo código', (await p.locator('table.fila tbody tr').count()) === 1);
    await p.fill('#f-busca', '52998224725'); await p.waitForTimeout(250);
    checa('e pelo CPF só com dígitos, mesmo estando formatado na tela',
      (await p.locator('table.fila tbody tr').count()) === 2);
    await p.fill('#f-busca', ''); await p.waitForTimeout(250);

    await p.selectOption('#f-situacao', 'ps3'); await p.waitForTimeout(250);
    checa('o filtro por situação funciona',
      (await p.locator('table.fila tbody tr').count()) === 2);
    await p.selectOption('#f-situacao', ''); await p.waitForTimeout(200);

    // O dossiê é o mesmo nas duas vistas: clicar na linha tem de abri-lo.
    await p.click('table.fila tbody tr'); await p.waitForTimeout(800);
    checa('clicar numa linha abre o dossiê',
      await p.locator('#modal-dossie').isVisible()
      && (await p.locator('#dos-titulo').textContent()).trim() !== '');

    checa('nenhum XSS', await p.evaluate(() => window.__XSS === 0));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== ASSISTENTE DE NOVA PRÉ-ANÁLISE ==');
  {
    const { b, p, erros } = await abrir('pre-analise.html', { modulos:['PRE_ANALISE'] });
    await p.click('#btn-nova'); await p.waitForTimeout(300);
    checa('o assistente abre no passo 1',
      /Passo 1 de 3/.test(await p.locator('#nova-sub').textContent()));
    checa('avisa que a unidade não reserva estoque',
      /não reserva estoque/i.test(await p.locator('#nova-body').textContent()));

    // Sem empreendimento não avança.
    await p.evaluate(() => passoSeguinte()); await p.waitForTimeout(250);
    checa('sem empreendimento, não avança',
      /Passo 1 de 3/.test(await p.locator('#nova-sub').textContent()));

    await p.selectOption('#w-empr', 'd1');
    await p.evaluate(() => passoSeguinte()); await p.waitForTimeout(300);
    checa('escolhido o empreendimento, vai para o titular',
      /Passo 2 de 3/.test(await p.locator('#nova-sub').textContent()));

    // CPF inválido é barrado ANTES de virar cadastro.
    await p.fill('#w-nome', 'Fulano de Tal');
    await p.fill('#w-doc', '111.111.111-11');
    await p.evaluate(() => passoSeguinte()); await p.waitForTimeout(300);
    checa('CPF com dígito verificador errado é recusado',
      /Passo 2 de 3/.test(await p.locator('#nova-sub').textContent()));

    // CPF de uma pessoa que já existe: reaproveita em vez de duplicar.
    await p.fill('#w-doc', '529.982.247-25');
    await p.evaluate(() => buscarPessoa()); await p.waitForTimeout(500);
    checa('CPF já cadastrado traz os dados prontos',
      (await p.inputValue('#w-nome')).includes('Maria Titular'));
    checa('e avisa que não vai duplicar',
      /Já cadastrado/i.test(await p.locator('#w-doc-msg').textContent()));

    await p.evaluate(() => passoSeguinte()); await p.waitForTimeout(300);
    checa('vai para renda e associados',
      /Passo 3 de 3/.test(await p.locator('#nova-sub').textContent()));
    checa('lembra que quem cria não aprova o próprio crédito',
      /não aprova o próprio crédito/i.test(await p.locator('#nova-body').textContent()));

    await p.fill('#w-renda', '4.500,00');
    await p.evaluate(() => addAssociado()); await p.waitForTimeout(250);
    checa('dá para somar um associado', (await p.locator('#w-assoc .fgrid').count()) === 1);

    await p.evaluate(() => passoSeguinte()); await p.waitForTimeout(900);
    const posts = await p.evaluate(() => window.__POSTS || []);
    const criouPa = posts.filter(x => /a1_pre_analises/.test(x.url) && x.m === 'POST');
    checa('criou a pré-análise', criouPa.length === 1, JSON.stringify(posts.map(x=>x.url)));

    const corpoPa = criouPa.length ? JSON.parse(criouPa[0].body) : {};
    checa('e NÃO manda corretor_id: quem decide o dono é o banco',
      !('corretor_id' in corpoPa), JSON.stringify(corpoPa));
    checa('nem a situação: a esteira do cliente é que diz onde começa',
      !('situacao_id' in corpoPa), JSON.stringify(corpoPa));

    const pes = posts.filter(x => /a1_pa_pessoas/.test(x.url) && x.m === 'POST');
    checa('não recadastrou a pessoa que já existia',
      !pes.some(x => (JSON.parse(x.body).documento || '') === '52998224725'),
      JSON.stringify(pes.map(x=>x.body)));

    const part = posts.filter(x => /a1_pa_participantes/.test(x.url) && x.m === 'POST');
    const envP = part.length ? JSON.parse(part[0].body) : [];
    checa('gravou o titular', Array.isArray(envP) && envP[0] && envP[0].papel === 'TITULAR');
    checa('com a renda em centavos, inteiro',
      Array.isArray(envP) && envP[0] && envP[0].renda_declarada === 450000,
      JSON.stringify(envP[0] && envP[0].renda_declarada));

    checa('nenhum XSS', await p.evaluate(() => window.__XSS === 0));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== DOSSIÊ 360º ==');
  {
    const { b, p, erros } = await abrir('pre-analise.html', { modulos:['PRE_ANALISE'] });
    await p.evaluate(() => abrirDossie('pa1')); await p.waitForTimeout(800);
    checa('o dossiê abre com o nome do titular',
      /Maria Titular/.test(await p.locator('#dos-titulo').textContent()));

    await p.click('#dos-tabs [data-dt="pessoas"]'); await p.waitForTimeout(250);
    const pessoas = await p.locator('#dos-body').textContent();
    checa('lista titular e associado', /TITULAR/.test(pessoas) && /ASSOCIADO/.test(pessoas));
    checa('soma a renda familiar declarada', /R\$\s?6\.700,00/.test(pessoas), pessoas.slice(0,300));
    checa('avisa que mexer em participante invalida a aprovação',
      /invalida a decisão de crédito/i.test(pessoas));

    await p.click('#dos-tabs [data-dt="credito"]'); await p.waitForTimeout(250);
    const cred = await p.locator('#dos-body').textContent();
    checa('o gestor pode registrar decisão de crédito', /Nova decisão/.test(cred));
    // A soma tem de fechar, e a tela mostra isso antes de mandar para o banco.
    await p.fill('#c-fin', '200.000,00');
    await p.fill('#c-sub', '30.000,00');
    await p.fill('#c-fgts', '10.000,00');
    await p.waitForTimeout(200);
    checa('o total é a soma das três fontes, calculada na tela',
      (await p.inputValue('#c-total')).replace(/\s/g,' ').includes('240.000,00'),
      await p.inputValue('#c-total'));

    await p.click('#dos-tabs [data-dt="checklist"]'); await p.waitForTimeout(250);
    const chk = await p.locator('#dos-body').textContent();
    checa('o checklist cobra o que o banco vai cobrar',
      /Decisão de crédito aprovada e válida/.test(chk));
    checa('e mostra o que falta', /falta/.test(chk));

    await p.click('#dos-tabs [data-dt="historico"]'); await p.waitForTimeout(250);
    const hist = await p.locator('#dos-body').textContent();
    checa('o histórico mostra a transição', /Mudança de situação/.test(hist));
    checa('com a justificativa', /documentos recebidos/.test(hist));
    checa('e avisa que não se apaga', /não\s+se\s+edita\s+e\s+não\s+se\s+apaga/i.test(hist), hist.slice(-160));

    await p.click('#dos-tabs [data-dt="comercial"]'); await p.waitForTimeout(250);
    checa('sem comercial, explica que ele nasce por ação da esteira',
      /ação da esteira/i.test(await p.locator('#dos-body').textContent()));

    // Os destinos vêm das arestas da esteira, não de uma lista fixa.
    const destinos = await p.evaluate(() =>
      Array.from(document.querySelectorAll('#dos-mover option')).map(o => o.textContent));
    checa('só oferece as transições que a esteira permite a partir daqui',
      destinos.length === 2 && destinos.includes('Aprovada') && destinos.includes('Reprovada'),
      JSON.stringify(destinos));

    checa('nenhum XSS', await p.evaluate(() => window.__XSS === 0));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== HABILITAR O COMERCIAL ==');
  {
    const { b, p, erros } = await abrir('pre-analise.html', { modulos:['PRE_ANALISE','COMERCIAL'] });
    // pa1 não tem crédito aprovado — o botão não pode aparecer.
    await p.evaluate(() => abrirDossie('pa1')); await p.waitForTimeout(800);
    checa('sem crédito aprovado, o botão de habilitar Comercial não aparece',
      (await p.locator('#btn-habilitar').count()) === 0);

    // pa3 tem aprovação e titular.
    // pa3 já tem comercial; pa4 é aprovada e ainda não tem.
    await p.evaluate(() => abrirDossie('pa3')); await p.waitForTimeout(800);
    checa('se o comercial já existe, o botão some e a tela diz por quê',
      (await p.locator('#btn-habilitar').count()) === 0
      && /já criado/i.test(await p.locator('#dos-acoes').textContent()));
    await p.evaluate(() => abrirDossie('pa4')); await p.waitForTimeout(800);
    checa('com aprovação, titular e sem comercial, o botão aparece',
      (await p.locator('#btn-habilitar').count()) === 1);
    await p.click('#btn-habilitar'); await p.waitForTimeout(700);
    const chamou = await p.evaluate(() => (window.__POSTS||[])
      .filter(x => /rpc\/a1_pa_executar_acao/.test(x.url)));
    checa('e chama a AÇÃO do servidor, não um insert direto', chamou.length === 1);
    checa('com a ação nomeada, não um comando genérico',
      chamou.length && JSON.parse(chamou[0].body).p_acao === 'ENABLE_COMMERCIAL');
    checa('nenhum POST direto em a1_comerciais',
      await p.evaluate(() => !(window.__POSTS||[])
        .some(x => /a1_comerciais/.test(x.url) && x.m === 'POST')));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== TELA DO COMERCIAL ==');
  {
    const { b, p, erros } = await abrir('comercial.html', { modulos:['COMERCIAL'] });
    const corpo = await p.evaluate(() => document.body.innerText);
    checa('a tela abre', /Comercial/i.test(await p.title()));
    checa('lista o negócio', /1 de 1 negócio/.test(corpo), corpo.slice(0,200));
    checa('o nome do cliente vem do snapshot da aprovação', /Maria Titular/.test(corpo));
    checa('mostra o valor aprovado', /240\.000,00/.test(corpo));

    // O cabeçalho passou a ser o de js/modulo-shell.js, o mesmo dos quadros
    // antigos. Era a divergência que fazia esta tela parecer outro produto.
    const abas = await p.evaluate(() => Array.from(
      document.querySelectorAll('#shell .tabs-bar > .tab-btn, #shell .tab-group > .tab-btn'))
      .map(a => a.textContent.replace(/\s+/g, ' ').replace('▾', '').trim()));
    checa('o cabeçalho traz as abas do resto do sistema',
      abas.includes('Dashboard') && abas.includes('Repasse') && abas.includes('Configuracoes'),
      JSON.stringify(abas));
    checa('com o Comercial marcado como a tela atual',
      await p.evaluate(() => {
        const a = document.querySelector('#shell .tab-group > .tab-btn.active');
        return !!a && /Comercial/.test(a.textContent);
      }));
    checa('e a Pré-análise, sem licença, continua fora da barra',
      !abas.includes('Pré-análise'), JSON.stringify(abas));
    checa('existe um cabeçalho só, não dois disputando o topo',
      await p.evaluate(() => document.querySelectorAll('.hdr').length === 1
                          && document.querySelectorAll('.tabs-bar').length === 1));

    const menu = await p.evaluate(() => {
      const g = Array.from(document.querySelectorAll('#shell .tab-group'))
        .find(x => /Comercial/.test(x.querySelector('.tab-btn').textContent));
      return g ? Array.from(g.querySelectorAll('.dd-item'))
        .map(a => a.textContent.trim() + ' → ' + a.getAttribute('href')) : [];
    });
    checa('o menu Comercial oferece exatamente Andamento e Listagem',
      menu.length === 2 && menu[0] === 'Andamento → /thecred/comercial'
                        && menu[1] === 'Listagem → /thecred/comercial-listagem',
      JSON.stringify(menu));

    // Sem vista no endereço, abre no Andamento — e as abas internas Fila/Esteira
    // deixaram de existir: quem escolhe a vista é o menu do cabeçalho.
    checa('abre no Andamento, o quadro por situação',
      await p.evaluate(() => document.getElementById('vista-andamento').offsetParent !== null
                          && document.getElementById('vista-listagem').offsetParent === null));
    checa('com uma coluna por situação da esteira',
      (await p.locator('#vista-andamento .k-col').count()) === 2);
    checa('e sem abas internas dentro do conteúdo',
      (await p.locator('.main .tab-btn').count()) === 0);

    await p.evaluate(() => abrirDossie('co1')); await p.waitForTimeout(800);
    checa('o dossiê abre na proposta',
      (await p.locator('#p-venda').count()) === 1);
    // Venda 260k, entrada 5k, aprovado 240k → faltam 15k.
    checa('avisa quando a venda passa do que o crédito cobre',
      /acima do crédito aprovado/i.test(await p.locator('#p-conferencia').textContent()),
      await p.locator('#p-conferencia').textContent());

    await p.click('#dos-tabs [data-dt="origem"]'); await p.waitForTimeout(250);
    const orig = await p.locator('#dos-body').textContent();
    checa('a origem mostra a fotografia do crédito', /fotografia/i.test(orig));
    // Valores congelados moram em <input disabled>: textContent não os vê.
    const vals = await p.evaluate(() =>
      Array.from(document.querySelectorAll('#dos-body input')).map(i => i.value).join(' | '));
    checa('com os valores congelados', /200\.000,00/.test(vals) && /240\.000,00/.test(vals), vals);
    checa('e explica que não muda se a pré-análise mudar', /não.*muda/i.test(orig));

    await p.click('#dos-tabs [data-dt="contrato"]'); await p.waitForTimeout(250);
    const ct = await p.locator('#dos-body').textContent();
    checa('lista o contrato', /AGUARDANDO_ASSINATURA/.test(ct));
    checa('e oferece marcar como assinado a quem pode', /Marcar assinado/.test(ct));

    await p.click('#dos-tabs [data-dt="repasse"]'); await p.waitForTimeout(250);
    const rp = await p.locator('#dos-body').textContent();
    checa('explica que exigir contrato assinado é opção do cliente',
      /opção do cliente/i.test(rp));

    checa('o botão de criar Repasse está no rodapé',
      (await p.locator('#btn-repasse').count()) === 1);
    await p.click('#btn-repasse'); await p.waitForTimeout(700);
    const acao = await p.evaluate(() => (window.__POSTS||[])
      .filter(x => /rpc\/a1_co_executar_acao/.test(x.url)));
    checa('criar Repasse chama a ação do servidor', acao.length === 1);
    checa('nenhum insert direto em a1_cases',
      await p.evaluate(() => !(window.__POSTS||[])
        .some(x => /a1_cases/.test(x.url) && x.m === 'POST')));

    checa('nenhum XSS', await p.evaluate(() => window.__XSS === 0));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }
  {
    // A outra vista do mesmo módulo, pedida pelo endereço — é por aí que o item
    // do menu chega. E com o ?id= junto, porque é o link que a Pré-análise manda
    // para cá: ele tem de abrir o negócio em qualquer das duas vistas.
    const { b, p, erros } = await abrir('comercial.html?vista=listagem&id=co1', { modulos:['COMERCIAL'] });
    checa('o link direto ?id= abre o dossiê do negócio',
      !(await p.locator('#modal-dossie').getAttribute('class')).includes('hidden')
      && /Maria Titular/.test(await p.locator('#dos-titulo').textContent()));
    await p.evaluate(() => fecharModal('modal-dossie')); await p.waitForTimeout(200);

    checa('?vista=listagem mostra a tabela no lugar do quadro',
      await p.evaluate(() => document.getElementById('vista-listagem').offsetParent !== null
                          && document.getElementById('vista-andamento').offsetParent === null));
    checa('e o menu marca Listagem como a vista atual',
      await p.evaluate(() => {
        const a = document.querySelector('#shell .dd-item.active');
        return !!a && a.textContent.trim() === 'Listagem';
      }));
    checa('a tabela mostra que o repasse ainda não foi criado',
      (await p.locator('table.fila tbody .pill.wt').count()) === 1);

    // Busca e filtro são da tela, não de uma aba: precisam valer aqui também.
    await p.fill('#f-busca', 'Maria'); await p.waitForTimeout(250);
    checa('a busca acha o negócio pelo nome do titular',
      (await p.locator('table.fila tbody tr').count()) === 1);
    await p.fill('#f-busca', 'ninguém'); await p.waitForTimeout(250);
    checa('e esvazia a tabela quando nada casa',
      (await p.locator('table.fila tbody tr').count()) === 0);
    await p.fill('#f-busca', ''); await p.waitForTimeout(250);

    await p.click('#sla-ex'); await p.waitForTimeout(250);
    checa('o filtro de prazo deixa só a linha que a tabela pinta de vermelho',
      (await p.locator('table.fila tbody tr').count()) === 1
      && (await p.locator('table.fila .sla-ex').count()) === 1);

    checa('nenhum XSS', await p.evaluate(() => window.__XSS === 0));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== A ESTEIRA NÃO SE MOVE POR EDIÇÃO DIRETA ==');
  {
    const { b, p, erros } = await abrir('pre-analise.html', { modulos:['PRE_ANALISE'] });
    await p.evaluate(() => abrirDossie('pa1')); await p.waitForTimeout(800);
    await p.evaluate(() => { document.getElementById('dos-mover').value = 'ps3'; });
    await p.evaluate(() => { window.prompt = () => 'porque sim'; });
    await p.click('#dos-btn-mover'); await p.waitForTimeout(700);
    const posts = await p.evaluate(() => window.__POSTS || []);
    checa('mover situação chama a função de transição',
      posts.some(x => /rpc\/a1_pa_transicionar/.test(x.url)));
    checa('e NUNCA faz PATCH em situacao_id',
      !posts.some(x => /a1_pre_analises/.test(x.url) && x.m === 'PATCH'
                    && /situacao_id/.test(x.body || '')),
      JSON.stringify(posts.filter(x => x.m === 'PATCH').map(x => x.body)));
    checa('manda a versão esperada, para não escrever por cima de outra pessoa',
      posts.some(x => /a1_pa_transicionar/.test(x.url)
                   && JSON.parse(x.body).p_versao_esperada === 1));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== PERMISSÃO DE ANALISAR CRÉDITO ==');
  {
    const { b, p, erros } = await abrir('configuracoes.html');
    // A permissão existe no cadastro, senão só gestor e gerente aprovariam
    // e a separação "quem vende não aprova" ficaria sem quem exercê-la.
    await p.evaluate(() => openCfgView('analistas')); await p.waitForTimeout(500);
    await p.evaluate(() => openAnalista(null)); await p.waitForTimeout(400);
    checa('o cadastro de analista oferece "analisar crédito"',
      (await p.locator('.an-perm[data-key="analisar_credito"]').count()) === 1);
    checa('e ela NÃO vem marcada por padrão',
      !(await p.locator('.an-perm[data-key="analisar_credito"]').isChecked()));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== CONFIGURAÇÃO DA ESTEIRA NO SUPERADMIN ==');
  {
    const { chromium } = require('playwright');
    const { D } = require('./fake');
    const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);
    const b = await chromium.launch();
    const p = await b.newPage({ viewport:{ width:1500, height:1000 } });
    const erros = [], gravado = [];
    p.on('pageerror', e => erros.push('JS: ' + e.message));
    await p.route(/fonts\./, r => r.fulfill({ status:200, contentType:'text/css', body:'' }));

    // Cliente sem esteira nenhuma: é como todo cliente começa.
    let situacoes = [], transicoes = [];
    await p.route(/supabase\.co/, r => {
      const u = r.request().url(), m = r.request().method();
      const j = x => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(x) });
      if (m !== 'GET') gravado.push({ u, m, body: r.request().postData() });
      if (u.includes('a1_tenants')) return j(D.tenants);
      if (u.includes('a1_pa_situacoes')) {
        if (m === 'POST'){ const novas = JSON.parse(r.request().postData())
            .map((s,i) => Object.assign({ id:'ns'+i }, s)); situacoes = novas; return j(novas); }
        if (m === 'PATCH' || m === 'DELETE') return j([{}]);
        return j(situacoes);
      }
      if (u.includes('a1_pa_transicoes')) {
        if (m === 'POST'){ const novas = JSON.parse(r.request().postData())
            .map((t,i) => Object.assign({ id:'nt'+i }, t)); transicoes = novas; return j(novas); }
        if (m === 'PATCH' || m === 'DELETE') return j([{}]);
        return j(transicoes);
      }
      return j([]);
    });

    await p.goto(BASE + '/superadmin.html', { waitUntil:'load' });
    await p.fill('#sa-url-input','https://x.supabase.co');
    await p.fill('#sa-key-input','chave');
    await p.click('button:has-text("Entrar como Superadmin")');
    await p.waitForTimeout(1100);
    await p.click('.sa-tab:has-text("Esteiras")'); await p.waitForTimeout(500);

    checa('a aba Esteiras existe', await p.locator('#satab-esteiras').isVisible());
    checa('e explica a diferença entre situação e ação',
      /a ação, que é o que provoca efeito/i.test(await p.locator('#satab-esteiras').textContent()));
    checa('abrir a aba não grava nada sozinho', gravado.length === 0, JSON.stringify(gravado));

    await p.selectOption('#est-tenant','t1'); await p.waitForTimeout(600);
    checa('cliente sem esteira ganha o convite para criar a padrão',
      /Criar esteira padrão de Pré-análise/.test(await p.locator('#est-corpo').textContent()));
    checa('e explica por que sem esteira o módulo não funciona',
      /não há para onde mover/i.test(await p.locator('#est-corpo').textContent()));

    await p.click('button:has-text("Criar esteira padrão de Pré-análise")');
    await p.waitForTimeout(900);
    const sitPost = gravado.filter(x => /a1_pa_situacoes/.test(x.u) && x.m === 'POST');
    checa('criou as situações padrão', sitPost.length === 1);
    const corpoSit = sitPost.length ? JSON.parse(sitPost[0].body) : [];
    checa('com uma situação INICIAL e uma APROVADO',
      corpoSit.some(s => s.flag === 'INICIAL') && corpoSit.some(s => s.flag === 'APROVADO'),
      JSON.stringify(corpoSit.map(s => s.flag)));
    checa('cada uma amarrada ao cliente escolhido',
      corpoSit.every(s => s.tenant_id === 't1'));
    checa('e com SLA em horas na etapa que corre contra o relógio',
      corpoSit.some(s => s.sla_horas > 0));

    const trPost = gravado.filter(x => /a1_pa_transicoes/.test(x.u) && x.m === 'POST');
    checa('e ligou as situações em sequência', trPost.length === 1);
    const corpoTr = trPost.length ? JSON.parse(trPost[0].body) : [];
    checa('as situações terminais aceitam vir de qualquer lugar',
      corpoTr.some(t => t.de_id === null), JSON.stringify(corpoTr.map(t => t.de_id)));
    checa('nenhuma transição nasce com ação ligada — quem liga é o operador',
      corpoTr.every(t => !t.acao), JSON.stringify(corpoTr.map(t => t.acao)));
    checa('nem em modo automático por acidente',
      corpoTr.every(t => t.acao_modo === 'CONFIRMAR'));

    const grade = await p.locator('#est-corpo').textContent();
    checa('a tabela de situações aparece', /Situações de Pré-análise/.test(grade));
    checa('e a de transições também', /Transições permitidas/.test(grade));
    checa('a ação oferecida na Pré-análise é habilitar o Comercial',
      /Habilitar Comercial/.test(grade));
    checa('e o requisito oferecido é exigir documentos aprovados',
      /Exigir todos os documentos aprovados/.test(grade));

    await p.selectOption('#est-modulo','COMERCIAL'); await p.waitForTimeout(600);
    checa('trocando para Comercial, a ação oferecida é criar o cartão no Repasse',
      /Criar cartão no Repasse/.test(await p.locator('#est-corpo').textContent())
      || /Criar esteira padrão de Comercial/.test(await p.locator('#est-corpo').textContent()));

    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  const n = resumo([]);
  process.exit(n ? 1 : 0);
})();
