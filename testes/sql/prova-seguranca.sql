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
   '{"criar_repasses":true,"editar_repasses":true,"pa_ver":true,"pa_criar":true,"pa_editar":true,"co_ver":true,"co_editar":true}'),
  ('b0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Bruno','10000000002','corretor',null,
   '{"criar_repasses":true,"editar_repasses":true,"pa_ver":true,"pa_criar":true,"pa_editar":true,"co_ver":true,"co_editar":true}'),
  ('b0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Carla','10000000003','analista',null,
   '{"editar_repasses":true,"pa_ver":true,"pa_editar":true,"analisar_credito":true,"co_ver":true}'),
  ('b0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Diego','10000000004','coordenador',null,
   '{"ver_todos_analistas":true,"pa_ver":true,"co_ver":true}'),
  ('b0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','Eva','10000000005','cca',
   'e0000000-0000-0000-0000-000000000001',
   '{"criar_repasses":true,"editar_repasses":true,"pa_ver":true,"pa_criar":true,"co_ver":true}'),
  -- Permissão gravada torta por tela antiga. Não pode derrubar a consulta.
  ('b0000000-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','Fabio','10000000006','corretor',null,
   '{"ver_repasses":"sim","editar_repasses":"","gerente":"nao"}'),
  -- Desligado no cadastro, mas com sessão viva. Não pode enxergar nada.
  ('b0000000-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','Gil','10000000007','corretor',null,
   '{"editar_repasses":true,"pa_ver":true}'),
  -- Helena tem TUDO do Repasse e NADA dos modulos novos. E o caso que prova a
  -- separacao: antes, quem podia editar repasse podia editar pre-analise de
  -- brinde, e liberar um modulo liberava os outros sem ninguem pedir.
  -- ver_todos_analistas de proposito: sob a regra ANTIGA ela enxergaria a
  -- carteira inteira da Pre-analise. Sem essa marca a prova passaria a toa,
  -- porque ela nao tem processo nenhum atribuido.
  ('b0000000-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','Helena','10000000008','corretor',null,
   '{"criar_repasses":true,"editar_repasses":true,"alterar_etapa":true,"ver_todos_analistas":true}');

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
select teste_login_parceiro('tk-helena','b0000000-0000-0000-0000-000000000008');
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

-- ─── 15. O DONO DO PROCESSO É DECIDIDO NO BANCO ──────────────────────────────
-- Fica por último porque cria uma pré-análise a mais, e várias verificações
-- acima contam linhas.
set role anon;
select teste_entrar('tk-bruno');
-- Bruno manda o POST com o corretor_id da Ana: plantar processo na carteira
-- alheia. Nada na tela impede um POST assim; o banco tem de impedir.
insert into a1_pre_analises (id, tenant_id, empreendimento_id, corretor_id)
  values ('80000000-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111',
          'd0000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-000000000001');
select teste_entrar('tk-gestor');
select checa('corretor não planta processo na carteira de outro: o dono vira quem criou',
  (select corretor_id from a1_pre_analises
    where id = '80000000-0000-0000-0000-000000000009')
  = 'b0000000-0000-0000-0000-000000000002');
select checa('e o relógio do SLA nasce junto com o processo',
  (select situacao_em from a1_pre_analises
    where id = '80000000-0000-0000-0000-000000000009') > now() - interval '1 minute');
select checa('e ele cai na situação inicial da esteira do cliente',
  (select situacao_id from a1_pre_analises
    where id = '80000000-0000-0000-0000-000000000009')
  = '50000000-0000-0000-0000-000000000001');
reset role;

-- ─── 16. SESSÃO E PERMISSÃO ──────────────────────────────────────────────────
-- Todas as regras acima param de valer se o corretor conseguir virar gestor.
-- E até esta rodada ele conseguia por dois caminhos, os dois com um PATCH só:
-- copiar o token do dono (a1_sessions era isolada só por cliente) ou reescrever
-- a própria linha de a1_partners, que é de onde a1_perm() lê. As duas travas
-- estão em sql/2026-09-06_travas_sessao_e_parceiro.sql.
set role anon;
select teste_entrar('tk-ana');
select checa('a sessão que o navegador enxerga é só a dele',
  (select count(*) from a1_sessions) = 1
  and (select token from a1_sessions) = 'tk-ana');
