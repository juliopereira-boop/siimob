-- SIIMOB | PROPOSTA — alinhar entitlement de módulo entre tela e RLS
-- NÃO EXECUTE DIRETAMENTE EM PRODUÇÃO.
-- Pré-requisito: validar primeiro o SELECT de divergência abaixo.
--
-- Motivo:
--   a1_has_module(): plano ativo/trial OU a1_tenant_modules
--   a1_tem_modulo(): somente a1_tenant_modules
-- RLS de PRE_ANALISE usa a1_tem_modulo(); a tela usa a1_has_module().
--
-- Este arquivo não muda políticas, tabelas, dados, roles ou grants.

-- 1) LEITURA: tenants que a tela considera habilitados, mas o RLS bloqueará.
with entitlement as (
  select
    t.id as tenant_id,
    t.slug,
    exists (
      select 1
      from public.a1_plan_modules pm
      where pm.plan_key = t.plan_key
        and pm.module_key = 'PRE_ANALISE'
    ) as permitido_pelo_plano,
    exists (
      select 1
      from public.a1_tenant_modules tm
      where tm.tenant_id = t.id
        and tm.module_key = 'PRE_ANALISE'
        and (tm.expires_at is null or tm.expires_at > now())
    ) as permitido_manualmente
  from public.a1_tenants t
  where t.status in ('trial', 'active')
)
select
  tenant_id,
  slug,
  permitido_pelo_plano,
  permitido_manualmente,
  (permitido_pelo_plano or permitido_manualmente) as tela_tem_modulo,
  permitido_manualmente as rls_tem_modulo_atual
from entitlement
where (permitido_pelo_plano or permitido_manualmente)
      is distinct from permitido_manualmente
order by slug;

-- 2) CANDIDATA: aplique APENAS em staging após revisar o resultado acima.
-- Mantém a mesma assinatura e a semântica já usada pela tela.
-- Também fixa search_path da função que a tela já invoca.
begin;

create or replace function public.a1_has_module(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1
    from public.a1_tenants t
    join public.a1_plan_modules pm on pm.plan_key = t.plan_key
    where t.id = public.a1_tenant()
      and pm.module_key = p_module_key
      and t.status in ('trial', 'active')
  )
  or exists (
    select 1
    from public.a1_tenant_modules tm
    where tm.tenant_id = public.a1_tenant()
      and tm.module_key = p_module_key
      and (tm.expires_at is null or tm.expires_at > now())
  );
$$;

create or replace function public.a1_tem_modulo(p_chave text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select public.a1_has_module(p_chave);
$$;

commit;

-- 3) Validação obrigatória após aplicar em staging:
-- - gestor consegue ler/criar pré-análise se o módulo estiver no plano;
-- - corretor com pa_criar consegue criar apenas em sua carteira;
-- - corretor sem pa_criar não consegue criar;
-- - tenant sem plano/liberação manual continua bloqueado.
--
-- Rollback semântico (se necessário; não recomendado sem registrar o motivo):
-- create or replace function public.a1_tem_modulo(p_chave text)
-- returns boolean language sql stable security definer
-- set search_path = public, extensions, pg_temp
-- as $$
--   select exists (
--     select 1 from public.a1_tenant_modules tm
--     where tm.tenant_id = public.a1_tenant()
--       and tm.module_key = p_chave
--       and (tm.expires_at is null or tm.expires_at > now())
--   );
-- $$;
