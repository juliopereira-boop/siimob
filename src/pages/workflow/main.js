// Texto vindo do banco nunca entra cru no HTML: um nome com "<" viraria tag.
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Constants ────────────────────────────────────────────────────────────────
const NODE_W = 215;
const PORT_Y = 50; // y offset from node top to port center
const COLORS = [
  '#6366f1',
  '#7c3aed',
  '#ec4899',
  '#ef4444',
  '#f59e0b',
  '#0E8C7F',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#f97316',
  '#84cc16',
  '#6b7280',
  '#14b8a6',
  '#e11d48',
  '#0ea5e9',
  '#a855f7'
];

// ─── State ────────────────────────────────────────────────────────────────────
let stages = [];
let edges = [];
let counts = {}; // stage_id -> card count
let MODULE = 'repasse';
let drag = null; // { stageId, ox, oy, startX, startY }
let conn = null; // { fromId } — connecting mode
let mouseCanvas = { x: 0, y: 0 };
let selected = null; // stage id being edited
let editingStage = null;
let WF_USER = null; // current logged-in user (holds tenant_id)

// ─── Os módulos que este quadro sabe editar ──────────────────────────────────
//
// POR QUE EXISTE UM ADAPTADOR AQUI
// Repasse e Registro guardam etapas em a1_stages e ligações em a1_stage_edges.
// Pré-análise e Venda guardam a MESMA ideia com outros nomes: situações em
// a1_pa_situacoes / a1_co_situacoes e transições em a1_pa_transicoes /
// a1_co_transicoes, com nome em "nome" e não em "name", ordem em "ordem" e não
// em "position".
//
// A primeira versão do editor deles foi uma tabela separada, em Configurações.
// Ficaram dois editores para a mesma coisa, e o gestor tinha de aprender dois.
// O quadro é o desenho que ele já conhece; o que muda é de onde vêm as linhas.
//
// Cada adaptador traduz nos dois sentidos, e o resto do arquivo — arrastar,
// desenhar seta, conectar — não sabe de que módulo se trata.
// Na ordem do processo, a mesma da barra e a mesma das abas de tipo de
// documento: Pré-análise → Venda → Repasse, e o Registro ao fim.
const WF_MODULES = [
  // Leads faltava aqui, e por isso o modulo licenciado nao aparecia no editor:
  // o cliente ligava Leads e nao tinha como desenhar a esteira dele. Usa o
  // mesmo motor do Repasse e do Registro (`stages`), porque as tres moram em
  // a1_stages separadas por module_key — Leads nao precisa de selo de
  // automacao, so de inicio e fim, que e exatamente o que esse motor oferece.
  { key: 'crm', label: 'Leads', icone: '🎯', drv: 'stages' },
  { key: 'PRE_ANALISE', label: 'Pré-análise', icone: '🔎', drv: 'pa' },
  { key: 'COMERCIAL', label: 'Venda', icone: '🤝', drv: 'co' },
  { key: 'repasse', label: 'Repasse', icone: '🏦', drv: 'stages' },
  { key: 'registro', label: 'Registro', icone: '📁', drv: 'stages' }
];

// Classificação da situação, por módulo. É um ENUM de escolha única no banco —
// e por isso aqui é um seletor, e não as três caixinhas de marcar do Repasse.
// Marcar "inicial" e "aprovado" ao mesmo tempo é um estado que não existe.
const WF_FLAGS = {
  pa: [
    ['', '—'],
    ['INICIAL', 'Inicial'],
    ['APROVADO', 'Aprovado'],
    ['REPROVADO', 'Reprovado'],
    ['PENDENTE', 'Pendência'],
    ['VENCIDO', 'Vencido'],
    ['CANCELADO', 'Cancelado'],
    ['ENCERRADO', 'Encerrado']
  ],
  co: [
    ['', '—'],
    ['INICIAL', 'Inicial'],
    ['CONTRATO_ASSINADO', 'Contrato assinado'],
    ['CANCELADO', 'Cancelado'],
    ['ENCERRADO', 'Encerrado']
  ]
};

// Ações que uma TRANSIÇÃO pode disparar. Repare que não há ação em situação
// nenhuma: presa ao estado, qualquer caminho que chegasse ali dispararia o
// efeito — inclusive uma correção manual de status feita para acertar um
// lançamento errado.
const WF_SELOS = {
  pa: [
    ['', 'Sem selo'],
    ['INICIO', 'Início'],
    ['FIM_POSITIVO', 'Fim positivo — libera Venda'],
    ['FIM_NEGATIVO', 'Fim negativo — encerra']
  ],
  co: [
    ['', 'Sem selo'],
    ['INICIO', 'Início'],
    ['VENDIDO', 'Vendido — cria Repasse'],
    ['FIM_NEGATIVO', 'Fim negativo — encerra']
  ]
};

const WF_ACOES = {
  pa: [
    ['', 'nenhuma'],
    ['ENABLE_COMMERCIAL', 'Habilitar Venda']
  ],
  co: [
    ['', 'nenhuma'],
    ['CREATE_REPASS', 'Criar cartão no Repasse'],
    ['SEND_TO_SIGNATURE', 'Enviar para assinatura'],
    ['MARK_CONTRACT_SIGNED', 'Marcar contrato assinado']
  ]
};

const WF_REQUISITOS = {
  pa: [['documentos_aprovados', 'Exigir todos os documentos aprovados']],
  co: [['contrato_assinado', 'Exigir contrato assinado']]
};

