-- Segurança: parceiros não administram parceiros por REST.
-- A única autoedição permitida passa pela função a1_atualizar_meu_perfil,
-- que aceita apenas nome, e-mail, telefone e nova senha.
begin;

create or replace function public.a1_atualizar_meu_perfil(
  p_nome text, p_email text default null, p_telefone text default null, p_senha text default null
) returns boolean language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_partner public.a1_partners%rowtype; v_hash text;
begin
  select * into v_partner from public.a1_partners
   where id=public.a1_ator() and tenant_id=public.a1_tenant()
     and is_active=true and approved=true limit 1;
  if v_partner.id is null then raise exception 'perfil_nao_autorizado'; end if;
  if nullif(btrim(coalesce(p_nome,'')),'') is null then raise exception 'nome_obrigatorio'; end if;
  if nullif(p_senha,'') is not null then
    if length(p_senha)<4 then raise exception 'senha_muito_curta'; end if;
    v_hash:=crypt(public.a1_senha_interna(p_senha),gen_salt('bf',12));
  end if;
  update public.a1_partners set name=btrim(p_nome),
    email=nullif(btrim(coalesce(p_email,'')),''),
    phone=nullif(btrim(coalesce(p_telefone,'')),''),
    password_hash=coalesce(v_hash,password_hash) where id=v_partner.id;
  update public.a1_users set name=btrim(p_nome),
    email=nullif(btrim(coalesce(p_email,'')),''),
    password_hash=coalesce(v_hash,password_hash)
    where tenant_id=v_partner.tenant_id and cpf=v_partner.cpf and role='partner';
  return true;
end;
$$;
revoke all on function public.a1_atualizar_meu_perfil(text,text,text,text) from public;
grant execute on function public.a1_atualizar_meu_perfil(text,text,text,text) to anon, authenticated;

drop policy if exists partners_tenant_isolation on public.a1_partners;
drop policy if exists tenant_isolation on public.a1_partners;
create policy partners_tenant_read on public.a1_partners for select to public
  using (tenant_id=public.a1_tenant());
create policy partners_manager_write on public.a1_partners for all to public
  using (tenant_id=public.a1_tenant() and public.a1_e_gestor())
  with check (tenant_id=public.a1_tenant() and public.a1_e_gestor());
commit;