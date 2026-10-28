-- Escopo de módulos do Gestor e Ciclo de Distribuição da Pré-análise.
-- Nenhum módulo marcado = Gestor Geral. Uma ou mais marcas = gestor apenas
-- daqueles módulos, sempre respeitando a licença do tenant.

create or replace function public.a1_gestor_modulo(p_chave text)
returns boolean language sql stable security definer
set search_path=public, extensions, pg_temp as $$
  select case when not public.a1_e_gestor() then true else
    case when not exists (
      select 1 from public.a1_user_permissions up
      where up.user_id=public.a1_current_user_id()
        and up.permission in ('ver_dashboard_lead','ver_dashboard_pre_analise',
          'ver_dashboard_venda','ver_dashboard_repasse','ver_dashboard_registro')
    ) then true else exists (
      select 1 from public.a1_user_permissions up
      where up.user_id=public.a1_current_user_id()
        and up.permission=case upper(p_chave)
          when 'CRM' then 'ver_dashboard_lead'
          when 'PRE_ANALISE' then 'ver_dashboard_pre_analise'
          when 'COMERCIAL' then 'ver_dashboard_venda'
          when 'REPASSE' then 'ver_dashboard_repasse'
          when 'REGISTRO' then 'ver_dashboard_registro'
        end
    ) end
  end;
$$;

create or replace function public.a1_has_module(p_module_key text)
returns boolean language sql stable security definer
set search_path=public, extensions, pg_temp as $$
  select public.a1_gestor_modulo(p_module_key) and (
    exists (
      select 1 from public.a1_tenants t
      join public.a1_plan_modules pm on pm.plan_key=t.plan_key
      where t.id=public.a1_tenant() and pm.module_key=p_module_key
        and t.status in ('trial','active')
    ) or exists (
      select 1 from public.a1_tenant_modules tm
      where tm.tenant_id=public.a1_tenant() and tm.module_key=p_module_key
        and (tm.expires_at is null or tm.expires_at>now())
    )
  );
$$;

create or replace function public.a1_tem_modulo(p_chave text)
returns boolean language sql stable security definer
set search_path=public, extensions, pg_temp as $$
  select public.a1_gestor_modulo(p_chave) and exists (
    select 1 from public.a1_tenant_modules tm
    where tm.tenant_id=public.a1_tenant() and tm.module_key=p_chave
      and (tm.expires_at is null or tm.expires_at>now())
  );
$$;

create or replace function public.a1_perm(p_chave text)
returns boolean language sql stable security definer
set search_path=public, extensions, pg_temp as $$
  select case
    when public.a1_e_gestor() and p_chave like 'ver_dashboard_%' then
      case when not exists (
        select 1 from public.a1_user_permissions up
        where up.user_id=public.a1_current_user_id()
          and up.permission in ('ver_dashboard_lead','ver_dashboard_pre_analise',
            'ver_dashboard_venda','ver_dashboard_repasse','ver_dashboard_registro')
      ) then true else exists (
        select 1 from public.a1_user_permissions up
        where up.user_id=public.a1_current_user_id() and up.permission=p_chave
      ) end
    when public.a1_e_gestor() then true
    else coalesce((
      select coalesce(pf.permissions,p.permissions)->>'gerente' in ('true','t','1')
          or coalesce(pf.permissions,p.permissions)->>p_chave in ('true','t','1')
      from public.a1_partners p
      left join public.a1_perfis pf on pf.id=p.perfil_id and pf.ativo
      where p.id=public.a1_ator() limit 1
    ),false)
  end;
$$;

revoke all on function public.a1_gestor_modulo(text) from public;
grant execute on function public.a1_gestor_modulo(text) to anon, authenticated;
grant execute on function public.a1_has_module(text) to anon, authenticated;
grant execute on function public.a1_tem_modulo(text) to anon, authenticated;
grant execute on function public.a1_perm(text) to anon, authenticated;

