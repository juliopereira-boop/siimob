// ─── Painéis executivos de Pré-análise e Venda ───────────────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// O Dashboard sempre foi o do Repasse. Quando o cliente passa a ter mais de um
// módulo, ele precisa escolher qual painel está olhando — e cada painel tem
// perguntas próprias. Deixar isso dentro de repasse.html seria empurrar mais
// 40 KB para um arquivo de 330 KB que um cliente usa agora.
//
// Só repasse.html inclui este arquivo. A aba Dashboard — e com ela o seletor de
// painel — existe lá e em nenhum outro lugar; andamento.html e listagem.html
// chegaram a incluí-lo, e era peso morto em duas telas que já são pesadas.
//
// O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO
// Não existe meta, probabilidade por etapa nem motivo estruturado de perda no
// schema de hoje. Então não há previsão, cobertura, pipeline ponderado nem
// Pareto de motivo. Onde o número não existe, o painel mostra um traço e diz o
// que falta cadastrar — um KPI inventado só é descoberto depois de alguém tomar
// decisão com ele.
//
// Este comentário já declarou impossíveis três coisas que passaram a existir e
// hoje estão calculadas: o catálogo de documento obrigatório (a1_config
// doc_types, 09-09) sustenta a completude do dossiê; analisado_em sustenta o
// tempo de conferência e a reprovação POR TIPO com denominador; e o par de
// eventos consecutivos sustenta o tempo por etapa histórico, que aponta o
// gargalo onde situacao_em só apontava a fila. Quando uma coluna nova chegar,
// é aqui que se apaga a linha — comentário que envelhece manda imprimir traço
// em número que o banco já sabe dar.
//
// PRIVACIDADE
// CPF, documento, nome de pessoa e renda individual NÃO entram em painel
// executivo. As consultas daqui pedem só as colunas agregáveis: nenhuma pede
// pessoa_id, renda_declarada, renda_familiar ou motivo. Do origem_snapshot do
// Venda lê-se só o ramo {credito} — o jsonb inteiro carrega nome e renda
// analisada dos participantes dentro dele.
//
// OS DOIS CORTES
// Corte de LINHA (quais processos entram na conta) é do RLS e chega pronto.
// Corte de AGREGADO (posso ver soma em R$ do cliente inteiro e nome de terceiro
// num ranking) é `ver_consolidado_financeiro`, e mora neste arquivo. Confundir
// os dois foi o que deixou papel operacional lendo o VGV consolidado da
// operação. Veja o bloco "Rankings e corte de agregado" — todo KPI novo em R$
// nasce com pnPodeVerConsolidado() decidindo o que é desenhado.
//
// Depende de: config.js (A1), auth.js (a1HasModule) e das telas que o incluem.

// ─── Estado ──────────────────────────────────────────────────────────────────
// Os dados brutos ficam guardados aqui para a troca de período não render outra
// rodada de consultas: o recorte é aritmética sobre linhas que já estão na mão.
const PN = { dias: 90, pa: null, co: null };

const PN_PERIODOS = [[30, '30 dias'], [90, '90 dias'], [180, '180 dias'], [365, '12 meses'], [0, 'Tudo']];

// ─── Utilitários ─────────────────────────────────────────────────────────────
// A aspa SIMPLES entra aqui junto com as outras, e nao e capricho: os valores
// escapados por esta funcao vao para dentro de onclick="location.href='...'",
// ou seja, para dentro de uma string JS delimitada por aspa simples. Escapar
// so a aspa dupla fecharia o atributo e deixaria a simples abrir codigo.
function pnEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const _pnBRL = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:0 });
// Dinheiro é bigint em CENTAVOS no banco inteiro. Dividir por 100 na hora de
// mostrar é o único lugar onde a conversão acontece.
function pnBRL(cent){ return _pnBRL.format((Number(cent) || 0) / 100); }

function pnPct(x){
  if (x == null || !isFinite(x)) return '—';
  return (x * 100).toFixed(x < 0.1 ? 1 : 0).replace('.', ',') + '%';
}
function pnDias(h){
  if (h == null || !isFinite(h)) return '—';
  return (h / 24).toFixed(h < 24 ? 1 : 0).replace('.', ',') + 'd';
}
function pnHoras(h){
  if (h == null || !isFinite(h)) return '—';
  if (h < 48) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
}
function pnLinhas(r){ return Array.isArray(r) ? r : ((r && r.linhas) || []); }
function pnMs(iso){ const t = iso ? new Date(iso).getTime() : NaN; return isNaN(t) ? null : t; }

// O slug do cliente vai parar dentro de um trecho de JS que mora num atributo
// onclick. Escapar HTML NÃO resolve isso: o navegador desfaz a entidade antes de
// o JS rodar, então um &#39; volta a ser aspa e fecha a string. Percent-encoding
// tira aspa, sinal de menor e barra de circulação e ainda deixa o slug normal
// ([a-z0-9-]) intacto.
function pnRota(caminho){
  return '/' + encodeURIComponent(A1.slug || '') + '/' + caminho;
}

// Percentil com interpolação linear — o mesmo método do percentile_cont, que o
// PostgREST não expõe. Fazer no navegador é o caminho que pre-analise.html e
// comercial.html já usam; o dia em que virar consulta SQL, o número não muda.
function pnPercentil(valores, p){
  const v = valores.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * p;
  const base = Math.floor(pos), resto = pos - base;
  return v[base + 1] === undefined ? v[base] : v[base] + resto * (v[base + 1] - v[base]);
}

// ─── Folha de estilo ─────────────────────────────────────────────────────────
// Só as estruturas que a página anfitriã não tem. Cartão de KPI, .panel e
// .sec-title vêm do repasse.html de propósito: o painel novo tem de parecer a
// mesma tela, e duplicar a regra aqui é o caminho conhecido para as duas
// versarem a cor de um jeito diferente na próxima manutenção.
const PN_CSS = `
.pn-topo{display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;margin-bottom:1rem}
.pn-titulo{font-size:1rem;font-weight:800;letter-spacing:-.02em}
.pn-titulo small{display:block;font-size:.7rem;font-weight:600;color:var(--t3);letter-spacing:0;margin-top:.15rem}
.pn-periodo{padding:.4rem .65rem;border:1px solid var(--border);border-radius:8px;font-size:.78rem;font-weight:600;background:var(--card);color:var(--t2);font-family:inherit}
.pn-secao{margin-bottom:1.25rem}
.pn-nota{font-size:.72rem;color:var(--t3);margin:-.5rem 0 .9rem;line-height:1.45}
.pn-aviso{background:#fef9c3;border:1px solid #fde68a;color:#854d0e;border-radius:10px;padding:.7rem .9rem;font-size:.78rem;font-weight:600;margin-bottom:1rem}
.pn-aviso.i{background:#dbeafe;border-color:#93c5fd;color:#1e40af}
.pn-vazio{text-align:center;padding:2rem 1rem;color:var(--t3);font-size:.8rem}
.pn-spark{display:flex;align-items:flex-end;gap:2px;height:16px;margin-top:.3rem}
.pn-spark i{flex:1;background:var(--violet);opacity:.35;border-radius:1px;min-height:1px}
.pn-spark i:last-child{opacity:.85}
.pn-funil-row{display:grid;grid-template-columns:1.6fr 3fr 58px 62px 96px;align-items:center;gap:.7rem;padding:.5rem 0;border-bottom:1px solid var(--border)}
.pn-funil-row:last-child{border-bottom:none}
.pn-funil-nome{font-size:.77rem;font-weight:600;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pn-funil-track{background:#f0f2f7;border-radius:99px;height:7px;overflow:hidden}
.pn-funil-bar{height:100%;border-radius:99px;background:var(--violet)}
.pn-funil-n{font-size:.82rem;font-weight:800;text-align:right}
.pn-funil-pct{font-size:.68rem;color:var(--t3);text-align:right}
.pn-funil-t{font-size:.68rem;color:var(--t3);text-align:right;font-family:'DM Mono',monospace;white-space:nowrap}
.pn-faixas{display:flex;gap:.4rem;flex-wrap:wrap}
.pn-faixa{flex:1;min-width:88px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.55rem .65rem}
.pn-faixa b{display:block;font-size:1.05rem;font-weight:800}
.pn-faixa span{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--t3)}
.pn-rank-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.pn-rank-grid h4{margin:0 0 .5rem;font-size:.75rem;color:var(--t3);text-transform:uppercase}.pn-rank-linha{display:flex;align-items:center;gap:.45rem;padding:.5rem 0;border-bottom:1px solid var(--border);font-size:.78rem}.pn-rank-pos{color:var(--violet);width:1.3rem}.pn-rank-nome{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.pn-rank-meta{text-align:right;display:flex;flex-direction:column}.pn-rank-meta small{font-size:.67rem;color:var(--t3);white-space:nowrap}@media(max-width:900px){.pn-rank-grid{grid-template-columns:1fr}}
.pn-tbl-wrap{overflow:auto}
table.pn-tbl{width:100%;border-collapse:collapse;font-size:.78rem}
table.pn-tbl th{padding:.5rem .8rem;text-align:left;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--t3);border-bottom:1px solid var(--border);white-space:nowrap}
table.pn-tbl td{padding:.55rem .8rem;border-bottom:1px solid var(--border);vertical-align:middle}
table.pn-tbl tr:last-child td{border-bottom:none}
table.pn-tbl tbody tr{cursor:pointer}
table.pn-tbl tbody tr:hover{background:#f7f9fc}
.pn-cod{font-family:'DM Mono',monospace;font-size:.72rem;color:var(--t3)}
.pn-sit{display:inline-block;font-size:.65rem;font-weight:700;padding:.12rem .5rem;border-radius:20px;color:#fff;white-space:nowrap}
.pn-ex{color:var(--red);font-weight:800}
.pn-at{color:var(--amber);font-weight:800}
.pn-ok{color:var(--green);font-weight:700}
.pn-nd{color:var(--t3)}
`;

function pnCSS(){
  if (document.getElementById('pn-css')) return;
  const st = document.createElement('style');
  st.id = 'pn-css'; st.textContent = PN_CSS;
  document.head.appendChild(st);
}

// ─── Blocos de desenho ───────────────────────────────────────────────────────
// Todo cartão nasce com title=. Um KPI sem definição escrita ao lado vira
// discussão na reunião: cada um lê o número do jeito que lhe convém.
function pnKpi(o){
  const val = o.valor == null ? '—' : o.valor;
  const tam = String(val).length > 9 ? 'font-size:1.15rem' : '';
  return `<div class="kpi-card ${pnEsc(o.cor || 'kpi-blue')}" title="${pnEsc(o.titulo || '')}">
    <div class="kpi-label">${pnEsc(o.rotulo)}</div>
    <div class="kpi-value" style="${tam}">${pnEsc(val)}</div>
    <div class="kpi-sub">${o.subHtml || pnEsc(o.sub || '')}</div>
  </div>`;
}

function pnSpark(valores, titulo){
  if (!valores.length) return '';
  const max = Math.max(...valores, 1);
  return `<div class="pn-spark" title="${pnEsc(titulo)}">` +
    valores.map(v => `<i style="height:${Math.max(6, Math.round((v / max) * 100))}%"></i>`).join('') +
    '</div>';
}

