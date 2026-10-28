-- A criação manual de Repasse é uma atribuição de retaguarda.
-- Gestor pode; Analista e Correspondente (tipo CCA) só podem com a permissão
-- criar_repasses ativa. Corretor não pode criar manualmente.
-- O fluxo automático no selo VENDIDO continua usando a1.orquestrador.
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
    and a1_perm('criar_repasses')
    and (
      a1_e_gestor()
      or coalesce(a1_tipo_ator(), '') in ('analista', 'cca')
    )
  )
);

commit;