-- =============================================================================
-- QUEM RECEBE A ATRIBUIÇÃO PRECISA ENXERGAR — parte 1 de 2: A CONFERÊNCIA
--
-- POR QUE ESTE ARQUIVO EXISTE
--
-- a1_pa_visivel(corretor, empresa) responde "este processo é seu?" olhando uma
-- coluna só: corretor_id. Para o analista, a resposta de hoje é:
--
--     when a1_ator_so_ve_o_seu() then (p_corretor is not null and p_corretor = a1_ator())
--
-- Ou seja: o analista só enxerga o que estiver gravado em corretor_id — coluna
-- que nunca vai ter o id dele. No minuto em que o Roteamento de Analistas
-- atribuir uma pré-análise gravando analista_id, o analista a quem ela foi
-- entregue NÃO a enxerga: some da fila dele, o dossiê responde vazio, e mover
-- na esteira devolve 'sem_acesso'. É o buraco que trava o roteamento inteiro, e
-- ele não é da tela — é da função de visibilidade.
--
-- O mesmo vale para correspondente_id, que já existe em a1_pre_analises desde
-- setembro e nunca foi lido por ninguém: o correspondente designado só enxerga
-- o processo se a EMPRESA dele casar, nunca por ter sido designado.
--
-- O QUE ESTE ARQUIVO FAZ
-- Cria a nova função de decisão — com quatro argumentos em vez de dois — e um
-- relatório. NENHUMA política é alterada, nenhuma função do orquestrador é
-- trocada, ninguém ganha nem perde acesso ao rodar isto. A função nova fica
-- criada e sem ninguém chamando, esperando a parte 2.
--
-- Rodar isto em produção é seguro.
--
-- A GARANTIA QUE SUSTENTA AS DUAS PARTES: a regra nova é SUPERCONJUNTO da
-- atual. Ela devolve `true` em todos os casos em que a de hoje devolve, e mais
-- os casos em que a pessoa é a designada. Ninguém perde acesso — nem o
-- corretor, nem o coordenador, nem o correspondente. É por isso que a parte 2
-- pode ser ligada sem lista de pessoas para conferir antes, ao contrário da
-- visibilidade do Repasse (2026-09-09), que TIRAVA acesso e por isso exigia
-- decisão do dono pessoa por pessoa. A consulta 3 do relatório é a prova disso
-- em cima dos dados reais do cliente.
--
-- ORDEM: depois de sql/2026-09-11_partes_por_id.sql (é de lá que vem
-- analista_id; sem ele o relatório não roda e a parte 2 não tem o que ler).
-- Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ─── A decisão, agora com as três colunas de gente ───────────────────────────
--
-- Quatro argumentos, e não dois com `default null`: com default, toda chamada
-- de dois argumentos que já existe no sistema (dezesseis políticas e quatro
-- funções do orquestrador) viraria ambígua e o banco recusaria a consulta
-- inteira. Com duas assinaturas separadas, o que ainda chama com dois
-- argumentos continua funcionando exatamente como antes.
--
-- A ORDEM DOS RAMOS MUDOU, e é isso que resolve o roteamento: "é meu" passou
-- para ANTES de a1_ator_so_ve_o_seu(). Antes, o analista caía naquele ramo e a
-- resposta era decidida só por corretor_id; agora, se o processo carrega o id
-- dele em qualquer das três colunas, a resposta é sim e o ramo nem é
-- alcançado. Para quem NÃO está em coluna nenhuma, a regra continua idêntica —
-- corretor e analista não ganharam visão ampla de nada.
create or replace function a1_pa_visivel(
  p_corretor uuid, p_empresa uuid, p_analista uuid, p_correspondente uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    -- Gestor e proprietário enxergam a carteira inteira do próprio cliente.
    when a1_e_gestor() then true

    -- É MEU: as três colunas de gente valem igual. Quem foi designado enxerga
    -- o que lhe foi designado — é a razão de existir deste arquivo.
    when (p_corretor       is not null and p_corretor       = a1_ator())
      or (p_analista       is not null and p_analista       = a1_ator())
      or (p_correspondente is not null and p_correspondente = a1_ator()) then true

    -- Corretor e analista param aqui: para eles não existe visão ampla, venha
    -- ela do cadastro, de um perfil ou de um 'gerente' marcado por engano.
    -- Regra do dono (sql/2026-09-10_corretor_analista_so_o_seu.sql), e ela
    -- continua ganhando de qualquer marca.
    when a1_ator_so_ve_o_seu() then false

    when a1_perm('gerente') then true
    -- Visão completa marcada no cadastro — é como o coordenador enxerga a
    -- equipe. Ausente é "não vê": módulo novo não herda padrão aberto.
    when a1_perm('ver_todos_analistas') then true

    -- Correspondente enxerga o da própria empresa, mesmo sem ser o designado.
    when a1_tipo_ator() = 'cca' and p_empresa is not null
         and p_empresa = a1_empresa_ator() then true

    else false
  end;
$$;
grant execute on function a1_pa_visivel(uuid, uuid, uuid, uuid) to anon, authenticated;

-- A de dois argumentos continua existindo e passa a DELEGAR. Ela responde
-- exatamente o que respondia antes (sem atribuição, os dois ramos novos não
-- podem casar com nada), e assim a regra fica escrita num lugar só. Se ela
-- ficasse com corpo próprio, mudar a visibilidade passaria a ser lembrar de
-- dois lugares — e o segundo é o que ninguém lembra.
create or replace function a1_pa_visivel(p_corretor uuid, p_empresa uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select a1_pa_visivel(p_corretor, p_empresa, null::uuid, null::uuid);
$$;

-- ─── Comercial: a mesma regra ────────────────────────────────────────────────
create or replace function a1_co_visivel(
  p_corretor uuid, p_empresa uuid, p_analista uuid, p_correspondente uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when a1_e_gestor() then true
    when (p_corretor       is not null and p_corretor       = a1_ator())
      or (p_analista       is not null and p_analista       = a1_ator())
      or (p_correspondente is not null and p_correspondente = a1_ator()) then true
    when a1_ator_so_ve_o_seu() then false
    when a1_perm('gerente') then true
    when a1_perm('ver_todos_analistas') then true   -- visão completa (coordenador)
    when a1_tipo_ator() = 'cca' and p_empresa is not null
         and p_empresa = a1_empresa_ator() then true
    else false
  end;
$$;
grant execute on function a1_co_visivel(uuid, uuid, uuid, uuid) to anon, authenticated;

create or replace function a1_co_visivel(p_corretor uuid, p_empresa uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select a1_co_visivel(p_corretor, p_empresa, null::uuid, null::uuid);
$$;

-- =============================================================================
-- O RELATÓRIO — leia antes de rodar a parte 2
--
-- 1. QUANTA ATRIBUIÇÃO JÁ EXISTE. Enquanto for tudo zero, a parte 2 não muda o
--    que ninguém vê: não há processo designado a ninguém para passar a
--    aparecer. É o estado esperado hoje, porque a coluna acabou de nascer.
--
--    select 'pré-análise' as modulo,
--           count(*) as total,
--           count(analista_id) as com_analista,
--           count(correspondente_id) as com_correspondente
--      from a1_pre_analises
--    union all
--    select 'comercial', count(*), count(analista_id), count(correspondente_id)
--      from a1_comerciais;
--
-- 2. QUEM PASSA A ENXERGAR O QUÊ. Roda a decisão de fora da sessão da pessoa,
--    então serve como simulação do depois:
--
--    select p.name as pessoa, p.type,
--           count(*) filter (where pa.corretor_id = p.id) as ja_via_por_corretor,
--           count(*) filter (where pa.analista_id = p.id
--                              and pa.corretor_id is distinct from p.id) as passa_a_ver_por_analista,
--           count(*) filter (where pa.correspondente_id = p.id
--                              and pa.corretor_id is distinct from p.id) as passa_a_ver_por_correspondente
--      from a1_partners p
--      join a1_pre_analises pa on pa.tenant_id = p.tenant_id
--     where p.is_active
--     group by p.name, p.type
--    having count(*) filter (where pa.analista_id = p.id or pa.correspondente_id = p.id) > 0
--     order by p.name;
--
-- 3. NINGUÉM PERDE NADA — a consulta que prova, e ela precisa de uma SESSÃO
--    para valer: as duas funções respondem sobre quem está perguntando. Entre
--    com o token de uma pessoa (o mesmo x-session-token que o navegador manda)
--    e compare as duas assinaturas em todo processo SEM atribuição. Onde não há
--    designado, a regra nova tem de responder exatamente o que a atual responde:
--
--    select set_config('request.headers',
--                      '{"x-session-token":"COLE-AQUI-O-TOKEN"}', false);
--
--    select count(*) as divergencias
--      from a1_pre_analises pa
--     where pa.analista_id is null and pa.correspondente_id is null
--       and a1_pa_visivel(pa.corretor_id, pa.empresa_id)
--           is distinct from
--           a1_pa_visivel(pa.corretor_id, pa.empresa_id,
--                         pa.analista_id, pa.correspondente_id);
--
--    Esperado: 0. Qualquer número diferente de zero significa que a regra nova
--    mudou o que já estava decidido — PARE e não rode a parte 2.
--
-- 4. ATRIBUIÇÃO PARA GENTE DE OUTRO CLIENTE seria um processo que ninguém do
--    dono enxerga e que uma pessoa de fora enxergaria se o tenant não filtrasse
--    antes. O tenant filtra (toda política começa por tenant_id = a1_tenant()),
--    mas dado mentindo é dado que um dia vira regra. Esperado: vazio.
--
--    select pa.id, pa.codigo, 'analista' as coluna, pa.analista_id as valor
--      from a1_pre_analises pa join a1_partners p on p.id = pa.analista_id
--     where p.tenant_id <> pa.tenant_id
--    union all
--    select pa.id, pa.codigo, 'correspondente', pa.correspondente_id
--      from a1_pre_analises pa join a1_partners p on p.id = pa.correspondente_id
--     where p.tenant_id <> pa.tenant_id;
--
-- 5. A função nova existe nas duas assinaturas, e a antiga continua de pé:
--
--    select p.proname, pg_get_function_identity_arguments(p.oid)
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname in ('a1_pa_visivel','a1_co_visivel')
--     order by 1, 2;
--
--    Esperado: quatro linhas — cada uma com (uuid, uuid) e (uuid, uuid, uuid, uuid).
-- =============================================================================
