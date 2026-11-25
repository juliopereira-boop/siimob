-- =============================================================================
-- PROVA: MÓDULO LOCAÇÃO (fase 2)
-- Roda depois da prova da fase 1, no mesmo banco (os dados dela existem quando
-- a fase 2 é aplicada: é assim que o ID automático das linhas antigas é
-- provado). Confere: ID por cliente, preenchido pelo banco e imutável;
-- reajuste pelo índice acumulado (automático só com reajuste_auto, deflação
-- não reduz, manual com percentual, não aplica duas vezes); renovação;
-- rescisão com multa proporcional e aluguel proporcional numa cobrança avulsa
-- que segue para baixa e repasse; modelos; vistoria trava ao concluir; quem não
-- pode não vê.
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;
create table if not exists f2_teste (k text primary key, v text);
truncate f2_teste;
grant select, insert, update on f2_teste to anon, service_role;
create or replace function f2(k text) returns text language sql as $$ select v from f2_teste where f2_teste.k = f2.k $$;
grant execute on function f2(text) to anon;
create or replace function f2_guarda(k text, v text) returns void language sql as $$
  insert into f2_teste values (k, v) on conflict (k) do update set v = excluded.v $$;
grant execute on function f2_guarda(text, text) to anon;
-- início do contrato que faz aniversário neste mês (12 meses atrás, dia 5)
select f2_guarda('ini', ((date_trunc('month', current_date) - interval '12 months')::date + 4)::text);
select f2_guarda('mes', extract(month from current_date)::int::text);

\o /dev/null
-- ─── 1. ID automático nas linhas que já existiam ────────────────────────────
reset role;
select checa('toda linha antiga recebeu o ID', not exists (select 1 from a1_lc_contratos where seq is null)
  and not exists (select 1 from a1_lc_imoveis where seq is null));
select checa('ID por cliente, pela ordem de criação (THE CRED: contratos 1 e 2)',
  (select array_agg(seq order by criado_em) from a1_lc_contratos where tenant_id = '11111111-1111-1111-1111-111111111111') = '{1,2}');
select checa('o outro cliente também começa no 1',
  (select seq from a1_lc_imoveis where tenant_id = '22222222-2222-2222-2222-222222222222') = 1);
select checa('contratos antigos não ligam o reajuste automático sozinhos', not exists (select 1 from a1_lc_contratos where reajuste_auto));

set role anon;
select teste_entrar('tk-gestor');
select f2_guarda('Ana', (select id::text from a1_lc_pessoas where nome = 'Ana Dona'));
select f2_guarda('Caio', (select id::text from a1_lc_pessoas where nome = 'Caio Inquilino'));
with i as (insert into a1_lc_imoveis (tenant_id, logradouro, numero) values
  ('11111111-1111-1111-1111-111111111111', 'Rua Dois', '2'),
  ('11111111-1111-1111-1111-111111111111', 'Rua Três', '3'),
  ('11111111-1111-1111-1111-111111111111', 'Rua Quatro', '4') returning id, logradouro)
select f2_guarda(logradouro, id::text) from i;
select checa('imóveis novos continuam a sequência (2, 3, 4)',
  (select array_agg(seq order by seq) from a1_lc_imoveis where tenant_id = '11111111-1111-1111-1111-111111111111') = '{1,2,3,4}');
select f2_guarda('t', coalesce(tenta($$insert into a1_lc_imoveis (tenant_id, logradouro, seq) values ('11111111-1111-1111-1111-111111111111', 'Rua Cinco', 99)$$), 'ok'));
select checa('o navegador não escolhe o ID', f2('t') = 'ok'
  and (select seq from a1_lc_imoveis where logradouro = 'Rua Cinco') = 5);
update a1_lc_imoveis set observacoes = 'x', seq = 77 where logradouro = 'Rua Cinco';
select checa('nem muda o ID depois', (select seq from a1_lc_imoveis where logradouro = 'Rua Cinco') = 5);
insert into a1_lc_imovel_donos (tenant_id, imovel_id, pessoa_id, percentual)
select '11111111-1111-1111-1111-111111111111', f2(l)::uuid, f2('Ana')::uuid, 100 from unnest(array['Rua Dois','Rua Três','Rua Quatro']) l;

