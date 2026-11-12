// O site na raiz e o login universal (siimob.com/login).
//
// O PEDIDO DO DONO
//   "o site, siimob.com, tem que ser O SITE (...) e no topo o botão de login,
//    ai precisamos de uma tela de login universal, isso não pode prejudicar em
//    nada os clientes ativos"
//
// O que precisa valer:
//   - siimob.com abre o site, mesmo com sessão aberta no aparelho; o botão de
//     entrar do topo leva a /login, inclusive no celular;
//   - /conheca vai para a raiz (301), e o /empresa/login de sempre continua
//     abrindo a tela antiga;
//   - /login: empresa que não existe não avança; a que existe mostra os perfis
//     (despachante só com o Registro); CPF e senha chamam a MESMA função do
//     login antigo, com a empresa digitada, e levam para a Geral (ou para o
//     Registro, no caso do despachante);
//   - quem já está conectado vê "continuar", e ?empresa= pula o primeiro passo.
const { chromium, devices } = require('playwright');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

/** Servidor de mentira: empresas thecred (com Registro) e semreg (sem). */
function rotear(p, chamadas, papel = { role: 'owner', type: null }) {
  return p.route(/supabase\.co/, r => {
    const url = r.request().url();
    const corpo = r.request().postData() || '';
    chamadas.push({ url, corpo });
    const json = d => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
    if (/rpc\/a1_public_tenant_info/.test(url)) {
      const slug = JSON.parse(corpo || '{}').p_slug;
      if (slug === 'thecred') return json({ modules: ['repasse', 'registro'] });
      if (slug === 'semreg') return json({ modules: ['repasse'] });
      return json({ error: 'not_found' });
    }
    if (/rpc\/a1_(partner_)?login/.test(url)) {
      const d = JSON.parse(corpo || '{}');
      if (d.p_password !== 'certa') return json({ error: 'invalid_credentials' });
      return json({
        token: 'tok',
        user_id: 'u1',
        name: 'Julio',
        role: papel.role,
        type: papel.type,
        tenant_id: 't1',
        tenant_name: 'THE CRED',
        plan: 'pro',
        max_users: 10,
        status: 'active'
      });
    }
    return json([]);
  });
}

async function nova(b, opc = {}) {
  const ctx = await b.newContext(opc.device || { viewport: { width: 1366, height: 860 } });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  const chamadas = [];
  await rotear(p, chamadas, opc.papel);
  if (opc.sessao)
    await p.addInitScript(() => {
      if (!sessionStorage.getItem('__semeado')) {
        localStorage.setItem('a1_token', 'tok');
        localStorage.setItem('a1_slug', 'thecred');
        localStorage.setItem('a1_user', JSON.stringify({ id: 'u1', name: 'Julio Pereira', role: 'owner' }));
        sessionStorage.setItem('__semeado', '1');
      }
    });
  return { ctx, p, erros, chamadas };
}

const visivel = (p, sel) =>
  p.evaluate(s => {
    const el = document.querySelector(s);
    return !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  }, sel);

