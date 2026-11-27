// ─── Financeiro · Carteira de recebíveis (fase 2) ────────────────────────────
//
// O PEDIDO DO DONO
//   "fase 2 do financeiro": carteira de parcelas da venda direta, com correção
//   "INCC até as chaves, depois IGP-M" e lembrete pelo WhatsApp oficial.
//
// COMO FUNCIONA
//   - Com a carteira ligada (Cadastros), a venda que vira VENDIDO gera a
//     carteira com as parcelas da proposta (banco: a1_fin_carteira_de_venda).
//     Vendas antigas entram por "Importar vendas"; venda de fora, à mão.
//   - O valor de hoje (correção, multa e juros) é sempre calculado no banco
//     (a1_fin_parcela_calc): a tela só mostra. A baixa exige o valor exato do
//     dia, e entra no caixa como receita da categoria "Venda de unidade".
//   - Tudo que vem do banco passa por esc().
import { esc } from '../../shared/utils/texto.js';
import { hojeISO } from '../../shared/utils/datas.js';
import { acoes } from '../../shared/ui/acoes.js';
import { A1, A1_URL } from '../../shared/api/config.js';
import { F, INDICES, somaMesData } from './ctx.js';

const ST_CART = /** @type {Record<string,string>} */ ({
  ativa: 'Ativa',
  quitada: 'Quitada',
  distratada: 'Distratada'
});
const ST_PARC = /** @type {Record<string,string>} */ ({
  aberta: 'Em aberto',
  vencida: 'Vencida',
  paga: 'Paga',
  renegociada: 'Renegociada',
  cancelada: 'Cancelada'
});
const QUEM = /** @type {Record<string,string>} */ ({
  CLIENTE: 'Cliente',
  BANCO: 'Banco (financiamento)',
  GOVERNO: 'Subsídio'
});
const DIAS_LEMBRETE = [-5, -3, -1, 0, 1, 3, 7, 15, 30];

export const ERROS_CARTEIRA = /** @type {Record<string,string>} */ ({
  carteira_desligada: 'A carteira está desligada. Ligue em Cadastros › Carteira de recebíveis.',
  carteira_nao_encontrada: 'Carteira não encontrada.',
  carteira_distratada: 'Esta carteira foi distratada.',
  carteira_da_venda: 'Esta carteira veio de uma venda: o distrato é feito na Venda.',
  carteira_nao_ativa: 'Só carteira ativa pode ser distratada.',
  parcela_nao_aberta: 'Esta parcela não está mais em aberto. A tela foi atualizada.',
  parcela_nao_paga: 'Esta parcela não está paga.',
  parcela_nao_encontrada: 'Parcela não encontrada.',
  parcelas_invalidas: 'Escolha só parcelas em aberto do cliente.',
  parcelas_obrigatorias: 'Informe ao menos uma parcela.',
  parcela_invalida: 'Confira as parcelas: cada uma precisa de valor e vencimento.',
  valor_diferente:
    'O valor não bate com o do dia (correção, multa e juros mudam com a data). Confira a data e o desconto.',
  indice_invalido: 'Índice inválido.',
  telefone_invalido: 'Telefone inválido: DDD + número, só dígitos.',
  cliente_obrigatorio: 'Informe o cliente.'
});

const cart = (/** @type {string|null|undefined} */ id) =>
  F.G.carteiras.find((/** @type {any} */ c) => c.id === id) || null;
const resumo = (/** @type {string} */ id) => F.G.resumo.get(id) || {};
export const idCart = (/** @type {any} */ c) =>
  c && c.seq ? `CR-${String(c.seq).padStart(4, '0')}` : 'CR-····';
const stParc = (/** @type {any} */ p) =>
  p.status === 'aberta' && p.vencimento < hojeISO() ? 'vencida' : p.status;
const seloParc = (/** @type {any} */ p) => {
  const s = stParc(p);
  const t = { paga: 'ok', vencida: 'erro', aberta: 'info', renegociada: 'alerta' }[s] || 'off';
  return F.selo(t, ST_PARC[s] || s);
};
const seloCart = (/** @type {any} */ c) =>
  F.selo(
    c.status === 'ativa' ? 'info' : c.status === 'quitada' ? 'ok' : 'off',
    ST_CART[c.status] || c.status
  );
const ondeCart = (/** @type {any} */ c) => [c.empreendimento, c.unidade].filter(Boolean).join(' · ');
const tel = (/** @type {string|null} */ t) => {
  const n = String(t || '');
  if (n.length < 12) return n;
  const d = n.slice(2);
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
};

// Estado da ficha aberta: as parcelas com o valor do dia.
const A = { carteira: /** @type {any} */ (null), parcelas: /** @type {any[]} */ ([]) };

acoes({
  fnCartImportar: () => importar(),
  fnCartNova: () => formCarteira(null),
  fnCartAbrir: el => abrirCarteira(el.dataset.id || ''),
  fnCartEditar: el => formCarteira(el.dataset.id || null),
  fnCartReceber: el => formBaixaParcela(el.dataset.id || ''),
  fnCartEstornar: el => estornarParcela(el.dataset.id || ''),
  fnCartRenegociar: () => formRenegociar(),
  fnCartEncerrar: el => formEncerrar(el.dataset.id || ''),
  fnCartLinhaMais: () =>
    linhaSerie({ serie: 'MENSAL', quantidade: 1, vencimento: hojeISO(), quem_paga: 'CLIENTE' }),
  fnCartLinhaMenos: el => el.closest('.fn-serie')?.remove(),
  fnCartBaixaData: () => recalcularBaixa(),
  fnCartSalvarCfg: () => salvarConfigCarteira(),
  fnCartCfgEmp: el => formCfgEmp(el.dataset.id || ''),
  fnCartModelos: () => carregarModelos(),
  fnCartModeloEscolha: () => escolherModelo()
});

