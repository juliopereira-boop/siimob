-- =============================================================================
-- PROVA: CONECTORES DA CENTRAL (OpenAI e WhatsApp/Evolution)
--
-- Confere: o navegador não lê chave, instância nem contagem; só a chave de
-- serviço chama as funções do servidor; o aviso do WhatsApp só é aceito com o
-- token certo e com a licença; mensagem de número novo vira lead + conversa;
-- de número conhecido (com ou sem o nono dígito) cai na conversa do lead; a
-- mesma mensagem não entra duas vezes; desqualificado que volta a escrever
-- reabre na fila; o envio pela Central respeita as mesmas regras de posse de
-- a1_atend_enviar; e a contagem de uso enxerga resposta x disparo.
-- Roda depois da prova da Central (usa o funil e a licença dela).
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;
create table if not exists cx_teste (k text primary key, v text);
truncate cx_teste;
grant select, insert, update on cx_teste to anon, service_role;
create or replace function cx(k text) returns text language sql as $$ select v from cx_teste where cx_teste.k = cx.k $$;
grant execute on function cx(text) to anon, service_role;
grant insert, select on prova to service_role;
grant usage, select on sequence prova_n_seq to service_role;
grant execute on function checa(text, boolean, text) to service_role;
grant execute on function tenta(text) to service_role;
-- Em produção a chave de serviço lê todas as tabelas; o andaime não dava.
grant select on a1_atendimentos, a1_atendimento_mensagens, a1_whatsapp_conexoes to service_role;

\o /dev/null
reset role;
-- THE CRED (111) tem a Central desde a prova anterior; o outro cliente (222) não.
insert into a1_tenant_modules (tenant_id, module_key) values
  ('11111111-1111-1111-1111-111111111111','ATENDIMENTO') on conflict do nothing;
insert into a1_whatsapp_conexoes (tenant_id, instancia, webhook_token_hash) values
  ('11111111-1111-1111-1111-111111111111', 'siimob-thecred', encode(digest('segredo-1', 'sha256'), 'hex')),
  ('22222222-2222-2222-2222-222222222222', 'siimob-outro', encode(digest('segredo-2', 'sha256'), 'hex'))
on conflict do nothing;
insert into a1_ia_conexoes (tenant_id, chave) values
  ('11111111-1111-1111-1111-111111111111', 'sk-teste-0000000000000000000000001234') on conflict do nothing;

-- ─── 1. O navegador não lê nada disso ───────────────────────────────────────
set role anon;
select teste_entrar('tk-gestor');
select checa('anon não lê a chave da OpenAI', tenta('select * from a1_ia_conexoes') like '%permission denied%');
select checa('anon não lê a conexão do WhatsApp', tenta('select * from a1_whatsapp_conexoes') like '%permission denied%');
select checa('anon não lê a contagem de envios', tenta('select * from a1_whatsapp_envios') like '%permission denied%');
select checa('anon não chama o contexto do servidor', tenta($$select * from a1_conector_contexto('tk-gestor')$$) like '%permission denied%');
select checa('anon não injeta mensagem recebida',
  tenta($$select a1_wa_receber('11111111-1111-1111-1111-111111111111','5598981234567','x','oi','id-x')$$) like '%permission denied%');
select checa('anon não grava envio', tenta($$select a1_wa_registrar_envio('11111111-1111-1111-1111-111111111111', null, 'x', 'x', 'x', 'campanha')$$) like '%permission denied%');
select checa('anon não pausa', tenta($$select a1_wa_pausar('11111111-1111-1111-1111-111111111111', now(), 'x')$$) like '%permission denied%');

-- ─── 2. Quem está pedindo ───────────────────────────────────────────────────
set role service_role;
select checa('o gestor com a licença é reconhecido como gestor',
  (select gestor and tenant_id = '11111111-1111-1111-1111-111111111111' from a1_conector_contexto('tk-gestor')));
select checa('o corretor é reconhecido, mas não como gestor',
  (select not gestor from a1_conector_contexto('tk-ana')));
