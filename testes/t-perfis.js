// Perfis de acesso.
//
// O recurso tem uma promessa e duas armadilhas.
//
// A PROMESSA: "quando eu cadastrar um corretor, eu posso vincular a esse perfil,
// aí as permissões seguirão somente o que foi proposto no perfil". Uma pessoa
// com perfil não vale mais pelas marcas soltas do cadastro dela — nem na tela,
// nem no banco.
//
// ARMADILHA 1 — a caixa decorativa. O catálogo (js/permissoes.js) promete que
// só entra chave que alguma tela ou política de fato lê. Uma caixa que não faz
// nada é pior que uma caixa ausente: a ausente o gestor percebe, a que não faz
// nada ele acredita. O teste do fim deste arquivo lê o código do projeto e
// falha se aparecer chave nova sem leitor.
//
// ARMADILHA 2 — a tela dizer uma coisa e a API outra. Quem decide de verdade é
// a1_perm() no banco (provado em testes/sql/prova-seguranca.sql). Aqui se prova
// que a TELA concorda com ela: mesmo perfil, mesmas permissões, e perfil
// inativo não manda em ninguém dos dois lados.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { responder, liberarModulos, D } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);
const RAIZ = path.join(__dirname, '..');

async function abrirConfig({ modulos = [] } = {}) {
  liberarModulos(modulos);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [], pedidos = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  p.on('console', m => { const t = m.text();
    if (m.type() === 'error' && !/ERR_CONNECTION|ERR_TUNNEL|fonts\.g|favicon|net::/.test(t)) erros.push('console: ' + t); });
  await p.addInitScript(() => {
    localStorage.setItem('a1_token', 'tok');
    localStorage.setItem('a1_slug', 'thecred');
    localStorage.setItem('a1_user', JSON.stringify({ id:'u1', tenant_id:'t1', name:'Julio',
      role:'owner', cpf:'99999999999', permissions:{} }));
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
  await p.goto(BASE + '/configuracoes.html', { waitUntil:'load' });
  await p.waitForTimeout(1600);
  return { b, p, erros, pedidos };
}

const chaves = (p, classe) => p.evaluate(c =>
  [...document.querySelectorAll('.' + c)].map(x => x.dataset.key), classe);

const gravado = (p, re) => p.evaluate(r => {
  const ult = (window.__POSTS || []).filter(x => new RegExp(r).test(x.url)).pop();
  if (!ult) return null;
  const c = JSON.parse(ult.body); return Array.isArray(c) ? c[0] : c;
}, re.source);

(async () => {
  console.log('== SEM OS MÓDULOS NOVOS, SÓ AS PERMISSÕES DE REPASSE ==');
  {
    const { b, p, erros } = await abrirConfig();
    await p.evaluate(() => openCorretor(null));
    await p.waitForTimeout(400);

    const ks = await chaves(p, 'co-perm');
    checa('nenhuma permissão de Pré-análise no cadastro',
      !ks.some(k => /^pa_|analisar_credito/.test(k)), ks.join(','));
    checa('nenhuma de Comercial', !ks.some(k => /^co_/.test(k)), ks.join(','));
    checa('as de Repasse continuam', ks.includes('criar_repasses') && ks.includes('alterar_etapa'));

    // O que o catálogo diz que ninguém lê não pode voltar pela porta dos fundos.
    checa('as três chaves decorativas sumiram do formulário',
      !ks.some(k => ['ver_repasses','baixar_documentos','editar_perfil'].includes(k)),
      ks.join(','));

    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== LIBEROU O MÓDULO, AS PERMISSÕES DELE APARECEM SOZINHAS ==');
  {
    const { b, p, erros } = await abrirConfig({ modulos:['PRE_ANALISE','COMERCIAL'] });

    for (const [abrir, classe, quem] of [
      ['openCorretor(null)',        'co-perm', 'corretor'],
      ['openAnalista(null)',        'an-perm', 'analista'],
      ['openPartnerModal(null)',    'pt-perm', 'correspondente'],
    ]) {
      await p.evaluate(f => eval(f), abrir);
      await p.waitForTimeout(400);
      const ks = await chaves(p, classe);
      checa(`${quem}: ganhou as permissões de Pré-análise`,
        ks.includes('pa_ver') && ks.includes('pa_criar') && ks.includes('analisar_credito'), ks.join(','));
      checa(`${quem}: e as de Comercial`,
        ks.includes('co_ver') && ks.includes('co_editar'), ks.join(','));
      // Uma chave, uma caixa. Duas caixas para a mesma chave e o formulário
      // passa a ter duas respostas para a mesma pergunta — vence a última lida.
      checa(`${quem}: nenhuma chave repetida`, new Set(ks).size === ks.length, ks.join(','));
    }

    // Os cartões grandes do correspondente continuam sendo a única casa dessas
    // três: o montador as pula de propósito.
    const kp = await chaves(p, 'pt-perm');
    checa('correspondente: gerente e visão geral seguem nos cartões grandes',
      kp.filter(k => k === 'gerente').length === 1 &&
      kp.filter(k => k === 'ver_todos_analistas').length === 1 &&
      kp.filter(k => k === 'ver_todos_repasses').length === 1, kp.join(','));

    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== O PERFIL MANDA: A TELA SEGUE ELE, NÃO AS MARCAS ==');
  {
    const { b, p, erros } = await abrirConfig({ modulos:['PRE_ANALISE','COMERCIAL'] });

    // Clara tem perfil "Corretor" (criar_repasses:true) e marca solta dizendo
    // o contrário (criar_repasses:false). Se a tela mostrar a marca, ela está
    // mentindo: a1_perm() resolve pelo perfil.
    // A lista tem de estar carregada: openCorretor procura em CORRETORES.
    await p.evaluate(() => openCfgView('corretores'));
    await p.waitForTimeout(800);
    await p.evaluate(() => openCorretor('p30'));
    await p.waitForTimeout(500);

    checa('a listagem mostra em que perfil cada um está',
      /Corretor/.test(await p.locator('#corretor-tbody').innerText()));
    checa('o cadastro abre com o perfil já escolhido',
      await p.evaluate(() => document.getElementById('co-perfil').value) === 'pf1');
    checa('a caixa segue o perfil, não a marca solta',
      await p.evaluate(() => document.querySelector('.co-perm[data-key="criar_repasses"]').checked) === true);
    checa('e o que o perfil não dá fica desmarcado, mesmo a marca dizendo sim',
      await p.evaluate(() => document.querySelector('.co-perm[data-key="ver_dashboard"]').checked) === false);
    checa('as caixas ficam travadas — clicar não prometeria nada',
      await p.evaluate(() => [...document.querySelectorAll('.co-perm')].every(c => c.disabled)));
    checa('e a tela diz de onde vem a permissão',
      /Corretor/.test(await p.locator('#co-perfil-aviso').innerText()));

    // Salvar não pode carimbar o perfil por cima das marcas próprias dela: se
    // o perfil um dia sair, ela volta ao que o gestor tinha marcado.
    await p.evaluate(() => saveCorretor());
    await p.waitForTimeout(500);
    const g = await gravado(p, /a1_partners/);
    checa('grava o vínculo com o perfil', g && g.perfil_id === 'pf1', JSON.stringify(g && g.perfil_id));
    checa('e preserva as marcas próprias, sem copiar as do perfil',
      g && g.permissions.criar_repasses === false && g.permissions.ver_dashboard === true,
      JSON.stringify(g && g.permissions));

    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== TIRAR O PERFIL DEVOLVE AS MARCAS DE ANTES ==');
  {
    const { b, p, erros } = await abrirConfig({ modulos:['PRE_ANALISE','COMERCIAL'] });
    await p.evaluate(() => openCfgView('corretores'));
    await p.waitForTimeout(800);
    await p.evaluate(() => openCorretor('p30'));
    await p.waitForTimeout(500);
    await p.evaluate(() => { const s = document.getElementById('co-perfil');
      s.value = ''; perfilAplicado('co-perfil','co-perm'); });
    await p.waitForTimeout(200);

    checa('as caixas voltam a ser editáveis',
      await p.evaluate(() => [...document.querySelectorAll('.co-perm')].every(c => !c.disabled)));
    checa('e mostram de novo o que o gestor tinha marcado',
      await p.evaluate(() => document.querySelector('.co-perm[data-key="criar_repasses"]').checked) === false &&
      await p.evaluate(() => document.querySelector('.co-perm[data-key="ver_dashboard"]').checked) === true);

    await p.evaluate(() => saveCorretor());
    await p.waitForTimeout(500);
    const g = await gravado(p, /a1_partners/);
    checa('e o vínculo é desfeito no banco', g && g.perfil_id === null, JSON.stringify(g && g.perfil_id));

    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== PERFIL INATIVO NÃO MANDA EM NINGUÉM ==');
  {
    // É como a1_perm() resolve: o join exige pf.ativo, então perfil desligado
    // cai de volta nas marcas da pessoa. A tela tem de dizer a mesma coisa —
    // se dissesse outra, o gestor confiaria na errada.
    const { b, p, erros } = await abrirConfig({ modulos:['PRE_ANALISE','COMERCIAL'] });
    await p.evaluate(() => openCfgView('corretores'));
    await p.waitForTimeout(800);
    await p.evaluate(() => openCorretor('p30'));
    await p.waitForTimeout(500);
    await p.evaluate(() => { const s = document.getElementById('co-perfil');
      s.innerHTML += '<option value="pf3">Antigo (inativo)</option>';
      s.value = 'pf3'; perfilAplicado('co-perfil','co-perm'); });
    await p.waitForTimeout(200);

    checa('as caixas continuam editáveis',
      await p.evaluate(() => [...document.querySelectorAll('.co-perm')].every(c => !c.disabled)));
    checa('a permissão do perfil desligado NÃO é aplicada',
      await p.evaluate(() => document.querySelector('.co-perm[data-key="criar_repasses"]').checked) === false);
    checa('e a tela explica que ele está inativo',
      /inativo/i.test(await p.locator('#co-perfil-aviso').innerText()));

    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== A TELA DE PERFIS ==');
  {
    const { b, p, erros } = await abrirConfig({ modulos:['PRE_ANALISE'] });
    await p.evaluate(() => openCfgView('perfis'));
    await p.waitForTimeout(700);

    checa('a sub-tela abre', await p.locator('#cfg-view-perfis').isVisible());
    checa('lista os perfis cadastrados',
      /Corretor/.test(await p.locator('#perfis-corpo').innerText()));
    checa('e marca o inativo como tal',
      /Inativo/.test(await p.locator('#perfis-corpo').innerText()));

    await p.evaluate(() => perfilAbrir(null));
    await p.waitForTimeout(300);
    const grupos = await p.evaluate(() =>
      [...document.querySelectorAll('#perfil-permissoes .pf-grupo-titulo')].map(x => x.textContent.trim()));
    checa('o editor agrupa por módulo', grupos.includes('Repasse') && grupos.includes('Pré-análise'), grupos.join('|'));
    checa('e não oferece o módulo que o cliente não tem',
      !grupos.includes('Comercial'), grupos.join('|'));
    checa('um perfil novo nasce fechado',
      await p.evaluate(() => [...document.querySelectorAll('#perfil-permissoes .pf-perm')].every(c => !c.checked)));

    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== SÓ O GESTOR MEXE EM PERFIS ==');
  {
    // É o que a política de a1_perfis diz: escrita só de a1_e_gestor(). Se a
    // tela deixasse um correspondente abrir, ele veria o botão e levaria um
    // erro do banco — a recusa tem de acontecer antes disso.
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
    liberarModulos(['PRE_ANALISE']);
    await p.addInitScript(() => {
      localStorage.setItem('a1_token', 'tok');
      localStorage.setItem('a1_slug', 'thecred');
      localStorage.setItem('a1_user', JSON.stringify({ id:'p21', tenant_id:'t1', name:'CCA',
        role:'partner', type:'cca', cpf:'33344455566', permissions:{} }));
    });
    await p.route(/supabase\.co/, r => {
      let d; try { d = responder(r.request().url(), r.request().method(), r.request().postData()); } catch (e) { d = []; }
      r.fulfill({ status:200, contentType:'application/json',
                  headers:{ 'content-range':'0-1/2' }, body:JSON.stringify(d) });
    });
    await p.goto(BASE + '/configuracoes.html', { waitUntil:'load' });
    await p.waitForTimeout(1600);
    checa('o correspondente não vê o cartão de Perfis',
      !(await p.locator('#cfg-card-perfis').isVisible()));
    await b.close();
  }

  console.log('\n== NENHUMA CAIXA DECORATIVA NO CATÁLOGO ==');
  {
    // Lê o projeto inteiro e exige, para cada chave do catálogo, uma LEITURA de
    // verdade em algum lugar: hasPerm('x'), perms.x, permissions->>'x',
    // a1_perm('x'). Escrever a chave num formulário não conta — foi exatamente
    // assim que ver_repasses, baixar_documentos e editar_perfil passaram anos
    // sendo marcadas sem efeito nenhum.
    const cat = fs.readFileSync(path.join(RAIZ, 'js/permissoes.js'), 'utf8');
    const catalogo = [...cat.matchAll(/\{\s*chave:'([a-z_]+)'/g)].map(m => m[1]);
    checa('o catálogo foi lido', catalogo.length >= 14, 'n=' + catalogo.length);

    const arquivos = [];
    (function anda(dir) {
      for (const f of fs.readdirSync(dir, { withFileTypes:true })) {
        if (f.name === 'node_modules' || f.name === '.git' || f.name === 'testes') continue;
        const alvo = path.join(dir, f.name);
        if (f.isDirectory()) anda(alvo);
        else if (/\.(html|js|sql)$/.test(f.name) && f.name !== 'permissoes.js') arquivos.push(alvo);
      }
    })(RAIZ);
    const corpo = arquivos.map(a => fs.readFileSync(a, 'utf8')).join('\n');

    for (const k of catalogo) {
      const leituras = [
        new RegExp(`hasPerm\\(\\s*['"]${k}['"]`),        // telas
        new RegExp(`a1_perm\\(\\s*'${k}'`),              // políticas e gatilhos
        new RegExp(`->>\\s*'${k}'`),                     // jsonb no SQL
        new RegExp(`\\b(perm|perms|permissions)\\s*\\??\\.${k}\\b`),
        new RegExp(`\\bp\\.${k}\\b|\\bperm\\.${k}\\b`),
        new RegExp(`\\[['"]${k}['"]\\]`),
      ];
      checa(`'${k}' é lida por alguém`, leituras.some(re => re.test(corpo)));
    }
  }

  process.exit(resumo([]));
})();
