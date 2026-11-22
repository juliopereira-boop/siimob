// @ts-check
// ─── Integração Meta Lead Ads (Configurações › Integrações) ──────────────────
//
// O que a pessoa vê:
//   1. O cartão da integração com o estado: Conectado, Não conectado ou
//      Reconexão necessária. O último estado conhecido aparece NA HORA (fica
//      guardado no aparelho, por empresa) e é conferido em segundo plano; só a
//      primeira visita aguarda o estado verdadeiro, e com tempo limite: se a função
//      não responder em 12 s, aparece "Tentar novamente" em vez de girar para
//      sempre.
//   2. "Configurar" abre a configuração já carregada: as páginas da conta
//      (marcadas as desta empresa) e, para cada página escolhida, os
//      formulários dela.
//
// Toda a conversa com a Meta passa pela Edge Function meta-connect, com a
// sessão do usuário (x-session-token). Token da Meta nunca chega ao navegador.
// Só owner e admin ativos passam (siimob_meta_session_context).
import { A1, A1_URL } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';

// Os funis de Leads da empresa (a1_stages, módulo crm). O lead da integração
// entra na etapa marcada como INÍCIO do funil escolhido para o formulário.
const ROTULO_FUNIL = /** @type {Record<string,string>} */ ({
  vendas: 'Vendas — Imóveis Prontos',
  lancamentos: 'Vendas — Lançamentos',
  locacao: 'Locação'
});
/** @type {{chave:string, rotulo:string, inicio:string}[]} */
let funis = [];
async function carregarFunis() {
  try {
    const r = await fetch(
      `${A1.rest('a1_stages')}?module_key=eq.crm&select=group_key,name,is_initial,position&order=position.asc`,
      { headers: A1.headers() }
    );
    const etapas = r.ok ? await r.json() : [];
    /** @type {Map<string, any>} */
    const m = new Map();
    for (const e of Array.isArray(etapas) ? etapas : []) {
      const k = e.group_key || 'geral';
      if (!m.has(k)) m.set(k, { chave: k, rotulo: ROTULO_FUNIL[k] || k, inicio: e.name });
      if (e.is_initial && !m.get(k).marcado) Object.assign(m.get(k), { inicio: e.name, marcado: true });
    }
    funis = [...m.values()].map(f => ({ chave: f.chave, rotulo: f.rotulo, inicio: f.inicio }));
  } catch {
    funis = [];
  }
}
function seletorFunil(/** @type {string} */ formId, /** @type {string|null} */ atual) {
  const primeiro = funis[0];
  const opcoes = [
    `<option value="">${esc(primeiro ? `Padrão: ${primeiro.rotulo}` : 'Funil padrão')}</option>`,
    ...funis.map(
      f =>
        `<option value="${esc(f.chave)}"${f.chave === atual ? ' selected' : ''}>${esc(f.rotulo)} · entra em ${esc(f.inicio)}</option>`
    )
  ];
  return `<select class="mi-funil" data-form="${esc(formId)}" aria-label="Funil de destino">${opcoes.join('')}</select>`;
}

const ESPERA_MS = 12000;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const MENSAGENS = /** @type {Record<string,string>} */ ({
  page_conflict: 'Uma das páginas já está vinculada a outra empresa no SIIMOB.',
  page_not_authorized:
    'A conta não tem mais acesso a uma das páginas escolhidas. Atualize a lista e tente de novo.',
  connection_changed: 'A conta foi reconectada enquanto você editava. Atualize a lista e tente de novo.',
  reconnect: 'A autorização da Meta expirou. Reconecte a conta.',
  not_connected: 'Conecte a conta Meta antes de escolher páginas.',
  forms_permission:
    'A Meta não liberou os formulários desta página. Reconecte a conta e aceite todas as permissões pedidas.',
  page_not_selected: 'Salve esta página para a empresa antes de escolher os formulários.',
  form_not_authorized: 'Um formulário não está mais disponível. Atualize e tente de novo.',
  temporarily_unavailable: 'A Meta não respondeu agora. Tente de novo em instantes.'
});

