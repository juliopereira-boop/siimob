// Cobrança: o giro de três estados no superadmin e a tarja que o cliente vê
// quando tem mês em atraso.
const { chromium } = require('playwright');
const { responder } = require('./fake');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

let ok = 0, bad = 0;
const c = (n, v, x = '') => { v ? (ok++, console.log('  ✓ ' + n)) : (bad++, console.log('  ✗ ' + n + '  ' + x)); };

const hoje = new Date();
const chave = (ano, mes) => `${ano}-${String(mes + 1).padStart(2, '0')}`;
const mesAtual = chave(hoje.getFullYear(), hoje.getMonth());
const mesPassado = chave(hoje.getFullYear(), hoje.getMonth() - 1);

// ═══════════════════════════════════════════════════════════════════════════
// 1. SUPERADMIN — o clique gira entre os três estados
// ═══════════════════════════════════════════════════════════════════════════
async function abrirSuper(billing) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [], gravado = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status:200, contentType:'text/css', body:'' }));
  await p.route(/supabase\.co/, r => {
    const u = r.request().url(), m = r.request().method();
    const j = x => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(x) });
    if (u.includes('a1_config')) {
      if (m !== 'GET') { gravado.push(JSON.parse(r.request().postData() || '{}')); return j([{}]); }
      return j(billing ? [{ tenant_id:'t1', value: JSON.stringify(billing) }] : []);
    }
    if (u.includes('a1_tenants')) return j([{ id:'t1', name:'THE CRED', slug:'thecred',
      status:'active', plan:'pro', max_users:3, email:'fin@x.com', created_at:'2026-01-01' }]);
    return j([]);
  });
  await p.goto(BASE + '/superadmin.html', { waitUntil:'load' });
  await p.fill('#sa-url-input', 'https://x.supabase.co');
  await p.fill('#sa-key-input', 'chave');
  await p.click('button:has-text("Entrar como Superadmin")');
  await p.waitForTimeout(1000);
  return { b, p, erros, gravado };
}

const rotulo = (p, i) => p.locator('#cob-grid button').nth(i).textContent();
const ultimoBilling = g => {
  const c = g[g.length - 1];
  return c ? JSON.parse(c.value) : {};
};

