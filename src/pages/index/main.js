import { expor, exporVariavel } from '../../shared/utils/expor.js';

// Chamadas pelo HTML (onclick="...") ou pela suíte de testes. Ver src/shared/utils/expor.js.
expor({ goToLogin });
exporVariavel('token', () => token);
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
