// @ts-check
// ─── Perfis de acesso e para onde cada um vai depois do login ────────────────
//
// Usado pelas duas telas de login: a universal (/login, src/pages/entrar) e a
// de cada empresa (/empresa/login, src/pages/login). Uma regra só: se mudar o
// destino de alguém, muda nas duas ao mesmo tempo.
//
// loginType decide a função do banco: 'user' chama a1_login (equipe da
// empresa), 'partner' chama a1_partner_login (correspondente, corretor,
// analista, despachante). module: o perfil só aparece se a empresa tiver o
// módulo (o despachante depende do Registro).

/** @typedef {{key: string, label: string, sub: string, module: string|null, loginType: 'user'|'partner', color: string, icon: string}} Painel */

/** @type {Painel[]} */
export const PANELS_DEF = [
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
    </svg>`
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
    </svg>`
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
    </svg>`
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
    </svg>`
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
    </svg>`
  }
];

/**
 * Para onde a pessoa vai depois de entrar.
 * @param {{role?: string, type?: string}} user
 * @param {string} slug
 */
export function destinoDepoisDoLogin(user, slug) {
  // O despachante continua caindo direto no Registro: e o unico modulo dele, e
  // passar pela tela Geral seria uma parada a mais para chegar no mesmo lugar.
  if (user.role === 'partner' && user.type === 'despachante') return `/${slug}/registro`;
  // Todo o resto entra pela tela Geral, que mostra os modulos que a pessoa tem.
  return `/${slug}/geral`;
}
