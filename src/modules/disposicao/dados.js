// @ts-check
// ─── Disposição de unidades: o que a tela e as Configurações compartilham ────
//
// A situação de uma unidade, as séries com que se monta um fluxo de pagamento,
// as leituras do banco e a tradução dos motivos de recusa. Mora aqui para que
// a tela do mapa e as sub-telas de Configurações digam a mesma coisa com as
// mesmas palavras: "Reservada" numa e "Em reserva" na outra é o gestor
// perguntando se são duas situações.
import { A1 } from '../../shared/api/config.js';

// ─── Situações ───────────────────────────────────────────────────────────────
// Os quatro códigos são do banco e não mudam (check em a1_unidades.status). As
// cores partem da paleta do sistema (verde do "pode vender", açafrão do
// "segura") e foram conferidas no validador de paleta: com a ardósia e o cinza
// do sistema, vendida e bloqueada ficavam a 10 de distância visual (abaixo de
// 15, quem enxerga cor normalmente já confunde). O azul mais saturado e o
// cinza neutro abrem para 20. Cor nunca vai sozinha: cada situação tem ícone,
// rótulo, e a bloqueada tem hachura.
export const STATUS = {
  disponivel: {
    rotulo: 'Disponível',
    plural: 'Disponíveis',
    cor: '#0E8C7F',
    fundo: '#E6F4F1',
    texto: '#0B7568'
  },
  reservado: {
    rotulo: 'Reservada',
    plural: 'Reservadas',
    cor: '#C87E12',
    fundo: '#FDF3E2',
    texto: '#9A6008'
  },
  vendido: { rotulo: 'Vendida', plural: 'Vendidas', cor: '#2F5FA8', fundo: '#EAF0FA', texto: '#264E8C' },
  bloqueado: { rotulo: 'Bloqueada', plural: 'Bloqueadas', cor: '#878F8C', fundo: '#EFF1F0', texto: '#4F5754' }
};
export const ORDEM_STATUS = ['disponivel', 'reservado', 'vendido', 'bloqueado'];

export const STATUS_RESERVA = {
  ATIVA: 'Ativa',
  CONVERTIDA: 'Virou venda',
  CANCELADA: 'Cancelada',
  EXPIRADA: 'Venceu'
};

// ─── Séries de pagamento ─────────────────────────────────────────────────────
// Os códigos são os do check de a1_parametros_pagamento.serie. A periodicidade
// e o teto aqui são só o ponto de partida do formulário: quem decide é o
// parâmetro que a construtora grava.
/** @typedef {{serie:string, rotulo:string, periodicidade:number, max:number, quem:string, vencimento:boolean}} Serie */
/** @type {Serie[]} */
export const SERIES = [
  { serie: 'ATO', rotulo: 'Ato', periodicidade: 0, max: 1, quem: 'CLIENTE', vencimento: true },
  { serie: 'SINAL', rotulo: 'Sinal', periodicidade: 1, max: 6, quem: 'CLIENTE', vencimento: true },
  { serie: 'MENSAL', rotulo: 'Mensais', periodicidade: 1, max: 72, quem: 'CLIENTE', vencimento: true },
  { serie: 'BIMESTRAL', rotulo: 'Bimestrais', periodicidade: 2, max: 36, quem: 'CLIENTE', vencimento: true },
  {
    serie: 'TRIMESTRAL',
    rotulo: 'Trimestrais',
    periodicidade: 3,
    max: 24,
    quem: 'CLIENTE',
    vencimento: true
  },
  { serie: 'SEMESTRAL', rotulo: 'Semestrais', periodicidade: 6, max: 12, quem: 'CLIENTE', vencimento: true },
  { serie: 'ANUAL', rotulo: 'Anuais', periodicidade: 12, max: 6, quem: 'CLIENTE', vencimento: true },
  {
    serie: 'INTERMEDIARIA',
    rotulo: 'Intermediárias',
    periodicidade: 6,
    max: 12,
    quem: 'CLIENTE',
    vencimento: true
  },
  { serie: 'CHAVES', rotulo: 'Chaves', periodicidade: 0, max: 1, quem: 'CLIENTE', vencimento: true },
  {
    serie: 'FINANCIAMENTO',
    rotulo: 'Financiamento',
    periodicidade: 0,
    max: 1,
    quem: 'BANCO',
    vencimento: false
  },
  { serie: 'FGTS', rotulo: 'FGTS', periodicidade: 0, max: 1, quem: 'BANCO', vencimento: false },
  { serie: 'SUBSIDIO', rotulo: 'Subsídio', periodicidade: 0, max: 1, quem: 'GOVERNO', vencimento: false },
  { serie: 'A_VISTA', rotulo: 'À vista', periodicidade: 0, max: 1, quem: 'CLIENTE', vencimento: true },
  { serie: 'OUTRO', rotulo: 'Outro', periodicidade: 0, max: 1, quem: 'CLIENTE', vencimento: true }
];
export const serieDe = (/** @type {string} */ s) =>
  SERIES.find(x => x.serie === s) || SERIES[SERIES.length - 1];

