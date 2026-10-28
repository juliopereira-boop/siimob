-- =============================================================================
-- REAPLICA A LIMPEZA DE DESEMPENHO: DOCUMENTOS ANTIGOS FORA DA LISTAGEM
--
-- POR QUE ESTE ARQUIVO EXISTE
-- A THE CRED reclama que o sistema "sempre é lento" para carregar e cadastrar
-- (14/10). Medido no banco: a lista do quadro (GET a1_cases) leva 586 ms na
-- mediana e consome sozinha ~80% do tempo de banco do dia, e cada abertura de
-- Andamento, Listagem ou Dashboard baixa MAIS DE 40 MB. O motivo é que 40
-- processos da THE CRED ainda guardam documentos em base64 DENTRO do payload,
-- e a listagem traz o payload inteiro. O maior deles tem 6,9 MB sozinho.
--
-- sql/2026-08-27_desempenho.sql já resolvia isso: move payload->documents para
-- a coluna legacy_docs, que o sistema lê (docsAntigos / completarArquivos). Ele
-- rodou em 27/08 e moveu 15 processos. Os 40 restantes foram criados DEPOIS
-- dele, entre 27/08 16h42 e 28/08 19h06, e ninguém rodou de novo. Nenhum código
-- atual grava documentos dentro do payload (hoje vão para a coluna documents),
-- então o problema não volta.
--
-- O QUE ESTE ARQUIVO FAZ
-- Move, dentro da MESMA linha, payload->documents para legacy_docs. É o passo 1
-- do arquivo de 27/08, com duas garantias a mais:
--   • CONFERÊNCIA: antes de mover, guarda a impressão digital (md5) dos
--     documentos de cada processo; depois de mover, compara. Se um único
--     processo divergir, a transação aborta e NADA é alterado.
--   • DATA PRESERVADA: os gatilhos ficam desligados só dentro desta transação
--     (session_replication_role = replica), para o updated_at dos processos
--     não ser carimbado com a data de hoje sem que ninguém os tenha alterado.
--     Os únicos gatilhos de UPDATE da tabela são esse carimbo e a trava de
--     dono de Lead, que não se aplica a processo de repasse.
--
-- O QUE NÃO FAZ
-- NÃO APAGA NADA. Não mexe em processo sem documento no payload, não mexe em
-- quem já foi movido, não muda nenhum outro campo. Pode rodar de novo: a
-- segunda vez não encontra nada para mover.
-- =============================================================================

begin;

set local session_replication_role = replica;

create temp table _antes on commit drop as
  select id, md5((payload->'documents')::text) as impressao
    from a1_cases
   where payload ? 'documents'
     and legacy_docs is null;

update a1_cases c
   set legacy_docs = c.payload->'documents',
       payload     = c.payload - 'documents'
 where c.payload ? 'documents'
   and c.legacy_docs is null;

do $$
declare
  v_movidos    int;
  v_divergem   int;
begin
  select count(*) into v_movidos from _antes;
  select count(*) into v_divergem
    from _antes a
    join a1_cases c on c.id = a.id
   where c.legacy_docs is null
      or md5(c.legacy_docs::text) <> a.impressao
      or c.payload ? 'documents';
  if v_divergem > 0 then
    raise exception 'Conferência falhou em % de % processos. Nada foi alterado.', v_divergem, v_movidos;
  end if;
  raise notice 'Movidos e conferidos: % processos.', v_movidos;
end $$;

commit;

analyze a1_cases;

-- =============================================================================
-- COMO CONFERIR
--   select count(*) filter (where payload ? 'documents') as ainda_no_payload,
--          count(*) filter (where legacy_docs is not null) as movidos,
--          pg_size_pretty(sum(pg_column_size(payload))::bigint) as payload_total
--     from a1_cases;
--   -> ainda_no_payload = 0, movidos = 55, payload_total na casa de centenas de kB
-- =============================================================================
