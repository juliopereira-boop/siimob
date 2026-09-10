// As chaves da Pré-análise e do Comercial mandam na tela.
//
// O relato: o gestor marcou "Criar pré-análise" no cadastro de um corretor e
// nenhum botão apareceu. A causa não era permissão faltando — era a tela
// perguntando por OUTRA chave. O cadastro grava pa_criar; a tela perguntava
// criar_repasses, que é do Repasse. As seis chaves pa_*/co_* eram decoração.
//
// Caixa que não faz nada é pior que caixa ausente: quem marca acredita que
// concedeu, e quem desmarca acredita que fechou. Por isso cada verificação
// aqui vem em par — a chave do módulo abre, e a chave do Repasse sozinha NÃO
// abre. Só provar que a chave certa funciona deixaria passar o caso em que as
// duas valem, que é onde o defeito se esconderia de novo.
const { chromium } = require('playwright');
const { responder, liberarModulos } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

async function abrir(pag, permissoes, modulos) {
  liberarModulos(modulos || ['PRE_ANALISE','COMERCIAL']);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.addInitScript(perms => {
    localStorage.setItem('a1_token','tok'); localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify({ id:'p3', tenant_id:'t1', name:'Ana Souza',
      role:'partner', type:'corretor', cpf:'33333333333', permissions: perms }));
    window.confirm = () => true;
  }, permissoes);
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (/a1_partners\?id=eq\.p3/.test(u))
      return r.fulfill({ status:200, contentType:'application/json',
        body: JSON.stringify([{ permissions: permissoes, type:'corretor', perfil_id:null }]) });
    let d; try { d = responder(u, r.request().method(), r.request().postData()); } catch { d = []; }
    r.fulfill({status:200,contentType:'application/json',headers:{'content-range':'0-1/2'},body:JSON.stringify(d)});
  });
  await p.goto(BASE + '/' + pag, { waitUntil:'load' });
  await p.waitForTimeout(1800);
  return { b, p, erros };
}

const temBotaoNova = p => p.evaluate(() => {
  const el = document.getElementById('btn-nova');
  return !!el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none';
});
const foiRecusado = p => p.evaluate(() => document.body.innerText.includes('Sem acesso à'));

// O bloco de permissões que o cadastro grava hoje para um corretor.
const CORRETOR = { pa_ver:true, pa_criar:true, co_ver:true };

(async () => {
  const todosErros = [];

  // ── 1. O relato, exatamente ──────────────────────────────────────────────
  console.log('\nO botão de criar pré-análise segue pa_criar');
  {
    const { b, p, erros } = await abrir('pre-analise.html', CORRETOR);
    checa('com pa_criar, o botão aparece', await temBotaoNova(p));
    todosErros.push(...erros); await b.close();
  }
  {
    // O outro lado do par: a chave do Repasse não pode mais abrir esta porta.
    // Sem esta verificação, o teste acima continuaria verde se as duas chaves
    // valessem — e o defeito voltaria sem ninguém notar.
    const { b, p, erros } = await abrir('pre-analise.html',
      { pa_ver:true, criar_repasses:true, editar_repasses:true });
    checa('só com criar_repasses, o botão NÃO aparece', !(await temBotaoNova(p)));
    todosErros.push(...erros); await b.close();
  }
  {
    const { b, p, erros } = await abrir('pre-analise.html', { pa_ver:true, pa_editar:true });
    checa('pa_editar sozinha não dá o botão de criar', !(await temBotaoNova(p)));
    todosErros.push(...erros); await b.close();
  }
  {
    const { b, p, erros } = await abrir('pre-analise.html', { pa_ver:true, gerente:true });
    checa('gerente vale por cima e vê o botão', await temBotaoNova(p));
    todosErros.push(...erros); await b.close();
  }

  // ── 2. pa_ver / co_ver são a porta do módulo ─────────────────────────────
  console.log('\nA porta do módulo');
  {
    const { b, p, erros } = await abrir('pre-analise.html', { pa_criar:true, pa_editar:true });
    checa('sem pa_ver, a Pré-análise recusa mesmo com as outras chaves', await foiRecusado(p));
    // Recusar sem dizer o que falta manda a pessoa abrir chamado para descobrir
    // o óbvio; o texto tem de nomear a permissão.
    checa('e a recusa diz qual permissão falta',
      await p.evaluate(() => document.body.innerText.includes('Ver pré-análises')));
    todosErros.push(...erros); await b.close();
  }
  {
    const { b, p, erros } = await abrir('pre-analise.html', CORRETOR);
    checa('com pa_ver, o quadro abre normalmente', !(await foiRecusado(p)));
    todosErros.push(...erros); await b.close();
  }
  {
    const { b, p, erros } = await abrir('comercial.html', { co_editar:true });
    checa('sem co_ver, o Comercial recusa', await foiRecusado(p));
    todosErros.push(...erros); await b.close();
  }
  {
    const { b, p, erros } = await abrir('comercial.html', CORRETOR);
    checa('com co_ver, o Comercial abre', !(await foiRecusado(p)));
    todosErros.push(...erros); await b.close();
  }

  // ── 3. Nenhuma tela dos módulos novos pergunta pelas chaves do Repasse ───
  // Busca textual no arquivo publicado, não no que achamos que ficou. É o que
  // pega a próxima ocorrência que alguém colar de repasse.html sem traduzir.
  console.log('\nNenhuma chave do Repasse sobrou nas telas novas');
  for (const pag of ['pre-analise.html','comercial.html']) {
    const b = await chromium.launch();
    const p = await b.newPage();
    const txt = await p.evaluate(async u => (await fetch(u)).text(), BASE + '/' + pag)
      .catch(async () => { await p.goto(BASE + '/' + pag); return p.content(); });
    const achou = (txt.match(/perm\('(criar_repasses|editar_repasses|ver_repasses)'\)/g) || []);
    checa(`${pag}: nenhuma chamada perm() a chave do Repasse`, achou.length === 0, achou.join(', '));
    await b.close();
  }

  process.exit(resumo(todosErros));
})();
