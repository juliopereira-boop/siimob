// Módulo Financeiro (/:slug/financeiro).
//
// O que este arquivo prova:
//   - sem a licença a tela não lê nada e a aba não aparece;
//   - gestor (a1_fin_iniciar passa): onze vistas (três da fase 2), painel com saldo, vencidos e
//     comissões a pagar por pessoa;
//   - negócio: ficha com comissões, recalcular, cancelar com motivo, negócio
//     à mão com participantes (pessoa cadastrada ou nome livre);
//   - comissões: liberar agora; contas: baixa (inclusive parcial), estorno com
//     versão, cancelar manual, parcelado divide em centavos sem perder nada;
//   - regras: o formulário não deixa "receber" ter base na própria comissão;
//   - cadastros: etapas do Repasse/Registro, conta padrão, contas;
//   - parceiro (a1_fin_iniciar recusa): só "Minhas comissões", sem ler tabela;
//   - nada vira HTML (XSS).
const { abrir, checa, resumo } = require('./comum');

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';
const HOJE = new Date().toISOString().slice(0, 10);
const ontem = (() => {
  const d = new Date(HOJE + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 3);
  return d.toISOString().slice(0, 10);
})();

function banco(opc = {}) {
  const est = { escritas: [], rpc: [], lidas: [] };
  const tab = {
    a1_fin_config: [
      {
        tenant_id: 't1',
        etapa_repasse: null,
        etapa_registro: null,
        prazo_receber_dias: 30,
        conta_padrao: 'ct1'
      }
    ],
    a1_fin_contas: [
      {
        id: 'ct1',
        nome: 'Caixa',
        tipo: 'caixa',
        saldo_inicial: 1000,
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
      { id: 'cat1', nome: 'Comissão de venda', tipo: 'receita', chave: 'comissao_venda', ativo: true },
      { id: 'cat2', nome: 'Comissões pagas', tipo: 'despesa', chave: 'comissao_paga', ativo: true },
      { id: 'cat3', nome: 'Aluguel ' + XSS, tipo: 'despesa', chave: null, ativo: true }
    ],
    a1_fin_negocios: [
      {
        id: 'ng1',
        seq: 1,
        origem: 'comercial',
        descricao: 'Venda ' + XSS,
        cliente_nome: 'Lia',
        empreendimento: 'Residencial Sol',
        unidade: '302',
        valor: 500000,
        data: HOJE,
        status: 'ativo'
      },
      {
        id: 'ng2',
        seq: 2,
        origem: 'crm',
        descricao: 'Lead ganho',
        valor: 300000,
        data: HOJE,
        status: 'cancelado',
        motivo_cancelamento: 'Saiu do Ganho'
      }
    ],
    a1_fin_participantes: [
      { id: 'pp1', negocio_id: 'ng1', papel: 'corretor', partner_id: 'pa1', nome: 'Ana ' + XSS },
      { id: 'pp2', negocio_id: 'ng1', papel: 'coordenador', partner_id: 'pa4', nome: 'Diego' }
    ],
    a1_fin_regras: [
      {
        id: 'r1',
        nome: 'Empresa 5%',
        ativo: true,
        direcao: 'receber',
        papel: 'empresa',
        origem: 'todas',
        base: 'valor',
        tipo_calculo: 'percentual',
        percentual: 5,
        imposto_pct: 0,
        liberacao: 'recebimento',
        prioridade: 0
      },
      {
        id: 'r2',
        nome: 'Corretor 40% ' + XSS,
        ativo: true,
        direcao: 'pagar',
        papel: 'corretor',
        origem: 'todas',
        base: 'comissao_empresa',
        tipo_calculo: 'percentual',
        percentual: 40,
        imposto_pct: 0,
        liberacao: 'recebimento',
        prioridade: 0
      }
    ],
    a1_fin_comissoes: [
      {
        id: 'c1',
        negocio_id: 'ng1',
        regra_nome: 'Empresa 5%',
        direcao: 'receber',
        papel: 'empresa',
        beneficiario: 'Construtora',
        base_valor: 500000,
        percentual: 5,
        imposto_pct: 0,
        valor: 25000,
        liberacao: 'recebimento',
        status: 'liberada',
        valor_liberado: 25000,
        valor_pago: 10000
      },
      {
        id: 'c2',
        negocio_id: 'ng1',
        regra_nome: 'Corretor 40%',
        direcao: 'pagar',
        papel: 'corretor',
        partner_id: 'pa1',
        beneficiario: 'Ana ' + XSS,
        base_valor: 25000,
        percentual: 40,
        imposto_pct: 0,
        valor: 10000,
        liberacao: 'recebimento',
        status: 'liberada',
        valor_liberado: 4000,
        valor_pago: 0
      },
      {
        id: 'c3',
        negocio_id: 'ng1',
        regra_nome: 'Coord 5%',
        direcao: 'pagar',
        papel: 'coordenador',
        partner_id: 'pa4',
        beneficiario: 'Diego',
        base_valor: 25000,
        percentual: 5,
        imposto_pct: 0,
        valor: 1250,
        liberacao: 'recebimento',
        status: 'liberada',
        valor_liberado: 500,
        valor_pago: 0
      }
    ],
    a1_fin_lancamentos: [
      {
        id: 'l1',
        tipo: 'receber',
        descricao: 'Comissão NG-0001',
        categoria_id: 'cat1',
        valor: 10000,
        vencimento: HOJE,
        status: 'pago',
        pago_em: HOJE,
        valor_pago: 10000,
        conta_id: 'ct1',
        origem: 'comissao',
        negocio_id: 'ng1',
        comissao_id: 'c1',
        versao: 2
      },
      {
        id: 'l2',
        tipo: 'receber',
        descricao: 'Comissão NG-0001 (resto)',
        categoria_id: 'cat1',
        valor: 15000,
        vencimento: HOJE,
        status: 'aberto',
        origem: 'comissao',
        negocio_id: 'ng1',
        comissao_id: 'c1',
        versao: 1,
        pessoa: 'Construtora'
      },
      {
        id: 'l3',
        tipo: 'pagar',
        descricao: 'Comissão corretor · Ana',
        categoria_id: 'cat2',
        valor: 4000,
        vencimento: HOJE,
        status: 'aberto',
        origem: 'comissao',
        negocio_id: 'ng1',
        comissao_id: 'c2',
        versao: 1,
        pessoa: 'Ana ' + XSS
      },
      {
        id: 'l4',
        tipo: 'pagar',
        descricao: 'Aluguel do escritório ' + XSS,
        categoria_id: 'cat3',
        valor: 3500,
        vencimento: ontem,
        status: 'aberto',
        origem: 'manual',
        versao: 1
      }
    ]
  };
  const antes = (url, metodo, corpo) => {
    const r = url.match(/rpc\/(a1_fin_[a-z_]+)/);
    if (r) {
      const args = JSON.parse(corpo || '{}');
      est.rpc.push({ fn: r[1], args });
      if (r[1] === 'a1_fin_iniciar')
        return opc.parceiro
          ? { __status: 400, corpo: { code: 'P0001', message: 'sem_permissao' } }
          : { ok: true };
      if (r[1] === 'a1_fin_minhas_comissoes')
        return [
          {
            id: 'c2',
            negocio: 'NG-0001',
            descricao: 'Venda ' + XSS,
            data: HOJE,
            papel: 'corretor',
            regra: 'Corretor 40%',
            base_valor: 25000,
            percentual: 40,
            valor: 10000,
            liberacao: 'recebimento',
            status: 'liberada',
            valor_liberado: 4000,
            valor_pago: 0
          },
          {
            id: 'c9',
            negocio: 'NG-0005',
            descricao: 'Outra',
            data: HOJE,
            papel: 'corretor',
            regra: 'Corretor 40%',
            base_valor: 5000,
            percentual: 40,
            valor: 2000,
            liberacao: 'recebimento',
            status: 'paga',
            valor_liberado: 2000,
            valor_pago: 2000
          }
        ];
      if (r[1] === 'a1_fin_recalcular') return { ok: true, comissoes: 3 };
      if (r[1] === 'a1_fin_salvar_negocio') return { ok: true, id: 'ng9', comissoes: 2 };
      if (r[1] === 'a1_fin_cancelar_negocio') return { ok: true, comissoes_pagas: 0 };
      if (r[1] === 'a1_fin_liberar_comissao') return { ok: true, valor: 6000 };
      return { ok: true };
    }
    const m = url.match(/rest\/v1\/(a1_fin_[a-z_]+)/);
    if (!m) {
      if (/rest\/v1\/a1_partners\?select=id,name,type/.test(url) && metodo === 'GET')
        return [
          { id: 'pa1', name: 'Ana ' + XSS, type: 'corretor' },
          { id: 'pa2', name: 'Bruno', type: 'corretor' }
        ];
      if (/rest\/v1\/a1_stages\?select=id,name,module_key/.test(url) && metodo === 'GET')
        return [
          { id: 'st1', name: 'Contrato assinado', module_key: 'repasse', position: 3 },
          { id: 'st2', name: 'Registrado', module_key: 'registro', position: 5 }
        ];
      return undefined;
    }
    if (metodo === 'GET') {
      est.lidas.push(m[1]);
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
    const { b, p, erros } = await abrir('thecred/financeiro', { antes, modulos: [] });
    checa('nada lido nem chamado', est.lidas.length === 0 && est.rpc.length === 0, est.lidas.join(','));
    checa('saiu da tela', !/\/financeiro/.test(p.url()), p.url());
    checa('sem aba Financeiro', (await p.$$('a.sb-mod[href*="financeiro"]')).length === 0);
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Parceiro (só as dele) ==');
  {
    const { est, antes } = banco({ parceiro: true });
    const { b, p, erros } = await abrir('thecred/financeiro', {
      antes,
      modulos: ['financeiro'],
      usuario: { id: 'pa1', tenant_id: 't1', name: 'Ana', role: 'partner', type: 'corretor', cpf: '1' }
    });
    await p.waitForSelector('.lc-kpis');
    checa('vê a aba Financeiro', (await p.$$('a.sb-mod[href*="financeiro"]')).length === 1);
    checa('uma vista só: Minhas comissões', (await p.$$('.sb-sub-item[data-acao="fnVista"]')).length === 1);
    checa('não lê as tabelas do Financeiro', est.lidas.length === 0, est.lidas.join(','));
    const t = await texto(p);
    checa(
      'extrato: liberado a receber 4.000, recebido 2.000, previsto 6.000',
      /Previsto[\s\S]*6\.000,00/.test(t) &&
        /Liberado a receber[\s\S]*4\.000,00/.test(t) &&
        /Recebido[\s\S]*2\.000,00/.test(t),
      t.slice(0, 300)
    );
    checa(
      'nenhum botão de gestão',
      (await p.$$('[data-acao="fnNovoNegocio"],[data-acao="fnBaixar"]')).length === 0
    );
    checa('XSS: nada executou', (await p.evaluate(() => window.__XSS)) === 0);
    await b.close();
    todos.push(...erros.filter(e => !/status of 400/.test(e)));
  }

  console.log('\n== Gestor ==');
  const { est, antes } = banco();
  const { b, p, erros } = await abrir('thecred/financeiro', { antes, modulos: ['financeiro'] });
  await p.waitForSelector('.lc-kpis');
  checa('onze vistas na sub-barra', (await p.$$('.sb-sub-item[data-acao="fnVista"]')).length === 11);
  checa('a1_fin_iniciar prepara o Financeiro ao abrir', est.rpc[0] && est.rpc[0].fn === 'a1_fin_iniciar');
  const painel = await texto(p);
  // saldo: Caixa 1.000 + 10.000 recebidos; Banco 0
  checa(
    'painel: saldo em contas 11.000',
    /Saldo em contas[\s\S]*11\.000,00/.test(painel),
    painel.slice(0, 300)
  );
  checa(
    'painel: comissões a pagar 4.000 e por pessoa',
    /Comissões a pagar[\s\S]*4\.000,00/.test(painel) && /Comissões a pagar por pessoa[\s\S]*Ana/.test(painel)
  );
  checa('painel: aluguel vencido a pagar', /Vencido a pagar[\s\S]*Aluguel do escritório/.test(painel));
  checa('painel: sem aviso de regras (já há regras)', (await p.$$('.fn-aviso')).length === 0);

  await vista(p, 'negocios');
  const tn = await texto(p);
  checa(
    'negócios: NG-0001 ativo e NG-0002 cancelado',
    /NG-0001/.test(tn) && /NG-0002/.test(tn) && /Cancelado/.test(tn)
  );
  checa('negócios: empresa recebe 25.000 e paga 11.250', /25\.000,00/.test(tn) && /11\.250,00/.test(tn));
  await p.click('[data-acao="fnAbrirNegocio"][data-id="ng1"]');
  const ficha = await p.textContent('#lc-modal-corpo');
  checa(
    'ficha: participantes e comissões com regra',
    /Diego/.test(ficha) && /Corretor 40%/.test(ficha) && /Construtora/.test(ficha)
  );
  checa(
    'ficha com pagamento: sem editar nem recalcular',
    (await p.$$('#lc-modal-corpo [data-acao="fnRecalcular"],#lc-modal-corpo [data-acao="fnEditarNegocio"]'))
      .length === 0
  );
  await p.click('#lc-modal-corpo [data-acao="fnLiberar"][data-id="c2"]');
  await p.waitForTimeout(400);
  checa(
    'liberar agora chama a função',
    est.rpc.some(r => r.fn === 'a1_fin_liberar_comissao' && r.args.p_comissao === 'c2')
  );
  await p.click('[data-acao="fnAbrirNegocio"][data-id="ng1"]');
  await p.click('#lc-modal-corpo [data-acao="fnCancelarNegocio"]');
  await p.fill('#fn-motivo', 'Distrato');
  await salvar(p);
  checa(
    'cancelar manda o motivo',
    est.rpc.some(
      r => r.fn === 'a1_fin_cancelar_negocio' && r.args.p_negocio === 'ng1' && r.args.p_motivo === 'Distrato'
    )
  );

  await p.click('[data-acao="fnNovoNegocio"]');
  await p.fill('#fn-desc', 'Venda direta ' + XSS);
  await p.fill('#fn-valor', '200.000,00');
  await p.selectOption('#fn-parts .fn-part .fp-parceiro', 'pa2');
  await p.click('[data-acao="fnPartMais"]');
  await p.selectOption('#fn-parts .fn-part:nth-child(2) .fp-papel', 'captador');
  await p.fill('#fn-parts .fn-part:nth-child(2) .fp-nome', 'Caio Captador');
  await salvar(p);
  const sn = est.rpc.find(r => r.fn === 'a1_fin_salvar_negocio');
  checa(
    'negócio à mão: valor, pessoa cadastrada e nome livre',
    sn &&
      sn.args.p_id === null &&
      sn.args.p_dados.valor === 200000 &&
      sn.args.p_participantes.length === 2 &&
      sn.args.p_participantes[0].partner_id === 'pa2' &&
      sn.args.p_participantes[1].papel === 'captador' &&
      sn.args.p_participantes[1].nome === 'Caio Captador',
    JSON.stringify(sn && sn.args)
  );

  await vista(p, 'comissoes');
  const tc = await texto(p);
  checa(
    'comissões a pagar: Ana e Diego com a regra',
    /Corretor 40%/.test(tc) && /Diego/.test(tc) && !/Construtora/.test(tc)
  );
  await p.selectOption('#fn-f-direcao', 'receber');
  await p.waitForTimeout(100);
  checa('filtro "a receber" mostra a da empresa', /Construtora/.test(await texto(p)));

  await vista(p, 'receber');
  await p.click('[data-acao="fnBaixar"][data-id="l2"]');
  await p.fill('#fb-valor', '5000');
  await p.selectOption('#fb-conta', 'ct2');
  await salvar(p);
  const bx = est.rpc.find(r => r.fn === 'a1_fin_baixar');
  checa(
    'receber parcial: valor, conta, forma e versão',
    bx &&
      bx.args.p_lancamento === 'l2' &&
      bx.args.p_valor === 5000 &&
      bx.args.p_conta === 'ct2' &&
      bx.args.p_versao === 1,
    JSON.stringify(bx)
  );
  await p.click('[data-acao="fnBaixar"][data-id="l2"]');
  await p.fill('#fb-valor', '99999');
  await salvar(p);
  checa(
    'valor acima do lançamento é recusado na tela',
    /até o valor do lançamento/.test(await p.textContent('#lc-modal-erro'))
  );
  await p.click('[data-acao="fnFechar"]');
  await p.click('[data-acao="fnEstornar"][data-id="l1"]');
  await p.waitForTimeout(400);
  checa(
    'estornar manda a versão',
    est.rpc.some(r => r.fn === 'a1_fin_estornar' && r.args.p_lancamento === 'l1' && r.args.p_versao === 2)
  );

  await vista(p, 'pagar');
  checa('vencido aparece como Vencido', /Vencido/.test(await texto(p)));
  await p.click('[data-acao="fnCancelarLanc"][data-id="l4"]');
  await p.waitForTimeout(400);
  checa(
    'cancelar lançamento manual chama a função',
    est.rpc.some(r => r.fn === 'a1_fin_cancelar_lancamento' && r.args.p_lancamento === 'l4')
  );
  checa(
    'comissão (do sistema) não tem Editar nem Cancelar',
    (await p.$$('[data-acao="fnEditarLanc"][data-id="l3"],[data-acao="fnCancelarLanc"][data-id="l3"]'))
      .length === 0
  );
  await p.click('[data-acao="fnNovoLanc"]');
  await p.fill('#fl-desc', 'Software');
  await p.fill('#fl-valor', '1000');
  await p.selectOption('#fl-modo', 'parcelado');
  await p.fill('#fl-qtd', '3');
  await salvar(p);
  const parc = est.escritas.find(e => e.tabela === 'a1_fin_lancamentos' && e.metodo === 'POST');
  checa(
    'parcelado em 3: 333,34 + 333,33 + 333,33, um mês cada, mesmo grupo',
    parc &&
      parc.corpo.length === 3 &&
      parc.corpo.map(x => x.valor).join() === '333.34,333.33,333.33' &&
      parc.corpo[0].tipo === 'pagar' &&
      parc.corpo[2].parcela === 3 &&
      parc.corpo[0].grupo_id &&
      parc.corpo[0].grupo_id === parc.corpo[2].grupo_id &&
      parc.corpo[0].vencimento < parc.corpo[1].vencimento,
    JSON.stringify(parc && parc.corpo)
  );

  await vista(p, 'fluxo');
  checa(
    'fluxo: 12 meses e o mês atual marcado',
    (await p.$$('#lc-conteudo tbody tr')).length >= 12 && (await p.$$('.fn-mes-atual')).length === 1
  );
  checa('fluxo: saldo das contas', /Saldo das contas[\s\S]*Caixa[\s\S]*11\.000,00/.test(await texto(p)));

  await vista(p, 'regras');
  checa(
    'regras listadas, sem botão de modelo (já há regras)',
    /Empresa recebe/.test(await texto(p)) && (await p.$$('[data-acao="fnRegrasModelo"]')).length === 0
  );
  await p.click('[data-acao="fnNovaRegra"]');
  await p.fill('#fr-nome', 'Banco paga 1%');
  await p.selectOption('#fr-papel', 'empresa');
  checa(
    '"empresa recebe": esconde parceiro, mostra quem paga e trava a base "comissão da empresa"',
    (await p.isHidden('#fr-par-w')) &&
      (await p.isVisible('#fr-pag')) &&
      (await p.$eval('#fr-base option[value="comissao_empresa"]', o => o.disabled))
  );
  await p.selectOption('#fr-base', 'valor_financiado');
  await p.fill('#fr-pct', '1');
  await p.fill('#fr-pag', 'Banco');
  await salvar(p);
  const rg = est.escritas.find(e => e.tabela === 'a1_fin_regras' && e.metodo === 'POST');
  checa(
    'regra gravada: receber, empresa, 1% do financiado, quem paga',
    rg &&
      rg.corpo.direcao === 'receber' &&
      rg.corpo.papel === 'empresa' &&
      rg.corpo.base === 'valor_financiado' &&
      rg.corpo.percentual === 1 &&
      rg.corpo.pagador === 'Banco' &&
      rg.corpo.partner_id === null,
    JSON.stringify(rg && rg.corpo)
  );

  await vista(p, 'cadastros');
  await p.selectOption('#fc-repasse', 'st1');
  await p.selectOption('#fc-registro', 'st2');
  await p.click('[data-acao="fnSalvarConfig"]');
  await p.waitForTimeout(400);
  const cfg = est.escritas.find(e => e.tabela === 'a1_fin_config');
  checa(
    'configuração: etapas do Repasse e do Registro (upsert por cliente)',
    cfg &&
      /on_conflict=tenant_id/.test(cfg.url) &&
      cfg.corpo.etapa_repasse === 'st1' &&
      cfg.corpo.etapa_registro === 'st2',
    JSON.stringify(cfg)
  );
  await p.click('[data-acao="fnNovaConta"]');
  await p.fill('#fo-nome', 'Itaú PJ');
  await p.fill('#fo-saldo', '2.500,00');
  await salvar(p);
  const ct = est.escritas.find(e => e.tabela === 'a1_fin_contas');
  checa('conta nova com saldo inicial', ct && ct.corpo.nome === 'Itaú PJ' && ct.corpo.saldo_inicial === 2500);

  checa(
    'nenhum handler inline',
    await p.evaluate(() => !document.querySelector('[onclick],[onchange],[oninput]'))
  );
  checa('nada virou HTML (XSS)', (await p.evaluate(() => window.__XSS)) === 0);
  await b.close();
  todos.push(...erros);

  process.exit(resumo(todos) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
