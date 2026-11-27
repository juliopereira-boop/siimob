-- =============================================================================
-- PROVA: MÓDULO FINANCEIRO (fase 2) · carteira, lembretes, OFX e DRE
-- Roda depois da prova da fase 1, no mesmo banco (THE CRED 111 com licença,
-- Venda e as situações 5c..01 inicial, 03 VENDIDO, 04 distrato).
-- Confere: com a carteira desligada a venda não gera carteira; ligada, a venda
-- VENDIDO gera a carteira com as parcelas da proposta e do crédito, ligada ao
-- negócio; correção INCC até as chaves e IGP-M + juros depois, negativo
-- zerado, multa e mora pro rata; baixa exige o valor certo e entra no caixa;
-- estorno volta; renegociação; distrato e volta; importar vendas antigas;
-- quitação; lembretes devidos e não repetidos; OFX sem repetir linha,
-- sugestão, conciliação (lançamento, parcela, automática), lançamento novo,
-- desfazer e ignorar; DRE por caixa e competência com orçamento e centro de
-- custo; quem não pode não vê; dado de outro cliente não entra.
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;
create table if not exists f2_teste (k text primary key, v text);
truncate f2_teste;
grant select, insert, update on f2_teste to anon, service_role;
create or replace function f2(k text) returns text language sql as $$ select v from f2_teste where f2_teste.k = f2.k $$;
grant execute on function f2(text) to anon, service_role;
create or replace function f2_guarda(k text, v text) returns void language sql as $$
  insert into f2_teste values (k, v) on conflict (k) do update set v = excluded.v $$;
grant execute on function f2_guarda(text, text) to anon, service_role;
grant insert, select on prova to service_role;
grant usage, select on sequence prova_n_seq to service_role;
grant execute on function checa(text, boolean, text) to service_role;
grant execute on function tenta(text) to service_role;

\o /dev/null
reset role;
-- índices de teste (anos que não colidem com a prova da Locação)
insert into a1_lc_indices (indice, mes, valor) values
  ('INCC', '2031-02-01', 1.0), ('INCC', '2031-03-01', 2.0), ('INCC', '2031-04-01', 5.0),
  ('IGPM', '2031-04-01', 0.5), ('IGPM', '2031-05-01', -1.0)
on conflict (indice, mes) do update set valor = excluded.valor;

-- ─── 1. Índices e configuração ──────────────────────────────────────────────
select checa('a tabela de índices aceita INCC e INCC-M', tenta($$insert into a1_lc_indices (indice, mes, valor) values ('INCCM', '2031-01-01', 0.3) on conflict do nothing$$) is null);
select checa('e recusa índice inventado', tenta($$insert into a1_lc_indices (indice, mes, valor) values ('XPTO', '2031-01-01', 1)$$) like '%a1_lc_indices_indice_ck%');
select checa('fator do INCC fev e mar/2031 = 1,01 × 1,02', round(a1_fin_fator('INCC', '2031-01-01', '2031-03-01'), 6) = round(1.01 * 1.02, 6));
select checa('IGP-M negativo conta zero (padrão) ou entra (se pedir)',
  a1_fin_fator('IGPM', '2031-04-01', '2031-05-01', true) = 1 and round(a1_fin_fator('IGPM', '2031-04-01', '2031-05-01', false), 6) = 0.99);
select checa('a carteira e o lembrete nascem desligados para quem já tinha configuração',
  not exists (select 1 from a1_fin_config where carteira_ativa or lembrete_ativo));

-- ─── 2. Carteira desligada: a venda não gera carteira ──────────────────────
insert into a1_comerciais (id, tenant_id, situacao_id, corretor_id, empreendimento_id, unidade, proposta, origem_snapshot) values
  ('cf200000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','5c000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'B1-001',
   jsonb_build_object('valor_venda', 22800000, 'condicoes_pagamento', jsonb_build_array(
     jsonb_build_object('tipo', 'ATO', 'quantidade', 1, 'valor', 500000, 'vencimento_inicial', current_date::text),
     jsonb_build_object('tipo', 'MENSAL', 'quantidade', 3, 'valor', 100000, 'vencimento_inicial', (current_date + 30)::text),
     jsonb_build_object('tipo', 'INTERMEDIARIA', 'quantidade', 2, 'valor', 1234567, 'vencimento_inicial', (current_date + 60)::text))),
   jsonb_build_object('participantes', jsonb_build_array(jsonb_build_object('papel', 'TITULAR', 'nome', 'Joana Compradora', 'documento', '123.456.789-09')),
     'fluxo', jsonb_build_array(jsonb_build_object('serie', 'FINANCIAMENTO', 'nome', 'Financiamento CEF', 'valor', 200000, 'quantidade', 1, 'quem_paga', 'BANCO')))),
  ('cf200000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','5c000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'B1-002',
   '{"valor_venda": 800000, "valor_entrada": 800000}', '{"cliente_nome": "Pedro Antigo"}');
