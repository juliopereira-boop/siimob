// @ts-check
// ─── Login universal (siimob.com/login) ──────────────────────────────────────
//
// A porta de entrada única do sistema. Antes, siimob.com abria um campo de
// "identificador da empresa" e mandava para /empresa/login; agora a raiz é o
// site e o login mora aqui, em três passos na mesma tela:
//
//   1. Empresa   o identificador (o mesmo do endereço /empresa/...). Conferido
//                em a1_public_tenant_info: empresa que não existe não avança.
//   2. Perfil    os mesmos perfis do login de cada empresa (src/shared/auth/
//                paineis.js); o de despachante só aparece com o Registro.
//   3. Acesso    CPF e senha, pelas mesmas funções do login antigo (a1Login e
//                a1PartnerLogin). A sessão gravada é exatamente a mesma.
//
// O /empresa/login continua funcionando como sempre: nada aqui mexe nele, e
// quem tem o link salvo entra pelo mesmo caminho de antes.
//
// Atalhos: /login?empresa=thecred já começa no passo 2. ?motivo=... (vindo de
// uma sessão derrubada) explica por que a pessoa voltou para cá.
import { A1, A1_KEY } from '../../shared/api/config.js';
import { a1Login, a1ManutencaoEstado, a1MsgManutencao, a1PartnerLogin } from '../../shared/auth/auth.js';
import { PANELS_DEF, destinoDepoisDoLogin } from '../../shared/auth/paineis.js';
import { acoes } from '../../shared/ui/acoes.js';
import { esc } from '../../shared/utils/texto.js';
import { expor } from '../../shared/utils/expor.js';
import { marcaSvg } from '../../modules/site/marca.js';

const RECENTES = 'a1_empresas_recentes';
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const input = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

/** @type {{empresa: string, modulos: string[], perfil: import('../../shared/auth/paineis.js').Painel|null}} */
const estado = { empresa: '', modulos: [], perfil: null };

expor({ enIrPara: irPara });

acoes({
  enContinuar: () => continuarSessao(),
  enOutraConta: () => irPara('empresa'),
  enEmpresa: (_el, ev) => {
    ev.preventDefault();
    confirmarEmpresa(input('en-empresa').value);
  },
  enLimparEmpresa: () => erro('en-erro-empresa', ''),
  enRecente: el => confirmarEmpresa(el.dataset.slug || ''),
  enPerfil: el => escolherPerfil(el.dataset.key || ''),
  enVoltar: el => irPara(/** @type {any} */ (el.dataset.p)),
  enCpf: el => mascararCpf(/** @type {HTMLInputElement} */ (el)),
  enOlho: el => alternarSenha(el),
  enEntrar: (_el, ev) => {
    ev.preventDefault();
    entrar();
  }
});

// ─── Marca ───────────────────────────────────────────────────────────────────
$('en-logo-svg').innerHTML = marcaSvg({ id: 'enl', tamanho: 34, claro: true });
$('en-logo-movel').innerHTML = marcaSvg({ id: 'enm', tamanho: 30 });
$('en-s-fundo').innerHTML = marcaSvg({ id: 'ens', tamanho: 760, claro: true });
$('en-ano').textContent = String(new Date().getFullYear());

// ─── Passos ──────────────────────────────────────────────────────────────────
const ETAPAS = ['sessao', 'empresa', 'perfil', 'senha'];

