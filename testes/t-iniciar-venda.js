// O botão verde "Iniciar venda" da Pré-análise, e os três campos de gente.
//
// O PEDIDO DO DONO, NAS PALAVRAS DELE
//   "só pode abrir uma venda se estiver como aprovada (...) o corretor pode
//    abrir o cartão em pré-análise e tem que ter um botão verde 'Iniciar
//    venda'. Nesse momento ele preenche mais algumas informações importantes e
//    aí se cria automaticamente o cartão em Vendas. Mas o cartão da pré-análise
//    FICA lá em pré-análise (...) o intuito é deixar registrado por onde o lead
//    passou."
//
// A verificação que mais importa deste arquivo é a última frase: depois de
// iniciar a venda, a pré-análise TEM de continuar na esteira. O motor no banco
// (a1_criar_comercial) nunca apagou nada — mas é a tela que poderia apagar, ou
// esconder, ou mover o cartão "porque agora ele virou venda". Aqui isso é
// provado por conteúdo (o código PA-004 continua na fila) e pela ausência de
// DELETE e de PATCH na tabela da pré-análise.
//
// POR QUE ESTE ARQUIVO TEM O PRÓPRIO DUBLÊ DE SUPABASE
// Igual ao de t-pre-analise.js, e pelo mesmo motivo: aqui se encena a RECUSA do
// banco (a1_pa_pode_criar_comercial devolvendo a frase do que falta), e o dublê
// compartilhado responde {ok:true} para qualquer /rpc/. Um teste que dependesse
// disso estaria provando o dublê, não a tela.
const { chromium } = require('playwright');
const { responder, liberarModulos, D } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

const GESTOR   = { id:'u1',  tenant_id:'t1', name:'Julio', role:'owner', cpf:'99999999999' };
const CORRETOR = { id:'p10', tenant_id:'t1', name:'Carla Dias', role:'partner',
                   type:'corretor', cpf:'66666666666' };

// O PostgREST devolve só as colunas pedidas. Sem imitar isso, uma tela que
// pedisse a coluna errada continuaria funcionando no teste e falharia em
// produção — foi assim que `extra` sumiu do assistente por semanas.
function projetar(linhas, url){
  const sel = (url.match(/select=([^&]*)/) || [])[1];
  if (!sel) return linhas;
  const cols = decodeURIComponent(sel).split(',').map(s => s.split(':').pop().trim());
  if (cols.includes('*')) return linhas;
  return linhas.map(l => { const o = {}; for (const c of cols) if (c in l) o[c] = l[c]; return o; });
}

