import { A1 } from '../../shared/api/config.js';
import { esc, escJs } from '../../shared/utils/texto.js';
import { hojeISO } from '../../shared/utils/datas.js';
import { a1RequireAuth, a1RequireModule, a1StartHeartbeat } from '../../shared/auth/auth.js';
import { a1AtorHistorico, a1MontarShell } from '../../shared/ui/modulo-shell.js';
import '../../shared/ui/avisos.js';
import '../../shared/ui/cobranca-aviso.js';
import { expor, exporVariavel } from '../../shared/utils/expor.js';

// Chamadas pelo HTML (onclick="...") ou pela suíte de testes. Ver src/shared/utils/expor.js.
expor({
  applyDashFilter,
  applyFilter,
  applyListFilter,
  archiveCase,
  changeStage,
  clearDashFilters,
  closeModal,
  cor,
  createCase,
  dashCases,
  filteredCases,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  openCase,
  openNewModal,
  openStageModal,
  renderDashboard,
  renderFunil,
  roteamentoDeAnalistasAtivo,
  saveCase,
  saveStage,
  selectItbi,
  switchModalTab,
  switchTab,
  toast,
  updateStage,
  val
});
exporVariavel('G', () => G);
const G = {
  user: null,
  slug: '',
  stages: [],
  cases: [],
  empresas: [],
  ccas: [],
  analistas: [],
  filters: { search: '', empr: '', banco: '', itbi: '' },
  dashFilters: { empr: '', banco: '', cartorio: '', search: '' },
  activeCase: null,
  itbiStatus: ''
};

// ─── Init ──────────────────────────────────────────────────────────────────────

function applyCustomLogo() {
  const logo = localStorage.getItem('a1_platform_logo');
  if (!logo) return;
  document.querySelectorAll('.hdr-logo svg, .left-logo svg, .auth-logo svg, .sa-logo svg').forEach(svg => {
    const img = document.createElement('img');
    img.src = logo;
    img.style.cssText = 'height:26px;width:auto;object-fit:contain;flex-shrink:0';
    svg.replaceWith(img);
  });
}

// Quadro e Listagem do Registro eram dois arquivos, e a Listagem tinha ficado
// para trás: criar processo por ela perdia o telefone e os vínculos, e arquivar
// ou salvar dizia "ok" mesmo com o banco recusando. Agora são uma tela só, e o
// endereço decide a vista: /cliente/registro → quadro, /cliente/registro-listagem
// → lista.
const VISTA = /\/registro-listagem(\.html)?\/?$/.test(location.pathname) ? 'lista' : 'kanban';

async function init() {
  applyCustomLogo();
  try {
    G.user = a1RequireAuth();
  } catch {
    return;
  }
  // SEM await, a promessa não era esperada e o catch nunca pegava nada: a tela
  // seguia e pedia a1_cases mesmo para cliente sem a licença do Registro. A
  // regra da casa é que o módulo sem licença não chega nem a existir na tela.
  try {
    await a1RequireModule('registro');
  } catch {
    return;
  }
  G.slug = A1.slug;

  // O cabeçalho é montado por src/shared/ui/modulo-shell.js: marca, busca, abas de módulo
  // e a sub-barra desta tela. Seis telas tinham a sua cópia da mesma barra, com
  // o mesmo CSS repetido; a correção numa delas nunca chegava nas outras.
  await a1MontarShell(document.getElementById('sb-casco'), {
    ativo: 'registro',
    vista: VISTA === 'lista' ? 'listagem' : 'andamento',
    sub: [
      { rot: 'Andamento', href: `/${G.slug}/registro`, ativo: VISTA === 'kanban' },
      { rot: 'Listagem', href: `/${G.slug}/registro-listagem`, ativo: VISTA === 'lista' }
    ]
  });
  document.title = VISTA === 'lista' ? 'Registro — Listagem — SIIMOB' : 'Registro — SIIMOB';
  // Os links do editor de esteira ficam DENTRO desta tela, não na barra.
  [
    ['link-wf', 'repasse'],
    ['link-wf-groups', 'repasse'],
    ['link-wf-rg', 'registro']
  ].forEach(([id, mod]) => {
    const el = document.getElementById(id);
    if (el) el.href = `/${G.slug}/workflow?module=${mod}`;
  });

  // A vista certa aparece já aqui, antes da carga. O painel nascia visível e
  // ficava na frente durante toda a carga: o mesmo "flash" do Repasse.
  document.getElementById(VISTA === 'lista' ? 'tab-lista' : 'tab-kanban').style.display = '';

  await loadData();
  // Os filtros pertencem à carga, não à aba: quem entra direto no quadro ou na
  // listagem tem de encontrá-los prontos.
  popularFiltros();
  if (!avisarLeitura()) {
    renderKanban();
    renderList();
  }
  const tabDash = document.getElementById('tab-dashboard');
  if (tabDash) tabDash.style.display = 'none';
  document.getElementById('tab-kanban').style.display = VISTA === 'kanban' ? '' : 'none';
  document.getElementById('tab-lista').style.display = VISTA === 'lista' ? '' : 'none';
  a1StartHeartbeat(VISTA === 'lista' ? 'registro-listagem' : 'registro');

  // Volta para a aba do navegador: busca de novo (alguém pode ter mexido em outra
  // aba, no workflow, no celular), mas a tela fica como a pessoa deixou. Antes,
  // cada volta redesenhava tudo: a etapa escolhida voltava para "Todas" e o quadro
  // e a lista voltavam para o começo (THE CRED, 27/10). Agora só se redesenha o que
  // mudou de fato, e com a rolagem devolvida ao lugar.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const antes = A1.impressaoTela(G.cases, G.stages);
    loadData().then(() => {
      if (A1.impressaoTela(G.cases, G.stages) === antes) return;
      const rol = A1.fotoRolagem();
      renderKanban();
      renderList();
      A1.voltarRolagem(rol);
    });
  });
}

