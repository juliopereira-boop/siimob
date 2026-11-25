-- ════════════════════════════════════════════════════════════════════════════
-- TABELA DE PREÇOS 2026 (superadmin › Planos)
--
-- POR QUE ESTE ARQUIVO EXISTE
--   "coloque toda essa tabela nos Planos, do superadmin" — a tabela de preços
--   (planos por quantidade de usuários, preço de cada módulo e pacotes) passa a
--   morar no banco e a ser editada no superadmin.
--
-- O QUE ELE FAZ
--   1. a1_plans ganha duas colunas: "tabela" (a qual tabela de preços o plano
--      pertence; '2026' para os novos) e "ordem". Os planos por usuários entram
--      como LINHAS NOVAS, com chaves novas (ate8, ate20, ate40, ate70, ate100),
--      e passam a ser os oferecidos ao cadastrar ou trocar o plano de um cliente.
--   2. a1_precos (nova): preço de cada módulo (disponível / em breve), dos
--      pacotes com desconto e do usuário adicional acima de 100. Só a chave de
--      serviço lê e grava (o superadmin passa pela função sa-proxy).
--
-- O QUE ELE NÃO MUDA
--   Nenhum plano existente (starter, pro, enterprise): nem nome, nem preço, nem
--   limite. Nenhum cliente: plan_key e max_users de cada um ficam como estão; os
--   planos antigos continuam aparecendo no superadmin como "em uso". Nenhuma
--   licença de módulo (a1_tenant_modules) nem o catálogo a1_modules.
--   As inserções usam "on conflict do nothing": rodar de novo não sobrescreve
--   preço que o superadmin já tenha editado.
--
-- COMO CONFERIR
--   select key, name, max_users, price_brl from a1_plans where tabela = '2026' order by ordem;  -- 5 linhas
--   select tipo, count(*) from a1_precos group by tipo;  -- modulo 14, pacote 3, usuario_extra 1
--   select key, price_brl from a1_plans where tabela is null;  -- os antigos, iguais a antes
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Planos por usuários ──────────────────────────────────────────────────
alter table a1_plans add column if not exists tabela text;
alter table a1_plans add column if not exists ordem int;

insert into a1_plans (key, name, max_users, price_brl, tabela, ordem) values
  ('ate8',   'Até 8 usuários',     8,   800.00, '2026', 1),
  ('ate20',  'Até 20 usuários',   20,  1500.00, '2026', 2),
  ('ate40',  'Até 40 usuários',   40,  2600.00, '2026', 3),
  ('ate70',  'Até 70 usuários',   70,  4000.00, '2026', 4),
  ('ate100', 'Até 100 usuários', 100,  5200.00, '2026', 5)
on conflict (key) do nothing;

-- ── 2. Módulos, pacotes e usuário adicional ─────────────────────────────────
create table if not exists a1_precos (
  chave text primary key check (chave ~ '^[a-z0-9_]{2,40}$'),
  tipo text not null check (tipo in ('modulo', 'pacote', 'usuario_extra')),
  nome text not null check (length(btrim(nome)) between 1 and 80),
  descricao text check (descricao is null or length(descricao) <= 400),
  -- módulo: a chave da licença em a1_modules (null enquanto o módulo não existe)
  modulo_key text check (modulo_key is null or modulo_key ~ '^[A-Za-z0-9_]{2,40}$'),
  -- pacote: as chaves dos módulos (desta tabela) que ele inclui
  modulos text[] not null default '{}',
  status text not null default 'disponivel' check (status in ('disponivel', 'em_breve')),
  preco_brl numeric(10,2) not null check (preco_brl >= 0 and preco_brl <= 1000000),
  ordem int not null default 0,
  atualizado_em timestamptz not null default now()
);
alter table a1_precos enable row level security;
revoke all on a1_precos from public, anon, authenticated;
grant select, insert, update, delete on a1_precos to service_role;

