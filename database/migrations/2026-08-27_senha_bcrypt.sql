-- =============================================================================
-- SENHA COM SAL (bcrypt) + CAMINHO DE BUSCA FIXO NAS FUNÇÕES PRIVILEGIADAS
--
-- O QUE ESTÁ ERRADO HOJE
-- A senha é guardada como SHA-256 sem sal. Isso tem dois problemas: é rápido
-- de calcular (dá para testar bilhões de tentativas por segundo numa placa de
-- vídeo) e é sempre igual para a mesma senha, então uma tabela pronta de
-- hashes conhecidos quebra as senhas comuns na hora. Quem conseguir ler a
-- coluna password_hash — um colega da mesma empresa, ou uma cópia do banco —
-- leva as senhas junto.
--
-- COMO PASSA A SER
-- bcrypt com sal por linha e custo 10: cada senha vira um hash diferente, e
-- cada tentativa de adivinhação custa milhares de vezes mais. Tabela pronta
-- deixa de servir.
--
-- NINGUÉM PRECISA TROCAR DE SENHA. A migração é automática e não exige nada
-- de quem usa o sistema.
--
-- ORDEM PROPOSITAL DENTRO DESTE ARQUIVO
--   1. as funções de conferência (aceitam formato novo E antigo)
--   2. as funções de login já usando elas
--   3. só então o gatilho e a conversão das senhas existentes
-- Assim não existe um só instante em que o login deixe de funcionar. Pode
-- rodar com o cliente usando o sistema.
--
-- ESTE ARQUIVO É INDEPENDENTE do 2026-08-24_sessao_unica_e_limite.sql. Ele
-- reproduz as funções de login como elas estão hoje, mudando SOMENTE a
-- conferência da senha — não muda nada de sessão nem de limite de acessos.
-- Se depois você rodar o 08-24, rode este aqui de novo em seguida.
-- =============================================================================

create extension if not exists pgcrypto;

-- O pgcrypto vive no schema "extensions" no Supabase (em outros, no "public").
-- Sem isto, os comandos soltos lá embaixo não enxergam crypt() nem gen_salt().
set search_path = public, extensions, pg_temp;

-- ─── 1. Conferir e gerar senha ───────────────────────────────────────────────
-- O sistema continua mandando SHA-256 do navegador (nenhuma tela muda). O que
-- o banco guarda é o bcrypt DESSE valor. Assim a senha em texto puro nunca
-- trafega e o que fica gravado tem sal.
create or replace function a1_senha_interna(p_senha text)
returns text language sql immutable
set search_path = public, extensions, pg_temp as $$
  select encode(digest(coalesce(p_senha,'') || '::a1', 'sha256'), 'hex');
$$;

-- Aceita os dois formatos: bcrypt (novo) e SHA-256 puro (resíduo antigo).
-- O resíduo some sozinho conforme o gatilho abaixo converte as linhas.
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

