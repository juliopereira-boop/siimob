-- =============================================================================
-- Registra os módulos que o painel do superadmin oferece mas que ainda não
-- existiam na tabela a1_modules. Sem estas linhas, "Liberar" falha por violação
-- de chave estrangeira (a1_tenant_modules.module_key -> a1_modules.key).
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

INSERT INTO a1_modules (key, name, description) VALUES
  ('crm',              'CRM Básico',           'Gestão de contatos, leads e clientes com histórico de interações.'),
  ('financeiro',       'Módulo Financeiro',    'Controle de comissões, repasse financeiro e fluxo de caixa.'),
  ('simulador',        'Simulador de Crédito', 'Simulação de financiamento consignado e habitacional integrada.'),
  ('portal_parceiro',  'Portal Parceiro',      'Acesso externo para correspondentes parceiros acompanharem seus processos.'),
  ('ocr',              'Leitor OCR',           'Extração automática de dados de documentos PDF via inteligência artificial.'),
  ('workflow_avancado','Workflow Avançado',    'Motor de automação com pré-requisitos, ações e gatilhos personalizados.'),
  ('multi_regional',   'Multi-Regional',       'Segregação de dados e relatórios por região geográfica.')
ON CONFLICT (key) DO NOTHING;

-- Opcional: liberar o módulo CRM para um tenant específico (substitua o slug).
-- INSERT INTO a1_tenant_modules (tenant_id, module_key)
-- SELECT id, 'crm' FROM a1_tenants WHERE slug = 'minhaconstrutora'
-- ON CONFLICT (tenant_id, module_key) DO NOTHING;