select set_config('a1.orquestrador', '1', false);
update a1_comerciais set situacao_id = '5c000000-0000-0000-0000-000000000003' where id = 'cf200000-0000-0000-0000-000000000002';
select set_config('a1.orquestrador', '', false);
select checa('com a carteira desligada, VENDIDO não gera carteira', not exists (select 1 from a1_fin_carteiras));

-- ─── 3. Carteira ligada: VENDIDO gera a carteira ───────────────────────────
update a1_fin_config set carteira_ativa = true where tenant_id = '11111111-1111-1111-1111-111111111111';
insert into a1_fin_carteira_cfg (tenant_id, empreendimento_id, data_chaves, juros_pos_am)
values ('11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001', current_date + 365, 1);
select set_config('a1.orquestrador', '1', false);
update a1_comerciais set situacao_id = '5c000000-0000-0000-0000-000000000003' where id = 'cf200000-0000-0000-0000-000000000001';
select set_config('a1.orquestrador', '', false);
select f2_guarda('cart', (select id::text from a1_fin_carteiras where comercial_id = 'cf200000-0000-0000-0000-000000000001'));
select checa('VENDIDO gera a carteira CR-0001 do cliente, com o empreendimento e as regras dele',
  (select seq = 1 and cliente_nome = 'Joana Compradora' and cliente_doc = '12345678909' and empreendimento = 'Residencial das Flores'
          and unidade = 'B1-001' and indice_obra = 'INCC' and indice_pos = 'IGPM' and juros_pos_am = 1 and data_chaves = current_date + 365
     from a1_fin_carteiras where id = f2('cart')::uuid));
select checa('a carteira fica ligada ao negócio da venda (o negócio nasce antes)',
  (select negocio_id is not null from a1_fin_carteiras where id = f2('cart')::uuid)
  and (select negocio_id from a1_fin_carteiras where id = f2('cart')::uuid)
      = (select id from a1_fin_negocios where origem = 'comercial' and origem_id = 'cf200000-0000-0000-0000-000000000001'));
select checa('7 parcelas: ato, 3 mensais, 2 intermediárias (semestrais) e o financiamento do banco nas chaves',
  (select count(*) from a1_fin_parcelas where carteira_id = f2('cart')::uuid) = 7
  and (select count(*) from a1_fin_parcelas where carteira_id = f2('cart')::uuid and serie = 'MENSAL') = 3
  and (select max(vencimento) - min(vencimento) from a1_fin_parcelas where carteira_id = f2('cart')::uuid and serie = 'MENSAL')
      = ((current_date + 30) + interval '2 months')::date - (current_date + 30)
  and (select max(vencimento) from a1_fin_parcelas where carteira_id = f2('cart')::uuid and serie = 'INTERMEDIARIA')
      = ((current_date + 60) + interval '6 months')::date
  and (select quem_paga = 'BANCO' and valor = 200000 and vencimento = current_date + 365 from a1_fin_parcelas
        where carteira_id = f2('cart')::uuid and serie = 'FINANCIAMENTO'));
select checa('valor total da carteira = soma das parcelas (R$ 232.691,34)', (select valor_total = 232691.34 from a1_fin_carteiras where id = f2('cart')::uuid));

-- ─── 4. Correção, multa e mora ──────────────────────────────────────────────
set role anon;
select teste_entrar('tk-gestor');
select f2_guarda('c2031', (a1_fin_carteira_salvar(null, '{"cliente_nome":"Teste Índice","data_base":"2031-01-01","data_chaves":"2031-03-10","juros_pos_am":0.5}'::jsonb,
  '[{"serie":"MENSAL","vencimento":"2031-06-05","valor":1000},{"serie":"FINANCIAMENTO","vencimento":"2031-06-05","valor":5000,"quem_paga":"BANCO"}]'::jsonb)->>'id'));
