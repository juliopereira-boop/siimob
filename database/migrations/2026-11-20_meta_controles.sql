-- ════════════════════════════════════════════════════════════════════════════
-- Meta Lead Ads: inativar, desconectar e "todos os formulários" por página.
--
-- 1. siimob_meta_connections.ativo: a empresa pausa o recebimento sem perder a
--    conexão. Os avisos que chegarem pausados ficam guardados como "ignorado"
--    (integracao_inativa) e podem ser reprocessados ao reativar (até 7 dias).
-- 2. siimob_meta_pages.todos_formularios: a página aceita lead de qualquer
--    formulário, inclusive os criados depois. Formulário sem funil escolhido
--    vai para o primeiro funil. replace_pages passa a preservar a opção.
-- 3. siimob_meta_desconectar: apaga o token e as páginas da empresa. As
--    escolhas de formulário e o histórico de avisos ficam, para a reconexão
--    voltar como estava.
--
-- Idempotente: pode rodar mais de uma vez. Só a chave de serviço executa.
-- Nada aqui altera dado de cliente existente: colunas novas nascem com o
-- comportamento de hoje (ativo = true, todos_formularios = false).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.siimob_meta_connections
  add column if not exists ativo boolean not null default true;

alter table public.siimob_meta_pages
  add column if not exists todos_formularios boolean not null default false;

-- A troca de páginas apaga e regrava as linhas; a opção de cada página que
-- continua escolhida é guardada antes e devolvida depois.
create or replace function public.siimob_meta_replace_pages(p_tenant uuid, p_version timestamptz, p_pages jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_version timestamptz;
  v_todos jsonb;
begin
  if jsonb_typeof(p_pages) is distinct from 'array' or jsonb_array_length(p_pages) > 500 then
    return 'invalid';
  end if;
  select connected_at into v_version from public.siimob_meta_connections
    where tenant_id = p_tenant for update;
  if not found or v_version is distinct from p_version then return 'connection_changed'; end if;
  select coalesce(jsonb_object_agg(page_id, todos_formularios), '{}'::jsonb) into v_todos
    from public.siimob_meta_pages where tenant_id = p_tenant;
  begin
    delete from public.siimob_meta_pages where tenant_id = p_tenant;
    insert into public.siimob_meta_pages (tenant_id, page_id, page_name, todos_formularios)
      select p_tenant, item->>'id', item->>'name', coalesce((v_todos->>(item->>'id'))::boolean, false)
      from jsonb_array_elements(p_pages) item;
  exception when unique_violation then
    return 'page_conflict';
  end;
  return 'ok';
end;
$$;
revoke all on function public.siimob_meta_replace_pages(uuid,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.siimob_meta_replace_pages(uuid,timestamptz,jsonb) to service_role;

create or replace function public.siimob_meta_pagina_opcoes(p_tenant uuid, p_page text, p_todos boolean)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_todos is null then return 'invalid'; end if;
  update public.siimob_meta_pages set todos_formularios = p_todos
    where tenant_id = p_tenant and page_id = p_page;
  if not found then return 'page_not_selected'; end if;
  return 'ok';
end;
$$;
revoke all on function public.siimob_meta_pagina_opcoes(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.siimob_meta_pagina_opcoes(uuid,text,boolean) to service_role;

create or replace function public.siimob_meta_definir_ativo(p_tenant uuid, p_ativo boolean)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_ativo is null then return 'invalid'; end if;
  update public.siimob_meta_connections set ativo = p_ativo where tenant_id = p_tenant;
  if not found then return 'not_connected'; end if;
  return 'ok';
end;
$$;
revoke all on function public.siimob_meta_definir_ativo(uuid,boolean) from public, anon, authenticated;
grant execute on function public.siimob_meta_definir_ativo(uuid,boolean) to service_role;

-- As páginas referenciam a conexão (FK sem cascata): saem primeiro.
create or replace function public.siimob_meta_desconectar(p_tenant uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  delete from public.siimob_meta_pages where tenant_id = p_tenant;
  delete from public.siimob_meta_connections where tenant_id = p_tenant;
  if not found then return 'not_connected'; end if;
  return 'ok';
end;
$$;
revoke all on function public.siimob_meta_desconectar(uuid) from public, anon, authenticated;
grant execute on function public.siimob_meta_desconectar(uuid) to service_role;

