// Módulo Locação (/:slug/locacao).
//
// O que este arquivo prova:
//   - sem a licença LOCACAO a tela não carrega nada das tabelas a1_lc_* e a aba
//     não aparece na barra; parceiro também não vê a aba;
//   - com a licença: as seis vistas desenham o que o banco devolveu;
//   - pessoa, imóvel (com donos), contrato e lançamento gravam o que a pessoa
//     preencheu; dinheiro só passa pelas funções (ativar, gerar, baixar,
//     estornar, cancelar, pagar repasse, encerrar);
//   - a prévia da baixa faz a mesma conta do banco (multa + juros pró-rata);
//   - erro do banco vira frase legível; nada vira HTML (XSS).
//   Fase 2:
//   - ID automático (CT-0001/IM-0001) no lugar do código digitado (o antigo
//     aparece como "ref."); o formulário não manda código nem status;
//   - ficha do contrato: reajuste pelo índice, renovação, rescisão com multa
//     proporcional, histórico; documento gerado do modelo e impresso; editor
//     de modelo com prévia (campo desconhecido marcado, texto escapado);
//   - vistoria: roteiro, fotos no Storage da pasta do cliente, salvar grava
//     antes de apagar, concluir, comparativo entrada × saída.
const { abrir, checa, resumo } = require('./comum');

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';
const HOJE = new Date().toISOString().slice(0, 10);
const COMP = HOJE.slice(0, 7) + '-01';
const ANIV = (() => {
  const d = new Date(COMP + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - 12);
  return d.toISOString().slice(0, 10);
})();
const MES = Number(COMP.slice(5, 7));
const venc = (() => {
  const d = new Date(HOJE + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 10);
  return d.toISOString().slice(0, 10);
})();

