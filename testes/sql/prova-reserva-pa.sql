-- =============================================================================
-- PROVA DE 2026-11-03_reserva_pre_analise_e_selos.sql
--
-- Roda depois de prova-disposicao.sql, no mesmo banco, com o mesmo cenário:
-- THE CRED (A) e Outro Cliente (B), o Gestor, Ana e Bruno (corretores) e Carla
-- (analista). Monta um empreendimento próprio para não depender do estado que
-- a prova anterior deixou nas unidades dela.
--
-- Cada verificação existe por um jeito concreto de a regra quebrar: reserva
-- que fica sem venda, reserva de pré-análise reprovada, a mesma pré-análise
-- segurando duas unidades, regra de pré-análise que trava processo antigo,
-- selo duplicado no mesmo funil, visita gravada na agenda de quem não vê o lead.
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;

-- ─── Cenário (como dono do banco) ────────────────────────────────────────────
reset role;
insert into a1_modules (key, name) values ('crm','Leads') on conflict do nothing;
-- A prova de segurança termina revogando a Pré-análise de A; aqui ela volta.
insert into a1_tenant_modules (tenant_id, module_key) values
  ('11111111-1111-1111-1111-111111111111','crm'),
  ('22222222-2222-2222-2222-222222222222','crm'),
  ('11111111-1111-1111-1111-111111111111','PRE_ANALISE')
on conflict do nothing;

insert into a1_developments (id, tenant_id, name, units) values
  ('d1000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Parque das Águas',
   '["P-101","P-102","P-103","P-104"]');
insert into a1_unidades (id, tenant_id, empreendimento_id, codigo, bloco, pavimento, numero) values
  ('aa000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000002','P-101','P',1,'01'),
  ('aa000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000002','P-102','P',1,'02'),
  ('aa000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000002','P-103','P',1,'03'),
  ('aa000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000002','P-104','P',1,'04');
insert into a1_mapas_preco (id, tenant_id, empreendimento_id, nome, ativo) values
  ('3a000000-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111',
   'd1000000-0000-0000-0000-000000000002','Tabela Parque', true);
insert into a1_mapa_preco_itens (tenant_id, mapa_id, unidade_id, valor, valor_avaliacao)
select '11111111-1111-1111-1111-111111111111','3a000000-0000-0000-0000-000000000009', id, 100000, 110000
  from a1_unidades where empreendimento_id = 'd1000000-0000-0000-0000-000000000002';

insert into a1_pa_situacoes (id, tenant_id, nome, flag, ordem, selo) values
  ('5a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Em análise (prova)',null,5,null),
  ('5a000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Aprovada (prova)',null,6,'FIM_POSITIVO');

update a1_partners set permissions = '{"disp_ver":true,"disp_reservar":true,"pa_ver":true,"pa_iniciar_venda":true}'::jsonb,
       perfil_id = null where id = 'b0000000-0000-0000-0000-000000000001';
update a1_partners set permissions = '{"disp_ver":true,"disp_reservar":true}'::jsonb, perfil_id = null
 where id = 'b0000000-0000-0000-0000-000000000002';

-- Pré-análises da Ana no Parque: uma aprovada com crédito, uma aprovada sem
-- crédito, uma em análise, e uma aprovada de outro empreendimento.
select teste_entrar('tk-gestor');
insert into a1_pa_pessoas (id, tenant_id, nome, documento, estado_civil) values
  ('71000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Joana Titular','11144477735','Casado(a)'),
  ('71000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Pedro Cônjuge','39053344705',null);
insert into a1_pre_analises (id, tenant_id, empreendimento_id, unidade_id, corretor_id, situacao_id) values
  ('8a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000002',
   'aa000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000002'),
  ('8a000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000002',
   null,'b0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000002'),
  ('8a000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000002',
   null,'b0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001'),
  ('8a000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000001',
   null,'b0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000002');
