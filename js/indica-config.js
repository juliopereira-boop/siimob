// ═════════════════════════════════════════════════════════════════════════════
// INDICASII — CONFIGURAÇÃO CENTRAL
//
// Tudo que muda com o tempo mora aqui: percentual, textos, perguntas, números.
// A página não tem número solto no meio do código — trocar a regra do programa
// é editar este arquivo, e nada mais.
// ═════════════════════════════════════════════════════════════════════════════

const INDICA = {

  marca: 'SIIMOB',
  programa: 'IndicaSII',
  siteInstitucional: '/conheca',

  // ─── A regra do programa ───────────────────────────────────────────────────
  // A recompensa é percentual sobre o contrato fechado, não valor fixo.
  recompensa: {
    percentual: 20,          // % do valor do contrato fechado
    // O simulador precisa de um valor de contrato para mostrar uma conta. Este
    // é um EXEMPLO para a simulação — quem usa a página pode mudar no próprio
    // simulador. Ajuste aqui o valor que melhor representa seus contratos.
    contratoExemplo: 12000,
    contratoMin: 3000,
    contratoMax: 60000,
    contratoPasso: 1000,
    maxIndicacoes: 10,
  },

  // ─── Números da barra de autoridade ────────────────────────────────────────
  // PLACEHOLDERS. Enquanto o texto começar com "[", a página mostra o número
  // esmaecido e com um aviso — para ninguém publicar métrica inventada sem
  // querer. Troque pelos números reais e o aviso some sozinho.
  metricas: [
    { valor: '[CLIENTES]+',   rotulo: 'empresas usando o SIIMOB' },
    { valor: '[PROCESSOS]+',  rotulo: 'repasses acompanhados' },
    { valor: '[ESTADOS]',     rotulo: 'estados atendidos' },
    { valor: '[SATISFACAO]%', rotulo: 'satisfação dos clientes' },
  ],

  // ─── Diferenciais ──────────────────────────────────────────────────────────
  diferenciais: [
    { icone: 'fluxo',    titulo: 'Feito para repasse',
      texto: 'Não é um CRM adaptado. O sistema nasceu para acompanhar repasse imobiliário, etapa por etapa, do contrato à assinatura.' },
    { icone: 'olho',     titulo: 'O gargalo à vista',
      texto: 'O painel mostra onde o processo trava de verdade, cruzando quantidade e tempo parado — não só qual etapa tem mais gente.' },
    { icone: 'pessoas',  titulo: 'Cada um vê o que é seu',
      texto: 'Gestor, analista, correspondente e corretor entram no mesmo sistema com permissão própria, por etapa.' },
    { icone: 'planilha', titulo: 'Sai da planilha em um dia',
      texto: 'A base atual entra por importação, com conferência antes de gravar. Ninguém recomeça do zero.' },
    { icone: 'escudo',   titulo: 'Dado de cliente isolado',
      texto: 'Cada empresa enxerga só a própria carteira, com isolamento verificado no banco e senha com sal.' },
    { icone: 'raio',     titulo: 'Abre rápido, mesmo cheio',
      texto: 'Arquivo pesado fica fora da listagem e só carrega quando alguém abre o processo. A tela não engasga.' },
  ],

  // ─── Segmentos que dá para indicar ─────────────────────────────────────────
  segmentos: [
    { chave:'construtora',  titulo:'Construtoras',
      texto:'Quem vende na planta e precisa acompanhar o repasse de cada unidade até a assinatura.' },
    { chave:'imobiliaria',  titulo:'Imobiliárias',
      texto:'Equipes de corretores que perdem venda por não saber em que pé está cada processo.' },
    { chave:'correspondente', titulo:'Correspondentes',
      texto:'Quem cuida do crédito de várias construtoras ao mesmo tempo e vive apagando incêndio na planilha.' },
  ],

  // ─── Os dois programas ─────────────────────────────────────────────────────
  programas: {
    indicacao: {
      titulo: 'Programa de Indicação',
      resumo: 'Para quem conhece alguém que precisa do sistema e quer ser reconhecido por isso.',
      itens: [
        { rotulo:'Para quem',      valor:'Qualquer pessoa. Não precisa ser cliente.' },
        { rotulo:'Recompensa',     valor:'PERCENTUAL do contrato fechado.' },
        { rotulo:'O que você faz', valor:'Indica e pronto. A conversa comercial é nossa.' },
        { rotulo:'Acompanhamento', valor:'Painel próprio, com o andamento de cada indicação.' },
        { rotulo:'Limite',         valor:'Nenhum. Indique quantas empresas quiser.' },
      ],
      cta: 'Quero indicar',
    },
    parceria: {
      titulo: 'Programa de Parceria',
      resumo: 'Para quem quer atuar comercialmente junto com a gente, de forma contínua.',
      itens: [
        { rotulo:'Para quem',      valor:'Consultorias, contadores e parceiros do setor.' },
        { rotulo:'Remuneração',    valor:'Modelo combinado caso a caso, incluindo recorrência.' },
        { rotulo:'O que você faz', valor:'Participa da conversa comercial e da implantação.' },
        { rotulo:'Acompanhamento', valor:'Canal direto e material de apoio.' },
        { rotulo:'Limite',         valor:'Acordo próprio, com metas combinadas.' },
      ],
      cta: 'Quero ser parceiro',
    },
  },

  // ─── Depoimentos ───────────────────────────────────────────────────────────
  // PLACEHOLDERS até termos autorização de quem falou. A página avisa que são
  // exemplos enquanto o nome começar com "[".
  depoimentos: [
    { nome:'[Nome do parceiro]', cargo:'[Cargo] · [Empresa]',
      texto:'[Espaço reservado para o depoimento de quem indicou. Substitua por um texto real, com autorização.]' },
    { nome:'[Nome do parceiro]', cargo:'[Cargo] · [Empresa]',
      texto:'[Espaço reservado para o depoimento de quem indicou. Substitua por um texto real, com autorização.]' },
    { nome:'[Nome do parceiro]', cargo:'[Cargo] · [Empresa]',
      texto:'[Espaço reservado para o depoimento de quem indicou. Substitua por um texto real, com autorização.]' },
  ],

  // ─── Dúvidas ───────────────────────────────────────────────────────────────
  duvidas: [
    { p:'Quem pode participar?',
      r:'Qualquer pessoa maior de idade, com CPF ou CNPJ. Você não precisa ser cliente do SIIMOB nem trabalhar no mercado imobiliário — basta conhecer uma empresa que se encaixe.' },
    { p:'Posso indicar uma empresa que já é cliente?',
      r:'Não. Se a empresa já usa o SIiMOB ou já estava em negociação conosco antes da sua indicação, ela não gera recompensa. Você vê isso no seu painel, marcada como não elegível.' },
    { p:'Quando eu recebo?',
      r:'Depois que o contrato é assinado e o primeiro pagamento é confirmado. Aí a recompensa entra como disponível no seu painel e é enviada para a chave PIX que você cadastrou.' },
    { p:'Como acompanho minha indicação?',
      r:'Ao enviar a primeira indicação você recebe um link pessoal. Por ele, a qualquer momento, você vê em que pé está cada empresa que indicou e quanto tem a receber.' },
    { p:'Existe limite de indicações?',
      r:'Não. Indique quantas empresas quiser. Cada uma é acompanhada separadamente e cada contrato fechado gera a sua recompensa.' },
    { p:'A mesma empresa pode ser indicada por duas pessoas?',
      r:'Vale a primeira indicação registrada. Por isso, se você já conversou com alguém, não deixe para depois.' },
    { p:'O que acontece depois que eu indico?',
      r:'Nossa equipe comercial entra em contato com a empresa, apresenta o sistema e conduz a negociação. Você não precisa participar — mas pode acompanhar tudo pelo painel.' },
    { p:'Qual a diferença para o programa de parceria?',
      r:'Na indicação você apenas apresenta a empresa e recebe pelo contrato fechado. Na parceria você atua junto com a gente na conversa comercial, com modelo de remuneração combinado à parte.' },
  ],

  // ─── Menu ──────────────────────────────────────────────────────────────────
  menu: [
    { id:'como-funciona', texto:'Como funciona' },
    { id:'diferenciais',  texto:'Diferenciais' },
    { id:'beneficios',    texto:'Benefícios' },
    { id:'depoimentos',   texto:'Depoimentos' },
    { id:'duvidas',       texto:'Dúvidas' },
  ],
};
