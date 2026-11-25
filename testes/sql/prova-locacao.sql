-- =============================================================================
-- PROVA: MÓDULO LOCAÇÃO (fase 1)
-- Roda como anon com o token no cabeçalho, como o navegador. Confere: sem a
-- licença nada aparece; corretor não vê nem mexe; uma garantia só e caução até
-- 3 aluguéis; referência a outro cliente é recusada; contrato ativa só com
-- proprietários somando 100% e imóvel livre; cobrança do mês não duplica;
-- baixa em dia e atrasada calculam multa, juros, taxa de administração,
-- encargos e despesas do proprietário certos; estorno desfaz; repasse pago
-- trava o estorno; outro cliente não enxerga nada.
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;
create table if not exists lc_teste (k text primary key, v text);
truncate lc_teste;
grant select, insert, update on lc_teste to anon, service_role;
create or replace function lc(k text) returns text language sql as $$ select v from lc_teste where lc_teste.k = lc.k $$;
grant execute on function lc(text) to anon;
create or replace function lc_guarda(k text, v text) returns void language sql as $$
  insert into lc_teste values (k, v) on conflict (k) do update set v = excluded.v $$;
grant execute on function lc_guarda(text, text) to anon;

\o /dev/null
reset role;
insert into a1_modules (key, name) values ('LOCACAO','Locação') on conflict do nothing;

-- ─── 1. Sem a licença ───────────────────────────────────────────────────────
set role anon;
select teste_entrar('tk-gestor');
select checa('sem a licença, não lê imóveis', tenta('select * from a1_lc_imoveis') is null and (select count(*) from a1_lc_imoveis) = 0);
select checa('sem a licença, não cadastra',
  tenta($$insert into a1_lc_pessoas (tenant_id, nome) values ('11111111-1111-1111-1111-111111111111', 'X')$$) like '%row-level security%');
select checa('sem a licença, função recusa', tenta($$select a1_lc_gerar_cobrancas('2026-03-01')$$) like '%sem_permissao%');

reset role;
insert into a1_tenant_modules (tenant_id, module_key) values ('11111111-1111-1111-1111-111111111111','LOCACAO') on conflict do nothing;

-- ─── 2. Cadastros ───────────────────────────────────────────────────────────
set role anon;
select teste_entrar('tk-gestor');
with p as (insert into a1_lc_pessoas (tenant_id, nome, documento, papeis) values
  ('11111111-1111-1111-1111-111111111111', 'Ana Dona', '11111111111', '{proprietario}'),
  ('11111111-1111-1111-1111-111111111111', 'Beto Dono', '22222222222', '{proprietario}'),
  ('11111111-1111-1111-1111-111111111111', 'Caio Inquilino', '33333333333', '{inquilino}'),
  ('11111111-1111-1111-1111-111111111111', 'Davi Fiador', '44444444444', '{fiador}')
  returning id, nome)
select lc_guarda(split_part(nome, ' ', 1), id::text) from p;
select checa('o gestor cadastra pessoas', (select count(*) from a1_lc_pessoas) = 4);
select checa('documento repetido no mesmo cliente é recusado',
  tenta($$insert into a1_lc_pessoas (tenant_id, nome, documento) values ('11111111-1111-1111-1111-111111111111', 'Outra', '11111111111')$$) like '%duplicate%');
with i as (insert into a1_lc_imoveis (tenant_id, logradouro, numero, cidade, uf)
  values ('11111111-1111-1111-1111-111111111111', 'Rua das Flores', '10', 'São Luís', 'MA') returning id) select lc_guarda('imovel', id::text) from i;
insert into a1_lc_imovel_donos (tenant_id, imovel_id, pessoa_id, percentual) values
  ('11111111-1111-1111-1111-111111111111', lc('imovel')::uuid, lc('Ana')::uuid, 60);

-- ─── 3. Contrato ────────────────────────────────────────────────────────────
select checa('caução acima de 3 aluguéis é recusada (art. 38)',
  tenta(format($$insert into a1_lc_contratos (tenant_id, imovel_id, inquilino_id, data_inicio, valor_aluguel, garantia_tipo, garantia_valor)
    values ('11111111-1111-1111-1111-111111111111', %L, %L, '2026-01-15', 2000, 'caucao', 6001)$$, lc('imovel'), lc('Caio'))) like '%a1_lc_garantia_coerente%');
