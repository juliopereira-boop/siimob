// ─── Módulo Financeiro (financeiro) · fase 1 ─────────────────────────────────
//
// O PEDIDO DO DONO
//   "crie o modulo financeiro (...) completo, ligado aos demais modulos (...)
//    principalmente comissao, calcular as regras de comissao certinho".
//
// COMO FUNCIONA
//   - Os negócios nascem nos outros módulos (banco: 2026-11-26_financeiro.sql):
//     lead no GANHO (sem o módulo Venda), venda no VENDIDO, Repasse/Registro na
//     etapa escolhida em Cadastros, e a taxa de administração da Locação.
//     Também dá para lançar um negócio à mão.
//   - Cada negócio recebe as comissões pelas Regras: o que a empresa recebe e
//     o que ela paga a cada participante. A comissão "ao receber" libera na
//     proporção do que a empresa já recebeu; a liberada vira conta a pagar.
//   - Gestor (ou parceiro com gerir_financeiro) vê tudo. O parceiro sem a
//     permissão vê só "Minhas comissões" (a1_fin_minhas_comissoes).
//   - Dinheiro (baixa, estorno, recálculo, cancelamento, liberação) passa por
//     função. Tudo que vem do banco passa por esc().
import { A1 } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import { hojeISO } from '../../shared/utils/datas.js';
import { a1RequireAuth, a1RequireModule, a1StartHeartbeat } from '../../shared/auth/auth.js';
import { a1MontarShell } from '../../shared/ui/modulo-shell.js';
import '../../shared/ui/avisos.js';
import { acoes } from '../../shared/ui/acoes.js';
import { F } from '../../modules/financeiro/ctx.js';
import {
  vistaCarteira,
  botoesCarteira,
  filtrosCarteira,
  cadastrosCarteira,
  ERROS_CARTEIRA
} from '../../modules/financeiro/carteira.js';
import {
  vistaConciliacao,
  botoesConciliacao,
  filtrosConciliacao,
  ERROS_CONCILIACAO
} from '../../modules/financeiro/conciliacao.js';
import {
  vistaDre,
  botoesDre,
  filtrosDre,
  cadastrosCentros,
  GRUPOS,
  grupoPadrao
} from '../../modules/financeiro/dre.js';

const VISTAS = /** @type {Record<string,[string,string]>} */ ({
  painel: ['Painel', 'O caixa do mês, o que vence e as comissões a pagar.'],
  negocios: [
    'Negócios',
    'Cada venda ou serviço que gera comissão, vindo dos outros módulos ou lançado à mão.'
  ],
  comissoes: [
    'Comissões',
    'O que a empresa recebe e o que ela paga a cada participante, com a regra que gerou.'
  ],
  carteira: [
    'Carteira',
    'As parcelas de cada venda direta, com correção, atraso e o valor do dia para receber.'
  ],
  receber: ['A receber', 'Contas a receber: comissões, honorários, taxa de administração e outras receitas.'],
  pagar: ['A pagar', 'Contas a pagar: comissões liberadas e despesas da empresa.'],
  conciliacao: ['Conciliação', 'O extrato do banco (OFX) casado com os lançamentos e as parcelas.'],
  fluxo: ['Fluxo de caixa', 'Realizado e previsto, mês a mês, e o saldo de cada conta.'],
  dre: ['DRE', 'Demonstração do resultado por caixa ou competência, com o orçado ao lado.'],
  regras: ['Regras de comissão', 'Quem recebe quanto, sobre qual base e quando libera.'],
  cadastros: ['Cadastros', 'Contas, categorias e as etapas dos outros módulos que alimentam o Financeiro.']
});
const VISTA_PARCEIRO = /** @type {[string,string]} */ ([
  'Minhas comissões',
  'As comissões em que você é o beneficiário: previstas, liberadas e pagas.'
]);
const PAPEIS = /** @type {Record<string,string>} */ ({
  empresa: 'Empresa',
  corretor: 'Corretor',
  captador: 'Captador',
  coordenador: 'Coordenador',
  imobiliaria: 'Imobiliária parceira',
  correspondente: 'Correspondente',
  cca: 'CCA',
  analista: 'Analista',
  indicador: 'Indicador',
  outro: 'Outro'
});
const ORIGENS = /** @type {Record<string,string>} */ ({
  crm: 'Leads (Ganho)',
  comercial: 'Venda (Vendido)',
  repasse: 'Repasse',
  registro: 'Registro',
  manual: 'Manual'
});
const BASES = /** @type {Record<string,string>} */ ({
  valor: 'Valor do negócio',
  valor_financiado: 'Valor financiado',
  comissao_empresa: 'Comissão da empresa'
});
const LIBERACAO = /** @type {Record<string,string>} */ ({
  recebimento: 'Ao receber',
  venda: 'Na venda',
  assinatura: 'Na assinatura'
});
const ST_COM = /** @type {Record<string,string>} */ ({
  prevista: 'Prevista',
  liberada: 'Liberada',
  paga: 'Paga',
  cancelada: 'Cancelada'
});
const FORMAS = /** @type {Record<string,string>} */ ({
  pix: 'PIX',
  boleto: 'Boleto',
  transferencia: 'Transferência',
  dinheiro: 'Dinheiro',
  cartao: 'Cartão',
  cheque: 'Cheque',
  outro: 'Outro'
});
const TIPOS_CONTA = /** @type {Record<string,string>} */ ({
  banco: 'Conta bancária',
  caixa: 'Caixa',
  carteira: 'Carteira digital',
  aplicacao: 'Aplicação'
});
const ERROS = /** @type {Record<string,string>} */ ({
  sem_permissao: 'Só o gestor (ou quem tem a permissão do Financeiro) pode fazer isso.',
  negocio_com_pagamento: 'Este negócio já tem pagamento: não dá para editar nem recalcular. Estorne antes.',
  negocio_nao_encontrado: 'Negócio não encontrado (ou já cancelado).',
  comissao_ja_paga: 'Isto desfaria uma comissão que já foi paga. Estorne o pagamento da comissão antes.',
  comissao_ja_liberada: 'Esta comissão já está liberada por inteiro.',
  comissao_invalida: 'Comissão inválida para esta ação.',
  lancamento_nao_aberto: 'Este lançamento não está mais em aberto. A tela foi atualizada.',
  lancamento_nao_pago: 'Este lançamento não está pago.',
  lancamento_nao_encontrado: 'Lançamento não encontrado.',
  lancamento_do_sistema: 'Lançamento gerado pelo sistema: cancele pelo negócio.',
  estorne_na_locacao: 'Esta receita vem da Locação: estorne a cobrança lá.',
  versao_desatualizada:
    'Outra pessoa mexeu neste lançamento agora. A tela foi atualizada; confira e tente de novo.',
  valor_invalido: 'Valor inválido.',
  data_invalida: 'Data inválida (não pode ser futura).',
  forma_invalida: 'Forma de pagamento inválida.',
  motivo_obrigatorio: 'Informe o motivo.',
  ja_tem_regras: 'Você já tem regras: as regras-modelo só entram quando não há nenhuma.',
  referencia_de_outro_cliente: 'Registro de outra empresa.',
  a1_fin_regra_coerente:
    'Confira a regra: "receber" é sempre da empresa; base "comissão da empresa" só para pagar; informe o percentual ou o valor fixo.',
  periodo_invalido: 'Período inválido (no máximo 3 anos).',
  dados_invalidos: 'Confira os dados informados.',
  ...ERROS_CARTEIRA,
  ...ERROS_CONCILIACAO,
  'row-level security': 'Sem permissão para gravar isto.'
});

const G = {
  gestor: false,
  vista: 'painel',
  config: /** @type {any} */ ({}),
  contas: /** @type {any[]} */ ([]),
  categorias: /** @type {any[]} */ ([]),
  negocios: /** @type {any[]} */ ([]),
  participantes: /** @type {any[]} */ ([]),
  regras: /** @type {any[]} */ ([]),
  comissoes: /** @type {any[]} */ ([]),
  lancamentos: /** @type {any[]} */ ([]),
  parceiros: /** @type {any[]} */ ([]),
  etapas: /** @type {any[]} */ ([]),
  minhas: /** @type {any[]} */ ([]),
  // fase 2
  centros: /** @type {any[]} */ ([]),
  carteiras: /** @type {any[]} */ ([]),
  resumo: /** @type {Map<string, any>} */ (new Map()),
  cartCfg: /** @type {any[]} */ ([]),
  empreendimentos: /** @type {any[]} */ ([]),
  extrato: /** @type {any[]} */ ([]),
  extratos: /** @type {any[]} */ ([]),
  filtro: /** @type {any} */ ({
    mes: hojeISO().slice(0, 7),
    status: 'todas',
    busca: '',
    direcao: 'pagar',
    cart: 'ativa',
    ext: 'pendente',
    contaExt: '',
    dreDe: '',
    dreAte: '',
    regime: 'caixa',
    centro: ''
  }),
  salvar: /** @type {null|(() => Promise<any>)} */ (null),
  ocupado: false
};
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

