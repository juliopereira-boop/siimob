// ─── Cabeçalho e navegação, num lugar só ─────────────────────────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// As telas novas nasceram com um cabeçalho próprio — barra azul, três abas
// soltas, nada parecido com o resto do sistema. Quem clicava saía de um lugar
// e caía em outro, e a impressão era de estar em outro produto.
//
// A navegação passa a ser gerada de um lugar só. Acrescentar um módulo é
// acrescentar uma linha em MODULOS; a barra sai igual em toda tela que incluir
// este arquivo, e não há como uma divergir da outra por descuido.
//
// A licença manda: uma aba só aparece depois de o superadmin liberar o módulo
// para o cliente. Esconder a aba é conveniência — quem forçar o endereço
// continua barrado pelo RLS, que é onde a regra de verdade mora.
//
// Depende de: config.js e auth.js.

// A ordem aqui é a ordem da barra. Repasse antes dos módulos novos porque é
// onde o cliente de hoje trabalha; mexer nisso mudaria o sistema de quem já
// usa, sem ninguém ter pedido.
const A1_MODULOS = [
  { chave: 'repasse',     rotulo: 'Repasse',     sempre: false,
    vistas: [['Andamento', 'andamento'], ['Listagem', 'listagem']] },
  { chave: 'registro',    rotulo: 'Registro',    sempre: false,
    vistas: [['Andamento', 'registro'], ['Listagem', 'registro-listagem']] },
  { chave: 'PRE_ANALISE', rotulo: 'Pré-análise', sempre: false,
    vistas: [['Andamento', 'pre-analise'], ['Listagem', 'pre-analise-listagem']] },
  { chave: 'COMERCIAL',   rotulo: 'Comercial',   sempre: false,
    vistas: [['Andamento', 'comercial'], ['Listagem', 'comercial-listagem']] }
];

// A ordem do SELETOR DE PAINEL do dashboard é outra: segue a jornada do
// negócio — a pessoa é pré-analisada, depois negocia, depois o repasse anda.
const A1_ORDEM_PAINEIS = ['PRE_ANALISE', 'COMERCIAL', 'repasse'];

const A1_SHELL_CSS = `
.hdr{background:#3D5CC8;color:#fff;position:sticky;top:0;z-index:200}
.hdr-top{display:flex;align-items:center;justify-content:space-between;padding:.6rem 1.5rem;gap:1rem}
.hdr-logo{display:flex;align-items:center;gap:.6rem;font-weight:800;font-size:.9rem;letter-spacing:-.02em}
.hdr-right{display:flex;align-items:center;gap:.6rem}
.hdr-user{font-size:.75rem;color:rgba(255,255,255,.55)}
.hdr-user strong{color:rgba(255,255,255,.9)}
.btn-hdr{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);color:rgba(255,255,255,.85);border-radius:6px;padding:.3rem .8rem;font-size:.73rem;font-weight:600;cursor:pointer;transition:all .15s}
.btn-hdr:hover{background:rgba(255,255,255,.2)}
.btn-hdr-primary{background:#fff;border-color:#fff;color:#3D5CC8}
.btn-hdr-primary:hover{background:rgba(255,255,255,.92);border-color:rgba(255,255,255,.92)}
.tabs-bar{display:flex;padding:.35rem 1.1rem;border-top:1px solid rgba(255,255,255,.1);align-items:center;gap:.15rem;flex-wrap:wrap}
.tab-btn{padding:.42rem 1.05rem;color:rgba(255,255,255,.6);font-size:.8rem;font-weight:600;cursor:pointer;border-radius:7px;border-bottom:none;transition:all .15s;white-space:nowrap;user-select:none;background:transparent;border:none;font-family:inherit}
.tab-btn:hover{color:#fff;background:rgba(255,255,255,.13)}
.tab-btn.active{color:#3D5CC8;background:#fff;font-weight:700}
.tab-group{position:relative;display:flex;align-items:center}
.tab-group .tab-btn{display:flex;align-items:center;gap:.3rem}
.tab-caret{font-size:.58rem;opacity:.7}
.tab-dd{position:absolute;top:calc(100% + 5px);left:0;background:#1e3080;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:.35rem;min-width:168px;z-index:300;box-shadow:0 12px 36px rgba(0,0,0,.35);visibility:hidden;opacity:0;transition:opacity .12s linear 1s, visibility 0s linear 1.12s}
.tab-dd::before{content:"";position:absolute;left:0;right:0;top:-9px;height:9px}
.tab-group:hover .tab-dd,.tab-group:focus-within .tab-dd{visibility:visible;opacity:1;transition:opacity .12s linear 0s, visibility 0s linear 0s}
.dd-item{display:block;padding:.52rem 1rem;border-radius:7px;font-size:.79rem;font-weight:600;color:rgba(255,255,255,.75);cursor:pointer;transition:all .12s}
.dd-item:hover{background:rgba(255,255,255,.12);color:#fff}
.dd-item.active{background:rgba(255,255,255,.18);color:#fff;font-weight:700}
`;