insert into a1_pa_participantes (tenant_id, pre_analise_id, pessoa_id, papel, parentesco, renda_declarada)
select '11111111-1111-1111-1111-111111111111', pa, '71000000-0000-0000-0000-000000000001', 'TITULAR', null, 450000
  from unnest(array['8a000000-0000-0000-0000-000000000001','8a000000-0000-0000-0000-000000000002',
                    '8a000000-0000-0000-0000-000000000003','8a000000-0000-0000-0000-000000000004']::uuid[]) pa;
insert into a1_pa_participantes (tenant_id, pre_analise_id, pessoa_id, papel, parentesco, renda_declarada) values
  ('11111111-1111-1111-1111-111111111111','8a000000-0000-0000-0000-000000000001',
   '71000000-0000-0000-0000-000000000002','ASSOCIADO','Cônjuge',300000);
-- Crédito aprovado DEPOIS dos participantes: mexer em participante invalida a
-- decisão. E só nas que já estão aprovadas: registrar crédito aprovado faz a
-- pré-análise avançar sozinha para a etapa do selo Fim positivo (é o que
-- produção faz), e a "em análise" deixaria de estar em análise.
insert into a1_pa_analises_credito (tenant_id, pre_analise_id, versao, status, valor_aprovado, valor_fgts, valor_subsidio, valor_total)
select '11111111-1111-1111-1111-111111111111', pa, 1, 'APROVADO', 7000000, 1000000, 500000, 8500000
  from unnest(array['8a000000-0000-0000-0000-000000000001','8a000000-0000-0000-0000-000000000004']::uuid[]) pa;

\o /dev/null
set role anon;

-- ─── 1. A UNIDADE NA PRÉ-ANÁLISE ─────────────────────────────────────────────
select teste_entrar('tk-gestor');
select checa('a pré-análise com a ficha grava o código da unidade no texto',
  (select unidade from a1_pre_analises where id = '8a000000-0000-0000-0000-000000000001') = 'P-101');
select checa('ficha de outro empreendimento é recusada',
  tenta($$insert into a1_pre_analises (tenant_id, empreendimento_id, unidade_id, situacao_id)
          values ('11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000001',
                  'aa000000-0000-0000-0000-000000000002','5a000000-0000-0000-0000-000000000001')$$)
  like '%unidade_fora_do_empreendimento%');
update a1_pre_analises set unidade = 'texto solto' where id = '8a000000-0000-0000-0000-000000000001';
select checa('com a ficha mantida, um texto diferente volta a ser o código dela',
  (select unidade from a1_pre_analises where id = '8a000000-0000-0000-0000-000000000001') = 'P-101');
select checa('trocar a ficha por uma de outro empreendimento também',
  tenta($$update a1_pre_analises set unidade_id = (select id from a1_unidades where codigo = 'B1-001')
           where id = '8a000000-0000-0000-0000-000000000001'$$) like '%unidade_fora_do_empreendimento%');

select guarda('upc', a1_pa_unidades_para_cadastro('d1000000-0000-0000-0000-000000000002'));
select checa('o cadastro da pré-análise recebe as unidades com a avaliação do mapa que vale',
  json_array_length(r('upc')) = 4
  and (select (e->>'valor_avaliacao')::numeric from json_array_elements(r('upc')) e where e->>'codigo' = 'P-101') = 110000,
  r('upc')::text);
select teste_entrar('tk-helena');
select checa('quem não cria nem edita pré-análise não recebe a lista',
  tenta($$select a1_pa_unidades_para_cadastro('d1000000-0000-0000-0000-000000000002')$$) like '%sem_permissao%');
select teste_entrar('tk-outro');
select checa('o outro cliente não vê as unidades de A',
  tenta($$select a1_pa_unidades_para_cadastro('d1000000-0000-0000-0000-000000000002')$$) is not null
  or json_array_length(a1_pa_unidades_para_cadastro('d1000000-0000-0000-0000-000000000002')) = 0);
select teste_entrar('tk-gestor');

-- ─── 2. REGRAS DA PRÉ-ANÁLISE ────────────────────────────────────────────────
select guarda('rv1', a1_pa_regras_vigentes());
select checa('sem regra gravada, nada é exigido',
  not (r('rv1')->>'exige_corretor')::boolean and not (r('rv1')->>'exige_unidade')::boolean
  and not (r('rv1')->>'salvas')::boolean, r('rv1')::text);