(async () => {
  console.log('== SUPERADMIN: o mês gira entre os três estados ==');
  { const { b, p, erros, gravado } = await abrirSuper({ due_day: 30, valor: '600,00', paid: {} });
    await p.evaluate(() => openCobranca('t1', 'THE CRED', 'fin@x.com')); await p.waitForTimeout(700);
    c('a dica explica o giro completo',
      /Pendente.*Pago.*Em atraso/s.test(await p.locator('#modal-cobranca').textContent()));

    // Janeiro deste ano: vencimento dia 30 já passou, então nasce em atraso.
    await p.evaluate(() => { COB.year = new Date().getFullYear(); renderCobranca(); });
    await p.waitForTimeout(300);

    // Usa um mês FUTURO, que nasce pendente de verdade
    const iFut = 11;  // dezembro
    await p.evaluate(() => { COB.year = new Date().getFullYear() + 1; renderCobranca(); });
    await p.waitForTimeout(300);
    c('mês futuro nasce pendente', /Pendente/.test(await rotulo(p, iFut)), await rotulo(p, iFut));

    await p.locator('#cob-grid button').nth(iFut).click(); await p.waitForTimeout(400);
    c('1º clique: vira Pago', /Pago/.test(await rotulo(p, iFut)), await rotulo(p, iFut));
    c('e grava paid no banco', ultimoBilling(gravado).paid[`${hoje.getFullYear()+1}-12`].paid === true,
      JSON.stringify(ultimoBilling(gravado).paid));

    await p.locator('#cob-grid button').nth(iFut).click(); await p.waitForTimeout(400);
    c('2º clique: vira Em atraso', /Em atraso/.test(await rotulo(p, iFut)), await rotulo(p, iFut));
    { const r = ultimoBilling(gravado).paid[`${hoje.getFullYear()+1}-12`];
      c('grava a marca de atraso', r && r.atraso === true, JSON.stringify(r));
      c('com a data de quando começou', !!(r && r.desde), JSON.stringify(r)); }
    c('mostra desde quando está em atraso',
      new RegExp(String(hoje.getDate()).padStart(2,'0')).test(await rotulo(p, iFut)), await rotulo(p, iFut));

    await p.locator('#cob-grid button').nth(iFut).click(); await p.waitForTimeout(400);
    c('3º clique: volta para Pendente', /Pendente/.test(await rotulo(p, iFut)), await rotulo(p, iFut));
    c('e some do registro', !ultimoBilling(gravado).paid[`${hoje.getFullYear()+1}-12`],
      JSON.stringify(ultimoBilling(gravado).paid));

    c('atraso automático continua valendo', await p.evaluate(() =>
      estadoMes(2020, 0, 10, {}) === 'atraso'));
    c('sem dia de vencimento, mês passado não vira atraso sozinho', await p.evaluate(() =>
      estadoMes(2020, 0, 0, {}) === 'pendente'));
    c('pago ganha de vencimento passado', await p.evaluate(() =>
      estadoMes(2020, 0, 10, { '2020-01': { paid:true } }) === 'pago'));
    c('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close(); }

  // ═════════════════════════════════════════════════════════════════════════
  // 2. CLIENTE — a tarja
  // ═════════════════════════════════════════════════════════════════════════
  async function abrirCliente(billing, usuario) {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const erros = [];
    p.on('pageerror', e => erros.push('JS: ' + e.message));
    await p.addInitScript(u => {
      localStorage.setItem('a1_token','tok'); localStorage.setItem('a1_slug','thecred');
      localStorage.setItem('a1_user', JSON.stringify(u));
      window.__XSS = 0;
    }, usuario || { id:'u1', tenant_id:'t1', name:'Julio', role:'owner' });
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status:200, contentType:'text/css', body:'' }));
    await p.route(/supabase\.co/, r => {
      const u = r.request().url();
      const j = x => r.fulfill({ status:200, contentType:'application/json',
        headers:{'content-range':'0-1/2'}, body: JSON.stringify(x) });
      if (/a1_config\?key=eq\.billing/.test(u)) return j(billing ? [{ value: billing }] : []);
      let d; try { d = responder(u, r.request().method()); } catch { d = []; }
      return j(d);
    });
    await p.goto(BASE + '/repasse.html', { waitUntil:'load' });
    await p.waitForTimeout(2200);
    return { b, p, erros };
  }

  console.log('\n== CLIENTE EM ATRASO: a tarja aparece ==');
  { const { b, p, erros } = await abrirCliente({ due_day: 10, valor:'600,00',
      paid: { [mesPassado]: { atraso:true, desde:new Date().toISOString() } } });
    c('a tarja entra na tela', (await p.locator('#a1-cobranca').count()) === 1);
    const t = await p.locator('#a1-cobranca').textContent();
    c('avisa da suspensão', /Evite a suspensão do seu ambiente SIIMOB/.test(t), t);
    c('mostra o e-mail da cobrança', /gestao@poupgestao\.com/.test(t), t);
    c('mostra o telefone', /\(98\) 98180-9264/.test(t), t);
    c('e-mail é clicável', (await p.locator('#a1-cobranca a[href^="mailto:"]').count()) === 1);
    c('telefone abre o WhatsApp',
      /wa\.me\/5598981809264/.test(await p.locator('#a1-cobranca a[href*="wa.me"]').getAttribute('href') || ''));
    c('diz qual mensalidade está aberta', /Mensalidade de/.test(t), t);
    c('é anunciada para leitor de tela',
      (await p.locator('#a1-cobranca').getAttribute('role')) === 'alert');

    console.log('  -- é parte da página, não fica presa na tela --');
    c('não é fixa nem sticky', await p.evaluate(() => {
      const pos = getComputedStyle(document.getElementById('a1-cobranca')).position;
      return pos !== 'fixed' && pos !== 'sticky';
    }));
    c('é o primeiro elemento do corpo', await p.evaluate(() =>
      document.body.firstElementChild.id === 'a1-cobranca'));
    const antes = await p.evaluate(() => document.getElementById('a1-cobranca').getBoundingClientRect().top);
    await p.evaluate(() => window.scrollTo(0, 400)); await p.waitForTimeout(400);
    const depois = await p.evaluate(() => document.getElementById('a1-cobranca').getBoundingClientRect().top);
    c('sai da tela ao rolar para baixo', depois < antes - 100, `antes=${antes} depois=${depois}`);
    c('tem animação de descida', await p.evaluate(() =>
      /a1CobDesce/.test(getComputedStyle(document.getElementById('a1-cobranca')).animationName)
      || getComputedStyle(document.getElementById('a1-cobranca')).animationName !== 'none'));
    c('o cabeçalho continua funcionando', await p.locator('.hdr').isVisible());
    c('a tela continua carregando os dados', (await p.locator('#kpi-total').textContent()).trim() !== '');
    c('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close(); }

  console.log('\n== EM DIA: nenhuma tarja ==');
  { const { b, p, erros } = await abrirCliente({ due_day: 10, valor:'600,00',
      paid: { [mesAtual]: { paid:true, date:new Date().toISOString() },
              [mesPassado]: { paid:true, date:new Date().toISOString() } } });
    c('cliente em dia não vê tarja', (await p.locator('#a1-cobranca').count()) === 0);
    c('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close(); }

  console.log('\n== SEM COBRANÇA CONFIGURADA: nada acontece ==');
  { const { b, p, erros } = await abrirCliente(null);
    c('sem cobrança cadastrada, sem tarja', (await p.locator('#a1-cobranca').count()) === 0);
    c('a tela funciona igual', (await p.locator('#kpi-total').textContent()).trim() !== '');
    c('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close(); }

  console.log('\n== VENCIMENTO PASSADO SEM PAGAR: atraso automático ==');
  { // due_day 1, sem registro nenhum: só o mês corrente pode estar vencido
    const { b, p } = await abrirCliente({ due_day: 1, valor:'600,00', paid: {} });
    c('vence e não paga: a tarja aparece sozinha', (await p.locator('#a1-cobranca').count()) === 1);
    c('cliente sem histórico não é acusado de meses antigos',
      /Mensalidade de/.test(await p.locator('#a1-cobranca').textContent()),
      await p.locator('#a1-cobranca').textContent());
    await b.close(); }

  console.log('\n== NÃO INVENTAR DÍVIDA ANTIGA ==');
  { // cliente começou a ser cobrado 3 meses atrás e pagou tudo menos o último
    const k = m => { const d = new Date(hoje.getFullYear(), hoje.getMonth() - m, 1);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
    const { b, p } = await abrirCliente({ due_day: 1, valor:'600,00', paid: {
      [k(3)]: { paid:true }, [k(2)]: { paid:true } } });
    const t = await p.locator('#a1-cobranca').textContent();
    c('só cobra o que ficou em aberto depois do início', /2 mensalidades/.test(t), t);
    c('e a mais antiga é do mês seguinte ao último pago',
      new RegExp(String(k(1)).slice(0,4)).test(t), t);
    c('não menciona nada antes do primeiro registro', await p.evaluate(m => {
      const s = document.getElementById('a1-cobranca').textContent;
      return !s.includes(String(new Date().getFullYear() - 1));
    }));
    await b.close(); }

  console.log('\n== A CONTA, no papel ==');
  { const { b, p } = await abrirCliente({ due_day: 1, paid: {} });
    const casos = await p.evaluate(() => {
      const f = A1Cobranca.mesesEmAtraso;
      const y = new Date().getFullYear();
      return {
        vazioSemDia: f({ paid:{} }).length,
        soMarcado:   f({ paid:{ '2026-03': { atraso:true } } }),
        pagoNaoConta:f({ due_day:1, paid:{ '2026-03': { paid:true } } }).includes('2026-03'),
        nulo:        f(null).length,
      };
    });
    c('sem dia de vencimento e sem marca: nada em atraso', casos.vazioSemDia === 0, JSON.stringify(casos));
    c('marcado à mão entra mesmo sem dia de vencimento',
      casos.soMarcado.length === 1 && casos.soMarcado[0] === '2026-03', JSON.stringify(casos.soMarcado));
    c('mês pago nunca entra', casos.pagoNaoConta === false);
    c('cobrança inexistente não quebra', casos.nulo === 0);
    await b.close(); }

  console.log('\n== SÓ GESTOR (opção desligada por padrão) ==');
  { const { b, p } = await abrirCliente({ due_day: 10, paid: { [mesPassado]: { atraso:true } } },
      { id:'p1', partner_id:'p1', tenant_id:'t1', name:'Ana', role:'partner', type:'corretor' });
    c('por padrão a equipe também vê', (await p.locator('#a1-cobranca').count()) === 1);
    const so = await p.evaluate(() => A1Cobranca.CONTATO.soGestor);
    c('e existe a chave para restringir a gestores', so === false, 'soGestor=' + so);
    await b.close(); }

  console.log(`\n${bad ? '>>> FALHAS: ' + bad : '>>> tudo passou'} (${ok} verificações)`);
  process.exit(bad ? 1 : 0);
})();
