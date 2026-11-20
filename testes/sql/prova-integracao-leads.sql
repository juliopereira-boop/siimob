-- =============================================================================
-- PROVA: LEADS DAS INTEGRAÇÕES ENTRAM NA ETAPA DE INÍCIO DO MÓDULO DE LEADS
--
-- Quem chama em produção é a Edge Function meta-leads-webhook, com a chave de
-- serviço. A prova confere: a etapa escolhida (a de INÍCIO do funil certo), o
-- lead sem corretor, o histórico, o evento, a trava contra duplicata, a
-- empresa sem módulo de Leads, e que a chave pública não alcança nada.
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;
create table if not exists il_teste (k text primary key, v text);
truncate il_teste;
create or replace function il(k text) returns text language sql as $$ select v from il_teste where il_teste.k = il.k $$;

insert into a1_modules (key, name) values ('crm', 'Leads') on conflict do nothing;
with x as (insert into a1_tenants (name, slug, status) values ('Imob Com Leads', 'il-com', 'active') returning id)
insert into il_teste select 'com', id::text from x;
with x as (insert into a1_tenants (name, slug, status) values ('Imob Sem Leads', 'il-sem', 'active') returning id)
insert into il_teste select 'sem', id::text from x;
insert into a1_tenant_modules (tenant_id, module_key) values (il('com')::uuid, 'crm');

-- Dois funis com etapa de início e um terceiro SEM etapa marcada como início.
insert into a1_stages (tenant_id, module_key, group_key, name, position, is_initial) values
  (il('com')::uuid, 'crm', 'vendas', 'Contato Estabelecido', 1, false),
  (il('com')::uuid, 'crm', 'vendas', 'Lead Recebido', 2, true),
  (il('com')::uuid, 'crm', 'lancamentos', 'Agendamento Stand', 11, false),
  (il('com')::uuid, 'crm', 'lancamentos', 'Lead de Campanha', 12, true),
  (il('com')::uuid, 'crm', 'locacao', 'Primeiro Contato', 21, false),
  (il('com')::uuid, 'crm', 'locacao', 'Visita', 22, false);
grant select, insert on il_teste to service_role;

\o /dev/null
-- ─── A chave pública não alcança ─────────────────────────────────────────────
set role anon;
select checa('anon não cria lead de integração',
  tenta($$select a1_integracao_criar_lead(null, 'meta', 'x', null, 'a', null, null)$$) is not null);
select checa('anon não lê os leads externos', tenta($$select * from a1_integracao_leads$$) is not null);
reset role;
set role authenticated;
select checa('usuário logado não cria lead de integração',
  tenta($$select a1_integracao_criar_lead(null, 'meta', 'x', null, 'a', null, null)$$) is not null);
reset role;

set role service_role;
-- ─── Sem funil escolhido: o primeiro funil, na etapa de INÍCIO ───────────────
insert into il_teste select 'r1', a1_integracao_criar_lead(il('com')::uuid, 'meta', 'lead-1', null,
  'Maria Souza', '+5598999990001', 'MARIA@Exemplo.com',
  '{"rotulo":"Meta · Lançamento Jardins","observacoes":"Respostas: renda 5 mil","evento":"Lead recebido da Meta · Lançamento Jardins","dados":{"formulario":"901"}}')::text;
select checa('cria o lead', (il('r1')::json->>'ok')::boolean and not (il('r1')::json->>'duplicado')::boolean, il('r1'));
select checa('na etapa de INÍCIO do primeiro funil (não na primeira posição)',
  (select stage_name from a1_cases where id = (il('r1')::json->>'case_id')::uuid) = 'Lead Recebido');
select checa('no módulo de Leads, sem corretor, marcado como novo',
  (select module_key = 'crm' and broker_name is null and is_new from a1_cases where id = (il('r1')::json->>'case_id')::uuid));
select checa('com nome, telefone, e-mail minúsculo e a campanha como origem',
  (select client_name = 'Maria Souza' and client_phone = '+5598999990001' and client_email = 'maria@exemplo.com'
          and partner_name = 'Meta · Lançamento Jardins' and observations like 'Respostas:%'
     from a1_cases where id = (il('r1')::json->>'case_id')::uuid));
select checa('guarda de onde veio em payload.integracao',
  (select payload->'integracao'->>'origem' = 'meta' and payload->'integracao'->>'externo' = 'lead-1'
          and payload->'integracao'->'dados'->>'formulario' = '901'
     from a1_cases where id = (il('r1')::json->>'case_id')::uuid));
select checa('grava o histórico de etapa',
  exists (select 1 from a1_stage_history where case_id = (il('r1')::json->>'case_id')::uuid and stage_name = 'Lead Recebido'));
select checa('grava o evento dizendo a origem',
  exists (select 1 from a1_events where case_id = (il('r1')::json->>'case_id')::uuid and type = 'integracao'
            and description like 'Lead recebido da Meta%'));