select checa('fora do perfil construtora, o cônjuge não é exigido por padrão',
  not (r('rv1')->>'exige_conjuge')::boolean);
reset role;
update a1_tenants set tipo_cliente = 'construtora' where id = '11111111-1111-1111-1111-111111111111';
set role anon;
select teste_entrar('tk-gestor');
select checa('construtora sem regra gravada: o cônjuge é exigido por padrão',
  (a1_pa_regras_vigentes()->>'exige_conjuge')::boolean);
select checa('sem regra, pré-análise sem corretor nasce',
  tenta($$insert into a1_pre_analises (tenant_id, empreendimento_id, situacao_id)
          values ('11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000002',
                  '5a000000-0000-0000-0000-000000000001')$$) is null);
insert into a1_pa_regras (tenant_id, exige_corretor, exige_unidade, exige_conjuge)
values ('22222222-2222-2222-2222-222222222222', true, true, true);
select checa('a regra gravada com o tenant de outro cliente fica no cliente da sessão',
  (select tenant_id from a1_pa_regras) = '11111111-1111-1111-1111-111111111111');
select checa('com a regra, pré-análise sem corretor é recusada',
  tenta($$insert into a1_pre_analises (tenant_id, empreendimento_id, unidade, situacao_id)
          values ('11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000002','P-109',
                  '5a000000-0000-0000-0000-000000000001')$$) like '%pa_exige_corretor%');
select checa('e sem unidade também',
  tenta($$insert into a1_pre_analises (tenant_id, empreendimento_id, corretor_id, situacao_id)
          values ('11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000002',
                  'b0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001')$$)
  like '%pa_exige_unidade%');
select checa('com corretor e unidade, nasce',
  tenta($$insert into a1_pre_analises (tenant_id, empreendimento_id, corretor_id, unidade, situacao_id)
          values ('11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000002',
                  'b0000000-0000-0000-0000-000000000001','P-109','5a000000-0000-0000-0000-000000000001')$$) is null);
select checa('tirar o corretor de quem tem é recusado',
  tenta($$update a1_pre_analises set corretor_id = null
           where id = '8a000000-0000-0000-0000-000000000003'$$) like '%pa_exige_corretor%');
select checa('mas a pré-análise antiga que já não tinha corretor continua editável',
  tenta($$update a1_pre_analises set unidade = 'P-110'
           where corretor_id is null and empreendimento_id = 'd1000000-0000-0000-0000-000000000002'$$) is null);
select teste_entrar('tk-ana');
update a1_pa_regras set exige_corretor = false;
select checa('corretor não altera as regras',
  (select exige_corretor from a1_pa_regras where tenant_id = '11111111-1111-1111-1111-111111111111'));
select teste_entrar('tk-outro');
select checa('o outro cliente não lê as regras de A', (select count(*) from a1_pa_regras) = 0);
reset role;
update a1_pa_regras set exige_corretor = false, exige_unidade = false;
set role anon;

-- ─── 3. AVALIAÇÃO NO MAPA DE PREÇO ───────────────────────────────────────────
select teste_entrar('tk-gestor');
select checa('avaliação zero é recusada',
  tenta($$update a1_mapa_preco_itens set valor_avaliacao = 0
           where unidade_id = 'aa000000-0000-0000-0000-000000000004'$$) is not null);
update a1_mapa_preco_itens set valor_avaliacao = 115000 where unidade_id = 'aa000000-0000-0000-0000-000000000004';
select checa('mudar a avaliação do mapa que vale entra no rastro da unidade',
  exists (select 1 from a1_unidade_eventos where evento = 'PRECO' and codigo = 'P-104'
           and (detalhe->>'avaliacao_para')::numeric = 115000));