const WF_DRIVERS = {
  // O de sempre. Fica explícito para o resto do código não ter caso especial.
  stages: {
    tabelaNo: 'a1_stages',
    tabelaLigacao: 'a1_stage_edges',
    temFlag: false,
    listarNos: async m =>
      fetch(`${A1.rest('a1_stages')}?module_key=eq.${m}&order=position.asc`, { headers: A1.headers() }).then(
        r => r.json()
      ),
    listarLigacoes: async () =>
      fetch(`${A1.rest('a1_stage_edges')}?order=id`, { headers: A1.headers() }).then(r => r.json()),
    paraTela: n => n,
    doFormulario: v => ({
      name: v.nome,
      color: v.cor,
      position: v.ordem,
      is_initial: v.inicial,
      is_final: v.final,
      is_pending: v.pendente,
      group_key: v.grupo
    }),
    novaLigacao: (de, para) => ({ from_id: de, to_id: para })
  },
  pa: adaptadorEsteira('a1_pa_situacoes', 'a1_pa_transicoes', 'pa'),
  co: adaptadorEsteira('a1_co_situacoes', 'a1_co_transicoes', 'co')
};

// Um só corpo para os dois módulos novos: as tabelas mudam de nome, o formato
// é o mesmo.
function adaptadorEsteira(tabelaNo, tabelaLigacao, tipo) {
  const FINAIS = ['APROVADO', 'REPROVADO', 'CANCELADO', 'ENCERRADO', 'CONTRATO_ASSINADO', 'VENCIDO'];
  return {
    tabelaNo,
    tabelaLigacao,
    temFlag: true,
    tipo,
    listarNos: async () => {
      const linhas = await fetch(`${A1.rest(tabelaNo)}?order=ordem.asc`, { headers: A1.headers() })
        .then(r => r.json())
        .catch(() => []);
      return (Array.isArray(linhas) ? linhas : []).map(l => ({
        id: l.id,
        name: l.nome,
        color: l.cor || '#6366f1',
        position: l.ordem ?? 0,
        pos_x: l.pos_x,
        pos_y: l.pos_y,
        // A classificação vira as marcas do quadro só para DESENHAR. O que se
        // grava de volta é a flag; as marcas não são campo.
        is_initial: l.flag === 'INICIAL',
        is_final: FINAIS.includes(l.flag),
        is_pending: l.flag === 'PENDENTE',
        flag: l.flag || '',
        selo: l.selo || '',
        sla_horas: l.sla_horas,
        ativo: l.ativo !== false
      }));
    },
    listarLigacoes: async () => {
      const linhas = await fetch(`${A1.rest(tabelaLigacao)}?ativo=is.true`, { headers: A1.headers() })
        .then(r => r.json())
        .catch(() => []);
      return (
        (Array.isArray(linhas) ? linhas : [])
          // Transição "de qualquer situação" (de_id nulo) não tem de onde sair no
          // desenho. Ela continua valendo no banco; aqui só não vira seta.
          .filter(l => l.de_id)
          .map(l => ({
            id: l.id,
            from_id: l.de_id,
            to_id: l.para_id,
            acao: l.acao || '',
            acao_modo: l.acao_modo || 'CONFIRMAR',
            requisitos: l.requisitos || {},
            papeis: l.papeis || []
          }))
      );
    },
    paraTela: n => n,
    doFormulario: v => ({
      nome: v.nome,
      cor: v.cor,
      ordem: v.ordem,
      flag: v.flag || null,
      selo: v.selo || null,
      sla_horas: v.sla,
      ativo: v.ativa !== false
    }),
    novaLigacao: (de, para) => ({
      de_id: de,
      para_id: para,
      papeis: [],
      requisitos: {},
      acao: null,
      acao_modo: 'CONFIRMAR',
      ativo: true
    })
  };
}

function drv() {
  return WF_DRIVERS[(WF_MODULES.find(m => m.key === MODULE) || {}).drv || 'stages'];
}
function ehEsteira() {
  return drv().temFlag;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    WF_USER = a1RequireAuth();
  } catch {
    return;
  }
  a1StartHeartbeat('workflow');
  const slug = A1.slug;
  document.getElementById('back-btn').href = `/${slug}/configuracoes`;

  // carrega módulos ativos do tenant
  const activeMods = await fetch(`${A1.rest('a1_tenant_modules')}?select=module_key`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .catch(() => []);
  const activeKeys = new Set(activeMods.map(m => m.module_key));

  // Só entram os módulos que o cliente TEM. A versão anterior listava todos com
  // um cadeado; mostrar o que não se pode escolher é oferecer o que não existe.
  const sel = document.getElementById('module-sel');
  sel.innerHTML = WF_MODULES.filter(m => activeKeys.has(m.key))
    .map(m => `<option value="${m.key}">${m.icone} ${m.label}</option>`)
    .join('');

  const params = new URLSearchParams(location.search);
  const requested = params.get('module') || 'repasse';

  // se o módulo solicitado não está ativo, usa o primeiro disponível
  MODULE = activeKeys.has(requested)
    ? requested
    : WF_MODULES.find(m => activeKeys.has(m.key))?.key || 'repasse';
  montarBotoesDeModulo(activeKeys);

  // se o módulo solicitado estava bloqueado, avisa
  if (requested !== MODULE) {
    const banner = document.createElement('div');
    banner.style.cssText =
      'position:fixed;top:52px;left:0;right:0;background:#1e1b4b;border-bottom:1px solid #312e81;padding:.5rem 1.25rem;font-size:.75rem;color:#a5b4fc;z-index:100;text-align:center';
    banner.textContent = `O módulo "${requested}" não está habilitado para esta conta. Exibindo o módulo disponível.`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 5000);
  }

  sel.value = MODULE;
  document.getElementById('wf-module-label').textContent =
    `— ${WF_MODULES.find(m => m.key === MODULE)?.label || MODULE}`;
  marcarModuloAtivo();

  buildColorRow();
  await load();
  bindEvents();
}

