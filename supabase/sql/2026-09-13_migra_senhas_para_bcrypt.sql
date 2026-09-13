-- Segurança: migração transparente de senhas legadas (SHA-256) para bcrypt.
-- A senha continua sendo validada como hoje. Depois do primeiro login bem-sucedido,
-- a credencial é gravada com bcrypt custo 12; não exige troca de senha nem
-- desconecta clientes.
begin;

create or replace function public.a1_login(p_tenant_slug text, p_cpf text, p_password text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant a1_tenants%rowtype;
  v_user   a1_users%rowtype;
  v_token  text;
  v_online int;
begin
  if a1_manutencao_ativa() then
    return json_build_object('error','em_manutencao',
      'mensagem',(select mensagem from a1_manutencao where id),
      'ate',(select ate from a1_manutencao where id));
  end if;
  select * into v_tenant from a1_tenants where slug=p_tenant_slug limit 1;
  if v_tenant.id is null then return json_build_object('error','tenant_not_found'); end if;
  if v_tenant.status='suspended' then return json_build_object('error','tenant_suspended'); end if;
  if v_tenant.status='cancelled' then return json_build_object('error','tenant_cancelled'); end if;
  select * into v_user from a1_users where tenant_id=v_tenant.id and cpf=p_cpf and is_active=true limit 1;
  if v_user.id is null or not a1_senha_ok(p_password,v_user.password_hash)
    then return json_build_object('error','invalid_credentials'); end if;

  if v_user.password_hash not like '$2%' then
    update a1_users set password_hash=crypt(a1_senha_interna(p_password),gen_salt('bf',12))
    where id=v_user.id;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_tenant.id::text));
  if coalesce(v_tenant.max_users,0)>0 then
    select count(distinct user_key) into v_online from a1_presence
    where tenant_id=v_tenant.id and last_seen>=now()-interval '90 seconds'
      and user_key<>(v_tenant.id::text||'::'||v_user.id::text);
    if v_online>=v_tenant.max_users then return json_build_object('error','max_concurrent','limit',v_tenant.max_users); end if;
  end if;
  delete from a1_sessions where user_id=v_user.id and expires_at<now();
  v_token:=gen_random_uuid()::text;
  insert into a1_sessions(token,tenant_id,user_id,role) values(v_token,v_tenant.id,v_user.id,v_user.role);
  update a1_users set last_seen=now() where id=v_user.id;
  insert into a1_presence(user_key,tenant_id,name,role,module,last_seen)
  values(v_tenant.id::text||'::'||v_user.id::text,v_tenant.id,v_user.name,v_user.role,null,now())
  on conflict(user_key) do update set last_seen=now();
  return json_build_object('token',v_token,'tenant_id',v_tenant.id,'tenant_name',v_tenant.name,
    'user_id',v_user.id,'name',v_user.name,'role',v_user.role,'plan',v_tenant.plan_key,
    'max_users',v_tenant.max_users,'status',v_tenant.status,'trial_ends_at',v_tenant.trial_ends_at);
end $$;

create or replace function public.a1_partner_login(p_tenant_slug text, p_cpf text, p_password text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant a1_tenants%rowtype;
  v_partner a1_partners%rowtype;
  v_token text;
  v_online int;
  v_uid uuid;
begin
  if a1_manutencao_ativa() then
    return json_build_object('error','em_manutencao',
      'mensagem',(select mensagem from a1_manutencao where id),
      'ate',(select ate from a1_manutencao where id));
  end if;
  select * into v_tenant from a1_tenants where slug=p_tenant_slug and status<>'cancelled' limit 1;
  if v_tenant.id is null then return json_build_object('error','tenant_not_found'); end if;
  select * into v_partner from a1_partners
  where tenant_id=v_tenant.id and cpf=p_cpf and is_active=true and approved=true limit 1;
  if v_partner.id is null or not a1_senha_ok(p_password,v_partner.password_hash)
    then return json_build_object('error','invalid_credentials'); end if;

  if v_partner.password_hash not like '$2%' then
    v_partner.password_hash:=crypt(a1_senha_interna(p_password),gen_salt('bf',12));
    update a1_partners set password_hash=v_partner.password_hash where id=v_partner.id;
    update a1_users set password_hash=v_partner.password_hash
      where tenant_id=v_tenant.id and cpf=p_cpf;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_tenant.id::text));
  if coalesce(v_tenant.max_users,0)>0 then
    select count(distinct user_key) into v_online from a1_presence
    where tenant_id=v_tenant.id and last_seen>=now()-interval '90 seconds'
      and user_key<>(v_tenant.id::text||'::'||v_partner.id::text);
    if v_online>=v_tenant.max_users then return json_build_object('error','max_concurrent','limit',v_tenant.max_users); end if;
  end if;
  select id into v_uid from a1_users where tenant_id=v_tenant.id and cpf=p_cpf limit 1;
  if v_uid is null then
    insert into a1_users(id,tenant_id,name,cpf,password_hash,role,is_active)
    values(gen_random_uuid(),v_tenant.id,v_partner.name,v_partner.cpf,v_partner.password_hash,'partner',true)
    on conflict(tenant_id,cpf) do nothing;
    select id into v_uid from a1_users where tenant_id=v_tenant.id and cpf=p_cpf limit 1;
  end if;
  if v_uid is null then return json_build_object('error','invalid_credentials'); end if;
  v_token:=gen_random_uuid()::text;
  insert into a1_sessions(token,tenant_id,user_id,role,expires_at)
  values(v_token,v_tenant.id,v_uid,'partner',now()+interval '12 hours');
  insert into a1_presence(user_key,tenant_id,name,role,module,last_seen)
  values(v_tenant.id::text||'::'||v_partner.id::text,v_tenant.id,v_partner.name,'partner',null,now())
  on conflict(user_key) do update set last_seen=now();
  return json_build_object('token',v_token,'tenant_id',v_tenant.id,'partner_id',v_partner.id,
    'name',v_partner.name,'type',v_partner.type,'role','partner','permissions',v_partner.permissions,
    'developments',v_partner.developments,'region',v_partner.region);
end $$;

revoke all on function public.a1_login(text,text,text) from public;
revoke all on function public.a1_partner_login(text,text,text) from public;
revoke all on function public.a1_login(text,text,text) from authenticated;
revoke all on function public.a1_partner_login(text,text,text) from authenticated;
grant execute on function public.a1_login(text,text,text) to anon;
grant execute on function public.a1_partner_login(text,text,text) to anon;

commit;