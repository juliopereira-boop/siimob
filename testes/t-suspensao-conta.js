// Regressao: suspender um tenant precisa bloquear login novo, sessao aberta,
// acesso de suporte e todas as telas protegidas.
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const le = arq => fs.readFileSync(path.join(raiz, arq), 'utf8');

let ok = 0, bad = 0;
const checa = (nome, valor) => valor
  ? (ok++, console.log('  ✓ ' + nome))
  : (bad++, console.log('  ✗ ' + nome));

const sql = le('sql/2026-09-19_suspensao_conta_imediata.sql');
const auth = le('js/auth.js');
const sa = le('superadmin.html');

checa('a identidade central aceita somente tenant ativo ou trial',
  /t\.status in \('active', 'trial'\)/.test(sql));
checa('suspender revoga todas as sessoes do tenant',
  /delete from public\.a1_sessions where tenant_id = new\.id/.test(sql));
checa('suspender limpa a presenca do tenant',
  /delete from public\.a1_presence where tenant_id = new\.id/.test(sql));
checa('nem service role cria sessao para tenant bloqueado',
  /before insert on public\.a1_sessions/.test(sql));
checa('login de parceiro recusa suspended explicitamente',
  /v_tenant\.status='suspended'.*tenant_suspended/.test(sql));
checa('heartbeat consulta o status depois da sessao recusada',
  /a1MotivoSessaoEncerrada/.test(auth) && /conta_suspensa/.test(auth));
checa('Superadmin confirma que o PATCH realmente suspendeu',
  /alterados\[0\]\.status !== 'suspended'/.test(sa));
checa('Superadmin nao cria sessao de suporte em conta suspensa',
  (sa.match(/tenant\.status === 'suspended'/g) || []).length >= 2);
checa('botao Acessar fica desabilitado na conta suspensa',
  /Reative a conta antes de acessar/.test(sa));

for (const tela of ['geral.html', 'tenant-admin.html', 'workflow.html']) {
  checa(`${tela} vigia a validade da sessao`, /a1StartHeartbeat\(/.test(le(tela)));
}

console.log(`\n${bad ? '>>> FALHAS: ' + bad : '>>> tudo passou'}  (${ok} verificações ok)`);
process.exit(bad ? 1 : 0);
