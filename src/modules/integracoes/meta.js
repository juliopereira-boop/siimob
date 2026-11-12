import { A1, A1_URL } from '../../shared/api/config.js';

let ultimoStatus = null;
let paginaDosFormularios = null;

async function metaAction(action, params = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let response;
  let data;
  try {
    response = await fetch(`${A1_URL}/functions/v1/meta-connect`, {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({ action, ...params }),
      signal: controller.signal
    });
    data = await response.json();
  } catch {
    throw new Error('Não foi possível verificar a Meta. Tente novamente.');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const messages = {
      page_conflict: 'Uma das páginas já está vinculada a outra empresa no SIIMOB.',
      page_not_authorized:
        'A conta não tem mais acesso a uma das páginas escolhidas. Atualize a lista e tente novamente.',
      connection_changed: 'A conta foi reconectada. Atualize a lista e tente novamente.',
      reconnect: 'A autorização expirou. Reconecte sua conta Meta.',
      not_connected: 'Conecte sua conta Meta antes de escolher páginas.',
      forms_permission:
        'A Meta não permitiu consultar formulários. Verifique as permissões pages_read_engagement e pages_manage_ads e reconecte a conta.',
      page_not_selected: 'Salve esta página para a empresa antes de consultar os formulários.',
      form_not_authorized: 'Um formulário não está mais disponível. Atualize a lista e tente novamente.'
    };
    throw new Error(
      messages[data.error] ||
        (response.status === 403 || response.status === 401
          ? 'Somente administradores ativos podem gerenciar esta conexão.'
          : 'Não foi possível acessar a conexão. Tente novamente.')
    );
  }
  return data;
}

function metaExibirStatus(result) {
  const label = document.getElementById('meta-status');
  const connect = document.getElementById('meta-connect-btn');
  const config = document.getElementById('meta-config-open');
  const expired = [result.token_expires_at, result.data_access_expires_at].some(
    date => date && new Date(date).getTime() <= Date.now()
  );
  label.textContent = result.connected ? (expired ? 'Reconexão necessária' : 'Conectado') : 'Não conectado';
  label.style.color = result.connected && !expired ? '#087f5b' : 'var(--t2)';
  connect.hidden = result.connected && !expired;
  connect.textContent = expired ? 'Reconectar com a Meta' : 'Conectar com a Meta';
  connect.disabled = false;
  config.hidden = !result.connected || expired;
}

export async function metaCarregarStatus() {
  const label = document.getElementById('meta-status');
  const retry = document.getElementById('meta-retry');
  document.getElementById('meta-card').hidden = false;
  document.getElementById('meta-config').hidden = true;
  document.getElementById('meta-connect-btn').hidden = true;
  document.getElementById('meta-config-open').hidden = true;
  retry.hidden = true;
  if (ultimoStatus && ultimoStatus.token === A1.token) metaExibirStatus(ultimoStatus.result);
  else label.textContent = 'Verificando conexão…';
  try {
    const result = await metaAction('status');
    ultimoStatus = { token: A1.token, result };
    metaExibirStatus(result);
  } catch (error) {
    ultimoStatus = null;
    label.style.color = 'var(--t2)';
    label.textContent = error.message;
    document.getElementById('meta-connect-btn').hidden = true;
    document.getElementById('meta-config-open').hidden = true;
    retry.hidden = false;
  }
}

export function metaAbrirConfig() {
  document.getElementById('meta-card').hidden = true;
  document.getElementById('meta-config').hidden = false;
  document.getElementById('meta-pages-panel').hidden = true;
  document.getElementById('meta-forms-panel').hidden = true;
}

export function metaFecharConfig() {
  document.getElementById('meta-config').hidden = true;
  document.getElementById('meta-card').hidden = false;
}

export async function metaAbrirPaginas() {
  const panel = document.getElementById('meta-pages-panel');
  const open = document.getElementById('meta-pages-open');
  const list = document.getElementById('meta-pages-list');
  const message = document.getElementById('meta-pages-message');
  const save = document.getElementById('meta-pages-save');
  panel.hidden = false;
  open.disabled = true;
  save.disabled = true;
  list.replaceChildren();
  message.textContent = 'Carregando páginas da Meta…';
  try {
    const result = await metaAction('pages');
    if (!Array.isArray(result.pages)) throw new Error('Não foi possível carregar as páginas.');
    for (const page of result.pages) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:.55rem;font-size:.8rem;cursor:pointer';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'meta-page';
      checkbox.value = page.id;
      checkbox.checked = page.selected === true;
      const name = document.createElement('span');
      name.textContent = page.name;
      row.append(checkbox, name);
      list.append(row);
    }
    message.textContent = result.unavailable
      ? `${result.unavailable} página(s) salva(s) não estão mais disponíveis nesta conta e serão removidas ao salvar.`
      : result.pages.length
        ? 'Selecione as páginas e salve.'
        : 'Nenhuma página disponível nesta conta. Verifique as permissões na Meta.';
    save.disabled = result.pages.length === 0 && !result.unavailable;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    open.disabled = false;
  }
}

