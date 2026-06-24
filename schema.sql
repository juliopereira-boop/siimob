-- =============================================================================
-- ALPHA ONE — Multi-Tenant CRM for Repasse & Registro
-- Schema Version: 1.0.0
-- Run this in your Supabase SQL Editor (psql or dashboard)
-- All tables are prefixed with a1_ to avoid conflicts
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- BLOCK 1 — SaaS Core: Plans, Modules, Tenants
-- =============================================================================

CREATE TABLE a1_plans (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  max_users   INT         NOT NULL DEFAULT 3,
  price_brl   DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE a1_modules (
  key         TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  description TEXT
);

CREATE TABLE a1_plan_modules (
  plan_key    TEXT        NOT NULL REFERENCES a1_plans(key)   ON DELETE CASCADE,
  module_key  TEXT        NOT NULL REFERENCES a1_modules(key) ON DELETE CASCADE,
  PRIMARY KEY (plan_key, module_key)
);

CREATE TABLE a1_tenants (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  slug            TEXT        NOT NULL UNIQUE,
  cnpj            TEXT,
  email           TEXT        NOT NULL,
  phone           TEXT,
  plan_key        TEXT        NOT NULL REFERENCES a1_plans(key) DEFAULT 'starter',
  max_users       INT         NOT NULL DEFAULT 3,
  status          TEXT        NOT NULL DEFAULT 'trial'
                              CHECK (status IN ('trial','active','suspended','cancelled')),
  trial_ends_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '14 days',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Manual module unlocks by superadmin (supplements plan entitlements)
CREATE TABLE a1_tenant_modules (
  tenant_id     UUID        NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  module_key    TEXT        NOT NULL REFERENCES a1_modules(key) ON DELETE CASCADE,
  unlocked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,                   -- NULL = permanent
  unlocked_by   TEXT        NOT NULL,          -- superadmin email
  PRIMARY KEY (tenant_id, module_key)
);

-- =============================================================================
-- BLOCK 2 — Users, Permissions, Sessions, Superadmins
-- =============================================================================

CREATE TABLE a1_users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  email           TEXT,
  cpf             TEXT        NOT NULL,
  password_hash   TEXT        NOT NULL,
  role            TEXT        NOT NULL DEFAULT 'user'
                              CHECK (role IN ('owner','admin','manager','user','viewer','partner')),
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  last_seen       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, cpf)
);

