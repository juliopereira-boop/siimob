// Os três campos de vínculo — empresa correspondente, usuário correspondente e
// analista — na Venda e no Registro. E a conferência do Registro contra o banco.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// 1. O dono quer as MESMAS três pessoas vinculadas em todo módulo (menos Lead),
//    e vinculadas por ID, não por texto. O Repasse liga parceiro ao processo por
//    `broker_name` / `manager_name` — texto — e foi assim que três analistas da
//    S T passaram a enxergar zero processos quando a regra "só o seu" entrou:
//    divergência de grafia. Desenhar o seletor na tela não resolve nada; o que
//    resolve é o id chegar ao banco. Por isso metade das verificações daqui olha
//    o CORPO da requisição, não o que aparece na tela.
//
// 2. O Registro estava quebrado em silêncio. `registro.html` pedia
//    `a1_cases?archived=eq.false` e dava `PATCH {archived:true}` — e a coluna
//    `archived` NÃO EXISTE em `a1_cases` (conferido em produção, 11/09/2026).
//    O PostgREST devolve 400; a tela fazia `.catch(()=>[])` na leitura e nem
//    olhava a resposta da escrita. Resultado: quadro sempre vazio, e "Arquivado."
//    dito ao gestor enquanto nada foi arquivado. Nenhum cliente tem a licença do
//    Registro hoje, então o defeito nunca apareceu — e é exatamente por isso que
//    este é o melhor momento para acertá-lo.
//
// O cenário do Registro roda nas DUAS realidades — com e sem a coluna — porque
// só o par prova alguma coisa: com ela, a tela funciona; sem ela, a tela diz o
// que fazer em vez de mostrar uma lista vazia que parece "ainda não tem nada".
//
// Sobre o roteamento de analistas: ele ainda NÃO EXISTE. A tela nasce com a
// trava desligada, e o teste liga a trava pela mesma função que o roteamento vai
// ligar um dia. Sem isso, "deixei preparado" seria uma frase, não um fato.
const { chromium } = require('playwright');
const { responder, liberarModulos, negarModulos, D } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';

const GESTOR = { id:'u1', tenant_id:'t1', name:'Julio', role:'owner', cpf:'99999999999' };

// ─── Cenário do Registro ─────────────────────────────────────────────────────
// Duas etapas e dois processos. O nome e o CPF do primeiro carregam a carga de
// XSS: o CPF entrava em innerHTML E dentro de um onclick sem escapar nenhum dos
// dois, e é texto que o gestor digita — ou seja, alcançável de verdade.
function cenarioRegistro() {
  return {
    stages: [
      { id:'rs1', tenant_id:'t1', module_key:'registro', name:'Protocolo '+XSS, color:'#3D5CC8',
        position:1, is_initial:true, is_final:false },
      { id:'rs2', tenant_id:'t1', module_key:'registro', name:'Registrado', color:'#16a34a',
        position:2, is_initial:false, is_final:true }
    ],
    cases: [
      { id:'rc1', tenant_id:'t1', module_key:'registro', stage_id:'rs1', stage_name:'Protocolo',
        client_name:'Maria Registro '+XSS, client_cpf:'529"982'+XSS, development:'Residencial das Flores',
        unit:'101', block:'B1', contract_value:250000, manager_name:'João Analista',
        observations:'obs', is_new:true, archived:false,
        empresa_id:null, correspondente_id:null, analista_id:null,
        created_at:'2026-08-01T10:00:00Z', updated_at:'2026-09-01T10:00:00Z',
        stage_entered_at:'2026-08-01T10:00:00Z', payload:{ banco_name:'Caixa', cartorio_name:'1º RI' } },
      { id:'rc2', tenant_id:'t1', module_key:'registro', stage_id:'rs2', stage_name:'Registrado',
        client_name:'Pedro Registro', client_cpf:'11144477735', development:'Parque das Águas',
        is_new:false, archived:false, empresa_id:'e1', correspondente_id:'p8', analista_id:'p2',
        created_at:'2026-07-01T10:00:00Z', updated_at:'2026-09-01T10:00:00Z',
        stage_entered_at:'2026-07-01T10:00:00Z', payload:{} }
    ]
  };
}