-- ─── 2. Login do usuário interno ─────────────────────────────────────────────
-- Cópia fiel da função em produção; muda só a linha da conferência da senha.
create or replace function a1_login(p_tenant_slug text, p_cpf text, p_password text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_tenant a1_tenants%rowtype;
  v_user   a1_users%rowtype;
  v_token  text;
  v_online int;
begin
  select * into v_tenant from a1_tenants where slug = p_tenant_slug limit 1;
  if v_tenant.id is null           then return json_build_object('error','tenant_not_found'); end if;
  if v_tenant.status = 'suspended' then return json_build_object('error','tenant_suspended'); end if;
  if v_tenant.status = 'cancelled' then return json_build_object('error','tenant_cancelled'); end if;

  select * into v_user from a1_users
   where tenant_id = v_tenant.id and cpf = p_cpf and is_active = true limit 1;
  if v_user.id is null then return json_build_object('error','invalid_credentials'); end if;

  -- AQUI está a única mudança: conferência que entende bcrypt e o formato antigo.
  if not a1_senha_ok(p_password, v_user.password_hash) then
    return json_build_object('error','invalid_credentials');
  end if;

  if coalesce(v_tenant.max_users,0) > 0 then
    select count(distinct user_key) into v_online
    from   a1_presence
    where  tenant_id = v_tenant.id
      and  last_seen >= now() - interval '90 seconds'
      and  user_key <> (v_tenant.id::text || '::' || v_user.id::text);
    if v_online >= v_tenant.max_users then
      return json_build_object('error','max_concurrent','limit',v_tenant.max_users);
    end if;
  end if;

  delete from a1_sessions where user_id = v_user.id and expires_at < now();

  v_token := gen_random_uuid()::text;
  insert into a1_sessions (token, tenant_id, user_id, role)
  values (v_token, v_tenant.id, v_user.id, v_user.role);

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
end $$;

-- ─── 3. Login de parceiro (correspondente / corretor / analista) ─────────────
create or replace function a1_partner_login(p_tenant_slug text, p_cpf text, p_password text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_tenant  a1_tenants%rowtype;
  v_partner a1_partners%rowtype;
  v_token   text;
  v_online  int;
  v_uid     uuid;
begin
  select * into v_tenant from a1_tenants
   where slug = p_tenant_slug and status <> 'cancelled' limit 1;
  if v_tenant.id is null then return json_build_object('error','tenant_not_found'); end if;

  -- Antes a senha entrava no WHERE. Agora busca pelo CPF e confere depois,
  -- porque o hash guardado tem sal e não dá para comparar por igualdade.
  select * into v_partner from a1_partners
   where tenant_id = v_tenant.id and cpf = p_cpf
     and is_active = true and approved = true limit 1;
  if v_partner.id is null then return json_build_object('error','invalid_credentials'); end if;
  if not a1_senha_ok(p_password, v_partner.password_hash) then
    return json_build_object('error','invalid_credentials');
  end if;

  if coalesce(v_tenant.max_users,0) > 0 then
    select count(distinct user_key) into v_online
    from   a1_presence
    where  tenant_id = v_tenant.id
      and  last_seen >= now() - interval '90 seconds'
      and  user_key <> (v_tenant.id::text || '::' || v_partner.id::text);
    if v_online >= v_tenant.max_users then
      return json_build_object('error','max_concurrent','limit',v_tenant.max_users);
    end if;
  end if;

  -- Usuário-sombra que representa o parceiro nas sessões.
  select id into v_uid from a1_users
   where tenant_id = v_tenant.id and cpf = p_cpf limit 1;
  if v_uid is null then
    insert into a1_users (id, tenant_id, name, cpf, password_hash, role, is_active)
    values (gen_random_uuid(), v_tenant.id, v_partner.name, v_partner.cpf,
            v_partner.password_hash, 'partner', true)
    on conflict (tenant_id, cpf) do nothing;
    select id into v_uid from a1_users where tenant_id = v_tenant.id and cpf = p_cpf limit 1;
  end if;
  if v_uid is null then return json_build_object('error','invalid_credentials'); end if;

  v_token := gen_random_uuid()::text;
  insert into a1_sessions (token, tenant_id, user_id, role, expires_at)
  values (v_token, v_tenant.id, v_uid, 'partner', now() + interval '12 hours');

  insert into a1_presence (user_key, tenant_id, name, role, module, last_seen)
  values (v_tenant.id::text||'::'||v_partner.id::text, v_tenant.id, v_partner.name, 'partner', null, now())
  on conflict (user_key) do update set last_seen = now();

  return json_build_object(
    'token',v_token,'tenant_id',v_tenant.id,'partner_id',v_partner.id,
    'name',v_partner.name,'type',v_partner.type,'role','partner',
    'permissions',v_partner.permissions,'developments',v_partner.developments,
    'region',v_partner.region
  );
end $$;

grant execute on function a1_login(text,text,text)         to anon, authenticated;
grant execute on function a1_partner_login(text,text,text) to anon, authenticated;

-- ─── 4. Gatilho: nada entra sem sal ──────────────────────────────────────────
-- As telas de cadastro calculam o SHA-256 no navegador e gravam direto na
-- coluna. Em vez de mexer em vinte telas, o próprio banco converte na entrada:
-- se chegou um SHA-256 (64 caracteres hexadecimais), vira bcrypt antes de
-- gravar. Valor que já é bcrypt passa direto.
create or replace function a1_senha_com_sal() returns trigger
language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if new.password_hash is not null and new.password_hash ~ '^[0-9a-f]{64}$' then
    new.password_hash := crypt(new.password_hash, gen_salt('bf', 10));
  end if;
  return new;
end $$;

drop trigger if exists a1_users_senha_com_sal    on a1_users;
drop trigger if exists a1_partners_senha_com_sal on a1_partners;

create trigger a1_users_senha_com_sal
  before insert or update of password_hash on a1_users
  for each row execute function a1_senha_com_sal();

create trigger a1_partners_senha_com_sal
  before insert or update of password_hash on a1_partners
  for each row execute function a1_senha_com_sal();

-- ─── 5. Converter o que já está gravado ──────────────────────────────────────
-- Roda uma vez. O login já aceita os dois formatos, então isto não derruba
-- ninguém que esteja logado nem invalida senha alguma.
update a1_users
   set password_hash = crypt(password_hash, gen_salt('bf', 10))
 where password_hash ~ '^[0-9a-f]{64}$';

update a1_partners
   set password_hash = crypt(password_hash, gen_salt('bf', 10))
 where password_hash ~ '^[0-9a-f]{64}$';

-- ─── 6. Caminho de busca fixo nas funções privilegiadas ──────────────────────
-- Função SECURITY DEFINER roda com o poder do dono do banco. Sem search_path
-- fixo, ela resolve nomes pelo caminho de quem chamou — e quem chamou pode
-- plantar uma função com o mesmo nome de uma que ela usa. É o alerta
-- "function_search_path_mutable" do próprio Supabase.
do $fix$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from   pg_proc p
    join   pg_namespace n on n.oid = p.pronamespace
    where  n.nspname = 'public' and p.prosecdef
      and (p.proconfig is null
           or not exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%'))
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', f.assinatura);
    raise notice 'caminho de busca fixado em %', f.assinatura;
  end loop;
end $fix$;

-- =============================================================================
-- COMO CONFERIR DEPOIS DE RODAR
--   1. Entre no sistema com uma conta que já existia. Tem que entrar normal,
--      com a MESMA senha de sempre.
--   2. select count(*) filter (where password_hash ~ '^[0-9a-f]{64}$') as ainda_sem_sal,
--             count(*) filter (where password_hash like '$2%')          as com_sal
--      from a1_users;
--      -> ainda_sem_sal deve ser 0.
--   3. Repita para a1_partners.
--   4. Cadastre um usuário novo por Configurações e confira que o hash dele
--      já nasce começando com $2.
--   5. Rode de novo o AUDITORIA_seguranca.sql: o bloco 5 não deve mais ter
--      nenhum "ATENÇÃO".
-- =============================================================================
