// ─── ESLint ──────────────────────────────────────────────────────────────────
//
// O código das telas ainda é script clássico (ver docs/ARQUITETURA.md): as
// funções de um arquivo são usadas por outro e pelos onclick do HTML, sem
// import. Por isso `no-undef` e `no-unused-vars` ficam desligados em src/ por
// enquanto — com eles, cada global compartilhado viraria um falso erro. Eles
// passam a valer na fase 3, quando os arquivos virarem módulos ES.
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
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.browser } },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',          // globais repetidos entre telas: fase 2
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 23 escapes desnecessários em regex antigas ([:\-], \/ dentro de classe).
      // Inofensivos; ficam como aviso para não mexer em regex de produção por estilo.
      'no-useless-escape': 'warn'
    }
  },
  {
    files: ['testes/**/*.js', 'tools/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest', sourceType: 'commonjs',
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
