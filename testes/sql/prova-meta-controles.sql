-- =============================================================================
-- PROVA: CONTROLES DA INTEGRAÇÃO META (inativar, desconectar, todos os formulários)
--
-- Quem chama em produção é a Edge Function meta-connect, com a chave de
-- serviço. A prova confere: as colunas novas nascem com o comportamento de
-- antes, a troca de páginas preserva "todos os formulários", inativar mexe só
-- na empresa pedida, desconectar apaga token e páginas mas guarda formulários
-- e avisos, e a chave pública não alcança nenhuma das funções.
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;
create table if not exists mc_teste (k text primary key, v text);
truncate mc_teste;
create or replace function mc(k text) returns text language sql as $$ select v from mc_teste where mc_teste.k = mc.k $$;

with x as (insert into a1_tenants (name, slug, status) values ('Imob A', 'mc-a', 'active') returning id)
insert into mc_teste select 'a', id::text from x;
with x as (insert into a1_tenants (name, slug, status) values ('Imob B', 'mc-b', 'active') returning id)
insert into mc_teste select 'b', id::text from x;
with x as (insert into a1_users (tenant_id, name, role) values (mc('a')::uuid, 'Gestor A', 'owner') returning id)
insert into mc_teste select 'ua', id::text from x;
with x as (insert into a1_users (tenant_id, name, role) values (mc('b')::uuid, 'Gestor B', 'owner') returning id)
insert into mc_teste select 'ub', id::text from x;
insert into siimob_meta_connections (tenant_id, connected_by, access_token, meta_user_id, scopes, connected_at) values
  (mc('a')::uuid, mc('ua')::uuid, 'token-a', '1', '{leads_retrieval}', '2026-11-20T10:00:00Z'),
  (mc('b')::uuid, mc('ub')::uuid, 'token-b', '2', '{leads_retrieval}', '2026-11-20T10:00:00Z');
insert into siimob_meta_pages (tenant_id, page_id, page_name) values
  (mc('a')::uuid, '111', 'Página A1'), (mc('a')::uuid, '112', 'Página A2'), (mc('b')::uuid, '222', 'Página B');
insert into siimob_meta_forms (tenant_id, page_id, form_id, form_name, selected) values
  (mc('a')::uuid, '111', '901', 'Form A', true);
insert into siimob_meta_webhook_events (page_id, leadgen_id, form_id, tenant_id, status) values
  ('111', '5001', '901', mc('a')::uuid, 'criado');
grant select, insert on mc_teste to service_role;

\o /dev/null
-- ─── O padrão é o comportamento de antes ─────────────────────────────────────
select checa('conexões existentes nascem ativas (inclusive as de provas anteriores)',
  (select bool_and(ativo) from siimob_meta_connections));
select checa('páginas existentes nascem só com os formulários marcados',
  (select bool_and(not todos_formularios) from siimob_meta_pages));

-- ─── A chave pública não alcança ─────────────────────────────────────────────
set role anon;
select checa('anon não inativa', tenta($$select siimob_meta_definir_ativo(null, false)$$) is not null);
select checa('anon não desconecta', tenta($$select siimob_meta_desconectar(null)$$) is not null);
select checa('anon não muda opção de página', tenta($$select siimob_meta_pagina_opcoes(null, '1', true)$$) is not null);
reset role;
set role authenticated;
select checa('usuário logado não desconecta', tenta($$select siimob_meta_desconectar(null)$$) is not null);
select checa('usuário logado não inativa', tenta($$select siimob_meta_definir_ativo(null, false)$$) is not null);
reset role;

set role service_role;
-- ─── Todos os formulários ────────────────────────────────────────────────────
select checa('liga "todos" na página da empresa',
  siimob_meta_pagina_opcoes(mc('a')::uuid, '111', true) = 'ok');
select checa('não mexe em página de outra empresa',
  siimob_meta_pagina_opcoes(mc('a')::uuid, '222', true) = 'page_not_selected');
