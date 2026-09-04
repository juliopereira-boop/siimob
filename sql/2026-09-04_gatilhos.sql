-- =============================================================================
-- ORQUESTRADOR DE TRANSIÇÕES E GATILHOS
--
-- Toda mudança de situação passa por aqui. O navegador não move situação por
-- UPDATE direto: ele chama a função, que decide. Isso é o que garante que
-- permissão, aresta, pré-requisito e efeito sejam sempre avaliados no servidor.
--
-- IDEMPOTÊNCIA DE VERDADE, E NÃO POR TENTATIVA
-- Dois cliques, dois navegadores e dois retries simultâneos são resolvidos por
-- duas coisas que o banco garante sozinho: um índice único (uma pré-análise só
-- pode ter um comercial; um comercial só pode ter um repasse) e uma trava por
-- entidade (pg_advisory_xact_lock) que serializa as tentativas concorrentes.
-- Não dependemos de "verificar antes de inserir", que é justamente o padrão que
-- furou o teto de acessos simultâneos deste mesmo sistema.
--
-- Depende de: identidade, pre_analise e comercial.
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ─── Registro de tentativa de integração ─────────────────────────────────────
create or replace function a1_integra_registrar(
  p_tenant uuid, p_tipo text, p_origem_modulo text, p_origem_id uuid,
  p_destino_modulo text, p_destino_id uuid, p_status text, p_motivo text,
  p_idem text, p_payload jsonb)
returns void language sql security definer
set search_path = public, extensions, pg_temp as $$
  insert into a1_integra_eventos
    (tenant_id, tipo, origem_modulo, origem_id, destino_modulo, destino_id,
     status, motivo, idempotency_key, payload)
  values (p_tenant, p_tipo, p_origem_modulo, p_origem_id, p_destino_modulo,
          p_destino_id, p_status, p_motivo, p_idem, coalesce(p_payload,'{}'::jsonb))
  on conflict do nothing;
$$;


-- ─── Verificação, separada do efeito ─────────────────────────────────────────
-- O primeiro teste deste arquivo mostrou por que isto precisa existir: quando a
-- ação era barrada, a função gravava o motivo e em seguida levantava exceção —
-- e a exceção desfazia a transação inteira, inclusive a linha do motivo. O
-- bloqueio sumia da auditoria e o operador recebia um erro cru de PL/pgSQL.
--
-- Agora se verifica ANTES de mexer em qualquer coisa. Devolve null quando pode,
-- ou o motivo em texto quando não pode. Quem chama decide o que fazer, sem
-- deixar estado pela metade e sem perder o registro.
create or replace function a1_pa_pode_criar_comercial(p_pre_analise uuid)
returns text language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare v_pa a1_pre_analises%rowtype;
begin
  select * into v_pa from a1_pre_analises where id = p_pre_analise;
  if v_pa.id is null or v_pa.tenant_id <> a1_tenant() then return 'pré-análise não encontrada'; end if;
  if exists (select 1 from a1_comerciais where pre_analise_id = p_pre_analise) then return null; end if;
  if not a1_tem_modulo('COMERCIAL') then
    return 'o módulo Comercial não está liberado para este cliente'; end if;
  if not exists (select 1 from a1_pa_analises_credito
                  where pre_analise_id = p_pre_analise and status = 'APROVADO') then
    return 'não há decisão de crédito aprovada e válida'; end if;
  if not exists (select 1 from a1_pa_participantes
                  where pre_analise_id = p_pre_analise and papel = 'TITULAR') then
    return 'a pré-análise não tem titular'; end if;
  return null;
end $$;

create or replace function a1_co_pode_criar_repasse(p_comercial uuid)
returns text language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare v_co a1_comerciais%rowtype;
begin
  select * into v_co from a1_comerciais where id = p_comercial;
  if v_co.id is null or v_co.tenant_id <> a1_tenant() then return 'comercial não encontrado'; end if;
  if v_co.repasse_case_id is not null then return null; end if;
  if not a1_tem_modulo('repasse') then
    return 'o módulo Repasse não está liberado para este cliente'; end if;
  if not exists (select 1 from a1_pa_participantes
                  where pre_analise_id = v_co.pre_analise_id and papel = 'TITULAR') then
    return 'sem titular: o cartão de Repasse exige o nome do cliente'; end if;
  if not exists (select 1 from a1_stages
                  where tenant_id = v_co.tenant_id and module_key = 'repasse') then
    return 'o cliente não tem etapa cadastrada no workflow de Repasse'; end if;
  return null;