select checa('fiador sem a pessoa fiadora é recusado',
  tenta(format($$insert into a1_lc_contratos (tenant_id, imovel_id, inquilino_id, data_inicio, valor_aluguel, garantia_tipo)
    values ('11111111-1111-1111-1111-111111111111', %L, %L, '2026-01-15', 2000, 'fiador')$$, lc('imovel'), lc('Caio'))) like '%a1_lc_garantia_coerente%');
select checa('contrato não nasce ativo',
  tenta(format($$insert into a1_lc_contratos (tenant_id, imovel_id, inquilino_id, data_inicio, valor_aluguel, status)
    values ('11111111-1111-1111-1111-111111111111', %L, %L, '2026-01-15', 2000, 'ativo')$$, lc('imovel'), lc('Caio'))) like '%row-level security%');
with c as (insert into a1_lc_contratos (tenant_id, imovel_id, inquilino_id, data_inicio, prazo_meses,
    dia_vencimento, valor_aluguel, garantia_tipo, fiador_id, taxa_adm_pct, multa_atraso_pct, juros_mes_pct, repasse_dias, encargos)
  values ('11111111-1111-1111-1111-111111111111', lc('imovel')::uuid, lc('Caio')::uuid, '2026-01-15', 30, 10, 2000, 'fiador', lc('Davi')::uuid,
          10, 10, 1, 5, '[{"descricao":"Condomínio","valor":500,"destino":"terceiro"},{"descricao":"Taxa extra","valor":100,"destino":"proprietario"}]')
  returning id) select lc_guarda('contrato', id::text) from c;
select checa('contrato com fiador criado como rascunho', (select status from a1_lc_contratos where id = lc('contrato')::uuid) = 'rascunho');
select checa('ativar com proprietários somando 60% é recusado',
  tenta(format($$select a1_lc_ativar_contrato(%L)$$, lc('contrato'))) like '%proprietarios_nao_somam_100%');
insert into a1_lc_imovel_donos (tenant_id, imovel_id, pessoa_id, percentual) values
  ('11111111-1111-1111-1111-111111111111', lc('imovel')::uuid, lc('Beto')::uuid, 40);
select checa('com 100%, ativa', tenta(format($$select a1_lc_ativar_contrato(%L)$$, lc('contrato'))) is null);
select checa('o imóvel vira alugado', (select situacao from a1_lc_imoveis where id = lc('imovel')::uuid) = 'alugado');
select checa('contrato ativo não se edita direto',
  tenta(format($$update a1_lc_contratos set valor_aluguel = 1 where id = %L$$, lc('contrato'))) is null
  and (select valor_aluguel from a1_lc_contratos where id = lc('contrato')::uuid) = 2000);
with c as (insert into a1_lc_contratos (tenant_id, imovel_id, inquilino_id, data_inicio, valor_aluguel)
  values ('11111111-1111-1111-1111-111111111111', lc('imovel')::uuid, lc('Caio')::uuid, '2026-02-01', 1500) returning id) select lc_guarda('contrato2', id::text) from c;
select checa('segundo contrato no mesmo imóvel não ativa', tenta(format($$select a1_lc_ativar_contrato(%L)$$, lc('contrato2'))) like '%imovel_ja_alugado%');

-- ─── 4. Cobranças ───────────────────────────────────────────────────────────
select checa('gera a cobrança do mês', (a1_lc_gerar_cobrancas('2026-03-01')->>'criadas')::int = 1);
select checa('gerar de novo não duplica', (a1_lc_gerar_cobrancas('2026-03-17')->>'criadas')::int = 0);
select lc_guarda('cob3', (select id::text from a1_lc_cobrancas where competencia = '2026-03-01'));
select checa('vence no dia 10 e soma aluguel + encargos (2.600)',
  (select vencimento = '2026-03-10' and valor_total = 2600 from a1_lc_cobrancas where id = lc('cob3')::uuid));
select checa('antes do início do contrato não gera', (a1_lc_gerar_cobrancas('2025-12-01')->>'criadas')::int = 0);
select checa('depois do fim do contrato (30 meses) não gera', (a1_lc_gerar_cobrancas('2028-08-01')->>'criadas')::int = 0);