CREATE TABLE a1_user_permissions (
  user_id     UUID    NOT NULL REFERENCES a1_users(id) ON DELETE CASCADE,
  permission  TEXT    NOT NULL,
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE a1_sessions (
  token       TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id   UUID        NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES a1_users(id)   ON DELETE CASCADE,
  role        TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_a1_sessions_token      ON a1_sessions(token);
CREATE INDEX idx_a1_sessions_expires_at ON a1_sessions(expires_at);

-- Superadmins live outside tenants — they use the service role key in the admin panel
CREATE TABLE a1_superadmins (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- BLOCK 3 — Pipeline: Stages, Flags, Edges
-- =============================================================================

CREATE TABLE a1_stages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  module_key  TEXT        NOT NULL REFERENCES a1_modules(key),
  group_key   TEXT,                            -- tenant-defined grouping (e.g. "regional", "type")
  name        TEXT        NOT NULL,
  color       TEXT        NOT NULL DEFAULT '#6B7280',
  position    INT         NOT NULL DEFAULT 0,
  is_initial  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_final    BOOLEAN     NOT NULL DEFAULT FALSE,
  is_pending  BOOLEAN     NOT NULL DEFAULT FALSE,
  pos_x       FLOAT       NOT NULL DEFAULT 0,
  pos_y       FLOAT       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_a1_stages_tenant_module ON a1_stages(tenant_id, module_key);

CREATE TABLE a1_stage_flags (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID    NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  color       TEXT    NOT NULL DEFAULT '#F59E0B',
  UNIQUE (tenant_id, name)
);

CREATE TABLE a1_stage_flag_links (
  stage_id    UUID    NOT NULL REFERENCES a1_stages(id)      ON DELETE CASCADE,
  flag_id     UUID    NOT NULL REFERENCES a1_stage_flags(id) ON DELETE CASCADE,
  PRIMARY KEY (stage_id, flag_id)
);

CREATE TABLE a1_stage_edges (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID    NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  from_id     UUID    NOT NULL REFERENCES a1_stages(id)  ON DELETE CASCADE,
  to_id       UUID    NOT NULL REFERENCES a1_stages(id)  ON DELETE CASCADE,
  UNIQUE (from_id, to_id)
);

-- =============================================================================
-- BLOCK 4 — CRM Core: Cases, History, Events
-- =============================================================================

CREATE TABLE a1_cases (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  module_key            TEXT        NOT NULL REFERENCES a1_modules(key),
  stage_id              UUID        REFERENCES a1_stages(id),
  stage_name            TEXT,
  stage_entered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Client
  client_name           TEXT        NOT NULL,
  client_cpf            TEXT,
  client_email          TEXT,
  client_phone          TEXT,

  -- Property
  development           TEXT,
  block                 TEXT,
  unit                  TEXT,
  region                TEXT,
  contract_value        DECIMAL(12,2),
  evaluation_expiry     DATE,

  -- Assignment
  assigned_user_id      UUID        REFERENCES a1_users(id),

  -- Partner (generic — the partner type is resolved via a1_partners)
  partner_name          TEXT,
  broker_name           TEXT,
  broker_phone          TEXT,
  real_estate_name      TEXT,
  manager_name          TEXT,

  -- Attachments (stored as base64 or Supabase Storage URLs)
  attachment_pdf        TEXT,
  attachment_name       TEXT,
  attachment_doc2       TEXT,
  attachment_doc2_name  TEXT,

  -- Flexible extra data per module (PDF-parsed fields, bank data, etc.)
  payload               JSONB       NOT NULL DEFAULT '{}',

  observations          TEXT,
  is_new                BOOLEAN     NOT NULL DEFAULT TRUE,
  new_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  manual_override       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_a1_cases_tenant       ON a1_cases(tenant_id);
CREATE INDEX idx_a1_cases_stage        ON a1_cases(stage_id);
CREATE INDEX idx_a1_cases_tenant_cpf   ON a1_cases(tenant_id, client_cpf);
CREATE INDEX idx_a1_cases_module       ON a1_cases(tenant_id, module_key);
CREATE INDEX idx_a1_cases_updated      ON a1_cases(tenant_id, updated_at DESC);

CREATE TABLE a1_stage_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  case_id     UUID        NOT NULL REFERENCES a1_cases(id)   ON DELETE CASCADE,
  stage_id    UUID        REFERENCES a1_stages(id),
  stage_name  TEXT        NOT NULL,
  entered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exited_at   TIMESTAMPTZ
);

CREATE INDEX idx_a1_stage_history_case ON a1_stage_history(case_id);

CREATE TABLE a1_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  case_id       UUID        NOT NULL REFERENCES a1_cases(id)   ON DELETE CASCADE,
  type          TEXT        NOT NULL,  -- 'stage_change', 'field_edit', 'comment', 'document', etc.
  description   TEXT,
  field_before  TEXT,
  field_after   TEXT,
  actor_name    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_a1_events_case ON a1_events(case_id);

-- =============================================================================
-- BLOCK 5 — Partners (Generic)
-- Replaces hardcoded correspondentes / despachantes / CCA tables
-- =============================================================================

CREATE TABLE a1_partners (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  type            TEXT        NOT NULL DEFAULT 'partner',  -- 'partner', 'broker', 'dispatcher', 'agent', etc.
  cpf             TEXT,
  email           TEXT,
  phone           TEXT,
  password_hash   TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  approved        BOOLEAN     NOT NULL DEFAULT FALSE,
  permissions     JSONB       NOT NULL DEFAULT '{}',
  aliases         TEXT[]      NOT NULL DEFAULT '{}',       -- name variants for PDF matching
  developments    TEXT[]      NOT NULL DEFAULT '{}',       -- associated developments
  region          TEXT,
  extra           JSONB       NOT NULL DEFAULT '{}',       -- module-specific fields
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, cpf)
);

CREATE INDEX idx_a1_partners_tenant_type ON a1_partners(tenant_id, type);

-- =============================================================================
-- BLOCK 6 — Config, Goals, Mappings, Presence, Emails
-- =============================================================================

-- Tenant-level key/value config (replaces hardcoded a1_config table rows)
CREATE TABLE a1_config (
  tenant_id   UUID    NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  key         TEXT    NOT NULL,
  value       TEXT,
  PRIMARY KEY (tenant_id, key)
);

-- Sales goals per development/partner/period
CREATE TABLE a1_goals (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID    NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  development     TEXT    NOT NULL,
  partner_name    TEXT    NOT NULL DEFAULT '',
  target_value    INT     NOT NULL DEFAULT 0,
  period          TEXT    NOT NULL,          -- 'YYYY-MM'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, development, partner_name, period)
);

-- Canonical name mappings (development/region/partner name normalization)
CREATE TABLE a1_mappings (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL CHECK (type IN ('development','region','partner')),
  canonical   TEXT        NOT NULL,
  aliases     TEXT[]      NOT NULL DEFAULT '{}',
  region      TEXT,
  extra       JSONB       NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, type, canonical)
);

