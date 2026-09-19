-- Suspensao de cliente precisa valer para login novo, sessoes abertas e suporte.
-- Migration aditiva e idempotente. Nao desativa RLS nem remove dados do cliente.
begin;

-- A fonte central de identidade deixa de reconhecer uma sessao de tenant
-- suspenso/cancelado. Como as policies usam a1_sessao/a1_tenant, os dados ficam
-- indisponiveis imediatamente, mesmo antes de o navegador perceber o logout.
create or replace function public.a1_sessao()
returns public.a1_sessions
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select s.*
    from public.a1_sessions s
    join public.a1_tenants t on t.id = s.tenant_id
   where s.token = current_setting('request.headers', true)::json->>'x-session-token'
     and (s.expires_at is null or s.expires_at > now())
     and t.status in ('active', 'trial')
   limit 1;
$$;
revoke all on function public.a1_sessao() from public;
grant execute on function public.a1_sessao() to anon, authenticated;

-- Nao permite nem que a service role do painel crie uma sessao de suporte para
-- uma conta suspensa. O trigger tambem fecha a corrida entre conferir o status
-- no login e inserir a sessao.
create or replace function public.a1_impedir_sessao_tenant_bloqueado()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_status text;
begin
  select status into v_status from public.a1_tenants where id = new.tenant_id;
  if v_status is null or v_status not in ('active', 'trial') then
    raise exception 'tenant_%', coalesce(v_status, 'not_found')
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.a1_impedir_sessao_tenant_bloqueado() from public, anon, authenticated;

drop trigger if exists trg_a1_impedir_sessao_tenant_bloqueado on public.a1_sessions;
create trigger trg_a1_impedir_sessao_tenant_bloqueado
before insert on public.a1_sessions
for each row execute function public.a1_impedir_sessao_tenant_bloqueado();

-- Ao suspender/cancelar, revoga todas as sessoes e presencas do cliente na
-- mesma transacao do PATCH do Superadmin. Reativar nao recria sessao: cada
-- pessoa precisa autenticar novamente.
create or replace function public.a1_revogar_sessoes_tenant_bloqueado()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.status in ('suspended', 'cancelled')
     and new.status is distinct from old.status then
    delete from public.a1_sessions where tenant_id = new.id;
    delete from public.a1_presence where tenant_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.a1_revogar_sessoes_tenant_bloqueado() from public, anon, authenticated;

drop trigger if exists trg_a1_revogar_sessoes_tenant_bloqueado on public.a1_tenants;
create trigger trg_a1_revogar_sessoes_tenant_bloqueado
after update of status on public.a1_tenants
for each row execute function public.a1_revogar_sessoes_tenant_bloqueado();

-- A migration pode chegar depois de uma conta ja ter sido suspensa. Nesse caso
-- o trigger acima nao retroage, portanto limpa agora as sessoes/presencas que
-- ficaram vivas pelo comportamento antigo.
delete from public.a1_sessions s
 using public.a1_tenants t
 where t.id = s.tenant_id and t.status in ('suspended', 'cancelled');
delete from public.a1_presence p
 using public.a1_tenants t
 where t.id = p.tenant_id and t.status in ('suspended', 'cancelled');

-- O heartbeat confirma no servidor que a sessao e o tenant ainda estao ativos.
create or replace function public.a1_touch_session()
returns boolean
language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_token  text := current_setting('request.headers', true)::json->>'x-session-token';
  v_sess   public.a1_sessions%rowtype;
  v_status text;
  v_max    int;
  v_outros int;
begin
  if v_token is null then return false; end if;

  select * into v_sess
    from public.a1_sessions
   where token = v_token and (expires_at is null or expires_at > now());
  if not found then return false; end if;

  select status into v_status from public.a1_tenants where id = v_sess.tenant_id;
  if v_status not in ('active', 'trial') then
    delete from public.a1_sessions where token = v_token;
    delete from public.a1_presence
     where user_key = v_sess.tenant_id::text || '::' || v_sess.user_id::text;
    return false;
  end if;

  if v_sess.last_seen <= now() - public.a1_sessao_janela() then
    select coalesce(max_users, 0) into v_max
      from public.a1_tenants where id = v_sess.tenant_id;
    if v_max > 0 then
      v_outros := public.a1_ativos(v_sess.tenant_id, v_sess.user_id);
      if v_outros >= v_max then
        delete from public.a1_sessions where token = v_token;
        delete from public.a1_presence
         where user_key = v_sess.tenant_id::text || '::' || v_sess.user_id::text;
        return false;
      end if;
    end if;
  end if;

  update public.a1_sessions set last_seen = now() where token = v_token;
  return true;