-- ─── 2. Reajuste ────────────────────────────────────────────────────────────
with c as (insert into a1_lc_contratos (tenant_id, imovel_id, inquilino_id, data_inicio, valor_aluguel, indice_reajuste, mes_reajuste, reajuste_auto)
  values ('11111111-1111-1111-1111-111111111111', f2('Rua Dois')::uuid, f2('Caio')::uuid, f2('ini')::date, 1000, 'IGPM', f2('mes')::int, true),
         ('11111111-1111-1111-1111-111111111111', f2('Rua Três')::uuid, f2('Caio')::uuid, f2('ini')::date, 2000, 'IPCA', f2('mes')::int, false)
  returning id, indice_reajuste) select f2_guarda(indice_reajuste, id::text) from c;
select checa('contratos novos recebem o ID seguinte (3 e 4)',
  (select array_agg(seq order by seq) from a1_lc_contratos where id in (f2('IGPM')::uuid, f2('IPCA')::uuid)) = '{3,4}');
select a1_lc_ativar_contrato(f2('IGPM')::uuid);
select a1_lc_ativar_contrato(f2('IPCA')::uuid);
select checa('reajuste devido neste mês, mas sem índice ainda',
  (select (v->>'devido')::date = date_trunc('month', current_date)::date and v->>'percentual' is null
     from (select a1_lc_reajuste_previa(f2('IGPM')::uuid)::jsonb v) x));
select checa('aplicar sem índice é recusado', tenta(format($$select a1_lc_aplicar_reajuste(%L)$$, f2('IGPM'))) like '%indice_indisponivel%');
select checa('contrato em rascunho não tem reajuste devido',
  tenta($$select a1_lc_aplicar_reajuste((select id from a1_lc_contratos where status = 'rascunho' limit 1))$$) like '%reajuste_nao_devido%');
select checa('o navegador não grava índice', tenta($$insert into a1_lc_indices values ('IGPM', '2020-01-01', 1)$$) like '%permission denied%');
select checa('o navegador não dispara a busca no Banco Central', tenta($$select a1_lc_indices_atualizar()$$) like '%permission denied%');
select checa('nem o reajuste automático de todos', tenta($$select a1_lc_reajustes_automaticos()$$) like '%permission denied%');

reset role;
-- IGP-M: 1% ao mês nos 12 meses até o mês passado; IPCA: −0,5% (deflação)
insert into a1_lc_indices (indice, mes, valor)
select i, (date_trunc('month', current_date) - make_interval(months => n))::date, v
  from (values ('IGPM', 1.0), ('IPCA', -0.5)) s(i, v), generate_series(1, 12) n;
-- INPC só até dois meses atrás
insert into a1_lc_indices (indice, mes, valor)
select 'INPC', (date_trunc('month', current_date) - make_interval(months => n))::date, 0.4 from generate_series(2, 13) n;
select checa('acumulado de 12 meses a 1%: 12,6825%',
  a1_lc_indice_acumulado('IGPM', (date_trunc('month', current_date) - interval '1 month')::date) = 12.6825);
select checa('mês faltando: acumulado nulo; dois meses antes: calcula',
  a1_lc_indice_acumulado('INPC', (date_trunc('month', current_date) - interval '1 month')::date) is null
  and a1_lc_indice_acumulado('INPC', (date_trunc('month', current_date) - interval '2 months')::date) is not null);
select checa('sem pg_net, a busca responde sem quebrar', (a1_lc_indices_atualizar()->>'erro') = 'pg_net_ausente');
select checa('rotina automática reajusta só o contrato com reajuste_auto', a1_lc_reajustes_automaticos() = 1);
select checa('1.000 × 1,126825 = 1.126,83',
  (select valor_aluguel from a1_lc_contratos where id = f2('IGPM')::uuid) = 1126.83
  and (select valor_aluguel from a1_lc_contratos where id = f2('IPCA')::uuid) = 2000);
