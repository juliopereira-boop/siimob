// ─── Painéis executivos de Pré-análise e Comercial ───────────────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// O Dashboard sempre foi o do Repasse. Quando o cliente passa a ter mais de um
// módulo, ele precisa escolher qual painel está olhando — e cada painel tem
// perguntas próprias. Deixar isso dentro de repasse.html seria empurrar mais
// 40 KB para um arquivo de 330 KB que um cliente usa agora; aqui fica separado,
// e as três telas do Repasse só o incluem para o menu não divergir.
//
// O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO
// Não existe meta, probabilidade por etapa, motivo estruturado de perda nem
// registro de atividade no schema de hoje. Então não há previsão, cobertura,
// pipeline ponderado nem Pareto de motivo. Onde o número não existe, o painel
// mostra um traço e diz o que falta cadastrar — um KPI inventado só é descoberto
// depois de alguém tomar decisão com ele.
//
// PRIVACIDADE
// CPF, documento, nome de pessoa e renda individual NÃO entram em painel
// executivo. As consultas daqui pedem só as colunas agregáveis: nenhuma pede
// pessoa_id, renda_declarada, renda_familiar ou motivo. Do origem_snapshot do
// Comercial lê-se só o ramo {credito} — o jsonb inteiro carrega nome e renda
// analisada dos participantes dentro dele.
//
// Depende de: config.js (A1), auth.js (a1HasModule) e das telas que o incluem.

// ─── Estado ──────────────────────────────────────────────────────────────────
// Os dados brutos ficam guardados aqui para a troca de período não render outra
// rodada de consultas: o recorte é aritmética sobre linhas que já estão na mão.
const PN = { dias: 90, pa: null, co: null };

const PN_PERIODOS = [[30, '30 dias'], [90, '90 dias'], [180, '180 dias'], [365, '12 meses'], [0, 'Tudo']];

// ─── Utilitários ─────────────────────────────────────────────────────────────
function pnEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  // O Comercial é outro módulo e outra licença: sem ele, a conversão para o
  // Comercial marcaria 0% numa operação que nem tem a etapa.
  const temCo = (await a1HasModule('COMERCIAL')) === true;

  // As situações vêm TODAS, inclusive as desativadas: um processo pode estar
  // parado numa situação que o gestor tirou da esteira ontem, e sem a linha
  // dela a flag não resolve e o processo entraria como ativo por engano.
  const pedidos = [
    fetch(`${A1.rest('a1_pa_situacoes')}?select=id,nome,flag,cor,sla_horas,ordem&order=ordem.asc`, h)
      .then(r => r.json()).catch(() => []),
    A1.buscarTudo(`${A1.rest('a1_pre_analises')}?select=id,codigo,unidade,criado_em,situacao_id,situacao_em,vence_em,empreendimento_id&order=criado_em.desc`),
    A1.buscarTudo(`${A1.rest('a1_pa_analises_credito')}?select=pre_analise_id,versao,status,criado_em,decidido_em`),
    A1.buscarTudo(`${A1.rest('a1_pa_documentos')}?select=pre_analise_id,tipo,status,versao`),
    // Só o vínculo: pessoa_id e renda ficam de fora porque isto é tela executiva.
    A1.buscarTudo(`${A1.rest('a1_pa_participantes')}?papel=eq.TITULAR&select=pre_analise_id`),
    fetch(`${A1.rest('a1_developments')}?select=id,name`, h).then(r => r.json()).catch(() => [])
  ];
  if (temCo) {
    pedidos.push(A1.buscarTudo(`${A1.rest('a1_comerciais')}?select=id,pre_analise_id,criado_em`));
    pedidos.push(A1.buscarTudo(`${A1.rest('a1_co_eventos')}?select=comercial_id,evento,criado_em`));
  }
  const r = await Promise.all(pedidos);
  return {
    temCo,
    situacoes: pnLinhas(r[0]),
    pre:       pnLinhas(r[1]),
    credito:   pnLinhas(r[2]),
    docs:      pnLinhas(r[3]),
    titulares: pnLinhas(r[4]),
    empr:      pnLinhas(r[5]),
    com:       temCo ? pnLinhas(r[6]) : [],
    coEventos: temCo ? pnLinhas(r[7]) : []
  };
}

