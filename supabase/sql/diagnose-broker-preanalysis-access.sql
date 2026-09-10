-- SIIMOB | Diagnóstico de acesso: corretor -> pré-análises
-- Somente leitura. Não altera dados, políticas, permissões nem sessões.
-- Execute no SQL Editor do Supabase e envie os resultados.
--
-- Troque apenas o valor abaixo pelo e-mail do corretor afetado.
-- Não envie senha, token de sessão, service_role key ou chave anônima.

-- 1) Localiza o usuário e mostra seus atributos de acesso, sem segredos.
with alvo as (
  select lower('COLOQUE-O-EMAIL-DO-CORRETOR@EXEMPLO.COM') as email
)
select
  to_jsonb(u)
    - 'password'
    - 'senha'
    - 'password_hash'
    - 'senha_hash'
    - 'token'
    - 'session_token' as usuario
from public.a1_users u
cross join alvo a
where lower(coalesce(to_jsonb(u) ->> 'email', '')) = a.email;

-- 2) Lista as colunas que participam da decisão de acesso.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'a1_users',
    'a1_sessions',
    'a1_tenant_modules',
    'a1_pre_analises',
    'a1_comerciais'
  )
order by table_name, ordinal_position;

-- 3) Exibe os módulos liberados para o tenant desse usuário.
-- Deve aparecer o módulo/chave usado pelas pré-análises, se a aplicação
-- condiciona o menu por módulo.
with alvo as (
  select to_jsonb(u) as usuario
  from public.a1_users u
  where lower(coalesce(to_jsonb(u) ->> 'email', '')) =
        lower('COLOQUE-O-EMAIL-DO-CORRETOR@EXEMPLO.COM')
)
select to_jsonb(m) as modulo_do_tenant
from public.a1_tenant_modules m
cross join alvo a
where coalesce(to_jsonb(m) ->> 'tenant_id', '') =
      coalesce(a.usuario ->> 'tenant_id', '');

-- 4) Mostra apenas metadados das sessões do corretor, sem token.
-- Ajuda a detectar uma sessão antiga mantendo role/permissões desatualizadas.
with alvo as (
  select to_jsonb(u) as usuario
  from public.a1_users u
  where lower(coalesce(to_jsonb(u) ->> 'email', '')) =
        lower('COLOQUE-O-EMAIL-DO-CORRETOR@EXEMPLO.COM')
)
select
  to_jsonb(s)
    - 'token'
    - 'session_token'
    - 'secret'
    - 'hash' as sessao
from public.a1_sessions s
cross join alvo a
where coalesce(to_jsonb(s) ->> 'user_id', '') =
      coalesce(a.usuario ->> 'id', '');

-- 5) Políticas RLS e grants que podem bloquear leitura/criação de pré-análises.
select
  tablename,
  policyname,
  roles,
  cmd,
  qual as using_expression,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'a1_pre_analises',
    'a1_users',
    'a1_tenant_modules'
  )
order by tablename, policyname;

select
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'a1_pre_analises',
    'a1_users',
    'a1_tenant_modules'
  )
  and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
order by table_name, grantee, privilege_type;

-- 6) Funções relacionadas que decidem acesso ou inserção de pré-análises.
select
  p.proname as funcao,
  pg_get_function_identity_arguments(p.oid) as argumentos,
  p.prosecdef as security_definer,
  pg_get_functiondef(p.oid) as definicao
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname ilike '%pre%anal%'
    or pg_get_functiondef(p.oid) ilike '%a1_pre_anal%'
  )
order by p.proname;
