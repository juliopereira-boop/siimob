-- Page selections are private and exclusively owned by one SIIMOB tenant.
CREATE TABLE public.siimob_meta_pages (
  page_id text PRIMARY KEY CHECK (page_id ~ '^[0-9]{1,32}$'),
  tenant_id uuid NOT NULL REFERENCES public.siimob_meta_connections(tenant_id),
  page_name text NOT NULL CHECK (length(page_name) BETWEEN 1 AND 300),
  selected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX siimob_meta_pages_tenant_id_idx ON public.siimob_meta_pages(tenant_id);
ALTER TABLE public.siimob_meta_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siimob_meta_pages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.siimob_meta_pages TO service_role;

-- Replace a tenant's selection as a single transaction. The caller has already
-- checked the pages against Meta; the connection timestamp guards reconnects.
CREATE FUNCTION public.siimob_meta_replace_pages(p_tenant uuid, p_version timestamptz, p_pages jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_version timestamptz;
BEGIN
  IF jsonb_typeof(p_pages) IS DISTINCT FROM 'array' OR jsonb_array_length(p_pages) > 500 THEN
    RETURN 'invalid';
  END IF;
  SELECT connected_at INTO v_version FROM public.siimob_meta_connections
    WHERE tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND OR v_version IS DISTINCT FROM p_version THEN RETURN 'connection_changed'; END IF;
  BEGIN
    DELETE FROM public.siimob_meta_pages WHERE tenant_id = p_tenant;
    INSERT INTO public.siimob_meta_pages (tenant_id, page_id, page_name)
      SELECT p_tenant, item->>'id', item->>'name' FROM jsonb_array_elements(p_pages) item;
  EXCEPTION WHEN unique_violation THEN
    RETURN 'page_conflict';
  END;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.siimob_meta_replace_pages(uuid,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siimob_meta_replace_pages(uuid,timestamptz,jsonb) TO service_role;
