-- =============================================================================
-- PROVA: MÓDULO FINANCEIRO (fase 1)
-- Roda depois das provas da Locação, no mesmo banco. THE CRED (111) tem o
-- módulo Venda (COMERCIAL): é a venda que gera o negócio. O outro cliente (222)
-- não tem: lá é o GANHO do Leads. Confere: sem licença nada acontece; regras-
-- modelo pelo tipo do cliente; venda VENDIDO gera negócio e comissões certas
-- (empresa, corretor, coordenador do corretor); recebimento parcial libera a
-- parte proporcional; pagamento marca a comissão; estorno que desfaria
-- comissão já paga é recusado; distrato cancela o que não foi pago; com Venda,
-- o GANHO do lead não duplica; sem Venda, GANHO gera, sair cancela, voltar
-- reativa; Repasse na etapa configurada gera o negócio do correspondente e
-- marca a assinatura de uma venda; regra mais específica vence; Locação lança
-- a taxa de administração e o estorno tira; lançamento manual pela tabela,
-- o resto só por função; parceiro vê só as dele; outro cliente não vê nada.
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;
create table if not exists fin_teste (k text primary key, v text);
truncate fin_teste;
grant select, insert, update on fin_teste to anon, service_role;
create or replace function fx(k text) returns text language sql as $$ select v from fin_teste where fin_teste.k = fx.k $$;
grant execute on function fx(text) to anon;
create or replace function fx_guarda(k text, v text) returns void language sql as $$
  insert into fin_teste values (k, v) on conflict (k) do update set v = excluded.v $$;
grant execute on function fx_guarda(text, text) to anon;

\o /dev/null
reset role;
-- cenário (dono do banco)
update a1_tenants set tipo_cliente = 'imobiliaria' where id = '11111111-1111-1111-1111-111111111111';
update a1_tenants set tipo_cliente = 'correspondente_bancario' where id = '22222222-2222-2222-2222-222222222222';
-- Ana: corretora sem permissão financeira, coordenada pelo Diego
update a1_partners set permissions = '{}'::jsonb, perfil_id = null,
       extra = coalesce(extra, '{}'::jsonb) || '{"coordenador_id":"b0000000-0000-0000-0000-000000000004"}'::jsonb
 where id = 'b0000000-0000-0000-0000-000000000001';
insert into a1_stages (id, tenant_id, module_key, name, position) values
  ('cf500000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','crm','Novo lead', 0),
  ('cf500000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','crm','Ganho', 1),
  ('cf500000-0000-0000-0000-000000000011','22222222-2222-2222-2222-222222222222','crm','Novo lead', 0),
  ('cf500000-0000-0000-0000-000000000012','22222222-2222-2222-2222-222222222222','crm','Ganho', 1),
  ('cf500000-0000-0000-0000-000000000013','22222222-2222-2222-2222-222222222222','crm','Perdido', 2),
  ('cf500000-0000-0000-0000-000000000021','22222222-2222-2222-2222-222222222222','repasse','Em análise', 0),
  ('cf500000-0000-0000-0000-000000000022','22222222-2222-2222-2222-222222222222','repasse','Contrato assinado', 1),
  ('cf500000-0000-0000-0000-000000000031','11111111-1111-1111-1111-111111111111','repasse','Contrato assinado', 9)
on conflict (id) do nothing;
update a1_stages set selo = 'GANHO' where id in ('cf500000-0000-0000-0000-000000000002','cf500000-0000-0000-0000-000000000012');
update a1_stages set selo = 'PERDIDO' where id = 'cf500000-0000-0000-0000-000000000013';

-- ─── 1. Sem a licença ───────────────────────────────────────────────────────
insert into a1_comerciais (id, tenant_id, situacao_id, corretor_id, unidade, proposta) values
  ('cf700000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','5c000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001', 'Z-1', '{"valor_venda": 10000000}');
