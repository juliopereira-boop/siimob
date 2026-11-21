// Leads › cada lead mostra o ícone de onde veio.
//
// O PEDIDO DO DONO
//   "Cada lead que chega precisa ter o ícone de onde veio, exemplo: instagram,
//    whatsapp, facebook."
//
// O que este arquivo prova: no funil e na lista, o lead da Meta preenchido no
// Instagram mostra Instagram; no Facebook, Facebook; o do WhatsApp, WhatsApp;
// o cadastrado à mão com a origem "Instagram" também; o resto, "Cadastro
// manual". E o nome do lead continua escapado (XSS).
const { abrir, checa, resumo } = require('./comum');

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';
const agora = new Date().toISOString();
const lead = (id, nome, extra = {}) => ({
  id,
  tenant_id: 't1',
  module_key: 'crm',
  stage_id: 'l1',
  stage_name: 'Lead Recebido',
  stage_entered_at: agora,
  client_name: nome,
  created_at: agora,
  payload: {},
  ...extra
});
const meta = pl => ({ integracao: { origem: 'meta', dados: { plataforma: pl } } });

(async () => {
  const leads = [
    lead('ig', 'Ana do Insta ' + XSS, { payload: meta('ig') }),
    lead('fb', 'Beto do Face', { payload: meta('fb') }),
    lead('mt', 'Caio Meta', { payload: meta(null) }),
    lead('wa', 'Duda Zap', { payload: { integracao: { origem: 'whatsapp' } } }),
    lead('mi', 'Eva Manual Insta', { partner_name: 'Instagram orgânico' }),
    lead('ind', 'Fabio Indicado', { partner_name: 'Indicação' }),
    lead('man', 'Gil Sem Origem')
  ];
  const { b, p, erros } = await abrir('thecred/crm', {
    modulos: ['crm'],
    antes: (url, metodo) => {
      if (url.includes('/rest/v1/a1_stages') && url.includes('module_key=eq.crm'))
        return [
          {
            id: 'l1',
            tenant_id: 't1',
            module_key: 'crm',
            group_key: 'vendas',
            name: 'Lead Recebido',
            color: '#0e8c7f',
            position: 1,
            is_initial: true,
            is_final: false,
            selo: null
          }
        ];
      if (url.includes('/rest/v1/a1_cases') && url.includes('module_key=eq.crm') && metodo === 'GET')
        return leads;
      return undefined;
    }
  });

  const esperado = {
    ig: 'instagram',
    fb: 'facebook',
    mt: 'meta',
    wa: 'whatsapp',
    mi: 'instagram',
    ind: 'indicacao',
    man: 'manual'
  };
  console.log('== Funil ==');
  for (const [id, k] of Object.entries(esperado)) {
    const tem = !!(await p.$(`#kanban .lead-card[data-id="${id}"] .lead-name .canal-selo.canal-${k}`));
    checa(`lead ${id} mostra ${k}`, tem);
  }
  const rot = await p.getAttribute('#kanban .lead-card[data-id="ig"] .canal-selo', 'aria-label');
  checa('o selo diz a origem por extenso', rot === 'Origem: Instagram · anúncio', String(rot));
  checa(
    'o nome continua aparecendo como texto',
    /Ana do Insta <img/.test(await p.textContent('#kanban .lead-card[data-id="ig"] .lead-name'))
  );

  console.log('\n-- Lista --');
  const aba = await p.$('[data-acao="mostrarVista"][data-vista="lista"]');
  if (aba) {
    await aba.click();
    await p.waitForTimeout(300);
    checa(
      'na lista, cada linha também tem o selo',
      (await p.$$('#ll-corpo tbody tr .canal-selo')).length === leads.length,
      String((await p.$$('#ll-corpo tbody tr .canal-selo')).length)
    );
    checa('e o do WhatsApp na linha certa', !!(await p.$('#ll-corpo tr[data-id="wa"] .canal-whatsapp')));
  } else {
    checa('achou a aba de lista', false);
  }
  checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
  await b.close();
  process.exit(resumo(erros) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
