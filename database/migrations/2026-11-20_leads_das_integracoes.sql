-- =============================================================================
-- LEADS DAS INTEGRAÇÕES ENTRAM NO MÓDULO DE LEADS
--
-- POR QUE ESTE ARQUIVO EXISTE
-- A conexão com a Meta já escolhia páginas e formulários, e o webhook já
-- recebia o aviso "chegou um lead", mas parava aí: o aviso era guardado e
-- ninguém virava lead. Agora a Edge Function meta-leads-webhook busca os dados
-- do lead na Meta e chama a1_integracao_criar_lead, que:
--   1. confere se a empresa tem o módulo de Leads ligado;
--   2. escolhe o funil (o do formulário; sem escolha, o primeiro funil) e, nele,
--      a etapa marcada como INÍCIO (is_initial). Sem etapa de início no funil,
--      usa a primeira etapa dele;
--   3. cria o lead (a1_cases, módulo crm) SEM corretor: lead sem dono só o
--      gestor vê, e é ele quem distribui;
--   4. grava o histórico de etapa e um evento dizendo de onde o lead veio;
--   5. não duplica: o mesmo lead externo (origem + id) nunca vira dois leads,
--      nem com a Meta reenviando o aviso, nem com duas tentativas ao mesmo tempo.
--
-- A função é genérica de propósito: a próxima integração (portais, webhook
-- genérico) chama a mesma, com outra origem.
--
-- O QUE PROTEGE
--   - Só a service_role executa (as Edge Functions). Nem a chave pública nem um
--     usuário logado chamam.
--   - a1_integracao_leads não tem política: ninguém de fora lê.
--
-- Não altera nenhum lead existente nem dado de cliente. Pode rodar de novo.
-- Precisa das tabelas da Meta (supabase/migrations/20261112*_siimob_meta_*.sql),
-- que já estão em produção.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ─── Um lead externo vira um lead só ─────────────────────────────────────────
create table if not exists a1_integracao_leads (
  tenant_id   uuid not null references a1_tenants(id),
  origem      text not null check (origem ~ '^[a-z0-9_]{2,30}$'),
  externo     text not null check (length(externo) between 1 and 120),
  case_id     uuid references a1_cases(id) on delete set null,
  criado_em   timestamptz not null default now(),
  primary key (tenant_id, origem, externo)
);
alter table a1_integracao_leads enable row level security;
revoke all on a1_integracao_leads from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on a1_integracao_leads to service_role;
  end if;
end $$;

-- ─── Cria o lead na etapa de início ──────────────────────────────────────────
-- p_detalhes: {"rotulo": "Meta · Formulário X" (vai como origem/campanha do
-- lead), "observacoes": "texto livre", "evento": "texto do histórico",
-- "dados": {...} (guardado em payload.integracao)}
create or replace function a1_integracao_criar_lead(
  p_tenant uuid, p_origem text, p_externo text, p_funil text,
  p_nome text, p_telefone text, p_email text, p_detalhes jsonb default '{}'::jsonb)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_etapa a1_stages%rowtype;
  v_case uuid;
  v_existente uuid;
  v_rotulo text := left(nullif(trim(coalesce(p_detalhes->>'rotulo', '')), ''), 120);
  v_nome text := left(nullif(trim(coalesce(p_nome, '')), ''), 160);
begin
  if p_tenant is null or coalesce(p_origem, '') !~ '^[a-z0-9_]{2,30}$'
     or coalesce(p_externo, '') = '' or length(p_externo) > 120 then
    return json_build_object('ok', false, 'erro', 'dados_invalidos');
  end if;

  if not exists (select 1 from a1_tenants t where t.id = p_tenant and coalesce(t.status, 'active') in ('active', 'trial')) then
    return json_build_object('ok', false, 'erro', 'empresa_inativa');
  end if;
  if not exists (select 1 from a1_tenant_modules m
                  where m.tenant_id = p_tenant and m.module_key = 'crm'
                    and (m.expires_at is null or m.expires_at > now())) then
    return json_build_object('ok', false, 'erro', 'sem_modulo_leads');
  end if;

  -- Reserva o id externo antes de criar: se outra tentativa chegou primeiro,
  -- esta só devolve o lead que já existe.
  insert into a1_integracao_leads (tenant_id, origem, externo)
  values (p_tenant, p_origem, p_externo)
  on conflict do nothing;
  if not found then
    select case_id into v_existente from a1_integracao_leads
     where tenant_id = p_tenant and origem = p_origem and externo = p_externo;
    return json_build_object('ok', true, 'duplicado', true, 'case_id', v_existente);
  end if;

  -- O funil pedido, se existir; senão, o primeiro funil (pela posição).
  if nullif(trim(coalesce(p_funil, '')), '') is null
     or not exists (select 1 from a1_stages s where s.tenant_id = p_tenant and s.module_key = 'crm'
                     and s.group_key = p_funil) then
    select s.group_key into p_funil from a1_stages s
     where s.tenant_id = p_tenant and s.module_key = 'crm'
     order by s.is_initial desc, s.position asc nulls last limit 1;
  end if;

  -- A etapa de início do funil; sem ela, a primeira etapa do funil.
  select s.* into v_etapa from a1_stages s
   where s.tenant_id = p_tenant and s.module_key = 'crm'
     and s.group_key is not distinct from p_funil
   order by s.is_initial desc, s.position asc nulls last
   limit 1;
  if v_etapa.id is null then
    delete from a1_integracao_leads where tenant_id = p_tenant and origem = p_origem and externo = p_externo;
    return json_build_object('ok', false, 'erro', 'sem_etapa');
  end if;

  insert into a1_cases (tenant_id, module_key, client_name, client_phone, client_email,
                        partner_name, observations, stage_id, stage_name, stage_entered_at,
                        is_new, new_at, payload)
  values (p_tenant, 'crm',
          coalesce(v_nome, 'Lead ' || coalesce(v_rotulo, p_origem)),
          left(nullif(trim(coalesce(p_telefone, '')), ''), 40),
          left(nullif(lower(trim(coalesce(p_email, ''))), ''), 160),
          v_rotulo,
          left(nullif(p_detalhes->>'observacoes', ''), 4000),
          v_etapa.id, v_etapa.name, now(), true, now(),
          jsonb_build_object('integracao', jsonb_build_object(
            'origem', p_origem, 'externo', p_externo,
            'recebido_em', now(), 'dados', coalesce(p_detalhes->'dados', '{}'::jsonb))))
  returning id into v_case;

  insert into a1_stage_history (tenant_id, case_id, stage_id, stage_name, entered_at)
  values (p_tenant, v_case, v_etapa.id, v_etapa.name, now());

  insert into a1_events (tenant_id, case_id, type, description)
  values (p_tenant, v_case, 'integracao',
          left(coalesce(nullif(p_detalhes->>'evento', ''), 'Lead recebido pela integração ' || p_origem), 300));

  update a1_integracao_leads set case_id = v_case
   where tenant_id = p_tenant and origem = p_origem and externo = p_externo;

  return json_build_object('ok', true, 'duplicado', false, 'case_id', v_case,
                           'funil', p_funil, 'etapa', v_etapa.name);
