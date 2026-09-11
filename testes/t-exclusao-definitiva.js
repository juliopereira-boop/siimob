// Exclusão definitiva — a área de risco das Configurações.
//
// O pedido do dono: "coloque uma configuração, em alerta, de exclusão
// definitiva... só pode excluir se copiar esse código e colocar nessa área de
// exclusão. Aí vai aparecer as informações. Essa exclusão não tem volta".
//
// As verificações que importam aqui são todas NEGATIVAS, e é de propósito:
//   · quem não é gestor não tem o cartão no DOM (nem para achar na busca);
//   · achar o registro NÃO libera o botão — falta justificativa e o "entendi";
//   · o primeiro clique não apaga: abre a confirmação que repete quem vai sumir;
//   · registro com impedimento não mostra formulário nenhum;
//   · e quando nada foi achado, nenhuma requisição de exclusão sai.
// Provar só o caminho feliz deixaria passar exatamente o acidente que esta
// tela existe para evitar: apagar o processo errado num clique de reflexo.
//
// A autorização de verdade é do Postgres (a1_excluir_definitivo confere gestor,
// cliente, licença e dependência entre módulos) e está provada em
// testes/sql/prova-seguranca.sql. Aqui se prova a conversa com a pessoa.
const { chromium } = require('playwright');
const { responder, liberarModulos, XSS } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

// A ficha que o RPC a1_excluir_procurar devolve. O nome do cliente traz o XSS
// plantado: é texto do banco caindo em innerHTML, que é onde o sistema já se
// queimou seis vezes.
const FICHA_REPASSE = {
  modulo:'repasse', registro_id:'aaaaaaaa-1111-2222-3333-444444444444',
  codigo:'aaaaaaaa', titulo:'Maria ' + XSS, empreendimento:'Residencial das Flores',
  unidade:'B1 101', situacao:'Documentação', criado_em:'2026-08-01T10:00:00Z',
  filhos:{ historico_de_etapas:2, eventos:1, emails_sem_vinculo:0 }, impedimento:null
};
const FICHA_PA_TRAVADA = {
  modulo:'PRE_ANALISE', registro_id:'bbbbbbbb-1111-2222-3333-444444444444',
  codigo:'PA-003', titulo:'Pedro Titular', empreendimento:'Parque das Águas',
  unidade:'202', situacao:'Aprovada', criado_em:'2026-07-01T10:00:00Z',
  filhos:{ participantes:2, documentos:1 },
  impedimento:'Esta pré-análise já gerou a Venda CO-001. Exclua a Venda primeiro e volte aqui.'
};
const AUDITORIA = [{
  id:1, modulo:'repasse', registro_id:'99999999-1111-2222-3333-444444444444',
  codigo:'99999999', rotulo:'Cliente Antigo · Parque das Águas',
  justificativa:'duplicidade de lançamento ' + XSS, ator_nome:'Julio ' + XSS,
  excluido_em:'2026-09-10T12:00:00Z'
}];

