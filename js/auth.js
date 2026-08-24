// ─── auth.js — depends on config.js ─────────────────────────────────────────

async function hashPassword(plain) {
  const enc = new TextEncoder().encode(plain + '::a1');
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Login: returns session object or throws
async function a1Login(slug, cpf, password) {
  a1ClearModuleCache();
  const res = await fetch(A1.rpc('a1_login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':       A1_KEY,
      'Authorization':`Bearer ${A1_KEY}`
    },
    body: JSON.stringify({
      p_tenant_slug: slug,
      p_cpf:         cpf.replace(/\D/g, ''),
      p_password:    password
    })
  });

  const data = await res.json();
  if (data.error) {
    if (data.error === 'max_concurrent') {
      throw new Error(`Limite de ${data.limit || ''} acesso(s) simultâneo(s) atingido. Aguarde alguém sair e tente novamente.`);
    }
    const msgs = {
      tenant_not_found:   'Empresa não encontrada.',
      tenant_suspended:   'Conta suspensa. Contate o suporte.',
      tenant_cancelled:   'Conta cancelada.',
      invalid_credentials:'CPF ou senha incorretos.'
    };
    throw new Error(msgs[data.error] || data.error);
  }

  localStorage.setItem('a1_token', data.token);
  localStorage.setItem('a1_slug',  slug);

  // O limite de acessos simultâneos é decidido pelo servidor, dentro de
  // a1_login (erro 'max_concurrent', tratado acima). A conferência que existia
  // aqui contava a tabela de presença — escrita pelo próprio navegador — e por
  // isso não segurava nada; além de poder barrar quem tinha direito à vaga.

  localStorage.setItem('a1_user',  JSON.stringify({
    id:    data.user_id,
    name:  data.name,
    role:  data.role,
    plan:  data.plan,
    max_users: data.max_users,
    status:    data.status,
    trial_ends_at: data.trial_ends_at,
    tenant_id: data.tenant_id,
    tenant_name: data.tenant_name
  }));

  a1Heartbeat(null); // reserva o slot imediatamente
  return data;
}

// Partner login (external brokers/dispatchers)
async function a1PartnerLogin(slug, cpf, password) {
  a1ClearModuleCache();
  const res = await fetch(A1.rpc('a1_partner_login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':       A1_KEY,
      'Authorization':`Bearer ${A1_KEY}`
    },
    body: JSON.stringify({
      p_tenant_slug: slug,
      p_cpf:         cpf.replace(/\D/g, ''),
      p_password:    password
    })
  });

  const data = await res.json();
  if (data.error) {
    if (data.error === 'max_concurrent') {
      throw new Error(`Limite de ${data.limit || ''} acesso(s) simultâneo(s) atingido. Aguarde alguém sair e tente novamente.`);
    }
    throw new Error(data.error);
  }

  localStorage.setItem('a1_token', data.token);
  localStorage.setItem('a1_slug',  slug);

  // Idem: o teto de acessos simultâneos é imposto pelo servidor em
  // a1_partner_login, que devolve 'max_concurrent' quando não há vaga.

  localStorage.setItem('a1_user',  JSON.stringify({
    id:          data.partner_id,
    name:        data.name,
    role:        'partner',
    type:        data.type,
    permissions: data.permissions,
    developments:data.developments,
    region:      data.region,
    tenant_id:   data.tenant_id
  }));

  a1Heartbeat(null); // reserva o slot imediatamente
  return data;
}

async function a1Logout() {
  try {
    // libera o slot de acesso simultâneo imediatamente
    const u = A1.user;
    if (u && u.tenant_id && u.id) {
      await fetch(`${A1.rest('a1_presence')}?user_key=eq.${encodeURIComponent(`${u.tenant_id}::${u.id}`)}`, {
        method: 'DELETE', headers: A1.headers()
      }).catch(() => {});
    }
    await fetch(A1.rpc('a1_logout'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({})
    });
  } finally {
    a1ClearModuleCache();
    localStorage.removeItem('a1_token');
    localStorage.removeItem('a1_slug');
    localStorage.removeItem('a1_user');
    const slug = A1.slug || '';
    window.location.href = slug ? `/${slug}/login` : '/';
  }
}

// Call at top of every protected page
// redirects to login if no valid session; returns user object
function a1RequireAuth(allowedRoles = null) {
  const token = A1.token;
  const user  = A1.user;
  const slug  = A1.slug;

  if (!token || !user) {
    window.location.href = slug ? `/${slug}/login` : '/';
    throw new Error('not_authenticated');
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    window.location.href = slug ? `/${slug}/dashboard` : '/';
    throw new Error('insufficient_role');
  }

  return user;
}