// etapas: [{nome, n, titulo, tempo, tempoTitulo}]
function pnFunil(etapas){
  const topo = etapas.length ? etapas[0].n : 0;
  return etapas.map(e => {
    const pct = topo ? e.n / topo : 0;
    return `<div class="pn-funil-row" title="${pnEsc(e.titulo || '')}">
      <div class="pn-funil-nome">${pnEsc(e.nome)}</div>
      <div class="pn-funil-track"><div class="pn-funil-bar" style="width:${(pct * 100).toFixed(1)}%"></div></div>
      <div class="pn-funil-n">${pnEsc(String(e.n))}</div>
      <div class="pn-funil-pct">${pnEsc(pnPct(pct))}</div>
      <div class="pn-funil-t" title="${pnEsc(e.tempoTitulo || '')}">${pnEsc(e.tempo || '—')}</div>
    </div>`;
  }).join('');
}

function pnPainelBox(titulo, nota, conteudo){
  return `<div class="panel pn-secao" style="padding:1.15rem">
    <div class="sec-title">${pnEsc(titulo)}</div>
    ${nota ? `<div class="pn-nota">${pnEsc(nota)}</div>` : ''}
    ${conteudo}
  </div>`;
}

function pnAviso(texto, tipo){
  return `<div class="pn-aviso ${tipo === 'info' ? 'i' : ''}">${pnEsc(texto)}</div>`;
}

function pnSeletorPeriodo(painel){
  return `<select class="pn-periodo" onchange="pnTrocarPeriodo(this.value,'${pnEsc(painel)}')" aria-label="Período">` +
    PN_PERIODOS.map(([d, r]) =>
      `<option value="${d}"${d === PN.dias ? ' selected' : ''}>${pnEsc(r)}</option>`).join('') +
    '</select>';
}

function pnTrocarPeriodo(dias, painel){
  PN.dias = Number(dias) || 0;
  const alvo = document.getElementById('painel-modulo');
  if (!alvo) return;
  if (painel === 'PRE_ANALISE') pnDesenharPA(alvo); else pnDesenharCO(alvo);
}

function pnRotuloPeriodo(){
  const p = PN_PERIODOS.find(x => x[0] === PN.dias);
  return PN.dias ? ('últimos ' + (p ? p[1] : PN.dias + ' dias')) : 'todo o histórico';
}
function pnInicio(){ return PN.dias ? Date.now() - PN.dias * 864e5 : 0; }

// Quando a licença não está confirmada, o painel não busca nada. Esconder é
// conveniência; quem forçar continua barrado pelo RLS — mas uma consulta a
// tabela de módulo desligado é exatamente o que o dono do produto proibiu.
function pnSemLicenca(alvo, modulo, indeterminado){
  alvo.innerHTML = indeterminado
    ? pnAviso('Não foi possível confirmar a licença do módulo ' + modulo + ' agora. Nenhum dado foi consultado.')
    : pnAviso('O módulo ' + modulo + ' não está liberado para este cliente.');
}

function pnCarregando(nome){
  return `<div class="pn-vazio"><div class="spinner"></div><div style="margin-top:.6rem">Carregando o painel de ${pnEsc(nome)}…</div></div>`;
}

// ═════════════════════════════════════════════════════════════════════════════
// PRÉ-ANÁLISE
// ═════════════════════════════════════════════════════════════════════════════
async function a1PainelPreAnalise(alvo){
  pnCSS();
  const lic = await a1HasModule('PRE_ANALISE');
  if (lic !== true) { pnSemLicenca(alvo, 'Pré-análise', lic === null); return; }

  alvo.innerHTML = pnCarregando('Pré-análise');
  try {
    if (!PN.pa) PN.pa = await pnCarregarPA();
  } catch {
    alvo.innerHTML = pnAviso('Não foi possível carregar o painel de Pré-análise.');
    return;
  }
  pnDesenharPA(alvo);
}

async function pnCarregarPA(){
  const h = { headers: A1.headers() };
  // A Venda é outro módulo e outra licença: sem ele, a conversão para o
  // Venda marcaria 0% numa operação que nem tem a etapa.
  const temCo = (await a1HasModule('COMERCIAL')) === true;

  // As situações vêm TODAS, inclusive as desativadas: um processo pode estar
  // parado numa situação que o gestor tirou da esteira ontem, e sem a linha
  // dela a flag não resolve e o processo entraria como ativo por engano.
  const pedidos = [
    fetch(`${A1.rest('a1_pa_situacoes')}?select=id,nome,flag,cor,sla_horas,ordem&order=ordem.asc`, h)
      .then(r => r.json()).catch(() => []),
    A1.buscarTudo(`${A1.rest('a1_pre_analises')}?select=id,codigo,unidade,criado_em,situacao_id,situacao_em,vence_em,empreendimento_id,corretor_id,imobiliaria_id,empresa_id,correspondente_id,analista_id&order=criado_em.desc`),
    A1.buscarTudo(`${A1.rest('a1_pa_analises_credito')}?select=pre_analise_id,versao,status,criado_em,decidido_em`),
    // criado_em e analisado_em entram para o tempo de conferência documental —
    // o SLA do analista, que é diário e não aparecia em lugar nenhum.
    A1.buscarTudo(`${A1.rest('a1_pa_documentos')}?select=pre_analise_id,tipo,status,versao,criado_em,analisado_em`),
    // Só o vínculo: pessoa_id e renda ficam de fora porque isto é tela executiva.
    A1.buscarTudo(`${A1.rest('a1_pa_participantes')}?papel=eq.TITULAR&select=pre_analise_id`),
    fetch(`${A1.rest('a1_developments')}?select=id,name`, h).then(r => r.json()).catch(() => []),
    A1.buscarTudo(`${A1.rest('a1_partners')}?select=id,name,type,extra`),
    A1.buscarTudo(`${A1.rest('a1_corr_empresas')}?select=id,name`),
    // O catálogo de tipos de documento. O comentário do topo deste arquivo dizia
    // que ele não existia — passou a existir em 2026-09-09_documento_obrigatorio,
    // e sem esta leitura a completude do dossiê continuava impressa como traço
    // num número que o banco já sabe calcular.
    fetch(`${A1.rest('a1_config')}?key=eq.doc_types&select=value`, h).then(r => r.json()).catch(() => [])
  ];
  // Estes dois entram DEPOIS do catálogo, que é a posição 8. Trocar a ordem aqui
  // desalinharia a leitura de r[] lá embaixo em silêncio.
  if (temCo) {
    pedidos.push(A1.buscarTudo(`${A1.rest('a1_comerciais')}?select=id,pre_analise_id,criado_em`));
    pedidos.push(A1.buscarTudo(`${A1.rest('a1_co_eventos')}?select=comercial_id,evento,criado_em`));
  }
  const r = await Promise.all(pedidos);
  // O índice do catálogo é FIXO no começo da lista opcional: os dois pedidos de
  // Venda entram DEPOIS dele, então ele nunca escorrega quando a licença muda.
  let tipos = [];
  try { tipos = JSON.parse((pnLinhas(r[8])[0] || {}).value || '[]'); } catch { tipos = []; }
  return {
    temCo, tipos: Array.isArray(tipos) ? tipos : [],
    situacoes: pnLinhas(r[0]),
    pre:       pnLinhas(r[1]),
    credito:   pnLinhas(r[2]),
    docs:      pnLinhas(r[3]),
    titulares: pnLinhas(r[4]),
    empr:      pnLinhas(r[5]),
    parceiros: pnLinhas(r[6]),
    empresas:  pnLinhas(r[7]),
    com:       temCo ? pnLinhas(r[9])  : [],
    coEventos: temCo ? pnLinhas(r[10]) : []
  };
}

// Flags que encerram a pré-análise. APROVADO fica FORA desta lista de propósito:
// a aprovada que ainda não virou Venda é justamente o caso que precisa
// aparecer, e ela some da fila se for tratada como terminal.
const PN_PA_TERMINAIS = ['REPROVADO', 'CANCELADO', 'ENCERRADO'];