reset role;
select f2_guarda('calc', a1_fin_parcela_calc((select id from a1_fin_parcelas where carteira_id = f2('c2031')::uuid and serie = 'MENSAL'), '2031-06-10')::text);
-- base jan; ref = mai (1 mês de defasagem); INCC fev+mar (até as chaves), IGP-M abr (0,5) e mai (−1 → 0), juros 0,5% × 2 meses
select checa('correção: INCC até as chaves, IGP-M + juros depois, negativo zerado',
  (f2('calc')::jsonb->>'corrigido')::numeric = round(1000 * 1.01 * 1.02 * 1.005 * power(1.005, 2), 2), f2('calc'));
select checa('5 dias de atraso: multa 2% e mora de 1% ao mês pro rata',
  (f2('calc')::jsonb->>'dias_atraso')::int = 5
  and (f2('calc')::jsonb->>'multa')::numeric = round((f2('calc')::jsonb->>'corrigido')::numeric * 0.02, 2)
  and (f2('calc')::jsonb->>'juros')::numeric = round((f2('calc')::jsonb->>'corrigido')::numeric * 0.01 / 30 * 5, 2), f2('calc'));
select f2_guarda('calcb', a1_fin_parcela_calc((select id from a1_fin_parcelas where carteira_id = f2('c2031')::uuid and serie = 'FINANCIAMENTO'), '2031-06-10')::text);
select checa('parcela do banco não corrige nem tem mora', (f2('calcb')::jsonb->>'total')::numeric = 5000, f2('calcb'));

-- ─── 5. Baixa e estorno ─────────────────────────────────────────────────────
set role anon;
select teste_entrar('tk-gestor');
select f2_guarda('ato', (select id::text from a1_fin_parcelas where carteira_id = f2('cart')::uuid and serie = 'ATO'));
select checa('baixa com valor errado é recusada e diz o valor esperado',
  tenta(format($$select a1_fin_parcela_baixar(%L, current_date, 4000, null, 'pix', 0, 1)$$, f2('ato'))) like '%valor_diferente%5000.00%');
select checa('versão velha é recusada', tenta(format($$select a1_fin_parcela_baixar(%L, current_date, 5000, null, 'pix', 0, 9)$$, f2('ato'))) like '%versao_desatualizada%');
select a1_fin_parcela_baixar(f2('ato')::uuid, current_date, 5000, null, 'pix', 0, 1);
select checa('a baixa marca a parcela paga e lança a receita recebida (venda de unidade) no caixa',
  (select status = 'paga' and valor_pago = 5000 and lancamento_id is not null from a1_fin_parcelas where id = f2('ato')::uuid)
  and exists (select 1 from a1_fin_lancamentos l join a1_fin_categorias c on c.id = l.categoria_id
               where l.origem = 'carteira' and l.origem_id = f2('ato')::uuid and l.status = 'pago' and l.valor_pago = 5000
                 and l.tipo = 'receber' and c.chave = 'venda_unidade'));
select checa('lançamento da carteira não se mexe pela tabela',
  tenta(format($$update a1_fin_lancamentos set valor = 1 where origem_id = %L$$, f2('ato'))) is null
  and (select valor = 5000 from a1_fin_lancamentos where origem = 'carteira' and origem_id = f2('ato')::uuid));
select checa('nem a parcela', tenta(format($$update a1_fin_parcelas set valor = 1 where id = %L$$, f2('ato'))) like '%permission denied%');
select a1_fin_parcela_estornar(f2('ato')::uuid, 2);
select checa('estorno: a parcela volta aberta e a receita sai do caixa',
  (select status = 'aberta' and pago_em is null and lancamento_id is null from a1_fin_parcelas where id = f2('ato')::uuid)
  and not exists (select 1 from a1_fin_lancamentos where origem = 'carteira' and origem_id = f2('ato')::uuid));
select a1_fin_parcela_baixar(f2('ato')::uuid, current_date, 4900, null, 'pix', 100, 3);
select checa('baixa com desconto: o valor pago é o total menos o desconto',
  (select status = 'paga' and valor_pago = 4900 and desconto = 100 from a1_fin_parcelas where id = f2('ato')::uuid));

-- ─── 6. Renegociação ────────────────────────────────────────────────────────
select f2_guarda('mens', (select string_agg(id::text, ',' order by numero) from (select id, numero from a1_fin_parcelas
  where carteira_id = f2('cart')::uuid and serie = 'MENSAL' order by numero limit 2) x));