// ─── Formatação ──────────────────────────────────────────────────────────────
const brl = (/** @type {any} */ v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (/** @type {string|null|undefined} */ d) =>
  d ? d.slice(0, 10).split('-').reverse().join('/') : '';
const mes = (/** @type {string} */ d) => {
  const [a, m] = String(d || '').split('-');
  return a && m ? `${m}/${a}` : '';
};
const num = (/** @type {string} */ s) => {
  const t = String(s ?? '').trim();
  if (!t) return NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};
const pct = (/** @type {any} */ v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
const somaMes = (/** @type {string} */ ym, /** @type {number} */ n) => {
  const [a, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const idNeg = (/** @type {any} */ n) => (n && n.seq ? `NG-${String(n.seq).padStart(4, '0')}` : 'NG-····');
const negocio = (/** @type {string|null} */ id) => G.negocios.find(n => n.id === id) || null;
const categoria = (/** @type {string|null} */ id) => G.categorias.find(c => c.id === id) || null;
const conta = (/** @type {string|null} */ id) => G.contas.find(c => c.id === id) || null;
const selo = (/** @type {string} */ tipo, /** @type {string} */ texto) =>
  `<span class="lc-selo lc-selo-${esc(tipo)}">${esc(texto)}</span>`;
const vencido = (/** @type {any} */ l) => l.status === 'aberto' && l.vencimento < hojeISO();
const stLanc = (/** @type {any} */ l) => (vencido(l) ? 'vencido' : l.status);
const ROT_LANC = /** @type {Record<string,string>} */ ({
  aberto: 'Em aberto',
  vencido: 'Vencido',
  pago: 'Pago',
  cancelado: 'Cancelado'
});
const seloLanc = (/** @type {any} */ l) => {
  const s = stLanc(l);
  return selo(s === 'pago' ? 'ok' : s === 'vencido' ? 'erro' : s === 'aberto' ? 'info' : 'off', ROT_LANC[s]);
};
const seloCom = (/** @type {any} */ c) =>
  selo(
    c.status === 'paga'
      ? 'ok'
      : c.status === 'liberada'
        ? 'alerta'
        : c.status === 'prevista'
          ? 'info'
          : 'off',
    ST_COM[c.status] || c.status
  );

function aviso(/** @type {string} */ msg, tipo = 'ok') {
  const d = document.createElement('div');
  d.className = `lc-toast lc-toast-${tipo}`;
  d.textContent = msg;
  $('lc-toasts').appendChild(d);
  setTimeout(() => d.remove(), 4500);
}
async function motivo(/** @type {Response} */ r) {
  const t = await r.text().catch(() => '');
  const chave = Object.keys(ERROS).find(k => t.includes(k));
  return chave ? ERROS[chave] : 'Não foi possível concluir agora. Confira os dados e tente de novo.';
}

// ─── Banco ───────────────────────────────────────────────────────────────────
async function ler(/** @type {string} */ tabela, /** @type {string} */ consulta) {
  const r = await A1.buscarTudo(`${A1.rest(tabela)}?${consulta}`);
  return (r && r.linhas) || [];
}
async function carregar() {
  if (!G.gestor) {
    G.minhas = await rpc('a1_fin_minhas_comissoes', {}).catch(() => []);
    return;
  }
  const [
    config,
    contas,
    categorias,
    negocios,
    participantes,
    regras,
    comissoes,
    lancamentos,
    parceiros,
    etapas
  ] = await Promise.all([
    ler('a1_fin_config', 'select=*'),
    ler('a1_fin_contas', 'select=*&order=criado_em.asc,id.asc'),
    ler('a1_fin_categorias', 'select=*&order=tipo.asc,nome.asc,id.asc'),
    ler('a1_fin_negocios', 'select=*&order=criado_em.desc,id.desc'),
    ler('a1_fin_participantes', 'select=*&order=negocio_id.asc'),
    ler('a1_fin_regras', 'select=*&order=criado_em.asc,id.asc'),
    ler('a1_fin_comissoes', 'select=*&order=criado_em.desc,id.desc'),
    ler('a1_fin_lancamentos', 'select=*&order=vencimento.asc,id.asc'),
    ler('a1_partners', 'select=id,name,type&order=name.asc,id.asc'),
    ler(
      'a1_stages',
      'select=id,name,module_key,position&module_key=in.(repasse,registro)&order=position.asc,id.asc'
    )
  ]);
  // Fase 2: uma falha aqui (tabela ainda não criada) não derruba a fase 1.
  const desde = somaDias(hojeISO(), -120);
  const f2 = (/** @type {Promise<any>} */ pr) => pr.catch(() => []);
  // Extrato: pendentes de qualquer data + o resto dos últimos 120 dias (duas
  // leituras: buscarTudo já usa o "or" da paginação).
  const [centros, carteiras, resumo, cartCfg, empreendimentos, pendentes, recentes, extratos] =
    await Promise.all([
      f2(ler('a1_fin_centros', 'select=*&order=nome.asc,id.asc')),
      f2(ler('a1_fin_carteiras', 'select=*&order=seq.desc,id.desc')),
      f2(rpc('a1_fin_carteiras_resumo', {})),
      f2(ler('a1_fin_carteira_cfg', 'select=*')),
      f2(ler('a1_developments', 'select=id,name&order=name.asc,id.asc')),
      f2(ler('a1_fin_extrato_itens', 'select=*&status=eq.pendente&order=data.desc,id.desc')),
      f2(
        ler('a1_fin_extrato_itens', `select=*&status=neq.pendente&data=gte.${desde}&order=data.desc,id.desc`)
      ),
      f2(
        ler(
          'a1_fin_extratos',
          'select=id,conta_id,arquivo,inicio,fim,itens,novos,criado_em&order=criado_em.desc,id.desc'
        )
      )
    ]);
  Object.assign(G, {
    centros,
    carteiras,
    resumo: new Map((Array.isArray(resumo) ? resumo : []).map((/** @type {any} */ r) => [r.carteira_id, r])),
    cartCfg,
    empreendimentos,
    extrato: [...pendentes, ...recentes].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0)),
    extratos,
    config: config[0] || {},
    contas,
    categorias,
    negocios,
    participantes,
    regras,
    comissoes,
    lancamentos,
    parceiros,
    etapas
  });
}
async function rpc(/** @type {string} */ fn, /** @type {any} */ args) {
  const r = await fetch(A1.rpc(fn), { method: 'POST', headers: A1.headers(), body: JSON.stringify(args) });
  if (!r.ok) throw new Error(await motivo(r));
  return r.json().catch(() => ({}));
}
async function gravar(
  /** @type {string} */ tabela,
  /** @type {any} */ corpo,
  /** @type {string|null} */ id,
  extra = ''
) {
  const r = await fetch(
    id ? `${A1.rest(tabela)}?id=eq.${encodeURIComponent(id)}` : `${A1.rest(tabela)}${extra}`,
    {
      method: id ? 'PATCH' : 'POST',
      headers: extra
        ? A1.headers({ Prefer: 'resolution=merge-duplicates,return=representation' })
        : A1.returnHeaders(),
      body: JSON.stringify(corpo)
    }
  );
  if (!r.ok) throw new Error(await motivo(r));
  const linhas = await r.json().catch(() => []);
  if (id && (!Array.isArray(linhas) || !linhas.length))
    throw new Error('Não foi possível salvar (registro não encontrado ou travado).');
  return Array.isArray(linhas) ? linhas[0] : linhas;
}
async function recarregar() {
  await carregar().catch(() => {});
  desenhar();
}
async function executar(/** @type {() => Promise<any>} */ fn, /** @type {string} */ ok) {
  if (G.ocupado) return;
  G.ocupado = true;
  try {
    await fn();
    if (ok) aviso(ok);
  } catch (e) {
    aviso(/** @type {Error} */ (e).message, 'erro');
  } finally {
    G.ocupado = false;
    await recarregar();
  }
}

// ─── Modal ───────────────────────────────────────────────────────────────────
function abrirModal(
  /** @type {string} */ titulo,
  /** @type {string} */ corpo,
  /** @type {null|(() => Promise<any>)} */ salvar,
  rotulo = 'Salvar'
) {
  $('lc-modal-titulo').textContent = titulo;
  $('lc-modal-corpo').innerHTML = corpo;
  $('lc-modal-erro').hidden = true;
  $('lc-modal-pe').innerHTML = salvar
    ? `<button type="button" class="lc-btn" data-acao="fnFechar">Cancelar</button>
       <button type="button" class="lc-btn lc-btn-forte" data-acao="fnSalvarModal" id="lc-modal-ok">${esc(rotulo)}</button>`
    : '<button type="button" class="lc-btn" data-acao="fnFechar">Fechar</button>';
  G.salvar = salvar;
  $('lc-fundo').hidden = false;
  const primeiro = /** @type {HTMLElement|null} */ (
    $('lc-modal-corpo').querySelector('input,select,textarea')
  );
  if (primeiro) primeiro.focus();
}
function fecharModal() {
  $('lc-fundo').hidden = true;
  G.salvar = null;
}
async function salvarModal() {
  if (!G.salvar || G.ocupado) return;
  const b = /** @type {HTMLButtonElement} */ ($('lc-modal-ok'));
  b.disabled = true;
  G.ocupado = true;
  try {
    const r = await G.salvar();
    if (r !== 'manter') fecharModal();
    G.ocupado = false;
    await recarregar();
  } catch (e) {
    const msg = /** @type {Error} */ (e).message;
    if (msg === ERROS.versao_desatualizada || msg === ERROS.lancamento_nao_aberto) {
      fecharModal();
      aviso(msg, 'erro');
      G.ocupado = false;
      await recarregar();
      return;
    }
    $('lc-modal-erro').textContent = msg;
    $('lc-modal-erro').hidden = false;
  } finally {
    G.ocupado = false;
    b.disabled = false;
  }
}
const campo = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ ($(id)).value.trim();
const marcado = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ ($(id)).checked;
const opcoes = (/** @type {Record<string,string>} */ m, /** @type {string} */ atual) =>
  Object.entries(m)
    .map(([k, v]) => `<option value="${esc(k)}"${k === atual ? ' selected' : ''}>${esc(v)}</option>`)
    .join('');
const opcoesLista = (/** @type {any[]} */ l, /** @type {string|null} */ atual, vazio = '— nenhum —') =>
  `<option value="">${esc(vazio)}</option>` +
  l
    .map(
      x =>
        `<option value="${esc(x.id)}"${x.id === atual ? ' selected' : ''}>${esc(x.nome || x.name)}</option>`
    )
    .join('');
const tabela = (
  /** @type {string[]} */ cab,
  /** @type {string[]} */ linhas,
  vazio = 'Nada por aqui ainda.'
) =>
  linhas.length
    ? `<div class="lc-tbl"><table><thead><tr>${cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas.join('')}</tbody></table></div>`
    : `<p class="lc-vazio">${esc(vazio)}</p>`;

// ─── Ações ───────────────────────────────────────────────────────────────────
acoes({
  fnVista: el => irPara(el.dataset.vista || 'painel'),
  fnFechar: () => fecharModal(),
  fnFecharFundo: (el, ev) => {
    if (ev.target === el) fecharModal();
  },
  fnSalvarModal: () => salvarModal(),
  fnFiltrar: () => {
    const m = /** @type {HTMLInputElement|null} */ (document.getElementById('fn-f-mes'));
    const s = /** @type {HTMLSelectElement|null} */ (document.getElementById('fn-f-status'));
    const d = /** @type {HTMLSelectElement|null} */ (document.getElementById('fn-f-direcao'));
    const b = /** @type {HTMLInputElement|null} */ (document.getElementById('fn-f-busca'));
    if (m) G.filtro.mes = m.value || G.filtro.mes;
    if (s) G.filtro.status = s.value;
    if (d) G.filtro.direcao = d.value;
    if (b) G.filtro.busca = b.value.trim().toLowerCase();
    const v = (/** @type {string} */ id) =>
      /** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value;
    const novos = /** @type {Record<string,string|undefined>} */ ({
      cart: v('fn-f-cart'),
      ext: v('fn-f-ext'),
      contaExt: v('fn-f-conta'),
      dreDe: v('fn-f-dre-de'),
      dreAte: v('fn-f-dre-ate'),
      regime: v('fn-f-regime'),
      centro: v('fn-f-centro')
    });
    Object.entries(novos).forEach(([k, x]) => {
      if (x !== undefined && (x || k === 'centro')) G.filtro[k] = x;
    });
    desenharConteudo();
  },
  fnRegrasModelo: () =>
    executar(async () => {
      const r = await rpc('a1_fin_regras_modelo', {});
      aviso(`${r.regras} regra(s)-modelo criada(s). Ajuste os percentuais para a sua realidade.`);
    }, ''),
  fnNovaRegra: () => formRegra(null),
  fnEditarRegra: el => formRegra(el.dataset.id || null),
  fnRegraCalculo: () => mostrarCalculo(),
  fnExcluirRegra: el => {
    if (!confirm('Excluir esta regra? Comissões já calculadas não mudam.')) return;
    executar(async () => {
      const r = await fetch(`${A1.rest('a1_fin_regras')}?id=eq.${encodeURIComponent(el.dataset.id || '')}`, {
        method: 'DELETE',
        headers: A1.headers()
      });
      if (!r.ok) throw new Error(await motivo(r));
    }, 'Regra excluída.');
  },
  fnNovoNegocio: () => formNegocio(null),
  fnEditarNegocio: el => formNegocio(el.dataset.id || null),
  fnAbrirNegocio: el => abrirNegocio(el.dataset.id || ''),
  fnPartMais: () => linhaParticipante({ papel: 'corretor' }),
  fnPartMenos: el => el.closest('.fn-part')?.remove(),
  fnRecalcular: el =>
    executar(async () => {
      fecharModal();
      const r = await rpc('a1_fin_recalcular', { p_negocio: el.dataset.id });
      aviso(`${r.comissoes} comissão(ões) calculada(s).`);
    }, ''),
  fnCancelarNegocio: el => formCancelarNegocio(el.dataset.id || ''),
  fnLiberar: el =>
    executar(async () => {
      fecharModal();
      const r = await rpc('a1_fin_liberar_comissao', { p_comissao: el.dataset.id });
      aviso(`Comissão liberada: ${brl(r.valor)} em A pagar.`);
    }, ''),
  fnNovoLanc: el => formLancamento(null, el.dataset.tipo || 'pagar'),
  fnEditarLanc: el => formLancamento(el.dataset.id || null, ''),
  fnBaixar: el => formBaixa(el.dataset.id || ''),
  fnEstornar: el => {
    const l = G.lancamentos.find(x => x.id === el.dataset.id);
    if (!l || !confirm('Estornar esta baixa? O lançamento volta a ficar em aberto.')) return;
    executar(() => rpc('a1_fin_estornar', { p_lancamento: l.id, p_versao: l.versao }), 'Baixa estornada.');
  },
  fnCancelarLanc: el => {
    const l = G.lancamentos.find(x => x.id === el.dataset.id);
    if (!l || !confirm('Cancelar este lançamento?')) return;
    executar(
      () => rpc('a1_fin_cancelar_lancamento', { p_lancamento: l.id, p_versao: l.versao }),
      'Lançamento cancelado.'
    );
  },
  fnNovaConta: () => formConta(null),
  fnEditarConta: el => formConta(el.dataset.id || null),
  fnNovaCategoria: () => formCategoria(null),
  fnEditarCategoria: el => formCategoria(el.dataset.id || null),
  fnSalvarConfig: () =>
    executar(async () => {
      const prazo = Number(campo('fc-prazo'));
      if (!Number.isInteger(prazo) || prazo < 0 || prazo > 365) throw new Error('Prazo de 0 a 365 dias.');
      await gravar(
        'a1_fin_config',
        {
          tenant_id: (A1.user || {}).tenant_id,
          etapa_repasse: campo('fc-repasse') || null,
          etapa_registro: campo('fc-registro') || null,
          prazo_receber_dias: prazo,
          conta_padrao: campo('fc-conta') || null,
          atualizado_em: new Date().toISOString()
        },
        null,
        '?on_conflict=tenant_id'
      );
    }, 'Configurações salvas.')
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
  if (!G.gestor) {
    $('lc-titulo').textContent = VISTA_PARCEIRO[0];
    $('lc-sub').textContent = VISTA_PARCEIRO[1];
    $('lc-cab-acoes').innerHTML = '';
    $('lc-filtros').innerHTML = '';
    $('lc-conteudo').innerHTML = minhas();
    return;
  }
  const [t, s] = VISTAS[G.vista];
  $('lc-titulo').textContent = t;
  $('lc-sub').textContent = s;
  const botoes = /** @type {Record<string,string>} */ ({
    negocios:
      '<button type="button" class="lc-btn lc-btn-forte" data-acao="fnNovoNegocio">+ Negócio à mão</button>',
    receber:
      '<button type="button" class="lc-btn lc-btn-forte" data-acao="fnNovoLanc" data-tipo="receber">+ Conta a receber</button>',
    pagar:
      '<button type="button" class="lc-btn lc-btn-forte" data-acao="fnNovoLanc" data-tipo="pagar">+ Conta a pagar</button>',
    regras: `${G.regras.length ? '' : '<button type="button" class="lc-btn" data-acao="fnRegrasModelo">Usar regras-modelo do meu tipo</button> '}<button type="button" class="lc-btn lc-btn-forte" data-acao="fnNovaRegra">+ Nova regra</button>`,
    carteira: botoesCarteira(),
    conciliacao: botoesConciliacao(),
    dre: botoesDre()
  });
  $('lc-cab-acoes').innerHTML = botoes[G.vista] || '';
  const busca = (/** @type {string} */ ph) =>
    `<input type="search" id="fn-f-busca" placeholder="${esc(ph)}" value="${esc(G.filtro.busca)}" data-acao-input="fnFiltrar">`;
  const mesF = `<label>Mês <input type="month" id="fn-f-mes" value="${esc(G.filtro.mes)}" data-acao-change="fnFiltrar"></label>`;
  const filtros = /** @type {Record<string,string>} */ ({
    negocios: busca('Buscar ID, cliente, empreendimento ou participante'),
    comissoes: `<label>Direção <select id="fn-f-direcao" data-acao-change="fnFiltrar">${opcoes({ pagar: 'A pagar', receber: 'A receber (empresa)' }, G.filtro.direcao)}</select></label>
      <label>Situação <select id="fn-f-status" data-acao-change="fnFiltrar">${opcoes({ todas: 'Todas', ...ST_COM }, ST_COM[G.filtro.status] ? G.filtro.status : 'todas')}</select></label>
      ${busca('Buscar beneficiário ou negócio')}`,
    receber: `${mesF}<label>Situação <select id="fn-f-status" data-acao-change="fnFiltrar">${opcoes({ todas: 'Todas', aberto: 'Em aberto', vencido: 'Vencidas', pago: 'Pagas', cancelado: 'Canceladas' }, ROT_LANC[G.filtro.status] ? G.filtro.status : 'todas')}</select></label>${busca('Buscar descrição ou pessoa')}`,
    pagar: `${mesF}<label>Situação <select id="fn-f-status" data-acao-change="fnFiltrar">${opcoes({ todas: 'Todas', aberto: 'Em aberto', vencido: 'Vencidas', pago: 'Pagas', cancelado: 'Canceladas' }, ROT_LANC[G.filtro.status] ? G.filtro.status : 'todas')}</select></label>${busca('Buscar descrição ou pessoa')}`,
    fluxo: mesF,
    carteira: filtrosCarteira(),
    conciliacao: filtrosConciliacao(),
    dre: filtrosDre()
  });
  $('lc-filtros').innerHTML = filtros[G.vista] || '';
  desenharConteudo();
}
function desenharConteudo() {
  const f = /** @type {any} */ ({
    painel,
    negocios,
    comissoes,
    carteira: vistaCarteira,
    receber,
    pagar,
    conciliacao: vistaConciliacao,
    fluxo,
    dre: vistaDre,
    regras,
    cadastros
  })[G.vista];
  $('lc-conteudo').innerHTML = G.gestor ? f() : minhas();
}

const kpi = (/** @type {string} */ r, /** @type {string} */ v, d = '', tipo = '') =>
  `<div class="lc-kpi ${tipo}"><span>${esc(r)}</span><b>${esc(v)}</b>${d ? `<small>${esc(d)}</small>` : ''}</div>`;

/** Saldo de cada conta: saldo inicial + o que entrou − o que saiu desde então. */
function saldos() {
  return G.contas.map(c => {
    const mov = G.lancamentos
      .filter(l => l.status === 'pago' && l.conta_id === c.id && l.pago_em >= c.saldo_inicial_em)
      .reduce((s, l) => s + (l.tipo === 'receber' ? 1 : -1) * Number(l.valor_pago || 0), 0);
    return { ...c, saldo: Number(c.saldo_inicial || 0) + mov };
  });
}

function painel() {
  const hoje = hojeISO();
  const ym = hoje.slice(0, 7);
  const pagos = G.lancamentos.filter(l => l.status === 'pago' && String(l.pago_em).slice(0, 7) === ym);
  const entrou = pagos.filter(l => l.tipo === 'receber').reduce((s, l) => s + Number(l.valor_pago), 0);
  const saiu = pagos.filter(l => l.tipo === 'pagar').reduce((s, l) => s + Number(l.valor_pago), 0);
  const venc = (/** @type {string} */ t) => G.lancamentos.filter(l => l.tipo === t && vencido(l));
  const comPagar = G.lancamentos.filter(
    l => l.tipo === 'pagar' && l.origem === 'comissao' && l.status === 'aberto'
  );
  const negMes = G.negocios.filter(n => n.status === 'ativo' && String(n.data).slice(0, 7) === ym);
  const saldoTotal = saldos().reduce((s, c) => s + c.saldo, 0);
  const prox = G.lancamentos
    .filter(l => l.status === 'aberto' && l.vencimento >= hoje && l.vencimento <= somaDias(hoje, 7))
    .slice(0, 8);
  const porPessoa = new Map();
  comPagar.forEach(l =>
    porPessoa.set(l.pessoa || '—', (porPessoa.get(l.pessoa || '—') || 0) + Number(l.valor))
  );
  const ranking = [...porPessoa.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const setup = !G.regras.length
    ? `<div class="lc-previa fn-aviso"><span>Nenhuma regra de comissão ainda: os negócios entram, mas sem comissão. Comece pelas regras-modelo do seu tipo de empresa e ajuste os percentuais.</span>
        <button type="button" class="lc-btn lc-btn-forte" data-acao="fnRegrasModelo">Usar regras-modelo</button></div>`
    : '';
  return `${setup}<div class="lc-kpis">
      ${kpi('Saldo em contas', brl(saldoTotal), `${G.contas.filter(c => c.ativo).length} conta(s)`)}
      ${kpi('Entrou no mês', brl(entrou), `saiu ${brl(saiu)} · resultado ${brl(entrou - saiu)}`)}
      ${kpi('Vencido a receber', brl(venc('receber').reduce((s, l) => s + Number(l.valor), 0)), `${venc('receber').length} conta(s)`, venc('receber').length ? 'lc-kpi-alerta' : '')}
      ${kpi('Comissões a pagar', brl(comPagar.reduce((s, l) => s + Number(l.valor), 0)), `${negMes.length} negócio(s) no mês · ${brl(negMes.reduce((s, n) => s + Number(n.valor), 0))}`)}
    </div>
    <div class="lc-grade">
      <section class="lc-bloco"><h3>Vence nos próximos 7 dias</h3>${
        prox.length
          ? `<ul class="lc-lista">${prox
              .map(
                l =>
                  `<li><span>${esc(l.descricao)}<small>${l.tipo === 'receber' ? 'a receber' : 'a pagar'} · ${esc(data(l.vencimento))}</small></span><b class="${l.tipo === 'pagar' ? 'fn-saida' : 'fn-entrada'}">${esc(brl(l.valor))}</b></li>`
              )
              .join('')}</ul>`
          : '<p class="lc-vazio">Nada vence nos próximos 7 dias.</p>'
      }</section>
      <section class="lc-bloco"><h3>Comissões a pagar por pessoa</h3>${
        ranking.length
          ? `<ul class="lc-lista">${ranking.map(([p, v]) => `<li><span>${esc(p)}</span><b>${esc(brl(v))}</b></li>`).join('')}</ul>`
          : '<p class="lc-vazio">Nenhuma comissão liberada a pagar.</p>'
      }</section>
      <section class="lc-bloco"><h3>Vencido a pagar</h3>${
        venc('pagar').length
          ? `<ul class="lc-lista">${venc('pagar')
              .slice(0, 8)
              .map(
                l =>
                  `<li><span>${esc(l.descricao)}<small>venceu ${esc(data(l.vencimento))}</small></span><b class="fn-saida">${esc(brl(l.valor))}</b></li>`
              )
              .join('')}</ul>`
          : '<p class="lc-vazio">Nada vencido a pagar.</p>'
      }</section>
      <section class="lc-bloco"><h3>Últimos negócios</h3>${
        G.negocios.length
          ? `<ul class="lc-lista">${G.negocios
              .slice(0, 8)
              .map(
                n =>
                  `<li><span>${esc(idNeg(n))} · ${esc(n.descricao || n.cliente_nome || '')}<small>${esc(ORIGENS[n.origem] || n.origem)} · ${esc(data(n.data))}</small></span>${n.status === 'cancelado' ? selo('off', 'Cancelado') : `<b>${esc(brl(n.valor))}</b>`}</li>`
              )
              .join('')}</ul>`
          : '<p class="lc-vazio">Nenhum negócio ainda. Eles nascem quando um lead entra no Ganho, uma venda vira Vendido ou um processo chega na etapa configurada.</p>'
      }</section>
    </div>`;
}
const somaDias = (/** @type {string} */ iso, /** @type {number} */ n) =>
  new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function negocios() {
  const q = G.filtro.busca;
  const l = G.negocios.filter(n => {
    if (!q) return true;
    const parts = G.participantes.filter(p => p.negocio_id === n.id).map(p => p.nome);
    return `${idNeg(n)} ${n.descricao || ''} ${n.cliente_nome || ''} ${n.empreendimento || ''} ${parts.join(' ')}`
      .toLowerCase()
      .includes(q);
  });
  return tabela(
    ['ID', 'Data', 'Origem', 'Negócio', 'Valor', 'Empresa recebe', 'Comissões a pagar', 'Situação', ''],
    l.map(n => {
      const cs = G.comissoes.filter(c => c.negocio_id === n.id && c.status !== 'cancelada');
      const rec = cs.filter(c => c.direcao === 'receber').reduce((s, c) => s + Number(c.valor), 0);
      const pag = cs.filter(c => c.direcao === 'pagar').reduce((s, c) => s + Number(c.valor), 0);
      return `<tr data-id="${esc(n.id)}">
        <td class="lc-mono"><b>${esc(idNeg(n))}</b></td>
        <td>${esc(data(n.data))}</td>
        <td>${esc(ORIGENS[n.origem] || n.origem)}</td>
        <td>${esc(n.descricao || n.cliente_nome || '—')}<small>${esc([n.empreendimento, n.unidade].filter(Boolean).join(' · '))}</small></td>
        <td class="lc-num">${esc(brl(n.valor))}${n.valor_financiado ? `<small>financiado ${esc(brl(n.valor_financiado))}</small>` : ''}</td>
        <td class="lc-num">${esc(brl(rec))}</td>
        <td class="lc-num">${esc(brl(pag))}<small>${esc(String(cs.filter(c => c.direcao === 'pagar').length))} pessoa(s)</small></td>
        <td>${n.status === 'ativo' ? selo('ok', 'Ativo') : selo('off', 'Cancelado')}</td>
        <td class="lc-acoes"><button class="lc-btn lc-btn-p lc-btn-forte" data-acao="fnAbrirNegocio" data-id="${esc(n.id)}">Abrir</button></td></tr>`;
    }),
    'Nenhum negócio ainda.'
  );
}

function comissoes() {
  const q = G.filtro.busca;
  const st = G.filtro.status;
  const l = G.comissoes.filter(c => {
    if (c.direcao !== G.filtro.direcao) return false;
    if (ST_COM[st] && c.status !== st) return false;
    if (!q) return true;
    return `${c.beneficiario} ${idNeg(negocio(c.negocio_id))}`.toLowerCase().includes(q);
  });
  const soma = (/** @type {string} */ k) => l.reduce((s, c) => s + Number(c[k] || 0), 0);
  return `<p class="lc-resumo">${esc(String(l.length))} comissão(ões) · total ${esc(brl(soma('valor')))} · liberado ${esc(brl(soma('valor_liberado')))} · pago ${esc(brl(soma('valor_pago')))}</p>${tabela(
    [
      'Beneficiário',
      'Papel',
      'Negócio',
      'Regra',
      'Base',
      'Valor',
      'Liberação',
      'Liberado / pago',
      'Situação',
      ''
    ],
    l.map(c => {
      const n = negocio(c.negocio_id);
      const pode =
        c.direcao === 'pagar' && c.status !== 'cancelada' && Number(c.valor_liberado) < Number(c.valor);
      return `<tr data-id="${esc(c.id)}">
        <td>${esc(c.beneficiario)}</td>
        <td>${esc(PAPEIS[c.papel] || c.papel)}</td>
        <td class="lc-mono">${esc(idNeg(n))}<small>${esc((n && (n.descricao || n.cliente_nome)) || '')}</small></td>
        <td>${esc(c.regra_nome || '—')}</td>
        <td class="lc-num">${esc(brl(c.base_valor))}${c.percentual != null ? `<small>× ${esc(pct(c.percentual))}${Number(c.imposto_pct) ? ` · −${esc(pct(c.imposto_pct))} imposto` : ''}</small>` : '<small>valor fixo</small>'}</td>
        <td class="lc-num"><b>${esc(brl(c.valor))}</b></td>
        <td>${esc(LIBERACAO[c.liberacao] || c.liberacao)}</td>
        <td class="lc-num">${esc(brl(c.valor_liberado))}<small>pago ${esc(brl(c.valor_pago))}</small></td>
        <td>${seloCom(c)}</td>
        <td class="lc-acoes">${pode ? `<button class="lc-btn lc-btn-p" data-acao="fnLiberar" data-id="${esc(c.id)}">Liberar agora</button>` : ''}</td></tr>`;
    }),
    G.regras.length
      ? 'Nenhuma comissão com este filtro.'
      : 'Nenhuma comissão. Cadastre as regras de comissão (ou use as regras-modelo) para os negócios gerarem comissão.'
  )}`;
}

function lancamentos(/** @type {string} */ tipo) {
  const q = G.filtro.busca;
  const st = G.filtro.status;
  const l = G.lancamentos.filter(x => {
    if (x.tipo !== tipo) return false;
    const ref = x.status === 'pago' ? x.pago_em : x.vencimento;
    // vencido aparece em qualquer mês até ser resolvido
    if (
      !(
        String(ref).slice(0, 7) === G.filtro.mes ||
        (vencido(x) && G.filtro.mes >= String(x.vencimento).slice(0, 7))
      )
    )
      return false;
    if (st !== 'todas' && stLanc(x) !== st) return false;
    if (!q) return true;
    return `${x.descricao} ${x.pessoa || ''}`.toLowerCase().includes(q);
  });
  const total = l.filter(x => x.status !== 'cancelado').reduce((s, x) => s + Number(x.valor), 0);
  const feito = l.filter(x => x.status === 'pago').reduce((s, x) => s + Number(x.valor_pago), 0);
  return `<p class="lc-resumo">${esc(String(l.length))} lançamento(s) · total ${esc(brl(total))} · ${tipo === 'receber' ? 'recebido' : 'pago'} ${esc(brl(feito))}</p>${tabela(
    ['Vencimento', 'Descrição', 'Categoria', 'Pessoa', 'Valor', 'Situação', 'Baixa', ''],
    l.map(x => {
      const manual = x.origem === 'manual';
      const acoesL =
        x.status === 'aberto'
          ? `<button class="lc-btn lc-btn-p lc-btn-forte" data-acao="fnBaixar" data-id="${esc(x.id)}">${tipo === 'receber' ? 'Receber' : 'Pagar'}</button>${
              manual
                ? ` <button class="lc-btn lc-btn-p" data-acao="fnEditarLanc" data-id="${esc(x.id)}">Editar</button>
                    <button class="lc-btn lc-btn-p lc-perigo" data-acao="fnCancelarLanc" data-id="${esc(x.id)}">Cancelar</button>`
                : ''
            }`
          : x.status === 'pago' && x.origem !== 'locacao'
            ? `<button class="lc-btn lc-btn-p" data-acao="fnEstornar" data-id="${esc(x.id)}">Estornar</button>`
            : '';
      const n = negocio(x.negocio_id);
      return `<tr data-id="${esc(x.id)}">
        <td>${esc(data(x.vencimento))}</td>
        <td>${esc(x.descricao)}<small>${x.origem === 'comissao' ? `comissão${n ? ` · ${esc(idNeg(n))}` : ''}` : x.origem === 'locacao' ? 'Locação' : ''}${x.parcelas > 1 ? ` · parcela ${esc(String(x.parcela))}/${esc(String(x.parcelas))}` : ''}</small></td>
        <td>${esc((categoria(x.categoria_id) || {}).nome || '—')}</td>
        <td>${esc(x.pessoa || '')}</td>
        <td class="lc-num"><b>${esc(brl(x.valor))}</b></td>
        <td>${seloLanc(x)}</td>
        <td>${x.status === 'pago' ? `${esc(data(x.pago_em))}<small>${esc((conta(x.conta_id) || {}).nome || '')}${x.forma ? ` · ${esc(FORMAS[x.forma] || x.forma)}` : ''}</small>` : ''}</td>
        <td class="lc-acoes">${acoesL}</td></tr>`;
    }),
    `Nada ${tipo === 'receber' ? 'a receber' : 'a pagar'} em ${mes(G.filtro.mes)} com este filtro.`
  )}`;
}
const receber = () => lancamentos('receber');
const pagar = () => lancamentos('pagar');

function fluxo() {
  const base = G.filtro.mes;
  const meses = Array.from({ length: 12 }, (_, i) => somaMes(base, i - 5));
  const atual = hojeISO().slice(0, 7);
  const sal = saldos();
  let saldo = sal.reduce((s, c) => s + c.saldo, 0);
  const linhas = meses.map(m => {
    const real = G.lancamentos.filter(l => l.status === 'pago' && String(l.pago_em).slice(0, 7) === m);
    const ent = real.filter(l => l.tipo === 'receber').reduce((s, l) => s + Number(l.valor_pago), 0);
    const sai = real.filter(l => l.tipo === 'pagar').reduce((s, l) => s + Number(l.valor_pago), 0);
    // previsto: em aberto pelo vencimento; o atrasado entra no mês atual
    const prev = G.lancamentos.filter(
      l =>
        l.status === 'aberto' &&
        (String(l.vencimento).slice(0, 7) === m || (m === atual && String(l.vencimento).slice(0, 7) < atual))
    );
    const pe = prev.filter(l => l.tipo === 'receber').reduce((s, l) => s + Number(l.valor), 0);
    const ps = prev.filter(l => l.tipo === 'pagar').reduce((s, l) => s + Number(l.valor), 0);
    let proj = '';
    if (m >= atual) {
      saldo += pe - ps;
      proj = brl(saldo);
    }
    return `<tr${m === atual ? ' class="fn-mes-atual"' : ''}><td><b>${esc(mes(m + '-01'))}</b></td>
      <td class="lc-num fn-entrada">${ent ? esc(brl(ent)) : '—'}</td><td class="lc-num fn-saida">${sai ? esc(brl(sai)) : '—'}</td>
      <td class="lc-num">${ent || sai ? esc(brl(ent - sai)) : '—'}</td>
      <td class="lc-num fn-entrada">${pe ? esc(brl(pe)) : '—'}</td><td class="lc-num fn-saida">${ps ? esc(brl(ps)) : '—'}</td>
      <td class="lc-num"><b>${esc(proj || '—')}</b></td></tr>`;
  });
  return `<div class="lc-tbl"><table><thead><tr><th>Mês</th><th>Entrou</th><th>Saiu</th><th>Resultado</th><th>A receber</th><th>A pagar</th><th>Saldo projetado</th></tr></thead>
    <tbody>${linhas.join('')}</tbody></table></div>
    <p class="lc-dica">Realizado pela data da baixa; previsto pelo vencimento (o que está atrasado conta no mês atual). O saldo projetado parte do saldo de hoje nas contas.</p>
    <h3 class="lc-ficha-h">Saldo das contas</h3>${tabela(
      ['Conta', 'Tipo', 'Saldo inicial', 'Saldo hoje'],
      sal.map(
        c => `<tr><td>${esc(c.nome)}${c.ativo ? '' : ` ${selo('off', 'Inativa')}`}</td><td>${esc(TIPOS_CONTA[c.tipo] || c.tipo)}</td>
          <td class="lc-num">${esc(brl(c.saldo_inicial))}<small>em ${esc(data(c.saldo_inicial_em))}</small></td><td class="lc-num"><b>${esc(brl(c.saldo))}</b></td></tr>`
      )
    )}`;
}

function regras() {
  const linha = (/** @type {any} */ r) => `<tr data-id="${esc(r.id)}">
      <td>${esc(r.nome)}${r.ativo ? '' : ` ${selo('off', 'Inativa')}`}</td>
      <td>${r.direcao === 'receber' ? selo('ok', 'Empresa recebe') : selo('info', `Paga ${PAPEIS[r.papel] || r.papel}`)}</td>
      <td>${esc(r.tipo_calculo === 'fixo' ? brl(r.valor_fixo) : pct(r.percentual))}<small>${r.tipo_calculo === 'fixo' ? 'valor fixo' : `de ${esc((BASES[r.base] || r.base).toLowerCase())}`}${Number(r.imposto_pct) ? ` · −${esc(pct(r.imposto_pct))} imposto` : ''}</small></td>
      <td>${esc(LIBERACAO[r.liberacao] || r.liberacao)}</td>
      <td>${esc([r.origem !== 'todas' ? ORIGENS[r.origem] : '', r.empreendimento || '', r.partner_id ? (G.parceiros.find(p => p.id === r.partner_id) || {}).name || 'parceiro' : ''].filter(Boolean).join(' · ') || 'Geral')}</td>
      <td class="lc-num">${esc(String(r.prioridade))}</td>
      <td class="lc-acoes"><button class="lc-btn lc-btn-p" data-acao="fnEditarRegra" data-id="${esc(r.id)}">Editar</button>
        <button class="lc-btn lc-btn-p lc-perigo" data-acao="fnExcluirRegra" data-id="${esc(r.id)}">Excluir</button></td></tr>`;
  return `<p class="lc-dica">Para cada papel vale <b>uma</b> regra por negócio: a mais específica (parceiro &gt; empreendimento &gt; origem &gt; geral) e, entre iguais, a de maior prioridade. "Ao receber" libera na proporção do que a empresa já recebeu daquele negócio. Mudar uma regra não mexe nas comissões já calculadas: use "Recalcular" no negócio.</p>
    ${tabela(
      ['Regra', 'Direção', 'Cálculo', 'Liberação', 'Vale para', 'Prioridade', ''],
      G.regras.map(linha),
      'Nenhuma regra. Use as regras-modelo do seu tipo de empresa como ponto de partida.'
    )}`;
}

function cadastros() {
  const etapas = (/** @type {string} */ m) =>
    G.etapas.filter(e => e.module_key === m).map(e => ({ id: e.id, nome: e.name }));
  const cfg = G.config || {};
  return `<section class="lc-bloco fn-sec"><h3>Ligação com os outros módulos</h3>
      <div class="lc-form">
        <label>Etapa do Repasse que marca "contrato assinado"<select id="fc-repasse">${opcoesLista(etapas('repasse'), cfg.etapa_repasse || null)}</select></label>
        <label>Etapa do Registro que marca "serviço concluído"<select id="fc-registro">${opcoesLista(etapas('registro'), cfg.etapa_registro || null)}</select></label>
        <label>Prazo para receber a comissão (dias)<input id="fc-prazo" type="number" min="0" max="365" value="${esc(cfg.prazo_receber_dias ?? 30)}"></label>
        <label>Conta padrão das baixas<select id="fc-conta">${opcoesLista(
          G.contas.filter(c => c.ativo),
          cfg.conta_padrao || null
        )}</select></label>
      </div>
      <p class="lc-dica">Leads: o lead que entra na etapa com o selo <b>Ganho</b> vira negócio (se a empresa não tem o módulo Venda; com ele, quem gera é a venda no <b>Vendido</b>). Repasse: na etapa escolhida, a venda ligada ao processo libera as comissões "na assinatura"; sem venda, o processo vira negócio (correspondente). Registro: a etapa escolhida gera o negócio do despachante.</p>
      <button type="button" class="lc-btn lc-btn-forte" data-acao="fnSalvarConfig">Salvar</button>
    </section>
    <section class="lc-bloco fn-sec"><h3>Contas <button type="button" class="lc-btn lc-btn-p" data-acao="fnNovaConta">+ Conta</button></h3>
      ${tabela(
        ['Conta', 'Tipo', 'Banco', 'Saldo inicial', ''],
        G.contas.map(
          c => `<tr><td>${esc(c.nome)}${c.ativo ? '' : ` ${selo('off', 'Inativa')}`}</td><td>${esc(TIPOS_CONTA[c.tipo] || c.tipo)}</td>
            <td>${esc([c.banco, c.agencia, c.conta].filter(Boolean).join(' · '))}</td>
            <td class="lc-num">${esc(brl(c.saldo_inicial))}<small>em ${esc(data(c.saldo_inicial_em))}</small></td>
            <td class="lc-acoes"><button class="lc-btn lc-btn-p" data-acao="fnEditarConta" data-id="${esc(c.id)}">Editar</button></td></tr>`
        )
      )}</section>
    <section class="lc-bloco fn-sec"><h3>Categorias <button type="button" class="lc-btn lc-btn-p" data-acao="fnNovaCategoria">+ Categoria</button></h3>
      ${tabela(
        ['Categoria', 'Tipo', 'Grupo no DRE', ''],
        G.categorias.map(
          c => `<tr><td>${esc(c.nome)}${c.chave ? ` ${selo('info', 'do sistema')}` : ''}${c.ativo ? '' : ` ${selo('off', 'Inativa')}`}</td>
            <td>${c.tipo === 'receita' ? selo('ok', 'Receita') : selo('erro', 'Despesa')}</td>
            <td>${esc(GRUPOS[grupoPadrao(c)] || '')}${c.grupo_dre ? '' : '<small>padrão</small>'}</td>
            <td class="lc-acoes"><button class="lc-btn lc-btn-p" data-acao="fnEditarCategoria" data-id="${esc(c.id)}">Editar</button></td></tr>`
        )
      )}</section>
    ${cadastrosCentros()}
    ${cadastrosCarteira()}`;
}

function minhas() {
  const l = G.minhas || [];
  const soma = (/** @type {(c:any)=>boolean} */ f, /** @type {string} */ k) =>
    l.filter(f).reduce((s, c) => s + Number(c[k] || 0), 0);
  const ativas = (/** @type {any} */ c) => c.status !== 'cancelada';
  return `<div class="lc-kpis">
      ${kpi('Previsto', brl(soma(ativas, 'valor') - soma(ativas, 'valor_liberado')), 'ainda não liberado')}
      ${kpi('Liberado a receber', brl(soma(ativas, 'valor_liberado') - soma(ativas, 'valor_pago')), 'a empresa já pode pagar')}
      ${kpi('Recebido', brl(soma(ativas, 'valor_pago')), `${l.filter(c => c.status === 'paga').length} comissão(ões) paga(s)`)}
      ${kpi('Negócios', String(new Set(l.map(c => c.negocio)).size), 'em que você participa')}
    </div>
    ${tabela(
      ['Negócio', 'Data', 'Papel', 'Regra', 'Base', 'Valor', 'Liberação', 'Liberado / pago', 'Situação'],
      l.map(
        c => `<tr><td class="lc-mono">${esc(c.negocio)}<small>${esc(c.descricao || '')}</small></td><td>${esc(data(c.data))}</td>
          <td>${esc(PAPEIS[c.papel] || c.papel)}</td><td>${esc(c.regra || '—')}</td>
          <td class="lc-num">${esc(brl(c.base_valor))}${c.percentual != null ? `<small>× ${esc(pct(c.percentual))}</small>` : ''}</td>
          <td class="lc-num"><b>${esc(brl(c.valor))}</b></td><td>${esc(LIBERACAO[c.liberacao] || c.liberacao)}</td>
          <td class="lc-num">${esc(brl(c.valor_liberado))}<small>pago ${esc(brl(c.valor_pago))}</small></td><td>${seloCom(c)}</td></tr>`
      ),
      'Você ainda não tem comissões registradas.'
    )}`;
}

// ─── Negócio ─────────────────────────────────────────────────────────────────
function abrirNegocio(/** @type {string} */ id) {
  const n = negocio(id);
  if (!n) return;
  const parts = G.participantes.filter(p => p.negocio_id === n.id);
  const cs = G.comissoes.filter(c => c.negocio_id === n.id);
  const ls = G.lancamentos.filter(l => l.negocio_id === n.id);
  const temPago = cs.some(c => Number(c.valor_pago) > 0) || ls.some(l => l.status === 'pago');
  const ativo = n.status === 'ativo';
  abrirModal(
    `Negócio ${idNeg(n)}`,
    `<dl class="lc-ficha">
      <dt>Origem</dt><dd>${esc(ORIGENS[n.origem] || n.origem)}</dd>
      <dt>Negócio</dt><dd>${esc(n.descricao || '—')}${n.cliente_nome ? `<br><small>Cliente: ${esc(n.cliente_nome)}</small>` : ''}</dd>
      <dt>Empreendimento</dt><dd>${esc([n.empreendimento, n.unidade].filter(Boolean).join(' · ') || '—')}</dd>
      <dt>Valor</dt><dd>${esc(brl(n.valor))}${n.valor_financiado ? ` · financiado ${esc(brl(n.valor_financiado))}` : ''}</dd>
      <dt>Data</dt><dd>${esc(data(n.data))}${n.assinado_em ? ` · assinado em ${esc(data(n.assinado_em))}` : ''}</dd>
      <dt>Situação</dt><dd>${ativo ? 'Ativo' : `Cancelado${n.motivo_cancelamento ? `: ${esc(n.motivo_cancelamento)}` : ''}`}</dd>
      <dt>Participantes</dt><dd>${parts.map(p => `${esc(p.nome)} <small>(${esc(PAPEIS[p.papel] || p.papel)})</small>`).join(', ') || '—'}</dd>
    </dl>
    <h3 class="lc-ficha-h">Comissões</h3>${tabela(
      ['Beneficiário', 'Regra', 'Valor', 'Liberação', 'Liberado / pago', 'Situação', ''],
      cs.map(
        c => `<tr><td>${esc(c.beneficiario)}<small>${esc(c.direcao === 'receber' ? 'empresa recebe' : PAPEIS[c.papel] || c.papel)}</small></td>
          <td>${esc(c.regra_nome || '—')}</td><td class="lc-num"><b>${esc(brl(c.valor))}</b></td>
          <td>${esc(LIBERACAO[c.liberacao] || c.liberacao)}</td>
          <td class="lc-num">${esc(brl(c.valor_liberado))}<small>pago ${esc(brl(c.valor_pago))}</small></td><td>${seloCom(c)}</td>
          <td class="lc-acoes">${ativo && c.direcao === 'pagar' && c.status !== 'cancelada' && Number(c.valor_liberado) < Number(c.valor) ? `<button class="lc-btn lc-btn-p" data-acao="fnLiberar" data-id="${esc(c.id)}">Liberar agora</button>` : ''}</td></tr>`
      ),
      G.regras.length ? 'Nenhuma regra se aplica a este negócio.' : 'Sem regras de comissão cadastradas.'
    )}
    <h3 class="lc-ficha-h">Lançamentos</h3>${tabela(
      ['Vencimento', 'Descrição', 'Valor', 'Situação'],
      ls.map(
        l => `<tr><td>${esc(data(l.vencimento))}</td><td>${esc(l.descricao)}<small>${l.tipo === 'receber' ? 'a receber' : 'a pagar'}</small></td>
          <td class="lc-num">${esc(brl(l.valor))}</td><td>${seloLanc(l)}</td></tr>`
      ),
      'Nenhum lançamento.'
    )}
    ${
      ativo
        ? `<div class="lc-ficha-acoes">
        ${temPago ? '' : `<button type="button" class="lc-btn lc-btn-p" data-acao="fnEditarNegocio" data-id="${esc(n.id)}">Editar valores e participantes</button>`}
        ${temPago ? '' : `<button type="button" class="lc-btn lc-btn-p" data-acao="fnRecalcular" data-id="${esc(n.id)}">Recalcular comissões</button>`}
        <button type="button" class="lc-btn lc-btn-p lc-perigo" data-acao="fnCancelarNegocio" data-id="${esc(n.id)}">Cancelar negócio</button>
      </div>${temPago ? '<p class="lc-dica">Este negócio já tem pagamento: para mudar valores, estorne as baixas antes.</p>' : ''}`
        : ''
    }`,
    null
  );
}

function formNegocio(/** @type {string|null} */ id) {
  const n = negocio(id) || { data: hojeISO(), valor: '' };
  const parts = id ? G.participantes.filter(p => p.negocio_id === id) : [];
  abrirModal(
    id ? `Editar ${idNeg(n)}` : 'Negócio à mão',
    `<div class="lc-form">
      <label class="lc-largo">Descrição *<input id="fn-desc" maxlength="200" value="${esc(n.descricao || '')}" placeholder="Ex.: Venda apto 302 · Residencial Sol"></label>
      <label>Cliente<input id="fn-cli" maxlength="160" value="${esc(n.cliente_nome || '')}"></label>
      <label>Empreendimento<input id="fn-emp" maxlength="160" value="${esc(n.empreendimento || '')}"></label>
      <label>Unidade<input id="fn-uni" maxlength="60" value="${esc(n.unidade || '')}"></label>
      <label>Valor do negócio (R$) *<input id="fn-valor" inputmode="decimal" value="${esc(n.valor ?? '')}"></label>
      <label>Valor financiado (R$)<input id="fn-fin" inputmode="decimal" value="${esc(n.valor_financiado ?? '')}"></label>
      <label>Data<input id="fn-data" type="date" value="${esc(n.data || hojeISO())}"></label>
      <fieldset class="lc-largo"><legend>Participantes (quem pode receber comissão)</legend>
        <div id="fn-parts"></div>
        <button type="button" class="lc-btn lc-btn-p" data-acao="fnPartMais">+ Participante</button>
        <p class="lc-dica">Escolha a pessoa cadastrada (ela verá a comissão em "Minhas comissões") ou digite um nome livre.</p>
      </fieldset>
      <p class="lc-largo lc-dica">Ao salvar, as comissões são calculadas pelas regras.</p>
    </div>`,
    async () => {
      const valor = num(campo('fn-valor'));
      const fin = campo('fn-fin') ? num(campo('fn-fin')) : null;
      if (campo('fn-desc').length < 2) throw new Error('Informe a descrição.');
      if (!Number.isFinite(valor) || valor < 0) throw new Error('Informe o valor do negócio.');
      if (fin != null && (!Number.isFinite(fin) || fin < 0)) throw new Error('Valor financiado inválido.');
      const participantes = [...document.querySelectorAll('#fn-parts .fn-part')]
        .map(l => {
          const q = (/** @type {string} */ s) =>
            /** @type {HTMLInputElement} */ (l.querySelector(s)).value.trim();
          return { papel: q('.fp-papel'), partner_id: q('.fp-parceiro') || null, nome: q('.fp-nome') };
        })
        .filter(p => p.partner_id || p.nome);
      const r = await rpc('a1_fin_salvar_negocio', {
        p_id: id,
        p_dados: {
          descricao: campo('fn-desc'),
          cliente_nome: campo('fn-cli'),
          empreendimento: campo('fn-emp'),
          unidade: campo('fn-uni'),
          valor,
          valor_financiado: fin,
          data: campo('fn-data')
        },
        p_participantes: participantes
      });
      aviso(`Negócio salvo. ${r.comissoes} comissão(ões) calculada(s).`);
    }
  );
  parts.forEach(p => linhaParticipante(p));
  if (!parts.length) linhaParticipante({ papel: 'corretor' });
}
function linhaParticipante(/** @type {any} */ p) {
  const caixa = document.getElementById('fn-parts');
  if (!caixa) return;
  const div = document.createElement('div');
  div.className = 'fn-part';
  div.innerHTML = `<select class="fp-papel" aria-label="Papel">${opcoes(Object.fromEntries(Object.entries(PAPEIS).filter(([k]) => k !== 'empresa')), p.papel || 'corretor')}</select>
    <select class="fp-parceiro" aria-label="Pessoa cadastrada">${opcoesLista(G.parceiros, p.partner_id || null, '— pessoa cadastrada —')}</select>
    <input class="fp-nome" maxlength="160" placeholder="ou nome livre" value="${esc(p.partner_id ? '' : p.nome || '')}" aria-label="Nome livre">
    <button type="button" class="lc-btn lc-btn-p" data-acao="fnPartMenos" aria-label="Remover participante">×</button>`;
  caixa.appendChild(div);
}

function formCancelarNegocio(/** @type {string} */ id) {
  const n = negocio(id);
  if (!n) return;
  abrirModal(
    `Cancelar ${idNeg(n)}`,
    `<div class="lc-form"><label class="lc-largo">Motivo *<input id="fn-motivo" maxlength="300" placeholder="Ex.: distrato, venda desfeita"></label>
      <p class="lc-largo lc-dica">Comissões e contas em aberto deste negócio são canceladas. O que já foi pago continua registrado.</p></div>`,
    async () => {
      const r = await rpc('a1_fin_cancelar_negocio', { p_negocio: n.id, p_motivo: campo('fn-motivo') });
      aviso(
        r.comissoes_pagas
          ? `Negócio cancelado. ${r.comissoes_pagas} comissão(ões) já paga(s) ficaram registradas.`
          : 'Negócio cancelado.'
      );
    },
    'Cancelar negócio'
  );
}

// ─── Regras ──────────────────────────────────────────────────────────────────
function formRegra(/** @type {string|null} */ id) {
  const r = G.regras.find(x => x.id === id) || {
    direcao: 'pagar',
    papel: 'corretor',
    base: 'comissao_empresa',
    tipo_calculo: 'percentual',
    liberacao: 'recebimento',
    origem: 'todas',
    prioridade: 0,
    imposto_pct: 0,
    ativo: true
  };
  abrirModal(
    id ? 'Editar regra' : 'Nova regra de comissão',
    `<div class="lc-form">
      <label class="lc-largo">Nome *<input id="fr-nome" maxlength="120" value="${esc(r.nome || '')}" placeholder="Ex.: Corretor 40% da comissão"></label>
      <label>Quem<select id="fr-papel" data-acao-change="fnRegraCalculo">${opcoes(
        {
          empresa: 'Empresa (o que ela recebe)',
          ...Object.fromEntries(
            Object.entries(PAPEIS)
              .filter(([k]) => k !== 'empresa')
              .map(([k, v]) => [k, `Pagar: ${v}`])
          )
        },
        r.direcao === 'receber' ? 'empresa' : r.papel
      )}</select></label>
      <label>Base<select id="fr-base" data-acao-change="fnRegraCalculo">${opcoes(BASES, r.base)}</select></label>
      <label>Cálculo<select id="fr-calc" data-acao-change="fnRegraCalculo">${opcoes({ percentual: 'Percentual', fixo: 'Valor fixo' }, r.tipo_calculo)}</select></label>
      <label id="fr-pct-w">Percentual (%)<input id="fr-pct" inputmode="decimal" value="${esc(r.percentual ?? '')}"></label>
      <label id="fr-fixo-w">Valor fixo (R$)<input id="fr-fixo" inputmode="decimal" value="${esc(r.valor_fixo ?? '')}"></label>
      <label>Imposto descontado antes (%)<input id="fr-imp" inputmode="decimal" value="${esc(r.imposto_pct ?? 0)}"></label>
      <label>Libera<select id="fr-lib">${opcoes(LIBERACAO, r.liberacao)}</select></label>
      <label id="fr-pag-w">Quem paga a empresa<input id="fr-pag" maxlength="120" value="${esc(r.pagador || '')}" placeholder="Ex.: Construtora, Banco, Cliente"></label>
      <fieldset class="lc-largo"><legend>Vale para (deixe em branco para todos)</legend><div class="lc-form">
        <label>Origem<select id="fr-origem">${opcoes({ todas: 'Todas', ...ORIGENS }, r.origem)}</select></label>
        <label>Empreendimento<input id="fr-emp" maxlength="160" value="${esc(r.empreendimento || '')}"></label>
        <label id="fr-par-w">Só este parceiro<select id="fr-par">${opcoesLista(G.parceiros, r.partner_id || null, '— qualquer um —')}</select></label>
      </div></fieldset>
      <label>Prioridade<input id="fr-prio" type="number" value="${esc(r.prioridade ?? 0)}"></label>
      <label class="lc-check"><input type="checkbox" id="fr-ativo"${r.ativo !== false ? ' checked' : ''}> Ativa</label>
      <p class="lc-largo lc-dica" id="fr-dica"></p>
    </div>`,
    async () => {
      const papel = campo('fr-papel');
      const direcao = papel === 'empresa' ? 'receber' : 'pagar';
      const tipo = campo('fr-calc');
      const n = (/** @type {string} */ k) => (campo(k) ? num(campo(k)) : null);
      const pctV = n('fr-pct');
      const fixo = n('fr-fixo');
      const imp = n('fr-imp') ?? 0;
      if (campo('fr-nome').length < 2) throw new Error('Informe o nome da regra.');
      if (tipo === 'percentual' && (pctV == null || !Number.isFinite(pctV) || pctV < 0 || pctV > 100))
        throw new Error('Percentual de 0 a 100.');
      if (tipo === 'fixo' && (fixo == null || !Number.isFinite(fixo) || fixo < 0))
        throw new Error('Informe o valor fixo.');
      if (!Number.isFinite(imp) || imp < 0 || imp > 100) throw new Error('Imposto de 0 a 100%.');
      if (direcao === 'receber' && campo('fr-base') === 'comissao_empresa')
        throw new Error('O que a empresa recebe não pode ter como base a própria comissão.');
      await gravar(
        'a1_fin_regras',
        {
          ...(id ? {} : { tenant_id: (A1.user || {}).tenant_id }),
          nome: campo('fr-nome'),
          direcao,
          papel,
          base: campo('fr-base'),
          tipo_calculo: tipo,
          percentual: tipo === 'percentual' ? pctV : null,
          valor_fixo: tipo === 'fixo' ? fixo : null,
          imposto_pct: imp,
          liberacao: campo('fr-lib'),
          pagador: direcao === 'receber' ? campo('fr-pag') || null : null,
          origem: campo('fr-origem'),
          empreendimento: campo('fr-emp') || null,
          partner_id: direcao === 'pagar' ? campo('fr-par') || null : null,
          prioridade: Math.round(Number(campo('fr-prio')) || 0),
          ativo: marcado('fr-ativo'),
          atualizado_em: new Date().toISOString()
        },
        id
      );
      aviso('Regra salva. Use "Recalcular" nos negócios que já existiam, se quiser aplicá-la a eles.');
    }
  );
  mostrarCalculo();
}
function mostrarCalculo() {
  const p = document.getElementById('fr-papel');
  if (!p) return;
  const receber = /** @type {HTMLSelectElement} */ (p).value === 'empresa';
  const fixo = campo('fr-calc') === 'fixo';
  $('fr-pct-w').hidden = fixo;
  $('fr-fixo-w').hidden = !fixo;
  $('fr-pag-w').hidden = !receber;
  $('fr-par-w').hidden = receber;
  const base = /** @type {HTMLSelectElement} */ ($('fr-base'));
  const opcaoEmpresa = /** @type {HTMLOptionElement|null} */ (
    base.querySelector('option[value="comissao_empresa"]')
  );
  if (opcaoEmpresa) opcaoEmpresa.disabled = receber;
  if (receber && base.value === 'comissao_empresa') base.value = 'valor';
  $('fr-dica').textContent = receber
    ? 'O que a empresa ganha no negócio. Vira uma conta a receber; quando ela recebe, libera as comissões "ao receber" na mesma proporção.'
    : base.value === 'comissao_empresa'
      ? 'Percentual sobre o que a empresa recebe no negócio (ex.: corretor fica com 40% da comissão da imobiliária).'
      : 'Percentual sobre o valor do negócio (ou do financiado), mesmo sem comissão da empresa (ex.: construtora paga 4% à imobiliária).';
}

// ─── Lançamentos ─────────────────────────────────────────────────────────────
function formLancamento(/** @type {string|null} */ id, /** @type {string} */ tipoNovo) {
  const l = G.lancamentos.find(x => x.id === id) || { tipo: tipoNovo, vencimento: hojeISO() };
  const tipo = l.tipo;
  const cats = G.categorias.filter(c => c.ativo && c.tipo === (tipo === 'receber' ? 'receita' : 'despesa'));
  abrirModal(
    id ? 'Editar lançamento' : tipo === 'receber' ? 'Nova conta a receber' : 'Nova conta a pagar',
    `<div class="lc-form">
      <label class="lc-largo">Descrição *<input id="fl-desc" maxlength="200" value="${esc(l.descricao || '')}"></label>
      <label>Categoria<select id="fl-cat">${opcoesLista(cats, l.categoria_id || null, '— sem categoria —')}</select></label>
      <label>Valor (R$) *<input id="fl-valor" inputmode="decimal" value="${esc(l.valor ?? '')}"></label>
      <label>Vencimento *<input id="fl-venc" type="date" value="${esc(l.vencimento || hojeISO())}"></label>
      <label>${tipo === 'receber' ? 'De quem' : 'Para quem'}<input id="fl-pessoa" maxlength="160" value="${esc(l.pessoa || '')}"></label>
      ${
        G.centros.length
          ? `<label>Centro de custo<select id="fl-centro">${opcoesLista(
              G.centros.filter(c => c.ativo || c.id === l.centro_id),
              l.centro_id || null,
              '— nenhum —'
            )}</select></label>`
          : ''
      }
      ${
        id
          ? ''
          : `<label>Repetir<select id="fl-modo">${opcoes({ uma: 'Uma vez', parcelado: 'Parcelado (divide o valor)', recorrente: 'Todo mês (mesmo valor)' }, 'uma')}</select></label>
             <label>Quantidade<input id="fl-qtd" type="number" min="1" max="60" value="1"></label>`
      }
      <label class="lc-largo">Observação<input id="fl-obs" maxlength="1000" value="${esc(l.observacao || '')}"></label>
    </div>`,
    async () => {
      const valor = num(campo('fl-valor'));
      if (campo('fl-desc').length < 2) throw new Error('Informe a descrição.');
      if (!Number.isFinite(valor) || valor <= 0) throw new Error('Informe o valor.');
      if (!campo('fl-venc')) throw new Error('Informe o vencimento.');
      const base = {
        descricao: campo('fl-desc'),
        categoria_id: campo('fl-cat') || null,
        pessoa: campo('fl-pessoa') || null,
        observacao: campo('fl-obs') || null,
        ...(document.getElementById('fl-centro') ? { centro_id: campo('fl-centro') || null } : {})
      };
      if (id) {
        await gravar(
          'a1_fin_lancamentos',
          { ...base, valor, vencimento: campo('fl-venc'), atualizado_em: new Date().toISOString() },
          id
        );
        aviso('Lançamento salvo.');
        return;
      }
      const modo = campo('fl-modo');
      const qtd = modo === 'uma' ? 1 : Number(campo('fl-qtd'));
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 60) throw new Error('Quantidade de 1 a 60.');
      const grupo = qtd > 1 ? (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : null) : null;
      const cent = Math.round(valor * 100);
      const linhas = Array.from({ length: qtd }, (_, i) => {
        // parcelado: divide em centavos e joga a sobra na primeira
        const v =
          modo === 'parcelado'
            ? (Math.floor(cent / qtd) + (i === 0 ? cent - Math.floor(cent / qtd) * qtd : 0)) / 100
            : valor;
        const venc = somaMesData(campo('fl-venc'), i);
        return {
          ...base,
          tenant_id: (A1.user || {}).tenant_id,
          tipo,
          valor: v,
          vencimento: venc,
          competencia: venc.slice(0, 7) + '-01',
          grupo_id: grupo,
          parcela: qtd > 1 ? i + 1 : null,
          parcelas: qtd > 1 ? qtd : null
        };
      });
      const r = await fetch(A1.rest('a1_fin_lancamentos'), {
        method: 'POST',
        headers: A1.headers({ Prefer: 'return=minimal' }),
        body: JSON.stringify(linhas)
      });
      if (!r.ok) throw new Error(await motivo(r));
      aviso(qtd > 1 ? `${qtd} lançamentos criados.` : 'Lançamento criado.');
    }
  );
}
/** Mesmo dia, n meses depois (dia 31 vira o último dia do mês). */
function somaMesData(/** @type {string} */ iso, /** @type {number} */ n) {
  const [a, m, d] = iso.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m + n, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + n, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

function formBaixa(/** @type {string} */ id) {
  const l = G.lancamentos.find(x => x.id === id);
  if (!l) return;
  abrirModal(
    l.tipo === 'receber' ? 'Receber' : 'Pagar',
    `<div class="lc-form">
      <p class="lc-largo"><b>${esc(l.descricao)}</b> · vence ${esc(data(l.vencimento))} · ${esc(brl(l.valor))}</p>
      <label>Data *<input type="date" id="fb-data" value="${esc(hojeISO())}"></label>
      <label>Valor (R$) *<input id="fb-valor" inputmode="decimal" value="${esc(String(l.valor))}"></label>
      <label>Conta<select id="fb-conta">${opcoesLista(
        G.contas.filter(c => c.ativo),
        G.config.conta_padrao || null,
        '— conta padrão —'
      )}</select></label>
      <label>Forma<select id="fb-forma">${opcoes(FORMAS, 'pix')}</select></label>
      <p class="lc-largo lc-dica">Valor menor que o do lançamento: baixa parcial, e o restante continua em aberto.${l.origem === 'comissao' && l.tipo === 'receber' ? ' Receber esta comissão libera, na mesma proporção, as comissões "ao receber" deste negócio.' : ''}</p>
    </div>`,
    async () => {
      const v = num(campo('fb-valor'));
      if (!Number.isFinite(v) || v <= 0 || v > Number(l.valor))
        throw new Error('Valor de 0,01 até o valor do lançamento.');
      await rpc('a1_fin_baixar', {
        p_lancamento: l.id,
        p_pago_em: campo('fb-data'),
        p_valor: v,
        p_conta: campo('fb-conta') || null,
        p_forma: campo('fb-forma'),
        p_versao: l.versao
      });
      aviso(
        v < Number(l.valor) ? `Baixa parcial de ${brl(v)}; o resto continua em aberto.` : 'Baixa registrada.'
      );
    },
    l.tipo === 'receber' ? 'Receber' : 'Pagar'
  );
}

// ─── Cadastros ───────────────────────────────────────────────────────────────
function formConta(/** @type {string|null} */ id) {
  const c = conta(id) || { tipo: 'banco', saldo_inicial: 0, saldo_inicial_em: hojeISO(), ativo: true };
  abrirModal(
    id ? 'Editar conta' : 'Nova conta',
    `<div class="lc-form">
      <label class="lc-largo">Nome *<input id="fo-nome" maxlength="80" value="${esc(c.nome || '')}" placeholder="Ex.: Banco do Brasil PJ"></label>
      <label>Tipo<select id="fo-tipo">${opcoes(TIPOS_CONTA, c.tipo)}</select></label>
      <label>Banco<input id="fo-banco" maxlength="80" value="${esc(c.banco || '')}"></label>
      <label>Agência<input id="fo-ag" maxlength="20" value="${esc(c.agencia || '')}"></label>
      <label>Conta<input id="fo-conta" maxlength="30" value="${esc(c.conta || '')}"></label>
      <label>Saldo inicial (R$)<input id="fo-saldo" inputmode="decimal" value="${esc(c.saldo_inicial ?? 0)}"></label>
      <label>Saldo em<input id="fo-saldo-em" type="date" value="${esc(c.saldo_inicial_em || hojeISO())}"></label>
      ${id ? `<label class="lc-check"><input type="checkbox" id="fo-ativo"${c.ativo ? ' checked' : ''}> Ativa</label>` : ''}
    </div>`,
    async () => {
      const saldo = num(campo('fo-saldo') || '0');
      if (campo('fo-nome').length < 2) throw new Error('Informe o nome.');
      if (!Number.isFinite(saldo)) throw new Error('Saldo inicial inválido.');
      const ativo = document.getElementById('fo-ativo');
      await gravar(
        'a1_fin_contas',
        {
          ...(id ? {} : { tenant_id: (A1.user || {}).tenant_id }),
          nome: campo('fo-nome'),
          tipo: campo('fo-tipo'),
          banco: campo('fo-banco') || null,
          agencia: campo('fo-ag') || null,
          conta: campo('fo-conta') || null,
          saldo_inicial: saldo,
          saldo_inicial_em: campo('fo-saldo-em') || hojeISO(),
          ativo: ativo ? /** @type {HTMLInputElement} */ (ativo).checked : true
        },
        id
      );
      aviso('Conta salva.');
    }
  );
}

function formCategoria(/** @type {string|null} */ id) {
  const c = categoria(id) || { tipo: 'despesa', ativo: true };
  abrirModal(
    id ? 'Editar categoria' : 'Nova categoria',
    `<div class="lc-form">
      <label class="lc-largo">Nome *<input id="fa-nome" maxlength="80" value="${esc(c.nome || '')}"></label>
      <label>Tipo<select id="fa-tipo"${c.chave ? ' disabled' : ''}>${opcoes({ receita: 'Receita', despesa: 'Despesa' }, c.tipo)}</select></label>
      <label>Grupo no DRE<select id="fa-grupo">${opcoes({ '': 'Automático (pelo tipo)', ...GRUPOS }, c.grupo_dre || '')}</select></label>
      ${id ? `<label class="lc-check"><input type="checkbox" id="fa-ativo"${c.ativo ? ' checked' : ''}> Ativa</label>` : ''}
      ${c.chave ? '<p class="lc-largo lc-dica">Categoria do sistema: o nome pode mudar, o tipo não (os lançamentos automáticos usam ela).</p>' : ''}
    </div>`,
    async () => {
      if (campo('fa-nome').length < 2) throw new Error('Informe o nome.');
      const ativo = document.getElementById('fa-ativo');
      await gravar(
        'a1_fin_categorias',
        {
          ...(id ? {} : { tenant_id: (A1.user || {}).tenant_id }),
          nome: campo('fa-nome'),
          ...(c.chave ? {} : { tipo: campo('fa-tipo') }),
          grupo_dre: campo('fa-grupo') || null,
          ativo: ativo ? /** @type {HTMLInputElement} */ (ativo).checked : true
        },
        id
      );
      aviso('Categoria salva.');
    }
  );
}

// ─── Início ──────────────────────────────────────────────────────────────────
async function init() {
  try {
    a1RequireAuth();
  } catch {
    return;
  }
  try {
    await a1RequireModule('financeiro');
  } catch {
    return;
  }
  // Quem gere o Financeiro? O banco responde: a1_fin_iniciar só passa para o
  // gestor (ou quem tem gerir_financeiro), e já prepara categorias e o Caixa.
  Object.assign(F, {
    G,
    ERROS,
    FORMAS,
    rpc,
    ler,
    gravar,
    motivo,
    executar,
    aviso,
    abrirModal,
    fecharModal,
    desenharConteudo,
    campo,
    marcado,
    opcoes,
    opcoesLista,
    tabela,
    kpi,
    selo,
    brl,
    data,
    mes,
    num
  });
  G.gestor = await rpc('a1_fin_iniciar', {})
    .then(() => true)
    .catch(() => false);
  const v = new URLSearchParams(location.search).get('vista') || 'painel';
  G.vista = VISTAS[v] ? v : 'painel';
  await a1MontarShell(document.getElementById('sb-casco'), {
    ativo: 'financeiro',
    sub: G.gestor
      ? Object.entries(VISTAS).map(([k, [rot]]) => ({ rot, chave: k, ativo: k === G.vista, acao: 'fnVista' }))
      : [{ rot: VISTA_PARCEIRO[0], chave: 'minhas', ativo: true, acao: 'fnVista' }]
  });
  a1StartHeartbeat('financeiro');
  await carregar().catch(() => aviso('Não foi possível carregar o Financeiro agora.', 'erro'));
  desenhar();
}

init();
