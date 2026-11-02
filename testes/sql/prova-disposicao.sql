-- =============================================================================
-- PROVA DA DISPOSIÇÃO DE UNIDADES (2026-11-02_disposicao_unidades.sql)
--
-- Roda depois de prova-seguranca.sql, no mesmo banco descartável, e reaproveita
-- o cenário dela: THE CRED (cliente A) e Outro Cliente (B), os gestores e os
-- corretores Ana, Bruno e Helena, todos entrando como 'anon' com o token no
-- cabeçalho, como o PostgREST faz.
--
-- Cada verificação existe por um jeito concreto de a regra quebrar: duas
-- reservas da mesma unidade, a situação mudada por PATCH, o corretor lendo o
-- CPF do cliente do colega, a reserva vencida segurando a unidade para sempre.
--
-- EFEITO E CONFERÊNCIA EM INSTRUÇÕES SEPARADAS. Dentro de um mesmo SELECT, a
-- leitura enxerga o banco de antes da instrução: uma conferência escrita junto
-- com a chamada que muda o dado pode olhar o estado velho e passar (ou falhar)
-- por acaso. O resultado de cada chamada fica em `r(nome)` e é conferido na
-- instrução seguinte.
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;

-- ─── Cenário (como dono do banco) ────────────────────────────────────────────
-- selo existe em produção desde 2026-09-12_foundation_access_dossier.sql, que
-- o andaime não carrega inteiro.
alter table a1_co_situacoes add column if not exists selo text;

create or replace function guarda(p_nome text, p_valor json)
returns void language sql as $$ select set_config('teste.' || p_nome, coalesce(p_valor::text, 'null'), false) $$;
create or replace function r(p_nome text)
returns json language sql stable as $$ select nullif(current_setting('teste.' || p_nome, true), '')::json $$;
grant execute on function guarda(text, json) to anon;
grant execute on function r(text) to anon;

insert into a1_developments (id, tenant_id, name, units) values
  ('d1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Residencial das Flores',
   '["B1-001","B1-002","B1-101","B1-102"]'),
  ('d2000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Torre do Vizinho',
   '["X-001"]');

insert into a1_tenant_modules (tenant_id, module_key) values
  ('11111111-1111-1111-1111-111111111111','COMERCIAL')
on conflict do nothing;

insert into a1_co_situacoes (id, tenant_id, nome, flag, ordem, selo) values
  ('5c000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Proposta','INICIAL',0,null),
  ('5c000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Em contrato',null,1,null),
  ('5c000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Vendido',null,2,'VENDIDO'),
  ('5c000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Perdido',null,3,'FIM_NEGATIVO');

-- Ana e Bruno veem e reservam, e nada mais; Helena tem tudo do Repasse e nada
-- da Disposição. As marcas são escritas por inteiro, sem perfil: a prova de
-- segurança, que roda antes, deixa o Bruno com "gerente" (acesso total), e uma
-- prova de "o colega não lê a reserva" com um gerente no papel de colega
-- falharia pelo motivo errado.
update a1_partners set permissions = '{"disp_ver":true,"disp_reservar":true}'::jsonb, perfil_id = null
 where id in ('b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002');

\o /dev/null
set role anon;

-- ─── 1. SEM LICENÇA, NADA ────────────────────────────────────────────────────
select teste_entrar('tk-gestor');
select checa('sem licença: o gestor não lê unidade nenhuma', (select count(*) from a1_unidades) = 0);
select checa('sem licença: não cria ficha',
  tenta($$insert into a1_unidades (tenant_id, empreendimento_id, codigo)
          values ('11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000001','Z-1')$$) is not null);
select checa('sem licença: materializar recusa',
  tenta($$select a1_unidades_materializar('d1000000-0000-0000-0000-000000000001')$$) is not null);
select checa('sem licença: reservar recusa',
  tenta($$select a1_unidade_reservar(gen_random_uuid(), '{}', '[]')$$) like '%modulo_desabilitado%');

reset role;
insert into a1_tenant_modules (tenant_id, module_key) values
  ('11111111-1111-1111-1111-111111111111','DISPOSICAO'),
  ('22222222-2222-2222-2222-222222222222','DISPOSICAO');
