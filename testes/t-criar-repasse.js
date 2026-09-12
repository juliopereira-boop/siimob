// "Novo Repasse": o botão que aparecia mesmo desabilitado.
//
// O relato de produção: o gestor tirou de um corretor a permissão de criar
// repasse; ao recarregar a página, o botão aparecia mesmo assim, por segundos,
// e clicar nele funcionava. Não era um piscar — o botão nascia visível no HTML
// e só era escondido em applyPartnerRestrictions(), que roda DEPOIS do
// loadData() inteiro: catorze consultas.
//
// A trava que vale é do banco (a1_cases_repasse_create_capability). O que esta
// suíte cobre é a tela: o botão não pode nascer visível, e as duas portas de
// entrada — openNewCase() e createCase() — precisam recusar por conta própria,
// porque o console não passa por botão nenhum.
//
// O caso que mais me preocupa aqui é o inverso do defeito: quem PODE criar não
// pode perder o botão. São 53 parceiros ativos sem a chave `criar_repasses` no
// cadastro, e para eles ausente vale "pode" — foi assim que o sistema sempre
// funcionou. Metade dos testes abaixo defende essas pessoas.
const { chromium } = require('playwright');
const { responder } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

// `permissoes` = o que o BANCO devolve para este parceiro.
// `guardadas`  = o que está no localStorage (o retrato do login, que envelhece).
// `bancoMudo`  = a consulta de permissões falha.
async function abrirComo(pag, papel, { permissoes, guardadas, bancoMudo } = {}) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.addInitScript(([papel, guardadas]) => {
    localStorage.setItem('a1_token', 'tok');
    localStorage.setItem('a1_slug', 'thecred');
    localStorage.setItem('a1_user', JSON.stringify(
      papel === 'gestor'
        ? { id:'u1', tenant_id:'t1', name:'Julio', role:'owner', cpf:'99999999999' }
      : papel === 'correspondente'
        ? { id:'p9', tenant_id:'t1', name:'Corresp', role:'partner', type:'cca',
            cpf:'44444444444', permissions: guardadas || {} }
        : { id:'p3', tenant_id:'t1', name:'Ana Souza', role:'partner', type:'corretor',
            cpf:'33333333333', permissions: guardadas || {} }));
    window.confirm = () => true;
    window.__TOASTS = [];
    window.__POSTS  = [];
  }, [papel, guardadas]);
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, r => {
    const u = r.request().url(), m = r.request().method();
    if (/a1_partners\?id=eq\.(p3|p9)/.test(u)) {
      if (bancoMudo) return r.fulfill({ status: 500, contentType:'application/json', body:'{}' });
      return r.fulfill({ status:200, contentType:'application/json',
        body: JSON.stringify([{ permissions: permissoes || {}, type:'corretor', perfil_id:null }]) });
    }
    let d; try { d = responder(u, m, r.request().postData()); } catch { d = []; }
    r.fulfill({status:200,contentType:'application/json',headers:{'content-range':'0-1/2'},body:JSON.stringify(d)});
  });
  await p.goto(BASE + '/' + pag, { waitUntil:'load' });
  return { b, p, erros };
}

const botaoVisivel = p => p.evaluate(() => {
  const el = document.querySelector('[onclick="openNewCase()"]');
  return !!el && !el.hidden && getComputedStyle(el).display !== 'none';
});
const modalAberto = p => p.evaluate(() => {
  const m = document.getElementById('modal-new-bg') || document.getElementById('modal-new');
  return !!m && !m.classList.contains('hidden');
});

