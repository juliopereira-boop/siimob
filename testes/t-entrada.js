// Por onde o sistema abre, depois do login.
//
// POR QUE ESTE ARQUIVO EXISTE
// O dono pediu, com todas as letras: "ao fazer login, é para ir para a tela de
// Geral, sempre, isso para todo usuário". Isso nunca teve prova. O redirecionamento
// mora em login.html, e uma linha trocada por engano num arquivo de 800 linhas
// manda todo mundo para a tela errada sem quebrar nada — o sistema funciona, só
// abre no lugar errado, e ninguém percebe até o dono reclamar.
//
// A única exceção é o despachante: o Registro é o único módulo dele, e passar
// pela Geral seria uma parada a mais para chegar no mesmo lugar.
const { chromium } = require('playwright');
const { responder, liberarModulos } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

// Entra pela tela de login DE VERDADE: digita, clica e vê para onde o navegador
// vai. Testar chamando redirectAfterLogin() direto provaria a função, não o
// caminho que a pessoa percorre.
async function entrar(usuario, modulos) {
  liberarModulos(modulos || []);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  // `localStorage.clear()` NÃO entra aqui. addInitScript roda a cada navegação,
  // inclusive na que o próprio login dispara — e apagaria a sessão recém-criada
  // no instante em que a tela de destino abrisse, mandando a pessoa de volta
  // para o login. O andaime estaria provando um defeito que ele mesmo causou.
  await p.addInitScript(() => { window.__XSS = 0; });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status:200, contentType:'text/css', body:'' }));
  await p.route(/supabase\.co/, r => {
    const url = r.request().url();
    // O login responde com a sessão do usuário que o teste está fingindo ser.
    if (/rpc\/a1_(partner_)?login/.test(url)) {
      r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({
        token:'tok', user_id:usuario.id, name:usuario.name, role:usuario.role,
        type:usuario.type || null, tenant_id:'t1', tenant_name:'THE CRED',
        plan:'pro', max_users:10, status:'active' }) });
      return;
    }
    let d; try { d = responder(url, r.request().method(), r.request().postData()); } catch { d = []; }
    r.fulfill({ status:200, contentType:'application/json',
                headers:{ 'content-range':'0-1/2' }, body: JSON.stringify(d) });
  });
  await p.goto(BASE + '/thecred/login', { waitUntil:'load' });
  await p.waitForTimeout(900);
  return { b, p, erros };
}

// O login tem dois passos: escolher o painel de acesso e só então digitar. O
// teste passa pelos dois, porque é por eles que a pessoa passa — pular para o
// formulário chamando selectPanel() por dentro provaria metade do caminho.
async function preencher(p, painel, cpf) {
  await p.evaluate(k => selectPanel(k), painel);
  await p.waitForTimeout(250);
  await p.fill('#cpf', cpf);
  await p.fill('#password', 'seja-o-que-for');
  await p.click('#btn-login');
  await p.waitForTimeout(2200);
}

