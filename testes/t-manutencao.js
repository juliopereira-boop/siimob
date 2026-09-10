// A chave geral: o superadmin desliga o sistema.
//
// São duas trancas diferentes e é importante não confundi-las. A que vale está
// no BANCO — a1_login e a1_partner_login recusam entrada nova, e nada no
// navegador contorna isso (a prova disso vive em testes/sql). O que esta suíte
// cobre é a SEGUNDA camada: quem já estava dentro quando a chave girou. A tela
// cobre o sistema com o aviso, para que ninguém salve por cima do que está
// sendo mexido.
//
// O caso que mais me preocupa aqui não é o aviso aparecer. É o aviso aparecer
// quando NÃO devia: uma falha de rede, ou um banco sem a função (o SQL ainda
// não rodado), não podem tirar o sistema do ar sozinhos. Por isso metade dos
// testes abaixo é sobre o sistema continuar de pé.
const { chromium } = require('playwright');
const { responder } = require('./fake');
const { abrir, checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

// Abre uma tela com controle fino da resposta do banco à pergunta da chave:
//   'ligada'  → manutenção ativa
//   'no-ar'   → desligada
//   'mudo'    → o endpoint devolve erro (rede caiu, ou SQL não rodado)
async function abrirCom(pag, modo, estado) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.addInitScript(() => {
    localStorage.setItem('a1_token','tok'); localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify({id:'u1',tenant_id:'t1',name:'Julio',role:'owner',cpf:'99999999999'}));
    window.confirm = () => true;
    // A cobertura chama location.reload() quando a manutenção acaba. Num teste
    // isso reinicia a página e apaga a evidência: registro em vez de recarregar.
    window.__RELOADS = 0;
    try { Object.defineProperty(window.location, 'reload',
      { configurable:true, value: () => { window.__RELOADS++; } }); } catch {}
  });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (/rpc\/a1_manutencao_estado/.test(u)) {
      if (modo === 'mudo') return r.fulfill({ status:404, contentType:'application/json', body:'{}' });
      return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(estado) });
    }
    let d; try { d = responder(u, r.request().method(), r.request().postData()); } catch { d = []; }
    r.fulfill({status:200,contentType:'application/json',headers:{'content-range':'0-1/2'},body:JSON.stringify(d)});
  });
  await p.goto(BASE + '/' + pag, { waitUntil:'load' });
  await p.waitForTimeout(1600);
  return { b, p, erros };
}

const temAviso = p => p.evaluate(() => !!document.getElementById('a1-manutencao'));

