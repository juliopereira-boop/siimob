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
// pode perder o botão. Metade dos testes abaixo defende essas pessoas.
//
// A REGRA MUDOU EM 2026-09-13, e este arquivo passa a proteger a regra nova.
// supabase/sql/2026-09-13_restringe_criacao_manual_repasse_por_papel.sql trocou
// a política por:
//
//   a1_has_module('repasse') AND a1_perm('criar_repasses')
//   AND ( a1_e_gestor() OR a1_tipo_ator() IN ('analista','cca') )
//
// Duas consequências, e as duas estão verificadas aqui embaixo:
//
//  1. CORRETOR NÃO CRIA REPASSE MANUALMENTE, nem com a chave marcada. A criação
//     manual passou a ser atribuição de retaguarda — para o corretor, o Repasse
//     nasce do fluxo de Venda. Antes desta data este arquivo provava o
//     contrário (um corretor com `criar_repasses:true` abrindo o formulário), e
//     é essa expectativa que envelheceu, não a tela: podeCriarRepasse() em
//     repasse.html/andamento.html/listagem.html já espelha a política.
//  2. AUSENTE VALE "NÃO PODE". A política deixou de usar a1_perm_padrao(...,
//     false) e voltou para a1_perm(), que é ausente = não. O padrão da tela
//     (hasPerm) diz o mesmo. Eram os 53 parceiros ativos cadastrados antes de a
//     chave existir; hoje os dois lados concordam que eles não criam.
//
// Quem tem de conferir se isso foi mesmo o que o dono quis é o dono: a decisão
// exclui corretor E coordenador, e em produção isso é gente que trabalha. O
// teste registra a regra que está no ar — não a endossa.
const { chromium } = require('playwright');
const { responder } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