select set_config('a1.orquestrador', '1', false);
update a1_comerciais set situacao_id = '5c000000-0000-0000-0000-000000000003' where id = 'cf700000-0000-0000-0000-000000000000';
select set_config('a1.orquestrador', '', false);
select checa('sem a licença, a venda VENDIDO não gera nada', not exists (select 1 from a1_fin_negocios));
set role anon;
select teste_entrar('tk-gestor');
select checa('sem a licença, o gestor não usa o Financeiro', tenta('select a1_fin_iniciar()') like '%sem_permissao%');

reset role;
insert into a1_modules (key, name) values ('financeiro', 'Módulo Financeiro') on conflict do nothing;
insert into a1_tenant_modules (tenant_id, module_key) values
  ('11111111-1111-1111-1111-111111111111','financeiro'), ('22222222-2222-2222-2222-222222222222','financeiro')
on conflict do nothing;

-- ─── 2. Preparação e regras-modelo (imobiliária) ────────────────────────────
set role anon;
select teste_entrar('tk-gestor');
select a1_fin_iniciar();
select checa('categorias do sistema e o Caixa criados', (select count(*) from a1_fin_categorias) = 15
  and (select count(*) from a1_fin_contas) = 1 and (select conta_padrao from a1_fin_config) is not null);
select fx_guarda('m', a1_fin_regras_modelo()::text);
select checa('regras-modelo da imobiliária: empresa 5%, corretor 40%, captador 10%, coordenador 5%',
  (fx('m')::jsonb->>'regras')::int = 4 and (select count(*) from a1_fin_regras where direcao = 'receber') = 1);
select checa('modelo só quando não há regra', tenta('select a1_fin_regras_modelo()') like '%ja_tem_regras%');
select checa('regra incoerente é recusada (receber para o corretor)',
  tenta($$insert into a1_fin_regras (tenant_id, nome, direcao, papel, percentual) values ('11111111-1111-1111-1111-111111111111','X','receber','corretor',1)$$) like '%a1_fin_regra_coerente%');

-- ─── 3. Venda VENDIDO gera o negócio e as comissões ─────────────────────────
reset role;
insert into a1_comerciais (id, tenant_id, situacao_id, corretor_id, unidade, proposta) values
  ('cf700000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','5c000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001', 'B1-201', '{"valor_venda": 50000000}');
select set_config('a1.orquestrador', '1', false);
update a1_comerciais set situacao_id = '5c000000-0000-0000-0000-000000000003' where id = 'cf700000-0000-0000-0000-000000000001';
select set_config('a1.orquestrador', '', false);
set role anon;
select teste_entrar('tk-gestor');
select fx_guarda('neg', (select id::text from a1_fin_negocios where origem = 'comercial' and origem_id = 'cf700000-0000-0000-0000-000000000001'));
select checa('VENDIDO gera o negócio NG com o valor da venda (R$ 500.000)',
  (select valor = 500000 and status = 'ativo' and seq = 1 from a1_fin_negocios where id = fx('neg')::uuid));
-- empresa 5% = 25.000; Ana 40% = 10.000; Diego (coordenador da Ana) 5% = 1.250
select checa('empresa recebe 25.000, liberada, com conta a receber em 30 dias',
  (select valor = 25000 and status = 'liberada' from a1_fin_comissoes where negocio_id = fx('neg')::uuid and direcao = 'receber')
  and (select valor = 25000 and status = 'aberto' and vencimento = current_date + 30 from a1_fin_lancamentos
        where negocio_id = fx('neg')::uuid and tipo = 'receber'));
select checa('Ana (corretora) 10.000 e Diego (coordenador dela) 1.250, previstas: liberam ao receber',
  (select valor = 10000 and status = 'prevista' and valor_liberado = 0 from a1_fin_comissoes
    where negocio_id = fx('neg')::uuid and partner_id = 'b0000000-0000-0000-0000-000000000001')
  and (select valor = 1250 and status = 'prevista' from a1_fin_comissoes
    where negocio_id = fx('neg')::uuid and partner_id = 'b0000000-0000-0000-0000-000000000004')
  and not exists (select 1 from a1_fin_lancamentos where negocio_id = fx('neg')::uuid and tipo = 'pagar'));