select checa('aditivo gravado: automático, IGP-M, referência do mês',
  (select origem = 'automatico' and indice = 'IGPM' and percentual = 12.6825 and valor_antes = 1000 and valor_depois = 1126.83
          and referencia = date_trunc('month', current_date)::date from a1_lc_aditivos where contrato_id = f2('IGPM')::uuid));
select checa('rodar de novo não reajusta duas vezes', a1_lc_reajustes_automaticos() = 0);

set role anon;
select teste_entrar('tk-gestor');
select checa('aplicar de novo é recusado', tenta(format($$select a1_lc_aplicar_reajuste(%L)$$, f2('IGPM'))) like '%reajuste_ja_aplicado%');
select checa('deflação: acumulado negativo, reajuste 0%',
  (select (v->>'acumulado')::numeric < 0 and (v->>'percentual')::numeric = 0 and (v->>'valor_depois')::numeric = 2000
     from (select a1_lc_reajuste_previa(f2('IPCA')::uuid)::jsonb v) x));
select checa('percentual absurdo é recusado', tenta(format($$select a1_lc_aplicar_reajuste(%L, 500)$$, f2('IPCA'))) like '%percentual_invalido%');
select f2_guarda('t', coalesce(tenta(format($$select a1_lc_aplicar_reajuste(%L, 5)$$, f2('IPCA'))), 'ok'));
select checa('gestor aplica com percentual negociado (5%)', f2('t') = 'ok'
  and (select valor_aluguel from a1_lc_contratos where id = f2('IPCA')::uuid) = 2100
  and (select origem from a1_lc_aditivos where contrato_id = f2('IPCA')::uuid) = 'manual');
select checa('o navegador não grava aditivo', tenta(format($$insert into a1_lc_aditivos (tenant_id, contrato_id, tipo) values ('11111111-1111-1111-1111-111111111111', %L, 'reajuste')$$, f2('IGPM'))) like '%permission denied%');

-- ─── 3. Renovação ───────────────────────────────────────────────────────────
select checa('renovar 0 meses é recusado', tenta(format($$select a1_lc_renovar_contrato(%L, 0)$$, f2('IGPM'))) like '%prazo_invalido%');
select f2_guarda('t', coalesce(tenta(format($$select a1_lc_renovar_contrato(%L, 12, 1200, 'Renovação amigável')$$, f2('IGPM'))), 'ok'));
select checa('renova 12 meses com valor novo', f2('t') = 'ok'
  and (select prazo_meses = 42 and valor_aluguel = 1200 from a1_lc_contratos where id = f2('IGPM')::uuid)
  and (select prazo_antes = 30 and prazo_depois = 42 and valor_antes = 1126.83 and valor_depois = 1200
         from a1_lc_aditivos where contrato_id = f2('IGPM')::uuid and tipo = 'renovacao'));

-- ─── 4. Rescisão ────────────────────────────────────────────────────────────
-- 2.000/mês, 30 meses desde 01/01/2026, multa de 3 aluguéis. Sai em 15/07/2026:
-- faltam 717 dias ≈ 24 meses → multa 2.000 × 3 × 24 ÷ 30 = 4.800;
-- aluguel proporcional de julho: 2.000 × 15 ÷ 31 = 967,74. Total 5.767,74.
with c as (insert into a1_lc_contratos (tenant_id, imovel_id, inquilino_id, data_inicio, valor_aluguel, multa_rescisao_alugueis)
  values ('11111111-1111-1111-1111-111111111111', f2('Rua Quatro')::uuid, f2('Caio')::uuid, '2026-01-01', 2000, 3) returning id)
select f2_guarda('resc', id::text) from c;
select a1_lc_ativar_contrato(f2('resc')::uuid);
select a1_lc_gerar_cobrancas('2026-08-01', f2('resc')::uuid);
select checa('cálculo: 24 meses restantes, multa 4.800, proporcional 967,74 (15 dias)',
  (select (v->>'meses_restantes')::int = 24 and (v->>'multa')::numeric = 4800 and (v->>'proporcional')::numeric = 967.74 and (v->>'dias')::int = 15
     from (select a1_lc_rescisao_calculo(f2('resc')::uuid, '2026-07-15')::jsonb v) x));