function pnCalcPA(d){
  const inicio = pnInicio();
  const sitPorId = {};
  d.situacoes.forEach(s => { sitPorId[s.id] = s; });
  const emprPorId = {};
  d.empr.forEach(e => { emprPorId[e.id] = e.name; });
  // Índice por id: o tempo total de pré-análise precisa da data de criação de
  // cada uma, e procurá-la com find() dentro do laço das decisões custava
  // n×m — num cliente com dez mil pré-análises isso trava a aba por segundos.
  const prePorId = {};
  d.pre.forEach(p => { prePorId[p.id] = p; });

  // Uma decisão por pré-análise: a de maior versão. INVALIDADA continua sendo
  // a vigente quando é a última — e é assim que ela some do numerador e do
  // denominador da taxa, em vez de virar uma reprovação que nunca houve.
  const vigente = {};
  d.credito.forEach(c => {
    const a = vigente[c.pre_analise_id];
    if (!a || (c.versao || 0) > (a.versao || 0)) vigente[c.pre_analise_id] = c;
  });

  const temTitular = {};
  d.titulares.forEach(t => { temTitular[t.pre_analise_id] = true; });

  const comPorPa = {};
  d.com.forEach(c => { if (c.pre_analise_id) comPorPa[c.pre_analise_id] = c; });
  // O carimbo do handoff é o evento, não a linha: a linha pode ter sido criada
  // por importação, o evento só existe quando o gatilho rodou.
  const nascimentoCom = {};
  d.coEventos.forEach(e => {
    if (e.evento === 'criado_da_pre_analise') nascimentoCom[e.comercial_id] = e.criado_em;
  });

  // Documentos por pré-análise, já classificados.
  const doc = {};
  d.docs.forEach(x => {
    const o = doc[x.pre_analise_id] || (doc[x.pre_analise_id] = { total:0, pendente:0, reenvio:0, enviados:0, tipos:[] });
    o.total++;
    if (x.status === 'PENDENTE_ENVIO' || x.status === 'REPROVADO') o.pendente++;
    if ((x.versao || 1) > 1 || x.status === 'SUBSTITUIDO') o.reenvio++;
    if (x.status !== 'PENDENTE_ENVIO') o.enviados++;
    // Entregue é o que o banco considera entregue em a1_pa_docs_faltando: nem
    // REPROVADO, nem SUBSTITUIDO, nem PENDENTE_ENVIO. Repetir a regra com outro
    // critério aqui faria a tela discordar de quem tranca de verdade.
    if (['REPROVADO','SUBSTITUIDO','PENDENTE_ENVIO'].indexOf(x.status) < 0) o.tipos.push(x.tipo);
  });

  const noPeriodo = iso => { const t = pnMs(iso); return t != null && t >= inicio; };
  const flagDe = p => { const s = sitPorId[p.situacao_id]; return s ? (s.flag || null) : null; };
  const ativa = p => !p.situacao_id || PN_PA_TERMINAIS.indexOf(flagDe(p)) < 0;

  // ── Entradas, com a série semanal ──
  const entradas = d.pre.filter(p => noPeriodo(p.criado_em));
  const semanas = Math.max(1, Math.min(26, Math.ceil((PN.dias || 180) / 7)));
  const serie = new Array(semanas).fill(0);
  entradas.forEach(p => {
    const idx = semanas - 1 - Math.floor((Date.now() - pnMs(p.criado_em)) / (7 * 864e5));
    if (idx >= 0 && idx < semanas) serie[idx]++;
  });
  // Período anterior, do mesmo tamanho: crescer ou encolher só significa algo
  // contra a régua anterior.
  const anterior = PN.dias
    ? d.pre.filter(p => { const t = pnMs(p.criado_em);
        return t != null && t >= inicio - PN.dias * 864e5 && t < inicio; }).length
    : null;

  // ── Ativas ──
  const ativas = d.pre.filter(ativa);

  // ── Taxa de aprovação ──
  const decididas = Object.keys(vigente).map(k => vigente[k])
    .filter(c => (c.status === 'APROVADO' || c.status === 'REPROVADO') && noPeriodo(c.decidido_em));
  const aprovadasNoPeriodo = decididas.filter(c => c.status === 'APROVADO').length;
  const taxaAprov = decididas.length ? aprovadasNoPeriodo / decididas.length : null;

  // ── Aprovação de primeira (first-pass yield) ──
  // Decisão vigente na versão 1 significa que o dossiê fechou sem nova rodada.
  // É o que separa correspondente que aprova BEM de correspondente que aprova na
  // terceira tentativa — a taxa de aprovação sozinha dá o mesmo número para os
  // dois, e quem paga a diferença é o prazo do cliente.
  const dePrimeira = decididas.filter(c => (c.versao || 1) === 1).length;
  const taxaPrimeira = decididas.length ? dePrimeira / decididas.length : null;

  // ── SLA: o relógio é o da SITUAÇÃO, não o da criação ──
  let vencidos = 0, emRisco = 0, semPrazo = 0;
  const fila = [];
  ativas.forEach(p => {
    const s = sitPorId[p.situacao_id];
    const horas = s && s.sla_horas;
    const desde = pnMs(p.situacao_em) || pnMs(p.criado_em);
    const decorridas = desde ? (Date.now() - desde) / 36e5 : 0;
    const venceu = (pnMs(p.vence_em) != null && pnMs(p.vence_em) < Date.now());
    let nivel = 'nd';
    if (horas && horas > 0) {
      if (decorridas > horas || venceu) nivel = 'ex';
      else if (decorridas >= horas * 0.75) nivel = 'at';
      else nivel = 'ok';
    } else if (venceu) {
      nivel = 'ex';
    } else {
      semPrazo++;
    }
    if (nivel === 'ex') vencidos++; else if (nivel === 'at') emRisco++;
    fila.push({
      id: p.id, codigo: p.codigo || '—', unidade: p.unidade || '',
      empr: emprPorId[p.empreendimento_id] || '—',
      sit: s ? s.nome : 'sem situação', cor: (s && s.cor) || '#64748b',
      decorridas, nivel, sla: horas || null
    });
  });
  // Denominador do SLA: só quem tem prazo cadastrado. Situação sem sla_horas
  // fora dos dois lados — senão o denominador mente para baixo.
  const comPrazo = ativas.length - semPrazo;

  // ── Tempo até decisão ──
  const tDecisao = [], tTotal = [];
  Object.keys(vigente).forEach(k => {
    const c = vigente[k];
    if (c.status !== 'APROVADO' && c.status !== 'REPROVADO') return;
    if (!noPeriodo(c.decidido_em)) return;
    const dec = pnMs(c.decidido_em), abriu = pnMs(c.criado_em);
    if (dec != null && abriu != null) tDecisao.push((dec - abriu) / 36e5);
    const pa = prePorId[k];
    const nasceu = pa ? pnMs(pa.criado_em) : null;
    if (dec != null && nasceu != null) tTotal.push((dec - nasceu) / 36e5);
  });

  // ── Documentos ──
  const comDoc = ativas.filter(p => doc[p.id] && doc[p.id].total);
  const comPendencia = ativas.filter(p => doc[p.id] && doc[p.id].pendente > 0).length;
  const baseReenvio = d.pre.filter(p => doc[p.id] && doc[p.id].enviados > 0);
  const comReenvio = baseReenvio.filter(p => doc[p.id].reenvio > 0).length;
  // Pareto do que trava: só por TIPO de documento. Por pessoa seria ranking de
  // gente, e o dado pessoal não sobe para tela executiva.
  const paretoTipo = {};
  d.docs.forEach(x => {
    if (x.status !== 'PENDENTE_ENVIO' && x.status !== 'REPROVADO') return;
    paretoTipo[x.tipo || '—'] = (paretoTipo[x.tipo || '—'] || 0) + 1;
  });

  // ── Completude do dossiê, agora que o catálogo existe ──
  // a1DocsFaltando é a MESMA função que pre-analise.html usa antes de mover, e a
  // mesma regra de a1_pa_docs_faltando no banco. Cliente que não marcou nenhum
  // tipo como obrigatório não tem denominador: o painel diz isso em vez de
  // imprimir 100% de dossiê completo sobre exigência nenhuma.
  const obrigatorios = a1DocsObrigatorios(d.tipos || [], 'PRE_ANALISE');
  const completas = obrigatorios.length
    ? ativas.filter(p => !a1DocsFaltando(d.tipos || [], 'PRE_ANALISE', (doc[p.id] || {}).tipos || []).length).length
    : null;
  const completude = obrigatorios.length && ativas.length ? completas / ativas.length : null;

  // ── Tempo de conferência documental ──
  // analisado_em − criado_em do DOCUMENTO. É o relógio do analista, e ele corre
  // em horas, não em dias: publicar só o tempo até a decisão de crédito escondia
  // a fila que se forma antes dela.
  const tConf = [];
  d.docs.forEach(x => {
    if (!x.analisado_em || !noPeriodo(x.analisado_em)) return;
    const a = pnMs(x.analisado_em), c0 = pnMs(x.criado_em);
    if (a != null && c0 != null && a >= c0) tConf.push((a - c0) / 36e5);
  });

  // ── Reprovação documental POR TIPO, com denominador ──
  // O Pareto acima soma pendente + reprovado sem base: um tipo aparece no topo
  // só por ser o mais exigido. Com denominador a leitura vira decisão — "a
  // certidão X reprova 40% das vezes, o problema é a orientação, não o cliente".
  const porTipo = {};
  d.docs.forEach(x => {
    if (!x.analisado_em || !noPeriodo(x.analisado_em)) return;
    const t = x.tipo || '—';
    const o = porTipo[t] || (porTipo[t] = { tipo:t, analisados:0, reprovados:0 });
    o.analisados++;
    if (x.status === 'REPROVADO') o.reprovados++;
  });
  const reprovaTipo = Object.values(porTipo)
    .filter(o => o.analisados >= 5)   // mesma régua do ranking: abaixo disso é acaso
    .map(o => ({ ...o, taxa: o.reprovados / o.analisados }))
    .sort((a,b) => b.taxa - a.taxa || b.analisados - a.analisados)
    .slice(0, 6);

  // ── Funil, sobre a safra criada no período ──
  const safra = PN.dias ? entradas : d.pre;
  const semPendencia = safra.filter(p => !doc[p.id] || doc[p.id].pendente === 0);
  const concluidas = safra.filter(p => {
    const c = vigente[p.id]; return c && (c.status === 'APROVADO' || c.status === 'REPROVADO');
  });
  const aprovadas = safra.filter(p => { const c = vigente[p.id]; return c && c.status === 'APROVADO'; });
  const elegiveis = aprovadas.filter(p => temTitular[p.id]);
  const viraramCom = safra.filter(p => comPorPa[p.id]);
  // A taxa conta só o que está DENTRO do denominador. Existe Venda de
  // pré-análise que hoje não é elegível — a aprovação foi invalidada depois, ou
  // o titular saiu — e usar a contagem cheia dava mais de 100%, que numa tela
  // executiva vira chamado de bug em vez de leitura de funil.
  const elegiveisViraram = elegiveis.filter(p => comPorPa[p.id]).length;

  const dtDecisao = [], dtHandoff = [];
  concluidas.forEach(p => {
    const dec = pnMs(vigente[p.id].decidido_em), nasceu = pnMs(p.criado_em);
    if (dec != null && nasceu != null) dtDecisao.push((dec - nasceu) / 36e5);
  });
  viraramCom.forEach(p => {
    const co = comPorPa[p.id];
    const t = pnMs(nascimentoCom[co.id]) || pnMs(co.criado_em);
    const dec = vigente[p.id] ? pnMs(vigente[p.id].decidido_em) : null;
    if (t != null && dec != null) dtHandoff.push((t - dec) / 36e5);
  });

  return {
    entradas: entradas.length, anterior, serie,
    ativas: ativas.length,
    taxaAprov, decididas: decididas.length,
    taxaPrimeira, dePrimeira,
    obrigatorios: obrigatorios.length, completude, completas,
    p50Conf: pnPercentil(tConf, 0.5), p90Conf: pnPercentil(tConf, 0.9), conferidos: tConf.length,
    reprovaTipo,
    vencidos, emRisco, comPrazo, semPrazo,
    p50Dec: pnPercentil(tDecisao, 0.5), p90Dec: pnPercentil(tDecisao, 0.9),
    p50Tot: pnPercentil(tTotal, 0.5),
    pendencia: ativas.length ? comPendencia / ativas.length : null,
    comPendencia, semDossie: ativas.length - comDoc.length,
    reenvio: baseReenvio.length ? comReenvio / baseReenvio.length : null,
    baseReenvio: baseReenvio.length,
    conversao: elegiveis.length ? elegiveisViraram / elegiveis.length : null,
    elegiveis: elegiveis.length, elegiveisViraram,
    paretoTipo,
    funil: {
      criadas: safra.length, semPendencia: semPendencia.length, concluidas: concluidas.length,
      aprovadas: aprovadas.length, elegiveis: elegiveis.length, comerciais: viraramCom.length,
      p50Decisao: pnPercentil(dtDecisao, 0.5), p50Handoff: pnPercentil(dtHandoff, 0.5)
    },
    fila: fila.sort((a, b) => b.decorridas - a.decorridas)
  };
}

// ─── Rankings e corte de agregado ──────────────────────────────────────────
//
// São DOIS cortes, e confundi-los foi o erro que este bloco conserta.
//
//   Corte de LINHA — quais processos entram na conta. É do RLS (a1_pa_visivel /
//   a1_co_visivel) e já está feito quando o dado chega aqui. Não se mexe.
//
//   Corte de AGREGADO — posso ver soma de dinheiro do cliente inteiro e nome de
//   terceiro num quadro de classificação. ISTO NÃO EXISTIA. O painel somava em
//   reais tudo que o RLS entregasse, e `ver_todos_analistas` entrega a carteira
//   inteira — que é justamente o que o perfil-modelo Analista liga. Na prática:
//   analista com perfil padrão abria o painel e lia o VGV contratado e o
//   pipeline em reais da operação inteira do cliente. Papel operacional lendo
//   número de dono.
//
// A régua agora é `ver_consolidado_financeiro`. Sem ela o painel não esconde o
// painel: troca cada número em R$ pela mesma informação em quantidade. A pessoa
// continua enxergando o próprio trabalho; o caixa é que para de aparecer.
function pnEhGestor(){ const u = A1.user || {}; return u.role !== 'partner' || u.permissions?.gerente === true; }

// Coordenador saiu do ranking INTEIRO. Ele tem visão completa da carteira, então
// o RLS lhe entrega tudo — e o quadro listava nominalmente corretores de OUTRO
// coordenador. Ele continua vendo ranking: o da equipe dele, filtrado abaixo.
function pnPodeVerRanking(){ const u = A1.user || {}; return pnEhGestor() || u.type === 'coordenador'; }

function pnPodeVerConsolidado(){
  const u = A1.user || {};
  if (pnEhGestor()) return true;
  return u.permissions?.ver_consolidado_financeiro === true;
}

// Dinheiro na tela só com o corte de agregado. Para os demais, traço — e o
// motivo escrito no title, senão o número vira "o painel quebrou".
const PN_SEM_CONSOLIDADO = 'Valores consolidados em R$ dependem da permissão "Ver valores consolidados (R$)". '
  + 'Sem ela o painel mostra quantidade, não soma — os mesmos processos, sem o caixa do cliente.';
function pnDinheiro(cent){ return pnPodeVerConsolidado() ? pnBRL(cent) : '—'; }

