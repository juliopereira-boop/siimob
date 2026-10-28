-- =============================================================================
-- MODO MANUTENÇÃO — a chave que desliga o sistema
--
-- POR QUE ESTE ARQUIVO EXISTE
-- Durante uma janela de manutenção, ninguém pode entrar. Até aqui o aviso era
-- só um cartaz: nada impedia alguém de logar às 9h05 e gravar por cima do que
-- estava sendo mexido. Isto é a tranca de verdade.
--
-- QUEM CONTINUA ENTRANDO: o superadmin, e ninguém mais. Ele fala com o banco
-- pela service_role key, que não passa por a1_login nem por RLS — então ele
-- NUNCA se tranca para fora. É por isso que esta chave é segura de ligar.
--
-- A SAÍDA DE EMERGÊNCIA, se a tela do superadmin não abrir por qualquer motivo:
--
--     update a1_manutencao set ativa = false;
--
-- Uma linha, no editor do Supabase, e o sistema volta.
--
-- E A VOLTA AUTOMÁTICA: o campo `ate` faz a manutenção expirar sozinha. Chave
-- esquecida ligada numa sexta à noite é o tipo de coisa que se descobre na
-- segunda de manhã, pelo telefone do cliente. Com `ate` preenchido, o sistema
-- volta na hora marcada mesmo que ninguém lembre de desligar.
--
-- O QUE ELE NÃO FAZ: não derruba, por si só, quem já está logado. Quem faz
-- isso é a tela — js/auth.js confere o estado no carregamento e a cada batida
-- do heartbeat (~50s), e mostra o aviso de manutenção no lugar do sistema.
-- Tranca de banco para sessão viva exigiria consultar esta tabela dentro de
-- a1_sessao(), que é chamada por TODA política em TODA consulta: custo alto e
-- permanente para uma janela que dura duas horas por mês.
-- =============================================================================

-- ─── O estado, numa linha só ─────────────────────────────────────────────────
-- Tabela de uma linha (o `check (id)` garante que não exista uma segunda): não
-- há "manutenção do cliente X", é o sistema inteiro. Duas linhas seriam duas
-- verdades sobre a mesma coisa.
create table if not exists a1_manutencao (
  id             boolean primary key default true check (id),
  ativa          boolean not null default false,
  mensagem       text,
  inicio         timestamptz,
  ate            timestamptz,
  ligada_por     text,
  atualizado_em  timestamptz not null default now()
);

insert into a1_manutencao (id, ativa) values (true, false)
on conflict (id) do nothing;

alter table a1_manutencao enable row level security;

-- LER pode todo mundo, inclusive quem nem logou: a tela de login precisa
-- explicar por que não entrou, e "credenciais inválidas" para quem digitou a
-- senha certa é a pior mensagem possível.
drop policy if exists a1_manutencao_ler on a1_manutencao;
create policy a1_manutencao_ler on a1_manutencao for select using (true);

-- ESCREVER não tem política nenhuma, e isso é a autorização: sem policy de
-- update, anon e authenticated não conseguem. Só a service_role passa — que é
-- exatamente quem o superadmin é.
revoke all on a1_manutencao from anon, authenticated;
grant select on a1_manutencao to anon, authenticated;

-- ─── A pergunta ──────────────────────────────────────────────────────────────
create or replace function a1_manutencao_ativa()
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select coalesce((select ativa and (ate is null or ate > now())
                     from a1_manutencao where id), false);
$$;
grant execute on function a1_manutencao_ativa() to anon, authenticated;

-- O estado completo, para a tela. Devolve sempre um objeto — nunca null —
-- porque `null` no navegador vira `undefined` e a tela decidiria errado.
create or replace function a1_manutencao_estado()
returns json language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select coalesce((
    select json_build_object(
      'ativa',    m.ativa and (m.ate is null or m.ate > now()),
      'mensagem', m.mensagem,
      'ate',      m.ate)
    from a1_manutencao m where m.id
  ), json_build_object('ativa', false, 'mensagem', null, 'ate', null));
$$;
grant execute on function a1_manutencao_estado() to anon, authenticated;

-- ─── A tranca, nos dois logins ───────────────────────────────────────────────
--
-- As duas funções abaixo são as de 2026-09-02_teto_simultaneos.sql com UM bloco
-- a mais, no topo. Vem antes de tudo — antes de procurar o cliente, antes de
-- conferir senha — porque durante a manutenção nem faz sentido consultar as
-- tabelas que estão sendo mexidas.
create or replace function a1_login(p_tenant_slug text, p_cpf text, p_password text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_tenant a1_tenants%rowtype;
  v_user   a1_users%rowtype;
  v_token  text;
  v_online int;
begin
  if a1_manutencao_ativa() then
    return json_build_object('error','em_manutencao',
                             'mensagem',(select mensagem from a1_manutencao where id),
                             'ate',     (select ate      from a1_manutencao where id));
  end if;

  select * into v_tenant from a1_tenants where slug = p_tenant_slug limit 1;
  if v_tenant.id is null           then return json_build_object('error','tenant_not_found'); end if;
  if v_tenant.status = 'suspended' then return json_build_object('error','tenant_suspended'); end if;
  if v_tenant.status = 'cancelled' then return json_build_object('error','tenant_cancelled'); end if;

  select * into v_user from a1_users
   where tenant_id = v_tenant.id and cpf = p_cpf and is_active = true limit 1;
  if v_user.id is null then return json_build_object('error','invalid_credentials'); end if;

  if not a1_senha_ok(p_password, v_user.password_hash) then
    return json_build_object('error','invalid_credentials');
  end if;

  -- A TRAVA do teto de simultâneos. Sem ela, dois logins que chegam no mesmo
  -- instante leem a contagem ANTES de qualquer um registrar presença: os dois
  -- veem vaga, os dois entram, e o teto do plano é furado.
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
  if a1_manutencao_ativa() then
    return json_build_object('error','em_manutencao',
                             'mensagem',(select mensagem from a1_manutencao where id),
                             'ate',     (select ate      from a1_manutencao where id));
  end if;

  select * into v_tenant from a1_tenants
   where slug = p_tenant_slug and status <> 'cancelled' limit 1;
  if v_tenant.id is null then return json_build_object('error','tenant_not_found'); end if;

  select * into v_partner from a1_partners
   where tenant_id = v_tenant.id and cpf = p_cpf
     and is_active = true and approved = true limit 1;
  if v_partner.id is null then return json_build_object('error','invalid_credentials'); end if;
  if not a1_senha_ok(p_password, v_partner.password_hash) then
    return json_build_object('error','invalid_credentials');
  end if;

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
--
-- 1. Nasce DESLIGADO. Rodar este arquivo não pode tirar ninguém do ar:
--
--    select ativa, ate from a1_manutencao;      -- ativa deve vir false
--    select a1_manutencao_ativa();              -- false
--
-- 2. Ligar e conferir que o login para (faça FORA do horário comercial):
--
--    update a1_manutencao
--       set ativa = true, inicio = now(), ate = now() + interval '5 minutes',
--           mensagem = 'Teste de manutenção — volta em 5 minutos.';
--    select a1_login('thecred','00000000000','x');   -- {"error":"em_manutencao",...}
--
-- 3. Desligar:
--
--    update a1_manutencao set ativa = false, ate = null;
--    select a1_login('thecred','00000000000','x');   -- volta a "invalid_credentials"
--
-- 4. A volta sozinha: com `ate` no passado, a1_manutencao_ativa() já devolve
--    false mesmo com `ativa = true`. É a rede de segurança da chave esquecida.
-- =============================================================================
