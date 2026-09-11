-- =============================================================================
-- BASE DE MENTIRA PARA PROVAR O SQL DOS MÓDULOS
--
-- Recria, num Postgres descartável, só o que os arquivos de sql/ precisam
-- encontrar já existindo: os papéis anon/authenticated, as tabelas antigas do
-- sistema e a a1_tenant(). Nada aqui vai para produção — é o andaime que
-- permite rodar as políticas de verdade contra sessões de verdade.
--
-- A a1_tenant() abaixo é a mesma ideia da de produção: lê o cabeçalho
-- x-session-token que o PostgREST publica em request.headers e devolve o
-- cliente da sessão. Nos testes o cabeçalho é simulado com set_config.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema public;

create table if not exists a1_tenants (
  id uuid primary key default gen_random_uuid(),
  name text, slug text, status text default 'active',
  plan text, max_users int, tipo_cliente text,
  created_at timestamptz default now());

create table if not exists a1_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references a1_tenants(id),
  name text, email text, cpf text, role text, is_active boolean default true,
  unique (tenant_id, cpf));

create table if not exists a1_partners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references a1_tenants(id),
  name text, cpf text, type text, empresa_id uuid,
  is_active boolean default true, approved boolean default true,
  -- `extra` faltava aqui e existe em produção (schema.sql). É onde mora o
  -- vínculo do corretor com a imobiliária (extra.imobiliaria_id) e o
  -- coordenador dele. Sem a coluna, qualquer regra que a leia estoura na prova
  -- com "column p.extra does not exist" — e, pior, uma regra que a lesse ERRADO
  -- passaria sem ser exercitada.
  extra jsonb not null default '{}'::jsonb,
  permissions jsonb default '{}'::jsonb);
alter table a1_partners add column if not exists extra jsonb not null default '{}'::jsonb;

-- COMO O LOGIN DE PARCEIRO REALMENTE FUNCIONA, e por que este andaime precisa
-- reproduzir isso: a1_partner_login não guarda o id do parceiro na sessão. Ele
-- cria um "usuário-sombra" em a1_users com o mesmo CPF e guarda o id do sombra.
-- Um teste que gravasse o id do parceiro direto na sessão passaria em cima de
-- uma premissa falsa — foi exatamente o que aconteceu aqui na primeira versão,
-- e escondeu um defeito que teria deixado todo corretor sem enxergar a própria
-- carteira em produção.
create or replace function teste_login_parceiro(p_token text, p_partner uuid)
returns void language plpgsql as $$
declare v_p a1_partners%rowtype; v_uid uuid;
begin
  select * into v_p from a1_partners where id = p_partner;
  select id into v_uid from a1_users where tenant_id = v_p.tenant_id and cpf = v_p.cpf;
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into a1_users (id, tenant_id, name, cpf, role)
    values (v_uid, v_p.tenant_id, v_p.name, v_p.cpf, 'partner');
  end if;
  insert into a1_sessions (token, tenant_id, user_id, role)
  values (p_token, v_p.tenant_id, v_uid, 'partner')
  on conflict (token) do update set user_id = excluded.user_id;
end $$;

-- last_seen, origem e a janela vêm de 2026-08-24_sessao_unica_e_limite.sql, que
-- o andaime não carrega (recria a1_login inteiro, e login não é o que se prova
-- aqui). Sem estas colunas, a1_ativos() nem compila — e o arquivo que a redefine
-- falhava no meio, escondendo tudo que vinha depois dele.
create table if not exists a1_sessions (
  token text primary key,
  tenant_id uuid references a1_tenants(id),
  user_id uuid references a1_users(id),
  role text,
  origem text default 'login',
  created_at timestamptz default now(),
  last_seen timestamptz default now(),
  expires_at timestamptz default now() + interval '12 hours');

create or replace function a1_sessao_janela()
returns interval language sql immutable as $$ select interval '90 seconds' $$;

create or replace function a1_ativos(p_tenant uuid, p_excluir_user uuid default null)
returns int language sql stable security definer as $$
  select count(distinct user_id)::int
  from   a1_sessions
  where  tenant_id = p_tenant
    and  expires_at > now()
    and  last_seen  > now() - a1_sessao_janela()
    and  (p_excluir_user is null or user_id <> p_excluir_user);
$$;

create table if not exists a1_modules (
  key text primary key, name text, description text);

create table if not exists a1_tenant_modules (
  tenant_id uuid references a1_tenants(id),
  module_key text references a1_modules(key),
  unlocked_by text, unlocked_at timestamptz default now(),
  expires_at timestamptz,
  primary key (tenant_id, module_key));

create table if not exists a1_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid, module_key text, name text,
  position int, is_initial boolean default false);

create table if not exists a1_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid, module_key text, stage_id uuid, stage_name text,
  stage_entered_at timestamptz, client_name text, client_cpf text,
  -- `block` existe em produção e faltava aqui. Quem monta o rótulo do cartão
  -- ("Bloco B1 · un. 101") lê as duas colunas; com só uma, a função nem compila.
  development text, block text, unit text, broker_name text, real_estate_name text,
  -- manager_name e partner_name faltavam aqui e existem em produção. É por
  -- esses três nomes que o Repasse sabe de quem é o processo — sem eles, uma
  -- política escrita sobre o dono não podia nem ser carregada, quanto mais
  -- provada.
  manager_name text, partner_name text,
  is_new boolean, new_at timestamptz, payload jsonb default '{}'::jsonb,
  documents jsonb default '[]'::jsonb, created_at timestamptz default now());