const PN_RANK_MIN  = 5;  // abaixo disto a posição é sorteio, não classificação
const PN_RANK_TOPO = 8;  // a lista para no 8º: nunca se publica quem está embaixo

function pnRank(linhas,chave,nomes,valorFn,okFn){
  const m = {};
  linhas.forEach(x => {
    const id = x[chave]; if (!id) return;
    const r = m[id] || (m[id] = { id, nome: nomes[id] || 'Não vinculado', total:0, fechados:0, decisoes:0, valor:0 });
    const ok = okFn(x);
    r.total++;
    if (ok === true) r.fechados++;
    if (ok === true || ok === false) r.decisoes++;
    r.valor += Number(valorFn(x)) || 0;
  });
  // Devolve a lista INTEIRA, ordenada. Quem corta em 8 é quem desenha: fatiar
  // aqui fazia "Minha performance" ficar vazia para quem está em 9º — e é
  // exatamente quem mais precisa de ver a própria linha.
  //
  // O desempate depois do valor é o VOLUME, não os fechados. A Pré-análise não
  // tem dinheiro: lá valorFn devolve 0 para todo mundo, o primeiro critério
  // empata sempre e manda o segundo. Com fechados na frente, o quadro dizia
  // "ordenado por volume no período" e coroava quem tinha MENOS processos e
  // mais aprovações — o gestor premiava a pessoa errada lendo a legenda ao pé
  // da letra.
  return Object.values(m)
    .map(r => ({ ...r, taxa: r.decisoes ? r.fechados / r.decisoes : null }))
    .sort((a,b) => b.valor - a.valor || b.total - a.total || b.fechados - a.fechados);
}

function pnRankHtml(lista,fmt,sub){
  const topo = (lista || []).slice(0, PN_RANK_TOPO);
  if (!topo.length) return '<div class="pn-vazio">Sem dados vinculados no período.</div>';
  return '<div class="pn-rank">' + topo.map((r,i) => {
    // Ordenar três pessoas por taxa é sorteio com cara de mérito. Abaixo do
    // mínimo a linha aparece sem colocação, e diz por quê.
    const magro = r.total < PN_RANK_MIN;
    const dica  = magro ? 'Amostra pequena: ' + r.total + ' processo(s) no período. Abaixo de '
                        + PN_RANK_MIN + ' a posição não separa mérito de acaso, então esta linha '
                        + 'aparece sem colocação.' : '';
    return '<div class="pn-rank-linha"' + (dica ? ' title="' + pnEsc(dica) + '"' : '') + '>'
      + '<b class="pn-rank-pos">' + pnEsc(magro ? '·' : (i+1) + '.') + '</b>'
      + '<span class="pn-rank-nome">' + pnEsc(r.nome) + '</span>'
      + '<span class="pn-rank-meta"><b>' + pnEsc(fmt(r)) + '</b><small>'
      + pnEsc(sub(r) + (magro ? ' · amostra pequena' : '')) + '</small></span></div>';
  }).join('') + '</div>';
}

// Mediana do time, anonimizada. É a régua que substitui o ranking para quem não
// pode ver nome de terceiro: dá referência sem expor colega nenhum.
function pnMedianaDe(lista,campo){
  return pnPercentil((lista || []).map(r => Number(r[campo]) || 0), 0.5);
}

function pnFaixa(rotulo,valor,dica){
  return '<div class="pn-faixa" title="' + pnEsc(dica || '') + '"><b>' + pnEsc(String(valor))
       + '</b><span>' + pnEsc(rotulo) + '</span></div>';
}

// "Minha performance" era uma linha só: n processos e x% de aprovação. Quem
// recebe isso não tem o que fazer com o número — não há régua. A pesquisa sobre
// classificação diz o mesmo: número solto, ou ranking em que a pessoa não
// aparece, não corrige rota, desengaja. Agora vêm três réguas: o próprio
// período anterior, a mediana anônima do time e a taxa.
function pnMinhaPerformance(o){
  const eu = o.eu, antes = o.antes;
  if (!eu) return '<div class="pn-vazio">' + pnEsc(o.vazio) + '</div>';
  const caixas = [ pnFaixa(o.unidade, eu.total, 'Processos com você como responsável, criados no período.') ];
  if (antes != null) {
    const d = antes === 0 ? null : Math.round(((eu.total - antes) / antes) * 100);
    caixas.push(pnFaixa('vs. período anterior',
      d == null ? '—' : (d >= 0 ? '+' : '') + d + '%',
      antes === 0 ? 'Você não teve processo no período anterior, então não há base de comparação.'
                  : 'Mesma janela imediatamente anterior: ' + antes + ' processo(s). A comparação é com você mesmo, não com o time.'));
  }
  if (o.mediana != null) {
    caixas.push(pnFaixa('mediana do time', Math.round(o.mediana),
      'Mediana de processos por pessoa no período, sobre quem tem vínculo. É anônima de propósito: '
      + 'serve de régua sem expor o resultado nominal de ninguém.'));
  }
  caixas.push(pnFaixa(o.rotuloTaxa, eu.taxa == null ? '—' : pnPct(eu.taxa),
    eu.decisoes ? o.dicaTaxa + ' Base: ' + eu.decisoes + ' decisão(ões).'
                : 'Nenhum processo seu teve decisão no período.'));
  return '<div class="pn-faixas">' + caixas.join('') + '</div>';
}

function pnRankBox(titulo,descricao,grupos,pessoal){
  if (!pnPodeVerRanking()) return pnPainelBox('Minha performance', pessoal.descricao || descricao, pnMinhaPerformance(pessoal));
  return pnPainelBox(titulo, descricao,
    '<div class="pn-rank-grid">' + grupos.map(g =>
      '<div><h4>' + pnEsc(g.nome) + '</h4>' + pnRankHtml(g.lista, g.fmt, g.sub) + '</div>').join('') + '</div>');
}

// A chave pela qual a pessoa aparece no próprio painel. `despachante` cai fora
// de propósito: ele não é corretor, não é analista e não é correspondente —
// mandá-lo para `corretor_id`, como fazia o ramo `else` de antes, produzia um
// bloco vazio com o rótulo "Minha performance", que lê como "você não produziu
// nada". Nulo aqui vira uma frase honesta: este painel não mede o seu papel.
function pnChavePessoalPA(u){
  return u.type === 'analista' ? 'analista_id'
       : u.type === 'cca'      ? 'correspondente_id'
       : u.type === 'corretor' ? 'corretor_id' : null;
}

function pnBlocoRankingsPA(d){
  const nomes = {};
  (d.parceiros || []).forEach(p => nomes[p.id] = p.name || 'Sem nome');
  (d.empresas  || []).forEach(e => nomes[e.id] = e.name || 'Sem empresa');
  const dec = {};
  (d.credito || []).forEach(x => { const a = dec[x.pre_analise_id]; if (!a || (x.versao||0) > (a.versao||0)) dec[x.pre_analise_id] = x; });
  const naJanela = (iso,ini,fim) => { const t = pnMs(iso); return t != null && t >= ini && (fim == null || t < fim); };
  const marcar = x => ({ ...x, _dec: dec[x.id] });
  const base    = (d.pre || []).filter(x => !PN.dias || naJanela(x.criado_em, pnInicio(), null)).map(marcar);
  const anterior = PN.dias
    ? (d.pre || []).filter(x => naJanela(x.criado_em, pnInicio() - PN.dias * 864e5, pnInicio())).map(marcar)
    : null;

  const ok  = x => !x._dec ? null : (x._dec.status === 'APROVADO' ? true : (x._dec.status === 'REPROVADO' ? false : null));
  const rank = (k,linhas) => pnRank(linhas || base, k, nomes, () => 0, ok);
  const fmt = r => r.total + ' pré-análise(s)';
  const sub = r => (r.taxa == null ? 'sem decisão' : pnPct(r.taxa) + ' aprovação') + ' · ' + r.fechados + ' aprovada(s)';

  // Coordenador não ranqueia usuário correspondente — não é a equipe dele e não
  // é o nível dele. Empresa e analista, sim: é com esses dois que ele negocia
  // prazo. Gestor e gerente veem os três.
  const grupos = [{ nome:'Empresa correspondente', lista: rank('empresa_id'), fmt, sub }];
  if (pnEhGestor()) grupos.push({ nome:'Usuário correspondente', lista: rank('correspondente_id'), fmt, sub });
  grupos.push({ nome:'Analista', lista: rank('analista_id'), fmt, sub });

  const u = A1.user || {}, chave = pnChavePessoalPA(u);
  const lista = chave ? rank(chave) : [];
  const pessoal = {
    unidade:'minhas pré-análises', rotuloTaxa:'minha aprovação',
    dicaTaxa:'aprovadas ÷ (aprovadas + reprovadas) entre as suas, pela decisão de maior versão.',
    descricao:'O seu resultado no período, com o seu próprio período anterior e a mediana anônima do time como régua.',
    eu:     chave ? lista.find(r => r.id === u.id) || null : null,
    antes:  chave && anterior ? (rank(chave, anterior).find(r => r.id === u.id) || { total:0 }).total : null,
    mediana: chave ? pnMedianaDe(lista, 'total') : null,
    vazio:  chave ? 'Nenhuma pré-análise vinculada a você no período.'
                  : 'Este painel mede corretor, analista e usuário correspondente. O seu papel não entra nessa conta — o que não quer dizer que você não produziu.'
  };
  return pnRankBox('Rankings de Pré-análise',
    'Ordenado por volume no período; aprovação considera somente decisões aprovadas ou reprovadas. '
    + 'Linha com menos de ' + PN_RANK_MIN + ' processos aparece sem colocação.', grupos, pessoal);
}

