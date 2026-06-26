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
  if (data.error) throw new Error(data.error);

  localStorage.setItem('a1_token', data.token);
  localStorage.setItem('a1_slug',  slug);
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

  return data;
}

async function a1Logout() {
  try {
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
