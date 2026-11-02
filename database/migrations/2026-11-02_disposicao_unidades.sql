-- =============================================================================
-- DISPOSIÇÃO DE UNIDADES: ficha da unidade, mapa de preço, parâmetros de
-- pagamento e reserva com fluxo de pagamento
--
-- POR QUE ESTE ARQUIVO EXISTE
-- Até aqui a unidade era só um texto: a1_developments.units guarda uma lista
-- ("B1-101", "B1-102"...) gerada pelo cadastro rápido de blocos e pavimentos.
-- Texto não tem dono, não tem situação e não deixa rastro. A construtora
-- precisa saber, em tempo real, o que está disponível, reservado, vendido e
-- bloqueado, quanto custa cada unidade e como o cliente vai pagar. Para isso a
-- unidade vira uma linha com id próprio, e tudo o que acontece com ela fica
-- escrito em a1_unidade_eventos.
--
-- O QUE NÃO MUDA
-- - Nenhuma linha de cliente é alterada por este arquivo. As tabelas novas
--   nascem vazias. a1_comerciais ganha duas colunas vazias (unidade_id,
--   reserva_id); nenhuma venda existente é tocada.
-- - O módulo DISPOSICAO entra no catálogo DESLIGADO para todo mundo. Sem a
--   licença, as tabelas novas devolvem lista vazia e as funções recusam.
-- - a1_developments.units continua existindo e continua sendo a lista que o
--   Repasse usa para escolher a unidade. Quando um cliente com o módulo cria
--   ou exclui uma unidade, a lista é refeita a partir das fichas, para as duas
--   coisas não divergirem.
-- - Nenhuma função existente é redefinida. A ligação com a Venda é um gatilho
--   novo que só age em venda que nasceu de reserva (unidade_id preenchido).
--
-- A SITUAÇÃO DA UNIDADE SÓ MUDA POR FUNÇÃO
-- disponivel → reservado → vendido, mais bloqueado e o distrato. Um PATCH
-- direto em status é recusado pelo gatilho de guarda, do mesmo jeito que a
-- situação da Pré-análise e da Venda: quem muda é a função que valida, trava
-- e registra (marca a1.orquestrador). É isso que impede duas pessoas de
-- reservarem a mesma unidade no mesmo segundo.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- Ordem: depois de todos os arquivos anteriores (usa a1_tenant, a1_ator,
-- a1_perm, a1_e_gestor, a1_tem_modulo, a1_integra_registrar).
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ─── Catálogo ────────────────────────────────────────────────────────────────
-- "Espelho de vendas" e "Disponibilidade" são nomes de outros produtos. Aqui o
-- módulo se chama Disposição de unidades.
insert into a1_modules (key, name, description) values
  ('DISPOSICAO', 'Disposição de unidades',
   'Ficha completa de cada unidade, mapa de preço, parâmetros de pagamento, ' ||
   'mapa visual da disposição (disponível, reservada, vendida, bloqueada) e ' ||
   'reserva com fluxo de pagamento que já abre a Venda.')
on conflict (key) do update
  set name = excluded.name, description = excluded.description;

-- =============================================================================
-- TABELAS
-- =============================================================================

-- ─── A unidade ───────────────────────────────────────────────────────────────
create table if not exists a1_unidades (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  empreendimento_id  uuid not null references a1_developments(id) on delete cascade,
  -- O mesmo texto que o Repasse e a Venda já usam ("B1-101"). É por ele que a
  -- ficha casa com a lista antiga de a1_developments.units.
  codigo             text not null,
  etapa              text,          -- fase da obra, quando o empreendimento tem mais de uma
  bloco              text,
  pavimento          int,
  numero             text,
  final              text,          -- a "coluna" da planta: os 01 de todos os andares
  matricula          text,
  tipologia          text,          -- "2 quartos", "Studio", "Cobertura"...
  descricao          text,
  area_privativa     numeric(10,2) check (area_privativa is null or area_privativa >= 0),
  area_comum         numeric(10,2) check (area_comum is null or area_comum >= 0),
  area_total         numeric(10,2) check (area_total is null or area_total >= 0),
  area_terreno       numeric(10,2) check (area_terreno is null or area_terreno >= 0),
  fracao_ideal       numeric(14,8) check (fracao_ideal is null or fracao_ideal >= 0),
  quartos            int check (quartos is null or quartos >= 0),
  suites             int check (suites is null or suites >= 0),
  banheiros          int check (banheiros is null or banheiros >= 0),
  vagas              int check (vagas is null or vagas >= 0),
  vaga_tipo          text,          -- coberta, descoberta, presa, livre
  vaga_identificacao text,
  deposito           text,
  posicao_solar      text,          -- nascente, poente...
  posicao            text,          -- frente, fundos, lateral
  vista              text,
  status             text not null default 'disponivel'
                     check (status in ('disponivel','reservado','vendido','bloqueado')),
  status_motivo      text,
  status_em          timestamptz not null default now(),
  -- Bloqueio com prazo: passada a data, a unidade volta sozinha a disponível.
  bloqueado_ate      timestamptz,
  observacoes        text,
  -- Campo que a construtora quiser e o sistema ainda não tem, sem migração.
  extras             jsonb not null default '{}'::jsonb,
  -- Versão da SITUAÇÃO. A reserva manda a versão que viu; se outra pessoa
  -- reservou no meio, a chamada falha em vez de passar por cima.
  versao             int not null default 1,
  criado_por         uuid,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  unique (empreendimento_id, codigo)
);
create index if not exists idx_un_tenant_emp on a1_unidades (tenant_id, empreendimento_id);
create index if not exists idx_un_tenant_status on a1_unidades (tenant_id, status);

-- ─── O que aconteceu com ela ─────────────────────────────────────────────────
-- Sem chave estrangeira para a unidade de propósito: a ficha pode ser excluída
-- e o rastro tem de continuar dizendo o que ela foi.
create table if not exists a1_unidade_eventos (
  id                bigserial primary key,
  tenant_id         uuid not null,
  unidade_id        uuid not null,
  empreendimento_id uuid,
  codigo            text,
  evento            text not null,   -- CRIADA, EDITADA, STATUS, PRECO, EXCLUIDA
  de                text,
  para              text,
  detalhe           jsonb not null default '{}'::jsonb,
  ator_id           uuid,
  ator_nome         text,
  criado_em         timestamptz not null default now()
);
create index if not exists idx_un_ev on a1_unidade_eventos (tenant_id, unidade_id, criado_em desc);
create index if not exists idx_un_ev_data on a1_unidade_eventos (tenant_id, criado_em desc);

