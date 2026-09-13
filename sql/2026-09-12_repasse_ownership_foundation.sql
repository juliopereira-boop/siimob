-- Todo Repasse criado a partir da Venda já nasce com os vínculos técnicos
-- da carteira. Isso prepara a proteção de acesso por ID sem depender de nomes
-- digitados no cartão. assigned_user_id referencia a1_users, por isso o
-- corretor é convertido do parceiro para o usuário de login correspondente e não altera os repasses legados.

CREATE OR REPLACE FUNCTION public.a1_criar_repasse_do_comercial(p_comercial uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_co    a1_comerciais%rowtype;
  v_case  uuid;
  v_stage record;
  v_snap  jsonb;
  v_nome  text;
  v_doc   text;
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_co from a1_comerciais where id = p_comercial;
  if v_co.id is null then raise exception 'comercial_inexistente'; end if;
  if v_co.tenant_id <> a1_tenant() then raise exception 'fora_do_cliente'; end if;

  perform pg_advisory_xact_lock(hashtext('co:' || p_comercial::text));

  -- RELER DEPOIS DA TRAVA. A primeira versão lia v_co antes de travar: quatro
  -- tentativas simultâneas liam "ainda não tem repasse" ao mesmo tempo, entravam
  -- na fila e cada uma conferia a própria cópia velha — três cartões nasceram
  -- para o mesmo comercial. É o mesmo erro que furava o teto de acessos
  -- simultâneos: conferir antes de serializar não confere nada.
  select repasse_case_id into v_case from a1_comerciais where id = p_comercial for update;
  if v_case is not null then return v_case; end if;

  if not a1_tem_modulo('repasse') then
    perform a1_integra_registrar(v_co.tenant_id,'CREATE_REPASS','COMERCIAL',
      p_comercial,'REPASSE',null,'BLOQUEADO',
      'módulo Repasse não está liberado para este cliente', null, '{}'::jsonb);
    raise exception 'modulo_repasse_desabilitado';
  end if;

  v_snap := coalesce(v_co.origem_snapshot, '{}'::jsonb);
  select pe.nome, pe.documento into v_nome, v_doc
    from a1_pa_participantes pp join a1_pa_pessoas pe on pe.id = pp.pessoa_id
   where pp.pre_analise_id = v_co.pre_analise_id and pp.papel = 'TITULAR' limit 1;

  if v_nome is null then
    perform a1_integra_registrar(v_co.tenant_id,'CREATE_REPASS','COMERCIAL',
      p_comercial,'REPASSE',null,'BLOQUEADO',
      'sem titular: o cartão de Repasse exige o nome do cliente', null, '{}'::jsonb);
    raise exception 'sem_titular';
  end if;

  -- A etapa inicial é a que o cliente configurou no workflow de Repasse dele.
  select id, name into v_stage from a1_stages
   where tenant_id = v_co.tenant_id and module_key = 'repasse' and is_initial
   order by position limit 1;
  if v_stage.id is null then
    select id, name into v_stage from a1_stages
     where tenant_id = v_co.tenant_id and module_key = 'repasse'
     order by position limit 1;
  end if;
  if v_stage.id is null then
    perform a1_integra_registrar(v_co.tenant_id,'CREATE_REPASS','COMERCIAL',
      p_comercial,'REPASSE',null,'BLOQUEADO',
      'o cliente não tem etapa cadastrada no workflow de Repasse', null, '{}'::jsonb);
    raise exception 'repasse_sem_etapa';
  end if;

  insert into a1_cases (tenant_id, module_key, stage_id, stage_name, stage_entered_at,
      client_name, client_cpf, development, unit, assigned_user_id, analista_id,
      correspondente_id, empresa_id, broker_name, real_estate_name,
      is_new, new_at, payload, created_at)
  values (v_co.tenant_id, 'repasse', v_stage.id, v_stage.name, now(),
      v_nome, coalesce(v_doc,''),
      nullif(v_snap#>>'{pre_analise,empreendimento_id}',''), v_co.unidade,
      (select u.id from a1_users u
        join a1_partners p on p.tenant_id=u.tenant_id and p.cpf=u.cpf
       where p.id=v_co.corretor_id and u.tenant_id=v_co.tenant_id
       order by u.id limit 1),
      v_co.analista_id, v_co.correspondente_id, v_co.empresa_id,
      -- Com tenant_id no filtro: a função roda com privilégio de dono, então
      -- sem ele um corretor_id apontado para outro cliente traria o nome de lá.
      (select name from a1_partners
        where id = v_co.corretor_id    and tenant_id = v_co.tenant_id),
      (select name from a1_partners
        where id = v_co.imobiliaria_id and tenant_id = v_co.tenant_id),
      true, now(),
      jsonb_build_object(
        'origem', 'comercial',
        'comercial_id', p_comercial,
        'pre_analise_id', v_co.pre_analise_id,
        'valores', jsonb_build_object(
          'valor_aprovado', v_snap#>'{credito,valor_aprovado}',
          'valor_subsidio', v_snap#>'{credito,valor_subsidio}',
          'valor_fgts',     v_snap#>'{credito,valor_fgts}',
          'valor_previsto', v_snap#>'{credito,valor_total}')),
      now())
  returning id into v_case;

  update a1_comerciais set repasse_case_id = v_case, atualizado_em = now()
   where id = p_comercial;

  insert into a1_co_eventos (tenant_id, comercial_id, evento, ator_id, detalhe)
  values (v_co.tenant_id, p_comercial, 'repasse_criado', a1_ator(),
          jsonb_build_object('case_id', v_case));

  perform a1_integra_registrar(v_co.tenant_id,'CREATE_REPASS','COMERCIAL',
    p_comercial,'REPASSE',v_case,'OK',null,null,'{}'::jsonb);
  return v_case;
end $function$;


revoke all on function public.a1_criar_repasse_do_comercial(uuid) from public, anon;
grant execute on function public.a1_criar_repasse_do_comercial(uuid) to authenticated;