// Flags que encerram a pré-análise. APROVADO fica FORA desta lista de propósito:
// a aprovada que ainda não virou Comercial é justamente o caso que precisa
// aparecer, e ela some da fila se for tratada como terminal.
const PN_PA_TERMINAIS = ['REPROVADO', 'CANCELADO', 'ENCERRADO'];

function pnCalcPA(d){
  const inicio = pnInicio();
  const sitPorId = {};
  d.situacoes.forEach(s => { sitPorId[s.id] = s; });
  const emprPorId = {};
  d.empr.forEach(e => { emprPorId[e.id] = e.name; });

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
    const o = doc[x.pre_analise_id] || (doc[x.pre_analise_id] = { total:0, pendente:0, reenvio:0, enviados:0 });
    o.total++;
    if (x.status === 'PENDENTE_ENVIO' || x.status === 'REPROVADO') o.pendente++;
    if ((x.versao || 1) > 1 || x.status === 'SUBSTITUIDO') o.reenvio++;
    if (x.status !== 'PENDENTE_ENVIO') o.enviados++;
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
    const pa = d.pre.find(p => p.id === k);
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

  // ── Funil, sobre a safra criada no período ──
  const safra = PN.dias ? entradas : d.pre;
  const semPendencia = safra.filter(p => !doc[p.id] || doc[p.id].pendente === 0);
  const concluidas = safra.filter(p => {
    const c = vigente[p.id]; return c && (c.status === 'APROVADO' || c.status === 'REPROVADO');
  });
  const aprovadas = safra.filter(p => { const c = vigente[p.id]; return c && c.status === 'APROVADO'; });
  const elegiveis = aprovadas.filter(p => temTitular[p.id]);
  const viraramCom = safra.filter(p => comPorPa[p.id]);

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
    vencidos, emRisco, comPrazo, semPrazo,
    p50Dec: pnPercentil(tDecisao, 0.5), p90Dec: pnPercentil(tDecisao, 0.9),
    p50Tot: pnPercentil(tTotal, 0.5),
    pendencia: comDoc.length ? comPendencia / ativas.length : (ativas.length ? comPendencia / ativas.length : null),
    comPendencia, semDossie: ativas.length - comDoc.length,
    reenvio: baseReenvio.length ? comReenvio / baseReenvio.length : null,
    baseReenvio: baseReenvio.length,
    conversao: elegiveis.length ? viraramCom.length / elegiveis.length : null,
    elegiveis: elegiveis.length,
    paretoTipo,
    funil: {
      criadas: safra.length, semPendencia: semPendencia.length, concluidas: concluidas.length,
      aprovadas: aprovadas.length, elegiveis: elegiveis.length, comerciais: viraramCom.length,
      p50Decisao: pnPercentil(dtDecisao, 0.5), p50Handoff: pnPercentil(dtHandoff, 0.5)
    },
    fila: fila.sort((a, b) => b.decorridas - a.decorridas)
  };
}

