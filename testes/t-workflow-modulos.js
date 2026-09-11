// O editor de workflow, agora atendendo os módulos novos.
//
// A queixa que originou isto: o workflow da Pré-análise era uma tabela em
// Configurações enquanto o do Repasse era um quadro com nós e setas. Dois
// editores para a mesma ideia, e o gestor tinha de aprender os dois. Agora é
// um só, e o que muda por dentro é de qual tabela vêm as linhas.
//
// Por isso as verificações mais importantes aqui são de ROTEAMENTO: salvar na
// Pré-análise tem de gravar em a1_pa_situacoes e não encostar em a1_co_*.
// Um adaptador que escreve na tabela errada corrompe a esteira do outro módulo.
const { chromium } = require('playwright');
const { responder, liberarModulos } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

async function abrirWf({ modulos = [], modulo = null } = {}) {
  liberarModulos(modulos);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const erros = [], pedidos = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  p.on('console', m => { const t = m.text();
    if (m.type() === 'error' && !/ERR_CONNECTION|ERR_TUNNEL|fonts\.g|favicon|net::/.test(t)) erros.push('console: ' + t); });
  await p.addInitScript(() => {
    localStorage.setItem('a1_token', 'tok');
    localStorage.setItem('a1_slug', 'thecred');
    localStorage.setItem('a1_user', JSON.stringify({ id:'u1', tenant_id:'t1', name:'Julio', role:'owner' }));
    window.__XSS = 0;
    window.confirm = () => true;
    window.__POSTS = [];
    const f = window.fetch;
    window.fetch = function (u, o) {
      if (o && o.method && o.method !== 'GET') window.__POSTS.push({ url:String(u), m:o.method, body:o.body });
      return f.apply(this, arguments);
    };
  });
  await p.route(/supabase\.co/, r => {
    pedidos.push(r.request().method() + ' ' + r.request().url());
    let d; try { d = responder(r.request().url(), r.request().method(), r.request().postData()); } catch (e) { d = []; }
    r.fulfill({ status:200, contentType:'application/json',
                headers:{ 'content-range':'0-1/2' }, body:JSON.stringify(d) });
  });
  await p.goto(BASE + '/workflow.html' + (modulo ? '?module=' + modulo : ''), { waitUntil:'load' });
  await p.waitForTimeout(1400);
  return { b, p, erros, pedidos };
}

const escritas = (p, re, metodo) => p.evaluate(([r, m]) =>
  (window.__POSTS || []).filter(x => new RegExp(r).test(x.url) && (!m || x.m === m)),
  [re.source, metodo || null]);

