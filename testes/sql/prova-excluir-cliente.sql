-- PROVA: excluir cliente (superadmin) é tudo ou nada.
-- Roda no banco da prova principal, depois da Central e dos conectores: THE CRED
-- (111...) tem usuários, parceiros, leads, conversas, WhatsApp, IA e Meta.
\set ON_ERROR_STOP on
reset role;
create temp table antes_outro as
  select table_name::text t from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id';
create or replace function pg_temp.contar(p_tenant uuid) returns jsonb language plpgsql as $$
declare r record; v jsonb := '{}'; n bigint;
begin
  for r in select c.table_name t from information_schema.columns c
             join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
            where c.table_schema = 'public' and c.column_name = 'tenant_id' loop
    execute format('select count(*) from %I where tenant_id = $1', r.t) into n using p_tenant;
    if n > 0 then v := v || jsonb_build_object(r.t, n); end if;
  end loop;
  return v;
end $$;
create temp table snap as select pg_temp.contar('11111111-1111-1111-1111-111111111111') cred, pg_temp.contar('22222222-2222-2222-2222-222222222222') outro;
do $$ begin
  if (select jsonb_typeof(cred) from snap) is null or (select cred from snap) = '{}'::jsonb then raise exception 'cenário sem dados de THE CRED'; end if;
  if not ((select cred from snap) ? 'a1_atendimentos' and (select cred from snap) ? 'a1_whatsapp_conexoes') then raise exception 'cenário sem Central/WhatsApp: %', (select cred from snap); end if;
end $$;

-- 1. anon não chama
set role anon;
do $$ begin
  begin perform a1_sa_excluir_cliente('11111111-1111-1111-1111-111111111111'); raise exception 'anon executou';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 2. tudo ou nada: uma tabela fora do alcance (aponta para um LEAD, sem
--    cascata) impede a exclusão, e então nada pode ter sido apagado.
create table trava_teste (id int primary key, case_id uuid references a1_cases(id));
insert into trava_teste select 1, id from a1_cases where tenant_id = '11111111-1111-1111-1111-111111111111' limit 1;
grant all on trava_teste to service_role;
set role service_role;
do $$ begin
  begin perform a1_sa_excluir_cliente('11111111-1111-1111-1111-111111111111'); raise exception 'excluiu mesmo travado';
  exception when foreign_key_violation then null; end;
end $$;
reset role;
do $$ begin
  if pg_temp.contar('11111111-1111-1111-1111-111111111111') <> (select cred from snap) then
    raise exception 'falha deixou o cliente pela metade: % vs %', pg_temp.contar('11111111-1111-1111-1111-111111111111'), (select cred from snap); end if;
end $$;
drop table trava_teste;

-- 3. exclusão de verdade
set role service_role;
do $$ declare r json; begin
  r := a1_sa_excluir_cliente('11111111-1111-1111-1111-111111111111');
  if not (r->>'ok')::boolean then raise exception 'não excluiu: %', r; end if;
  if (a1_sa_excluir_cliente('11111111-1111-1111-1111-111111111111')->>'erro') <> 'nao_encontrado' then raise exception 'segunda vez deveria dizer nao_encontrado'; end if;
end $$;
reset role;
do $$ begin
  if pg_temp.contar('11111111-1111-1111-1111-111111111111') <> '{}'::jsonb then
    raise exception 'sobrou dado do cliente excluído: %', pg_temp.contar('11111111-1111-1111-1111-111111111111'); end if;
  if exists (select 1 from a1_tenants where id = '11111111-1111-1111-1111-111111111111') then raise exception 'cliente continua lá'; end if;
  if pg_temp.contar('22222222-2222-2222-2222-222222222222') <> (select outro from snap) then
    raise exception 'outro cliente foi afetado: % vs %', pg_temp.contar('22222222-2222-2222-2222-222222222222'), (select outro from snap); end if;
end $$;
\echo 'PROVA DE EXCLUIR CLIENTE APROVADA'
