// Os selos do funil de Leads, a visita na agenda e a pré-análise só no selo.
//
// O PEDIDO DO DONO, NAS PALAVRAS DELE
//   "no workflow de leads não tem selos, crie os principais, por exemplo, ao
//    passar para visita agendada (selo agendamento) em andamento, abre um popup
//    para cadastrar a visita (...) fica registrado no calendário, na agenda do
//    corretor e da imobiliária, na página inicial em Geral"
//   "a pré-análise só pode ser liberada na etapa com o selo iniciar pré-análise,
//    não em qualquer etapa"
//
// O QUE ESTE ARQUIVO PROVA
// 1. As colunas do funil mostram o selo de cada etapa.
// 2. Mover para a etapa de Agendamento abre o popup; cancelar deixa o lead onde
//    estava, sem nenhum PATCH; confirmar chama a função do banco com os dados
//    da visita e só DEPOIS move o lead.
// 3. O botão "Criar pré-análise" só libera na etapa com o selo, quando o funil
//    tem essa etapa; num funil sem o selo, libera em qualquer etapa.
// 4. Mover para Perdido pede o motivo (do catálogo, sem os inativos) e grava no
//    lead.
// 5. O editor de Workflow oferece o selo nas etapas de Leads e o grava pela
//    função do banco, nunca no PATCH.
// 6. A agenda da tela Geral reconhece a visita como tipo próprio.
const { abrir, checa, resumo } = require('./comum');

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';

function cenario(comSeloPA = true) {
  const st = (id, name, position, extra = {}) => ({
    id,
    tenant_id: 't1',
    module_key: 'crm',
    group_key: 'vendas',
    name,
    color: '#6366f1',
    position,
    is_initial: false,
    is_final: false,
    selo: null,
    ...extra
  });
  return {
    stages: [
      st('l1', 'Lead Recebido', 1, { is_initial: true }),
      st('l2', 'Visita Agendada ' + XSS, 2, { selo: 'AGENDAMENTO' }),
      st('l3', 'Análise de crédito', 3, { selo: comSeloPA ? 'PRE_ANALISE' : null }),
      st('l4', 'Ganho', 4, { is_final: true, selo: 'GANHO' }),
      st('l5', 'Perdido', 5, { is_final: true, selo: 'PERDIDO' })
    ],
    leads: [
      {
        id: 'lead-a',
        tenant_id: 't1',
        module_key: 'crm',
        stage_id: 'l1',
        stage_name: 'Lead Recebido',
        stage_entered_at: new Date().toISOString(),
        client_name: 'Joana Lead ' + XSS,
        client_phone: '98999990000',
        development: 'Residencial das Flores',
        broker_name: 'Carla Dias',
        real_estate_name: 'Imob Sol',
        payload: { crm_refs: { corretor_id: 'p10', imobiliaria_id: 'p1' } },
        created_at: new Date().toISOString()
      }
    ]
  };
}

function rotasCrm(est) {
  return (url, metodo) => {
    if (url.includes('/rest/v1/a1_stages') && url.includes('module_key=eq.crm')) return est.stages;
    if (url.includes('/rest/v1/a1_cases') && url.includes('module_key=eq.crm') && metodo === 'GET')
      return est.leads;
    if (url.includes('/rest/v1/a1_cases') && metodo === 'PATCH') return [];
    if (url.includes('/rest/v1/a1_agenda') && url.includes('tipo=eq.visita')) return [];
    if (url.includes('/rest/v1/a1_config') && url.includes('crm_cad_motivos_perda'))
      return [
        {
          value: JSON.stringify([
            { id: 'm1', name: 'Preço ' + XSS },
            { id: 'm2', name: 'Inativo', active: false }
          ])
        }
      ];
    return undefined;
  };
}

const posts = p => p.evaluate(() => window.__POSTS.slice());
const visivel = (p, sel) =>
  p.evaluate(s => {
    const el = document.querySelector(s);
    return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
  }, sel);

