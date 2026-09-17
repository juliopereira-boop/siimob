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
    vistas:[['Andamento','crm'],['Listagem','crm-listagem'],['Dashboard','crm?tab=dash']] },
  { chave:'PRE_ANALISE', rotulo:'Pré-análise', icone:'pre',
    vistas:[['Andamento','pre-analise'],['Listagem','pre-analise-listagem']] },
  { chave:'COMERCIAL',   rotulo:'Venda',       icone:'venda',
    vistas:[['Andamento','comercial'],['Listagem','comercial-listagem']] },
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
        <a class="sb-marca" href="${url('')}" aria-label="SIIMOB, ir para o início">
          ${A1_MARCA_SVG}<span>SIIMOB</span></a>
        <nav class="sb-mods" aria-label="Módulos">${abas.join('')}</nav>
        <div class="sb-cromo-dir">
          <button class="sb-icone" type="button" title="Agenda" onclick="a1ShellIr('agenda')">${a1Svg('calend',17)}</button>
          <button class="sb-icone" type="button" title="Avisos" onclick="a1ShellIr('avisos')">
            ${a1Svg('sino',17)}<span class="sb-icone-selo" id="sb-avisos-n" data-zero="1" hidden>0</span></button>
          ${o.perfil ? `<button class="sb-icone" type="button" id="btn-profile" style="display:none"
            title="Meu perfil" onclick="openProfile()">${a1Svg('pessoa',17)}</button>` : ''}
          <div class="sb-pessoa">
            <div class="sb-pessoa-txt">
              <div class="sb-pessoa-email">${a1Esc(a1RotuloPapel(user))}</div>
              <div class="sb-pessoa-nome">${a1Esc(user.name || '')}</div>
            </div>
            <button class="sb-avatar" type="button" title="Sair" onclick="a1Logout()"
              aria-label="Sair do sistema">${a1Esc(a1Iniciais(user.name))}</button>
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
