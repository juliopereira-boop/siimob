// A agenda do cabeçalho, e o dono do lead.
//
// POR QUE ESTE ARQUIVO EXISTE
// Dois pedidos do dono, no mesmo dia, e os dois são do tipo que quebra sem
// fazer barulho:
//
// 1. "essa agenda precisa ser funcional... a agenda ou tarefa criada tem data,
//    e essas datas entram no calendário, fica marcado". Um calendário que
//    desenha o mês mas não marca o compromisso PARECE funcionar — e é assim que
//    alguém marca uma visita, não vê o ponto, e marca outra coisa por cima.
//
// 2. "se um corretor criar um lead, esse lead tem que ser automaticamente
//    vinculado a ele, e ele não pode desvincular o lead dele". Aqui a tela é só
//    metade: quem impede de verdade é o banco. O que este arquivo prova é que a
//    TELA não pede ao banco o que ele vai recusar — senão o corretor digita,
//    salva e leva um erro que não explica nada.
const { chromium } = require('playwright');
const { responder, liberarModulos, D } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

async function abrirComo(pag, usuario, modulos) {
  liberarModulos(modulos || []);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.addInitScript(u => {
    localStorage.setItem('a1_token','tok'); localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify(u));
    window.__XSS = 0; window.confirm = () => true; window.__POSTS = [];
    const f = window.fetch;
    window.fetch = function(url, o){
      if (o && o.method && o.method !== 'GET') window.__POSTS.push({ url:String(url), m:o.method, body:o.body });
      return f.apply(this, arguments);
    };
  }, usuario);
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status:200, contentType:'text/css', body:'' }));
  await p.route(/supabase\.co/, r => {
    let d; try { d = responder(r.request().url(), r.request().method(), r.request().postData()); } catch { d = []; }
    r.fulfill({ status:200, contentType:'application/json',
                headers:{ 'content-range':'0-1/2' }, body: JSON.stringify(d) });
  });
  await p.goto(BASE + '/' + pag, { waitUntil:'load' });
  await p.waitForTimeout(1800);
  return { b, p, erros };
}

const GESTOR   = { id:'u1', tenant_id:'t1', name:'Julio', role:'owner' };
const CORRETOR = { id:'p3', tenant_id:'t1', name:'Ana Souza', role:'partner',
                   type:'corretor', cpf:'52998224725', permissions:{} };

