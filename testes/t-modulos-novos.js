// Módulos novos: Pré-análise e Comercial.
//
// A primeira e mais importante verificação é NEGATIVA: os módulos existem no
// catálogo do superadmin e não aparecem, não carregam e não mudam nada para
// nenhum cliente enquanto não forem liberados. Depois disso, o cadastro de
// coordenador com login.
const { abrir, checa, resumo } = require('./comum');
const { chromium } = require('playwright');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

(async () => {
  console.log('== NENHUM CLIENTE FOI AFETADO ==');
  {
    // O banco de mentira não devolve licença nenhuma para os módulos novos —
    // é exatamente a situação de todos os clientes de hoje.
    const { b, p, erros } = await abrir('repasse.html');
    const txt = await p.evaluate(() => document.body.innerText);
    checa('a palavra "Pré-análise" não aparece na tela do cliente', !/Pré-an[áa]lise/i.test(txt));
    checa('nem "Comercial" como módulo', !/\bM[óo]dulo Comercial\b/i.test(txt));
    checa('o pipeline continua carregando', (await p.locator('#kpi-total').textContent()).trim() !== '');
    checa('nenhuma chamada às tabelas novas', await p.evaluate(() =>
      !(window.__POSTS||[]).some(x => /a1_pre_analises|a1_comerciais|a1_pa_/.test(x.url))));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }
  {
    const { b, p, erros } = await abrir('configuracoes.html');
    checa('Configurações abre normalmente', await p.locator('#cfg-hub, .cfg-grupo').first().isVisible());
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== CATÁLOGO DO SUPERADMIN ==');
  {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport:{width:1500,height:1000} });
    const erros = [], gravado = [];
    p.on('pageerror', e => erros.push('JS: ' + e.message));
    await p.route(/fonts\./, r => r.fulfill({status:200,contentType:'text/css',body:''}));
    await p.route(/supabase\.co/, r => {
      const u = r.request().url(), m = r.request().method();
      const j = x => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
      if (u.includes('a1_tenant_modules')) {
        if (m !== 'GET') { gravado.push({m, body:r.request().postData()}); return j([{}]); }
        // o cliente só tem Repasse — como todos hoje
        return j([{ tenant_id:'t1', module_key:'repasse' }]);
      }
      if (u.includes('a1_tenants')) return j([{ id:'t1', name:'THE CRED', slug:'thecred',
        status:'active', plan:'pro', max_users:5, tipo_cliente:'correspondente_bancario',
        created_at:'2026-01-01' }]);
      return j([]);
    });
    await p.goto(BASE + '/superadmin.html', { waitUntil:'load' });
    await p.fill('#sa-url-input','https://x.supabase.co');
    await p.fill('#sa-key-input','chave');
    await p.click('button:has-text("Entrar como Superadmin")');
    await p.waitForTimeout(1100);
    await p.click('.sa-tab:has-text("Módulos")'); await p.waitForTimeout(500);
    await p.evaluate(() => { document.getElementById('mod-tenant').value = 't1';
                             loadTenantModulesFor(); });
    await p.waitForTimeout(700);

    const grade = await p.locator('#mod-grid-wrap').textContent();
    checa('Pré-análise está no catálogo', /Pré-análise/.test(grade), grade.slice(0,120));
    checa('Comercial está no catálogo', /\bComercial\b/.test(grade));

    // Filtra pela CHAVE, que é única no cartão. Filtrar pelo nome pegava dois:
    // o aviso de dependência do Comercial cita "Pré-análise".
    const cartao = chave => p.locator('.mod-card').filter({ has: p.locator(`.mod-key:text-is("${chave}")`) });
    checa('Pré-análise vem INATIVA', /Inativo/.test(await cartao('PRE_ANALISE').textContent()));
    checa('Comercial vem INATIVO', /Inativo/.test(await cartao('COMERCIAL').textContent()));
    checa('e oferecem o botão Liberar',
      (await cartao('PRE_ANALISE').locator('button:has-text("Liberar")').count()) === 1);
    checa('Repasse, que o cliente já tinha, segue ativo',
      /Ativo/.test(await cartao('repasse').textContent()));
    checa('avisa que o Comercial depende da Pré-análise para o fluxo automático',
      /precisa de/i.test(await cartao('COMERCIAL').textContent()),
      await cartao('COMERCIAL').textContent());
    checa('e a Pré-análise, que não depende de nada, não traz aviso',
      !/precisa de/i.test(await cartao('PRE_ANALISE').textContent()));
    checa('abrir o catálogo não liberou nada sozinho', gravado.length === 0, JSON.stringify(gravado));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  console.log('\n== COORDENADOR COM LOGIN ==');
  {
    const { b, p, erros } = await abrir('configuracoes.html');
    await p.evaluate(() => openCfgView('coordenadores')); await p.waitForTimeout(600);
    await p.evaluate(() => openCoordenador(null)); await p.waitForTimeout(500);

    checa('o cadastro pede CPF', (await p.locator('#coord-cpf').count()) === 1);
    checa('e senha', (await p.locator('#coord-senha').count()) === 1);
    checa('a senha é campo de senha, não texto puro',
      (await p.locator('#coord-senha').getAttribute('type')) === 'password');
    checa('explica que sem CPF e senha ele não entra',
      /só entra no sistema se tiver CPF e senha/i.test(await p.locator('#modal-coordenador-bg').textContent()));
    checa('vê a equipe vem marcado por padrão', await p.locator('#coord-ve-equipe').isChecked());

    await p.fill('#coord-nome', 'Marcelo Coordenador');
    await p.fill('#coord-cpf', '529.982.247-25');
    await p.fill('#coord-senha', '123');
    await p.evaluate(() => saveCoordenador()); await p.waitForTimeout(500);
    checa('senha curta é recusada', await p.evaluate(() =>
      (window.__POSTS||[]).filter(x => /a1_partners/.test(x.url) && x.m === 'POST').length === 0));

    await p.fill('#coord-senha', 'senhaboa123');
    await p.evaluate(() => saveCoordenador()); await p.waitForTimeout(800);
    const env = await p.evaluate(() => {
      const p2 = (window.__POSTS||[]).filter(x => /a1_partners/.test(x.url) && x.m === 'POST');
      return p2.length ? JSON.parse(p2[p2.length-1].body) : null;
    });
    checa('salva com o tipo coordenador', env && env.type === 'coordenador', JSON.stringify(env));
    checa('CPF vai só com dígitos', env && env.cpf === '52998224725', JSON.stringify(env && env.cpf));
    checa('a senha vai com hash, nunca em texto', env && /^[0-9a-f]{64}$/.test(env.password_hash || ''),
      JSON.stringify(env && env.password_hash));
    checa('a senha digitada não aparece no corpo enviado',
      env && !JSON.stringify(env).includes('senhaboa123'));
    checa('nasce podendo ver, não podendo editar',
      env && env.permissions.ver_repasses === true
         && env.permissions.editar_repasses === false
         && env.permissions.criar_repasses === false, JSON.stringify(env && env.permissions));
    checa('e enxergando a equipe', env && env.permissions.ver_todos_analistas === true);
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    await b.close();
  }

  const n = resumo([]); process.exit(n ? 1 : 0);
})();
