-- Private inbox for signed Meta lead notifications. No lead details or tokens.
-- A future worker must establish page ownership before associating an event
-- with a tenant. No existing SIIMOB tables or policies are changed.
CREATE TABLE public.siimob_meta_webhook_events (
  page_id text NOT NULL CHECK (page_id ~ '^[0-9]{1,32}$'),
  leadgen_id text NOT NULL CHECK (leadgen_id ~ '^[0-9]{1,32}$'),
  form_id text NOT NULL CHECK (form_id ~ '^[0-9]{1,32}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, leadgen_id)
);
ALTER TABLE public.siimob_meta_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siimob_meta_webhook_events FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT ON public.siimob_meta_webhook_events TO service_role;