(async () => {
  const b = await chromium.launch();
  const todos = [];

  // ── 1. A raiz é o site ────────────────────────────────────────────────────
  console.log('\nsiimob.com é o site');
  {
    const { ctx, p, erros } = await nova(b, { sessao: true });
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForTimeout(800);
    checa('a raiz abre o site, mesmo com sessão aberta', p.url() === BASE + '/' && !!(await p.$('#topo h1')));
    checa('o título é o lema', /Tecnologia que conecta/.test(await p.title()));
    checa('o botão do topo leva a /login', (await p.getAttribute('#nav-entrar', 'href')) === '/login');
    checa(
      'com sessão, ele diz "Acessar o sistema"',
      /Acessar o sistema/.test(await p.textContent('#nav-entrar'))
    );
    checa(
      'o site tem a comparação e as perguntas',
      !!(await p.$('#diferenca table')) && (await p.$$('.faq-item')).length >= 5
    );
    const ld = await p.$$eval('script[type="application/ld+json"]', l =>
      l.map(s => JSON.parse(s.textContent)['@type'])
    );
    checa(
      'dados estruturados para o Google (organização, app, perguntas)',
      ['Organization', 'SoftwareApplication', 'FAQPage'].every(t => ld.includes(t)),
      ld.join(',')
    );
    checa(
      'endereço canônico é siimob.com',
      (await p.getAttribute('link[rel="canonical"]', 'href')) === 'https://siimob.com/'
    );
    todos.push(...erros);
    await ctx.close();

    const m = await nova(b, { device: devices['iPhone 13'] });
    await m.p.goto(BASE + '/', { waitUntil: 'load' });
    await m.p.waitForTimeout(600);
    checa('no celular o botão de entrar continua no topo', await visivel(m.p, '#nav-entrar'));
    checa(
      'e a página não rola de lado',
      (await m.p.evaluate(() => document.documentElement.scrollWidth)) <= 390
    );
    todos.push(...m.erros);
    await m.ctx.close();
  }

  // ── 2. Endereços antigos ──────────────────────────────────────────────────
  console.log('\nEndereços antigos');
  {
    const { ctx, p, erros } = await nova(b);
    const r = await p.goto(BASE + '/conheca', { waitUntil: 'load' });
    checa('/conheca leva à raiz', p.url() === BASE + '/' && r.status() === 200);
    await p.goto(BASE + '/thecred/login', { waitUntil: 'load' });
    await p.waitForTimeout(600);
    checa(
      'o /empresa/login de sempre continua na tela antiga',
      !!(await p.$('#step-panels')) && !(await p.$('#et-empresa'))
    );
    checa(
      'o "trocar empresa" dele leva ao login novo',
      (await p.getAttribute('.trocar-empresa', 'href')) === '/login'
    );
    todos.push(...erros);
    await ctx.close();
  }

  // ── 3. Login universal, gestor ────────────────────────────────────────────
  console.log('\nLogin universal');
  {
    const { ctx, p, erros, chamadas } = await nova(b);
    await p.goto(BASE + '/login', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    checa('sem sessão, começa pela empresa', await visivel(p, '#en-empresa'));
    await p.fill('#en-empresa', 'NaoExiste');
    await p.click('#en-btn-empresa');
    await p.waitForTimeout(400);
    checa(
      'empresa que não existe não avança',
      (await visivel(p, '#en-erro-empresa')) && !(await visivel(p, '#et-perfil'))
    );
    checa('e diz qual identificador procurou', /naoexiste/.test(await p.textContent('#en-erro-empresa')));
    await p.fill('#en-empresa', 'https://siimob.com/TheCred/geral');
    await p.press('#en-empresa', 'Enter');
    await p.waitForTimeout(500);
    checa('aceita o link colado inteiro e entende a empresa', await visivel(p, '#et-perfil'));
    const perfis = await p.$$eval('.en-perfil', l => l.map(e => e.dataset.key));
    checa(
      'com Registro, aparecem os 5 perfis',
      perfis.length === 5 && perfis.includes('despachante'),
      perfis.join(',')
    );
    await p.click('.en-perfil[data-key="gestor"]');
    await p.waitForTimeout(300);
    checa(
      'o passo final mostra a empresa e o perfil',
      /thecred/.test(await p.textContent('#en-chip-senha')) &&
        /Gestor/.test(await p.textContent('#en-chip-papel'))
    );
    await p.fill('#en-cpf', '99999999999');
    checa('o CPF ganha máscara', (await p.inputValue('#en-cpf')) === '999.999.999-99');
    await p.fill('#en-senha', 'errada');
    await p.click('#en-btn-entrar');
    await p.waitForTimeout(500);
    checa(
      'senha errada mostra o erro e não sai da tela',
      /CPF ou senha incorretos/.test(await p.textContent('#en-erro-senha')) && /\/login/.test(p.url())
    );
    await p.fill('#en-senha', 'certa');
    await p.click('#en-btn-entrar');
    await p.waitForURL(/\/thecred\/geral/, { timeout: 5000 }).catch(() => {});
    const login = chamadas.filter(c => /rpc\/a1_login/.test(c.url)).pop();
    const corpo = login ? JSON.parse(login.corpo) : {};
    checa(
      'o gestor entra pela mesma função do login antigo, com a empresa digitada',
      corpo.p_tenant_slug === 'thecred' && corpo.p_cpf === '99999999999'
    );
    checa('e cai na Geral da empresa', /\/thecred\/geral$/.test(p.url()), p.url());
    const guardado = await p.evaluate(() => [
      localStorage.getItem('a1_slug'),
      localStorage.getItem('a1_empresas_recentes')
    ]);
    checa(
      'a sessão é a mesma do login antigo e a empresa fica lembrada',
      guardado[0] === 'thecred' && /thecred/.test(guardado[1] || '')
    );
    todos.push(...erros.filter(e => !/a1_|Failed to fetch/.test(e)));
    await ctx.close();
  }

  // ── 4. Despachante e empresa sem Registro ─────────────────────────────────
  console.log('\nDespachante e perfis por módulo');
  {
    const { ctx, p, erros, chamadas } = await nova(b, { papel: { role: 'partner', type: 'despachante' } });
    await p.goto(BASE + '/login?empresa=semreg', { waitUntil: 'load' });
    await p.waitForTimeout(700);
    checa('?empresa= pula direto para os perfis', await visivel(p, '#et-perfil'));
    const perfis = await p.$$eval('.en-perfil', l => l.map(e => e.dataset.key));
    checa(
      'sem Registro, o despachante não aparece',
      !perfis.includes('despachante') && perfis.length === 4,
      perfis.join(',')
    );
    await p.click('[data-acao="enVoltar"][data-p="empresa"]');
    await p.fill('#en-empresa', 'thecred');
    await p.click('#en-btn-empresa');
    await p.waitForTimeout(400);
    await p.click('.en-perfil[data-key="despachante"]');
    await p.fill('#en-cpf', '11122233344');
    await p.fill('#en-senha', 'certa');
    await p.press('#en-senha', 'Enter');
    await p.waitForURL(/\/thecred\/registro/, { timeout: 5000 }).catch(() => {});
    checa(
      'parceiro entra pela função de parceiro',
      chamadas.some(c => /rpc\/a1_partner_login/.test(c.url))
    );
    checa('o despachante cai direto no Registro', /\/thecred\/registro$/.test(p.url()), p.url());
    todos.push(...erros.filter(e => !/a1_|Failed to fetch/.test(e)));
    await ctx.close();
  }

  // ── 5. Já conectado ───────────────────────────────────────────────────────
  console.log('\nJá conectado');
  {
    const { ctx, p, erros } = await nova(b, { sessao: true });
    await p.goto(BASE + '/login', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    checa(
      'quem já está conectado vê a conta aberta',
      (await visivel(p, '#et-sessao')) && /Julio Pereira/.test(await p.textContent('#en-sessao-nome'))
    );
    checa('com a empresa', /thecred/.test(await p.textContent('#en-sessao-empresa')));
    await p.click('[data-acao="enOutraConta"]');
    checa('"outra conta" volta para a empresa', await visivel(p, '#en-empresa'));
    checa('com a empresa salva como atalho', await visivel(p, '.en-recente[data-slug="thecred"]'));
    await p.goto(BASE + '/login', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    await p.click('[data-acao="enContinuar"]');
    await p.waitForURL(/\/thecred\/geral/, { timeout: 5000 }).catch(() => {});
    checa('"continuar" leva para a Geral da empresa', /\/thecred\/geral$/.test(p.url()), p.url());
    todos.push(...erros.filter(e => !/a1_|Failed to fetch/.test(e)));
    await ctx.close();

    const d = await nova(b, { sessao: true });
    await d.p.goto(BASE + '/login?motivo=outro_acesso', { waitUntil: 'load' });
    await d.p.waitForTimeout(400);
    checa(
      'sessão derrubada explica o motivo e pede login',
      /outro dispositivo/.test(await d.p.textContent('#en-aviso')) && (await visivel(d.p, '#en-empresa'))
    );
    todos.push(...d.erros);
    await d.ctx.close();
  }

  await b.close();
  process.exit(resumo(todos) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
