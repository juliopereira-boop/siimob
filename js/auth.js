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

  // ── Limite de ACESSOS SIMULTÂNEOS (max_users do tenant) ──
  // O cadastro de usuários é ilimitado; o que o plano limita é quantos
  // podem estar online ao mesmo tempo. Conta a presença (heartbeat) ativa.
  const _max = parseInt(data.max_users) || 0;
  if (_max > 0) {
    const _key = `${data.tenant_id}::${data.user_id}`;
    const _active = await a1ActiveCount(data.tenant_id, _key);
    if (_active >= _max) {
      await fetch(A1.rpc('a1_logout'), { method:'POST', headers:A1.headers(), body:JSON.stringify({}) }).catch(()=>{});
      localStorage.removeItem('a1_token'); localStorage.removeItem('a1_slug');
      throw new Error(`Limite de ${_max} acesso(s) simultâneo(s) atingido. Aguarde alguém sair e tente novamente.`);
    }
  }

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

  // ── Limite de ACESSOS SIMULTÂNEOS (max_users do tenant) ──
  const _trow = await fetch(`${A1.rest('a1_tenants')}?id=eq.${data.tenant_id}&select=max_users`, { headers: A1.headers() }).then(r=>r.json()).catch(()=>[]);
  const _max  = (Array.isArray(_trow) && _trow[0] && parseInt(_trow[0].max_users)) || 0;
  if (_max > 0) {
    const _key = `${data.tenant_id}::${data.partner_id}`;
    const _active = await a1ActiveCount(data.tenant_id, _key);
    if (_active >= _max) {
      await fetch(A1.rpc('a1_logout'), { method:'POST', headers:A1.headers(), body:JSON.stringify({}) }).catch(()=>{});
      localStorage.removeItem('a1_token'); localStorage.removeItem('a1_slug');
      throw new Error(`Limite de ${_max} acesso(s) simultâneo(s) atingido. Aguarde alguém sair e tente novamente.`);
    }
  }

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

// Module guard — redirects or shows locked screen
async function a1RequireModule(moduleKey) {
  if (sessionStorage.getItem('a1_sa_mode')) return; // SA impersonation bypasses module check
  const res = await fetch(A1.rpc('a1_has_module'), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({ p_module_key: moduleKey })
  });
  const ok = await res.json();

  if (!ok) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#94a3b8;font-family:system-ui">
        <div style="text-align:center">
          <div style="font-size:3rem;margin-bottom:1rem">🔒</div>
          <h2 style="color:#f1f5f9;margin:0 0 .5rem">Módulo bloqueado</h2>
          <p style="margin:0 0 1.5rem">Adquira este módulo para continuar.</p>
          <a href="/${A1.slug}/dashboard"
             style="color:#6366f1;text-decoration:none;border:1px solid #6366f1;padding:.5rem 1.25rem;border-radius:.5rem">
            Voltar ao painel
          </a>
        </div>
      </div>`;
    throw new Error('module_locked');
  }
}

// Conta usuários ONLINE (heartbeat nos últimos 90s) do tenant, excluindo a própria chave.
// Usado para impor o limite de acessos simultâneos no login.
async function a1ActiveCount(tenantId, excludeKey) {
  const since = new Date(Date.now() - 90_000).toISOString();
  const url = `${A1.rest('a1_presence')}?tenant_id=eq.${tenantId}&last_seen=gte.${encodeURIComponent(since)}&select=user_key`;
  const rows = await fetch(url, { headers: A1.headers() }).then(r => r.json()).catch(() => []);
  if (!Array.isArray(rows)) return 0;
  const keys = new Set(rows.map(r => r.user_key).filter(k => k && k !== excludeKey));
  return keys.size;
}

// Presence heartbeat
async function a1Heartbeat(moduleName) {
  const user = A1.user;
  if (!user || !A1.token) return;
  await fetch(A1.rest('a1_presence'), {
    method: 'POST',
    headers: A1.upsertHeaders(),
    body: JSON.stringify({
      user_key:  `${user.tenant_id}::${user.id}`,
      name:      user.name,
      role:      user.role,
      module:    moduleName,
      last_seen: new Date().toISOString()
    })
  }).catch(() => {});
}

function a1StartHeartbeat(moduleName) {
  a1Heartbeat(moduleName);
  return setInterval(() => a1Heartbeat(moduleName), 30_000);
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
