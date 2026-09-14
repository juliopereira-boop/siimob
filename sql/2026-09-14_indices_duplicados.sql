-- ══════════════════════════════════════════════════════════════════════════════
-- Índices duplicados — cinco cópias que ninguém lia e todo INSERT pagava
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Índice não é de graça. Ele acelera a leitura e ONERA toda escrita: cada
-- INSERT, UPDATE e DELETE precisa manter todos eles em dia. Um índice duplicado
-- é o pior dos dois mundos — cobra o preço da escrita e não acelera leitura
-- nenhuma, porque o planejador escolhe um só.
--
-- Estes cinco pares eram idênticos: mesmas colunas, mesma ordem, mesma condição
-- parcial. Nasceram de migrações diferentes que criaram a mesma coisa com nomes
-- diferentes (`idx_a1_cases_*` e `idx_cases_*`). O contador do Postgres não
-- deixa dúvida sobre qual sobrava:
--
--   idx_a1_cases_cliente_etapa        0 leituras   ·  idx_cases_tenant_etapa      391
--   idx_a1_cases_modulo_data          0 leituras   ·  idx_cases_modulo_data        10
--   idx_a1_presence_tenant_lastseen   0 leituras   ·  idx_presence_tenant           0
--   idx_a1_sessions_token             0 leituras   ·  idx_sessions_token      379.532
--   idx_a1_sessions_user              0 leituras   ·  idx_sessions_user            15
--
-- Os 379.532 acessos a idx_sessions_token são o caminho mais quente do sistema:
-- toda requisição resolve o token da sessão antes de qualquer outra coisa. Com
-- 40 mil processos e o volume de escrita que vem junto, manter uma segunda
-- cópia inútil desse índice é custo puro em cada gravação.
--
-- SEGURO: só caem índices com CÓPIA EXATA viva e ZERO leituras. Nenhuma consulta
-- muda de plano — o par sobrevivente é justamente o que o planejador já usava.
begin;

drop index if exists public.idx_a1_cases_cliente_etapa;       -- = idx_cases_tenant_etapa
drop index if exists public.idx_a1_cases_modulo_data;          -- = idx_cases_modulo_data
drop index if exists public.idx_a1_presence_tenant_lastseen;   -- = idx_presence_tenant
drop index if exists public.idx_a1_sessions_token;             -- = idx_sessions_token
drop index if exists public.idx_a1_sessions_user;              -- = idx_sessions_user

commit;

-- ── CONFERÊNCIA ──────────────────────────────────────────────────────────────
-- Acha duplicata exata em qualquer tabela. Tem de devolver ZERO. Se voltar a
-- aparecer alguma, é migração nova criando índice que já existia com outro nome.
--
-- with idx as (
--   select i.indrelid::regclass::text as tabela, i.indexrelid::regclass::text as indice,
--          i.indkey::text as colunas, coalesce(pg_get_expr(i.indpred, i.indrelid),'') as parcial,
--          i.indisunique, i.indisprimary, s.idx_scan
--   from pg_index i
--   join pg_class c on c.oid = i.indrelid
--   join pg_namespace n on n.oid = c.relnamespace
--   left join pg_stat_user_indexes s on s.indexrelid = i.indexrelid
--   where n.nspname = 'public'
-- )
-- select a.tabela, a.indice as sobra, b.indice as coberto_por, a.idx_scan as usos_da_sobra
-- from idx a join idx b
--   on a.tabela=b.tabela and a.indice<b.indice and a.colunas=b.colunas and a.parcial=b.parcial
-- where not a.indisprimary and not a.indisunique
-- order by a.tabela;