// ─── Lista ───────────────────────────────────────────────────────────────────
export function botoesCarteira() {
  if (!F.G.config.carteira_ativa) return '';
  return `<button type="button" class="lc-btn" data-acao="fnCartImportar">Importar vendas</button>
    <button type="button" class="lc-btn lc-btn-forte" data-acao="fnCartNova">+ Carteira à mão</button>`;
}

export function filtrosCarteira() {
  const st = F.G.filtro.cart || 'ativa';
  return `<label>Situação <select id="fn-f-cart" data-acao-change="fnFiltrar">${F.opcoes({ ativa: 'Ativas', vencidas: 'Com parcela vencida', quitada: 'Quitadas', distratada: 'Distratadas', todas: 'Todas' }, st)}</select></label>
    <input type="search" id="fn-f-busca" placeholder="Buscar ID, cliente, empreendimento ou unidade" value="${esc(F.G.filtro.busca)}" data-acao-input="fnFiltrar">`;
}

export function vistaCarteira() {
  const G = F.G;
  if (!G.config.carteira_ativa && !G.carteiras.length) {
    return `<div class="lc-previa fn-aviso"><span>A carteira de recebíveis está desligada. Ligue em <b>Cadastros › Carteira de recebíveis</b>: a partir daí, cada venda que vira <b>Vendido</b> gera a carteira com as parcelas da proposta, corrigidas pelo índice da obra até as chaves e pelo índice pós-chaves depois.</span>
      <button type="button" class="lc-btn lc-btn-forte" data-acao="fnVista" data-vista="cadastros">Ir para Cadastros</button></div>`;
  }
  const st = G.filtro.cart || 'ativa';
  const q = G.filtro.busca;
  const lista = G.carteiras.filter((/** @type {any} */ c) => {
    const r = resumo(c.id);
    if (
      st === 'vencidas' ? !(c.status === 'ativa' && Number(r.vencido) > 0) : st !== 'todas' && c.status !== st
    )
      return false;
    if (!q) return true;
    return `${idCart(c)} ${c.cliente_nome} ${c.cliente_doc || ''} ${ondeCart(c)}`.toLowerCase().includes(q);
  });
  const ativas = G.carteiras.filter((/** @type {any} */ c) => c.status === 'ativa');
  const soma = (/** @type {string} */ k, l = ativas) =>
    l.reduce((/** @type {number} */ s, /** @type {any} */ c) => s + Number(resumo(c.id)[k] || 0), 0);
  const comVencido = ativas.filter((/** @type {any} */ c) => Number(resumo(c.id).vencido) > 0);
  const aviso = G.config.carteira_ativa
    ? ''
    : '<p class="lc-dica">A carteira está desligada: as carteiras abaixo continuam valendo, mas vendas novas não geram carteira.</p>';
  const linha = (/** @type {any} */ c) => {
    const r = resumo(c.id);
    const venc = Number(r.vencido || 0);
    return `<tr>
      <td class="lc-mono">${esc(idCart(c))}</td>
      <td>${esc(c.cliente_nome)}<small>${esc(ondeCart(c))}</small></td>
      <td class="lc-num">${esc(F.brl(r.valor_original))}</td>
      <td class="lc-num">${esc(F.brl(r.recebido))}</td>
      <td class="lc-num"><b>${esc(F.brl(r.a_receber))}</b><small>${esc(String(r.parcelas_abertas || 0))} parcela(s)</small></td>
      <td class="lc-num">${venc > 0 ? `<b class="fn-saida">${esc(F.brl(venc))}</b><small>${esc(String(r.parcelas_vencidas))} parcela(s) · ${esc(String(r.maior_atraso))} dia(s)</small>` : '—'}</td>
      <td>${esc(F.data(r.proximo_vencimento) || '—')}</td>
      <td>${seloCart(c)}${c.lembretes && c.telefone ? '' : ` ${F.selo('off', 'sem lembrete')}`}</td>
      <td class="lc-acoes"><button class="lc-btn lc-btn-p" data-acao="fnCartAbrir" data-id="${esc(c.id)}">Abrir</button></td></tr>`;
  };
  return `${aviso}<div class="lc-kpis">
      ${F.kpi('A receber (valor de hoje)', F.brl(soma('a_receber')), `${ativas.length} carteira(s) ativa(s)`)}
      ${F.kpi('Vencido', F.brl(soma('vencido')), `${comVencido.length} cliente(s) em atraso`, comVencido.length ? 'lc-kpi-alerta' : '')}
      ${F.kpi('Recebido', F.brl(soma('recebido', G.carteiras)), 'em todas as carteiras')}
      ${F.kpi('Vendido em carteira', F.brl(soma('valor_original', G.carteiras)), 'valor original das parcelas')}
    </div>
    ${F.tabela(
      ['ID', 'Cliente', 'Original', 'Recebido', 'A receber hoje', 'Vencido', 'Próximo', 'Situação', ''],
      lista.map(linha),
      G.carteiras.length
        ? 'Nenhuma carteira neste filtro.'
        : 'Nenhuma carteira ainda. Elas nascem quando uma venda vira Vendido; as vendas antigas entram por "Importar vendas".'
    )}`;
}

