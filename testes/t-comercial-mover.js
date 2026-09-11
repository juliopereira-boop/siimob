// Mover cartão no quadro do Comercial.
//
// O relato do dono: "no Repasse eu arrasto o cartão de uma coluna para outra e
// funciona; no Comercial o cartão não se move". Não era permissão nem esteira —
// o quadro do Comercial nasceu SÓ DE LEITURA. O cartão não tinha `draggable`, a
// coluna não tinha `ondrop`, e mover só existia enterrado no rodapé do dossiê.
// Arrastar não dava erro nenhum, e é isso que travava: não havia o que
// consertar, porque não havia sintoma.
//
// Este arquivo prova as cinco coisas que precisam ser verdade juntas:
//
//   1. o quadro arrasta, e o arrasto chama a ESTEIRA (rpc a1_co_transicionar),
//      nunca um PATCH em situacao_id — que o gatilho do banco recusa;
//   2. a resposta é conferida. É o defeito que repasse.html já teve: o banco
//      recusava, a tela desenhava o cartão na coluna nova e mentia para o
//      gestor até alguém recarregar a página;
//   3. a tela não inventa caminho: só as arestas de a1_co_transicoes valem, e
//      quando não vale a mensagem diz PARA ONDE dá para ir;
//   4. p_versao_esperada vai junto, e quando ela fica para trás a tela recarrega
//      o estado em vez de mandar o usuário recarregar;
//   5. a permissão certa é co_editar — e o falso positivo mora aqui: para o
//      corretor com co_editar:false NÃO mover é o comportamento correto. Por
//      isso cada verificação vem em par.
//
// Sobre o andaime: o dublê de Supabase da suíte (testes/fake.js) responde
// SEMPRE {ok:true} para a1_co_transicionar e não mexe em linha nenhuma. Com ele
// nada distinguiria "a esteira aceitou" de "a tela fingiu", que é exatamente o
// defeito nº 2. Por isso este arquivo traz o seu próprio a1_co_transicionar,
// com as mesmas recusas da função real (nao_encontrado, sem_permissao,
// versao_desatualizada, transicao_nao_permitida, contrato_nao_assinado) e
// gravando de verdade a situação e a versão.
const { chromium } = require('playwright');
const { responder, liberarModulos } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';

// Três situações e UMA aresta: Proposta → Contrato assinado. Distrato existe na
// esteira e não tem aresta entrada nenhuma — é o destino que a tela não pode
// inventar. Sem essa terceira coluna o teste de "não inventa caminho" passaria
// de graça, porque não haveria para onde errar.
function cenario(opc = {}) {
  return {
    situacoes: [
      { id:'cs1', tenant_id:'t1', nome:'Proposta',           ordem:0, cor:'#6366f1', sla_horas:24,   ativo:true },
      { id:'cs2', tenant_id:'t1', nome:'Contrato assinado '+XSS, ordem:1, cor:'#22c55e', sla_horas:null, ativo:true },
      { id:'cs3', tenant_id:'t1', nome:'Distrato',           ordem:2, cor:'#dc2626', sla_horas:null, ativo:true }
    ],
    transicoes: [
      { id:'ct1', tenant_id:'t1', de_id:'cs1', para_id:'cs2', papeis:[],
        requisitos: opc.exigeContrato ? { contrato_assinado:true } : {},
        acao:null, acao_modo:null, ativo:true }
    ],
    comerciais: [
      { id:'co1', tenant_id:'t1', codigo:'CO-001', pre_analise_id:'pa3', empreendimento_id:'d1',
        unidade:'101', corretor_id:'p3', situacao_id:'cs1', versao: opc.versaoNoBanco || 1,
        situacao_em:new Date(Date.now()-2*36e5).toISOString(), proposta:{}, repasse_case_id:null,
        criado_em:new Date(Date.now()-5*864e5).toISOString(),
        origem_snapshot:{ capturado_em:'2026-08-22T10:00:00Z',
          pre_analise:{ id:'pa3', codigo:'PA-003', unidade:'101' },
          credito:{ versao:1, valor_total:24000000 },
          participantes:[{ pessoa_id:'pe1', nome:'Maria Titular '+XSS, papel:'TITULAR', renda_analisada:450000 }] } }
    ]
  };
}

const recusa = codigo => ({ status:400,
  body:{ code:'P0001', message:codigo, details:null, hint:null } });

