-- =============================================================================
-- CRIAR REPASSE — a trava de banco, alinhada com a tela
--
-- POR QUE ESTE ARQUIVO EXISTE
-- A política a1_cases_repasse_create_capability já está em produção e fecha o
-- buraco certo: sem ela, um corretor com o botão escondido ainda criava repasse
-- chamando a API direto. O problema não é a política — é que ela e a tela
-- discordam sobre o que significa uma permissão que NÃO ESTÁ no cadastro.
--
--   tela  (hasPerm)  →  defaults = { criar_repasses: true }   ausente = PODE
--   banco (a1_perm)  →  coalesce(..., false)                  ausente = NÃO PODE
--
-- Nenhum dos dois está errado sozinho. Juntos, produzem o pior resultado
-- possível: a tela oferece o botão, a pessoa preenche o cadastro inteiro, e o
-- banco recusa no fim. Com os cadastros de hoje isso atinge 53 parceiros
-- ativos — 36 corretores, 7 coordenadores, 5 agências e 3 modalidades da S T,
-- mais 2 da Demonstração. Nenhum deles tem a chave `criar_repasses`, porque
-- todos foram cadastrados antes de a chave existir.
--
-- O QUE ESTE ARQUIVO FAZ: mantém a trava e faz o banco falar a mesma língua da
-- tela. Ausente passa a valer o mesmo padrão dos dois lados. Quem foi
-- explicitamente desmarcado continua barrado — que é exatamente o caso que
-- motivou tudo isto.
--
-- O QUE ELE NÃO FAZ: não afrouxa nada que estivesse fechado antes de hoje de
-- manhã. Antes da política, QUALQUER pessoa do cliente criava repasse pela API.
-- Depois deste arquivo, quem tem `criar_repasses:false` não cria — nem pela
-- tela, nem pelo console, nem por curl.
--
-- O CAMINHO PARA FECHAR DE VEZ (não é este arquivo): preencher `criar_repasses`
-- em todos os cadastros e só então trocar o padrão para false, nos dois lados
-- ao mesmo tempo. Fechar antes de preencher é o que derruba cliente.
-- =============================================================================

-- ─── A regra, num lugar só ───────────────────────────────────────────────────
-- a1_perm() continua existindo e continua significando "ausente = não". Ela
-- está certa para chave nova, escrita depois que o cadastro já a conhece.
-- Esta aqui é para as chaves ANTIGAS, que precisam de um padrão explícito
-- porque o cadastro de produção foi preenchido antes delas.
--
-- O padrão vem como argumento, e não de uma tabela de defaults aqui dentro, de
-- propósito: quem escreve a regra é obrigado a declarar o que acontece com
-- cadastro antigo. Esquecer de pensar nisso é como se chega a 53 pessoas
-- trancadas do lado de fora.
create or replace function a1_perm_padrao(p_chave text, p_padrao boolean)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when a1_e_gestor() then true
    else coalesce((
      select
        -- Gerente vale por cima de tudo, venha do perfil ou do cadastro.
        case when coalesce(pf.permissions, p.permissions)->>'gerente' in ('true','t','1')
             then true
             -- Chave presente manda, seja true ou false. É o desmarcar
             -- explícito do gestor, e ele precisa valer.
             when coalesce(pf.permissions, p.permissions) ? p_chave
             then coalesce(pf.permissions, p.permissions)->>p_chave in ('true','t','1')
             -- Ausente: o padrão declarado por quem chamou.
             else p_padrao
        end
      from a1_partners p
      left join a1_perfis pf on pf.id = p.perfil_id and pf.ativo
      where p.id = a1_ator()
      limit 1), false)
  end;
$$;
grant execute on function a1_perm_padrao(text, boolean) to anon, authenticated;

-- ─── PRÉ-VOO: quem fica de fora ──────────────────────────────────────────────
-- Rode isto ANTES do bloco de aplicação e olhe o número. Se `bloqueados` vier
-- alto com o padrão que você escolheu, pare — o problema é o cadastro, não a
-- política.
--
--   with efetivo as (
--     select t.name as cliente, p.type,
--            coalesce(coalesce(pf.permissions,p.permissions)->>'gerente' in ('true','t','1'), false)
--         or case when coalesce(pf.permissions,p.permissions) ? 'criar_repasses'
--                 then coalesce(pf.permissions,p.permissions)->>'criar_repasses' in ('true','t','1')
--                 else true end                      -- <<< o padrão em teste
--            as pode
--     from a1_partners p
--     join a1_tenants t on t.id = p.tenant_id
--     left join a1_perfis pf on pf.id = p.perfil_id and pf.ativo
--     where p.is_active and p.approved)
--   select cliente, type, count(*) ativos,
--          count(*) filter (where not pode) bloqueados
--     from efetivo group by 1,2 order by bloqueados desc;

-- ─── APLICAÇÃO ───────────────────────────────────────────────────────────────
begin;

-- A política de hoje de manhã sai e entra a mesma coisa com o padrão corrigido.
-- Trocar em vez de somar: duas políticas restritivas sobre o mesmo comando
-- fazem AND, e a antiga anularia a nova sem nenhum sinal.
drop policy if exists a1_cases_repasse_create_capability on a1_cases;

create policy a1_cases_repasse_create_capability
on a1_cases
as restrictive
for insert
to public
with check (
  coalesce(module_key,'') <> 'repasse'
  or (a1_has_module('repasse') and a1_perm_padrao('criar_repasses', true))
);

commit;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────────────────────
--   select policyname, permissive, cmd, with_check
--     from pg_policies
--    where tablename = 'a1_cases'
--      and policyname = 'a1_cases_repasse_create_capability';
--
-- Esperado: permissive = RESTRICTIVE, cmd = INSERT, e o with_check citando
-- a1_perm_padrao.
--
-- Depois, com o sistema no ar, os três cenários:
--   a) corretor com criar_repasses:false  → recusa (é o caso que motivou tudo)
--   b) corretor sem a chave               → cria (comportamento de sempre)
--   c) gestor                             → cria
--
-- ROLLBACK, se algo autorizado falhar:
--   drop policy if exists a1_cases_repasse_create_capability on a1_cases;
-- Isso volta ao estado de ontem: sem trava de banco nenhuma na criação.
-- =============================================================================