function banco() {
  const est = { escritas: [], rpc: [], lidas: [], uploads: [] };
  const tab = {
    a1_lc_pessoas: [
      {
        id: 'pe1',
        nome: 'Ana ' + XSS,
        papeis: ['proprietario'],
        documento: '12345678901',
        pix: 'ana@pix.com',
        ativo: true
      },
      { id: 'pe2', nome: 'Beto', papeis: ['proprietario'], ativo: true },
      { id: 'pe3', nome: 'Inês ' + XSS, papeis: ['inquilino'], telefone: '(98) 98123-4567', ativo: true },
      { id: 'pe4', nome: 'Fábio', papeis: ['fiador'], ativo: true }
    ],
    a1_lc_imoveis: [
      {
        id: 'im1',
        tenant_id: 't1',
        seq: 1,
        codigo: 'AP-1',
        cidade: 'São Luís',
        uf: 'MA',
        tipo: 'apartamento',
        finalidade: 'residencial',
        logradouro: 'Rua ' + XSS,
        numero: '10',
        situacao: 'alugado'
      },
      {
        id: 'im2',
        tenant_id: 't1',
        seq: 2,
        codigo: 'CS-2',
        tipo: 'casa',
        finalidade: 'residencial',
        logradouro: 'Av. Litorânea',
        numero: '200',
        situacao: 'disponivel'
      }
    ],
    a1_lc_imovel_donos: [
      { imovel_id: 'im1', pessoa_id: 'pe1', percentual: 60 },
      { imovel_id: 'im1', pessoa_id: 'pe2', percentual: 40 }
    ],
    a1_lc_contratos: [
      {
        id: 'ct1',
        tenant_id: 't1',
        seq: 1,
        codigo: 'LOC-' + XSS,
        imovel_id: 'im1',
        inquilino_id: 'pe3',
        status: 'ativo',
        data_inicio: ANIV,
        prazo_meses: 30,
        dia_vencimento: 10,
        valor_aluguel: 2500,
        indice_reajuste: 'IGPM',
        mes_reajuste: MES,
        reajuste_auto: false,
        garantia_tipo: 'fiador',
        fiador_id: 'pe4',
        multa_atraso_pct: 10,
        juros_mes_pct: 1,
        multa_rescisao_alugueis: 3,
        taxa_adm_pct: 10,
        repasse_dias: 5,
        encargos: []
      },
      {
        id: 'ct2',
        tenant_id: 't1',
        seq: 2,
        imovel_id: 'im2',
        inquilino_id: 'pe3',
        status: 'rascunho',
        data_inicio: HOJE,
        prazo_meses: 12,
        dia_vencimento: 5,
        valor_aluguel: 1800,
        indice_reajuste: 'IPCA',
        garantia_tipo: 'nenhuma',
        multa_atraso_pct: 10,
        juros_mes_pct: 1,
        multa_rescisao_alugueis: 3,
        taxa_adm_pct: 8,
        repasse_dias: 5,
        encargos: []
      }
    ],
    a1_lc_cobrancas: [
      {
        id: 'cb1',
        contrato_id: 'ct1',
        competencia: COMP,
        vencimento: venc,
        valor_total: 2600,
        status: 'aberta',
        versao: 3,
        itens: [
          { descricao: 'Aluguel ' + XSS, valor: 2500 },
          { descricao: 'Condomínio', valor: 100 }
        ]
      },
      {
        id: 'cb2',
        contrato_id: 'ct1',
        competencia: COMP,
        vencimento: venc,
        valor_total: 2500,
        status: 'paga',
        versao: 2,
        pago_em: venc,
        valor_pago: 2500,
        forma_pagamento: 'pix',
        multa: 0,
        juros: 0,
        itens: []
      }
    ],
    a1_lc_repasses: [
      {
        id: 'rp1',
        cobranca_id: 'cb2',
        contrato_id: 'ct1',
        proprietario_id: 'pe1',
        percentual: 60,
        aluguel: 1500,
        encargos: 0,
        taxa_adm: 150,
        lancamentos: 0,
        valor_liquido: 1350,
        status: 'pendente',
        previsto_para: HOJE
      }
    ],
    a1_lc_lancamentos: [],
    a1_lc_aditivos: [
      {
        id: 'ad1',
        contrato_id: 'ct1',
        tipo: 'renovacao',
        prazo_antes: 18,
        prazo_depois: 30,
        valor_antes: 2400,
        valor_depois: 2500,
        observacao: 'Aditivo ' + XSS,
        criado_em: '2026-06-01T10:00:00Z'
      }
    ],
    a1_lc_modelos: [],
    a1_lc_vistorias: [
      {
        id: 'vs1',
        tenant_id: 't1',
        imovel_id: 'im1',
        contrato_id: 'ct1',
        tipo: 'entrada',
        data: ANIV,
        status: 'concluida',
        concluida_em: ANIV + 'T12:00:00Z',
        responsavel: 'Vist ' + XSS
      },
      {
        id: 'vs2',
        tenant_id: 't1',
        imovel_id: 'im1',
        contrato_id: 'ct1',
        tipo: 'saida',
        data: HOJE,
        status: 'rascunho'
      }
    ],
    a1_lc_indices: [{ indice: 'IGPM', mes: COMP, valor: 0.5 }]
  };
  const itens = {
    vs1: [
      { id: 'i1', vistoria_id: 'vs1', ordem: 0, comodo: 'Sala', item: 'Piso', estado: 'bom', fotos: [] },
      { id: 'i2', vistoria_id: 'vs1', ordem: 1, comodo: 'Sala', item: 'Paredes', estado: 'novo', fotos: [] }
    ],
    vs2: [
      { id: 'j1', vistoria_id: 'vs2', ordem: 0, comodo: 'Sala', item: 'Piso', estado: 'ruim', fotos: [] },
      {
        id: 'j2',
        vistoria_id: 'vs2',
        ordem: 1,
        comodo: 'Sala',
        item: 'Paredes',
        estado: 'novo',
        observacao: 'Obs ' + XSS,
        fotos: []
      }
    ]
  };
  const antes = (url, metodo, corpo) => {
    const m = url.match(/rest\/v1\/(a1_lc_[a-z_]+)/);
    const r = url.match(/rpc\/(a1_lc_[a-z_]+)/);
    if (r) {
      const args = JSON.parse(corpo || '{}');
      est.rpc.push({ fn: r[1], args });
      if (r[1] === 'a1_lc_ativar_contrato')
        return { __status: 400, corpo: { code: 'P0001', message: 'proprietarios_nao_somam_100' } };
      if (r[1] === 'a1_lc_gerar_cobrancas') return { criadas: 2 };
      if (r[1] === 'a1_lc_cancelar_cobranca' && args.p_motivo === 'velha')
        return { __status: 400, corpo: { code: 'P0001', message: 'versao_desatualizada' } };
      if (r[1] === 'a1_lc_baixar_cobranca') return { ok: true, valor_pago: 2694.67, repasses: 2 };
      if (r[1] === 'a1_lc_reajuste_previa')
        return {
          devido: COMP,
          aplicado: false,
          indice: 'IGPM',
          referencia_ate: COMP,
          acumulado: 4.5,
          percentual: 4.5,
          valor_antes: 2500,
          valor_depois: 2612.5
        };
      if (r[1] === 'a1_lc_aplicar_reajuste') return { ok: true, valor_antes: 2500, valor_depois: 2612.5 };
      if (r[1] === 'a1_lc_renovar_contrato') return { ok: true, prazo_meses: 42 };
      if (r[1] === 'a1_lc_rescisao_calculo')
        return { meses_restantes: 18, prazo: 30, multa: 4500, dias: 15, proporcional: 1209.68 };
      if (r[1] === 'a1_lc_rescindir_contrato')
        return { ok: true, multa: 4500, proporcional: 1209.68, cobranca_id: 'cbx' };
      return { ok: true };
    }
    if (/storage\/v1\/object\/case-documents\//.test(url) && metodo === 'POST') {
      est.uploads.push(url);
      return { Key: 'ok' };
    }
    if (!m) return undefined;
    if (metodo === 'GET') {
      est.lidas.push(m[1]);
      if (m[1] === 'a1_lc_vistoria_itens')
        return itens[(url.match(/vistoria_id=eq\.([^&]+)/) || [])[1]] || [];
      return url.includes('&or=') ? [] : tab[m[1]] || [];
    }
    est.escritas.push({ tabela: m[1], metodo, url, corpo: corpo ? JSON.parse(corpo) : null });
    if (metodo === 'DELETE') return [];
    const c = JSON.parse(corpo || '{}');
    const id = (url.match(/id=eq\.([^&]+)/) || [])[1] || 'novo1';
    return Array.isArray(c) ? c : [{ id, tenant_id: 't1', ...c }];
  };
  return { est, antes };
}
const texto = p => p.textContent('#lc-conteudo');
const vista = async (p, v) => {
  await p.click(`.sb-sub-item[data-vista="${v}"]`);
  await p.waitForTimeout(150);
};
const salvar = async p => {
  await p.click('#lc-modal-ok');
  await p.waitForTimeout(400);
};