// Recarrega as permissões do parceiro direto do banco.
// As permissões guardadas em localStorage são um RETRATO DO MOMENTO DO LOGIN.
// Se o gestor alterar as permissões (ex.: marcar "Gerente") enquanto o usuário
// está logado, ele continuava com as permissões antigas até deslogar e logar de
// novo — na prática, o gestor liberava o acesso e o usuário seguia bloqueado.
// Chamado no boot de cada página: agora basta atualizar a página (F5).
// Vale para QUALQUER parceiro; a versão anterior só atualizava type==='cca'.
async function a1RefreshPartnerPerms() {
  const u = A1.user;
  if (!u || u.role !== 'partner' || !u.id) return null;
  try {
    const res = await fetch(
      `${A1.rest('a1_partners')}?id=eq.${u.id}&select=permissions,type`,
      { headers: A1.headers() }
    );
    if (!res.ok) return null;                     // servidor fora: mantém o que já tem
    const row = (await res.json())[0];
    if (!row || !row.permissions) return null;
    u.permissions = row.permissions;
    if (row.type) u.type = row.type;
    try { localStorage.setItem('a1_user', JSON.stringify(u)); } catch {}
    return u.permissions;
  } catch { return null; }                        // erro de rede: mantém o que já tem
}

// Cache de módulos por sessão — evita 1 round-trip a cada página/navegação.
// É limpo no login/logout para refletir mudanças de plano/liberação.
const _a1ModMemo = {};
// Prefixo v2: invalida de uma vez as entradas "não liberado" que ficaram
// gravadas por engano nos navegadores (ver a1HasModule). Sem isso, quem já
// tinha o cache envenenado continuaria trancado até limpar o navegador.
const _A1_MOD_PREFIX = 'a1_mod2_';
function a1ClearModuleCache() {
  for (const k in _a1ModMemo) delete _a1ModMemo[k];
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && (key.indexOf(_A1_MOD_PREFIX) === 0 || key.indexOf('a1_mod_') === 0)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {}
}

// Verifica se o tenant possui um módulo (RPC a1_has_module).
// Retorna true | false | null — null = o servidor NÃO respondeu (rede/instabilidade).
// Distinguir "o servidor disse que não" de "não consegui perguntar" é essencial:
// tratar os dois como false trancava o cliente fora do sistema por uma falha
// passageira. Só resultado POSITIVO é persistido; negativo fica só em memória
// (revalidado no próximo carregamento, que é barato).
async function a1HasModule(moduleKey) {
  const ck = `${A1.slug || ''}:${moduleKey}`;
  if (ck in _a1ModMemo) return _a1ModMemo[ck];
  try {
    if (sessionStorage.getItem(_A1_MOD_PREFIX + ck) === '1') { _a1ModMemo[ck] = true; return true; }
  } catch {}
  try {
    const res = await fetch(A1.rpc('a1_has_module'), {
      method: 'POST', headers: A1.headers(), body: JSON.stringify({ p_module_key: moduleKey })
    });
    if (!res.ok) return null; // servidor indisponível — indeterminado, não cacheia
    const v = (await res.json()) === true;
    _a1ModMemo[ck] = v;
    if (v) { try { sessionStorage.setItem(_A1_MOD_PREFIX + ck, '1'); } catch {} }
    return v;
  } catch { return null; } // erro de rede — indeterminado, não cacheia
}

// Resolve a "home" do cliente: o primeiro módulo que ele realmente possui.
// Ordem de preferência — CRM (início da jornada) antes de repasse/registro.
// As sondagens rodam em paralelo (memoizadas) para não empilhar round-trips.
async function a1ModuleHome() {
  const slug = A1.slug || '';
  const order = ['crm', 'repasse', 'registro'];
  const have = await Promise.all(order.map(m => a1HasModule(m)));
  const idx = have.findIndex(v => v === true);
  return idx >= 0 ? `/${slug}/${order[idx]}` : `/${slug}/repasse`;
}