(async () => {
  const todosErros = [];

  console.log('== O REDIRECIONAMENTO, LIDO DO PRÓPRIO CÓDIGO ==');
  {
    // Sem navegador: a regra está escrita em login.html e é dela que o sistema
    // depende. Se alguém trocar '/geral' por outra coisa, é aqui que aparece.
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'login.html'), 'utf8');
    const fn = /function redirectAfterLogin\(user\)\s*\{([\s\S]*?)\n\}/.exec(src);
    checa('redirectAfterLogin existe', !!fn);
    const corpo = fn ? fn[1] : '';
    checa('o destino padrão é a tela Geral', /\/\$\{slug\}\/geral/.test(corpo), corpo.slice(0,200));
    checa('e o despachante continua indo direto para o Registro',
      /despachante[\s\S]*\/\$\{slug\}\/registro/.test(corpo), corpo.slice(0,300));
    // A prova que impede a volta do comportamento antigo.
    checa('NINGUÉM é mandado para o dashboard do Repasse no login',
      !/\/\$\{slug\}\/repasse/.test(corpo), corpo.slice(0,300));
  }

  console.log('\n== O SUPERADMIN ACESSANDO UM CLIENTE TAMBÉM ABRE NA GERAL ==');
  {
    // O dono achou isto sozinho: "quando eu acesso um cliente do meu super
    // admin ele vai direto para tela de repasse". Era uma TERCEIRA regra para
    // a mesma pergunta — o superadmin escolhia o primeiro módulo licenciado,
    // na ordem do tipo de cliente. Duas regras para "por onde o sistema abre"
    // divergem no primeiro ajuste, e foi exatamente o que aconteceu.
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'superadmin.html'), 'utf8');
    const fn = /async function acessarComo\([\s\S]*?\n\}/.exec(src);
    checa('acessarComo existe', !!fn);
    const corpo = fn ? fn[0] : '';
    checa('o superadmin abre o cliente pela Geral',
      /_home\s*=.*'geral'/.test(corpo), (corpo.match(/const _home[^\n]*/) || [''])[0]);
    checa('e o despachante continua indo para o Registro',
      /despachante.*'registro'/.test(corpo), (corpo.match(/const _home[^\n]*/) || [''])[0]);
    // A prova que impede a volta: nenhuma escolha própria de módulo aqui.
    checa('sem uma segunda regra escolhendo módulo por tipo de cliente',
      !/ALL_MODULES[\s\S]{0,200}_order/.test(corpo), 'ainda há escolha própria de módulo');
  }

  console.log('\n== GESTOR ENTRA E CAI NA GERAL ==');
  {
    const { b, p, erros } = await entrar({ id:'u1', name:'Julio', role:'owner' }, ['repasse']);
    await preencher(p, 'gestor', '999.999.999-99');
    checa('o navegador foi para /thecred/geral', /\/thecred\/geral/.test(p.url()), p.url());
    checa('e NÃO para o dashboard do Repasse', !/repasse/.test(p.url()), p.url());
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== CORRETOR TAMBÉM CAI NA GERAL ==');
  {
    // Esta é a que o dono desfez de propósito: houve uma versão em que quem não
    // tinha permissão de painel era desviado daqui para o quadro do módulo.
    const { b, p, erros } = await entrar(
      { id:'p3', name:'Ana Souza', role:'partner', type:'corretor' }, ['repasse']);
    await preencher(p, 'corretor', '333.333.333-33');
    checa('o corretor vai para /thecred/geral', /\/thecred\/geral/.test(p.url()), p.url());
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== DESPACHANTE É A ÚNICA EXCEÇÃO ==');
  {
    const { b, p, erros } = await entrar(
      { id:'p20', name:'Dario Despacho', role:'partner', type:'despachante' }, ['registro']);
    await preencher(p, 'despachante', '222.222.222-22');
    checa('o despachante vai direto para o Registro', /\/thecred\/registro/.test(p.url()), p.url());
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== QUEM JÁ TEM SESSÃO E ABRE O LOGIN TAMBÉM VAI PARA A GERAL ==');
  {
    // Caminho real e esquecido: a pessoa tem o login nos favoritos e clica nele
    // já logada. login.html detecta a sessão e redireciona — e esse ramo é
    // OUTRO `redirectAfterLogin`, que já foi esquecido em mudanças passadas.
    const { b, p, erros } = await entrar({ id:'u1', name:'Julio', role:'owner' }, ['repasse']);
    await p.evaluate(() => {
      localStorage.setItem('a1_token','tok');
      localStorage.setItem('a1_slug','thecred');
      localStorage.setItem('a1_user', JSON.stringify({ id:'u1', tenant_id:'t1', name:'Julio', role:'owner' }));
    });
    await p.goto(BASE + '/thecred/login', { waitUntil:'load' });
    await p.waitForTimeout(1000);
    checa('a sessão em andamento também abre na Geral', /\/thecred\/geral/.test(p.url()), p.url());
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros) ? 1 : 0);
})();