(async () => {
  const todos = [];

  console.log('== Sem a licença ==');
  {
    const { est, antes } = banco();
    const { b, p, erros } = await abrir('thecred/locacao', { antes, modulos: [] });
    checa('nenhuma leitura das tabelas da Locação', est.lidas.length === 0, est.lidas.join(','));
    checa('saiu da tela de Locação', !/\/locacao/.test(p.url()), p.url());
    checa('a aba Locação não existe na barra', (await p.$$('a.sb-mod[href*="locacao"]')).length === 0);
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Parceiro com a licença ==');
  {
    const { est, antes } = banco();
    const { b, p, erros } = await abrir('thecred/crm', {
      antes,
      modulos: ['crm', 'LOCACAO'],
      usuario: { id: 'pa1', tenant_id: 't1', name: 'Corretor', role: 'partner', type: 'corretor', cpf: '1' }
    });
    checa('parceiro não vê a aba Locação', (await p.$$('a.sb-mod[href*="locacao"]')).length === 0);
    checa('nada lido', est.lidas.length === 0);
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Gestor com a licença ==');
  const { est, antes } = banco();
  const { b, p, erros } = await abrir('thecred/locacao', {
    antes,
    modulos: ['LOCACAO'],
    usuario: {
      id: 'u1',
      tenant_id: 't1',
      name: 'Julio',
      role: 'owner',
      cpf: '99999999999',
      tenant_name: 'Imob Teste'
    }
  });
  await p.waitForSelector('.lc-kpis');
  checa(
    'a aba Locação aparece na barra e está ativa',
    (await p.$$('a.sb-mod.ativo[href*="locacao"]')).length === 1
  );
  checa('sete vistas na sub-barra', (await p.$$('.sb-sub-item[data-acao="lcVista"]')).length === 7);
  const painel = await texto(p);
  checa(
    'painel: em atraso mostra a cobrança vencida',
    /Em atraso[\s\S]*R\$\s?2\.600,00/.test(painel),
    painel.slice(0, 300)
  );
  checa('painel: repasse a pagar', /Repasses a pagar[\s\S]*R\$\s?1\.350,00/.test(painel));
  checa(
    'painel: reajuste do mês pendente com botão, e a data dos índices',
    (await p.$$('#lc-conteudo [data-acao="lcReajustar"][data-id="ct1"]')).length === 1 &&
      /IGP-M até/.test(painel)
  );

  await vista(p, 'contratos');
  checa('vista na URL', /vista=contratos/.test(p.url()));
  const tc = await texto(p);
  checa('contratos: ativo e rascunho listados', /Ativo/.test(tc) && /Rascunho/.test(tc));
  checa('contratos: fiador aparece', /Fábio/.test(tc));
  checa(
    'contratos: ID automático e o código antigo como referência',
    /CT-0001/.test(tc) && /ref\. LOC-/.test(tc)
  );
  checa('contratos: selo de reajuste do mês', /Reajuste do mês/.test(tc));
  checa('contratos: imóvel pelo ID', /IM-0001/.test(tc));

  // Ativar falha com a mensagem traduzida.
  await p.click('[data-acao="lcAtivar"][data-id="ct2"]');
  await p.waitForTimeout(500);
  checa(
    'ativar chama a função e traduz o erro',
    est.rpc.some(r => r.fn === 'a1_lc_ativar_contrato' && r.args.p_contrato === 'ct2') &&
      /precisam somar 100%/.test(await p.textContent('#lc-toasts'))
  );

  // Novo contrato: caução acima de 3 aluguéis é barrada na tela.
  await p.click('[data-acao="lcNovoContrato"]');
  checa(
    'formulário sem campo de código; ID é gerado ao salvar',
    (await p.$$('#lk-codigo')).length === 0 &&
      /gerado ao salvar/.test(await p.inputValue('#lc-modal-corpo input[disabled]'))
  );
  checa('reajuste automático vem marcado', await p.isChecked('#lk-auto'));
  await p.selectOption('#lk-imovel', 'im2');
  await p.selectOption('#lk-inquilino', 'pe3');
  await p.fill('#lk-aluguel', '2.000,00');
  await p.selectOption('#lk-gtipo', 'caucao');
  checa(
    'caução mostra o campo de valor e esconde o fiador',
    (await p.isVisible('#lk-gvalor')) && !(await p.isVisible('#lk-fiador'))
  );
  await p.fill('#lk-gvalor', '7000');
  await salvar(p);
  checa('caução de 3,5 aluguéis é recusada', /até 3 aluguéis/.test(await p.textContent('#lc-modal-erro')));
  await p.fill('#lk-gvalor', '6000');
  await p.click('[data-acao="lcEncargoMais"]');
  await p.fill('#lk-encargos .le-desc', 'Condomínio');
  await p.fill('#lk-encargos .le-valor', '350');
  await salvar(p);
  const novo = est.escritas.find(e => e.tabela === 'a1_lc_contratos' && e.metodo === 'POST');
  checa(
    'contrato gravado com o que foi preenchido',
    novo &&
      novo.corpo.valor_aluguel === 2000 &&
      novo.corpo.garantia_tipo === 'caucao' &&
      novo.corpo.garantia_valor === 6000 &&
      novo.corpo.fiador_id === null &&
      novo.corpo.encargos.length === 1 &&
      novo.corpo.encargos[0].valor === 350 &&
      novo.corpo.tenant_id === 't1',
    JSON.stringify(novo && novo.corpo)
  );
  checa('contrato novo nasce como rascunho (status não vai do navegador)', novo && !('status' in novo.corpo));
  checa(
    'nem código nem ID vão do navegador; reajuste automático vai',
    novo && !('codigo' in novo.corpo) && !('seq' in novo.corpo) && novo.corpo.reajuste_auto === true
  );

  // Documento do contrato.
  await p.evaluate(() => {
    window.__PRINT = 0;
    window.print = () => {
      window.__PRINT++;
    };
  });
  await p.click('#lc-conteudo [data-acao="lcDocumento"][data-id="ct1"]');
  const doc = await p.textContent('#lc-doc-previa');
  checa(
    'documento: modelo residencial preenchido (partes, aluguel, fiador, índice)',
    /Contrato de locação residencial/i.test(doc) &&
      /CT-0001/.test(doc) &&
      /R\$\s?2\.500,00/.test(doc) &&
      /FIADOR e principal pagador[\s\S]*Fábio/.test(doc) &&
      /IGP-M\/FGV/.test(doc) &&
      /São Luís/.test(doc) &&
      /ADMINISTRADORA:\s*Imob Teste/.test(doc) &&
      !/## /.test(doc),
    doc.slice(0, 400)
  );
  checa('documento: nenhum campo ficou sem dado', (await p.$$('#lc-doc-previa .lc-doc-falta')).length === 0);
  const h2s = await p.$$eval('#lc-doc-previa h2', hs => hs.map(h => h.textContent || ''));
  checa(
    'documento: título da cláusula é título; o corpo é parágrafo',
    h2s.some(t => /^Cláusula 1ª/.test(t)) && !h2s.some(t => /Apartamento/.test(t)),
    h2s.join(' | ')
  );
  await salvar(p);
  checa(
    'imprimir chama a impressão com o documento',
    (await p.evaluate(() => window.__PRINT)) === 1 &&
      (await p.$$('#lc-impressao article.lc-doc')).length === 1
  );
  await p.click('[data-acao="lcFechar"]');

  // Editor de modelo.
  await p.click('[data-acao="lcModelos"]');
  await p.fill(
    '#lm-texto',
    '# Meu contrato\n\nInquilino: {{inquilino.nome}} {{campo.que.nao.existe}} ' + XSS
  );
  await p.waitForTimeout(100);
  checa(
    'prévia do modelo: campo preenchido, desconhecido marcado, texto não vira HTML',
    /Inquilino: Inês/.test(await p.textContent('#lm-previa')) &&
      (await p.$$('#lm-previa .lc-doc-falta')).length === 1 &&
      (await p.$$('#lm-previa img')).length === 0
  );
  await salvar(p);
  const mod = est.escritas.find(e => e.tabela === 'a1_lc_modelos');
  checa(
    'modelo gravado (upsert por cliente e tipo)',
    mod &&
      /on_conflict=tenant_id,tipo/.test(mod.url) &&
      mod.corpo.tipo === 'contrato_residencial' &&
      /campo\.que/.test(mod.corpo.texto)
  );

  // Ficha do contrato.
  await p.click('#lc-conteudo [data-acao="lcAbrirContrato"][data-id="ct1"]');
  await p.waitForTimeout(300);
  const ficha = await p.textContent('#lc-modal-corpo');
  checa(
    'ficha: reajuste pelo índice com valores',
    /acumulado de 4,5%/.test(ficha) && /2\.500,00 → R\$\s?2\.612,50/.test(ficha),
    ficha.slice(0, 500)
  );
  checa('ficha: histórico mostra a renovação', /Renovação: prazo 18 → 30 meses/.test(ficha));
  checa(
    'ficha: vistorias do contrato',
    (await p.$$('#lc-modal-corpo [data-acao="lcVistAbrir"]')).length === 2
  );
  await p.click('#lc-modal-corpo [data-acao="lcReajustar"]');
  await p.waitForTimeout(200);
  await salvar(p);
  checa(
    'reajuste: em branco aplica o índice (percentual nulo)',
    est.rpc.some(
      r => r.fn === 'a1_lc_aplicar_reajuste' && r.args.p_contrato === 'ct1' && r.args.p_percentual === null
    )
  );
  await p.click('#lc-conteudo [data-acao="lcAbrirContrato"][data-id="ct1"]');
  await p.click('#lc-modal-corpo [data-acao="lcRenovar"]');
  await p.fill('#lw-valor', '2.700,00');
  await salvar(p);
  checa(
    'renovar manda meses e novo valor',
    est.rpc.some(
      r => r.fn === 'a1_lc_renovar_contrato' && r.args.p_meses === 12 && r.args.p_novo_valor === 2700
    )
  );

  // Lançar despesa (pela ficha).
  await p.click('#lc-conteudo [data-acao="lcAbrirContrato"][data-id="ct1"]');
  await p.click('#lc-modal-corpo [data-acao="lcLancar"]');
  await p.fill('#ll-desc', 'Conserto ' + XSS);
  await p.fill('#ll-valor', '120,50');
  await salvar(p);
  const lan = est.escritas.find(e => e.tabela === 'a1_lc_lancamentos');
  checa(
    'despesa gravada positiva e para todos os donos',
    lan && lan.corpo.valor === 120.5 && lan.corpo.proprietario_id === null
  );

  // Rescisão: cálculo do banco, multa editável, proporcional e vencimento.
  await p.click('#lc-conteudo [data-acao="lcAbrirContrato"][data-id="ct1"]');
  await p.click('#lc-modal-corpo [data-acao="lcEncerrar"]');
  await p.selectOption('#le-motivo', 'rescindido');
  await p.waitForTimeout(300);
  checa(
    'rescisão mostra o cálculo proporcional e preenche a multa',
    /Faltam 18 de 30 meses/.test(await p.textContent('#le-calc')) &&
      (await p.inputValue('#le-multa')) === '4500' &&
      /15 dia\(s\)/.test(await p.textContent('#le-prop-txt'))
  );
  await salvar(p);
  const resc = est.rpc.find(r => r.fn === 'a1_lc_rescindir_contrato');
  checa(
    'rescindir manda data, multa, proporcional e vencimento (+10 dias)',
    resc &&
      resc.args.p_data === HOJE &&
      resc.args.p_multa === 4500 &&
      resc.args.p_proporcional === true &&
      !!resc.args.p_vencimento,
    JSON.stringify(resc)
  );
  await p.click('#lc-conteudo [data-acao="lcAbrirContrato"][data-id="ct1"]');
  await p.click('#lc-modal-corpo [data-acao="lcEncerrar"]');
  await p.selectOption('#le-motivo', 'encerrado');
  checa('fim do contrato esconde a rescisão', await p.isHidden('#le-resc'));
  await salvar(p);
  checa(
    'encerrar (fim do contrato) chama a função de encerrar',
    est.rpc.some(
      r =>
        r.fn === 'a1_lc_encerrar_contrato' && r.args.p_contrato === 'ct1' && r.args.p_motivo === 'encerrado'
    )
  );

  await vista(p, 'cobrancas');
  const tb = await texto(p);
  checa('cobranças: atrasada e paga', /Atrasada/.test(tb) && /Paga/.test(tb), tb.slice(0, 200));
  await p.click('[data-acao="lcGerarMes"]');
  await p.waitForTimeout(400);
  checa(
    'gerar cobranças do mês chama a função com a competência',
    est.rpc.some(r => r.fn === 'a1_lc_gerar_cobrancas' && r.args.p_competencia === COMP && !r.args.p_contrato)
  );

  // Baixa com 10 dias de atraso: multa 10% de 2600 = 260; juros 1%/30 × 10 × 2600 = 8,67.
  await p.click('[data-acao="lcBaixar"][data-id="cb1"]');
  const previa = await p.textContent('#lb-previa');
  checa(
    'prévia: multa e juros pró-rata iguais à conta do banco',
    /260,00/.test(previa) && /8,67/.test(previa) && /2\.868,67/.test(previa),
    previa
  );
  await p.check('#lb-isentar');
  checa(
    'isentar zera multa e juros na prévia',
    /Em dia|multa R\$\s?0,00/.test(await p.textContent('#lb-previa'))
  );
  await p.uncheck('#lb-isentar');
  await p.fill('#lb-desc', '174');
  await p.selectOption('#lb-forma', 'boleto');
  await salvar(p);
  const bx = est.rpc.find(r => r.fn === 'a1_lc_baixar_cobranca');
  checa(
    'baixa manda versão, forma e desconto',
    bx &&
      bx.args.p_cobranca === 'cb1' &&
      bx.args.p_versao === 3 &&
      bx.args.p_forma === 'boleto' &&
      bx.args.p_desconto === 174 &&
      bx.args.p_isentar_multa === false,
    JSON.stringify(bx)
  );

  await p.click('[data-acao="lcEstornar"][data-id="cb2"]');
  await p.waitForTimeout(400);
  checa(
    'estornar chama a função com a versão',
    est.rpc.some(r => r.fn === 'a1_lc_estornar_cobranca' && r.args.p_versao === 2)
  );

  await p.click('[data-acao="lcCancelar"][data-id="cb1"]');
  await p.fill('#lx-motivo', 'carência');
  await salvar(p);
  checa(
    'cancelar manda o motivo',
    est.rpc.some(r => r.fn === 'a1_lc_cancelar_cobranca' && r.args.p_motivo === 'carência')
  );

  const lidasAntes = est.lidas.length;
  await p.click('[data-acao="lcCancelar"][data-id="cb1"]');
  await p.fill('#lx-motivo', 'velha');
  await salvar(p);
  checa(
    'versão desatualizada fecha o modal, avisa e recarrega',
    (await p.isHidden('#lc-fundo')) &&
      /Outra pessoa mexeu/.test(await p.textContent('#lc-toasts')) &&
      est.lidas.length > lidasAntes
  );

  await vista(p, 'repasses');
  const tr = await texto(p);
  checa('repasses: líquido e PIX do dono', /1\.350,00/.test(tr) && /ana@pix\.com/.test(tr));
  await p.click('[data-acao="lcPagarRepasse"][data-id="rp1"]');
  await salvar(p);
  checa(
    'pagar repasse chama a função',
    est.rpc.some(r => r.fn === 'a1_lc_pagar_repasse' && r.args.p_repasse === 'rp1')
  );

  await vista(p, 'imoveis');
  checa('imóveis: donos com a parte de cada um', /Beto 40%/.test(await texto(p)));
  await p.click('[data-acao="lcEditarImovel"][data-id="im2"]');
  await p.selectOption('#li-donos .lc-dono select', 'pe1');
  await p.fill('#li-donos .lc-dono input', '70');
  await p.click('[data-acao="lcDonoMais"]');
  await p.selectOption('#li-donos .lc-dono:nth-child(2) select', 'pe2');
  await p.fill('#li-donos .lc-dono:nth-child(2) input', '30');
  checa('soma das partes aparece', /Soma: 100%/.test(await p.textContent('#li-soma')));
  await salvar(p);
  const imv = est.escritas.find(e => e.tabela === 'a1_lc_imoveis' && e.metodo === 'PATCH');
  const donos = est.escritas.find(e => e.tabela === 'a1_lc_imovel_donos' && e.metodo === 'POST');
  checa('imóvel atualizado pelo id', imv && /id=eq\.im2/.test(imv.url));
  const ordem = est.escritas.filter(e => e.tabela === 'a1_lc_imovel_donos').map(e => e.metodo);
  const apagou = est.escritas.find(e => e.tabela === 'a1_lc_imovel_donos' && e.metodo === 'DELETE');
  checa(
    'donos: grava antes de apagar, e só apaga quem saiu',
    ordem.join() === 'POST,DELETE' && /pessoa_id=not\.in\.\(pe1,pe2\)/.test(apagou.url),
    ordem.join() + ' ' + (apagou && apagou.url)
  );
  checa(
    'donos regravados com as partes',
    donos &&
      donos.corpo.length === 2 &&
      donos.corpo[0].percentual === 70 &&
      donos.corpo[1].pessoa_id === 'pe2' &&
      donos.corpo[0].imovel_id === 'im2'
  );

  // Vistorias.
  await vista(p, 'vistorias');
  const tv = await texto(p);
  checa(
    'vistorias: lista com entrada concluída e saída em rascunho',
    /Concluída/.test(tv) && /Rascunho/.test(tv)
  );
  await p.click('[data-acao="lcVistComparar"][data-id="vs2"]');
  await p.waitForTimeout(300);
  const cmp = await p.textContent('#lc-modal-corpo');
  checa(
    'comparativo: piso piorou de Bom para Ruim',
    /1 item\(ns\) em estado pior/.test(cmp) && /Piorou/.test(cmp),
    cmp.slice(0, 300)
  );
  await p.click('[data-acao="lcFechar"]');
  await p.click('[data-acao="lcVistAbrir"][data-id="vs2"]');
  await p.waitForTimeout(300);
  checa('editor: itens da vistoria carregados', (await p.$$('#lv-itens .lc-vi')).length === 2);
  await p.selectOption('#lv-comodo', 'Banheiro');
  await p.click('[data-acao="lcVistComodo"]');
  checa('cômodo com roteiro acrescenta os itens', (await p.$$('#lv-itens .lc-vi')).length === 9);
  await p.click('#lv-itens .lc-vi[data-id="j2"] [data-acao="lcVistItemMenos"]');
  await p.setInputFiles('#lv-itens .lc-vi[data-id="j1"] input[type=file]', {
    name: 'piso.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  });
  await p.waitForTimeout(300);
  checa(
    'foto vai para o Storage, na pasta do cliente e da vistoria',
    est.uploads.length === 1 &&
      /case-documents\/t1\/locacao\/vistorias\/vs2\/[\w-]+\.jpg$/.test(est.uploads[0]),
    est.uploads.join()
  );
  const antesSalvar = est.escritas.length;
  await salvar(p);
  const depois = est.escritas.slice(antesSalvar);
  const up = depois.find(e => e.tabela === 'a1_lc_vistoria_itens' && e.metodo === 'POST');
  const del = depois.find(e => e.tabela === 'a1_lc_vistoria_itens' && e.metodo === 'DELETE');
  checa(
    'salvar: cabeçalho, itens (upsert) e só depois apaga quem saiu',
    depois.map(e => e.metodo).join() === 'PATCH,POST,DELETE' &&
      /on_conflict=id/.test(up.url) &&
      up.corpo.length === 8 &&
      up.corpo[0].fotos.length === 1 &&
      /id=not\.in\./.test(del.url) &&
      !/j2/.test(del.url.split('not.in.')[1]),
    depois.map(e => e.metodo + ' ' + e.url).join(' | ')
  );
  await p.click('[data-acao="lcVistConcluir"]');
  await p.waitForTimeout(500);
  checa(
    'concluir salva e chama a função',
    est.rpc.some(r => r.fn === 'a1_lc_concluir_vistoria' && r.args.p_vistoria === 'vs2')
  );
  await p.click('[data-acao="lcFechar"]');

  await p.click('[data-acao="lcVistNova"]');
  await p.selectOption('#lv-imovel', 'im2');
  await p.selectOption('#lv-tipo', 'entrada');
  const antesNova = est.escritas.length;
  await salvar(p);
  await p.waitForTimeout(300);
  const nova = est.escritas.slice(antesNova);
  checa(
    'nova vistoria com o roteiro padrão (5 cômodos, 32 itens)',
    nova[0] &&
      nova[0].tabela === 'a1_lc_vistorias' &&
      nova[0].corpo.imovel_id === 'im2' &&
      nova.some(e => e.tabela === 'a1_lc_vistoria_itens' && e.metodo === 'POST' && e.corpo.length === 32),
    nova
      .map(e => e.tabela + ' ' + e.metodo + ' ' + (Array.isArray(e.corpo) ? e.corpo.length : ''))
      .join(' | ')
  );
  await p.click('[data-acao="lcFechar"]');

  await vista(p, 'pessoas');
  checa('pessoas: CPF formatado e fosco (LGPD)', (await p.$$('#lc-conteudo .lgpd')).length > 0);
  await p.click('[data-acao="lcNovaPessoa"]');
  await p.fill('#lp-nome', 'Carla');
  await p.fill('#lp-doc', '123.456');
  await salvar(p);
  checa('documento inválido é recusado', /11 dígitos/.test(await p.textContent('#lc-modal-erro')));
  await p.fill('#lp-doc', '987.654.321-00');
  await p.check('.lp-papel[value="inquilino"]');
  await salvar(p);
  const pes = est.escritas.find(e => e.tabela === 'a1_lc_pessoas');
  checa(
    'pessoa gravada só com dígitos e papéis',
    pes && pes.corpo.documento === '98765432100' && pes.corpo.papeis.join() === 'inquilino'
  );

  checa(
    'nenhum handler inline',
    await p.evaluate(() => !document.querySelector('[onclick],[onchange],[oninput]'))
  );
  checa('nada virou HTML (XSS)', (await p.evaluate(() => window.__XSS)) === 0);
  await b.close();
  // O 400 é o erro de propósito do "Ativar" (proprietarios_nao_somam_100).
  todos.push(...erros.filter(e => !/status of 400/.test(e)));

  process.exit(resumo(todos) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