select checa('cliente sem a licença não passa', not exists (select 1 from a1_conector_contexto('tk-outro')));
select checa('token inventado não passa', not exists (select 1 from a1_conector_contexto('tk-nada')));

-- ─── 3. Aviso do WhatsApp ───────────────────────────────────────────────────
select checa('token certo devolve o cliente', a1_wa_webhook_tenant('siimob-thecred', 'segredo-1') = '11111111-1111-1111-1111-111111111111');
select checa('token errado não', a1_wa_webhook_tenant('siimob-thecred', 'segredo-2') is null);
select checa('instância de outro cliente com o token dele, mas sem licença, não', a1_wa_webhook_tenant('siimob-outro', 'segredo-2') is null);
select checa('chave do telefone: máscara, 55 e nono dígito',
  a1_wa_chave('(98) 98123-4567') = '9881234567' and a1_wa_chave('+55 98 98123-4567') = '9881234567'
  and a1_wa_chave('559881234567') = '9881234567' and a1_wa_chave('123') is null);

-- ─── 4. Número novo vira lead e conversa ────────────────────────────────────
insert into cx_teste values ('r1', a1_wa_receber('11111111-1111-1111-1111-111111111111', '5598981234567', 'Joana Zap', 'Oi, quero saber do Jardins', 'wamid-1')::text);
select checa('a mensagem de número novo cria lead', (cx('r1')::json->>'lead_novo')::boolean, cx('r1'));
insert into cx_teste values ('caso', cx('r1')::json->>'case_id'), ('at', cx('r1')::json->>'atendimento_id');
select checa('o lead é do WhatsApp, com nome e telefone',
  (select payload->'integracao'->>'origem' = 'whatsapp' and client_name = 'Joana Zap' and client_phone = '+5598981234567'
     from a1_cases where id = cx('caso')::uuid));
select checa('a conversa é do canal WhatsApp, na fila e marcada como nova',
  (select canal = 'whatsapp' and status = 'aberta' and pendente from a1_atendimentos where id = cx('at')::uuid));
select checa('a mensagem do lead está na conversa',
  exists (select 1 from a1_atendimento_mensagens where atendimento_id = cx('at')::uuid and autor_tipo = 'lead'
            and corpo = 'Oi, quero saber do Jardins' and externo = 'wamid-1'));
select checa('a mesma mensagem de novo não duplica',
  (a1_wa_receber('11111111-1111-1111-1111-111111111111', '5598981234567', 'Joana Zap', 'Oi, quero saber do Jardins', 'wamid-1')->>'duplicado')::boolean
  and (select count(*) from a1_atendimento_mensagens where externo = 'wamid-1') = 1);
select checa('o mesmo número sem o nono dígito cai na mesma conversa, sem lead novo',
  (a1_wa_receber('11111111-1111-1111-1111-111111111111', '559881234567', 'Joana', 'Tem 2 quartos?', 'wamid-2')->>'atendimento_id') = cx('at')
  and (select count(*) from a1_cases where tenant_id = '11111111-1111-1111-1111-111111111111' and a1_wa_chave(client_phone) = '9881234567') = 1);

-- ─── 5. Lead que já existia ─────────────────────────────────────────────────
reset role;
insert into a1_cases (id, tenant_id, module_key, client_name, client_phone, stage_id, stage_name, payload)
values ('cc000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','crm','Carlos Antigo','(98) 97777-1111',
        'ca000000-0000-0000-0000-000000000001','Lead Recebido','{}');
set role service_role;
insert into cx_teste values ('r2', a1_wa_receber('11111111-1111-1111-1111-111111111111', '5598977771111', 'Carlos', 'Bom dia', 'wamid-3')::text);
select checa('lead cadastrado à mão ganha a conversa quando escreve, sem lead novo',
  (cx('r2')::json->>'case_id') = 'cc000000-0000-0000-0000-000000000001' and not (cx('r2')::json->>'lead_novo')::boolean, cx('r2'));
