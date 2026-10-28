-- Resumo leve do checklist para os cartões do quadro.
create or replace function public.a1_checklist_resumo(p_modulo text)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $fn$
declare v_ok boolean := false;
begin
  if p_modulo='PRE_ANALISE' then
    return coalesce((
      select jsonb_object_agg(x.id::text, jsonb_build_object('total',x.total,'concluidos',x.concluidos))
      from (
        select p.id,
          (select count(*) from public.a1_checklist_itens i where i.tenant_id=a1_tenant() and i.module_key=p_modulo and i.ativo) total,
          (select count(*) from public.a1_checklist_conclusoes c where c.tenant_id=a1_tenant() and c.module_key=p_modulo and c.processo_id=p.id and c.concluido) concluidos
        from public.a1_pre_analises p
        where p.tenant_id=a1_tenant() and a1_pa_visivel(p.corretor_id,p.empresa_id,p.analista_id,p.correspondente_id)
      ) x
    ),'{}'::jsonb);
  elsif p_modulo='COMERCIAL' then
    return coalesce((
      select jsonb_object_agg(x.id::text, jsonb_build_object('total',x.total,'concluidos',x.concluidos))
      from (
        select c.id,
          (select count(*) from public.a1_checklist_itens i where i.tenant_id=a1_tenant() and i.module_key=p_modulo and i.ativo) total,
          (select count(*) from public.a1_checklist_conclusoes q where q.tenant_id=a1_tenant() and q.module_key=p_modulo and q.processo_id=c.id and q.concluido) concluidos
        from public.a1_comerciais c
        where c.tenant_id=a1_tenant() and a1_co_visivel(c.corretor_id,c.empresa_id,c.analista_id,c.correspondente_id)
      ) x
    ),'{}'::jsonb);
  end if;
  raise exception 'modulo_invalido';
end $fn$;
revoke all on function public.a1_checklist_resumo(text) from public, anon;
grant execute on function public.a1_checklist_resumo(text) to authenticated;