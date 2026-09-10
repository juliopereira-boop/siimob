// "Ver processos" no Repasse, e o acesso por etapa do correspondente.
//
// O bloco Repasse do perfil tinha Criar, Editar, Mover e Compartilhar — e não
// tinha o degrau mais básico. Dava para dizer "pode criar", não dava para dizer
// "só pode ver". A chave ver_repasses já existiu e foi REMOVIDA do catálogo por
// não ter leitor nenhum; voltou agora, e a diferença é esta suíte: ela prova
// que a marca faz alguma coisa. Caixa que não faz nada é pior que caixa
// ausente, e esta chave já foi as duas coisas.
//
// A regra de compatibilidade é o que impede a regressão: NENHUM cadastro nem
// perfil de hoje tem esta chave. Ausente vale "pode ver" — se valesse "não
// pode", a primeira publicação trancaria todo parceiro para fora do Repasse.
const { chromium } = require('playwright');
const { responder, liberarModulos } = require('./fake');
const { abrir, checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

async function abrirComoParceiro(pag, permissoes) {
  liberarModulos([]);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.addInitScript(perms => {
    localStorage.setItem('a1_token', 'tok');
    localStorage.setItem('a1_slug', 'thecred');
    localStorage.setItem('a1_user', JSON.stringify({ id:'p3', tenant_id:'t1', name:'Ana Souza',
      role:'partner', type:'corretor', cpf:'33333333333', permissions: perms }));
    window.__XSS = 0; window.confirm = () => true;
  }, permissoes);
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status:200, contentType:'text/css', body:'' }));
  await p.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (/a1_partners\?id=eq\.p3/.test(u))
      return r.fulfill({ status:200, contentType:'application/json',
        body: JSON.stringify([{ permissions: permissoes, type:'corretor' }]) });
    let d; try { d = responder(u, r.request().method(), r.request().postData()); } catch { d = []; }
    r.fulfill({ status:200, contentType:'application/json',
                headers:{ 'content-range':'0-1/2' }, body: JSON.stringify(d) });
  });
  await p.goto(BASE + '/' + pag, { waitUntil:'load' });
  await p.waitForTimeout(1800);
  return { b, p, erros };
}

