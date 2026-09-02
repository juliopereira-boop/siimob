// Monitor de acessos e acesso por usuário, no superadmin. O superadmin fala com
// o banco pela chave de serviço, então aqui a chave é digitada e as respostas do
// PostgREST são fingidas.
const { chromium } = require('playwright');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

let ok = 0, bad = 0;
const c = (n, v, x = '') => { v ? (ok++, console.log('  ✓ ' + n)) : (bad++, console.log('  ✗ ' + n + '  ' + x)); };

const agora = Date.now();
const baldes = Array.from({ length: 24 }, (_, i) => ({
  inicio: new Date(agora - (23 - i) * 3600e3).toISOString(),
  acessos: i === 20 ? 9 : (i % 4 === 0 ? 0 : i % 5),
  usuarios: i === 20 ? 6 : (i % 4 === 0 ? 0 : Math.min(i % 5, 3)),
}));

const MONITOR = {
  janela: 'hora', gerado_em: new Date().toISOString(),
  online: 3,
  online_por_papel: [{ papel: 'partner', quantos: 2 }, { papel: 'owner', quantos: 1 }],
  online_lista: [
    { nome: 'Julio', papel: 'owner', modulo: 'repasse', cliente: 'THE CRED', ha_segundos: 8 },
    { nome: 'Raissa', papel: 'partner', modulo: 'andamento', cliente: 'THE CRED', ha_segundos: 95 },
    { nome: '<img src=x onerror="window.__XSS=1">', papel: 'partner', modulo: 'crm', cliente: 'Beta', ha_segundos: 140 },
  ],
  baldes, total_acessos: 37, total_usuarios: 7, acessos_suporte: 4, pico_simultaneos: 5,
  por_cliente: [
    // dentro do teto
    { cliente: 'THE CRED', acessos: 30, usuarios: 5, max_simultaneos: 3, limite: 5, ultimo: new Date().toISOString() },
    // ACIMA do teto — tem de gritar na tela
    { cliente: 'Beta', acessos: 7, usuarios: 2, max_simultaneos: 5, limite: 3, ultimo: new Date().toISOString() },
    // cliente antigo, sem medição ainda
    { cliente: 'Gama', acessos: 2, usuarios: 1, max_simultaneos: null, limite: 3, ultimo: new Date().toISOString() }],
};

const TENANTS  = [{ id: 't1', name: 'THE CRED', slug: 'thecred', status: 'active', plan: 'pro', max_users: 10, created_at: '2026-01-01' }];
const USERS    = [{ id: 'u1', name: 'Julio Gestor', cpf: '11122233344', role: 'owner', is_active: true, tenant_id: 't1' }];
const PARTNERS = [
  { id: 'p1', name: 'Raissa Correspondente', cpf: '05268025376', type: 'cca', is_active: true, approved: true,
    permissions: { gerente: true, editar_repasses: true }, tenant_id: 't1' },
  { id: 'p2', name: 'Ana Corretora', cpf: '22233344455', type: 'corretor', is_active: true, approved: true, permissions: {}, tenant_id: 't1' },
  { id: 'p3', name: 'Imob Alfa', cpf: '', type: 'imobiliaria', is_active: true, approved: true, tenant_id: 't1' },
];