// Os módulos como botões na própria barra, e não escondidos num seletor: o
// gestor abre o editor e vê de uma vez tudo que ele pode desenhar.
function montarBotoesDeModulo(liberados) {
  const caixa = document.getElementById('wf-modulos');
  if (!caixa) return;
  const meus = WF_MODULES.filter(m => liberados.has(m.key));
  // Com um módulo só não há o que escolher. O seletor viraria enfeite.
  if (meus.length < 2) {
    caixa.style.display = 'none';
    return;
  }
  caixa.style.display = '';
  caixa.innerHTML = meus
    .map(
      m =>
        `<button type="button" class="wf-mod-btn" data-mod="${esc(m.key)}" onclick="changeModule('${esc(m.key)}')"
       title="Workflow de ${esc(m.label)}"><span aria-hidden="true">${m.icone}</span> ${esc(m.label)}</button>`
    )
    .join('');
  document.getElementById('module-sel').style.display = 'none';
}

function marcarModuloAtivo() {
  document.querySelectorAll('.wf-mod-btn').forEach(b => b.classList.toggle('on', b.dataset.mod === MODULE));
}

function buildColorRow() {
  const row = document.getElementById('color-row');
  COLORS.forEach(c => {
    const d = document.createElement('div');
    d.className = 'color-swatch';
    d.style.background = c;
    d.dataset.color = c;
    d.addEventListener('click', () => selectColor(c));
    row.appendChild(d);
  });
}

function selectColor(c) {
  document
    .querySelectorAll('.color-swatch')
    .forEach(el => el.classList.toggle('active', el.dataset.color === c));
}

function getSelectedColor() {
  const el = document.querySelector('.color-swatch.active');
  return el ? el.dataset.color : '#6366f1';
}

// ─── Data ─────────────────────────────────────────────────────────────────────
let WF_LOCK = false;

// Bloqueio do workflow: quando ligado, o processo só pode ir para uma etapa
// ligada por uma seta saindo da etapa atual. Fica em a1_config, uma chave por
// módulo, para não haver disputa de escrita entre módulos.
function wfLockKey() {
  return 'wf_lock_' + MODULE;
}

async function loadWfLock() {
  const rows = await fetch(`${A1.rest('a1_config')}?key=eq.${wfLockKey()}&select=value`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .catch(() => []);
  WF_LOCK = !!(rows && rows[0] && String(rows[0].value) === 'true');
  paintWfLock();
}

function paintWfLock() {
  const b = document.getElementById('wf-lock-btn');
  if (!b) return;
  // Nos módulos novos a trava não é opção: a1_pa_transicionar e
  // a1_co_transicionar RECUSAM qualquer movimento sem uma transição cadastrada,
  // no banco, antes de mexer em coisa alguma. Oferecer aqui um botão
  // "Workflow livre" que não solta nada seria mentir para o gestor.
  if (ehEsteira()) {
    b.textContent = '🔒 Só pelas setas';
    b.title = 'Nos módulos de esteira o banco sempre exige uma transição cadastrada. Não há modo livre.';
    b.disabled = true;
    b.style.color = '#8892a4';
    b.style.borderColor = 'rgba(255,255,255,.1)';
    b.style.cursor = 'default';
    b.style.opacity = '.75';
    return;
  }
  b.disabled = false;
  b.style.cursor = '';
  b.style.opacity = '';
  b.title = 'Quando bloqueado, o processo só anda para uma etapa ligada por seta';
  b.textContent = WF_LOCK ? '🔒 Workflow bloqueado' : '🔓 Workflow livre';
  b.style.color = WF_LOCK ? '#fca5a5' : '#8892a4';
  b.style.borderColor = WF_LOCK ? 'rgba(239,68,68,.35)' : 'rgba(255,255,255,.1)';
}

async function toggleWfLock() {
  const novo = !WF_LOCK;
  const res = await fetch(A1.rest('a1_config'), {
    method: 'POST',
    headers: A1.upsertHeaders(),
    body: JSON.stringify({ tenant_id: A1.user.tenant_id, key: wfLockKey(), value: String(novo) })
  });
  if (!res.ok) {
    toast('Não foi possível salvar o bloqueio do workflow', 'error');
    return;
  }
  WF_LOCK = novo;
  paintWfLock();
  toast(
    novo
      ? 'Workflow bloqueado: o processo só anda pelas ligações desenhadas.'
      : 'Workflow livre: o processo pode ir para qualquer etapa.',
    'success'
  );
}

async function load() {
  const d = drv();
  [stages, edges] = await Promise.all([d.listarNos(MODULE), d.listarLigacoes(MODULE)]);
  if (!Array.isArray(stages)) stages = [];
  if (!Array.isArray(edges)) edges = [];
  loadWfLock();

  // Quantos processos estão parados em cada nó. O número no cartão é o que
  // impede o gestor de apagar uma situação achando que está vazia.
  counts = {};
  const contar = (linhas, campo) =>
    (Array.isArray(linhas) ? linhas : []).forEach(c => {
      counts[c[campo]] = (counts[c[campo]] || 0) + 1;
    });
  if (ehEsteira()) {
    const tabela = d.tipo === 'pa' ? 'a1_pre_analises' : 'a1_comerciais';
    contar(
      await fetch(`${A1.rest(tabela)}?select=situacao_id`, { headers: A1.headers() })
        .then(r => r.json())
        .catch(() => []),
      'situacao_id'
    );
  } else {
    contar(
      await fetch(`${A1.rest('a1_cases')}?module_key=eq.${MODULE}&select=stage_id`, { headers: A1.headers() })
        .then(r => r.json())
        .catch(() => []),
      'stage_id'
    );
  }

  // Default positions for stages without positions
  stages.forEach((s, i) => {
    if (!s.pos_x && !s.pos_y) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      s.pos_x = 60 + col * 270;
      s.pos_y = 80 + row * 200;
    }
  });

  render();
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const canvas = document.getElementById('wf-canvas');
  canvas.querySelectorAll('.wf-node').forEach(el => el.remove());

  stages.forEach(s => {
    const el = document.createElement('div');
    el.className = 'wf-node' + (selected === s.id ? ' selected' : '');
    el.id = `node-${s.id}`;
    el.style.left = `${s.pos_x}px`;
    el.style.top = `${s.pos_y}px`;
    el.style.borderColor = s.color || '#6366f1';
    el.style.color = s.color || '#6366f1';

    const cnt = counts[s.id] || 0;
    // Nas esteiras, o desenho obedece ao SELO salvo. `flag` classifica a
    // situação, mas não transforma visualmente uma etapa em início/fim. Antes,
    // tirar o selo mantinha o ícone Fim porque ele vinha da flag APROVADO.
    const inicioVisual = ehEsteira() ? s.selo === 'INICIO' : s.is_initial;
    const fimVisual = ehEsteira() ? ['FIM_POSITIVO', 'FIM_NEGATIVO', 'VENDIDO'].includes(s.selo) : s.is_final;
    const badges = [
      inicioVisual ? '<span class="stag stag-init">Início</span>' : '',
      fimVisual ? '<span class="stag stag-final">Fim</span>' : '',
      s.is_pending ? '<span class="stag stag-pending">Pendente</span>' : ''
    ].join('');

    el.innerHTML = `
      <div class="node-top-bar" style="background:${s.color || '#6366f1'}"></div>
      <div class="node-header">
        <div class="node-name">${esc(s.name)}</div>
        <div class="node-meta">Ordem: ${s.position} · ${cnt} card${cnt !== 1 ? 's' : ''}</div>
      </div>
      <div class="node-badges">${badges}</div>
      <div class="node-foot">
        <button class="node-btn" onclick="openEdit('${s.id}')">✏ Editar</button>
      </div>
      <div class="port port-l" data-id="${s.id}" data-side="left"  style="color:${s.color || '#6366f1'}" title="Destino da conexão"></div>
      <div class="port port-r" data-id="${s.id}" data-side="right" style="color:${s.color || '#6366f1'}" title="Clique para iniciar conexão"></div>`;

    // Drag on header
    el.querySelector('.node-header').addEventListener('mousedown', e => startDrag(e, s.id));
    canvas.appendChild(el);
  });

  pintarVazio();
  drawEdges();
}