// Abridor próprio: preciso trocar o papel do usuário e responder aos DOIS RPCs
// novos, que o fake compartilhado não conhece (ele devolve {ok:true} para
// qualquer /rpc/, e um {ok:true} no lugar da lista de fichas faria a tela
// "achar" um registro que não existe).
async function abrir({ papel = 'owner', tipo = null, modulos = [],
                       achados = [], falhaBusca = null, falhaExclusao = null,
                       auditoria = AUDITORIA } = {}) {
  liberarModulos(modulos);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{ width:1400, height:950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  p.on('console', m => { const t = m.text();
    // O 400 é o cenário: há testes aqui que fazem o banco RECUSAR de propósito,
    // e o navegador registra toda resposta 4xx no console. Sem esta exceção, a
    // prova de que a recusa é bem tratada reprovaria a si mesma.
    if (m.type() === 'error'
        && !/ERR_CONNECTION|ERR_TUNNEL|fonts\.g|favicon|net::/.test(t)
        && !/Failed to load resource.*400/.test(t)) erros.push('console: ' + t); });
  await p.addInitScript(([pp, tt]) => {
    localStorage.setItem('a1_token','tok');
    localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify({ id:'u1', tenant_id:'t1', name:'Julio',
      role:pp, type:tt, cpf:'99999999999', permissions:{} }));
    window.__XSS = 0;
    window.confirm = () => true;
    window.__POSTS = [];
    const f = window.fetch;
    window.fetch = function (u, o) {
      if (o && o.method && o.method !== 'GET') window.__POSTS.push({ url:String(u), m:o.method, body:o.body });
      return f.apply(this, arguments);
    };
  }, [papel, tipo]);
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, r => {
    const u = r.request().url();
    const responde = (status, corpo) => r.fulfill({ status, contentType:'application/json',
      headers:{ 'content-range':'0-1/2' }, body:JSON.stringify(corpo) });

    if (/rpc\/a1_excluir_procurar/.test(u)) {
      if (falhaBusca) return responde(400, { message: falhaBusca });
      return responde(200, achados);
    }
    if (/rpc\/a1_excluir_definitivo/.test(u)) {
      if (falhaExclusao) return responde(400, { message: falhaExclusao });
      return responde(200, { ok:true });
    }
    if (/a1_exclusoes/.test(u)) return responde(200, auditoria);

    let d; try { d = responder(u, r.request().method(), r.request().postData()); } catch { d = []; }
    return responde(200, d);
  });
  await p.goto(BASE + '/configuracoes.html', { waitUntil:'load' });
  await p.waitForTimeout(1700);
  return { b, p, erros };
}

const abrirTela = async p => {
  await p.evaluate(() => openCfgView('excdef'));
  await p.waitForTimeout(250);
};
const procurar = async (p, codigo) => {
  await p.fill('#exc-codigo', codigo);
  await p.click('#exc-btn-procurar');
  await p.waitForTimeout(250);
};
const excluiuNoServidor = p => p.evaluate(() =>
  (window.__POSTS || []).filter(x => /a1_excluir_definitivo/.test(x.url)));