-- Configuração e participantes. A linha do participante é o vínculo hierárquico
-- Empresa -> Usuário correspondente -> Analista usado pelo ciclo.
create table if not exists public.a1_pa_ciclo_config (
  tenant_id uuid primary key references public.a1_tenants(id) on delete cascade,
  ativo boolean not null default false,
  modo text not null default 'LIVRE' check (modo in ('LIVRE','DESEMPENHO')),
  proxima_ordem integer not null default 1,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);

create table if not exists public.a1_pa_ciclo_participantes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.a1_tenants(id) on delete cascade,
  empresa_id uuid not null,
  correspondente_id uuid not null references public.a1_partners(id),
  analista_id uuid not null references public.a1_partners(id),
  ordem integer not null,
  peso_atual numeric not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (tenant_id, analista_id),
  unique (tenant_id, ordem)
);

create table if not exists public.a1_pa_ciclo_distribuicoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.a1_tenants(id) on delete cascade,
  pre_analise_id uuid not null unique,
  lead_id uuid,
  corretor_id uuid,
  empresa_id uuid not null,
  correspondente_id uuid not null,
  analista_id uuid not null,
  modo text not null,
  peso_aplicado integer not null default 1,
  aprovacoes_no_momento integer not null default 0,
  criado_em timestamptz not null default now()
);

create table if not exists public.a1_pa_ciclo_auditoria (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.a1_tenants(id) on delete cascade,
  ator_id uuid,
  acao text not null,
  antes jsonb,
  depois jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists a1_pa_ciclo_part_tenant on public.a1_pa_ciclo_participantes(tenant_id,ativo,ordem);
create index if not exists a1_pa_ciclo_dist_analista on public.a1_pa_ciclo_distribuicoes(tenant_id,analista_id);

alter table public.a1_pa_ciclo_config enable row level security;
alter table public.a1_pa_ciclo_participantes enable row level security;
alter table public.a1_pa_ciclo_distribuicoes enable row level security;
alter table public.a1_pa_ciclo_auditoria enable row level security;

revoke all on public.a1_pa_ciclo_config, public.a1_pa_ciclo_participantes,
  public.a1_pa_ciclo_distribuicoes, public.a1_pa_ciclo_auditoria from anon, authenticated;

-- Estado mínimo usado pelo assistente. Não revela participantes nem métricas.
create or replace function public.a1_pa_ciclo_estado()
returns jsonb language sql stable security definer
set search_path=public, extensions, pg_temp as $$
  select jsonb_build_object('ativo',coalesce(c.ativo,false),'modo',coalesce(c.modo,'LIVRE'))
  from (select public.a1_tenant() tenant_id) s
  left join public.a1_pa_ciclo_config c on c.tenant_id=s.tenant_id;
$$;

create or replace function public.a1_pa_ciclo_configuracao()
returns jsonb language plpgsql stable security definer
set search_path=public, extensions, pg_temp as $$
declare v_tenant uuid:=public.a1_tenant(); v_result jsonb;
begin
  if v_tenant is null or not public.a1_e_gestor() or not public.a1_gestor_modulo('PRE_ANALISE') then
    raise exception 'sem_permissao';
  end if;
  select jsonb_build_object(
    'ativo',coalesce(c.ativo,false),'modo',coalesce(c.modo,'LIVRE'),
    'proxima_ordem',coalesce(c.proxima_ordem,1),
    'participantes',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'empresa_id',p.empresa_id,'empresa',e.name,
      'correspondente_id',p.correspondente_id,'correspondente',co.name,
      'analista_id',p.analista_id,'analista',an.name,'ordem',p.ordem,
      'ativo',p.ativo,
      'recebidas',(select count(*) from public.a1_pa_ciclo_distribuicoes d where d.tenant_id=v_tenant and d.analista_id=p.analista_id),
      'aprovadas',(select count(*) from public.a1_pre_analises pa join public.a1_pa_situacoes s on s.id=pa.situacao_id where pa.tenant_id=v_tenant and pa.analista_id=p.analista_id and s.selo='FIM_POSITIVO')
    ) order by p.ordem) from public.a1_pa_ciclo_participantes p
      join public.a1_corr_empresas e on e.id=p.empresa_id
      join public.a1_partners co on co.id=p.correspondente_id
      join public.a1_partners an on an.id=p.analista_id
      where p.tenant_id=v_tenant),'[]'::jsonb)
  ) into v_result
  from (select v_tenant tenant_id) x
  left join public.a1_pa_ciclo_config c on c.tenant_id=x.tenant_id;
  return v_result;
