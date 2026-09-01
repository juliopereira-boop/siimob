-- =============================================================================
-- MONITOR DE ACESSOS — quem está online agora e quantos acessaram por período
--
-- O QUE ESTE ARQUIVO FAZ
-- Cria o registro histórico de acessos e a função que o superadmin usa para
-- montar o painel. NÃO muda login, permissão, plano nem qualquer tela do
-- cliente: nenhum usuário do sistema enxerga diferença depois de rodar isto.
--
-- POR QUE UM REGISTRO NOVO
-- a1_presence responde "quem está online AGORA" e nada além disso: cada linha é
-- sobrescrita a cada batida do coração, então ela não guarda ontem. a1_sessions
-- guarda a sessão, mas é limpa quando expira — histórico que se apaga sozinho
-- não é histórico. Daí uma tabela própria, só de acrescentar, que ninguém
-- atualiza nem apaga.
--
-- POR QUE UM GATILHO, E NÃO UMA MUDANÇA NO LOGIN
-- Todo acesso — do gestor, do corretor, e também o do suporte entrando no
-- cliente — passa por uma linha nova em a1_sessions. Pendurar o registro ali
-- pega todos os caminhos de uma vez, sem reescrever a1_login nem
-- a1_partner_login, que são as funções mais delicadas do sistema.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ─── De onde veio a sessão ───────────────────────────────────────────────────
-- O suporte entrando como o cliente cria sessão igual à dele. Sem separar, o
-- painel contaria a nossa própria visita como movimento do cliente e o número
-- perderia o sentido.
alter table a1_sessions add column if not exists origem text;

-- ─── O histórico ─────────────────────────────────────────────────────────────
create table if not exists a1_acessos (
  id         bigserial   primary key,
  tenant_id  uuid,
  user_id    uuid,
  papel      text,                       -- owner | admin | partner | ...
  origem     text        not null default 'login',   -- login | suporte
  criado_em  timestamptz not null default now()
);

create index if not exists idx_acessos_quando on a1_acessos (criado_em desc);
create index if not exists idx_acessos_tenant on a1_acessos (tenant_id, criado_em desc);

-- ─── O gatilho ───────────────────────────────────────────────────────────────
create or replace function a1_registrar_acesso()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  insert into a1_acessos (tenant_id, user_id, papel, origem)
  values (new.tenant_id, new.user_id, new.role, coalesce(new.origem, 'login'));
  return new;
exception when others then
  -- Registrar acesso NUNCA pode impedir alguém de entrar no sistema. Se falhar,
  -- perde-se uma linha de estatística; ninguém fica de fora.
  return new;
end $$;

drop trigger if exists trg_registrar_acesso on a1_sessions;
create trigger trg_registrar_acesso
  after insert on a1_sessions
  for each row execute function a1_registrar_acesso();

-- ─── Ninguém lê isto pela API pública ────────────────────────────────────────
-- Quem acessa e quando é informação de operação, não de cliente. Só a chave de
-- serviço (o superadmin) enxerga.
alter table a1_acessos enable row level security;
drop policy if exists "acessos_nada" on a1_acessos;
revoke all on a1_acessos from anon, authenticated;

-- ─── O painel ────────────────────────────────────────────────────────────────
-- Uma chamada devolve tudo: quem está online agora, o histórico do período
-- pedido e a quebra por cliente. Agregar no banco em vez de baixar as linhas
-- é o que faz o painel continuar rápido quando o histórico crescer.
--
--   p_janela: 'hora'   → últimas 24 horas, balde de 1 hora
--             'dia'    → últimos 30 dias,  balde de 1 dia
--             'semana' → últimas 12 semanas, balde de 1 semana
create or replace function a1_sa_monitor(p_janela text default 'dia')
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_passo   interval;
  v_desde   timestamptz;
  v_online  interval := interval '3 minutes';   -- batida do coração é a cada 50s
  v_res     json;
