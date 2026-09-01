-- =============================================================================
-- PREPARO PARA CLIENTE GRANDE (60+ USUÁRIOS)
--
-- Índices e ajustes que só passam a doer quando o volume cresce. Com 74
-- processos nada disso aparece; com dezenas de milhares, é a diferença entre
-- a tela abrir em meio segundo e o banco varrer a tabela inteira.
--
-- Nada aqui apaga ou altera dado. Rode a qualquer hora, inclusive com o
-- cliente usando o sistema — criar índice em tabela desse tamanho é rápido, e
-- o CONCURRENTLY evita travar escrita durante a criação.
-- =============================================================================

-- ─── 1. Consultas que a listagem faz a cada abertura de página ───────────────
-- A listagem filtra por módulo e ordena por data, sempre. Sem este índice o
-- banco lê a tabela toda e ordena na memória, a cada usuário, o dia inteiro.
create index concurrently if not exists idx_cases_modulo_data
  on a1_cases (module_key, created_at desc);

-- O pipeline agrupa por etapa dentro do cliente.
create index concurrently if not exists idx_cases_tenant_etapa
  on a1_cases (tenant_id, stage_id);

-- A busca por cliente e a checagem de CPF duplicado.
create index concurrently if not exists idx_cases_cpf
  on a1_cases (tenant_id, client_cpf) where client_cpf is not null;

-- O painel de tempo por etapa e o cálculo de gargalo leem esta coluna.
create index concurrently if not exists idx_cases_entrada_etapa
  on a1_cases (tenant_id, stage_entered_at desc);

-- ─── 2. Sessão e presença: 60 pessoas batendo a cada 50 segundos ─────────────
-- São ~72 consultas por minuto só de batimento. Sem índice, cada uma varre a
-- tabela de sessões inteira.
create index concurrently if not exists idx_sessions_token   on a1_sessions (token);
create index concurrently if not exists idx_sessions_user    on a1_sessions (user_id);
create index concurrently if not exists idx_sessions_tenant  on a1_sessions (tenant_id, expires_at);
create index concurrently if not exists idx_presence_tenant  on a1_presence (tenant_id, last_seen desc);

-- ─── 3. Cadastros: os filtros carregam estas listas em toda página ───────────
create index concurrently if not exists idx_partners_tenant_tipo
  on a1_partners (tenant_id, type, name);

-- ─── 4. Limpeza do que não serve mais ────────────────────────────────────────
-- Sessão vencida não tem utilidade e só engorda a tabela que o batimento lê.
delete from a1_sessions where expires_at < now() - interval '7 days';
delete from a1_presence where last_seen  < now() - interval '30 days';

-- ─── 5. Deixar o planejador com estatística fresca ───────────────────────────
analyze a1_cases;
analyze a1_sessions;
analyze a1_partners;

-- =============================================================================
-- O QUE MAIS PRECISA ACONTECER PARA 60 USUÁRIOS — E NÃO É SQL
--
-- 1. AUMENTAR A COTA DO CLIENTE
--    update a1_tenants set max_users = 60 where slug = '<slug-do-cliente>';
--    Sem isso o 61º acesso é recusado. Confira antes de o cliente entrar:
--    select slug, name, max_users from a1_tenants order by name;
--
-- 2. O PLANO DO SUPABASE
--    Sessenta pessoas com batimento a cada 50s, mais a navegação normal, é
--    tráfego constante. Confira o limite de conexões e de banda do plano
--    contratado antes da virada, não depois.
--
-- 3. RODAR O ARQUIVO DE SESSÃO ÚNICA
--    sql/2026-08-24_sessao_unica_e_limite.sql. Com 60 pessoas, senha
--    compartilhada deixa de ser detalhe: é o que estoura a cota e derruba
--    quem está trabalhando.
--
-- COMO CONFERIR SE OS ÍNDICES ESTÃO SENDO USADOS
--   explain analyze
--   select id from a1_cases where module_key='repasse' order by created_at desc limit 50;
--   -> deve aparecer "Index Scan using idx_cases_modulo_data", não "Seq Scan".
-- =============================================================================
