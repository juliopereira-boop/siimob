-- Venda herda a carteira da Pré-análise.
-- O backfill só preenche campos vazios para não apagar redistribuições já feitas.

update public.a1_comerciais co
set analista_id = pa.analista_id,
    correspondente_id = pa.correspondente_id
from public.a1_pre_analises pa
where pa.id = co.pre_analise_id
  and pa.tenant_id = co.tenant_id
  and (co.analista_id is null or co.correspondente_id is null)
  and (
    co.analista_id is distinct from pa.analista_id
    or co.correspondente_id is distinct from pa.correspondente_id
  );

create or replace function public.a1_criar_comercial(p_pre_analise uuid)
returns uuid
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_pa a1_pre_analises%rowtype;
  v_cred a1_pa_analises_credito%rowtype;
  v_id uuid;
  v_sit uuid;
  v_snap jsonb;
begin
  perform set_config('a1.orquestrador', '1', true);
  select * into v_pa from a1_pre_analises where id = p_pre_analise;
  if v_pa.id is null then raise exception 'pre_analise_inexistente'; end if;
  if v_pa.tenant_id <> a1_tenant() then raise exception 'fora_do_cliente'; end if;

  perform pg_advisory_xact_lock(hashtext('pa:' || p_pre_analise::text));
  select id into v_id from a1_comerciais where pre_analise_id = p_pre_analise;
  if v_id is not null then return v_id; end if;

  if not a1_tem_modulo('COMERCIAL') then
    perform a1_integra_registrar(v_pa.tenant_id,'ENABLE_COMMERCIAL','PRE_ANALISE',
      p_pre_analise,'COMERCIAL',null,'BLOQUEADO',
      'módulo Comercial não está liberado para este cliente', null, '{}'::jsonb);
    raise exception 'modulo_comercial_desabilitado';
  end if;

  select * into v_cred from a1_pa_analises_credito
   where pre_analise_id = p_pre_analise and status = 'APROVADO'
   order by versao desc limit 1;
  if v_cred.id is null then
    perform a1_integra_registrar(v_pa.tenant_id,'ENABLE_COMMERCIAL','PRE_ANALISE',
      p_pre_analise,'COMERCIAL',null,'BLOQUEADO',
      'não há decisão de crédito aprovada e válida', null, '{}'::jsonb);
    raise exception 'sem_aprovacao_valida';
  end if;

  if not exists (select 1 from a1_pa_participantes
                  where pre_analise_id = p_pre_analise and papel = 'TITULAR') then
    raise exception 'sem_titular';
  end if;

  select id into v_sit from a1_co_situacoes
   where tenant_id = v_pa.tenant_id and ativo and flag = 'INICIAL'
   order by ordem limit 1;

  v_snap := jsonb_build_object(
    'capturado_em', now(),
    'pre_analise', jsonb_build_object('id', v_pa.id, 'codigo', v_pa.codigo,
      'empreendimento_id', v_pa.empreendimento_id, 'unidade', v_pa.unidade),
    'credito', jsonb_build_object('versao', v_cred.versao,
      'valor_aprovado', v_cred.valor_aprovado, 'valor_subsidio', v_cred.valor_subsidio,
      'valor_fgts', v_cred.valor_fgts, 'valor_total', v_cred.valor_total,
      'prestacao', v_cred.prestacao, 'prazo_meses', v_cred.prazo_meses),
    'participantes', coalesce((
      select jsonb_agg(jsonb_build_object('pessoa_id', pp.pessoa_id, 'nome', pe.nome,
             'papel', pp.papel, 'renda_analisada', pp.renda_analisada))
        from a1_pa_participantes pp join a1_pa_pessoas pe on pe.id = pp.pessoa_id
       where pp.pre_analise_id = p_pre_analise), '[]'::jsonb)
  );

  insert into a1_comerciais (tenant_id, pre_analise_id, empreendimento_id, unidade,
      corretor_id, imobiliaria_id, empresa_id, analista_id, correspondente_id,
      situacao_id, origem_snapshot, criado_por)
  values (v_pa.tenant_id, v_pa.id, v_pa.empreendimento_id, v_pa.unidade,
      v_pa.corretor_id, v_pa.imobiliaria_id, v_pa.empresa_id, v_pa.analista_id,
      v_pa.correspondente_id, v_sit, v_snap, a1_ator())
  returning id into v_id;

  insert into a1_co_eventos (tenant_id, comercial_id, evento, para_situacao, ator_id, detalhe)
  values (v_pa.tenant_id, v_id, 'criado_da_pre_analise', v_sit, a1_ator(),
          jsonb_build_object('pre_analise_id', p_pre_analise));

  perform a1_integra_registrar(v_pa.tenant_id,'ENABLE_COMMERCIAL','PRE_ANALISE',
    p_pre_analise,'COMERCIAL',v_id,'OK',null,null,'{}'::jsonb);
  return v_id;
end
$fn$;
