-- =============================================================================
-- PROVA: CENTRAL DE ATENDIMENTO (módulo ATENDIMENTO)
--
-- Roda como anon com o token no cabeçalho, como o navegador. Confere: módulo
-- desligado não mostra nem cria nada; lead da integração entra na Central só
-- com a licença; na fila, só o gestor vê e conversa; a roleta gira em rodízio
-- entre os participantes ativos; o lead qualificado ganha o corretor e vai
-- para a etapa EM_ATENDIMENTO (criada se faltar); o corretor passa a ver e
-- conversar só com o lead dele; desqualificado vai para Perdido com o motivo;
-- e outro cliente não enxerga nada.
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;
create table if not exists ca_teste (k text primary key, v text);
truncate ca_teste;
grant select, insert, update on ca_teste to anon, service_role;
create or replace function ca(k text) returns text language sql as $$ select v from ca_teste where ca_teste.k = ca.k $$;
grant execute on function ca(text) to anon, service_role;
-- Em produção o navegador lê etapas e eventos (com RLS); o andaime não dava.
grant select on a1_stages, a1_events to anon;

-- As políticas de Leads que produção tem (restritivas, somadas ao isolamento
-- por cliente): o corretor só vê o lead com o nome dele em broker_name.
drop policy if exists a1_cases_crm_scope_select on a1_cases;
create policy a1_cases_crm_scope_select on a1_cases as restrictive for select using (
  (module_key <> 'crm') or (select a1_e_gestor()) or exists (
    select 1 from a1_partners p where p.id = (select a1_ator()) and p.tenant_id = a1_cases.tenant_id
      and p.type = 'corretor' and lower(trim(p.name)) = lower(trim(coalesce(a1_cases.broker_name, '')))));

insert into a1_modules (key, name) values ('crm','Leads') on conflict do nothing;
-- THE CRED (111...) já tem Leads; ganha a Central. O outro cliente (222...) não.
insert into a1_tenant_modules (tenant_id, module_key) values
  ('11111111-1111-1111-1111-111111111111','crm') on conflict do nothing;
insert into a1_tenant_modules (tenant_id, module_key) values
  ('22222222-2222-2222-2222-222222222222','crm') on conflict do nothing;

-- Funil "vendas" de THE CRED: início e Perdido; SEM etapa Em atendimento.
insert into a1_stages (id, tenant_id, module_key, group_key, name, position, is_initial, is_final, selo) values
  ('ca000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','crm','central','Lead Recebido',100,true,false,null),
  ('ca000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','crm','central','Contato',101,false,false,null),
  ('ca000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','crm','central','Perdido',102,false,true,'PERDIDO');

insert into ca_teste values
  ('ana', (select name from a1_partners where id = 'b0000000-0000-0000-0000-000000000001')),
  ('bruno', (select name from a1_partners where id = 'b0000000-0000-0000-0000-000000000002'));
-- Corretores: Ana e Bruno (já existem na prova de segurança; o nome vem do banco). Gil está
-- desligado e fica fora do rodízio mesmo estando na lista.

\o /dev/null
-- ─── 1. Sem a licença: nada aparece, nada é criado ──────────────────────────
reset role;
insert into a1_cases (id, tenant_id, module_key, client_name, stage_id, stage_name, payload, observations)
values ('cb000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','crm','Antes da licença',
        'ca000000-0000-0000-0000-000000000001','Lead Recebido','{"integracao":{"origem":"meta"}}','Respostas');
select checa('sem a licença, lead da integração não abre conversa',
  not exists (select 1 from a1_atendimentos where case_id = 'cb000000-0000-0000-0000-000000000001'));
set role anon;
select teste_entrar('tk-gestor');
select checa('sem a licença, a função de enviar recusa',
  tenta($$select a1_atend_enviar(gen_random_uuid(), 'nota', 'oi')$$) like '%modulo_desabilitado%');

-- ─── 2. Com a licença: o lead da integração entra na Central ────────────────
reset role;
insert into a1_tenant_modules (tenant_id, module_key) values
  ('11111111-1111-1111-1111-111111111111','ATENDIMENTO') on conflict do nothing;
insert into a1_cases (id, tenant_id, module_key, client_name, client_phone, partner_name, stage_id, stage_name, payload, observations)
values ('cb000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','crm','Maria da Meta','98999990001',
        'Meta · Campanha','ca000000-0000-0000-0000-000000000001','Lead Recebido',
        '{"integracao":{"origem":"meta"}}','Formulário: Lançamento\nRenda: 5 mil'),
       ('cb000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','crm','João da Meta','98999990002',
        'Meta · Campanha','ca000000-0000-0000-0000-000000000001','Lead Recebido',
        '{"integracao":{"origem":"meta"}}','Formulário: Lançamento'),
       ('cb000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','crm','Lead à mão',null,
        null,'ca000000-0000-0000-0000-000000000001','Lead Recebido','{}',null),
       ('cb000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','crm','Pedro da Meta',null,
        'Meta','ca000000-0000-0000-0000-000000000001','Lead Recebido','{"integracao":{"origem":"meta"}}',null);
