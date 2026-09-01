const { chromium } = require('playwright');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);
let ok=0, bad=0;
const checa=(n,c,x='')=>{ c?(ok++,console.log('  ✓ '+n)):(bad++,console.log('  ✗ '+n+' '+x)); };

// Avisos que o "banco" tem, com públicos diferentes
const AVISOS = [
  {id:'a1',titulo:'Para todos',corpo:'linha 1\n\nlinha 2',publicos:[],tenants:[],publicado:true,fixado:false,publicado_em:'2026-09-01T10:00:00Z'},
  {id:'a2',titulo:'Só gestores <img src=x onerror="window.__XSS=1">',corpo:'texto do aviso com arte',
   imagem_url:BASE + '/assets/banners/indicasii-mural.jpg',
   publicos:['gestor'],tenants:[],publicado:true,fixado:false,publicado_em:'2026-09-01T09:00:00Z'},
];
const lidos = new Set();

async function abrirComo(usuario) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1280,height:900} });
  const erros = [];
  p.on('pageerror', e => erros.push(e.message));
  await p.addInitScript(u => {
    localStorage.setItem('a1_token','tok'); localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify(u));
    window.__XSS = 0;
  }, usuario);
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, async r => {
    const u = r.request().url(), m = r.request().method();
    const j = x => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if (u.includes('/rpc/a1_avisos_para_mim')) {
      const corpo = JSON.parse(r.request().postData()||'{}');
      const pub = corpo.p_publico, chave = corpo.p_user_key;
      return j(AVISOS.filter(a => a.publicado
        && (!a.publicos.length || a.publicos.includes(pub))
        && (a.fixado || !lidos.has(a.id + '|' + chave))));
    }
    if (u.includes('a1_avisos_lidos') && m === 'POST') {
      const c = JSON.parse(r.request().postData()||'{}');
      lidos.add(c.aviso_id + '|' + c.user_key);
      return j([c]);
    }
    if (u.includes('/rpc/')) return j(true);
    if (u.includes('a1_stages')) return j([{id:'s1',name:'E',color:'#333',position:1,is_initial:true,module_key:'repasse'}]);
    if (u.includes('a1_tenants')) return j([{id:'t1',max_users:10}]);
    return j([]);
  });
  await p.goto(BASE + '/repasse.html', {waitUntil:'load'});
  await p.waitForTimeout(2600);
  return { b, p, erros };
}

