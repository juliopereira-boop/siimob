-- PROVA: o nó "Verificar qualificação" distribui pela roleta (fila de distribuição)
-- com os dados obrigatórios do PRÓPRIO nó; nó de outro tipo continua recusado.
-- Roda depois de testes/sql/prova-elia-roleta.sql, no mesmo banco descartável.
reset role;
insert into a1_cases(id,tenant_id,module_key,payload,client_name,stage_id) values ('11111111-1111-1111-1111-000000000009','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','crm','{"qualificacao":{"renda":"3000"}}','Bia','44444444-4444-4444-4444-444444444444');
insert into a1_atendimentos(id,tenant_id,case_id,elia_ativa,status,versao) values ('22222222-2222-2222-2222-000000000009','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-000000000009',true,'aberta',1);
insert into a1_atendimento_mensagens(id,tenant_id,atendimento_id,autor_tipo,tipo) values ('33333333-3333-3333-3333-000000000009','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-000000000009','lead','mensagem');
update a1_elia_config set flow = '[{"id":"qualificar","type":"qualification","fields":["renda","cidade"],"next":"@fila","other":"@continuar"},{"id":"falar","type":"ai","fields":["renda"]}]' where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set role service_role;
do $$ begin
 if a1_elia_roleta('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-000000000009',1,'33333333-3333-3333-3333-000000000009','falar') <> 'configuracao_invalida' then raise exception 'aceitou nó que não é de qualificação nem roleta'; end if;
 if a1_elia_roleta('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-000000000009',1,'33333333-3333-3333-3333-000000000009','qualificar') <> 'qualificacao_incompleta' then raise exception 'qualificação sem cidade passou'; end if;
 update a1_cases set payload=jsonb_set(payload,'{qualificacao,cidade}','"São Luís"') where id='11111111-1111-1111-1111-000000000009';
 if a1_elia_roleta('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-000000000009',1,'33333333-3333-3333-3333-000000000009','qualificar') <> 'distribuido' then raise exception 'qualificação completa não distribuiu'; end if;
 if (select elia_ativa or status <> 'distribuida' or resultado <> 'qualificado' from a1_atendimentos where id='22222222-2222-2222-2222-000000000009') then raise exception 'estado incorreto após distribuir'; end if;
end $$;
\echo 'PROVA DA FILA PELA QUALIFICACAO DA ELIA APROVADA'
