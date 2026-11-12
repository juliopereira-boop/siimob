import { A1, A1_URL } from '../../shared/api/config.js';

async function metaAction(action) {
  const response = await fetch(`${A1_URL}/functions/v1/meta-connect`, {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({ action })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      response.status === 403 || response.status === 401
        ? 'Somente administradores ativos podem gerenciar esta conexão.'
        : 'Não foi possível acessar a conexão. Tente novamente.'
    );
  }
  return data;
}

export async function metaCarregarStatus() {
  const label = document.getElementById('meta-status');
  const button = document.getElementById('meta-connect-btn');
  button.disabled = true;
  label.textContent = 'Verificando conexão…';
  try {
    const result = await metaAction('status');
    const expired = [result.token_expires_at, result.data_access_expires_at].some(
      date => date && new Date(date).getTime() <= Date.now()
    );
    label.textContent = result.connected
      ? expired
        ? 'Autorização expirada. Reconecte sua conta.'
        : 'Autorização registrada. As páginas e os leads serão configurados depois.'
      : 'Nenhuma conta conectada para esta empresa.';
    button.textContent = result.connected ? 'Reconectar com a Meta' : 'Conectar com a Meta';
    button.disabled = false;
  } catch (error) {
    label.textContent = error.message;
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