export const QUEM_PAGA = { CLIENTE: 'Cliente (recurso próprio)', BANCO: 'Banco', GOVERNO: 'Governo' };

export const PERIODICIDADE = (/** @type {number} */ m) =>
  ({ 0: 'Parcela única', 1: 'Mensal', 2: 'Bimestral', 3: 'Trimestral', 6: 'Semestral', 12: 'Anual' })[m] ||
  `A cada ${m} meses`;

// O conjunto que o botão "Usar o padrão" grava. Teto de mensais em 72 porque
// foi o exemplo do dono; o resto é o que aparece com mais frequência nas
// tabelas de lançamento. Tudo editável depois.
export const PARAMETROS_PADRAO = [
  { nome: 'Ato', serie: 'ATO', periodicidade_meses: 0, parcelas_max: 1 },
  { nome: 'Sinal', serie: 'SINAL', periodicidade_meses: 1, parcelas_max: 6 },
  { nome: 'Mensais', serie: 'MENSAL', periodicidade_meses: 1, parcelas_max: 72, valor_minimo: 200 },
  { nome: 'Semestrais', serie: 'SEMESTRAL', periodicidade_meses: 6, parcelas_max: 12 },
  { nome: 'Anuais', serie: 'ANUAL', periodicidade_meses: 12, parcelas_max: 6 },
  { nome: 'Chaves', serie: 'CHAVES', periodicidade_meses: 0, parcelas_max: 1 },
  {
    nome: 'Financiamento',
    serie: 'FINANCIAMENTO',
    periodicidade_meses: 0,
    parcelas_max: 1,
    exige_vencimento: false,
    quem_paga: 'BANCO'
  },
  {
    nome: 'FGTS',
    serie: 'FGTS',
    periodicidade_meses: 0,
    parcelas_max: 1,
    exige_vencimento: false,
    quem_paga: 'BANCO'
  },
  {
    nome: 'Subsídio',
    serie: 'SUBSIDIO',
    periodicidade_meses: 0,
    parcelas_max: 1,
    exige_vencimento: false,
    quem_paga: 'GOVERNO'
  },
  { nome: 'À vista', serie: 'A_VISTA', periodicidade_meses: 0, parcelas_max: 1 }
];

// ─── Números e datas ─────────────────────────────────────────────────────────
const FMT_BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (/** @type {any} */ v) => (v == null || v === '' ? '—' : FMT_BRL.format(Number(v) || 0));

// "R$ 210 mil", "R$ 1,25 mi": o que cabe numa célula do mapa.
export function brlCurto(/** @type {any} */ v) {
  const n = Number(v);
  if (v == null || v === '' || !isFinite(n)) return '';
  if (n >= 1e6) return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi';
  if (n >= 1e3) return 'R$ ' + Math.round(n / 1e3).toLocaleString('pt-BR') + ' mil';
  return 'R$ ' + n.toLocaleString('pt-BR');
}

export const num = (/** @type {any} */ v, casas = 2) =>
  v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });

// "1.234,56" ou "1234.56" ou "R$ 1.234,56" → 1234.56. Vazio vira null.
export function paraNumero(/** @type {any} */ s) {
  if (s == null) return null;
  if (typeof s === 'number') return isFinite(s) ? s : null;
  const t = String(s).replace(/[^\d,.-]/g, '');
  if (!t) return null;
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  return isFinite(n) ? n : null;
}

export const dataBR = (/** @type {any} */ iso) =>
  iso ? new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('pt-BR') : '—';
export const dataHoraBR = (/** @type {any} */ iso) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '—';

// "vence em 1d 4h", "venceu há 3h". Sem prazo, vazio.
export function prazo(/** @type {any} */ iso, agora = Date.now()) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - agora;
  const h = Math.round(Math.abs(ms) / 36e5);
  const txt = h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h >= 1 ? `${h}h` : 'menos de 1h';
  return ms >= 0 ? `vence em ${txt}` : `venceu há ${txt}`;
}