select checa('o token do dono da empresa não chega ao navegador do corretor',
  (select count(*) from a1_sessions where token = 'tk-gestor') = 0);
select checa('e ele não se promove a owner na própria sessão',
  tenta($$update a1_sessions set role = 'owner' where token = 'tk-ana'$$) is not null);
select checa('nem apaga a sessão de ninguém pela tabela',
  tenta($$delete from a1_sessions where token = 'tk-gestor'$$) is not null);

select checa('o corretor não reescreve a própria permissão',
  tenta($$update a1_partners set permissions = '{"gerente":true}'::jsonb
           where id = a1_ator()$$) is not null);
select checa('nem aprova ou reativa cadastro de terceiro',
  tenta($$update a1_partners set approved = true, is_active = true
           where id = 'b0000000-0000-0000-0000-000000000007'$$) is not null);
select checa('nem troca o CPF, que é o que liga a sessão ao cadastro',
  tenta($$update a1_partners set cpf = '10000000003' where id = a1_ator()$$) is not null);
select checa('nem cadastra parceiro já nascido com permissão',
  tenta($$insert into a1_partners (tenant_id, name, cpf, type, permissions)
          values ('11111111-1111-1111-1111-111111111111','Fantasma','10000000099',
                  'corretor','{"gerente":true}'::jsonb)$$) is not null);
select checa('nem apaga colega do cadastro',
  tenta($$delete from a1_partners where id = 'b0000000-0000-0000-0000-000000000002'$$) is not null);
-- A trava é sobre PODER, não sobre a tabela: o que não decide acesso continua
-- gravável, senão a correção vira um bloqueio geral disfarçado.
select checa('mas o que não decide poder continua editável',
  tenta($$update a1_partners set name = 'Ana Maria' where id = a1_ator()$$) is null);
select checa('e ele continua não sendo gestor depois de tudo isso',
  a1_e_gestor() = false and a1_perm('gerente') = false
  and a1_perm('analisar_credito') = false);

select teste_entrar('tk-gestor');
select checa('o gestor, esse sim, cadastra e altera permissão como sempre',
  tenta($$update a1_partners set permissions = '{"gerente":true}'::jsonb
           where id = 'b0000000-0000-0000-0000-000000000002'$$) is null);
select checa('e a sessão dele também só devolve a dele',
  (select count(*) from a1_sessions) = 1);
reset role;

-- ─── 16. CADA MÓDULO TEM A PRÓPRIA PERMISSÃO ─────────────────────────────────
-- Helena pode tudo no Repasse e nada nos módulos novos. Antes desta separação,
-- 'editar_repasses' abria os três: liberar um módulo liberava os outros de
-- brinde, e não havia como dar Repasse a alguém sem dar Pré-análise junto.
set role anon;
select teste_entrar('tk-helena');
select checa('visão completa NÃO basta: sem pa_ver não se enxerga pré-análise',
  (select count(*) from a1_pre_analises) = 0);
select checa('e a visão completa dela é real — no Repasse ela vale',
  a1_perm('ver_todos_analistas') = true);
select checa('nem negócio do Comercial',
  (select count(*) from a1_comerciais) = 0);
select checa('e não cria pré-análise',
  tenta($$insert into a1_pre_analises (tenant_id, empreendimento_id)
          values ('11111111-1111-1111-1111-111111111111',
                  'd0000000-0000-0000-0000-000000000001')$$) is not null);
select checa('mas continua com o Repasse dela, intacto',
  a1_perm('editar_repasses') = true and a1_perm('alterar_etapa') = true);
select teste_entrar('tk-ana');
select checa('a Ana enxerga a pré-análise dela como antes',
  (select count(*) from a1_pre_analises) >= 1);

