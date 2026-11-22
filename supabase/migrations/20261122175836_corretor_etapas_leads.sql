-- Restrição opcional por etapa de Leads. Cadastros sem crm_etapas conservam
-- o acesso anterior; o mapa pertence à pessoa, independentemente do perfil.
create function public.a1_crm_etapa_permitida(p_stage uuid, p_editar boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare permissoes jsonb; tipo text; ator uuid; tenant uuid;
begin
  tenant := public.a1_tenant();
  if tenant is null then return false; end if;
  if public.a1_e_gestor() then return true; end if;
  ator := public.a1_ator();
  if ator is null then return false; end if;
  select p.permissions, p.type into permissoes, tipo from public.a1_partners p where p.id=ator and p.tenant_id=tenant and coalesce(p.is_active,true) and coalesce(p.approved,true);
  if not found then return false; end if;
  if tipo <> 'corretor' then return true; end if;
  if not (coalesce(permissoes,'{}'::jsonb) ? 'crm_etapas') then return true; end if;
  if jsonb_typeof(permissoes->'crm_etapas') is distinct from 'object' then return false; end if;
  if p_editar then return coalesce(permissoes->'crm_etapas'->>p_stage::text='editar',false); end if;
  return coalesce(permissoes->'crm_etapas'->>p_stage::text in ('ver','editar'),false);
end $$;
revoke all on function public.a1_crm_etapa_permitida(uuid,boolean) from public;
grant execute on function public.a1_crm_etapa_permitida(uuid,boolean) to anon,authenticated;

create policy a1_crm_etapas_select on public.a1_cases as restrictive for select to anon,authenticated
using (module_key is distinct from 'crm' or public.a1_crm_etapa_permitida(stage_id,false));
create policy a1_crm_etapas_update on public.a1_cases as restrictive for update to anon,authenticated
using (module_key is distinct from 'crm' or public.a1_crm_etapa_permitida(stage_id,true))
with check (module_key is distinct from 'crm' or public.a1_crm_etapa_permitida(stage_id,true));
create policy a1_crm_etapas_insert on public.a1_cases as restrictive for insert to anon,authenticated
with check (module_key is distinct from 'crm' or public.a1_crm_etapa_permitida(stage_id,true));
create policy a1_crm_etapas_delete on public.a1_cases as restrictive for delete to anon,authenticated
using (module_key is distinct from 'crm' or public.a1_crm_etapa_permitida(stage_id,true));
