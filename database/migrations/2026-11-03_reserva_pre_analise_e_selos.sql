-- =============================================================================
-- RESERVA A PARTIR DA PRÉ-ANÁLISE, VENDA GARANTIDA, AVALIAÇÃO NO MAPA DE PREÇO,
-- UNIDADE NA PRÉ-ANÁLISE, REGRAS DA PRÉ-ANÁLISE, SELOS DO FUNIL DE LEADS E
-- VISITA NA AGENDA
--
-- POR QUE ESTE ARQUIVO EXISTE
-- 1. A construtora quer escolher de onde a reserva começa: direto no mapa da
--    Disposição ou só a partir de uma pré-análise aprovada (selo Fim positivo).
-- 2. A reserva tem de levar o cliente para a esteira da Venda. A primeira
--    reserva feita em produção ficou sem venda porque a Venda ainda não tinha
--    situação inicial; a função registrou o bloqueio, mas a reserva passou. Agora
--    a reserva não acontece sem a venda (quando o cliente tem a Venda), e a
--    reserva que ficou para trás ganha a venda por a1_reserva_abrir_venda.
-- 3. O mapa de preço guarda também o valor de avaliação de cada unidade, que a
--    pré-análise passa a trazer sozinha ao escolher bloco e unidade.
-- 4. Regras da pré-análise (corretor, imobiliária, analista... obrigatórios ou
--    não) num lugar só, conferidas pelo banco.
-- 5. Selos no funil de Leads: Agendamento (abre a visita), Pré-análise (só ali o
--    lead vira pré-análise), Ganho e Perdido.
-- 6. A visita agendada entra na agenda do corretor e da imobiliária.
--
-- O QUE NÃO MUDA
-- - Nenhuma linha de cliente é alterada. Colunas novas nascem vazias; as
--   tabelas novas, sem linha. As regras da pré-análise nascem desligadas: sem
--   linha em a1_pa_regras nada é exigido, a não ser o cônjuge, que é conferido
--   só na tela e só para o perfil construtora.
-- - O selo do funil de Leads só existe em a1_stages de module_key 'crm'.
--   Repasse e Registro continuam sem selo.
-- - A agenda ganha o tipo 'visita'; os quatro tipos de antes continuam valendo.
-- - Nenhuma função que não seja da Disposição é redefinida. As funções novas
--   têm nome novo.
--
-- Rode no SQL Editor do Supabase, depois de 2026-11-02_disposicao_unidades.sql.
-- Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- =============================================================================
-- 1. DE ONDE A RESERVA COMEÇA
-- =============================================================================
-- LIVRE: o corretor reserva direto no mapa da Disposição.
-- PRE_ANALISE: só a partir de uma pré-análise com o selo Fim positivo.
alter table a1_disposicao_config add column if not exists origem_reserva text not null default 'LIVRE';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'a1_disposicao_config_origem_chk') then
    alter table a1_disposicao_config add constraint a1_disposicao_config_origem_chk
      check (origem_reserva in ('LIVRE', 'PRE_ANALISE'));
  end if;
end $$;

-- A reserva lembra de que pré-análise veio. Uma pré-análise segura no máximo
-- uma unidade de cada vez.
alter table a1_reservas add column if not exists pre_analise_id uuid;
create unique index if not exists idx_rs_uma_ativa_por_pa
  on a1_reservas (pre_analise_id) where status = 'ATIVA' and pre_analise_id is not null;

-- =============================================================================
-- 2. VALOR DE AVALIAÇÃO NO MAPA DE PREÇO
-- =============================================================================
alter table a1_mapa_preco_itens add column if not exists valor_avaliacao numeric(14,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'a1_mapa_preco_itens_avaliacao_chk') then
    alter table a1_mapa_preco_itens add constraint a1_mapa_preco_itens_avaliacao_chk
      check (valor_avaliacao is null or valor_avaliacao > 0);
  end if;
end $$;

-- O reajuste copia a avaliação como está: avaliação é do banco, não segue o
-- índice da tabela de venda.
create or replace function a1_mapa_preco_duplicar(p_mapa uuid, p_nome text,
  p_reajuste_pct numeric default 0, p_vigente_desde date default current_date)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_m a1_mapas_preco%rowtype; v_novo uuid;
begin
  if not a1_disp_pode('disp_configurar') then raise exception 'sem_permissao'; end if;
  select * into v_m from a1_mapas_preco where id = p_mapa;
  if v_m.id is null or v_m.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'mapa_sem_nome'; end if;
  if p_reajuste_pct is null or p_reajuste_pct <= -100 or p_reajuste_pct > 1000 then
    raise exception 'reajuste_invalido';
  end if;
  insert into a1_mapas_preco (tenant_id, empreendimento_id, nome, vigente_desde, ativo, observacao)
  values (v_m.tenant_id, v_m.empreendimento_id, trim(p_nome), coalesce(p_vigente_desde, current_date), false,
          'Criado a partir de "' || v_m.nome || '" com reajuste de ' || p_reajuste_pct || '%')
  returning id into v_novo;
  insert into a1_mapa_preco_itens (tenant_id, mapa_id, unidade_id, valor, valor_avaliacao)
  select v_m.tenant_id, v_novo, i.unidade_id, round(i.valor * (1 + p_reajuste_pct / 100.0), 2), i.valor_avaliacao
    from a1_mapa_preco_itens i where i.mapa_id = p_mapa;
  return json_build_object('ok', true, 'mapa_id', v_novo);
end $$;
grant execute on function a1_mapa_preco_duplicar(uuid, text, numeric, date) to anon, authenticated;

-- O rastro do preço passa a contar também a avaliação.
create or replace function a1_mapa_preco_itens_rastro()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_ativo boolean; v_u a1_unidades%rowtype;
begin
  select ativo into v_ativo from a1_mapas_preco where id = coalesce(new.mapa_id, old.mapa_id);
  if not coalesce(v_ativo, false) then
    return coalesce(new, old);
  end if;
  select * into v_u from a1_unidades where id = coalesce(new.unidade_id, old.unidade_id);
  if v_u.id is null then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.valor is not distinct from old.valor
     and new.valor_avaliacao is not distinct from old.valor_avaliacao then
    return new;
  end if;
  insert into a1_unidade_eventos (tenant_id, unidade_id, empreendimento_id, codigo, evento,
                                  de, para, detalhe, ator_id, ator_nome)
  values (v_u.tenant_id, v_u.id, v_u.empreendimento_id, v_u.codigo, 'PRECO',
          case when tg_op = 'INSERT' then null else old.valor::text end,
          case when tg_op = 'DELETE' then null else new.valor::text end,
          jsonb_strip_nulls(jsonb_build_object('mapa_id', coalesce(new.mapa_id, old.mapa_id),
            'avaliacao_de', case when tg_op = 'INSERT' then null else old.valor_avaliacao end,
            'avaliacao_para', case when tg_op = 'DELETE' then null else new.valor_avaliacao end)),
          a1_ator(), a1_ator_nome());
  return coalesce(new, old);
