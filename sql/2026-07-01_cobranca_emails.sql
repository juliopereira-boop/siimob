-- =============================================================================
-- Cobrança por e-mail (superadmin)
-- Fila de e-mails a serem enviados. O botão "Cobrança" e o auto-envio inserem
-- linhas com status='pending'; um worker/cron externo (ver nota no fim) é quem
-- realmente dispara os e-mails e marca status='sent' / 'failed'.
--
-- Os dados de cobrança por cliente (dia de vencimento, valor, meses pagos e
-- controle de notificação) ficam em a1_config com key='billing' — NÃO precisa
-- de migração, a tabela a1_config já existe.
--
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS a1_emails (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid,                            -- id do cliente (a1_tenants), sem FK p/ não depender do schema
  to_email    text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  kind        text DEFAULT 'cobranca',        -- cobranca | cobranca_auto | ...
  status      text DEFAULT 'pending',          -- pending | sent | failed
  error       text,
  created_at  timestamptz DEFAULT now(),
  sent_at     timestamptz
);

CREATE INDEX IF NOT EXISTS a1_emails_status_idx ON a1_emails (status, created_at);
CREATE INDEX IF NOT EXISTS a1_emails_tenant_idx ON a1_emails (tenant_id);

-- A fila é operada pelo superadmin com a Service Role Key (bypassa RLS).
-- Mantemos RLS habilitado sem policies para clientes: nenhum tenant vê os e-mails.
ALTER TABLE a1_emails ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- NOTA IMPORTANTE — envio real dos e-mails
-- -----------------------------------------------------------------------------
-- Esta migração cria apenas a FILA. Para os e-mails saírem de fato é preciso um
-- worker que leia as linhas 'pending' e envie via um provedor (Resend, SendGrid,
-- SMTP, etc.). Duas opções recomendadas:
--
--  (a) Supabase Edge Function agendada (pg_cron -> net.http_post) que a cada X
--      minutos busca a1_emails WHERE status='pending', envia e atualiza a linha.
--  (b) Um pequeno serviço/cron externo que faz o mesmo via PostgREST + Service Key.
--
-- Enquanto o worker não existir, use o botão "Abrir no e-mail" no modal de
-- Cobrança — ele abre seu cliente de e-mail já preenchido com o modelo padrão.
-- =============================================================================
