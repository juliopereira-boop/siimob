-- Segurança: bloqueia explicitamente acesso direto às tabelas internas
-- que já estavam inacessíveis por RLS sem policy. Funções SECURITY DEFINER
-- continuam sendo o único caminho previsto.
create policy a1_acessos_deny_direct
on public.a1_acessos as restrictive for all to anon, authenticated
using (false) with check (false);

create policy a1_checklist_conclusoes_deny_direct
on public.a1_checklist_conclusoes as restrictive for all to anon, authenticated
using (false) with check (false);

create policy a1_indicacoes_deny_direct
on public.a1_indicacoes as restrictive for all to anon, authenticated
using (false) with check (false);

create policy a1_indicadores_deny_direct
on public.a1_indicadores as restrictive for all to anon, authenticated
using (false) with check (false);

-- a1_leads não é usada pelo aplicativo nem por RPCs; a policy anterior aceitava
-- INSERT sem sessão e sem validação, permitindo spam no endpoint REST público.
drop policy if exists leads_public_insert on public.a1_leads;
revoke insert on public.a1_leads from anon, authenticated;