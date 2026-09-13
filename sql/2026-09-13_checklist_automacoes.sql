-- Automação opcional do checklist. Itens antigos seguem MANUAL.
alter table public.a1_checklist_itens
  add column if not exists acao_automatica text not null default 'MANUAL'
  check (acao_automatica in ('MANUAL','DOCUMENTO_ENVIADO','CREDITO_ANALISADO','CREDITO_APROVADO','CONTRATO_ASSINADO','REPASSE_CRIADO'));

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
      'id',i.id,'nome',i.nome,'obrigatorio',i.obrigatorio,
      'acao_automatica',i.acao_automatica,
      'automatico',i.acao_automatica <> 'MANUAL',
      'concluido',
        case i.acao_automatica
          when 'DOCUMENTO_ENVIADO' then exists (select 1 from public.a1_pa_documentos d where d.pre_analise_id=p_processo)
          when 'CREDITO_ANALISADO' then exists (select 1 from public.a1_pa_analises_credito c2 where c2.pre_analise_id=p_processo)
          when 'CREDITO_APROVADO' then exists (select 1 from public.a1_pa_analises_credito c2 where c2.pre_analise_id=p_processo and c2.status='APROVADO')
          when 'CONTRATO_ASSINADO' then exists (select 1 from public.a1_co_contratos ct where ct.comercial_id=p_processo and ct.status='ASSINADO')
          when 'REPASSE_CRIADO' then exists (select 1 from public.a1_comerciais co where co.id=p_processo and co.repasse_case_id is not null)
          else coalesce(c.concluido,false)
        end,
      'concluido_por',c.concluido_por,'concluido_em',c.concluido_em
    ) order by i.ordem,i.nome)
    from public.a1_checklist_itens i
    left join public.a1_checklist_conclusoes c
      on c.tenant_id=i.tenant_id and c.module_key=i.module_key and c.item_id=i.id and c.processo_id=p_processo
    where i.tenant_id=a1_tenant() and i.module_key=p_modulo and i.ativo
  ),'[]'::jsonb);
end $fn$;

revoke all on function public.a1_checklist_listar(text,uuid) from public, anon;
grant execute on function public.a1_checklist_listar(text,uuid) to authenticated;