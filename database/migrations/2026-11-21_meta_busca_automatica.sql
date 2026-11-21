-- ════════════════════════════════════════════════════════════════════════════
-- Meta Lead Ads: busca automática dos leads a cada 2 minutos.
--
-- O aviso da Meta (webhook) não está chegando para leads reais de página. Para
-- o lead não depender dele, o banco chama a cada 2 minutos a busca direta da
-- função meta-leads-webhook (/sincronizar, {todos:true}): para cada empresa
-- conectada, os leads dos últimos 7 dias dos formulários marcados entram no
-- funil. Lead já conhecido é ignorado; não há duplicata.
--
-- Segurança: a chamada leva um token próprio, gerado aqui e guardado no Vault
-- (ninguém copia a chave de serviço). A função confere o token perguntando ao
-- banco (siimob_meta_cron_valido, só a chave de serviço executa), e com ele só
-- consegue disparar a busca de todas as empresas, nada além.
--
-- Idempotente: rodar de novo mantém o mesmo token e recria o agendamento.
-- Não altera nenhum dado de cliente.
-- Para desligar: select cron.unschedule('siimob-meta-busca-leads');
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Token da busca agendada: 64 caracteres hexadecimais, gerado uma única vez.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'siimob_meta_cron') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'siimob_meta_cron',
      'Token da busca automática de leads da Meta (pg_cron -> meta-leads-webhook)'
    );
  end if;
end $$;

create or replace function public.siimob_meta_cron_valido(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_token ~ '^[0-9a-f]{64}$'
    and exists (
      select 1 from vault.decrypted_secrets
      where name = 'siimob_meta_cron' and decrypted_secret = p_token
    ),
    false);
$$;
revoke all on function public.siimob_meta_cron_valido(text) from public, anon, authenticated;
grant execute on function public.siimob_meta_cron_valido(text) to service_role;

-- O agendamento: a cada 2 minutos. A função responde quando termina; o
-- tempo limite de 60 s cobre várias empresas.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'siimob-meta-busca-leads') then
    perform cron.unschedule('siimob-meta-busca-leads');
  end if;
end $$;

select cron.schedule(
  'siimob-meta-busca-leads',
  '*/2 * * * *',
  $job$
  select net.http_post(
    url := 'https://hmedoyrxcqgkkasivbsn.supabase.co/functions/v1/meta-leads-webhook/sincronizar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-siimob-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'siimob_meta_cron')
    ),
    body := '{"todos":true}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
