const { chromium } = require('playwright');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);
const ARQ = '/root/.claude/uploads/ae532d4b-468c-5806-aa82-fa5aa6191ed4/63c11fa1-LISTA_DOS_PROCESSOS__ETAPA_CONFORMIDADE_1.xlsx';

// Banco de mentira que reflete o que o cliente REALMENTE tem cadastrado hoje
const ANALISTAS = ['AMANDA DA SILVA RODRIGUES','ANDREIA PEREIRA SOUSA SILVA','GILBERTO FERREIRA',
  'JANAILSON DE OLIVEIRA ARAUJO','LUIS GUILHERME OLIVEIRA SOARES','TEYCIVANNE RIBEIRO DE OLIVEIRA','THYAGO DE FRANÇA BARBOSA']
  .map((n,i)=>({id:'an'+i,name:n,is_active:true}));
const REGIONAIS = ['AGAPE','AR CONSTRUTORA','AVULSO','CANOPUS','COESA','CONSTENG','CONSTRUVILLE','DOMUS',
  'ESTRELA DA MANHÃ','JD CONSTRUTORA','LOGUS ENGENHARIA','MONTANA','MOREIRA E SOUSA','RIVELLO',
  'TERRAS CONSTRUTORA','TRIUNFO','VOITTO'];
const ETAPAS = ['A ENVIAR CONFORMIDADE','AGUARDANDO CONFORMIDADE','AGUARDANDO ENTREVISTA','AGUARDANDO LAUDO',
  'AGUARDANDO ASSINATURA CEF','PENDENTE','INCONFORME']
  .map((n,i)=>({id:'et'+i,name:n,position:i+1,is_initial:i===0}));
const MUNI = { TERESINA:[{nome:'Teresina',uf:'PI'}], TIMON:[{nome:'Timon',uf:'MA'}],
  ALTOS:[{nome:'Altos',uf:'PI'}], DEMERVAL:[{nome:'Demerval Lobão',uf:'PI'}] };

