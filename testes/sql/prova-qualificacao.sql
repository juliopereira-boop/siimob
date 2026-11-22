select set_config('test.tenant','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
select set_config('test.gestor','true',false);
set role anon;
do $$ begin
  begin perform public.a1_atend_qualificacao_manual('22222222-2222-2222-2222-222222222222',1,'{"renda":"1"}'); raise exception 'unexpected success';
  exception when raise_exception then if sqlerrm <> 'elia_ativa' then raise; end if; end;
end $$;
reset role;
set role service_role;
do $$ begin
  if public.a1_elia_qualificacao('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222',1,'33333333-3333-3333-3333-333333333333','{"renda":"2500"}') then raise exception 'falhou isolamento'; end if;
  if not public.a1_elia_qualificacao('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',1,'33333333-3333-3333-3333-333333333333','{"renda":"2500","cidade":"outra"}') then raise exception 'falhou extração'; end if;
  if (select payload->'qualificacao'->>'cidade' from public.a1_cases limit 1) <> 'Natal' then raise exception 'sobrescreveu dado'; end if;
  if (select payload->'integracao'->>'preservar' from public.a1_cases limit 1) <> 'true' then raise exception 'perdeu integração'; end if;
end $$;
reset role;
update public.a1_atendimentos set elia_ativa=false;
set role service_role;
do $$ begin
  if public.a1_elia_qualificacao('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',1,'33333333-3333-3333-3333-333333333333','{"renda":"9999"}') then raise exception 'não bloqueou humano'; end if;
end $$;
reset role;
select set_config('test.tenant','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
select set_config('test.gestor','true',false);
set role anon;
select public.a1_atend_qualificacao_manual('22222222-2222-2222-2222-222222222222',1,'{"renda":"3000"}');
reset role;
do $$ begin
 if (select payload->'qualificacao'->>'renda' from public.a1_cases limit 1) <> '3000' then raise exception 'manual não salvou'; end if;
 if has_function_privilege('anon','public.a1_elia_qualificacao(uuid,uuid,integer,uuid,jsonb)','execute') then raise exception 'função IA pública'; end if;
end $$;
select set_config('test.gestor','false',false);
select set_config('test.tenant','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
set role anon;
do $$ begin
  begin perform public.a1_atend_qualificacao_manual('22222222-2222-2222-2222-222222222222',2,'{"renda":"0"}'); raise exception 'unexpected success';
  exception when raise_exception then if sqlerrm <> 'sem_permissao' then raise; end if; end;
end $$;
reset role;
select set_config('test.gestor','true',false);
select set_config('test.tenant','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
set role anon;
do $$ begin
  begin perform public.a1_atend_qualificacao_manual('22222222-2222-2222-2222-222222222222',2,'{"renda":"0"}'); raise exception 'unexpected success';
  exception when raise_exception then if sqlerrm <> 'conversa_nao_encontrada' then raise; end if; end;
end $$;
reset role;
update public.a1_atendimentos set elia_ativa=true;
set role service_role;
do $$ declare p jsonb; begin
  if not public.a1_elia_qualificacao('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',2,'33333333-3333-3333-3333-333333333333','{"renda":"9999","quartos":"2"}') then raise exception 'falhou retorno IA'; end if;
  if not public.a1_elia_qualificacao('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',2,'33333333-3333-3333-3333-333333333333','{"quartos":"3"}') then raise exception 'falhou atualização IA'; end if;
  select payload into p from public.a1_cases limit 1;
  if p->'qualificacao'->>'renda' <> '3000' or p->'qualificacao'->>'quartos' <> '3' then raise exception 'prioridade de origem falhou'; end if;
end $$;
reset role;
insert into public.a1_atendimento_mensagens values ('44444444-4444-4444-4444-444444444444','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','lead','mensagem',now()+interval '1 second');
set role service_role;
do $$ begin
  if public.a1_elia_qualificacao('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',2,'33333333-3333-3333-3333-333333333333','{"quartos":"4"}') then raise exception 'mensagem antiga foi aceita'; end if;
end $$;
set role service_role;
do $$ declare r boolean; begin
 r := public.a1_elia_qualificacao('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',2,'44444444-4444-4444-4444-444444444444','{"nome":"Ana","email":"ana@example.com","cpf":"12345678900"}');
 if not r or not exists (select 1 from public.a1_cases where client_name='Ana' and client_email='ana@example.com' and client_cpf='12345678900') then raise exception 'contato não salvo'; end if;
 r := public.a1_elia_qualificacao('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',2,'44444444-4444-4444-4444-444444444444','{"email":"outro@example.com"}');
 if not r or not exists (select 1 from public.a1_cases where client_email='ana@example.com') then raise exception 'contato sobrescrito'; end if;
end $$;
reset role;
update public.a1_atendimentos set elia_ativa=false, status='distribuida', corretor_id='55555555-5555-5555-5555-555555555555';
select set_config('test.tenant','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
select set_config('test.gestor','false',false);
select set_config('test.ator','55555555-5555-5555-5555-555555555555',false);
set role anon;
select public.a1_atend_qualificacao_manual('22222222-2222-2222-2222-222222222222',2,'{"cidade":"Recife"}');
reset role;
do $$ begin
 if (select payload->'qualificacao'->>'cidade' from public.a1_cases limit 1) <> 'Recife' then raise exception 'corretor vinculado não salvou'; end if;
end $$;
select set_config('test.ator','66666666-6666-6666-6666-666666666666',false);
set role anon;
do $$ begin
 begin perform public.a1_atend_qualificacao_manual('22222222-2222-2222-2222-222222222222',3,'{"cidade":"Outra"}'); raise exception 'unexpected success';
 exception when raise_exception then if sqlerrm <> 'sem_permissao' then raise; end if; end;
end $$;
select set_config('test.ator','55555555-5555-5555-5555-555555555555',false);
set role anon;
do $$ begin
 begin perform public.a1_atend_qualificacao_manual('22222222-2222-2222-2222-222222222222',2,'{"cidade":"Antiga"}'); raise exception 'unexpected success';
 exception when raise_exception then if sqlerrm <> 'versao_desatualizada' then raise; end if; end;
end $$;