async function abrir() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const erros = [], criadas = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.addInitScript(() => { window.__XSS = 0; window.__ABERTAS = [];
    window.open = u => { window.__ABERTAS.push(u); return null; }; });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status:200, contentType:'text/css', body:'' }));
  await p.route(/supabase\.co/, r => {
    const u = r.request().url(), m = r.request().method();
    const j = x => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(x) });
    if (u.includes('/rpc/a1_sa_monitor')) {
      const corpo = JSON.parse(r.request().postData() || '{}');
      return j({ ...MONITOR, janela: corpo.p_janela || 'dia' });
    }
    if (u.includes('a1_sessions') && m === 'POST') {
      const corpo = JSON.parse(r.request().postData() || '{}');
      criadas.push(corpo);
      return j([{ token: 'tok-' + criadas.length, ...corpo }]);
    }
    if (u.includes('a1_tenants'))  return j(TENANTS);
    if (u.includes('a1_partners')) {
      const id = (u.match(/[?&]id=eq\.([a-z0-9-]+)/) || [])[1];
      return j(id ? PARTNERS.filter(x => x.id === id) : PARTNERS);
    }
    if (u.includes('a1_users'))    return j(USERS);
    return j([]);
  });
  await p.goto(BASE + '/superadmin.html', { waitUntil: 'load' });
  // destrava o portão da chave de serviço
  await p.fill('#sa-url-input', 'https://x.supabase.co');
  await p.fill('#sa-key-input', 'chave-de-servico-de-mentira');
  await p.click('button:has-text("Entrar como Superadmin")');
  await p.waitForTimeout(1200);
  return { b, p, erros, criadas };
}