begin
  if    p_janela = 'hora'   then v_passo := interval '1 hour'; v_desde := now() - interval '24 hours';
  elsif p_janela = 'semana' then v_passo := interval '1 week'; v_desde := now() - interval '12 weeks';
  else  p_janela := 'dia';       v_passo := interval '1 day';  v_desde := now() - interval '30 days';
  end if;

  select json_build_object(
    'janela', p_janela,
    'gerado_em', now(),

    -- ── agora ────────────────────────────────────────────────────────────────
    'online', (select count(*) from a1_presence where last_seen > now() - v_online),
    'online_por_papel', coalesce((
      select json_agg(x) from (
        select coalesce(role,'?') as papel, count(*) as quantos
        from a1_presence where last_seen > now() - v_online
        group by 1 order by 2 desc) x), '[]'::json),
    'online_lista', coalesce((
      select json_agg(x) from (
        select p.name as nome, coalesce(p.role,'?') as papel, p.module as modulo,
               t.name as cliente, p.last_seen,
               round(extract(epoch from (now() - p.last_seen)))::int as ha_segundos
        from a1_presence p
        left join a1_tenants t on t.id = p.tenant_id
        where p.last_seen > now() - v_online
        order by p.last_seen desc
        limit 200) x), '[]'::json),

    -- ── histórico ────────────────────────────────────────────────────────────
    -- generate_series garante balde vazio no gráfico: hora sem acesso tem de
    -- aparecer como zero, e não sumir e encolher o eixo.
    'baldes', coalesce((
      select json_agg(x order by x.inicio) from (
        select b.inicio,
               count(a.id)                        as acessos,
               count(distinct a.user_id)          as usuarios
        from   generate_series(
                 date_trunc(case when p_janela='hora' then 'hour'
                                 when p_janela='semana' then 'week'
                                 else 'day' end, v_desde),
                 now(), v_passo) as b(inicio)
        left join a1_acessos a
               on a.origem = 'login'
              and a.criado_em >= b.inicio
              and a.criado_em <  b.inicio + v_passo
        group by b.inicio) x), '[]'::json),

    'total_acessos',  (select count(*)                from a1_acessos where origem='login' and criado_em >= v_desde),
    'total_usuarios', (select count(distinct user_id) from a1_acessos where origem='login' and criado_em >= v_desde),
    'acessos_suporte',(select count(*)                from a1_acessos where origem='suporte' and criado_em >= v_desde),

    -- ── por cliente ──────────────────────────────────────────────────────────
    'por_cliente', coalesce((
      select json_agg(x order by x.acessos desc) from (
        select coalesce(t.name,'(sem cliente)') as cliente,
               count(a.id)               as acessos,
               count(distinct a.user_id) as usuarios,
               max(a.criado_em)          as ultimo
        from   a1_acessos a
        left join a1_tenants t on t.id = a.tenant_id
        where  a.origem = 'login' and a.criado_em >= v_desde
        group by 1
        limit 50) x), '[]'::json)
  ) into v_res;

  return v_res;
end $$;

-- Só a chave de serviço. Nem anon nem authenticated executam.
revoke all on function a1_sa_monitor(text) from public, anon, authenticated;
grant execute on function a1_sa_monitor(text) to service_role;

-- ─── Semente: o que já dá para saber do passado ──────────────────────────────
-- As sessões que ainda existem viraram acesso, para o painel não nascer vazio.
-- Roda uma vez só: o "not exists" impede duplicar em execuções seguintes.
insert into a1_acessos (tenant_id, user_id, papel, origem, criado_em)
select s.tenant_id, s.user_id, s.role, 'login', coalesce(s.created_at, now())
from   a1_sessions s
where  not exists (select 1 from a1_acessos a
                    where a.user_id = s.user_id
                      and a.criado_em = coalesce(s.created_at, now()))
on conflict do nothing;

-- =============================================================================
-- COMO CONFERIR
--   1. Entre no sistema com qualquer usuário.
--   2. select * from a1_acessos order by criado_em desc limit 5;
--      → a linha do seu login está lá, com origem = 'login'.
--   3. select a1_sa_monitor('hora');
--      → devolve o json com 'online' maior que zero e 24 baldes.
--   4. No superadmin, aba "Monitor": o painel mostra o mesmo número.
--
-- O QUE ESTE ARQUIVO NÃO FAZ
--   · não altera a1_login, a1_partner_login nem nenhuma regra de senha;
--   · não muda limite de usuários por plano;
--   · não muda nenhuma tela do cliente.
-- =============================================================================
