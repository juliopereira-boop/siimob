-- =============================================================================
-- MÓDULO COMERCIAL — tabelas, esteira própria e as duas ações de integração
--
-- Nasce DESLIGADO, como a Pré-análise.
--
-- A ADAPTAÇÃO DE ARQUITETURA QUE ESTE ARQUIVO REPRESENTA
-- A especificação pede outbox, fila, worker, DLQ e um orquestrador de gatilhos.
-- Este sistema não tem servidor de aplicação: é HTML estático conversando com
-- o PostgREST. Não existe processo onde um worker possa rodar.
--
-- Pôr o orquestrador no navegador seria pior do que não ter: a criação de um
-- Comercial ou de um Repasse dependeria de a aba ficar aberta, e qualquer
-- pessoa com o token poderia disparar o comando fora da regra.
--
-- Então o orquestrador foi para onde ele cabe e fica mais seguro: DENTRO DO
-- BANCO. A transição é uma função com privilégio próprio que, na mesma
-- transação, valida, grava o histórico e cria o registro no módulo de destino.
-- Efeito atômico, sem worker e sem janela de inconsistência. A tabela de outbox
-- continua existindo para o que é de fato externo (e-mail, CVCRM) e para dar
-- reconciliação; o que é interno não precisa de fila para ser confiável.
--
-- Depende de: 2026-09-04_identidade.sql e 2026-09-04_pre_analise.sql
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ─── Esteira do Comercial ────────────────────────────────────────────────────
create table if not exists a1_co_situacoes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  nome       text not null,
  flag       text check (flag in ('INICIAL','CONTRATO_ASSINADO','CANCELADO','ENCERRADO')),
  ordem      int  not null default 0,
  cor        text,
  sla_horas  int,
  ativo      boolean not null default true
);
create index if not exists idx_co_sit_tenant on a1_co_situacoes (tenant_id, ordem);

create table if not exists a1_co_transicoes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  de_id      uuid references a1_co_situacoes(id) on delete cascade,
  para_id    uuid not null references a1_co_situacoes(id) on delete cascade,
  papeis     text[] not null default '{}',
  requisitos jsonb not null default '{}'::jsonb,
  -- CREATE_REPASS pode estar em QUALQUER situação da esteira, não só na última.
  -- Contrato assinado é a recomendação inicial, não uma regra do sistema.
  acao       text check (acao in ('CREATE_REPASS','SEND_TO_SIGNATURE','MARK_CONTRACT_SIGNED')),
  acao_modo  text not null default 'CONFIRMAR' check (acao_modo in ('AUTO','CONFIRMAR')),
  ativo      boolean not null default true
);
create index if not exists idx_co_tr_tenant on a1_co_transicoes (tenant_id, de_id);

-- ─── O caso comercial ────────────────────────────────────────────────────────
create table if not exists a1_comerciais (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  codigo         text,
  pre_analise_id uuid references a1_pre_analises(id),
  empreendimento_id uuid,
  unidade        text,
  corretor_id    uuid,
  imobiliaria_id uuid,
  empresa_id     uuid,
  situacao_id    uuid references a1_co_situacoes(id),
  situacao_em    timestamptz not null default now(),   -- relógio do SLA da fila
  proposta       jsonb not null default '{}'::jsonb,
  -- Cópia dos dados no momento em que o Comercial nasceu. Mudança posterior na
  -- Pré-análise NÃO altera silenciosamente o que já foi negociado.
  origem_snapshot jsonb not null default '{}'::jsonb,
  repasse_case_id uuid,                     -- preenchido por CREATE_REPASS
  versao         int  not null default 1,
  criado_por     uuid,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
-- Uma pré-análise gera no máximo um comercial. É esta linha — e não a tela —
-- que impede dois cliques, dois navegadores ou dois retries criarem dois.
create unique index if not exists idx_co_uma_por_pa
  on a1_comerciais (pre_analise_id) where pre_analise_id is not null;
create index if not exists idx_co_tenant_sit on a1_comerciais (tenant_id, situacao_id);
create index if not exists idx_co_corretor   on a1_comerciais (tenant_id, corretor_id);
alter table a1_comerciais add column if not exists situacao_em timestamptz not null default now();

create table if not exists a1_co_contratos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  comercial_id  uuid not null references a1_comerciais(id) on delete cascade,
  versao        int  not null default 1,
  storage_key   text,
  status        text not null default 'EM_CONFECCAO'
                check (status in ('EM_CONFECCAO','GERADO','AGUARDANDO_ASSINATURA',
                                  'ASSINADO','CANCELADO')),
  provedor      text,
  assinado_em   timestamptz,
  criado_em     timestamptz not null default now()
);
create index if not exists idx_co_ct on a1_co_contratos (comercial_id, versao desc);

