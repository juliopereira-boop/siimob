select set_config('test.tenant','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
select set_config('test.ator','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
set role anon;
do $$ begin if (select count(*) from public.a1_cases) <> 2 then raise exception 'cadastro antigo perdeu acesso'; end if; end $$;
reset role;
update public.a1_partners set permissions='{"crm_etapas":{"33333333-3333-3333-3333-333333333333":"ver","44444444-4444-4444-4444-444444444444":"editar"}}';
set role anon;
do $$ declare n int; begin
 if (select count(*) from public.a1_cases) <> 2 then raise exception 'ver e editar devem ser visíveis'; end if;
 update public.a1_cases set client_name='Alterado' where id='11111111-1111-1111-1111-111111111111'; get diagnostics n=row_count; if n<>0 then raise exception 'somente leitura pôde editar'; end if;
 update public.a1_cases set client_name='Alterado' where id='22222222-2222-2222-2222-222222222222'; get diagnostics n=row_count; if n<>1 then raise exception 'edição autorizada falhou'; end if;
 begin update public.a1_cases set stage_id='33333333-3333-3333-3333-333333333333' where id='22222222-2222-2222-2222-222222222222'; raise exception 'movimento para etapa somente leitura permitido'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.a1_partners set permissions='{"crm_etapas":{}}';
set role anon;
do $$ begin if (select count(*) from public.a1_cases) <> 0 then raise exception 'mapa vazio permitiu acesso'; end if; end $$;
select set_config('test.gestor','true',false);
do $$ begin if (select count(*) from public.a1_cases) <> 2 then raise exception 'gestor perdeu acesso'; end if; end $$;
