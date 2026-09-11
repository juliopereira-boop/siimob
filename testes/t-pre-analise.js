// Os quatro defeitos relatados na tela de Pré-análise, cada um com a prova que
// falha sem a correção.
//
//   1. A imobiliária do corretor vinha em branco no assistente. Ela mora em
//      a1_partners.extra.imobiliaria_id e a tela nunca pedia essa coluna.
//   2. O gestor não tinha COMO escolher o corretor: o assistente não oferecia o
//      campo, e no dossiê o corretor era um <input disabled>.
//   3. Erro de permissão do banco virava "Você não tem permissão para isso." —
//      sem dizer QUAL permissão nem onde pedi-la.
//   4. Mover cartão não funcionava porque o arrastar nunca foi ligado neste
//      quadro: nenhum cartão era draggable e nenhuma coluna recebia o soltar.
//
// POR QUE O ANDAIME DESTE ARQUIVO PROJETA AS COLUNAS
// O Supabase de mentira devolve a linha inteira de a1_partners, ignorando o
// `select=`. Com isso, uma tela que pedisse só `id,name` continuaria enxergando
// `extra` no teste e falharia em produção — o teste passaria codificando o
// defeito como certo. Aqui a projeção é imitada, então pedir a coluna errada
// reprova.
const { chromium } = require('playwright');
const { responder, liberarModulos, D } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

const GESTOR   = { id:'u1',  tenant_id:'t1', name:'Julio', role:'owner', cpf:'99999999999' };
// Carla Dias: corretora com vínculo em extra.imobiliaria_id = 'p1' (Imob Alfa).
const CORRETOR = { id:'p10', tenant_id:'t1', name:'Carla Dias', role:'partner',
                   type:'corretor', cpf:'66666666666' };

function projetar(linhas, url){
  const sel = (url.match(/select=([^&]*)/) || [])[1];
  if (!sel) return linhas;
  const cols = decodeURIComponent(sel).split(',').map(s => s.split(':').pop().trim());
  if (cols.includes('*')) return linhas;
  return linhas.map(l => { const o = {}; for (const c of cols) if (c in l) o[c] = l[c]; return o; });
}