async function importar() {
  if (!confirm('Gerar a carteira das vendas já vendidas que ainda não têm carteira?')) return;
  F.executar(async () => {
    const r = await F.rpc('a1_fin_carteira_importar', {});
    F.aviso(r.carteiras ? `${r.carteiras} carteira(s) gerada(s).` : 'Nenhuma venda nova para importar.');
  }, '');
}

// ─── Ficha da carteira ───────────────────────────────────────────────────────
async function lerFicha(/** @type {string} */ id, /** @type {string} */ dia = hojeISO()) {
  const [linhas, parcelas] = await Promise.all([
    F.ler('a1_fin_carteiras', `select=*&id=eq.${encodeURIComponent(id)}`),
    F.rpc('a1_fin_carteira_parcelas', { p_carteira: id, p_data: dia })
  ]);
  A.carteira = linhas[0] || cart(id);
  A.parcelas = Array.isArray(parcelas) ? parcelas : [];
  return A.carteira;
}

export async function abrirCarteira(/** @type {string} */ id) {
  let c;
  try {
    c = await lerFicha(id);
  } catch (e) {
    F.aviso(/** @type {Error} */ (e).message, 'erro');
    return;
  }
  if (!c) return;
  // Lembretes só importam perto de hoje: limita a consulta (URL curta).
  const de = somaMesData(hojeISO(), -2);
  const ate = somaMesData(hojeISO(), 1);
  const ids = A.parcelas
    .filter(p => p.vencimento >= de && p.vencimento <= ate)
    .slice(0, 80)
    .map(p => p.id);
  const lembretes = ids.length
    ? await F.ler(
        'a1_fin_lembretes',
        `select=parcela_id,gatilho,canal,ok,detalhe,criado_em&parcela_id=in.(${ids.map(encodeURIComponent).join(',')})&order=criado_em.desc`
      ).catch(() => [])
    : [];
  const ultimo = new Map();
  lembretes.forEach((/** @type {any} */ l) => {
    if (!ultimo.has(l.parcela_id)) ultimo.set(l.parcela_id, l);
  });
  const ativa = c.status === 'ativa';
  const linha = (/** @type {any} */ p) => {
    const k = p.calc || {};
    const aberta = p.status === 'aberta';
    const l = ultimo.get(p.id);
    const encargos = Number(k.multa || 0) + Number(k.juros || 0);
    return `<tr>
      <td>${aberta && p.quem_paga === 'CLIENTE' && ativa ? `<input type="checkbox" class="fn-reneg" value="${esc(p.id)}" aria-label="Selecionar para renegociar">` : ''}</td>
      <td class="lc-num">${esc(String(p.numero))}</td>
      <td>${esc(p.nome || p.serie)}<small>${esc(QUEM[p.quem_paga] || p.quem_paga)}${p.motivo ? ` · ${esc(p.motivo)}` : ''}</small></td>
      <td>${esc(F.data(p.vencimento))}${k.dias_atraso ? `<small>${esc(String(k.dias_atraso))} dia(s) de atraso</small>` : ''}</td>
      <td class="lc-num">${esc(F.brl(p.valor))}</td>
      <td class="lc-num">${p.calc ? esc(F.brl(k.correcao)) : '—'}${p.calc && Number(k.fator) !== 1 ? `<small>× ${esc(Number(k.fator).toLocaleString('pt-BR', { maximumFractionDigits: 6 }))}</small>` : ''}</td>
      <td class="lc-num">${encargos ? esc(F.brl(encargos)) : '—'}</td>
      <td class="lc-num"><b>${p.calc ? esc(F.brl(p.status === 'paga' ? p.valor_pago : k.total)) : '—'}</b>${p.status === 'paga' ? `<small>pago em ${esc(F.data(p.pago_em))}</small>` : ''}</td>
      <td>${seloParc(p)}${l ? `<small>lembrete ${esc(l.gatilho)} ${l.ok ? 'enviado' : 'falhou'}</small>` : ''}</td>
      <td class="lc-acoes">${
        aberta
          ? `<button class="lc-btn lc-btn-p" data-acao="fnCartReceber" data-id="${esc(p.id)}">Receber</button>`
          : p.status === 'paga'
            ? `<button class="lc-btn lc-btn-p" data-acao="fnCartEstornar" data-id="${esc(p.id)}">Estornar</button>`
            : ''
      }</td></tr>`;
  };
  const r = resumo(c.id);
  F.abrirModal(
    `${idCart(c)} · ${c.cliente_nome}`,
    `<div class="fn-ficha">
      <p class="lc-dica">${esc(ondeCart(c) || 'Sem empreendimento')} · ${seloCart(c)} · base ${esc(F.data(c.data_base))}${c.data_chaves ? ` · chaves ${esc(F.data(c.data_chaves))}` : ''} · ${esc(INDICES[c.indice_obra] || c.indice_obra)} até as chaves, depois ${esc(INDICES[c.indice_pos] || c.indice_pos)}${Number(c.juros_pos_am) ? ` + ${esc(String(c.juros_pos_am))}% a.m.` : ''} · multa ${esc(String(c.multa_pct))}% e juros ${esc(String(c.juros_mora_am))}% a.m. no atraso${c.telefone ? ` · WhatsApp ${esc(tel(c.telefone))}` : ''}</p>
      <div class="lc-kpis">
        ${F.kpi('A receber hoje', F.brl(r.a_receber))}
        ${F.kpi('Vencido', F.brl(r.vencido), r.parcelas_vencidas ? `${r.parcelas_vencidas} parcela(s)` : '', Number(r.vencido) > 0 ? 'lc-kpi-alerta' : '')}
        ${F.kpi('Recebido', F.brl(r.recebido))}
      </div>
      ${F.tabela(['', 'Nº', 'Parcela', 'Vencimento', 'Original', 'Correção', 'Multa + juros', 'Hoje', 'Situação', ''], A.parcelas.map(linha), 'Sem parcelas.')}
      <p class="lc-dica">Correção só nas parcelas do cliente, pelo índice com ${esc(String(c.defasagem_meses))} mês(es) de defasagem${c.negativo_zera ? ' (índice negativo conta como zero)' : ''}. Parcelas do banco e do subsídio entram pelo valor original.</p>
      <div class="fn-ficha-acoes">
        <button type="button" class="lc-btn" data-acao="fnCartEditar" data-id="${esc(c.id)}">Editar dados</button>
        ${ativa ? '<button type="button" class="lc-btn" data-acao="fnCartRenegociar">Renegociar selecionadas</button>' : ''}
        ${ativa && !c.comercial_id ? `<button type="button" class="lc-btn lc-perigo" data-acao="fnCartEncerrar" data-id="${esc(c.id)}">Distratar</button>` : ''}
      </div>
    </div>`,
    null
  );
  document.querySelector('.lc-modal')?.classList.add('fn-modal-largo');
}
const reabrir = (/** @type {string} */ id) => setTimeout(() => abrirCarteira(id), 0);