(async () => {
  console.log('== SEM LICENÇA, O MÓDULO NÃO ENTRA NO EDITOR ==');
  {
    const { b, p, erros, pedidos } = await abrirWf();
    const opcoes = await p.evaluate(() =>
      [...document.querySelectorAll('#module-sel option')].map(o => o.value));
    checa('Pré-análise não é oferecida', !opcoes.includes('PRE_ANALISE'), JSON.stringify(opcoes));
    checa('Venda também não', !opcoes.includes('COMERCIAL'));
    checa('e nenhuma tabela de esteira é consultada',
      !pedidos.some(u => /a1_pa_situacoes|a1_co_situacoes/.test(u)),
      pedidos.filter(u => /a1_pa_situacoes|a1_co_situacoes/.test(u))[0] || '');
    checa('o Repasse continua abrindo normalmente',
      await p.evaluate(() => MODULE === 'repasse' && stages.length > 0));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }
  {
    // Forçar o endereço não vale: a tela cai no módulo que o cliente tem.
    const { b, p, erros } = await abrirWf({ modulo:'PRE_ANALISE' });
    checa('forçar ?module=PRE_ANALISE sem licença não abre o módulo',
      await p.evaluate(() => MODULE !== 'PRE_ANALISE'));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== COM LICENÇA, OS MÓDULOS VIRAM BOTÕES NA BARRA ==');
  {
    const { b, p, erros } = await abrirWf({ modulos:['PRE_ANALISE','COMERCIAL'] });
    const botoes = await p.evaluate(() =>
      [...document.querySelectorAll('.wf-mod-btn')].map(x => x.dataset.mod));
    checa('os três módulos aparecem como botão',
      botoes.includes('repasse') && botoes.includes('PRE_ANALISE') && botoes.includes('COMERCIAL'),
      JSON.stringify(botoes));
    checa('o botão do módulo aberto vem marcado', await p.evaluate(() =>
      document.querySelector('.wf-mod-btn.on')?.dataset.mod === MODULE));
    checa('cada botão traz um ícone', await p.evaluate(() =>
      [...document.querySelectorAll('.wf-mod-btn')].every(x => x.textContent.trim().length > 3)));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }
  {
    // Um módulo só: o seletor seria enfeite.
    const { b, p } = await abrirWf();
    checa('com um módulo só, a barra de módulos não aparece',
      !(await p.locator('#wf-modulos').isVisible()));
    await b.close();
  }

  console.log('\n== O QUADRO DA PRÉ-ANÁLISE ==');
  {
    const { b, p, erros, pedidos } = await abrirWf({ modulos:['PRE_ANALISE','COMERCIAL'], modulo:'PRE_ANALISE' });
    checa('abriu no módulo pedido', await p.evaluate(() => MODULE === 'PRE_ANALISE'));
    checa('buscou a esteira da Pré-análise', pedidos.some(u => /GET .*a1_pa_situacoes/.test(u)));
    checa('sem encostar na da Venda', !pedidos.some(u => /a1_co_situacoes/.test(u)));

    checa('desenha um nó por situação', (await p.locator('.wf-node').count()) === 4);
    checa('e as setas das transições', (await p.locator('#wf-svg path[data-edge]').count()) > 0
      || await p.evaluate(() => edges.length > 0));

    // A transição "de qualquer situação" não tem de onde sair no desenho.
    checa('a transição sem origem não vira seta solta', await p.evaluate(() =>
      edges.every(e => !!e.from_id)));

    const txt = await p.evaluate(() => document.getElementById('wf-canvas').innerText);
    checa('mostra o nome das situações', /Em análise/.test(txt) && /Aprovada/.test(txt));
    checa('o nome perigoso do banco chegou escapado', await p.evaluate(() => window.__XSS === 0));

    checa('conta quantos processos estão parados em cada nó', await p.evaluate(() =>
      Object.keys(counts).length > 0));

    console.log('\n-- o painel mostra os campos DESTE módulo --');
    await p.evaluate(() => openEdit('ps2')); await p.waitForTimeout(400);
    checa('classificação e SLA aparecem', await p.evaluate(() =>
      document.getElementById('ep-esteira').style.display !== 'none'));
    checa('e as caixinhas de inicial/final/pendente do Repasse somem',
      await p.evaluate(() => document.getElementById('ep-propriedades').style.display === 'none'));
    checa('a classificação vem preenchida do banco',
      (await p.inputValue('#ep-flag')) === '');
    checa('o SLA também', (await p.inputValue('#ep-sla')) === '24');
    const flags = await p.evaluate(() =>
      [...document.querySelectorAll('#ep-flag option')].map(o => o.value));
    checa('e oferece só as flags que o CHECK da Pré-análise aceita',
      flags.includes('APROVADO') && flags.includes('PENDENTE') && !flags.includes('CONTRATO_ASSINADO'),
      JSON.stringify(flags));

    console.log('\n-- salvar vai para a tabela certa --');
    await p.fill('#ep-name', 'Em análise (renomeada)');
    await p.fill('#ep-sla', '36');
    await p.evaluate(() => document.getElementById('ep-flag').value = 'PENDENTE');
    await p.click('#edit-panel .btn-primary'); await p.waitForTimeout(500);
    const pt = await escritas(p, /a1_pa_situacoes/, 'PATCH');
    checa('PATCH em a1_pa_situacoes', pt.length === 1, JSON.stringify(pt.map(x => x.url)));
    checa('só a linha aberta, pelo id', pt[0] && /id=eq\.ps2/.test(pt[0].url));
    const corpo = pt[0] && JSON.parse(pt[0].body);
    checa('grava em "nome", que é a coluna real', corpo && corpo.nome === 'Em análise (renomeada)',
      JSON.stringify(corpo));
    checa('SLA vai como número, não texto', corpo && corpo.sla_horas === 36);
    checa('e a flag escolhida', corpo && corpo.flag === 'PENDENTE');
    checa('nada foi escrito na tabela da Venda', await p.evaluate(() =>
      !(window.__POSTS || []).some(x => /a1_co_/.test(x.url))));

    console.log('\n-- SLA em branco é "sem prazo", não zero --');
    await p.evaluate(() => openEdit('ps3')); await p.waitForTimeout(300);
    await p.fill('#ep-sla', '');
    await p.click('#edit-panel .btn-primary'); await p.waitForTimeout(500);
    const pt2 = (await escritas(p, /a1_pa_situacoes/, 'PATCH')).pop();
    checa('SLA vazio vira null', pt2 && JSON.parse(pt2.body).sla_horas === null, pt2 && pt2.body);

    console.log('\n-- a seta carrega a regra, e abre painel em vez de sumir --');
    await p.evaluate(() => abrirTransicao('pt2')); await p.waitForTimeout(400);
    checa('clicar na seta abre o painel da transição',
      await p.evaluate(() => document.getElementById('tr-panel').classList.contains('open')));
    checa('mostra de onde para onde',
      /Em análise/.test(await p.locator('#tr-de-para').textContent()));
    checa('a ação vem preenchida', (await p.inputValue('#tr-acao')) === 'ENABLE_COMMERCIAL');
    checa('e o modo também', (await p.inputValue('#tr-modo')) === 'AUTO');
    checa('oferece só as ações da Pré-análise', await p.evaluate(() => {
      const v = [...document.querySelectorAll('#tr-acao option')].map(o => o.value);
      return v.includes('ENABLE_COMMERCIAL') && !v.includes('CREATE_REPASS');
    }));
    checa('e o requisito que a função do banco de fato lê',
      /documentos aprovados/i.test(await p.locator('#tr-requisitos').textContent()));

    await p.evaluate(() => { document.getElementById('tr-acao').value = ''; pintarModo(); });
    checa('sem ação, o modo é desabilitado — "automático" de nada não existe',
      await p.evaluate(() => document.getElementById('tr-modo').disabled === true));

    await p.evaluate(() => { document.getElementById('tr-acao').value = 'ENABLE_COMMERCIAL'; pintarModo(); });
    await p.fill('#tr-papeis', ' Analista , coordenador ');
    await p.evaluate(() => {
      const c = document.querySelector('#tr-requisitos input[data-req]'); c.checked = true;
    });
    await p.click('#tr-panel .btn-primary'); await p.waitForTimeout(500);
    const tr = (await escritas(p, /a1_pa_transicoes/, 'PATCH')).pop();
    checa('salvar a transição vai para a1_pa_transicoes', !!tr, 'nenhum PATCH');
    const ct = tr && JSON.parse(tr.body);
    checa('papéis em minúsculo e sem espaço sobrando',
      ct && JSON.stringify(ct.papeis) === '["analista","coordenador"]', tr && tr.body);
    checa('requisito grava a chave que o banco lê',
      ct && ct.requisitos.documentos_aprovados === true);

    console.log('\n-- criar situação --');
    await p.evaluate(() => { window.__POSTS = []; openNewStage(); }); await p.waitForTimeout(300);
    await p.fill('#ep-name', 'Nova etapa de teste');
    await p.click('#edit-panel .btn-primary'); await p.waitForTimeout(500);
    const novo = (await escritas(p, /a1_pa_situacoes/, 'POST'))[0];
    checa('POST em a1_pa_situacoes', !!novo, 'nenhum POST');
    const cn = novo && JSON.parse(novo.body);
    checa('com o cliente da sessão', cn && cn.tenant_id === 't1');
    checa('e SEM module_key — essa coluna é da tabela do Repasse',
      cn && !('module_key' in cn), JSON.stringify(cn));
    checa('situação nasce sem ação: ação é da transição',
      cn && !('acao' in cn) && !('acao_modo' in cn));

    checa('nenhum XSS', await p.evaluate(() => window.__XSS === 0));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== TROCAR DE MÓDULO TROCA A TABELA ==');
  {
    const { b, p, erros } = await abrirWf({ modulos:['PRE_ANALISE','COMERCIAL'], modulo:'PRE_ANALISE' });
    await p.evaluate(() => { window.__POSTS = []; return changeModule('COMERCIAL'); });
    await p.waitForTimeout(800);
    checa('trocou de módulo', await p.evaluate(() => MODULE === 'COMERCIAL'));
    checa('e o botão marcado acompanhou', await p.evaluate(() =>
      document.querySelector('.wf-mod-btn.on')?.dataset.mod === 'COMERCIAL'));

    await p.evaluate(() => openEdit('cs1')); await p.waitForTimeout(400);
    const flags = await p.evaluate(() =>
      [...document.querySelectorAll('#ep-flag option')].map(o => o.value));
    checa('as flags agora são as da Venda',
      flags.includes('CONTRATO_ASSINADO') && !flags.includes('APROVADO'), JSON.stringify(flags));

    await p.fill('#ep-name', 'Proposta revisada');
    await p.click('#edit-panel .btn-primary'); await p.waitForTimeout(500);
    const co = await escritas(p, /a1_co_situacoes/, 'PATCH');
    checa('salvar aqui grava em a1_co_situacoes', co.length === 1, JSON.stringify(co.map(x => x.url)));
    checa('e NÃO vazou para a tabela da Pré-análise', await p.evaluate(() =>
      !(window.__POSTS || []).some(x => x.m !== 'GET' && /a1_pa_/.test(x.url))));

    await p.evaluate(() => abrirTransicao('ct1')); await p.waitForTimeout(400);
    checa('a ação oferecida aqui é criar o cartão no Repasse', await p.evaluate(() => {
      const v = [...document.querySelectorAll('#tr-acao option')].map(o => o.value);
      return v.includes('CREATE_REPASS') && !v.includes('ENABLE_COMMERCIAL');
    }));
    checa('e o requisito é contrato assinado',
      /contrato assinado/i.test(await p.locator('#tr-requisitos').textContent()));

    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== A TRAVA DO WORKFLOW NÃO É OPÇÃO NA ESTEIRA ==');
  {
    // No Repasse dá para soltar o fluxo. Nos módulos novos, a função do banco
    // recusa qualquer movimento sem transição cadastrada — um botão "Workflow
    // livre" aqui prometeria o que não existe.
    const { b, p } = await abrirWf({ modulos:['PRE_ANALISE'], modulo:'PRE_ANALISE' });
    checa('o botão de travar vira informação, e fica desabilitado',
      await p.evaluate(() => document.getElementById('wf-lock-btn').disabled === true));
    checa('e diz que só anda pelas setas',
      /só pelas setas/i.test(await p.locator('#wf-lock-btn').textContent()));
    await b.close();
  }
  {
    const { b, p } = await abrirWf();
    checa('no Repasse ele continua clicável, como sempre foi',
      await p.evaluate(() => document.getElementById('wf-lock-btn').disabled === false));
    await b.close();
  }

  console.log('\n== ESTEIRA VAZIA OFERECE O DESENHO PADRÃO ==');
  {
    const { b, p, erros } = await abrirWf({ modulos:['PRE_ANALISE','COMERCIAL'], modulo:'PRE_ANALISE' });
    await p.evaluate(() => { stages = []; edges = []; window.__POSTS = []; render(); });
    await p.waitForTimeout(300);
    // Texto quebra linha no HTML: \s+ em vez de espaço literal.
    checa('quadro vazio explica que o módulo não funciona assim',
      /não\s+há\s+para\s+onde\s+mover/i.test(await p.locator('#wf-vazio').textContent()),
      (await p.locator('#wf-vazio').textContent()).slice(0, 160));
    checa('e oferece o desenho padrão', (await p.locator('#wf-semear').count()) === 1);

    await p.click('#wf-semear'); await p.waitForTimeout(900);
    const sem = (await escritas(p, /a1_pa_situacoes/, 'POST'))[0];
    const linhas = sem && JSON.parse(sem.body);
    checa('semeia as 6 situações de uma vez', Array.isArray(linhas) && linhas.length === 6,
      JSON.stringify(linhas && linhas.length));
    checa('com ordem sequencial começando em 0', linhas && linhas.every((s, i) => s.ordem === i));
    checa('e já posicionadas no quadro', linhas && linhas.every(s => typeof s.pos_x === 'number'));
    checa('as flags são as que o CHECK do banco aceita',
      linhas && linhas.every(s => s.flag === null ||
        ['INICIAL','APROVADO','REPROVADO','PENDENTE','VENCIDO','CANCELADO','ENCERRADO'].includes(s.flag)));
    checa('NENHUMA situação carrega ação',
      linhas && linhas.every(s => !('acao' in s) && !('acao_modo' in s)));

    const semT = (await escritas(p, /a1_pa_transicoes/, 'POST'))[0];
    const trs = semT && JSON.parse(semT.body);
    checa('e liga as situações em sequência', Array.isArray(trs) && trs.length > 0, JSON.stringify(trs));
    checa('NENHUMA transição nasce com ação ligada', trs && trs.every(t => t.acao === null),
      JSON.stringify(trs && trs.map(t => t.acao)));
    checa('NENHUMA nasce em modo automático', trs && trs.every(t => t.acao_modo === 'CONFIRMAR'));
    checa('as terminais são alcançáveis de qualquer situação',
      trs && trs.some(t => t.de_id === null));

    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  const n = resumo([]); process.exit(n ? 1 : 0);
})();
