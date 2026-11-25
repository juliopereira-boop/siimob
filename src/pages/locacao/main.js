// ─── Módulo Locação (LOCACAO) · fases 1 e 2 ──────────────────────────────────
//
// O PEDIDO DO DONO
//   "Agora vamos criar o módulo de locação". Fase 1 escolhida: cadastro próprio
//   de imóveis + contrato + cobranças + repasse ao proprietário.
//
// COMO FUNCIONA
//   - Só o gestor do cliente, com a licença LOCACAO (o banco confere: RLS e
//     funções em database/migrations/2026-11-25_locacao.sql).
//   - Cadastros (pessoas, imóveis, donos, lançamentos, contrato em rascunho)
//     gravam direto. Dinheiro passa por função: gerar cobranças, baixar,
//     estornar, cancelar, pagar repasse, ativar e encerrar contrato.
//   - Vistas na sub-barra: Painel, Contratos, Cobranças, Repasses, Imóveis,
//     Pessoas e Vistorias (?vista=...). Tudo que vem do banco passa por esc();
//     CPF, telefone e e-mail ficam foscos pela proteção LGPD do casco.
//   - Fase 2 (database/migrations/2026-11-26_locacao_fase2.sql): ID automático
//     (CT-0001, IM-0001), documento do contrato a partir de modelo
//     (src/modules/locacao/documentos.js), reajuste pelo índice, renovação,
//     rescisão com multa proporcional e vistoria (src/modules/locacao/vistorias.js).
import { A1 } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import { hojeISO } from '../../shared/utils/datas.js';
import { a1RequireAuth, a1RequireModule, a1StartHeartbeat } from '../../shared/auth/auth.js';
import { a1MontarShell } from '../../shared/ui/modulo-shell.js';
import '../../shared/ui/avisos.js';
import { acoes } from '../../shared/ui/acoes.js';
import {
  ganchos,
  TIPO_IMOVEL,
  SIT_IMOVEL,
  GARANTIA,
  ST_CONTRATO,
  FORMAS,
  PAPEIS,
  G,
  $,
  brl,
  data,
  mes,
  num,
  dias,
  somaMeses,
  pessoa,
  imovel,
  contrato,
  idContrato,
  idImovel,
  nomeImovel,
  fimContrato,
  atrasada,
  stCobranca,
  ROT_COB,
  selo,
  aviso,
  motivo,
  carregar,
  gravar,
  rpc,
  executar,
  abrirModal,
  fecharModal,
  salvarModal,
  campo,
  opcoes,
  opcoesPessoas,
  tabela,
  fmtDoc
} from '../../modules/locacao/base.js';
import '../../modules/locacao/documentos.js';
import { vistorias } from '../../modules/locacao/vistorias.js';

const VISTAS = /** @type {Record<string,[string,string]>} */ ({
  painel: ['Painel', 'Visão geral dos aluguéis administrados.'],
  contratos: ['Contratos', 'Contratos de locação: partes, prazo, valor, garantia e taxa de administração.'],
  cobrancas: [
    'Cobranças',
    'Cobrança mensal de cada inquilino. A baixa calcula multa e juros e gera o repasse.'
  ],
  repasses: ['Repasses', 'O que cada proprietário recebe: aluguel − taxa de administração − despesas.'],
  imoveis: ['Imóveis', 'Imóveis administrados e seus proprietários.'],
  pessoas: ['Pessoas', 'Proprietários, inquilinos e fiadores.'],
  vistorias: ['Vistorias', 'Vistoria de entrada, saída e periódica, com fotos, laudo e comparativo.']
});
const INDICE_NOME = /** @type {Record<string,string>} */ ({
  IGPM: 'IGP-M',
  IPCA: 'IPCA',
  INPC: 'INPC',
  NENHUM: 'Sem reajuste'
});

// ─── Ações ───────────────────────────────────────────────────────────────────
acoes({
  lcVista: el => irPara(el.dataset.vista || 'painel'),
  lcFechar: () => fecharModal(),
  lcFecharFundo: (el, ev) => {
    if (ev.target === el) fecharModal();
  },
  lcSalvarModal: () => salvarModal(),
  lcFiltrar: () => {
    const c = /** @type {HTMLInputElement|null} */ (document.getElementById('lc-f-comp'));
    const s = /** @type {HTMLSelectElement|null} */ (document.getElementById('lc-f-status'));
    const b = /** @type {HTMLInputElement|null} */ (document.getElementById('lc-f-busca'));
    if (c) G.filtro.competencia = c.value || G.filtro.competencia;
    if (s) G.filtro.status = s.value;
    if (b) G.filtro.busca = b.value.trim().toLowerCase();
    desenharConteudo();
  },
  lcNovaPessoa: () => formPessoa(null),
  lcEditarPessoa: el => formPessoa(el.dataset.id || null),
  lcNovoImovel: () => formImovel(null),
  lcEditarImovel: el => formImovel(el.dataset.id || null),
  lcDonoMais: () => linhaDono(null, ''),
  lcDonoMenos: el => {
    el.closest('.lc-dono')?.remove();
    somaDonos();
  },
  lcDonoSoma: () => somaDonos(),
  lcNovoContrato: () => formContrato(null),
  lcEditarContrato: el => formContrato(el.dataset.id || null),
  lcGarantia: () => mostrarGarantia(),
  lcEncargoMais: () => linhaEncargo({ descricao: '', valor: '', destino: 'terceiro' }),
  lcEncargoMenos: el => el.closest('.lc-encargo')?.remove(),
  lcAtivar: el =>
    executar(
      () => rpc('a1_lc_ativar_contrato', { p_contrato: el.dataset.id }),
      'Contrato ativado. O imóvel passou para Alugado.'
    ),
  lcEncerrar: el => formEncerrar(el.dataset.id || ''),
  lcRescisaoCalc: () => calcularRescisao(),
  lcAbrirContrato: el => abrirContrato(el.dataset.id || ''),
  lcRenovar: el => formRenovar(el.dataset.id || ''),
  lcReajustar: el => formReajuste(el.dataset.id || ''),
  lcGerarDoContrato: el =>
    executar(
      async () => {
        const r = await rpc('a1_lc_gerar_cobrancas', {
          p_competencia: `${G.filtro.competencia}-01`,
          p_contrato: el.dataset.id
        });
        if (!r.criadas)
          throw new Error(
            `A cobrança de ${mes(G.filtro.competencia)} já existe ou o contrato não cobre este mês.`
          );
      },
      `Cobrança de ${mes(G.filtro.competencia)} gerada.`
    ),
  lcLancar: el => formLancamento(el.dataset.id || ''),
  lcGerarMes: () =>
    executar(async () => {
      const r = await rpc('a1_lc_gerar_cobrancas', { p_competencia: `${G.filtro.competencia}-01` });
      aviso(`${r.criadas || 0} cobrança(s) gerada(s) para ${mes(G.filtro.competencia)}.`);
    }, ''),
  lcBaixar: el => formBaixa(el.dataset.id || ''),
  lcBaixaPrevia: () => previaBaixa(),
  lcEstornar: el => {
    const b = G.cobrancas.find(x => x.id === el.dataset.id);
    if (!b || !confirm('Estornar a baixa desta cobrança? Os repasses dela (ainda não pagos) serão apagados.'))
      return;
    executar(
      () => rpc('a1_lc_estornar_cobranca', { p_cobranca: b.id, p_versao: b.versao }),
      'Baixa estornada.'
    );
  },
  lcCancelar: el => formCancelar(el.dataset.id || ''),
  lcPagarRepasse: el => formPagarRepasse(el.dataset.id || '')
});

function irPara(/** @type {string} */ v) {
  G.vista = VISTAS[v] ? v : 'painel';
  const u = new URL(location.href);
  if (G.vista === 'painel') u.searchParams.delete('vista');
  else u.searchParams.set('vista', G.vista);
  history.replaceState(null, '', u);
  document
    .querySelectorAll('.sb-sub-item[data-vista]')
    .forEach(b => b.classList.toggle('ativo', /** @type {HTMLElement} */ (b).dataset.vista === G.vista));
  desenhar();
}

