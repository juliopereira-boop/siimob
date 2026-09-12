-- Venda → Repasse por selo de workflow.
-- A chegada à situação marcada VENDIDO chama o mesmo criador idempotente
-- já usado pelas transições CREATE_REPASS. Se Repasse não estiver apto,
-- a transição é recusada, evitando uma venda vendida sem repasse correspondente.

create or replace function public.a1_co_transicionar(
  p_comercial uuid, p_para uuid, p_justificativa text default null, p_versao_esperada integer default null
) returns json
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_co a1_comerciais%rowtype;
  v_tr a1_co_transicoes%rowtype;
  v_case uuid;
  v_erro text;
  v_destino_vendido boolean := false;
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_co from a1_comerciais where id = p_comercial;
  if v_co.id is null or v_co.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('COMERCIAL') then raise exception 'modulo_desabilitado'; end if;
  if not a1_co_visivel(v_co.corretor_id, v_co.empresa_id, v_co.analista_id, v_co.correspondente_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('co_mover') then raise exception 'sem_permissao'; end if;
  if p_versao_esperada is not null and p_versao_esperada <> v_co.versao then raise exception 'versao_desatualizada'; end if;

  select * into v_tr from a1_co_transicoes
   where tenant_id = v_co.tenant_id and ativo and para_id = p_para
     and (de_id is null or de_id = v_co.situacao_id)
   order by (de_id is not null) desc limit 1;
  if v_tr.id is null then raise exception 'transicao_nao_permitida'; end if;

  if array_length(v_tr.papeis,1) is not null
     and not (coalesce(a1_tipo_ator(), a1_papel()) = any (v_tr.papeis))
     and not a1_e_gestor() then raise exception 'papel_nao_autorizado'; end if;

  if coalesce((v_tr.requisitos->>'contrato_assinado')::boolean, false)
     and not exists (select 1 from a1_co_contratos
                     where comercial_id = p_comercial and status = 'ASSINADO') then
    raise exception 'contrato_nao_assinado';
  end if;

  select exists(
    select 1 from a1_co_situacoes
    where id = p_para and tenant_id = v_co.tenant_id and ativo and selo = 'VENDIDO'
  ) into v_destino_vendido;

  if (v_tr.acao = 'CREATE_REPASS' and v_tr.acao_modo = 'AUTO') or v_destino_vendido then
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

  if (v_tr.acao = 'CREATE_REPASS' and v_tr.acao_modo = 'AUTO') or v_destino_vendido then
    v_case := a1_criar_repasse_do_comercial(p_comercial);
  end if;

  return json_build_object('ok', true, 'situacao_id', p_para, 'repasse_case_id', v_case);
end
$fn$;
