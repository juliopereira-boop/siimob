-- ════════════════════════════════════════════════════════════════════════════
-- CENTRAL DE ATENDIMENTO (módulo ATENDIMENTO), dentro de Leads.
--
-- POR QUE ESTE ARQUIVO EXISTE
--   "os leads chegam pelas integrações de anúncios, caem no início do
--    pipeline e entram na central de atendimento (...) o agente entra em
--    contato e qualifica, depois (...) envia o lead para fila de distribuição e
--    distribui para algum corretor (...) o lead no pipeline atribui responsável
--    para o corretor da roleta, e move para a etapa 'em atendimento' (se não
--    tiver esse selo no workflow, crie)."
--
-- O QUE ELE FAZ
--   1. Cadastra o módulo ATENDIMENTO em a1_modules. Ninguém recebe a licença:
--      quem liga é o superadmin, cliente por cliente (regra do sistema).
--   2. Selo novo no funil de Leads: EM_ATENDIMENTO.
--   3. a1_atendimentos (uma conversa por lead) e a1_atendimento_mensagens.
--      O navegador só LÊ; toda escrita passa pelas funções abaixo.
--      Quem vê: conversa na fila (sem corretor) só o gestor; distribuída, quem
--      vê o lead (o corretor dono, o gestor). Regra do dono: "se não for
--      atribuído a nenhum corretor, somente o gestor conversa".
--   4. Lead que chega por integração (payload.integracao) num cliente com a
--      licença ganha a conversa automaticamente (gatilho em a1_cases).
--   5. Roleta de distribuição em rodízio (a1_lead_roleta): o gestor escolhe os
--      corretores participantes e a ordem; cada lead qualificado vai para o
--      próximo da vez.
--   6. a1_atend_finalizar: qualificado -> roleta escolhe o corretor, o lead
--      ganha o corretor (broker_name, que é o que dá a posse no RLS de Leads) e
--      vai para a etapa com selo EM_ATENDIMENTO do mesmo funil (criada se não
--      existir); desqualificado -> etapa com selo PERDIDO, com o motivo.
--
-- O QUE ELE NÃO MUDA
--   Nenhum lead, etapa ou conversa existente. Sem a licença ATENDIMENTO, nada
--   disto aparece nem roda para nenhum cliente: o gatilho confere a licença e
--   as políticas também. As etapas só são criadas/reordenadas dentro de
--   a1_atend_finalizar, no cliente que usa a Central, quando falta a etapa.
--
-- Idempotente: pode rodar de novo. Como conferir, no fim do arquivo.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Módulo ───────────────────────────────────────────────────────────────
insert into a1_modules (key, name, description) values
  ('ATENDIMENTO', 'Central de atendimento',
   'Caixa de entrada dos leads das integrações: conversa, qualificação e distribuição por roleta para os corretores.')
on conflict (key) do nothing;

-- ── 2. Selo EM_ATENDIMENTO ──────────────────────────────────────────────────
alter table a1_stages drop constraint if exists a1_stages_selo_chk;
alter table a1_stages add constraint a1_stages_selo_chk
  check (selo is null or (module_key = 'crm'
         and selo in ('AGENDAMENTO', 'PRE_ANALISE', 'GANHO', 'PERDIDO', 'EM_ATENDIMENTO')));

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
  if v_selo is not null and v_selo not in ('AGENDAMENTO', 'PRE_ANALISE', 'GANHO', 'PERDIDO', 'EM_ATENDIMENTO') then
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

-- ── 3. Conversas e mensagens ────────────────────────────────────────────────
create table if not exists a1_atendimentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id),
  case_id uuid not null references a1_cases(id) on delete cascade,
  canal text not null default 'meta' check (canal in ('meta', 'whatsapp', 'instagram', 'manual')),
  -- aberta: na fila da Central, sem corretor (só o gestor vê e conversa)
  -- distribuida: com o corretor da roleta (a conversa continua com ele)
  -- encerrada: desqualificada
  status text not null default 'aberta' check (status in ('aberta', 'distribuida', 'encerrada')),
  -- true enquanto ninguém respondeu: é o "novo" da lista
  pendente boolean not null default true,
  corretor_id uuid references a1_partners(id) on delete set null,
  corretor_nome text,
  resultado text check (resultado in ('qualificado', 'desqualificado')),
  finalizado_por text,
  finalizado_em timestamptz,
  ultima_em timestamptz not null default now(),
  ultima_previa text,
  versao int not null default 1,
  criado_em timestamptz not null default now(),
  unique (case_id)
);
create index if not exists a1_atendimentos_lista_idx on a1_atendimentos (tenant_id, status, ultima_em desc);

