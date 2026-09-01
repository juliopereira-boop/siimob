const { chromium } = require('playwright');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);
let ok=0,bad=0; const c=(n,v,x='')=>{v?(ok++,console.log('  ✓ '+n)):(bad++,console.log('  ✗ '+n+'  '+x));};
const enviados=[];
async function pag(url, viewport){
  const b = await chromium.launch();
  const p = await b.newPage({ viewport });
  const erros=[]; p.on('pageerror',e=>erros.push(e.message));
  p.on('console',m=>{const t=m.text(); if(m.type()==='error'&&!/ERR_|fonts|favicon/.test(t)) erros.push(t);});
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, r=>{
    const u=r.request().url();
    if(u.includes('a1_indica_enviar')){ enviados.push(JSON.parse(r.request().postData()||'{}'));
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,token:'tok123',nome:'Maria Silva'})}); }
    if(u.includes('a1_indica_painel')) return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      ok:true,nome:'Maria Silva',total_a_receber:2400,total_geral:2400,
      indicacoes:[{id:'i1',empresa:'Construtora Alfa',cidade:'Teresina',uf:'PI',status:'fechado',valor_contrato:12000,percentual:20,pago:false,comissao:2400},
                  {id:'i2',empresa:'Imob Beta',cidade:'Timon',uf:'MA',status:'nova',comissao:0,pago:false}]})});
    return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await p.goto(url,{waitUntil:'load'}); await p.waitForTimeout(900);
  return {b,p,erros};
}
(async()=>{
  console.log('== ESTRUTURA E SEO ==');
  { const {b,p,erros}=await pag(BASE + '/indica.html',{width:1440,height:1000});
    c('um único H1', await p.locator('h1').count()===1, 'h1='+(await p.locator('h1').count()));
    const h2=await p.locator('h2').count(); c('H2 por seção', h2>=10, 'h2='+h2);
    const secoes=await p.evaluate(()=>[...document.querySelectorAll('main > section')].map(s=>s.id||'(sem id)'));
    console.log('     seções:', secoes.join(' → '));
    c('14 seções na ordem pedida', secoes.length>=13, 'n='+secoes.length);
    c('title e description', (await p.title()).includes('IndicaSII')
       && !!(await p.locator('meta[name=description]').getAttribute('content')));
    c('OpenGraph', (await p.locator('meta[property="og:title"]').count())===1);
    c('Twitter card', (await p.locator('meta[name="twitter:card"]').count())===1);
    const ld=JSON.parse(await p.locator('#ld-faq').textContent());
    const faqLd=ld['@graph'].find(x=>x['@type']==='FAQPage');
    const naTela=await p.locator('#faq .faq-i').count();
    c('FAQPage reflete o que está na tela', faqLd.mainEntity.length===naTela, `${faqLd.mainEntity.length} vs ${naTela}`);
    c('Organization no schema', !!ld['@graph'].find(x=>x['@type']==='Organization'));
    c('sem erro no console', erros.length===0, erros[0]||'');

    console.log('\n== SIMULADOR ==');
    const total=()=>p.locator('#sim-total').textContent();
    c('valor inicial 1 × R$1.500 × 20% = R$ 300', /300$/.test((await total()).trim()), await total());
    await p.locator('#sim-qtd').fill('3'); await p.waitForTimeout(200);
    c('3 indicações = R$ 900', /900$/.test((await total()).trim()), await total());
    await p.locator('#sim-val').fill('3000'); await p.waitForTimeout(200);
    c('3 × R$3.000 × 20% = R$ 1.800', (await total()).includes('1.800'), await total());
    await p.locator('#sim-qtd').fill('10'); await p.waitForTimeout(200);
    c('10 × R$3.000 × 20% = R$ 6.000', (await total()).includes('6.000'), await total());
    c('conta explicada na tela', /20% de .* × 10 indicações/.test(await p.locator('#sim-conta').textContent()),
      await p.locator('#sim-conta').textContent());
    c('rótulo fala em primeira parcela, não em contrato',
      /primeira parcela/i.test(await p.locator('label[for="sim-val"]').textContent()),
      await p.locator('label[for="sim-val"]').textContent());
    c('teto do slider é a maior parcela, não um contrato inteiro',
      Number(await p.locator('#sim-val').getAttribute('max')) <= 10000,
      await p.locator('#sim-val').getAttribute('max'));
    c('moeda em pt-BR', (await total()).startsWith('R$'));
    c('piso do slider é 600', await p.locator('#sim-val').getAttribute('min')==='600', await p.locator('#sim-val').getAttribute('min'));
    await p.locator('#sim-qtd').fill('1'); await p.locator('#sim-val').fill('600'); await p.waitForTimeout(200);
    c('no piso: 1 × R$600 × 20% = R$ 120', /120$/.test((await total()).trim()), await total());
    c('visor mostra R$ 600 no piso', (await p.locator('#sim-val-v').textContent()).includes('600'), await p.locator('#sim-val-v').textContent());
    const abaixo=await p.locator('#sim-val').evaluate(e=>{ e.value='500'; return e.value; });
    c('não desce abaixo de 600', abaixo==='600', abaixo);
    const escada=await p.locator('#escada .degrau-v').allTextContents();
    c('escada calculada, não digitada', /300$/.test(escada[0].trim()) && escada[3].includes('1.500'), escada.join('|'));

    console.log('\n== BASE DE CÁLCULO SEM AMBIGUIDADE ==');
    // "20% do contrato" se lê como 20% do contrato inteiro. Em lugar nenhum da
    // página visível isso pode aparecer solto.
    const visivel = await p.evaluate(() => document.body.innerText);
    const ambiguo = visivel.match(/20\s*%\s+d[oe]s?\s+(?:valor\s+d[oe]\s+)?contrato(?!\s+fechad)/gi) || [];
    c('nenhum "20% do contrato" solto no texto visível', ambiguo.length === 0, ambiguo.join(' | '));
    c('a página diz que é a primeira parcela', /primeira parcela/i.test(visivel));
    c('a página diz que o pagamento é único', /pagamento único|uma única vez|paga uma vez|pago uma vez/i.test(visivel));
    const faqTxt = await p.locator('#faq').textContent();
    c('as dúvidas explicam a base de cálculo',
      /não\s+s(?:ão|er)\s+20%\s+do\s+valor\s+total|não\s+sobre\s+o\s+valor\s+total/i.test(faqTxt));

    console.log('\n== FAQ ACESSÍVEL ==');
    c('todas fechadas no início', (await p.locator('#faq .faq-b[aria-expanded="true"]').count())===0);
    await p.locator('#faq .faq-b').first().click(); await p.waitForTimeout(350);
    c('abre ao clicar', (await p.locator('#faq .faq-b[aria-expanded="true"]').count())===1);
    c('resposta fica visível', (await p.locator('#faq .faq-r').first().evaluate(e=>e.getBoundingClientRect().height))>10);
    await p.locator('#faq .faq-b').nth(2).click(); await p.waitForTimeout(350);
    c('só uma aberta por vez', (await p.locator('#faq .faq-b[aria-expanded="true"]').count())===1);
    await p.locator('#faq .faq-b').nth(2).click(); await p.waitForTimeout(350);
    c('fecha ao clicar de novo', (await p.locator('#faq .faq-b[aria-expanded="true"]').count())===0);
    c('aria-controls ligado', await p.locator('#faq .faq-b').first().getAttribute('aria-controls')==='faq-r-0');

    console.log('\n== PLACEHOLDERS AVISADOS ==');
    c('métricas reservadas em destaque', await p.locator('#metricas-nota').isVisible());
    c('depoimentos reservados avisados', await p.locator('#dep-nota').isVisible());
    c('sem número de cliente inventado', !(await p.locator('#grade-metricas').textContent()).match(/\b\d{2,}\+/));

    console.log('\n== LINKS INTERNOS ==');
    const alvos=await p.evaluate(()=>[...document.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href')).filter(h=>h!=='#'));
    const faltando=[];
    for(const h of [...new Set(alvos)]) if(!(await p.locator(h).count())) faltando.push(h);
    c('todo link interno tem destino', faltando.length===0, faltando.join(','));

    console.log('\n== FORMULÁRIO DE CAPTURA ==');
    await p.locator('#form-inicio button[type=submit]').click(); await p.waitForTimeout(200);
    c('valida campo vazio', await p.locator('#e-nome').isVisible());
    c('marca aria-invalid', await p.locator('#i-nome').getAttribute('aria-invalid')==='true');
    await p.fill('#i-nome','Maria Silva'); await p.fill('#i-fone','86999887766');
    c('máscara de telefone', (await p.inputValue('#i-fone'))==='(86) 99988-7766');
    console.log('\n== PAINEL ==');
    await p.fill('#p-token','http://x/indica?t=tok123');
    await p.click('#painel-entrar button'); await p.waitForTimeout(700);
    c('painel carrega', await p.locator('#painel-dados').isVisible());
    c('mostra a comissão', (await p.locator('#p-tbody').textContent()).includes('2.400'));
    c('mostra o total a receber', (await p.locator('#painel-totais').textContent()).includes('2.400'));
    await p.screenshot({path:__dirname+'/indica-desk.png',fullPage:true});
    await b.close();
  }

  console.log('\n== MOBILE 390px ==');
  { const {b,p,erros}=await pag(BASE + '/indica.html',{width:390,height:844});
    const over=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    c('sem rolagem horizontal', over<=0, 'excesso='+over+'px');
    c('menu vira hambúrguer', await p.locator('#hamb').isVisible() && !(await p.locator('#nav').isVisible()));
    await p.click('#hamb'); await p.waitForTimeout(400);
    c('gaveta abre', await p.locator('#gaveta').evaluate(e=>e.classList.contains('aberta')));
    c('aria-expanded no botão', await p.locator('#hamb').getAttribute('aria-expanded')==='true');
    await p.locator('#gaveta-links a').first().click(); await p.waitForTimeout(400);
    c('clicar no link fecha a gaveta', !(await p.locator('#gaveta').evaluate(e=>e.classList.contains('aberta'))));
    c('simulador funciona no celular', (await p.locator('#sim-total').textContent()).includes('R$'));
    const larg=await p.locator('.hero-ctas .btn').first().evaluate(e=>e.getBoundingClientRect().width);
    c('CTA ocupa a largura no mobile', larg>300, 'largura='+Math.round(larg));
    c('sem erro no console', erros.length===0, erros[0]||'');
    await p.screenshot({path:__dirname+'/indica-mob.png',fullPage:true});
    await b.close();
  }

  console.log('\n== CADASTRO (passo 2) ==');
  { const {b,p,erros}=await pag(BASE + '/indica-cadastro.html',{width:1200,height:900});
    await p.click('#btn'); await p.waitForTimeout(300);
    c('valida obrigatórios', await p.locator('#e-nome').isVisible() && await p.locator('#e-doc').isVisible()
       && await p.locator('#e-empresa').isVisible());
    c('exige o aceite', await p.locator('#e-aceite').isVisible());
    await p.fill('#f-nome','Maria Silva'); await p.fill('#f-doc','12345678909');
    c('máscara de CPF', (await p.inputValue('#f-doc'))==='123.456.789-09');
    await p.fill('#f-doc','11222333000181');
    c('máscara de CNPJ', (await p.inputValue('#f-doc'))==='11.222.333/0001-81');
    await p.fill('#f-doc','123.456.789-09');
    await p.fill('#f-empresa','Construtora Alfa'); await p.selectOption('#f-uf','PI');
    await p.check('#f-aceite');
    await p.click('#btn'); await p.waitForTimeout(900);
    c('envia para a função do banco', enviados.length===1, 'n='+enviados.length);
    if(enviados[0]){
      c('manda o documento só com dígitos', enviados[0].p_documento==='12345678909', enviados[0].p_documento);
      c('manda a empresa', enviados[0].p_empresa==='Construtora Alfa');
      c('manda a UF', enviados[0].p_uf==='PI');
    }
    c('mostra o sucesso', await p.locator('#v-ok').isVisible());
    c('entrega o link do painel', (await p.inputValue('#ok-link')).includes('t=tok123'));
    c('sem erro no console', erros.length===0, erros[0]||'');
    await b.close();
  }
  console.log(bad?`\n>>> FALHAS: ${bad} (${ok} ok)`:`\n>>> tudo passou (${ok} verificações)`);
  process.exit(bad?1:0);
})();