-- ─── 4. Recebimento parcial libera proporcional ─────────────────────────────
select fx_guarda('rec', (select id::text from a1_fin_lancamentos where negocio_id = fx('neg')::uuid and tipo = 'receber'));
select fx_guarda('t', coalesce(tenta(format($$select a1_fin_baixar(%L, current_date, 10000, null, 'pix', 1)$$, fx('rec'))), 'ok'));
select checa('recebe 10.000 de 25.000 (40%): baixa parcial, o resto fica em aberto', fx('t') = 'ok'
  and (select valor_pago = 10000 and status = 'pago' from a1_fin_lancamentos where id = fx('rec')::uuid)
  and (select count(*) = 1 and sum(valor) = 15000 from a1_fin_lancamentos where negocio_id = fx('neg')::uuid and tipo = 'receber' and status = 'aberto'));
select checa('Ana libera 4.000 (40% de 10.000) e Diego 500, com contas a pagar',
  (select valor_liberado = 4000 and status = 'liberada' from a1_fin_comissoes where negocio_id = fx('neg')::uuid and partner_id = 'b0000000-0000-0000-0000-000000000001')
  and (select valor_liberado = 500 from a1_fin_comissoes where negocio_id = fx('neg')::uuid and partner_id = 'b0000000-0000-0000-0000-000000000004')
  and (select sum(valor) = 4500 from a1_fin_lancamentos where negocio_id = fx('neg')::uuid and tipo = 'pagar' and status = 'aberto'));
select fx_guarda('rec2', (select id::text from a1_fin_lancamentos where negocio_id = fx('neg')::uuid and tipo = 'receber' and status = 'aberto'));
select a1_fin_baixar(fx('rec2')::uuid, current_date, 15000, null, 'transferencia', 1);
select checa('recebido o resto: Ana 10.000 e Diego 1.250 liberados por inteiro; a da empresa paga',
  (select valor_liberado = 10000 from a1_fin_comissoes where negocio_id = fx('neg')::uuid and partner_id = 'b0000000-0000-0000-0000-000000000001')
  and (select valor_liberado = 1250 from a1_fin_comissoes where negocio_id = fx('neg')::uuid and partner_id = 'b0000000-0000-0000-0000-000000000004')
  and (select status = 'paga' and valor_pago = 25000 from a1_fin_comissoes where negocio_id = fx('neg')::uuid and direcao = 'receber'));

-- ─── 5. Pagamento das comissões e estorno ───────────────────────────────────
select a1_fin_baixar(l.id, current_date, l.valor, null, 'pix', l.versao)
  from a1_fin_lancamentos l join a1_fin_comissoes c on c.id = l.comissao_id
 where c.negocio_id = fx('neg')::uuid and c.partner_id = 'b0000000-0000-0000-0000-000000000001' and l.status = 'aberto';
select checa('pagas as duas parcelas da Ana, a comissão dela fica paga',
  (select status = 'paga' and valor_pago = 10000 from a1_fin_comissoes where negocio_id = fx('neg')::uuid and partner_id = 'b0000000-0000-0000-0000-000000000001'));
select checa('estornar o recebimento que liberou comissão já paga é recusado',
  tenta(format($$select a1_fin_estornar(%L, 2)$$, fx('rec2'))) like '%comissao_ja_paga%'
  and (select status from a1_fin_lancamentos where id = fx('rec2')::uuid) = 'pago');
select checa('lançamento gerado pelo sistema não se cancela nem se edita pela tabela',
  tenta(format($$select a1_fin_cancelar_lancamento(%L, 1)$$, (select id from a1_fin_lancamentos where negocio_id = fx('neg')::uuid and status = 'aberto' limit 1))) like '%lancamento_do_sistema%');
update a1_fin_lancamentos set valor = 1 where negocio_id = fx('neg')::uuid;
select checa('(o UPDATE direto não muda nada)', not exists (select 1 from a1_fin_lancamentos where negocio_id = fx('neg')::uuid and valor = 1));
select checa('negócio com pagamento não recalcula', tenta(format($$select a1_fin_recalcular(%L)$$, fx('neg'))) like '%negocio_com_pagamento%');

