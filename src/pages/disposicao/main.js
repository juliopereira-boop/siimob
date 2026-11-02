// ─── Disposição de unidades ──────────────────────────────────────────────────
//
// Três vistas, a rota decide (?vista=): o MAPA (planta de cada bloco, andar por
// andar, com a situação de cada unidade), as RESERVAS e o PAINEL do gestor.
//
// O que esta tela NÃO decide: se a unidade pode ser reservada. Quem decide é
// a1_unidade_reservar, no banco, com a unidade travada; a tela só monta o
// pedido e mostra a resposta. Duas pessoas olhando a mesma unidade verde e
// clicando ao mesmo tempo é o caso normal, e o banco garante uma reserva só.
import { A1 } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import {
  a1HasModule,
  a1RefreshPartnerPerms,
  a1RequireAuth,
  a1RequireModule,
  a1StartHeartbeat
} from '../../shared/auth/auth.js';
import { a1MontarShell } from '../../shared/ui/modulo-shell.js';
import '../../shared/ui/avisos.js';
import '../../shared/ui/cobranca-aviso.js';
import { acoes } from '../../shared/ui/acoes.js';
import {
  STATUS,
  ORDEM_STATUS,
  STATUS_RESERVA,
  PERIODICIDADE,
  brl,
  brlCurto,
  num,
  paraNumero,
  dataBR,
  dataHoraBR,
  prazo,
  vencimentos,
  rotuloPavimento,
  carregar,
  precosVigentes,
  avaliacoesVigentes,
  preAnalise,
  rpc,
  motivo
} from '../../modules/disposicao/dados.js';
import { renderPainel } from './painel.js';

// O que cada data-acao do HTML faz. Ver src/shared/ui/acoes.js.
acoes({
  trocarEmpreendimento: el => trocarEmpreendimento(el.value),
  trocarEmpreendimentoPainel: el => renderPainelDaTela(el.value),
  filtrar: () => renderMapa(),
  filtrarStatus: el => filtrarStatus(el.dataset.status),
  modoVer: el => modoVer(el.dataset.modo),
  abrirUnidade: el => abrirFicha(el.dataset.id),
  fecharFicha: () => fecharFicha(),
  fecharFichaPeloFundo: (el, ev) => {
    if (ev.target === el) fecharFicha();
  },
  gerarFichas: () => gerarFichas(),
  iniciarReserva: el => iniciarReserva(el.dataset.id),
  fecharReserva: () => fecharReserva(),
  rsPasso: el => irParaPasso(Number(el.dataset.passo)),
  rsEstadoCivil: () => renderPassoCliente(true),
  rsAddAssociado: () => {
    lerPassoCliente();
    G.rs.cliente.associados.push({});
    renderPassoCliente(false);
  },
  rsTirarAssociado: el => {
    lerPassoCliente();
    G.rs.cliente.associados.splice(Number(el.dataset.i), 1);
    renderPassoCliente(false);
  },
  rsAddLinha: () => {
    lerFluxo();
    G.rs.fluxo.push(linhaNova());
    renderPassoFluxo();
  },
  rsTirarLinha: el => {
    lerFluxo();
    G.rs.fluxo.splice(Number(el.dataset.i), 1);
    renderPassoFluxo();
  },
  rsLinhaMudou: () => {
    lerFluxo();
    renderPassoFluxo();
  },
  rsCompletar: el => completarLinha(Number(el.dataset.i)),
  rsCronograma: () => {
    G.rs.cronograma = !G.rs.cronograma;
    lerFluxo();
    renderPassoFluxo();
  },
  rsConfirmar: () => confirmarReserva(),
  rsAbrirVenda: (el, ev) => {
    // Dentro da linha da reserva, que também é clicável: a venda ganha.
    ev.stopPropagation();
    location.href = `/${encodeURIComponent(G.slug)}/comercial?id=${encodeURIComponent(el.dataset.id)}`;
  },
  abrirVendaDaReserva: (el, ev) => {
    ev.stopPropagation();
    abrirVendaDaReserva(el.dataset.id);
  },
  rsEscolherPA: el => escolherPA(el.value),
  sairDaPA: () => sairDaPA(),
  perguntar: el => perguntar(el.dataset.tipo, el.dataset.id),
  fecharPergunta: () => fecharPergunta(),
  confirmarPergunta: () => confirmarPergunta(),
  filtrarReservas: el => filtrarReservas(el.dataset.status),
  abrirUnidadeDaReserva: el => abrirUnidadeDeOutroEmp(el.dataset.id, el.dataset.emp)
});

const G = {
  user: /** @type {any} */ (null),
  slug: '',
  vista: 'mapa',
  empreendimentos: /** @type {any[]} */ ([]),
  empId: /** @type {string|null} */ (null),
  unidades: /** @type {any[]} */ ([]),
  mapas: /** @type {any[]} */ ([]),
  preco: /** @type {Record<string, number>} */ ({}),
  avaliacao: /** @type {Record<string, number>} */ ({}),
  // A pré-análise que trouxe a pessoa até aqui (?pa=), já com os dados que a
  // reserva aproveita; e a lista das prontas para reservar, lida sob demanda.
  pa: /** @type {any} */ (null),
  paErro: '',
  paLista: /** @type {any[]|null} */ (null),
  paCarregando: false,
  temComercial: /** @type {boolean|null} */ (null),
  temPreAnalise: /** @type {boolean|null} */ (null),
  parametros: /** @type {any[]} */ ([]),
  config: /** @type {any} */ (null),
  reservas: /** @type {any[]} */ ([]),
  corretores: /** @type {any[]} */ ([]),
  status: /** @type {Set<string>} */ (new Set()),
  modo: 'planta',
  mudaram: /** @type {Set<string>} */ (new Set()),
  atualizadoEm: 0,
  fichaId: /** @type {string|null} */ (null),
  fichaHist: '',
  rs: /** @type {any} */ (null),
  pergunta: /** @type {any} */ (null),
  rsFiltro: 'ATIVA',
  timer: /** @type {any} */ (null)
};

const $ = (/** @type {string} */ id) => document.getElementById(id);
const ehGestor = () => !!G.user && G.user.role !== 'partner';
function hasPerm(/** @type {string} */ chave) {
  if (ehGestor()) return true;
  const p = (G.user && G.user.permissions) || {};
  return p.gerente === true || p[chave] === true;
}
const podeReservar = () => hasPerm('disp_reservar');
const podeGerir = () => hasPerm('disp_gerir');
const podeConfigurar = () => hasPerm('disp_configurar');
const podeVerPainel = () => hasPerm('ver_dashboard_disposicao');
// Reservar pela pré-análise é o novo "Iniciar venda": a mesma permissão.
const podeReservarPelaPA = () => hasPerm('pa_iniciar_venda');
const exigePA = () => !!G.config && G.config.origem_reserva === 'PRE_ANALISE';

function toast(/** @type {string} */ msg, tipo = 'ok') {
  const t = $('dp-toast');
  if (!t) return;
  const el = document.createElement('div');
  el.className = 'dp-toast-i ' + tipo;
  el.textContent = msg;
  t.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// ─── Entrada ─────────────────────────────────────────────────────────────────
function vistaDaURL() {
  const v = new URLSearchParams(location.search).get('vista');
  return v === 'reservas' || v === 'dashboard' ? v : 'mapa';
}

async function init() {
  try {
    G.user = a1RequireAuth();
  } catch {
    return;
  }
  await a1RefreshPartnerPerms();
  G.user = A1.user || G.user;
  try {
    await a1RequireModule('DISPOSICAO');
  } catch {
    return;
  }
  G.slug = A1.slug;
  G.vista = vistaDaURL();
  // Licença do cliente e permissão da pessoa são duas perguntas. A recusa que
  // vale é a do banco (a1_unidades_ler); esta evita a tela vazia sem motivo.
  if (!hasPerm('disp_ver')) {
    semAcesso('Ver a disposição de unidades');
    return;
  }
  if (G.vista === 'dashboard' && !podeVerPainel()) G.vista = 'mapa';
  await a1MontarShell($('shell'), { ativo: 'DISPOSICAO', vista: G.vista });
  a1StartHeartbeat('disposicao');
  // A licença da Venda decide se a reserva sem venda pode ganhar uma; a da
  // Pré-análise, se a reserva pode (ou tem de) vir de uma pré-análise.
  [G.temComercial, G.temPreAnalise] = await Promise.all([
    a1HasModule('COMERCIAL').catch(() => null),
    a1HasModule('PRE_ANALISE').catch(() => null)
  ]);
  try {
    await rpc('a1_disposicao_atualizar', {});
    if (G.vista === 'mapa') await lerPreAnaliseDaURL();
    await carregarBase();
  } catch (e) {
    erroTela(e);
    return;
  }
  $('dp-carregando').hidden = true;
  if (G.vista === 'reservas') {
    $('vista-reservas').hidden = false;
    renderReservas();
  } else if (G.vista === 'dashboard') {
    $('vista-dashboard').hidden = false;
    montarSelectEmp($('dp-dash-emp'), true);
    renderPainelDaTela('');
  } else {
    $('vista-mapa').hidden = false;
    renderMapa();
    renderFaixaPA();
    const alvo = new URLSearchParams(location.search).get('unidade');
    if (alvo) abrirFicha(alvo);
    else abrirReservaDaPA();
  }
  iniciarAoVivo();
}

// ─── A reserva que vem da pré-análise ────────────────────────────────────────
// A pré-análise aprovada manda a pessoa para cá com ?pa=. A tela lê o que a
// reserva aproveita (titular, cônjuge, corretor, unidade de interesse, crédito),
// abre o empreendimento dela e, se a unidade de interesse está disponível, já
// abre a reserva nela.
async function lerPreAnaliseDaURL() {
  const id = new URLSearchParams(location.search).get('pa');
  if (!id) return;
  const d = await preAnalise.dados(id);
  if (d && d.id) G.pa = { id: d.id, dados: d };
  else G.paErro = motivo(d && d.erro);
}

function renderFaixaPA() {
  const f = $('dp-pa-faixa');
  if (!f) return;
  if (!G.pa && !G.paErro) {
    f.hidden = true;
    return;
  }
  if (!G.pa) {
    f.className = 'dp-pa-faixa alerta';
    f.innerHTML = `<div class="dp-pa-ic" aria-hidden="true">!</div>
      <div class="dp-pa-txt"><b>Não deu para usar a pré-análise</b><span>${esc(G.paErro)}</span></div>
      <button class="dp-link" data-acao="sairDaPA">fechar</button>`;
    f.hidden = false;
    return;
  }
  const d = G.pa.dados;
  const tit = (d.pessoas || []).find((/** @type {any} */ p) => p.papel === 'TITULAR');
  const un = d.unidade_id ? unidadePorId(d.unidade_id) : null;
  const dica = d.motivo
    ? motivo(d.motivo)
    : un && un.status === 'disponivel'
      ? `Unidade de interesse: ${un.codigo}. A reserva já está aberta nela; para outra unidade, clique na planta.`
      : d.unidade
        ? `A unidade de interesse (${d.unidade}) não está disponível. Escolha outra na planta.`
        : 'Escolha a unidade na planta: a reserva abre com os dados do cliente e o crédito aprovado.';
  f.className = 'dp-pa-faixa' + (d.motivo ? ' alerta' : '');
  f.innerHTML = `<div class="dp-pa-ic" aria-hidden="true">PA</div>
    <div class="dp-pa-txt"><b>Reserva da pré-análise ${esc(d.codigo || '')}${tit ? ` · ${esc(tit.nome)}` : ''}</b>
      <span>${esc(dica)}</span></div>
    <button class="dp-link" data-acao="sairDaPA">não usar esta pré-análise</button>`;
  f.hidden = false;
}

function sairDaPA() {
  G.pa = null;
  G.paErro = '';
  const q = new URLSearchParams(location.search);
  q.delete('pa');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : ''));
  renderFaixaPA();
}