(async () => {
  const { b, p, erros, criadas } = await abrir();

  console.log('== MONITOR ==');
  c('aba Monitor existe', (await p.locator('.sa-tab:has-text("Monitor")').count()) === 1);
  await p.click('.sa-tab:has-text("Monitor")');
  await p.waitForTimeout(900);
  c('painel abre', await p.locator('#satab-monitor').isVisible());

  const kpis = await p.locator('#mon-kpis').textContent();
  c('mostra quantos estão online', /Online agora/.test(kpis) && /\b3\b/.test(kpis), kpis.slice(0, 90));
  c('quebra o online por papel', /2 partner/.test(kpis) && /1 owner/.test(kpis));
  c('mostra acessos do período', /37/.test(kpis));
  c('mostra usuários distintos', /Usuários distintos/.test(kpis));
  c('mostra o pico', /Pico do período/.test(kpis) && /\b9\b/.test(kpis), kpis.slice(0, 200));
  c('separa as entradas de suporte', /Entradas de suporte/.test(kpis) && /\b4\b/.test(kpis));

  const barras = await p.locator('#mon-grafico svg rect').count();
  c('gráfico desenha uma barra por balde', barras === 24, 'barras=' + barras);
  c('balde vazio não some do gráfico',
    (await p.locator('#mon-grafico svg rect').nth(0).getAttribute('height')) === '0');
  c('a barra do pico é a mais alta', await p.evaluate(() => {
    const hs = [...document.querySelectorAll('#mon-grafico svg rect')].map(r => +r.getAttribute('height'));
    return hs.indexOf(Math.max(...hs)) === 20;
  }));
  c('cada barra explica o valor ao passar o mouse',
    /9 acesso\(s\), 6 usuário\(s\)/.test(await p.locator('#mon-grafico svg').innerHTML()));

  const online = await p.locator('#mon-online tr').count();
  c('lista quem está online', online === 3, 'linhas=' + online);
  c('mostra em que tela a pessoa está', /repasse/.test(await p.locator('#mon-online').textContent()));
  c('mostra há quanto tempo', /agora/.test(await p.locator('#mon-online').textContent())
    && /há 1 min/.test(await p.locator('#mon-online').textContent()));
  c('quebra por cliente', /THE CRED/.test(await p.locator('#mon-clientes').textContent())
    && /Beta/.test(await p.locator('#mon-clientes').textContent()));

  console.log('  -- máximo simultâneo --');
  c('KPI de máximo simultâneo', /Máx\. simultâneo/.test(kpis) && /\b5\b/.test(kpis), kpis.slice(0,240));
  const tbl = await p.locator('#mon-clientes').textContent();
  c('mostra o máximo ao lado do teto do plano', /3 \/ 5/.test(tbl), tbl.slice(0, 200));
  c('acusa quem passou do teto', /5 \/ 3/.test(tbl) && /acima do teto/.test(tbl), tbl.slice(0, 300));
  c('quem passou fica em vermelho', await p.evaluate(() => {
    const tr = [...document.querySelectorAll('#mon-clientes tr')].find(r => /Beta/.test(r.textContent));
    const b = tr && tr.querySelector('b');
    return !!b && getComputedStyle(b).color === 'rgb(220, 38, 38)';
  }));
  c('cliente sem medição não inventa número', /—/.test(
    await p.locator('#mon-clientes tr:has-text("Gama")').textContent()));
  c('a tabela explica que acesso não é simultâneo',
    /Nenhum dos dois diz nada sobre estarem juntas/i.test(await p.locator('#satab-monitor').textContent()));

  console.log('  -- troca de período --');
  await p.selectOption('#mon-janela', 'semana'); await p.waitForTimeout(700);
  c('o rótulo do período acompanha', /12 semanas/.test(await p.locator('#mon-kpis').textContent()));
  c('a legenda diz o que é cada barra', /uma semana/.test(await p.locator('#mon-grafico-leg').textContent()));

  c('nome de usuário com HTML não executa', (await p.evaluate(() => window.__XSS || 0)) === 0);

  console.log('\n== ACESSAR COMO CADA USUÁRIO ==');
  await p.click('.sa-tab:has-text("Clientes")'); await p.waitForTimeout(600);
  await p.evaluate(() => openUsersModal('t1', 'THE CRED')); await p.waitForTimeout(900);

  const corpo = await p.locator('#um-tbody').textContent();
  c('lista o gestor', /Julio Gestor/.test(corpo));
  c('lista o correspondente', /Raissa Correspondente/.test(corpo), corpo.slice(0, 160));
  c('lista o corretor', /Ana Corretora/.test(corpo));
  c('não lista imobiliária como gente que entra', !/Imob Alfa/.test(corpo));
  c('separa as duas famílias', /Gestores e administradores/i.test(corpo)
    && /Correspondentes, analistas e corretores/i.test(corpo));

  const botoes = await p.locator('#um-tbody button:has-text("Acessar")').count();
  c('botão Acessar em cada pessoa', botoes === 3, 'botões=' + botoes);

  // entra como a correspondente (2ª linha da família de parceiros)
  await p.locator('#um-tbody tr:has-text("Raissa Correspondente") button:has-text("Acessar")').click();
  await p.waitForTimeout(900);
  const sess = criadas[criadas.length - 1] || {};
  c('cria sessão para o id certo', sess.user_id === 'p1', JSON.stringify(sess));
  c('com papel de parceiro', sess.role === 'partner', JSON.stringify(sess));
  c('marcada como suporte, fora da conta do cliente', sess.origem === 'suporte', JSON.stringify(sess));

  const guardado = await p.evaluate(() => JSON.parse(localStorage.getItem('a1_user') || '{}'));
  c('a sessão do navegador leva o nome', guardado.name === 'Raissa Correspondente', JSON.stringify(guardado));
  c('leva o tipo do parceiro', guardado.type === 'cca', JSON.stringify(guardado));
  c('leva as permissões dela', !!(guardado.permissions || {}).gerente, JSON.stringify(guardado.permissions));
  c('abre o sistema numa aba nova', (await p.evaluate(() => window.__ABERTAS)).some(u => /thecred/.test(u)));

  // entrar como gestor continua funcionando
  await p.locator('#um-tbody tr:has-text("Julio Gestor") button:has-text("Acessar")').click();
  await p.waitForTimeout(800);
  const s2 = criadas[criadas.length - 1] || {};
  c('gestor: papel owner', s2.role === 'owner' && s2.user_id === 'u1', JSON.stringify(s2));
  const g2 = await p.evaluate(() => JSON.parse(localStorage.getItem('a1_user') || '{}'));
  c('gestor não recebe type de parceiro', g2.type === undefined, JSON.stringify(g2));

  c('sem erro de JS', erros.length === 0, erros[0] || '');
  await b.close();

  console.log(`\n${bad ? '>>> FALHAS: ' + bad : '>>> tudo passou'} (${ok} verificações)`);
  process.exit(bad ? 1 : 0);
})();