select checa('mensagem do celular da empresa para número sem conversa é ignorada',
  (a1_wa_receber('11111111-1111-1111-1111-111111111111', '5598900000001', null, 'oi', 'wamid-4', true)->>'ignorado') = 'sem_conversa'
  and not exists (select 1 from a1_cases where a1_wa_chave(client_phone) = '9800000001'));
-- (a função grava num comando e a conferência lê no seguinte: no mesmo
-- comando, a leitura não enxerga o que a função acabou de gravar)
insert into cx_teste values ('r5', a1_wa_receber('11111111-1111-1111-1111-111111111111', '5598977771111', null, 'Bom dia Carlos!', 'wamid-5', true)::text);
select checa('mensagem do celular da empresa na conversa existente entra como atendente',
  (cx('r5')::json->>'ok')::boolean
  and exists (select 1 from a1_atendimento_mensagens where externo = 'wamid-5' and autor_tipo = 'atendente'));

-- ─── 6. Regras de quem recebe ───────────────────────────────────────────────
reset role;
update a1_whatsapp_conexoes set criar_leads = false where tenant_id = '11111111-1111-1111-1111-111111111111';
set role service_role;
select checa('com "criar leads" desligado, número novo não vira lead',
  (a1_wa_receber('11111111-1111-1111-1111-111111111111', '5598911112222', 'X', 'oi', 'wamid-6')->>'ignorado') = 'criar_leads_desligado');
reset role;
update a1_whatsapp_conexoes set criar_leads = true where tenant_id = '11111111-1111-1111-1111-111111111111';
set role service_role;
select checa('cliente sem a licença não recebe nada',
  (a1_wa_receber('22222222-2222-2222-2222-222222222222', '5598911113333', 'X', 'oi', 'wamid-7')->>'erro') = 'modulo_desabilitado');
reset role;
update a1_atendimentos set status = 'encerrada', resultado = 'desqualificado' where id = cx('at')::uuid;
set role service_role;
select a1_wa_receber('11111111-1111-1111-1111-111111111111', '5598981234567', 'Joana', 'Mudei de ideia', 'wamid-8');
select checa('desqualificado que volta a escrever reabre na fila, com aviso',
  (select status = 'aberta' and resultado is null and pendente from a1_atendimentos where id = cx('at')::uuid)
  and exists (select 1 from a1_atendimento_mensagens where atendimento_id = cx('at')::uuid and tipo = 'evento' and corpo like 'O lead voltou%'));

-- ─── 7. Estado e uso ────────────────────────────────────────────────────────
select checa('conectou: guarda número e a primeira conexão', a1_wa_estado('11111111-1111-1111-1111-111111111111', 'conectado', '5598900001111', 'The Cred') = 'ok');
reset role;
insert into cx_teste values ('prim', (select primeira_conexao_em::text from a1_whatsapp_conexoes where tenant_id = '11111111-1111-1111-1111-111111111111'));
update a1_whatsapp_conexoes set primeira_conexao_em = now() - interval '10 days' where tenant_id = '11111111-1111-1111-1111-111111111111';
set role service_role;
select a1_wa_estado('11111111-1111-1111-1111-111111111111', 'desconectado');
select a1_wa_estado('11111111-1111-1111-1111-111111111111', 'conectado');
select checa('reconectar não zera o aquecimento do número',
  (select primeira_conexao_em < now() - interval '9 days' and numero = '5598900001111' and estado = 'conectado'
     from a1_whatsapp_conexoes where tenant_id = '11111111-1111-1111-1111-111111111111') and cx('prim') is not null);
select a1_wa_estado('11111111-1111-1111-1111-111111111111', 'conectado', '5598900002222', 'Outro chip');
select checa('outro número no lugar começa o aquecimento de novo',
  (select primeira_conexao_em > now() - interval '1 minute' and numero = '5598900002222'
     from a1_whatsapp_conexoes where tenant_id = '11111111-1111-1111-1111-111111111111'));