// ══════════ VÍNCULOS: empresa correspondente, usuário correspondente, analista ══
// As três colunas são as mesmas dos outros módulos — empresa_id, correspondente_id
// e analista_id — para que um processo possa ser seguido de ponta a ponta pelo
// mesmo vínculo. Aqui eram texto solto (`manager_name`) ou nem existiam.
function selVinculo(id, lista, selecionado, desabilitado) {
  return (
    `<select id="${id}"${desabilitado ? ' disabled' : ''}>
    <option value="">— não definido —</option>` +
    (Array.isArray(lista) ? lista : [])
      .map(
        x => `<option value="${esc(x.id)}"${x.id === selecionado ? ' selected' : ''}>${esc(x.name)}</option>`
      )
      .join('') +
    '</select>'
  );
}
function idOuNulo(id) {
  const el = document.getElementById(id);
  return (el && el.value) || null;
}

// O Roteamento de Analistas ainda não existe. Quando existir, é AQUI que ele
// passa a responder — e o campo de analista fica bloqueado, porque quem
// escolhe passa a ser a regra, não a pessoa.
// O mesmo interruptor da Pré-análise: o Roteamento de Analistas, quando vier,
// liga G.roteamentoAnalistas. Até lá ninguém liga, e o resultado é o de sempre
// (falso). Antes esta função devolvia false fixo, e o teste só conseguia ligá-la
// trocando a função pelo window, o que um módulo ES não enxerga.
function roteamentoDeAnalistasAtivo() {
  return G.roteamentoAnalistas === true;
}

function camposDeVinculo(c, prefixo) {
  const roteia = roteamentoDeAnalistasAtivo();
  c = c || {};
  return `<div class="form-group"><label>Empresa correspondente</label>
      ${selVinculo(prefixo + 'empresa', G.empresas, c.empresa_id, false)}</div>
    <div class="form-group"><label>Usuário correspondente</label>
      ${selVinculo(prefixo + 'correspondente', G.ccas, c.correspondente_id, false)}</div>
    <div class="form-group"><label>Analista</label>
      ${selVinculo(prefixo + 'analista', G.analistas, c.analista_id, roteia)}
      ${roteia ? '<div style="font-size:.7rem;color:var(--t3);margin-top:.25rem">definido pelo Roteamento de Analistas</div>' : ''}</div>`;
}

// ─── Data ──────────────────────────────────────────────────────────────────────
async function loadData() {
  const h = { headers: A1.headers() };
  const [stages, cases, emps, ccas, anas] = await Promise.all([
    fetch(`${A1.rest('a1_stages')}?module_key=eq.registro&order=position.asc`, h)
      .then(r => r.json())
      .catch(() => []),
    // A resposta é guardada INTEIRA, e não só o corpo: quando a coluna archived
    // não existe o PostgREST devolve 400, e `.catch(()=>[])` transformava isso
    // em "nenhum processo" — a tela mentia com toda a confiança. Ver avisarLeitura().
    // `select=` explicito e A1.buscarTudo nao sao zelo: sem o select, o
    // PostgREST manda TODAS as colunas, e a1_cases guarda PDF em base64
    // (attachment_pdf, attachment_doc2, legacy_docs) — um processo com dois
    // anexos vira megabytes de JSON que a tela nem usa. E sem buscarTudo o
    // corte em 1.000 acontece EM SILENCIO: a tela mostra mil e diz que sao
    // todos, que e o pior jeito de errar um numero.
    A1.buscarTudo(
      `${A1.rest('a1_cases')}?module_key=eq.registro&archived=eq.false&order=created_at.desc&select=id,tenant_id,module_key,stage_id,stage_name,stage_entered_at,client_name,client_cpf,client_email,client_phone,development,block,unit,region,contract_value,partner_name,broker_name,real_estate_name,manager_name,payload,observations,archived,created_at,updated_at`
    ).catch(() => ({ linhas: [], total: 0, completo: false, erro: 'rede' })),
    // Os três cadastros de vínculo, na mesma carga da tela: um seletor por vez
    // faria o despachante esperar em cada processo que abre.
    fetch(`${A1.rest('a1_corr_empresas')}?select=id,name&order=name.asc`, h)
      .then(r => r.json())
      .catch(() => []),
    fetch(`${A1.rest('a1_partners')}?type=eq.cca&select=id,name&order=name.asc`, h)
      .then(r => r.json())
      .catch(() => []),
    fetch(`${A1.rest('a1_partners')}?type=eq.analista&select=id,name&order=name.asc`, h)
      .then(r => r.json())
      .catch(() => [])
  ]);
  G.stages = Array.isArray(stages) ? stages : [];
  // buscarTudo devolve {linhas, total, completo, erro}. O `erro` continua sendo
  // a diferenca entre "nao ha processo" e "a consulta foi recusada" — que e a
  // razao de avisarLeitura() existir. `completo:false` sem erro significa que o
  // volume passou do teto: a tela mostra o que veio e DIZ que nao e tudo.
  G.cases = Array.isArray(cases && cases.linhas) ? cases.linhas : [];
  G.erroLeitura = (cases && cases.erro) || '';
  G.totalNoBanco = (cases && cases.total) || G.cases.length;
  G.leituraCompleta = !cases || cases.completo !== false;
  G.empresas = Array.isArray(emps) ? emps : [];
  G.ccas = Array.isArray(ccas) ? ccas : [];
  G.analistas = Array.isArray(anas) ? anas : [];

  // Populate datalists
  const emprs = [...new Set(G.cases.map(c => c.development).filter(Boolean))];
  const bancos = [...new Set(G.cases.map(c => c.payload?.banco_name).filter(Boolean))];
  const cartorios = [...new Set(G.cases.map(c => c.payload?.cartorio_name).filter(Boolean))];
  populateDL('dl-emprs', emprs);
  populateDL('dl-bancos', bancos);
  populateDL('dl-cartorios', cartorios);
}

