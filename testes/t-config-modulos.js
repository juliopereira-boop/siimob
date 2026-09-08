// Configurações dos módulos novos (Pré-análise e Comercial).
//
// A primeira verificação é NEGATIVA e é a que importa: sem a licença, nada
// disso pode EXISTIR na tela — nem cartão, nem sub-tela, nem opção de menu, nem
// consulta às tabelas. É o requisito que o dono repetiu, e é a razão de os
// cartões serem montados por JS em vez de nascerem no HTML escondidos: o que
// não está no DOM ninguém acha com a busca do hub nem com o inspetor.
//
// Depois disso, o editor de esteira: se lista, se grava na tabela do módulo que
// está aberto (e não na do outro), e se a esteira semeada nasce inerte — sem
// ação entre módulos e sem AUTO. Semear uma automação ligada na conta de quem
// ainda está desenhando o fluxo é o tipo de erro que só aparece depois que já
// criou registro em outro módulo.
const { chromium } = require('playwright');
const { responder, liberarModulos } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

// Abridor próprio em vez do comum.js por duas razões: precisamos da lista de
// TODAS as requisições (o comum.js só guarda as de escrita, e aqui a pergunta é
// se saiu um GET que não devia) e precisamos trocar o papel do usuário, para
// provar que correspondente não chega ao editor.
async function abrirConfig({ modulos = [], papel = 'owner' } = {}) {
  liberarModulos(modulos);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [], pedidos = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  p.on('console', m => { const t = m.text();
    if (m.type() === 'error' && !/ERR_CONNECTION|ERR_TUNNEL|fonts\.g|favicon|net::/.test(t)) erros.push('console: ' + t); });
  await p.addInitScript(pp => {
    localStorage.setItem('a1_token', 'tok');
    localStorage.setItem('a1_slug', 'thecred');
    localStorage.setItem('a1_user', JSON.stringify({ id:'u1', tenant_id:'t1', name:'Julio',
      role:pp, type:'cca', cpf:'99999999999', permissions:{} }));
    window.__XSS = 0;
    window.confirm = () => true;
    window.__POSTS = [];
    const f = window.fetch;
    window.fetch = function (u, o) {
      if (o && o.method && o.method !== 'GET') window.__POSTS.push({ url:String(u), m:o.method, body:o.body });
      return f.apply(this, arguments);
    };
  }, papel);
  await p.route(/supabase\.co/, r => {
    pedidos.push(r.request().method() + ' ' + r.request().url());
    let d; try { d = responder(r.request().url(), r.request().method(), r.request().postData()); } catch (e) { d = []; }
    r.fulfill({ status:200, contentType:'application/json',
                headers:{ 'content-range':'0-1/2' }, body:JSON.stringify(d) });
  });
  await p.goto(BASE + '/configuracoes.html', { waitUntil:'load' });
  await p.waitForTimeout(1600);
  return { b, p, erros, pedidos };
}

const TABELAS_NOVAS = /a1_pa_situacoes|a1_pa_transicoes|a1_co_situacoes|a1_co_transicoes|a1_integra_eventos/;
const escritas = (p, re, metodo) => p.evaluate(([r, m]) =>
  (window.__POSTS || []).filter(x => new RegExp(r).test(x.url) && (!m || x.m === m)),
  [re.source, metodo || null]);