-- ─── 6. Distrato ────────────────────────────────────────────────────────────
reset role;
select set_config('a1.orquestrador', '1', false);
update a1_comerciais set situacao_id = '5c000000-0000-0000-0000-000000000004' where id = 'cf700000-0000-0000-0000-000000000001';
select set_config('a1.orquestrador', '', false);
set role anon;
select teste_entrar('tk-gestor');
select checa('distrato cancela o negócio; a comissão do Diego (não paga) cai, a da Ana (paga) fica',
  (select status = 'cancelado' from a1_fin_negocios where id = fx('neg')::uuid)
  and (select status from a1_fin_comissoes where negocio_id = fx('neg')::uuid and partner_id = 'b0000000-0000-0000-0000-000000000004') = 'cancelada'
  and (select status from a1_fin_comissoes where negocio_id = fx('neg')::uuid and partner_id = 'b0000000-0000-0000-0000-000000000001') = 'paga'
  and not exists (select 1 from a1_fin_lancamentos where negocio_id = fx('neg')::uuid and status = 'aberto'));

-- ─── 7. Com o módulo Venda, o GANHO do lead não duplica ─────────────────────
reset role;
insert into a1_cases (id, tenant_id, module_key, stage_id, client_name, contract_value, broker_name) values
  ('cf100000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','crm','cf500000-0000-0000-0000-000000000001','Lia', 300000, 'Ana');
update a1_cases set stage_id = 'cf500000-0000-0000-0000-000000000002' where id = 'cf100000-0000-0000-0000-000000000001';
select checa('THE CRED tem Venda: lead em GANHO não gera negócio', not exists (select 1 from a1_fin_negocios where origem = 'crm'));

-- ─── 8. Sem Venda (correspondente): GANHO gera, sair cancela, voltar reativa ─
set role anon;
select teste_entrar('tk-outro');
select a1_fin_iniciar();
select checa('regras-modelo do correspondente (banco 1%, CCA 30%, corretor 20%, analista R$ 150)',
  (a1_fin_regras_modelo()->>'regras')::int = 4);
reset role;
insert into a1_cases (id, tenant_id, module_key, stage_id, client_name, contract_value, broker_name) values
  ('cf100000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','crm','cf500000-0000-0000-0000-000000000011','Rui', 300000, 'Zé Corretor');
update a1_cases set stage_id = 'cf500000-0000-0000-0000-000000000012' where id = 'cf100000-0000-0000-0000-000000000002';
set role anon;
select teste_entrar('tk-outro');
select fx_guarda('lead', (select id::text from a1_fin_negocios where origem = 'crm'));
-- banco 1% de 300.000 = 3.000; corretor 20% de 3.000 = 600
select checa('GANHO gera o negócio: empresa 3.000, corretor (Zé, sem cadastro) 600',
  (select valor from a1_fin_comissoes where negocio_id = fx('lead')::uuid and direcao = 'receber') = 3000
  and (select valor = 600 and beneficiario = 'Zé Corretor' and partner_id is null from a1_fin_comissoes
        where negocio_id = fx('lead')::uuid and papel = 'corretor'));
select checa('o negócio do outro cliente começa no NG-0001', (select seq from a1_fin_negocios where id = fx('lead')::uuid) = 1);
reset role;
update a1_cases set stage_id = 'cf500000-0000-0000-0000-000000000013' where id = 'cf100000-0000-0000-0000-000000000002';
set role anon;
select teste_entrar('tk-outro');
select checa('saiu do GANHO (Perdido): negócio cancelado, nada em aberto',
  (select status from a1_fin_negocios where id = fx('lead')::uuid) = 'cancelado'
  and not exists (select 1 from a1_fin_lancamentos where negocio_id = fx('lead')::uuid and status = 'aberto'));
