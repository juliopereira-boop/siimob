-- =============================================================================
-- TETO DE ACESSOS SIMULTÂNEOS — fechando a brecha da corrida
--
-- O PROBLEMA, MEDIDO
-- a1_login confere quantas pessoas do cliente estão online e barra quem passar
-- do teto do plano. A conferência funciona quando os logins chegam um de cada
-- vez. Quando chegam JUNTOS, todos leem a contagem antes de qualquer um deles
-- registrar presença: todos enxergam vaga e todos entram.
--
-- Reproduzido em Postgres 16 com a função que está em produção hoje: cliente
-- com teto 3, duas pessoas já dentro (uma vaga), quatro logins disparados no
-- mesmo instante — três passaram, e o cliente terminou com CINCO pessoas.
--
-- A CORREÇÃO
-- Uma linha: pg_advisory_xact_lock por cliente, antes da contagem. Os logins do
-- mesmo cliente passam a ser atendidos em fila; cada um vê o número já
-- atualizado pelo anterior. Mesmo teste depois da trava: só uma pessoa entrou,
-- e o cliente terminou com três.
--
-- A trava é por cliente e vive só até o fim da transação do login — alguns
-- milissegundos. Cliente nenhum espera pelo login de outro.
--
-- DE QUEBRA, A MEDIÇÃO FICA HONESTA
-- O "Máx. simultâneo" do Monitor é medido no instante de cada login. Na corrida
-- ele também subestimava, pela mesma razão: todos liam o número velho. Com a
-- trava, o que o painel mostra passa a ser o que de fato aconteceu.
--
-- O QUE ESTE ARQUIVO NÃO FAZ
--   · não derruba sessão de ninguém (isso é o outro arquivo, o de sessão única,
--     que continua sendo decisão sua);
--   · não muda senha, permissão, plano nem tela nenhuma;
--   · não altera quantos usuários cada plano permite.
--
-- As duas funções abaixo são exatamente as que estão no ar hoje
-- (sql/2026-08-27_senha_bcrypt.sql), com a linha da trava acrescentada.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

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

  -- A TRAVA. Sem ela, dois logins que chegam no mesmo instante leem a contagem
  -- ANTES de qualquer um dos dois registrar presença: os dois veem vaga, os dois
  -- entram, e o teto do plano é furado. A trava é por CLIENTE, então o login de
  -- uma empresa nunca espera pelo de outra, e é liberada ao fim da transação —
  -- que aqui dura milissegundos.
  perform pg_advisory_xact_lock(hashtext(v_tenant.id::text));

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

  -- A TRAVA. Sem ela, dois logins que chegam no mesmo instante leem a contagem
  -- ANTES de qualquer um dos dois registrar presença: os dois veem vaga, os dois
  -- entram, e o teto do plano é furado. A trava é por CLIENTE, então o login de
  -- uma empresa nunca espera pelo de outra, e é liberada ao fim da transação —
  -- que aqui dura milissegundos.
  perform pg_advisory_xact_lock(hashtext(v_tenant.id::text));

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

-- =============================================================================
-- COMO CONFERIR
--   1. Escolha um cliente de teste e deixe max_users = 2.
--   2. Entre com duas pessoas diferentes: as duas passam.
--   3. Tente a terceira: tem de ouvir "Limite de 2 acessos simultâneos
--      atingido. Aguarde alguém sair e tente novamente."
--   4. No superadmin, aba Monitor, a coluna "Máx. simultâneo" daquele cliente
--      nunca pode passar do limite. Se passar, aparece em vermelho.
-- =============================================================================