function abrirReservaDaPA() {
  if (!G.pa || G.pa.dados.motivo || !podeReservar()) return;
  const u = G.pa.dados.unidade_id ? unidadePorId(G.pa.dados.unidade_id) : null;
  if (!u || u.status !== 'disponivel' || !G.preco[u.id]) return;
  abrirFicha(u.id);
  iniciarReserva(u.id);
}

// A reserva que ficou sem venda (feita antes de a Venda ter situação inicial,
// ou antes de o cliente ganhar a Venda) ganha a venda aqui.
function podeAbrirVenda(/** @type {any} */ rs) {
  if (!rs || rs.status !== 'ATIVA' || rs.comercial_id || G.temComercial !== true) return false;
  if (podeGerir()) return true;
  return podeReservar() && G.user.role === 'partner' && rs.corretor_id === G.user.id;
}
async function abrirVendaDaReserva(/** @type {string} */ id) {
  const r = await rpc('a1_reserva_abrir_venda', { p_reserva: id });
  if (!r.ok) {
    toast(motivo(r.erro), 'erro');
    return;
  }
  toast('Venda aberta na esteira de Vendas.');
  await atualizarTudo();
}

function semAcesso(/** @type {string} */ rotulo) {
  $('dp-carregando').innerHTML =
    `<div class="dp-vazio"><b>Sem acesso à Disposição de unidades</b>` +
    `<p>O seu cadastro não tem a permissão <b>${esc(rotulo)}</b>. Peça ao gestor em ` +
    `Configurações (ou no perfil de acesso vinculado a você).</p></div>`;
}
function erroTela(/** @type {any} */ e) {
  $('dp-carregando').innerHTML =
    `<div class="dp-vazio"><b>Não consegui carregar a disposição</b><p>${esc(motivo(e && e.message))}</p></div>`;
}

async function carregarBase() {
  const [emps, params, cfg, mapas, reservas] = await Promise.all([
    carregar.empreendimentos(),
    carregar.parametros(true),
    carregar.config(),
    carregar.mapas(null),
    carregar.reservas()
  ]);
  G.empreendimentos = emps;
  G.parametros = params;
  G.config = cfg;
  G.mapas = mapas;
  G.reservas = reservas;
  if (ehGestor()) {
    G.corretores = await fetch(
      `${A1.rest('a1_partners')}?type=eq.corretor&select=id,name,extra,is_active&order=name`,
      { headers: A1.headers() }
    )
      .then(r => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  let guardado = null;
  try {
    guardado = localStorage.getItem('dp_emp');
  } catch {}
  const daURL = new URLSearchParams(location.search).get('emp');
  const daPA = G.pa ? G.pa.dados.empreendimento_id : null;
  const existe = (/** @type {any} */ id) => id && emps.some(e => e.id === id);
  G.empId = existe(daPA)
    ? daPA
    : existe(daURL)
      ? daURL
      : existe(guardado)
        ? guardado
        : emps[0]
          ? emps[0].id
          : null;
  montarSelectEmp($('dp-emp'), false);
  await carregarUnidades();
}

function montarSelectEmp(/** @type {any} */ sel, comTodos) {
  if (!sel) return;
  sel.innerHTML =
    (comTodos ? '<option value="">Todos os empreendimentos</option>' : '') +
    G.empreendimentos
      .map(
        e =>
          `<option value="${esc(e.id)}"${!comTodos && e.id === G.empId ? ' selected' : ''}>${esc(e.name)}</option>`
      )
      .join('');
}

async function carregarUnidades() {
  if (!G.empId) {
    G.unidades = [];
    G.preco = {};
    G.avaliacao = {};
    return;
  }
  const mapas = G.mapas.filter(m => m.empreendimento_id === G.empId);
  const [un, itens] = await Promise.all([
    carregar.unidades(G.empId),
    carregar.itens(mapas.filter(m => m.ativo).map(m => m.id))
  ]);
  // O que mudou desde a última leitura acende na planta por um instante: é o
  // "ao vivo" que a pessoa percebe sem precisar procurar.
  const antes = new Map(G.unidades.map(u => [u.id, u.status + '/' + u.versao]));
  G.mudaram = new Set(
    antes.size
      ? un.filter(u => antes.has(u.id) && antes.get(u.id) !== u.status + '/' + u.versao).map(u => u.id)
      : []
  );
  G.unidades = un;
  G.preco = precosVigentes(mapas, itens);
  G.avaliacao = avaliacoesVigentes(mapas, itens);
  G.atualizadoEm = Date.now();
}

async function trocarEmpreendimento(/** @type {string} */ id) {
  G.empId = id;
  try {
    localStorage.setItem('dp_emp', id);
  } catch {}
  G.unidades = [];
  $('dp-mapa').innerHTML = '<div class="dp-vazio">Carregando…</div>';
  try {
    await carregarUnidades();
  } catch (e) {
    $('dp-mapa').innerHTML = `<div class="dp-vazio">${esc(motivo(/** @type {any} */ (e).message))}</div>`;
    return;
  }
  ['dp-f-bloco', 'dp-f-tipologia'].forEach(i => /** @type {any} */ ($(i).value = ''));
  G.status.clear();
  renderMapa();
}

// ─── Ao vivo ─────────────────────────────────────────────────────────────────
// Não há canal de eventos do banco para esta autenticação; a tela confere a
// cada 20 segundos (e na volta para a aba), e o banco aproveita a chamada para
// vencer as reservas que passaram do prazo.
function iniciarAoVivo() {
  const tique = async () => {
    if (document.hidden) return;
    try {
      await rpc('a1_disposicao_atualizar', {});
      const [reservas] = await Promise.all([carregar.reservas(), carregarUnidades()]);
      G.reservas = reservas;
      if (G.vista === 'mapa') {
        renderMapa();
        if (G.fichaId && !G.rs) renderFicha(false);
      }
      if (G.vista === 'reservas') renderReservas();
    } catch {
      // Sem rede: o indicador mostra há quanto tempo foi a última leitura boa.
    }
    relogio();
  };
  G.timer = setInterval(tique, 20000);
  setInterval(relogio, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - G.atualizadoEm > 15000) tique();
  });
  relogio();
}
function relogio() {
  const el = $('dp-ao-vivo-txt');
  if (!el) return;
  const s = Math.round((Date.now() - G.atualizadoEm) / 1000);
  el.textContent =
    s < 10 ? 'ao vivo · agora' : s < 60 ? `ao vivo · há ${s}s` : `atualizado há ${Math.round(s / 60)} min`;
  $('dp-ao-vivo').classList.toggle('parado', s > 90);
}

// ─── Filtros ─────────────────────────────────────────────────────────────────
function filtrarStatus(/** @type {string} */ s) {
  if (G.status.has(s)) G.status.delete(s);
  else G.status.add(s);
  renderMapa();
}
function modoVer(/** @type {string} */ m) {
  G.modo = m === 'lista' ? 'lista' : 'planta';
  $('dp-modo-planta').classList.toggle('on', G.modo === 'planta');
  $('dp-modo-lista').classList.toggle('on', G.modo === 'lista');
  renderMapa();
}
function passaNoFiltro(/** @type {any} */ u) {
  const busca = A1.normalBusca(/** @type {any} */ ($('dp-busca')).value || '');
  const bloco = /** @type {any} */ ($('dp-f-bloco')).value;
  const tip = /** @type {any} */ ($('dp-f-tipologia')).value;
  const vagas = /** @type {any} */ ($('dp-f-vagas')).value;
  if (G.status.size && !G.status.has(u.status)) return false;
  if (bloco && (u.bloco || '') !== bloco) return false;
  if (tip && (u.tipologia || '') !== tip) return false;
  if (vagas !== '') {
    const v = Number(u.vagas || 0);
    if (vagas === '2' ? v < 2 : v !== Number(vagas)) return false;
  }
  if (busca && !A1.casaBusca([u.codigo, u.tipologia, u.bloco, u.numero, u.descricao], busca)) return false;
  return true;
}
const natural = (/** @type {any} */ a, /** @type {any} */ b) =>
  String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true });

// ─── O mapa ──────────────────────────────────────────────────────────────────
function reservaAtivaDe(/** @type {string} */ unidadeId) {
  return G.reservas.find(r => r.unidade_id === unidadeId && r.status === 'ATIVA') || null;
}

function renderMapa() {
  relogio();
  const box = $('dp-mapa');
  if (!G.empreendimentos.length) {
    box.innerHTML = `<div class="dp-vazio"><b>Nenhum empreendimento cadastrado</b><p>Cadastre em Configurações › Empreendimentos.</p></div>`;
    $('dp-resumo').innerHTML = '';
    return;
  }
  renderResumo();
  preencherFiltros();
  if (!G.unidades.length) {
    const emp = G.empreendimentos.find(e => e.id === G.empId);
    const textos = emp && Array.isArray(emp.units) ? emp.units.length : 0;
    box.innerHTML = `<div class="dp-vazio"><b>Este empreendimento ainda não tem fichas de unidade</b>
      <p>${
        textos
          ? `O cadastro tem ${textos} unidade(s) em lista. Gere as fichas para cada uma ganhar situação, preço e histórico.`
          : 'Cadastre as unidades em Configurações › Unidades.'
      }</p>
      ${textos && podeConfigurar() ? '<button class="dp-btn dp-btn-p" data-acao="gerarFichas">Gerar as fichas agora</button>' : ''}</div>`;
    return;
  }
  box.innerHTML = G.modo === 'lista' ? htmlLista() : htmlPlanta();
  G.mudaram.clear();
}

