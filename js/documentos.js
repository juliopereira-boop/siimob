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

// ─── Documento obrigatório ───────────────────────────────────────────────────
//
// O gestor marca o tipo como obrigatório em Configurações › Tipos de documento.
// A partir daí o processo não avança sem ele — a tela avisa, e o banco tranca
// (a1_docs_obrigatorios / trg_a1_cases_guarda_documento / a1_pa_transicionar).
//
// A leitura aqui é a MESMA do SQL, e de propósito: `active` só desliga com o
// texto 'false' (é como o front sempre leu), e `obrigatorio` só obriga com o
// texto 'true'. Na dúvida, NÃO obriga — valor esquisito gravado por tela antiga
// não pode travar a esteira de quem nunca pediu esta regra.
function a1DocsObrigatorios(tipos, modulo){
  return (Array.isArray(tipos) ? tipos : [])
    .filter(t => t && typeof t === 'object'
              && (t.module || 'repasse') === modulo
              && String(t.active) !== 'false'
              && String(t.obrigatorio) === 'true'
              && String(t.name || '').trim())
    .map(t => String(t.name).trim());
}

// Quais tipos obrigatórios ainda não têm documento. `entregues` é a lista de
// tipos já anexados, em texto — cada tela sabe de onde tira a sua.
function a1DocsFaltando(tipos, modulo, entregues){
  const tem = new Set((Array.isArray(entregues) ? entregues : [])
    .map(x => String(x || '').trim()).filter(Boolean));
  return a1DocsObrigatorios(tipos, modulo).filter(n => !tem.has(n));
}

// A frase que o gestor lê. Existe aqui, e não em cada tela, porque um aviso
// diferente em cada módulo faria a mesma regra parecer três regras.
function a1DocsAvisoFaltando(faltando){
  const l = Array.isArray(faltando) ? faltando : [];
  if (!l.length) return '';
  return l.length === 1
    ? `Falta o documento obrigatório: ${l[0]}. Anexe antes de mover o processo.`
    : `Faltam documentos obrigatórios: ${l.join(', ')}. Anexe antes de mover o processo.`;
}