-- ─── 17. O PERFIL MANDA, QUANDO EXISTE ───────────────────────────────────────
select teste_entrar('tk-gestor');
reset role;
insert into a1_perfis (id, tenant_id, nome, permissions) values
  ('f0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'Só leitura', '{"pa_ver":true,"co_ver":true}'),
  ('f0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'Analista pleno', '{"pa_ver":true,"pa_editar":true,"analisar_credito":true}');
set role anon;

select teste_entrar('tk-ana');
select checa('sem perfil, valem as marcas soltas da pessoa',
  a1_perm('pa_criar') = true and a1_perm('pa_editar') = true);

-- O gatilho decide pelo que a SESSÃO diz (a1_papel), não pelo papel do banco:
-- com o cabeçalho da Ana ainda posto, ele barra até o superusuário. Vestir o
-- gestor aqui é o que um administrador de verdade faria.
select teste_entrar('tk-gestor');
reset role;
update a1_partners set perfil_id = 'f0000000-0000-0000-0000-000000000001'
 where id = 'b0000000-0000-0000-0000-000000000001';
set role anon;
select teste_entrar('tk-ana');
-- Este é o ponto do recurso: o perfil substitui, não soma. Com as duas fontes
-- valendo, ninguém saberia dizer olhando a tela por que fulano ainda consegue.
select checa('com perfil, as marcas soltas deixam de valer',
  a1_perm('pa_criar') = false and a1_perm('pa_editar') = false);
select checa('e valem as do perfil', a1_perm('pa_ver') = true);
select checa('quem virou só leitura não move mais a esteira',
  tenta($$select a1_pa_transicionar('80000000-0000-0000-0000-000000000001',
                                    '50000000-0000-0000-0000-000000000002')$$) is not null);

select teste_entrar('tk-gestor');
reset role;
update a1_perfis set permissions = '{"pa_ver":true,"pa_editar":true}'
 where id = 'f0000000-0000-0000-0000-000000000001';
set role anon;
select teste_entrar('tk-ana');
select checa('mudar o PERFIL muda quem está nele, sem tocar na pessoa',
  a1_perm('pa_editar') = true);

select teste_entrar('tk-gestor');
reset role;
update a1_perfis set ativo = false where id = 'f0000000-0000-0000-0000-000000000001';
set role anon;
select teste_entrar('tk-ana');
select checa('perfil desativado volta a pessoa para as marcas dela',
  a1_perm('pa_criar') = true);

-- ─── 18. NINGUÉM ESCOLHE O PRÓPRIO PERFIL ────────────────────────────────────
select checa('o corretor não aponta a si mesmo para outro perfil',
  tenta($$update a1_partners set perfil_id = 'f0000000-0000-0000-0000-000000000002'
           where id = a1_ator()$$) is not null);
select checa('nem cria perfil novo para si',
  tenta($$insert into a1_perfis (tenant_id, nome, permissions)
          values ('11111111-1111-1111-1111-111111111111','Meu perfil',
                  '{"gerente":true}')$$) is not null);
select checa('nem edita o perfil em que está',
  tenta($$update a1_perfis set permissions = '{"gerente":true}'
           where id = 'f0000000-0000-0000-0000-000000000001'$$) is not null
  or (select permissions->>'gerente' from a1_perfis
       where id = 'f0000000-0000-0000-0000-000000000001') is null);
select checa('mas LÊ os perfis — a tela precisa mostrar em qual ele está',
  (select count(*) from a1_perfis) = 2);
select teste_entrar('tk-outro');
select checa('e o outro cliente não vê perfil nenhum deste',
  (select count(*) from a1_perfis) = 0);
select teste_entrar('tk-gestor');
select checa('o gestor, esse sim, cria e edita perfil',
  tenta($$insert into a1_perfis (tenant_id, nome, permissions)
          values ('11111111-1111-1111-1111-111111111111','Novo pelo gestor','{}')$$) is null);
reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- VISIBILIDADE NO REPASSE
--
-- a1_cases só tinha isolamento por CLIENTE: qualquer pessoa dele recebia a
-- carteira inteira pela API, e quem escondia o resto era a tela. Foi relatado
-- em produção — um corretor vendo cartão que não era dele.
--
-- A regra aqui é a MESMA da tela, de propósito: API escondendo o que a tela
-- mostra deixaria o gestor sem saber em qual acreditar.
--
-- Gente NOVA, só para este cenário. Reaproveitar a Ana e o Bruno parecia
-- econômico e não era: as provas de Perfis já os tinham vinculado a um perfil,
-- e o teste do "cadastro antigo" passou a medir o caso do cadastro novo sem
-- ninguém perceber.
-- ═════════════════════════════════════════════════════════════════════════════
reset role;
insert into a1_partners (id, tenant_id, name, cpf, type, permissions) values
  -- Sem a chave ver_todos_analistas e sem perfil: é o cadastro antigo.
  ('bb000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'Vera Antiga','10000000091','corretor','{"criar_repasses":true}'),
  -- Com a chave desligada: é a decisão explícita do gestor.
  ('bb000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'Nara Fechada','10000000092','corretor',
   '{"criar_repasses":true,"ver_todos_analistas":false}');
select teste_login_parceiro('tk-vera','bb000000-0000-0000-0000-000000000001');
select teste_login_parceiro('tk-nara','bb000000-0000-0000-0000-000000000002');

insert into a1_cases (id, tenant_id, module_key, stage_id, client_name, broker_name) values
  ('c2000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'repasse','c0000000-0000-0000-0000-000000000001','Cliente da Nara','Nara Fechada'),
  ('c2000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'repasse','c0000000-0000-0000-0000-000000000001','Cliente da Vera','Vera Antiga');
-- Um processo do OUTRO cliente: o isolamento por tenant continua tendo de valer.
insert into a1_tenant_modules (tenant_id, module_key) values
  ('22222222-2222-2222-2222-222222222222','repasse') on conflict do nothing;
insert into a1_stages (id, tenant_id, module_key, name, position) values
  ('c0000000-0000-0000-0000-000000000009','22222222-2222-2222-2222-222222222222',
   'repasse','Entrada B', 0);
insert into a1_cases (id, tenant_id, module_key, stage_id, client_name, broker_name) values
  ('c2000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222',
   'repasse','c0000000-0000-0000-0000-000000000009','Cliente do outro','Nara Fechada');

set role anon;
-- Conta só os dois processos deste cenário: a esteira das provas anteriores já
-- criou outros em a1_cases, e um total fixo apodreceria a cada teste novo.
select teste_entrar('tk-gestor');
select checa('o gestor continua vendo os dois processos do cliente dele',
  (select count(*) from a1_cases
    where id in ('c2000000-0000-0000-0000-000000000001',
                 'c2000000-0000-0000-0000-000000000002')) = 2);
select checa('e não vê o do outro cliente',
  (select count(*) from a1_cases
    where id = 'c2000000-0000-0000-0000-000000000003') = 0);

-- CADASTRO ANTIGO: sem a chave e sem perfil, ausente vale "vê tudo". É o que a
-- tela faz, e a política tem de espelhar — API escondendo o que a tela mostra
-- deixaria o gestor sem saber em qual acreditar.
select teste_entrar('tk-vera');
select checa('sem a chave e sem perfil, continua enxergando a carteira (como a tela)',
  (select count(*) from a1_cases
    where id in ('c2000000-0000-0000-0000-000000000001',
                 'c2000000-0000-0000-0000-000000000002')) = 2);

-- DECISÃO EXPLÍCITA DO GESTOR: visão completa desligada.
select teste_entrar('tk-nara');
select checa('com a visão fechada, vê só o processo no nome dela',
  (select count(*) from a1_cases
    where id in ('c2000000-0000-0000-0000-000000000001',
                 'c2000000-0000-0000-0000-000000000002')) = 1);
select checa('e o processo que ela vê é o dela mesmo',
  (select client_name from a1_cases
    where id in ('c2000000-0000-0000-0000-000000000001',
                 'c2000000-0000-0000-0000-000000000002')) = 'Cliente da Nara');
select checa('pedindo o da colega pelo id, direto na API, não vem nada',
  (select count(*) from a1_cases
    where id = 'c2000000-0000-0000-0000-000000000002') = 0);
select checa('e o do outro cliente continua fora de alcance',
  (select count(*) from a1_cases
    where id = 'c2000000-0000-0000-0000-000000000003') = 0);

-- PERFIL SEM A CHAVE: ausente passa a valer "não vê". Perfil é sempre novo, não
-- há cadastro antigo para preservar — e foi assim que um corretor com perfil
-- passou a enxergar a carteira inteira em produção.
select teste_entrar('tk-gestor');
insert into a1_perfis (id, tenant_id, nome, permissions, ativo) values
  ('9f000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'Corretor de teste', '{"criar_repasses": true}', true);
update a1_partners set perfil_id = '9f000000-0000-0000-0000-000000000001'
 where id = 'bb000000-0000-0000-0000-000000000001';   -- a Vera, que não tinha a chave
select teste_entrar('tk-vera');
select checa('perfil que não fala de visão NÃO abre a carteira inteira',
  (select count(*) from a1_cases
    where id in ('c2000000-0000-0000-0000-000000000001',
                 'c2000000-0000-0000-0000-000000000002')) = 1);
select checa('e ela vê o dela, não o da colega',
  (select client_name from a1_cases
    where id in ('c2000000-0000-0000-0000-000000000001',
                 'c2000000-0000-0000-0000-000000000002')) = 'Cliente da Vera');

-- PERFIL QUE DIZ QUE VÊ TUDO, vê tudo. A regra é a marca explícita, não o fato
-- de existir perfil.
select teste_entrar('tk-gestor');
update a1_perfis set permissions = '{"criar_repasses": true, "ver_todos_analistas": true}'
 where id = '9f000000-0000-0000-0000-000000000001';
select teste_entrar('tk-vera');
select checa('perfil com visão completa marcada enxerga a carteira',
  (select count(*) from a1_cases
    where id in ('c2000000-0000-0000-0000-000000000001',
                 'c2000000-0000-0000-0000-000000000002')) = 2);

-- ═════════════════════════════════════════════════════════════════════════════
-- DOCUMENTO OBRIGATÓRIO
--
-- A verificação que mais importa é a PRIMEIRA, e ela é negativa: sem nenhum
-- tipo marcado — a situação de todo cliente hoje — a esteira anda igual. Um
-- recurso que travasse quem nunca pediu por ele seria pior que a falta dele.
-- ═════════════════════════════════════════════════════════════════════════════
reset role;
insert into a1_cases (id, tenant_id, module_key, stage_id, client_name, documents) values
  ('c1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'repasse','c0000000-0000-0000-0000-000000000001','Cliente Doc','[]'::jsonb);
insert into a1_stages (id, tenant_id, module_key, name, position) values
  ('c0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'repasse','Análise', 1);

select checa('sem doc_types cadastrado, nada é obrigatório',
  a1_docs_obrigatorios('11111111-1111-1111-1111-111111111111','repasse') = '{}');

-- Lista antiga de strings soltas, gravada por tela de outra época.
insert into a1_config (tenant_id, key, value) values
  ('11111111-1111-1111-1111-111111111111','doc_types','["RG","CPF"]');
select checa('lista de strings soltas não obriga nada',
  a1_docs_obrigatorios('11111111-1111-1111-1111-111111111111','repasse') = '{}');

update a1_config set value = 'isto nao e json'
 where tenant_id = '11111111-1111-1111-1111-111111111111';
select checa('JSON inválido não derruba a consulta — devolve vazio',
  a1_docs_obrigatorios('11111111-1111-1111-1111-111111111111','repasse') = '{}');

select checa('e com nada obrigatório o processo avança de etapa',
  tenta($$update a1_cases set stage_id = 'c0000000-0000-0000-0000-000000000002'
           where id = 'c1000000-0000-0000-0000-000000000001'$$) is null);

-- Agora o gestor marca o RG como obrigatório.
update a1_cases set stage_id = 'c0000000-0000-0000-0000-000000000001'
 where id = 'c1000000-0000-0000-0000-000000000001';
update a1_config set value = '[{"id":"t1","name":"RG","module":"repasse","active":true,"obrigatorio":true},
                               {"id":"t2","name":"CPF","module":"repasse","active":true},
                               {"id":"t3","name":"Antigo","module":"repasse","active":false,"obrigatorio":true},
                               {"id":"t4","name":"Renda","module":"PRE_ANALISE","active":true,"obrigatorio":true}]'
 where tenant_id = '11111111-1111-1111-1111-111111111111';

select checa('só o tipo marcado e ativo obriga, e só no módulo dele',
  a1_docs_obrigatorios('11111111-1111-1111-1111-111111111111','repasse') = '{RG}',
  array_to_string(a1_docs_obrigatorios('11111111-1111-1111-1111-111111111111','repasse'), ','));
select checa('a Pré-análise tem a lista dela',
  a1_docs_obrigatorios('11111111-1111-1111-1111-111111111111','PRE_ANALISE') = '{Renda}');
select checa('e o outro cliente não herda obrigação nenhuma',
  a1_docs_obrigatorios('22222222-2222-2222-2222-222222222222','repasse') = '{}');

select checa('o processo sem o documento não avança',
  tenta($$update a1_cases set stage_id = 'c0000000-0000-0000-0000-000000000002'
           where id = 'c1000000-0000-0000-0000-000000000001'$$)
    like '%documento_obrigatorio_faltando%RG%');

select checa('e o erro diz o nome do que falta, não um código seco',
  a1_case_docs_faltando('c1000000-0000-0000-0000-000000000001') = '{RG}');

update a1_cases set documents = '[{"id":"d1","type":"RG","name":"rg.pdf"}]'::jsonb
 where id = 'c1000000-0000-0000-0000-000000000001';
select checa('com o documento anexado, nada mais falta',
  a1_case_docs_faltando('c1000000-0000-0000-0000-000000000001') = '{}');
select checa('e o processo avança',
  tenta($$update a1_cases set stage_id = 'c0000000-0000-0000-0000-000000000002'
           where id = 'c1000000-0000-0000-0000-000000000001'$$) is null);

-- Voltar de etapa continua livre: corrigir engano não pode depender de anexar
-- documento que ainda não existe. O processo está na etapa 2 e volta para a 1
-- com o dossiê esvaziado — se a trava valesse nos dois sentidos, isto barraria.
update a1_cases set documents = '[]'::jsonb
 where id = 'c1000000-0000-0000-0000-000000000001';
select checa('voltar de etapa sem o documento continua livre',
  tenta($$update a1_cases set stage_id = 'c0000000-0000-0000-0000-000000000001'
           where id = 'c1000000-0000-0000-0000-000000000001'$$) is null);

-- Na Pré-análise a trava mora dentro do orquestrador. Precisa de sessão de
-- verdade: sem ela a1_tenant() é nulo e a função para em 'nao_encontrado'
-- antes de chegar na regra — o teste passaria pelo motivo errado.
--
-- E precisa da pré-análise de volta na situação inicial: as provas anteriores
-- já a moveram, e de 'Aprovada' a transição desenhada não existe — o teste
-- falharia por 'transicao_nao_permitida', que não é o que se quer provar aqui.
-- Só o orquestrador move a esteira, então a reposição pede o mesmo sinal que
-- ele usa; o navegador não tem como ligá-lo.
do $$ begin
  perform set_config('a1.orquestrador','1',true);
  update a1_pre_analises set situacao_id = '50000000-0000-0000-0000-000000000001'
   where id = '80000000-0000-0000-0000-000000000001';
end $$;
set role anon;
select teste_entrar('tk-ana');
select checa('a pré-análise sem o documento obrigatório não transiciona',
  (select tenta($$select a1_pa_transicionar(
     '80000000-0000-0000-0000-000000000001'::uuid,
     '50000000-0000-0000-0000-000000000002'::uuid)$$))
    like '%documento_obrigatorio_faltando%Renda%');

-- O dossiê é do gestor aqui: a1_pa_guarda_documento recusa quem não tem
-- 'analisar_credito' — inclusive o superusuário sem sessão, que é como esta
-- prova estava tentando — e a política de edição ainda exige que a pré-análise
-- seja visível para quem escreve, o que não vale para a analista de outra
-- carteira. O gestor atende às duas condições.
select teste_entrar('tk-gestor');
insert into a1_pa_documentos (tenant_id, pre_analise_id, tipo, storage_key, status) values
  ('11111111-1111-1111-1111-111111111111','80000000-0000-0000-0000-000000000001',
   'Renda','k/renda.pdf','ENVIADO');
select checa('com o documento enviado, o que faltava zera',
  a1_pa_docs_faltando('80000000-0000-0000-0000-000000000001') = '{}');

update a1_pa_documentos set status = 'REPROVADO'
 where pre_analise_id = '80000000-0000-0000-0000-000000000001';
select checa('documento REPROVADO não conta como entregue',
  a1_pa_docs_faltando('80000000-0000-0000-0000-000000000001') = '{Renda}');
reset role;

-- Limpa o cenário para não contaminar quem rodar depois.
update a1_config set value = '[]'
 where tenant_id = '11111111-1111-1111-1111-111111111111';

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
