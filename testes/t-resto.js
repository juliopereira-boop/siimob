const { abrir, checa, resumo } = require('./comum');
(async () => {
  let f = 0;
  { const { b, p, erros } = await abrir('login.html');
    console.log('== LOGIN ==');
    const paineis = await p.locator('.panel, [class*=panel]').count();
    checa('página monta', (await p.locator('input').count()) >= 2, `inputs=${await p.locator('input').count()}`);
    checa('tem campo de senha', (await p.locator('input[type=password]').count()) >= 1);
    f += resumo(erros); await b.close(); }

  // Leads pede licença agora, como todo módulo: sem `{modulos:['crm']}` a tela
  // devolve a pessoa, que é o comportamento certo — e era o que faltava no
  // banco, onde a1_cases não olhava módulo nenhum para as linhas de lead.
  { const { b, p, erros } = await abrir('crm.html', { modulos:['crm'] });
    console.log('\n== CRM ==');
    checa('página monta', (await p.locator('body').textContent()).length > 200);
    checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
    f += resumo(erros); await b.close(); }

  { const { b, p, erros } = await abrir('registro.html');
    console.log('\n== REGISTRO ==');
    checa('página monta', (await p.locator('body').textContent()).length > 200);
    checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
    f += resumo(erros); await b.close(); }

  { const { b, p, erros } = await abrir('registro-listagem.html');
    console.log('\n== REGISTRO-LISTAGEM ==');
    checa('página monta', (await p.locator('body').textContent()).length > 200);
    checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
    f += resumo(erros); await b.close(); }

  { const { b, p, erros } = await abrir('superadmin.html');
    console.log('\n== SUPERADMIN ==');
    checa('pede a chave antes de mostrar dado', (await p.locator('#sa-key-input').count()) === 1);
    const vazou = await p.evaluate(() => (localStorage.getItem('sa_key')||'') + (localStorage.getItem('SA_KEY')||''));
    checa('chave de serviço não fica guardada no navegador', vazou === '');
    checa('nenhum XSS', (await p.evaluate(()=>window.__XSS||0)) === 0);
    f += resumo(erros); await b.close(); }

  process.exit(f ? 1 : 0);
})();
