'use strict';

const G = {
  // Arquivado não é apagado: é um cartão que saiu de vista. O quadro mostra os
  // ativos, e este interruptor mostra os guardados — sem ele, arquivar seria
  // apagar com outro nome.
  verArquivados: false,
  user: null,
  slug: null,
  tenant: null,
  stages: [],
  cases: [],
  groups: [],
  currentGroup: '__all__',
  currentView: 'andamento',
  filters: { search: '', empr: '', parceiro: '', re: '', analista: '', entrevista: '', usuario: '' },
  activeTab: 'dashboard',
  editingCaseId: null,
  editingCaseData: null,
  pdfData: null,
  flags: [],
  edges: {},
  dashFilters: { regional: '', empr: '', parceiro: '', re: '', analista: '', search: '' },
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

// ─── Init ─────────────────────────────────────────────────────────────────────

// Qual vista esta tela mostra. Dashboard, Andamento e Listagem eram três
// arquivos 96% iguais, e uma correção feita num deles não chegava aos outros
// (o histórico do processo, a permissão de criar, o espaço não separável do
// importador do CV: cada um tinha ficado para trás em alguma cópia). Agora são
// uma tela só, e o endereço decide a vista:
//   /cliente/repasse   → Dashboard
//   /cliente/andamento → quadro
//   /cliente/listagem  → lista
const VISTA = /\/andamento(\.html)?\/?$/.test(location.pathname)
  ? 'andamento'
  : /\/listagem(\.html)?\/?$/.test(location.pathname)
    ? 'listagem'
    : 'dashboard';
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

// ─── Seletor de painel do Dashboard ──────────────────────────────────────────
// O Dashboard sempre foi o do Repasse. Quando o cliente passa a ter mais de um
// módulo, ele precisa escolher qual painel está olhando.
//
// A ordem NÃO é a da barra de abas: aqui segue a jornada do negócio — a pessoa
// é pré-analisada, depois negocia, depois o repasse anda. A constante vem de
// src/shared/ui/modulo-shell.js para não haver duas listas discordando.
//
// Com um módulo só, o seletor não aparece. É o caso de todos os clientes de
// hoje, e é proposital: um seletor de uma opção só é ruído, e o Dashboard
// continua exatamente o que sempre foi.
const PAINEL_ROTULO = { PRE_ANALISE: 'Pré-análise', COMERCIAL: 'Venda', repasse: 'Repasse' };
const PAINEL_CHAVE_MEM = 'a1_painel_dash';

async function montarSeletorPainel() {
  const caixa = document.getElementById('seletor-painel');
  const botoes = document.getElementById('seletor-painel-botoes');
  if (!caixa || !botoes || typeof A1_ORDEM_PAINEIS === 'undefined') return;

  // Licença e permissão são duas barreiras diferentes. A anterior só escondia
  // botões; esta lista é a fonte única para o seletor e para trocarPainel().
  const licencas = await a1DashboardsDoCliente();
  const disponiveis = A1_ORDEM_PAINEIS.filter(m => a1PodeVerDashboardModulo(G.user, m, licencas));
  G.dashboardsPermitidos = disponiveis;
  G.permiteDashboard = disponiveis.length > 0;

  if (!disponiveis.length) {
    caixa.style.display = 'none';
    document.getElementById('painel-repasse')?.style &&
      (document.getElementById('painel-repasse').style.display = 'none');
    const modulo = document.getElementById('painel-modulo');
    if (modulo) {
      modulo.style.display = '';
      modulo.innerHTML =
        '<div class="empty-state">Seu perfil não tem acesso a nenhum dashboard licenciado.</div>';
    }
    return;
  }

  let escolhido = new URLSearchParams(location.search).get('painel') || 'repasse';
  try {
    const g = sessionStorage.getItem(PAINEL_CHAVE_MEM);
    if (!new URLSearchParams(location.search).get('painel') && g && disponiveis.includes(g)) escolhido = g;
  } catch {}
  if (!disponiveis.includes(escolhido)) escolhido = disponiveis[0];

  if (disponiveis.length < 2) {
    caixa.style.display = 'none';
    trocarPainel(escolhido);
    return;
  }

  botoes.innerHTML = disponiveis
    .map(
      m =>
        `<button type="button" data-painel="${esc(m)}" onclick="trocarPainel('${escJs(m)}')"
       style="border:none;background:none;padding:.45rem .95rem;font-size:.78rem;font-weight:700;color:var(--t3);cursor:pointer;font-family:inherit">${esc(PAINEL_ROTULO[m] || m)}</button>`
    )
    .join('');
  caixa.style.display = '';
  trocarPainel(escolhido);
}

function trocarPainel(qual) {
  if (!Array.isArray(G.dashboardsPermitidos) || !G.dashboardsPermitidos.includes(qual)) return;
  try {
    sessionStorage.setItem(PAINEL_CHAVE_MEM, qual);
  } catch {}
  document.querySelectorAll('#seletor-painel-botoes button').forEach(b => {
    const on = b.dataset.painel === qual;
    b.style.background = on ? 'var(--violet, #0E8C7F)' : 'none';
    b.style.color = on ? '#fff' : 'var(--t3)';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const repasse = document.getElementById('painel-repasse');
  const modulo = document.getElementById('painel-modulo');
  if (!repasse || !modulo) return;
  if (qual === 'repasse') {
    repasse.style.display = '';
    modulo.style.display = 'none';
    modulo.innerHTML = '';
    return;
  }
  repasse.style.display = 'none';
  modulo.style.display = '';
  if (qual === 'PRE_ANALISE') a1PainelPreAnalise(modulo);
  if (qual === 'COMERCIAL') a1PainelComercial(modulo);
}

async function init() {
  applyCustomLogo();
  try {
    G.user = a1RequireAuth();
  } catch {
    return;
  }
  // Permissões vêm do banco a cada carregamento (o localStorage guarda só o
  // retrato do login). Sem isso, mudança de permissão feita pelo gestor só
  // valia depois do usuário deslogar e logar de novo.
  // As duas leituras que decidem o botão de criar saem JUNTAS: a permissão da
  // pessoa e a regra-mãe do cliente. Em série seriam duas idas ao servidor antes
  // de qualquer pixel.
  const [_permsDoBanco, _geral] = await Promise.all([a1RefreshPartnerPerms(), a1GeralCarregar()]);
  G.user = A1.user || G.user;
  G.geral = _geral;
  // Gestor não passa por essa consulta; para ele a permissão é sempre certa.
  G.permsConfirmadas = G.user.role !== 'partner' || !!_permsDoBanco;
  // Revelado aqui, e não em applyPartnerRestrictions(): lá é depois do
  // loadData() inteiro, e quem PODE criar ficaria segundos sem o botão.
  aplicarBotaoNovoRepasse();
  // inicia o fetch do tenant em paralelo ao check de módulo (economiza 1 round-trip)
  const _tenantP = fetch(
    `${A1.rest('a1_tenants')}?id=eq.${G.user.tenant_id}&select=id,tipo_cliente,max_users`,
    { headers: A1.headers() }
  )
    .then(r => r.json())
    .then(a => a[0] || {})
    .catch(() => ({}));
  try {
    await a1RequireModule('repasse');
  } catch {
    return;
  }
  G.slug = A1.slug;
  if (VISTA === 'dashboard') {
    // Calculado antes de carregar quaisquer cards: assim um painel não autorizado
    // nunca é desenhado por um instante enquanto a permissão chega do servidor.
    const _dashLicencas = await a1DashboardsDoCliente();
    G.dashboardsPermitidos = A1_ORDEM_PAINEIS.filter(m => a1PodeVerDashboardModulo(G.user, m, _dashLicencas));
    G.permiteDashboard = a1PodeVerAlgumDashboard(G.user, _dashLicencas);
  }

  // O rótulo sai de src/shared/ui/modulo-shell.js, o mesmo que a Pré-análise e a Venda
  // usam. Aqui havia uma cópia que chamava de "Correspondente" todo parceiro
  // que não fosse despachante — o corretor aparecia com o papel de outra pessoa.
  const roleLabel = a1RotuloPapel(G.user);
  // O cabeçalho é montado por src/shared/ui/modulo-shell.js: marca, busca, abas de módulo
  // e a sub-barra desta tela. Seis telas tinham a sua cópia da mesma barra, com
  // o mesmo CSS repetido; a correção numa delas nunca chegava nas outras.
  if (VISTA === 'dashboard') {
    const _subDashboard = [];
    if (G.permiteDashboard) _subDashboard.push({ rot: 'Dashboard', href: `/${G.slug}/repasse`, ativo: true });
    _subDashboard.push(
      { rot: 'Andamento', href: `/${G.slug}/andamento` },
      { rot: 'Listagem', href: `/${G.slug}/listagem` }
    );
    await a1MontarShell(document.getElementById('sb-casco'), {
      ativo: 'geral',
      vista: 'dashboard',
      perfil: true,
      sub: _subDashboard
    });
  } else {
    await a1MontarShell(document.getElementById('sb-casco'), {
      ativo: 'repasse',
      vista: VISTA,
      perfil: true,
      sub: [
        { rot: 'Dashboard do Repasse', href: `/${G.slug}/repasse` },
        { rot: 'Andamento', href: `/${G.slug}/andamento`, ativo: VISTA === 'andamento' },
        { rot: 'Listagem', href: `/${G.slug}/listagem`, ativo: VISTA === 'listagem' }
      ]
    });
  }
  // Os links do editor de esteira ficam DENTRO desta tela, não na barra.
  [
    ['link-wf', 'repasse'],
    ['link-wf-groups', 'repasse'],
    ['link-wf-rg', 'registro']
  ].forEach(([id, mod]) => {
    const el = document.getElementById(id);
    if (el) el.href = `/${G.slug}/workflow?module=${mod}`;
  });

  // Item 1: esconde itens exclusivos do gestor ANTES de qualquer await (evita o "flash" p/ o usuário correspondente)
  // Item 2: mostra o ícone de perfil para o usuário correspondente
  if (G.user.role === 'partner') {
    ['link-config', 'link-wf', 'link-wf-groups', 'tab-registro-group'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const _bp = document.getElementById('btn-profile');
    if (_bp) _bp.style.display = '';
    // 'ver_repasses' é o degrau mais básico do módulo: sem ele o Repasse não
    // abre. Nenhum cadastro antigo tem a chave, e por isso hasPerm() a trata
    // como liberada quando ausente — quem tranca é a marca explícita, nunca a
    // omissão. Tem de vir ANTES de desenhar qualquer coisa: aviso que aparece
    // depois do quadro é o quadro tendo sido mostrado.
    if (!hasPerm('ver_repasses')) {
      semAcessoAoRepasse();
      return;
    }
    // A chave global `ver_dashboard` foi APOSENTADA: 2026-09-13_migra_dashboard_por_modulo
    // separou o dashboard por módulo e APAGA essa chave de todas as linhas. Como
    // hasPerm() trata ausente como false nestas telas, continuar perguntando por
    // ela tirava o Dashboard de TODO parceiro depois do SQL rodar — inclusive de
    // quem foi migrado para ver_dashboard_repasse:true. É a dívida da triplicação
    // mordendo: repasse.html foi atualizado e estas duas cópias ficaram para trás.
    if (!hasPerm('ver_dashboard_repasse')) {
      const _dl = document.getElementById('link-dashboard');
      if (_dl) _dl.style.display = 'none';
    }
  }
  // No Dashboard, quem não tem painel nenhum recebe o aviso, e nada mais é
  // carregado. Acesso direto não redireciona nem começa a carregar cartões para
  // depois voltar: o menu já nasceu sem a opção e a URL forçada recebe um estado
  // estável. RLS continua sendo a barreira dos dados no servidor.
  if (VISTA === 'dashboard' && !G.permiteDashboard) {
    const _dash = document.getElementById('tab-dashboard');
    _dash.innerHTML = `<div class="empty-state" role="alert" style="margin:2rem auto;max-width:640px">
      <div style="font-size:2rem;margin-bottom:.65rem" aria-hidden="true">🔒</div>
      <b>Você não possui permissão para acessar este recurso.</b>
      <div style="margin-top:.4rem;color:var(--t3)">Peça ao gestor a permissão de dashboard do módulo.</div>
    </div>`;
    _dash.style.display = '';
    a1StartHeartbeat('repasse');
    return;
  }

  // A área da vista aparece já aqui, vazia e com "Carregando", em vez de
  // esperar a carga inteira. É depois das travas de parceiro acima de
  // propósito: quem não tem acesso já saiu, e o botão de novo repasse já
  // obedece à permissão antes de ficar à vista.
  aplicarBotaoNovoRepasse();
  if (VISTA === 'dashboard') document.getElementById('tab-dashboard').style.display = '';
  else switchView(VISTA);

  // tenant já iniciado em paralelo lá em cima
  G.tenant = await _tenantP;

  // Cliente do tipo Correspondente: existe UMA única correspondente (limite=1). Todo
  // processo é vinculado a ela e o seletor de correspondente é ocultado no sistema.
  G.isCorrTenant = G.tenant && G.tenant.tipo_cliente === 'correspondente_bancario';
  if (G.isCorrTenant) {
    if (!G.empresasLoaded) {
      try {
        await loadEmpresas();
      } catch {}
    }
    G.fixedCorr =
      (Array.isArray(G.empresas) && G.empresas[0] && G.empresas[0].name) || G.user.tenant_name || '';
    const _fp = document.getElementById('f-parceiro');
    if (_fp) _fp.style.display = 'none';
    const _np = document.getElementById('n-partner-group');
    if (_np) _np.style.display = 'none';
  }

  // para usuario CCA: busca empresa, permissoes e lista de colegas com visibilidade compartilhada
  if (G.user.role === 'partner' && G.user.type === 'cca') {
    // Só a empresa: as permissões já vieram do a1RefreshPartnerPerms no início
    // do boot, que é o único lugar que lê, normaliza e grava. Buscar de novo
    // aqui criava um segundo dono da mesma informação — e como este bloco roda
    // depois, era ele quem ganhava, sem normalizar nada.
    const pr = await fetch(`${A1.rest('a1_partners')}?id=eq.${G.user.id}&select=empresa_id`, {
      headers: A1.headers()
    })
      .then(r => r.json())
      .then(a => a[0] || null)
      .catch(() => null);
    if (pr?.empresa_id) {
      const emp = await fetch(`${A1.rest('a1_corr_empresas')}?id=eq.${pr.empresa_id}&select=name`, {
        headers: A1.headers()
      })
        .then(r => r.json())
        .then(a => a[0] || {})
        .catch(() => ({}));
      G.user.empresa_name = emp.name || '';
      // busca colegas da mesma empresa que habilitaram visibilidade geral
      const colegas = await fetch(
        `${A1.rest('a1_partners')}?empresa_id=eq.${pr.empresa_id}&type=eq.cca&select=name,permissions`,
        { headers: A1.headers() }
      )
        .then(r => r.json())
        .catch(() => []);
      G.user.shared_managers = colegas
        .filter(c => c.name !== G.user.name && c.permissions?.ver_todos_repasses === true)
        .map(c => c.name);
    }
  }

  // Show Registro tab + config section only if module is enabled for this tenant
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

  // Módulos novos: a aba só aparece com a licença liberada. A pergunta vai ao
  // servidor; a resposta não é guardada em lugar nenhum que o usuário alcance,
  // e o acesso real aos dados continua barrado por RLS mesmo que alguém force
  // o link na barra de endereço.
  ['PRE_ANALISE', 'COMERCIAL'].forEach(mod => {
    a1HasModule(mod)
      .then(ok => {
        if (ok !== true) return;
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
      })
      .catch(() => {});
  });

  await loadData();
  if (G.isCorrTenant && G.fixedCorr) {
    const _un = G.cases.filter(c => !c.partner_name);
    for (const c of _un) c.partner_name = G.fixedCorr;
    if (_un.length) {
      const _ids = _un.map(c => c.id).filter(Boolean);
      if (_ids.length)
        fetch(`${A1.rest('a1_cases')}?id=in.(${_ids.join(',')})`, {
          method: 'PATCH',
          headers: A1.headers(),
          body: JSON.stringify({ partner_name: G.fixedCorr })
        }).catch(() => {});
    }
  }
  applyPartnerRestrictions();
  if (VISTA === 'dashboard') {
    // O painel de Repasse só é renderizado quando está explicitamente permitido.
    // Os painéis de Pré-análise/Venda são montados por montarSeletorPainel().
    if (G.dashboardsPermitidos.includes('repasse')) renderDashboard();
    await montarSeletorPainel();
    renderPipeline();
    renderList();
    loadFlags();
    a1StartHeartbeat('repasse');

    // Endereços antigos (?view=, ?tab=config) continuam levando ao lugar certo.
    const _params = new URLSearchParams(location.search);
    const _view = _params.get('view');
    if (_params.get('tab') === 'config') window.location.replace(`/${G.slug}/configuracoes`);
    else if (_view === 'andamento' || _view === 'listagem') window.location.replace(`/${G.slug}/${_view}`);
    return;
  }
  renderPipeline();
  renderList();
  loadFlags();
  document.getElementById('tab-dashboard').style.display = 'none';
  document.getElementById('tab-repasse').style.display = '';
  document.getElementById('tab-config').style.display = 'none';
  G.activeTab = 'repasse';
  switchView(VISTA);
  a1StartHeartbeat(VISTA);
}
function souGestorUser() {
  return !!G.user && G.user.role !== 'partner';
}
function souCorretor() {
  return !!G.user && G.user.role === 'partner' && G.user.type === 'corretor';
}
// Cadastros novos (corretor, analista) gravam a chave alterar_etapa; os antigos
// não têm, e por isso não são submetidos a essa exigência.
function usaPermissaoPorEtapa() {
  const p = (G.user && G.user.permissions) || {};
  // O mapa de etapas basta: quem tem etapa marcada está no modelo novo, mesmo
  // que a chave alterar_etapa venha de um perfil que não a declara.
  if (p.etapas && typeof p.etapas === 'object' && !Array.isArray(p.etapas) && Object.keys(p.etapas).length)
    return true;
  return 'alterar_etapa' in p;
}
function meuNome() {
  return ((G.user && G.user.name) || '').trim().toLowerCase();
}

// Corretor e analista enxergam APENAS o que está vinculado a eles. É regra do
// dono, e vale em todo o sistema — não é preferência de cadastro. Por isso vem
// antes de tudo: nem 'gerente' nem 'ver_todos_analistas' abrem a carteira para
// estes dois tipos, venham do cadastro ou de um perfil. O interruptor também
// saiu das telas deles, mas quem impõe a regra é isto aqui, não a ausência do
// campo — um perfil antigo ainda carrega a marca, e ela deixou de valer.
//
// Coordenador e correspondente continuam como eram: o coordenador existe
// justamente para acompanhar a equipe.
function soVeOSeu() {
  const t = G.user && G.user.type;
  return G.user && G.user.role === 'partner' && (t === 'corretor' || t === 'analista');
}

function temVisaoCompleta() {
  if (souGestorUser()) return true;
  if (soVeOSeu()) return false;
  const p = (G.user && G.user.permissions) || {};
  if (p.gerente) return true;
  if ('ver_todos_analistas' in p) return !!p.ver_todos_analistas;
  // AUSENTE, E É AQUI QUE MORA O CUIDADO.
  //
  // Para quem foi cadastrado antes deste modelo, ausente segue valendo "vê
  // tudo" — mudar isso tiraria acesso, sem aviso, de gente que trabalha hoje.
  //
  // Para quem segue um PERFIL, ausente é "não vê". Um perfil é sempre novo:
  // não existe cadastro antigo para preservar, e o perfil que não fala de
  // visão abria a carteira inteira do cliente em silêncio. É o oposto do que
  // a1_pa_visivel() faz no banco, e das duas quem estava errada era esta.
  return !(G.user && G.user.perfil_id);
}

function isMeuProcesso(c) {
  if (souGestorUser()) return true;
  const eu = meuNome();
  if (!eu || !c) return false;
  return [c.broker_name, c.manager_name, c.payload && c.payload.usuario_correspondente].some(
    v => (v || '').trim().toLowerCase() === eu
  );
}

// Acesso por etapa do corretor: mapa etapa -> 'ver' | 'editar'.
// null = sem restrição por etapa (gestor, gerente, correspondente comum).
function etapasDoUsuario() {
  const p = (G.user && G.user.permissions) || {};
  if (p.etapas && typeof p.etapas === 'object' && !Array.isArray(p.etapas)) return p.etapas;
  // Compatibilidade: cadastro antigo guardava só a lista, que valia como editar.
  if (p.ver_somente_etapas && Array.isArray(p.etapas_permitidas)) {
    const m = {};
    p.etapas_permitidas.forEach(id => {
      m[id] = 'editar';
    });
    return m;
  }
  return null;
}
// Nível do usuário naquela etapa: 'editar', 'ver' ou null (não enxerga).
function nivelNaEtapa(stageId) {
  const m = etapasDoUsuario();
  if (!m) return 'editar';
  return m[stageId] || null;
}

// Cartões que o usuário liberou manualmente para editar nesta sessão.
const _destravados = new Set();
function liberarEdicao(id) {
  _destravados.add(id);
  toast('Edição liberada para este processo.', 'info');
  openCard(id);
}
function podeEditarProcesso(c) {
  // Gestor não tem restrição, ponto — e este teste vem ANTES de qualquer outro
  // para que nenhuma regra criada depois (permissão, etapa, dono do processo)
  // consiga alcançar quem administra o sistema.
  if (souGestorUser()) return true;
  if (((G.user && G.user.permissions) || {}).gerente) return true;
  if (!hasPerm('editar_repasses')) return false;
  // Etapa marcada apenas como "ver" é somente leitura, mesmo sendo processo dele.
  if (nivelNaEtapa(c && c.stage_id) !== 'editar') return false;
  return isMeuProcesso(c) || (c && _destravados.has(c.id));
}

// Como o sistema enxerga quem está logado. Vai escrito na tarja de somente
// leitura: quando o gestor jura que a pessoa está com acesso total e a tarja
// aparece assim mesmo, a resposta quase sempre é que ela entrou por outro
// login. Melhor a tela dizer isso do que virar chamado de suporte.
function papelLegivel() {
  const u = G.user || {};
  if (u.role !== 'partner') return 'gestor';
  const p = u.permissions || {};
  if (p.gerente) return 'gerente';
  if (u.type === 'corretor') return 'corretor';
  if (u.type === 'analista') return 'analista';
  if (u.type === 'despachante') return 'despachante';
  return 'correspondente';
}

// Antes de dizer a alguém que ele não pode editar, confere a permissão no banco.
// As permissões no navegador são o retrato do login: se o gestor marcou
// "Gerente" ou "Editar operações" depois disso, a pessoa continuava bloqueada
// enquanto o gestor, olhando o cadastro, jurava que tinha liberado. Só custa
// uma consulta, e só no caminho em que a resposta seria "não".
async function podeEditarConferindo(c) {
  if (podeEditarProcesso(c)) return true;
  if (!G.user || G.user.role !== 'partner') return false;
  try {
    await a1RefreshPartnerPerms();
    G.user = A1.user || G.user;
  } catch {
    /* sem rede: fica com o que tinha */
  }
  return podeEditarProcesso(c);
}

// Sem 'ver_repasses' não há Repasse para esta pessoa: as abas do módulo somem e
// o conteúdo vira um aviso que diz a quem pedir. Não é redirecionamento porque
// ela pode não ter nenhum outro módulo — e mandar para lugar nenhum é como um
// laço de redirect começa.
function semAcessoAoRepasse() {
  ['link-dashboard', 'link-repasse-andamento', 'link-andamento', 'link-listagem'].forEach(id => {
    const el = document.getElementById(id);
    const g = el && el.closest ? el.closest('.tab-group') : null;
    if (g) g.style.display = 'none';
    else if (el) el.style.display = 'none';
  });
  const main = document.querySelector('.main');
  if (main)
    main.innerHTML =
      '<div style="max-width:520px;margin:3rem auto;text-align:center;background:var(--card);' +
      'border:1px solid var(--border);border-radius:12px;padding:2rem 1.5rem">' +
      '<div style="font-size:1rem;font-weight:800;margin-bottom:.5rem">Sem acesso ao Repasse</div>' +
      '<div style="font-size:.85rem;color:var(--t2);line-height:1.55">O seu cadastro não tem a ' +
      'permissão <b>Ver processos</b> no módulo de Repasse. Peça ao gestor em ' +
      'Configurações › Corretores (ou no perfil de acesso vinculado a você).</div></div>';
}

function hasPerm(key) {
  if (G.user.role !== 'partner') return true;
  const p = G.user.permissions || {};
  if (p.gerente) return true; // Gerente = acesso total, como o gestor
  // criar_repasses AUSENTE vale NÃO PODE, e isto tem de ser igual nas três telas.
  // A política do banco usa a1_perm(), que trata chave ausente como negativa; se
  // aqui o padrão fosse `true`, um correspondente sem a chave veria o botão,
  // preencheria o formulário inteiro e só então o banco recusaria a gravação.
  // repasse.html já estava assim; andamento e listagem ficaram para trás — a
  // mesma dívida da triplicação que já mordeu em ver_dashboard.
  const defaults = {
    ver_repasses: true,
    criar_repasses: false,
    editar_repasses: false,
    ver_dashboard: false,
    baixar_documentos: false,
    editar_perfil: true,
    ver_todos_repasses: false,
    ver_todos_analistas: true
  };
  return key in p ? !!p[key] : (defaults[key] ?? false);
}

// ── Perfil próprio do usuário correspondente (edita nome/email/cpf/telefone/senha; NÃO mexe em acessos) ──

// ─── "Novo Repasse": quem pode, e quando o botão aparece ─────────────────────
// O botão NASCE OCULTO no HTML e só é revelado depois que a permissão foi
// confirmada. Antes ele nascia visível e era escondido em
// applyPartnerRestrictions(), que só roda depois do loadData() — as catorze
// consultas do carregamento inteiro. Não era um piscar de milissegundos: o
// corretor com a criação desabilitada via o botão por segundos, e clicar nele
// funcionava. Foi relatado em produção.
//
// A proteção de verdade é do banco (política a1_cases_repasse_create_capability,
// em sql/2026-09-10_criar_repasse_trava.sql). Esconder botão é conveniência;
// a recusa que vale é a que a API dá.
function podeCriarRepasse() {
  // A REGRA DO CLIENTE VEM ANTES DE TUDO, inclusive do gestor. Se a operação
  // decidiu que repasse não nasce solto, ninguém cria manualmente — ele passa a
  // vir só do selo VENDIDO da esteira da Venda. Regra-mãe que o gestor pudesse
  // furar não seria regra, seria sugestão.
  if (!a1GeralPermite(G.geral, 'criar_repasse_avulso')) return false;
  // Gestor não depende de consulta nenhuma.
  if (!G.user || G.user.role !== 'partner') return true;
  // A criação manual é operação da retaguarda: somente Analista e
  // Correspondente (CCA), sempre com a permissão marcada positivamente.
  //
  // Esta linha faltava aqui e em listagem.html — estava só em repasse.html. É a
  // dívida da triplicação: a política do banco
  // (a1_cases_repasse_create_capability) exige o tipo desde 2026-09-13, e sem
  // ela estas duas telas ofereceriam o botão a um corretor com a chave marcada
  // para o banco recusar a gravação depois. Botão que mente é pior que botão
  // ausente: a pessoa preenche o formulário inteiro antes de descobrir.
  const tipo = String(G.user.type || '').toLowerCase();
  if (!['analista', 'cca'].includes(tipo)) return false;
  // Rede fora não é autorização — e o localStorage guarda o retrato do login,
  // que é justamente o que fica velho quando o gestor tira o acesso.
  if (!G.permsConfirmadas) return false;
  return hasPerm('criar_repasses');
}

function aplicarBotaoNovoRepasse() {
  const pode = podeCriarRepasse();
  document.querySelectorAll('[onclick="openNewCase()"]').forEach(el => {
    el.hidden = !pode;
  });
}

async function openProfile() {
  profErr('');
  let p = {};
  try {
    // `extra` entra na consulta porque é lá que mora o vínculo com a
    // imobiliária (extra.imobiliaria_id). Sem ele, o campo abaixo nunca teria
    // o que mostrar.
    p = await fetch(`${A1.rest('a1_partners')}?id=eq.${G.user.id}&select=name,email,cpf,phone,extra`, {
      headers: A1.headers()
    })
      .then(r => r.json())
      .then(a => a[0] || {});
  } catch {}
  document.getElementById('prof-name').value = p.name || G.user.name || '';
  document.getElementById('prof-email').value = p.email || '';
  document.getElementById('prof-cpf').value = p.cpf || '';
  document.getElementById('prof-phone').value = p.phone || '';
  document.getElementById('prof-password').value = '';
  document.getElementById('modal-profile-bg').classList.remove('hidden');
  // Depois de abrir: a imobiliária custa mais uma consulta, e segurar o modal
  // por ela faria o corretor esperar pelo que já está pronto. O campo nasce
  // oculto, então não há piscar de valor errado.
  mostrarImobiliariaNoPerfil(p);
}

// Traduz extra.imobiliaria_id para o NOME da imobiliária e mostra o campo.
// O id é do banco; quem lê é uma pessoa. Mostrar "p1" seria pior que não
// mostrar nada — o corretor leria um código que não significa coisa alguma.
// Sem vínculo, ou com um vínculo que não resolve para nome nenhum (imobiliária
// apagada, por exemplo), o campo simplesmente não aparece.
async function mostrarImobiliariaNoPerfil(p) {
  const grupo = document.getElementById('prof-imob-group');
  const campo = document.getElementById('prof-imob');
  if (!grupo || !campo) return;
  grupo.style.display = 'none';
  campo.value = '';
  const id = p && p.extra && p.extra.imobiliaria_id;
  if (!id) return;
  let nome = '';
  try {
    nome = await fetch(`${A1.rest('a1_partners')}?id=eq.${encodeURIComponent(id)}&select=name`, {
      headers: A1.headers()
    })
      .then(r => r.json())
      .then(a => (a && a[0] && a[0].name) || '');
  } catch {}
  if (!nome) return;
  // .value, e não innerHTML: nome de cadastro não vira HTML em hipótese
  // alguma. A "Imob Alfa" da base de teste carrega uma carga de XSS em aspa
  // justamente para cobrar isso.
  campo.value = nome;
  grupo.style.display = '';
}
function profErr(m) {
  const e = document.getElementById('prof-err');
  if (e) {
    e.textContent = m || '';
    e.style.display = m ? 'block' : 'none';
  }
}
async function saveProfile() {
  profErr('');
  const name = document.getElementById('prof-name').value.trim();
  if (!name) {
    profErr('Informe seu nome.');
    return;
  }
  const payload = {
    name,
    email: document.getElementById('prof-email').value.trim() || null,
    phone: document.getElementById('prof-phone').value.trim() || null
  };
  const pwd = document.getElementById('prof-password').value;
  if (pwd && pwd.length < 4) {
    profErr('A nova senha deve ter ao menos 4 caracteres.');
    return;
  }
  const btn = document.getElementById('prof-save-btn');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    const res = await fetch(A1.rpc('a1_atualizar_meu_perfil'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({
        p_nome: payload.name,
        p_email: payload.email,
        p_telefone: payload.phone,
        p_senha: pwd || null
      })
    });
    if (!res.ok) throw new Error(await motivoDoErro(res));
    G.user.name = name;
    try {
      const s = JSON.parse(localStorage.getItem('a1_user') || '{}');
      s.name = name;
      localStorage.setItem('a1_user', JSON.stringify(s));
    } catch {}
    // O cabeçalho é do casco. Aqui só se avisa que o nome mudou — e era esta
    // linha que ainda chamava todo parceiro de "Correspondente", inclusive o
    // corretor, que é o defeito que a1RotuloPapel existe para curar.
    a1ShellNome(name);
    toast('Perfil atualizado com sucesso.', 'success');
    closeModal('modal-profile-bg');
  } catch (e) {
    // "Tente novamente" nao ajuda quem foi barrado por regra: a pessoa tenta
    // de novo, e de novo, e nunca descobre o motivo.
    profErr(e.message || 'Erro ao salvar. Tente novamente.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

// O banco recusa com um codigo curto. Quem le e uma pessoa.
async function motivoDoErro(res) {
  let m = '';
  try {
    const j = await res.json();
    m = (j && (j.message || j.hint || j.details)) || '';
  } catch {}
  if (/parceiro_nao_define_permissao/.test(m))
    return 'Nome, e-mail, telefone e senha voce mesmo altera. CPF e permissoes so o gestor muda.';
  if (/parceiro_nao_apaga_cadastro/.test(m)) return 'Apagar cadastro e coisa do gestor.';
  // O gatilho manda o nome do que falta junto da mensagem. Repetir o nome aqui
  // e o que faz o gestor resolver em vez de recarregar a tela.
  const _falta = /documento_obrigatorio_faltando:\s*([^\n"}]*)/.exec(m);
  if (_falta)
    return a1DocsAvisoFaltando(
      _falta[1]
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
    );
  if (res.status === 401 || res.status === 403 || /row-level security/i.test(m))
    return 'Voce nao tem permissao para essa alteracao.';
  return 'Erro ao salvar. Tente novamente.';
}

function applyPartnerRestrictions() {
  if (G.user.role !== 'partner') return;

  // Ocultar link de configurações
  const cfgLink = document.getElementById('link-config');
  if (cfgLink) cfgLink.style.display = 'none';
  // Ocultar links de workflow (dentro de configurações)
  ['link-wf', 'link-wf-groups'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // Ocultar tab de Registro (partner nao acessa registro)
  const regGroup = document.getElementById('tab-registro-group');
  if (regGroup) regGroup.style.display = 'none';

  // Reaplicado aqui porque as permissões podem ter mudado durante a carga
  // (o cartão do correspondente fixo, por exemplo, mexe em G.user).
  aplicarBotaoNovoRepasse();

  // Idem: a chave por módulo, não a global aposentada.
  if (!hasPerm('ver_dashboard_repasse')) {
    const dashLink = document.getElementById('link-dashboard');
    if (dashLink) dashLink.style.display = 'none';
  }
}

// ─── Data ─────────────────────────────────────────────────────────────────────
async function loadData() {
  const [stages, casosRes, edgeRows, cfgRows, parceirosRows, emprRows, empresasRows] = await Promise.all([
    fetch(`${A1.rest('a1_stages')}?module_key=eq.repasse&order=position.asc`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => []),
    A1.buscarTudo(
      `${A1.rest('a1_cases')}?module_key=eq.repasse&archived=eq.${G.verArquivados ? 'true' : 'false'}&order=created_at.desc&select=id,tenant_id,module_key,stage_id,stage_name,stage_entered_at,client_name,client_cpf,client_email,client_phone,development,block,unit,region,contract_value,evaluation_expiry,assigned_user_id,partner_name,broker_name,broker_phone,real_estate_name,manager_name,payload,observations,is_new,new_at,manual_override,archived,created_at,updated_at`
    ).catch(() => ({ linhas: [], total: 0, completo: false, erro: 'falha de rede' })),
    fetch(`${A1.rest('a1_stage_edges')}?select=from_id,to_id`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => []),
    fetch(`${A1.rest('a1_config')}?key=in.(regionais,commission,wf_lock_repasse)&select=key,value`, {
      headers: A1.headers()
    })
      .then(r => r.json())
      .catch(() => []),
    // OITO consultas a a1_partners viraram UMA. Elas diferiam só pelo `type`, e o
    // navegador abre no máximo seis conexões por servidor: as duas últimas
    // ficavam esperando na fila as outras terminarem, atrasando a tela toda por
    // nada. Uma leitura só, agrupada por tipo aqui embaixo, é o mesmo dado com
    // um sétimo das idas ao servidor — e a1_partners é tabela pequena, de
    // dezenas de linhas, não de dezenas de milhares.
    fetch(
      `${A1.rest('a1_partners')}?type=in.(analista,corretor,convenio,agencia,coordenador,modalidade,imobiliaria,cca)&order=name.asc`,
      { headers: A1.headers() }
    )
      .then(r => r.json())
      .catch(() => []),
    // Empreendimentos e empresas correspondentes fecham os filtros. Imobiliária e
    // correspondente vêm na leitura de parceiros acima — sem elas, cadastro
    // recém-criado não aparecia para filtrar até existir processo usando ele.
    fetch(`${A1.rest('a1_developments')}?select=name&order=name.asc`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => []),
    fetch(`${A1.rest('a1_corr_empresas')}?select=name,is_active&order=name.asc`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => [])
  ]);
  G.stages = stages;
  // buscarTudo devolve as linhas mais o que o banco disse existir. O resto de
  // loadData trabalha com a lista, então ela vira "cases" aqui mesmo.
  const cases = Array.isArray(casosRes && casosRes.linhas)
    ? casosRes.linhas
    : Array.isArray(casosRes)
      ? casosRes
      : [];
  G.cases = cases;
  G.casosTotal = casosRes && casosRes.total != null ? casosRes.total : cases.length;
  G.casosCompleto = !casosRes || casosRes.completo !== false;
  avisarCargaIncompleta(casosRes && casosRes.erro);
  // A leitura única de parceiros, separada por tipo aqui. A ordem por nome veio
  // do banco, então cada fatia já sai ordenada.
  const _parc = Array.isArray(parceirosRows) ? parceirosRows : [];
  const _porTipo = t => _parc.filter(x => x && x.type === t);
  const _analistas = _porTipo('analista');
  if (_analistas.length) G.analistas = _analistas; // popula o filtro de Analista
  G.corretores = _porTipo('corretor');
  G.convenios = _porTipo('convenio');
  G.agencias = _porTipo('agencia');
  G.coordenadores = _porTipo('coordenador');
  G.modalidades = _porTipo('modalidade');
  G.imobsFiltro = _porTipo('imobiliaria');
  G.ccasFiltro = _porTipo('cca');
  G.emprFiltro = Array.isArray(emprRows) ? emprRows : [];
  G.empresasFiltro = Array.isArray(empresasRows) ? empresasRows : [];
  // Garante que TODO processo apareça no pipeline: processos com etapa inválida
  // (stage_id nulo ou apontando para etapa inexistente) são movidos para a etapa
  // inicial. Não-destrutivo: só afeta quem não estava em nenhuma etapa válida.
  {
    const _sm = {};
    for (const s of stages) _sm[s.id] = s;
    const _init = stages.find(s => s.is_initial) || stages[0];
    if (_init) {
      const _orphans = cases.filter(c => !_sm[c.stage_id]);
      for (const c of _orphans) {
        c.stage_id = _init.id;
        c.stage_name = _init.name;
      }
      if (_orphans.length) {
        const _ids = _orphans.map(c => c.id).filter(Boolean);
        if (_ids.length)
          fetch(`${A1.rest('a1_cases')}?id=in.(${_ids.join(',')})`, {
            method: 'PATCH',
            headers: A1.headers(),
            body: JSON.stringify({ stage_id: _init.id, stage_name: _init.name })
          }).catch(() => {});
      }
    }
  }
  G.edges = {};
  for (const e of edgeRows) {
    if (!G.edges[e.from_id]) G.edges[e.from_id] = [];
    G.edges[e.from_id].push(e.to_id);
  }
  // Regionais + comissão vêm juntas de a1_config (uma única request no Promise.all acima).
  const _cfg = {};
  if (Array.isArray(cfgRows)) for (const r of cfgRows) _cfg[r.key] = r.value;
  try {
    const v = JSON.parse(_cfg.regionais || '[]');
    G.regionais = Array.isArray(v) ? v : [];
  } catch {
    G.regionais = [];
  }
  G.wfLock = String(_cfg.wf_lock_repasse) === 'true';
  {
    const _sm = {};
    for (const s of stages) _sm[s.id] = s;
    const _extra = new Set();
    for (const c of cases) {
      const r = (c.payload && c.payload.regional) || _sm[c.stage_id]?.group_key;
      if (r && !G.regionais.includes(r)) _extra.add(r);
    }
    G.groups = [...G.regionais, ..._extra];
  }
  try {
    G.commission = JSON.parse(_cfg.commission || 'null');
  } catch {
    G.commission = null;
  }
  populateFilterOptions();
}

// A reconstrução das opções passa por A1.manterSelecoes: sem isso, toda carga
// (a volta para a aba, o salvar de um processo) devolvia os filtros para o vazio.
function populateFilterOptions() {
  return A1.manterSelecoes(_populateFilterOptions);
}
function _populateFilterOptions() {
  const emprs = _opcoesFiltro(
    (G.emprFiltro || []).map(e => e.name),
    G.cases.map(c => c.development)
  );
  const partners = _opcoesFiltro(
    _ativos(G.empresasFiltro),
    G.cases.map(c => c.partner_name)
  );
  const res = _opcoesFiltro(
    _ativos(G.imobsFiltro),
    G.cases.map(c => c.real_estate_name)
  );
  document.getElementById('dl-developments').innerHTML = emprs
    .map(e => `<option value="${esc(e)}">`)
    .join('');
  document.getElementById('dl-partners').innerHTML = partners.map(p => `<option value="${esc(p)}">`).join('');
  const analistaNomes = _opcoesFiltro(
    _ativos(G.analistas),
    G.cases.map(c => c.manager_name)
  );
  document.getElementById('f-empr').innerHTML =
    '<option value="">Empreendimento</option>' +
    emprs.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
  document.getElementById('f-parceiro').innerHTML =
    '<option value="">Correspondente</option>' +
    partners.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  document.getElementById('f-re').innerHTML =
    '<option value="">Imobiliária</option>' +
    res.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  document.getElementById('f-analista').innerHTML =
    '<option value="">Analista</option>' +
    analistaNomes.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  const corretores = _opcoesFiltro(
    _ativos(G.corretores),
    G.cases.map(c => c.broker_name)
  );
  const _fc = document.getElementById('f-corretor');
  if (_fc)
    _fc.innerHTML =
      '<option value="">Corretor</option>' +
      corretores.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
  const _fcv = document.getElementById('f-convenio');
  if (_fcv) {
    const conv = [
      ...new Set([..._convenioNames(), ...G.cases.map(c => c.payload && c.payload.convenio).filter(Boolean)])
    ].sort();
    _fcv.innerHTML =
      '<option value="">Convênio</option>' +
      conv.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  }
  const _fmo = document.getElementById('f-modalidade');
  if (_fmo) {
    const mods = [
      ...new Set([
        ..._modalidadeNames(),
        ...G.cases.map(c => c.payload && c.payload.modalidade).filter(Boolean)
      ])
    ].sort();
    _fmo.innerHTML =
      '<option value="">Modalidade</option>' +
      mods.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  }
  const _fkd = document.getElementById('f-coordenador');
  if (_fkd) {
    const kds = _coordenadorNames().slice().sort();
    _fkd.innerHTML =
      '<option value="">Coordenador</option>' +
      kds.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  }
  const _fag = document.getElementById('f-agencia');
  if (_fag) {
    const ags = [
      ...new Set([..._agenciaNames(), ...G.cases.map(c => c.payload && c.payload.agencia).filter(Boolean)])
    ].sort();
    _fag.innerHTML =
      '<option value="">Agência</option>' +
      ags.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  }
  const usuariosCorr = _opcoesFiltro(
    _ativos(G.ccasFiltro),
    G.cases.map(c => c.payload && c.payload.usuario_correspondente)
  );
  const _fu = document.getElementById('f-usuario');
  if (_fu)
    _fu.innerHTML =
      '<option value="">Usuário Correspondente</option>' +
      usuariosCorr.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
  document.getElementById('tbl-stage-filter').innerHTML =
    '<option value="">Todas as etapas</option>' +
    G.stages.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function gotoRegistro(view) {
  window.location.href = `/${G.slug}/registro?view=${view || 'andamento'}`;
}

function switchTab(tab, el) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  // Nem todo chamador tem o botão em mãos (switchView passa null quando a aba
  // não está na tela). Sem esta guarda, a troca de visão morria aqui.
  if (el && el.classList) el.classList.add('active');
  ['dashboard', 'repasse', 'config'].forEach(
    t => (document.getElementById('tab-' + t).style.display = t === tab ? '' : 'none')
  );
  // A aba do Repasse tem duas vistas, e as duas nascem escondidas (quem decide é
  // a rota). Entrar na aba mostra a vista atual; sem isso, a aba abria vazia.
  if (tab === 'repasse') {
    const v = G.currentView === 'listagem' ? 'listagem' : 'andamento';
    document.getElementById('view-andamento').style.display = v === 'andamento' ? '' : 'none';
    document.getElementById('view-listagem').style.display = v === 'listagem' ? '' : 'none';
  }
  const prev = G.activeTab;
  G.activeTab = tab;
  if (tab === 'config') closeCfgView(); // always return to hub when entering config
  if ((tab === 'dashboard' || tab === 'repasse') && prev === 'config') {
    loadData().then(() => {
      renderDashboard();
      renderPipeline();
      renderList();
    });
  }
}

// ─── Config sub-views ─────────────────────────────────────────────────────────
const CFG_VIEWS = [
  'wf',
  'flags',
  'regionais',
  'empreendimentos',
  'imobiliarias',
  'doctypes',
  'analistas',
  'correspondentes',
  'despachantes',
  'bancos',
  'cartorios'
];

function openCfgView(name) {
  document.getElementById('cfg-hub').style.display = 'none';
  CFG_VIEWS.forEach(v => (document.getElementById('cfg-view-' + v).style.display = v === name ? '' : 'none'));
  if (name === 'correspondentes' && !G.partnersLoaded) loadPartners();
  if (name === 'correspondentes' && !G.empresasLoaded) loadEmpresas();
  if (name === 'empreendimentos' && !G.emprLoaded) loadEmpreendimentos();
  if (name === 'imobiliarias' && !G.imobsLoaded) loadImobs();
  if (name === 'doctypes' && !G.docTypesLoaded) initDocTypesView();
  if (name === 'analistas' && !G.analistasLoaded) loadAnalistas();
  if (name === 'despachantes' && !G.despLoaded) loadDespachantes();
  if (name === 'bancos' && !G.bancosLoaded) loadBancos();
  if (name === 'cartorios' && !G.cartoriosLoaded) loadCartorios();
}

function closeCfgView() {
  document.getElementById('cfg-hub').style.display = '';
  CFG_VIEWS.forEach(v => (document.getElementById('cfg-view-' + v).style.display = 'none'));
}

function switchView(view) {
  G.currentView = view;
  document.querySelectorAll('.dd-item').forEach(d => d.classList.remove('active'));
  document.querySelectorAll('.dd-item').forEach(d => {
    if (d.textContent.toLowerCase().includes(view)) d.classList.add('active');
  });
  document.getElementById('view-andamento').style.display = view === 'andamento' ? '' : 'none';
  document.getElementById('view-listagem').style.display = view === 'listagem' ? '' : 'none';
  document.getElementById('view-label').textContent = view === 'andamento' ? 'Andamento' : 'Listagem';
  // O relatório em planilha exporta a lista filtrada: o botão é da Listagem.
  const _exp = document.getElementById('btn-exportar');
  if (_exp) _exp.style.display = view === 'listagem' ? '' : 'none';
  document.title = (view === 'andamento' ? 'Andamento' : 'Listagem') + ' — SIIMOB';

  // Make sure we're on the repasse tab
  if (G.activeTab !== 'repasse') {
    const repasseBtn = document.getElementById('tab-repasse-btn');
    switchTab('repasse', repasseBtn);
  }
}

// ─── Dashboard filters ────────────────────────────────────────────────────────
function dashCases() {
  const {
    regional,
    empr,
    parceiro,
    re,
    analista,
    corretor,
    convenio,
    agencia,
    coordenador,
    modalidade,
    search
  } = G.dashFilters;
  const sm = stageMap();
  const _etDash = etapasDoUsuario();
  return G.cases.filter(c => {
    // O painel segue o mesmo recorte do quadro: parceiro vê a própria empresa,
    // e sem visão completa vê apenas as próprias operações.
    if (G.user.role === 'partner') {
      if (G.user.empresa_name && c.partner_name !== G.user.empresa_name) return false;
    }
    if (!temVisaoCompleta() && !isMeuProcesso(c)) return false;
    if (_etDash && !nivelNaEtapa(c.stage_id)) return false;
    if (regional) {
      const _r = (c.payload && c.payload.regional) || sm[c.stage_id]?.group_key || '';
      if (_r !== regional) return false;
    }
    if (empr && c.development !== empr) return false;
    if (parceiro && c.partner_name !== parceiro) return false;
    if (re && c.real_estate_name !== re) return false;
    if (analista && c.manager_name !== analista) return false;
    if (corretor && c.broker_name !== corretor) return false;
    if (convenio && (c.payload && c.payload.convenio) !== convenio) return false;
    if (agencia && (c.payload && c.payload.agencia) !== agencia) return false;
    if (coordenador && !_souDaEquipe(c, coordenador)) return false;
    if (modalidade && (c.payload && c.payload.modalidade) !== modalidade) return false;
    if (search && !A1.casaBusca([c.client_name, c.client_cpf, c.development], search)) return false;
    return true;
  });
}

// A reconstrução das opções passa por A1.manterSelecoes: sem isso, toda carga
// (a volta para a aba, o salvar de um processo) devolvia os filtros para o vazio.
function populateDashFilters() {
  return A1.manterSelecoes(_populateDashFilters);
}
function _populateDashFilters() {
  const emprs = _opcoesFiltro(
    (G.emprFiltro || []).map(e => e.name),
    G.cases.map(c => c.development)
  );
  const partners = _opcoesFiltro(
    _ativos(G.empresasFiltro),
    G.cases.map(c => c.partner_name)
  );
  const res = _opcoesFiltro(
    _ativos(G.imobsFiltro),
    G.cases.map(c => c.real_estate_name)
  );
  const df = G.dashFilters;
  const sel = (id, placeholder, opts, cur) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML =
      `<option value="">${placeholder}</option>` +
      opts.map(o => `<option value="${esc(o)}"${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('');
  };
  const analistas = _opcoesFiltro(
    _ativos(G.analistas),
    G.cases.map(c => c.manager_name)
  );
  sel('df-regional', 'Todas as regionais', G.groups, df.regional);
  sel('df-empr', 'Empreendimento', emprs, df.empr);
  sel('df-parceiro', 'Correspondente', partners, df.parceiro);
  sel('df-re', 'Imobiliaria', res, df.re);
  sel('df-analista', 'Analista', analistas, df.analista);
  sel(
    'df-corretor',
    'Corretor',
    _opcoesFiltro(
      _ativos(G.corretores),
      G.cases.map(c => c.broker_name)
    ),
    df.corretor
  );
  sel(
    'df-convenio',
    'Convênio',
    [
      ...new Set([..._convenioNames(), ...G.cases.map(c => c.payload && c.payload.convenio).filter(Boolean)])
    ].sort(),
    df.convenio
  );
  sel(
    'df-agencia',
    'Agência',
    [
      ...new Set([..._agenciaNames(), ...G.cases.map(c => c.payload && c.payload.agencia).filter(Boolean)])
    ].sort(),
    df.agencia
  );
  sel('df-coordenador', 'Coordenador', _coordenadorNames().slice().sort(), df.coordenador);
  sel(
    'df-modalidade',
    'Modalidade',
    [
      ...new Set([
        ..._modalidadeNames(),
        ...G.cases.map(c => c.payload && c.payload.modalidade).filter(Boolean)
      ])
    ].sort(),
    df.modalidade
  );
  const srch = document.getElementById('df-search');
  if (srch) srch.value = df.search;
}

function applyDashFilter() {
  G.dashFilters.regional = document.getElementById('df-regional')?.value || '';
  G.dashFilters.empr = document.getElementById('df-empr')?.value || '';
  G.dashFilters.parceiro = document.getElementById('df-parceiro')?.value || '';
  G.dashFilters.re = document.getElementById('df-re')?.value || '';
  G.dashFilters.analista = document.getElementById('df-analista')?.value || '';
  G.dashFilters.corretor = document.getElementById('df-corretor')?.value || '';
  G.dashFilters.convenio = document.getElementById('df-convenio')?.value || '';
  G.dashFilters.agencia = document.getElementById('df-agencia')?.value || '';
  G.dashFilters.coordenador = document.getElementById('df-coordenador')?.value || '';
  G.dashFilters.modalidade = document.getElementById('df-modalidade')?.value || '';
  pintarContadorFiltros();
  G.dashFilters.search = document.getElementById('df-search')?.value || '';
  renderDashboard();
}

function clearDashFilters() {
  G.dashFilters = {
    regional: '',
    empr: '',
    parceiro: '',
    re: '',
    analista: '',
    corretor: '',
    convenio: '',
    agencia: '',
    coordenador: '',
    modalidade: '',
    search: ''
  };
  [
    'df-regional',
    'df-empr',
    'df-parceiro',
    'df-re',
    'df-analista',
    'df-corretor',
    'df-convenio',
    'df-agencia',
    'df-coordenador',
    'df-modalidade',
    'df-search'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderDashboard();
  pintarContadorFiltros();
}

// ─── Módulo Financeiro (helpers) ──────────────────────────────────────────────
function brNum(x) {
  if (x == null || x === '') return 0;
  if (typeof x === 'number') return x;
  const n = parseFloat(
    String(x)
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '')
  );
  return isNaN(n) ? 0 : n;
}
function caseUnitValue(c) {
  const vr = c.payload && c.payload.valores;
  return brNum(vr && vr.valor_previsto) || Number(c.contract_value) || 0 || brNum(vr && vr.valor_contrato);
}
function caseRepasseValue(c) {
  const vr = c.payload && c.payload.valores;
  if (vr) {
    const t = brNum(vr.valor_divida) + brNum(vr.valor_subsidio) + brNum(vr.valor_fgts);
    if (t > 0) return t;
  }
  return caseUnitValue(c);
}
function caseIsFinal(c) {
  return !!(stageMap()[c.stage_id] && stageMap()[c.stage_id].is_final);
}
function caseIsSigned(c) {
  return !!(c.payload && c.payload.valores && c.payload.valores.data_assinatura) || caseIsFinal(c);
}
function caseSignDate(c) {
  return (
    (c.payload && c.payload.valores && c.payload.valores.data_assinatura) ||
    (caseIsFinal(c) ? c.stage_entered_at : null)
  );
}
function inThisMonth(d) {
  if (!d) return false;
  const x = new Date(d);
  if (isNaN(x)) return false;
  const n = new Date();
  return x.getMonth() === n.getMonth() && x.getFullYear() === n.getFullYear();
}
function commissionFor(base) {
  const cm = G.commission;
  if (!cm) return 0;
  if (cm.type === 'FIXED') return Number(cm.fixed_value) || 0;
  if (cm.type === 'PERCENTAGE') return (Number(base) || 0) * ((Number(cm.percentage_value) || 0) / 100);
  return 0;
}
function fmtBRLShort(v) {
  return Number(v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0
  });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function renderDashboard() {
  populateDashFilters();
  const cases = dashCases();
  const sm = stageMap();

  // ── Top 5 KPIs ──
  const nonFinal = cases.filter(c => !sm[c.stage_id]?.is_final);
  const final = cases.filter(c => sm[c.stage_id]?.is_final);
  const atrasados = nonFinal.filter(c => daysSince(c.stage_entered_at) > 30);
  const semParceiro = cases.filter(c => !c.partner_name && !sm[c.stage_id]?.is_final);

  setT('kpi-total', cases.length);
  setT('kpi-andamento', nonFinal.length);
  setT('kpi-concluidos', final.length);
  setT('kpi-atrasados', atrasados.length);
  // Cliente do tipo correspondente é ele mesmo o correspondente de todo processo,
  // então "sem correspondente" nunca acusaria nada. Nesse caso o KPI passa a
  // medir o que de fato falta vincular: o corretor.
  if (G.isCorrTenant) {
    const semCorretor = cases.filter(c => !c.broker_name && !sm[c.stage_id]?.is_final);
    setT('kpi-sem-parceiro', semCorretor.length);
    setT('kpi-sem-parceiro-lbl', 'Sem Corretor');
    setT('kpi-sem-parceiro-sub', 'sem corretor vinculado');
  } else {
    setT('kpi-sem-parceiro', semParceiro.length);
  }

  // ── Secondary KPIs ──
  const taxa = cases.length ? Math.round((final.length / cases.length) * 100) : 0;
  setT('kpi2-taxa', taxa + '%');

  const g = calcularGargalo(nonFinal, sm);
  if (g) {
    setT('kpi2-gargalo', g.processos);
    setT('kpi2-gargalo-sub', `${g.nome} · ${g.mediaDias}d parados`);
  } else {
    setT('kpi2-gargalo', '—');
    setT('kpi2-gargalo-sub', 'sem dados');
  }

  // Tempo médio = do início à conclusão, medido sobre os processos que chegaram
  // a uma etapa marcada como FINAL no workflow (stage_entered_at é o momento em
  // que entraram nela). Sem nenhum concluído ainda, não há o que medir.
  const _dur = final.map(c => {
    const ini = new Date(c.created_at).getTime();
    const fim = new Date(c.stage_entered_at || c.created_at).getTime();
    return fim > ini ? (fim - ini) / 86400000 : 0;
  });
  if (_dur.length) {
    setT('kpi2-tempo', Math.round(_dur.reduce((a, b) => a + b, 0) / _dur.length) + 'd');
    setT('kpi2-tempo-sub', `media de ${_dur.length} processo(s) concluido(s)`);
  } else {
    setT('kpi2-tempo', '—');
    setT('kpi2-tempo-sub', 'nenhum processo concluido ainda');
  }

  const oldest = nonFinal
    .slice()
    .sort((a, b) => new Date(a.stage_entered_at) - new Date(b.stage_entered_at))[0];
  if (oldest) {
    setT('kpi2-antigo', oldest.client_name.split(' ')[0]);
    setT('kpi2-antigo-sub', `${sm[oldest.stage_id]?.name || '—'} · ${daysSince(oldest.stage_entered_at)}d`);
  } else {
    setT('kpi2-antigo', '—');
    setT('kpi2-antigo-sub', 'sem casos ativos');
  }

  // ── Métricas financeiras (mês atual) ──
  const vgvAssinado = cases
    .filter(c => caseIsSigned(c) && inThisMonth(caseSignDate(c)))
    .reduce((s, c) => s + caseUnitValue(c), 0);
  const vgvNao = cases
    .filter(c => !caseIsSigned(c) && inThisMonth(c.created_at))
    .reduce((s, c) => s + caseUnitValue(c), 0);
  const prevRepasse = cases
    .filter(c => inThisMonth(c.payload && c.payload.valores && c.payload.valores.data_previsao_repasse))
    .reduce((s, c) => s + caseRepasseValue(c), 0);
  let comissao = 0;
  for (const c of cases) {
    const dPrev = c.payload && c.payload.valores && c.payload.valores.data_previsao_repasse;
    const concluido = caseIsFinal(c) && inThisMonth(dPrev || c.stage_entered_at);
    const previsto = !caseIsFinal(c) && inThisMonth(dPrev);
    if (concluido || previsto) comissao += commissionFor(caseRepasseValue(c));
  }
  setT('fin-vgv-assinado', fmtBRL(vgvAssinado));
  setT('fin-vgv-nao', fmtBRL(vgvNao));
  setT('fin-repasse', fmtBRL(prevRepasse));
  setT('fin-comissao', fmtBRL(comissao));

  const cutoff48 = Date.now() - 48 * 3600 * 1000;
  // "Novos" = processos parados na etapa marcada como INICIAL no workflow.
  // Se nenhuma etapa estiver marcada, cai para os criados nas ultimas 48h e o
  // rotulo avisa, para o gestor perceber que falta marcar a etapa inicial.
  const _iniIds = new Set(G.stages.filter(s => s.is_initial).map(s => s.id));
  if (_iniIds.size) {
    setT('kpi2-novos', cases.filter(c => _iniIds.has(c.stage_id)).length);
    setT('kpi2-novos-sub', 'na etapa inicial');
  } else {
    setT('kpi2-novos', cases.filter(c => new Date(c.created_at).getTime() > cutoff48).length);
    setT('kpi2-novos-sub', 'ultimas 48h — marque a etapa inicial no workflow');
  }

  // ── Donut chart ──
  renderDonutChart(cases, sm);

  // ── Funil detail ──
  renderFunilDetail(cases, sm);

  // ── Distribution panels ──
  renderDistList('empr-dist-list', cases.map(c => c.development).filter(Boolean), '#0E8C7F');
  renderDistList('parceiro-dist-list', cases.map(c => c.partner_name).filter(Boolean), '#3F6F9E');
  renderDistList('re-dist-list', cases.map(c => c.real_estate_name).filter(Boolean), '#0B7568');
  renderDistList(
    'coord-dist-list',
    cases.map(c => _coordenadorDoCorretor(c.broker_name)).filter(Boolean),
    '#a21caf'
  );
  renderDistList(
    'modalidade-dist-list',
    cases.map(c => c.payload && c.payload.modalidade).filter(Boolean),
    '#e11d48'
  );
  renderGargalo(nonFinal, sm);
  renderTempoEtapas(cases);
  renderAgendaCalendar();
}

// Quantos dias, em média, cada processo levou da venda até chegar na etapa em
// que está hoje. Só entra quem tem data de venda preenchida — e o rodapé diz
// quantos ficaram de fora, senão uma média baseada em três processos passaria
// por verdade geral.
function renderTempoEtapas(cases) {
  const el = document.getElementById('tempo-etapa-list');
  const sub = document.getElementById('tempo-etapa-sub');
  if (!el) return;
  const hoje = new Date();
  const porEtapa = {};
  let comData = 0,
    semData = 0;

  for (const c of cases) {
    const venda = _dataVenda(c);
    if (!venda) {
      semData++;
      continue;
    }
    comData++;
    // A referência é quando o processo entrou na etapa atual; se não houver,
    // usa hoje — para quem está parado, o número cresce, que é o que interessa.
    const marco = c.stage_entered_at ? new Date(c.stage_entered_at) : hoje;
    const dias = Math.round((marco - venda) / 86400000);
    if (!isFinite(dias) || dias < 0) continue;
    const et = c.stage_id || 'sem-etapa';
    (porEtapa[et] = porEtapa[et] || []).push(dias);
  }

  const ordem = etapasOrdenadas();
  const linhas = ordem
    .filter(s => porEtapa[s.id] && porEtapa[s.id].length)
    .map(s => {
      const v = porEtapa[s.id];
      const media = Math.round(v.reduce((a, b) => a + b, 0) / v.length);
      return { nome: s.name, cor: s.color || '#0E8C7F', media, n: v.length };
    });

  if (sub) {
    sub.textContent = comData
      ? `Média de dias entre a data da venda e a chegada na etapa. ${comData} processo${comData !== 1 ? 's' : ''} com data preenchida${semData ? `; ${semData} sem data ficaram de fora` : ''}.`
      : 'Nenhum processo tem Data da Venda preenchida ainda — preencha no cadastro para esta visão funcionar.';
  }
  if (!linhas.length) {
    el.innerHTML = '<span style="color:var(--t3);font-size:.77rem">Sem dados para calcular.</span>';
    return;
  }

  const maior = Math.max(...linhas.map(l => l.media)) || 1;
  el.innerHTML = linhas
    .map(
      (l, i) => `
    <div class="dist-row">
      <div class="dist-num">${i + 1}</div>
      <div class="dist-name" title="${esc(l.nome)}">${esc(l.nome)} <span style="color:var(--t3);font-weight:400">(${l.n})</span></div>
      <div class="dist-bar-wrap"><div class="dist-bar" style="width:${Math.round((l.media / maior) * 100)}%;background:${esc(l.cor)}"></div></div>
      <div class="dist-val">${l.media}d</div>
    </div>`
    )
    .join('');
}

// Data da venda, aceitando o que o usuário digitou e o que veio da importação.
function _dataVenda(c) {
  const bruto = c && c.payload && c.payload.data_venda;
  if (!bruto) return null;
  const d = new Date(String(bruto).length <= 10 ? bruto + 'T12:00:00' : bruto);
  return isNaN(d) ? null : d;
}

// Etapas na ordem do workflow; as sem posição vão para o fim.
function etapasOrdenadas() {
  return (Array.isArray(G.stages) ? G.stages : [])
    .slice()
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
}

function renderDonutChart(cases, sm) {
  const el = document.getElementById('donut-wrap');
  const total = cases.length;
  if (!total || !G.stages.length) {
    el.innerHTML = `<span style="color:var(--t3);font-size:.78rem">Sem dados para exibir</span>`;
    return;
  }
  const counts = {};
  for (const c of cases) counts[c.stage_id] = (counts[c.stage_id] || 0) + 1;
  const R = 46,
    cx = 56,
    cy = 56,
    sw = 14;
  const circ = 2 * Math.PI * R;
  let cumLen = 0;
  const segs = G.stages
    .filter(s => counts[s.id])
    .map(s => {
      const n = counts[s.id];
      const arcLen = (n / total) * circ;
      const seg = { s, n, arcLen, offset: circ - cumLen };
      cumLen += arcLen;
      return seg;
    });
  const svgArcs = segs
    .map(
      a =>
        `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${a.s.color}" stroke-width="${sw}"
      stroke-dasharray="${a.arcLen.toFixed(2)} ${(circ - a.arcLen).toFixed(2)}"
      stroke-dashoffset="${a.offset.toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"/>`
    )
    .join('');
  const legendItems = segs
    .slice(0, 9)
    .map(a => {
      const pct = Math.round((a.n / total) * 100);
      return `<div class="donut-leg-row">
      <div class="donut-leg-dot" style="background:${a.s.color}"></div>
      <div class="donut-leg-name" title="${esc(a.s.name)}">${esc(a.s.name)}</div>
      <div class="donut-leg-val">${a.n}</div>
      <div class="donut-leg-pct">${pct}%</div>
    </div>`;
    })
    .join('');
  el.innerHTML = `
    <div class="donut-svg-wrap" style="width:112px;height:112px;flex-shrink:0">
      <svg width="112" height="112" viewBox="0 0 112 112">
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#F1F5F9" stroke-width="${sw}"/>
        ${svgArcs}
      </svg>
      <div class="donut-center">
        <div class="donut-total-val">${total}</div>
        <div class="donut-total-lbl">total</div>
      </div>
    </div>
    <div class="donut-legend">${legendItems}</div>`;
}

function renderFunilDetail(cases, sm) {
  const el = document.getElementById('funil-detail-list');
  if (!G.stages.length) {
    el.innerHTML = `<span style="color:var(--t3);font-size:.77rem">Nenhuma etapa configurada. <a href="/${G.slug}/workflow?module=repasse" style="color:var(--violet)">Editar workflow</a></span>`;
    return;
  }
  const total = cases.length;
  const counts = {},
    sumDays = {};
  for (const c of cases) {
    counts[c.stage_id] = (counts[c.stage_id] || 0) + 1;
    sumDays[c.stage_id] = (sumDays[c.stage_id] || 0) + daysSince(c.stage_entered_at);
  }
  const maxN = Math.max(1, ...G.stages.map(s => counts[s.id] || 0));
  const nonFinal = G.stages.filter(s => !s.is_final);
  const gargaloId = nonFinal.sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))[0]?.id;
  el.innerHTML = G.stages
    .map(s => {
      const n = counts[s.id] || 0;
      const pct = total ? Math.round((n / total) * 100) : 0;
      const avgD = n ? Math.round(sumDays[s.id] / n) : 0;
      const isGargalo = !s.is_final && s.id === gargaloId && n > 0;
      const isPendente = s.is_pending && n > 0 && !isGargalo;
      return `<div class="funil-row2">
      <div class="funil-name-cell">
        <div class="funil-stage-dot2" style="background:${s.color}"></div>
        <div class="funil-stage-name2" title="${esc(s.name)}">${esc(s.name)}</div>
      </div>
      <div class="funil-bar-wrap"><div class="funil-bar" style="width:${Math.round((n / maxN) * 100)}%;background:${s.color}"></div></div>
      <div class="funil-count2">${n}</div>
      <div class="funil-pct2">${pct}%</div>
      <div class="funil-time2">
        ${n ? `<span>${avgD}d</span>` : ''}
        ${isGargalo ? '<span class="badge-gargalo">Gargalo</span>' : ''}
        ${isPendente ? '<span class="badge-pendente2">Pendente</span>' : ''}
      </div>
    </div>`;
    })
    .join('');
}

function renderDistList(elId, items, color) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<span style="color:var(--t3);font-size:.77rem">Sem dados</span>';
    return;
  }
  const counts = {};
  for (const x of items) counts[x] = (counts[x] || 0) + 1;
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const maxN = sorted[0][1];
  el.innerHTML = sorted
    .map(
      ([name, n], i) => `
    <div class="dist-row">
      <div class="dist-num">${i + 1}</div>
      <div class="dist-name" title="${esc(name)}">${esc(name)}</div>
      <div class="dist-bar-wrap"><div class="dist-bar" style="width:${Math.round((n / maxN) * 100)}%;background:${color}"></div></div>
      <div class="dist-val">${n}</div>
    </div>`
    )
    .join('');
}

// Quando a leitura não trouxe tudo, é obrigação dizer. Um painel com número
// errado e cara de certo é pior do que um painel que assume a falha.
function avisarCargaIncompleta(motivo) {
  const id = 'aviso-carga-incompleta';
  let el = document.getElementById(id);
  if (G.casosCompleto) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);top:.6rem;z-index:9000;' +
      'background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:.6rem .95rem;' +
      'border-radius:8px;font-size:.8rem;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.12);max-width:92vw';
    document.body.appendChild(el);
  }
  el.textContent =
    `Atenção: carreguei ${G.cases.length} de ${G.casosTotal} processos` +
    (motivo ? ` (${motivo})` : '') +
    '. Os números desta tela estão incompletos — recarregue a página.';
}

// ─── Onde o funil realmente trava ────────────────────────────────────────────
// Contar processos por etapa não acha gargalo: a etapa inicial quase sempre é a
// mais cheia só porque tudo passa por ela, e some do radar a etapa com cinco
// processos parados há dois meses — que é onde o dinheiro está preso.
//
// O que trava é processo PARADO. Então a medida é quantidade × tempo: a soma
// dos dias que os processos estão esperando naquela etapa (dias-espera). Uma
// etapa com 40 processos de 1 dia soma 40; outra com 5 processos de 60 dias
// soma 300 — e é essa a que precisa de gente.
function calcularGargalo(processos, mapaEtapas) {
  const porEtapa = {};
  for (const c of processos) {
    const id = c.stage_id;
    if (!id) continue;
    const e = porEtapa[id] || (porEtapa[id] = { dias: [], soma: 0 });
    const d = stageDays(c);
    e.dias.push(d);
    e.soma += d;
  }
  const linhas = Object.entries(porEtapa).map(([id, e]) => ({
    id,
    nome: (mapaEtapas[id] && mapaEtapas[id].name) || '—',
    processos: e.dias.length,
    mediaDias: Math.round(e.soma / e.dias.length),
    maiorDias: Math.max(...e.dias),
    diasEspera: e.soma
  }));
  if (!linhas.length) return null;
  // Empate em dias-espera desempata pelo que está parado há mais tempo.
  linhas.sort((a, b) => b.diasEspera - a.diasEspera || b.maiorDias - a.maiorDias);
  return linhas[0];
}

// A mesma conta, para todas as etapas, alimentando o painel.
function gargaloPorEtapa(processos, mapaEtapas) {
  const porEtapa = {};
  for (const c of processos) {
    const id = c.stage_id;
    if (!id) continue;
    const e = porEtapa[id] || (porEtapa[id] = { dias: [], soma: 0 });
    const d = stageDays(c);
    e.dias.push(d);
    e.soma += d;
  }
  return Object.entries(porEtapa)
    .map(([id, e]) => ({
      id,
      nome: (mapaEtapas[id] && mapaEtapas[id].name) || '—',
      cor: (mapaEtapas[id] && mapaEtapas[id].color) || '#0E8C7F',
      processos: e.dias.length,
      mediaDias: Math.round(e.soma / e.dias.length),
      maiorDias: Math.max(...e.dias),
      diasEspera: e.soma
    }))
    .sort((a, b) => b.diasEspera - a.diasEspera);
}

function renderGargalo(processos, mapaEtapas) {
  const el = document.getElementById('gargalo-list');
  if (!el) return;
  const linhas = gargaloPorEtapa(processos, mapaEtapas);
  if (!linhas.length) {
    el.innerHTML = '<span style="color:var(--t3);font-size:.77rem">Sem processos em andamento.</span>';
    return;
  }
  const maior = linhas[0].diasEspera || 1;
  el.innerHTML = linhas
    .map(
      (l, i) => `
    <div class="dist-row">
      <div class="dist-num">${i + 1}</div>
      <div class="dist-name" title="${esc(l.nome)}">${esc(l.nome)}
        <span style="color:var(--t3);font-weight:400">${l.processos} proc. · média ${l.mediaDias}d · pior ${l.maiorDias}d</span>
      </div>
      <div class="dist-bar-wrap"><div class="dist-bar" style="width:${Math.round((l.diasEspera / maior) * 100)}%;background:${esc(l.cor)}"></div></div>
      <div class="dist-val">${l.diasEspera}</div>
    </div>`
    )
    .join('');
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────
function renderPipeline() {
  renderRegionalTabs();
  renderKanban();
}

function renderRegionalTabs() {
  const tabs = [{ key: '__all__', label: 'Todos' }, ...G.groups.map(g => ({ key: g, label: g }))];
  document.getElementById('regional-tabs').innerHTML = tabs
    .map(
      t =>
        `<div class="reg-tab ${G.currentGroup === t.key ? 'active' : ''}" onclick="selectGroup('${escJs(t.key)}')">${esc(t.label)}</div>`
    )
    .join('');
}

function selectGroup(k) {
  G.currentGroup = k;
  renderRegionalTabs();
  renderKanban();
}

function filteredCases() {
  const {
    search,
    empr,
    parceiro,
    re,
    analista,
    corretor,
    convenio,
    agencia,
    coordenador,
    modalidade,
    entrevista,
    usuario
  } = G.filters;
  const sm = stageMap(),
    isPartner = G.user.role === 'partner' && !(G.user.permissions && G.user.permissions.gerente);
  return G.cases.filter(c => {
    if (isPartner) {
      // filtra pelos processos da empresa da CCA
      if (G.user.empresa_name && c.partner_name !== G.user.empresa_name) return false;
      // filtra por analista permitido
      if (!hasPerm('ver_todos_analistas')) {
        const allowed = G.user.permissions?.analistas_permitidos || [];
        if (!allowed.length || !allowed.includes(c.manager_name)) return false;
      }
      // Sem visão completa, só as próprias operações.
      if (!temVisaoCompleta() && !isMeuProcesso(c)) return false;
      // Corretor restrito a etapas: só enxerga onde tem ao menos "ver".
      if (!nivelNaEtapa(c.stage_id)) return false;
    }
    const stage = sm[c.stage_id];
    const _reg = (c.payload && c.payload.regional) || stage?.group_key || '';
    if (G.currentGroup !== '__all__' && _reg !== G.currentGroup) return false;
    // Sem acento, CPF com ou sem pontuação, palavras em qualquer ordem: A1.casaBusca.
    if (search && !A1.casaBusca([c.client_name, c.client_cpf, c.development, c.partner_name], search))
      return false;
    if (empr && c.development !== empr) return false;
    if (parceiro && c.partner_name !== parceiro) return false;
    if (re && c.real_estate_name !== re) return false;
    if (analista && c.manager_name !== analista) return false;
    if (corretor && c.broker_name !== corretor) return false;
    if (convenio && (c.payload && c.payload.convenio) !== convenio) return false;
    if (agencia && (c.payload && c.payload.agencia) !== agencia) return false;
    if (coordenador && !_souDaEquipe(c, coordenador)) return false;
    if (modalidade && (c.payload && c.payload.modalidade) !== modalidade) return false;
    if (usuario && (c.payload?.usuario_correspondente || '') !== usuario) return false;
    if (entrevista && c.payload?.entrevista_status !== entrevista) return false;
    return true;
  });
}

function renderKanban() {
  const board = document.getElementById('kanban-board');
  const filtered = filteredCases();
  // Regional agora é atributo do processo: todas as etapas aparecem; só os cartões são filtrados por regional.
  const vis = G.stages;

  if (!vis.length) {
    board.innerHTML = `<div style="color:var(--t3);font-size:.8rem;padding:1rem">Nenhuma etapa configurada. <a href="/${G.slug}/workflow?module=repasse" style="color:var(--violet)">Editar workflow</a></div>`;
    return;
  }
  const byStage = {};
  for (const s of vis) byStage[s.id] = [];
  for (const c of filtered) if (byStage[c.stage_id] !== undefined) byStage[c.stage_id].push(c);

  // Guarda a lista completa por etapa e desenha só o primeiro lote. O resto
  // entra conforme a pessoa rola aquela coluna — antes, uma etapa com centenas
  // de processos criava todos os cartões de uma vez e travava a página.
  G._kanban = byStage;
  board.innerHTML = vis
    .map(s => {
      const lista = byStage[s.id] || [];
      const primeiros = lista.slice(0, K_LOTE);
      return `
    <div class="k-col">
      <div class="k-col-header" style="background:${s.color}">
        <span>${esc(s.name)}</span>
        <span class="k-col-count">${lista.length}</span>
      </div>
      <div class="k-col-fin">
        <span>VGV <b style="color:var(--blue)">${fmtBRLShort(lista.reduce((a, c) => a + caseUnitValue(c), 0))}</b></span>
        <span>Repasse <b style="color:var(--green)">${fmtBRLShort(lista.reduce((a, c) => a + caseRepasseValue(c), 0))}</b></span>
      </div>
      <div class="k-col-body" data-stage-id="${s.id}" data-render="${primeiros.length}"
           onscroll="onColScroll(this)"
           ondragover="onDragOver(event)" ondrop="onDrop(event,this)" ondragleave="this.classList.remove('drag-over')">
        ${primeiros.map(c => renderCard(c, s)).join('')}
        ${lista.length > primeiros.length ? `<div class="k-col-more">role para ver mais ${lista.length - primeiros.length}</div>` : ''}
      </div>
    </div>`;
    })
    .join('');

  const fc = filtered.length;
  document.getElementById('filter-count').textContent =
    fc !== G.cases.length ? `${fc} de ${G.cases.length} registros` : '';
}

function stageDays(c) {
  const dt = c.stage_entered_at || c.created_at;
  if (!dt) return 0;
  const a = new Date(dt),
    b = new Date();
  const d1 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const d2 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

function renderCard(c, stage) {
  // Etapa final não alarma. O cartão marcava vermelho aos 14 dias em QUALQUER
  // etapa, inclusive nas de fim: um processo concluído há um mês aparecia com a
  // mesma tarja de quem está travado. Concluído não é atrasado — e é isso que o
  // is_final da etapa existe para dizer.
  const days = stageDays(c),
    dc = caseIsFinal(c) ? '' : days > 14 ? 'alert' : days > 7 ? 'warn' : '';
  const ent = c.payload?.entrevista_status || 'pendente';
  const since = c.stage_entered_at || c.created_at;
  return `<div class="k-card" style="border-left-color:${stage.color}"
    draggable="true" data-id="${c.id}"
    ondragstart="onDragStart(event,this)" ondragend="this.classList.remove('dragging')"
    onclick="openCard('${c.id}')">
    <div class="kc-top">
      <div class="kc-name">${esc(c.client_name)}</div>
      <div class="kc-badges">
        ${c.observations ? `<span class="kc-obs" onclick="event.stopPropagation()" title="Observação"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="obs-tooltip"><b>OBSERVAÇÃO</b>${esc(c.observations)}</span></span>` : ''}
        ${c.is_new ? '<span class="badge-novo">NOVO</span>' : ''}
        <span class="badge-days ${dc}" title="Desde ${fmtDT(since)}">${days}d na etapa</span>
      </div>
    </div>
    ${c.client_cpf ? `<div class="kc-cpf" onclick="copyCpf(event,'${escJs(c.client_cpf)}')">${fmtCpf(c.client_cpf)}</div>` : ''}
    <div class="kc-prop">
      ${c.development ? `<span class="empr">${esc(c.development)}</span>` : ''}
      ${c.block || c.unit ? ` <span style="color:var(--t3);font-size:.68rem">· ${c.block ? 'Bl ' + esc(c.block) : ''}${c.block && c.unit ? ' ' : ''}${c.unit ? 'Un ' + esc(c.unit) : ''}</span>` : ''}
    </div>
    <div class="kc-chips">
      ${c.partner_name ? `<span class="chip chip-partner">${esc(c.partner_name)}</span>` : ''}
      ${c.manager_name ? `<span class="chip chip-manager">${esc(c.manager_name)}</span>` : ''}
      ${c.real_estate_name ? `<span class="chip chip-re">${esc(c.real_estate_name)}</span>` : ''}
      ${c.contract_value ? `<span class="chip chip-value">${fmtBRL(c.contract_value)}</span>` : ''}
    </div>
    <div class="kc-situacao">
      <span class="kc-sit-dot" style="background:${stage.color}"></span>
      <div style="flex:1;min-width:0"><div class="kc-sit-name">${esc(stage.name)}</div><div class="kc-sit-since">desde ${fmtDT(since)}</div></div>
    </div>
    <div class="kc-entrevista" onclick="event.stopPropagation()">
      <div style="font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--t3);width:100%;margin-bottom:.15rem">Status da entrevista</div>
      ${['pendente', 'agendado', 'aprovado', 'reprovado']
        .map(
          st => `
        <button class="ent-btn ent-${st}${ent === st ? ' active' : ''}"
          onclick="${st === 'agendado' ? `openAgendamento('${c.id}',event)` : `setEnt('${c.id}','${st}',event)`}">
          ${st[0].toUpperCase() + st.slice(1)}
        </button>`
        )
        .join('')}
    </div>
    <div class="kc-footer">
      <span class="kc-date">${fmtDate(c.created_at)}</span>
      <div class="kc-actions">
        <button class="kc-action-btn" title="Mover etapa" onclick="openFluxo(event,'${c.id}','${stage.id}')">Mover</button>
        <button class="kc-action-btn" title="Gerenciar" onclick="openCard('${c.id}')">Gerenciar</button>
      </div>
    </div>
  </div>`;
}

// Quantos cartões por vez em cada coluna.
const K_LOTE = 15;

// Chega perto do fim da coluna? Desenha o próximo lote daquela etapa.
function onColScroll(el) {
  const sid = el.dataset.stageId;
  const lista = (G._kanban && G._kanban[sid]) || [];
  const jaFeitos = parseInt(el.dataset.render || '0', 10);
  if (jaFeitos >= lista.length) return;
  if (el.scrollTop + el.clientHeight < el.scrollHeight - 120) return;

  const stage = G.stages.find(s => s.id === sid);
  if (!stage) return;
  const proximos = lista.slice(jaFeitos, jaFeitos + K_LOTE);
  const aviso = el.querySelector('.k-col-more');
  if (aviso) aviso.remove();
  el.insertAdjacentHTML('beforeend', proximos.map(c => renderCard(c, stage)).join(''));
  const total = jaFeitos + proximos.length;
  el.dataset.render = String(total);
  if (total < lista.length) {
    el.insertAdjacentHTML(
      'beforeend',
      `<div class="k-col-more">role para ver mais ${lista.length - total}</div>`
    );
  }
}

// ─── Drag & Drop ──────────────────────────────────────────────────────────────
function onDragStart(e, el) {
  el.classList.add('dragging');
  G.dragCard = el.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
}
function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}
function onDrop(e, col) {
  e.preventDefault();
  col.classList.remove('drag-over');
  if (G.dragCard) {
    moveCard(G.dragCard, col.dataset.stageId);
    G.dragCard = null;
  }
}

// Bloqueio do workflow: com a trava ligada, o processo só anda para uma etapa
// ligada por uma seta saindo da etapa atual. Se o workflow tiver 1>2>3, não dá
// para pular do 1 ao 3; mas se existir a ligação 1>3 desenhada, pode.
function wfLocked() {
  return G.wfLock === true;
}
function podeMover(fromId, toId) {
  if (!wfLocked()) return true;
  if (!fromId || fromId === toId) return true;
  return (G.edges[fromId] || []).includes(toId);
}
function avisoBloqueio(fromId) {
  const nomes = (G.edges[fromId] || [])
    .map(id => (G.stages.find(s => s.id === id) || {}).name)
    .filter(Boolean);
  toast(
    nomes.length
      ? 'Workflow bloqueado. Desta etapa só é possível ir para: ' + nomes.join(', ') + '.'
      : 'Workflow bloqueado e esta etapa não tem saída desenhada. Ajuste o workflow.',
    'error'
  );
}

// ─── Documento obrigatório ────────────────────────────────────────────────────
//
// O gestor marca o tipo em Configurações › Tipos de documento; a partir daí o
// processo não avança sem ele. Quem TRANCA é o banco
// (trg_a1_cases_guarda_documento); daqui sai o aviso que diz O QUE falta, que é
// o que o gestor precisa para resolver.
//
// Só avança-a-frente é conferido — a mesma regra do gatilho. Voltar de etapa
// continua livre: corrigir engano não pode depender de anexar documento que
// ainda não existe.
function avancaNoWorkflow(deId, paraId) {
  const a = G.stages.find(s => s.id === deId),
    b = G.stages.find(s => s.id === paraId);
  if (!a || !b || a.position == null || b.position == null) return false;
  return b.position > a.position;
}

// Os documentos NÃO vêm na listagem (a coluna é pesada e ficou fora do select
// de propósito). Busca só quando existe tipo obrigatório — cliente que não usa
// o recurso não paga nenhuma requisição a mais.
async function docsObrigatoriosFaltando(caseId, deId, paraId) {
  if (!avancaNoWorkflow(deId, paraId)) return [];
  await fetchDocTypes();
  if (!a1DocsObrigatorios(G.docTypes, 'repasse').length) return [];
  let docs = null;
  const _c = G.cases.find(c => c.id === caseId);
  if (_c && Array.isArray(_c.documents)) docs = _c.documents;
  if (docs === null) {
    docs = await fetch(`${A1.rest('a1_cases')}?id=eq.${caseId}&select=documents`, { headers: A1.headers() })
      .then(r => r.json())
      .then(a => (a && a[0] ? a[0].documents : null))
      .catch(() => null);
    // Não deu para perguntar: não inventa falta. O gatilho do banco continua
    // sendo a trava de verdade, e a mensagem dele chega traduzida logo abaixo.
    if (!Array.isArray(docs)) return [];
  }
  return a1DocsFaltando(
    G.docTypes,
    'repasse',
    docs.map(d => d && d.type)
  );
}

async function moveCard(caseId, stageId) {
  const stage = G.stages.find(s => s.id === stageId);
  if (!stage) return;
  const _caso = G.cases.find(c => c.id === caseId) || {};
  const _atual = _caso.stage_id;
  if (!podeMover(_atual, stageId)) {
    avisoBloqueio(_atual);
    return;
  }
  if (!podeEditarProcesso(_caso)) {
    toast('Este processo não é seu. Abra o cartão e libere a edição para movê-lo.', 'error');
    return;
  }
  // Vale para todo cadastro feito com o modelo de permissão por etapa
  // (corretor e analista). Quem foi cadastrado antes não tem a chave e segue
  // como antes, sem essa exigência.
  if (usaPermissaoPorEtapa() && !hasPerm('alterar_etapa')) {
    toast('Você não tem permissão para alterar a etapa.', 'error');
    return;
  }
  if (nivelNaEtapa(_atual) !== 'editar') {
    toast('Nesta etapa você só pode visualizar. Peça ao gestor a permissão de editar aqui.', 'error');
    return;
  }
  const _falta = await docsObrigatoriosFaltando(caseId, _atual, stageId);
  if (_falta.length) {
    toast(a1DocsAvisoFaltando(_falta), 'error');
    return;
  }
  const _res = await fetch(`${A1.rest('a1_cases')}?id=eq.${caseId}`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify({
      stage_id: stageId,
      stage_name: stage.name,
      stage_entered_at: new Date().toISOString()
    })
  });
  // Antes daqui a tela movia o cartão sem olhar a resposta: o banco podia
  // recusar e o gestor via o processo na etapa nova até recarregar a página.
  if (!_res.ok) {
    toast(await motivoDoErro(_res), 'error');
    return;
  }
  await Promise.all([
    fetch(A1.rest('a1_events'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({
        case_id: caseId,
        type: 'stage_change',
        description: `Movido para: ${stage.name}`,
        actor_name: G.user.name
      })
    }),
    fetch(A1.rest('a1_stage_history'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({
        case_id: caseId,
        stage_id: stageId,
        stage_name: stage.name,
        entered_at: new Date().toISOString()
      })
    })
  ]);
  const idx = G.cases.findIndex(c => c.id === caseId);
  if (idx > -1) {
    G.cases[idx].stage_id = stageId;
    G.cases[idx].stage_name = stage.name;
    G.cases[idx].stage_entered_at = new Date().toISOString();
  }
  renderKanban();
  renderDashboard();
  toast(`Movido para "${stage.name}"`, 'success');
}

// ─── Fluxo popup ──────────────────────────────────────────────────────────────
function openFluxo(e, caseId, stageId) {
  e.stopPropagation();
  const targets = (G.edges[stageId] || []).map(id => G.stages.find(s => s.id === id)).filter(Boolean);
  // Com a trava ligada só aparecem as etapas ligadas — nada de listar todas.
  const list = wfLocked() ? targets : targets.length ? targets : G.stages.filter(s => s.id !== stageId);
  if (!list.length) {
    toast(
      wfLocked()
        ? 'Workflow bloqueado e esta etapa não tem saída desenhada. Ajuste o workflow.'
        : 'Sem proximas etapas.',
      'info'
    );
    return;
  }
  const popup = document.getElementById('fluxo-popup');
  popup.innerHTML =
    '<div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:.45rem">Mover para:</div>' +
    list
      .map(
        s =>
          `<div class="fluxo-stage-opt" onclick="moveCard('${caseId}','${s.id}');closeFluxo()"><div class="fluxo-dot" style="background:${s.color}"></div>${esc(s.name)}</div>`
      )
      .join('');
  popup.classList.remove('hidden');
  const r = e.target.getBoundingClientRect();
  popup.style.top = r.bottom + window.scrollY + 4 + 'px';
  popup.style.left = r.left + window.scrollX + 'px';
  setTimeout(() => document.addEventListener('click', closeFluxo, { once: true }), 10);
}
// De onde vêm os documentos antigos em base64. Aceita os dois formatos para o
// sistema funcionar antes e depois do SQL de desempenho.
function docsAntigos(c) {
  if (c && Array.isArray(c.legacy_docs)) return c.legacy_docs;
  if (c && c.payload && Array.isArray(c.payload.documents)) return c.payload.documents;
  return [];
}

// Traz do banco o que a listagem deixou de carregar por peso: anexo antigo em
// base64 e o payload completo. Guarda no processo em memória, então abrir o
// mesmo cartão de novo não repete a busca.
async function completarProcesso(id) {
  const c = G.cases.find(x => x.id === id);
  if (!c) return null;
  if (c.__completo) {
    G.editingCaseData = { ...c, payload: { ...(c.payload || {}) } };
    return c;
  }
  const linha = await fetch(`${A1.rest('a1_cases')}?id=eq.${id}&select=payload,documents`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .then(a => (a && a[0]) || null)
    .catch(() => null);
  if (!linha) return null;
  if (linha.payload && typeof linha.payload === 'object') c.payload = linha.payload;
  c.documents = Array.isArray(linha.documents) ? linha.documents : [];
  c.__completo = true;
  if (G.editingCaseId === id) G.editingCaseData = { ...c, payload: { ...(c.payload || {}) } };
  return c;
}

// Os arquivos em base64 (anexo antigo e documentos legados) só interessam a
// quem abre a aba de documentos. Buscar isso ao abrir o cartão deixaria cada
// clique esperando por centenas de KB sem motivo.
async function completarArquivos(id) {
  const c = G.cases.find(x => x.id === id);
  if (!c || c.__arquivos) return c;
  const linha = await fetch(
    `${A1.rest('a1_cases')}?id=eq.${id}&select=attachment_pdf,attachment_name,attachment_doc2,attachment_doc2_name,legacy_docs`,
    { headers: A1.headers() }
  )
    .then(r => r.json())
    .then(a => (a && a[0]) || null)
    .catch(() => null);
  if (!linha) return null;
  c.attachment_pdf = linha.attachment_pdf;
  c.attachment_name = linha.attachment_name;
  c.attachment_doc2 = linha.attachment_doc2;
  c.attachment_doc2_name = linha.attachment_doc2_name;
  if ('legacy_docs' in linha) c.legacy_docs = Array.isArray(linha.legacy_docs) ? linha.legacy_docs : [];
  c.__arquivos = true;
  if (G.editingCaseId === id) {
    Object.assign(G.editingCaseData, {
      attachment_pdf: c.attachment_pdf,
      attachment_name: c.attachment_name,
      attachment_doc2: c.attachment_doc2,
      attachment_doc2_name: c.attachment_doc2_name,
      legacy_docs: c.legacy_docs
    });
  }
  return c;
}

// Gravação de payload feita FORA do modal (agendar entrevista, mudar status).
// Lê o payload de verdade no banco na hora, junta a mudança e grava. Assim não
// depende do que a listagem trouxe e não atropela alteração feita por outra
// pessoa nos campos que não estão sendo mexidos.
// Grava o valor NO PROCESSO DA LISTA e na cópia que o cartão está usando.
//
// O cartão trabalha com uma cópia rasa do processo (G.editingCaseData). Escrever
// só na cópia funciona enquanto o cartão está aberto e desaparece no
// fechar-e-reabrir, porque o cartão é remontado a partir da lista — e a lista
// ainda tem o objeto velho, marcado como "já carregado". Foi exatamente assim
// que documento anexado sumia da tela: estava gravado no banco, o sistema dizia
// "salvo", e ao voltar no cliente a tela relia o objeto antigo.
//
// Toda escrita feita de dentro do cartão passa por aqui.
function anotarNoProcesso(id, campos) {
  const c = G.cases.find(x => x.id === id);
  if (c) Object.assign(c, campos);
  if (G.editingCaseData && G.editingCaseData.id === id) Object.assign(G.editingCaseData, campos);
}

async function gravarPayload(caseId, mudancas) {
  const atual = await fetch(`${A1.rest('a1_cases')}?id=eq.${caseId}&select=payload`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .then(a => (a && a[0] && a[0].payload) || {})
    .catch(() => null);
  if (atual === null) {
    toast('Não foi possível salvar agora. Tente de novo.', 'error');
    return null;
  }
  const payload = { ...atual, ...mudancas };
  const res = await fetch(`${A1.rest('a1_cases')}?id=eq.${caseId}`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify({ payload })
  });
  if (!res.ok) {
    toast('Não foi possível salvar agora. Tente de novo.', 'error');
    return null;
  }
  const idx = G.cases.findIndex(x => x.id === caseId);
  if (idx > -1) G.cases[idx].payload = payload;
  return payload;
}

function closeFluxo() {
  document.getElementById('fluxo-popup').classList.add('hidden');
}

// ─── Card modal ───────────────────────────────────────────────────────────────
async function openCard(id) {
  const c = G.cases.find(x => x.id === id);
  if (!c) return;
  G.editingCaseId = id;
  G.editingCaseData = { ...c, payload: { ...(c.payload || {}) } };
  // Um cartão arquivado abre com o botão de VOLTAR, não com o de guardar de novo.
  const bArq = document.getElementById('mc-arquivar');
  const bDes = document.getElementById('mc-desarquivar');
  if (bArq) bArq.style.display = c.archived ? 'none' : '';
  if (bDes) bDes.style.display = c.archived ? '' : 'none';
  // A lista não carrega mais os anexos antigos (base64 dentro da tabela) nem o
  // payload completo — eram megabytes em toda abertura de página. Aqui, ao abrir
  // UM processo, busca o que falta. Também é o que protege a gravação: sem o
  // payload inteiro em mãos, salvar apagaria as chaves que não vieram.
  await completarProcesso(id);
  if (c.is_new) {
    fetch(`${A1.rest('a1_cases')}?id=eq.${id}`, {
      method: 'PATCH',
      headers: A1.headers(),
      body: JSON.stringify({ is_new: false })
    });
    c.is_new = false;
  }
  const _lock = document.getElementById('mc-lock');
  if (_lock) {
    if (await podeEditarConferindo(c)) {
      _lock.style.display = 'none';
      _lock.innerHTML = '';
    } else {
      // A tarja diz o MOTIVO. "Processo de outro usuário" mandava o gestor
      // procurar dono onde não havia, quando o problema era a permissão.
      const dono = [c.broker_name, c.manager_name, c.payload && c.payload.usuario_correspondente].find(
        Boolean
      );
      const motivo = !hasPerm('editar_repasses')
        ? 'Seu acesso não inclui <b>Editar operações</b>.'
        : dono
          ? `Processo de <b>${esc(dono)}</b>.`
          : 'Processo <b>sem responsável definido</b>.';
      _lock.style.display = '';
      _lock.innerHTML =
        `${motivo} Você está apenas visualizando. ` +
        `<span style="opacity:.75">Seu acesso: <b>${esc(papelLegivel())}</b>.</span> ` +
        `<button class="btn btn-ghost btn-sm" style="margin-left:.4rem" onclick="liberarEdicao('${c.id}')">Liberar edição</button>`;
    }
  }
  document.getElementById('mc-title').textContent = c.client_name;
  document.getElementById('mc-sub').textContent = [
    c.development,
    c.block && `Bl ${c.block}`,
    c.unit && `Un ${c.unit}`
  ]
    .filter(Boolean)
    .join(' · ');
  document.getElementById('mc-stage-sel').innerHTML = G.stages
    .map(s => `<option value="${s.id}" ${s.id === c.stage_id ? 'selected' : ''}>${esc(s.name)}</option>`)
    .join('');
  document.querySelectorAll('#modal-card-bg .modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('#modal-card-bg .modal-tab[data-mtab="det"]').classList.add('active');
  if (!G.empresasLoaded) {
    try {
      await loadEmpresas();
    } catch {}
  }
  if (!G.imobsLoaded) {
    try {
      await loadImobs();
    } catch {}
  }
  if (!G.partnersLoaded) {
    try {
      await loadPartners();
    } catch {}
  }
  if (!G.analistasLoaded) {
    try {
      await loadAnalistas();
    } catch {}
  }
  renderModalDet();
  document.getElementById('modal-card-bg').classList.remove('hidden');
}

function switchModalTab(tab, el) {
  document.querySelectorAll('#modal-card-bg .modal-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  if (tab === 'det') renderModalDet();
  else if (tab === 'hist') renderModalHist();
  else if (tab === 'evts') renderModalEvts();
  else if (tab === 'valores') renderModalValores();
  else if (tab === 'docs') renderModalDocs();
}

// ─── Coordenador e corretor andam juntos nos formulários ─────────────────────
// O vínculo mora no cadastro do corretor (extra.coordenador_id) — continua
// sendo a única verdade. Aqui os dois campos só se ajudam: escolher o corretor
// mostra o coordenador dele; escolher o coordenador encurta a lista de
// corretores para a equipe dele. Nada de coordenador é gravado no processo,
// senão trocar o corretor de equipe deixaria os processos antigos mentindo.

// A imobiliária do corretor mora em extra.imobiliaria_id — o mesmo lugar em que
// o pré-cadastro por link sempre a gravou, e que o cadastro de corretor em
// Configurações agora deixa editar.
function _imobIdPorNome(nome) {
  if (!nome) return '';
  const i = (Array.isArray(G.imobs) ? G.imobs : []).find(x => x.name === nome);
  return i ? i.id : '';
}

// Corretor SEM imobiliária no cadastro aparece em qualquer imobiliária, de
// propósito: hoje quase nenhum tem o vínculo preenchido, e um filtro estrito
// esvaziaria o seletor no primeiro dia — o gestor concluiria que o sistema
// quebrou. Quem TEM vínculo só aparece na imobiliária dele, que é o que o
// filtro veio fazer. À medida que os cadastros forem preenchidos, o filtro
// aperta sozinho.
function _corretoresDaImobiliaria(nomeImob) {
  const id = _imobIdPorNome(nomeImob);
  if (!id) return null;
  return new Set(
    (Array.isArray(G.corretores) ? G.corretores : [])
      .filter(c => {
        const v = c.extra && c.extra.imobiliaria_id;
        return !v || v === id;
      })
      .map(c => c.name)
  );
}

function _imobiliariaDoCorretor(nomeCorretor) {
  if (!nomeCorretor) return '';
  const co = (Array.isArray(G.corretores) ? G.corretores : []).find(x => x.name === nomeCorretor);
  const id = co && co.extra && co.extra.imobiliaria_id;
  if (!id) return '';
  const i = (Array.isArray(G.imobs) ? G.imobs : []).find(x => x.id === id);
  return i ? i.name : '';
}

function _corretoresParaFormulario(nomeCoord, nomeImob) {
  let todos = _corretorNames();
  if (nomeImob) {
    const daImob = _corretoresDaImobiliaria(nomeImob);
    if (daImob) todos = todos.filter(n => daImob.has(n));
  }
  if (!nomeCoord) return todos;
  const equipe = _corretoresDoCoordenador(nomeCoord);
  return equipe ? todos.filter(n => equipe.has(n)) : todos;
}

// Trocar a imobiliária refaz a lista de corretores. O que já estava escolhido
// só é mantido se continuar valendo para a nova imobiliária — senão o formulário
// gravaria um corretor de outra imobiliária sem ninguém perceber.
function aoTrocarImobiliaria(pre) {
  const bro = document.getElementById(pre + '-broker');
  const imb = document.getElementById(pre + '-re');
  if (!bro || !imb) return;
  const coo = document.getElementById(pre + '-coordenador');
  const atual = bro.value;
  const lista = _corretoresParaFormulario(coo ? coo.value : '', imb.value);
  bro.innerHTML = selOpts(lista, lista.includes(atual) ? atual : '');
  avisoCoordenador(pre);
}

function aoTrocarCorretor(pre) {
  const bro = document.getElementById(pre + '-broker');
  const coo = document.getElementById(pre + '-coordenador');
  if (!bro || !coo) return;
  const k = _coordenadorDoCorretor(bro.value);
  if (k) {
    // O coordenador pode não estar na lista se ficou inativo; acrescenta para
    // não sumir da tela o vínculo que existe de verdade.
    if (![...coo.options].some(o => o.value === k)) coo.add(new Option(k, k));
    coo.value = k;
  } else if (bro.value && coo.value && !_corretoresParaFormulario(coo.value).includes(bro.value)) {
    coo.value = '';
  }
  // O corretor também sabe de que imobiliária é. Preencher sozinho evita o par
  // errado — corretor de uma imobiliária gravado com o nome de outra.
  const imb = document.getElementById(pre + '-re');
  const nomeImob = _imobiliariaDoCorretor(bro.value);
  if (imb && nomeImob) {
    if (![...imb.options].some(o => o.value === nomeImob)) imb.add(new Option(nomeImob, nomeImob));
    imb.value = nomeImob;
  }
  avisoCoordenador(pre);
}

function aoTrocarCoordenador(pre) {
  const bro = document.getElementById(pre + '-broker');
  const coo = document.getElementById(pre + '-coordenador');
  if (!bro || !coo) return;
  const atual = bro.value;
  const imb = document.getElementById(pre + '-re');
  const lista = _corretoresParaFormulario(coo.value, imb ? imb.value : '');
  bro.innerHTML = selOpts(lista, lista.includes(atual) ? atual : '');
  avisoCoordenador(pre);
}

// Corretor sem coordenador no cadastro é situação real (veio de importação, ou
// ninguém definiu ainda). Melhor dizer do que deixar o campo vazio sem motivo.
function avisoCoordenador(pre) {
  const el = document.getElementById(pre + '-coord-obs');
  if (!el) return;
  const bro = document.getElementById(pre + '-broker');
  const coo = document.getElementById(pre + '-coordenador');
  const semVinculo = bro && bro.value && !_coordenadorDoCorretor(bro.value);
  el.textContent = semVinculo
    ? 'Este corretor ainda não tem coordenador no cadastro. Defina em Configurações → Corretores.'
    : coo && coo.value
      ? ''
      : '';
  el.style.display = semVinculo ? '' : 'none';
}

function selOpts(items, cur) {
  cur = cur || '';
  items = Array.isArray(items) ? items : [];
  const has = items.some(x => x === cur);
  let html = '<option value="">— Selecione —</option>';
  if (cur && !has) html += `<option value="${esc(cur)}" selected>${esc(cur)} (não cadastrado)</option>`;
  html += items
    .map(x => `<option value="${esc(x)}"${x === cur ? ' selected' : ''}>${esc(x)}</option>`)
    .join('');
  return html;
}
function _empresaNames() {
  return (Array.isArray(G.empresas) ? G.empresas : []).filter(e => e.is_active !== false).map(e => e.name);
}
function _imobNames() {
  return (Array.isArray(G.imobs) ? G.imobs : []).map(i => i.name);
}
function _ccaNames() {
  return (Array.isArray(G.partners) ? G.partners : []).map(p => p.name);
}
function _analistaNames() {
  return (Array.isArray(G.analistas) ? G.analistas : []).filter(a => a.is_active !== false).map(a => a.name);
}
// Corretores cadastrados em Configurações > Corretores. selOpts preserva o nome
// que já estiver gravado no processo mesmo que não esteja na lista (marcando
// "não cadastrado"), para não apagar o corretor de processos antigos nem o nome
// que veio da importação de PDF.
function _corretorNames() {
  return (Array.isArray(G.corretores) ? G.corretores : [])
    .filter(c => c.is_active !== false)
    .map(c => c.name);
}
function _convenioNames() {
  return (Array.isArray(G.convenios) ? G.convenios : []).filter(c => c.is_active !== false).map(c => c.name);
}
// A agência aparece como "número - nome", que é como ela foi cadastrada em
// Configurações. O número sozinho não diz nada; o nome sozinho repete.
// Nome do coordenador a que o corretor do processo responde. Vem do cadastro do
// corretor, não do processo — então acompanha a mudança de equipe sozinho.
function _coordenadorDoCorretor(nomeCorretor) {
  if (!nomeCorretor) return '';
  const co = (Array.isArray(G.corretores) ? G.corretores : []).find(x => x.name === nomeCorretor);
  const id = co && co.extra && co.extra.coordenador_id;
  if (!id) return '';
  const k = (Array.isArray(G.coordenadores) ? G.coordenadores : []).find(x => x.id === id);
  return k ? k.name : '';
}

// A REGRA DOS FILTROS, valendo para todos: a lista é o cadastro somado ao que
// já está em uso nos processos. Só o cadastro esconderia dado antigo cujo
// cadastro foi apagado; só os processos esconderia cadastro novo que ainda não
// foi usado — foi exatamente o que aconteceu com a imobiliária recém-criada.
function _opcoesFiltro(doCadastro, dosProcessos) {
  return [...new Set([...(doCadastro || []), ...(dosProcessos || [])].filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), 'pt-BR')
  );
}
const _ativos = lista =>
  (Array.isArray(lista) ? lista : []).filter(x => x.is_active !== false).map(x => x.name);

function _modalidadeNames() {
  return (Array.isArray(G.modalidades) ? G.modalidades : [])
    .filter(m => m.is_active !== false)
    .map(m => m.name);
}

function _coordenadorNames() {
  return (Array.isArray(G.coordenadores) ? G.coordenadores : [])
    .filter(k => k.is_active !== false)
    .map(k => k.name);
}

// O processo não guarda coordenador: quem tem coordenador é o CORRETOR
// (extra.coordenador_id, definido no cadastro). Filtrar por coordenador é,
// portanto, mostrar o que a equipe dele trouxe. Guardar uma cópia no processo
// deixaria os dois desencontrados no dia em que o corretor mudasse de equipe.
function _corretoresDoCoordenador(nomeCoord) {
  const k = (Array.isArray(G.coordenadores) ? G.coordenadores : []).find(x => x.name === nomeCoord);
  if (!k) return null;
  return new Set(
    (Array.isArray(G.corretores) ? G.corretores : [])
      .filter(c => c.extra && c.extra.coordenador_id === k.id)
      .map(c => c.name)
  );
}

// Cache por nome: a lista de corretores só muda quando a página recarrega, e
// sem isto a conta seria refeita para cada processo, a cada tecla do filtro.
const _EQUIPE = {};
function _souDaEquipe(c, nomeCoord) {
  if (!(nomeCoord in _EQUIPE)) _EQUIPE[nomeCoord] = _corretoresDoCoordenador(nomeCoord);
  const equipe = _EQUIPE[nomeCoord];
  if (!equipe) return false; // coordenador que não existe mais
  return equipe.has(c.broker_name);
}

function _agenciaNames() {
  return (Array.isArray(G.agencias) ? G.agencias : [])
    .filter(a => a.is_active !== false)
    .map(a => {
      const num = (a.extra && a.extra.numero) || '';
      return num ? `${num} - ${a.name}` : a.name;
    });
}

function renderModalDet() {
  const c = G.editingCaseData || {},
    p = c.payload || {};
  document.getElementById('mc-body').innerHTML = `
    <div class="form-section-title">Dados do cliente</div>
    <div class="form-grid">
      <div class="form-group full"><label>Nome</label><input id="e-name" value="${esc(c.client_name || '')}"></div>
      <div class="form-group"><label>CPF</label><input id="e-cpf" value="${esc(c.client_cpf || '')}"></div>
      <div class="form-group"><label>Telefone</label><input id="e-phone" value="${esc(c.client_phone || '')}"></div>
      <div class="form-group"><label>E-mail</label><input id="e-email" value="${esc(c.client_email || '')}"></div>
    </div>
    <div class="form-section-title">Imovel</div>
    <div class="form-grid">
      <div class="form-group full"><label>Empreendimento</label><input id="e-development" value="${esc(c.development || '')}" list="dl-developments"></div>
      <div class="form-group"><label>Bloco</label><input id="e-block" value="${esc(c.block || '')}"></div>
      <div class="form-group"><label>Unidade</label><input id="e-unit" value="${esc(c.unit || '')}"></div>
      <div class="form-group"><label>Valor (R$)</label><input id="e-value" type="text" inputmode="decimal" oninput="maskValor(this)" onblur="blurValor(this)" value="${c.contract_value != null && c.contract_value !== '' ? Number(c.contract_value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}"></div>
      <div class="form-group"><label>Venc. Avaliacao</label><input id="e-eval" type="date" value="${c.evaluation_expiry || ''}"></div>
    </div>
    <div class="form-section-title">Parceiro e equipe</div>
    <div class="form-grid">
      ${G.isCorrTenant ? `<div class="form-group"><label>Correspondente</label><input value="${esc(G.fixedCorr || c.partner_name || '')}" disabled></div>` : `<div class="form-group"><label>Correspondente</label><select id="e-partner">${selOptsId(G.empresas, c.empresa_id || c.partner_name)}</select></div>`}
      <div class="form-group"><label>Imobiliaria</label><select id="e-re" onchange="aoTrocarImobiliaria('e')">${selOpts(_imobNames(), c.real_estate_name)}</select></div>
      <div class="form-group"><label>Usuário Correspondente</label><select id="e-usuario">${selOptsId(G.partners, c.correspondente_id || p.usuario_correspondente || '')}</select></div>
      <div class="form-group"><label>Analista</label><select id="e-manager">${selOptsId(G.analistas, c.analista_id || c.manager_name)}</select></div>
      <div class="form-group"><label>Coordenador</label><select id="e-coordenador" onchange="aoTrocarCoordenador('e')">${selOpts(_coordenadorNames(), _coordenadorDoCorretor(c.broker_name))}</select></div>
      <div class="form-group"><label>Corretor</label>
        <select id="e-broker" onchange="aoTrocarCorretor('e')">${selOpts(_corretoresParaFormulario(_coordenadorDoCorretor(c.broker_name), c.real_estate_name), c.broker_name)}</select>
        <div id="e-coord-obs" style="display:none;font-size:.7rem;color:#9A6008;margin-top:.25rem"></div>
      </div>
      <div class="form-group"><label>Convênio</label><select id="e-convenio">${selOpts(_convenioNames(), p.convenio || '')}</select></div>
      <div class="form-group"><label>Agência</label><select id="e-agencia">${selOpts(_agenciaNames(), p.agencia || '')}</select></div>
      <div class="form-group"><label>Modalidade do imóvel</label><select id="e-modalidade">${selOpts(_modalidadeNames(), p.modalidade || '')}</select></div>
      <div class="form-group"><label>Data da Venda</label><input id="e-data-venda" type="date" value="${esc((p.data_venda || '').slice(0, 10))}"></div>
      <div class="form-group"><label>Estado</label><input id="e-estado" class="campo-auto" readonly tabindex="-1" value="${esc(p.estado || '')}" placeholder="Vem do empreendimento"></div>
      <div class="form-group"><label>Cidade</label><input id="e-cidade" class="campo-auto" readonly tabindex="-1" value="${esc(p.cidade || '')}" placeholder="Vem do empreendimento"></div>
      <div class="form-group"><label>Fone Corretor</label><input id="e-broker-phone" value="${esc(c.broker_phone || '')}"></div>
    </div>
    <div class="form-section-title">Entrevista</div>
    <div class="form-grid">
      <div class="form-group"><label>Status</label>
        <select id="e-ent-status">
          ${['pendente', 'agendado', 'aprovado', 'reprovado'].map(s => `<option value="${s}" ${(p.entrevista_status || 'pendente') === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Data/hora</label><input id="e-ent-date" type="datetime-local" value="${(p.agendamento_data || p.entrevista_data || '').slice(0, 16)}"></div>
    </div>
    <div class="form-section-title">Observacoes</div>
    <div class="form-group full"><textarea id="e-obs" rows="4">${esc(c.observations || '')}</textarea></div>`;
  avisoCoordenador('e');
}

function renderModalHist() {
  const body = document.getElementById('mc-body');
  body.innerHTML = '<div class="spinner" style="margin:1.5rem auto;display:block"></div>';
  const cid = G.editingCaseId;
  Promise.all([
    fetch(`${A1.rest('a1_stage_history')}?case_id=eq.${cid}&order=entered_at.asc`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => []),
    fetch(`${A1.rest('a1_events')}?case_id=eq.${cid}&order=created_at.asc`, { headers: A1.headers() })
      .then(r => r.json())
      .catch(() => [])
  ])
    .then(([stages, evts]) => {
      const items = [];
      const c = G.editingCaseData || {};
      // Cadastro do cliente (data e hora)
      if (c.created_at && !(Array.isArray(evts) && evts.some(ev => ev.type === 'created')))
        items.push({
          ts: c.created_at,
          cls: 'created',
          icon: '+',
          desc: '<b>Cliente cadastrado no sistema</b>',
          meta: c.manager_name ? `por ${esc(c.manager_name)}` : ''
        });
      // Movimentacoes de etapa
      (Array.isArray(stages) ? stages : []).forEach(h =>
        items.push({
          ts: h.entered_at,
          cls: 'stage',
          icon: 'E',
          desc: `Entrou na etapa <b>${esc(h.stage_name || '')}</b>`,
          meta: [h.exited_at ? `saiu em ${fmtDT(h.exited_at)}` : 'etapa atual', a1AtorHistorico(h)]
            .filter(Boolean)
            .join(' · ')
        })
      );
      // Demais eventos (status, comentarios, edicoes, documentos) — stage_change ja coberto acima
      const evCls = {
        comment: 'comment',
        edit: 'edit',
        document: 'edit',
        interview: 'created',
        agendamento: 'created'
      };
      const evIcon = { comment: 'C', edit: 'E', document: 'D', interview: 'S', agendamento: 'A' };
      (Array.isArray(evts) ? evts : []).forEach(ev => {
        if (ev.type === 'stage_change') return;
        items.push({
          ts: ev.created_at,
          cls: evCls[ev.type] || 'comment',
          icon: evIcon[ev.type] || 'C',
          desc: esc(ev.description || ''),
          meta: esc(a1AtorHistorico(ev))
        });
      });
      if (!items.length) {
        body.innerHTML = '<span style="color:var(--t3);font-size:.78rem">Sem historico.</span>';
        return;
      }
      items.sort((a, b) => new Date(b.ts) - new Date(a.ts));
      body.innerHTML =
        '<div class="timeline">' +
        items
          .map(
            it => `
        <div class="tl-item">
          <div class="tl-dot ${it.cls}">${it.icon}</div>
          <div class="tl-content">
            <div class="tl-desc">${it.desc}</div>
            <div class="tl-meta">${fmtDT(it.ts)}${it.meta ? ' &middot; ' + it.meta : ''}</div>
          </div>
        </div>`
          )
          .join('') +
        '</div>';
    })
    .catch(() => {
      body.innerHTML = '<span style="color:var(--red);font-size:.78rem">Erro ao carregar.</span>';
    });
}

function renderModalEvts() {
  const body = document.getElementById('mc-body');
  body.innerHTML = '<div class="spinner" style="margin:1.5rem auto;display:block"></div>';
  const commentBox = `<div style="margin-top:1rem;display:flex;gap:.45rem">
    <input id="new-comment" placeholder="Adicionar comentario..." style="flex:1;padding:.42rem .65rem;border:1px solid var(--border);border-radius:7px;font-size:.78rem">
    <button class="btn btn-primary btn-sm" onclick="addComment()">Enviar</button></div>`;
  const icons = { stage_change: 'M', comment: 'C', edit: 'E', document: 'D' };
  const cls = { stage_change: 'stage', comment: 'comment', edit: 'edit', document: 'edit' };
  fetch(`${A1.rest('a1_events')}?case_id=eq.${G.editingCaseId}&order=created_at.desc`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .then(evts => {
      if (!evts.length) {
        body.innerHTML = '<span style="color:var(--t3);font-size:.78rem">Sem eventos.</span>' + commentBox;
        return;
      }
      body.innerHTML =
        '<div class="timeline">' +
        evts
          .map(
            ev => `
        <div class="tl-item">
          <div class="tl-dot ${cls[ev.type] || 'comment'}">${icons[ev.type] || 'C'}</div>
          <div class="tl-content">
            <div class="tl-desc">${esc(ev.description || '')}</div>
            <div class="tl-meta">${esc(a1AtorHistorico(ev))} &middot; ${fmtDT(ev.created_at)}</div>
          </div>
        </div>`
          )
          .join('') +
        '</div>' +
        commentBox;
    })
    .catch(() => {
      body.innerHTML = '<span style="color:var(--red)">Erro.</span>' + commentBox;
    });
}

// ─── Valores de Repasse ───────────────────────────────────────────────────────
function fmtNum(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderModalValores() {
  const vr = G.editingCaseData?.payload?.valores || {};
  const f = (id, label, val, hint) =>
    `<div class="form-group"><label>${label}</label><input id="${id}" value="${esc(val || '')}" placeholder="0,00" oninput="recalcValores()">${hint ? `<div style="font-size:.62rem;color:var(--t3);margin-top:.15rem">${hint}</div>` : ''}</div>`;
  const ro = (id, label, hint) =>
    `<div class="form-group"><label>${label}</label><input id="${id}" value="" readonly style="background:var(--bg);font-weight:700;color:var(--t2)">${hint ? `<div style="font-size:.62rem;color:var(--t3);margin-top:.15rem">${hint}</div>` : ''}</div>`;
  document.getElementById('mc-body').innerHTML = `
    <div class="form-section-title">Valores de Repasse</div>
    <div class="form-grid">
      ${f('vr-previsto', 'Valor Previsto', vr.valor_previsto, 'valor da venda')}
      ${f('vr-divida', 'Valor da Dívida', vr.valor_divida, 'financiado pelo banco')}
      ${f('vr-subsidio', 'Valor do Subsídio', vr.valor_subsidio, 'custeio do governo')}
      ${f('vr-fgts', 'Valor do FGTS', vr.valor_fgts)}
      ${ro('vr-financiado', 'Valor Financiado', 'dívida + subsídio + FGTS (automático)')}
      ${ro('vr-saldo', 'Saldo Devedor', 'venda − financiado (automático)')}
      ${f('vr-parcela-concl', 'Parcela de Conclusão', vr.parcela_conclusao)}
      <div class="form-group"><label>Parcela Baixada</label><select id="vr-parcela-baixada"><option value="Não" ${vr.parcela_baixada !== 'Sim' ? 'selected' : ''}>Não</option><option value="Sim" ${vr.parcela_baixada === 'Sim' ? 'selected' : ''}>Sim</option></select></div>
      ${f('vr-contrato', 'Valor Contrato', vr.valor_contrato)}
      <div class="form-group"><label>Data de assinatura</label><input id="vr-data-assinatura" type="date" value="${esc(vr.data_assinatura || '')}"></div>
      <div class="form-group"><label>Previsão de repasse</label><input id="vr-data-previsao" type="date" value="${esc(vr.data_previsao_repasse || '')}"></div>
    </div>
    <div style="margin-top:1rem"><button class="btn btn-primary btn-sm" onclick="saveValores()">Salvar valores</button></div>`;
  recalcValores();
}

function recalcValores() {
  const fin = brNum(v('vr-divida')) + brNum(v('vr-subsidio')) + brNum(v('vr-fgts'));
  const saldo = brNum(v('vr-previsto')) - fin;
  const fEl = document.getElementById('vr-financiado');
  if (fEl) fEl.value = fmtNum(fin);
  const sEl = document.getElementById('vr-saldo');
  if (sEl) sEl.value = fmtNum(saldo);
}

async function saveValores() {
  if (!G.editingCaseId) return;
  const fin = brNum(v('vr-divida')) + brNum(v('vr-subsidio')) + brNum(v('vr-fgts'));
  const saldo = brNum(v('vr-previsto')) - fin;
  const valores = {
    valor_previsto: v('vr-previsto'),
    valor_divida: v('vr-divida'),
    valor_subsidio: v('vr-subsidio'),
    valor_fgts: v('vr-fgts'),
    valor_financiado: fmtNum(fin),
    saldo_devedor: fmtNum(saldo),
    parcela_conclusao: v('vr-parcela-concl'),
    parcela_baixada: document.getElementById('vr-parcela-baixada')?.value || 'Não',
    valor_contrato: v('vr-contrato'),
    data_assinatura: document.getElementById('vr-data-assinatura')?.value || '',
    data_previsao_repasse: document.getElementById('vr-data-previsao')?.value || ''
  };
  const payload = { ...(G.editingCaseData.payload || {}), valores };
  const res = await fetch(`${A1.rest('a1_cases')}?id=eq.${G.editingCaseId}`, {
    method: 'PATCH',
    headers: A1.returnHeaders(),
    body: JSON.stringify({ payload })
  });
  if (res.ok) {
    G.editingCaseData.payload = payload;
    const idx = G.cases.findIndex(c => c.id === G.editingCaseId);
    if (idx > -1) G.cases[idx].payload = payload;
    fetch(A1.rest('a1_events'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({
        case_id: G.editingCaseId,
        type: 'edit',
        description: 'Valores de repasse atualizados',
        actor_name: G.user.name
      })
    }).catch(() => {});
    renderKanban();
    renderDashboard();
    toast('Valores salvos', 'success');
  } else toast('Erro ao salvar valores', 'error');
}

// ─── Documentos (organizados por tipo) ────────────────────────────────────────
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
  G.docTypesLoaded = true;
  const _dtReg = document.getElementById('dt-mod-registro');
  if (_dtReg) _dtReg.style.display = G.hasRegistro ? '' : 'none';
  if (!G.docTypeModule || (G.docTypeModule === 'registro' && !G.hasRegistro)) G.docTypeModule = 'repasse';
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
function renderDocTypesList() {
  const tb = document.getElementById('dt-tbody');
  if (!tb) return;
  const list = (G.docTypes || []).filter(t => t.module === (G.docTypeModule || 'repasse'));
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="3" class="pt-empty">Nenhum tipo cadastrado para este módulo.</td></tr>';
    return;
  }
  tb.innerHTML = list
    .map(t => {
      const on = t.active !== false;
      return `<tr>
      <td>${esc(t.name)}</td>
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
    toast('Informe o nome do tipo', 'error');
    return;
  }
  await fetchDocTypes();
  const mod = G.docTypeModule || 'repasse';
  if ((G.docTypes || []).some(t => t.module === mod && (t.name || '').toLowerCase() === name.toLowerCase())) {
    toast('Tipo já cadastrado', 'error');
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
  toast('Tipo cadastrado', 'success');
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
  toast('Tipo removido', 'info');
}

function docRow(d) {
  // d.path = novo (Storage, signed URL sob demanda); d.data = legado (base64 antigo, ainda funciona)
  const openBtn = d.path
    ? `<button class="btn btn-ghost btn-sm" onclick="openDoc('${d.path}')">Abrir</button>`
    : `<a href="${d.data}" download="${esc(d.name || 'documento')}" target="_blank" class="btn btn-ghost btn-sm">Abrir</a>`;
  return `<div class="doc-row">
    <div style="flex:1"><div class="doc-name">${esc(d.name || 'Documento')}</div><div class="doc-type-lbl">${esc(d.type || 'Sem tipo')}${d.uploaded_at ? ' · ' + fmtDT(d.uploaded_at) : ''}</div></div>
    ${openBtn}
    <button class="btn btn-danger btn-sm" onclick="removeDoc('${d.id}')">Remover</button>
  </div>`;
}

async function openDoc(path) {
  const url = await A1.storageSignedUrl('case-documents', path, 60);
  if (!url) {
    toast('Erro ao abrir documento. Tente novamente.', 'error');
    return;
  }
  window.open(url, '_blank');
}

async function renderModalDocs() {
  const body = document.getElementById('mc-body');
  body.innerHTML = '<div class="spinner" style="margin:1.5rem auto;display:block"></div>';
  // Os arquivos em base64 vivem no banco e só esta aba precisa deles. Buscar
  // aqui é o que mantém o clique no cartão instantâneo.
  if (G.editingCaseId) await completarArquivos(G.editingCaseId);
  const c = G.editingCaseData || {};
  await fetchDocTypes();
  // documentos NOVOS ficam em coluna própria (fora do payload) — carrega sob demanda só nesta aba.
  // IMPORTANTE: nunca fazer fallback/merge do payload.documents (base64 antigo) para dentro de
  // c.documents — isso faria attachDoc/removeDoc regravar o arquivo antigo inteiro no banco a
  // cada anexo novo, recriando o mesmo problema de peso que esta migração resolve.
  if (c.documents === undefined && G.editingCaseId) {
    const _d = await fetch(`${A1.rest('a1_cases')}?id=eq.${G.editingCaseId}&select=documents`, {
      headers: A1.headers()
    })
      .then(r => r.json())
      .then(a => (a && a[0] ? a[0].documents : null))
      .catch(() => null);
    c.documents = Array.isArray(_d) ? _d : [];
  }
  const types = (G.docTypes || []).filter(t => t.active !== false && (t.module === 'repasse' || !t.module));
  const docs = Array.isArray(c.documents) ? c.documents : [];
  // Documentos ANTIGOS (base64 dentro do payload) só para exibir/abrir — nunca regravados junto.
  // O SQL de desempenho move estes documentos de payload.documents para a
  // coluna legacy_docs, para não virem junto da listagem. Lê dos dois lugares:
  // antes de rodar o SQL vale o primeiro, depois vale o segundo.
  const legacyDocs = docsAntigos(c);
  const opts = types.length
    ? types.map(t => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')
    : '<option value="">Nenhum tipo cadastrado</option>';
  const legacy = c.attachment_pdf
    ? `<div class="doc-row"><div style="flex:1"><div class="doc-name">${esc(c.attachment_name || 'Documento.pdf')}</div><div class="doc-type-lbl">Anexo antigo</div></div><a href="${c.attachment_pdf}" target="_blank" class="btn btn-ghost btn-sm">Abrir</a></div>`
    : '';
  body.innerHTML = `
    <div class="form-section-title">Anexar documento</div>
    <div style="display:flex;gap:.5rem;align-items:flex-end;margin-bottom:.5rem;flex-wrap:wrap">
      <div class="form-group" style="flex:1;min-width:180px"><label>Tipo de documento</label><select id="doc-type-sel">${opts}</select></div>
      <button class="btn btn-primary btn-sm" onclick="document.getElementById('doc-attach').click()" ${types.length ? '' : 'disabled'}>Selecionar arquivo</button>
      <input type="file" id="doc-attach" accept=".pdf,.png,.jpg,.jpeg" style="display:none" onchange="attachDoc(this.files[0])">
    </div>
    ${types.length ? '' : '<div style="font-size:.72rem;color:#9A6008;margin-bottom:.75rem">Cadastre os tipos em Configurações → Tipos de documento.</div>'}
    <div class="form-section-title" style="margin-top:1rem">Documentos anexados</div>
    <div id="doc-list">${docs.length || legacyDocs.length || legacy ? docs.map(docRow).join('') + legacyDocs.map(docRow).join('') + legacy : '<div style="color:var(--t3);font-size:.77rem">Nenhum documento anexado.</div>'}</div>`;
}

async function saveCase() {
  const id = G.editingCaseId;
  if (!id) return;
  if (document.getElementById('vr-previsto')) {
    saveValores();
    return;
  }
  if (!document.getElementById('e-name')) {
    toast('Abra a aba "Dados" para salvar o cadastro', 'info');
    return;
  }
  if (!(await podeEditarConferindo(G.editingCaseData))) {
    toast(
      hasPerm('editar_repasses')
        ? 'Este processo não é seu. Use "Liberar edição" no topo do cartão.'
        : 'Sem permissão para editar operações',
      'error'
    );
    return;
  }
  const stageId = document.getElementById('mc-stage-sel').value;
  const stage = G.stages.find(s => s.id === stageId);
  const oldStage = G.editingCaseData.stage_id;
  if (stageId !== oldStage && !podeMover(oldStage, stageId)) {
    avisoBloqueio(oldStage);
    return;
  }
  if (stageId !== oldStage) {
    // Antes de gravar: o histórico de etapa é escrito logo abaixo, e uma
    // recusa do banco depois disso deixaria uma linha de histórico de um
    // movimento que não aconteceu.
    const _falta = await docsObrigatoriosFaltando(id, oldStage, stageId);
    if (_falta.length) {
      toast(a1DocsAvisoFaltando(_falta), 'error');
      return;
    }
  }
  const _entDate = document.getElementById('e-ent-date')?.value || null;
  const payload = {
    ...(G.editingCaseData.payload || {}),
    entrevista_status: document.getElementById('e-ent-status')?.value,
    agendamento_data: _entDate,
    entrevista_data: _entDate,
    usuario_correspondente:
      _nomeVinc(G.partners, v('e-usuario')) || (G.editingCaseData.payload || {}).usuario_correspondente || '',
    convenio: v('e-convenio') || '',
    agencia: v('e-agencia') || '',
    modalidade: v('e-modalidade') || '',
    data_venda: v('e-data-venda') || ''
  };
  const patch = {
    client_name: v('e-name'),
    client_cpf: v('e-cpf'),
    client_phone: v('e-phone'),
    client_email: v('e-email'),
    development: v('e-development'),
    block: v('e-block'),
    unit: v('e-unit'),
    contract_value: brToNum(v('e-value')),
    evaluation_expiry: v('e-eval') || null,
    partner_name: G.isCorrTenant
      ? G.fixedCorr || ''
      : _nomeVinc(G.empresas, v('e-partner')) || G.editingCaseData.partner_name || '',
    real_estate_name: v('e-re'),
    broker_name: v('e-broker'),
    broker_phone: v('e-broker-phone'),
    manager_name: _nomeVinc(G.analistas, v('e-manager')) || G.editingCaseData.manager_name || '',
    observations: v('e-obs'),
    stage_id: stageId,
    stage_name: stage?.name || G.editingCaseData.stage_name,
    payload,
    // Os três vínculos por id, ao lado dos nomes que já iam. Ver createCase:
    // o texto continua indo porque filtros e visibilidade ainda casam por nome.
    empresa_id: v('e-partner') || null,
    correspondente_id: v('e-usuario') || null,
    analista_id: v('e-manager') || null
  };
  if (stageId !== oldStage) {
    patch.stage_entered_at = new Date().toISOString();
    Promise.all([
      fetch(A1.rest('a1_stage_history'), {
        method: 'POST',
        headers: A1.headers(),
        body: JSON.stringify({
          case_id: id,
          stage_id: stageId,
          stage_name: stage?.name,
          entered_at: new Date().toISOString()
        })
      }),
      fetch(A1.rest('a1_events'), {
        method: 'POST',
        headers: A1.headers(),
        body: JSON.stringify({
          case_id: id,
          type: 'stage_change',
          description: `Movido para: ${stage?.name}`,
          actor_name: G.user.name
        })
      })
    ]);
  }
  const _oldEnt = G.editingCaseData.payload?.entrevista_status || 'pendente';
  const _newEnt = document.getElementById('e-ent-status')?.value;
  if (_newEnt && _newEnt !== _oldEnt) {
    fetch(A1.rest('a1_events'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({
        case_id: id,
        type: 'interview',
        description: `Status entrevista: ${_newEnt}`,
        actor_name: G.user.name
      })
    }).catch(() => {});
  }
  const res = await fetch(`${A1.rest('a1_cases')}?id=eq.${id}`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify(patch)
  });
  if (res.ok) {
    const idx = G.cases.findIndex(c => c.id === id);
    if (idx > -1) G.cases[idx] = { ...G.cases[idx], ...patch };
    fetch(A1.rest('a1_events'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({
        case_id: id,
        type: 'edit',
        description: `Cadastro atualizado`,
        actor_name: G.user.name
      })
    }).catch(() => {});
    toast('Salvo com sucesso', 'success');
    closeModal('modal-card-bg');
    renderKanban();
    renderList();
    renderDashboard();
    populateFilterOptions();
  } else toast(await motivoDoErro(res), 'error');
}

async function unarchiveCase() {
  const id = G.editingCaseId;
  const res = await fetch(`${A1.rest('a1_cases')}?id=eq.${id}`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify({ archived: false })
  }).catch(() => null);
  if (!res || !res.ok) {
    toast(await motivoDoArquivar(res), 'error');
    return;
  }
  fetch(A1.rest('a1_events'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({
      case_id: id,
      type: 'unarchived',
      description: 'Processo desarquivado',
      actor_name: G.user.name
    })
  }).catch(() => {});
  G.cases = G.cases.filter(c => c.id !== id);
  closeModal('modal-card-bg');
  renderKanban();
  renderList();
  renderDashboard();
  toast('Desarquivado. Voltou para o quadro.', 'success');
}

// Alterna entre os ativos e os guardados. Recarrega do servidor em vez de
// filtrar o que já está em memória: o quadro só trouxe uma das duas metades.
async function toggleArquivados() {
  G.verArquivados = !G.verArquivados;
  const b = document.getElementById('btn-arquivados');
  if (b) {
    b.textContent = G.verArquivados ? 'Ver ativos' : 'Arquivados';
    b.classList.toggle('btn-primary', G.verArquivados);
    b.classList.toggle('btn-ghost', !G.verArquivados);
  }
  await loadData();
  renderKanban();
  renderList();
  renderDashboard();
}

// Resolve o NOME a partir do id escolhido no seletor. Devolve '' quando o id
// nao esta na lista — o chamador entao mantem o texto que ja estava gravado.
// Opções que valem por ID. O `escolhido` aceita id OU nome, porque os cartões
// antigos guardam só o texto — enquanto a migração não termina, abrir um cartão
// velho tem de mostrar o vínculo que ele tem, não um seletor em branco.
function selOptsId(lista, escolhido) {
  const arr = Array.isArray(lista) ? lista : [];
  const achado = arr.find(x => x.id === escolhido) || arr.find(x => x.name === escolhido);
  // Texto que não casa com cadastro nenhum vira uma opção própria, marcada.
  // Cartão antigo guarda só o nome, e há nomes em produção que não existem
  // mais em cadastro algum — apagar em silêncio o que está gravado seria
  // perder a informação justamente de quem mais precisa dela.
  const orfao =
    !achado && escolhido
      ? `<option value="" selected>${esc(escolhido)} (não está mais no cadastro)</option>`
      : '';
  return (
    '<option value="">Selecione...</option>' +
    orfao +
    arr
      .map(
        x =>
          `<option value="${esc(x.id)}"${achado && x.id === achado.id ? ' selected' : ''}>${esc(x.name)}</option>`
      )
      .join('')
  );
}

function _nomeVinc(lista, id) {
  if (!id) return '';
  return ((Array.isArray(lista) ? lista : []).find(x => x.id === id) || {}).name || '';
}

async function archiveCase() {
  // ARQUIVAR ARQUIVA. Esta função mandava DELETE: o cartão era destruído, sem
  // auditoria e sem volta, e a tela dizia "Arquivado" — quem clicava achava que
  // tinha guardado. Era quase certamente a origem do "não consigo excluir
  // cartão": conseguia, e não voltava.
  //
  // Apagar de verdade agora tem um lugar só, com ficha na tela e auditoria:
  // Configurações › Exclusão definitiva, pelo código do cartão.
  if (
    !confirm(
      'Arquivar este repasse?\n\nO cartão sai do quadro e da listagem, mas NÃO É APAGADO: continua no banco e você pode trazê-lo de volta pelo botão Arquivados (desarquivar) a qualquer momento.\n\nPara apagar de verdade, com registro de quem apagou, use Configurações › Exclusão definitiva.'
    )
  )
    return;
  const id = G.editingCaseId;
  const res = await fetch(`${A1.rest('a1_cases')}?id=eq.${id}`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify({ archived: true })
  }).catch(() => null);
  // Sem conferir a resposta, a recusa do banco virava "Arquivado" na tela e o
  // cartão reaparecia na próxima carga, sem ninguém ligar uma coisa à outra.
  if (!res || !res.ok) {
    toast(await motivoDoArquivar(res), 'error');
    return;
  }
  // A trilha vai depois do sucesso: evento de algo que não aconteceu é pior
  // que evento nenhum.
  fetch(A1.rest('a1_events'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({
      case_id: id,
      type: 'archived',
      description: 'Processo arquivado',
      actor_name: G.user.name
    })
  }).catch(() => {});
  G.cases = G.cases.filter(c => c.id !== id);
  closeModal('modal-card-bg');
  renderKanban();
  renderList();
  renderDashboard();
  toast('Arquivado. Pode ser trazido de volta pelo filtro de arquivados.', 'success');
}

// A coluna `archived` nasce por SQL que o dono roda à mão. Entre publicar a tela
// e rodar o arquivo existe uma janela, e nela o erro é exatamente este — dizer
// qual arquivo resolve poupa a investigação inteira.
async function motivoDoArquivar(res) {
  if (!res) return 'Sem resposta do servidor. O processo continua no quadro.';
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

async function addComment() {
  const input = document.getElementById('new-comment');
  const text = input?.value?.trim();
  if (!text) return;
  await fetch(A1.rest('a1_events'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({
      case_id: G.editingCaseId,
      type: 'comment',
      description: text,
      actor_name: G.user.name
    })
  });
  input.value = '';
  toast('Comentario adicionado', 'success');
  renderModalEvts();
}

// ─── New case ─────────────────────────────────────────────────────────────────
async function openNewCase() {
  // O atalho pelo console, ou o clique num botão que ainda não foi escondido.
  // A tela recusa aqui para não abrir um formulário que o banco vai rejeitar
  // depois de a pessoa preencher tudo.
  if (!podeCriarRepasse()) {
    toast('Você não tem permissão para criar repasses', 'error');
    return;
  }
  // reset form
  ['n-name', 'n-cpf', 'n-phone', 'n-email', 'n-value', 'n-broker', 'n-obs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('n-eval').value = '';
  document.getElementById('n-block').innerHTML =
    '<option value="">Selecione primeiro o empreendimento</option>';
  document.getElementById('n-block').disabled = true;
  document.getElementById('n-unit').innerHTML = '<option value="">Selecione primeiro o bloco</option>';
  document.getElementById('n-unit').disabled = true;

  // stage select
  const stageSel = document.getElementById('n-stage');
  const initials = G.stages.filter(s => s.is_initial);
  stageSel.innerHTML =
    '<option value="">Selecione</option>' +
    (initials.length ? initials : G.stages)
      .map(s => `<option value="${s.id}">${esc(s.name)}</option>`)
      .join('');
  const regSel = document.getElementById('n-regional');
  if (regSel)
    regSel.innerHTML =
      '<option value="">— Sem regional —</option>' +
      G.groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');

  // empreendimentos
  if (!G.emprLoaded) await loadEmpreendimentos();
  const devSel = document.getElementById('n-development');
  devSel.innerHTML =
    '<option value="">Selecione o empreendimento...</option>' +
    G.empreendimentos.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');

  const isCCA = G.user.role === 'partner' && G.user.type === 'cca';

  // correspondentes (empresas)
  if (!G.empresasLoaded) await loadEmpresas();
  const partnerSel = document.getElementById('n-partner');
  // O VALOR passa a ser o id; o nome continua sendo o rótulo. Vincular por
  // texto foi o que fez três analistas da S T sumirem da própria carteira
  // quando o nome no cadastro não batia com o gravado no processo.
  partnerSel.innerHTML =
    '<option value="">Selecione...</option>' +
    G.empresas
      .filter(e => e.is_active)
      .map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`)
      .join('');
  if (isCCA && G.user.empresa_name) {
    // O seletor tem o ID no value. Atribuir o NOME deixava o seletor vazio em
    // silêncio, e o correspondente criava processo sem a própria empresa.
    const minha = G.empresas.find(e => e.name === G.user.empresa_name);
    partnerSel.value = minha ? minha.id : '';
    partnerSel.disabled = true;
  } else {
    partnerSel.disabled = false;
  }

  // imobiliárias — carrega de a1_partners type=imobiliaria
  const imobs = await fetch(`${A1.rest('a1_partners')}?type=eq.imobiliaria&order=name.asc`, {
    headers: A1.headers()
  })
    .then(r => r.json())
    .catch(() => []);
  // Guarda em G.imobs, e não só numa variável local: o filtro de corretor por
  // imobiliária precisa do id, e o seletor só carrega o nome. Sem isto o filtro
  // simplesmente não acontecia no formulário de processo novo — e não acontecer
  // em silêncio é o pior jeito de falhar.
  if (Array.isArray(imobs) && (!Array.isArray(G.imobs) || !G.imobs.length)) G.imobs = imobs;
  document.getElementById('n-re').innerHTML =
    '<option value="">Selecione...</option>' +
    imobs.map(i => `<option value="${esc(i.name)}">${esc(i.name)}</option>`).join('');

  // analistas e usuarios correspondentes — filtrados por empresa selecionada
  if (!G.analistasLoaded) await loadAnalistas();
  if (!G.partnersLoaded) await loadPartners();
  {
    const us = document.getElementById('n-usuario');
    if (us)
      us.innerHTML =
        '<option value="">Selecione...</option>' +
        (Array.isArray(G.partners) ? G.partners : [])
          .map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
          .join('');
  }
  // se CCA: empresa já fixada, filtra imediatamente; caso contrário deixa vazio até selecionar empresa
  if (isCCA && G.user.empresa_name) {
    await onNovoRepasseEmpresaChange();
  } else {
    // sem empresa selecionada: lista todos os analistas ativos (comportamento anterior)
    const managerSel = document.getElementById('n-manager');
    managerSel.innerHTML =
      '<option value="">Selecione...</option>' +
      G.analistas
        .filter(a => a.is_active !== false)
        .map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)
        .join('');
    managerSel.disabled = false;
  }

  const coordSel = document.getElementById('n-coordenador');
  if (coordSel) coordSel.innerHTML = selOpts(_coordenadorNames(), '');
  const brokerSel = document.getElementById('n-broker');
  if (brokerSel) brokerSel.innerHTML = selOpts(_corretorNames(), '');
  avisoCoordenador('n');
  const convSel = document.getElementById('n-convenio');
  if (convSel) convSel.innerHTML = selOpts(_convenioNames(), '');
  const agSel = document.getElementById('n-agencia');
  if (agSel) agSel.innerHTML = selOpts(_agenciaNames(), '');
  const moSel = document.getElementById('n-modalidade');
  if (moSel) moSel.innerHTML = selOpts(_modalidadeNames(), '');
  const _ne = document.getElementById('n-estado'),
    _nc = document.getElementById('n-cidade');
  if (_ne) _ne.value = '';
  if (_nc) _nc.value = '';
  const _ndv = document.getElementById('n-data-venda');
  if (_ndv) _ndv.value = '';

  document.getElementById('modal-new-bg').classList.remove('hidden');
}

async function onNovoRepasseEmpresaChange() {
  const partnerSel = document.getElementById('n-partner');
  const managerSel = document.getElementById('n-manager');
  const selecionado = partnerSel.value;

  // garante que G.empresas é um array (nunca deixa o select quebrado)
  const empresas = Array.isArray(G.empresas) ? G.empresas : [];
  // Desde que os vínculos passaram a ser por id (11/09), o seletor de empresa
  // entrega o ID. Esta função ficou procurando pelo NOME e montando a lista de
  // analistas com o NOME no value — e o banco recusava a criação com
  // "invalid input syntax for type uuid: <nome da analista>". Quem escolhia a
  // empresa antes da analista não conseguia criar repasse (THE CRED, 02/10).
  // O nome segue aceito aqui só para não quebrar quem ainda chegar com ele.
  const empresa = empresas.find(e => e.id === selecionado) || empresas.find(e => e.name === selecionado);
  const opcoesAnalistas = lista =>
    '<option value="">Selecione...</option>' +
    lista.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');

  if (!empresa) {
    // sem empresa: mostra todos os analistas ativos
    managerSel.innerHTML = opcoesAnalistas((G.analistas || []).filter(a => a.is_active !== false));
    managerSel.disabled = false;
    return;
  }

  try {
    const res = await fetch(
      `${A1.rest('a1_partners')}?type=eq.analista&empresa_id=eq.${empresa.id}&is_active=eq.true&order=name.asc`,
      { headers: A1.headers() }
    );
    const analistas = res.ok ? await res.json().catch(() => []) : [];
    const lista = Array.isArray(analistas) ? analistas : [];
    // se nenhum analista vinculado à empresa ainda, exibe todos como fallback
    const fallback = !lista.length ? (G.analistas || []).filter(a => a.is_active !== false) : lista;
    managerSel.innerHTML = opcoesAnalistas(fallback);
  } catch {
    // qualquer erro: mantém lista completa
    managerSel.innerHTML = opcoesAnalistas((G.analistas || []).filter(a => a.is_active !== false));
  }
  managerSel.disabled = false;
}

function onEmprChange() {
  const devId = document.getElementById('n-development').value;
  const dev = G.empreendimentos.find(d => d.id === devId);
  const blockSel = document.getElementById('n-block');
  const unitSel = document.getElementById('n-unit');

  // Estado e cidade não se digitam aqui: são os do empreendimento. Preenche
  // antes de qualquer saída da função, senão empreendimento sem unidades
  // ficaria sem localidade.
  const estEl = document.getElementById('n-estado');
  const cidEl = document.getElementById('n-cidade');
  if (estEl) estEl.value = (dev && dev.estado) || '';
  if (cidEl) cidEl.value = (dev && dev.cidade) || '';

  unitSel.innerHTML = '<option value="">Selecione primeiro o bloco</option>';
  unitSel.disabled = true;

  if (!dev || !Array.isArray(dev.units) || !dev.units.length) {
    blockSel.innerHTML = '<option value="">Nenhum bloco cadastrado</option>';
    blockSel.disabled = true;
    return;
  }
  const blocks = [...new Set(dev.units.map(u => u.split('-')[0]))].sort();
  blockSel.innerHTML =
    '<option value="">Selecione o bloco...</option>' +
    blocks.map(b => `<option value="${b}">${b}</option>`).join('');
  blockSel.disabled = false;
}

function onBlocoChange() {
  const devId = document.getElementById('n-development').value;
  const block = document.getElementById('n-block').value;
  const dev = G.empreendimentos.find(d => d.id === devId);
  const unitSel = document.getElementById('n-unit');

  if (!dev || !block) {
    unitSel.innerHTML = '<option value="">Selecione primeiro o bloco</option>';
    unitSel.disabled = true;
    return;
  }
  const units = (dev.units || []).filter(u => u.startsWith(block + '-')).sort();
  unitSel.innerHTML =
    '<option value="">Selecione a unidade...</option>' +
    units.map(u => `<option value="${u}">${u}</option>`).join('');
  unitSel.disabled = false;
}

// Vínculo é gravado por id, sempre. Se algum seletor ainda entregar o NOME —
// foi o que derrubou a criação em 02/10 —, resolve pelo cadastro. Se não achar,
// vai vazio: um texto num campo uuid faz o banco recusar o processo INTEIRO, e
// perder o cliente digitado é pior que ficar sem a analista, que se corrige
// depois no cartão.
function idDoVinculo(valor, lista) {
  const v = String(valor || '').trim();
  if (!v) return '';
  const l = Array.isArray(lista) ? lista : [];
  if (l.some(x => x && x.id === v)) return v;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return v;
  const porNome = l.find(
    x =>
      x &&
      String(x.name || '')
        .trim()
        .toLowerCase() === v.toLowerCase()
  );
  return porNome ? porNome.id : '';
}

async function createCase() {
  // Conferido de novo na gravação: entre abrir o formulário e salvar, o gestor
  // pode ter tirado o acesso — e o caminho até aqui não passa necessariamente
  // por openNewCase().
  if (!podeCriarRepasse()) {
    toast('Você não tem permissão para criar repasses', 'error');
    return;
  }
  const name = v('n-name');
  if (!name) {
    toast('Informe o nome do cliente', 'error');
    return;
  }
  const devSel = document.getElementById('n-development');
  const dev = G.empreendimentos.find(d => d.id === devSel.value);
  const block = document.getElementById('n-block').value;
  const unit = document.getElementById('n-unit').value;
  // Os seletores agora valem por id; o NOME continua sendo gravado junto,
  // porque filtros, relatórios e a visibilidade do Repasse ainda casam por
  // texto. Guardar os dois é o que permite migrar sem parar ninguém.
  const nomeDe = (lista, id) => ((Array.isArray(lista) ? lista : []).find(x => x.id === id) || {}).name || '';
  const empresaId = G.isCorrTenant
    ? ''
    : idDoVinculo((document.getElementById('n-partner') || {}).value, G.empresas);
  const usuarioId = idDoVinculo((document.getElementById('n-usuario') || {}).value, G.partners);
  const analistaId = idDoVinculo((document.getElementById('n-manager') || {}).value, G.analistas);
  const partner = G.isCorrTenant ? G.fixedCorr || '' : nomeDe(G.empresas, empresaId);
  const re = document.getElementById('n-re').value;
  const manager = nomeDe(G.analistas, analistaId);
  const stageId = document.getElementById('n-stage').value;
  const stage = G.stages.find(s => s.id === stageId);
  const body = {
    tenant_id: G.user.tenant_id,
    module_key: 'repasse',
    client_name: name,
    client_cpf: v('n-cpf'),
    client_phone: v('n-phone'),
    client_email: v('n-email'),
    development: dev?.name || '',
    block,
    unit,
    contract_value: brToNum(v('n-value')),
    partner_name: partner,
    real_estate_name: re,
    broker_name: v('n-broker'),
    manager_name: manager,
    evaluation_expiry: v('n-eval') || null,
    observations: v('n-obs'),
    stage_id: stageId || null,
    stage_name: stage?.name || null,
    is_new: true,
    empresa_id: empresaId || null,
    correspondente_id: usuarioId || null,
    analista_id: analistaId || null,
    payload: {
      regional: v('n-regional') || '',
      usuario_correspondente: nomeDe(G.partners, usuarioId),
      convenio: v('n-convenio') || '',
      agencia: v('n-agencia') || '',
      modalidade: v('n-modalidade') || '',
      data_venda: v('n-data-venda') || '',
      estado: v('n-estado') || '',
      cidade: v('n-cidade') || ''
    }
  };
  try {
    const res = await fetch(A1.rest('a1_cases'), {
      method: 'POST',
      headers: A1.returnHeaders(),
      body: JSON.stringify(body)
    });
    // "Erro ao criar repasse" escondia o motivo, e o motivo era o que resolvia.
    if (!res.ok) {
      toast(await motivoDoErro(res), 'error');
      return;
    }
    const data = await res.json().catch(() => null);
    const created = Array.isArray(data) ? data[0] : null;
    if (created?.id) {
      G.cases.unshift(created);
      if (stageId)
        fetch(A1.rest('a1_stage_history'), {
          method: 'POST',
          headers: A1.headers(),
          body: JSON.stringify({
            case_id: created.id,
            stage_id: stageId,
            stage_name: stage?.name,
            entered_at: new Date().toISOString()
          })
        });
      toast('Repasse criado', 'success');
      closeModal('modal-new-bg');
      renderKanban();
      renderList();
      renderDashboard();
      populateFilterOptions();
    } else {
      toast('Erro ao criar repasse', 'error');
    }
  } catch (e) {
    toast('Erro ao criar repasse', 'error');
  }
}

// ─── Interview ────────────────────────────────────────────────────────────────
let _agdCaseId = null;

function openAgendamento(caseId, e) {
  e.stopPropagation();
  _agdCaseId = caseId;
  const c = G.cases.find(x => x.id === caseId);
  const existing = c?.payload?.agendamento_data || '';
  if (existing) {
    const [d, t] = existing.split('T');
    document.getElementById('agd-date').value = d || '';
    document.getElementById('agd-time').value = (t || '').slice(0, 5);
  } else {
    document.getElementById('agd-date').value = hojeISO();
    document.getElementById('agd-time').value = '09:00';
  }
  document.getElementById('agd-obs').value = c?.payload?.agendamento_obs || '';
  document.getElementById('modal-agendamento-bg').classList.remove('hidden');
}

async function confirmAgendamento() {
  const date = document.getElementById('agd-date').value;
  const time = document.getElementById('agd-time').value;
  const obs = document.getElementById('agd-obs').value.trim();
  if (!date || !time) {
    toast('Informe data e hora', 'error');
    return;
  }
  const iso = `${date}T${time}:00`;
  const caseId = _agdCaseId;
  const c = G.cases.find(x => x.id === caseId);
  if (!c) return;
  const payload = await gravarPayload(caseId, {
    entrevista_status: 'agendado',
    agendamento_data: iso,
    agendamento_obs: obs
  });
  if (!payload) return;
  fetch(A1.rest('a1_events'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({
      case_id: caseId,
      type: 'agendamento',
      description: `Entrevista agendada para ${fmtDateHour(iso)}${obs ? ' — ' + obs : ''}`,
      actor_name: G.user.name
    })
  });
  closeModal('modal-agendamento-bg');
  renderKanban();
  renderDashboard();
  toast('Entrevista agendada', 'success');
}

async function setEnt(caseId, status, e) {
  e.stopPropagation();
  const c = G.cases.find(x => x.id === caseId);
  const payload = await gravarPayload(caseId, { entrevista_status: status });
  if (!payload) return;
  fetch(A1.rest('a1_events'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({
      case_id: caseId,
      type: 'interview',
      description: `Status entrevista: ${status}`,
      actor_name: G.user.name
    })
  });
  renderKanban();
  renderDashboard();
  toast(`Entrevista: ${status}`, 'success');
}

// ─── Agenda calendar ──────────────────────────────────────────────────────────
let _agendaYear = new Date().getFullYear(),
  _agendaMonth = new Date().getMonth();

function agendaNavMonth(delta) {
  _agendaMonth += delta;
  if (_agendaMonth < 0) {
    _agendaMonth = 11;
    _agendaYear--;
  }
  if (_agendaMonth > 11) {
    _agendaMonth = 0;
    _agendaYear++;
  }
  renderAgendaCalendar();
}

function renderAgendaCalendar() {
  const el = document.getElementById('agenda-calendar');
  if (!el) return;
  const label = document.getElementById('agenda-month-label');
  const months = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro'
  ];
  if (label) label.textContent = months[_agendaMonth] + ' ' + _agendaYear;

  // entrevistas agendadas no mês
  const agds = G.cases.filter(c => {
    const d = c.payload && c.payload.agendamento_data;
    if (!d) return false;
    const dt = new Date(d);
    return dt.getFullYear() === _agendaYear && dt.getMonth() === _agendaMonth;
  });
  // vencimentos de avaliação no mês
  const venctos = G.cases.filter(c => {
    if (!c.evaluation_expiry) return false;
    const dt = new Date(c.evaluation_expiry + 'T12:00:00');
    return dt.getFullYear() === _agendaYear && dt.getMonth() === _agendaMonth;
  });

  const firstDay = new Date(_agendaYear, _agendaMonth, 1).getDay();
  const daysInMonth = new Date(_agendaYear, _agendaMonth + 1, 0).getDate();
  const today = new Date();

  const byDay = {},
    byDayVenc = {};
  for (const c of agds) {
    const day = new Date(c.payload.agendamento_data).getDate();
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(c);
  }
  for (const c of venctos) {
    const day = new Date(c.evaluation_expiry + 'T12:00:00').getDate();
    if (!byDayVenc[day]) byDayVenc[day] = [];
    byDayVenc[day].push(c);
  }

  const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  let html =
    '<div style="display:flex;gap:1rem;margin-bottom:.65rem;align-items:center">' +
    '<span style="display:inline-flex;align-items:center;gap:.3rem;font-size:.65rem;color:var(--t2)"><span style="width:10px;height:10px;background:#dbeafe;border:1px solid #93c5fd;border-radius:2px;display:inline-block"></span>Entrevista agendada</span>' +
    '<span style="display:inline-flex;align-items:center;gap:.3rem;font-size:.65rem;color:var(--t2)"><span style="width:10px;height:10px;background:#fef9c3;border:1px solid #fde047;border-radius:2px;display:inline-block"></span>Venc. avaliação</span>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px">' +
    dayLabels
      .map(function (d) {
        return (
          '<div style="text-align:center;font-size:.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);padding:.25rem 0">' +
          d +
          '</div>'
        );
      })
      .join('') +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">';

  for (let i = 0; i < firstDay; i++) html += '<div style="min-height:60px"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const isToday =
      today.getFullYear() === _agendaYear && today.getMonth() === _agendaMonth && today.getDate() === d;
    const items = byDay[d] || [];
    const vencs = byDayVenc[d] || [];
    const hasItems = items.length > 0 || vencs.length > 0;
    const borderColor = isToday
      ? 'var(--violet)'
      : items.length
        ? '#93c5fd'
        : vencs.length
          ? '#fde047'
          : 'var(--border)';
    const bgColor = isToday ? '#f5f3ff' : items.length ? '#eff6ff' : vencs.length ? '#fefce8' : 'var(--bg)';
    const numColor = isToday
      ? 'var(--violet)'
      : items.length
        ? 'var(--blue)'
        : vencs.length
          ? '#854d0e'
          : 'var(--t2)';
    let cell =
      '<div style="min-height:60px;border-radius:6px;border:1px solid ' +
      borderColor +
      ';background:' +
      bgColor +
      ';padding:3px 4px;cursor:' +
      (hasItems ? 'pointer' : 'default') +
      '"' +
      (hasItems ? ' onclick="toggleAgdDay(this)"' : '') +
      '>' +
      '<div style="font-size:.68rem;font-weight:' +
      (isToday ? '800' : '600') +
      ';color:' +
      numColor +
      ';margin-bottom:2px">' +
      d +
      '</div>';
    items.slice(0, 1).forEach(function (c) {
      cell +=
        '<div style="font-size:.55rem;font-weight:600;color:#1e40af;background:#dbeafe;border-radius:2px;padding:.05rem .2rem;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="Entrevista: ' +
        esc(c.client_name) +
        '">📅 ' +
        esc(c.client_name.split(' ')[0]) +
        '</div>';
    });
    vencs.slice(0, 1).forEach(function (c) {
      cell +=
        '<div style="font-size:.55rem;font-weight:600;color:#854d0e;background:#fef9c3;border-radius:2px;padding:.05rem .2rem;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="Venc: ' +
        esc(c.client_name) +
        '">⚠️ ' +
        esc(c.client_name.split(' ')[0]) +
        '</div>';
    });
    const extra = items.length + vencs.length - (items.length > 0 ? 1 : 0) - (vencs.length > 0 ? 1 : 0);
    if (extra > 0) cell += '<div style="font-size:.5rem;color:var(--t3)">+' + extra + '</div>';
    cell += '</div>';

    // detail panel (shown on click)
    let detail = '<div class="agd-day-detail" style="display:none">';
    items.forEach(function (c) {
      detail +=
        '<div onclick="openCard(\'' +
        c.id +
        '\')" style="padding:.35rem .5rem;border-radius:5px;border:1px solid #bfdbfe;background:#eff6ff;cursor:pointer;margin-bottom:.25rem">' +
        '<div style="font-size:.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#3b82f6;margin-bottom:.1rem">📅 Entrevista</div>' +
        '<div style="font-size:.72rem;font-weight:700;color:var(--t1)">' +
        esc(c.client_name) +
        '</div>' +
        '<div style="font-size:.62rem;color:var(--blue)">' +
        fmtDateHour(c.payload.agendamento_data) +
        '</div>' +
        (c.payload.agendamento_obs
          ? '<div style="font-size:.6rem;color:var(--t3)">' + esc(c.payload.agendamento_obs) + '</div>'
          : '') +
        '</div>';
    });
    vencs.forEach(function (c) {
      detail +=
        '<div onclick="openCard(\'' +
        c.id +
        '\')" style="padding:.35rem .5rem;border-radius:5px;border:1px solid #fde047;background:#fefce8;cursor:pointer;margin-bottom:.25rem">' +
        '<div style="font-size:.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#854d0e;margin-bottom:.1rem">⚠️ Venc. Avaliação</div>' +
        '<div style="font-size:.72rem;font-weight:700;color:var(--t1)">' +
        esc(c.client_name) +
        '</div>' +
        '<div style="font-size:.62rem;color:#92400e">' +
        new Date(c.evaluation_expiry + 'T12:00:00').toLocaleDateString('pt-BR') +
        '</div>' +
        '</div>';
    });
    detail += '</div>';
    html += cell + detail;
  }

  html += '</div>';

  // upcoming list: entrevistas + vencimentos ordenados
  const todayStr = today.toDateString();
  const upcomingEnt = agds
    .filter(function (c) {
      return new Date(c.payload.agendamento_data) >= new Date(todayStr);
    })
    .map(function (c) {
      return { c: c, type: 'ent', date: new Date(c.payload.agendamento_data) };
    });
  const upcomingVenc = venctos
    .filter(function (c) {
      return new Date(c.evaluation_expiry + 'T12:00:00') >= new Date(todayStr);
    })
    .map(function (c) {
      return { c: c, type: 'venc', date: new Date(c.evaluation_expiry + 'T12:00:00') };
    });
  const upcoming = upcomingEnt
    .concat(upcomingVenc)
    .sort(function (a, b) {
      return a.date - b.date;
    })
    .slice(0, 8);

  if (upcoming.length) {
    html +=
      '<div style="margin-top:1rem"><div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--t3);margin-bottom:.5rem">Próximos eventos</div>';
    upcoming.forEach(function (item) {
      const c = item.c,
        type = item.type,
        date = item.date;
      const isEnt = type === 'ent';
      const tagBg = isEnt ? '#dbeafe' : '#fef9c3';
      const tagClr = isEnt ? '#1e40af' : '#854d0e';
      const tagTxt = isEnt ? 'Entrevista' : 'Venc. Avaliação';
      const sub = isEnt ? fmtDateHour(c.payload.agendamento_data) : date.toLocaleDateString('pt-BR');
      html +=
        '<div onclick="openCard(\'' +
        c.id +
        '\')" style="display:flex;align-items:center;gap:.6rem;padding:.5rem .6rem;border-radius:7px;border:1px solid var(--border);background:var(--bg);cursor:pointer;margin-bottom:.35rem;transition:border-color .15s" onmouseenter="this.style.borderColor=\'' +
        (isEnt ? '#93c5fd' : '#fde047') +
        '\'" onmouseleave="this.style.borderColor=\'var(--border)\'">' +
        '<div style="width:36px;height:36px;border-radius:6px;background:' +
        tagBg +
        ';display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0">' +
        '<span style="font-size:.68rem;font-weight:800;color:' +
        tagClr +
        ';line-height:1">' +
        date.getDate() +
        '</span>' +
        '<span style="font-size:.5rem;font-weight:700;color:' +
        tagClr +
        ';text-transform:uppercase">' +
        months[date.getMonth()].slice(0, 3) +
        '</span>' +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
        '<div style="font-size:.75rem;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
        esc(c.client_name) +
        '</div>' +
        '<div style="font-size:.62rem;color:var(--t3)">' +
        sub +
        ' <span style="margin-left:.2rem;font-size:.55rem;background:' +
        tagBg +
        ';color:' +
        tagClr +
        ';padding:.05rem .25rem;border-radius:2px;font-weight:700">' +
        tagTxt +
        '</span></div>' +
        '</div>' +
        '<div style="font-size:.6rem;font-weight:600;color:var(--t3);flex-shrink:0">' +
        esc(c.partner_name || '') +
        '</div>' +
        '</div>';
    });
    html += '</div>';
  } else if (!agds.length && !venctos.length) {
    html +=
      '<div style="text-align:center;padding:1.5rem;color:var(--t3);font-size:.78rem">Nenhum evento neste mês</div>';
  }

  el.innerHTML = html;
}

function toggleAgdDay(dayEl) {
  const detail = dayEl.nextElementSibling;
  if (!detail) return;
  const isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : 'block';
}

// ─── List view ────────────────────────────────────────────────────────────────
// ── Seleção e vinculação em lote (listagem) ──────────────────────────────────
function toggleRowSel(id, el) {
  ensureVincLists();
  if (!G.selCases) G.selCases = new Set();
  if (el.checked) G.selCases.add(id);
  else G.selCases.delete(id);
  updateBulkBar();
}
function toggleSelectAll(el) {
  ensureVincLists();
  if (!G.selCases) G.selCases = new Set();
  document.querySelectorAll('#cases-tbody .row-chk').forEach(cb => {
    cb.checked = el.checked;
    if (el.checked) G.selCases.add(cb.value);
    else G.selCases.delete(cb.value);
  });
  updateBulkBar();
}
function clearSelection() {
  G.selCases = new Set();
  document.querySelectorAll('#cases-tbody .row-chk').forEach(cb => (cb.checked = false));
  const ca = document.getElementById('chk-all');
  if (ca) ca.checked = false;
  updateBulkBar();
}
function updateBulkBar() {
  const n = G.selCases ? G.selCases.size : 0;
  const bar = document.getElementById('bulk-bar');
  if (bar) bar.style.display = n ? 'flex' : 'none';
  const bc = document.getElementById('bulk-count');
  if (bc) bc.textContent = `${n} selecionado${n !== 1 ? 's' : ''}`;
}
function populateBulkSelects() {
  const be = document.getElementById('bulk-empr');
  if (be)
    be.innerHTML =
      '<option value="">Vincular empreendimento...</option>' +
      (G.empreendimentos || []).map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('');
  const bc = document.getElementById('bulk-corr');
  if (bc)
    bc.innerHTML =
      '<option value="">Vincular correspondente...</option>' +
      (Array.isArray(G.empresas) ? G.empresas : [])
        .filter(e => e.is_active !== false)
        .map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`)
        .join('');
  const bcw = document.getElementById('bulk-corr-wrap');
  if (bcw && G.isCorrTenant) bcw.style.display = 'none';
}
async function ensureVincLists() {
  if (!G.emprLoaded) {
    try {
      await loadEmpreendimentos();
    } catch {}
  }
  if (!G.empresasLoaded) {
    try {
      await loadEmpresas();
    } catch {}
  }
  populateBulkSelects();
}
async function bulkPatch(patch) {
  const ids = [...(G.selCases || [])];
  if (!ids.length) return;
  await fetch(`${A1.rest('a1_cases')}?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify(patch)
  }).catch(() => {});
  for (const c of G.cases) {
    if (G.selCases.has(c.id)) Object.assign(c, patch);
  }
  clearSelection();
  renderList();
  renderKanban();
  renderDashboard();
  populateFilterOptions();
}
async function bulkVincEmpr() {
  const v = document.getElementById('bulk-empr').value;
  if (!v) {
    toast('Escolha um empreendimento', 'error');
    return;
  }
  await bulkPatch({ development: v });
  toast('Empreendimento vinculado', 'success');
}
async function bulkVincCorr() {
  const v = document.getElementById('bulk-corr').value;
  if (!v) {
    toast('Escolha um correspondente', 'error');
    return;
  }
  await bulkPatch({ partner_name: v });
  toast('Correspondente vinculado', 'success');
}
function toggleDupView() {
  G.dupOnly = !G.dupOnly;
  const b = document.getElementById('btn-dup');
  if (b) {
    b.classList.toggle('btn-primary', G.dupOnly);
    b.classList.toggle('btn-ghost', !G.dupOnly);
    b.textContent = G.dupOnly ? 'Ver todos' : 'CPFs duplicados';
  }
  clearSelection();
  renderList();
}
async function bulkArquivar() {
  // Era bulkDelete: DELETE em lote, atrás de um confirm de uma linha, sem
  // auditoria e sem volta. O mesmo defeito do "Arquivar", só que em escala —
  // um clique podia destruir dezenas de processos de uma vez.
  const ids = [...(G.selCases || [])];
  if (!ids.length) {
    toast('Selecione ao menos um processo', 'error');
    return;
  }
  if (
    !confirm(
      `Arquivar ${ids.length} processo(s)?\n\n` +
        `Eles saem do quadro e da listagem, mas NÃO SÃO APAGADOS: continuam no banco ` +
        `e podem ser trazidos de volta pelo botão Arquivados (desarquivar).\n\n` +
        `Para apagar de verdade, com registro de quem apagou, use ` +
        `Configurações › Exclusão definitiva — um processo por vez, de propósito.`
    )
  )
    return;
  const res = await fetch(`${A1.rest('a1_cases')}?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify({ archived: true })
  }).catch(() => null);
  if (!res || !res.ok) {
    toast(await motivoDoArquivar(res), 'error');
    return;
  }
  G.cases = G.cases.filter(c => !G.selCases.has(c.id));
  clearSelection();
  renderList();
  renderKanban();
  renderDashboard();
  populateFilterOptions();
  toast(`${ids.length} processo(s) arquivado(s).`, 'success');
}

function renderList() {
  const stageF = document.getElementById('tbl-stage-filter')?.value || '';
  const sm = stageMap();
  let filtered = filteredCases().filter(c => !stageF || c.stage_id === stageF);
  if (G.dupOnly) {
    const _n = x => String(x || '').replace(/\D/g, '');
    const _cnt = {};
    for (const c of G.cases) {
      const k = _n(c.client_cpf);
      if (k) _cnt[k] = (_cnt[k] || 0) + 1;
    }
    filtered = filtered
      .filter(c => {
        const k = _n(c.client_cpf);
        return k && _cnt[k] > 1;
      })
      .sort((a, b) => _n(a.client_cpf).localeCompare(_n(b.client_cpf)));
  }
  document.getElementById('tbl-count').textContent =
    `${filtered.length} repasse${filtered.length !== 1 ? 's' : ''}`;
  document.getElementById('cases-tbody').innerHTML =
    filtered
      .map(c => {
        const stage = sm[c.stage_id],
          days = daysSince(c.stage_entered_at);
        const dc = days > 14 ? 'var(--red)' : days > 7 ? 'var(--amber)' : 'var(--t3)';
        const entSt = c.payload?.entrevista_status || 'pendente';
        const pillCls =
          {
            pendente: 'pill-espera',
            agendado: 'pill-analise',
            aprovado: 'pill-aprovado',
            reprovado: 'pill-reprovado'
          }[entSt] || 'pill-espera';
        return `<tr>
      <td style="text-align:center"><input type="checkbox" class="row-chk" value="${c.id}" ${G.selCases && G.selCases.has(c.id) ? 'checked' : ''} onclick="toggleRowSel('${c.id}',this)"></td>
      <td><span class="tbl-name">${esc(c.client_name)}</span>${c.is_new ? '<span class="badge-novo" style="margin-left:.4rem">NOVO</span>' : ''}</td>
      <td><span class="tbl-cpf">${fmtCpf(c.client_cpf || '')}</span></td>
      <td>${esc(c.development || '—')}${c.unit ? ` <span style="color:var(--t3)">Un ${esc(c.unit)}</span>` : ''}</td>
      <td>${stage ? `<span class="tbl-stage-dot" style="background:${stage.color}"></span>${esc(stage.name)}` : '—'}</td>
      <td>${esc(c.partner_name || '—')}</td>
      <td>${c.contract_value ? fmtBRL(c.contract_value) : '—'}</td>
      <td><span class="status-pill ${pillCls}">${entSt}</span></td>
      <td><span style="font-size:.7rem;font-family:'DM Mono',monospace;color:${dc}">${days}d</span></td>
      <td><button class="btn btn-ghost btn-xs" onclick="openCard('${c.id}')">Abrir</button></td>
    </tr>`;
      })
      .join('') ||
    `<tr><td colspan="10" style="text-align:center;color:var(--t3);padding:2rem">Nenhum repasse encontrado.</td></tr>`;
}

// ─── Flags ────────────────────────────────────────────────────────────────────
async function loadFlags() {
  G.flags = await fetch(`${A1.rest('a1_stage_flags')}?order=name.asc`, { headers: A1.headers() })
    .then(r => r.json())
    .catch(() => []);
  renderFlags();
  const el = document.getElementById('regionals-cfg-list');
  el.innerHTML = G.groups.length
    ? G.groups.map(g => `<div class="tag-item">${esc(g)}</div>`).join('')
    : '<span style="color:var(--t3);font-size:.77rem">Nenhuma regional. Defina group_key no Workflow.</span>';
}

function renderFlags() {
  const el = document.getElementById('flags-list');
  el.innerHTML = G.flags.length
    ? G.flags
        .map(
          f =>
            `<div class="tag-item"><span style="width:8px;height:8px;border-radius:50%;background:${f.color || '#0E8C7F'};display:inline-block"></span>${esc(f.name)}<span class="tag-rm" onclick="removeFlag('${f.id}')">x</span></div>`
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

// ─── Partners / Cadastros ─────────────────────────────────────────────────────
async function loadPartners() {
  G.partnersLoaded = true;
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
      <td style="font-weight:600">${esc(p.name)}</td>
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

function openPartnerModal(id) {
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
  const PERM_DEFAULTS = {
    ver_repasses: true,
    criar_repasses: true,
    editar_repasses: false,
    ver_dashboard: false,
    baixar_documentos: false,
    editar_perfil: true,
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
    permissions: (() => {
      const perms = Object.fromEntries(
        [...document.querySelectorAll('.pt-perm')].map(cb => [cb.dataset.key, cb.checked])
      );
      const verTodos = document.getElementById('pt-ver-analistas')?.checked !== false;
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

async function sha256(msg) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Correspondentes – restrições de plano ────────────────────────────────────
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

// ─── Correspondentes – inner tab switcher ─────────────────────────────────────
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

// ─── Empresas Correspondentes ─────────────────────────────────────────────────
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

// ─── Empreendimentos ──────────────────────────────────────────────────────────
async function loadEmpreendimentos() {
  G.emprLoaded = true;
  G.empreendimentos = await fetch(`${A1.rest('a1_developments')}?order=name.asc`, { headers: A1.headers() })
    .then(r => r.json())
    .catch(() => []);
  renderEmprList();
  // Populate regional dropdown in empreendimento form
  const regs = [...new Set(G.stages.map(s => s.group_key).filter(Boolean))];
  const sel = document.getElementById('empr-f-regional');
  if (sel) {
    sel.innerHTML =
      '<option value="">Selecione...</option>' + regs.map(r => `<option value="${r}">${r}</option>`).join('');
  }
}

function renderEmprList() {
  const el = document.getElementById('empr-list');
  if (!G.empreendimentos.length) {
    el.innerHTML = `<div style="color:var(--t3);font-size:.77rem;text-align:center;padding:1.5rem 0">Nenhum empreendimento cadastrado.</div>`;
    return;
  }
  el.innerHTML = `<table class="pt-table">
    <thead><tr><th>Nome</th><th>Regional</th><th>Tipo</th><th>Unidades</th><th></th></tr></thead>
    <tbody>${G.empreendimentos
      .map(
        d => `<tr>
      <td style="font-weight:600">${esc(d.name)}</td>
      <td>${esc(d.regional || '—')}</td>
      <td><span class="pt-type" style="background:#e0f2fe;color:#0284c7">${d.tipo || 'blocos'}</span></td>
      <td style="font-family:'DM Mono',monospace;font-size:.73rem">${d.unit_count || 0} unidades</td>
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

function openEmprModal() {
  G.editingEmprId = null;
  document.getElementById('empr-form-title').textContent = 'Novo empreendimento';
  document.getElementById('empr-save-btn').textContent = 'Cadastrar Unidades';
  document.getElementById('empr-f-name').value = '';
  document.getElementById('empr-f-qtd').value = '1';
  document.getElementById('empr-f-pav').value = '1';
  document.getElementById('empr-f-upf').value = '4';
  document.getElementById('empr-f-regional').value = '';
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
  document.getElementById('empr-f-regional').value = d.regional || '';
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
      const res = await fetch(`${A1.rest('a1_developments')}?id=eq.${G.editingEmprId}`, {
        method: 'PATCH',
        headers: A1.returnHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('patch failed');
      const idx = G.empreendimentos.findIndex(d => d.id === G.editingEmprId);
      if (idx >= 0) G.empreendimentos[idx] = { ...G.empreendimentos[idx], ...payload };
      G.empreendimentos.sort((a, b) => a.name.localeCompare(b.name));
      renderEmprList();
      closeEmprForm();
      toast(`"${name}" atualizado${units.length ? ` com ${units.length} unidades` : ''}.`, 'success');
    } else {
      const [created] = await fetch(A1.rest('a1_developments'), {
        method: 'POST',
        headers: A1.returnHeaders(),
        body: JSON.stringify({ ...payload, tenant_id: G.user.tenant_id })
      }).then(r => r.json());
      if (!created) throw new Error('no data');
      G.empreendimentos.push(created);
      G.empreendimentos.sort((a, b) => a.name.localeCompare(b.name));
      renderEmprList();
      closeEmprForm();
      toast(`"${name}" cadastrado${units.length ? ` com ${units.length} unidades` : ''}.`, 'success');
    }
  } catch {
    showEmprErr('Erro ao salvar. Verifique os dados e tente novamente.');
  } finally {
    btn.disabled = false;
    btn.textContent = isEditing ? 'Salvar Alterações' : 'Cadastrar Unidades';
  }
}

function showEmprErr(msg) {
  const el = document.getElementById('empr-err');
  el.textContent = msg;
  el.style.display = '';
  setTimeout(() => {
    el.style.display = 'none';
  }, 4000);
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

// ─── Imobiliárias ────────────────────────────────────────────────────────────
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
    tbody.innerHTML = `<tr><td colspan="7" class="pt-empty">${G.imobs.length ? 'Nenhuma imobiliária encontrada.' : 'Nenhuma imobiliária cadastrada ainda.'}</td></tr>`;
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

// ─── Analistas de Crédito ────────────────────────────────────────────────────
async function loadAnalistas() {
  G.analistasLoaded = true;
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
      '<tr><td colspan="5" style="padding:2rem;text-align:center;color:var(--t3)">Nenhum analista encontrado.</td></tr>';
    return;
  }
  tbody.innerHTML = page
    .map(
      a => `<tr>
    <td style="font-weight:600">${esc(a.name)}</td>
    <td style="color:var(--t2)">${esc(a.email || '—')}</td>
    <td style="color:var(--t2)">${esc(a.phone || '—')}</td>
    <td>${a.is_active !== false ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-red">Inativo</span>'}</td>
    <td><div style="display:flex;gap:.3rem">
      <button class="btn btn-ghost btn-sm" onclick="openAnalista(${JSON.stringify(a).replace(/"/g, '&quot;')})">Editar</button>
      <button class="btn btn-danger btn-sm" onclick="deleteAnalista('${a.id}','${escJs(a.name)}')">Excluir</button>
    </div></td>
  </tr>`
    )
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

function openAnalista(a) {
  G.editingAnalistaId = a?.id || null;
  document.getElementById('analista-modal-title').textContent = a ? 'Editar analista' : 'Novo analista';
  // populate empresa select
  if (!G.empresasLoaded) loadEmpresas().then(() => _populateAnalistaEmpresa(a?.empresa_id));
  else _populateAnalistaEmpresa(a?.empresa_id);
  document.getElementById('analista-f-name').value = a?.name || '';
  document.getElementById('analista-f-email').value = a?.email || '';
  document.getElementById('analista-f-phone').value = a?.phone || '';
  document.getElementById('analista-f-active').checked = a ? a.is_active !== false : true;
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
  const empresaId = document.getElementById('analista-f-empresa').value || null;
  const payload = {
    tenant_id: G.user.tenant_id,
    type: 'analista',
    name,
    email: document.getElementById('analista-f-email').value.trim(),
    phone: document.getElementById('analista-f-phone').value.trim(),
    is_active: document.getElementById('analista-f-active').checked,
    empresa_id: empresaId
  };
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
  } catch {
    toast('Erro ao salvar analista', 'error');
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

// ─── Feedback / Melhorias ─────────────────────────────────────────────────────
function openFeedbackModal() {
  document.getElementById('fb-title').value = '';
  document.getElementById('fb-desc').value = '';
  document.getElementById('feedback-form-wrap').classList.remove('hidden');
  document.getElementById('feedback-success-wrap').classList.add('hidden');
  document.getElementById('feedback-footer').style.display = '';
  const btn = document.getElementById('fb-save-btn');
  btn.disabled = false;
  btn.textContent = 'Enviar sugestão';
  document.getElementById('modal-feedback-bg').classList.remove('hidden');
}

async function saveFeedback() {
  const title = document.getElementById('fb-title').value.trim();
  if (!title) {
    toast('Informe o título da melhoria', 'error');
    return;
  }
  const btn = document.getElementById('fb-save-btn');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  const payload = {
    tenant_id: G.user.tenant_id,
    tenant_name: G.tenant?.slug || G.slug || '',
    author_name: G.user.name,
    author_role: G.user.role,
    title,
    description: document.getElementById('fb-desc').value.trim(),
    status: 'pending'
  };
  const res = await fetch(A1.rest('a1_feedback'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify(payload)
  });
  if (res.ok || res.status === 201) {
    document.getElementById('feedback-form-wrap').classList.add('hidden');
    document.getElementById('feedback-footer').style.display = 'none';
    document.getElementById('feedback-success-wrap').classList.remove('hidden');
  } else {
    toast('Erro ao enviar. Tente novamente.', 'error');
    btn.disabled = false;
    btn.textContent = 'Enviar sugestão';
  }
}

// ─── PDF ──────────────────────────────────────────────────────────────────────
function openPdfModal() {
  G.pdfData = null;
  G.pdfMode = null;
  document.getElementById('pdf-typesel').style.display = '';
  document.getElementById('pdf-zone').style.display = 'none';
  document.getElementById('pdf-processing').style.display = 'none';
  document.getElementById('pdf-preview').style.display = 'none';
  document.getElementById('btn-pdf-import').style.display = 'none';
  document.getElementById('pdf-input').value = '';
  document.getElementById('modal-pdf-bg').classList.remove('hidden');
}

function pickPdfType(type) {
  G.pdfMode = type;
  document.getElementById('pdf-typesel').style.display = 'none';
  document.getElementById('pdf-zone').style.display = '';
  const sub = document.getElementById('pdf-zone-sub');
  const title = document.querySelector('#modal-pdf-bg .modal-title');
  if (type === 'cvcrm') {
    if (sub) sub.textContent = 'Ficha de Pré-cadastro exportada do CVCRM';
    if (title) title.textContent = 'Importar Ficha de Pré-cadastro CVCRM';
  } else {
    if (sub) sub.textContent = 'Proposta bancaria, analise ou contrato';
    if (title) title.textContent = 'Importar Proposta PDF';
  }
}

async function handlePdfFile(file) {
  if (!file) return;
  if (!G.pdfMode) G.pdfMode = 'generic';
  document.getElementById('pdf-zone').style.display = 'none';
  document.getElementById('pdf-processing').style.display = '';
  try {
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js nao carregado');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    let txt = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      txt += tc.items.map(x => x.str).join(' ') + '\n';
    }
    const isCvcrm = G.pdfMode === 'cvcrm';
    G.pdfData = isCvcrm ? parseCvcrm(txt) : parsePdf(txt);
    document.getElementById('pdf-processing').style.display = 'none';
    document.getElementById('pdf-preview').style.display = '';
    document.getElementById('btn-pdf-import').style.display = '';
    document.getElementById('btn-pdf-import').textContent = isCvcrm ? 'Cadastrar cliente' : 'Importar dados';
    // mostra/oculta campos conforme o tipo
    document.getElementById('pdf-re-wrap').style.display = isCvcrm ? '' : 'none';
    document.getElementById('pdf-broker-wrap').style.display = isCvcrm ? '' : 'none';
    document.getElementById('pdf-partner-wrap').style.display = isCvcrm ? 'none' : '';
    document.getElementById('pdf-autonote').style.display = isCvcrm ? '' : 'none';
    document.getElementById('pdf-name').value = G.pdfData.name || '';
    document.getElementById('pdf-cpf').value = G.pdfData.cpf || '';
    document.getElementById('pdf-value').value = G.pdfData.value || '';
    document.getElementById('pdf-development').value = G.pdfData.development || '';
    document.getElementById('pdf-partner').value = G.pdfData.partner || '';
    document.getElementById('pdf-re').value = G.pdfData.imobiliaria || '';
    document.getElementById('pdf-broker').value = G.pdfData.broker || '';
  } catch (err) {
    document.getElementById('pdf-processing').style.display = 'none';
    document.getElementById('pdf-zone').style.display = '';
    toast('Erro PDF: ' + err.message, 'error');
  }
}

function parsePdf(text) {
  const d = {};
  const cpf = text.match(/\d{3}[.\s]\d{3}[.\s]\d{3}[-\s]\d{2}/);
  if (cpf) d.cpf = cpf[0].replace(/\s/g, '');
  const val = text.match(/R\$\s*[\d.,]+/);
  if (val) d.value = val[0].replace('R$', '').trim();
  const nome = text.match(
    /(?:NOME|PROPONENTE|CLIENTE)\s*[:\-]?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-záéíóúâêôãõçÁ\s]{5,50})/i
  );
  if (nome) d.name = nome[1].trim();
  const empr = text.match(/(?:EMPREENDIMENTO|IMÓVEL)\s*[:\-]?\s*([^\n]{5,60})/i);
  if (empr) d.development = empr[1].trim();
  return d;
}

// Parser da Ficha de Pré-cadastro do CVCRM
function parseCvcrm(text) {
  const t = text
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = re => {
    const x = t.match(re);
    return x ? x[1].trim() : '';
  };
  const money = s => (s ? s.replace(/R\$\s*/, '').trim() : '');
  const d = {};
  d.name = m(/NOME\s*:?\s*(.+?)\s*(?:CPF|CNPJ|ATENDIMENTO)/i);
  d.cpf = (t.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/) || t.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/) || [''])[0];
  d.atendimento = m(/ATENDIMENTO[^:]*:?\s*(\d{2,})/i);
  d.data_cadastro = m(/Data\s+Cadastro\s*:?\s*([0-9\/]+(?:\s*[àaÀ]s\s*[0-9hHmin:]+)?)/i);
  d.development = m(/Empreendimento\s*:?\s*(.+?)\s*Corretor/i);
  d.broker = m(/Corretor\s*:?\s*(.+?)\s*Imobili[áa]ria/i);
  d.imobiliaria = m(/Imobili[áa]ria\s*:?\s*(.+?)\s*Valor\s+Avalia/i);
  d.valor_avaliacao = money(m(/Valor\s+Avalia[çc][ãa]o\s*:?\s*(R\$\s*[\d.,]+)/i));
  d.valor_aprovado = money(m(/Valor\s+Aprovado\s*:?\s*(R\$\s*[\d.,]+)/i));
  d.valor_subsidio = money(m(/Valor\s+Subs[íi]dio\s*:?\s*(R\$\s*[\d.,]+)/i));
  d.valor_fgts = money(m(/Valor\s+do\s+FGTS\s*:?\s*(R\$\s*[\d.,]+)/i));
  d.saldo_devedor = money(m(/Saldo\s+devedor\s*:?\s*(R\$\s*[\d.,]+)/i));
  d.prazo = m(/Prazo\s+do\s+financiamento\s*:?\s*(\d+)/i);
  d.prestacao = money(m(/Valor\s+Presta[çc][ãa]o\s*:?\s*(R\$\s*[\d.,]+)/i));
  d.carta = m(/Carta\s+Cr[ée]dito\s*:?\s*([A-Za-zÀ-ÿ]+)/i);
  d.vencimento = m(/Vencimento\s+Aprova[çc][ãa]o\s*:?\s*([0-9\/]+)/i);
  d.renda = money(m(/Renda\s+Familiar[^:]*:?\s*(R\$\s*[\d.,]+)/i));
  d.value = d.valor_avaliacao || d.valor_aprovado || '';
  return d;
}

function brToNum(s) {
  if (!s) return null;
  const n = parseFloat(
    String(s)
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^\d.]/g, '')
  );
  return isNaN(n) ? null : n;
}
function brDateToISO(s) {
  if (!s) return null;
  const x = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return x ? `${x[3]}-${x[2]}-${x[1]}` : null;
}

function importFromPdf() {
  if (!G.pdfData) return;
  if (G.pdfMode === 'cvcrm') {
    importCvcrmCase();
    return;
  }
  closeModal('modal-pdf-bg');
  openNewCase();
  setTimeout(() => {
    if (G.pdfData.name) document.getElementById('n-name').value = G.pdfData.name;
    if (G.pdfData.cpf) document.getElementById('n-cpf').value = G.pdfData.cpf;
    if (G.pdfData.development) {
      const devMatch = G.empreendimentos.find(
        d => d.name.toLowerCase() === G.pdfData.development.toLowerCase()
      );
      if (devMatch) {
        document.getElementById('n-development').value = devMatch.id;
        onEmprChange();
      }
    }
  }, 80);
}

// Importa a ficha CVCRM: cria empreendimento/imobiliária se faltarem e cadastra o cliente na etapa inicial
async function importCvcrmCase() {
  const btn = document.getElementById('btn-pdf-import');
  const name = document.getElementById('pdf-name').value.trim();
  const cpf = document.getElementById('pdf-cpf').value.trim();
  const devName = document.getElementById('pdf-development').value.trim();
  const imobName = document.getElementById('pdf-re').value.trim();
  const broker = document.getElementById('pdf-broker').value.trim();
  const value = brToNum(document.getElementById('pdf-value').value);
  if (!name) {
    toast('Nome do cliente não encontrado no PDF', 'error');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Importando...';
  const norm = s =>
    String(s || '')
      .toLowerCase()
      .trim();
  try {
    // 1. Empreendimento — cadastra automaticamente se não existir
    let devLabel = devName;
    if (devName) {
      if (!G.emprLoaded) await loadEmpreendimentos();
      let dev = G.empreendimentos.find(d => norm(d.name) === norm(devName));
      if (!dev) {
        const [created] = await fetch(A1.rest('a1_developments'), {
          method: 'POST',
          headers: A1.returnHeaders(),
          body: JSON.stringify({ tenant_id: G.user.tenant_id, name: devName, unit_count: 0, units: [] })
        })
          .then(r => r.json())
          .catch(() => [null]);
        if (created) {
          G.empreendimentos.push(created);
          G.empreendimentos.sort((a, b) => a.name.localeCompare(b.name));
          dev = created;
          toast(`Empreendimento "${devName}" cadastrado automaticamente`, 'info');
        }
      }
      devLabel = dev ? dev.name : devName;
    }
    // 2. Imobiliária — cadastra automaticamente se não existir
    if (imobName) {
      const imobs = await fetch(`${A1.rest('a1_partners')}?type=eq.imobiliaria&select=id,name`, {
        headers: A1.headers()
      })
        .then(r => r.json())
        .catch(() => []);
      const exists = Array.isArray(imobs) && imobs.some(i => norm(i.name) === norm(imobName));
      if (!exists) {
        await fetch(A1.rest('a1_partners'), {
          method: 'POST',
          headers: A1.headers(),
          body: JSON.stringify({
            tenant_id: G.user.tenant_id,
            type: 'imobiliaria',
            name: imobName,
            is_active: true
          })
        }).catch(() => {});
        toast(`Imobiliária "${imobName}" cadastrada automaticamente`, 'info');
      }
    }
    // 3. Etapa inicial ("início")
    const stage =
      G.stages.find(s => /in[ií]cio/i.test(s.name)) || G.stages.find(s => s.is_initial) || G.stages[0];
    // 4. Observações com os demais dados da ficha
    const p = G.pdfData,
      obs = [];
    if (p.atendimento) obs.push(`Atendimento Nº: ${p.atendimento}`);
    if (p.data_cadastro) obs.push(`Data cadastro (CVCRM): ${p.data_cadastro}`);
    if (p.valor_aprovado) obs.push(`Valor aprovado: R$ ${p.valor_aprovado}`);
    if (p.valor_subsidio) obs.push(`Valor subsídio: R$ ${p.valor_subsidio}`);
    if (p.prazo) obs.push(`Prazo financiamento: ${p.prazo}`);
    if (p.prestacao) obs.push(`Valor prestação: R$ ${p.prestacao}`);
    if (p.carta) obs.push(`Carta crédito: ${p.carta}`);
    if (p.renda) obs.push(`Renda familiar: R$ ${p.renda}`);
    const body = {
      tenant_id: G.user.tenant_id,
      module_key: 'repasse',
      client_name: name,
      client_cpf: cpf,
      development: devLabel,
      contract_value: value,
      real_estate_name: imobName,
      broker_name: broker,
      evaluation_expiry: brDateToISO(p.vencimento) || null,
      observations: obs.join('\n'),
      stage_id: stage?.id || null,
      stage_name: stage?.name || null,
      is_new: true,
      payload: {
        source: 'cvcrm',
        atendimento: p.atendimento,
        valor_aprovado: p.valor_aprovado,
        valor_subsidio: p.valor_subsidio,
        prazo: p.prazo,
        prestacao: p.prestacao,
        carta: p.carta,
        renda: p.renda,
        data_cadastro_cvcrm: p.data_cadastro,
        valores: {
          valor_previsto: p.valor_avaliacao || '',
          valor_divida: p.valor_aprovado || '',
          valor_subsidio: p.valor_subsidio || '',
          valor_fgts: p.valor_fgts || '',
          valor_contrato: p.valor_avaliacao || ''
        }
      }
    };
    const res = await fetch(A1.rest('a1_cases'), {
      method: 'POST',
      headers: A1.returnHeaders(),
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    const created = Array.isArray(data) ? data[0] : null;
    if (created?.id) {
      G.cases.unshift(created);
      if (stage?.id) {
        fetch(A1.rest('a1_stage_history'), {
          method: 'POST',
          headers: A1.headers(),
          body: JSON.stringify({
            case_id: created.id,
            stage_id: stage.id,
            stage_name: stage.name,
            entered_at: new Date().toISOString()
          })
        });
        fetch(A1.rest('a1_events'), {
          method: 'POST',
          headers: A1.headers(),
          body: JSON.stringify({
            case_id: created.id,
            type: 'edit',
            description: 'Cliente importado da Ficha de Pré-cadastro CVCRM',
            actor_name: G.user.name
          })
        });
      }
      closeModal('modal-pdf-bg');
      renderKanban();
      renderList();
      renderDashboard();
      populateFilterOptions();
      toast(`Cliente "${name}" cadastrado na etapa ${stage?.name || 'inicial'}`, 'success');
    } else {
      toast('Erro ao cadastrar cliente', 'error');
    }
  } catch (e) {
    toast('Erro ao importar: ' + (e.message || e), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cadastrar cliente';
  }
}

async function attachDoc(file) {
  if (!file || !G.editingCaseId) return;
  if (!(await podeEditarConferindo(G.editingCaseData))) {
    toast(
      hasPerm('editar_repasses')
        ? 'Este processo não é seu. Use "Liberar edição" no topo do cartão.'
        : 'Sem permissão para anexar documentos. Peça ao gestor a permissão "Editar operações" ou "Gerente".',
      'error'
    );
    return;
  }
  const type = document.getElementById('doc-type-sel')?.value || '';
  const docId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const safeName = (file.name || 'documento').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${G.user.tenant_id}/${G.editingCaseId}/${docId}_${safeName}`;
  toast('Enviando arquivo...', 'info');
  const ok = await A1.storageUpload('case-documents', path, file);
  if (!ok) {
    toast('Erro ao enviar arquivo', 'error');
    return;
  }
  const doc = {
    id: docId,
    type,
    name: file.name,
    path,
    uploaded_at: new Date().toISOString(),
    by: (G.user && G.user.name) || ''
  };
  const docs = Array.isArray(G.editingCaseData.documents) ? [...G.editingCaseData.documents] : [];
  docs.push(doc);
  const res = await fetch(`${A1.rest('a1_cases')}?id=eq.${G.editingCaseId}`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify({ documents: docs })
  });
  if (res.ok) {
    anotarNoProcesso(G.editingCaseId, { documents: docs });
    fetch(A1.rest('a1_events'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({
        case_id: G.editingCaseId,
        type: 'document',
        description: `Documento anexado: ${type || 'sem tipo'} — ${file.name}`,
        actor_name: G.user.name
      })
    }).catch(() => {});
    renderModalDocs();
    toast('Documento anexado', 'success');
  } else {
    A1.storageRemove('case-documents', path).catch(() => {});
    toast('Erro ao anexar documento', 'error');
  }
}

async function removeDoc(docId) {
  if (!G.editingCaseId) return;
  if (!hasPerm('editar_repasses')) {
    toast('Sem permissão para remover documentos.', 'error');
    return;
  }
  if (!podeEditarProcesso(G.editingCaseData)) {
    toast('Este processo não é seu. Use "Liberar edição" no topo do cartão.', 'error');
    return;
  }
  if (!confirm('Remover este documento?')) return;
  const list = Array.isArray(G.editingCaseData.documents) ? G.editingCaseData.documents : [];
  if (list.some(d => d.id === docId)) {
    // documento novo (Storage) — vive na coluna documents
    const target = list.find(d => d.id === docId);
    const docs = list.filter(d => d.id !== docId);
    const res = await fetch(`${A1.rest('a1_cases')}?id=eq.${G.editingCaseId}`, {
      method: 'PATCH',
      headers: A1.headers(),
      body: JSON.stringify({ documents: docs })
    });
    if (res.ok) {
      anotarNoProcesso(G.editingCaseId, { documents: docs });
      if (target && target.path) A1.storageRemove('case-documents', target.path).catch(() => {});
      renderModalDocs();
      toast('Documento removido', 'info');
    } else toast('Erro ao remover', 'error');
    return;
  }
  // Documento antigo em base64. Depois do SQL de desempenho ele vive na coluna
  // legacy_docs; antes, dentro do payload. Remove de onde estiver — gravar no
  // lugar errado apagaria o documento sem apagar a referência, ou o contrário.
  const naColuna = Array.isArray(G.editingCaseData.legacy_docs);
  const legacyList = docsAntigos(G.editingCaseData);
  const restantes = legacyList.filter(d => d.id !== docId);
  const corpo = naColuna
    ? { legacy_docs: restantes }
    : { payload: { ...(G.editingCaseData.payload || {}), documents: restantes } };
  const res = await fetch(`${A1.rest('a1_cases')}?id=eq.${G.editingCaseId}`, {
    method: 'PATCH',
    headers: A1.headers(),
    body: JSON.stringify(corpo)
  });
  if (res.ok) {
    if (naColuna) anotarNoProcesso(G.editingCaseId, { legacy_docs: restantes });
    else anotarNoProcesso(G.editingCaseId, { payload: corpo.payload });
    renderModalDocs();
    toast('Documento removido', 'info');
  } else toast('Erro ao remover', 'error');
}

// ─── Filtros recolhidos ───────────────────────────────────────────────────────
// Cada barra guarda seu próprio estado (aberta/fechada) no navegador, por isso
// as duas chaves separadas. O contador é recalculado a cada mudança: sem ele,
// uma barra fechada com filtro ativo esconderia o motivo de a lista estar curta.
const _FILTROS_CHAVE = { dash: 'a1_filtros_dash', lista: 'a1_filtros_lista' };

function _filtrosLer(qual) {
  try {
    return localStorage.getItem(_FILTROS_CHAVE[qual]) === 'aberto';
  } catch {
    return false;
  }
}
function _filtrosGravar(qual, aberto) {
  try {
    localStorage.setItem(_FILTROS_CHAVE[qual], aberto ? 'aberto' : 'fechado');
  } catch {}
}

function alternarFiltros(qual) {
  const barra = document.getElementById(qual === 'dash' ? 'dash-filter-bar' : 'filter-bar');
  const botao = document.getElementById(qual === 'dash' ? 'btn-filtrar-dash' : 'btn-filtrar-lista');
  if (!barra || !botao) return;
  const aberto = barra.style.display === 'none';
  barra.style.display = aberto ? '' : 'none';
  botao.classList.toggle('aberto', aberto);
  _filtrosGravar(qual, aberto);
}

// Quantos filtros estão realmente valendo agora.
function _contarFiltros(obj) {
  return Object.values(obj || {}).filter(v => v !== '' && v !== null && v !== undefined).length;
}

function pintarContadorFiltros() {
  const par = [
    ['dash', G.dashFilters, 'filtros-ativos-dash'],
    ['lista', G.filters, 'filtros-ativos-lista']
  ];
  for (const [qual, obj, id] of par) {
    const el = document.getElementById(id);
    if (!el) continue;
    const n = _contarFiltros(obj);
    el.innerHTML = n
      ? `<span class="filtros-pino">${n}</span> ${n === 1 ? 'filtro aplicado' : 'filtros aplicados'}
         <button class="filtros-limpar" onclick="${qual === 'dash' ? 'clearDashFilters()' : 'clearFilters()'}">limpar</button>`
      : '';
  }
}

function iniciarFiltros() {
  for (const qual of ['dash', 'lista']) {
    const barra = document.getElementById(qual === 'dash' ? 'dash-filter-bar' : 'filter-bar');
    const botao = document.getElementById(qual === 'dash' ? 'btn-filtrar-dash' : 'btn-filtrar-lista');
    if (!barra || !botao) continue;
    const aberto = _filtrosLer(qual);
    barra.style.display = aberto ? '' : 'none';
    botao.classList.toggle('aberto', aberto);
  }
  pintarContadorFiltros();
}
document.addEventListener('DOMContentLoaded', iniciarFiltros);

// ─── Filter events ────────────────────────────────────────────────────────────
document.addEventListener('input', e => {
  if (e.target.id === 'f-search') {
    G.filters.search = e.target.value;
    renderKanban();
    renderList();
    pintarContadorFiltros();
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'f-empr') {
    G.filters.empr = e.target.value;
    renderKanban();
    renderList();
  }
  if (e.target.id === 'f-parceiro') {
    G.filters.parceiro = e.target.value;
    renderKanban();
    renderList();
  }
  if (e.target.id === 'f-re') {
    G.filters.re = e.target.value;
    renderKanban();
    renderList();
  }
  if (e.target.id === 'f-analista') {
    G.filters.analista = e.target.value;
    renderKanban();
    renderList();
  }
  if (e.target.id === 'f-corretor') {
    G.filters.corretor = e.target.value;
    renderKanban();
    renderList();
  }
  if (e.target.id === 'f-convenio') {
    G.filters.convenio = e.target.value;
    renderKanban();
    renderList();
  }
  if (e.target.id === 'f-agencia') {
    G.filters.agencia = e.target.value;
    renderKanban();
    renderList();
  }
  if (e.target.id === 'f-coordenador') {
    G.filters.coordenador = e.target.value;
    renderKanban();
    renderList();
  }
  if (e.target.id === 'f-modalidade') {
    G.filters.modalidade = e.target.value;
    renderKanban();
    renderList();
  }
  if (e.target.id === 'f-usuario') {
    G.filters.usuario = e.target.value;
    renderKanban();
    renderList();
  }
  if (e.target.id === 'f-entrevista') {
    G.filters.entrevista = e.target.value;
    renderKanban();
    renderList();
  }
  if (e.target.id === 'tbl-stage-filter') renderList();
  if (/^f-/.test(e.target.id)) pintarContadorFiltros();
});

function clearFilters() {
  G.filters = {
    search: '',
    empr: '',
    parceiro: '',
    re: '',
    analista: '',
    corretor: '',
    convenio: '',
    agencia: '',
    coordenador: '',
    modalidade: '',
    entrevista: '',
    usuario: ''
  };
  [
    'f-search',
    'f-empr',
    'f-parceiro',
    'f-re',
    'f-analista',
    'f-corretor',
    'f-convenio',
    'f-agencia',
    'f-coordenador',
    'f-modalidade',
    'f-usuario',
    'f-entrevista'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderKanban();
  renderList();
  pintarContadorFiltros();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function stageMap() {
  return Object.fromEntries(G.stages.map(s => [s.id, s]));
}
function v(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}
function fmtDateHour(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return (
    d.toLocaleDateString('pt-BR') +
    ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );
}
function fmtCpf(cpf) {
  const d = cpf.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf;
}
function maskValor(el) {
  const parts = String(el.value)
    .replace(/[^\d,]/g, '')
    .split(',');
  let intp = parts[0].replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  let out = intp.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (parts.length > 1) out += ',' + parts.slice(1).join('').replace(/\D/g, '').slice(0, 2);
  el.value = out;
}
function blurValor(el) {
  const n = brToNum(el.value);
  el.value =
    n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtBRL(val) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(dt) {
  return dt
    ? new Date(dt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '—';
}
function fmtDT(dt) {
  return dt
    ? new Date(dt).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '—';
}
function daysSince(dt) {
  return dt ? Math.floor((Date.now() - new Date(dt)) / 86400000) : 0;
}
function copyCpf(e, cpf) {
  e.stopPropagation();
  navigator.clipboard.writeText(cpf).then(() => toast('CPF copiado', 'info'));
}
function setT(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  if (id === 'modal-card-bg') {
    G.editingCaseId = null;
    G.editingCaseData = null;
  }
}
// ─── Relatório em planilha ────────────────────────────────────────────────────
// Exporta exatamente o que os filtros estão mostrando. CSV com ponto e vírgula
// e BOM, que é o que o Excel em português abre direto, sem assistente de
// importação e sem quebrar acentos.
function csvCampo(v) {
  if (v === null || v === undefined) return '';
  const t = String(v).replace(/"/g, '""');
  return /[";\n\r]/.test(t) ? `"${t}"` : t;
}
function dataBR(d) {
  if (!d) return '';
  const x = new Date(d);
  return isNaN(x) ? '' : x.toLocaleDateString('pt-BR');
}
function numeroBR(v) {
  const n = Number(v);
  return v === null || v === undefined || v === '' || isNaN(n) ? '' : n.toFixed(2).replace('.', ',');
}

function exportarPlanilha() {
  const linhas = filteredCases();
  if (!linhas.length) {
    toast('Nenhum processo nos filtros atuais para exportar.', 'info');
    return;
  }
  const sm = stageMap();

  const colunas = [
    ['ID', c => c.id],
    ['Cliente', c => c.client_name],
    ['CPF', c => c.client_cpf],
    ['Telefone', c => c.client_phone],
    ['E-mail', c => c.client_email],
    ['Empreendimento', c => c.development],
    ['Bloco', c => c.block],
    ['Unidade', c => c.unit],
    ['Etapa', c => (sm[c.stage_id] || {}).name || c.stage_name],
    ['Dias na etapa', c => daysSince(c.stage_entered_at)],
    ['Regional', c => (c.payload || {}).regional],
    ['Convênio', c => (c.payload || {}).convenio],
    ['Agência', c => (c.payload || {}).agencia],
    ['Coordenador', c => _coordenadorDoCorretor(c.broker_name)],
    ['Modalidade', c => (c.payload || {}).modalidade],
    ['Data da Venda', c => dataBR((c.payload || {}).data_venda)],
    ['Estado', c => (c.payload || {}).estado],
    ['Cidade', c => (c.payload || {}).cidade],
    ['Correspondente', c => c.partner_name],
    ['Usuário Correspondente', c => (c.payload || {}).usuario_correspondente],
    ['Imobiliária', c => c.real_estate_name],
    ['Corretor', c => c.broker_name],
    ['Analista', c => c.manager_name],
    ['Entrevista', c => (c.payload || {}).entrevista_status || 'pendente'],
    ['Valor do contrato', c => numeroBR(caseUnitValue(c))],
    ['Valor de repasse', c => numeroBR(caseRepasseValue(c))],
    ['Data de assinatura', c => dataBR(((c.payload || {}).valores || {}).data_assinatura)],
    ['Previsão de repasse', c => dataBR(((c.payload || {}).valores || {}).data_previsao_repasse)],
    ['Venc. avaliação', c => dataBR(c.evaluation_expiry)],
    ['Criado em', c => dataBR(c.created_at)],
    ['Observações', c => c.observations]
  ];

  const corpo = [
    colunas.map(x => csvCampo(x[0])).join(';'),
    ...linhas.map(c =>
      colunas
        .map(x => {
          try {
            return csvCampo(x[1](c));
          } catch {
            return '';
          }
        })
        .join(';')
    )
  ].join('\r\n');

  const hoje = new Date();
  const carimbo = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const blob = new Blob(['\uFEFF' + corpo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `processos-${carimbo}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  const total = G.cases.length;
  toast(
    `Relatório gerado com ${linhas.length} processo(s)` +
      (linhas.length !== total ? ` (de ${total}, conforme os filtros).` : '.'),
    'success'
  );
}

function toast(msg, type = 'info') {
  const wrap = document.getElementById('toast-wrap');
  const d = document.createElement('div');
  d.className = `toast toast-${type}`;
  d.textContent = msg;
  wrap.appendChild(d);
  setTimeout(() => d.remove(), 3200);
}

// PDF drag zone
const pdfZone = document.getElementById('pdf-zone');
pdfZone.addEventListener('dragover', e => {
  e.preventDefault();
  pdfZone.classList.add('drag-over');
});
pdfZone.addEventListener('dragleave', () => pdfZone.classList.remove('drag-over'));
pdfZone.addEventListener('drop', e => {
  e.preventDefault();
  pdfZone.classList.remove('drag-over');
  handlePdfFile(e.dataTransfer.files[0]);
});

document.querySelectorAll('.modal-bg').forEach(bg =>
  bg.addEventListener('click', e => {
    if (e.target === bg) closeModal(bg.id);
  })
);

// ── Arrastar o pipeline (pan): clicar+arrastar no fundo do quadro move o kanban ──
// (não interfere no arrastar de cartões — se o clique começa sobre um .k-card, ignora)
(function initKanbanPan() {
  const board = document.getElementById('kanban-board');
  if (!board) return;
  let panning = false,
    sx = 0,
    sy = 0,
    sl = 0,
    sty = 0;
  board.addEventListener('mousedown', e => {
    const isRight = e.button === 2; // botão direito: arrasta SEMPRE (até sobre o cartão)
    if (!isRight && e.button !== 0) return;
    if (!isRight && e.target.closest('.k-card')) return; // esquerdo sobre cartão = arrasta o cartão
    // Clique na barra de rolagem da coluna: deixa o navegador rolar, não pana.
    const _cb = e.target.closest('.k-col-body');
    if (_cb && e.offsetX > _cb.clientWidth) return;
    panning = true;
    sx = e.pageX;
    sy = e.pageY;
    sl = board.scrollLeft;
    sty = window.scrollY;
    board.classList.add('panning');
    e.preventDefault();
  });
  board.addEventListener('contextmenu', e => e.preventDefault()); // evita o menu do botão direito ao arrastar
  window.addEventListener('mousemove', e => {
    if (!panning) return;
    board.scrollLeft = sl - (e.pageX - sx);
    window.scrollTo(window.scrollX, sty - (e.pageY - sy));
  });
  const end = () => {
    if (panning) {
      panning = false;
      board.classList.remove('panning');
    }
  };
  window.addEventListener('mouseup', end);
  window.addEventListener('mouseleave', end);
})();

init();

// ── Registro sub-module loaders ─────────────────────────────────────────────
// Os três cadastros abaixo dividem o mesmo formato: carrega, guarda a lista e
// desenha. A busca refiltra o que já está na memória — antes ela chamava uma
// função que não existia e digitar não fazia nada.
// O id do container muda entre as telas ('bancos-list' aqui, 'banco-list' no
// pipeline), então aceita os dois em vez de desistir em silêncio.
// Identificador visível dos cadastros — serve para importações e para casar
// registro com planilha. Mostra um trecho e copia o valor inteiro no clique.
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

// ── Crud Modals: Despachante ──────────────────────────────────────────────────
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

// ── Crud Modals: Banco ────────────────────────────────────────────────────────
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

// ── Crud Modals: Cartório ─────────────────────────────────────────────────────
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

// Volta para a aba do navegador: busca de novo (alguém pode ter mexido em outra
// aba, no workflow, no celular), mas a tela fica como a pessoa deixou. Antes,
// cada volta redesenhava tudo: a etapa escolhida voltava para "Todas" e o quadro
// e a lista voltavam para o começo (THE CRED, 27/10). Agora só se redesenha o que
// mudou de fato, e com a rolagem devolvida ao lugar.
// Volta para a aba do navegador: busca de novo (alguém pode ter mexido em outra
// aba, no workflow, no celular), mas a tela fica como a pessoa deixou. Só se
// redesenha o que mudou de fato, e com a rolagem devolvida ao lugar.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !G.user) return;
  const antes = A1.impressaoTela(G.cases, G.stages);
  loadData().then(() => {
    if (A1.impressaoTela(G.cases, G.stages) === antes) return;
    const rol = A1.fotoRolagem();
    if (G.activeTab === 'dashboard') renderDashboard();
    else {
      renderPipeline();
      renderList();
    }
    A1.voltarRolagem(rol);
  });
});