select checa('renegociar exige motivo', tenta(format($$select a1_fin_renegociar(%L, %L::uuid[], '[{"vencimento":"2030-01-10","valor":500,"quantidade":4}]', '')$$,
  f2('cart'), '{' || f2('mens') || '}')) like '%motivo_obrigatorio%');
select checa('parcela paga não se renegocia', tenta(format($$select a1_fin_renegociar(%L, %L::uuid[], '[{"vencimento":"2030-01-10","valor":500}]', 'x')$$,
  f2('cart'), '{' || f2('ato') || '}')) like '%parcelas_invalidas%');
select f2_guarda('reneg', a1_fin_renegociar(f2('cart')::uuid, ('{' || f2('mens') || '}')::uuid[],
  jsonb_build_array(jsonb_build_object('vencimento', (current_date + 40)::text, 'valor', 500, 'quantidade', 4)), 'Cliente pediu prazo')::text);
select checa('renegociação: as 2 mensais viram renegociadas e entram 4 de R$ 500 corrigidas a partir deste mês',
  (f2('reneg')::jsonb->>'novas')::int = 4
  and (select count(*) from a1_fin_parcelas where carteira_id = f2('cart')::uuid and status = 'renegociada') = 2
  and (select count(*) from a1_fin_parcelas where carteira_id = f2('cart')::uuid and serie = 'RENEGOCIACAO'
         and base_mes = date_trunc('month', current_date)::date and valor = 500) = 4
  and (select max(numero) from a1_fin_parcelas where carteira_id = f2('cart')::uuid) = 11);

-- ─── 7. Lista com totais ────────────────────────────────────────────────────
select f2_guarda('res', (select row_to_json(r)::text from a1_fin_carteiras_resumo(current_date) r where carteira_id = f2('cart')::uuid));
select checa('resumo: recebido 4.900; a receber = abertas (1 mensal + 2 intermediárias + 4 renegociadas + banco)',
  (f2('res')::jsonb->>'recebido')::numeric = 4900
  and (f2('res')::jsonb->>'a_receber')::numeric = 1000 + 24691.34 + 2000 + 200000
  and (f2('res')::jsonb->>'parcelas_abertas')::int = 8, f2('res'));
select checa('a tela lê as parcelas com o valor de hoje',
  (select count(*) from a1_fin_carteira_parcelas(f2('cart')::uuid, current_date) where calc is not null) = 9);

-- ─── 8. Distrato e volta ────────────────────────────────────────────────────
reset role;
select set_config('a1.orquestrador', '1', false);
update a1_comerciais set situacao_id = '5c000000-0000-0000-0000-000000000004' where id = 'cf200000-0000-0000-0000-000000000001';
select set_config('a1.orquestrador', '', false);
select checa('distrato: carteira distratada, o aberto cancela, o pago fica',
  (select status = 'distratada' from a1_fin_carteiras where id = f2('cart')::uuid)
  and not exists (select 1 from a1_fin_parcelas where carteira_id = f2('cart')::uuid and status = 'aberta')
  and (select count(*) from a1_fin_parcelas where carteira_id = f2('cart')::uuid and status = 'cancelada' and motivo = 'distrato') = 8
  and (select status = 'paga' from a1_fin_parcelas where id = f2('ato')::uuid));
select set_config('a1.orquestrador', '1', false);
update a1_comerciais set situacao_id = '5c000000-0000-0000-0000-000000000003' where id = 'cf200000-0000-0000-0000-000000000001';
select set_config('a1.orquestrador', '', false);
select checa('voltou a VENDIDO: a mesma carteira reabre (sem duplicar)',
  (select count(*) from a1_fin_carteiras where comercial_id = 'cf200000-0000-0000-0000-000000000001') = 1
  and (select status = 'ativa' from a1_fin_carteiras where id = f2('cart')::uuid)
  and (select count(*) from a1_fin_parcelas where carteira_id = f2('cart')::uuid and status = 'aberta') = 8);

