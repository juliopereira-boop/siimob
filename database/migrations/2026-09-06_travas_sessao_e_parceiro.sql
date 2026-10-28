-- =============================================================================
-- DUAS TRAVAS QUE FALTAVAM: A SESSÃO ALHEIA E A PRÓPRIA PERMISSÃO
--
-- POR QUE ESTE ARQUIVO EXISTE
-- Os módulos novos (Pré-análise e Comercial) apoiam TODA a autorização deles em
-- duas funções: a1_e_gestor(), que lê a1_sessions.role, e a1_perm(), que lê
-- a1_partners.permissions. As políticas dessas duas tabelas antigas isolam só
-- por cliente (tenant_id = a1_tenant()) e o papel anon tem select/insert/
-- update/delete nas duas (schema.sql, BLOCO 7e e BLOCO 10). Ou seja: dentro do
-- mesmo cliente, quem lê a tabela lê a base inteira dela.
--
-- Na prática, com a chave pública que está em js/config.js — pública por
-- natureza, é o navegador que a usa — e um login legítimo de corretor:
--
--   GET  /rest/v1/a1_sessions?select=token,role     -> devolve o token do dono
--   PATCH/rest/v1/a1_sessions?token=eq.<o meu>      -> {"role":"owner"}
--   PATCH/rest/v1/a1_partners?id=eq.<o meu>         -> {"permissions":{"gerente":true}}
--
-- Qualquer um dos três transforma um corretor em gestor. A partir daí
-- a1_pa_visivel/a1_co_visivel devolvem true para a carteira inteira do cliente
-- (nome, CPF, renda analisada, documentos) e as políticas _escrever da esteira
-- passam a aceitar as escritas dele. O portão de papel que a tela instalou em
-- Configurações vira decoração: quem contorna o banco não passa pela tela.
--
-- O isolamento ENTRE clientes nunca esteve em risco e continua igual: tudo
-- aqui é dentro do mesmo tenant_id.
--
-- O QUE MUDA
--   1. a1_sessions passa a devolver ao navegador UMA linha: a da própria
--      requisição. Escrita direta some — criar e apagar sessão já é trabalho de
--      a1_login/a1_partner_login/a1_logout/a1_touch_session, todas
--      SECURITY DEFINER, que não passam por grant nem por política.
--   2. a1_partners continua legível e editável como hoje, MENOS as colunas que
--      decidem poder (permissions, approved, is_active, type, cpf, tenant_id):
--      essas só mudam se quem está pedindo não for parceiro. Um gatilho, e não
--      uma política, porque a regra é sobre a COLUNA que mudou, e política de
--      RLS decide linha, não coluna.
--
-- O QUE NÃO MUDA (confira antes de rodar, é o que eu conferi)
--   - Login, logout, heartbeat e o limite de acessos simultâneos: todos passam
--     por função SECURITY DEFINER (sql/2026-08-24_sessao_unica_e_limite.sql).
--   - O painel do superadmin usa a chave de serviço, que não é submetida a RLS.
--   - O pré-cadastro de corretor por link (sql/2026-08-26_precadastro_corretores.sql)
--     insere em a1_partners de dentro de uma função SECURITY DEFINER e sem
--     sessão nenhuma no cabeçalho: o gatilho abaixo só barra quem está logado
--     COMO PARCEIRO, então esse caminho continua funcionando.
--   - Gestor (owner/admin) não perde nada: todo o cadastro de corretores,
--     analistas e correspondentes continua exatamente como está.
--
-- SE ALGUM FLUXO DE PARCEIRO QUEBRAR, é sinal de que hoje um parceiro edita
-- cadastro de terceiro pela tela. Isso é o defeito, não a trava — mas o
-- rollback é uma linha: drop trigger trg_a1_partners_poder on a1_partners.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ─── 1. A sessão é de quem a está usando ─────────────────────────────────────
-- O comentário que estava em schema.sql já dizia "users can only see/delete
-- their own session". A política não fazia isso. Agora faz.
--
-- Só SELECT, e só a própria linha. Sem política de INSERT/UPDATE/DELETE: sem
-- política, RLS nega por padrão — e ainda assim o grant é revogado logo abaixo,
-- porque duas travas custam o mesmo que uma e a segunda avisa mais cedo.
drop policy if exists "sessions_tenant_isolation" on a1_sessions;
drop policy if exists a1_sessions_propria       on a1_sessions;

create policy a1_sessions_propria on a1_sessions
  for select using (
    token = current_setting('request.headers', true)::json->>'x-session-token'
  );

revoke insert, update, delete on a1_sessions from anon, authenticated;

-- ─── 2. Ninguém assina o próprio crachá ──────────────────────────────────────
-- a1_perm() lê permissions da linha de a1_partners que corresponde a quem está
-- chamando. Enquanto o dono da permissão puder escrever a própria permissão, a
-- permissão não vale nada.
--
-- As colunas travadas são as que mudam PODER, e só elas:
--   permissions  — a chave 'gerente' aqui libera a carteira inteira do cliente
--   approved / is_active — a1_ator() só reconhece parceiro aprovado e ativo,
--                          então ligá-las em outra pessoa cria acesso
--   type         — 'cca' abre o escopo por empresa (a1_empresa_ator)
--   cpf          — é o CPF que liga a sessão ao parceiro (a1_ator); trocá-lo é
--                  passar a responder como outra pessoa
--   tenant_id    — mudar de cliente é o que a RLS existe para impedir
--
-- Nome, telefone, e-mail, região, aliases e empreendimentos continuam livres:
-- não decidem nada.
create or replace function a1_partners_trava_poder()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  -- Só olha quem está logado COMO PARCEIRO. Gestor passa; e sem sessão no
  -- cabeçalho (é o caso das funções SECURITY DEFINER do pré-cadastro e do
  -- login) também passa, porque ali a porta é outra: sem sessão a RLS já não
  -- deixa o navegador chegar à tabela.
  if coalesce(a1_papel(), '') <> 'partner' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'parceiro_nao_apaga_cadastro';
  end if;

  if tg_op = 'INSERT' then
    -- Cadastro novo com permissão embutida é o mesmo golpe por outro caminho:
    -- basta criar uma linha com o próprio CPF e 'gerente' dentro.
    if coalesce(new.permissions, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'parceiro_nao_define_permissao';
    end if;
    return new;
  end if;

  if new.permissions is distinct from old.permissions
     or new.approved  is distinct from old.approved
     or new.is_active is distinct from old.is_active
     or new.type      is distinct from old.type
     or new.cpf       is distinct from old.cpf
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'parceiro_nao_define_permissao';
  end if;

  return new;
end $$;

drop trigger if exists trg_a1_partners_poder on a1_partners;
create trigger trg_a1_partners_poder
  before insert or update or delete on a1_partners
  for each row execute function a1_partners_trava_poder();

-- =============================================================================
-- COMO CONFERIR (com o token de um corretor no cabeçalho)
--   select count(*) from a1_sessions;                 -- 1, a dele
--   update a1_sessions set role='owner' where true;   -- erro de permissão
--   update a1_partners set permissions='{"gerente":true}'::jsonb
--     where id = a1_ator();                           -- parceiro_nao_define_permissao
--   update a1_partners set phone='11999999999'
--     where id = a1_ator();                           -- continua funcionando
--
-- A prova automatizada está em testes/sql/prova-seguranca.sql, seção
-- "SESSÃO E PERMISSÃO". Rode com: PGPORT=5473 testes/sql/roda.sh
-- =============================================================================
