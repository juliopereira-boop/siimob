// As Edge Functions da Meta (meta-connect e meta-leads-webhook), testadas em
// Node com node:test (testes/meta/*.test.mjs). Este arquivo só as põe na suíte
// principal, para a CI reprovar o push se uma delas quebrar.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'meta');
const arquivos = fs
  .readdirSync(dir)
  .filter(f => f.endsWith('.test.mjs'))
  .map(f => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', ...arquivos], { encoding: 'utf8' });
const saida = (r.stdout || '') + (r.stderr || '');
const linha = k => (saida.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1];
console.log(`  testes: ${linha('tests')}  passaram: ${linha('pass')}  falharam: ${linha('fail')}`);
if (r.status !== 0) {
  console.log(
    saida
      .split('\n')
      .filter(l => /not ok|Error|assert/i.test(l))
      .slice(0, 20)
      .join('\n')
  );
  console.log('\n>>> FALHAS nas funções da Meta');
  process.exit(1);
}
console.log('\n>>> tudo passou');