end $$;
revoke execute on function a1_mapa_preco_itens_rastro() from public, anon, authenticated;

-- =============================================================================
-- 3. A UNIDADE NA PRÉ-ANÁLISE
-- =============================================================================
-- unidade (texto) continua: é o que o Repasse, a Venda e os relatórios leem.
-- unidade_id aponta para a ficha quando o cliente tem a Disposição, e o banco
-- mantém o texto igual ao código da ficha.
alter table a1_pre_analises add column if not exists unidade_id uuid
  references a1_unidades(id) on delete set null;
create index if not exists idx_pa_unidade on a1_pre_analises (unidade_id) where unidade_id is not null;

-- Cônjuge e segundo associado entram como ASSOCIADO, com o parentesco ao lado.
-- O papel não ganhou valor novo de propósito: tudo o que soma renda, conta
-- participante ou copia para a Venda já entende ASSOCIADO.
alter table a1_pa_participantes add column if not exists parentesco text;

-- As unidades para o cadastro da pré-análise escolher bloco e unidade, com a
-- avaliação do mapa de preço que vale. Quem cria pré-análise nem sempre vê a
-- Disposição (o RLS de a1_unidades pede disp_ver); por isso a lista vem por
-- aqui, só com o que o cadastro precisa, e só para quem pode criar ou editar
-- pré-análise. Sem a Disposição, a lista é vazia e a tela segue com o campo
-- de texto de sempre.
create or replace function a1_pa_unidades_para_cadastro(p_empreendimento uuid)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
begin
  if a1_tenant() is null or not a1_tem_modulo('PRE_ANALISE') then raise exception 'sem_acesso'; end if;
  if not a1_tem_modulo('DISPOSICAO') then return '[]'::json; end if;
  if not (a1_e_gestor() or a1_perm('pa_criar') or a1_perm('pa_editar')) then raise exception 'sem_permissao'; end if;
  return coalesce((
    select json_agg(json_build_object(
        'id', u.id, 'codigo', u.codigo, 'bloco', u.bloco, 'pavimento', u.pavimento, 'numero', u.numero,
        'status', u.status, 'tipologia', u.tipologia, 'area_privativa', u.area_privativa,
        'valor', i.valor, 'valor_avaliacao', i.valor_avaliacao)
        order by u.bloco nulls first, u.pavimento nulls first, u.numero nulls first, u.codigo)
      from a1_unidades u
      left join a1_mapas_preco m on m.empreendimento_id = u.empreendimento_id and m.ativo
      left join a1_mapa_preco_itens i on i.mapa_id = m.id and i.unidade_id = u.id
     where u.tenant_id = a1_tenant() and u.empreendimento_id = p_empreendimento),
    '[]'::json);
end $$;
grant execute on function a1_pa_unidades_para_cadastro(uuid) to anon, authenticated;

-- =============================================================================
-- 4. REGRAS DA PRÉ-ANÁLISE
-- =============================================================================
create table if not exists a1_pa_regras (
  tenant_id             uuid primary key,
  exige_corretor        boolean not null default false,
  exige_imobiliaria     boolean not null default false,
  exige_analista        boolean not null default false,
  exige_empresa         boolean not null default false,
  exige_correspondente  boolean not null default false,
  exige_unidade         boolean not null default false,
  exige_valor_avaliacao boolean not null default false,
  -- Conferida na tela (o cônjuge é gravado depois da pré-análise, como
  -- participante). Sem linha nesta tabela, vale ligada só para construtora.
  exige_conjuge         boolean not null default false,
  atualizado_em         timestamptz not null default now()
);

drop trigger if exists trg_par_tenant on a1_pa_regras;
create trigger trg_par_tenant before insert on a1_pa_regras
  for each row execute function a1_disp_tenant_da_sessao();

-- As regras que valem para o cliente: a linha dele ou o padrão do perfil.
create or replace function a1_pa_regras_do_cliente(p_tenant uuid)
returns a1_pa_regras language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare v a1_pa_regras%rowtype;
begin
  select * into v from a1_pa_regras where tenant_id = p_tenant;
  if v.tenant_id is null then
    v.tenant_id := p_tenant;
    v.exige_corretor := false; v.exige_imobiliaria := false; v.exige_analista := false;
    v.exige_empresa := false; v.exige_correspondente := false; v.exige_unidade := false;
    v.exige_valor_avaliacao := false;
    v.exige_conjuge := exists (select 1 from a1_tenants t
                                where t.id = p_tenant and t.tipo_cliente = 'construtora');
  end if;
  return v;
end $$;
revoke all on function a1_pa_regras_do_cliente(uuid) from public, anon, authenticated;

-- Para a tela: as regras em vigor, com a pergunta "existe linha?" respondida.
create or replace function a1_pa_regras_vigentes()
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare v a1_pa_regras%rowtype;
begin
  if a1_tenant() is null or not a1_tem_modulo('PRE_ANALISE') then raise exception 'sem_acesso'; end if;
  v := a1_pa_regras_do_cliente(a1_tenant());
  return json_build_object(
    'exige_corretor', v.exige_corretor, 'exige_imobiliaria', v.exige_imobiliaria,
    'exige_analista', v.exige_analista, 'exige_empresa', v.exige_empresa,
    'exige_correspondente', v.exige_correspondente, 'exige_unidade', v.exige_unidade,
    'exige_valor_avaliacao', v.exige_valor_avaliacao, 'exige_conjuge', v.exige_conjuge,
    'salvas', exists (select 1 from a1_pa_regras where tenant_id = a1_tenant()));
end $$;
grant execute on function a1_pa_regras_vigentes() to anon, authenticated;

