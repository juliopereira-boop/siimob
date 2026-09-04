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
  permissions jsonb default '{}'::jsonb);

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

create table if not exists a1_sessions (
  token text primary key,
  tenant_id uuid references a1_tenants(id),
  user_id uuid, role text,
  created_at timestamptz default now(),
  expires_at timestamptz);

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
  development text, unit text, broker_name text, real_estate_name text,
  is_new boolean, new_at timestamptz, payload jsonb default '{}'::jsonb,
  documents jsonb default '[]'::jsonb, created_at timestamptz default now());

-- a1_cases é a tabela do Repasse que já existe hoje, com RLS por cliente e
-- acessível ao anon — é assim em produção, e é contra isso que o gatilho
-- CREATE_REPASS precisa ser testado.
alter table a1_cases enable row level security;
drop policy if exists a1_cases_tenant on a1_cases;
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

create policy a1_cases_tenant on a1_cases for all
  using (tenant_id = a1_tenant()) with check (tenant_id = a1_tenant());

-- Entrar na pele de alguém: é assim que o PostgREST chega ao banco — papel anon
-- e o token no cabeçalho. Nenhum teste deste diretório consulta como superusuário.
create or replace function teste_entrar(p_token text)
returns void language plpgsql as $$
begin
  perform set_config('request.headers',
    json_build_object('x-session-token', coalesce(p_token,''))::text, false);
end $$;
