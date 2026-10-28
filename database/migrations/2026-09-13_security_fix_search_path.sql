-- Segurança: elimina search_path mutável de funções SECURITY DEFINER
-- legadas. Isto não altera a lógica nem a autorização; impede que objetos
-- de outro schema sejam resolvidos por acidente ou por manipulação de caminho.
begin;

alter function public.a1_ativos(uuid, uuid) set search_path = public, extensions, pg_temp;
alter function public.a1_can_add_user() set search_path = public, extensions, pg_temp;
alter function public.a1_current_role() set search_path = public, extensions, pg_temp;
alter function public.a1_current_user_id() set search_path = public, extensions, pg_temp;
alter function public.a1_has_module(text) set search_path = public, extensions, pg_temp;
alter function public.a1_logout() set search_path = public, extensions, pg_temp;
alter function public.a1_precad_enviar(text, text, text, text, text, text) set search_path = public, extensions, pg_temp;
alter function public.a1_precad_info(text) set search_path = public, extensions, pg_temp;
alter function public.a1_public_tenant_info(text) set search_path = public, extensions, pg_temp;
alter function public.a1_sessao_janela() set search_path = public, extensions, pg_temp;
alter function public.a1_set_updated_at() set search_path = public, extensions, pg_temp;
alter function public.a1_tenant() set search_path = public, extensions, pg_temp;
alter function public.a1_touch_session() set search_path = public, extensions, pg_temp;

commit;