(async () => {
  const todosErros = [];

  console.log('== O QUE FOI MARCADO APARECE NO CALENDÁRIO ==');
  {
    const { b, p, erros } = await abrirComo('geral.html', GESTOR, ['repasse']);
    await p.click('[data-pop=agenda]');
    await p.waitForTimeout(1300);

    checa('a agenda abre no lugar, sem trocar de tela',
      (await p.locator('.sb-pop .sb-cal').count()) === 1);

    // A prova que importa: o compromisso do cenário está num dia, e aquele dia
    // tem ponto. Contar "há pontos" passaria com os pontos nos dias errados.
    const marcados = await p.$$eval('.sb-cal-d.tem', els => els.map(e => e.textContent.replace(/\D/g,'')));
    const hoje = String(new Date().getDate());
    checa('o dia do compromisso de hoje está marcado', marcados.includes(hoje),
      'dias marcados: ' + JSON.stringify(marcados));

    // Quatro coisas dividem o calendário, e a legenda diz quais estão ali.
    const leg = (await p.locator('.sb-cal-legenda').textContent()).replace(/\s+/g,' ');
    checa('a legenda distingue compromisso de tarefa',
      /Compromisso/.test(leg) && /Tarefa/.test(leg), leg);
    checa('e do que vem do processo', /Avaliação/.test(leg), leg);

    // O dia de hoje já vem aberto, com o que há nele.
    const dia = (await p.locator('.sb-cal-dia').textContent()).replace(/\s+/g,' ');
    checa('o compromisso do dia aparece com hora e local',
      /Visita ao cliente/.test(dia) && /14:00/.test(dia) && /Residencial das Flores/.test(dia),
      dia.slice(0,200));
    checa('e o XSS do nome não executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== MARCAR COMPROMISSO E TAREFA ==');
  {
    const { b, p, erros } = await abrirComo('geral.html', GESTOR, ['repasse']);
    await p.click('[data-pop=agenda]');
    await p.waitForTimeout(1200);
    await p.click('.sb-pop-pe button');
    await p.waitForTimeout(400);

    checa('o formulário abre dentro do painel', (await p.locator('#ag-titulo').count()) === 1);
    checa('e já vem com o dia que estava selecionado',
      /^\d{4}-\d{2}-\d{2}$/.test(await p.inputValue('#ag-data')), await p.inputValue('#ag-data'));

    await p.fill('#ag-titulo', 'Reunião com a construtora');
    await p.fill('#ag-hora', '09:30');
    await p.fill('#ag-local', 'Escritório');
    await p.click('#ag-salvar');
    await p.waitForTimeout(900);

    const post = await p.evaluate(() =>
      (window.__POSTS || []).find(x => /a1_agenda/.test(x.url) && x.m === 'POST'));
    checa('o compromisso é gravado', !!post, JSON.stringify(post || null));
    const corpo = post ? JSON.parse(post.body) : {};
    checa('com o título, a data e a hora', corpo.titulo === 'Reunião com a construtora'
      && /^\d{4}-\d{2}-\d{2}$/.test(corpo.data || '') && corpo.hora_inicio === '09:30',
      JSON.stringify(corpo));
    // `dono` vindo da tela é o que a política do banco confere. Mandar outro id
    // seria tentar marcar na agenda de outra pessoa — e o banco recusaria.
    checa('em nome de quem está logado, e de mais ninguém', corpo.dono === 'u1', String(corpo.dono));
    checa('e no cliente certo', corpo.tenant_id === 't1', String(corpo.tenant_id));

    // Tarefa não tem hora: ela tem PRAZO. O campo some para não pedir uma
    // informação que a tarefa não usa.
    await p.click('.sb-pop-pe button');
    await p.waitForTimeout(400);
    await p.click('.sb-ag-tipo button[data-tipo=tarefa]');
    await p.waitForTimeout(200);
    checa('em tarefa, o campo de hora sai da frente',
      await p.evaluate(() => getComputedStyle(document.getElementById('ag-hora-wrap')).visibility === 'hidden'));
    await p.fill('#ag-titulo', 'Cobrar o cartório');
    await p.click('#ag-salvar');
    await p.waitForTimeout(800);
    const tarefa = await p.evaluate(() => {
      const l = (window.__POSTS || []).filter(x => /a1_agenda/.test(x.url) && x.m === 'POST');
      return l.length ? JSON.parse(l[l.length-1].body) : null;
    });
    checa('a tarefa vai sem hora', tarefa && tarefa.tipo === 'tarefa' && tarefa.hora_inicio === null,
      JSON.stringify(tarefa));
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== O LEAD É DO CORRETOR QUE O CRIOU ==');
  {
    const { b, p, erros } = await abrirComo('crm.html', CORRETOR, ['crm']);
    await p.evaluate(() => openNewLead());
    await p.waitForTimeout(400);

    // O corretor vê o próprio nome, preenchido e travado. Campo editável que o
    // banco vai recusar é pior que campo travado: a pessoa digita, salva e leva
    // um erro que não explica nada.
    await p.evaluate(() => alternarMaisLead());
    await p.waitForTimeout(200);
    checa('o corretor já vem preenchido com quem está logado',
      (await p.inputValue('#n-broker')) === 'Ana Souza', await p.inputValue('#n-broker'));
    checa('e o campo é somente leitura',
      await p.evaluate(() => document.getElementById('n-broker').readOnly));

    await p.fill('#n-name', 'Cliente Novo');
    await p.evaluate(() => createLead());
    await p.waitForTimeout(800);
    const post = await p.evaluate(() =>
      (window.__POSTS || []).find(x => /a1_cases/.test(x.url) && x.m === 'POST'));
    const corpo = post ? JSON.parse(post.body) : {};
    checa('o lead nasce no nome dele', corpo.broker_name === 'Ana Souza', JSON.stringify(corpo.broker_name));
    checa('e carrega o campo da imobiliária', 'real_estate_name' in corpo, JSON.stringify(Object.keys(corpo)));
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== E ELE NÃO SE DESVINCULA ==');
  {
    const { b, p, erros } = await abrirComo('crm.html', CORRETOR, ['crm']);
    await p.evaluate(() => { const l = G.leads[0]; if (l) openLead(l.id); });
    await p.waitForTimeout(600);
    checa('no dossiê, o corretor é somente leitura',
      await p.evaluate(() => document.getElementById('e-broker').readOnly));
    checa('e a imobiliária também',
      await p.evaluate(() => document.getElementById('e-imob').readOnly));

    // Mesmo que alguém force o campo pelo console, o que a tela MANDA continua
    // sendo o nome dele. É a segunda barreira; a primeira é o gatilho no banco.
    await p.evaluate(() => {
      const el = document.getElementById('e-broker');
      el.readOnly = false; el.value = 'Outro Corretor';
    });
    await p.evaluate(() => saveLead());
    await p.waitForTimeout(700);
    const patch = await p.evaluate(() =>
      (window.__POSTS || []).find(x => /a1_cases/.test(x.url) && x.m === 'PATCH'));
    const corpo = patch ? JSON.parse(patch.body) : {};
    checa('a tela não pede ao banco o que ele vai recusar',
      corpo.broker_name === 'Ana Souza', JSON.stringify(corpo.broker_name));
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== O GESTOR TEM O PODER ==');
  {
    const { b, p, erros } = await abrirComo('crm.html', GESTOR, ['crm']);
    await p.evaluate(() => { const l = G.leads[0]; if (l) openLead(l.id); });
    await p.waitForTimeout(600);
    checa('o gestor escolhe o corretor',
      !(await p.evaluate(() => document.getElementById('e-broker').readOnly)));
    checa('e transfere de imobiliária',
      !(await p.evaluate(() => document.getElementById('e-imob').readOnly)));
    await p.evaluate(() => { document.getElementById('e-broker').value = 'Carla Dias'; });
    await p.evaluate(() => saveLead());
    await p.waitForTimeout(700);
    const patch = await p.evaluate(() =>
      (window.__POSTS || []).find(x => /a1_cases/.test(x.url) && x.m === 'PATCH'));
    const corpo = patch ? JSON.parse(patch.body) : {};
    checa('a transferência é enviada ao banco', corpo.broker_name === 'Carla Dias',
      JSON.stringify(corpo.broker_name));
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros) ? 1 : 0);
})();