end $$;

grant execute on function a1_pa_pode_criar_comercial(uuid) to anon, authenticated;
grant execute on function a1_co_pode_criar_repasse(uuid)   to anon, authenticated;

-- ─── Ação ENABLE_COMMERCIAL ──────────────────────────────────────────────────
-- Cria o Comercial a partir de uma Pré-análise aprovada. Devolve o id do
-- comercial — o que já existir, se for uma repetição.
create or replace function a1_criar_comercial(p_pre_analise uuid)
returns uuid language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_pa   a1_pre_analises%rowtype;
  v_cred a1_pa_analises_credito%rowtype;
  v_id   uuid;
  v_sit  uuid;
  v_snap jsonb;
begin
  select * into v_pa from a1_pre_analises where id = p_pre_analise;
  if v_pa.id is null then raise exception 'pre_analise_inexistente'; end if;
  if v_pa.tenant_id <> a1_tenant() then raise exception 'fora_do_cliente'; end if;

  -- Serializa as tentativas concorrentes sobre ESTA pré-análise. Sem isto, dois
  -- cliques simultâneos leem "ainda não existe" ao mesmo tempo.
  perform pg_advisory_xact_lock(hashtext('pa:' || p_pre_analise::text));

  -- Repetição devolve o que já existe, e não um erro nem um segundo comercial.
  select id into v_id from a1_comerciais where pre_analise_id = p_pre_analise;
  if v_id is not null then return v_id; end if;

  if not a1_tem_modulo('COMERCIAL') then
    perform a1_integra_registrar(v_pa.tenant_id,'ENABLE_COMMERCIAL','PRE_ANALISE',
      p_pre_analise,'COMERCIAL',null,'BLOQUEADO',
      'módulo Comercial não está liberado para este cliente', null, '{}'::jsonb);
    raise exception 'modulo_comercial_desabilitado';
  end if;

  -- Só depois de uma decisão de aprovação VÁLIDA. Decisão invalidada por
  -- mudança de dado material não serve.
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

  -- Fotografia do que foi aprovado. Mudança posterior na Pré-análise não
  -- reescreve o que já entrou em negociação.
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
       where pp.pre_analise_id = p_pre_analise), '[]'::jsonb));

  insert into a1_comerciais (tenant_id, pre_analise_id, empreendimento_id, unidade,
      corretor_id, imobiliaria_id, empresa_id, situacao_id, origem_snapshot, criado_por)
  values (v_pa.tenant_id, v_pa.id, v_pa.empreendimento_id, v_pa.unidade,
      v_pa.corretor_id, v_pa.imobiliaria_id, v_pa.empresa_id, v_sit, v_snap, a1_ator())
  returning id into v_id;

  insert into a1_co_eventos (tenant_id, comercial_id, evento, para_situacao, ator_id, detalhe)
  values (v_pa.tenant_id, v_id, 'criado_da_pre_analise', v_sit, a1_ator(),
          jsonb_build_object('pre_analise_id', p_pre_analise));

  perform a1_integra_registrar(v_pa.tenant_id,'ENABLE_COMMERCIAL','PRE_ANALISE',
    p_pre_analise,'COMERCIAL',v_id,'OK',null,null,'{}'::jsonb);
  return v_id;
end $$;

-- ─── Ação CREATE_REPASS ──────────────────────────────────────────────────────
-- Cria o cartão no módulo de Repasse EXISTENTE. O Comercial não escreve regra
-- do Repasse: insere um cartão no formato que o Repasse já entende, na etapa
-- inicial que o próprio cliente configurou, e guarda o vínculo.
create or replace function a1_criar_repasse_do_comercial(p_comercial uuid)
returns uuid language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_co    a1_comerciais%rowtype;
  v_case  uuid;
  v_stage record;
  v_snap  jsonb;
  v_nome  text;
  v_doc   text;
