// @ts-check
// ─── /contato ────────────────────────────────────────────────────────────────
//
// Os canais (WhatsApp, e-mail, telefone, horário, endereço) vêm do que o
// superadmin cadastrou em Site › Canais de contato. Canal sem dado não aparece.
// O formulário grava em a1_leads com source 'contato', e a mensagem chega na
// aba Interessados do superadmin, junto com os da LP.
import { esc } from '../../shared/utils/texto.js';
import { acoes } from '../../shared/ui/acoes.js';
import { montarCasca } from '../../modules/site/casca.js';
import { icone } from '../../modules/site/marca.js';
import { enviarContato, lerConfig, linkWhatsapp } from '../../modules/site/dados.js';

/** @type {import('../../modules/site/dados.js').ConfigSite} */
let CFG = {};

acoes({
  ctMascaraTelefone: el => {
    const i = /** @type {HTMLInputElement} */ (el);
    const d = i.value.replace(/\D/g, '').slice(0, 11);
    i.value =
      d.length > 10
        ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
        : d.length > 6
          ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
          : d.length > 2
            ? `(${d.slice(0, 2)}) ${d.slice(2)}`
            : d;
  }
});

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

function canal(
  /** @type {{href:string, ic:string, cor:string, titulo:string, texto:string, botao?:string, fora?:boolean}} */ c
) {
  const alvo = c.fora ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a class="ct-canal" href="${esc(c.href)}"${alvo}>
    <span class="ct-canal-ic ${c.cor}" aria-hidden="true">${icone(c.ic)}</span>
    <span class="ct-canal-txt"><b>${esc(c.titulo)}</b><span>${esc(c.texto)}</span></span>
    ${c.botao ? `<span class="sx-btn sx-btn-zap ct-canal-btn">${esc(c.botao)}</span>` : '<span class="ct-canal-seta" aria-hidden="true">›</span>'}
  </a>`;
}

function pintarCanais() {
  const zap = linkWhatsapp(CFG);
  const email = String(CFG.email || '').trim();
  const tel = String(CFG.telefone || '').trim();
  const cards = [];
  if (zap)
    cards.push(
      canal({
        href: zap,
        ic: 'whatsapp',
        cor: 'ct-ic-zap',
        titulo: 'WhatsApp',
        texto: 'O jeito mais rápido de falar com a gente.',
        botao: 'Falar agora',
        fora: true
      })
    );
  cards.push(
    `<a class="ct-canal" href="#ct-form-card">
      <span class="ct-canal-ic ct-ic-mar" aria-hidden="true">${icone('mensagem')}</span>
      <span class="ct-canal-txt"><b>Mande uma mensagem</b><span>Pelo formulário, a nossa equipe responde por e-mail ou WhatsApp.</span></span>
      <span class="ct-canal-seta" aria-hidden="true">›</span>
    </a>`
  );
  if (email)
    cards.push(
      canal({ href: 'mailto:' + email, ic: 'contato', cor: 'ct-ic-ardosia', titulo: 'E-mail', texto: email })
    );
  if (tel)
    cards.push(
      canal({
        href: 'tel:' + tel.replace(/[^\d+]/g, ''),
        ic: 'telefone',
        cor: 'ct-ic-ardosia',
        titulo: 'Telefone',
        texto: tel
      })
    );
  cards.push(
    canal({
      href: '/',
      ic: 'site',
      cor: 'ct-ic-petroleo',
      titulo: 'Conheça o SIIMOB',
      texto: 'Do lead ao registro: veja os módulos e os perfis.'
    }),
    canal({
      href: '/',
      ic: 'sistema',
      cor: 'ct-ic-cinza',
      titulo: 'Já é cliente?',
      texto: 'Entre no sistema com o seu acesso.'
    })
  );
  $('ct-canais').innerHTML = cards.join('');
  const linhas = [CFG.horario, CFG.endereco].map(x => String(x || '').trim()).filter(Boolean);
  const h = $('ct-horario');
  h.hidden = !linhas.length;
  h.innerHTML = linhas.map(esc).join('<br>');
}

function retorno(/** @type {string} */ msg, /** @type {string} */ tipo) {
  const r = $('ct-retorno');
  r.textContent = msg;
  r.className = 'ct-msg ' + tipo;
}

function marcar(/** @type {string} */ id, /** @type {boolean} */ invalido) {
  $(id).setAttribute('aria-invalid', String(invalido));
}

async function enviar(/** @type {SubmitEvent} */ ev) {
  ev.preventDefault();
  const form = /** @type {HTMLFormElement} */ (ev.target);
  const d = /** @type {Record<string,string>} */ (Object.fromEntries(new FormData(form).entries()));
  ['ct-nome', 'ct-email', 'ct-msg'].forEach(i => marcar(i, false));
  if (d.website) {
    mostrarOk();
    return;
  }
  if (!String(d.name || '').trim()) {
    marcar('ct-nome', true);
    retorno('Informe o seu nome.', 'erro');
    $('ct-nome').focus();
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(d.email || '').trim())) {
    marcar('ct-email', true);
    retorno('Confira o e-mail: ele parece incompleto.', 'erro');
    $('ct-email').focus();
    return;
  }
  if (!String(d.message || '').trim()) {
    marcar('ct-msg', true);
    retorno('Escreva a sua mensagem.', 'erro');
    $('ct-msg').focus();
    return;
  }
  const btn = /** @type {HTMLButtonElement} */ ($('ct-enviar'));
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  retorno('', '');
  try {
    await enviarContato({
      name: d.name,
      email: d.email,
      phone: d.phone,
      company: d.company,
      segment: d.segment,
      message: d.message
    });
    form.reset();
    mostrarOk();
  } catch {
    retorno('Não conseguimos enviar agora. Tente de novo em instantes.', 'erro');
    btn.disabled = false;
    btn.textContent = 'Enviar mensagem';
  }
}

function mostrarOk() {
  $('ct-form').hidden = true;
  const ok = $('ct-ok');
  const zap = linkWhatsapp(CFG, 'Olá! Acabei de mandar uma mensagem pelo site do SIIMOB.');
  $('ct-ok-acoes').innerHTML =
    (zap
      ? `<a class="sx-btn sx-btn-zap" href="${esc(zap)}" target="_blank" rel="noopener noreferrer">${icone('whatsapp')}Falar no WhatsApp</a>`
      : '') + '<a class="sx-btn sx-btn-linha" href="/">Conhecer o sistema</a>';
  ok.hidden = false;
  ok.focus();
}

montarCasca({ ativo: 'contato' });
$('ct-form').addEventListener('submit', enviar);
lerConfig().then(c => {
  CFG = c;
  pintarCanais();
});
