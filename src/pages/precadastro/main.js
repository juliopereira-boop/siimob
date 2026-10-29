import { A1_KEY, A1_URL } from '../../shared/api/config.js';
import { exporVariavel } from '../../shared/utils/expor.js';
import { acoes } from '../../shared/ui/acoes.js';

// Alcançáveis pela suíte de testes e por sondas typeof. Ver src/shared/utils/expor.js.
exporVariavel('$', () => $);
exporVariavel('ver', () => ver);

// O que cada data-acao do HTML faz. Ver src/shared/ui/acoes.js.
acoes({
  enviar: () => enviar()
});
// A página é pública: não existe sessão aqui. Toda escrita passa pelas funções
// a1_precad_info / a1_precad_enviar, que rodam com privilégio próprio no banco
// e fazem exatamente duas coisas — conferir o link e criar o corretor SEM acesso.
const TOKEN = new URLSearchParams(location.search).get('t') || '';
let INFO = null;

const $ = id => document.getElementById(id);
const ver = id => {
  ['v-load', 'v-invalido', 'v-form', 'v-ok'].forEach(v => $(v).classList.add('hidden'));
  $(id).classList.remove('hidden');
};

const MOTIVOS = {
  invalido: 'Este link não existe ou já foi desativado.',
  revogado: 'Este link foi desativado por quem o gerou.',
  expirado: 'O prazo deste link terminou.'
};

async function rpc(fn, body) {
  const res = await fetch(`${A1_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: A1_KEY, Authorization: `Bearer ${A1_KEY}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function boot() {
  if (!TOKEN) {
    $('invalido-txt').textContent = MOTIVOS.invalido;
    ver('v-invalido');
    return;
  }
  try {
    INFO = await rpc('a1_precad_info', { p_token: TOKEN });
  } catch (e) {
    $('invalido-txt').textContent = 'Não foi possível verificar o link agora. Tente de novo em instantes.';
    ver('v-invalido');
    return;
  }
  if (!INFO || !INFO.ok) {
    $('invalido-txt').textContent = MOTIVOS[INFO && INFO.error] || MOTIVOS.invalido;
    ver('v-invalido');
    return;
  }
  $('badge-txt').textContent = INFO.imobiliaria ? `${INFO.empresa} · ${INFO.imobiliaria}` : INFO.empresa;
  $('ok-empresa').textContent = INFO.empresa || 'a empresa';
  ver('v-form');
  $('f-nome').focus();
}

// ── Máscaras ────────────────────────────────────────────────────────────────
function mascaraCPF(v) {
  v = v.replace(/\D/g, '').slice(0, 11);
  return v
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
function mascaraFone(v) {
  v = v.replace(/\D/g, '').slice(0, 11);
  if (v.length <= 10) return v.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return v.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}
$('f-cpf').addEventListener('input', e => {
  e.target.value = mascaraCPF(e.target.value);
});
$('f-fone').addEventListener('input', e => {
  e.target.value = mascaraFone(e.target.value);
});
$('f-senha2').addEventListener('keydown', e => {
  if (e.key === 'Enter') enviar();
});

// CPF de verdade: os dois dígitos finais têm que fechar. Isso evita fila de
// validação cheia de cadastro digitado errado.
function cpfValido(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += parseInt(cpf[i], 10) * (t + 1 - i);
    let d = (s * 10) % 11;
    if (d === 10) d = 0;
    if (d !== parseInt(cpf[t], 10)) return false;
  }
  return true;
}

function erro(msg) {
  const e = $('form-err');
  e.textContent = msg;
  e.classList.remove('hidden');
}
function limpaErro() {
  $('form-err').classList.add('hidden');
}

const ERROS = {
  link_invalido: 'Este link não vale mais. Peça um novo a quem te enviou.',
  nome_vazio: 'Informe o seu nome completo.',
  cpf_invalido: 'O CPF precisa ter 11 dígitos.',
  senha_curta: 'A senha deve ter ao menos 6 caracteres.',
  cpf_duplicado: 'Já existe um cadastro com este CPF. Se você já se cadastrou, aguarde a liberação.'
};

async function enviar() {
  limpaErro();
  const nome = $('f-nome').value.trim();
  const cpf = $('f-cpf').value.replace(/\D/g, '');
  const senha = $('f-senha').value;
  const senha2 = $('f-senha2').value;

  if (nome.length < 3) return erro('Informe o seu nome completo.');
  if (!cpfValido(cpf)) return erro('CPF inválido. Confira os números.');
  if (senha.length < 6) return erro('A senha deve ter ao menos 6 caracteres.');
  if (senha !== senha2) return erro('As duas senhas não são iguais.');

  const btn = $('btn-enviar');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  try {
    const r = await rpc('a1_precad_enviar', {
      p_token: TOKEN,
      p_nome: nome,
      p_cpf: cpf,
      p_email: $('f-email').value.trim(),
      p_fone: $('f-fone').value.trim(),
      p_senha: senha
    });
    if (!r || !r.ok) throw new Error(ERROS[r && r.error] || 'Não foi possível enviar o cadastro.');
    ver('v-ok');
  } catch (e) {
    erro(
      e.message.startsWith('HTTP') ? 'Não foi possível enviar agora. Tente de novo em instantes.' : e.message
    );
    btn.disabled = false;
    btn.textContent = 'Enviar cadastro';
  }
}

boot();