-- ─── 9. Vendas antigas e quitação ───────────────────────────────────────────
set role anon;
select teste_entrar('tk-gestor');
select f2_guarda('imp', a1_fin_carteira_importar()::text);
select checa('importar: a venda que já estava em VENDIDO ganha a carteira (a entrada vira o ato)',
  (f2('imp')::jsonb->>'carteiras')::int >= 1
  and (select count(*) from a1_fin_parcelas p join a1_fin_carteiras c on c.id = p.carteira_id
        where c.comercial_id = 'cf200000-0000-0000-0000-000000000002' and p.serie = 'ATO' and p.valor = 8000) = 1);
select checa('importar de novo não duplica', (a1_fin_carteira_importar()->>'carteiras')::int = 0);
select f2_guarda('ped', (select id::text from a1_fin_parcelas p where p.carteira_id = (select id from a1_fin_carteiras where comercial_id = 'cf200000-0000-0000-0000-000000000002')));
select a1_fin_parcela_baixar(f2('ped')::uuid, current_date, 8000, null, 'pix', 0, 1);
select checa('última parcela paga: carteira quitada',
  (select status = 'quitada' from a1_fin_carteiras where comercial_id = 'cf200000-0000-0000-0000-000000000002'));

-- ─── 10. Lembretes ──────────────────────────────────────────────────────────
reset role;
update a1_fin_config set lembrete_ativo = true, lembrete_modelo = '{"nome":"lembrete_parcela","idioma":"pt_BR","corpo":"Olá {{1}}, sua parcela de {{2}} vence em {{3}}."}'
 where tenant_id = '11111111-1111-1111-1111-111111111111';
update a1_fin_carteiras set telefone = '5598981234567' where id = f2('cart')::uuid;
update a1_fin_parcelas set vencimento = current_date + 3 where id = (select id from a1_fin_parcelas where carteira_id = f2('cart')::uuid and serie = 'RENEGOCIACAO' order by numero limit 1);
set role service_role;
select f2_guarda('dev', (select json_agg(d)::text from a1_fin_lembretes_devidos(50) d));
select checa('lembrete devido: D-3 da parcela, com telefone, total e o modelo',
  json_array_length(f2('dev')::json) = 1 and f2('dev')::json->0->>'gatilho' = 'D-3'
  and f2('dev')::json->0->>'telefone' = '5598981234567' and f2('dev')::json->0->'modelo'->>'nome' = 'lembrete_parcela', f2('dev'));
select a1_fin_lembrete_registrar('11111111-1111-1111-1111-111111111111', (f2('dev')::json->0->>'parcela_id')::uuid, 'D-3', 'oficial', true, null);
select checa('lembrete já enviado não volta', not exists (select 1 from a1_fin_lembretes_devidos(50)));
reset role;
update a1_fin_carteiras set lembretes = false where id = f2('cart')::uuid;
update a1_fin_parcelas set vencimento = current_date where id = (select id from a1_fin_parcelas where carteira_id = f2('cart')::uuid and serie = 'RENEGOCIACAO' order by numero offset 1 limit 1);
set role service_role;
select checa('carteira com lembrete desligado não recebe', not exists (select 1 from a1_fin_lembretes_devidos(50)));
set role anon;
select teste_entrar('tk-gestor');
select checa('o navegador não puxa a lista de lembretes', tenta('select * from a1_fin_lembretes_devidos(10)') like '%permission denied%');
select checa('nem confere código do disparo', tenta($$select a1_fin_lembrete_codigo_valido('x')$$) like '%permission denied%');
select checa('nem dispara os lembretes', tenta($$select a1_fin_lembretes_disparar()$$) like '%permission denied%');
reset role;
insert into a1_fin_lembrete_chamadas (codigo) values ('cod-bom'), ('cod-velho');
update a1_fin_lembrete_chamadas set criado_em = now() - interval '11 minutes' where codigo = 'cod-velho';
set role service_role;
select f2_guarda('c1', a1_fin_lembrete_codigo_valido('cod-bom')::text);
select f2_guarda('c2', a1_fin_lembrete_codigo_valido('cod-bom')::text);
select f2_guarda('c3', a1_fin_lembrete_codigo_valido('cod-velho')::text);
select f2_guarda('c4', a1_fin_lembrete_codigo_valido('inventado')::text);
select checa('código do disparo vale uma vez só', f2('c1') = 'true' and f2('c2') = 'false');
select checa('código vencido (mais de 10 min) ou inventado não vale', f2('c3') = 'false' and f2('c4') = 'false');
set role anon;
select teste_entrar('tk-gestor');

