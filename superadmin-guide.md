# ALPHA ONE — Superadmin Guide

You are the sole superadmin. All superadmin operations use the **Service Role Key**,
which bypasses RLS entirely. Never expose this key to tenant users.

## 1. Your Admin Panel Config

```javascript
// admin-panel/config.js
const A1_URL      = 'https://YOUR_PROJECT.supabase.co';
const SERVICE_KEY = 'YOUR_SERVICE_ROLE_KEY'; // NEVER in frontend code

const ADMIN_H = {
  'Content-Type': 'application/json',
  'apikey':       SERVICE_KEY,
  'Authorization':'Bearer ' + SERVICE_KEY
  // No x-session-token needed — service role bypasses RLS
};
```

## 2. Create a New Tenant (Client Onboarding)

```javascript
async function createTenant({ name, slug, email, cnpj, phone, plan = 'starter' }) {
  // 1. Create tenant
  const tenantRes = await fetch(`${A1_URL}/rest/v1/a1_tenants`, {
    method: 'POST',
    headers: { ...ADMIN_H, 'Prefer': 'return=representation' },
    body: JSON.stringify({ name, slug, email, cnpj, phone, plan_key: plan })
  });
  const [tenant] = await tenantRes.json();

  // 2. Create owner user
  const hash = await hashPassword('senhaTemporaria123'); // send via email
  await fetch(`${A1_URL}/rest/v1/a1_users`, {
    method: 'POST',
    headers: ADMIN_H,
    body: JSON.stringify({
      tenant_id:     tenant.id,
      name:          'Administrador',
      cpf:           '00000000000', // client will update
      password_hash: hash,
      role:          'owner'
    })
  });

  return tenant;
}
```

## 3. Unlock a Module for a Tenant

```javascript
async function unlockModule(tenantId, moduleKey, expiresAt = null) {
  return fetch(`${A1_URL}/rest/v1/a1_tenant_modules`, {
    method: 'POST',
    headers: { ...ADMIN_H, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
      tenant_id:    tenantId,
      module_key:   moduleKey,
      unlocked_by:  'superadmin@alphaone.com.br',
      expires_at:   expiresAt   // null = permanent, or ISO date string
    })
  });
}

// Example: unlock 'registro' for 30 days
const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
await unlockModule('tenant-uuid-here', 'registro', expires);
```

## 4. Lock a Module (Relock)

```javascript
async function lockModule(tenantId, moduleKey) {
  return fetch(
    `${A1_URL}/rest/v1/a1_tenant_modules?tenant_id=eq.${tenantId}&module_key=eq.${moduleKey}`,
    { method: 'DELETE', headers: ADMIN_H }
  );
}
```

## 5. Change User Limit for a Tenant

```javascript
async function setUserLimit(tenantId, maxUsers) {
  return fetch(`${A1_URL}/rest/v1/a1_tenants?id=eq.${tenantId}`, {
    method: 'PATCH',
    headers: ADMIN_H,
    body: JSON.stringify({ max_users: maxUsers })
  });
}

// Starter → Pro upgrade: set to 10
await setUserLimit('tenant-uuid', 10);
```

## 6. Change Tenant Plan

```javascript
async function upgradePlan(tenantId, newPlanKey) {
  return fetch(`${A1_URL}/rest/v1/a1_tenants?id=eq.${tenantId}`, {
    method: 'PATCH',
    headers: ADMIN_H,
    body: JSON.stringify({
      plan_key:  newPlanKey,
      max_users: { starter: 3, pro: 10, enterprise: 30 }[newPlanKey],
      status:    'active'
    })
  });
}
```

## 7. Suspend / Reactivate a Tenant

```javascript
async function suspendTenant(tenantId) {
  return fetch(`${A1_URL}/rest/v1/a1_tenants?id=eq.${tenantId}`, {
    method: 'PATCH',
    headers: ADMIN_H,
    body: JSON.stringify({ status: 'suspended' })
  });
}

async function reactivateTenant(tenantId) {
  return fetch(`${A1_URL}/rest/v1/a1_tenants?id=eq.${tenantId}`, {
    method: 'PATCH',
    headers: ADMIN_H,
    body: JSON.stringify({ status: 'active' })
  });
}
```

## 8. List All Tenants

```javascript
async function listTenants() {
  return fetch(
    `${A1_URL}/rest/v1/a1_tenants?order=created_at.desc&select=*,a1_tenant_modules(module_key)`,
    { headers: ADMIN_H }
  ).then(r => r.json());
}
```

## 9. Password Hash Utility

All password hashes use SHA-256 of `password + '::a1'`:

```javascript
async function hashPassword(plain) {
  const enc = new TextEncoder().encode(plain + '::a1');
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

## 10. Simultaneous User Enforcement

The `max_users` limit is enforced at **user creation time** via `a1_can_add_user()`.
Active sessions beyond the limit are NOT forcibly terminated (soft limit).

To enforce hard simultaneous session limits, add a trigger on `a1_sessions`
that counts active sessions per tenant and raises an exception if exceeded.
This is optional — the current design limits seats (created users), not sessions.

## 11. Trial → Active Transition

Tenants on trial can still use all plan modules. When `trial_ends_at` passes
and `status` is still `'trial'`, optionally run a cron or Edge Function:

```sql
-- Supabase Edge Function or pg_cron job:
UPDATE a1_tenants
SET    status = 'suspended'
WHERE  status = 'trial'
  AND  trial_ends_at < NOW();
```

## 12. Module Lock Summary

| Source         | Where stored            | Who writes          |
|----------------|-------------------------|---------------------|
| Plan entitlement | `a1_plan_modules`     | Seeded by you       |
| Manual unlock  | `a1_tenant_modules`     | You via service key |
| Check          | `a1_has_module(key)`    | Called by frontend  |

A module is accessible if EITHER condition is true:
1. The tenant's plan includes the module (`a1_plan_modules`)
2. You manually unlocked it (`a1_tenant_modules`) and it hasn't expired
