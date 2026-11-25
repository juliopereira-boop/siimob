-- PROVA: tabela de preços 2026. Roda num banco próprio, depois da migração
-- aplicada DUAS vezes sobre a1_plans com os planos antigos (como produção).
-- Confere: planos antigos intactos; 5 planos novos; módulos, pacotes e usuário
-- extra; rodar de novo não sobrescreve preço editado; anon não lê a1_precos.
do $$
declare r record;
begin
  if (select count(*) from a1_plans where tabela = '2026') <> 5 then raise exception 'esperava 5 planos 2026'; end if;
  if (select string_agg(key || '=' || price_brl::int || '/' || max_users, ',' order by key) from a1_plans where tabela is null)
     <> 'enterprise=1800/20,pro=1200/10,starter=600/3' then raise exception 'plano antigo mudou'; end if;
  if (select price_brl from a1_plans where key = 'ate20') <> 1500 then raise exception 'ate20 errado'; end if;
  if (select count(*) from a1_precos where tipo = 'modulo') <> 14 then raise exception 'esperava 14 módulos'; end if;
  if (select count(*) from a1_precos where tipo = 'pacote') <> 3 then raise exception 'esperava 3 pacotes'; end if;
  if (select status from a1_precos where chave = 'locacao') <> 'disponivel' then raise exception 'locação deveria estar disponível'; end if;
  -- todo módulo citado num pacote existe na tabela
  for r in select unnest(modulos) m from a1_precos where tipo = 'pacote' loop
    if not exists (select 1 from a1_precos where chave = r.m and tipo = 'modulo') then raise exception 'pacote cita módulo inexistente: %', r.m; end if;
  end loop;
end $$;
-- edição do superadmin sobrevive a rodar a migração de novo
update a1_precos set preco_brl = 420 where chave = 'crm';
update a1_plans set price_brl = 1600 where key = 'ate20';
\i database/migrations/2026-11-25_tabela_de_precos.sql
do $$ begin
  if (select preco_brl from a1_precos where chave = 'crm') <> 420 then raise exception 'migração sobrescreveu preço editado'; end if;
  if (select price_brl from a1_plans where key = 'ate20') <> 1600 then raise exception 'migração sobrescreveu plano editado'; end if;
end $$;
set role anon;
do $$ begin
  begin
    perform 1 from a1_precos limit 1;
    raise exception 'anon leu a1_precos';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo 'PROVA DA TABELA DE PREÇOS APROVADA'
