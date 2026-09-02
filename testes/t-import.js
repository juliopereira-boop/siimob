const { chromium } = require('playwright');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);
// A planilha de exemplo vive no repositório, com as mesmas 11 colunas da base
// real e dados inventados. Antes isto apontava para o arquivo que o cliente
// enviou uma vez, guardado fora do projeto: quando aquela pasta sumiu, o teste
// passou a falhar por falta de arquivo — e na CI nunca teria funcionado.
// Gerada por testes/fixtures/gerar-planilha.py.
const path = require('path');
const ARQ = path.join(__dirname, 'fixtures', 'base-exemplo.xlsx');

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

  console.log('== 1. LER A PLANILHA ==');
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
  // As contagens vêm da planilha de exemplo do repositório (5 linhas), e não de
  // um arquivo de fora que pode desaparecer. Onde dá, a conferência é sobre o
  // CONTEÚDO, que não apodrece quando a planilha ganhar mais uma linha.
  let bad = 0;
  const ok=(n,c,x='')=>{ if(!c) bad++; console.log(`  ${c?'✓':'✗'} ${n}${c?'':'  '+x}`); };
  ok('5 processos, um por linha', proc.length===5, 'n='+proc.length);
  ok('todo processo tem etapa', proc.every(c=>c.corpo.stage_id && c.corpo.stage_name));
  ok('todo processo tem cliente', proc.every(c=>c.corpo.client_name));
  ok('CPF só com dígitos', proc.every(c=>/^\d*$/.test(c.corpo.client_cpf)));
  ok('CPF com 11 dígitos', proc.every(c=>c.corpo.client_cpf.length===11));
  ok('data no formato ISO ou vazia', proc.every(c=>!c.corpo.payload.data_venda || /^\d{4}-\d{2}-\d{2}$/.test(c.corpo.payload.data_venda)));
  const semData = proc.filter(c=>!c.corpo.payload.data_venda).length;
  ok('linha sem data da venda não trava a importação', semData===1, 'semData='+semData);
  const teresina = proc.filter(c=>c.corpo.payload.cidade==='Teresina');
  ok('Teresina veio com PI', teresina.length>0 && teresina.every(c=>c.corpo.payload.estado==='PI'));
  const timon = proc.filter(c=>c.corpo.payload.cidade==='Timon');
  ok('Timon veio com MA (nao PI)', timon.length>0 && timon.every(c=>c.corpo.payload.estado==='MA'));
  ok('analista ligado pelo nome completo',
     proc.some(c=>c.corpo.manager_name==='AMANDA DA SILVA RODRIGUES'),
     proc.map(c=>c.corpo.manager_name).join('|'));
  const semAnalista = proc.filter(c=>!c.corpo.manager_name);
  ok('analista que não existe no cadastro fica em branco, não inventa',
     semAnalista.length===1, 'semAnalista='+semAnalista.length);
  const comRegional = proc.filter(c=>c.corpo.payload.regional);
  ok('construtora conhecida vira regional', comRegional.length===4, 'n='+comRegional.length);
  const comAgencia = proc.filter(c=>c.corpo.payload.agencia);
  ok('agência com número e nome', comAgencia.length===4 && comAgencia.every(c=>/^\d+ - /.test(c.corpo.payload.agencia)),
     comAgencia.map(c=>c.corpo.payload.agencia).join('|'));
  ok('modalidade preenchida', proc.every(c=>c.corpo.payload.modalidade));
  ok('marcado como vindo de importação', proc.every(c=>c.corpo.payload.origem==='importacao'));
  ok('3 corretores, sem repetir', porTipo.corretor===3, 'n='+porTipo.corretor);
  ok('2 coordenadores', porTipo.coordenador===2, 'n='+porTipo.coordenador);
  ok('3 modalidades', porTipo.modalidade===3, 'n='+porTipo.modalidade);
  ok('2 agências', porTipo.agencia===2, 'n='+porTipo.agencia);
  const ligacoes = criados.filter(c=>c.url==='a1_partners' && c.m==='PATCH');
  ok('corretores ligados ao coordenador', ligacoes.length>0);
  const desconhecida = proc.find(c=>c.corpo.client_name==='CLIENTE EXEMPLO CINCO');
  ok('status que não existe cai na etapa inicial, e não fora do pipeline',
     !!desconhecida && !!desconhecida.corpo.stage_id, JSON.stringify(desconhecida && desconhecida.corpo.stage_name));

  const porEtapa={};
  proc.forEach(c=>{porEtapa[c.corpo.stage_name]=(porEtapa[c.corpo.stage_name]||0)+1;});
  console.log('\n  --- distribuição no pipeline ---');
  Object.entries(porEtapa).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${String(v).padStart(3)}  ${k}`));

  console.log(erros.length ? '\nERROS:\n' + erros.slice(0,8).join('\n') : '\nsem erros de JS');
  await b.close();
  process.exit(erros.length || bad ? 1 : 0);   // a CI lê o código de saída
})();