(async () => {
  const todosErros = [];

  // ─── 1 a 4: o funil ────────────────────────────────────────────────────────
  {
    const est = cenario(true);
    const { b, p, erros } = await abrir('thecred/crm', {
      modulos: ['crm', 'PRE_ANALISE'],
      antes: rotasCrm(est)
    });
    console.log('\n[Funil com selos]');
    const selos = await p.$$eval('.k-col-selo', els => els.map(e => e.textContent.trim()));
    checa(
      'as colunas mostram o selo de cada etapa',
      selos.join('|') === 'Visita|Pré-análise|Ganho|Perdido',
      selos.join('|')
    );

    await p.evaluate(() => window.openLead('lead-a'));
    await p.waitForTimeout(200);
    const bt = await p.$eval('#ml-pre', e => ({
      vis: e.style.display !== 'none',
      dis: e.disabled,
      t: e.title
    }));
    checa('o botão de pré-análise aparece com o módulo licenciado', bt.vis);
    checa(
      'fora da etapa com o selo, ele fica travado e diz onde começa',
      bt.dis && /Análise de crédito/.test(bt.t),
      bt.t
    );

    // Agendamento: cancelar não move.
    await p.selectOption('#ml-stage', 'l2');
    await p.waitForTimeout(200);
    checa('mover para a etapa de Agendamento abre o popup da visita', await visivel(p, '#modal-selo'));
    checa(
      'o popup diz para quem a visita vai',
      /Carla Dias/.test(await p.textContent('#ms-body')) && /Imob Sol/.test(await p.textContent('#ms-body'))
    );
    await p.click('#modal-selo .btn-ghost');
    await p.waitForTimeout(200);
    checa('cancelar fecha o popup', !(await visivel(p, '#modal-selo')));
    checa('e o seletor volta para a etapa em que o lead está', (await p.inputValue('#ml-stage')) === 'l1');
    checa('sem nenhum PATCH no lead', !(await posts(p)).some(x => x.m === 'PATCH' && /a1_cases/.test(x.url)));

    // Agendamento: horário invertido é barrado antes de ir ao banco.
    await p.selectOption('#ml-stage', 'l2');
    await p.waitForTimeout(200);
    await p.fill('#mv-ini', '15:00');
    await p.fill('#mv-fim', '14:00');
    await p.click('#ms-ok');
    await p.waitForTimeout(200);
    checa('fim antes do início é recusado na tela', /antes do início/.test(await p.textContent('#ms-erro')));
    checa(
      'e a função do banco nem é chamada',
      !(await posts(p)).some(x => /a1_crm_agendar_visita/.test(x.url))
    );
    await p.fill('#mv-fim', '16:00');
    await p.fill('#mv-local', 'Stand de vendas');
    await p.fill('#mv-obs', 'Levar a tabela ' + XSS);
    await p.click('#ms-ok');
    await p.waitForTimeout(400);
    const ps = await posts(p);
    const rpc = ps.find(x => /a1_crm_agendar_visita/.test(x.url));
    const corpo = rpc ? JSON.parse(rpc.body) : {};
    checa(
      'confirmar chama a1_crm_agendar_visita com o lead, a data e o horário',
      corpo.p_lead === 'lead-a' &&
        /^\d{4}-\d{2}-\d{2}$/.test(corpo.p_data || '') &&
        corpo.p_hora_inicio === '15:00' &&
        corpo.p_hora_fim === '16:00',
      JSON.stringify(corpo)
    );
    checa(
      'com o local e a observação',
      corpo.p_local === 'Stand de vendas' && /tabela/.test(corpo.p_observacao || '')
    );
    const iRpc = ps.findIndex(x => /a1_crm_agendar_visita/.test(x.url));
    const iPatch = ps.findIndex(x => x.m === 'PATCH' && /a1_cases/.test(x.url));
    checa('e só depois move o lead', iRpc >= 0 && iPatch > iRpc);
    checa('o PATCH leva a etapa nova', iPatch >= 0 && JSON.parse(ps[iPatch].body).stage_id === 'l2');
    checa('o popup fecha', !(await visivel(p, '#modal-selo')));
    checa('o cartão mostra a visita', /Visita \d{2}\/\d{2} 15:00/.test(await p.textContent('.lead-card')));

    // Pré-análise: na etapa com o selo, libera.
    await p.selectOption('#ml-stage', 'l3');
    await p.waitForTimeout(300);
    checa('etapa sem popup move direto', (await visivel(p, '#modal-selo')) === false);
    checa('na etapa com o selo, o botão de pré-análise libera', !(await p.$eval('#ml-pre', e => e.disabled)));

    // Perdido: pede o motivo.
    await p.selectOption('#ml-stage', 'l5');
    await p.waitForTimeout(300);
    checa('mover para Perdido abre o popup do motivo', await visivel(p, '#modal-selo'));
    const opcoes = await p.$$eval('#mp-motivo option', os => os.map(o => o.textContent));
    checa(
      'os motivos vêm do catálogo, sem os inativos, com "Outro"',
      opcoes.some(o => /^Preço/.test(o)) && !opcoes.includes('Inativo') && opcoes.includes('Outro'),
      opcoes.join('|')
    );
    await p.click('#ms-ok');
    await p.waitForTimeout(150);
    checa('sem motivo não registra', /Escolha o motivo/.test(await p.textContent('#ms-erro')));
    await p.selectOption('#mp-motivo', 'Outro');
    await p.click('#ms-ok');
    await p.waitForTimeout(150);
    checa('"Outro" pede a observação', /observação/.test(await p.textContent('#ms-erro')));
    await p.selectOption('#mp-motivo', { index: 1 });
    await p.fill('#mp-obs', 'Achou caro');
    await p.click('#ms-ok');
    await p.waitForTimeout(400);
    const patches = (await posts(p)).filter(x => x.m === 'PATCH' && /a1_cases/.test(x.url));
    const ult = patches.length ? JSON.parse(patches[patches.length - 1].body) : {};
    checa(
      'o motivo vai para o lead junto com a etapa',
      ult.stage_id === 'l5' &&
        ult.payload &&
        ult.payload.perda &&
        /^Preço/.test(ult.payload.perda.motivo) &&
        ult.payload.perda.obs === 'Achou caro',
      JSON.stringify(ult)
    );
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS)) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  // ─── 3b: funil sem o selo de pré-análise ───────────────────────────────────
  {
    const est = cenario(false);
    const { b, p, erros } = await abrir('thecred/crm', {
      modulos: ['crm', 'PRE_ANALISE'],
      antes: rotasCrm(est)
    });
    console.log('\n[Funil sem o selo de pré-análise]');
    await p.evaluate(() => window.openLead('lead-a'));
    await p.waitForTimeout(200);
    checa(
      'sem etapa com o selo no funil, a pré-análise libera de qualquer etapa',
      !(await p.$eval('#ml-pre', e => e.disabled))
    );
    todosErros.push(...erros);
    await b.close();
  }

  // ─── 5: o editor de Workflow ───────────────────────────────────────────────
  {
    const est = cenario(true);
    const { b, p, erros } = await abrir('thecred/workflow?module=crm', {
      modulos: ['crm'],
      antes: rotasCrm(est)
    });
    console.log('\n[Workflow de Leads]');
    const tags = await p.$$eval('.stag-selo', els => els.map(e => e.textContent.trim()));
    checa(
      'as etapas mostram o selo no quadro',
      tags.includes('Agendamento de visita') && tags.includes('Perdido'),
      tags.join('|')
    );
    await p.click('[data-acao="openEdit"][data-stage-id="l3"]');
    await p.waitForTimeout(200);
    checa('o painel da etapa tem o seletor de selo', await visivel(p, '#ep-selo-crm'));
    checa('com o selo atual marcado', (await p.inputValue('#ep-selo-lead')) === 'PRE_ANALISE');
    checa('e a explicação do selo', /Só nesta etapa/.test(await p.textContent('#ep-selo-lead-ajuda')));
    await p.selectOption('#ep-selo-lead', 'GANHO');
    await p.click('[data-acao="saveStage"]');
    await p.waitForTimeout(500);
    const ps = await posts(p);
    const rpc = ps.find(x => /a1_crm_definir_selo/.test(x.url));
    checa(
      'o selo vai pela função do banco',
      !!rpc && JSON.parse(rpc.body).p_stage === 'l3' && JSON.parse(rpc.body).p_selo === 'GANHO',
      rpc ? rpc.body : 'sem chamada'
    );
    const patch = ps.find(x => x.m === 'PATCH' && /a1_stages/.test(x.url));
    checa('e nunca no PATCH da etapa', !!patch && !/selo/.test(patch.body), patch ? patch.body : 'sem PATCH');
    todosErros.push(...erros);
    await b.close();
  }

  // ─── 6: a visita na agenda da tela Geral ───────────────────────────────────
  {
    const hoje = new Date();
    const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const { b, p, erros } = await abrir('thecred/geral', {
      antes: url =>
        url.includes('/rest/v1/a1_agenda')
          ? [
              {
                id: 'ag-v1',
                tipo: 'visita',
                titulo: 'Visita: Joana Lead ' + XSS,
                descricao: null,
                local: 'Stand',
                data: iso,
                hora_inicio: '15:00:00',
                hora_fim: '16:00:00',
                caso_id: null,
                concluido_em: null
              }
            ]
          : undefined
    });
    console.log('\n[Agenda da Geral]');
    const txt = await p.evaluate(() => (document.getElementById('cal-corpo') || {}).textContent || '');
    checa(
      'a legenda da agenda conta a visita como tipo próprio',
      /1\s*Visita/.test(txt.replace(/\s+/g, ' ')),
      txt.slice(0, 200)
    );
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS)) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros) ? 1 : 0);
})();
