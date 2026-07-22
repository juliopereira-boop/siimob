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
-- Isolamento por tenant: a mesma lógica usada em TODAS as tabelas do sistema
-- (função a1_tenant(), que lê o token de sessão do cabeçalho x-session-token)
-- é aplicada aqui às políticas do bucket. Caminho do arquivo sempre começa
-- com o tenant_id: '{tenant_id}/{case_id}/{arquivo}'.
--
-- Rode no SQL Editor do Supabase. Idempotente (pode rodar de novo sem problema).
-- =============================================================================

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

-- storage.objects pertence à role interna "supabase_storage_admin", não à
-- role usada pelo SQL Editor — por isso ALTER/CREATE POLICY nela exigem
-- assumir essa role temporariamente (padrão documentado do Supabase).
set role supabase_storage_admin;

alter table storage.objects enable row level security;

-- Garante que o app (chave anon) possa operar no storage; o isolamento real
-- é feito pelas políticas abaixo, não por este GRANT.
grant select, insert, update, delete on storage.objects to anon, authenticated;

drop policy if exists "case_documents_select" on storage.objects;
create policy "case_documents_select" on storage.objects
for select using (
  bucket_id = 'case-documents'
  and (storage.foldername(name))[1] = a1_tenant()::text
);

drop policy if exists "case_documents_insert" on storage.objects;
create policy "case_documents_insert" on storage.objects
for insert with check (
  bucket_id = 'case-documents'
  and (storage.foldername(name))[1] = a1_tenant()::text
);

drop policy if exists "case_documents_delete" on storage.objects;
create policy "case_documents_delete" on storage.objects
for delete using (
  bucket_id = 'case-documents'
  and (storage.foldername(name))[1] = a1_tenant()::text
);

reset role;

-- =============================================================================
-- NOTA — erro "must be owner of table objects"
-- -----------------------------------------------------------------------------
-- Se aparecer esse erro, é porque a versão do SQL rodada não tinha o
-- "set role supabase_storage_admin" acima. Cole o arquivo INTEIRO novamente
-- (com o set role/reset role) — é o jeito documentado pelo Supabase de
-- gerenciar políticas em storage.objects (tabela pertence a essa role
-- interna, não à role padrão do SQL Editor).
--
-- NOTA IMPORTANTE — verificação após rodar este SQL
-- -----------------------------------------------------------------------------
-- Este SQL cria o bucket e o isolamento por tenant. Peço para testar 1x, assim
-- que o código novo estiver no ar: anexar um documento de teste num processo e
-- clicar em "Abrir". Se der erro de permissão, me avise imediatamente — é um
-- ajuste rápido (o Storage do Supabase é um serviço separado do banco; o
-- isolamento por tenant aqui segue o mesmo mecanismo já comprovado nas
-- tabelas, mas nunca foi testado no Storage deste projeto especificamente).
--
-- Documentos já existentes (base64, antigos) continuam abrindo normalmente —
-- não foram apagados nem precisam ser migrados; só os NOVOS anexos passam a
-- ir para o Storage.
-- =============================================================================