create table if not exists a1_atendimento_mensagens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id),
  atendimento_id uuid not null references a1_atendimentos(id) on delete cascade,
  autor_tipo text not null check (autor_tipo in ('lead', 'atendente', 'ia', 'sistema')),
  autor_nome text,
  -- mensagem: conversa com o lead (hoje registrada a partir do WhatsApp Web;
  -- com a integração do WhatsApp, enviada de verdade). nota: interna, o lead
  -- nunca vê. evento: o sistema contando o que aconteceu.
  tipo text not null default 'mensagem' check (tipo in ('mensagem', 'nota', 'evento')),
  corpo text not null check (length(corpo) between 1 and 4000),
  criado_em timestamptz not null default now()
);
create index if not exists a1_atendimento_mensagens_conversa_idx
  on a1_atendimento_mensagens (atendimento_id, criado_em);

alter table a1_atendimentos enable row level security;
alter table a1_atendimento_mensagens enable row level security;
revoke all on a1_atendimentos, a1_atendimento_mensagens from public, anon, authenticated;
grant select on a1_atendimentos, a1_atendimento_mensagens to anon, authenticated;

-- A visibilidade do lead (cliente, licença de Leads, posse do corretor) vem
-- do RLS de a1_cases: o exists abaixo roda com as políticas de quem pergunta.
drop policy if exists a1_atendimentos_ler on a1_atendimentos;
create policy a1_atendimentos_ler on a1_atendimentos for select using (
  tenant_id = (select a1_tenant())
  and (select a1_tem_modulo('ATENDIMENTO'))
  and ((select a1_e_gestor()) or status <> 'aberta')
  and exists (select 1 from a1_cases c where c.id = a1_atendimentos.case_id)
);
drop policy if exists a1_atendimento_mensagens_ler on a1_atendimento_mensagens;
create policy a1_atendimento_mensagens_ler on a1_atendimento_mensagens for select using (
  tenant_id = (select a1_tenant())
  and exists (select 1 from a1_atendimentos a where a.id = a1_atendimento_mensagens.atendimento_id)
);

-- ── 4. Lead da integração entra na Central ──────────────────────────────────
create or replace function a1_atend_de_integracao()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_id uuid; v_origem text;
begin
  if coalesce(new.module_key, '') <> 'crm' or not (coalesce(new.payload, '{}'::jsonb) ? 'integracao') then
    return new;
  end if;
  -- Quem cria o lead da integração é a chave de serviço, sem sessão: a licença
  -- é conferida direto, e não por a1_tem_modulo (que lê a sessão).
  if not exists (select 1 from a1_tenant_modules m
                  where m.tenant_id = new.tenant_id and m.module_key = 'ATENDIMENTO'
                    and (m.expires_at is null or m.expires_at > now())) then
    return new;
  end if;
  v_origem := coalesce(new.payload->'integracao'->>'origem', 'manual');
  insert into a1_atendimentos (tenant_id, case_id, canal, ultima_previa)
  values (new.tenant_id, new.id,
          case when v_origem in ('meta', 'whatsapp', 'instagram') then v_origem else 'manual' end,
          left(coalesce('Novo lead · ' || nullif(new.partner_name, ''), 'Novo lead'), 140))
  on conflict (case_id) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, autor_nome, tipo, corpo)
    values (new.tenant_id, v_id, 'sistema', 'SIIMOB', 'evento',
            left(coalesce(nullif(new.observations, ''), 'Lead recebido pela integração.'), 4000));
  end if;
  return new;
end $$;
revoke all on function a1_atend_de_integracao() from public, anon, authenticated;

drop trigger if exists a1_atend_de_integracao_t on a1_cases;
create trigger a1_atend_de_integracao_t
  after insert on a1_cases
  for each row execute function a1_atend_de_integracao();

-- ── Quem está falando (gestor ou parceiro) ───────────────────────────────────
create or replace function a1_atend_nome_ator()
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select coalesce(
    (select p.name from a1_partners p where p.id = a1_ator()),
    (select u.name from a1_users u where u.id = a1_usuario()),
    'Atendente');
$$;
revoke all on function a1_atend_nome_ator() from public;
grant execute on function a1_atend_nome_ator() to anon, authenticated;