async function abrir(opc = {}){
  const user  = opc.user || GESTOR;
  const perms = opc.perms || {};
  liberarModulos(opc.modulos || ['PRE_ANALISE','COMERCIAL']);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{ width:1400, height:950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  p.on('console', m => { const t = m.text();
    // As recusas de banco encenadas aqui chegam como erro de console. Sem esta
    // linha a suíte reprovaria justamente por estar provando o que deve.
    if (m.type()==='error' && !/ERR_CONNECTION|ERR_TUNNEL|fonts\.g|favicon|net::|Failed to load resource/.test(t))
      erros.push('console: ' + t); });
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
      headers:{'content-range':'0-1/2'}, body: JSON.stringify(corpo === undefined ? null : corpo) });
    for (const rota of (opc.rotas || []))
      if (rota.re.test(u) && (!rota.metodo || rota.metodo === r.request().method()))
        return responde(rota.status, rota.corpo);
    // O veredito do banco. Sem rota do teste, ele diz "pode" — que é o valor
    // real da função quando tudo está no lugar: null, e não um objeto.
    if (/rpc\/a1_pa_pode_criar_comercial/.test(u)) return responde(200, null);
    if (/a1_partners/.test(u) && r.request().method() === 'GET'){
      let linhas = D.partners.slice();
      const tipo = (u.match(/type=eq\.([a-z_]+)/) || [])[1];
      if (tipo) linhas = linhas.filter(x => x.type === tipo);
      const id = (u.match(/[?&]id=eq\.([a-z0-9-]+)/) || [])[1];
      if (id) linhas = linhas.filter(x => x.id === id);
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
const avisos  = p => p.evaluate(() => document.getElementById('toast-wrap').innerText);
const existe  = async (p, sel) => (await p.locator(sel).count()) >= 1;
const texto   = async (p, sel) => (await existe(p, sel)) ? (await p.locator(sel).first().innerText()) : '(ausente)';
const opcoes  = async (p, sel) => (await existe(p, sel)) ? p.locator(sel + ' option').allTextContents() : [];
const valorDe = async (p, sel) => (await existe(p, sel)) ? p.inputValue(sel) : '(campo ausente)';
const ligado  = async (p, sel) => (await existe(p, sel)) ? p.$eval(sel, el => el.disabled !== true) : false;
const preencher = async (p, sel, v) => { if (await existe(p, sel)) await p.fill(sel, v); };

const dossie = async (p, id) => { await p.evaluate(i => abrirDossie(i), id); await p.waitForTimeout(800); };

(async () => {
  const todosErros = [];

  // ── 1. O botão só existe onde a esteira TERMINA BEM ──────────────────────
  //
  // pa4 está numa situação de fim positivo, com titular e crédito aprovado, e
  // ainda não tem venda. pa1 está numa etapa do meio e pa3, também no fim
  // positivo, JÁ tem o comercial co1. Os três juntos é que fazem a prova valer:
  // com só o caso feliz, um botão que aparecesse sempre passaria igual.
  console.log('\n1. "Iniciar venda" aparece só no fim positivo da esteira');
  {
    const { b, p, erros } = await abrir({ user:GESTOR });

    await dossie(p, 'pa4');
    checa('no fim positivo da esteira o botão existe', await existe(p, '#btn-iniciar-venda'));
    checa('e se chama "Iniciar venda"', /Iniciar venda/i.test(await texto(p, '#btn-iniciar-venda')),
      await texto(p, '#btn-iniciar-venda'));
    // Verde, e não "a classe chamada verde": é a cor que o dono pediu e é o que
    // o olho dele vai conferir.
    const cor = await p.$eval('#btn-iniciar-venda', el => getComputedStyle(el).backgroundColor)
      .catch(() => '(ausente)');
    checa('e é verde de verdade', cor === 'rgb(22, 163, 74)', cor);
    checa('e está clicável', await ligado(p, '#btn-iniciar-venda'));

    await p.evaluate(() => fecharModal('modal-dossie'));
    await dossie(p, 'pa1');
    checa('numa etapa do meio o botão NÃO existe',
      !(await existe(p, '#btn-iniciar-venda')));
    checa('e a aba Venda explica que ele aparece no fim positivo da esteira',
      /fim/i.test(await p.evaluate(() => { trocarAbaDossie('comercial', null); return document.getElementById('dos-body').innerText; })));

    await p.evaluate(() => fecharModal('modal-dossie'));
    await dossie(p, 'pa3');
    checa('com a venda já criada o botão some',
      !(await existe(p, '#btn-iniciar-venda')));
    checa('e a tela diz que a venda já existe', /já/i.test(await texto(p, '#dos-acoes')),
      await texto(p, '#dos-acoes'));

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros); await b.close();
  }

  // ── 1a. O GATILHO É O SELO, NÃO O NOME NEM A FLAG ────────────────────────
  //
  // Esta é a verificação que o dono pediu com todas as letras: a esteira é
  // desenhada por cliente. Ele pode chamar a etapa de "Deferida", de "Crédito
  // OK" ou de qualquer coisa, e enquanto ela estiver marcada como FIM POSITIVO
  // no Editor de Workflow o gatilho tem de funcionar. Amarrar o botão ao nome
  // — ou à flag legada 'APROVADO' — é o que mata o fluxo em silêncio no dia em
  // que alguém renomeia a etapa.
  console.log('\n1a. O gatilho segue o selo, mesmo com a etapa renomeada');
  {
    const { b, p, erros } = await abrir({ user:GESTOR });
    // O cliente reconfigurou: nenhuma etapa se chama "Aprovada" e nenhuma tem a
    // flag antiga. O selo estrutural é a única coisa que restou.
    await p.evaluate(() => {
      G.temSelo = true;
      G.situacoes.forEach(s => { s.selo = null; });
      const fim = G.situacoes.find(s => s.id === 'ps3');
      fim.nome = 'Crédito OK'; fim.flag = null; fim.selo = 'FIM_POSITIVO';
    });
    await dossie(p, 'pa4');
    checa('etapa renomeada e sem flag, mas selada como fim positivo: o botão continua lá',
      await existe(p, '#btn-iniciar-venda'));

    // E o inverso, que é o que impede o teste de passar por acaso: a etapa
    // volta a se chamar "Aprovada" e a ter a flag antiga, mas o selo diz que
    // ali a esteira ENCERRA. Nome e flag não abrem venda nenhuma.
    await p.evaluate(() => { fecharModal('modal-dossie');
      const fim = G.situacoes.find(s => s.id === 'ps3');
      fim.nome = 'Aprovada'; fim.flag = 'APROVADO'; fim.selo = 'FIM_NEGATIVO'; });
    await dossie(p, 'pa4');
    checa('e o nome "Aprovada" sozinho não abre venda nenhuma',
      !(await existe(p, '#btn-iniciar-venda')));
    todosErros.push(...erros); await b.close();
  }

  // "Fim" sozinho não basta: reprovar também é fim de esteira.
  console.log('\n1b. Fim negativo não abre venda');
  {
    const { b, p, erros } = await abrir({ user:GESTOR });
    await p.evaluate(() => {
      G.temSelo = true;
      G.situacoes.forEach(s => { s.selo = null; });
      G.situacoes.find(s => s.id === 'ps3').selo = 'FIM_NEGATIVO';   // onde pa4 está
      G.situacoes.find(s => s.id === 'ps4').selo = 'FIM_NEGATIVO';
    });
    await dossie(p, 'pa4');
    checa('processo num fim negativo não ganha o botão',
      !(await existe(p, '#btn-iniciar-venda')));
    checa('e a tela diz que aquele fim encerra o processo',
      /encerra/i.test(await p.evaluate(() => { trocarAbaDossie('comercial', null);
        return document.getElementById('dos-body').innerText; })));
    todosErros.push(...erros); await b.close();
  }

  // Sem a licença do módulo Venda nada disso pode nem existir no DOM — é a
  // regra do dono para módulo não licenciado, e ela vale para o botão também.
  console.log('\n1c. Sem licença da Venda, o botão não existe');
  {
    const { b, p, erros } = await abrir({ user:GESTOR, modulos:['PRE_ANALISE'] });
    await dossie(p, 'pa4');
    checa('sem o módulo Comercial o botão não é montado',
      !(await existe(p, '#btn-iniciar-venda')));
    checa('e a aba Venda nem existe',
      await p.locator('#dos-tabs [data-dt="comercial"]').count() === 0);
    todosErros.push(...erros); await b.close();
  }

  // ── 2. A recusa do banco vira a frase que explica o que falta ────────────
  //
  // a1_pa_pode_criar_comercial devolve a frase pronta. A tela tem de MOSTRAR
  // essa frase, e não trocá-la por um "não foi possível" — o motivo é a única
  // coisa que resolve o dia de quem está olhando.
  console.log('\n2. A recusa do banco vira a frase, e não um erro seco');
  {
    const { b, p, erros } = await abrir({ user:GESTOR,
      rotas:[{ re:/rpc\/a1_pa_pode_criar_comercial/, status:200,
               corpo:'não há decisão de crédito aprovada e válida' }] });
    await dossie(p, 'pa4');
    const rodape = await texto(p, '#dos-acoes');
    checa('a frase do banco aparece na tela',
      /decisão de crédito aprovada e válida/i.test(rodape), rodape);
    checa('e o botão fica travado em vez de sumir sem explicação',
      (await existe(p, '#btn-iniciar-venda')) && !(await ligado(p, '#btn-iniciar-venda')));
    checa('a recusa não manda "tentar de novo"', !/tente de novo|tentar novamente/i.test(rodape), rodape);
    // A lição cara desta tela: mensagem que acusa a permissão quando ela está
    // marcada manda o dono procurar uma caixa que já está lá.
    checa('e não acusa falta de permissão (quem olha é o gestor)',
      !/falta a permissão/i.test(rodape), rodape);

    // A mesma frase também na aba Venda, que é onde quem investiga vai olhar.
    const aba = await p.evaluate(() => { trocarAbaDossie('comercial', null);
      return document.getElementById('dos-body').innerText; });
    checa('a aba Venda repete o motivo', /decisão de crédito aprovada e válida/i.test(aba), aba);
    todosErros.push(...erros); await b.close();
  }

  // E quando a recusa só aparece na hora de agir (outra pessoa mexeu no
  // processo entre abrir o dossiê e clicar): o ok:false do orquestrador carrega
  // o motivo, e ele tem de chegar inteiro ao operador.
  {
    const { b, p, erros } = await abrir({ user:GESTOR,
      rotas:[{ re:/rpc\/a1_pa_executar_acao/, status:200,
               corpo:{ ok:false, erro:'o módulo Comercial não está liberado para este cliente' } }] });
    await dossie(p, 'pa4');
    await p.evaluate(() => iniciarVenda());
    await p.waitForTimeout(400);
    await preencher(p, '#v-venda', '250.000,00');
    await p.evaluate(() => confirmarIniciarVenda());
    await p.waitForTimeout(800);
    const t = await avisos(p);
    checa('o ok:false não vira sucesso', !/criada/i.test(t), t);
    checa('e o motivo chega inteiro', /módulo Comercial não está liberado/i.test(t), t);
    todosErros.push(...erros); await b.close();
  }

  // ── 3. O PEDIDO CENTRAL: a pré-análise FICA ──────────────────────────────
  console.log('\n3. Depois de iniciar a venda, a pré-análise continua na esteira');
  {
    const { b, p, erros } = await abrir({ user:GESTOR });
    // A unidade de interesse do processo, como o servidor a devolveria. É ela
    // que o passo novo tem de trazer pré-preenchida.
    await p.evaluate(() => { const x = G.lista.find(y => y.id === 'pa4'); x.unidade = '204 — Torre B'; });

    await dossie(p, 'pa4');
    const antes = await p.evaluate(() => G.lista.length);
    await p.evaluate(() => { window.__POSTS = []; iniciarVenda(); });
    await p.waitForTimeout(500);
    checa('o clique abre o passo de informações, e não cria nada direto',
      (await existe(p, '#modal-venda')) &&
      (await posts(p, /rpc\/a1_pa_executar_acao/, 'POST')).length === 0);

    await preencher(p, '#v-venda', '250.000,00');
    await preencher(p, '#v-entrada', '30.000,00');
    await p.evaluate(() => confirmarIniciarVenda());
    await p.waitForTimeout(1400);

    checa('a venda foi criada', /venda criada/i.test(await avisos(p)), await avisos(p));
    // As três provas de que o cartão da pré-análise não sumiu.
    checa('nenhum DELETE foi para a tabela da pré-análise',
      (await posts(p, /a1_pre_analises/, 'DELETE')).length === 0);
    checa('nem um PATCH: a pré-análise não é tocada ao abrir a venda',
      (await posts(p, /a1_pre_analises\?/, 'PATCH')).length === 0,
      JSON.stringify(await posts(p, /a1_pre_analises\?/, 'PATCH')));
    checa('a pré-análise continua na lista da tela',
      await p.evaluate(() => G.lista.some(x => x.id === 'pa4')));
    checa('e continua com a mesma quantidade de processos na esteira',
      await p.evaluate(() => G.lista.length) === antes);

    // Conteúdo, não quantidade: o código do processo continua desenhado na
    // fila — é o que o dono vê quando abre a tela no dia seguinte.
    await p.evaluate(() => { fecharModal('modal-dossie');
      history.replaceState(null,'','?vista=listagem'); aplicarVista(); renderVista(); });
    await p.waitForTimeout(400);
    checa('e o processo continua desenhado na fila',
      /PA-004/.test(await p.evaluate(() => document.querySelector('.main').innerText)));
    checa('o dossiê da pré-análise continua abrindo',
      await p.evaluate(async () => { await abrirDossie('pa4');
        return !document.getElementById('modal-dossie').classList.contains('hidden'); }));
    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros); await b.close();
  }

  // ── 4. O que o passo novo pergunta, e onde isso vai parar ────────────────
  console.log('\n4. O passo pede o que a tela da Venda de fato usa');
  {
    const { b, p, erros } = await abrir({ user:GESTOR });
    await p.evaluate(() => { const x = G.lista.find(y => y.id === 'pa4'); x.unidade = '204 — Torre B'; });
    await dossie(p, 'pa4');
    await p.evaluate(() => iniciarVenda());
    await p.waitForTimeout(400);

    checa('a unidade vem da pré-análise, já preenchida',
      (await valorDe(p, '#v-unidade')) === '204 — Torre B', await valorDe(p, '#v-unidade'));
    // O crédito aparece em <input disabled>, e innerText NÃO lê o value de
    // input — a primeira versão desta verificação procurava no texto e
    // reprovava uma tela que mostrava o número certo. Medir onde o dado
    // realmente está é parte de escrever a asserção.
    checa('o passo mostra o crédito aprovado como referência',
      (await p.$$eval('#venda-body input',
        els => els.map(e => e.value).join(' | '))).includes('150.000,00'),
      await p.$$eval('#venda-body input', els => els.map(e => e.value).join(' | ')));

    // Sem o valor da venda o cartão nasce vazio na tela da Venda. Não sai
    // requisição, e o aviso diz o que falta.
    await p.evaluate(() => { window.__POSTS = []; confirmarIniciarVenda(); });
    await p.waitForTimeout(500);
    checa('sem o valor da venda nada é enviado ao banco',
      (await posts(p, /rpc\/a1_pa_executar_acao/, 'POST')).length === 0);
    checa('e o aviso diz qual campo falta', /valor da venda/i.test(await avisos(p)), await avisos(p));

    await preencher(p, '#v-venda', '250.000,00');
    await preencher(p, '#v-entrada', '30.000,00');
    await preencher(p, '#v-obs', 'cliente quer entrega em 2027');
    // O alerta que a tela da Venda dá ao abrir a proposta, dado aqui antes de
    // criar: 250.000 - 30.000 passa dos 150.000 aprovados.
    checa('avisa quando a venda passa do crédito aprovado',
      /acima do crédito/i.test(await texto(p, '#v-conferencia')), await texto(p, '#v-conferencia'));

    await p.evaluate(() => { window.__POSTS = []; confirmarIniciarVenda(); });
    await p.waitForTimeout(1400);

    const acao = (await posts(p, /rpc\/a1_pa_executar_acao/, 'POST'))[0];
    checa('o cartão nasce pela ação da esteira, no motor que já existe',
      acao && acao.p_pre_analise === 'pa4' && acao.p_acao === 'ENABLE_COMMERCIAL', JSON.stringify(acao));
    const patch = (await posts(p, /a1_comerciais\?id=eq\.co1/, 'PATCH'))[0];
    checa('e as informações do passo caem no comercial criado', !!patch, JSON.stringify(patch));
    checa('com a unidade negociada', patch && patch.unidade === '204 — Torre B', JSON.stringify(patch));
    // Centavos, inteiro — é como o resto do sistema guarda dinheiro.
    checa('com o valor da venda em centavos',
      patch && patch.proposta && patch.proposta.valor_venda === 25000000, JSON.stringify(patch));
    checa('com a entrada', patch && patch.proposta && patch.proposta.valor_entrada === 3000000,
      JSON.stringify(patch));
    checa('e com a observação da negociação',
      patch && patch.proposta && /entrega em 2027/.test(patch.proposta.observacoes || ''), JSON.stringify(patch));
    todosErros.push(...erros); await b.close();
  }

  // A venda nasceu e o PATCH da proposta foi recusado. O cartão EXISTE — dizer
  // "erro ao iniciar a venda" mandaria o corretor clicar de novo num botão que
  // já não está mais lá.
  console.log('\n4b. Proposta recusada não vira "deu erro"');
  {
    const { b, p, erros } = await abrir({ user:GESTOR,
      rotas:[{ re:/a1_comerciais\?id=eq/, metodo:'PATCH', status:401,
               corpo:{ message:'new row violates row-level security policy' } }] });
    await dossie(p, 'pa4');
    await p.evaluate(() => iniciarVenda());
    await p.waitForTimeout(400);
    await preencher(p, '#v-venda', '250.000,00');
    await p.evaluate(() => confirmarIniciarVenda());
    await p.waitForTimeout(1400);
    const t = await avisos(p);
    checa('a tela diz que a venda FOI criada', /venda foi criada|venda criada/i.test(t), t);
    checa('e diz onde terminar o serviço', /Venda|proposta/i.test(t), t);
    checa('sem mandar tentar de novo', !/tente de novo|tentar novamente/i.test(t), t);
    todosErros.push(...erros); await b.close();
  }

  // ── 5. Os três campos de gente ───────────────────────────────────────────
  console.log('\n5. Empresa correspondente, correspondente e analista');
  {
    const { b, p, erros } = await abrir({ user:GESTOR });
    await dossie(p, 'pa1');

    checa('o dossiê tem empresa correspondente', await existe(p, '#d-empresa'));
    checa('o dossiê tem usuário correspondente', await existe(p, '#d-correspondente'));
    checa('o dossiê tem analista', await existe(p, '#d-analista'));

    const emp = await opcoes(p, '#d-empresa');
    checa('a empresa vem do cadastro de empresas correspondentes',
      emp.some(t => /Empresa Corr/.test(t)), emp.join('|'));
    const corr = await opcoes(p, '#d-correspondente');
    checa('o correspondente vem de a1_partners type=cca',
      corr.some(t => /Usuário Corr|Usuario Novo CCA/.test(t)), corr.join('|'));
    // E não a lista inteira de parceiros: corretor não é correspondente.
    checa('e não traz corretor junto', !corr.some(t => /Carla Dias/.test(t)), corr.join('|'));
    const ana = await opcoes(p, '#d-analista');
    checa('o analista vem de a1_partners type=analista',
      ana.some(t => /João Analista/.test(t)), ana.join('|'));
    checa('e não traz correspondente junto', !ana.some(t => /Usuário Corr/.test(t)), ana.join('|'));

    await p.selectOption('#d-empresa', 'e1');
    await p.selectOption('#d-correspondente', 'p8');
    await p.selectOption('#d-analista', 'p2');
    await p.evaluate(() => { window.__POSTS = []; salvarDados(); });
    await p.waitForTimeout(700);
    const patch = (await posts(p, /a1_pre_analises\?/, 'PATCH'))[0];
    checa('salvar grava a empresa correspondente', patch && patch.empresa_id === 'e1', JSON.stringify(patch));
    checa('salvar grava o correspondente', patch && patch.correspondente_id === 'p8', JSON.stringify(patch));
    checa('salvar grava o analista', patch && patch.analista_id === 'p2', JSON.stringify(patch));
    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros); await b.close();
  }

  console.log('\n5b. Os três campos também no assistente');
  {
    const { b, p, erros } = await abrir({ user:GESTOR });
    await p.evaluate(() => abrirAssistente());
    await p.waitForTimeout(500);
    checa('o assistente oferece a empresa correspondente', await existe(p, '#w-empresa'));
    checa('o assistente oferece o correspondente', await existe(p, '#w-correspondente'));
    checa('o assistente oferece o analista', await existe(p, '#w-analista'));

    await p.selectOption('#w-empr', 'd1');
    await p.selectOption('#w-empresa', 'e1');
    await p.selectOption('#w-correspondente', 'p8');
    await p.selectOption('#w-analista', 'p2');
    await p.evaluate(() => passoSeguinte());
    await p.waitForTimeout(300);
    await p.fill('#w-doc', '529.982.247-25');
    await p.fill('#w-nome', 'Cliente de Teste');
    await p.evaluate(() => passoSeguinte());
    await p.waitForTimeout(300);
    await p.evaluate(() => { window.__POSTS = []; passoSeguinte(); });
    await p.waitForTimeout(900);
    const corpo = (await posts(p, /a1_pre_analises/, 'POST'))[0];
    checa('a pré-análise nasce com a empresa correspondente',
      corpo && corpo.empresa_id === 'e1', JSON.stringify(corpo));
    checa('com o correspondente', corpo && corpo.correspondente_id === 'p8', JSON.stringify(corpo));
    checa('e com o analista', corpo && corpo.analista_id === 'p2', JSON.stringify(corpo));
    todosErros.push(...erros); await b.close();
  }

  // Trocar a empresa é redistribuir carteira — o gatilho a1_pa_guarda_update
  // recusa ('redistribuir_carteira_e_do_gestor'). Um seletor aberto para o
  // corretor derrubaria o PATCH inteiro, levando junto os campos que ele PODE
  // salvar.
  console.log('\n5c. Corretor não redistribui a carteira pela empresa');
  {
    const { b, p, erros } = await abrir({ user:CORRETOR, perms:{ pa_ver:true, pa_editar:true } });
    await dossie(p, 'pa2');
    checa('para o corretor a empresa não é editável', !(await ligado(p, '#d-empresa')));
    await p.evaluate(() => { window.__POSTS = []; salvarDados(); });
    await p.waitForTimeout(700);
    const patch = (await posts(p, /a1_pre_analises\?/, 'PATCH'))[0];
    checa('e o PATCH dele nem menciona empresa_id',
      patch && !('empresa_id' in patch), JSON.stringify(patch));
    todosErros.push(...erros); await b.close();
  }

  // ── 6. O Roteamento de Analistas, preparado e desligado ──────────────────
  console.log('\n6. Roteamento de Analistas: a trava existe e nasce desligada');
  {
    const { b, p, erros } = await abrir({ user:GESTOR });
    await dossie(p, 'pa1');
    checa('hoje, sem roteamento, o analista é escolhido à mão', await ligado(p, '#d-analista'));

    // Ligar o roteamento é só isto: a tela já sabe obedecer. Quando a tabela de
    // roteamento existir, é este valor que ela preenche.
    await p.evaluate(() => { G.roteamentoAnalistas = true; renderDossie(); });
    await p.waitForTimeout(300);
    checa('com o roteamento ativo o campo fica bloqueado', !(await ligado(p, '#d-analista')));
    checa('e a tela diz quem escolhe', /Roteamento/i.test(await texto(p, '#dos-body')),
      await texto(p, '#dos-body'));
    await p.evaluate(() => { window.__POSTS = []; salvarDados(); });
    await p.waitForTimeout(700);
    const patch = (await posts(p, /a1_pre_analises\?/, 'PATCH'))[0];
    checa('e a tela não escreve por cima do que o roteamento decidiu',
      patch && !('analista_id' in patch), JSON.stringify(patch));
    todosErros.push(...erros); await b.close();
  }

  // O SQL do analista é rodado à mão pelo dono, no editor do Supabase. Entre a
  // tela subir e o SQL rodar existe uma janela real — e nela um PATCH com uma
  // coluna inexistente derruba o salvamento INTEIRO, levando junto os campos
  // que sempre funcionaram.
  console.log('\n6b. Enquanto a coluna do analista não existir, salvar continua funcionando');
  {
    const { b, p, erros } = await abrir({ user:GESTOR,
      rotas:[{ re:/a1_pre_analises\?select=analista_id/, status:400,
               corpo:{ message:'column a1_pre_analises.analista_id does not exist' } }] });
    await dossie(p, 'pa1');
    checa('sem a coluna, o campo de analista não é oferecido', !(await existe(p, '#d-analista')));
    await p.evaluate(() => { window.__POSTS = []; salvarDados(); });
    await p.waitForTimeout(700);
    const patch = (await posts(p, /a1_pre_analises\?/, 'PATCH'))[0];
    checa('e o PATCH não menciona a coluna que não existe',
      patch && !('analista_id' in patch), JSON.stringify(patch));
    checa('mas continua gravando o resto', patch && 'empreendimento_id' in patch, JSON.stringify(patch));
    todosErros.push(...erros); await b.close();
  }

  process.exit(resumo(todosErros));
})();
