-- Checklist operacional configurável por módulo.
-- Itens são definidos pelo gestor; conclusões pertencem ao processo e são
-- acessadas apenas pelas RPCs que conferem carteira e permissão.

create table if not exists public.a1_checklist_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  module_key text not null check (module_key in ('PRE_ANALISE','COMERCIAL','REPASSE')),
  nome text not null check (length(trim(nome)) between 1 and 160),
  obrigatorio boolean not null default false,
  ativo boolean not null default true,
  ordem integer not null default 0,
  criado_em timestamptz not null default now(),
  unique (tenant_id, module_key, nome)
);

create table if not exists public.a1_checklist_conclusoes (
  tenant_id uuid not null,
  module_key text not null check (module_key in ('PRE_ANALISE','COMERCIAL','REPASSE')),
  processo_id uuid not null,
  item_id uuid not null references public.a1_checklist_itens(id) on delete cascade,
  concluido boolean not null default false,
  concluido_por uuid null,
  concluido_em timestamptz null,
  primary key (tenant_id, module_key, processo_id, item_id)
);

alter table public.a1_checklist_itens enable row level security;
alter table public.a1_checklist_conclusoes enable row level security;

drop policy if exists checklist_itens_gestao on public.a1_checklist_itens;
create policy checklist_itens_gestao on public.a1_checklist_itens
for all using (tenant_id = a1_tenant() and (a1_e_gestor() or a1_perm('gerente')))
with check (tenant_id = a1_tenant() and (a1_e_gestor() or a1_perm('gerente')));

create or replace function public.a1_checklist_listar(p_modulo text, p_processo uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $fn$
declare v_ok boolean := false;
begin
  if p_modulo = 'PRE_ANALISE' then
    select a1_pa_visivel(corretor_id,empresa_id,analista_id,correspondente_id) into v_ok
    from public.a1_pre_analises where id=p_processo and tenant_id=a1_tenant();
  elsif p_modulo = 'COMERCIAL' then
    select a1_co_visivel(corretor_id,empresa_id,analista_id,correspondente_id) into v_ok
    from public.a1_comerciais where id=p_processo and tenant_id=a1_tenant();
  end if;
  if coalesce(v_ok,false) is not true then raise exception 'sem_acesso'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',i.id,'nome',i.nome,'obrigatorio',i.obrigatorio,'concluido',coalesce(c.concluido,false),
      'concluido_por',c.concluido_por,'concluido_em',c.concluido_em
    ) order by i.ordem,i.nome)
    from public.a1_checklist_itens i
    left join public.a1_checklist_conclusoes c
      on c.tenant_id=i.tenant_id and c.module_key=i.module_key and c.item_id=i.id and c.processo_id=p_processo
    where i.tenant_id=a1_tenant() and i.module_key=p_modulo and i.ativo
  ),'[]'::jsonb);
end $fn$;

create or replace function public.a1_checklist_marcar(p_modulo text, p_processo uuid, p_item uuid, p_concluido boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp
as $fn$
declare v_ok boolean := false; v_edita boolean := false; v_tenant uuid := a1_tenant();
begin
  if p_modulo = 'PRE_ANALISE' then
    select a1_pa_visivel(corretor_id,empresa_id,analista_id,correspondente_id), a1_perm('pa_editar')
      into v_ok,v_edita from public.a1_pre_analises where id=p_processo and tenant_id=v_tenant;
  elsif p_modulo = 'COMERCIAL' then
    select a1_co_visivel(corretor_id,empresa_id,analista_id,correspondente_id), a1_perm('co_editar')
      into v_ok,v_edita from public.a1_comerciais where id=p_processo and tenant_id=v_tenant;
  end if;
  if coalesce(v_ok,false) is not true then raise exception 'sem_acesso'; end if;
  if coalesce(v_edita,false) is not true then raise exception 'sem_permissao'; end if;
  if not exists (select 1 from public.a1_checklist_itens
                 where id=p_item and tenant_id=v_tenant and module_key=p_modulo and ativo) then
    raise exception 'item_nao_encontrado';
  end if;

  insert into public.a1_checklist_conclusoes
    (tenant_id,module_key,processo_id,item_id,concluido,concluido_por,concluido_em)
  values (v_tenant,p_modulo,p_processo,p_item,p_concluido,
    case when p_concluido then a1_ator() else null end,
    case when p_concluido then now() else null end)
  on conflict (tenant_id,module_key,processo_id,item_id) do update set
    concluido=excluded.concluido, concluido_por=excluded.concluido_por, concluido_em=excluded.concluido_em;

  if p_modulo='PRE_ANALISE' then
    insert into public.a1_pa_eventos (tenant_id,pre_analise_id,evento,ator_id,ator_nome,detalhe)
    values (v_tenant,p_processo,'checklist_atualizado',a1_ator(),a1_evento_nome_ator(),
      jsonb_build_object('item_id',p_item,'concluido',p_concluido));
  else
    insert into public.a1_co_eventos (tenant_id,comercial_id,evento,ator_id,ator_nome,detalhe)
    values (v_tenant,p_processo,'checklist_atualizado',a1_ator(),a1_evento_nome_ator(),
      jsonb_build_object('item_id',p_item,'concluido',p_concluido));
  end if;
  return jsonb_build_object('ok',true,'concluido',p_concluido);
end $fn$;

revoke all on function public.a1_checklist_listar(text,uuid) from public,anon;
grant execute on function public.a1_checklist_listar(text,uuid) to authenticated;
revoke all on function public.a1_checklist_marcar(text,uuid,uuid,boolean) from public,anon;
grant execute on function public.a1_checklist_marcar(text,uuid,uuid,boolean) to authenticated;
