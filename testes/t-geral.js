// A tela Geral — a porta de entrada do sistema.
//
// POR QUE ESTE ARQUIVO EXISTE
// Esta tela é a primeira coisa que toda pessoa vê ao entrar, e ela fala de
// TODOS os módulos ao mesmo tempo. Duas coisas podem dar muito errado aqui, e
// as duas são silenciosas:
//
//   1. Mostrar módulo que o cliente não contratou. Não é enfeite a mais: é
//      prometer uma tela que o RLS vai recusar, e o cliente descobre clicando.
//   2. Baixar processo para contar. Com 235 funciona; com 40 mil o navegador
//      trava na tela INICIAL do sistema — a pior de todas para travar.
//
// A segunda é a que nenhum teste pega olhando o resultado: a tela fica igual.
// Por isso aqui a prova é sobre as REQUISIÇÕES, não sobre o desenho.
const { abrir, checa, resumo } = require('./comum');

const TODOS = ['repasse','PRE_ANALISE','COMERCIAL','crm','registro'];

// Uma corretora de verdade: papel `partner`, sem `ver_dashboard_repasse`. O
// `abrir` comum entra sempre como gestor, e gestor vê painel — com ele, a
// prova abaixo passaria sem tocar na regra.
const { chromium } = require('/home/user/siimob/node_modules/playwright');
const { responder, liberarModulos, negarModulos } = require('./fake');
async function abrirComoCorretor(){
  liberarModulos([]); negarModulos(['registro']);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{ width:1280, height:900 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.addInitScript(() => {
    localStorage.setItem('a1_token','tok');
    localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify({ id:'p3', tenant_id:'t1',
      name:'Ana Souza', role:'partner', type:'corretor', cpf:'52998224725',
      permissions:{ ver_repasses:true } }));
    window.__XSS = 0;
  });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status:200, contentType:'text/css', body:'' }));
  await p.route(/supabase\.co/, r => {
    let d; try { d = responder(r.request().url(), r.request().method(), r.request().postData()); } catch { d = []; }
    r.fulfill({ status:200, contentType:'application/json',
                headers:{ 'content-range':'0-1/2' }, body: JSON.stringify(d) });
  });
  await p.goto('http://localhost:' + (process.env.PORTA_TESTE || 8099) + '/geral.html', { waitUntil:'load' });
  return { b, p, erros };
}

async function pedidos(p){
  return p.evaluate(() => performance.getEntriesByType('resource').map(r => r.name));
}

