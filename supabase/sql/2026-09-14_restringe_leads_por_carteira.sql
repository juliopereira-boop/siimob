-- Leads são cartões de a1_cases com module_key=crm. A regra restritiva
-- impede que um corretor veja, edite ou crie Lead na carteira de outro.
begin;
drop policy if exists a1_cases_crm_scope_select on public.a1_cases;
drop policy if exists a1_cases_crm_scope_update on public.a1_cases;
drop policy if exists a1_cases_crm_create_scope on public.a1_cases;

create policy a1_cases_crm_scope_select on public.a1_cases as restrictive for select to anon, authenticated
using (module_key<>'crm' or public.a1_e_gestor() or public.a1_case_visao_completa()
  or exists (select 1 from public.a1_partners p where p.id=public.a1_ator()
    and p.tenant_id=a1_cases.tenant_id and p.type='corretor'
    and lower(trim(p.name))=lower(trim(coalesce(a1_cases.broker_name,'')))));

create policy a1_cases_crm_scope_update on public.a1_cases as restrictive for update to anon, authenticated
using (module_key<>'crm' or public.a1_e_gestor() or public.a1_case_visao_completa()
  or exists (select 1 from public.a1_partners p where p.id=public.a1_ator()
    and p.tenant_id=a1_cases.tenant_id and p.type='corretor'
    and lower(trim(p.name))=lower(trim(coalesce(a1_cases.broker_name,'')))))
with check (module_key<>'crm' or public.a1_e_gestor() or public.a1_case_visao_completa()
  or exists (select 1 from public.a1_partners p where p.id=public.a1_ator()
    and p.tenant_id=a1_cases.tenant_id and p.type='corretor'
    and lower(trim(p.name))=lower(trim(coalesce(a1_cases.broker_name,'')))));

create policy a1_cases_crm_create_scope on public.a1_cases as restrictive for insert to anon, authenticated
with check (module_key<>'crm' or public.a1_e_gestor() or public.a1_case_visao_completa()
  or exists (select 1 from public.a1_partners p where p.id=public.a1_ator()
    and p.tenant_id=a1_cases.tenant_id and p.type='corretor'
    and lower(trim(p.name))=lower(trim(coalesce(a1_cases.broker_name,'')))));
commit;