select checa('valor nulo é recusado', siimob_meta_pagina_opcoes(mc('a')::uuid, '111', null) = 'invalid');
reset role;
select checa('só a página pedida mudou',
  (select string_agg(page_id || '=' || todos_formularios, ',' order by page_id) from siimob_meta_pages
    where tenant_id in (mc('a')::uuid, mc('b')::uuid)) = '111=true,112=false,222=false',
  (select string_agg(page_id || '=' || todos_formularios, ',' order by page_id) from siimob_meta_pages
    where tenant_id in (mc('a')::uuid, mc('b')::uuid)));
set role service_role;
select checa('trocar as páginas funciona',
  siimob_meta_replace_pages(mc('a')::uuid, '2026-11-20T10:00:00Z',
    '[{"id":"111","name":"Página A1 nova"},{"id":"113","name":"Página A3"}]') = 'ok');
reset role;
select checa('e preserva "todos" da página que continuou; a nova nasce desligada',
  (select string_agg(page_id || '=' || todos_formularios, ',' order by page_id)
     from siimob_meta_pages where tenant_id = mc('a')::uuid) = '111=true,113=false',
  (select string_agg(page_id || '=' || todos_formularios, ',' order by page_id)
     from siimob_meta_pages where tenant_id = mc('a')::uuid));

-- ─── Inativar ────────────────────────────────────────────────────────────────
set role service_role;
select checa('inativa a empresa A', siimob_meta_definir_ativo(mc('a')::uuid, false) = 'ok');
reset role;
select checa('só a A ficou inativa',
  (select string_agg(ativo::text, ',' order by tenant_id = mc('a')::uuid desc) from siimob_meta_connections
    where tenant_id in (mc('a')::uuid, mc('b')::uuid)) = 'false,true');
select checa('o token continua lá',
  (select access_token from siimob_meta_connections where tenant_id = mc('a')::uuid) = 'token-a');
set role service_role;
select checa('reativa', siimob_meta_definir_ativo(mc('a')::uuid, true) = 'ok');
select checa('empresa sem conexão responde not_connected',
  siimob_meta_definir_ativo(gen_random_uuid(), true) = 'not_connected');

-- ─── Desconectar ─────────────────────────────────────────────────────────────
select checa('desconecta a A', siimob_meta_desconectar(mc('a')::uuid) = 'ok');
select checa('desconectar de novo responde not_connected', siimob_meta_desconectar(mc('a')::uuid) = 'not_connected');
reset role;
select checa('o token da A foi apagado',
  not exists (select 1 from siimob_meta_connections where tenant_id = mc('a')::uuid));
select checa('as páginas da A saíram (liberadas para reconectar)',
  not exists (select 1 from siimob_meta_pages where tenant_id = mc('a')::uuid));
select checa('os formulários marcados ficam guardados',
  exists (select 1 from siimob_meta_forms where tenant_id = mc('a')::uuid and form_id = '901' and selected));
select checa('o histórico de avisos fica',
  exists (select 1 from siimob_meta_webhook_events where leadgen_id = '5001'));
select checa('a empresa B não foi tocada',
  (select count(*) from siimob_meta_connections where tenant_id = mc('b')::uuid) = 1
  and (select count(*) from siimob_meta_pages where tenant_id = mc('b')::uuid) = 1);

-- =============================================================================
\o
\echo ''
select n, case when passou then 'ok  ' else 'FALHOU' end as r, descr, coalesce(detalhe,'') as detalhe from prova order by n;
select count(*) filter (where passou) as passaram, count(*) filter (where not passou) as falharam, count(*) as total from prova;
do $$
declare f int;
begin
  select count(*) into f from prova where not passou;
  if f > 0 then raise exception 'PROVA DOS CONTROLES DA META REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DOS CONTROLES DA META APROVADA';
end $$;
drop function mc(text);
drop table mc_teste;