-- A guarda. Chama-se zzz_ para rodar DEPOIS do Ciclo de Distribuição
-- (zz_a1_pa_ciclo_distribuir): com o roteamento ligado, é ele quem preenche
-- analista, empresa e correspondente, e a regra confere o resultado.
create or replace function a1_pa_regras_guarda()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v a1_pa_regras%rowtype; v_u a1_unidades%rowtype;
begin
  -- A ficha da unidade: do mesmo cliente e do mesmo empreendimento. O texto
  -- acompanha o código da ficha.
  if new.unidade_id is not null
     and (tg_op = 'INSERT' or new.unidade_id is distinct from old.unidade_id
          or new.empreendimento_id is distinct from old.empreendimento_id) then
    select * into v_u from a1_unidades where id = new.unidade_id;
    if v_u.id is null or v_u.tenant_id <> new.tenant_id
       or v_u.empreendimento_id is distinct from new.empreendimento_id then
      raise exception 'unidade_fora_do_empreendimento';
    end if;
    new.unidade := v_u.codigo;
  elsif tg_op = 'UPDATE' and new.unidade_id is not null and new.unidade is distinct from old.unidade then
    -- A ficha ficou e o texto mudou: o texto volta a ser o código da ficha.
    select codigo into new.unidade from a1_unidades where id = new.unidade_id;
  end if;

  -- Sem sessão (carga pela chave de serviço) não há regra de tela a cumprir.
  if a1_tenant() is null then return new; end if;
  v := a1_pa_regras_do_cliente(new.tenant_id);

  -- Na criação, o campo exigido tem de vir. Na alteração, só barra quem
  -- APAGA um campo exigido: pré-análise antiga que já nasceu sem ele não fica
  -- presa por causa de uma regra ligada depois.
  if tg_op = 'INSERT' then
    if v.exige_corretor and new.corretor_id is null then raise exception 'pa_exige_corretor'; end if;
    if v.exige_imobiliaria and new.imobiliaria_id is null then raise exception 'pa_exige_imobiliaria'; end if;
    if v.exige_analista and new.analista_id is null then raise exception 'pa_exige_analista'; end if;
    if v.exige_empresa and new.empresa_id is null then raise exception 'pa_exige_empresa'; end if;
    if v.exige_correspondente and new.correspondente_id is null then raise exception 'pa_exige_correspondente'; end if;
    if v.exige_unidade and new.unidade_id is null and coalesce(btrim(new.unidade), '') = '' then
      raise exception 'pa_exige_unidade';
    end if;
    if v.exige_valor_avaliacao and coalesce(new.valor_avaliacao_inicial, 0) <= 0 then
      raise exception 'pa_exige_valor_avaliacao';
    end if;
  else
    if v.exige_corretor and new.corretor_id is null and old.corretor_id is not null then raise exception 'pa_exige_corretor'; end if;
    if v.exige_imobiliaria and new.imobiliaria_id is null and old.imobiliaria_id is not null then raise exception 'pa_exige_imobiliaria'; end if;
    if v.exige_analista and new.analista_id is null and old.analista_id is not null then raise exception 'pa_exige_analista'; end if;
    if v.exige_empresa and new.empresa_id is null and old.empresa_id is not null then raise exception 'pa_exige_empresa'; end if;
    if v.exige_correspondente and new.correspondente_id is null and old.correspondente_id is not null then raise exception 'pa_exige_correspondente'; end if;
  end if;
  return new;
end $$;
revoke execute on function a1_pa_regras_guarda() from public, anon, authenticated;

drop trigger if exists zzz_a1_pa_regras on a1_pre_analises;
create trigger zzz_a1_pa_regras before insert or update on a1_pre_analises
  for each row execute function a1_pa_regras_guarda();

alter table a1_pa_regras enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where tablename = 'a1_pa_regras' and schemaname = 'public' loop
    execute format('drop policy if exists %I on a1_pa_regras', p.policyname);
  end loop;
end $$;
revoke all on a1_pa_regras from anon, authenticated;
grant select, insert, update on a1_pa_regras to anon, authenticated;
create policy a1_pa_regras_ler on a1_pa_regras for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));
create policy a1_pa_regras_criar on a1_pa_regras for insert
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE') and a1_e_gestor());
create policy a1_pa_regras_editar on a1_pa_regras for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE') and a1_e_gestor())
  with check (tenant_id = a1_tenant());

-- =============================================================================
-- 5. SELOS DO FUNIL DE LEADS
-- =============================================================================
-- AGENDAMENTO  entrar na etapa abre o agendamento da visita
-- PRE_ANALISE  só nesta etapa o lead pode virar pré-análise
-- GANHO        fim positivo do funil
-- PERDIDO      fim negativo do funil
-- Um selo por funil (group_key): dois funis podem ter cada um a sua etapa de
-- visita.
alter table a1_stages add column if not exists selo text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'a1_stages_selo_chk') then
    alter table a1_stages add constraint a1_stages_selo_chk
      check (selo is null or (module_key = 'crm' and selo in ('AGENDAMENTO', 'PRE_ANALISE', 'GANHO', 'PERDIDO')));
  end if;
end $$;
create unique index if not exists idx_stages_selo_por_funil
  on a1_stages (tenant_id, module_key, coalesce(group_key, 'geral'), selo) where selo is not null;