// O orquestrador de mentira, com as mesmas recusas do a1_co_transicionar real.
function transicionar(est, corpo, opc) {
  const co = est.comerciais.find(c => c.id === corpo.p_comercial);
  if (!co) return recusa('nao_encontrado');
  if (opc.semPermissaoNoBanco) return recusa('sem_permissao');
  if (corpo.p_versao_esperada != null && corpo.p_versao_esperada !== co.versao)
    return recusa('versao_desatualizada');
  const tr = est.transicoes.find(t => t.ativo && t.para_id === corpo.p_para &&
    (t.de_id === null || t.de_id === co.situacao_id));
  if (!tr) return recusa('transicao_nao_permitida');
  if (tr.requisitos && tr.requisitos.contrato_assinado && !opc.contratoAssinado)
    return recusa('contrato_nao_assinado');
  co.situacao_id = corpo.p_para;
  co.versao += 1;
  co.situacao_em = new Date().toISOString();
  return { status:200, body:{ ok:true, situacao_id:corpo.p_para, repasse_case_id:null } };
}

async function abrir(opc = {}) {
  const est = opc.estado || cenario(opc);
  liberarModulos(['COMERCIAL']);
  const usuario = opc.usuario ||
    { id:'u1', tenant_id:'t1', name:'Julio', role:'owner', cpf:'99999999999' };
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{ width:1400, height:950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  // O 400 do PostgREST é o assunto desta suíte — metade das verificações existe
  // justamente para provar que a tela trata a recusa. Contá-lo como erro de JS
  // reprovaria o teste por ele estar fazendo o que deve.
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
  }, usuario);
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url();
    const devolve = (corpo, status) => r.fulfill({ status: status || 200,
      contentType:'application/json', headers:{'content-range':'0-1/'+(Array.isArray(corpo)?corpo.length:1)},
      body: JSON.stringify(corpo) });

    if (u.includes('/rpc/a1_co_transicionar')) {
      let corpo = {}; try { corpo = JSON.parse(req.postData() || '{}'); } catch {}
      const rr = transicionar(est, corpo, opc);
      return devolve(rr.body, rr.status);
    }
    // O cadastro que a tela relê em a1RefreshPartnerPerms.
    if (/a1_partners\?id=eq\./.test(u) && usuario.role === 'partner')
      return devolve([{ permissions: usuario.permissions, type: usuario.type || 'corretor', perfil_id:null }]);
    if (u.includes('/rest/v1/a1_co_situacoes'))  return devolve(est.situacoes);
    if (u.includes('/rest/v1/a1_co_transicoes')) return devolve(est.transicoes);
    if (u.includes('/rest/v1/a1_comerciais'))    return devolve(est.comerciais);

    let d; try { d = responder(u, req.method(), req.postData()); } catch { d = []; }
    return devolve(d);
  });
  await p.goto(BASE + '/comercial.html', { waitUntil:'load' });
  await p.waitForTimeout(1600);
  return { b, p, erros, est };
}

// Arrasto de verdade do ponto de vista da página: dragstart no cartão, dragover
// e drop na coluna, com um DataTransfer real. É o que o navegador dispara.
const arrastar = (p, idCartao, idColuna) => p.evaluate(([cid, col]) => {
  const card = document.querySelector(`.co-card[data-id="${cid}"]`);
  const alvo = document.querySelector(`.k-col-body[data-situacao-id="${col}"]`);
  if (!card || !alvo) return 'sem cartão ou sem coluna';
  const dt = new DataTransfer();
  card.dispatchEvent(new DragEvent('dragstart', { bubbles:true, cancelable:true, dataTransfer:dt }));
  alvo.dispatchEvent(new DragEvent('dragover',  { bubbles:true, cancelable:true, dataTransfer:dt }));
  alvo.dispatchEvent(new DragEvent('drop',      { bubbles:true, cancelable:true, dataTransfer:dt }));
  card.dispatchEvent(new DragEvent('dragend',   { bubbles:true, cancelable:true, dataTransfer:dt }));
  return 'ok';
}, [idCartao, idColuna]);

// Em que coluna o cartão ESTÁ desenhado, pelo nome do titular — não pela
// contagem. Contagem apodrece; "Maria Titular está embaixo de Proposta" segue
// dizendo a verdade.
const colunaDoCartao = (p, titulo) => p.evaluate(t => {
  for (const col of document.querySelectorAll('.k-col')) {
    const corpo = col.querySelector('.k-col-body');
    if (corpo && corpo.innerText.includes(t))
      return col.querySelector('.k-col-header span').textContent.trim();
  }
  return '(nenhuma)';
}, titulo);

const transicoesPedidas = p => p.evaluate(() =>
  window.__POSTS.filter(x => x.url.includes('a1_co_transicionar')).map(x => JSON.parse(x.body)));
