-- Escopo de Repasse sem violar a FK de assigned_user_id.
-- O corretor é uma entidade a1_partners; assigned_user_id referencia a1_users
-- e por isso não pode receber o ID de parceiro. Casos legados continuam sem
-- atribuição artificial, mas o corretor só os lê/edita se o nome vinculado
-- corresponder ao seu parceiro ativo no mesmo tenant.
create policy a1_cases_repasse_scope_select
on public.a1_cases as restrictive for select to anon, authenticated
using (
  module_key <> 'repasse'
  or a1_e_gestor()
  or a1_case_visao_completa()
  or analista_id = a1_ator()
  or correspondente_id = a1_ator()
  or (empresa_id is not null and empresa_id = a1_empresa_ator())
  or exists (
    select 1 from public.a1_partners p
    where p.id = a1_ator()
      and p.tenant_id = a1_cases.tenant_id
      and p.type = 'corretor'
      and lower(trim(p.name)) = lower(trim(coalesce(a1_cases.broker_name,'')))
  )
);

create policy a1_cases_repasse_scope_update
on public.a1_cases as restrictive for update to anon, authenticated
using (
  module_key <> 'repasse'
  or a1_e_gestor()
  or a1_case_visao_completa()
  or analista_id = a1_ator()
  or correspondente_id = a1_ator()
  or (empresa_id is not null and empresa_id = a1_empresa_ator())
  or exists (
    select 1 from public.a1_partners p
    where p.id = a1_ator()
      and p.tenant_id = a1_cases.tenant_id
      and p.type = 'corretor'
      and lower(trim(p.name)) = lower(trim(coalesce(a1_cases.broker_name,'')))
  )
)
with check (
  module_key <> 'repasse'
  or a1_e_gestor()
  or a1_case_visao_completa()
  or analista_id = a1_ator()
  or correspondente_id = a1_ator()
  or (empresa_id is not null and empresa_id = a1_empresa_ator())
  or exists (
    select 1 from public.a1_partners p
    where p.id = a1_ator()
      and p.tenant_id = a1_cases.tenant_id
      and p.type = 'corretor'
      and lower(trim(p.name)) = lower(trim(coalesce(a1_cases.broker_name,'')))
  )
);