end $$;

create or replace function public.a1_pa_ciclo_salvar(p_ativo boolean, p_modo text, p_participantes jsonb)
returns jsonb language plpgsql security definer
set search_path=public, extensions, pg_temp as $$
declare
  v_tenant uuid:=public.a1_tenant(); v_antes jsonb; v_item jsonb; v_ordem int:=0;
  v_modo text:=upper(coalesce(p_modo,'')); v_empresa uuid; v_corr uuid; v_ana uuid;
begin
  if v_tenant is null or not public.a1_e_gestor() or not public.a1_gestor_modulo('PRE_ANALISE') then raise exception 'sem_permissao'; end if;
  if v_modo not in ('LIVRE','DESEMPENHO') then raise exception 'modo_invalido'; end if;
  if jsonb_typeof(coalesce(p_participantes,'[]'::jsonb))<>'array' then raise exception 'participantes_invalidos'; end if;
  if coalesce(p_ativo,false) and jsonb_array_length(coalesce(p_participantes,'[]'::jsonb))=0 then raise exception 'ciclo_sem_participante'; end if;

  select to_jsonb(c) into v_antes from public.a1_pa_ciclo_config c where c.tenant_id=v_tenant;
  perform pg_advisory_xact_lock(hashtextextended('a1_pa_ciclo:'||v_tenant::text,0));
  for v_item in select value from jsonb_array_elements(coalesce(p_participantes,'[]'::jsonb)) loop
    v_ordem:=v_ordem+1; v_empresa:=(v_item->>'empresa_id')::uuid; v_corr:=(v_item->>'correspondente_id')::uuid; v_ana:=(v_item->>'analista_id')::uuid;
    if not exists(select 1 from public.a1_corr_empresas e where e.id=v_empresa and e.tenant_id=v_tenant) then raise exception 'empresa_invalida'; end if;
    if not exists(select 1 from public.a1_partners p where p.id=v_corr and p.tenant_id=v_tenant and p.type='cca' and p.is_active and p.approved and p.empresa_id=v_empresa) then raise exception 'correspondente_invalido'; end if;
    if not exists(select 1 from public.a1_partners p where p.id=v_ana and p.tenant_id=v_tenant and p.type='analista' and p.is_active and p.approved and p.empresa_id=v_empresa) then raise exception 'analista_invalido'; end if;
    if (select count(*) from jsonb_array_elements(p_participantes) x where x->>'analista_id'=v_ana::text)>1 then raise exception 'analista_duplicado'; end if;
  end loop;

  delete from public.a1_pa_ciclo_participantes p where p.tenant_id=v_tenant and not exists(
    select 1 from jsonb_array_elements(coalesce(p_participantes,'[]'::jsonb)) n where n->>'analista_id'=p.analista_id::text);
  update public.a1_pa_ciclo_participantes p set ordem=-p.ordem where p.tenant_id=v_tenant;
  v_ordem:=0;
  for v_item in select value from jsonb_array_elements(coalesce(p_participantes,'[]'::jsonb)) loop
    v_ordem:=v_ordem+1; v_empresa:=(v_item->>'empresa_id')::uuid; v_corr:=(v_item->>'correspondente_id')::uuid; v_ana:=(v_item->>'analista_id')::uuid;
    insert into public.a1_pa_ciclo_participantes(tenant_id,empresa_id,correspondente_id,analista_id,ordem)
      values(v_tenant,v_empresa,v_corr,v_ana,v_ordem)
      on conflict(tenant_id,analista_id) do update set empresa_id=excluded.empresa_id,
        correspondente_id=excluded.correspondente_id,ordem=excluded.ordem,ativo=true;
  end loop;
  insert into public.a1_pa_ciclo_config(tenant_id,ativo,modo,proxima_ordem,atualizado_em,atualizado_por)
    values(v_tenant,coalesce(p_ativo,false),v_modo,1,now(),public.a1_current_user_id())
    on conflict(tenant_id) do update set ativo=excluded.ativo,modo=excluded.modo,
      proxima_ordem=case when a1_pa_ciclo_config.modo<>excluded.modo then 1 else a1_pa_ciclo_config.proxima_ordem end,
      atualizado_em=now(),atualizado_por=excluded.atualizado_por;
  insert into public.a1_pa_ciclo_auditoria(tenant_id,ator_id,acao,antes,depois)
    values(v_tenant,public.a1_current_user_id(),'CONFIGURACAO',v_antes,jsonb_build_object('ativo',p_ativo,'modo',v_modo,'participantes',p_participantes));
  return public.a1_pa_ciclo_configuracao();
