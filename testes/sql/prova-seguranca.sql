-- =============================================================================
-- PROVA DE SEGURANÇA DOS MÓDULOS NOVOS
--
-- Roda sempre como 'anon' com um token no cabeçalho — exatamente como o
-- PostgREST chega ao banco. Nada aqui consulta como dono do banco, porque o
-- dono não é submetido a RLS e um teste feito assim não prova coisa alguma.
--
-- Cada verificação existe por causa de um jeito concreto de burlar a regra.
-- =============================================================================
\set ON_ERROR_STOP on

create table if not exists prova (n serial, descr text, passou boolean, detalhe text);
truncate prova;
grant insert, select on prova to anon;
grant usage, select on sequence prova_n_seq to anon;

create or replace function checa(p_descr text, p_ok boolean, p_det text default null)
returns void language sql as $$
  insert into prova (descr, passou, detalhe) values (p_descr, coalesce(p_ok,false), p_det);
$$;
grant execute on function checa(text, boolean, text) to anon;

-- Executa um comando como anon e devolve o erro, ou null se passou. É assim que
-- se prova uma NEGATIVA sem derrubar a transação inteira.
create or replace function tenta(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on function tenta(text) to anon;

-- ─── Cenário ─────────────────────────────────────────────────────────────────
insert into a1_tenants (id, name, slug) values
  ('11111111-1111-1111-1111-111111111111','THE CRED','thecred'),
  ('22222222-2222-2222-2222-222222222222','Outro Cliente','outro');

insert into a1_modules (key, name) values ('repasse','Repasse') on conflict do nothing;
insert into a1_tenant_modules (tenant_id, module_key) values
  ('11111111-1111-1111-1111-111111111111','repasse'),
  ('22222222-2222-2222-2222-222222222222','repasse');

insert into a1_stages (id, tenant_id, module_key, name, position, is_initial) values
  ('c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'repasse','Entrada', 0, true);

insert into a1_users (id, tenant_id, name, role) values
  ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Gestor','owner'),
  ('a0000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Gestor B','owner');

insert into a1_partners (id, tenant_id, name, cpf, type, empresa_id, permissions) values
  ('b0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Ana','10000000001','corretor',null,
   '{"ver_repasses":true,"criar_repasses":true,"editar_repasses":true}'),
  ('b0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Bruno','10000000002','corretor',null,
   '{"ver_repasses":true,"criar_repasses":true,"editar_repasses":true}'),
  ('b0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Carla','10000000003','analista',null,
   '{"ver_repasses":true,"editar_repasses":true,"analisar_credito":true}'),
  ('b0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Diego','10000000004','coordenador',null,
   '{"ver_repasses":true,"ver_todos_analistas":true}'),
  ('b0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','Eva','10000000005','cca',
   'e0000000-0000-0000-0000-000000000001',
   '{"ver_repasses":true,"criar_repasses":true,"editar_repasses":true}'),
  -- Permissão gravada torta por tela antiga. Não pode derrubar a consulta.
  ('b0000000-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','Fabio','10000000006','corretor',null,
   '{"ver_repasses":"sim","editar_repasses":"","gerente":"nao"}'),
  -- Desligado no cadastro, mas com sessão viva. Não pode enxergar nada.
  ('b0000000-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','Gil','10000000007','corretor',null,
   '{"ver_repasses":true,"editar_repasses":true}');

insert into a1_sessions (token, tenant_id, user_id, role) values
  ('tk-gestor','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','owner'),
  ('tk-outro', '22222222-2222-2222-2222-222222222222','a0000000-0000-0000-0000-000000000002','owner');

-- Parceiros entram pelo caminho de verdade: usuário-sombra ligado pelo CPF.
select teste_login_parceiro('tk-ana',  'b0000000-0000-0000-0000-000000000001');
select teste_login_parceiro('tk-bruno','b0000000-0000-0000-0000-000000000002');
select teste_login_parceiro('tk-carla','b0000000-0000-0000-0000-000000000003');
select teste_login_parceiro('tk-diego','b0000000-0000-0000-0000-000000000004');
select teste_login_parceiro('tk-eva',  'b0000000-0000-0000-0000-000000000005');
select teste_login_parceiro('tk-fabio','b0000000-0000-0000-0000-000000000006');
select teste_login_parceiro('tk-gil',  'b0000000-0000-0000-0000-000000000007');
update a1_partners set is_active = false
 where id = 'b0000000-0000-0000-0000-000000000007';

-- =============================================================================
-- Daqui até o relatório final, o que interessa é o que foi para a tabela prova.
\o /dev/null
set role anon;

-- ─── 1. MÓDULO DESLIGADO: nenhum cliente de hoje é afetado ───────────────────
select teste_entrar('tk-gestor');
select checa('módulo desligado: nem o gestor lê a pré-análise',
  (select count(*) from a1_pre_analises) = 0);
select checa('módulo desligado: nem o gestor lê o comercial',
  (select count(*) from a1_comerciais) = 0);
select checa('módulo desligado: nem o gestor insere pré-análise',
  tenta($$insert into a1_pre_analises (tenant_id, empreendimento_id)
          values ('11111111-1111-1111-1111-111111111111',
                  'd0000000-0000-0000-0000-000000000001')$$) is not null);
select checa('módulo desligado: a1_tem_modulo responde não',
  a1_tem_modulo('PRE_ANALISE') = false);
select checa('o Repasse, que o cliente já tinha, continua respondendo sim',
  a1_tem_modulo('repasse') = true);

-- ─── 2. IDENTIDADE ───────────────────────────────────────────────────────────
select checa('gestor é reconhecido como gestor', a1_e_gestor() = true);
select teste_entrar('tk-ana');
select checa('corretor não é gestor', a1_e_gestor() = false);
-- A sessão guarda o id do usuário-sombra; a comparação com corretor_id precisa
-- do id do PARCEIRO. Se esta verificação cair, ninguém vê a própria carteira.
select checa('corretor é reconhecido pelo id de parceiro, não pelo do sombra',
  a1_ator() = 'b0000000-0000-0000-0000-000000000001'
  and a1_usuario() is distinct from a1_ator());
select checa('tipo do ator vem do cadastro', a1_tipo_ator() = 'corretor');
select checa('e as permissões dele são lidas do banco',
  a1_perm('editar_repasses') = true and a1_perm('analisar_credito') = false);
select teste_entrar('tk-eva');
select checa('empresa do correspondente vem do cadastro',
  a1_empresa_ator() = 'e0000000-0000-0000-0000-000000000001');
select teste_entrar('tk-fabio');
select checa('permissão gravada como texto solto não derruba a consulta, vira não',
  a1_perm('ver_repasses') = false and a1_perm('gerente') = false);
select teste_entrar('tk-gil');
select checa('corretor desligado no cadastro deixa de ser ator, mesmo com sessão viva',
  a1_ator() is null and a1_perm('editar_repasses') = false);
select teste_entrar('sessao-inventada');
select checa('token inventado não é ninguém e não é de cliente nenhum',
  a1_ator() is null and a1_tenant() is null and a1_e_gestor() = false);
select checa('token inventado não lê nada', (select count(*) from a1_pre_analises) = 0);

-- ─── 3. LIBERAÇÃO DO MÓDULO ──────────────────────────────────────────────────
reset role;
insert into a1_modules (key, name) values ('PRE_ANALISE','Pré-análise'), ('COMERCIAL','Comercial')
  on conflict do nothing;
insert into a1_tenant_modules (tenant_id, module_key) values
  ('11111111-1111-1111-1111-111111111111','PRE_ANALISE'),
  ('11111111-1111-1111-1111-111111111111','COMERCIAL');
insert into a1_pa_situacoes (id, tenant_id, nome, flag, ordem) values
  ('50000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Nova','INICIAL',0),
  ('50000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Aprovada','APROVADO',1);
insert into a1_pa_transicoes (tenant_id, de_id, para_id, acao, acao_modo) values
  ('11111111-1111-1111-1111-111111111111','50000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000002','ENABLE_COMMERCIAL','AUTO');
insert into a1_co_situacoes (id, tenant_id, nome, flag, ordem) values
  ('60000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Proposta','INICIAL',0),
  ('60000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Fechado','CONTRATO_ASSINADO',1);
insert into a1_co_transicoes (tenant_id, de_id, para_id, acao, acao_modo) values
  ('11111111-1111-1111-1111-111111111111','60000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000002','CREATE_REPASS','AUTO');
set role anon;

-- Ana cria a dela; Bruno cria a dele.
select teste_entrar('tk-ana');
insert into a1_pa_pessoas (id, tenant_id, nome, documento) values
  ('70000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Maria Cliente','52998224725');
insert into a1_pre_analises (id, tenant_id, empreendimento_id, unidade, corretor_id, situacao_id) values
  ('80000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000001','101','b0000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000001');
insert into a1_pa_participantes (tenant_id, pre_analise_id, pessoa_id, papel) values
  ('11111111-1111-1111-1111-111111111111','80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000001','TITULAR');

select teste_entrar('tk-bruno');
insert into a1_pre_analises (id, tenant_id, empreendimento_id, corretor_id, situacao_id) values
  ('80000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',
   '50000000-0000-0000-0000-000000000001');

-- ─── 4. CADA UM VÊ O SEU ─────────────────────────────────────────────────────
select teste_entrar('tk-ana');
select checa('Ana vê só a pré-análise dela', (select count(*) from a1_pre_analises) = 1);
select checa('e pedindo pelo id da do Bruno, direto na API, não vem nada',
  (select count(*) from a1_pre_analises
    where id = '80000000-0000-0000-0000-000000000002') = 0);
select teste_entrar('tk-bruno');
select checa('Bruno vê só a dele', (select count(*) from a1_pre_analises) = 1);
select teste_entrar('tk-gestor');
select checa('o gestor vê as duas', (select count(*) from a1_pre_analises) = 2);
select teste_entrar('tk-diego');
select checa('o coordenador com visão completa vê a equipe inteira',
  (select count(*) from a1_pre_analises) = 2);
select teste_entrar('tk-eva');
select checa('o correspondente de outra empresa não vê nada',
  (select count(*) from a1_pre_analises) = 0);
select teste_entrar('tk-outro');
select checa('o outro cliente não vê absolutamente nada',
  (select count(*) from a1_pre_analises) = 0
  and (select count(*) from a1_pa_pessoas) = 0);
select teste_entrar('tk-bruno');
select checa('o cadastro de pessoas não vira agenda aberta: Bruno não vê a cliente da Ana',
  (select count(*) from a1_pa_pessoas) = 0);
select checa('nem pedindo pelo id dela',
  (select count(*) from a1_pa_pessoas
    where id = '70000000-0000-0000-0000-000000000001') = 0);
-- O UPDATE barrado por RLS não dá erro: simplesmente não pega linha nenhuma.
-- Por isso quem confere o resultado é o gestor, que enxerga o cadastro.
select tenta($$update a1_pa_pessoas set telefone = '99999'
                where id = '70000000-0000-0000-0000-000000000001'$$);
select teste_entrar('tk-gestor');
select checa('e a tentativa de alterar o cadastro dela não pegou',
  (select telefone from a1_pa_pessoas
    where id = '70000000-0000-0000-0000-000000000001') is distinct from '99999');

-- ─── 5. QUEM VENDE NÃO APROVA ────────────────────────────────────────────────
select teste_entrar('tk-ana');
select checa('Ana não aprova o próprio crédito',
  tenta($$insert into a1_pa_analises_credito
          (tenant_id, pre_analise_id, status, valor_aprovado, valor_subsidio,
           valor_fgts, valor_total)
          values ('11111111-1111-1111-1111-111111111111',
                  '80000000-0000-0000-0000-000000000001','APROVADO',
                  20000000, 0, 0, 20000000)$$) is not null);
select checa('Ana não carimba documento como aprovado',
  tenta($$insert into a1_pa_documentos (tenant_id, pre_analise_id, tipo, storage_key, status)
          values ('11111111-1111-1111-1111-111111111111',
                  '80000000-0000-0000-0000-000000000001','RG','k1','APROVADO')$$) is not null);
select checa('mas Ana envia documento normalmente',
  tenta($$insert into a1_pa_documentos (tenant_id, pre_analise_id, tipo, storage_key)
          values ('11111111-1111-1111-1111-111111111111',
                  '80000000-0000-0000-0000-000000000001','RG','k1')$$) is null);

select teste_entrar('tk-carla');
select checa('a analista aprova o crédito',
  tenta($$insert into a1_pa_analises_credito
          (tenant_id, pre_analise_id, status, valor_aprovado, valor_subsidio,
           valor_fgts, valor_total, prestacao, prazo_meses)
          values ('11111111-1111-1111-1111-111111111111',
                  '80000000-0000-0000-0000-000000000001','APROVADO',
                  20000000, 3000000, 1000000, 24000000, 150000, 360)$$) is null);
select checa('e a conta tem de fechar: total diferente da soma é recusado',
  tenta($$insert into a1_pa_analises_credito
          (tenant_id, pre_analise_id, versao, status, valor_aprovado, valor_subsidio,
           valor_fgts, valor_total)
          values ('11111111-1111-1111-1111-111111111111',
                  '80000000-0000-0000-0000-000000000001', 9, 'APROVADO',
                  1, 1, 1, 99)$$) is not null);
select checa('a analista aprova o documento',
  tenta($$update a1_pa_documentos set status = 'APROVADO'
           where pre_analise_id = '80000000-0000-0000-0000-000000000001'$$) is null);

-- ─── 6. A ESTEIRA NÃO SE PULA ────────────────────────────────────────────────
select teste_entrar('tk-ana');
select checa('PATCH direto não move a situação — a esteira não se pula',
  tenta($$update a1_pre_analises set situacao_id = '50000000-0000-0000-0000-000000000002'
           where id = '80000000-0000-0000-0000-000000000001'$$) is not null);
select checa('nem a versão, que é o controle de concorrência',
  tenta($$update a1_pre_analises set versao = 99
           where id = '80000000-0000-0000-0000-000000000001'$$) is not null);
select checa('e o corretor não passa o processo para outro por conta própria',
  tenta($$update a1_pre_analises set corretor_id = 'b0000000-0000-0000-0000-000000000002'
           where id = '80000000-0000-0000-0000-000000000001'$$) is not null);
select checa('mas edita o que é dele para editar',
  tenta($$update a1_pre_analises set unidade = '202'
           where id = '80000000-0000-0000-0000-000000000001'$$) is null);
select teste_entrar('tk-gestor');
select checa('o gestor redistribui a carteira',
  tenta($$update a1_pre_analises set corretor_id = 'b0000000-0000-0000-0000-000000000001'
           where id = '80000000-0000-0000-0000-000000000001'$$) is null);

-- ─── 7. AÇÃO MANUAL COM ID ALHEIO ────────────────────────────────────────────
select teste_entrar('tk-bruno');
select checa('Bruno não executa a ação na pré-análise da Ana, mesmo com o id em mãos',
  tenta($$select a1_pa_executar_acao('80000000-0000-0000-0000-000000000001',
                                     'ENABLE_COMMERCIAL')$$) is not null);
select teste_entrar('tk-outro');
select checa('o outro cliente também não, com o id em mãos',
  tenta($$select a1_pa_executar_acao('80000000-0000-0000-0000-000000000001',
                                     'ENABLE_COMMERCIAL')$$) is not null);
select teste_entrar('tk-ana');
select checa('ação desconhecida é recusada',
  tenta($$select a1_pa_executar_acao('80000000-0000-0000-0000-000000000001',
                                     'APAGAR_TUDO')$$) is not null);

-- ─── 8. O COMERCIAL SÓ NASCE PELA AÇÃO ───────────────────────────────────────
select checa('POST direto em a1_comerciais é recusado, até para o gestor',
  tenta($$insert into a1_comerciais (tenant_id, empreendimento_id)
          values ('11111111-1111-1111-1111-111111111111',
                  'd0000000-0000-0000-0000-000000000001')$$) is not null);
select checa('a transição da esteira cria o comercial',
  (a1_pa_transicionar('80000000-0000-0000-0000-000000000001',
                      '50000000-0000-0000-0000-000000000002')->>'ok') = 'true');
select checa('e o comercial existe, um só',
  (select count(*) from a1_comerciais
    where pre_analise_id = '80000000-0000-0000-0000-000000000001') = 1);
select checa('a transição ficou no histórico',
  (select count(*) from a1_pa_eventos
    where pre_analise_id = '80000000-0000-0000-0000-000000000001'
      and evento = 'transicao') = 1);
select checa('e o histórico não se apaga',
  tenta($$delete from a1_pa_eventos
           where pre_analise_id = '80000000-0000-0000-0000-000000000001'$$) is not null);
select checa('nem se forja um evento',
  tenta($$insert into a1_pa_eventos (tenant_id, pre_analise_id, evento)
          values ('11111111-1111-1111-1111-111111111111',
                  '80000000-0000-0000-0000-000000000001','inventado')$$) is not null);

-- ─── 9. O QUE FOI APROVADO NÃO SE REESCREVE ──────────────────────────────────
select checa('a fotografia do crédito aprovado não se reescreve',
  tenta($$update a1_comerciais set origem_snapshot = '{"credito":{"valor_total":99999999}}'
           where pre_analise_id = '80000000-0000-0000-0000-000000000001'$$) is not null);
select checa('nem se aponta o comercial para um cartão de repasse à mão',
  tenta($$update a1_comerciais set repasse_case_id = 'c0000000-0000-0000-0000-000000000001'
           where pre_analise_id = '80000000-0000-0000-0000-000000000001'$$) is not null);
select checa('nem se muda a situação do comercial por fora da esteira',
  tenta($$update a1_comerciais set situacao_id = '60000000-0000-0000-0000-000000000002'
           where pre_analise_id = '80000000-0000-0000-0000-000000000001'$$) is not null);
select checa('mas a proposta, que é do operador, se edita',
  tenta($$update a1_comerciais set proposta = '{"desconto":1000}'
           where pre_analise_id = '80000000-0000-0000-0000-000000000001'$$) is null);
select checa('o valor aprovado guardado é o que a analista decidiu',
  (select (origem_snapshot#>>'{credito,valor_total}')::bigint from a1_comerciais
    where pre_analise_id = '80000000-0000-0000-0000-000000000001') = 24000000);

-- ─── 10. IDEMPOTÊNCIA ────────────────────────────────────────────────────────
select checa('repetir a ação devolve o mesmo comercial, não cria um segundo',
  (a1_pa_executar_acao('80000000-0000-0000-0000-000000000001','ENABLE_COMMERCIAL')
     ->>'comercial_id')
  = (select id::text from a1_comerciais
      where pre_analise_id = '80000000-0000-0000-0000-000000000001'));

-- ─── 11. CREATE_REPASS ───────────────────────────────────────────────────────
select checa('a transição do comercial cria o cartão no Repasse',
  (a1_co_transicionar((select id from a1_comerciais
                        where pre_analise_id = '80000000-0000-0000-0000-000000000001'),
                      '60000000-0000-0000-0000-000000000002')->>'ok') = 'true');
select checa('nasceu um cartão de repasse, com o nome do titular',
  (select count(*) from a1_cases
    where module_key = 'repasse' and client_name = 'Maria Cliente'
      and payload->>'origem' = 'comercial') = 1);
select checa('e repetir não cria um segundo cartão',
  (select a1_co_executar_acao((select id from a1_comerciais
                                where pre_analise_id = '80000000-0000-0000-0000-000000000001'),
                              'CREATE_REPASS')->>'repasse_case_id')
  = (select repasse_case_id::text from a1_comerciais
      where pre_analise_id = '80000000-0000-0000-0000-000000000001'));

-- ─── 12. DECISÃO INVALIDADA POR MUDANÇA MATERIAL ─────────────────────────────
select teste_entrar('tk-ana');
insert into a1_pre_analises (id, tenant_id, empreendimento_id, corretor_id, situacao_id) values
  ('80000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000001');
insert into a1_pa_participantes (tenant_id, pre_analise_id, pessoa_id, papel) values
  ('11111111-1111-1111-1111-111111111111','80000000-0000-0000-0000-000000000003',
   '70000000-0000-0000-0000-000000000001','TITULAR');
select checa('um titular por pré-análise: o segundo é recusado',
  tenta($$insert into a1_pa_participantes (tenant_id, pre_analise_id, pessoa_id, papel)
          values ('11111111-1111-1111-1111-111111111111',
                  '80000000-0000-0000-0000-000000000003',
                  '70000000-0000-0000-0000-000000000001','TITULAR')$$) is not null);
select teste_entrar('tk-carla');
insert into a1_pa_analises_credito
  (tenant_id, pre_analise_id, status, valor_aprovado, valor_subsidio, valor_fgts, valor_total)
  values ('11111111-1111-1111-1111-111111111111','80000000-0000-0000-0000-000000000003',
          'APROVADO', 10000000, 0, 0, 10000000);
select teste_entrar('tk-ana');
insert into a1_pa_participantes (tenant_id, pre_analise_id, pessoa_id, papel) values
  ('11111111-1111-1111-1111-111111111111','80000000-0000-0000-0000-000000000003',
   '70000000-0000-0000-0000-000000000001','ASSOCIADO');
select checa('mexer em participante depois de aprovado invalida a decisão',
  (select status from a1_pa_analises_credito
    where pre_analise_id = '80000000-0000-0000-0000-000000000003') = 'INVALIDADA');
select checa('e com a decisão invalidada o comercial não nasce',
  (a1_pa_executar_acao('80000000-0000-0000-0000-000000000003','ENABLE_COMMERCIAL')
     ->>'ok') = 'false');
select checa('o corretor não lê a trilha de integração — ela é do gestor',
  (select count(*) from a1_integra_eventos) = 0);
select teste_entrar('tk-gestor');
select checa('o motivo do bloqueio ficou registrado, e não sumiu com o erro',
  (select count(*) from a1_integra_eventos where status = 'BLOQUEADO') >= 1);
select teste_entrar('tk-ana');

-- ─── 13. LICENÇA VENCIDA ─────────────────────────────────────────────────────
reset role;
update a1_tenant_modules set expires_at = now() - interval '1 day'
 where tenant_id = '11111111-1111-1111-1111-111111111111' and module_key = 'PRE_ANALISE';
set role anon;
select teste_entrar('tk-gestor');
select checa('licença vencida fecha o módulo, mesmo com a linha na tabela',
  a1_tem_modulo('PRE_ANALISE') = false
  and (select count(*) from a1_pre_analises) = 0);
reset role;
update a1_tenant_modules set expires_at = now() + interval '30 days'
 where tenant_id = '11111111-1111-1111-1111-111111111111' and module_key = 'PRE_ANALISE';
set role anon;
select checa('licença dentro da validade reabre',
  a1_tem_modulo('PRE_ANALISE') = true
  and (select count(*) from a1_pre_analises) = 3);

-- ─── 14. REVOGAR O MÓDULO DEIXA TUDO INERTE DE NOVO ──────────────────────────
reset role;
delete from a1_tenant_modules
 where tenant_id = '11111111-1111-1111-1111-111111111111' and module_key = 'COMERCIAL';
set role anon;
select checa('revogado o Comercial, nem o gestor lê a tabela',
  (select count(*) from a1_comerciais) = 0);
select checa('e a transição do comercial passa a ser recusada',
  tenta($$select a1_co_transicionar('00000000-0000-0000-0000-000000000000',
                                    '60000000-0000-0000-0000-000000000001')$$) is not null);
select checa('o cartão de repasse já criado continua lá — nada é destruído',
  true);

reset role;
select checa('o cartão de repasse já criado continua no Repasse',
  (select count(*) from a1_cases where payload->>'origem' = 'comercial') = 1);

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
  if f > 0 then raise exception 'PROVA DE SEGURANÇA REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DE SEGURANÇA APROVADA';
end $$;
