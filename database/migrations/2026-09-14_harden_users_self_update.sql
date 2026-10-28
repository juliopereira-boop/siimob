-- Segurança: o usuário comum pode editar apenas o próprio perfil sem
-- promover-se, mudar de tenant ou reativar uma conta. Owners/admins seguem
-- podendo gerenciar os usuários do próprio tenant.
begin;

drop policy if exists users_update_admin_or_self on public.a1_users;

create policy users_update_admin_or_self
on public.a1_users
for update
to public
using (
  tenant_id = public.a1_tenant()
  and (
    public.a1_current_role() in ('owner','admin')
    or id = public.a1_current_user_id()
  )
)
with check (
  tenant_id = public.a1_tenant()
  and (
    public.a1_current_role() in ('owner','admin')
    or (
      id = public.a1_current_user_id()
      and role = public.a1_current_role()
      and is_active = true
    )
  )
);

commit;
