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

-- ─── Quem é ──────────────────────────────────────────────────────────────────
-- ATENÇÃO A ESTA FUNÇÃO. Ela é a peça de que todo o resto depende, e a primeira
-- versão estava errada por uma suposição que eu não tinha conferido no código
-- do login.
--
-- a1_partner_login NÃO guarda o id do parceiro na sessão. Ele cria (ou reusa)
-- um "usuário-sombra" em a1_users com o mesmo CPF e guarda o id DESSE usuário.
-- Ou seja: a1_sessions.user_id de um corretor é um id de a1_users, e nunca vai
-- ser igual a um corretor_id, que é id de a1_partners.
--
-- Com a versão errada o sistema falhava fechado: corretor nenhum enxergaria a
-- própria carteira e permissão nenhuma seria reconhecida. Seguro, e inútil.
--
-- A ponte é o CPF, com o mesmo filtro que o login usa — em vez de alterar
-- a1_partner_login, que é caminho de produção com cliente logado neste momento.
create or replace function a1_ator()
returns uuid language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when (a1_sessao()).role = 'partner' then (
      select p.id from a1_partners p
        join a1_users u on u.tenant_id = p.tenant_id and u.cpf = p.cpf
       where u.id = (a1_sessao()).user_id
         and coalesce(p.is_active, true) and coalesce(p.approved, true)
       order by p.id limit 1)
    else (a1_sessao()).user_id
  end;
$$;

-- O id da sessão em si, sem a tradução acima. Serve para auditoria e para o
-- monitor de acessos, que falam de a1_users.
create or replace function a1_usuario()
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
  where p.id = a1_ator() and (a1_sessao()).role = 'partner'
  limit 1;
$$;

-- Uma permissão do parceiro, lida do banco e não do navegador.
-- Gestor tem tudo. Gerente tem tudo, como já vale nas telas.
--
-- A comparação é textual de propósito. Um ::boolean aqui explodiria diante de
-- um valor fora do padrão gravado por qualquer tela antiga ("sim", "1x", "");
-- e como esta função roda DENTRO de política de RLS, o erro não recusaria a
-- linha: derrubaria a consulta inteira da tabela para aquele usuário. Texto
-- desconhecido vira "não pode", que é o lado seguro de errar.
create or replace function a1_perm(p_chave text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when a1_e_gestor() then true
    else coalesce(
      (select (p.permissions->>'gerente') in ('true','t','1')
         or (p.permissions->>p_chave) in ('true','t','1')
         from a1_partners p
        where p.id = a1_ator() limit 1), false)
  end;
$$;

-- Empresa correspondente do parceiro — o escopo de quem é 'cca'.
create or replace function a1_empresa_ator()
returns uuid language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select p.empresa_id from a1_partners p
  where p.id = a1_ator() and (a1_sessao()).role = 'partner'
  limit 1;
$$;

-- ─── O módulo está licenciado para este cliente? ─────────────────────────────
-- A licença passa a valer NO BANCO, e não só na tela. Desligar o módulo no
-- superadmin deixa de ser uma questão de esconder um menu: as tabelas do módulo
-- param de responder. É isto que garante que os módulos novos nasçam inertes
-- para todos os clientes de hoje.
--
-- A VIGÊNCIA CONTA. O superadmin pode liberar um módulo com data de validade
-- ("Expira: 31/12/2026" no painel, expires_at na tabela). A primeira versão
-- desta função só perguntava se a linha existia — uma licença vencida seguiria
-- valendo no banco por tempo indeterminado, e o painel mostrando "expirado"
-- enquanto a API continuava entregando os dados. Vencida é o mesmo que não ter.
create or replace function a1_tem_modulo(p_chave text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select exists (
    select 1 from a1_tenant_modules tm
    where tm.tenant_id = a1_tenant() and tm.module_key = p_chave
      and (tm.expires_at is null or tm.expires_at > now())
  );
$$;

-- ─── Estamos dentro do orquestrador? ─────────────────────────────────────────
-- Marca válida só durante a transação, ligada pelas funções de transição. Os
-- gatilhos de proteção usam isto para distinguir "a esteira mudou a situação"
-- de "alguém mandou um PATCH direto na tabela". O navegador não tem como ligar
-- esta marca: o PostgREST não expõe set_config, e nenhuma função exposta a
-- liga sem antes validar a transição inteira.
create or replace function a1_no_orquestrador()
returns boolean language sql stable
set search_path = public, extensions, pg_temp as $$
  select coalesce(current_setting('a1.orquestrador', true), '') = '1';
$$;

-- As funções são de leitura e não expõem nada além do que a própria sessão já
-- carrega. anon precisa executá-las porque toda chamada do sistema chega como
-- anon com o token no cabeçalho.
grant execute on function a1_sessao()        to anon, authenticated;
grant execute on function a1_ator()          to anon, authenticated;
grant execute on function a1_usuario()       to anon, authenticated;
grant execute on function a1_papel()         to anon, authenticated;
grant execute on function a1_e_gestor()      to anon, authenticated;
grant execute on function a1_tipo_ator()     to anon, authenticated;
grant execute on function a1_perm(text)      to anon, authenticated;
grant execute on function a1_empresa_ator()  to anon, authenticated;
grant execute on function a1_tem_modulo(text) to anon, authenticated;
grant execute on function a1_no_orquestrador() to anon, authenticated;

-- =============================================================================
-- COMO CONFERIR
--   Com uma sessão válida no cabeçalho x-session-token:
--     select a1_ator(), a1_papel(), a1_e_gestor(), a1_tipo_ator();
--     select a1_tem_modulo('PRE_ANALISE');   -- false até o superadmin liberar
--   Sem token, ou com token expirado, tudo devolve null/false — que é o que
--   fecha a porta por padrão.
-- =============================================================================
