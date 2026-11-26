-- =============================================================================
-- PROVA: WHATSAPP OFICIAL (Coexy) COM A EVOLUTION DE RESERVA
--
-- Confere: o navegador não lê o canal oficial nem o segredo do webhook e não
-- chama as funções do servidor; as linhas que já existiam não mudam (envios
-- continuam "evolution", mensagens sem canal); o aviso da Coexy acha o
-- cliente pelo phone_number_id só com a licença; mensagem pelo oficial vira
-- lead e conversa, marcada como oficial, sem duplicar; "criar leads"
-- desligado no oficial segura número novo; o status de entrega só anda para a
-- frente; o envio pelo oficial não conta nos limites da Evolution; e a tela
-- sabe o canal e se há reserva.
-- Roda depois da prova dos conectores (usa o cenário dela).
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;
create table if not exists wo_teste (k text primary key, v text);
truncate wo_teste;
grant select, insert, update on wo_teste to anon, service_role;
create or replace function wo(k text) returns text language sql as $$ select v from wo_teste where wo_teste.k = wo.k $$;
grant execute on function wo(text) to anon, service_role;
grant select on a1_cases, a1_whatsapp_envios to service_role;

\o /dev/null
reset role;
-- Antes: o que já existia
insert into wo_teste values
  ('envios_antes', (select count(*)::text from a1_whatsapp_envios)),
  ('envios_evo', (select count(*)::text from a1_whatsapp_envios where canal = 'evolution')),
  ('msgs_sem_canal', (select count(*)::text from a1_atendimento_mensagens where canal is null and entrega is null)),
  ('msgs_total', (select count(*)::text from a1_atendimento_mensagens));
insert into a1_wa_oficial (tenant_id, channel_id, channel_token, connect_url) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'tok-canal-thecred-000', 'https://coexy.com.br/c/x'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002', 'tok-canal-outro-00000', null)
on conflict do nothing;

-- ─── 1. O navegador não lê nada disso ───────────────────────────────────────
set role anon;
select teste_entrar('tk-gestor');
select checa('anon não lê o canal oficial (token)', tenta('select * from a1_wa_oficial') like '%permission denied%');
select checa('anon não lê o segredo do webhook', tenta('select * from a1_wa_coexy') like '%permission denied%');
select checa('anon não injeta mensagem pelo oficial',
  tenta($$select a1_wa_receber_oficial('11111111-1111-1111-1111-111111111111','5598981234567','x','oi','wamid.x')$$) like '%permission denied%');
select checa('anon não muda status do canal',
  tenta($$select a1_wa_oficial_evento('aaaaaaaa-0000-0000-0000-000000000001','active')$$) like '%permission denied%');
select checa('anon não grava envio', tenta($$select a1_wa_envio_ok('11111111-1111-1111-1111-111111111111', null, 'x', 'x', 'x', 'campanha')$$) like '%permission denied%');
select checa('anon não muda entrega', tenta($$select a1_wa_status('11111111-1111-1111-1111-111111111111', 'x', 'read')$$) like '%permission denied%');
select checa('anon não descobre o cliente pelo número', tenta($$select a1_wa_oficial_tenant('123456')$$) like '%permission denied%');

-- ─── 2. O que já existia não mudou ──────────────────────────────────────────
reset role;
select checa('os envios que já existiam continuam da Evolution', wo('envios_antes') = wo('envios_evo'), wo('envios_antes') || '/' || wo('envios_evo'));
select checa('as mensagens que já existiam seguem sem canal e sem entrega', wo('msgs_sem_canal') = wo('msgs_total'));

-- ─── 3. Status do canal e de quem é o aviso ─────────────────────────────────
set role service_role;
select checa('canal pendente: aviso sem phone_number_id não acha cliente', a1_wa_oficial_tenant('877000000001') is null);
insert into wo_teste values ('ev', a1_wa_oficial_evento('aaaaaaaa-0000-0000-0000-000000000001', 'active', '877000000001', '1167000000001', '+55 98 98888-0000'));
select checa('conectou: guarda ids, número e quando conectou',
  wo('ev') = 'ok' and (select status = 'active' and phone_number_id = '877000000001' and waba_id = '1167000000001'
                         and numero = '5598988880000' and conectado_em is not null
                         from a1_wa_oficial where tenant_id = '11111111-1111-1111-1111-111111111111'));
select checa('o aviso acha o cliente pelo phone_number_id', a1_wa_oficial_tenant('877000000001') = '11111111-1111-1111-1111-111111111111');
select a1_wa_oficial_evento('aaaaaaaa-0000-0000-0000-000000000002', 'active', '877000000002', null, null);
select checa('cliente sem a licença: o aviso não acha ninguém', a1_wa_oficial_tenant('877000000002') is null);
select checa('status inventado é recusado', a1_wa_oficial_evento('aaaaaaaa-0000-0000-0000-000000000001', 'qualquer') = 'status_invalido');
select checa('canal desconhecido', a1_wa_oficial_evento('aaaaaaaa-0000-0000-0000-00000000000f', 'active') = 'nao_encontrado');
insert into wo_teste values ('sd', a1_wa_oficial_saude('aaaaaaaa-0000-0000-0000-000000000001', 'warning', 'Qualidade amarela', 'YELLOW', 'TIER_1K'));
select checa('saúde do número gravada',
  wo('sd') = 'ok' and (select saude = 'warning' and qualidade = 'YELLOW' and limite = 'TIER_1K'
                         from a1_wa_oficial where tenant_id = '11111111-1111-1111-1111-111111111111'));
