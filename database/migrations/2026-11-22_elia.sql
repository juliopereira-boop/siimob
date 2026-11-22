-- A ELIA inicia desativada. A função de serviço é a única leitora das credenciais.
create table public.a1_elia_config (
  tenant_id uuid primary key references public.a1_tenants(id) on delete cascade,
  config jsonb not null default '{}',
  flow jsonb not null default '[]',
  enabled boolean not null default false,
  google_refresh text,
  google_nonce text,
  google_nonce_until timestamptz
);

create table public.a1_elia_consent (
  tenant_id uuid not null references public.a1_tenants(id) on delete cascade,
  case_id uuid not null references public.a1_cases(id) on delete cascade,
  evidence text not null,
  phone text not null,
  recorded_at timestamptz not null default now(),
  primary key (tenant_id, case_id)
);

create table public.a1_elia_campaign (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.a1_tenants(id) on delete cascade,
  title text not null,
  message text not null,
  attachment jsonb,
  status text not null default 'queued' check (status in ('queued','paused','cancelled')),
  next_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.a1_elia_job (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.a1_tenants(id) on delete cascade,
  case_id uuid not null references public.a1_cases(id) on delete cascade,
  atendimento_id uuid references public.a1_atendimentos(id) on delete cascade,
  campaign_id uuid references public.a1_elia_campaign(id) on delete cascade,
  message_id uuid unique references public.a1_atendimento_mensagens(id) on delete cascade,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','sent','skipped','failed')),
  run_at timestamptz not null default now(),
  finished_at timestamptz,
  detail text,
  unique (campaign_id, case_id)
);
create index a1_elia_job_due on public.a1_elia_job (run_at) where status = 'queued';
create unique index a1_elia_one_running on public.a1_elia_job (tenant_id) where status = 'running';

create table public.a1_elia_appointment (
  id text primary key,
  tenant_id uuid not null references public.a1_tenants(id) on delete cascade,
  calendar_id text not null,
  event jsonb not null,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['a1_elia_config','a1_elia_consent','a1_elia_campaign','a1_elia_job','a1_elia_appointment'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

create function public.a1_elia_queue_inbound() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.autor_tipo = 'lead' and new.externo is not null and new.tipo = 'mensagem' then
    insert into public.a1_elia_job (tenant_id, case_id, atendimento_id, message_id)
      select a.tenant_id, a.case_id, a.id, new.id
      from public.a1_atendimentos a join public.a1_elia_config e on e.tenant_id = a.tenant_id
      where a.id = new.atendimento_id and a.tenant_id = new.tenant_id
        and a.canal = 'whatsapp' and e.enabled
        and public.a1_tenant_tem_modulo(a.tenant_id, 'ATENDIMENTO')
      on conflict (message_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.a1_elia_queue_inbound() from public, anon, authenticated;
create trigger a1_elia_inbound after insert on public.a1_atendimento_mensagens
for each row execute function public.a1_elia_queue_inbound();

create function public.a1_elia_claim() returns setof public.a1_elia_job
language plpgsql set search_path = '' as $$
declare picked public.a1_elia_job;
begin
  if not pg_try_advisory_xact_lock(71838104) then return; end if;
  update public.a1_elia_job set status = 'failed', detail = 'resultado_incerto', finished_at = now()
    where status = 'running' and run_at < now() - interval '5 minutes';
  select j.* into picked
  from public.a1_elia_job j
  left join public.a1_elia_campaign c on c.id = j.campaign_id
  where j.status = 'queued' and j.run_at <= now()
    and (j.campaign_id is null or (c.status = 'queued' and c.next_at <= now()))
    and not exists (select 1 from public.a1_elia_job r where r.tenant_id = j.tenant_id and r.status = 'running')
    and public.a1_tenant_tem_modulo(j.tenant_id, 'ATENDIMENTO')
  order by j.run_at, j.id limit 1 for update of j skip locked;
  if found then
    return query update public.a1_elia_job set status = 'running', run_at = now()
      where id = picked.id returning *;
  end if;
end $$;
revoke all on function public.a1_elia_claim() from public, anon, authenticated;
grant execute on function public.a1_elia_claim() to service_role;

create function public.a1_elia_start_campaign(p_tenant uuid, p_title text, p_message text, p_attachment jsonb, p_cases uuid[])
returns uuid language plpgsql set search_path = '' as $$
declare campaign uuid;
begin
  if not public.a1_tenant_tem_modulo(p_tenant, 'ATENDIMENTO')
    or coalesce(cardinality(p_cases),0) not between 1 and 500 then raise exception 'campanha_invalida'; end if;
  if exists (
    select 1 from unnest(p_cases) selection(case_id)
    where not exists (
      select 1 from public.a1_elia_consent o join public.a1_cases c on c.id = o.case_id and c.tenant_id = o.tenant_id and c.client_phone = o.phone
      where o.tenant_id = p_tenant and o.case_id = selection.case_id and nullif(trim(c.client_phone), '') is not null
    )
  ) then raise exception 'contatos_sem_consentimento'; end if;
  insert into public.a1_elia_campaign(tenant_id,title,message,attachment)
  values (p_tenant,p_title,p_message,p_attachment) returning id into campaign;
  insert into public.a1_elia_job(tenant_id,case_id,campaign_id)
    select p_tenant, c.id, campaign from public.a1_cases c
    where c.tenant_id = p_tenant and c.id = any(p_cases);
  return campaign;
end $$;
revoke all on function public.a1_elia_start_campaign(uuid,text,text,jsonb,uuid[]) from public, anon, authenticated;
grant execute on function public.a1_elia_start_campaign(uuid,text,text,jsonb,uuid[]) to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('elia-private','elia-private',false,5242880);

create function public.a1_elia_handoff(p_tenant uuid, p_atendimento uuid, p_note text, p_stage uuid, p_partner uuid)
returns void language plpgsql set search_path = '' as $$
declare
  conversation public.a1_atendimentos;
  stage public.a1_stages;
  partner public.a1_partners;
begin
  select * into conversation from public.a1_atendimentos
    where id = p_atendimento and tenant_id = p_tenant and status = 'aberta' and corretor_id is null for update;
  if not found then return; end if;
  if p_stage is not null then
    select * into strict stage from public.a1_stages where id = p_stage and tenant_id = p_tenant and module_key = 'crm';
    update public.a1_cases set stage_id = stage.id, stage_name = stage.name, stage_entered_at = now()
      where id = conversation.case_id and tenant_id = p_tenant and module_key = 'crm' and stage_id is distinct from stage.id;
  end if;
  if p_partner is not null then
    select * into strict partner from public.a1_partners where id = p_partner and tenant_id = p_tenant and type = 'corretor';
    update public.a1_cases set broker_name = partner.name,
      payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{crm_refs}',
        coalesce(payload->'crm_refs', '{}'::jsonb) || jsonb_build_object('corretor_id', partner.id))
      where id = conversation.case_id and tenant_id = p_tenant;
  end if;
  update public.a1_atendimentos set
    status = case when partner.id is null then status else 'distribuida' end,
    corretor_id = partner.id, corretor_nome = partner.name, versao = versao + 1, pendente = true
    where id = p_atendimento;
  insert into public.a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, tipo, corpo)
    values (p_tenant, p_atendimento, 'sistema', 'nota', left(p_note,4000));
end $$;
revoke all on function public.a1_elia_handoff(uuid,uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.a1_elia_handoff(uuid,uuid,text,uuid,uuid) to service_role;

create or replace function public.a1_elia_log_send(
  p_tenant uuid, p_atendimento uuid, p_corpo text, p_autor text, p_externo text, p_tipo text,
  p_autor_tipo text)
returns json language plpgsql security invoker
set search_path = public, extensions, pg_temp as $$
declare v_id uuid; v_corpo text := left(btrim(coalesce(p_corpo, '')), 4000);
begin
  if p_tipo not in ('resposta', 'iniciado', 'campanha') or p_autor_tipo not in ('atendente', 'ia') then
    return json_build_object('ok', false, 'erro', 'dados_invalidos');
  end if;
  insert into a1_whatsapp_envios (tenant_id, tipo, atendimento_id) values (p_tenant, p_tipo, p_atendimento);
  if p_atendimento is null or v_corpo = '' then return json_build_object('ok', true); end if;
  insert into a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, autor_nome, tipo, corpo, externo)
  select a.tenant_id, a.id, p_autor_tipo, left(coalesce(p_autor, 'Atendente'), 120), 'mensagem', v_corpo,
         nullif(left(coalesce(p_externo, ''), 120), '')
    from a1_atendimentos a where a.id = p_atendimento and a.tenant_id = p_tenant
  on conflict do nothing
  returning id into v_id;
  update a1_atendimentos set ultima_em = now(), pendente = false, ultima_previa = left(v_corpo, 140)
   where id = p_atendimento and tenant_id = p_tenant;
  return json_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.a1_elia_log_send(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.a1_elia_log_send(uuid, uuid, text, text, text, text, text) to service_role;


create function public.a1_elia_admin(p_token text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.a1_sessions s
    where s.token = p_token and s.role in ('owner','admin')
      and (s.expires_at is null or s.expires_at > now()));
$$;
revoke all on function public.a1_elia_admin(text) from public, anon, authenticated;
grant execute on function public.a1_elia_admin(text) to service_role;