select checa('estado inventado é recusado', a1_wa_estado('11111111-1111-1111-1111-111111111111', 'qualquer') = 'estado_invalido');
select a1_wa_registrar_envio('11111111-1111-1111-1111-111111111111', null, '', null, null, 'campanha');
select a1_wa_registrar_envio('11111111-1111-1111-1111-111111111111', null, '', null, null, 'resposta');
select a1_wa_registrar_falha('11111111-1111-1111-1111-111111111111', 'iniciado');
insert into cx_teste values ('uso', a1_wa_uso('11111111-1111-1111-1111-111111111111')::text);
select checa('o uso separa resposta de disparo e conta falhas',
  (cx('uso')::json->>'dia')::int = 3 and (cx('uso')::json->>'dia_frio')::int = 2 and (cx('uso')::json->>'falhas_hora')::int = 1
  and (cx('uso')::json->>'antigo_dia_frio') is not null, cx('uso'));
insert into cx_teste values ('pausa', a1_wa_pausar('11111111-1111-1111-1111-111111111111', now() + interval '1 hour', 'limite da hora'));
select checa('pausar grava até quando e o motivo',
  cx('pausa') = 'ok'
  and (a1_wa_uso('11111111-1111-1111-1111-111111111111')->>'pausa_motivo') = 'limite da hora');

-- ─── 8. Envio pela Central ──────────────────────────────────────────────────
set role anon;
select teste_entrar('tk-gestor');
insert into cx_teste values ('alvo', a1_atend_wa_alvo(cx('at')::uuid)::text);
select checa('o gestor manda na conversa da fila: telefone com 55 e "lead escreveu"',
  (cx('alvo')::json->>'telefone') = '5598981234567' and (cx('alvo')::json->>'lead_escreveu_24h')::boolean, cx('alvo'));
select checa('a tela sabe que o WhatsApp está ligado e pausado',
  (a1_wa_ligado()->>'ligado')::boolean and (a1_wa_ligado()->>'pausa_motivo') = 'limite da hora');
select teste_entrar('tk-ana');
select checa('o corretor não manda na conversa da fila', tenta(format($$select a1_atend_wa_alvo(%L)$$, cx('at'))) like '%sem_permissao%');
select teste_entrar('tk-outro');
select checa('outro cliente: WhatsApp desligado e conversa inexistente',
  not (a1_wa_ligado()->>'ligado')::boolean and tenta(format($$select a1_atend_wa_alvo(%L)$$, cx('at'))) like '%modulo_desabilitado%');
set role service_role;
select a1_wa_registrar_envio('11111111-1111-1111-1111-111111111111', cx('at')::uuid, 'Olá Joana! Temos sim.', 'Gestor', 'wamid-9', 'resposta');
select checa('a mensagem que saiu entra na conversa, com o id do WhatsApp, e tira o "novo"',
  exists (select 1 from a1_atendimento_mensagens where externo = 'wamid-9' and autor_tipo = 'atendente' and autor_nome = 'Gestor')
  and not (select pendente from a1_atendimentos where id = cx('at')::uuid));
select checa('o aviso de volta do próprio envio (mesmo id) não duplica',
  (a1_wa_receber('11111111-1111-1111-1111-111111111111', '5598981234567', null, 'Olá Joana! Temos sim.', 'wamid-9', true)->>'duplicado')::boolean);
select checa('tipo inventado é recusado',
  (a1_wa_registrar_envio('11111111-1111-1111-1111-111111111111', null, 'x', 'x', 'x', 'spam')->>'erro') = 'dados_invalidos');

-- =============================================================================
reset role;
\o
\echo ''
select n, case when passou then 'ok  ' else 'FALHOU' end as r, descr, coalesce(detalhe,'') as detalhe from prova order by n;
select count(*) filter (where passou) as passaram, count(*) filter (where not passou) as falharam, count(*) as total from prova;
do $$
declare f int;
begin
  select count(*) into f from prova where not passou;
  if f > 0 then raise exception 'PROVA DOS CONECTORES REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DOS CONECTORES APROVADA';
end $$;
drop function cx(text);
drop table cx_teste;