// O 400 que o PostgREST devolve quando a coluna não existe. Dois formatos, e os
// dois acontecem: 42703 quando a coluna vem no FILTRO (a leitura da listagem),
// PGRST204 quando vem no CORPO (o PATCH de arquivar).
const semColunaNoFiltro = { code:'42703', message:'column a1_cases.archived does not exist',
                            details:null, hint:null };
const semColunaNoCorpo  = { code:'PGRST204',
                            message:"Could not find the 'archived' column of 'a1_cases' in the schema cache",
                            details:null, hint:null };

async function abrirRegistro(opc = {}) {
  const est = opc.estado || cenarioRegistro();
  // 'nao' = a coluna existe (o mundo depois do SQL);
  // 'tudo' = não existe (o mundo de hoje: leitura e escrita recusadas);
  // 'escrita' = só o PATCH recusa — serve para provar o cartão que não pode sumir
  //             da tela sem o banco ter confirmado.
  const quebrado = opc.quebrado || 'nao';
  liberarModulos([]);
  negarModulos(opc.semModulos || []);
  const pedidos = [];          // fora da página: sobrevive a redirecionamento

  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{ width:1400, height:950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  // O 400 do PostgREST é METADE do assunto desta suíte. Contá-lo como erro de JS
  // reprovaria o teste justamente por ele estar fazendo o que deve.
  p.on('console', m => { const t = m.text();
    if (m.type()==='error' &&
        !/ERR_CONNECTION|ERR_TUNNEL|fonts\.g|favicon|net::|Failed to load resource/.test(t))
      erros.push('console: '+t); });
  await p.addInitScript(u => {
    localStorage.setItem('a1_token','tok'); localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify(u));
    window.__XSS = 0; window.__POSTS = [];
    window.confirm = () => true;          // arquivar pergunta antes; aqui a resposta é sim
    const f = window.fetch;
    window.fetch = function(url, o){
      if (o && o.method && o.method !== 'GET') window.__POSTS.push({ url:String(url), m:o.method, body:o.body });
      return f.apply(this, arguments);
    };
  }, opc.usuario || GESTOR);
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url(), metodo = req.method();
    pedidos.push({ url:u, m:metodo });
    const devolve = (corpo, status) => r.fulfill({ status: status || 200,
      contentType:'application/json',
      headers:{ 'content-range':'0-1/'+(Array.isArray(corpo)?corpo.length:1) },
      body: JSON.stringify(corpo) });

    if (u.includes('/rest/v1/a1_stages') && u.includes('module_key=eq.registro'))
      return devolve(est.stages);
    if (u.includes('/rest/v1/a1_cases')) {
      if (quebrado === 'tudo' && /archived/.test(u)) return devolve(semColunaNoFiltro, 400);
      if (metodo === 'PATCH') {
        if (quebrado !== 'nao' && /"archived"/.test(req.postData() || ''))
          return devolve(semColunaNoCorpo, 400);
        return devolve([{ id:'ok' }]);
      }
      if (metodo === 'POST') {
        let corpo = {}; try { corpo = JSON.parse(req.postData() || '{}'); } catch {}
        return devolve([ Object.assign({ id:'rc-novo' }, corpo) ]);
      }
      return devolve(est.cases);
    }
    if (u.includes('/rest/v1/a1_events')) return devolve([]);

    let d; try { d = responder(u, metodo, req.postData()); } catch { d = []; }
    return devolve(d);
  });
  await p.goto(BASE + '/' + (opc.pagina || 'registro.html'), { waitUntil:'load' });
  await p.waitForTimeout(1400);
  return { b, p, erros, est, pedidos };
}