// ─── Baixa e estorno ─────────────────────────────────────────────────────────
function formBaixaParcela(/** @type {string} */ id) {
  const p = A.parcelas.find(x => x.id === id);
  const c = A.carteira;
  if (!p || !c) return;
  F.abrirModal(
    'Receber parcela',
    `<div class="lc-form">
      <p class="lc-largo"><b>Parcela ${esc(String(p.numero))} · ${esc(p.nome || p.serie)}</b> · ${esc(c.cliente_nome)} · vence ${esc(F.data(p.vencimento))} · original ${esc(F.brl(p.valor))}</p>
      <label>Data do pagamento *<input type="date" id="fp-data" value="${esc(hojeISO())}" max="${esc(hojeISO())}" data-acao-change="fnCartBaixaData"></label>
      <label>Desconto (R$)<input id="fp-desc" inputmode="decimal" value="0" data-acao-change="fnCartBaixaData"></label>
      <label>Conta<select id="fp-conta">${F.opcoesLista(
        F.G.contas.filter((/** @type {any} */ x) => x.ativo),
        F.G.config.conta_padrao || null,
        '— conta padrão —'
      )}</select></label>
      <label>Forma<select id="fp-forma">${F.opcoes(F.FORMAS, 'pix')}</select></label>
      <div class="lc-largo fn-calc" id="fp-calc" data-id="${esc(p.id)}">${calcHtml(p.calc, 0)}</div>
      <p class="lc-largo lc-dica">O valor é o do dia escolhido: correção pelo índice e, se passou do vencimento, multa e juros pro rata. Entra no caixa como "Venda de unidade".</p>
    </div>`,
    async () => {
      const k = await calcDoDia(p.id, F.campo('fp-data'));
      const desc = descontoBaixa();
      const total = Math.round((Number(k.total) - desc) * 100) / 100;
      if (!(total > 0)) throw new Error('O desconto não pode ser maior que o valor.');
      await F.rpc('a1_fin_parcela_baixar', {
        p_parcela: p.id,
        p_pago_em: F.campo('fp-data'),
        p_valor: total,
        p_conta: F.campo('fp-conta') || null,
        p_forma: F.campo('fp-forma'),
        p_desconto: desc,
        p_versao: p.versao
      });
      F.aviso(`Parcela recebida: ${F.brl(total)}.`);
      reabrir(c.id);
    },
    'Receber'
  );
}
function descontoBaixa() {
  const d = F.num(F.campo('fp-desc') || '0');
  if (!Number.isFinite(d) || d < 0) throw new Error('Desconto inválido.');
  return Math.round(d * 100) / 100;
}
async function calcDoDia(/** @type {string} */ id, /** @type {string} */ dia) {
  if (!dia) throw new Error('Informe a data.');
  const l = await F.rpc('a1_fin_carteira_parcelas', { p_carteira: A.carteira.id, p_data: dia });
  const p = (Array.isArray(l) ? l : []).find((/** @type {any} */ x) => x.id === id);
  if (!p || p.status !== 'aberta') throw new Error(ERROS_CARTEIRA.parcela_nao_aberta);
  return p.calc || {};
}
async function recalcularBaixa() {
  const caixa = document.getElementById('fp-calc');
  if (!caixa) return;
  try {
    const k = await calcDoDia(caixa.dataset.id || '', F.campo('fp-data'));
    caixa.innerHTML = calcHtml(k, descontoBaixa());
  } catch (e) {
    caixa.textContent = /** @type {Error} */ (e).message;
  }
}
function calcHtml(/** @type {any} */ k, /** @type {number} */ desc) {
  k = k || {};
  const total = Number(k.total || 0) - desc;
  const linha = (/** @type {string} */ r, /** @type {any} */ v) =>
    `<li><span>${esc(r)}</span><b>${esc(F.brl(v))}</b></li>`;
  return `<ul class="lc-lista">
    ${linha('Original', k.original)}
    ${linha(`Correção (× ${Number(k.fator || 1).toLocaleString('pt-BR', { maximumFractionDigits: 6 })})`, k.correcao)}
    ${Number(k.multa) ? linha('Multa', k.multa) : ''}
    ${Number(k.juros) ? linha(`Juros (${k.dias_atraso} dia(s))`, k.juros) : ''}
    ${desc ? linha('Desconto', -desc) : ''}
    <li class="fn-total"><span>Valor a receber</span><b>${esc(F.brl(total))}</b></li></ul>`;
}

