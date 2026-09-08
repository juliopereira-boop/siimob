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

    checa('o cartão do registro de integrações nem chega ao DOM',
      (await p.locator('#cfg-card-integra').count()) === 0);
    checa('nem a sub-tela dele', (await p.locator('#cfg-view-integra').count()) === 0);

    checa('o roteador não conhece as telas novas', await p.evaluate(() =>
      !CFG_VIEWS.includes('integra')));
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

    checa('cartão do registro de integrações', await p.locator('#cfg-card-integra').isVisible());
    checa('o hub continua com 5 grupos', await p.evaluate(() =>
      document.querySelectorAll('#cfg-hub .cfg-grupo').length) === 5);
    // 21 de sempre + 1 do registro de integrações. Os workflows dos módulos
    // NÃO entram como cartão: são botões dentro do Editor de Workflow.
    const cards = await p.locator('#cfg-hub .cfg-hub-card:visible').count();
    checa('21 cartões viram 22', cards === 22, 'n=' + cards);
    checa('a permissão de analisar crédito aparece', await p.evaluate(() =>
      document.getElementById('an-perm-credito').style.display !== 'none'));
    checa('e o terceiro módulo dos tipos de documento também', await p.evaluate(() =>
      document.getElementById('dt-mod-PRE_ANALISE').style.display !== 'none'));

    // Nada é consultado só por ter licença: o editor busca quando o gestor abre.
    checa('abrir Configurações não consultou a esteira',
      !pedidos.some(u => TABELAS_NOVAS.test(u)));

    // O editor de esteira saiu daqui. Virou o mesmo quadro do Repasse, em
    // workflow.html, e os testes dele foram junto: testes/t-workflow-modulos.js.
    // Dois editores para a mesma coisa era o que o dono não queria.
    checa('o workflow não ganha cartão por módulo — é um editor só',
      (await p.locator('#cfg-card-wf-pa, #cfg-card-wf-co').count()) === 0);
    checa('e o Editor de Workflow continua único no grupo', await p.evaluate(() =>
      [...document.querySelectorAll('#cfg-cards-workflow .cfg-hub-card')]
        .filter(c => /Editor de Workflow/.test(c.textContent)).length === 1));

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
      document.getElementById('cfg-view-integra').style.display === 'none'));

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
    checa('#cfg-card-integra não existe para o correspondente',
      (await p.locator('#cfg-card-integra').count()) === 0);
    checa('nem a sub-tela', (await p.locator('#cfg-view-integra').count()) === 0);
    checa('e nenhuma consulta às tabelas de configuração',
      !pedidos.some(u => TABELAS_NOVAS.test(u)),
      pedidos.filter(u => TABELAS_NOVAS.test(u))[0] || '');
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  const n = resumo([]); process.exit(n ? 1 : 0);
})();
