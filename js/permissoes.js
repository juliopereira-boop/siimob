// ─── O catálogo de permissões, num lugar só ──────────────────────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// As permissões estavam escritas à mão em cada formulário: corretor, analista,
// correspondente e coordenador, cada um com a sua lista. Elas divergiram — e
// pior, três chaves que aparecem no formulário (ver_repasses, baixar_documentos,
// editar_perfil) NÃO SÃO LIDAS POR NADA. O gestor marcava e não acontecia nada.
//
// Aqui a lista é uma só, e cada item declara em que módulo vive. Uma permissão
// de um módulo que o cliente não tem simplesmente não aparece — do mesmo jeito
// que a aba dele não aparece.
//
// REGRA QUE NÃO SE QUEBRA: só entra nesta lista chave que alguma tela ou alguma
// política de RLS de fato lê. Caixa que não faz nada é pior que caixa ausente:
// a ausente o gestor percebe, a que não faz nada ele acredita.
//
// Onde cada uma é lida está escrito no campo `lida_em` — e é conferido por
// testes/t-perfis.js, que falha se alguém acrescentar chave decorativa.

const A1_PERMISSOES = [
  // ── Geral: valem em qualquer módulo ────────────────────────────────────────
  { chave:'gerente', modulo:null, rotulo:'Gerente',
    ajuda:'Enxerga e edita a carteira inteira do cliente, como o gestor. Ligar isto '
        + 'torna as outras marcas desnecessárias.',
    lida_em:'a1_perm (SQL), podeEditarProcesso, a1_pa_visivel, a1_co_visivel' },
  { chave:'ver_todos_analistas', modulo:null, rotulo:'Visão completa (vê de todos)',
    ajuda:'ABRE A CARTEIRA INTEIRA DO CLIENTE para esta pessoa, em todos os '
        + 'módulos: ela passa a ver processo de todo mundo, não só o dela. '
        + 'É como o coordenador enxerga a equipe. Desligado, ela vê apenas os '
        + 'processos em que é a responsável.',
    lida_em:'temVisaoCompleta, a1_case_visivel (SQL), a1_pa_visivel, a1_co_visivel' },
  { chave:'ver_dashboard', modulo:null, rotulo:'Ver dashboard',
    ajuda:'Sem isto a aba Dashboard nem aparece para ela.',
    lida_em:'boot de repasse/andamento/listagem, js/modulo-shell.js' },

  // ── Repasse ────────────────────────────────────────────────────────────────
  //
  // 'ver_repasses' já existiu aqui e foi removida por não ter leitor: era a
  // caixa decorativa clássica. Voltou porque a falta dela deixava o bloco do
  // Repasse sem o degrau mais básico — dava para dizer "pode criar" e "pode
  // editar", mas não dava para dizer apenas "pode ver". Desta vez ela É lida:
  // sem a marca, o módulo não abre para a pessoa.
  //
  // AUSENTE VALE "PODE VER", e é de propósito: nenhum cadastro nem perfil de
  // hoje tem esta chave, e tratá-la como negada trancaria todo mundo para fora
  // do Repasse na primeira publicação. A partir daqui os formulários sempre a
  // gravam, então a omissão só existe no que foi salvo antes desta mudança.
  { chave:'ver_repasses', modulo:'repasse', rotulo:'Ver processos',
    ajuda:'O degrau mais básico: sem isto o módulo de Repasse não abre para a '
        + 'pessoa. Com isto e mais nada, ela acompanha sem poder alterar.',
    lida_em:'hasPerm nas telas do Repasse (boot e barra de abas)' },
  { chave:'criar_repasses', modulo:'repasse', rotulo:'Criar processos',
    ajuda:'Abrir novo processo.',
    lida_em:'a1_perm (SQL), telas do Repasse' },
  { chave:'editar_repasses', modulo:'repasse', rotulo:'Editar processos',
    ajuda:'Alterar os dados de um processo que ela enxerga.',
    lida_em:'a1_perm (SQL), podeEditarProcesso, políticas dos módulos novos' },
  { chave:'alterar_etapa', modulo:'repasse', rotulo:'Mover de etapa',
    ajuda:'Arrastar o cartão para outra etapa do workflow.',
    lida_em:'telas do Repasse' },
  { chave:'ver_todos_repasses', modulo:'repasse', rotulo:'Compartilhar carteira com colegas',
    ajuda:'Para correspondente: deixa os colegas da mesma empresa enxergarem os '
        + 'processos dela.',
    lida_em:'shared_managers em repasse/andamento/listagem' },

  // ── Pré-análise ────────────────────────────────────────────────────────────
  { chave:'pa_ver', modulo:'PRE_ANALISE', rotulo:'Ver pré-análises',
    ajuda:'Sem isto o módulo não abre para ela, mesmo o cliente tendo a licença.',
    lida_em:'a1_pre_analises_ler (RLS), pre-analise.html' },
  { chave:'pa_criar', modulo:'PRE_ANALISE', rotulo:'Criar pré-análise',
    ajuda:'Usar o assistente de nova pré-análise e cadastrar pessoas.',
    lida_em:'a1_pre_analises_criar (RLS), a1_pa_pessoas_criar (RLS)' },
  { chave:'pa_editar', modulo:'PRE_ANALISE', rotulo:'Editar pré-análises',
    ajuda:'Alterar dados, pessoas e documentos do processo que ela enxerga.',
    lida_em:'a1_pre_analises_editar (RLS), pre-analise.html' },
  { chave:'pa_mover', modulo:'PRE_ANALISE', rotulo:'Mover na esteira',
    ajuda:'Mover a pré-análise pelas transições liberadas no workflow.',
    lida_em:'a1_pa_transicionar (SQL), pre-analise.html' },
  { chave:'pa_iniciar_venda', modulo:'PRE_ANALISE', rotulo:'Iniciar venda',
    ajuda:'Criar a Venda a partir de uma pré-análise na etapa com selo de fim positivo.',
    lida_em:'a1_pa_executar_acao (SQL), pre-analise.html' },
  { chave:'analisar_credito', modulo:'PRE_ANALISE', rotulo:'Analisar crédito e documentos',
    ajuda:'Registrar a decisão de crédito e aprovar ou reprovar documentos. '
        + 'Quem vende não aprova: esta é a marca que separa as duas coisas.',
    lida_em:'a1_pa_analises_credito_escrever (RLS), a1_pa_guarda_documento' },

  // ── Venda ──────────────────────────────────────────────────────────────
  { chave:'co_ver', modulo:'COMERCIAL', rotulo:'Ver negócios',
    ajuda:'Sem isto o módulo não abre para ela, mesmo o cliente tendo a licença.',
    lida_em:'a1_comerciais_ler (RLS), comercial.html' },
  { chave:'co_editar', modulo:'COMERCIAL', rotulo:'Editar proposta',
    ajuda:'Alterar dados e proposta da venda que ela enxerga.',
    lida_em:'a1_comerciais_editar (RLS), comercial.html' },
  { chave:'co_mover', modulo:'COMERCIAL', rotulo:'Mover na esteira',
    ajuda:'Mover a venda pelas transições liberadas no workflow.',
    lida_em:'a1_co_transicionar (SQL), comercial.html' },
  { chave:'co_contrato', modulo:'COMERCIAL', rotulo:'Marcar contrato como assinado',
    ajuda:'Se quem vende pudesse carimbar sozinho, exigir contrato assinado numa '
        + 'transição deixaria de ser exigência.',
    lida_em:'a1_co_guarda_contrato (gatilho)' },
];

