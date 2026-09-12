-- Mantém a autorização da transição idêntica à autorização de leitura/edição.
-- Sem os quatro vínculos, uma analista atribuída via analista_id via o cartão e
-- a edição, mas recebia "fora da sua carteira" ao mover a situação.

CREATE OR REPLACE FUNCTION public.a1_pa_transicionar(p_pre_analise uuid, p_para uuid, p_justificativa text DEFAULT NULL::text, p_versao_esperada integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_pa a1_pre_analises%rowtype;
  v_tr a1_pa_transicoes%rowtype;
  v_comercial uuid;
  v_erro text;
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_pa from a1_pre_analises where id = p_pre_analise;
  if v_pa.id is null or v_pa.tenant_id <> a1_tenant() then
    raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('PRE_ANALISE') then raise exception 'modulo_desabilitado'; end if;
  if not a1_pa_visivel(v_pa.corretor_id, v_pa.empresa_id, v_pa.analista_id, v_pa.correspondente_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('pa_editar') then raise exception 'sem_permissao'; end if;

  if p_versao_esperada is not null and p_versao_esperada <> v_pa.versao then
    raise exception 'versao_desatualizada';
  end if;

  select * into v_tr from a1_pa_transicoes
   where tenant_id = v_pa.tenant_id and ativo and para_id = p_para
     and (de_id is null or de_id = v_pa.situacao_id)
   order by (de_id is not null) desc limit 1;
  if v_tr.id is null then raise exception 'transicao_nao_permitida'; end if;

  if array_length(v_tr.papeis,1) is not null
     and not (coalesce(a1_tipo_ator(), a1_papel()) = any (v_tr.papeis))
     and not a1_e_gestor() then
    raise exception 'papel_nao_autorizado';
  end if;

  if v_tr.acao = 'ENABLE_COMMERCIAL' and v_tr.acao_modo = 'AUTO' then
    v_erro := a1_pa_pode_criar_comercial(p_pre_analise);
    if v_erro is not null then
      perform a1_integra_registrar(v_pa.tenant_id,'ENABLE_COMMERCIAL','PRE_ANALISE',
        p_pre_analise,'COMERCIAL',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
      return json_build_object('ok', false, 'erro', v_erro);
    end if;
  end if;

  if coalesce((v_tr.requisitos->>'documentos_aprovados')::boolean, false)
     and exists (select 1 from a1_pa_documentos
                  where pre_analise_id = p_pre_analise and status <> 'APROVADO') then
    raise exception 'documentos_pendentes';
  end if;

  insert into a1_pa_eventos (tenant_id, pre_analise_id, evento, de_situacao,
                             para_situacao, ator_id, detalhe)
  values (v_pa.tenant_id, p_pre_analise, 'transicao', v_pa.situacao_id, p_para,
          a1_ator(), jsonb_build_object('justificativa', p_justificativa));

  update a1_pre_analises
     set situacao_id = p_para, versao = versao + 1, atualizado_em = now()
   where id = p_pre_analise;

  if v_tr.acao = 'ENABLE_COMMERCIAL' and v_tr.acao_modo = 'AUTO' then
    v_comercial := a1_criar_comercial(p_pre_analise);
  end if;

  return json_build_object('ok', true, 'situacao_id', p_para,
                           'comercial_id', v_comercial);
end $function$
;

CREATE OR REPLACE FUNCTION public.a1_co_transicionar(p_comercial uuid, p_para uuid, p_justificativa text DEFAULT NULL::text, p_versao_esperada integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_co a1_comerciais%rowtype;
  v_tr a1_co_transicoes%rowtype;
  v_case uuid;
  v_erro text;
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_co from a1_comerciais where id = p_comercial;
  if v_co.id is null or v_co.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('COMERCIAL') then raise exception 'modulo_desabilitado'; end if;
  if not a1_co_visivel(v_co.corretor_id, v_co.empresa_id, v_co.analista_id, v_co.correspondente_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('co_editar') then raise exception 'sem_permissao'; end if;
  if p_versao_esperada is not null and p_versao_esperada <> v_co.versao then
    raise exception 'versao_desatualizada'; end if;

  select * into v_tr from a1_co_transicoes
   where tenant_id = v_co.tenant_id and ativo and para_id = p_para
     and (de_id is null or de_id = v_co.situacao_id)
   order by (de_id is not null) desc limit 1;
  if v_tr.id is null then raise exception 'transicao_nao_permitida'; end if;

  if array_length(v_tr.papeis,1) is not null
     and not (coalesce(a1_tipo_ator(), a1_papel()) = any (v_tr.papeis))
     and not a1_e_gestor() then
    raise exception 'papel_nao_autorizado';
  end if;

  -- Exigir contrato assinado é OPÇÃO do cliente, marcada na transição — e não
  -- uma regra fixa do sistema. CREATE_REPASS pode estar em qualquer etapa.
  if coalesce((v_tr.requisitos->>'contrato_assinado')::boolean, false)
     and not exists (select 1 from a1_co_contratos
                      where comercial_id = p_comercial and status = 'ASSINADO') then
    raise exception 'contrato_nao_assinado';
  end if;

  if v_tr.acao = 'CREATE_REPASS' and v_tr.acao_modo = 'AUTO' then
    v_erro := a1_co_pode_criar_repasse(p_comercial);
    if v_erro is not null then
      perform a1_integra_registrar(v_co.tenant_id,'CREATE_REPASS','COMERCIAL',
        p_comercial,'REPASSE',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
      return json_build_object('ok', false, 'erro', v_erro);
    end if;
  end if;

  insert into a1_co_eventos (tenant_id, comercial_id, evento, de_situacao,
                             para_situacao, ator_id, detalhe)
  values (v_co.tenant_id, p_comercial, 'transicao', v_co.situacao_id, p_para,
          a1_ator(), jsonb_build_object('justificativa', p_justificativa));

  update a1_comerciais set situacao_id = p_para, versao = versao + 1,
                           atualizado_em = now()
   where id = p_comercial;

  if v_tr.acao = 'CREATE_REPASS' and v_tr.acao_modo = 'AUTO' then
    v_case := a1_criar_repasse_do_comercial(p_comercial);
  end if;

  return json_build_object('ok', true, 'situacao_id', p_para, 'repasse_case_id', v_case);
end $function$;
