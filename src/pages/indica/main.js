// ═════════════════════════════════════════════════════════════════════════════
// INDICASII — página pública
//
// Sem login. Toda escrita passa por a1_indica_enviar / a1_indica_painel, que
// rodam com privilégio próprio no banco. As tabelas não têm leitura pública:
// sem isso, bastaria abrir o endereço da API para baixar a carteira de
// prospecção inteira, com telefone e e-mail de cada empresa indicada.
//
// Nenhum número da página é escrito à mão — tudo sai de src/modules/indica/indica-config.js.
// ═════════════════════════════════════════════════════════════════════════════

const $  = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const reservado = s => String(s || '').trim().startsWith('[');

const brl = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:0 });
const brlExato = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
const R = INDICA.recompensa;
// A recompensa incide sobre a PRIMEIRA PARCELA, nunca sobre o contrato inteiro.
const comissao = (primeiraParcela, qtd = 1) => primeiraParcela * (R.percentual / 100) * qtd;

$('ano').textContent = new Date().getFullYear();

// ═══ menu ════════════════════════════════════════════════════════════════════
const linksMenu = INDICA.menu.map(m => `<a href="#${m.id}">${esc(m.texto)}</a>`).join('');
$('nav').innerHTML = linksMenu;
$('gaveta-links').innerHTML = linksMenu;
$('rodape-menu').innerHTML = INDICA.menu.map(m => `<li><a href="#${m.id}">${esc(m.texto)}</a></li>`).join('');

const gaveta = $('gaveta'), hamb = $('hamb');
function abrirMenu(v){
  gaveta.classList.toggle('aberta', v);
  hamb.setAttribute('aria-expanded', String(v));
  document.body.style.overflow = v ? 'hidden' : '';
  if (v) gaveta.querySelector('.gaveta-x').focus();
}
hamb.addEventListener('click', () => abrirMenu(!gaveta.classList.contains('aberta')));
$('gaveta-x').addEventListener('click', () => abrirMenu(false));
gaveta.addEventListener('click', e => { if (e.target === gaveta) abrirMenu(false); });
gaveta.addEventListener('keydown', e => { if (e.key === 'Escape') { abrirMenu(false); hamb.focus(); } });
$('gaveta-links').addEventListener('click', e => { if (e.target.tagName === 'A') abrirMenu(false); });

addEventListener('scroll', () => { $('topo').classList.toggle('rolou', scrollY > 8); }, { passive:true });

// ═══ hero e simulador ════════════════════════════════════════════════════════
$('hero-perc').textContent  = R.percentual + '%';
$('hero-valor').textContent = brl.format(comissao(R.parcelaExemplo));
$('visor-ganho').textContent = brl.format(comissao(R.parcelaExemplo));
$('sim-formula').textContent = R.percentual + '%';

const sQtd = $('sim-qtd'), sVal = $('sim-val');
sQtd.max = R.maxIndicacoes;
sVal.min = R.parcelaMin; sVal.max = R.parcelaMax; sVal.step = R.parcelaPasso;
sVal.value = R.parcelaExemplo;

function calcular(){
  const q = +sQtd.value, v = +sVal.value;
  $('sim-qtd-v').textContent = q === 1 ? '1 indicação' : `${q} indicações`;
  $('sim-val-v').textContent = brl.format(v);
  $('sim-total').textContent = brl.format(comissao(v, q));
  $('sim-conta').textContent =
    `${R.percentual}% de ${brl.format(v)} × ${q} indicaç${q>1?'ões':'ão'}`;
}
sQtd.addEventListener('input', calcular);
sVal.addEventListener('input', calcular);
calcular();

// Escada de exemplos: calculada, nunca digitada.
$('escada').innerHTML = [1,2,3,5].map(n => `
  <div class="degrau">
    <div class="degrau-n">${n}</div>
    <div class="degrau-t">${n === 1 ? 'indicação convertida' : 'indicações convertidas'}</div>
    <div class="degrau-v">${brl.format(comissao(R.parcelaExemplo, n))}</div>
  </div>`).join('') +
  `<p style="font-size:.78rem;color:var(--t3);margin-top:.4rem;line-height:1.5">
     Exemplos considerando primeira parcela de ${brl.format(R.parcelaExemplo)} em cada contrato, com a recompensa paga uma vez por indicação. Mexa no simulador acima para outros valores.
   </p>`;

