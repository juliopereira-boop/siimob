import { A1 } from '../../shared/api/config.js';
import { esc, escJs } from '../../shared/utils/texto.js';
import {
  a1ClearModuleCache,
  a1HasModule,
  a1RefreshPartnerPerms,
  a1RequireAuth,
  a1StartHeartbeat
} from '../../shared/auth/auth.js';
import { a1MontarShell } from '../../shared/ui/modulo-shell.js';
import { a1DocsPadrao } from '../../modules/documentos/documentos.js';
import {
  A1_PERFIS_MODELO,
  A1_PERMISSOES,
  A1_ROTULO_MODULO,
  a1PermissoesPorModulo
} from '../../shared/auth/permissoes.js';
import { leadsCadAbrir, leadsMontarConfig } from '../../modules/leads/cadastros-leads.js';
import { a1GeralCarregar, a1GeralNormalizar } from '../../modules/configuracoes/regras-gerais.js';
import '../../shared/ui/avisos.js';
import '../../shared/ui/cobranca-aviso.js';
import { expor, exporVariavel } from '../../shared/utils/expor.js';

// Chamadas pelo HTML (onclick="...") ou pela suíte de testes. Ver src/shared/utils/expor.js.
expor({
  addFlag,
  addRegional,
  analistaFilter,
  atualizarAcoesChecklist,
  ceFilter,
  cfgModsCartao,
  cfgModsVista,
  cicloAbrir,
  cicloAlternarAnalista,
  cicloAtivar,
  cicloEmpresaMudou,
  cicloFiltrarAnalistas,
  cicloNova,
  cicloRemover,
  cicloSalvar,
  cicloSelecionarVisiveis,
  closeCfgView,
  closeEmprForm,
  closeModal,
  coEtapasTodas,
  copiarId,
  copiarPrecadLink,
  copiarPrecadUrl,
  deleteAnalista,
  deleteChecklistItem,
  deleteCoordenador,
  deleteCorretor,
  deleteDocType,
  deleteEmpreendimento,
  deleteEmpresa,
  deleteGestor,
  deleteImob,
  deletePartner,
  deleteSimples,
  editBanco,
  editCartorio,
  editDespachante,
  editEmpreendimento,
  emprEstadoMudou,
  emprPreview,
  excDefCancelar,
  excDefEscolher,
  excDefExecutar,
  excDefPedirConfirmacao,
  excDefProcurar,
  excDefValidar,
  filtrarBancos,
  filtrarCartorios,
  filtrarDespachantes,
  filtrarHub,
  geralSalvar,
  gerarPrecadLink,
  imobFilter,
  loadEmpresas,
  openAnalista,
  openBancoModal,
  openCartorioModal,
  openCfgView,
  openCoordenador,
  openCorretor,
  openDespModal,
  openEmprModal,
  openEmpresaModal,
  openFeedbackModal,
  openGestor,
  openImob,
  openPartnerModal,
  openPrecadLink,
  openSimples,
  perfilAbrir,
  perfilApagar,
  perfilAplicado,
  perfilSalvar,
  perfisSemear,
  ptFilter,
  ptGo,
  recusarPrecad,
  removeFlag,
  removeRegional,
  renderAnalistaList,
  renderCorretores,
  renderImobList,
  revogarPrecadLink,
  saveAnalista,
  saveBanco,
  saveCartorio,
  saveChecklistItem,
  saveCommission,
  saveCoordenador,
  saveCorretor,
  saveDespachante,
  saveDocType,
  saveEmpreendimento,
  saveEmpresa,
  saveFeedback,
  saveGestor,
  saveImob,
  savePartner,
  saveSimples,
  setEmprTipo,
  setEtapaNivel,
  switchCorrTab,
  switchDocTypeModule,
  toast,
  toggleAnalistaChecklist,
  toggleChecklistAtivo,
  toggleChecklistObrigatorio,
  toggleCommissionFields,
  toggleDocType,
  toggleDocTypeObrigatorio,
  toggleEmprSemUnidades,
  usarDocTypesPadrao,
  v,
  validarPrecad
});
exporVariavel('CFG_VIEWS', () => CFG_VIEWS);
exporVariavel('CICLO_PA', () => CICLO_PA);
exporVariavel('G', () => G);
const G = {
  user: null,
  slug: null,
  tenant: null,
  stages: [],
  flags: [],
  edges: {},
  // analistas de crédito
  analistas: [],
  analistaFiltered: [],
  analistaPage: 0,
  analistaPerPage: 25,
  editingAnalistaId: null,
  analistasLoaded: false,
  // partners / usuários correspondentes
  partners: [],
  ptFiltered: [],
  ptPage: 0,
  ptPerPage: 25,
  editingPartnerId: null,
  partnersLoaded: false,
  // empresas correspondentes
  empresas: [],
  ceFiltered: [],
  cePage: 0,
  cePerPage: 25,
  editingEmpresaId: null,
  empresasLoaded: false,
  // empreendimentos
  empreendimentos: [],
  emprLoaded: false,
  editingEmprId: null,
  emprTipo: 'blocos',
  // imobiliarias
  imobs: [],
  imobFiltered: [],
  imobPage: 0,
  imobPerPage: 25,
  editingImobId: null,
  imobsLoaded: false
};

function applyCustomLogo() {
  const logo = localStorage.getItem('a1_platform_logo');
  if (!logo) return;
  document.querySelectorAll('.hdr-logo svg').forEach(svg => {
    const img = document.createElement('img');
    img.src = logo;
    img.style.cssText = 'height:26px;width:auto;object-fit:contain;flex-shrink:0';
    svg.replaceWith(img);
  });
}

async function init() {
  applyCustomLogo();
  // A tela nasce invisível (body.acesso-pendente) e a decisão de rota vem
  // ANTES de qualquer await, de propósito: `role` já está no localStorage e
  // não depende de rede. Se dependesse, uma consulta lenta deixaria o gestor
  // olhando tela em branco, e uma consulta que falha deixaria para sempre.
  try {
    G.user = a1RequireAuth();
  } catch {
    document.body.classList.remove('acesso-pendente');
    return;
  }
  G.slug = A1.slug;

  // O modulo-shell promete no comentário dele que "se forçar o endereço, a
  // própria tela o devolve" — só que a tela não devolvia ninguém: escondia o
  // link e montava tudo para quem digitasse /configuracoes. Esconder link
  // nunca foi autorização.
  //
  // Devolvemos CORRETOR e ANALISTA, que não têm nada a fazer aqui. O
  // correspondente e o despachante seguem entrando de propósito: esta tela
  // tem código dedicado a eles (o `isCCA` mais abaixo fixa a empresa do
  // correspondente no cadastro) e a equipe do correspondente é cadastrada
  // daqui. Barrar os dois junto fecharia o buraco derrubando quem trabalha.
  //
  // A proteção real continua sendo do banco: a1_users e a1_perfis só aceitam
  // escrita de a1_e_gestor(). Isto evita a tela montada, não o acesso.
  const _tipoBarrado =
    G.user.role === 'partner' && (G.user.type === 'corretor' || G.user.type === 'analista');
  if (_tipoBarrado) {
    // Para a Geral, e não para o Repasse. Mandar para um módulo específico
    // encadeava redirecionamento — quem não pode ver o painel do Repasse era
    // desviado de novo para /andamento — e presumia que o Repasse é o módulo
    // dele, o que deixou de ser verdade quando o cliente passou a ter cinco.
    window.location.replace(`/${G.slug}/geral`);
    return;
  }
  document.body.classList.remove('acesso-pendente');
  // Permissões vêm do banco a cada carregamento (o localStorage guarda só o
  // retrato do login). Sem isso, mudança de permissão feita pelo gestor só
  // valia depois do usuário deslogar e logar de novo.
  await a1RefreshPartnerPerms();
  G.user = A1.user || G.user;

  // Cadastro de gestor só aparece para gestor. A proteção real é do banco: a
  // política de a1_users só aceita escrita de quem tem papel owner/admin.
  if (!(G.user.role === 'owner' || G.user.role === 'admin')) {
    const _cg = document.getElementById('cfg-card-gestores');
    if (_cg) _cg.style.display = 'none';
    // Importar base cria cadastro e processo em massa: só gestor. A página em
    // si também confere, então esconder aqui é conveniência, não a proteção.
    const _ci = document.getElementById('cfg-card-importar');
    if (_ci) _ci.style.display = 'none';
    // Perfis mudam o que TODO mundo do perfil pode fazer. A política de
    // a1_perfis só aceita escrita de a1_e_gestor(), então quem não é gestor
    // veria o cartão, abriria e levaria um erro do banco — a recusa tem de
    // acontecer antes disso.
    const _cp = document.getElementById('cfg-card-perfis');
    if (_cp) _cp.style.display = 'none';
  }

  const roleLabel =
    G.user.role === 'partner'
      ? G.user.type === 'despachante'
        ? 'Despachante'
        : 'Correspondente'
      : G.user.role;
  // O cabeçalho é montado por src/shared/ui/modulo-shell.js: marca, busca, abas de módulo
  // e a sub-barra desta tela. Seis telas tinham a sua cópia da mesma barra, com
  // o mesmo CSS repetido; a correção numa delas nunca chegava nas outras.
  await a1MontarShell(document.getElementById('sb-casco'), { ativo: 'config' });
  // Os links do editor de esteira ficam DENTRO desta tela, não na barra.
  [
    ['link-wf', 'repasse'],
    ['link-wf-groups', 'repasse'],
    ['link-wf-rg', 'registro']
  ].forEach(([id, mod]) => {
    const el = document.getElementById(id);
    if (el) el.href = `/${G.slug}/workflow?module=${mod}`;
  });

  // Set nav hrefs

  // Load tenant info
  G.tenant = await fetch(
    `${A1.rest('a1_tenants')}?id=eq.${G.user.tenant_id}&select=id,tipo_cliente,max_users`,
    { headers: A1.headers() }
  )
    .then(r => r.json())
    .then(a => a[0] || {})
    .catch(() => ({}));

  // Check Registro module — show nav tab + config section if active
  fetch(A1.rpc('a1_has_module'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({ p_module_key: 'registro' })
  })
    .then(r => r.json())
    .then(ok => {
      G.hasRegistro = !!ok;
      const _dtReg = document.getElementById('dt-mod-registro');
      if (_dtReg) _dtReg.style.display = ok ? '' : 'none';
      if (ok) {
        const tabEl = document.getElementById('tab-registro-group');
        if (tabEl) tabEl.style.display = '';
        const cfgEl = document.getElementById('cfg-section-registro');
        if (cfgEl) cfgEl.style.display = '';
      }
    })
    .catch(() => {});

  // A licença do Repasse nunca precisava ser perguntada aqui — a tela toda
  // nasceu dele. Passou a precisar quando o cadastro de Analista de Crédito
  // virou dependente de módulo: sem Repasse E sem Pré-análise não existe
  // processo para o analista analisar.
  a1HasModule('repasse')
    .then(ok => {
      G.temRepasse = ok;
      analistaCartaoConferir();
      excDefConferir();
      if (PERFIS && PERFIS.lista.length) perfisRender();
    })
    .catch(() => {});

  // Módulos novos: a aba só aparece com a licença liberada. O acesso real aos
  // dados continua barrado por RLS mesmo que alguém force o link na barra.
  // O `ok !== true` é literal de propósito: a1HasModule devolve null quando o
  // servidor não respondeu, e "não consegui perguntar" não pode virar "não tem".
  ['PRE_ANALISE', 'COMERCIAL', 'crm', 'registro'].forEach(mod => {
    a1HasModule(mod)
      .then(ok => {
        if (mod === 'PRE_ANALISE') {
          G.temPAResp = ok;
          analistaCartaoConferir();
        }
        // O mesmo tri-estado do PRE_ANALISE, agora também para o COMERCIAL: a
        // Exclusão definitiva precisa saber a diferença entre "não tem" e
        // "ainda não respondeu" para não anunciar cobertura que não existe.
        if (mod === 'COMERCIAL') G.temCOResp = ok;
        if (mod === 'crm') G.temCRM = ok === true;
        if (mod === 'registro') G.temRegistro = ok === true;
        excDefConferir();
        if (ok !== true) return;
        // SÓ estes dois têm aba nesta tela. O laço também percorre `crm` e
        // `registro`, que entram apenas para alimentar o catálogo de permissões
        // — e o ternário abaixo, que só distingue PRE_ANALISE do RESTO, jogava
        // os dois em 'comercial': cliente com licença de CRM ou Registro via a
        // aba VENDA acesa, com link e submenu, sem ter comprado o módulo. O dado
        // seguia protegido pelo RLS; o que vazava era a promessa. Regra do dono:
        // sem licença o elemento não pode nem existir no DOM.
        // Leads e Registro nao ganham ABA nesta tela — mas Leads ganha o grupo de
        // cadastros no hub, e isso acontece ANTES do desvio abaixo. Sem esta
        // linha o grupo nunca era montado: o laco saia fora antes de chegar em
        // cfgModsLiberar, e o cliente licenciava Leads e nao achava nada.
        if (mod === 'crm') {
          cfgModsLiberar('crm');
          return;
        }
        if (mod !== 'PRE_ANALISE' && mod !== 'COMERCIAL') return;
        // O menu Andamento/Listagem e o mesmo que Repasse e Registro ja tinham.
        // Sem ele, o modulo novo era um link plano no meio de abas com submenu:
        // a Listagem so se alcancava entrando no Andamento primeiro.
        const alvo = mod === 'PRE_ANALISE' ? 'pre-analise' : 'comercial';
        const pre = mod === 'PRE_ANALISE' ? 'pa' : 'co';
        const base = `/${G.slug}/${alvo}`;
        const grupo = document.getElementById('grupo-' + alvo);
        const liga = (id, href) => {
          const e = document.getElementById(id);
          if (e) e.href = href;
        };
        liga('link-' + alvo, base);
        liga(`link-${pre}-andamento`, base);
        liga(`link-${pre}-listagem`, `${base}-listagem`);
        if (grupo) grupo.style.display = '';
        // A licença é fato do cliente, não do papel de quem está olhando. Estas
        // duas dizem quais permissões o catálogo oferece nos cadastros de gente;
        // ficavam dentro de cfgModsLiberar(), que devolve cedo para parceiro — e
        // aí um correspondente-gerente editava um corretor sem enxergar as
        // permissões dos módulos que o cliente comprou.
        if (mod === 'PRE_ANALISE') G.temPA = true;
        if (mod === 'COMERCIAL') G.temCO = true;
        // CRM e Registro não ganham abas nesta tela, mas precisam alimentar o
        // catálogo de permissões: assim só aparecem nos perfis se licenciados.
        if (mod === 'crm') G.temCRM = true;
        if (mod === 'registro') G.temRegistro = true;
        if (PERFIS && PERFIS.lista.length) perfisRender();
        cfgModsLiberar(mod);
      })
      .catch(() => {});
  });

  // Load stages (needed for regionais sub-view)
  // A coluna chama-se module_key. Com "module" o PostgREST devolvia um objeto
  // de erro, que era gravado em G.stages — verdadeiro, mas sem .map/.forEach,
  // derrubando quem dependesse da lista de etapas.
  G.stages = await fetch(
    `${A1.rest('a1_stages')}?module_key=eq.repasse&select=id,name,color,group_key,is_initial,is_final&order=position.asc`,
    { headers: A1.headers() }
  )
    .then(r => r.json())
    .catch(() => []);
  if (!Array.isArray(G.stages)) G.stages = [];

  // Aviso de cadastros esperando validação já na entrada — senão o corretor
  // fica parado na fila sem ninguém saber.
  fetch(`${A1.rest('a1_partners')}?type=eq.corretor&approved=eq.false&select=id`, { headers: A1.headers() })
    .then(r => r.json())
    .then(list => {
      if (Array.isArray(list)) {
        PRECAD_PEND = list;
        pintarPrecadBadge();
      }
    })
    .catch(() => {});

  loadFlags();
  a1StartHeartbeat('configuracoes');
}

// ── Config hub / sub-view navigation ──────────────────────────────────────────

const CFG_VIEWS = [
  'geral',
  'perfis',
  'wf',
  'flags',
  'regionais',
  'empreendimentos',
  'imobiliarias',
  'doctypes',
  'checklist',
  'comissao',
  'analistas',
  'corretores',
  'precad',
  'gestores',
  'convenios',
  'modalidades',
  'coordenadores',
  'agencias',
  'correspondentes',
  'despachantes',
  'bancos',
  'cartorios'
];

// Busca do hub: esconde card por card e some com o grupo que ficar vazio, para
// não sobrar título de seção sem nada embaixo.
function filtrarHub(termo) {
  const q = (termo || '').trim().toLowerCase();
  let achou = 0;
  document.querySelectorAll('#cfg-hub .cfg-grupo').forEach(grupo => {
    let visiveis = 0;
    grupo.querySelectorAll('.cfg-hub-card').forEach(card => {
      // Card escondido por regra (cadastro de gestor e importar base somem para
      // quem não é gestor) não entra na conta: contando, o grupo continuava
      // visível e vazio numa busca que só casasse com o texto dele.
      if (card.style.display === 'none') return;
      const txt = (card.textContent || '').toLowerCase();
      const bate = !q || txt.includes(q);
      card.classList.toggle('oculto', !bate);
      if (bate) visiveis++;
    });
    grupo.style.display = visiveis ? '' : 'none';
    achou += visiveis;
  });
  const vazio = document.getElementById('cfg-busca-vazio');
  if (vazio) vazio.style.display = achou ? 'none' : '';
}

// Analista de Crédito depende de módulo: sem Repasse e sem Pré-análise não há
// processo para ele analisar, e o cartão vira uma porta para um cadastro que
// não serve para nada neste cliente.
//
// Só tira do DOM quando as DUAS respostas chegaram NEGANDO. a1HasModule devolve
// null quando o servidor não respondeu, e "não consegui perguntar" não pode
// virar "não tem" — o cliente ficaria sem o cadastro por causa de uma rede ruim.
function analistaCartaoConferir() {
  if (G.temRepasse !== false || G.temPAResp !== false) return;
  const card = document.getElementById('cfg-card-analistas');
  if (card) card.remove();
}
function analistaTemModulo() {
  return !(G.temRepasse === false && G.temPAResp === false);
}

function openCfgView(view) {
  // A busca do hub some com o cartão, mas o link direto continuaria abrindo a
  // tela. Quem fecha essa porta é aqui.
  if (view === 'analistas' && !analistaTemModulo()) {
    toast('O cadastro de analistas exige o módulo de Repasse ou de Pré-análise.', 'info');
    return;
  }
  // Mesma porta para a Área de risco: a sub-tela só é montada para gestor, e
  // sem ela o roteador esconderia o hub e mostraria uma tela em branco — a
  // pessoa ficaria presa sem nem o botão de voltar.
  if (view === 'excdef' && !document.getElementById('cfg-view-excdef')) {
    toast('A exclusão definitiva é uma área de gestor.', 'info');
    return;
  }
  document.getElementById('cfg-hub').style.display = 'none';
  CFG_VIEWS.forEach(v => {
    const el = document.getElementById(`cfg-view-${v}`);
    if (el) el.style.display = v === view ? '' : 'none';
  });
  // Cada cadastro de Leads carrega a propria lista ao abrir. Carregar as
  // catorze na entrada da tela seriam catorze consultas para mostrar nenhuma.
  if (view.startsWith('lead-') && typeof leadsCadAbrir === 'function') leadsCadAbrir(view.slice(5));
  if (view === 'geral') geralCarregarTela();
  if (view === 'perfis') perfisCarregar();
  if (view === 'flags') loadFlags();
  if (view === 'regionais') loadRegionaisCfg();
  if (view === 'empreendimentos') loadEmpreendimentos();
  if (view === 'imobiliarias') loadImobs();
  if (view === 'doctypes') initDocTypesView();
  if (view === 'checklist') loadChecklistItems();
  if (view === 'comissao') loadCommission();
  if (view === 'analistas') loadAnalistas();
  if (view === 'corretores') loadCorretores();
  if (view === 'precad') loadPrecad();
  if (view === 'convenios') loadSimples('convenio');
  if (view === 'modalidades') loadSimples('modalidade');
  if (view === 'agencias') loadSimples('agencia');
  if (view === 'coordenadores') loadCoordenadores();
  if (view === 'gestores') loadGestores();
  if (view === 'correspondentes') {
    loadEmpresas();
    loadPartners();
  }
  if (view === 'despachantes') loadDespachantes();
  if (view === 'bancos') loadBancos();
  if (view === 'cartorios') loadCartorios();
  if (view === 'ciclo-pa') cicloCarregar();
  // Telas dos módulos novos. Só existem no DOM (e em CFG_VIEWS) quando a
  // licença foi confirmada, então chegar aqui já significa que o cliente tem.
  if (view === 'integra') cfgIntegraCarregar();
  // Área de risco. Só existe no DOM para gestor e com pelo menos um módulo
  // licenciado; chegar aqui já significa as duas coisas.
  if (view === 'excdef') excDefAbrir();
}

function closeCfgView() {
  CFG_VIEWS.forEach(v => {
    const el = document.getElementById(`cfg-view-${v}`);
    if (el) el.style.display = 'none';
  });
  document.getElementById('cfg-hub').style.display = '';
}

// ── Configurações Gerais ────────────────────────────────────────────────────
// As regras-mãe do cliente. O catálogo, os padrões e a leitura moram em
// src/modules/configuracoes/regras-gerais.js, porque os módulos precisam da MESMA verdade: se esta tela
// guardasse a sua interpretação, a Venda e o Repasse leriam outra coisa e a
// regra valeria diferente em cada aba.
const GERAL_CAMPOS = [
  {
    chave: 'criar_pre_analise_avulsa',
    rotulo: 'Permitir criar pré-análise avulsa',
    ajuda:
      'Deixa abrir uma pré-análise direto, sem partir de um Lead. Desligada, a pré-análise só nasce de um Lead — e o botão de criar some do módulo para todo mundo.'
  },
  {
    chave: 'criar_venda_avulsa',
    rotulo: 'Permitir criar venda avulsa',
    ajuda:
      'Deixa abrir uma venda direto, sem partir de uma pré-análise aprovada. Ligada, o botão de criar venda aparece no módulo Venda para quem tem a permissão.'
  },
  {
    chave: 'criar_repasse_avulso',
    rotulo: 'Permitir criar repasse avulso',
    ajuda:
      'Deixa abrir um repasse direto, sem uma venda por trás. Desligada, o repasse só nasce do selo VENDIDO da esteira da Venda, e o botão some do módulo Repasse.'
  },
  {
    chave: 'permitir_cpf_duplicado',
    rotulo: 'Habilitar cadastro de CPF duplicado',
    ajuda:
      'Ligada, permite cadastrar mais de uma pessoa com o mesmo CPF na Pré-análise. Desligada, o banco impede a duplicidade. Não altera o CPF usado para login de usuários.'
  }
];

async function geralCarregarTela() {
  G.geral = await a1GeralCarregar();
  const alvo = document.getElementById('geral-lista');
  if (!alvo) return;
  alvo.innerHTML = GERAL_CAMPOS.map(
    c => `
    <label style="display:flex;gap:.7rem;align-items:flex-start;padding:.85rem 0;border-bottom:1px solid var(--border);cursor:pointer">
      <input type="checkbox" id="geral-${esc(c.chave)}" ${G.geral[c.chave] ? 'checked' : ''} style="margin-top:.2rem;width:1rem;height:1rem;flex:none">
      <span>
        <span style="display:block;font-size:.85rem;font-weight:700">${esc(c.rotulo)}</span>
        <span style="display:block;font-size:.76rem;color:var(--t3);line-height:1.5;margin-top:.2rem">${esc(c.ajuda)}</span>
      </span>
    </label>`
  ).join('');
  const av = document.getElementById('geral-aviso');
  if (av) av.textContent = '';
}

async function geralSalvar() {
  const valor = {};
  GERAL_CAMPOS.forEach(c => {
    const el = document.getElementById('geral-' + c.chave);
    valor[c.chave] = !!(el && el.checked);
  });
  const res = await fetch(A1.rest('a1_config'), {
    method: 'POST',
    headers: A1.upsertHeaders(),
    body: JSON.stringify({ tenant_id: G.user.tenant_id, key: 'geral', value: JSON.stringify(valor) })
  });
  if (res.ok) {
    G.geral = a1GeralNormalizar(valor);
    showToast('Configurações gerais salvas');
    // O aviso existe porque a mudança não alcança quem já está com o módulo
    // aberto noutra aba: o botão de criar é decidido no boot daquela tela.
    const av = document.getElementById('geral-aviso');
    if (av) av.textContent = 'Quem já está com um módulo aberto precisa recarregar para ver a mudança.';
  } else showToast('Erro ao salvar', 'error');
}

