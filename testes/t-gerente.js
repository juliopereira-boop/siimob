// Reproduz o caso da produção: usuária CORRESPONDENTE marcada como GERENTE
// abrindo um processo que é de outra pessoa. Não pode aparecer a tarja
// "você está apenas visualizando", e o anexo tem de funcionar.
const { chromium } = require('playwright');
const { responder } = require('./fake');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

let ok = 0, bad = 0;
const c = (n, v, x = '') => { v ? (ok++, console.log('  ✓ ' + n)) : (bad++, console.log('  ✗ ' + n + '  ' + x)); };

const PERMS_GERENTE = {
  gerente: true, ver_repasses: true, criar_repasses: true, editar_repasses: true,
  ver_dashboard: true, baixar_documentos: true, editar_perfil: true,
  ver_todos_analistas: true, analistas_permitidos: [],
};

// permsLocal = o que está no localStorage (retrato do login)
// permsBanco  = o que a1_partners devolve
// falharPrimeiras = quantas consultas a a1_partners devolvem erro antes de funcionar
async function abrirComo(pag, permsLocal, permsBanco, opc = {}) {
  const USUARIO = opc.usuario || {
    id: 'p-raissa', tenant_id: 't1', name: 'Raissa Rosselyne Silva Lima dos Reis',
    role: 'partner', type: 'cca',
  };
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [];
  const consultas = { n: 0 };
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.addInitScript(a => {
    localStorage.setItem('a1_token', 'tok');
    localStorage.setItem('a1_slug', 'thecred');
    localStorage.setItem('a1_user', JSON.stringify({ ...a.u, permissions: a.pl }));
    window.__XSS = 0; window.confirm = () => true;
    window.__TOASTS = [];
  }, { u: USUARIO, pl: permsLocal });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status:200, contentType:'text/css', body:'' }));
  await p.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (/a1_partners\?id=eq\.p-raissa/.test(u)) {
      consultas.n++;
      if (permsBanco === null || consultas.n <= (opc.falharPrimeiras || 0)) {
        return r.fulfill({ status: 401, contentType:'application/json', body:'[]' });
      }
      return r.fulfill({ status:200, contentType:'application/json',
        body: JSON.stringify([{ permissions: permsBanco, type:'cca' }]) });
    }
    let d; try { d = responder(u, r.request().method()); } catch { d = []; }
    r.fulfill({ status:200, contentType:'application/json',
      headers:{ 'content-range':'0-1/2' }, body: JSON.stringify(d) });
  });
  await p.goto(BASE + '/' + pag, { waitUntil:'load' });
  await p.waitForTimeout(1800);
  // captura os avisos que o sistema mostra
  await p.evaluate(() => { const t = window.toast; window.toast = (m, k) => { window.__TOASTS.push(m); return t && t(m, k); }; });
  return { b, p, erros, consultas };
}

// c1 é da Ana Souza / João Analista — nunca da Raissa.
async function abrirCartao(p) { await p.evaluate(() => openCard('c1')); await p.waitForTimeout(1000); }
const tarja = p => p.evaluate(() => {
  const l = document.getElementById('mc-lock');
  return (!l || l.style.display === 'none') ? '' : (l.textContent || '');
});
const anexar = p => p.evaluate(async () => {
  window.__TOASTS = [];
  await attachDoc(new File(['x'], 'rg.pdf', { type:'application/pdf' }));
  return window.__TOASTS.join(' | ');
});

