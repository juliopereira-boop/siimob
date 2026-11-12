import { A1, A1_KEY, getSlugFromURL } from '../../shared/api/config.js';
import { a1Login, a1ManutencaoEstado, a1MsgManutencao, a1PartnerLogin } from '../../shared/auth/auth.js';
import { esc } from '../../shared/utils/texto.js';
import { expor } from '../../shared/utils/expor.js';
import { acoes } from '../../shared/ui/acoes.js';
import { PANELS_DEF, destinoDepoisDoLogin } from '../../shared/auth/paineis.js';

// Alcançáveis pela suíte de testes e por sondas typeof. Ver src/shared/utils/expor.js.
expor({ selectPanel });

// O que cada data-acao do HTML faz. Ver src/shared/ui/acoes.js.
acoes({
  backToPanels: () => backToPanels(),
  doLogin: (el, ev) => doLogin(ev),
  selectPanel: el => selectPanel(el.dataset.key),
  togglePassword: () => togglePassword()
});
function applyCustomLogo() {
  const logo = localStorage.getItem('a1_platform_logo');
  if (!logo) return;
  document.querySelectorAll('.hdr-logo svg, .left-logo svg, .auth-logo svg, .sa-logo svg').forEach(svg => {
    const img = document.createElement('img');
    img.src = logo;
    img.style.cssText = 'height:26px;width:auto;object-fit:contain;flex-shrink:0';
    svg.replaceWith(img);
  });
}

const slug = getSlugFromURL();
document.getElementById('tenant-slug-display').textContent = slug || '?';

// Already logged in? Redirect.
if (A1.token && A1.slug === slug && A1.user) {
  redirectAfterLogin(A1.user);
}

// Chegou aqui derrubado? Explica o motivo em vez de deixar a pessoa achando
// que o sistema caiu. Um login vale para um dispositivo por vez.
(function () {
  const motivo = new URLSearchParams(location.search).get('motivo');
  if (!motivo) return;
  const box = document.getElementById('error-box');
  if (!box) return;
  box.textContent =
    motivo === 'outro_acesso'
      ? 'Sua sessão foi encerrada porque esta conta entrou em outro dispositivo. Cada login só pode estar ativo em um lugar por vez.'
      : motivo === 'conta_suspensa'
        ? 'CONTA SUSPENSA. Entre em contato com o suporte para regularizar o acesso.'
        : 'Sua sessão foi encerrada. Entre novamente para continuar.';
  box.classList.remove('hidden');
})();

// Manutenção: avisa ANTES de a pessoa digitar. O banco já recusa o login e a
// mensagem chega traduzida, mas deixar alguém digitar CPF e senha para só
// então descobrir que o sistema está parado é desperdício do tempo dela.
(async function () {
  const est = await a1ManutencaoEstado();
  if (!est || !est.ativa) return;
  const box = document.getElementById('error-box');
  if (!box) return;
  box.textContent = a1MsgManutencao({ mensagem: est.mensagem, ate: est.ate });
  box.classList.remove('hidden');
})();

let activeRole = null; // 'gestor' | 'cca' | 'despachante'

async function loadPanels() {
  let activeModules = [];
  if (slug) {
    try {
      const res = await fetch(A1.rpc('a1_public_tenant_info'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: A1_KEY, Authorization: `Bearer ${A1_KEY}` },
        body: JSON.stringify({ p_slug: slug })
      });
      const data = await res.json();
      activeModules = data.modules || [];
    } catch (e) {
      activeModules = [];
    }
  }

  const visible = PANELS_DEF.filter(p => !p.module || activeModules.includes(p.module));
  const container = document.getElementById('panels-container');

  if (!visible.length) {
    container.innerHTML =
      '<p style="color:#6B827D;font-size:.83rem;text-align:center;padding:2rem 0">Nenhum painel disponível.</p>';
    return;
  }

  const cols = visible.length === 1 ? 1 : visible.length === 3 ? 1 : 2;
  container.innerHTML =
    `<div class="panels-grid" style="grid-template-columns:repeat(${cols},1fr)">` +
    visible
      .map(
        p => `
      <div class="panel-card ${p.key}" data-acao="selectPanel" data-key="${esc(p.key)}">
        <div class="panel-card-icon">${p.icon}</div>
        <div class="panel-card-title">${p.label}</div>
        <div class="panel-card-sub">${p.sub}</div>
        <div class="panel-card-arrow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>`
      )
      .join('') +
    `</div>`;
}

function selectPanel(key) {
  activeRole = key;
  const panel = PANELS_DEF.find(p => p.key === key);
  document.getElementById('step-panels').classList.add('hidden');
  document.getElementById('step-login').classList.remove('hidden');

  const badge = document.getElementById('role-badge');
  badge.className = `role-badge ${key}`;
  badge.textContent = panel.label;

  document.getElementById('cpf').value = '';
  document.getElementById('password').value = '';
  document.getElementById('error-box').classList.add('hidden');
  document.getElementById('cpf').focus();
}

function backToPanels() {
  activeRole = null;
  document.getElementById('step-login').classList.add('hidden');
  document.getElementById('step-panels').classList.remove('hidden');
}

function redirectAfterLogin(user) {
  window.location.href = destinoDepoisDoLogin(user, slug);
}

document.getElementById('cpf').addEventListener('input', e => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  e.target.value = v;
});

function togglePassword() {
  const input = document.getElementById('password');
  const icon = document.getElementById('eye-icon');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  icon.innerHTML = show
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
}

async function doLogin(e) {
  e.preventDefault();
  const cpf = document.getElementById('cpf').value;
  const pw = document.getElementById('password').value;
  const btn = document.getElementById('btn-login');
  const err = document.getElementById('error-box');
  const panel = PANELS_DEF.find(p => p.key === activeRole);

  err.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Entrando...';

  try {
    if (!slug) throw new Error('URL inválida. Acesse /empresa/login');
    let data;
    if (panel.loginType === 'user') {
      data = await a1Login(slug, cpf, pw);
    } else {
      data = await a1PartnerLogin(slug, cpf, pw);
    }
    redirectAfterLogin(A1.user || {});
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

// Init
loadPanels();
applyCustomLogo();