set role anon;

-- ─── 2. FICHAS A PARTIR DA LISTA ANTIGA ──────────────────────────────────────
select teste_entrar('tk-gestor');
select guarda('mat1', a1_unidades_materializar('d1000000-0000-0000-0000-000000000001'));
select guarda('mat2', a1_unidades_materializar('d1000000-0000-0000-0000-000000000001'));
select checa('materializar cria uma ficha por texto da lista', (r('mat1')->>'criadas')::int = 4);
select checa('rodar de novo não duplica',
  (r('mat2')->>'criadas')::int = 0 and (select count(*) from a1_unidades) = 4);
select checa('lê bloco, pavimento e número do código',
  exists (select 1 from a1_unidades where codigo = 'B1-101' and bloco = 'B1' and pavimento = 1 and numero = '01')
  and exists (select 1 from a1_unidades where codigo = 'B1-002' and pavimento = 0 and numero = '02'));
select checa('toda ficha nasce disponível e na versão 1',
  not exists (select 1 from a1_unidades where status <> 'disponivel' or versao <> 1));
select checa('a criação fica no rastro, com o nome de quem fez',
  (select count(*) from a1_unidade_eventos where evento = 'CRIADA' and ator_nome = 'Gestor') = 4);
select checa('não materializa empreendimento de outro cliente',
  tenta($$select a1_unidades_materializar('d2000000-0000-0000-0000-000000000001')$$) like '%nao_encontrado%');

-- ─── 3. A SITUAÇÃO SÓ MUDA POR FUNÇÃO ────────────────────────────────────────
select checa('PATCH em status é recusado',
  tenta($$update a1_unidades set status = 'vendido' where codigo = 'B1-001'$$) like '%situacao_da_unidade%');
select checa('PATCH em versao é recusado',
  tenta($$update a1_unidades set versao = 99 where codigo = 'B1-001'$$) like '%situacao_da_unidade%');
select guarda('ins', to_json(tenta($$insert into a1_unidades (tenant_id, empreendimento_id, codigo, status)
  values ('11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000001','B1-201','vendido')$$)));
select checa('ficha nova pedindo "vendido" é aceita, mas nasce disponível',
  r('ins')::text = 'null' and (select status from a1_unidades where codigo = 'B1-201') = 'disponivel',
  r('ins')::text);
select checa('a lista antiga acompanha a ficha nova',
  (select unit_count from a1_developments where id = 'd1000000-0000-0000-0000-000000000001') = 5);
select checa('ficha em empreendimento de outro cliente é recusada',
  tenta($$insert into a1_unidades (tenant_id, empreendimento_id, codigo)
          values ('11111111-1111-1111-1111-111111111111','d2000000-0000-0000-0000-000000000001','INVASOR')$$)
  like '%empreendimento_de_outro_cliente%');
update a1_unidades set area_privativa = 52.4, vagas = 1 where codigo = 'B1-101';
select checa('editar a ficha grava o que mudou, de quanto para quanto',
  exists (select 1 from a1_unidade_eventos where evento = 'EDITADA' and codigo = 'B1-101'
             and detalhe->'campos'->'area_privativa'->>'para' = '52.40'
             and detalhe->'campos'->'vagas'->>'para' = '1'));
select checa('e editar a ficha não mexe na versão da situação',
  (select versao from a1_unidades where codigo = 'B1-101') = 1);

-- ─── 4. PARÂMETROS E MAPA DE PREÇO ───────────────────────────────────────────
insert into a1_parametros_pagamento (id, tenant_id, nome, serie, periodicidade_meses,
    parcelas_min, parcelas_max, exige_vencimento, valor_minimo, quem_paga, ordem) values
  ('9a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Ato','ATO',0,1,1,true,null,'CLIENTE',0),
  ('9a000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Mensais','MENSAL',1,1,72,true,200,'CLIENTE',1),
  ('9a000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Financiamento','FINANCIAMENTO',0,1,1,false,null,'BANCO',2);
