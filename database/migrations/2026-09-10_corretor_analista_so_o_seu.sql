-- =============================================================================
-- CORRETOR E ANALISTA VEEM APENAS O QUE É DELES
--
-- POR QUE ESTE ARQUIVO EXISTE
-- Regra do dono, dita depois de ver um corretor recém-criado enxergando a
-- carteira inteira: corretor e analista enxergam APENAS o que está vinculado a
-- eles, em todo o sistema. Não é preferência de cadastro — é regra do produto.
--
-- Até aqui a visão ampla vinha de uma marca (`ver_todos_analistas`), e essa
-- marca podia chegar por três caminhos: o cadastro da pessoa, um perfil de
-- acesso, ou a omissão valendo como "sim" no Repasse. A tela deixou de oferecer
-- o interruptor para estes dois tipos, mas tela não protege: quem estava com a
-- marca gravada continuaria enxergando tudo. Quem fecha é este arquivo.
--
-- O QUE MUDA, EM UMA FRASE
-- Para quem é `corretor` ou `analista`, nem 'gerente' nem 'ver_todos_analistas'
-- abrem a carteira. Sobra o vínculo: o processo em que a pessoa é a responsável.
--
-- QUEM NÃO MUDA
--   · Gestor e proprietário: continuam vendo tudo.
--   · Coordenador: existe justamente para acompanhar a equipe, e a marca
--     continua valendo para ele.
--   · Correspondente (cca): continua vendo o da própria empresa e o que os
--     colegas compartilharam.
--
-- ISTO TIRA ACESSO DE GENTE QUE TRABALHA HOJE — de propósito, e é o pedido.
-- Antes de rodar, veja exatamente quem é afetado com a consulta do fim do
-- arquivo. Em produção, hoje, são os analistas com a marca ligada.
--
-- COMO VOLTAR ATRÁS: rode de novo sql/2026-09-08_perfis_de_acesso.sql (que traz
-- a1_pa_visivel e a1_co_visivel na versão anterior) e a parte 1 de
-- sql/2026-09-09_visibilidade_repasse_1_conferir.sql.
-- =============================================================================

-- ─── A regra, num lugar só ───────────────────────────────────────────────────
-- Uma função para as três: se a mesma pergunta fosse respondida em três lugares,
-- mudar a regra passaria a ser lembrar de três lugares.
create or replace function a1_ator_so_ve_o_seu()
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select coalesce(a1_tipo_ator() in ('corretor','analista'), false);
$$;
grant execute on function a1_ator_so_ve_o_seu() to anon, authenticated;

-- ─── Pré-análise ─────────────────────────────────────────────────────────────
create or replace function a1_pa_visivel(p_corretor uuid, p_empresa uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    -- Gestor e gerente enxergam a carteira inteira do próprio cliente.
    when a1_e_gestor() then true
    -- Corretor e analista param aqui: para eles não existe visão ampla, venha
    -- ela do cadastro, de um perfil ou de um 'gerente' marcado por engano. É a
    -- regra do dono, e ela ganha de qualquer marca.
    when a1_ator_so_ve_o_seu() then (p_corretor is not null and p_corretor = a1_ator())
    when a1_perm('gerente') then true
    -- Visão completa marcada no cadastro — é como o coordenador enxerga a
    -- equipe. Ausente é "não vê": módulo novo não herda padrão aberto.
    when a1_perm('ver_todos_analistas') then true
    -- Correspondente enxerga o da própria empresa.
    when a1_tipo_ator() = 'cca' and p_empresa is not null
         and p_empresa = a1_empresa_ator() then true
    -- Os demais enxergam o que é deles.
    when p_corretor is not null and p_corretor = a1_ator() then true
    else false
  end;
$$;

-- ─── Comercial ───────────────────────────────────────────────────────────────
create or replace function a1_co_visivel(p_corretor uuid, p_empresa uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when a1_e_gestor() then true
    when a1_ator_so_ve_o_seu() then (p_corretor is not null and p_corretor = a1_ator())
    when a1_perm('gerente') then true
    when a1_perm('ver_todos_analistas') then true   -- visão completa (coordenador)
    when a1_tipo_ator() = 'cca' and p_empresa is not null
         and p_empresa = a1_empresa_ator() then true
    when p_corretor is not null and p_corretor = a1_ator() then true
    else false
  end;
$$;

-- ─── Repasse ─────────────────────────────────────────────────────────────────
-- Aqui a visão ampla é decidida por a1_case_visao_completa, criada na parte 1 de
-- sql/2026-09-09_visibilidade_repasse_1_conferir.sql. Ela passa a devolver
-- "não" para corretor e analista, ponto — inclusive no caso da OMISSÃO, que era
-- o padrão antigo do Repasse e é o que mantém 36 corretores enxergando tudo
-- hoje. Para os outros tipos a compatibilidade continua de pé.
create or replace function a1_case_visao_completa()
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when a1_e_gestor() then true
    when a1_ator_so_ve_o_seu() then false
    when a1_perm('gerente') then true
    else coalesce((
      select case
        when coalesce(pf.permissions, p.permissions) ? 'ver_todos_analistas'
          then (coalesce(pf.permissions, p.permissions)->>'ver_todos_analistas') = 'true'
        else p.perfil_id is null      -- sem perfil: ausente = vê tudo (como a tela)
      end
      from a1_partners p
      left join a1_perfis pf on pf.id = p.perfil_id and pf.ativo
      where p.id = a1_ator()
    ), false)
  end;
$$;

-- =============================================================================
-- COMO CONFERIR
--
-- 1. QUEM PERDE VISÃO AMPLA COM ESTA MUDANÇA. Rode ANTES, e é a lista para
--    conversar com o cliente — são pessoas que hoje enxergam a carteira inteira
--    e passarão a enxergar só o que está no nome delas:
--
--    select t.name as cliente, p.name as pessoa, p.type,
--           case when (p.permissions->>'gerente') = 'true' then 'estava como gerente'
--                else 'tinha visao completa marcada' end as motivo
--      from a1_partners p
--      join a1_tenants t on t.id = p.tenant_id
--      left join a1_perfis pf on pf.id = p.perfil_id and pf.ativo
--     where p.type in ('corretor','analista')
--       and p.is_active
--       and ( (p.permissions->>'gerente') = 'true'
--          or (coalesce(pf.permissions, p.permissions)->>'ver_todos_analistas') = 'true' )
--     order by t.name, p.type, p.name;
--
-- 2. QUANTOS PROCESSOS CADA UM PASSA A VER. Zero para quem trabalha hoje é o
--    sinal de que o processo está gravado com outro nome — corrija o cadastro do
--    processo, não a regra:
--
--    select p.name, p.type,
--           (select count(*) from a1_cases c
--             where c.tenant_id = p.tenant_id
--               and (btrim(lower(coalesce(c.broker_name,'')))  = btrim(lower(p.name))
--                 or btrim(lower(coalesce(c.manager_name,''))) = btrim(lower(p.name))))
--             as ve_por_vinculo
--      from a1_partners p
--     where p.type in ('corretor','analista') and p.is_active
--     order by ve_por_vinculo, p.name;
--
-- 3. A regra em si:
--
--    select a1_ator_so_ve_o_seu();   -- na sessão de um corretor: true
-- =============================================================================
