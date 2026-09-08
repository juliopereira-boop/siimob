-- =============================================================================
-- CONFERÊNCIA DA INSTALAÇÃO — só leitura, não muda nada
--
-- Cole no SQL Editor do Supabase e rode. Cada linha devolve "ok" ou "PROBLEMA",
-- com o que fazer quando estiver errado. Rodar de novo não faz mal nenhum.
--
-- A linha mais importante é a do LOGIN. As travas de sessão tiraram a escrita
-- direta em a1_sessions do navegador; quem cria e apaga sessão passou a ser
-- só a1_login/a1_partner_login/a1_logout/a1_touch_session. Se alguma dessas
-- NÃO for SECURITY DEFINER, ninguém entra no sistema — e é a primeira coisa
-- que se confere depois de mexer em RLS de tabela de sessão.
-- =============================================================================

with checagens as (

  -- ─── 1. As funções de identidade ───────────────────────────────────────────
  select 1 as ord, 'Funções de identidade' as item,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in
        ('a1_sessao','a1_ator','a1_usuario','a1_papel','a1_e_gestor','a1_tipo_ator',
         'a1_perm','a1_empresa_ator','a1_tem_modulo','a1_no_orquestrador'))::text as achado,
    '10' as esperado,
    'rode sql/2026-09-04_identidade.sql' as se_faltar

  -- ─── 2. As tabelas dos módulos novos ───────────────────────────────────────
  union all select 2, 'Tabelas dos módulos novos',
    (select count(*) from pg_tables where schemaname = 'public' and tablename in
      ('a1_pa_pessoas','a1_pa_situacoes','a1_pa_transicoes','a1_pre_analises',
       'a1_pa_participantes','a1_pa_analises_credito','a1_pa_documentos','a1_pa_eventos',
       'a1_co_situacoes','a1_co_transicoes','a1_comerciais','a1_co_contratos',
       'a1_co_eventos','a1_integra_eventos'))::text,
    '14', 'rode 2026-09-04_pre_analise.sql e 2026-09-04_comercial.sql'

  -- ─── 3. RLS ligada em todas elas ───────────────────────────────────────────
  -- Uma tabela nova sem RLS é uma tabela aberta: o PostgREST entrega tudo.
  union all select 3, 'RLS ligada nas tabelas novas',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relrowsecurity
        and c.relname in ('a1_pa_pessoas','a1_pa_situacoes','a1_pa_transicoes',
          'a1_pre_analises','a1_pa_participantes','a1_pa_analises_credito',
          'a1_pa_documentos','a1_pa_eventos','a1_co_situacoes','a1_co_transicoes',
          'a1_comerciais','a1_co_contratos','a1_co_eventos','a1_integra_eventos'))::text,
    '14', 'alguma tabela ficou sem RLS — rode os arquivos de novo'

  -- ─── 4. O orquestrador ─────────────────────────────────────────────────────
  union all select 4, 'Funções de transição e ação',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in
        ('a1_pa_transicionar','a1_co_transicionar','a1_pa_executar_acao',
         'a1_co_executar_acao','a1_criar_comercial','a1_criar_repasse_do_comercial'))::text,
    '6', 'rode sql/2026-09-04_gatilhos.sql'

  -- ─── 5. O navegador não cria Comercial na mão ──────────────────────────────
  -- a1_criar_comercial tem privilégio de dono. Se anon puder executá-la, dá
  -- para pular a aprovação de crédito chamando a função direto.
  union all select 5, 'anon NÃO executa a criação direta',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in
        ('a1_criar_comercial','a1_criar_repasse_do_comercial')
        and has_function_privilege('anon', p.oid, 'EXECUTE'))::text,
    '0', 'rode de novo o fim de 2026-09-04_gatilhos.sql (os REVOKE)'

  -- ─── 6. Os módulos existem no catálogo ─────────────────────────────────────
  union all select 6, 'Módulos no catálogo',
    (select count(*) from a1_modules where key in ('PRE_ANALISE','COMERCIAL'))::text,
    '2', 'rode sql/2026-09-04_modulos_catalogo.sql'

  -- ─── 7. E não estão liberados para ninguém ─────────────────────────────────
  -- Esperado ZERO enquanto você não liberar no superadmin. Se vier diferente
  -- de zero, algum cliente já está com o módulo ligado — confira se foi você.
  union all select 7, 'Clientes com os módulos liberados',
    (select count(*) from a1_tenant_modules where module_key in ('PRE_ANALISE','COMERCIAL'))::text,
    '0 (até você liberar)', 'só você libera, no painel do superadmin'

  -- ─── 8. A sessão é de quem a está usando ───────────────────────────────────
  union all select 8, 'Política de sessão restrita à própria linha',
    (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'a1_sessions'
        and policyname = 'a1_sessions_propria')::text,
    '1', 'rode sql/2026-09-06_travas_sessao_e_parceiro.sql'

  -- ─── 9. E o navegador não escreve nela ─────────────────────────────────────
  -- Este era o furo: com UPDATE liberado, um corretor virava owner num PATCH.
  union all select 9, 'anon NÃO escreve em a1_sessions',
    (select count(*) from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'a1_sessions'
        and grantee in ('anon','authenticated')
        and privilege_type in ('INSERT','UPDATE','DELETE'))::text,
    '0', 'rode sql/2026-09-06_travas_sessao_e_parceiro.sql'

  -- ─── 10. Ninguém assina o próprio crachá ───────────────────────────────────
  union all select 10, 'Trava de permissão do parceiro',
    (select count(*) from pg_trigger
      where tgname = 'trg_a1_partners_poder' and not tgisinternal)::text,
    '1', 'rode sql/2026-09-06_travas_sessao_e_parceiro.sql'

  -- ─── 11. O LOGIN CONTINUA FUNCIONANDO ──────────────────────────────────────
  -- A conferência que mais importa depois de mexer em RLS de sessão. Estas
  -- funções precisam ser SECURITY DEFINER: é o privilégio próprio delas que
  -- deixa criar e apagar sessão agora que o navegador não escreve mais na
  -- tabela. Se aqui não vier 4, NINGUÉM ENTRA — e o rollback é uma linha:
  --   drop policy a1_sessions_propria on a1_sessions;
  --   grant insert, update, delete on a1_sessions to anon;
  union all select 11, '>>> LOGIN: funções com privilégio próprio',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.proname in ('a1_login','a1_partner_login','a1_logout','a1_touch_session'))::text,
    '4', 'NÃO É PARA DAR OUTRO NÚMERO — veja o rollback no comentário acima'
)
select
  ord as "#",
  item,
  achado as "encontrado",
  esperado,
  case when achado = split_part(esperado, ' ', 1) then 'ok' else 'PROBLEMA' end as situacao,
  case when achado = split_part(esperado, ' ', 1) then '' else se_faltar end as o_que_fazer
from checagens
order by ord;