select checa('saúde inventada é recusada', a1_wa_oficial_saude('aaaaaaaa-0000-0000-0000-000000000001', 'ótima') = 'saude_invalida');

-- ─── 4. Mensagem pelo oficial ───────────────────────────────────────────────
insert into wo_teste values ('r1', a1_wa_receber_oficial('11111111-1111-1111-1111-111111111111', '5598976540001', 'Paula Oficial', 'Olá, vi o anúncio', 'wamid.HBgOFICIAL001')::text);
select checa('número novo pelo oficial vira lead e conversa', (wo('r1')::json->>'lead_novo')::boolean, wo('r1'));
insert into wo_teste values ('at', wo('r1')::json->>'atendimento_id');
select checa('a mensagem fica marcada como do canal oficial',
  exists (select 1 from a1_atendimento_mensagens where externo = 'wamid.HBgOFICIAL001' and canal = 'oficial' and autor_tipo = 'lead'));
select checa('o mesmo aviso de novo (retentativa) não duplica',
  (a1_wa_receber_oficial('11111111-1111-1111-1111-111111111111', '5598976540001', 'Paula', 'Olá, vi o anúncio', 'wamid.HBgOFICIAL001')->>'duplicado')::boolean
  and (select count(*) from a1_atendimento_mensagens where externo = 'wamid.HBgOFICIAL001') = 1);
reset role;
update a1_wa_oficial set criar_leads = false where tenant_id = '11111111-1111-1111-1111-111111111111';
set role service_role;
select checa('"criar leads" desligado no oficial: número novo não vira lead',
  (a1_wa_receber_oficial('11111111-1111-1111-1111-111111111111', '5598976540099', 'X', 'oi', 'wamid.HBgOFICIAL099')->>'ignorado') = 'criar_leads_desligado'
  and not exists (select 1 from a1_cases where a1_wa_chave(client_phone) = '9876540099'));
insert into wo_teste values ('r2', a1_wa_receber_oficial('11111111-1111-1111-1111-111111111111', '5598976540001', 'Paula', 'Tem 3 quartos?', 'wamid.HBgOFICIAL002')::text);
select checa('...mas quem já é lead continua entrando', (wo('r2')::json->>'atendimento_id') = wo('at'), wo('r2'));
reset role;
update a1_wa_oficial set criar_leads = true where tenant_id = '11111111-1111-1111-1111-111111111111';
set role service_role;
insert into wo_teste values ('r3', a1_wa_receber_oficial('11111111-1111-1111-1111-111111111111', '5598976540001', null, 'Respondi pelo app', 'wamid.HBgECO003', true)::text);
select checa('mensagem do app da empresa (coexistência) entra como atendente',
  (wo('r3')::json->>'ok')::boolean
  and exists (select 1 from a1_atendimento_mensagens where externo = 'wamid.HBgECO003' and autor_tipo = 'atendente' and canal = 'oficial'));

-- ─── 5. Envio pelo oficial e entrega ────────────────────────────────────────
insert into wo_teste values ('uso_antes', a1_wa_uso('11111111-1111-1111-1111-111111111111')::text);
insert into wo_teste values ('env', a1_wa_envio_ok('11111111-1111-1111-1111-111111111111', wo('at')::uuid, 'Temos sim, Paula!', 'Gestor', 'wamid.HBgENVIO01', 'resposta', 'atendente', 'oficial')::text);
select checa('o envio pelo oficial entra na conversa como "enviada"',
  (wo('env')::json->>'ok')::boolean
  and exists (select 1 from a1_atendimento_mensagens where externo = 'wamid.HBgENVIO01' and canal = 'oficial' and entrega = 'enviada'));
insert into wo_teste values ('uso_depois', a1_wa_uso('11111111-1111-1111-1111-111111111111')::text);
select checa('o envio oficial não conta nos limites da Evolution',
  (wo('uso_antes')::json->>'dia') = (wo('uso_depois')::json->>'dia')
  and exists (select 1 from a1_whatsapp_envios where canal = 'oficial' and tenant_id = '11111111-1111-1111-1111-111111111111'));
select a1_wa_envio_ok('11111111-1111-1111-1111-111111111111', null, '', null, null, 'campanha', 'ia', 'evolution');
insert into wo_teste values ('uso_evo', a1_wa_uso('11111111-1111-1111-1111-111111111111')::text);
select checa('o envio pela Evolution continua contando',
  (wo('uso_evo')::json->>'dia')::int = (wo('uso_antes')::json->>'dia')::int + 1);
