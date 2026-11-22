insert into a1_cases(id,tenant_id,module_key,payload,client_name,stage_id) values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','crm','{"qualificacao":{"renda":"2500"},"integracao":{"preservar":true}}','Ana','44444444-4444-4444-4444-444444444444');
insert into a1_atendimentos(id,tenant_id,case_id,elia_ativa,status,versao) values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',true,'aberta',1);
insert into a1_atendimento_mensagens(id,tenant_id,atendimento_id,autor_tipo,tipo) values ('33333333-3333-3333-3333-333333333333','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','lead','mensagem');
insert into a1_elia_config values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true,'[{"id":"roleta","type":"roulette","fields":["renda","cidade"]}]');
insert into a1_stages values ('44444444-4444-4444-4444-444444444444','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','crm','vendas',null,'Novo'), ('55555555-5555-5555-5555-555555555555','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','crm','vendas','EM_ATENDIMENTO','Em atendimento');
insert into a1_partners values ('66666666-6666-6666-6666-666666666666','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','corretor',true,true,'Corretor','{}');
insert into a1_lead_roleta values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',array['66666666-6666-6666-6666-666666666666'::uuid],null,null);
set role service_role;
do $$ begin
 if a1_elia_roleta('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222',1,'33333333-3333-3333-3333-333333333333','roleta') <> 'conversa_alterada' then raise exception 'violou isolamento entre empresas'; end if;
 if a1_elia_roleta('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',0,'33333333-3333-3333-3333-333333333333','roleta') <> 'conversa_alterada' then raise exception 'versão antiga foi aceita'; end if;
 if a1_elia_roleta('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',1,'33333333-3333-3333-3333-333333333333','roleta') <> 'qualificacao_incompleta' then raise exception 'deveria exigir cidade'; end if;
 if (select ultimo is not null from a1_lead_roleta) then raise exception 'roleta avançou'; end if;
 update a1_cases set payload=jsonb_set(payload,'{qualificacao,cidade}','"Natal"');
 if a1_elia_roleta('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',1,'33333333-3333-3333-3333-333333333333','roleta') <> 'distribuido' then raise exception 'falhou distribuir'; end if;
 if (select elia_ativa or status <> 'distribuida' from a1_atendimentos) then raise exception 'estado incorreto'; end if;
 if (select payload->'integracao'->>'preservar' from a1_cases) <> 'true' then raise exception 'perdeu dados'; end if;
 if a1_elia_roleta('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',1,'33333333-3333-3333-3333-333333333333','roleta') <> 'conversa_alterada' then raise exception 'execução duplicada'; end if;
end $$;