function renderResumo() {
  const conta = Object.fromEntries(ORDEM_STATUS.map(s => [s, 0]));
  let vgvDisp = 0,
    vgvVend = 0,
    vgvTotal = 0;
  G.unidades.forEach(u => {
    conta[u.status] = (conta[u.status] || 0) + 1;
    const p = G.preco[u.id] || 0;
    vgvTotal += p;
    if (u.status === 'disponivel') vgvDisp += p;
    if (u.status === 'vendido') vgvVend += p;
  });
  const total = G.unidades.length || 1;
  const emp = G.empreendimentos.find(e => e.id === G.empId) || {};
  const blocos = new Set(G.unidades.map(u => u.bloco || '')).size;
  const local = [emp.cidade, emp.estado].filter(Boolean).join('/');
  const pct = vgvTotal ? Math.round((vgvVend / vgvTotal) * 100) : null;
  $('dp-resumo').innerHTML = `
    <div>
      <div class="dp-resumo-nome">${conta.disponivel} de ${G.unidades.length} unidade${G.unidades.length === 1 ? '' : 's'} disponíve${conta.disponivel === 1 ? 'l' : 'is'}</div>
      <div class="dp-resumo-sub">${[emp.name, local, blocos > 1 ? `${blocos} blocos` : '']
        .filter(Boolean)
        .map(x => esc(x))
        .join(' · ')}</div>
    </div>
    ${pct != null ? `<div class="dp-resumo-num"><b>${pct}%</b><span>do VGV vendido</span></div>` : '<div></div>'}
    <div class="dp-barra" role="img" aria-label="${esc(ORDEM_STATUS.map(s => `${conta[s]} ${STATUS[s].plural}`).join(', '))}">
      ${ORDEM_STATUS.map(s => (conta[s] ? `<i class="${s === 'bloqueado' ? 'hach' : ''}" style="flex:${conta[s]};background:${STATUS[s].cor}"></i>` : '')).join('')}
    </div>
    <div class="dp-chips">
      ${ORDEM_STATUS.map(
        s => `<button class="dp-chip${G.status.has(s) ? ' on' : ''}" data-acao="filtrarStatus" data-status="${s}"
          style="--c:${STATUS[s].cor};--f:${STATUS[s].fundo};--t:${STATUS[s].texto}" aria-pressed="${G.status.has(s)}">
          <i></i><b>${conta[s]}</b> ${STATUS[s].plural}<small>${Math.round((conta[s] / total) * 100)}%</small></button>`
      ).join('')}
      <div class="dp-vgv"><span>Estoque à venda</span><b>${brl(vgvDisp)}</b></div>
      <div class="dp-vgv"><span>Vendido</span><b>${brl(vgvVend)}</b></div>
    </div>`;
}

function preencherFiltros() {
  const sel = (/** @type {string} */ id, /** @type {string[]} */ vals, /** @type {string} */ todos) => {
    const el = /** @type {any} */ ($(id));
    const atual = el.value;
    el.innerHTML =
      `<option value="">${todos}</option>` +
      vals.map(v => `<option value="${esc(v)}"${v === atual ? ' selected' : ''}>${esc(v)}</option>`).join('');
  };
  const unicos = (/** @type {(u:any)=>any} */ f) =>
    [...new Set(G.unidades.map(f).filter(Boolean))].sort(natural);
  sel(
    'dp-f-bloco',
    unicos(u => u.bloco),
    'Todos os blocos'
  );
  sel(
    'dp-f-tipologia',
    unicos(u => u.tipologia),
    'Todas as tipologias'
  );
}

function htmlCelula(/** @type {any} */ u) {
  const st = STATUS[u.status] || STATUS.disponivel;
  const p = G.preco[u.id];
  const rs = u.status === 'reservado' ? reservaAtivaDe(u.id) : null;
  const linha2 = [u.tipologia, u.area_privativa ? num(u.area_privativa, 1) + ' m²' : '']
    .filter(Boolean)
    .join(' · ');
  const dica = [
    `${u.codigo}: ${st.rotulo}`,
    u.tipologia,
    u.area_privativa ? `${num(u.area_privativa)} m² privativos` : '',
    u.vagas != null ? `${u.vagas} vaga(s)` : '',
    p ? brl(p) : 'sem preço',
    rs && rs.expira_em ? prazo(rs.expira_em) : '',
    u.status === 'bloqueado' && u.status_motivo ? `Motivo: ${u.status_motivo}` : ''
  ]
    .filter(Boolean)
    .join('\n');
  const fora = !passaNoFiltro(u);
  const icone =
    u.status === 'bloqueado'
      ? '<svg class="un-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
      : u.status === 'vendido'
        ? '<svg class="un-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>'
        : u.status === 'reservado'
          ? '<svg class="un-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
          : '';
  return `<button class="un un-${esc(u.status)}${fora ? ' fora' : ''}${G.mudaram.has(u.id) ? ' mudou' : ''}${G.fichaId === u.id ? ' sel' : ''}"
      data-acao="abrirUnidade" data-id="${esc(u.id)}" title="${esc(dica)}"
      aria-label="${esc(`Unidade ${u.codigo}, ${st.rotulo}${p ? ', ' + brl(p) : ''}`)}">
      <span class="un-num">${icone}${esc(u.numero || u.codigo)}</span>
      ${linha2 ? `<span class="un-l2">${esc(linha2)}</span>` : ''}
      <span class="un-preco">${
        u.status === 'reservado' && rs && rs.expira_em
          ? esc(prazo(rs.expira_em))
          : u.status === 'vendido'
            ? 'Vendida'
            : p
              ? esc(brlCurto(p))
              : '<em>sem preço</em>'
      }</span>
    </button>`;
}

function htmlPlanta() {
  const porBloco = new Map();
  G.unidades.forEach(u => {
    const b = u.bloco || '';
    if (!porBloco.has(b)) porBloco.set(b, []);
    porBloco.get(b).push(u);
  });
  const blocos = [...porBloco.keys()].sort(natural);
  return blocos
    .map(b => {
      const lista = porBloco.get(b);
      const conta = Object.fromEntries(
        ORDEM_STATUS.map(s => [s, lista.filter((/** @type {any} */ u) => u.status === s).length])
      );
      const temPav = lista.some((/** @type {any} */ u) => u.pavimento != null);
      let corpo;
      if (temPav) {
        const pavs = [...new Set(lista.map((/** @type {any} */ u) => u.pavimento))].sort(
          (/** @type {any} */ a, /** @type {any} */ c) => (c ?? -1) - (a ?? -1)
        );
        const finais = [...new Set(lista.map((/** @type {any} */ u) => u.numero || u.codigo))].sort(natural);
        const pos = new Map(
          lista.map((/** @type {any} */ u) => [`${u.pavimento}|${u.numero || u.codigo}`, u])
        );
        corpo = `<div class="dp-predio" style="--cols:${finais.length}">
          <div class="dp-teto" style="width:calc(${finais.length} * 111px - 7px)"></div>
          ${pavs
            .map(
              p => `<div class="dp-andar"><span class="dp-andar-rot">${esc(rotuloPavimento(p))}</span>
                ${finais.map(f => (pos.has(`${p}|${f}`) ? htmlCelula(pos.get(`${p}|${f}`)) : '<span class="un-vazia"></span>')).join('')}
              </div>`
            )
            .join('')}
          <div class="dp-chao" style="width:calc(${finais.length} * 111px - 7px)"></div>
        </div>`;
      } else {
        corpo = `<div class="dp-lotes">${lista
          .slice()
          .sort((/** @type {any} */ a, /** @type {any} */ c) =>
            natural(a.numero || a.codigo, c.numero || c.codigo)
          )
          .map(htmlCelula)
          .join('')}</div>`;
      }
      const disp = conta.disponivel;
      const andares = temPav ? new Set(lista.map((/** @type {any} */ u) => u.pavimento)).size : 0;
      return `<article class="dp-bloco">
        <header class="dp-bloco-cab">
          <div><div class="dp-bloco-nome">${b ? esc(b) : 'Unidades'}</div>
            <div class="dp-bloco-sub">${andares ? `${andares} pavimento(s) · ` : ''}${lista.length} unidade(s) · <b>${disp}</b> disponíve${disp === 1 ? 'l' : 'is'}</div></div>
          <div class="dp-mini" aria-hidden="true">${ORDEM_STATUS.map(s => (conta[s] ? `<i class="${s === 'bloqueado' ? 'hach' : ''}" style="flex:${conta[s]};background:${STATUS[s].cor}"></i>` : '')).join('')}</div>
        </header>
        <div class="dp-bloco-corpo">${corpo}</div>
      </article>`;
    })
    .join('');
}

function htmlLista() {
  const linhas = G.unidades
    .filter(passaNoFiltro)
    .sort(
      (a, b) =>
        natural(a.bloco, b.bloco) || (a.pavimento ?? 0) - (b.pavimento ?? 0) || natural(a.numero, b.numero)
    );
  if (!linhas.length) return '<div class="dp-vazio">Nenhuma unidade com esses filtros.</div>';
  return `<div class="dp-tabela-wrap"><table class="dp-tabela">
    <thead><tr><th>Unidade</th><th>Bloco</th><th>Pavimento</th><th>Tipologia</th><th class="n">Área priv.</th>
      <th class="n">Vagas</th><th class="n">Preço</th><th>Situação</th></tr></thead>
    <tbody>${linhas
      .map(u => {
        const st = STATUS[u.status] || STATUS.disponivel;
        return `<tr data-acao="abrirUnidade" data-id="${esc(u.id)}" class="${G.mudaram.has(u.id) ? 'mudou' : ''}">
          <td><b>${esc(u.codigo)}</b></td><td>${esc(u.bloco || '—')}</td><td>${esc(rotuloPavimento(u.pavimento))}</td>
          <td>${esc(u.tipologia || '—')}</td><td class="n">${u.area_privativa ? num(u.area_privativa) + ' m²' : '—'}</td>
          <td class="n">${u.vagas ?? '—'}</td><td class="n">${G.preco[u.id] ? brl(G.preco[u.id]) : '—'}</td>
          <td><span class="dp-selo" style="--c:${st.cor};--f:${st.fundo};--t:${st.texto}">${st.rotulo}</span></td></tr>`;
      })
      .join('')}</tbody></table></div>`;
}

async function gerarFichas() {
  const r = await rpc('a1_unidades_materializar', { p_empreendimento: G.empId });
  if (!r.ok) {
    toast(motivo(r.erro), 'erro');
    return;
  }
  toast(`${r.criadas || 0} ficha(s) criada(s).`);
  await carregarUnidades();
  renderMapa();
}

// ─── A ficha ─────────────────────────────────────────────────────────────────
function unidadePorId(/** @type {string} */ id) {
  return G.unidades.find(u => u.id === id) || null;
}

async function abrirUnidadeDeOutroEmp(/** @type {string} */ id, /** @type {string} */ emp) {
  if (emp && emp !== G.empId) {
    location.href = `/${encodeURIComponent(G.slug)}/disposicao?emp=${encodeURIComponent(emp)}&unidade=${encodeURIComponent(id)}`;
    return;
  }
  location.href = `/${encodeURIComponent(G.slug)}/disposicao?unidade=${encodeURIComponent(id)}`;
}

function marcarNaPlanta(/** @type {string|null} */ id) {
  document.querySelectorAll('.un.sel').forEach(el => el.classList.remove('sel'));
  if (id) document.querySelector(`.un[data-id="${CSS.escape(id)}"]`)?.classList.add('sel');
}
function abrirFicha(/** @type {string} */ id) {
  if (!unidadePorId(id)) return;
  G.fichaId = id;
  marcarNaPlanta(id);
  $('dp-gaveta-fundo').hidden = false;
  document.body.classList.add('sem-rolagem');
  renderFicha(true);
}
function fecharFicha() {
  G.fichaId = null;
  marcarNaPlanta(null);
  $('dp-gaveta-fundo').hidden = true;
  document.body.classList.remove('sem-rolagem');
}

function linhaFicha(/** @type {string} */ rot, /** @type {any} */ val) {
  return val == null || val === ''
    ? ''
    : `<div class="dp-campo"><span>${esc(rot)}</span><b>${esc(val)}</b></div>`;
}

