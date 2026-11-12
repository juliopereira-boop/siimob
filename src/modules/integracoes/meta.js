import { A1, A1_URL } from '../../shared/api/config.js';

async function metaAction(action, params = {}) {
  const response = await fetch(`${A1_URL}/functions/v1/meta-connect`, {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({ action, ...params })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = {
      page_conflict: 'Uma das páginas já está vinculada a outra empresa no SIIMOB.',
      page_not_authorized:
        'A conta não tem mais acesso a uma das páginas escolhidas. Atualize a lista e tente novamente.',
      connection_changed: 'A conta foi reconectada. Atualize a lista e tente novamente.',
      reconnect: 'A autorização expirou. Reconecte sua conta Meta.',
      not_connected: 'Conecte sua conta Meta antes de escolher páginas.'
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

export async function metaCarregarStatus() {
  const label = document.getElementById('meta-status');
  const button = document.getElementById('meta-connect-btn');
  button.disabled = true;
  document.getElementById('meta-pages-open').hidden = true;
  document.getElementById('meta-pages-panel').hidden = true;
  label.textContent = 'Verificando conexão…';
  try {
    const result = await metaAction('status');
    const expired = [result.token_expires_at, result.data_access_expires_at].some(
      date => date && new Date(date).getTime() <= Date.now()
    );
    label.textContent = result.connected
      ? expired
        ? 'Autorização expirada. Reconecte sua conta.'
        : 'Autorização registrada. Escolha as páginas desta empresa.'
      : 'Nenhuma conta conectada para esta empresa.';
    button.textContent = result.connected ? 'Reconectar com a Meta' : 'Conectar com a Meta';
    button.disabled = false;
    document.getElementById('meta-pages-open').hidden = !result.connected || expired;
  } catch (error) {
    label.textContent = error.message;
  }
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
    document.getElementById('meta-status').textContent = error.message;
    button.disabled = false;
  }
}