const criados = [];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1400,height:1000} });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_|fonts|favicon/.test(t)) erros.push('console: '+t); });
  await p.addInitScript(() => {
    localStorage.setItem('a1_token','tok'); localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify({id:'u1',tenant_id:'t1',name:'Julio',role:'owner'}));
  });
  await p.route(/supabase\.co/, async r => {
    const u = r.request().url(), m = r.request().method();
    const j = x => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if (m !== 'GET') {
      const corpo = JSON.parse(r.request().postData()||'{}');
      criados.push({url:u.split('/rest/v1/')[1].split('?')[0], m, corpo});
      return j([{...corpo, id:'novo-'+criados.length}]);
    }
    if (u.includes('/rpc/')) return j(true);
    if (u.includes('type=eq.analista'))    return j(ANALISTAS);
    if (u.includes('type=eq.corretor'))    return j([]);
    if (u.includes('type=eq.coordenador')) return j([]);
    if (u.includes('type=eq.modalidade'))  return j([]);
    if (u.includes('type=eq.agencia'))     return j([]);
    if (u.includes('a1_stages'))  return j(ETAPAS);
    if (u.includes('a1_config'))  return j([{value:JSON.stringify(REGIONAIS)}]);
    if (u.includes('a1_municipios')) {
      const nome = decodeURIComponent((u.match(/nome=ilike\.([^&*]+)/)||[])[1]||'').toUpperCase();
      return j(MUNI[nome] || []);
    }
    if (u.includes('a1_partners')) return j([]);
    return j([]);
  });

  await p.goto(BASE + '/importar.html', {waitUntil:'load'});
  await p.waitForTimeout(1200);

  console.log('== 1. LER A PLANILHA REAL ==');
  await p.setInputFiles('#arq', ARQ);
  await p.waitForTimeout(2500);
  const info = await p.locator('#arq-info').textContent();
  console.log('  ' + info.trim());

  console.log('\n== 2. RECONHECIMENTO DAS COLUNAS ==');
  const mapa = await p.evaluate(() => {
    const o = {};
    document.querySelectorAll('#mapa select').forEach(s => {
      const rot = s.closest('.campo').querySelector('label').textContent;
      o[rot] = s.value ? s.value + ' · ' + (s.options[s.selectedIndex].textContent.split('·')[1]||'').trim() : '(não achou)';
    });
    return o;
  });
  Object.entries(mapa).forEach(([k,v]) => console.log(`  ${k.padEnd(26)} ← ${v}`));
  console.log('  obs: ' + (await p.locator('#mapa-obs').textContent()).trim());

  console.log('\n== 3. CONFERÊNCIA ==');
  await p.click('button:has-text("Conferir a base")');
  await p.waitForTimeout(3000);
  const resumo = await p.locator('#conf-resumo').textContent();
  console.log('  ' + resumo.replace(/\s+/g,' ').trim().slice(0,900));

  const secoes = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('#conf-corpo > div').forEach(d => {
      const tit = d.querySelector('div').textContent;
      const linhas = [...d.querySelectorAll('tbody tr')].map(tr => {
        const td = tr.querySelectorAll('td');
        return `${td[0]?.textContent.trim()} → ${td[1]?.textContent.trim()}${td[2]?.textContent.trim()?' ('+td[2].textContent.trim()+')':''}`;
      });
      out.push({tit, linhas});
    });
    return out;
  });
  for (const s of secoes) {
    console.log(`\n  --- ${s.tit} (${s.linhas.length})`);
    s.linhas.slice(0,8).forEach(l => console.log('      ' + l));
    if (s.linhas.length > 8) console.log(`      … mais ${s.linhas.length-8}`);
  }

  console.log('\n== 4. SITUAÇÃO → ETAPA ==');
  const et = await p.evaluate(() => [...document.querySelectorAll('#tb-etapas tr')].map(tr => {
    const td = tr.querySelectorAll('td');
    return `${td[0].textContent.trim()} (${td[1].textContent.trim()}) → ${td[2].querySelector('select').selectedOptions[0].textContent.trim()}`;
  }));
  et.forEach(x => console.log('  ' + x));

  console.log('\n== 5. RESUMO ==');
  console.log('  ' + (await p.locator('#imp-resumo').textContent()).trim());
  await p.screenshot({ path:__dirname+'/import-conf.png', fullPage:true });

  console.log('\n== 6. IMPORTANDO DE VERDADE ==');
  await p.click('#btn-importar');
  await p.waitForFunction(() => /Concluído|Parou/.test(document.getElementById('imp-passo').textContent), {timeout:120000});
  await p.waitForTimeout(800);
  console.log('  ' + (await p.locator('#imp-antes').textContent()).replace(/\s+/g,' ').trim());

  const porTabela = {};
  criados.forEach(c => { porTabela[c.url] = (porTabela[c.url]||0)+1; });
  console.log('\n  gravações por tabela:', JSON.stringify(porTabela));
  const cadastros = criados.filter(c=>c.url==='a1_partners' && c.m==='POST');
  const porTipo = {};
  cadastros.forEach(c => { porTipo[c.corpo.type] = (porTipo[c.corpo.type]||0)+1; });
  console.log('  cadastros criados:', JSON.stringify(porTipo));
  const proc = criados.filter(c=>c.url==='a1_cases');
  console.log('  processos criados:', proc.length);

  console.log('\n  --- exemplo de processo criado ---');
  console.log('  ' + JSON.stringify(proc[0].corpo, null, 1).replace(/\n/g,'\n  '));

  console.log('\n  --- conferências ---');
  const ok=(n,c)=>console.log(`  ${c?'✓':'✗'} ${n}`);
  ok('74 processos', proc.length===74);
  ok('todo processo tem etapa', proc.every(c=>c.corpo.stage_id && c.corpo.stage_name));
  ok('todo processo tem cliente', proc.every(c=>c.corpo.client_name));
  ok('CPF só com dígitos', proc.every(c=>/^\d*$/.test(c.corpo.client_cpf)));
  ok('CPF com 11 dígitos', proc.every(c=>c.corpo.client_cpf.length===11));
  ok('data no formato ISO ou vazia', proc.every(c=>!c.corpo.payload.data_venda || /^\d{4}-\d{2}-\d{2}$/.test(c.corpo.payload.data_venda)));
  const semData = proc.filter(c=>!c.corpo.payload.data_venda).length;
  ok('15 sem data, como avisado', semData===15);
  const teresina = proc.filter(c=>c.corpo.payload.cidade==='Teresina');
  ok('Teresina veio com PI', teresina.length>0 && teresina.every(c=>c.corpo.payload.estado==='PI'));
  const timon = proc.filter(c=>c.corpo.payload.cidade==='Timon');
  ok('Timon veio com MA (nao PI)', timon.length>0 && timon.every(c=>c.corpo.payload.estado==='MA'));
  const semAnalista = proc.filter(c=>!c.corpo.manager_name);
  ok('só os da ANA CAROLINA ficam sem analista', semAnalista.length>0 && semAnalista.length<74);
  ok('analista ligado pelo nome completo', proc.some(c=>c.corpo.manager_name==='THYAGO DE FRANÇA BARBOSA'));
  ok('regional preenchida', proc.every(c=>c.corpo.payload.regional));
  ok('agência com número e nome', proc.every(c=>/^\d+ - /.test(c.corpo.payload.agencia)));
  ok('modalidade preenchida', proc.every(c=>c.corpo.payload.modalidade));
  ok('marcado como vindo de importação', proc.every(c=>c.corpo.payload.origem==='importacao'));
  ok('36 corretores', porTipo.corretor===36);
  ok('7 coordenadores', porTipo.coordenador===7);
  ok('4 modalidades', porTipo.modalidade===4);
  ok('5 agências', porTipo.agencia===5);
  const ligacoes = criados.filter(c=>c.url==='a1_partners' && c.m==='PATCH');
  ok('corretores ligados ao coordenador', ligacoes.length>0);

  const porEtapa={};
  proc.forEach(c=>{porEtapa[c.corpo.stage_name]=(porEtapa[c.corpo.stage_name]||0)+1;});
  console.log('\n  --- distribuição no pipeline ---');
  Object.entries(porEtapa).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${String(v).padStart(3)}  ${k}`));

  console.log(erros.length ? '\nERROS:\n' + erros.slice(0,8).join('\n') : '\nsem erros de JS');
  await b.close();
  process.exit(erros.length ? 1 : 0);   // a CI lê o código de saída
})();