select checa('canal inventado é recusado',
  (a1_wa_envio_ok('11111111-1111-1111-1111-111111111111', null, 'x', 'x', 'x', 'resposta', 'atendente', 'sms')->>'erro') = 'dados_invalidos');
select a1_wa_envio_falha('11111111-1111-1111-1111-111111111111', 'resposta', null, 'oficial');
select checa('falha pelo oficial fica registrada e fora dos limites',
  exists (select 1 from a1_whatsapp_envios where canal = 'oficial' and not ok)
  and (a1_wa_uso('11111111-1111-1111-1111-111111111111')->>'falhas_hora') = (wo('uso_evo')::json->>'falhas_hora'));

select a1_wa_status('11111111-1111-1111-1111-111111111111', 'wamid.HBgENVIO01', 'delivered');
select checa('entregue', (select entrega from a1_atendimento_mensagens where externo = 'wamid.HBgENVIO01') = 'entregue');
select a1_wa_status('11111111-1111-1111-1111-111111111111', 'wamid.HBgENVIO01', 'read');
select a1_wa_status('11111111-1111-1111-1111-111111111111', 'wamid.HBgENVIO01', 'delivered');
select a1_wa_status('11111111-1111-1111-1111-111111111111', 'wamid.HBgENVIO01', 'failed');
select checa('lida não volta para entregue nem para falhou (avisos fora de ordem)',
  (select entrega from a1_atendimento_mensagens where externo = 'wamid.HBgENVIO01') = 'lida');
select a1_wa_envio_ok('11111111-1111-1111-1111-111111111111', wo('at')::uuid, 'Outra', 'Gestor', 'wamid.HBgENVIO02', 'resposta', 'atendente', 'oficial');
select a1_wa_status('11111111-1111-1111-1111-111111111111', 'wamid.HBgENVIO02', 'failed');
select checa('enviada que falhou vira falhou', (select entrega from a1_atendimento_mensagens where externo = 'wamid.HBgENVIO02') = 'falhou');
select checa('status de mensagem de outro cliente não muda nada',
  a1_wa_status('22222222-2222-2222-2222-222222222222', 'wamid.HBgENVIO02', 'read') = 'sem_mudanca');
select checa('status inventado é recusado', a1_wa_status('11111111-1111-1111-1111-111111111111', 'wamid.HBgENVIO02', 'visto') = 'status_invalido');

-- ─── 6. A tela sabe o canal ─────────────────────────────────────────────────
select checa('com oficial ativo há canal', a1_wa_tem_canal('11111111-1111-1111-1111-111111111111'));
set role anon;
select teste_entrar('tk-gestor');
insert into wo_teste values ('lg1', a1_wa_ligado()::text);
select checa('oficial ativo e Evolution conectada: canal oficial, com reserva',
  (wo('lg1')::json->>'ligado')::boolean and wo('lg1')::json->>'canal' = 'oficial'
  and (wo('lg1')::json->>'oficial')::boolean and (wo('lg1')::json->>'reserva')::boolean, wo('lg1'));
reset role;
update a1_wa_oficial set reserva_auto = false where tenant_id = '11111111-1111-1111-1111-111111111111';
set role anon;
select teste_entrar('tk-gestor');
select checa('reserva automática desligada: a tela sabe', not (a1_wa_ligado()->>'reserva')::boolean);
reset role;
select a1_wa_oficial_evento('aaaaaaaa-0000-0000-0000-000000000001', 'disconnected');
update a1_wa_oficial set reserva_auto = true where tenant_id = '11111111-1111-1111-1111-111111111111';
set role anon;
select teste_entrar('tk-gestor');
insert into wo_teste values ('lg2', a1_wa_ligado()::text);
select checa('oficial caiu: segue ligado pela Evolution',
  (wo('lg2')::json->>'ligado')::boolean and wo('lg2')::json->>'canal' = 'evolution' and not (wo('lg2')::json->>'oficial')::boolean, wo('lg2'));
reset role;
update a1_whatsapp_conexoes set estado = 'desconectado' where tenant_id = '11111111-1111-1111-1111-111111111111';
set role anon;
select teste_entrar('tk-gestor');
select checa('sem nenhum canal: desligado', not (a1_wa_ligado()->>'ligado')::boolean and (a1_wa_ligado()->>'canal') is null);
select teste_entrar('tk-outro');
select checa('cliente sem a licença: desligado mesmo com canal ativo', not (a1_wa_ligado()->>'ligado')::boolean);
reset role;
set role service_role;
select checa('sem nenhum canal, a ELIA não tem por onde falar', not a1_wa_tem_canal('11111111-1111-1111-1111-111111111111'));
reset role;
update a1_whatsapp_conexoes set estado = 'conectado' where tenant_id = '11111111-1111-1111-1111-111111111111';

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
  if f > 0 then raise exception 'PROVA DO WHATSAPP OFICIAL REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DO WHATSAPP OFICIAL APROVADA';
end $$;
drop function wo(text);
drop table wo_teste;
