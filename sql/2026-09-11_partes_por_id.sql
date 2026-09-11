-- =============================================================================
-- AS PARTES DO PROCESSO, POR ID: analista_id, correspondente_id, empresa_id
--
-- POR QUE ESTE ARQUIVO EXISTE
--
-- O sistema tem três papéis que precisam ser IDENTIFICADOS, e hoje cada tabela
-- conhece um pedaço diferente deles:
--
--   a1_pre_analises  tem corretor_id, imobiliaria_id, correspondente_id,
--                    empresa_id — falta analista_id.
--   a1_comerciais    tem corretor_id, imobiliaria_id, empresa_id — faltam
--                    analista_id e correspondente_id.
--   a1_cases         (o Repasse, em produção) não tem NENHUMA delas. O dono do
--                    processo é gravado como TEXTO: partner_name, broker_name,
--                    manager_name.
--
-- Sem a coluna por id não existe atribuição: o Roteamento de Analistas não tem
-- onde escrever a quem entregou o processo, e a fila do analista não tem por
-- onde filtrar. Nome não serve — dois "João Silva" no mesmo cliente já é
-- suficiente para o roteamento entregar o processo à pessoa errada, e trocar o
-- nome no cadastro faria o processo sumir da fila de quem trabalha nele.
--
-- O CONTRATO DE NOMES, combinado com quem está fazendo as telas. Ele vale
-- igual nas três tabelas, e é o que as telas vão gravar:
--
--   empresa_id        = a EMPRESA correspondente (a1_corr_empresas)
--   correspondente_id = o USUÁRIO correspondente (a1_partners, type 'cca')
--   analista_id       = o ANALISTA (a1_partners, type 'analista')
--
-- No Lead estas colunas NÃO existem: o módulo ainda não existe. Quando existir,
-- entra com os mesmos três nomes.
--
-- O QUE ESTE ARQUIVO **NÃO** FAZ — e em a1_cases isto é o que importa
--  · Não altera NENHUMA linha existente. As três colunas nascem nulas nos 330
--    processos de Repasse que estão em produção agora, e continuam nulas até
--    alguém preencher pela tela.
--  · Não migra dado de texto para id. partner_name, broker_name e manager_name
--    continuam existindo e continuam VALENDO: é por eles que o Repasse decide
--    hoje de quem é o processo (a1_case_visivel, em
--    sql/2026-09-09_visibilidade_repasse_1_conferir.sql), e é por eles que as
--    três telas do Repasse montam os cartões. Adivinhar o id a partir do nome
--    é exatamente o erro que estas colunas existem para acabar; quem casar os
--    dois lados é uma pessoa, com a tela na frente, um cliente por vez.
--  · Não remove, não renomeia e não esvazia coluna nenhuma.
--  · Não cria chave estrangeira. Nenhuma das colunas de gente que já existem
--    (corretor_id, imobiliaria_id, empresa_id) tem FK — quem confere que o
--    parceiro é DESTE cliente é o gatilho (a1_pa_guarda_insert, com
--    'corretor_de_outro_cliente'). Acrescentar FK só nas colunas novas deixaria
--    a tabela com duas regras diferentes para a mesma pergunta, e ainda pediria
--    um ACCESS EXCLUSIVE em a1_cases, que está em uso agora.
--  · Não toca em RLS, em permissão, em licença nem em gatilho.
--
-- Rodar isto em produção é seguro e é rápido: em Postgres 11+ acrescentar
-- coluna nula não reescreve a tabela. Os índices são criados em tabelas
-- pequenas (a1_cases tem 330 linhas) e são parciais, então também são baratos.
--
-- Depende de: sql/2026-09-04_pre_analise.sql, sql/2026-09-04_comercial.sql e do
-- schema.sql original (a1_cases). Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ─── Pré-análise ─────────────────────────────────────────────────────────────
-- Só falta o analista: correspondente_id e empresa_id já existem aqui desde
-- sql/2026-09-04_pre_analise.sql.
alter table a1_pre_analises add column if not exists analista_id uuid;