reset role;
update a1_cases set stage_id = 'cf500000-0000-0000-0000-000000000012', contract_value = 400000 where id = 'cf100000-0000-0000-0000-000000000002';
set role anon;
select teste_entrar('tk-outro');
select checa('voltou ao GANHO: o mesmo negócio reativa com o valor novo (4.000 para a empresa)',
  (select status = 'ativo' and valor = 400000 from a1_fin_negocios where id = fx('lead')::uuid)
  and (select count(*) from a1_fin_negocios where origem = 'crm') = 1
  and (select valor from a1_fin_comissoes where negocio_id = fx('lead')::uuid and direcao = 'receber' and status <> 'cancelada') = 4000);

-- ─── 9. Repasse na etapa configurada ────────────────────────────────────────
select checa('etapa de outro módulo não serve de etapa do Repasse',
  tenta($$insert into a1_fin_config (tenant_id, etapa_repasse) values ('22222222-2222-2222-2222-222222222222','cf500000-0000-0000-0000-000000000012')
          on conflict (tenant_id) do update set etapa_repasse = excluded.etapa_repasse$$) like '%referencia_de_outro_cliente%');
update a1_fin_config set etapa_repasse = 'cf500000-0000-0000-0000-000000000022';
reset role;
insert into a1_cases (id, tenant_id, module_key, stage_id, client_name, broker_name, payload) values
  ('cf100000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','repasse','cf500000-0000-0000-0000-000000000021','Sol', 'Zé Corretor',
   '{"valores":{"valor_financiado":"240.000,00","valor_contrato":"300.000,00"}}');
update a1_cases set stage_id = 'cf500000-0000-0000-0000-000000000022' where id = 'cf100000-0000-0000-0000-000000000003';
set role anon;
select teste_entrar('tk-outro');
select checa('Repasse assinado gera o negócio do correspondente: 1% de 240.000 (financiado, formato 240.000,00) = 2.400',
  (select n.valor = 300000 and n.valor_financiado = 240000 and n.assinado_em = current_date
          and c.valor = 2400 from a1_fin_negocios n join a1_fin_comissoes c on c.negocio_id = n.id and c.direcao = 'receber'
    where n.origem = 'repasse'));

-- ─── 10. Regra mais específica e liberação na assinatura (THE CRED) ─────────
select teste_entrar('tk-gestor');
insert into a1_fin_regras (tenant_id, nome, direcao, papel, base, percentual, partner_id, liberacao) values
  ('11111111-1111-1111-1111-111111111111', 'Ana: 50% (acordo dela)', 'pagar', 'corretor', 'comissao_empresa', 50,
   'b0000000-0000-0000-0000-000000000001', 'recebimento'),
  ('11111111-1111-1111-1111-111111111111', 'CCA: 1% da venda na assinatura', 'pagar', 'cca', 'valor', 1, null, 'assinatura');
select fx_guarda('man', (a1_fin_salvar_negocio(null, '{"descricao":"Venda direta","valor":200000}'::jsonb,
  '[{"papel":"corretor","partner_id":"b0000000-0000-0000-0000-000000000001"},{"papel":"corretor","partner_id":"b0000000-0000-0000-0000-000000000002"},{"papel":"captador","nome":"Caio Captador"}]'::jsonb)->>'id'));
-- empresa 5% de 200.000 = 10.000; Ana 50% = 5.000 (regra dela); Bruno 40% = 4.000; captador 10% = 1.000
select checa('regra do parceiro vence a geral: Ana 5.000 (50%), Bruno 4.000 (40%), captador 1.000',
  (select valor from a1_fin_comissoes where negocio_id = fx('man')::uuid and partner_id = 'b0000000-0000-0000-0000-000000000001') = 5000
  and (select valor from a1_fin_comissoes where negocio_id = fx('man')::uuid and partner_id = 'b0000000-0000-0000-0000-000000000002') = 4000
  and (select valor from a1_fin_comissoes where negocio_id = fx('man')::uuid and papel = 'captador') = 1000
  and (select regra_nome from a1_fin_comissoes where negocio_id = fx('man')::uuid and partner_id = 'b0000000-0000-0000-0000-000000000001') = 'Ana: 50% (acordo dela)');