async function renderFicha(/** @type {boolean} */ comHistorico) {
  const u = unidadePorId(/** @type {string} */ (G.fichaId));
  if (!u) return fecharFicha();
  const st = STATUS[u.status] || STATUS.disponivel;
  const emp = G.empreendimentos.find(e => e.id === u.empreendimento_id);
  const p = G.preco[u.id];
  const rs = reservaAtivaDe(u.id);
  const precoM2 = p && u.area_privativa ? p / Number(u.area_privativa) : null;
  const vaga = [u.vagas != null ? `${u.vagas}` : '', u.vaga_tipo, u.vaga_identificacao]
    .filter(Boolean)
    .join(' · ');
  const btn = (/** @type {string} */ tipo, /** @type {string} */ rot, cls = 'dp-btn-g') =>
    `<button class="dp-btn ${cls}" data-acao="perguntar" data-tipo="${tipo}" data-id="${esc(u.id)}">${rot}</button>`;
  const aval = G.avaliacao[u.id];
  // Na regra "só pela pré-análise", reservar exige a Pré-análise e a permissão
  // de Iniciar venda. Sem as duas, o botão dá lugar à explicação.
  const barraPA =
    exigePA() && (G.temPreAnalise === false || !podeReservarPelaPA())
      ? G.temPreAnalise === false
        ? 'Nesta conta a reserva começa pela pré-análise, e a Pré-análise não está liberada.'
        : 'Nesta conta a reserva começa por uma pré-análise aprovada, e o seu cadastro não tem a permissão "Iniciar venda".'
      : '';
  const acoesHtml = [
    u.status === 'disponivel' && podeReservar() && !barraPA
      ? `<button class="dp-btn dp-btn-p dp-btn-l" data-acao="iniciarReserva" data-id="${esc(u.id)}"${p ? '' : ' disabled title="A unidade não tem preço no mapa de preço"'}>${
          G.pa && !G.pa.dados.motivo
            ? 'Reservar para ' + esc(nomeTitularPA() || 'o cliente da pré-análise')
            : 'Reservar esta unidade'
        }</button>`
      : '',
    u.status === 'disponivel' && podeReservar() && barraPA
      ? `<div class="dp-aviso">${esc(barraPA)}</div>`
      : '',
    podeGerir() && u.status === 'disponivel' ? btn('bloquear', 'Bloquear') : '',
    podeGerir() && u.status === 'disponivel' ? btn('vender', 'Marcar como vendida') : '',
    podeGerir() && u.status === 'bloqueado' ? btn('desbloquear', 'Desbloquear', 'dp-btn-p') : '',
    podeGerir() && u.status === 'reservado' ? btn('vender', 'Marcar como vendida') : '',
    podeGerir() && u.status === 'vendido' ? btn('distrato', 'Registrar distrato', 'dp-btn-r') : '',
    rs && podeCancelar(rs) ? btn('cancelar', 'Cancelar reserva', 'dp-btn-r') : '',
    rs && podeGerir() ? btn('prorrogar', 'Prorrogar') : ''
  ]
    .filter(Boolean)
    .join('');

  $('dp-gaveta').innerHTML = `
    <header class="dp-ficha-cab" style="--c:${st.cor};--f:${st.fundo};--t:${st.texto}">
      <div>
        <div class="dp-ficha-emp">${esc(emp ? emp.name : '')}${u.bloco ? ' · ' + esc(u.bloco) : ''}${u.pavimento != null ? ' · ' + esc(rotuloPavimento(u.pavimento)) : ''}</div>
        <h2 class="dp-ficha-tit" id="dp-ficha-titulo">${esc(u.codigo)}</h2>
        <span class="dp-selo">${st.rotulo}</span>${u.status === 'bloqueado' && u.bloqueado_ate ? `<span class="dp-ficha-ate">até ${esc(dataHoraBR(u.bloqueado_ate))}</span>` : ''}
      </div>
      <button class="dp-x" data-acao="fecharFicha" aria-label="Fechar">×</button>
    </header>
    <div class="dp-ficha-preco">
      <div><span>Valor de tabela</span><b>${p ? brl(p) : 'Sem preço no mapa'}</b></div>
      ${precoM2 ? `<div><span>Preço por m²</span><b>${brl(precoM2)}</b></div>` : ''}
      ${aval ? `<div><span>Avaliação</span><b>${brl(aval)}</b></div>` : ''}
    </div>
    ${u.status_motivo ? `<div class="dp-aviso">${esc(u.status === 'bloqueado' ? 'Bloqueada: ' : '')}${esc(u.status_motivo)}</div>` : ''}
    ${
      rs
        ? `<div class="dp-ficha-rs">
            <div class="dp-ficha-rs-tit">Reserva ${esc(rs.codigo)}</div>
            <div class="dp-ficha-rs-l"><span>Cliente</span><b>${esc((rs.cliente && rs.cliente.titular && rs.cliente.titular.nome) || '—')}</b></div>
            <div class="dp-ficha-rs-l"><span>Corretor</span><b>${esc(nomeCorretor(rs.corretor_id) || rs.criado_por_nome || '—')}</b></div>
            <div class="dp-ficha-rs-l"><span>Prazo</span><b>${rs.expira_em ? esc(prazo(rs.expira_em)) : 'sem vencimento'}</b></div>
            <div class="dp-ficha-rs-l"><span>Fluxo</span><b>${brl(rs.valor_fluxo)}</b></div>
            ${rs.pre_analise_id ? '<div class="dp-ficha-rs-l"><span>Origem</span><b>pré-análise aprovada</b></div>' : ''}
            ${
              rs.comercial_id
                ? `<button class="dp-link" data-acao="rsAbrirVenda" data-id="${esc(rs.comercial_id)}">Abrir a venda →</button>`
                : G.temComercial === true
                  ? `<div class="dp-aviso dp-aviso-a">Esta reserva ainda não tem venda na esteira de Vendas.</div>
                     ${podeAbrirVenda(rs) ? `<button class="dp-btn dp-btn-p" data-acao="abrirVendaDaReserva" data-id="${esc(rs.id)}">Abrir a venda agora</button>` : ''}`
                  : ''
            }
          </div>`
        : u.status === 'reservado'
          ? '<div class="dp-aviso">Reservada por outra pessoa. Os dados do cliente ficam com quem reservou e com o gestor.</div>'
          : ''
    }
    <div class="dp-ficha-acoes">${acoesHtml || '<span class="dp-mudo">Nenhuma ação disponível para o seu cadastro.</span>'}</div>
    <div class="dp-ficha-sec">Ficha</div>
    <div class="dp-campos">
      ${linhaFicha('Tipologia', u.tipologia)}
      ${linhaFicha('Área privativa', u.area_privativa != null ? num(u.area_privativa) + ' m²' : '')}
      ${linhaFicha('Área comum', u.area_comum != null ? num(u.area_comum) + ' m²' : '')}
      ${linhaFicha('Área total', u.area_total != null ? num(u.area_total) + ' m²' : '')}
      ${linhaFicha('Área de terreno', u.area_terreno != null ? num(u.area_terreno) + ' m²' : '')}
      ${linhaFicha('Fração ideal', u.fracao_ideal != null ? num(u.fracao_ideal, 8) : '')}
      ${linhaFicha('Quartos', u.quartos)}${linhaFicha('Suítes', u.suites)}${linhaFicha('Banheiros', u.banheiros)}
      ${linhaFicha('Vagas', vaga)}${linhaFicha('Depósito', u.deposito)}
      ${linhaFicha('Posição solar', u.posicao_solar)}${linhaFicha('Posição', u.posicao)}${linhaFicha('Vista', u.vista)}
      ${linhaFicha('Etapa', u.etapa)}${linhaFicha('Final', u.final)}${linhaFicha('Matrícula', u.matricula)}
    </div>
    ${u.descricao ? `<p class="dp-ficha-desc">${esc(u.descricao)}</p>` : ''}
    ${u.observacoes ? `<p class="dp-ficha-desc dp-mudo">${esc(u.observacoes)}</p>` : ''}
    <div class="dp-ficha-sec">Histórico</div>
    <ol class="dp-hist" id="dp-hist">${comHistorico ? '<li class="dp-mudo">carregando…</li>' : G.fichaHist || ''}</ol>`;

  if (comHistorico) {
    try {
      const ev = await carregar.eventos(u.id);
      G.fichaHist = ev.length ? ev.map(htmlEvento).join('') : '<li class="dp-mudo">Sem registros.</li>';
    } catch (e) {
      G.fichaHist = `<li class="dp-mudo">${esc(motivo(/** @type {any} */ (e).message))}</li>`;
    }
    const h = $('dp-hist');
    if (h && G.fichaId === u.id) h.innerHTML = G.fichaHist;
  }
}

const ROT_CAMPO = {
  codigo: 'código',
  area_privativa: 'área privativa',
  area_comum: 'área comum',
  area_total: 'área total',
  fracao_ideal: 'fração ideal',
  vaga_tipo: 'tipo de vaga',
  vaga_identificacao: 'vaga',
  posicao_solar: 'posição solar',
  observacoes: 'observações',
  descricao: 'descrição'
};
function htmlEvento(/** @type {any} */ e) {
  const d = e.detalhe || {};
  let txt = '';
  if (e.evento === 'CRIADA') txt = 'Ficha criada';
  else if (e.evento === 'EXCLUIDA') txt = 'Ficha excluída';
  else if (e.evento === 'STATUS')
    txt =
      `${(STATUS[e.de] || {}).rotulo || e.de || '—'} → <b>${(STATUS[e.para] || {}).rotulo || e.para}</b>` +
      (d.reserva_codigo ? ` · reserva ${esc(d.reserva_codigo)}` : '') +
      (d.cliente ? ` · ${esc(d.cliente)}` : '') +
      (d.distrato ? ' · distrato' : '') +
      (d.origem === 'venda' ? ' · pela venda' : '') +
      (d.motivo ? ` · “${esc(d.motivo)}”` : '');
  else if (e.evento === 'PRECO')
    txt = `Preço ${e.de ? brl(e.de) + ' → ' : ''}<b>${e.para ? brl(e.para) : 'removido'}</b>`;
  else if (e.evento === 'EDITADA')
    txt =
      'Ficha editada: ' +
      Object.keys(d.campos || {})
        .map(k => esc(/** @type {any} */ (ROT_CAMPO)[k] || k))
        .join(', ');
  else if (e.evento === 'RESERVA_PRORROGADA')
    txt = `Reserva ${esc(d.reserva_codigo || '')} prorrogada em ${esc(d.horas)}h`;
  else txt = esc(e.evento);
  return `<li><span class="dp-hist-q">${esc(dataHoraBR(e.criado_em))} · ${esc(e.ator_nome || 'sistema')}</span>${txt}</li>`;
}

function nomeCorretor(/** @type {string|null} */ id) {
  if (!id) return '';
  // Para parceiro, o id do login JÁ é o do cadastro de parceiro.
  if (G.user && G.user.role === 'partner' && G.user.id === id) return G.user.name;
  const c = G.corretores.find(x => x.id === id);
  return c ? c.name : '';
}
function podeCancelar(/** @type {any} */ rs) {
  if (podeGerir()) return true;
  const propria = G.config ? G.config.corretor_cancela_propria !== false : true;
  return (
    propria && podeReservar() && !!rs.corretor_id && G.user.role === 'partner' && rs.corretor_id === G.user.id
  );
}