function pnBlocoRankingsCO(d){
  const nomes = {}, porId = {};
  (d.parceiros || []).forEach(p => { nomes[p.id] = p.name || 'Sem nome'; porId[p.id] = p; });
  const ct = {};
  (d.contratos || []).forEach(x => { const a = ct[x.comercial_id]; if (!a || (x.versao||0) > (a.versao||0)) ct[x.comercial_id] = x; });
  const naJanela = (iso,ini,fim) => { const t = pnMs(iso); return t != null && t >= ini && (fim == null || t < fim); };
  const marcar = x => ({ ...x, _ok: ct[x.id]?.status === 'ASSINADO', _coord: porId[x.corretor_id]?.extra?.coordenador_id || null });

  const u = A1.user || {};
  // Coordenador vê a EQUIPE dele. O RLS lhe entrega a carteira inteira do
  // cliente por causa da visão completa, então sem este filtro o quadro listava
  // nominalmente corretor de outro coordenador — e ninguém ranqueia o time do
  // vizinho. Gestor e gerente continuam vendo todos.
  const meuTime = !pnEhGestor() && u.type === 'coordenador';
  const daEquipe = x => !meuTime || x._coord === u.id;

  const base = (d.com || []).filter(x => !PN.dias || naJanela(x.criado_em, pnInicio(), null)).map(marcar).filter(daEquipe);
  const anterior = PN.dias
    ? (d.com || []).filter(x => naJanela(x.criado_em, pnInicio() - PN.dias * 864e5, pnInicio())).map(marcar).filter(daEquipe)
    : null;

  const valor = x => x._ok ? pnValorCO(x) : 0;
  const rank = (k,linhas) => pnRank(linhas || base, k, nomes, valor, x => x._ok);
  // Sem o corte de agregado o quadro deixa de ser em reais e passa a ser em
  // contratos. A ordem de baixo continua a mesma — o que muda é o que se lê.
  const fmt = r => pnPodeVerConsolidado() ? pnBRL(r.valor) : r.fechados + ' assinado(s)';
  const sub = r => pnPodeVerConsolidado() ? r.fechados + ' assinado(s) · ' + r.total + ' venda(s)'
                                          : r.total + ' venda(s) no período';

  const grupos = [{ nome:'Corretores', lista: rank('corretor_id'), fmt, sub },
                  { nome:'Imobiliárias', lista: rank('imobiliaria_id'), fmt, sub }];
  // Ninguém ranqueia o próprio nível ao lado dos pares: o quadro de
  // coordenadores é de gestor e gerente.
  if (pnEhGestor()) grupos.push({ nome:'Coordenadores', lista: rank('_coord'), fmt, sub });

  const chave = u.type === 'corretor' ? 'corretor_id' : null;
  const lista = chave ? rank(chave) : [];
  const pessoal = {
    unidade:'minhas vendas', rotuloTaxa:'minha conversão',
    dicaTaxa:'vendas suas com contrato assinado ÷ vendas suas no período.',
    descricao:'O seu resultado no período, com o seu próprio período anterior e a mediana anônima do time como régua.',
    eu:     chave ? lista.find(r => r.id === u.id) || null : null,
    antes:  chave && anterior ? (rank(chave, anterior).find(r => r.id === u.id) || { total:0 }).total : null,
    mediana: chave ? pnMedianaDe(lista, 'total') : null,
    vazio:  chave ? 'Nenhuma venda vinculada a você no período.'
                  : 'Este painel mede o corretor da venda. O seu papel não entra nessa conta — o que não quer dizer que você não produziu.'
  };
  // A taxa do corretor é conversão, não aprovação: pnRank conta `fechados` sobre
  // `decisoes`, e aqui okFn nunca devolve false — só true. Sem isto a caixa
  // marcaria sempre 100%.
  if (pessoal.eu) pessoal.eu = { ...pessoal.eu, decisoes: pessoal.eu.total,
                                 taxa: pessoal.eu.total ? pessoal.eu.fechados / pessoal.eu.total : null };

  return pnRankBox(meuTime ? 'Rankings da minha equipe' : 'Rankings de Vendas',
    (pnPodeVerConsolidado() ? 'Ordenado por VGV de contratos assinados no período. '
                            : 'Ordenado por contratos assinados no período — valores em R$ dependem da permissão de consolidado. ')
    + (meuTime ? 'Somente os corretores vinculados a você. ' : '')
    + 'Linha com menos de ' + PN_RANK_MIN + ' processos aparece sem colocação.', grupos, pessoal);
}

function pnDesenharPA(alvo){
  const d = PN.pa, c = pnCalcPA(d), per = pnRotuloPeriodo();
  const rota = pnRota('pre-analise');

  const kpis = [
    pnKpi({ rotulo:'Entradas no período', valor: c.entradas, cor:'kpi-violet',
      subHtml: pnSpark(c.serie, 'Pré-análises criadas por semana no período') +
        (c.anterior == null ? '' : `<span>${pnEsc(
          c.anterior === 0 ? 'sem base anterior'
          : (c.entradas >= c.anterior ? '+' : '') + Math.round(((c.entradas - c.anterior) / c.anterior) * 100) + '% vs anterior')}</span>`),
      titulo: `Pré-análises CRIADAS no período (${per}) — count(a1_pre_analises) por criado_em. `
            + `Não serve de denominador para nada que use data de fechamento.` }),

    pnKpi({ rotulo:'Pré-análises ativas', valor: c.ativas, cor:'kpi-blue',
      sub:'estoque de agora',
      titulo:'Situação atual com flag fora de REPROVADO, CANCELADO e ENCERRADO; sem situação conta como ativa. '
           + 'APROVADO fica DENTRO: é o caso aprovado e ainda sem Venda que precisa aparecer. '
           + 'É estoque do momento, não do período — o schema não guarda histórico de estoque para comparar com o período anterior.' }),

    pnKpi({ rotulo:'Taxa de aprovação', valor: pnPct(c.taxaAprov), cor:'kpi-green',
      sub: c.decididas ? c.decididas + ' decisões' : 'sem decisão com data no período',
      titulo: `aprovadas ÷ (aprovadas + reprovadas), uma decisão por pré-análise (a de maior versão), período por decidido_em (${per}). `
            + 'EM_ANALISE, PENDENTE e INVALIDADA ficam fora dos dois lados: INVALIDADA é aprovação derrubada por mudança de renda, participante ou valor — contá-la como reprovação inventaria uma recusa que nunca houve.' }),

    pnKpi({ rotulo:'Aprovação de primeira', valor: pnPct(c.taxaPrimeira), cor:'kpi-green',
      sub: c.decididas ? c.dePrimeira + ' de ' + c.decididas + ' sem nova rodada' : 'sem decisão no período',
      titulo:'decisões vigentes cuja versão é 1 ÷ decisões concluídas do período. Mede RETRABALHO de crédito: '
           + 'aprovar na terceira tentativa dá a mesma taxa de aprovação que aprovar na primeira, e não é o mesmo prazo para o cliente. '
           + 'Versão > 1 significa que a análise foi refeita — renda, participante ou valor mudaram depois da primeira decisão.' }),

    pnKpi({ rotulo:'SLA vencido', valor: pnPct(c.comPrazo ? c.vencidos / c.comPrazo : null), cor:'kpi-red',
      sub: `${c.vencidos} vencidos · ${c.emRisco} em risco`,
      titulo:'vencidos ÷ ativas COM prazo cadastrado. decorridas = agora − coalesce(situacao_em, criado_em); vencido = decorridas > sla_horas da situação OU vence_em já passou; em risco = decorridas ≥ 75% do sla_horas. '
           + `O relógio é o da SITUAÇÃO, não o da criação. ${c.semPrazo} ativa(s) sem prazo definido ficam fora dos dois lados.` }),

    pnKpi({ rotulo:'Tempo até decisão', valor: pnDias(c.p50Dec), cor:'kpi-amber',
      sub: c.p90Dec == null ? 'sem decisão no período' : 'P90 ' + pnDias(c.p90Dec),
      titulo:'P50 e P90 de (decidido_em − criado_em da linha de crédito), sobre as decisões concluídas do período. '
           + 'A criação da linha de crédito é o proxy de "entrada em análise" — não existe coluna própria para isso. '
           + (c.p50Tot == null ? '' : 'Tempo total desde a criação da pré-análise: ' + pnDias(c.p50Tot) + ' (P50). ')
           + 'Percentil calculado no navegador: o PostgREST não expõe percentile_cont.' }),

    pnKpi({ rotulo:'Pendência documental', valor: pnPct(c.pendencia), cor:'kpi-amber',
      sub: `${c.comPendencia} com pendência · ${c.semDossie} sem dossiê`,
      titulo:'ativas com ≥1 documento em PENDENTE_ENVIO ou REPROVADO ÷ ativas. '
           + 'Mede o que virou linha, não o que era exigido: não existe catálogo de documento obrigatório, então dossiê vazio aparece como 100% em dia.' }),

    pnKpi({ rotulo:'Reenvio documental', valor: pnPct(c.reenvio), cor:'kpi-blue',
      sub: c.baseReenvio ? 'base de ' + c.baseReenvio : 'nenhum dossiê iniciado',
      titulo:'pré-análises com ≥1 documento em versão > 1 ou com status SUBSTITUIDO ÷ pré-análises com ≥1 documento fora de PENDENTE_ENVIO. '
           + 'É o indicador antecedente de retrabalho que dá para calcular sem catálogo de obrigatórios.' })
  ];

  // Conversão só existe com os dois módulos ligados. Sem COMERCIAL, a tabela
  // não devolve linha e o cartão marcaria 0% numa operação que nem tem a etapa.
  if (d.temCo) {
    kpis.push(pnKpi({ rotulo:'Conversão → Venda', valor: pnPct(c.conversao), cor:'kpi-green',
      sub: c.elegiveis ? `${c.elegiveisViraram} de ${c.elegiveis} elegíveis` : 'nenhuma elegível no período',
      titulo:'pré-análises que viraram Venda ÷ elegíveis, onde elegível = decisão vigente APROVADO E participante TITULAR — exatamente a regra de a1_pa_pode_criar_comercial. '
           + `Safra criada no período (${per}).` }));
  }

  const f = c.funil;
  const etapas = [
    { nome:'Pré-análise criada', n:f.criadas, titulo:'a1_pre_analises.criado_em dentro do período', tempo:'—',
      tempoTitulo:'é a origem da contagem' },
    { nome:'Dossiê sem pendência', n:f.semPendencia,
      titulo:'nenhuma linha em a1_pa_documentos com status PENDENTE_ENVIO ou REPROVADO. Afere só o que virou linha: não há catálogo de obrigatórios, então dossiê vazio entra aqui.',
      tempo:'—', tempoTitulo:'não há carimbo de tempo para "dossiê completo": é o estado atual dos documentos, não um evento' },
    { nome:'Decisão de crédito concluída', n:f.concluidas,
      titulo:'decisão de maior versão com status APROVADO ou REPROVADO',
      tempo: pnDias(f.p50Decisao), tempoTitulo:'mediana de (decidido_em − criado_em da pré-análise)' },
    { nome:'Decisão aprovada e válida', n:f.aprovadas,
      titulo:"status='APROVADO' na maior versão; INVALIDADA não conta",
      tempo:'—', tempoTitulo:'mesma marca de tempo da etapa anterior (decidido_em)' },
    { nome:'Elegível à Venda', n:f.elegiveis,
      titulo:'aprovada e com participante de papel TITULAR (regra de a1_pa_pode_criar_comercial)',
      tempo:'—', tempoTitulo:'elegibilidade é uma regra sobre o estado atual, não um evento com data' }
  ];
  if (d.temCo) etapas.push({ nome:'Venda criada', n:f.comerciais,
    titulo:'a1_comerciais.pre_analise_id preenchido',
    tempo: pnDias(f.p50Handoff), tempoTitulo:"mediana entre a decisão e o evento 'criado_da_pre_analise' em a1_co_eventos" });

  const pareto = Object.keys(c.paretoTipo).map(k => [k, c.paretoTipo[k]])
    .sort((a, b) => b[1] - a[1]).slice(0, 6);

  // A saúde do dossiê em três medidas, na ordem em que a pessoa age: quanto está
  // completo, quanto tempo a conferência leva, e qual tipo reprova mais.
  const faixasDossie = [
    c.obrigatorios
      ? pnFaixa('dossiê completo', pnPct(c.completude),
          c.completas + ' de ' + c.ativas + ' ativa(s) sem nenhum dos ' + c.obrigatorios
          + ' tipo(s) obrigatório(s) faltando. Entregue segue a regra do banco (a1_pa_docs_faltando): '
          + 'REPROVADO, SUBSTITUIDO e PENDENTE_ENVIO não contam como entregues.')
      : pnFaixa('dossiê completo', '—',
          'Nenhum tipo está marcado como obrigatório em Configurações › Tipos de documento, na aba '
          + 'Pré-análise. Sem exigência cadastrada não há denominador — e imprimir 100% de dossiê '
          + 'completo sobre exigência nenhuma seria número errado com cara de verdade.'),
    pnFaixa('conferência (P50)', c.p50Conf == null ? '—' : pnHoras(c.p50Conf),
      c.conferidos
        ? 'Mediana de (analisado_em − criado_em) por documento, sobre os ' + c.conferidos
          + ' documento(s) conferidos no período. P90: ' + pnHoras(c.p90Conf) + '. '
          + 'É o relógio do analista, e corre em horas: o tempo até a decisão de crédito esconde esta fila.'
        : 'Nenhum documento foi conferido no período — analisado_em em branco.')
  ];

  const fila = c.fila.slice(0, 12);
  const tabela = fila.length ? `<div class="pn-tbl-wrap"><table class="pn-tbl">
    <thead><tr><th>Código</th><th>Empreendimento</th><th>Unidade</th><th>Situação</th><th style="text-align:right">Na situação</th><th style="text-align:right">SLA</th></tr></thead>
    <tbody>${fila.map(l => `<tr onclick="location.href='${pnEsc(rota)}'" title="Abrir a fila de Pré-análise">
      <td class="pn-cod">${pnEsc(l.codigo)}</td>
      <td>${pnEsc(l.empr)}</td>
      <td>${pnEsc(l.unidade || '—')}</td>
      <td><span class="pn-sit" style="background:${pnEsc(l.cor)}">${pnEsc(l.sit)}</span></td>
      <td style="text-align:right" class="pn-${pnEsc(l.nivel)}">${pnEsc(pnHoras(l.decorridas))}</td>
      <td style="text-align:right" class="pn-nd">${pnEsc(l.sla ? l.sla + 'h' : 'sem prazo')}</td>
    </tr>`).join('')}</tbody></table></div>` : '<div class="pn-vazio">Nenhuma pré-análise ativa.</div>';

  alvo.innerHTML = `
    <div class="pn-topo">
      <div class="pn-titulo">Painel de Pré-análise<small>${pnEsc(per)} · dados agregados, sem dado pessoal</small></div>
      ${pnSeletorPeriodo('PRE_ANALISE')}
    </div>
    <div class="kpi-grid" id="pn-kpis-pa" style="grid-template-columns:repeat(4,1fr)">${kpis.join('')}</div>
    ${pnPainelBox('Funil — safra criada no período',
      'Volume por etapa e mediana de dias entre os marcos que têm carimbo de tempo no banco. Onde não há carimbo, o tempo fica em branco em vez de estimado.',
      `<div id="pn-funil-pa">${pnFunil(etapas)}</div>`)}
    ${pnBlocoRankingsPA(d)}
    ${pnPainelBox('Saúde do dossiê',
      'Completude sobre o catálogo de obrigatórios e tempo de conferência. Sem recorte por pessoa: quem trava é o tipo de documento, e nome de cliente não sobe para painel executivo.',
      `<div class="pn-faixas">${faixasDossie.join('')}</div>`
      + (c.reprovaTipo.length ? `<h4 style="margin:1rem 0 .5rem;font-size:.75rem;color:var(--t3);text-transform:uppercase">Tipos que mais reprovam</h4>
        <div class="pn-rank">${c.reprovaTipo.map(o => `<div class="pn-rank-linha" title="${pnEsc(
          o.reprovados + ' reprovado(s) de ' + o.analisados + ' conferido(s) no período. Com denominador a leitura vira decisão: '
          + 'taxa alta num tipo muito exigido aponta orientação ruim ao cliente, não cliente relapso.')}">
          <span class="pn-rank-nome">${pnEsc(o.tipo)}</span>
          <span class="pn-rank-meta"><b>${pnEsc(pnPct(o.taxa))}</b><small>${pnEsc(o.reprovados + ' de ' + o.analisados + ' conferidos')}</small></span>
        </div>`).join('')}</div>`
        : `<div class="pn-vazio" style="margin-top:.75rem">Nenhum tipo teve 5 ou mais documentos conferidos no período — abaixo disso a taxa por tipo é acaso, não padrão.</div>`)
      + (pareto.length ? `<h4 style="margin:1rem 0 .5rem;font-size:.75rem;color:var(--t3);text-transform:uppercase">Fila aberta por tipo</h4>
        <div class="pn-faixas">${pareto.map(([t, n]) =>
          `<div class="pn-faixa" title="${pnEsc(n + ' documento(s) de ' + t + ' pendentes ou reprovados agora. Isto é FILA, não taxa: um tipo aparece no topo por ser o mais exigido.')}"><b>${pnEsc(String(n))}</b><span>${pnEsc(t)}</span></div>`).join('')}</div>` : ''))}
    ${pnPainelBox('Fila por tempo na situação',
      'As 12 mais paradas, do relógio da situação atual. Clique para abrir a fila completa da Pré-análise.', tabela)}
    ${pnNaoCalculavel(['Meta e cobertura de pipeline — não existe cadastro de meta por cliente, empreendimento ou corretor.',
      'Origem e campanha do lead — a1_pre_analises guarda lead_id, mas não tem coluna de origem.',
      'Aprovação e prazo por banco — a decisão de crédito não guarda a instituição da proposta.',
      'Motivo de reprovação agrupado — a1_pa_analises_credito.motivo é texto livre, e agrupar texto digitado gera número errado com cara de verdade.'])}
  `;
}