end $$;

revoke all on function a1_integracao_criar_lead(uuid, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function a1_integracao_criar_lead(uuid, text, text, text, text, text, text, jsonb) to service_role;
  end if;
end $$;

-- ─── Meta: o que aconteceu com cada aviso ────────────────────────────────────
-- status: recebido (ainda não processado), criado, duplicado, ignorado, erro.
-- detalhe: o motivo (formulario_nao_marcado, permissao_meta, sem_etapa...).
-- Guarda só identificadores e o resultado; os dados da pessoa vão para o lead.
alter table siimob_meta_webhook_events add column if not exists tenant_id uuid references a1_tenants(id);
alter table siimob_meta_webhook_events add column if not exists status text not null default 'recebido';
alter table siimob_meta_webhook_events add column if not exists detalhe text;
alter table siimob_meta_webhook_events add column if not exists case_id uuid references a1_cases(id) on delete set null;
alter table siimob_meta_webhook_events add column if not exists tentativas int not null default 0;
alter table siimob_meta_webhook_events add column if not exists processado_em timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'siimob_meta_webhook_events_status_chk') then
    alter table siimob_meta_webhook_events add constraint siimob_meta_webhook_events_status_chk
      check (status in ('recebido', 'criado', 'duplicado', 'ignorado', 'erro'));
  end if;
end $$;
create index if not exists siimob_meta_webhook_events_tenant_idx
  on siimob_meta_webhook_events (tenant_id, received_at desc);
create index if not exists siimob_meta_webhook_events_pendentes_idx
  on siimob_meta_webhook_events (status) where status in ('recebido', 'erro');
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on siimob_meta_webhook_events to service_role;
  end if;
end $$;

-- ─── Meta: para qual funil vai cada formulário ───────────────────────────────
-- Vazio = o primeiro funil da empresa (normalmente "Vendas").
alter table siimob_meta_forms add column if not exists funil text
  check (funil is null or funil ~ '^[a-z0-9_-]{1,40}$');

-- A troca de formulários passa a gravar também o funil de cada um.
create or replace function siimob_meta_replace_forms(p_tenant uuid, p_version timestamptz, p_page text, p_forms jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_version timestamptz;
begin
  if jsonb_typeof(p_forms) is distinct from 'array' then return 'invalid'; end if;
  if jsonb_array_length(p_forms) > 500 then return 'invalid'; end if;
  if exists (select 1 from jsonb_array_elements(p_forms) item
              where nullif(item->>'funil', '') is not null and (item->>'funil') !~ '^[a-z0-9_-]{1,40}$') then
    return 'invalid';
  end if;
  select connected_at into v_version from public.siimob_meta_connections where tenant_id = p_tenant for update;
  if not found or v_version is distinct from p_version then return 'connection_changed'; end if;
  perform 1 from public.siimob_meta_pages where tenant_id = p_tenant and page_id = p_page for update;
  if not found then return 'page_not_selected'; end if;
  update public.siimob_meta_forms set selected = false, updated_at = now()
    where tenant_id = p_tenant and page_id = p_page and selected = true;
  insert into public.siimob_meta_forms (tenant_id, page_id, form_id, form_name, selected, funil)
    select p_tenant, p_page, item->>'id', item->>'name', true, nullif(item->>'funil', '')
      from jsonb_array_elements(p_forms) item
    on conflict (tenant_id, page_id, form_id) do update
      set form_name = excluded.form_name, selected = true, funil = excluded.funil, updated_at = now();
  return 'ok';
end;
$$;
revoke all on function siimob_meta_replace_forms(uuid, timestamptz, text, jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function siimob_meta_replace_forms(uuid, timestamptz, text, jsonb) to service_role;
    grant select, insert, update on siimob_meta_forms to service_role;
  end if;
end $$;

-- =============================================================================
-- COMO CONFERIR
--   select status, detalhe, count(*) from siimob_meta_webhook_events group by 1, 2;
--   select * from a1_integracao_leads order by criado_em desc limit 10;
-- =============================================================================
