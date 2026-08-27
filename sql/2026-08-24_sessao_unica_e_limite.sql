-- =============================================================================
-- SESSÃO ÚNICA POR LOGIN  +  LIMITE REAL DE ACESSOS SIMULTÂNEOS
--
-- POR QUE O CONTROLE ANTIGO NÃO SEGURAVA
-- O limite era contado em a1_presence (batimento a cada 50s). Essa tabela é
-- escrita pelo próprio navegador do usuário e o papel anônimo pode inserir e
-- APAGAR linhas dela. Ou seja: bastava não enviar o batimento (ou apagar a
-- própria linha) para ficar invisível na contagem e furar a cota. Além disso,
-- nada impedia a MESMA conta de abrir sessão em vários aparelhos ao mesmo
-- tempo — era só repetir o login.
--
-- COMO PASSA A FUNCIONAR
-- A contagem passa para a1_sessions, que o cliente NÃO consegue mais tocar
-- (o acesso do papel anônimo a essa tabela foi revogado). Só as funções abaixo,
-- que rodam com privilégio do dono, criam e removem sessão.
--   1. Um login = uma sessão. Ao entrar, TODAS as sessões anteriores daquela
--      mesma conta são apagadas — quem estava logado cai sozinho no próximo
--      batimento (até ~50s).
--   2. O teto do plano (max_users) é verificado dentro da mesma transação do
--      login, com trava por cliente, então dois logins simultâneos não passam
--      juntos pela brecha.
--   3. Sessão sem batimento por 2 minutos deixa de ocupar vaga (fecharam o
--      navegador). Se ela tentar voltar e o cliente já estiver na cota, ela é
--      encerrada — a cota é respeitada o tempo todo, não só no momento do login.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

-- IMPORTANTE — ORDEM COM O ARQUIVO DE SENHA
-- Este arquivo recria a1_login e a1_partner_login. Se rodasse comparando a
-- senha por igualdade, desfaria o bcrypt do 2026-08-27_senha_bcrypt.sql e
-- trancaria todo mundo para fora. Por isso ele também usa a1_senha_ok, que é
-- definida logo abaixo se ainda não existir. Assim a ordem entre os dois
-- arquivos deixa de importar.

create extension if not exists pgcrypto;
set search_path = public, extensions, pg_temp;

create or replace function a1_senha_interna(p_senha text)
returns text language sql immutable
set search_path = public, extensions, pg_temp as $$
  select encode(digest(coalesce(p_senha,'') || '::a1', 'sha256'), 'hex');
$$;

create or replace function a1_senha_ok(p_senha text, p_hash text)
returns boolean language sql stable
set search_path = public, extensions, pg_temp as $$
  select case
    when p_hash is null or p_senha is null then false
    when p_hash like '$2%' then p_hash = crypt(a1_senha_interna(p_senha), p_hash)
    else p_hash = a1_senha_interna(p_senha)
  end;
$$;

grant execute on function a1_senha_interna(text) to anon, authenticated;
grant execute on function a1_senha_ok(text, text) to anon, authenticated;

-- ─── 1. Carimbo de atividade na sessão ───────────────────────────────────────
alter table a1_sessions add column if not exists last_seen timestamptz not null default now();
create index if not exists idx_a1_sessions_tenant_seen on a1_sessions (tenant_id, last_seen);

-- Janela sem batimento após a qual a sessão deixa de ocupar vaga.
-- O navegador bate a cada 50s, então 2 minutos dá folga para uma falha de rede.
create or replace function a1_sessao_janela() returns interval
language sql immutable as $$ select interval '2 minutes' $$;

-- ─── 2. Quantas contas estão realmente ativas agora ──────────────────────────
create or replace function a1_ativos(p_tenant uuid, p_excluir_user uuid default null)
returns int language sql stable security definer as $$
  select count(distinct user_id)::int
  from   a1_sessions
  where  tenant_id = p_tenant
    and  expires_at > now()
    and  last_seen  > now() - a1_sessao_janela()
    and  (p_excluir_user is null or user_id <> p_excluir_user);