const A1_LOGO_SVG = `<svg width="26" height="26" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="shl1" x1="13.4" y1="41.4" x2="36.4" y2="15.6" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="rgba(255,255,255,.62)"/><stop offset="55%" stop-color="rgba(255,255,255,.86)"/><stop offset="100%" stop-color="#FFFFFF"/></linearGradient><linearGradient id="shl2" x1="64" y1="12.7" x2="64" y2="35.5" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="rgba(255,255,255,.58)"/><stop offset="55%" stop-color="rgba(255,255,255,.84)"/><stop offset="100%" stop-color="#FFFFFF"/></linearGradient><linearGradient id="shl3" x1="36" y1="64.5" x2="36" y2="87.1" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="45%" stop-color="rgba(255,255,255,.84)"/><stop offset="100%" stop-color="rgba(255,255,255,.58)"/></linearGradient><linearGradient id="shl4" x1="86.6" y1="58.6" x2="63.6" y2="84.4" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="rgba(255,255,255,.62)"/><stop offset="55%" stop-color="rgba(255,255,255,.86)"/><stop offset="100%" stop-color="#FFFFFF"/></linearGradient></defs><path d="M36.4 12.9 A22.66 22.66 0 0 0 36.4 58.2 Z" fill="url(#shl1)"/><rect x="41.4" y="12.7" width="45.3" height="22.8" rx="11.4" fill="url(#shl2)"/><rect x="13.4" y="64.5" width="45.3" height="22.7" rx="11.3" fill="url(#shl3)"/><path d="M63.9 41.8 A22.66 22.66 0 0 1 63.9 87.1 Z" fill="url(#shl4)"/></svg>`;

function a1Esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Quais módulos este cliente tem, perguntando todos de uma vez.
// null (servidor fora do ar) NÃO vira "não tem": esconder a aba por causa de
// uma falha de rede seria trancar o cliente fora do próprio sistema.
async function a1ModulosDoCliente(){
  const respostas = await Promise.all(A1_MODULOS.map(m => a1HasModule(m.chave).catch(() => null)));
  const tem = {};
  A1_MODULOS.forEach((m, i) => { tem[m.chave] = respostas[i] === true; });
  return tem;
}

// Monta cabeçalho e barra de abas dentro do elemento indicado.
//   opcoes.ativo   — chave do módulo desta tela ('PRE_ANALISE', 'COMERCIAL'…)
//   opcoes.vista   — 'andamento' | 'listagem', para marcar o item do menu
//   opcoes.acoes   — HTML de botões extras no canto direito
async function a1MontarShell(alvo, opcoes){
  const o = opcoes || {};
  const user = A1.user || {};
  const slug = A1.slug || '';
  const ehParceiro = user.role === 'partner';

  if (!document.getElementById('a1-shell-css')){
    const st = document.createElement('style');
    st.id = 'a1-shell-css'; st.textContent = A1_SHELL_CSS;
    document.head.appendChild(st);
  }

  const tem = await a1ModulosDoCliente();
  const papel = ehParceiro
    ? ({ cca:'Correspondente', despachante:'Despachante', corretor:'Corretor',
         analista:'Analista', coordenador:'Coordenador' }[user.type] || 'Parceiro')
    : 'Gestor';

  const abas = [];

  // Dashboard: o parceiro só vê se o gestor liberou.
  if (!ehParceiro || (user.permissions || {}).ver_dashboard === true){
    abas.push(`<a class="tab-btn${o.ativo === 'dashboard' ? ' active' : ''}"
                  href="/${a1Esc(slug)}/dashboard">Dashboard</a>`);
  }

  A1_MODULOS.forEach(m => {
    if (!tem[m.chave]) return;
    const aqui = o.ativo === m.chave;
    const itens = m.vistas.map(([rot, rota]) => {
      const marcado = aqui && (o.vista || 'andamento') === rot.toLowerCase();
      return `<a class="dd-item${marcado ? ' active' : ''}"
                 href="/${a1Esc(slug)}/${a1Esc(rota)}">${a1Esc(rot)}</a>`;
    }).join('');
    abas.push(`<div class="tab-group">
      <a class="tab-btn${aqui ? ' active' : ''}" href="/${a1Esc(slug)}/${a1Esc(m.vistas[0][1])}">
        ${a1Esc(m.rotulo)} <span class="tab-caret" aria-hidden="true">▾</span></a>
      <div class="tab-dd">${itens}</div></div>`);
  });

  // Configurações é do gestor. O parceiro nunca vê a aba — e, se forçar o
  // endereço, a própria tela o devolve.
  if (!ehParceiro){
    abas.push(`<a class="tab-btn${o.ativo === 'config' ? ' active' : ''}"
                  href="/${a1Esc(slug)}/configuracoes">Configuracoes</a>`);
  }

  alvo.innerHTML = `
    <div class="hdr">
      <div class="hdr-top">
        <div class="hdr-logo">${A1_LOGO_SVG}<span style="color:#fff;font-weight:800;letter-spacing:-.02em">SIIMOB</span></div>
        <div class="hdr-right">
          <div class="hdr-user"><strong>${a1Esc(user.name)}</strong> &middot; ${a1Esc(papel)}</div>
          ${o.acoes || ''}
          <button class="btn-hdr" onclick="a1Logout()">Sair</button>
        </div>
      </div>
      <div class="tabs-bar">${abas.join('')}</div>
    </div>`;

  return tem;
}

// Qual vista a URL está pedindo. É o caminho que manda, para o link do menu e
// o botão "voltar" do navegador continuarem valendo.
function a1VistaDaURL(){
  // ?vista= vem primeiro para o link direto e para os testes, que servem o
  // arquivo cru e não passam pela reescrita de rota da Vercel.
  const q = new URLSearchParams(location.search).get('vista');
  if (q === 'listagem' || q === 'andamento') return q;
  return /-listagem\/?$/.test(location.pathname) ? 'listagem' : 'andamento';
}
