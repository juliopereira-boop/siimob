'use strict';

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
  box.textContent = motivo === 'outro_acesso'
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

const PANELS_DEF = [
  {
    key: 'gestor',
    label: 'Gestor',
    sub: 'Acesso completo ao painel',
    module: null,
    loginType: 'user',
    color: '#0E8C7F',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#0E8C7F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>`,
  },
  {
    key: 'cca',
    label: 'Usuário Correspondente',
    sub: 'Acesso ao painel de operações',
    module: null,
    loginType: 'partner',
    color: '#3B82F6',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <line x1="2" y1="10" x2="22" y2="10"/>
    </svg>`,
  },
  {
    key: 'corretor',
    label: 'Corretor',
    sub: 'Acesso aos processos das suas etapas',
    module: null,
    loginType: 'partner',
    color: '#0E8C7F',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#0E8C7F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>
    </svg>`,
  },
  {
    key: 'analista',
    label: 'Analista',
    sub: 'Acompanhamento dos processos sob sua análise',
    module: null,
    loginType: 'partner',
    color: '#7C3AED',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#7C3AED" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
      <path d="M9 15l2 2 4-4"/>
    </svg>`,
  },
  {
    key: 'despachante',
    label: 'Despachante',
    sub: 'Acesso ao painel de registro',
    module: 'registro',
    loginType: 'partner',
    color: '#F59E0B',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>`,
  },
];

async function loadPanels() {
  let activeModules = [];
  if (slug) {
    try {
      const res = await fetch(A1.rpc('a1_public_tenant_info'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': A1_KEY, 'Authorization': `Bearer ${A1_KEY}` },
        body: JSON.stringify({ p_slug: slug })
      });
      const data = await res.json();
      activeModules = data.modules || [];
    } catch (e) { activeModules = []; }
  }

  const visible = PANELS_DEF.filter(p => !p.module || activeModules.includes(p.module));
  const container = document.getElementById('panels-container');

  if (!visible.length) {
    container.innerHTML = '<p style="color:#6B827D;font-size:.83rem;text-align:center;padding:2rem 0">Nenhum painel disponível.</p>';
    return;
  }

  const cols = visible.length === 1 ? 1 : visible.length === 3 ? 1 : 2;
  container.innerHTML = `<div class="panels-grid" style="grid-template-columns:repeat(${cols},1fr)">` +
    visible.map(p => `
      <div class="panel-card ${p.key}" onclick="selectPanel('${p.key}')">
        <div class="panel-card-icon">${p.icon}</div>
        <div class="panel-card-title">${p.label}</div>
        <div class="panel-card-sub">${p.sub}</div>
        <div class="panel-card-arrow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>`).join('') + `</div>`;
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
  const role = user.role;
  const type = user.type;
  // O despachante continua caindo direto no Registro: e o unico modulo dele, e
  // passar pela tela Geral seria uma parada a mais para chegar no mesmo lugar.
  if (role === 'partner' && type === 'despachante') {
    window.location.href = `/${slug}/registro`;
  } else {
    // Todo o resto entra pela tela Geral, que mostra os modulos que a pessoa
    // tem. Antes o sistema abria no dashboard do Repasse — e quem tinha cinco
    // modulos entrava por um deles e tinha de adivinhar o resto.
    window.location.href = `/${slug}/geral`;
  }
}

document.getElementById('cpf').addEventListener('input', e => {
  let v = e.target.value.replace(/\D/g,'').slice(0,11);
  if (v.length > 9)      v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/,'$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/,'$1.$2.$3');
  else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/,'$1.$2');
  e.target.value = v;
});

function togglePassword() {
  const input = document.getElementById('password');
  const icon  = document.getElementById('eye-icon');
  const show  = input.type === 'password';
  input.type  = show ? 'text' : 'password';
  icon.innerHTML = show
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
}

async function doLogin(e) {
  e.preventDefault();
  const cpf = document.getElementById('cpf').value;
  const pw  = document.getElementById('password').value;
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
    err.textContent  = ex.message;
    err.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent  = 'Entrar';
  }
}

// Init
loadPanels();
applyCustomLogo();