(async () => {
  const todosErros = [];

  // ── A chave está no catálogo, no bloco do Repasse ────────────────────────
  {
    const { b, p, erros } = await abrir('configuracoes.html');
    console.log('\n== O PERFIL TEM O DEGRAU "VER PROCESSOS" ==');
    await p.evaluate(() => openCfgView('perfis'));
    await p.waitForTimeout(600);
    await p.evaluate(() => perfilAbrir(null));
    await p.waitForTimeout(500);

    // O formulário do PERFIL usa data-chave; o dos cadastros de gente usa
    // data-key. Nomes diferentes para a mesma coisa, e é fácil medir o errado.
    const chaves = await p.$$eval('#perfil-permissoes input[type=checkbox]',
      els => els.map(e => e.dataset.chave));
    checa('ver_repasses aparece no formulário do perfil', chaves.includes('ver_repasses'),
          chaves.join(','));
    const rotulo = await p.$eval('#perfil-permissoes label[title*="módulo de Repasse não abre"]',
      e => e.textContent).catch(() => '');
    checa('e a ajuda diz o que acontece sem ela', /não abre/.test(rotulo), rotulo.slice(0,80));

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  // ── O PADRÃO É VER. Cadastro novo não pode nascer trancado ───────────────
  //
  // Esta é a verificação que faltou quando a chave foi criada: ela nascia
  // desmarcada nos formulários, e salvar um corretor novo gravava
  // ver_repasses:false. A pessoa era cadastrada e batia em "Sem acesso ao
  // Repasse" no primeiro login, sem ninguém entender por quê.
  {
    const { b, p, erros } = await abrir('configuracoes.html');
    console.log('\n== VER O MÓDULO É O PADRÃO, EM TODO CADASTRO NOVO ==');

    await p.evaluate(() => openCfgView('corretores'));
    await p.waitForTimeout(800);
    await p.evaluate(() => openCorretor(null));       // corretor NOVO
    await p.waitForTimeout(700);
    checa('no corretor novo, "Ver processos" já vem marcada',
      await p.evaluate(() => document.querySelector('.co-perm[data-key="ver_repasses"]')?.checked) === true);

    await p.evaluate(() => openCfgView('correspondentes'));
    await p.waitForTimeout(900);
    await p.evaluate(() => openPartnerModal(null));   // correspondente NOVO
    await p.waitForTimeout(900);
    checa('no correspondente novo, também',
      await p.evaluate(() => document.querySelector('.pt-perm[data-key="ver_repasses"]')?.checked) === true);

    await p.evaluate(() => openCfgView('perfis'));
    await p.waitForTimeout(700);
    await p.evaluate(() => perfilAbrir(null));        // perfil NOVO
    await p.waitForTimeout(500);
    checa('e no perfil novo, que vale para todo mundo que for vinculado a ele',
      await p.evaluate(() => document.querySelector('.pf-perm[data-chave="ver_repasses"]')?.checked) === true);
    // O resto do perfil continua nascendo fechado: a exceção é só esta chave.
    const outras = await p.$$eval('.pf-perm',
      els => els.filter(e => e.dataset.chave !== 'ver_repasses' && e.checked).map(e => e.dataset.chave));
    checa('e só ela — o perfil novo continua nascendo fechado no resto',
      outras.length === 0, outras.join(','));

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  // ── NÃO-REGRESSÃO: sem a chave, o Repasse continua abrindo ───────────────
  {
    const { b, p, erros } = await abrirComoParceiro('repasse.html',
      { criar_repasses:true, ver_dashboard:true });
    console.log('\n== SEM A CHAVE (CADASTRO ANTIGO), O REPASSE CONTINUA ABRINDO ==');
    const corpo = await p.$eval('.main', e => e.textContent).catch(() => '');
    checa('nenhum aviso de bloqueio aparece', !/Sem acesso ao Repasse/.test(corpo));
    checa('e o quadro continua na página', await p.locator('#kanban-board').count() === 1);
    todosErros.push(...erros);
    await b.close();
  }

  // ── Com a chave DESMARCADA, o módulo não abre ────────────────────────────
  {
    const { b, p, erros } = await abrirComoParceiro('repasse.html',
      { ver_repasses:false, criar_repasses:true, ver_dashboard:true });
    console.log('\n== COM A CHAVE DESMARCADA, O MÓDULO NÃO ABRE ==');
    const corpo = await p.$eval('.main', e => e.textContent).catch(() => '');
    checa('a tela explica que falta a permissão', /Sem acesso ao Repasse/.test(corpo),
          corpo.trim().slice(0,90));
    checa('e diz a quem pedir', /gestor/i.test(corpo));
    checa('o quadro saiu da página', await p.locator('#kanban-board').count() === 0);
    const abas = await p.$$eval('.tabs-bar .tab-group, .tabs-bar .tab-btn',
      els => els.filter(e => e.offsetParent !== null).map(e => e.textContent.trim()));
    checa('as abas do Repasse somem da barra',
      !abas.some(t => /^Repasse/.test(t)), abas.join(' | '));

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  // ── Com a chave MARCADA, abre normalmente ────────────────────────────────
  {
    const { b, p, erros } = await abrirComoParceiro('repasse.html',
      { ver_repasses:true, criar_repasses:true, ver_dashboard:true });
    console.log('\n== COM A CHAVE MARCADA, ABRE ==');
    const corpo = await p.$eval('.main', e => e.textContent).catch(() => '');
    checa('nenhum aviso de bloqueio aparece', !/Sem acesso ao Repasse/.test(corpo));
    checa('o quadro continua na página', await p.locator('#kanban-board').count() === 1);
    todosErros.push(...erros);
    await b.close();
  }

  // ── O correspondente ganhou acesso por etapa ─────────────────────────────
  {
    const { b, p, erros } = await abrir('configuracoes.html', { modulos:['PRE_ANALISE','COMERCIAL'] });
    console.log('\n== CORRESPONDENTE: ACESSO POR ETAPA, NOS TRÊS MÓDULOS ==');
    await p.evaluate(() => openCfgView('correspondentes'));
    await p.waitForTimeout(900);
    await p.evaluate(() => openPartnerModal('p8'));    // Usuário Corr
    await p.waitForTimeout(1200);

    checa('o formulário tem o seletor de etapas', await p.locator('#pt-etapas-list').count() === 1);
    const grupos = await p.$$eval('#pt-etapas-list [data-modulo]', els => els.map(e => e.dataset.modulo));
    checa('e ele cobre os três módulos, na ordem do processo',
      grupos.join('>') === 'PRE_ANALISE>COMERCIAL>repasse', grupos.join('>'));

    // Salvar SEM tocar nas etapas não pode cegar quem nunca teve mapa.
    // A empresa é obrigatória no formulário e o p8 da base falsa não tem uma.
    await p.evaluate(() => { const e = document.getElementById('pt-f-empresa');
      if (e && e.options.length > 1) e.selectedIndex = 1; });
    await p.evaluate(() => { window.__POSTS = []; });
    await p.evaluate(() => savePartner());
    await p.waitForTimeout(800);
    const semTocar = await p.evaluate(() => {
      const x = (window.__POSTS || []).find(y => /a1_partners/.test(y.url));
      return x ? JSON.parse(x.body) : null;
    });
    checa('salvar sem tocar nas etapas não grava mapa vazio',
      semTocar && !('etapas' in (semTocar.permissions || {})),
      JSON.stringify(semTocar && semTocar.permissions && semTocar.permissions.etapas));

    // Agora marcando de verdade: o mapa vai para o banco com os três módulos.
    await p.evaluate(() => openPartnerModal('p8'));
    await p.waitForTimeout(1200);
    await p.evaluate(() => { const e = document.getElementById('pt-f-empresa');
      if (e && e.options.length > 1) e.selectedIndex = 1; });
    await p.evaluate(() => setEtapaNivel('ps2','editar'));
    await p.evaluate(() => setEtapaNivel('s1','ver'));
    await p.waitForTimeout(200);
    await p.evaluate(() => { window.__POSTS = []; });
    await p.evaluate(() => savePartner());
    await p.waitForTimeout(800);
    const corpo = await p.evaluate(() => {
      const x = (window.__POSTS || []).find(y => /a1_partners/.test(y.url));
      return x ? JSON.parse(x.body) : null;
    });
    const mapa = corpo && corpo.permissions && corpo.permissions.etapas;
    checa('grava a situação da Pré-análise', mapa && mapa.ps2 === 'editar', JSON.stringify(mapa));
    checa('e a etapa do Repasse no nível certo', mapa && mapa.s1 === 'ver', JSON.stringify(mapa));

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros));
})();
