import { A1, getSlugFromURL } from '../../shared/api/config.js';
import { a1HasModule, a1RequireAuth } from '../../shared/auth/auth.js';
import { eliaMontar } from '../../modules/elia/painel.js';

async function iniciar() {
  const panel = document.querySelector('.elia-panel');
  const status = panel.querySelector('[data-el-status]');
  const slug = encodeURIComponent(A1.slug || '');
  panel.querySelector('.elia-back').href = `/${slug}/configuracoes#integracoes`;

  try {
    a1RequireAuth(['owner', 'admin']);
  } catch {
    return;
  }

  if (getSlugFromURL() !== A1.slug) {
    location.replace(`/${slug}/configuracoes/elia${location.search}`);
    return;
  }
  const autorizado = await a1HasModule('ATENDIMENTO');
  if (autorizado !== true) {
    status.textContent =
      autorizado === null
        ? 'Não foi possível verificar o acesso à ELIA.'
        : 'O módulo Atendimento está desativado.';
    return;
  }

  try {
    await eliaMontar(panel);
  } catch (error) {
    status.textContent = error.message || 'Não foi possível carregar a ELIA.';
    status.classList.add('elia-error');
  }
}

iniciar();