select guarda('dup', a1_mapa_preco_duplicar('3a000000-0000-0000-0000-000000000009', 'Parque reajustado', 10));
select checa('o reajuste copia a avaliação como está e corrige só a venda',
  (select valor from a1_mapa_preco_itens where mapa_id = (r('dup')->>'mapa_id')::uuid
      and unidade_id = 'aa000000-0000-0000-0000-000000000004') = 110000
  and (select valor_avaliacao from a1_mapa_preco_itens where mapa_id = (r('dup')->>'mapa_id')::uuid
      and unidade_id = 'aa000000-0000-0000-0000-000000000004') = 115000, r('dup')::text);

-- ─── 4. DE ONDE A RESERVA COMEÇA ─────────────────────────────────────────────
insert into a1_disposicao_config (tenant_id, origem_reserva) values ('11111111-1111-1111-1111-111111111111','PRE_ANALISE')
on conflict (tenant_id) do update set origem_reserva = 'PRE_ANALISE';
select checa('origem desconhecida é recusada',
  tenta($$update a1_disposicao_config set origem_reserva = 'QUALQUER'$$) is not null);

select teste_entrar('tk-ana');
select guarda('o1', a1_unidade_reservar('aa000000-0000-0000-0000-000000000002',
  '{"titular":{"nome":"Sem PA","cpf":"52998224725"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000003","quantidade":1,"valor":100000}]', 1));
select checa('na regra de pré-análise, reserva direto no mapa é recusada',
  r('o1')->>'erro' = 'reserva_exige_pre_analise'
  and (select status from a1_unidades where codigo = 'P-102') = 'disponivel', r('o1')::text);

select guarda('o2', a1_unidade_reservar('aa000000-0000-0000-0000-000000000002',
  '{"titular":{"nome":"Joana Titular","cpf":"11144477735"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000003","quantidade":1,"valor":100000}]', 1,
  null, null, null, '8a000000-0000-0000-0000-000000000003'));
select checa('pré-análise que não está no Fim positivo não reserva',
  r('o2')->>'erro' = 'pre_analise_nao_aprovada', r('o2')::text);

select guarda('o3', a1_unidade_reservar('aa000000-0000-0000-0000-000000000002',
  '{"titular":{"nome":"Joana Titular","cpf":"11144477735"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000003","quantidade":1,"valor":100000}]', 1,
  null, null, null, '8a000000-0000-0000-0000-000000000002'));
select checa('aprovada no selo mas sem crédito aprovado também não reserva (a Venda precisa do crédito)',
  r('o3')->>'erro' like '%crédito%', r('o3')::text);

select guarda('o4', a1_unidade_reservar('aa000000-0000-0000-0000-000000000002',
  '{"titular":{"nome":"Joana Titular","cpf":"11144477735"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000003","quantidade":1,"valor":100000}]', 1,
  null, null, null, '8a000000-0000-0000-0000-000000000004'));
select checa('pré-análise de outro empreendimento não reserva unidade deste',
  r('o4')->>'erro' = 'pre_analise_de_outro_empreendimento', r('o4')::text);

select teste_entrar('tk-bruno');
select checa('sem a permissão "Iniciar venda", reservar pela pré-análise é recusado',
  tenta($$select a1_unidade_reservar('aa000000-0000-0000-0000-000000000002',
    '{"titular":{"nome":"Joana Titular","cpf":"11144477735"}}',
    '[{"parametro_id":"9a000000-0000-0000-0000-000000000003","quantidade":1,"valor":100000}]', 1,
    null, null, null, '8a000000-0000-0000-0000-000000000001')$$) like '%sem_permissao%');

-- ─── 5. A RESERVA LEVA À VENDA ───────────────────────────────────────────────
select teste_entrar('tk-ana');
select guarda('lista1', a1_disp_pre_analises_aprovadas());
select checa('o seletor traz as aprovadas sem venda, e não a que está em análise',
  (select count(*) from json_array_elements(r('lista1')) e
    where e->>'id' in ('8a000000-0000-0000-0000-000000000001','8a000000-0000-0000-0000-000000000002')) = 2
  and not exists (select 1 from json_array_elements(r('lista1')) e
    where e->>'id' = '8a000000-0000-0000-0000-000000000003'), r('lista1')::text);