export async function metaSalvarPaginas() {
  const save = document.getElementById('meta-pages-save');
  const message = document.getElementById('meta-pages-message');
  const ids = Array.from(
    document.querySelectorAll('#meta-pages-list input[name="meta-page"]:checked'),
    input => input.value
  );
  save.disabled = true;
  message.textContent = 'Salvando páginas…';
  try {
    await metaAction('save_pages', { page_ids: ids });
    document.getElementById('meta-forms-panel').hidden = true;
    paginaDosFormularios = null;
    message.textContent = 'Páginas salvas para esta empresa. O recebimento de leads ainda não está ativo.';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    save.disabled = false;
  }
}

export async function metaConectar() {
  const button = document.getElementById('meta-connect-btn');
  button.disabled = true;
  try {
    const result = await metaAction('start');
    const target = new URL(result.url);
    if (target.origin !== 'https://www.facebook.com' || target.pathname !== '/v27.0/dialog/oauth') {
      throw new Error('Não foi possível iniciar a conexão.');
    }
    window.location.assign(target.href);
  } catch (error) {
    const inSettings = !document.getElementById('meta-config').hidden;
    document.getElementById(inSettings ? 'meta-config-message' : 'meta-status').textContent = error.message;
    button.disabled = false;
  }
}

export async function metaAbrirFormularios() {
  const panel = document.getElementById('meta-forms-panel');
  const select = document.getElementById('meta-forms-page');
  const message = document.getElementById('meta-forms-message');
  panel.hidden = false;
  paginaDosFormularios = null;
  document.getElementById('meta-forms-save').disabled = true;
  select.replaceChildren();
  document.getElementById('meta-forms-list').replaceChildren();
  message.textContent = 'Carregando páginas selecionadas…';
  try {
    const result = await metaAction('pages');
    const pages = result.pages.filter(page => page.selected);
    for (const page of pages) {
      const option = document.createElement('option');
      option.value = page.id;
      option.textContent = page.name;
      select.append(option);
    }
    message.textContent = pages.length
      ? 'Escolha uma página e consulte seus formulários.'
      : 'Escolha e salve ao menos uma página antes de consultar os formulários.';
  } catch (error) {
    message.textContent = error.message;
  }
}

export async function metaCarregarFormularios() {
  const select = document.getElementById('meta-forms-page');
  const message = document.getElementById('meta-forms-message');
  const list = document.getElementById('meta-forms-list');
  const save = document.getElementById('meta-forms-save');
  const load = document.getElementById('meta-forms-load');
  list.replaceChildren();
  paginaDosFormularios = null;
  save.disabled = true;
  if (!select.value) {
    message.textContent = 'Escolha e salve ao menos uma página primeiro.';
    return;
  }
  const pageId = select.value;
  select.disabled = true;
  load.disabled = true;
  message.textContent = 'Consultando formulários…';
  try {
    const result = await metaAction('forms', { page_id: pageId });
    if (!Array.isArray(result.forms)) throw new Error('Não foi possível carregar os formulários.');
    for (const form of result.forms) {
      const item = document.createElement('label');
      item.style.cssText =
        'display:flex;align-items:center;gap:.55rem;font-size:.8rem;padding:.5rem;border:1px solid var(--border);border-radius:7px';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'meta-form';
      checkbox.value = form.id;
      checkbox.checked = form.selected === true;
      const name = document.createElement('span');
      name.textContent = form.name + (form.status ? ` · ${form.status}` : '');
      item.append(checkbox, name);
      list.append(item);
    }
    message.textContent = result.unavailable
      ? `${result.unavailable} formulário(s) salvo(s) não estão mais disponíveis e serão desmarcados ao salvar.`
      : result.forms.length
        ? 'Selecione os formulários desta página e salve.'
        : 'Nenhum formulário encontrado nesta página.';
    paginaDosFormularios = pageId;
    save.disabled = result.forms.length === 0 && !result.unavailable;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    select.disabled = false;
    load.disabled = false;
  }
}

export function metaPaginaFormularioMudou() {
  paginaDosFormularios = null;
  document.getElementById('meta-forms-save').disabled = true;
  document.getElementById('meta-forms-list').replaceChildren();
  document.getElementById('meta-forms-message').textContent = 'Consulte os formulários da página escolhida.';
}

export async function metaSalvarFormularios() {
  const select = document.getElementById('meta-forms-page');
  const save = document.getElementById('meta-forms-save');
  const load = document.getElementById('meta-forms-load');
  const message = document.getElementById('meta-forms-message');
  if (!paginaDosFormularios || paginaDosFormularios !== select.value) return;
  const ids = Array.from(
    document.querySelectorAll('#meta-forms-list input[name="meta-form"]:checked'),
    input => input.value
  );
  save.disabled = true;
  load.disabled = true;
  select.disabled = true;
  message.textContent = 'Salvando formulários…';
  try {
    await metaAction('save_forms', { page_id: paginaDosFormularios, form_ids: ids });
    message.textContent = 'Formulários salvos. O recebimento de leads ainda não está ativo.';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    save.disabled = false;
    load.disabled = false;
    select.disabled = false;
  }
}