select f2_guarda('r', a1_lc_rescindir_contrato(f2('resc')::uuid, '2026-07-15')::text);
select checa('rescinde: contrato rescindido, imóvel disponível',
  (select status = 'rescindido' and encerrado_em = '2026-07-15' from a1_lc_contratos where id = f2('resc')::uuid)
  and (select situacao from a1_lc_imoveis where id = f2('Rua Quatro')::uuid) = 'disponivel');
select checa('cobrança avulsa de 5.767,74 vencendo em 10 dias, com os dois itens',
  (select tipo = 'avulsa' and valor_total = 5767.74 and vencimento = '2026-07-25' and competencia = '2026-07-01' and jsonb_array_length(itens) = 2
     from a1_lc_cobrancas where id = (f2('r')::jsonb->>'cobranca_id')::uuid));
select checa('a cobrança mensal de agosto (depois da saída) foi cancelada',
  (select status from a1_lc_cobrancas where contrato_id = f2('resc')::uuid and competencia = '2026-08-01') = 'cancelada');
select checa('aditivo de rescisão guarda o cálculo',
  (select (detalhe->>'multa_cobrada')::numeric = 4800 and data = '2026-07-15' from a1_lc_aditivos where contrato_id = f2('resc')::uuid and tipo = 'rescisao'));
-- baixa em dia: base 5.767,74 (Ana 100%), taxa 10% = 576,77, líquido 5.190,97
select f2_guarda('t', coalesce(tenta(format($$select a1_lc_baixar_cobranca(%L, '2026-07-25', 'pix', 1)$$, f2('r')::jsonb->>'cobranca_id')), 'ok'));
select checa('a avulsa baixa e gera repasse', f2('t') = 'ok'
  and (select aluguel = 5767.74 and taxa_adm = 576.77 and valor_liquido = 5190.97 from a1_lc_repasses where cobranca_id = (f2('r')::jsonb->>'cobranca_id')::uuid));
select f2_guarda('t', a1_lc_rescindir_contrato(f2('IPCA')::uuid, current_date, 0, false)::text);
select checa('rescisão com multa 0 e sem proporcional não cria cobrança (art. 4º, parágrafo único)',
  f2('t')::jsonb->>'cobranca_id' is null
  and (select status from a1_lc_contratos where id = f2('IPCA')::uuid) = 'rescindido');
select checa('rescindir de novo é recusado', tenta(format($$select a1_lc_rescindir_contrato(%L, current_date)$$, f2('IPCA'))) like '%contrato_nao_ativo%');
reset role;
insert into a1_lc_cobrancas (tenant_id, contrato_id, competencia, vencimento, valor_total, tipo)
values ('11111111-1111-1111-1111-111111111111', f2('IGPM')::uuid, date_trunc('month', current_date)::date, current_date, 10, 'avulsa');
set role anon;
select teste_entrar('tk-gestor');
select checa('avulsa no mês não impede a mensal',
  (a1_lc_gerar_cobrancas(current_date, f2('IGPM')::uuid)->>'criadas')::int = 1);

-- ─── 5. Modelos ─────────────────────────────────────────────────────────────
select f2_guarda('t', coalesce(tenta($$insert into a1_lc_modelos (tenant_id, tipo, texto) values ('11111111-1111-1111-1111-111111111111', 'contrato_residencial', 'CONTRATO DE LOCAÇÃO {{inquilino.nome}} ...')$$), 'ok'));
select checa('o gestor grava o modelo do contrato', f2('t') = 'ok'
  and (select count(*) from a1_lc_modelos) = 1);
select checa('tipo de modelo desconhecido é recusado',
  tenta($$insert into a1_lc_modelos (tenant_id, tipo, texto) values ('11111111-1111-1111-1111-111111111111', 'outro', 'texto qualquer de modelo')$$) like '%check%');

-- ─── 6. Vistoria ────────────────────────────────────────────────────────────
with v as (insert into a1_lc_vistorias (tenant_id, imovel_id, contrato_id, tipo, responsavel)
  values ('11111111-1111-1111-1111-111111111111', f2('Rua Dois')::uuid, f2('IGPM')::uuid, 'entrada', 'Vistoriador') returning id)