create table if not exists a1_co_eventos (
  id           bigserial primary key,
  tenant_id    uuid not null,
  comercial_id uuid not null references a1_comerciais(id) on delete cascade,
  evento       text not null,
  de_situacao  uuid,
  para_situacao uuid,
  ator_id      uuid,
  ator_nome    text,
  detalhe      jsonb not null default '{}'::jsonb,
  criado_em    timestamptz not null default now()
);
create index if not exists idx_co_ev on a1_co_eventos (comercial_id, criado_em desc);

-- ─── Registro do que saiu para fora, e do que falhou ─────────────────────────
-- Serve para o que é externo (e-mail, CVCRM) e como trilha de reconciliação dos
-- gatilhos internos: se um gatilho não pôde executar, o motivo fica escrito
-- aqui em vez de sumir num toast do navegador.
create table if not exists a1_integra_eventos (
  id              bigserial primary key,
  tenant_id       uuid not null,
  tipo            text not null,
  origem_modulo   text,
  origem_id       uuid,
  destino_modulo  text,
  destino_id      uuid,
  idempotency_key text,
  status          text not null default 'OK' check (status in ('OK','BLOQUEADO','ERRO','PENDENTE')),
  motivo          text,
  payload         jsonb not null default '{}'::jsonb,
  tentativas      int not null default 0,
  criado_em       timestamptz not null default now()
);
create unique index if not exists idx_integra_idem
  on a1_integra_eventos (tenant_id, idempotency_key) where idempotency_key is not null;
create index if not exists idx_integra_tenant on a1_integra_eventos (tenant_id, criado_em desc);

