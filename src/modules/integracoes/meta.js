// @ts-check
// ─── Integração Meta Lead Ads (Configurações › Integrações) ──────────────────
//
// O que a pessoa vê:
//   1. O cartão da integração com o estado: Conectado, Não conectado ou
//      Reconexão necessária. O último estado conhecido aparece NA HORA (fica
//      guardado no aparelho, por empresa) e é conferido em segundo plano; só a
//      primeira visita mostra "Verificando", e com tempo limite: se a função
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
async function metaAction(/** @type {string} */ action, params = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ESPERA_MS);
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

/** @returns {{connected:boolean, connected_at?:string, token_expires_at?:string|null, data_access_expires_at?:string|null}|null} */
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
        data_access_expires_at: s.data_access_expires_at || null
      })
    );
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

const venceu = (/** @type {any} */ s) =>
  [s.token_expires_at, s.data_access_expires_at].some(d => d && new Date(d).getTime() <= Date.now());

/** 'ok' | 'off' | 'expirou' */
const situacao = (/** @type {any} */ s) => (!s || !s.connected ? 'off' : venceu(s) ? 'expirou' : 'ok');

const dataCurta = (/** @type {string|null|undefined} */ d) =>
  d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

// ─── Cartão ──────────────────────────────────────────────────────────────────
function pintarSelo(/** @type {HTMLElement} */ el, /** @type {'ok'|'off'|'expirou'|'verificando'} */ s) {
  el.className = `mi-selo mi-selo-${s}`;
  const t = el.querySelector('span');
  if (t)
    t.textContent = {
      ok: 'Conectado',
      off: 'Não conectado',
      expirou: 'Reconexão necessária',
      verificando: 'Verificando'
    }[s];
}

function pintarCartao(/** @type {any} */ s) {
  const sit = situacao(s);
  pintarSelo($('meta-status'), sit);
  $('meta-config-open').hidden = sit !== 'ok';
  $('meta-connect-btn').hidden = sit === 'ok';
  $('meta-connect-btn').textContent = sit === 'expirou' ? 'Reconectar com a Meta' : 'Conectar com a Meta';
  /** @type {HTMLButtonElement} */ ($('meta-connect-btn')).disabled = false;
  $('meta-resumo').textContent =
    sit === 'ok'
      ? `Conta conectada${s.connected_at ? ` em ${dataCurta(s.connected_at)}` : ''}. Em Configurar, escolha as páginas e os formulários desta empresa.`
      : sit === 'expirou'
        ? 'A autorização da Meta venceu. Reconecte a conta para continuar recebendo dados.'
        : 'Conecte a conta Meta da empresa para escolher as páginas e os formulários de onde os leads vão chegar.';
  pintarSeloDoHub(sit);
}

/** O selinho no cartão "Integrações" do início das Configurações. */
export function pintarSeloDoHub(/** @type {'ok'|'off'|'expirou'|null} */ sit = situacao(statusGuardado())) {
  const el = document.getElementById('cfg-int-selo');
  if (!el) return;
  const g = sit && statusGuardado() ? sit : null;
  el.hidden = !g;
  if (!g) return;
  el.className = `cfg-int-selo cfg-int-${g}`;
  el.textContent =
    g === 'ok' ? 'Meta conectada' : g === 'expirou' ? 'Meta: reconectar' : 'Meta: não conectada';
}

function aviso(/** @type {string} */ id, /** @type {string} */ msg) {
  const el = $(id);
  el.textContent = msg;
  el.hidden = !msg;
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
    pintarSelo($('meta-status'), 'verificando');
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
/** @type {{id:string, name:string, selected:boolean}[]} */
let paginas = [];

export function metaAbrirConfig() {
  const s = statusGuardado();
  $('meta-card').hidden = true;
  $('meta-config').hidden = false;
  aviso('meta-config-message', '');
  $('meta-conta').textContent =
    s && s.connected_at ? `Conectada em ${dataCurta(s.connected_at)}` : 'Conta conectada';
  metaAbrirPaginas();
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
    await carregarFormularios();
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
    await metaAction('save_pages', { page_ids: ids });
    paginas = paginas.map(p => ({ ...p, selected: ids.includes(p.id) }));
    $('meta-pages-message').textContent = 'Páginas salvas para esta empresa.';
    await carregarFormularios();
  } catch (e) {
    $('meta-pages-message').textContent = /** @type {Error} */ (e).message;
  } finally {
    salvar.disabled = false;
  }
}

/** Um bloco por página escolhida, cada um com os formulários dela. */
async function carregarFormularios() {
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
        <div class="mi-pagina-cab"><b>${esc(p.name)}</b><span class="mi-pagina-msg" role="status">Carregando formulários…</span></div>
        <div class="mi-lista"><div class="mi-esq"></div></div>
        <div class="mi-rodape"><button type="button" class="btn btn-primary btn-sm" data-acao="metaSalvarFormularios" data-pagina="${esc(p.id)}" disabled>Salvar formulários</button></div>
      </div>`
    )
    .join('');
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
      .map(f =>
        linhaEscolha(
          `meta-form-${pageId}`,
          f.id,
          f.selected === true,
          `<b>${esc(f.name)}</b>${f.status ? `<small class="mi-st mi-st-${esc(String(f.status).toLowerCase())}">${esc(ROTULO_STATUS[f.status] || f.status)}</small>` : ''}`
        )
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
    bloco.querySelectorAll('input[type="checkbox"]:checked'),
    i => /** @type {HTMLInputElement} */ (i).value
  );
  /** @type {HTMLButtonElement} */ (botao).disabled = true;
  msg.textContent = 'Salvando…';
  try {
    await metaAction('save_forms', { page_id: pageId, form_ids: ids });
    msg.textContent = `Salvo: ${ids.length} formulário(s) desta página.`;
  } catch (e) {
    msg.textContent = /** @type {Error} */ (e).message;
  } finally {
    /** @type {HTMLButtonElement} */ (botao).disabled = false;
  }
}

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
