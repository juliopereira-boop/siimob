// Passo 2 do cadastro. O envio passa por a1_indica_enviar, que roda com
// privilégio próprio no banco — a página não escreve em tabela nenhuma.
const $ = id => document.getElementById(id);
const UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO'
];
$('f-uf').innerHTML = '<option value="">Selecione</option>' + UFS.map(u => `<option>${u}</option>`).join('');

// Reaproveita o que a pessoa já digitou na landing.
try {
  const n = sessionStorage.getItem('indica_nome');
  if (n) $('f-nome').value = n;
  const f = sessionStorage.getItem('indica_fone');
  if (f) $('f-fone').value = f;
  const s = sessionStorage.getItem('indica_segmento');
  if (s) $('f-obs').value = `Segmento: ${s}. `;
} catch {}

function mascaraDoc(v) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11)
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}
function mascaraFone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}
$('f-doc').addEventListener('input', e => {
  e.target.value = mascaraDoc(e.target.value);
});
['f-fone', 'f-cfone'].forEach(id =>
  $(id).addEventListener('input', e => {
    e.target.value = mascaraFone(e.target.value);
  })
);

function marca(campo, msg) {
  const el = $('e-' + campo),
    inp = $('f-' + campo);
  if (msg) {
    if (inp) inp.setAttribute('aria-invalid', 'true');
    el.textContent = msg;
    el.classList.remove('oculto');
  } else {
    if (inp) inp.removeAttribute('aria-invalid');
    el.classList.add('oculto');
  }
  return !msg;
}
function erroGeral(msg) {
  const e = $('erro');
  if (!msg) {
    e.classList.add('oculto');
    return;
  }
  e.textContent = msg;
  e.classList.remove('oculto');
  e.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const ERROS = {
  nome_vazio: 'Escreva o seu nome.',
  empresa_vazia: 'Escreva o nome da empresa que você quer indicar.',
  documento_invalido: 'O CPF precisa ter 11 dígitos e o CNPJ, 14.'
};

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  erroGeral('');
  const nome = $('f-nome').value.trim();
  const doc = $('f-doc').value.replace(/\D/g, '');
  const emp = $('f-empresa').value.trim();
  const ok = [
    marca('nome', nome.length < 3 ? 'Escreva seu nome completo.' : ''),
    marca(
      'doc',
      doc.length !== 11 && doc.length !== 14 ? 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).' : ''
    ),
    marca('empresa', emp.length < 2 ? 'Escreva o nome da empresa.' : ''),
    marca('aceite', $('f-aceite').checked ? '' : 'Você precisa aceitar o regulamento para continuar.')
  ].every(Boolean);
  if (!ok) {
    document
      .querySelector('[aria-invalid="true"], #e-aceite:not(.oculto)')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const b = $('btn');
  b.disabled = true;
  b.textContent = 'Enviando...';
  try {
    const r = await fetch(`${A1_URL}/rest/v1/rpc/a1_indica_enviar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: A1_KEY, Authorization: `Bearer ${A1_KEY}` },
      body: JSON.stringify({
        p_nome: nome,
        p_documento: doc,
        p_email: $('f-email').value.trim(),
        p_telefone: $('f-fone').value.trim(),
        p_pix: $('f-pix').value.trim(),
        p_empresa: emp,
        p_contato_nome: $('f-cnome').value.trim(),
        p_contato_email: $('f-cemail').value.trim(),
        p_contato_fone: $('f-cfone').value.trim(),
        p_cidade: $('f-cidade').value.trim(),
        p_uf: $('f-uf').value,
        p_porte: $('f-porte').value,
        p_obs: $('f-obs').value.trim()
      })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (!d || !d.ok) {
      // "já indicada" não é fracasso: leva a pessoa para o painel dela.
      if (d && d.error === 'ja_indicada' && d.token) {
        erroGeral('Você já indicou esta empresa. Ela está no seu painel.');
        setTimeout(() => (location.href = `/indica?t=${d.token}`), 1600);
        return;
      }
      throw new Error(ERROS[d && d.error] || 'Não consegui enviar agora.');
    }
    const link = `${location.origin}/indica?t=${d.token}`;
    try {
      localStorage.setItem('indica_token', d.token);
    } catch {}
    $('ok-nome').textContent = d.nome || nome;
    $('ok-link').value = link;
    $('ir-painel').href = link;
    $('v-form').classList.add('oculto');
    $('v-ok').classList.remove('oculto');
    scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    erroGeral(
      String(err.message).startsWith('HTTP')
        ? 'Não consegui enviar agora. Tente de novo em instantes.'
        : err.message
    );
  } finally {
    b.disabled = false;
    b.textContent = 'Enviar indicação';
  }
});

function copiar() {
  navigator.clipboard.writeText($('ok-link').value).then(
    () => {
      const b = $('btn-copiar');
      b.textContent = 'Copiado';
      setTimeout(() => (b.textContent = 'Copiar'), 1800);
    },
    () => {}
  );
}
function outra() {
  ['f-empresa', 'f-cnome', 'f-cemail', 'f-cfone', 'f-cidade', 'f-obs'].forEach(id => ($(id).value = ''));
  $('v-ok').classList.add('oculto');
  $('v-form').classList.remove('oculto');
  erroGeral('');
  $('f-empresa').focus();
}
