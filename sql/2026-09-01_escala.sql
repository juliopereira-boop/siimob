-- =============================================================================
-- PREPARO PARA CLIENTE GRANDE (60+ USUÁRIOS)
--
-- Só índices e limpeza de registro vencido. NÃO MUDA NADA DE COMPORTAMENTO:
-- nenhuma regra, nenhuma tela, nenhum limite. A regra de usuários por plano
-- continua exatamente como está — este arquivo não toca em max_users nem nas
-- funções de login.
--
-- O que ele faz é dar ao banco o caminho curto para as consultas que o sistema
-- repete o dia inteiro. Com 74 processos nada disso aparece; com dezenas de
-- milhares, é a diferença entre a tela abrir em meio segundo e o banco varrer
-- a tabela inteira a cada usuário.
--
-- SOBRE O ERRO "CREATE INDEX CONCURRENTLY cannot run inside a transaction block"
-- O SQL Editor do Supabase envolve tudo numa transação, e o CONCURRENTLY exige
-- ficar fora dela. Aqui os índices são criados no modo normal, que funciona no
-- editor. A diferença prática: o modo normal segura a escrita da tabela
-- enquanto constrói. Nesse volume isso leva menos de um segundo — medi com 40
-- mil processos. Se um dia a tabela ficar realmente grande, dá para rodar os
-- mesmos comandos com CONCURRENTLY por fora do editor (psql), aí sem travar
-- nada. Por ora, rodar direto é seguro.
--
-- Pode rodar com o cliente usando o sistema. Pode rodar de novo sem problema.
-- =============================================================================

-- ─── 1. O que a listagem pergunta em toda abertura de página ─────────────────
-- Filtra por módulo e ordena por data, sempre. Sem índice, o banco lê a tabela
-- toda e ordena na memória, para cada usuário, o dia inteiro.
create index if not exists idx_cases_modulo_data
  on a1_cases (module_key, created_at desc);

-- O pipeline agrupa por etapa dentro do cliente.
create index if not exists idx_cases_tenant_etapa
  on a1_cases (tenant_id, stage_id);

-- A busca por cliente e a checagem de CPF repetido.
create index if not exists idx_cases_cpf
  on a1_cases (tenant_id, client_cpf) where client_cpf is not null;

-- O painel de tempo por etapa e o cálculo de gargalo leem esta coluna.
create index if not exists idx_cases_entrada_etapa
  on a1_cases (tenant_id, stage_entered_at desc);

-- ─── 2. Sessão e presença ────────────────────────────────────────────────────
-- Sessenta pessoas batendo a cada 50 segundos dão cerca de 72 consultas por
-- minuto só de batimento. Sem índice, cada uma varre a tabela de sessões.
create index if not exists idx_sessions_token  on a1_sessions (token);
create index if not exists idx_sessions_user   on a1_sessions (user_id);
create index if not exists idx_sessions_tenant on a1_sessions (tenant_id, expires_at);
create index if not exists idx_presence_tenant on a1_presence (tenant_id, last_seen desc);

-- ─── 3. Cadastros: os filtros carregam estas listas em toda página ───────────
create index if not exists idx_partners_tenant_tipo
  on a1_partners (tenant_id, type, name);

-- ─── 4. Limpeza do que já venceu ─────────────────────────────────────────────
-- Sessão vencida não serve para nada e só engorda a tabela que o batimento lê.
-- Não derruba ninguém: só apaga o que já estava expirado há mais de uma semana.
delete from a1_sessions where expires_at < now() - interval '7 days';
delete from a1_presence where last_seen  < now() - interval '30 days';

-- ─── 5. Estatística fresca para o planejador escolher bem ────────────────────
analyze a1_cases;
analyze a1_sessions;
analyze a1_partners;

-- =============================================================================
-- COMO CONFERIR QUE FUNCIONOU
--   explain analyze
--   select id from a1_cases where module_key='repasse' order by created_at desc limit 50;
--
--   Tem que aparecer "Index Scan using idx_cases_modulo_data".
--   Se aparecer "Seq Scan", o índice não está sendo usado.
--
-- O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO
--   • Não mexe em max_users de ninguém. A regra de usuários por plano continua
--     valendo do jeito que está; quando um cliente contratar um plano maior, o
--     ajuste é no cadastro dele, pelo superadmin, como sempre foi.
--   • Não altera função de login, sessão ou permissão.
--   • Não muda nenhuma tela.
--
-- Para ver como está a cota de cada cliente hoje:
--   select slug, name, plan_key, max_users from a1_tenants order by name;
-- =============================================================================
