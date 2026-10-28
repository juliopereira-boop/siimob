-- ══════════════════════════════════════════════════════════════════════════════
-- A tela do Repasse voltando a carregar — RLS avaliada uma vez, não por linha
-- ══════════════════════════════════════════════════════════════════════════════
--
-- O QUE ACONTECEU
-- Em 14/09, por volta das 11:42, a Raissa (THE CRED) abriu o sistema e viu
-- "carreguei 0 de 0 processos (HTTP 500)". O quadro inteiro zerado, VGV R$ 0.
-- Nos logs do Postgres, no mesmo minuto e nos quinze seguintes: nove
-- "canceling statement due to statement timeout". PostgREST devolve 500 nisso.
--
-- Não era permissão e não era rede. Era LENTIDÃO:
--
--   select count(*) from a1_cases where module_key='repasse' and archived=false
--   → 235 linhas, 934 ms
--
-- Quase um segundo para contar 235 linhas de uma tabela de 330. Com a leitura
-- real (Prefer: count=exact, 30 colunas incluindo o payload jsonb) e mais treze
-- consultas paralelas que a mesma tela dispara, o tempo estourava o limite.
--
-- A CAUSA
-- As funções de identidade (a1_e_gestor, a1_ator, a1_case_visao_completa,
-- a1_empresa_ator, a1_tenant) são todas STABLE — isso está certo e não é o
-- problema. O problema é que, dentro do `Filter:` de uma policy, uma função sem
-- argumento é REAVALIADA A CADA LINHA. STABLE autoriza o planejador a reusar o
-- resultado; não o obriga.
--
-- E cada uma dessas funções faz uma consulta de verdade: a1_sessions → a1_users
-- → a1_partners, casando por CPF. São ~1 ms cada. Multiplicado por 235 linhas ×
-- 2 policies RESTRICTIVE × 2 funções: é exatamente o segundo que faltava.
--
-- a1_cases tinha SEIS policies (1 permissiva + 5 restritivas). Restritivas se
-- somam com AND, então o custo de cada uma entra inteiro em toda leitura.
--
-- A CORREÇÃO
-- Envolver cada chamada em `(select ...)`. Isso a transforma num InitPlan:
-- avaliado UMA VEZ no início da consulta, e o valor vira parâmetro.
-- Nenhuma condição muda — as mesmas pessoas veem exatamente as mesmas linhas.
--
-- Medido depois, mesma consulta, mesma sessão: 1002 ms → 9,4 ms. 107×.
--
-- Conferido com as sessões reais de todos os clientes: as contagens por pessoa
-- continuam idênticas (Raissa 235, Neide 235, S T 94, Demonstração 1) e
-- `de_outro_cliente` = 0 em todas. A correção é de velocidade, não de escopo.
--
-- POR QUE SÓ a1_cases
-- O mesmo padrão está em ~60 policies do banco, mas a1_cases é a única tabela
-- com volume: 330 linhas contra 94 de a1_partners e menos de 20 em todo o
-- resto. Medido tabela a tabela com sessão real, o restante responde entre 0,4 e
-- 4,8 ms. Quando qualquer outra crescer, a correção é esta mesma — e é por isso
-- que este comentário existe, para não se redescobrir o motivo daqui a um ano.
--
-- SEGURO DE RODAR DUAS VEZES: cada policy é derrubada antes de ser recriada.
begin;

-- ── Isolamento por cliente ───────────────────────────────────────────────────
drop policy if exists cases_tenant_isolation on public.a1_cases;
create policy cases_tenant_isolation on public.a1_cases
as permissive for all to public
using (tenant_id = (select public.a1_tenant()));

-- ── CRM ──────────────────────────────────────────────────────────────────────
drop policy if exists a1_cases_crm_scope_select on public.a1_cases;
create policy a1_cases_crm_scope_select on public.a1_cases
as restrictive for select to anon, authenticated
using (
  module_key <> 'crm'
  or (select public.a1_e_gestor())
  or (select public.a1_case_visao_completa())
  or exists (
    select 1 from public.a1_partners p
    where p.id = (select public.a1_ator())
      and p.tenant_id = a1_cases.tenant_id
      and p.type = 'corretor'
      and lower(trim(p.name)) = lower(trim(coalesce(a1_cases.broker_name,'')))
  )
);

