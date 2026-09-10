// O que um PERFIL faz com o que a pessoa ENXERGA.
//
// Relato de produção: um corretor recém-criado aparecia como "Correspondente"
// no Repasse e no Dashboard, e via processo que não era dele — na Pré-análise e
// no Repasse. Três defeitos somados, e nenhum deles tinha teste:
//
// 1. O Repasse tinha a sua própria cópia do rótulo de papel, e ela chamava de
//    "Correspondente" todo parceiro que não fosse despachante.
//
// 2. a1RefreshPartnerPerms trocava as permissões da pessoa PELAS DO PERFIL,
//    objeto inteiro. O mapa de etapas — que é da pessoa, não do perfil — ia
//    junto no lixo, e a tela lê "sem mapa" como "sem restrição de etapa".
//
// 3. temVisaoCompleta() lia a AUSÊNCIA de ver_todos_analistas como "vê tudo".
//    A regra existia para não tirar acesso de cadastro antigo, mas um perfil é
//    sempre novo: perfil que não fala de visão abria a carteira inteira.
//
// A base falsa já tinha o cenário exato: Clara Perfil (p30) é corretora, tem
// perfil 'Corretor' (pf1) — que não declara ver_todos_analistas nem etapas — e
// tem, no cadastro dela, etapas:{s1:'editar'}. Nenhum dos quatro processos da
// base é dela.
const { chromium } = require('playwright');
const { responder, liberarModulos } = require('./fake');
const { abrir, checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

async function abrirComoClara(pag) {
  liberarModulos([]);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.addInitScript(() => {
    localStorage.setItem('a1_token', 'tok');
    localStorage.setItem('a1_slug', 'thecred');
    // O retrato do login: só o que o navegador guardou. Quem manda depois é o
    // que a1RefreshPartnerPerms buscar no banco — que é o caminho do defeito.
    localStorage.setItem('a1_user', JSON.stringify({ id:'p30', tenant_id:'t1',
      name:'Clara Perfil', role:'partner', type:'corretor', cpf:'55566677788',
      permissions:{ criar_repasses:false, ver_dashboard:true, etapas:{ s1:'editar' } } }));
    window.__XSS = 0; window.confirm = () => true;
  });
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

(async () => {
  const todosErros = [];

  // ── Quantos processos existem, visto por quem vê tudo ────────────────────
  let totalDaBase = 0;
  {
    const { b, p, erros } = await abrir('repasse.html');
    totalDaBase = await p.evaluate(() => (G.cases || []).length);
    console.log('\n== A BASE TEM PROCESSO PARA VAZAR ==');
    checa('o gestor enxerga a carteira inteira', totalDaBase >= 3, 'n=' + totalDaBase);
    todosErros.push(...erros);
    await b.close();
  }

  // ── A corretora com perfil ───────────────────────────────────────────────
  {
    const { b, p, erros } = await abrirComoClara('repasse.html');
    console.log('\n== CORRETORA COM PERFIL: PAPEL CERTO E CARTEIRA FECHADA ==');

    const papel = await p.$eval('#hdr-user', e => e.textContent);
    checa('o cabeçalho diz Corretor', /Corretor/.test(papel), papel.trim());
    checa('e NÃO diz Correspondente', !/Correspondente/.test(papel), papel.trim());

    // O perfil pf1 não tem etapas. Se ele tivesse apagado o mapa da pessoa,
    // este seria o ponto em que a restrição de etapa sumiria.
    const mapa = await p.evaluate(() => (G.user.permissions || {}).etapas || null);
    checa('o mapa de etapas da pessoa sobreviveu ao perfil',
      mapa && mapa.s1 === 'editar', JSON.stringify(mapa));
    checa('e as permissões vieram mesmo do perfil',
      await p.evaluate(() => (G.user.permissions || {}).criar_repasses) === true);

    checa('o perfil não abre a carteira inteira',
      await p.evaluate(() => temVisaoCompleta()) === false);

    // Regra do dono, dita depois deste relato: corretor e analista veem apenas
    // o que é deles, em todo o sistema. Ela ganha de qualquer marca — inclusive
    // de um perfil que diga o contrário, que é como a carteira foi aberta aqui.
    checa('corretora cai na regra de "só o seu"',
      await p.evaluate(() => soVeOSeu()) === true);
    const aindaAbre = await p.evaluate(() => {
      G.user.permissions = { ...G.user.permissions, ver_todos_analistas: true, gerente: true };
      return temVisaoCompleta();
    });
    checa('nem "visão completa" nem "gerente" abrem a carteira de uma corretora',
      aindaAbre === false);
    await p.evaluate(() => { delete G.user.permissions.gerente;
                             delete G.user.permissions.ver_todos_analistas; });

    // A prova que importa: o servidor entregou os processos (a1_cases só tem
    // isolamento por cliente), e mesmo assim nenhum aparece — porque nenhum é
    // dela. Se a tela mostrasse um só, seria o vazamento relatado.
    const carregados = await p.evaluate(() => (G.cases || []).length);
    checa('o servidor entregou os processos do cliente', carregados === totalDaBase,
      `${carregados} de ${totalDaBase}`);
    const meus = await p.evaluate(() => (G.cases || []).filter(c => isMeuProcesso(c)).length);
    checa('nenhum deles é dela', meus === 0, 'meus=' + meus);

    const visiveis = await p.evaluate(() =>
      (G.cases || []).filter(c => temVisaoCompleta() || isMeuProcesso(c)).length);
    checa('e nenhum aparece para ela', visiveis === 0, 'visiveis=' + visiveis);

    const noQuadro = await p.evaluate(() =>
      document.querySelectorAll('#kanban .kanban-card, #kanban .card').length);
    checa('o quadro não desenha cartão nenhum', noQuadro === 0, 'cartoes=' + noQuadro);

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  // ── E quem NÃO pode ser fechado junto ────────────────────────────────────
  {
    const { b, p, erros } = await abrirComoClara('repasse.html');
    console.log('\n== A REGRA É DOS DOIS TIPOS, NÃO DE TODO MUNDO ==');
    // Mesma pessoa, mesmo perfil — só o tipo muda. Sem esta verificação, fechar
    // corretor e analista poderia ter fechado correspondente e coordenador
    // junto, e ninguém notaria até o cliente ligar.
    const corr = await p.evaluate(() => { G.user.type = 'cca'; return soVeOSeu(); });
    checa('correspondente não cai na regra de "só o seu"', corr === false);
    const coord = await p.evaluate(() => { G.user.type = 'coordenador'; return soVeOSeu(); });
    checa('coordenador também não', coord === false);
    const veTudo = await p.evaluate(() => {
      G.user.type = 'coordenador';
      G.user.permissions = { ...G.user.permissions, ver_todos_analistas: true };
      return temVisaoCompleta();
    });
    checa('e o coordenador com visão completa continua enxergando a equipe', veTudo === true);
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros));
})();