-- ── 5. Mandar mensagem ou nota ──────────────────────────────────────────────
-- Na fila (sem corretor), só o gestor. Distribuída, o gestor e o corretor dono
-- do lead (o mesmo critério de posse do RLS de Leads: nome do corretor).
create or replace function a1_atend_enviar(p_atendimento uuid, p_tipo text, p_corpo text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_a a1_atendimentos%rowtype;
  v_corpo text := btrim(coalesce(p_corpo, ''));
  v_nome text := a1_atend_nome_ator();
  v_id uuid;
begin
  if a1_tenant() is null then raise exception 'sem_sessao'; end if;
  if not a1_tem_modulo('ATENDIMENTO') then raise exception 'modulo_desabilitado'; end if;
  if p_tipo not in ('mensagem', 'nota') then raise exception 'tipo_invalido'; end if;
  if v_corpo = '' or length(v_corpo) > 4000 then raise exception 'mensagem_invalida'; end if;
  select * into v_a from a1_atendimentos where id = p_atendimento and tenant_id = a1_tenant();
  if v_a.id is null then raise exception 'conversa_nao_encontrada'; end if;
  if not a1_e_gestor() then
    if v_a.status <> 'distribuida' or not exists (
      select 1 from a1_cases c join a1_partners p on p.id = a1_ator()
       where c.id = v_a.case_id and p.tenant_id = c.tenant_id and p.type = 'corretor'
         and lower(btrim(p.name)) = lower(btrim(coalesce(c.broker_name, '')))) then
      raise exception 'sem_permissao';
    end if;
  end if;
  if v_a.status = 'encerrada' then raise exception 'conversa_encerrada'; end if;
  insert into a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, autor_nome, tipo, corpo)
  values (v_a.tenant_id, v_a.id, 'atendente', v_nome, p_tipo, v_corpo)
  returning id into v_id;
  update a1_atendimentos
     set ultima_em = now(), pendente = false,
         ultima_previa = left(case when p_tipo = 'nota' then 'Nota: ' else '' end || v_corpo, 140)
   where id = v_a.id;
  return json_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function a1_atend_enviar(uuid, text, text) from public;
grant execute on function a1_atend_enviar(uuid, text, text) to anon, authenticated;

-- ── 6. Roleta ───────────────────────────────────────────────────────────────
create table if not exists a1_lead_roleta (
  tenant_id uuid primary key references a1_tenants(id),
  participantes uuid[] not null default '{}',
  ultimo uuid,
  atualizado_em timestamptz not null default now()
);
alter table a1_lead_roleta enable row level security;
revoke all on a1_lead_roleta from public, anon, authenticated;
grant select on a1_lead_roleta to anon, authenticated;
drop policy if exists a1_lead_roleta_ler on a1_lead_roleta;
create policy a1_lead_roleta_ler on a1_lead_roleta for select using (
  tenant_id = (select a1_tenant()) and (select a1_e_gestor()) and (select a1_tem_modulo('ATENDIMENTO'))
);

-- Ordem importa: é a ordem do rodízio. Só corretores do próprio cliente.
create or replace function a1_roleta_salvar(p_participantes uuid[])
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_lista uuid[] := coalesce(p_participantes, '{}');
begin
  if not a1_e_gestor() then raise exception 'sem_permissao'; end if;
  if not a1_tem_modulo('ATENDIMENTO') then raise exception 'modulo_desabilitado'; end if;
  if cardinality(v_lista) > 300 or cardinality(v_lista) <> (select count(distinct x) from unnest(v_lista) x) then
    raise exception 'participantes_invalidos';
  end if;
  if exists (select 1 from unnest(v_lista) x
              where not exists (select 1 from a1_partners p
                                 where p.id = x and p.tenant_id = a1_tenant() and p.type = 'corretor')) then
    raise exception 'participante_nao_e_corretor';
  end if;
  insert into a1_lead_roleta (tenant_id, participantes, atualizado_em)
  values (a1_tenant(), v_lista, now())
  on conflict (tenant_id) do update set participantes = excluded.participantes, atualizado_em = now();
  return json_build_object('ok', true);
end $$;
revoke all on function a1_roleta_salvar(uuid[]) from public;
grant execute on function a1_roleta_salvar(uuid[]) to anon, authenticated;