const patchesDeSituacao = p => p.evaluate(() =>
  window.__POSTS.filter(x => x.m === 'PATCH' && /situacao_id/.test(x.body || '')).map(x => x.url));
const avisos = p => p.evaluate(() => document.getElementById('toast-wrap').innerText);

const CORRETOR = perms => ({ id:'p3', tenant_id:'t1', name:'Ana Souza', role:'partner',
  type:'corretor', cpf:'33333333333', permissions: perms });

(async () => {
  const todosErros = [];

  // ── 1. O relato, exatamente: o gestor arrasta e o cartão anda ────────────
  console.log('\nO gestor arrasta o cartão de uma coluna para a outra');
  {
    const { b, p, erros, est } = await abrir();
    checa('o cartão do quadro nasce arrastável',
      await p.evaluate(() => { const c = document.querySelector('.co-card[data-id="co1"]');
        return !!c && c.getAttribute('draggable') === 'true'; }));
    checa('a coluna aceita soltar',
      await p.evaluate(() => { const c = document.querySelector('.k-col-body[data-situacao-id="cs2"]');
        return !!c && !!c.getAttribute('ondrop') && !!c.getAttribute('ondragover'); }));
    checa('antes de arrastar, o cartão está em Proposta',
      (await colunaDoCartao(p, 'Maria Titular')) === 'Proposta');

    await arrastar(p, 'co1', 'cs2');
    await p.waitForTimeout(900);

    const pedidos = await transicoesPedidas(p);
    checa('arrastar chamou a esteira (a1_co_transicionar)', pedidos.length === 1,
      JSON.stringify(pedidos));
    checa('mandou o negócio e o destino certos',
      !!pedidos[0] && pedidos[0].p_comercial === 'co1' && pedidos[0].p_para === 'cs2',
      JSON.stringify(pedidos[0]));
    checa('mandou p_versao_esperada (trava otimista)',
      !!pedidos[0] && pedidos[0].p_versao_esperada === 1, JSON.stringify(pedidos[0]));
    checa('não deu PATCH direto em situacao_id (o gatilho recusaria)',
      (await patchesDeSituacao(p)).length === 0);
    checa('o banco registrou a mudança e subiu a versão',
      est.comerciais[0].situacao_id === 'cs2' && est.comerciais[0].versao === 2,
      JSON.stringify(est.comerciais[0].situacao_id) + ' v' + est.comerciais[0].versao);
    checa('o cartão passou a ser desenhado em Contrato assinado',
      (await colunaDoCartao(p, 'Maria Titular')).startsWith('Contrato assinado'),
      await colunaDoCartao(p, 'Maria Titular'));
    checa('nada de XSS', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros); await b.close();
  }

  // ── 2. O outro lado do par: recusa do banco não pode virar cartão movido ──
  console.log('\nQuando a esteira recusa, o cartão NÃO se move e a tela diz o porquê');
  {
    // Mesma transição desenhada, mas com o requisito do cliente ligado e sem
    // contrato assinado: o banco devolve contrato_nao_assinado.
    const { b, p, erros, est } = await abrir({ exigeContrato:true });
    await arrastar(p, 'co1', 'cs2');
    await p.waitForTimeout(900);
    checa('a esteira foi chamada', (await transicoesPedidas(p)).length === 1);
    checa('o banco continua com o negócio em Proposta', est.comerciais[0].situacao_id === 'cs1');
    checa('o cartão continua desenhado em Proposta — a tela não mentiu',
      (await colunaDoCartao(p, 'Maria Titular')) === 'Proposta',
      await colunaDoCartao(p, 'Maria Titular'));
    const t = await avisos(p);
    checa('o aviso explica a exigência', t.includes('exige contrato assinado'), t);
    checa('e diz o que fazer', /aba Contrato/.test(t), t);
    todosErros.push(...erros); await b.close();
  }

  // ── 3. A tela não inventa caminho ────────────────────────────────────────
  console.log('\nSó as arestas da esteira do cliente valem');
  {
    const { b, p, erros, est } = await abrir();
    await arrastar(p, 'co1', 'cs3');          // Distrato: nenhuma aresta chega lá
    await p.waitForTimeout(700);
    checa('soltar num destino sem aresta não chama a esteira',
      (await transicoesPedidas(p)).length === 0);
    checa('e não muda nada no banco', est.comerciais[0].situacao_id === 'cs1');
    const t = await avisos(p);
    checa('o aviso nomeia as duas situações', t.includes('Proposta') && t.includes('Distrato'), t);
    checa('o aviso diz PARA ONDE dá para ir', t.includes('Daqui dá para ir a: Contrato assinado'), t);
    todosErros.push(...erros); await b.close();
  }

  // ── 4. Trava otimista: a tela recarrega o estado, não empurra a conta ────
  console.log('\nVersão desatualizada recarrega a tela com a verdade');
  {
    // O banco já está na versão 7 (alguém moveu o negócio noutra aba); a tela
    // carregou com o que o servidor mandou e vai mandar essa versão de volta.
    // Para provar o recarregamento, o servidor "anda" com o negócio no meio.
    const est = cenario({ versaoNoBanco:1 });
    const { b, p, erros } = await abrir({ estado:est });
    await p.evaluate(() => { });
    est.comerciais[0].situacao_id = 'cs2';    // outra pessoa moveu
    est.comerciais[0].versao = 7;
    await arrastar(p, 'co1', 'cs2');
    await p.waitForTimeout(1000);
    const t = await avisos(p);
    checa('avisa que alguém alterou o negócio', t.includes('Alguém alterou este negócio'), t);
    checa('a tela já recarregou sozinha, em vez de pedir', t.includes('A tela foi recarregada'), t);
    checa('e passa a mostrar a situação verdadeira',
      (await colunaDoCartao(p, 'Maria Titular')).startsWith('Contrato assinado'),
      await colunaDoCartao(p, 'Maria Titular'));
    todosErros.push(...erros); await b.close();
  }

  // ── 5. A permissão certa é co_editar, e o par prova os dois lados ────────
  console.log('\nMover no Comercial segue co_editar');
  {
    const { b, p, erros, est } = await abrir({ usuario: CORRETOR({ co_ver:true }) });
    checa('corretor sem co_editar: o cartão não ganha a mãozinha de arrastar',
      await p.evaluate(() => { const c = document.querySelector('.co-card[data-id="co1"]');
        return !!c && !c.classList.contains('arrastavel'); }));
    await arrastar(p, 'co1', 'cs2');
    await p.waitForTimeout(700);
    checa('e o arrasto não chega na esteira', (await transicoesPedidas(p)).length === 0);
    checa('o banco não mudou', est.comerciais[0].situacao_id === 'cs1');
    const t = await avisos(p);
    checa('o aviso nomeia a permissão que falta',
      t.includes('Editar proposta e mover na esteira'), t);
    todosErros.push(...erros); await b.close();
  }
  {
    const { b, p, erros, est } = await abrir({ usuario: CORRETOR({ co_ver:true, co_editar:true }) });
    checa('corretor COM co_editar: o cartão ganha a mãozinha de arrastar',
      await p.evaluate(() => { const c = document.querySelector('.co-card[data-id="co1"]');
        return !!c && c.classList.contains('arrastavel'); }));
    await arrastar(p, 'co1', 'cs2');
    await p.waitForTimeout(900);
    checa('e o negócio anda de verdade', est.comerciais[0].situacao_id === 'cs2');
    todosErros.push(...erros); await b.close();
  }
  {
    // O caminho do dono: gestor admin passa por a1_e_gestor() no banco e por
    // ehGestor() na tela — nenhuma das seis chaves do cadastro o limita.
    const { b, p, erros, est } = await abrir({ usuario:
      { id:'u2', tenant_id:'t1', name:'Gestora', role:'admin', cpf:'11111111111' } });
    checa('gestor admin arrasta',
      await p.evaluate(() => { const c = document.querySelector('.co-card[data-id="co1"]');
        return !!c && c.classList.contains('arrastavel') && c.getAttribute('draggable') === 'true'; }));
    await arrastar(p, 'co1', 'cs2');
    await p.waitForTimeout(900);
    checa('e o negócio anda', est.comerciais[0].situacao_id === 'cs2');
    todosErros.push(...erros); await b.close();
  }

  // ── 6. O rodapé do dossiê continua funcionando pelo mesmo caminho ────────
  console.log('\nO seletor do dossiê usa a mesma esteira');
  {
    const { b, p, erros, est } = await abrir();
    await p.evaluate(() => { window.prompt = () => null; abrirDossie('co1'); });
    await p.waitForTimeout(500);
    checa('o seletor oferece só o destino desenhado',
      await p.evaluate(() => { const s = document.getElementById('dos-mover');
        return s.options.length === 1 && s.options[0].value === 'cs2'; }));
    await p.evaluate(() => moverSituacao());
    await p.waitForTimeout(900);
    checa('moveu pelo rodapé também', est.comerciais[0].situacao_id === 'cs2');
    checa('o dossiê fechou depois do sucesso',
      await p.evaluate(() => document.getElementById('modal-dossie').classList.contains('hidden')));
    checa('nada de XSS', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros); await b.close();
  }

  process.exit(resumo(todosErros));
})();
