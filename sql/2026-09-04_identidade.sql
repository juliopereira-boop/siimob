-- =============================================================================
-- IDENTIDADE DA SESSÃO NO BANCO — a base de autorização dos módulos novos
--
-- POR QUE ESTE ARQUIVO EXISTE
-- Hoje o banco sabe responder UMA pergunta: "de que cliente é esta sessão?"
-- (a1_tenant). Todas as políticas de RLS param aí. Quem é a pessoa, que papel
-- ela tem e o que ela pode ver DENTRO do cliente é decidido no navegador —
-- podeEditarProcesso, temVisaoCompleta e isMeuProcesso são funções JavaScript.
--
-- Isso significa que, hoje, um corretor com a chave pública (que está no código
-- do site, por natureza) e o próprio token de sessão consegue pedir ao
-- PostgREST a carteira inteira da empresa dele. A tela não mostra; o banco
-- entrega. Entre clientes o isolamento é real; dentro do cliente, não.
--
-- Este arquivo NÃO conserta o módulo de Repasse existente — mexer nas políticas
-- de a1_cases com cliente usando é assunto para uma janela própria, com plano
-- de rollback. O que ele faz é dar ao banco as perguntas que faltam, para que
-- os módulos NOVOS já nasçam com a regra no lugar certo, e para que o Repasse
-- possa ser migrado depois usando as mesmas funções.
--
-- NÃO MUDA NADA DO QUE JÁ EXISTE: só acrescenta funções. Nenhuma política é
-- alterada, nenhuma tabela é tocada, nenhum usuário nota diferença.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ─── A sessão de quem está chamando ──────────────────────────────────────────
-- Uma leitura só, reaproveitada por todas as funções abaixo. STABLE permite ao
-- Postgres avaliar uma vez por comando em vez de uma vez por linha — o que
-- importa quando isto entrar em política de RLS de tabela grande.
create or replace function a1_sessao()
returns a1_sessions
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select s.* from a1_sessions s
  where s.token = current_setting('request.headers', true)::json->>'x-session-token'
    and (s.expires_at is null or s.expires_at > now())
  limit 1;
$$;

-- Quem é. Para gestor é o id em a1_users; para parceiro, o id em a1_partners —
-- é assim que a1_partner_login grava a sessão, e por isso serve para comparar
-- direto com colunas do tipo corretor_id.
create or replace function a1_ator()
returns uuid language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select (a1_sessao()).user_id;
$$;

-- owner | admin | partner | null (sessão inválida ou expirada)
create or replace function a1_papel()
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select (a1_sessao()).role;
$$;

-- Gestor do cliente: enxerga tudo dentro do próprio tenant. Qualquer papel que
-- não seja 'partner' é gestor — é a mesma regra que o sistema já usa nas telas
-- (souGestorUser), escrita agora onde não dá para burlar.
create or replace function a1_e_gestor()
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select coalesce((a1_sessao()).role, '') not in ('', 'partner');
$$;

-- cca | corretor | analista | despachante | coordenador | null
create or replace function a1_tipo_ator()
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select p.type from a1_partners p
  where p.id = (a1_sessao()).user_id and (a1_sessao()).role = 'partner'
  limit 1;
$$;

-- Uma permissão do parceiro, lida do banco e não do navegador.
-- Gestor tem tudo. Gerente tem tudo, como já vale nas telas.
create or replace function a1_perm(p_chave text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when a1_e_gestor() then true
    else coalesce(
      (select (p.permissions->>'gerente')::boolean from a1_partners p
        where p.id = (a1_sessao()).user_id limit 1), false)
      or coalesce(
      (select (p.permissions->>p_chave)::boolean from a1_partners p
        where p.id = (a1_sessao()).user_id limit 1), false)
  end;
$$;

-- Empresa correspondente do parceiro — o escopo de quem é 'cca'.
create or replace function a1_empresa_ator()
returns uuid language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select p.empresa_id from a1_partners p
  where p.id = (a1_sessao()).user_id and (a1_sessao()).role = 'partner'
  limit 1;
$$;

-- ─── O módulo está licenciado para este cliente? ─────────────────────────────
-- A licença passa a valer NO BANCO, e não só na tela. Desligar o módulo no
-- superadmin deixa de ser uma questão de esconder um menu: as tabelas do módulo
-- param de responder. É isto que garante que os módulos novos nasçam inertes
-- para todos os clientes de hoje.
create or replace function a1_tem_modulo(p_chave text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select exists (
    select 1 from a1_tenant_modules tm
    where tm.tenant_id = a1_tenant() and tm.module_key = p_chave
  );
$$;

-- As funções são de leitura e não expõem nada além do que a própria sessão já
-- carrega. anon precisa executá-las porque toda chamada do sistema chega como
-- anon com o token no cabeçalho.
grant execute on function a1_sessao()        to anon, authenticated;
grant execute on function a1_ator()          to anon, authenticated;
grant execute on function a1_papel()         to anon, authenticated;
grant execute on function a1_e_gestor()      to anon, authenticated;
grant execute on function a1_tipo_ator()     to anon, authenticated;
grant execute on function a1_perm(text)      to anon, authenticated;
grant execute on function a1_empresa_ator()  to anon, authenticated;
grant execute on function a1_tem_modulo(text) to anon, authenticated;

-- =============================================================================
-- COMO CONFERIR
--   Com uma sessão válida no cabeçalho x-session-token:
--     select a1_ator(), a1_papel(), a1_e_gestor(), a1_tipo_ator();
--     select a1_tem_modulo('PRE_ANALISE');   -- false até o superadmin liberar
--   Sem token, ou com token expirado, tudo devolve null/false — que é o que
--   fecha a porta por padrão.
-- =============================================================================