// ═══ diferenciais ════════════════════════════════════════════════════════════
const ICONES = {
  fluxo:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  olho:'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  pessoas:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  planilha:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  escudo:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  raio:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
};
$('grade-dif').innerHTML = INDICA.diferenciais.map(d => `
  <article class="item surge">
    <div class="icone"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[d.icone]||ICONES.fluxo}</svg></div>
    <h3>${esc(d.titulo)}</h3>
    <p>${esc(d.texto)}</p>
  </article>`).join('');

// ═══ métricas ════════════════════════════════════════════════════════════════
// Número reservado aparece esmaecido e com aviso — para ninguém publicar
// métrica inventada sem perceber.
$('grade-metricas').innerHTML = INDICA.metricas.map(m => `
  <div>
    <div class="metrica-v${reservado(m.valor)?' reservado':''}">${esc(m.valor)}</div>
    <div class="metrica-l">${esc(m.rotulo)}</div>
  </div>`).join('');
if (INDICA.metricas.some(m => reservado(m.valor))) $('metricas-nota').classList.remove('oculto');

// ═══ comparação ══════════════════════════════════════════════════════════════
function cartaoPrograma(p, destaque){
  return `<article class="prog${destaque?' destaque':''}">
    ${destaque?'<span class="prog-fita">Mais escolhido</span>':''}
    <h3>${esc(p.titulo)}</h3>
    <p class="prog-res">${esc(p.resumo)}</p>
    <ul class="prog-itens">
      ${p.itens.map(i => `<li><span class="r">${esc(i.rotulo)}</span><span class="v">${
        esc(i.valor).replace('PERCENTUAL', `<strong>${R.percentual}%</strong>`)
      }</span></li>`).join('')}
    </ul>
    <a class="btn ${destaque?'btn-1':'btn-2'} btn-lg" href="#cadastro">${esc(p.cta)}</a>
  </article>`;
}
$('comp').innerHTML = cartaoPrograma(INDICA.programas.indicacao, true)
                    + cartaoPrograma(INDICA.programas.parceria, false);