-- ─── Parâmetros de pagamento ─────────────────────────────────────────────────
-- As peças com que o fluxo de pagamento do cliente é montado. Cada uma diz de
-- quantos em quantos meses vence (0 = parcela única) e até quantas parcelas
-- aceita. Quem paga separa recurso próprio (cliente) de financiamento, FGTS e
-- subsídio, que o painel precisa ver separados.
create table if not exists a1_parametros_pagamento (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  nome                text not null,
  serie               text not null check (serie in ('ATO','SINAL','MENSAL','BIMESTRAL',
                        'TRIMESTRAL','SEMESTRAL','ANUAL','INTERMEDIARIA','CHAVES',
                        'FINANCIAMENTO','FGTS','SUBSIDIO','A_VISTA','OUTRO')),
  periodicidade_meses int not null default 0 check (periodicidade_meses between 0 and 60),
  parcelas_min        int not null default 1 check (parcelas_min >= 1),
  parcelas_max        int not null default 1 check (parcelas_max >= 1 and parcelas_max <= 600),
  exige_vencimento    boolean not null default true,
  -- Parcela menor que isto não compensa cobrar (ex.: mensal mínima de R$ 200).
  valor_minimo        numeric(14,2) check (valor_minimo is null or valor_minimo >= 0),
  quem_paga           text not null default 'CLIENTE' check (quem_paga in ('CLIENTE','BANCO','GOVERNO')),
  ordem               int not null default 0,
  ativo               boolean not null default true,
  criado_em           timestamptz not null default now(),
  check (parcelas_min <= parcelas_max),
  unique (tenant_id, nome)
);
create index if not exists idx_pp_tenant on a1_parametros_pagamento (tenant_id, ordem);

-- ─── Regras da disposição, por cliente ───────────────────────────────────────
create table if not exists a1_disposicao_config (
  tenant_id                uuid primary key,
  -- Quanto tempo a reserva segura a unidade sem a venda andar. 0 = não vence.
  reserva_horas            int not null default 48 check (reserva_horas between 0 and 8760),
  -- A soma do fluxo tem de bater com o preço da unidade para reservar.
  exige_fluxo_fechado      boolean not null default true,
  -- O corretor pode cancelar a PRÓPRIA reserva.
  corretor_cancela_propria boolean not null default true,
  -- Quantas reservas ATIVAS um mesmo CPF pode ter ao mesmo tempo. 0 = sem limite.
  max_reservas_por_cpf     int not null default 0 check (max_reservas_por_cpf >= 0),
  atualizado_em            timestamptz not null default now()
);

-- ─── Mapa de preço ───────────────────────────────────────────────────────────
-- Um mapa por empreendimento vale de cada vez. Reajuste é um mapa novo, e o
-- antigo fica como história: a reserva guarda qual mapa estava valendo.
create table if not exists a1_mapas_preco (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  empreendimento_id uuid not null references a1_developments(id) on delete cascade,
  nome              text not null,
  vigente_desde     date not null default current_date,
  vigente_ate       date,
  ativo             boolean not null default false,
  observacao        text,
  criado_por        uuid,
  criado_em         timestamptz not null default now()
);
create unique index if not exists idx_mp_um_ativo
  on a1_mapas_preco (empreendimento_id) where ativo;
create index if not exists idx_mp_tenant on a1_mapas_preco (tenant_id, empreendimento_id);

create table if not exists a1_mapa_preco_itens (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  mapa_id    uuid not null references a1_mapas_preco(id) on delete cascade,
  unidade_id uuid not null references a1_unidades(id) on delete cascade,
  valor      numeric(14,2) not null check (valor > 0),
  unique (mapa_id, unidade_id)
);
create index if not exists idx_mpi_unidade on a1_mapa_preco_itens (unidade_id);

-- ─── Reserva ─────────────────────────────────────────────────────────────────
create sequence if not exists a1_reservas_seq;