-- despesas do proprietário: 150 só da Ana e 100 de todos (rateado 60/40)
insert into a1_lc_lancamentos (tenant_id, contrato_id, proprietario_id, descricao, valor) values
  ('11111111-1111-1111-1111-111111111111', lc('contrato')::uuid, lc('Ana')::uuid, 'Conserto da torneira', 150),
  ('11111111-1111-1111-1111-111111111111', lc('contrato')::uuid, null, 'Pintura da fachada', 100);

-- ─── 5. Baixa em dia ────────────────────────────────────────────────────────
select checa('baixa em dia', tenta(format($$select a1_lc_baixar_cobranca(%L, '2026-03-10', 'pix', 1)$$, lc('cob3'))) is null);
select checa('em dia: sem multa nem juros, pago 2.600',
  (select multa = 0 and juros = 0 and valor_pago = 2600 and status = 'paga' from a1_lc_cobrancas where id = lc('cob3')::uuid));
-- Ana 60%: aluguel 1200 + encargo 60 − taxa 120 − (150 + 60) = 930
-- Beto 40%: aluguel 800 + encargo 40 − taxa 80 − 40 = 720
select checa('repasse da Ana: 1200 + 60 − 120 − 210 = 930, previsto para 5 dias depois',
  (select aluguel = 1200 and encargos = 60 and taxa_adm = 120 and lancamentos = 210 and valor_liquido = 930 and previsto_para = '2026-03-15'
     from a1_lc_repasses where cobranca_id = lc('cob3')::uuid and proprietario_id = lc('Ana')::uuid));
select checa('repasse do Beto: 800 + 40 − 80 − 40 = 720',
  (select valor_liquido = 720 and lancamentos = 40 from a1_lc_repasses where cobranca_id = lc('cob3')::uuid and proprietario_id = lc('Beto')::uuid));
select checa('condomínio (terceiro) fica fora do repasse; despesas não ficam pendentes',
  (select sum(aluguel + encargos) = 2100 from a1_lc_repasses where cobranca_id = lc('cob3')::uuid)
  and not exists (select 1 from a1_lc_lancamentos where repasse_id is null));
select checa('baixar duas vezes é recusado', tenta(format($$select a1_lc_baixar_cobranca(%L, '2026-03-10', 'pix', 2)$$, lc('cob3'))) like '%cobranca_nao_aberta%');

-- ─── 6. Estorno e baixa atrasada ────────────────────────────────────────────
select checa('versão errada no estorno é recusada', tenta(format($$select a1_lc_estornar_cobranca(%L, 1)$$, lc('cob3'))) like '%versao_desatualizada%');
select checa('estorna a baixa', tenta(format($$select a1_lc_estornar_cobranca(%L, 2)$$, lc('cob3'))) is null);
select checa('estorno apaga os repasses e devolve as despesas para pendente',
  not exists (select 1 from a1_lc_repasses where cobranca_id = lc('cob3')::uuid)
  and (select count(*) from a1_lc_lancamentos where repasse_id is null) = 2
  and (select status from a1_lc_cobrancas where id = lc('cob3')::uuid) = 'aberta');
-- paga 10 dias atrasado: multa 10% de 2.600 = 260; juros 1%/mês pro rata: 2.600 × 1% ÷ 30 × 10 = 8,67
select checa('baixa atrasada', tenta(format($$select a1_lc_baixar_cobranca(%L, '2026-03-20', 'boleto', 3)$$, lc('cob3'))) is null);
select checa('atraso: multa 260, juros 8,67, pago 2.868,67',
  (select multa = 260 and juros = 8.67 and valor_pago = 2868.67 from a1_lc_cobrancas where id = lc('cob3')::uuid));
-- Ana: base (2000 + 260 + 8,67) × 60% = 1.361,20; taxa 136,12
select checa('multa e juros entram na base da taxa (Ana: 1.361,20, taxa 136,12)',
  (select aluguel = 1361.20 and taxa_adm = 136.12 from a1_lc_repasses where cobranca_id = lc('cob3')::uuid and proprietario_id = lc('Ana')::uuid));