insert into a1_parametros_pagamento (tenant_id, nome, serie)
values ('22222222-2222-2222-2222-222222222222','Invasor','ATO');
select checa('parâmetro gravado com o tenant de outro cliente fica no cliente da sessão',
  (select tenant_id from a1_parametros_pagamento where nome = 'Invasor') = '11111111-1111-1111-1111-111111111111');
delete from a1_parametros_pagamento where nome = 'Invasor';
select checa('mais parcelas mínimas que máximas é recusado',
  tenta($$insert into a1_parametros_pagamento (tenant_id, nome, serie, parcelas_min, parcelas_max)
          values ('11111111-1111-1111-1111-111111111111','Torto','MENSAL',10,2)$$) is not null);

insert into a1_mapas_preco (id, tenant_id, empreendimento_id, nome) values
  ('3a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'd1000000-0000-0000-0000-000000000001','Tabela de lançamento');
insert into a1_mapa_preco_itens (tenant_id, mapa_id, unidade_id, valor)
select '11111111-1111-1111-1111-111111111111','3a000000-0000-0000-0000-000000000001', id,
       case codigo when 'B1-101' then 200000 when 'B1-102' then 210000 else 180000 end
  from a1_unidades;
select checa('mapa novo nasce desligado',
  not (select ativo from a1_mapas_preco where id = '3a000000-0000-0000-0000-000000000001'));
select guarda('at', a1_mapa_preco_ativar('3a000000-0000-0000-0000-000000000001'));
select checa('a1_mapa_preco_ativar liga',
  (r('at')->>'ok')::boolean and (select ativo from a1_mapas_preco where id = '3a000000-0000-0000-0000-000000000001'));
select guarda('dup', a1_mapa_preco_duplicar('3a000000-0000-0000-0000-000000000001', 'Reajuste 5%', 5));
select checa('reajuste cria mapa novo com os valores corrigidos, desligado',
  (select i.valor from a1_mapa_preco_itens i join a1_unidades u on u.id = i.unidade_id
    where i.mapa_id = (r('dup')->>'mapa_id')::uuid and u.codigo = 'B1-101') = 210000.00
  and not (select ativo from a1_mapas_preco where id = (r('dup')->>'mapa_id')::uuid));
select a1_mapa_preco_ativar((r('dup')->>'mapa_id')::uuid);
select checa('ativar o reajuste desliga o anterior: um mapa valendo por vez',
  (select count(*) from a1_mapas_preco where ativo) = 1
  and (select ativo from a1_mapas_preco where id = (r('dup')->>'mapa_id')::uuid));
select a1_mapa_preco_ativar('3a000000-0000-0000-0000-000000000001');
select checa('item de preço apontando unidade de fora do empreendimento é recusado',
  tenta($$insert into a1_mapa_preco_itens (tenant_id, mapa_id, unidade_id, valor)
          values ('11111111-1111-1111-1111-111111111111','3a000000-0000-0000-0000-000000000001',
                  gen_random_uuid(), 1000)$$) is not null);

-- ─── 5. QUEM VÊ O QUÊ ────────────────────────────────────────────────────────
select teste_entrar('tk-ana');
select checa('corretor com disp_ver vê as fichas e o preço',
  (select count(*) from a1_unidades) = 5 and (select count(*) from a1_mapa_preco_itens) > 0);
select checa('mas não cria ficha (sem disp_configurar)',
  tenta($$insert into a1_unidades (tenant_id, empreendimento_id, codigo)
          values ('11111111-1111-1111-1111-111111111111','d1000000-0000-0000-0000-000000000001','B1-301')$$) is not null);
update a1_mapa_preco_itens set valor = 1;
select checa('nem altera preço: o UPDATE não alcança linha nenhuma',
  (select min(valor) from a1_mapa_preco_itens) > 1);
select teste_entrar('tk-helena');
select checa('quem não tem disp_ver não lê ficha nenhuma', (select count(*) from a1_unidades) = 0);
select checa('nem reserva',
  tenta($$select a1_unidade_reservar('00000000-0000-0000-0000-000000000000', '{}', '[]')$$) like '%sem_permissao%');
select teste_entrar('tk-outro');
select checa('o vizinho, com a licença, não lê as fichas de A',
  (select count(*) from a1_unidades) = 0 and (select count(*) from a1_unidade_eventos) = 0
  and (select count(*) from a1_parametros_pagamento) = 0 and (select count(*) from a1_mapas_preco) = 0);

-- ─── 6. RESERVAR ─────────────────────────────────────────────────────────────
select teste_entrar('tk-ana');
select guarda('ana', a1_unidade_reservar(
  (select id from a1_unidades where codigo = 'B1-101'),
  '{"titular":{"nome":"Maria Andrade","cpf":"123.456.789-01","renda":5200},
    "conjuge":{"nome":"José Andrade","cpf":"98765432100","renda":3100},
    "associados":[{"nome":"Lúcia Andrade","cpf":"11122233344","parentesco":"mãe","renda":1800}]}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000001","valor":20000,"quantidade":1,"primeiro_vencimento":"2026-11-10"},
    {"parametro_id":"9a000000-0000-0000-0000-000000000002","valor":2000,"quantidade":10,"primeiro_vencimento":"2026-12-10"},
    {"parametro_id":"9a000000-0000-0000-0000-000000000003","valor":160000,"quantidade":1}]',
  1));