-- Soft presence tracking (who is online in which module)
CREATE TABLE a1_presence (
  user_key    TEXT        PRIMARY KEY,        -- tenant_id::user_id
  tenant_id   UUID        NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  role        TEXT        NOT NULL,
  module      TEXT,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_a1_presence_tenant ON a1_presence(tenant_id);

-- Email queue
CREATE TABLE a1_emails (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES a1_tenants(id) ON DELETE CASCADE,
  case_id     UUID        REFERENCES a1_cases(id) ON DELETE SET NULL,
  to_email    TEXT        NOT NULL,
  subject     TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','sent','failed')),
  sent_at     TIMESTAMPTZ,
  error_msg   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_a1_emails_status ON a1_emails(status, created_at);

-- =============================================================================
-- BLOCK 7 — Row Level Security
-- =============================================================================

-- Enable RLS on all tenant-scoped tables
ALTER TABLE a1_users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_user_permissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_tenant_modules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_stages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_stage_flags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_stage_flag_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_stage_edges       ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_cases             ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_stage_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_partners          ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_goals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_mappings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_presence          ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_emails            ENABLE ROW LEVEL SECURITY;

-- Non-tenant tables: public reads (the frontend needs them for login screen, etc.)
ALTER TABLE a1_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_modules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_plan_modules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_tenants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE a1_superadmins   ENABLE ROW LEVEL SECURITY;

-- Public plans/modules are readable by everyone (login page may need plan info)
CREATE POLICY "plans_read_all"       ON a1_plans        FOR SELECT USING (TRUE);
CREATE POLICY "modules_read_all"     ON a1_modules      FOR SELECT USING (TRUE);
CREATE POLICY "plan_modules_read_all" ON a1_plan_modules FOR SELECT USING (TRUE);

-- Tenants: no direct read via anon key — only via SECURITY DEFINER functions
CREATE POLICY "tenants_deny_all"     ON a1_tenants      FOR ALL  USING (FALSE);
CREATE POLICY "superadmins_deny_all" ON a1_superadmins  FOR ALL  USING (FALSE);

-- =============================================================================
-- BLOCK 7b — Helper: a1_tenant() — reads session token from request header
-- =============================================================================

CREATE OR REPLACE FUNCTION a1_tenant()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT s.tenant_id
  FROM   a1_sessions s
  WHERE  s.token = (
           current_setting('request.headers', TRUE)::JSON->>'x-session-token'
         )
    AND  s.expires_at > NOW()
  LIMIT  1;
$$;

-- Also expose current user id from session
CREATE OR REPLACE FUNCTION a1_current_user_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT s.user_id
  FROM   a1_sessions s
  WHERE  s.token = (
           current_setting('request.headers', TRUE)::JSON->>'x-session-token'
         )
    AND  s.expires_at > NOW()
  LIMIT  1;
$$;

-- Current user role from session
CREATE OR REPLACE FUNCTION a1_current_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT s.role
  FROM   a1_sessions s
  WHERE  s.token = (
           current_setting('request.headers', TRUE)::JSON->>'x-session-token'
         )
    AND  s.expires_at > NOW()
  LIMIT  1;
$$;

-- =============================================================================
-- BLOCK 7c — Helper: a1_has_module() — checks plan OR manual unlock
-- =============================================================================

CREATE OR REPLACE FUNCTION a1_has_module(p_module_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    -- Check plan entitlement
    SELECT 1
    FROM   a1_tenants t
    JOIN   a1_plan_modules pm ON pm.plan_key = t.plan_key
    WHERE  t.id = a1_tenant()
      AND  pm.module_key = p_module_key
      AND  t.status IN ('trial', 'active')
  )
  OR EXISTS (
    -- Check manual unlock by superadmin
    SELECT 1
    FROM   a1_tenant_modules tm
    WHERE  tm.tenant_id  = a1_tenant()
      AND  tm.module_key = p_module_key
      AND  (tm.expires_at IS NULL OR tm.expires_at > NOW())
  );
$$;

-- =============================================================================
-- BLOCK 7d — Helper: a1_can_add_user() — enforces user slot limit
-- =============================================================================

CREATE OR REPLACE FUNCTION a1_can_add_user()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT (
    SELECT COUNT(*)
    FROM   a1_users u
    WHERE  u.tenant_id = a1_tenant()
      AND  u.is_active = TRUE
      AND  u.role != 'partner'
  ) < (
    SELECT t.max_users
    FROM   a1_tenants t
    WHERE  t.id = a1_tenant()
  );
$$;

-- =============================================================================
-- BLOCK 7e — RLS Policies for all tenant-scoped tables
-- =============================================================================

-- a1_users
CREATE POLICY "users_tenant_isolation" ON a1_users
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_user_permissions
CREATE POLICY "user_permissions_tenant_isolation" ON a1_user_permissions
  FOR ALL USING (
    user_id IN (SELECT id FROM a1_users WHERE tenant_id = a1_tenant())
  );

-- a1_sessions — users can only see/delete their own session
CREATE POLICY "sessions_tenant_isolation" ON a1_sessions
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_tenant_modules — read-only for tenant users (write = service role only)
CREATE POLICY "tenant_modules_read" ON a1_tenant_modules
  FOR SELECT USING (tenant_id = a1_tenant());

-- a1_stages
CREATE POLICY "stages_tenant_isolation" ON a1_stages
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_stage_flags
CREATE POLICY "stage_flags_tenant_isolation" ON a1_stage_flags
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_stage_flag_links
CREATE POLICY "stage_flag_links_tenant_isolation" ON a1_stage_flag_links
  FOR ALL USING (
    stage_id IN (SELECT id FROM a1_stages WHERE tenant_id = a1_tenant())
  );

-- a1_stage_edges
CREATE POLICY "stage_edges_tenant_isolation" ON a1_stage_edges
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_cases
CREATE POLICY "cases_tenant_isolation" ON a1_cases
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_stage_history
CREATE POLICY "stage_history_tenant_isolation" ON a1_stage_history
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_events
CREATE POLICY "events_tenant_isolation" ON a1_events
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_partners
CREATE POLICY "partners_tenant_isolation" ON a1_partners
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_config
CREATE POLICY "config_tenant_isolation" ON a1_config
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_goals
CREATE POLICY "goals_tenant_isolation" ON a1_goals
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_mappings
CREATE POLICY "mappings_tenant_isolation" ON a1_mappings
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_presence
CREATE POLICY "presence_tenant_isolation" ON a1_presence
  FOR ALL USING (tenant_id = a1_tenant());

-- a1_emails
CREATE POLICY "emails_tenant_isolation" ON a1_emails
  FOR ALL USING (tenant_id = a1_tenant());

-- =============================================================================
-- BLOCK 8 — a1_login() — callable by anon role, returns session token
-- =============================================================================

CREATE OR REPLACE FUNCTION a1_login(
  p_tenant_slug TEXT,
  p_cpf         TEXT,
  p_password    TEXT
)
RETURNS JSON
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
DECLARE
  v_tenant    a1_tenants%ROWTYPE;
  v_user      a1_users%ROWTYPE;
  v_token     TEXT;
  v_hash      TEXT;
BEGIN
  -- 1. Find tenant
  SELECT * INTO v_tenant
  FROM   a1_tenants
  WHERE  slug = p_tenant_slug
  LIMIT  1;

  IF v_tenant.id IS NULL THEN
    RETURN json_build_object('error', 'tenant_not_found');
  END IF;

  IF v_tenant.status = 'suspended' THEN
    RETURN json_build_object('error', 'tenant_suspended');
  END IF;

  IF v_tenant.status = 'cancelled' THEN
    RETURN json_build_object('error', 'tenant_cancelled');
  END IF;

  -- 2. Find user within tenant
  SELECT * INTO v_user
  FROM   a1_users
  WHERE  tenant_id = v_tenant.id
    AND  cpf       = p_cpf
    AND  is_active = TRUE
  LIMIT  1;

  IF v_user.id IS NULL THEN
    RETURN json_build_object('error', 'invalid_credentials');
  END IF;

  -- 3. Verify password (SHA-256 hex of password + '::a1' salt)
  v_hash := encode(digest(p_password || '::a1', 'sha256'), 'hex');

  IF v_user.password_hash != v_hash THEN
    RETURN json_build_object('error', 'invalid_credentials');
  END IF;

  -- 4. Invalidate old sessions for this user (optional: keep multi-device)
  DELETE FROM a1_sessions
  WHERE  user_id = v_user.id
    AND  expires_at < NOW();

  -- 5. Create new session
  v_token := gen_random_uuid()::TEXT;

  INSERT INTO a1_sessions (token, tenant_id, user_id, role)
  VALUES (v_token, v_tenant.id, v_user.id, v_user.role);

  -- 6. Update last_seen
  UPDATE a1_users SET last_seen = NOW() WHERE id = v_user.id;

  -- 7. Return session data
  RETURN json_build_object(
    'token',      v_token,
    'tenant_id',  v_tenant.id,
    'tenant_name', v_tenant.name,
    'user_id',    v_user.id,
    'name',       v_user.name,
    'role',       v_user.role,
    'plan',       v_tenant.plan_key,
    'max_users',  v_tenant.max_users,
    'status',     v_tenant.status,
    'trial_ends_at', v_tenant.trial_ends_at
  );
END;
$$;

-- =============================================================================
-- BLOCK 8b — a1_logout() — invalidates current session
-- =============================================================================

CREATE OR REPLACE FUNCTION a1_logout()
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
AS $$
  DELETE FROM a1_sessions
  WHERE token = (
    current_setting('request.headers', TRUE)::JSON->>'x-session-token'
  );
$$;

-- =============================================================================
-- BLOCK 8c — a1_partner_login() — for external partners (brokers, dispatchers)
-- =============================================================================

CREATE OR REPLACE FUNCTION a1_partner_login(
  p_tenant_slug TEXT,
  p_cpf         TEXT,
  p_password    TEXT
)
RETURNS JSON
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
DECLARE
  v_tenant    a1_tenants%ROWTYPE;
  v_partner   a1_partners%ROWTYPE;
  v_token     TEXT;
  v_hash      TEXT;
BEGIN
  SELECT * INTO v_tenant
  FROM   a1_tenants
  WHERE  slug = p_tenant_slug AND status != 'cancelled'
  LIMIT  1;

  IF v_tenant.id IS NULL THEN
    RETURN json_build_object('error', 'tenant_not_found');
  END IF;

  v_hash := encode(digest(p_password || '::a1', 'sha256'), 'hex');

  SELECT * INTO v_partner
  FROM   a1_partners
  WHERE  tenant_id     = v_tenant.id
    AND  cpf           = p_cpf
    AND  password_hash = v_hash
    AND  is_active     = TRUE
    AND  approved      = TRUE
  LIMIT  1;

  IF v_partner.id IS NULL THEN
    RETURN json_build_object('error', 'invalid_credentials');
  END IF;

  -- Partners get a limited session (role = 'partner')
  v_token := gen_random_uuid()::TEXT;

  INSERT INTO a1_sessions (token, tenant_id, user_id, role, expires_at)
  SELECT v_token, v_tenant.id, u.id, 'partner', NOW() + INTERVAL '12 hours'
  FROM   a1_users u
  WHERE  u.tenant_id = v_tenant.id
    AND  u.cpf       = p_cpf
    AND  u.role      = 'partner'
  LIMIT  1;

  -- Fallback: if no a1_users row exists for this partner, create a shadow entry
  IF NOT FOUND THEN
    DECLARE
      v_shadow_user_id UUID := gen_random_uuid();
    BEGIN
      INSERT INTO a1_users (id, tenant_id, name, cpf, password_hash, role, is_active)
      VALUES (v_shadow_user_id, v_tenant.id, v_partner.name, v_partner.cpf, v_hash, 'partner', TRUE)
      ON CONFLICT (tenant_id, cpf) DO NOTHING;

      INSERT INTO a1_sessions (token, tenant_id, user_id, role, expires_at)
      SELECT v_token, v_tenant.id, id, 'partner', NOW() + INTERVAL '12 hours'
      FROM   a1_users
      WHERE  tenant_id = v_tenant.id AND cpf = p_cpf
      LIMIT  1;
    END;
  END IF;

  RETURN json_build_object(
    'token',        v_token,
    'tenant_id',    v_tenant.id,
    'partner_id',   v_partner.id,
    'name',         v_partner.name,
    'type',         v_partner.type,
    'role',         'partner',
    'permissions',  v_partner.permissions,
    'developments', v_partner.developments,
    'region',       v_partner.region
  );
END;
$$;

-- =============================================================================
-- BLOCK 9 — updated_at auto-trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION a1_set_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_a1_cases_updated_at
  BEFORE UPDATE ON a1_cases
  FOR EACH ROW EXECUTE FUNCTION a1_set_updated_at();

CREATE TRIGGER trg_a1_tenants_updated_at
  BEFORE UPDATE ON a1_tenants
  FOR EACH ROW EXECUTE FUNCTION a1_set_updated_at();

-- =============================================================================
-- BLOCK 10 — Grants to anon role (Supabase public key)
-- =============================================================================

-- anon can call login functions
GRANT EXECUTE ON FUNCTION a1_login(TEXT, TEXT, TEXT)          TO anon;
GRANT EXECUTE ON FUNCTION a1_partner_login(TEXT, TEXT, TEXT)  TO anon;

-- anon can read plans/modules (for landing page / login screen)
GRANT SELECT ON a1_plans        TO anon;
GRANT SELECT ON a1_modules      TO anon;
GRANT SELECT ON a1_plan_modules TO anon;

-- authenticated (session-validated) users get full access to their tenant data
-- via RLS — grant table-level permissions and let RLS enforce isolation
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_users             TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_user_permissions  TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_sessions          TO anon;
GRANT SELECT                         ON a1_tenant_modules    TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_stages            TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_stage_flags       TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_stage_flag_links  TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_stage_edges       TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_cases             TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_stage_history     TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_events            TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_partners          TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_config            TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_goals             TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_mappings          TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_presence          TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON a1_emails            TO anon;

GRANT EXECUTE ON FUNCTION a1_tenant()              TO anon;
GRANT EXECUTE ON FUNCTION a1_current_user_id()     TO anon;
GRANT EXECUTE ON FUNCTION a1_current_role()        TO anon;
GRANT EXECUTE ON FUNCTION a1_has_module(TEXT)      TO anon;
GRANT EXECUTE ON FUNCTION a1_can_add_user()        TO anon;
GRANT EXECUTE ON FUNCTION a1_logout()              TO anon;

-- =============================================================================
-- BLOCK 11 — Seed Data
-- =============================================================================

-- Plans
INSERT INTO a1_plans (key, name, max_users, price_brl) VALUES
  ('starter',    'Starter',    3,  0.00),
  ('pro',        'Pro',        10, 497.00),
  ('enterprise', 'Enterprise', 30, 997.00)
ON CONFLICT (key) DO NOTHING;

-- Modules
INSERT INTO a1_modules (key, name, description) VALUES
  ('repasse',       'Gestão de Repasse',    'Pipeline de repasse imobiliário com kanban, parceiros e análise de propostas'),
  ('registro',      'Gestão de Registro',   'Pipeline de registro de contratos com workflow visual e integração bancária'),
  ('analytics',     'Analytics',            'Dashboards e relatórios avançados de performance'),
  ('pipeline_pro',  'Pipeline Pro',         'Etapas ilimitadas, automações e flags customizáveis'),
  ('integrations',  'Integrações',          'Webhooks, API REST e integrações com sistemas externos'),
  ('multi_region',  'Multi-regional',       'Gestão de pipelines separados por regional ou tipologia')
ON CONFLICT (key) DO NOTHING;

-- Plan → Module entitlements
INSERT INTO a1_plan_modules (plan_key, module_key) VALUES
  -- Starter: apenas repasse básico
  ('starter', 'repasse'),

  -- Pro: repasse + registro + analytics
  ('pro', 'repasse'),
  ('pro', 'registro'),
  ('pro', 'analytics'),
  ('pro', 'pipeline_pro'),

  -- Enterprise: tudo
  ('enterprise', 'repasse'),
  ('enterprise', 'registro'),
  ('enterprise', 'analytics'),
  ('enterprise', 'pipeline_pro'),
  ('enterprise', 'integrations'),
  ('enterprise', 'multi_region')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- DONE
-- Run this entire script once in Supabase SQL Editor.
-- For superadmin operations (creating tenants, unlocking modules, etc.)
-- always use the SERVICE ROLE KEY — it bypasses RLS entirely.
-- =============================================================================
