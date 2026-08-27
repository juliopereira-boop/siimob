-- =============================================================================
-- AUDITORIA DE SEGURANÇA — SOMENTE LEITURA
--
-- Nada aqui altera coisa alguma: são sete consultas que fotografam como o
-- banco está hoje. Pode rodar com o cliente usando o sistema, a qualquer hora.
--
-- Rode no SQL Editor do Supabase e me mande o resultado de cada bloco.
-- O que estiver na coluna "veredito" como ATENÇÃO ou GRAVE merece conversa.
-- =============================================================================

-- ─── 1. Tabela sem proteção por linha ────────────────────────────────────────
-- Sem RLS, qualquer pessoa com a chave pública (que está no código do site,
-- por natureza) lê a tabela inteira — de todos os clientes.
select
  c.relname                                   as tabela,
  case when c.relrowsecurity then 'ligada' else 'DESLIGADA' end as rls,
  case when c.relrowsecurity then 'ok' else 'GRAVE' end          as veredito
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;

-- ─── 2. RLS ligada mas sem nenhuma regra ─────────────────────────────────────
-- Pior dos dois mundos: parece protegida e na prática bloqueia tudo (ou o
-- dono passa por cima). Costuma ser tabela esquecida numa migração.
select c.relname as tabela, 'RLS ligada, zero políticas' as situacao, 'ATENÇÃO' as veredito
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
order by 1;

-- ─── 3. Regras que liberam geral ─────────────────────────────────────────────
-- "using (true)" está certo para a lista do IBGE (a1_estados, a1_municipios) e
-- errado para qualquer tabela que guarde dado de cliente.
select
  tablename  as tabela,
  policyname as politica,
  cmd        as operacao,
  coalesce(qual, '-')       as condicao_leitura,
  coalesce(with_check, '-') as condicao_escrita,
  case
    when tablename in ('a1_estados','a1_municipios') then 'esperado'
    when coalesce(qual,'') in ('true','') and cmd in ('SELECT','ALL') then 'ATENÇÃO'
    else 'conferir'
  end as veredito
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true' or qual is null)
order by veredito desc, tablename;

-- ─── 4. Tabelas que o papel anônimo pode escrever ────────────────────────────
-- O papel "anon" é o visitante sem login. Ele precisa de INSERT em a1_leads
-- (formulário do site) e de leitura na lista do IBGE. Fora isso, escrita para
-- anon só é aceitável quando existe política de RLS amarrando por cliente.
select
  table_name as tabela,
  string_agg(distinct privilege_type, ', ' order by privilege_type) as permissoes,
  case
    when table_name = 'a1_leads' then 'esperado (formulário público)'
    when table_name in ('a1_estados','a1_municipios') then 'conferir: deveria ser só SELECT'
    else 'conferir se a RLS amarra por cliente'
  end as veredito
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
  and privilege_type in ('INSERT','UPDATE','DELETE')
group by table_name
order by table_name;

-- ─── 5. Funções com privilégio do dono e caminho de busca solto ──────────────
-- SECURITY DEFINER roda com o poder do dono do banco. Sem search_path fixo,
-- ela pode ser enganada a chamar uma função plantada por outro. É o alerta
-- que o próprio Supabase levanta (function_search_path_mutable).
select
  p.proname as funcao,
  case when p.prosecdef then 'dono' else 'chamador' end as roda_como,
  coalesce(array_to_string(p.proconfig, ', '), '(nenhum)') as configuracao,
  case
    when p.prosecdef and (p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%'))
      then 'ATENÇÃO'
    else 'ok'
  end as veredito
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by veredito desc, p.proname;

-- ─── 6. Como as senhas estão guardadas hoje ──────────────────────────────────
-- 64 caracteres hexadecimais = SHA-256 sem sal: dá para quebrar com tabela
-- pronta. Começando com $2 = bcrypt com sal, que é o alvo.
select 'a1_users' as tabela,
       count(*) filter (where password_hash ~ '^[0-9a-f]{64}$') as sha256_sem_sal,
       count(*) filter (where password_hash like '$2%')         as bcrypt,
       count(*) filter (where password_hash is null)            as sem_senha,
       count(*)                                                 as total
from a1_users
union all
select 'a1_partners',
       count(*) filter (where password_hash ~ '^[0-9a-f]{64}$'),
       count(*) filter (where password_hash like '$2%'),
       count(*) filter (where password_hash is null),
       count(*)
from a1_partners;

-- ─── 7. Um cliente enxergando outro ──────────────────────────────────────────
-- Se algum destes vier maior que zero, existe registro órfão ou apontando para
-- o cliente errado — a fronteira entre empresas está furada em algum ponto.
select 'processos sem cliente'      as verificacao, count(*) as registros from a1_cases       where tenant_id is null
union all
select 'parceiros sem cliente',           count(*) from a1_partners     where tenant_id is null
union all
select 'usuários sem cliente',            count(*) from a1_users        where tenant_id is null
union all
select 'empreendimentos sem cliente',     count(*) from a1_developments where tenant_id is null
union all
select 'sessões apontando para cliente inexistente',
       count(*) from a1_sessions s where not exists (select 1 from a1_tenants t where t.id = s.tenant_id);

-- =============================================================================
-- COMO LER
--   Bloco 1: qualquer "DESLIGADA" numa tabela a1_* que guarde dado é grave.
--   Bloco 3: liberação geral só se justifica em a1_estados / a1_municipios.
--   Bloco 4: fora a1_leads, escrita para anônimo tem que estar amarrada.
--   Bloco 5: cada "ATENÇÃO" é resolvido pelo arquivo 2026-08-27_senha_bcrypt.sql.
--   Bloco 6: enquanto sha256_sem_sal for maior que zero, a migração de senha
--            ainda não terminou — ela acontece sozinha, conforme cada pessoa entra.
--   Bloco 7: tudo tem que dar zero.
-- =============================================================================