select guarda('dados', a1_disp_dados_da_pre_analise('8a000000-0000-0000-0000-000000000001'));
select checa('os dados da pré-análise trazem titular e cônjuge com parentesco',
  (select count(*) from json_array_elements(r('dados')->'pessoas')) = 2
  and exists (select 1 from json_array_elements(r('dados')->'pessoas') p
               where p->>'parentesco' = 'Cônjuge' and p->>'nome' = 'Pedro Cônjuge'), r('dados')::text);
select checa('e o crédito aprovado em reais',
  (r('dados')->'credito'->>'financiamento')::numeric = 70000
  and (r('dados')->'credito'->>'fgts')::numeric = 10000, r('dados')::text);
select checa('e nenhum motivo para não reservar', r('dados')->>'motivo' is null, r('dados')::text);

select guarda('ok1', a1_unidade_reservar('aa000000-0000-0000-0000-000000000002',
  '{"titular":{"nome":"Joana Titular","cpf":"11144477735"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000001","quantidade":1,"valor":15000,"primeiro_vencimento":"2026-12-01"},
    {"parametro_id":"9a000000-0000-0000-0000-000000000003","quantidade":1,"valor":85000}]', 1,
  null, null, null, '8a000000-0000-0000-0000-000000000001'));
select checa('pela pré-análise aprovada, a reserva acontece',
  (r('ok1')->>'ok')::boolean and (select status from a1_unidades where codigo = 'P-102') = 'reservado',
  r('ok1')::text);
reset role;
select checa('e abre a venda ligada à pré-análise, à unidade e à reserva',
  exists (select 1 from a1_comerciais c
           where c.id = (r('ok1')->>'comercial_id')::uuid
             and c.pre_analise_id = '8a000000-0000-0000-0000-000000000001'
             and c.unidade_id = 'aa000000-0000-0000-0000-000000000002'
             and c.reserva_id = (r('ok1')->>'reserva_id')::uuid and c.unidade = 'P-102'),
  r('ok1')::text);
select checa('na situação inicial da Venda',
  (select s.flag from a1_comerciais c join a1_co_situacoes s on s.id = c.situacao_id
    where c.id = (r('ok1')->>'comercial_id')::uuid) = 'INICIAL');
select checa('com o crédito da análise e o fluxo da reserva',
  (select (origem_snapshot->'credito'->>'valor_aprovado')::bigint from a1_comerciais
    where id = (r('ok1')->>'comercial_id')::uuid) = 7000000
  and (select jsonb_array_length(origem_snapshot->'fluxo') from a1_comerciais
    where id = (r('ok1')->>'comercial_id')::uuid) = 2);
select checa('e a proposta com o valor da unidade e o ato como condição, em centavos',
  (select (proposta->>'valor_venda')::bigint from a1_comerciais where id = (r('ok1')->>'comercial_id')::uuid) = 10000000
  and (select proposta->'condicoes_pagamento'->0->>'tipo' from a1_comerciais
        where id = (r('ok1')->>'comercial_id')::uuid) = 'ATO'
  and (select (proposta->>'valor_entrada')::bigint from a1_comerciais
        where id = (r('ok1')->>'comercial_id')::uuid) = 1500000);
select checa('a reserva lembra a pré-análise',
  (select pre_analise_id from a1_reservas where id = (r('ok1')->>'reserva_id')::uuid)
    = '8a000000-0000-0000-0000-000000000001');
set role anon;
select teste_entrar('tk-ana');
select guarda('ok2', a1_unidade_reservar('aa000000-0000-0000-0000-000000000003',
  '{"titular":{"nome":"Joana Titular","cpf":"11144477735"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000003","quantidade":1,"valor":100000}]', 1,
  null, null, null, '8a000000-0000-0000-0000-000000000001'));
select checa('a mesma pré-análise não segura uma segunda unidade',
  r('ok2')->>'erro' in ('pre_analise_ja_tem_venda', 'pre_analise_ja_tem_reserva')
  and (select status from a1_unidades where codigo = 'P-103') = 'disponivel', r('ok2')::text);
select checa('e some do seletor',
  not exists (select 1 from json_array_elements(a1_disp_pre_analises_aprovadas()) e
               where e->>'id' = '8a000000-0000-0000-0000-000000000001'));

