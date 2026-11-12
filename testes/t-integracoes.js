// Configurações › Integrações (Meta Lead Ads).
//
// O PEDIDO DO DONO
//   "quando entro em integrações nas configurações, fica carregando, não deve
//    ficar carregando, tem que aparecer conectado, e aí abrindo a configuração
//    tem lá as configurações, das páginas, formulários..."
//
// O que precisa valer:
//   - conectado aparece como "Conectado", com o botão Configurar;
//   - da segunda vez em diante o estado aparece NA HORA, mesmo com a função
//     demorando, e o cartão "Integrações" do início já mostra o selo;
//   - função que não responde não deixa girando: aparece "Tentar novamente";
//   - Configurar abre com as páginas carregadas e, para cada página escolhida,
//     os formulários dela; salvar manda exatamente o que foi marcado.
const { abrir, checa, resumo } = require('./comum');

const PAGINAS = [
  { id: '111', name: 'Vella Imóveis', selected: true },
  { id: '222', name: 'Outra página', selected: false }
];
const FORMS = [
  { id: '901', name: 'Lançamento Jardins', status: 'ACTIVE', selected: true },
  { id: '902', name: 'Campanha antiga', status: 'ARCHIVED', selected: false }
];

function meta(estado) {
  return (url, metodo, corpo) => {
    if (!/functions\/v1\/meta-connect/.test(url) || metodo !== 'POST') return undefined;
    const d = JSON.parse(corpo || '{}');
    estado.chamadas.push(d);
    if (d.action === 'status')
      return estado.conectado
        ? {
            connected: true,
            connected_at: '2026-11-12T04:34:21Z',
            token_expires_at: '2099-01-01T00:00:00Z',
            data_access_expires_at: '2099-01-01T00:00:00Z'
          }
        : { connected: false };
    if (d.action === 'pages') return { pages: PAGINAS, unavailable: 0 };
    if (d.action === 'forms') return { forms: d.page_id === '111' ? FORMS : [], unavailable: 0 };
    if (d.action === 'save_pages' || d.action === 'save_forms') return { ok: true };
    return { error: 'invalid_request' };
  };
}

const visivel = (p, sel) =>
  p.evaluate(s => {
    const el = document.querySelector(s);
    return !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  }, sel);
const texto = (p, sel) => p.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);

