// ─── Configurações da Disposição de unidades ─────────────────────────────────
//
// Quatro sub-telas que só existem no DOM com a licença DISPOSICAO (regra do
// dono: sem licença o elemento não nasce): Unidades, Mapa de preço, Parâmetros
// de pagamento e Regras da reserva. Mora fora de configuracoes/main.js porque
// é um módulo inteiro; Configurações só empresta o cartão, a sub-tela e o
// roteador (recebidos em dispMontarConfig, sem global no meio).
import { A1 } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import { acoes } from '../../shared/ui/acoes.js';
import {
  STATUS,
  SERIES,
  QUEM_PAGA,
  PERIODICIDADE,
  PARAMETROS_PADRAO,
  serieDe,
  brl,
  num,
  paraNumero,
  dataBR,
  rotuloPavimento,
  carregar,
  precosVigentes,
  rpc,
  gravar,
  motivo
} from './dados.js';

acoes({
  dcTrocarEmp: el => trocarEmp(el.value, el.dataset.tela),
  dcGerarFichas: () => gerarFichas(),
  dcNovaUnidade: () => editarUnidade(null),
  dcEditarUnidade: el => editarUnidade(el.dataset.id),
  dcSalvarUnidade: () => salvarUnidade(),
  dcExcluirUnidade: () => excluirUnidade(),
  dcLote: () => abrirLote(),
  dcLotePrevia: () => previaLote(),
  dcSalvarLote: () => salvarLote(),
  dcSelecionar: el => selecionar(el.dataset.id, /** @type {HTMLInputElement} */ (el).checked),
  dcSelecionarTodas: el => selecionarTodas(el, /** @type {HTMLInputElement} */ (el).checked),
  dcEditarVarias: () => editarVarias(),
  dcSalvarVarias: () => salvarVarias(),
  dcFecharModal: () => fecharModal(),
  dcFecharModalPeloFundo: (el, ev) => {
    if (ev.target === el) fecharModal();
  },
  dcNovoMapa: () => novoMapa(),
  dcSalvarNovoMapa: () => salvarNovoMapa(),
  dcAbrirMapa: el => abrirMapa(el.dataset.id),
  dcAtivarMapa: el => ativarMapa(el.dataset.id),
  dcReajustar: el => reajustar(el.dataset.id),
  dcSalvarReajuste: () => salvarReajuste(),
  dcExcluirMapa: el => excluirMapa(el.dataset.id),
  dcPrecoM2: () => aplicarPrecoM2(),
  dcPrecoPct: () => aplicarPct(),
  dcPrecoMudou: () => resumoPrecos(),
  dcSalvarPrecos: () => salvarPrecos(),
  dcNovoParametro: () => editarParametro(null),
  dcEditarParametro: el => editarParametro(el.dataset.id),
  dcSerieMudou: () => serieMudou(),
  dcSalvarParametro: () => salvarParametro(),
  dcExcluirParametro: () => excluirParametro(),
  dcParametrosPadrao: () => parametrosPadrao(),
  dcSalvarRegras: () => salvarRegras()
});

/** @type {{emps:any[], empId:string|null, unidades:any[], mapas:any[], itens:any[], parametros:any[],
 *          config:any, sel:Set<string>, editando:any, mapaId:string|null, toast:(m:string,t?:string)=>void,
 *          abrirVista:(v:string)=>void}} */
const DC = {
  emps: [],
  empId: null,
  unidades: [],
  mapas: [],
  itens: [],
  parametros: [],
  config: null,
  sel: new Set(),
  editando: null,
  mapaId: null,
  toast: () => {},
  abrirVista: () => {}
};
const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const natural = (/** @type {any} */ a, /** @type {any} */ b) =>
  String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true });
const ordemUn = (/** @type {any} */ a, /** @type {any} */ b) =>
  natural(a.bloco, b.bloco) ||
  (a.pavimento ?? 0) - (b.pavimento ?? 0) ||
  natural(a.numero, b.numero) ||
  natural(a.codigo, b.codigo);

const ICONE = (/** @type {string} */ d) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0E8C7F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

/**
 * Monta o grupo e os cartões no hub. Chamado por Configurações quando a
 * licença DISPOSICAO responde exatamente true.
 * @param {{cartao:(d:any)=>void, vista:(n:string,t:string,h:string)=>void,
 *          toast:(m:string,t?:string)=>void, abrirVista:(v:string)=>void}} f
 */
