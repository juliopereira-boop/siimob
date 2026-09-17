// ─── O casco do SIIMOB: busca, cromo, modulos e o cartao de saudacao ─────────
//
// POR QUE ESTE ARQUIVO EXISTE
// A navegacao morava em tres lugares: o cabecalho proprio das telas do Repasse,
// o cabecalho proprio das telas novas e o a1MontarShell do modulo-shell. Tres
// barras diferentes para o mesmo sistema — quem trocava de tela achava que
// tinha trocado de produto.
//
// Aqui a barra e UMA. Acrescentar modulo e acrescentar uma linha em A1_MODULOS;
// a licenca decide se ele aparece, e nenhuma tela precisa saber disso.
//
// O QUE ESTE ARQUIVO NAO FAZ
// Nao decide permissao e nao protege nada. Esconder aba e conveniencia: quem
// forcar o endereco continua barrado pelo RLS, que e onde a regra mora. Nao le
// nem escreve dado de processo — so pergunta licenca e permissao.
//
// Depende de: config.js, auth.js. Substitui js/modulo-shell.js, cujos nomes
// publicos (a1MontarShell, A1_ORDEM_PAINEIS, a1VistaDaURL, a1RotuloPapel)
// continuam valendo para as telas que ja os chamam.

/* ═══════════════════════════════════════════════════════════════════════════
   1. OS MODULOS
   A ordem e a ordem do PROCESSO: o lead vira pre-analise, que vira venda, que
   vira repasse. Registro fecha a fila porque nao e etapa da mesma jornada — e
   modulo de despachante.
   ═══════════════════════════════════════════════════════════════════════════ */

const A1_ICONES = {
  geral:  '<path d="M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM3 21h8v-6H3v6ZM13 9h8V3h-8v6Z"/>',
  lead:   '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6M19 8v6"/>',
  pre:    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
  venda:  '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  repasse:'<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M10 21v-6h4v6"/>',
  registro:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.44.62.79.75H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  lupa:   '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sino:   '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  troca:  '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>',
  calend: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  sair:   '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  pessoa: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  lua:    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  sol:    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  fluxo:  '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v6a3 3 0 0 0 3 3h6"/>'
};

