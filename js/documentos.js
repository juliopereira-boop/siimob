// ─── As listas de documentos que o sistema já sabe sugerir ───────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// A Pré-análise sempre teve uma lista de tipos embutida na tela: cliente que
// ainda não configurou nada não pode cair num seletor vazio no dia 1 do módulo.
// O problema é que essa lista era invisível para o gestor — ela aparecia no
// cadastro do cliente, e sumia no instante em que ele cadastrava o PRIMEIRO
// tipo próprio, sem nunca ter passado por Configurações. O gestor via uma lista
// boa desaparecer e não tinha como trazê-la de volta.
//
// Agora a mesma lista mora aqui, e Configurações › Tipos de documento oferece
// um botão para adotá-la. A tela do módulo continua caindo nela enquanto não
// houver nada cadastrado — a diferença é que agora dá para adotá-la de verdade,
// e a partir daí editar, desativar e (na Fase 2) marcar o que é obrigatório.
//
// REGRA: só entra aqui lista que faz sentido para QUALQUER cliente do módulo.
// Sugestão específica de um cliente é configuração dele, não padrão de fábrica —
// por isso Repasse e Registro não têm lista: os clientes que os usam já têm a
// deles cadastrada, e chegar sugerindo nome de documento por cima seria ruído.

const A1_DOCS_PADRAO = {
  PRE_ANALISE: ['RG / CNH', 'CPF', 'Comprovante de renda', 'Comprovante de residência',
                'Certidão de estado civil', 'Extrato FGTS', 'Carteira de trabalho',
                'Imposto de renda', 'Outro'],
};

// A lista padrão do módulo, ou [] quando ele não tem uma. Quem chama usa o
// tamanho para decidir se o botão "Usar lista padrão" faz sentido ali.
function a1DocsPadrao(modulo){
  const l = A1_DOCS_PADRAO[modulo];
  return Array.isArray(l) ? l.slice() : [];
}
