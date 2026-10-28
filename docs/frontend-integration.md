# SIIMOB — Frontend Integration Guide

## 1. Constants (replace hardcoded values)

```javascript
// config.js — one file, imported everywhere
const A1_URL  = 'https://YOUR_PROJECT.supabase.co';
const A1_KEY  = 'YOUR_ANON_KEY'; // public anon key only

// After login, persist to localStorage
let SESSION_TOKEN = localStorage.getItem('a1_token') || null;
let TENANT_SLUG   = localStorage.getItem('a1_slug')  || null;
```

## 2. Request Headers

Every API call must include `x-session-token`. Replace the old pattern:

```javascript
// OLD (hardcoded, single-tenant)
const H = {
  'Content-Type': 'application/json',
  'apikey': KEY,
  'Authorization': 'Bearer ' + KEY
};

// NEW (multi-tenant, session-based)
function headers() {
  return {
    'Content-Type':    'application/json',
    'apikey':          A1_KEY,
    'Authorization':   'Bearer ' + A1_KEY,
    'x-session-token': SESSION_TOKEN  // RLS reads this to scope all queries
  };
}
```

## 3. Login Flow

```javascript
async function login(tenantSlug, cpf, password) {
  const res = await fetch(`${A1_URL}/rest/v1/rpc/a1_login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':       A1_KEY,
      'Authorization':'Bearer ' + A1_KEY
    },
    body: JSON.stringify({
      p_tenant_slug: tenantSlug,
      p_cpf:         cpf.replace(/\D/g, ''),
      p_password:    password
    })
  });

  const data = await res.json();

  if (data.error) {
    // 'tenant_not_found' | 'tenant_suspended' | 'invalid_credentials'
    throw new Error(data.error);
  }

  // Persist session
  SESSION_TOKEN = data.token;
  localStorage.setItem('a1_token', data.token);
  localStorage.setItem('a1_slug',  tenantSlug);
  localStorage.setItem('a1_user',  JSON.stringify({
    id:    data.user_id,
    name:  data.name,
    role:  data.role,
    plan:  data.plan
  }));

  return data;
}
```

## 4. Password Hashing (frontend utility)

When creating or changing passwords via the admin panel, hash before sending:

```javascript
async function hashPassword(plain) {
  const enc  = new TextEncoder().encode(plain + '::a1');
  const buf  = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Example: create a user
async function createUser(name, cpf, password, role) {
  const canAdd = await fetch(`${A1_URL}/rest/v1/rpc/a1_can_add_user`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({})
  }).then(r => r.json());

  if (!canAdd) throw new Error('user_limit_reached');

  const hash = await hashPassword(password);

  return fetch(`${A1_URL}/rest/v1/a1_users`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ name, cpf: cpf.replace(/\D/g,''), password_hash: hash, role })
  });
}
```

## 5. Module Guard

Before rendering a module page, check access:

```javascript
async function assertModule(moduleKey) {
  const res  = await fetch(`${A1_URL}/rest/v1/rpc/a1_has_module`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_module_key: moduleKey })
  });
  const ok = await res.json();
  if (!ok) {
    document.body.innerHTML = `
      <div class="locked-screen">
        <h2>Módulo bloqueado</h2>
        <p>Contate o administrador para liberar o acesso.</p>
      </div>`;
    throw new Error('module_locked');
  }
}

// At top of repasse.html:
await assertModule('repasse');

// At top of registro.html:
await assertModule('registro');
```

## 6. Presence (online users)

```javascript
const user = JSON.parse(localStorage.getItem('a1_user'));

async function heartbeat(moduleName) {
  await fetch(`${A1_URL}/rest/v1/a1_presence`, {
    method: 'POST',
    headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
      user_key:  `${localStorage.getItem('a1_slug')}::${user.id}`,
      name:      user.name,
      role:      user.role,
      module:    moduleName,
      last_seen: new Date().toISOString()
    })
  });
}

// Call every 30s and on page load
heartbeat('repasse');
setInterval(() => heartbeat('repasse'), 30_000);

// Read who's online (last 2 min)
async function getOnlineUsers() {
  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  return fetch(
    `${A1_URL}/rest/v1/a1_presence?last_seen=gte.${since}`,
    { headers: headers() }
  ).then(r => r.json());
}
```

## 7. Logout

```javascript
async function logout() {
  await fetch(`${A1_URL}/rest/v1/rpc/a1_logout`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({})
  });
  localStorage.clear();
  window.location.href = '/login.html';
}
```

## 8. Repasse — Loading Cases

```javascript
// Replace repasse2_cards queries:
async function loadCases(stageId) {
  const url = stageId
    ? `${A1_URL}/rest/v1/a1_cases?module_key=eq.repasse&stage_id=eq.${stageId}&order=updated_at.desc`
    : `${A1_URL}/rest/v1/a1_cases?module_key=eq.repasse&order=updated_at.desc`;

  return fetch(url, { headers: headers() }).then(r => r.json());
}
```

## 9. Registro — Loading Cases

```javascript
async function loadContratos(stageId) {
  const url = stageId
    ? `${A1_URL}/rest/v1/a1_cases?module_key=eq.registro&stage_id=eq.${stageId}&order=updated_at.desc`
    : `${A1_URL}/rest/v1/a1_cases?module_key=eq.registro&order=updated_at.desc`;

  return fetch(url, { headers: headers() }).then(r => r.json());
}
```

## 10. PDF Extra Data (payload JSONB)

The `payload` field on `a1_cases` stores all module-specific data parsed from PDFs:

```javascript
// Repasse: store parsed proposal data
const casePayload = {
  valor_avaliacao:  parsedPdf.valorAvaliacao,
  banco:            parsedPdf.banco,
  tipo_financiamento: parsedPdf.tipo,
  fluxo_parcelas:   parsedFluxo,
  // ... any other fields from parseProposta / parseFluxo
};

await fetch(`${A1_URL}/rest/v1/a1_cases`, {
  method: 'POST',
  headers: headers(),
  body: JSON.stringify({
    module_key:   'repasse',
    client_name:  parsedPdf.nomeCliente,
    client_cpf:   parsedPdf.cpf,
    development:  parsedPdf.empreendimento,
    block:        parsedPdf.bloco,
    unit:         parsedPdf.unidade,
    payload:      casePayload
  })
});
```
