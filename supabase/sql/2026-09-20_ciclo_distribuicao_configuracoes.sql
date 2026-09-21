-- Ciclo de distribuição: múltiplas configurações nomeadas, com uma única ativa.
-- Evolução compatível com 2026-09-19_gestor_modulos_e_ciclo_distribuicao.sql.

alter table public.a1_pa_ciclo_config
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists nome text,
  add column if not exists empresa_id uuid,
  add column if not exists correspondente_id uuid references public.a1_partners(id);

update public.a1_pa_ciclo_config c
set nome=coalesce(nullif(trim(c.nome),''),'Configuração principal'),
    empresa_id=coalesce(c.empresa_id,(select x.empresa_id from public.a1_pa_ciclo_participantes x where x.tenant_id=c.tenant_id order by x.ordem limit 1)),
    correspondente_id=coalesce(c.correspondente_id,(select x.correspondente_id from public.a1_pa_ciclo_participantes x where x.tenant_id=c.tenant_id order by x.ordem limit 1))
where c.nome is null or c.empresa_id is null or c.correspondente_id is null;

update public.a1_pa_ciclo_config
set nome=coalesce(nullif(trim(nome),''),'Configuração principal')
where nome is null or trim(nome)='';

alter table public.a1_pa_ciclo_config alter column id set not null;
alter table public.a1_pa_ciclo_config alter column nome set not null;
alter table public.a1_pa_ciclo_config drop constraint if exists a1_pa_ciclo_config_pkey;
alter table public.a1_pa_ciclo_config add primary key (id);

alter table public.a1_pa_ciclo_participantes add column if not exists config_id uuid;
update public.a1_pa_ciclo_participantes p
set config_id=c.id
from public.a1_pa_ciclo_config c
where c.tenant_id=p.tenant_id and p.config_id is null;
alter table public.a1_pa_ciclo_participantes alter column config_id set not null;
alter table public.a1_pa_ciclo_participantes
  drop constraint if exists a1_pa_ciclo_participantes_tenant_id_analista_id_key;
alter table public.a1_pa_ciclo_participantes
  drop constraint if exists a1_pa_ciclo_participantes_tenant_id_ordem_key;
alter table public.a1_pa_ciclo_participantes
  drop constraint if exists a1_pa_ciclo_participantes_config_id_fkey;
alter table public.a1_pa_ciclo_participantes
  add constraint a1_pa_ciclo_participantes_config_id_fkey
  foreign key (config_id) references public.a1_pa_ciclo_config(id) on delete cascade;
alter table public.a1_pa_ciclo_participantes
  add constraint a1_pa_ciclo_participantes_config_analista_key unique (config_id,analista_id);
alter table public.a1_pa_ciclo_participantes
  add constraint a1_pa_ciclo_participantes_config_ordem_key unique (config_id,ordem);

create unique index if not exists a1_pa_ciclo_config_nome_tenant_key
  on public.a1_pa_ciclo_config(tenant_id,lower(nome));
create unique index if not exists a1_pa_ciclo_config_uma_ativa_key
  on public.a1_pa_ciclo_config(tenant_id) where ativo;
create index if not exists a1_pa_ciclo_part_config
  on public.a1_pa_ciclo_participantes(config_id,ativo,ordem);

alter table public.a1_pa_ciclo_distribuicoes
  add column if not exists config_id uuid,
  add column if not exists config_nome text;

update public.a1_pa_ciclo_distribuicoes d
set config_id=c.id,config_nome=c.nome
from public.a1_pa_ciclo_config c
where c.tenant_id=d.tenant_id and d.config_id is null;

create or replace function public.a1_pa_ciclo_estado()
returns jsonb language sql stable security definer
set search_path=public, extensions, pg_temp as $$
  select jsonb_build_object(
    'ativo',c.id is not null,
    'config_id',c.id,
    'config_nome',c.nome,
    'modo',coalesce(c.modo,'LIVRE')
  )
  from (select public.a1_tenant() tenant_id) s
  left join lateral (
    select x.id,x.nome,x.modo
    from public.a1_pa_ciclo_config x
    where x.tenant_id=s.tenant_id and x.ativo
    limit 1
  ) c on true;
$$;