// Quadro vazio por falta de processo e quadro vazio por consulta recusada são
// a mesma tela e problemas opostos. Dizer qual é dos dois — e qual arquivo
// resolve — é a diferença entre cinco minutos e uma tarde.
function avisarLeitura() {
  const alvo = document.getElementById('rg-kanban');
  if (!alvo || !G.erroLeitura) return false;
  const semColuna = /archived/.test(G.erroLeitura);
  alvo.innerHTML = `<div style="max-width:560px;margin:2rem auto;background:#FFFBEB;
      border:1px solid #FDE68A;border-radius:10px;padding:1.25rem;color:#92400E">
    <div style="font-weight:800;margin-bottom:.4rem">Os processos não puderam ser lidos</div>
    <div style="font-size:.82rem;line-height:1.55">${
      semColuna
        ? 'O banco deste cliente ainda não tem a coluna <b>archived</b> em a1_cases. ' +
          'Rode <b>sql/2026-09-11_registro_arquivar.sql</b> no Supabase — até lá o Registro não abre.'
        : 'O servidor recusou a consulta. Recarregue; se continuar, avise o suporte.'
    }</div>
    <div style="font-size:.7rem;margin-top:.6rem;opacity:.75">${esc(String(G.erroLeitura).slice(0, 200))}</div>
  </div>`;
  return true;
}

function populateDL(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = items.map(v => `<option value="${esc(v)}">`).join('');
}

// ─── Filtering ──────────────────────────────────────────────────────────────────
function filteredCases() {
  const { search, empr, banco, itbi } = G.filters;
  return G.cases.filter(c => {
    if (empr && c.development !== empr) return false;
    if (banco && (c.payload?.banco_name || '') !== banco) return false;
    if (itbi && (c.payload?.itbi_status || '') !== itbi) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (c.client_name || '').toLowerCase().includes(q) ||
        (c.client_cpf || '').includes(q) ||
        (c.unit || '').toLowerCase().includes(q) ||
        (c.development || '').toLowerCase().includes(q)
      );
    }
    return true;
  });
}

function dashCases() {
  const { empr, banco, cartorio, search } = G.dashFilters;
  return G.cases.filter(c => {
    if (empr && c.development !== empr) return false;
    if (banco && (c.payload?.banco_name || '') !== banco) return false;
    if (cartorio && (c.payload?.cartorio_name || '') !== cartorio) return false;
    if (search) {
      const q = search.toLowerCase();
      return (c.client_name || '').toLowerCase().includes(q) || (c.client_cpf || '').includes(q);
    }
    return true;
  });
}

function applyFilter() {
  G.filters.search = document.getElementById('rg-search').value.toLowerCase();
  G.filters.empr = document.getElementById('rg-filter-empr').value;
  G.filters.banco = document.getElementById('rg-filter-banco').value;
  G.filters.itbi = document.getElementById('rg-filter-itbi').value;
  renderKanban();
}

function applyDashFilter() {
  G.dashFilters.empr = document.getElementById('dg-empr').value;
  G.dashFilters.banco = document.getElementById('dg-banco').value;
  G.dashFilters.cartorio = document.getElementById('dg-cartorio').value;
  G.dashFilters.search = document.getElementById('dg-search').value;
  renderDashboard();
}

function clearDashFilters() {
  G.dashFilters = { empr: '', banco: '', cartorio: '', search: '' };
  ['dg-empr', 'dg-banco', 'dg-cartorio', 'dg-search'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderDashboard();
}

function applyListFilter() {
  renderList();
}

// Os filtros nasciam DENTRO de renderDashboard, que só roda quando alguém abre
// a aba Dashboard. Quem entrava direto no quadro ou na listagem — que é o
// caminho normal — encontrava "Todos os empreendimentos" e mais nada, e a
// regra da casa (todo cadastro reflete no filtro) parecia quebrada por falta
// de cadastro. Não era: era a ordem das telas.
function popularFiltros() {
  const todos = G.cases || [];
  const allEmprs = [...new Set(todos.map(c => c.development).filter(Boolean))];
  const allBancos = [...new Set(todos.map(c => c.payload?.banco_name).filter(Boolean))];
  const allCartorios = [...new Set(todos.map(c => c.payload?.cartorio_name).filter(Boolean))];
  populateSelect('dg-empr', allEmprs, 'Todos empreendimentos', G.dashFilters.empr);
  populateSelect('dg-banco', allBancos, 'Todos os bancos', G.dashFilters.banco);
  populateSelect('dg-cartorio', allCartorios, 'Todos os cartórios', G.dashFilters.cartorio);
  populateSelect('rg-filter-empr', allEmprs, 'Todos os empreendimentos', G.filters.empr);
  populateSelect('rg-filter-banco', allBancos, 'Todos os bancos', G.filters.banco);
  populateSelect(
    'rg-list-stage',
    G.stages.map(s => s.name),
    'Todas as etapas',
    ''
  );
  // Aqui havia um laço que desmarcava a etapa logo depois de montar as opções.
  // Como esta função roda em toda carga e depois de todo salvar, a etapa que a
  // pessoa escolheu na lista voltava para "Todas" a cada vez (THE CRED, 27/10).
  // populateSelect agora mantém o que estava escolhido, e o laço saiu.
}

// ─── Dashboard ──────────────────────────────────────────────────────────────────
function renderDashboard() {
  const cases = dashCases();
  const now = new Date();
  const thisMonth = hojeISO(now).slice(0, 7);

  popularFiltros();

  const finalStageIds = new Set(G.stages.filter(s => s.is_final).map(s => s.id));
  const andamento = cases.filter(c => !finalStageIds.has(c.stage_id));
  const finalizados = cases.filter(
    c => finalStageIds.has(c.stage_id) && (c.updated_at || '').startsWith(thisMonth)
  );
  const itbiPend = cases.filter(c => (c.payload?.itbi_status || '') === 'pendente');
  const comExig = cases.filter(c => !!c.payload?.exig_desc);

  setEl('dkpi-total', cases.length);
  setEl('dkpi-andamento', andamento.length);
  setEl('dkpi-finalizados', finalizados.length);
  setEl('dkpi-itbi-pend', itbiPend.length);
  setEl('dkpi-exig', comExig.length);

  // VGV
  const vgv = cases.reduce((s, c) => s + (Number(c.contract_value) || 0), 0);
  setEl('dkpi-vgv', vgv ? 'R$ ' + fmtMoney(vgv) : '—');

  // Avg days
  const days = cases.map(c => (now - new Date(c.created_at)) / 86400000).filter(d => d >= 0);
  setEl('dkpi-tempo', days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) + 'd' : '—');

  // ITBI pago count
  setEl('dkpi-itbi-pago', cases.filter(c => (c.payload?.itbi_status || '') === 'pago').length);

  // New (30 days)
  const since30 = new Date(now - 30 * 86400000).toISOString();
  setEl('dkpi-novos', cases.filter(c => c.created_at >= since30).length);

  // Stage counts for donut + funil
  const stageMap = {};
  G.stages.forEach(s => {
    stageMap[s.id] = { stage: s, count: 0 };
  });
  cases.forEach(c => {
    if (stageMap[c.stage_id]) stageMap[c.stage_id].count++;
  });
  const stageData = Object.values(stageMap).filter(x => x.count > 0);

  renderDonutChart(
    stageData,
    document.getElementById('dg-donut-svg'),
    document.getElementById('dg-donut-legend'),
    cases.length
  );
  renderFunil(stageData, cases.length);
  renderDistList(
    'dg-empr-list',
    groupBy(cases, c => c.development),
    '#3F6F9E'
  );
  renderDistList(
    'dg-banco-list',
    groupBy(cases, c => c.payload?.banco_name),
    '#0E8C7F'
  );
  renderDistList(
    'dg-cartorio-list',
    groupBy(cases, c => c.payload?.cartorio_name),
    '#3FB8A6'
  );

  // Gargalo = non-final stage with most cases
  const nonFinal = stageData.filter(x => !x.stage.is_final);
  const gargalo = nonFinal.sort((a, b) => b.count - a.count)[0];
  setEl('dkpi-gargalo', gargalo ? gargalo.count : '—');
  setEl('dkpi-gargalo-sub', gargalo ? gargalo.stage.name : '—');
}