(async () => {
  console.log('== GESTOR vê os dois avisos ==');
  {
    const { b, p, erros } = await abrirComo({id:'u1',tenant_id:'t1',name:'Julio',role:'owner'});
    checa('pop-up aparece', await p.locator('#a1-avisos').count() === 1);
    checa('mostra o primeiro aviso', /Para todos/.test(await p.locator('.av-titulo').textContent()));
    checa('conta 1 de 2', /1 de 2/.test(await p.locator('.av-conta').textContent()));
    checa('parágrafos separados', (await p.locator('.av-corpo p').count()) === 2);
    checa('sem arte, o texto já vem aberto', await p.locator('.av-corpo').isVisible());
    checa('sem arte, não há botão de expandir', (await p.locator('.av-mais').count()) === 0);
    await p.screenshot({path:__dirname+'/mural-popup.png', clip:{x:340,y:180,width:600,height:420}});
    await p.click('.av-btn-p'); await p.waitForTimeout(500);
    checa('próximo mostra o segundo', /gestores/.test(await p.locator('.av-titulo').textContent()));

    console.log('  -- aviso com imagem: a arte é o que aparece --');
    checa('a imagem entra no pop-up', (await p.locator('.av-arte img').count()) === 1);
    const carregou = await p.locator('.av-arte img').evaluate(i => i.complete && i.naturalWidth > 0);
    checa('a imagem carrega de verdade', carregou);
    const larg = await p.locator('.av-arte img').evaluate(i =>
      Math.round(i.getBoundingClientRect().width / i.closest('.av-caixa').getBoundingClientRect().width * 100));
    checa('ocupa a caixa toda, sem margem', larg === 100, larg + '%');
    checa('o texto começa escondido', !(await p.locator('.av-corpo').isVisible()));
    checa('tem botão para estender', (await p.locator('.av-mais').count()) === 1);
    checa('botão diz o que faz', /Ler o aviso completo/.test(await p.locator('.av-mais').textContent()));
    checa('aria-expanded começa falso', await p.locator('.av-mais').getAttribute('aria-expanded') === 'false');
    checa('aria-controls aponta para o texto', await p.locator('.av-mais').getAttribute('aria-controls') === 'av-corpo');
    await p.click('.av-mais'); await p.waitForTimeout(350);
    checa('clicou e o texto apareceu', await p.locator('.av-corpo').isVisible());
    checa('aria-expanded virou verdadeiro', await p.locator('.av-mais').getAttribute('aria-expanded') === 'true');
    checa('o rótulo do botão muda', /Fechar o texto/.test(await p.locator('.av-mais').textContent()));
    await p.screenshot({path:__dirname+'/mural-arte.png', clip:{x:330,y:60,width:620,height:800}});
    await p.click('.av-mais'); await p.waitForTimeout(350);
    checa('fecha de novo', !(await p.locator('.av-corpo').isVisible()));
    checa('a imagem abre em tamanho real', /indicasii-mural/.test(
      await p.locator('.av-arte a').getAttribute('href') || ''));
    checa('link externo com rel seguro', /noopener/.test(
      await p.locator('.av-arte a').getAttribute('rel') || ''));
    checa('título com HTML não executa', (await p.evaluate(()=>window.__XSS||0)) === 0);
    checa('o HTML aparece como texto', /<img/.test(await p.locator('.av-titulo').textContent()));
    await p.click('.av-btn-p'); await p.waitForTimeout(600);
    checa('fecha no fim', await p.locator('#a1-avisos').count() === 0);
    checa('sem erro de JS', erros.length === 0, erros[0]||'');
    await b.close();
  }

  console.log('\n== GESTOR recarrega: aviso lido não volta ==');
  {
    const { b, p } = await abrirComo({id:'u1',tenant_id:'t1',name:'Julio',role:'owner'});
    checa('nenhum pop-up', await p.locator('#a1-avisos').count() === 0);
    await b.close();
  }

  console.log('\n== CORRETOR só vê o que é para todos ==');
  {
    const { b, p } = await abrirComo({id:'u9',partner_id:'p3',tenant_id:'t1',name:'Ana',role:'partner',type:'corretor'});
    checa('pop-up aparece', await p.locator('#a1-avisos').count() === 1);
    checa('só um aviso, sem contador', (await p.locator('.av-conta').textContent()).trim() === '');
    checa('é o de todos', /Para todos/.test(await p.locator('.av-titulo').textContent()));
    await b.close();
  }

  console.log('\n== AVISO FIXADO volta sempre ==');
  {
    AVISOS.push({id:'a3',titulo:'Fixado',corpo:'sempre',publicos:[],tenants:[],publicado:true,fixado:true,publicado_em:'2026-09-01T11:00:00Z'});
    const { b, p } = await abrirComo({id:'u1',tenant_id:'t1',name:'Julio',role:'owner'});
    checa('fixado aparece mesmo com os outros lidos', /Fixado/.test(await p.locator('.av-titulo').textContent()));
    await p.click('.av-btn-p'); await p.waitForTimeout(400);
    await b.close();
    const { b:b2, p:p2 } = await abrirComo({id:'u1',tenant_id:'t1',name:'Julio',role:'owner'});
    checa('e volta na próxima entrada', await p2.locator('#a1-avisos').count() === 1);
    await b2.close();
  }

  console.log('\n== SEM O SQL RODADO, o sistema não quebra ==');
  {
    const b = await chromium.launch();
    const p = await b.newPage();
    const erros = [];
    p.on('pageerror', e => erros.push(e.message));
    await p.addInitScript(() => { localStorage.setItem('a1_token','tok'); localStorage.setItem('a1_slug','thecred');
      localStorage.setItem('a1_user', JSON.stringify({id:'u1',tenant_id:'t1',name:'J',role:'owner'})); });
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
    await p.route(/supabase\.co/, r => {
      const u = r.request().url();
      if (u.includes('a1_avisos')) return r.fulfill({status:404,contentType:'application/json',body:'{"message":"not found"}'});
      if (u.includes('/rpc/')) return r.fulfill({status:200,contentType:'application/json',body:'true'});
      if (u.includes('a1_stages')) return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:'s1',name:'E',color:'#333',position:1,is_initial:true,module_key:'repasse'}])});
      return r.fulfill({status:200,contentType:'application/json',body:'[]'});
    });
    await p.goto(BASE + '/repasse.html', {waitUntil:'load'});
    await p.waitForTimeout(2500);
    checa('sem pop-up e sem erro', (await p.locator('#a1-avisos').count()) === 0 && erros.length === 0, erros[0]||'');
    checa('a tela continua funcionando', (await p.locator('#kpi-total').textContent()).trim() !== '');
    await b.close();
  }
  console.log(bad ? `\n>>> FALHAS: ${bad} (${ok} ok)` : `\n>>> tudo passou (${ok} verificações)`);
  process.exit(bad?1:0);
})();