(async () => {
  const todosErros = [];

  // ── 1. Quem não é gestor não tem NADA disto ──────────────────────────────
  // Correspondente entra em Configurações de propósito (a tela tem código
  // dedicado a ele). Esconder o cartão com CSS deixaria a sub-tela alcançável
  // pelo inspetor e pela busca do hub; o que fecha é não existir.
  console.log('\nSem ser gestor, a área de risco não existe');
  {
    const { b, p, erros } = await abrir({ papel:'partner', tipo:'cca', modulos:['PRE_ANALISE','COMERCIAL'] });
    checa('o cartão não chega ao DOM', (await p.locator('#cfg-card-excdef').count()) === 0);
    checa('nem o grupo "Área de risco"', (await p.locator('#cfg-grupo-perigo').count()) === 0);
    checa('nem a sub-tela', (await p.locator('#cfg-view-excdef').count()) === 0);
    checa('e o roteador não conhece a tela', await p.evaluate(() => !CFG_VIEWS.includes('excdef')));
    // Contar `:not(.oculto)` não basta: filtrarHub PULA o cartão já escondido
    // por regra (os de gestor), então ele nunca ganha a classe e entraria na
    // conta. A pergunta certa é o que está de fato visível na tela.
    checa('a busca do hub não acha "exclusão"', await p.evaluate(() => {
      filtrarHub('exclus');
      const achou = [...document.querySelectorAll('#cfg-hub .cfg-hub-card')]
        .filter(c => c.style.display !== 'none' && !c.classList.contains('oculto')).length;
      filtrarHub('');
      return achou === 0;
    }));
    todosErros.push(...erros); await b.close();
  }

  // ── 2. Para o gestor, existe e está na busca ─────────────────────────────
  console.log('\nPara o gestor, o cartão está no hub e na busca');
  {
    const { b, p, erros } = await abrir({ achados:[FICHA_REPASSE] });
    checa('o cartão existe', (await p.locator('#cfg-card-excdef').count()) === 1);
    checa('dentro do grupo "Área de risco"', await p.evaluate(() =>
      !!document.querySelector('#cfg-grupo-perigo #cfg-card-excdef')
      && document.getElementById('cfg-grupo-perigo').textContent.includes('Área de risco')));
    checa('e a busca do hub acha por "exclusão"', await p.evaluate(() => {
      filtrarHub('exclus');
      const vis = [...document.querySelectorAll('#cfg-hub .cfg-hub-card:not(.oculto)')]
        .map(c => c.textContent.trim());
      filtrarHub('');
      return vis.length === 1 && vis[0].includes('Exclusão definitiva');
    }));
    // Sem licença dos módulos novos, a tela não pode prometer que procura
    // neles: o banco devolveria vazio e a pessoa concluiria que o cartão dela
    // não existe mais.
    await abrirTela(p);
    checa('sem licença, a cobertura anuncia só o Repasse', await p.evaluate(() => {
      const t = document.getElementById('exc-cobertura').textContent;
      return t.includes('Repasse') && !t.includes('Pré-análise') && !t.includes('Venda');
    }));
    todosErros.push(...erros); await b.close();
  }
  {
    const { b, p, erros } = await abrir({ modulos:['PRE_ANALISE','COMERCIAL'], achados:[FICHA_REPASSE] });
    await abrirTela(p);
    checa('com os três módulos, a cobertura nomeia os três', await p.evaluate(() => {
      const t = document.getElementById('exc-cobertura').textContent;
      return t.includes('Repasse') && t.includes('Pré-análise') && t.includes('Venda');
    }));
    todosErros.push(...erros); await b.close();
  }

  // ── 3. Colar o código MOSTRA antes de deixar apagar ──────────────────────
  console.log('\nO código cola, a ficha aparece, e o botão ainda não');
  {
    const { b, p, erros } = await abrir({ achados:[FICHA_REPASSE] });
    await abrirTela(p);
    await procurar(p, 'aaaaaaaa-1111-2222-3333-444444444444');

    const ficha = await p.evaluate(() => document.getElementById('exc-resultado').innerText);
    // Conteúdo, não quantidade: é por estes campos que a pessoa reconhece o
    // processo. Uma ficha que só mostrasse o id pediria para ela conferir
    // exatamente aquilo que já colou.
    checa('a ficha mostra o cliente', ficha.includes('Maria'));
    checa('mostra o empreendimento', ficha.includes('Residencial das Flores'));
    checa('mostra a unidade', ficha.includes('B1 101'));
    checa('mostra a situação atual', ficha.includes('Documentação'));
    checa('mostra o módulo em que está', ficha.includes('Repasse'));
    // O dono precisa saber o que vai junto ANTES, não depois.
    checa('e diz o que some junto, por extenso',
      ficha.includes('2 movimentações no histórico') && ficha.includes('1 eventos e comentários'), ficha);
    checa('e-mail com contagem zero não é listado', !ficha.includes('e-mails na fila'), ficha);

    checa('o botão de excluir existe mas nasce desligado',
      await p.evaluate(() => { const b = document.getElementById('exc-btn-excluir');
        return !!b && b.disabled === true; }));

    // Só a justificativa não basta, e só a marca também não. As duas coisas
    // são exigidas porque cada uma sozinha já aconteceu por engano.
    await p.fill('#exc-justificativa', 'duplicidade de lançamento');
    await p.waitForTimeout(120);
    checa('com justificativa mas sem o "entendi", segue desligado',
      await p.evaluate(() => document.getElementById('exc-btn-excluir').disabled === true));
    await p.fill('#exc-justificativa', 'curto');
    await p.check('#exc-ciente');
    await p.waitForTimeout(120);
    checa('com o "entendi" mas justificativa curta, segue desligado',
      await p.evaluate(() => document.getElementById('exc-btn-excluir').disabled === true));
    await p.fill('#exc-justificativa', 'duplicidade: mesma unidade lançada duas vezes');
    await p.waitForTimeout(120);
    checa('com as duas coisas, liga',
      await p.evaluate(() => document.getElementById('exc-btn-excluir').disabled === false));

    // ── O primeiro clique NÃO apaga ────────────────────────────────────────
    await p.click('#exc-btn-excluir');
    await p.waitForTimeout(200);
    checa('o primeiro clique não manda nada para o servidor',
      (await excluiuNoServidor(p)).length === 0);
    const conf = await p.evaluate(() => document.getElementById('exc-resultado').innerText);
    checa('ele abre a confirmação, que repete quem vai sumir',
      conf.includes('Confirma apagar para sempre') && conf.includes('Maria')
      && conf.includes('Residencial das Flores'), conf);
    // Cancelar tem de devolver a pessoa ao formulário sem ter apagado nada.
    await p.click('button:has-text("Cancelar")');
    await p.waitForTimeout(200);
    checa('e Cancelar volta ao formulário sem apagar nada',
      (await excluiuNoServidor(p)).length === 0
      && await p.evaluate(() => !!document.getElementById('exc-btn-excluir')));

    // ── O segundo clique apaga, com o que a pessoa escreveu ────────────────
    await p.fill('#exc-justificativa', 'duplicidade: mesma unidade lançada duas vezes');
    await p.check('#exc-ciente');
    await p.waitForTimeout(120);
    await p.click('#exc-btn-excluir');
    await p.waitForTimeout(150);
    await p.click('#exc-btn-apagar');
    await p.waitForTimeout(350);

    const enviados = await excluiuNoServidor(p);
    checa('aí sim sai UMA chamada de exclusão', enviados.length === 1, JSON.stringify(enviados));
    const corpo = enviados.length ? JSON.parse(enviados[0].body) : {};
    checa('com o módulo e o id exatos do que estava na ficha',
      corpo.p_modulo === 'repasse'
      && corpo.p_id === 'aaaaaaaa-1111-2222-3333-444444444444', JSON.stringify(corpo));
    checa('e com a justificativa digitada, não um texto genérico',
      corpo.p_justificativa === 'duplicidade: mesma unidade lançada duas vezes', JSON.stringify(corpo));
    checa('a tela confirma que o registro não existe mais',
      (await p.evaluate(() => document.getElementById('exc-resultado').innerText)).includes('Excluído'));

    todosErros.push(...erros); await b.close();
  }

  // ── 4. Impedimento vindo do banco ────────────────────────────────────────
  // A recusa é a mesma que o botão levaria. Mostrá-la na ficha evita a pessoa
  // escrever a justificativa inteira para só então descobrir que não dá.
  console.log('\nRegistro travado por outro módulo nem oferece o botão');
  {
    const { b, p, erros } = await abrir({ modulos:['PRE_ANALISE','COMERCIAL'], achados:[FICHA_PA_TRAVADA] });
    await abrirTela(p);
    await procurar(p, 'PA-003');
    const t = await p.evaluate(() => document.getElementById('exc-resultado').innerText);
    checa('a tela repete o motivo que o banco deu', t.includes('CO-001'), t);
    checa('não há campo de justificativa',
      (await p.locator('#exc-justificativa').count()) === 0);
    checa('nem botão de excluir', (await p.locator('#exc-btn-excluir').count()) === 0);
    todosErros.push(...erros); await b.close();
  }

  // ── 5. Código que não acha nada ──────────────────────────────────────────
  console.log('\nCódigo errado não apaga nada nem oferece botão');
  {
    const { b, p, erros } = await abrir({ achados:[] });
    await abrirTela(p);
    await procurar(p, 'ffffffff-ffff-ffff-ffff-ffffffffffff');
    const t = await p.evaluate(() => document.getElementById('exc-resultado').innerText);
    checa('a tela diz que não achou', /não achei/i.test(t), t);
    checa('sem oferecer botão nenhum', (await p.locator('#exc-btn-excluir').count()) === 0);
    checa('e nenhuma exclusão saiu', (await excluiuNoServidor(p)).length === 0);
    todosErros.push(...erros); await b.close();
  }

  // ── 6. Prefixo ambíguo: a pessoa escolhe, não a sorte ────────────────────
  console.log('\nDois candidatos: quem escolhe é a pessoa');
  {
    const { b, p, erros } = await abrir({ modulos:['PRE_ANALISE','COMERCIAL'],
      achados:[FICHA_REPASSE, { ...FICHA_PA_TRAVADA, impedimento:null, codigo:'PA-009' }] });
    await abrirTela(p);
    await procurar(p, 'aaaaaaaa');
    checa('a tela avisa que o código casa com dois',
      (await p.evaluate(() => document.getElementById('exc-resultado').innerText)).includes('2 registros'));
    checa('e nenhum vem pré-selecionado com formulário aberto',
      (await p.locator('#exc-justificativa').count()) === 0);
    // Escolher o segundo e conferir que é o segundo que vai no corpo — um
    // `achados[0]` fixo passaria despercebido com um resultado só.
    await p.evaluate(() => excDefEscolher(1));
    await p.waitForTimeout(150);
    await p.fill('#exc-justificativa', 'cancelamento formal do negócio');
    await p.check('#exc-ciente');
    await p.waitForTimeout(120);
    await p.click('#exc-btn-excluir');
    await p.waitForTimeout(150);
    await p.click('#exc-btn-apagar');
    await p.waitForTimeout(350);
    const corpo = JSON.parse((await excluiuNoServidor(p))[0].body);
    checa('apaga o que a pessoa escolheu, não o primeiro da lista',
      corpo.p_modulo === 'PRE_ANALISE'
      && corpo.p_id === 'bbbbbbbb-1111-2222-3333-444444444444', JSON.stringify(corpo));
    todosErros.push(...erros); await b.close();
  }

  // ── 7. Recusa do banco no momento da exclusão ────────────────────────────
  // O impedimento pode nascer entre a busca e o clique (outra pessoa criou o
  // Venda no meio). O que a tela não pode fazer é dizer "excluído".
  console.log('\nSe o banco recusar no último instante, a tela não mente');
  {
    const { b, p, erros } = await abrir({ achados:[FICHA_REPASSE],
      falhaExclusao:'Esta pré-análise já gerou a Venda CO-777. Exclua a Venda primeiro e volte aqui.' });
    await abrirTela(p);
    await procurar(p, 'aaaaaaaa-1111-2222-3333-444444444444');
    await p.fill('#exc-justificativa', 'duplicidade de lançamento na base');
    await p.check('#exc-ciente');
    await p.waitForTimeout(120);
    await p.click('#exc-btn-excluir');
    await p.waitForTimeout(150);
    await p.click('#exc-btn-apagar');
    await p.waitForTimeout(350);
    const t = await p.evaluate(() => document.getElementById('exc-resultado').innerText);
    checa('mostra o motivo que o banco deu, não "tente novamente"', t.includes('CO-777'), t);
    checa('e não diz que excluiu', !t.includes('Excluído'), t);
    todosErros.push(...erros); await b.close();
  }

  // ── 8. A auditoria fica à vista ──────────────────────────────────────────
  console.log('\nA auditoria aparece na própria tela');
  {
    const { b, p, erros } = await abrir({ achados:[FICHA_REPASSE] });
    await abrirTela(p);
    await p.waitForTimeout(300);
    const t = await p.evaluate(() => document.getElementById('exc-historico').innerText);
    checa('a lista mostra a justificativa de quem apagou antes',
      t.includes('duplicidade de lançamento'), t);
    checa('e quem foi', t.includes('Julio'), t);
    checa('e qual registro', t.includes('Cliente Antigo'), t);
    todosErros.push(...erros); await b.close();
  }

  // ── 9. Nada do banco entra cru no HTML ───────────────────────────────────
  {
    const { b, p, erros } = await abrir({ achados:[FICHA_REPASSE] });
    await abrirTela(p);
    await procurar(p, 'aaaaaaaa-1111-2222-3333-444444444444');
    await p.fill('#exc-justificativa', 'duplicidade de lançamento na base');
    await p.check('#exc-ciente');
    await p.waitForTimeout(120);
    await p.click('#exc-btn-excluir');
    await p.waitForTimeout(300);
    checa('nenhum XSS disparou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros); await b.close();
  }

  process.exit(resumo(todosErros));
})();