function drawEdges() {
  const svg = document.getElementById('wf-svg');
  // Remove paths/lines (keep defs)
  Array.from(svg.children).forEach(c => {
    if (c.tagName !== 'defs') c.remove();
  });

  // Existing edges
  edges.forEach(e => {
    const from = stages.find(s => s.id === e.from_id);
    const to = stages.find(s => s.id === e.to_id);
    if (!from || !to) return;

    const p1 = { x: from.pos_x + NODE_W, y: from.pos_y + PORT_Y };
    const p2 = { x: to.pos_x, y: to.pos_y + PORT_Y };
    const path = makePath(p1, p2, from.color || '#6366f1', false);

    path.style.pointerEvents = 'visibleStroke';
    path.style.cursor = 'pointer';
    path.addEventListener('click', ev => {
      ev.stopPropagation();
      confirmDeleteEdge(e.id);
    });
    svg.appendChild(path);
  });

  // Temp connection line
  if (conn) {
    const from = stages.find(s => s.id === conn.fromId);
    if (from) {
      const p1 = { x: from.pos_x + NODE_W, y: from.pos_y + PORT_Y };
      svg.appendChild(makePath(p1, mouseCanvas, 'rgba(255,255,255,.4)', true));
    }
  }
}

function makePath(p1, p2, color, dashed) {
  const dx = Math.max(Math.abs(p2.x - p1.x) * 0.5, 80);
  const d = `M${p1.x},${p1.y} C${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}`;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', dashed ? '1.5' : '2.5');
  path.setAttribute('stroke-opacity', dashed ? '.5' : '.75');
  if (dashed) path.setAttribute('stroke-dasharray', '7 4');
  path.setAttribute('marker-end', dashed ? 'url(#arr-temp)' : 'url(#arr)');
  return path;
}

// ─── Drag ─────────────────────────────────────────────────────────────────────
function startDrag(e, stageId) {
  if (conn) return;
  e.preventDefault();
  const stage = stages.find(s => s.id === stageId);
  drag = {
    stageId,
    startMouseX: e.clientX,
    startMouseY: e.clientY,
    origX: stage.pos_x,
    origY: stage.pos_y
  };
  document.getElementById(`node-${stageId}`).style.zIndex = 30;
  document.getElementById('wf-canvas').style.cursor = 'grabbing';
}

