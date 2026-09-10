-- SIIMOB — Fundação de acesso, fase 1: observação
-- Estado: PREPARADA, NÃO APLICADA.
--
-- Esta migration é aditiva: não altera usuários, sessões, grants ou policies
-- existentes. Ela cria apenas o registro que sustentará o rollout em modo sombra.
-- Aplique primeiro em homologação e valide o resultado de supabase/sql/access-audit.sql.
--
-- Rollback:
--   drop table if exists public.a1_access_shadow_decisions;

begin;

create table if not exists public.a1_access_shadow_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  actor_user_id uuid,
  actor_role text,
  capability text not null,
  resource_type text not null,
  resource_id uuid,
  legacy_allowed boolean,
  candidate_allowed boolean not null,
  reason jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);

comment on table public.a1_access_shadow_decisions is
  'Auditoria de rollout de permissões. Nunca é consultada diretamente pelo cliente.';

create index if not exists a1_access_shadow_decisions_tenant_observed_idx
  on public.a1_access_shadow_decisions (tenant_id, observed_at desc);

create index if not exists a1_access_shadow_decisions_actor_observed_idx
  on public.a1_access_shadow_decisions (actor_user_id, observed_at desc);

alter table public.a1_access_shadow_decisions enable row level security;

-- Não há acesso direto pelo navegador. A escrita futura deve ocorrer apenas
-- por backend/Edge Function ou RPC explicitamente autorizada e revisada.
revoke all on table public.a1_access_shadow_decisions
  from public, anon, authenticated;

grant select, insert on table public.a1_access_shadow_decisions to service_role;

commit;
