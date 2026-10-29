import { A1_URL } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import { hojeISO } from '../../shared/utils/datas.js';
import { expor, exporVariavel } from '../../shared/utils/expor.js';
import { acoes } from '../../shared/ui/acoes.js';

// Alcançáveis pela suíte de testes e por sondas typeof. Ver src/shared/utils/expor.js.
expor({
  abrirAviso,
  acessarComo,
  closeModal,
  estadoMes,
  loadTenantModulesFor,
  manutDesligar,
  manutLigar,
  openCobranca,
  openUsersModal,
  renderCobranca,
  saAuth,
  salvarAviso,
  switchSaTab,
  toast
});

// O que cada data-acao do HTML faz. Ver src/shared/ui/acoes.js.
acoes({
  abrirAviso: el => abrirAviso(el.dataset.id ?? null),
  accessTenant: el => accessTenant(el.dataset.tenantId, el.dataset.slug, el.dataset.tenantName),
  acessarComo: el =>
    acessarComo(
      el.dataset.tenantId,
      el.dataset.slug,
      el.dataset.tenantName,
      el.dataset.userId,
      el.dataset.papel,
      el.dataset.nome
    ),
  alternarAutoMonitor: () => alternarAutoMonitor(),
  alternarPublicacao: el => alternarPublicacao(el.dataset.id),
  apagarSituacao: el => apagarSituacao(el.dataset.id),
  autoForo: () => autoForo(),
  carregarEsteira: () => carregarEsteira(),
  changePlan: el => changePlan(el.dataset.tenantId),
  clearLogoUpload: () => clearLogoUpload(),
  closeDespLimitModal: () => closeDespLimitModal(),
  closeModal: el => closeModal(el.dataset.id),
  cobPersistMeta: () => cobPersistMeta(),
  cobToggle: el => cobToggle(Number(el.dataset.mIdx)),
  cobYear: el => cobYear(Number(el.dataset.delta)),
  confirmDespLimit: () => confirmDespLimit(),
  createTenant: () => createTenant(),
  createUserForTenant: () => createUserForTenant(),
  deleteLead: el => deleteLead(el.dataset.id, el.dataset.nome),
  deleteTenant: el => deleteTenant(el.dataset.tenantId, el.dataset.tenantName),
  deleteUser: el => deleteUser(el.dataset.userId, el.dataset.userName),
  editarPapeis: el => editarPapeis(el.dataset.id, el.value),
  editarRequisito: el => editarRequisito(el.dataset.id, el.dataset.chave, el.checked),
  editarSituacao: el => editarSituacao(el.dataset.id, el.dataset.campo, el.value),
  editarTransicao: el => editarTransicao(el.dataset.id, el.dataset.campo, el.value),
  editarTransicaoOuNulo: el => editarTransicao(el.dataset.id, el.dataset.campo, el.value || null),
  excluirAviso: el => excluirAviso(el.dataset.id),
  fecharLimitePeloFundo: (el, ev) => {
    if (ev.target === el) closeDespLimitModal();
  },
  filterTenants: () => filterTenants(),
  gerarContratoPDF: () => gerarContratoPDF(),
  handleLogoFile: (el, ev) => handleLogoFile(ev),
  imagemDoAvisoFalhou: el => {
    el.replaceWith(
      Object.assign(document.createElement('div'), {
        textContent: 'Não consegui carregar esta imagem. Confira o endereço.',
        style: 'font-size:.75rem;color:#B91C1C'
      })
    );
  },
  loadFeedback: () => loadFeedback(),
  loadLeads: () => loadLeads(),
  loadMonitor: () => loadMonitor(),
  loadTenantModulesFor: () => loadTenantModulesFor(),
  lockModuleFor: el => lockModuleFor(el.dataset.tenantId, el.dataset.moduleKey),
  mailtoCobranca: () => mailtoCobranca(),
  manutCarregar: () => manutCarregar(),
  manutDesligar: () => manutDesligar(),
  manutLigar: () => manutLigar(),
  marcarPagoIndicacao: el => marcarPagoIndicacao(el.dataset.id),
  mudarStatusIndicacao: el => mudarStatusIndicacao(el.dataset.id, el.value),
  mudarValorIndicacao: el => mudarValorIndicacao(el.dataset.id, el.value),
  novaSituacao: () => novaSituacao(),
  novaTransicao: () => novaTransicao(),
  openCobranca: el => openCobranca(el.dataset.tenantId, el.dataset.name, el.dataset.email),
  openContrato: el => openContrato(el.dataset.tenantId),
  openUsersModal: el => openUsersModal(el.dataset.tenantId, el.dataset.tenantName),
  pintarPreviaAviso: () => pintarPreviaAviso(),
  reactivateTenant: el => reactivateTenant(el.dataset.tenantId),
  renderLeads: () => renderLeads(),
  resetPw: el => resetPw(el.dataset.userId),
  saAuth: () => saAuth(),
  saLogout: () => saLogout(),
  salvarAviso: el => salvarAviso(el.dataset.publicar === 'true'),
  saveLogoUpload: () => saveLogoUpload(),
  semearEsteira: () => semearEsteira(),
  semearTransicoes: () => semearTransicoes(),
  sendCobranca: () => sendCobranca(),
  setFeedbackStatus: el => setFeedbackStatus(el.dataset.id, el.dataset.status),
  setLeadStatus: el => setLeadStatus(el.dataset.id, el.value),
  setUserLimit: el => setUserLimit(el.dataset.tenantId, el.value),
  subirArquivoAviso: el => subirArquivoAviso(el, el.dataset.qual),
  suspendTenant: el => suspendTenant(el.dataset.tenantId),
  switchSaTab: el => switchSaTab(el.dataset.name, el),
  tirarArquivoAviso: el => tirarArquivoAviso(el.dataset.qual),
  toggleCustomLimit: () => toggleCustomLimit(),
  toggleUser: el => toggleUser(el.dataset.userId, el.dataset.current === 'true'),
  unlockModuleFor: el => unlockModuleFor(el.dataset.tenantId, el.dataset.moduleKey),
  usarBannerPronto: el => {
    /** @type {HTMLInputElement} */ (document.getElementById('av-imagem')).value = el.dataset.url;
    pintarPreviaAviso();
  }
});
exporVariavel(
  'ACTIVE_TENANT_ID',
  () => ACTIVE_TENANT_ID,
  v => (ACTIVE_TENANT_ID = v)
);
exporVariavel(
  'COB',
  () => COB,
  v => (COB = v)
);
let SA_URL = '';
let SA_KEY = '';
let TENANTS = [];
let ALL_MODULES = [];
let PLANS = [];
let CONTRACT_TENANT = null;
let CONTRACT_MODS = [];

// `types`: tipos de cliente para os quais o módulo é ofertável. Ausente = todos.
const MODULES_DEF = [
  // A ordem da lista é a ordem do processo — Leads → Pré-análise → Venda →
  // Repasse → Registro — e é a mesma da barra de abas e do editor de workflow.
  // Todos continuam nascendo desligados para todo cliente; ordem não é licença.
  //
  // 'crm' chamava-se "CRM Básico" e era ofertado só a imobiliária e construtora.
  // O nome virou Leads porque é assim que a tela, a barra e o dono o chamam — e
  // catálogo que diz um nome com a tela dizendo outro faz o gestor licenciar a
  // coisa errada. O tipo de cliente saiu: correspondente e despachante também
  // recebem lead, e a restrição só impedia de vender o módulo a quem o quer.
  {
    key: 'crm',
    name: 'Leads',
    desc: 'Funil de leads com quadro, qualificação, proposta, tarefas e histórico. É a porta de entrada da jornada: o lead qualificado vira Pré-análise.',
    types: ['correspondente_bancario', 'imobiliaria', 'construtora', 'despachante'],
    dependeDe: []
  },
  {
    key: 'PRE_ANALISE',
    name: 'Pré-análise',
    desc: 'Entrada do processo: pessoas, dossiê, renda, FGTS, subsídio, correspondente e decisão de crédito. Esteira própria.',
    types: ['correspondente_bancario', 'imobiliaria', 'construtora'],
    dependeDe: []
  },
  {
    key: 'COMERCIAL',
    name: 'Venda',
    desc: 'Proposta, negociação, contrato e assinatura. Pode abrir Repasse na etapa que o cliente escolher.',
    types: ['correspondente_bancario', 'imobiliaria', 'construtora'],
    dependeDe: ['PRE_ANALISE']
  },
  {
    key: 'repasse',
    name: 'Repasse Imobiliário',
    desc: 'Pipeline completo de repasse bancário com Kanban, documentos e acompanhamento.',
    types: ['correspondente_bancario', 'imobiliaria', 'construtora']
  },
  {
    key: 'registro',
    name: 'Registro em Cartório',
    desc: 'Módulo despachante: ITBI, protocolos, exigências e matrícula atualizada.',
    types: ['correspondente_bancario', 'imobiliaria', 'construtora', 'despachante']
  },
  {
    key: 'financeiro',
    name: 'Módulo Financeiro',
    desc: 'Controle de comissões, repasse financeiro e fluxo de caixa.',
    types: ['correspondente_bancario', 'imobiliaria', 'construtora']
  },
  {
    key: 'simulador',
    name: 'Simulador de Crédito',
    desc: 'Simulação de financiamento consignado e habitacional integrada.',
    types: ['correspondente_bancario', 'imobiliaria', 'construtora']
  },
  {
    key: 'portal_parceiro',
    name: 'Portal Parceiro',
    desc: 'Acesso externo para correspondentes parceiros acompanharem seus processos.',
    types: ['correspondente_bancario']
  },
  {
    key: 'ocr',
    name: 'Leitor OCR',
    desc: 'Extração automática de dados de documentos PDF via inteligência artificial.'
  },
  {
    key: 'workflow_avancado',
    name: 'Workflow Avançado',
    desc: 'Motor de automação com pré-requisitos, ações e gatilhos personalizados.'
  },
  {
    key: 'multi_regional',
    name: 'Multi-Regional',
    desc: 'Segregação de dados e relatórios por região geográfica.'
  }
  // Os módulos novos subiram para o topo da lista, na ordem do processo. Eles
  // continuam nascendo desligados para todo cliente: as tabelas deles só
  // respondem depois que a licença é criada aqui — não é a tela que esconde, é
  // a política do banco que não entrega linha.
];

// Dependência entre módulos. Não é bloqueio: Venda funciona sozinho para
// quem já negocia fora do sistema. É aviso — sem Pré-análise, o caminho
// automático "aprovou → abre o comercial" simplesmente não existe, e é melhor
// dizer isso na hora de liberar do que o cliente descobrir depois.
function avisoDependencia(mod, activeKeys) {
  const faltando = (mod.dependeDe || []).filter(k => !activeKeys.has(k));
  if (!faltando.length) return '';
  const nomes = faltando.map(k => (MODULES_DEF.find(m => m.key === k) || {}).name || k);
  return `<div style="font-size:.66rem;color:#9A6008;background:#FFFBEB;border:1px solid #FDE68A;
    border-radius:6px;padding:.35rem .5rem;margin-top:.4rem;line-height:1.4">
    Funciona sozinho, mas o fluxo automático precisa de <b>${esc(nomes.join(', '))}</b>.</div>`;
}

function saHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', apikey: SA_KEY, Authorization: `Bearer ${SA_KEY}`, ...extra };
}
function saRest(table) {
  return `${SA_URL}/rest/v1/${table}`;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function saAuth() {
  SA_URL = (document.getElementById('sa-url-input').value || A1_URL).replace(/\/$/, '');
  SA_KEY = document.getElementById('sa-key-input').value.trim();
  if (!SA_KEY) {
    saErr('Informe a Service Role Key.');
    return;
  }
  try {
    const res = await fetch(saRest('a1_tenants') + '?limit=1', { headers: saHeaders() });
    if (!res.ok) throw new Error('Chave inválida ou URL incorreta.');
    document.getElementById('auth-gate').style.display = 'none';
    document.getElementById('sa-panel').style.display = 'block';
    applyCustomLogo();
    await loadAll();
  } catch (e) {
    saErr(e.message || 'Erro de conexão.');
  }
}

function saErr(msg) {
  const el = document.getElementById('sa-auth-err');
  el.textContent = msg;
  el.style.display = 'block';
}

function saLogout() {
  SA_KEY = SA_URL = '';
  document.getElementById('auth-gate').style.display = 'flex';
  document.getElementById('sa-panel').style.display = 'none';
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function switchSaTab(name, el) {
  document.querySelectorAll('.sa-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  [
    'clientes',
    'modulos',
    'planos',
    'melhorias',
    'interessados',
    'esteiras',
    'monitor',
    'avisos',
    'indica',
    'plataforma'
  ].forEach(t => {
    const div = document.getElementById(`satab-${t}`);
    if (div) div.style.display = t === name ? '' : 'none';
  });
  if (name === 'esteiras') prepararEsteiras();
  if (name === 'melhorias') loadFeedback();
  if (name === 'interessados') loadLeads();
  if (name === 'plataforma') {
    initLogoUpload();
    manutCarregar();
  }
  if (name === 'monitor') loadMonitor();
  if (name === 'avisos') loadAvisos();
  if (name === 'indica') loadIndicacoes();
}

// ═══ Esteiras dos módulos novos ══════════════════════════════════════════════
// A esteira é a máquina de estados que cada cliente configura para si. Vive
// aqui, e não dentro do sistema do cliente, por dois motivos: a chave de
// serviço passa por cima do RLS (então dá para preparar a esteira antes de o
// cliente sequer ter a licença), e configuração de fluxo é decisão de
// implantação, feita junto com o cliente, não pelo operador do dia a dia.
//
// Um detalhe que parece bobo e não é: as ações (ENABLE_COMMERCIAL,
// CREATE_REPASS) ficam na TRANSIÇÃO, nunca na situação. Se o efeito estivesse
// preso ao estado, qualquer caminho que chegasse àquele estado dispararia o
// efeito — inclusive uma correção manual de status.
const EST = { situacoes: [], transicoes: [], modulo: 'PRE_ANALISE', tenant: null };

const EST_DEF = {
  PRE_ANALISE: {
    nome: 'Pré-análise',
    tabSit: 'a1_pa_situacoes',
    tabTr: 'a1_pa_transicoes',
    flags: ['INICIAL', 'APROVADO', 'REPROVADO', 'PENDENTE', 'VENCIDO', 'CANCELADO', 'ENCERRADO'],
    acoes: [
      ['', 'nenhuma'],
      ['ENABLE_COMMERCIAL', 'Habilitar Venda']
    ],
    requisitos: [['documentos_aprovados', 'Exigir todos os documentos aprovados']],
    // Ponto de partida inspirado no fluxo de mercado; o cliente ajusta depois.
    padrao: [
      { nome: 'Nova', flag: 'INICIAL', cor: '#6366f1', sla_horas: 4 },
      { nome: 'Em análise', flag: null, cor: '#0ea5e9', sla_horas: 24 },
      { nome: 'Pendência', flag: 'PENDENTE', cor: '#f59e0b', sla_horas: 48 },
      { nome: 'Aprovada', flag: 'APROVADO', cor: '#22c55e', sla_horas: null },
      { nome: 'Reprovada', flag: 'REPROVADO', cor: '#ef4444', sla_horas: null },
      { nome: 'Cancelada', flag: 'CANCELADO', cor: '#6B827D', sla_horas: null }
    ]
  },
  COMERCIAL: {
    nome: 'Venda',
    tabSit: 'a1_co_situacoes',
    tabTr: 'a1_co_transicoes',
    flags: ['INICIAL', 'CONTRATO_ASSINADO', 'CANCELADO', 'ENCERRADO'],
    acoes: [
      ['', 'nenhuma'],
      ['CREATE_REPASS', 'Criar cartão no Repasse'],
      ['SEND_TO_SIGNATURE', 'Enviar para assinatura'],
      ['MARK_CONTRACT_SIGNED', 'Marcar contrato assinado']
    ],
    requisitos: [['contrato_assinado', 'Exigir contrato assinado']],
    padrao: [
      { nome: 'Proposta', flag: 'INICIAL', cor: '#6366f1', sla_horas: 24 },
      { nome: 'Negociação', flag: null, cor: '#8b5cf6', sla_horas: 72 },
      { nome: 'Contrato', flag: null, cor: '#0ea5e9', sla_horas: 48 },
      { nome: 'Contrato assinado', flag: 'CONTRATO_ASSINADO', cor: '#22c55e', sla_horas: null },
      { nome: 'Cancelado', flag: 'CANCELADO', cor: '#ef4444', sla_horas: null }
    ]
  }
};

function prepararEsteiras() {
  const sel = document.getElementById('est-tenant');
  const cur = sel.value;
  sel.innerHTML =
    '<option value="">Selecione um cliente...</option>' +
    TENANTS.map(t => `<option value="${t.id}">${esc(t.name)} (${t.slug})</option>`).join('');
  if (cur) {
    sel.value = cur;
    carregarEsteira();
  }
}

async function carregarEsteira() {
  EST.tenant = document.getElementById('est-tenant').value || null;
  EST.modulo = document.getElementById('est-modulo').value;
  const corpo = document.getElementById('est-corpo');
  if (!EST.tenant) {
    corpo.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--t3);font-size:.82rem">
      Selecione um cliente para configurar a esteira.</div>`;
    return;
  }
  const d = EST_DEF[EST.modulo];
  corpo.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--t3)">carregando…</div>`;
  const [sit, tr] = await Promise.all([
    fetch(`${saRest(d.tabSit)}?tenant_id=eq.${EST.tenant}&order=ordem.asc`, { headers: saHeaders() })
      .then(r => r.json())
      .catch(() => []),
    fetch(`${saRest(d.tabTr)}?tenant_id=eq.${EST.tenant}`, { headers: saHeaders() })
      .then(r => r.json())
      .catch(() => [])
  ]);
  EST.situacoes = Array.isArray(sit) ? sit : [];
  EST.transicoes = Array.isArray(tr) ? tr : [];
  renderEsteira();
}

function renderEsteira() {
  const d = EST_DEF[EST.modulo];
  const corpo = document.getElementById('est-corpo');

  if (!EST.situacoes.length) {
    corpo.innerHTML = `
      <div class="panel" style="padding:2rem;text-align:center">
        <div class="section-title" style="margin-bottom:.4rem">Este cliente ainda não tem esteira de ${esc(d.nome)}</div>
        <div style="font-size:.78rem;color:var(--t3);max-width:520px;margin:0 auto 1.2rem;line-height:1.55">
          Sem situações cadastradas, o módulo abre mas não funciona: não há para onde mover um processo.
          Comece pelo desenho padrão e ajuste com o cliente — nada aqui é definitivo.
        </div>
        <button class="btn btn-primary btn-sm" data-acao="semearEsteira">Criar esteira padrão de ${esc(d.nome)}</button>
      </div>`;
    return;
  }

  const nomeSit = id => {
    const s = EST.situacoes.find(x => x.id === id);
    return s ? s.nome : '—';
  };

  corpo.innerHTML = `
    <div class="panel" style="overflow:hidden;margin-bottom:1.25rem">
      <div style="padding:.875rem 1rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap">
        <div class="section-title">Situações de ${esc(d.nome)}</div>
        <button class="btn btn-ghost btn-xs" data-acao="novaSituacao">+ Situação</button>
      </div>
      <div class="tbl-wrap" style="border:none;box-shadow:none">
        <table><thead><tr>
          <th style="width:36px">#</th><th>Nome</th><th>Classificação</th>
          <th>Cor</th><th>SLA (horas)</th><th style="width:1%"></th>
        </tr></thead><tbody>
        ${EST.situacoes
          .map(
            (s, i) => `
          <tr>
            <td style="color:var(--t3)">${i + 1}</td>
            <td><input value="${esc(s.nome)}" data-acao-change="editarSituacao" data-id="${esc(s.id)}" data-campo="nome"
                       style="width:100%;padding:.28rem .45rem;border:1px solid var(--border);border-radius:5px;font-size:.77rem"></td>
            <td><select data-acao-change="editarSituacao" data-id="${esc(s.id)}" data-campo="flag"
                        style="padding:.28rem .45rem;border:1px solid var(--border);border-radius:5px;font-size:.75rem">
                  <option value="">—</option>
                  ${d.flags.map(f => `<option value="${f}" ${s.flag === f ? 'selected' : ''}>${f}</option>`).join('')}
                </select></td>
            <td><input type="color" value="${esc(s.cor || '#64748b')}" data-acao-change="editarSituacao" data-id="${esc(s.id)}" data-campo="cor"
                       style="width:44px;height:26px;border:1px solid var(--border);border-radius:5px;padding:0;cursor:pointer"></td>
            <td><input type="number" min="0" max="8760" value="${s.sla_horas == null ? '' : s.sla_horas}"
                       placeholder="sem prazo" data-acao-change="editarSituacao" data-id="${esc(s.id)}" data-campo="sla_horas"
                       style="width:92px;padding:.28rem .45rem;border:1px solid var(--border);border-radius:5px;font-size:.77rem"></td>
            <td><button class="btn btn-danger btn-xs" data-acao="apagarSituacao" data-id="${esc(s.id)}">Apagar</button></td>
          </tr>`
          )
          .join('')}
        </tbody></table>
      </div>
      <div style="padding:.7rem 1rem;font-size:.7rem;color:var(--t3);border-top:1px solid var(--border)">
        SLA em branco significa "sem prazo": a fila mostra há quanto tempo o processo está parado,
        mas não pinta de vermelho.
      </div>
    </div>

    <div class="panel" style="overflow:hidden">
      <div style="padding:.875rem 1rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap">
        <div class="section-title">Transições permitidas</div>
        <button class="btn btn-ghost btn-xs" data-acao="novaTransicao">+ Transição</button>
      </div>
      ${
        EST.transicoes.length
          ? `
      <div class="tbl-wrap" style="border:none;box-shadow:none">
        <table><thead><tr>
          <th>De</th><th>Para</th><th>Ação disparada</th><th>Quando</th>
          <th>Requisito</th><th>Papéis</th><th style="width:1%"></th>
        </tr></thead><tbody>
        ${EST.transicoes
          .map(
            t => `
          <tr>
            <td><select data-acao-change="editarTransicaoOuNulo" data-id="${esc(t.id)}" data-campo="de_id"
                        style="padding:.28rem .45rem;border:1px solid var(--border);border-radius:5px;font-size:.75rem">
                  <option value="">qualquer situação</option>
                  ${EST.situacoes.map(s => `<option value="${esc(s.id)}" ${t.de_id === s.id ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}
                </select></td>
            <td><select data-acao-change="editarTransicao" data-id="${esc(t.id)}" data-campo="para_id"
                        style="padding:.28rem .45rem;border:1px solid var(--border);border-radius:5px;font-size:.75rem">
                  ${EST.situacoes.map(s => `<option value="${esc(s.id)}" ${t.para_id === s.id ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}
                </select></td>
            <td><select data-acao-change="editarTransicaoOuNulo" data-id="${esc(t.id)}" data-campo="acao"
                        style="padding:.28rem .45rem;border:1px solid var(--border);border-radius:5px;font-size:.75rem">
                  ${d.acoes.map(([v, r]) => `<option value="${v}" ${(t.acao || '') === v ? 'selected' : ''}>${esc(r)}</option>`).join('')}
                </select></td>
            <td><select data-acao-change="editarTransicao" data-id="${esc(t.id)}" data-campo="acao_modo"
                        ${t.acao ? '' : 'disabled'}
                        style="padding:.28rem .45rem;border:1px solid var(--border);border-radius:5px;font-size:.75rem">
                  <option value="CONFIRMAR" ${t.acao_modo === 'CONFIRMAR' ? 'selected' : ''}>o operador confirma</option>
                  <option value="AUTO"      ${t.acao_modo === 'AUTO' ? 'selected' : ''}>automático</option>
                </select></td>
            <td>${d.requisitos
              .map(
                ([k, r]) => `
                  <label style="display:flex;align-items:center;gap:.3rem;font-size:.71rem;color:var(--t2);cursor:pointer">
                    <input type="checkbox" ${(t.requisitos || {})[k] ? 'checked' : ''}
                           data-acao-change="editarRequisito" data-id="${esc(t.id)}" data-chave="${esc(k)}"
                           style="accent-color:#0E8C7F;width:13px;height:13px;cursor:pointer">${esc(r)}</label>`
              )
              .join('')}</td>
            <td><input value="${esc((t.papeis || []).join(', '))}" placeholder="todos"
                       data-acao-change="editarPapeis" data-id="${esc(t.id)}"
                       style="width:130px;padding:.28rem .45rem;border:1px solid var(--border);border-radius:5px;font-size:.75rem"></td>
            <td><button class="btn btn-danger btn-xs" data-acao="apagarTransicao" data-id="${esc(t.id)}">Apagar</button></td>
          </tr>`
          )
          .join('')}
        </tbody></table>
      </div>`
          : `<div style="padding:2rem;text-align:center;color:var(--t3);font-size:.8rem">
        Nenhuma transição. Sem elas, nada se move na esteira.
        <div style="margin-top:.8rem"><button class="btn btn-primary btn-xs" data-acao="semearTransicoes">Ligar as situações em sequência</button></div>
      </div>`
      }
      <div style="padding:.7rem 1rem;font-size:.7rem;color:var(--t3);border-top:1px solid var(--border);line-height:1.5">
        <strong>Automático</strong> executa a ação junto com a mudança de situação, na mesma transação:
        ou valem as duas coisas, ou nenhuma. <strong>O operador confirma</strong> mostra um botão e espera o clique.<br>
        <strong>Papéis</strong> em branco = qualquer um com permissão de editar. Para restringir, liste os tipos
        separados por vírgula (ex.: <code>analista, coordenador</code>). Gestor nunca é barrado por este campo.
      </div>
    </div>`;
}

async function semearEsteira() {
  const d = EST_DEF[EST.modulo];
  const linhas = d.padrao.map((s, i) => ({
    tenant_id: EST.tenant,
    nome: s.nome,
    flag: s.flag,
    cor: s.cor,
    ordem: i,
    sla_horas: s.sla_horas,
    ativo: true
  }));
  const res = await fetch(saRest(d.tabSit), {
    method: 'POST',
    headers: saHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(linhas)
  });
  if (!res.ok) {
    toast('Não foi possível criar a esteira.', 'error');
    return;
  }
  EST.situacoes = await res.json();
  await semearTransicoes();
  toast(`Esteira padrão de ${d.nome} criada.`, 'success');
}

// Liga cada situação à seguinte e permite voltar para as terminais de qualquer
// lugar (cancelar e reprovar acontecem a qualquer momento, não só no fim).
async function semearTransicoes() {
  const d = EST_DEF[EST.modulo];
  const ordenadas = EST.situacoes.slice().sort((a, b) => a.ordem - b.ordem);
  const terminais = ordenadas.filter(s => ['REPROVADO', 'CANCELADO', 'ENCERRADO'].includes(s.flag));
  const fluxo = ordenadas.filter(s => !terminais.includes(s));
  const novas = [];
  for (let i = 0; i < fluxo.length - 1; i++) {
    novas.push({
      tenant_id: EST.tenant,
      de_id: fluxo[i].id,
      para_id: fluxo[i + 1].id,
      papeis: [],
      requisitos: {},
      acao: null,
      acao_modo: 'CONFIRMAR',
      ativo: true
    });
  }
  terminais.forEach(t =>
    novas.push({
      tenant_id: EST.tenant,
      de_id: null,
      para_id: t.id,
      papeis: [],
      requisitos: {},
      acao: null,
      acao_modo: 'CONFIRMAR',
      ativo: true
    })
  );
  if (!novas.length) {
    renderEsteira();
    return;
  }
  const res = await fetch(saRest(d.tabTr), {
    method: 'POST',
    headers: saHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(novas)
  });
  EST.transicoes = res.ok ? await res.json() : EST.transicoes;
  renderEsteira();
}

async function novaSituacao() {
  const nome = prompt('Nome da nova situação:');
  if (!nome || !nome.trim()) return;
  const d = EST_DEF[EST.modulo];
  const ordem = EST.situacoes.length ? Math.max(...EST.situacoes.map(s => s.ordem || 0)) + 1 : 0;
  const res = await fetch(saRest(d.tabSit), {
    method: 'POST',
    headers: saHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({ tenant_id: EST.tenant, nome: nome.trim(), ordem, cor: '#64748b', ativo: true })
  });
  if (!res.ok) {
    toast('Não foi possível criar a situação.', 'error');
    return;
  }
  EST.situacoes.push((await res.json())[0]);
  renderEsteira();
}

async function editarSituacao(id, campo, valor) {
  const d = EST_DEF[EST.modulo];
  if (campo === 'sla_horas') valor = valor === '' ? null : parseInt(valor, 10);
  if (campo === 'flag') valor = valor || null;
  const res = await fetch(`${saRest(d.tabSit)}?id=eq.${id}`, {
    method: 'PATCH',
    headers: saHeaders(),
    body: JSON.stringify({ [campo]: valor })
  });
  if (!res.ok) {
    toast('Não foi possível salvar.', 'error');
    return;
  }
  const s = EST.situacoes.find(x => x.id === id);
  if (s) s[campo] = valor;
  toast('Salvo.', 'success');
}

async function apagarSituacao(id) {
  const usada = EST.transicoes.filter(t => t.de_id === id || t.para_id === id).length;
  if (
    !confirm(
      usada
        ? `Esta situação é usada em ${usada} transição(ões), que serão apagadas junto. Continuar?`
        : 'Apagar esta situação?'
    )
  )
    return;
  const d = EST_DEF[EST.modulo];
  const res = await fetch(`${saRest(d.tabSit)}?id=eq.${id}`, { method: 'DELETE', headers: saHeaders() });
  if (!res.ok) {
    // O banco recusa apagar uma situação em que ainda existe processo parado —
    // e faz bem: apagar deixaria o processo apontando para o nada.
    toast('Não foi possível apagar. Provavelmente há processos nesta situação.', 'error');
    return;
  }
  EST.situacoes = EST.situacoes.filter(s => s.id !== id);
  EST.transicoes = EST.transicoes.filter(t => t.de_id !== id && t.para_id !== id);
  renderEsteira();
  toast('Situação apagada.', 'warn');
}

async function novaTransicao() {
  if (EST.situacoes.length < 2) {
    toast('Crie pelo menos duas situações antes.', 'error');
    return;
  }
  const d = EST_DEF[EST.modulo];
  const res = await fetch(saRest(d.tabTr), {
    method: 'POST',
    headers: saHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      tenant_id: EST.tenant,
      de_id: EST.situacoes[0].id,
      para_id: EST.situacoes[1].id,
      papeis: [],
      requisitos: {},
      acao: null,
      acao_modo: 'CONFIRMAR',
      ativo: true
    })
  });
  if (!res.ok) {
    toast('Não foi possível criar a transição.', 'error');
    return;
  }
  EST.transicoes.push((await res.json())[0]);
  renderEsteira();
}

async function editarTransicao(id, campo, valor) {
  const d = EST_DEF[EST.modulo];
  const res = await fetch(`${saRest(d.tabTr)}?id=eq.${id}`, {
    method: 'PATCH',
    headers: saHeaders(),
    body: JSON.stringify({ [campo]: valor })
  });
  if (!res.ok) {
    toast('Não foi possível salvar.', 'error');
    return;
  }
  const t = EST.transicoes.find(x => x.id === id);
  if (t) t[campo] = valor;
  // Tirar a ação tem de tirar o modo junto: "automático" sem ação nenhuma é um
  // estado que confunde quem lê a tabela depois.
  if (campo === 'acao') renderEsteira();
  else toast('Salvo.', 'success');
}

async function editarRequisito(id, chave, ligado) {
  const t = EST.transicoes.find(x => x.id === id);
  if (!t) return;
  const req = Object.assign({}, t.requisitos || {});
  if (ligado) req[chave] = true;
  else delete req[chave];
  await editarTransicao(id, 'requisitos', req);
}

async function editarPapeis(id, texto) {
  const papeis = String(texto || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  await editarTransicao(id, 'papeis', papeis);
}

// ═══ Monitor de acessos ══════════════════════════════════════════════════════
// Uma chamada só (a1_sa_monitor) devolve o agora, o histórico e a quebra por
// cliente — a soma é feita no banco. Baixar as linhas para contar aqui pararia
// de funcionar assim que o histórico crescesse, que é justamente quando o
// painel passa a interessar.
let MON_TIMER = null;

function alternarAutoMonitor() {
  const lig = document.getElementById('mon-auto').checked;
  if (MON_TIMER) {
    clearInterval(MON_TIMER);
    MON_TIMER = null;
  }
  if (lig) MON_TIMER = setInterval(loadMonitor, 30000);
}

async function loadMonitor() {
  const janela = (document.getElementById('mon-janela') || {}).value || 'dia';
  let d;
  try {
    const r = await fetch(`${SA_URL}/rest/v1/rpc/a1_sa_monitor`, {
      method: 'POST',
      headers: saHeaders(),
      body: JSON.stringify({ p_janela: janela })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    d = await r.json();
  } catch (e) {
    document.getElementById('mon-kpis').innerHTML =
      `<div style="grid-column:1/-1;background:#FEF2F2;border:1px solid #FECACA;color:#B91C1C;
        border-radius:8px;padding:.8rem;font-size:.8rem">
        Não consegui ler o monitor (${esc(e.message)}). Se as tabelas ainda não existem,
        rode <code>sql/2026-09-02_monitor_acessos.sql</code> no Supabase.</div>`;
    ['mon-online', 'mon-clientes'].forEach(
      i =>
        (document.getElementById(i).innerHTML =
          '<tr><td colspan="4" style="padding:1rem;text-align:center;color:var(--t3)">—</td></tr>')
    );
    document.getElementById('mon-grafico').innerHTML = '';
    return;
  }

  const baldes = Array.isArray(d.baldes) ? d.baldes : [];
  const pico = baldes.reduce((a, b) => Math.max(a, Number(b.acessos) || 0), 0);
  const rotuloJanela =
    { hora: 'nas últimas 24 horas', dia: 'nos últimos 30 dias', semana: 'nas últimas 12 semanas' }[
      d.janela
    ] || '';

  const kpi = (rot, val, sub, cor) => `
    <div style="border:1px solid var(--border);border-radius:10px;padding:.85rem 1rem">
      <div style="font-size:.63rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--t3)">${rot}</div>
      <div style="font-size:1.75rem;font-weight:900;letter-spacing:-.03em;margin-top:.15rem;color:${cor || 'var(--t1)'}">${val}</div>
      <div style="font-size:.7rem;color:var(--t3);margin-top:.1rem">${sub}</div>
    </div>`;

  const papeis =
    (d.online_por_papel || []).map(x => `${x.quantos} ${esc(x.papel)}`).join(' · ') || 'ninguém agora';
  document.getElementById('mon-kpis').innerHTML =
    kpi('Online agora', d.online || 0, papeis, d.online > 0 ? '#0E8C7F' : 'var(--t3)') +
    kpi('Acessos', d.total_acessos || 0, rotuloJanela) +
    kpi('Usuários distintos', d.total_usuarios || 0, rotuloJanela) +
    kpi(
      'Pico do período',
      pico,
      d.janela === 'hora'
        ? 'na hora mais movimentada'
        : d.janela === 'semana'
          ? 'na semana mais movimentada'
          : 'no dia mais movimentado'
    ) +
    kpi('Máx. simultâneo', d.pico_simultaneos ?? '—', 'pessoas juntas, em qualquer cliente') +
    kpi('Entradas de suporte', d.acessos_suporte || 0, 'suas, fora da conta acima');

  // ─── gráfico ───────────────────────────────────────────────────────────────
  // SVG desenhado aqui: nenhuma biblioteca externa para uma barra por balde.
  const L = 34,
    C = 190,
    larg = Math.max(24, Math.floor(760 / Math.max(baldes.length, 1)));
  const total = L + baldes.length * larg + 10;
  const alt = v => (pico ? Math.round(((Number(v) || 0) / pico) * (C - 30)) : 0);
  const rot = iso => {
    const dt = new Date(iso);
    if (d.janela === 'hora') return String(dt.getHours()).padStart(2, '0') + 'h';
    if (d.janela === 'semana') return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };
  const passo = Math.ceil(baldes.length / 14); // não empilhar rótulo

  document.getElementById('mon-grafico-leg').textContent =
    `Cada barra é ${d.janela === 'hora' ? 'uma hora' : d.janela === 'semana' ? 'uma semana' : 'um dia'}. Pico: ${pico} acesso${pico === 1 ? '' : 's'}.`;

  document.getElementById('mon-grafico').innerHTML = baldes.length
    ? `
    <svg width="${total}" height="${C + 26}" role="img" aria-label="Acessos por período" style="display:block">
      ${[0, 0.5, 1]
        .map(f => {
          const y = C - 30 - (C - 30) * f + 8;
          return `<line x1="${L}" y1="${y}" x2="${total - 6}" y2="${y}" stroke="#E2E8E5" stroke-width="1"/>
                <text x="4" y="${y + 4}" font-size="10" fill="#6B827D">${Math.round(pico * f)}</text>`;
        })
        .join('')}
      ${baldes
        .map((b, i) => {
          const h = alt(b.acessos),
            x = L + i * larg,
            y = C - 22 - h;
          return `<rect x="${x + 2}" y="${y}" width="${larg - 4}" height="${Math.max(h, b.acessos > 0 ? 2 : 0)}"
                  rx="2" fill="#0E8C7F"><title>${esc(rot(b.inicio))} — ${b.acessos} acesso(s), ${b.usuarios} usuário(s)</title></rect>
                ${
                  i % passo === 0
                    ? `<text x="${x + larg / 2}" y="${C + 2}" font-size="10" fill="#6B827D"
                  text-anchor="middle">${esc(rot(b.inicio))}</text>`
                    : ''
                }`;
        })
        .join('')}
    </svg>`
    : '<div style="color:var(--t3);font-size:.8rem">Sem acesso registrado neste período.</div>';

  // ─── online agora ──────────────────────────────────────────────────────────
  const quando = seg => (seg < 60 ? 'agora' : `há ${Math.floor(seg / 60)} min`);
  const online = d.online_lista || [];
  document.getElementById('mon-online').innerHTML = online.length
    ? online
        .map(
          u => `<tr>
        <td style="font-weight:600">${esc(u.nome || '—')}
          <span class="badge badge-gray" style="margin-left:.3rem">${esc(u.papel)}</span></td>
        <td>${esc(u.cliente || '—')}</td>
        <td style="color:var(--t3)">${esc(u.modulo || '—')}</td>
        <td style="white-space:nowrap">${esc(quando(Number(u.ha_segundos) || 0))}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="4" style="padding:1rem;text-align:center;color:var(--t3)">Ninguém no sistema neste instante.</td></tr>';

  // ─── por cliente ───────────────────────────────────────────────────────────
  const porCli = d.por_cliente || [];
  document.getElementById('mon-clientes').innerHTML = porCli.length
    ? porCli
        .map(c => {
          // Estourar o teto do plano é o tipo de coisa que não pode passar
          // despercebida numa tabela: fica em vermelho, com o limite ao lado.
          const max = c.max_simultaneos,
            lim = c.limite;
          const passou = max != null && lim > 0 && max > lim;
          const cel =
            max == null
              ? '<span style="color:var(--t3)">—</span>'
              : `<b style="color:${passou ? '#B8433A' : max === lim ? '#C87E12' : 'var(--t1)'}">${max}</b>` +
                (lim > 0 ? `<span style="color:var(--t3)"> / ${lim}</span>` : '') +
                (passou
                  ? ' <span style="color:#B8433A;font-size:.68rem;font-weight:800">acima do teto</span>'
                  : '');
          return `<tr>
          <td style="font-weight:600">${esc(c.cliente)}</td>
          <td>${c.acessos}</td>
          <td>${c.usuarios}</td>
          <td style="white-space:nowrap">${cel}</td>
          <td style="white-space:nowrap;color:var(--t3)">${c.ultimo ? new Date(c.ultimo).toLocaleString('pt-BR') : '—'}</td>
        </tr>`;
        })
        .join('')
    : '<tr><td colspan="5" style="padding:1rem;text-align:center;color:var(--t3)">Nada no período.</td></tr>';
}

// ═══ IndicaSII ═══════════════════════════════════════════════════════════════
// As tabelas de indicação não têm leitura pública nenhuma — só a chave de
// serviço enxerga. Aqui é o único lugar onde a carteira aparece inteira.
let INDICACOES = [];
const IND_STATUS = ['nova', 'em_contato', 'proposta', 'fechado', 'perdido'];
const IND_ROT = {
  nova: 'Recebida',
  em_contato: 'Em contato',
  proposta: 'Proposta',
  fechado: 'Fechado',
  perdido: 'Não seguiu'
};
const IND_COR = {
  nova: '#0E8C7F',
  em_contato: '#0891b2',
  proposta: '#F5A524',
  fechado: '#0E8C7F',
  perdido: '#6B827D'
};
const brlSA = n => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function loadIndicacoes() {
  const box = document.getElementById('indica-lista');
  box.innerHTML =
    '<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:.77rem">Carregando...</div>';
  try {
    const r = await fetch(
      `${SA_URL}/rest/v1/a1_indicacoes?select=*,a1_indicadores(nome,documento,email,telefone,chave_pix)&order=criado_em.desc`,
      { headers: saHeaders() }
    );
    if (!r.ok) throw new Error('HTTP ' + r.status);
    INDICACOES = await r.json();
    if (!Array.isArray(INDICACOES)) INDICACOES = [];
  } catch (e) {
    box.innerHTML = `<div style="padding:1.2rem;color:#b91c1c;font-size:.8rem">
      Não consegui ler as indicações: ${esc(e.message)}.<br>
      Se as tabelas ainda não existem, rode <code>sql/2026-09-01_indicasii.sql</code> no Supabase.</div>`;
    return;
  }
  renderIndicacoes();
}

// A recompensa é percentual da PRIMEIRA PARCELA paga pela empresa indicada,
// nunca do valor total do contrato, e sai uma única vez.
function comissaoDe(i) {
  return i.status === 'fechado' && i.valor_primeira_parcela
    ? Number(i.valor_primeira_parcela) * (Number(i.percentual || 20) / 100)
    : 0;
}

function renderIndicacoes() {
  const box = document.getElementById('indica-lista');
  const fechadas = INDICACOES.filter(i => i.status === 'fechado');
  const aPagar = INDICACOES.filter(i => !i.pago).reduce((a, i) => a + comissaoDe(i), 0);
  document.getElementById('indica-resumo').innerHTML =
    `<b>${INDICACOES.length}</b> indicação(ões) · <b>${fechadas.length}</b> fechada(s)<br>
     <span style="color:#0E8C7F;font-weight:800">${brlSA(aPagar)}</span> a pagar`;

  if (!INDICACOES.length) {
    box.innerHTML =
      '<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:.8rem">Nenhuma indicação recebida ainda.</div>';
    return;
  }
  const th = t =>
    `<th style="text-align:left;padding:.5rem;border-bottom:1px solid var(--border);font-size:.63rem;text-transform:uppercase;letter-spacing:.07em;color:var(--t3)">${t}</th>`;
  box.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
    <thead><tr>${th('Empresa indicada')}${th('Quem indicou')}${th('Situação')}${th('1ª parcela')}${th('Recompensa')}${th('')}</tr></thead>
    <tbody>${INDICACOES.map(i => {
      const q = i.a1_indicadores || {};
      const com = comissaoDe(i);
      return `<tr>
        <td style="padding:.6rem .5rem;border-bottom:1px solid #f1f5f9">
          <b>${esc(i.empresa)}</b>
          <div style="color:var(--t3);font-size:.72rem">${esc([i.cidade, i.uf].filter(Boolean).join(' / ') || '—')}${i.porte ? ' · ' + esc(i.porte) : ''}</div>
          ${i.contato_nome || i.contato_fone ? `<div style="color:var(--t2);font-size:.72rem;margin-top:.15rem">${esc(i.contato_nome || '')} ${esc(i.contato_fone || '')}</div>` : ''}
        </td>
        <td style="padding:.6rem .5rem;border-bottom:1px solid #f1f5f9">
          ${esc(q.nome || '—')}
          <div style="color:var(--t3);font-size:.72rem">${esc(q.telefone || q.email || '')}</div>
          ${q.chave_pix ? `<div style="color:var(--t3);font-size:.72rem">PIX: ${esc(q.chave_pix)}</div>` : ''}
        </td>
        <td style="padding:.6rem .5rem;border-bottom:1px solid #f1f5f9">
          <select data-acao-change="mudarStatusIndicacao" data-id="${esc(i.id)}"
            style="font-size:.75rem;padding:.25rem .4rem;border:1px solid var(--border);border-radius:6px;color:${IND_COR[i.status] || '#333'};font-weight:700">
            ${IND_STATUS.map(s => `<option value="${s}"${s === i.status ? ' selected' : ''}>${IND_ROT[s]}</option>`).join('')}
          </select>
        </td>
        <td style="padding:.6rem .5rem;border-bottom:1px solid #f1f5f9">
          <input type="number" value="${i.valor_primeira_parcela || ''}" placeholder="0,00" step="0.01"
            title="Valor da primeira parcela paga pela empresa indicada — não o total do contrato"
            data-acao-change="mudarValorIndicacao" data-id="${esc(i.id)}"
            style="width:110px;font-size:.78rem;padding:.25rem .4rem;border:1px solid var(--border);border-radius:6px">
          <div style="color:var(--t3);font-size:.68rem;margin-top:.1rem">${i.percentual || 20}% da 1ª parcela</div>
        </td>
        <td style="padding:.6rem .5rem;border-bottom:1px solid #f1f5f9;font-weight:800;color:${com ? '#0E8C7F' : 'var(--t3)'}">
          ${com ? brlSA(com) : '—'}
        </td>
        <td style="padding:.6rem .5rem;border-bottom:1px solid #f1f5f9;white-space:nowrap;text-align:right">
          ${
            com
              ? i.pago
                ? '<span style="font-size:.72rem;color:#0E8C7F;font-weight:800">pago</span>'
                : `<button class="btn btn-ghost" style="font-size:.73rem" data-acao="marcarPagoIndicacao" data-id="${esc(i.id)}">Marcar pago</button>`
              : ''
          }
        </td></tr>`;
    }).join('')}</tbody></table></div>`;
}

async function patchIndicacao(id, corpo, msg) {
  try {
    const r = await fetch(`${SA_URL}/rest/v1/a1_indicacoes?id=eq.${id}`, {
      method: 'PATCH',
      headers: saHeaders(),
      body: JSON.stringify({ ...corpo, atualizado_em: new Date().toISOString() })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (msg) toast(msg, 'success');
    loadIndicacoes();
  } catch (e) {
    toast('Não consegui salvar: ' + e.message, 'error');
  }
}
function mudarStatusIndicacao(id, status) {
  patchIndicacao(id, { status }, 'Situação atualizada');
}
function mudarValorIndicacao(id, valor) {
  const v = parseFloat(String(valor).replace(',', '.'));
  patchIndicacao(
    id,
    { valor_primeira_parcela: isFinite(v) && v > 0 ? v : null },
    'Valor da primeira parcela salvo'
  );
}
function marcarPagoIndicacao(id) {
  const i = INDICACOES.find(x => x.id === id);
  if (
    !confirm(
      `Confirmar o pagamento de ${brlSA(comissaoDe(i))} para ${(i.a1_indicadores || {}).nome || 'quem indicou'}?`
    )
  )
    return;
  patchIndicacao(id, { pago: true, pago_em: new Date().toISOString() }, 'Marcado como pago');
}

// ═══ Mural de Avisos ═════════════════════════════════════════════════════════
// Aviso é da plataforma, não de um cliente: por isso a tabela não tem tenant_id
// e a escrita só acontece daqui, com a chave de serviço. Quem lê é o sistema de
// cada cliente, e só o que está publicado e dentro do prazo.
let AVISOS = [],
  EDIT_AVISO = null,
  AVISO_ARQ = { imagem: '', video: '' };
const AV_ROTULO = {
  gestor: 'Gestores',
  correspondente: 'Correspondentes',
  analista: 'Analistas',
  corretor: 'Corretores',
  despachante: 'Despachantes'
};

async function loadAvisos() {
  const box = document.getElementById('avisos-lista');
  box.innerHTML =
    '<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:.77rem">Carregando...</div>';
  try {
    const r = await fetch(`${SA_URL}/rest/v1/a1_avisos?order=criado_em.desc`, { headers: saHeaders() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    AVISOS = await r.json();
    if (!Array.isArray(AVISOS)) AVISOS = [];
  } catch (e) {
    box.innerHTML = `<div style="padding:1.2rem;color:#b91c1c;font-size:.8rem">
      Não consegui ler os avisos: ${esc(e.message)}.<br>
      Se a tabela ainda não existe, rode <code>sql/2026-09-01_mural_avisos.sql</code> no Supabase.</div>`;
    return;
  }
  renderAvisos();
}

function renderAvisos() {
  const box = document.getElementById('avisos-lista');
  if (!AVISOS.length) {
    box.innerHTML =
      '<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:.8rem">Nenhum aviso criado ainda.</div>';
    return;
  }
  const agora = new Date();
  box.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
    <thead><tr>
      <th style="text-align:left;padding:.5rem;border-bottom:1px solid var(--border);font-size:.63rem;text-transform:uppercase;letter-spacing:.07em;color:var(--t3)">Aviso</th>
      <th style="text-align:left;padding:.5rem;border-bottom:1px solid var(--border);font-size:.63rem;text-transform:uppercase;letter-spacing:.07em;color:var(--t3)">Quem vê</th>
      <th style="text-align:left;padding:.5rem;border-bottom:1px solid var(--border);font-size:.63rem;text-transform:uppercase;letter-spacing:.07em;color:var(--t3)">Situação</th>
      <th style="width:230px;padding:.5rem;border-bottom:1px solid var(--border)"></th>
    </tr></thead><tbody>
    ${AVISOS.map(a => {
      const venceu = a.expira_em && new Date(a.expira_em) < agora;
      const sit = !a.publicado
        ? '<span style="color:var(--t3);font-weight:700">Rascunho</span>'
        : venceu
          ? '<span style="color:#9A6008;font-weight:700">Vencido</span>'
          : '<span style="color:#0E8C7F;font-weight:700">No ar</span>';
      const quem =
        a.publicos && a.publicos.length ? a.publicos.map(p => AV_ROTULO[p] || p).join(', ') : 'Todos';
      const clientes = a.tenants && a.tenants.length ? `${a.tenants.length} cliente(s)` : 'Todos os clientes';
      return `<tr>
        <td style="padding:.55rem .5rem;border-bottom:1px solid var(--border2,#f1f5f9)">
          <b>${esc(a.titulo)}</b>${a.fixado ? ' <span style="font-size:.62rem;background:#EEF2FF;color:#0E8C7F;padding:.1rem .35rem;border-radius:4px;font-weight:800">FIXADO</span>' : ''}
          <div style="color:var(--t3);font-size:.72rem;margin-top:.15rem">
            ${a.imagem_url ? 'imagem · ' : ''}${a.video_url ? 'vídeo · ' : ''}${esc((a.corpo || '').slice(0, 70))}${(a.corpo || '').length > 70 ? '…' : ''}
          </div>
        </td>
        <td style="padding:.55rem .5rem;border-bottom:1px solid var(--border2,#f1f5f9);color:var(--t2)">
          ${esc(quem)}<div style="color:var(--t3);font-size:.72rem">${esc(clientes)}</div>
        </td>
        <td style="padding:.55rem .5rem;border-bottom:1px solid var(--border2,#f1f5f9)">${sit}</td>
        <td style="padding:.55rem .5rem;border-bottom:1px solid var(--border2,#f1f5f9);white-space:nowrap;text-align:right">
          <button class="btn btn-ghost" style="font-size:.74rem" data-acao="abrirAviso" data-id="${esc(a.id)}">Editar</button>
          <button class="btn btn-ghost" style="font-size:.74rem" data-acao="alternarPublicacao" data-id="${esc(a.id)}">${a.publicado ? 'Despublicar' : 'Publicar'}</button>
          <button class="btn btn-ghost" style="font-size:.74rem;color:#B8433A" data-acao="excluirAviso" data-id="${esc(a.id)}">Excluir</button>
        </td></tr>`;
    }).join('')}
  </tbody></table></div>`;
}

function abrirAviso(id) {
  const a = id ? AVISOS.find(x => x.id === id) : null;
  EDIT_AVISO = a ? a.id : null;
  AVISO_ARQ = { imagem: (a && a.imagem_url) || '', video: (a && a.video_url) || '' };
  document.getElementById('aviso-titulo-modal').textContent = a ? 'Editar aviso' : 'Novo aviso';
  document.getElementById('av-titulo').value = (a && a.titulo) || '';
  document.getElementById('av-corpo').value = (a && a.corpo) || '';
  document.getElementById('av-imagem').value = (a && a.imagem_url) || '';
  document.getElementById('av-link').value = (a && a.link_url) || '';
  document.getElementById('av-link-texto').value = (a && a.link_texto) || '';
  document.getElementById('av-video').value = (a && a.video_url) || '';
  document.getElementById('av-expira').value = a && a.expira_em ? String(a.expira_em).slice(0, 10) : '';
  document.getElementById('av-fixado').checked = !!(a && a.fixado);
  document.getElementById('av-erro').classList.add('hidden');
  document.getElementById('av-img-arq').value = '';
  document.getElementById('av-vid-arq').value = '';
  pintarPreviaAviso();

  const pub = new Set((a && a.publicos) || []);
  document.querySelectorAll('.av-pub').forEach(cb => {
    cb.checked = pub.has(cb.value);
  });

  // Lista de clientes: marcar nenhum quer dizer "todos", que é o caso comum.
  const sel = new Set((a && a.tenants) || []);
  const box = document.getElementById('av-tenants');
  const lista = Array.isArray(TENANTS) ? TENANTS : [];
  box.innerHTML = lista.length
    ? lista
        .map(
          t => `<label style="display:flex;align-items:center;gap:.4rem;font-size:.8rem;cursor:pointer">
        <input type="checkbox" class="av-tenant" value="${esc(t.id)}"${sel.has(t.id) ? ' checked' : ''}> ${esc(t.name)}
      </label>`
        )
        .join('')
    : '<span style="color:var(--t3);font-size:.78rem">Nenhum cliente carregado.</span>';

  document.getElementById('av-btn-publicar').textContent =
    a && a.publicado ? 'Salvar e manter no ar' : 'Publicar';
  openModal('modal-aviso');
}

// A imagem pode vir de duas portas: link colado ou arquivo enviado. O link
// digitado ganha da última coisa enviada — é o que a pessoa está vendo na tela.
function imagemDoAviso() {
  const t = (document.getElementById('av-imagem').value || '').trim();
  return t || AVISO_ARQ.imagem || '';
}
function pintarPreviaAviso() {
  const i = document.getElementById('av-img-prev');
  const url = imagemDoAviso();
  i.innerHTML = url
    ? `<img src="${esc(url)}" style="max-width:260px;border-radius:8px;display:block"
            data-acao-error="imagemDoAvisoFalhou">
       <button class="btn btn-ghost" style="font-size:.72rem;margin-top:.3rem" data-acao="tirarArquivoAviso" data-qual="imagem">Remover imagem</button>`
    : '';
  const v = document.getElementById('av-vid-prev');
  v.innerHTML = AVISO_ARQ.video
    ? `Arquivo enviado. <button class="btn btn-ghost" style="font-size:.72rem" data-acao="tirarArquivoAviso" data-qual="video">Remover</button>`
    : '';
}
function tirarArquivoAviso(qual) {
  AVISO_ARQ[qual] = '';
  document.getElementById(qual === 'video' ? 'av-video' : 'av-imagem').value = '';
  if (qual === 'imagem') document.getElementById('av-img-arq').value = '';
  pintarPreviaAviso();
}

// Envia para o bucket público "avisos". Aviso é conteúdo que todo mundo do
// sistema vê, então link público simplifica e não expõe nada que já não fosse
// para ser visto.
async function subirArquivoAviso(input, qual) {
  const arq = input.files && input.files[0];
  if (!arq) return;
  const limite = qual === 'video' ? 50 : 5;
  if (arq.size > limite * 1024 * 1024) {
    erroAviso(`Arquivo grande demais (${(arq.size / 1048576).toFixed(1)} MB). O limite é ${limite} MB.`);
    input.value = '';
    return;
  }
  const nome = `${Date.now()}-${arq.name.replace(/[^\w.\-]/g, '_')}`;
  try {
    const r = await fetch(`${SA_URL}/storage/v1/object/avisos/${nome}`, {
      method: 'POST',
      headers: {
        apikey: SA_KEY,
        Authorization: `Bearer ${SA_KEY}`,
        'x-upsert': 'true',
        'Content-Type': arq.type || 'application/octet-stream'
      },
      body: arq
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(
        /Bucket not found/i.test(txt)
          ? 'O bucket "avisos" não existe. Crie no Supabase em Storage → New bucket → nome "avisos" → marque Public.'
          : 'HTTP ' + r.status
      );
    }
    AVISO_ARQ[qual] = `${SA_URL}/storage/v1/object/public/avisos/${nome}`;
    document.getElementById(qual === 'video' ? 'av-video' : 'av-imagem').value = AVISO_ARQ[qual];
    document.getElementById('av-erro').classList.add('hidden');
    pintarPreviaAviso();
  } catch (e) {
    erroAviso('Não consegui enviar: ' + e.message);
    input.value = '';
  }
}

function erroAviso(msg) {
  const el = document.getElementById('av-erro');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function salvarAviso(publicar) {
  const titulo = document.getElementById('av-titulo').value.trim();
  if (!titulo) {
    erroAviso('Escreva um título para o aviso.');
    return;
  }

  const publicos = [...document.querySelectorAll('.av-pub:checked')].map(c => c.value);
  const tenants = [...document.querySelectorAll('.av-tenant:checked')].map(c => c.value);
  const expira = document.getElementById('av-expira').value;
  const jaEstava = EDIT_AVISO && (AVISOS.find(a => a.id === EDIT_AVISO) || {}).publicado;

  const corpo = {
    titulo,
    corpo: document.getElementById('av-corpo').value,
    imagem_url: imagemDoAviso() || null,
    link_url: document.getElementById('av-link').value.trim() || null,
    link_texto: document.getElementById('av-link-texto').value.trim() || null,
    video_url: document.getElementById('av-video').value.trim() || AVISO_ARQ.video || null,
    publicos,
    tenants,
    fixado: document.getElementById('av-fixado').checked,
    publicado: publicar,
    expira_em: expira ? expira + 'T23:59:59' : null
  };
  // publicado_em marca a estreia: republicar não deve reordenar o mural.
  if (publicar && !jaEstava) corpo.publicado_em = new Date().toISOString();

  const btns = ['av-btn-publicar', 'av-btn-rascunho'].map(i => document.getElementById(i));
  btns.forEach(b => (b.disabled = true));
  try {
    const url = EDIT_AVISO
      ? `${SA_URL}/rest/v1/a1_avisos?id=eq.${EDIT_AVISO}`
      : `${SA_URL}/rest/v1/a1_avisos`;
    const r = await fetch(url, {
      method: EDIT_AVISO ? 'PATCH' : 'POST',
      headers: saHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify(corpo)
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || 'HTTP ' + r.status);
    }
    closeModal('modal-aviso');
    toast(publicar ? 'Aviso no ar' : 'Rascunho salvo', 'success');
    loadAvisos();
  } catch (e) {
    erroAviso('Não consegui salvar: ' + e.message);
  } finally {
    btns.forEach(b => (b.disabled = false));
  }
}

async function alternarPublicacao(id) {
  const a = AVISOS.find(x => x.id === id);
  if (!a) return;
  const corpo = { publicado: !a.publicado };
  if (!a.publicado && !a.publicado_em) corpo.publicado_em = new Date().toISOString();
  try {
    const r = await fetch(`${SA_URL}/rest/v1/a1_avisos?id=eq.${id}`, {
      method: 'PATCH',
      headers: saHeaders(),
      body: JSON.stringify(corpo)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    toast(a.publicado ? 'Aviso saiu do ar' : 'Aviso no ar', 'info');
    loadAvisos();
  } catch (e) {
    toast('Não consegui alterar: ' + e.message, 'error');
  }
}

async function excluirAviso(id) {
  const a = AVISOS.find(x => x.id === id);
  if (!confirm(`Excluir o aviso "${a ? a.titulo : ''}"? Isso não pode ser desfeito.`)) return;
  try {
    const r = await fetch(`${SA_URL}/rest/v1/a1_avisos?id=eq.${id}`, {
      method: 'DELETE',
      headers: saHeaders()
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    toast('Aviso excluído', 'info');
    loadAvisos();
  } catch (e) {
    toast('Não consegui excluir: ' + e.message, 'error');
  }
}

// ─── Interessados (leads da landing page) ─────────────────────────────────────
// A tabela a1_leads é gravável pelo formulário público, mas SÓ legível pela
// service role — por isso a lista vive aqui e não vaza para nenhum cliente.
let LEADS = [];
const LEAD_STATUS = ['novo', 'contatado', 'negociando', 'ganho', 'perdido'];
const LEAD_CORES = {
  novo: '#0E8C7F',
  contatado: '#0891b2',
  negociando: '#F5A524',
  ganho: '#0E8C7F',
  perdido: '#6B827D'
};

async function loadLeads() {
  const box = document.getElementById('leads-list');
  box.innerHTML =
    '<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:.77rem">Carregando...</div>';
  try {
    const res = await fetch(`${saRest('a1_leads')}?order=created_at.desc`, { headers: saHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    LEADS = await res.json();
  } catch (e) {
    box.innerHTML = `<div style="padding:1.5rem;text-align:center;color:#B8433A;font-size:.8rem">Não foi possível carregar os interessados (${esc(e.message)}).</div>`;
    return;
  }
  const n = k => LEADS.filter(l => l.status === k).length;
  setEl('lead-k-total', LEADS.length);
  setEl('lead-k-novo', n('novo'));
  setEl('lead-k-nego', n('negociando'));
  setEl('lead-k-ganho', n('ganho'));
  const badge = document.getElementById('leads-badge');
  if (badge) {
    badge.textContent = n('novo');
    badge.style.display = n('novo') ? '' : 'none';
  }
  renderLeads();
}

function renderLeads() {
  const box = document.getElementById('leads-list');
  const filtro = document.getElementById('lead-filter').value;
  const lista = filtro ? LEADS.filter(l => l.status === filtro) : LEADS;
  if (!lista.length) {
    box.innerHTML =
      '<div style="padding:2.5rem;text-align:center;color:var(--t3);font-size:.8rem">Nenhum interessado por aqui ainda. Divulgue a página <b>/conheca</b> para começar a receber contatos.</div>';
    return;
  }
  box.style.padding = '0';
  box.innerHTML = `<div class="tbl-wrap" style="border:0;box-shadow:none;border-radius:0"><table style="width:100%;border-collapse:collapse;font-size:.8rem">
    <thead><tr style="background:#F4F6F4;color:var(--t3);text-align:left">
      <th style="padding:.6rem .8rem;font-weight:700">Quando</th>
      <th style="padding:.6rem .8rem;font-weight:700">Contato</th>
      <th style="padding:.6rem .8rem;font-weight:700">Empresa</th>
      <th style="padding:.6rem .8rem;font-weight:700">Perfil</th>
      <th style="padding:.6rem .8rem;font-weight:700">Situação</th>
      <th style="padding:.6rem .8rem;font-weight:700"></th>
    </tr></thead><tbody>
    ${lista
      .map(l => {
        const d = new Date(l.created_at);
        const quando = isNaN(d)
          ? '—'
          : d.toLocaleDateString('pt-BR') +
            ' ' +
            d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const zap = (l.phone || '').replace(/\D/g, '');
        return `<tr style="border-top:1px solid var(--border);vertical-align:top">
        <td style="padding:.7rem .8rem;color:var(--t3);white-space:nowrap">${quando}</td>
        <td style="padding:.7rem .8rem">
          <div style="font-weight:700;color:var(--t1)">${esc(l.name)}</div>
          <div style="color:var(--t3);font-size:.74rem;margin-top:.1rem">
            <a href="mailto:${esc(l.email)}" style="color:#0E8C7F">${esc(l.email)}</a>
            ${l.phone ? ` · <a href="https://wa.me/55${zap}" target="_blank" rel="noopener" style="color:#0E8C7F">${esc(l.phone)}</a>` : ''}
          </div>
          ${l.message ? `<div style="color:var(--t2);font-size:.74rem;margin-top:.35rem;max-width:34ch;line-height:1.45">"${esc(l.message)}"</div>` : ''}
        </td>
        <td style="padding:.7rem .8rem;color:var(--t2)">${esc(l.company || '—')}</td>
        <td style="padding:.7rem .8rem;color:var(--t2)">${esc(l.segment || '—')}${l.volume ? `<div style="color:var(--t3);font-size:.72rem">${esc(l.volume)}/mês</div>` : ''}</td>
        <td style="padding:.7rem .8rem">
          <select data-acao-change="setLeadStatus" data-id="${esc(l.id)}" style="font-size:.72rem;padding:.25rem .45rem;border-radius:6px;border:1px solid var(--border);font-weight:700;color:${LEAD_CORES[l.status] || 'var(--t1)'}">
            ${LEAD_STATUS.map(s => `<option value="${s}"${s === l.status ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
          </select>
        </td>
        <td style="padding:.7rem .8rem;text-align:right">
          <button class="btn btn-ghost btn-sm" style="color:#B8433A;border-color:#fecaca" data-acao="deleteLead" data-id="${esc(l.id)}" data-nome="${esc(l.name)}">Excluir</button>
        </td>
      </tr>`;
      })
      .join('')}
  </tbody></table></div>`;
}

async function setLeadStatus(id, status) {
  try {
    const res = await fetch(`${saRest('a1_leads')}?id=eq.${id}`, {
      method: 'PATCH',
      headers: saHeaders(),
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const l = LEADS.find(x => x.id === id);
    if (l) l.status = status;
    toast('Situação atualizada.', 'success');
    loadLeads();
  } catch (e) {
    toast('Não foi possível atualizar: ' + e.message, 'error');
  }
}

async function deleteLead(id, nome) {
  if (!confirm(`Excluir o contato de ${nome}? Isso não pode ser desfeito.`)) return;
  try {
    const res = await fetch(`${saRest('a1_leads')}?id=eq.${id}`, { method: 'DELETE', headers: saHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    toast('Contato excluído.', 'info');
    loadLeads();
  } catch (e) {
    toast('Não foi possível excluir: ' + e.message, 'error');
  }
}

// ═══ Modo manutenção — a chave geral ═════════════════════════════════════════
// O estado mora numa linha só, em a1_manutencao. Quem lê são as duas funções de
// login (que recusam entrada nova) e a tela de cada usuário (que cobre o
// sistema com o aviso). Esta tela é a única que ESCREVE: a tabela não tem
// política de update, então anon e authenticated não conseguem — só a
// service_role, que é quem o superadmin é.
//
// Se esta tela não abrir por qualquer motivo, a saída de emergência é uma linha
// no editor do Supabase:  update a1_manutencao set ativa = false;
function manutPintar(m) {
  const selo = document.getElementById('manut-selo');
  const painel = document.getElementById('manut-painel');
  const det = document.getElementById('manut-detalhe');
  if (!selo) return;

  // `ativa` no banco é a intenção; o que vale é ela E o prazo. Uma chave com
  // `ate` no passado já não segura ninguém, e mostrar "ligada" aqui seria
  // mentir sobre o estado real do sistema.
  const venceu = m && m.ate && new Date(m.ate) <= new Date();
  const ligada = !!(m && m.ativa && !venceu);

  selo.textContent = ligada ? 'Sistema desligado' : 'Sistema no ar';
  selo.style.background = ligada ? '#FEE2E2' : '#DCFCE7';
  selo.style.color = ligada ? '#B91C1C' : '#15803D';
  painel.style.borderLeftColor = ligada ? '#B8433A' : '#6B827D';

  document.getElementById('manut-btn-ligar').style.display = ligada ? 'none' : '';
  document.getElementById('manut-btn-desligar').style.display = ligada ? '' : 'none';

  const partes = [];
  if (ligada) {
    partes.push('Ninguém consegue entrar neste momento.');
    if (m.ate) partes.push(`Volta sozinho em ${new Date(m.ate).toLocaleString('pt-BR')}.`);
    else partes.push('Sem hora de volta — só desligando a chave.');
  } else if (venceu) {
    partes.push('A última manutenção expirou e o sistema já voltou sozinho.');
  }
  if (m && m.ligada_por && ligada) partes.push(`Ligada por ${esc(m.ligada_por)}.`);
  det.innerHTML = partes.join('<br>');
}

function manutParaInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function manutCarregar() {
  try {
    const r = await fetch(`${saRest('a1_manutencao')}?limit=1`, { headers: saHeaders() });
    if (!r.ok) throw new Error('sem tabela');
    const linhas = await r.json();
    const m = Array.isArray(linhas) && linhas[0] ? linhas[0] : { ativa: false };
    document.getElementById('manut-msg').value = m.mensagem || '';
    document.getElementById('manut-ate').value = manutParaInput(m.ate);
    manutPintar(m);
  } catch {
    // Tabela ainda não criada (o SQL não foi rodado). Dizer isso é melhor do
    // que um selo em branco que parece "no ar" sem ninguém ter conferido.
    const selo = document.getElementById('manut-selo');
    if (selo) {
      selo.textContent = 'Não instalado';
      selo.style.background = '#FEF3C7';
      selo.style.color = '#92400E';
    }
    document.getElementById('manut-detalhe').textContent =
      'Rode sql/2026-09-10_modo_manutencao.sql no Supabase para habilitar a chave.';
  }
}

async function manutGravar(corpo, aviso) {
  const r = await fetch(`${saRest('a1_manutencao')}?id=eq.true`, {
    method: 'PATCH',
    headers: saHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({ ...corpo, atualizado_em: new Date().toISOString() })
  });
  if (!r.ok) {
    toast('Não consegui gravar: ' + (await r.text()).slice(0, 140), 'error');
    return;
  }
  const linhas = await r.json().catch(() => []);
  if (Array.isArray(linhas) && linhas[0]) {
    document.getElementById('manut-msg').value = linhas[0].mensagem || '';
    document.getElementById('manut-ate').value = manutParaInput(linhas[0].ate);
    manutPintar(linhas[0]);
  } else {
    await manutCarregar();
  }
  toast(aviso, 'success');
}

async function manutLigar() {
  const msg = document.getElementById('manut-msg').value.trim();
  const ate = document.getElementById('manut-ate').value;
  const ateISO = ate ? new Date(ate).toISOString() : null;

  // Confirmação com a consequência escrita por extenso, e com a hora de volta
  // quando existir. "Tem certeza?" não informa nada a quem já clicou.
  const quando = ateISO
    ? `O sistema volta sozinho em ${new Date(ateISO).toLocaleString('pt-BR')}.`
    : 'SEM hora de volta — vai ficar fora do ar até você desligar a chave aqui.';
  if (
    !confirm(
      `Desligar o sistema para TODOS os clientes agora?\n\n` +
        `Ninguém consegue entrar, e quem está dentro passa a ver o aviso de manutenção.\n` +
        `${quando}\n\nVocê continua com acesso a esta tela.`
    )
  )
    return;

  await manutGravar(
    {
      ativa: true,
      mensagem: msg || null,
      inicio: new Date().toISOString(),
      ate: ateISO,
      ligada_por: 'superadmin'
    },
    'Sistema desligado. Ninguém entra até você reativar.'
  );
}

async function manutDesligar() {
  // Zera `ate` junto: uma chave desligada com prazo velho pendurado é lixo que
  // confunde a próxima leitura.
  await manutGravar({ ativa: false, ate: null }, 'Sistema no ar novamente.');
}

// ─── Logo Upload ──────────────────────────────────────────────────────────────
function initLogoUpload() {
  const saved = localStorage.getItem('a1_platform_logo');
  const preview = document.getElementById('logo-preview');
  const emptyMsg = document.getElementById('logo-empty-msg');
  if (saved) {
    preview.src = saved;
    preview.style.display = 'block';
    emptyMsg.style.display = 'none';
    document.getElementById('logo-clear-btn').style.display = 'inline-flex';
  } else {
    preview.style.display = 'none';
    emptyMsg.style.display = '';
    document.getElementById('logo-clear-btn').style.display = 'none';
  }
  document.getElementById('logo-save-btn').style.display = 'none';
  document.getElementById('logo-pending-data').value = '';
}

function handleLogoFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('logo-file-name').textContent = file.name;
  const reader = new FileReader();
  reader.onload = ev => processLogoImage(ev.target.result);
  reader.readAsDataURL(file);
}

function processLogoImage(dataURL) {
  const img = new Image();
  img.onload = function () {
    const canvas = document.getElementById('logo-canvas');
    const maxH = 200;
    const scale = img.height > maxH ? maxH / img.height : 1;
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (document.getElementById('logo-rm-white').checked) {
      removeWhiteBg(ctx, canvas.width, canvas.height);
    }
    const processed = canvas.toDataURL('image/png');
    const preview = document.getElementById('logo-preview');
    preview.src = processed;
    preview.style.display = 'block';
    document.getElementById('logo-empty-msg').style.display = 'none';
    document.getElementById('logo-pending-data').value = processed;
    document.getElementById('logo-save-btn').style.display = 'inline-flex';
  };
  img.src = dataURL;
}

function removeWhiteBg(ctx, w, h) {
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i],
      g = d[i + 1],
      b = d[i + 2];
    if (r > 200 && g > 200 && b > 200) {
      // Gradual fade: the whiter the pixel the more transparent
      const whiteness = Math.min(r, g, b);
      d[i + 3] = Math.round(Math.max(0, (255 - whiteness) * 3.5));
    }
  }
  ctx.putImageData(id, 0, 0);
}

function saveLogoUpload() {
  const data = document.getElementById('logo-pending-data').value;
  if (!data) {
    toast('Selecione uma imagem primeiro.', 'error');
    return;
  }
  localStorage.setItem('a1_platform_logo', data);
  document.getElementById('logo-clear-btn').style.display = 'inline-flex';
  toast('Logo salva! Recarregue as outras páginas para ver.', 'success');
}

function clearLogoUpload() {
  localStorage.removeItem('a1_platform_logo');
  const preview = document.getElementById('logo-preview');
  preview.src = '';
  preview.style.display = 'none';
  document.getElementById('logo-empty-msg').style.display = '';
  document.getElementById('logo-save-btn').style.display = 'none';
  document.getElementById('logo-clear-btn').style.display = 'none';
  document.getElementById('logo-pending-data').value = '';
  document.getElementById('logo-file-input').value = '';
  document.getElementById('logo-file-name').textContent = 'PNG, SVG, JPG ou WebP';
  toast('Logo removida. Padrão restaurado.', 'info');
}

// ─── Load all ─────────────────────────────────────────────────────────────────

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

async function loadAll() {
  await Promise.all([loadTenants(), loadAllModules(), loadPlans(), loadLeads().catch(() => {})]);
  updateKPIs();
  populateTenantSelect();
}

async function loadTenants() {
  const data = await fetch(saRest('a1_tenants') + '?order=created_at.desc', { headers: saHeaders() }).then(
    r => r.json()
  );
  TENANTS = Array.isArray(data) ? data : [];
  renderTenantsTable(TENANTS);
  document.getElementById('sa-tenant-count').textContent = `${TENANTS.length} clientes`;
  autoCobrancaCheck();
}

async function loadAllModules() {
  const data = await fetch(saRest('a1_tenant_modules') + '?order=unlocked_at.desc', {
    headers: saHeaders()
  }).then(r => r.json());
  ALL_MODULES = Array.isArray(data) ? data : [];
  renderAllModulesTable();
  // A coluna "Módulos ativos" da lista de clientes lê ALL_MODULES, e as duas
  // cargas saem JUNTAS num Promise.all. Clientes são três linhas e chegavam
  // primeiro: a tabela desenhava com ALL_MODULES ainda vazio e todo cliente
  // saía "nenhum" — inclusive os que têm Pré-análise e Venda ligadas. Não era
  // licença faltando, era ordem de chegada.
  //
  // Redesenhar aqui conserta os dois lados: a corrida da carga inicial e a
  // coluna que também não acompanhava depois de ligar ou revogar um módulo.
  if (TENANTS.length) renderTenantsTable(TENANTS);
}

async function loadPlans() {
  const data = await fetch(saRest('a1_plans'), { headers: saHeaders() })
    .then(r => r.json())
    .catch(() => []);
  PLANS = Array.isArray(data) ? data : [];
  document.getElementById('plans-tbody').innerHTML =
    Array.isArray(data) && data.length
      ? data
          .map(
            p => `<tr>
        <td><span class="mono">${esc(p.key)}</span></td>
        <td>${esc(p.name)}</td>
        <td>${p.max_users}</td>
        <td>${p.price_brl > 0 ? 'R$ ' + Number(p.price_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : 'Gratuito'}</td>
      </tr>`
          )
          .join('')
      : '<tr><td colspan="4" style="padding:1.5rem;text-align:center;color:var(--t3)">Nenhum plano cadastrado. Insira na tabela a1_plans.</td></tr>';
}

function updateKPIs() {
  setEl('kpi-total', TENANTS.length);
  setEl('kpi-ativos', TENANTS.filter(t => t.status === 'active').length);
  setEl('kpi-trial', TENANTS.filter(t => t.status === 'trial').length);
  setEl('kpi-susp', TENANTS.filter(t => t.status === 'suspended').length);
}

// ─── Tenants table ────────────────────────────────────────────────────────────
let _filtered = [];
function renderTenantsTable(list) {
  _filtered = list;
  const tbody = document.getElementById('tenant-tbody');
  if (!list.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" style="padding:2rem;text-align:center;color:var(--t3)">Nenhum cliente cadastrado.</td></tr>';
    return;
  }
  const TIPO_LABELS = {
    construtora: 'Construtora',
    imobiliaria: 'Imobiliária',
    correspondente_bancario: 'Correspondente',
    despachante: 'Despachante'
  };
  tbody.innerHTML = list
    .map(t => {
      const tenantMods = ALL_MODULES.filter(m => m.tenant_id === t.id);
      const statusCls =
        t.status === 'active' ? 'badge-green' : t.status === 'trial' ? 'badge-amber' : 'badge-red';
      const tipoLabel = TIPO_LABELS[t.tipo_cliente] || '—';
      return `<tr>
      <td><span style="font-weight:700">${esc(t.name)}</span></td>
      <td><span class="mono">${esc(t.slug)}</span></td>
      <td><span style="font-size:.72rem;font-weight:600;color:var(--t2)">${tipoLabel}</span></td>
      <td><span class="badge badge-gray">${esc(t.plan_key)}</span></td>
      <td>
        <input type="number" value="${t.max_users}" min="1" style="width:4rem;border:1px solid var(--border);border-radius:4px;padding:.2rem .4rem;font-size:.75rem;text-align:center"
               data-acao-change="setUserLimit" data-tenant-id="${esc(t.id)}">
      </td>
      <td><span class="badge ${statusCls}">${t.status}</span></td>
      <td style="font-size:.73rem;color:var(--t3)">${t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString('pt-BR') : '—'}</td>
      <td>
        <div style="display:flex;flex-wrap:wrap;gap:.25rem">
          ${tenantMods.map(m => `<span class="badge badge-emerald">${esc(m.module_key)}</span>`).join('') || '<span style="color:var(--t3);font-size:.72rem">nenhum</span>'}
        </div>
      </td>
      <td>
        <div style="display:flex;gap:.3rem;flex-wrap:wrap">
          <button class="btn btn-xs" style="background:#0E8C7F;color:#fff"
            title="${t.status === 'suspended' ? 'Acessar em modo suporte — cliente suspenso' : 'Acessar cliente'}"
            data-acao="accessTenant" data-tenant-id="${esc(t.id)}" data-slug="${esc(t.slug)}" data-tenant-name="${esc(t.name)}">Acessar</button>
          <button class="btn btn-primary btn-xs" data-acao="openUsersModal" data-tenant-id="${esc(t.id)}" data-tenant-name="${esc(t.name)}" title="Usuários">Usuários</button>
          <button class="btn btn-ghost btn-xs" data-acao="changePlan" data-tenant-id="${esc(t.id)}">Plano</button>
          <button class="btn btn-ghost btn-xs" style="color:#7c3aed;border-color:#e0e7ff" data-acao="openContrato" data-tenant-id="${esc(t.id)}">Contrato</button>
          <button class="btn btn-ghost btn-xs" style="color:#0d9488;border-color:#ccfbf1" data-acao="openCobranca" data-tenant-id="${esc(t.id)}" data-name="${esc(t.name)}" data-email="${esc(t.email || '')}">Cobrança<span id="cob-hint-${t.id}" style="margin-left:.3rem;font-size:.62rem;font-weight:700"></span></button>
          ${
            t.status !== 'suspended'
              ? `<button class="btn btn-danger btn-xs" data-acao="suspendTenant" data-tenant-id="${esc(t.id)}">Suspender</button>`
              : `<button class="btn btn-warn btn-xs" data-acao="reactivateTenant" data-tenant-id="${esc(t.id)}">Reativar</button>`
          }
          <button class="btn btn-danger btn-xs" style="background:#7f1d1d;color:#fff;border-color:#991b1b" data-acao="deleteTenant" data-tenant-id="${esc(t.id)}" data-tenant-name="${esc(t.name)}">Excluir</button>
        </div>
      </td>
    </tr>`;
    })
    .join('');
}

function filterTenants() {
  const q = document.getElementById('tenant-search').value.toLowerCase();
  const list = q
    ? TENANTS.filter(t => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q))
    : TENANTS;
  renderTenantsTable(list);
}

function populateTenantSelect() {
  const sel = document.getElementById('mod-tenant');
  const cur = sel.value;
  sel.innerHTML =
    '<option value="">Selecione um cliente...</option>' +
    TENANTS.map(t => `<option value="${t.id}">${esc(t.name)} (${t.slug})</option>`).join('');
  if (cur) sel.value = cur;
}

// ─── Modules ──────────────────────────────────────────────────────────────────
function loadTenantModulesFor() {
  const tenantId = document.getElementById('mod-tenant').value;
  if (!tenantId) {
    document.getElementById('mod-grid-wrap').innerHTML =
      '<div style="text-align:center;padding:3rem;color:var(--t3);font-size:.82rem">Selecione um cliente para gerenciar os módulos.</div>';
    return;
  }
  const tenant = TENANTS.find(t => t.id === tenantId);
  const activeKeys = new Set(ALL_MODULES.filter(m => m.tenant_id === tenantId).map(m => m.module_key));
  const tipo = tenant?.tipo_cliente;
  // Mostra apenas módulos ofertáveis para o tipo de cliente (ex.: CRM não aparece para Correspondente)
  const mods = MODULES_DEF.filter(mod => !mod.types || !tipo || mod.types.includes(tipo));

  document.getElementById('mod-grid-wrap').innerHTML = `
    <div style="font-size:.78rem;font-weight:700;margin-bottom:.75rem">
      Módulos de <strong>${esc(tenant?.name || tenantId)}</strong>
    </div>
    <div class="mod-grid">
      ${mods
        .map(mod => {
          const isActive = activeKeys.has(mod.key);
          const activeRow = ALL_MODULES.find(m => m.tenant_id === tenantId && m.module_key === mod.key);
          const expiryStr = activeRow?.expires_at
            ? `Expira: ${new Date(activeRow.expires_at).toLocaleDateString('pt-BR')}`
            : activeRow
              ? 'Permanente'
              : '';
          return `<div class="mod-card ${isActive ? 'active-mod' : ''}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.35rem">
            <span class="badge ${isActive ? 'badge-emerald' : 'badge-gray'}">${isActive ? 'Ativo' : 'Inativo'}</span>
          </div>
          <div class="mod-name">${esc(mod.name)}</div>
          <div class="mod-key">${esc(mod.key)}</div>
          <div class="mod-desc">${esc(mod.desc)}</div>
          ${avisoDependencia(mod, activeKeys)}
          ${expiryStr ? `<div style="font-size:.68rem;color:var(--t3);margin-bottom:.45rem">${expiryStr}</div>` : ''}
          <div class="mod-actions">
            ${
              isActive
                ? `<button class="btn btn-danger btn-xs" data-acao="lockModuleFor" data-tenant-id="${esc(tenantId)}" data-module-key="${esc(mod.key)}">Revogar</button>`
                : `<button class="btn btn-primary btn-xs" data-acao="unlockModuleFor" data-tenant-id="${esc(tenantId)}" data-module-key="${esc(mod.key)}">Liberar</button>`
            }
          </div>
        </div>`;
        })
        .join('')}
    </div>`;
}

async function unlockModuleFor(tenantId, moduleKey) {
  // When enabling Registro for a Correspondente Bancário, ask for despachante limit first
  if (moduleKey === 'registro') {
    const tenant = TENANTS.find(t => t.id === tenantId);
    if (tenant && tenant.tipo_cliente === 'correspondente_bancario') {
      openDespLimitModal(tenantId, moduleKey);
      return;
    }
  }
  await _doUnlockModule(tenantId, moduleKey);
  toast(`Módulo "${moduleKey}" liberado.`, 'success');
}

async function lockModuleFor(tenantId, moduleKey) {
  if (!confirm(`Revogar acesso ao módulo "${moduleKey}"?`)) return;
  const res = await fetch(
    `${saRest('a1_tenant_modules')}?tenant_id=eq.${tenantId}&module_key=eq.${moduleKey}`,
    {
      method: 'DELETE',
      headers: saHeaders()
    }
  );
  if (res.ok) {
    toast(`Módulo "${moduleKey}" revogado.`, 'warn');
    await loadAllModules();
    loadTenantModulesFor();
    renderTenantsTable(TENANTS);
  } else {
    toast('Erro ao revogar módulo.', 'error');
  }
}

function renderAllModulesTable() {
  const tbody = document.getElementById('all-modules-tbody');
  tbody.innerHTML = ALL_MODULES.length
    ? ALL_MODULES.map(r => {
        const t = TENANTS.find(x => x.id === r.tenant_id);
        return `<tr>
          <td><span style="font-weight:600">${esc(t?.name || r.tenant_id?.slice(0, 8) || '—')}</span></td>
          <td><span class="badge badge-emerald">${esc(r.module_key)}</span></td>
          <td class="mono" style="font-size:.72rem">${new Date(r.unlocked_at).toLocaleString('pt-BR')}</td>
          <td style="color:${r.expires_at ? '#C87E12' : '#0B7568'};font-size:.73rem;font-weight:600">
            ${r.expires_at ? new Date(r.expires_at).toLocaleDateString('pt-BR') : 'Permanente'}
          </td>
          <td style="font-size:.72rem;color:var(--t3)">${esc(r.unlocked_by || '—')}</td>
          <td>
            <button class="btn btn-danger btn-xs" data-acao="lockModuleFor" data-tenant-id="${esc(r.tenant_id)}" data-module-key="${esc(r.module_key)}">Revogar</button>
          </td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="6" style="padding:1.5rem;text-align:center;color:var(--t3)">Nenhum módulo liberado manualmente.</td></tr>';
}

// ─── Password hash ────────────────────────────────────────────────────────────
async function saHash(plain) {
  const enc = new TextEncoder().encode(plain + '::a1');
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Tenant CRUD ──────────────────────────────────────────────────────────────
async function createTenant() {
  const name = document.getElementById('n-name').value.trim();
  const slug = document
    .getElementById('n-slug')
    .value.trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  const email = document.getElementById('n-email').value.trim();
  const plan = document.getElementById('n-plan').value;
  const cnpj = document.getElementById('n-cnpj').value.trim();
  const tipo = document.getElementById('n-tipo').value;
  const trialDays = parseInt(document.getElementById('n-trial').value) || 0;
  const ownerName = document.getElementById('n-owner-name').value.trim();
  const ownerCpf = document.getElementById('n-owner-cpf').value.replace(/\D/g, '');
  const ownerPw = document.getElementById('n-owner-pw').value;
  const errEl = document.getElementById('n-err');

  errEl.style.display = 'none';
  if (!name || !slug || !email) {
    nErr('Preencha nome, slug e e-mail.');
    return;
  }
  if (!ownerName || !ownerCpf || !ownerPw) {
    nErr('Preencha os dados do usuário owner.');
    return;
  }
  if (ownerPw.length < 6) {
    nErr('Senha mínima: 6 caracteres.');
    return;
  }

  const maxMap = { starter: 3, pro: 10, enterprise: 30 };
  let maxUsers = maxMap[plan];
  if (plan === 'custom') {
    maxUsers = parseInt(document.getElementById('n-custom-limit').value);
    if (!maxUsers || maxUsers < 1) {
      nErr('Informe o limite de usuários para o plano customizado.');
      return;
    }
  }
  const tenantPayload = {
    name,
    slug,
    email,
    cnpj,
    plan_key: plan,
    tipo_cliente: tipo,
    max_users: maxUsers,
    status: trialDays > 0 ? 'trial' : 'active'
  };
  if (trialDays > 0) {
    tenantPayload.trial_ends_at = new Date(Date.now() + trialDays * 86400000).toISOString();
  }

  const tenantRes = await fetch(saRest('a1_tenants'), {
    method: 'POST',
    headers: saHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(tenantPayload)
  });

  if (!tenantRes.ok) {
    const err = await tenantRes.json();
    nErr(err?.message?.includes('unique') ? 'Slug já em uso.' : `Erro: ${err?.message}`);
    return;
  }

  const [tenant] = await tenantRes.json();
  const hash = await saHash(ownerPw);
  const userRes = await fetch(saRest('a1_users'), {
    method: 'POST',
    headers: saHeaders(),
    body: JSON.stringify({
      tenant_id: tenant.id,
      name: ownerName,
      cpf: ownerCpf,
      password_hash: hash,
      role: 'owner',
      is_active: true
    })
  });

  if (!userRes.ok) {
    toast(`Tenant criado, mas erro ao criar owner. Use botão Usuários para criar manualmente.`, 'warn');
  } else {
    toast(
      `Cliente "${name}" criado! Login: /${slug}/login | CPF: ${document.getElementById('n-owner-cpf').value}`,
      'success'
    );
  }

  ['n-name', 'n-slug', 'n-email', 'n-cnpj', 'n-owner-name', 'n-owner-cpf', 'n-owner-pw'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('n-tipo').value = 'construtora';
  document.getElementById('n-plan').value = 'starter';
  document.getElementById('n-custom-limit').value = '';
  document.getElementById('n-custom-limit-wrap').style.display = 'none';
  await loadAll();
}

function toggleCustomLimit() {
  const isCustom = document.getElementById('n-plan').value === 'custom';
  document.getElementById('n-custom-limit-wrap').style.display = isCustom ? '' : 'none';
  if (!isCustom) document.getElementById('n-custom-limit').value = '';
}

function nErr(msg) {
  const el = document.getElementById('n-err');
  el.textContent = msg;
  el.style.display = 'block';
}

async function changePlan(tenantId) {
  const plan = prompt('Novo plano (starter / pro / enterprise / custom):');
  if (!['starter', 'pro', 'enterprise', 'custom'].includes(plan)) {
    toast('Plano inválido.', 'error');
    return;
  }
  const maxMap = { starter: 3, pro: 10, enterprise: 30, custom: 999 };
  await fetch(`${saRest('a1_tenants')}?id=eq.${tenantId}`, {
    method: 'PATCH',
    headers: saHeaders(),
    body: JSON.stringify({ plan_key: plan, max_users: maxMap[plan], status: 'active' })
  });
  toast('Plano atualizado.', 'success');
  await loadTenants();
  updateKPIs();
}

async function deleteTenant(tenantId, tenantName) {
  const confirm1 = confirm(
    `Excluir o cliente "${tenantName}"?\n\nTodos os usuários, dados e módulos serão removidos permanentemente. Esta ação NÃO pode ser desfeita.`
  );
  if (!confirm1) return;
  const typed = prompt(`Para confirmar, digite exatamente o nome do cliente:\n\n${tenantName}`);
  if (typed !== tenantName) {
    toast('Nome não confere. Exclusão cancelada.', 'error');
    return;
  }

  try {
    // Remove dados dependentes antes do tenant (ordem importa por FK)
    await Promise.all([
      fetch(`${saRest('a1_users')}?tenant_id=eq.${tenantId}`, { method: 'DELETE', headers: saHeaders() }),
      fetch(`${saRest('a1_partners')}?tenant_id=eq.${tenantId}`, { method: 'DELETE', headers: saHeaders() }),
      fetch(`${saRest('a1_tenant_modules')}?tenant_id=eq.${tenantId}`, {
        method: 'DELETE',
        headers: saHeaders()
      })
    ]);
    const res = await fetch(`${saRest('a1_tenants')}?id=eq.${tenantId}`, {
      method: 'DELETE',
      headers: saHeaders()
    });
    if (res.ok || res.status === 204) {
      toast(`Cliente "${tenantName}" excluído permanentemente.`, 'info');
      await loadAll();
    } else {
      toast('Erro ao excluir cliente.', 'error');
    }
  } catch {
    toast('Erro ao excluir cliente.', 'error');
  }
}

async function suspendTenant(tenantId) {
  if (!confirm('Suspender este cliente? O acesso será bloqueado imediatamente.')) return;
  const res = await fetch(`${saRest('a1_tenants')}?id=eq.${tenantId}`, {
    method: 'PATCH',
    headers: saHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({ status: 'suspended' })
  });
  if (!res.ok) {
    const erro = await res.json().catch(() => ({}));
    toast('Não foi possível suspender: ' + (erro.message || `HTTP ${res.status}`), 'error');
    return;
  }
  const alterados = await res.json().catch(() => []);
  if (!alterados.length || alterados[0].status !== 'suspended') {
    toast('A suspensão não foi confirmada pelo banco.', 'error');
    return;
  }
  toast('Conta suspensa.', 'warn');
  await loadTenants();
  updateKPIs();
}

async function reactivateTenant(tenantId) {
  await fetch(`${saRest('a1_tenants')}?id=eq.${tenantId}`, {
    method: 'PATCH',
    headers: saHeaders(),
    body: JSON.stringify({ status: 'active' })
  });
  toast('Conta reativada.', 'success');
  await loadTenants();
  updateKPIs();
}

async function setUserLimit(tenantId, val) {
  await fetch(`${saRest('a1_tenants')}?id=eq.${tenantId}`, {
    method: 'PATCH',
    headers: saHeaders(),
    body: JSON.stringify({ max_users: parseInt(val) })
  });
  toast('Limite atualizado.', 'success');
}

// ─── Users modal ──────────────────────────────────────────────────────────────
let ACTIVE_TENANT_ID = null;

async function openUsersModal(tenantId, tenantName) {
  ACTIVE_TENANT_ID = tenantId;
  document.getElementById('um-tenant-name').textContent = tenantName;
  ['um-name', 'um-cpf', 'um-pw'].forEach(id => (document.getElementById(id).value = ''));
  document.getElementById('um-err').style.display = 'none';
  openModal('modal-users');
  await loadTenantUsers();
}

// A janela mostrava só a1_users — os gestores. Correspondente, analista e
// corretor vivem em a1_partners e ficavam invisíveis aqui, que é justamente
// onde estão quase todos os problemas relatados pelos clientes. Agora aparecem
// os dois, cada um com o botão de entrar como ele.
async function loadTenantUsers() {
  const [users, partners] = await Promise.all([
    fetch(`${saRest('a1_users')}?tenant_id=eq.${ACTIVE_TENANT_ID}&order=created_at.asc`, {
      headers: saHeaders()
    })
      .then(r => r.json())
      .catch(() => []),
    fetch(
      `${saRest('a1_partners')}?tenant_id=eq.${ACTIVE_TENANT_ID}&select=id,name,cpf,type,is_active,approved&order=name.asc`,
      { headers: saHeaders() }
    )
      .then(r => r.json())
      .catch(() => [])
  ]);

  const t = TENANTS.find(x => x.id === ACTIVE_TENANT_ID) || {};
  const botaoAcessar = (id, papel, nome) =>
    t.slug
      ? `<button class="btn btn-xs" style="background:#0d9488;color:#fff"
        title="Abrir o sistema numa aba nova, com a sessão desta pessoa"
        data-acao="acessarComo" data-tenant-id="${esc(ACTIVE_TENANT_ID)}" data-slug="${esc(t.slug)}" data-tenant-name="${esc(t.name)}" data-user-id="${esc(id)}" data-papel="${esc(papel)}" data-nome="${esc(nome)}">Acessar</button>`
      : '';

  const linhasUsuarios = (Array.isArray(users) ? users : [])
    // Fora os usuários-sombra. a1_partner_login cria, para cada parceiro que
    // entra, uma linha em a1_users com o mesmo CPF e role='partner' — é ela que
    // a sessão referencia. Listada aqui, a mesma pessoa aparecia DUAS vezes: uma
    // como "gestor" de papel partner e outra na família de parceiros logo abaixo.
    // Pior que confundir: a linha do sombra oferecia "Excluir", e apagá-la
    // arrebentaria o vínculo entre o login do parceiro e a sessão dele.
    .filter(u => u.role !== 'partner')
    .map(
      u => `<tr>
      <td style="font-weight:600">${esc(u.name)}</td>
      <td class="mono">${esc(u.cpf || '—')}</td>
      <td><span class="badge badge-gray">${esc(u.role)}</span></td>
      <td>${u.is_active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-red">Inativo</span>'}</td>
      <td style="display:flex;gap:.3rem;flex-wrap:wrap">
        ${botaoAcessar(u.id, u.role, u.name)}
        <button class="btn btn-ghost btn-xs" data-acao="toggleUser" data-user-id="${esc(u.id)}" data-current="${esc(u.is_active)}">${u.is_active ? 'Desativar' : 'Ativar'}</button>
        <button class="btn btn-ghost btn-xs" data-acao="resetPw" data-user-id="${esc(u.id)}">Senha</button>
        <button class="btn btn-danger btn-xs" data-acao="deleteUser" data-user-id="${esc(u.id)}" data-user-name="${esc(u.name)}">Excluir</button>
      </td>
    </tr>`
    )
    .join('');

  const ROTULO = {
    cca: 'correspondente',
    analista: 'analista',
    corretor: 'corretor',
    despachante: 'despachante',
    imobiliaria: 'imobiliária',
    coordenador: 'coordenador'
  };
  const linhasParceiros = (Array.isArray(partners) ? partners : [])
    // imobiliária e coordenador são cadastro, não gente que entra no sistema
    .filter(p => !['imobiliaria', 'coordenador'].includes(p.type))
    .map(
      p => `<tr>
      <td style="font-weight:600">${esc(p.name)}</td>
      <td class="mono">${esc(p.cpf || '—')}</td>
      <td><span class="badge badge-gray">${esc(ROTULO[p.type] || p.type || 'parceiro')}</span></td>
      <td>${
        p.is_active === false
          ? '<span class="badge badge-red">Inativo</span>'
          : p.approved === false
            ? '<span class="badge badge-gray">Aguardando</span>'
            : '<span class="badge badge-green">Ativo</span>'
      }</td>
      <td style="display:flex;gap:.3rem;flex-wrap:wrap">
        ${botaoAcessar(p.id, 'partner', p.name)}
      </td>
    </tr>`
    )
    .join('');

  const cab = (txt, n) => `<tr><td colspan="5" style="padding:.45rem .6rem;background:#F1F5F9;
      font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--t3)">
      ${txt} · ${n}</td></tr>`;

  const html =
    linhasUsuarios || linhasParceiros
      ? (linhasUsuarios ? cab('Gestores e administradores', (users || []).length) + linhasUsuarios : '') +
        (linhasParceiros
          ? cab('Correspondentes, analistas e corretores', linhasParceiros.split('<tr>').length - 1) +
            linhasParceiros
          : '')
      : '<tr><td colspan="5" style="padding:1.5rem;text-align:center;color:var(--t3)">Nenhum usuário. Crie o primeiro acima.</td></tr>';

  document.getElementById('um-tbody').innerHTML = html;
}

async function createUserForTenant() {
  const name = document.getElementById('um-name').value.trim();
  const cpf = document.getElementById('um-cpf').value.replace(/\D/g, '');
  const pw = document.getElementById('um-pw').value;
  const role = document.getElementById('um-role').value;
  const errEl = document.getElementById('um-err');
  errEl.style.display = 'none';
  if (!name || !cpf || !pw) {
    errEl.textContent = 'Preencha todos os campos.';
    errEl.style.display = 'block';
    return;
  }
  if (pw.length < 6) {
    errEl.textContent = 'Senha mínima: 6 caracteres.';
    errEl.style.display = 'block';
    return;
  }
  const hash = await saHash(pw);
  const res = await fetch(saRest('a1_users'), {
    method: 'POST',
    headers: saHeaders(),
    body: JSON.stringify({
      tenant_id: ACTIVE_TENANT_ID,
      name,
      cpf,
      password_hash: hash,
      role,
      is_active: true
    })
  });
  if (res.ok) {
    toast('Usuário criado.', 'success');
    ['um-name', 'um-cpf', 'um-pw'].forEach(id => (document.getElementById(id).value = ''));
    loadTenantUsers();
  } else {
    const err = await res.json();
    errEl.textContent = err?.message?.includes('unique')
      ? 'CPF já cadastrado neste cliente.'
      : 'Erro ao criar.';
    errEl.style.display = 'block';
  }
}

async function toggleUser(userId, current) {
  await fetch(`${saRest('a1_users')}?id=eq.${userId}`, {
    method: 'PATCH',
    headers: saHeaders(),
    body: JSON.stringify({ is_active: !current })
  });
  toast(current ? 'Usuário desativado.' : 'Usuário ativado.', 'success');
  loadTenantUsers();
}

async function deleteUser(userId, userName) {
  if (!confirm(`Excluir permanentemente "${userName}"?\n\nEsta ação não pode ser desfeita.`)) return;
  const res = await fetch(`${saRest('a1_users')}?id=eq.${userId}`, {
    method: 'DELETE',
    headers: saHeaders()
  });
  if (res.ok || res.status === 204) {
    toast(`Usuário "${userName}" excluído.`, 'info');
    loadTenantUsers();
  } else {
    toast('Erro ao excluir usuário.', 'error');
  }
}

async function resetPw(userId) {
  const pw = prompt('Nova senha (mínimo 6 caracteres):');
  if (!pw || pw.length < 6) {
    toast('Senha inválida.', 'error');
    return;
  }
  const hash = await saHash(pw);
  await fetch(`${saRest('a1_users')}?id=eq.${userId}`, {
    method: 'PATCH',
    headers: saHeaders(),
    body: JSON.stringify({ password_hash: hash })
  });
  toast('Senha redefinida.', 'success');
}

// ─── Superadmin Impersonation ─────────────────────────────────────────────────
// Cria a sessão diretamente com a Service Role Key (ignora RLS por natureza) em
// vez de fingir um login real via a1_login. Isso evita dois problemas do método
// antigo: (1) a1_login aplica o limite de acessos simultâneos do PLANO do
// cliente — suporte nunca deveria ficar bloqueado pela própria licença do
// cliente; (2) a troca temporária de senha do usuário, que se algo falhasse no
// meio do caminho arriscava deixar a senha do cliente trocada.
// Entrar como o gestor do cliente. É o atalho do dia a dia; para entrar como
// uma pessoa específica, o botão "Acessar" de cada linha na janela de usuários.
async function accessTenant(tenantId, slug, tenantName) {
  const users = await fetch(
    `${saRest('a1_users')}?tenant_id=eq.${tenantId}&is_active=eq.true&order=created_at.asc&limit=10`,
    { headers: saHeaders() }
  )
    .then(r => r.json())
    .catch(() => []);
  const owner = users.find(u => u.role === 'owner') || users.find(u => u.role === 'admin') || users[0];
  if (!owner) {
    toast('Nenhum usuário ativo encontrado neste cliente.', 'error');
    return;
  }
  return acessarComo(tenantId, slug, tenantName, owner.id, owner.role, owner.name);
}

// Abre uma sessão como QUALQUER pessoa do cliente — gestor, correspondente,
// analista ou corretor. Problema de cliente quase nunca é do sistema inteiro:
// é daquele usuário, com aquelas permissões, naquela tela. Entrar como o gestor
// para investigar o corretor mostra justamente o que não se quer ver.
//
// papel === 'partner' significa que o id é de a1_partners, e aí a sessão do
// navegador precisa carregar type/permissions — sem isso a pessoa entraria com
// permissão vazia e a investigação diria a coisa errada.
async function acessarComo(tenantId, slug, tenantName, userId, papel, nome) {
  toast(`Abrindo "${tenantName}" como ${nome}...`, 'info');
  try {
    let extra = {};
    // O id que vai para a SESSÃO nem sempre é o id que veio da lista.
    //
    // a1_sessions.user_id tem chave estrangeira para a1_users. Um corretor ou
    // correspondente NÃO tem linha lá: ele vive em a1_partners. Mandar o id de
    // parceiro direto era o que devolvia 409 Conflict — o Postgres recusando
    // uma referência que não existe do outro lado.
    //
    // O login de verdade resolve isso criando um "usuário-sombra" em a1_users
    // com o mesmo CPF, e é o id DELE que vai para a sessão (ver
    // a1_partner_login em sql/2026-08-24_sessao_unica_e_limite.sql). Aqui se
    // faz o mesmo, para a sessão de suporte ser idêntica à que a pessoa teria.
    let idSessao = userId;
    if (papel === 'partner') {
      const [pt] = await fetch(
        `${saRest('a1_partners')}?id=eq.${userId}&select=name,type,permissions,developments,region,cpf,password_hash,tenant_id`,
        { headers: saHeaders() }
      )
        .then(r => r.json())
        .catch(() => []);
      if (!pt) throw new Error('Usuário não encontrado em a1_partners.');
      extra = {
        type: pt.type,
        permissions: pt.permissions || {},
        developments: pt.developments,
        region: pt.region
      };

      const cpf = String(pt.cpf || '').replace(/\D/g, '');
      if (!cpf) {
        // Não é limitação do suporte: é que a1_partner_login procura o parceiro
        // PELO CPF. Sem CPF esta pessoa não consegue entrar no sistema de jeito
        // nenhum, e não há sessão dela para reproduzir.
        throw new Error(
          'Este cadastro não tem CPF, então não tem login. ' +
            'Cadastre o CPF em Configurações › Corretores para que ele possa entrar.'
        );
      }

      const [sombra] = await fetch(
        `${saRest('a1_users')}?tenant_id=eq.${pt.tenant_id || tenantId}&cpf=eq.${cpf}&select=id`,
        { headers: saHeaders() }
      )
        .then(r => r.json())
        .catch(() => []);

      if (sombra) {
        idSessao = sombra.id;
      } else {
        // Parceiro que nunca entrou ainda não tem sombra. Cria igual ao login,
        // inclusive o hash: assim, quando ele entrar de verdade, encontra a
        // mesma linha em vez de uma duplicada.
        const criado = await fetch(saRest('a1_users'), {
          method: 'POST',
          headers: { ...saHeaders(), Prefer: 'return=representation' },
          body: JSON.stringify({
            tenant_id: pt.tenant_id || tenantId,
            name: pt.name,
            cpf,
            password_hash: pt.password_hash || '',
            role: 'partner',
            is_active: true
          })
        })
          .then(r => (r.ok ? r.json() : []))
          .catch(() => []);
        if (!criado[0]) throw new Error('Não foi possível preparar a sessão deste parceiro.');
        idSessao = criado[0].id;
      }
    }

    const res = await fetch(saRest('a1_sessions'), {
      method: 'POST',
      headers: { ...saHeaders(), Prefer: 'return=representation' },
      // origem 'suporte' tira esta visita da conta de acessos do cliente no
      // Monitor E do teto de acessos simultâneos. Sem isso, o nosso próprio
      // suporte ocuparia uma vaga paga e poderia trancar um usuário de verdade
      // para fora — ver a1_ativos em sql/2026-09-08_suporte_nao_ocupa_vaga.sql.
      body: JSON.stringify({ tenant_id: tenantId, user_id: idSessao, role: papel, origem: 'suporte' })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Falha ao criar sessão (HTTP ${res.status})`);
    }
    const [session] = await res.json();
    if (!session || !session.token) throw new Error('Sessão criada sem token.');

    localStorage.setItem('a1_token', session.token);
    localStorage.setItem('a1_slug', slug);
    localStorage.setItem(
      'a1_user',
      JSON.stringify({
        id: userId,
        name: nome,
        role: papel,
        tenant_id: tenantId,
        tenant_name: tenantName,
        plan: 'enterprise',
        max_users: 9999,
        status: (TENANTS.find(t => t.id === tenantId) || {}).status || 'active',
        trial_ends_at: null,
        ...extra
      })
    );
    // Pop-up de aviso não pode atrapalhar quem entrou para investigar.
    try {
      localStorage.removeItem('a1_avisos_vistos');
    } catch {}

    // Marca a aba como sessão de suporte. auth.js já tinha o bypass do guard de
    // módulo ("a1_sa_mode"), mas NADA no sistema definia essa chave — o bypass
    // nascera morto, e o superadmin era barrado como um usuário comum. A aba
    // aberta por window.open herda uma cópia deste sessionStorage.
    try {
      sessionStorage.setItem('a1_sa_mode', '1');
      // limpa cache de módulo herdado (evita levar estado velho para a nova aba)
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && (k.indexOf('a1_mod2_') === 0 || k.indexOf('a1_mod_') === 0)) sessionStorage.removeItem(k);
      }
    } catch {}

    // ABRE PELA GERAL, como qualquer login. Aqui havia uma escolha própria — o
    // primeiro módulo licenciado, na ordem do tipo de cliente — e era ela que
    // fazia o superadmin cair sempre no Repasse ao acessar um cliente. Duas
    // regras para a mesma pergunta ("por onde o sistema abre?") divergem no
    // primeiro ajuste, e foi o que aconteceu: o login passou a abrir na Geral e
    // este ficou para trás. A regra é uma só, e é a do login.
    //
    // O despachante continua sendo a exceção, pelo mesmo motivo de lá: o
    // Registro é o único módulo dele.
    // `extra.type` já foi lido de a1_partners logo acima, nesta mesma função —
    // é o tipo REAL da pessoa, e não um palpite a partir da lista da tela.
    const _home = extra && extra.type === 'despachante' ? 'registro' : 'geral';
    window.open(`/${slug}/${_home}`, '_blank');
    toast(`Sessão aberta como ${nome} (${tenantName}).`, 'success');
  } catch (e) {
    toast('Erro ao acessar cliente: ' + (e.message || 'desconhecido'), 'error');
  }
}

function setEl(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

// ─── Cobrança (billing) ────────────────────────────────────────────────────────
// Dados por tenant ficam em a1_config key='billing':
//   { due_day, valor, notified:{'YYYY-MM':iso},
//     paid:{'YYYY-MM':{paid:true,date:iso}}   → mês pago
//              ou {atraso:true,desde:iso}     → mês em atraso, marcado à mão
//              ou ausente                     → mês pendente }
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
let COB = { tenantId: null, name: '', email: '', year: 2026, data: null };

function cobKey(y, mIdx) {
  return `${y}-${String(mIdx + 1).padStart(2, '0')}`;
}

// Estado de um mês: 'pago' | 'atraso' | 'pendente'.
// O atraso vem de dois caminhos. AUTOMÁTICO: passou do dia de vencimento e não
// foi pago. À MÃO: o gestor marcou — que é o que permite cobrar antes de o
// vencimento chegar, ou marcar atraso num mês sem dia de vencimento cadastrado.
function estadoMes(y, mIdx, dueDay, paidMap) {
  const r = paidMap && paidMap[cobKey(y, mIdx)];
  if (r && r.paid) return 'pago';
  if (r && r.atraso) return 'atraso';
  if (!dueDay) return 'pendente';
  const due = new Date(y, mIdx, dueDay, 23, 59, 59);
  return new Date() > due ? 'atraso' : 'pendente';
}

// Mantida para quem já chamava: agora é só uma leitura do estado.
function isOverdue(y, mIdx, dueDay, paidMap) {
  return estadoMes(y, mIdx, dueDay, paidMap) === 'atraso';
}

async function loadBilling(tenantId) {
  const rows = await fetch(`${saRest('a1_config')}?tenant_id=eq.${tenantId}&key=eq.billing&select=value`, {
    headers: saHeaders()
  })
    .then(r => r.json())
    .catch(() => []);
  let d = {};
  try {
    d = JSON.parse((rows && rows[0] && rows[0].value) || '{}');
  } catch {
    d = {};
  }
  if (!d.paid) d.paid = {};
  if (!d.notified) d.notified = {};
  return d;
}

async function saveBilling(tenantId, data) {
  const body = { tenant_id: tenantId, key: 'billing', value: JSON.stringify(data) };
  const res = await fetch(saRest('a1_config'), {
    method: 'POST',
    headers: saHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(body)
  });
  return res.ok;
}

// E-mail efetivo da cobrança: o do financeiro, se cadastrado; senão o do
// cadastro do cliente. Empresas grandes costumam ter um e-mail só do financeiro.
function cobTo() {
  return (COB.data && COB.data.email) || COB.email || '';
}

async function openCobranca(tenantId, name, email) {
  COB = { tenantId, name, email, year: 2026, data: await loadBilling(tenantId) };
  setEl('cob-name', name);
  document.getElementById('cob-email-input').value = COB.data.email || '';
  const em = document.getElementById('cob-email');
  const alvo = cobTo();
  if (em)
    em.textContent = alvo ? (COB.data.email ? 'Financeiro: ' + alvo : alvo) : '⚠ sem e-mail cadastrado';
  document.getElementById('cob-day').value = COB.data.due_day || '';
  document.getElementById('cob-valor').value = COB.data.valor || '';
  cobErr('');
  renderCobranca();
  openModal('modal-cobranca');
}

function cobYear(delta) {
  COB.year += delta;
  renderCobranca();
}

function renderCobranca() {
  setEl('cob-year', COB.year);
  const grid = document.getElementById('cob-grid');
  if (!grid) return;
  const paid = COB.data.paid || {};
  const dueDay = parseInt(COB.data.due_day) || 0;
  grid.innerHTML = MESES.map((m, i) => {
    const k = cobKey(COB.year, i);
    const est = estadoMes(COB.year, i, dueDay, paid);
    const r = paid[k] || {};
    const bg = est === 'pago' ? '#dcfce7' : est === 'atraso' ? '#fee2e2' : '#f1f5f9';
    const col = est === 'pago' ? '#15803d' : est === 'atraso' ? '#b91c1c' : '#64748b';
    const lbl = est === 'pago' ? 'Pago' : est === 'atraso' ? 'Em atraso' : 'Pendente';
    // Data embaixo: quando pagou, ou desde quando está marcado em atraso.
    const quando = est === 'pago' ? r.date : r.atraso ? r.desde : '';
    const sub = quando ? new Date(quando).toLocaleDateString('pt-BR') : '';
    return `<button data-acao="cobToggle" data-m-idx="${esc(i)}" style="text-align:left;border:1px solid ${col}33;background:${bg};color:${col};border-radius:.5rem;padding:.5rem .6rem;cursor:pointer;font-family:inherit">
      <div style="font-size:.8rem;font-weight:700">${m}</div>
      <div style="font-size:.68rem;font-weight:600">${lbl}</div>
      ${sub ? `<div style="font-size:.6rem;opacity:.8">${sub}</div>` : ''}
    </button>`;
  }).join('');

  // Resumo do status do mês corrente
  const now = new Date();
  const curK = cobKey(now.getFullYear(), now.getMonth());
  const st = document.getElementById('cob-status');
  if (st) {
    const cp = paid[curK] && paid[curK].paid;
    const cur = new Date();
    const curOver =
      !cp &&
      dueDay &&
      cur.getFullYear() === now.getFullYear() &&
      isOverdue(now.getFullYear(), now.getMonth(), dueDay, paid);
    st.textContent = cp ? '● Mês atual pago' : curOver ? '● Mês atual EM ATRASO' : '● Mês atual pendente';
    st.style.color = cp ? '#15803d' : curOver ? '#b91c1c' : '#64748b';
  }
}

// O clique gira entre os três estados, na ordem em que a cobrança acontece na
// vida real: está pendente → pagou → não pagou, virou atraso → resolveu.
async function cobToggle(mIdx) {
  const k = cobKey(COB.year, mIdx);
  if (!COB.data.paid) COB.data.paid = {};
  const r = COB.data.paid[k];
  if (r && r.paid) {
    COB.data.paid[k] = { atraso: true, desde: new Date().toISOString() }; // pago → em atraso
  } else if (r && r.atraso) {
    delete COB.data.paid[k]; // em atraso → pendente
  } else {
    COB.data.paid[k] = { paid: true, date: new Date().toISOString() }; // pendente → pago
    // ao marcar como pago, limpa a marca de notificação do mês
    if (COB.data.notified) delete COB.data.notified[k];
  }
  renderCobranca();
  const ok = await saveBilling(COB.tenantId, COB.data);
  if (!ok) cobErr('Não foi possível salvar. Verifique a conexão.');
  updateCobHint(COB.tenantId, COB.data);
}

async function cobPersistMeta() {
  COB.data.due_day = parseInt(document.getElementById('cob-day').value) || null;
  COB.data.valor = document.getElementById('cob-valor').value.trim() || null;
  const mailIn = document.getElementById('cob-email-input');
  const mail = (mailIn ? mailIn.value : '').trim();
  if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
    cobErr('E-mail do financeiro parece inválido. Confira antes de enviar a cobrança.');
  } else {
    cobErr('');
  }
  COB.data.email = mail || null;
  const em = document.getElementById('cob-email');
  if (em) {
    const alvo = cobTo();
    em.textContent = alvo ? (COB.data.email ? 'Financeiro: ' + alvo : alvo) : '⚠ sem e-mail cadastrado';
  }
  renderCobranca();
  const ok = await saveBilling(COB.tenantId, COB.data);
  if (!ok) cobErr('Não foi possível salvar. Verifique a conexão.');
  updateCobHint(COB.tenantId, COB.data);
}

function cobErr(msg) {
  const el = document.getElementById('cob-err');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

// Modelo padrão da mensagem de cobrança
function cobrancaBody(name, valor, dueDay, refMonthLabel) {
  const v = valor ? `no valor de R$ ${valor} ` : '';
  const venc = dueDay ? ` (vencimento todo dia ${dueDay})` : '';
  return `Prezado(a) responsável pela ${name},

Identificamos que a mensalidade da sua assinatura SIIMOB referente a ${refMonthLabel} ${v}consta como EM ABERTO em nosso sistema${venc}.

Caso o pagamento já tenha sido efetuado, por favor desconsidere este aviso e nos encaminhe o comprovante para regularização.

Para evitar a SUSPENSÃO automática do acesso à plataforma, solicitamos a regularização o quanto antes.

Em caso de dúvidas sobre valores, boletos ou datas, estamos à disposição.

Atenciosamente,
Equipe SIIMOB`;
}

function cobCurrentRef() {
  const now = new Date();
  return {
    key: cobKey(now.getFullYear(), now.getMonth()),
    label: `${MESES[now.getMonth()]}/${now.getFullYear()}`
  };
}

async function sendCobranca() {
  cobErr('');
  if (!cobTo()) {
    cobErr('Sem e-mail para enviar. Informe o e-mail do financeiro acima ou cadastre um e-mail no cliente.');
    return;
  }
  const ref = cobCurrentRef();
  const subject = `SIIMOB · Aviso de pagamento em aberto — ${ref.label}`;
  const body = cobrancaBody(COB.name, COB.data.valor, COB.data.due_day, ref.label);
  const res = await fetch(saRest('a1_emails'), {
    method: 'POST',
    headers: saHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({
      tenant_id: COB.tenantId,
      to_email: cobTo(),
      subject,
      body,
      status: 'pending'
    })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    cobErr(
      'Falha ao enfileirar o e-mail. Verifique se a tabela a1_emails existe (rode a migração SQL). ' +
        (t ? '· ' + t.slice(0, 120) : '')
    );
    return;
  }
  if (!COB.data.notified) COB.data.notified = {};
  COB.data.notified[ref.key] = new Date().toISOString();
  await saveBilling(COB.tenantId, COB.data);
  toast(`Cobrança de ${ref.label} enfileirada para ${cobTo()}.`, 'success');
}

// Fallback: abre o cliente de e-mail do superadmin já preenchido
function mailtoCobranca() {
  if (!cobTo()) {
    cobErr('Sem e-mail para enviar. Informe o e-mail do financeiro acima.');
    return;
  }
  const ref = cobCurrentRef();
  const subject = `SIIMOB · Aviso de pagamento em aberto — ${ref.label}`;
  const body = cobrancaBody(COB.name, COB.data.valor, COB.data.due_day, ref.label);
  window.location.href = `mailto:${encodeURIComponent(cobTo())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Pinta a linha do cliente com um aviso quando há mês vencido em aberto
function updateCobHint(tenantId, data) {
  const el = document.getElementById(`cob-hint-${tenantId}`);
  if (!el) return;
  const dueDay = parseInt(data && data.due_day) || 0;
  if (!dueDay) {
    el.textContent = '';
    return;
  }
  const now = new Date();
  const over = isOverdue(now.getFullYear(), now.getMonth(), dueDay, data.paid || {});
  el.textContent = over ? '● vencido' : '';
  el.style.color = '#B8433A';
}

// Auto-envio: ao abrir a aba Clientes, para cada tenant com dia de vencimento
// configurado cujo mês atual está em aberto e já passou do vencimento e ainda
// não foi notificado neste mês, enfileira o e-mail de cobrança. Guarda 1x/mês.
async function autoCobrancaCheck() {
  let rows = [];
  try {
    rows = await fetch(`${saRest('a1_config')}?key=eq.billing&select=tenant_id,value`, {
      headers: saHeaders()
    }).then(r => r.json());
  } catch {
    return;
  }
  if (!Array.isArray(rows)) return;
  const now = new Date();
  const ref = cobCurrentRef();
  let queued = 0;
  for (const row of rows) {
    let d = {};
    try {
      d = JSON.parse(row.value || '{}');
    } catch {
      continue;
    }
    updateCobHint(row.tenant_id, d);
    const dueDay = parseInt(d.due_day) || 0;
    if (!dueDay) continue;
    const paid = d.paid || {};
    if (paid[ref.key] && paid[ref.key].paid) continue; // mês atual já pago
    if (!isOverdue(now.getFullYear(), now.getMonth(), dueDay, paid)) continue; // ainda não venceu
    if (d.notified && d.notified[ref.key]) continue; // já notificado neste mês
    const t = TENANTS.find(x => x.id === row.tenant_id);
    if (!t || !t.email) continue; // precisa de e-mail
    const subject = `SIIMOB · Aviso de pagamento em aberto — ${ref.label}`;
    const body = cobrancaBody(t.name, d.valor, dueDay, ref.label);
    const res = await fetch(saRest('a1_emails'), {
      method: 'POST',
      headers: saHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ tenant_id: row.tenant_id, to_email: t.email, subject, body, status: 'pending' })
    }).catch(() => null);
    if (res && res.ok) {
      if (!d.notified) d.notified = {};
      d.notified[ref.key] = new Date().toISOString();
      await saveBilling(row.tenant_id, d);
      queued++;
    }
  }
  if (queued > 0) toast(`${queued} cobrança(s) automática(s) enfileirada(s) para clientes vencidos.`, 'info');
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function toast(msg, type = 'info') {
  const el = document.getElementById('sa-toast');
  const item = document.createElement('div');
  item.className = `toast-item toast-${type}`;
  item.textContent = msg;
  el.appendChild(item);
  setTimeout(() => item.remove(), 4500);
}

// ─── Feedback / Melhorias ─────────────────────────────────────────────────────
const STATUS_LABELS = { pending: 'Pendente', accepted: 'Aceita', rejected: 'Rejeitada' };

async function loadFeedback() {
  const statusFilter = document.getElementById('fb-filter-status')?.value || '';
  const list = document.getElementById('feedback-list');
  list.innerHTML =
    '<div style="padding:2rem;text-align:center;color:var(--t3);font-size:.77rem">Carregando...</div>';
  let url = saRest('a1_feedback') + '?order=created_at.desc';
  if (statusFilter) url += `&status=eq.${statusFilter}`;
  const data = await fetch(url, { headers: saHeaders() })
    .then(r => r.json())
    .catch(() => []);
  if (!Array.isArray(data) || !data.length) {
    list.innerHTML =
      '<div style="padding:2rem;text-align:center;color:var(--t3);font-size:.77rem">Nenhuma sugestão encontrada.</div>';
    document.getElementById('feedback-badge').style.display = 'none';
    return;
  }
  const pending = data.filter(f => f.status === 'pending').length;
  const badge = document.getElementById('feedback-badge');
  if (pending > 0) {
    badge.textContent = pending;
    badge.style.display = '';
  } else badge.style.display = 'none';

  list.innerHTML = data
    .map(
      f => `
    <div class="fb-card" id="fb-card-${f.id}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.25rem;flex-wrap:wrap">
          <div class="fb-card-title">${esc(f.title)}</div>
          <span class="fb-badge ${f.status}">${STATUS_LABELS[f.status] || f.status}</span>
        </div>
        ${f.description ? `<div class="fb-card-desc">${esc(f.description)}</div>` : ''}
        <div class="fb-card-meta">
          ${esc(f.author_name)} · ${esc(f.tenant_name || '')} · ${new Date(f.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      <div class="fb-actions">
        ${f.status !== 'accepted' ? `<button class="fb-btn fb-btn-accept" data-acao="setFeedbackStatus" data-id="${esc(f.id)}" data-status="accepted">✓ Aceitar</button>` : ''}
        ${f.status !== 'rejected' ? `<button class="fb-btn fb-btn-reject" data-acao="setFeedbackStatus" data-id="${esc(f.id)}" data-status="rejected">✕ Rejeitar</button>` : ''}
        ${f.status !== 'pending' ? `<button class="fb-btn" style="background:#f1f5f9;color:var(--t2)" data-acao="setFeedbackStatus" data-id="${esc(f.id)}" data-status="pending">↺ Pendente</button>` : ''}
      </div>
    </div>`
    )
    .join('');
}

async function setFeedbackStatus(id, status) {
  const res = await fetch(`${saRest('a1_feedback')}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...saHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status })
  });
  if (res.ok || res.status === 204) loadFeedback();
  else alert('Erro ao atualizar status.');
}

// ─── Contrato ─────────────────────────────────────────────────────────────────
function openContrato(tenantId) {
  CONTRACT_TENANT = TENANTS.find(t => t.id === tenantId);
  if (!CONTRACT_TENANT) return;

  // Módulos contratados deste cliente
  CONTRACT_MODS = ALL_MODULES.filter(m => m.tenant_id === tenantId).map(m => {
    const def = MODULES_DEF.find(d => d.key === m.module_key);
    return { key: m.module_key, name: def ? def.name : m.module_key, expires_at: m.expires_at };
  });

  // Contratante
  document.getElementById('ct-cli-name').value = CONTRACT_TENANT.name || '';
  document.getElementById('ct-cli-cnpj').value = CONTRACT_TENANT.cnpj || '';
  document.getElementById('ct-cli-email').value = CONTRACT_TENANT.email || '';
  document.getElementById('ct-cli-rep').value = '';
  document.getElementById('ct-cli-cpf_rep').value = '';
  document.getElementById('ct-cli-endereco').value = '';

  // Billing day from created_at
  const billingDay = CONTRACT_TENANT.created_at
    ? new Date(CONTRACT_TENANT.created_at).getDate()
    : new Date().getDate();
  document.getElementById('ct-billing-day').value = billingDay;

  // Plan display
  const PLAN_NAMES = { starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise', custom: 'Customizado' };
  document.getElementById('ct-plan-display').value =
    `${PLAN_NAMES[CONTRACT_TENANT.plan_key] || CONTRACT_TENANT.plan_key} (${CONTRACT_TENANT.max_users} usuários)`;

  // Plan value from loaded plans table
  const plan = PLANS.find(p => p.key === CONTRACT_TENANT.plan_key);
  document.getElementById('ct-valor-plan').value =
    plan && plan.price_brl > 0
      ? Number(plan.price_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '';

  // Default date = today
  document.getElementById('ct-data').value = hojeISO();

  // Restore saved contratada data
  const saved = JSON.parse(localStorage.getItem('sa_contratada') || '{}');
  ['razao_social', 'cnpj', 'email', 'endereco', 'cidade_uf', 'cep', 'rep_legal', 'cpf_rep'].forEach(k => {
    const el = document.getElementById(`ct-sa-${k}`);
    if (el) el.value = saved[k] || '';
  });
  if (saved.cidade_uf) {
    document.getElementById('ct-foro').value = saved.cidade_uf.split('/')[0].trim();
  }

  openModal('modal-contrato-bg');
}

function autoForo() {
  const cid = document.getElementById('ct-sa-cidade_uf').value.split('/')[0].trim();
  const foro = document.getElementById('ct-foro');
  if (cid && !foro.value) foro.value = cid;
}

function gerarContratoPDF() {
  const saRazao = document.getElementById('ct-sa-razao_social').value.trim();
  const saCnpj = document.getElementById('ct-sa-cnpj').value.trim();
  const saEnd = document.getElementById('ct-sa-endereco').value.trim();
  const saCid = document.getElementById('ct-sa-cidade_uf').value.trim();
  const saCep = document.getElementById('ct-sa-cep').value.trim();
  const saEmail = document.getElementById('ct-sa-email').value.trim();
  const saRep = document.getElementById('ct-sa-rep_legal').value.trim();
  const saCpfRep = document.getElementById('ct-sa-cpf_rep').value.trim();

  if (!saRazao || !saCnpj || !saEnd || !saCid || !saRep) {
    toast('Preencha os campos obrigatórios da Contratada (*).', 'error');
    return;
  }

  const cliName = document.getElementById('ct-cli-name').value.trim();
  const cliCnpj = document.getElementById('ct-cli-cnpj').value.trim();
  const cliEmail = document.getElementById('ct-cli-email').value.trim();
  const cliEnd = document.getElementById('ct-cli-endereco').value.trim();
  const cliRep = document.getElementById('ct-cli-rep').value.trim();
  const cliCpfRep = document.getElementById('ct-cli-cpf_rep').value.trim();

  const valorRaw = document.getElementById('ct-valor-plan').value.trim();
  if (!valorRaw) {
    toast('Informe o valor mensal do plano.', 'error');
    return;
  }

  const billingDay = document.getElementById('ct-billing-day').value || new Date().getDate();
  const foro = document.getElementById('ct-foro').value.trim() || saCid.split('/')[0].trim();

  const dataVal = document.getElementById('ct-data').value;
  const dateObj = dataVal ? new Date(dataVal + 'T12:00:00') : new Date();
  const today = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  const valorNum = parseFloat(valorRaw.replace(/\./g, '').replace(',', '.'));
  const valorFormatted =
    'R$ ' +
    (isNaN(valorNum)
      ? valorRaw
      : valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  // Persist contratada for next time
  localStorage.setItem(
    'sa_contratada',
    JSON.stringify({
      razao_social: saRazao,
      cnpj: saCnpj,
      email: saEmail,
      endereco: saEnd,
      cidade_uf: saCid,
      cep: saCep,
      rep_legal: saRep,
      cpf_rep: saCpfRep
    })
  );

  const PLAN_NAMES = { starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise', custom: 'Customizado' };
  const planName = PLAN_NAMES[CONTRACT_TENANT?.plan_key] || CONTRACT_TENANT?.plan_key || '';

  const html = geraHtmlContrato({
    saRazao,
    saCnpj,
    saEnd,
    saCid,
    saCep,
    saEmail,
    saRep,
    saCpfRep,
    cliName,
    cliCnpj,
    cliEmail,
    cliEnd,
    cliRep,
    cliCpfRep,
    planName,
    valorFormatted,
    billingDay,
    today,
    foro,
    modulosList: CONTRACT_MODS,
    maxUsers: CONTRACT_TENANT?.max_users || 0
  });

  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) {
    toast('Permita pop-ups no navegador para gerar o PDF.', 'error');
    return;
  }
  w.document.write(html);
  w.document.close();
  toast('Contrato gerado! Use Ctrl+P → "Salvar como PDF".', 'success');
}

function numExtenso(n) {
  const u = [
    'zero',
    'um',
    'dois',
    'três',
    'quatro',
    'cinco',
    'seis',
    'sete',
    'oito',
    'nove',
    'dez',
    'onze',
    'doze',
    'treze',
    'quatorze',
    'quinze',
    'dezesseis',
    'dezessete',
    'dezoito',
    'dezenove'
  ];
  const d2 = [
    '',
    '',
    'vinte',
    'trinta',
    'quarenta',
    'cinquenta',
    'sessenta',
    'setenta',
    'oitenta',
    'noventa'
  ];
  if (n < 20) return u[n];
  if (n < 100) return d2[Math.floor(n / 10)] + (n % 10 ? ' e ' + u[n % 10] : '');
  return n.toString();
}

function geraHtmlContrato(d) {
  const cliQualif = [
    `<strong>${d.cliName}</strong>`,
    d.cliCnpj ? `, inscrita no CNPJ/MF sob o nº <strong>${d.cliCnpj}</strong>` : '',
    d.cliEnd ? `, com sede na ${d.cliEnd}` : '',
    d.cliEmail ? `, e-mail: <strong>${d.cliEmail}</strong>` : '',
    d.cliRep
      ? `, neste ato representada por <strong>${d.cliRep}</strong>${d.cliCpfRep ? ', CPF ' + d.cliCpfRep : ''}`
      : ''
  ].join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Contrato — ${d.cliName}</title>
<style>
  @page{size:A4 portrait;margin:28mm 22mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11.5pt;line-height:1.65;color:#111;background:#fff}
  h1{font-size:13pt;text-align:center;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:.25em}
  .subtitle{text-align:center;font-size:9.5pt;color:#555;margin-bottom:2em}
  h2{font-size:11pt;font-weight:700;margin-top:1.6em;margin-bottom:.5em;text-transform:uppercase;letter-spacing:.03em}
  p{margin-bottom:.8em;text-align:justify;hyphens:auto}
  .parties-box{border:1px solid #bbb;border-radius:4px;padding:14px 18px;margin:1.5em 0;background:#f9f9f9}
  .party-lbl{font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#444;margin-bottom:.3em;border-bottom:1px solid #ddd;padding-bottom:.2em}
  .party-info{font-size:10.5pt;margin-bottom:1em}
  .party-info:last-child{margin-bottom:0}
  ul{padding-left:1.6em;margin-bottom:.8em}
  li{margin-bottom:.35em}
  .date-place{margin-top:3.5em;text-align:center;font-size:11pt}
  .sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:3.5em;margin-top:2.5em;page-break-inside:avoid}
  .sig-block{text-align:center}
  .sig-spacer{height:3em}
  .sig-line{border-top:1px solid #111;margin-bottom:.4em}
  .sig-name{font-weight:700;font-size:10.5pt}
  .sig-role{font-size:9.5pt;color:#555}
  .witness-hdr{text-align:center;font-size:10.5pt;font-weight:700;margin-top:3em;margin-bottom:1.5em}
  .footer-note{margin-top:3em;font-size:8.5pt;color:#999;border-top:1px solid #ddd;padding-top:.6em;text-align:center;page-break-inside:avoid}
  @media print{@page{margin:28mm 22mm}button{display:none!important}}
</style>
</head>
<body>

<h1>Contrato de Prestação de Serviços de Software (SaaS)</h1>
<div class="subtitle">Plataforma SIIMOB — Gestão Imobiliária e Financeira</div>

<div class="parties-box">
  <div class="party-lbl">Contratada</div>
  <div class="party-info">
    <strong>${d.saRazao}</strong>, pessoa jurídica de direito privado, inscrita no CNPJ/MF sob o nº <strong>${d.saCnpj}</strong>, com sede na ${d.saEnd}, ${d.saCid}${d.saCep ? ', CEP ' + d.saCep : ''}${d.saEmail ? ', e-mail: <strong>' + d.saEmail + '</strong>' : ''}, neste ato representada por <strong>${d.saRep}</strong>${d.saCpfRep ? ', CPF ' + d.saCpfRep : ''}.
  </div>
  <div class="party-lbl">Contratante</div>
  <div class="party-info">${cliQualif}.</div>
</div>

<p>As partes acima qualificadas têm entre si justo e contratado o presente <strong>Contrato de Prestação de Serviços de Software como Serviço (SaaS)</strong>, que se regerá pelas cláusulas e condições a seguir:</p>

<h2>Cláusula Primeira – Do Objeto</h2>
<p>1.1. O presente contrato tem como objeto a prestação, pela <strong>Contratada</strong>, de serviços de acesso à plataforma <em>SIIMOB</em> — sistema de gestão imobiliária e financeira em modelo de Software como Serviço (SaaS) —, disponibilizado via internet, conforme plano contratado.</p>
<p>1.2. Os serviços incluem acesso a até <strong>${d.maxUsers} (${numExtenso(d.maxUsers)}) usuário${d.maxUsers !== 1 ? 's' : ''}</strong> simultâneos, contratados no plano <strong>${d.planName}</strong>, com acesso aos módulos abaixo relacionados, além de suporte técnico nos limites deste plano, atualizações de sistema realizadas automaticamente pela Contratada e armazenamento seguro dos dados do Contratante:</p>
${
  d.modulosList && d.modulosList.length
    ? `<ul>${d.modulosList.map(m => `<li><strong>${esc(m.name)}</strong>${m.expires_at ? ` — vigência até ${new Date(m.expires_at).toLocaleDateString('pt-BR')}` : ''}</li>`).join('')}</ul>`
    : `<ul><li>Módulos conforme habilitação vigente na plataforma</li></ul>`
}
<p>1.3. A Contratada reserva-se o direito de alterar, atualizar ou descontinuar funcionalidades, mediante notificação com antecedência mínima de 30 (trinta) dias.</p>

<h2>Cláusula Segunda – Do Prazo</h2>
<p>2.1. Este contrato é firmado por prazo <strong>indeterminado</strong>, com vigência iniciada na data de sua assinatura.</p>
<p>2.2. A relação contratual renova-se automaticamente a cada mês, sem necessidade de nova formalização, salvo manifestação em contrário de qualquer das partes com antecedência mínima de 30 (trinta) dias.</p>

<h2>Cláusula Terceira – Do Valor e Condições de Pagamento</h2>
<p>3.1. Pela prestação dos serviços descritos na Cláusula Primeira, o Contratante pagará à Contratada o valor mensal de <strong>${d.valorFormatted}</strong>, referente ao plano <strong>${d.planName}</strong>.</p>
<p>3.2. O vencimento ocorrerá todo dia <strong>${d.billingDay}</strong> de cada mês, renovando-se automaticamente.</p>
<p>3.3. O atraso superior a 10 (dez) dias corridos poderá ensejar a suspensão temporária do acesso ao sistema, sem prejuízo da cobrança dos valores devidos e dos encargos previstos nesta cláusula.</p>
<p>3.4. Os valores poderão ser reajustados anualmente com base na variação do IGPM/FGV ou índice que o substitua, mediante notificação prévia de 30 (trinta) dias.</p>
<p>3.5. Em caso de inadimplência, incidirão: multa moratória de 2% (dois por cento), juros de mora de 1% (um por cento) ao mês e correção monetária pelo IGPM/FGV sobre o valor em atraso.</p>

<h2>Cláusula Quarta – Das Obrigações da Contratada</h2>
<p>4.1. São obrigações da Contratada:</p>
<ul>
  <li>Disponibilizar o acesso ao sistema de forma contínua, com disponibilidade mínima de 99% (noventa e nove por cento) ao mês, excluídas janelas de manutenção programadas;</li>
  <li>Realizar backup dos dados do Contratante periodicamente;</li>
  <li>Comunicar com antecedência mínima de 24 (vinte e quatro) horas as manutenções programadas que impliquem indisponibilidade;</li>
  <li>Garantir a segurança dos dados em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 – LGPD);</li>
  <li>Prestar suporte técnico nos canais e limites do plano contratado.</li>
</ul>

<h2>Cláusula Quinta – Das Obrigações do Contratante</h2>
<p>5.1. São obrigações do Contratante:</p>
<ul>
  <li>Efetuar o pagamento nas datas e condições previstas neste contrato;</li>
  <li>Utilizar o sistema exclusivamente para fins lícitos, em conformidade com este instrumento e com os Termos de Uso da plataforma;</li>
  <li>Manter o sigilo de suas credenciais de acesso, sendo responsável por qualquer uso realizado com as mesmas;</li>
  <li>Comunicar à Contratada imediatamente qualquer suspeita de acesso não autorizado;</li>
  <li>Não sublicenciar, ceder ou compartilhar o acesso a terceiros sem anuência prévia e escrita da Contratada;</li>
  <li>Fornecer dados verdadeiros e manter seu cadastro atualizado.</li>
</ul>

<h2>Cláusula Sexta – Da Propriedade Intelectual</h2>
<p>6.1. Todos os direitos de propriedade intelectual relativos à plataforma SIIMOB — incluindo software, marcas, logotipos, layouts, funcionalidades e documentação — são de titularidade exclusiva da Contratada.</p>
<p>6.2. Este contrato concede ao Contratante apenas autorização de uso, pessoal e intransferível, pelo período de vigência, não implicando cessão ou transferência de qualquer direito de propriedade intelectual.</p>
<p>6.3. Os dados inseridos pelo Contratante na plataforma são de sua exclusiva propriedade, e a Contratada se compromete a disponibilizá-los em formato exportável mediante solicitação formal.</p>

<h2>Cláusula Sétima – Da Confidencialidade e Proteção de Dados (LGPD)</h2>
<p>7.1. As partes obrigam-se a manter em sigilo todas as informações confidenciais trocadas em razão deste contrato, incluindo dados de clientes, processos internos e estratégias comerciais, durante a vigência e por 5 (cinco) anos após o encerramento.</p>
<p>7.2. A Contratada atua como <strong>Operadora</strong> dos dados pessoais inseridos na plataforma, nos termos da Lei nº 13.709/2018 (LGPD). O Contratante atua como <strong>Controlador</strong> e é responsável pela legalidade e base legal dos dados coletados.</p>
<p>7.3. Em caso de incidente de segurança envolvendo dados pessoais, a Contratada notificará o Contratante no prazo de 72 (setenta e duas) horas a partir da ciência do evento.</p>

<h2>Cláusula Oitava – Da Limitação de Responsabilidade</h2>
<p>8.1. A Contratada não se responsabiliza por danos indiretos, lucros cessantes ou perda de dados decorrentes do uso ou impossibilidade de uso do sistema, exceto em casos de dolo ou culpa grave comprovados.</p>
<p>8.2. A responsabilidade máxima da Contratada ficará limitada ao valor total pago pelo Contratante nos 3 (três) meses anteriores ao evento danoso.</p>
<p>8.3. O Contratante é o único responsável pela veracidade e integridade das informações inseridas no sistema.</p>

<h2>Cláusula Nona – Da Rescisão</h2>
<p>9.1. Este contrato poderá ser rescindido, sem ônus, por qualquer das partes, mediante notificação por escrito (inclusive por e-mail) com antecedência mínima de 30 (trinta) dias.</p>
<p>9.2. A Contratada poderá rescindir imediatamente, sem aviso prévio, nos seguintes casos: (i) inadimplência superior a 30 (trinta) dias; (ii) uso do sistema para fins ilícitos; (iii) violação grave de qualquer cláusula deste contrato.</p>
<p>9.3. Após o encerramento contratual, o Contratante terá 30 (trinta) dias para exportar seus dados. Transcorrido este prazo, a Contratada poderá removê-los definitivamente de seus servidores.</p>

<h2>Cláusula Décima – Das Disposições Gerais</h2>
<p>10.1. Este contrato constitui o acordo integral entre as partes e substitui quaisquer entendimentos anteriores sobre o mesmo objeto.</p>
<p>10.2. Qualquer alteração das condições aqui estabelecidas somente terá validade se formalizada por escrito e assinada pelas partes.</p>
<p>10.3. A tolerância de qualquer das partes quanto ao descumprimento de obrigações não importará em novação ou renúncia ao direito de exigir o fiel cumprimento.</p>
<p>10.4. Este contrato é regido pela legislação brasileira, em especial pelo Código Civil (Lei nº 10.406/2002), Lei de Software (Lei nº 9.609/1998), Marco Civil da Internet (Lei nº 12.965/2014) e LGPD (Lei nº 13.709/2018).</p>
<p>10.5. As partes elegem o foro da comarca de <strong>${d.foro}</strong> para dirimir quaisquer litígios decorrentes deste contrato, com expressa renúncia a qualquer outro, por mais privilegiado que seja.</p>

<div class="date-place">${d.foro}, ${d.today}.</div>

<div class="sig-grid">
  <div class="sig-block">
    <div class="sig-spacer"></div>
    <div class="sig-line"></div>
    <div class="sig-name">${d.saRep}</div>
    <div class="sig-role">Contratada</div>
    <div class="sig-role">${d.saRazao}</div>
    ${d.saCpfRep ? `<div class="sig-role">CPF: ${d.saCpfRep}</div>` : ''}
  </div>
  <div class="sig-block">
    <div class="sig-spacer"></div>
    <div class="sig-line"></div>
    <div class="sig-name">${d.cliRep || '_______________________________'}</div>
    <div class="sig-role">Contratante</div>
    <div class="sig-role">${d.cliName}</div>
    ${d.cliCpfRep ? `<div class="sig-role">CPF: ${d.cliCpfRep}</div>` : ''}
  </div>
</div>

<div class="witness-hdr">Testemunhas</div>
<div class="sig-grid">
  <div class="sig-block">
    <div class="sig-spacer"></div>
    <div class="sig-line"></div>
    <div class="sig-role">Nome: ______________________________</div>
    <div class="sig-role">CPF: _______________________________</div>
  </div>
  <div class="sig-block">
    <div class="sig-spacer"></div>
    <div class="sig-line"></div>
    <div class="sig-role">Nome: ______________________________</div>
    <div class="sig-role">CPF: _______________________________</div>
  </div>
</div>

<div class="footer-note">Documento gerado em ${d.today} pela plataforma SIIMOB. Este instrumento tem validade jurídica nos termos da legislação brasileira vigente.</div>

<script>window.onload = () => { window.focus(); window.print(); }<\/script>
</body>
</html>`;
}

// ─── Despachante limit popup ──────────────────────────────────────────────────
let _pendingUnlock = null;

function openDespLimitModal(tenantId, moduleKey) {
  _pendingUnlock = { tenantId, moduleKey };
  document.getElementById('desp-limit-input').value = '';
  document.getElementById('desp-limit-err').style.display = 'none';
  document.getElementById('modal-desp-limit').classList.remove('hidden');
  setTimeout(() => document.getElementById('desp-limit-input').focus(), 80);
}

function closeDespLimitModal() {
  document.getElementById('modal-desp-limit').classList.add('hidden');
  _pendingUnlock = null;
}

async function confirmDespLimit() {
  const val = parseInt(document.getElementById('desp-limit-input').value, 10);
  const errEl = document.getElementById('desp-limit-err');
  if (!val || val < 1) {
    errEl.textContent = 'Informe um número válido (mínimo 1).';
    errEl.style.display = '';
    return;
  }
  if (!_pendingUnlock) {
    closeDespLimitModal();
    return;
  }
  const { tenantId, moduleKey } = _pendingUnlock;
  closeDespLimitModal();

  // Store limit locally (keyed by tenantId) — replace with DB column if schema allows
  const limits = JSON.parse(localStorage.getItem('a1_desp_limits') || '{}');
  limits[tenantId] = val;
  localStorage.setItem('a1_desp_limits', JSON.stringify(limits));

  // Proceed with actual unlock
  await _doUnlockModule(tenantId, moduleKey);
  toast(
    `Módulo Registro liberado · ${val} despachante${val > 1 ? 's' : ''} permitido${val > 1 ? 's' : ''}.`,
    'success'
  );
}

async function _doUnlockModule(tenantId, moduleKey) {
  const expiresAt = document.getElementById('mod-expires')?.value || null;
  const res = await fetch(saRest('a1_tenant_modules'), {
    method: 'POST',
    headers: saHeaders({ Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({
      tenant_id: tenantId,
      module_key: moduleKey,
      unlocked_by: 'superadmin@corban.app',
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null
    })
  });
  if (res.ok) {
    await loadAllModules();
    loadTenantModulesFor();
    renderTenantsTable(TENANTS);
  } else {
    toast('Erro ao liberar módulo.', 'error');
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.getElementById('sa-url-input').value = typeof A1_URL !== 'undefined' ? A1_URL : '';
document.getElementById('sa-key-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') saAuth();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal('modal-users');
    closeDespLimitModal();
  }
});