function estornarParcela(/** @type {string} */ id) {
  const p = A.parcelas.find(x => x.id === id);
  if (
    !p ||
    !confirm(
      'Estornar o recebimento desta parcela? O lançamento sai do caixa e a parcela volta a ficar em aberto.'
    )
  )
    return;
  const cid = A.carteira.id;
  F.executar(async () => {
    F.fecharModal();
    await F.rpc('a1_fin_parcela_estornar', { p_parcela: p.id, p_versao: p.versao });
    reabrir(cid);
  }, 'Recebimento estornado.');
}

// ─── Renegociação e distrato ─────────────────────────────────────────────────
function formRenegociar() {
  const marcadas = [...document.querySelectorAll('.fn-reneg:checked')].map(
    x => /** @type {HTMLInputElement} */ (x).value
  );
  const sel = A.parcelas.filter(p => marcadas.includes(p.id));
  if (!sel.length) {
    F.aviso('Marque as parcelas em aberto que entram na renegociação.', 'erro');
    return;
  }
  const c = A.carteira;
  const soma = sel.reduce((s, p) => s + Number((p.calc || {}).total || p.valor), 0);
  F.abrirModal(
    'Renegociar parcelas',
    `<div class="lc-form">
      <p class="lc-largo">${esc(String(sel.length))} parcela(s) selecionada(s), que hoje somam <b>${esc(F.brl(soma))}</b> (com correção, multa e juros). Elas ficam como "renegociadas" e entram as novas abaixo, corrigidas a partir deste mês.</p>
      <label>Quantidade de parcelas *<input id="fr-qtd" type="number" min="1" max="240" value="1"></label>
      <label>Valor de cada (R$) *<input id="fr-valor" inputmode="decimal" value="${esc(soma.toFixed(2).replace('.', ','))}"></label>
      <label>Primeiro vencimento *<input id="fr-venc" type="date" value="${esc(somaMesData(hojeISO(), 1))}"></label>
      <label class="lc-largo">Motivo *<input id="fr-motivo" maxlength="300" placeholder="Ex.: acordo com o cliente em ${esc(F.data(hojeISO()))}"></label>
    </div>`,
    async () => {
      const qtd = Number(F.campo('fr-qtd'));
      const valor = F.num(F.campo('fr-valor'));
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 240) throw new Error('Quantidade de 1 a 240.');
      if (!Number.isFinite(valor) || valor <= 0) throw new Error('Informe o valor.');
      if (!F.campo('fr-venc')) throw new Error('Informe o primeiro vencimento.');
      if (F.campo('fr-motivo').length < 3) throw new Error(F.ERROS.motivo_obrigatorio);
      const r = await F.rpc('a1_fin_renegociar', {
        p_carteira: c.id,
        p_parcelas: sel.map(p => p.id),
        p_novas: [{ quantidade: qtd, valor, vencimento: F.campo('fr-venc') }],
        p_motivo: F.campo('fr-motivo')
      });
      F.aviso(`Renegociado: ${r.novas} parcela(s) nova(s).`);
      reabrir(c.id);
    },
    'Renegociar'
  );
}

function formEncerrar(/** @type {string} */ id) {
  const c = A.carteira && A.carteira.id === id ? A.carteira : cart(id);
  if (!c) return;
  F.abrirModal(
    'Distratar carteira',
    `<div class="lc-form">
      <p class="lc-largo">As parcelas em aberto de <b>${esc(c.cliente_nome)}</b> serão canceladas. As já recebidas continuam no caixa (estorne uma a uma, se for o caso).</p>
      <label class="lc-largo">Motivo *<input id="fe-motivo" maxlength="300"></label>
    </div>`,
    async () => {
      if (F.campo('fe-motivo').length < 3) throw new Error(F.ERROS.motivo_obrigatorio);
      await F.rpc('a1_fin_carteira_encerrar', {
        p_carteira: c.id,
        p_motivo: F.campo('fe-motivo'),
        p_versao: c.versao
      });
      F.aviso('Carteira distratada.');
    },
    'Distratar'
  );
}

// ─── Carteira à mão e edição ─────────────────────────────────────────────────
function linhaSerie(/** @type {any} */ s) {
  const caixa = document.getElementById('fc-series');
  if (!caixa) return;
  const d = document.createElement('div');
  d.className = 'fn-serie';
  d.innerHTML = `<label>Série<select class="fs-serie">${F.opcoes({ ATO: 'Ato / sinal', ENTRADA: 'Entrada', MENSAL: 'Mensal', INTERMEDIARIA: 'Intermediária', ANUAL: 'Anual', CHAVES: 'Chaves', FINANCIAMENTO: 'Financiamento', SUBSIDIO: 'Subsídio', OUTRA: 'Outra' }, s.serie)}</select></label>
    <label>Quem paga<select class="fs-quem">${F.opcoes(QUEM, s.quem_paga)}</select></label>
    <label>Qtd.<input class="fs-qtd" type="number" min="1" max="240" value="${esc(String(s.quantidade))}"></label>
    <label>Valor de cada (R$)<input class="fs-valor" inputmode="decimal" value="${esc(s.valor ?? '')}"></label>
    <label>1º vencimento<input class="fs-venc" type="date" value="${esc(s.vencimento || '')}"></label>
    <label>A cada<select class="fs-passo">${F.opcoes({ 1: 'mês', 6: '6 meses', 12: 'ano' }, String(s.passo || (s.serie === 'ANUAL' ? 12 : 1)))}</select></label>
    <button type="button" class="lc-btn lc-btn-p lc-perigo" data-acao="fnCartLinhaMenos" aria-label="Remover série">×</button>`;
  caixa.appendChild(d);
}

