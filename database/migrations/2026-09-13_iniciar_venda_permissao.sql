-- A criação de Venda a partir da Pré-análise é uma capacidade própria.
-- Não depende de editar ou mover a esteira; o banco continua exigindo carteira,
-- módulo habilitado e os requisitos do selo de fim positivo.

CREATE OR REPLACE FUNCTION public.a1_pa_executar_acao(p_pre_analise uuid, p_acao text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_erro text; v_pa a1_pre_analises%rowtype;
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_pa from a1_pre_analises where id = p_pre_analise;
  if v_pa.id is null or v_pa.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('PRE_ANALISE') then raise exception 'modulo_desabilitado'; end if;
  if not a1_pa_visivel(v_pa.corretor_id, v_pa.empresa_id, v_pa.analista_id, v_pa.correspondente_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('pa_iniciar_venda') then raise exception 'sem_permissao'; end if;
  if p_acao <> 'ENABLE_COMMERCIAL' then raise exception 'acao_desconhecida'; end if;
  v_erro := a1_pa_pode_criar_comercial(p_pre_analise);
  if v_erro is not null then
    perform a1_integra_registrar(a1_tenant(),'ENABLE_COMMERCIAL','PRE_ANALISE',
      p_pre_analise,'COMERCIAL',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
    return json_build_object('ok', false, 'erro', v_erro);
  end if;
  return json_build_object('ok', true, 'comercial_id', a1_criar_comercial(p_pre_analise));
end $function$;

revoke all on function public.a1_pa_executar_acao(uuid,text) from public, anon;
grant execute on function public.a1_pa_executar_acao(uuid,text) to authenticated;