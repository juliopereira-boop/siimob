-- Integridade do Workflow, snapshot do ator e tipos completos da Agenda.
-- Migration aditiva e idempotente. Não reescreve eventos históricos: um papel
-- que não foi capturado no passado não pode ser reconstruído com segurança.
begin;

set local search_path = public, extensions, pg_temp;

-- A interface já trabalha com estes quatro tipos. A constraint antiga ainda
-- aceitava apenas compromisso/tarefa e fazia avaliação/entrevista falharem.
alter table public.a1_agenda drop constraint if exists a1_agenda_tipo_check;
alter table public.a1_agenda add constraint a1_agenda_tipo_check
  check (tipo in ('compromisso','tarefa','avaliacao','entrevista'));

alter table public.a1_events add column if not exists actor_role text;
alter table public.a1_stage_history add column if not exists actor_name text;
alter table public.a1_stage_history add column if not exists actor_role text;
alter table public.a1_pa_eventos add column if not exists ator_papel text;
alter table public.a1_co_eventos add column if not exists ator_papel text;
alter table public.a1_agenda add column if not exists criado_por_nome text;
alter table public.a1_agenda add column if not exists criado_por_papel text;

create or replace function public.a1_auditoria_papel()
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when (public.a1_sessao()).origem = 'suporte' then 'superadmin'
    when public.a1_papel() = 'partner' then coalesce(public.a1_tipo_ator(), 'partner')
    else public.a1_papel()
  end;
$$;

create or replace function public.a1_auditoria_nome()
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when (public.a1_sessao()).origem = 'suporte' then 'Suporte SIIMOB'
    when public.a1_papel() = 'partner' then
      (select p.name from public.a1_partners p where p.id = public.a1_ator())
    else
      (select u.name from public.a1_users u where u.id = public.a1_usuario())
  end;
$$;

revoke all on function public.a1_auditoria_papel() from public;
revoke all on function public.a1_auditoria_nome() from public;
grant execute on function public.a1_auditoria_papel() to anon, authenticated;
grant execute on function public.a1_auditoria_nome() to anon, authenticated;

create or replace function public.a1_audita_evento_case()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  new.actor_name := coalesce(public.a1_auditoria_nome(), new.actor_name);
  new.actor_role := public.a1_auditoria_papel();
  return new;
end $$;

drop trigger if exists a1_events_snapshot_ator on public.a1_events;
create trigger a1_events_snapshot_ator before insert on public.a1_events
for each row execute function public.a1_audita_evento_case();

create or replace function public.a1_audita_historico_etapa()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  new.actor_name := public.a1_auditoria_nome();
  new.actor_role := public.a1_auditoria_papel();
  return new;
end $$;

drop trigger if exists a1_stage_history_snapshot_ator on public.a1_stage_history;
create trigger a1_stage_history_snapshot_ator before insert on public.a1_stage_history
for each row execute function public.a1_audita_historico_etapa();

create or replace function public.a1_audita_evento_modulo()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  new.ator_id := coalesce(new.ator_id, public.a1_ator());
  new.ator_nome := coalesce(public.a1_auditoria_nome(), new.ator_nome);
  new.ator_papel := public.a1_auditoria_papel();
  return new;
end $$;

drop trigger if exists a1_pa_eventos_snapshot_ator on public.a1_pa_eventos;
create trigger a1_pa_eventos_snapshot_ator before insert on public.a1_pa_eventos
for each row execute function public.a1_audita_evento_modulo();
drop trigger if exists a1_co_eventos_snapshot_ator on public.a1_co_eventos;
create trigger a1_co_eventos_snapshot_ator before insert on public.a1_co_eventos
for each row execute function public.a1_audita_evento_modulo();

create or replace function public.a1_audita_agenda()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por_nome := public.a1_auditoria_nome();
    new.criado_por_papel := public.a1_auditoria_papel();
  end if;
  return new;
end $$;

drop trigger if exists a1_agenda_snapshot_ator on public.a1_agenda;
create trigger a1_agenda_snapshot_ator before insert or update on public.a1_agenda
for each row execute function public.a1_audita_agenda();