select checa('a reserva passa', (r('ana')->>'ok')::boolean, r('ana')::text);
select checa('a unidade fica reservada, na versão 2',
  (select status || '/' || versao from a1_unidades where codigo = 'B1-101') = 'reservado/2');
select checa('a reserva é do corretor que reservou, com prazo de 48h',
  (select corretor_id = 'b0000000-0000-0000-0000-000000000001'
          and expira_em between now() + interval '47 hours' and now() + interval '49 hours'
     from a1_reservas where id = (r('ana')->>'reserva_id')::uuid));
select checa('o rastro diz que reservou, qual reserva e para quem',
  exists (select 1 from a1_unidade_eventos where codigo = 'B1-101' and evento = 'STATUS'
           and de = 'disponivel' and para = 'reservado'
           and detalhe->>'reserva_id' = r('ana')->>'reserva_id'
           and detalhe->>'cliente' = 'Maria Andrade'));
-- A venda é conferida como dono do banco: a Ana só tem as marcas da
-- Disposição, e o que se prova aqui é o que a função gravou, não o que ela lê.
reset role;
select checa('a venda nasce na situação inicial, com a unidade e o fluxo como proposta',
  (select (select flag from a1_co_situacoes where id = c.situacao_id) = 'INICIAL' and c.unidade = 'B1-101'
          and (c.proposta->>'valor_venda')::bigint = 20000000
          and jsonb_array_length(c.proposta->'condicoes_pagamento') = 2
          and (c.origem_snapshot->'credito'->>'valor_aprovado')::bigint = 16000000
          and jsonb_array_length(c.origem_snapshot->'participantes') = 3
     from a1_comerciais c where c.id = (r('ana')->>'comercial_id')::uuid),
  (select jsonb_build_object('sit', situacao_id, 'un', unidade, 'prop', proposta,
          'cred', origem_snapshot->'credito', 'part', origem_snapshot->'participantes')::text
     from a1_comerciais where id = (r('ana')->>'comercial_id')::uuid));

set role anon;

select teste_entrar('tk-bruno');
select guarda('b1', a1_unidade_reservar((select id from a1_unidades where codigo = 'B1-101'),
  '{"titular":{"nome":"Outro","cpf":"00011122233"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000001","valor":200000,"quantidade":1,"primeiro_vencimento":"2026-11-10"}]'));
select checa('a mesma unidade não se reserva duas vezes', r('b1')->>'erro' = 'unidade_reservado', r('b1')::text);
select checa('Bruno vê que a unidade está reservada',
  (select status from a1_unidades where codigo = 'B1-101') = 'reservado');
select checa('mas não lê a reserva da Ana (CPF e renda do cliente dela)',
  (select count(*) from a1_reservas) = 0);
select checa('e não cancela a reserva da Ana',
  tenta(format($$select a1_reserva_cancelar(%L, 'quero a unidade')$$, r('ana')->>'reserva_id')) like '%sem_permissao%');

