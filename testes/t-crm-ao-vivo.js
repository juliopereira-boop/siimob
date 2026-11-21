// Leads › lead novo aparece na tela sem recarregar a página.
//
// O PEDIDO DO DONO
//   "assim que chegar o lead, eu não precise recarregar a página, tem que
//    surgir na minha tela"
//
// O lead da Meta entra pelo banco (busca automática a cada 2 minutos). A tela
// pergunta a cada 20 s, e ao voltar para a aba, pelos leads criados depois do
// último que conhece. Aqui: o cartão novo aparece no funil, na etapa certa,
// com aviso; quem já estava não duplica; arrastando, o redesenho espera; e o
// nome do lead é escapado (XSS).
const { abrir, checa, resumo } = require('./comum');

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';
const agora = () => new Date().toISOString();
const st = (id, name, position, extra = {}) => ({
  id,
  tenant_id: 't1',
  module_key: 'crm',
  group_key: 'vendas',
  name,
  color: '#0e8c7f',
  position,
  is_initial: false,
  is_final: false,
  selo: null,
  ...extra
});
const lead = (id, nome, extra = {}) => ({
  id,
  tenant_id: 't1',
  module_key: 'crm',
  stage_id: 'l1',
  stage_name: 'Lead Recebido',
  stage_entered_at: agora(),
  client_name: nome,
  created_at: agora(),
  payload: {},
  ...extra
});

(async () => {
  const est = {
    stages: [st('l1', 'Lead Recebido', 1, { is_initial: true }), st('l2', 'Contato', 2)],
    leads: [lead('lead-velho', 'Cliente Antigo', { created_at: '2026-11-20T10:00:00Z' })],
    novos: [],
    buscasAoVivo: []
  };
  const rotas = (url, metodo) => {
    if (url.includes('/rest/v1/a1_stages') && url.includes('module_key=eq.crm')) return est.stages;
    if (url.includes('/rest/v1/a1_cases') && url.includes('module_key=eq.crm') && metodo === 'GET') {
      if (url.includes('created_at=gte.')) {
        // a busca ao vivo (limit=50); os avisos do casco fazem outra consulta parecida
        if (url.includes('limit=50')) est.buscasAoVivo.push(url);
        return [...est.novos, ...est.leads];
      }
      return est.leads;
    }
    if (url.includes('/rest/v1/a1_cases') && metodo === 'PATCH') return [];
    return undefined;
  };
  const { b, p, erros } = await abrir('thecred/crm', { antes: rotas, modulos: ['crm'] });
  const cartoes = () => p.$$eval('#kanban .lead-card', l => l.map(c => c.dataset.id));
  const volta = async () => {
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForTimeout(500);
  };

  console.log('== Lead novo surge sem recarregar ==');
  checa(
    'o funil abre com o lead que já existia',
    (await cartoes()).join(',') === 'lead-velho',
    (await cartoes()).join(',')
  );
  await volta();
  checa('sem lead novo, nada muda', (await cartoes()).join(',') === 'lead-velho');
  checa(
    'a busca ao vivo pede só os recentes (created_at)',
    est.buscasAoVivo.length >= 1,
    String(est.buscasAoVivo.length)
  );
  checa(
    'e pede as mesmas colunas da carga (sem os anexos em base64)',
    est.buscasAoVivo.every(u => u.includes('select=id,tenant_id') && !u.includes('attachment')),
    est.buscasAoVivo[0]
  );

  est.novos = [lead('lead-meta', 'Maria da Meta ' + XSS, { partner_name: 'Meta · Campanha Nov' })];
  await volta();
  const depois = await cartoes();
  checa('o lead da Meta aparece no funil, sem recarregar', depois.includes('lead-meta'), depois.join(','));
  checa(
    'na coluna da etapa dele',
    !!(await p.$('#kanban .k-col-body[data-stage="l1"] .lead-card[data-id="lead-meta"]'))
  );
  checa('pisca para chamar atenção', !!(await p.$('.lead-card.lead-novo[data-id="lead-meta"]')));
  const aviso = await p.evaluate(() => document.getElementById('toast-wrap').textContent);
  checa(
    'e um aviso diz quem chegou',
    /Novo lead: Maria da Meta/.test(aviso) && /Meta · Campanha Nov/.test(aviso),
    aviso
  );
  checa('o contador de leads sobe', /2 leads/.test(await p.textContent('#lead-count')));

  await volta();
  checa(
    'perguntar de novo não duplica o cartão',
    (await cartoes()).filter(x => x === 'lead-meta').length === 1
  );

  console.log('\n== Arrastando, o redesenho espera ==');
  est.novos = [lead('lead-2', 'Pedro'), ...est.novos];
  // simula um arraste em andamento: dragstart sem dragend
  await p.evaluate(() => {
    const c = document.querySelector('.lead-card[data-id="lead-velho"]');
    const dt = new DataTransfer();
    c.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  });
  await volta();
  checa('durante o arraste o cartão novo ainda não entra', !(await cartoes()).includes('lead-2'));
  await p.evaluate(() => {
    const c = document.querySelector('.lead-card[data-id="lead-velho"]');
    c.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
  });
  await p.waitForTimeout(300);
  checa('ao soltar, ele aparece', (await cartoes()).includes('lead-2'));

  checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
  await b.close();
  process.exit(resumo(erros) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