(async () => {
  const todosErros = [];

  console.log('== SÓ APARECE O QUE O CLIENTE CONTRATOU ==');
  {
    // O cliente de hoje: só Repasse. É a situação dos três clientes reais, e é
    // com ela que "nenhum cliente foi afetado" significa alguma coisa.
    // `semModulos:['registro']` é necessário e a razão merece registro: no
    // andaime, os módulos ANTIGOS respondem "sim" por padrão, e Registro é um
    // deles. Em produção ele é licenciado como qualquer outro. Sem esta linha o
    // teste provaria o padrão do falso, não a regra do sistema.
    const { b, p, erros } = await abrir('geral.html',
      { modulos:['repasse'], semModulos:['registro'], filtros:false });
    const barra = await p.locator('.sb-mods').textContent();
    checa('a aba de Repasse aparece', /Repasse/.test(barra), barra);
    checa('e a de Leads NÃO', !/Leads/.test(barra), barra);
    checa('nem a de Pré-análise', !/Pré-análise/.test(barra), barra);
    checa('nem a de Venda', !/Venda/.test(barra), barra);
    checa('nem a de Registro', !/Registro/.test(barra), barra);
    // Não basta a aba sumir: o degrau do módulo não pode existir no DOM. O que
    // está no DOM alguém acha com o inspetor e com a busca da paleta.
    // Os módulos deixaram de ser cinco cartões iguais e viraram uma JORNADA —
    // eles são uma sequência (lead → pré-análise → venda → repasse → registro),
    // e o desenho passou a dizer isso. Os cartões de cima agora respondem outra
    // pergunta: o estado da operação somando tudo.
    const jorn = await p.locator('#jornada').textContent();
    checa('e o degrau de Leads não foi nem desenhado', !/Leads/.test(jorn), jorn.slice(0,150));
    checa('o degrau do Repasse foi', /Repasse/.test(jorn), jorn.slice(0,150));
    checa('nenhum XSS', (await p.evaluate(() => window.__XSS || 0)) === 0);
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== COM TUDO LIBERADO, TUDO APARECE ==');
  {
    const { b, p, erros } = await abrir('geral.html', { modulos:TODOS, filtros:false });
    const barra = await p.locator('.sb-mods').textContent();
    checa('as cinco abas de módulo saem na ordem do processo',
      /Geral[\s\S]*Leads[\s\S]*Pré-análise[\s\S]*Venda[\s\S]*Repasse[\s\S]*Registro/.test(barra),
      barra.replace(/\s+/g,' ').slice(0,160));
    const degraus = await p.locator('#jornada .sb-degrau').count();
    checa('e a jornada tem um degrau por módulo', degraus === 5, 'foram ' + degraus);
    checa('na ordem do processo', await p.evaluate(() =>
      [...document.querySelectorAll('#jornada .sb-degrau-rot')].map(e => e.textContent.trim())
        .join('|') === 'Leads|Pré-análise|Venda|Repasse|Registro'),
      await p.evaluate(() => [...document.querySelectorAll('#jornada .sb-degrau-rot')].map(e=>e.textContent.trim()).join('|')));

    // Os números vêm do resumo do banco, não de uma contagem no navegador.
    // 4 pré-análises e 1 venda em aberto é o que o cenário tem.
    const jt = (await p.locator('#jornada').textContent()).replace(/\s+/g,' ');
    checa('o número da Pré-análise vem do resumo', /Pré-análise\s*4/.test(jt), jt.slice(0,220));

    // E os cartões de cima somam os módulos em vez de repetir cada um: 4 + 1 +
    // 3 = 8 em aberto. Repetir a jornada em cartões ensinaria o olho a pular a
    // segunda leitura.
    const kt = (await p.locator('#kpis').textContent()).replace(/\s+/g,' ');
    checa('os indicadores somam os módulos, não os repetem',
      /8\s*Em aberto, somando os módulos/.test(kt), kt.slice(0,200));
    checa('e dizem o que está parado', /Parados há mais de 30 dias/.test(kt), kt.slice(0,200));

    checa('o quadro "Onde o trabalho está" mostra etapa com nome e contagem',
      /Aprovada/.test(await p.locator('#blocos').textContent()));
    checa('nenhum XSS', (await p.evaluate(() => window.__XSS || 0)) === 0);
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== A TELA NÃO BAIXA PROCESSO PARA CONTAR ==');
  {
    const { b, p, erros } = await abrir('geral.html', { modulos:TODOS, filtros:false });
    const urls = await pedidos(p);

    // Nenhuma leitura de coleção pode sair sem teto. `limit=` ou `Range:` é o
    // que separa uma tela que cresce de uma que trava — e o jeito de garantir
    // isso é não deixar passar a primeira consulta sem limite.
    const semTeto = urls.filter(u =>
      /\/rest\/v1\/a1_(cases|pre_analises|comerciais)\?/.test(u) && !/[?&]limit=/.test(u));
    checa('nenhuma consulta de processo sai sem limite', semTeto.length === 0,
      semTeto[0] || '');

    // E a contagem tem de ser a do banco: uma chamada só.
    const resumos = urls.filter(u => /rpc\/a1_resumo_geral/.test(u));
    checa('o resumo é pedido ao banco, e uma vez só', resumos.length === 1,
      resumos.length + ' chamada(s)');

    // A agenda pede o mês, não o histórico.
    const agenda = urls.filter(u => /a1_cases\?.*evaluation_expiry=gte/.test(u));
    checa('a agenda pede só a janela do mês', agenda.length === 1, String(agenda.length));
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== O PRAZO É LIDO CERTO ==');
  {
    // O cenário tem uma avaliação vencida há 2 dias, uma vencendo hoje e uma em
    // 5 dias. Antes de existir esta prova, a tela escrevia "em NaNd" — e
    // escrevia isso porque um processo SEM prazo cadastrado entrava na conta
    // como vencido. Processo sem prazo não está atrasado; está sem prazo.
    const { b, p, erros } = await abrir('geral.html', { modulos:TODOS, filtros:false });
    const fila = (await p.locator('#blocos').textContent()).replace(/\s+/g,' ');
    checa('a vencida diz há quantos dias', /vencida há 2d/.test(fila), fila.slice(0,240));
    checa('a de hoje diz que vence hoje', /vence hoje/.test(fila), fila.slice(0,240));
    checa('a futura diz em quantos dias', /em 5d/.test(fila), fila.slice(0,240));
    checa('e NENHUM prazo saiu como NaN', !/NaN/.test(fila), fila.slice(0,240));

    const hero = (await p.locator('#hero').textContent()).replace(/\s+/g,' ');
    checa('o cartão de saudação repete o que está apertado',
      /1 avaliação vencida/.test(hero) && /1 vence hoje/.test(hero), hero.slice(0,200));
    checa('e concorda em número — nada de "1 vencem"', !/1 vencem/.test(hero), hero);
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== A TELA GERAL É A PORTA DE ENTRADA, PARA TODO MUNDO ==');
  {
    // Esta prova já afirmou o CONTRÁRIO: que o corretor sem `ver_dashboard_*`
    // era desviado daqui para o quadro do módulo dele. O dono desfez a regra —
    // "sempre para a Geral, isso para todo usuário" — e ele tem razão: esta
    // tela não é o painel de um módulo, é o mapa de onde a pessoa está.
    //
    // O que continua valendo, e é o que esta prova guarda agora: o corretor vê
    // a tela, mas vê o QUE É DELE. a1_resumo_geral é security invoker e passa
    // pelo RLS como qualquer consulta.
    const { b, p, erros } = await abrirComoCorretor();
    await p.waitForTimeout(1100);
    checa('o corretor fica na tela Geral', /geral\.html/.test(p.url()), p.url());
    checa('e a tela monta para ele', (await p.locator('#jornada').count()) === 1);
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== O CASCO: SAUDAÇÃO, RELÓGIO E BUSCA ==');
  {
    const { b, p, erros } = await abrir('geral.html',
      { modulos:['repasse'], semModulos:['registro'], filtros:false });
    const hero = await p.locator('#hero').textContent();
    checa('a saudação usa o primeiro nome, não o nome inteiro',
      /Julio/.test(hero) && !/Julio [A-Z]/.test(hero), hero.slice(0,100));
    checa('a saudação combina com a hora da máquina', await p.evaluate(() => {
      const h = new Date().getHours();
      const esperado = h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
      return document.getElementById('hero').textContent.includes(esperado);
    }));
    checa('o relógio marca a hora, com dois pontos',
      /^\d{2}:\d{2}$/.test((await p.locator('#sb-relogio').textContent()).trim()));
    checa('o céu é desenhado', await p.evaluate(() => {
      const c = document.getElementById('sb-ceu');
      return !!c && c.width > 100 && c.height > 100;
    }));
    // O mesmo cliente tem de ter SEMPRE o mesmo céu. Estrela que muda de lugar
    // a cada F5 o olho lê como defeito, não como enfeite.
    checa('e o céu do cliente é sempre o mesmo', await p.evaluate(() => {
      const c = document.getElementById('sb-ceu');
      const antes = c.toDataURL();
      a1DesenharCeu();
      return c.toDataURL() === antes;
    }));

    // Ctrl+K é o atalho que o dono pediu. Ele abre a paleta, e a paleta só
    // oferece porta que a pessoa pode abrir.
    await p.keyboard.press('Control+k');
    await p.waitForTimeout(200);
    checa('Ctrl+K abre a busca', await p.locator('#sb-paleta').isVisible());
    const paleta = await p.locator('#sb-paleta-lista').textContent();
    checa('e ela não oferece módulo sem licença',
      !/Leads/.test(paleta) && !/Pré-análise/.test(paleta) && !/Registro/.test(paleta),
      paleta.replace(/\s+/g,' ').slice(0,220));
    checa('mas oferece o que existe', /Repasse/.test(paleta), paleta.slice(0,150));
    // Acento não pode atrapalhar: quem digita "config" acha "Configurações".
    await p.fill('#sb-paleta-campo', 'config');
    await p.waitForTimeout(150);
    checa('a busca ignora acento e pontuação',
      /Configurações/.test(await p.locator('#sb-paleta-lista').textContent()));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    checa('Esc fecha', !(await p.locator('#sb-paleta').isVisible()));

    checa('nenhum XSS', (await p.evaluate(() => window.__XSS || 0)) === 0);
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros) ? 1 : 0);
})();