-- Trilha específica para alterações do desenho do Workflow.
create table if not exists public.a1_workflow_eventos (
  id bigserial primary key,
  tenant_id uuid not null references public.a1_tenants(id) on delete cascade,
  modulo text not null,
  etapa_id uuid not null,
  evento text not null,
  antes jsonb,
  depois jsonb,
  ator_id uuid,
  ator_nome text,
  ator_papel text,
  criado_em timestamptz not null default now()
);
create index if not exists a1_workflow_eventos_tenant_idx
  on public.a1_workflow_eventos (tenant_id, criado_em desc);
alter table public.a1_workflow_eventos enable row level security;
drop policy if exists a1_workflow_eventos_ler on public.a1_workflow_eventos;
create policy a1_workflow_eventos_ler on public.a1_workflow_eventos
for select to anon, authenticated
using (tenant_id=(select public.a1_tenant()) and ((select public.a1_e_gestor()) or (select public.a1_perm('gerente'))));
revoke all on public.a1_workflow_eventos from public, anon, authenticated;
grant select on public.a1_workflow_eventos to anon, authenticated;

create or replace function public.a1_audita_workflow()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_modulo text;
begin
  if tg_table_name = 'a1_pa_situacoes' then v_modulo := 'PRE_ANALISE';
  elsif tg_table_name = 'a1_co_situacoes' then v_modulo := 'COMERCIAL';
  else v_modulo := coalesce(new.module_key, old.module_key); end if;
  insert into public.a1_workflow_eventos
    (tenant_id,modulo,etapa_id,evento,antes,depois,ator_id,ator_nome,ator_papel)
  values
    (coalesce(new.tenant_id,old.tenant_id),v_modulo,coalesce(new.id,old.id),lower(tg_op),
     case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
     case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
     public.a1_ator(),public.a1_auditoria_nome(),public.a1_auditoria_papel());
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists a1_pa_situacoes_auditoria on public.a1_pa_situacoes;
create trigger a1_pa_situacoes_auditoria after insert or update or delete on public.a1_pa_situacoes
for each row execute function public.a1_audita_workflow();
drop trigger if exists a1_co_situacoes_auditoria on public.a1_co_situacoes;
create trigger a1_co_situacoes_auditoria after insert or update or delete on public.a1_co_situacoes
for each row execute function public.a1_audita_workflow();

-- Um selo pertence a no máximo uma etapa por tenant/módulo. A função faz a
-- transferência em uma única transação: limpa a etapa anterior e marca a nova,
-- sem deixar duplicidade ou depender de dois PATCHes do navegador.
create or replace function public.a1_workflow_definir_selo(
  p_module_key text, p_stage_id uuid, p_selo text
) returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_selo text := nullif(btrim(p_selo),'');
begin
  if not (public.a1_e_gestor() or public.a1_perm('gerente')) then
    raise exception 'sem_permissao';
  end if;
  if p_module_key = 'PRE_ANALISE' then
    if not exists (select 1 from public.a1_pa_situacoes where id=p_stage_id and tenant_id=public.a1_tenant()) then raise exception 'etapa_invalida'; end if;
    if v_selo is not null then
      update public.a1_pa_situacoes set selo=null where tenant_id=public.a1_tenant() and selo=v_selo and id<>p_stage_id;
    end if;
    update public.a1_pa_situacoes set selo=v_selo where tenant_id=public.a1_tenant() and id=p_stage_id;
  elsif p_module_key = 'COMERCIAL' then
    if not exists (select 1 from public.a1_co_situacoes where id=p_stage_id and tenant_id=public.a1_tenant()) then raise exception 'etapa_invalida'; end if;
    if v_selo is not null then
      update public.a1_co_situacoes set selo=null where tenant_id=public.a1_tenant() and selo=v_selo and id<>p_stage_id;
    end if;
    update public.a1_co_situacoes set selo=v_selo where tenant_id=public.a1_tenant() and id=p_stage_id;
  else
    raise exception 'modulo_invalido';
  end if;
end $$;

revoke all on function public.a1_workflow_definir_selo(text,uuid,text) from public, authenticated;
grant execute on function public.a1_workflow_definir_selo(text,uuid,text) to anon;

commit;