// ─── Desenho ─────────────────────────────────────────────────────────────────
function desenhar() {
  const [t, s] = VISTAS[G.vista];
  $('lc-titulo').textContent = t;
  $('lc-sub').textContent = s;
  const botoes = {
    painel: '',
    contratos:
      '<button type="button" class="lc-btn" data-acao="lcModelos">Modelos de documento</button> <button type="button" class="lc-btn lc-btn-forte" data-acao="lcNovoContrato">+ Novo contrato</button>',
    vistorias:
      '<button type="button" class="lc-btn lc-btn-forte" data-acao="lcVistNova">+ Nova vistoria</button>',
    cobrancas: `<button type="button" class="lc-btn lc-btn-forte" data-acao="lcGerarMes">Gerar cobranças de ${esc(mes(G.filtro.competencia))}</button>`,
    repasses: '',
    imoveis:
      '<button type="button" class="lc-btn lc-btn-forte" data-acao="lcNovoImovel">+ Novo imóvel</button>',
    pessoas:
      '<button type="button" class="lc-btn lc-btn-forte" data-acao="lcNovaPessoa">+ Nova pessoa</button>'
  };
  $('lc-cab-acoes').innerHTML = /** @type {any} */ (botoes)[G.vista];
  const filtros = {
    cobrancas: `<label>Competência <input type="month" id="lc-f-comp" value="${esc(G.filtro.competencia)}" data-acao-change="lcFiltrar"></label>
      <label>Situação <select id="lc-f-status" data-acao-change="lcFiltrar">${opcoes({ todas: 'Todas', aberta: 'Em aberto', atrasada: 'Atrasadas', paga: 'Pagas', cancelada: 'Canceladas' }, G.filtro.status)}</select></label>`,
    repasses: `<label>Situação <select id="lc-f-status" data-acao-change="lcFiltrar">${opcoes({ todas: 'Todos', pendente: 'Pendentes', pago: 'Pagos' }, G.filtro.status === 'todas' || ['pendente', 'pago'].includes(G.filtro.status) ? G.filtro.status : 'todas')}</select></label>`,
    contratos: `<label>Competência das ações <input type="month" id="lc-f-comp" value="${esc(G.filtro.competencia)}" data-acao-change="lcFiltrar"></label>
      <input type="search" id="lc-f-busca" placeholder="Buscar ID, inquilino ou endereço" value="${esc(G.filtro.busca)}" data-acao-input="lcFiltrar">`,
    vistorias: `<input type="search" id="lc-f-busca" placeholder="Buscar imóvel" value="${esc(G.filtro.busca)}" data-acao-input="lcFiltrar">`,
    imoveis: `<input type="search" id="lc-f-busca" placeholder="Buscar ID ou endereço" value="${esc(G.filtro.busca)}" data-acao-input="lcFiltrar">`,
    pessoas: `<input type="search" id="lc-f-busca" placeholder="Buscar nome" value="${esc(G.filtro.busca)}" data-acao-input="lcFiltrar">`
  };
  $('lc-filtros').innerHTML = /** @type {any} */ (filtros)[G.vista] || '';
  desenharConteudo();
}

function desenharConteudo() {
  const alvo = $('lc-conteudo');
  const f = /** @type {any} */ ({ painel, contratos, cobrancas, repasses, imoveis, pessoas, vistorias })[
    G.vista
  ];
  alvo.innerHTML = f();
}

function painel() {
  const hoje = hojeISO();
  const ativos = G.contratos.filter(c => c.status === 'ativo');
  const compAtual = hoje.slice(0, 7) + '-01';
  const doMes = G.cobrancas.filter(b => b.competencia === compAtual && b.status !== 'cancelada');
  const atrasadas = G.cobrancas.filter(atrasada);
  const em7 = G.cobrancas.filter(
    b => b.status === 'aberta' && b.vencimento >= hoje && dias(hoje, b.vencimento) <= 7
  );
  const repPend = G.repasses.filter(r => r.status === 'pendente');
  const vencendo = ativos.filter(c => {
    const d = dias(hoje, fimContrato(c));
    return d >= 0 && d <= 60;
  });
  const reajustes = ativos.filter(c => reajusteDoMes(c) === 'pendente');
  const kpi = (/** @type {string} */ r, /** @type {string} */ v, /** @type {string} */ d = '', tipo = '') =>
    `<div class="lc-kpi ${tipo}"><span>${esc(r)}</span><b>${esc(v)}</b>${d ? `<small>${esc(d)}</small>` : ''}</div>`;
  const recebido = doMes.filter(b => b.status === 'paga').reduce((s, b) => s + Number(b.valor_pago || 0), 0);
  const previsto = doMes.reduce((s, b) => s + Number(b.valor_total || 0), 0);
  return `<div class="lc-kpis">
      ${kpi('Contratos ativos', String(ativos.length), `${G.imoveis.filter(i => i.situacao === 'disponivel').length} imóvel(is) disponível(is)`)}
      ${kpi('Recebido no mês', brl(recebido), `de ${brl(previsto)} previstos`)}
      ${kpi('Em atraso', brl(atrasadas.reduce((s, b) => s + Number(b.valor_total), 0)), `${atrasadas.length} cobrança(s)`, atrasadas.length ? 'lc-kpi-alerta' : '')}
      ${kpi('Repasses a pagar', brl(repPend.reduce((s, r) => s + Number(r.valor_liquido), 0)), `${repPend.length} repasse(s)`)}
    </div>
    <div class="lc-grade">
      <section class="lc-bloco"><h3>Cobranças em atraso</h3>${listaCobrancas(atrasadas.slice(0, 8), 'Nenhuma cobrança em atraso.')}</section>
      <section class="lc-bloco"><h3>Vencem nos próximos 7 dias</h3>${listaCobrancas(em7.slice(0, 8), 'Nada vence nos próximos 7 dias.')}</section>
      <section class="lc-bloco"><h3>Repasses a pagar</h3>${
        repPend.length
          ? `<ul class="lc-lista">${repPend
              .slice()
              .sort((a, b) => String(a.previsto_para).localeCompare(String(b.previsto_para)))
              .slice(0, 8)
              .map(
                r =>
                  `<li><span>${esc((pessoa(r.proprietario_id) || {}).nome || '—')}<small>previsto ${esc(data(r.previsto_para))}</small></span><b>${esc(brl(r.valor_liquido))}</b></li>`
              )
              .join('')}</ul>`
          : '<p class="lc-vazio">Nenhum repasse pendente.</p>'
      }</section>
      <section class="lc-bloco"><h3>Contratos vencendo (60 dias) e reajustes do mês</h3>${
        vencendo.length || reajustes.length
          ? `<ul class="lc-lista">${vencendo
              .map(
                c =>
                  `<li><span>${esc((pessoa(c.inquilino_id) || {}).nome || '—')}<small>termina em ${esc(data(fimContrato(c)))}</small></span>${selo('alerta', 'Vencendo')}</li>`
              )
              .join('')}${reajustes
              .map(
                c =>
                  `<li><span>${esc((pessoa(c.inquilino_id) || {}).nome || '—')}<small>${esc(idContrato(c))} · reajuste ${esc(INDICE_NOME[c.indice_reajuste])} neste mês${c.reajuste_auto ? ' (automático)' : ''}</small></span><button class="lc-btn lc-btn-p" data-acao="lcReajustar" data-id="${esc(c.id)}">Reajustar</button></li>`
              )
              .join('')}</ul>`
          : '<p class="lc-vazio">Nenhum contrato vencendo e nenhum reajuste pendente neste mês.</p>'
      }</section>
    </div>
    <p class="lc-dica lc-indices">${indicesResumo()}</p>`;
}
function listaCobrancas(/** @type {any[]} */ l, /** @type {string} */ vazio) {
  if (!l.length) return `<p class="lc-vazio">${esc(vazio)}</p>`;
  return `<ul class="lc-lista">${l
    .map(b => {
      const c = contrato(b.contrato_id);
      return `<li><span>${esc((pessoa(c && c.inquilino_id) || {}).nome || '—')}<small>vence ${esc(data(b.vencimento))} · ${esc(nomeImovel(imovel(c && c.imovel_id)))}</small></span><b>${esc(brl(b.valor_total))}</b></li>`;
    })
    .join('')}</ul>`;
}

function contratos() {
  const q = G.filtro.busca;
  const l = G.contratos.filter(c => {
    if (!q) return true;
    const t =
      `${idContrato(c)} ${(pessoa(c.inquilino_id) || {}).nome || ''} ${nomeImovel(imovel(c.imovel_id))} ${c.codigo || ''}`.toLowerCase();
    return t.includes(q);
  });
  return tabela(
    ['ID', 'Imóvel', 'Inquilino', 'Aluguel', 'Vence dia', 'Vigência', 'Garantia', 'Situação', ''],
    l.map(c => {
      const st = c.status;
      const doc = `<button class="lc-btn lc-btn-p" data-acao="lcDocumento" data-id="${esc(c.id)}">Documento</button>`;
      const acoesC =
        st === 'rascunho'
          ? `<button class="lc-btn lc-btn-p" data-acao="lcEditarContrato" data-id="${esc(c.id)}">Editar</button>
             ${doc}
             <button class="lc-btn lc-btn-p lc-btn-forte" data-acao="lcAtivar" data-id="${esc(c.id)}">Ativar</button>`
          : `${doc}
             <button class="lc-btn lc-btn-p lc-btn-forte" data-acao="lcAbrirContrato" data-id="${esc(c.id)}">Abrir</button>`;
      const reaj =
        st === 'ativo' && reajusteDoMes(c) === 'pendente' ? ` ${selo('alerta', 'Reajuste do mês')}` : '';
      return `<tr data-id="${esc(c.id)}">
        <td class="lc-mono"><b>${esc(idContrato(c))}</b>${c.codigo ? `<small>ref. ${esc(c.codigo)}</small>` : ''}</td>
        <td>${esc(nomeImovel(imovel(c.imovel_id)))}</td>
        <td>${esc((pessoa(c.inquilino_id) || {}).nome || '—')}</td>
        <td class="lc-num">${esc(brl(c.valor_aluguel))}</td>
        <td>${esc(String(c.dia_vencimento))}</td>
        <td>${esc(data(c.data_inicio))} a ${esc(data(fimContrato(c)))}<small>${esc(String(c.prazo_meses))} meses</small></td>
        <td>${esc(GARANTIA[c.garantia_tipo] || c.garantia_tipo)}${c.garantia_tipo === 'fiador' ? `<small>${esc((pessoa(c.fiador_id) || {}).nome || '')}</small>` : ''}</td>
        <td>${selo(st === 'ativo' ? 'ok' : st === 'rascunho' ? 'info' : 'off', ST_CONTRATO[st] || st)}${reaj}</td>
        <td class="lc-acoes">${acoesC}</td></tr>`;
    }),
    'Nenhum contrato. Cadastre pessoas e imóveis e crie o primeiro contrato.'
  );
}

