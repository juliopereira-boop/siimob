// A reserva que nasce da pré-análise aprovada, e o cadastro da pré-análise do
// perfil construtora (com a Disposição).
//
// O PEDIDO DO DONO, EM RESUMO
//   - "Iniciar venda" da pré-análise aprovada abre o mapa de disposição na
//     unidade escolhida, já no formulário da reserva, com o cadastro e o fluxo.
//   - Uma regra em Configurações: reserva direto pelo mapa, ou só a partir da
//     pré-análise aprovada.
//   - A reserva tem de levar a venda para a esteira de Vendas.
//   - No cadastro da pré-análise: bloco e unidade escolhidos, não digitados; o
//     valor de avaliação vem do mapa de preço; casado abre o cônjuge,
//     obrigatório; senão, segundo associado opcional; regras da pré-análise.
//
// O banco confere tudo de novo (testes/sql/prova-reserva-pa.sql). Aqui se prova
// que a tela pede a coisa certa, mostra o que o banco devolve e não regride
// para quem não tem a Disposição.
const { abrir, checa, resumo } = require('./comum');
const { DISP } = require('./fake');

const MODS = ['DISPOSICAO', 'COMERCIAL', 'PRE_ANALISE'];
const posts = (p, re) =>
  p.evaluate(
    r =>
      window.__POSTS
        .filter(x => new RegExp(r).test(x.url))
        .map(x => ({ m: x.m, url: x.url, body: JSON.parse(x.body || 'null') })),
    re.source
  );
const texto = (p, sel) => p.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
const valor = (p, sel) => p.evaluate(s => (document.querySelector(s) || {}).value ?? null, sel);
const toastTxt = p =>
  p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));