function series() {
  /** @type {any[]} */
  const out = [];
  document.querySelectorAll('.fn-serie').forEach(el => {
    const v = (/** @type {string} */ s) => /** @type {HTMLInputElement} */ (el.querySelector(s)).value.trim();
    const qtd = Number(v('.fs-qtd'));
    const valor = F.num(v('.fs-valor'));
    const passo = Number(v('.fs-passo')) || 1;
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 240)
      throw new Error('Quantidade de 1 a 240 em cada série.');
    if (!Number.isFinite(valor) || valor <= 0) throw new Error('Informe o valor de cada série.');
    if (!v('.fs-venc')) throw new Error('Informe o 1º vencimento de cada série.');
    const serie = v('.fs-serie');
    for (let i = 0; i < qtd; i++)
      out.push({
        serie,
        nome: qtd > 1 ? `${serie.charAt(0)}${serie.slice(1).toLowerCase()} ${i + 1}/${qtd}` : '',
        quem_paga: v('.fs-quem'),
        valor,
        vencimento: somaMesData(v('.fs-venc'), i * passo)
      });
  });
  if (!out.length) throw new Error(ERROS_CARTEIRA.parcelas_obrigatorias);
  if (out.length > 600) throw new Error('No máximo 600 parcelas.');
  return out;
}

function camposCorrecao(/** @type {any} */ c) {
  return `<label>Data das chaves<input id="fc-chaves" type="date" value="${esc(c.data_chaves || '')}"></label>
    <label>Índice até as chaves<select id="fc-iobra">${F.opcoes(INDICES, c.indice_obra || 'INCC')}</select></label>
    <label>Índice depois das chaves<select id="fc-ipos">${F.opcoes(INDICES, c.indice_pos || 'IGPM')}</select></label>
    <label>Juros depois das chaves (% a.m.)<input id="fc-jpos" inputmode="decimal" value="${esc(c.juros_pos_am ?? 0)}"></label>
    <label>Defasagem do índice (meses)<select id="fc-defas">${F.opcoes({ 0: '0', 1: '1', 2: '2', 3: '3' }, String(c.defasagem_meses ?? 1))}</select></label>
    <label>Multa no atraso (%)<input id="fc-multa" inputmode="decimal" value="${esc(c.multa_pct ?? 2)}"></label>
    <label>Juros de mora (% a.m.)<input id="fc-mora" inputmode="decimal" value="${esc(c.juros_mora_am ?? 1)}"></label>
    <label class="lc-check"><input type="checkbox" id="fc-zera"${c.negativo_zera === false ? '' : ' checked'}> Índice negativo conta como zero</label>`;
}
function lerCorrecao() {
  const n = (/** @type {string} */ id, /** @type {number} */ max) => {
    const v = F.num(F.campo(id) || '0');
    if (!Number.isFinite(v) || v < 0 || v > max) throw new Error(`Confira os percentuais (de 0 a ${max}).`);
    return v;
  };
  return {
    data_chaves: F.campo('fc-chaves') || null,
    indice_obra: F.campo('fc-iobra'),
    indice_pos: F.campo('fc-ipos'),
    juros_pos_am: n('fc-jpos', 5),
    defasagem_meses: Number(F.campo('fc-defas')),
    multa_pct: n('fc-multa', 10),
    juros_mora_am: n('fc-mora', 10),
    negativo_zera: F.marcado('fc-zera')
  };
}