function cobrancas() {
  const comp = `${G.filtro.competencia}-01`;
  const st = G.filtro.status;
  const l = G.cobrancas.filter(b => b.competencia === comp && (st === 'todas' || stCobranca(b) === st));
  const total = l.filter(b => b.status !== 'cancelada').reduce((s, b) => s + Number(b.valor_total), 0);
  const pago = l.filter(b => b.status === 'paga').reduce((s, b) => s + Number(b.valor_pago || 0), 0);
  return `<p class="lc-resumo">${esc(String(l.length))} cobrança(s) · previsto ${esc(brl(total))} · recebido ${esc(brl(pago))}</p>${tabela(
    ['Inquilino', 'Imóvel', 'Vencimento', 'Valor', 'Situação', 'Pagamento', ''],
    l.map(b => {
      const c = contrato(b.contrato_id);
      const s = stCobranca(b);
      const acoesB =
        b.status === 'aberta'
          ? `<button class="lc-btn lc-btn-p lc-btn-forte" data-acao="lcBaixar" data-id="${esc(b.id)}">Baixar</button>
             <button class="lc-btn lc-btn-p lc-perigo" data-acao="lcCancelar" data-id="${esc(b.id)}">Cancelar</button>`
          : b.status === 'paga'
            ? `<button class="lc-btn lc-btn-p" data-acao="lcEstornar" data-id="${esc(b.id)}">Estornar</button>`
            : '';
      return `<tr data-id="${esc(b.id)}">
        <td>${esc((pessoa(c && c.inquilino_id) || {}).nome || '—')}</td>
        <td>${esc(nomeImovel(imovel(c && c.imovel_id)))}</td>
        <td>${esc(data(b.vencimento))}</td>
        <td class="lc-num">${esc(brl(b.valor_total))}<small>${(b.itens || []).map((/** @type {any} */ i) => `${esc(i.descricao)} ${esc(brl(i.valor))}`).join(' · ')}</small></td>
        <td>${selo(s === 'paga' ? 'ok' : s === 'atrasada' ? 'erro' : s === 'aberta' ? 'info' : 'off', ROT_COB[s])}</td>
        <td>${b.status === 'paga' ? `${esc(data(b.pago_em))} · ${esc(brl(b.valor_pago))}<small>${esc(FORMAS[b.forma_pagamento] || '')}${Number(b.multa) || Number(b.juros) ? ` · multa ${esc(brl(b.multa))} + juros ${esc(brl(b.juros))}` : ''}</small>` : b.status === 'cancelada' ? `<small>${esc(b.observacao || '')}</small>` : ''}</td>
        <td class="lc-acoes">${acoesB}</td></tr>`;
    }),
    `Nenhuma cobrança para ${mes(G.filtro.competencia)} com este filtro. Use "Gerar cobranças" para criar as do mês.`
  )}`;
}

function repasses() {
  const st = G.filtro.status;
  const l = G.repasses.filter(
    r => r.status !== 'cancelado' && (st === 'todas' || !['pendente', 'pago'].includes(st) || r.status === st)
  );
  const pend = l.filter(r => r.status === 'pendente').reduce((s, r) => s + Number(r.valor_liquido), 0);
  return `<p class="lc-resumo">${esc(String(l.length))} repasse(s) · a pagar ${esc(brl(pend))}</p>${tabela(
    [
      'Proprietário',
      'Imóvel',
      'Competência',
      'Aluguel',
      'Encargos',
      'Taxa adm.',
      'Despesas',
      'Líquido',
      'Situação',
      ''
    ],
    l.map(r => {
      const c = contrato(r.contrato_id);
      const b = G.cobrancas.find(x => x.id === r.cobranca_id);
      const p = pessoa(r.proprietario_id) || {};
      return `<tr data-id="${esc(r.id)}">
        <td>${esc(p.nome || '—')}<small>${esc(String(Number(r.percentual)))}%${p.pix ? ` · PIX ${esc(p.pix)}` : ''}</small></td>
        <td>${esc(nomeImovel(imovel(c && c.imovel_id)))}</td>
        <td>${esc(mes(b ? b.competencia : ''))}</td>
        <td class="lc-num">${esc(brl(r.aluguel))}</td>
        <td class="lc-num">${esc(brl(r.encargos))}</td>
        <td class="lc-num">− ${esc(brl(r.taxa_adm))}</td>
        <td class="lc-num">${Number(r.lancamentos) >= 0 ? '− ' : '+ '}${esc(brl(Math.abs(Number(r.lancamentos))))}</td>
        <td class="lc-num"><b>${esc(brl(r.valor_liquido))}</b></td>
        <td>${r.status === 'pago' ? selo('ok', `Pago ${data(r.pago_em)}`) : selo('info', `Previsto ${data(r.previsto_para)}`)}</td>
        <td class="lc-acoes">${r.status === 'pendente' ? `<button class="lc-btn lc-btn-p lc-btn-forte" data-acao="lcPagarRepasse" data-id="${esc(r.id)}">Marcar pago</button>` : ''}</td></tr>`;
    }),
    'Nenhum repasse. Eles nascem quando uma cobrança é baixada.'
  )}`;
}

function imoveis() {
  const q = G.filtro.busca;
  const l = G.imoveis.filter(
    i =>
      !q ||
      nomeImovel(i).toLowerCase().includes(q) ||
      String(i.cidade || '')
        .toLowerCase()
        .includes(q)
  );
  return tabela(
    ['Imóvel', 'Tipo', 'Proprietários', 'Aluguel pedido', 'Situação', ''],
    l.map(i => {
      const donos = G.donos.filter(d => d.imovel_id === i.id);
      const soma = donos.reduce((s, d) => s + Number(d.percentual), 0);
      return `<tr data-id="${esc(i.id)}">
        <td>${esc(nomeImovel(i))}<small>${esc([i.cidade, i.uf].filter(Boolean).join(' / '))}${i.codigo ? ` · ref. ${esc(i.codigo)}` : ''}</small></td>
        <td>${esc(TIPO_IMOVEL[i.tipo] || i.tipo)}<small>${esc(i.finalidade === 'comercial' ? 'Comercial' : 'Residencial')}</small></td>
        <td>${donos.map(d => `${esc((pessoa(d.pessoa_id) || {}).nome || '—')} ${esc(String(Number(d.percentual)))}%`).join('<br>') || '—'}${donos.length && soma !== 100 ? `<small class="lc-erro-txt">soma ${esc(String(soma))}%: precisa ser 100%</small>` : ''}</td>
        <td class="lc-num">${i.valor_aluguel ? esc(brl(i.valor_aluguel)) : '—'}</td>
        <td>${selo(i.situacao === 'alugado' ? 'ok' : i.situacao === 'disponivel' ? 'info' : 'off', SIT_IMOVEL[i.situacao] || i.situacao)}</td>
        <td class="lc-acoes"><button class="lc-btn lc-btn-p" data-acao="lcEditarImovel" data-id="${esc(i.id)}">Editar</button></td></tr>`;
    }),
    'Nenhum imóvel cadastrado.'
  );
}

function pessoas() {
  const q = G.filtro.busca;
  const l = G.pessoas.filter(p => !q || String(p.nome).toLowerCase().includes(q));
  return tabela(
    ['Nome', 'Papéis', 'CPF/CNPJ', 'Contato', 'Repasse', ''],
    l.map(
      p => `<tr data-id="${esc(p.id)}">
        <td>${esc(p.nome)}${p.ativo === false ? ` ${selo('off', 'Inativa')}` : ''}</td>
        <td>${(p.papeis || []).map((/** @type {string} */ k) => selo('info', PAPEIS[k] || k)).join(' ')}</td>
        <td class="lc-mono">${esc(fmtDoc(p.documento))}</td>
        <td>${esc(p.telefone || '')}<small>${esc(p.email || '')}</small></td>
        <td>${p.pix ? `PIX ${esc(p.pix)}` : '—'}</td>
        <td class="lc-acoes"><button class="lc-btn lc-btn-p" data-acao="lcEditarPessoa" data-id="${esc(p.id)}">Editar</button></td></tr>`
    ),
    'Nenhuma pessoa cadastrada.'
  );
}

