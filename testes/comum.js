const { chromium } = require('playwright');
const { responder, usarExtras, liberarModulos } = require('./fake');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);
async function abrir(pag, opc = {}) {
  usarExtras(opc.extras === true);
  // Módulos novos nascem sem licença, como em todo cliente de hoje. Quem for
  // testá-los ligados pede: abrir('pre-analise.html', {modulos:['PRE_ANALISE']}).
  liberarModulos(opc.modulos || []);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  p.on('console', m => { const t=m.text();
    if (m.type()==='error' && !/ERR_CONNECTION|ERR_TUNNEL|fonts\.g|favicon|net::/.test(t)) erros.push('console: '+t); });
  await p.addInitScript(() => {
    localStorage.setItem('a1_token','tok'); localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify({id:'u1',tenant_id:'t1',name:'Julio',role:'owner',cpf:'99999999999'}));
    window.__XSS = 0;
    window.confirm = () => true;                    // aceita confirmações
    window.__POSTS = [];
    const f = window.fetch;
    window.fetch = function(u, o){ if(o && o.method && o.method!=='GET') window.__POSTS.push({url:String(u),m:o.method,body:o.body}); return f.apply(this,arguments); };
  });
  await p.route(/supabase\.co/, r => {
    let d; try { d = responder(r.request().url(), r.request().method(), r.request().postData()); } catch(e){ d = []; }
    r.fulfill({status:200,contentType:'application/json',headers:{'content-range':'0-1/2'},body:JSON.stringify(d)});
  });
  await p.goto(BASE + '/'+pag, {waitUntil:'load'});
  await p.waitForTimeout(1600);
  // Os filtros agora nascem recolhidos. Os testes que mexem neles precisam da
  // barra visível; quem testa o recolhimento em si passa {filtros:false}.
  if (opc.filtros !== false) {
    await p.evaluate(() => {
      ['dash-filter-bar','filter-bar'].forEach(id => { const b=document.getElementById(id); if(b) b.style.display=''; });
    });
    await p.waitForTimeout(150);
  }
  return { b, p, erros };
}
let ok=0, bad=0;
function checa(nome, cond, extra='') {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { bad++; console.log(`  ✗ ${nome} ${extra}`); }
}
function resumo(erros) {
  if (erros.length) { console.log('\n  ERROS DE JS:'); erros.slice(0,10).forEach(e=>console.log('    '+e.slice(0,160))); }
  console.log(`\n${bad+erros.length ? '>>> FALHAS: '+(bad+erros.length) : '>>> tudo passou'}  (${ok} verificações ok)`);
  return bad + erros.length;
}
module.exports = { abrir, checa, resumo };