-- O próximo da vez: o participante depois do último sorteado, entre os ativos
-- e aprovados, na ordem salva. Só lê; quem grava o "último" é finalizar.
create or replace function a1_roleta_proximo(p_tenant uuid)
returns uuid language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare v_part uuid[]; v_ultimo uuid; v_validos uuid[]; v_pos int;
begin
  select participantes, ultimo into v_part, v_ultimo from a1_lead_roleta where tenant_id = p_tenant;
  select coalesce(array_agg(x order by o), '{}') into v_validos
    from unnest(coalesce(v_part, '{}')) with ordinality as t(x, o)
   where exists (select 1 from a1_partners p
                  where p.id = t.x and p.tenant_id = p_tenant and p.type = 'corretor'
                    and coalesce(p.is_active, true) and coalesce(p.approved, true));
  if cardinality(v_validos) = 0 then return null; end if;
  v_pos := array_position(v_validos, v_ultimo);
  if v_pos is null or v_pos >= cardinality(v_validos) then return v_validos[1]; end if;
  return v_validos[v_pos + 1];
end $$;
revoke all on function a1_roleta_proximo(uuid) from public;

-- Para a tela mostrar "próximo da vez" ao gestor.
create or replace function a1_roleta_proximo_nome()
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case when a1_e_gestor() and a1_tem_modulo('ATENDIMENTO')
    then (select p.name from a1_partners p where p.id = a1_roleta_proximo(a1_tenant())) end;
$$;
revoke all on function a1_roleta_proximo_nome() from public;
grant execute on function a1_roleta_proximo_nome() to anon, authenticated;

