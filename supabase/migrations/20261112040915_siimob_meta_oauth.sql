-- Private OAuth state and credentials. Existing tables and policies are untouched.
CREATE TABLE public.siimob_meta_oauth_states (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  session_hash text NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  tenant_id uuid NOT NULL REFERENCES public.a1_tenants(id),
  user_id uuid NOT NULL REFERENCES public.a1_users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX siimob_meta_oauth_states_expiry_idx ON public.siimob_meta_oauth_states(expires_at);
CREATE TABLE public.siimob_meta_connections (
  tenant_id uuid PRIMARY KEY REFERENCES public.a1_tenants(id),
  connected_by uuid NOT NULL REFERENCES public.a1_users(id),
  access_token text NOT NULL,
  meta_user_id text NOT NULL,
  token_expires_at timestamptz,
  data_access_expires_at timestamptz,
  scopes text[] NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.siimob_meta_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siimob_meta_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siimob_meta_oauth_states, public.siimob_meta_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.siimob_meta_oauth_states TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.siimob_meta_connections TO service_role;

-- This function is callable only by the Edge Function's server credential.
CREATE FUNCTION public.siimob_meta_session_context(p_token text)
RETURNS TABLE (tenant_id uuid, user_id uuid, slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.tenant_id, s.user_id, t.slug
  FROM public.a1_sessions s
  JOIN public.a1_users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
  JOIN public.a1_tenants t ON t.id = s.tenant_id
  WHERE s.token = p_token AND s.expires_at > now()
    AND s.role IN ('owner', 'admin') AND u.role IN ('owner', 'admin')
    AND u.is_active = true AND t.status IN ('active', 'trial')
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.siimob_meta_session_context(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siimob_meta_session_context(text) TO service_role;