create or replace function public.a1_pa_ciclo_configuracoes()
returns jsonb language plpgsql stable security definer
set search_path=public, extensions, pg_temp as $$
declare v_tenant uuid:=public.a1_tenant(); v_result jsonb;
begin
  if v_tenant is null or not public.a1_e_gestor() or not public.a1_gestor_modulo('PRE_ANALISE') then
    raise exception 'sem_permissao';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'nome',c.nome,'ativo',c.ativo,'modo',c.modo,
    'empresa_id',c.empresa_id,'empresa',e.name,
    'correspondente_id',c.correspondente_id,'correspondente',co.name,
    'proxima_ordem',c.proxima_ordem,
    'participantes',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'analista_id',p.analista_id,'analista',an.name,'ordem',p.ordem,
      'ativo',p.ativo,
      'recebidas',(select count(*) from public.a1_pa_ciclo_distribuicoes d
        where d.tenant_id=v_tenant and d.config_id=c.id and d.analista_id=p.analista_id),
      'aprovadas',(select count(*) from public.a1_pre_analises pa
        join public.a1_pa_situacoes s on s.id=pa.situacao_id
        where pa.tenant_id=v_tenant and pa.analista_id=p.analista_id and s.selo='FIM_POSITIVO')
    ) order by p.ordem) from public.a1_pa_ciclo_participantes p
      join public.a1_partners an on an.id=p.analista_id
      where p.config_id=c.id),'[]'::jsonb),
    'atualizado_em',c.atualizado_em
  ) order by c.ativo desc,c.atualizado_em desc),'[]'::jsonb) into v_result
  from public.a1_pa_ciclo_config c
  left join public.a1_corr_empresas e on e.id=c.empresa_id
  left join public.a1_partners co on co.id=c.correspondente_id
  where c.tenant_id=v_tenant;
  return jsonb_build_object('configuracoes',v_result);
end $$;

create or replace function public.a1_pa_ciclo_salvar_configuracao(
  p_config_id uuid, p_nome text, p_modo text, p_empresa_id uuid,
  p_correspondente_id uuid, p_analistas jsonb
) returns jsonb language plpgsql security definer
set search_path=public, extensions, pg_temp as $$
declare
  v_tenant uuid:=public.a1_tenant(); v_id uuid:=p_config_id; v_nome text:=trim(coalesce(p_nome,''));
  v_modo text:=upper(coalesce(p_modo,'')); v_item jsonb; v_ana uuid; v_ordem int:=0;
  v_antes jsonb; v_ativo boolean:=false;