// Campos que dependem de cadastro que o schema ainda não tem. Aparecem com um
// traço e o motivo escrito: quem procura o número descobre o que falta ligar,
// em vez de achar que o painel esqueceu.
function pnNaoCalculavel(itens){
  return `<div class="panel pn-secao" style="padding:1.15rem">
    <div class="sec-title">Depende de cadastro que ainda não existe</div>
    <div class="pn-faixas">${itens.map(t =>
      `<div class="pn-faixa" title="${pnEsc(t)}"><b>—</b><span>${pnEsc(t.split('—')[0].trim())}</span></div>`).join('')}</div>
  </div>`;
}

// ═════════════════════════════════════════════════════════════════════════════
// COMERCIAL
// ═════════════════════════════════════════════════════════════════════════════
async function a1PainelComercial(alvo){
  pnCSS();
  const lic = await a1HasModule('COMERCIAL');
  if (lic !== true) { pnSemLicenca(alvo, 'Venda', lic === null); return; }

  alvo.innerHTML = pnCarregando('Venda');
  try {
    if (!PN.co) PN.co = await pnCarregarCO();
  } catch {
    alvo.innerHTML = pnAviso('Não foi possível carregar o painel Venda.');
    return;
  }
  pnDesenharCO(alvo);
}

async function pnCarregarCO(){
  const h = { headers: A1.headers() };
  const r = await Promise.all([
    fetch(`${A1.rest('a1_co_situacoes')}?select=id,nome,flag,cor,sla_horas,ordem&order=ordem.asc`, h)
      .then(x => x.json()).catch(() => []),
    // origem_snapshot NÃO vem inteiro: dentro dele moram nome e renda analisada
    // dos participantes, e arrastar isso para uma tela executiva seria vazar
    // dado pessoal por descuido de projeção. Só o ramo {credito} interessa.
    A1.buscarTudo(`${A1.rest('a1_comerciais')}?select=id,codigo,criado_em,situacao_id,situacao_em,proposta,repasse_case_id,empreendimento_id,unidade,pre_analise_id,corretor_id,imobiliaria_id,empresa_id,correspondente_id,analista_id,credito:origem_snapshot->credito&order=criado_em.desc`),
    A1.buscarTudo(`${A1.rest('a1_co_contratos')}?select=comercial_id,versao,status,assinado_em,criado_em`),
    A1.buscarTudo(`${A1.rest('a1_co_eventos')}?select=comercial_id,evento,para_situacao,criado_em`),
    fetch(`${A1.rest('a1_co_transicoes')}?ativo=is.true&select=para_id,acao`, h).then(x => x.json()).catch(() => []),
    fetch(`${A1.rest('a1_developments')}?select=id,name`, h).then(x => x.json()).catch(() => []),
    A1.buscarTudo(`${A1.rest('a1_partners')}?select=id,name,type,extra`)
  ]);
  return {
    situacoes: pnLinhas(r[0]), com: pnLinhas(r[1]), contratos: pnLinhas(r[2]),
    eventos: pnLinhas(r[3]), transicoes: pnLinhas(r[4]), empr: pnLinhas(r[5]), parceiros: pnLinhas(r[6])
  };
}

const PN_CO_TERMINAIS = ['CANCELADO', 'ENCERRADO'];
const PN_CT_GERADO = ['GERADO', 'AGUARDANDO_ASSINATURA', 'ASSINADO'];

// O dinheiro do negócio. proposta é jsonb livre, sem constraint: valor_venda
// pode simplesmente não existir, e aí vale o valor_total do crédito capturado
// no snapshot — a mesma regra que valorDe() usa em comercial.html.
function pnValorCO(co){
  const p = co.proposta || {};
  if (p.valor_venda != null) return Number(p.valor_venda) || 0;
  // credito vem projetado da consulta; o origem_snapshot inteiro é o caminho de
  // trás, para quando a projeção jsonb não estiver disponível — e mesmo aí só
  // se lê o ramo {credito}, nunca os participantes.
  const cred = co.credito || (co.origem_snapshot || {}).credito || {};
  return Number(cred.valor_total) || 0;
}

