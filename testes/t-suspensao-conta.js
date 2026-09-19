// Regressao: suspender um tenant precisa bloquear login novo, sessao aberta,
// todas as telas protegidas, preservando somente o acesso do Superadmin.
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
const shell = le('js/modulo-shell.js');

checa('a identidade central aceita somente tenant ativo ou trial',
  /t\.status in \('active', 'trial'\)/.test(sql));
checa('suspender revoga sessoes comuns e preserva suporte',
  /where tenant_id = new\.id and origem is distinct from 'suporte'/.test(sql));
checa('suspender limpa a presenca do tenant',
  /delete from public\.a1_presence where tenant_id = new\.id/.test(sql));
checa('migration revoga sessoes de contas que ja estavam suspensas',
  /delete from public\.a1_sessions s[\s\S]*t\.status in \('suspended', 'cancelled'\)/.test(sql));
checa('tenant bloqueado aceita somente sessao marcada como suporte',
  /new\.origem is distinct from 'suporte'/.test(sql));
checa('login de parceiro recusa suspended explicitamente',
  /v_tenant\.status='suspended'.*tenant_suspended/.test(sql));
checa('heartbeat consulta o status depois da sessao recusada',
  /a1MotivoSessaoEncerrada/.test(auth) && /conta_suspensa/.test(auth));
checa('frontend bloqueia tenant suspenso mesmo antes da migration',
  /a1TenantStatusAtual/.test(auth)
  && /status !== 'suspended' && status !== 'cancelled'/.test(auth));
checa('Superadmin confirma que o PATCH realmente suspendeu',
  /alterados\[0\]\.status !== 'suspended'/.test(sa));
checa('Superadmin continua podendo acessar conta suspensa',
  /Acessar em modo suporte — cliente suspenso/.test(sa)
  && !/Reative a conta antes de acessar/.test(sa));
checa('sessao do Superadmin preserva o status suspenso',
  /TENANTS\.find\(t => t\.id === tenantId\)[\s\S]*\.status \|\| 'active'/.test(sa));
checa('shell mostra etiqueta Suspensa apenas no suporte',
  /suporteEmContaSuspensa/.test(shell) && />Suspensa<\/span>/.test(shell));
checa('cliente recebe aviso CONTA SUSPENSA',
  /CONTA SUSPENSA/.test(le('login.html')));

for (const tela of ['geral.html', 'tenant-admin.html', 'workflow.html']) {
  checa(`${tela} vigia a validade da sessao`, /a1StartHeartbeat\(/.test(le(tela)));
}

console.log(`\n${bad ? '>>> FALHAS: ' + bad : '>>> tudo passou'}  (${ok} verificações ok)`);
process.exit(bad ? 1 : 0);