select guarda('e1', a1_unidade_reservar((select id from a1_unidades where codigo = 'B1-102'),
  '{"titular":{"nome":"Cliente","cpf":"00011122233"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000001","valor":1000,"quantidade":1,"primeiro_vencimento":"2026-11-10"}]'));
select checa('fluxo que não fecha com o preço é recusado', r('e1')->>'erro' = 'fluxo_nao_fecha', r('e1')::text);
select guarda('e2', a1_unidade_reservar((select id from a1_unidades where codigo = 'B1-102'),
  '{"titular":{"nome":"Cliente","cpf":"00011122233"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000002","valor":2100,"quantidade":100,"primeiro_vencimento":"2026-11-10"}]'));
select checa('mais parcelas que o parâmetro aceita é recusado', r('e2')->>'erro' = 'quantidade_fora_do_limite', r('e2')::text);
select guarda('e3', a1_unidade_reservar((select id from a1_unidades where codigo = 'B1-102'),
  '{"titular":{"nome":"Cliente","cpf":"00011122233"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000002","valor":100,"quantidade":10,"primeiro_vencimento":"2026-11-10"}]'));
select checa('parcela abaixo do mínimo é recusada', r('e3')->>'erro' = 'parcela_abaixo_do_minimo', r('e3')::text);
select guarda('e4', a1_unidade_reservar((select id from a1_unidades where codigo = 'B1-102'),
  '{"titular":{"nome":"Cliente","cpf":"00011122233"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000001","valor":210000,"quantidade":1}]'));
select checa('parcela sem vencimento, quando o parâmetro exige, é recusada', r('e4')->>'erro' = 'sem_vencimento', r('e4')::text);
select guarda('e5', a1_unidade_reservar((select id from a1_unidades where codigo = 'B1-102'),
  '{"titular":{"nome":"Cliente","cpf":"123"}}', '[]'));
select checa('CPF incompleto é recusado', r('e5')->>'erro' = 'titular_cpf_invalido', r('e5')::text);
select guarda('e6', a1_unidade_reservar((select id from a1_unidades where codigo = 'B1-102'),
  '{"titular":{"nome":"Cliente","cpf":"00011122233"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000001","valor":210000,"quantidade":1,"primeiro_vencimento":"2026-11-10"}]',
  7));
select checa('versão velha é recusada: alguém mexeu no meio', r('e6')->>'erro' = 'versao_desatualizada', r('e6')::text);
select guarda('e7', a1_unidade_reservar((select id from a1_unidades where codigo = 'B1-102'),
  '{"titular":{"nome":"Cliente","cpf":"00011122233"}}',
  '[{"parametro_id":"00000000-0000-0000-0000-0000000000aa","valor":210000,"quantidade":1}]'));
select checa('parâmetro que não é do cliente não serve', r('e7')->>'erro' = 'parametro_invalido', r('e7')::text);
select checa('nada disso mexeu na unidade',
  (select status || '/' || versao from a1_unidades where codigo = 'B1-102') = 'disponivel/1'
  and not exists (select 1 from a1_unidade_eventos where codigo = 'B1-102' and evento = 'STATUS'));

-- ─── 7. CANCELAR, EXPIRAR ────────────────────────────────────────────────────
select teste_entrar('tk-ana');
select guarda('c0', a1_reserva_cancelar((r('ana')->>'reserva_id')::uuid, ' '));
select checa('cancelar sem motivo é recusado', r('c0')->>'erro' = 'motivo_obrigatorio', r('c0')::text);
select guarda('c1', a1_reserva_cancelar((r('ana')->>'reserva_id')::uuid, 'cliente desistiu'));
select checa('a dona cancela a própria reserva', (r('c1')->>'ok')::boolean, r('c1')::text);
select checa('e a unidade volta a ficar disponível',
  (select status from a1_unidades where codigo = 'B1-101') = 'disponivel'
  and (select status || ':' || motivo from a1_reservas where id = (r('ana')->>'reserva_id')::uuid)
      = 'CANCELADA:cliente desistiu');