/** @param {'sessao'|'empresa'|'perfil'|'senha'} qual */
function irPara(qual) {
  ETAPAS.forEach(e => ($(`et-${e}`).hidden = e !== qual));
  $('en-passos').hidden = qual === 'sessao';
  const ordem = ['empresa', 'perfil', 'senha'];
  const i = ordem.indexOf(qual);
  $('en-passos')
    .querySelectorAll('li')
    .forEach((li, k) => {
      li.classList.toggle('feito', k < i);
      li.classList.toggle('atual', k === i);
      if (k === i) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
  const foco = { empresa: 'en-empresa', senha: 'en-cpf' }[qual];
  if (qual === 'perfil')
    setTimeout(() => /** @type {HTMLElement|null} */ ($('en-perfis').querySelector('button'))?.focus(), 40);
  else if (foco) setTimeout(() => input(foco).focus(), 40);
}

function erro(/** @type {string} */ id, /** @type {string} */ msg) {
  $(id).textContent = msg;
  $(id).hidden = !msg;
}

function ocupado(/** @type {string} */ id, /** @type {boolean} */ sim, /** @type {string} */ texto) {
  const b = /** @type {HTMLButtonElement} */ ($(id));
  b.disabled = sim;
  b.innerHTML = sim ? `<span class="en-giro" aria-hidden="true"></span>${esc(texto)}` : esc(texto);
}

// ─── 1. Empresa ──────────────────────────────────────────────────────────────
/** O identificador como o endereço usa: minúsculo, sem espaço nem acento. */
export const limparSlug = (/** @type {string} */ v) =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.)?siimob\.com(\.br)?\//, '')
    .split(/[/?#]/)[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

async function confirmarEmpresa(/** @type {string} */ bruto) {
  const slug = limparSlug(bruto);
  input('en-empresa').value = slug;
  if (!slug) {
    erro('en-erro-empresa', 'Digite o identificador da sua empresa.');
    input('en-empresa').focus();
    return;
  }
  irPara('empresa');
  ocupado('en-btn-empresa', true, 'Procurando');
  try {
    const r = await fetch(A1.rpc('a1_public_tenant_info'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: A1_KEY, Authorization: `Bearer ${A1_KEY}` },
      body: JSON.stringify({ p_slug: slug })
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || typeof d !== 'object') throw new Error('rede');
    if (d.error === 'not_found') {
      erro(
        'en-erro-empresa',
        `Não encontramos a empresa "${slug}". Confira o identificador com o administrador da sua empresa.`
      );
      input('en-empresa').select();
      return;
    }
    estado.empresa = slug;
    estado.modulos = Array.isArray(d.modules) ? d.modules : [];
    desenharPerfis();
    irPara('perfil');
  } catch {
    erro(
      'en-erro-empresa',
      'Não foi possível falar com o servidor agora. Confira a internet e tente de novo.'
    );
  } finally {
    ocupado('en-btn-empresa', false, 'Continuar');
  }
}

function recentes() {
  try {
    const l = JSON.parse(localStorage.getItem(RECENTES) || '[]');
    return Array.isArray(l) ? l.filter(s => typeof s === 'string' && /^[a-z0-9-]+$/.test(s)).slice(0, 4) : [];
  } catch {
    return [];
  }
}

function guardarRecente(/** @type {string} */ slug) {
  try {
    localStorage.setItem(RECENTES, JSON.stringify([slug, ...recentes().filter(s => s !== slug)].slice(0, 4)));
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

function desenharRecentes() {
  const salvo = localStorage.getItem('a1_slug');
  const lista = [...new Set([...recentes(), ...(salvo && /^[a-z0-9-]+$/.test(salvo) ? [salvo] : [])])].slice(
    0,
    4
  );
  $('en-recentes').hidden = !lista.length;
  $('en-recentes-lista').innerHTML = lista
    .map(
      s => `<button type="button" class="en-recente" data-acao="enRecente" data-slug="${esc(s)}">
        <span class="en-recente-ini">${esc(s.slice(0, 1).toUpperCase())}</span>
        <span class="en-recente-txt">siimob.com/<b>${esc(s)}</b></span>
        <span class="en-seta" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
      </button>`
    )
    .join('');
}

// ─── 2. Perfil ───────────────────────────────────────────────────────────────
function desenharPerfis() {
  $('en-chip-perfil').textContent = `siimob.com/${estado.empresa}`;
  const visiveis = PANELS_DEF.filter(p => !p.module || estado.modulos.includes(p.module));
  $('en-perfis').innerHTML = visiveis
    .map(
      p => `<button type="button" class="en-perfil" role="listitem" data-acao="enPerfil" data-key="${esc(p.key)}" style="--cor:${esc(p.color)}">
        <span class="en-perfil-ico">${p.icon}</span>
        <span class="en-perfil-txt"><b>${esc(p.label)}</b><small>${esc(p.sub)}</small></span>
        <span class="en-seta" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
      </button>`
    )
    .join('');
}

function escolherPerfil(/** @type {string} */ key) {
  const p = PANELS_DEF.find(x => x.key === key);
  if (!p) return;
  estado.perfil = p;
  $('en-chip-senha').textContent = `siimob.com/${estado.empresa}`;
  $('en-chip-papel').textContent = p.label;
  input('en-senha').value = '';
  erro('en-erro-senha', '');
  irPara('senha');
}

// ─── 3. CPF e senha ──────────────────────────────────────────────────────────
function mascararCpf(/** @type {HTMLInputElement} */ el) {
  let v = el.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  el.value = v;
  erro('en-erro-senha', '');
}

function alternarSenha(/** @type {HTMLElement} */ botao) {
  const campo = input('en-senha');
  const mostrar = campo.type === 'password';
  campo.type = mostrar ? 'text' : 'password';
  botao.setAttribute('aria-pressed', String(mostrar));
  botao.setAttribute('aria-label', mostrar ? 'Esconder senha' : 'Mostrar senha');
  botao.classList.toggle('on', mostrar);
}

let entrando = false;
async function entrar() {
  if (entrando || !estado.perfil) return;
  const cpf = input('en-cpf').value;
  const senha = input('en-senha').value;
  if (cpf.replace(/\D/g, '').length !== 11) return erro('en-erro-senha', 'Digite os 11 dígitos do CPF.');
  if (!senha) return erro('en-erro-senha', 'Digite a sua senha.');
  entrando = true;
  ocupado('en-btn-entrar', true, 'Entrando');
  try {
    if (estado.perfil.loginType === 'user') await a1Login(estado.empresa, cpf, senha);
    else await a1PartnerLogin(estado.empresa, cpf, senha);
    guardarRecente(estado.empresa);
    window.location.href = destinoDepoisDoLogin(A1.user || {}, estado.empresa);
  } catch (e) {
    erro('en-erro-senha', (e && /** @type {Error} */ (e).message) || 'Não foi possível entrar.');
    input('en-senha').select();
    entrando = false;
    ocupado('en-btn-entrar', false, 'Entrar');
  }
}

// ─── Já conectado ────────────────────────────────────────────────────────────
function sessaoAtual() {
  const token = localStorage.getItem('a1_token');
  const slug = localStorage.getItem('a1_slug');
  if (!token || !slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  /** @type {any} */
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem('a1_user') || 'null');
  } catch {
    user = null;
  }
  return user && typeof user === 'object' ? { slug, user } : null;
}

function continuarSessao() {
  const s = sessaoAtual();
  if (s) window.location.href = destinoDepoisDoLogin(s.user, s.slug);
  else irPara('empresa');
}

// ─── Avisos (sessão derrubada, manutenção) ───────────────────────────────────
function aviso(/** @type {string} */ msg) {
  $('en-aviso').textContent = msg;
  $('en-aviso').hidden = !msg;
}

const MOTIVOS = /** @type {Record<string,string>} */ ({
  outro_acesso:
    'Sua sessão foi encerrada porque esta conta entrou em outro dispositivo. Cada login só pode estar ativo em um lugar por vez.',
  conta_suspensa: 'Conta suspensa. Entre em contato com o suporte para regularizar o acesso.',
  sessao: 'Sua sessão foi encerrada. Entre novamente para continuar.'
});

// ─── Início ──────────────────────────────────────────────────────────────────
(function iniciar() {
  const q = new URLSearchParams(location.search);
  const motivo = q.get('motivo');
  if (motivo) aviso(MOTIVOS[motivo] || MOTIVOS.sessao);
  a1ManutencaoEstado()
    .then(est => {
      if (est && est.ativa) aviso(a1MsgManutencao({ mensagem: est.mensagem, ate: est.ate }));
    })
    .catch(() => {});

  desenharRecentes();
  const pedida = limparSlug(q.get('empresa') || '');
  const s = sessaoAtual();
  if (s && !pedida && !motivo) {
    const nome = String(s.user.name || s.user.nome || 'Sua conta');
    $('en-sessao-nome').textContent = nome;
    $('en-sessao-empresa').textContent = `siimob.com/${s.slug}`;
    $('en-sessao-avatar').textContent = nome.trim().slice(0, 1).toUpperCase() || 'S';
    irPara('sessao');
    return;
  }
  irPara('empresa');
  if (pedida) confirmarEmpresa(pedida);
})();
