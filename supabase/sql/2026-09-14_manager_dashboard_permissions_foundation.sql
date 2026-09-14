-- Permissões explícitas de dashboard para gestores.
-- Compatibilidade: enquanto não existir o marcador para aquele gestor, ele
-- conserva o acesso completo anterior. Ao salvar a configuração, o marcador
-- passa a tornar cada ver_dashboard_* uma autorização explícita.
create or replace function public.a1_perm(p_chave text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select case
    when a1_e_gestor() and p_chave like 'ver_dashboard_%' then
      case when exists (
        select 1 from public.a1_user_permissions up
        where up.user_id = a1_current_user_id()
          and up.permission = 'dashboard_access_configured'
      ) then exists (
        select 1 from public.a1_user_permissions up
        where up.user_id = a1_current_user_id()
          and up.permission = p_chave
      )
      else true end
    when a1_e_gestor() then true
    else coalesce((
      select coalesce(pf.permissions,p.permissions)->>'gerente' in ('true','t','1')
          or coalesce(pf.permissions,p.permissions)->>p_chave in ('true','t','1')
      from public.a1_partners p
      left join public.a1_perfis pf on pf.id=p.perfil_id and pf.ativo
      where p.id=a1_ator() limit 1
    ),false)
  end;
$$;
revoke all on function public.a1_perm(text) from public, authenticated;
grant execute on function public.a1_perm(text) to anon;

drop policy if exists user_permissions_tenant_isolation on public.a1_user_permissions;
create policy user_permissions_manager_only
on public.a1_user_permissions for all to anon, authenticated
using (
  a1_e_gestor() and exists (
    select 1 from public.a1_users u
    where u.id=a1_user_permissions.user_id and u.tenant_id=a1_tenant()
  )
)
with check (
  a1_e_gestor() and exists (
    select 1 from public.a1_users u
    where u.id=a1_user_permissions.user_id and u.tenant_id=a1_tenant()
  )
);