insert into a1_precos (chave, tipo, nome, descricao, modulo_key, status, preco_brl, ordem) values
  ('crm', 'modulo', 'CRM completo',
   'Funil de leads em quadro, listagem e dashboard, tarefas, visitas, origem de cada lead e leads do Facebook e Instagram (Meta Lead Ads) entrando sozinhos.',
   'crm', 'disponivel', 390, 1),
  ('atendimento', 'modulo', 'Central de Atendimento com IA',
   'A agente ELIA atende no WhatsApp com OpenAI, qualifica, distribui por roleta e faz follow-up. Fluxos visuais, campanhas com proteção anti-bloqueio e Google Agenda. Requer o CRM.',
   'ATENDIMENTO', 'disponivel', 690, 2),
  ('pre_analise', 'modulo', 'Pré-análise de crédito',
   'Pessoas, dossiê, renda, FGTS, subsídio, correspondente e decisão de crédito, em esteira própria.',
   'PRE_ANALISE', 'disponivel', 390, 3),
  ('venda', 'modulo', 'Venda',
   'Proposta, negociação, contrato e assinatura. Abre o repasse na etapa escolhida.',
   'COMERCIAL', 'disponivel', 290, 4),
  ('disposicao', 'modulo', 'Disposição de unidades',
   'Ficha e mapa de preço de cada unidade, planta com a situação em tempo real e reserva com fluxo de pagamento.',
   'DISPOSICAO', 'disponivel', 390, 5),
  ('repasse', 'modulo', 'Repasse Imobiliário',
   'Esteira completa do repasse bancário, com quadro, documentos, prazos e acompanhamento.',
   'repasse', 'disponivel', 490, 6),
  ('registro', 'modulo', 'Registro em Cartório',
   'ITBI, protocolos, exigências e matrícula atualizada, para o despachante.',
   'registro', 'disponivel', 290, 7),
  ('locacao', 'modulo', 'Locação',
   'Contratos de aluguel, vistorias, cobrança, repasse ao proprietário e reajustes.',
   'LOCACAO', 'disponivel', 490, 8),
  ('financeiro', 'modulo', 'Financeiro',
   'Comissões, repasse financeiro e fluxo de caixa.',
   'financeiro', 'em_breve', 350, 9),
  ('simulador', 'modulo', 'Simulador de Crédito',
   'Simulação de financiamento habitacional e consignado.',
   'simulador', 'em_breve', 190, 10),
  ('portal_parceiro', 'modulo', 'Portal do Parceiro',
   'Acesso externo para correspondentes e parceiros acompanharem seus processos.',
   'portal_parceiro', 'em_breve', 250, 11),
  ('ocr', 'modulo', 'Leitor de documentos com IA',
   'Extração automática de dados de documentos em PDF.',
   'ocr', 'em_breve', 290, 12),
  ('workflow_avancado', 'modulo', 'Workflow Avançado',
   'Automação com pré-requisitos, ações e gatilhos personalizados.',
   'workflow_avancado', 'em_breve', 350, 13),
  ('multi_regional', 'modulo', 'Multirregional',
   'Dados e relatórios separados por região.',
   'multi_regional', 'em_breve', 290, 14),
  ('usuario_extra', 'usuario_extra', 'Usuário adicional acima de 100',
   'Valor mensal por usuário além dos 100 do maior plano.', null, 'disponivel', 45, 1)
on conflict (chave) do nothing;

insert into a1_precos (chave, tipo, nome, descricao, modulos, status, preco_brl, ordem) values
  ('imobiliaria_digital', 'pacote', 'Imobiliária Digital', 'CRM completo, Central de Atendimento com IA e Venda',
   array['crm', 'atendimento', 'venda'], 'disponivel', 1190, 1),
  ('correspondente', 'pacote', 'Correspondente', 'Pré-análise de crédito, Repasse Imobiliário e Registro em Cartório',
   array['pre_analise', 'repasse', 'registro'], 'disponivel', 990, 2),
  ('construtora_completa', 'pacote', 'Construtora Completa',
   'CRM, Central com IA, Pré-análise, Venda, Disposição, Repasse e Registro',
   array['crm', 'atendimento', 'pre_analise', 'venda', 'disposicao', 'repasse', 'registro'], 'disponivel', 2490, 3)
on conflict (chave) do nothing;