const STAGE_COLORS = [
  '#0E8C7F',
  '#3F6F9E',
  '#3FB8A6',
  '#0B7568',
  '#C87E12',
  '#B8433A',
  '#6366f1',
  '#0891b2',
  '#84cc16',
  '#f97316',
  '#8b5cf6',
  '#ec4899'
];

function renderDonutChart(stageData, svgEl, legendEl, total) {
  const R = 46,
    cx = 56,
    cy = 56,
    sw = 14;
  const circ = 2 * Math.PI * R;
  svgEl.innerHTML =
    stageData.length === 0
      ? `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#E2E8E5" stroke-width="${sw}"/>`
      : '';

  let cumLen = 0;
  stageData.forEach((item, i) => {
    const arcLen = (item.count / (total || 1)) * circ;
    const color = item.stage.color || STAGE_COLORS[i % STAGE_COLORS.length];
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', R);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', sw);
    circle.setAttribute('stroke-dasharray', `${arcLen} ${circ - arcLen}`);
    circle.setAttribute('stroke-dashoffset', circ - cumLen);
    circle.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    circle.setAttribute('stroke-linecap', 'butt');
    svgEl.appendChild(circle);
    cumLen += arcLen;
  });

  // Center text
  const wrap = svgEl.parentElement.querySelector('.donut-center');
  if (wrap) {
    wrap.querySelector('.donut-total').textContent = total;
  } else {
    const div = document.createElement('div');
    div.className = 'donut-center';
    div.innerHTML = `<div class="donut-total">${total}</div><div class="donut-total-lbl">processos</div>`;
    svgEl.parentElement.style.position = 'relative';
    svgEl.parentElement.appendChild(div);
  }

  legendEl.innerHTML = stageData
    .map((item, i) => {
      const color = item.stage.color || STAGE_COLORS[i % STAGE_COLORS.length];
      const pct = total ? Math.round((item.count / total) * 100) : 0;
      return `<div class="donut-leg-row">
      <div class="donut-leg-dot" style="background:${cor(color)}"></div>
      <div class="donut-leg-name">${esc(item.stage.name)}</div>
      <div class="donut-leg-count">${item.count}</div>
      <div class="donut-leg-pct">${pct}%</div>
    </div>`;
    })
    .join('');
}

function renderFunil(stageData, total) {
  const maxCount = Math.max(...stageData.map(x => x.count), 1);
  const nonFinalData = stageData.filter(x => !x.stage.is_final);
  const gargaloIdx = nonFinalData.length
    ? nonFinalData.indexOf(nonFinalData.reduce((a, b) => (b.count > a.count ? b : a)))
    : -1;

  document.getElementById('dg-funil-list').innerHTML =
    stageData
      .map((item, i) => {
        const color = item.stage.color || STAGE_COLORS[i % STAGE_COLORS.length];
        const pct = maxCount ? Math.round((item.count / maxCount) * 100) : 0;
        const pctTot = total ? Math.round((item.count / total) * 100) : 0;
        const isGarg = !item.stage.is_final && item === nonFinalData[gargaloIdx];
        return `<div class="funil-row2">
      <div class="funil2-name" style="color:${color}">${esc(item.stage.name)}</div>
      <div class="funil2-bar-wrap"><div class="funil2-bar" style="width:${pct}%;background:${cor(color)}"></div></div>
      <div class="funil2-count">${item.count}</div>
      <div class="funil2-pct">${pctTot}%</div>
      <div class="funil2-badges">${isGarg ? '<span class="badge-gargalo">GARGALO</span>' : ''}</div>
    </div>`;
      })
      .join('') || '<div style="color:var(--t3);font-size:.78rem">Nenhum processo.</div>';
}