drop policy if exists a1_cases_crm_scope_update on public.a1_cases;
create policy a1_cases_crm_scope_update on public.a1_cases
as restrictive for update to anon, authenticated
using (
  module_key <> 'crm'
  or (select public.a1_e_gestor())
  or (select public.a1_case_visao_completa())
  or exists (
    select 1 from public.a1_partners p
    where p.id = (select public.a1_ator())
      and p.tenant_id = a1_cases.tenant_id
      and p.type = 'corretor'
      and lower(trim(p.name)) = lower(trim(coalesce(a1_cases.broker_name,'')))
  )
)
with check (
  module_key <> 'crm'
  or (select public.a1_e_gestor())
  or (select public.a1_case_visao_completa())
  or exists (
    select 1 from public.a1_partners p
    where p.id = (select public.a1_ator())
      and p.tenant_id = a1_cases.tenant_id
      and p.type = 'corretor'
      and lower(trim(p.name)) = lower(trim(coalesce(a1_cases.broker_name,'')))
  )
);

drop policy if exists a1_cases_crm_create_scope on public.a1_cases;
create policy a1_cases_crm_create_scope on public.a1_cases
as restrictive for insert to anon, authenticated
with check (
  module_key <> 'crm'
  or (select public.a1_e_gestor())
  or (select public.a1_case_visao_completa())
  or exists (
    select 1 from public.a1_partners p
    where p.id = (select public.a1_ator())
      and p.tenant_id = a1_cases.tenant_id
      and p.type = 'corretor'
      and lower(trim(p.name)) = lower(trim(coalesce(a1_cases.broker_name,'')))
  )
);

-- ── Repasse ──────────────────────────────────────────────────────────────────
drop policy if exists a1_cases_repasse_scope_select on public.a1_cases;
create policy a1_cases_repasse_scope_select on public.a1_cases
as restrictive for select to anon, authenticated
using (
  module_key <> 'repasse'
  or (select public.a1_e_gestor())
  or (select public.a1_case_visao_completa())
  or analista_id = (select public.a1_ator())
  or correspondente_id = (select public.a1_ator())
  or (empresa_id is not null and empresa_id = (select public.a1_empresa_ator()))
  or exists (
    select 1 from public.a1_partners p
    where p.id = (select public.a1_ator())
      and p.tenant_id = a1_cases.tenant_id
      and p.type = 'corretor'
      and lower(trim(p.name)) = lower(trim(coalesce(a1_cases.broker_name,'')))
  )
);

drop policy if exists a1_cases_repasse_scope_update on public.a1_cases;
create policy a1_cases_repasse_scope_update on public.a1_cases
as restrictive for update to anon, authenticated
using (
  module_key <> 'repasse'
  or (select public.a1_e_gestor())
  or (select public.a1_case_visao_completa())
  or analista_id = (select public.a1_ator())
  or correspondente_id = (select public.a1_ator())
  or (empresa_id is not null and empresa_id = (select public.a1_empresa_ator()))
  or exists (
    select 1 from public.a1_partners p
    where p.id = (select public.a1_ator())
      and p.tenant_id = a1_cases.tenant_id
      and p.type = 'corretor'
      and lower(trim(p.name)) = lower(trim(coalesce(a1_cases.broker_name,'')))
  )
)
with check (
  module_key <> 'repasse'
  or (select public.a1_e_gestor())
  or (select public.a1_case_visao_completa())
  or analista_id = (select public.a1_ator())
  or correspondente_id = (select public.a1_ator())
  or (empresa_id is not null and empresa_id = (select public.a1_empresa_ator()))
  or exists (
    select 1 from public.a1_partners p
    where p.id = (select public.a1_ator())
      and p.tenant_id = a1_cases.tenant_id
      and p.type = 'corretor'
      and lower(trim(p.name)) = lower(trim(coalesce(a1_cases.broker_name,'')))
  )
);

drop policy if exists a1_cases_repasse_create_capability on public.a1_cases;
create policy a1_cases_repasse_create_capability on public.a1_cases
as restrictive for insert to public
with check (
  coalesce(module_key,'') <> 'repasse'
  or ( (select public.a1_has_module('repasse'))
       and (select public.a1_perm('criar_repasses'))
       and ( (select public.a1_e_gestor())
             or coalesce((select public.a1_tipo_ator()),'') = any (array['analista','cca']) ) )
);

commit;

-- ── CONFERÊNCIA ──────────────────────────────────────────────────────────────
-- O plano tem de mostrar "InitPlan" e o tempo tem de cair para a casa dos
-- milissegundos. Se voltar a aparecer a1_e_gestor() solto dentro do Filter,
-- alguém recriou uma policy sem o (select ...) e a lentidão volta junto.
--
-- begin;
--   select set_config('request.headers',
--     json_build_object('x-session-token','<token de uma sessao viva>')::text, true);
--   set local role anon;
--   explain (analyze, timing off, costs off)
--   select count(*) from public.a1_cases where module_key='repasse' and archived=false;
-- rollback;