function pnCalcCO(d){
  const inicio = pnInicio();
  const sitPorId = {}; d.situacoes.forEach(s => { sitPorId[s.id] = s; });
  const emprPorId = {}; d.empr.forEach(e => { emprPorId[e.id] = e.name; });
  const noPeriodo = iso => { const t = pnMs(iso); return t != null && t >= inicio; };
  const flagDe = co => { const s = sitPorId[co.situacao_id]; return s ? (s.flag || null) : null; };

  const ativos = d.com.filter(co => !co.situacao_id || PN_CO_TERMINAIS.indexOf(flagDe(co)) < 0);
  const pipeline = ativos.reduce((s, co) => s + pnValorCO(co), 0);

  // Um contrato por comercial: o de maior versão. As versões antigas são
  // rascunho substituído, e somá-las contaria a mesma venda duas vezes.
  const ctPorCom = {};
  d.contratos.forEach(ct => {
    const a = ctPorCom[ct.comercial_id];
    if (!a || (ct.versao || 0) > (a.versao || 0)) ctPorCom[ct.comercial_id] = ct;
  });
  const comPorId = {}; d.com.forEach(co => { comPorId[co.id] = co; });

  const assinados = Object.keys(ctPorCom).map(k => ctPorCom[k])
    .filter(ct => ct.status === 'ASSINADO' && noPeriodo(ct.assinado_em));
  // a1_co_contratos não tem coluna de valor: o dinheiro mora no comercial.
  const valorAssinado = assinados.reduce((s, ct) => s + pnValorCO(comPorId[ct.comercial_id] || {}), 0);
  const ticket = assinados.length ? valorAssinado / assinados.length : null;

  const ciclo = [];
  assinados.forEach(ct => {
    const co = comPorId[ct.comercial_id];
    const a = pnMs(ct.assinado_em), n = co ? pnMs(co.criado_em) : null;
    if (a != null && n != null) ciclo.push((a - n) / 36e5);
  });

  // Win rate: sem uma situação com flag CANCELADO cadastrada na esteira, o
  // denominador vira o próprio numerador e a taxa dá 100%. Isso não é um
  // resultado, é um cadastro faltando — e o painel diz isso em vez do número.
  const temCancelamento = d.situacoes.some(s => s.flag === 'CANCELADO');
  // Os dois lados no MESMO período de encerramento. O numerador já é filtrado
  // por assinado_em; contar todos os cancelamentos do histórico contra os
  // contratos de um mês derrubava a taxa quanto mais antigo fosse o cliente.
  // O carimbo do cancelamento é situacao_em — é quando o caso entrou na
  // situação cancelada, e o banco não guarda outra data para isso.
  const cancelados = d.com.filter(co =>
    flagDe(co) === 'CANCELADO' && noPeriodo(co.situacao_em || co.criado_em)).length;
  const win = (temCancelamento && (assinados.length + cancelados))
    ? assinados.length / (assinados.length + cancelados) : null;

  // ── Vendas líquidas e distrato ──
  // O win rate acima conta cancelado pela situação ATUAL. Quem cancelou e foi
  // reaberto depois some da conta, e o número sobe sozinho. Para vendas líquidas
  // o carimbo certo é o EVENTO: entrou numa situação cancelada dentro do
  // período, conta — tenha voltado ou não. É assim que a ABRAINC mede, e é a
  // diferença entre "vendemos 40" e "vendemos 40 e perdemos 6".
  const sitCancelada = {};
  d.situacoes.forEach(s2 => { if (s2.flag === 'CANCELADO') sitCancelada[s2.id] = true; });
  const cancelouNoPeriodo = {};
  d.eventos.forEach(e => {
    if (!e.para_situacao || !sitCancelada[e.para_situacao] || !noPeriodo(e.criado_em)) return;
    const t = pnMs(e.criado_em);
    if (!cancelouNoPeriodo[e.comercial_id] || t > cancelouNoPeriodo[e.comercial_id]) cancelouNoPeriodo[e.comercial_id] = t;
  });
  const perdidos = Object.keys(cancelouNoPeriodo).length;
  const liquidas = assinados.length - perdidos;

  // Distrato é outra coisa: é cancelamento DEPOIS do contrato assinado. Hoje os
  // dois moravam no mesmo balaio do win rate, e proposta perdida no meio da
  // esteira pesava igual a negócio desfeito com contrato na mão — que é o que
  // custa dinheiro, prazo de obra e crédito já aprovado.
  const distratos = Object.keys(cancelouNoPeriodo).filter(id => {
    const ct = ctPorCom[id];
    const a = ct && ct.status === 'ASSINADO' ? pnMs(ct.assinado_em) : null;
    return a != null && cancelouNoPeriodo[id] > a;
  }).length;
  const taxaDistrato = assinados.length ? distratos / assinados.length : null;

  // ── Cobertura de responsável ──
  // O KPI que sustenta todos os rankings, e o mais barato de todos. Com 40% dos
  // ativos sem corretor vinculado, o ranking de corretores não está medindo
  // desempenho: está medindo quem preencheu o cadastro.
  const semCorretor = ativos.filter(co => !co.corretor_id).length;
  const semImob     = ativos.filter(co => !co.imobiliaria_id).length;
  const cobertura   = ativos.length ? (ativos.length - semCorretor) / ativos.length : null;

  // ── Tempo por etapa, do HISTÓRICO ──
  // situacao_em diz há quanto tempo o caso está parado ONDE ESTÁ — aponta a
  // fila. Só o par de eventos consecutivos diz quanto tempo cada etapa consome
  // de quem já passou por ela, que é o que aponta o GARGALO. Intervalo aberto
  // (a etapa atual, que ainda não terminou) fica de fora: contá-lo como duração
  // encurtaria toda etapa onde há caso parado agora.
  const porComercial = {};
  d.eventos.forEach(e => {
    if (!e.para_situacao || !e.criado_em) return;
    (porComercial[e.comercial_id] || (porComercial[e.comercial_id] = [])).push(e);
  });
  const duracoes = {};
  Object.keys(porComercial).forEach(id => {
    const lista = porComercial[id].slice().sort((a,b) => pnMs(a.criado_em) - pnMs(b.criado_em));
    for (let i = 0; i < lista.length - 1; i++) {
      const ini = pnMs(lista[i].criado_em), fim = pnMs(lista[i+1].criado_em);
      if (ini == null || fim == null || fim < ini) continue;
      if (!noPeriodo(lista[i+1].criado_em)) continue;   // a etapa TERMINOU no período
      (duracoes[lista[i].para_situacao] || (duracoes[lista[i].para_situacao] = [])).push((fim - ini) / 36e5);
    }
  });
  const tempoEtapa = d.situacoes
    .filter(s2 => (duracoes[s2.id] || []).length)
    .map(s2 => ({ nome: s2.nome, cor: s2.cor || '#64748b', n: duracoes[s2.id].length,
                  p50: pnPercentil(duracoes[s2.id], 0.5), p90: pnPercentil(duracoes[s2.id], 0.9) }))
    .sort((a,b) => b.p50 - a.p50);

  // Aging: situacao_em é escrito pelo gatilho a1_co_guarda_update e o navegador
  // não consegue alterá-lo, então este relógio é confiável.
  const aging = [], faixas = [0, 0, 0, 0, 0];
  let estourados = 0, semPrazo = 0;
  const fila = [];
  ativos.forEach(co => {
    const s = sitPorId[co.situacao_id];
    const desde = pnMs(co.situacao_em) || pnMs(co.criado_em);
    const horas = desde ? (Date.now() - desde) / 36e5 : 0;
    const dias = horas / 24;
    aging.push(horas);
    faixas[dias <= 7 ? 0 : dias <= 15 ? 1 : dias <= 30 ? 2 : dias <= 60 ? 3 : 4]++;
    let nivel = 'nd';
    if (s && s.sla_horas > 0) {
      if (horas > s.sla_horas) { estourados++; nivel = 'ex'; }
      else nivel = horas >= s.sla_horas * 0.75 ? 'at' : 'ok';
    } else { semPrazo++; }
    fila.push({ id: co.id, codigo: co.codigo || '—', empr: emprPorId[co.empreendimento_id] || '—',
      unidade: co.unidade || '', sit: s ? s.nome : 'sem situação', cor: (s && s.cor) || '#64748b',
      horas, nivel, valor: pnValorCO(co) });
  });
  const comPrazo = ativos.length - semPrazo;

  // Conversão para Repasse: o denominador vem do HISTÓRICO, não da situação
  // atual. Quem já passou pela etapa de CREATE_REPASS e seguiu adiante continua
  // contando — é justamente esse caso que revela o repasse que não nasceu.
  const destinos = {};
  d.transicoes.forEach(t => { if (t.acao === 'CREATE_REPASS') destinos[t.para_id] = true; });
  const passaram = {};
  d.eventos.forEach(e => { if (e.para_situacao && destinos[e.para_situacao]) passaram[e.comercial_id] = true; });
  const baseRepasse = Object.keys(passaram).length;
  // Numerador dentro do denominador, pelo mesmo motivo da conversão da
  // Pré-análise: há comercial com repasse_case_id preenchido sem evento de
  // passagem (vínculo feito na mão, ou carga migrada), e contá-lo aqui fazia a
  // taxa passar de 100%. Quantos são fica no rodapé do cartão, para o gestor
  // saber que existem em vez de o número simplesmente não fechar.
  const viraramRepasse = d.com.filter(co => co.repasse_case_id && passaram[co.id]).length;
  const repasseForaDaBase = d.com.filter(co => co.repasse_case_id && !passaram[co.id]).length;

  const nascimentoRepasse = {};
  d.eventos.forEach(e => { if (e.evento === 'repasse_criado') nascimentoRepasse[e.comercial_id] = e.criado_em; });

  // ── Funil ──
  const safra = PN.dias ? d.com.filter(co => noPeriodo(co.criado_em)) : d.com;
  const comProposta = safra.filter(co => (co.proposta || {}).valor_venda != null);
  const comContrato = safra.filter(co => ctPorCom[co.id] && PN_CT_GERADO.indexOf(ctPorCom[co.id].status) >= 0);
  const comAssinado = safra.filter(co => ctPorCom[co.id] && ctPorCom[co.id].status === 'ASSINADO');
  const comRepasse  = safra.filter(co => co.repasse_case_id);

  const dtContrato = [], dtAssinatura = [], dtRepasse = [];
  comContrato.forEach(co => {
    const a = pnMs(ctPorCom[co.id].criado_em), n = pnMs(co.criado_em);
    if (a != null && n != null) dtContrato.push((a - n) / 36e5);
  });
  comAssinado.forEach(co => {
    const a = pnMs(ctPorCom[co.id].assinado_em), g = pnMs(ctPorCom[co.id].criado_em);
    if (a != null && g != null) dtAssinatura.push((a - g) / 36e5);
  });
  comRepasse.forEach(co => {
    const r = pnMs(nascimentoRepasse[co.id]);
    const a = ctPorCom[co.id] ? pnMs(ctPorCom[co.id].assinado_em) : null;
    if (r != null && a != null) dtRepasse.push((r - a) / 36e5);
  });

  return {
    ativos: ativos.length, pipeline,
    assinados: assinados.length, valorAssinado, ticket,
    p50Ciclo: pnPercentil(ciclo, 0.5), p90Ciclo: pnPercentil(ciclo, 0.9),
    win, temCancelamento, cancelados,
    liquidas, perdidos, distratos, taxaDistrato,
    cobertura, semCorretor, semImob, tempoEtapa,
    p50Aging: pnPercentil(aging, 0.5), p90Aging: pnPercentil(aging, 0.9),
    estourados, comPrazo, semPrazo, faixas,
    convRepasse: baseRepasse ? viraramRepasse / baseRepasse : null,
    baseRepasse, viraramRepasse, repasseForaDaBase,
    funil: {
      criados: safra.length, proposta: comProposta.length, contrato: comContrato.length,
      assinado: comAssinado.length, repasse: comRepasse.length,
      p50Contrato: pnPercentil(dtContrato, 0.5), p50Assinatura: pnPercentil(dtAssinatura, 0.5),
      p50Repasse: pnPercentil(dtRepasse, 0.5)
    },
    fila: fila.sort((a, b) => b.horas - a.horas)
  };
}