insert into ca_teste select 'a1', id::text from a1_atendimentos where case_id = 'cb000000-0000-0000-0000-000000000002';
insert into ca_teste select 'a2', id::text from a1_atendimentos where case_id = 'cb000000-0000-0000-0000-000000000003';
insert into ca_teste select 'a3', id::text from a1_atendimentos where case_id = 'cb000000-0000-0000-0000-000000000005';
select checa('lead da integração abre conversa na fila, como novo',
  exists (select 1 from a1_atendimentos where id = ca('a1')::uuid and status = 'aberta' and pendente and canal = 'meta'));
select checa('a primeira mensagem traz as respostas do formulário',
  exists (select 1 from a1_atendimento_mensagens where atendimento_id = ca('a1')::uuid
           and autor_tipo = 'sistema' and corpo like '%Renda: 5 mil%'));
select checa('lead cadastrado à mão não entra na Central',
  not exists (select 1 from a1_atendimentos where case_id = 'cb000000-0000-0000-0000-000000000004'));

-- ─── 3. Na fila, só o gestor ────────────────────────────────────────────────
set role anon;
select teste_entrar('tk-gestor');
select checa('o gestor vê a fila', (select count(*) from a1_atendimentos where status = 'aberta') = 3);
select checa('o gestor manda nota', tenta(format($$select a1_atend_enviar(%L, 'nota', 'Liguei, sem resposta')$$, ca('a1'))) is null);
select checa('e a conversa deixa de ser nova, com a prévia da nota',
  (select not pendente and ultima_previa = 'Nota: Liguei, sem resposta' from a1_atendimentos where id = ca('a1')::uuid));
select checa('mensagem vazia é recusada', tenta(format($$select a1_atend_enviar(%L, 'mensagem', '   ')$$, ca('a1'))) like '%mensagem_invalida%');
select checa('o navegador não grava direto na tabela',
  tenta(format($$insert into a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, corpo) values ('11111111-1111-1111-1111-111111111111', %L, 'lead', 'forjada')$$, ca('a1'))) is not null);
select teste_entrar('tk-ana');
select checa('corretor não vê a fila', (select count(*) from a1_atendimentos) = 0);
select checa('corretor não conversa com lead da fila',
  tenta(format($$select a1_atend_enviar(%L, 'mensagem', 'oi')$$, ca('a1'))) like '%sem_permissao%');
select checa('corretor não distribui', tenta(format($$select a1_atend_finalizar(%L, 'qualificado', 1)$$, ca('a1'))) like '%sem_permissao%');
select teste_entrar('tk-outro');
select checa('outro cliente não vê nada da Central', (select count(*) from a1_atendimentos) = 0
  and (select count(*) from a1_atendimento_mensagens) = 0);

-- ─── 4. Roleta ──────────────────────────────────────────────────────────────
select teste_entrar('tk-gestor');
select checa('sem participantes, distribuir avisa que a roleta está vazia',
  tenta(format($$select a1_atend_finalizar(%L, 'qualificado', 1)$$, ca('a1'))) like '%roleta_vazia%');
select checa('só corretor entra na roleta',
  tenta($$select a1_roleta_salvar(array['b0000000-0000-0000-0000-000000000003'::uuid])$$) like '%participante_nao_e_corretor%');
select checa('roleta salva: Gil (desligado), Ana, Bruno',
  tenta($$select a1_roleta_salvar(array['b0000000-0000-0000-0000-000000000007','b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002']::uuid[])$$) is null);
select checa('o próximo da vez pula o desligado: Ana', a1_roleta_proximo_nome() = ca('ana'));
select teste_entrar('tk-ana');
select checa('corretor não salva a roleta', tenta($$select a1_roleta_salvar('{}'::uuid[])$$) like '%sem_permissao%');
select checa('corretor não lê a roleta', (select count(*) from a1_lead_roleta) = 0);

-- ─── 5. Qualificar e distribuir ─────────────────────────────────────────────
select teste_entrar('tk-gestor');
select checa('versão velha é recusada (outra pessoa mexeu)',
  tenta(format($$select a1_atend_finalizar(%L, 'qualificado', 99)$$, ca('a1'))) like '%versao_desatualizada%');
insert into ca_teste values ('r1', (select a1_atend_finalizar(ca('a1')::uuid, 'qualificado', 1))::text);
select checa('qualificado vai para a Ana, na etapa Em atendimento',
  ca('r1')::json->>'corretor' = ca('ana') and ca('r1')::json->>'etapa' = 'Em atendimento', ca('r1'));
select checa('a etapa Em atendimento foi criada no funil, com o selo, logo depois do início',
  (select string_agg(name || ':' || coalesce(selo, '-'), ' > ' order by position) from a1_stages
    where tenant_id = '11111111-1111-1111-1111-111111111111' and group_key = 'central')
  = 'Lead Recebido:- > Em atendimento:EM_ATENDIMENTO > Contato:- > Perdido:PERDIDO',
  (select string_agg(name || ':' || coalesce(selo, '-'), ' > ' order by position) from a1_stages
    where tenant_id = '11111111-1111-1111-1111-111111111111' and group_key = 'central'));