-- ─── 11. Conciliação (OFX) ──────────────────────────────────────────────────
select f2_guarda('conta', (select id::text from a1_fin_contas order by criado_em limit 1));
insert into a1_fin_lancamentos (tenant_id, tipo, descricao, valor, vencimento)
values ('11111111-1111-1111-1111-111111111111', 'receber', 'Honorários avulsos', 150, current_date - 2);
select f2_guarda('lman', (select id::text from a1_fin_lancamentos where descricao = 'Honorários avulsos'));
select f2_guarda('intp', (select id::text from a1_fin_parcelas where carteira_id = f2('cart')::uuid and serie = 'INTERMEDIARIA' order by numero limit 1));
reset role;
update a1_fin_parcelas set vencimento = current_date where id = f2('intp')::uuid;
set role anon;
select teste_entrar('tk-gestor');
select f2_guarda('imp1', a1_fin_extrato_importar(f2('conta')::uuid, 'extrato.ofx', jsonb_build_array(
  jsonb_build_object('fitid', 'A1', 'data', current_date::text, 'valor', 150, 'descricao', 'PIX RECEBIDO'),
  jsonb_build_object('fitid', 'A2', 'data', current_date::text, 'valor', 12345.67, 'descricao', 'TED JOANA'),
  jsonb_build_object('fitid', 'A3', 'data', current_date::text, 'valor', -39.9, 'descricao', 'TARIFA PACOTE')))::text);
select checa('importa 3 linhas novas', (f2('imp1')::jsonb->>'novos')::int = 3);
select checa('o mesmo extrato de novo não repete linha',
  (a1_fin_extrato_importar(f2('conta')::uuid, 'extrato.ofx', '[{"fitid":"A1","data":"2026-01-01","valor":150}]')->>'repetidos')::int = 1);
select f2_guarda('it1', (select id::text from a1_fin_extrato_itens where fitid = 'A1'));
select f2_guarda('it2', (select id::text from a1_fin_extrato_itens where fitid = 'A2'));
select f2_guarda('it3', (select id::text from a1_fin_extrato_itens where fitid = 'A3'));
select checa('sugestão: o lançamento aberto de mesmo valor e sentido', exists (select 1 from a1_fin_extrato_sugestoes(f2('it1')::uuid) s where s.id = f2('lman')::uuid));
select checa('sentido trocado é recusado', tenta(format($$select a1_fin_extrato_conciliar(%L, %L, null)$$, f2('it3'), f2('lman'))) like '%sentido_diferente%');
select a1_fin_extrato_conciliar(f2('it1')::uuid, f2('lman')::uuid, null);
select checa('conciliar o lançamento aberto faz a baixa na data e na conta do extrato',
  (select status = 'pago' and pago_em = current_date and conta_id = f2('conta')::uuid from a1_fin_lancamentos where id = f2('lman')::uuid)
  and (select status = 'conciliado' and lancamento_id = f2('lman')::uuid from a1_fin_extrato_itens where id = f2('it1')::uuid));
select checa('a parcela intermediária aparece como sugestão da TED (valor na data bate)',
  exists (select 1 from a1_fin_extrato_sugestoes(f2('it2')::uuid) s where s.tipo = 'parcela' and s.id = f2('intp')::uuid));
select f2_guarda('sug2', (select json_agg(x)::text from a1_fin_extrato_sugestoes(f2('it2')::uuid) x));
select f2_guarda('auto', a1_fin_extrato_conciliar_auto(f2('conta')::uuid)::text);
select checa('conciliação automática baixa a parcela única candidata',
  (f2('auto')::jsonb->>'conciliados')::int = 1
  and (select status = 'paga' and pago_em = current_date from a1_fin_parcelas where id = f2('intp')::uuid)
  and (select status = 'conciliado' and parcela_id = f2('intp')::uuid from a1_fin_extrato_itens where id = f2('it2')::uuid), f2('auto') || ' ' || f2('sug2'));
select f2_guarda('cat', (select id::text from a1_fin_categorias where chave = 'administrativas'));
select a1_fin_extrato_criar_lancamento(f2('it3')::uuid, 'Tarifa bancária', f2('cat')::uuid, null);
select checa('linha sem par vira lançamento pago (despesa) já conciliado',
  exists (select 1 from a1_fin_lancamentos where origem = 'extrato' and origem_id = f2('it3')::uuid and tipo = 'pagar' and valor_pago = 39.9 and status = 'pago'));