// ─── Perguntas do gestor ─────────────────────────────────────────────────────
const PERGUNTAS = {
  bloquear: {
    titulo: 'Bloquear unidade',
    corpo: () => `<p>A unidade sai de venda até alguém desbloquear, ou até a data, se você informar uma.</p>
      <label class="dp-f"><span>Motivo *</span><textarea id="pg-motivo" rows="3" placeholder="Ex.: reservada para a obra, permuta, aguardando avaliação"></textarea></label>
      <label class="dp-f"><span>Liberar automaticamente em</span><input type="datetime-local" id="pg-ate"></label>`
  },
  desbloquear: {
    titulo: 'Desbloquear unidade',
    corpo: () => '<p>A unidade volta a ficar disponível para reserva.</p>'
  },
  vender: {
    titulo: 'Marcar como vendida',
    corpo:
      () => `<p>Use para a venda feita fora do sistema. Quando a venda nasce de uma reserva, ela mesma marca a unidade como vendida ao chegar na situação com o selo Vendido.</p>
      <label class="dp-f"><span>Observação</span><textarea id="pg-motivo" rows="2"></textarea></label>`
  },
  distrato: {
    titulo: 'Registrar distrato',
    corpo: () => `<p>A unidade volta a ficar disponível, e o distrato fica no histórico com o motivo.</p>
      <label class="dp-f"><span>Motivo *</span><textarea id="pg-motivo" rows="3"></textarea></label>`
  },
  cancelar: {
    titulo: 'Cancelar reserva',
    corpo:
      () => `<p>A unidade volta a ficar disponível. A venda aberta pela reserva, se houver, continua aberta, mas sem unidade garantida.</p>
      <label class="dp-f"><span>Motivo *</span><textarea id="pg-motivo" rows="3" placeholder="Ex.: cliente desistiu"></textarea></label>`
  },
  prorrogar: {
    titulo: 'Prorrogar reserva',
    corpo: () => `<label class="dp-f"><span>Mais quanto tempo</span><select id="pg-horas">
        <option value="24">24 horas</option><option value="48" selected>48 horas</option>
        <option value="72">72 horas</option><option value="168">7 dias</option></select></label>`
  }
};

function perguntar(/** @type {string} */ tipo, /** @type {string} */ unidadeId) {
  const def = /** @type {any} */ (PERGUNTAS)[tipo];
  if (!def) return;
  G.pergunta = { tipo, unidadeId };
  $('dp-pg-titulo').textContent = def.titulo;
  $('dp-pg-corpo').innerHTML = def.corpo();
  $('dp-pg-erro').hidden = true;
  $('dp-pergunta').hidden = false;
  /** @type {any} */ (document.querySelector('#dp-pg-corpo textarea, #dp-pg-corpo select'))?.focus();
}
function fecharPergunta() {
  G.pergunta = null;
  $('dp-pergunta').hidden = true;
}

async function confirmarPergunta() {
  const q = G.pergunta;
  if (!q) return;
  const u = unidadePorId(q.unidadeId);
  const motivoTxt = /** @type {any} */ ($('pg-motivo')?.value || '').trim();
  const rs = u ? reservaAtivaDe(u.id) : null;
  // O banco recusa sem motivo (motivo_obrigatorio); perguntar antes poupa a
  // ida e volta e diz o que falta no lugar certo.
  if (!motivoTxt && ['bloquear', 'distrato', 'cancelar'].includes(q.tipo)) {
    const e = $('dp-pg-erro');
    e.textContent = 'Informe o motivo.';
    e.hidden = false;
    return;
  }
  let r;
  const btn = /** @type {any} */ ($('dp-pg-ok'));
  btn.disabled = true;
  try {
    if (q.tipo === 'cancelar') {
      r = await rpc('a1_reserva_cancelar', { p_reserva: rs && rs.id, p_motivo: motivoTxt });
    } else if (q.tipo === 'prorrogar') {
      r = await rpc('a1_reserva_prorrogar', {
        p_reserva: rs && rs.id,
        p_horas: Number(/** @type {any} */ ($('pg-horas')).value)
      });
    } else {
      const para = {
        bloquear: 'bloqueado',
        desbloquear: 'disponivel',
        vender: 'vendido',
        distrato: 'disponivel'
      }[/** @type {'bloquear'} */ (q.tipo)];
      const ate = /** @type {any} */ ($('pg-ate'))?.value;
      r = await rpc('a1_unidade_definir_status', {
        p_unidade: q.unidadeId,
        p_status: para,
        p_motivo: motivoTxt || null,
        p_versao_esperada: u ? u.versao : null,
        p_bloqueado_ate: ate ? new Date(ate).toISOString() : null
      });
    }
  } finally {
    btn.disabled = false;
  }
  if (!r || !r.ok) {
    const e = $('dp-pg-erro');
    e.textContent = motivo(r && r.erro);
    e.hidden = false;
    return;
  }
  fecharPergunta();
  toast('Feito. A unidade e o histórico foram atualizados.');
  await atualizarTudo();
}

async function atualizarTudo() {
  const [reservas] = await Promise.all([carregar.reservas(), carregarUnidades()]);
  G.reservas = reservas;
  if (G.vista === 'mapa') {
    renderMapa();
    if (G.fichaId) renderFicha(true);
  } else if (G.vista === 'reservas') renderReservas();
}

// ─── Reserva: três passos ────────────────────────────────────────────────────
const ESTADOS_CIVIS = ['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Viúvo(a)'];
const PARENTESCOS = [
  'Cônjuge/companheiro(a)',
  'Pai',
  'Mãe',
  'Filho(a)',
  'Irmão(ã)',
  'Avô/Avó',
  'Tio(a)',
  'Outro'
];
const comConjuge = (/** @type {string} */ ec) => ec === 'Casado(a)' || ec === 'União estável';

// O que a reserva aproveita da pré-análise: as pessoas (o cônjuge é o
// associado com parentesco de cônjuge), o corretor e o crédito aprovado, que
// vira as linhas de financiamento, FGTS e subsídio do fluxo.
function aplicarPA(/** @type {any} */ d) {
  const rs = G.rs;
  rs.pa_id = d.id;
  rs.pa = d;
  const pessoas = d.pessoas || [];
  const ehConjuge = (/** @type {any} */ p) => /c[oô]njuge|companheir/i.test(p.parentesco || '');
  const tit = pessoas.find((/** @type {any} */ p) => p.papel === 'TITULAR') || {};
  const conj = pessoas.find((/** @type {any} */ p) => p.papel !== 'TITULAR' && ehConjuge(p)) || null;
  const pessoa = (/** @type {any} */ p) => ({
    nome: p.nome || '',
    cpf: cpfComMascara(p.cpf),
    nascimento: p.nascimento ? String(p.nascimento).slice(0, 10) : '',
    telefone: p.telefone || '',
    email: p.email || '',
    renda: Number(p.renda) > 0 ? Number(p.renda) : null
  });
  let ec = ESTADOS_CIVIS.includes(tit.estado_civil) ? tit.estado_civil : conj ? 'Casado(a)' : 'Solteiro(a)';
  const outros = pessoas.filter((/** @type {any} */ p) => p.papel !== 'TITULAR' && p !== conj);
  // Cônjuge informado com o titular marcado como solteiro: vira associado,
  // para nada se perder sem o corretor ver.
  if (conj && !comConjuge(ec)) outros.unshift(conj);
  rs.cliente = {
    titular: { ...pessoa(tit), estado_civil: ec },
    conjuge: conj && comConjuge(ec) ? pessoa(conj) : {},
    associados: outros.map((/** @type {any} */ p) => ({
      ...pessoa(p),
      parentesco:
        PARENTESCOS.find(x => x.toLowerCase() === String(p.parentesco || '').toLowerCase()) ||
        (ehConjuge(p) ? 'Cônjuge/companheiro(a)' : 'Outro')
    }))
  };
  if (d.corretor_id) rs.corretor_id = d.corretor_id;
  const cr = d.credito;
  const porSerie = (/** @type {string} */ s) => G.parametros.find(p => p.serie === s);
  const linhas = /** @type {any[]} */ ([]);
  // O crédito sem parâmetro da mesma série no cliente não pode entrar no fluxo
  // sozinho, e também não pode sumir calado: o passo do fluxo avisa.
  rs.paSemParametro = /** @type {{rotulo:string, valor:number}[]} */ ([]);
  if (cr)
    /** @type {[string, string, any][]} */ ([
      ['FINANCIAMENTO', 'Financiamento', cr.financiamento],
      ['FGTS', 'FGTS', cr.fgts],
      ['SUBSIDIO', 'Subsídio', cr.subsidio]
    ]).forEach(([serie, rotulo, v]) => {
      if (!(Number(v) > 0)) return;
      const p = porSerie(serie);
      if (p) linhas.push({ parametro_id: p.id, quantidade: 1, valor: Number(v), primeiro_vencimento: '' });
      else rs.paSemParametro.push({ rotulo, valor: Number(v) });
    });
  if (linhas.length) {
    const ato = porSerie('ATO') || G.parametros.find(p => p.quem_paga === 'CLIENTE');
    rs.fluxo = [
      ...(ato ? [{ parametro_id: ato.id, quantidade: 1, valor: null, primeiro_vencimento: '' }] : []),
      ...linhas
    ];
  }
}
function cpfComMascara(/** @type {any} */ c) {
  const d = String(c || '').replace(/\D/g, '');
  return d.length === 11
    ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
    : String(c || '');
}
function nomeTitularPA() {
  const tit = G.pa && (G.pa.dados.pessoas || []).find((/** @type {any} */ p) => p.papel === 'TITULAR');
  return tit ? tit.nome : '';
}

// Escolher (ou trocar) a pré-análise no passo do cliente.
async function escolherPA(/** @type {string} */ id) {
  if (!G.rs) return;
  lerPassoCliente();
  if (!id) {
    G.rs.pa_id = null;
    G.rs.pa = null;
    renderPassoCliente(false);
    return;
  }
  const d = await preAnalise.dados(id);
  if (!d || !d.id) {
    mostrarErroRs(motivo(d && d.erro));
    renderPassoCliente(false);
    return;
  }
  if (d.motivo) {
    mostrarErroRs(motivo(d.motivo));
    renderPassoCliente(false);
    return;
  }
  if (d.empreendimento_id !== G.rs.un.empreendimento_id) {
    mostrarErroRs(motivo('pre_analise_de_outro_empreendimento'));
    renderPassoCliente(false);
    return;
  }
  $('dp-rs-erro').hidden = true;
  aplicarPA(d);
  renderPassoCliente(false);
}

