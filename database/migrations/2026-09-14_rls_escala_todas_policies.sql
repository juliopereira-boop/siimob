-- ══════════════════════════════════════════════════════════════════════════════
-- RLS pronta para escala — a identidade resolvida UMA VEZ, em toda policy
-- ══════════════════════════════════════════════════════════════════════════════
--
-- CONTINUAÇÃO DE 2026-09-14_rls_a1_cases_por_linha.sql
-- Naquele arquivo, a1_cases saiu de 1002 ms para 9,4 ms. A causa era a mesma que
-- este arquivo agora elimina do banco inteiro: função de identidade chamada
-- dentro do `Filter:` de uma policy é REAVALIADA A CADA LINHA. STABLE autoriza o
-- planejador a reusar o resultado; não o obriga. Envolver a chamada em
-- `(select ...)` a transforma num InitPlan — avaliado uma vez, reusado como
-- parâmetro.
--
-- Aquele arquivo consertou UMA tabela, porque era a única com volume hoje. Este
-- conserta as outras ~60 policies ANTES de elas terem volume, que é o pedido do
-- dono: o sistema vai crescer e não pode quebrar em 40 mil processos.
--
-- POR QUE UM LAÇO, E NÃO 60 POLICIES ESCRITAS À MÃO
-- Reescrever 60 policies à mão são 60 chances de trocar um OR por um AND e abrir
-- um vazamento que ninguém percebe. Aqui a definição VIGENTE de cada policy é
-- lida do catálogo, transformada por substituição de texto com padrões fixos e
-- regravada. Nenhuma condição é redigitada. Muda a forma da chamada; a lógica é
-- a que já estava lá.
--
-- O QUE É ENVOLVIDO, E O QUE NÃO É
-- Envolvidas: funções SEM argumento (a1_tenant, a1_ator, a1_e_gestor, a1_papel,
-- a1_tipo_ator, a1_empresa_ator, a1_case_visao_completa, a1_ator_so_ve_o_seu,
-- a1_current_role, a1_current_user_id) e as de argumento CONSTANTE
-- (a1_perm('x'), a1_tem_modulo('X'), a1_has_module('x')). Todas dependem apenas
-- da sessão: o resultado é o mesmo na primeira e na milésima linha.
--
-- NÃO envolvidas: a1_pa_visivel(...) e a1_co_visivel(...), que recebem COLUNAS
-- da linha como argumento. Envolvê-las não as tornaria InitPlan — continuariam
-- correlacionadas — e só acrescentaria ruído ao plano. Elas são tratadas na fase
-- seguinte, dentro do corpo das próprias funções.
--
-- SEGURO DE RODAR DUAS VEZES: antes de envolver, o laço DESFAZ o envolvimento
-- existente (`( SELECT f() AS f)` volta a `f()`). Rodar de novo dá o mesmo
-- resultado, e nada é envolvido em dobro.
begin;

do $migra$
declare
  r record;
  v_qual       text;
  v_check      text;
  v_sql        text;
  v_fn         text;
  v_mudou      int := 0;
  -- Sem argumento: o parêntese vazio faz o padrão ser inequívoco.
  v_sem_arg text[] := array['a1_tenant','a1_ator','a1_papel','a1_e_gestor','a1_tipo_ator',
                            'a1_empresa_ator','a1_case_visao_completa','a1_ator_so_ve_o_seu',
                            'a1_current_role','a1_current_user_id'];
  -- Argumento constante: o padrão casa só literal entre aspas simples, nunca
  -- coluna. a1_pa_visivel e a1_co_visivel ficam de fora justamente por isso.
  v_com_const text[] := array['a1_perm','a1_tem_modulo','a1_has_module'];
begin
  for r in
    select schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
          '(a1_tenant|a1_ator|a1_papel|a1_e_gestor|a1_tipo_ator|a1_empresa_ator|a1_case_visao_completa|a1_ator_so_ve_o_seu|a1_current_role|a1_current_user_id|a1_perm|a1_tem_modulo|a1_has_module)\('
    order by tablename, policyname
  loop
    v_qual  := r.qual;
    v_check := r.with_check;

    -- ── 1. Desfaz o que já está envolvido, para não envolver duas vezes ──
    foreach v_fn in array (v_sem_arg || v_com_const) loop
      v_qual  := regexp_replace(v_qual,  '\( SELECT ' || v_fn || '\(([^()]*)\) AS \w+\)', v_fn || '(\1)', 'g');
      v_check := regexp_replace(v_check, '\( SELECT ' || v_fn || '\(([^()]*)\) AS \w+\)', v_fn || '(\1)', 'g');
    end loop;

    -- ── 2. Envolve tudo de novo, de forma uniforme ──
    foreach v_fn in array v_sem_arg loop
      v_qual  := replace(v_qual,  v_fn || '()', '(select ' || v_fn || '())');
      v_check := replace(v_check, v_fn || '()', '(select ' || v_fn || '())');
    end loop;
    foreach v_fn in array v_com_const loop
      -- Só literal: '...'::text, sem parêntese dentro. Coluna nunca casa.
      v_qual  := regexp_replace(v_qual,  v_fn || '\((''[^'']*''(::text)?)\)', '(select ' || v_fn || '(\1))', 'g');
      v_check := regexp_replace(v_check, v_fn || '\((''[^'']*''(::text)?)\)', '(select ' || v_fn || '(\1))', 'g');
    end loop;

    if v_qual is not distinct from r.qual
       and v_check is not distinct from r.with_check then
      continue;   -- já estava na forma certa
    end if;

    -- ── 3. Regrava a policy com a MESMA lógica, só que hasteada ──
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);

    v_sql := format('create policy %I on %I.%I as %s for %s to %s',
                    r.policyname, r.schemaname, r.tablename,
                    case when r.permissive = 'RESTRICTIVE' then 'restrictive' else 'permissive' end,
                    lower(r.cmd),
                    (select string_agg(quote_ident(x), ', ') from unnest(r.roles) x));
    if v_qual  is not null then v_sql := v_sql || ' using (' || v_qual || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;

    v_mudou := v_mudou + 1;
    raise notice 'policy hasteada: %.% (%)', r.tablename, r.policyname, r.cmd;
  end loop;

  raise notice '% policy(s) reescritas', v_mudou;
end
$migra$;

commit;

-- ── CONFERÊNCIA ──────────────────────────────────────────────────────────────
-- Tem de devolver ZERO. Qualquer linha aqui é uma policy que voltou a chamar a
-- identidade por linha — e com ela volta a lentidão.
--
-- with defs as (
--   select tablename, policyname, coalesce(qual,'')||' '||coalesce(with_check,'') as corpo
--   from pg_policies where schemaname='public'
-- )
-- select tablename, policyname,
--   (select count(*) from regexp_matches(corpo, 'a1_(tenant|ator|papel|e_gestor|tipo_ator|empresa_ator|case_visao_completa|ator_so_ve_o_seu|current_role|current_user_id|perm|tem_modulo|has_module)\(', 'g'))
--   - (select count(*) from regexp_matches(corpo, '\( SELECT a1_(tenant|ator|papel|e_gestor|tipo_ator|empresa_ator|case_visao_completa|ator_so_ve_o_seu|current_role|current_user_id|perm|tem_modulo|has_module)\(', 'g')) as por_linha
-- from defs
-- where corpo ~ 'a1_(tenant|ator|papel|e_gestor|tipo_ator|empresa_ator|case_visao_completa|ator_so_ve_o_seu|current_role|current_user_id|perm|tem_modulo|has_module)\('
-- order by por_linha desc;
