-- Migra a antiga permissão global de dashboard para as permissões
-- específicas. Preserva os acessos atuais; daqui em diante cada uma pode ser
-- administrada separadamente na criação de perfil ou de usuário.
begin;

update public.a1_partners
set permissions =
  (coalesce(permissions, '{}'::jsonb) - 'ver_dashboard')
  || jsonb_build_object(
    'ver_dashboard_lead', true,
    'ver_dashboard_pre_analise', true,
    'ver_dashboard_venda', true,
    'ver_dashboard_repasse', true,
    'ver_dashboard_registro', true
  )
where coalesce(permissions->>'ver_dashboard', 'false') in ('true','t','1');

update public.a1_perfis
set permissions =
  (coalesce(permissions, '{}'::jsonb) - 'ver_dashboard')
  || jsonb_build_object(
    'ver_dashboard_lead', true,
    'ver_dashboard_pre_analise', true,
    'ver_dashboard_venda', true,
    'ver_dashboard_repasse', true,
    'ver_dashboard_registro', true
  )
where coalesce(permissions->>'ver_dashboard', 'false') in ('true','t','1');

commit;