select checa('negócio à mão segue a sequência (NG-0002)', (select seq from a1_fin_negocios where id = fx('man')::uuid) = 2);
select checa('liberar à mão uma comissão "ao receber" cria a conta a pagar dela',
  tenta(format($$select a1_fin_liberar_comissao(%L)$$, (select id from a1_fin_comissoes where negocio_id = fx('man')::uuid and papel = 'captador'))) is null);
select checa('(e ela fica liberada por inteiro)',
  (select valor_liberado = 1000 and status = 'liberada' from a1_fin_comissoes where negocio_id = fx('man')::uuid and papel = 'captador'));
reset role;
insert into a1_comerciais (id, tenant_id, situacao_id, corretor_id, correspondente_id, unidade, proposta) values
  ('cf700000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','5c000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000005', 'B1-301', '{"valor_venda": 30000000}');
select set_config('a1.orquestrador', '1', false);
update a1_comerciais set situacao_id = '5c000000-0000-0000-0000-000000000003' where id = 'cf700000-0000-0000-0000-000000000003';
select set_config('a1.orquestrador', '', false);
select fx_guarda('ass', (select id::text from a1_fin_negocios where origem_id = 'cf700000-0000-0000-0000-000000000003'));
select checa('CCA (Eva) 3.000 prevista: libera na assinatura',
  (select valor = 3000 and status = 'prevista' and valor_liberado = 0 from a1_fin_comissoes where negocio_id = fx('ass')::uuid and papel = 'cca'));
insert into a1_fin_config (tenant_id, etapa_repasse) values ('11111111-1111-1111-1111-111111111111','cf500000-0000-0000-0000-000000000031')
  on conflict (tenant_id) do update set etapa_repasse = excluded.etapa_repasse;
insert into a1_cases (id, tenant_id, module_key, stage_id, client_name, payload) values
  ('cf100000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','repasse','cf500000-0000-0000-0000-000000000031','Gil',
   '{"comercial_id":"cf700000-0000-0000-0000-000000000003","valores":{"valor_financiado":"210.000,00"}}');
select checa('o repasse da venda chega na etapa de assinatura: a CCA libera, sem negócio novo',
  (select valor_liberado = 3000 and status = 'liberada' from a1_fin_comissoes where negocio_id = fx('ass')::uuid and papel = 'cca')
  and (select assinado_em = current_date and valor_financiado = 210000 from a1_fin_negocios where id = fx('ass')::uuid)
  and not exists (select 1 from a1_fin_negocios where tenant_id = '11111111-1111-1111-1111-111111111111' and origem = 'repasse'));

-- ─── 11. Locação: taxa de administração ─────────────────────────────────────
set role anon;
select teste_entrar('tk-gestor');
select fx_guarda('cob', (select b.id::text from a1_lc_cobrancas b join a1_lc_contratos c on c.id = b.contrato_id
                           where c.status = 'ativo' and b.status = 'aberta' order by b.vencimento limit 1));
select fx_guarda('cobv', (select versao::text from a1_lc_cobrancas where id = fx('cob')::uuid));
select a1_lc_baixar_cobranca(fx('cob')::uuid, current_date, 'pix', fx('cobv')::int);
select checa('baixa na Locação lança a taxa de administração como receita recebida',
  (select count(*) > 0 and bool_and(status = 'pago' and tipo = 'receber')
     and sum(valor) = (select sum(taxa_adm) from a1_lc_repasses where cobranca_id = fx('cob')::uuid)
     from a1_fin_lancamentos where origem = 'locacao'
      and origem_id in (select id from a1_lc_repasses where cobranca_id = fx('cob')::uuid)));
select checa('estorno do lançamento da Locação só pela Locação',
  tenta(format($$select a1_fin_estornar(%L, 1)$$, (select id from a1_fin_lancamentos where origem = 'locacao' limit 1))) like '%estorne_na_locacao%');
select a1_lc_estornar_cobranca(fx('cob')::uuid, fx('cobv')::int + 1);
select checa('estorno da cobrança tira a receita', not exists (select 1 from a1_fin_lancamentos where origem = 'locacao'));