// ─── Formulários ─────────────────────────────────────────────────────────────
function formPessoa(/** @type {string|null} */ id) {
  const p = pessoa(id) || { tipo_pessoa: 'pf', papeis: [] };
  abrirModal(
    id ? 'Editar pessoa' : 'Nova pessoa',
    `<div class="lc-form">
      <label>Tipo<select id="lp-tipo">${opcoes({ pf: 'Pessoa física', pj: 'Pessoa jurídica' }, p.tipo_pessoa)}</select></label>
      <label class="lc-largo">Nome *<input id="lp-nome" maxlength="160" value="${esc(p.nome || '')}"></label>
      <label>CPF/CNPJ<input id="lp-doc" maxlength="18" value="${esc(fmtDoc(p.documento))}" autocomplete="off"></label>
      <label>Telefone<input id="lp-fone" type="tel" maxlength="40" value="${esc(p.telefone || '')}"></label>
      <label>E-mail<input id="lp-email" type="email" maxlength="160" value="${esc(p.email || '')}"></label>
      <label class="lc-largo">Endereço<input id="lp-endereco" maxlength="300" value="${esc(p.endereco || '')}"></label>
      <label>Chave PIX (repasse)<input id="lp-pix" maxlength="140" value="${esc(p.pix || '')}"></label>
      <label>Banco / agência / conta<input id="lp-banco" maxlength="200" value="${esc(p.banco || '')}"></label>
      <fieldset class="lc-largo"><legend>Papéis</legend>${Object.entries(PAPEIS)
        .map(
          ([k, v]) =>
            `<label class="lc-check"><input type="checkbox" class="lp-papel" value="${esc(k)}"${(p.papeis || []).includes(k) ? ' checked' : ''}> ${esc(v)}</label>`
        )
        .join('')}</fieldset>
      ${id ? `<label class="lc-check"><input type="checkbox" id="lp-ativo"${p.ativo !== false ? ' checked' : ''}> Ativa</label>` : ''}
    </div>`,
    async () => {
      const nome = campo('lp-nome');
      const doc = campo('lp-doc').replace(/\D/g, '');
      if (nome.length < 2) throw new Error('Informe o nome.');
      if (doc && doc.length !== 11 && doc.length !== 14) throw new Error('CPF tem 11 dígitos e CNPJ, 14.');
      const papeis = [...document.querySelectorAll('.lp-papel:checked')].map(
        i => /** @type {HTMLInputElement} */ (i).value
      );
      const ativo = document.getElementById('lp-ativo');
      await gravar(
        'a1_lc_pessoas',
        {
          ...(id ? {} : { tenant_id: (A1.user || {}).tenant_id }),
          tipo_pessoa: campo('lp-tipo') === 'pj' ? 'pj' : 'pf',
          nome,
          documento: doc || null,
          telefone: campo('lp-fone') || null,
          email: campo('lp-email') || null,
          endereco: campo('lp-endereco') || null,
          pix: campo('lp-pix') || null,
          banco: campo('lp-banco') || null,
          papeis,
          ativo: ativo ? /** @type {HTMLInputElement} */ (ativo).checked : true,
          atualizado_em: new Date().toISOString()
        },
        id
      );
      aviso('Pessoa salva.');
    }
  );
}

function formImovel(/** @type {string|null} */ id) {
  const i = imovel(id) || { tipo: 'apartamento', finalidade: 'residencial', situacao: 'disponivel' };
  const donos = G.donos.filter(d => d.imovel_id === id);
  abrirModal(
    id ? 'Editar imóvel' : 'Novo imóvel',
    `<div class="lc-form">
      <label>ID<input value="${esc(id ? idImovel(i) : 'gerado ao salvar')}" disabled></label>
      <label>Tipo<select id="li-tipo">${opcoes(TIPO_IMOVEL, i.tipo)}</select></label>
      <label>Finalidade<select id="li-fin">${opcoes({ residencial: 'Residencial', comercial: 'Comercial' }, i.finalidade)}</select></label>
      <label>Situação<select id="li-sit"${i.situacao === 'alugado' ? ' disabled' : ''}>${opcoes(i.situacao === 'alugado' ? SIT_IMOVEL : { disponivel: 'Disponível', manutencao: 'Em manutenção', inativo: 'Inativo' }, i.situacao)}</select></label>
      <label class="lc-largo">Logradouro *<input id="li-logr" maxlength="200" value="${esc(i.logradouro || '')}"></label>
      <label>Número<input id="li-num" maxlength="20" value="${esc(i.numero || '')}"></label>
      <label>Complemento<input id="li-compl" maxlength="80" value="${esc(i.complemento || '')}"></label>
      <label>Bairro<input id="li-bairro" maxlength="80" value="${esc(i.bairro || '')}"></label>
      <label>Cidade<input id="li-cidade" maxlength="80" value="${esc(i.cidade || '')}"></label>
      <label>UF<input id="li-uf" maxlength="2" value="${esc(i.uf || '')}"></label>
      <label>CEP<input id="li-cep" maxlength="9" value="${esc(i.cep || '')}"></label>
      <label>Área (m²)<input id="li-area" inputmode="decimal" value="${esc(i.area_m2 ?? '')}"></label>
      <label>Quartos<input id="li-quartos" type="number" min="0" max="99" value="${esc(i.quartos ?? '')}"></label>
      <label>Vagas<input id="li-vagas" type="number" min="0" max="99" value="${esc(i.vagas ?? '')}"></label>
      <label>Aluguel pedido (R$)<input id="li-aluguel" inputmode="decimal" value="${esc(i.valor_aluguel ?? '')}"></label>
      <label>Condomínio (R$/mês)<input id="li-cond" inputmode="decimal" value="${esc(i.valor_condominio ?? '')}"></label>
      <label>IPTU (R$/mês)<input id="li-iptu" inputmode="decimal" value="${esc(i.valor_iptu ?? '')}"></label>
      <fieldset class="lc-largo"><legend>Proprietários e a parte de cada um</legend>
        <div id="li-donos"></div>
        <div class="lc-donos-pe"><button type="button" class="lc-btn lc-btn-p" data-acao="lcDonoMais">+ Proprietário</button>
          <span id="li-soma" class="lc-soma"></span></div>
        <p class="lc-dica">Cadastre o proprietário antes em Pessoas, com o papel "Proprietário". As partes precisam somar 100% para ativar um contrato.</p>
      </fieldset>
      <label class="lc-largo">Observações<textarea id="li-obs" maxlength="2000" rows="2">${esc(i.observacoes || '')}</textarea></label>
    </div>`,
    async () => {
      const logr = campo('li-logr');
      if (logr.length < 2) throw new Error('Informe o logradouro.');
      const n = (/** @type {string} */ k) => {
        const v = campo(k);
        if (!v) return null;
        const x = num(v);
        if (!Number.isFinite(x) || x < 0) throw new Error('Confira os valores numéricos.');
        return x;
      };
      const linhas = [...document.querySelectorAll('#li-donos .lc-dono')].map(l => ({
        pessoa_id: /** @type {HTMLSelectElement} */ (l.querySelector('select')).value,
        percentual: num(/** @type {HTMLInputElement} */ (l.querySelector('input')).value)
      }));
      if (
        linhas.some(
          l => !l.pessoa_id || !Number.isFinite(l.percentual) || l.percentual <= 0 || l.percentual > 100
        )
      )
        throw new Error('Escolha cada proprietário e a parte dele (de 0,01% a 100%).');
      if (new Set(linhas.map(l => l.pessoa_id)).size !== linhas.length)
        throw new Error('Um proprietário aparece duas vezes.');
      const uf = campo('li-uf').toUpperCase();
      if (uf && !/^[A-Z]{2}$/.test(uf)) throw new Error('UF com 2 letras.');
      const cep = campo('li-cep').replace(/\D/g, '');
      if (cep && cep.length !== 8) throw new Error('CEP com 8 dígitos.');
      const sitEl = /** @type {HTMLSelectElement} */ ($('li-sit'));
      const salvo = await gravar(
        'a1_lc_imoveis',
        {
          ...(id ? {} : { tenant_id: (A1.user || {}).tenant_id }),
          tipo: campo('li-tipo'),
          finalidade: campo('li-fin'),
          ...(sitEl.disabled ? {} : { situacao: sitEl.value }),
          logradouro: logr,
          numero: campo('li-num') || null,
          complemento: campo('li-compl') || null,
          bairro: campo('li-bairro') || null,
          cidade: campo('li-cidade') || null,
          uf: uf || null,
          cep: cep || null,
          area_m2: n('li-area'),
          quartos: n('li-quartos'),
          vagas: n('li-vagas'),
          valor_aluguel: n('li-aluguel'),
          valor_condominio: n('li-cond'),
          valor_iptu: n('li-iptu'),
          observacoes: campo('li-obs') || null,
          atualizado_em: new Date().toISOString()
        },
        id
      );
      // Donos: grava (upsert) a lista nova ANTES de apagar quem saiu. Se a
      // gravação falhar, os donos de antes continuam lá.
      const imovelId = salvo.id;
      const tenant = salvo.tenant_id;
      if (linhas.length) {
        const ins = await fetch(`${A1.rest('a1_lc_imovel_donos')}?on_conflict=imovel_id,pessoa_id`, {
          method: 'POST',
          headers: A1.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(linhas.map(l => ({ ...l, imovel_id: imovelId, tenant_id: tenant })))
        });
        if (!ins.ok) throw new Error(await motivo(ins));
      }
      const ficam = linhas.map(l => l.pessoa_id).join(',');
      const del = await fetch(
        `${A1.rest('a1_lc_imovel_donos')}?imovel_id=eq.${encodeURIComponent(imovelId)}` +
          (ficam ? `&pessoa_id=not.in.(${ficam})` : ''),
        { method: 'DELETE', headers: A1.headers() }
      );
      if (!del.ok) throw new Error(await motivo(del));
      aviso('Imóvel salvo.');
    }
  );
  donos.forEach(d => linhaDono(d.pessoa_id, String(Number(d.percentual))));
  if (!donos.length) linhaDono(null, '100');
  somaDonos();
}
function linhaDono(/** @type {string|null} */ pessoaId, /** @type {string} */ pct) {
  const caixa = document.getElementById('li-donos');
  if (!caixa) return;
  const div = document.createElement('div');
  div.className = 'lc-dono';
  div.innerHTML = `<select aria-label="Proprietário" data-acao-change="lcDonoSoma">${opcoesPessoas('proprietario', pessoaId)}</select>
    <input inputmode="decimal" aria-label="Parte (%)" value="${esc(pct)}" data-acao-input="lcDonoSoma"><span>%</span>
    <button type="button" class="lc-btn lc-btn-p" data-acao="lcDonoMenos" aria-label="Remover proprietário">×</button>`;
  caixa.appendChild(div);
  somaDonos();
}
function somaDonos() {
  const el = document.getElementById('li-soma');
  if (!el) return;
  const soma = [...document.querySelectorAll('#li-donos .lc-dono input')].reduce(
    (s, i) => s + (num(/** @type {HTMLInputElement} */ (i).value) || 0),
    0
  );
  el.textContent = `Soma: ${soma.toLocaleString('pt-BR')}%`;
  el.classList.toggle('lc-erro-txt', Math.abs(soma - 100) > 0.001);
}

