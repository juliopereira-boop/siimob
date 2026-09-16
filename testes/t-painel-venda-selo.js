// O painel de Venda: quando a venda está ganha, quando ela JÁ ESTEVE ganha, e o
// que isso muda no pipeline, no funil e no distrato.
//
// POR QUE ESTE ARQUIVO EXISTE
// t-paineis.js prova o painel pelo navegador, contra o cenário compartilhado —
// e naquele cenário os números batem por coincidência: há um negócio aberto e
// um ganho, e nenhum que tenha ido ao fim e voltado. Os defeitos corrigidos
// aqui só aparecem no cartão que ANDA: arrastado para a etapa de fim, puxado de
// volta, arrastado de novo, cancelado depois de vendido. Mexer no cenário
// compartilhado para ensaiar isso mudaria o resultado de outras vinte
// asserções que nada têm a ver com o assunto.
//
// Então aqui não há navegador nem cenário comum: pnCalcCO é lida do arquivo de
// verdade e chamada direto, com um conjunto de dados montado para cada pergunta.
//
// O QUE ESTAS PROVAS GUARDAM
//   1. ganho AGORA e ganho UM DIA são perguntas diferentes — confundi-las
//      somava o mesmo dinheiro no Pipeline bruto e no VGV ao mesmo tempo
//   2. quando o cartão entrou na etapa de fim mais de uma vez, vale a ÚLTIMA
//      entrada: com a primeira, venda de ontem sumia do período
//   3. o funil não alarga: quem chegou ao fim passou pelo meio
//   4. etapa com flag CANCELADO não é venda encerrada, mesmo tendo selo de fim
//   5. cada módulo tem o SEU vocabulário de selo — FIM_POSITIVO é da
//      Pré-análise e não encerra Venda nenhuma
const fs = require('fs');
const path = require('path');
const { checa, resumo } = require('./comum');

// ── Carrega paineis.js de verdade, sem navegador ────────────────────────────
// É um arquivo de <script>: avaliado aqui dentro de um escopo com os poucos
// globais que ele toca, devolvendo as funções reais. Copiar o cálculo para o
// teste provaria a cópia, não o sistema.
function carregar() {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'js', 'paineis.js'), 'utf8');
  const doc = { getElementById: () => null, querySelectorAll: () => [], head: { appendChild(){} },
                createElement: () => ({ style: {}, setAttribute(){}, appendChild(){} }),
                addEventListener(){} };
  const janela = { document: doc, localStorage: { getItem: () => null, setItem(){} },
                   location: { pathname: '/thecred/repasse' }, addEventListener(){} };
  const A1 = { headers: () => ({}), rest: t => '/rest/' + t, buscarTudo: async () => [] };
  const fn = new Function('window', 'document', 'localStorage', 'location', 'A1', 'fetch',
    codigo + '\n;return { pnCalcCO, pnEncerrada, PN, pnValorCO };');
  return fn(janela, doc, janela.localStorage, janela.location, A1, async () => ({ ok:false, json: async()=>[] }));
}

const P = carregar();
const H = Date.now();
const dias = n => new Date(H - n * 864e5).toISOString();

// A esteira: início, fim de venda (selo VENDIDO) e cancelamento. A etapa
// "Cancelado" leva flag CANCELADO **e** selo FIM_NEGATIVO — é como os três
// clientes reais a configuraram, e é a combinação que fazia o aging apresentar
// cancelamento ao gestor como fim de venda.
const SITUACOES = [
  { id: 'cs1', nome: 'Proposta',          flag: 'INICIAL',           selo: 'INICIO',       ordem: 0, cor: '#6366f1', sla_horas: 24, ativo: true },
  { id: 'cs2', nome: 'Contrato assinado', flag: 'CONTRATO_ASSINADO', selo: 'VENDIDO',      ordem: 1, cor: '#22c55e', sla_horas: null, ativo: true },
  { id: 'cs3', nome: 'Cancelado',         flag: 'CANCELADO',         selo: 'FIM_NEGATIVO', ordem: 2, cor: '#ef4444', sla_horas: null, ativo: true }
];

function calc(com, eventos, contratos) {
  P.PN.dias = 90; P.PN.de = ''; P.PN.ate = ''; P.PN.empr = '';
  return P.pnCalcCO({
    situacoes: SITUACOES, com, eventos,
    contratos: contratos || [], transicoes: [], empr: [], parceiros: []
  });
}

