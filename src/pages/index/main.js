import { exporVariavel } from '../../shared/utils/expor.js';
import { acoes } from '../../shared/ui/acoes.js';

// Alcançáveis pela suíte de testes e por sondas typeof. Ver src/shared/utils/expor.js.
exporVariavel('token', () => token);

// O que cada data-acao do HTML faz. Ver src/shared/ui/acoes.js.
acoes({
  goToLogin: () => goToLogin()
});
const saved = localStorage.getItem('a1_slug');
const token = localStorage.getItem('a1_token');
if (saved && token) window.location.href = `/${saved}/repasse`;

document.getElementById('slug-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') goToLogin();
});

function goToLogin() {
  const slug = document
    .getElementById('slug-input')
    .value.trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  if (!slug) {
    document.getElementById('slug-input').focus();
    return;
  }
  window.location.href = `/${slug}/login`;
}