function formContrato(/** @type {string|null} */ id) {
  const c = contrato(id) || {
    finalidade: 'residencial',
    prazo_meses: 30,
    dia_vencimento: 10,
    indice_reajuste: 'IGPM',
    garantia_tipo: 'nenhuma',
    multa_atraso_pct: 10,
    juros_mes_pct: 1,
    multa_rescisao_alugueis: 3,
    taxa_adm_pct: 10,
    repasse_dias: 5,
    encargos: [],
    reajuste_auto: true,
    data_inicio: hojeISO()
  };
  const livres = G.imoveis.filter(
    i => i.situacao !== 'inativo' && (i.situacao !== 'alugado' || i.id === c.imovel_id)
  );
  abrirModal(
    id ? 'Editar contrato (rascunho)' : 'Novo contrato',
    `<div class="lc-form">
      <label class="lc-largo">Imóvel *<select id="lk-imovel">${'<option value="">— selecione —</option>' + livres.map(i => `<option value="${esc(i.id)}"${i.id === c.imovel_id ? ' selected' : ''}>${esc(nomeImovel(i))}</option>`).join('')}</select></label>
      <label class="lc-largo">Inquilino *<select id="lk-inquilino">${opcoesPessoas('inquilino', c.inquilino_id || null)}</select></label>
      <label>ID<input value="${esc(id ? idContrato(c) : 'gerado ao salvar')}" disabled></label>
      <label>Finalidade<select id="lk-fin">${opcoes({ residencial: 'Residencial', comercial: 'Comercial' }, c.finalidade)}</select></label>
      <label>Início *<input id="lk-inicio" type="date" value="${esc(c.data_inicio || '')}"></label>
      <label>Prazo (meses) *<input id="lk-prazo" type="number" min="1" max="600" value="${esc(c.prazo_meses)}"></label>
      <label>Dia do vencimento *<input id="lk-dia" type="number" min="1" max="28" value="${esc(c.dia_vencimento)}"></label>
      <label>Aluguel (R$) *<input id="lk-aluguel" inputmode="decimal" value="${esc(c.valor_aluguel ?? '')}"></label>
      <label>Índice de reajuste<select id="lk-indice">${opcoes({ IGPM: 'IGP-M', IPCA: 'IPCA', INPC: 'INPC', NENHUM: 'Sem reajuste' }, c.indice_reajuste)}</select></label>
      <label>Mês do reajuste<input id="lk-mesreaj" type="number" min="1" max="12" value="${esc(c.mes_reajuste ?? '')}" placeholder="aniversário"></label>
      <label class="lc-check"><input type="checkbox" id="lk-auto"${c.reajuste_auto !== false ? ' checked' : ''}> Reajustar sozinho no mês do reajuste, pelo índice do Banco Central</label>
      <fieldset class="lc-largo"><legend>Garantia (uma só, Lei 8.245 art. 37)</legend>
        <div class="lc-form">
          <label>Tipo<select id="lk-gtipo" data-acao-change="lcGarantia">${opcoes(GARANTIA, c.garantia_tipo)}</select></label>
          <label id="lk-gvalor-w">Valor (R$)<input id="lk-gvalor" inputmode="decimal" value="${esc(c.garantia_valor ?? '')}"></label>
          <label id="lk-fiador-w">Fiador<select id="lk-fiador">${opcoesPessoas('fiador', c.fiador_id || null)}</select></label>
          <label class="lc-largo" id="lk-gdet-w">Detalhes (seguradora, apólice, vigência...)<input id="lk-gdet" maxlength="500" value="${esc(c.garantia_detalhe || '')}"></label>
        </div>
        <p class="lc-dica" id="lk-gdica"></p>
      </fieldset>
      <label>Multa por atraso (%)<input id="lk-multa" inputmode="decimal" value="${esc(c.multa_atraso_pct)}"></label>
      <label>Juros ao mês (%)<input id="lk-juros" inputmode="decimal" value="${esc(c.juros_mes_pct)}"></label>
      <label>Multa rescisória (aluguéis)<input id="lk-mresc" inputmode="decimal" value="${esc(c.multa_rescisao_alugueis)}"></label>
      <label>Taxa de administração (%)<input id="lk-taxa" inputmode="decimal" value="${esc(c.taxa_adm_pct)}"></label>
      <label>Repasse (dias após o pagamento)<input id="lk-rdias" type="number" min="0" max="60" value="${esc(c.repasse_dias)}"></label>
      <fieldset class="lc-largo"><legend>Encargos mensais cobrados junto (condomínio, IPTU...)</legend>
        <div id="lk-encargos"></div>
        <button type="button" class="lc-btn lc-btn-p" data-acao="lcEncargoMais">+ Encargo</button>
        <p class="lc-dica">"Repassar ao proprietário" entra no repasse sem taxa de administração. "Pago a terceiro" (ex.: condomínio pago pela imobiliária) fica fora do repasse.</p>
      </fieldset>
      <label class="lc-largo">Observações<textarea id="lk-obs" maxlength="4000" rows="2">${esc(c.observacoes || '')}</textarea></label>
    </div>`,
    async () => {
      const aluguel = num(campo('lk-aluguel'));
      const prazo = Number(campo('lk-prazo'));
      const dia = Number(campo('lk-dia'));
      const g = campo('lk-gtipo');
      const gvalor = campo('lk-gvalor') ? num(campo('lk-gvalor')) : null;
      if (!campo('lk-imovel') || !campo('lk-inquilino') || !campo('lk-inicio'))
        throw new Error('Escolha o imóvel, o inquilino e o início.');
      if (!Number.isFinite(aluguel) || aluguel <= 0) throw new Error('Informe o aluguel.');
      if (!Number.isInteger(prazo) || prazo < 1 || prazo > 600) throw new Error('Prazo de 1 a 600 meses.');
      if (!Number.isInteger(dia) || dia < 1 || dia > 28) throw new Error('Dia do vencimento de 1 a 28.');
      if (g === 'fiador' && !campo('lk-fiador')) throw new Error('Escolha o fiador.');
      if (g === 'caucao' && (gvalor == null || !Number.isFinite(gvalor) || gvalor > aluguel * 3))
        throw new Error('Caução: informe o valor, de até 3 aluguéis (Lei 8.245, art. 38).');
      if (campo('lk-fiador') && campo('lk-fiador') === campo('lk-inquilino'))
        throw new Error('O fiador não pode ser o inquilino.');
      const pct = (/** @type {string} */ k, /** @type {number} */ max) => {
        const x = num(campo(k));
        if (!Number.isFinite(x) || x < 0 || x > max) throw new Error('Confira multa, juros, taxa e prazos.');
        return x;
      };
      const encargos = [...document.querySelectorAll('#lk-encargos .lc-encargo')].map(l => ({
        descricao: /** @type {HTMLInputElement} */ (l.querySelector('.le-desc')).value.trim(),
        valor: num(/** @type {HTMLInputElement} */ (l.querySelector('.le-valor')).value),
        destino: /** @type {HTMLSelectElement} */ (l.querySelector('select')).value
      }));
      if (encargos.some(e => !e.descricao || !Number.isFinite(e.valor) || e.valor <= 0))
        throw new Error('Cada encargo precisa de descrição e valor.');
      const mesReaj = campo('lk-mesreaj')
        ? Number(campo('lk-mesreaj'))
        : Number(campo('lk-inicio').slice(5, 7));
      await gravar(
        'a1_lc_contratos',
        {
          ...(id ? {} : { tenant_id: (A1.user || {}).tenant_id, criado_por: (A1.user || {}).id || null }),
          imovel_id: campo('lk-imovel'),
          inquilino_id: campo('lk-inquilino'),
          finalidade: campo('lk-fin'),
          data_inicio: campo('lk-inicio'),
          prazo_meses: prazo,
          dia_vencimento: dia,
          valor_aluguel: aluguel,
          indice_reajuste: campo('lk-indice'),
          mes_reajuste: mesReaj >= 1 && mesReaj <= 12 ? mesReaj : null,
          reajuste_auto: /** @type {HTMLInputElement} */ ($('lk-auto')).checked,
          garantia_tipo: g,
          garantia_valor: ['caucao', 'seguro_fianca', 'cessao_cotas'].includes(g) ? gvalor : null,
          fiador_id: g === 'fiador' ? campo('lk-fiador') : null,
          garantia_detalhe: g === 'nenhuma' ? null : campo('lk-gdet') || null,
          multa_atraso_pct: pct('lk-multa', 20),
          juros_mes_pct: pct('lk-juros', 10),
          multa_rescisao_alugueis: pct('lk-mresc', 12),
          taxa_adm_pct: pct('lk-taxa', 100),
          repasse_dias: Math.round(pct('lk-rdias', 60)),
          encargos,
          observacoes: campo('lk-obs') || null,
          atualizado_em: new Date().toISOString()
        },
        id
      );
      aviso(id ? 'Contrato salvo.' : 'Contrato criado como rascunho. Confira e clique em Ativar.');
    }
  );
  (c.encargos || []).forEach((/** @type {any} */ e) => linhaEncargo(e));
  mostrarGarantia();
}
function linhaEncargo(/** @type {any} */ e) {
  const caixa = document.getElementById('lk-encargos');
  if (!caixa) return;
  const div = document.createElement('div');
  div.className = 'lc-encargo';
  div.innerHTML = `<input class="le-desc" maxlength="80" placeholder="Descrição (ex.: Condomínio)" value="${esc(e.descricao || '')}" aria-label="Descrição do encargo">
    <input class="le-valor" inputmode="decimal" placeholder="Valor" value="${esc(e.valor ?? '')}" aria-label="Valor do encargo">
    <select aria-label="Destino">${opcoes({ terceiro: 'Pago a terceiro', proprietario: 'Repassar ao proprietário' }, e.destino === 'proprietario' ? 'proprietario' : 'terceiro')}</select>
    <button type="button" class="lc-btn lc-btn-p" data-acao="lcEncargoMenos" aria-label="Remover encargo">×</button>`;
  caixa.appendChild(div);
}
function mostrarGarantia() {
  const t = /** @type {HTMLSelectElement|null} */ (document.getElementById('lk-gtipo'));
  if (!t) return;
  const g = t.value;
  $('lk-gvalor-w').hidden = !['caucao', 'seguro_fianca', 'cessao_cotas'].includes(g);
  $('lk-fiador-w').hidden = g !== 'fiador';
  $('lk-gdet-w').hidden = g === 'nenhuma';
  $('lk-gdica').textContent =
    g === 'caucao'
      ? 'Caução em dinheiro: até 3 aluguéis, depositada em poupança; o rendimento é do inquilino (art. 38).'
      : g === 'fiador'
        ? 'Se o contrato virar prazo indeterminado, o fiador pode se exonerar e responde por mais 120 dias (art. 40, X).'
        : g === 'seguro_fianca'
          ? 'O seguro deve cobrir todas as obrigações do inquilino (art. 41). Informe seguradora e apólice nos detalhes.'
          : '';
}