// Um perfil recém-criado começa fechado. É de propósito: o que não foi
// explicitamente liberado fica fechado, e um perfil novo que já nascesse podendo
// tudo seria o contrário disso.
const A1_PERFIS_MODELO = [
  { nome:'Corretor',      permissoes:['ver_repasses','criar_repasses','pa_ver','pa_criar','co_ver'] },
  { nome:'Analista',      permissoes:['ver_repasses','editar_repasses','alterar_etapa','ver_todos_analistas',
                                      'pa_ver','pa_editar','pa_mover','analisar_credito','co_ver'] },
  { nome:'Coordenador',   permissoes:['ver_repasses','ver_dashboard','ver_todos_analistas','pa_ver','co_ver'] },
  { nome:'Correspondente',permissoes:['ver_repasses','criar_repasses','editar_repasses','alterar_etapa',
                                      'pa_ver','pa_criar','pa_editar','pa_mover','analisar_credito',
                                      'co_ver','co_editar','co_mover'] },
];

// As permissões que valem para um cliente, dado o que ele tem licenciado.
// `tem` é o objeto { PRE_ANALISE:true, ... } que a1MontarShell devolve, ou
// qualquer coisa que responda a chave => booleano.
function a1PermissoesDisponiveis(tem){
  const ligado = m => !m || (tem && tem[m] === true);
  return A1_PERMISSOES.filter(p => ligado(p.modulo));
}

function a1PermissoesPorModulo(tem){
  const grupos = new Map();
  a1PermissoesDisponiveis(tem).forEach(p => {
    const k = p.modulo || 'geral';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  });
  return grupos;
}

const A1_ROTULO_MODULO = { geral:'Vale em todos os módulos', repasse:'Repasse',
                           PRE_ANALISE:'Pré-análise', COMERCIAL:'Venda' };

// As permissões efetivas de alguém: o PERFIL manda, quando existe.
//
// É o ponto do recurso — mudar o perfil muda todo mundo que está nele. Deixar
// as duas fontes valendo (perfil E marcas soltas na pessoa) traria de volta o
// problema que o perfil veio resolver: ninguém saberia dizer, olhando a tela,
// por que fulano consegue e beltrano não.
function a1PermissoesEfetivas(pessoa, perfil){
  if (perfil && perfil.permissions && typeof perfil.permissions === 'object')
    return perfil.permissions;
  return (pessoa && pessoa.permissions) || {};
}
