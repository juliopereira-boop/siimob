import { A1, A1_URL } from '../../shared/api/config.js';

async function concluir() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state');
  const denied = params.has('error');
  history.replaceState(null, '', location.pathname);
  const message = document.getElementById('message');
  const back = document.getElementById('back');
  const slug = A1.slug;
  if (slug && /^[a-z0-9-]+$/.test(slug)) back.href = `/${slug}/configuracoes#integracoes`;
  if (denied) {
    message.textContent = 'A autorização foi cancelada. Você pode tentar novamente nas configurações.';
    return;
  }
  if (!A1.token || !code || !state) {
    message.textContent =
      'Não foi possível concluir a conexão. Volte às configurações e tente novamente na mesma sessão.';
    return;
  }
  try {
    const res = await fetch(`${A1_URL}/functions/v1/meta-connect`, {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({ action: 'complete', code, state })
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.ok !== true || !/^[a-z0-9-]+$/.test(result.slug)) throw new Error('failed');
    back.href = `/${result.slug}/configuracoes#integracoes`;
    message.textContent =
      'Conta autorizada. As páginas e o recebimento de leads serão configurados nas próximas etapas.';
  } catch {
    message.textContent =
      'Não foi possível concluir a conexão. Volte às configurações e tente novamente na mesma sessão.';
  }
}
concluir();