// ─── Reajuste, renovação, encerramento e a ficha do contrato (fase 2) ───────
const primeiroDoMes = () => hojeISO().slice(0, 7) + '-01';
/** 'pendente' | 'aplicado' | null para o reajuste do mês corrente (mesma regra do banco). */
function reajusteDoMes(/** @type {any} */ c) {
  if (c.status !== 'ativo' || c.indice_reajuste === 'NENHUM') return null;
  const m = Number(c.mes_reajuste) || Number(String(c.data_inicio).slice(5, 7));
  const atual = primeiroDoMes();
  if (Number(atual.slice(5, 7)) !== m) return null;
  if (somaMeses(String(c.data_inicio).slice(0, 7) + '-01', 12) > atual || atual >= fimContrato(c))
    return null;
  return G.aditivos.some(a => a.contrato_id === c.id && a.tipo === 'reajuste' && a.referencia === atual)
    ? 'aplicado'
    : 'pendente';
}
function indicesResumo() {
  const ult = ['IGPM', 'IPCA', 'INPC']
    .map(k => {
      const m = G.indices
        .filter(x => x.indice === k)
        .sort((a, b) => String(b.mes).localeCompare(String(a.mes)))[0];
      return m ? `${INDICE_NOME[k]} até ${mes(m.mes)}` : null;
    })
    .filter(Boolean);
  return ult.length
    ? `Índices do Banco Central: ${esc(ult.join(' · '))}. Atualizam sozinhos a cada 6 horas.`
    : 'Índices do Banco Central ainda não carregados: atualizam sozinhos a cada 6 horas.';
}
const previaTexto = (/** @type {any} */ c, /** @type {any} */ p) => {
  if (!p || !p.devido) return 'Sem reajuste devido agora.';
  const quando = `Reajuste de ${mes(p.devido)}`;
  if (p.aplicado) return `${quando} já aplicado.`;
  if (p.percentual == null)
    return `${quando} devido: o ${INDICE_NOME[c.indice_reajuste]} acumulado ainda não foi publicado. Dá para aplicar informando o percentual.`;
  const pct = Number(p.acumulado).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  return `${quando}: ${INDICE_NOME[c.indice_reajuste]} acumulado de ${pct}% (12 meses até ${mes(p.referencia_ate)})${
    Number(p.acumulado) < 0 ? ', negativo: o aluguel é mantido' : ''
  }. ${brl(p.valor_antes)} → ${brl(p.valor_depois)}.`;
};