-- ─── 6. SEM SITUAÇÃO INICIAL NA VENDA, SEM RESERVA ───────────────────────────
reset role;
update a1_disposicao_config set origem_reserva = 'LIVRE';
update a1_co_situacoes set ativo = false
 where tenant_id = '11111111-1111-1111-1111-111111111111' and flag = 'INICIAL';
set role anon;
select teste_entrar('tk-ana');
select guarda('s1', a1_unidade_reservar('aa000000-0000-0000-0000-000000000003',
  '{"titular":{"nome":"Sem Venda","cpf":"52998224725"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000003","quantidade":1,"valor":100000}]', 1));
select checa('a Venda sem situação inicial impede a reserva, com o motivo',
  r('s1')->>'erro' = 'venda_sem_situacao_inicial'
  and (select status from a1_unidades where codigo = 'P-103') = 'disponivel'
  and not exists (select 1 from a1_reservas r join a1_unidades u on u.id = r.unidade_id where u.codigo = 'P-103'),
  r('s1')::text);
reset role;
update a1_co_situacoes set selo = 'INICIO'
 where id = '5c000000-0000-0000-0000-000000000002';
set role anon;
select teste_entrar('tk-ana');
select guarda('s2', a1_unidade_reservar('aa000000-0000-0000-0000-000000000003',
  '{"titular":{"nome":"Pelo Selo","cpf":"52998224725"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000003","quantidade":1,"valor":100000}]', 1));
reset role;
select checa('sem a marca Inicial, a venda nasce na situação do selo Início',
  (r('s2')->>'ok')::boolean
  and (select situacao_id from a1_comerciais where id = (r('s2')->>'comercial_id')::uuid)
      = '5c000000-0000-0000-0000-000000000002', r('s2')::text);
update a1_co_situacoes set selo = null where id = '5c000000-0000-0000-0000-000000000002';
update a1_co_situacoes set ativo = true
 where tenant_id = '11111111-1111-1111-1111-111111111111' and flag = 'INICIAL';

-- A reserva antiga, feita quando ainda não havia situação inicial: sem venda.
select set_config('a1.orquestrador', '1', false);
insert into a1_reservas (id, tenant_id, unidade_id, empreendimento_id, corretor_id, cliente, fluxo, valor_unidade, valor_fluxo)
values ('ab000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'aa000000-0000-0000-0000-000000000004','d1000000-0000-0000-0000-000000000002',
        'b0000000-0000-0000-0000-000000000001',
        '{"titular":{"nome":"Reserva Antiga","cpf":"52998224725"}}',
        '[{"serie":"FINANCIAMENTO","nome":"Financiamento","valor":100000,"quantidade":1,"quem_paga":"BANCO"}]',
        100000, 100000);
update a1_unidades set status = 'reservado' where id = 'aa000000-0000-0000-0000-000000000004';
select set_config('a1.orquestrador', '', false);
set role anon;
select teste_entrar('tk-bruno');
select checa('o colega não abre a venda da reserva da Ana',
  tenta($$select a1_reserva_abrir_venda('ab000000-0000-0000-0000-000000000001')$$) like '%sem_permissao%');
select teste_entrar('tk-ana');
select guarda('av1', a1_reserva_abrir_venda('ab000000-0000-0000-0000-000000000001'));
select guarda('av2', a1_reserva_abrir_venda('ab000000-0000-0000-0000-000000000001'));
reset role;
select checa('a reserva que ficou sem venda ganha a venda',
  (r('av1')->>'ok')::boolean
  and (select comercial_id from a1_reservas where id = 'ab000000-0000-0000-0000-000000000001')
      = (r('av1')->>'comercial_id')::uuid
  and exists (select 1 from a1_comerciais where id = (r('av1')->>'comercial_id')::uuid
                and reserva_id = 'ab000000-0000-0000-0000-000000000001'), r('av1')::text);
select checa('e pedir de novo devolve a mesma venda, sem criar outra',
  r('av2')->>'comercial_id' = r('av1')->>'comercial_id'
  and (select count(*) from a1_comerciais where reserva_id = 'ab000000-0000-0000-0000-000000000001') = 1);