(async () => {
  console.log('== GERENTE, permissões já no localStorage ==');
  { const { b, p, erros } = await abrirComo('andamento.html', PERMS_GERENTE, PERMS_GERENTE);
    await abrirCartao(p);
    c('sem tarja de somente leitura', (await tarja(p)) === '', await tarja(p));
    c('podeEditarProcesso diz que sim', await p.evaluate(() => podeEditarProcesso(G.editingCaseData)));
    c('o anexo não é barrado', !/não é seu|Sem permissão/.test(await anexar(p)));
    c('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close(); }

  console.log('\n== GERENTE marcado DEPOIS do login (localStorage desatualizado) ==');
  { const semGerente = { ...PERMS_GERENTE, gerente:false, editar_repasses:false };
    const { b, p, erros } = await abrirComo('andamento.html', semGerente, PERMS_GERENTE);
    c('o boot puxou a permissão nova', await p.evaluate(() => !!(G.user.permissions||{}).gerente));
    await abrirCartao(p);
    c('sem tarja de somente leitura', (await tarja(p)) === '', await tarja(p));
    await b.close(); }

  console.log('\n== a permissão só chega na SEGUNDA consulta (boot falhou) ==');
  { const semGerente = { ...PERMS_GERENTE, gerente:false, editar_repasses:false };
    const { b, p, erros, consultas } = await abrirComo('andamento.html', semGerente, PERMS_GERENTE, { falharPrimeiras: 1 });
    await abrirCartao(p);
    c('abrir o cartão reconfere e libera', (await tarja(p)) === '', await tarja(p));
    c('consultou o banco mais de uma vez', consultas.n >= 2, 'n=' + consultas.n);
    c('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close(); }

  console.log('\n== a1_partners nega sempre: não pode rebaixar quem já era gerente ==');
  { const { b, p, erros } = await abrirComo('andamento.html', PERMS_GERENTE, null);
    c('mantém o gerente do login', await p.evaluate(() => !!(G.user.permissions||{}).gerente));
    await abrirCartao(p);
    c('sem tarja de somente leitura', (await tarja(p)) === '', await tarja(p));
    c('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close(); }

  console.log('\n== permissões vindas como TEXTO do banco (jsonb serializado) ==');
  { const semGerente = { ...PERMS_GERENTE, gerente:false, editar_repasses:false };
    const { b, p, erros } = await abrirComo('andamento.html', semGerente, JSON.stringify(PERMS_GERENTE));
    c('entende o texto como objeto', await p.evaluate(() => !!(G.user.permissions||{}).gerente));
    await abrirCartao(p);
    c('sem tarja de somente leitura', (await tarja(p)) === '', await tarja(p));
    c('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close(); }

  console.log('\n== CONTROLE: correspondente comum continua bloqueado, e a tarja diz o motivo ==');
  { const comum = { gerente:false, ver_repasses:true, criar_repasses:true, editar_repasses:true,
                    baixar_documentos:true, editar_perfil:true, ver_todos_analistas:true };
    const { b, p, erros } = await abrirComo('andamento.html', comum, comum);
    await abrirCartao(p);
    const t = await tarja(p);
    c('a tarja aparece, como deve', t !== '');
    c('nomeia o dono do processo', /Ana Souza|João Analista/.test(t), t);
    c('a tarja diz com que acesso a pessoa entrou', /Seu acesso: correspondente/.test(t), t);
    c('o anexo é barrado', /não é seu/.test(await anexar(p)));

    console.log('  -- processo sem dono nenhum --');
    await p.evaluate(() => { const x = G.cases.find(k => k.id === 'c1');
      x.broker_name = ''; x.manager_name = ''; if (x.payload) x.payload.usuario_correspondente = ''; });
    await abrirCartao(p);
    const t2 = await tarja(p);
    c('não inventa "outro usuário"', !/outro usuário/.test(t2), t2);
    c('diz que o processo está sem responsável', /sem responsável definido/i.test(t2), t2);

    c('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close(); }

  console.log('\n== sem a permissão de editar: a tarja aponta a permissão, não o dono ==');
  { const semEditar = { gerente:false, ver_repasses:true, criar_repasses:true, editar_repasses:false,
                        baixar_documentos:true, editar_perfil:true, ver_todos_analistas:true };
    const { b, p, erros } = await abrirComo('andamento.html', semEditar, semEditar);
    await abrirCartao(p);
    const t3 = await tarja(p);
    c('a tarja aponta a permissão que falta', /Editar operações/i.test(t3), t3);
    c('não manda procurar um dono', !/Processo de/.test(t3), t3);
    c('o anexo diz o que pedir ao gestor', /Editar operações|Gerente/.test(await anexar(p)));
    c('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close(); }

  console.log('\n== GESTOR: nenhuma restrição, em nenhuma tela ==');
  for (const pag of ['andamento.html','repasse.html','listagem.html']) {
    for (const papel of ['owner','admin']) {
      const gestor = { id:'u-gestor', tenant_id:'t1', name:'Raissa (gestora)', role: papel };
      // gestor não tem permissions nenhuma: é exatamente o caso da produção
      const { b, p, erros } = await abrirComo(pag, undefined, undefined, { usuario: gestor });
      await abrirCartao(p);
      const t = await tarja(p);
      c(`${pag} / ${papel}: sem tarja`, t === '', t);
      c(`${pag} / ${papel}: podeEditarProcesso`, await p.evaluate(() => podeEditarProcesso(G.editingCaseData)));
      c(`${pag} / ${papel}: anexo liberado`, !/não é seu|Sem permissão/.test(await anexar(p)));
      c(`${pag} / ${papel}: campo de nome editável`,
        await p.evaluate(() => { const e = document.getElementById('e-name'); return !e || (!e.disabled && !e.readOnly); }));
      c(`${pag} / ${papel}: sem erro de JS`, erros.length === 0, erros[0] || '');
      await b.close();
    }
  }

  console.log('\n== GESTOR mesmo com permissões restritivas gravadas por engano ==');
  { const gestor = { id:'u-gestor', tenant_id:'t1', name:'Raissa (gestora)', role:'owner' };
    const travado = { gerente:false, editar_repasses:false, ver_repasses:true };
    const { b, p, erros } = await abrirComo('andamento.html', travado, travado, { usuario: gestor });
    await abrirCartao(p);
    c('permissão restritiva não alcança o gestor', (await tarja(p)) === '', await tarja(p));
    c('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close(); }

  console.log(`\n${bad ? '>>> FALHAS: ' + bad : '>>> tudo passou'} (${ok} verificações)`);
  process.exit(bad ? 1 : 0);
})();