function abrirContrato(/** @type {string} */ id) {
  const c = contrato(id);
  if (!c) return;
  const ativo = c.status === 'ativo';
  const fechado = c.status === 'encerrado' || c.status === 'rescindido';
  const b = (/** @type {string} */ acao, /** @type {string} */ rot, extra = '', cls = '') =>
    `<button type="button" class="lc-btn lc-btn-p ${cls}" data-acao="${acao}" data-id="${esc(c.id)}" ${extra}>${esc(rot)}</button>`;
  const historico = G.aditivos
    .filter(a => a.contrato_id === c.id)
    .map(a => {
      const txt =
        a.tipo === 'reajuste'
          ? `Reajuste ${a.origem === 'automatico' ? 'automático' : 'manual'} de ${mes(a.referencia)}: ${Number(a.percentual).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}% · ${brl(a.valor_antes)} → ${brl(a.valor_depois)}`
          : a.tipo === 'renovacao'
            ? `Renovação: prazo ${a.prazo_antes} → ${a.prazo_depois} meses · ${brl(a.valor_antes)} → ${brl(a.valor_depois)}`
            : `Rescisão em ${data(a.data)}: multa ${brl((a.detalhe || {}).multa_cobrada)}${Number((a.detalhe || {}).proporcional_cobrado) ? ` + proporcional ${brl(a.detalhe.proporcional_cobrado)}` : ''}`;
      return `<li><span>${esc(txt)}${a.observacao ? `<small>${esc(a.observacao)}</small>` : ''}</span><small>${esc(data(a.criado_em))}</small></li>`;
    });
  const vist = G.vistorias
    .filter(v => v.contrato_id === c.id)
    .map(
      v =>
        `<li><span>Vistoria de ${esc({ entrada: 'entrada', saida: 'saída', periodica: 'periódica' }[v.tipo] || v.tipo)} · ${esc(data(v.data))}</span><button type="button" class="lc-btn lc-btn-p" data-acao="lcVistAbrir" data-id="${esc(v.id)}">${v.status === 'concluida' ? 'Ver laudo' : 'Editar'}</button></li>`
    );
  abrirModal(
    `Contrato ${idContrato(c)}`,
    `<dl class="lc-ficha">
      <dt>Imóvel</dt><dd>${esc(nomeImovel(imovel(c.imovel_id)))}</dd>
      <dt>Inquilino</dt><dd>${esc((pessoa(c.inquilino_id) || {}).nome || '—')}</dd>
      <dt>Aluguel</dt><dd>${esc(brl(c.valor_aluguel))} · vence dia ${esc(String(c.dia_vencimento))}</dd>
      <dt>Vigência</dt><dd>${esc(data(c.data_inicio))} a ${esc(data(fimContrato(c)))} (${esc(String(c.prazo_meses))} meses)</dd>
      <dt>Garantia</dt><dd>${esc(GARANTIA[c.garantia_tipo] || c.garantia_tipo)}</dd>
      <dt>Reajuste</dt><dd>${esc(INDICE_NOME[c.indice_reajuste])}${c.indice_reajuste !== 'NENHUM' ? ` · ${c.reajuste_auto ? 'automático' : 'manual'}` : ''}</dd>
      <dt>Situação</dt><dd>${esc(ST_CONTRATO[c.status] || c.status)}${c.encerrado_em ? ` em ${esc(data(c.encerrado_em))}` : ''}</dd>
    </dl>
    ${ativo ? `<div class="lc-previa" id="lc-reaj-box" data-id="${esc(c.id)}"><span>Consultando o reajuste…</span></div>` : ''}
    <div class="lc-ficha-acoes">
      ${b('lcDocumento', 'Documento do contrato')}
      ${ativo ? b('lcGerarDoContrato', `Gerar cobrança ${mes(G.filtro.competencia)}`) : ''}
      ${ativo ? b('lcLancar', 'Lançar despesa') : ''}
      ${ativo && c.indice_reajuste !== 'NENHUM' ? b('lcReajustar', 'Reajuste') : ''}
      ${ativo ? b('lcRenovar', 'Renovar') : ''}
      ${b('lcVistNova', ativo ? 'Vistoria de entrada' : 'Vistoria de saída', `data-imovel="${esc(c.imovel_id)}" data-contrato="${esc(c.id)}" data-tipo="${ativo ? 'entrada' : 'saida'}"`)}
      ${fechado ? b('lcDocumento', 'Termo de entrega de chaves', 'data-tipo="entrega_chaves"') : ''}
      ${ativo ? b('lcEncerrar', 'Encerrar ou rescindir', '', 'lc-perigo') : ''}
    </div>
    <h3 class="lc-ficha-h">Histórico</h3>${historico.length ? `<ul class="lc-lista">${historico.join('')}</ul>` : '<p class="lc-dica">Sem reajustes, renovações ou rescisão ainda.</p>'}
    <h3 class="lc-ficha-h">Vistorias</h3>${vist.length ? `<ul class="lc-lista">${vist.join('')}</ul>` : '<p class="lc-dica">Nenhuma vistoria deste contrato.</p>'}`,
    null
  );
  if (ativo)
    rpc('a1_lc_reajuste_previa', { p_contrato: c.id })
      .then(p => {
        const box = document.getElementById('lc-reaj-box');
        if (box && box.dataset.id === c.id) box.innerHTML = `<span>${esc(previaTexto(c, p))}</span>`;
      })
      .catch(() => {
        const box = document.getElementById('lc-reaj-box');
        if (box) box.innerHTML = '<span>Não foi possível consultar o reajuste agora.</span>';
      });
}

function formReajuste(/** @type {string} */ id) {
  const c = contrato(id);
  if (!c) return;
  abrirModal(
    `Reajuste · ${idContrato(c)}`,
    `<div class="lc-form">
      <div class="lc-largo lc-previa" id="lc-reaj-box" data-id="${esc(c.id)}"><span>Consultando o índice…</span></div>
      <label>Percentual (%)<input id="lr-pct" inputmode="decimal" placeholder="usar o índice"></label>
      <p class="lc-largo lc-dica">Deixe em branco para aplicar o índice acumulado (variação negativa mantém o aluguel). Informe outro valor só se foi negociado. Fica registrado no histórico do contrato.</p>
    </div>`,
    async () => {
      const t = campo('lr-pct');
      const pct = t ? num(t) : null;
      if (t && !Number.isFinite(pct)) throw new Error('Percentual inválido.');
      const r = await rpc('a1_lc_aplicar_reajuste', { p_contrato: c.id, p_percentual: pct });
      aviso(`Aluguel reajustado: ${brl(r.valor_antes)} → ${brl(r.valor_depois)}.`);
    },
    'Aplicar reajuste'
  );
  rpc('a1_lc_reajuste_previa', { p_contrato: c.id })
    .then(p => {
      const box = document.getElementById('lc-reaj-box');
      if (box && box.dataset.id === c.id) box.innerHTML = `<span>${esc(previaTexto(c, p))}</span>`;
    })
    .catch(() => {});
}

function formRenovar(/** @type {string} */ id) {
  const c = contrato(id);
  if (!c) return;
  abrirModal(
    `Renovar · ${idContrato(c)}`,
    `<div class="lc-form">
      <p class="lc-largo">Termina hoje em <b>${esc(data(fimContrato(c)))}</b> · aluguel ${esc(brl(c.valor_aluguel))}</p>
      <label>Acrescentar (meses) *<input id="lw-meses" type="number" min="1" max="120" value="12"></label>
      <label>Novo aluguel (R$)<input id="lw-valor" inputmode="decimal" placeholder="manter"></label>
      <label class="lc-largo">Observação<input id="lw-obs" maxlength="1000" placeholder="Ex.: aditivo assinado em ..."></label>
    </div>`,
    async () => {
      const meses = Number(campo('lw-meses'));
      const v = campo('lw-valor') ? num(campo('lw-valor')) : null;
      if (!Number.isInteger(meses) || meses < 1 || meses > 120) throw new Error('De 1 a 120 meses.');
      if (v != null && (!Number.isFinite(v) || v <= 0)) throw new Error('Novo aluguel inválido.');
      const r = await rpc('a1_lc_renovar_contrato', {
        p_contrato: c.id,
        p_meses: meses,
        p_novo_valor: v,
        p_observacao: campo('lw-obs') || null
      });
      aviso(`Contrato renovado: ${r.prazo_meses} meses no total.`);
    },
    'Renovar'
  );
}

