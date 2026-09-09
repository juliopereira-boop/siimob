// Acesso por etapa nos três módulos.
//
// O seletor "Acesso por etapa", no cadastro de corretor e de analista, só
// mostrava as etapas do Repasse. A mesma pessoa que o gestor limitava a duas
// etapas do Repasse enxergava a esteira INTEIRA da Pré-análise e do Comercial —
// o controle existia num módulo e não existia nos outros dois.
//
// Aqui se prova: (1) o seletor lista os três, na ordem do processo, e só os
// licenciados; (2) o que ele grava vale nos três; e (3) — a verificação que
// impede a regressão — quem tem o mapa preenchido só com etapas do Repasse, que
// é TODO parceiro de hoje, continua enxergando a Pré-análise inteira. Sem essa
// regra, publicar isto tiraria o módulo de todos eles de uma vez.
const { chromium } = require('playwright');
const { responder, liberarModulos } = require('./fake');
const { abrir, checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

// Abridor próprio: precisamos entrar como PARCEIRO, com um mapa de etapas
// escolhido, e o comum.js entra sempre como gestor — para quem nada disto vale.
async function abrirComoParceiro(pag, permissoes, modulos) {
  liberarModulos(modulos || []);
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
    // O refresh de permissões devolve o MESMO mapa: senão a tela cairia no que
    // veio do banco e o cenário do teste evaporaria sem ninguém notar.
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

const PERM_BASE = { ver_repasses:true, editar_repasses:true, alterar_etapa:true,
                    ver_todos_analistas:true, pa_ver:true, pa_editar:true };

(async () => {
  const todosErros = [];

  // ── Configurações, sem os módulos novos: nada muda ───────────────────────
  {
    const { b, p, erros } = await abrir('configuracoes.html');
    console.log('\n== SEM LICENÇA, O SELETOR É O DE SEMPRE ==');
    await p.evaluate(() => openCfgView('corretores'));
    await p.waitForTimeout(700);
    await p.evaluate(() => openCorretor('p3'));
    await p.waitForTimeout(800);
    const grupos = await p.$$eval('#co-etapas-list [data-modulo]', els => els.map(e => e.dataset.modulo));
    checa('nenhum título de módulo aparece', grupos.length === 0, grupos.join(','));
    const txt = await p.$eval('#co-etapas-list', e => e.textContent);
    checa('e as etapas do Repasse continuam listadas', /Análise|Novo/.test(txt), txt.slice(0,80));
    todosErros.push(...erros);
    await b.close();
  }

  // ── Configurações, com os dois: três grupos na ordem do processo ─────────
  {
    const { b, p, erros } = await abrir('configuracoes.html', { modulos:['PRE_ANALISE','COMERCIAL'] });
    console.log('\n== COM LICENÇA, OS TRÊS MÓDULOS, NA ORDEM DO PROCESSO ==');
    await p.evaluate(() => openCfgView('corretores'));
    await p.waitForTimeout(700);
    await p.evaluate(() => openCorretor('p3'));
    await p.waitForTimeout(1200);

    const grupos = await p.$$eval('#co-etapas-list [data-modulo]', els => els.map(e => e.dataset.modulo));
    checa('os três módulos aparecem',
      grupos.join('>') === 'PRE_ANALISE>COMERCIAL>repasse', grupos.join('>'));

    const txt = await p.$eval('#co-etapas-list', e => e.textContent);
    checa('a situação da Pré-análise está lá', /Em análise/.test(txt));
    checa('e a do Comercial também',           /Proposta/.test(txt));

    // Marcar uma situação da Pré-análise e salvar: o mapa tem de sair com o id
    // dela junto dos ids do Repasse.
    await p.evaluate(() => setEtapaNivel('ps2','editar'));
    await p.waitForTimeout(200);
    await p.evaluate(() => setEtapaNivel('cs1','ver'));
    await p.waitForTimeout(200);
    await p.evaluate(() => { window.__POSTS = []; });
    await p.evaluate(() => saveCorretor());
    await p.waitForTimeout(800);
    const corpo = await p.evaluate(() => {
      const x = (window.__POSTS || []).find(y => /a1_partners/.test(y.url) && y.m === 'PATCH');
      return x ? JSON.parse(x.body) : null;
    });
    const mapa = corpo && corpo.permissions && corpo.permissions.etapas;
    checa('gravou a situação da Pré-análise', mapa && mapa.ps2 === 'editar', JSON.stringify(mapa));
    checa('gravou a do Comercial no nível certo', mapa && mapa.cs1 === 'ver', JSON.stringify(mapa));
    checa('e não perdeu a etapa do Repasse que já estava lá',
      mapa && mapa.s1 === 'editar', JSON.stringify(mapa));

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  // ── NÃO-REGRESSÃO: mapa só com etapas do Repasse ─────────────────────────
  {
    const { b, p, erros } = await abrirComoParceiro('pre-analise.html',
      { ...PERM_BASE, etapas: { s1:'editar', s2:'ver' } }, ['PRE_ANALISE']);
    console.log('\n== MAPA SÓ COM ETAPAS DO REPASSE: A PRÉ-ANÁLISE NÃO MUDA ==');
    const linhas = await p.evaluate(() => filtradas().length);
    const todas  = await p.evaluate(() => G.lista.length);
    checa('a base falsa tem pré-análises para filtrar', todas > 1, 'n=' + todas);
    checa('a fila continua inteira', linhas === todas, `${linhas} de ${todas}`);
    todosErros.push(...erros);
    await b.close();
  }

  // ── Com marcação na Pré-análise, a restrição passa a valer ───────────────
  {
    const { b, p, erros } = await abrirComoParceiro('pre-analise.html',
      { ...PERM_BASE, etapas: { s1:'editar', ps2:'ver' } }, ['PRE_ANALISE']);
    console.log('\n== MARCOU UMA SITUAÇÃO: SÓ ELA APARECE, E SÓ PARA VER ==');
    const sit = await p.evaluate(() => filtradas().map(x => x.situacao_id));
    checa('só as pré-análises da situação marcada aparecem',
      sit.length > 0 && sit.every(x => x === 'ps2'), sit.join(','));
    const outras = await p.evaluate(() => G.lista.some(x => x.situacao_id !== 'ps2'));
    checa('e havia processo em outra situação para esconder', outras === true);

    checa('nível "ver" não deixa editar',
      await p.evaluate(() => nivelNaSituacao('ps2')) === 'ver');
    checa('situação não marcada fica invisível',
      await p.evaluate(() => nivelNaSituacao('ps1')) === null);

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros));
})();