async function abrirVenda(opc = {}) {
  liberarModulos(['COMERCIAL']);
  negarModulos([]);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{ width:1400, height:950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  p.on('console', m => { const t = m.text();
    if (m.type()==='error' &&
        !/ERR_CONNECTION|ERR_TUNNEL|fonts\.g|favicon|net::|Failed to load resource/.test(t))
      erros.push('console: '+t); });
  await p.addInitScript(u => {
    localStorage.setItem('a1_token','tok'); localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify(u));
    window.__XSS = 0; window.__POSTS = [];
    const f = window.fetch;
    window.fetch = function(url, o){
      if (o && o.method && o.method !== 'GET') window.__POSTS.push({ url:String(url), m:o.method, body:o.body });
      return f.apply(this, arguments);
    };
  }, opc.usuario || GESTOR);
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url();
    const devolve = corpo => r.fulfill({ status:200, contentType:'application/json',
      headers:{ 'content-range':'0-1/'+(Array.isArray(corpo)?corpo.length:1) },
      body: JSON.stringify(corpo) });
    if (/a1_partners\?id=eq\./.test(u) && (opc.usuario||GESTOR).role === 'partner')
      return devolve([{ permissions:(opc.usuario||GESTOR).permissions,
                        type:(opc.usuario||GESTOR).type || 'corretor', perfil_id:null }]);
    if (req.method() === 'PATCH' && u.includes('a1_comerciais')) return devolve([{ id:'co1' }]);
    let d; try { d = responder(u, req.method(), req.postData()); } catch { d = []; }
    return devolve(d);
  });
  await p.goto(BASE + '/comercial.html', { waitUntil:'load' });
  await p.waitForTimeout(1500);
  return { b, p, erros };
}

// O que um <select> oferece, por TEXTO. Contar opções apodrece no dia em que
// alguém cadastra mais um analista; "oferece João Analista" continua verdade.
const opcoesDe = (p, id) => p.evaluate(i => {
  const s = document.getElementById(i);
  return s ? [...s.options].map(o => o.textContent.trim()) : null;
}, id);

// Um passo que só funciona se o campo existir. Quando ele não existe, isto
// REPROVA dizendo o quê — em vez de derrubar o processo e levar junto todas as
// verificações seguintes, que é como uma suíte perde o resto do que tinha a
// dizer logo na primeira falha.
async function passo(p, nome, fn) {
  try { await p.evaluate(fn); return true; }
  catch (e) { checa(nome, false, String(e.message).split('\n')[0].slice(0,140)); return false; }
}

// Filtra pelo MÉTODO também: logo depois de criar, a tela manda um PATCH
// (is_new:false) na mesma tabela, e pegar só "o último da url" devolvia esse
// PATCH em vez do POST que se quer conferir.
const corpoDo = (p, filtro, metodo) => p.evaluate(([f, m]) => {
  const r = window.__POSTS.filter(x => x.url.includes(f) && (!m || x.m === m));
  return r.length ? JSON.parse(r[r.length-1].body) : null;
}, [filtro, metodo]);