select guarda('x1', a1_unidade_reservar((select id from a1_unidades where codigo = 'B1-102'),
  '{"titular":{"nome":"Rui Santos","cpf":"55566677788"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000001","valor":210000,"quantidade":1,"primeiro_vencimento":"2026-11-10"}]'));
reset role;
update a1_reservas set expira_em = now() - interval '1 hour' where id = (r('x1')->>'reserva_id')::uuid;
set role anon;
select teste_entrar('tk-ana');
select guarda('at1', a1_disposicao_atualizar());
select checa('a reserva vencida cai na próxima atualização da tela',
  (r('at1')->>'expiradas')::int = 1
  and (select status from a1_reservas where id = (r('x1')->>'reserva_id')::uuid) = 'EXPIRADA'
  and (select status from a1_unidades where codigo = 'B1-102') = 'disponivel', r('at1')::text);

-- Reserva cuja venda já andou não vence: a unidade é da venda.
select guarda('x2', a1_unidade_reservar((select id from a1_unidades where codigo = 'B1-102'),
  '{"titular":{"nome":"Rui Santos","cpf":"55566677788"}}',
  '[{"parametro_id":"9a000000-0000-0000-0000-000000000001","valor":210000,"quantidade":1,"primeiro_vencimento":"2026-11-10"}]'));
reset role;
select set_config('a1.orquestrador', '1', false);
update a1_comerciais set situacao_id = '5c000000-0000-0000-0000-000000000002'
 where id = (r('x2')->>'comercial_id')::uuid;
update a1_reservas set expira_em = now() - interval '1 hour' where id = (r('x2')->>'reserva_id')::uuid;
select set_config('a1.orquestrador', '', false);
set role anon;
select teste_entrar('tk-ana');
select guarda('at2', a1_disposicao_atualizar());
select checa('reserva com a venda andando não vence',
  (r('at2')->>'expiradas')::int = 0
  and (select status from a1_unidades where codigo = 'B1-102') = 'reservado', r('at2')::text);

-- ─── 8. A VENDA DECIDE O FIM ─────────────────────────────────────────────────
reset role;
select set_config('a1.orquestrador', '1', false);
update a1_comerciais set situacao_id = '5c000000-0000-0000-0000-000000000003'
 where id = (r('x2')->>'comercial_id')::uuid;
-- Venda sem unidade_id (como todas as que já existiam) chegando a VENDIDO:
-- a ficha de mesmo código não pode mudar.
insert into a1_comerciais (id, tenant_id, unidade, situacao_id)
values ('c0000000-0000-0000-0000-0000000000c1','11111111-1111-1111-1111-111111111111','B1-002',
        '5c000000-0000-0000-0000-000000000001');
update a1_comerciais set situacao_id = '5c000000-0000-0000-0000-000000000003'
 where id = 'c0000000-0000-0000-0000-0000000000c1';
select set_config('a1.orquestrador', '', false);
set role anon;
select teste_entrar('tk-gestor');
select checa('venda no selo VENDIDO: unidade vendida e reserva convertida',
  (select status from a1_unidades where codigo = 'B1-102') = 'vendido'
  and (select status from a1_reservas where id = (r('x2')->>'reserva_id')::uuid) = 'CONVERTIDA');
select checa('o rastro diz que foi a venda',
  exists (select 1 from a1_unidade_eventos where codigo = 'B1-102' and para = 'vendido'
           and detalhe->>'origem' = 'venda'));
select checa('venda que não nasceu de reserva não mexe na ficha',
  (select status from a1_unidades where codigo = 'B1-002') = 'disponivel');

-- ─── 9. A MÃO DO GESTOR ──────────────────────────────────────────────────────
select guarda('g1', a1_unidade_definir_status((select id from a1_unidades where codigo = 'B1-102'), 'disponivel'));
select checa('distrato sem motivo é recusado', r('g1')->>'erro' = 'motivo_obrigatorio', r('g1')::text);
select guarda('g2', a1_unidade_definir_status((select id from a1_unidades where codigo = 'B1-102'), 'disponivel',
  'distrato a pedido do cliente'));
select checa('distrato com motivo devolve a unidade',
  (r('g2')->>'ok')::boolean and (select status from a1_unidades where codigo = 'B1-102') = 'disponivel');