-- ─── 7. Repasse pago e cancelamento ─────────────────────────────────────────
select lc_guarda('repAna', (select id::text from a1_lc_repasses where cobranca_id = lc('cob3')::uuid and proprietario_id = lc('Ana')::uuid));
select checa('paga o repasse', tenta(format($$select a1_lc_pagar_repasse(%L, '2026-03-25')$$, lc('repAna'))) is null);
select checa('com repasse pago, não estorna', tenta(format($$select a1_lc_estornar_cobranca(%L, 4)$$, lc('cob3'))) like '%repasse_ja_pago%');
select checa('lançamento já repassado não muda',
  tenta(format($$update a1_lc_lancamentos set valor = 1 where proprietario_id = %L$$, lc('Ana'))) like '%lancamento_ja_repassado%');
select a1_lc_gerar_cobrancas('2026-04-01');
select lc_guarda('cob4', (select id::text from a1_lc_cobrancas where competencia = '2026-04-01'));
select checa('cancelar exige motivo', tenta(format($$select a1_lc_cancelar_cobranca(%L, 1, '')$$, lc('cob4'))) like '%motivo_obrigatorio%');
select checa('cancela com motivo e pode gerar de novo',
  tenta(format($$select a1_lc_cancelar_cobranca(%L, 1, 'Acordo de carência')$$, lc('cob4'))) is null
  and (a1_lc_gerar_cobrancas('2026-04-01')->>'criadas')::int = 1);

-- ─── 8. Quem não pode ───────────────────────────────────────────────────────
select teste_entrar('tk-ana');
select checa('corretor não vê nada da Locação', (select count(*) from a1_lc_contratos) = 0 and (select count(*) from a1_lc_pessoas) = 0);
select checa('corretor não chama as funções', tenta($$select a1_lc_gerar_cobrancas('2026-05-01')$$) like '%sem_permissao%');
reset role;
insert into a1_tenant_modules (tenant_id, module_key) values ('22222222-2222-2222-2222-222222222222','LOCACAO') on conflict do nothing;
set role anon;
select teste_entrar('tk-outro');
select checa('outro cliente (com a licença) não vê nada de THE CRED', (select count(*) from a1_lc_imoveis) = 0 and (select count(*) from a1_lc_cobrancas) = 0);
with i as (insert into a1_lc_imoveis (tenant_id, logradouro) values ('22222222-2222-2222-2222-222222222222', 'Av. Outra') returning id) select lc_guarda('imovelOutro', id::text) from i;
select checa('não pode usar pessoa de outro cliente como dona',
  tenta(format($$insert into a1_lc_imovel_donos (tenant_id, imovel_id, pessoa_id, percentual) values ('22222222-2222-2222-2222-222222222222', %L, %L, 100)$$,
    lc('imovelOutro'), lc('Ana'))) like '%referencia_de_outro_cliente%');
select checa('não baixa cobrança de outro cliente', tenta(format($$select a1_lc_baixar_cobranca(%L, '2026-04-10', 'pix', 1)$$, lc('cob4'))) like '%cobranca_nao_encontrada%');

-- ─── 9. Encerrar ────────────────────────────────────────────────────────────
select teste_entrar('tk-gestor');
select lc_guarda('enc', coalesce(tenta(format($$select a1_lc_encerrar_contrato(%L, '2026-03-31', 'rescindido')$$, lc('contrato'))), 'ok'));
select checa('encerra o contrato: imóvel volta a disponível e cobranças futuras abertas são canceladas',
  lc('enc') = 'ok'
  and (select situacao from a1_lc_imoveis where id = lc('imovel')::uuid) = 'disponivel'
  and (select status from a1_lc_cobrancas where competencia = '2026-04-01' and status <> 'cancelada' limit 1) is null);

-- =============================================================================
reset role;
\o
select n, case when passou then 'ok  ' else 'FALHOU' end as r, descr, coalesce(detalhe,'') as detalhe from prova order by n;
select count(*) filter (where passou) as passaram, count(*) filter (where not passou) as falharam, count(*) as total from prova;
do $$
declare f int;
begin
  select count(*) into f from prova where not passou;
  if f > 0 then raise exception 'PROVA DA LOCAÇÃO REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DA LOCAÇÃO APROVADA';
end $$;
drop function lc_guarda(text, text);
drop function lc(text);
drop table lc_teste;