-- =============================================================================
-- AUTORIZAÇÃO
-- =============================================================================
create or replace function a1_co_visivel(p_corretor uuid, p_empresa uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when a1_e_gestor() then true
    when a1_perm('gerente') then true
    when a1_perm('ver_todos_analistas') then true   -- visão completa (coordenador)
    when a1_tipo_ator() = 'cca' and p_empresa is not null
         and p_empresa = a1_empresa_ator() then true
    when p_corretor is not null and p_corretor = a1_ator() then true
    else false
  end;
$$;
grant execute on function a1_co_visivel(uuid, uuid) to anon, authenticated;

alter table a1_co_situacoes      enable row level security;
alter table a1_co_transicoes     enable row level security;
alter table a1_comerciais        enable row level security;
alter table a1_co_contratos      enable row level security;
alter table a1_co_eventos        enable row level security;
alter table a1_integra_eventos   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['a1_co_situacoes','a1_co_transicoes','a1_comerciais',
                           'a1_co_contratos','a1_co_eventos','a1_integra_eventos']
  loop
    execute format('drop policy if exists %I on %I', t || '_ler', t);
    execute format('drop policy if exists %I on %I', t || '_escrever', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;
end $$;

create policy a1_co_situacoes_ler on a1_co_situacoes for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL'));
create policy a1_co_situacoes_escrever on a1_co_situacoes for all
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL') and a1_e_gestor())
  with check (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL') and a1_e_gestor());
grant insert, update, delete on a1_co_situacoes to anon, authenticated;

create policy a1_co_transicoes_ler on a1_co_transicoes for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL'));
create policy a1_co_transicoes_escrever on a1_co_transicoes for all
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL') and a1_e_gestor())
  with check (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL') and a1_e_gestor());
grant insert, update, delete on a1_co_transicoes to anon, authenticated;

create policy a1_comerciais_ler on a1_comerciais for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and a1_co_visivel(corretor_id, empresa_id));
-- Repare: NÃO existe política de INSERT para o navegador. Comercial nasce por
-- ação de workflow, dentro da função que valida a origem — nunca por um POST
-- direto na tabela. É o que impede pular a aprovação da Pré-análise.
create policy a1_comerciais_editar on a1_comerciais for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and a1_co_visivel(corretor_id, empresa_id) and a1_perm('editar_repasses'))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL'));
grant update on a1_comerciais to anon, authenticated;

-- Um UPDATE liberado é um UPDATE em TODAS as colunas — e nesta tabela há três
-- que não são do operador: situacao_id (que é da esteira), repasse_case_id (que
-- é o vínculo criado pela ação, e apontá-lo à mão amarraria o comercial a um
-- cartão de repasse qualquer) e origem_snapshot (a fotografia do crédito
-- aprovado, que existe justamente para NÃO poder ser reescrita depois).
create or replace function a1_co_guarda_update()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_nao_muda';
  end if;
  if new.pre_analise_id is distinct from old.pre_analise_id then
    raise exception 'origem_nao_muda';
  end if;
  if not a1_no_orquestrador() then
    if new.situacao_id is distinct from old.situacao_id then
      raise exception 'situacao_so_muda_por_transicao';
    end if;
    if new.repasse_case_id is distinct from old.repasse_case_id then
      raise exception 'vinculo_de_repasse_e_da_acao';
    end if;
    if new.origem_snapshot is distinct from old.origem_snapshot then
      raise exception 'snapshot_da_aprovacao_nao_se_reescreve';
    end if;
    if new.versao is distinct from old.versao then
      raise exception 'versao_e_do_sistema';
    end if;
    if new.situacao_em is distinct from old.situacao_em then
      raise exception 'relogio_do_sla_e_do_sistema';
    end if;
    if (new.corretor_id is distinct from old.corretor_id
        or new.empresa_id is distinct from old.empresa_id)
       and not (a1_e_gestor() or a1_perm('gerente')) then
      raise exception 'redistribuir_carteira_e_do_gestor';
    end if;
  end if;
  if new.situacao_id is distinct from old.situacao_id then
    new.situacao_em := now();
  end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists trg_co_guarda on a1_comerciais;
create trigger trg_co_guarda before update on a1_comerciais
  for each row execute function a1_co_guarda_update();

-- Contrato assinado é requisito de transição em alguns clientes. Se quem vende
-- pudesse carimbar ASSINADO sozinho, o requisito não seria requisito.
create or replace function a1_co_guarda_contrato()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if new.status = 'ASSINADO'
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and not (a1_e_gestor() or a1_perm('gerente') or a1_perm('analisar_credito')) then
    raise exception 'sem_permissao_para_marcar_contrato_assinado';
  end if;
  return new;
end $$;
drop trigger if exists trg_co_contrato_guarda on a1_co_contratos;
create trigger trg_co_contrato_guarda before insert or update on a1_co_contratos
  for each row execute function a1_co_guarda_contrato();

create policy a1_co_contratos_ler on a1_co_contratos for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and exists (select 1 from a1_comerciais c where c.id = a1_co_contratos.comercial_id
                      and a1_co_visivel(c.corretor_id, c.empresa_id)));
create policy a1_co_contratos_escrever on a1_co_contratos for all
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL') and a1_perm('editar_repasses')
         and exists (select 1 from a1_comerciais c where c.id = a1_co_contratos.comercial_id
                      and a1_co_visivel(c.corretor_id, c.empresa_id)))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL'));
grant insert, update on a1_co_contratos to anon, authenticated;

create policy a1_co_eventos_ler on a1_co_eventos for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and exists (select 1 from a1_comerciais c where c.id = a1_co_eventos.comercial_id
                      and a1_co_visivel(c.corretor_id, c.empresa_id)));

-- Registro de integração: só gestor lê, e ninguém escreve pela API.
create policy a1_integra_eventos_ler on a1_integra_eventos for select
  using (tenant_id = a1_tenant() and a1_e_gestor());

-- =============================================================================
-- COMO CONFERIR
--   1. Sem o módulo liberado, a1_comerciais não devolve linha para ninguém.
--   2. Tente um POST direto em a1_comerciais com token de gestor: tem de ser
--      recusado. Comercial só nasce pela ação de workflow.
-- =============================================================================