select f2_guarda('vist', id::text) from v;
select checa('vistoria com contrato de outro imóvel é recusada',
  tenta(format($$insert into a1_lc_vistorias (tenant_id, imovel_id, contrato_id) values ('11111111-1111-1111-1111-111111111111', %L, %L)$$,
    f2('Rua Três'), f2('IGPM'))) like '%referencia_de_outro_cliente%');
select checa('concluir sem itens é recusado', tenta(format($$select a1_lc_concluir_vistoria(%L)$$, f2('vist'))) like '%vistoria_sem_itens%');
insert into a1_lc_vistoria_itens (tenant_id, vistoria_id, ordem, comodo, item, estado, fotos) values
  ('11111111-1111-1111-1111-111111111111', f2('vist')::uuid, 1, 'Sala', 'Piso', 'bom', '["11111111-1111-1111-1111-111111111111/locacao/vistorias/x.jpg"]'),
  ('11111111-1111-1111-1111-111111111111', f2('vist')::uuid, 2, 'Cozinha', 'Pia', 'regular', '[]');
select checa('mais de 12 fotos num item é recusado',
  tenta(format($$insert into a1_lc_vistoria_itens (tenant_id, vistoria_id, comodo, item, fotos) values ('11111111-1111-1111-1111-111111111111', %L, 'Sala', 'Teto', (select jsonb_agg(n) from generate_series(1, 13) n))$$, f2('vist'))) like '%check%');
select checa('conclui com itens', tenta(format($$select a1_lc_concluir_vistoria(%L)$$, f2('vist'))) is null);
update a1_lc_vistoria_itens set estado = 'ruim' where vistoria_id = f2('vist')::uuid;
select checa('concluída, os itens não mudam', not exists (select 1 from a1_lc_vistoria_itens where estado = 'ruim'));
select checa('concluída, não recebe item novo',
  tenta(format($$insert into a1_lc_vistoria_itens (tenant_id, vistoria_id, comodo, item) values ('11111111-1111-1111-1111-111111111111', %L, 'Quarto', 'Porta')$$, f2('vist'))) like '%row-level security%');
delete from a1_lc_vistorias where id = f2('vist')::uuid;
select checa('concluída, não se apaga', exists (select 1 from a1_lc_vistorias where id = f2('vist')::uuid));

-- ─── 7. Quem não pode ───────────────────────────────────────────────────────
select teste_entrar('tk-ana');
select checa('corretor não vê aditivos, modelos nem vistorias',
  (select count(*) from a1_lc_aditivos) = 0 and (select count(*) from a1_lc_modelos) = 0 and (select count(*) from a1_lc_vistorias) = 0);
select checa('corretor não aplica reajuste', tenta(format($$select a1_lc_aplicar_reajuste(%L)$$, f2('IGPM'))) like '%sem_permissao%');
select teste_entrar('tk-outro');
select checa('outro cliente não vê nada de THE CRED (aditivos, modelos, vistorias)',
  (select count(*) from a1_lc_aditivos) = 0 and (select count(*) from a1_lc_modelos) = 0 and (select count(*) from a1_lc_vistoria_itens) = 0);
select checa('outro cliente não rescinde contrato de THE CRED', tenta(format($$select a1_lc_rescindir_contrato(%L, current_date)$$, f2('IGPM'))) like '%contrato_nao_encontrado%');
select checa('índices são públicos para quem está logado', (select count(*) from a1_lc_indices) > 0);

-- =============================================================================
reset role;
\o
select n, case when passou then 'ok  ' else 'FALHOU' end as r, descr, coalesce(detalhe,'') as detalhe from prova order by n;
select count(*) filter (where passou) as passaram, count(*) filter (where not passou) as falharam, count(*) as total from prova;
do $$
declare f int;
begin
  select count(*) into f from prova where not passou;
  if f > 0 then raise exception 'PROVA DA LOCAÇÃO (FASE 2) REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DA LOCAÇÃO (FASE 2) APROVADA';
end $$;
drop function f2_guarda(text, text);
drop function f2(text);
drop table f2_teste;