// ─── Mouse tracking ───────────────────────────────────────────────────────────
function bindEvents() {
  const wrap = document.getElementById('wf-wrap');

  document.addEventListener('mousemove', e => {
    if (drag) {
      const dx = e.clientX - drag.startMouseX;
      const dy = e.clientY - drag.startMouseY;
      const stage = stages.find(s => s.id === drag.stageId);
      stage.pos_x = Math.max(0, drag.origX + dx);
      stage.pos_y = Math.max(0, drag.origY + dy);
      const el = document.getElementById(`node-${stage.id}`);
      el.style.left = `${stage.pos_x}px`;
      el.style.top = `${stage.pos_y}px`;
      drawEdges();
    }

    if (conn) {
      const rect = document.getElementById('wf-canvas').getBoundingClientRect();
      const wrapEl = document.getElementById('wf-wrap');
      mouseCanvas = {
        x: e.clientX - rect.left + wrapEl.scrollLeft,
        y: e.clientY - rect.top + wrapEl.scrollTop
      };
      drawEdges();
    }
  });

  document.addEventListener('mouseup', async e => {
    if (drag) {
      const stage = stages.find(s => s.id === drag.stageId);
      document.getElementById(`node-${stage.id}`).style.zIndex = 10;
      document.getElementById('wf-canvas').style.cursor = '';
      // Save position
      await fetch(`${A1.rest(drv().tabelaNo)}?id=eq.${stage.id}`, {
        method: 'PATCH',
        headers: A1.headers(),
        body: JSON.stringify({ pos_x: Math.round(stage.pos_x), pos_y: Math.round(stage.pos_y) })
      });
      drag = null;
    }
  });

  // Port clicks
  document.getElementById('wf-canvas').addEventListener('click', async e => {
    const port = e.target.closest('.port');
    if (!port) return;
    const nodeId = port.dataset.id;
    const side = port.dataset.side;

    if (side === 'right') {
      // Start connection
      conn = { fromId: nodeId };
      document.getElementById('conn-indicator').style.display = 'block';
      e.stopPropagation();
      return;
    }

    if (side === 'left' && conn) {
      // Complete connection
      if (conn.fromId === nodeId) {
        cancelConn();
        return;
      }
      // Check duplicate
      const exists = edges.some(ed => ed.from_id === conn.fromId && ed.to_id === nodeId);
      if (!exists) {
        const d = drv();
        const res = await fetch(A1.rest(d.tabelaLigacao), {
          method: 'POST',
          headers: A1.returnHeaders(),
          body: JSON.stringify({ tenant_id: WF_USER.tenant_id, ...d.novaLigacao(conn.fromId, nodeId) })
        });
        if (res.ok) {
          const [criada] = await res.json();
          edges.push(
            d.tabelaLigacao === 'a1_stage_edges'
              ? criada
              : {
                  id: criada.id,
                  from_id: criada.de_id,
                  to_id: criada.para_id,
                  acao: criada.acao || '',
                  acao_modo: criada.acao_modo || 'CONFIRMAR',
                  requisitos: criada.requisitos || {},
                  papeis: criada.papeis || []
                }
          );
        } else {
          toast('Não foi possível criar a conexão.', 'error');
        }
      }
      cancelConn();
      drawEdges();
      e.stopPropagation();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      cancelConn();
      closeEditPanel();
    }
  });
}

function cancelConn() {
  conn = null;
  document.getElementById('conn-indicator').style.display = 'none';
  drawEdges();
}

// ─── Edge delete ──────────────────────────────────────────────────────────────
async function confirmDeleteEdge(edgeId) {
  // Nos módulos novos a seta não é só um traço: ela carrega a ação, o requisito
  // e os papéis. Apagar sem mostrar isso apagaria a regra junto, em silêncio.
  if (ehEsteira()) {
    abrirTransicao(edgeId);
    return;
  }
  if (!confirm('Remover esta conexão?')) return;
  await fetch(`${A1.rest(drv().tabelaLigacao)}?id=eq.${edgeId}`, { method: 'DELETE', headers: A1.headers() });
  edges = edges.filter(e => e.id !== edgeId);
  drawEdges();
  toast('Conexão removida', 'success');
}

// ─── Stage CRUD ───────────────────────────────────────────────────────────────
// Mostra os campos que existem no módulo aberto, e esconde os que não existem.
// Repasse tem etapa inicial/final/pendente; a esteira tem classificação e SLA.
// Mostrar os dois conjuntos ao mesmo tempo faria o gestor preencher campo que
// o banco ignora.
function pintarCamposDoModulo() {
  const esteira = ehEsteira();
  document.getElementById('ep-esteira').style.display = esteira ? '' : 'none';
  document.getElementById('ep-propriedades').style.display = esteira ? 'none' : '';
  if (esteira) {
    const sel = document.getElementById('ep-flag');
    const selo = document.getElementById('ep-selo');
    const atual = sel.value,
      seloAtual = selo.value;
    sel.innerHTML = (WF_FLAGS[drv().tipo] || [])
      .map(([v, r]) => `<option value="${esc(v)}">${esc(r)}</option>`)
      .join('');
    selo.innerHTML = (WF_SELOS[drv().tipo] || [])
      .map(([v, r]) => `<option value="${esc(v)}">${esc(r)}</option>`)
      .join('');
    sel.value = atual;
    selo.value = seloAtual;
  }
}

function openNewStage() {
  editingStage = null;
  fecharTransicao();
  pintarCamposDoModulo();
  document.getElementById('ep-flag').value = '';
  document.getElementById('ep-selo').value = '';
  document.getElementById('ep-sla').value = '';
  document.getElementById('ep-name').value = '';
  document.getElementById('ep-group').value = '';
  document.getElementById('ep-position').value = stages.length;
  document.getElementById('ep-initial').checked = false;
  document.getElementById('ep-final').checked = false;
  document.getElementById('ep-pending').checked = false;
  selectColor(COLORS[stages.length % COLORS.length]);
  document.getElementById('ep-err').style.display = 'none';
  document.getElementById('edit-panel').classList.add('open');
}