-- ─── 7. SELOS DO FUNIL DE LEADS ──────────────────────────────────────────────
insert into a1_stages (id, tenant_id, module_key, group_key, name, position) values
  ('cc000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','crm','vendas','Visita',1),
  ('cc000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','crm','vendas','Visita 2',2),
  ('cc000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','crm','locacao','Visita',1),
  ('cc000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','crm','vendas','Análise',3);
select checa('selo de Leads numa etapa do Repasse é recusado',
  tenta($$update a1_stages set selo = 'AGENDAMENTO' where id = 'c0000000-0000-0000-0000-000000000001'$$) is not null);
set role anon;
select teste_entrar('tk-gestor');
select guarda('se1', a1_crm_definir_selo('cc000000-0000-0000-0000-000000000001', 'AGENDAMENTO'));
select guarda('se2', a1_crm_definir_selo('cc000000-0000-0000-0000-000000000003', 'AGENDAMENTO'));
-- a1_stages não tem leitura para anon no andaime: a conferência é como dono.
reset role;
select checa('cada funil tem a sua etapa de agendamento',
  (select count(*) from a1_stages where selo = 'AGENDAMENTO') = 2);
set role anon;
select teste_entrar('tk-gestor');
select guarda('se3', a1_crm_definir_selo('cc000000-0000-0000-0000-000000000002', 'AGENDAMENTO'));
reset role;
select checa('pôr o selo em outra etapa do mesmo funil tira da primeira',
  (select selo from a1_stages where id = 'cc000000-0000-0000-0000-000000000002') = 'AGENDAMENTO'
  and (select selo from a1_stages where id = 'cc000000-0000-0000-0000-000000000001') is null
  and (select selo from a1_stages where id = 'cc000000-0000-0000-0000-000000000003') = 'AGENDAMENTO');
set role anon;
select teste_entrar('tk-gestor');
select guarda('se4', a1_crm_definir_selo('cc000000-0000-0000-0000-000000000004', 'PRE_ANALISE'));
select checa('selo que não existe é recusado',
  tenta($$select a1_crm_definir_selo('cc000000-0000-0000-0000-000000000004', 'QUALQUER')$$) like '%selo_invalido%');
select checa('etapa do Repasse não recebe selo de Leads pela função',
  tenta($$select a1_crm_definir_selo('c0000000-0000-0000-0000-000000000001', 'GANHO')$$) like '%etapa_invalida%');
select teste_entrar('tk-ana');
select checa('corretor não mexe em selo',
  tenta($$select a1_crm_definir_selo('cc000000-0000-0000-0000-000000000004', null)$$) like '%sem_permissao%');

-- ─── 8. A VISITA NA AGENDA ───────────────────────────────────────────────────
reset role;
insert into a1_partners (id, tenant_id, name, cpf, type, permissions) values
  ('b0000000-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','Imobiliária Sol','10000000009','imobiliaria','{}')
on conflict do nothing;
select teste_login_parceiro('tk-imob', 'b0000000-0000-0000-0000-000000000009');
insert into a1_cases (id, tenant_id, module_key, stage_id, stage_name, client_name, client_phone,
                      development, unit, broker_name, real_estate_name, payload) values
  ('ca000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','crm',
   'cc000000-0000-0000-0000-000000000002','Visita 2','Lucas Lead','98999990000','Parque das Águas','P-104',
   -- O nome de hoje da Ana (uma prova anterior o troca): é por ele que o RLS
   -- de a1_cases reconhece o lead como dela.
   (select name from a1_partners where id = 'b0000000-0000-0000-0000-000000000001'),'Imobiliária Sol',
   '{"crm_refs":{"corretor_id":"b0000000-0000-0000-0000-000000000001","imobiliaria_id":"b0000000-0000-0000-0000-000000000009"}}');
