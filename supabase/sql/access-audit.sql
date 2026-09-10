-- SIIMOB — Auditoria de acesso (somente leitura)
-- Execute no SQL Editor do Supabase e compartilhe apenas os resultados.
-- Não retorna linhas de clientes, processos, senhas ou tokens.

-- 1. Tabelas públicas expostas e status de RLS
select n.nspname as schema, c.relname as tabela,
       c.relrowsecurity as rls_ativo,
       c.relforcerowsecurity as rls_forcado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname = 'public'
order by c.relname;

-- 2. Policies aplicadas
select schemaname, tablename, policyname, roles, cmd,
       qual as using_expression, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 3. Grants das roles que chegam pela Data API
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

-- 4. Funções SECURITY DEFINER e executores
select n.nspname as schema, p.proname as funcao,
       pg_get_function_identity_arguments(p.oid) as argumentos,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proacl, E'\n'), 'PUBLIC por padrão') as permissoes
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like 'a1_%'
order by p.proname;

-- 5. Funções que podem estar sem search_path fixo
select p.proname as funcao
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and pg_get_functiondef(p.oid) not ilike '%set search_path%'
order by p.proname;