async function formCarteira(/** @type {string|null} */ id) {
  const c = id
    ? A.carteira && A.carteira.id === id
      ? A.carteira
      : cart(id)
    : { lembretes: true, data_base: hojeISO() };
  if (id && !c) return;
  const emps = F.G.empreendimentos || [];
  F.abrirModal(
    id ? `Editar ${idCart(c)}` : 'Nova carteira à mão',
    `<div class="lc-form">
      <label class="lc-largo">Cliente *<input id="fc-cliente" maxlength="160" value="${esc(c.cliente_nome || '')}"></label>
      <label>CPF/CNPJ<input id="fc-doc" maxlength="20" value="${esc(c.cliente_doc || '')}"></label>
      <label>WhatsApp<input id="fc-tel" maxlength="20" inputmode="tel" placeholder="(98) 98123-4567" value="${esc(c.telefone ? c.telefone.slice(2) : '')}"></label>
      ${
        id
          ? `<p class="lc-largo lc-dica">${esc(ondeCart(c) || 'Sem empreendimento')} · base ${esc(F.data(c.data_base))}</p>`
          : `<label>Empreendimento<select id="fc-emp">${F.opcoesLista(emps, null, '— outro / nenhum —')}</select></label>
             <label>Unidade<input id="fc-unid" maxlength="60"></label>
             <label>Data-base da correção<input id="fc-base" type="date" value="${esc(hojeISO())}"></label>`
      }
      ${camposCorrecao(c)}
      <label class="lc-check"><input type="checkbox" id="fc-lembra"${c.lembretes === false ? '' : ' checked'}> Mandar lembrete de parcela pelo WhatsApp</label>
      <label class="lc-largo">Observação<input id="fc-obs" maxlength="1000" value="${esc(c.observacao || '')}"></label>
      ${
        id
          ? ''
          : `<div class="lc-largo"><h4>Parcelas</h4><div id="fc-series"></div>
             <button type="button" class="lc-btn lc-btn-p" data-acao="fnCartLinhaMais">+ Série de parcelas</button></div>`
      }
    </div>`,
    async () => {
      if (F.campo('fc-cliente').length < 2) throw new Error(ERROS_CARTEIRA.cliente_obrigatorio);
      const dados = {
        cliente_nome: F.campo('fc-cliente'),
        cliente_doc: F.campo('fc-doc'),
        telefone: F.campo('fc-tel'),
        lembretes: F.marcado('fc-lembra'),
        observacao: F.campo('fc-obs'),
        ...lerCorrecao()
      };
      if (id) {
        await F.rpc('a1_fin_carteira_salvar', {
          p_id: id,
          p_dados: { ...dados, versao: c.versao },
          p_parcelas: null
        });
        F.aviso('Carteira salva.');
        reabrir(id);
        return;
      }
      const emp = emps.find((/** @type {any} */ e) => e.id === F.campo('fc-emp'));
      const r = await F.rpc('a1_fin_carteira_salvar', {
        p_id: null,
        p_dados: {
          ...dados,
          empreendimento_id: emp ? emp.id : '',
          empreendimento: emp ? emp.name : '',
          unidade: F.campo('fc-unid'),
          data_base: F.campo('fc-base')
        },
        p_parcelas: series()
      });
      F.aviso('Carteira criada.');
      reabrir(r.id);
    }
  );
  document.querySelector('.lc-modal')?.classList.add('fn-modal-largo');
  if (!id)
    linhaSerie({
      serie: 'MENSAL',
      quantidade: 1,
      vencimento: somaMesData(hojeISO(), 1),
      quem_paga: 'CLIENTE'
    });
}

// ─── Cadastros: carteira, lembrete e correção por empreendimento ─────────────
export function cadastrosCarteira() {
  const cfg = F.G.config || {};
  const modelo = cfg.lembrete_modelo || {};
  const dias = Array.isArray(cfg.lembrete_dias) ? cfg.lembrete_dias : [-3, 0, 1, 7];
  const rotDia = (/** @type {number} */ d) =>
    d === 0 ? 'no dia' : d < 0 ? `${-d} dia(s) antes` : `${d} dia(s) depois`;
  const emps = F.G.empreendimentos || [];
  const cfgEmp = new Map((F.G.cartCfg || []).map((/** @type {any} */ x) => [x.empreendimento_id, x]));
  return `<section class="lc-bloco fn-sec"><h3>Carteira de recebíveis</h3>
      <label class="lc-check"><input type="checkbox" id="fk-ativa"${cfg.carteira_ativa ? ' checked' : ''}> Gerar a carteira de parcelas quando a venda vira <b>Vendido</b></label>
      <p class="lc-dica">A carteira nasce com as parcelas da proposta (ato, mensais, intermediárias, chaves) e com o financiamento/subsídio como parcelas do banco. Distrato na Venda cancela as parcelas em aberto. Vendas antigas entram por "Importar vendas" na Carteira.</p>
      <h4>Lembrete pelo WhatsApp</h4>
      <label class="lc-check"><input type="checkbox" id="fk-lembra"${cfg.lembrete_ativo ? ' checked' : ''}> Mandar lembrete das parcelas do cliente</label>
      <div class="fn-dias">${DIAS_LEMBRETE.map(d => `<label class="lc-check"><input type="checkbox" class="fk-dia" value="${d}"${dias.includes(d) ? ' checked' : ''}> ${esc(rotDia(d))}</label>`).join('')}</div>
      <div class="lc-form">
        <label>Modelo aprovado (WhatsApp oficial)<select id="fk-escolha" data-acao-change="fnCartModeloEscolha"><option value="">— escreva abaixo ou carregue os modelos —</option></select></label>
        <div><button type="button" class="lc-btn lc-btn-p" data-acao="fnCartModelos">Carregar modelos aprovados</button></div>
        <label>Nome do modelo<input id="fk-nome" maxlength="60" value="${esc(modelo.nome || '')}" placeholder="lembrete_parcela"></label>
        <label>Idioma<input id="fk-idioma" maxlength="10" value="${esc(modelo.idioma || 'pt_BR')}"></label>
        <label class="lc-largo">Texto *<textarea id="fk-corpo" rows="3" maxlength="1024" placeholder="Olá {{1}}, sua parcela de {{2}} vence em {{3}} ({{4}}).">${esc(modelo.corpo || '')}</textarea></label>
      </div>
      <p class="lc-dica">{{1}} nome do cliente · {{2}} valor do dia · {{3}} vencimento · {{4}} empreendimento e unidade. Com o WhatsApp oficial, sai o modelo aprovado pela Meta (o nome precisa ser o do modelo). Sem ele, ou com o oficial fora do ar e a reserva ligada, sai o texto pela conexão da Evolution. Os envios rodam de hora em hora, das 9h às 17h.</p>
      <button type="button" class="lc-btn lc-btn-forte" data-acao="fnCartSalvarCfg">Salvar</button>
    </section>
    <section class="lc-bloco fn-sec"><h3>Correção por empreendimento</h3>
      <p class="lc-dica">Vale para as carteiras que nascerem das vendas deste empreendimento. Sem configuração: INCC-DI até as chaves, IGP-M depois, 1 mês de defasagem, multa de 2% e juros de 1% a.m.</p>
      ${F.tabela(
        ['Empreendimento', 'Chaves', 'Até as chaves', 'Depois', 'Juros pós', 'Atraso', ''],
        emps.map((/** @type {any} */ e) => {
          const x = cfgEmp.get(e.id) || {};
          return `<tr><td>${esc(e.name)}</td><td>${esc(F.data(x.data_chaves) || '—')}</td>
            <td>${esc(INDICES[x.indice_obra || 'INCC'])}</td><td>${esc(INDICES[x.indice_pos || 'IGPM'])}</td>
            <td class="lc-num">${esc(String(x.juros_pos_am ?? 0))}% a.m.</td>
            <td>multa ${esc(String(x.multa_pct ?? 2))}% · ${esc(String(x.juros_mora_am ?? 1))}% a.m.</td>
            <td class="lc-acoes"><button class="lc-btn lc-btn-p" data-acao="fnCartCfgEmp" data-id="${esc(e.id)}">${x.empreendimento_id ? 'Editar' : 'Configurar'}</button></td></tr>`;
        }),
        'Nenhum empreendimento cadastrado.'
      )}</section>`;
}

