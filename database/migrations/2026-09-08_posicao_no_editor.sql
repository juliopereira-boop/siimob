-- =============================================================================
-- ONDE CADA SITUAÇÃO FICA NA TELA DO EDITOR DE WORKFLOW
--
-- O editor de workflow do Repasse é um quadro: os nós ficam onde o gestor os
-- arrastou, e a posição é guardada em a1_stages.pos_x / pos_y. As tabelas dos
-- módulos novos nasceram sem essas colunas porque a primeira versão do editor
-- deles era uma tabela, não um quadro.
--
-- Sem estas duas colunas o quadro até desenha — dá para calcular a posição a
-- partir da ordem — mas arrastar não guarda nada. O gestor organiza o desenho,
-- sai da tela, volta e encontra tudo de novo em fila. Melhor não ter arrastar
-- do que ter um arrastar que mente.
--
-- Só acrescenta coluna. Não mexe em política, em gatilho, nem em dado
-- existente, e nenhuma delas decide poder: o gatilho trg_a1_partners_poder e
-- as travas de situação (a1_pa_guarda_update) não são afetados.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

alter table a1_pa_situacoes add column if not exists pos_x int;
alter table a1_pa_situacoes add column if not exists pos_y int;
alter table a1_co_situacoes add column if not exists pos_x int;
alter table a1_co_situacoes add column if not exists pos_y int;

-- =============================================================================
-- COMO CONFERIR
--   select column_name from information_schema.columns
--    where table_name = 'a1_pa_situacoes' and column_name in ('pos_x','pos_y');
--   -- duas linhas
-- =============================================================================
