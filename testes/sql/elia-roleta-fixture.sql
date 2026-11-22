create table public.a1_atendimentos (id uuid,tenant_id uuid,case_id uuid,elia_ativa boolean,status text,corretor_id uuid,versao int,resultado text,corretor_nome text,finalizado_por text,finalizado_em timestamptz,ultima_em timestamptz,pendente boolean,ultima_previa text);
create table public.a1_cases (id uuid,tenant_id uuid,module_key text,payload jsonb,client_name text,client_phone text,client_email text,client_cpf text,stage_id uuid,stage_name text,stage_entered_at timestamptz,broker_name text,real_estate_name text);
create table public.a1_atendimento_mensagens (id uuid default gen_random_uuid(),tenant_id uuid,atendimento_id uuid,autor_tipo text,tipo text,criado_em timestamptz default now(),corpo text);
create table public.a1_partners (id uuid,tenant_id uuid,type text,is_active boolean,approved boolean,name text,extra jsonb);
create table public.a1_stages (id uuid,tenant_id uuid,module_key text,group_key text,selo text,name text);
create table public.a1_elia_config (tenant_id uuid,enabled boolean,flow jsonb);
create table public.a1_lead_roleta (tenant_id uuid,participantes uuid[],ultimo uuid,atualizado_em timestamptz);
create table public.a1_events (tenant_id uuid,case_id uuid,type text,description text,actor_name text);
create function public.a1_roleta_proximo(p_tenant uuid) returns uuid language plpgsql stable as $$
declare parts uuid[]; last_id uuid; valid uuid[]; pos int;
begin
  select participantes,ultimo into parts,last_id from public.a1_lead_roleta where tenant_id=p_tenant;
  select coalesce(array_agg(x order by ord),'{}') into valid from unnest(coalesce(parts,'{}')) with ordinality t(x,ord)
    where exists(select 1 from public.a1_partners p where p.id=t.x and p.tenant_id=p_tenant and p.type='corretor' and coalesce(p.is_active,true) and coalesce(p.approved,true));
  if cardinality(valid)=0 then return null; end if;
  pos := array_position(valid,last_id);
  if pos is null or pos >= cardinality(valid) then return valid[1]; end if;
  return valid[pos+1];
end $$;
grant usage on schema public to service_role;
grant select, insert, update on all tables in schema public to service_role;