create table if not exists a1_reservas (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  codigo            text not null default ('RS-' || lpad(nextval('a1_reservas_seq')::text, 6, '0')),
  unidade_id        uuid not null references a1_unidades(id) on delete restrict,
  empreendimento_id uuid not null,
  status            text not null default 'ATIVA'
                    check (status in ('ATIVA','CONVERTIDA','CANCELADA','EXPIRADA')),
  expira_em         timestamptz,
  corretor_id       uuid,
  imobiliaria_id    uuid,
  -- titular, cônjuge e associados, como foram informados na reserva
  cliente           jsonb not null default '{}'::jsonb,
  -- linhas do fluxo: parametro_id, serie, nome, valor, quantidade,
  -- periodicidade_meses, primeiro_vencimento, quem_paga
  fluxo             jsonb not null default '[]'::jsonb,
  valor_unidade     numeric(14,2),
  valor_fluxo       numeric(14,2),
  mapa_preco_id     uuid,
  comercial_id      uuid,
  observacao        text,
  motivo            text,          -- do cancelamento, da expiração
  criado_por        uuid,
  criado_por_nome   text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
-- A última linha de defesa contra duas reservas da mesma unidade: mesmo que a
-- trava falhasse, o banco não aceita duas ATIVAS para a mesma unidade.
create unique index if not exists idx_rs_uma_ativa
  on a1_reservas (unidade_id) where status = 'ATIVA';
create index if not exists idx_rs_tenant on a1_reservas (tenant_id, status, criado_em desc);
create index if not exists idx_rs_corretor on a1_reservas (tenant_id, corretor_id);

-- ─── A Venda sabe de que unidade e de que reserva veio ───────────────────────
alter table a1_comerciais add column if not exists unidade_id uuid;
alter table a1_comerciais add column if not exists reserva_id uuid;
create index if not exists idx_co_unidade on a1_comerciais (unidade_id) where unidade_id is not null;

-- =============================================================================
-- AUXILIARES
-- =============================================================================

-- Nome de quem está agindo, gravado junto do evento: se a pessoa mudar de nome
-- ou sair amanhã, o histórico de ontem continua legível.
create or replace function a1_ator_nome()
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select coalesce(
    (select name from a1_partners where id = a1_ator()),
    (select name from a1_users where id = a1_usuario()),
    'sistema');
$$;
grant execute on function a1_ator_nome() to anon, authenticated;

-- Quem pode ver e usar a disposição. Gestor sempre; os demais pela permissão.
create or replace function a1_disp_pode(p_chave text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select a1_tem_modulo('DISPOSICAO') and (a1_e_gestor() or a1_perm(p_chave));
$$;
grant execute on function a1_disp_pode(text) to anon, authenticated;

-- =============================================================================
-- GATILHOS
-- =============================================================================

-- ─── Guarda da unidade ───────────────────────────────────────────────────────
create or replace function a1_unidades_guarda()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    -- Ficha nova nasce disponível, na versão 1, no cliente de quem cria, a não
    -- ser que venha de uma função da disposição.
    if not a1_no_orquestrador() then
      new.status := 'disponivel';
      new.status_motivo := null;
      new.versao := 1;
    end if;
    -- A unidade é do mesmo cliente do empreendimento. Sem isto, um POST com o
    -- id de empreendimento de outro cliente penduraria a ficha lá.
    if not exists (select 1 from a1_developments d
                    where d.id = new.empreendimento_id and d.tenant_id = new.tenant_id) then
      raise exception 'empreendimento_de_outro_cliente';
    end if;
    new.criado_por := coalesce(new.criado_por, a1_ator());
    return new;
  end if;

  if not a1_no_orquestrador() then
    if new.status is distinct from old.status
       or new.versao is distinct from old.versao
       or new.status_em is distinct from old.status_em
       or new.status_motivo is distinct from old.status_motivo
       or new.bloqueado_ate is distinct from old.bloqueado_ate then
      raise exception 'situacao_da_unidade_so_pela_disposicao';
    end if;
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.empreendimento_id is distinct from old.empreendimento_id then
    raise exception 'unidade_nao_muda_de_empreendimento';
  end if;
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists trg_un_guarda on a1_unidades;
create trigger trg_un_guarda before insert or update on a1_unidades
  for each row execute function a1_unidades_guarda();

-- ─── Rastro da unidade ───────────────────────────────────────────────────────
-- As funções da disposição deixam o contexto (reserva, motivo) em
-- a1.evento_detalhe antes de mudar a situação; o rastro grava junto.
create or replace function a1_unidades_rastro()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_det jsonb := coalesce(nullif(current_setting('a1.evento_detalhe', true), '')::jsonb, '{}'::jsonb);
  v_mud jsonb := '{}'::jsonb;
  v_campo text;
begin
  if tg_op = 'INSERT' then
    insert into a1_unidade_eventos (tenant_id, unidade_id, empreendimento_id, codigo, evento,
                                    para, detalhe, ator_id, ator_nome)
    values (new.tenant_id, new.id, new.empreendimento_id, new.codigo, 'CRIADA',
            new.status, v_det, a1_ator(), a1_ator_nome());
    return new;
  elsif tg_op = 'DELETE' then
    insert into a1_unidade_eventos (tenant_id, unidade_id, empreendimento_id, codigo, evento,
                                    de, detalhe, ator_id, ator_nome)
    values (old.tenant_id, old.id, old.empreendimento_id, old.codigo, 'EXCLUIDA',
            old.status, v_det, a1_ator(), a1_ator_nome());
    return old;
  end if;

  if new.status is distinct from old.status then
    insert into a1_unidade_eventos (tenant_id, unidade_id, empreendimento_id, codigo, evento,
                                    de, para, detalhe, ator_id, ator_nome)
    values (new.tenant_id, new.id, new.empreendimento_id, new.codigo, 'STATUS',
            old.status, new.status,
            v_det || jsonb_strip_nulls(jsonb_build_object('motivo', new.status_motivo)),
            a1_ator(), a1_ator_nome());
  end if;

  -- O que mudou na ficha, campo a campo: de quanto para quanto.
  foreach v_campo in array array['codigo','etapa','bloco','pavimento','numero','final','matricula',
      'tipologia','descricao',
      'area_privativa','area_comum','area_total','area_terreno','fracao_ideal','quartos',
      'suites','banheiros','vagas','vaga_tipo','vaga_identificacao','deposito',
      'posicao_solar','posicao','vista','observacoes','extras'] loop
    if (to_jsonb(new) -> v_campo) is distinct from (to_jsonb(old) -> v_campo) then
      v_mud := v_mud || jsonb_build_object(v_campo,
        jsonb_build_object('de', to_jsonb(old) -> v_campo, 'para', to_jsonb(new) -> v_campo));
    end if;
  end loop;
  if v_mud <> '{}'::jsonb then
    insert into a1_unidade_eventos (tenant_id, unidade_id, empreendimento_id, codigo, evento,
                                    detalhe, ator_id, ator_nome)
    values (new.tenant_id, new.id, new.empreendimento_id, new.codigo, 'EDITADA',
            jsonb_build_object('campos', v_mud), a1_ator(), a1_ator_nome());
  end if;
  return new;
end $$;

drop trigger if exists trg_un_rastro on a1_unidades;
create trigger trg_un_rastro after insert or update or delete on a1_unidades
  for each row execute function a1_unidades_rastro();

-- ─── A lista antiga acompanha as fichas ──────────────────────────────────────
-- O Repasse escolhe a unidade em a1_developments.units. Quando o cliente com o
-- módulo cria, renomeia ou exclui uma ficha, a lista é refeita a partir das
-- fichas, na ordem de bloco, pavimento e número.
create or replace function a1_unidades_refaz_lista(p_empreendimento uuid)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  update a1_developments d
     set units = coalesce((
           select jsonb_agg(u.codigo order by u.bloco nulls first, u.pavimento nulls first,
                                              u.numero nulls first, u.codigo)
             from a1_unidades u where u.empreendimento_id = p_empreendimento), '[]'::jsonb),
         unit_count = (select count(*) from a1_unidades u where u.empreendimento_id = p_empreendimento)
   where d.id = p_empreendimento;
end $$;
revoke all on function a1_unidades_refaz_lista(uuid) from public, anon, authenticated;

create or replace function a1_unidades_sincroniza_lista()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    perform a1_unidades_refaz_lista(old.empreendimento_id);
    return old;
  end if;
  if tg_op = 'INSERT' or new.codigo is distinct from old.codigo then
    perform a1_unidades_refaz_lista(new.empreendimento_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_un_lista on a1_unidades;
create trigger trg_un_lista after insert or update of codigo or delete on a1_unidades
  for each row execute function a1_unidades_sincroniza_lista();

-- ─── Guarda do mapa de preço ─────────────────────────────────────────────────
create or replace function a1_mapa_preco_itens_guarda()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  -- O item é do mesmo cliente do mapa, e a unidade é do mesmo empreendimento.
  if not exists (select 1 from a1_mapas_preco m join a1_unidades u
                   on u.empreendimento_id = m.empreendimento_id
                  where m.id = new.mapa_id and u.id = new.unidade_id
                    and m.tenant_id = new.tenant_id and u.tenant_id = new.tenant_id) then
    raise exception 'item_de_preco_fora_do_mapa';
  end if;
  return new;
end $$;

drop trigger if exists trg_mpi_guarda on a1_mapa_preco_itens;
create trigger trg_mpi_guarda before insert or update on a1_mapa_preco_itens
  for each row execute function a1_mapa_preco_itens_guarda();

create or replace function a1_mapas_preco_guarda()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if not exists (select 1 from a1_developments d
                  where d.id = new.empreendimento_id and d.tenant_id = new.tenant_id) then
    raise exception 'empreendimento_de_outro_cliente';
  end if;
  if tg_op = 'UPDATE' and new.empreendimento_id is distinct from old.empreendimento_id then
    raise exception 'mapa_nao_muda_de_empreendimento';
  end if;
  new.criado_por := coalesce(new.criado_por, a1_ator());
  return new;
end $$;

drop trigger if exists trg_mp_guarda on a1_mapas_preco;
create trigger trg_mp_guarda before insert or update on a1_mapas_preco
  for each row execute function a1_mapas_preco_guarda();

-- Mudança de preço do mapa que está valendo entra no rastro da unidade.
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
  if tg_op = 'UPDATE' and new.valor is not distinct from old.valor then return new; end if;
  insert into a1_unidade_eventos (tenant_id, unidade_id, empreendimento_id, codigo, evento,
                                  de, para, detalhe, ator_id, ator_nome)
  values (v_u.tenant_id, v_u.id, v_u.empreendimento_id, v_u.codigo, 'PRECO',
          case when tg_op = 'INSERT' then null else old.valor::text end,
          case when tg_op = 'DELETE' then null else new.valor::text end,
          jsonb_build_object('mapa_id', coalesce(new.mapa_id, old.mapa_id)),
          a1_ator(), a1_ator_nome());
  return coalesce(new, old);
end $$;

drop trigger if exists trg_mpi_rastro on a1_mapa_preco_itens;
create trigger trg_mpi_rastro after insert or update or delete on a1_mapa_preco_itens
  for each row execute function a1_mapa_preco_itens_rastro();

-- Parâmetro e configuração: sempre do cliente de quem grava.
create or replace function a1_disp_tenant_da_sessao()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if a1_tenant() is not null then new.tenant_id := a1_tenant(); end if;
  return new;
end $$;

drop trigger if exists trg_pp_tenant on a1_parametros_pagamento;
create trigger trg_pp_tenant before insert on a1_parametros_pagamento
  for each row execute function a1_disp_tenant_da_sessao();
drop trigger if exists trg_dc_tenant on a1_disposicao_config;
create trigger trg_dc_tenant before insert on a1_disposicao_config
  for each row execute function a1_disp_tenant_da_sessao();

-- =============================================================================
-- FUNÇÕES DA DISPOSIÇÃO
-- =============================================================================

-- ─── Muda a situação, com rastro (uso interno) ───────────────────────────────
create or replace function a1_unidade_mudar_status(p_unidade uuid, p_status text,
  p_motivo text, p_detalhe jsonb)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  perform set_config('a1.orquestrador', '1', true);
  perform set_config('a1.evento_detalhe', coalesce(p_detalhe, '{}'::jsonb)::text, true);
  update a1_unidades
     set status = p_status, status_motivo = p_motivo, status_em = now(), versao = versao + 1
   where id = p_unidade;
  perform set_config('a1.evento_detalhe', '', true);
end $$;
revoke all on function a1_unidade_mudar_status(uuid, text, text, jsonb) from public, anon, authenticated;

-- ─── Reservas vencidas liberam a unidade ─────────────────────────────────────
-- Não existe agendador: a tela chama a1_disposicao_atualizar() ao abrir e a
-- cada atualização, e a reserva confere antes de decidir. A reserva cuja venda
-- já saiu da situação inicial não vence: a venda andou, a unidade é dela.
create or replace function a1_disposicao_expirar(p_tenant uuid)
returns int language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_r record; v_n int := 0;
begin
  for v_r in
    select r.* from a1_reservas r
     where r.tenant_id = p_tenant and r.status = 'ATIVA'
       and r.expira_em is not null and r.expira_em < now()
       and (r.comercial_id is null or exists (
             select 1 from a1_comerciais c join a1_co_situacoes s on s.id = c.situacao_id
              where c.id = r.comercial_id and s.flag = 'INICIAL'))
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
  -- Bloqueio que tinha data para acabar.
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

create or replace function a1_disposicao_atualizar()
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if not a1_disp_pode('disp_ver') then raise exception 'sem_acesso'; end if;
  return json_build_object('ok', true, 'expiradas', a1_disposicao_expirar(a1_tenant()),
                           'agora', now());
end $$;
grant execute on function a1_disposicao_atualizar() to anon, authenticated;

-- ─── Fichas a partir da lista antiga ─────────────────────────────────────────
-- Empreendimento cadastrado antes do módulo tem só a lista de textos. Esta
-- função cria uma ficha para cada texto que ainda não tem uma, lendo bloco,
-- pavimento e número do próprio código ("B1-101" → bloco B1, pavimento 1,
-- unidade 01), e não mexe em ficha que já existe. Pode rodar quantas vezes
-- quiser.
create or replace function a1_unidades_materializar(p_empreendimento uuid)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_dev a1_developments%rowtype; v_cod text; v_n int := 0; v_m text[]; v_seq text;
begin
  if not a1_disp_pode('disp_configurar') then raise exception 'sem_permissao'; end if;
  select * into v_dev from a1_developments where id = p_empreendimento;
  if v_dev.id is null or v_dev.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  perform pg_advisory_xact_lock(hashtext('emp:' || p_empreendimento::text));

  if jsonb_typeof(v_dev.units) = 'array' then
    for v_cod in select jsonb_array_elements_text(v_dev.units) loop
      v_cod := trim(v_cod);
      continue when v_cod = '';
      v_m := regexp_match(v_cod, '^(.+)-(\d+)$');
      v_seq := v_m[2];
      insert into a1_unidades (tenant_id, empreendimento_id, codigo, bloco, pavimento, numero)
      values (v_dev.tenant_id, v_dev.id, v_cod, v_m[1],
              case when v_seq is not null and length(v_seq) >= 3
                   then left(v_seq, length(v_seq) - 2)::int end,
              case when v_seq is not null and length(v_seq) >= 3
                   then right(v_seq, 2) else v_seq end)
      on conflict (empreendimento_id, codigo) do nothing;
      if found then v_n := v_n + 1; end if;
    end loop;
  end if;
  perform a1_unidades_refaz_lista(p_empreendimento);
  return json_build_object('ok', true, 'criadas', v_n);
end $$;
grant execute on function a1_unidades_materializar(uuid) to anon, authenticated;

-- ─── Ativar um mapa de preço ─────────────────────────────────────────────────
-- Desliga o que estava valendo e liga este, na mesma transação. Dois PATCH
-- separados deixariam o empreendimento um instante sem preço ou, ao
-- contrário, esbarrariam no índice de um só ativo.
create or replace function a1_mapa_preco_ativar(p_mapa uuid)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_m a1_mapas_preco%rowtype;
begin
  if not a1_disp_pode('disp_configurar') then raise exception 'sem_permissao'; end if;
  select * into v_m from a1_mapas_preco where id = p_mapa;
  if v_m.id is null or v_m.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  perform pg_advisory_xact_lock(hashtext('mapa:' || v_m.empreendimento_id::text));
  update a1_mapas_preco set ativo = false where empreendimento_id = v_m.empreendimento_id and ativo and id <> p_mapa;
  update a1_mapas_preco set ativo = true where id = p_mapa;
  return json_build_object('ok', true);
end $$;
grant execute on function a1_mapa_preco_ativar(uuid) to anon, authenticated;

-- ─── Reajuste: um mapa novo a partir de outro ────────────────────────────────
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
  insert into a1_mapa_preco_itens (tenant_id, mapa_id, unidade_id, valor)
  select v_m.tenant_id, v_novo, i.unidade_id, round(i.valor * (1 + p_reajuste_pct / 100.0), 2)
    from a1_mapa_preco_itens i where i.mapa_id = p_mapa;
  return json_build_object('ok', true, 'mapa_id', v_novo);
end $$;
grant execute on function a1_mapa_preco_duplicar(uuid, text, numeric, date) to anon, authenticated;

-- ─── RESERVAR ────────────────────────────────────────────────────────────────
-- Tudo numa transação: trava a unidade, confere que está disponível e na versão
-- que a tela viu, confere o preço do mapa que está valendo, confere cada linha
-- do fluxo contra o parâmetro (quantidade dentro do limite, vencimento quando o
-- parâmetro exige), confere que a soma fecha com o preço, grava a reserva, muda
-- a situação e, se o cliente tem a Venda, abre a venda na situação inicial
-- com o fluxo já como proposta.
create or replace function a1_unidade_reservar(
  p_unidade uuid, p_cliente jsonb, p_fluxo jsonb,
  p_versao_esperada int default null, p_corretor uuid default null,
  p_imobiliaria uuid default null, p_observacao text default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_un    a1_unidades%rowtype;
  v_dev   a1_developments%rowtype;
  v_cfg   a1_disposicao_config%rowtype;
  v_par   a1_parametros_pagamento%rowtype;
  v_l     jsonb;
  v_valor numeric; v_mapa uuid;
  v_total numeric := 0; v_q int; v_v numeric;
  v_fluxo jsonb := '[]'::jsonb;
  v_corretor uuid; v_imob uuid;
  v_res   uuid; v_cod text; v_expira timestamptz;
  v_co    uuid; v_sit uuid;
  v_cond  jsonb := '[]'::jsonb;
  v_cred_fin numeric := 0; v_cred_fgts numeric := 0; v_cred_sub numeric := 0;
  v_part  jsonb := '[]'::jsonb; v_a jsonb;
begin
  perform set_config('a1.orquestrador', '1', true);
  if not a1_tem_modulo('DISPOSICAO') then raise exception 'modulo_desabilitado'; end if;
  if not (a1_e_gestor() or a1_perm('disp_reservar')) then raise exception 'sem_permissao'; end if;

  perform pg_advisory_xact_lock(hashtext('un:' || p_unidade::text));
  perform a1_disposicao_expirar(a1_tenant());

  -- Reler DEPOIS da trava: o que foi lido antes pode já ser passado.
  select * into v_un from a1_unidades where id = p_unidade for update;
  if v_un.id is null or v_un.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if v_un.status <> 'disponivel' then
    return json_build_object('ok', false, 'erro', 'unidade_' || v_un.status);
  end if;
  if p_versao_esperada is not null and p_versao_esperada <> v_un.versao then
    return json_build_object('ok', false, 'erro', 'versao_desatualizada');
  end if;
  select * into v_dev from a1_developments where id = v_un.empreendimento_id;

  -- Cliente: o mínimo para a reserva valer alguma coisa.
  if coalesce(trim(p_cliente->'titular'->>'nome'), '') = '' then
    return json_build_object('ok', false, 'erro', 'titular_sem_nome');
  end if;
  if length(regexp_replace(coalesce(p_cliente->'titular'->>'cpf', ''), '\D', '', 'g')) <> 11 then
    return json_build_object('ok', false, 'erro', 'titular_cpf_invalido');
  end if;

  -- Preço: o do mapa que está valendo. Sem preço não se monta fluxo.
  select i.valor, m.id into v_valor, v_mapa
    from a1_mapas_preco m join a1_mapa_preco_itens i on i.mapa_id = m.id
   where m.empreendimento_id = v_un.empreendimento_id and m.ativo and i.unidade_id = v_un.id;
  if v_valor is null then
    return json_build_object('ok', false, 'erro', 'unidade_sem_preco');
  end if;

  -- Fluxo: cada linha conferida contra o parâmetro do próprio cliente.
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
    -- Para a Venda: recurso próprio vira condição de pagamento (em centavos,
    -- o formato da proposta); financiamento, FGTS e subsídio vão para o crédito.
    if v_par.quem_paga = 'CLIENTE' then
      v_cond := v_cond || jsonb_build_array(jsonb_build_object(
        'tipo', v_par.serie, 'nome', v_par.nome, 'quantidade', v_q,
        'valor', round(v_v * 100)::bigint,
        'vencimento_inicial', nullif(v_l->>'primeiro_vencimento', '')));
    elsif v_par.serie = 'FGTS' then v_cred_fgts := v_cred_fgts + v_v * v_q;
    elsif v_par.serie = 'SUBSIDIO' then v_cred_sub := v_cred_sub + v_v * v_q;
    else v_cred_fin := v_cred_fin + v_v * v_q;
    end if;
  end loop;

  select * into v_cfg from a1_disposicao_config where tenant_id = v_un.tenant_id;
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

  -- De quem é a reserva. Parceiro reserva em nome próprio; gestor pode
  -- indicar o corretor, que tem de ser deste cliente.
  if a1_e_gestor() then
    if p_corretor is not null and not exists (
         select 1 from a1_partners where id = p_corretor and tenant_id = v_un.tenant_id) then
      return json_build_object('ok', false, 'erro', 'corretor_de_outro_cliente');
    end if;
    v_corretor := p_corretor;
    v_imob := p_imobiliaria;
  else
    v_corretor := a1_ator();
    select nullif(extra->>'imobiliaria_id', '')::uuid into v_imob from a1_partners where id = v_corretor;
  end if;
  if v_corretor is not null and v_imob is null then
    select nullif(extra->>'imobiliaria_id', '')::uuid into v_imob from a1_partners where id = v_corretor;
  end if;

  v_expira := case when coalesce(v_cfg.reserva_horas, 48) > 0
                   then now() + make_interval(hours => coalesce(v_cfg.reserva_horas, 48)) end;

  insert into a1_reservas (tenant_id, unidade_id, empreendimento_id, expira_em, corretor_id,
      imobiliaria_id, cliente, fluxo, valor_unidade, valor_fluxo, mapa_preco_id, observacao,
      criado_por, criado_por_nome)
  values (v_un.tenant_id, v_un.id, v_un.empreendimento_id, v_expira, v_corretor, v_imob,
      p_cliente, v_fluxo, v_valor, v_total, v_mapa, nullif(trim(p_observacao), ''),
      a1_ator(), a1_ator_nome())
  returning id, codigo into v_res, v_cod;

  perform a1_unidade_mudar_status(v_un.id, 'reservado', null,
    jsonb_build_object('reserva_id', v_res, 'reserva_codigo', v_cod,
                       'cliente', p_cliente->'titular'->>'nome'));

  -- A venda nasce junto, se o cliente tem a Venda e uma situação inicial.
  if a1_tem_modulo('COMERCIAL') then
    select id into v_sit from a1_co_situacoes
     where tenant_id = v_un.tenant_id and ativo and flag = 'INICIAL' order by ordem limit 1;
    if v_sit is null then
      perform a1_integra_registrar(v_un.tenant_id, 'RESERVA_VENDA', 'DISPOSICAO', v_res,
        'COMERCIAL', null, 'BLOQUEADO', 'a Venda não tem situação inicial configurada', null, '{}'::jsonb);
    else
      v_part := jsonb_build_array(jsonb_build_object('papel', 'TITULAR',
        'nome', p_cliente->'titular'->>'nome', 'documento', p_cliente->'titular'->>'cpf',
        'renda_analisada', p_cliente->'titular'->'renda'));
      if jsonb_typeof(p_cliente->'conjuge') = 'object'
         and coalesce(trim(p_cliente->'conjuge'->>'nome'), '') <> '' then
        v_part := v_part || jsonb_build_array(jsonb_build_object('papel', 'CONJUGE',
          'nome', p_cliente->'conjuge'->>'nome', 'documento', p_cliente->'conjuge'->>'cpf',
          'renda_analisada', p_cliente->'conjuge'->'renda'));
      end if;
      if jsonb_typeof(p_cliente->'associados') = 'array' then
        for v_a in select * from jsonb_array_elements(p_cliente->'associados') loop
          continue when coalesce(trim(v_a->>'nome'), '') = '';
          v_part := v_part || jsonb_build_array(jsonb_build_object('papel', 'ASSOCIADO',
            'nome', v_a->>'nome', 'documento', v_a->>'cpf', 'parentesco', v_a->>'parentesco',
            'renda_analisada', v_a->'renda'));
        end loop;
      end if;

      insert into a1_comerciais (tenant_id, empreendimento_id, unidade, unidade_id, reserva_id,
          corretor_id, imobiliaria_id, situacao_id, proposta, origem_snapshot, criado_por)
      values (v_un.tenant_id, v_un.empreendimento_id, v_un.codigo, v_un.id, v_res,
          v_corretor, v_imob, v_sit,
          jsonb_build_object('valor_venda', round(v_valor * 100)::bigint,
            'valor_entrada', round((v_total - v_cred_fin - v_cred_fgts - v_cred_sub) * 100)::bigint,
            'condicoes_pagamento', v_cond, 'origem', 'RESERVA'),
          jsonb_build_object('capturado_em', now(), 'origem', 'RESERVA',
            'reserva', jsonb_build_object('id', v_res, 'codigo', v_cod),
            'unidade', jsonb_build_object('id', v_un.id, 'codigo', v_un.codigo,
              'empreendimento', v_dev.name, 'valor', v_valor),
            'credito', jsonb_build_object('valor_aprovado', round(v_cred_fin * 100)::bigint,
              'valor_fgts', round(v_cred_fgts * 100)::bigint,
              'valor_subsidio', round(v_cred_sub * 100)::bigint,
              'valor_total', round((v_cred_fin + v_cred_fgts + v_cred_sub) * 100)::bigint),
            'participantes', v_part,
            'fluxo', v_fluxo),
          a1_ator())
      returning id into v_co;

      update a1_reservas set comercial_id = v_co where id = v_res;
      insert into a1_co_eventos (tenant_id, comercial_id, evento, para_situacao, ator_id, detalhe)
      values (v_un.tenant_id, v_co, 'criado_da_reserva', v_sit, a1_ator(),
              jsonb_build_object('reserva_id', v_res, 'unidade', v_un.codigo));
      perform a1_integra_registrar(v_un.tenant_id, 'RESERVA_VENDA', 'DISPOSICAO', v_res,
        'COMERCIAL', v_co, 'OK', null, 'reserva:' || v_res::text, '{}'::jsonb);
    end if;
  end if;

  return json_build_object('ok', true, 'reserva_id', v_res, 'codigo', v_cod,
                           'comercial_id', v_co, 'expira_em', v_expira);
end $$;
grant execute on function a1_unidade_reservar(uuid, jsonb, jsonb, int, uuid, uuid, text) to anon, authenticated;

-- ─── Cancelar a reserva ──────────────────────────────────────────────────────
create or replace function a1_reserva_cancelar(p_reserva uuid, p_motivo text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_r a1_reservas%rowtype; v_cfg a1_disposicao_config%rowtype;
begin
  perform set_config('a1.orquestrador', '1', true);
  if not a1_tem_modulo('DISPOSICAO') then raise exception 'modulo_desabilitado'; end if;
  select * into v_r from a1_reservas where id = p_reserva;
  if v_r.id is null or v_r.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  select * into v_cfg from a1_disposicao_config where tenant_id = v_r.tenant_id;
  if not (a1_e_gestor() or a1_perm('disp_gerir')
          or (v_r.corretor_id is not null and v_r.corretor_id = a1_ator()
              and a1_perm('disp_reservar') and coalesce(v_cfg.corretor_cancela_propria, true))) then
    raise exception 'sem_permissao';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    return json_build_object('ok', false, 'erro', 'motivo_obrigatorio');
  end if;

  perform pg_advisory_xact_lock(hashtext('un:' || v_r.unidade_id::text));
  select * into v_r from a1_reservas where id = p_reserva for update;
  if v_r.status <> 'ATIVA' then
    return json_build_object('ok', false, 'erro', 'reserva_' || lower(v_r.status));
  end if;

  update a1_reservas set status = 'CANCELADA', motivo = trim(p_motivo), atualizado_em = now()
   where id = p_reserva;
  if exists (select 1 from a1_unidades where id = v_r.unidade_id and status = 'reservado') then
    perform a1_unidade_mudar_status(v_r.unidade_id, 'disponivel', 'reserva cancelada',
      jsonb_build_object('reserva_id', v_r.id, 'reserva_codigo', v_r.codigo, 'motivo', trim(p_motivo)));
  end if;
  if v_r.comercial_id is not null then
    perform a1_integra_registrar(v_r.tenant_id, 'RESERVA_CANCELADA', 'DISPOSICAO', v_r.id,
      'COMERCIAL', v_r.comercial_id, 'OK',
      'reserva cancelada; a venda continua aberta e sem unidade garantida', null, '{}'::jsonb);
  end if;
  return json_build_object('ok', true);
end $$;
grant execute on function a1_reserva_cancelar(uuid, text) to anon, authenticated;

-- ─── Prorrogar ───────────────────────────────────────────────────────────────
create or replace function a1_reserva_prorrogar(p_reserva uuid, p_horas int)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_r a1_reservas%rowtype;
begin
  if not a1_disp_pode('disp_gerir') then raise exception 'sem_permissao'; end if;
  if p_horas is null or p_horas < 1 or p_horas > 8760 then
    return json_build_object('ok', false, 'erro', 'horas_invalidas');
  end if;
  select * into v_r from a1_reservas where id = p_reserva for update;
  if v_r.id is null or v_r.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if v_r.status <> 'ATIVA' then
    return json_build_object('ok', false, 'erro', 'reserva_' || lower(v_r.status));
  end if;
  update a1_reservas
     set expira_em = greatest(coalesce(expira_em, now()), now()) + make_interval(hours => p_horas),
         atualizado_em = now()
   where id = p_reserva
   returning * into v_r;
  insert into a1_unidade_eventos (tenant_id, unidade_id, empreendimento_id, evento, detalhe, ator_id, ator_nome)
  values (v_r.tenant_id, v_r.unidade_id, v_r.empreendimento_id, 'RESERVA_PRORROGADA',
          jsonb_build_object('reserva_id', v_r.id, 'reserva_codigo', v_r.codigo,
                             'horas', p_horas, 'expira_em', v_r.expira_em),
          a1_ator(), a1_ator_nome());
  return json_build_object('ok', true, 'expira_em', v_r.expira_em);
end $$;
grant execute on function a1_reserva_prorrogar(uuid, int) to anon, authenticated;

-- ─── Situação pela mão do gestor ─────────────────────────────────────────────
-- Bloquear e desbloquear; vender direto (cliente sem o módulo de Venda, ou
-- venda feita fora); distrato. Reserva só pela função de reservar.
drop function if exists a1_unidade_definir_status(uuid, text, text, int);
create or replace function a1_unidade_definir_status(p_unidade uuid, p_status text,
  p_motivo text default null, p_versao_esperada int default null,
  p_bloqueado_ate timestamptz default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_un a1_unidades%rowtype; v_r a1_reservas%rowtype;
begin
  perform set_config('a1.orquestrador', '1', true);
  if not a1_disp_pode('disp_gerir') then raise exception 'sem_permissao'; end if;
  perform pg_advisory_xact_lock(hashtext('un:' || p_unidade::text));
  perform a1_disposicao_expirar(a1_tenant());
  select * into v_un from a1_unidades where id = p_unidade for update;
  if v_un.id is null or v_un.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if p_versao_esperada is not null and p_versao_esperada <> v_un.versao then
    return json_build_object('ok', false, 'erro', 'versao_desatualizada');
  end if;

  if not ((v_un.status = 'disponivel' and p_status in ('bloqueado','vendido'))
       or (v_un.status = 'bloqueado'  and p_status = 'disponivel')
       or (v_un.status = 'reservado'  and p_status = 'vendido')
       or (v_un.status = 'vendido'    and p_status = 'disponivel')) then
    return json_build_object('ok', false, 'erro', 'mudanca_nao_permitida',
                             'de', v_un.status, 'para', p_status);
  end if;
  -- Bloqueio e distrato precisam dizer por quê: é a primeira pergunta de quem
  -- abre o rastro depois.
  if (p_status = 'bloqueado' or (v_un.status = 'vendido' and p_status = 'disponivel'))
     and coalesce(trim(p_motivo), '') = '' then
    return json_build_object('ok', false, 'erro', 'motivo_obrigatorio');
  end if;

  if v_un.status = 'reservado' and p_status = 'vendido' then
    select * into v_r from a1_reservas where unidade_id = p_unidade and status = 'ATIVA' for update;
    if v_r.id is not null then
      update a1_reservas set status = 'CONVERTIDA', atualizado_em = now() where id = v_r.id;
    end if;
  end if;

  update a1_unidades set bloqueado_ate = case when p_status = 'bloqueado' then p_bloqueado_ate end
   where id = p_unidade;
  perform a1_unidade_mudar_status(p_unidade, p_status, nullif(trim(p_motivo), ''),
    jsonb_build_object('origem', 'gestor', 'bloqueado_ate', p_bloqueado_ate,
      'distrato', (v_un.status = 'vendido' and p_status = 'disponivel'),
      'reserva_id', v_r.id));
  return json_build_object('ok', true);
end $$;
grant execute on function a1_unidade_definir_status(uuid, text, text, int, timestamptz) to anon, authenticated;

-- ─── A Venda decide o fim ────────────────────────────────────────────────────
-- Venda que nasceu de reserva: chegando a uma situação com selo VENDIDO, a
-- unidade fica vendida e a reserva convertida; chegando a FIM_NEGATIVO, a
-- unidade volta a ficar disponível. Venda sem unidade_id (todas as que já
-- existiam) não é tocada.
create or replace function a1_co_unidade_acompanha()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_selo text; v_status text;
begin
  if new.unidade_id is null or new.situacao_id is not distinct from old.situacao_id then
    return new;
  end if;
  select selo into v_selo from a1_co_situacoes where id = new.situacao_id;
  select status into v_status from a1_unidades where id = new.unidade_id;
  if v_selo = 'VENDIDO' and v_status in ('reservado', 'disponivel') then
    update a1_reservas set status = 'CONVERTIDA', atualizado_em = now()
     where id = new.reserva_id and status = 'ATIVA';
    perform a1_unidade_mudar_status(new.unidade_id, 'vendido', null,
      jsonb_build_object('origem', 'venda', 'comercial_id', new.id, 'reserva_id', new.reserva_id));
  elsif v_selo = 'FIM_NEGATIVO' and v_status = 'reservado' then
    update a1_reservas set status = 'CANCELADA', motivo = 'venda encerrada sem sucesso',
           atualizado_em = now()
     where id = new.reserva_id and status = 'ATIVA';
    perform a1_unidade_mudar_status(new.unidade_id, 'disponivel', 'venda encerrada sem sucesso',
      jsonb_build_object('origem', 'venda', 'comercial_id', new.id, 'reserva_id', new.reserva_id));
  end if;
  return new;
end $$;

drop trigger if exists trg_co_unidade_acompanha on a1_comerciais;
create trigger trg_co_unidade_acompanha after update of situacao_id on a1_comerciais
  for each row execute function a1_co_unidade_acompanha();

-- =============================================================================
-- AUTORIZAÇÃO
-- =============================================================================
alter table a1_unidades             enable row level security;
alter table a1_unidade_eventos      enable row level security;
alter table a1_parametros_pagamento enable row level security;
alter table a1_disposicao_config    enable row level security;
alter table a1_mapas_preco          enable row level security;
alter table a1_mapa_preco_itens     enable row level security;
alter table a1_reservas             enable row level security;

do $$
declare t text; p record;
begin
  foreach t in array array['a1_unidades','a1_unidade_eventos','a1_parametros_pagamento',
                           'a1_disposicao_config','a1_mapas_preco','a1_mapa_preco_itens','a1_reservas']
  loop
    for p in select policyname from pg_policies where tablename = t and schemaname = 'public' loop
      execute format('drop policy if exists %I on %I', p.policyname, t);
    end loop;
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;
end $$;

-- Unidade: quem vê a disposição vê a ficha e a situação. Escreve quem configura.
create policy a1_unidades_ler on a1_unidades for select
  using (tenant_id = a1_tenant() and a1_disp_pode('disp_ver'));
create policy a1_unidades_criar on a1_unidades for insert
  with check (tenant_id = a1_tenant() and a1_disp_pode('disp_configurar'));
create policy a1_unidades_editar on a1_unidades for update
  using (tenant_id = a1_tenant() and a1_disp_pode('disp_configurar'))
  with check (tenant_id = a1_tenant());
-- Ficha que já foi reservada ou vendida tem história: não se apaga, bloqueia-se.
create policy a1_unidades_excluir on a1_unidades for delete
  using (tenant_id = a1_tenant() and a1_disp_pode('disp_configurar') and status in ('disponivel','bloqueado'));
grant insert, update, delete on a1_unidades to anon, authenticated;

create policy a1_unidade_eventos_ler on a1_unidade_eventos for select
  using (tenant_id = a1_tenant() and a1_disp_pode('disp_ver'));

-- Parâmetros e mapa de preço: quem reserva precisa LER para montar o fluxo.
create policy a1_parametros_pagamento_ler on a1_parametros_pagamento for select
  using (tenant_id = a1_tenant() and a1_disp_pode('disp_ver'));
create policy a1_parametros_pagamento_escrever on a1_parametros_pagamento for all
  using (tenant_id = a1_tenant() and a1_disp_pode('disp_configurar'))
  with check (tenant_id = a1_tenant() and a1_disp_pode('disp_configurar'));
grant insert, update, delete on a1_parametros_pagamento to anon, authenticated;

create policy a1_disposicao_config_ler on a1_disposicao_config for select
  using (tenant_id = a1_tenant() and a1_disp_pode('disp_ver'));
create policy a1_disposicao_config_escrever on a1_disposicao_config for all
  using (tenant_id = a1_tenant() and a1_disp_pode('disp_configurar'))
  with check (tenant_id = a1_tenant() and a1_disp_pode('disp_configurar'));
grant insert, update, delete on a1_disposicao_config to anon, authenticated;

create policy a1_mapas_preco_ler on a1_mapas_preco for select
  using (tenant_id = a1_tenant() and a1_disp_pode('disp_ver'));
create policy a1_mapas_preco_escrever on a1_mapas_preco for all
  using (tenant_id = a1_tenant() and a1_disp_pode('disp_configurar'))
  with check (tenant_id = a1_tenant() and a1_disp_pode('disp_configurar'));
grant insert, update, delete on a1_mapas_preco to anon, authenticated;

create policy a1_mapa_preco_itens_ler on a1_mapa_preco_itens for select
  using (tenant_id = a1_tenant() and a1_disp_pode('disp_ver'));
create policy a1_mapa_preco_itens_escrever on a1_mapa_preco_itens for all
  using (tenant_id = a1_tenant() and a1_disp_pode('disp_configurar'))
  with check (tenant_id = a1_tenant() and a1_disp_pode('disp_configurar'));
grant insert, update, delete on a1_mapa_preco_itens to anon, authenticated;

-- Reserva carrega CPF, renda e telefone do cliente. O corretor vê as SUAS; a
-- disposição mostra a todos que a unidade está reservada, não por quem.
-- Nenhuma escrita direta: reserva nasce, cancela e prorroga só por função.
create policy a1_reservas_ler on a1_reservas for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('DISPOSICAO')
         and (a1_e_gestor() or a1_perm('disp_ver_reservas') or a1_perm('disp_gerir')
              or (corretor_id is not null and corretor_id = a1_ator())));

-- Funções de gatilho não são chamadas por ninguém: o gatilho dispara com o dono
-- da função. Tirar o EXECUTE da chave pública só fecha a porta da RPC.
revoke execute on function a1_co_unidade_acompanha() from public, anon, authenticated;
revoke execute on function a1_unidades_rastro() from public, anon, authenticated;
revoke execute on function a1_unidades_sincroniza_lista() from public, anon, authenticated;
revoke execute on function a1_mapa_preco_itens_rastro() from public, anon, authenticated;

-- =============================================================================
-- COMO CONFERIR QUE NINGUÉM FOI AFETADO
--
--   -- o módulo existe e não está liberado para cliente nenhum (tem de dar 0):
--   select count(*) from a1_tenant_modules where module_key = 'DISPOSICAO';
--
--   -- as tabelas novas estão vazias:
--   select (select count(*) from a1_unidades) un, (select count(*) from a1_reservas) rs;
--
--   -- nenhuma venda tem unidade_id (tem de dar 0):
--   select count(*) from a1_comerciais where unidade_id is not null;
--
-- PARA LIGAR: superadmin → cliente → Módulos → Disposição de unidades. Depois,
-- em Configurações aparecem Unidades, Mapa de preço e Parâmetros de pagamento.
-- =============================================================================