-- Pôr o selo numa etapa tira o mesmo selo da outra etapa do MESMO funil, na
-- mesma transação (como a1_workflow_definir_selo faz na Pré-análise e na Venda).
create or replace function a1_crm_definir_selo(p_stage uuid, p_selo text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_s a1_stages%rowtype; v_selo text := nullif(btrim(p_selo), '');
begin
  if not (a1_e_gestor() or a1_perm('gerente')) then raise exception 'sem_permissao'; end if;
  if not a1_tem_modulo('crm') then raise exception 'modulo_desabilitado'; end if;
  select * into v_s from a1_stages where id = p_stage;
  if v_s.id is null or v_s.tenant_id <> a1_tenant() or v_s.module_key <> 'crm' then
    raise exception 'etapa_invalida';
  end if;
  if v_selo is not null and v_selo not in ('AGENDAMENTO', 'PRE_ANALISE', 'GANHO', 'PERDIDO') then
    raise exception 'selo_invalido';
  end if;
  perform pg_advisory_xact_lock(hashtext('crm-selo:' || v_s.tenant_id::text));
  if v_selo is not null then
    update a1_stages set selo = null
     where tenant_id = v_s.tenant_id and module_key = 'crm'
       and coalesce(group_key, 'geral') = coalesce(v_s.group_key, 'geral')
       and selo = v_selo and id <> p_stage;
  end if;
  update a1_stages set selo = v_selo where id = p_stage;
  return json_build_object('ok', true);
end $$;
grant execute on function a1_crm_definir_selo(uuid, text) to anon, authenticated;

-- =============================================================================
-- 6. VISITA NA AGENDA
-- =============================================================================
alter table a1_agenda drop constraint if exists a1_agenda_tipo_check;
alter table a1_agenda add constraint a1_agenda_tipo_check
  check (tipo in ('compromisso', 'tarefa', 'avaliacao', 'entrevista', 'visita'));
-- O lead da visita. caso_id é do Repasse e a agenda o usa para abrir o
-- processo: misturar os dois mandaria a visita para um processo que não existe.
alter table a1_agenda add column if not exists lead_id uuid;
create index if not exists idx_agenda_lead on a1_agenda (lead_id) where lead_id is not null;

-- Agendar a visita de um lead. Uma linha para o corretor do lead (com quem
-- agendou como convidado, se foi outra pessoa) e uma para a imobiliária, para
-- cada um ver na própria agenda. A agenda só deixa cada um gravar a própria
-- linha, por isso a função é SECURITY DEFINER e confere antes se quem chama
-- enxerga o lead, com a mesma regra do RLS de a1_cases.
create or replace function a1_crm_agendar_visita(p_lead uuid, p_data date,
  p_hora_inicio time default null, p_hora_fim time default null,
  p_local text default null, p_observacao text default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_l a1_cases%rowtype;
  v_ator uuid := a1_ator();
  v_corretor uuid; v_imob uuid; v_txt text;
  v_titulo text; v_desc text; v_ids uuid[] := '{}'; v_id uuid;
begin
  if a1_tenant() is null or v_ator is null then raise exception 'sem_sessao'; end if;
  if not a1_tem_modulo('crm') then raise exception 'modulo_desabilitado'; end if;
  select * into v_l from a1_cases where id = p_lead;
  if v_l.id is null or v_l.tenant_id <> a1_tenant() or coalesce(v_l.module_key, '') <> 'crm' then
    raise exception 'nao_encontrado';
  end if;
  if not (a1_e_gestor() or a1_case_visao_completa() or exists (
        select 1 from a1_partners p
         where p.id = v_ator and p.tenant_id = v_l.tenant_id and p.type = 'corretor'
           and lower(btrim(p.name)) = lower(btrim(coalesce(v_l.broker_name, ''))))) then
    raise exception 'sem_acesso';
  end if;
  if p_data is null then return json_build_object('ok', false, 'erro', 'visita_sem_data'); end if;
  if p_hora_inicio is not null and p_hora_fim is not null and p_hora_fim < p_hora_inicio then
    return json_build_object('ok', false, 'erro', 'visita_hora_invertida');
  end if;

  -- Corretor e imobiliária do lead: pelo id gravado no lead; sem ele, pelo nome.
  v_txt := nullif(btrim(v_l.payload->'crm_refs'->>'corretor_id'), '');
  if v_txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_corretor from a1_partners where id = v_txt::uuid and tenant_id = v_l.tenant_id;
  end if;
  if v_corretor is null and coalesce(btrim(v_l.broker_name), '') <> '' then
    select id into v_corretor from a1_partners
     where tenant_id = v_l.tenant_id and type = 'corretor'
       and lower(btrim(name)) = lower(btrim(v_l.broker_name)) limit 1;
  end if;
  v_txt := nullif(btrim(v_l.payload->'crm_refs'->>'imobiliaria_id'), '');
  if v_txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_imob from a1_partners where id = v_txt::uuid and tenant_id = v_l.tenant_id;
  end if;
  if v_imob is null and coalesce(btrim(v_l.real_estate_name), '') <> '' then
    select id into v_imob from a1_partners
     where tenant_id = v_l.tenant_id and type = 'imobiliaria'
       and lower(btrim(name)) = lower(btrim(v_l.real_estate_name)) limit 1;
  end if;

  v_titulo := 'Visita: ' || coalesce(nullif(btrim(v_l.client_name), ''), 'lead');
  v_desc := concat_ws(E'\n',
    nullif(concat_ws(' · ', nullif(btrim(v_l.development), ''), nullif(btrim(v_l.unit), '')), ''),
    case when nullif(btrim(v_l.client_phone), '') is not null then 'Telefone: ' || btrim(v_l.client_phone) end,
    nullif(btrim(p_observacao), ''));

  -- A linha do corretor (ou de quem agendou, quando o lead não tem corretor).
  insert into a1_agenda (tenant_id, dono, para_ator, tipo, titulo, descricao, local, data,
                         hora_inicio, hora_fim, lead_id, cor, criado_por_nome)
  values (v_l.tenant_id, coalesce(v_corretor, v_ator),
          case when v_corretor is not null and v_corretor <> v_ator then v_ator end,
          'visita', v_titulo, nullif(v_desc, ''), nullif(btrim(p_local), ''), p_data,
          p_hora_inicio, p_hora_fim, v_l.id, null, a1_ator_nome())
  returning id into v_id;
  v_ids := v_ids || v_id;

  -- A linha da imobiliária, quando ela não é a mesma pessoa já atendida acima.
  if v_imob is not null and v_imob <> coalesce(v_corretor, v_ator) and v_imob <> v_ator then
    insert into a1_agenda (tenant_id, dono, para_ator, tipo, titulo, descricao, local, data,
                           hora_inicio, hora_fim, lead_id, cor, criado_por_nome)
    values (v_l.tenant_id, v_imob, null, 'visita', v_titulo, nullif(v_desc, ''),
            nullif(btrim(p_local), ''), p_data, p_hora_inicio, p_hora_fim, v_l.id, null, a1_ator_nome())
    returning id into v_id;
    v_ids := v_ids || v_id;
  end if;

  insert into a1_events (tenant_id, case_id, type, description, actor_name)
  values (v_l.tenant_id, v_l.id, 'interaction',
          'Visita agendada para ' || to_char(p_data, 'DD/MM/YYYY')
            || coalesce(' às ' || to_char(p_hora_inicio, 'HH24:MI'), '')
            || coalesce(' · ' || nullif(btrim(p_local), ''), ''),
          a1_ator_nome());

  return json_build_object('ok', true, 'agenda_ids', to_json(v_ids));
end $$;
grant execute on function a1_crm_agendar_visita(uuid, date, time, time, text, text) to anon, authenticated;

-- =============================================================================
-- 7. A RESERVA E A PRÉ-ANÁLISE
-- =============================================================================

-- A situação em que a venda nasce: a marcada como Inicial; sem ela, a que tem
-- o selo Início.
create or replace function a1_co_situacao_inicial(p_tenant uuid)
returns uuid language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select coalesce(
    (select id from a1_co_situacoes where tenant_id = p_tenant and ativo and flag = 'INICIAL'
      order by ordem limit 1),
    (select id from a1_co_situacoes where tenant_id = p_tenant and ativo and selo = 'INICIO'
      order by ordem limit 1));
$$;
revoke all on function a1_co_situacao_inicial(uuid) from public, anon, authenticated;

-- A pré-análise está pronta para reservar? Devolve NULL quando está, ou o
-- código do motivo quando não está. Usada pela reserva e pela tela.
create or replace function a1_pa_pronta_para_reserva(p_pre_analise uuid)
returns text language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare v_pa a1_pre_analises%rowtype; v_selo text; v_motivo text;
begin
  select * into v_pa from a1_pre_analises where id = p_pre_analise;
  if v_pa.id is null or v_pa.tenant_id <> a1_tenant() then return 'pre_analise_nao_encontrada'; end if;
  if not a1_tem_modulo('PRE_ANALISE') then return 'modulo_pre_analise_desabilitado'; end if;
  if not a1_pa_visivel(v_pa.corretor_id, v_pa.empresa_id, v_pa.analista_id, v_pa.correspondente_id) then
    return 'pre_analise_nao_encontrada';
  end if;
  select selo into v_selo from a1_pa_situacoes where id = v_pa.situacao_id;
  if coalesce(v_selo, '') <> 'FIM_POSITIVO' then return 'pre_analise_nao_aprovada'; end if;
  if exists (select 1 from a1_comerciais where pre_analise_id = p_pre_analise) then
    return 'pre_analise_ja_tem_venda';
  end if;
  if exists (select 1 from a1_reservas where pre_analise_id = p_pre_analise and status = 'ATIVA') then
    return 'pre_analise_ja_tem_reserva';
  end if;
  if a1_tem_modulo('COMERCIAL') then
    v_motivo := a1_pa_pode_criar_comercial(p_pre_analise);
    if v_motivo is not null then return v_motivo; end if;
  end if;
  return null;
end $$;
grant execute on function a1_pa_pronta_para_reserva(uuid) to anon, authenticated;

-- Os dados que a reserva aproveita da pré-análise: titular, cônjuge e
-- associados, corretor, unidade de interesse e o crédito aprovado (em reais).
create or replace function a1_disp_dados_da_pre_analise(p_pre_analise uuid)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare v_pa a1_pre_analises%rowtype; v_cr a1_pa_analises_credito%rowtype; v_sit text;
begin
  if not a1_disp_pode('disp_reservar') then raise exception 'sem_permissao'; end if;
  select * into v_pa from a1_pre_analises where id = p_pre_analise;
  if v_pa.id is null or v_pa.tenant_id <> a1_tenant() or not a1_tem_modulo('PRE_ANALISE')
     or not a1_pa_visivel(v_pa.corretor_id, v_pa.empresa_id, v_pa.analista_id, v_pa.correspondente_id) then
    raise exception 'nao_encontrado';
  end if;
  select * into v_cr from a1_pa_analises_credito
   where pre_analise_id = p_pre_analise and status = 'APROVADO' order by versao desc limit 1;
  select nome into v_sit from a1_pa_situacoes where id = v_pa.situacao_id;
  return json_build_object(
    'id', v_pa.id, 'codigo', v_pa.codigo, 'situacao', v_sit,
    'empreendimento_id', v_pa.empreendimento_id, 'unidade_id', v_pa.unidade_id, 'unidade', v_pa.unidade,
    'corretor_id', v_pa.corretor_id, 'imobiliaria_id', v_pa.imobiliaria_id,
    'motivo', a1_pa_pronta_para_reserva(p_pre_analise),
    'credito', case when v_cr.id is null then null else json_build_object(
      'financiamento', round(coalesce(v_cr.valor_aprovado, 0) / 100.0, 2),
      'fgts', round(coalesce(v_cr.valor_fgts, 0) / 100.0, 2),
      'subsidio', round(coalesce(v_cr.valor_subsidio, 0) / 100.0, 2)) end,
    'pessoas', coalesce((
      select json_agg(json_build_object(
        'papel', pp.papel, 'parentesco', pp.parentesco,
        'nome', pe.nome, 'cpf', pe.documento, 'nascimento', pe.nascimento,
        'estado_civil', pe.estado_civil, 'telefone', pe.telefone, 'email', pe.email,
        'renda', round(coalesce(pp.renda_analisada, pp.renda_declarada, 0) / 100.0, 2))
        order by case pp.papel when 'TITULAR' then 0 else 1 end, pp.criado_em)
        from a1_pa_participantes pp join a1_pa_pessoas pe on pe.id = pp.pessoa_id
       where pp.pre_analise_id = p_pre_analise), '[]'::json));
end $$;
grant execute on function a1_disp_dados_da_pre_analise(uuid) to anon, authenticated;

-- As pré-análises que podem virar reserva agora, para o seletor da Disposição.
create or replace function a1_disp_pre_analises_aprovadas()
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
begin
  if not a1_disp_pode('disp_reservar') or not a1_tem_modulo('PRE_ANALISE') then
    return '[]'::json;
  end if;
  return coalesce((
    select json_agg(json_build_object('id', pa.id, 'codigo', pa.codigo,
        'empreendimento_id', pa.empreendimento_id, 'unidade_id', pa.unidade_id, 'unidade', pa.unidade,
        'titular', (select pe.nome from a1_pa_participantes pp join a1_pa_pessoas pe on pe.id = pp.pessoa_id
                     where pp.pre_analise_id = pa.id and pp.papel = 'TITULAR' limit 1))
        order by pa.situacao_em desc)
      from a1_pre_analises pa join a1_pa_situacoes s on s.id = pa.situacao_id
     where pa.tenant_id = a1_tenant() and s.selo = 'FIM_POSITIVO'
       and a1_pa_visivel(pa.corretor_id, pa.empresa_id, pa.analista_id, pa.correspondente_id)
       and not exists (select 1 from a1_comerciais c where c.pre_analise_id = pa.id)
       and not exists (select 1 from a1_reservas r where r.pre_analise_id = pa.id and r.status = 'ATIVA')),
    '[]'::json);
end $$;
grant execute on function a1_disp_pre_analises_aprovadas() to anon, authenticated;

-- O vencimento da reserva reconhece a venda parada na situação inicial também
-- quando ela é marcada só pelo selo Início (a mesma regra de
-- a1_co_situacao_inicial). Antes conferia só a marca Inicial.
create or replace function a1_disposicao_expirar(p_tenant uuid)
returns int language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_r record; v_n int := 0; v_ini uuid := a1_co_situacao_inicial(p_tenant);
begin
  for v_r in
    select r.* from a1_reservas r
     where r.tenant_id = p_tenant and r.status = 'ATIVA'
       and r.expira_em is not null and r.expira_em < now()
       and (r.comercial_id is null or exists (
             select 1 from a1_comerciais c join a1_co_situacoes s on s.id = c.situacao_id
              where c.id = r.comercial_id and (s.flag = 'INICIAL' or s.id = v_ini)))
     for update of r skip locked
  loop
    update a1_reservas set status = 'EXPIRADA', motivo = 'prazo da reserva vencido',
           atualizado_em = now() where id = v_r.id;
    if exists (select 1 from a1_unidades where id = v_r.unidade_id and status = 'reservado') then
      perform a1_unidade_mudar_status(v_r.unidade_id, 'disponivel', 'reserva expirada',
        jsonb_build_object('reserva_id', v_r.id, 'reserva_codigo', v_r.codigo, 'origem', 'expiracao'));
    end if;
    v_n := v_n + 1;
  end loop;
  for v_r in
    select u.id from a1_unidades u
     where u.tenant_id = p_tenant and u.status = 'bloqueado'
       and u.bloqueado_ate is not null and u.bloqueado_ate < now()
     for update of u skip locked
  loop
    perform set_config('a1.orquestrador', '1', true);
    update a1_unidades set bloqueado_ate = null where id = v_r.id;
    perform a1_unidade_mudar_status(v_r.id, 'disponivel', 'bloqueio venceu',
      jsonb_build_object('origem', 'prazo_do_bloqueio'));
  end loop;
  return v_n;
end $$;
revoke all on function a1_disposicao_expirar(uuid) from public, anon, authenticated;

-- ─── A venda da reserva (uso interno) ────────────────────────────────────────
-- Com pré-análise, a venda nasce pelo caminho de sempre (a1_criar_comercial,
-- que leva o crédito aprovado e os participantes) e recebe a unidade, a reserva
-- e o fluxo. Sem pré-análise, nasce aqui mesmo. Nos dois casos, na situação
-- inicial da Venda; sem situação inicial, a função recusa e a reserva inteira
-- volta atrás: reserva sem venda era o defeito que este arquivo corrige.
create or replace function a1_reserva_criar_venda(p_reserva uuid)
returns uuid language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_r a1_reservas%rowtype; v_un a1_unidades%rowtype; v_dev a1_developments%rowtype;
  v_sit uuid; v_co uuid; v_l jsonb;
  v_cond jsonb := '[]'::jsonb; v_part jsonb := '[]'::jsonb; v_a jsonb;
  v_cli numeric := 0; v_fin numeric := 0; v_fgts numeric := 0; v_sub numeric := 0; v_tot numeric;
begin
  perform set_config('a1.orquestrador', '1', true);
  select * into v_r from a1_reservas where id = p_reserva;
  if v_r.id is null then raise exception 'nao_encontrado'; end if;
  if v_r.comercial_id is not null then return v_r.comercial_id; end if;
  if not a1_tem_modulo('COMERCIAL') then return null; end if;

  v_sit := a1_co_situacao_inicial(v_r.tenant_id);
  if v_sit is null then raise exception 'venda_sem_situacao_inicial'; end if;
  select * into v_un from a1_unidades where id = v_r.unidade_id;
  select * into v_dev from a1_developments where id = v_r.empreendimento_id;

  -- O fluxo da reserva dividido: o que o cliente paga vira condição de
  -- pagamento da proposta (em centavos, o formato da Venda); financiamento,
  -- FGTS e subsídio vão para o crédito.
  for v_l in select * from jsonb_array_elements(coalesce(v_r.fluxo, '[]'::jsonb)) loop
    if coalesce(v_l->>'quem_paga', 'CLIENTE') = 'CLIENTE' then
      v_cond := v_cond || jsonb_build_array(jsonb_build_object(
        'tipo', v_l->>'serie', 'nome', v_l->>'nome', 'quantidade', (v_l->>'quantidade')::int,
        'valor', round((v_l->>'valor')::numeric * 100)::bigint,
        'vencimento_inicial', nullif(v_l->>'primeiro_vencimento', '')));
      v_cli := v_cli + (v_l->>'valor')::numeric * (v_l->>'quantidade')::int;
    elsif v_l->>'serie' = 'FGTS' then v_fgts := v_fgts + (v_l->>'valor')::numeric * (v_l->>'quantidade')::int;
    elsif v_l->>'serie' = 'SUBSIDIO' then v_sub := v_sub + (v_l->>'valor')::numeric * (v_l->>'quantidade')::int;
    else v_fin := v_fin + (v_l->>'valor')::numeric * (v_l->>'quantidade')::int;
    end if;
  end loop;
  v_tot := v_fin + v_fgts + v_sub;

  if v_r.pre_analise_id is not null then
    v_co := a1_criar_comercial(v_r.pre_analise_id);
    update a1_comerciais
       set unidade_id = v_r.unidade_id, reserva_id = v_r.id, unidade = v_un.codigo,
           empreendimento_id = v_r.empreendimento_id,
           corretor_id = coalesce(corretor_id, v_r.corretor_id),
           imobiliaria_id = coalesce(imobiliaria_id, v_r.imobiliaria_id),
           situacao_id = coalesce(situacao_id, v_sit),
           proposta = coalesce(proposta, '{}'::jsonb) || jsonb_build_object(
             'valor_venda', round(coalesce(v_r.valor_unidade, 0) * 100)::bigint,
             'valor_entrada', round(v_cli * 100)::bigint,
             'condicoes_pagamento', v_cond, 'origem', 'RESERVA'),
           origem_snapshot = coalesce(origem_snapshot, '{}'::jsonb) || jsonb_build_object(
             'reserva', jsonb_build_object('id', v_r.id, 'codigo', v_r.codigo),
             'unidade', jsonb_build_object('id', v_un.id, 'codigo', v_un.codigo,
               'empreendimento', v_dev.name, 'valor', v_r.valor_unidade),
             'fluxo', v_r.fluxo)
     where id = v_co;
  else
    v_part := jsonb_build_array(jsonb_build_object('papel', 'TITULAR',
      'nome', v_r.cliente->'titular'->>'nome', 'documento', v_r.cliente->'titular'->>'cpf',
      'renda_analisada', v_r.cliente->'titular'->'renda'));
    if jsonb_typeof(v_r.cliente->'conjuge') = 'object'
       and coalesce(trim(v_r.cliente->'conjuge'->>'nome'), '') <> '' then
      v_part := v_part || jsonb_build_array(jsonb_build_object('papel', 'CONJUGE',
        'nome', v_r.cliente->'conjuge'->>'nome', 'documento', v_r.cliente->'conjuge'->>'cpf',
        'renda_analisada', v_r.cliente->'conjuge'->'renda'));
    end if;
    if jsonb_typeof(v_r.cliente->'associados') = 'array' then
      for v_a in select * from jsonb_array_elements(v_r.cliente->'associados') loop
        continue when coalesce(trim(v_a->>'nome'), '') = '';
        v_part := v_part || jsonb_build_array(jsonb_build_object('papel', 'ASSOCIADO',
          'nome', v_a->>'nome', 'documento', v_a->>'cpf', 'parentesco', v_a->>'parentesco',
          'renda_analisada', v_a->'renda'));
      end loop;
    end if;
    insert into a1_comerciais (tenant_id, empreendimento_id, unidade, unidade_id, reserva_id,
        corretor_id, imobiliaria_id, situacao_id, proposta, origem_snapshot, criado_por)
    values (v_r.tenant_id, v_r.empreendimento_id, v_un.codigo, v_r.unidade_id, v_r.id,
        v_r.corretor_id, v_r.imobiliaria_id, v_sit,
        jsonb_build_object('valor_venda', round(coalesce(v_r.valor_unidade, 0) * 100)::bigint,
          'valor_entrada', round(v_cli * 100)::bigint,
          'condicoes_pagamento', v_cond, 'origem', 'RESERVA'),
        jsonb_build_object('capturado_em', now(), 'origem', 'RESERVA',
          'reserva', jsonb_build_object('id', v_r.id, 'codigo', v_r.codigo),
          'unidade', jsonb_build_object('id', v_un.id, 'codigo', v_un.codigo,
            'empreendimento', v_dev.name, 'valor', v_r.valor_unidade),
          'credito', jsonb_build_object('valor_aprovado', round(v_fin * 100)::bigint,
            'valor_fgts', round(v_fgts * 100)::bigint,
            'valor_subsidio', round(v_sub * 100)::bigint,
            'valor_total', round(v_tot * 100)::bigint),
          'participantes', v_part,
          'fluxo', v_r.fluxo),
        a1_ator())
    returning id into v_co;
  end if;

  update a1_reservas set comercial_id = v_co, atualizado_em = now() where id = v_r.id;
  insert into a1_co_eventos (tenant_id, comercial_id, evento, para_situacao, ator_id, detalhe)
  values (v_r.tenant_id, v_co, 'criado_da_reserva', v_sit, a1_ator(),
          jsonb_strip_nulls(jsonb_build_object('reserva_id', v_r.id, 'unidade', v_un.codigo,
                                               'pre_analise_id', v_r.pre_analise_id)));
  perform a1_integra_registrar(v_r.tenant_id, 'RESERVA_VENDA', 'DISPOSICAO', v_r.id,
    'COMERCIAL', v_co, 'OK', null, 'reserva:' || v_r.id::text, '{}'::jsonb);
  return v_co;
end $$;
revoke all on function a1_reserva_criar_venda(uuid) from public, anon, authenticated;

-- ─── RESERVAR ────────────────────────────────────────────────────────────────
-- Igual à de 2026-11-02, com três mudanças:
-- - p_pre_analise: a reserva pode (ou, pela regra, tem de) vir de uma
--   pré-análise com selo Fim positivo;
-- - a venda é criada por a1_reserva_criar_venda, que recusa quando a Venda não
--   tem situação inicial, em vez de deixar a reserva sem venda;
-- - a falta de situação inicial é conferida ANTES de gravar, com o motivo.
drop function if exists a1_unidade_reservar(uuid, jsonb, jsonb, int, uuid, uuid, text);
create or replace function a1_unidade_reservar(
  p_unidade uuid, p_cliente jsonb, p_fluxo jsonb,
  p_versao_esperada int default null, p_corretor uuid default null,
  p_imobiliaria uuid default null, p_observacao text default null,
  p_pre_analise uuid default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_un    a1_unidades%rowtype;
  v_cfg   a1_disposicao_config%rowtype;
  v_par   a1_parametros_pagamento%rowtype;
  v_pa    a1_pre_analises%rowtype;
  v_l     jsonb;
  v_valor numeric; v_mapa uuid;
  v_total numeric := 0; v_q int; v_v numeric;
  v_fluxo jsonb := '[]'::jsonb;
  v_corretor uuid; v_imob uuid;
  v_res   uuid; v_cod text; v_expira timestamptz;
  v_co    uuid; v_motivo text;
begin
  perform set_config('a1.orquestrador', '1', true);
  if not a1_tem_modulo('DISPOSICAO') then raise exception 'modulo_desabilitado'; end if;
  if not (a1_e_gestor() or a1_perm('disp_reservar')) then raise exception 'sem_permissao'; end if;

  perform pg_advisory_xact_lock(hashtext('un:' || p_unidade::text));
  if p_pre_analise is not null then
    perform pg_advisory_xact_lock(hashtext('pa:' || p_pre_analise::text));
  end if;
  perform a1_disposicao_expirar(a1_tenant());

  select * into v_un from a1_unidades where id = p_unidade for update;
  if v_un.id is null or v_un.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if v_un.status <> 'disponivel' then
    return json_build_object('ok', false, 'erro', 'unidade_' || v_un.status);
  end if;
  if p_versao_esperada is not null and p_versao_esperada <> v_un.versao then
    return json_build_object('ok', false, 'erro', 'versao_desatualizada');
  end if;
  select * into v_cfg from a1_disposicao_config where tenant_id = v_un.tenant_id;

  -- De onde a reserva veio.
  if p_pre_analise is null then
    if coalesce(v_cfg.origem_reserva, 'LIVRE') = 'PRE_ANALISE' then
      return json_build_object('ok', false, 'erro', 'reserva_exige_pre_analise');
    end if;
  else
    if not (a1_e_gestor() or a1_perm('pa_iniciar_venda')) then raise exception 'sem_permissao'; end if;
    v_motivo := a1_pa_pronta_para_reserva(p_pre_analise);
    if v_motivo is not null then
      return json_build_object('ok', false, 'erro', v_motivo);
    end if;
    select * into v_pa from a1_pre_analises where id = p_pre_analise;
    if v_pa.empreendimento_id is distinct from v_un.empreendimento_id then
      return json_build_object('ok', false, 'erro', 'pre_analise_de_outro_empreendimento');
    end if;
  end if;

  -- A venda nasce com a reserva: sem situação inicial na Venda, não há reserva.
  if a1_tem_modulo('COMERCIAL') and a1_co_situacao_inicial(v_un.tenant_id) is null then
    perform a1_integra_registrar(v_un.tenant_id, 'RESERVA_VENDA', 'DISPOSICAO', v_un.id,
      'COMERCIAL', null, 'BLOQUEADO', 'a Venda não tem situação inicial configurada', null, '{}'::jsonb);
    return json_build_object('ok', false, 'erro', 'venda_sem_situacao_inicial');
  end if;

  if coalesce(trim(p_cliente->'titular'->>'nome'), '') = '' then
    return json_build_object('ok', false, 'erro', 'titular_sem_nome');
  end if;
  if length(regexp_replace(coalesce(p_cliente->'titular'->>'cpf', ''), '\D', '', 'g')) <> 11 then
    return json_build_object('ok', false, 'erro', 'titular_cpf_invalido');
  end if;

  select i.valor, m.id into v_valor, v_mapa
    from a1_mapas_preco m join a1_mapa_preco_itens i on i.mapa_id = m.id
   where m.empreendimento_id = v_un.empreendimento_id and m.ativo and i.unidade_id = v_un.id;
  if v_valor is null then
    return json_build_object('ok', false, 'erro', 'unidade_sem_preco');
  end if;

  if p_fluxo is null or jsonb_typeof(p_fluxo) <> 'array' or jsonb_array_length(p_fluxo) = 0 then
    return json_build_object('ok', false, 'erro', 'fluxo_vazio');
  end if;
  for v_l in select * from jsonb_array_elements(p_fluxo) loop
    v_par := null;
    begin
      select * into v_par from a1_parametros_pagamento
       where id = (v_l->>'parametro_id')::uuid and tenant_id = v_un.tenant_id and ativo;
    exception when invalid_text_representation then v_par := null;
    end;
    if v_par.id is null then
      return json_build_object('ok', false, 'erro', 'parametro_invalido');
    end if;
    v_q := coalesce(nullif(v_l->>'quantidade', '')::int, 1);
    if v_q < v_par.parcelas_min or v_q > v_par.parcelas_max then
      return json_build_object('ok', false, 'erro', 'quantidade_fora_do_limite', 'parametro', v_par.nome,
                               'minimo', v_par.parcelas_min, 'maximo', v_par.parcelas_max);
    end if;
    v_v := round(nullif(v_l->>'valor', '')::numeric, 2);
    if v_v is null or v_v <= 0 then
      return json_build_object('ok', false, 'erro', 'valor_invalido', 'parametro', v_par.nome);
    end if;
    if v_par.valor_minimo is not null and v_v < v_par.valor_minimo then
      return json_build_object('ok', false, 'erro', 'parcela_abaixo_do_minimo', 'parametro', v_par.nome,
                               'minimo', v_par.valor_minimo);
    end if;
    if v_par.exige_vencimento and nullif(v_l->>'primeiro_vencimento', '') is null then
      return json_build_object('ok', false, 'erro', 'sem_vencimento', 'parametro', v_par.nome);
    end if;
    v_total := v_total + v_v * v_q;
    v_fluxo := v_fluxo || jsonb_build_array(jsonb_build_object(
      'parametro_id', v_par.id, 'serie', v_par.serie, 'nome', v_par.nome, 'valor', v_v,
      'quantidade', v_q, 'periodicidade_meses', v_par.periodicidade_meses,
      'primeiro_vencimento', nullif(v_l->>'primeiro_vencimento', ''), 'quem_paga', v_par.quem_paga));
  end loop;

  if coalesce(v_cfg.max_reservas_por_cpf, 0) > 0 and (
       select count(*) from a1_reservas r
        where r.tenant_id = v_un.tenant_id and r.status = 'ATIVA'
          and regexp_replace(coalesce(r.cliente->'titular'->>'cpf', ''), '\D', '', 'g')
            = regexp_replace(p_cliente->'titular'->>'cpf', '\D', '', 'g')) >= v_cfg.max_reservas_por_cpf then
    return json_build_object('ok', false, 'erro', 'limite_de_reservas_do_cpf',
                             'limite', v_cfg.max_reservas_por_cpf);
  end if;
  if coalesce(v_cfg.exige_fluxo_fechado, true) and abs(v_total - v_valor) > 0.01 then
    return json_build_object('ok', false, 'erro', 'fluxo_nao_fecha',
                             'valor_unidade', v_valor, 'valor_fluxo', v_total);
  end if;

  -- De quem é a reserva. Parceiro reserva em nome próprio; gestor pode indicar
  -- o corretor, que tem de ser deste cliente. Vinda da pré-análise, sem
  -- indicação, é do corretor da pré-análise.
  if a1_e_gestor() then
    if p_corretor is not null and not exists (
         select 1 from a1_partners where id = p_corretor and tenant_id = v_un.tenant_id) then
      return json_build_object('ok', false, 'erro', 'corretor_de_outro_cliente');
    end if;
    v_corretor := coalesce(p_corretor, v_pa.corretor_id);
    v_imob := coalesce(p_imobiliaria, v_pa.imobiliaria_id);
  else
    v_corretor := a1_ator();
    select nullif(extra->>'imobiliaria_id', '')::uuid into v_imob from a1_partners where id = v_corretor;
    v_imob := coalesce(v_imob, v_pa.imobiliaria_id);
  end if;
  if v_corretor is not null and v_imob is null then
    select nullif(extra->>'imobiliaria_id', '')::uuid into v_imob from a1_partners where id = v_corretor;
  end if;

  v_expira := case when coalesce(v_cfg.reserva_horas, 48) > 0
                   then now() + make_interval(hours => coalesce(v_cfg.reserva_horas, 48)) end;

  insert into a1_reservas (tenant_id, unidade_id, empreendimento_id, expira_em, corretor_id,
      imobiliaria_id, cliente, fluxo, valor_unidade, valor_fluxo, mapa_preco_id, observacao,
      criado_por, criado_por_nome, pre_analise_id)
  values (v_un.tenant_id, v_un.id, v_un.empreendimento_id, v_expira, v_corretor, v_imob,
      p_cliente, v_fluxo, v_valor, v_total, v_mapa, nullif(trim(p_observacao), ''),
      a1_ator(), a1_ator_nome(), p_pre_analise)
  returning id, codigo into v_res, v_cod;

  perform a1_unidade_mudar_status(v_un.id, 'reservado', null,
    jsonb_strip_nulls(jsonb_build_object('reserva_id', v_res, 'reserva_codigo', v_cod,
                       'cliente', p_cliente->'titular'->>'nome', 'pre_analise_id', p_pre_analise)));

  v_co := a1_reserva_criar_venda(v_res);

  return json_build_object('ok', true, 'reserva_id', v_res, 'codigo', v_cod,
                           'comercial_id', v_co, 'expira_em', v_expira);
end $$;
grant execute on function a1_unidade_reservar(uuid, jsonb, jsonb, int, uuid, uuid, text, uuid) to anon, authenticated;

-- ─── Abrir a venda de uma reserva que ficou sem ─────────────────────────────
-- Para a reserva feita quando a Venda ainda não tinha situação inicial (ou
-- antes de o cliente ganhar a Venda). Quem pode cancelar a reserva pode abrir a
-- venda dela.
create or replace function a1_reserva_abrir_venda(p_reserva uuid)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_r a1_reservas%rowtype; v_co uuid;
begin
  perform set_config('a1.orquestrador', '1', true);
  if not a1_tem_modulo('DISPOSICAO') then raise exception 'modulo_desabilitado'; end if;
  select * into v_r from a1_reservas where id = p_reserva;
  if v_r.id is null or v_r.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if not (a1_e_gestor() or a1_perm('disp_gerir')
          or (v_r.corretor_id is not null and v_r.corretor_id = a1_ator() and a1_perm('disp_reservar'))) then
    raise exception 'sem_permissao';
  end if;
  perform pg_advisory_xact_lock(hashtext('un:' || v_r.unidade_id::text));
  select * into v_r from a1_reservas where id = p_reserva for update;
  if v_r.status <> 'ATIVA' then
    return json_build_object('ok', false, 'erro', 'reserva_' || lower(v_r.status));
  end if;
  if v_r.comercial_id is not null then
    return json_build_object('ok', true, 'comercial_id', v_r.comercial_id);
  end if;
  if not a1_tem_modulo('COMERCIAL') then
    return json_build_object('ok', false, 'erro', 'modulo_comercial_desabilitado');
  end if;
  if a1_co_situacao_inicial(v_r.tenant_id) is null then
    return json_build_object('ok', false, 'erro', 'venda_sem_situacao_inicial');
  end if;
  v_co := a1_reserva_criar_venda(v_r.id);
  return json_build_object('ok', true, 'comercial_id', v_co);
end $$;
grant execute on function a1_reserva_abrir_venda(uuid) to anon, authenticated;

-- =============================================================================
-- COMO CONFERIR QUE NINGUÉM FOI AFETADO
--
--   -- nenhum cliente ganhou regra de pré-análise (tem de dar 0):
--   select count(*) from a1_pa_regras;
--   -- nenhuma etapa ganhou selo (tem de dar 0):
--   select count(*) from a1_stages where selo is not null;
--   -- a origem da reserva de quem já configurou ficou LIVRE:
--   select origem_reserva, count(*) from a1_disposicao_config group by 1;
--   -- nenhuma pré-análise ganhou unidade_id:
--   select count(*) from a1_pre_analises where unidade_id is not null;
-- =============================================================================
