-- =============================================================================
-- Migração: limite de ACESSOS SIMULTÂNEOS (max_users) no login — enforcement
-- server-side. Rode este script no SQL Editor do Supabase.
--
-- Regra: o cadastro de usuários é ilimitado; max_users do tenant passa a
-- limitar quantos podem estar ONLINE ao mesmo tempo. "Online" = ter heartbeat
-- em a1_presence nos últimos 90 segundos. Ao tentar logar quando o limite já
-- está atingido, a função retorna {"error":"max_concurrent","limit":N}.
--
-- Seguro de rodar mais de uma vez (CREATE OR REPLACE / idempotente).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- a1_login() — usuários internos
-- -----------------------------------------------------------------------------
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
  v_online    INT;
BEGIN
  -- 1. Find tenant
  SELECT * INTO v_tenant FROM a1_tenants WHERE slug = p_tenant_slug LIMIT 1;

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
  WHERE  tenant_id = v_tenant.id AND cpf = p_cpf AND is_active = TRUE
  LIMIT  1;

  IF v_user.id IS NULL THEN
    RETURN json_build_object('error', 'invalid_credentials');
  END IF;

  -- 3. Verify password
  v_hash := encode(digest(p_password || '::a1', 'sha256'), 'hex');
  IF v_user.password_hash != v_hash THEN
    RETURN json_build_object('error', 'invalid_credentials');
  END IF;

  -- 3b. LIMITE DE ACESSOS SIMULTÂNEOS (online = heartbeat nos últimos 90s).
  --     Exclui a própria conta para permitir re-login / múltiplas abas.
  IF COALESCE(v_tenant.max_users, 0) > 0 THEN
    SELECT COUNT(DISTINCT user_key) INTO v_online
    FROM   a1_presence
    WHERE  tenant_id = v_tenant.id
      AND  last_seen >= NOW() - INTERVAL '90 seconds'
      AND  user_key <> (v_tenant.id::TEXT || '::' || v_user.id::TEXT);

    IF v_online >= v_tenant.max_users THEN
      RETURN json_build_object('error', 'max_concurrent', 'limit', v_tenant.max_users);
    END IF;
  END IF;

  -- 4. Limpa sessões expiradas deste usuário
  DELETE FROM a1_sessions WHERE user_id = v_user.id AND expires_at < NOW();

  -- 5. Cria nova sessão
  v_token := gen_random_uuid()::TEXT;
  INSERT INTO a1_sessions (token, tenant_id, user_id, role)
  VALUES (v_token, v_tenant.id, v_user.id, v_user.role);

  -- 6. last_seen
  UPDATE a1_users SET last_seen = NOW() WHERE id = v_user.id;

  -- 6b. Reserva o slot de presença imediatamente (evita corrida no login)
  INSERT INTO a1_presence (user_key, tenant_id, name, role, module, last_seen)
  VALUES (v_tenant.id::TEXT || '::' || v_user.id::TEXT, v_tenant.id, v_user.name, v_user.role, NULL, NOW())
  ON CONFLICT (user_key) DO UPDATE SET last_seen = NOW();

  -- 7. Retorno
  RETURN json_build_object(
    'token',         v_token,
    'tenant_id',     v_tenant.id,
    'tenant_name',   v_tenant.name,
    'user_id',       v_user.id,
    'name',          v_user.name,
    'role',          v_user.role,
    'plan',          v_tenant.plan_key,
    'max_users',     v_tenant.max_users,
    'status',        v_tenant.status,
    'trial_ends_at', v_tenant.trial_ends_at
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- a1_partner_login() — correspondentes / parceiros externos
-- -----------------------------------------------------------------------------
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
  v_online    INT;
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
  WHERE  tenant_id = v_tenant.id AND cpf = p_cpf
    AND  password_hash = v_hash AND is_active = TRUE AND approved = TRUE
  LIMIT  1;

  IF v_partner.id IS NULL THEN
    RETURN json_build_object('error', 'invalid_credentials');
  END IF;

  -- LIMITE DE ACESSOS SIMULTÂNEOS (a presença do parceiro usa tenant::partner_id)
  IF COALESCE(v_tenant.max_users, 0) > 0 THEN
    SELECT COUNT(DISTINCT user_key) INTO v_online
    FROM   a1_presence
    WHERE  tenant_id = v_tenant.id
      AND  last_seen >= NOW() - INTERVAL '90 seconds'
      AND  user_key <> (v_tenant.id::TEXT || '::' || v_partner.id::TEXT);

    IF v_online >= v_tenant.max_users THEN
      RETURN json_build_object('error', 'max_concurrent', 'limit', v_tenant.max_users);
    END IF;
  END IF;

  -- Sessão limitada (role = 'partner')
  v_token := gen_random_uuid()::TEXT;

  INSERT INTO a1_sessions (token, tenant_id, user_id, role, expires_at)
  SELECT v_token, v_tenant.id, u.id, 'partner', NOW() + INTERVAL '12 hours'
  FROM   a1_users u
  WHERE  u.tenant_id = v_tenant.id AND u.cpf = p_cpf AND u.role = 'partner'
  LIMIT  1;

  IF NOT FOUND THEN
    DECLARE v_shadow_user_id UUID := gen_random_uuid();
    BEGIN
      INSERT INTO a1_users (id, tenant_id, name, cpf, password_hash, role, is_active)
      VALUES (v_shadow_user_id, v_tenant.id, v_partner.name, v_partner.cpf, v_hash, 'partner', TRUE)
      ON CONFLICT (tenant_id, cpf) DO NOTHING;

      INSERT INTO a1_sessions (token, tenant_id, user_id, role, expires_at)
      SELECT v_token, v_tenant.id, id, 'partner', NOW() + INTERVAL '12 hours'
      FROM   a1_users WHERE tenant_id = v_tenant.id AND cpf = p_cpf LIMIT 1;
    END;
  END IF;

  -- Reserva o slot de presença imediatamente
  INSERT INTO a1_presence (user_key, tenant_id, name, role, module, last_seen)
  VALUES (v_tenant.id::TEXT || '::' || v_partner.id::TEXT, v_tenant.id, v_partner.name, 'partner', NULL, NOW())
  ON CONFLICT (user_key) DO UPDATE SET last_seen = NOW();

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

-- -----------------------------------------------------------------------------
-- a1_logout() — invalida a sessão E libera o slot de presença (usuário interno)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION a1_logout()
RETURNS VOID
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
DECLARE
  v_token TEXT := current_setting('request.headers', TRUE)::JSON->>'x-session-token';
  v_sess  a1_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_sess FROM a1_sessions WHERE token = v_token;
  IF FOUND THEN
    DELETE FROM a1_presence
    WHERE user_key = v_sess.tenant_id::TEXT || '::' || v_sess.user_id::TEXT;
  END IF;
  DELETE FROM a1_sessions WHERE token = v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION a1_login(TEXT, TEXT, TEXT)         TO anon;
GRANT EXECUTE ON FUNCTION a1_partner_login(TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION a1_logout()                        TO anon;