(async () => {
  const todosErros = [];

  // ══════════════════════════════════════════════════════════════════════════
  // VENDA
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\nVenda — os três campos existem, são alimentados pelo cadastro do cliente');
  {
    const { b, p, erros } = await abrirVenda();
    await p.evaluate(() => abrirDossie('co1'));
    await p.waitForTimeout(600);

    checa('o dossiê tem empresa correspondente',
      await p.evaluate(() => !!document.getElementById('p-empresa')));
    checa('o dossiê tem usuário correspondente',
      await p.evaluate(() => !!document.getElementById('p-correspondente')));
    checa('o dossiê tem analista',
      await p.evaluate(() => !!document.getElementById('p-analista')));

    const emp = await opcoesDe(p, 'p-empresa');
    checa('empresa vem do cadastro de empresas correspondentes do cliente',
      !!emp && emp.some(t => t.includes('Empresa Corr')), JSON.stringify(emp));
    const corr = await opcoesDe(p, 'p-correspondente');
    checa('usuário correspondente vem dos parceiros type=cca',
      !!corr && corr.some(t => t.includes('Usuário Corr')), JSON.stringify(corr));
    checa('e NÃO traz corretor nem analista na mesma lista',
      !!corr && !corr.some(t => t.includes('Ana Souza') || t.includes('João Analista')),
      JSON.stringify(corr));
    const ana = await opcoesDe(p, 'p-analista');
    checa('analista vem dos parceiros type=analista',
      !!ana && ana.some(t => t.includes('João Analista')), JSON.stringify(ana));

    todosErros.push(...erros); await b.close();
  }

  console.log('\nVenda — salvar GRAVA o id dos três, e não quebra o que já existia');
  {
    const { b, p, erros } = await abrirVenda();
    await p.evaluate(() => abrirDossie('co1'));
    await p.waitForTimeout(600);
    await passo(p, 'preencher os três vínculos e salvar a proposta', () => {
      document.getElementById('p-empresa').value        = 'e1';
      document.getElementById('p-correspondente').value = 'p8';
      document.getElementById('p-analista').value       = 'p2';
      document.getElementById('p-venda').value = '260.000,00';
      salvarProposta();
    });
    await p.waitForTimeout(700);

    const corpo = await corpoDo(p, 'a1_comerciais');
    checa('o PATCH levou empresa_id', !!corpo && corpo.empresa_id === 'e1', JSON.stringify(corpo));
    checa('o PATCH levou correspondente_id', !!corpo && corpo.correspondente_id === 'p8', JSON.stringify(corpo));
    checa('o PATCH levou analista_id', !!corpo && corpo.analista_id === 'p2', JSON.stringify(corpo));
    checa('e a proposta continua indo junto (nada do que existia se perdeu)',
      !!corpo && corpo.proposta && corpo.proposta.valor_venda === 26000000, JSON.stringify(corpo));

    checa('nada de XSS', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros); await b.close();
  }

  console.log('\nVenda — o analista fica bloqueado quando o Roteamento estiver ligado');
  {
    const { b, p, erros } = await abrirVenda();
    await p.evaluate(() => abrirDossie('co1'));
    await p.waitForTimeout(600);
    checa('com o roteamento DESLIGADO (como nasce) o analista é editável',
      await p.evaluate(() => { const e = document.getElementById('p-analista'); return !!e && !e.disabled; }));
    checa('a trava nasce desligada',
      await p.evaluate(() => typeof roteamentoDeAnalistasAtivo === 'function'
                          && roteamentoDeAnalistasAtivo() === false));

    // Liga a trava pela mesma função que o roteamento vai ligar um dia.
    await passo(p, 'ligar a trava e redesenhar o dossiê',
      () => { window.roteamentoDeAnalistasAtivo = () => true; renderDossie(); });
    await p.waitForTimeout(300);
    checa('ligado, o campo de analista fica BLOQUEADO',
      await p.evaluate(() => { const e = document.getElementById('p-analista'); return !!e && e.disabled === true; }));
    checa('e a tela diz por quê (quem escolhe é o roteamento)',
      (await p.evaluate(() => document.getElementById('dos-body').innerText)).toLowerCase().includes('roteamento'));
    checa('os outros dois continuam editáveis',
      await p.evaluate(() => { const a = document.getElementById('p-empresa'),
                                     c = document.getElementById('p-correspondente');
                               return !!a && !a.disabled && !!c && !c.disabled; }));
    todosErros.push(...erros); await b.close();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REGISTRO — os três campos
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\nRegistro — os três campos no formulário de novo processo');
  {
    const { b, p, erros } = await abrirRegistro();
    await p.evaluate(() => openNewModal());
    await p.waitForTimeout(300);

    const emp = await opcoesDe(p, 'n-empresa');
    checa('novo processo oferece empresa correspondente',
      !!emp && emp.some(t => t.includes('Empresa Corr')), JSON.stringify(emp));
    const corr = await opcoesDe(p, 'n-correspondente');
    checa('novo processo oferece usuário correspondente',
      !!corr && corr.some(t => t.includes('Usuário Corr')), JSON.stringify(corr));
    const ana = await opcoesDe(p, 'n-analista');
    checa('novo processo oferece analista',
      !!ana && ana.some(t => t.includes('João Analista')), JSON.stringify(ana));

    await passo(p, 'preencher o novo processo com os três vínculos e criar', () => {
      document.getElementById('n-name').value           = 'Cliente Novo';
      document.getElementById('n-phone').value          = '11988887777';
      document.getElementById('n-empresa').value        = 'e1';
      document.getElementById('n-correspondente').value = 'p8';
      document.getElementById('n-analista').value       = 'p2';
      createCase();
    });
    await p.waitForTimeout(700);

    const corpo = await corpoDo(p, 'a1_cases', 'POST');
    checa('o POST gravou empresa_id', !!corpo && corpo.empresa_id === 'e1', JSON.stringify(corpo));
    checa('o POST gravou correspondente_id', !!corpo && corpo.correspondente_id === 'p8', JSON.stringify(corpo));
    checa('o POST gravou analista_id', !!corpo && corpo.analista_id === 'p2', JSON.stringify(corpo));
    checa('o telefone digitado no formulário chega ao banco (client_phone existe e era jogado fora)',
      !!corpo && corpo.client_phone === '11988887777', JSON.stringify(corpo));
    checa('e o que já existia continua indo: module_key=registro e a etapa inicial',
      !!corpo && corpo.module_key === 'registro' && corpo.stage_id === 'rs1', JSON.stringify(corpo));
    todosErros.push(...erros); await b.close();
  }

  console.log('\nRegistro — os três campos no dossiê do processo');
  {
    const { b, p, erros } = await abrirRegistro();
    await p.evaluate(() => openCase('rc2'));
    await p.waitForTimeout(400);

    const lido = id => p.evaluate(i => { const e = document.getElementById(i); return e ? e.value : null; }, id);
    checa('o dossiê abre com o vínculo que está gravado (empresa)', await lido('md-empresa') === 'e1');
    checa('o dossiê abre com o vínculo que está gravado (correspondente)', await lido('md-correspondente') === 'p8');
    checa('o dossiê abre com o vínculo que está gravado (analista)', await lido('md-analista') === 'p2');

    await passo(p, 'trocar o correspondente, limpar o analista e salvar', () => {
      document.getElementById('md-analista').value = '';
      document.getElementById('md-correspondente').value = 'p21';
      saveCase();
    });
    await p.waitForTimeout(700);
    const corpo = await corpoDo(p, 'a1_cases');
    checa('trocar o correspondente grava o id novo',
      !!corpo && corpo.correspondente_id === 'p21', JSON.stringify(corpo));
    checa('limpar o analista grava NULO, não string vazia (uuid não aceita "")',
      !!corpo && corpo.analista_id === null, JSON.stringify(corpo));
    checa('e o resto do processo continua sendo salvo',
      !!corpo && corpo.client_name === 'Pedro Registro', JSON.stringify(corpo));

    checa('o analista do Registro também obedece o Roteamento',
      await p.evaluate(() => {
        window.roteamentoDeAnalistasAtivo = () => true;
        openCase('rc2');
        const e = document.getElementById('md-analista');
        return !!e && e.disabled === true;
      }));
    todosErros.push(...erros); await b.close();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REGISTRO — o que estava quebrado em silêncio
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\nRegistro — com a coluna `archived` no banco, tudo anda');
  {
    const { b, p, erros } = await abrirRegistro();
    checa('o quadro desenha os processos',
      (await p.evaluate(() => document.getElementById('rg-kanban').innerText)).includes('Maria Registro'));
    checa('os filtros do quadro nascem preenchidos com o cadastro (regra: cadastro reflete no filtro)',
      (await opcoesDe(p, 'rg-filter-empr') || []).some(t => t.includes('Residencial das Flores')));
    checa('o filtro de etapas da listagem também',
      (await opcoesDe(p, 'rg-list-stage') || []).some(t => t.includes('Protocolo')));
    checa('nada de XSS no quadro nem na listagem', await p.evaluate(() => window.__XSS) === 0);

    await p.evaluate(() => openCase('rc1'));
    await p.waitForTimeout(300);
    await p.evaluate(() => archiveCase());
    await p.waitForTimeout(600);
    checa('arquivar tira o processo do quadro',
      !(await p.evaluate(() => document.getElementById('rg-kanban').innerText)).includes('Maria Registro'));
    todosErros.push(...erros); await b.close();
  }

  console.log('\nRegistro — SEM a coluna `archived`, a tela diz o que fazer em vez de mentir');
  {
    const { b, p, erros } = await abrirRegistro({ quebrado:'tudo' });
    const tela = await p.evaluate(() => document.querySelector('.main').innerText);
    checa('o quadro NÃO finge "nenhum processo": nomeia a coluna que falta',
      /archived/.test(tela), tela.slice(0,400));
    checa('e manda rodar o SQL, que é onde isso se resolve',
      /sql/i.test(tela), tela.slice(0,400));
    todosErros.push(...erros); await b.close();
  }

  console.log('\nRegistro — arquivar que o banco recusa não pode sumir com o cartão');
  {
    // Aqui a LEITURA funciona (há cartão na tela) e só o PATCH é recusado: é o
    // defeito isolado. A tela removia o cartão e dizia "Arquivado." sem olhar a
    // resposta — a mesma cicatriz do moveCard de repasse.html.
    const { b, p, erros } = await abrirRegistro({ quebrado:'escrita' });
    checa('antes de arquivar o cartão está no quadro',
      (await p.evaluate(() => document.getElementById('rg-kanban').innerText)).includes('Maria Registro'));
    await p.evaluate(() => openCase('rc1'));
    await p.waitForTimeout(300);
    await p.evaluate(() => archiveCase());
    await p.waitForTimeout(700);
    checa('o banco recusou, então o cartão CONTINUA no quadro',
      (await p.evaluate(() => document.getElementById('rg-kanban').innerText)).includes('Maria Registro'));
    const aviso = await p.evaluate(() => document.getElementById('rg-toast').innerText);
    checa('e o gestor NÃO ouve "Arquivado."', !/arquivado\./i.test(aviso), aviso);
    checa('ouve o que falta e onde resolver', /archived/.test(aviso) && /sql/i.test(aviso), aviso);
    todosErros.push(...erros); await b.close();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REGISTRO — licença
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\nRegistro sem licença: a tela não lê processo nenhum');
  {
    const { b, p, erros, pedidos } = await abrirRegistro({ semModulos:['registro','crm','repasse'] });
    checa('não pediu a1_cases para um módulo que o cliente não tem',
      !pedidos.some(x => x.url.includes('a1_cases')),
      pedidos.filter(x=>x.url.includes('a1_cases')).map(x=>x.url).join(' | '));
    checa('não pediu as etapas do registro tampouco',
      !pedidos.some(x => x.url.includes('a1_stages')),
      pedidos.filter(x=>x.url.includes('a1_stages')).map(x=>x.url).join(' | '));
    todosErros.push(...erros); await b.close();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // A LISTAGEM DO REGISTRO É GÊMEA — o que vale numa vale na outra
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\nRegistro — a listagem é cópia da outra tela e tem de andar junto');
  {
    const { b, p, erros } = await abrirRegistro({ pagina:'registro-listagem.html' });
    await p.evaluate(() => openCase('rc2'));
    await p.waitForTimeout(400);
    checa('a listagem tem os três campos no dossiê',
      await p.evaluate(() => !!document.getElementById('md-empresa')
                          && !!document.getElementById('md-correspondente')
                          && !!document.getElementById('md-analista')));
    checa('com o vínculo gravado',
      await p.evaluate(() => { const e = document.getElementById('md-analista'); return e ? e.value : null; }) === 'p2');
    checa('nada de XSS', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros); await b.close();
  }

  process.exit(resumo(todosErros));
})();