end;
$$;
revoke all on function public.a1_touch_session() from public;
grant execute on function public.a1_touch_session() to anon, authenticated;

-- Consultada apenas depois que o heartbeat recebeu FALSE, para a tela explicar
-- corretamente se a sessao caiu por suspensao ou por outro login. Expoe somente
-- o status comercial de um slug, nunca dados ou identidade de usuario.
create or replace function public.a1_tenant_status_publico(p_tenant_slug text)
returns text
language sql stable security definer
set search_path = public, pg_temp as $$
  select status from public.a1_tenants where slug = p_tenant_slug limit 1;
$$;
revoke all on function public.a1_tenant_status_publico(text) from public;
grant execute on function public.a1_tenant_status_publico(text) to anon, authenticated;

-- A versao bcrypt anterior filtrava apenas cancelled no login de parceiro e
-- deixava suspended passar. Mantem toda a implementacao vigente e acrescenta
-- a verificacao que faltava.
create or replace function public.a1_partner_login(p_tenant_slug text, p_cpf text, p_password text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_tenant public.a1_tenants%rowtype;
  v_partner public.a1_partners%rowtype;
  v_token text;
  v_online int;
  v_uid uuid;
begin
  if public.a1_manutencao_ativa() then
    return json_build_object('error','em_manutencao',
      'mensagem',(select mensagem from public.a1_manutencao where id),
      'ate',(select ate from public.a1_manutencao where id));
  end if;

  select * into v_tenant from public.a1_tenants where slug=p_tenant_slug limit 1;
  if v_tenant.id is null then return json_build_object('error','tenant_not_found'); end if;
  if v_tenant.status='suspended' then return json_build_object('error','tenant_suspended'); end if;
  if v_tenant.status='cancelled' then return json_build_object('error','tenant_cancelled'); end if;

  select * into v_partner from public.a1_partners
   where tenant_id=v_tenant.id and cpf=p_cpf and is_active=true and approved=true limit 1;
  if v_partner.id is null or not public.a1_senha_ok(p_password,v_partner.password_hash)
    then return json_build_object('error','invalid_credentials'); end if;

  if v_partner.password_hash not like '$2%' then
    v_partner.password_hash:=crypt(public.a1_senha_interna(p_password),gen_salt('bf',12));
    update public.a1_partners set password_hash=v_partner.password_hash where id=v_partner.id;
    update public.a1_users set password_hash=v_partner.password_hash
      where tenant_id=v_tenant.id and cpf=p_cpf;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_tenant.id::text));
  if coalesce(v_tenant.max_users,0)>0 then
    select count(distinct user_key) into v_online from public.a1_presence
     where tenant_id=v_tenant.id and last_seen>=now()-interval '90 seconds'
       and user_key<>(v_tenant.id::text||'::'||v_partner.id::text);
    if v_online>=v_tenant.max_users then
      return json_build_object('error','max_concurrent','limit',v_tenant.max_users);
    end if;
  end if;

  select id into v_uid from public.a1_users
   where tenant_id=v_tenant.id and cpf=p_cpf limit 1;
  if v_uid is null then
    insert into public.a1_users(id,tenant_id,name,cpf,password_hash,role,is_active)
    values(gen_random_uuid(),v_tenant.id,v_partner.name,v_partner.cpf,v_partner.password_hash,'partner',true)
    on conflict(tenant_id,cpf) do nothing;
    select id into v_uid from public.a1_users
     where tenant_id=v_tenant.id and cpf=p_cpf limit 1;
  end if;
  if v_uid is null then return json_build_object('error','invalid_credentials'); end if;

  v_token:=gen_random_uuid()::text;
  insert into public.a1_sessions(token,tenant_id,user_id,role,expires_at)
  values(v_token,v_tenant.id,v_uid,'partner',now()+interval '12 hours');
  insert into public.a1_presence(user_key,tenant_id,name,role,module,last_seen)
  values(v_tenant.id::text||'::'||v_partner.id::text,v_tenant.id,v_partner.name,'partner',null,now())
  on conflict(user_key) do update set last_seen=now();

  return json_build_object('token',v_token,'tenant_id',v_tenant.id,'partner_id',v_partner.id,
    'name',v_partner.name,'type',v_partner.type,'role','partner','permissions',v_partner.permissions,
    'developments',v_partner.developments,'region',v_partner.region);
end;
$$;
revoke all on function public.a1_partner_login(text,text,text) from public, authenticated;
grant execute on function public.a1_partner_login(text,text,text) to anon;

commit;