(async () => {
  const todosErros = [];

  // ── 1. Chave ligada: quem está dentro vê o aviso ──────────────────────────
  console.log('\nChave ligada — quem já estava dentro');
  {
    const ate = new Date(Date.now() + 2*3600*1000).toISOString();
    const { b, p, erros } = await abrirCom('repasse.html', 'ligada',
      { ativa:true, mensagem:'Manutenção preventiva do banco.', ate });
    checa('a cobertura de manutenção aparece', await temAviso(p));
    const txt = await p.evaluate(() => (document.getElementById('a1-manutencao')||{}).innerText || '');
    checa('mostra a mensagem que o superadmin escreveu', txt.includes('Manutenção preventiva do banco'), `→ ${txt.slice(0,90)}`);
    checa('mostra a previsão de volta', /Previsão de volta/.test(txt), `→ ${txt.slice(0,120)}`);
    // Cobrir é o ponto: o Kanban continua montado embaixo, mas fora de alcance.
    const cobre = await p.evaluate(() => {
      const el = document.getElementById('a1-manutencao');
      if (!el) return false;
      const s = getComputedStyle(el);
      return s.position === 'fixed' && Number(s.zIndex) > 100000;
    });
    checa('a cobertura é fixa e fica por cima de tudo', cobre);
    todosErros.push(...erros); await b.close();
  }

  // ── 2. Mensagem do banco não vira HTML ────────────────────────────────────
  // O texto vem de uma tabela, escrito por quem tem a chave de serviço. Mesmo
  // assim entra escapado: innerHTML com texto de fora é injeção, e a origem
  // "confiável" de hoje é a origem invadida de amanhã.
  console.log('\nA mensagem do banco entra como texto, não como HTML');
  {
    const { b, p, erros } = await abrirCom('repasse.html', 'ligada',
      { ativa:true, mensagem:'<img src=x onerror="window.__XSS=1">volta já', ate:null });
    checa('nenhuma tag foi criada a partir da mensagem',
      await p.evaluate(() => !document.querySelector('#a1-manutencao img')));
    checa('o texto bruto aparece na tela',
      await p.evaluate(() => (document.getElementById('a1-manutencao')||{}).innerText.includes('volta já')));
    todosErros.push(...erros); await b.close();
  }

  // ── 3. Chave desligada: o sistema funciona como sempre ────────────────────
  console.log('\nChave desligada — o sistema no ar');
  {
    const { b, p, erros } = await abrirCom('repasse.html', 'no-ar', { ativa:false, mensagem:null, ate:null });
    checa('nenhuma cobertura na tela', !(await temAviso(p)));
    checa('o Kanban carregou normalmente', await p.evaluate(() => !!document.getElementById('kanban-board')));
    todosErros.push(...erros); await b.close();
  }

  // ── 4. Banco mudo NÃO derruba ninguém ─────────────────────────────────────
  // Este é o teste que justifica o `return null` em a1ManutencaoEstado. Se
  // "não consegui perguntar" contasse como "tem manutenção", uma oscilação de
  // rede tiraria a empresa inteira do ar sem ninguém ter girado chave nenhuma.
  // É também o caso de quem ainda não rodou o SQL: o sistema segue igual.
  console.log('\nBanco mudo (rede caiu, ou SQL ainda não rodado)');
  {
    const { b, p, erros } = await abrirCom('repasse.html', 'mudo', null);
    checa('sem resposta do banco, ninguém é coberto', !(await temAviso(p)));
    checa('a tela seguiu funcionando', await p.evaluate(() => !!document.getElementById('kanban-board')));
    todosErros.push(...erros); await b.close();
  }

  // ── 5. Prazo vencido: o sistema volta sozinho ─────────────────────────────
  // A rede de segurança da chave esquecida. Quem responde por isso é o banco
  // (a1_manutencao_ativa confere o prazo), então aqui o estado já chega com
  // ativa=false — o que se prova é que a tela respeita a resposta.
  console.log('\nPrazo vencido — a volta automática');
  {
    const passado = new Date(Date.now() - 3600*1000).toISOString();
    const { b, p, erros } = await abrirCom('repasse.html', 'no-ar',
      { ativa:false, mensagem:'Já acabou.', ate:passado });
    checa('manutenção expirada não cobre ninguém', !(await temAviso(p)));
    todosErros.push(...erros); await b.close();
  }

  // ── 6. O login avisa antes de a pessoa digitar ────────────────────────────
  console.log('\nTela de login durante a manutenção');
  {
    const { b, p, erros } = await abrirCom('login.html', 'ligada',
      { ativa:true, mensagem:'Voltamos às 11h.', ate:null });
    const err = await p.evaluate(() => {
      const e = document.getElementById('error-box');
      return e && !e.classList.contains('hidden') ? e.textContent : '';
    });
    checa('o aviso aparece sem precisar tentar entrar', err.includes('Voltamos às 11h'), `→ "${err}"`);
    todosErros.push(...erros); await b.close();
  }
  {
    const { b, p, erros } = await abrirCom('login.html', 'no-ar', { ativa:false });
    const visivel = await p.evaluate(() => {
      const e = document.getElementById('error-box');
      return !!(e && !e.classList.contains('hidden'));
    });
    checa('fora da manutenção, o login não mostra erro nenhum', !visivel);
    todosErros.push(...erros); await b.close();
  }

  // ── 7. O painel do superadmin ─────────────────────────────────────────────
  console.log('\nO botão no superadmin');
  {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport:{ width:1400, height:950 } });
    const erros = [];
    p.on('pageerror', e => erros.push('JS: ' + e.message));
    let gravou = null;
    await p.addInitScript(() => { window.confirm = () => true; });
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
    await p.route(/supabase\.co/, r => {
      const u = r.request().url(), m = r.request().method();
      if (/a1_manutencao/.test(u)) {
        if (m === 'PATCH') { gravou = JSON.parse(r.request().postData() || '{}');
          return r.fulfill({status:200,contentType:'application/json',
            body:JSON.stringify([{ id:true, ...gravou }])}); }
        return r.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify([{ id:true, ativa:false, mensagem:null, ate:null }])});
      }
      let d; try { d = responder(u, m, r.request().postData()); } catch { d = []; }
      r.fulfill({status:200,contentType:'application/json',headers:{'content-range':'0-1/2'},body:JSON.stringify(d)});
    });
    await p.goto(BASE + '/superadmin.html', { waitUntil:'load' });
    await p.fill('#sa-key-input', 'chave-de-servico');
    await p.click('button[onclick="saAuth()"]').catch(async () => {
      await p.evaluate(() => saAuth());
    });
    await p.waitForTimeout(900);
    await p.evaluate(() => switchSaTab('plataforma', document.getElementById('tab-plataforma') || document.createElement('div')));
    await p.waitForTimeout(600);

    checa('o painel da chave geral existe na aba Plataforma',
      await p.evaluate(() => !!document.getElementById('manut-painel')));
    checa('nasce mostrando o sistema no ar',
      await p.evaluate(() => (document.getElementById('manut-selo')||{}).textContent === 'Sistema no ar'));
    checa('o botão oferecido é o de desligar',
      await p.evaluate(() => document.getElementById('manut-btn-ligar').style.display !== 'none'
                          && document.getElementById('manut-btn-desligar').style.display === 'none'));

    await p.fill('#manut-msg', 'Manutenção preventiva. Voltamos às 11h.');
    await p.evaluate(() => manutLigar());
    await p.waitForTimeout(500);
    checa('desligar grava ativa=true', gravou && gravou.ativa === true, `→ ${JSON.stringify(gravou)}`);
    checa('grava a mensagem digitada', gravou && /Voltamos às 11h/.test(gravou.mensagem || ''));
    checa('registra a hora em que foi ligada', !!(gravou && gravou.inicio));
    checa('o selo passa a dizer que o sistema está desligado',
      await p.evaluate(() => (document.getElementById('manut-selo')||{}).textContent === 'Sistema desligado'));
    checa('e o botão vira o de reativar',
      await p.evaluate(() => document.getElementById('manut-btn-desligar').style.display !== 'none'));

    gravou = null;
    await p.evaluate(() => manutDesligar());
    await p.waitForTimeout(500);
    checa('reativar grava ativa=false', gravou && gravou.ativa === false);
    // Prazo velho pendurado numa chave desligada é lixo que confunde a próxima
    // leitura — e pior, "ligar de novo" herdaria um `ate` já vencido.
    checa('e limpa o prazo junto', gravou && gravou.ate === null, `→ ${JSON.stringify(gravou)}`);
    checa('o selo volta para o sistema no ar',
      await p.evaluate(() => (document.getElementById('manut-selo')||{}).textContent === 'Sistema no ar'));

    todosErros.push(...erros); await b.close();
  }

  process.exit(resumo(todosErros));
})();
