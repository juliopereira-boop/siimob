// ─── Financeiro · DRE, orçamento e centros de custo (fase 2) ─────────────────
//
// COMO FUNCIONA
//   - O banco agrupa (a1_fin_dre): por mês, categoria e grupo do DRE, no regime
//     de caixa (o que foi pago/recebido) ou de competência (o mês do fato,
//     cancelados fora), com o orçado ao lado. A tela só monta a cascata:
//     receita bruta, deduções, líquida, custos, lucro bruto, despesas,
//     resultado operacional, financeiro e não operacional, resultado líquido.
//   - O grupo de cada categoria é escolhido em Cadastros; sem escolha vale o
//     padrão (impostos = dedução, comissões pagas e custas = custo).
//   - Centro de custo (empreendimento, filial, projeto) filtra o DRE; a baixa
//     de parcela da carteira cai sozinha no centro do empreendimento.
import { esc } from '../../shared/utils/texto.js';
import { hojeISO } from '../../shared/utils/datas.js';
import { acoes } from '../../shared/ui/acoes.js';
import { A1 } from '../../shared/api/config.js';
import { F } from './ctx.js';

export const GRUPOS = /** @type {Record<string,string>} */ ({
  receita: 'Receita bruta',
  deducao: 'Deduções (impostos sobre a receita)',
  custo: 'Custos (comissões pagas, custas)',
  despesa: 'Despesas operacionais',
  financeira_receita: 'Receitas financeiras',
  financeira_despesa: 'Despesas financeiras',
  nao_operacional: 'Não operacional'
});
const TIPOS_CENTRO = /** @type {Record<string,string>} */ ({
  empreendimento: 'Empreendimento',
  filial: 'Filial',
  projeto: 'Projeto',
  outro: 'Outro'
});
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Grupo padrão de uma categoria (o mesmo de a1_fin_grupo_dre no banco). */
export const grupoPadrao = (/** @type {any} */ c) =>
  c.grupo_dre ||
  (c.chave === 'impostos'
    ? 'deducao'
    : ['comissao_paga', 'custas'].includes(c.chave)
      ? 'custo'
      : c.tipo === 'receita'
        ? 'receita'
        : 'despesa');

acoes({
  fnDreAtualizar: () => carregarDre(),
  fnDreOrcamento: () => formOrcamento(),
  fnDreOrcAno: () => formOrcamento(),
  fnNovoCentro: () => formCentro(null),
  fnEditarCentro: el => formCentro(el.dataset.id || null),
  fnCentrosEmp: () => centrosDosEmpreendimentos()
});

// ─── DRE ─────────────────────────────────────────────────────────────────────
const D = { linhas: /** @type {any[]} */ ([]), chave: '', erro: '' };