$$;

-- ─── 3. Batimento: mantém a sessão viva e derruba quem foi substituído ───────
-- Devolve TRUE se a sessão continua valendo, FALSE se foi encerrada.
-- O navegador chama isto junto do batimento; ao receber FALSE, faz logout.
create or replace function a1_touch_session()
returns boolean language plpgsql security definer as $$
declare
  v_token   text := current_setting('request.headers', true)::json->>'x-session-token';
  v_sess    a1_sessions%rowtype;
  v_max     int;
  v_outros  int;
begin
  if v_token is null then return false; end if;

  select * into v_sess from a1_sessions where token = v_token and expires_at > now();
  if not found then
    return false;                    -- expirou ou foi derrubada por outro login
  end if;

  -- Sessão que ficou parada além da janela só volta a ocupar vaga se ainda
  -- houver vaga. Isso impede recuperar o acesso furando a cota.
  if v_sess.last_seen <= now() - a1_sessao_janela() then
    select coalesce(max_users,0) into v_max from a1_tenants where id = v_sess.tenant_id;
    if v_max > 0 then
      v_outros := a1_ativos(v_sess.tenant_id, v_sess.user_id);
      if v_outros >= v_max then
        delete from a1_sessions where token = v_token;
        delete from a1_presence where user_key = v_sess.tenant_id::text || '::' || v_sess.user_id::text;
        return false;
      end if;
    end if;
  end if;

  update a1_sessions set last_seen = now() where token = v_token;
  return true;
end;
$$;

