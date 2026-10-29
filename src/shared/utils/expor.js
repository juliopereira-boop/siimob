// ─── O que ainda vai para o window ───────────────────────────────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// Num módulo ES nada é global: o que um arquivo declara só é visto por quem o
// importa. Antes da reestruturação TUDO era global: cada função de cada
// arquivo, milhares de nomes que qualquer script podia sobrescrever sem aviso.
// O HTML já não precisa disso (as ações são declaradas em data-acao, ver
// src/shared/ui/acoes.js). O que sobra no window está numa lista explícita, no
// topo de cada módulo: o que a suíte de testes chama por dentro da página e o
// que outro módulo sonda com typeof.

/**
 * Funções alcançáveis pelo window. Pode ser chamada no topo do módulo: declarações
 * de função são içadas, então já existem antes de qualquer outra linha rodar.
 * @param {Record<string, Function>} funcoes
 */
export function expor(funcoes) {
  Object.assign(window, funcoes);
}

/**
 * Variável de módulo alcançável pelo HTML e pelos testes, sem cópia: o getter
 * lê o valor atual (uma cópia ficaria velha quando a variável fosse
 * reatribuída), e o setter, quando há, escreve na própria variável.
 * @param {string} nome
 * @param {() => unknown} ler
 * @param {(v: any) => void} [escrever]
 */
export function exporVariavel(nome, ler, escrever) {
  Object.defineProperty(window, nome, {
    get: ler,
    set: escrever || (() => {}),
    configurable: true,
    enumerable: true
  });
}