export function botoesDre() {
  return '<button type="button" class="lc-btn" data-acao="fnDreOrcamento">Orçamento</button>';
}
export function filtrosDre() {
  const f = F.G.filtro;
  const ano = hojeISO().slice(0, 4);
  f.dreDe = f.dreDe || `${ano}-01`;
  f.dreAte = f.dreAte || hojeISO().slice(0, 7);
  return `<label>De <input type="month" id="fn-f-dre-de" value="${esc(f.dreDe)}" data-acao-change="fnFiltrar"></label>
    <label>Até <input type="month" id="fn-f-dre-ate" value="${esc(f.dreAte)}" data-acao-change="fnFiltrar"></label>
    <label>Regime <select id="fn-f-regime" data-acao-change="fnFiltrar">${F.opcoes({ caixa: 'Caixa (pago/recebido)', competencia: 'Competência' }, f.regime || 'caixa')}</select></label>
    <label>Centro de custo <select id="fn-f-centro" data-acao-change="fnFiltrar">${F.opcoesLista(F.G.centros, f.centro || null, 'Todos')}</select></label>`;
}
const ultimoDia = (/** @type {string} */ ym) => {
  const [a, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};
const mesesEntre = (/** @type {string} */ de, /** @type {string} */ ate) => {
  const out = [];
  let [a, m] = de.split('-').map(Number);
  const fim = ate;
  while (`${a}-${String(m).padStart(2, '0')}` <= fim && out.length < 36) {
    out.push(`${a}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
  }
  return out;
};

async function carregarDre() {
  const f = F.G.filtro;
  const chave = `${f.dreDe}|${f.dreAte}|${f.regime || 'caixa'}|${f.centro || ''}`;
  try {
    if (f.dreAte < f.dreDe) throw new Error('O mês final vem antes do inicial.');
    const r = await F.rpc('a1_fin_dre', {
      p_inicio: `${f.dreDe}-01`,
      p_fim: ultimoDia(f.dreAte),
      p_centro: f.centro || null,
      p_regime: f.regime || 'caixa'
    });
    D.linhas = Array.isArray(r) ? r : [];
    D.erro = '';
  } catch (e) {
    D.linhas = [];
    D.erro = /** @type {Error} */ (e).message;
  }
  D.chave = chave;
  if (F.G.vista === 'dre') F.desenharConteudo();
}

export function vistaDre() {
  const f = F.G.filtro;
  const chave = `${f.dreDe}|${f.dreAte}|${f.regime || 'caixa'}|${f.centro || ''}`;
  if (D.chave !== chave) {
    D.chave = chave;
    carregarDre();
    return '<p class="lc-vazio">Montando o DRE...</p>';
  }
  if (D.erro) return `<p class="lc-erro">${esc(D.erro)}</p>`;
  const meses = mesesEntre(f.dreDe, f.dreAte);
  const tipoCat = new Map(F.G.categorias.map((/** @type {any} */ c) => [c.id, c.tipo]));
  // Sinal no resultado: receita soma, o resto subtrai; no "não operacional" vale o tipo da categoria.
  const sinalDe = (/** @type {any} */ l) => {
    if (['receita', 'financeira_receita'].includes(l.grupo)) return 1;
    if (l.grupo !== 'nao_operacional') return -1;
    const t = l.categoria_id
      ? tipoCat.get(l.categoria_id)
      : /^Receitas/.test(l.categoria)
        ? 'receita'
        : 'despesa';
    return t === 'receita' ? 1 : -1;
  };
  /** @type {Map<string, {grupo:string, nome:string, sinal:number, mes:Map<string,number>, real:number, orc:number}>} */
  const cats = new Map();
  for (const l of D.linhas) {
    const k = `${l.grupo}|${l.categoria_id || l.categoria}`;
    if (!cats.has(k))
      cats.set(k, { grupo: l.grupo, nome: l.categoria, sinal: sinalDe(l), mes: new Map(), real: 0, orc: 0 });
    const c = /** @type {any} */ (cats.get(k));
    const ym = String(l.mes).slice(0, 7);
    c.mes.set(ym, (c.mes.get(ym) || 0) + Number(l.realizado || 0));
    c.real += Number(l.realizado || 0);
    c.orc += Number(l.orcado || 0);
  }
  const porGrupo = (/** @type {string} */ g) =>
    [...cats.values()].filter(c => c.grupo === g).sort((a, b) => b.real - a.real);
  /** Valor com sinal de uma categoria: um mês, o total realizado ou o orçado. */
  const val = (/** @type {any} */ c, /** @type {string|null} */ ym, orc = false) =>
    c.sinal * (ym ? c.mes.get(ym) || 0 : orc ? c.orc : c.real);
  const tot = (/** @type {string[]} */ gs, /** @type {string|null} */ ym, orc = false) =>
    gs.reduce((s, g) => s + porGrupo(g).reduce((t, c) => t + val(c, ym, orc), 0), 0);
  const num = (/** @type {number} */ v, forte = false) =>
    Math.abs(v) < 0.005
      ? '<td class="lc-num fn-zero">—</td>'
      : `<td class="lc-num${v < 0 ? ' fn-saida' : ''}">${forte ? '<b>' : ''}${esc(F.brl(v))}${forte ? '</b>' : ''}</td>`;
  const pctOrc = (/** @type {number} */ real, /** @type {number} */ orc) =>
    `<td class="lc-num">${orc ? esc(`${Math.round((Math.abs(real) / Math.abs(orc)) * 100)}%`) : '—'}</td>`;
  const linhaGrupo = (/** @type {string} */ g, /** @type {string} */ rot) => {
    const lista = porGrupo(g);
    if (!lista.length) return '';
    const soma = (/** @type {string|null} */ ym, orc = false) =>
      lista.reduce((t, c) => t + val(c, ym, orc), 0);
    const cab = `<tr class="fn-dre-grupo"><td>${esc(rot)} ${esc(GRUPOS[g])}</td>${meses.map(m => num(soma(m))).join('')}${num(soma(null), true)}${num(soma(null, true))}${pctOrc(soma(null), soma(null, true))}</tr>`;
    return (
      cab +
      lista
        .map(
          c =>
            `<tr class="fn-dre-cat"><td>${esc(c.nome)}</td>${meses.map(m => num(val(c, m))).join('')}${num(val(c, null))}${num(val(c, null, true))}${pctOrc(c.real, c.orc)}</tr>`
        )
        .join('')
    );
  };
  const linhaTotal = (/** @type {string} */ rot, /** @type {string[]} */ gs) =>
    `<tr class="fn-dre-total"><td>= ${esc(rot)}</td>${meses.map(m => num(tot(gs, m), true)).join('')}${num(tot(gs, null), true)}${num(tot(gs, null, true), true)}<td></td></tr>`;
  if (!D.linhas.length)
    return `<p class="lc-vazio">Nada no período${f.centro ? ' neste centro de custo' : ''}. No regime de caixa entram só os lançamentos pagos/recebidos; no de competência, os do mês do fato.</p>`;
  const resultado = tot(
    ['receita', 'deducao', 'custo', 'despesa', 'financeira_receita', 'financeira_despesa', 'nao_operacional'],
    null
  );
  const receita = tot(['receita'], null);
  return `<div class="lc-kpis">
      ${F.kpi('Receita bruta', F.brl(receita))}
      ${F.kpi('Lucro bruto', F.brl(tot(['receita', 'deducao', 'custo'], null)))}
      ${F.kpi('Resultado líquido', F.brl(resultado), receita ? `margem ${Math.round((resultado / receita) * 100)}%` : '', resultado < 0 ? 'lc-kpi-alerta' : '')}
      ${F.kpi('Orçado (resultado)', F.brl(tot(['receita', 'deducao', 'custo', 'despesa', 'financeira_receita', 'financeira_despesa', 'nao_operacional'], null, true)))}
    </div>
    <div class="lc-tbl fn-dre"><table><thead><tr><th>${f.regime === 'competencia' ? 'Competência' : 'Caixa'}</th>${meses.map(m => `<th>${esc(F.mes(m))}</th>`).join('')}<th>Total</th><th>Orçado</th><th>% orç.</th></tr></thead><tbody>
      ${linhaGrupo('receita', '')}
      ${linhaGrupo('deducao', '(−)')}
      ${linhaTotal('Receita líquida', ['receita', 'deducao'])}
      ${linhaGrupo('custo', '(−)')}
      ${linhaTotal('Lucro bruto', ['receita', 'deducao', 'custo'])}
      ${linhaGrupo('despesa', '(−)')}
      ${linhaTotal('Resultado operacional', ['receita', 'deducao', 'custo', 'despesa'])}
      ${linhaGrupo('financeira_receita', '(+)')}
      ${linhaGrupo('financeira_despesa', '(−)')}
      ${linhaGrupo('nao_operacional', '(±)')}
      ${linhaTotal('Resultado líquido', ['receita', 'deducao', 'custo', 'despesa', 'financeira_receita', 'financeira_despesa', 'nao_operacional'])}
    </tbody></table></div>
    <p class="lc-dica">Lançamento sem categoria entra como "sem categoria" em receita ou despesa. Troque o grupo de uma categoria em Cadastros › Categorias.</p>`;
}

// ─── Orçamento ───────────────────────────────────────────────────────────────
async function formOrcamento() {
  const anoEl = /** @type {HTMLInputElement|null} */ (document.getElementById('fo-ano'));
  const centroEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('fo-centro'));
  const ano = Number(anoEl ? anoEl.value : (F.G.filtro.dreDe || hojeISO()).slice(0, 4));
  const centro = centroEl ? centroEl.value : F.G.filtro.centro || '';
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return;
  let atuais = [];
  try {
    atuais = await F.ler(
      'a1_fin_orcamentos',
      `select=categoria_id,mes,valor&mes=gte.${ano}-01-01&mes=lte.${ano}-12-01&centro_id=${centro ? `eq.${encodeURIComponent(centro)}` : 'is.null'}`
    );
  } catch (e) {
    F.aviso(/** @type {Error} */ (e).message, 'erro');
    return;
  }
  const val = new Map(
    atuais.map((/** @type {any} */ o) => [`${o.categoria_id}|${String(o.mes).slice(5, 7)}`, Number(o.valor)])
  );
  const cats = F.G.categorias.filter((/** @type {any} */ c) => c.ativo);
  const ordem = Object.keys(GRUPOS);
  cats.sort(
    (/** @type {any} */ a, /** @type {any} */ b) =>
      ordem.indexOf(grupoPadrao(a)) - ordem.indexOf(grupoPadrao(b)) || a.nome.localeCompare(b.nome)
  );
  const celula = (/** @type {any} */ c, /** @type {number} */ m) => {
    const mm = String(m + 1).padStart(2, '0');
    const v = val.get(`${c.id}|${mm}`);
    return `<td><input class="fo-v" inputmode="decimal" data-cat="${esc(c.id)}" data-mes="${esc(mm)}" value="${v ? esc(String(v).replace('.', ',')) : ''}" aria-label="${esc(c.nome)} ${MESES[m]}"></td>`;
  };
  F.abrirModal(
    'Orçamento',
    `<div class="lc-form">
      <label>Ano<input id="fo-ano" type="number" min="2000" max="2100" value="${esc(String(ano))}" data-acao-change="fnDreOrcAno"></label>
      <label>Centro de custo<select id="fo-centro" data-acao-change="fnDreOrcAno">${F.opcoesLista(F.G.centros, centro || null, 'Empresa inteira (sem centro)')}</select></label>
    </div>
    <div class="lc-tbl fn-orc"><table><thead><tr><th>Categoria</th>${MESES.map(m => `<th>${m}</th>`).join('')}</tr></thead><tbody>
      ${cats.map((/** @type {any} */ c) => `<tr><td>${esc(c.nome)}<small>${esc(GRUPOS[grupoPadrao(c)])}</small></td>${MESES.map((_, i) => celula(c, i)).join('')}</tr>`).join('')}
    </tbody></table></div>
    <p class="lc-dica">Valores em reais, sempre positivos (o DRE sabe o que é receita e o que é despesa). Célula vazia ou zero apaga o orçado do mês.</p>`,
    async () => {
      const valores = [...document.querySelectorAll('.fo-v')].map(x => {
        const el = /** @type {HTMLInputElement} */ (x);
        const v = el.value.trim() ? F.num(el.value) : 0;
        if (!Number.isFinite(v) || v < 0) throw new Error('Confira os valores: só números positivos.');
        return {
          categoria: el.dataset.cat,
          mes: `${ano}-${el.dataset.mes}-01`,
          valor: v,
          antes: val.get(`${el.dataset.cat}|${el.dataset.mes}`) || 0
        };
      });
      const mudou = valores.filter(v => Math.abs(v.valor - v.antes) >= 0.005).map(({ antes, ...v }) => v);
      if (!mudou.length) return;
      const r = await F.rpc('a1_fin_orcamento_salvar', {
        p_ano: ano,
        p_centro: centro || null,
        p_valores: mudou
      });
      D.chave = '';
      F.aviso(`Orçamento salvo (${r.valores} valor(es) no ano).`);
    }
  );
  document.querySelector('.lc-modal')?.classList.add('fn-modal-largo');
}

// ─── Centros de custo (Cadastros) ────────────────────────────────────────────
export function cadastrosCentros() {
  const emps = new Map((F.G.empreendimentos || []).map((/** @type {any} */ e) => [e.id, e.name]));
  const semCentro = (F.G.empreendimentos || []).filter(
    (/** @type {any} */ e) => !F.G.centros.some((/** @type {any} */ c) => c.empreendimento_id === e.id)
  );
  return `<section class="lc-bloco fn-sec"><h3>Centros de custo <button type="button" class="lc-btn lc-btn-p" data-acao="fnNovoCentro">+ Centro</button>${semCentro.length ? ` <button type="button" class="lc-btn lc-btn-p" data-acao="fnCentrosEmp">Criar um por empreendimento (${semCentro.length})</button>` : ''}</h3>
      <p class="lc-dica">Separa receitas e despesas por empreendimento, filial ou projeto, para o DRE de cada um. A baixa de parcela da carteira cai sozinha no centro do empreendimento.</p>
      ${F.tabela(
        ['Centro', 'Tipo', 'Empreendimento', ''],
        F.G.centros.map(
          (
            /** @type {any} */ c
          ) => `<tr><td>${esc(c.nome)}${c.ativo ? '' : ` ${F.selo('off', 'Inativo')}`}</td><td>${esc(TIPOS_CENTRO[c.tipo] || c.tipo)}</td>
          <td>${esc(c.empreendimento_id ? emps.get(c.empreendimento_id) || '—' : '—')}</td>
          <td class="lc-acoes"><button class="lc-btn lc-btn-p" data-acao="fnEditarCentro" data-id="${esc(c.id)}">Editar</button></td></tr>`
        ),
        'Nenhum centro de custo.'
      )}</section>`;
}

function formCentro(/** @type {string|null} */ id) {
  const c = F.G.centros.find((/** @type {any} */ x) => x.id === id) || {
    tipo: 'empreendimento',
    ativo: true
  };
  F.abrirModal(
    id ? 'Editar centro de custo' : 'Novo centro de custo',
    `<div class="lc-form">
      <label class="lc-largo">Nome *<input id="fcc-nome" maxlength="80" value="${esc(c.nome || '')}"></label>
      <label>Tipo<select id="fcc-tipo">${F.opcoes(TIPOS_CENTRO, c.tipo)}</select></label>
      <label>Empreendimento<select id="fcc-emp">${F.opcoesLista(F.G.empreendimentos || [], c.empreendimento_id || null, '— nenhum —')}</select></label>
      ${id ? `<label class="lc-check"><input type="checkbox" id="fcc-ativo"${c.ativo ? ' checked' : ''}> Ativo</label>` : ''}
    </div>`,
    async () => {
      if (F.campo('fcc-nome').length < 2) throw new Error('Informe o nome.');
      const ativo = document.getElementById('fcc-ativo');
      await F.gravar(
        'a1_fin_centros',
        {
          ...(id ? {} : { tenant_id: (A1.user || {}).tenant_id }),
          nome: F.campo('fcc-nome'),
          tipo: F.campo('fcc-tipo'),
          empreendimento_id: F.campo('fcc-emp') || null,
          ativo: ativo ? /** @type {HTMLInputElement} */ (ativo).checked : true
        },
        id
      );
      F.aviso('Centro de custo salvo.');
    }
  );
}

function centrosDosEmpreendimentos() {
  const falta = (F.G.empreendimentos || []).filter(
    (/** @type {any} */ e) => !F.G.centros.some((/** @type {any} */ c) => c.empreendimento_id === e.id)
  );
  if (
    !falta.length ||
    !confirm(`Criar ${falta.length} centro(s) de custo, um para cada empreendimento sem centro?`)
  )
    return;
  F.executar(async () => {
    const r = await fetch(A1.rest('a1_fin_centros'), {
      method: 'POST',
      headers: A1.headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify(
        falta.map((/** @type {any} */ e) => ({
          tenant_id: (A1.user || {}).tenant_id,
          nome: String(e.name).slice(0, 80),
          tipo: 'empreendimento',
          empreendimento_id: e.id
        }))
      )
    });
    if (!r.ok) throw new Error(await F.motivo(r));
  }, `${falta.length} centro(s) criado(s).`);
}
