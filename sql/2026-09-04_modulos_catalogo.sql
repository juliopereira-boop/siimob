-- =============================================================================
-- CATÁLOGO: registra Pré-análise e Comercial como módulos licenciáveis
--
-- Só registra no catálogo. NÃO libera para ninguém: a tabela a1_tenant_modules
-- não recebe uma linha sequer. Todo cliente que existe hoje continua exatamente
-- como está, e as tabelas dos módulos novos não respondem para nenhum deles
-- enquanto o superadmin não clicar em "Liberar".
--
-- "Pré-cadastro" é o nome do CVCRM. Aqui o módulo se chama Pré-análise, e essa
-- palavra não aparece em chave, rota, tabela nem permissão deste produto.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

insert into a1_modules (key, name, description) values
  ('PRE_ANALISE', 'Pré-análise',
   'Entrada do processo: pessoas, dossiê de documentos, renda, FGTS, subsídio, ' ||
   'correspondente e a decisão de crédito. Esteira própria e configurável.'),
  ('COMERCIAL',   'Comercial',
   'Proposta, negociação, documentos comerciais, contrato e assinatura. ' ||
   'Esteira própria; pode abrir Repasse na etapa que o cliente escolher.')
on conflict (key) do update
  set name = excluded.name, description = excluded.description;

-- =============================================================================
-- COMO CONFERIR QUE NINGUÉM FOI AFETADO
--
--   -- os dois módulos existem no catálogo:
--   select key, name from a1_modules where key in ('PRE_ANALISE','COMERCIAL');
--
--   -- e não estão liberados para cliente nenhum (tem de voltar zero):
--   select count(*) from a1_tenant_modules where module_key in ('PRE_ANALISE','COMERCIAL');
--
-- PARA LIBERAR, use o superadmin (aba Clientes → Módulos). Preferir a tela é o
-- caminho certo: ela confere dependência e deixa registro de quem liberou.
-- =============================================================================
