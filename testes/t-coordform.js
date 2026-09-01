const { abrir, checa, resumo } = require('./comum');
// cenário no fake: Marcos Lima(p7) = Ana Souza + Carla Dias | Rita Alves(p9) = Diego Melo | Sem Equipe = sem coordenador
(async () => {
  let f = 0;
  const { b, p, erros } = await abrir('repasse.html');

  console.log('== NOVO REPASSE ==');
  await p.evaluate(() => openNewCase()); await p.waitForTimeout(1000);
  checa('campo Coordenador existe', await p.locator('#n-coordenador').count() === 1);
  const kds = await p.locator('#n-coordenador option').allTextContents();
  checa('lista os coordenadores', kds.includes('Marcos Lima') && kds.includes('Rita Alves'), kds.join('|'));
  const todos = await p.locator('#n-broker option').allTextContents();
  checa('sem coordenador, mostra todos os corretores', todos.length >= 5, 'n='+todos.length);

  console.log('\n-- corretor primeiro: coordenador aparece sozinho --');
  await p.selectOption('#n-broker','Carla Dias'); await p.waitForTimeout(400);
  checa('escolher Carla preenche Marcos Lima', (await p.inputValue('#n-coordenador')) === 'Marcos Lima',
        'coord='+(await p.inputValue('#n-coordenador')));
  await p.selectOption('#n-broker','Diego Melo'); await p.waitForTimeout(400);
  checa('trocar para Diego muda para Rita Alves', (await p.inputValue('#n-coordenador')) === 'Rita Alves');
  await p.selectOption('#n-broker','Sem Equipe'); await p.waitForTimeout(400);
  checa('corretor sem coordenador limpa o campo', (await p.inputValue('#n-coordenador')) === '');
  checa('e avisa que falta o vínculo', await p.locator('#n-coord-obs').isVisible());
  checa('o aviso diz onde resolver', /Configurações/.test(await p.locator('#n-coord-obs').textContent()));

  console.log('\n-- coordenador primeiro: lista de corretores encolhe --');
  await p.selectOption('#n-coordenador','Marcos Lima'); await p.waitForTimeout(400);
  const equipe = (await p.locator('#n-broker option').allTextContents()).filter(x=>!/Selecione/.test(x));
  checa('mostra só a equipe do Marcos', equipe.length === 2 && equipe.includes('Ana Souza') && equipe.includes('Carla Dias'),
        equipe.join('|'));
  checa('quem não é da equipe some', !equipe.includes('Diego Melo') && !equipe.includes('Sem Equipe'));
  await p.selectOption('#n-broker','Ana Souza'); await p.waitForTimeout(300);
  checa('escolher da equipe mantém o coordenador', (await p.inputValue('#n-coordenador')) === 'Marcos Lima');
  checa('aviso some quando o vínculo existe', !(await p.locator('#n-coord-obs').isVisible()));

  await p.selectOption('#n-coordenador','Rita Alves'); await p.waitForTimeout(400);
  const eq2 = (await p.locator('#n-broker option').allTextContents()).filter(x=>!/Selecione/.test(x));
  checa('trocar coordenador troca a lista', eq2.length === 1 && eq2[0] === 'Diego Melo', eq2.join('|'));
  checa('corretor de outra equipe é limpo', (await p.inputValue('#n-broker')) === '');
  await p.selectOption('#n-coordenador',''); await p.waitForTimeout(400);
  const volta = (await p.locator('#n-broker option').allTextContents()).filter(x=>!/Selecione/.test(x));
  checa('limpar coordenador devolve todos', volta.length >= 5, 'n='+volta.length);

  console.log('\n-- o processo criado não guarda coordenador --');
  await p.fill('#n-name','Cliente Coord');
  await p.selectOption('#n-broker','Carla Dias'); await p.waitForTimeout(300);
  await p.selectOption('#n-development','d1'); await p.waitForTimeout(300);
  await p.evaluate(() => { const s=document.getElementById('n-stage'); if(s&&s.options.length>1) s.selectedIndex=1;
    ['n-partner','n-re'].forEach(i=>{const e=document.getElementById(i); if(e&&e.options.length>1) e.selectedIndex=1;}); });
  await p.evaluate(() => { window.__POSTS=[]; });
  await p.evaluate(() => createCase()); await p.waitForTimeout(900);
  const post = (await p.evaluate(()=>window.__POSTS||[])).find(x=>x.m==='POST' && /a1_cases/.test(x.url));
  const corpo = post ? JSON.parse(post.body) : null;
  checa('grava o corretor', corpo && corpo.broker_name === 'Carla Dias');
  checa('NÃO grava cópia do coordenador', corpo && !('coordenador' in (corpo.payload||{})),
        corpo ? JSON.stringify(corpo.payload) : '-');

  console.log('\n== GERENCIAR (modal do cartão) ==');
  await p.evaluate(() => switchTab('repasse', document.querySelector('.tab-btn'))); await p.waitForTimeout(700);
  await p.evaluate(() => openCard('c2')); await p.waitForTimeout(1200);   // c2 = Carla Dias
  checa('campo Coordenador existe', await p.locator('#e-coordenador').count() === 1);
  checa('vem preenchido pelo corretor do processo', (await p.inputValue('#e-coordenador')) === 'Marcos Lima',
        'coord='+(await p.inputValue('#e-coordenador')));
  const eqE = (await p.locator('#e-broker option').allTextContents()).filter(x=>!/Selecione/.test(x));
  checa('lista de corretores já vem da equipe', eqE.length === 2, eqE.join('|'));
  await p.selectOption('#e-coordenador','Rita Alves'); await p.waitForTimeout(400);
  checa('trocar coordenador refiltra aqui também',
    (await p.locator('#e-broker option').allTextContents()).filter(x=>!/Selecione/.test(x)).join('') === 'Diego Melo');
  await p.selectOption('#e-broker','Diego Melo'); await p.waitForTimeout(300);
  checa('e o coordenador acompanha', (await p.inputValue('#e-coordenador')) === 'Rita Alves');
  checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
  f += resumo(erros); await b.close(); process.exit(f?1:0);
})();