function formEncerrar(/** @type {string} */ id) {
  const c = contrato(id);
  if (!c) return;
  const hoje = hojeISO();
  const fim = fimContrato(c);
  abrirModal(
    `Encerrar ${idContrato(c)}`,
    `<div class="lc-form" id="le-box" data-id="${esc(c.id)}">
      <label>Motivo<select id="le-motivo" data-acao-change="lcRescisaoCalc">${opcoes({ encerrado: 'Fim do contrato / acordo sem multa', rescindido: 'Rescisão antecipada' }, dias(hoje, fim) > 0 ? 'rescindido' : 'encerrado')}</select></label>
      <label>Data da saída<input type="date" id="le-data" value="${esc(hoje)}" data-acao-change="lcRescisaoCalc"></label>
      <p class="lc-largo lc-dica">Termina em ${esc(data(fim))}. Ao encerrar, o imóvel volta para Disponível e as cobranças em aberto dos meses seguintes são canceladas.</p>
      <fieldset class="lc-largo" id="le-resc"><legend>Rescisão (Lei 8.245, art. 4º)</legend>
        <div class="lc-form">
          <p class="lc-largo lc-dica" id="le-calc">Calculando…</p>
          <label>Multa rescisória (R$)<input id="le-multa" inputmode="decimal"></label>
          <label>Vencimento da cobrança<input type="date" id="le-venc"></label>
          <label class="lc-check lc-largo"><input type="checkbox" id="le-prop" checked> <span id="le-prop-txt">Cobrar o aluguel proporcional dos dias do mês</span></label>
        </div>
        <p class="lc-dica">Multa e proporcional vão numa cobrança avulsa, que segue para baixa e repasse. Multa zero quando o inquilino é transferido pelo empregador (art. 4º, parágrafo único).</p>
      </fieldset>
    </div>`,
    async () => {
      const dt = campo('le-data');
      if (!dt) throw new Error('Informe a data.');
      if (campo('le-motivo') === 'encerrado') {
        await rpc('a1_lc_encerrar_contrato', { p_contrato: c.id, p_data: dt, p_motivo: 'encerrado' });
        aviso('Contrato encerrado.');
        return;
      }
      const m = campo('le-multa') ? num(campo('le-multa')) : null;
      if (m != null && (!Number.isFinite(m) || m < 0)) throw new Error('Multa inválida.');
      const r = await rpc('a1_lc_rescindir_contrato', {
        p_contrato: c.id,
        p_data: dt,
        p_multa: m,
        p_proporcional: /** @type {HTMLInputElement} */ ($('le-prop')).checked,
        p_vencimento: campo('le-venc') || null
      });
      aviso(
        r.cobranca_id
          ? `Contrato rescindido. Cobrança avulsa de ${brl(Number(r.multa) + Number(r.proporcional))} criada.`
          : 'Contrato rescindido, sem cobrança.'
      );
    },
    'Encerrar'
  );
  calcularRescisao();
}
async function calcularRescisao() {
  const box = document.getElementById('le-box');
  if (!box) return;
  const resc = campo('le-motivo') === 'rescindido';
  $('le-resc').hidden = !resc;
  if (!resc) return;
  const dt = campo('le-data');
  if (!dt) return;
  /** @type {HTMLInputElement} */ ($('le-venc')).value = somaDias(dt, 10);
  try {
    const r = await rpc('a1_lc_rescisao_calculo', { p_contrato: box.dataset.id, p_data: dt });
    if (campo('le-data') !== dt) return;
    $('le-calc').textContent =
      `Faltam ${r.meses_restantes} de ${r.prazo} meses: ${brl(r.multa)} de multa proporcional.` +
      (Number(r.proporcional) ? '' : ' A cobrança mensal deste mês já existe: sem proporcional.');
    /** @type {HTMLInputElement} */ ($('le-multa')).value = String(r.multa);
    $('le-prop-txt').textContent = Number(r.proporcional)
      ? `Cobrar o aluguel proporcional: ${r.dias} dia(s), ${brl(r.proporcional)}`
      : 'Sem aluguel proporcional (a cobrança do mês já existe)';
  } catch (e) {
    $('le-calc').textContent = /** @type {Error} */ (e).message;
  }
}
const somaDias = (/** @type {string} */ iso, /** @type {number} */ n) =>
  new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function formLancamento(/** @type {string} */ id) {
  const c = contrato(id);
  if (!c) return;
  const donos = G.donos.filter(d => d.imovel_id === c.imovel_id);
  abrirModal(
    'Lançar despesa ou crédito do proprietário',
    `<div class="lc-form">
      <label class="lc-largo">Descrição *<input id="ll-desc" maxlength="200" placeholder="Ex.: Conserto do chuveiro"></label>
      <label>Tipo<select id="ll-tipo">${opcoes({ despesa: 'Despesa (desconta do proprietário)', credito: 'Crédito (soma ao proprietário)' }, 'despesa')}</select></label>
      <label>Valor (R$) *<input id="ll-valor" inputmode="decimal"></label>
      <label class="lc-largo">De quem<select id="ll-dono"><option value="">Todos os proprietários, pela parte de cada um</option>${donos
        .map(
          d => `<option value="${esc(d.pessoa_id)}">${esc((pessoa(d.pessoa_id) || {}).nome || '—')}</option>`
        )
        .join('')}</select></label>
      <p class="lc-largo lc-dica">Entra no próximo repasse deste contrato (quando a próxima cobrança for baixada).</p>
    </div>`,
    async () => {
      const desc = campo('ll-desc');
      const v = num(campo('ll-valor'));
      if (desc.length < 2) throw new Error('Informe a descrição.');
      if (!Number.isFinite(v) || v <= 0) throw new Error('Informe o valor.');
      await gravar(
        'a1_lc_lancamentos',
        {
          tenant_id: c.tenant_id,
          contrato_id: c.id,
          proprietario_id: campo('ll-dono') || null,
          descricao: desc,
          valor: campo('ll-tipo') === 'credito' ? -v : v
        },
        null
      );
      aviso('Lançamento registrado. Entra no próximo repasse.');
    }
  );
}

function formBaixa(/** @type {string} */ id) {
  const b = G.cobrancas.find(x => x.id === id);
  if (!b) return;
  const c = contrato(b.contrato_id);
  abrirModal(
    'Baixar pagamento',
    `<div class="lc-form">
      <p class="lc-largo"><b>${esc((pessoa(c && c.inquilino_id) || {}).nome || '')}</b> · competência ${esc(mes(b.competencia))} · vencimento ${esc(data(b.vencimento))} · ${esc(brl(b.valor_total))}</p>
      <label>Pago em *<input type="date" id="lb-data" value="${esc(hojeISO())}" data-acao-change="lcBaixaPrevia"></label>
      <label>Forma<select id="lb-forma">${opcoes(FORMAS, 'pix')}</select></label>
      <label>Desconto (R$)<input id="lb-desc" inputmode="decimal" value="0" data-acao-input="lcBaixaPrevia"></label>
      <label class="lc-check"><input type="checkbox" id="lb-isentar" data-acao-change="lcBaixaPrevia"> Isentar multa e juros</label>
      <div class="lc-largo lc-previa" id="lb-previa" data-id="${esc(b.id)}"></div>
    </div>`,
    async () => {
      const desc = num(campo('lb-desc') || '0');
      if (!Number.isFinite(desc) || desc < 0) throw new Error('Desconto inválido.');
      const r = await rpc('a1_lc_baixar_cobranca', {
        p_cobranca: b.id,
        p_pago_em: campo('lb-data'),
        p_forma: campo('lb-forma'),
        p_versao: b.versao,
        p_desconto: desc,
        p_isentar_multa: /** @type {HTMLInputElement} */ ($('lb-isentar')).checked
      });
      aviso(`Pagamento de ${brl(r.valor_pago)} baixado. ${r.repasses || 0} repasse(s) gerado(s).`);
    },
    'Baixar'
  );
  previaBaixa();
}
/** A mesma conta do banco (a1_lc_baixar_cobranca), só para mostrar antes. */
function previaBaixa() {
  const el = document.getElementById('lb-previa');
  if (!el) return;
  const b = G.cobrancas.find(x => x.id === el.dataset.id);
  const c = b && contrato(b.contrato_id);
  if (!b || !c) return;
  const pago = campo('lb-data');
  const d = pago ? Math.max(0, dias(b.vencimento, pago)) : 0;
  const isentar = /** @type {HTMLInputElement} */ ($('lb-isentar')).checked;
  const multa = d > 0 && !isentar ? Math.round(Number(b.valor_total) * Number(c.multa_atraso_pct)) / 100 : 0;
  const juros =
    d > 0 && !isentar
      ? Math.round(((Number(b.valor_total) * Number(c.juros_mes_pct)) / 100 / 30) * d * 100) / 100
      : 0;
  const desc = num(campo('lb-desc') || '0') || 0;
  el.innerHTML = `<span>${d > 0 ? `${esc(String(d))} dia(s) de atraso · multa ${esc(brl(multa))} + juros ${esc(brl(juros))}` : 'Em dia: sem multa nem juros'}${desc ? ` · desconto ${esc(brl(desc))}` : ''}</span>
    <b>${esc(brl(Number(b.valor_total) + multa + juros - desc))}</b>`;
}

function formCancelar(/** @type {string} */ id) {
  const b = G.cobrancas.find(x => x.id === id);
  if (!b) return;
  abrirModal(
    'Cancelar cobrança',
    `<div class="lc-form"><label class="lc-largo">Motivo *<input id="lx-motivo" maxlength="300" placeholder="Ex.: carência negociada"></label>
      <p class="lc-largo lc-dica">A cobrança cancelada não gera repasse. Se precisar, gere de novo depois.</p></div>`,
    async () => {
      await rpc('a1_lc_cancelar_cobranca', {
        p_cobranca: b.id,
        p_versao: b.versao,
        p_motivo: campo('lx-motivo')
      });
      aviso('Cobrança cancelada.');
    },
    'Cancelar cobrança'
  );
}

function formPagarRepasse(/** @type {string} */ id) {
  const r = G.repasses.find(x => x.id === id);
  if (!r) return;
  const p = pessoa(r.proprietario_id) || {};
  abrirModal(
    'Marcar repasse como pago',
    `<div class="lc-form">
      <p class="lc-largo"><b>${esc(p.nome || '')}</b> · ${esc(brl(r.valor_liquido))}${p.pix ? `<br>PIX: ${esc(p.pix)}` : ''}${p.banco ? `<br>${esc(p.banco)}` : ''}</p>
      <label>Pago em *<input type="date" id="lr-data" value="${esc(hojeISO())}"></label>
    </div>`,
    async () => {
      await rpc('a1_lc_pagar_repasse', { p_repasse: r.id, p_pago_em: campo('lr-data') });
      aviso('Repasse marcado como pago.');
    },
    'Marcar pago'
  );
}

// ─── Início ──────────────────────────────────────────────────────────────────
async function init() {
  let user;
  try {
    user = a1RequireAuth();
  } catch {
    return;
  }
  // Locação é do gestor: o banco só abre as tabelas para quem não é parceiro.
  if (user.role === 'partner') {
    location.href = `/${encodeURIComponent(A1.slug || '')}/dashboard`;
    return;
  }
  try {
    await a1RequireModule('LOCACAO');
  } catch {
    return;
  }
  const v = new URLSearchParams(location.search).get('vista') || 'painel';
  G.vista = VISTAS[v] ? v : 'painel';
  await a1MontarShell(document.getElementById('sb-casco'), {
    ativo: 'LOCACAO',
    sub: Object.entries(VISTAS).map(([k, [rot]]) => ({
      rot,
      chave: k,
      ativo: k === G.vista,
      acao: 'lcVista'
    }))
  });
  a1StartHeartbeat('locacao');
  ganchos.redesenhar = desenhar;
  await carregar().catch(() => aviso('Não foi possível carregar a Locação agora.', 'erro'));
  desenhar();
}

init();