begin
  if v_tenant is null or not public.a1_e_gestor() or not public.a1_gestor_modulo('PRE_ANALISE') then raise exception 'sem_permissao'; end if;
  if v_nome='' or length(v_nome)>100 then raise exception 'nome_invalido'; end if;
  if v_modo not in ('LIVRE','DESEMPENHO') then raise exception 'modo_invalido'; end if;
  if jsonb_typeof(coalesce(p_analistas,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_analistas,'[]'::jsonb))=0 then raise exception 'selecione_analistas'; end if;
  if not exists(select 1 from public.a1_corr_empresas e where e.id=p_empresa_id and e.tenant_id=v_tenant) then raise exception 'empresa_invalida'; end if;
  if not exists(select 1 from public.a1_partners p where p.id=p_correspondente_id and p.tenant_id=v_tenant and p.type='cca' and p.is_active and p.approved and p.empresa_id=p_empresa_id) then raise exception 'correspondente_invalido'; end if;

  perform pg_advisory_xact_lock(hashtextextended('a1_pa_ciclo:'||v_tenant::text,0));
  if v_id is not null then
    select to_jsonb(c),c.ativo into v_antes,v_ativo from public.a1_pa_ciclo_config c where c.id=v_id and c.tenant_id=v_tenant for update;
    if not found then raise exception 'configuracao_invalida'; end if;
  else
    v_id:=gen_random_uuid();
  end if;

  for v_item in select value from jsonb_array_elements(p_analistas) loop
    v_ana:=(v_item#>>'{}')::uuid;
    if not exists(select 1 from public.a1_partners p where p.id=v_ana and p.tenant_id=v_tenant and p.type='analista' and p.is_active and p.approved and p.empresa_id=p_empresa_id) then raise exception 'analista_invalido'; end if;
    if (select count(*) from jsonb_array_elements(p_analistas) x where x#>>'{}'=v_ana::text)>1 then raise exception 'analista_duplicado'; end if;
  end loop;

  insert into public.a1_pa_ciclo_config(id,tenant_id,nome,ativo,modo,empresa_id,correspondente_id,proxima_ordem,atualizado_em,atualizado_por)
  values(v_id,v_tenant,v_nome,v_ativo,v_modo,p_empresa_id,p_correspondente_id,1,now(),public.a1_current_user_id())
  on conflict(id) do update set nome=excluded.nome,modo=excluded.modo,empresa_id=excluded.empresa_id,
    correspondente_id=excluded.correspondente_id,
    proxima_ordem=case when a1_pa_ciclo_config.modo<>excluded.modo then 1 else a1_pa_ciclo_config.proxima_ordem end,
    atualizado_em=now(),atualizado_por=excluded.atualizado_por;

  delete from public.a1_pa_ciclo_participantes where config_id=v_id;
  for v_item in select value from jsonb_array_elements(p_analistas) loop
    v_ordem:=v_ordem+1; v_ana:=(v_item#>>'{}')::uuid;
    insert into public.a1_pa_ciclo_participantes(config_id,tenant_id,empresa_id,correspondente_id,analista_id,ordem)
    values(v_id,v_tenant,p_empresa_id,p_correspondente_id,v_ana,v_ordem);
  end loop;
  insert into public.a1_pa_ciclo_auditoria(tenant_id,ator_id,acao,antes,depois)
  values(v_tenant,public.a1_current_user_id(),case when p_config_id is null then 'CONFIGURACAO_CRIADA' else 'CONFIGURACAO_EDITADA' end,
    v_antes,jsonb_build_object('id',v_id,'nome',v_nome,'modo',v_modo,'empresa_id',p_empresa_id,'correspondente_id',p_correspondente_id,'analistas',p_analistas));
  return jsonb_build_object('ok',true,'config_id',v_id);
exception when unique_violation then
  raise exception 'nome_ja_utilizado';
end $$;

create or replace function public.a1_pa_ciclo_ativar(p_config_id uuid)
returns jsonb language plpgsql security definer
set search_path=public, extensions, pg_temp as $$
declare v_tenant uuid:=public.a1_tenant(); v_nome text; v_anterior jsonb;
begin
  if v_tenant is null or not public.a1_e_gestor() or not public.a1_gestor_modulo('PRE_ANALISE') then raise exception 'sem_permissao'; end if;
  perform pg_advisory_xact_lock(hashtextextended('a1_pa_ciclo:'||v_tenant::text,0));
  select nome into v_nome from public.a1_pa_ciclo_config where id=p_config_id and tenant_id=v_tenant for update;
  if not found then raise exception 'configuracao_invalida'; end if;
  if not exists(select 1 from public.a1_pa_ciclo_participantes where config_id=p_config_id and ativo) then raise exception 'ciclo_sem_participante'; end if;
  select to_jsonb(c) into v_anterior from public.a1_pa_ciclo_config c where c.tenant_id=v_tenant and c.ativo;
  update public.a1_pa_ciclo_config set ativo=false,atualizado_em=now(),atualizado_por=public.a1_current_user_id() where tenant_id=v_tenant and ativo;
  update public.a1_pa_ciclo_config set ativo=true,proxima_ordem=1,atualizado_em=now(),atualizado_por=public.a1_current_user_id() where id=p_config_id;
  update public.a1_pa_ciclo_participantes set peso_atual=0 where config_id=p_config_id;
  insert into public.a1_pa_ciclo_auditoria(tenant_id,ator_id,acao,antes,depois)
  values(v_tenant,public.a1_current_user_id(),'CONFIGURACAO_ATIVADA',v_anterior,jsonb_build_object('id',p_config_id,'nome',v_nome));
  return jsonb_build_object('ok',true,'config_id',p_config_id,'nome',v_nome);
end $$;

-- Mantém a versão anterior do frontend funcional durante um deploy SQL-first.
create or replace function public.a1_pa_ciclo_salvar(p_ativo boolean, p_modo text, p_participantes jsonb)
returns jsonb language plpgsql security definer
set search_path=public, extensions, pg_temp as $$
declare
  v_tenant uuid:=public.a1_tenant(); v_id uuid; v_nome text; v_primeiro jsonb; v_analistas jsonb;
begin
  if jsonb_typeof(coalesce(p_participantes,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_participantes,'[]'::jsonb))=0 then
    raise exception 'selecione_analistas';
  end if;
  select c.id,c.nome into v_id,v_nome from public.a1_pa_ciclo_config c
  where c.tenant_id=v_tenant order by c.ativo desc,c.atualizado_em desc limit 1;
  v_primeiro:=p_participantes->0;
  select jsonb_agg(to_jsonb(x.value->>'analista_id')) into v_analistas from jsonb_array_elements(p_participantes) x;
  perform public.a1_pa_ciclo_salvar_configuracao(v_id,coalesce(v_nome,'Configuração principal'),p_modo,
    (v_primeiro->>'empresa_id')::uuid,(v_primeiro->>'correspondente_id')::uuid,v_analistas);
  if v_id is null then
    select c.id into v_id from public.a1_pa_ciclo_config c where c.tenant_id=v_tenant order by c.atualizado_em desc limit 1;
  end if;
  if coalesce(p_ativo,false) then
    perform public.a1_pa_ciclo_ativar(v_id);
  else
    update public.a1_pa_ciclo_config set ativo=false,atualizado_em=now(),atualizado_por=public.a1_current_user_id()
    where id=v_id and tenant_id=v_tenant;
  end if;
  return public.a1_pa_ciclo_configuracao();
end $$;

-- Compatibilidade temporária para a tela anterior durante a ordem de deploy.
create or replace function public.a1_pa_ciclo_configuracao()
returns jsonb language plpgsql stable security definer
set search_path=public, extensions, pg_temp as $$
declare v_lista jsonb; v_cfg jsonb;
begin
  v_lista:=public.a1_pa_ciclo_configuracoes();
  select value into v_cfg from jsonb_array_elements(v_lista->'configuracoes')
  order by coalesce((value->>'ativo')::boolean,false) desc limit 1;
  return coalesce(v_cfg,jsonb_build_object('ativo',false,'modo','LIVRE','participantes','[]'::jsonb));
end $$;

create or replace function public.a1_pa_ciclo_distribuir()
returns trigger language plpgsql security definer
set search_path=public, extensions, pg_temp as $$
declare
  v_cfg public.a1_pa_ciclo_config%rowtype; v_p public.a1_pa_ciclo_participantes%rowtype;
  v_exist public.a1_pa_ciclo_distribuicoes%rowtype; v_total int:=0; v_min int; v_max int;
  v_aprov int; v_peso int; v_novo numeric; v_melhor numeric:=null;
begin
  select * into v_cfg from public.a1_pa_ciclo_config where tenant_id=new.tenant_id and ativo limit 1;
  if not found then return new; end if;
  select * into v_exist from public.a1_pa_ciclo_distribuicoes where pre_analise_id=new.id;
  if found then new.empresa_id:=v_exist.empresa_id; new.correspondente_id:=v_exist.correspondente_id; new.analista_id:=v_exist.analista_id; return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('a1_pa_ciclo:'||new.tenant_id::text,0));
  select * into v_cfg from public.a1_pa_ciclo_config where tenant_id=new.tenant_id and ativo limit 1 for update;
  if not found then return new; end if;

  if v_cfg.modo='LIVRE' then
    select p.* into v_p from public.a1_pa_ciclo_participantes p
      join public.a1_partners co on co.id=p.correspondente_id and co.is_active and co.approved and co.type='cca' and co.empresa_id=p.empresa_id
      join public.a1_partners an on an.id=p.analista_id and an.is_active and an.approved and an.type='analista' and an.empresa_id=p.empresa_id
      where p.config_id=v_cfg.id and p.ativo and p.ordem>=v_cfg.proxima_ordem order by p.ordem limit 1;
    if not found then
      select p.* into v_p from public.a1_pa_ciclo_participantes p
        join public.a1_partners co on co.id=p.correspondente_id and co.is_active and co.approved and co.type='cca' and co.empresa_id=p.empresa_id
        join public.a1_partners an on an.id=p.analista_id and an.is_active and an.approved and an.type='analista' and an.empresa_id=p.empresa_id
        where p.config_id=v_cfg.id and p.ativo order by p.ordem limit 1;
    end if;
    if v_p.id is null then raise exception 'ciclo_sem_participante_elegivel'; end if;
    update public.a1_pa_ciclo_config set proxima_ordem=v_p.ordem+1 where id=v_cfg.id;
    v_peso:=1;
  else
    with aprov as (
      select p.analista_id,count(s.id)::int qtd from public.a1_pa_ciclo_participantes p
      join public.a1_partners co on co.id=p.correspondente_id and co.is_active and co.approved and co.type='cca' and co.empresa_id=p.empresa_id
      join public.a1_partners an on an.id=p.analista_id and an.is_active and an.approved and an.type='analista' and an.empresa_id=p.empresa_id
      left join public.a1_pre_analises pa on pa.tenant_id=p.tenant_id and pa.analista_id=p.analista_id
      left join public.a1_pa_situacoes s on s.id=pa.situacao_id and s.selo='FIM_POSITIVO'
      where p.config_id=v_cfg.id and p.ativo group by p.analista_id
    ) select min(qtd),max(qtd) into v_min,v_max from aprov;
    for v_p in select p.* from public.a1_pa_ciclo_participantes p
      join public.a1_partners co on co.id=p.correspondente_id and co.is_active and co.approved and co.type='cca' and co.empresa_id=p.empresa_id
      join public.a1_partners an on an.id=p.analista_id and an.is_active and an.approved and an.type='analista' and an.empresa_id=p.empresa_id
      where p.config_id=v_cfg.id and p.ativo order by p.ordem
    loop
      select count(pa.id)::int into v_aprov from public.a1_pre_analises pa join public.a1_pa_situacoes s on s.id=pa.situacao_id and s.selo='FIM_POSITIVO' where pa.tenant_id=new.tenant_id and pa.analista_id=v_p.analista_id;
      v_peso:=case when coalesce(v_max,0)=coalesce(v_min,0) then 1 else 1+floor(4.0*(v_aprov-v_min)/(v_max-v_min))::int end;
      update public.a1_pa_ciclo_participantes set peso_atual=peso_atual+v_peso where id=v_p.id returning peso_atual into v_novo;
      v_total:=v_total+v_peso;
      if v_melhor is null or v_novo>v_melhor then v_melhor:=v_novo; new.analista_id:=v_p.analista_id; new.empresa_id:=v_p.empresa_id; new.correspondente_id:=v_p.correspondente_id; end if;
    end loop;
    if new.analista_id is null then raise exception 'ciclo_sem_participante_elegivel'; end if;
    select * into v_p from public.a1_pa_ciclo_participantes where config_id=v_cfg.id and analista_id=new.analista_id;
    update public.a1_pa_ciclo_participantes set peso_atual=peso_atual-v_total where id=v_p.id;
    select count(pa.id)::int into v_aprov from public.a1_pre_analises pa join public.a1_pa_situacoes s on s.id=pa.situacao_id and s.selo='FIM_POSITIVO' where pa.tenant_id=new.tenant_id and pa.analista_id=v_p.analista_id;
    v_peso:=case when coalesce(v_max,0)=coalesce(v_min,0) then 1 else 1+floor(4.0*(v_aprov-v_min)/(v_max-v_min))::int end;
  end if;
  new.empresa_id:=v_p.empresa_id; new.correspondente_id:=v_p.correspondente_id; new.analista_id:=v_p.analista_id;
  insert into public.a1_pa_ciclo_distribuicoes(config_id,config_nome,tenant_id,pre_analise_id,lead_id,corretor_id,empresa_id,correspondente_id,analista_id,modo,peso_aplicado,aprovacoes_no_momento)
  values(v_cfg.id,v_cfg.nome,new.tenant_id,new.id,new.lead_id,new.corretor_id,new.empresa_id,new.correspondente_id,new.analista_id,v_cfg.modo,v_peso,coalesce(v_aprov,0));
  return new;
end $$;

revoke all on function public.a1_pa_ciclo_configuracoes() from public;
revoke all on function public.a1_pa_ciclo_salvar_configuracao(uuid,text,text,uuid,uuid,jsonb) from public;
revoke all on function public.a1_pa_ciclo_ativar(uuid) from public;
grant execute on function public.a1_pa_ciclo_configuracoes() to anon, authenticated;
grant execute on function public.a1_pa_ciclo_salvar_configuracao(uuid,text,text,uuid,uuid,jsonb) to anon, authenticated;
grant execute on function public.a1_pa_ciclo_ativar(uuid) to anon, authenticated;