function openEdit(stageId) {
  editingStage = stages.find(s => s.id === stageId);
  if (!editingStage) return;
  selected = stageId;
  render();
  fecharTransicao();
  pintarCamposDoModulo();
  document.getElementById('ep-flag').value = editingStage.flag || '';
  document.getElementById('ep-selo').value = editingStage.selo || '';
  document.getElementById('ep-sla').value = editingStage.sla_horas == null ? '' : editingStage.sla_horas;
  document.getElementById('ep-name').value = editingStage.name;
  document.getElementById('ep-group').value = editingStage.group_key || '';
  document.getElementById('ep-position').value = editingStage.position;
  document.getElementById('ep-initial').checked = !!editingStage.is_initial;
  document.getElementById('ep-final').checked = !!editingStage.is_final;
  document.getElementById('ep-pending').checked = !!editingStage.is_pending;
  selectColor(editingStage.color || '#6366f1');
  document.getElementById('ep-err').style.display = 'none';
  document.getElementById('edit-panel').classList.add('open');
}

function closeEditPanel() {
  document.getElementById('edit-panel').classList.remove('open');
  selected = null;
  editingStage = null;
  render();
}

async function definirSeloDaEtapa(stageId, selo) {
  if (!ehEsteira()) return true;
  const res = await fetch(A1.rpc('a1_workflow_definir_selo'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({ p_module_key: MODULE, p_stage_id: stageId, p_selo: selo || null })
  });
  if (res.ok) return true;
  const erro = await res.json().catch(() => ({}));
  epErro(
    erro.message && /sem_permissao/.test(erro.message)
      ? 'Você não tem permissão para alterar selos deste workflow.'
      : 'A etapa foi preservada, mas não foi possível transferir o selo. Aplique a migration de integridade do workflow e tente novamente.'
  );
  return false;
}