function pnDesenharCO(alvo){
  const d = PN.co, c = pnCalcCO(d), per = pnRotuloPeriodo();
  const rota = pnRota('comercial');

  const kpis = [
    pnKpi({ rotulo:'Comerciais ativos', valor: c.ativos, cor:'kpi-blue', sub:'estoque de agora',
      titulo:'situação atual com flag fora de CANCELADO e ENCERRADO; sem situação conta como ativo. '
           + 'CONTRATO_ASSINADO continua ativo: o negócio só termina quando o Repasse nasce, e é esse intervalo que revela handoff perdido.' }),

    pnKpi({ rotulo: pnPodeVerConsolidado() ? 'Pipeline bruto' : 'Negócios em aberto',
      valor: pnPodeVerConsolidado() ? pnBRL(c.pipeline) : c.ativos,
      cor:'kpi-violet',
      sub: pnPodeVerConsolidado() ? 'soma dos ativos, não é previsão' : 'sem valores consolidados',
      titulo: pnPodeVerConsolidado()
        ? 'Σ de proposta.valor_venda dos comerciais ativos, com o valor_total do crédito capturado no snapshot como reserva. '
          + 'É soma de valores abertos, NÃO previsão: não há probabilidade por etapa no cadastro da esteira. Valores em centavos, formatados em reais.'
        : PN_SEM_CONSOLIDADO + ' Aqui isso significa a quantidade de negócios ativos no lugar da soma deles em reais.' }),

    pnKpi({ rotulo:'Contratos assinados', valor: c.assinados, cor:'kpi-green',
      sub: pnPodeVerConsolidado() ? pnBRL(c.valorAssinado) : 'quantidade, sem valor consolidado',
      titulo: `contratos com status ASSINADO e assinado_em no período (${per}), um por comercial (a maior versão). `
            + 'O valor vem do comercial: a1_co_contratos não tem coluna de valor. Marcar ASSINADO já exige gestor, gerente ou permissão de análise de crédito.' }),

    // Ticket médio É dinheiro: não existe versão dele em quantidade. Sem o corte
    // de agregado o cartão sai da grade, em vez de virar um traço mudo ocupando
    // espaço — e o motivo fica no cartão de pipeline, que continua na tela.
    ...(pnPodeVerConsolidado() ? [pnKpi({ rotulo:'Ticket médio', valor: c.ticket == null ? '—' : pnBRL(c.ticket), cor:'kpi-green',
      sub: c.assinados ? 'n = ' + c.assinados : 'sem contrato assinado no período',
      titulo:'valor somado dos contratos assinados ÷ nº de contratos assinados no período. '
           + 'O n vai junto de propósito: com poucos contratos no mês, o ticket balança demais para virar sinal de gestão.' })] : []),

    pnKpi({ rotulo:'Vendas líquidas', valor: c.liquidas, cor:'kpi-green',
      sub: c.perdidos ? c.perdidos + ' perdida(s) no período' : 'nenhuma perda no período',
      titulo:'contratos assinados no período − negócios que ENTRARAM numa situação com flag CANCELADO no período. '
           + 'É o número da ABRAINC, e não o de vendas brutas: venda bruta sozinha mente para cima. '
           + 'O carimbo da perda é o EVENTO de entrada na situação, não a situação atual — quem cancelou e foi reaberto depois continua contando, '
           + 'senão o número sobe sozinho quando alguém corrige um cartão. Pode ficar negativo: mês em que se perde mais do que se assina existe, e esconder isso seria o próprio problema.' }),

    pnKpi({ rotulo:'Cobertura de responsável', valor: pnPct(c.cobertura), cor:'kpi-blue',
      sub: c.semCorretor ? c.semCorretor + ' ativo(s) sem corretor' : 'todos os ativos vinculados',
      titulo:'ativos COM corretor_id ÷ ativos. É o KPI que sustenta todos os rankings: com parte dos negócios sem vínculo, '
           + 'o quadro de corretores deixa de medir desempenho e passa a medir quem preencheu o cadastro. '
           + (c.semImob ? c.semImob + ' ativo(s) também estão sem imobiliária.' : 'Todos os ativos têm imobiliária vinculada.') }),

    pnKpi({ rotulo:'Ciclo comercial', valor: pnDias(c.p50Ciclo), cor:'kpi-amber',
      sub: c.p90Ciclo == null ? 'sem contrato assinado no período' : 'P90 ' + pnDias(c.p90Ciclo),
      titulo:'P50 e P90 de (assinado_em − criado_em do comercial), em dias, sobre os contratos assinados no período. '
           + 'A média não é publicada: é ela que esconde a fila de casos parados. Percentil calculado no navegador.' }),

    pnKpi({ rotulo:'Win rate', valor: c.temCancelamento ? pnPct(c.win) : '—', cor:'kpi-green',
      sub: c.temCancelamento ? (c.assinados + c.cancelados) + ' encerrados' : 'esteira sem situação de cancelamento',
      titulo: c.temCancelamento
        ? 'assinados ÷ (assinados + cancelados). Cancelado = situação atual com flag CANCELADO.'
        : 'Esta esteira não tem nenhuma situação com flag CANCELADO cadastrada. Sem ela o denominador vira o próprio numerador e a taxa daria 100% — um número bonito e falso. Cadastre a situação de cancelamento em Configurações.' }),

    pnKpi({ rotulo:'Aging do pipeline', valor: pnDias(c.p50Aging), cor:'kpi-amber',
      sub: `P90 ${pnDias(c.p90Aging)} · ${c.estourados} com SLA estourado`,
      titulo:'P50 e P90 de (agora − situacao_em) sobre os ativos. situacao_em é escrito por gatilho no banco, o navegador não altera. '
           + `${c.semPrazo} ativo(s) em situação sem sla_horas ficam fora da fatia de estourado.` }),

    pnKpi({ rotulo:'Conversão → Repasse', valor: pnPct(c.convRepasse), cor:'kpi-violet',
      sub: c.baseRepasse ? `${c.viraramRepasse} de ${c.baseRepasse}` : 'nenhum passou pela etapa de criar repasse',
      titulo:'comerciais com repasse_case_id ÷ comerciais que já passaram por uma situação de destino de transição com ação CREATE_REPASS. '
           + 'O denominador vem do histórico de eventos, não da situação atual: quem avançou depois continua contando, e é esse caso que revela o repasse que não nasceu. '
           + (c.repasseForaDaBase
              ? c.repasseForaDaBase + ' comercial(is) têm repasse vinculado sem evento de passagem pela etapa (vínculo manual ou carga migrada) e ficam fora dos dois lados.'
              : '') })
  ];

  const f = c.funil;
  const etapas = [
    { nome:'Venda criada', n:f.criados, titulo:'a1_comerciais.criado_em dentro do período', tempo:'—', tempoTitulo:'é a origem da contagem' },
    { nome:'Proposta preenchida', n:f.proposta, titulo:'proposta contém valor_venda',
      tempo:'—', tempoTitulo:'proposta é jsonb sem carimbo de tempo: não há quando foi preenchida' },
    { nome:'Contrato gerado', n:f.contrato, titulo:'contrato em GERADO, AGUARDANDO_ASSINATURA ou ASSINADO',
      tempo: pnDias(f.p50Contrato), tempoTitulo:'mediana de (criado_em do contrato − criado_em do comercial)' },
    { nome:'Contrato assinado', n:f.assinado, titulo:"contrato com status ASSINADO",
      tempo: pnDias(f.p50Assinatura), tempoTitulo:'mediana de (assinado_em − criado_em do contrato)' },
    { nome:'Repasse criado', n:f.repasse, titulo:'a1_comerciais.repasse_case_id preenchido',
      tempo: pnDias(f.p50Repasse), tempoTitulo:"mediana entre a assinatura e o evento 'repasse_criado' em a1_co_eventos" }
  ];

  // Distrato separado da proposta perdida: são perdas de custo muito diferente,
  // e somá-las num win rate só apagava a distinção.
  const faixasPerda = [
    pnFaixa('perdidas no período', c.perdidos,
      'Negócios que entraram numa situação com flag CANCELADO dentro do período, pelo evento de entrada. Inclui proposta perdida e distrato.'),
    pnFaixa('distratos', c.distratos,
      'Subconjunto das perdidas: cancelamento que ocorreu DEPOIS do contrato assinado. É o que custa crédito já aprovado, prazo de obra e unidade de volta ao estoque.'),
    pnFaixa('taxa de distrato', pnPct(c.taxaDistrato),
      c.assinados ? 'distratos ÷ contratos assinados no período (n = ' + c.assinados + '). É como a ABRAINC calcula.'
                  : 'Sem contrato assinado no período não há denominador.')
  ];

  const rotFaixas = ['0–7 dias', '8–15 dias', '16–30 dias', '31–60 dias', '> 60 dias'];
  const fila = c.fila.slice(0, 12);
  // A fila respeita o RLS: cada linha aqui é processo que a pessoa já pode
  // abrir. O que não respeitava nada era a coluna Valor — ela punha o preço de
  // cada negócio na frente de quem não tem o corte de agregado. A coluna sai
  // inteira: esconder a soma e deixar as parcelas é esconder mal.
  const comValor = pnPodeVerConsolidado();
  const tabela = fila.length ? `<div class="pn-tbl-wrap"><table class="pn-tbl">
    <thead><tr><th>Código</th><th>Empreendimento</th><th>Unidade</th><th>Situação</th>${
      comValor ? '<th style="text-align:right">Valor</th>' : ''}<th style="text-align:right">Na situação</th></tr></thead>
    <tbody>${fila.map(l => `<tr onclick="location.href='${pnEsc(rota)}'" title="Abrir a fila da Venda">
      <td class="pn-cod">${pnEsc(l.codigo)}</td>
      <td>${pnEsc(l.empr)}</td>
      <td>${pnEsc(l.unidade || '—')}</td>
      <td><span class="pn-sit" style="background:${pnEsc(l.cor)}">${pnEsc(l.sit)}</span></td>
      ${comValor ? `<td style="text-align:right">${pnEsc(pnBRL(l.valor))}</td>` : ''}
      <td style="text-align:right" class="pn-${pnEsc(l.nivel)}">${pnEsc(pnHoras(l.horas))}</td>
    </tr>`).join('')}</tbody></table></div>` : '<div class="pn-vazio">Nenhum comercial ativo.</div>';

  alvo.innerHTML = `
    <div class="pn-topo">
      <div class="pn-titulo">Painel Venda<small>${pnEsc(per)} · dados agregados, sem dado pessoal</small></div>
      ${pnSeletorPeriodo('COMERCIAL')}
    </div>
    ${c.temCancelamento ? '' : pnAviso('A esteira da Venda não tem situação com flag CANCELADO. Sem ela não há como medir win rate — o denominador ficaria igual ao numerador.')}
    <div class="kpi-grid" id="pn-kpis-co" style="grid-template-columns:repeat(4,1fr)">${kpis.join('')}</div>
    ${pnPainelBox('Funil — safra criada no período',
      'Volume por etapa e mediana de dias entre os marcos com carimbo de tempo. Proposta preenchida não tem data no schema, por isso fica sem tempo.',
      `<div id="pn-funil-co">${pnFunil(etapas)}</div>`)}
    ${pnPainelBox('Aging do pipeline por faixa',
      'Tempo na situação atual dos comerciais ativos. Faixa cheia à direita é fila parada, não volume de trabalho.',
      `<div class="pn-faixas">${c.faixas.map((n, i) =>
        `<div class="pn-faixa" title="${pnEsc(n + ' comercial(is) ativos há ' + rotFaixas[i] + ' na situação atual')}"><b>${pnEsc(String(n))}</b><span>${pnEsc(rotFaixas[i])}</span></div>`).join('')}</div>`)}
    ${pnPainelBox('Perdas do período',
      'Proposta perdida e distrato têm custos diferentes e por isso aparecem separados. O carimbo é o evento de entrada na situação cancelada, não a situação atual.',
      `<div class="pn-faixas">${faixasPerda.join('')}</div>`)}
    ${c.tempoEtapa.length ? pnPainelBox('Onde o tempo se perde',
      'Mediana de permanência em cada etapa, sobre quem JÁ SAIU dela no período. A fila por tempo na situação, mais abaixo, mostra onde os casos estão parados agora — esta tabela mostra qual etapa consome o prazo de quem passa.',
      `<div class="pn-rank">${c.tempoEtapa.map(e => `<div class="pn-rank-linha" title="${pnEsc(
        e.n + ' passagem(ns) concluída(s) por esta etapa no período. P90: ' + pnHoras(e.p90) + '. '
        + 'Só intervalos FECHADOS entram: a etapa em que um caso ainda está agora não tem duração, e contá-la encurtaria a mediana de toda etapa com fila.')}">
        <span class="pn-rank-nome"><span class="pn-sit" style="background:${pnEsc(e.cor)}">${pnEsc(e.nome)}</span></span>
        <span class="pn-rank-meta"><b>${pnEsc(pnDias(e.p50))}</b><small>${pnEsc(e.n + ' passagem(ns)')}</small></span>
      </div>`).join('')}</div>`) : ''}
    ${pnBlocoRankingsCO(d)}
    ${pnPainelBox('Fila por tempo na situação',
      'Os 12 mais parados. Clique para abrir a fila completa da Venda.', tabela)}
    ${pnNaoCalculavel(['Meta, cobertura e forecast — não existe cadastro de meta por cliente, empreendimento ou corretor.',
      'Pipeline ponderado — a1_co_situacoes não tem probabilidade por etapa.',
      'Motivo de perda — não há campo de motivo em a1_comerciais nem catálogo de motivos.',
      'VSO e estoque em meses — a1_developments guarda as unidades como texto de identificação, sem preço nem reserva, então a absorção sairia estimada.'])}
  `;
}
