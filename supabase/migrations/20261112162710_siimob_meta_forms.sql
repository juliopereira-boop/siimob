-- Selections are private. Deselected forms remain recorded as inactive.
CREATE TABLE public.siimob_meta_forms (
  tenant_id uuid NOT NULL REFERENCES public.a1_tenants(id),
  page_id text NOT NULL CHECK (page_id ~ '^[0-9]{1,32}$'),
  form_id text NOT NULL CHECK (form_id ~ '^[0-9]{1,32}$'),
  form_name text NOT NULL CHECK (length(form_name) BETWEEN 1 AND 300),
  selected boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, page_id, form_id)
);
ALTER TABLE public.siimob_meta_forms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siimob_meta_forms FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.siimob_meta_forms TO service_role;

CREATE FUNCTION public.siimob_meta_replace_forms(p_tenant uuid, p_version timestamptz, p_page text, p_forms jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_version timestamptz;
BEGIN
  IF jsonb_typeof(p_forms) IS DISTINCT FROM 'array' THEN RETURN 'invalid'; END IF;
  IF jsonb_array_length(p_forms) > 500 THEN RETURN 'invalid'; END IF;
  SELECT connected_at INTO v_version FROM public.siimob_meta_connections WHERE tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND OR v_version IS DISTINCT FROM p_version THEN RETURN 'connection_changed'; END IF;
  PERFORM 1 FROM public.siimob_meta_pages WHERE tenant_id = p_tenant AND page_id = p_page FOR UPDATE;
  IF NOT FOUND THEN RETURN 'page_not_selected'; END IF;
  UPDATE public.siimob_meta_forms SET selected = false, updated_at = now()
    WHERE tenant_id = p_tenant AND page_id = p_page AND selected = true;
  INSERT INTO public.siimob_meta_forms (tenant_id, page_id, form_id, form_name, selected)
    SELECT p_tenant, p_page, item->>'id', item->>'name', true FROM jsonb_array_elements(p_forms) item
    ON CONFLICT (tenant_id, page_id, form_id) DO UPDATE
      SET form_name = EXCLUDED.form_name, selected = true, updated_at = now();
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.siimob_meta_replace_forms(uuid,timestamptz,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siimob_meta_replace_forms(uuid,timestamptz,text,jsonb) TO service_role;
