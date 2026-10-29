// ─── O que o HTML alcança ────────────────────────────────────────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// Num módulo ES nada é global: o que um arquivo declara só é visto por quem o
// importa. Mas o HTML ainda chama funções pelo nome (onclick="abrirCaso(...)"),
// e o navegador procura esse nome no escopo global. Antes, TUDO era global:
// cada função de cada arquivo, milhares de nomes que qualquer script podia
// sobrescrever sem aviso. Agora cada módulo diz, numa lista explícita, o que o
// HTML (e a suíte de testes) pode chamar; o resto é privado.
//
// A lista encolhe à medida que os handlers viram eventos (data-acao com
// delegação, fase 3b da reestruturação).

/**
 * Funções chamáveis pelo HTML. Pode ser chamada no topo do módulo: declarações
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