async function saveStage() {
  const name = document.getElementById('ep-name').value.trim();
  const color = getSelectedColor();
  const group = document.getElementById('ep-group').value.trim() || null;
  const position = parseInt(document.getElementById('ep-position').value) || 0;
  const is_initial = document.getElementById('ep-initial').checked;
  const is_final = document.getElementById('ep-final').checked;
  const is_pending = document.getElementById('ep-pending').checked;

  if (!name) {
    document.getElementById('ep-err').textContent = 'Informe o nome da etapa.';
    document.getElementById('ep-err').style.display = 'block';
    return;
  }

  const d = drv();
  const flag = ehEsteira() ? document.getElementById('ep-flag').value || null : null;
  const selo = ehEsteira() ? document.getElementById('ep-selo').value || null : null;
  const slaCampo = document.getElementById('ep-sla');
  const sla = ehEsteira() ? (slaCampo.value === '' ? null : parseInt(slaCampo.value, 10)) : null;
  const payload = d.doFormulario({
    nome: name,
    cor: color,
    ordem: position,
    grupo: group,
    inicial: is_initial,
    final: is_final,
    pendente: is_pending,
    flag,
    selo,
    sla,
    ativa: true
  });
  // O selo não viaja no PATCH comum. Remover/mover precisa ser uma operação
  // atômica no banco, porque dois PATCHes deixariam uma janela com duplicidade
  // ou poderiam manter o valor antigo quando o campo viesse vazio.
  if (ehEsteira()) delete payload.selo;

  if (editingStage) {
    const res = await fetch(`${A1.rest(d.tabelaNo)}?id=eq.${editingStage.id}`, {
      method: 'PATCH',
      headers: A1.headers(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      epErro('Não foi possível salvar. Confira se você é gestor deste cliente.');
      return;
    }
    if (ehEsteira() && !(await definirSeloDaEtapa(editingStage.id, selo))) return;
    Object.assign(editingStage, {
      name,
      color,
      position,
      group_key: group,
      is_initial,
      is_final,
      is_pending,
      flag: flag || '',
      selo: selo || '',
      sla_horas: sla
    });
    toast('Etapa atualizada', 'success');
  } else {
    const extra = ehEsteira() ? {} : { module_key: MODULE };
    const res = await fetch(A1.rest(d.tabelaNo), {
      method: 'POST',
      headers: A1.returnHeaders(),
      body: JSON.stringify({
        ...payload,
        ...extra,
        tenant_id: WF_USER.tenant_id,
        pos_x: 60 + (stages.length % 4) * 270,
        pos_y: 80 + Math.floor(stages.length / 4) * 200
      })
    });
    if (!res.ok) {
      epErro('Não foi possível criar. Confira se você é gestor deste cliente.');
      return;
    }
    const [criada] = await res.json();
    if (ehEsteira() && !(await definirSeloDaEtapa(criada.id, selo))) return;
    stages.push(
      ehEsteira()
        ? {
            id: criada.id,
            name,
            color,
            position,
            pos_x: criada.pos_x,
            pos_y: criada.pos_y,
            is_initial,
            is_final,
            is_pending,
            flag: flag || '',
            selo: selo || '',
            sla_horas: sla,
            ativo: true
          }
        : criada
    );
    toast('Etapa criada', 'success');
  }

  closeEditPanel();
  // Refaz a leitura em vez de confiar só no objeto local: ao transferir um
  // selo, a outra etapa também mudou dentro da mesma transação.
  await load();
}

async function deleteStage() {
  if (!editingStage) return;
  if (!confirm(`Excluir a etapa "${esc(editingStage.name)}"? Os cards nesta etapa ficarão sem etapa.`))
    return;
  const resDel = await fetch(`${A1.rest(drv().tabelaNo)}?id=eq.${editingStage.id}`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  if (!resDel.ok) {
    // O banco recusa apagar situação com processo apontando para ela — e faz
    // bem: apagar deixaria o processo apontando para o nada.
    epErro('Não foi possível excluir. Provavelmente há processos parados nesta etapa.');
    return;
  }
  stages = stages.filter(s => s.id !== editingStage.id);
  edges = edges.filter(e => e.from_id !== editingStage.id && e.to_id !== editingStage.id);
  closeEditPanel();
  render();
  toast('Etapa excluída', 'error');
}

// ─── Esteira padrão, para o dia 1 não ser uma tela vazia ─────────────────────
// Cliente que acabou de receber o módulo abre o quadro sem nenhuma situação: não
// há para onde mover processo, e a tela não explica isso sozinha. Este é um
// ponto de partida do mercado, não uma regra — o gestor renomeia, corta e liga
// o que quiser depois.
//
// NADA nasce com ação entre módulos nem em modo automático. Semear automação
// ligada na conta de quem ainda está desenhando o fluxo é o tipo de erro que só
// aparece depois de já ter criado registro em outro módulo.
const WF_PADRAO = {
  pa: [
    { nome: 'Nova', flag: 'INICIAL', cor: '#6366f1', sla: 4 },
    { nome: 'Em análise', flag: null, cor: '#0ea5e9', sla: 24 },
    { nome: 'Pendência', flag: 'PENDENTE', cor: '#f59e0b', sla: 48 },
    { nome: 'Aprovada', flag: 'APROVADO', cor: '#22c55e', sla: null },
    { nome: 'Reprovada', flag: 'REPROVADO', cor: '#ef4444', sla: null },
    { nome: 'Cancelada', flag: 'CANCELADO', cor: '#6B827D', sla: null }
  ],
  co: [
    { nome: 'Proposta', flag: 'INICIAL', cor: '#6366f1', sla: 24 },
    { nome: 'Negociação', flag: null, cor: '#8b5cf6', sla: 72 },
    { nome: 'Contrato', flag: null, cor: '#0ea5e9', sla: 48 },
    { nome: 'Contrato assinado', flag: 'CONTRATO_ASSINADO', cor: '#22c55e', sla: null },
    { nome: 'Cancelado', flag: 'CANCELADO', cor: '#ef4444', sla: null }
  ]
};

async function semearEsteira() {
  const d = drv(),
    tipo = d.tipo;
  const modelo = WF_PADRAO[tipo] || [];
  if (!modelo.length) return;

  const linhas = modelo.map((m, i) => ({
    tenant_id: WF_USER.tenant_id,
    nome: m.nome,
    flag: m.flag,
    cor: m.cor,
    ordem: i,
    sla_horas: m.sla,
    ativo: true,
    pos_x: 60 + (i % 4) * 270,
    pos_y: 80 + Math.floor(i / 4) * 200
  }));
  const res = await fetch(A1.rest(d.tabelaNo), {
    method: 'POST',
    headers: A1.returnHeaders(),
    body: JSON.stringify(linhas)
  });
  if (!res.ok) {
    toast('Não foi possível criar a esteira. Confira se você é gestor.', 'error');
    return;
  }
  const criadas = await res.json();
  if (!Array.isArray(criadas) || !criadas.length) {
    await load();
    return;
  }

  // Liga em sequência, e deixa as terminais alcançáveis de qualquer lugar:
  // cancelar e reprovar acontecem a qualquer momento, não só no fim da fila.
  const TERMINAIS = ['REPROVADO', 'CANCELADO', 'ENCERRADO'];
  const ordenadas = criadas.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  const terminais = ordenadas.filter(x => TERMINAIS.includes(x.flag));
  const fluxo = ordenadas.filter(x => !terminais.includes(x));
  const ligacoes = [];
  for (let i = 0; i < fluxo.length - 1; i++)
    ligacoes.push({ tenant_id: WF_USER.tenant_id, ...d.novaLigacao(fluxo[i].id, fluxo[i + 1].id) });
  terminais.forEach(t => ligacoes.push({ tenant_id: WF_USER.tenant_id, ...d.novaLigacao(null, t.id) }));

  if (ligacoes.length) {
    await fetch(A1.rest(d.tabelaLigacao), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify(ligacoes)
    }).catch(() => {});
  }
  await load();
  toast('Esteira padrão criada. Ajuste à vontade.', 'success');
}

// O quadro vazio precisa dizer o que fazer. Sem isso, o gestor vê um fundo
// pontilhado e nenhuma pista de que o módulo depende dele para funcionar.
function pintarVazio() {
  const antigo = document.getElementById('wf-vazio');
  if (antigo) antigo.remove();
  if (stages.length) return;
  const div = document.createElement('div');
  div.id = 'wf-vazio';
  div.style.cssText =
    'position:absolute;left:60px;top:80px;max-width:460px;background:#0d1117;' +
    'border:1px solid rgba(255,255,255,.1);border-radius:.75rem;padding:1.5rem;z-index:5';
  div.innerHTML = `
    <div style="font-size:.9rem;font-weight:800;color:#f0f4ff;margin-bottom:.5rem">
      Este módulo ainda não tem esteira</div>
    <div style="font-size:.78rem;color:#8892a4;line-height:1.55;margin-bottom:1.1rem">
      Sem situações cadastradas o módulo abre, mas não funciona: não há para onde
      mover um processo. Comece pelo desenho padrão e ajuste com o cliente —
      nada aqui é definitivo, e nenhuma automação nasce ligada.
    </div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      ${ehEsteira() ? '<button class="btn btn-primary" id="wf-semear" onclick="semearEsteira()">Criar esteira padrão</button>' : ''}
      <button class="btn btn-ghost" onclick="openNewStage()">Criar do zero</button>
    </div>`;
  document.getElementById('wf-canvas').appendChild(div);
}

// ─── Transição: a seta que carrega a regra ───────────────────────────────────
let transicaoAberta = null;

function abrirTransicao(id) {
  const t = edges.find(e => e.id === id);
  if (!t) return;
  transicaoAberta = t;
  const tipo = drv().tipo;
  const nome = i => {
    const n = stages.find(x => x.id === i);
    return n ? n.name : '—';
  };

  document.getElementById('tr-de-para').innerHTML =
    `<strong>${esc(nome(t.from_id))}</strong> &rarr; <strong>${esc(nome(t.to_id))}</strong>`;
  document.getElementById('tr-acao').innerHTML = (WF_ACOES[tipo] || [])
    .map(([v, r]) => `<option value="${esc(v)}"${(t.acao || '') === v ? ' selected' : ''}>${esc(r)}</option>`)
    .join('');
  document.getElementById('tr-modo').value = t.acao_modo || 'CONFIRMAR';
  document.getElementById('tr-requisitos').innerHTML = (WF_REQUISITOS[tipo] || [])
    .map(
      ([k, r]) => `<label class="toggle-row" style="cursor:pointer">
        <span class="toggle-label">${esc(r)}</span>
        <input type="checkbox" data-req="${esc(k)}" ${(t.requisitos || {})[k] ? 'checked' : ''}
               style="width:16px;height:16px;accent-color:#6366f1;cursor:pointer">
      </label>`
    )
    .join('');
  document.getElementById('tr-papeis').value = (t.papeis || []).join(', ');
  document.getElementById('tr-err').style.display = 'none';
  pintarModo();
  document.getElementById('edit-panel').classList.remove('open');
  document.getElementById('tr-panel').classList.add('open');
}

// Modo só faz sentido com ação escolhida: "automático" sem ação nenhuma é um
// estado que confunde quem lê a esteira depois.
function pintarModo() {
  const temAcao = !!document.getElementById('tr-acao').value;
  document.getElementById('tr-modo').disabled = !temAcao;
}

function fecharTransicao() {
  transicaoAberta = null;
  document.getElementById('tr-panel').classList.remove('open');
}

async function salvarTransicao() {
  if (!transicaoAberta) return;
  const acao = document.getElementById('tr-acao').value || null;
  const requisitos = {};
  document.querySelectorAll('#tr-requisitos input[data-req]').forEach(c => {
    if (c.checked) requisitos[c.dataset.req] = true;
  });
  const papeis = document
    .getElementById('tr-papeis')
    .value.split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
  const corpo = {
    acao,
    acao_modo: acao ? document.getElementById('tr-modo').value : 'CONFIRMAR',
    requisitos,
    papeis
  };

  const res = await fetch(`${A1.rest(drv().tabelaLigacao)}?id=eq.${transicaoAberta.id}`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify(corpo)
  });
  if (!res.ok) {
    const err = document.getElementById('tr-err');
    err.textContent = 'Não foi possível salvar. Confira se você é gestor deste cliente.';
    err.style.display = 'block';
    return;
  }
  Object.assign(transicaoAberta, corpo, { acao: acao || '' });
  fecharTransicao();
  drawEdges();
  toast('Transição salva', 'success');
}

async function apagarTransicao() {
  if (!transicaoAberta) return;
  if (!confirm('Remover esta transição? A esteira deixa de permitir esse caminho.')) return;
  const res = await fetch(`${A1.rest(drv().tabelaLigacao)}?id=eq.${transicaoAberta.id}`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  if (!res.ok) {
    toast('Não foi possível remover.', 'error');
    return;
  }
  edges = edges.filter(e => e.id !== transicaoAberta.id);
  fecharTransicao();
  drawEdges();
  toast('Transição removida', 'success');
}

function epErro(msg) {
  const e = document.getElementById('ep-err');
  e.textContent = msg;
  e.style.display = 'block';
}

// ─── Module switch ────────────────────────────────────────────────────────────
async function changeModule(m) {
  // A lista só traz o que o cliente tem, então não existe mais opção travada.
  // Ainda assim, quem chega por ?module= de um módulo não liberado não passa:
  // o guarda de verdade é o RLS, este aqui só evita a tela vazia sem explicação.
  if (!document.querySelector(`#module-sel option[value="${m}"]`)) {
    toast('Módulo não liberado para este cliente', 'error');
    return;
  }
  MODULE = m;
  fecharTransicao();
  closeEditPanel();
  document.getElementById('module-sel').value = m;
  document.getElementById('wf-module-label').textContent =
    `— ${WF_MODULES.find(x => x.key === m)?.label || m}`;
  marcarModuloAtivo();
  history.replaceState(null, '', `?module=${m}`);
  await load();
}

// ─── Auto layout ──────────────────────────────────────────────────────────────
async function autoLayout() {
  // Group by group_key, then layout left-to-right following edges (topological sort)
  const groups = {};
  stages.forEach(s => {
    const g = s.group_key || '__default';
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });

  let rowY = 80;
  for (const [, gs] of Object.entries(groups)) {
    gs.sort((a, b) => a.position - b.position);
    gs.forEach((s, i) => {
      s.pos_x = 60 + i * 270;
      s.pos_y = rowY;
    });
    rowY += 200;
  }

  // Batch save positions
  await Promise.all(
    stages.map(s =>
      fetch(`${A1.rest(drv().tabelaNo)}?id=eq.${s.id}`, {
        method: 'PATCH',
        headers: A1.headers(),
        body: JSON.stringify({ pos_x: Math.round(s.pos_x), pos_y: Math.round(s.pos_y) })
      })
    )
  );

  render();
  toast('Layout organizado', 'success');
}

function toast(msg, type = 'info') {
  const el = document.getElementById('a1-toast');
  const d = document.createElement('div');
  d.className = `toast-item toast-${type}`;
  d.textContent = msg;
  el.appendChild(d);
  setTimeout(() => d.remove(), 3000);
}

init();
// Esta tela não tem heartbeat, então vigia a chave geral por conta própria.
a1VigiarManutencao();