-- ── 7. Finalizar o atendimento ──────────────────────────────────────────────
create or replace function a1_atend_finalizar(
  p_atendimento uuid, p_resultado text, p_versao int,
  p_motivo text default null, p_obs text default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_a a1_atendimentos%rowtype;
  v_c a1_cases%rowtype;
  v_atual a1_stages%rowtype;
  v_alvo a1_stages%rowtype;
  v_ini a1_stages%rowtype;
  v_corretor a1_partners%rowtype;
  v_imob_id text;
  v_imob_nome text;
  v_nome text := a1_atend_nome_ator();
  v_texto text;
begin
  if not a1_e_gestor() then raise exception 'sem_permissao'; end if;
  if not a1_tem_modulo('ATENDIMENTO') or not a1_tem_modulo('crm') then raise exception 'modulo_desabilitado'; end if;
  if p_resultado not in ('qualificado', 'desqualificado') then raise exception 'resultado_invalido'; end if;

  -- Lock por cliente: a roleta não pode dar o mesmo "próximo" a dois leads
  -- finalizados ao mesmo tempo. Relê depois do lock.
  perform pg_advisory_xact_lock(hashtext('atend-roleta:' || a1_tenant()::text));
  select * into v_a from a1_atendimentos where id = p_atendimento and tenant_id = a1_tenant() for update;
  if v_a.id is null then raise exception 'conversa_nao_encontrada'; end if;
  if v_a.status <> 'aberta' then raise exception 'ja_finalizada'; end if;
  if p_versao is distinct from v_a.versao then raise exception 'versao_desatualizada'; end if;

  select * into v_c from a1_cases where id = v_a.case_id for update;
  select * into v_atual from a1_stages where id = v_c.stage_id;

  if p_resultado = 'qualificado' then
    select * into v_corretor from a1_partners where id = a1_roleta_proximo(v_a.tenant_id);
    if v_corretor.id is null then raise exception 'roleta_vazia'; end if;

    select * into v_alvo from a1_stages
     where tenant_id = v_a.tenant_id and module_key = 'crm'
       and coalesce(group_key, 'geral') = coalesce(v_atual.group_key, 'geral')
       and selo = 'EM_ATENDIMENTO';
    if v_alvo.id is null then
      -- "se não tiver esse selo no workflow, crie": logo depois da etapa de
      -- início do funil, empurrando as seguintes uma posição.
      select * into v_ini from a1_stages
       where tenant_id = v_a.tenant_id and module_key = 'crm'
         and coalesce(group_key, 'geral') = coalesce(v_atual.group_key, 'geral')
       order by is_initial desc, position asc nulls last limit 1;
      update a1_stages set position = position + 1
       where tenant_id = v_a.tenant_id and module_key = 'crm' and position > coalesce(v_ini.position, 0);
      insert into a1_stages (tenant_id, module_key, group_key, name, color, position, is_initial, is_final, selo)
      values (v_a.tenant_id, 'crm', v_atual.group_key, 'Em atendimento', '#0e8c7f',
              coalesce(v_ini.position, 0) + 1, false, false, 'EM_ATENDIMENTO')
      returning * into v_alvo;
    end if;

    v_imob_id := nullif(v_corretor.extra->>'imobiliaria_id', '');
    if v_imob_id is not null then
      select name into v_imob_nome from a1_partners
       where id = v_imob_id::uuid and tenant_id = v_a.tenant_id;
    end if;

    update a1_cases
       set broker_name = v_corretor.name,
           real_estate_name = coalesce(v_imob_nome, real_estate_name),
           stage_id = v_alvo.id, stage_name = v_alvo.name, stage_entered_at = now(),
           payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{crm_refs}',
                     coalesce(payload->'crm_refs', '{}'::jsonb)
                       || jsonb_build_object('corretor_id', v_corretor.id::text)
                       || case when v_imob_id is not null then jsonb_build_object('imobiliaria_id', v_imob_id) else '{}'::jsonb end)
     where id = v_c.id;

    update a1_lead_roleta set ultimo = v_corretor.id, atualizado_em = now() where tenant_id = v_a.tenant_id;

    v_texto := 'Lead qualificado por ' || v_nome || ' e distribuído pela roleta para ' || v_corretor.name
               || '. Etapa: ' || v_alvo.name || '.';
    update a1_atendimentos
       set status = 'distribuida', resultado = 'qualificado', corretor_id = v_corretor.id,
           corretor_nome = v_corretor.name, finalizado_por = v_nome, finalizado_em = now(),
           versao = versao + 1, ultima_em = now(), pendente = false, ultima_previa = left(v_texto, 140)
     where id = v_a.id;
    insert into a1_events (tenant_id, case_id, type, description, actor_name)
    values (v_a.tenant_id, v_c.id, 'distribuicao', left(v_texto, 300), v_nome);
  else
    select * into v_alvo from a1_stages
     where tenant_id = v_a.tenant_id and module_key = 'crm'
       and coalesce(group_key, 'geral') = coalesce(v_atual.group_key, 'geral')
       and selo = 'PERDIDO';
    if v_alvo.id is null then raise exception 'sem_etapa_perdido'; end if;
    if nullif(btrim(coalesce(p_motivo, '')), '') is null and nullif(btrim(coalesce(p_obs, '')), '') is null then
      raise exception 'motivo_obrigatorio';
    end if;
    update a1_cases
       set stage_id = v_alvo.id, stage_name = v_alvo.name, stage_entered_at = now(),
           payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('perda', jsonb_build_object(
             'motivo', nullif(left(btrim(coalesce(p_motivo, '')), 200), ''),
             'obs', nullif(left(btrim(coalesce(p_obs, '')), 1000), ''),
             'em', now(), 'por', v_nome))
     where id = v_c.id;
    v_texto := 'Lead desqualificado por ' || v_nome || ': '
               || concat_ws(' · ', nullif(btrim(coalesce(p_motivo, '')), ''), nullif(btrim(coalesce(p_obs, '')), ''))
               || '. Etapa: ' || v_alvo.name || '.';
    update a1_atendimentos
       set status = 'encerrada', resultado = 'desqualificado', finalizado_por = v_nome,
           finalizado_em = now(), versao = versao + 1, ultima_em = now(), pendente = false,
           ultima_previa = left(v_texto, 140)
     where id = v_a.id;
    insert into a1_events (tenant_id, case_id, type, description, actor_name)
    values (v_a.tenant_id, v_c.id, 'stage_change', left(v_texto, 300), v_nome);
  end if;

  insert into a1_stage_history (tenant_id, case_id, stage_id, stage_name, entered_at, actor_name)
  values (v_a.tenant_id, v_c.id, v_alvo.id, v_alvo.name, now(), v_nome);
  insert into a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, autor_nome, tipo, corpo)
  values (v_a.tenant_id, v_a.id, 'sistema', 'SIIMOB', 'evento', left(v_texto, 4000));

  return json_build_object('ok', true, 'resultado', p_resultado,
                           'corretor', v_corretor.name, 'etapa', v_alvo.name);
end $$;
revoke all on function a1_atend_finalizar(uuid, text, int, text, text) from public;
grant execute on function a1_atend_finalizar(uuid, text, int, text, text) to anon, authenticated;

-- ── COMO CONFERIR ───────────────────────────────────────────────────────────
--   select key, name from a1_modules where key = 'ATENDIMENTO';           -- 1 linha
--   select count(*) from a1_tenant_modules where module_key = 'ATENDIMENTO'; -- 0
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'a1_stages_selo_chk';
--   -- Ninguém vê nada até o superadmin ligar a licença para um cliente.