// Valida antes de gravar: um erro aqui não redesenha a tela (o que apagaria o
// que a pessoa digitou); só a gravação passa por executar().
function salvarConfigCarteira() {
  const corpo = F.campo('fk-corpo');
  const nome = F.campo('fk-nome');
  const idioma = F.campo('fk-idioma') || 'pt_BR';
  const dias = [...document.querySelectorAll('.fk-dia:checked')].map(x =>
    Number(/** @type {HTMLInputElement} */ (x).value)
  );
  const lembra = F.marcado('fk-lembra');
  const erro =
    nome && !/^[a-z0-9_]{1,60}$/.test(nome)
      ? 'Nome do modelo: só letras minúsculas, números e _ (como na Meta).'
      : !/^[a-z]{2}(_[A-Z]{2})?$/.test(idioma)
        ? 'Idioma no formato pt_BR.'
        : lembra && !corpo
          ? 'Escreva o texto do lembrete (ou escolha um modelo aprovado).'
          : lembra && !dias.length
            ? 'Escolha ao menos um dia para o lembrete.'
            : '';
  if (erro) {
    F.aviso(erro, 'erro');
    return;
  }
  const linha = {
    tenant_id: (A1.user || {}).tenant_id,
    carteira_ativa: F.marcado('fk-ativa'),
    lembrete_ativo: lembra,
    lembrete_dias: dias.length ? dias : [-3, 0, 1, 7],
    lembrete_modelo: corpo ? { nome: nome || null, idioma, corpo } : null,
    atualizado_em: new Date().toISOString()
  };
  F.executar(
    () => F.gravar('a1_fin_config', linha, null, '?on_conflict=tenant_id'),
    'Carteira e lembretes salvos.'
  );
}

/** @type {any[]} */
let modelos = [];
async function carregarModelos() {
  const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('fk-escolha'));
  if (!sel) return;
  try {
    const r = await fetch(`${A1_URL}/functions/v1/atendimento-conectores`, {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({ action: 'wa_modelos' }),
      signal: AbortSignal.timeout(20000)
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Não foi possível carregar os modelos agora.');
    modelos = (Array.isArray(b.modelos) ? b.modelos : []).filter(
      (/** @type {any} */ m) => m.status === 'APPROVED' && m.suportado
    );
    if (!modelos.length)
      throw new Error('Nenhum modelo aprovado. Crie em Configurações › Integrações › WhatsApp oficial.');
    sel.innerHTML = '<option value="">— escolha —</option>';
    modelos.forEach((m, i) => sel.append(new Option(`${m.nome} (${m.idioma})`, String(i))));
    F.aviso(`${modelos.length} modelo(s) aprovado(s).`);
  } catch (e) {
    F.aviso(/** @type {Error} */ (e).message, 'erro');
  }
}
function escolherModelo() {
  const sel = /** @type {HTMLSelectElement} */ (document.getElementById('fk-escolha'));
  const m = modelos[Number(sel.value)];
  if (!sel.value || !m) return;
  /** @type {HTMLInputElement} */ (document.getElementById('fk-nome')).value = m.nome;
  /** @type {HTMLInputElement} */ (document.getElementById('fk-idioma')).value = m.idioma;
  /** @type {HTMLTextAreaElement} */ (document.getElementById('fk-corpo')).value = m.corpo || '';
}

function formCfgEmp(/** @type {string} */ id) {
  const e = (F.G.empreendimentos || []).find((/** @type {any} */ x) => x.id === id);
  if (!e) return;
  const x = (F.G.cartCfg || []).find((/** @type {any} */ y) => y.empreendimento_id === id) || {};
  F.abrirModal(
    `Correção · ${e.name}`,
    `<div class="lc-form">${camposCorrecao(x)}
      <p class="lc-largo lc-dica">Mudar aqui vale para as próximas carteiras deste empreendimento. As que já existem mudam pela ficha de cada uma (Editar dados).</p></div>`,
    async () => {
      await F.gravar(
        'a1_fin_carteira_cfg',
        {
          tenant_id: (A1.user || {}).tenant_id,
          empreendimento_id: id,
          ...lerCorrecao(),
          atualizado_em: new Date().toISOString()
        },
        null,
        '?on_conflict=tenant_id,empreendimento_id'
      );
      F.aviso('Correção do empreendimento salva.');
    }
  );
}