set role anon;
select teste_entrar('tk-gestor');
select guarda('v1', a1_crm_agendar_visita('ca000000-0000-0000-0000-000000000001', '2026-11-20', '10:00', '11:00', 'Stand de vendas', 'Levar a planta'));
reset role;
select checa('a visita marcada pelo gestor entra na agenda do corretor e na da imobiliária',
  (r('v1')->>'ok')::boolean
  and exists (select 1 from a1_agenda where lead_id = 'ca000000-0000-0000-0000-000000000001' and tipo = 'visita'
               and dono = 'b0000000-0000-0000-0000-000000000001'
               and para_ator = 'a0000000-0000-0000-0000-000000000001')
  and exists (select 1 from a1_agenda where lead_id = 'ca000000-0000-0000-0000-000000000001' and tipo = 'visita'
               and dono = 'b0000000-0000-0000-0000-000000000009'), r('v1')::text);
select checa('com título, hora, local e o lead no histórico',
  exists (select 1 from a1_agenda where lead_id = 'ca000000-0000-0000-0000-000000000001'
           and titulo = 'Visita: Lucas Lead' and hora_inicio = '10:00' and local = 'Stand de vendas')
  and exists (select 1 from a1_events where case_id = 'ca000000-0000-0000-0000-000000000001'
               and description like 'Visita agendada para 20/11/2026 às 10:00%'));
set role anon;
select teste_entrar('tk-ana');
select checa('a corretora vê a visita na própria agenda',
  (select count(*) from a1_agenda where lead_id = 'ca000000-0000-0000-0000-000000000001') = 1);
select teste_entrar('tk-imob');
select checa('a imobiliária vê a dela',
  (select count(*) from a1_agenda where lead_id = 'ca000000-0000-0000-0000-000000000001') = 1);
select teste_entrar('tk-gestor');
select checa('e o gestor que marcou vê como convidado',
  (select count(*) from a1_agenda where lead_id = 'ca000000-0000-0000-0000-000000000001') = 1);
select teste_entrar('tk-bruno');
select checa('corretor que não é do lead não agenda visita nele',
  tenta($$select a1_crm_agendar_visita('ca000000-0000-0000-0000-000000000001', '2026-11-21')$$) like '%sem_acesso%');
select teste_entrar('tk-outro');
select checa('o outro cliente não agenda no lead de A',
  tenta($$select a1_crm_agendar_visita('ca000000-0000-0000-0000-000000000001', '2026-11-21')$$) like '%nao_encontrado%');
select teste_entrar('tk-ana');
select guarda('v2', a1_crm_agendar_visita('ca000000-0000-0000-0000-000000000001', '2026-11-22', '15:00', '14:00'));
select checa('hora de fim antes da de início é recusada', r('v2')->>'erro' = 'visita_hora_invertida', r('v2')::text);
select guarda('v3', a1_crm_agendar_visita('ca000000-0000-0000-0000-000000000001', '2026-11-22', '15:00'));
reset role;
select checa('a corretora do lead agenda: uma linha dela e uma da imobiliária, sem convidado',
  (select count(*) from a1_agenda where lead_id = 'ca000000-0000-0000-0000-000000000001' and data = '2026-11-22') = 2
  and not exists (select 1 from a1_agenda where lead_id = 'ca000000-0000-0000-0000-000000000001'
                   and data = '2026-11-22' and para_ator is not null), r('v3')::text);
select checa('a agenda continua recusando tipo desconhecido',
  tenta($$insert into a1_agenda (tenant_id, dono, tipo, titulo, data)
          values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','festa','x','2026-11-23')$$)
  is not null);

-- =============================================================================
\o
\echo ''
\echo '───────────────────────────────────────────────────────────────'
select n, case when passou then 'ok  ' else 'FALHOU' end as r, descr,
       coalesce(detalhe,'') as detalhe
  from prova order by n;
\echo '───────────────────────────────────────────────────────────────'
select count(*) filter (where passou) as passaram,
       count(*) filter (where not passou) as falharam,
       count(*) as total from prova;

do $$
declare f int;
begin
  select count(*) into f from prova where not passou;
  if f > 0 then raise exception 'PROVA DA RESERVA PELA PRÉ-ANÁLISE REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DA RESERVA PELA PRÉ-ANÁLISE APROVADA';
end $$;