// opc.rotas: [{re, status, corpo}] aplicadas antes do dublê genérico — é como
// se encena a recusa do banco sem mexer no fake compartilhado.
async function abrir(opc = {}){
  const user  = opc.user || GESTOR;
  const perms = opc.perms || {};
  liberarModulos(['PRE_ANALISE']);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{ width:1400, height:950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  p.on('console', m => { const t = m.text();
    // Esta suíte encena 401 e 403 de propósito; o navegador registra cada um
    // como erro de console, e sem esta linha a prova reprovaria por provar.
    if (m.type()==='error' && !/ERR_CONNECTION|ERR_TUNNEL|fonts\.g|favicon|net::|Failed to load resource/.test(t)) erros.push('console: '+t); });
  await p.addInitScript(u => {
    localStorage.setItem('a1_token','tok'); localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify(u));
    window.__XSS = 0;
    window.__POSTS = [];
    window.prompt  = () => 'justificativa de teste';
    window.confirm = () => true;
    const f = window.fetch;
    window.fetch = function(url, o){
      if (o && o.method && o.method !== 'GET') window.__POSTS.push({url:String(url), m:o.method, body:o.body});
      return f.apply(this, arguments);
    };
  }, Object.assign({}, user, { permissions: perms }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, r => {
    const u = r.request().url();
    const responde = (status, corpo) => r.fulfill({ status, contentType:'application/json',
      headers:{'content-range':'0-1/2'}, body: JSON.stringify(corpo) });
    for (const rota of (opc.rotas || []))
      if (rota.re.test(u) && (!rota.metodo || rota.metodo === r.request().method()))
        return responde(rota.status, rota.corpo === undefined ? {} : rota.corpo);
    if (/a1_partners/.test(u) && r.request().method() === 'GET'){
      let linhas = D.partners.slice();
      const tipo = (u.match(/type=eq\.([a-z_]+)/) || [])[1];
      if (tipo) linhas = linhas.filter(x => x.type === tipo);
      const id = (u.match(/[?&]id=eq\.([a-z0-9-]+)/) || [])[1];
      if (id) linhas = linhas.filter(x => x.id === id);
      // A permissão efetiva de quem está logado é a injetada pelo teste.
      linhas = linhas.map(x => x.id === user.id
        ? Object.assign({}, x, { permissions: perms, perfil_id: null }) : x);
      return responde(200, projetar(linhas, u));
    }
    let d; try { d = responder(u, r.request().method(), r.request().postData()); } catch { d = []; }
    responde(200, d);
  });
  await p.goto(BASE + '/pre-analise.html', { waitUntil:'load' });
  await p.waitForTimeout(1700);
  return { b, p, erros };
}

const posts = (p, re, metodo) => p.evaluate(([r, m]) =>
  (window.__POSTS || []).filter(x => new RegExp(r).test(x.url) && (!m || x.m === m))
    .map(x => { try { return JSON.parse(x.body); } catch { return x.body; } }), [re.source, metodo || null]);
const avisos = p => p.evaluate(() => document.getElementById('toast-wrap').innerText);
const opcoes = async (p, sel) => (await p.locator(sel + ' option').allTextContents());
// Campo que ainda não existe não pode derrubar a suíte no meio: quem falha é a
// verificação, e as de baixo continuam dizendo o que mais está quebrado.
const existe    = async (p, sel) => (await p.locator(sel).count()) === 1;
const valorDe   = async (p, sel) => (await existe(p, sel)) ? p.inputValue(sel) : '(campo ausente)';
const travado   = async (p, sel) => (await existe(p, sel))
  ? p.$eval(sel, el => el.disabled === true || el.tagName === 'INPUT') : false;
const liberado  = async (p, sel) => (await existe(p, sel)) ? p.$eval(sel, el => el.disabled !== true) : false;
const escolher  = async (p, sel, v) => { if (await existe(p, sel)) await p.selectOption(sel, v).catch(()=>{}); };

// Leva o assistente até o fim com um titular novo.
async function preencherAssistente(p){
  await escolher(p, '#w-empr', 'd1');
  await p.evaluate(() => passoSeguinte());
  await p.waitForTimeout(250);
  await p.fill('#w-doc', '529.982.247-25');
  await p.fill('#w-nome', 'Cliente de Teste');
  await p.evaluate(() => passoSeguinte());
  await p.waitForTimeout(250);
}

(async () => {
  const todosErros = [];

  // ── 1. A imobiliária do corretor ─────────────────────────────────────────
  console.log('\n1. A imobiliária do corretor vem preenchida e não se troca');
  {
    const { b, p, erros } = await abrir({ user:CORRETOR, perms:{ pa_ver:true, pa_criar:true } });
    await p.evaluate(() => abrirAssistente());
    await p.waitForTimeout(400);
    checa('o campo vem com a imobiliária do cadastro do corretor',
      (await valorDe(p, '#w-imob')) === 'p1', 'valor=' + (await valorDe(p, '#w-imob')));
    checa('e ele não pode escolher outra', await travado(p, '#w-imob'));
    // O outro lado do par: o corretor não escolhe corretor nenhum — o processo
    // é dele por definição, e o banco reescreve corretor_id de qualquer jeito.
    checa('o corretor não vê seletor de corretor', await p.locator('#w-corretor').count() === 0);

    await preencherAssistente(p);
    await p.evaluate(() => { window.__POSTS = []; });
    await p.evaluate(() => passoSeguinte());
    await p.waitForTimeout(700);
    const corpo = (await posts(p, /a1_pre_analises/, 'POST'))[0];
    checa('e a pré-análise nasce com a imobiliária dele',
      corpo && corpo.imobiliaria_id === 'p1', JSON.stringify(corpo));
    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros); await b.close();
  }

  // ── 2. O gestor escolhe o corretor ───────────────────────────────────────
  console.log('\n2. O gestor escolhe o corretor');
  {
    const { b, p, erros } = await abrir({ user:GESTOR });
    await p.evaluate(() => abrirAssistente());
    await p.waitForTimeout(400);
    checa('o assistente oferece o seletor de corretor', await existe(p, '#w-corretor'));
    checa('e ele deixa escolher', await liberado(p, '#w-corretor'));
    const todos = await opcoes(p, '#w-corretor');
    checa('com todos os corretores do cliente',
      todos.some(t => /Carla Dias/.test(t)) && todos.some(t => /Diego Melo/.test(t)), todos.join('|'));

    // A imobiliária aperta a lista — sem zerá-la: quem não tem vínculo aparece
    // em qualquer uma, que é a situação da maioria dos cadastros de hoje.
    await escolher(p, '#w-imob', 'p20');              // Imob Recem Cadastrada
    await p.waitForTimeout(300);
    const daImob = await opcoes(p, '#w-corretor');
    checa('escolher a imobiliária traz o corretor dela', daImob.some(t => /Diego Melo/.test(t)), daImob.join('|'));
    checa('e tira o corretor da outra', !daImob.some(t => /Carla Dias/.test(t)), daImob.join('|'));
    checa('corretor sem vínculo continua na lista', daImob.some(t => /Sem Equipe/.test(t)), daImob.join('|'));

    await escolher(p, '#w-corretor', 'p11');          // Diego Melo
    await preencherAssistente(p);
    await p.evaluate(() => { window.__POSTS = []; });
    await p.evaluate(() => passoSeguinte());
    await p.waitForTimeout(700);
    const corpo = (await posts(p, /a1_pre_analises/, 'POST'))[0];
    checa('e o processo nasce no nome do corretor escolhido',
      corpo && corpo.corretor_id === 'p11', JSON.stringify(corpo));

    // No dossiê, o mesmo: o gestor redistribui a carteira.
    await p.evaluate(() => abrirDossie('pa1'));
    await p.waitForTimeout(700);
    checa('o dossiê deixa o gestor trocar o corretor', await liberado(p, '#d-corretor'));
    await escolher(p, '#d-corretor', 'p10');
    await p.evaluate(() => { window.__POSTS = []; salvarDados(); });
    await p.waitForTimeout(600);
    const patch = (await posts(p, /a1_pre_analises/, 'PATCH'))[0];
    checa('e salvar grava o corretor novo', patch && patch.corretor_id === 'p10', JSON.stringify(patch));
    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros); await b.close();
  }

  // ── 3. Erro de permissão do banco diz QUAL permissão falta ───────────────
  console.log('\n3. O 401 do banco vira uma frase que resolve o dia');
  // Quem NÃO tem a chave: a mensagem tem de nomeá-la e dizer onde pedir.
  {
    const { b, p, erros } = await abrir({
      user:CORRETOR, perms:{ pa_ver:true },          // sem pa_criar
      rotas:[{ re:/a1_pa_pessoas/, metodo:'POST', status:401,
               corpo:{ message:'permission denied for table a1_pa_pessoas' } }]
    });
    await p.evaluate(() => abrirAssistente());
    await p.waitForTimeout(400);
    await preencherAssistente(p);
    await p.evaluate(() => passoSeguinte());
    await p.waitForTimeout(800);
    const t = await avisos(p);
    checa('sem a chave: a mensagem nomeia a permissão que falta', /pa_criar/.test(t), t);
    checa('em português, não só a chave crua', /Criar pré-análise/i.test(t), t);
    checa('e diz onde pedi-la', /Configura/i.test(t), t);
    todosErros.push(...erros); await b.close();
  }

  // Quem TEM a chave e mesmo assim leva 401: a mensagem NÃO pode acusar a
  // permissão. Foi exatamente isto que aconteceu em produção — a política de
  // INSERT aceitava, quem recusava era a de SELECT no RETURNING do PostgREST,
  // e a tela mandou o dono procurar uma caixa que já estava marcada. Frase
  // confiante e errada é pior que "erro desconhecido": manda investigar o
  // lugar errado.
  {
    const { b, p, erros } = await abrir({
      user:CORRETOR, perms:{ pa_ver:true, pa_criar:true },
      rotas:[{ re:/a1_pa_pessoas/, metodo:'POST', status:401,
               corpo:{ message:'new row violates row-level security policy' } }]
    });
    await p.evaluate(() => abrirAssistente());
    await p.waitForTimeout(400);
    await preencherAssistente(p);
    await p.evaluate(() => passoSeguinte());
    await p.waitForTimeout(800);
    const t = await avisos(p);
    checa('com a chave marcada: NÃO acusa falta de permissão', /NÃO é falta da permissão/i.test(t), t);
    checa('e manda avisar o suporte em vez de mexer no cadastro', /suporte/i.test(t), t);
    todosErros.push(...erros); await b.close();
  }

  // O simétrico do de cima: corretor sem pa_editar precisa ver a chave
  // nomeada, porque para ele a permissão É o motivo e existe o que marcar.
  {
    const { b, p, erros } = await abrir({
      user:CORRETOR, perms:{ pa_ver:true },
      rotas:[{ re:/rpc\/a1_pa_transicionar/, status:403, corpo:{ message:'sem_permissao' } }] });
    await p.evaluate(() => { history.replaceState(null,'','?vista=andamento'); aplicarVista(); renderVista(); });
    await p.waitForTimeout(300);
    await p.evaluate(() => { if (typeof moverCartao === 'function') moverCartao('pa1','ps3'); });
    await p.waitForTimeout(700);
    const t = await avisos(p);
    checa('corretor sem pa_editar vê a permissão nomeada', /pa_editar/.test(t), t);
    todosErros.push(...erros); await b.close();
  }

  // ── 4. Mover cartão ──────────────────────────────────────────────────────
  console.log('\n4. Mover cartão no quadro');
  {
    const { b, p, erros } = await abrir({ user:GESTOR });
    await p.evaluate(() => { history.replaceState(null,'','?vista=andamento'); aplicarVista(); renderVista(); });
    await p.waitForTimeout(400);
    checa('os cartões do quadro são arrastáveis',
      await p.locator('.pa-card[draggable="true"]').count() > 0);
    checa('e as colunas recebem o soltar',
      await p.locator('.k-col-body[data-sit]').count() > 0);

    // O gesto de verdade: arrastar o cartão de "Em análise" para "Aprovada".
    await p.evaluate(() => { window.__POSTS = []; });
    await p.dragAndDrop('.pa-card[data-id="pa1"]', '.k-col-body[data-sit="ps3"]').catch(()=>{});
    await p.waitForTimeout(800);
    const chamadas = await posts(p, /rpc\/a1_pa_transicionar/, 'POST');
    checa('arrastar chama o orquestrador (e não um PATCH em situacao_id)',
      chamadas.length === 1, JSON.stringify(chamadas));
    checa('com a pré-análise e o destino certos',
      chamadas[0] && chamadas[0].p_pre_analise === 'pa1' && chamadas[0].p_para === 'ps3',
      JSON.stringify(chamadas[0]));
    // Sem p_versao_esperada, quem moveu por último ganha em silêncio.
    checa('e com a versão esperada', chamadas[0] && chamadas[0].p_versao_esperada === 1,
      JSON.stringify(chamadas[0]));
    const patchs = await posts(p, /a1_pre_analises\?/, 'PATCH');
    checa('nenhum PATCH direto em situacao_id', patchs.length === 0, JSON.stringify(patchs));

    // Destino que a esteira do cliente não liga: nem sai requisição, e o aviso
    // diz para onde DÁ para ir.
    await p.evaluate(() => { window.__POSTS = []; });
    await p.dragAndDrop('.pa-card[data-id="pa1"]', '.k-col-body[data-sit="ps1"]').catch(()=>{});
    await p.waitForTimeout(500);
    checa('destino sem transição não vira requisição',
      (await posts(p, /rpc\/a1_pa_transicionar/, 'POST')).length === 0);
    checa('e o aviso diz para onde dá para ir', /Aprovada|Reprovada/.test(await avisos(p)), await avisos(p));
    todosErros.push(...erros); await b.close();
  }

  // O defeito que o Repasse já teve: o banco recusa e o cartão fica movido na
  // tela até alguém recarregar. Aqui a recusa chega dos dois jeitos possíveis.
  console.log('\n4b. Recusa do banco não move o cartão');
  {
    const { b, p, erros } = await abrir({ user:GESTOR,
      rotas:[{ re:/rpc\/a1_pa_transicionar/, status:403, corpo:{ message:'sem_permissao' } }] });
    await p.evaluate(() => { history.replaceState(null,'','?vista=andamento'); aplicarVista(); renderVista(); });
    await p.waitForTimeout(300);
    await p.evaluate(() => { if (typeof moverCartao === 'function') moverCartao('pa1','ps3'); });
    await p.waitForTimeout(700);
    const t = await avisos(p);
    checa('recusa do banco não vira sucesso', !/Situação alterada/.test(t), t);
    // Quem move aqui é GESTOR, e gestor tem tudo. A mensagem certa não é
    // "falta pa_editar" — é dizer que a permissão não é o motivo, senão manda
    // o gestor procurar uma caixa que nem existe para ele.
    checa('e para o gestor a mensagem não acusa falta de permissão',
      /NÃO é falta da permissão/i.test(t), t);
    checa('o cartão continua na coluna de origem',
      await p.locator('.k-col-body[data-sit="ps2"] .pa-card[data-id="pa1"]').count() === 1);
    // A verificação acima sozinha é fraca: o quadro é redesenhado a partir do
    // servidor e voltaria ao lugar de qualquer jeito. Esta é a que pega o
    // defeito do Repasse — mover primeiro e perguntar depois.
    checa('e a tela não mexeu no estado por conta própria',
      await p.evaluate(() => (G.lista.find(x => x.id === 'pa1') || {}).situacao_id) === 'ps2');
    todosErros.push(...erros); await b.close();
  }
  {
    // 200 com {ok:false}: o orquestrador respondeu, e respondeu "não".
    const { b, p, erros } = await abrir({ user:GESTOR,
      rotas:[{ re:/rpc\/a1_pa_transicionar/, status:200,
               corpo:{ ok:false, erro:'documento_obrigatorio_faltando: RG / CNH' } }] });
    await p.evaluate(() => { history.replaceState(null,'','?vista=andamento'); aplicarVista(); renderVista(); });
    await p.waitForTimeout(300);
    await p.evaluate(() => { if (typeof moverCartao === 'function') moverCartao('pa1','ps3'); });
    await p.waitForTimeout(700);
    const t = await avisos(p);
    checa('ok:false também não vira sucesso', !/Situação alterada/.test(t), t);
    checa('e o aviso nomeia o documento que falta', /RG \/ CNH/.test(t), t);
    todosErros.push(...erros); await b.close();
  }

  // A trava que NÃO pode sumir: sem pa_editar ninguém move, e o aviso diz o
  // porquê. O "Corretor teste" do cliente de demonstração está exatamente aqui.
  console.log('\n4c. Sem pa_editar, mover continua proibido');
  {
    const { b, p, erros } = await abrir({ user:CORRETOR, perms:{ pa_ver:true, pa_criar:true, pa_editar:false } });
    await p.evaluate(() => { history.replaceState(null,'','?vista=andamento'); aplicarVista(); renderVista(); });
    await p.waitForTimeout(400);
    checa('os cartões não são arrastáveis', await p.locator('.pa-card[draggable="true"]').count() === 0);
    await p.evaluate(() => { window.__POSTS = []; if (typeof moverCartao === 'function') moverCartao('pa1','ps3'); });
    await p.waitForTimeout(500);
    checa('e chamar a mão não manda nada ao banco',
      (await posts(p, /rpc\/a1_pa_transicionar/, 'POST')).length === 0);
    checa('o aviso nomeia pa_editar', /pa_editar/.test(await avisos(p)), await avisos(p));
    todosErros.push(...erros); await b.close();
  }

  process.exit(resumo(todosErros));
})();