// Module guard — se o cliente não tem o módulo, redireciona para o módulo que ele
// possui (ex.: imobiliária cai no /crm em vez de ver o repasse). Só mostra a tela
// bloqueada quando o cliente não tem nenhum módulo.
async function a1RequireModule(moduleKey) {
  if (sessionStorage.getItem('a1_sa_mode')) return; // SA impersonation bypasses module check
  const has = await a1HasModule(moduleKey);
  if (has === true) return;
  // Indeterminado (servidor fora do ar): libera a passagem em vez de trancar o
  // cliente fora. O acesso real aos dados continua protegido por RLS no banco.
  if (has === null) return;

  const home = await a1ModuleHome();
  const here = window.location.pathname.replace(/\/$/, '');
  if (home && !here.endsWith(home)) {
    window.location.href = home;
    throw new Error('redirecting_to_home');
  }

  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#94a3b8;font-family:system-ui">
      <div style="text-align:center">
        <div style="font-size:3rem;margin-bottom:1rem">🔒</div>
        <h2 style="color:#f1f5f9;margin:0 0 .5rem">Nenhum módulo liberado</h2>
        <p style="margin:0 0 1.5rem">Contate o administrador para liberar um módulo.</p>
        <button onclick="a1Logout()" style="color:#6366f1;background:none;cursor:pointer;border:1px solid #6366f1;padding:.5rem 1.25rem;border-radius:.5rem">Sair</button>
      </div>
    </div>`;
  throw new Error('module_locked');
}

// OBSOLETA para controle de cota. O limite de acessos simultâneos passou a ser
// imposto DENTRO de a1_login/a1_partner_login, sobre a tabela de sessões — que o
// navegador não alcança. Contar por a1_presence era furável: essa tabela é
// escrita pelo próprio cliente, então bastava não bater (ou apagar a linha) para
// sumir da contagem. Mantida apenas para exibição de "quem está online".
async function a1ActiveCount(tenantId, excludeKey) {
  const since = new Date(Date.now() - 90_000).toISOString();
  const url = `${A1.rest('a1_presence')}?tenant_id=eq.${tenantId}&last_seen=gte.${encodeURIComponent(since)}&select=user_key`;
  const rows = await fetch(url, { headers: A1.headers() }).then(r => r.json()).catch(() => []);
  if (!Array.isArray(rows)) return 0;
  const keys = new Set(rows.map(r => r.user_key).filter(k => k && k !== excludeKey));
  return keys.size;
}

// Confirma no servidor que esta sessão ainda é a sessão válida daquele login.
// FALSE = a conta entrou em outro aparelho (sessão única) ou a vaga foi perdida:
// o servidor já encerrou a sessão e o usuário precisa entrar de novo.
// Falha de rede NÃO derruba ninguém — só a recusa explícita do servidor.
async function a1TouchSession() {
  if (!A1.token) return true;
  try {
    const res = await fetch(A1.rpc('a1_touch_session'), {
      method: 'POST', headers: A1.headers(), body: JSON.stringify({})
    });
    if (!res.ok) return true;
    return (await res.json()) !== false;
  } catch { return true; }
}

// Encerra a sessão local e manda para o login explicando o motivo.
function a1SessionEnded(motivo) {
  const slug = A1.slug || '';
  a1ClearModuleCache();
  ['a1_token','a1_user','a1_slug'].forEach(k => { try { localStorage.removeItem(k); } catch {} });
  window.location.href = (slug ? `/${slug}/login` : '/') + '?motivo=' + encodeURIComponent(motivo || 'encerrada');
}

// Presence heartbeat. Retorna true/false (sucesso) — usado por a1StartHeartbeat
// para parar de tentar quando a sessão está claramente inválida/expirada.
async function a1Heartbeat(moduleName) {
  const user = A1.user;
  if (!user || !A1.token) return true; // nada a fazer, não é falha
  try {
    const res = await fetch(A1.rest('a1_presence'), {
      method: 'POST',
      headers: A1.upsertHeaders(),
      body: JSON.stringify({
        user_key:  `${user.tenant_id}::${user.id}`,
        name:      user.name,
        role:      user.role,
        module:    moduleName,
        last_seen: new Date().toISOString()
      })
    });
    return res.ok;
  } catch { return false; }
}

// Sessão expirada (7 dias) = toda tentativa de heartbeat falha por RLS. Sem este
// limite, o setInterval martelava o banco a cada 50s PARA SEMPRE em qualquer aba
// esquecida aberta com sessão vencida — carga contínua e crescente, sem retorno
// nenhum. Após 3 falhas seguidas (~2.5min), para de tentar.
function a1StartHeartbeat(moduleName) {
  let fails = 0, id = null;
  const bater = async () => {
    // Se outra pessoa entrou com este mesmo login, o servidor já encerrou esta
    // sessão: quem estava logado cai aqui, em até um ciclo (~50s).
    if (!(await a1TouchSession())) {
      if (id) clearInterval(id);
      a1SessionEnded('outro_acesso');
      return;
    }
    const ok = await a1Heartbeat(moduleName);
    if (ok) { fails = 0; return; }
    if (++fails >= 3 && id) clearInterval(id);
  };
  id = setInterval(bater, 50_000);
  bater();
  return id;
}

// User creation with limit check
async function a1CreateUser({ name, cpf, password, role = 'user', email = '' }) {
  const canAdd = await fetch(A1.rpc('a1_can_add_user'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({})
  }).then(r => r.json());

  if (!canAdd) throw new Error('Limite de usuários atingido. Contrate mais slots.');

  const password_hash = await hashPassword(password);

  const res = await fetch(A1.rest('a1_users'), {
    method: 'POST',
    headers: A1.returnHeaders(),
    body: JSON.stringify({
      name, email,
      cpf:           cpf.replace(/\D/g, ''),
      password_hash,
      role
    })
  });

  if (!res.ok) {
    const err = await res.json();
    const msg = err?.message || '';
    if (msg.includes('unique')) throw new Error('Já existe um usuário com este CPF.');
    throw new Error('Erro ao criar usuário.');
  }

  return res.json();
}