select checa('e o rastro marca o distrato com o motivo',
  exists (select 1 from a1_unidade_eventos where codigo = 'B1-102' and de = 'vendido' and para = 'disponivel'
           and (detalhe->>'distrato')::boolean and detalhe->>'motivo' = 'distrato a pedido do cliente'));
select guarda('g3', a1_unidade_definir_status((select id from a1_unidades where codigo = 'B1-001'), 'reservado'));
select checa('o gestor não reserva pela mão: reserva só com cliente e fluxo',
  r('g3')->>'erro' = 'mudanca_nao_permitida', r('g3')::text);
select guarda('g4', a1_unidade_definir_status((select id from a1_unidades where codigo = 'B1-001'), 'bloqueado'));
select checa('bloqueio sem motivo é recusado', r('g4')->>'erro' = 'motivo_obrigatorio', r('g4')::text);
select guarda('g5', a1_unidade_definir_status((select id from a1_unidades where codigo = 'B1-001'), 'bloqueado',
  'reservada para a obra', null, now() - interval '1 minute'));
select checa('bloqueio com motivo e prazo', (r('g5')->>'ok')::boolean
  and (select status from a1_unidades where codigo = 'B1-001') = 'bloqueado', r('g5')::text);
select a1_disposicao_atualizar();
select checa('passado o prazo, o bloqueio cai sozinho',
  (select status || '/' || coalesce(bloqueado_ate::text, '-') from a1_unidades where codigo = 'B1-001') = 'disponivel/-');

select teste_entrar('tk-ana');
select checa('corretor não usa a mão do gestor',
  tenta($$select a1_unidade_definir_status((select id from a1_unidades where codigo = 'B1-002'), 'bloqueado', 'x')$$)
  like '%sem_permissao%');

select teste_entrar('tk-gestor');
select checa('ficha com reserva na história não se apaga',
  tenta($$delete from a1_unidades where codigo = 'B1-101'$$) is not null);
select checa('(e continua lá)', exists (select 1 from a1_unidades where codigo = 'B1-101'));
delete from a1_unidades where codigo = 'B1-201';
select checa('ficha sem história se apaga, e o rastro fica',
  not exists (select 1 from a1_unidades where codigo = 'B1-201')
  and exists (select 1 from a1_unidade_eventos where codigo = 'B1-201' and evento = 'EXCLUIDA'));
select checa('e a lista antiga perde o texto junto',
  (select unit_count from a1_developments where id = 'd1000000-0000-0000-0000-000000000001') = 4);

-- ─── 10. O VIZINHO ───────────────────────────────────────────────────────────
reset role;
select set_config('teste.un_a', (select id::text from a1_unidades where codigo = 'B1-002'), false);
select set_config('teste.rs_a', (r('x2')->>'reserva_id'), false);
set role anon;
select teste_entrar('tk-outro');
select checa('o vizinho não lê reserva, mapa ou rastro de A',
  (select count(*) from a1_reservas) = 0 and (select count(*) from a1_mapa_preco_itens) = 0
  and (select count(*) from a1_unidade_eventos) = 0);
select checa('o vizinho com o id certo de uma unidade de A não reserva',
  tenta(format($$select a1_unidade_reservar(%L, '{"titular":{"nome":"X","cpf":"00011122233"}}', '[]')$$,
    current_setting('teste.un_a'))) like '%nao_encontrado%');
select checa('nem bloqueia',
  tenta(format($$select a1_unidade_definir_status(%L, 'bloqueado', 'x')$$, current_setting('teste.un_a')))
  like '%nao_encontrado%');
select checa('nem cancela reserva de A',
  tenta(format($$select a1_reserva_cancelar(%L, 'x')$$, current_setting('teste.rs_a'))) like '%nao_encontrado%');
update a1_unidades set descricao = 'invadido' where id = current_setting('teste.un_a')::uuid;
reset role;
select checa('nem edita a ficha de A',
  (select descricao from a1_unidades where codigo = 'B1-002') is null);

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
  if f > 0 then raise exception 'PROVA DA DISPOSIÇÃO REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DA DISPOSIÇÃO APROVADA';
end $$;