// `permissoes` = o que o BANCO devolve para este parceiro.
// `guardadas`  = o que está no localStorage (o retrato do login, que envelhece).
// `bancoMudo`  = a consulta de permissões falha.
// `tipo`       = o TIPO do parceiro em a1_partners (corretor por padrão). Ele
//                importa desde que a política passou a olhar a1_tipo_ator():
//                mesma permissão, resposta diferente conforme o tipo. E ele sai
//                daqui, e não só do localStorage, porque é o que o banco manda —
//                a1RefreshPartnerPerms() sobrescreve o tipo da sessão com o da
//                linha. Devolver sempre 'corretor' aqui rebaixava em silêncio o
//                correspondente que o teste dizia estar simulando.
async function abrirComo(pag, papel, { permissoes, guardadas, bancoMudo, tipo } = {}) {
  const tipoReal = papel === 'correspondente' ? 'cca' : (tipo || 'corretor');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.addInitScript(([papel, guardadas, tipoReal]) => {
    localStorage.setItem('a1_token', 'tok');
    localStorage.setItem('a1_slug', 'thecred');
    localStorage.setItem('a1_user', JSON.stringify(
      papel === 'gestor'
        ? { id:'u1', tenant_id:'t1', name:'Julio', role:'owner', cpf:'99999999999' }
      : papel === 'correspondente'
        ? { id:'p9', tenant_id:'t1', name:'Corresp', role:'partner', type:'cca',
            cpf:'44444444444', permissions: guardadas || {} }
        : { id:'p3', tenant_id:'t1', name:'Ana Souza', role:'partner', type:tipoReal,
            cpf:'33333333333', permissions: guardadas || {} }));
    window.confirm = () => true;
    window.__TOASTS = [];
    // __POSTS só era um array vazio: ninguém o alimentava, e "createCase() não
    // grava nada" comparava zero com zero — passava com a tela gravando à
    // vontade. O gancho no fetch é o que transforma a verificação em prova.
    window.__POSTS  = [];
    const _f = window.fetch;
    window.fetch = function(url, o){
      if (o && o.method && o.method !== 'GET') window.__POSTS.push({url:String(url), m:o.method, body:o.body});
      return _f.apply(this, arguments);
    };
  }, [papel, guardadas, tipoReal]);
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, r => {
    const u = r.request().url(), m = r.request().method();
    if (/a1_partners\?id=eq\.(p3|p9)/.test(u)) {
      if (bancoMudo) return r.fulfill({ status: 500, contentType:'application/json', body:'{}' });
      return r.fulfill({ status:200, contentType:'application/json',
        body: JSON.stringify([{ permissions: permissoes || {}, type:tipoReal, perfil_id:null }]) });
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
// Toda escrita que tenha chegado a a1_cases. É a prova de que a recusa é de
// verdade, e não só um modal que não abriu.
const gravacoesDeCaso = p => p.evaluate(() =>
  (window.__POSTS || []).filter(x => /a1_cases/.test(x.url)).map(x => x.m + ' ' + x.url));
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

  // ── 2. Quem PODE criar precisa ter por onde ──────────────────────────────
  //
  // Este trecho provava o contrário: que NINGUÉM via o botão, gestor incluído.
  // A expectativa nasceu quando 05a1c6d tirou os atalhos de Repasse do
  // cabeçalho global — decisão certa, atalho de um módulo não pertence ao topo
  // de um sistema de vários. Só que o Arquivados foi remontado dentro do módulo
  // e o Novo Repasse não foi. O teste então carimbou a ausência como regra, e
  // por isso ficou verde enquanto analista e correspondente perdiam a única
  // porta de entrada da criação manual — sem nada no cadastro ter mudado.
  //
  // É o erro que este repositório já pagou três vezes: o teste mentindo junto
  // com a tela. A regra de verdade é a do dono, e é a mesma do banco
  // (a1_cases_repasse_create_capability): gestor, analista e correspondente.
  //
  // Por conteúdo e não por contagem: cada linha diz QUEM é e o que espera.
  console.log('\nO botão existe, e só para quem a política deixa criar');
  for (const [rotulo, papel, opts, esperado] of [
    ['gestor',                          'gestor',         {}, true],
    ['analista com a chave marcada',    'parceiro',       { tipo:'analista', permissoes: { criar_repasses:true } }, true],
    ['correspondente com a chave',      'correspondente', { permissoes: { criar_repasses:true } }, true],
    // O inverso, que é o que o dono proibiu: a criação manual é da retaguarda.
    ['analista SEM a chave',            'parceiro',       { tipo:'analista', permissoes: { criar_repasses:false } }, false],
    ['correspondente SEM a chave',      'correspondente', { permissoes: {} }, false],
    ['corretor com a chave marcada',    'parceiro',       { tipo:'corretor', permissoes: { criar_repasses:true } }, false],
    ['coordenador com a chave marcada', 'parceiro',       { tipo:'coordenador', permissoes: { criar_repasses:true } }, false],
    // `gerente` é marca de PARCEIRO, e a política não a aceita aqui: ela exige
    // a1_e_gestor() (que é papel fora de 'partner') OU tipo analista/cca. Um
    // gerente que seja corretor continua sem criar manualmente — e a tela tem de
    // concordar com o banco, senão o formulário abre para ser recusado no fim.
    // O gerente que é correspondente já está coberto duas linhas acima: quem o
    // deixa entrar é o TIPO dele, não a marca.
    ['gerente que é corretor',          'parceiro',       { tipo:'corretor', permissoes: { gerente:true } }, false],
  ]) {
    for (const pag of ['repasse.html','listagem.html','andamento.html']) {
      const { b, p, erros } = await abrirComo(pag, papel, opts);
      // O primeiro paint só é invariante para quem NÃO pode: esse não vê o botão
      // em instante nenhum, que era o defeito relatado. Para quem pode, aparecer
      // cedo é o comportamento desejado — exigir o contrário transformaria a
      // trava em atraso.
      if (!esperado) {
        checa(`${pag} · ${rotulo}: não aparece em instante nenhum`, !(await botaoVisivel(p)));
      }
      await p.waitForTimeout(1800);
      checa(`${pag} · ${rotulo}: ${esperado ? 'vê' : 'não vê'} Novo Repasse`,
        (await botaoVisivel(p)) === esperado);
      todosErros.push(...erros); await b.close();
    }
  }

  // O botão tem de estar DENTRO do módulo Repasse, ao lado de Arquivados — não
  // solto no cabeçalho global, que foi justamente o que 05a1c6d corrigiu.
  console.log('\nE ele mora dentro do módulo, não no cabeçalho');
  {
    const { b, p, erros } = await abrirComo('repasse.html', 'gestor', {});
    await p.waitForTimeout(1800);
    const onde = await p.evaluate(() => {
      const el = document.querySelector('[onclick="openNewCase()"]');
      if (!el) return 'ausente';
      if (el.closest('.hdr, header, #hdr, .hdr-right')) return 'cabeçalho';
      return el.closest('#tab-repasse') ? 'módulo Repasse' : 'outro lugar';
    });
    checa('fica no módulo Repasse', onde === 'módulo Repasse', onde);
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
    // O espelho da verificação acima, e é ele que impede a trava de virar
    // exagero: o gestor NÃO passa pela consulta de permissão de parceiro, então
    // o banco mudo não pode tirar dele o botão. Antes daqui saía o contrário —
    // "gestor também não recebe" — porque o botão não existia para ninguém.
    const { b, p, erros } = await abrirComo('repasse.html', 'gestor', { bancoMudo:true });
    await p.waitForTimeout(1800);
    checa('gestor continua com o botão mesmo com o banco mudo', await botaoVisivel(p));
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

    // Conta só gravação em a1_cases: o heartbeat da sessão e as RPCs de módulo
    // também são POST, e um total geral tornaria a verificação uma loteria.
    await p.evaluate(() => { try { createCase(); } catch {} });
    await p.waitForTimeout(500);
    const gravou = await gravacoesDeCaso(p);
    checa('createCase() não grava nada', gravou.length === 0, gravou.join(' / '));
    todosErros.push(...erros); await b.close();
  }
  {
    // E o inverso: quem pode continua abrindo normalmente. "Quem pode" hoje é
    // retaguarda com a chave marcada — Analista ou Correspondente (CCA). Este
    // é o lado que não pode apodrecer: uma tela que barra todo mundo passaria
    // em todas as verificações negativas acima e quebraria o trabalho de quem
    // cria repasse à mão todo dia.
    const { b, p, erros } = await abrirComo('repasse.html', 'parceiro',
      { permissoes: { criar_repasses:true }, tipo:'cca' });
    await p.waitForTimeout(1800);
    await p.evaluate(() => { try { openNewCase(); } catch {} });
    await p.waitForTimeout(400);
    checa('correspondente com a chave abre o formulário normalmente', await modalAberto(p));
    todosErros.push(...erros); await b.close();
  }
  {
    const { b, p, erros } = await abrirComo('repasse.html', 'parceiro',
      { permissoes: { criar_repasses:true }, tipo:'analista' });
    await p.waitForTimeout(1800);
    await p.evaluate(() => { try { openNewCase(); } catch {} });
    await p.waitForTimeout(400);
    checa('analista com a chave também abre', await modalAberto(p));
    todosErros.push(...erros); await b.close();
  }
  {
    // A REGRA NOVA, do lado que ela fecha: corretor não cria manualmente, nem
    // com a chave marcada pelo gestor. A tela precisa recusar sozinha, senão a
    // pessoa preenche o cadastro inteiro para o banco negar no fim — que é
    // exatamente o desencontro que este arquivo existe para não deixar voltar.
    const { b, p, erros } = await abrirComo('repasse.html', 'parceiro',
      { permissoes: { criar_repasses:true }, tipo:'corretor' });
    await p.waitForTimeout(1800);
    await p.evaluate(() => { try { openNewCase(); } catch {} });
    await p.waitForTimeout(400);
    checa('corretor COM a chave ainda assim não abre — criação manual é da retaguarda',
          !(await modalAberto(p)));
    await p.evaluate(() => { try { createCase(); } catch {} });
    await p.waitForTimeout(500);
    const gravouCorretor = await gravacoesDeCaso(p);
    checa('e createCase() pelo console também não grava',
          gravouCorretor.length === 0, gravouCorretor.join(' / '));
    todosErros.push(...erros); await b.close();
  }

  // ── 5. Configurações não monta para parceiro ─────────────────────────────
  console.log('\n/configuracoes digitado na barra de endereço');
  {
    const { b, p, erros } = await abrirComo('configuracoes.html', 'parceiro',
      { permissoes: {} });
    await p.waitForTimeout(1500);
    // Devolvido para a GERAL, e não para o Repasse. Mandar para um módulo
    // específico presumia que o Repasse é o módulo dele — o que deixou de ser
    // verdade quando o cliente passou a ter cinco — e encadeava um segundo
    // desvio para /andamento quando ele não podia ver aquele painel.
    const saiu = await p.evaluate(() => !location.pathname.includes('configuracoes'));
    checa('corretor não fica em Configurações', saiu, `→ ${await p.evaluate(()=>location.pathname)}`);
    checa('e é devolvido para a Geral',
      await p.evaluate(() => location.pathname.includes('geral')),
      `→ ${await p.evaluate(()=>location.pathname)}`);
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