-- ─── Comercial ───────────────────────────────────────────────────────────────
alter table a1_comerciais   add column if not exists analista_id uuid;
alter table a1_comerciais   add column if not exists correspondente_id uuid;

-- ─── Repasse ─────────────────────────────────────────────────────────────────
-- As três, porque a1_cases não conhece gente por id nenhuma. As colunas de
-- texto ficam onde estão: elas é que respondem HOJE, e vão continuar
-- respondendo enquanto houver processo sem o id preenchido.
alter table a1_cases        add column if not exists analista_id uuid;
alter table a1_cases        add column if not exists correspondente_id uuid;
alter table a1_cases        add column if not exists empresa_id uuid;

-- ─── Índices ─────────────────────────────────────────────────────────────────
-- Sempre (tenant_id, coluna): toda consulta do sistema começa filtrando o
-- cliente, e um índice que ignore isso não é usado.
--
-- PARCIAIS, `where ... is not null`, ao contrário dos índices de corretor_id
-- que já existem. O motivo é a distribuição: estas colunas nascem nulas em 100%
-- das linhas e vão sendo preenchidas aos poucos. Um índice cheio guardaria 330
-- entradas nulas para responder "quais são os processos do analista X", que é a
-- única pergunta que ele existe para responder.
create index if not exists idx_pa_analista
  on a1_pre_analises (tenant_id, analista_id) where analista_id is not null;

create index if not exists idx_co_analista
  on a1_comerciais (tenant_id, analista_id) where analista_id is not null;
create index if not exists idx_co_correspondente
  on a1_comerciais (tenant_id, correspondente_id) where correspondente_id is not null;

create index if not exists idx_cases_analista
  on a1_cases (tenant_id, analista_id) where analista_id is not null;
create index if not exists idx_cases_correspondente
  on a1_cases (tenant_id, correspondente_id) where correspondente_id is not null;
create index if not exists idx_cases_empresa
  on a1_cases (tenant_id, empresa_id) where empresa_id is not null;

-- Não há índice para a1_pre_analises.correspondente_id / empresa_id aqui: eles
-- já vêm de sql/2026-09-04_pre_analise.sql (idx_pa_empresa) ou não são filtro
-- de fila em tela nenhuma. Índice que ninguém usa é custo de escrita e mentira
-- de manutenção.

-- =============================================================================
-- COMO CONFERIR, logo depois de rodar
--
-- 1. As colunas estão nas três tabelas, e com o MESMO nome nas três:
--
--      select table_name, column_name
--        from information_schema.columns
--       where column_name in ('analista_id','correspondente_id','empresa_id')
--         and table_name in ('a1_pre_analises','a1_comerciais','a1_cases')
--       order by table_name, column_name;
--
--    Esperado: 9 linhas (3 por tabela).
--
-- 2. NENHUMA linha existente mudou. Em produção, com o Repasse em uso:
--
--      select count(*) as total,
--             count(analista_id)       as com_analista,
--             count(correspondente_id) as com_correspondente,
--             count(empresa_id)        as com_empresa
--        from a1_cases;
--
--    Esperado agora: total = 330 (ou o que houver) e as outras três em ZERO.
--    Qualquer número diferente de zero aqui significa que alguém já gravou
--    pela tela — o que é certo, mas não foi este arquivo.
--
-- 3. E o texto continua lá, que é quem responde hoje:
--
--      select count(*) filter (where coalesce(broker_name,'')  <> '') as com_corretor,
--             count(*) filter (where coalesce(manager_name,'') <> '') as com_gerente,
--             count(*) filter (where coalesce(partner_name,'') <> '') as com_parceiro
--        from a1_cases;
--
-- 4. Os índices:
--
--      select indexname from pg_indexes
--       where indexname in ('idx_pa_analista','idx_co_analista','idx_co_correspondente',
--                           'idx_cases_analista','idx_cases_correspondente','idx_cases_empresa')
--       order by indexname;
-- =============================================================================