-- ─── 4. Login do usuário interno ─────────────────────────────────────────────
create or replace function a1_login(p_tenant_slug text, p_cpf text, p_password text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_tenant a1_tenants%rowtype;
  v_user   a1_users%rowtype;
  v_token  text;
  v_hash   text;
  v_online int;
begin
  select * into v_tenant from a1_tenants where slug = p_tenant_slug limit 1;
  if v_tenant.id is null              then return json_build_object('error','tenant_not_found'); end if;
  if v_tenant.status = 'suspended'    then return json_build_object('error','tenant_suspended'); end if;
  if v_tenant.status = 'cancelled'    then return json_build_object('error','tenant_cancelled'); end if;

  select * into v_user from a1_users
   where tenant_id = v_tenant.id and cpf = p_cpf and is_active = true limit 1;
  if v_user.id is null then return json_build_object('error','invalid_credentials'); end if;

  if not a1_senha_ok(p_password, v_user.password_hash) then
    return json_build_object('error','invalid_credentials');
  end if;

  -- Trava por cliente: dois logins ao mesmo tempo não escapam juntos do teto.
  perform pg_advisory_xact_lock(hashtext(v_tenant.id::text));

  -- SESSÃO ÚNICA: derruba qualquer sessão anterior desta mesma conta.
  delete from a1_sessions where user_id = v_user.id;

  -- Teto de acessos simultâneos, contando as OUTRAS contas ativas.
  if coalesce(v_tenant.max_users,0) > 0 then
    v_online := a1_ativos(v_tenant.id, v_user.id);
    if v_online >= v_tenant.max_users then
      return json_build_object('error','max_concurrent','limit',v_tenant.max_users);
    end if;
  end if;

  delete from a1_sessions where user_id = v_user.id and expires_at < now();

  v_token := gen_random_uuid()::text;
  insert into a1_sessions (token, tenant_id, user_id, role, last_seen)
  values (v_token, v_tenant.id, v_user.id, v_user.role, now());

  update a1_users set last_seen = now() where id = v_user.id;

  insert into a1_presence (user_key, tenant_id, name, role, module, last_seen)
  values (v_tenant.id::text||'::'||v_user.id::text, v_tenant.id, v_user.name, v_user.role, null, now())
  on conflict (user_key) do update set last_seen = now();

  return json_build_object(
    'token',v_token,'tenant_id',v_tenant.id,'tenant_name',v_tenant.name,
    'user_id',v_user.id,'name',v_user.name,'role',v_user.role,
    'plan',v_tenant.plan_key,'max_users',v_tenant.max_users,
    'status',v_tenant.status,'trial_ends_at',v_tenant.trial_ends_at
  );
end;
$$;

-- ─── 5. Login de parceiro (correspondente / corretor) ────────────────────────
create or replace function a1_partner_login(p_tenant_slug text, p_cpf text, p_password text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_tenant  a1_tenants%rowtype;
  v_partner a1_partners%rowtype;
  v_uid     uuid;
  v_token   text;
  v_hash    text;
  v_online  int;
begin
  select * into v_tenant from a1_tenants
   where slug = p_tenant_slug and status <> 'cancelled' limit 1;
  if v_tenant.id is null then return json_build_object('error','tenant_not_found'); end if;

  -- A senha saiu do WHERE: com sal, cada hash é único e não dá para comparar
  -- por igualdade. Busca pelo CPF e confere depois.
  select * into v_partner from a1_partners
   where tenant_id = v_tenant.id and cpf = p_cpf
     and is_active = true and approved = true limit 1;
  if v_partner.id is null then return json_build_object('error','invalid_credentials'); end if;
  if not a1_senha_ok(p_password, v_partner.password_hash) then
    return json_build_object('error','invalid_credentials');
  end if;
  v_hash := v_partner.password_hash;

  -- Usuário-sombra que representa o parceiro nas sessões.
  select id into v_uid from a1_users
   where tenant_id = v_tenant.id and cpf = p_cpf limit 1;
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into a1_users (id, tenant_id, name, cpf, password_hash, role, is_active)
    values (v_uid, v_tenant.id, v_partner.name, v_partner.cpf, v_hash, 'partner', true)
    on conflict (tenant_id, cpf) do nothing;
    select id into v_uid from a1_users where tenant_id = v_tenant.id and cpf = p_cpf limit 1;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_tenant.id::text));

  -- SESSÃO ÚNICA também para parceiro.
  delete from a1_sessions where user_id = v_uid;

  if coalesce(v_tenant.max_users,0) > 0 then
    v_online := a1_ativos(v_tenant.id, v_uid);
    if v_online >= v_tenant.max_users then
      return json_build_object('error','max_concurrent','limit',v_tenant.max_users);
    end if;
  end if;

  v_token := gen_random_uuid()::text;
  insert into a1_sessions (token, tenant_id, user_id, role, expires_at, last_seen)
  values (v_token, v_tenant.id, v_uid, 'partner', now() + interval '12 hours', now());

  insert into a1_presence (user_key, tenant_id, name, role, module, last_seen)
  values (v_tenant.id::text||'::'||v_partner.id::text, v_tenant.id, v_partner.name, 'partner', null, now())
  on conflict (user_key) do update set last_seen = now();

  return json_build_object(
    'token',v_token,'tenant_id',v_tenant.id,'partner_id',v_partner.id,
    'name',v_partner.name,'type',v_partner.type,'role','partner',
    'permissions',v_partner.permissions,'developments',v_partner.developments,
    'region',v_partner.region
  );
end;
$$;

grant execute on function a1_touch_session()                   to anon, authenticated;
grant execute on function a1_ativos(uuid, uuid)                to anon, authenticated;
grant execute on function a1_sessao_janela()                   to anon, authenticated;
grant execute on function a1_login(text,text,text)             to anon, authenticated;
grant execute on function a1_partner_login(text,text,text)     to anon, authenticated;

-- =============================================================================
-- COMO CONFERIR DEPOIS DE RODAR
--   1. Entre com a mesma conta em dois navegadores. O primeiro deve cair
--      sozinho em até ~50 segundos, indo para a tela de login.
--   2. Deixe max_users = 2 e tente colocar 3 pessoas diferentes ao mesmo tempo:
--      a terceira recebe "Limite de 2 acessos simultâneos atingido".
--   3. Feche o navegador de alguém sem sair: em ~2 minutos a vaga é liberada.
-- =============================================================================