end $$;

-- A escolha ocorre na mesma transação do INSERT. O lock por tenant serializa
-- a atualização do ponteiro/pesos e a chave única torna o retry idempotente.
create or replace function public.a1_pa_ciclo_distribuir()
returns trigger language plpgsql security definer
set search_path=public, extensions, pg_temp as $$
declare
  v_cfg public.a1_pa_ciclo_config%rowtype; v_p public.a1_pa_ciclo_participantes%rowtype;
  v_exist public.a1_pa_ciclo_distribuicoes%rowtype; v_total int:=0; v_min int; v_max int;
  v_aprov int; v_peso int; v_novo numeric; v_melhor numeric:=null;
begin
  select * into v_cfg from public.a1_pa_ciclo_config where tenant_id=new.tenant_id and ativo;
  if not found then return new; end if;
  select * into v_exist from public.a1_pa_ciclo_distribuicoes where pre_analise_id=new.id;
  if found then new.empresa_id:=v_exist.empresa_id; new.correspondente_id:=v_exist.correspondente_id; new.analista_id:=v_exist.analista_id; return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('a1_pa_ciclo:'||new.tenant_id::text,0));
  select * into v_cfg from public.a1_pa_ciclo_config where tenant_id=new.tenant_id and ativo for update;
  if not found then return new; end if;

  if v_cfg.modo='LIVRE' then
    select p.* into v_p from public.a1_pa_ciclo_participantes p
      join public.a1_partners co on co.id=p.correspondente_id and co.is_active and co.approved and co.type='cca' and co.empresa_id=p.empresa_id
      join public.a1_partners an on an.id=p.analista_id and an.is_active and an.approved and an.type='analista' and an.empresa_id=p.empresa_id
      where p.tenant_id=new.tenant_id and p.ativo and p.ordem>=v_cfg.proxima_ordem order by p.ordem limit 1;
    if not found then
      select p.* into v_p from public.a1_pa_ciclo_participantes p
        join public.a1_partners co on co.id=p.correspondente_id and co.is_active and co.approved and co.type='cca' and co.empresa_id=p.empresa_id
        join public.a1_partners an on an.id=p.analista_id and an.is_active and an.approved and an.type='analista' and an.empresa_id=p.empresa_id
        where p.tenant_id=new.tenant_id and p.ativo order by p.ordem limit 1;
    end if;
    if v_p.id is null then raise exception 'ciclo_sem_participante_elegivel'; end if;
    update public.a1_pa_ciclo_config set proxima_ordem=v_p.ordem+1 where tenant_id=new.tenant_id;
    v_peso:=1;
  else
    with aprov as (
      select p.analista_id,count(s.id)::int qtd from public.a1_pa_ciclo_participantes p
      join public.a1_partners co on co.id=p.correspondente_id and co.is_active and co.approved and co.type='cca' and co.empresa_id=p.empresa_id
      join public.a1_partners an on an.id=p.analista_id and an.is_active and an.approved and an.type='analista' and an.empresa_id=p.empresa_id
      left join public.a1_pre_analises pa on pa.tenant_id=p.tenant_id and pa.analista_id=p.analista_id
      left join public.a1_pa_situacoes s on s.id=pa.situacao_id and s.selo='FIM_POSITIVO'
      where p.tenant_id=new.tenant_id and p.ativo group by p.analista_id
    ) select min(qtd),max(qtd) into v_min,v_max from aprov;
    for v_p in select p.* from public.a1_pa_ciclo_participantes p
      join public.a1_partners co on co.id=p.correspondente_id and co.is_active and co.approved and co.type='cca' and co.empresa_id=p.empresa_id
      join public.a1_partners an on an.id=p.analista_id and an.is_active and an.approved and an.type='analista' and an.empresa_id=p.empresa_id
      where p.tenant_id=new.tenant_id and p.ativo order by p.ordem
    loop
      select count(pa.id)::int into v_aprov from public.a1_pre_analises pa join public.a1_pa_situacoes s on s.id=pa.situacao_id and s.selo='FIM_POSITIVO' where pa.tenant_id=new.tenant_id and pa.analista_id=v_p.analista_id;
      v_peso:=case when coalesce(v_max,0)=coalesce(v_min,0) then 1 else 1+floor(4.0*(v_aprov-v_min)/(v_max-v_min))::int end;
      update public.a1_pa_ciclo_participantes set peso_atual=peso_atual+v_peso where id=v_p.id returning peso_atual into v_novo;
      v_total:=v_total+v_peso;
      if v_melhor is null or v_novo>v_melhor then v_melhor:=v_novo; new.analista_id:=v_p.analista_id; new.empresa_id:=v_p.empresa_id; new.correspondente_id:=v_p.correspondente_id; end if;
    end loop;
    if new.analista_id is null then raise exception 'ciclo_sem_participante_elegivel'; end if;
    select * into v_p from public.a1_pa_ciclo_participantes where tenant_id=new.tenant_id and analista_id=new.analista_id;
    update public.a1_pa_ciclo_participantes set peso_atual=peso_atual-v_total where id=v_p.id;
    select count(pa.id)::int into v_aprov from public.a1_pre_analises pa join public.a1_pa_situacoes s on s.id=pa.situacao_id and s.selo='FIM_POSITIVO' where pa.tenant_id=new.tenant_id and pa.analista_id=v_p.analista_id;
    v_peso:=case when coalesce(v_max,0)=coalesce(v_min,0) then 1 else 1+floor(4.0*(v_aprov-v_min)/(v_max-v_min))::int end;
  end if;
  new.empresa_id:=v_p.empresa_id; new.correspondente_id:=v_p.correspondente_id; new.analista_id:=v_p.analista_id;
  insert into public.a1_pa_ciclo_distribuicoes(tenant_id,pre_analise_id,lead_id,corretor_id,empresa_id,correspondente_id,analista_id,modo,peso_aplicado,aprovacoes_no_momento)
    values(new.tenant_id,new.id,new.lead_id,new.corretor_id,new.empresa_id,new.correspondente_id,new.analista_id,v_cfg.modo,v_peso,coalesce(v_aprov,0));
  return new;
end $$;

drop trigger if exists zz_a1_pa_ciclo_distribuir on public.a1_pre_analises;
create trigger zz_a1_pa_ciclo_distribuir before insert on public.a1_pre_analises
for each row execute function public.a1_pa_ciclo_distribuir();

revoke all on function public.a1_pa_ciclo_estado() from public;
revoke all on function public.a1_pa_ciclo_configuracao() from public;
revoke all on function public.a1_pa_ciclo_salvar(boolean,text,jsonb) from public;
grant execute on function public.a1_pa_ciclo_estado() to anon, authenticated;
grant execute on function public.a1_pa_ciclo_configuracao() to anon, authenticated;
grant execute on function public.a1_pa_ciclo_salvar(boolean,text,jsonb) to anon, authenticated;