(async () => {
  const todosErros = [];

  // ── 1. O defeito relatado: nasce oculto, em qualquer tela ────────────────
  // Sem espera nenhuma — é o primeiro paint que interessa. Era exatamente aqui
  // que o botão aparecia para quem não podia.
  console.log('\nO botão não nasce visível (primeiro paint)');
  for (const pag of ['repasse.html','listagem.html','andamento.html']) {
    const { b, p, erros } = await abrirComo(pag, 'parceiro',
      { permissoes: { criar_repasses:false }, guardadas: { criar_repasses:true } });
    checa(`${pag}: oculto antes de qualquer consulta`, !(await botaoVisivel(p)));
    await p.waitForTimeout(1800);
    // O localStorage dizia que podia; o banco disse que não. Vale o banco.
    checa(`${pag}: continua oculto depois da carga`, !(await botaoVisivel(p)));
    todosErros.push(...erros); await b.close();
  }

  // ── 2. Criar Repasse não é atalho do cabeçalho ──────────────────────────
  // A abertura parte do fluxo de Venda. Por isso não há exceção por perfil:
  // mesmo quem tem a permissão não recebe um botão solto no topo.
  console.log('\nO cabeçalho não oferece Novo Repasse');
  for (const [rotulo, papel, opts] of [
    ['corretor com a chave marcada', 'parceiro', { permissoes: { criar_repasses:true } }],
    ['corretor sem a chave no cadastro', 'parceiro', { permissoes: {} }],
    ['gestor', 'gestor', {}],
    ['gerente', 'parceiro', { permissoes: { gerente:true, criar_repasses:false } }],
  ]) {
    const { b, p, erros } = await abrirComo('repasse.html', papel, opts);
    await p.waitForTimeout(1800);
    checa(`${rotulo}: não vê Novo Repasse no cabeçalho`, !(await botaoVisivel(p)));
    todosErros.push(...erros); await b.close();
  }

  // ── 3. Banco mudo: parceiro não ganha o botão ────────────────────────────
  // Aqui a decisão é o contrário da do modo manutenção, e de propósito. Lá,
  // "não consegui perguntar" não podia derrubar ninguém. Aqui, não confirmar a
  // permissão de um parceiro não pode virar permissão — o localStorage é o
  // retrato do login, e é justamente ele que fica velho quando o gestor tira
  // o acesso. Gestor não passa por essa consulta e não é afetado.
  console.log('\nPermissão não confirmada não vira permissão');
  {
    const { b, p, erros } = await abrirComo('repasse.html', 'parceiro',
      { guardadas: { criar_repasses:true }, bancoMudo:true });
    await p.waitForTimeout(1800);
    checa('parceiro sem confirmação do banco NÃO ganha o botão', !(await botaoVisivel(p)));
    todosErros.push(...erros); await b.close();
  }
  {
    const { b, p, erros } = await abrirComo('repasse.html', 'gestor', { bancoMudo:true });
    await p.waitForTimeout(1800);
    checa('gestor também não recebe o atalho no cabeçalho', !(await botaoVisivel(p)));
    todosErros.push(...erros); await b.close();
  }

  // ── 4. O atalho pelo console ─────────────────────────────────────────────
  // Esconder o botão não fecha nada: openNewCase() e createCase() são globais.
  console.log('\nChamar as funções direto, sem passar por botão');
  {
    const { b, p, erros } = await abrirComo('repasse.html', 'parceiro',
      { permissoes: { criar_repasses:false } });
    await p.waitForTimeout(1800);
    await p.evaluate(() => { try { openNewCase(); } catch {} });
    await p.waitForTimeout(400);
    checa('openNewCase() não abre o formulário', !(await modalAberto(p)));

    const antes = await p.evaluate(() => window.__POSTS.length);
    await p.evaluate(() => { try { createCase(); } catch {} });
    await p.waitForTimeout(500);
    const depois = await p.evaluate(() => window.__POSTS.length);
    checa('createCase() não grava nada', depois === antes, `posts ${antes}→${depois}`);
    todosErros.push(...erros); await b.close();
  }
  {
    // E o inverso: quem pode continua abrindo normalmente.
    const { b, p, erros } = await abrirComo('repasse.html', 'parceiro',
      { permissoes: { criar_repasses:true } });
    await p.waitForTimeout(1800);
    await p.evaluate(() => { try { openNewCase(); } catch {} });
    await p.waitForTimeout(400);
    checa('quem pode criar abre o formulário normalmente', await modalAberto(p));
    todosErros.push(...erros); await b.close();
  }

  // ── 5. Configurações não monta para parceiro ─────────────────────────────
  console.log('\n/configuracoes digitado na barra de endereço');
  {
    const { b, p, erros } = await abrirComo('configuracoes.html', 'parceiro',
      { permissoes: {} });
    await p.waitForTimeout(1500);
    const saiu = await p.evaluate(() => location.pathname.includes('repasse'));
    checa('corretor é devolvido para o Repasse', saiu, `→ ${await p.evaluate(()=>location.pathname)}`);
    todosErros.push(...erros); await b.close();
  }
  {
    // O correspondente NÃO é devolvido, e isso é deliberado: a equipe dele é
    // cadastrada nesta tela. Fechar para todo parceiro resolveria o buraco
    // derrubando quem trabalha — foi o que quase aconteceu aqui.
    const { b, p, erros } = await abrirComo('configuracoes.html', 'correspondente');
    await p.waitForTimeout(1800);
    checa('correspondente continua entrando',
      await p.evaluate(() => location.pathname.includes('configuracoes')));
    checa('e a tela dele fica visível',
      await p.evaluate(() => getComputedStyle(document.body).visibility === 'visible'));
    todosErros.push(...erros); await b.close();
  }
  {
    const { b, p, erros } = await abrirComo('configuracoes.html', 'gestor');
    await p.waitForTimeout(1800);
    checa('gestor continua entrando', await p.evaluate(() => location.pathname.includes('configuracoes')));
    // A tela nasce invisível: se algo no caminho esquecer de revelá-la, o
    // gestor fica olhando branco. Vale mais provar isto do que o redirect.
    checa('e a tela do gestor fica VISÍVEL',
      await p.evaluate(() => !document.body.classList.contains('acesso-pendente')
                          && getComputedStyle(document.body).visibility === 'visible'));
    todosErros.push(...erros); await b.close();
  }

  process.exit(resumo(todosErros));
})();