// ── Checklist operacional ───────────────────────────────────────────────────
function nomeModuloChecklist(mod) {
  return { PRE_ANALISE: 'Pré-análise', COMERCIAL: 'Venda' }[mod] || mod;
}
function atualizarAcoesChecklist() {
  const mod = document.getElementById('cl-module')?.value,
    sel = document.getElementById('cl-auto');
  if (!sel) return;
  const opcoes =
    mod === 'PRE_ANALISE'
      ? [
          ['MANUAL', 'Preenchimento manual'],
          ['DOCUMENTO_ENVIADO', 'Documento enviado'],
          ['CREDITO_ANALISADO', 'Crédito analisado'],
          ['CREDITO_APROVADO', 'Crédito aprovado']
        ]
      : [
          ['MANUAL', 'Preenchimento manual'],
          ['CONTRATO_ASSINADO', 'Contrato assinado'],
          ['REPASSE_CRIADO', 'Repasse criado']
        ];
  sel.innerHTML = opcoes.map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('');
}
async function loadChecklistItems() {
  atualizarAcoesChecklist();
  const tb = document.getElementById('cl-tbody');
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="5" class="pt-empty">Carregando...</td></tr>';
  const rows = await fetch(`${A1.rest('a1_checklist_itens')}?order=module_key.asc,ordem.asc,nome.asc`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .catch(() => []);
  G.checklistItems = Array.isArray(rows) ? rows : [];
  renderChecklistItems();
}
function renderChecklistItems() {
  const tb = document.getElementById('cl-tbody');
  if (!tb) return;
  const list = G.checklistItems || [];
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="5" class="pt-empty">Nenhum item configurado.</td></tr>';
    return;
  }
  tb.innerHTML = list
    .map(
      i => `<tr>
    <td>${esc(i.nome)}</td><td>${esc(nomeModuloChecklist(i.module_key))}<div style="font-size:.66rem;color:var(--t3);margin-top:.15rem">${esc(i.acao_automatica || 'MANUAL').replaceAll('_', ' ')}</div></td>
    <td><label style="display:flex;align-items:center;gap:.35rem;font-size:.75rem"><input type="checkbox" ${i.obrigatorio ? 'checked' : ''} onchange="toggleChecklistObrigatorio('${i.id}')">${i.obrigatorio ? 'Sim' : 'Não'}</label></td>
    <td><span style="font-size:.68rem;font-weight:700;padding:.15rem .5rem;border-radius:20px;background:${i.ativo === false ? '#fee2e2' : '#dcfce7'};color:${i.ativo === false ? '#b91c1c' : '#166534'}">${i.ativo === false ? 'Inativo' : 'Ativo'}</span></td>
    <td style="text-align:right"><button class="btn btn-ghost btn-sm" onclick="toggleChecklistAtivo('${i.id}')">${i.ativo === false ? 'Ativar' : 'Desativar'}</button>
    <button class="btn btn-danger btn-sm" onclick="deleteChecklistItem('${i.id}')">Excluir</button></td>
  </tr>`
    )
    .join('');
}
async function saveChecklistItem() {
  const nome = (document.getElementById('cl-name').value || '').trim();
  if (!nome) {
    showToast('Informe o item do checklist', 'error');
    return;
  }
  const module_key = document.getElementById('cl-module').value;
  if (
    (G.checklistItems || []).some(
      i => i.module_key === module_key && i.nome.toLowerCase() === nome.toLowerCase()
    )
  ) {
    showToast('Este item já existe no módulo', 'error');
    return;
  }
  const ordem = (G.checklistItems || []).filter(i => i.module_key === module_key).length;
  const body = {
    tenant_id: G.user.tenant_id,
    module_key,
    nome,
    acao_automatica: document.getElementById('cl-auto').value || 'MANUAL',
    obrigatorio: document.getElementById('cl-obrigatorio').checked,
    ordem
  };
  const res = await fetch(A1.rest('a1_checklist_itens'), {
    method: 'POST',
    headers: A1.returnHeaders(),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    showToast('Não foi possível cadastrar o item', 'error');
    return;
  }
  document.getElementById('cl-name').value = '';
  document.getElementById('cl-obrigatorio').checked = false;
  await loadChecklistItems();
  showToast('Item de checklist cadastrado');
}
async function patchChecklistItem(id, body) {
  const res = await fetch(`${A1.rest('a1_checklist_itens')}?id=eq.${id}`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    showToast('Não foi possível atualizar o item', 'error');
    return;
  }
  const item = (G.checklistItems || []).find(i => i.id === id);
  if (item) Object.assign(item, body);
  renderChecklistItems();
}
function toggleChecklistObrigatorio(id) {
  const i = (G.checklistItems || []).find(x => x.id === id);
  if (i) patchChecklistItem(id, { obrigatorio: !i.obrigatorio });
}
function toggleChecklistAtivo(id) {
  const i = (G.checklistItems || []).find(x => x.id === id);
  if (i) patchChecklistItem(id, { ativo: i.ativo === false });
}
async function deleteChecklistItem(id) {
  if (!confirm('Excluir este item de checklist?')) return;
  const res = await fetch(`${A1.rest('a1_checklist_itens')}?id=eq.${id}`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  if (!res.ok) {
    showToast('Não foi possível excluir o item', 'error');
    return;
  }
  G.checklistItems = (G.checklistItems || []).filter(i => i.id !== id);
  renderChecklistItems();
  showToast('Item removido', 'info');
}

// ── Tipos de documento ───────────────────────────────────────────────────────
async function fetchDocTypes(force) {
  if (G.docTypes && !force) return G.docTypes;
  const rows = await fetch(`${A1.rest('a1_config')}?key=eq.doc_types&select=value`, { headers: A1.headers() })
    .then(r => r.json())
    .catch(() => []);
  let list = [];
  try {
    list = JSON.parse((rows && rows[0] && rows[0].value) || '[]');
  } catch {
    list = [];
  }
  G.docTypes = Array.isArray(list) ? list : [];
  return G.docTypes;
}
async function persistDocTypes() {
  const body = { tenant_id: G.user.tenant_id, key: 'doc_types', value: JSON.stringify(G.docTypes || []) };
  await fetch(A1.rest('a1_config'), {
    method: 'POST',
    headers: A1.upsertHeaders(),
    body: JSON.stringify(body)
  });
}
async function initDocTypesView() {
  const _dtReg = document.getElementById('dt-mod-registro');
  if (_dtReg) _dtReg.style.display = G.hasRegistro ? '' : 'none';
  const _dtPA = document.getElementById('dt-mod-PRE_ANALISE');
  if (_dtPA) _dtPA.style.display = G.temPA ? '' : 'none';
  // Quem estava na aba de um módulo e perdeu a licença ficaria preso numa aba
  // que não existe mais, com a lista vazia e sem botão para sair.
  if (
    !G.docTypeModule ||
    (G.docTypeModule === 'registro' && !G.hasRegistro) ||
    (G.docTypeModule === 'PRE_ANALISE' && !G.temPA)
  )
    G.docTypeModule = 'repasse';
  document.querySelectorAll('#cfg-view-doctypes .dt-mod-btn').forEach(b => b.classList.remove('active'));
  const _act = document.getElementById('dt-mod-' + G.docTypeModule);
  if (_act) _act.classList.add('active');
  await fetchDocTypes(true);
  renderDocTypesList();
}
function switchDocTypeModule(mod, el) {
  G.docTypeModule = mod;
  document.querySelectorAll('#cfg-view-doctypes .dt-mod-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderDocTypesList();
}
// O que a lista padrão deste módulo ainda tem a acrescentar. Comparação por
// nome em minúsculas: o gestor que já digitou "CPF" não deve receber outro.
function docTypesPadraoFaltando() {
  const mod = G.docTypeModule || 'repasse';
  const jaTem = new Set(
    (G.docTypes || []).filter(t => t.module === mod).map(t => (t.name || '').trim().toLowerCase())
  );
  return a1DocsPadrao(mod).filter(n => !jaTem.has(n.trim().toLowerCase()));
}

function pintarDocTypesPadrao() {
  const wrap = document.getElementById('dt-padrao-wrap');
  if (!wrap) return;
  const faltam = docTypesPadraoFaltando();
  // Módulo sem lista padrão, ou lista inteira já adotada: o botão sai de cena.
  // Botão que não faz nada é pior que botão ausente.
  wrap.style.display = faltam.length ? 'flex' : 'none';
  const hint = document.getElementById('dt-padrao-hint');
  if (hint)
    hint.textContent = faltam.length
      ? `Acrescenta ${faltam.length} tipo(s) sugerido(s): ${faltam.join(', ')}.`
      : '';
}

async function usarDocTypesPadrao() {
  const mod = G.docTypeModule || 'repasse';
  await fetchDocTypes();
  const faltam = docTypesPadraoFaltando();
  if (!faltam.length) {
    showToast('A lista padrão já está toda cadastrada', 'info');
    return;
  }
  // O índice entra no id porque Date.now() é o mesmo para o laço inteiro: sem
  // ele, dois tipos da mesma leva poderiam nascer com o mesmo id, e apagar um
  // apagaria o outro.
  faltam.forEach((name, i) => {
    G.docTypes.push({
      id: 't' + Date.now().toString(36) + i.toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      module: mod,
      active: true
    });
  });
  await persistDocTypes();
  renderDocTypesList();
  showToast(`${faltam.length} tipo(s) da lista padrão cadastrado(s)`);
}

function renderDocTypesList() {
  const tb = document.getElementById('dt-tbody');
  if (!tb) return;
  pintarDocTypesPadrao();
  const list = (G.docTypes || []).filter(t => t.module === (G.docTypeModule || 'repasse'));
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="4" class="pt-empty">Nenhum tipo cadastrado para este módulo.</td></tr>';
    return;
  }
  tb.innerHTML = list
    .map(t => {
      const on = t.active !== false;
      // A leitura do obrigatório é a mesma do banco: só o texto 'true' obriga.
      const obr = String(t.obrigatorio) === 'true';
      return `<tr>
      <td>${esc(t.name)}</td>
      <td><label style="display:flex;align-items:center;gap:.4rem;font-size:.75rem;cursor:pointer" title="Sem este documento anexado o processo não avança de etapa.">
        <input type="checkbox" ${obr ? 'checked' : ''} onchange="toggleDocTypeObrigatorio('${t.id}')" style="width:15px;height:15px;accent-color:#0E8C7F;cursor:pointer">
        ${obr ? 'Sim' : 'Não'}</label></td>
      <td><span style="font-size:.68rem;font-weight:700;padding:.15rem .5rem;border-radius:20px;background:${on ? '#dcfce7' : '#fee2e2'};color:${on ? '#166534' : '#b91c1c'}">${on ? 'Ativo' : 'Inativo'}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="toggleDocType('${t.id}')">${on ? 'Desativar' : 'Ativar'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteDocType('${t.id}')">Excluir</button>
      </td></tr>`;
    })
    .join('');
}
async function saveDocType() {
  const inp = document.getElementById('dt-name');
  const name = (inp.value || '').trim();
  if (!name) {
    showToast('Informe o nome do tipo', 'error');
    return;
  }
  await fetchDocTypes();
  const mod = G.docTypeModule || 'repasse';
  if ((G.docTypes || []).some(t => t.module === mod && (t.name || '').toLowerCase() === name.toLowerCase())) {
    showToast('Tipo já cadastrado', 'error');
    return;
  }
  G.docTypes.push({
    id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    module: mod,
    active: true
  });
  await persistDocTypes();
  inp.value = '';
  renderDocTypesList();
  showToast('Tipo cadastrado');
}
// Marcar como obrigatório é a coisa mais consequente desta tela: a partir daqui
// nenhum processo do módulo avança de etapa sem este documento. Por isso o
// aviso diz o que vai acontecer, e não um "salvo com sucesso".
async function toggleDocTypeObrigatorio(id) {
  const t = (G.docTypes || []).find(x => x.id === id);
  if (!t) return;
  // Grava booleano, como `active` já faz. A LEITURA é que é tolerante
  // (String(...)==='true'), porque o mesmo JSON é lido pelo SQL com ->>, que
  // devolve texto — e por telas antigas que gravaram valores estranhos.
  const virou = String(t.obrigatorio) !== 'true';
  t.obrigatorio = virou;
  await persistDocTypes();
  renderDocTypesList();
  showToast(
    virou
      ? `"${t.name}" agora é obrigatório: sem ele o processo não avança de etapa.`
      : `"${t.name}" deixou de ser obrigatório.`,
    virou ? 'success' : 'info'
  );
}

async function toggleDocType(id) {
  const t = (G.docTypes || []).find(x => x.id === id);
  if (!t) return;
  t.active = t.active === false;
  await persistDocTypes();
  renderDocTypesList();
}
async function deleteDocType(id) {
  if (!confirm('Excluir este tipo de documento?')) return;
  G.docTypes = (G.docTypes || []).filter(x => x.id !== id);
  await persistDocTypes();
  renderDocTypesList();
  showToast('Tipo removido', 'info');
}

// ── Configuração de Comissão ─────────────────────────────────────────────────
async function loadCommission() {
  const rows = await fetch(`${A1.rest('a1_config')}?key=eq.commission&select=value`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .catch(() => []);
  let cm = null;
  try {
    cm = JSON.parse((rows && rows[0] && rows[0].value) || 'null');
  } catch {
    cm = null;
  }
  G.commission = cm;
  renderCommissionForm();
}
function renderCommissionForm() {
  const cm = G.commission || { type: 'PERCENTAGE', fixed_value: '', percentage_value: '' };
  const t = document.getElementById('cm-type');
  if (!t) return;
  t.value = cm.type || 'PERCENTAGE';
  document.getElementById('cm-fixed').value = cm.fixed_value != null ? cm.fixed_value : '';
  document.getElementById('cm-pct').value = cm.percentage_value != null ? cm.percentage_value : '';
  toggleCommissionFields();
}
function toggleCommissionFields() {
  const t = document.getElementById('cm-type').value;
  document.getElementById('cm-fixed-wrap').style.display = t === 'FIXED' ? '' : 'none';
  document.getElementById('cm-pct-wrap').style.display = t === 'PERCENTAGE' ? '' : 'none';
}
async function saveCommission() {
  const type = document.getElementById('cm-type').value;
  const fixed =
    parseFloat(
      String(document.getElementById('cm-fixed').value || '')
        .replace(/\./g, '')
        .replace(',', '.')
    ) || null;
  const pct = parseFloat(String(document.getElementById('cm-pct').value || '').replace(',', '.')) || null;
  if (type === 'FIXED' && !(fixed > 0)) {
    showToast('Informe um valor fixo válido', 'error');
    return;
  }
  if (type === 'PERCENTAGE' && !(pct > 0)) {
    showToast('Informe um percentual válido', 'error');
    return;
  }
  const cm = {
    type,
    fixed_value: type === 'FIXED' ? fixed : null,
    percentage_value: type === 'PERCENTAGE' ? pct : null,
    is_active: true
  };
  const res = await fetch(A1.rest('a1_config'), {
    method: 'POST',
    headers: A1.upsertHeaders(),
    body: JSON.stringify({ tenant_id: G.user.tenant_id, key: 'commission', value: JSON.stringify(cm) })
  });
  if (res.ok) {
    G.commission = cm;
    showToast('Configuração de comissão salva');
  } else showToast('Erro ao salvar', 'error');
}

// ── Regionais (cadastro em a1_config key='regionais') ─────────────────────────

async function loadRegionaisCfg() {
  try {
    const rows = await fetch(
      `${A1.rest('a1_config')}?tenant_id=eq.${G.user.tenant_id}&key=eq.regionais&select=value`,
      { headers: A1.headers() }
    ).then(r => r.json());
    let list = [];
    try {
      list = JSON.parse((rows && rows[0] && rows[0].value) || '[]');
    } catch {
      list = [];
    }
    G.regionais = Array.isArray(list) ? list : [];
  } catch {
    G.regionais = [];
  }
  renderRegionaisList();
}
function renderRegionaisList() {
  const el = document.getElementById('regionais-list');
  if (!el) return;
  const list = G.regionais || [];
  if (!list.length) {
    el.innerHTML = '<span style="color:var(--t3);font-size:.77rem">Nenhuma regional cadastrada ainda.</span>';
    return;
  }
  el.innerHTML = list
    .map(
      (r, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem .7rem;border:1px solid var(--border);border-radius:8px;margin-bottom:.4rem">
      <span style="font-size:.82rem;font-weight:600;color:var(--t1)">${esc(r)}</span>
      <div style="display:flex;align-items:center;gap:.5rem">
        <code onclick="copiarId('${escJs(r)}')" title="Regional é identificada pelo nome. Clique para copiar."
          style="cursor:pointer;font-size:.68rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:.1rem .35rem;color:var(--t3)">pelo nome</code>
        <button class="btn-icon" title="Remover" onclick="removeRegional(${i})">🗑️</button>
      </div>
    </div>`
    )
    .join('');
}
function regErr(m) {
  const e = document.getElementById('reg-err');
  if (e) {
    e.textContent = m || '';
    e.style.display = m ? 'block' : 'none';
  }
}
async function persistRegionais() {
  const body = { tenant_id: G.user.tenant_id, key: 'regionais', value: JSON.stringify(G.regionais || []) };
  const res = await fetch(A1.rest('a1_config'), {
    method: 'POST',
    headers: A1.upsertHeaders(),
    body: JSON.stringify(body)
  });
  return res.ok;
}
async function addRegional() {
  regErr('');
  const inp = document.getElementById('reg-new');
  const name = (inp.value || '').trim();
  if (!name) {
    regErr('Digite o nome da regional.');
    return;
  }
  if (!Array.isArray(G.regionais)) G.regionais = [];
  if (G.regionais.some(r => r.toLowerCase() === name.toLowerCase())) {
    regErr('Essa regional já existe.');
    return;
  }
  G.regionais.push(name);
  inp.value = '';
  renderRegionaisList();
  if (!(await persistRegionais())) {
    regErr('Erro ao salvar. Tente novamente.');
  }
}
async function removeRegional(i) {
  if (!Array.isArray(G.regionais)) return;
  G.regionais.splice(i, 1);
  renderRegionaisList();
  if (!(await persistRegionais())) {
    regErr('Erro ao salvar. Tente novamente.');
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────────

function showToast(msg, type = 'success') {
  const wrap = document.getElementById('toast-wrap');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ── Modal helpers ──────────────────────────────────────────────────────────────

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

// ── Feedback ──────────────────────────────────────────────────────────────────

function openFeedbackModal() {
  document.getElementById('feedback-form-wrap').classList.remove('hidden');
  document.getElementById('feedback-success-wrap').classList.add('hidden');
  document.getElementById('feedback-footer').style.display = '';
  document.getElementById('fb-title').value = '';
  document.getElementById('fb-desc').value = '';
  openModal('modal-feedback-bg');
}

async function saveFeedback() {
  const title = document.getElementById('fb-title').value.trim();
  if (!title) {
    showToast('Informe o título da melhoria', 'error');
    return;
  }
  const btn = document.getElementById('fb-save-btn');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  try {
    await fetch(A1.rest('a1_feedback'), {
      method: 'POST',
      headers: { ...A1.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: G.user.tenant_id,
        user_id: G.user.id,
        title,
        description: document.getElementById('fb-desc').value.trim()
      })
    });
    document.getElementById('feedback-form-wrap').classList.add('hidden');
    document.getElementById('feedback-success-wrap').classList.remove('hidden');
    document.getElementById('feedback-footer').style.display = 'none';
  } catch (e) {
    showToast('Erro ao enviar. Tente novamente.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar sugestão';
  }
}

/* ===== PORTADO de repasse.html — loaders/saves/modais dos cadastros ===== */

/* globais de estado usados por alguns loaders (agenda de analistas) */

let _agdCaseId = null;

let _agendaYear = new Date().getFullYear(),
  _agendaMonth = new Date().getMonth();

function hasPerm(key) {
  if (G.user.role !== 'partner') return true;
  const p = G.user.permissions || {};
  if (p.gerente) return true; // Gerente = acesso total, como o gestor
  const defaults = {
    ver_repasses: true,
    criar_repasses: true,
    editar_repasses: false,
    ver_dashboard: false,
    baixar_documentos: false,
    editar_perfil: true,
    ver_todos_repasses: false,
    ver_todos_analistas: true
  };
  return key in p ? !!p[key] : (defaults[key] ?? false);
}

async function loadFlags() {
  G.flags = await fetch(`${A1.rest('a1_stage_flags')}?order=name.asc`, { headers: A1.headers() })
    .then(r => r.json())
    .catch(() => []);
  renderFlags();
}

function renderFlags() {
  const el = document.getElementById('flags-list');
  el.innerHTML = G.flags.length
    ? G.flags
        .map(
          f =>
            `<div class="tag-item" title="ID: ${esc(f.id)}"><span style="width:8px;height:8px;border-radius:50%;background:${f.color || '#0E8C7F'};display:inline-block"></span>${esc(f.name)} ${idChip(f.id)}<span class="tag-rm" onclick="removeFlag('${f.id}')">x</span></div>`
        )
        .join('')
    : '<span style="color:var(--t3);font-size:.77rem">Nenhuma flag cadastrada.</span>';
}

async function addFlag() {
  const input = document.getElementById('new-flag-input'),
    name = input.value.trim();
  if (!name) {
    toast('Informe o nome', 'error');
    return;
  }
  if (G.flags.some(f => (f.name || '').toLowerCase() === name.toLowerCase())) {
    toast('Já existe uma flag com esse nome', 'error');
    return;
  }
  // tenant_id é obrigatório na tabela (NOT NULL) e exigido pela RLS — sem ele o
  // insert falhava e a flag nunca era criada. A cor vem do seletor ao lado, que
  // antes era ignorado (a cor ia fixa no código).
  const color = document.getElementById('new-flag-color')?.value || '#0E8C7F';
  const res = await fetch(A1.rest('a1_stage_flags'), {
    method: 'POST',
    headers: A1.returnHeaders(),
    body: JSON.stringify({ tenant_id: G.user.tenant_id, name, color })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast('Erro ao criar flag: ' + (err.message || 'HTTP ' + res.status), 'error');
    return;
  }
  const [flag] = await res.json().catch(() => [null]);
  if (flag) {
    G.flags.push(flag);
    renderFlags();
    input.value = '';
    toast('Flag criada', 'success');
  } else toast('Erro ao criar flag', 'error');
}

async function removeFlag(id) {
  await fetch(`${A1.rest('a1_stage_flags')}?id=eq.${id}`, { method: 'DELETE', headers: A1.headers() });
  G.flags = G.flags.filter(f => f.id !== id);
  renderFlags();
  toast('Flag removida', 'info');
}

async function loadPartners() {
  G.partnersLoaded = true;
  await perfisGarantir();
  G.partners = await fetch(`${A1.rest('a1_partners')}?type=eq.cca&order=name.asc`, { headers: A1.headers() })
    .then(r => r.json())
    .catch(() => []);
  ptFilter();
  refreshCorrLimits();
}

function ptFilter() {
  const q = (document.getElementById('pt-search')?.value || '').toLowerCase();
  const empresaId = document.getElementById('pt-empresa')?.value || '';
  const status = document.getElementById('pt-status')?.value || '';
  G.ptFiltered = G.partners.filter(p => {
    if (empresaId && p.empresa_id !== empresaId) return false;
    if (status === 'active' && !(p.is_active && p.approved)) return false;
    if (status === 'pending' && !(p.is_active && !p.approved)) return false;
    if (status === 'inactive' && p.is_active) return false;
    if (q) {
      const hay = `${p.name} ${p.cpf || ''} ${p.email || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  G.ptPage = 0;
  renderPartnerTable();
}

function renderPartnerTable() {
  const tbody = document.getElementById('pt-tbody');
  const total = G.ptFiltered.length;
  const start = G.ptPage * G.ptPerPage;
  const page = G.ptFiltered.slice(start, start + G.ptPerPage);

  document.getElementById('pt-count').textContent =
    total === 0 ? 'Nenhum resultado' : `${start + 1}–${Math.min(start + page.length, total)} de ${total}`;

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="pt-empty">Nenhum cadastro encontrado.</td></tr>`;
    renderPtPagination(total);
    return;
  }

  tbody.innerHTML = page
    .map(p => {
      const st =
        p.is_active && p.approved
          ? `<span class="pt-status"><span class="pt-dot pt-dot-green"></span>Ativo</span>`
          : p.is_active && !p.approved
            ? `<span class="pt-status"><span class="pt-dot pt-dot-yellow"></span>Pendente</span>`
            : `<span class="pt-status"><span class="pt-dot pt-dot-red"></span>Inativo</span>`;
      const empresa = G.empresas.find(e => e.id === p.empresa_id);
      return `<tr>
      <td style="font-weight:600">${esc(p.name)}${perfilEtiqueta(p.perfil_id)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:.73rem">${esc(p.cpf || '—')}</td>
      <td>${esc(p.email || '—')}</td>
      <td>${esc(p.phone || '—')}</td>
      <td>${empresa ? esc(empresa.name) : '<span style="color:var(--t3)">—</span>'}</td>
      <td>${esc(p.region || '—')}</td>
      <td>${st}</td>
      <td><div style="display:flex;gap:.3rem">
        <button class="pt-act" onclick="openPartnerModal('${p.id}')">Editar</button>
        <button class="pt-act danger" onclick="deletePartner('${p.id}','${escJs(p.name)}')">Excluir</button>
      </div></td>
    </tr>`;
    })
    .join('');
  renderPtPagination(total);
}

function renderPtPagination(total) {
  const pages = Math.ceil(total / G.ptPerPage);
  const el = document.getElementById('pt-pg-btns');
  if (pages <= 1) {
    el.innerHTML = '';
    return;
  }
  let html = `<button class="pt-pg-btn" ${G.ptPage === 0 ? 'disabled' : ''} onclick="ptGo(${G.ptPage - 1})">Anterior</button>`;
  for (let i = 0; i < pages; i++) {
    if (pages > 7 && Math.abs(i - G.ptPage) > 2 && i !== 0 && i !== pages - 1) {
      if (i === 1 || i === pages - 2) html += `<span style="padding:.2rem .3rem;color:var(--t3)">…</span>`;
      continue;
    }
    html += `<button class="pt-pg-btn ${i === G.ptPage ? 'active' : ''}" onclick="ptGo(${i})">${i + 1}</button>`;
  }
  html += `<button class="pt-pg-btn" ${G.ptPage === pages - 1 ? 'disabled' : ''} onclick="ptGo(${G.ptPage + 1})">Proximo</button>`;
  el.innerHTML = html;
}

function ptGo(n) {
  G.ptPage = n;
  renderPartnerTable();
}

function toggleAnalistaChecklist(verTodos, permitidos = []) {
  const wrap = document.getElementById('pt-analista-checklist');
  const lbl = document.getElementById('pt-analistas-label');
  if (!wrap) return;
  wrap.style.display = verTodos ? 'none' : '';
  if (lbl) {
    lbl.style.borderColor = verTodos ? '#3F6F9E' : 'var(--border)';
    lbl.style.background = verTodos ? '#eff6ff' : '#F4F6F4';
  }
  if (!verTodos) {
    const list = document.getElementById('pt-analista-chk-list');
    if (!list) return;
    const src = G.analistas.length ? G.analistas : [];
    if (!src.length) {
      list.innerHTML = '<span style="color:var(--t3);font-size:.75rem">Nenhum analista cadastrado.</span>';
      return;
    }
    list.innerHTML = src
      .map(
        a => `
      <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
        <input type="checkbox" class="pt-analista-chk" value="${esc(a.name)}" ${permitidos.includes(a.name) ? 'checked' : ''}>
        ${esc(a.name)}
      </label>`
      )
      .join('');
  }
}

async function openPartnerModal(id) {
  const p = id ? G.partners.find(x => x.id === id) : null;
  G.editingPartnerId = p ? p.id : null;
  document.getElementById('partner-modal-title').textContent = p
    ? 'Editar usuário'
    : 'Novo usuário correspondente';
  // populate empresa select
  const sel = document.getElementById('pt-f-empresa');
  sel.innerHTML =
    '<option value="">Selecione a empresa...</option>' +
    G.empresas
      .map(e => `<option value="${e.id}"${p?.empresa_id === e.id ? ' selected' : ''}>${esc(e.name)}</option>`)
      .join('');
  document.getElementById('pt-f-name').value = p?.name || '';
  document.getElementById('pt-f-cpf').value = p?.cpf || '';
  document.getElementById('pt-f-email').value = p?.email || '';
  document.getElementById('pt-f-phone').value = p?.phone || '';
  document.getElementById('pt-f-region').value = p?.region || '';
  document.getElementById('pt-f-password').value = '';
  document.getElementById('pt-f-active').checked = p ? !!p.is_active : true;
  document.getElementById('pt-f-approved').checked = p ? !!p.approved : false;
  // As tres chaves de peso — gerente, ver todos os processos, ver de todos os
  // analistas — continuam nos cartoes grandes abaixo; o montador as pula.
  permsMontar('pt-perm-caixas', 'pt-perm', ['gerente', 'ver_todos_repasses', 'ver_todos_analistas']);
  // Ver o módulo é o padrão — sem isto o correspondente novo nasceria trancado
  // para fora do Repasse.
  const PERM_DEFAULTS = {
    ver_repasses: true,
    criar_repasses: true,
    editar_repasses: false,
    ver_todos_repasses: false
  };
  const savedPerms = p?.permissions || {};
  document.querySelectorAll('.pt-perm').forEach(cb => {
    const k = cb.dataset.key;
    cb.checked = k in savedPerms ? !!savedPerms[k] : (PERM_DEFAULTS[k] ?? false);
  });
  // atualiza visual do toggle de visualizacao geral
  const vizGeral = document.getElementById('pt-viz-geral');
  const vizLabel = document.getElementById('pt-viz-geral-label');
  if (vizGeral && vizLabel) {
    vizLabel.style.borderColor = vizGeral.checked ? '#0E8C7F' : 'var(--border)';
    vizLabel.style.background = vizGeral.checked ? '#EEF2FF' : '#F4F6F4';
  }
  const gerChk = document.getElementById('pt-gerente');
  const gerLabel = document.getElementById('pt-gerente-label');
  if (gerChk && gerLabel) {
    gerLabel.style.borderColor = gerChk.checked ? '#0d9488' : 'var(--border)';
    gerLabel.style.background = gerChk.checked ? '#ccfbf1' : '#F4F6F4';
  }
  // atualiza visual e checklist de analistas
  const verAnalistas = document.getElementById('pt-ver-analistas');
  const analLabel = document.getElementById('pt-analistas-label');
  if (verAnalistas) {
    verAnalistas.checked = 'ver_todos_analistas' in savedPerms ? !!savedPerms.ver_todos_analistas : true;
    if (analLabel) {
      analLabel.style.borderColor = verAnalistas.checked ? '#3F6F9E' : 'var(--border)';
      analLabel.style.background = verAnalistas.checked ? '#eff6ff' : '#F4F6F4';
    }
    const permitidos = savedPerms.analistas_permitidos || [];
    toggleAnalistaChecklist(verAnalistas.checked, permitidos);
  }
  await perfisParaSelect(document.getElementById('pt-perfil'), p?.perfil_id);
  perfilAplicado('pt-perfil', 'pt-perm');

  // Acesso por etapa, o mesmo seletor do corretor e do analista. Cadastro sem
  // mapa nenhum abre sem restrição — é como ele sempre funcionou, e passar a
  // exigir marcação aqui trancaria os correspondentes que já trabalham hoje.
  ETAPAS_PREFIXO = 'pt';
  await etapasGarantir();
  CO_ETAPAS = {};
  if (savedPerms.etapas && typeof savedPerms.etapas === 'object' && !Array.isArray(savedPerms.etapas)) {
    Object.entries(savedPerms.etapas).forEach(([k, v]) => {
      if (v === 'ver' || v === 'editar') CO_ETAPAS[k] = v;
    });
  } else if (Array.isArray(savedPerms.etapas_permitidas)) {
    savedPerms.etapas_permitidas.forEach(id => {
      CO_ETAPAS[id] = 'editar';
    });
  }
  pintarEtapasCorretor();

  document.getElementById('modal-partner-bg').classList.remove('hidden');
}

async function savePartner() {
  const name = document.getElementById('pt-f-name').value.trim();
  const empresaId = document.getElementById('pt-f-empresa').value;
  if (!name) {
    toast('Nome e obrigatorio', 'error');
    return;
  }
  if (!empresaId) {
    toast('Selecione a empresa correspondente', 'error');
    return;
  }
  // O cadastro já tinha mapa de etapas? A resposta muda o que o salvamento faz
  // com um mapa vazio — ver o comentário em permissions, abaixo.
  const _atual = G.editingPartnerId ? G.partners.find(x => x.id === G.editingPartnerId) || {} : {};
  const _pAtual = _atual.permissions || {};
  const tinhaEtapas =
    !!(
      _pAtual.etapas &&
      typeof _pAtual.etapas === 'object' &&
      !Array.isArray(_pAtual.etapas) &&
      Object.keys(_pAtual.etapas).length
    ) ||
    (Array.isArray(_pAtual.etapas_permitidas) && _pAtual.etapas_permitidas.length > 0);
  if (
    tinhaEtapas &&
    !Object.keys(CO_ETAPAS).length &&
    !confirm(
      'Nenhuma etapa ficou marcada. Esta pessoa vai entrar no sistema e não verá processo nenhum. Salvar assim mesmo?'
    )
  )
    return;
  const payload = {
    tenant_id: G.user.tenant_id,
    name,
    type: 'cca',
    empresa_id: empresaId,
    cpf: document.getElementById('pt-f-cpf').value.trim(),
    email: document.getElementById('pt-f-email').value.trim(),
    phone: document.getElementById('pt-f-phone').value.trim(),
    region: document.getElementById('pt-f-region').value.trim(),
    is_active: document.getElementById('pt-f-active').checked,
    approved: document.getElementById('pt-f-approved').checked,
    perfil_id: document.getElementById('pt-perfil').value || null,
    permissions: (() => {
      const perms = permsColetar('pt-perm', 'pt-perfil');
      // As etapas são da PESSOA, não do perfil: um perfil descreve um tipo de
      // gente, e em que etapas cada um atua é decisão de carteira. Por isso
      // elas são gravadas aqui mesmo quando há perfil escolhido.
      //
      // MAPA VAZIO NÃO É GRAVADO quando não havia mapa antes. Mapa vazio quer
      // dizer "não vê etapa nenhuma": um correspondente que trabalha hoje sem
      // mapa, aberto só para trocar o telefone, sairia cego do salvamento. Quem
      // quiser tirar todo o acesso desmarca as etapas de quem JÁ tinha mapa —
      // aí o vazio é decisão, não descuido.
      const marcadas = Object.keys(CO_ETAPAS);
      if (marcadas.length || tinhaEtapas) {
        perms.etapas = { ...CO_ETAPAS };
        perms.etapas_permitidas = marcadas;
      }
      // Com perfil, quem decide "ver de todos" e o perfil: sobrescrever aqui
      // pelo estado da tela gravaria a decisao dele como se fosse dela.
      const comPerfil = !!document.getElementById('pt-perfil').value;
      const verTodos = comPerfil
        ? perms.ver_todos_analistas === true
        : document.getElementById('pt-ver-analistas')?.checked !== false;
      perms.ver_todos_analistas = verTodos;
      if (!verTodos) {
        perms.analistas_permitidos = [...document.querySelectorAll('.pt-analista-chk:checked')].map(
          c => c.value
        );
      } else {
        perms.analistas_permitidos = [];
      }
      return perms;
    })()
  };
  const pwd = document.getElementById('pt-f-password').value;
  if (pwd) payload.password_hash = await sha256(pwd + '::a1');

  const btn = document.getElementById('pt-save-btn');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    if (G.editingPartnerId) {
      const res = await fetch(`${A1.rest('a1_partners')}?id=eq.${G.editingPartnerId}`, {
        method: 'PATCH',
        headers: A1.upsertHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(res.status);
      const idx = G.partners.findIndex(p => p.id === G.editingPartnerId);
      if (idx !== -1) G.partners[idx] = { ...G.partners[idx], ...payload };
      toast('Cadastro atualizado', 'success');
    } else {
      const [created] = await fetch(A1.rest('a1_partners'), {
        method: 'POST',
        headers: A1.returnHeaders(),
        body: JSON.stringify(payload)
      }).then(r => r.json());
      if (!created) throw new Error('no data');
      G.partners.push(created);
      G.partners.sort((a, b) => a.name.localeCompare(b.name));
      toast('Cadastro criado', 'success');
      refreshCorrLimits();
    }
    ptFilter();
    closeModal('modal-partner-bg');
  } catch {
    toast('Erro ao salvar. Verifique os dados.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function deletePartner(id, name) {
  if (!confirm(`Excluir o cadastro de "${name}"? Esta acao nao pode ser desfeita.`)) return;
  const partner = G.partners.find(p => p.id === id);
  const res = await fetch(`${A1.rest('a1_partners')}?id=eq.${id}`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  if (res.ok || res.status === 204) {
    // Remove também de a1_users caso exista entrada com o mesmo CPF no tenant
    if (partner?.cpf) {
      await fetch(`${A1.rest('a1_users')}?cpf=eq.${partner.cpf}&tenant_id=eq.${G.user.tenant_id}`, {
        method: 'DELETE',
        headers: A1.headers()
      }).catch(() => {});
    }
    G.partners = G.partners.filter(p => p.id !== id);
    ptFilter();
    refreshCorrLimits();
    toast('Cadastro removido', 'info');
  } else toast('Erro ao remover', 'error');
}

// ═══ Cadastros auxiliares (Convênio, Agência, Coordenador) ════════════════════
// Todos vivem em a1_partners, distinguidos por "type", usando o campo extra
// (JSONB) para o que é específico de cada um. Assim não foi preciso criar
// tabela nova nem migração.
const SIMPLES = {
  convenio: { titulo: 'convênio', tbody: 'convenio-tbody', colunas: 3, temNumero: false },
  agencia: { titulo: 'agência', tbody: 'agencia-tbody', colunas: 4, temNumero: true },
  modalidade: { titulo: 'modalidade de imóvel', tbody: 'modalidade-tbody', colunas: 3, temNumero: false }
};
const CAD = { convenio: [], agencia: [], coordenador: [], modalidade: [], imobiliaria: [] };

// Nome da imobiliária vinculada a alguém. Usado na lista de corretores e no
// formulário; devolve '' quando o vínculo aponta para algo que não existe mais.
function nomeImobiliaria(id) {
  if (!id) return '';
  const i = (CAD.imobiliaria || []).find(x => x.id === id);
  return i ? i.name : '';
}

// Identificador visível em todos os cadastros — serve para importações.
// Mostra um trecho e copia o valor inteiro no clique.
function idChip(id) {
  if (!id) return '<span style="color:var(--t3)">—</span>';
  return `<code onclick="copiarId('${id}')" title="Clique para copiar: ${id}"
    style="cursor:pointer;font-size:.7rem;background:var(--bg);border:1px solid var(--border);
           border-radius:4px;padding:.1rem .35rem;color:var(--t2)">${esc(String(id).slice(0, 8))}…</code>`;
}
function copiarId(id) {
  navigator.clipboard.writeText(id).then(
    () => toast('ID copiado: ' + id, 'success'),
    () => toast('Não foi possível copiar. O ID é: ' + id, 'info')
  );
}

async function loadSimples(tipo) {
  CAD[tipo] = await fetch(`${A1.rest('a1_partners')}?type=eq.${tipo}&order=name.asc`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .catch(() => []);
  if (!Array.isArray(CAD[tipo])) CAD[tipo] = [];
  renderSimples(tipo);
}

function renderSimples(tipo) {
  const cfg = SIMPLES[tipo];
  const tb = document.getElementById(cfg.tbody);
  if (!tb) return;
  const lista = CAD[tipo];
  if (!lista.length) {
    tb.innerHTML = `<tr><td colspan="${cfg.colunas}" style="padding:2rem;text-align:center;color:var(--t3)">Nenhum registro cadastrado.</td></tr>`;
    return;
  }
  tb.innerHTML = lista
    .map(
      r => `<tr>
    ${cfg.temNumero ? `<td style="font-family:Consolas,monospace">${esc((r.extra && r.extra.numero) || '—')}</td>` : ''}
    <td style="font-weight:600">${esc(r.name)}</td>
    <td>${idChip(r.id)}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-ghost btn-sm" onclick="openSimples('${tipo}','${r.id}')">Editar</button>
      <button class="btn btn-ghost btn-sm" style="color:#B8433A;border-color:#fecaca" onclick="deleteSimples('${tipo}','${r.id}')">Excluir</button>
    </td></tr>`
    )
    .join('');
}

let SIMPLES_TIPO = null,
  SIMPLES_ID = null;
function openSimples(tipo, id) {
  SIMPLES_TIPO = tipo;
  SIMPLES_ID = id || null;
  const cfg = SIMPLES[tipo];
  const r = id ? CAD[tipo].find(x => x.id === id) : null;
  document.getElementById('simples-title').textContent = (r ? 'Editar ' : 'Novo ') + cfg.titulo;
  document.getElementById('simples-nome').value = r?.name || '';
  document.getElementById('simples-numero-wrap').style.display = cfg.temNumero ? '' : 'none';
  document.getElementById('simples-numero').value = (r && r.extra && r.extra.numero) || '';
  document.getElementById('simples-id-wrap').style.display = r ? '' : 'none';
  document.getElementById('simples-id').value = r?.id || '';
  openModal('modal-simples-bg');
}

async function saveSimples() {
  const tipo = SIMPLES_TIPO,
    cfg = SIMPLES[tipo];
  const nome = document.getElementById('simples-nome').value.trim();
  const numero = document.getElementById('simples-numero').value.trim();
  if (!nome) {
    toast('Informe o nome', 'error');
    return;
  }
  if (cfg.temNumero && !numero) {
    toast('Informe o número da agência', 'error');
    return;
  }
  const dup = CAD[tipo].some(x => x.id !== SIMPLES_ID && (x.name || '').toLowerCase() === nome.toLowerCase());
  if (dup && !confirm(`Já existe um registro com o nome "${nome}". Cadastrar assim mesmo?`)) return;

  const payload = {
    tenant_id: G.user.tenant_id,
    type: tipo,
    name: nome,
    is_active: true,
    approved: true,
    extra: cfg.temNumero ? { numero } : {}
  };
  const btn = document.getElementById('simples-save-btn');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    const url = SIMPLES_ID ? `${A1.rest('a1_partners')}?id=eq.${SIMPLES_ID}` : A1.rest('a1_partners');
    const res = await fetch(url, {
      method: SIMPLES_ID ? 'PATCH' : 'POST',
      headers: A1.returnHeaders(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || 'HTTP ' + res.status);
    }
    toast(SIMPLES_ID ? 'Registro atualizado' : 'Registro cadastrado', 'success');
    closeModal('modal-simples-bg');
    loadSimples(tipo);
  } catch (e) {
    toast('Erro ao salvar: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function deleteSimples(tipo, id) {
  const r = CAD[tipo].find(x => x.id === id);
  if (!confirm(`Excluir "${r ? r.name : ''}"?`)) return;
  const res = await fetch(`${A1.rest('a1_partners')}?id=eq.${id}`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  if (res.ok || res.status === 204) {
    toast('Registro excluído', 'info');
    loadSimples(tipo);
  } else toast('Não foi possível excluir', 'error');
}

// ── Coordenadores ────────────────────────────────────────────────────────────
// O vínculo mora no corretor (extra.coordenador_id). Editar pelo coordenador
// ou pelo corretor altera o mesmo dado — não existem duas verdades.
async function loadCoordenadores() {
  const [coords, corrs] = await Promise.all([
    fetch(`${A1.rest('a1_partners')}?type=eq.coordenador&order=name.asc`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => []),
    fetch(`${A1.rest('a1_partners')}?type=eq.corretor&order=name.asc`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => [])
  ]);
  CAD.coordenador = Array.isArray(coords) ? coords : [];
  CORRETORES = Array.isArray(corrs) ? corrs : [];
  renderCoordenadores();
}

function corretoresDoCoordenador(coordId) {
  return CORRETORES.filter(c => c.extra && c.extra.coordenador_id === coordId);
}

function renderCoordenadores() {
  const tb = document.getElementById('coordenador-tbody');
  if (!tb) return;
  if (!CAD.coordenador.length) {
    tb.innerHTML =
      '<tr><td colspan="5" style="padding:2rem;text-align:center;color:var(--t3)">Nenhum coordenador cadastrado.</td></tr>';
    return;
  }
  tb.innerHTML = CAD.coordenador
    .map(c => {
      const eq = corretoresDoCoordenador(c.id);
      return `<tr>
      <td style="font-weight:600">${esc(c.name)}</td>
      <td style="color:var(--t2);font-size:.78rem">${esc(c.email || '—')}${c.phone ? `<div style="color:var(--t3)">${esc(c.phone)}</div>` : ''}</td>
      <td>${
        eq.length
          ? `<span style="font-weight:700;color:#a21caf">${eq.length}</span> <span style="color:var(--t3);font-size:.75rem">${esc(
              eq
                .slice(0, 2)
                .map(x => x.name)
                .join(', ')
            )}${eq.length > 2 ? '…' : ''}</span>`
          : '<span style="color:var(--t3);font-size:.75rem">nenhum vinculado</span>'
      }</td>
      <td>${idChip(c.id)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="openCoordenador('${c.id}')">Editar</button>
        <button class="btn btn-ghost btn-sm" style="color:#B8433A;border-color:#fecaca" onclick="deleteCoordenador('${c.id}')">Excluir</button>
      </td></tr>`;
    })
    .join('');
}

let COORD_ID = null;
async function openCoordenador(id) {
  COORD_ID = id || null;
  const c = id ? CAD.coordenador.find(x => x.id === id) : null;
  document.getElementById('coord-title').textContent = c ? 'Editar coordenador' : 'Novo coordenador';
  document.getElementById('coord-nome').value = c?.name || '';
  document.getElementById('coord-email').value = c?.email || '';
  document.getElementById('coord-phone').value = c?.phone || '';
  document.getElementById('coord-cpf').value = c?.cpf || '';
  document.getElementById('coord-senha').value = '';
  // Ausente = marcado, para o coordenador que já existe não perder visão ao ser
  // editado. Quem quiser restringir desmarca de propósito.
  document.getElementById('coord-ve-equipe').checked = !(
    c &&
    c.permissions &&
    c.permissions.ver_todos_analistas === false
  );
  document.getElementById('coord-id-wrap').style.display = c ? '' : 'none';
  document.getElementById('coord-id').value = c?.id || '';

  const box = document.getElementById('coord-corretores');
  box.innerHTML = CORRETORES.length
    ? CORRETORES.map(co => {
        const vinc = co.extra && co.extra.coordenador_id;
        const meu = c && vinc === c.id;
        const outro =
          vinc && (!c || vinc !== c.id) ? (CAD.coordenador.find(x => x.id === vinc) || {}).name : null;
        return `<label style="display:flex;align-items:center;gap:.5rem;font-size:.8rem;cursor:pointer">
          <input type="checkbox" class="coord-corretor" value="${co.id}"${meu ? ' checked' : ''}>
          <span style="flex:1">${esc(co.name)}</span>
          ${outro ? `<span style="font-size:.68rem;color:#9A6008">equipe de ${esc(outro)}</span>` : ''}
        </label>`;
      }).join('')
    : '<div style="color:var(--t3);font-size:.75rem">Nenhum corretor cadastrado ainda.</div>';
  await perfisParaSelect(document.getElementById('cd-perfil'), c?.perfil_id);
  openModal('modal-coordenador-bg');
}

async function saveCoordenador() {
  const nome = document.getElementById('coord-nome').value.trim();
  if (!nome) {
    toast('Informe o nome do coordenador', 'error');
    return;
  }
  const cpf = document.getElementById('coord-cpf').value.replace(/\D/g, '');
  const senha = document.getElementById('coord-senha').value;
  const veEquipe = document.getElementById('coord-ve-equipe').checked;
  if (cpf && cpf.length !== 11) {
    toast('CPF deve ter 11 dígitos', 'error');
    return;
  }
  if (senha && senha.length < 6) {
    toast('A senha precisa de pelo menos 6 caracteres', 'error');
    return;
  }

  const payload = {
    tenant_id: G.user.tenant_id,
    type: 'coordenador',
    name: nome,
    email: document.getElementById('coord-email').value.trim(),
    phone: document.getElementById('coord-phone').value.trim(),
    cpf: cpf || null,
    // Coordenador entra para acompanhar a equipe: lê e acompanha, não cria nem
    // apaga processo. Quem precisar de mais recebe do gestor, na tela de
    // usuários — permissão a mais por padrão é como se perde controle.
    permissions: {
      criar_repasses: false,
      editar_repasses: false,
      ver_dashboard: true,
      ver_todos_analistas: veEquipe
    },
    perfil_id: (document.getElementById('cd-perfil') || {}).value || null,
    is_active: true,
    approved: true
  };
  // Só manda a senha quando foi digitada: campo em branco mantém a atual. O
  // gatilho do banco converte para bcrypt na gravação.
  if (senha) payload.password_hash = await sha256(senha + '::a1');
  const btn = document.getElementById('coord-save-btn');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    let id = COORD_ID;
    const url = id ? `${A1.rest('a1_partners')}?id=eq.${id}` : A1.rest('a1_partners');
    const res = await fetch(url, {
      method: id ? 'PATCH' : 'POST',
      headers: A1.returnHeaders(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || 'HTTP ' + res.status);
    }
    if (!id) {
      const [criado] = await res.json().catch(() => []);
      id = criado && criado.id;
    }
    if (!id) throw new Error('O servidor não devolveu o registro criado.');

    // Aplica o vínculo: marcados passam a apontar para este coordenador;
    // desmarcados que apontavam para ele são desvinculados.
    const marcados = new Set([...document.querySelectorAll('.coord-corretor:checked')].map(i => i.value));
    const mudancas = [];
    CORRETORES.forEach(co => {
      const atual = (co.extra && co.extra.coordenador_id) || null;
      const novo = marcados.has(co.id) ? id : atual === id ? null : atual;
      if (novo !== atual) {
        mudancas.push(
          fetch(`${A1.rest('a1_partners')}?id=eq.${co.id}`, {
            method: 'PATCH',
            headers: A1.headers(),
            body: JSON.stringify({ extra: { ...(co.extra || {}), coordenador_id: novo } })
          })
        );
      }
    });
    if (mudancas.length) await Promise.all(mudancas);

    toast(COORD_ID ? 'Coordenador atualizado' : 'Coordenador cadastrado', 'success');
    closeModal('modal-coordenador-bg');
    loadCoordenadores();
  } catch (e) {
    toast('Erro ao salvar: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function deleteCoordenador(id) {
  const c = CAD.coordenador.find(x => x.id === id);
  const eq = corretoresDoCoordenador(id);
  if (
    !confirm(
      `Excluir o coordenador "${c ? c.name : ''}"?` +
        (eq.length ? `\n\n${eq.length} corretor(es) ficarão sem coordenador.` : '')
    )
  )
    return;
  await Promise.all(
    eq.map(co =>
      fetch(`${A1.rest('a1_partners')}?id=eq.${co.id}`, {
        method: 'PATCH',
        headers: A1.headers(),
        body: JSON.stringify({ extra: { ...(co.extra || {}), coordenador_id: null } })
      })
    )
  );
  const res = await fetch(`${A1.rest('a1_partners')}?id=eq.${id}`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  if (res.ok || res.status === 204) {
    toast('Coordenador excluído', 'info');
    loadCoordenadores();
  } else toast('Não foi possível excluir', 'error');
}

// ═══ Corretores ═══════════════════════════════════════════════════════════════
// Corretor é um parceiro de type='corretor' — reaproveita o login de parceiro
// (a1_partner_login) já existente, então ganha acesso sem função nova no banco.
// O diferencial é o conjunto de etapas em que ele atua: as permissões abaixo
// valem SOBRE essas etapas.
let CORRETORES = [];

async function loadCorretores() {
  // As etapas normalmente já vieram no carregamento da página; se ainda não,
  // busca aqui — sem elas a lista de seleção de etapas ficaria vazia.
  if (!Array.isArray(G.stages) || !G.stages.length) {
    G.stages = await fetch(`${A1.rest('a1_stages')}?module_key=eq.repasse&order=position.asc`, {
      headers: A1.headers()
    })
      .then(r => r.json())
      .catch(() => []);
    if (!Array.isArray(G.stages)) G.stages = [];
  }
  await perfisGarantir();
  const [corrs, coords, imobs] = await Promise.all([
    fetch(`${A1.rest('a1_partners')}?type=eq.corretor&order=name.asc`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => []),
    fetch(`${A1.rest('a1_partners')}?type=eq.coordenador&order=name.asc`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => []),
    // A imobiliária entra aqui e não no boot porque só esta tela precisa dela:
    // uma busca a mais no carregamento de todas as páginas custaria a todo mundo.
    fetch(`${A1.rest('a1_partners')}?type=eq.imobiliaria&order=name.asc`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => [])
  ]);
  const todos = Array.isArray(corrs) ? corrs : [];
  // Quem veio pelo link entra com approved = false e não aparece aqui: o lugar
  // dele é a fila de Validação, senão o gestor acharia que já tem acesso.
  CORRETORES = todos.filter(c => c.approved !== false);
  PRECAD_PEND = todos.filter(c => c.approved === false);
  CAD.coordenador = Array.isArray(coords) ? coords : [];
  CAD.imobiliaria = Array.isArray(imobs) ? imobs : [];
  pintarPrecadBadge();
  const aviso = document.getElementById('corretor-pendentes-aviso');
  if (aviso) {
    aviso.style.display = PRECAD_PEND.length ? '' : 'none';
    aviso.innerHTML = PRECAD_PEND.length
      ? `${PRECAD_PEND.length} cadastro(s) aguardando validação. <a href="#" onclick="openCfgView('precad');return false" style="color:#9a3412;font-weight:700">Abrir Validação de corretores</a>`
      : '';
  }
  renderCorretores();
}

function etapasLista() {
  return Array.isArray(G.stages) ? G.stages : [];
}
function nomeEtapa(id) {
  const st = etapasLista().find(x => x.id === id);
  return st ? st.name : null;
}

function renderCorretores() {
  const tb = document.getElementById('corretor-tbody');
  if (!tb) return;
  const q = (document.getElementById('corretor-search')?.value || '').toLowerCase();
  const lista = CORRETORES.filter(
    c => !q || `${c.name} ${c.cpf || ''} ${c.email || ''}`.toLowerCase().includes(q)
  );
  if (!lista.length) {
    tb.innerHTML =
      '<tr><td colspan="8" style="padding:2rem;text-align:center;color:var(--t3)">Nenhum corretor cadastrado.</td></tr>';
    return;
  }
  tb.innerHTML = lista
    .map(c => {
      const p = c.permissions || {};
      let mapa = p.etapas && typeof p.etapas === 'object' && !Array.isArray(p.etapas) ? p.etapas : null;
      if (!mapa) {
        mapa = {};
        (Array.isArray(p.etapas_permitidas) ? p.etapas_permitidas : []).forEach(id => (mapa[id] = 'editar'));
      }
      const ed = Object.keys(mapa).filter(k => mapa[k] === 'editar');
      const vr = Object.keys(mapa).filter(k => mapa[k] === 'ver');
      const chip = (nome, cor, bg) =>
        `<span style="display:inline-block;font-size:.68rem;font-weight:700;padding:.1rem .45rem;border-radius:5px;background:${bg};color:${cor};margin-right:.25rem">${nome}</span>`;
      const etapasTxt =
        ed.length + vr.length
          ? (ed.length ? chip(ed.length + ' editar', '#047857', '#ecfdf5') : '') +
            (vr.length ? chip(vr.length + ' ver', '#1e40af', '#eff6ff') : '') +
            `<div style="color:var(--t3);font-size:.7rem;margin-top:.15rem">${esc([...ed, ...vr].map(nomeEtapa).filter(Boolean).slice(0, 3).join(', '))}${ed.length + vr.length > 3 ? '…' : ''}</div>`
          : '<span style="color:#9A6008;font-size:.72rem">Nenhuma etapa marcada — não verá nada</span>';
      return `<tr>
      <td><b>${esc(c.name)}</b>${perfilEtiqueta(c.perfil_id)}</td>
      <td style="color:var(--t2)">${esc(c.cpf || '—')}<div style="color:var(--t3);font-size:.72rem">${esc(c.email || '')}</div></td>
      <td style="color:var(--t2);font-size:.78rem">${esc(nomeImobiliaria(c.extra && c.extra.imobiliaria_id) || '—')}</td>
      <td style="color:var(--t2);font-size:.78rem">${esc(((CAD.coordenador || []).find(k => k.id === (c.extra && c.extra.coordenador_id)) || {}).name || '—')}</td>
      <td>${etapasTxt}</td>
      <td>${c.is_active !== false ? '<span style="color:#0E8C7F;font-weight:700;font-size:.75rem">Ativo</span>' : '<span style="color:var(--t3);font-size:.75rem">Inativo</span>'}</td>
      <td>${idChip(c.id)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="openCorretor('${c.id}')">Editar</button>
        <button class="btn btn-ghost btn-sm" style="color:#B8433A;border-color:#fecaca" onclick="deleteCorretor('${c.id}')">Excluir</button>
      </td></tr>`;
    })
    .join('');
}

// Nível de acesso do corretor por etapa: ausente = não vê; 'ver' = só acompanha;
// 'editar' = pode alterar e mover. Editar implica ver, por definição.
let CO_ETAPAS = {};
// Prefixo do formulário aberto: 'co' (corretor) ou 'an' (analista). Os dois
// cadastros usam o mesmo seletor de etapas.
let ETAPAS_PREFIXO = 'co';

function setEtapaNivel(stageId, alvo) {
  const atual = CO_ETAPAS[stageId] || null;
  if (alvo === 'ver') {
    // Em "editar", clicar em Ver rebaixa para somente leitura — é o caminho
    // natural de "quero que ele só acompanhe esta etapa". Clicar de novo tira
    // o acesso por completo.
    if (atual === 'ver') delete CO_ETAPAS[stageId];
    else CO_ETAPAS[stageId] = 'ver';
  } else {
    if (atual === 'editar')
      CO_ETAPAS[stageId] = 'ver'; // desce um degrau
    else CO_ETAPAS[stageId] = 'editar'; // editar liga o ver junto
  }
  pintarEtapasCorretor();
}

// As etapas de TODOS os módulos licenciados, na ordem do processo.
//
// O seletor mostrava só as etapas do Repasse. Corretor e analista trabalham
// também na Pré-análise e na Venda, e lá o acesso era tudo-ou-nada — a
// mesma pessoa que o gestor limitava a duas etapas do Repasse enxergava a
// esteira inteira dos outros dois módulos.
//
// A esteira de cada módulo mora em tabela própria (a1_stages, a1_pa_situacoes,
// a1_co_situacoes) com nomes de coluna diferentes; aqui elas viram a mesma
// forma. Os ids são uuid, então o mapa continua sendo um só, sem prefixo e sem
// risco de um id de módulo colidir com o de outro.
function etapasGrupos() {
  const g = [];
  const pa = Array.isArray(G.paSituacoes) ? G.paSituacoes : [];
  const co = Array.isArray(G.coSituacoes) ? G.coSituacoes : [];
  if (G.temPA && pa.length)
    g.push({
      chave: 'PRE_ANALISE',
      rotulo: 'Pré-análise',
      etapas: pa.map(x => ({ id: x.id, name: x.nome, color: x.cor }))
    });
  if (G.temCO && co.length)
    g.push({
      chave: 'COMERCIAL',
      rotulo: 'Venda',
      etapas: co.map(x => ({ id: x.id, name: x.nome, color: x.cor }))
    });
  g.push({ chave: 'repasse', rotulo: 'Repasse', etapas: etapasLista() });
  return g.filter(x => x.etapas.length);
}

// Busca as esteiras dos módulos novos. Só com a licença — sem ela a política do
// banco devolveria lista vazia de qualquer jeito, e a consulta seria um
// round-trip jogado fora em todo cliente que não tem o módulo.
async function etapasGarantir() {
  const tarefas = [];
  if (G.temPA && !Array.isArray(G.paSituacoes))
    tarefas.push(
      fetch(`${A1.rest('a1_pa_situacoes')}?ativo=eq.true&select=id,nome,cor,ordem&order=ordem.asc`, {
        headers: A1.headers()
      })
        .then(r => r.json())
        .then(a => {
          G.paSituacoes = Array.isArray(a) ? a : [];
        })
        .catch(() => {
          G.paSituacoes = [];
        })
    );
  if (G.temCO && !Array.isArray(G.coSituacoes))
    tarefas.push(
      fetch(`${A1.rest('a1_co_situacoes')}?ativo=eq.true&select=id,nome,cor,ordem&order=ordem.asc`, {
        headers: A1.headers()
      })
        .then(r => r.json())
        .then(a => {
          G.coSituacoes = Array.isArray(a) ? a : [];
        })
        .catch(() => {
          G.coSituacoes = [];
        })
    );
  if (tarefas.length) await Promise.all(tarefas);
}

function coEtapasTodas(nivel) {
  CO_ETAPAS = {};
  if (nivel)
    etapasGrupos().forEach(g =>
      g.etapas.forEach(st => {
        CO_ETAPAS[st.id] = nivel;
      })
    );
  pintarEtapasCorretor();
}

function pintarEtapasCorretor() {
  const box = document.getElementById(ETAPAS_PREFIXO + '-etapas-list');
  if (!box) return;
  const grupos = etapasGrupos();
  const total = grupos.reduce((n, g) => n + g.etapas.length, 0);
  if (!total) {
    box.innerHTML =
      '<div style="color:#9A6008;font-size:.75rem">Nenhuma etapa cadastrada ainda. Crie as etapas no Workflow primeiro.</div>';
    return;
  }
  const btn = (id, lvl, ativo, label) => {
    const cor = ativo ? '#0E8C7F' : 'var(--border)';
    const bg = ativo ? '#ecfdf5' : '#fff';
    const tx = ativo ? '#047857' : 'var(--t3)';
    return `<button type="button" onclick="setEtapaNivel('${id}','${lvl}')"
      style="font-size:.7rem;font-weight:700;padding:.22rem .6rem;border-radius:6px;cursor:pointer;
             border:1.5px solid ${cor};background:${bg};color:${tx};min-width:56px">${label}</button>`;
  };
  const linha = st => {
    const n = CO_ETAPAS[st.id] || null;
    return `<div style="display:flex;align-items:center;gap:.55rem;padding:.3rem .1rem">
      <span style="width:9px;height:9px;border-radius:50%;background:${st.color || '#6B827D'};flex-shrink:0"></span>
      <span style="flex:1;font-size:.8rem;color:${n ? 'var(--t1)' : 'var(--t3)'};font-weight:${n ? '600' : '400'}">${esc(st.name)}</span>
      ${btn(st.id, 'ver', n === 'ver' || n === 'editar', 'Ver')}
      ${btn(st.id, 'editar', n === 'editar', 'Editar')}
    </div>`;
  };
  // Com um módulo só, o título do grupo seria enfeite: é o cliente de hoje, e
  // a tela dele não deve mudar de aparência por causa de um recurso que ele
  // não tem.
  box.innerHTML = grupos
    .map(
      g =>
        (grupos.length > 1
          ? `<div data-modulo="${g.chave}" style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--t3);margin:.5rem 0 .15rem;padding-top:.35rem;border-top:1px solid var(--border)">${esc(g.rotulo)}</div>`
          : '') + g.etapas.map(linha).join('')
    )
    .join('');

  const nVer = Object.values(CO_ETAPAS).filter(v => v === 'ver').length;
  const nEd = Object.values(CO_ETAPAS).filter(v => v === 'editar').length;
  const res = document.getElementById(ETAPAS_PREFIXO + '-etapas-resumo');
  if (res)
    res.textContent =
      nVer + nEd
        ? `${nEd} etapa(s) com edição · ${nVer} apenas leitura · ${total - nVer - nEd} sem acesso`
        : 'Nenhuma etapa marcada — a pessoa entrará e não verá processo nenhum.';
}

let EDIT_CORRETOR_ID = null;
async function openCorretor(id) {
  const c = id ? CORRETORES.find(x => x.id === id) : null;
  EDIT_CORRETOR_ID = c ? c.id : null;
  ETAPAS_PREFIXO = 'co';
  document.getElementById('corretor-modal-title').textContent = c ? 'Editar corretor' : 'Novo corretor';
  document.getElementById('co-name').value = c?.name || '';
  document.getElementById('co-cpf').value = c?.cpf || '';
  document.getElementById('co-email').value = c?.email || '';
  document.getElementById('co-phone').value = c?.phone || '';
  document.getElementById('co-password').value = '';
  document.getElementById('co-pw-hint').textContent = c ? '(deixe vazio para manter a atual)' : '*';
  document.getElementById('co-active').checked = c ? c.is_active !== false : true;
  const coordSel = document.getElementById('co-coordenador');
  const coordAtual = (c && c.extra && c.extra.coordenador_id) || '';
  coordSel.innerHTML =
    '<option value="">Sem coordenador</option>' +
    (CAD.coordenador || [])
      .map(k => `<option value="${k.id}"${k.id === coordAtual ? ' selected' : ''}>${esc(k.name)}</option>`)
      .join('');
  const imobSel = document.getElementById('co-imob');
  const imobAtual = (c && c.extra && c.extra.imobiliaria_id) || '';
  imobSel.innerHTML =
    '<option value="">Sem imobiliária</option>' +
    (CAD.imobiliaria || [])
      .map(i => `<option value="${i.id}"${i.id === imobAtual ? ' selected' : ''}>${esc(i.name)}</option>`)
      .join('');
  // Imobiliária que ficou inativa (ou foi apagada) continuaria vinculada no
  // banco e sumiria da tela — salvar o cadastro apagaria o vínculo sem avisar.
  if (imobAtual && !imobSel.querySelector(`option[value="${imobAtual}"]`)) {
    const o = new Option(nomeImobiliaria(imobAtual) || 'Imobiliária removida', imobAtual, true, true);
    imobSel.add(o);
  }
  document.getElementById('co-id-wrap').style.display = c ? '' : 'none';
  document.getElementById('co-id').value = c?.id || '';

  const p = c?.permissions || {};
  // Gerente e "compartilhar carteira" ficam de fora: o corretor nunca teve
  // essas duas aqui, e um formulário não é lugar de estrear poder novo.
  // 'ver_todos_analistas' entra na lista de fora: corretor vê apenas o que está
  // vinculado a ele, e o interruptor prometeria o contrário.
  permsMontar('co-perm-caixas', 'co-perm', ['gerente', 'ver_todos_repasses', 'ver_todos_analistas']);
  // 'ver_repasses' nasce MARCADA, e isso não é detalhe: ela é o degrau que abre
  // o módulo. Nascendo desmarcada, todo corretor cadastrado a partir daqui
  // seria salvo com ver_repasses:false e bateria em "Sem acesso ao Repasse" no
  // primeiro login. Ver o módulo é o padrão; o que se concede é o resto.
  const PADRAO = {
    ver_repasses: true,
    criar_repasses: false,
    editar_repasses: false,
    alterar_etapa: false,
    ver_dashboard: false
  };
  document.querySelectorAll('.co-perm').forEach(cb => {
    const k = cb.dataset.key;
    cb.checked = k in p ? !!p[k] : (PADRAO[k] ?? false);
  });
  await perfisParaSelect(document.getElementById('co-perfil'), c?.perfil_id);
  perfilAplicado('co-perfil', 'co-perm');

  // Compatibilidade: cadastros antigos guardavam só a lista de etapas liberadas,
  // sem nível. Viram "editar", que era o que valia antes.
  CO_ETAPAS = {};
  if (p.etapas && typeof p.etapas === 'object' && !Array.isArray(p.etapas)) {
    Object.entries(p.etapas).forEach(([k, v]) => {
      if (v === 'ver' || v === 'editar') CO_ETAPAS[k] = v;
    });
  } else if (Array.isArray(p.etapas_permitidas)) {
    p.etapas_permitidas.forEach(id => {
      CO_ETAPAS[id] = 'editar';
    });
  }
  await etapasGarantir();
  pintarEtapasCorretor();
  openModal('modal-corretor-bg');
}

async function saveCorretor() {
  const name = document.getElementById('co-name').value.trim();
  const cpf = document.getElementById('co-cpf').value.replace(/\D/g, '');
  const pw = document.getElementById('co-password').value;
  if (!name) {
    toast('Informe o nome do corretor', 'error');
    return;
  }
  if (cpf.length !== 11) {
    toast('O CPF deve ter 11 dígitos — é o login do corretor', 'error');
    return;
  }
  if (!EDIT_CORRETOR_ID && pw.length < 6) {
    toast('Defina uma senha de ao menos 6 caracteres', 'error');
    return;
  }
  if (pw && pw.length < 6) {
    toast('A senha deve ter ao menos 6 caracteres', 'error');
    return;
  }

  const perms = permsColetar('co-perm', 'co-perfil');
  perms.etapas = { ...CO_ETAPAS };
  // Lista simples mantida junto para não quebrar leitura antiga do campo.
  perms.etapas_permitidas = Object.keys(CO_ETAPAS);
  if (
    !perms.etapas_permitidas.length &&
    !confirm(
      'Nenhuma etapa foi marcada. O corretor vai entrar no sistema e não verá processo nenhum. Salvar assim mesmo?'
    )
  )
    return;

  const atual = EDIT_CORRETOR_ID ? CORRETORES.find(x => x.id === EDIT_CORRETOR_ID) || {} : {};
  const payload = {
    tenant_id: G.user.tenant_id,
    type: 'corretor',
    name,
    cpf,
    email: document.getElementById('co-email').value.trim(),
    phone: document.getElementById('co-phone').value.trim(),
    is_active: document.getElementById('co-active').checked,
    approved: true,
    permissions: perms,
    perfil_id: document.getElementById('co-perfil').value || null,
    // O vínculo com o coordenador é o mesmo dado editado na tela do coordenador.
    // A imobiliária divide o mesmo `extra` porque é onde o pré-cadastro por link
    // já a gravava — duas moradas para o mesmo vínculo seria a divergência de
    // sempre.
    extra: {
      ...(atual.extra || {}),
      coordenador_id: document.getElementById('co-coordenador').value || null,
      imobiliaria_id: document.getElementById('co-imob').value || null
    }
  };
  if (pw) payload.password_hash = await sha256(pw + '::a1');

  const btn = document.getElementById('co-save-btn');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    let res;
    if (EDIT_CORRETOR_ID) {
      res = await fetch(`${A1.rest('a1_partners')}?id=eq.${EDIT_CORRETOR_ID}`, {
        method: 'PATCH',
        headers: A1.upsertHeaders(),
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch(A1.rest('a1_partners'), {
        method: 'POST',
        headers: A1.returnHeaders(),
        body: JSON.stringify(payload)
      });
    }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || 'HTTP ' + res.status);
    }
    toast(EDIT_CORRETOR_ID ? 'Corretor atualizado' : 'Corretor cadastrado', 'success');
    closeModal('modal-corretor-bg');
    loadCorretores();
  } catch (e) {
    toast('Erro ao salvar: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function deleteCorretor(id) {
  const c = CORRETORES.find(x => x.id === id);
  if (!confirm(`Excluir o corretor ${c ? c.name : ''}? Ele perde o acesso ao sistema.`)) return;
  const res = await fetch(`${A1.rest('a1_partners')}?id=eq.${id}`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  if (res.ok) {
    toast('Corretor excluído', 'info');
    loadCorretores();
  } else toast('Não foi possível excluir', 'error');
}

// ═══ Pré-cadastro de corretores por link ══════════════════════════════════════
// O gestor gera um link com prazo de validade; o corretor preenche só os dados
// de login numa página pública e o registro nasce SEM acesso (approved=false).
// A liberação é um ato do gestor, aqui na fila de validação — o link sozinho
// nunca dá entrada no sistema.
let PRECAD_PEND = [];
let PRECAD_LINKS = [];

function pintarPrecadBadge() {
  const b = document.getElementById('precad-badge');
  if (!b) return;
  b.style.display = PRECAD_PEND.length ? '' : 'none';
  b.textContent = PRECAD_PEND.length > 99 ? '99+' : String(PRECAD_PEND.length);
}

async function loadPrecad() {
  const [pend, links, imobs] = await Promise.all([
    fetch(`${A1.rest('a1_partners')}?type=eq.corretor&approved=eq.false&order=created_at.desc`, {
      headers: A1.headers()
    })
      .then(r => r.json())
      .catch(() => []),
    fetch(`${A1.rest('a1_precad_links')}?order=created_at.desc`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => []),
    G.imobsLoaded
      ? Promise.resolve(G.imobs)
      : fetch(`${A1.rest('a1_partners')}?type=eq.imobiliaria&order=name.asc`, { headers: A1.headers() })
          .then(r => r.json())
          .catch(() => [])
  ]);
  PRECAD_PEND = Array.isArray(pend) ? pend : [];
  PRECAD_LINKS = Array.isArray(links) ? links : [];
  if (!G.imobsLoaded && Array.isArray(imobs)) {
    G.imobs = imobs;
    G.imobsLoaded = true;
  }
  pintarPrecadBadge();
  renderPrecadPendentes();
  renderPrecadLinks(Array.isArray(links));
}

function dataHoraBR(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d)
    ? '—'
    : d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
}

function renderPrecadPendentes() {
  const tb = document.getElementById('precad-tbody');
  if (!tb) return;
  if (!PRECAD_PEND.length) {
    tb.innerHTML =
      '<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--t3)">Nenhum cadastro aguardando validação.</td></tr>';
    return;
  }
  tb.innerHTML = PRECAD_PEND.map(c => {
    const ex = c.extra || {};
    return `<tr>
      <td><b>${esc(c.name)}</b><div style="color:var(--t3);font-size:.7rem">${idChip(c.id)}</div></td>
      <td style="color:var(--t2)">${esc(c.cpf || '—')}</td>
      <td style="color:var(--t2);font-size:.78rem">${esc(c.email || '—')}<div style="color:var(--t3)">${esc(c.phone || '')}</div></td>
      <td style="color:var(--t2);font-size:.78rem">${esc(ex.imobiliaria_nome || '—')}</td>
      <td style="color:var(--t3);font-size:.75rem">${esc(dataHoraBR(ex.enviado_em || c.created_at))}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-primary btn-sm" onclick="validarPrecad('${c.id}')">Validar</button>
        <button class="btn btn-ghost btn-sm" style="color:#B8433A;border-color:#fecaca" onclick="recusarPrecad('${c.id}')">Recusar</button>
      </td></tr>`;
  }).join('');
}

async function validarPrecad(id) {
  const c = PRECAD_PEND.find(x => x.id === id);
  if (!c) return;
  if (
    !confirm(
      `Validar o cadastro de ${c.name}?\n\nEle passa a conseguir entrar no sistema. As etapas que ele pode ver e editar são definidas em Corretores.`
    )
  )
    return;

  // Permissão inicial mínima: entra e acompanha. Etapa nenhuma marcada ainda —
  // é o gestor quem decide onde ele atua.
  const corpo = { approved: true, is_active: true };
  const p = c.permissions;
  if (!p || typeof p !== 'object' || !Object.keys(p).length) {
    corpo.permissions = {
      criar_repasses: false,
      editar_repasses: false,
      alterar_etapa: false,
      ver_dashboard: false,
      ver_todos_analistas: false,
      etapas: {},
      etapas_permitidas: []
    };
  }
  const res = await fetch(`${A1.rest('a1_partners')}?id=eq.${id}`, {
    method: 'PATCH',
    headers: A1.upsertHeaders(),
    body: JSON.stringify(corpo)
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    toast('Não foi possível validar: ' + (e.message || 'HTTP ' + res.status), 'error');
    return;
  }
  toast(`${c.name} validado. Agora defina as etapas dele em Corretores.`, 'success');
  loadPrecad();
}

async function recusarPrecad(id) {
  const c = PRECAD_PEND.find(x => x.id === id);
  if (!c) return;
  if (
    !confirm(
      `Recusar o cadastro de ${c.name}?\n\nO registro é apagado e ele não terá acesso. Se for engano, ele pode se cadastrar de novo pelo link.`
    )
  )
    return;
  const res = await fetch(`${A1.rest('a1_partners')}?id=eq.${id}`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  if (res.ok) {
    toast('Cadastro recusado e removido', 'info');
    loadPrecad();
  } else toast('Não foi possível recusar', 'error');
}

// ── Links ────────────────────────────────────────────────────────────────────
function precadUrl(token) {
  return `${location.origin}/cadastro-corretor?t=${token}`;
}

function renderPrecadLinks(ok) {
  const tb = document.getElementById('precad-links-tbody');
  if (!tb) return;
  if (!ok) {
    tb.innerHTML =
      '<tr><td colspan="5" style="padding:1.4rem;text-align:center;color:#9A6008;font-size:.78rem">Os links de cadastro ainda não foram habilitados no banco. Rode o arquivo <code>sql/2026-08-26_precadastro_corretores.sql</code> no Supabase.</td></tr>';
    return;
  }
  if (!PRECAD_LINKS.length) {
    tb.innerHTML =
      '<tr><td colspan="5" style="padding:1.4rem;text-align:center;color:var(--t3)">Nenhum link gerado ainda.</td></tr>';
    return;
  }
  tb.innerHTML = PRECAD_LINKS.map(l => {
    const venceu = new Date(l.expires_at) < new Date();
    const sit = l.revoked
      ? '<span style="color:var(--t3);font-size:.75rem">Desativado</span>'
      : venceu
        ? '<span style="color:#9A6008;font-weight:700;font-size:.75rem">Vencido</span>'
        : '<span style="color:#0E8C7F;font-weight:700;font-size:.75rem">Ativo</span>';
    return `<tr>
      <td style="color:var(--t2);font-size:.8rem">${esc(l.imobiliaria_nome || '—')}</td>
      <td style="color:var(--t3);font-size:.75rem">até ${esc(dataHoraBR(l.expires_at))}</td>
      <td style="color:var(--t2);font-size:.8rem">${l.usos || 0}</td>
      <td>${sit}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="copiarPrecadUrl('${l.token}')">Copiar link</button>
        ${l.revoked ? '' : `<button class="btn btn-ghost btn-sm" style="color:#B8433A;border-color:#fecaca" onclick="revogarPrecadLink('${l.token}')">Desativar</button>`}
      </td></tr>`;
  }).join('');
}

function openPrecadLink() {
  const sel = document.getElementById('pl-imob');
  const imobs = Array.isArray(G.imobs) ? G.imobs : [];
  sel.innerHTML =
    '<option value="">Sem imobiliária</option>' +
    imobs.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('');
  if (!imobs.length && !G.imobsLoaded) {
    fetch(`${A1.rest('a1_partners')}?type=eq.imobiliaria&order=name.asc`, { headers: A1.headers() })
      .then(r => r.json())
      .then(list => {
        if (!Array.isArray(list)) return;
        G.imobs = list;
        G.imobsLoaded = true;
        sel.innerHTML =
          '<option value="">Sem imobiliária</option>' +
          list.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('');
      })
      .catch(() => {});
  }
  document.getElementById('pl-validade').value = '7';
  document.getElementById('pl-result').style.display = 'none';
  document.getElementById('pl-url').value = '';
  openModal('modal-precad-bg');
}

async function gerarPrecadLink() {
  const dias = parseInt(document.getElementById('pl-validade').value, 10) || 7;
  const sel = document.getElementById('pl-imob');
  const imobId = sel.value || null;
  const imobNome = imobId ? sel.options[sel.selectedIndex].textContent || null : null;
  const expira = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

  const btn = document.getElementById('pl-gerar-btn');
  btn.disabled = true;
  btn.textContent = 'Gerando...';
  try {
    const res = await fetch(A1.rest('a1_precad_links'), {
      method: 'POST',
      headers: A1.returnHeaders(),
      body: JSON.stringify({
        tenant_id: G.user.tenant_id,
        imobiliaria_id: imobId,
        imobiliaria_nome: imobNome,
        criado_por: G.user.name || null,
        expires_at: expira.toISOString()
      })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const msg =
        /a1_precad_links/.test(e.message || '') || res.status === 404
          ? 'Os links de cadastro ainda não foram habilitados no banco. Rode sql/2026-08-26_precadastro_corretores.sql no Supabase.'
          : e.message || 'HTTP ' + res.status;
      throw new Error(msg);
    }
    const rows = await res.json().catch(() => []);
    const token = rows && rows[0] && rows[0].token;
    if (!token) throw new Error('O banco não devolveu o link gerado.');

    document.getElementById('pl-url').value = precadUrl(token);
    document.getElementById('pl-hint').textContent =
      `Válido até ${dataHoraBR(expira)}. Pode ser usado por vários corretores — cada cadastro cai na fila de validação.`;
    document.getElementById('pl-result').style.display = '';
    copiarPrecadLink();
    if (document.getElementById('cfg-view-precad').style.display !== 'none') loadPrecad();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gerar link';
  }
}

function copiarPrecadLink() {
  copiarTexto(document.getElementById('pl-url').value);
}
function copiarPrecadUrl(token) {
  copiarTexto(precadUrl(token));
}

function copiarTexto(txt) {
  if (!txt) return;
  navigator.clipboard.writeText(txt).then(
    () => toast('Link copiado', 'success'),
    () => toast('Não foi possível copiar. O link é: ' + txt, 'info')
  );
}

async function revogarPrecadLink(token) {
  if (
    !confirm(
      'Desativar este link?\n\nQuem já se cadastrou continua na fila; o link só deixa de aceitar novos cadastros.'
    )
  )
    return;
  const res = await fetch(`${A1.rest('a1_precad_links')}?token=eq.${encodeURIComponent(token)}`, {
    method: 'PATCH',
    headers: A1.upsertHeaders(),
    body: JSON.stringify({ revoked: true })
  });
  if (res.ok) {
    toast('Link desativado', 'info');
    loadPrecad();
  } else toast('Não foi possível desativar o link', 'error');
}

// ═══ Usuários gestores ════════════════════════════════════════════════════════
// Gestor vive em a1_users (role owner/admin) e entra pelo login de Gestor.
// Só gestor cadastra gestor — a regra vale na tela E no banco: a política de
// a1_users só aceita escrita de quem tem papel owner/admin na sessão.
let GESTORES = [];
function souGestor() {
  return G.user && (G.user.role === 'owner' || G.user.role === 'admin');
}

async function loadGestores() {
  if (!souGestor()) {
    document.getElementById('gestor-tbody').innerHTML =
      '<tr><td colspan="6" class="pt-empty">Somente gestor.</td></tr>';
    return;
  }
  const [usuarios, marcas] = await Promise.all([
    fetch(
      `${A1.rest('a1_users')}?role=in.(owner,admin)&order=created_at.asc&select=id,name,cpf,email,role,is_active,created_at`,
      { headers: A1.headers() }
    )
      .then(r => r.json())
      .catch(() => []),
    fetch(`${A1.rest('a1_user_permissions')}?select=user_id,permission`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => [])
  ]);
  GESTORES = Array.isArray(usuarios) ? usuarios : [];
  const por = {};
  (Array.isArray(marcas) ? marcas : []).forEach(x => {
    (por[x.user_id] ||= []).push(x.permission);
  });
  GESTORES.forEach(u => (u.dashboard_permissions = por[u.id] || []));
  renderGestores();
}
function renderGestores() {
  const tb = document.getElementById('gestor-tbody');
  if (!tb) return;
  if (!GESTORES.length) {
    tb.innerHTML = '<tr><td colspan="7" class="pt-empty">Nenhum gestor cadastrado.</td></tr>';
    return;
  }
  tb.innerHTML = GESTORES.map(
    u =>
      `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.cpf || '—')}</td><td>${esc(u.email || '—')}</td><td>${u.role === 'owner' ? 'Proprietário' : 'Gestor'}</td><td>${u.is_active !== false ? 'Ativo' : 'Inativo'}</td><td>${idChip(u.id)}</td><td><button class="btn btn-ghost btn-sm" onclick="openGestor('${u.id}')">Editar</button> ${u.id === G.user.id ? '' : `<button class="btn btn-danger btn-sm" onclick="deleteGestor('${u.id}')">Excluir</button>`}</td></tr>`
  ).join('');
}
let EDIT_GESTOR_ID = null;
const GE_DASHBOARDS = [
  ['ver_dashboard_lead', 'crm', 'Leads'],
  ['ver_dashboard_pre_analise', 'PRE_ANALISE', 'Pré-análise'],
  ['ver_dashboard_venda', 'COMERCIAL', 'Venda'],
  ['ver_dashboard_repasse', 'repasse', 'Repasse'],
  ['ver_dashboard_registro', 'registro', 'Registro']
];
async function geMontarDashboards(u) {
  const box = document.getElementById('ge-dashboard-checks');
  if (!box) return;
  const marcadas = new Set(u?.dashboard_permissions || []);
  box.innerHTML = GE_DASHBOARDS.map(
    ([k, m, l]) =>
      `<label data-modulo="${m}" style="display:none;align-items:center;gap:.25rem;font-size:.78rem"><input class="ge-dashboard-perm" type="checkbox" value="${k}" ${marcadas.has(k) ? 'checked' : ''}> ${l}</label>`
  ).join('');
  const tem = await Promise.all(GE_DASHBOARDS.map(([, m]) => a1HasModule(m).catch(() => false)));
  [...box.children].forEach((el, i) => (el.style.display = tem[i] === true ? 'flex' : 'none'));
}
function openGestor(id) {
  if (!souGestor()) {
    toast('Somente gestor.', 'error');
    return;
  }
  const u = id ? GESTORES.find(x => x.id === id) : null;
  EDIT_GESTOR_ID = u?.id || null;
  document.getElementById('gestor-modal-title').textContent = u ? 'Editar gestor' : 'Novo gestor';
  document.getElementById('ge-name').value = u?.name || '';
  document.getElementById('ge-cpf').value = u?.cpf || '';
  document.getElementById('ge-email').value = u?.email || '';
  document.getElementById('ge-password').value = '';
  document.getElementById('ge-role').value = u?.role || 'admin';
  document.getElementById('ge-active').checked = u ? u.is_active !== false : true;
  openModal('modal-gestor-bg');
  geMontarDashboards(u);
}
async function saveGestor() {
  if (!souGestor()) return;
  const name = document.getElementById('ge-name').value.trim(),
    cpf = document.getElementById('ge-cpf').value.replace(/\D/g, ''),
    pw = document.getElementById('ge-password').value;
  if (!name || cpf.length !== 11 || (!EDIT_GESTOR_ID && pw.length < 6)) {
    toast('Informe nome, CPF e senha válida.', 'error');
    return;
  }
  const body = {
    tenant_id: G.user.tenant_id,
    name,
    cpf,
    email: document.getElementById('ge-email').value.trim(),
    role: document.getElementById('ge-role').value,
    is_active: document.getElementById('ge-active').checked
  };
  if (pw) body.password_hash = await sha256(pw + '::a1');
  const res = EDIT_GESTOR_ID
    ? await fetch(`${A1.rest('a1_users')}?id=eq.${EDIT_GESTOR_ID}`, {
        method: 'PATCH',
        headers: A1.upsertHeaders(),
        body: JSON.stringify(body)
      })
    : await fetch(`${A1.rest('a1_users')}?select=id`, {
        method: 'POST',
        headers: A1.returnHeaders(),
        body: JSON.stringify(body)
      });
  if (!res.ok) {
    toast('Erro ao salvar gestor.', 'error');
    return;
  }
  const id = EDIT_GESTOR_ID || ((await res.json().catch(() => []))[0] || {}).id;
  if (!id) {
    toast('Gestor salvo; não foi possível salvar os módulos.', 'error');
    return;
  }
  const keys = ['dashboard_access_configured', ...GE_DASHBOARDS.map(x => x[0])];
  await fetch(`${A1.rest('a1_user_permissions')}?user_id=eq.${id}&permission=in.(${keys.join(',')})`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  const selected = [...document.querySelectorAll('.ge-dashboard-perm:checked')].map(x => x.value);
  const p = await fetch(A1.rest('a1_user_permissions'), {
    method: 'POST',
    headers: A1.returnHeaders(),
    body: JSON.stringify(
      ['dashboard_access_configured', ...selected].map(permission => ({ user_id: id, permission }))
    )
  });
  if (!p.ok) {
    toast('Gestor salvo, mas os módulos não foram gravados.', 'error');
    return;
  }
  a1ClearModuleCache();
  toast('Gestor e módulos atualizados', 'success');
  closeModal('modal-gestor-bg');
  loadGestores();
}

async function deleteGestor(id) {
  if (!souGestor()) {
    toast('Somente um gestor pode remover outro gestor.', 'error');
    return;
  }
  if (id === G.user.id) {
    toast('Você não pode excluir o próprio usuário.', 'error');
    return;
  }
  const u = GESTORES.find(x => x.id === id);
  if (!confirm(`Excluir o gestor ${u ? u.name : ''}? Ele perde o acesso ao sistema.`)) return;
  const res = await fetch(`${A1.rest('a1_users')}?id=eq.${id}`, { method: 'DELETE', headers: A1.headers() });
  if (res.ok) {
    toast('Gestor excluído', 'info');
    loadGestores();
  } else toast('Não foi possível excluir', 'error');
}

async function sha256(msg) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function refreshCorrLimits() {
  const tipo = G.tenant?.tipo_cliente || '';
  const maxUsers = G.tenant?.max_users || 999;

  // ── Empresas: limite de 1 para correspondente_bancario
  const EMPRESA_LIMIT = { correspondente_bancario: 1, imobiliaria: 1 };
  const maxEmpresas = EMPRESA_LIMIT[tipo] ?? 999;
  const qtdEmpresas = G.empresas.length;
  const btnEmpresa = document.getElementById('btn-nova-empresa');
  const bannerEmpresa = document.getElementById('corr-empresa-limit-banner');

  if (maxEmpresas < 999) {
    if (qtdEmpresas >= maxEmpresas) {
      if (btnEmpresa) btnEmpresa.style.display = 'none';
      if (bannerEmpresa) {
        bannerEmpresa.textContent = `Limite atingido: seu plano permite apenas ${maxEmpresas} empresa${maxEmpresas > 1 ? 's' : ''} cadastrada${maxEmpresas > 1 ? 's' : ''}.`;
        bannerEmpresa.style.display = '';
      }
    } else {
      if (btnEmpresa) btnEmpresa.style.display = '';
      if (bannerEmpresa) bannerEmpresa.style.display = 'none';
    }
  } else {
    if (btnEmpresa) btnEmpresa.style.display = '';
    if (bannerEmpresa) bannerEmpresa.style.display = 'none';
  }

  // ── Usuários: limite pelo max_users do plano
  const qtdUsers = G.partners.length;
  const btnUser = document.getElementById('btn-novo-usuario');
  const counter = document.getElementById('corr-user-counter');
  const bannerUser = document.getElementById('corr-user-limit-banner');

  // Cadastro de usuários é ILIMITADO; o plano limita apenas acessos simultâneos.
  if (counter)
    counter.textContent = `${qtdUsers} cadastrado${qtdUsers !== 1 ? 's' : ''} · ${maxUsers} acesso${maxUsers !== 1 ? 's' : ''} simultâneo${maxUsers !== 1 ? 's' : ''}`;
  if (btnUser) btnUser.style.display = '';
  if (bannerUser) bannerUser.style.display = 'none';
}

function switchCorrTab(tab) {
  const isEmpresas = tab === 'empresas';
  document.getElementById('corr-panel-empresas').style.display = isEmpresas ? '' : 'none';
  document.getElementById('corr-panel-usuarios').style.display = isEmpresas ? 'none' : '';
  const btnE = document.getElementById('corr-tab-empresas');
  const btnU = document.getElementById('corr-tab-usuarios');
  btnE.style.background = isEmpresas ? '#fff' : 'none';
  btnE.style.color = isEmpresas ? 'var(--t1)' : 'var(--t3)';
  btnE.style.boxShadow = isEmpresas ? '0 1px 4px rgba(0,0,0,.1)' : 'none';
  btnU.style.background = !isEmpresas ? '#fff' : 'none';
  btnU.style.color = !isEmpresas ? 'var(--t1)' : 'var(--t3)';
  btnU.style.boxShadow = !isEmpresas ? '0 1px 4px rgba(0,0,0,.1)' : 'none';
}

async function loadEmpresas() {
  G.empresasLoaded = true;
  G.empresas = await fetch(`${A1.rest('a1_corr_empresas')}?order=name.asc`, { headers: A1.headers() })
    .then(r => r.json())
    .catch(() => []);
  ceFilter();
  const opts = G.empresas.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  const sel = document.getElementById('pt-empresa');
  if (sel) sel.innerHTML = '<option value="">Todas as empresas</option>' + opts;
  refreshCorrLimits();
}

function ceFilter() {
  const q = (document.getElementById('ce-search')?.value || '').toLowerCase();
  const status = document.getElementById('ce-status')?.value || '';
  G.ceFiltered = G.empresas.filter(e => {
    if (status === 'active' && !e.is_active) return false;
    if (status === 'inactive' && e.is_active) return false;
    if (q) {
      const hay = `${e.name} ${e.cnpj || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  G.cePage = 0;
  renderEmpresaTable();
}

function renderEmpresaTable() {
  const tbody = document.getElementById('ce-tbody');
  const total = G.ceFiltered.length;
  const start = G.cePage * G.cePerPage;
  const page = G.ceFiltered.slice(start, start + G.cePerPage);
  document.getElementById('ce-count').textContent =
    total === 0 ? 'Nenhum resultado' : `${start + 1}–${Math.min(start + page.length, total)} de ${total}`;
  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="pt-empty">Nenhuma empresa encontrada.</td></tr>`;
    return;
  }
  tbody.innerHTML = page
    .map(e => {
      const st = e.is_active
        ? `<span class="pt-status"><span class="pt-dot pt-dot-green"></span>Ativa</span>`
        : `<span class="pt-status"><span class="pt-dot pt-dot-red"></span>Inativa</span>`;
      return `<tr>
      <td style="font-weight:600">${esc(e.name)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:.73rem">${esc(e.cnpj || '—')}</td>
      <td>${esc(e.email || '—')}</td>
      <td>${esc(e.phone || '—')}</td>
      <td>${esc(e.regional || '—')}</td>
      <td>${st}</td>
      <td><div style="display:flex;gap:.3rem">
        <button class="pt-act" onclick="openEmpresaModal('${e.id}')">Editar</button>
        <button class="pt-act danger" onclick="deleteEmpresa('${e.id}','${escJs(e.name)}')">Excluir</button>
      </div></td>
    </tr>`;
    })
    .join('');
}

function openEmpresaModal(id) {
  const e = id ? G.empresas.find(x => x.id === id) : null;
  G.editingEmpresaId = e ? e.id : null;
  document.getElementById('empresa-modal-title').textContent = e
    ? 'Editar empresa'
    : 'Nova empresa correspondente';
  document.getElementById('ce-f-name').value = e?.name || '';
  document.getElementById('ce-f-cnpj').value = e?.cnpj || '';
  document.getElementById('ce-f-email').value = e?.email || '';
  document.getElementById('ce-f-phone').value = e?.phone || '';
  document.getElementById('ce-f-regional').value = e?.regional || '';
  document.getElementById('ce-f-address').value = e?.address || '';
  document.getElementById('ce-f-active').checked = e ? !!e.is_active : true;
  document.getElementById('modal-empresa-bg').classList.remove('hidden');
}

async function saveEmpresa() {
  const name = document.getElementById('ce-f-name').value.trim();
  if (!name) {
    toast('Nome da empresa e obrigatorio', 'error');
    return;
  }
  const payload = {
    tenant_id: G.user.tenant_id,
    name,
    cnpj: document.getElementById('ce-f-cnpj').value.trim(),
    email: document.getElementById('ce-f-email').value.trim(),
    phone: document.getElementById('ce-f-phone').value.trim(),
    regional: document.getElementById('ce-f-regional').value.trim(),
    address: document.getElementById('ce-f-address').value.trim(),
    is_active: document.getElementById('ce-f-active').checked
  };
  const btn = document.getElementById('ce-save-btn');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    if (G.editingEmpresaId) {
      const res = await fetch(`${A1.rest('a1_corr_empresas')}?id=eq.${G.editingEmpresaId}`, {
        method: 'PATCH',
        headers: A1.upsertHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(res.status);
      const idx = G.empresas.findIndex(e => e.id === G.editingEmpresaId);
      if (idx !== -1) G.empresas[idx] = { ...G.empresas[idx], ...payload };
      toast('Empresa atualizada', 'success');
    } else {
      const [created] = await fetch(A1.rest('a1_corr_empresas'), {
        method: 'POST',
        headers: A1.returnHeaders(),
        body: JSON.stringify(payload)
      }).then(r => r.json());
      if (!created) throw new Error('no data');
      G.empresas.push(created);
      G.empresas.sort((a, b) => a.name.localeCompare(b.name));
      toast('Empresa criada', 'success');
    }
    ceFilter();
    const opts = G.empresas.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    const sel = document.getElementById('pt-empresa');
    if (sel) sel.innerHTML = '<option value="">Todas as empresas</option>' + opts;
    refreshCorrLimits();
    closeModal('modal-empresa-bg');
  } catch {
    toast('Erro ao salvar empresa.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function deleteEmpresa(id, name) {
  if (!confirm(`Excluir a empresa "${name}"? Todos os usuários vinculados perderão a associação.`)) return;
  const res = await fetch(`${A1.rest('a1_corr_empresas')}?id=eq.${id}`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  if (res.ok || res.status === 204) {
    G.empresas = G.empresas.filter(e => e.id !== id);
    ceFilter();
    refreshCorrLimits();
    toast('Empresa removida', 'info');
  } else toast('Erro ao remover empresa', 'error');
}

// As regionais são cadastradas em Configurações > Regionais (a1_config), mas só
// eram carregadas ao abrir aquela tela. Quem ia direto para Empreendimentos
// pegava a lista vazia.
async function garantirRegionais() {
  if (Array.isArray(G.regionais) && G.regionais.length) return G.regionais;
  try {
    const rows = await fetch(`${A1.rest('a1_config')}?key=eq.regionais&select=value`, {
      headers: A1.headers()
    }).then(r => r.json());
    let list = [];
    try {
      list = JSON.parse((rows && rows[0] && rows[0].value) || '[]');
    } catch {}
    G.regionais = Array.isArray(list) ? list : [];
  } catch {
    G.regionais = G.regionais || [];
  }
  return G.regionais;
}

// Monta o seletor de regional. Inclui a regional já gravada no registro que
// está sendo editado mesmo que ela não esteja mais no cadastro — sem isso o
// campo abria vazio e a regional era apagada no primeiro Salvar.
function preencherSelectRegional(sel, atual) {
  if (!sel) return;
  const usadas = (Array.isArray(G.empreendimentos) ? G.empreendimentos : [])
    .map(e => e.regional)
    .filter(Boolean);
  const antigas = etapasLista()
    .map(s => s.group_key)
    .filter(Boolean); // modelo antigo
  const cadastradas = Array.isArray(G.regionais) ? G.regionais : [];
  const lista = [...new Set([...cadastradas, ...usadas, ...antigas, ...(atual ? [atual] : [])])]
    .filter(x => typeof x === 'string')
    .sort((x, y) => x.localeCompare(y));
  sel.innerHTML =
    '<option value="">Selecione...</option>' +
    lista.map(r => `<option value="${esc(r)}"${r === atual ? ' selected' : ''}>${esc(r)}</option>`).join('');
  sel.value = atual || '';
}

async function loadEmpreendimentos() {
  G.emprLoaded = true;
  const [devs] = await Promise.all([
    fetch(`${A1.rest('a1_developments')}?order=name.asc`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => []),
    garantirRegionais()
  ]);
  G.empreendimentos = Array.isArray(devs) ? devs : [];
  renderEmprList();
  preencherSelectRegional(document.getElementById('empr-f-regional'), '');
}

function renderEmprList() {
  const el = document.getElementById('empr-list');
  if (!G.empreendimentos.length) {
    el.innerHTML = `<div style="color:var(--t3);font-size:.77rem;text-align:center;padding:1.5rem 0">Nenhum empreendimento cadastrado.</div>`;
    return;
  }
  el.innerHTML = `<table class="pt-table">
    <thead><tr><th>Nome</th><th>Regional</th><th>Cidade / UF</th><th>Tipo</th><th>Unidades</th><th style="width:18%">ID</th><th></th></tr></thead>
    <tbody>${G.empreendimentos
      .map(
        d => `<tr>
      <td style="font-weight:600">${esc(d.name)}</td>
      <td>${esc(d.regional || '—')}</td>
      <td style="font-size:.78rem">${d.cidade || d.estado ? esc([d.cidade, d.estado].filter(Boolean).join(' / ')) : '<span style="color:var(--t3)">—</span>'}</td>
      <td><span class="pt-type" style="background:#e0f2fe;color:#0284c7">${d.tipo || 'blocos'}</span></td>
      <td style="font-family:'DM Mono',monospace;font-size:.73rem">${d.unit_count || 0} unidades</td>
      <td>${idChip(d.id)}</td>
      <td style="display:flex;gap:.35rem">
        <button class="pt-act" onclick="editEmpreendimento('${d.id}')">Editar</button>
        <button class="pt-act danger" onclick="deleteEmpreendimento('${d.id}','${escJs(d.name)}')">Excluir</button>
      </td>
    </tr>`
      )
      .join('')}</tbody>
  </table>`;
}

function toggleEmprSemUnidades() {
  const checked = document.getElementById('empr-f-sem-unidades').checked;
  document.getElementById('empr-unidades-wrap').style.display = checked ? 'none' : '';
  document.getElementById('empr-save-btn').textContent = checked
    ? G.editingEmprId
      ? 'Salvar Alterações'
      : 'Cadastrar'
    : G.editingEmprId
      ? 'Salvar Alterações'
      : 'Cadastrar Unidades';
}

// ── Estados e municípios (base do IBGE, tabela a1_estados / a1_municipios) ────
// A lista inteira do Brasil não vem para o navegador: os estados são 27 e as
// cidades chegam só do estado escolhido — nenhum estado passa de 853 (Minas).
const LOC = { estados: null, cidades: {} };

async function carregarEstados() {
  if (LOC.estados) return LOC.estados;
  const rows = await fetch(`${A1.rest('a1_estados')}?select=uf,nome&order=nome.asc`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .catch(() => null);
  LOC.estados = Array.isArray(rows) ? rows : [];
  return LOC.estados;
}

async function carregarCidades(uf) {
  if (!uf) return [];
  if (LOC.cidades[uf]) return LOC.cidades[uf];
  const rows = await fetch(
    `${A1.rest('a1_municipios')}?uf=eq.${encodeURIComponent(uf)}&select=nome&order=nome.asc`,
    { headers: A1.headers() }
  )
    .then(r => r.json())
    .catch(() => null);
  LOC.cidades[uf] = Array.isArray(rows) ? rows.map(r => r.nome) : [];
  return LOC.cidades[uf];
}

async function preencherEstados(atual) {
  const sel = document.getElementById('empr-f-estado');
  if (!sel) return;
  const lista = await carregarEstados();
  if (!lista.length) {
    // Sem a tabela no banco, dizer o que fazer vale mais que um campo vazio.
    sel.innerHTML = '<option value="">Rode o SQL de estados e municípios</option>';
    return;
  }
  sel.innerHTML =
    '<option value="">Selecione...</option>' +
    lista
      .map(
        e => `<option value="${e.uf}"${e.uf === atual ? ' selected' : ''}>${esc(e.nome)} (${e.uf})</option>`
      )
      .join('');
}

async function preencherCidades(uf, atual) {
  const sel = document.getElementById('empr-f-cidade');
  if (!sel) return;
  if (!uf) {
    sel.innerHTML = '<option value="">Escolha o estado primeiro</option>';
    return;
  }
  sel.innerHTML = '<option value="">Carregando...</option>';
  const lista = await carregarCidades(uf);
  // Se o estado mudou enquanto a lista vinha, esta resposta já não vale.
  if (document.getElementById('empr-f-estado')?.value !== uf) return;
  if (!lista.length) {
    sel.innerHTML = '<option value="">Nenhuma cidade encontrada</option>';
    return;
  }
  sel.innerHTML =
    '<option value="">Selecione...</option>' +
    lista.map(n => `<option${n === atual ? ' selected' : ''}>${esc(n)}</option>`).join('');
  // Cidade gravada antes que não está mais na lista continua aparecendo, senão
  // salvar de novo apagaria o dado sem ninguém perceber.
  if (atual && !lista.includes(atual))
    sel.insertAdjacentHTML('beforeend', `<option selected>${esc(atual)}</option>`);
}

function emprEstadoMudou() {
  preencherCidades(document.getElementById('empr-f-estado').value, '');
}

function openEmprModal() {
  G.editingEmprId = null;
  document.getElementById('empr-form-title').textContent = 'Novo empreendimento';
  document.getElementById('empr-save-btn').textContent = 'Cadastrar Unidades';
  document.getElementById('empr-f-name').value = '';
  document.getElementById('empr-f-qtd').value = '1';
  document.getElementById('empr-f-pav').value = '1';
  document.getElementById('empr-f-upf').value = '4';
  preencherSelectRegional(document.getElementById('empr-f-regional'), '');
  preencherEstados('');
  preencherCidades('', '');
  document.getElementById('empr-f-sem-unidades').checked = false;
  document.getElementById('empr-unidades-wrap').style.display = '';
  document.getElementById('empr-err').style.display = 'none';
  G.emprTipo = 'blocos';
  setEmprTipo('blocos');
  document.getElementById('empr-list-panel').style.display = 'none';
  document.getElementById('empr-form-panel').style.display = '';
  emprPreview();
}

function editEmpreendimento(id) {
  const d = G.empreendimentos.find(x => x.id === id);
  if (!d) return;
  G.editingEmprId = id;
  const semUnidades = !d.unit_count || d.unit_count === 0;
  document.getElementById('empr-form-title').textContent = 'Editar empreendimento';
  document.getElementById('empr-save-btn').textContent = 'Salvar Alterações';
  document.getElementById('empr-f-name').value = d.name || '';
  document.getElementById('empr-f-qtd').value = d.qtd_blocos || 1;
  document.getElementById('empr-f-pav').value = d.pavimentos || 1;
  document.getElementById('empr-f-upf').value = d.unidades_pav || 4;
  preencherSelectRegional(document.getElementById('empr-f-regional'), d.regional || '');
  preencherEstados(d.estado || '').then(() => preencherCidades(d.estado || '', d.cidade || ''));
  document.getElementById('empr-f-sem-unidades').checked = semUnidades;
  document.getElementById('empr-unidades-wrap').style.display = semUnidades ? 'none' : '';
  document.getElementById('empr-err').style.display = 'none';
  setEmprTipo(d.tipo || 'blocos');
  document.getElementById('empr-list-panel').style.display = 'none';
  document.getElementById('empr-form-panel').style.display = '';
  emprPreview();
}

function closeEmprForm() {
  G.editingEmprId = null;
  document.getElementById('empr-save-btn').textContent = 'Cadastrar Unidades';
  document.getElementById('empr-f-sem-unidades').checked = false;
  document.getElementById('empr-unidades-wrap').style.display = '';
  document.getElementById('empr-list-panel').style.display = '';
  document.getElementById('empr-form-panel').style.display = 'none';
}

function setEmprTipo(tipo) {
  G.emprTipo = tipo;
  const isBlocos = tipo === 'blocos';
  document.getElementById('empr-tipo-blocos').className = isBlocos
    ? 'btn btn-primary btn-sm'
    : 'btn btn-ghost btn-sm';
  document.getElementById('empr-tipo-quadras').className = !isBlocos
    ? 'btn btn-primary btn-sm'
    : 'btn btn-ghost btn-sm';
  document.getElementById('empr-qtd-label').textContent = isBlocos ? 'Qtd. Blocos' : 'Qtd. Quadras';
  emprPreview();
}

function emprPreview() {
  if (document.getElementById('empr-f-sem-unidades')?.checked) return;
  const qtd = Math.max(1, parseInt(document.getElementById('empr-f-qtd')?.value) || 1);
  const pav = Math.max(1, parseInt(document.getElementById('empr-f-pav')?.value) || 1);
  const upf = Math.max(1, parseInt(document.getElementById('empr-f-upf')?.value) || 1);
  const tipo = G.emprTipo;
  const prefix = tipo === 'blocos' ? 'B' : 'Q';
  const label = tipo === 'blocos' ? 'BLOCO' : 'QUADRA';
  const total = qtd * pav * upf;

  let html = '';
  for (let b = 1; b <= Math.min(qtd, 3); b++) {
    const units = [];
    for (let p = 1; p <= pav; p++) {
      for (let u = 1; u <= upf; u++) {
        const seq = `${p - 1}${u.toString().padStart(2, '0')}`;
        units.push(`${prefix}${b}-${seq}`);
      }
    }
    const shown = units.slice(0, 8).join('  ');
    const more = units.length > 8 ? ` <span style="color:var(--t3)">+${units.length - 8} mais</span>` : '';
    html += `<div style="margin-bottom:.5rem"><span style="font-weight:700;color:var(--t1)">${label} ${b}:</span>  ${shown}${more}</div>`;
  }
  if (qtd > 3)
    html += `<div style="color:var(--t3)">... e mais ${qtd - 3} ${tipo === 'blocos' ? 'blocos' : 'quadras'}</div>`;

  document.getElementById('empr-preview').innerHTML = html || '—';
  const lbl = document.getElementById('empr-total-label');
  if (lbl)
    lbl.textContent = `Total: ${total} unidades (${qtd} ${label.toLowerCase()}${qtd > 1 ? 's' : ''} × ${pav} pav. × ${upf} un./pav.)`;
}

async function saveEmpreendimento() {
  limparEmprErr();
  const name = document.getElementById('empr-f-name').value.trim();
  if (!name) {
    showEmprErr('Informe o nome do empreendimento');
    return;
  }
  const semUnidades = document.getElementById('empr-f-sem-unidades').checked;

  let units = [],
    qtd = 1,
    pav = 1,
    upf = 1;
  if (!semUnidades) {
    qtd = parseInt(document.getElementById('empr-f-qtd').value) || 1;
    pav = parseInt(document.getElementById('empr-f-pav').value) || 1;
    upf = parseInt(document.getElementById('empr-f-upf').value) || 1;
    const prefix = G.emprTipo === 'blocos' ? 'B' : 'Q';
    for (let b = 1; b <= qtd; b++) {
      for (let p = 1; p <= pav; p++) {
        for (let u = 1; u <= upf; u++) {
          const seq = `${p - 1}${u.toString().padStart(2, '0')}`;
          units.push(`${prefix}${b}-${seq}`);
        }
      }
    }
  }

  const payload = {
    name,
    regional: document.getElementById('empr-f-regional').value,
    estado: document.getElementById('empr-f-estado').value || null,
    cidade: document.getElementById('empr-f-cidade').value || null,
    unit_count: units.length,
    units: units,
    ...(semUnidades
      ? {}
      : {
          tipo: G.emprTipo,
          qtd_blocos: qtd,
          pavimentos: pav,
          unidades_pav: upf
        })
  };

  const btn = document.getElementById('empr-save-btn');
  const isEditing = !!G.editingEmprId;
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    if (isEditing) {
      const r = await enviarEmpr(`${A1.rest('a1_developments')}?id=eq.${G.editingEmprId}`, 'PATCH', payload);
      if (!r.ok) throw new Error(r.msg);
      const idx = G.empreendimentos.findIndex(d => d.id === G.editingEmprId);
      if (idx >= 0) G.empreendimentos[idx] = { ...G.empreendimentos[idx], ...payload };
      G.empreendimentos.sort((a, b) => a.name.localeCompare(b.name));
      renderEmprList();
      closeEmprForm();
      toast(`"${name}" atualizado${units.length ? ` com ${units.length} unidades` : ''}.`, 'success');
    } else {
      const r = await enviarEmpr(A1.rest('a1_developments'), 'POST', {
        ...payload,
        tenant_id: G.user.tenant_id
      });
      if (!r.ok) throw new Error(r.msg);
      const [created] = Array.isArray(r.dados) ? r.dados : [];
      if (!created) throw new Error('O servidor aceitou mas não devolveu o registro criado.');
      G.empreendimentos.push(created);
      G.empreendimentos.sort((a, b) => a.name.localeCompare(b.name));
      renderEmprList();
      closeEmprForm();
      toast(`"${name}" cadastrado${units.length ? ` com ${units.length} unidades` : ''}.`, 'success');
    }
  } catch (e) {
    showEmprErr('Não foi possível salvar: ' + (e.message || 'erro desconhecido'));
  } finally {
    btn.disabled = false;
    btn.textContent = isEditing ? 'Salvar Alterações' : 'Cadastrar Unidades';
  }
}

// O aviso sumia sozinho em 4 segundos — quem desviava o olhar via só o botão
// "não fazer nada". Agora fica até a próxima tentativa de salvar.
function showEmprErr(msg) {
  const el = document.getElementById('empr-err');
  el.textContent = msg;
  el.style.display = '';
}
function limparEmprErr() {
  const el = document.getElementById('empr-err');
  if (el) el.style.display = 'none';
}

// PostgREST recusa a requisição INTEIRA quando o corpo traz uma coluna que a
// tabela não possui (PGRST204) — já aconteceu antes neste sistema. Em vez de
// falhar por completo, remove a coluna apontada e tenta de novo, avisando o
// que foi descartado.
async function enviarEmpr(url, metodo, corpo) {
  let payload = { ...corpo };
  const removidas = [];
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const res = await fetch(url, {
      method: metodo,
      headers: A1.returnHeaders(),
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      if (removidas.length) {
        toast(
          'Salvo, mas estes campos não existem na tabela e foram ignorados: ' + removidas.join(', '),
          'info'
        );
      }
      const dados = await res.json().catch(() => null);
      return { ok: true, dados, removidas };
    }
    const err = await res.json().catch(() => ({}));
    const msg = err.message || err.hint || `HTTP ${res.status}`;
    const m = /'([^']+)' column|column "([^"]+)"|Could not find the '([^']+)'/i.exec(msg);
    const col = m && (m[1] || m[2] || m[3]);
    if (col && Object.prototype.hasOwnProperty.call(payload, col)) {
      delete payload[col];
      removidas.push(col);
      continue;
    }
    return { ok: false, msg };
  }
  return { ok: false, msg: 'Não foi possível salvar mesmo após ajustar os campos.' };
}

async function deleteEmpreendimento(id, name) {
  if (!confirm(`Excluir o empreendimento "${name}"? Esta acao nao pode ser desfeita.`)) return;
  const res = await fetch(`${A1.rest('a1_developments')}?id=eq.${id}`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  if (res.ok || res.status === 204) {
    G.empreendimentos = G.empreendimentos.filter(d => d.id !== id);
    renderEmprList();
    toast('Empreendimento removido', 'info');
  } else toast('Erro ao remover', 'error');
}

async function loadImobs() {
  G.imobsLoaded = true;
  G.imobs = await fetch(`${A1.rest('a1_partners')}?type=eq.imobiliaria&order=name.asc`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .catch(() => []);
  imobFilter();
}

function imobFilter() {
  const q = (document.getElementById('imob-search')?.value || '').toLowerCase();
  const st = document.getElementById('imob-status')?.value || '';
  G.imobFiltered = G.imobs.filter(i => {
    if (st === 'active' && !i.is_active) return false;
    if (st === 'inactive' && i.is_active) return false;
    if (q) {
      const hay = `${i.name} ${i.cpf || ''} ${i.email || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  G.imobPage = 0;
  renderImobList();
}

function renderImobList() {
  const tbody = document.getElementById('imob-tbody');
  const total = G.imobFiltered.length;
  const pp = G.imobPerPage;
  const page = G.imobPage;
  const slice = G.imobFiltered.slice(page * pp, page * pp + pp);
  if (!total) {
    tbody.innerHTML = `<tr><td colspan="8" class="pt-empty">${G.imobs.length ? 'Nenhuma imobiliária encontrada.' : 'Nenhuma imobiliária cadastrada ainda.'}</td></tr>`;
    document.getElementById('imob-count').textContent = '0 registros';
    document.getElementById('imob-pg-btns').innerHTML = '';
    return;
  }
  tbody.innerHTML = slice
    .map(
      i => `
    <tr>
      <td><strong>${esc(i.name)}</strong></td>
      <td>${esc(i.cpf || '—')}</td>
      <td>${esc(i.email || '—')}</td>
      <td>${esc(i.phone || '—')}</td>
      <td>${esc(i.region || '—')}</td>
      <td><span class="status-dot ${i.is_active ? 'active' : 'inactive'}"></span>${i.is_active ? 'Ativa' : 'Inativa'}</td>
      <td>${idChip(i.id)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="openImob(${JSON.stringify(i).replace(/"/g, '&quot;')})">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="deleteImob('${i.id}','${escJs(i.name)}')">Excluir</button>
      </td>
    </tr>`
    )
    .join('');
  document.getElementById('imob-count').textContent = `${total} imobiliária${total !== 1 ? 's' : ''}`;
  const pages = Math.ceil(total / pp);
  document.getElementById('imob-pg-btns').innerHTML =
    pages <= 1
      ? ''
      : Array.from(
          { length: pages },
          (_, k) =>
            `<button class="pg-btn${k === page ? ' active' : ''}" onclick="G.imobPage=${k};renderImobList()">${k + 1}</button>`
        ).join('');
}

function openImob(i) {
  G.editingImobId = i?.id || null;
  document.getElementById('imob-modal-title').textContent = i ? 'Editar imobiliária' : 'Nova imobiliária';
  document.getElementById('imob-f-name').value = i?.name || '';
  document.getElementById('imob-f-cnpj').value = i?.cpf || '';
  document.getElementById('imob-f-email').value = i?.email || '';
  document.getElementById('imob-f-phone').value = i?.phone || '';
  document.getElementById('imob-f-region').value = i?.region || '';
  document.getElementById('imob-f-site').value = i?.website || '';
  document.getElementById('imob-f-active').checked = i ? !!i.is_active : true;
  const btn = document.getElementById('imob-save-btn');
  btn.disabled = false;
  btn.textContent = 'Salvar';
  document.getElementById('modal-imob-bg').classList.remove('hidden');
}

async function saveImob() {
  const name = document.getElementById('imob-f-name').value.trim();
  if (!name) {
    toast('Informe o nome da imobiliária', 'error');
    return;
  }
  const _cnpj = document.getElementById('imob-f-cnpj').value.trim();
  const _email = document.getElementById('imob-f-email').value.trim();
  const payload = {
    tenant_id: G.user.tenant_id,
    type: 'imobiliaria',
    name,
    cpf: _cnpj || null,
    email: _email || null,
    phone: document.getElementById('imob-f-phone').value.trim() || null,
    region: document.getElementById('imob-f-region').value.trim() || null,
    website: document.getElementById('imob-f-site').value.trim() || null,
    is_active: document.getElementById('imob-f-active').checked
  };
  const btn = document.getElementById('imob-save-btn');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    if (G.editingImobId) {
      const res = await fetch(`${A1.rest('a1_partners')}?id=eq.${G.editingImobId}`, {
        method: 'PATCH',
        headers: A1.upsertHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(res.status);
      const idx = G.imobs.findIndex(i => i.id === G.editingImobId);
      if (idx !== -1) G.imobs[idx] = { ...G.imobs[idx], ...payload };
      toast('Imobiliária atualizada', 'success');
    } else {
      const res = await fetch(A1.rest('a1_partners'), {
        method: 'POST',
        headers: A1.returnHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(res.status);
      const [created] = await res.json();
      if (created) G.imobs.push(created);
      toast('Imobiliária cadastrada', 'success');
    }
    closeModal('modal-imob-bg');
    imobFilter();
  } catch (e) {
    toast(`Erro ao salvar: ${e.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function deleteImob(id, name) {
  if (!confirm(`Excluir a imobiliária "${name}"? Esta ação não pode ser desfeita.`)) return;
  const res = await fetch(`${A1.rest('a1_partners')}?id=eq.${id}`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  if (res.ok || res.status === 204) {
    G.imobs = G.imobs.filter(i => i.id !== id);
    imobFilter();
    toast('Imobiliária removida', 'info');
  } else toast('Erro ao remover', 'error');
}

async function loadAnalistas() {
  G.analistasLoaded = true;
  await perfisGarantir();
  G.analistas = await fetch(`${A1.rest('a1_partners')}?type=eq.analista&order=name.asc`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .catch(() => []);
  analistaFilter();
}

function analistaFilter() {
  const q = (document.getElementById('analista-search')?.value || '').toLowerCase();
  const st = document.getElementById('analista-status-filter')?.value;
  G.analistaFiltered = G.analistas.filter(a => {
    if (q && !a.name.toLowerCase().includes(q)) return false;
    if (st !== '' && st !== undefined) {
      if (String(a.is_active !== false) !== st) return false;
    }
    return true;
  });
  G.analistaPage = 0;
  renderAnalistaList();
}

function renderAnalistaList() {
  const tbody = document.getElementById('analista-tbody');
  if (!tbody) return;
  const total = G.analistaFiltered.length;
  const page = G.analistaFiltered.slice(
    G.analistaPage * G.analistaPerPage,
    (G.analistaPage + 1) * G.analistaPerPage
  );
  if (!total) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--t3)">Nenhum analista encontrado.</td></tr>';
    return;
  }
  tbody.innerHTML = page
    .map(a => {
      const p = a.permissions || {};
      const mapa = p.etapas && typeof p.etapas === 'object' && !Array.isArray(p.etapas) ? p.etapas : null;
      const ed = mapa ? Object.keys(mapa).filter(k => mapa[k] === 'editar') : [];
      const vr = mapa ? Object.keys(mapa).filter(k => mapa[k] === 'ver') : [];
      const chip = (t, cor, bg) =>
        `<span style="display:inline-block;font-size:.68rem;font-weight:700;padding:.1rem .45rem;border-radius:5px;background:${bg};color:${cor};margin-right:.25rem">${t}</span>`;
      const acesso = !mapa
        ? '<span style="color:var(--t3);font-size:.72rem">Sem restrição por etapa</span>'
        : ed.length || vr.length
          ? (ed.length ? chip(ed.length + ' editar', '#047857', '#ecfdf5') : '') +
            (vr.length ? chip(vr.length + ' ver', '#1e40af', '#eff6ff') : '')
          : '<span style="color:#9A6008;font-size:.72rem">Nenhuma etapa — não verá nada</span>';
      const semLogin = !a.cpf ? '<div style="color:#9A6008;font-size:.68rem">sem login</div>' : '';
      return `<tr>
    <td style="font-weight:600">${esc(a.name)}${perfilEtiqueta(a.perfil_id)}${p.ver_todos_analistas ? '<div style="font-size:.66rem;color:#3F6F9E;font-weight:700">vê todos</div>' : ''}</td>
    <td style="color:var(--t2)">${esc(a.cpf || '—')}${semLogin}</td>
    <td style="color:var(--t2);font-size:.78rem">${esc(a.email || '—')}${a.phone ? `<div style="color:var(--t3)">${esc(a.phone)}</div>` : ''}</td>
    <td>${acesso}</td>
    <td>${a.is_active !== false ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-red">Inativo</span>'}</td>
    <td>${idChip(a.id)}</td>
    <td><div style="display:flex;gap:.3rem">
      <button class="btn btn-ghost btn-sm" onclick="openAnalista(${JSON.stringify(a).replace(/"/g, '&quot;')})">Editar</button>
      <button class="btn btn-danger btn-sm" onclick="deleteAnalista('${a.id}','${escJs(a.name)}')">Excluir</button>
    </div></td>
  </tr>`;
    })
    .join('');
  // pagination
  const pages = Math.ceil(total / G.analistaPerPage);
  const pgEl = document.getElementById('analista-pg-btns');
  if (pgEl)
    pgEl.innerHTML =
      pages <= 1
        ? ''
        : `<button class="pt-pg-btn" ${G.analistaPage === 0 ? 'disabled' : ''} onclick="G.analistaPage--;renderAnalistaList()">Anterior</button>` +
          Array.from(
            { length: pages },
            (_, i) =>
              `<button class="pt-pg-btn${G.analistaPage === i ? ' active' : ''}" onclick="G.analistaPage=${i};renderAnalistaList()">${i + 1}</button>`
          ).join('') +
          `<button class="pt-pg-btn" ${G.analistaPage === pages - 1 ? 'disabled' : ''} onclick="G.analistaPage++;renderAnalistaList()">Próximo</button>`;
}

// O cartão que esta função pintava saiu da tela: analista não escolhe mais ver
// tudo. Fica como no-op porque o HTML antigo ainda podia chamá-la, e uma
// referência quebrada num onchange derruba o formulário inteiro.
function paintAnVisao() {}

async function openAnalista(a) {
  G.editingAnalistaId = a?.id || null;
  ETAPAS_PREFIXO = 'an';
  document.getElementById('analista-modal-title').textContent = a ? 'Editar analista' : 'Novo analista';
  if (!G.empresasLoaded) loadEmpresas().then(() => _populateAnalistaEmpresa(a?.empresa_id));
  else _populateAnalistaEmpresa(a?.empresa_id);
  document.getElementById('analista-f-name').value = a?.name || '';
  document.getElementById('analista-f-cpf').value = a?.cpf || '';
  document.getElementById('analista-f-email').value = a?.email || '';
  document.getElementById('analista-f-phone').value = a?.phone || '';
  document.getElementById('analista-f-password').value = '';
  document.getElementById('analista-pw-hint').textContent = a ? '(deixe vazio para manter a atual)' : '*';
  document.getElementById('analista-f-active').checked = a ? a.is_active !== false : true;

  const p = a?.permissions || {};
  // "Ver todos" tem cartão próprio logo abaixo das caixas; gerente e
  // compartilhar carteira não pertencem a este cadastro.
  permsMontar('an-perm-caixas', 'an-perm', ['gerente', 'ver_todos_repasses', 'ver_todos_analistas']);
  const PADRAO = {
    criar_repasses: false,
    ver_repasses: true,
    editar_repasses: true,
    alterar_etapa: true,
    ver_dashboard: true
  };
  document.querySelectorAll('.an-perm').forEach(cb => {
    const k = cb.dataset.key;
    cb.checked = k in p ? !!p[k] : (PADRAO[k] ?? false);
  });
  paintAnVisao();
  await perfisParaSelect(document.getElementById('an-perfil'), a?.perfil_id);
  perfilAplicado('an-perfil', 'an-perm');

  // Etapas já cadastradas; sem elas o seletor abriria vazio.
  if (!Array.isArray(G.stages) || !G.stages.length) {
    G.stages = await fetch(`${A1.rest('a1_stages')}?module_key=eq.repasse&order=position.asc`, {
      headers: A1.headers()
    })
      .then(r => r.json())
      .catch(() => []);
    if (!Array.isArray(G.stages)) G.stages = [];
  }
  await etapasGarantir();
  CO_ETAPAS = {};
  if (p.etapas && typeof p.etapas === 'object' && !Array.isArray(p.etapas)) {
    Object.entries(p.etapas).forEach(([k, v]) => {
      if (v === 'ver' || v === 'editar') CO_ETAPAS[k] = v;
    });
  } else if (!a) {
    // Analista novo nasce podendo editar em todas as etapas — de todos os
    // módulos licenciados — e o gestor restringe a partir daí. Analista
    // existente sem configuração segue sem restrição.
    etapasGrupos().forEach(g =>
      g.etapas.forEach(st => {
        CO_ETAPAS[st.id] = 'editar';
      })
    );
  }
  pintarEtapasCorretor();

  const btn = document.getElementById('analista-save-btn');
  btn.disabled = false;
  btn.textContent = 'Salvar';
  document.getElementById('modal-analista-bg').classList.remove('hidden');
}

function _populateAnalistaEmpresa(selectedId) {
  const sel = document.getElementById('analista-f-empresa');
  sel.innerHTML =
    '<option value="">Selecione...</option>' +
    G.empresas
      .filter(e => e.is_active !== false)
      .map(e => `<option value="${e.id}">${esc(e.name)}</option>`)
      .join('');
  if (selectedId) sel.value = selectedId;
}

async function saveAnalista() {
  const name = document.getElementById('analista-f-name').value.trim();
  if (!name) {
    toast('Informe o nome do analista', 'error');
    return;
  }
  const cpf = document.getElementById('analista-f-cpf').value.replace(/\D/g, '');
  const pw = document.getElementById('analista-f-password').value;
  if (cpf.length !== 11) {
    toast('O CPF deve ter 11 dígitos — é o login do analista', 'error');
    return;
  }
  if (!G.editingAnalistaId && pw.length < 6) {
    toast('Defina uma senha de ao menos 6 caracteres', 'error');
    return;
  }
  if (pw && pw.length < 6) {
    toast('A senha deve ter ao menos 6 caracteres', 'error');
    return;
  }

  const perms = permsColetar('an-perm', 'an-perfil');
  perms.etapas = { ...CO_ETAPAS };
  perms.etapas_permitidas = Object.keys(CO_ETAPAS);
  if (
    !perms.etapas_permitidas.length &&
    !confirm(
      'Nenhuma etapa foi marcada. O analista vai entrar no sistema e não verá processo nenhum. Salvar assim mesmo?'
    )
  )
    return;

  const empresaId = document.getElementById('analista-f-empresa').value || null;
  const payload = {
    tenant_id: G.user.tenant_id,
    type: 'analista',
    name,
    cpf,
    email: document.getElementById('analista-f-email').value.trim(),
    phone: document.getElementById('analista-f-phone').value.trim(),
    is_active: document.getElementById('analista-f-active').checked,
    approved: true,
    permissions: perms,
    perfil_id: document.getElementById('an-perfil').value || null,
    empresa_id: empresaId
  };
  if (pw) payload.password_hash = await sha256(pw + '::a1');
  const btn = document.getElementById('analista-save-btn');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    if (G.editingAnalistaId) {
      const res = await fetch(`${A1.rest('a1_partners')}?id=eq.${G.editingAnalistaId}`, {
        method: 'PATCH',
        headers: A1.upsertHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error();
      const idx = G.analistas.findIndex(a => a.id === G.editingAnalistaId);
      if (idx !== -1) G.analistas[idx] = { ...G.analistas[idx], ...payload };
      toast('Analista atualizado', 'success');
    } else {
      const res = await fetch(A1.rest('a1_partners'), {
        method: 'POST',
        headers: A1.returnHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error();
      const [created] = await res.json();
      if (created) G.analistas.push(created);
      G.analistas.sort((a, b) => a.name.localeCompare(b.name));
      toast('Analista criado', 'success');
    }
    closeModal('modal-analista-bg');
    analistaFilter();
  } catch (e) {
    toast('Erro ao salvar analista: ' + (e.message || 'verifique os dados'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function deleteAnalista(id, name) {
  if (!confirm(`Excluir o analista "${name}"? Esta ação não pode ser desfeita.`)) return;
  const res = await fetch(`${A1.rest('a1_partners')}?id=eq.${id}`, {
    method: 'DELETE',
    headers: A1.headers()
  });
  if (res.ok || res.status === 204) {
    G.analistas = G.analistas.filter(a => a.id !== id);
    analistaFilter();
    toast('Analista removido', 'info');
  } else toast('Erro ao remover', 'error');
}

function v(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function toast(msg, type = 'info') {
  const wrap = document.getElementById('toast-wrap');
  const d = document.createElement('div');
  d.className = `toast toast-${type}`;
  d.textContent = msg;
  wrap.appendChild(d);
  setTimeout(() => d.remove(), 3200);
}

// Os três cadastros abaixo dividem o mesmo formato: carrega, guarda a lista e
// desenha. A busca refiltra o que já está na memória — antes ela chamava uma
// função que não existia e digitar não fazia nada.
// O id do container muda entre as telas ('bancos-list' aqui, 'banco-list' no
// pipeline), então aceita os dois em vez de desistir em silêncio.
function _listaEl(...ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}
function _combina(texto, termo) {
  return (
    !termo ||
    String(texto || '')
      .toLowerCase()
      .includes(termo)
  );
}

async function loadDespachantes() {
  G.despLoaded = true;
  const list = _listaEl('desp-list');
  if (!list) return;
  list.innerHTML = '<p style="color:#888;padding:1rem">Carregando…</p>';
  try {
    const rows = await fetch(A1.tbl('despachantes') + '?order=nome.asc', { headers: A1.headers() }).then(r =>
      r.json()
    );
    G.despachantes = Array.isArray(rows) ? rows : [];
  } catch (e) {
    list.innerHTML = '<p style="color:#c00;padding:1rem">Erro ao carregar despachantes.</p>';
    return;
  }
  renderDespachantes();
}

function renderDespachantes() {
  const list = _listaEl('desp-list');
  if (!list) return;
  const q = (document.getElementById('desp-search')?.value || '').toLowerCase();
  const rows = (G.despachantes || []).filter(d =>
    _combina(`${d.nome || ''} ${d.email || ''} ${d.telefone || ''}`, q)
  );
  if (!rows.length) {
    list.innerHTML = `<p style="color:#888;padding:1rem">${(G.despachantes || []).length ? 'Nenhum despachante encontrado.' : 'Nenhum despachante cadastrado.'}</p>`;
    return;
  }
  list.innerHTML = rows
    .map(
      d => `
      <div class="cfg-list-row">
        <div>
          <div class="cfg-list-name">${esc(d.nome) || '—'}</div>
          <div class="cfg-list-sub">${esc(d.email || '')} ${d.telefone ? '· ' + esc(d.telefone) : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.4rem">
          ${idChip(d.id)}
          <button class="btn-icon" onclick="editDespachante('${escJs(d.id)}')">✏️</button>
        </div>
      </div>`
    )
    .join('');
}
function filtrarDespachantes() {
  renderDespachantes();
}

async function loadBancos() {
  G.bancosLoaded = true;
  const list = _listaEl('bancos-list', 'banco-list');
  if (!list) return;
  list.innerHTML = '<p style="color:#888;padding:1rem">Carregando…</p>';
  try {
    const rows = await fetch(A1.tbl('bancos') + '?order=nome.asc', { headers: A1.headers() }).then(r =>
      r.json()
    );
    G.bancos = Array.isArray(rows) ? rows : [];
  } catch (e) {
    list.innerHTML = '<p style="color:#c00;padding:1rem">Erro ao carregar bancos.</p>';
    return;
  }
  renderBancos();
}

function renderBancos() {
  const list = _listaEl('bancos-list', 'banco-list');
  if (!list) return;
  const q = (document.getElementById('banco-search')?.value || '').toLowerCase();
  const rows = (G.bancos || []).filter(b => _combina(`${b.nome || ''} ${b.codigo || ''}`, q));
  if (!rows.length) {
    list.innerHTML = `<p style="color:#888;padding:1rem">${(G.bancos || []).length ? 'Nenhum banco encontrado.' : 'Nenhum banco cadastrado.'}</p>`;
    return;
  }
  list.innerHTML = rows
    .map(
      b => `
      <div class="cfg-list-row">
        <div>
          <div class="cfg-list-name">${esc(b.nome) || '—'}</div>
          <div class="cfg-list-sub">${b.codigo ? 'Cód. ' + esc(b.codigo) : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.4rem">
          ${idChip(b.id)}
          <button class="btn-icon" onclick="editBanco('${escJs(b.id)}')">✏️</button>
        </div>
      </div>`
    )
    .join('');
}
function filtrarBancos() {
  renderBancos();
}

async function loadCartorios() {
  G.cartoriosLoaded = true;
  const list = _listaEl('cartorios-list', 'cart-list');
  if (!list) return;
  list.innerHTML = '<p style="color:#888;padding:1rem">Carregando…</p>';
  try {
    const rows = await fetch(A1.tbl('cartorios') + '?order=nome.asc', { headers: A1.headers() }).then(r =>
      r.json()
    );
    G.cartorios = Array.isArray(rows) ? rows : [];
  } catch (e) {
    list.innerHTML = '<p style="color:#c00;padding:1rem">Erro ao carregar cartórios.</p>';
    return;
  }
  renderCartorios();
}

function renderCartorios() {
  const list = _listaEl('cartorios-list', 'cart-list');
  if (!list) return;
  const q = (document.getElementById('cart-search')?.value || '').toLowerCase();
  const rows = (G.cartorios || []).filter(c =>
    _combina(`${c.nome || ''} ${c.municipio || ''} ${c.uf || ''}`, q)
  );
  if (!rows.length) {
    list.innerHTML = `<p style="color:#888;padding:1rem">${(G.cartorios || []).length ? 'Nenhum cartório encontrado.' : 'Nenhum cartório cadastrado.'}</p>`;
    return;
  }
  list.innerHTML = rows
    .map(
      c => `
      <div class="cfg-list-row">
        <div>
          <div class="cfg-list-name">${esc(c.nome) || '—'}</div>
          <div class="cfg-list-sub">${esc(c.municipio || '')} ${c.uf ? '– ' + esc(c.uf) : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.4rem">
          ${idChip(c.id)}
          <button class="btn-icon" onclick="editCartorio('${escJs(c.id)}')">✏️</button>
        </div>
      </div>`
    )
    .join('');
}
function filtrarCartorios() {
  renderCartorios();
}

function editDespachante(id) {
  toast('Em breve: editar despachante', 'info');
}

function editBanco(id) {
  toast('Em breve: editar banco', 'info');
}

function editCartorio(id) {
  toast('Em breve: editar cartório', 'info');
}

function openDespModal() {
  ['desp-nome', 'desp-cpf', 'desp-email', 'desp-tel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('desp-err').style.display = 'none';
  document.getElementById('modal-desp-bg').classList.remove('hidden');
  setTimeout(() => document.getElementById('desp-nome').focus(), 60);
}

async function saveDespachante() {
  const nome = document.getElementById('desp-nome').value.trim();
  const errEl = document.getElementById('desp-err');
  if (!nome) {
    errEl.textContent = 'Nome é obrigatório.';
    errEl.style.display = '';
    return;
  }
  errEl.style.display = 'none';
  const body = {
    nome,
    cpf_cnpj: document.getElementById('desp-cpf').value.trim() || null,
    email: document.getElementById('desp-email').value.trim() || null,
    telefone: document.getElementById('desp-tel').value.trim() || null
  };
  const res = await fetch(A1.tbl('despachantes'), {
    method: 'POST',
    headers: { ...A1.headers(), Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
  if (res.ok || res.status === 201) {
    toast('Despachante cadastrado.', 'success');
    closeModal('modal-desp-bg');
    G.despLoaded = false;
    loadDespachantes();
  } else {
    const err = await res.json().catch(() => ({}));
    errEl.textContent = err.message || 'Erro ao salvar.';
    errEl.style.display = '';
  }
}

function openBancoModal() {
  ['banco-nome', 'banco-codigo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('banco-err').style.display = 'none';
  document.getElementById('modal-banco-bg').classList.remove('hidden');
  setTimeout(() => document.getElementById('banco-nome').focus(), 60);
}

async function saveBanco() {
  const nome = document.getElementById('banco-nome').value.trim();
  const errEl = document.getElementById('banco-err');
  if (!nome) {
    errEl.textContent = 'Nome é obrigatório.';
    errEl.style.display = '';
    return;
  }
  errEl.style.display = 'none';
  const body = { nome, codigo: document.getElementById('banco-codigo').value.trim() || null };
  const res = await fetch(A1.tbl('bancos'), {
    method: 'POST',
    headers: { ...A1.headers(), Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
  if (res.ok || res.status === 201) {
    toast('Banco cadastrado.', 'success');
    closeModal('modal-banco-bg');
    G.bancosLoaded = false;
    loadBancos();
  } else {
    const err = await res.json().catch(() => ({}));
    errEl.textContent = err.message || 'Erro ao salvar.';
    errEl.style.display = '';
  }
}

function openCartorioModal() {
  ['cart-nome', 'cart-mun', 'cart-uf', 'cart-cns'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('cart-err').style.display = 'none';
  document.getElementById('modal-cartorio-bg').classList.remove('hidden');
  setTimeout(() => document.getElementById('cart-nome').focus(), 60);
}

async function saveCartorio() {
  const nome = document.getElementById('cart-nome').value.trim();
  const errEl = document.getElementById('cart-err');
  if (!nome) {
    errEl.textContent = 'Nome é obrigatório.';
    errEl.style.display = '';
    return;
  }
  errEl.style.display = 'none';
  const body = {
    nome,
    municipio: document.getElementById('cart-mun').value.trim() || null,
    uf: (document.getElementById('cart-uf').value.trim() || null)?.toUpperCase(),
    cns: document.getElementById('cart-cns').value.trim() || null
  };
  const res = await fetch(A1.tbl('cartorios'), {
    method: 'POST',
    headers: { ...A1.headers(), Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
  if (res.ok || res.status === 201) {
    toast('Cartório cadastrado.', 'success');
    closeModal('modal-cartorio-bg');
    G.cartoriosLoaded = false;
    loadCartorios();
  } else {
    const err = await res.json().catch(() => ({}));
    errEl.textContent = err.message || 'Erro ao salvar.';
    errEl.style.display = '';
  }
}

// ═══ Configurações dos módulos novos (Pré-análise e Venda) ═══════════════
// A regra que manda em tudo o que vem abaixo: sem a licença, NADA disto existe.
// Não é tela escondida por CSS — o cartão e a sub-tela só são criados depois de
// a1HasModule responder exatamente `true`. Antes disso não há elemento no DOM,
// não há nome em CFG_VIEWS e não sai uma consulta sequer às tabelas do módulo.
//
// O editor em si é o mesmo que já roda no superadmin (renderEsteira), trazido
// para cá com quatro diferenças: fala com o token da sessão (A1) em vez da
// chave de serviço, o cliente é o da sessão em vez de um seletor, o módulo é
// fixo por tela (quem só tem Pré-análise não vê a palavra "Venda" num
// select) e não há DELETE. Esse último é grant, não RLS: a Pré-análise recebeu
// select/insert/update e a Venda ganhou delete, então um botão "Apagar"
// daria 403 numa tela e funcionaria na outra. Nas duas, remover é desmarcar
// "Ativa" — a coluna já existe nas quatro tabelas, as filas já buscam com
// ativo=is.true e a1_pa_transicionar já exige `and ativo`.

// `false` = ainda nao confirmado. cfgModsLiberar so age quando o valor e
// literalmente false: assim uma resposta que nao chegou nao vira "tem".
const CFG_MOD_LIB = { PRE_ANALISE: false, COMERCIAL: false, crm: false };

const CFG_ICONE_FLUXO = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="STROKE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
const CFG_ICONE_INTEGRA = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C87E12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`;
const CFG_ICONE_CICLO = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0E8C7F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-5V2"/><path d="M4 17h5v5"/><path d="M5.1 9A8 8 0 0 1 18 5l2 2"/><path d="M18.9 15A8 8 0 0 1 6 19l-2-2"/></svg>`;

// Cria o cartão no hub. Vai para dentro de um grupo que já existe — o dono
// quer todos os workflows do cliente no mesmo bloco, e grupo criado por
// licença seria reexibido pela busca (filtrarHub só mexe na classe .oculto).
function cfgModsCartao(def) {
  const grade = document.getElementById(def.grade);
  if (!grade || document.getElementById(def.id)) return;
  const el = document.createElement('div');
  el.className = 'cfg-hub-card';
  el.id = def.id;
  el.setAttribute('data-modulo', def.modulo);
  el.addEventListener('click', () => openCfgView(def.view));
  el.innerHTML = `<div class="cfg-hub-icon" style="background:${def.fundo}">${def.icone}</div>
                  <div class="cfg-card-label">${esc(def.rotulo)}</div>`;
  grade.appendChild(el);
}

// Cria a sub-tela e a registra no roteador. Sem entrar em CFG_VIEWS,
// closeCfgView() não a esconderia e ela ficaria empilhada por cima do hub.
function cfgModsVista(nome, titulo, corpoHtml) {
  const host = document.getElementById('cfg-mods-views');
  if (!host || document.getElementById('cfg-view-' + nome)) return;
  const el = document.createElement('div');
  el.id = 'cfg-view-' + nome;
  el.style.display = 'none';
  el.innerHTML = `
    <div class="cfg-view-hdr">
      <button class="cfg-back-btn" onclick="closeCfgView()">← Configuracoes</button>
      <div class="cfg-view-title">${esc(titulo)}</div>
    </div>${corpoHtml}`;
  host.appendChild(el);
  if (!CFG_VIEWS.includes(nome)) CFG_VIEWS.push(nome);
}

// O editor de esteira em tabela viveu aqui. Saiu porque virou DOIS editores
// para a mesma coisa: uma tabela em Configurações e o quadro do Repasse em
// workflow.html. O gestor tinha de aprender os dois, e um deles nem mostrava
// as setas. O quadro passou a atender os módulos novos, e este ficou órfão.
// Manter código que ninguém chama é guardar armadilha para quem vier depois.

// ══ Perfis de acesso ═════════════════════════════════════════════════════════
// O que o gestor descreve aqui vira a permissão efetiva de todo mundo vinculado.
// A resolução de verdade mora em duas pontas que precisam concordar:
// a1_perm() no banco, que decide o que a API entrega, e a1RefreshPartnerPerms()
// em src/shared/auth/auth.js, que decide o que a tela mostra. Esta tela só edita a descrição.
const PERFIS = { lista: [], editando: null };

async function perfisCarregar() {
  const corpo = document.getElementById('perfis-corpo');
  corpo.innerHTML = '<div class="pt-empty">carregando…</div>';
  const linhas = await fetch(`${A1.rest('a1_perfis')}?order=nome.asc`, { headers: A1.headers() })
    .then(r => (r.ok ? r.json() : []))
    .catch(() => []);
  PERFIS.lista = Array.isArray(linhas) ? linhas : [];
  perfisRender();
}

// Quais permissões existem para ESTE cliente. Um módulo não liberado não
// aparece — do mesmo jeito que a aba dele não aparece.
function perfisDisponiveis() {
  return a1PermissoesPorModulo({
    crm: !!G.temCRM,
    PRE_ANALISE: !!G.temPA,
    COMERCIAL: !!G.temCO,
    repasse: G.temRepasse === true,
    registro: !!G.temRegistro
  });
}

function perfisRender() {
  const corpo = document.getElementById('perfis-corpo');
  const btnModelos = document.getElementById('perfis-modelos');
  if (btnModelos) btnModelos.style.display = PERFIS.lista.length ? 'none' : '';

  if (!PERFIS.lista.length) {
    corpo.innerHTML = `<div class="pt-empty">
      Nenhum perfil ainda. Enquanto não houver, cada pessoa continua valendo pelas
      marcas soltas do cadastro dela — que é como o sistema sempre funcionou.</div>`;
    return;
  }

  const nomes = Object.fromEntries(A1_PERMISSOES.map(p => [p.chave, p.rotulo]));
  corpo.innerHTML = `<div class="tbl-wrap"><table class="pt-table"><thead><tr>
      <th>Perfil</th><th>O que pode fazer</th><th>Pessoas</th><th></th>
    </tr></thead><tbody>${PERFIS.lista
      .map(p => {
        const marcadas = Object.entries(p.permissions || {})
          .filter(([, v]) => v === true)
          .map(([k]) => nomes[k] || k);
        return `<tr>
        <td><div style="font-weight:700">${esc(p.nome)}</div>
          ${p.descricao ? `<div style="font-size:.7rem;color:var(--t3)">${esc(p.descricao)}</div>` : ''}
          ${p.ativo === false ? '<span class="pt-badge pt-off">Inativo</span>' : ''}</td>
        <td style="font-size:.73rem;color:var(--t2);max-width:420px">
          ${marcadas.length ? esc(marcadas.join(' · ')) : '<em>nada — quem estiver neste perfil não faz nada</em>'}</td>
        <td class="mono" id="perfil-qtd-${esc(p.id)}">—</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost btn-xs" onclick="perfilAbrir('${escJs(p.id)}')">Editar</button>
          <button class="btn btn-danger btn-xs" onclick="perfilApagar('${escJs(p.id)}')">Excluir</button>
        </td></tr>`;
      })
      .join('')}</tbody></table></div>`;
  perfisContarPessoas();
}

// Quantas pessoas estão em cada perfil. Importa na hora de mexer: alterar um
// perfil com trinta pessoas é diferente de alterar um vazio, e a tela tem de
// dizer isso antes, não depois.
async function perfisContarPessoas() {
  const linhas = await fetch(`${A1.rest('a1_partners')}?select=perfil_id&perfil_id=not.is.null`, {
    headers: A1.headers()
  })
    .then(r => (r.ok ? r.json() : []))
    .catch(() => []);
  const conta = {};
  (Array.isArray(linhas) ? linhas : []).forEach(l => {
    conta[l.perfil_id] = (conta[l.perfil_id] || 0) + 1;
  });
  PERFIS.lista.forEach(p => {
    const el = document.getElementById('perfil-qtd-' + p.id);
    if (el) el.textContent = conta[p.id] || 0;
  });
}

function perfilAbrir(id) {
  PERFIS.editando = id ? PERFIS.lista.find(x => x.id === id) || null : null;
  const p = PERFIS.editando || { nome: '', descricao: '', permissions: {}, ativo: true };
  const grupos = perfisDisponiveis();

  // Perfil NOVO nasce fechado — é de propósito, e está escrito no catálogo. A
  // única exceção é 'ver_repasses': ela não concede nada, ela abre o módulo.
  // Um perfil novo que nascesse com ela desmarcada trancaria para fora do
  // Repasse todo mundo que fosse vinculado a ele, e o gestor não teria como
  // adivinhar que a caixa desmarcada era a causa.
  const novo = !PERFIS.editando;
  const marcada = chave => (novo ? chave === 'ver_repasses' : (p.permissions || {})[chave] === true);

  const blocos = [...grupos.entries()]
    .map(
      ([mod, itens]) => `
    <div class="pf-grupo">
      <div class="pf-grupo-titulo">${esc(A1_ROTULO_MODULO[mod] || mod)}</div>
      ${itens
        .map(
          i => `
        <label class="pf-item" title="${esc(i.ajuda)}">
          <input type="checkbox" class="pf-perm" data-chave="${esc(i.chave)}"
                 ${marcada(i.chave) ? 'checked' : ''}>
          <span><span class="pf-rotulo">${esc(i.rotulo)}</span>
            <span class="pf-ajuda">${esc(i.ajuda)}</span></span>
        </label>`
        )
        .join('')}
    </div>`
    )
    .join('');

  document.getElementById('modal-perfil-titulo').textContent = id ? 'Editar perfil' : 'Novo perfil';
  document.getElementById('perfil-nome').value = p.nome || '';
  document.getElementById('perfil-desc').value = p.descricao || '';
  document.getElementById('perfil-ativo').checked = p.ativo !== false;
  document.getElementById('perfil-permissoes').innerHTML = blocos;
  document.getElementById('perfil-erro').style.display = 'none';
  document.getElementById('modal-perfil-bg').classList.remove('hidden');
}

async function perfilSalvar() {
  const nome = document.getElementById('perfil-nome').value.trim();
  const erro = document.getElementById('perfil-erro');
  if (!nome) {
    erro.textContent = 'Dê um nome ao perfil.';
    erro.style.display = 'block';
    return;
  }

  const permissions = {};
  document.querySelectorAll('#perfil-permissoes .pf-perm').forEach(c => {
    if (c.checked) permissions[c.dataset.chave] = true;
  });

  const corpo = {
    tenant_id: G.user.tenant_id,
    nome,
    descricao: document.getElementById('perfil-desc').value.trim() || null,
    permissions,
    ativo: document.getElementById('perfil-ativo').checked,
    atualizado_em: new Date().toISOString()
  };

  const alvo = PERFIS.editando ? `${A1.rest('a1_perfis')}?id=eq.${PERFIS.editando.id}` : A1.rest('a1_perfis');
  const res = await fetch(alvo, {
    method: PERFIS.editando ? 'PATCH' : 'POST',
    headers: A1.headers(),
    body: JSON.stringify(corpo)
  });
  if (!res.ok) {
    // Nome repetido tem índice único: dois perfis "Corretor" seriam dois
    // significados para a mesma palavra na tela de cadastro.
    const m = await res.json().catch(() => ({}));
    erro.textContent = /duplicate|unique/i.test(m.message || '')
      ? 'Já existe um perfil com esse nome.'
      : 'Não foi possível salvar. Só o gestor edita perfis.';
    erro.style.display = 'block';
    return;
  }
  closeModal('modal-perfil-bg');
  toast(
    PERFIS.editando ? 'Perfil atualizado. Quem está nele já segue as novas permissões.' : 'Perfil criado.',
    'success'
  );
  await perfisCarregar();
}

async function perfilApagar(id) {
  const p = PERFIS.lista.find(x => x.id === id);
  if (!p) return;
  const qtd = (document.getElementById('perfil-qtd-' + id) || {}).textContent || '0';
  if (
    !confirm(
      Number(qtd) > 0
        ? `${qtd} pessoa(s) estão neste perfil. Apagar devolve cada uma às marcas soltas do próprio cadastro. Continuar?`
        : `Apagar o perfil "${p.nome}"?`
    )
  )
    return;
  const res = await fetch(`${A1.rest('a1_perfis')}?id=eq.${id}`, { method: 'DELETE', headers: A1.headers() });
  if (!res.ok) {
    toast('Não foi possível apagar.', 'error');
    return;
  }
  toast('Perfil apagado.', 'warn');
  await perfisCarregar();
}

// Ponto de partida, não regra. Sai do catálogo, então não inventa chave.
async function perfisSemear() {
  const linhas = A1_PERFIS_MODELO.map(m => ({
    tenant_id: G.user.tenant_id,
    nome: m.nome,
    ativo: true,
    permissions: Object.fromEntries(
      m.permissoes
        // Só as permissões dos módulos que este cliente tem: semear marca de
        // módulo que ele não comprou seria guardar promessa que não se cumpre.
        .filter(k => {
          const d = A1_PERMISSOES.find(x => x.chave === k);
          return (
            d &&
            (!d.modulo ||
              d.modulo === 'repasse' ||
              (d.modulo === 'PRE_ANALISE' && G.temPA) ||
              (d.modulo === 'COMERCIAL' && G.temCO))
          );
        })
        .map(k => [k, true])
    )
  }));
  const res = await fetch(A1.rest('a1_perfis'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify(linhas)
  });
  if (!res.ok) {
    toast('Não foi possível criar os perfis.', 'error');
    return;
  }
  toast('Perfis criados. Ajuste cada um antes de vincular gente.', 'success');
  await perfisCarregar();
}

// Preenche um <select> de perfil. Usado pelos cadastros de gente.
async function perfisParaSelect(sel, valor) {
  if (!sel) return;
  if (!PERFIS.lista.length) {
    // Carrega todos, inclusive os inativos: um cadastro pode estar vinculado a
    // um perfil que foi desligado, e a tela precisa poder dizer isso.
    const linhas = await fetch(`${A1.rest('a1_perfis')}?order=nome.asc`, { headers: A1.headers() })
      .then(r => (r.ok ? r.json() : []))
      .catch(() => []);
    PERFIS.lista = Array.isArray(linhas) ? linhas : [];
  }
  const ativos = PERFIS.lista.filter(p => p.ativo !== false);
  // Se a pessoa está num perfil que foi desativado, ele ainda aparece — marcado
  // como inativo. Deixar cair para "Sem perfil" apagaria o vínculo em silêncio
  // no primeiro salvamento, e o gestor nunca saberia que existiu.
  const inativo = valor && !ativos.some(p => p.id === valor) ? PERFIS.lista.find(p => p.id === valor) : null;
  sel.innerHTML =
    '<option value="">Sem perfil — usar as marcas abaixo</option>' +
    ativos.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('') +
    (inativo ? `<option value="${esc(inativo.id)}">${esc(inativo.nome)} (inativo)</option>` : '');
  sel.value = valor && (inativo || ativos.some(p => p.id === valor)) ? valor : '';
  // O cadastro está reabrindo: o que estava travado da vez anterior não vale
  // mais. Sem isto, abrir o corretor A depois do B gravaria as marcas de B.
  sel._marcas = null;
}

// ─── As caixas de permissão dos cadastros de gente ───────────────────────────
//
// Vêm todas do mesmo catálogo (src/shared/auth/permissoes.js), agrupadas por módulo, e só
// entram as dos módulos que ESTE cliente tem licenciado. Era o pedido: liberou
// Pré-análise no superadmin, as permissões de Pré-análise passam a aparecer no
// cadastro de todo mundo, sozinhas.
//
// `pular` são as chaves que aquele formulário já mostra em outro lugar — os
// cartões grandes de Gerente e de visão geral. Duas caixas para a mesma chave
// seriam duas respostas para a mesma pergunta, e quem lê o formulário no fim
// (Object.fromEntries) ficaria com a última.
function permsMontar(idAlvo, classe, pular) {
  const alvo = document.getElementById(idAlvo);
  if (!alvo) return;
  const fora = new Set(pular || []);
  const grupos = perfisDisponiveis();
  alvo.innerHTML = [...grupos.entries()]
    .map(([mod, itens]) => {
      const uteis = itens.filter(i => !fora.has(i.chave));
      if (!uteis.length) return '';
      return `<div class="pf-grupo">
      <div class="pf-grupo-titulo">${esc(A1_ROTULO_MODULO[mod] || mod)}</div>
      ${uteis
        .map(
          i => `
        <label class="pf-item" title="${esc(i.ajuda)}">
          <input type="checkbox" class="${esc(classe)}" data-key="${esc(i.chave)}">
          <span><span class="pf-rotulo">${esc(i.rotulo)}</span>
            <span class="pf-ajuda">${esc(i.ajuda)}</span></span>
        </label>`
        )
        .join('')}
    </div>`;
    })
    .join('');
}

// Escolheu um perfil: as caixas passam a mostrar o que o PERFIL diz, travadas.
//
// Isto é só a tela. Quem decide de verdade é a1_perm() no banco, que resolve
// pelo perfil quando a pessoa tem um. As duas precisam concordar — se a tela
// mostrasse uma coisa e a API entregasse outra, o gestor confiaria na errada.
function perfilAplicado(idsel, classe) {
  const sel = document.getElementById(idsel);
  if (!sel) return;
  const caixas = [...document.querySelectorAll('.' + classe)];
  const aviso = document.getElementById(idsel + '-aviso');
  const achado = sel.value ? PERFIS.lista.find(p => p.id === sel.value) : null;
  // Perfil desligado não manda em ninguém — é assim que a1_perm() e
  // a1RefreshPartnerPerms() resolvem, e a tela tem de dizer a mesma coisa.
  const perfil = achado && achado.ativo !== false ? achado : null;

  if (!perfil) {
    // Volta ao que o gestor tinha marcado antes de o perfil entrar.
    if (sel._marcas)
      caixas.forEach(c => {
        c.checked = !!sel._marcas[c.dataset.key];
      });
    sel._marcas = null;
    caixas.forEach(c => {
      c.disabled = false;
      const l = c.closest('label');
      if (l) l.classList.remove('pf-travado');
    });
    if (aviso)
      aviso.innerHTML = achado
        ? `O perfil <b>${esc(achado.nome)}</b> está inativo, então ele não manda em ` +
          'nada: valem as marcas abaixo. Reative-o em Configurações &rsaquo; Perfis ' +
          'de acesso para que volte a valer.'
        : 'Sem perfil, valem as marcas abaixo, uma a uma. ' +
          'Perfis são cadastrados em Configurações &rsaquo; Perfis de acesso.';
    return;
  }

  // Guarda as marcas próprias ANTES de sobrescrever a tela. É o que vai ser
  // gravado: se um dia o perfil for apagado, a pessoa volta ao que o gestor
  // havia marcado, e não a uma fotografia do perfil.
  if (!sel._marcas) sel._marcas = Object.fromEntries(caixas.map(c => [c.dataset.key, c.checked]));

  const perm = perfil.permissions || {};
  caixas.forEach(c => {
    c.checked = perm[c.dataset.key] === true;
    c.disabled = true;
    const l = c.closest('label');
    if (l) l.classList.add('pf-travado');
  });
  if (aviso)
    aviso.innerHTML =
      `Seguindo o perfil <b>${esc(perfil.nome)}</b>. ` +
      'As marcas abaixo ficam só para consulta — mudar o perfil muda todo mundo ' +
      'que está nele.';
}

// Carrega os perfis uma vez, para as listas de gente poderem dizer quem está
// em qual. Sem isto a coluna nasceria vazia até alguém abrir a tela de Perfis.
async function perfisGarantir() {
  if (PERFIS.lista.length) return;
  const linhas = await fetch(`${A1.rest('a1_perfis')}?order=nome.asc`, { headers: A1.headers() })
    .then(r => (r.ok ? r.json() : []))
    .catch(() => []);
  PERFIS.lista = Array.isArray(linhas) ? linhas : [];
}

// A etiqueta do perfil na listagem. Quem olha a lista precisa saber de onde vem
// a permissão de cada um: sem isso, um corretor que "pode mais que o outro"
// vira mistério, e o gestor vai procurar a resposta nas marcas — onde ela não está.
function perfilEtiqueta(id) {
  if (!id) return '';
  const p = PERFIS.lista.find(x => x.id === id);
  if (!p) return '';
  const off = p.ativo === false;
  return (
    `<div style="font-size:.66rem;font-weight:700;margin-top:.1rem;color:${off ? '#9A6008' : '#0d9488'}">` +
    `${esc(p.nome)}${off ? ' (perfil inativo — valem as marcas do cadastro)' : ''}</div>`
  );
}

// O que gravar no cadastro da pessoa. Com perfil escolhido, as caixas na tela
// são as do perfil: gravar aquilo apagaria as marcas próprias dela.
function permsColetar(classe, idsel) {
  const sel = idsel ? document.getElementById(idsel) : null;
  if (sel && sel.value && sel._marcas) return { ...sel._marcas };
  return Object.fromEntries(
    [...document.querySelectorAll('.' + classe)].map(cb => [cb.dataset.key, cb.checked])
  );
}

function cfgModsLiberar(mod) {
  if (G.user.role === 'partner') return;
  if (CFG_MOD_LIB[mod] !== false) return;
  CFG_MOD_LIB[mod] = true;

  if (mod === 'PRE_ANALISE') {
    // O terceiro módulo dos tipos de documento nasce escondido no HTML.
    // As permissões de Pré-análise não precisam mais deste empurrão: as caixas
    // dos cadastros são montadas na hora de abrir, a partir do catálogo, e
    // perfisDisponiveis() já lê G.temPA.
    ['dt-mod-PRE_ANALISE'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    cfgModsCartao({
      id: 'cfg-card-ciclo-pa',
      modulo: 'PRE_ANALISE',
      grade: 'cfg-cards-workflow',
      view: 'ciclo-pa',
      rotulo: 'Ciclo de Distribuição',
      fundo: '#dff5f1',
      icone: CFG_ICONE_CICLO
    });
    cfgModsVista(
      'ciclo-pa',
      'Pré-análise — Ciclo de Distribuição',
      `
      <div class="cfg-explica" style="max-width:900px">
        Distribui cada nova pré-análise pela hierarquia Empresa Correspondente → Usuário Correspondente → Analista.
        Com o ciclo ativo, esses responsáveis são definidos pelo banco e não podem ser escolhidos no cadastro.
      </div>
      <div id="ciclo-pa-corpo" style="max-width:1280px"></div>`
    );
    // O workflow NÃO ganha cartão próprio. O dono foi claro: "quando eu clico em
    // editor de workflow, deve aparecer os ícones do workflow de cada módulo".
    // Dois cartões separados eram dois editores para a mesma coisa, e um deles
    // era uma tabela enquanto o outro era um quadro. Agora é o mesmo quadro do
    // Repasse, e os módulos são botões dentro dele.
  }

  // Leads: as listas do funil viram cartões aqui. Estavam numa aba dentro do
  // próprio CRM, e configuração em dois lugares é o gestor procurando em um e
  // achando no outro. As seis que Configurações JÁ TEM com outro nome
  // (corretores, imobiliárias, empreendimentos, bancos, regiões, tipos de
  // imóvel) ficaram de fora de propósito — o motivo está em src/modules/leads/cadastros-leads.js.
  if (mod === 'crm' && typeof leadsMontarConfig === 'function') leadsMontarConfig();

  // Registro de integrações: a política a1_integra_eventos_ler exige só
  // a1_e_gestor(), sem porta de módulo. Quem tem de fechar essa porta é a tela
  // — por isso o cartão só nasce com pelo menos um dos dois módulos ligados.
  cfgModsCartao({
    id: 'cfg-card-integra',
    modulo: 'PRE_ANALISE,COMERCIAL',
    grade: 'cfg-cards-ferramentas',
    view: 'integra',
    rotulo: 'Registro de integrações',
    fundo: '#fef3c7',
    icone: CFG_ICONE_INTEGRA
  });
  cfgModsVista(
    'integra',
    'Registro de integrações',
    `
    <div class="cfg-explica">
      Cada vez que uma transição dispara uma ação entre módulos, o resultado fica registrado aqui.
      É onde está escrito por que uma pré-análise aprovada não virou Venda — o motivo costuma
      apontar de volta para um ajuste no workflow.
    </div>
    <div id="integra-corpo"></div>`
  );
}

// ══ Ciclo de distribuição da Pré-análise ════════════════════════════════════
const CICLO_PA = {
  configuracoes: [],
  selecionadaId: null,
  rascunho: null,
  empresas: [],
  correspondentes: [],
  analistas: []
};

async function cicloCarregar() {
  const el = document.getElementById('ciclo-pa-corpo');
  if (!el) return;
  el.innerHTML = '<div class="pt-empty">Carregando ciclo…</div>';
  const h = { headers: A1.headers() };
  const [rc, re, rr, ra] = await Promise.all([
    fetch(A1.rpc('a1_pa_ciclo_configuracoes'), { method: 'POST', headers: A1.headers(), body: '{}' }),
    fetch(`${A1.rest('a1_corr_empresas')}?select=id,name&order=name.asc`, h),
    fetch(
      `${A1.rest('a1_partners')}?type=eq.cca&is_active=is.true&approved=is.true&select=id,name,empresa_id&order=name.asc`,
      h
    ),
    fetch(
      `${A1.rest('a1_partners')}?type=eq.analista&is_active=is.true&approved=is.true&select=id,name,empresa_id&order=name.asc`,
      h
    )
  ]);
  if (!rc.ok) {
    el.innerHTML =
      '<div class="aviso w">O SQL do Ciclo de Distribuição ainda não foi aplicado no Supabase.</div>';
    return;
  }
  const cfg = await rc.json().catch(() => ({}));
  CICLO_PA.configuracoes = Array.isArray(cfg.configuracoes) ? cfg.configuracoes : [];
  CICLO_PA.empresas = await re.json().catch(() => []);
  CICLO_PA.correspondentes = await rr.json().catch(() => []);
  CICLO_PA.analistas = await ra.json().catch(() => []);
  if (!Array.isArray(CICLO_PA.empresas)) CICLO_PA.empresas = [];
  if (!Array.isArray(CICLO_PA.correspondentes)) CICLO_PA.correspondentes = [];
  if (!Array.isArray(CICLO_PA.analistas)) CICLO_PA.analistas = [];
  const manter = CICLO_PA.configuracoes.find(x => x.id === CICLO_PA.selecionadaId);
  const alvo = manter || CICLO_PA.configuracoes.find(x => x.ativo) || CICLO_PA.configuracoes[0];
  if (alvo) cicloAbrir(alvo.id, false);
  else cicloNova(false);
  cicloRender();
}

function cicloAbrir(id, render = true) {
  const c = CICLO_PA.configuracoes.find(x => x.id === id);
  if (!c) return;
  CICLO_PA.selecionadaId = id;
  CICLO_PA.rascunho = {
    id: c.id,
    nome: c.nome || '',
    ativo: c.ativo === true,
    modo: c.modo || 'LIVRE',
    empresa_id: c.empresa_id || '',
    correspondente_id: c.correspondente_id || '',
    proxima_ordem: Number(c.proxima_ordem || 1),
    participantes: Array.isArray(c.participantes) ? c.participantes.map(x => ({ ...x })) : []
  };
  if (render) cicloRender();
}
function cicloNova(render = true) {
  CICLO_PA.selecionadaId = null;
  CICLO_PA.rascunho = {
    id: null,
    nome: '',
    ativo: false,
    modo: 'LIVRE',
    empresa_id: '',
    correspondente_id: '',
    proxima_ordem: 1,
    participantes: []
  };
  if (render) cicloRender();
}

function cicloRender() {
  const el = document.getElementById('ciclo-pa-corpo');
  if (!el) return;
  const c = CICLO_PA.rascunho || { participantes: [] },
    ps = c.participantes || [];
  const corr = CICLO_PA.correspondentes.filter(x => x.empresa_id === c.empresa_id);
  const anas = CICLO_PA.analistas.filter(x => x.empresa_id === c.empresa_id);
  const marcados = new Set(ps.map(x => x.analista_id));
  el.innerHTML = `
    <div class="ciclo-layout">
      <aside class="ciclo-side">
        <div class="ciclo-side-hdr"><div class="ciclo-side-title">Configurações salvas</div><button class="btn btn-primary btn-sm" onclick="cicloNova()">+ Nova</button></div>
        <div class="ciclo-list">${
          CICLO_PA.configuracoes.length
            ? CICLO_PA.configuracoes
                .map(
                  x => `
          <button class="ciclo-config ${x.id === CICLO_PA.selecionadaId ? 'active' : ''}" onclick="cicloAbrir('${escJs(x.id)}')">
            <span class="ciclo-config-top"><span class="ciclo-config-name">${esc(x.nome)}</span>${x.ativo ? '<span class="ciclo-status">Ativa</span>' : ''}</span>
            <span class="ciclo-config-meta">${esc(x.empresa || 'Sem empresa')} · ${Number((x.participantes || []).length)} analista(s)</span>
          </button>`
                )
                .join('')
            : '<div class="ciclo-empty">Nenhuma configuração criada.</div>'
        }</div>
      </aside>
      <section class="ciclo-editor">
        <div class="ciclo-editor-hdr">
          <div><div class="ciclo-editor-title">${c.id ? 'Editar configuração' : 'Nova configuração'}</div><div class="ciclo-editor-sub">Uma empresa, um usuário correspondente e todos os analistas que participarão da fila.</div></div>
          <div class="ciclo-actions">
            ${c.id && !c.ativo ? `<button id="ciclo-ativar" class="btn btn-ghost" onclick="cicloAtivar()">Ativar configuração</button>` : ''}
            ${c.ativo ? '<span class="ciclo-status">Padrão do sistema</span>' : ''}
            <button id="ciclo-salvar" class="btn btn-primary" onclick="cicloSalvar()">Salvar alterações</button>
          </div>
        </div>
        <div class="ciclo-body">
          <div class="ciclo-fields">
            <div class="form-group"><label>Nome da configuração</label><input id="ciclo-nome" maxlength="100" value="${esc(c.nome || '')}" placeholder="Ex.: Equipe principal" oninput="CICLO_PA.rascunho.nome=this.value"></div>
            <div class="form-group"><label>Critério de distribuição</label><select id="ciclo-modo" onchange="CICLO_PA.rascunho.modo=this.value">
              <option value="LIVRE" ${c.modo === 'LIVRE' ? 'selected' : ''}>Livre — rodízio igual</option>
              <option value="DESEMPENHO" ${c.modo === 'DESEMPENHO' ? 'selected' : ''}>Desempenho — peso por aprovações</option>
            </select></div>
          </div>
          <div class="ciclo-hierarquia">
            <div class="form-group"><label>Empresa correspondente</label><select id="ciclo-empresa" onchange="cicloEmpresaMudou(this.value)"><option value="">Selecione uma empresa</option>${CICLO_PA.empresas.map(x => `<option value="${esc(x.id)}" ${x.id === c.empresa_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
            <div class="form-group"><label>Usuário correspondente</label><select id="ciclo-corr" onchange="CICLO_PA.rascunho.correspondente_id=this.value" ${c.empresa_id ? '' : 'disabled'}><option value="">${c.empresa_id ? 'Selecione o responsável' : 'Escolha primeiro a empresa'}</option>${corr.map(x => `<option value="${esc(x.id)}" ${x.id === c.correspondente_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
          </div>
          <div class="ciclo-analistas">
            <div class="ciclo-analistas-hdr">
              <div style="display:flex;align-items:center;gap:.45rem"><span class="ciclo-analistas-title">Analistas da fila</span><span class="ciclo-count" id="ciclo-count">${marcados.size} selecionado(s)</span></div>
              <div class="ciclo-tools"><input class="ciclo-search" type="search" placeholder="Buscar analista…" oninput="cicloFiltrarAnalistas(this.value)"><button class="btn btn-ghost btn-sm" onclick="cicloSelecionarVisiveis(true)">Selecionar visíveis</button><button class="btn btn-ghost btn-sm" onclick="cicloSelecionarVisiveis(false)">Limpar</button></div>
            </div>
            <div class="ciclo-analistas-grid" id="ciclo-analistas-grid">${
              !c.empresa_id
                ? '<div class="ciclo-empty">Selecione a empresa para listar os analistas.</div>'
                : anas.length
                  ? anas
                      .map(
                        a => `
              <label class="ciclo-analista ${marcados.has(a.id) ? 'marcado' : ''}" data-nome="${esc((a.name || '').toLowerCase())}"><input type="checkbox" value="${esc(a.id)}" ${marcados.has(a.id) ? 'checked' : ''} onchange="cicloAlternarAnalista('${escJs(a.id)}',this.checked)"><span class="ciclo-analista-info"><span class="ciclo-analista-nome">${esc(a.name)}</span><span class="ciclo-analista-meta">Analista de crédito</span></span></label>`
                      )
                      .join('')
                  : '<div class="ciclo-empty">Nenhum analista ativo nesta empresa.</div>'
            }</div>
          </div>
          ${ps.length ? `<div class="ciclo-resumo tbl-wrap"><table><thead><tr><th>Ordem</th><th>Analista</th><th>Recebidas</th><th>Aprovadas</th><th></th></tr></thead><tbody>${ps.map((p, i) => `<tr><td>${i + 1}${c.ativo && c.modo === 'LIVRE' && Number(p.ordem) === Number(c.proxima_ordem) ? ' · próximo' : ''}</td><td><b>${esc(p.analista || CICLO_PA.analistas.find(a => a.id === p.analista_id)?.name || '—')}</b></td><td>${Number(p.recebidas || 0)}</td><td>${Number(p.aprovadas || 0)}</td><td><button class="btn btn-danger btn-sm" onclick="cicloRemover('${escJs(p.analista_id)}')">Remover</button></td></tr>`).join('')}</tbody></table></div>` : ''}
          <div style="font-size:.69rem;color:var(--t3);margin-top:.75rem">No modo desempenho, o peso é recalculado pelas aprovações na etapa com o selo FIM POSITIVO.</div>
        </div>
      </section>
    </div>`;
}

function cicloEmpresaMudou(id) {
  CICLO_PA.rascunho.empresa_id = id;
  CICLO_PA.rascunho.correspondente_id = '';
  CICLO_PA.rascunho.participantes = [];
  cicloRender();
}
function cicloAlternarAnalista(id, marcado) {
  const ps = CICLO_PA.rascunho.participantes,
    atual = ps.find(x => x.analista_id === id);
  if (marcado && !atual) {
    const a = CICLO_PA.analistas.find(x => x.id === id);
    ps.push({ analista_id: id, analista: a?.name, ordem: ps.length + 1, recebidas: 0, aprovadas: 0 });
  }
  if (!marcado && atual)
    CICLO_PA.rascunho.participantes = ps
      .filter(x => x.analista_id !== id)
      .map((x, i) => ({ ...x, ordem: i + 1 }));
  const box = document.querySelector(`.ciclo-analista input[value="${id}"]`);
  if (box) box.closest('.ciclo-analista').classList.toggle('marcado', marcado);
  const count = document.getElementById('ciclo-count');
  if (count) count.textContent = `${CICLO_PA.rascunho.participantes.length} selecionado(s)`;
}
function cicloFiltrarAnalistas(busca) {
  const q = (busca || '').trim().toLowerCase();
  document
    .querySelectorAll('#ciclo-analistas-grid .ciclo-analista')
    .forEach(x => (x.style.display = !q || x.dataset.nome.includes(q) ? '' : 'none'));
}
function cicloSelecionarVisiveis(marcar) {
  document.querySelectorAll('#ciclo-analistas-grid .ciclo-analista').forEach(x => {
    if (x.style.display === 'none') return;
    const cb = x.querySelector('input');
    if (cb.checked !== marcar) {
      cb.checked = marcar;
      cicloAlternarAnalista(cb.value, marcar);
    }
  });
  cicloRender();
}
function cicloRemover(id) {
  CICLO_PA.rascunho.participantes = CICLO_PA.rascunho.participantes
    .filter(x => x.analista_id !== id)
    .map((x, i) => ({ ...x, ordem: i + 1 }));
  cicloRender();
}
async function cicloSalvar() {
  const btn = document.getElementById('ciclo-salvar'),
    c = CICLO_PA.rascunho;
  c.nome = (document.getElementById('ciclo-nome')?.value || '').trim();
  c.modo = document.getElementById('ciclo-modo')?.value || c.modo;
  c.correspondente_id = document.getElementById('ciclo-corr')?.value || '';
  if (!c.nome) {
    toast('Informe um nome para a configuração.', 'error');
    return;
  }
  if (!c.empresa_id || !c.correspondente_id) {
    toast('Selecione a empresa e o usuário correspondente.', 'error');
    return;
  }
  if (!c.participantes.length) {
    toast('Selecione ao menos um analista.', 'error');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  const r = await fetch(A1.rpc('a1_pa_ciclo_salvar_configuracao'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({
      p_config_id: c.id,
      p_nome: c.nome,
      p_modo: c.modo,
      p_empresa_id: c.empresa_id,
      p_correspondente_id: c.correspondente_id,
      p_analistas: c.participantes.map(p => p.analista_id)
    })
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    toast(e.message || 'Não foi possível salvar o ciclo.', 'error');
    btn.disabled = false;
    btn.textContent = 'Salvar configuração';
    return;
  }
  const salvo = await r.json().catch(() => ({}));
  CICLO_PA.selecionadaId = salvo.config_id || c.id;
  toast('Configuração salva.', 'success');
  await cicloCarregar();
}
async function cicloAtivar() {
  const c = CICLO_PA.rascunho;
  if (!c?.id) return;
  const atual = CICLO_PA.configuracoes.find(x => x.ativo);
  const msg = atual
    ? `Ativar "${c.nome}"? A configuração "${atual.nome}" deixará de ser o padrão do sistema.`
    : `Ativar "${c.nome}" como padrão do sistema?`;
  if (!confirm(msg)) return;
  const btn = document.getElementById('ciclo-ativar');
  btn.disabled = true;
  btn.textContent = 'Ativando…';
  const r = await fetch(A1.rpc('a1_pa_ciclo_ativar'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({ p_config_id: c.id })
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    toast(e.message || 'Não foi possível ativar a configuração.', 'error');
    btn.disabled = false;
    btn.textContent = 'Ativar configuração';
    return;
  }
  toast('Configuração ativada como padrão.', 'success');
  await cicloCarregar();
}

// ── Registro de integrações (somente leitura) ────────────────────────────────
const CFG_INTEGRA_PILL = {
  OK: ['#dcfce7', '#166534'],
  BLOQUEADO: ['#fef3c7', '#92400e'],
  ERRO: ['#fee2e2', '#b91c1c'],
  PENDENTE: ['#E2E8E5', '#47615C']
};

async function cfgIntegraCarregar() {
  const corpo = document.getElementById('integra-corpo');
  if (!corpo) return;
  corpo.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--t3);font-size:.8rem">Carregando…</div>`;
  const linhas = await fetch(`${A1.rest('a1_integra_eventos')}?order=criado_em.desc&limit=100`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .catch(() => []);
  const lista = Array.isArray(linhas) ? linhas : [];
  if (!lista.length) {
    corpo.innerHTML = `<div class="panel" style="padding:2.5rem;text-align:center;color:var(--t3);font-size:.8rem">
      Nenhuma integração registrada ainda. Assim que uma transição disparar uma ação entre módulos,
      o resultado aparece aqui.</div>`;
    return;
  }
  corpo.innerHTML = `
    <div class="tbl-wrap">
      <table><thead><tr>
        <th>Quando</th><th>Tipo</th><th>De</th><th>Para</th><th>Status</th><th>Motivo</th>
      </tr></thead><tbody>
      ${lista
        .map(e => {
          const cor = CFG_INTEGRA_PILL[e.status] || CFG_INTEGRA_PILL.PENDENTE;
          const quando = e.criado_em ? new Date(e.criado_em).toLocaleString('pt-BR') : '—';
          return `<tr>
          <td style="white-space:nowrap;color:var(--t3);font-size:.72rem">${esc(quando)}</td>
          <td style="font-weight:600">${esc(e.tipo)}</td>
          <td>${esc(e.origem_modulo || '—')}</td>
          <td>${esc(e.destino_modulo || '—')}</td>
          <td><span style="font-size:.68rem;font-weight:700;padding:.15rem .5rem;border-radius:20px;background:${cor[0]};color:${cor[1]}">${esc(e.status)}</span></td>
          <td style="font-size:.73rem;color:var(--t2)">${esc(e.motivo || '')}</td>
        </tr>`;
        })
        .join('')}
      </tbody></table>
    </div>`;
}

// ══ Exclusão definitiva ══════════════════════════════════════════════════════
// O pedido do dono, nas palavras dele: "cada cartão tem um código... só pode
// excluir se copiar esse código e colocar nessa área de exclusão. Aí vai
// aparecer as informações. Essa exclusão não tem volta."
//
// Daí o desenho em três passos, e nenhum deles é enfeite:
//   1. cola o código  →  2. o sistema MOSTRA a ficha do que achou  →  3. só
//   então o botão existe, com justificativa escrita e confirmação explícita.
// O passo 2 é o que impede apagar o processo errado por um dígito trocado:
// nunca se apaga algo que a pessoa não viu descrito na tela.
//
// A AUTORIZAÇÃO NÃO ESTÁ AQUI. Quem confere gestor, cliente, licença de módulo
// e dependência entre módulos é a1_excluir_definitivo() no Postgres, e é ela
// que grava a auditoria antes de apagar. Esta tela é a conversa; a recusa é do
// banco, e vale igual para quem chamar o RPC direto na API.
const EXCDEF = { achados: [], escolhido: null, confirmando: false, buscando: false };

const EXC_ICONE = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#B8433A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

// As chaves são as mesmas que o banco usa (a1_cases, a1_pre_analises e
// a1_comerciais, nesta ordem); aqui só se traduz para o nome que o gestor lê.
const EXC_MODULOS = {
  repasse: { rotulo: 'Repasse' },
  PRE_ANALISE: { rotulo: 'Pré-análise' },
  COMERCIAL: { rotulo: 'Venda' }
};

// Nomes legíveis das filhas. Sem isto a tela diria "analises_de_credito: 1",
// que é nome de coluna, não frase para o gestor decidir se apaga.
const EXC_FILHOS_ROTULO = {
  historico_de_etapas: 'movimentações no histórico de etapas',
  eventos: 'eventos e comentários',
  emails_sem_vinculo: 'e-mails na fila (não somem; só perdem o vínculo)',
  participantes: 'participantes (titular e associados)',
  documentos: 'documentos do dossiê',
  analises_de_credito: 'análises de crédito',
  contratos: 'contratos'
};

function excDefEhGestor() {
  return G.user && (G.user.role === 'owner' || G.user.role === 'admin');
}

// Quais dos três módulos este cliente tem. `true` literal: a1HasModule devolve
// null quando o servidor não respondeu, e "não consegui perguntar" não pode
// virar "não tem" — nem para mostrar, nem para esconder.
function excDefModulos() {
  return [
    G.temRepasse === true ? 'repasse' : null,
    G.temPAResp === true ? 'PRE_ANALISE' : null,
    G.temCOResp === true ? 'COMERCIAL' : null
  ].filter(Boolean);
}

// Chamada toda vez que uma licença responde. Monta o cartão assim que HOUVER
// pelo menos um módulo — e nunca antes: sem módulo nenhum não há o que excluir,
// e um cartão que abre uma tela vazia é pior que cartão ausente.
function excDefConferir() {
  if (!excDefEhGestor()) return;
  if (!excDefModulos().length) return;
  excDefMontar();
  excDefPintarCobertura();
}

// Cartão e sub-tela nascem por JS, não no HTML escondido. É a mesma regra dos
// módulos novos: o que não está no DOM ninguém acha com a busca do hub nem com
// o inspetor. Aqui vale por dois motivos somados — a licença do módulo e o
// papel: exclusão definitiva é coisa de gestor, e a recusa de verdade é do
// banco (a1_excluir_definitivo confere a1_e_gestor()).
function excDefMontar() {
  if (document.getElementById('cfg-card-excdef')) return;
  const hub = document.getElementById('cfg-hub');
  if (!hub) return;

  // O grupo inteiro é criado aqui, e só quando há cartão para pôr dentro. Um
  // grupo estático vazio deixaria o título "Área de risco" sozinho na tela de
  // quem não pode usar nada dele.
  const grupo = document.createElement('div');
  grupo.className = 'cfg-grupo';
  grupo.id = 'cfg-grupo-perigo';
  grupo.innerHTML = `
    <div class="cfg-section-hdr">Área de risco</div>
    <div class="cfg-section-sub">O que se faz aqui não tem desfazer.</div>
    <div class="cfg-cards" id="cfg-cards-perigo"></div>`;
  hub.appendChild(grupo);

  const card = document.createElement('div');
  card.className = 'cfg-hub-card';
  card.id = 'cfg-card-excdef';
  card.style.borderColor = '#FCA5A5';
  card.addEventListener('click', () => openCfgView('excdef'));
  card.innerHTML = `<div class="cfg-hub-icon" style="background:#FEE2E2">${EXC_ICONE}</div>
                    <div class="cfg-card-label">Exclusão definitiva</div>`;
  document.getElementById('cfg-cards-perigo').appendChild(card);

  cfgModsVista(
    'excdef',
    'Exclusão definitiva',
    `
    <div class="exc-alerta">
      <strong>Isto não tem volta.</strong> O registro é apagado do banco, junto com o que
      pertence só a ele. Não vai para lixeira, não dá para desfazer e não há backup por tela.
      O que fica é a linha de auditoria — quem apagou, quando, o retrato do conteúdo e a
      justificativa que você escrever.
    </div>
    <div class="panel" style="padding:1.1rem;max-width:720px;margin-bottom:1.25rem">
      <label style="display:block;font-size:.72rem;font-weight:700;text-transform:uppercase;
                    letter-spacing:.06em;color:var(--t3);margin-bottom:.4rem">
        Código do cartão</label>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <input type="text" id="exc-codigo" placeholder="Cole aqui o código que aparece no cartão"
               autocomplete="off" spellcheck="false"
               style="flex:1;min-width:260px;padding:.5rem .7rem;border:1px solid var(--border);
                      border-radius:8px;font-size:.82rem;font-family:'DM Mono',ui-monospace,monospace"
               onkeydown="if(event.key==='Enter')excDefProcurar()">
        <button class="btn btn-primary btn-sm" id="exc-btn-procurar" onclick="excDefProcurar()">Procurar</button>
      </div>
      <div id="exc-cobertura" style="font-size:.73rem;color:var(--t3);margin-top:.55rem;line-height:1.5"></div>
    </div>
    <div id="exc-resultado" style="max-width:720px"></div>
    <div id="exc-historico" style="max-width:720px;margin-top:1.75rem"></div>`
  );
}

function excDefPintarCobertura() {
  const el = document.getElementById('exc-cobertura');
  if (!el) return;
  const nomes = excDefModulos().map(k => EXC_MODULOS[k].rotulo);
  el.innerHTML =
    `Procura em: <strong>${esc(nomes.join(', '))}</strong>. ` +
    `Serve o código inteiro ou o pedaço curto que aparece no cartão.`;
}

function excDefAbrir() {
  excDefPintarCobertura();
  excDefLimpar();
  excDefHistorico();
  const el = document.getElementById('exc-codigo');
  if (el) {
    el.value = '';
    el.focus();
  }
}

function excDefLimpar() {
  EXCDEF.achados = [];
  EXCDEF.escolhido = null;
  EXCDEF.confirmando = false;
  const r = document.getElementById('exc-resultado');
  if (r) r.innerHTML = '';
}

// Erro de banco não vira "Tente novamente": a1_excluir_definitivo escreve as
// recusas em português, para uma pessoa ler, e é esse texto que interessa.
async function excDefMotivo(res) {
  let m = '';
  try {
    const j = await res.json();
    m = (j && (j.message || j.hint || j.details)) || '';
  } catch {}
  if (m) return m;
  if (res.status === 401 || res.status === 403) return 'Você não tem permissão para esta exclusão.';
  return 'O banco recusou a operação e não disse por quê. Nada foi apagado.';
}

async function excDefProcurar() {
  const campo = document.getElementById('exc-codigo');
  const btn = document.getElementById('exc-btn-procurar');
  const alvo = document.getElementById('exc-resultado');
  if (!campo || !alvo) return;
  const codigo = (campo.value || '').trim();
  excDefLimpar();
  if (!codigo) {
    toast('Cole o código do cartão.', 'info');
    campo.focus();
    return;
  }
  if (EXCDEF.buscando) return;

  EXCDEF.buscando = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Procurando…';
  }
  alvo.innerHTML = `<div style="color:var(--t3);font-size:.8rem;padding:1rem 0">Procurando…</div>`;
  try {
    const res = await fetch(A1.rpc('a1_excluir_procurar'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({ p_codigo: codigo })
    });
    if (!res.ok) {
      alvo.innerHTML = excDefErroHtml(await excDefMotivo(res));
      return;
    }
    const linhas = await res.json().catch(() => []);
    EXCDEF.achados = Array.isArray(linhas) ? linhas : [];
    if (!EXCDEF.achados.length) {
      alvo.innerHTML = excDefErroHtml(
        'Não achei esse código. Confira se copiou o código inteiro do cartão — ' +
          'e lembre que a busca só cobre os módulos listados acima.'
      );
      return;
    }
    // Um achado só: já mostra a ficha. Vários: a pessoa escolhe, porque um
    // prefixo curto pode casar com mais de um processo e escolher por ela
    // seria escolher no escuro qual registro morre.
    EXCDEF.escolhido = EXCDEF.achados.length === 1 ? 0 : null;
    excDefRender();
  } catch {
    alvo.innerHTML = excDefErroHtml('Não consegui falar com o servidor. Nada foi apagado.');
  } finally {
    EXCDEF.buscando = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Procurar';
    }
  }
}

function excDefErroHtml(msg) {
  return `<div class="panel" style="padding:1rem 1.1rem;border-color:#FCA5A5;background:#FEF2F2;
               color:#7F1D1D;font-size:.79rem;line-height:1.6">${esc(msg)}</div>`;
}

function excDefEscolher(i) {
  EXCDEF.escolhido = i;
  EXCDEF.confirmando = false;
  excDefRender();
}

function excDefFilhosTexto(filhos) {
  const f = filhos || {};
  const partes = Object.keys(f)
    .filter(k => Number(f[k]) > 0)
    .map(k => `${Number(f[k])} ${EXC_FILHOS_ROTULO[k] || k}`);
  return partes;
}

function excDefRender() {
  const alvo = document.getElementById('exc-resultado');
  if (!alvo) return;
  const varios = EXCDEF.achados.length > 1;

  alvo.innerHTML =
    (varios
      ? `<div class="exc-alerta" style="background:#FFFBEB;border-color:#FDE68A;color:#92400E">
         Esse código casa com <strong>${EXCDEF.achados.length} registros</strong>.
         Confira qual é o certo antes de seguir.</div>`
      : '') + EXCDEF.achados.map((r, i) => excDefFichaHtml(r, i, varios)).join('');
}

function excDefFichaHtml(r, i, varios) {
  const escolhida = EXCDEF.escolhido === i;
  const mod = EXC_MODULOS[r.modulo] || { rotulo: r.modulo };
  const quando = r.criado_em ? new Date(r.criado_em).toLocaleString('pt-BR') : '—';
  const filhos = excDefFilhosTexto(r.filhos);

  const linha = (rot, val) =>
    val
      ? `<div class="exc-linha"><span class="exc-rot">${rot}</span><span class="exc-val">${esc(String(val))}</span></div>`
      : '';

  let acao = '';
  if (r.impedimento) {
    // A recusa vem do banco e é a mesma que o botão levaria. Mostrá-la já na
    // ficha evita a pessoa escrever a justificativa inteira para só então
    // descobrir que este registro não pode sair ainda.
    acao = `<div class="exc-impede"><strong>Este registro não pode ser excluído agora.</strong><br>${esc(r.impedimento)}</div>`;
  } else if (!escolhida) {
    acao = `<div style="margin-top:.8rem"><button class="btn btn-ghost btn-sm"
              onclick="excDefEscolher(${i})">É este</button></div>`;
  } else {
    acao = excDefFormularioHtml(r, i);
  }

  return `<div class="exc-ficha${escolhida && !r.impedimento ? ' exc-escolhida' : ''}">
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.6rem;flex-wrap:wrap">
      <span class="exc-pill">${esc(mod.rotulo)}</span>
      <span class="exc-cod">${esc(r.codigo || '')}</span>
      ${varios && escolhida ? '<span style="font-size:.7rem;font-weight:700;color:#B8433A">selecionado</span>' : ''}
    </div>
    ${linha('Cliente', r.titulo || '(sem nome no cadastro)')}
    ${linha('Empreendimento', r.empreendimento)}
    ${linha('Unidade', r.unidade)}
    ${linha('Situação', r.situacao)}
    ${linha('Criado em', quando)}
    ${linha('Id completo', r.registro_id)}
    ${
      filhos.length
        ? `<div class="exc-linha"><span class="exc-rot">Some junto</span>
           <span class="exc-val" style="font-weight:500;color:var(--t2)">${esc(filhos.join(' · '))}</span></div>`
        : `<div class="exc-linha"><span class="exc-rot">Some junto</span>
           <span class="exc-val" style="font-weight:500;color:var(--t2)">nada além do próprio registro</span></div>`
    }
    ${acao}</div>`;
}

function excDefFormularioHtml(r, i) {
  if (EXCDEF.confirmando) {
    // Segundo passo: o texto repete QUEM vai sumir, com nome e código. Um
    // "tem certeza?" genérico não dá à pessoa nada novo para conferir.
    const quem = [r.titulo, r.empreendimento, r.unidade].filter(Boolean).join(' · ') || r.codigo;
    return `<div class="exc-confirma">
        <strong>Confirma apagar para sempre?</strong><br>
        ${esc((EXC_MODULOS[r.modulo] || {}).rotulo || r.modulo)} · <span class="exc-cod">${esc(r.codigo || '')}</span> — ${esc(quem)}<br>
        Depois deste clique não há como recuperar.
      </div>
      <div style="display:flex;gap:.5rem;margin-top:.7rem;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="excDefCancelar()">Cancelar</button>
        <button class="btn btn-sm btn-danger-forte" id="exc-btn-apagar"
                onclick="excDefExecutar(${i})">Sim, excluir para sempre</button>
      </div>`;
  }
  return `<div style="margin-top:.9rem">
      <label style="display:block;font-size:.72rem;font-weight:700;text-transform:uppercase;
                    letter-spacing:.06em;color:var(--t3);margin-bottom:.35rem">
        Por que está excluindo?</label>
      <textarea id="exc-justificativa" rows="2" oninput="excDefValidar()"
        placeholder="Ex.: duplicidade — a mesma unidade foi lançada duas vezes"
        style="width:100%;padding:.5rem .7rem;border:1px solid var(--border);border-radius:8px;
               font-size:.8rem;resize:vertical"></textarea>
      <div style="font-size:.7rem;color:var(--t3);margin-top:.25rem">
        Fica gravado na auditoria junto com o seu nome. Mínimo de 10 caracteres.</div>
      <label class="exc-check">
        <input type="checkbox" id="exc-ciente" onchange="excDefValidar()">
        <span>Entendi que esta exclusão <strong>não tem volta</strong> e que conferi os dados acima.</span>
      </label>
      <div style="margin-top:.8rem">
        <button class="btn btn-sm btn-danger-forte" id="exc-btn-excluir" disabled
                onclick="excDefPedirConfirmacao()">Excluir definitivamente</button>
      </div>
    </div>`;
}

// O botão nasce desligado e só liga com as duas coisas feitas. Não é a
// proteção — a proteção é o banco — mas é o que impede o clique de reflexo.
function excDefValidar() {
  const just = document.getElementById('exc-justificativa');
  const marca = document.getElementById('exc-ciente');
  const btn = document.getElementById('exc-btn-excluir');
  if (!btn) return;
  const ok = !!marca && marca.checked && !!just && just.value.trim().length >= 10;
  btn.disabled = !ok;
}

function excDefPedirConfirmacao() {
  const just = document.getElementById('exc-justificativa');
  EXCDEF.justificativa = just ? just.value.trim() : '';
  if (EXCDEF.justificativa.length < 10) {
    toast('Escreva a justificativa.', 'info');
    return;
  }
  EXCDEF.confirmando = true;
  excDefRender();
}

function excDefCancelar() {
  EXCDEF.confirmando = false;
  excDefRender();
}

async function excDefExecutar(i) {
  const r = EXCDEF.achados[i];
  if (!r) return;
  const btn = document.getElementById('exc-btn-apagar');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Excluindo…';
  }
  try {
    const res = await fetch(A1.rpc('a1_excluir_definitivo'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({
        p_modulo: r.modulo,
        p_id: r.registro_id,
        p_justificativa: EXCDEF.justificativa || ''
      })
    });
    if (!res.ok) {
      const msg = await excDefMotivo(res);
      const alvo = document.getElementById('exc-resultado');
      if (alvo) alvo.innerHTML = excDefErroHtml(msg);
      toast('Nada foi apagado.', 'error');
      EXCDEF.achados = [];
      EXCDEF.escolhido = null;
      EXCDEF.confirmando = false;
      return;
    }
    const alvo = document.getElementById('exc-resultado');
    if (alvo)
      alvo.innerHTML = `<div class="panel" style="padding:1rem 1.1rem;font-size:.79rem;
        line-height:1.6;color:var(--t2)">
        <strong style="color:var(--t1)">Excluído.</strong>
        ${esc((EXC_MODULOS[r.modulo] || {}).rotulo || r.modulo)}
        <span class="exc-cod">${esc(r.codigo || '')}</span> não existe mais.
        A justificativa e o retrato do que havia ficaram registrados abaixo.</div>`;
    const campo = document.getElementById('exc-codigo');
    if (campo) campo.value = '';
    EXCDEF.achados = [];
    EXCDEF.escolhido = null;
    EXCDEF.confirmando = false;
    EXCDEF.justificativa = '';
    toast('Registro excluído definitivamente.', 'success');
    excDefHistorico();
  } catch {
    const alvo = document.getElementById('exc-resultado');
    if (alvo)
      alvo.innerHTML = excDefErroHtml('Não consegui falar com o servidor. Confira antes de tentar de novo.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Sim, excluir para sempre';
    }
  }
}

// A auditoria fica à vista na própria tela: de nada adianta gravar a trilha
// num lugar onde ninguém olha. E ver a lista crescer é o que deixa claro, para
// quem apaga, que a exclusão tem testemunha.
async function excDefHistorico() {
  const alvo = document.getElementById('exc-historico');
  if (!alvo) return;
  const linhas = await fetch(`${A1.rest('a1_exclusoes')}?order=excluido_em.desc&limit=50`, {
    headers: A1.headers()
  })
    .then(r => (r.ok ? r.json() : []))
    .catch(() => []);
  const lista = Array.isArray(linhas) ? linhas : [];
  if (!lista.length) {
    alvo.innerHTML = `<div class="cfg-section-hdr">Exclusões já feitas</div>
      <div class="panel" style="padding:1.5rem;text-align:center;color:var(--t3);font-size:.79rem">
        Nenhuma exclusão definitiva registrada neste cliente.</div>`;
    return;
  }
  alvo.innerHTML = `<div class="cfg-section-hdr">Exclusões já feitas</div>
    <div class="tbl-wrap"><table class="pt-table"><thead><tr>
      <th>Quando</th><th>Módulo</th><th>Registro</th><th>Justificativa</th><th>Quem</th>
    </tr></thead><tbody>
    ${lista
      .map(e => {
        const quando = e.excluido_em ? new Date(e.excluido_em).toLocaleString('pt-BR') : '—';
        const mod = (EXC_MODULOS[e.modulo] || {}).rotulo || e.modulo;
        return `<tr>
        <td style="white-space:nowrap;color:var(--t3);font-size:.72rem">${esc(quando)}</td>
        <td style="font-weight:600">${esc(mod)}</td>
        <td><span class="exc-cod">${esc(e.codigo || '')}</span>
            <div style="font-size:.72rem;color:var(--t3);margin-top:.15rem">${esc(e.rotulo || '')}</div></td>
        <td style="font-size:.75rem;color:var(--t2)">${esc(e.justificativa || '')}</td>
        <td style="font-size:.75rem">${esc(e.ator_nome || '—')}</td>
      </tr>`;
      })
      .join('')}
    </tbody></table></div>`;
}

// Wire up modal backdrop close
document.querySelectorAll('.modal-bg').forEach(bg =>
  bg.addEventListener('click', e => {
    if (e.target === bg) closeModal(bg.id);
  })
);

init();