// ═══ segmentos ═══════════════════════════════════════════════════════════════
// Capas desenhadas aqui mesmo: nada de imagem de banco tirada de outro site.
const CAPAS = {
  construtora:`<svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice"><rect width="400" height="150" fill="#0D1A5E"/><g fill="#0E8C7F" opacity=".85"><rect x="40" y="60" width="52" height="90" rx="3"/><rect x="104" y="34" width="60" height="116" rx="3"/><rect x="176" y="72" width="46" height="78" rx="3"/><rect x="234" y="20" width="66" height="130" rx="3"/><rect x="312" y="56" width="50" height="94" rx="3"/></g><g fill="#7090E8" opacity=".55"><rect x="118" y="48" width="10" height="10"/><rect x="136" y="48" width="10" height="10"/><rect x="118" y="68" width="10" height="10"/><rect x="136" y="68" width="10" height="10"/><rect x="248" y="36" width="11" height="11"/><rect x="268" y="36" width="11" height="11"/><rect x="248" y="58" width="11" height="11"/><rect x="268" y="58" width="11" height="11"/></g></svg>`,
  imobiliaria:`<svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice"><rect width="400" height="150" fill="#0D1A5E"/><path d="M120 96 L200 40 L280 96 L280 150 L120 150 Z" fill="#0E8C7F" opacity=".9"/><path d="M104 100 L200 30 L296 100" stroke="#7090E8" stroke-width="7" fill="none" stroke-linejoin="round"/><rect x="182" y="112" width="36" height="38" fill="#0D1A5E"/><rect x="140" y="112" width="26" height="24" fill="#7090E8" opacity=".65"/><rect x="234" y="112" width="26" height="24" fill="#7090E8" opacity=".65"/></svg>`,
  correspondente:`<svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice"><rect width="400" height="150" fill="#0D1A5E"/><rect x="88" y="34" width="224" height="94" rx="8" fill="#0E8C7F" opacity=".9"/><rect x="110" y="56" width="120" height="9" rx="4" fill="#7090E8"/><rect x="110" y="76" width="180" height="8" rx="4" fill="#7090E8" opacity=".55"/><rect x="110" y="94" width="150" height="8" rx="4" fill="#7090E8" opacity=".4"/><circle cx="286" cy="62" r="17" fill="#0D1A5E"/><path d="M279 62l5 5 10-10" stroke="#0E8C7F" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};
$('grade-seg').innerHTML = INDICA.segmentos.map(s => `
  <article class="seg surge">
    <div class="seg-capa">${CAPAS[s.chave] || CAPAS.construtora}</div>
    <div class="seg-corpo">
      <h3>${esc(s.titulo)}</h3>
      <p>${esc(s.texto)}</p>
      <button class="seg-cta" onclick="indicarSegmento('${esc(s.titulo)}')">
        Indicar empresa
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
    </div>
  </article>`).join('');

function indicarSegmento(titulo){
  try{ sessionStorage.setItem('indica_segmento', titulo); }catch{}
  location.hash = '#cadastro';
  setTimeout(() => $('i-nome').focus(), 500);
}

// ═══ depoimentos ═════════════════════════════════════════════════════════════
$('grade-dep').innerHTML = INDICA.depoimentos.map(d => `
  <article class="dep surge">
    <p class="dep-txt">${esc(d.texto)}</p>
    <div class="dep-quem">
      <div class="dep-av" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </div>
      <div><div class="dep-nome">${esc(d.nome)}</div><div class="dep-cargo">${esc(d.cargo)}</div></div>
    </div>
  </article>`).join('');
if (INDICA.depoimentos.some(d => reservado(d.nome))) $('dep-nota').classList.remove('oculto');

// ═══ dúvidas ═════════════════════════════════════════════════════════════════
// Sanfona acessível: botão de verdade, aria-expanded, e só uma aberta por vez.
$('faq').innerHTML = INDICA.duvidas.map((d, i) => `
  <div class="faq-i" data-aberto="0">
    <h3 style="font-size:inherit;font-weight:inherit;margin:0">
      <button class="faq-b" id="faq-b-${i}" aria-expanded="false" aria-controls="faq-r-${i}" onclick="alternarFaq(${i})">
        ${esc(d.p)}
        <svg class="faq-seta" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
    </h3>
    <div class="faq-r" id="faq-r-${i}" role="region" aria-labelledby="faq-b-${i}">
      <div class="faq-r-in">${esc(d.r)}</div>
    </div>
  </div>`).join('');

function alternarFaq(i){
  const itens = [...document.querySelectorAll('#faq .faq-i')];
  const alvo = itens[i];
  const abrindo = alvo.dataset.aberto !== '1';
  itens.forEach((it, k) => {
    const aberto = abrindo && k === i;
    it.dataset.aberto = aberto ? '1' : '0';
    it.querySelector('.faq-b').setAttribute('aria-expanded', String(aberto));
    const r = it.querySelector('.faq-r');
    r.style.maxHeight = aberto ? r.scrollHeight + 'px' : '0px';
  });
}

// ═══ aparecer ao rolar ═══════════════════════════════════════════════════════
if ('IntersectionObserver' in window) {
  const obs = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('visivel'); obs.unobserve(e.target); }
  }), { threshold:.12, rootMargin:'0px 0px -40px 0px' });
  document.querySelectorAll('.surge').forEach(el => obs.observe(el));
} else {
  document.querySelectorAll('.surge').forEach(el => el.classList.add('visivel'));
}

// ═══ formulário de captura ═══════════════════════════════════════════════════
function mascaraFone(v){
  const d = v.replace(/\D/g,'').slice(0,11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/,'($1) $2').replace(/(\d{4})(\d)/,'$1-$2');
  return d.replace(/(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d)/,'$1-$2');
}
$('i-fone').addEventListener('input', e => { e.target.value = mascaraFone(e.target.value); });

function marcaErro(campo, msg){
  const inp = $('i-' + campo), el = $('e-' + campo);
  if (msg) { inp.setAttribute('aria-invalid','true'); el.textContent = msg; el.classList.remove('oculto'); }
  else     { inp.removeAttribute('aria-invalid'); el.classList.add('oculto'); }
  return !msg;
}

$('form-inicio').addEventListener('submit', e => {
  e.preventDefault();
  const nome = $('i-nome').value.trim();
  const fone = $('i-fone').value.replace(/\D/g,'');
  const okN = marcaErro('nome', nome.length < 3 ? 'Escreva seu nome completo.' : '');
  const okF = marcaErro('fone', fone.length < 10 ? 'Informe um telefone com DDD.' : '');
  if (!okN || !okF) { (!okN ? $('i-nome') : $('i-fone')).focus(); return; }
  // Guarda o que já foi digitado para a próxima tela não pedir de novo.
  try{
    sessionStorage.setItem('indica_nome', nome);
    sessionStorage.setItem('indica_fone', $('i-fone').value);
  }catch{}
  location.href = '/indica/cadastro';
});

// ═══ painel de quem já indicou ═══════════════════════════════════════════════
const ROTULO = { nova:'Recebida', em_contato:'Em contato', proposta:'Proposta enviada',
                 fechado:'Contrato fechado', perdido:'Não seguiu' };
const CORES = { nova:['#EFF6FF','#1E40AF'], em_contato:['#ECFEFF','#0E7490'], proposta:['#FEF3C7','#92400E'],
                fechado:['#ECFDF5','#047857'], perdido:['#F1F5F9','#64748B'] };

async function rpc(fn, corpo){
  const r = await fetch(`${A1_URL}/rest/v1/rpc/${fn}`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', apikey:A1_KEY, Authorization:`Bearer ${A1_KEY}` },
    body: JSON.stringify(corpo)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function erroPainel(msg){
  const e = $('p-erro');
  if (!msg) { e.classList.add('oculto'); return; }
  e.textContent = msg; e.classList.remove('oculto');
}

function entrarPainel(){
  const bruto = $('p-token').value.trim();
  // Aceita o link inteiro ou só o código — quem colou o link não deveria
  // precisar entender qual pedaço importa.
  const tok = (bruto.match(/[?&]t=([\w-]+)/) || [])[1] || bruto;
  if (!tok) { erroPainel('Cole o link ou o código que você recebeu.'); return; }
  carregarPainel(tok);
}

async function carregarPainel(token){
  erroPainel('');
  try{
    const r = await rpc('a1_indica_painel', { p_token: token });
    if (!r || !r.ok) { erroPainel('Não encontrei este código. Confira o link que você recebeu.'); return; }
    try{ localStorage.setItem('indica_token', token); }catch{}
    $('painel-entrar').classList.add('oculto');
    $('painel-dados').classList.remove('oculto');
    const lista = Array.isArray(r.indicacoes) ? r.indicacoes : [];
    $('painel-totais').innerHTML = [
      ['Indicações', String(lista.length), 'var(--t1)'],
      ['A receber',  brlExato.format(r.total_a_receber || 0), 'var(--verde)'],
      ['Total ganho', brlExato.format(r.total_geral || 0), 'var(--t1)'],
    ].map(([l,v,c]) => `<div class="item" style="text-align:center">
        <div style="font-size:.68rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--t3)">${l}</div>
        <div style="font-size:1.7rem;font-weight:900;letter-spacing:-.03em;margin-top:.25rem;color:${c}">${esc(v)}</div>
      </div>`).join('');
    $('p-tbody').innerHTML = lista.length ? lista.map(i => {
      const [bg, cor] = CORES[i.status] || CORES.nova;
      return `<tr>
        <td style="padding:.8rem 1rem;border-bottom:1px solid var(--borda)"><b>${esc(i.empresa)}</b></td>
        <td style="padding:.8rem 1rem;border-bottom:1px solid var(--borda);color:var(--t2)">${esc([i.cidade,i.uf].filter(Boolean).join(' / ') || '—')}</td>
        <td style="padding:.8rem 1rem;border-bottom:1px solid var(--borda)">
          <span style="display:inline-block;font-size:.75rem;font-weight:800;padding:.2rem .6rem;border-radius:99px;background:${bg};color:${cor}">${esc(ROTULO[i.status]||i.status)}</span>
          ${i.pago ? '<div style="font-size:.72rem;color:var(--verde);font-weight:700;margin-top:.2rem">pago</div>' : ''}
        </td>
        <td style="padding:.8rem 1rem;border-bottom:1px solid var(--borda);text-align:right;font-weight:800">${Number(i.comissao) ? brlExato.format(i.comissao) : '—'}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="4" style="padding:2rem;text-align:center;color:var(--t3)">Nenhuma indicação ainda.</td></tr>';
    $('acompanhar').scrollIntoView({ behavior:'smooth', block:'start' });
  }catch{
    erroPainel('Não consegui carregar agora. Tente de novo em instantes.');
  }
}

// Quem chega pelo link do painel já cai nele.
(function(){
  const naUrl = new URLSearchParams(location.search).get('t');
  const guardado = (()=>{ try{ return localStorage.getItem('indica_token'); }catch{ return null; } })();
  if (naUrl) carregarPainel(naUrl);
  else if (guardado) $('p-token').value = `${location.origin}/indica?t=${guardado}`;
})();