-- ─── 12. Lançamento manual ──────────────────────────────────────────────────
select fx_guarda('t', coalesce(tenta($$insert into a1_fin_lancamentos (tenant_id, tipo, descricao, valor, vencimento, categoria_id)
  values ('11111111-1111-1111-1111-111111111111', 'pagar', 'Aluguel do escritório', 3500, current_date,
          (select id from a1_fin_categorias where chave = 'ocupacao'))$$), 'ok'));
select checa('despesa manual em aberto entra pela tabela', fx('t') = 'ok');
select checa('lançamento já pago não entra pela tabela',
  tenta($$insert into a1_fin_lancamentos (tenant_id, tipo, descricao, valor, vencimento, status, pago_em, valor_pago)
          values ('11111111-1111-1111-1111-111111111111', 'pagar', 'Fura', 10, current_date, 'pago', current_date, 10)$$) like '%row-level security%');
select checa('categoria de outro cliente é recusada',
  tenta($$insert into a1_fin_lancamentos (tenant_id, tipo, descricao, valor, vencimento, categoria_id)
          values ('11111111-1111-1111-1111-111111111111', 'pagar', 'X', 10, current_date,
                  (select id from a1_fin_categorias where tenant_id = '22222222-2222-2222-2222-222222222222' limit 1))$$) is not null);
select fx_guarda('manl', (select id::text from a1_fin_lancamentos where descricao = 'Aluguel do escritório'));
select checa('baixa com valor maior que o lançamento é recusada', tenta(format($$select a1_fin_baixar(%L, current_date, 9999, null, 'pix', 1)$$, fx('manl'))) like '%valor_invalido%');
select checa('baixa com data futura é recusada', tenta(format($$select a1_fin_baixar(%L, current_date + 5, 3500, null, 'pix', 1)$$, fx('manl'))) like '%data_invalida%');
select a1_fin_baixar(fx('manl')::uuid, current_date, 3500, null, 'boleto', 1);
select checa('pago, vai para a conta padrão', (select status = 'pago' and conta_id = (select conta_padrao from a1_fin_config) from a1_fin_lancamentos where id = fx('manl')::uuid));
select checa('versão velha no estorno é recusada', tenta(format($$select a1_fin_estornar(%L, 1)$$, fx('manl'))) like '%versao_desatualizada%');

-- ─── 13. Quem não pode ──────────────────────────────────────────────────────
select teste_entrar('tk-ana');
select checa('corretora sem permissão não lê as tabelas do Financeiro',
  (select count(*) from a1_fin_comissoes) = 0 and (select count(*) from a1_fin_lancamentos) = 0 and (select count(*) from a1_fin_negocios) = 0);
select checa('corretora não chama as funções de gestão', tenta('select a1_fin_iniciar()') like '%sem_permissao%');
select fx_guarda('minhas', a1_fin_minhas_comissoes()::text);
select checa('extrato da Ana: só as comissões dela (venda paga + venda direta)',
  json_array_length(fx('minhas')::json) = 2
  and (select bool_and(x->>'papel' = 'corretor') from json_array_elements(fx('minhas')::json) x)
  and fx('minhas') not like '%Diego%' and fx('minhas') not like '%Caio%');
select teste_entrar('tk-outro');
select checa('outro cliente não vê os negócios de THE CRED', (select count(*) from a1_fin_negocios where tenant_id = '11111111-1111-1111-1111-111111111111') = 0);
select checa('nem baixa lançamento de THE CRED', tenta(format($$select a1_fin_baixar(%L, current_date, 1, null, 'pix', 2)$$, fx('manl'))) like '%lancamento_nao_encontrado%');

-- =============================================================================
reset role;
\o
select n, case when passou then 'ok  ' else 'FALHOU' end as r, descr, coalesce(detalhe,'') as detalhe from prova order by n;
select count(*) filter (where passou) as passaram, count(*) filter (where not passou) as falharam, count(*) as total from prova;
do $$
declare f int;
begin
  select count(*) into f from prova where not passou;
  if f > 0 then raise exception 'PROVA DO FINANCEIRO REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DO FINANCEIRO APROVADA';
end $$;
drop function fx_guarda(text, text);
drop function fx(text);
drop table fin_teste;
