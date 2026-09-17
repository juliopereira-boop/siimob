-- ══════════════════════════════════════════════════════════════════════════════
-- a1_resumo_geral() — a tela inicial em UMA consulta
-- ══════════════════════════════════════════════════════════════════════════════
--
-- POR QUE ESTE ARQUIVO EXISTE
-- A tela Geral mostra, de todos os módulos licenciados, quantos processos há em
-- cada etapa. Feito pelo navegador, isso seria uma consulta por etapa — umas
-- trinta — ou, pior, baixar a coleção inteira e contar em JavaScript. Com 235
-- processos as duas coisas funcionam. Com 40 mil, a segunda trava o navegador e
-- a primeira trava a rede, e o dono abre a tela inicial do sistema e vê uma
-- ampulheta.
--
-- Aqui a contagem é feita onde os dados estão. O navegador faz UMA chamada e
-- recebe alguns quilobytes de números, não linhas. O custo no banco não cresce
-- com o que aparece na tela — cresce com o índice, que é o que a gente sabe
-- fazer crescer.
--
-- SEGURANÇA: ESTA FUNÇÃO NÃO É security definer, DE PROPÓSITO.
-- Definer aqui seria um buraco: a função passaria por cima do RLS e contaria o
-- cliente inteiro para quem só pode ver a própria carteira. Sendo invoker, cada
-- select aqui dentro passa pelas MESMAS políticas da tela — o corretor conta os
-- processos dele, o gestor conta os do cliente, e ninguém conta os de outro
-- cliente. Se um dia alguém trocar para definer "para ficar mais rápido", terá
-- trocado um número certo por um número vazado.
--
-- O QUE ESTE ARQUIVO NÃO MUDA
-- Nenhuma tabela, nenhuma política, nenhum dado. Só acrescenta uma função de
-- leitura. Rodar de novo é seguro.
begin;

create or replace function public.a1_resumo_geral()
returns jsonb
language sql
stable
set search_path to 'public','extensions','pg_temp'
as $$
  with
  -- Os módulos de processo genérico (Leads, Repasse, Registro) moram todos em
  -- a1_cases, separados por module_key. Um group by resolve os três de uma vez.
  casos as (
    select c.module_key, c.stage_id, count(*)::int as n
      from a1_cases c
     where c.archived is not true
     group by 1, 2
  ),
  etapas as (
    select s.module_key, s.id, s.name, s.color, s.position, s.is_final
      from a1_stages s
  ),
  -- Pré-análise e Venda têm tabela e esteira próprias.
  pa as (
    select p.situacao_id, count(*)::int as n from a1_pre_analises p group by 1
  ),
  pa_sit as (
    select s.id, s.nome, s.cor, s.ordem, s.selo from a1_pa_situacoes s where s.ativo
  ),
  co as (
    select c.situacao_id, count(*)::int as n from a1_comerciais c group by 1
  ),
  co_sit as (
    select s.id, s.nome, s.cor, s.ordem, s.selo from a1_co_situacoes s where s.ativo
  )
  select jsonb_build_object(
    'em', now(),

    -- Um objeto por module_key de a1_cases. A tela pergunta só pelos que tem
    -- licença; devolver todos aqui é barato e evita uma segunda chamada quando
    -- o cliente liga um módulo novo.
    'casos', coalesce((
      select jsonb_object_agg(mk, dados) from (
        select e.module_key as mk,
               jsonb_build_object(
                 'total',  coalesce(sum(c.n), 0),
                 'aberto', coalesce(sum(c.n) filter (where not coalesce(e.is_final, false)), 0),
                 'etapas', jsonb_agg(jsonb_build_object(
                     'id', e.id, 'nome', e.name, 'cor', e.color,
                     'fim', coalesce(e.is_final, false), 'n', coalesce(c.n, 0))
                   order by e.position, e.name)
               ) as dados
          from etapas e
          left join casos c on c.module_key = e.module_key and c.stage_id = e.id
         group by e.module_key
      ) t
    ), '{}'::jsonb),

    'pre_analise', jsonb_build_object(
      'total',  coalesce((select sum(n) from pa), 0),
      'aberto', coalesce((select sum(p.n) from pa p join pa_sit s on s.id = p.situacao_id
                           where s.selo is null or s.selo = 'INICIO'), 0),
      'etapas', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', s.id, 'nome', s.nome, 'cor', s.cor,
                   'fim', s.selo in ('FIM_POSITIVO','FIM_NEGATIVO'),
                   'n', coalesce(p.n, 0)) order by s.ordem, s.nome)
                 from pa_sit s left join pa p on p.situacao_id = s.id), '[]'::jsonb)
    ),

    'venda', jsonb_build_object(
      'total',  coalesce((select sum(n) from co), 0),
      'aberto', coalesce((select sum(c.n) from co c join co_sit s on s.id = c.situacao_id
                           where s.selo is null or s.selo = 'INICIO'), 0),
      'etapas', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', s.id, 'nome', s.nome, 'cor', s.cor,
                   'fim', s.selo in ('VENDIDO','FIM_NEGATIVO'),
                   'n', coalesce(c.n, 0)) order by s.ordem, s.nome)
                 from co_sit s left join co c on c.situacao_id = s.id), '[]'::jsonb)
    )
  );
$$;

revoke all on function public.a1_resumo_geral() from public;
grant execute on function public.a1_resumo_geral() to anon, authenticated;

-- ── O índice que sustenta a contagem ────────────────────────────────────────
-- O group by acima varre a1_cases por (module_key, stage_id). Sem índice isso é
-- varredura completa, e a varredura completa é exatamente o que dá 500 depois
-- de 40 mil linhas. Com o índice, o planejador usa só ele e nem toca na tabela.
-- `if not exists` + `concurrently` fora de transação seria melhor, mas aqui o
-- arquivo roda inteiro numa transação — e a tabela de hoje é pequena o
-- bastante para o lock não ser sentido.
create index if not exists a1_cases_resumo_idx
  on a1_cases (tenant_id, module_key, stage_id)
  where archived is not true;

create index if not exists a1_pre_analises_resumo_idx on a1_pre_analises (tenant_id, situacao_id);
create index if not exists a1_comerciais_resumo_idx   on a1_comerciais   (tenant_id, situacao_id);

commit;

-- ── CONFERÊNCIA ──────────────────────────────────────────────────────────────
-- 1. Como gestor, o resumo tem de bater com o que a tela do módulo mostra:
--    select jsonb_pretty(a1_resumo_geral());
--
-- 2. Como corretor (sessão de parceiro), os números têm de ser MENORES — ele
--    conta só a carteira dele. Se derem iguais aos do gestor, a função virou
--    definer em algum momento e está vazando.
--
-- 3. O plano tem de usar o índice, não varredura:
--    explain (analyze, buffers)
--    select module_key, stage_id, count(*) from a1_cases
--     where archived is not true group by 1,2;
