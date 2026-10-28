-- Criação manual de Repasse é uma exceção controlada: a permissão
-- precisa estar explicitamente ativa. A criação automática pela Venda não passa
-- por este caminho; ela usa a função de orquestração a1_criar_repasse_do_comercial.
begin;

drop policy if exists a1_cases_repasse_create_capability on public.a1_cases;

create policy a1_cases_repasse_create_capability
on public.a1_cases
as restrictive
for insert
to public
with check (
  coalesce(module_key, '') <> 'repasse'
  or (
    a1_has_module('repasse')
    and a1_perm_padrao('criar_repasses', false)
  )
);

commit;