select checa('o lead ganhou a Ana como corretora e o id dela nas referências',
  (select broker_name = ca('ana') and stage_name = 'Em atendimento'
          and payload->'crm_refs'->>'corretor_id' = 'b0000000-0000-0000-0000-000000000001'
     from a1_cases where id = 'cb000000-0000-0000-0000-000000000002'));
select checa('a conversa ficou distribuída, com evento no histórico do lead',
  (select status = 'distribuida' and corretor_nome = ca('ana') from a1_atendimentos where id = ca('a1')::uuid)
  and exists (select 1 from a1_events where case_id = 'cb000000-0000-0000-0000-000000000002' and type = 'distribuicao'));
select checa('finalizar de novo é recusado', tenta(format($$select a1_atend_finalizar(%L, 'qualificado', 2)$$, ca('a1'))) like '%ja_finalizada%');
insert into ca_teste values ('r2', (select a1_atend_finalizar(ca('a2')::uuid, 'qualificado', 1))::text);
select checa('o próximo vai para o Bruno (rodízio)', ca('r2')::json->>'corretor' = ca('bruno'), ca('r2'));
select checa('e a etapa existente é reaproveitada, sem duplicar',
  (select count(*) from a1_stages where tenant_id = '11111111-1111-1111-1111-111111111111' and selo = 'EM_ATENDIMENTO') = 1);
select checa('a vez volta para a Ana', a1_roleta_proximo_nome() = ca('ana'));

-- ─── 6. O corretor conversa com o lead dele ─────────────────────────────────
select teste_entrar('tk-ana');
select checa('a Ana vê só a conversa do lead dela',
  (select string_agg(id::text, ',') from a1_atendimentos) = ca('a1'));
select checa('e o histórico dela', (select count(*) from a1_atendimento_mensagens where atendimento_id = ca('a1')::uuid) >= 3);
select checa('a Ana conversa com o lead dela', tenta(format($$select a1_atend_enviar(%L, 'mensagem', 'Olá Maria!')$$, ca('a1'))) is null);
select checa('a Ana não fala na conversa do Bruno', tenta(format($$select a1_atend_enviar(%L, 'mensagem', 'oi')$$, ca('a2'))) like '%sem_permissao%');
select checa('a mensagem leva o nome de quem mandou',
  exists (select 1 from a1_atendimento_mensagens where atendimento_id = ca('a1')::uuid and autor_nome = ca('ana') and corpo = 'Olá Maria!'));

-- ─── 7. Desqualificar ───────────────────────────────────────────────────────
select teste_entrar('tk-gestor');
select checa('desqualificar sem motivo é recusado',
  tenta(format($$select a1_atend_finalizar(%L, 'desqualificado', 1)$$, ca('a3'))) like '%motivo_obrigatorio%');
select checa('desqualificado com motivo', tenta(format($$select a1_atend_finalizar(%L, 'desqualificado', 1, 'Sem renda', 'Informou renda de 1 mil')$$, ca('a3'))) is null);
select checa('vai para Perdido, com o motivo no lead e sem corretor',
  (select stage_name = 'Perdido' and payload->'perda'->>'motivo' = 'Sem renda' and broker_name is null
     from a1_cases where id = 'cb000000-0000-0000-0000-000000000005'));
select checa('a conversa fica encerrada e não aceita mais mensagem',
  (select status from a1_atendimentos where id = ca('a3')::uuid) = 'encerrada'
  and tenta(format($$select a1_atend_enviar(%L, 'nota', 'x')$$, ca('a3'))) like '%conversa_encerrada%');
select checa('desqualificar não gira a roleta', a1_roleta_proximo_nome() = ca('ana'));

-- ─── 8. Selo novo no editor ─────────────────────────────────────────────────
select checa('o editor aceita o selo EM_ATENDIMENTO',
  tenta($$select a1_crm_definir_selo('ca000000-0000-0000-0000-000000000002', 'EM_ATENDIMENTO')$$) is null);
reset role;
select checa('e o selo continua único por funil (saiu da etapa criada)',
  (select string_agg(name, ',') from a1_stages where selo = 'EM_ATENDIMENTO') = 'Contato');

-- =============================================================================
\o
\echo ''
select n, case when passou then 'ok  ' else 'FALHOU' end as r, descr, coalesce(detalhe,'') as detalhe from prova order by n;
select count(*) filter (where passou) as passaram, count(*) filter (where not passou) as falharam, count(*) as total from prova;
do $$
declare f int;
begin
  select count(*) into f from prova where not passou;
  if f > 0 then raise exception 'PROVA DA CENTRAL DE ATENDIMENTO REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DA CENTRAL DE ATENDIMENTO APROVADA';
end $$;
drop function ca(text);
drop table ca_teste;