/** Chama a Edge Function, com tempo limite. */
async function metaAction(/** @type {string} */ action, params = {}, espera = ESPERA_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), espera);
  /** @type {Response} */
  let r;
  /** @type {any} */
  let data;
  try {
    r = await fetch(`${A1_URL}/functions/v1/meta-connect`, {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({ action, ...params }),
      signal: ctrl.signal
    });
    data = await r.json().catch(() => ({}));
  } catch {
    throw new Error('Não foi possível falar com a Meta agora. Confira a internet e tente de novo.');
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    throw new Error(
      MENSAGENS[data && data.error] ||
        (r.status === 401 || r.status === 403
          ? 'Só o gestor (owner ou admin) da empresa pode gerenciar integrações.'
          : 'Não foi possível acessar a integração. Tente de novo.')
    );
  }
  return data;
}

// ─── Estado guardado no aparelho ─────────────────────────────────────────────
const chaveStatus = () => `a1_meta_status:${A1.slug || ''}`;

/** @returns {{connected:boolean, connected_at?:string, token_expires_at?:string|null, data_access_expires_at?:string|null, ativo?:boolean}|null} */
function statusGuardado() {
  try {
    const s = JSON.parse(localStorage.getItem(chaveStatus()) || 'null');
    return s && typeof s.connected === 'boolean' ? s : null;
  } catch {
    return null;
  }
}
function guardarStatus(/** @type {any} */ s) {
  try {
    localStorage.setItem(
      chaveStatus(),
      JSON.stringify({
        connected: s.connected === true,
        connected_at: s.connected_at || null,
        token_expires_at: s.token_expires_at || null,
        data_access_expires_at: s.data_access_expires_at || null,
        ativo: s.ativo !== false
      })
    );
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

const venceu = (/** @type {any} */ s) =>
  [s.token_expires_at, s.data_access_expires_at].some(d => d && new Date(d).getTime() <= Date.now());

/** 'ok' | 'off' | 'expirou' | 'inativa' */
const situacao = (/** @type {any} */ s) =>
  !s || !s.connected ? 'off' : venceu(s) ? 'expirou' : s.ativo === false ? 'inativa' : 'ok';

const dataCurta = (/** @type {string|null|undefined} */ d) =>
  d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

// ─── Cartão ──────────────────────────────────────────────────────────────────
function pintarSelo(
  /** @type {HTMLElement} */ el,
  /** @type {'ok'|'off'|'expirou'|'inativa'|'verificando'} */ s
) {
  el.hidden = false;
  el.className = `mi-selo mi-selo-${s}`;
  const t = el.querySelector('span');
  if (t)
    t.textContent = {
      ok: 'Conectado',
      off: 'Não conectado',
      expirou: 'Reconexão necessária',
      inativa: 'Inativa',
      verificando: 'Verificando'
    }[s];
}

function pintarCartao(/** @type {any} */ s) {
  const sit = situacao(s);
  pintarSelo($('meta-status'), sit);
  const conectada = sit === 'ok' || sit === 'inativa';
  $('meta-config-open').hidden = !conectada;
  $('meta-connect-btn').hidden = conectada;
  $('meta-connect-btn').textContent = sit === 'expirou' ? 'Reconectar com a Meta' : 'Conectar com a Meta';
  /** @type {HTMLButtonElement} */ ($('meta-connect-btn')).disabled = false;
  $('meta-resumo').textContent =
    sit === 'ok'
      ? `Conta conectada${s.connected_at ? ` em ${dataCurta(s.connected_at)}` : ''}. Em Configurar, escolha as páginas e os formulários desta empresa.`
      : sit === 'inativa'
        ? 'Integração inativa: os leads da Meta ficam guardados e só entram no funil quando você ativar de novo, em Configurar.'
        : sit === 'expirou'
          ? 'A autorização da Meta venceu. Reconecte a conta para continuar recebendo dados.'
          : 'Conecte a conta Meta da empresa para escolher as páginas e os formulários de onde os leads vão chegar.';
  pintarSeloDoHub(sit);
}

/** O selinho no cartão "Integrações" do início das Configurações. */
export function pintarSeloDoHub(
  /** @type {'ok'|'off'|'expirou'|'inativa'|null} */ sit = situacao(statusGuardado())
) {
  const el = document.getElementById('cfg-int-selo');
  if (!el) return;
  const g = sit && statusGuardado() ? sit : null;
  el.hidden = !g;
  if (!g) return;
  el.className = `cfg-int-selo cfg-int-${g}`;
  el.textContent =
    g === 'ok'
      ? 'Meta conectada'
      : g === 'expirou'
        ? 'Meta: reconectar'
        : g === 'inativa'
          ? 'Meta: inativa'
          : 'Meta: não conectada';
}

function aviso(/** @type {string} */ id, /** @type {string} */ msg, ok = false) {
  const el = $(id);
  el.textContent = msg;
  el.hidden = !msg;
  el.classList.toggle('mi-aviso-ok', ok);
}

let conferindo = /** @type {Promise<void>|null} */ (null);

/** Abre a lista de integrações: mostra o último estado na hora e confere. */
export function metaCarregarStatus() {
  $('meta-card').hidden = false;
  $('meta-config').hidden = true;
  $('meta-retry').hidden = true;
  aviso('meta-aviso', '');
  const guardado = statusGuardado();
  if (guardado) pintarCartao(guardado);
  else {
    $('meta-status').hidden = true;
    $('meta-config-open').hidden = true;
    $('meta-connect-btn').hidden = true;
  }
  if (conferindo) return conferindo;
  conferindo = metaAction('status')
    .then(s => {
      guardarStatus(s);
      pintarCartao(s);
    })
    .catch(e => {
      if (!statusGuardado()) {
        pintarSelo($('meta-status'), 'off');
        $('meta-status').querySelector('span').textContent = 'Sem resposta';
      }
      aviso('meta-aviso', e.message);
      $('meta-retry').hidden = false;
    })
    .finally(() => {
      conferindo = null;
    });
  return conferindo;
}

// ─── Configuração ────────────────────────────────────────────────────────────
/** @type {{id:string, name:string, selected:boolean, todos_formularios?:boolean}[]} */
let paginas = [];

export function metaAbrirConfig() {
  const s = statusGuardado();
  $('meta-card').hidden = true;
  $('meta-config').hidden = false;
  aviso('meta-config-message', '');
  $('meta-conta').textContent =
    s && s.connected_at ? `Conectada em ${dataCurta(s.connected_at)}` : 'Conta conectada';
  pintarConta(s);
  metaAbrirPaginas();
}

/** Selo, botão Inativar/Ativar e a faixa de aviso do topo da configuração. */
function pintarConta(/** @type {any} */ s) {
  const inativa = !!s && s.ativo === false;
  pintarSelo($('meta-config-selo'), inativa ? 'inativa' : 'ok');
  $('meta-ativo-btn').textContent = inativa ? 'Ativar' : 'Inativar';
  $('meta-ativo-btn').title = inativa
    ? 'Volta a receber os leads e traz os que chegaram enquanto estava inativa.'
    : 'Pausa o recebimento sem desconectar a conta.';
  $('meta-inativa').hidden = !inativa;
}

/** Pausa ou retoma o recebimento. Ao ativar, traz os leads guardados. */
export async function metaAlternarAtivo() {
  const s = statusGuardado() || { connected: true };
  const ativar = s.ativo === false;
  const b = /** @type {HTMLButtonElement} */ ($('meta-ativo-btn'));
  b.disabled = true;
  aviso('meta-config-message', '');
  try {
    await metaAction('set_active', { ativo: ativar });
    const novo = { ...s, connected: true, ativo: ativar };
    guardarStatus(novo);
    pintarConta(novo);
    pintarCartao(novo);
    if (ativar) {
      aviso(
        'meta-config-message',
        'Integração ativa. Trazendo os leads que chegaram enquanto estava inativa…',
        true
      );
      await metaReprocessar();
      aviso('meta-config-message', 'Integração ativa de novo.', true);
    } else {
      aviso(
        'meta-config-message',
        'Integração inativa. Os leads ficam guardados até você ativar de novo.',
        true
      );
    }
  } catch (e) {
    aviso('meta-config-message', /** @type {Error} */ (e).message);
  } finally {
    b.disabled = false;
  }
}

/** Apaga a conexão: os leads param de chegar. As escolhas de formulário ficam. */
export async function metaDesconectar() {
  if (
    !confirm(
      'Desconectar a conta Meta desta empresa?\n\nOs leads dos formulários param de chegar ao SIIMOB. Os leads que já entraram continuam no funil, e os formulários marcados ficam guardados para quando você reconectar.'
    )
  )
    return;
  const b = /** @type {HTMLButtonElement} */ ($('meta-desconectar-btn'));
  b.disabled = true;
  aviso('meta-config-message', '');
  try {
    await metaAction('disconnect', {}, 30000);
    const off = { connected: false };
    guardarStatus(off);
    metaFecharConfig();
    pintarCartao(off);
    aviso('meta-aviso', 'Conta Meta desconectada. Para voltar a receber leads, conecte de novo.', true);
  } catch (e) {
    aviso('meta-config-message', /** @type {Error} */ (e).message);
  } finally {
    b.disabled = false;
  }
}

export function metaFecharConfig() {
  $('meta-config').hidden = true;
  $('meta-card').hidden = false;
}

function linhaEscolha(
  /** @type {string} */ nome,
  /** @type {string} */ valor,
  /** @type {boolean} */ marcado,
  extra = ''
) {
  return `<label class="mi-item">
    <input type="checkbox" name="${esc(nome)}" value="${esc(valor)}"${marcado ? ' checked' : ''}>
    <span class="mi-check" aria-hidden="true"></span>
    <span class="mi-item-txt">${extra}</span>
  </label>`;
}

/** Carrega as páginas da conta e, em seguida, os formulários das escolhidas. */
export async function metaAbrirPaginas() {
  const lista = $('meta-pages-list');
  const btn = /** @type {HTMLButtonElement} */ ($('meta-pages-open'));
  const salvar = /** @type {HTMLButtonElement} */ ($('meta-pages-save'));
  btn.disabled = true;
  salvar.disabled = true;
  lista.innerHTML = '<div class="mi-esq"></div><div class="mi-esq"></div>';
  $('meta-pages-message').textContent = '';
  $('meta-forms').innerHTML = '';
  $('meta-forms-message').textContent = 'Carregando…';
  try {
    const r = await metaAction('pages');
    paginas = Array.isArray(r.pages) ? r.pages : [];
    lista.innerHTML = paginas.length
      ? paginas
          .map(p => linhaEscolha('meta-page', p.id, p.selected === true, `<b>${esc(p.name)}</b>`))
          .join('')
      : '';
    $('meta-pages-message').textContent = r.unavailable
      ? `${r.unavailable} página(s) salva(s) não estão mais nesta conta e saem da lista ao salvar.`
      : paginas.length
        ? ''
        : 'Esta conta não tem páginas do Facebook disponíveis. Confira as permissões na Meta e reconecte.';
    salvar.disabled = paginas.length === 0 && !r.unavailable;
    await Promise.all([carregarFormularios(), ligarRecebimento(), carregarLeadsRecentes()]);
  } catch (e) {
    lista.innerHTML = '';
    $('meta-pages-message').textContent = /** @type {Error} */ (e).message;
    $('meta-forms-message').textContent = '';
  } finally {
    btn.disabled = false;
  }
}

export async function metaSalvarPaginas() {
  const salvar = /** @type {HTMLButtonElement} */ ($('meta-pages-save'));
  const ids = Array.from(
    document.querySelectorAll('#meta-pages-list input[name="meta-page"]:checked'),
    i => /** @type {HTMLInputElement} */ (i).value
  );
  salvar.disabled = true;
  $('meta-pages-message').textContent = 'Salvando…';
  try {
    const r = await metaAction('save_pages', { page_ids: ids });
    paginas = paginas.map(p => ({ ...p, selected: ids.includes(p.id) }));
    $('meta-pages-message').textContent = 'Páginas salvas para esta empresa.';
    await carregarFormularios();
    pintarRecebimento(Array.isArray(r.pages) ? r.pages : []);
  } catch (e) {
    $('meta-pages-message').textContent = /** @type {Error} */ (e).message;
  } finally {
    salvar.disabled = false;
  }
}

/** Um bloco por página escolhida, cada um com os formulários dela. */
async function carregarFormularios() {
  if (!funis.length) await carregarFunis();
  const escolhidas = paginas.filter(p => p.selected);
  const area = $('meta-forms');
  if (!escolhidas.length) {
    area.innerHTML = '';
    $('meta-forms-message').textContent = 'Escolha e salve ao menos uma página para ver os formulários dela.';
    return;
  }
  $('meta-forms-message').textContent = '';
  area.innerHTML = escolhidas
    .map(
      p => `<div class="mi-pagina" data-pagina="${esc(p.id)}">
        <div class="mi-pagina-cab"><b>${esc(p.name)}</b><span class="mi-receb" data-receb="${esc(p.id)}"></span><span class="mi-pagina-msg" role="status">Carregando formulários…</span></div>
        <label class="mi-todos"><input type="checkbox" data-acao-change="metaTodosFormularios" data-pagina="${esc(p.id)}"${p.todos_formularios ? ' checked' : ''}><span><b>Receber de todos os formulários desta página, inclusive os novos</b><small>Os não marcados abaixo também geram lead, no primeiro funil. Útil para não perder lead de um formulário criado depois.</small></span></label>
        <div class="mi-lista"><div class="mi-esq"></div></div>
        <div class="mi-rodape"><button type="button" class="btn btn-primary btn-sm" data-acao="metaSalvarFormularios" data-pagina="${esc(p.id)}" disabled>Salvar formulários</button></div>
      </div>`
    )
    .join('');
  pintarRecebimento([]);
  await Promise.all(escolhidas.map(p => carregarFormulariosDa(p.id)));
}

function blocoDa(/** @type {string} */ id) {
  return /** @type {HTMLElement|null} */ (
    document.querySelector(`.mi-pagina[data-pagina="${CSS.escape(id)}"]`)
  );
}

const ROTULO_STATUS = /** @type {Record<string,string>} */ ({
  ACTIVE: 'Ativo',
  ARCHIVED: 'Arquivado',
  DELETED: 'Excluído',
  DRAFT: 'Rascunho'
});

async function carregarFormulariosDa(/** @type {string} */ pageId) {
  const bloco = blocoDa(pageId);
  if (!bloco) return;
  const msg = /** @type {HTMLElement} */ (bloco.querySelector('.mi-pagina-msg'));
  const lista = /** @type {HTMLElement} */ (bloco.querySelector('.mi-lista'));
  const salvar = /** @type {HTMLButtonElement} */ (bloco.querySelector('button'));
  try {
    const r = await metaAction('forms', { page_id: pageId });
    const forms = Array.isArray(r.forms) ? r.forms : [];
    lista.innerHTML = forms
      .map(
        f =>
          `<div class="mi-form">${linhaEscolha(
            `meta-form-${pageId}`,
            f.id,
            f.selected === true,
            `<b>${esc(f.name)}</b>${f.status ? `<small class="mi-st mi-st-${esc(String(f.status).toLowerCase())}">${esc(ROTULO_STATUS[f.status] || f.status)}</small>` : ''}`
          )}${funis.length > 1 ? seletorFunil(f.id, f.funil || null) : ''}</div>`
      )
      .join('');
    const marcados = forms.filter(f => f.selected).length;
    msg.textContent = r.unavailable
      ? `${r.unavailable} formulário(s) salvo(s) não existem mais e saem ao salvar.`
      : forms.length
        ? `${marcados} de ${forms.length} selecionado(s)`
        : 'Nenhum formulário nesta página.';
    salvar.disabled = forms.length === 0 && !r.unavailable;
  } catch (e) {
    lista.innerHTML = '';
    msg.textContent = /** @type {Error} */ (e).message;
  }
}

export async function metaSalvarFormularios(/** @type {HTMLElement} */ botao) {
  const pageId = botao.dataset.pagina || '';
  const bloco = blocoDa(pageId);
  if (!bloco) return;
  const msg = /** @type {HTMLElement} */ (bloco.querySelector('.mi-pagina-msg'));
  const ids = Array.from(
    bloco.querySelectorAll('.mi-lista input[type="checkbox"]:checked'),
    i => /** @type {HTMLInputElement} */ (i).value
  );
  /** @type {HTMLButtonElement} */ (botao).disabled = true;
  msg.textContent = 'Salvando…';
  try {
    /** @type {Record<string,string|null>} */
    const destino = {};
    bloco.querySelectorAll('select.mi-funil').forEach(sel => {
      const el = /** @type {HTMLSelectElement} */ (sel);
      if (ids.includes(el.dataset.form || '')) destino[el.dataset.form || ''] = el.value || null;
    });
    await metaAction('save_forms', { page_id: pageId, form_ids: ids, funis: destino });
    msg.textContent = `Salvo: ${ids.length} formulário(s) desta página. Os leads deles entram na etapa de início do funil escolhido.`;
  } catch (e) {
    msg.textContent = /** @type {Error} */ (e).message;
  } finally {
    /** @type {HTMLButtonElement} */ (botao).disabled = false;
  }
}

/** Busca de novo os formulários de todas as páginas escolhidas. */
export async function metaAtualizarFormularios() {
  const b = /** @type {HTMLButtonElement} */ ($('meta-forms-refresh'));
  b.disabled = true;
  try {
    await carregarFormularios();
  } finally {
    b.disabled = false;
  }
}

/** Liga ou desliga "todos os formulários" de uma página. */
export async function metaTodosFormularios(/** @type {HTMLElement} */ el) {
  const caixa = /** @type {HTMLInputElement} */ (el);
  const pageId = caixa.dataset.pagina || '';
  const bloco = blocoDa(pageId);
  const msg = /** @type {HTMLElement|null} */ (bloco && bloco.querySelector('.mi-pagina-msg'));
  const valor = caixa.checked;
  caixa.disabled = true;
  try {
    await metaAction('page_options', { page_id: pageId, todos_formularios: valor });
    paginas = paginas.map(p => (p.id === pageId ? { ...p, todos_formularios: valor } : p));
    if (msg)
      msg.textContent = valor
        ? 'Todos os formulários desta página geram lead, inclusive os novos.'
        : 'Só os formulários marcados geram lead.';
  } catch (e) {
    caixa.checked = !valor;
    if (msg) msg.textContent = /** @type {Error} */ (e).message;
  } finally {
    caixa.disabled = false;
  }
}

// ─── Recebimento: a página precisa estar ligada para a Meta avisar ───────────
/** O último resultado de cada página, para pintar quando o bloco dela nascer. */
const recebimento = new Map();
function pintarRecebimento(/** @type {{id:string, recebendo:boolean}[]} */ lista) {
  for (const p of lista) recebimento.set(p.id, p.recebendo);
  for (const [id, recebendo] of recebimento) {
    const p = { id, recebendo };
    const el = document.querySelector(`.mi-receb[data-receb="${CSS.escape(p.id)}"]`);
    if (!el) continue;
    el.className = `mi-receb ${p.recebendo ? 'mi-receb-ok' : 'mi-receb-off'}`;
    el.textContent = p.recebendo ? 'Recebendo leads' : 'Não ligada ao recebimento';
    el.setAttribute(
      'title',
      p.recebendo
        ? 'A Meta avisa o SIIMOB a cada lead novo desta página.'
        : 'A Meta recusou ligar esta página. Reconecte a conta e aceite todas as permissões.'
    );
  }
}
async function ligarRecebimento() {
  try {
    const r = await metaAction('subscribe');
    pintarRecebimento(Array.isArray(r.pages) ? r.pages : []);
  } catch {
    /* sem resposta: o selo fica vazio, a lista de leads mostra o resto */
  }
}

// ─── Últimos leads recebidos ─────────────────────────────────────────────────
const SITUACAO_LEAD = /** @type {Record<string,{rotulo:string, cls:string}>} */ ({
  criado: { rotulo: 'Entrou no funil', cls: 'ok' },
  duplicado: { rotulo: 'Já estava no funil', cls: 'ok' },
  recebido: { rotulo: 'Aguardando', cls: 'espera' },
  ignorado: { rotulo: 'Não entrou', cls: 'off' },
  erro: { rotulo: 'Falhou', cls: 'erro' }
});
const MOTIVO_LEAD = /** @type {Record<string,string>} */ ({
  formulario_nao_marcado: 'formulário não está marcado aqui',
  pagina_sem_empresa: 'página não está escolhida',
  sem_modulo_leads: 'o módulo de Leads não está ligado',
  sem_conexao: 'conta Meta desconectada',
  reconectar: 'a autorização da Meta venceu, reconecte',
  permissao_meta: 'a Meta negou acesso ao lead, reconecte aceitando as permissões',
  campo_ou_id_invalido: 'a Meta não encontrou o lead',
  meta_indisponivel: 'a Meta não respondeu',
  sem_etapa: 'o funil não tem etapas',
  falha_interna: 'falha ao gravar, tente de novo',
  integracao_inativa: 'chegou com a integração inativa'
});
const quando = (/** @type {string} */ d) =>
  d
    ? new Date(d).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '';

async function carregarLeadsRecentes() {
  const area = $('meta-leads');
  area.innerHTML = '<div class="mi-esq"></div>';
  try {
    const r = await metaAction('leads');
    const leads = Array.isArray(r.leads) ? r.leads : [];
    $('meta-reprocessar').hidden = !leads.some(l => ['erro', 'recebido', 'ignorado'].includes(l.status));
    area.innerHTML = leads.length
      ? leads
          .map(l => {
            const s = SITUACAO_LEAD[l.status] || { rotulo: l.status, cls: 'off' };
            const motivo = l.detalhe ? MOTIVO_LEAD[l.detalhe] || l.detalhe : '';
            return `<div class="mi-lead">
              <span class="mi-lead-q">${esc(quando(l.quando))}</span>
              <span class="mi-lead-n"><b>${esc(l.lead || '—')}</b><small>${esc(l.formulario || '')}</small></span>
              <span class="mi-lead-s mi-lead-${s.cls}" title="${esc(motivo)}">${esc(s.rotulo)}${motivo ? ` · ${esc(motivo)}` : ''}</span>
            </div>`;
          })
          .join('')
      : '<p class="mi-msg">Nenhum aviso de lead chegou da Meta ainda. Quando alguém preencher um formulário desta empresa, ele aparece aqui em segundos, mesmo que o formulário não esteja marcado (com o motivo). Se você testou e nada apareceu depois de alguns minutos, fale com o suporte do SIIMOB.</p>';
  } catch (e) {
    area.innerHTML = `<p class="mi-msg">${esc(/** @type {Error} */ (e).message)}</p>`;
  }
}

export async function metaReprocessar() {
  const b = /** @type {HTMLButtonElement} */ ($('meta-reprocessar'));
  b.disabled = true;
  b.textContent = 'Tentando…';
  try {
    await metaAction('reprocessar', {}, 45000);
  } catch (e) {
    aviso('meta-config-message', /** @type {Error} */ (e).message);
  } finally {
    b.disabled = false;
    b.textContent = 'Tentar de novo os que não entraram';
    await carregarLeadsRecentes();
  }
}
export const metaAtualizarLeads = () => carregarLeadsRecentes();

// ─── Conectar / reconectar ───────────────────────────────────────────────────
function botoesConectar(/** @type {boolean} */ desligar) {
  document.querySelectorAll('button[data-acao="metaConectar"]').forEach(b => {
    /** @type {HTMLButtonElement} */ (b).disabled = desligar;
  });
}

export async function metaConectar() {
  const noConfig = !$('meta-config').hidden;
  const alvoMsg = noConfig ? 'meta-config-message' : 'meta-aviso';
  botoesConectar(true);
  try {
    const r = await metaAction('start');
    const destino = new URL(r.url);
    if (destino.origin !== 'https://www.facebook.com' || destino.pathname !== '/v27.0/dialog/oauth')
      throw new Error('Não foi possível iniciar a conexão.');
    try {
      localStorage.removeItem(chaveStatus());
    } catch {
      /* nada */
    }
    window.location.assign(destino.href);
  } catch (e) {
    aviso(alvoMsg, /** @type {Error} */ (e).message);
    botoesConectar(false);
  }
}
