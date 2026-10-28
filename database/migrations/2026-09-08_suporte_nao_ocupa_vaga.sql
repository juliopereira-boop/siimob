-- =============================================================================
-- A VISITA DO SUPORTE NÃO OCUPA VAGA DO CLIENTE
--
-- O botão "Acessar" do superadmin abre uma sessão em nome de um usuário do
-- cliente, marcada com origem = 'suporte'. Essa marca já tirava a visita do
-- Monitor de acessos — para o nosso próprio suporte não inflar o número dele.
--
-- Só que a1_ativos(), que é quem conta as vagas do plano, nunca soube da marca:
-- ela conta TODA sessão viva. Com o teto em 3 e três pessoas trabalhando,
-- bastava eu entrar para investigar um problema e a quarta pessoa levar
-- "Limite de 3 acessos simultâneos atingido" na cara — o suporte trancando o
-- cliente para fora enquanto tenta ajudá-lo. Pior: sem nada na tela ligando uma
-- coisa à outra, o cliente ligaria reclamando de um limite que ele não estourou.
--
-- Nada mais muda: o teto, a janela e a sessão única continuam iguais. A única
-- diferença é que sessão de suporte deixa de ser contada como vaga.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

create or replace function a1_ativos(p_tenant uuid, p_excluir_user uuid default null)
returns int language sql stable security definer as $$
  select count(distinct user_id)::int
  from   a1_sessions
  where  tenant_id = p_tenant
    and  expires_at > now()
    and  last_seen  > now() - a1_sessao_janela()
    and  coalesce(origem, 'login') <> 'suporte'
    and  (p_excluir_user is null or user_id <> p_excluir_user);
$$;

grant execute on function a1_ativos(uuid, uuid) to anon, authenticated;

-- =============================================================================
-- COMO CONFERIR
--   1. Anote o teto do cliente:  select max_users from a1_tenants where slug = '…';
--   2. Veja a contagem antes:    select a1_ativos('<tenant_id>');
--   3. Entre pelo superadmin com o botão "Acessar" em qualquer usuário.
--   4. Repita o passo 2: o número tem de ser o MESMO.
--   5. E a visita continua registrada, como sempre esteve:
--        select origem, count(*) from a1_sessions
--         where tenant_id = '<tenant_id>' group by origem;
-- =============================================================================