// As datas das parcelas: o primeiro vencimento e, a partir dele, a cada
// periodicidade_meses. Dia 31 em mês curto cai no último dia do mês.
export function vencimentos(
  /** @type {string} */ primeiro,
  /** @type {number} */ quantidade,
  /** @type {number} */ meses
) {
  if (!primeiro) return [];
  const [a, m, d] = primeiro.split('-').map(Number);
  const out = [];
  for (let i = 0; i < Math.max(1, quantidade); i++) {
    const alvo = new Date(a, m - 1 + i * (meses || 0), 1);
    const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
    alvo.setDate(Math.min(d, ultimo));
    const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
    out.push(`${alvo.getFullYear()}-${p(alvo.getMonth() + 1)}-${p(alvo.getDate())}`);
    if (!meses) break;
  }
  return out;
}

// Pavimento 0 é o térreo; o resto, ordinal.
export const rotuloPavimento = (/** @type {any} */ p) =>
  p == null ? 'Sem pavimento' : Number(p) === 0 ? 'Térreo' : `${p}º`;

// ─── Leituras ────────────────────────────────────────────────────────────────
async function lerTudo(/** @type {string} */ url) {
  const r = await A1.buscarTudo(url);
  if (!r || r.erro) throw new Error((r && r.erro) || 'falha ao ler');
  return r.linhas || [];
}

export async function lerJson(/** @type {string} */ url) {
  const r = await fetch(url, { headers: A1.headers() });
  if (!r.ok) throw new Error(await motivoHttp(r));
  return r.json();
}

export const carregar = {
  empreendimentos: () =>
    lerJson(`${A1.rest('a1_developments')}?select=id,name,cidade,estado,units,unit_count&order=name`),
  unidades: (/** @type {string|null} */ empId) =>
    lerTudo(
      `${A1.rest('a1_unidades')}?select=*${empId ? `&empreendimento_id=eq.${empId}` : ''}&order=id.asc`
    ),
  mapas: (/** @type {string|null} */ empId) =>
    lerJson(
      `${A1.rest('a1_mapas_preco')}?select=*${empId ? `&empreendimento_id=eq.${empId}` : ''}&order=criado_em.desc`
    ),
  itens: (/** @type {string[]} */ mapaIds) =>
    mapaIds.length
      ? lerTudo(
          `${A1.rest('a1_mapa_preco_itens')}?select=id,mapa_id,unidade_id,valor&mapa_id=in.(${mapaIds.join(',')})&order=id.asc`
        )
      : Promise.resolve([]),
  parametros: (soAtivos = true) =>
    lerJson(
      `${A1.rest('a1_parametros_pagamento')}?select=*${soAtivos ? '&ativo=is.true' : ''}&order=ordem.asc,nome.asc`
    ),
  config: () => lerJson(`${A1.rest('a1_disposicao_config')}?select=*`).then(l => l[0] || null),
  reservas: () => lerTudo(`${A1.rest('a1_reservas')}?select=*&order=criado_em.desc,id.desc`),
  eventos: (/** @type {string} */ unidadeId) =>
    lerJson(
      `${A1.rest('a1_unidade_eventos')}?select=*&unidade_id=eq.${unidadeId}&order=criado_em.desc&limit=60`
    ),
  eventosDesde: (/** @type {string} */ iso) =>
    lerTudo(
      `${A1.rest('a1_unidade_eventos')}?select=id,unidade_id,empreendimento_id,evento,de,para,detalhe,criado_em&evento=eq.STATUS&criado_em=gte.${encodeURIComponent(iso)}&order=id.asc`
    )
};

// O preço que vale para cada unidade: o do mapa ativo do empreendimento dela.
export function precosVigentes(/** @type {any[]} */ mapas, /** @type {any[]} */ itens) {
  const ativos = new Set(mapas.filter(m => m.ativo).map(m => m.id));
  /** @type {Record<string, number>} */
  const preco = {};
  itens.forEach(i => {
    if (ativos.has(i.mapa_id)) preco[i.unidade_id] = Number(i.valor);
  });
  return preco;
}

// ─── Escritas ────────────────────────────────────────────────────────────────
// RPC devolve { ok, erro, ... } quando a recusa é de regra de negócio, e uma
// exceção (HTTP 400 com message) quando é de acesso. As duas viram texto aqui.
export async function rpc(/** @type {string} */ nome, /** @type {any} */ corpo) {
  const r = await fetch(A1.rpc(nome), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify(corpo || {})
  });
  if (!r.ok) return { ok: false, erro: await codigoHttp(r) };
  const j = await r.json().catch(() => null);
  return j && typeof j === 'object' ? j : { ok: true, valor: j };
}