(async () => {
  const todos = [];

  // ── 1. Conectado ──────────────────────────────────────────────────────────
  console.log('\nConectado');
  {
    const estado = { conectado: true, chamadas: [] };
    const { b, p, erros } = await abrir('thecred/configuracoes#integracoes', { antes: meta(estado) });
    await p.waitForTimeout(600);
    checa('a tela de integrações abre', await visivel(p, '#meta-card'));
    checa(
      'mostra "Conectado"',
      /Conectado/.test(await texto(p, '#meta-status')),
      await texto(p, '#meta-status')
    );
    checa('com o botão Configurar', await visivel(p, '#meta-config-open'));
    checa('e sem botão de conectar', !(await visivel(p, '#meta-connect-btn')));
    checa('não fica "Verificando"', !/Verificando/.test(await texto(p, '#meta-card')));

    // ── 2. Configurar: páginas e formulários já carregados ──────────────────
    console.log('\nConfiguração');
    await p.click('#meta-config-open');
    await p.waitForTimeout(500);
    checa(
      'a configuração abre no lugar do cartão',
      (await visivel(p, '#meta-config')) && !(await visivel(p, '#meta-card'))
    );
    const pags = await p.$$eval('#meta-pages-list input', l => l.map(i => `${i.value}:${i.checked}`));
    checa(
      'as páginas da conta aparecem, com a da empresa marcada',
      pags.join(',') === '111:true,222:false',
      pags.join(',')
    );
    checa(
      'os formulários da página escolhida já aparecem',
      (await p.$$('.mi-pagina[data-pagina="111"] input')).length === 2 &&
        !(await p.$('.mi-pagina[data-pagina="222"]'))
    );
    checa(
      'com a situação de cada formulário',
      /Ativo/.test(await texto(p, '.mi-pagina')) && /Arquivado/.test(await texto(p, '.mi-pagina'))
    );
    checa('e o resumo do que está marcado', /1 de 2/.test(await texto(p, '.mi-pagina-msg')));

    await p.click('.mi-pagina[data-pagina="111"] .mi-item:nth-child(2)');
    await p.click('.mi-pagina[data-pagina="111"] [data-acao="metaSalvarFormularios"]');
    await p.waitForTimeout(400);
    const sf = estado.chamadas.filter(c => c.action === 'save_forms').pop() || {};
    checa(
      'salvar formulários manda a página e os marcados',
      sf.page_id === '111' && (sf.form_ids || []).join(',') === '901,902',
      JSON.stringify(sf)
    );
    checa('e confirma', /Salvo: 2/.test(await texto(p, '.mi-pagina-msg')));

    await p.click('#meta-pages-list .mi-item:nth-child(2)');
    await p.click('#meta-pages-save');
    await p.waitForTimeout(500);
    const sp = estado.chamadas.filter(c => c.action === 'save_pages').pop() || {};
    checa(
      'salvar páginas manda as marcadas',
      (sp.page_ids || []).join(',') === '111,222',
      JSON.stringify(sp)
    );
    checa('e recarrega os formulários das duas páginas', (await p.$$('.mi-pagina')).length === 2);

    await p.click('[data-acao="metaFecharConfig"]');
    checa('voltar mostra o cartão de novo', await visivel(p, '#meta-card'));

    // ── 3. Segunda visita: na hora, mesmo com a função lenta ────────────────
    console.log('\nSegunda visita');
    await p.click('[data-acao="closeCfgView"]');
    await p.waitForTimeout(200);
    checa(
      'o cartão Integrações do início mostra "Meta conectada"',
      /Meta conectada/.test(await texto(p, '#cfg-int-selo'))
    );
    await p.route(/functions\/v1\/meta-connect/, async r => {
      await new Promise(ok => setTimeout(ok, 4000));
      await r.fallback();
    });
    await p.click('[data-acao="openCfgView"][data-view="integracoes"]');
    await p.waitForTimeout(150);
    checa(
      'com a função demorando, "Conectado" aparece na hora',
      /Conectado/.test(await texto(p, '#meta-status'))
    );
    checa('e o Configurar já está disponível', await visivel(p, '#meta-config-open'));
    todos.push(...erros);
    await b.close();
  }

  // ── 4. Função fora do ar ──────────────────────────────────────────────────
  console.log('\nFunção fora do ar');
  {
    const estado = { conectado: true, chamadas: [] };
    const { b, p, erros } = await abrir('thecred/configuracoes', { antes: meta(estado) });
    await p.route(/functions\/v1\/meta-connect/, r => r.abort());
    await p.click('[data-acao="openCfgView"][data-view="integracoes"]');
    await p.waitForTimeout(600);
    checa('sem resposta, não fica girando', !/Verificando/.test(await texto(p, '#meta-status')));
    checa(
      'mostra o aviso e "Tentar novamente"',
      (await visivel(p, '#meta-aviso')) && (await visivel(p, '#meta-retry'))
    );
    await p.unroute(/functions\/v1\/meta-connect/);
    await p.click('#meta-retry');
    await p.waitForTimeout(500);
    checa(
      'tentar de novo resolve',
      /Conectado/.test(await texto(p, '#meta-status')) && !(await visivel(p, '#meta-retry'))
    );
    todos.push(...erros.filter(e => !/meta-connect|ERR_FAILED|Failed to load/.test(e)));
    await b.close();
  }

  // ── 5. Não conectado ──────────────────────────────────────────────────────
  console.log('\nNão conectado');
  {
    const estado = { conectado: false, chamadas: [] };
    const { b, p, erros } = await abrir('thecred/configuracoes#integracoes', { antes: meta(estado) });
    await p.waitForTimeout(600);
    checa('mostra "Não conectado"', /Não conectado/.test(await texto(p, '#meta-status')));
    checa(
      'com o botão de conectar e sem Configurar',
      (await visivel(p, '#meta-connect-btn')) && !(await visivel(p, '#meta-config-open'))
    );
    todos.push(...erros);
    await b.close();
  }

  process.exit(resumo(todos) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