select a1_fin_extrato_marcar(f2('it3')::uuid, 'desfazer');
select checa('desfazer: a linha volta pendente e o lançamento criado por ela some',
  (select status = 'pendente' from a1_fin_extrato_itens where id = f2('it3')::uuid)
  and not exists (select 1 from a1_fin_lancamentos where origem = 'extrato' and origem_id = f2('it3')::uuid));
select a1_fin_extrato_marcar(f2('it3')::uuid, 'ignorar');
select checa('ignorar', (select status = 'ignorado' from a1_fin_extrato_itens where id = f2('it3')::uuid));
select f2_guarda('vint', (select versao::text from a1_fin_parcelas where id = f2('intp')::uuid));
select f2_guarda('est', coalesce(tenta(format($$select a1_fin_parcela_estornar(%L, %s)$$, f2('intp'), f2('vint'))), 'ok'));
select checa('estornar a parcela conciliada devolve a linha do extrato para pendente',
  f2('est') = 'ok'
  and (select status = 'pendente' and parcela_id is null from a1_fin_extrato_itens where id = f2('it2')::uuid), f2('est'));

-- ─── 12. DRE, orçamento e centro de custo ───────────────────────────────────
insert into a1_fin_centros (tenant_id, nome, tipo, empreendimento_id)
values ('11111111-1111-1111-1111-111111111111', 'Residencial das Flores', 'empreendimento', 'd1000000-0000-0000-0000-000000000001');
select f2_guarda('centro', (select id::text from a1_fin_centros where nome = 'Residencial das Flores'));
insert into a1_fin_lancamentos (tenant_id, tipo, descricao, valor, vencimento, categoria_id, centro_id)
values ('11111111-1111-1111-1111-111111111111', 'pagar', 'ISS do mês', 300, current_date,
        (select id from a1_fin_categorias where chave = 'impostos'), f2('centro')::uuid);
insert into a1_fin_orcamentos (tenant_id, categoria_id, mes, valor)
values ('11111111-1111-1111-1111-111111111111', (select id from a1_fin_categorias where chave = 'venda_unidade'), date_trunc('month', current_date)::date, 50000);
select f2_guarda('dre', (select json_agg(d)::text from a1_fin_dre(date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, null, 'caixa') d));
select checa('DRE por caixa: venda de unidade recebida (4.900 + 8.000; a intermediária foi estornada) com o orçado de 50.000',
  exists (select 1 from json_array_elements(f2('dre')::json) x where x->>'categoria' = 'Venda de unidade' and x->>'grupo' = 'receita'
           and (x->>'realizado')::numeric = 12900 and (x->>'orcado')::numeric = 50000), f2('dre'));
select f2_guarda('drec', (select json_agg(d)::text from a1_fin_dre(date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, null, 'competencia') d));
select checa('DRE por competência: imposto entra como dedução mesmo em aberto',
  exists (select 1 from json_array_elements(f2('drec')::json) x where x->>'grupo' = 'deducao' and (x->>'realizado')::numeric = 300), f2('drec'));
select checa('filtro por centro de custo: só o que é do centro',
  (select count(*) from a1_fin_dre(date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, f2('centro')::uuid, 'competencia')
    where realizado > 0) = 1);
select checa('período absurdo é recusado', tenta($$select * from a1_fin_dre('2020-01-01', '2026-01-01', null, 'caixa')$$) like '%periodo_invalido%');

-- ─── 12b. Orçamento pela tela e distrato da carteira à mão ─────────────────
select f2_guarda('orc', a1_fin_orcamento_salvar(extract(year from current_date)::int, null,
  json_build_array(json_build_object('categoria', (select id from a1_fin_categorias where chave = 'venda_unidade'),
                                     'mes', date_trunc('month', current_date)::date, 'valor', 60000),
                   json_build_object('categoria', (select id from a1_fin_categorias where chave = 'venda_unidade'),
                                     'mes', (date_trunc('month', current_date) + interval '1 month')::date, 'valor', 0))::jsonb)::text);
select checa('orçamento pela tela troca o valor do mês (sem duplicar)',
  (select count(*) from a1_fin_orcamentos where categoria_id = (select id from a1_fin_categorias where chave = 'venda_unidade')
     and centro_id is null and mes = date_trunc('month', current_date)::date) = 1
  and (select valor from a1_fin_orcamentos where categoria_id = (select id from a1_fin_categorias where chave = 'venda_unidade')
     and centro_id is null and mes = date_trunc('month', current_date)::date) = 60000, f2('orc'));
