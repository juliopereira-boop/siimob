// ─── Financeiro: o que a tela empresta aos módulos da fase 2 ─────────────────
//
// A tela (src/pages/financeiro/main.js) preenche F no início com o estado (G),
// o acesso ao banco e os pedaços de interface (modal, tabela, selo...). Os
// módulos de carteira, conciliação e DRE usam F em tempo de execução, sem
// importar a tela (que é o ponto de entrada e não exporta nada).
export const F = /** @type {any} */ ({});

export const INDICES = /** @type {Record<string,string>} */ ({
  INCC: 'INCC-DI',
  INCCM: 'INCC-M',
  IGPM: 'IGP-M',
  IPCA: 'IPCA',
  INPC: 'INPC',
  NENHUM: 'Sem correção'
});

/** Mesmo dia, n meses depois (dia 31 vira o último dia do mês). */
export function somaMesData(/** @type {string} */ iso, /** @type {number} */ n) {
  const [a, m, d] = iso.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m + n, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + n, Math.min(d, ultimo))).toISOString().slice(0, 10);
}