(async () => {

console.log('== ARRASTADO PARA O FIM E PUXADO DE VOLTA ==');
{
  // O cartão foi para "Contrato assinado" e voltou. Hoje ele está em Proposta:
  // é um negócio ABERTO. Contá-lo como ganho porque um dia passou por lá punha
  // os mesmos R$ 100.000 no Pipeline bruto e no VGV — e não havia como desfazer
  // pela tela, porque o evento de ida não desacontece.
  const c = calc(
    [{ id: 'coA', codigo: 'CO-A', situacao_id: 'cs1', situacao_em: dias(3),
       criado_em: dias(30), proposta: { valor_venda: 10000000 } }],
    [{ comercial_id: 'coA', evento: 'situacao_alterada', para_situacao: 'cs2', criado_em: dias(10) },
     { comercial_id: 'coA', evento: 'situacao_alterada', para_situacao: 'cs1', criado_em: dias(9) }]
  );
  checa('o negócio devolvido conta como ativo', c.ativos === 1, 'ativos=' + c.ativos);
  checa('e NÃO conta mais como venda ganha', c.assinados === 0, 'assinados=' + c.assinados);
  checa('o dinheiro dele está no pipeline', c.pipeline === 10000000, 'pipeline=' + c.pipeline);
  checa('e não está também no VGV — era a mesma venda contada duas vezes',
    c.valorAssinado === 0, 'valorAssinado=' + c.valorAssinado);
  checa('sem venda no período, o ticket é traço e não zero', c.ticket === null, String(c.ticket));
}

console.log('\n== ENTROU NA ETAPA DE FIM MAIS DE UMA VEZ ==');
{
  // Duas idas: uma há 200 dias, outra há 2. O recorte é de 90 dias. Com a
  // PRIMEIRA entrada valendo, a venda de anteontem era datada do ano passado e
  // sumia do período — o gestor fechava o mês com uma venda a menos e não tinha
  // como descobrir por quê.
  const c = calc(
    [{ id: 'coB', codigo: 'CO-B', situacao_id: 'cs2', situacao_em: dias(2),
       criado_em: dias(210), proposta: { valor_venda: 21200000 } }],
    [{ comercial_id: 'coB', evento: 'situacao_alterada', para_situacao: 'cs2', criado_em: dias(200) },
     { comercial_id: 'coB', evento: 'situacao_alterada', para_situacao: 'cs1', criado_em: dias(190) },
     { comercial_id: 'coB', evento: 'situacao_alterada', para_situacao: 'cs2', criado_em: dias(2) }]
  );
  checa('vale a ÚLTIMA entrada, então a venda está dentro do período',
    c.assinados === 1, 'assinados=' + c.assinados);
  checa('com o valor dela no VGV', c.valorAssinado === 21200000, 'valorAssinado=' + c.valorAssinado);
  checa('ganho não é aberto: ele saiu do pipeline', c.ativos === 0 && c.pipeline === 0,
    'ativos=' + c.ativos + ' pipeline=' + c.pipeline);
  checa('e a saída por selo é contada, para o aging explicar a diferença',
    c.encerrados === 1, 'encerrados=' + c.encerrados);
  checa('o painel diz quantas foram reconhecidas pela esteira, não pelo documento',
    c.vendidosSemContrato === 1, String(c.vendidosSemContrato));
  // O funil é da SAFRA criada no período, e este negócio nasceu há 210 dias:
  // ele não aparece em linha nenhuma. Isso não é defeito — é a definição do
  // cartão, e vale dizer aqui para ninguém "consertar" o funil olhando só o
  // total de vendas ganhas, que conta por data de fechamento.
  checa('e o funil, que é por safra de criação, não conta este negócio antigo',
    c.funil.criados === 0 && c.funil.assinado === 0,
    'criados=' + c.funil.criados + ' assinado=' + c.funil.assinado);
}

console.log('\n== O FUNIL NÃO ALARGA NO FIM ==');
{
  // Sem contrato cadastrado — que é o que os três clientes fazem —, a linha
  // "Contrato gerado" marcava 0 e a de baixo, "Venda ganha", marcava 1. Funil
  // que alarga no fim não é funil, é defeito à vista, e foi assim que o dono
  // percebeu. Quem chegou ao fim passou pelo meio.
  const c = calc(
    [{ id: 'coE', codigo: 'CO-E', situacao_id: 'cs2', situacao_em: dias(2),
       criado_em: dias(10), proposta: { valor_venda: 18000000 } }],
    [{ comercial_id: 'coE', evento: 'situacao_alterada', para_situacao: 'cs2', criado_em: dias(2) }]
  );
  checa('a safra do período tem o negócio', c.funil.criados === 1, 'criados=' + c.funil.criados);
  checa('a venda ganha por selo aparece no fim do funil',
    c.funil.assinado === 1, 'assinado=' + c.funil.assinado);
  checa('e a linha de cima não fica menor que a de baixo',
    c.funil.contrato >= c.funil.assinado,
    'contrato=' + c.funil.contrato + ' assinado=' + c.funil.assinado);
  checa('nem a linha da proposta', c.funil.proposta >= c.funil.contrato,
    'proposta=' + c.funil.proposta + ' contrato=' + c.funil.contrato);
}

console.log('\n== VENDIDO E DEPOIS CANCELADO: DISTRATO ==');
{
  // Vendido há 20 dias, cancelado há 5. Hoje o cartão está em "Cancelado".
  const c = calc(
    [{ id: 'coC', codigo: 'CO-C', situacao_id: 'cs3', situacao_em: dias(5),
       criado_em: dias(60), proposta: { valor_venda: 30000000 } }],
    [{ comercial_id: 'coC', evento: 'situacao_alterada', para_situacao: 'cs2', criado_em: dias(20) },
     { comercial_id: 'coC', evento: 'situacao_alterada', para_situacao: 'cs3', criado_em: dias(5) }]
  );
  checa('negócio desfeito não é venda ganha hoje', c.assinados === 0, 'assinados=' + c.assinados);
  checa('nem entra no pipeline', c.ativos === 0, 'ativos=' + c.ativos);
  checa('mas a memória de que já esteve ganho sustenta o distrato',
    c.distratos === 1, 'distratos=' + c.distratos);
  checa('e ele conta como perda do período', c.perdidos === 1, 'perdidos=' + c.perdidos);
  // Cancelado tem selo FIM_NEGATIVO, mas cancelamento não é venda encerrada: o
  // título do cartão de aging apresentava um ao gestor como se fosse o outro.
  checa('etapa com flag CANCELADO não entra na conta de saídas por selo',
    c.encerrados === 0, 'encerrados=' + c.encerrados);
}

console.log('\n== CONTRATO ASSINADO CONTINUA MANDANDO NA DATA ==');
{
  // O selo reconhece a venda; o documento, quando existe, diz o dia — porque
  // assinatura tem data certa e arrastar cartão não tem.
  const c = calc(
    [{ id: 'coD', codigo: 'CO-D', situacao_id: 'cs2', situacao_em: dias(1),
       criado_em: dias(40), proposta: { valor_venda: 15000000 } }],
    [{ comercial_id: 'coD', evento: 'situacao_alterada', para_situacao: 'cs2', criado_em: dias(1) }],
    [{ comercial_id: 'coD', versao: 1, status: 'ASSINADO', assinado_em: dias(30), criado_em: dias(35) }]
  );
  checa('a venda é reconhecida', c.assinados === 1, 'assinados=' + c.assinados);
  checa('e o ciclo é medido pela assinatura, não pelo arrasto',
    Math.round(c.p50Ciclo / 24) === 10, 'p50Ciclo(dias)=' + (c.p50Ciclo / 24));
  checa('com contrato cadastrado, ela não conta como reconhecida pela esteira',
    c.vendidosSemContrato === 0, String(c.vendidosSemContrato));
}

console.log('\n== CADA MÓDULO TEM O SEU VOCABULÁRIO DE SELO ==');
{
  // São dois CHECK diferentes no banco: a Pré-análise termina em FIM_POSITIVO
  // ou FIM_NEGATIVO; a Venda, em VENDIDO ou FIM_NEGATIVO. Uma lista única para
  // os dois fazia a Venda aceitar um selo que a esteira dela nunca grava — e,
  // pior, encerraria por engano se alguém o gravasse à mão.
  const e = P.pnEncerrada;
  checa('FIM_POSITIVO encerra na Pré-análise',
    e({ selo: 'FIM_POSITIVO' }, 'PRE_ANALISE') === true);
  checa('e NÃO encerra na Venda', e({ selo: 'FIM_POSITIVO' }, 'COMERCIAL') === false);
  checa('VENDIDO encerra na Venda', e({ selo: 'VENDIDO' }, 'COMERCIAL') === true);
  checa('e não existe na Pré-análise', e({ selo: 'VENDIDO' }, 'PRE_ANALISE') === false);
  checa('FIM_NEGATIVO encerra nos dois',
    e({ selo: 'FIM_NEGATIVO' }, 'PRE_ANALISE') === true && e({ selo: 'FIM_NEGATIVO' }, 'COMERCIAL') === true);
  checa('situação sem selo não encerra nada', e({ selo: null }, 'COMERCIAL') === false && e(null, 'PRE_ANALISE') === false);
  checa('módulo desconhecido não encerra por acidente', e({ selo: 'VENDIDO' }, 'REPASSE') === false);
}

process.exit(resumo([]) ? 1 : 0);
})();