function htmlSecaoPA() {
  const rs = G.rs;
  const obrigatoria = exigePA();
  if (G.temPreAnalise !== true || !podeReservarPelaPA()) return '';
  const lista = (G.paLista || []).filter(x => x.empreendimento_id === rs.un.empreendimento_id);
  const atual = rs.pa;
  const opcoes = [...lista];
  if (atual && !opcoes.some(x => x.id === atual.id))
    opcoes.unshift({ id: atual.id, codigo: atual.codigo, titular: nomeTitularPA() });
  const cr = atual && atual.credito;
  return `<div class="dp-rs-sec">Pré-análise${obrigatoria ? ' *' : ''}</div>
    <div class="dp-pa-escolha${atual ? ' on' : ''}">
      <label class="dp-f"><span>${obrigatoria ? 'Pré-análise aprovada do cliente' : 'Vincular a uma pré-análise aprovada (opcional)'}</span>
        <select id="rs-pa" data-acao-change="rsEscolherPA">
          <option value="">${opcoes.length ? 'Escolha…' : G.paCarregando ? 'Carregando…' : 'Nenhuma pré-análise aprovada deste empreendimento'}</option>
          ${opcoes
            .map(
              x =>
                `<option value="${esc(x.id)}"${atual && x.id === atual.id ? ' selected' : ''}>${esc(x.codigo || 'Pré-análise')}${x.titular ? ' · ' + esc(x.titular) : ''}${x.unidade ? ' · interesse ' + esc(x.unidade) : ''}</option>`
            )
            .join('')}
        </select></label>
      ${
        atual
          ? `<p class="dp-p">Dados do titular, do cônjuge e dos associados vieram da pré-análise${cr ? `; o crédito aprovado (financiamento ${brl(cr.financiamento)}${Number(cr.fgts) ? `, FGTS ${brl(cr.fgts)}` : ''}${Number(cr.subsidio) ? `, subsídio ${brl(cr.subsidio)}` : ''}) já está no fluxo` : ''}. Confira e ajuste o que precisar.</p>`
          : obrigatoria
            ? '<p class="dp-p dp-mudo">Nesta conta a reserva começa por uma pré-análise aprovada (selo Fim positivo), sem venda aberta.</p>'
            : ''
      }
    </div>`;
}

function linhaNova() {
  const usados = new Set((G.rs ? G.rs.fluxo : []).map((/** @type {any} */ l) => l.parametro_id));
  const p = G.parametros.find(x => !usados.has(x.id)) || G.parametros[0];
  return { parametro_id: p ? p.id : '', quantidade: 1, valor: null, primeiro_vencimento: '' };
}

function iniciarReserva(/** @type {string} */ id) {
  const u = unidadePorId(id);
  if (!u) return;
  if (!G.parametros.length) {
    toast('Cadastre os parâmetros de pagamento em Configurações antes de reservar.', 'erro');
    return;
  }
  const daPA = G.pa && !G.pa.dados.motivo ? G.pa.dados : null;
  if (daPA && daPA.empreendimento_id !== u.empreendimento_id) {
    toast('A pré-análise é de outro empreendimento. Escolha uma unidade do empreendimento dela.', 'erro');
    return;
  }
  G.rs = {
    un: u,
    versao: u.versao,
    preco: G.preco[u.id] || 0,
    passo: 1,
    cliente: { titular: { estado_civil: 'Solteiro(a)' }, conjuge: {}, associados: [] },
    fluxo: [],
    corretor_id: '',
    observacao: '',
    cronograma: false,
    feito: null,
    pa_id: null,
    pa: null
  };
  G.rs.fluxo.push(linhaNova());
  if (daPA) aplicarPA(daPA);
  // A lista das pré-análises prontas é lida uma vez, quando alguém pode usá-la.
  if (G.paLista === null && G.temPreAnalise === true && podeReservarPelaPA()) {
    G.paLista = [];
    G.paCarregando = true;
    preAnalise
      .aprovadas()
      .then(l => (G.paLista = l))
      .finally(() => {
        G.paCarregando = false;
        if (G.rs && G.rs.passo === 1 && !G.rs.feito) renderPassoCliente(true);
      });
  }
  const emp = G.empreendimentos.find(e => e.id === u.empreendimento_id);
  $('dp-rs-sub').textContent = `${emp ? emp.name + ' · ' : ''}${u.codigo} · ${brl(G.rs.preco)}`;
  $('dp-reserva').hidden = false;
  irParaPasso(1);
}
function fecharReserva() {
  G.rs = null;
  $('dp-reserva').hidden = true;
}

function irParaPasso(/** @type {number} */ n) {
  if (!G.rs || G.rs.feito) return;
  // Avançar só com o passo atual válido; voltar, sempre.
  if (n > G.rs.passo) {
    if (G.rs.passo === 1) {
      lerPassoCliente();
      const e = validarCliente();
      if (e) return mostrarErroRs(e);
    }
    if (G.rs.passo === 2 || n === 3) {
      if (G.rs.passo === 2) lerFluxo();
      const e = validarFluxo();
      if (e) return mostrarErroRs(e);
    }
  } else if (G.rs.passo === 1) lerPassoCliente();
  else if (G.rs.passo === 2) lerFluxo();
  G.rs.passo = n;
  $('dp-rs-erro').hidden = true;
  document.querySelectorAll('#dp-passos li').forEach(li => {
    const p = Number(/** @type {any} */ (li).dataset.passo);
    li.className = p === n ? 'on' : p < n ? 'feito' : '';
  });
  if (n === 1) renderPassoCliente(false);
  if (n === 2) renderPassoFluxo();
  if (n === 3) renderPassoConferir();
}
function mostrarErroRs(/** @type {string} */ msg) {
  const e = $('dp-rs-erro');
  e.textContent = msg;
  e.hidden = false;
}