(async () => {
  console.log('== SEM LICENÇA, NADA DISSO EXISTE ==');
  {
    const { b, p, erros, pedidos } = await abrirConfig();

    for (const id of ['cfg-card-wf-pa', 'cfg-card-wf-co', 'cfg-card-integra'])
      checa(`o cartão #${id} nem chega ao DOM`, (await p.locator('#' + id).count()) === 0);
    for (const id of ['cfg-view-esteira-pa', 'cfg-view-esteira-co', 'cfg-view-integra'])
      checa(`a sub-tela #${id} nem chega ao DOM`, (await p.locator('#' + id).count()) === 0);

    checa('o roteador não conhece as telas novas', await p.evaluate(() =>
      !CFG_VIEWS.some(v => ['esteira-pa', 'esteira-co', 'integra'].includes(v))));
    checa('a busca do hub não acha "workflow da pré-análise"', await p.evaluate(() => {
      filtrarHub('pré-análise');
      const achou = [...document.querySelectorAll('#cfg-hub .cfg-hub-card:not(.oculto)')].length;
      filtrarHub('');
      return achou === 0;
    }));

    // Estes três existem no HTML e nascem escondidos: são pedaços de telas
    // antigas que só fazem sentido com a Pré-análise (a permissão
    // 'analisar_credito' só é lida pelas políticas do módulo).
    for (const id of ['an-perm-credito', 'pt-perm-credito', 'dt-mod-PRE_ANALISE'])
      checa(`#${id} continua escondido`, await p.evaluate(x =>
        document.getElementById(x).style.display === 'none', id));

    checa('a palavra "Pré-análise" não aparece no hub', await p.evaluate(() =>
      !/Pr[ée]-an[áa]lise/i.test(document.getElementById('cfg-hub').innerText)));
    checa('nenhuma consulta às tabelas dos módulos novos',
      !pedidos.some(u => TABELAS_NOVAS.test(u)),
      pedidos.filter(u => TABELAS_NOVAS.test(u))[0] || '');
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== COM LICENÇA, OS CARTÕES APARECEM ==');
  {
    const { b, p, erros, pedidos } = await abrirConfig({ modulos:['PRE_ANALISE','COMERCIAL'] });

    checa('cartão do workflow da Pré-análise', await p.locator('#cfg-card-wf-pa').isVisible());
    checa('cartão do workflow do Comercial', await p.locator('#cfg-card-wf-co').isVisible());
    checa('cartão do registro de integrações', await p.locator('#cfg-card-integra').isVisible());
    checa('os workflows ficam no mesmo grupo do Editor de Workflow', await p.evaluate(() =>
      document.getElementById('cfg-card-wf-pa').parentElement.id === 'cfg-cards-workflow'));
    checa('o hub continua com 5 grupos', await p.evaluate(() =>
      document.querySelectorAll('#cfg-hub .cfg-grupo').length) === 5);
    const cards = await p.locator('#cfg-hub .cfg-hub-card:visible').count();
    checa('21 cartões viram 24', cards === 24, 'n=' + cards);
    checa('a permissão de analisar crédito aparece', await p.evaluate(() =>
      document.getElementById('an-perm-credito').style.display !== 'none'));
    checa('e o terceiro módulo dos tipos de documento também', await p.evaluate(() =>
      document.getElementById('dt-mod-PRE_ANALISE').style.display !== 'none'));

    // Nada é consultado só por ter licença: o editor busca quando o gestor abre.
    checa('abrir Configurações não consultou a esteira',
      !pedidos.some(u => TABELAS_NOVAS.test(u)));

    console.log('\n== O EDITOR DA PRÉ-ANÁLISE ==');
    await p.evaluate(() => openCfgView('esteira-pa')); await p.waitForTimeout(700);
    checa('a sub-tela abre', await p.locator('#cfg-view-esteira-pa').isVisible());
    checa('e busca a esteira da Pré-análise', pedidos.some(u => /GET .*a1_pa_situacoes/.test(u)));
    checa('sem encostar na esteira do Comercial', !pedidos.some(u => /a1_co_situacoes/.test(u)));

    const tela = await p.locator('#cfg-view-esteira-pa').textContent();
    checa('explica que a situação diz ONDE o processo está',
      /situação.{0,30}onde o processo está/i.test(tela));
    checa('e que a AÇÃO fica na transição', /ação.{0,40}transição/i.test(tela));

    const linhas = await p.locator('#est-pa-corpo tbody tr').count();
    checa('lista as 4 situações + as 3 transições', linhas === 7, 'linhas=' + linhas);
    checa('mostra as colunas de flag, cor, SLA e ativa',
      /Classificação/.test(tela) && /Cor/.test(tela) && /SLA \(horas\)/.test(tela) && /Ativa/.test(tela));
    checa('e as colunas da transição, com ação e modo',
      /Ação disparada/.test(tela) && /Quando/.test(tela) && /Requisito/.test(tela) && /Papéis/.test(tela));
    checa('a ação ENABLE_COMMERCIAL é oferecida', /Habilitar Comercial/.test(tela));
    checa('em AUTO ou o operador confirma',
      /autom[áa]tico/i.test(tela) && /o operador confirma/i.test(tela));

    checa('o nome perigoso do banco chegou escapado, não executado',
      await p.evaluate(() => document.querySelector('#est-pa-corpo input').value.includes('<img src=x')));

    console.log('\n== SALVAR VAI PARA A TABELA CERTA ==');
    // Pelo DOM, não chamando a função: é o onchange do campo que tem de estar
    // ligado, e foi isso que quebrou da última vez.
    await p.evaluate(() => {
      const i = document.querySelector('#est-pa-corpo input');
      i.value = 'Nova (renomeada)';
      i.dispatchEvent(new Event('change', { bubbles:true }));
    });
    await p.waitForTimeout(500);
    let pt = await escritas(p, /a1_pa_situacoes/, 'PATCH');
    checa('renomear manda PATCH em a1_pa_situacoes', pt.length === 1, JSON.stringify(pt));
    checa('só a linha clicada, pelo id', pt[0] && /id=eq\.ps1/.test(pt[0].url), pt[0] && pt[0].url);
    checa('com o nome novo no corpo', pt[0] && JSON.parse(pt[0].body).nome === 'Nova (renomeada)');

    await p.evaluate(() => cfgEstSalvarSituacao('ps2', 'sla_horas', '36')); await p.waitForTimeout(400);
    pt = await escritas(p, /a1_pa_situacoes/, 'PATCH');
    checa('SLA vai como número, não texto',
      pt.some(x => JSON.parse(x.body).sla_horas === 36), JSON.stringify(pt.map(x => x.body)));
    await p.evaluate(() => cfgEstSalvarSituacao('ps2', 'sla_horas', '')); await p.waitForTimeout(400);
    pt = await escritas(p, /a1_pa_situacoes/, 'PATCH');
    checa('SLA em branco vira null, não zero',
      pt.some(x => JSON.parse(x.body).sla_horas === null));
    await p.evaluate(() => cfgEstSalvarSituacao('ps2', 'ativo', false)); await p.waitForTimeout(400);
    pt = await escritas(p, /a1_pa_situacoes/, 'PATCH');
    checa('desativar grava ativo:false (não existe DELETE nesta tela)',
      pt.some(x => JSON.parse(x.body).ativo === false));
    checa('e nenhum DELETE saiu da tela', await p.evaluate(() =>
      !(window.__POSTS || []).some(x => x.m === 'DELETE')));

    console.log('\n== REORDENAR ==');
    // A fila lê a coluna `ordem`, não a posição na tabela desenhada. Subir a
    // 3ª situação tem de renumerar a lista inteira, e mandar PATCH só para quem
    // mudou de número — em base com empate (tudo com ordem 0) ou com buraco
    // (0, 5, 9), trocar o valor das duas linhas envolvidas movia para o lugar
    // errado ou não movia nada.
    await p.evaluate(() => { window.__POSTS = []; cfgEstMover('ps3', -1); });
    await p.waitForTimeout(600);
    const mv = await escritas(p, /a1_pa_situacoes/, 'PATCH');
    checa('subir renumera só as duas que trocaram de número', mv.length === 2, 'n=' + mv.length);
    checa('a que subiu recebe a posição de cima',
      mv.some(x => /id=eq\.ps3/.test(x.url) && JSON.parse(x.body).ordem === 1), JSON.stringify(mv.map(x => x.body)));
    checa('e a que desceu recebe a de baixo',
      mv.some(x => /id=eq\.ps2/.test(x.url) && JSON.parse(x.body).ordem === 2));
    checa('a tela redesenha na ordem nova', await p.evaluate(() =>
      CFG_EST.situacoes.map(s => s.id).join(',') === 'ps1,ps3,ps2,ps4'));

    // Esteira antiga com empate: todas com ordem 0. Aqui trocar valores entre
    // si não moveria nada, e é o caso que o teste guarda.
    await p.evaluate(() => { CFG_EST.situacoes.forEach(s => s.ordem = 0); window.__POSTS = []; });
    await p.evaluate(() => cfgEstMover(CFG_EST.situacoes[3].id, -1)); await p.waitForTimeout(700);
    const emp = await escritas(p, /a1_pa_situacoes/, 'PATCH');
    checa('com empate na ordem, renumera todas menos a primeira', emp.length === 3, 'n=' + emp.length);
    checa('e a numeração final é 0,1,2,3 sem repetir', await p.evaluate(() =>
      CFG_EST.situacoes.map(s => s.ordem).join(',') === '0,1,2,3'));

    await p.evaluate(() => cfgEstAbrir('PRE_ANALISE')); await p.waitForTimeout(600);

    console.log('\n== CRIAR TRANSIÇÃO ==');
    await p.evaluate(() => cfgEstNovaTransicao()); await p.waitForTimeout(500);
    const nova = (await escritas(p, /a1_pa_transicoes/, 'POST'))[0];
    checa('POST em a1_pa_transicoes', !!nova, 'nenhum POST');
    const cn = nova && JSON.parse(nova.body);
    checa('nasce sem ação entre módulos', cn && cn.acao === null, JSON.stringify(cn));
    checa('e esperando o operador confirmar', cn && cn.acao_modo === 'CONFIRMAR');
    checa('com o cliente da sessão', cn && cn.tenant_id === 't1');
    checa('papéis vazios = qualquer um autorizado', cn && Array.isArray(cn.papeis) && cn.papeis.length === 0);

    await p.evaluate(() => cfgEstRequisito('pt1', 'documentos_aprovados', true)); await p.waitForTimeout(400);
    const req = (await escritas(p, /a1_pa_transicoes/, 'PATCH')).pop();
    checa('exigir documentos grava a chave que o banco lê',
      req && JSON.parse(req.body).requisitos.documentos_aprovados === true, req && req.body);
    await p.evaluate(() => cfgEstPapeis('pt1', ' Analista , coordenador ')); await p.waitForTimeout(400);
    const pap = (await escritas(p, /a1_pa_transicoes/, 'PATCH')).pop();
    checa('papéis vão em minúsculo e sem espaço sobrando',
      pap && JSON.stringify(JSON.parse(pap.body).papeis) === '["analista","coordenador"]', pap && pap.body);

    console.log('\n== A ESTEIRA PADRÃO NASCE INERTE ==');
    await p.evaluate(() => { CFG_EST.situacoes = []; CFG_EST.transicoes = []; cfgEstRender(); });
    await p.waitForTimeout(300);
    checa('esteira vazia oferece o desenho padrão',
      /Criar esteira padrão/.test(await p.locator('#est-pa-corpo').textContent()));
    await p.click('#est-pa-corpo button:has-text("Criar esteira padrão")'); await p.waitForTimeout(700);
    const sem = (await escritas(p, /a1_pa_situacoes/, 'POST')).pop();
    const linhasSem = sem && JSON.parse(sem.body);
    checa('semeia as 6 situações de uma vez', Array.isArray(linhasSem) && linhasSem.length === 6,
      JSON.stringify(linhasSem && linhasSem.length));
    checa('com ordem sequencial começando em 0',
      linhasSem && linhasSem.every((s, i) => s.ordem === i));
    checa('todas ativas', linhasSem && linhasSem.every(s => s.ativo === true));
    checa('situação NÃO carrega ação — ação é da transição',
      linhasSem && linhasSem.every(s => !('acao' in s) && !('acao_modo' in s)));
    checa('as flags são as que o CHECK do banco aceita',
      linhasSem && linhasSem.every(s => s.flag === null ||
        ['INICIAL','APROVADO','REPROVADO','PENDENTE','VENCIDO','CANCELADO','ENCERRADO'].includes(s.flag)));

    // Semeia as transições com as situações de verdade carregadas: com o
    // andaime devolvendo uma linha só para o POST, não haveria par para ligar.
    await p.evaluate(() => cfgEstAbrir('PRE_ANALISE')); await p.waitForTimeout(600);
    await p.evaluate(() => cfgEstSemearTransicoes()); await p.waitForTimeout(600);
    const semT = (await escritas(p, /a1_pa_transicoes/, 'POST')).pop();
    const linhasT = semT && JSON.parse(semT.body);
    checa('semeia transições em lote', Array.isArray(linhasT) && linhasT.length > 0,
      JSON.stringify(linhasT));
    checa('NENHUMA nasce com ação ligada', linhasT && linhasT.every(t => t.acao === null),
      JSON.stringify(linhasT && linhasT.map(t => t.acao)));
    checa('NENHUMA nasce em modo automático',
      linhasT && linhasT.every(t => t.acao_modo === 'CONFIRMAR'),
      JSON.stringify(linhasT && linhasT.map(t => t.acao_modo)));
    checa('a terminal reprovada é alcançável de qualquer situação',
      linhasT && linhasT.some(t => t.de_id === null));

    console.log('\n== O EDITOR DO COMERCIAL É OUTRO ==');
    await p.evaluate(() => openCfgView('esteira-co')); await p.waitForTimeout(700);
    checa('a sub-tela do Comercial abre', await p.locator('#cfg-view-esteira-co').isVisible());
    checa('e busca a esteira do Comercial', pedidos.some(u => /GET .*a1_co_situacoes/.test(u)));
    const telaCo = await p.locator('#cfg-view-esteira-co').textContent();
    checa('oferece CREATE_REPASS, a ação do Comercial', /Criar cartão no Repasse/.test(telaCo));
    checa('e não oferece a ação da Pré-análise', !/Habilitar Comercial/.test(telaCo));
    await p.evaluate(() => cfgEstSalvarSituacao('cs1', 'cor', '#123456')); await p.waitForTimeout(400);
    const co = (await escritas(p, /a1_co_situacoes/, 'PATCH')).pop();
    checa('salvar aqui vai para a1_co_situacoes', !!co, 'nenhum PATCH');
    checa('e não vazou para a tabela da Pré-análise', await p.evaluate(() =>
      !(window.__POSTS || []).some(x => x.m !== 'GET' && /a1_pa_/.test(x.url) &&
        JSON.parse(x.body || '{}').cor === '#123456')));
    checa('o nome perigoso do Comercial também chegou escapado',
      await p.evaluate(() => [...document.querySelectorAll('#est-co-corpo input')]
        .some(i => i.value.includes('<img src=x'))));

    console.log('\n== REGISTRO DE INTEGRAÇÕES ==');
    await p.evaluate(() => openCfgView('integra')); await p.waitForTimeout(700);
    checa('a sub-tela abre', await p.locator('#cfg-view-integra').isVisible());
    checa('e é só leitura: consulta e não grava', pedidos.some(u => /GET .*a1_integra_eventos/.test(u))
      && await p.evaluate(() => !(window.__POSTS || []).some(x => /a1_integra_eventos/.test(x.url))));
    checa('sem eventos, explica em vez de mostrar tabela vazia',
      /Nenhuma integração registrada/.test(await p.locator('#integra-corpo').textContent()));

    await p.evaluate(() => closeCfgView()); await p.waitForTimeout(300);
    checa('voltar devolve o hub', await p.locator('#cfg-hub').isVisible());
    checa('e esconde as telas novas', await p.evaluate(() =>
      ['esteira-pa','esteira-co','integra'].every(v =>
        document.getElementById('cfg-view-' + v).style.display === 'none')));

    checa('nenhum XSS executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== CORRESPONDENTE NÃO CONFIGURA WORKFLOW ==');
  {
    // Com a licença liberada e tudo: quem escreve na esteira é gestor, e no
    // banco "gestor" é literalmente papel diferente de partner. Se o cartão
    // aparecesse, o correspondente levaria 403 em cada clique.
    const { b, p, erros, pedidos } = await abrirConfig({ modulos:['PRE_ANALISE','COMERCIAL'], papel:'partner' });
    for (const id of ['cfg-card-wf-pa', 'cfg-card-wf-co', 'cfg-card-integra'])
      checa(`#${id} não existe para o correspondente`, (await p.locator('#' + id).count()) === 0);
    checa('nem as sub-telas', (await p.locator('#cfg-view-esteira-pa, #cfg-view-esteira-co, #cfg-view-integra').count()) === 0);
    checa('e nenhuma consulta às tabelas de configuração',
      !pedidos.some(u => TABELAS_NOVAS.test(u)),
      pedidos.filter(u => TABELAS_NOVAS.test(u))[0] || '');
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  const n = resumo([]); process.exit(n ? 1 : 0);
})();
