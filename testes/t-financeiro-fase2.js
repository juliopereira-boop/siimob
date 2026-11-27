// Financeiro, fase 2 (/:slug/financeiro): carteira, conciliação OFX, DRE.
//
// O que este arquivo prova:
//   - carteira desligada: aviso que leva a Cadastros, sem botões de carteira;
//   - carteira: KPIs (a receber, vencido), filtro "com parcela vencida", ficha
//     com correção e encargos, receber com o valor do dia (outra data recalcula
//     no banco), desconto sai do valor, estorno e renegociação com versão,
//     carteira à mão com séries (vencimentos mês a mês) e telefone só dígitos,
//     importar vendas, distrato só na carteira à mão;
//   - conciliação: OFX em Windows-1252 lido no navegador (data, valor com
//     sinal, FITID, descrição acentuada), sugestões, usar sugestão de parcela,
//     criar lançamento com categoria e centro, ignorar, desfazer, automático;
//   - DRE: cascata (receita líquida, resultado líquido) com orçado, troca de
//     regime e centro chama o banco de novo; orçamento grava só o que mudou;
//   - cadastros: grupo do DRE na categoria, centros (um por empreendimento),
//     carteira e lembrete (nome de modelo inválido é recusado), correção por
//     empreendimento; lançamento com centro de custo;
//   - nada vira HTML (XSS).
const { abrir, checa, resumo } = require('./comum');

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';
const HOJE = new Date().toISOString().slice(0, 10);
const ANO = HOJE.slice(0, 4);
const MES = HOJE.slice(0, 7);
const dias = n => {
  const d = new Date(HOJE + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const PARCELAS = [
  {
    id: 'p1',
    numero: 1,
    serie: 'ATO',
    nome: 'Ato',
    quem_paga: 'CLIENTE',
    vencimento: dias(-60),
    valor: 5000,
    status: 'paga',
    pago_em: dias(-60),
    valor_pago: 5000,
    versao: 2,
    calc: { original: 5000, fator: 1, correcao: 0, total: 5000 }
  },
  {
    id: 'p2',
    numero: 2,
    serie: 'MENSAL',
    nome: 'Mensal 1/2 ' + XSS,
    quem_paga: 'CLIENTE',
    vencimento: dias(-15),
    valor: 1000,
    status: 'aberta',
    versao: 1,
    calc: {
      original: 1000,
      fator: 1.01,
      correcao: 10,
      corrigido: 1010,
      dias_atraso: 15,
      multa: 20.2,
      juros: 5.05,
      total: 1035.25
    }
  },
  {
    id: 'p3',
    numero: 3,
    serie: 'MENSAL',
    nome: 'Mensal 2/2',
    quem_paga: 'CLIENTE',
    vencimento: dias(15),
    valor: 1000,
    status: 'aberta',
    versao: 1,
    calc: {
      original: 1000,
      fator: 1.01,
      correcao: 10,
      corrigido: 1010,
      dias_atraso: 0,
      multa: 0,
      juros: 0,
      total: 1010
    }
  },
  {
    id: 'p4',
    numero: 4,
    serie: 'FINANCIAMENTO',
    nome: 'Financiamento',
    quem_paga: 'BANCO',
    vencimento: dias(90),
    valor: 150000,
    status: 'aberta',
    versao: 1,
    calc: { original: 150000, fator: 1, correcao: 0, total: 150000 }
  }
];

function banco(opc = {}) {
  const est = { escritas: [], rpc: [], lidas: [], edge: [] };
  const tab = {
    a1_fin_config: [
      {
        tenant_id: 't1',
        prazo_receber_dias: 30,
        conta_padrao: 'ct1',
        carteira_ativa: opc.desligada ? false : true,
        lembrete_ativo: false,
        lembrete_dias: [-3, 0, 1, 7],
        lembrete_modelo: null
      }
    ],
    a1_fin_contas: [
      {
        id: 'ct1',
        nome: 'Caixa',
        tipo: 'caixa',
        saldo_inicial: 0,
        saldo_inicial_em: '2026-01-01',
        ativo: true
      },
      {
        id: 'ct2',
        nome: 'Banco ' + XSS,
        tipo: 'banco',
        saldo_inicial: 0,
        saldo_inicial_em: '2026-01-01',
        ativo: true
      }
    ],
    a1_fin_categorias: [
      { id: 'cat1', nome: 'Venda de unidade', tipo: 'receita', chave: 'venda_unidade', ativo: true },
      { id: 'cat2', nome: 'Impostos', tipo: 'despesa', chave: 'impostos', ativo: true },
      { id: 'cat3', nome: 'Aluguel ' + XSS, tipo: 'despesa', chave: null, ativo: true },
      {
        id: 'cat4',
        nome: 'Rendimentos',
        tipo: 'receita',
        chave: null,
        ativo: true,
        grupo_dre: 'financeira_receita'
      }
    ],
    a1_fin_lancamentos: [
      {
        id: 'l1',
        tipo: 'pagar',
        descricao: 'Tarifa bancária',
        valor: 35.9,
        vencimento: dias(-1),
        status: 'aberto',
        origem: 'manual',
        versao: 1
      },
      {
        id: 'l9',
        tipo: 'receber',
        descricao: 'Honorário ' + XSS,
        valor: 500,
        vencimento: dias(-5),
        status: 'pago',
        pago_em: dias(-5),
        valor_pago: 500,
        origem: 'manual',
        versao: 2
      }
    ],
    a1_fin_centros: [
      { id: 'cc1', nome: 'Residencial Sol', tipo: 'empreendimento', empreendimento_id: 'emp1', ativo: true }
    ],
    a1_fin_carteira_cfg: [],
    a1_fin_carteiras: opc.desligada
      ? []
      : [
          {
            id: 'k1',
            seq: 1,
            comercial_id: 'co1',
            cliente_nome: 'Lia ' + XSS,
            telefone: '5598981234567',
            empreendimento_id: 'emp1',
            empreendimento: 'Residencial Sol',
            unidade: '302',
            data_base: '2026-01-01',
            data_chaves: '2027-06-30',
            indice_obra: 'INCC',
            indice_pos: 'IGPM',
            juros_pos_am: 1,
            defasagem_meses: 1,
            negativo_zera: true,
            multa_pct: 2,
            juros_mora_am: 1,
            lembretes: true,
            status: 'ativa',
            versao: 3
          },
          {
            id: 'k2',
            seq: 2,
            cliente_nome: 'Bia',
            status: 'quitada',
            lembretes: true,
            telefone: null,
            versao: 1
          },
          {
            id: 'k3',
            seq: 3,
            comercial_id: null,
            cliente_nome: 'Rui',
            empreendimento: 'Torre',
            status: 'ativa',
            lembretes: false,
            versao: 1,
            data_base: '2026-01-01',
            indice_obra: 'INCC',
            indice_pos: 'IGPM'
          }
        ],
    a1_fin_extrato_itens: [
      {
        id: 'e1',
        conta_id: 'ct1',
        data: dias(-1),
        valor: -35.9,
        descricao: 'TARIFA ' + XSS,
        status: 'pendente'
      },
      { id: 'e2', conta_id: 'ct1', data: HOJE, valor: 1035.25, descricao: 'PIX LIA', status: 'pendente' },
      {
        id: 'e3',
        conta_id: 'ct1',
        data: dias(-5),
        valor: 500,
        descricao: 'TED',
        status: 'conciliado',
        lancamento_id: 'l9'
      }
    ],
    a1_fin_extratos: [
      { id: 'x1', conta_id: 'ct1', arquivo: 'nov.ofx', inicio: dias(-30), fim: HOJE, itens: 40, novos: 3 }
    ],
    a1_fin_orcamentos: [{ categoria_id: 'cat3', mes: `${ANO}-01-01`, valor: 3500 }],
    a1_fin_lembretes: [{ parcela_id: 'p2', gatilho: 'D+1', canal: 'oficial', ok: true, criado_em: HOJE }]
  };
  const antes = (url, metodo, corpo) => {
    if (/functions\/v1\/atendimento-conectores/.test(url)) {
      est.edge.push(JSON.parse(corpo || '{}'));
      return {
        ok: true,
        modelos: [
          {
            nome: 'lembrete_parcela',
            idioma: 'pt_BR',
            status: 'APPROVED',
            suportado: true,
            corpo: 'Olá {{1}}, parcela de {{2}} vence em {{3}}.'
          },
          { nome: 'reprovado', idioma: 'pt_BR', status: 'REJECTED', suportado: true, corpo: 'x' }
        ]
      };
    }
    const r = url.match(/rpc\/(a1_fin_[a-z_]+)/);
    if (r) {
      const args = JSON.parse(corpo || '{}');
      est.rpc.push({ fn: r[1], args });
      if (r[1] === 'a1_fin_carteiras_resumo')
        return opc.desligada
          ? []
          : [
              {
                carteira_id: 'k1',
                valor_original: 157000,
                recebido: 5000,
                a_receber: 152020,
                vencido: 1010,
                parcelas_vencidas: 1,
                parcelas_abertas: 3,
                proximo_vencimento: dias(15),
                maior_atraso: 15
              },
              {
                carteira_id: 'k2',
                valor_original: 8000,
                recebido: 8000,
                a_receber: 0,
                vencido: 0,
                parcelas_vencidas: 0,
                parcelas_abertas: 0,
                maior_atraso: 0
              },
              {
                carteira_id: 'k3',
                valor_original: 2000,
                recebido: 0,
                a_receber: 2000,
                vencido: 0,
                parcelas_vencidas: 0,
                parcelas_abertas: 2,
                proximo_vencimento: dias(10),
                maior_atraso: 0
              }
            ];
      if (r[1] === 'a1_fin_carteira_parcelas') {
        if (args.p_data && args.p_data !== HOJE)
          return PARCELAS.map(p =>
            p.id === 'p2' ? { ...p, calc: { ...p.calc, dias_atraso: 10, juros: 3.37, total: 1033.57 } } : p
          );
        return PARCELAS;
      }
      if (r[1] === 'a1_fin_extrato_sugestoes')
        return args.p_item === 'e2'
          ? [
              {
                tipo: 'parcela',
                id: 'p2',
                descricao: 'Parcela 2 · Mensal · Lia ' + XSS,
                data: dias(-15),
                valor: 1035.25,
                status: 'aberta',
                dias: 15,
                versao: 1
              }
            ]
          : [];
      if (r[1] === 'a1_fin_extrato_importar') return { ok: true, itens: 2, novos: 2, repetidos: 0 };
      if (r[1] === 'a1_fin_extrato_conciliar_auto') return { ok: true, conciliados: 1 };
      if (r[1] === 'a1_fin_carteira_importar') return { ok: true, carteiras: 2 };
      if (r[1] === 'a1_fin_carteira_salvar') return { ok: true, id: 'k9' };
      if (r[1] === 'a1_fin_renegociar') return { ok: true, novas: 3 };
      if (r[1] === 'a1_fin_orcamento_salvar') return { ok: true, valores: 2 };
      if (r[1] === 'a1_fin_dre')
        return [
          {
            grupo: 'receita',
            categoria_id: 'cat1',
            categoria: 'Venda de unidade',
            mes: `${MES}-01`,
            realizado: 12900,
            orcado: 50000
          },
          {
            grupo: 'deducao',
            categoria_id: 'cat2',
            categoria: 'Impostos',
            mes: `${MES}-01`,
            realizado: 300,
            orcado: 0
          },
          {
            grupo: 'despesa',
            categoria_id: 'cat3',
            categoria: 'Aluguel ' + XSS,
            mes: `${MES}-01`,
            realizado: 3500,
            orcado: 3500
          },
          {
            grupo: 'financeira_receita',
            categoria_id: 'cat4',
            categoria: 'Rendimentos',
            mes: `${MES}-01`,
            realizado: 100,
            orcado: 0
          }
        ];
      return { ok: true };
    }
    if (/rest\/v1\/a1_developments\?/.test(url) && metodo === 'GET')
      return [
        { id: 'emp1', name: 'Residencial Sol' },
        { id: 'emp2', name: 'Torre ' + XSS }
      ];
    const m = url.match(/rest\/v1\/(a1_fin_[a-z_]+)/);
    if (!m) return undefined;
    if (metodo === 'GET') {
      est.lidas.push(url);
      let l = tab[m[1]] || [];
      if (m[1] === 'a1_fin_extrato_itens')
        l = l.filter(i =>
          /status=eq\.pendente/.test(url) ? i.status === 'pendente' : i.status !== 'pendente'
        );
      if (m[1] === 'a1_fin_carteiras' && /id=eq\./.test(url))
        l = l.filter(c => url.includes(`id=eq.${c.id}`));
      return l;
    }
    est.escritas.push({ tabela: m[1], metodo, url, corpo: corpo ? JSON.parse(corpo) : null });
    const c = JSON.parse(corpo || '{}');
    return Array.isArray(c) ? c : [{ id: 'novo1', ...c }];
  };
  return { est, antes };
}
const texto = p => p.textContent('#lc-conteudo');
const modal = p => p.textContent('#lc-modal-corpo');
const vista = async (p, v) => {
  await p.click(`.sb-sub-item[data-vista="${v}"]`);
  await p.waitForTimeout(250);
};
const salvar = async p => {
  await p.click('#lc-modal-ok');
  await p.waitForTimeout(450);
};
// FIN_FOTOS=<pasta>: tira um print de cada tela para conferir o visual.
const foto = (p, nome) =>
  process.env.FIN_FOTOS
    ? p.screenshot({ path: `${process.env.FIN_FOTOS}/${nome}.png`, fullPage: true })
    : null;
const ultimo = (est, fn) => [...est.rpc].reverse().find(r => r.fn === fn);

(async () => {
  const todos = [];

  console.log('== Carteira desligada ==');
  {
    const { antes } = banco({ desligada: true });
    const { b, p, erros } = await abrir('thecred/financeiro?vista=carteira', {
      antes,
      modulos: ['financeiro']
    });
    await p.waitForSelector('#lc-conteudo .fn-aviso');
    const t = await texto(p);
    checa('aviso de carteira desligada', /carteira de recebíveis está desligada/.test(t));
    checa(
      'sem importar nem carteira à mão',
      (await p.$$('[data-acao="fnCartImportar"],[data-acao="fnCartNova"]')).length === 0
    );
    await p.click('#lc-conteudo [data-acao="fnVista"][data-vista="cadastros"]');
    await p.waitForTimeout(250);
    checa('o aviso leva a Cadastros', /Carteira de recebíveis/.test(await texto(p)));
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Carteira ==');
  const { est, antes } = banco();
  const { b, p, erros } = await abrir('thecred/financeiro?vista=carteira', {
    antes,
    modulos: ['financeiro']
  });
  await p.waitForSelector('#lc-conteudo .lc-kpis');
  await foto(p, 'carteira');
  let t = await texto(p);
  checa(
    'KPI: a receber das ativas (152.020 + 2.000)',
    /A receber \(valor de hoje\)[\s\S]*154\.020,00/.test(t),
    t.slice(0, 300)
  );
  checa('KPI: vencido 1.010 com 1 cliente em atraso', /Vencido[\s\S]*1\.010,00[\s\S]*1 cliente/.test(t));
  checa(
    'lista: CR-0001 e CR-0003 ativas, quitada fora do filtro padrão',
    /CR-0001/.test(t) && /CR-0003/.test(t) && !/CR-0002/.test(t)
  );
  checa('carteira sem telefone/lembrete marcada', /sem lembrete/.test(t));
  await p.selectOption('#fn-f-cart', 'vencidas');
  await p.waitForTimeout(150);
  t = await texto(p);
  checa('filtro "com parcela vencida": só CR-0001', /CR-0001/.test(t) && !/CR-0003/.test(t));
  await p.selectOption('#fn-f-cart', 'todas');
  await p.waitForTimeout(150);
  checa('filtro "todas" mostra a quitada', /CR-0002/.test(await texto(p)));

  await p.click('[data-acao="fnCartAbrir"][data-id="k1"]');
  await p.waitForTimeout(400);
  let f = await modal(p);
  checa(
    'ficha: índices, chaves e WhatsApp formatado',
    /INCC-DI até as chaves, depois IGP-M \+ 1% a\.m\./.test(f) &&
      /chaves 30\/06\/2027/.test(f) &&
      /\(98\) 98123-4567/.test(f),
    f.slice(0, 300)
  );
  checa(
    'ficha: parcela vencida com correção, encargos e total do dia',
    /15 dia\(s\) de atraso/.test(f) && /25,25/.test(f) && /1\.035,25/.test(f)
  );
  checa('ficha: parcela do banco sem caixa de renegociar', (await p.$$('.fn-reneg')).length === 2);
  checa('ficha: último lembrete aparece', /lembrete D\+1 enviado/.test(f));
  await foto(p, 'ficha');
  checa(
    'carteira da venda: sem botão de distrato',
    (await p.$$('[data-acao="fnCartEncerrar"]')).length === 0
  );

  await p.click('[data-acao="fnCartReceber"][data-id="p2"]');
  await p.waitForTimeout(200);
  checa('receber: mostra o valor do dia', /Valor a receber[\s\S]*1\.035,25/.test(await modal(p)));
  await p.fill('#fp-data', dias(-5));
  await p.dispatchEvent('#fp-data', 'change');
  await p.waitForTimeout(350);
  checa(
    'outra data: o banco recalcula',
    /Valor a receber[\s\S]*1\.033,57/.test(await modal(p)) &&
      ultimo(est, 'a1_fin_carteira_parcelas').args.p_data === dias(-5)
  );
  await p.fill('#fp-desc', '3,57');
  await p.dispatchEvent('#fp-desc', 'change');
  await p.waitForTimeout(300);
  await p.selectOption('#fp-conta', 'ct2');
  await salvar(p);
  let rb = ultimo(est, 'a1_fin_parcela_baixar');
  checa(
    'baixa: valor do dia menos o desconto, data, conta e versão',
    rb &&
      rb.args.p_valor === 1030 &&
      rb.args.p_desconto === 3.57 &&
      rb.args.p_pago_em === dias(-5) &&
      rb.args.p_conta === 'ct2' &&
      rb.args.p_versao === 1,
    JSON.stringify(rb && rb.args)
  );
  await p.waitForTimeout(400);
  checa('depois da baixa a ficha reabre', /CR-0001/.test(await p.textContent('#lc-modal-titulo')));

  await p.click('[data-acao="fnCartEstornar"][data-id="p1"]');
  await p.waitForTimeout(500);
  rb = ultimo(est, 'a1_fin_parcela_estornar');
  checa('estorno com a versão da parcela', rb && rb.args.p_parcela === 'p1' && rb.args.p_versao === 2);

  await p.waitForSelector('.fn-reneg');
  await p.click('[data-acao="fnCartRenegociar"]');
  await p.waitForTimeout(200);
  checa(
    'renegociar sem marcar avisa e não abre',
    /Marque as parcelas/.test(await p.textContent('#lc-toasts'))
  );
  await p.check('.fn-reneg[value="p2"]');
  await p.check('.fn-reneg[value="p3"]');
  await p.click('[data-acao="fnCartRenegociar"]');
  await p.waitForTimeout(200);
  checa('renegociar: soma o valor de hoje das marcadas', /2\.045,25/.test(await modal(p)));
  await p.fill('#fr-qtd', '3');
  await p.fill('#fr-valor', '700');
  await salvar(p);
  checa(
    'sem motivo não renegocia',
    /motivo/i.test(await p.textContent('#lc-modal-erro')) && !ultimo(est, 'a1_fin_renegociar')
  );
  await p.fill('#fr-motivo', 'Acordo ' + XSS);
  await salvar(p);
  rb = ultimo(est, 'a1_fin_renegociar');
  checa(
    'renegociação: parcelas, novas e motivo',
    rb &&
      rb.args.p_carteira === 'k1' &&
      rb.args.p_parcelas.join() === 'p2,p3' &&
      rb.args.p_novas[0].quantidade === 3 &&
      rb.args.p_novas[0].valor === 700,
    JSON.stringify(rb && rb.args)
  );
  await p.waitForTimeout(400);
  await p.click('#lc-modal-pe [data-acao="fnFechar"]');

  await p.click('[data-acao="fnCartAbrir"][data-id="k3"]');
  await p.waitForTimeout(400);
  await p.click('[data-acao="fnCartEncerrar"]');
  await p.fill('#fe-motivo', 'Erro de digitação');
  await salvar(p);
  rb = ultimo(est, 'a1_fin_carteira_encerrar');
  checa(
    'carteira à mão: distrato com motivo e versão',
    rb && rb.args.p_carteira === 'k3' && rb.args.p_versao === 1
  );

  await p.click('[data-acao="fnCartImportar"]');
  await p.waitForTimeout(400);
  checa(
    'importar vendas chama o banco e conta',
    !!ultimo(est, 'a1_fin_carteira_importar') && /2 carteira/.test(await p.textContent('#lc-toasts'))
  );

  await p.click('[data-acao="fnCartNova"]');
  await p.fill('#fc-cliente', 'Caio ' + XSS);
  await p.fill('#fc-tel', '(98) 98111-2222');
  await p.selectOption('#fc-emp', 'emp1');
  await p.fill('#fc-unid', '101');
  await p.fill('#fc-base', '2026-01-01');
  await p.selectOption('#fc-ipos', 'IPCA');
  await p.fill('.fn-serie .fs-qtd', '3');
  await p.fill('.fn-serie .fs-valor', '1.000,50');
  await p.fill('.fn-serie .fs-venc', '2026-01-31');
  await p.click('[data-acao="fnCartLinhaMais"]');
  await p.selectOption('.fn-serie:nth-child(2) .fs-serie', 'FINANCIAMENTO');
  await p.selectOption('.fn-serie:nth-child(2) .fs-quem', 'BANCO');
  await p.fill('.fn-serie:nth-child(2) .fs-valor', '150000');
  await p.fill('.fn-serie:nth-child(2) .fs-venc', '2027-06-30');
  await salvar(p);
  rb = ultimo(est, 'a1_fin_carteira_salvar');
  const pc = rb ? rb.args.p_parcelas : [];
  checa(
    'carteira à mão: 3 mensais mês a mês (31 vira o fim do mês) + financiamento do banco',
    pc.length === 4 &&
      pc[0].vencimento === '2026-01-31' &&
      pc[1].vencimento === '2026-02-28' &&
      pc[2].vencimento === '2026-03-31' &&
      pc[0].valor === 1000.5 &&
      pc[3].quem_paga === 'BANCO',
    JSON.stringify(pc)
  );
  checa(
    'carteira à mão: empreendimento, unidade, índice e telefone',
    rb &&
      rb.args.p_id === null &&
      rb.args.p_dados.empreendimento_id === 'emp1' &&
      rb.args.p_dados.empreendimento === 'Residencial Sol' &&
      rb.args.p_dados.indice_pos === 'IPCA' &&
      rb.args.p_dados.telefone === '(98) 98111-2222',
    JSON.stringify(rb && rb.args.p_dados)
  );
  await p.waitForTimeout(400);
  await p.click('#lc-modal-pe [data-acao="fnFechar"]').catch(() => {});

  console.log('\n== Conciliação ==');
  await vista(p, 'conciliacao');
  t = await texto(p);
  checa(
    'pendentes: 2, com entradas e saídas',
    /Pendentes[\s\S]*2[\s\S]*1\.035,25[\s\S]*35,90/.test(t),
    t.slice(0, 300)
  );
  checa('último extrato importado aparece', /3 nova\(s\) de 40/.test(t));
  await foto(p, 'conciliacao');
  await p.selectOption('#fn-f-ext', 'conciliado');
  await p.waitForTimeout(150);
  checa('conciliada mostra o lançamento ligado', /Honorário/.test(await texto(p)));
  await p.click('[data-acao="fnExtDesfazer"][data-id="e3"]');
  await p.waitForTimeout(400);
  checa('desfazer chama o banco', ultimo(est, 'a1_fin_extrato_marcar').args.p_acao === 'desfazer');
  await p.selectOption('#fn-f-ext', 'pendente');
  await p.waitForTimeout(150);

  await p.click('[data-acao="fnExtAbrir"][data-id="e2"]');
  await p.waitForTimeout(350);
  checa('sugestão: a parcela da Lia com o valor do dia', /Parcela 2 · Mensal · Lia/.test(await modal(p)));
  await p.click('[data-acao="fnExtUsar"]');
  await p.waitForTimeout(400);
  rb = ultimo(est, 'a1_fin_extrato_conciliar');
  checa(
    'usar sugestão de parcela: item e parcela',
    rb && rb.args.p_item === 'e2' && rb.args.p_parcela === 'p2' && rb.args.p_lancamento === null
  );

  await p.click('[data-acao="fnExtAbrir"][data-id="e1"]');
  await p.waitForTimeout(350);
  checa('sem sugestão: diz que não há par', /Nenhum lançamento ou parcela/.test(await modal(p)));
  await p.click('#lc-modal-corpo [data-acao="fnExtCriar"]');
  await p.selectOption('#fx-cat', 'cat3');
  await p.selectOption('#fx-centro', 'cc1');
  await salvar(p);
  rb = ultimo(est, 'a1_fin_extrato_criar_lancamento');
  checa(
    'criar lançamento: só despesas na lista, categoria e centro',
    rb && rb.args.p_categoria === 'cat3' && rb.args.p_centro === 'cc1'
  );
  await p.click('[data-acao="fnExtIgnorar"][data-id="e1"]');
  await p.waitForTimeout(400);
  checa('ignorar chama o banco', ultimo(est, 'a1_fin_extrato_marcar').args.p_acao === 'ignorar');
  await p.click('[data-acao="fnExtAuto"]');
  await p.waitForTimeout(400);
  checa('automático por conta', ultimo(est, 'a1_fin_extrato_conciliar_auto').args.p_conta === 'ct1');

  // OFX em SGML, Windows-1252, com acento, valor com vírgula e sem FITID numa linha
  const ofx = Buffer.from(
    [
      'OFXHEADER:100',
      'DATA:OFXSGML',
      'CHARSET:1252',
      '',
      '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>001<ACCTID>12345-6</BANKACCTFROM>',
      '<BANKTRANLIST><DTSTART>20261101<DTEND>20261125',
      '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261120120000[-3:BRT]<TRNAMT>-35,90<FITID>A1<MEMO>TARIFA MANUTENÇÃO &amp; CIA',
      '</STMTTRN>',
      '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261121<TRNAMT>1500.00<NAME>FULANO</STMTTRN>',
      '<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20261399<TRNAMT>1<FITID>X</STMTTRN>',
      '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'
    ].join('\r\n'),
    'latin1'
  );
  await p.click('[data-acao="fnExtImportar"]');
  await p.setInputFiles('#fx-arquivo', { name: 'extrato.ofx', mimeType: 'application/x-ofx', buffer: ofx });
  await p.waitForTimeout(400);
  f = await modal(p);
  checa(
    'prévia: 2 transações válidas (data inválida fora), conta e totais',
    /2 transação/.test(f) && /12345-6/.test(f) && /1\.500,00/.test(f),
    f.slice(0, 300)
  );
  checa('prévia: acento do Windows-1252 certo', /TARIFA MANUTENÇÃO & CIA/.test(f));
  await salvar(p);
  rb = ultimo(est, 'a1_fin_extrato_importar');
  const it = rb ? rb.args.p_itens : [];
  checa(
    'importar: data, valor com sinal, FITID e descrição',
    it.length === 2 &&
      it[0].data === '2026-11-20' &&
      it[0].valor === -35.9 &&
      it[0].fitid === 'A1' &&
      it[1].valor === 1500 &&
      it[1].fitid === '' &&
      it[1].descricao === 'FULANO' &&
      rb.args.p_arquivo === 'extrato.ofx',
    JSON.stringify(rb && rb.args)
  );
  await p.click('[data-acao="fnExtImportar"]');
  await p.setInputFiles('#fx-arquivo', {
    name: 'nada.ofx',
    mimeType: 'text/plain',
    buffer: Buffer.from('isto não é ofx')
  });
  await p.waitForTimeout(300);
  checa('arquivo que não é OFX: avisa', /não parece um OFX/.test(await modal(p)));
  await p.click('#lc-modal-pe [data-acao="fnFechar"]');

  console.log('\n== DRE ==');
  await vista(p, 'dre');
  await p.waitForSelector('.fn-dre');
  t = await texto(p);
  checa(
    'DRE pede o ano até hoje, por caixa',
    ultimo(est, 'a1_fin_dre').args.p_inicio === `${ANO}-01-01` &&
      ultimo(est, 'a1_fin_dre').args.p_regime === 'caixa'
  );
  checa('receita líquida 12.600', /Receita líquida[\s\S]*12\.600,00/.test(t), t.slice(0, 400));
  checa('resultado líquido 9.200 (12.900 − 300 − 3.500 + 100)', /Resultado líquido[\s\S]*9\.200,00/.test(t));
  checa('orçado ao lado (26%)', /50\.000,00/.test(t) && /26%/.test(t));
  checa('despesa aparece negativa', (await p.$$('.fn-dre td.fn-saida')).length > 0);
  await foto(p, 'dre');
  await p.selectOption('#fn-f-regime', 'competencia');
  await p.waitForTimeout(350);
  await p.selectOption('#fn-f-centro', 'cc1');
  await p.waitForTimeout(350);
  rb = ultimo(est, 'a1_fin_dre');
  checa(
    'trocar regime e centro chama o banco de novo',
    rb.args.p_regime === 'competencia' && rb.args.p_centro === 'cc1'
  );

  await p.click('[data-acao="fnDreOrcamento"]');
  await p.waitForTimeout(400);
  checa(
    'orçamento: valor salvo aparece na célula',
    (await p.inputValue('#fo-centro')) === 'cc1' ||
      (await p.inputValue(`.fo-v[data-cat="cat3"][data-mes="01"]`)) !== null
  );
  await p.selectOption('#fo-centro', '');
  await p.waitForTimeout(400);
  checa(
    'orçamento sem centro: jan do aluguel = 3500',
    (await p.inputValue('.fo-v[data-cat="cat3"][data-mes="01"]')) === '3500'
  );
  await p.fill('.fo-v[data-cat="cat1"][data-mes="03"]', '40.000,00');
  await p.fill('.fo-v[data-cat="cat3"][data-mes="01"]', '');
  await salvar(p);
  rb = ultimo(est, 'a1_fin_orcamento_salvar');
  checa(
    'orçamento grava só o que mudou (novo e zerado)',
    rb &&
      rb.args.p_centro === null &&
      rb.args.p_valores.length === 2 &&
      rb.args.p_valores.some(v => v.categoria === 'cat1' && v.mes === `${ANO}-03-01` && v.valor === 40000) &&
      rb.args.p_valores.some(v => v.categoria === 'cat3' && v.valor === 0),
    JSON.stringify(rb && rb.args)
  );

  console.log('\n== Cadastros ==');
  await vista(p, 'cadastros');
  t = await texto(p);
  checa(
    'categoria mostra o grupo do DRE',
    /Impostos[\s\S]*Deduções/.test(t) && /Rendimentos[\s\S]*Receitas financeiras/.test(t)
  );
  await p.click('[data-acao="fnEditarCategoria"][data-id="cat3"]');
  await p.selectOption('#fa-grupo', 'nao_operacional');
  await salvar(p);
  let w = est.escritas.filter(x => x.tabela === 'a1_fin_categorias').pop();
  checa('categoria grava o grupo do DRE', w && w.corpo.grupo_dre === 'nao_operacional');
  await p.click('[data-acao="fnCentrosEmp"]');
  await p.waitForTimeout(400);
  w = est.escritas.filter(x => x.tabela === 'a1_fin_centros').pop();
  checa(
    'um centro por empreendimento: só o que falta (Torre)',
    w && Array.isArray(w.corpo) && w.corpo.length === 1 && w.corpo[0].empreendimento_id === 'emp2'
  );

  await p.check('#fk-lembra');
  await p.fill('#fk-corpo', '');
  await p.click('[data-acao="fnCartSalvarCfg"]');
  await p.waitForTimeout(300);
  checa('lembrete ligado sem texto é recusado', /Escreva o texto/.test(await p.textContent('#lc-toasts')));
  await p.click('[data-acao="fnCartModelos"]');
  await p.waitForTimeout(300);
  checa(
    'modelos: só os aprovados',
    (await p.$$('#fk-escolha option')).length === 2 && est.edge.some(e => e.action === 'wa_modelos')
  );
  await p.selectOption('#fk-escolha', '0');
  await p.waitForTimeout(100);
  checa(
    'escolher o modelo preenche nome e texto',
    (await p.inputValue('#fk-nome')) === 'lembrete_parcela' &&
      /\{\{2\}\}/.test(await p.inputValue('#fk-corpo'))
  );
  await p.fill('#fk-nome', 'Nome Inválido');
  await p.click('[data-acao="fnCartSalvarCfg"]');
  await p.waitForTimeout(300);
  checa(
    'nome de modelo fora do padrão da Meta é recusado',
    /Nome do modelo/.test(await p.textContent('#lc-toasts'))
  );
  await p.fill('#fk-nome', 'lembrete_parcela');
  await p.check('.fk-dia[value="15"]');
  await p.click('[data-acao="fnCartSalvarCfg"]');
  await p.waitForTimeout(400);
  w = est.escritas.filter(x => x.tabela === 'a1_fin_config').pop();
  checa(
    'config da carteira: ligada, lembrete, dias e modelo',
    w &&
      w.corpo.carteira_ativa === true &&
      w.corpo.lembrete_ativo === true &&
      w.corpo.lembrete_dias.join() === '-3,0,1,7,15' &&
      w.corpo.lembrete_modelo.nome === 'lembrete_parcela' &&
      /on_conflict=tenant_id/.test(w.url),
    JSON.stringify(w && w.corpo)
  );
  await p.click('[data-acao="fnCartCfgEmp"][data-id="emp1"]');
  await p.fill('#fc-chaves', '2027-06-30');
  await p.selectOption('#fc-iobra', 'INCCM');
  await p.fill('#fc-multa', '20');
  await salvar(p);
  checa('multa acima de 10% é recusada', /percentuais/.test(await p.textContent('#lc-modal-erro')));
  await p.fill('#fc-multa', '2');
  await salvar(p);
  w = est.escritas.filter(x => x.tabela === 'a1_fin_carteira_cfg').pop();
  checa(
    'correção do empreendimento: upsert com chaves e índice',
    w &&
      w.corpo.empreendimento_id === 'emp1' &&
      w.corpo.indice_obra === 'INCCM' &&
      w.corpo.data_chaves === '2027-06-30' &&
      /on_conflict=tenant_id,empreendimento_id/.test(w.url)
  );

  await vista(p, 'pagar');
  await p.click('[data-acao="fnNovoLanc"]');
  await p.fill('#fl-desc', 'Material de obra');
  await p.fill('#fl-valor', '900');
  await p.selectOption('#fl-centro', 'cc1');
  await salvar(p);
  w = est.escritas.filter(x => x.tabela === 'a1_fin_lancamentos').pop();
  checa('lançamento com centro de custo', w && Array.isArray(w.corpo) && w.corpo[0].centro_id === 'cc1');

  checa('XSS: nada executou', (await p.evaluate(() => window.__XSS)) === 0);
  await b.close();
  todos.push(...erros);
  process.exit(resumo(todos) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