-- ─── O mesmo lead de novo: não duplica ───────────────────────────────────────
insert into il_teste select 'r1b', a1_integracao_criar_lead(il('com')::uuid, 'meta', 'lead-1', null, 'Maria Souza', null, null)::text;
select checa('o mesmo lead externo não vira dois',
  (il('r1b')::json->>'duplicado')::boolean and il('r1b')::json->>'case_id' = il('r1')::json->>'case_id'
  and (select count(*) from a1_cases where payload->'integracao'->>'externo' = 'lead-1') = 1, il('r1b'));

-- ─── Funil escolhido ─────────────────────────────────────────────────────────
insert into il_teste select 'r2', a1_integracao_criar_lead(il('com')::uuid, 'meta', 'lead-2', 'lancamentos', 'João', null, null)::text;
select checa('funil escolhido: vai para a etapa de INÍCIO dele',
  (select stage_name from a1_cases where id = (il('r2')::json->>'case_id')::uuid) = 'Lead de Campanha', il('r2'));
insert into il_teste select 'r3', a1_integracao_criar_lead(il('com')::uuid, 'meta', 'lead-3', 'nao-existe', 'Ana', null, null)::text;
select checa('funil que não existe: cai no primeiro funil',
  (select stage_name from a1_cases where id = (il('r3')::json->>'case_id')::uuid) = 'Lead Recebido', il('r3'));
insert into il_teste select 'r4', a1_integracao_criar_lead(il('com')::uuid, 'meta', 'lead-4', 'locacao', null, '+559811', null,
  '{"rotulo":"Meta · Aluguel"}')::text;
select checa('funil sem etapa de início: a primeira etapa dele',
  (select stage_name from a1_cases where id = (il('r4')::json->>'case_id')::uuid) = 'Primeiro Contato', il('r4'));
select checa('sem nome, o lead ganha um nome que diz a origem',
  (select client_name from a1_cases where id = (il('r4')::json->>'case_id')::uuid) = 'Lead Meta · Aluguel');

-- ─── Empresa sem o módulo de Leads ───────────────────────────────────────────
insert into il_teste select 'r5', a1_integracao_criar_lead(il('sem')::uuid, 'meta', 'lead-5', null, 'Pedro', null, null)::text;
select checa('empresa sem o módulo de Leads não recebe lead',
  il('r5')::json->>'erro' = 'sem_modulo_leads'
  and not exists (select 1 from a1_integracao_leads where externo = 'lead-5'), il('r5'));
select checa('origem fora do padrão é recusada',
  a1_integracao_criar_lead(il('com')::uuid, 'Meta Ads!', 'x', null, 'a', null, null)->>'erro' = 'dados_invalidos');
reset role;

-- ─── Funil por formulário (Meta) ─────────────────────────────────────────────
with x as (insert into a1_users (tenant_id, name, role) values (il('com')::uuid, 'Gestor IL', 'owner') returning id)
insert into il_teste select 'u', id::text from x;
insert into siimob_meta_connections (tenant_id, connected_by, access_token, meta_user_id, scopes, connected_at)
  values (il('com')::uuid, il('u')::uuid, 'tok', '1', array['leads_retrieval'], '2026-11-20T10:00:00Z');
insert into siimob_meta_pages (page_id, tenant_id, page_name) values ('777', il('com')::uuid, 'Página IL');
insert into siimob_meta_webhook_events (page_id, leadgen_id, form_id) values ('777', '555', '901');
set role service_role;
-- Chamar e conferir em comandos separados: a consulta enxerga o banco como
-- estava no começo do próprio comando, antes do que a função gravou.
insert into il_teste select 'rf', siimob_meta_replace_forms(il('com')::uuid, '2026-11-20T10:00:00Z', '777',
  '[{"id":"901","name":"Jardins","funil":"lancamentos"},{"id":"902","name":"Geral"}]');
select checa('salvar formulários grava o funil de cada um',
  il('rf') = 'ok'
  and (select funil from siimob_meta_forms where form_id = '901') = 'lancamentos'
  and (select funil from siimob_meta_forms where form_id = '902') is null,
  il('rf') || ' ' || coalesce((select string_agg(form_id || ':' || coalesce(funil, '-'), ',') from siimob_meta_forms), ''));
select checa('funil com caractere estranho é recusado',
  siimob_meta_replace_forms(il('com')::uuid, '2026-11-20T10:00:00Z', '777', '[{"id":"903","name":"X","funil":"a b;"}]') = 'invalid');
select checa('o aviso da Meta nasce como recebido, com tentativas zeradas',
  (select status = 'recebido' and tentativas = 0 from siimob_meta_webhook_events where leadgen_id = '555'));
reset role;

-- =============================================================================
\o
\echo ''
select n, case when passou then 'ok  ' else 'FALHOU' end as r, descr, coalesce(detalhe,'') as detalhe from prova order by n;
select count(*) filter (where passou) as passaram, count(*) filter (where not passou) as falharam, count(*) as total from prova;
do $$
declare f int;
begin
  select count(*) into f from prova where not passou;
  if f > 0 then raise exception 'PROVA DOS LEADS DAS INTEGRAÇÕES REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DOS LEADS DAS INTEGRAÇÕES APROVADA';
end $$;
drop function il(text);
drop table il_teste;
