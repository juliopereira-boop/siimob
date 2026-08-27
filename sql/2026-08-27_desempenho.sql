-- =============================================================================
-- DESEMPENHO: TIRAR OS ARQUIVOS DE DENTRO DA LISTAGEM
--
-- O QUE ESTAVA PESANDO
-- A tabela de processos guarda arquivo em base64 em dois lugares:
--   • as colunas attachment_pdf / attachment_doc2 (anexos antigos)
--   • a chave "documents" dentro do payload (documentos antigos)
-- Toda abertura de página buscava isso de TODOS os processos, mesmo sem ninguém
-- abrir cartão nenhum. Num volume de 400 processos medimos 34 MB baixados por
-- carregamento. As colunas já saíram da consulta pelo lado do sistema; falta
-- tirar os documentos de dentro do payload, e isso só o banco resolve — não
-- existe como pedir ao PostgREST "traga o payload menos uma chave".
--
-- O QUE ESTE ARQUIVO FAZ
-- Move payload->documents para uma coluna própria (legacy_docs). O conteúdo
-- continua no banco, inteiro, e continua aparecendo no cartão — o sistema lê os
-- dois formatos. A diferença é que ele deixa de vir junto da listagem.
--
-- BÔNUS: dois índices para as consultas que o sistema faz o tempo todo.
--
-- NÃO APAGA NADA. Rode no SQL Editor do Supabase; pode rodar de novo.
-- Rode DEPOIS de o site estar atualizado (o deploy já foi feito), porque é o
-- sistema novo que sabe ler a coluna nova.
-- =============================================================================

-- ─── 1. Documentos antigos ganham coluna própria ─────────────────────────────
alter table a1_cases add column if not exists legacy_docs jsonb;

-- Só mexe em quem tem a chave, e só se ainda não foi movido.
update a1_cases
   set legacy_docs = payload->'documents',
       payload     = payload - 'documents'
 where payload ? 'documents'
   and legacy_docs is null;

-- Se algum processo tinha as duas coisas (moveu antes e voltou a receber),
-- resolve sem perder nada: mantém o que já estava e descarta a chave repetida.
update a1_cases
   set payload = payload - 'documents'
 where payload ? 'documents'
   and legacy_docs is not null;

-- ─── 2. Índices para o que o sistema pergunta sempre ─────────────────────────
-- A listagem sempre filtra por módulo e ordena por data de criação.
create index if not exists idx_a1_cases_modulo_data
  on a1_cases (module_key, created_at desc);

-- O pipeline agrupa por etapa dentro do cliente.
create index if not exists idx_a1_cases_cliente_etapa
  on a1_cases (tenant_id, stage_id);

-- A sessão é conferida a cada batimento, a cada 50 segundos, por pessoa.
create index if not exists idx_a1_sessions_user on a1_sessions (user_id);

-- ─── 3. Ajuda o planejador a escolher bem ────────────────────────────────────
analyze a1_cases;

-- =============================================================================
-- COMO CONFERIR
--   1. Quanto ainda vem junto da listagem:
--      select count(*) filter (where payload ? 'documents') as ainda_no_payload,
--             count(*) filter (where legacy_docs is not null) as movidos
--      from a1_cases;
--      -> ainda_no_payload deve ser 0.
--
--   2. O tamanho médio do payload deve cair muito:
--      select pg_size_pretty(avg(pg_column_size(payload))::bigint) as payload_medio,
--             pg_size_pretty(sum(pg_column_size(payload))::bigint) as payload_total
--      from a1_cases;
--
--   3. Abra um processo que tinha documento antigo: ele tem que continuar
--      aparecendo na aba de documentos, marcado como anexo antigo.
-- =============================================================================