export function dispMontarConfig(f) {
  DC.toast = f.toast;
  DC.abrirVista = f.abrirVista;
  const sec = $('cfg-sec-disposicao');
  if (sec) sec.style.display = '';
  const cartoes = [
    [
      'disp-unidades',
      'Unidades',
      '#e6f4f1',
      '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'
    ],
    [
      'disp-precos',
      'Mapa de preço',
      '#fdf3e2',
      '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/>'
    ],
    [
      'disp-parametros',
      'Parâmetros de pagamento',
      '#edf3f9',
      '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'
    ],
    ['disp-regras', 'Regras da reserva', '#f0ecf9', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>']
  ];
  cartoes.forEach(([view, rotulo, fundo, icone]) =>
    f.cartao({
      id: 'cfg-card-' + view,
      modulo: 'DISPOSICAO',
      grade: 'cfg-cards-disposicao',
      view,
      rotulo,
      fundo,
      icone: ICONE(icone)
    })
  );
  f.vista(
    'disp-unidades',
    'Unidades dos empreendimentos',
    `<div class="cfg-explica">Cada unidade tem ficha própria, com id, situação e histórico. O cadastro rápido de
      blocos e pavimentos do empreendimento gera as fichas; aqui você completa cada uma (áreas, vagas, tipologia,
      posição) ou várias de uma vez.</div><div id="dc-unidades" class="dc"></div>`
  );
  f.vista(
    'disp-precos',
    'Mapa de preço',
    `<div class="cfg-explica">Um mapa por empreendimento vale de cada vez. Reajuste vira um mapa novo, e o antigo fica
      como história: cada reserva guarda qual mapa estava valendo.</div><div id="dc-precos" class="dc"></div>`
  );
  f.vista(
    'disp-parametros',
    'Parâmetros de pagamento',
    `<div class="cfg-explica">As peças com que o fluxo de pagamento do cliente é montado na reserva: ato, mensais,
      semestrais, financiamento... Cada uma diz de quanto em quanto tempo vence e até quantas parcelas aceita.</div>
      <div id="dc-parametros" class="dc"></div>`
  );
  f.vista(
    'disp-regras',
    'Regras da reserva',
    `<div class="cfg-explica">Valem para todas as reservas deste cliente.</div><div id="dc-regras" class="dc"></div>`
  );
}

/** Abre a sub-tela (chamado pelo roteador de Configurações). */
export async function dispAbrirVista(/** @type {string} */ view) {
  const alvo = {
    'disp-unidades': 'dc-unidades',
    'disp-precos': 'dc-precos',
    'disp-parametros': 'dc-parametros',
    'disp-regras': 'dc-regras'
  }[view];
  if (!alvo) return;
  $(alvo).innerHTML = '<div class="dc-vazio">Carregando…</div>';
  try {
    if (!DC.emps.length) DC.emps = await carregar.empreendimentos();
    if (!DC.empId && DC.emps[0]) DC.empId = DC.emps[0].id;
    if (view === 'disp-unidades') await telaUnidades();
    if (view === 'disp-precos') await telaPrecos();
    if (view === 'disp-parametros') await telaParametros();
    if (view === 'disp-regras') await telaRegras();
  } catch (e) {
    $(alvo).innerHTML = `<div class="dc-vazio">${esc(motivo(/** @type {any} */ (e).message))}</div>`;
  }
}

/**
 * Depois de salvar um empreendimento no cadastro rápido: cria as fichas e abre
 * a lista delas, para a construtora completar unidade por unidade. Era o
 * pedido do dono: "logo depois tem que aparecer a listagem de todas as
 * unidades e um botão de editar para cada unidade".
 */
export async function dispAposSalvarEmpreendimento(/** @type {string} */ empId) {
  const r = await rpc('a1_unidades_materializar', { p_empreendimento: empId });
  if (!r.ok) {
    DC.toast(motivo(r.erro), 'error');
    return;
  }
  DC.emps = [];
  DC.empId = empId;
  DC.abrirVista('disp-unidades');
}

function seletorEmp(/** @type {string} */ tela) {
  return `<label class="dc-f dc-emp"><span>Empreendimento</span>
    <select data-acao-change="dcTrocarEmp" data-tela="${tela}">${DC.emps
      .map(e => `<option value="${esc(e.id)}"${e.id === DC.empId ? ' selected' : ''}>${esc(e.name)}</option>`)
      .join('')}</select></label>`;
}
async function trocarEmp(/** @type {string} */ id, /** @type {string} */ tela) {
  DC.empId = id;
  DC.sel.clear();
  DC.mapaId = null;
  await dispAbrirVista(tela);
}

// ═══ Unidades ═══════════════════════════════════════════════════════════════
async function lerUnidadesEPrecos() {
  const [un, mapas] = await Promise.all([carregar.unidades(DC.empId), carregar.mapas(DC.empId)]);
  DC.unidades = un.sort(ordemUn);
  DC.mapas = mapas;
  DC.itens = await carregar.itens(mapas.map(m => m.id));
}

async function telaUnidades() {
  if (!DC.emps.length) {
    $('dc-unidades').innerHTML =
      '<div class="dc-vazio">Cadastre um empreendimento primeiro (Empreendimentos, neste mesmo hub).</div>';
    return;
  }
  await lerUnidadesEPrecos();
  const emp = DC.emps.find(e => e.id === DC.empId) || {};
  const textos = Array.isArray(emp.units) ? emp.units : [];
  const comFicha = new Set(DC.unidades.map(u => u.codigo));
  const faltam = textos.filter((/** @type {string} */ c) => !comFicha.has(c)).length;
  const preco = precosVigentes(DC.mapas, DC.itens);
  const n = DC.sel.size;
  $('dc-unidades').innerHTML = `
    <div class="dc-barra">
      ${seletorEmp('disp-unidades')}
      <div class="dc-acoes">
        ${faltam ? `<button class="btn btn-ghost btn-sm" data-acao="dcGerarFichas">Gerar ${faltam} ficha(s) da lista</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-acao="dcLote">Gerar em lote</button>
        <button class="btn btn-ghost btn-sm" data-acao="dcEditarVarias"${n ? '' : ' disabled'}>Editar selecionadas${n ? ` (${n})` : ''}</button>
        <button class="btn btn-primary btn-sm" data-acao="dcNovaUnidade">+ Unidade</button>
      </div>
    </div>
    ${
      DC.unidades.length
        ? `<div class="dc-tab-wrap"><table class="pt-table dc-tab">
      <thead><tr><th><input type="checkbox" aria-label="Selecionar todas" data-acao-change="dcSelecionarTodas"${n && n === DC.unidades.length ? ' checked' : ''}></th>
        <th>Unidade</th><th>Bloco</th><th>Pav.</th><th>Tipologia</th><th class="n">Área priv.</th><th class="n">Área total</th>
        <th class="n">Vagas</th><th>Situação</th><th class="n">Preço</th><th></th></tr></thead>
      <tbody>${DC.unidades
        .map(u => {
          const st = STATUS[u.status] || STATUS.disponivel;
          return `<tr>
          <td><input type="checkbox" aria-label="Selecionar ${esc(u.codigo)}" data-acao-change="dcSelecionar" data-id="${esc(u.id)}"${DC.sel.has(u.id) ? ' checked' : ''}></td>
          <td><b>${esc(u.codigo)}</b></td><td>${esc(u.bloco || '—')}</td><td>${esc(rotuloPavimento(u.pavimento))}</td>
          <td>${esc(u.tipologia || '—')}</td>
          <td class="n">${u.area_privativa != null ? num(u.area_privativa) + ' m²' : '—'}</td>
          <td class="n">${u.area_total != null ? num(u.area_total) + ' m²' : '—'}</td>
          <td class="n">${u.vagas ?? '—'}</td>
          <td><span class="dc-st" style="background:${st.fundo};color:${st.texto}">${st.rotulo}</span></td>
          <td class="n">${preco[u.id] ? brl(preco[u.id]) : '<span class="dc-falta">sem preço</span>'}</td>
          <td><button class="pt-act" data-acao="dcEditarUnidade" data-id="${esc(u.id)}">Editar</button></td></tr>`;
        })
        .join('')}</tbody></table></div>`
        : `<div class="dc-vazio">Nenhuma ficha neste empreendimento. ${faltam ? 'Gere a partir da lista do cadastro ou ' : ''}crie em lote.</div>`
    }`;
}

function selecionar(/** @type {string} */ id, /** @type {boolean} */ on) {
  if (on) DC.sel.add(id);
  else DC.sel.delete(id);
  contarSelecao();
}
function contarSelecao() {
  const b = document.querySelector('[data-acao="dcEditarVarias"]');
  if (b) {
    /** @type {any} */ (b).disabled = !DC.sel.size;
    b.textContent = `Editar selecionadas${DC.sel.size ? ` (${DC.sel.size})` : ''}`;
  }
}
// Serve às duas tabelas (unidades e preços): marca as caixas da tabela de quem
// clicou, sem redesenhar. Redesenhar a tela de preços perderia o que foi
// digitado e ainda não salvo.
function selecionarTodas(/** @type {HTMLElement} */ el, /** @type {boolean} */ on) {
  DC.sel = new Set(on ? DC.unidades.map(u => u.id) : []);
  el.closest('table')
    ?.querySelectorAll('[data-acao-change="dcSelecionar"]')
    .forEach(c => {
      /** @type {HTMLInputElement} */ (c).checked = on;
    });
  contarSelecao();
}

async function gerarFichas() {
  const r = await rpc('a1_unidades_materializar', { p_empreendimento: DC.empId });
  if (!r.ok) return DC.toast(motivo(r.erro), 'error');
  DC.toast(`${r.criadas || 0} ficha(s) criada(s).`, 'success');
  DC.emps = await carregar.empreendimentos();
  await telaUnidades();
}

// Os campos da ficha, na ordem do formulário. tipo: t texto, n número, a área,
// s seleção, x texto longo.
const CAMPOS = [
  ['codigo', 'Código *', 't'],
  ['etapa', 'Etapa', 't'],
  ['bloco', 'Bloco / torre / quadra', 't'],
  ['pavimento', 'Pavimento (0 = térreo)', 'n'],
  ['numero', 'Número', 't'],
  ['final', 'Final (coluna)', 't'],
  ['tipologia', 'Tipologia', 't'],
  ['matricula', 'Matrícula', 't'],
  ['area_privativa', 'Área privativa (m²)', 'a'],
  ['area_comum', 'Área comum (m²)', 'a'],
  ['area_total', 'Área total (m²)', 'a'],
  ['area_terreno', 'Área de terreno (m²)', 'a'],
  ['fracao_ideal', 'Fração ideal', 'a'],
  ['quartos', 'Quartos', 'n'],
  ['suites', 'Suítes', 'n'],
  ['banheiros', 'Banheiros', 'n'],
  ['vagas', 'Vagas de garagem', 'n'],
  ['vaga_tipo', 'Tipo de vaga', 's', ['', 'Coberta', 'Descoberta', 'Livre', 'Presa', 'Gaveta', 'Box']],
  ['vaga_identificacao', 'Identificação da vaga', 't'],
  ['deposito', 'Depósito', 't'],
  [
    'posicao_solar',
    'Posição solar',
    's',
    [
      '',
      'Nascente',
      'Poente',
      'Norte',
      'Sul',
      'Leste',
      'Oeste',
      'Nordeste',
      'Noroeste',
      'Sudeste',
      'Sudoeste'
    ]
  ],
  ['posicao', 'Posição', 's', ['', 'Frente', 'Fundos', 'Lateral', 'Esquina', 'Meio']],
  ['vista', 'Vista', 't'],
  ['descricao', 'Descrição', 'x'],
  ['observacoes', 'Observações internas', 'x']
];

function htmlCampos(/** @type {any} */ u, /** @type {boolean} */ varias) {
  return CAMPOS.filter(
    ([k]) => !varias || !['codigo', 'pavimento', 'numero', 'matricula', 'observacoes'].includes(k)
  )
    .map(([k, rot, tipo, ops]) => {
      const v = u ? u[k] : null;
      const val = v == null ? '' : tipo === 'a' ? String(v).replace('.', ',') : String(v);
      const ph = varias ? ' placeholder="manter"' : '';
      if (tipo === 's')
        return `<label class="dc-f"><span>${esc(rot)}</span><select id="dcu-${k}">${
          /** @type {string[]} */ (ops)
            .map(
              o =>
                `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${o ? esc(o) : varias ? 'manter' : '—'}</option>`
            )
            .join('')
        }</select></label>`;
      if (tipo === 'x')
        return `<label class="dc-f dc-largo"><span>${esc(rot)}</span><textarea id="dcu-${k}" rows="2"${ph}>${esc(val)}</textarea></label>`;
      return `<label class="dc-f"><span>${esc(rot)}</span><input id="dcu-${k}" value="${esc(val)}"${
        tipo === 'n' ? ' type="number" min="0"' : tipo === 'a' ? ' inputmode="decimal"' : ''
      }${ph}></label>`;
    })
    .join('');
}

function lerCampos(/** @type {boolean} */ varias) {
  /** @type {Record<string, any>} */
  const o = {};
  CAMPOS.forEach(([k, , tipo]) => {
    const el = $('dcu-' + k);
    if (!el) return;
    const s = String(el.value || '').trim();
    if (varias && s === '') return;
    if (tipo === 'n') o[k] = s === '' ? null : Math.max(0, parseInt(s, 10) || 0);
    else if (tipo === 'a') o[k] = paraNumero(s);
    else o[k] = s === '' ? null : s;
  });
  // Área total em branco com privativa e comum preenchidas: soma das duas. É a
  // conta que todo mundo faz de cabeça, e o campo vazio virava um traço na ficha.
  if (!varias && o.area_total == null && o.area_privativa != null && o.area_comum != null)
    o.area_total = Math.round((o.area_privativa + o.area_comum) * 100) / 100;
  return o;
}

function abrirModal(
  /** @type {string} */ titulo,
  /** @type {string} */ corpo,
  /** @type {string} */ pe,
  largo = false
) {
  // Só tira o modal anterior do DOM. fecharModal() zeraria DC.editando, que
  // quem abre acabou de preencher: a edição virava cadastro novo.
  document.getElementById('dc-modal')?.remove();
  const el = document.createElement('div');
  el.className = 'dc-modal-fundo';
  el.id = 'dc-modal';
  el.dataset.acao = 'dcFecharModalPeloFundo';
  el.innerHTML = `<div class="dc-modal${largo ? ' largo' : ''}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
    <header><b>${esc(titulo)}</b><button class="dc-x" data-acao="dcFecharModal" aria-label="Fechar">×</button></header>
    <div class="dc-modal-corpo">${corpo}<div class="dc-erro" id="dc-erro" hidden></div></div>
    <footer>${pe}</footer></div>`;
  document.body.appendChild(el);
}
function fecharModal() {
  document.getElementById('dc-modal')?.remove();
  DC.editando = null;
}
function erroModal(/** @type {string} */ msg) {
  const e = $('dc-erro');
  if (!e) return DC.toast(msg, 'error');
  e.textContent = msg;
  e.hidden = false;
}

function editarUnidade(/** @type {string|null} */ id) {
  const u = id ? DC.unidades.find(x => x.id === id) : null;
  DC.editando = u;
  const st = u ? STATUS[u.status] || STATUS.disponivel : null;
  abrirModal(
    u ? `Unidade ${u.codigo}` : 'Nova unidade',
    `${u ? `<p class="dc-p">Situação: <b style="color:${st && st.texto}">${st && st.rotulo}</b>. A situação muda pela Disposição (reserva, bloqueio, venda), não por aqui.</p>` : ''}
     <div class="dc-grade">${htmlCampos(u || { bloco: (DC.unidades[0] || {}).bloco }, false)}</div>`,
    `${u && (u.status === 'disponivel' || u.status === 'bloqueado') ? '<button class="btn btn-danger btn-sm" data-acao="dcExcluirUnidade">Excluir</button>' : '<span></span>'}
     <div class="dc-pe-d"><button class="btn btn-ghost btn-sm" data-acao="dcFecharModal">Cancelar</button>
     <button class="btn btn-primary btn-sm" data-acao="dcSalvarUnidade">Salvar</button></div>`,
    true
  );
}

async function salvarUnidade() {
  const corpo = lerCampos(false);
  if (!corpo.codigo) return erroModal('Informe o código da unidade.');
  const u = DC.editando;
  const r = u
    ? await gravar('a1_unidades', 'PATCH', corpo, `?id=eq.${u.id}`)
    : await gravar('a1_unidades', 'POST', {
        ...corpo,
        tenant_id: A1.user && A1.user.tenant_id,
        empreendimento_id: DC.empId
      });
  if (!r.ok) return erroModal(motivo(r.erro));
  // PATCH que não alcança linha nenhuma volta 200 com lista vazia: é o RLS
  // dizendo não, e não um "salvo".
  if (Array.isArray(r.dados) && !r.dados.length) return erroModal(motivo('sem_permissao'));
  fecharModal();
  DC.toast(u ? `Unidade ${corpo.codigo} salva.` : `Unidade ${corpo.codigo} criada.`, 'success');
  await telaUnidades();
}

async function excluirUnidade() {
  const u = DC.editando;
  if (!u || !confirm(`Excluir a ficha ${u.codigo}? O histórico dela continua guardado.`)) return;
  const r = await gravar('a1_unidades', 'DELETE', null, `?id=eq.${u.id}`);
  if (!r.ok) return erroModal(motivo(r.erro));
  if (Array.isArray(r.dados) && !r.dados.length)
    return erroModal(
      'Esta ficha não pode ser excluída: ela já foi reservada ou vendida. Bloqueie em vez de excluir.'
    );
  fecharModal();
  DC.toast(`Ficha ${u.codigo} excluída.`, 'success');
  await telaUnidades();
}

function editarVarias() {
  if (!DC.sel.size) return;
  abrirModal(
    `Editar ${DC.sel.size} unidade(s)`,
    `<p class="dc-p">Só os campos preenchidos são aplicados; o que ficar em branco continua como está em cada unidade.</p>
     <div class="dc-grade">${htmlCampos(null, true)}</div>`,
    `<span></span><div class="dc-pe-d"><button class="btn btn-ghost btn-sm" data-acao="dcFecharModal">Cancelar</button>
     <button class="btn btn-primary btn-sm" data-acao="dcSalvarVarias">Aplicar às ${DC.sel.size}</button></div>`,
    true
  );
}
async function salvarVarias() {
  const corpo = lerCampos(true);
  if (!Object.keys(corpo).length) return erroModal('Preencha pelo menos um campo.');
  const ids = [...DC.sel];
  const r = await gravar('a1_unidades', 'PATCH', corpo, `?id=in.(${ids.join(',')})`);
  if (!r.ok) return erroModal(motivo(r.erro));
  fecharModal();
  DC.toast(`${Array.isArray(r.dados) ? r.dados.length : ids.length} unidade(s) atualizada(s).`, 'success');
  DC.sel.clear();
  await telaUnidades();
}

// ── Lote: o mesmo cadastro rápido de blocos, agora gerando fichas ──
function abrirLote() {
  abrirModal(
    'Gerar unidades em lote',
    `<p class="dc-p">O mesmo padrão do cadastro rápido: código BLOCO-PAVIMENTO+FINAL (B2-101 é o final 01 do 1º pavimento).
      Unidades que já existem com o mesmo código não são duplicadas.</p>
     <div class="dc-grade">
       <label class="dc-f"><span>Bloco / torre / quadra *</span><input id="dcl-bloco" value="B${(new Set(DC.unidades.map(u => u.bloco)).size || 0) + 1}" data-acao-input="dcLotePrevia"></label>
       <label class="dc-f"><span>Do pavimento</span><input id="dcl-de" type="number" min="0" value="0" data-acao-input="dcLotePrevia"></label>
       <label class="dc-f"><span>Até o pavimento</span><input id="dcl-ate" type="number" min="0" value="3" data-acao-input="dcLotePrevia"></label>
       <label class="dc-f"><span>Unidades por pavimento</span><input id="dcl-upf" type="number" min="1" value="4" data-acao-input="dcLotePrevia"></label>
       <label class="dc-f"><span>Tipologia (opcional)</span><input id="dcl-tip"></label>
       <label class="dc-f"><span>Área privativa (opcional)</span><input id="dcl-area" inputmode="decimal"></label>
     </div><div class="dc-previa" id="dcl-previa"></div>`,
    `<span></span><div class="dc-pe-d"><button class="btn btn-ghost btn-sm" data-acao="dcFecharModal">Cancelar</button>
     <button class="btn btn-primary btn-sm" data-acao="dcSalvarLote">Gerar</button></div>`
  );
  previaLote();
}
function codigosDoLote() {
  const bloco = String($('dcl-bloco').value || '').trim();
  const de = Math.max(0, parseInt($('dcl-de').value, 10) || 0);
  const ate = Math.max(de, parseInt($('dcl-ate').value, 10) || 0);
  const upf = Math.min(99, Math.max(1, parseInt($('dcl-upf').value, 10) || 1));
  const out = [];
  if (!bloco) return out;
  for (let p = de; p <= ate; p++)
    for (let f = 1; f <= upf; f++)
      out.push({
        codigo: `${bloco}-${p}${String(f).padStart(2, '0')}`,
        bloco,
        pavimento: p,
        numero: String(f).padStart(2, '0')
      });
  return out;
}
function previaLote() {
  const l = codigosDoLote();
  const existe = new Set(DC.unidades.map(u => u.codigo));
  const novas = l.filter(x => !existe.has(x.codigo));
  $('dcl-previa').innerHTML = l.length
    ? `<b>${novas.length}</b> nova(s)${l.length - novas.length ? `, ${l.length - novas.length} já existe(m)` : ''}: ${esc(
        novas
          .slice(0, 10)
          .map(x => x.codigo)
          .join('  ')
      )}${novas.length > 10 ? ` … +${novas.length - 10}` : ''}`
    : 'Informe o bloco.';
}
async function salvarLote() {
  const existe = new Set(DC.unidades.map(u => u.codigo));
  const tip = String($('dcl-tip').value || '').trim() || null;
  const area = paraNumero($('dcl-area').value);
  const novas = codigosDoLote()
    .filter(x => !existe.has(x.codigo))
    .map(x => ({
      ...x,
      tipologia: tip,
      area_privativa: area,
      tenant_id: A1.user && A1.user.tenant_id,
      empreendimento_id: DC.empId
    }));
  if (!novas.length) return erroModal('Nada a gerar: confira o bloco e os pavimentos.');
  if (novas.length > 2000) return erroModal('Mais de 2.000 unidades de uma vez. Gere por bloco.');
  const r = await gravar('a1_unidades', 'POST', novas);
  if (!r.ok) return erroModal(motivo(r.erro));
  fecharModal();
  DC.toast(`${novas.length} unidade(s) criada(s).`, 'success');
  await telaUnidades();
}

// ═══ Mapa de preço ══════════════════════════════════════════════════════════
async function telaPrecos() {
  if (!DC.emps.length) {
    $('dc-precos').innerHTML = '<div class="dc-vazio">Cadastre um empreendimento primeiro.</div>';
    return;
  }
  await lerUnidadesEPrecos();
  if (!DC.mapaId || !DC.mapas.some(m => m.id === DC.mapaId))
    DC.mapaId = (DC.mapas.find(m => m.ativo) || DC.mapas[0] || {}).id || null;
  const mapa = DC.mapas.find(m => m.id === DC.mapaId);
  const valores = Object.fromEntries(
    DC.itens.filter(i => i.mapa_id === DC.mapaId).map(i => [i.unidade_id, Number(i.valor)])
  );
  $('dc-precos').innerHTML = `
    <div class="dc-barra">${seletorEmp('disp-precos')}
      <div class="dc-acoes"><button class="btn btn-primary btn-sm" data-acao="dcNovoMapa">+ Novo mapa</button></div></div>
    ${
      DC.mapas.length
        ? `<div class="dc-mapas">${DC.mapas
            .map(
              m => `<div class="dc-mapa${m.id === DC.mapaId ? ' on' : ''}">
          <button class="dc-mapa-n" data-acao="dcAbrirMapa" data-id="${esc(m.id)}"><b>${esc(m.nome)}</b>
            <small>desde ${esc(dataBR(m.vigente_desde))}${m.vigente_ate ? ' até ' + esc(dataBR(m.vigente_ate)) : ''}</small></button>
          ${m.ativo ? '<span class="dc-valendo">Valendo</span>' : `<button class="pt-act" data-acao="dcAtivarMapa" data-id="${esc(m.id)}">Ativar</button>`}
          <button class="pt-act" data-acao="dcReajustar" data-id="${esc(m.id)}">Reajustar</button>
          ${m.ativo ? '' : `<button class="pt-act danger" data-acao="dcExcluirMapa" data-id="${esc(m.id)}">Excluir</button>`}
        </div>`
            )
            .join('')}</div>`
        : '<div class="dc-vazio">Este empreendimento ainda não tem mapa de preço. Crie o primeiro.</div>'
    }
    ${
      mapa
        ? `<div class="dc-ferr">
        <span>Preencher:</span>
        <label>R$ <input id="dcp-m2" inputmode="decimal" placeholder="por m²" size="9"></label>
        <button class="btn btn-ghost btn-sm" data-acao="dcPrecoM2" title="Valor = preço do m² × área privativa">× área privativa</button>
        <label><input id="dcp-pct" inputmode="decimal" placeholder="%" size="5"> %</label>
        <button class="btn btn-ghost btn-sm" data-acao="dcPrecoPct">Reajustar valores</button>
        <small>Aplica às selecionadas; sem seleção, a todas.</small>
        <span class="dc-ferr-d" id="dcp-resumo"></span>
        <button class="btn btn-primary btn-sm" data-acao="dcSalvarPrecos">Salvar preços</button>
      </div>
      <div class="dc-tab-wrap"><table class="pt-table dc-tab">
        <thead><tr><th><input type="checkbox" aria-label="Selecionar todas" data-acao-change="dcSelecionarTodas"></th>
          <th>Unidade</th><th>Tipologia</th><th class="n">Área priv.</th><th>Situação</th><th class="n">Valor (R$)</th><th class="n">R$/m²</th></tr></thead>
        <tbody>${DC.unidades
          .map(u => {
            const v = valores[u.id];
            const st = STATUS[u.status] || STATUS.disponivel;
            return `<tr><td><input type="checkbox" data-acao-change="dcSelecionar" data-id="${esc(u.id)}"${DC.sel.has(u.id) ? ' checked' : ''} aria-label="Selecionar ${esc(u.codigo)}"></td>
              <td><b>${esc(u.codigo)}</b></td><td>${esc(u.tipologia || '—')}</td>
              <td class="n">${u.area_privativa != null ? num(u.area_privativa) + ' m²' : '—'}</td>
              <td><span class="dc-st" style="background:${st.fundo};color:${st.texto}">${st.rotulo}</span></td>
              <td class="n"><input class="dc-preco" data-id="${esc(u.id)}" data-area="${esc(u.area_privativa ?? '')}" inputmode="decimal"
                value="${v ? esc(v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : ''}" data-acao-input="dcPrecoMudou" aria-label="Valor de ${esc(u.codigo)}"></td>
              <td class="n dc-m2">${v && u.area_privativa ? brl(v / Number(u.area_privativa)) : '—'}</td></tr>`;
          })
          .join('')}</tbody></table></div>`
        : ''
    }`;
  resumoPrecos();
}

function inputsPreco() {
  return /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('#dc-precos .dc-preco')]);
}
function alvosPreco() {
  const todos = inputsPreco();
  const sel = todos.filter(i => DC.sel.has(/** @type {string} */ (i.dataset.id)));
  return sel.length ? sel : todos;
}
const fmt2 = (/** @type {number} */ n) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function aplicarPrecoM2() {
  const m2 = paraNumero($('dcp-m2').value);
  if (!m2) return DC.toast('Informe o preço do m².', 'error');
  let semArea = 0;
  alvosPreco().forEach(i => {
    const a = Number(i.dataset.area);
    if (!a) return semArea++;
    i.value = fmt2(Math.round(m2 * a * 100) / 100);
  });
  if (semArea) DC.toast(`${semArea} unidade(s) sem área privativa ficaram como estavam.`, 'info');
  resumoPrecos();
}
function aplicarPct() {
  const pct = paraNumero($('dcp-pct').value);
  if (pct == null) return DC.toast('Informe o percentual.', 'error');
  alvosPreco().forEach(i => {
    const v = paraNumero(i.value);
    if (v) i.value = fmt2(Math.round(v * (1 + pct / 100) * 100) / 100);
  });
  resumoPrecos();
}
function resumoPrecos() {
  const ins = inputsPreco();
  let total = 0,
    faltam = 0;
  ins.forEach(i => {
    const v = paraNumero(i.value);
    if (v) total += v;
    else faltam++;
    const td = i.closest('tr')?.querySelector('.dc-m2');
    const a = Number(i.dataset.area);
    if (td) td.textContent = v && a ? brl(v / a) : '—';
  });
  const r = $('dcp-resumo');
  if (r)
    r.innerHTML = `VGV ${brl(total)}${faltam ? ` · <span class="dc-falta">${faltam} sem preço</span>` : ''}`;
}
async function salvarPrecos() {
  const ins = inputsPreco();
  const atuais = new Map(DC.itens.filter(i => i.mapa_id === DC.mapaId).map(i => [i.unidade_id, i]));
  const tenant = A1.user && A1.user.tenant_id;
  const upserts = [];
  const apagar = [];
  for (const i of ins) {
    const v = paraNumero(i.value);
    const uid = /** @type {string} */ (i.dataset.id);
    if (v && v > 0) {
      const at = atuais.get(uid);
      if (!at || Number(at.valor) !== v)
        upserts.push({ tenant_id: tenant, mapa_id: DC.mapaId, unidade_id: uid, valor: v });
    } else if (atuais.has(uid)) apagar.push(atuais.get(uid).id);
  }
  if (!upserts.length && !apagar.length) return DC.toast('Nada mudou.', 'info');
  if (upserts.length) {
    const r = await fetch(`${A1.rest('a1_mapa_preco_itens')}?on_conflict=mapa_id,unidade_id`, {
      method: 'POST',
      headers: A1.upsertHeaders(),
      body: JSON.stringify(upserts)
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return DC.toast(motivo(j.message || r.status), 'error');
    }
  }
  if (apagar.length) {
    const r = await gravar('a1_mapa_preco_itens', 'DELETE', null, `?id=in.(${apagar.join(',')})`);
    if (!r.ok) return DC.toast(motivo(r.erro), 'error');
  }
  DC.toast(`${upserts.length + apagar.length} preço(s) salvo(s).`, 'success');
  await telaPrecos();
}

function novoMapa() {
  abrirModal(
    'Novo mapa de preço',
    `<div class="dc-grade">
      <label class="dc-f dc-largo"><span>Nome *</span><input id="dcm-nome" placeholder="Ex.: Tabela de lançamento, Tabela novembro"></label>
      <label class="dc-f"><span>Vale desde</span><input id="dcm-desde" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="dc-f"><span>Vale até (opcional)</span><input id="dcm-ate" type="date"></label>
    </div><p class="dc-p">O mapa nasce como rascunho. Preencha os preços e ative quando estiver pronto.</p>`,
    `<span></span><div class="dc-pe-d"><button class="btn btn-ghost btn-sm" data-acao="dcFecharModal">Cancelar</button>
     <button class="btn btn-primary btn-sm" data-acao="dcSalvarNovoMapa">Criar</button></div>`
  );
}
async function salvarNovoMapa() {
  const nome = String($('dcm-nome').value || '').trim();
  if (!nome) return erroModal('Dê um nome ao mapa.');
  const r = await gravar('a1_mapas_preco', 'POST', {
    tenant_id: A1.user && A1.user.tenant_id,
    empreendimento_id: DC.empId,
    nome,
    vigente_desde: $('dcm-desde').value || undefined,
    vigente_ate: $('dcm-ate').value || null,
    ativo: false
  });
  if (!r.ok) return erroModal(motivo(r.erro));
  fecharModal();
  DC.mapaId = Array.isArray(r.dados) && r.dados[0] ? r.dados[0].id : null;
  await telaPrecos();
}
async function abrirMapa(/** @type {string} */ id) {
  DC.mapaId = id;
  DC.sel.clear();
  await telaPrecos();
}
async function ativarMapa(/** @type {string} */ id) {
  const semPreco = DC.unidades.length - DC.itens.filter(i => i.mapa_id === id).length;
  if (
    semPreco > 0 &&
    !confirm(
      `${semPreco} unidade(s) ficam sem preço neste mapa e não poderão ser reservadas. Ativar mesmo assim?`
    )
  )
    return;
  const r = await rpc('a1_mapa_preco_ativar', { p_mapa: id });
  if (!r.ok) return DC.toast(motivo(r.erro), 'error');
  DC.toast('Mapa ativado. As próximas reservas usam estes preços.', 'success');
  await telaPrecos();
}
function reajustar(/** @type {string} */ id) {
  const m = DC.mapas.find(x => x.id === id);
  if (!m) return;
  DC.editando = m;
  abrirModal(
    `Reajustar "${m.nome}"`,
    `<p class="dc-p">Cria um mapa novo com todos os valores corrigidos pelo percentual. O original continua como está.</p>
     <div class="dc-grade">
      <label class="dc-f"><span>Nome do novo mapa *</span><input id="dcr-nome" value="${esc(m.nome)} reajustado"></label>
      <label class="dc-f"><span>Reajuste (%) *</span><input id="dcr-pct" inputmode="decimal" placeholder="Ex.: 0,85 (INCC do mês)"></label>
      <label class="dc-f"><span>Vale desde</span><input id="dcr-desde" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
     </div>`,
    `<span></span><div class="dc-pe-d"><button class="btn btn-ghost btn-sm" data-acao="dcFecharModal">Cancelar</button>
     <button class="btn btn-primary btn-sm" data-acao="dcSalvarReajuste">Criar mapa reajustado</button></div>`
  );
}
async function salvarReajuste() {
  const m = DC.editando;
  const pct = paraNumero($('dcr-pct').value);
  if (pct == null) return erroModal('Informe o percentual.');
  const r = await rpc('a1_mapa_preco_duplicar', {
    p_mapa: m.id,
    p_nome: String($('dcr-nome').value || '').trim(),
    p_reajuste_pct: pct,
    p_vigente_desde: $('dcr-desde').value || null
  });
  if (!r.ok) return erroModal(motivo(r.erro));
  fecharModal();
  DC.mapaId = r.mapa_id || null;
  DC.toast('Mapa reajustado criado como rascunho. Confira e ative.', 'success');
  await telaPrecos();
}
async function excluirMapa(/** @type {string} */ id) {
  const m = DC.mapas.find(x => x.id === id);
  if (!m || !confirm(`Excluir o mapa "${m.nome}" e os preços dele?`)) return;
  const r = await gravar('a1_mapas_preco', 'DELETE', null, `?id=eq.${id}`);
  if (!r.ok) return DC.toast(motivo(r.erro), 'error');
  DC.mapaId = null;
  await telaPrecos();
}

// ═══ Parâmetros de pagamento ════════════════════════════════════════════════
async function telaParametros() {
  DC.parametros = await carregar.parametros(false);
  $('dc-parametros').innerHTML = `
    <div class="dc-barra"><span></span><div class="dc-acoes">
      ${DC.parametros.length ? '' : '<button class="btn btn-ghost btn-sm" data-acao="dcParametrosPadrao">Usar o padrão</button>'}
      <button class="btn btn-primary btn-sm" data-acao="dcNovoParametro">+ Parâmetro</button></div></div>
    ${
      DC.parametros.length
        ? `<div class="dc-tab-wrap"><table class="pt-table dc-tab">
      <thead><tr><th>Nome</th><th>Série</th><th>Periodicidade</th><th class="n">Parcelas</th><th class="n">Parcela mínima</th>
        <th>Vencimento</th><th>Quem paga</th><th>Situação</th><th></th></tr></thead>
      <tbody>${DC.parametros
        .map(
          p => `<tr${p.ativo ? '' : ' class="dc-inativo"'}><td><b>${esc(p.nome)}</b></td><td>${esc(serieDe(p.serie).rotulo)}</td>
            <td>${esc(PERIODICIDADE(p.periodicidade_meses))}</td>
            <td class="n">${p.parcelas_min === p.parcelas_max ? p.parcelas_max : `${p.parcelas_min} a ${p.parcelas_max}`}</td>
            <td class="n">${p.valor_minimo ? brl(p.valor_minimo) : '—'}</td>
            <td>${p.exige_vencimento ? 'exige' : 'no repasse'}</td>
            <td>${esc(/** @type {any} */ (QUEM_PAGA)[p.quem_paga] || p.quem_paga)}</td>
            <td>${p.ativo ? 'Ativo' : 'Inativo'}</td>
            <td><button class="pt-act" data-acao="dcEditarParametro" data-id="${esc(p.id)}">Editar</button></td></tr>`
        )
        .join('')}</tbody></table></div>`
        : `<div class="dc-vazio">Nenhum parâmetro cadastrado. <b>Usar o padrão</b> cria: Ato, Sinal, Mensais (até 72),
            Semestrais, Anuais, Chaves, Financiamento, FGTS, Subsídio e À vista. Tudo editável depois.</div>`
    }`;
}

async function parametrosPadrao() {
  const tenant = A1.user && A1.user.tenant_id;
  const linhas = PARAMETROS_PADRAO.map((p, i) => ({
    exige_vencimento: true,
    quem_paga: 'CLIENTE',
    valor_minimo: null,
    parcelas_min: 1,
    ...p,
    ordem: i,
    ativo: true,
    tenant_id: tenant
  }));
  const r = await gravar('a1_parametros_pagamento', 'POST', linhas);
  if (!r.ok) return DC.toast(motivo(r.erro), 'error');
  DC.toast(`${linhas.length} parâmetros criados.`, 'success');
  await telaParametros();
}

function editarParametro(/** @type {string|null} */ id) {
  const p = id ? DC.parametros.find(x => x.id === id) : null;
  DC.editando = p;
  const s = p || {
    serie: 'MENSAL',
    periodicidade_meses: 1,
    parcelas_min: 1,
    parcelas_max: 72,
    exige_vencimento: true,
    quem_paga: 'CLIENTE',
    ativo: true,
    ordem: DC.parametros.length
  };
  abrirModal(
    p ? `Parâmetro ${p.nome}` : 'Novo parâmetro de pagamento',
    `<div class="dc-grade">
      <label class="dc-f"><span>Nome *</span><input id="dcpp-nome" value="${esc(s.nome || '')}" placeholder="Ex.: Mensais"></label>
      <label class="dc-f"><span>Série</span><select id="dcpp-serie" data-acao-change="dcSerieMudou">${SERIES.map(
        x => `<option value="${x.serie}"${x.serie === s.serie ? ' selected' : ''}>${esc(x.rotulo)}</option>`
      ).join('')}</select></label>
      <label class="dc-f"><span>Periodicidade</span><select id="dcpp-per">${[0, 1, 2, 3, 6, 12]
        .map(
          m =>
            `<option value="${m}"${m === s.periodicidade_meses ? ' selected' : ''}>${esc(PERIODICIDADE(m))}</option>`
        )
        .join('')}</select></label>
      <label class="dc-f"><span>Parcelas (mínimo)</span><input id="dcpp-min" type="number" min="1" value="${esc(s.parcelas_min)}"></label>
      <label class="dc-f"><span>Parcelas (máximo)</span><input id="dcpp-max" type="number" min="1" value="${esc(s.parcelas_max)}"></label>
      <label class="dc-f"><span>Parcela mínima (R$)</span><input id="dcpp-vmin" inputmode="decimal" value="${s.valor_minimo ? esc(String(s.valor_minimo).replace('.', ',')) : ''}"></label>
      <label class="dc-f"><span>Quem paga</span><select id="dcpp-quem">${Object.entries(QUEM_PAGA)
        .map(([k, v]) => `<option value="${k}"${k === s.quem_paga ? ' selected' : ''}>${esc(v)}</option>`)
        .join('')}</select></label>
      <label class="dc-f"><span>Ordem no fluxo</span><input id="dcpp-ordem" type="number" min="0" value="${esc(s.ordem ?? 0)}"></label>
      <label class="dc-c"><input type="checkbox" id="dcpp-venc"${s.exige_vencimento ? ' checked' : ''}> Exige o primeiro vencimento</label>
      <label class="dc-c"><input type="checkbox" id="dcpp-ativo"${s.ativo ? ' checked' : ''}> Ativo (aparece na reserva)</label>
    </div>`,
    `${p ? '<button class="btn btn-danger btn-sm" data-acao="dcExcluirParametro">Excluir</button>' : '<span></span>'}
     <div class="dc-pe-d"><button class="btn btn-ghost btn-sm" data-acao="dcFecharModal">Cancelar</button>
     <button class="btn btn-primary btn-sm" data-acao="dcSalvarParametro">Salvar</button></div>`
  );
}
// Trocar a série sugere a periodicidade, o teto e quem paga dela. Só sugere:
// o que a construtora digitar depois vale.
function serieMudou() {
  const s = serieDe($('dcpp-serie').value);
  $('dcpp-per').value = String(s.periodicidade);
  $('dcpp-max').value = String(s.max);
  $('dcpp-quem').value = s.quem;
  $('dcpp-venc').checked = s.vencimento;
  if (!$('dcpp-nome').value) $('dcpp-nome').value = s.rotulo;
}
async function salvarParametro() {
  const nome = String($('dcpp-nome').value || '').trim();
  if (!nome) return erroModal('Dê um nome ao parâmetro.');
  const min = Math.max(1, parseInt($('dcpp-min').value, 10) || 1);
  const max = Math.max(1, parseInt($('dcpp-max').value, 10) || 1);
  if (min > max) return erroModal('O mínimo de parcelas não pode passar do máximo.');
  const corpo = {
    nome,
    serie: $('dcpp-serie').value,
    periodicidade_meses: Number($('dcpp-per').value),
    parcelas_min: min,
    parcelas_max: max,
    valor_minimo: paraNumero($('dcpp-vmin').value),
    quem_paga: $('dcpp-quem').value,
    ordem: parseInt($('dcpp-ordem').value, 10) || 0,
    exige_vencimento: $('dcpp-venc').checked,
    ativo: $('dcpp-ativo').checked
  };
  const p = DC.editando;
  const r = p
    ? await gravar('a1_parametros_pagamento', 'PATCH', corpo, `?id=eq.${p.id}`)
    : await gravar('a1_parametros_pagamento', 'POST', { ...corpo, tenant_id: A1.user && A1.user.tenant_id });
  if (!r.ok) return erroModal(motivo(r.erro));
  fecharModal();
  DC.toast('Parâmetro salvo.', 'success');
  await telaParametros();
}
async function excluirParametro() {
  const p = DC.editando;
  if (
    !p ||
    !confirm(
      `Excluir "${p.nome}"? As reservas já feitas guardam uma cópia e não mudam. Para só tirar da reserva, desative.`
    )
  )
    return;
  const r = await gravar('a1_parametros_pagamento', 'DELETE', null, `?id=eq.${p.id}`);
  if (!r.ok) return erroModal(motivo(r.erro));
  fecharModal();
  await telaParametros();
}

// ═══ Regras ═════════════════════════════════════════════════════════════════
async function telaRegras() {
  DC.config = await carregar.config();
  const c = DC.config || {
    reserva_horas: 48,
    exige_fluxo_fechado: true,
    corretor_cancela_propria: true,
    max_reservas_por_cpf: 0
  };
  $('dc-regras').innerHTML = `<div class="dc-cartao">
    <div class="dc-grade">
      <label class="dc-f"><span>Prazo da reserva (horas)</span><input id="dcg-horas" type="number" min="0" max="8760" value="${esc(c.reserva_horas)}">
        <small>Passado o prazo sem a venda andar, a unidade volta a ficar disponível. 0 = não vence.</small></label>
      <label class="dc-f"><span>Reservas ativas por CPF</span><input id="dcg-cpf" type="number" min="0" value="${esc(c.max_reservas_por_cpf)}">
        <small>Quantas unidades o mesmo cliente pode segurar ao mesmo tempo. 0 = sem limite.</small></label>
    </div>
    <label class="dc-c"><input type="checkbox" id="dcg-fecha"${c.exige_fluxo_fechado ? ' checked' : ''}> O fluxo de pagamento tem de fechar no valor da unidade para reservar</label>
    <label class="dc-c"><input type="checkbox" id="dcg-cancela"${c.corretor_cancela_propria ? ' checked' : ''}> O corretor pode cancelar a própria reserva</label>
    <div class="dc-pe-d dc-salvar"><button class="btn btn-primary btn-sm" data-acao="dcSalvarRegras">Salvar regras</button></div>
  </div>`;
}
async function salvarRegras() {
  const corpo = {
    tenant_id: A1.user && A1.user.tenant_id,
    reserva_horas: Math.min(8760, Math.max(0, parseInt($('dcg-horas').value, 10) || 0)),
    max_reservas_por_cpf: Math.max(0, parseInt($('dcg-cpf').value, 10) || 0),
    exige_fluxo_fechado: $('dcg-fecha').checked,
    corretor_cancela_propria: $('dcg-cancela').checked,
    atualizado_em: new Date().toISOString()
  };
  const r = await fetch(`${A1.rest('a1_disposicao_config')}?on_conflict=tenant_id`, {
    method: 'POST',
    headers: A1.upsertHeaders(),
    body: JSON.stringify(corpo)
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    return DC.toast(motivo(j.message || r.status), 'error');
  }
  DC.toast('Regras da reserva salvas.', 'success');
}