function groupBy(cases, fn) {
  const map = {};
  cases.forEach(c => {
    const key = fn(c) || '(sem informação)';
    map[key] = (map[key] || 0) + 1;
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
}

function renderDistList(elId, items, color) {
  const el = document.getElementById(elId);
  if (!el) return;
  const max = items.length ? items[0][1] : 1;
  el.innerHTML =
    items
      .map(
        ([name, count], i) => `
    <div class="dist-row">
      <div class="dist-num">${i + 1}</div>
      <div class="dist-name">${esc(name)}</div>
      <div class="dist-bar-wrap"><div class="dist-bar" style="width:${Math.round((count / max) * 100)}%;background:${cor(color)}"></div></div>
      <div class="dist-val">${count}</div>
    </div>`
      )
      .join('') || '<div style="color:var(--t3);font-size:.75rem">Sem dados.</div>';
}

// ─── Kanban ──────────────────────────────────────────────────────────────────────
function renderKanban() {
  const board = document.getElementById('rg-kanban');
  const cases = filteredCases();
  const now = new Date();
  let total = 0;

  if (!G.stages || G.stages.length === 0) {
    board.innerHTML = `
      <div style="width:100%;padding:4rem 1rem;text-align:center;color:var(--t3)">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" style="margin:0 auto .875rem;display:block;opacity:.45">
          <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
        </svg>
        <div style="font-weight:700;font-size:.92rem;margin-bottom:.4rem;color:var(--t2)">Workflow ainda não configurado</div>
        <div style="font-size:.8rem;line-height:1.55">Acesse <strong style="color:var(--violet);cursor:pointer" onclick="switchTab('config',null)">Configuracoes → Workflow</strong> para criar as etapas do processo de registro.</div>
      </div>`;
    return;
  }

  board.innerHTML = G.stages
    .map(stage => {
      const stageCases = cases.filter(c => c.stage_id === stage.id);
      total += stageCases.length;
      const color = stage.color || '#0E8C7F';
      return `<div class="k-col">
      <div class="k-col-header" style="background:${cor(color)}">
        <span>${esc(stage.name)}</span>
        <span class="k-col-count">${stageCases.length}</span>
      </div>
      <div class="k-col-body" id="col-${stage.id}" ondragover="onDragOver(event,this)" ondrop="onDrop(event,'${escJs(stage.id)}')">
        ${
          stageCases.map(c => renderCard(c, color, now)).join('') ||
          '<div style="color:var(--t3);font-size:.75rem;text-align:center;padding:.75rem">Vazio</div>'
        }
      </div>
    </div>`;
    })
    .join('');

  const fc = cases.length;
  document.getElementById('rg-filter-count').textContent =
    fc !== G.cases.length ? `${fc} de ${G.cases.length} processos` : '';
}

function renderCard(c, color, now) {
  const days = Math.floor((now - new Date(c.created_at)) / 86400000);
  const dCls = days > 30 ? 'alert' : days > 15 ? 'warn' : '';
  const p = c.payload || {};
  const itbi = p.itbi_status || '';
  const exig = p.exig_desc;

  return `<div class="k-card" style="border-left-color:${cor(color)}"
    draggable="true"
    ondragstart="onDragStart(event,'${escJs(c.id)}')"
    ondragend="onDragEnd(event)"
    onclick="openCase('${escJs(c.id)}')">
    <div class="kc-top">
      <div class="kc-name">${esc(c.client_name)}</div>
      <div class="kc-badges">
        ${c.is_new ? '<span class="badge-novo">NOVO</span>' : ''}
        ${exig ? '<span class="badge-exig">EXIG</span>' : ''}
        <span class="badge-days ${dCls}">${days}d</span>
      </div>
    </div>
    ${c.client_cpf ? `<div class="kc-cpf" onclick="event.stopPropagation();navigator.clipboard?.writeText('${escJs(c.client_cpf)}')">${esc(c.client_cpf)}</div>` : ''}
    ${c.development ? `<div class="kc-sub"><span class="empr">${esc(c.development)}</span>${c.unit ? ' · ' + esc(c.unit) : ''}</div>` : ''}
    <div class="kc-chips">
      ${itbi === 'pago' ? '<span class="chip chip-itbi-pago">ITBI Pago</span>' : ''}
      ${itbi === 'pendente' ? '<span class="chip chip-itbi-pend">ITBI Pendente</span>' : ''}
      ${itbi === 'vencido' ? '<span class="chip" style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5">ITBI Vencido</span>' : ''}
      ${p.cartorio_name ? `<span class="chip chip-cartorio">${esc(p.cartorio_name)}</span>` : ''}
      ${p.banco_name ? `<span class="chip chip-banco">${esc(p.banco_name)}</span>` : ''}
    </div>
    <div class="kc-footer">
      <span class="kc-date">${fmtDate(c.created_at)}</span>
      <div class="kc-actions">
        <button class="kc-action-btn" onclick="event.stopPropagation();openCase('${c.id}')">Abrir</button>
      </div>
    </div>
  </div>`;
}

// ─── Drag & Drop ───────────────────────────────────────────────────────────────
let dragId = null;
function onDragStart(e, id) {
  dragId = id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
}
function onDragOver(e, col) {
  e.preventDefault();
  col.classList.add('drag-over');
}
function onDrop(e, stageId) {
  e.currentTarget.classList.remove('drag-over');
  if (!dragId) return;
  const c = G.cases.find(x => x.id === dragId);
  if (!c || c.stage_id === stageId) {
    dragId = null;
    return;
  }
  const stage = G.stages.find(s => s.id === stageId);
  updateStage(c, stageId, stage?.name);
  dragId = null;
}

async function updateStage(c, stageId, stageName) {
  const prev = c.stage_name;
  c.stage_id = stageId;
  c.stage_name = stageName;
  c.stage_entered_at = new Date().toISOString();
  renderKanban();

  await fetch(`${A1.rest('a1_cases')}?id=eq.${c.id}`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify({ stage_id: stageId, stage_name: stageName, stage_entered_at: c.stage_entered_at })
  });
  await fetch(A1.rest('a1_events'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({
      tenant_id: G.user?.tenant_id,
      case_id: c.id,
      type: 'stage_change',
      description: `${prev} → ${stageName}`,
      actor_name: G.user?.name
    })
  });
  toast('Etapa atualizada.', 'success');
}

// ─── List View ─────────────────────────────────────────────────────────────────
function renderList() {
  const search = (document.getElementById('rg-list-search')?.value || '').toLowerCase();
  const stageFilter = document.getElementById('rg-list-stage')?.value || '';
  const itbiFilter = document.getElementById('rg-list-itbi')?.value || '';

  const cases = G.cases.filter(c => {
    if (stageFilter && c.stage_name !== stageFilter) return false;
    if (itbiFilter && (c.payload?.itbi_status || '') !== itbiFilter) return false;
    if (search) {
      return (
        (c.client_name || '').toLowerCase().includes(search) ||
        (c.client_cpf || '').includes(search) ||
        (c.development || '').toLowerCase().includes(search)
      );
    }
    return true;
  });

  document.getElementById('rg-list-count').textContent =
    cases.length !== G.cases.length ? `${cases.length} de ${G.cases.length}` : '';

  const now = new Date();
  document.getElementById('rg-list-tbody').innerHTML = cases.length
    ? cases
        .map(c => {
          const p = c.payload || {};
          const days = Math.floor((now - new Date(c.created_at)) / 86400000);
          const itbi = p.itbi_status || '—';
          const itbiCls =
            itbi === 'pago' ? 'itbi-pill-pago' : itbi === 'vencido' ? 'itbi-pill-venc' : 'itbi-pill-pend';
          const st = G.stages.find(s => s.id === c.stage_id);
          const stClr = st?.color || '#6B827D';
          return `<tr onclick="openCase('${escJs(c.id)}')" style="cursor:pointer">
          <td><span class="tbl-name">${esc(c.client_name)}</span></td>
          <td><span class="tbl-cpf">${esc(c.client_cpf || '—')}</span></td>
          <td>${esc(c.development || '—')}${c.unit ? ' · ' + esc(c.unit) : ''}</td>
          <td><span style="display:inline-flex;align-items:center;gap:.3rem">
            <span style="width:7px;height:7px;border-radius:50%;background:${cor(stClr)};display:inline-block"></span>
            ${esc(c.stage_name || '—')}</span></td>
          <td>${esc(p.banco_name || '—')}</td>
          <td>${esc(p.cartorio_name || '—')}</td>
          <td><span class="stage-pill ${itbiCls}">${itbi}</span></td>
          <td class="tbl-mono">${p.itbi_valor ? 'R$' + fmtMoney(p.itbi_valor) : '—'}</td>
          <td class="tbl-mono">${esc(p.num_prenotacao || '—')}</td>
          <td class="tbl-mono">${esc(p.num_matricula || '—')}</td>
          <td class="tbl-mono">${days}d</td>
          <td><button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();openCase('${c.id}')">Abrir</button></td>
        </tr>`;
        })
        .join('')
    : '<tr><td colspan="12" style="padding:2rem;text-align:center;color:var(--t3)">Nenhum processo encontrado.</td></tr>';
}

// ─── Case Modal ───────────────────────────────────────────────────────────────
function openCase(id) {
  G.activeCase = G.cases.find(c => c.id === id);
  if (!G.activeCase) return;
  const c = G.activeCase;
  const p = c.payload || {};

  document.getElementById('md-title').textContent = c.client_name;
  document.getElementById('md-sub').textContent = [c.development, c.unit].filter(Boolean).join(' / ') || '—';

  // Stage select
  const sel = document.getElementById('md-stage-sel');
  sel.innerHTML = G.stages
    .map(s => `<option value="${s.id}" ${s.id === c.stage_id ? 'selected' : ''}>${esc(s.name)}</option>`)
    .join('');

  // Dados tab
  setField('md-name', c.client_name || '');
  setField('md-cpf', c.client_cpf || '');
  setField('md-empr', c.development || '');
  setField('md-unit', c.unit || '');
  setField('md-block', c.block || '');
  setField('md-valor', c.contract_value || '');
  setField('md-banco', p.banco_name || '');
  setField('md-manager', c.manager_name || '');
  // Os seletores são REMONTADOS com o processo aberto, e não só preenchidos:
  // é o que faz o dossiê abrir já marcando o vínculo que está gravado.
  const vinc = document.getElementById('md-vinculos');
  if (vinc) vinc.innerHTML = camposDeVinculo(c, 'md-');
  setField('md-obs', c.observations || '');

  // ITBI tab
  setField('md-itbi-valor', p.itbi_valor || '');
  setField('md-itbi-venc', p.itbi_venc || '');
  setField('md-itbi-pago-em', p.itbi_pago_em || '');
  setField('md-itbi-url', p.itbi_url || '');
  G.itbiStatus = p.itbi_status || '';
  document.querySelectorAll('.itbi-radio-btn').forEach(btn => {
    btn.className = 'itbi-radio-btn' + (btn.dataset.val === G.itbiStatus ? ` active-${G.itbiStatus}` : '');
  });

  // Cartório tab
  setField('md-cartorio', p.cartorio_name || '');
  setField('md-protocolo-dt', p.data_protocolo || '');
  setField('md-prenotacao', p.num_prenotacao || '');
  setField('md-exig-dt', p.exig_dt || '');
  setField('md-exig-desc', p.exig_desc || '');
  setField('md-matricula', p.num_matricula || '');
  setField('md-registro-dt', p.data_registro || '');
  setField('md-entrega-banco-dt', p.data_entrega_banco || '');

  // Mark as seen
  if (c.is_new) {
    fetch(`${A1.rest('a1_cases')}?id=eq.${c.id}`, {
      method: 'PATCH',
      headers: A1.headers(),
      body: JSON.stringify({ is_new: false })
    });
    c.is_new = false;
  }

  loadEvents(id);
  switchModalTab('dados', document.querySelector('.modal-tab'));
  openModal('modal-det-bg');
}

async function saveCase() {
  const c = G.activeCase;
  if (!c) return;

  const payload = {
    ...(c.payload || {}),
    banco_name: val('md-banco'),
    itbi_valor: val('md-itbi-valor') || null,
    itbi_venc: val('md-itbi-venc') || null,
    itbi_status: G.itbiStatus || null,
    itbi_pago_em: val('md-itbi-pago-em') || null,
    itbi_url: val('md-itbi-url') || null,
    cartorio_name: val('md-cartorio'),
    data_protocolo: val('md-protocolo-dt') || null,
    num_prenotacao: val('md-prenotacao') || null,
    exig_dt: val('md-exig-dt') || null,
    exig_desc: val('md-exig-desc') || null,
    num_matricula: val('md-matricula') || null,
    data_registro: val('md-registro-dt') || null,
    data_entrega_banco: val('md-entrega-banco-dt') || null
  };

  const body = {
    client_name: val('md-name'),
    client_cpf: val('md-cpf'),
    development: val('md-empr'),
    unit: val('md-unit'),
    block: val('md-block'),
    contract_value: val('md-valor') || null,
    manager_name: val('md-manager'),
    empresa_id: idOuNulo('md-empresa'),
    correspondente_id: idOuNulo('md-correspondente'),
    analista_id: idOuNulo('md-analista'),
    observations: val('md-obs'),
    payload
  };

  const res = await fetch(`${A1.rest('a1_cases')}?id=eq.${c.id}`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    toast('Não foi possível salvar o processo.', 'error');
    return;
  }
  await fetch(A1.rest('a1_events'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({
      tenant_id: G.user.tenant_id,
      case_id: c.id,
      type: 'edit',
      description: 'Cadastro do Registro atualizado',
      actor_name: G.user.name
    })
  });

  Object.assign(c, body);
  toast('Salvo.', 'success');
  closeModal('modal-det-bg');
  renderKanban();
  renderList();
  renderDashboard();
}

async function changeStage() {
  if (!G.activeCase) return;
  const c = G.activeCase;
  const stageId = document.getElementById('md-stage-sel').value;
  const stage = G.stages.find(s => s.id === stageId);
  await updateStage(c, stageId, stage?.name);
  document.getElementById('md-sub').textContent = [c.development, c.unit].filter(Boolean).join(' / ') || '—';
}

async function archiveCase() {
  if (!G.activeCase) return;
  if (!confirm('Arquivar este processo? Ele sai do quadro e da listagem, e pode ser trazido de volta.'))
    return;
  const res = await fetch(`${A1.rest('a1_cases')}?id=eq.${G.activeCase.id}`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify({ archived: true })
  }).catch(() => null);
  // A resposta não era conferida: o cartão sumia da tela e o gestor ouvia
  // "Arquivado." mesmo quando o banco recusava. Na volta seguinte ele estava
  // lá de novo, e ninguém liga uma coisa à outra.
  if (!res || !res.ok) {
    toast(await motivoDoArquivar(res), 'error');
    return;
  }
  await fetch(A1.rest('a1_events'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({
      tenant_id: G.user.tenant_id,
      case_id: G.activeCase.id,
      type: 'edit',
      description: 'Processo de Registro arquivado',
      actor_name: G.user.name
    })
  });
  G.cases = G.cases.filter(c => c.id !== G.activeCase.id);
  closeModal('modal-det-bg');
  renderKanban();
  renderList();
  renderDashboard();
  toast('Arquivado.', 'success');
}