export async function gravar(
  /** @type {string} */ tabela,
  /** @type {string} */ metodo,
  /** @type {any} */ corpo,
  filtro = ''
) {
  const r = await fetch(`${A1.rest(tabela)}${filtro}`, {
    method: metodo,
    headers: A1.returnHeaders(),
    body: corpo == null ? undefined : JSON.stringify(corpo)
  });
  if (!r.ok) return { ok: false, erro: await codigoHttp(r), dados: null };
  const dados = await r.json().catch(() => null);
  return { ok: true, erro: null, dados };
}

async function codigoHttp(/** @type {Response} */ r) {
  try {
    const j = await r.json();
    return String(j.message || j.hint || j.details || r.status);
  } catch {
    return String(r.status);
  }
}
async function motivoHttp(/** @type {Response} */ r) {
  return motivo(await codigoHttp(r));
}

// ─── O que dizer a quem recebeu um não ───────────────────────────────────────
// O banco responde com um código curto; a pessoa precisa saber o que fazer.
const MOTIVOS = {
  modulo_desabilitado: 'A Disposição de unidades não está liberada para este cliente.',
  sem_permissao: 'O seu cadastro não tem permissão para isso. Fale com o gestor.',
  sem_acesso: 'O seu cadastro não tem acesso à Disposição de unidades.',
  nao_encontrado: 'Não encontrei esse registro. Ele pode ter sido excluído.',
  unidade_reservado: 'Esta unidade acabou de ser reservada por outra pessoa.',
  unidade_vendido: 'Esta unidade já foi vendida.',
  unidade_bloqueado: 'Esta unidade está bloqueada para venda.',
  versao_desatualizada:
    'Alguém mexeu nesta unidade enquanto você preenchia. Atualizei a tela; confira e tente de novo.',
  titular_sem_nome: 'Informe o nome do titular.',
  titular_cpf_invalido: 'O CPF do titular precisa ter 11 dígitos.',
  unidade_sem_preco: 'Esta unidade não tem preço no mapa de preço que está valendo.',
  fluxo_vazio: 'Monte o fluxo de pagamento antes de reservar.',
  parametro_invalido: 'Uma das parcelas usa um parâmetro de pagamento que não existe mais.',
  quantidade_fora_do_limite: 'A quantidade de parcelas está fora do limite do parâmetro.',
  valor_invalido: 'Toda parcela precisa de um valor maior que zero.',
  parcela_abaixo_do_minimo: 'Uma das parcelas está abaixo do valor mínimo do parâmetro.',
  sem_vencimento: 'Uma das parcelas precisa do primeiro vencimento.',
  fluxo_nao_fecha: 'A soma do fluxo não bate com o valor da unidade.',
  limite_de_reservas_do_cpf: 'Este CPF já tem o máximo de reservas ativas permitido.',
  corretor_de_outro_cliente: 'O corretor escolhido não é deste cliente.',
  motivo_obrigatorio: 'Diga o motivo: ele fica no histórico da unidade.',
  mudanca_nao_permitida: 'Essa mudança de situação não é permitida.',
  reserva_cancelada: 'Esta reserva já foi cancelada.',
  reserva_expirada: 'Esta reserva já venceu.',
  reserva_convertida: 'Esta reserva já virou venda.',
  horas_invalidas: 'Informe um prazo entre 1 e 8760 horas.',
  situacao_da_unidade_so_pela_disposicao: 'A situação da unidade só muda pela Disposição.',
  empreendimento_de_outro_cliente: 'Esse empreendimento não é deste cliente.',
  item_de_preco_fora_do_mapa: 'Esse preço aponta para uma unidade de outro empreendimento.',
  mapa_sem_nome: 'Dê um nome ao mapa de preço.',
  reajuste_invalido: 'O reajuste precisa ser um percentual entre -99 e 1000.'
};
export function motivo(/** @type {any} */ codigo) {
  const c = String(codigo || '');
  for (const [k, v] of Object.entries(MOTIVOS)) if (c.includes(k)) return v;
  if (/duplicate key|unique/i.test(c)) return 'Já existe um registro com esse nome ou código.';
  if (/foreign key|violates/i.test(c))
    return 'Este registro tem histórico ligado a ele e não pode ser excluído.';
  return c ? `O banco recusou: ${c}` : 'Não consegui falar com o servidor.';
}
