-- =============================================================================
-- LOGIN DO SUPERADMIN POR AUTENTICADOR (código de 6 dígitos, QR code)
--
-- POR QUE ESTE ARQUIVO EXISTE
-- O superadmin entrava colando a Service Role Key no navegador, a cada vez. A
-- chave ficava na área de transferência, no histórico do gerenciador de senhas
-- e na memória da aba, e era a chave mestra do banco inteiro. Agora:
--   1. A chave mora só na Edge Function sa-proxy (variável do servidor).
--   2. O superadmin entra com o código do app autenticador (Google
--      Authenticator, Authy, 1Password, Microsoft Authenticator).
--   3. O código é conferido AQUI, no banco, e abre uma sessão de 12 horas. A
--      função só repassa pedido de quem tem sessão válida.
--
-- O QUE PROTEGE
--   - O segredo do autenticador e as sessões ficam em tabelas sem política
--     nenhuma: nem a chave pública nem um usuário logado de cliente leem.
--   - As funções daqui só a service_role executa (a Edge Function).
--   - Sessão gravada como hash (sha256): quem ler a tabela não entra com ela.
--   - Código já usado não vale de novo (anti-reuso dentro dos 30 segundos).
--   - 5 erros seguidos do mesmo IP em 15 minutos travam o IP por 15 minutos.
--     Como o IP vem de cabeçalho e pode ser forjado, quem segura de verdade é
--     a trava geral: 10 erros em 15 minutos, ou 30 em 24 horas, travam o login
--     inteiro. Com o código valendo em 3 janelas de 30 s, 30 chutes por dia dão
--     cerca de 1 chance em 11 mil por dia. A chave de serviço continua sendo a
--     entrada de emergência, e quem entra com ela libera o login
--     (a1_sa_destravar).
--   - Cadastrar de novo o autenticador derruba todas as sessões abertas.
--
-- Não toca em nenhuma tabela de cliente. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;
create extension if not exists pgcrypto with schema extensions;

create table if not exists a1_sa_totp (
  id            int primary key default 1 check (id = 1),
  segredo       bytea not null,
  ultimo_passo  bigint not null default 0,   -- último código aceito (anti-reuso)
  cadastrado_em timestamptz not null default now()
);
create table if not exists a1_sa_sessoes (
  token_hash text primary key,
  criada_em  timestamptz not null default now(),
  expira_em  timestamptz not null,
  ultimo_uso timestamptz not null default now(),
  ip         text,
  agente     text
);
create table if not exists a1_sa_tentativas (
  id bigserial primary key,
  em timestamptz not null default now(),
  ip text,
  ok boolean not null
);
create index if not exists idx_sa_tentativas_em on a1_sa_tentativas (em desc);

alter table a1_sa_totp       enable row level security;
alter table a1_sa_sessoes    enable row level security;
alter table a1_sa_tentativas enable row level security;
revoke all on a1_sa_totp, a1_sa_sessoes, a1_sa_tentativas from anon, authenticated;
revoke all on sequence a1_sa_tentativas_id_seq from anon, authenticated;

-- ─── TOTP (RFC 6238: HMAC-SHA1, passo de 30 s, 6 dígitos) ───────────────────
create or replace function a1_sa_totp_codigo(p_segredo bytea, p_passo bigint)
returns text language plpgsql immutable
set search_path = public, extensions, pg_temp as $$
declare h bytea; o int; b bigint;
begin
  h := hmac(int8send(p_passo), p_segredo, 'sha1');
  o := get_byte(h, 19) & 15;
  b := ((get_byte(h, o) & 127)::bigint << 24) | (get_byte(h, o + 1)::bigint << 16)
     | (get_byte(h, o + 2)::bigint << 8) | get_byte(h, o + 3)::bigint;
  return lpad((b % 1000000)::text, 6, '0');
end $$;

create or replace function a1_sa_passo_agora()
returns bigint language sql stable as $$
  select floor(extract(epoch from now()) / 30)::bigint;
$$;

-- O autenticador já foi cadastrado? (a tela de login decide o que mostrar)
-- Erros desde o último acerto: do IP em 15 min, de todos em 15 min e em 24 h.
create or replace function a1_sa_erros(p_ip text, out ip_15 int, out todos_15 int, out todos_24h int)
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select count(*) filter (where ip is not distinct from p_ip and em > now() - interval '15 minutes')::int,
         count(*) filter (where em > now() - interval '15 minutes')::int,
         count(*)::int
    from a1_sa_tentativas
   where not ok and em > now() - interval '24 hours'
     and em > coalesce((select max(em) from a1_sa_tentativas where ok), '-infinity');
$$;

-- O autenticador já foi cadastrado? O login está travado? (a tela decide o que mostrar)
create or replace function a1_sa_totp_status()
returns json language sql security definer
set search_path = public, extensions, pg_temp as $$
  select json_build_object('configurado', exists (select 1 from a1_sa_totp),
                           'cadastrado_em', (select cadastrado_em from a1_sa_totp),
                           'travado', (select e.todos_15 >= 10 or e.todos_24h >= 30 from a1_sa_erros(null) e));
$$;

-- Libera o login travado. Só quem já está dentro (chave ou sessão) chama.
create or replace function a1_sa_destravar()
returns void language sql security definer
set search_path = public, extensions, pg_temp as $$
  insert into a1_sa_tentativas (ip, ok) values ('liberado pelo superadmin', true);
