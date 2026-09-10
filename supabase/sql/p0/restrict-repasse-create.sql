-- SIIMOB | P0 — bloquear criação não autorizada de repasse
-- Estado: PREPARADO, NÃO APLICADO.
-- Execute manualmente no SQL Editor durante a manutenção, após revisar o bloco 1.
--
-- Contexto:
-- A política atual de public.a1_cases isola apenas tenant. Esta política
-- RESTRITIVA é adicional: ela não substitui nem remove a regra existente.
-- Para module_key = 'repasse', exige módulo ativo e a permissão atual
-- criar_repasses. Para os demais módulos, não altera o comportamento.
--
-- O cliente usa sessão customizada no header x-session-token e normalmente
-- chega ao Data API como role anon; por isso a política é TO public.
-- Não troque para TO authenticated sem migrar a autenticação do cliente.

-- 1) PRÉ-VOO — somente leitura. Deve retornar a política de tenant atual
--    e confirmar que ainda não existe uma política P0 com o mesmo nome.
select
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'a1_cases'
order by policyname;

-- 2) APLICAÇÃO — execute uma única vez em produção depois do pré-voo.
begin;

create policy "a1_cases_repasse_create_capability"
on public.a1_cases
as restrictive
for insert
to public
with check (
  coalesce(module_key, '') <> 'repasse'
  or (
    public.a1_has_module('repasse')
    and public.a1_perm('criar_repasses')
  )
);

commit;

-- 3) VERIFICAÇÃO — confirme que permissive=false e cmd=INSERT.
select
  policyname,
  permissive,
  roles,
  cmd,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'a1_cases'
  and policyname = 'a1_cases_repasse_create_capability';

-- 4) TESTE FUNCIONAL OBRIGATÓRIO NO NAVEGADOR
--    a) Corretor sem criar_repasses: POST de repasse deve falhar.
--    b) Corretor com criar_repasses: POST de repasse deve funcionar.
--    c) Gestor autorizado: POST de repasse deve funcionar.
--    d) Tenant sem módulo Repasse: POST de repasse deve falhar.
--
-- Se qualquer cenário autorizado falhar, pare e execute o rollback abaixo.

-- ROLLBACK:
-- drop policy if exists "a1_cases_repasse_create_capability" on public.a1_cases;
