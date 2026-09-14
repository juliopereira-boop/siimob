-- Migração segura de posse dos repasses legados.
-- Só preenche responsável quando há exatamente um corretor ativo do MESMO tenant
-- com o mesmo nome normalizado. Casos sem correspondência ficam sem atribuição.
with candidatos as (
  select c.id, min(p.id) as parceiro_id
  from public.a1_cases c
  join public.a1_partners p
    on p.tenant_id = c.tenant_id
   and p.type = 'corretor'
   and coalesce(p.is_active, true)
   and coalesce(p.approved, true)
   and lower(trim(p.name)) = lower(trim(c.broker_name))
  where c.module_key = 'repasse'
    and c.assigned_user_id is null
    and nullif(trim(c.broker_name), '') is not null
  group by c.id
  having count(*) = 1
)
update public.a1_cases c
set assigned_user_id = candidatos.parceiro_id,
    updated_at = now()
from candidatos
where c.id = candidatos.id;

-- Protege a leitura/edição direta no PostgREST. INSERT continua submetido à
-- policy específica de criar repasse; os RPCs controlados continuam funcionando.
create policy a1_cases_repasse_scope_select
on public.a1_cases as restrictive for select to anon, authenticated
using (
  module_key <> 'repasse'
  or a1_e_gestor()
  or a1_case_visao_completa()
  or assigned_user_id = a1_ator()
  or analista_id = a1_ator()
  or correspondente_id = a1_ator()
  or (empresa_id is not null and empresa_id = a1_empresa_ator())
);

create policy a1_cases_repasse_scope_update
on public.a1_cases as restrictive for update to anon, authenticated
using (
  module_key <> 'repasse'
  or a1_e_gestor()
  or a1_case_visao_completa()
  or assigned_user_id = a1_ator()
  or analista_id = a1_ator()
  or correspondente_id = a1_ator()
  or (empresa_id is not null and empresa_id = a1_empresa_ator())
)
with check (
  module_key <> 'repasse'
  or a1_e_gestor()
  or a1_case_visao_completa()
  or assigned_user_id = a1_ator()
  or analista_id = a1_ator()
  or correspondente_id = a1_ator()
  or (empresa_id is not null and empresa_id = a1_empresa_ator())
);