-- As filhas de a1_cases e o cadastro de empreendimentos existem em produção
-- desde sempre e faltavam aqui. Sem elas, uma função que precise contar o
-- histórico de etapas de um processo — ou dizer o NOME do empreendimento em
-- vez do uuid — nem compila no andaime, e a prova morre antes de provar.
-- O `on delete` de cada uma é o de produção de propósito: é justamente a
-- diferença entre "o histórico vai junto" e "o e-mail só perde o vínculo".
create table if not exists a1_developments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references a1_tenants(id),
  name text, regional text, estado char(2), cidade text);

create table if not exists a1_stage_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references a1_tenants(id),
  case_id uuid references a1_cases(id) on delete cascade,
  stage_id uuid, stage_name text,
  entered_at timestamptz default now(), exited_at timestamptz);

create table if not exists a1_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references a1_tenants(id),
  case_id uuid references a1_cases(id) on delete cascade,
  type text, description text, actor_name text,
  created_at timestamptz default now());

create table if not exists a1_emails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references a1_tenants(id),
  case_id uuid references a1_cases(id) on delete set null,
  to_email text, subject text, body text,
  status text default 'pending', created_at timestamptz default now());

-- a1_config guarda as configurações do cliente em JSON dentro de uma coluna
-- TEXT — inclusive os tipos de documento, que é de onde sai a regra de
-- documento obrigatório. O andaime não tinha esta tabela, e por isso
-- a1_docs_obrigatorios caía no seu próprio "exception when others" e devolvia
-- lista vazia: a prova passaria com a regra desligada, sem provar nada.
create table if not exists a1_config (
  tenant_id uuid, key text, value text, primary key (tenant_id, key));

-- a1_cases é a tabela do Repasse que já existe hoje, com RLS por cliente e
-- acessível ao anon — é assim em produção, e é contra isso que o gatilho
-- CREATE_REPASS precisa ser testado.
--
-- A política se chama cases_tenant_isolation porque é esse o nome dela em
-- produção. Aqui ela se chamava a1_cases_tenant, e um nome diferente é um
-- andaime que mente: um arquivo que troque a política de produção pelo nome
-- não trocaria a daqui, e a prova ficaria verde com as duas valendo ao mesmo
-- tempo — que é justamente a situação que não pode existir.
alter table a1_cases enable row level security;
drop policy if exists a1_cases_tenant on a1_cases;
drop policy if exists cases_tenant_isolation on a1_cases;
grant select, insert, update on a1_cases to anon, authenticated;

create or replace function a1_tenant()
returns uuid language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select s.tenant_id from a1_sessions s
   where s.token = current_setting('request.headers', true)::json->>'x-session-token'
     and (s.expires_at is null or s.expires_at > now())
   limit 1;
$$;
grant execute on function a1_tenant() to anon, authenticated;

-- Produção tem DUAS funções para a mesma pergunta: a1_has_module (antiga,
-- considera o plano do cliente em a1_plan_modules E a liberação manual) e
-- a1_tem_modulo (nova, só a liberação manual). Não é engano do andaime — são
-- duas mesmo, e regras novas escolhem uma ou outra sem critério. Aqui a antiga
-- delega para a nova: o andaime não modela planos, e para as provas o que
-- importa é se o cliente tem o módulo liberado.
create or replace function a1_has_module(p_module_key text)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from a1_tenant_modules tm
    where tm.tenant_id = a1_tenant() and tm.module_key = p_module_key
      and (tm.expires_at is null or tm.expires_at > now())
  );
$$;
grant execute on function a1_has_module(text) to anon, authenticated;


create policy cases_tenant_isolation on a1_cases for all
  using (tenant_id = a1_tenant()) with check (tenant_id = a1_tenant());

-- As filhas e o cadastro de empreendimentos seguem o mesmo desenho que têm em
-- produção: RLS por cliente e grant completo para anon. Nascer trancado aqui
-- faria qualquer prova de isolamento passar sem nada estar sendo protegido.
do $$
declare t text;
begin
  foreach t in array array['a1_stage_history','a1_events','a1_emails','a1_developments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant_isolation', t);
    execute format('create policy %I on %I for all using (tenant_id = a1_tenant())'
                   || ' with check (tenant_id = a1_tenant())', t || '_tenant_isolation', t);
    execute format('grant select, insert, update, delete on %I to anon, authenticated', t);
  end loop;
end $$;

-- Entrar na pele de alguém: é assim que o PostgREST chega ao banco — papel anon
-- e o token no cabeçalho. Nenhum teste deste diretório consulta como superusuário.
create or replace function teste_entrar(p_token text)
returns void language plpgsql as $$
begin
  perform set_config('request.headers',
    json_build_object('x-session-token', coalesce(p_token,''))::text, false);
end $$;

-- ─── As duas tabelas antigas, com a proteção que produção tem HOJE ───────────
-- a1_sessions e a1_partners existem desde schema.sql, com RLS por cliente e
-- grant completo para anon. É contra ESSA configuração que a trava nova precisa
-- ser provada: se o andaime já nascesse trancado, a prova não provaria nada —
-- passaria mesmo que sql/2026-09-06_travas_sessao_e_parceiro.sql não existisse.
alter table a1_sessions enable row level security;
drop policy if exists sessions_tenant_isolation on a1_sessions;
create policy sessions_tenant_isolation on a1_sessions for all
  using (tenant_id = a1_tenant()) with check (tenant_id = a1_tenant());
grant select, insert, update, delete on a1_sessions to anon, authenticated;

alter table a1_partners enable row level security;
drop policy if exists partners_tenant_isolation on a1_partners;
create policy partners_tenant_isolation on a1_partners for all
  using (tenant_id = a1_tenant()) with check (tenant_id = a1_tenant());
grant select, insert, update, delete on a1_partners to anon, authenticated;