// ── Passo 1: cliente ──
function campo(
  /** @type {string} */ id,
  /** @type {string} */ rot,
  /** @type {any} */ val,
  extra = '',
  tipo = 'text'
) {
  return `<label class="dp-f"><span>${rot}</span><input type="${tipo}" id="${id}" value="${esc(val ?? '')}" ${extra}></label>`;
}
function selectDe(
  /** @type {string} */ id,
  /** @type {string} */ rot,
  /** @type {string[]} */ ops,
  /** @type {any} */ val,
  extra = ''
) {
  return `<label class="dp-f"><span>${rot}</span><select id="${id}" ${extra}>${ops
    .map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`)
    .join('')}</select></label>`;
}
function blocoPessoa(/** @type {string} */ pre, /** @type {any} */ p, /** @type {boolean} */ obrigatorio) {
  const o = obrigatorio ? ' *' : '';
  return `<div class="dp-fgrid">
    ${campo(pre + '-nome', 'Nome completo' + o, p.nome, 'autocomplete="off"')}
    ${campo(pre + '-cpf', 'CPF' + o, p.cpf, 'inputmode="numeric" placeholder="000.000.000-00"')}
    ${campo(pre + '-nasc', 'Nascimento', p.nascimento, '', 'date')}
    ${campo(pre + '-tel', 'Telefone', p.telefone, 'inputmode="tel"')}
    ${campo(pre + '-email', 'E-mail', p.email, '', 'email')}
    ${campo(pre + '-prof', 'Profissão', p.profissao)}
    ${selectDe(pre + '-tipo-renda', 'Tipo de renda', ['Formal', 'Informal', 'Formal e informal'], p.tipo_renda || 'Formal')}
    ${campo(pre + '-renda', 'Renda mensal (R$)', p.renda != null ? String(p.renda).replace('.', ',') : '', 'inputmode="decimal"')}
  </div>`;
}

function renderPassoCliente(/** @type {boolean} */ lerAntes) {
  if (lerAntes) lerPassoCliente();
  const c = G.rs.cliente;
  const ec = c.titular.estado_civil || 'Solteiro(a)';
  $('dp-rs-corpo').innerHTML = `
    ${htmlSecaoPA()}
    <div class="dp-rs-sec">Titular</div>
    ${blocoPessoa('t', c.titular, true)}
    <div class="dp-fgrid">
      ${selectDe('t-ec', 'Estado civil', ESTADOS_CIVIS, ec, 'data-acao-change="rsEstadoCivil"')}
      ${ec === 'Casado(a)' ? selectDe('t-regime', 'Regime de bens', ['Comunhão parcial', 'Comunhão universal', 'Separação total', 'Participação final nos aquestos'], c.titular.regime || 'Comunhão parcial') : ''}
    </div>
    ${comConjuge(ec) ? `<div class="dp-rs-sec">${ec === 'União estável' ? 'Companheiro(a)' : 'Cônjuge'}</div>${blocoPessoa('c', c.conjuge || {}, true)}` : ''}
    <div class="dp-rs-sec">Segundo proponente e associados
      <button class="dp-link" data-acao="rsAddAssociado">+ Adicionar</button></div>
    ${c.associados.length ? '' : '<p class="dp-mudo dp-p">Quem compõe renda com o titular: pai, mãe, irmão, filho…</p>'}
    ${c.associados
      .map(
        (/** @type {any} */ a, /** @type {number} */ i) => `<div class="dp-assoc">
          <div class="dp-assoc-cab">Associado ${i + 1}
            <button class="dp-link dp-link-r" data-acao="rsTirarAssociado" data-i="${i}">remover</button></div>
          <div class="dp-fgrid">${selectDe(`a${i}-par`, 'Parentesco', PARENTESCOS, a.parentesco || 'Outro')}</div>
          ${blocoPessoa('a' + i, a, true)}
        </div>`
      )
      .join('')}
    ${
      ehGestor() && G.corretores.length
        ? `<div class="dp-rs-sec">Corretor da reserva</div>
           <div class="dp-fgrid"><label class="dp-f"><span>Em nome de</span><select id="rs-corretor">
             <option value="">Sem corretor (venda direta)</option>
             ${G.corretores
               .filter(x => x.is_active !== false)
               .map(
                 x =>
                   `<option value="${esc(x.id)}"${x.id === G.rs.corretor_id ? ' selected' : ''}>${esc(x.name)}</option>`
               )
               .join('')}
           </select></label></div>`
        : ''
    }`;
  $('dp-rs-pe').innerHTML =
    `<span></span><button class="dp-btn dp-btn-p" data-acao="rsPasso" data-passo="2">Continuar para o fluxo →</button>`;
}

function lerPessoa(/** @type {string} */ pre) {
  const v = (/** @type {string} */ id) => /** @type {any} */ ($(pre + '-' + id)?.value ?? '').trim();
  const renda = paraNumero(v('renda'));
  return {
    nome: v('nome'),
    cpf: v('cpf'),
    nascimento: v('nasc') || null,
    telefone: v('tel'),
    email: v('email'),
    profissao: v('prof'),
    tipo_renda: v('tipo-renda'),
    renda
  };
}
function lerPassoCliente() {
  if (!G.rs || !$('t-nome')) return;
  const c = G.rs.cliente;
  const ec = /** @type {any} */ ($('t-ec'))?.value || c.titular.estado_civil;
  c.titular = {
    ...lerPessoa('t'),
    estado_civil: ec,
    regime: /** @type {any} */ ($('t-regime'))?.value || null
  };
  if ($('c-nome')) c.conjuge = lerPessoa('c');
  c.associados = c.associados.map((/** @type {any} */ a, /** @type {number} */ i) =>
    $(`a${i}-nome`) ? { ...lerPessoa('a' + i), parentesco: /** @type {any} */ ($(`a${i}-par`)).value } : a
  );
  const cor = /** @type {any} */ ($('rs-corretor'));
  if (cor) G.rs.corretor_id = cor.value;
}

// Dígito verificador do CPF: pega o erro de digitação antes de ele virar
// cadastro. O banco confere só os 11 dígitos.
export function cpfValido(/** @type {string} */ s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (/** @type {number} */ n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function validarCliente() {
  const c = G.rs.cliente;
  if (exigePA() && !G.rs.pa_id)
    return 'Escolha a pré-análise aprovada do cliente: nesta conta a reserva começa por ela.';
  if (!c.titular.nome) return 'Informe o nome do titular.';
  if (!cpfValido(c.titular.cpf)) return 'O CPF do titular não confere. Verifique os dígitos.';
  if (comConjuge(c.titular.estado_civil)) {
    if (!c.conjuge || !c.conjuge.nome) return 'Informe o nome do cônjuge ou companheiro(a).';
    if (!cpfValido(c.conjuge.cpf)) return 'O CPF do cônjuge não confere.';
  }
  for (const [i, a] of c.associados.entries()) {
    if (!a.nome) return `Informe o nome do associado ${i + 1}, ou remova-o.`;
    if (!cpfValido(a.cpf)) return `O CPF do associado ${i + 1} não confere.`;
  }
  return '';
}

// ── Passo 2: fluxo ──
function parametroDe(/** @type {string} */ id) {
  return G.parametros.find(p => p.id === id) || null;
}
function totalFluxo() {
  return G.rs.fluxo.reduce(
    (/** @type {number} */ s, /** @type {any} */ l) =>
      s + (Number(l.valor) || 0) * (Number(l.quantidade) || 0),
    0
  );
}
const centavos = (/** @type {number} */ n) => Math.round(n * 100) / 100;

function renderPassoFluxo() {
  const rs = G.rs;
  const total = centavos(totalFluxo());
  const dif = centavos(rs.preco - total);
  const fecha = Math.abs(dif) < 0.01;
  const exige = !G.config || G.config.exige_fluxo_fechado !== false;
  const proprio = rs.fluxo
    .filter((/** @type {any} */ l) => (parametroDe(l.parametro_id) || {}).quem_paga === 'CLIENTE')
    .reduce(
      (/** @type {number} */ s, /** @type {any} */ l) =>
        s + (Number(l.valor) || 0) * (Number(l.quantidade) || 0),
      0
    );
  const cores = ['#0E8C7F', '#3F6F9E', '#C87E12', '#6B4FA8', '#B8433A', '#12665C', '#345C84', '#9A6008'];
  $('dp-rs-corpo').innerHTML = `
    <div class="dp-fluxo-topo">
      <div><span>Valor da unidade</span><b>${brl(rs.preco)}</b></div>
      <div><span>Soma do fluxo</span><b>${brl(total)}</b></div>
      <div class="${fecha ? 'ok' : 'falta'}"><span>${fecha ? 'Fechado' : dif > 0 ? 'Falta' : 'Passou'}</span><b>${fecha ? '✓' : brl(Math.abs(dif))}</b></div>
      <div><span>Recurso próprio</span><b>${brl(proprio)}</b></div>
    </div>
    ${
      rs.pa_id && rs.paSemParametro && rs.paSemParametro.length
        ? `<div class="dp-aviso dp-aviso-a">A pré-análise aprovou ${rs.paSemParametro
            .map((/** @type {any} */ x) => `${esc(x.rotulo)} de ${brl(x.valor)}`)
            .join(
              ' e '
            )}, mas este cliente não tem parâmetro de pagamento dessa série. Lance o valor por outro
            parâmetro, ou cadastre-o em Configurações › Parâmetros de pagamento.</div>`
        : ''
    }
    <div class="dp-fluxo-barra" aria-hidden="true">${rs.fluxo
      .map((/** @type {any} */ l, /** @type {number} */ i) => {
        const v = (Number(l.valor) || 0) * (Number(l.quantidade) || 0);
        return v > 0 ? `<i style="flex:${v};background:${cores[i % cores.length]}"></i>` : '';
      })
      .join('')}${dif > 0.01 ? `<i class="vazio" style="flex:${dif}"></i>` : ''}</div>
    <table class="dp-fluxo">
      <thead><tr><th>Parâmetro</th><th class="n">Parcelas</th><th class="n">Valor da parcela</th><th>1º vencimento</th><th class="n">Total</th><th></th></tr></thead>
      <tbody>${rs.fluxo
        .map((/** @type {any} */ l, /** @type {number} */ i) => {
          const p = parametroDe(l.parametro_id);
          const unica = p && p.parcelas_max <= 1;
          const tot = (Number(l.valor) || 0) * (Number(l.quantidade) || 0);
          return `<tr>
            <td><i class="dp-cor" style="background:${cores[i % cores.length]}"></i>
              <select id="fx-${i}-par" data-acao-change="rsLinhaMudou" aria-label="Parâmetro">${G.parametros
                .map(
                  x =>
                    `<option value="${esc(x.id)}"${x.id === l.parametro_id ? ' selected' : ''}>${esc(x.nome)}</option>`
                )
                .join('')}</select>
              ${p ? `<small>${esc(PERIODICIDADE(p.periodicidade_meses))}${p.parcelas_max > 1 ? ` · ${p.parcelas_min} a ${p.parcelas_max}` : ''}${p.valor_minimo ? ` · mín. ${brl(p.valor_minimo)}` : ''}</small>` : ''}</td>
            <td class="n"><input id="fx-${i}-qtd" type="number" min="${p ? p.parcelas_min : 1}" max="${p ? p.parcelas_max : 1}"
              value="${esc(l.quantidade)}" ${unica ? 'disabled' : ''} data-acao-change="rsLinhaMudou" aria-label="Parcelas"></td>
            <td class="n"><input id="fx-${i}-val" inputmode="decimal" value="${l.valor != null && isFinite(Number(l.valor)) ? esc(Number(l.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : ''}"
              placeholder="0,00" data-acao-change="rsLinhaMudou" aria-label="Valor da parcela"></td>
            <td>${p && p.exige_vencimento ? `<input id="fx-${i}-venc" type="date" value="${esc(l.primeiro_vencimento || '')}" data-acao-change="rsLinhaMudou" aria-label="Primeiro vencimento">` : '<span class="dp-mudo">no repasse</span>'}</td>
            <td class="n"><b>${brl(tot)}</b>${!fecha ? `<button class="dp-link" data-acao="rsCompletar" data-i="${i}" title="Ajusta esta linha para o fluxo fechar">ajustar</button>` : ''}</td>
            <td>${rs.fluxo.length > 1 ? `<button class="dp-x dp-x-p" data-acao="rsTirarLinha" data-i="${i}" aria-label="Tirar linha">×</button>` : ''}</td>
          </tr>`;
        })
        .join('')}</tbody>
    </table>
    <div class="dp-fluxo-pe">
      <button class="dp-link" data-acao="rsAddLinha">+ Adicionar parcela</button>
      <button class="dp-link" data-acao="rsCronograma">${rs.cronograma ? 'Esconder' : 'Ver'} o cronograma</button>
    </div>
    ${rs.cronograma ? htmlCronograma() : ''}
    ${!fecha && exige ? '<p class="dp-mudo dp-p">A reserva só passa com o fluxo fechado no valor da unidade.</p>' : ''}`;
  $('dp-rs-pe').innerHTML =
    `<button class="dp-btn dp-btn-g" data-acao="rsPasso" data-passo="1">← Cliente</button>
    <button class="dp-btn dp-btn-p" data-acao="rsPasso" data-passo="3">Conferir →</button>`;
}

function htmlCronograma() {
  const datas = [];
  for (const l of G.rs.fluxo) {
    const p = parametroDe(l.parametro_id);
    if (!p) continue;
    if (!p.exige_vencimento || !l.primeiro_vencimento) {
      datas.push({ d: '', nome: p.nome, v: (Number(l.valor) || 0) * (Number(l.quantidade) || 1) });
      continue;
    }
    vencimentos(l.primeiro_vencimento, Number(l.quantidade) || 1, p.periodicidade_meses).forEach(
      (d, i, arr) =>
        datas.push({
          d,
          nome: arr.length > 1 ? `${p.nome} ${i + 1}/${arr.length}` : p.nome,
          v: Number(l.valor) || 0
        })
    );
  }
  datas.sort((a, b) => (a.d || '9999').localeCompare(b.d || '9999'));
  const mostra = datas.slice(0, 120);
  return `<div class="dp-crono"><table class="dp-tabela dp-tabela-p"><thead><tr><th>Vencimento</th><th>Parcela</th><th class="n">Valor</th></tr></thead>
    <tbody>${mostra.map(x => `<tr><td>${x.d ? dataBR(x.d) : 'no repasse'}</td><td>${esc(x.nome)}</td><td class="n">${brl(x.v)}</td></tr>`).join('')}</tbody></table>
    ${datas.length > mostra.length ? `<p class="dp-mudo dp-p">… e mais ${datas.length - mostra.length} parcelas.</p>` : ''}</div>`;
}

function lerFluxo() {
  if (!G.rs || !$('fx-0-par')) return;
  G.rs.fluxo = G.rs.fluxo.map((/** @type {any} */ l, /** @type {number} */ i) => {
    const par = /** @type {any} */ ($(`fx-${i}-par`))?.value || l.parametro_id;
    const p = parametroDe(par);
    let qtd = Number(/** @type {any} */ ($(`fx-${i}-qtd`))?.value) || 1;
    if (p) qtd = Math.min(Math.max(qtd, p.parcelas_min), p.parcelas_max);
    return {
      parametro_id: par,
      quantidade: qtd,
      valor: paraNumero(/** @type {any} */ ($(`fx-${i}-val`))?.value),
      primeiro_vencimento: /** @type {any} */ ($(`fx-${i}-venc`))?.value || ''
    };
  });
}

function completarLinha(/** @type {number} */ i) {
  lerFluxo();
  const l = G.rs.fluxo[i];
  const outros = totalFluxo() - (Number(l.valor) || 0) * (Number(l.quantidade) || 0);
  const resto = centavos(G.rs.preco - outros);
  if (resto <= 0) {
    mostrarErroRs('As outras parcelas já passam do valor da unidade. Reduza alguma antes.');
    return;
  }
  // Divide pela quantidade e joga o arredondamento para a conta: centavo que
  // sobra de 100.000 em 3 vezes é o motivo do "falta R$ 0,01".
  const q = Number(l.quantidade) || 1;
  l.valor = Math.floor((resto / q) * 100) / 100;
  if (Math.abs(centavos(l.valor * q) - resto) >= 0.01 && q > 1) {
    mostrarErroRs(
      `${brl(resto)} não divide igual em ${q} parcelas; ajustei para ${brl(l.valor)} cada. Feche o centavo no ato ou no sinal.`
    );
  } else $('dp-rs-erro').hidden = true;
  renderPassoFluxo();
}

function validarFluxo() {
  const rs = G.rs;
  if (!rs.fluxo.length) return 'Monte o fluxo de pagamento.';
  for (const l of rs.fluxo) {
    const p = parametroDe(l.parametro_id);
    if (!p) return 'Escolha o parâmetro de cada parcela.';
    if (!(Number(l.valor) > 0)) return `Informe o valor de ${p.nome}.`;
    if (p.valor_minimo && Number(l.valor) < Number(p.valor_minimo))
      return `${p.nome}: a parcela mínima é ${brl(p.valor_minimo)}.`;
    if (l.quantidade < p.parcelas_min || l.quantidade > p.parcelas_max)
      return `${p.nome}: de ${p.parcelas_min} a ${p.parcelas_max} parcelas.`;
    if (p.exige_vencimento && !l.primeiro_vencimento) return `${p.nome}: informe o primeiro vencimento.`;
  }
  const exige = !G.config || G.config.exige_fluxo_fechado !== false;
  if (exige && Math.abs(centavos(rs.preco - totalFluxo())) >= 0.01)
    return `A soma do fluxo (${brl(totalFluxo())}) precisa fechar no valor da unidade (${brl(rs.preco)}).`;
  return '';
}

// ── Passo 3: conferir ──
function renderPassoConferir() {
  const rs = G.rs;
  const c = rs.cliente;
  const horas = G.config ? G.config.reserva_horas : 48;
  const pessoas = [
    { papel: 'Titular', ...c.titular },
    ...(comConjuge(c.titular.estado_civil) && c.conjuge && c.conjuge.nome
      ? [{ papel: c.titular.estado_civil === 'União estável' ? 'Companheiro(a)' : 'Cônjuge', ...c.conjuge }]
      : []),
    ...c.associados.map((/** @type {any} */ a) => ({ papel: a.parentesco || 'Associado', ...a }))
  ];
  const renda = pessoas.reduce((s, p) => s + (Number(p.renda) || 0), 0);
  $('dp-rs-corpo').innerHTML = `
    <div class="dp-conf">
      <div class="dp-conf-bloco">
        <div class="dp-rs-sec">Unidade</div>
        <div class="dp-conf-un">${esc(rs.un.codigo)}<small>${esc(rs.un.tipologia || '')}</small></div>
        <div class="dp-conf-l"><span>Valor</span><b>${brl(rs.preco)}</b></div>
        <div class="dp-conf-l"><span>Prazo da reserva</span><b>${horas ? `${horas} horas` : 'não vence'}</b></div>
      </div>
      <div class="dp-conf-bloco">
        <div class="dp-rs-sec">Compradores</div>
        ${pessoas.map(p => `<div class="dp-conf-l"><span>${esc(p.papel)}</span><b>${esc(p.nome)} · ${esc(p.cpf)}</b></div>`).join('')}
        <div class="dp-conf-l"><span>Renda somada</span><b>${brl(renda)}</b></div>
      </div>
    </div>
    <div class="dp-rs-sec">Fluxo</div>
    <table class="dp-tabela dp-tabela-p"><tbody>${rs.fluxo
      .map((/** @type {any} */ l) => {
        const p = parametroDe(l.parametro_id) || {};
        return `<tr><td>${esc(p.nome)}</td><td class="n">${l.quantidade}× ${brl(l.valor)}</td>
          <td>${l.primeiro_vencimento ? 'a partir de ' + dataBR(l.primeiro_vencimento) : ''}</td><td class="n"><b>${brl(l.valor * l.quantidade)}</b></td></tr>`;
      })
      .join(
        ''
      )}<tr class="dp-tot"><td colspan="3">Total</td><td class="n">${brl(totalFluxo())}</td></tr></tbody></table>
    <label class="dp-f"><span>Observação</span><textarea id="rs-obs" rows="2" placeholder="Opcional">${esc(rs.observacao)}</textarea></label>`;
  $('dp-rs-pe').innerHTML =
    `<button class="dp-btn dp-btn-g" data-acao="rsPasso" data-passo="2">← Fluxo</button>
    <button class="dp-btn dp-btn-p" id="rs-ok" data-acao="rsConfirmar">Reservar unidade</button>`;
}

async function confirmarReserva() {
  const rs = G.rs;
  if (!rs || rs.feito) return;
  rs.observacao = /** @type {any} */ ($('rs-obs'))?.value || '';
  const btn = /** @type {any} */ ($('rs-ok'));
  btn.disabled = true;
  btn.textContent = 'Reservando…';
  const c = rs.cliente;
  // CPF vai só com dígitos: é como a venda e a busca por CPF comparam. A
  // máscara é da tela, não do dado.
  const limpo = (/** @type {any} */ x) => (x ? { ...x, cpf: String(x.cpf || '').replace(/\D/g, '') } : x);
  const cliente = {
    titular: limpo(c.titular),
    conjuge: comConjuge(c.titular.estado_civil) ? limpo(c.conjuge) : null,
    associados: (c.associados || []).map(limpo)
  };
  const r = await rpc('a1_unidade_reservar', {
    p_unidade: rs.un.id,
    p_cliente: cliente,
    p_fluxo: rs.fluxo.map((/** @type {any} */ l) => ({
      parametro_id: l.parametro_id,
      quantidade: l.quantidade,
      valor: l.valor,
      primeiro_vencimento: l.primeiro_vencimento || null
    })),
    p_versao_esperada: rs.versao,
    p_corretor: rs.corretor_id || null,
    p_observacao: rs.observacao || null,
    p_pre_analise: rs.pa_id || null
  });
  if (!r.ok) {
    btn.disabled = false;
    btn.textContent = 'Reservar unidade';
    mostrarErroRs(motivo(r.erro));
    // Quem perdeu a corrida precisa ver a planta como ela está agora.
    if (/unidade_|versao/.test(String(r.erro))) atualizarTudo();
    return;
  }
  rs.feito = r;
  // A pré-análise foi usada: a faixa sai e o endereço deixa de apontar para ela.
  if (rs.pa_id && G.pa && G.pa.id === rs.pa_id) sairDaPA();
  if (G.paLista) G.paLista = G.paLista.filter(x => x.id !== rs.pa_id);
  $('dp-rs-erro').hidden = true;
  document.querySelectorAll('#dp-passos li').forEach(li => (li.className = 'feito'));
  $('dp-rs-corpo').innerHTML = `<div class="dp-sucesso">
      <div class="dp-sucesso-ic">✓</div>
      <h3>Unidade ${esc(rs.un.codigo)} reservada</h3>
      <p>Reserva <b>${esc(r.codigo || '')}</b>${r.expira_em ? ` · ${esc(prazo(r.expira_em))}` : ''}.</p>
      <p>${
        r.comercial_id
          ? 'A venda já está na esteira de Vendas, com o cliente e o fluxo como proposta.'
          : G.temComercial === false
            ? 'Esta conta não tem a Venda: a reserva segura a unidade até virar venda por fora.'
            : ''
      }</p>
    </div>`;
  $('dp-rs-pe').innerHTML = `<span></span><div class="dp-pe-d">
      ${r.comercial_id ? `<button class="dp-btn dp-btn-g" data-acao="rsAbrirVenda" data-id="${esc(r.comercial_id)}">Abrir a venda</button>` : ''}
      <button class="dp-btn dp-btn-p" data-acao="fecharReserva">Voltar ao mapa</button></div>`;
  await atualizarTudo();
}

// ─── Reservas ────────────────────────────────────────────────────────────────
function filtrarReservas(/** @type {string} */ st) {
  G.rsFiltro = st;
  document
    .querySelectorAll('#dp-rs-filtro button')
    .forEach(b => b.classList.toggle('on', /** @type {any} */ (b).dataset.status === st));
  renderReservas();
}

function cpfMascarado(/** @type {string} */ c) {
  const d = String(c || '').replace(/\D/g, '');
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : '';
}

function renderReservas() {
  const filtro = G.rsFiltro ? G.rsFiltro.split(',') : null;
  const lista = G.reservas.filter(r => !filtro || filtro.includes(r.status));
  const ativas = G.reservas.filter(r => r.status === 'ATIVA');
  const vencendo = ativas.filter(
    r => r.expira_em && new Date(r.expira_em).getTime() - Date.now() < 24 * 36e5
  );
  $('dp-reservas-sub').textContent =
    `${ativas.length} ativa(s)` +
    (vencendo.length ? ` · ${vencendo.length} vence(m) nas próximas 24h` : '') +
    (ehGestor() || hasPerm('disp_ver_reservas') ? '' : ' · você vê só as suas');
  const emp = (/** @type {string} */ id) => (G.empreendimentos.find(e => e.id === id) || {}).name || '';
  const un = (/** @type {string} */ id) => G.unidades.find(u => u.id === id);
  if (!lista.length) {
    $('dp-reservas').innerHTML = '<div class="dp-vazio">Nenhuma reserva nesta situação.</div>';
    return;
  }
  $('dp-reservas').innerHTML = `<table class="dp-tabela">
    <thead><tr><th>Reserva</th><th>Unidade</th><th>Cliente</th><th>Corretor</th><th class="n">Valor</th><th>Situação</th><th>Prazo</th><th>Venda</th></tr></thead>
    <tbody>${lista
      .map(r => {
        const t = (r.cliente && r.cliente.titular) || {};
        const u = un(r.unidade_id);
        const vence = r.status === 'ATIVA' && r.expira_em ? prazo(r.expira_em) : '';
        const urgente =
          r.status === 'ATIVA' && r.expira_em && new Date(r.expira_em).getTime() - Date.now() < 24 * 36e5;
        return `<tr data-acao="abrirUnidadeDaReserva" data-id="${esc(r.unidade_id)}" data-emp="${esc(r.empreendimento_id)}">
          <td><b>${esc(r.codigo)}</b><small>${esc(dataHoraBR(r.criado_em))}</small></td>
          <td>${esc(u ? u.codigo : '')}<small>${esc(emp(r.empreendimento_id))}</small></td>
          <td>${esc(t.nome || '—')}<small>${esc(cpfMascarado(t.cpf))}</small></td>
          <td>${esc(nomeCorretor(r.corretor_id) || r.criado_por_nome || '—')}</td>
          <td class="n">${brl(r.valor_unidade)}</td>
          <td><span class="dp-rs-st dp-rs-${esc(r.status)}">${esc(/** @type {any} */ (STATUS_RESERVA)[r.status] || r.status)}</span>
            ${r.motivo ? `<small>${esc(r.motivo)}</small>` : ''}</td>
          <td class="${urgente ? 'dp-urgente' : ''}">${esc(vence || '—')}</td>
          <td>${
            r.comercial_id
              ? `<button class="dp-link" data-acao="rsAbrirVenda" data-id="${esc(r.comercial_id)}">abrir →</button>`
              : podeAbrirVenda(r)
                ? `<button class="dp-link dp-link-a" data-acao="abrirVendaDaReserva" data-id="${esc(r.id)}">criar a venda</button>`
                : r.status === 'ATIVA' && G.temComercial === true
                  ? '<span class="dp-mudo">sem venda</span>'
                  : '—'
          }</td>
        </tr>`;
      })
      .join('')}</tbody></table>`;
}

// ─── Painel ──────────────────────────────────────────────────────────────────
async function renderPainelDaTela(/** @type {string} */ empId) {
  const alvo = $('dp-painel');
  alvo.innerHTML = '<div class="dp-vazio">Montando o painel…</div>';
  try {
    const [unidades, itens, eventos] = await Promise.all([
      carregar.unidades(empId || null),
      carregar.itens(
        G.mapas.filter(m => m.ativo && (!empId || m.empreendimento_id === empId)).map(m => m.id)
      ),
      carregar.eventosDesde(new Date(Date.now() - 400 * 864e5).toISOString())
    ]);
    renderPainel(alvo, {
      unidades,
      preco: precosVigentes(G.mapas, itens),
      reservas: G.reservas.filter(r => !empId || r.empreendimento_id === empId),
      eventos: eventos.filter((/** @type {any} */ e) => !empId || e.empreendimento_id === empId),
      empreendimentos: G.empreendimentos,
      corretores: G.corretores,
      nomeCorretor
    });
  } catch (e) {
    alvo.innerHTML = `<div class="dp-vazio">${esc(motivo(/** @type {any} */ (e).message))}</div>`;
  }
}

init();
