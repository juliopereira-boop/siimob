-- Segurança: a1_users é tabela interna de autenticação. Somente gestor
-- do próprio tenant pode consultá-la; a API não expõe password_hash.
begin;

drop policy if exists users_select_tenant on public.a1_users;

create policy users_select_admin
on public.a1_users
for select
to public
using (
  tenant_id = public.a1_tenant()
  and public.a1_current_role() in ('owner','admin')
);

revoke select on public.a1_users from public, anon, authenticated;
grant select (id, tenant_id, name, cpf, email, role, is_active, created_at, last_seen)
  on public.a1_users to anon, authenticated;

commit;
