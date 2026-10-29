// ─── ESLint ──────────────────────────────────────────────────────────────────
//
// O que está ligado é o que pega defeito de verdade (chave duplicada em objeto,
// case repetido, código inalcançável, comparação com NaN, typeof errado...).
// Regra com violação antiga está como aviso; erro reprova a CI.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'database/**', 'docs/**', 'test-results/**'] },
  js.configs.recommended,
  {
    // Desde a fase 3 cada arquivo de src/ é um módulo ES: o que usa de outro
    // arquivo vem por import, e o que o HTML chama passa por expor(). Por isso
    // no-undef está LIGADO: nome sem import é defeito, não "vem do global".
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, pdfjsLib: 'readonly' }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // escapes desnecessários em regex antigas ([:\-], \/ dentro de classe).
      // Inofensivos; ficam como aviso para não mexer em regex de produção por estilo.
      'no-useless-escape': 'warn'
    }
  },
  {
    files: ['testes/**/*.js', 'tools/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      // os testes mandam funções para dentro da página (page.evaluate), onde
      // window, document e os globais da tela existem
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } }
  }
];