$$;

-- Cadastra (ou troca) o segredo. Só grava se o código que a pessoa leu no app
-- conferir: segredo digitado errado não tranca o superadmin para fora.
create or replace function a1_sa_totp_cadastrar(p_segredo_hex text, p_codigo text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_seg bytea; v_agora bigint := a1_sa_passo_agora(); v_passo bigint;
begin
  if coalesce(p_segredo_hex, '') !~ '^[0-9a-f]{40}$' then
    return json_build_object('ok', false, 'erro', 'segredo_invalido');
  end if;
  if coalesce(p_codigo, '') !~ '^[0-9]{6}$' then
    return json_build_object('ok', false, 'erro', 'codigo_invalido');
  end if;
  v_seg := decode(p_segredo_hex, 'hex');
  select p into v_passo from generate_series(v_agora - 1, v_agora + 1) p
   where a1_sa_totp_codigo(v_seg, p) = p_codigo limit 1;
  if v_passo is null then return json_build_object('ok', false, 'erro', 'codigo_invalido'); end if;
  insert into a1_sa_totp (id, segredo, ultimo_passo, cadastrado_em) values (1, v_seg, v_passo, now())
  on conflict (id) do update set segredo = excluded.segredo, ultimo_passo = excluded.ultimo_passo,
                                 cadastrado_em = excluded.cadastrado_em;
  -- "where true": o Supabase (pg_safeupdate) recusa DELETE sem WHERE vindo da API.
  delete from a1_sa_sessoes where true;
  return json_build_object('ok', true);
end $$;

-- Entrar com o código. Devolve o token da sessão (o banco guarda só o hash).
create or replace function a1_sa_login(p_codigo text, p_ip text default null, p_agente text default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_t a1_sa_totp%rowtype; v_agora bigint := a1_sa_passo_agora(); v_passo bigint;
  v_erros_ip int; v_erros int; v_erros_dia int; v_token text; v_expira timestamptz := now() + interval '12 hours';
begin
  perform pg_advisory_xact_lock(hashtext('a1-sa-login'));
  select * into v_t from a1_sa_totp where id = 1;
  if v_t.id is null then return json_build_object('ok', false, 'erro', 'nao_configurado'); end if;

  select e.ip_15, e.todos_15, e.todos_24h into v_erros_ip, v_erros, v_erros_dia from a1_sa_erros(p_ip) e;
  if v_erros_ip >= 5 or v_erros >= 10 or v_erros_dia >= 30 then
    return json_build_object('ok', false, 'erro', 'bloqueado');
  end if;

  if coalesce(p_codigo, '') ~ '^[0-9]{6}$' then
    select p into v_passo from generate_series(v_agora - 1, v_agora + 1) p
     where p > v_t.ultimo_passo and a1_sa_totp_codigo(v_t.segredo, p) = p_codigo limit 1;
  end if;

  if v_passo is null then
    insert into a1_sa_tentativas (ip, ok) values (p_ip, false);
    return json_build_object('ok', false, 'erro', 'codigo_invalido',
                             'restantes', greatest(0, 4 - v_erros_ip));
  end if;

  update a1_sa_totp set ultimo_passo = v_passo where id = 1;
  insert into a1_sa_tentativas (ip, ok) values (p_ip, true);
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into a1_sa_sessoes (token_hash, expira_em, ip, agente)
  values (encode(digest(v_token, 'sha256'), 'hex'), v_expira, p_ip, left(p_agente, 300));
  -- Faxina: sessão vencida e tentativa velha não servem para nada.
  delete from a1_sa_sessoes where expira_em < now();
  delete from a1_sa_tentativas where em < now() - interval '2 days';
  return json_build_object('ok', true, 'token', v_token, 'expira_em', v_expira);
end $$;

-- A sessão vale? (chamada pela Edge Function a cada pedido)
create or replace function a1_sa_sessao_valida(p_token text)
returns boolean language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_ok boolean;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then return false; end if;
  update a1_sa_sessoes set ultimo_uso = now()
   where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expira_em > now()
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

create or replace function a1_sa_sair(p_token text)
returns void language sql security definer
set search_path = public, extensions, pg_temp as $$
  delete from a1_sa_sessoes where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

create or replace function a1_sa_sair_todas()
returns int language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare n int;
begin
  delete from a1_sa_sessoes where true;  -- ver a1_sa_totp_cadastrar
  get diagnostics n = row_count;
  return n;
end $$;

-- Só a service_role (a Edge Function e quem entra com a chave) executa.
do $$
declare f text;
begin
  foreach f in array array[
    'a1_sa_totp_codigo(bytea, bigint)', 'a1_sa_passo_agora()', 'a1_sa_erros(text)',
    'a1_sa_totp_status()', 'a1_sa_destravar()',
    'a1_sa_totp_cadastrar(text, text)', 'a1_sa_login(text, text, text)',
    'a1_sa_sessao_valida(text)', 'a1_sa_sair(text)', 'a1_sa_sair_todas()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

-- =============================================================================
-- COMO CONFERIR
--   select a1_sa_totp_status();                 -- {"configurado": false, ...}
--   -- vetor do RFC 6238 (segredo "12345678901234567890", tempo 59): 287082
--   select a1_sa_totp_codigo(convert_to('12345678901234567890', 'UTF8'), 1);
-- =============================================================================