begin
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
      client_name, client_cpf, development, unit, broker_name, real_estate_name,
      is_new, new_at, payload, created_at)
  values (v_co.tenant_id, 'repasse', v_stage.id, v_stage.name, now(),
      v_nome, coalesce(v_doc,''),
      nullif(v_snap#>>'{pre_analise,empreendimento_id}',''), v_co.unidade,
      (select name from a1_partners where id = v_co.corretor_id),
      (select name from a1_partners where id = v_co.imobiliaria_id),
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
end $$;

-- ─── Transição de Pré-análise ────────────────────────────────────────────────
create or replace function a1_pa_transicionar(
  p_pre_analise uuid, p_para uuid, p_justificativa text default null,
  p_versao_esperada int default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_pa a1_pre_analises%rowtype;
  v_tr a1_pa_transicoes%rowtype;
  v_comercial uuid;
  v_erro text;
begin
  select * into v_pa from a1_pre_analises where id = p_pre_analise;
  if v_pa.id is null or v_pa.tenant_id <> a1_tenant() then
    raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('PRE_ANALISE') then raise exception 'modulo_desabilitado'; end if;
  if not a1_pa_visivel(v_pa.corretor_id, v_pa.empresa_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('editar_repasses') then raise exception 'sem_permissao'; end if;

  -- Concorrência: quem carregou a tela antes de outra pessoa mover não move por
  -- cima em silêncio.
  if p_versao_esperada is not null and p_versao_esperada <> v_pa.versao then
    raise exception 'versao_desatualizada';
  end if;

  -- A aresta precisa existir. "de_id nulo" é a aresta que sai de qualquer lugar.
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

  -- Ação automática: confere ANTES de mover. Barrar depois de mudar a situação
  -- deixaria o processo num estado que ninguém pediu.
  if v_tr.acao = 'ENABLE_COMMERCIAL' and v_tr.acao_modo = 'AUTO' then
    v_erro := a1_pa_pode_criar_comercial(p_pre_analise);
    if v_erro is not null then
      perform a1_integra_registrar(v_pa.tenant_id,'ENABLE_COMMERCIAL','PRE_ANALISE',
        p_pre_analise,'COMERCIAL',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
      return json_build_object('ok', false, 'erro', v_erro);
    end if;
  end if;

  -- Documentos obrigatórios, quando a transição exigir.
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

  -- O efeito acontece na MESMA transação da transição: ou os dois valem, ou
  -- nenhum dos dois. Não há janela em que a situação mudou e o comercial não
  -- nasceu.
  if v_tr.acao = 'ENABLE_COMMERCIAL' and v_tr.acao_modo = 'AUTO' then
    v_comercial := a1_criar_comercial(p_pre_analise);
  end if;

  return json_build_object('ok', true, 'situacao_id', p_para,
                           'comercial_id', v_comercial);
end $$;

-- ─── Transição de Comercial ──────────────────────────────────────────────────
create or replace function a1_co_transicionar(
  p_comercial uuid, p_para uuid, p_justificativa text default null,
  p_versao_esperada int default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_co a1_comerciais%rowtype;
  v_tr a1_co_transicoes%rowtype;
  v_case uuid;
  v_erro text;
begin
  select * into v_co from a1_comerciais where id = p_comercial;
  if v_co.id is null or v_co.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('COMERCIAL') then raise exception 'modulo_desabilitado'; end if;
  if not a1_co_visivel(v_co.corretor_id, v_co.empresa_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('editar_repasses') then raise exception 'sem_permissao'; end if;
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
end $$;

-- ─── Invalidar decisão quando muda dado material ─────────────────────────────
-- Renda, participantes ou valores mexidos depois de aprovado derrubam a
-- aprovação. Sem isto, aprova-se com um número e negocia-se com outro.
create or replace function a1_pa_invalidar_decisao()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_pa uuid;
begin
  v_pa := coalesce(new.pre_analise_id, old.pre_analise_id);
  update a1_pa_analises_credito
     set status = 'INVALIDADA'
   where pre_analise_id = v_pa and status = 'APROVADO';
  if found then
    insert into a1_pa_eventos (tenant_id, pre_analise_id, evento, ator_id, detalhe)
    values (coalesce(new.tenant_id, old.tenant_id), v_pa, 'decisao_invalidada',
            a1_ator(), jsonb_build_object('motivo','dado material alterado'));
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_pa_part_invalida on a1_pa_participantes;
create trigger trg_pa_part_invalida
  after insert or update or delete on a1_pa_participantes
  for each row execute function a1_pa_invalidar_decisao();

-- Rede de segurança independente da trava: um cartão de Repasse pertence a um
-- comercial e a mais nenhum. Se algum dia a lógica de serialização falhar, o
-- banco recusa o segundo em vez de duplicar em silêncio.
create unique index if not exists idx_co_um_repasse
  on a1_comerciais (repasse_case_id) where repasse_case_id is not null;

-- Só a função executa os comandos. O navegador não insere em a1_comerciais
-- nem em a1_cases pelo caminho do módulo novo.
revoke all on function a1_criar_comercial(uuid)               from public, anon, authenticated;
revoke all on function a1_criar_repasse_do_comercial(uuid)    from public, anon, authenticated;
revoke all on function a1_integra_registrar(uuid,text,text,uuid,text,uuid,text,text,text,jsonb)
  from public, anon, authenticated;

grant execute on function a1_pa_transicionar(uuid,uuid,text,int) to anon, authenticated;
grant execute on function a1_co_transicionar(uuid,uuid,text,int) to anon, authenticated;

-- Execução manual da ação, quando o modo é CONFIRMAR (o operador clica).
create or replace function a1_pa_executar_acao(p_pre_analise uuid, p_acao text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_erro text;
begin
  if not a1_perm('editar_repasses') then raise exception 'sem_permissao'; end if;
  if p_acao <> 'ENABLE_COMMERCIAL' then raise exception 'acao_desconhecida'; end if;
  v_erro := a1_pa_pode_criar_comercial(p_pre_analise);
  if v_erro is not null then
    perform a1_integra_registrar(a1_tenant(),'ENABLE_COMMERCIAL','PRE_ANALISE',
      p_pre_analise,'COMERCIAL',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
    return json_build_object('ok', false, 'erro', v_erro);
  end if;
  return json_build_object('ok', true, 'comercial_id', a1_criar_comercial(p_pre_analise));
end $$;

create or replace function a1_co_executar_acao(p_comercial uuid, p_acao text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_erro text;
begin
  if not a1_perm('editar_repasses') then raise exception 'sem_permissao'; end if;
  if p_acao <> 'CREATE_REPASS' then raise exception 'acao_desconhecida'; end if;
  v_erro := a1_co_pode_criar_repasse(p_comercial);
  if v_erro is not null then
    perform a1_integra_registrar(a1_tenant(),'CREATE_REPASS','COMERCIAL',
      p_comercial,'REPASSE',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
    return json_build_object('ok', false, 'erro', v_erro);
  end if;
  return json_build_object('ok', true,
    'repasse_case_id', a1_criar_repasse_do_comercial(p_comercial));
end $$;

grant execute on function a1_pa_executar_acao(uuid,text) to anon, authenticated;
grant execute on function a1_co_executar_acao(uuid,text) to anon, authenticated;

-- =============================================================================
-- COMO CONFERIR
--   1. Chamar a1_pa_transicionar para uma pré-análise de outro cliente devolve
--      'nao_encontrado', mesmo com o id em mãos.
--   2. Com o módulo Comercial desligado, a ação ENABLE_COMMERCIAL falha e deixa
--      a linha explicando o motivo em a1_integra_eventos.
--   3. Executar a mesma ação duas vezes devolve o MESMO id nas duas.
--   4. Mexer num participante depois de aprovado deixa a decisão INVALIDADA e
--      a criação do Comercial volta a ser recusada.
-- =============================================================================