(async () => {
  let todos = [];

  // ── 1. O mapa aberto pela pré-análise aprovada ─────────────────────────────
  console.log('\nO mapa aberto pela pré-análise aprovada');
  {
    const { b, p, erros } = await abrir('thecred/disposicao?pa=pa-ok', { modulos: MODS });
    await p.waitForTimeout(500);
    const faixa = await texto(p, '#dp-pa-faixa');
    checa(
      'a faixa diz de qual pré-análise é a reserva',
      /PA-0042/.test(faixa) && /Joana Prado/.test(faixa),
      faixa
    );
    checa(
      'a reserva já abre no formulário, na unidade de interesse',
      /B1-101/.test((await texto(p, '#dp-rs-titulo')) + (await texto(p, '#dp-rs-sub')))
    );
    checa('o titular vem preenchido', /Joana Prado/.test((await valor(p, '#t-nome')) || ''));
    checa('o cônjuge vem preenchido pelo parentesco', (await valor(p, '#c-nome')) === 'Pedro Prado');
    await p.click('[data-acao="rsPasso"][data-passo="2"]');
    await p.waitForTimeout(300);
    const fluxo = await texto(p, '#dp-rs-corpo');
    checa(
      'o fluxo já traz o financiamento aprovado',
      /Soma do fluxo\s*R\$\s*150\.000,00/.test(fluxo),
      fluxo.slice(0, 200)
    );
    checa(
      'o FGTS sem parâmetro no cliente não some calado: o passo avisa',
      /FGTS de R\$\s*20\.000,00/.test(fluxo) && /Parâmetros de pagamento/.test(fluxo)
    );
    // O Ato fecha a diferença: 205.000 da unidade menos 150.000 financiados.
    await p.fill('#fx-0-val', '55.000,00');
    await p.press('#fx-0-val', 'Tab');
    await p.fill('#fx-0-venc', '2026-12-10');
    await p.press('#fx-0-venc', 'Tab');
    await p.waitForTimeout(250);
    checa(
      'com o Ato, o fluxo fecha',
      /Fechado/.test(await texto(p, '.dp-fluxo-topo')),
      await texto(p, '.dp-fluxo-topo')
    );
    await p.click('[data-acao="rsPasso"][data-passo="3"]').catch(() => {});
    await p.waitForTimeout(300);
    const errFluxo = await p.$eval('#dp-rs-erro', e => (e.hidden ? '' : e.textContent));
    if (errFluxo) console.log('    (o passo do fluxo recusou: ' + errFluxo + ')');
    const ok = await p.$('#rs-ok');
    if (ok) {
      await ok.click();
      await p.waitForTimeout(500);
    }
    const [res] = await posts(p, /rpc\/a1_unidade_reservar/);
    checa(
      'a reserva vai com a pré-análise e a unidade dela',
      !!res && res.body.p_pre_analise === 'pa-ok' && res.body.p_unidade === 'un-11',
      res ? JSON.stringify(res.body).slice(0, 200) : 'sem chamada (o fluxo não fechou?)'
    );
    checa(
      'o CPF vai só com dígitos',
      !!res && /^\d{11}$/.test(String(res.body.p_cliente.titular.cpf || '')),
      res ? res.body.p_cliente.titular.cpf : ''
    );
    checa(
      'a tela de sucesso diz que a venda está na esteira',
      /esteira de Vendas/.test(await texto(p, '#dp-rs-corpo'))
    );
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS)) === 0);
    await b.close();
    todos = todos.concat(erros);
  }

  // ── 2. Pré-análise que ainda não pode virar reserva ────────────────────────
  console.log('\nPré-análise ainda não aprovada');
  {
    const { b, p, erros } = await abrir('thecred/disposicao?pa=pa-reprovada', { modulos: MODS });
    await p.waitForTimeout(500);
    checa(
      'a faixa vira alerta com o motivo',
      await p.$eval('#dp-pa-faixa', e => e.classList.contains('alerta'))
    );
    checa('e a reserva não abre sozinha', !(await p.$('#t-nome')));
    await b.close();
    todos = todos.concat(erros);
  }

  // ── 3. Conta em que a reserva só começa pela pré-análise ───────────────────
  console.log('\nOrigem da reserva: só pela pré-análise');
  {
    const antes = DISP.config[0].origem_reserva;
    DISP.config[0].origem_reserva = 'PRE_ANALISE';
    const { b, p, erros } = await abrir('thecred/disposicao', { modulos: MODS });
    await p.waitForTimeout(500);
    await p.click('.un[data-id="un-21"]');
    await p.waitForTimeout(250);
    await p.click('[data-acao="iniciarReserva"]');
    await p.waitForTimeout(400);
    checa('o primeiro passo pede a pré-análise aprovada', !!(await p.$('#rs-pa')));
    await p.fill('#t-nome', 'Sem PA');
    await p.fill('#t-cpf', '529.982.247-25');
    await p.click('[data-acao="rsPasso"][data-passo="2"]');
    await p.waitForTimeout(250);
    checa(
      'sem escolher a pré-análise, não avança',
      /pré-análise aprovada/.test(await texto(p, '#dp-rs-erro')),
      await texto(p, '#dp-rs-erro')
    );
    await p.selectOption('#rs-pa', 'pa-ok');
    await p.waitForTimeout(400);
    checa(
      'escolhida a pré-análise, o cliente vem dela',
      /Joana Prado/.test((await valor(p, '#t-nome')) || '')
    );
    await b.close();
    todos = todos.concat(erros);
    DISP.config[0].origem_reserva = antes;
  }

  // ── 4. A reserva que ficou sem venda ───────────────────────────────────────
  console.log('\nA reserva sem venda ganha a venda');
  {
    const { b, p, erros } = await abrir('thecred/disposicao', { modulos: MODS });
    await p.waitForTimeout(500);
    await p.click('.un[data-id="un-12"]');
    await p.waitForTimeout(300);
    checa(
      'a ficha avisa que a reserva ainda não tem venda',
      /ainda não tem venda/.test(await texto(p, '#dp-gaveta'))
    );
    await p.click('[data-acao="abrirVendaDaReserva"]');
    await p.waitForTimeout(400);
    const [r] = await posts(p, /rpc\/a1_reserva_abrir_venda/);
    checa('o botão chama a1_reserva_abrir_venda com a reserva', !!r && r.body.p_reserva === 'rs1');
    await b.close();
    todos = todos.concat(erros);
  }
  {
    const { b, p, erros } = await abrir('thecred/disposicao', { modulos: ['DISPOSICAO'] });
    await p.waitForTimeout(500);
    await p.click('.un[data-id="un-12"]');
    await p.waitForTimeout(300);
    checa('sem a licença da Venda, o botão não existe', !(await p.$('[data-acao="abrirVendaDaReserva"]')));
    await b.close();
    todos = todos.concat(erros);
  }

  // ── 5. Configurações: origem, avaliação e regras da pré-análise ────────────
  console.log('\nConfigurações');
  {
    const { b, p, erros } = await abrir('thecred/configuracoes', { modulos: MODS });
    await p.waitForTimeout(700);
    await p.click('#cfg-card-disp-regras');
    await p.waitForTimeout(500);
    await p.check('input[name="dcg-origem"][value="PRE_ANALISE"]');
    await p.click('[data-acao="dcSalvarRegras"]');
    await p.waitForTimeout(400);
    const cfg = (await posts(p, /a1_disposicao_config/)).pop();
    checa(
      'a regra da origem é gravada',
      !!cfg && cfg.body.origem_reserva === 'PRE_ANALISE',
      cfg ? JSON.stringify(cfg.body) : ''
    );
    await p.click('[data-acao="closeCfgView"] >> visible=true');
    await p.click('#cfg-card-disp-precos');
    await p.waitForTimeout(500);
    checa('o mapa de preço tem a coluna de avaliação', /Avaliação/.test(await texto(p, '#dc-precos thead')));
    await p.fill('.dc-aval[data-id="un-21"]', '230.000,00');
    await p.click('[data-acao="dcSalvarPrecos"]');
    await p.waitForTimeout(400);
    const itens = (await posts(p, /a1_mapa_preco_itens/)).pop();
    const linha =
      itens && (Array.isArray(itens.body) ? itens.body : [itens.body]).find(x => x.unidade_id === 'un-21');
    checa(
      'a avaliação vai junto com o preço',
      !!linha && Number(linha.valor_avaliacao) === 230000,
      linha ? JSON.stringify(linha) : ''
    );
    checa(
      'e toda linha do lote leva a mesma chave (o PostgREST exige)',
      !!itens && (Array.isArray(itens.body) ? itens.body : [itens.body]).every(x => 'valor_avaliacao' in x)
    );
    await p.click('[data-acao="closeCfgView"] >> visible=true');
    checa('o cartão das regras da pré-análise existe com a licença', !!(await p.$('#cfg-card-regras-pa')));
    await p.click('#cfg-card-regras-pa');
    await p.waitForTimeout(500);
    await p.check('#rp-exige_conjuge');
    await p.click('[data-acao="regrasPaSalvar"]');
    await p.waitForTimeout(400);
    const rg = (await posts(p, /rest\/v1\/a1_pa_regras\?/)).pop();
    checa(
      'as regras da pré-análise são gravadas por cliente',
      !!rg &&
        /on_conflict=tenant_id/.test(rg.url) &&
        rg.body.exige_conjuge === true &&
        rg.body.tenant_id === 't1',
      rg ? rg.url + ' ' + JSON.stringify(rg.body) : ''
    );
    await b.close();
    todos = todos.concat(erros);
  }
  {
    const { b, p, erros } = await abrir('thecred/configuracoes', { modulos: ['COMERCIAL'] });
    await p.waitForTimeout(600);
    checa('sem a Pré-análise, o cartão das regras não existe', !(await p.$('#cfg-card-regras-pa')));
    await b.close();
    todos = todos.concat(erros);
  }

  // ── 6. O cadastro da pré-análise com a Disposição ──────────────────────────
  console.log('\nO cadastro da pré-análise com a Disposição');
  {
    const { b, p, erros } = await abrir('thecred/pre-analise', {
      modulos: MODS,
      regrasPA: { exige_conjuge: true, exige_unidade: true }
    });
    await p.waitForTimeout(500);
    await p.click('#btn-nova');
    await p.waitForTimeout(250);
    checa(
      'antes do empreendimento, a unidade fica travada',
      await p.$eval('#nova-body select[disabled]', () => true).catch(() => false)
    );
    await p.selectOption('#w-empr', 'd1');
    await p.waitForTimeout(500);
    checa(
      'a unidade é escolhida na lista, não digitada',
      !!(await p.$('#w-unidade-id')) && !(await p.$('#w-unidade'))
    );
    const op = await p.$$eval('#w-unidade-id option', os =>
      os.map(o => ({ v: o.value, d: o.disabled, t: o.textContent }))
    );
    checa(
      'vendida e reservada aparecem travadas',
      op.find(o => o.v === 'un-01').d && op.find(o => o.v === 'un-12').d && !op.find(o => o.v === 'un-22').d
    );
    checa(
      'cada opção diz o código da unidade',
      /^B1-202/.test(op.find(o => o.v === 'un-22').t),
      op.find(o => o.v === 'un-22').t
    );
    await p.click('#nova-avancar');
    await p.waitForTimeout(200);
    checa('a regra da unidade barra o avanço', /unidade de interesse/.test(await toastTxt(p)));
    await p.selectOption('#w-unidade-id', 'un-22');
    await p.waitForTimeout(250);
    checa(
      'o valor de avaliação vem do mapa de preço da unidade',
      (await valor(p, '#w-aval')) === '225.000,00'
    );
    await p.click('#nova-avancar');
    await p.waitForTimeout(250);
    await p.fill('#w-doc', '529.982.247-25');
    await p.fill('#w-nome', 'Maria Teste');
    await p.selectOption('#w-ec', 'Casado(a)');
    await p.waitForTimeout(250);
    checa('casado abre os dados do cônjuge logo abaixo', !!(await p.$('#w-cj-nome')));
    await p.click('#nova-avancar');
    await p.waitForTimeout(250);
    checa('com a regra, o cônjuge é obrigatório', /nome do cônjuge/.test(await toastTxt(p)));
    await p.fill('#w-cj-nome', 'João Teste');
    await p.fill('#w-cj-doc', '529.982.247-25');
    await p.click('#nova-avancar');
    await p.waitForTimeout(250);
    checa('o CPF do cônjuge não pode ser o do titular', /mesmo do titular/.test(await toastTxt(p)));
    await p.fill('#w-cj-doc', '111.444.777-35');
    await p.fill('#w-cj-renda', '3.500,00');
    await p.click('#nova-avancar');
    await p.waitForTimeout(250);
    checa('com o cônjuge certo, segue para a renda', (await p.$('#passo-3.on')) !== null);
    await p.click('#nova-avancar');
    await p.waitForTimeout(800);
    const [pa] = await posts(p, /rest\/v1\/a1_pre_analises$/);
    checa(
      'a pré-análise vai com a ficha da unidade',
      !!pa && pa.body.unidade_id === 'un-22' && pa.body.unidade === 'B1-202',
      pa ? JSON.stringify(pa.body) : 'sem POST'
    );
    checa('e com a avaliação em centavos', !!pa && pa.body.valor_avaliacao_inicial === 22500000);
    const part = (await posts(p, /rest\/v1\/a1_pa_participantes/)).pop();
    const linhas = part ? (Array.isArray(part.body) ? part.body : [part.body]) : [];
    const cj = linhas.find(x => x.papel === 'ASSOCIADO');
    checa(
      'o cônjuge entra como associado com o parentesco',
      !!cj && /Cônjuge/.test(cj.parentesco || ''),
      JSON.stringify(linhas)
    );
    checa('com a renda dele', !!cj && cj.renda_declarada === 350000);
    checa(
      'e todas as linhas levam a chave do parentesco',
      linhas.length > 1 && linhas.every(x => 'parentesco' in x)
    );
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS)) === 0);
    await b.close();
    todos = todos.concat(erros);
  }
  {
    const { b, p, erros } = await abrir('thecred/pre-analise', { modulos: MODS });
    await p.waitForTimeout(500);
    await p.click('#btn-nova');
    await p.waitForTimeout(250);
    await p.selectOption('#w-empr', 'd1');
    await p.waitForTimeout(400);
    await p.click('#nova-avancar');
    await p.waitForTimeout(250);
    await p.selectOption('#w-ec', 'Solteiro(a)');
    await p.waitForTimeout(200);
    checa(
      'solteiro: o segundo associado é opcional, atrás de um botão',
      !!(await p.$('[data-acao="addSegundoAssociado"]'))
    );
    await p.click('[data-acao="addSegundoAssociado"]');
    await p.waitForTimeout(200);
    checa('o segundo associado tem parentesco', !!(await p.$('#w-sg-par')));
    await p.click('[data-acao="remSegundoAssociado"]');
    await p.waitForTimeout(200);
    checa('e pode ser removido', !(await p.$('#w-sg-nome')));
    await b.close();
    todos = todos.concat(erros);
  }

  // ── 7. Sem a Disposição, a tela de sempre ──────────────────────────────────
  console.log('\nSem a Disposição, o cadastro não muda');
  {
    const { b, p, erros } = await abrir('thecred/pre-analise', { modulos: ['PRE_ANALISE', 'COMERCIAL'] });
    await p.waitForTimeout(500);
    await p.click('#btn-nova');
    await p.waitForTimeout(250);
    await p.selectOption('#w-empr', 'd1');
    await p.waitForTimeout(300);
    checa('a unidade continua sendo texto', !!(await p.$('#w-unidade')) && !(await p.$('#w-unidade-id')));
    checa(
      'e ninguém pede as fichas da Disposição',
      (await p.evaluate(
        () => window.__POSTS.filter(x => /a1_pa_unidades_para_cadastro/.test(x.url)).length
      )) === 0
    );
    await p.click('#nova-avancar');
    await p.waitForTimeout(250);
    await p.selectOption('#w-ec', 'Casado(a)');
    await p.waitForTimeout(200);
    checa('casado sem a regra não abre bloco novo', !(await p.$('#w-cj-nome')));
    await b.close();
    todos = todos.concat(erros);
  }

  // ── 8. O botão da pré-análise aprovada ─────────────────────────────────────
  console.log('\nO botão da pré-análise aprovada');
  {
    const { b, p, erros } = await abrir('thecred/pre-analise', { modulos: MODS });
    await p.waitForTimeout(500);
    await p.click('[data-acao="abrirDossie"][data-id="pa4"]');
    await p.waitForTimeout(600);
    checa(
      'com a Disposição, o botão é "Reservar unidade"',
      !!(await p.$('#btn-reservar-unidade')) && !(await p.$('#btn-iniciar-venda'))
    );
    checa(
      'e pergunta ao banco se a pré-análise pode reservar',
      await p.evaluate(() => window.__POSTS.some(x => /a1_pa_pronta_para_reserva/.test(x.url)))
    );
    await p.click('#btn-reservar-unidade');
    await p.waitForTimeout(700);
    checa(
      'ele abre o mapa da Disposição com a pré-análise',
      /\/thecred\/disposicao\?pa=pa4$/.test(p.url()),
      p.url()
    );
    await b.close();
    todos = todos.concat(erros);
  }
  {
    const { b, p, erros } = await abrir('thecred/pre-analise', { modulos: ['PRE_ANALISE', 'COMERCIAL'] });
    await p.waitForTimeout(500);
    await p.click('[data-acao="abrirDossie"][data-id="pa4"]');
    await p.waitForTimeout(600);
    checa(
      'sem a Disposição, continua "Iniciar venda"',
      !!(await p.$('#btn-iniciar-venda')) && !(await p.$('#btn-reservar-unidade'))
    );
    await b.close();
    todos = todos.concat(erros);
  }

  process.exit(resumo(todos) ? 1 : 0);
})();