select checa('mês fora do ano é recusado', tenta(format($$select a1_fin_orcamento_salvar(2030, null, '[{"categoria":"%s","mes":"2031-01-01","valor":1}]')$$,
  (select id from a1_fin_categorias where chave = 'venda_unidade'))) like '%dados_invalidos%');
select f2_guarda('manual', (select id::text from a1_fin_carteiras where comercial_id is null and status = 'ativa' order by criado_em limit 1));
select f2_guarda('davenda', (select id::text from a1_fin_carteiras where comercial_id is not null and status = 'ativa' order by criado_em limit 1));
select checa('carteira da venda não se distrata por aqui', f2('davenda') is null or
  tenta(format($$select a1_fin_carteira_encerrar(%L, 'x', %s)$$, f2('davenda'), (select versao from a1_fin_carteiras where id = f2('davenda')::uuid))) like '%carteira_da_venda%');
select checa('distrato sem motivo é recusado', f2('manual') is not null and
  tenta(format($$select a1_fin_carteira_encerrar(%L, ' ', 1)$$, f2('manual'))) like '%motivo_obrigatorio%');
select f2_guarda('vman', (select versao::text from a1_fin_carteiras where id = f2('manual')::uuid));
select checa('versão velha é recusada no distrato', tenta(format($$select a1_fin_carteira_encerrar(%L, 'erro de digitação', %s)$$, f2('manual'), f2('vman')::int - 1)) like '%versao_desatualizada%');
select a1_fin_carteira_encerrar(f2('manual')::uuid, 'erro de digitação', f2('vman')::int);
select checa('carteira à mão distratada: abertas canceladas, pagas ficam',
  (select status from a1_fin_carteiras where id = f2('manual')::uuid) = 'distratada'
  and not exists (select 1 from a1_fin_parcelas where carteira_id = f2('manual')::uuid and status = 'aberta'));

-- ─── 13. Quem não pode e outro cliente ──────────────────────────────────────
select teste_entrar('tk-ana');
select checa('corretora sem permissão não lê carteira, parcelas nem extrato',
  (select count(*) from a1_fin_carteiras) = 0 and (select count(*) from a1_fin_parcelas) = 0 and (select count(*) from a1_fin_extrato_itens) = 0);
select checa('nem salva orçamento', tenta($$select a1_fin_orcamento_salvar(2030, null, '[]')$$) like '%sem_permissao%');
select checa('nem chama a baixa', tenta(format($$select a1_fin_parcela_baixar(%L, current_date, 1, null, null, 0, 1)$$, f2('intp'))) like '%sem_permissao%');
select teste_entrar('tk-outro');
select checa('outro cliente não vê a carteira de THE CRED', (select count(*) from a1_fin_carteiras) = 0);
select checa('nem concilia linha de THE CRED', tenta(format($$select a1_fin_extrato_conciliar(%L, null, %L)$$, f2('it2'), f2('intp'))) like '%item_nao_encontrado%');
select checa('nem usa centro de custo de THE CRED no lançamento dele',
  tenta(format($$insert into a1_fin_lancamentos (tenant_id, tipo, descricao, valor, vencimento, centro_id) values ('22222222-2222-2222-2222-222222222222','pagar','x',1,current_date,%L)$$, f2('centro'))) like '%referencia_de_outro_cliente%');
select checa('nem importa extrato na conta de THE CRED', tenta(format($$select a1_fin_extrato_importar(%L, 'x', '[{"data":"2026-01-01","valor":1}]')$$, f2('conta'))) like '%referencia_de_outro_cliente%');

-- =============================================================================
reset role;
\o
select n, case when passou then 'ok  ' else 'FALHOU' end as r, descr, coalesce(detalhe,'') as detalhe from prova order by n;
select count(*) filter (where passou) as passaram, count(*) filter (where not passou) as falharam, count(*) as total from prova;
do $$
declare f int;
begin
  select count(*) into f from prova where not passou;
  if f > 0 then raise exception 'PROVA DO FINANCEIRO (FASE 2) REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DO FINANCEIRO (FASE 2) APROVADA';
end $$;
drop function f2_guarda(text, text);
drop function f2(text);
drop table f2_teste;
