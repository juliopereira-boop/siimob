// ─── Painel da disposição: o que o gestor da construtora decide olhando ──────
//
// Tudo calculado aqui, das mesmas tabelas que o mapa lê: a situação de cada
// unidade, o preço do mapa que vale, as reservas e o rastro de mudanças de
// situação (a1_unidade_eventos). Sem tabela de resumo à parte: número de
// painel que diverge da planta é o gestor desconfiando dos dois.
//
// As fórmulas estão escritas ao lado de cada indicador, na própria tela,
// porque "VSO" sem a conta é sigla.
import { esc } from '../../shared/utils/texto.js';
import { acoes } from '../../shared/ui/acoes.js';
import { STATUS, ORDEM_STATUS, brl, num } from '../../modules/disposicao/dados.js';

acoes({
  painelDica: (el, ev) => mostrarDica(el, /** @type {MouseEvent} */ (ev)),
  painelDicaSai: () => esconderDica()
});

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const chaveMes = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const pct = (/** @type {number} */ a, /** @type {number} */ b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const pctTxt = (/** @type {number} */ v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';

/**
 * @param {HTMLElement} alvo
 * @param {{unidades:any[], preco:Record<string,number>, reservas:any[], eventos:any[],
 *          empreendimentos:any[], corretores:any[], nomeCorretor:(id:string)=>string}} d
 */
export function renderPainel(alvo, d) {
  const un = d.unidades;
  if (!un.length) {
    alvo.innerHTML =
      '<div class="dp-vazio"><b>Sem unidades com ficha</b><p>O painel nasce das fichas de unidade.</p></div>';
    return;
  }
  const preco = (/** @type {any} */ u) => d.preco[u.id] || 0;
  const por = Object.fromEntries(ORDEM_STATUS.map(s => [s, un.filter(u => u.status === s)]));
  const soma = (/** @type {any[]} */ l) => l.reduce((s, u) => s + preco(u), 0);
  const vgvTotal = soma(un);
  const vgvVendido = soma(por.vendido);
  const vgvEstoque = soma(por.disponivel);
  const vgvReservado = soma(por.reservado);
  const oferta = por.disponivel.length + por.reservado.length;

  // ── Vendas e distratos por mês, do rastro ──
  const hoje = new Date();
  const meses = [];
  for (let i = 11; i >= 0; i--) meses.push(chaveMes(new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)));
  const vendas = Object.fromEntries(meses.map(m => [m, 0]));
  const distratos = Object.fromEntries(meses.map(m => [m, 0]));
  d.eventos.forEach(e => {
    const m = chaveMes(new Date(e.criado_em));
    if (!(m in vendas)) return;
    if (e.para === 'vendido') vendas[m]++;
    if (e.de === 'vendido' && e.para === 'disponivel') distratos[m]++;
  });
  const mesAtual = meses[11];
  const liquidas = (/** @type {string} */ m) => vendas[m] - distratos[m];
  const vendasMes = liquidas(mesAtual);
  // VSO (Abrainc): vendas líquidas ÷ oferta do início do mês. A oferta do
  // início é a de agora mais o que saiu dela no mês (as vendas líquidas).
  const vso = pct(vendasMes, oferta + Math.max(vendasMes, 0));
  const media3 = (liquidas(meses[9]) + liquidas(meses[10]) + liquidas(meses[11])) / 3;
  const mesesEstoque = media3 > 0 ? oferta / media3 : null;
  const ticket = por.vendido.length ? vgvVendido / por.vendido.length : 0;
  const areaDisp = por.disponivel.reduce((s, u) => s + (Number(u.area_privativa) || 0), 0);
  const precoM2 = areaDisp ? vgvEstoque / areaDisp : 0;
  const semPreco = un.filter(u => !d.preco[u.id] && u.status !== 'vendido').length;

  // ── Reservas ──
  const rsAtivas = d.reservas.filter(r => r.status === 'ATIVA');
  const vence24 = rsAtivas.filter(
    r => r.expira_em && new Date(r.expira_em).getTime() - Date.now() < 24 * 36e5
  );
  const encerradas = d.reservas.filter(r => r.status !== 'ATIVA');
  const convertidas = encerradas.filter(r => r.status === 'CONVERTIDA').length;
  const conversao = pct(convertidas, encerradas.length);
  const parado = por.disponivel
    .filter(u => Date.now() - new Date(u.status_em).getTime() > 90 * 864e5)
    .sort((a, b) => new Date(a.status_em).getTime() - new Date(b.status_em).getTime());

  alvo.innerHTML = `
    <div class="pn-topo">
      <div class="pn-heroi">
        <span class="pn-rot">VGV vendido</span>
        <b class="pn-heroi-v">${pctTxt(pct(vgvVendido, vgvTotal))}</b>
        <span class="pn-heroi-s">${brl(vgvVendido)} de ${brl(vgvTotal)} em tabela</span>
        <div class="pn-seg" role="img" aria-label="${esc(ORDEM_STATUS.map(s => `${STATUS[s].plural}: ${por[s].length}`).join(', '))}">
          ${ORDEM_STATUS.map(s => (por[s].length ? `<i style="flex:${por[s].length};background:${STATUS[s].cor}"></i>` : '')).join('')}
        </div>
        <ul class="pn-leg">${ORDEM_STATUS.map(
          s =>
            `<li><i style="background:${STATUS[s].cor}"></i>${STATUS[s].plural} <b>${por[s].length}</b></li>`
        ).join('')}</ul>
      </div>
      <div class="pn-tiles">
        ${tile('VSO do mês', pctTxt(vso), 'vendas líquidas do mês ÷ oferta do início do mês')}
        ${tile('Vendas líquidas no mês', String(vendasMes), `${vendas[mesAtual]} venda(s) − ${distratos[mesAtual]} distrato(s)`)}
        ${tile('Meses de estoque', mesesEstoque == null ? '—' : num(mesesEstoque, 1), 'oferta ÷ média de vendas dos últimos 3 meses')}
        ${tile('Estoque à venda', brl(vgvEstoque), `${por.disponivel.length} unidade(s) disponível(is)`)}
        ${tile('Reservado', brl(vgvReservado), `${por.reservado.length} unidade(s) seguras por reserva`)}
        ${tile('Ticket médio vendido', ticket ? brl(ticket) : '—', 'valor de tabela das vendidas ÷ quantidade')}
        ${tile('Preço médio do m² em estoque', precoM2 ? brl(precoM2) : '—', 'tabela das disponíveis ÷ área privativa delas')}
        ${tile('Conversão de reservas', encerradas.length ? pctTxt(conversao) : '—', `${convertidas} de ${encerradas.length} reservas encerradas viraram venda`)}
      </div>
    </div>

    <div class="pn-grade">
      <section class="pn-card pn-largo">
        <h3>Vendas por mês</h3>
        <p class="pn-sub">Unidades que passaram a vendidas, nos últimos 12 meses. Distratos aparecem ao passar o mouse.</p>
        ${graficoMeses(meses, vendas, distratos)}
        <details class="pn-tab"><summary>Ver em tabela</summary>
          <table class="dp-tabela dp-tabela-p"><thead><tr><th>Mês</th><th class="n">Vendas</th><th class="n">Distratos</th><th class="n">Líquidas</th></tr></thead>
          <tbody>${meses
            .map(
              m =>
                `<tr><td>${rotMes(m)}</td><td class="n">${vendas[m]}</td><td class="n">${distratos[m]}</td><td class="n">${liquidas(m)}</td></tr>`
            )
            .join('')}</tbody></table></details>
      </section>

      <section class="pn-card">
        <h3>Reservas</h3>
        <p class="pn-sub">O que está segurando unidade agora.</p>
        <div class="pn-num-l"><span>Ativas</span><b>${rsAtivas.length}</b></div>
        <div class="pn-num-l${vence24.length ? ' alerta' : ''}"><span>Vencem nas próximas 24h</span><b>${vence24.length}</b></div>
        <div class="pn-num-l"><span>Viraram venda</span><b>${convertidas}</b></div>
        <div class="pn-num-l"><span>Canceladas</span><b>${encerradas.filter(r => r.status === 'CANCELADA').length}</b></div>
        <div class="pn-num-l"><span>Venceram sem virar venda</span><b>${encerradas.filter(r => r.status === 'EXPIRADA').length}</b></div>
        ${semPreco ? `<div class="pn-aviso">${semPreco} unidade(s) sem preço no mapa que vale: não podem ser reservadas.</div>` : ''}
      </section>

      <section class="pn-card pn-largo">
        <h3>Por tipologia</h3>
        <p class="pn-sub">Onde o estoque está e o que vende.</p>
        ${tabelaGrupo(un, u => u.tipologia || 'Sem tipologia', preco)}
      </section>

      <section class="pn-card">
        <h3>Quem mais reserva</h3>
        <p class="pn-sub">Reservas feitas e quantas viraram venda.</p>
        ${rankingCorretores(d)}
      </section>

      <section class="pn-card pn-largo">
        <h3>Por bloco</h3>
        <p class="pn-sub">A mesma leitura, por torre ou quadra.</p>
        ${tabelaGrupo(un, u => [nomeEmp(d, u.empreendimento_id), u.bloco].filter(Boolean).join(' · ') || 'Sem bloco', preco)}
      </section>

      <section class="pn-card">
        <h3>Estoque parado</h3>
        <p class="pn-sub">Disponíveis há mais de 90 dias sem mudar de situação.</p>
        ${
          parado.length
            ? `<div class="pn-num-l"><span>Unidades</span><b>${parado.length}</b></div>
               <ul class="pn-lista">${parado
                 .slice(0, 6)
                 .map(
                   u => `<li><b>${esc(u.codigo)}</b> <span>${esc(u.tipologia || '')}</span>
                     <small>${Math.floor((Date.now() - new Date(u.status_em).getTime()) / 864e5)} dias</small></li>`
                 )
                 .join('')}</ul>`
            : '<p class="dp-mudo">Nenhuma. O estoque está girando.</p>'
        }
      </section>
    </div>
    <div class="pn-dica" id="pn-dica" hidden></div>`;
}

function tile(/** @type {string} */ rot, /** @type {string} */ valor, /** @type {string} */ conta) {
  return `<div class="pn-tile"><span class="pn-rot">${esc(rot)}</span><b>${esc(valor)}</b><small>${esc(conta)}</small></div>`;
}
const rotMes = (/** @type {string} */ m) => `${MES[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`;
const nomeEmp = (/** @type {any} */ d, /** @type {string} */ id) =>
  (d.empreendimentos.find((/** @type {any} */ e) => e.id === id) || {}).name || '';

// Colunas de 24px no máximo, ponta arredondada de 4px e base reta, grade
// recessiva de linha fina, valor só no topo da maior. Uma série só: o título
// diz o que é, sem caixa de legenda.
function graficoMeses(
  /** @type {string[]} */ meses,
  /** @type {any} */ vendas,
  /** @type {any} */ distratos
) {
  const L = 640,
    A = 200,
    esq = 30,
    base = A - 24,
    topo = 14;
  const max = Math.max(1, ...meses.map(m => vendas[m]));
  const passo = max <= 5 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
  const teto = Math.ceil(max / passo) * passo;
  const y = (/** @type {number} */ v) => base - ((base - topo) * v) / teto;
  const faixa = (L - esq) / meses.length;
  const larg = Math.min(24, faixa * 0.55);
  const linhas = [];
  for (let v = 0; v <= teto; v += passo)
    linhas.push(
      `<line x1="${esq}" x2="${L}" y1="${y(v)}" y2="${y(v)}" class="pn-grid"/><text x="${esq - 6}" y="${y(v) + 3}" class="pn-eixo" text-anchor="end">${v}</text>`
    );
  const maior = meses.reduce((a, m) => (vendas[m] > vendas[a] ? m : a), meses[0]);
  const colunas = meses
    .map((m, i) => {
      const v = vendas[m];
      const x = esq + i * faixa + (faixa - larg) / 2;
      const h = base - y(v);
      const r = Math.min(4, h);
      const forma = v
        ? `<path d="M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + larg - r} Q${x + larg},${base - h} ${x + larg},${base - h + r} V${base} Z" class="pn-col"/>`
        : '';
      return `<g>
        ${forma}
        <rect x="${esq + i * faixa}" y="${topo}" width="${faixa}" height="${base - topo}" class="pn-alvo"
          data-acao-mouseover="painelDica" data-acao-mouseout="painelDicaSai"
          data-dica="${esc(`${rotMes(m)}: ${v} venda(s)${distratos[m] ? `, ${distratos[m]} distrato(s)` : ''}`)}"/>
        ${m === maior && v ? `<text x="${x + larg / 2}" y="${base - h - 6}" class="pn-val" text-anchor="middle">${v}</text>` : ''}
        <text x="${esq + i * faixa + faixa / 2}" y="${A - 6}" class="pn-eixo" text-anchor="middle">${rotMes(m)}</text>
      </g>`;
    })
    .join('');
  return `<svg class="pn-svg" viewBox="0 0 ${L} ${A}" role="img" aria-label="Vendas por mês nos últimos 12 meses">
    ${linhas.join('')}<line x1="${esq}" x2="${L}" y1="${base}" y2="${base}" class="pn-base"/>${colunas}</svg>`;
}

function tabelaGrupo(
  /** @type {any[]} */ un,
  /** @type {(u:any)=>string} */ chave,
  /** @type {(u:any)=>number} */ preco
) {
  const grupos = new Map();
  un.forEach(u => {
    const k = chave(u);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(u);
  });
  const linhas = [...grupos.entries()].sort((a, b) => b[1].length - a[1].length);
  return `<table class="dp-tabela dp-tabela-p pn-grupo">
    <thead><tr><th></th><th>Situação</th><th class="n">Total</th><th class="n">Disp.</th><th class="n">Vendidas</th><th class="n">% vendido</th><th class="n">Preço médio</th></tr></thead>
    <tbody>${linhas
      .map(([k, l]) => {
        const c = Object.fromEntries(
          ORDEM_STATUS.map(s => [s, l.filter((/** @type {any} */ u) => u.status === s).length])
        );
        const comPreco = l.filter((/** @type {any} */ u) => preco(u));
        const medio = comPreco.length
          ? comPreco.reduce((/** @type {number} */ s, /** @type {any} */ u) => s + preco(u), 0) /
            comPreco.length
          : 0;
        return `<tr><td><b>${esc(k)}</b></td>
          <td><div class="pn-seg pn-seg-f" title="${esc(ORDEM_STATUS.map(s => `${STATUS[s].plural}: ${c[s]}`).join(' · '))}">
            ${ORDEM_STATUS.map(s => (c[s] ? `<i style="flex:${c[s]};background:${STATUS[s].cor}"></i>` : '')).join('')}</div></td>
          <td class="n">${l.length}</td><td class="n">${c.disponivel}</td><td class="n">${c.vendido}</td>
          <td class="n">${pctTxt(pct(c.vendido, l.length))}</td><td class="n">${medio ? brl(medio) : '—'}</td></tr>`;
      })
      .join('')}</tbody></table>`;
}

function rankingCorretores(/** @type {any} */ d) {
  const por = new Map();
  d.reservas.forEach((/** @type {any} */ r) => {
    const k = r.corretor_id || '';
    if (!por.has(k)) por.set(k, { feitas: 0, vendas: 0 });
    const x = por.get(k);
    x.feitas++;
    if (r.status === 'CONVERTIDA') x.vendas++;
  });
  const lista = [...por.entries()]
    .sort((a, b) => b[1].vendas - a[1].vendas || b[1].feitas - a[1].feitas)
    .slice(0, 8);
  if (!lista.length) return '<p class="dp-mudo">Nenhuma reserva ainda.</p>';
  const max = Math.max(...lista.map(([, x]) => x.feitas));
  return `<ul class="pn-rank">${lista
    .map(
      ([id, x]) => `<li><span>${esc(id ? d.nomeCorretor(id) || 'Corretor' : 'Venda direta')}</span>
        <div class="pn-rank-b"><i style="width:${(x.feitas / max) * 100}%"></i></div>
        <b>${x.vendas}/${x.feitas}</b></li>`
    )
    .join('')}</ul>`;
}

function mostrarDica(/** @type {HTMLElement} */ el, /** @type {MouseEvent} */ ev) {
  const dica = document.getElementById('pn-dica');
  if (!dica) return;
  dica.textContent = el.dataset.dica || '';
  dica.hidden = false;
  dica.style.left = ev.clientX + 12 + 'px';
  dica.style.top = ev.clientY - 30 + 'px';
}
function esconderDica() {
  const dica = document.getElementById('pn-dica');
  if (dica) dica.hidden = true;
}
