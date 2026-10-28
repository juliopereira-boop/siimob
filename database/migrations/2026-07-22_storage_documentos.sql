-- =============================================================================
-- Separação de armazenamento: arquivos anexados (documentos dos processos) saem
-- do banco de dados (onde viviam como base64 dentro de a1_cases) e passam a
-- morar no Supabase Storage — o armazenamento de objetos, feito para isso.
--
-- Por que: um cliente já teve o sistema lento porque os documentos anexados
-- (PDFs/imagens em base64) inflaram a coluna payload/documents da a1_cases para
-- ~26MB, fazendo toda consulta do quadro arrastar esse peso junto. Documentos
-- não devem ficar dentro de linhas de tabela — devem ficar no Storage.
--
-- IMPORTANTE — este projeto bloqueia ALTER/CREATE POLICY em storage.objects
-- pelo SQL Editor comum (erros "must be owner of table objects" e "permission
-- denied to set role"). Isso é uma restrição normal de alguns projetos Supabase,
-- não falta de permissão de admin sua. A PARTE 1 (bucket) roda por aqui mesmo,
-- pelo SQL Editor. A PARTE 2 (políticas de isolamento) precisa ser feita pela
-- INTERFACE do Storage no painel — instruções logo abaixo.
-- =============================================================================

-- ─── PARTE 1 — rode isto no SQL Editor (funciona normalmente) ────────────────
-- Bucket privado (não público — documentos têm CPF e dados financeiros).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'case-documents', 'case-documents', false,
  15728640, -- 15 MB por arquivo
  array['application/pdf','image/png','image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- =============================================================================
-- PARTE 2 — políticas de isolamento por cliente (fazer pela INTERFACE, não SQL)
-- -----------------------------------------------------------------------------
-- No painel do Supabase:
--   1. Menu lateral → Storage
--   2. Clique no bucket "case-documents" (deve ter sido criado pela Parte 1)
--   3. Aba "Policies" (ou Storage → Policies, dependendo da versão do painel)
--   4. Clique em "New policy" → escolha a opção de personalizar do zero
--      ("Create a policy from scratch" / "For full customization")
--   5. Crie 3 políticas, uma de cada vez, com estes dados:
--
--   POLÍTICA 1
--     Nome: case_documents_select
--     Operação permitida (Allowed operation): SELECT
--     Target roles: anon, authenticated
--     Policy definition (USING expression):
--       bucket_id = 'case-documents' and (storage.foldername(name))[1] = public.a1_tenant()::text
--
--   POLÍTICA 2
--     Nome: case_documents_insert
--     Operação permitida: INSERT
--     Target roles: anon, authenticated
--     Policy definition (WITH CHECK expression):
--       bucket_id = 'case-documents' and (storage.foldername(name))[1] = public.a1_tenant()::text
--
--   POLÍTICA 3
--     Nome: case_documents_delete
--     Operação permitida: DELETE
--     Target roles: anon, authenticated
--     Policy definition (USING expression):
--       bucket_id = 'case-documents' and (storage.foldername(name))[1] = public.a1_tenant()::text
--
-- (RLS já vem habilitada por padrão em storage.objects em todo projeto
-- Supabase — não precisa habilitar nada além de criar essas 3 políticas.)
-- =============================================================================

-- =============================================================================
-- NOTA — verificação após configurar
-- -----------------------------------------------------------------------------
-- Depois da Parte 1 (SQL) e Parte 2 (painel), teste 1x: anexar um documento de
-- teste num processo e clicar em "Abrir". Se der erro de permissão, me avise
-- imediatamente com a mensagem exata — é ajuste rápido na expressão da política.
--
-- Documentos já existentes (base64, antigos) continuam abrindo normalmente —
-- não foram apagados nem precisam ser migrados; só os NOVOS anexos passam a
-- ir para o Storage.
-- =============================================================================