// A coluna `archived` é criada por SQL que o dono roda à mão. Entre publicar a
// tela e rodar o arquivo existe uma janela, e nela o erro é ESTE — dizer qual
// arquivo resolve poupa a investigação inteira.
async function motivoDoArquivar(res) {
  if (!res) return 'Sem resposta do servidor. Verifique a conexão e tente de novo.';
  let m = '';
  try {
    const j = await res.json();
    m = (j && (j.message || j.hint || j.details)) || '';
  } catch {}
  if (/archived/.test(m) && /column|coluna/i.test(m))
    return (
      'O banco deste cliente ainda não tem a coluna `archived`. ' +
      'Rode sql/2026-09-11_registro_arquivar.sql no Supabase — até lá, arquivar não funciona.'
    );
  if (res.status === 401 || res.status === 403 || /row-level security|permission denied/i.test(m))
    return 'O banco recusou o arquivamento para o seu acesso. Fale com o gestor.';
  return m || 'Não foi possível arquivar. O processo continua no quadro.';
}

async function loadEvents(caseId) {
  const events = await fetch(`${A1.rest('a1_events')}?case_id=eq.${caseId}&order=created_at.desc&limit=30`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .catch(() => []);

  document.getElementById('md-events').innerHTML = events.length
    ? events
        .map(
          e => `<div class="evt-item">
        <div class="evt-date">${new Date(e.created_at).toLocaleString('pt-BR')}</div>
        <div>${esc(e.description || e.type)}</div>
        ${a1AtorHistorico(e) ? `<div class="evt-date">${esc(a1AtorHistorico(e))}</div>` : ''}
      </div>`
        )
        .join('')
    : '<div style="color:var(--t3);font-size:.78rem">Sem histórico.</div>';
}

function selectItbi(btn) {
  G.itbiStatus = btn.dataset.val;
  document.querySelectorAll('.itbi-radio-btn').forEach(b => {
    b.className = 'itbi-radio-btn' + (b === btn ? ` active-${G.itbiStatus}` : '');
  });
}

// ─── New Case Modal ────────────────────────────────────────────────────────────
function openNewModal() {
  ['n-name', 'n-cpf', 'n-phone', 'n-empr', 'n-block', 'n-unit', 'n-valor', 'n-banco', 'n-obs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  // Montados a cada abertura, e não uma vez no carregamento: assim um cadastro
  // novo de analista aparece sem o despachante ter de recarregar a página.
  const vinc = document.getElementById('n-vinculos');
  if (vinc) vinc.innerHTML = camposDeVinculo(null, 'n-');
  const sel = document.getElementById('n-stage');
  sel.innerHTML = G.stages
    .map(s => `<option value="${s.id}" ${s.is_initial ? 'selected' : ''}>${esc(s.name)}</option>`)
    .join('');
  openModal('modal-new-bg');
}

async function createCase() {
  const name = val('n-name').trim();
  if (!name) {
    toast('Informe o nome do cliente.', 'error');
    return;
  }
  const stageId = val('n-stage');
  const stage = G.stages.find(s => s.id === stageId) || G.stages[0];

  const payload = {
    banco_name: val('n-banco') || null
  };

  const body = {
    tenant_id: G.user?.tenant_id,
    module_key: 'registro',
    client_name: name,
    client_cpf: val('n-cpf') || null,
    development: val('n-empr') || null,
    block: val('n-block') || null,
    unit: val('n-unit') || null,
    contract_value: val('n-valor') || null,
    manager_name: val('n-manager') || null,
    // O formulário sempre teve o campo Telefone e o corpo nunca o levou: o
    // despachante digitava e o dado sumia no envio. client_phone existe na
    // tabela desde sempre.
    client_phone: val('n-phone') || null,
    empresa_id: idOuNulo('n-empresa'),
    correspondente_id: idOuNulo('n-correspondente'),
    analista_id: idOuNulo('n-analista'),
    observations: val('n-obs') || null,
    stage_id: stage?.id,
    stage_name: stage?.name,
    stage_entered_at: new Date().toISOString(),
    is_new: true,
    archived: false,
    payload
  };

  const res = await fetch(A1.rest('a1_cases'), {
    method: 'POST',
    headers: A1.returnHeaders(),
    body: JSON.stringify(body)
  });
  const created = await res.json();
  const card = Array.isArray(created) ? created[0] : created;
  if (!card?.id) {
    toast('Erro ao criar processo.', 'error');
    return;
  }

  G.cases.unshift(card);
  closeModal('modal-new-bg');
  renderKanban();
  renderList();
  renderDashboard();
  toast('Processo criado.', 'success');
  openCase(card.id);
}

// ─── Config / Stages ──────────────────────────────────────────────────────────
function renderConfigStages() {
  document.getElementById('cfg-stages-list').innerHTML =
    G.stages
      .map(
        s => `
    <div style="display:flex;align-items:center;gap:.65rem;background:var(--card);border:1px solid var(--border);border-radius:7px;padding:.55rem .875rem">
      <div style="width:10px;height:10px;border-radius:50%;background:${s.color || '#ccc'};flex-shrink:0"></div>
      <div style="flex:1;font-size:.8rem;font-weight:600">${esc(s.name)}</div>
      <div style="font-size:.68rem;color:var(--t3)">#${s.position}</div>
      ${s.is_initial ? '<span style="background:#E0E7FF;color:#3730A3;font-size:.62rem;font-weight:700;padding:.1rem .4rem;border-radius:3px">INICIAL</span>' : ''}
      ${s.is_final ? '<span style="background:#dbeafe;color:#1e40af;font-size:.62rem;font-weight:700;padding:.1rem .4rem;border-radius:3px">FINAL</span>' : ''}
    </div>`
      )
      .join('') || '<div style="color:var(--t3);font-size:.78rem">Nenhuma etapa configurada.</div>';
}

function openStageModal() {
  openModal('modal-stage-bg');
}

async function saveStage() {
  const name = val('st-name').trim();
  if (!name) {
    toast('Informe o nome da etapa.', 'error');
    return;
  }
  const body = {
    tenant_id: G.user?.tenant_id,
    module_key: 'registro',
    name,
    color: document.getElementById('st-color').value,
    position: parseInt(val('st-pos')) || 1,
    is_initial: document.getElementById('st-init').checked,
    is_final: document.getElementById('st-final').checked
  };
  const res = await fetch(A1.rest('a1_stages'), {
    method: 'POST',
    headers: A1.returnHeaders(),
    body: JSON.stringify(body)
  });
  const [s] = await res.json();
  if (!s?.id) {
    toast('Erro ao salvar etapa.', 'error');
    return;
  }
  G.stages.push(s);
  G.stages.sort((a, b) => a.position - b.position);
  renderConfigStages();
  closeModal('modal-stage-bg');
  toast('Etapa adicionada.', 'success');
}

// Cor de etapa entra em atributo style, e vem do banco: é o gestor quem digita
// no editor de workflow. esc() não serve aqui — dentro de style, `expression`,
// `url(...)` e o fecha-aspas continuam valendo. Só passa o que TEM FORMA de cor;
// qualquer outra coisa vira a cor padrão. Cor esquisita é um detalhe visual;
// cor que executa script é o cartão do vizinho aberto no navegador de quem
// abriu o quadro.
function cor(v, padrao) {
  const t = String(v == null ? '' : v).trim();
  return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/.test(t) ? t : padrao || '#0E8C7F';
}

function populateSelect(id, items, placeholder, selected) {
  const el = document.getElementById(id);
  if (!el) return;
  // Sem valor pedido, fica o que já estava escolhido. A etapa da lista era
  // remontada com '' a cada carga, e a volta para a aba do navegador devolvia a
  // pessoa para "Todas as etapas".
  const manter = selected || el.value;
  el.innerHTML =
    `<option value="">${placeholder}</option>` +
    items.map(v => `<option value="${esc(v)}" ${v === manter ? 'selected' : ''}>${esc(v)}</option>`).join('');
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = ['dashboard', 'kanban', 'lista', 'config'];
function switchTab(tab, clickedDdItem) {
  // Update tab-btn active state
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (tab === 'config') {
    document.querySelectorAll('.tab-btn').forEach(b => {
      if (b.textContent.trim() === 'Configuracoes') b.classList.add('active');
    });
  } else {
    document.getElementById('tab-registro-btn')?.classList.add('active');
  }

  // Update dropdown item active state inside Registro group
  document.querySelectorAll('.dd-item').forEach(d => d.classList.remove('active'));
  if (clickedDdItem?.classList.contains('dd-item')) {
    clickedDdItem.classList.add('active');
  } else if (tab === 'kanban') {
    // Clicking the tab-btn directly → mark first Registro dd-item (Andamento) active
    const regGroup = document.getElementById('tab-registro-btn')?.closest('.tab-group');
    const firstItem = regGroup?.querySelector('.dd-item');
    if (firstItem) firstItem.classList.add('active');
  }

  TABS.forEach(t => {
    const el2 = document.getElementById(`tab-${t}`);
    if (el2) el2.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'kanban') renderKanban();
  if (tab === 'lista') renderList();
  if (tab === 'config') renderConfigStages();
}

function gotoRepasse(target) {
  if (target === 'dashboard') {
    window.location.href = `/${G.slug}/repasse`;
  } else if (target === 'config') {
    window.location.href = `/${G.slug}/configuracoes`;
  } else if (target === 'listagem') {
    window.location.href = `/${G.slug}/listagem`;
  } else {
    window.location.href = `/${G.slug}/andamento`;
  }
}

function switchModalTab(tab, el) {
  document.querySelectorAll('.modal-tab').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  else document.querySelector(`.modal-tab[data-mtab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
  const target = document.getElementById(`mtab-${tab}`);
  if (target) target.classList.add('active');
  if (tab === 'hist' && G.activeCase) loadEvents(G.activeCase.id);
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}
function setField(id, v) {
  const el = document.getElementById(id);
  if (el) el.value = v;
}
function setEl(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}
function fmtMoney(v) {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}
function toast(msg, type = 'info') {
  const el = document.getElementById('rg-toast');
  const item = document.createElement('div');
  item.className = `toast-item toast-${type}`;
  item.textContent = msg;
  el.appendChild(item);
  setTimeout(() => item.remove(), 3500);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['modal-det-bg', 'modal-new-bg', 'modal-stage-bg'].forEach(closeModal);
  }
});

init();