function pnDesenharPA(alvo){
  const d = PN.pa, c = pnCalcPA(d), per = pnRotuloPeriodo();
  const slug = A1.slug || '';

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
           + 'APROVADO fica DENTRO: é o caso aprovado e ainda sem Comercial que precisa aparecer. '
           + 'É estoque do momento, não do período — o schema não guarda histórico de estoque para comparar com o período anterior.' }),

    pnKpi({ rotulo:'Taxa de aprovação', valor: pnPct(c.taxaAprov), cor:'kpi-green',
      sub: c.decididas ? c.decididas + ' decisões' : 'sem decisão com data no período',
      titulo: `aprovadas ÷ (aprovadas + reprovadas), uma decisão por pré-análise (a de maior versão), período por decidido_em (${per}). `
            + 'EM_ANALISE, PENDENTE e INVALIDADA ficam fora dos dois lados: INVALIDADA é aprovação derrubada por mudança de renda, participante ou valor — contá-la como reprovação inventaria uma recusa que nunca houve.' }),

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
    kpis.push(pnKpi({ rotulo:'Conversão → Comercial', valor: pnPct(c.conversao), cor:'kpi-green',
      sub: c.elegiveis ? c.elegiveis + ' elegíveis' : 'nenhuma elegível no período',
      titulo:'pré-análises que viraram Comercial ÷ elegíveis, onde elegível = decisão vigente APROVADO E participante TITULAR — exatamente a regra de a1_pa_pode_criar_comercial. '
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
    { nome:'Elegível ao Comercial', n:f.elegiveis,
      titulo:'aprovada e com participante de papel TITULAR (regra de a1_pa_pode_criar_comercial)',
      tempo:'—', tempoTitulo:'elegibilidade é uma regra sobre o estado atual, não um evento com data' }
  ];
  if (d.temCo) etapas.push({ nome:'Comercial criado', n:f.comerciais,
    titulo:'a1_comerciais.pre_analise_id preenchido',
    tempo: pnDias(f.p50Handoff), tempoTitulo:"mediana entre a decisão e o evento 'criado_da_pre_analise' em a1_co_eventos" });

  const pareto = Object.keys(c.paretoTipo).map(k => [k, c.paretoTipo[k]])
    .sort((a, b) => b[1] - a[1]).slice(0, 6);

  const fila = c.fila.slice(0, 12);
  const tabela = fila.length ? `<div class="pn-tbl-wrap"><table class="pn-tbl">
    <thead><tr><th>Código</th><th>Empreendimento</th><th>Unidade</th><th>Situação</th><th style="text-align:right">Na situação</th><th style="text-align:right">SLA</th></tr></thead>
    <tbody>${fila.map(l => `<tr onclick="location.href='/${pnEsc(slug)}/pre-analise'" title="Abrir a fila de Pré-análise">
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
    ${pareto.length ? pnPainelBox('O que trava o dossiê',
      'Documentos em PENDENTE_ENVIO ou REPROVADO, por tipo. Sem recorte por pessoa: quem trava é o tipo de documento, e nome de cliente não sobe para painel executivo.',
      `<div class="pn-faixas">${pareto.map(([t, n]) =>
        `<div class="pn-faixa" title="${pnEsc(n + ' documento(s) de ' + t + ' pendentes ou reprovados')}"><b>${pnEsc(String(n))}</b><span>${pnEsc(t)}</span></div>`).join('')}</div>`) : ''}
    ${pnPainelBox('Fila por tempo na situação',
      'As 12 mais paradas, do relógio da situação atual. Clique para abrir a fila completa da Pré-análise.', tabela)}
    ${pnNaoCalculavel(['Meta e cobertura de pipeline — não existe cadastro de meta por cliente, empreendimento ou corretor.',
      'Origem e campanha do lead — a1_pre_analises guarda lead_id, mas não tem coluna de origem.',
      'Completude no primeiro envio — não há catálogo de documento obrigatório para servir de denominador.'])}
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
  if (lic !== true) { pnSemLicenca(alvo, 'Comercial', lic === null); return; }

  alvo.innerHTML = pnCarregando('Comercial');
  try {
    if (!PN.co) PN.co = await pnCarregarCO();
  } catch {
    alvo.innerHTML = pnAviso('Não foi possível carregar o painel Comercial.');
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
    A1.buscarTudo(`${A1.rest('a1_comerciais')}?select=id,codigo,criado_em,situacao_id,situacao_em,proposta,repasse_case_id,empreendimento_id,unidade,pre_analise_id,credito:origem_snapshot->credito&order=criado_em.desc`),
    A1.buscarTudo(`${A1.rest('a1_co_contratos')}?select=comercial_id,versao,status,assinado_em,criado_em`),
    A1.buscarTudo(`${A1.rest('a1_co_eventos')}?select=comercial_id,evento,para_situacao,criado_em`),
    fetch(`${A1.rest('a1_co_transicoes')}?ativo=is.true&select=para_id,acao`, h).then(x => x.json()).catch(() => []),
    fetch(`${A1.rest('a1_developments')}?select=id,name`, h).then(x => x.json()).catch(() => [])
  ]);
  return {
    situacoes: pnLinhas(r[0]), com: pnLinhas(r[1]), contratos: pnLinhas(r[2]),
    eventos: pnLinhas(r[3]), transicoes: pnLinhas(r[4]), empr: pnLinhas(r[5])
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
  const cancelados = d.com.filter(co => flagDe(co) === 'CANCELADO').length;
  const win = (temCancelamento && (assinados.length + cancelados))
    ? assinados.length / (assinados.length + cancelados) : null;

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
  const viraramRepasse = d.com.filter(co => co.repasse_case_id).length;

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
    p50Aging: pnPercentil(aging, 0.5), p90Aging: pnPercentil(aging, 0.9),
    estourados, comPrazo, semPrazo, faixas,
    convRepasse: baseRepasse ? viraramRepasse / baseRepasse : null,
    baseRepasse, viraramRepasse,
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
  const slug = A1.slug || '';

  const kpis = [
    pnKpi({ rotulo:'Comerciais ativos', valor: c.ativos, cor:'kpi-blue', sub:'estoque de agora',
      titulo:'situação atual com flag fora de CANCELADO e ENCERRADO; sem situação conta como ativo. '
           + 'CONTRATO_ASSINADO continua ativo: o negócio só termina quando o Repasse nasce, e é esse intervalo que revela handoff perdido.' }),

    pnKpi({ rotulo:'Pipeline bruto', valor: pnBRL(c.pipeline), cor:'kpi-violet', sub:'soma dos ativos, não é previsão',
      titulo:'Σ de proposta.valor_venda dos comerciais ativos, com o valor_total do crédito capturado no snapshot como reserva. '
           + 'É soma de valores abertos, NÃO previsão: não há probabilidade por etapa no cadastro da esteira. Valores em centavos, formatados em reais.' }),

    pnKpi({ rotulo:'Contratos assinados', valor: c.assinados, cor:'kpi-green', sub: pnBRL(c.valorAssinado),
      titulo: `contratos com status ASSINADO e assinado_em no período (${per}), um por comercial (a maior versão). `
            + 'O valor vem do comercial: a1_co_contratos não tem coluna de valor. Marcar ASSINADO já exige gestor, gerente ou permissão de análise de crédito.' }),

    pnKpi({ rotulo:'Ticket médio', valor: c.ticket == null ? '—' : pnBRL(c.ticket), cor:'kpi-green',
      sub: c.assinados ? 'n = ' + c.assinados : 'sem contrato assinado no período',
      titulo:'valor somado dos contratos assinados ÷ nº de contratos assinados no período. '
           + 'O n vai junto de propósito: com poucos contratos no mês, o ticket balança demais para virar sinal de gestão.' }),

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
           + 'O denominador vem do histórico de eventos, não da situação atual: quem avançou depois continua contando, e é esse caso que revela o repasse que não nasceu.' })
  ];

  const f = c.funil;
  const etapas = [
    { nome:'Comercial criado', n:f.criados, titulo:'a1_comerciais.criado_em dentro do período', tempo:'—', tempoTitulo:'é a origem da contagem' },
    { nome:'Proposta preenchida', n:f.proposta, titulo:'proposta contém valor_venda',
      tempo:'—', tempoTitulo:'proposta é jsonb sem carimbo de tempo: não há quando foi preenchida' },
    { nome:'Contrato gerado', n:f.contrato, titulo:'contrato em GERADO, AGUARDANDO_ASSINATURA ou ASSINADO',
      tempo: pnDias(f.p50Contrato), tempoTitulo:'mediana de (criado_em do contrato − criado_em do comercial)' },
    { nome:'Contrato assinado', n:f.assinado, titulo:"contrato com status ASSINADO",
      tempo: pnDias(f.p50Assinatura), tempoTitulo:'mediana de (assinado_em − criado_em do contrato)' },
    { nome:'Repasse criado', n:f.repasse, titulo:'a1_comerciais.repasse_case_id preenchido',
      tempo: pnDias(f.p50Repasse), tempoTitulo:"mediana entre a assinatura e o evento 'repasse_criado' em a1_co_eventos" }
  ];

  const rotFaixas = ['0–7 dias', '8–15 dias', '16–30 dias', '31–60 dias', '> 60 dias'];
  const fila = c.fila.slice(0, 12);
  const tabela = fila.length ? `<div class="pn-tbl-wrap"><table class="pn-tbl">
    <thead><tr><th>Código</th><th>Empreendimento</th><th>Unidade</th><th>Situação</th><th style="text-align:right">Valor</th><th style="text-align:right">Na situação</th></tr></thead>
    <tbody>${fila.map(l => `<tr onclick="location.href='/${pnEsc(slug)}/comercial'" title="Abrir a fila do Comercial">
      <td class="pn-cod">${pnEsc(l.codigo)}</td>
      <td>${pnEsc(l.empr)}</td>
      <td>${pnEsc(l.unidade || '—')}</td>
      <td><span class="pn-sit" style="background:${pnEsc(l.cor)}">${pnEsc(l.sit)}</span></td>
      <td style="text-align:right">${pnEsc(pnBRL(l.valor))}</td>
      <td style="text-align:right" class="pn-${pnEsc(l.nivel)}">${pnEsc(pnHoras(l.horas))}</td>
    </tr>`).join('')}</tbody></table></div>` : '<div class="pn-vazio">Nenhum comercial ativo.</div>';

  alvo.innerHTML = `
    <div class="pn-topo">
      <div class="pn-titulo">Painel Comercial<small>${pnEsc(per)} · dados agregados, sem dado pessoal</small></div>
      ${pnSeletorPeriodo('COMERCIAL')}
    </div>
    ${c.temCancelamento ? '' : pnAviso('A esteira do Comercial não tem situação com flag CANCELADO. Sem ela não há como medir win rate — o denominador ficaria igual ao numerador.')}
    <div class="kpi-grid" id="pn-kpis-co" style="grid-template-columns:repeat(4,1fr)">${kpis.join('')}</div>
    ${pnPainelBox('Funil — safra criada no período',
      'Volume por etapa e mediana de dias entre os marcos com carimbo de tempo. Proposta preenchida não tem data no schema, por isso fica sem tempo.',
      `<div id="pn-funil-co">${pnFunil(etapas)}</div>`)}
    ${pnPainelBox('Aging do pipeline por faixa',
      'Tempo na situação atual dos comerciais ativos. Faixa cheia à direita é fila parada, não volume de trabalho.',
      `<div class="pn-faixas">${c.faixas.map((n, i) =>
        `<div class="pn-faixa" title="${pnEsc(n + ' comercial(is) ativos há ' + rotFaixas[i] + ' na situação atual')}"><b>${pnEsc(String(n))}</b><span>${pnEsc(rotFaixas[i])}</span></div>`).join('')}</div>`)}
    ${pnPainelBox('Fila por tempo na situação',
      'Os 12 mais parados. Clique para abrir a fila completa do Comercial.', tabela)}
    ${pnNaoCalculavel(['Meta, cobertura e forecast — não existe cadastro de meta por cliente, empreendimento ou corretor.',
      'Pipeline ponderado — a1_co_situacoes não tem probabilidade por etapa.',
      'Motivo de perda — não há campo de motivo em a1_comerciais nem catálogo de motivos.',
      'Taxa e tempo de assinatura — o contrato guarda só o status atual, sem carimbo de envio para assinatura.'])}
  `;
}