function a1Svg(nome, tam){
  const d = A1_ICONES[nome] || '';
  const t = tam || 16;
  return `<svg viewBox="0 0 24 24" width="${t}" height="${t}" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

// `chave` e a mesma que a licenca usa em a1_tenant_modules. `sempre:true` e so
// para o que nao depende de licenca.
const A1_MODULOS = [
  { chave:'crm',         rotulo:'Leads',       icone:'lead',
    vistas:[['Andamento','crm'],['Listagem','crm?vista=listagem'],['Dashboard','crm?vista=dashboard']] },
  { chave:'PRE_ANALISE', rotulo:'Pré-análise', icone:'pre',
    vistas:[['Andamento','pre-analise'],['Listagem','pre-analise-listagem'],
            ['Dashboard','pre-analise?vista=dashboard']] },
  { chave:'COMERCIAL',   rotulo:'Venda',       icone:'venda',
    vistas:[['Andamento','comercial'],['Listagem','comercial-listagem'],
            ['Dashboard','comercial?vista=dashboard']] },
  { chave:'repasse',     rotulo:'Repasse',     icone:'repasse',
    vistas:[['Andamento','andamento'],['Listagem','listagem']] },
  { chave:'registro',    rotulo:'Registro',    icone:'registro',
    vistas:[['Andamento','registro'],['Listagem','registro-listagem']] }
];

const A1_ORDEM_PAINEIS = ['PRE_ANALISE', 'COMERCIAL', 'repasse'];

const A1_DASHBOARD_PERMISSOES = {
  crm: 'ver_dashboard_lead',
  PRE_ANALISE: 'ver_dashboard_pre_analise',
  COMERCIAL: 'ver_dashboard_venda',
  repasse: 'ver_dashboard_repasse',
  registro: 'ver_dashboard_registro'
};

/* ═══════════════════════════════════════════════════════════════════════════
   2. QUEM E A PESSOA, E O QUE ELA PODE VER
   ═══════════════════════════════════════════════════════════════════════════ */

// Tipo desconhecido vira "Parceiro", nunca "Correspondente": chutar um papel
// que a pessoa nao tem foi um defeito real — o mesmo corretor aparecia como
// Corretor numa tela e Correspondente na outra.
function a1RotuloPapel(user){
  if (!user || user.role !== 'partner') return 'Gestor';
  return { cca:'Correspondente', despachante:'Despachante', corretor:'Corretor',
           analista:'Analista', coordenador:'Coordenador' }[user.type] || 'Parceiro';
}

function a1Esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// As iniciais do avatar. Duas letras, do primeiro e do ultimo nome — "Júlio
// César sousa pereira" vira JP, nao JC, porque e assim que a pessoa assina.
function a1Iniciais(nome){
  const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0].slice(0,2).toUpperCase();
  return (p[0][0] + p[p.length-1][0]).toUpperCase();
}

// Quais modulos este cliente tem, perguntando todos de uma vez.
// null (servidor fora do ar) NAO vira "nao tem": esconder a aba por causa de
// uma falha de rede seria trancar o cliente fora do proprio sistema — mas
// tambem nao vira "tem", senao a tela promete o que o RLS nao entrega. Fica
// como esta: a aba some, e a tela diz que nao conseguiu perguntar.
async function a1ModulosDoCliente(){
  const r = await Promise.all(A1_MODULOS.map(m => a1HasModule(m.chave).catch(() => null)));
  const tem = {};
  A1_MODULOS.forEach((m,i) => { tem[m.chave] = r[i] === true; });
  return tem;
}

async function a1DashboardsDoCliente(){
  const chaves = Object.keys(A1_DASHBOARD_PERMISSOES);
  const licencas = await Promise.all(chaves.map(m => a1HasModule(m).catch(() => null)));
  const user = A1.user || {};
  if (user.role && user.role !== 'partner'){
    const permissoes = await Promise.all(chaves.map(async (m,i) => {
      if (licencas[i] !== true) return false;
      try {
        const r = await fetch(A1.rpc('a1_perm'), { method:'POST', headers:A1.headers(),
          body:JSON.stringify({ p_chave:A1_DASHBOARD_PERMISSOES[m] }) });
        return r.ok && (await r.json()) === true;
      } catch { return false; }
    }));
    return Object.fromEntries(chaves.map((m,i) => [m, permissoes[i] === true]));
  }
  return Object.fromEntries(chaves.map((m,i) => [m, licencas[i] === true]));
}

function a1PodeVerDashboardModulo(user, modulo, licencas){
  if (!licencas || licencas[modulo] !== true || !user) return false;
  if (user.role !== 'partner') return true;
  const perms = user.permissions || {};
  return perms.gerente === true || perms[A1_DASHBOARD_PERMISSOES[modulo]] === true;
}

function a1PodeVerAlgumDashboard(user, licencas){
  return Object.keys(A1_DASHBOARD_PERMISSOES)
    .some(m => a1PodeVerDashboardModulo(user, m, licencas));
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. A MARCA
   O nome e o elemento tipografico mais forte do sistema. A marca grafica sao
   quatro formas em rotacao — duas barras e dois meios-circulos — que desenham
   a mesma ideia do produto: o processo girando de etapa em etapa.
   ═══════════════════════════════════════════════════════════════════════════ */

const A1_MARCA_SVG = `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
<defs><linearGradient id="sbm" x1="10" y1="10" x2="90" y2="90" gradientUnits="userSpaceOnUse">
<stop offset="0%" stop-color="#3FB8A6"/><stop offset="100%" stop-color="#0E8C7F"/></linearGradient></defs>
<path d="M36.4 12.9 A22.66 22.66 0 0 0 36.4 58.2 Z" fill="url(#sbm)"/>
<rect x="41.4" y="12.7" width="45.3" height="22.8" rx="11.4" fill="#fff" opacity=".92"/>
<rect x="13.4" y="64.5" width="45.3" height="22.7" rx="11.3" fill="#fff" opacity=".92"/>
<path d="M63.9 41.8 A22.66 22.66 0 0 1 63.9 87.1 Z" fill="url(#sbm)"/></svg>`;

/* ═══════════════════════════════════════════════════════════════════════════
   4. MONTAR O CASCO
   a1MontarShell(alvo, opcoes)
     opcoes.ativo  — chave do modulo desta tela, ou 'geral' | 'config'
     opcoes.vista  — 'andamento' | 'listagem' | 'dashboard'
     opcoes.sub    — [[rotulo, href, ativo?, contagem?], ...] substitui a
                     sub-barra padrao (as vistas do modulo ativo)
     opcoes.acoes  — HTML de botoes extras a direita da sub-barra
   ═══════════════════════════════════════════════════════════════════════════ */

let A1_SHELL = { tem:null, dash:null, montado:false };

async function a1MontarShell(alvo, opcoes){
  const o = opcoes || {};
  const user = A1.user || {};
  const slug = A1.slug || '';
  const ehParceiro = user.role === 'partner';
  const url = s => `/${a1Esc(slug)}/${s}`;

  a1ShellGarantirCSS();

  const [tem, dash] = await Promise.all([a1ModulosDoCliente(), a1DashboardsDoCliente()]);
  A1_SHELL.tem = tem; A1_SHELL.dash = dash;

  // ── As abas de modulo ──
  const abas = [];
  // "Geral" e a tela inicial: o retrato de todos os modulos de uma vez. Ela
  // aparece para quem pode ver o painel de PELO MENOS um modulo — quem nao pode
  // ver painel nenhum entra direto no quadro do modulo dele, e uma aba que so
  // abre uma tela vazia seria pior que aba nenhuma.
  if (a1PodeVerAlgumDashboard(user, dash)){
    abas.push(`<a class="sb-mod${o.ativo === 'geral' ? ' ativo' : ''}" href="${url('geral')}">
      ${a1Svg('geral')}<span>Geral</span></a>`);
  }
  A1_MODULOS.forEach(m => {
    if (!tem[m.chave]) return;
    abas.push(`<a class="sb-mod${o.ativo === m.chave ? ' ativo' : ''}" href="${url(a1Esc(m.vistas[0][1]))}">
      ${a1Svg(m.icone)}<span>${a1Esc(m.rotulo)}</span></a>`);
  });
  if (!ehParceiro){
    abas.push(`<a class="sb-mod${o.ativo === 'config' ? ' ativo' : ''}" href="${url('configuracoes')}"
      title="Configurações">${a1Svg('config')}<span>Configurações</span></a>`);
  }

  // ── A sub-barra: as vistas DENTRO do modulo ativo ──
  let sub = '';
  if (o.sub){
    // Duas formas, porque ha dois tipos de vista no sistema: a que TROCA DE
    // PAGINA (href) e a que troca de aba dentro da mesma pagina (acao). Forcar
    // as duas a virarem link faria a segunda recarregar a tela inteira para
    // mostrar uma div que ja estava carregada.
    sub = o.sub.map(v => {
      const it = Array.isArray(v) ? { rot:v[0], href:v[1], ativo:v[2], n:v[3] } : v;
      const conta = it.n != null ? `<span class="sb-sub-conta" ${it.id ? `id="${a1Esc(it.id)}"` : ''}>${a1Esc(String(it.n))}</span>` : '';
      const marca = it.ativo ? ' ativo' : '';
      return it.acao
        ? `<button type="button" class="sb-sub-item${marca}" data-vista="${a1Esc(it.chave || it.rot)}"
             onclick="${a1Esc(it.acao)}">${a1Esc(it.rot)}${conta}</button>`
        : `<a class="sb-sub-item${marca}" href="${a1Esc(it.href || '#')}">${a1Esc(it.rot)}${conta}</a>`;
    }).join('');
  } else {
    const mod = A1_MODULOS.find(m => m.chave === o.ativo);
    if (mod && tem[mod.chave]){
      const vistaAtual = (o.vista || a1VistaDaURL()).toLowerCase();
      sub = mod.vistas
        .filter(([rot]) => rot !== 'Dashboard' || a1PodeVerDashboardModulo(user, mod.chave, dash))
        .map(([rot, rota]) =>
          `<a class="sb-sub-item${vistaAtual === rot.toLowerCase() ? ' ativo' : ''}"
              href="${url(a1Esc(rota))}">${a1Esc(rot)}</a>`).join('');
    }
  }

  alvo.innerHTML = `
    <a class="sb-pular" href="#conteudo">Ir para o conteúdo</a>
    <div class="sb-busca-faixa">
      <form class="sb-busca" role="search" onsubmit="return a1BuscaSubmeter(event)">
        ${a1Svg('lupa', 15)}
        <input id="sb-busca-campo" type="search" autocomplete="off" placeholder="Buscar tela, processo ou pessoa"
               aria-label="Buscar no sistema" onfocus="a1PaletaAbrir()">
        <kbd class="sb-atalho">Ctrl K</kbd>
      </form>
    </div>
    <header class="sb-cromo">
      <div class="sb-cromo-linha">
        <a class="sb-marca" href="${url('geral')}" aria-label="SIIMOB, ir para a visão geral">
          ${A1_MARCA_SVG}<span>SIIMOB</span></a>
        <nav class="sb-mods" aria-label="Módulos">${abas.join('')}</nav>
        <div class="sb-cromo-dir">
          <button class="sb-icone" type="button" title="Minha agenda" data-pop="agenda"
            onclick="a1AgendaAbrir(event)">${a1Svg('calend',17)}</button>
          <button class="sb-icone" type="button" title="Avisos" data-pop="avisos"
            onclick="a1AvisosAbrir(event)">
            ${a1Svg('sino',17)}<span class="sb-icone-selo" id="sb-avisos-n" data-zero="1" hidden>0</span></button>

          <div class="sb-pessoa">
            <div class="sb-pessoa-txt">
              <div class="sb-pessoa-email">${a1Esc(a1RotuloPapel(user))}</div>
              <div class="sb-pessoa-nome">${a1Esc(user.name || '')}</div>
            </div>
            <button class="sb-avatar" type="button" id="sb-avatar" title="Minha conta"
              aria-haspopup="menu" aria-expanded="false"
              onclick="a1MenuPessoa(event)">${a1Esc(a1Iniciais(user.name))}</button>
          </div>
        </div>
      </div>
    </header>
    ${sub || o.acoes ? `<nav class="sb-sub" aria-label="Vistas">${sub}
      ${o.acoes ? `<span style="margin-left:auto;display:flex;align-items:center;gap:.4rem">${o.acoes}</span>` : ''}</nav>` : ''}
    <div class="sb-paleta" id="sb-paleta" hidden onclick="if(event.target===this)a1PaletaFechar()">
      <div class="sb-paleta-cx" role="dialog" aria-label="Buscar">
        <div class="sb-paleta-campo">${a1Svg('lupa',17)}
          <input id="sb-paleta-campo" type="text" placeholder="Ir para…" autocomplete="off"
                 oninput="a1PaletaFiltrar()" onkeydown="a1PaletaTecla(event)"></div>
        <div class="sb-paleta-lista" id="sb-paleta-lista"></div>
      </div>
    </div>`;

  A1_SHELL.montado = true;
  a1PaletaMontarIndice(tem, dash, user, slug);
  // O contador do sino sai do caminho da tela: se demorar ou falhar, o sistema
  // ja esta montado e utilizavel. Cabecalho que espera por um numero opcional
  // faz todo mundo esperar por ele.
  a1AvisosPrimeiraContagem();
  return tem;
}

function a1ShellGarantirCSS(){
  if (!document.getElementById('sb-css')){
    const l = document.createElement('link');
    l.id = 'sb-css'; l.rel = 'stylesheet'; l.href = '/css/siimob.css';
    document.head.appendChild(l);
  }
  if (!document.getElementById('sb-fonte')){
    const f = document.createElement('link');
    f.id = 'sb-fonte'; f.rel = 'stylesheet';
    f.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&display=swap';
    document.head.appendChild(f);
  }
}

// Marca qual vista da sub-barra esta ativa. Existe porque as telas que trocam
// de aba SEM recarregar tinham cada uma a sua linha para isso — e o dia em que
// uma esquecesse, a barra ficaria mostrando a aba errada em silencio.
function a1ShellVista(chave){
  document.querySelectorAll('.sb-sub-item[data-vista]').forEach(el =>
    el.classList.toggle('ativo', el.dataset.vista === chave));
}

// Trocar o nome no cabecalho depois que a pessoa edita o proprio perfil. Antes
// cada tela escrevia direto no #hdr-user dela; agora o nome mora num lugar so,
// e a inicial do avatar acompanha — que era o detalhe que ninguem lembrava de
// atualizar junto.
function a1ShellNome(nome){
  const el = document.querySelector('.sb-pessoa-nome');
  if (el) el.textContent = String(nome == null ? '' : nome);
  const av = document.querySelector('.sb-avatar');
  if (av) av.textContent = a1Iniciais(nome);
  const hav = document.querySelector('.sb-hero-av');
  if (hav) hav.textContent = a1Iniciais(nome);
}

function a1ShellIr(destino){
  const slug = A1.slug || '';
  if (destino === 'agenda') location.href = `/${slug}/repasse?tab=agenda`;
  if (destino === 'avisos') location.href = `/${slug}/configuracoes?cfg=avisos`;
}

// Qual vista a URL esta pedindo. E o caminho que manda, para o link do menu e o
// botao "voltar" do navegador continuarem valendo.
function a1VistaDaURL(){
  const q = new URLSearchParams(location.search).get('vista');
  if (q === 'listagem' || q === 'andamento' || q === 'dashboard') return q;
  if (new URLSearchParams(location.search).get('tab') === 'dash') return 'dashboard';
  return /-listagem\/?$/.test(location.pathname) ? 'listagem' : 'andamento';
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. A PALETA DE COMANDOS (Ctrl+K)
   Uma lista so, montada da licenca e da permissao. O que a pessoa nao pode
   abrir nao entra no indice — paleta que oferece porta trancada e pior que
   paleta sem a porta.
   ═══════════════════════════════════════════════════════════════════════════ */

let A1_PALETA = { itens:[], filtrados:[], marcado:0 };

function a1PaletaMontarIndice(tem, dash, user, slug){
  const url = s => `/${slug}/${s}`;
  const itens = [];
  if (a1PodeVerAlgumDashboard(user, dash)) itens.push({ g:'Geral', r:'Visão geral', h:url('geral'), i:'geral' });
  A1_MODULOS.forEach(m => {
    if (!tem[m.chave]) return;
    m.vistas.forEach(([rot, rota]) => {
      if (rot === 'Dashboard' && !a1PodeVerDashboardModulo(user, m.chave, dash)) return;
      itens.push({ g:m.rotulo, r:`${m.rotulo} · ${rot}`, h:url(rota), i:m.icone });
    });
  });
  if (user.role !== 'partner'){
    itens.push({ g:'Configurações', r:'Configurações', h:url('configuracoes'), i:'config' });
    itens.push({ g:'Configurações', r:'Editor de esteira', h:url('workflow'), i:'fluxo' });
    itens.push({ g:'Configurações', r:'Importar dados', h:url('importar'), i:'troca' });
  }
  itens.push({ g:'Sessão', r:'Sair do sistema', h:'#sair', i:'sair' });
  A1_PALETA.itens = itens;
}

function a1PaletaAbrir(){
  const p = document.getElementById('sb-paleta');
  if (!p) return;
  p.hidden = false;
  const c = document.getElementById('sb-paleta-campo');
  if (c){ c.value = ''; c.focus(); }
  a1PaletaFiltrar();
  const b = document.getElementById('sb-busca-campo');
  if (b) b.blur();
}
function a1PaletaFechar(){
  const p = document.getElementById('sb-paleta');
  if (p) p.hidden = true;
}
function a1PaletaFiltrar(){
  const c = document.getElementById('sb-paleta-campo');
  const lista = document.getElementById('sb-paleta-lista');
  if (!lista) return;
  const q = a1Normal((c && c.value) || '');
  A1_PALETA.filtrados = q
    ? A1_PALETA.itens.filter(x => a1Normal(x.r).includes(q) || a1Normal(x.g).includes(q))
    : A1_PALETA.itens.slice();
  A1_PALETA.marcado = 0;
  if (!A1_PALETA.filtrados.length){
    lista.innerHTML = `<div class="sb-vazio"><p>Nada com esse nome. Tente o nome do módulo — Leads, Repasse, Registro.</p></div>`;
    return;
  }
  let grupo = '', out = '';
  A1_PALETA.filtrados.forEach((x, i) => {
    if (x.g !== grupo){ grupo = x.g; out += `<div class="sb-paleta-grupo">${a1Esc(grupo)}</div>`; }
    out += `<a class="sb-paleta-item${i === 0 ? ' marcado' : ''}" data-i="${i}" href="${a1Esc(x.h)}"
      onclick="return a1PaletaAbrirItem(${i},event)">${a1Svg(x.i,15)}<span>${a1Esc(x.r)}</span></a>`;
  });
  lista.innerHTML = out;
}
function a1PaletaAbrirItem(i, ev){
  const x = A1_PALETA.filtrados[i];
  if (!x) return false;
  if (x.h === '#sair'){ if (ev) ev.preventDefault(); a1Logout(); return false; }
  return true;
}
function a1PaletaTecla(ev){
  if (ev.key === 'Escape'){ a1PaletaFechar(); return; }
  const n = A1_PALETA.filtrados.length;
  if (!n) return;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){
    ev.preventDefault();
    A1_PALETA.marcado = (A1_PALETA.marcado + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n;
    const lista = document.getElementById('sb-paleta-lista');
    [...lista.querySelectorAll('.sb-paleta-item')].forEach((el, i) =>
      el.classList.toggle('marcado', i === A1_PALETA.marcado));
    const el = lista.querySelector('.sb-paleta-item.marcado');
    if (el) el.scrollIntoView({ block:'nearest' });
  }
  if (ev.key === 'Enter'){
    ev.preventDefault();
    const x = A1_PALETA.filtrados[A1_PALETA.marcado];
    if (!x) return;
    if (x.h === '#sair') a1Logout(); else location.href = x.h;
  }
}
// Acento nao pode atrapalhar a busca: quem digita "pre analise" tem de achar
// "Pré-análise". Normalizar na entrada e na comparacao, nos dois lados.
function a1Normal(s){
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function a1BuscaSubmeter(ev){
  ev.preventDefault();
  a1PaletaAbrir();
  const b = document.getElementById('sb-busca-campo');
  const c = document.getElementById('sb-paleta-campo');
  if (b && c && b.value){ c.value = b.value; a1PaletaFiltrar(); }
  return false;
}
document.addEventListener('keydown', ev => {
  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')){
    ev.preventDefault();
    const p = document.getElementById('sb-paleta');
    if (p) (p.hidden ? a1PaletaAbrir : a1PaletaFechar)();
  }
  if (ev.key === 'Escape') a1PaletaFechar();
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. O CARTAO DE SAUDACAO
   a1Hero(alvo, {hoje:[{n, rotulo, tom}]})
   O ceu muda com a hora e as estrelas saem do apelido do cliente: cada empresa
   tem o SEU ceu, e sempre o mesmo. Nao ha animacao — ceu que pisca em tela de
   trabalho vira ruido, e gasta bateria de quem passa oito horas aqui.
   ═══════════════════════════════════════════════════════════════════════════ */

// Sorteio com semente. Math.random daria um ceu diferente a cada F5, e o que
// muda sozinho o olho le como defeito.
function a1Semente(txt){
  let h = 2166136261;
  for (let i = 0; i < String(txt).length; i++){
    h ^= String(txt).charCodeAt(i); h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function a1Sorteio(semente){
  let a = semente >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const A1_CEUS = {
  // [de cima, para baixo, cor da estrela, quantas]
  madrugada:['#061726','#0C3A46','#CFE8F0', 46],
  manha:    ['#1B6E7E','#4FA9A0','#FFFFFF',  0],
  tarde:    ['#0E6A6E','#1E8C7C','#FFFFFF',  0],
  entardecer:['#123E52','#B06A3C','#FFE6C2', 10],
  noite:    ['#04202C','#0B5049','#DCEFEA', 38]
};
function a1FaseDoDia(h){
  if (h < 5)  return 'madrugada';
  if (h < 11) return 'manha';
  if (h < 17) return 'tarde';
  if (h < 19) return 'entardecer';
  return 'noite';
}
function a1Saudacao(h){
  if (h < 5)  return ['Boa madrugada','lua'];
  if (h < 12) return ['Bom dia','sol'];
  if (h < 18) return ['Boa tarde','sol'];
  return ['Boa noite','lua'];
}

function a1Hero(alvo, opcoes){
  const o = opcoes || {};
  const user = A1.user || {};
  const agora = new Date();
  const [saud, icone] = a1Saudacao(agora.getHours());
  const primeiro = String(user.name || '').trim().split(/\s+/)[0] || 'Olá';
  // O nome da empresa e gravado no login em a1_user.tenant_name. O login de
  // parceiro pode nao trazer — e ai vale o apelido do cliente, que sempre ha.
  const empresa = o.empresa || user.tenant_name || (A1.slug || '').toUpperCase();

  const hoje = (o.hoje || []).filter(x => x && x.n).map(x =>
    `<span class="${a1Esc(x.tom || '')}"><b>${a1Esc(String(x.n))}</b> ${a1Esc(x.rotulo)}</span>`).join('');

  alvo.innerHTML = `
    <section class="sb-hero" id="sb-hero">
      <canvas class="sb-ceu" id="sb-ceu" aria-hidden="true"></canvas>
      <div class="sb-hero-esq">
        <div class="sb-hero-av">${a1Esc(a1Iniciais(user.name))}</div>
        <div style="min-width:0">
          <div class="sb-hero-saud">${a1Svg(icone,14)}<span>${a1Esc(saud)}</span></div>
          <h1 class="sb-hero-nome">${a1Esc(primeiro)}</h1>
          ${empresa ? `<span class="sb-hero-emp">${a1Esc(empresa)}</span>` : ''}
        </div>
      </div>
      <div class="sb-hero-dir">
        <div class="sb-relogio" id="sb-relogio">${a1Hora(agora)}</div>
        <div class="sb-hero-data">${a1Esc(a1DataLonga(agora))}</div>
        ${hoje ? `<div class="sb-hero-hoje">${hoje}</div>` : ''}
      </div>
    </section>`;

  a1DesenharCeu();
  a1RelogioLigar();
  if (!a1Hero._resize){
    a1Hero._resize = true;
    window.addEventListener('resize', () => a1DesenharCeu(), { passive:true });
  }
}

function a1Hora(d){
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
const A1_DIAS = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const A1_MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function a1DataLonga(d){
  return `${A1_DIAS[d.getDay()]}, ${d.getDate()} de ${A1_MESES[d.getMonth()]} de ${d.getFullYear()}`;
}
// O relogio acerta no virar do minuto, nao de segundo em segundo: o numero so
// muda de minuto em minuto, e acordar o navegador 60 vezes por minuto para
// redesenhar o mesmo texto e gasto puro.
function a1RelogioLigar(){
  if (a1RelogioLigar._t) clearTimeout(a1RelogioLigar._t);
  const passo = () => {
    const el = document.getElementById('sb-relogio');
    if (!el) return;
    const d = new Date();
    el.textContent = a1Hora(d);
    a1RelogioLigar._t = setTimeout(passo, (60 - d.getSeconds()) * 1000 + 200);
  };
  const d = new Date();
  a1RelogioLigar._t = setTimeout(passo, (60 - d.getSeconds()) * 1000 + 200);
}

function a1DesenharCeu(){
  const c = document.getElementById('sb-ceu');
  const hero = document.getElementById('sb-hero');
  if (!c || !hero) return;
  const L = hero.clientWidth, A = hero.clientHeight;
  if (!L || !A) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = L * dpr; c.height = A * dpr;
  const g = c.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const fase = a1FaseDoDia(new Date().getHours());
  const [cima, baixo, corEstrela, nEstrelas] = A1_CEUS[fase];

  const grad = g.createLinearGradient(0, 0, L * .75, A);
  grad.addColorStop(0, cima); grad.addColorStop(1, baixo);
  g.fillStyle = grad; g.fillRect(0, 0, L, A);

  // Um claro difuso no canto direito, atras do relogio: da profundidade sem
  // desenhar nada que precise de explicacao.
  const halo = g.createRadialGradient(L * .84, A * .28, 0, L * .84, A * .28, A * 1.5);
  halo.addColorStop(0, 'rgba(255,255,255,.10)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo; g.fillRect(0, 0, L, A);

  if (!nEstrelas) return;
  const rnd = a1Sorteio(a1Semente((A1.slug || 'siimob') + '|' + fase));
  for (let i = 0; i < nEstrelas; i++){
    const x = rnd() * L, y = rnd() * A * .88, r = rnd() * 1.1 + .35;
    g.globalAlpha = .22 + rnd() * .55;
    g.fillStyle = corEstrela;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Uma estrela maior, com brilho de quatro pontas. E o unico ornamento da
  // tela inteira, e por isso ele pode existir.
  const bx = L * (.26 + rnd() * .34), by = A * (.16 + rnd() * .3);
  g.globalAlpha = 1; g.fillStyle = corEstrela;
  g.beginPath(); g.arc(bx, by, 1.5, 0, Math.PI * 2); g.fill();
  g.globalAlpha = .5; g.strokeStyle = corEstrela; g.lineWidth = .8;
  g.beginPath();
  g.moveTo(bx - 6, by); g.lineTo(bx + 6, by);
  g.moveTo(bx, by - 6); g.lineTo(bx, by + 6);
  g.stroke();
  g.globalAlpha = 1;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. INDICADORES E CARTOES — para as telas nao reinventarem o mesmo HTML
   ═══════════════════════════════════════════════════════════════════════════ */

// tom: 'marca' (padrao) | 'atento' | 'atraso' | 'info' | 'neutro'
function a1Kpi(k){
  const corpo = `<div class="sb-kpi-valor">${a1Esc(String(k.valor))}</div>
    <div class="sb-kpi-rot">${a1Esc(k.rotulo)}</div>
    ${k.sub ? `<div class="sb-kpi-sub">${a1Esc(k.sub)}</div>` : ''}`;
  const attrs = `class="sb-kpi" data-tom="${a1Esc(k.tom || 'marca')}"${k.titulo ? ` title="${a1Esc(k.titulo)}"` : ''}`;
  return k.href ? `<a ${attrs} href="${a1Esc(k.href)}">${corpo}</a>` : `<div ${attrs}>${corpo}</div>`;
}
function a1Kpis(lista){
  return `<div class="sb-kpis">${lista.map(a1Kpi).join('')}</div>`;
}
function a1Card(o){
  return `<section class="sb-card">
    <div class="sb-card-cab">
      <div><div class="sb-card-tit">${a1Esc(o.titulo)}</div>
      ${o.sub ? `<div class="sb-card-sub">${a1Esc(o.sub)}</div>` : ''}</div>
      ${o.acao ? `<div class="sb-card-acao">${o.acao}</div>` : ''}
    </div>
    <div class="sb-card-corpo${o.justo ? ' justo' : ''}">${o.corpo || ''}</div>
  </section>`;
}
function a1Vazio(texto){
  return `<div class="sb-vazio">${a1Svg('fluxo',26)}<p>${a1Esc(texto)}</p></div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. OS TRES PAINEIS DO CABECALHO — agenda, avisos e a conta

   POR QUE ESTAO AQUI, E NAO EM CADA TELA
   Sao do CASCO, nao do modulo. A agenda de uma pessoa e a mesma esteja ela no
   Repasse ou no Registro; o aviso de avaliacao vencendo nao muda de texto
   conforme a aba aberta. Cada tela tendo a sua copia foi o que produziu seis
   cabecalhos diferentes — e este arquivo existe para isso nao se repetir.

   O QUE ELES LEEM
   Nada que nao seja da pessoa: as consultas passam pelo RLS como qualquer
   outra, entao o corretor ve a agenda DELE. O recorte e sempre estreito — o
   mes na tela, os proximos 14 dias, os 20 mais recentes — porque painel de
   cabecalho que baixa colecao inteira trava o sistema em TODA tela, e nao so
   numa.
   ═══════════════════════════════════════════════════════════════════════════ */

const A1_POP = { aberto: null, agenda: { mes: null, ano: null, dia: null, itens: null }, avisos: null };

function a1PopFechar(){
  document.querySelectorAll('.sb-pop').forEach(el => el.remove());
  const av = document.getElementById('sb-avatar');
  if (av) av.setAttribute('aria-expanded', 'false');
  A1_POP.aberto = null;
}

// Ancora o painel embaixo do botao que o chamou, e nunca para fora da tela: o
// ultimo icone da direita abriria um painel metade fora do monitor.
function a1PopAbrir(nome, botao, largura, html){
  const jaEstava = A1_POP.aberto === nome;
  a1PopFechar();
  if (jaEstava) return null;
  const el = document.createElement('div');
  el.className = 'sb-pop';
  el.id = 'sb-pop';
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = botao.getBoundingClientRect();
  const L = Math.min(largura, window.innerWidth - 16);
  let esq = r.right - L;
  if (esq < 8) esq = 8;
  if (esq + L > window.innerWidth - 8) esq = window.innerWidth - 8 - L;
  el.style.width = L + 'px';
  el.style.left = esq + 'px';
  el.style.top = (r.bottom + 8) + 'px';
  A1_POP.aberto = nome;
  return el;
}

document.addEventListener('click', ev => {
  if (!A1_POP.aberto) return;
  if (ev.target.closest('.sb-pop') || ev.target.closest('[data-pop]')) return;
  a1PopFechar();
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') a1PopFechar(); });
window.addEventListener('resize', () => a1PopFechar(), { passive:true });

/* ── A conta ───────────────────────────────────────────────────────────────
   O avatar encerrava a sessao com um clique. Um clique sem confirmacao, no
   canto onde todo sistema poe o perfil — quem ia ver o proprio cadastro caia
   na tela de login. Agora abre menu, e sair e o ultimo item.                */

function a1MenuPessoa(ev){
  ev.preventDefault(); ev.stopPropagation();
  const user = A1.user || {};
  const slug = A1.slug || '';
  const bt = ev.currentTarget;
  // openProfile() e das telas do Repasse. Onde ela nao existe, o cadastro da
  // pessoa mora em Configuracoes — e o parceiro, que nao entra la, edita o
  // proprio perfil pela mesma funcao quando ela existir.
  const temPerfil = typeof openProfile === 'function';
  const el = a1PopAbrir('pessoa', bt, 262, `
    <div class="sb-menu-cab">
      <div class="sb-menu-av">${a1Esc(a1Iniciais(user.name))}</div>
      <div style="min-width:0">
        <div class="sb-menu-nome">${a1Esc(user.name || '')}</div>
        <div class="sb-menu-papel">${a1Esc(a1RotuloPapel(user))}${
          user.tenant_name ? ' · ' + a1Esc(user.tenant_name) : ''}</div>
      </div>
    </div>
    ${temPerfil
      ? `<button class="sb-menu-item" type="button" onclick="a1PopFechar();openProfile()">
           ${a1Svg('pessoa',15)} Meu cadastro</button>`
      : `<a class="sb-menu-item" href="/${a1Esc(slug)}/repasse?perfil=1">
           ${a1Svg('pessoa',15)} Meu cadastro</a>`}
    <button class="sb-menu-item" type="button" onclick="a1PopFechar();a1PaletaAbrir()">
      ${a1Svg('lupa',15)} Buscar no sistema <small style="margin-left:auto;color:var(--sb-tinta3);font-family:var(--sb-mono);font-size:.68rem">Ctrl K</small></button>
    ${user.role !== 'partner'
      ? `<a class="sb-menu-item" href="/${a1Esc(slug)}/configuracoes">${a1Svg('config',15)} Configurações</a>` : ''}
    <button class="sb-menu-item saida" type="button" onclick="a1Logout()">
      ${a1Svg('sair',15)} Sair do sistema</button>`);
  if (el) bt.setAttribute('aria-expanded', 'true');
}

/* ── A agenda ──────────────────────────────────────────────────────────────
   Mes na tela, compromissos do dia escolhido. Os dois tipos que o sistema ja
   guarda hoje: a ENTREVISTA marcada (payload.agendamento_data, escrita pela
   tela do Repasse) e o VENCIMENTO da avaliacao (evaluation_expiry). Sao os
   mesmos dados do calendario do dashboard do Repasse — de proposito: duas
   agendas com numeros diferentes seriam duas verdades sobre o mesmo dia.    */

async function a1AgendaCarregar(ano, mes){
  const pad = n => String(n).padStart(2,'0');
  const de  = `${ano}-${pad(mes+1)}-01`;
  const ate = `${ano}-${pad(mes+1)}-${pad(new Date(ano, mes+1, 0).getDate())}`;
  const h = { headers: A1.headers() };
  const base = `${A1.rest('a1_cases')}?module_key=eq.repasse&archived=eq.false`;
  const [venc, ent, meus] = await Promise.all([
    fetch(`${base}&evaluation_expiry=gte.${de}&evaluation_expiry=lte.${ate}` +
          `&select=id,client_name,evaluation_expiry,stage_name&order=evaluation_expiry.asc&limit=300`, h)
      .then(r => r.ok ? r.json() : []).catch(() => []),
    // O agendamento mora dentro do jsonb. O filtro `->>` faz o corte no
    // servidor; trazer o mes inteiro para filtrar no navegador seria pedir
    // tudo de novo, que e o que esta tela existe para nao fazer.
    fetch(`${base}&payload->>agendamento_data=gte.${de}&payload->>agendamento_data=lte.${ate}T23:59:59` +
          `&select=id,client_name,stage_name,payload->>agendamento_data&order=created_at.desc&limit=300`, h)
      .then(r => r.ok ? r.json() : []).catch(() => []),
    // O que a PESSOA marcou. A tabela pode ainda não existir no banco do
    // cliente — o SQL é rodado à mão —, e nesse caso a agenda continua
    // mostrando entrevistas e vencimentos em vez de quebrar.
    fetch(`${A1.rest('a1_agenda')}?data=gte.${de}&data=lte.${ate}` +
          `&select=id,tipo,titulo,descricao,local,data,hora_inicio,hora_fim,caso_id,concluido_em` +
          `&order=data.asc&limit=400`, h)
      .then(r => r.ok ? r.json() : []).catch(() => [])
  ]);
  const itens = [];
  (Array.isArray(venc) ? venc : []).forEach(c => itens.push({
    dia: String(c.evaluation_expiry || '').slice(8,10), tipo:'venc',
    titulo: c.client_name || 'Sem nome', sub: 'Vencimento da avaliação',
    etapa: c.stage_name || '', id: c.id, hora: '' }));
  (Array.isArray(ent) ? ent : []).forEach(c => {
    const d = String(c.agendamento_data || '');
    if (d.length < 10) return;
    itens.push({ dia: d.slice(8,10), tipo:'ent',
      titulo: c.client_name || 'Sem nome', sub: 'Entrevista agendada',
      etapa: c.stage_name || '', id: c.id, hora: d.slice(11,16) });
  });
  (Array.isArray(meus) ? meus : []).forEach(a => {
    const d = String(a.data || '');
    if (d.length < 10) return;
    itens.push({ dia: d.slice(8,10), tipo: a.tipo === 'tarefa' ? 'tarefa' : 'meu',
      titulo: a.titulo || 'Sem título',
      sub: [a.tipo === 'tarefa' ? 'Tarefa' : 'Compromisso', a.local, a.descricao]
             .filter(Boolean).join(' · '),
      etapa: '', id: a.id, agendaId: a.id, casoId: a.caso_id || null,
      feito: !!a.concluido_em,
      hora: a.hora_inicio ? String(a.hora_inicio).slice(0,5) : '' });
  });
  return itens;
}

// ── Marcar na agenda ───────────────────────────────────────────────────────
// O formulário abre DENTRO do mesmo painel, no dia que já está selecionado. Um
// modal em cima do calendário esconderia justamente a informação que a pessoa
// usou para escolher a data.

const A1_AGENDA_CORES = { compromisso:'var(--sb-mar)', tarefa:'var(--sb-ametista)' };

function a1AgendaNovo(){
  const alvo = document.getElementById('sb-agenda-corpo');
  if (!alvo) return;
  const { ano, mes, dia } = A1_POP.agenda;
  const pad = n => String(n).padStart(2,'0');
  const dataSel = `${ano}-${pad(mes+1)}-${pad(dia || 1)}`;
  alvo.innerHTML = `
    <form class="sb-ag-form" onsubmit="return a1AgendaGravar(event)">
      <div class="sb-ag-tipo" role="group" aria-label="Tipo">
        <button type="button" class="on" data-tipo="compromisso" onclick="a1AgendaTipo(this)">Compromisso</button>
        <button type="button" data-tipo="tarefa" onclick="a1AgendaTipo(this)">Tarefa</button>
      </div>
      <label class="sb-ag-rot">Título</label>
      <input id="ag-titulo" class="sb-ag-campo" required maxlength="120" placeholder="Visita ao cliente, ligar para o banco…">
      <div class="sb-ag-linha">
        <div style="flex:1.2"><label class="sb-ag-rot">Data</label>
          <input id="ag-data" class="sb-ag-campo" type="date" required value="${dataSel}"></div>
        <div style="flex:1" id="ag-hora-wrap"><label class="sb-ag-rot">Hora</label>
          <input id="ag-hora" class="sb-ag-campo" type="time"></div>
      </div>
      <label class="sb-ag-rot">Local <span style="font-weight:400;color:var(--sb-tinta3)">(opcional)</span></label>
      <input id="ag-local" class="sb-ag-campo" maxlength="120">
      <label class="sb-ag-rot">Observação <span style="font-weight:400;color:var(--sb-tinta3)">(opcional)</span></label>
      <textarea id="ag-obs" class="sb-ag-campo" rows="2" maxlength="400"></textarea>
      <div class="sb-ag-erro" id="ag-erro" hidden></div>
      <div class="sb-ag-pe">
        <button type="button" class="sb-btn sb-btn-p" onclick="a1AgendaDesenhar()">Cancelar</button>
        <button type="submit" class="sb-btn sb-btn-forte sb-btn-p" id="ag-salvar">Marcar</button>
      </div>
    </form>`;
  const t = document.getElementById('ag-titulo'); if (t) t.focus();
}

function a1AgendaTipo(bt){
  document.querySelectorAll('.sb-ag-tipo button').forEach(b => b.classList.toggle('on', b === bt));
  // Tarefa tem PRAZO, não horário. Deixar o campo de hora à mostra faria a
  // pessoa preencher uma informação que a tarefa não usa.
  const w = document.getElementById('ag-hora-wrap');
  if (w) w.style.visibility = bt.dataset.tipo === 'tarefa' ? 'hidden' : '';
}

async function a1AgendaGravar(ev){
  ev.preventDefault();
  const erro = document.getElementById('ag-erro');
  const bt = document.getElementById('ag-salvar');
  const marcado = document.querySelector('.sb-ag-tipo button.on');
  const tipo = marcado ? marcado.dataset.tipo : 'compromisso';
  const titulo = (document.getElementById('ag-titulo').value || '').trim();
  const data = document.getElementById('ag-data').value;
  if (!titulo || !data) return false;

  const user = A1.user || {};
  const corpo = {
    tenant_id: user.tenant_id,
    // `dono` é quem está logado. A política do banco só aceita a1_ator() ou
    // a1_usuario(); mandar outro id seria tentar marcar na agenda alheia.
    dono: user.id,
    tipo, titulo, data,
    hora_inicio: tipo === 'compromisso' ? (document.getElementById('ag-hora').value || null) : null,
    local: (document.getElementById('ag-local').value || '').trim() || null,
    descricao: (document.getElementById('ag-obs').value || '').trim() || null
  };
  bt.disabled = true; bt.textContent = 'Marcando…';
  try {
    const r = await fetch(A1.rest('a1_agenda'), { method:'POST', headers:A1.headers(), body:JSON.stringify(corpo) });
    if (!r.ok){
      const txt = await r.text().catch(() => '');
      // Erro de banco não vira "tente novamente": a pessoa tentaria de novo, e
      // de novo, sem descobrir que a tabela ainda não foi criada.
      erro.hidden = false;
      erro.textContent = /a1_agenda/.test(txt) && /does not exist|relation/.test(txt)
        ? 'A agenda ainda não foi criada no banco deste cliente. Peça para rodar sql/2026-09-17_agenda.sql.'
        : ('Não foi possível marcar: ' + txt.slice(0, 160));
      bt.disabled = false; bt.textContent = 'Marcar';
      return false;
    }
    // Volta para o calendário JÁ no dia marcado, para a pessoa ver o ponto
    // aparecer. Fechar o painel esconderia o resultado do que ela acabou de fazer.
    A1_POP.agenda.dia = Number(String(data).slice(8,10));
    const [a, m] = [Number(data.slice(0,4)), Number(data.slice(5,7)) - 1];
    if (a !== A1_POP.agenda.ano || m !== A1_POP.agenda.mes){
      A1_POP.agenda.ano = a; A1_POP.agenda.mes = m;
    }
    A1_POP.agenda.itens = null;
    await a1AgendaDesenhar();
  } catch (e) {
    erro.hidden = false;
    erro.textContent = 'Não foi possível marcar: ' + String(e.message || e).slice(0,140);
    bt.disabled = false; bt.textContent = 'Marcar';
  }
  return false;
}

async function a1AgendaConcluir(id, feito){
  try {
    await fetch(`${A1.rest('a1_agenda')}?id=eq.${encodeURIComponent(id)}`, {
      method:'PATCH', headers:A1.headers(),
      body: JSON.stringify({ concluido_em: feito ? null : new Date().toISOString() }) });
    A1_POP.agenda.itens = null;
    await a1AgendaDesenhar();
  } catch { /* o desenho seguinte mostra o estado real */ }
}

async function a1AgendaExcluir(id){
  if (!confirm('Excluir este item da sua agenda?')) return;
  try {
    await fetch(`${A1.rest('a1_agenda')}?id=eq.${encodeURIComponent(id)}`,
      { method:'DELETE', headers:A1.headers() });
    A1_POP.agenda.itens = null;
    await a1AgendaDesenhar();
  } catch { /* idem */ }
}

async function a1AgendaAbrir(ev){
  ev.preventDefault(); ev.stopPropagation();
  const bt = ev.currentTarget;
  const hoje = new Date();
  if (A1_POP.agenda.mes == null){
    A1_POP.agenda.mes = hoje.getMonth();
    A1_POP.agenda.ano = hoje.getFullYear();
    A1_POP.agenda.dia = hoje.getDate();
  }
  const el = a1PopAbrir('agenda', bt, 330, `
    <div class="sb-pop-cab">${a1Svg('calend',16)}
      <div><div class="sb-pop-tit">Minha agenda</div>
        <div class="sb-pop-sub">Entrevistas e vencimentos de avaliação</div></div>
      <button class="sb-pop-x" type="button" onclick="a1PopFechar()" aria-label="Fechar">×</button></div>
    <div class="sb-pop-corpo" id="sb-agenda-corpo">
      <div class="sb-vazio"><p>Carregando…</p></div></div>
    <div class="sb-pop-pe">
      <button class="sb-btn sb-btn-forte sb-btn-p" type="button" onclick="a1AgendaNovo()">+ Marcar</button>
      <a class="sb-btn sb-btn-p" style="margin-left:auto"
         href="/${a1Esc(A1.slug || '')}/repasse?tab=agenda">Agenda do Repasse</a></div>`);
  if (!el) return;
  A1_POP.agenda.itens = null;
  await a1AgendaDesenhar();
}

async function a1AgendaMes(passo){
  A1_POP.agenda.mes += passo;
  if (A1_POP.agenda.mes < 0){ A1_POP.agenda.mes = 11; A1_POP.agenda.ano--; }
  if (A1_POP.agenda.mes > 11){ A1_POP.agenda.mes = 0; A1_POP.agenda.ano++; }
  A1_POP.agenda.dia = null;
  A1_POP.agenda.itens = null;
  await a1AgendaDesenhar();
}
function a1AgendaDia(d){ A1_POP.agenda.dia = d; a1AgendaDesenhar(); }

async function a1AgendaDesenhar(){
  const alvo = document.getElementById('sb-agenda-corpo');
  if (!alvo) return;
  const { ano, mes } = A1_POP.agenda;
  if (A1_POP.agenda.itens == null){
    A1_POP.agenda.itens = await a1AgendaCarregar(ano, mes).catch(() => []);
    if (!document.getElementById('sb-agenda-corpo')) return;   // fechou enquanto carregava
  }
  const itens = A1_POP.agenda.itens || [];
  const porDia = {};
  itens.forEach(i => { (porDia[Number(i.dia)] || (porDia[Number(i.dia)] = [])).push(i); });

  const hoje = new Date();
  const ehMesAtual = hoje.getMonth() === mes && hoje.getFullYear() === ano;
  if (A1_POP.agenda.dia == null) A1_POP.agenda.dia = ehMesAtual ? hoje.getDate() : 1;
  const sel = A1_POP.agenda.dia;

  const primeiro = new Date(ano, mes, 1).getDay();
  const nDias = new Date(ano, mes + 1, 0).getDate();
  const nAnt = new Date(ano, mes, 0).getDate();
  const cel = [];
  for (let i = primeiro - 1; i >= 0; i--) cel.push(`<span class="sb-cal-d fora">${nAnt - i}</span>`);
  for (let d = 1; d <= nDias; d++){
    const lista = porDia[d] || [];
    const cls = ['sb-cal-d', lista.length ? 'tem' : '',
                 ehMesAtual && hoje.getDate() === d ? 'hoje' : '', sel === d ? 'sel' : ''].filter(Boolean).join(' ');
    // Quatro cores, quatro coisas: prazo de avaliação, entrevista marcada,
    // compromisso seu e tarefa sua. O dia fala sem precisar do clique.
    const pts = lista.length ? `<span class="sb-cal-pt">${
      [...new Set(lista.map(i => i.tipo))].slice(0,3).map(t =>
        `<i style="background:${a1CorDoTipo(t)}"></i>`).join('')}</span>` : '';
    cel.push(lista.length
      ? `<button type="button" class="${cls}" onclick="a1AgendaDia(${d})">${d}${pts}</button>`
      : `<span class="${cls}">${d}</span>`);
  }
  const sobra = (7 - (cel.length % 7)) % 7;
  for (let i = 1; i <= sobra; i++) cel.push(`<span class="sb-cal-d fora">${i}</span>`);

  const doDia = (porDia[sel] || []).slice().sort((a,b) => (a.hora || '99').localeCompare(b.hora || '99'));
  const lista = doDia.length
    ? doDia.map(i => {
        // O que é DA PESSOA ela conclui e apaga; o que vem do processo
        // (entrevista, vencimento) abre o processo. São coisas diferentes e por
        // isso a linha se comporta diferente — botão que promete a mesma ação
        // para as duas mentiria numa delas.
        if (i.agendaId) return `<div class="sb-item" data-tom="${i.feito ? 'neutro' : 'marca'}">
            <button class="sb-ag-check${i.feito ? ' on' : ''}" type="button"
              title="${i.feito ? 'Reabrir' : 'Concluir'}"
              onclick="a1AgendaConcluir('${a1Esc(i.agendaId)}', ${i.feito ? 'true' : 'false'})"
              aria-label="${i.feito ? 'Reabrir' : 'Concluir'}">${i.feito ? '✓' : ''}</button>
            <span class="sb-item-tx"><span class="sb-item-t"${i.feito ? ' style="text-decoration:line-through;color:var(--sb-tinta3)"' : ''}>${a1Esc(i.titulo)}</span>
              <span class="sb-item-s">${a1Esc(i.sub)}</span></span>
            ${i.hora ? `<span class="sb-item-q">${a1Esc(i.hora)}</span>` : ''}
            <button class="sb-ag-x" type="button" title="Excluir"
              onclick="a1AgendaExcluir('${a1Esc(i.agendaId)}')" aria-label="Excluir">×</button>
          </div>`;
        return `<a class="sb-item" data-tom="${i.tipo === 'ent' ? 'info' : 'atento'}"
          href="/${a1Esc(A1.slug || '')}/andamento?caso=${encodeURIComponent(i.id)}">
          <span class="sb-item-pt" style="background:${i.tipo === 'ent' ? 'var(--sb-ardosia)' : 'var(--sb-acafrao)'}"></span>
          <span class="sb-item-tx"><span class="sb-item-t">${a1Esc(i.titulo)}</span>
            <span class="sb-item-s">${a1Esc(i.sub)}${i.etapa ? ' · ' + a1Esc(i.etapa) : ''}</span></span>
          ${i.hora ? `<span class="sb-item-q">${a1Esc(i.hora)}</span>` : ''}</a>`;
      }).join('')
    : `<div class="sb-vazio"><p>Nada marcado neste dia. O botão abaixo cria um compromisso ou uma tarefa.</p></div>`;

  alvo.innerHTML = `
    <div class="sb-cal-topo">
      <button class="sb-cal-bt" type="button" onclick="a1AgendaMes(-1)" aria-label="Mês anterior">‹</button>
      <span class="sb-cal-mes">${A1_MESES_L[mes]} de ${ano}</span>
      <button class="sb-cal-bt" type="button" onclick="a1AgendaMes(1)" aria-label="Próximo mês">›</button>
    </div>
    <div class="sb-cal">${['D','S','T','Q','Q','S','S'].map(d => `<span class="sb-cal-dw">${d}</span>`).join('')}${cel.join('')}</div>
    <div class="sb-cal-legenda">
      ${[['venc','Avaliação'],['ent','Entrevista'],['meu','Compromisso'],['tarefa','Tarefa']]
        .filter(([t]) => itens.some(i => i.tipo === t))
        .map(([t,r]) => `<span><i style="background:${a1CorDoTipo(t)}"></i>${r}</span>`).join('')}
    </div>
    <div class="sb-cal-dia">
      <div class="sb-cal-dia-t">${sel} DE ${A1_MESES_L[mes].toUpperCase()}</div>${lista}</div>`;
}
function a1CorDoTipo(t){
  return { ent:'var(--sb-ardosia)', venc:'var(--sb-acafrao)',
           meu:'var(--sb-mar)', tarefa:'var(--sb-ametista)' }[t] || 'var(--sb-linha-forte)';
}
const A1_MESES_L = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

/* ── Os avisos ─────────────────────────────────────────────────────────────
   O sininho tinha um contador e nenhuma lista: clicar levava para outra tela.
   Aqui ele diz o que ha, em ordem de urgencia, e cada linha abre o processo.
   So entra o que EXIGE acao — avaliacao vencida ou vencendo, entrevista de
   hoje, lead novo sem dono. Aviso que nao pede nada e ruido, e sino que toca
   a toa o gestor aprende a ignorar.                                          */

async function a1AvisosCarregar(){
  const hoje = new Date();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const hj = iso(hoje);
  const em7 = iso(new Date(Date.now() + 7*864e5));
  const h = { headers: A1.headers() };
  const tem = A1_SHELL.tem || {};
  const pedidos = [];

  if (tem.repasse){
    const base = `${A1.rest('a1_cases')}?module_key=eq.repasse&archived=eq.false`;
    pedidos.push(fetch(`${base}&evaluation_expiry=not.is.null&evaluation_expiry=lte.${em7}` +
      `&select=id,client_name,evaluation_expiry,stage_name&order=evaluation_expiry.asc&limit=20`, h)
      .then(r => r.ok ? r.json() : []).catch(() => [])
      .then(l => (Array.isArray(l) ? l : []).map(c => {
        const d = String(c.evaluation_expiry).slice(0,10);
        const dias = Math.round((new Date(d + 'T12:00:00') - new Date(hj + 'T12:00:00')) / 864e5);
        return { peso: dias < 0 ? 0 : 1, tom: dias < 0 ? 'atraso' : 'atento',
          titulo: c.client_name || 'Sem nome',
          sub: 'Avaliação · ' + (c.stage_name || ''),
          quando: dias < 0 ? `venceu há ${-dias}d` : dias === 0 ? 'vence hoje' : `em ${dias}d`,
          href: `/${A1.slug}/andamento?caso=${encodeURIComponent(c.id)}` };
      })));
    pedidos.push(fetch(`${base}&payload->>agendamento_data=gte.${hj}&payload->>agendamento_data=lte.${hj}T23:59:59` +
      `&select=id,client_name,stage_name,payload->>agendamento_data&limit=20`, h)
      .then(r => r.ok ? r.json() : []).catch(() => [])
      .then(l => (Array.isArray(l) ? l : []).map(c => ({
        peso: 0, tom: 'atento', titulo: c.client_name || 'Sem nome',
        sub: 'Entrevista hoje' + (c.stage_name ? ' · ' + c.stage_name : ''),
        quando: String(c.agendamento_data || '').slice(11,16),
        href: `/${A1.slug}/andamento?caso=${encodeURIComponent(c.id)}` }))));
  }
  if (tem.crm){
    const ontem = new Date(Date.now() - 2*864e5).toISOString();
    pedidos.push(fetch(`${A1.rest('a1_cases')}?module_key=eq.crm&archived=eq.false&created_at=gte.${ontem}` +
      `&select=id,client_name,stage_name,created_at&order=created_at.desc&limit=10`, h)
      .then(r => r.ok ? r.json() : []).catch(() => [])
      .then(l => (Array.isArray(l) ? l : []).map(c => ({
        peso: 2, tom: 'marca', titulo: c.client_name || 'Sem nome',
        sub: 'Lead novo' + (c.stage_name ? ' · ' + c.stage_name : ''),
        quando: 'novo', href: `/${A1.slug}/crm?lead=${encodeURIComponent(c.id)}` }))));
  }
  const partes = await Promise.all(pedidos);
  return partes.flat().sort((a,b) => a.peso - b.peso).slice(0, 30);
}

async function a1AvisosAbrir(ev){
  ev.preventDefault(); ev.stopPropagation();
  const bt = ev.currentTarget;
  const el = a1PopAbrir('avisos', bt, 340, `
    <div class="sb-pop-cab">${a1Svg('sino',16)}
      <div><div class="sb-pop-tit">Avisos</div>
        <div class="sb-pop-sub">O que pede ação agora</div></div>
      <button class="sb-pop-x" type="button" onclick="a1PopFechar()" aria-label="Fechar">×</button></div>
    <div class="sb-pop-corpo" id="sb-avisos-corpo">
      <div class="sb-vazio"><p>Carregando…</p></div></div>`);
  if (!el) return;
  const lista = await a1AvisosCarregar().catch(() => []);
  A1_POP.avisos = lista;
  const alvo = document.getElementById('sb-avisos-corpo');
  if (!alvo) return;
  alvo.innerHTML = lista.length
    ? lista.map(a => `<a class="sb-item" data-tom="${a1Esc(a.tom)}" href="${a1Esc(a.href)}">
        <span class="sb-item-pt"></span>
        <span class="sb-item-tx"><span class="sb-item-t">${a1Esc(a.titulo)}</span>
          <span class="sb-item-s">${a1Esc(a.sub)}</span></span>
        <span class="sb-item-q">${a1Esc(a.quando)}</span></a>`).join('')
    : `<div class="sb-vazio">${a1Svg('fluxo',26)}<p>Nada pedindo atenção agora. Vencimentos, entrevistas do dia e leads novos aparecem aqui.</p></div>`;
  a1AvisosContar(lista.filter(a => a.peso === 0).length);
}

// O numero no sininho conta so o que esta VENCIDO ou e de hoje. Contar tudo que
// existe faria o numero nunca zerar, e numero que nunca zera deixa de ser lido.
function a1AvisosContar(n){
  const el = document.getElementById('sb-avisos-n');
  if (!el) return;
  el.textContent = String(n);
  el.hidden = !n;
  el.setAttribute('data-zero', n ? '0' : '1');
}

// Ao montar o casco, o contador e calculado uma vez, em segundo plano.
async function a1AvisosPrimeiraContagem(){
  try {
    const lista = await a1AvisosCarregar();
    a1AvisosContar(lista.filter(a => a.peso === 0).length);
  } catch { /* contador e conveniencia: falhar em silencio e melhor que alarmar */ }
}
