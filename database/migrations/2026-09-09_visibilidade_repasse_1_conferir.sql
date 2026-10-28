-- =============================================================================
-- VISIBILIDADE NO REPASSE — parte 1 de 2: A CONFERÊNCIA
--
-- POR QUE ESTE ARQUIVO EXISTE
-- a1_cases tem UMA política, e ela isola só por cliente:
--
--     cases_tenant_isolation ... using (tenant_id = a1_tenant())
--
-- Quem decide se aquele processo é seu é a TELA. Isso significa que qualquer
-- pessoa do cliente que peça direto na API recebe a carteira inteira dele —
-- inclusive o corretor que a tela mostra vazia. A Pré-análise e o Comercial não
-- têm esse buraco: lá a regra mora em a1_pa_visivel / a1_co_visivel, dentro da
-- política.
--
-- O QUE ESTE ARQUIVO FAZ
-- NADA além de criar a função de decisão e um relatório. Nenhuma política é
-- criada, nenhuma linha muda de dono, ninguém perde nem ganha acesso. Rodar
-- isto em produção é seguro.
--
-- O QUE ELE NÃO PODE DECIDIR SOZINHO
-- A tela trata a AUSÊNCIA de `ver_todos_analistas` como "vê tudo". Foi feito
-- assim para não tirar acesso de quem já estava cadastrado antes desse modelo —
-- e hoje a maioria dos corretores está exatamente nessa situação. Ligar a
-- política sem olhar isto antes tiraria a carteira de gente que trabalha hoje.
--
-- Por isso a ordem é: rode este arquivo, leia o relatório do fim, decida quem
-- deve mesmo enxergar tudo, e só então rode a parte 2.
-- =============================================================================

-- ─── Quem é o ator, pelo nome ────────────────────────────────────────────────
-- No Repasse o dono do processo é gravado como TEXTO (broker_name,
-- manager_name, payload.usuario_correspondente) — não há id. A comparação por
-- nome é o que a tela sempre fez; a política não pode inventar outro critério,
-- ou passaria a esconder processo que a tela mostra.
create or replace function a1_nome_ator()
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select btrim(lower(p.name)) from a1_partners p where p.id = a1_ator();
$$;
grant execute on function a1_nome_ator() to anon, authenticated;

-- ─── A pessoa tem visão completa da carteira? ────────────────────────────────
--
-- Espelha temVisaoCompleta() da tela, inclusive na parte incômoda: para quem
-- NÃO segue um perfil, a ausência da chave continua valendo "vê tudo". Divergir
-- aqui não fecharia buraco nenhum — só faria a API esconder o que a tela mostra,
-- e o gestor não saberia em qual das duas acreditar.
--
-- Para quem segue um PERFIL, ausente é "não vê": perfil é sempre novo, não há
-- cadastro antigo para preservar, e um perfil que não fala de visão não pode
-- abrir a carteira inteira em silêncio.
create or replace function a1_case_visao_completa()
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when a1_e_gestor() then true
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
grant execute on function a1_case_visao_completa() to anon, authenticated;

-- ─── O processo é desta pessoa? ──────────────────────────────────────────────
--
-- Espelha isMeuProcesso() e o shared_managers do correspondente: colega da
-- mesma empresa que ligou "compartilhar carteira" (ver_todos_repasses) continua
-- visível para os outros da empresa.
create or replace function a1_case_visivel(
  p_broker text, p_manager text, p_usuario_corr text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when a1_case_visao_completa() then true
    when a1_nome_ator() is null then false
    when btrim(lower(coalesce(p_broker,'')))       = a1_nome_ator() then true
    when btrim(lower(coalesce(p_manager,'')))      = a1_nome_ator() then true
    when btrim(lower(coalesce(p_usuario_corr,''))) = a1_nome_ator() then true
    -- Carteira compartilhada dentro da empresa correspondente.
    when a1_tipo_ator() = 'cca' and exists (
      select 1
        from a1_partners colega
        join a1_partners eu on eu.id = a1_ator()
       where colega.tenant_id = a1_tenant()
         and colega.type = 'cca'
         and colega.empresa_id is not null
         and colega.empresa_id = eu.empresa_id
         and (colega.permissions->>'ver_todos_repasses') = 'true'
         and btrim(lower(colega.name)) in (
               btrim(lower(coalesce(p_broker,''))),
               btrim(lower(coalesce(p_manager,''))),
               btrim(lower(coalesce(p_usuario_corr,''))))
    ) then true
    else false
  end;
$$;
grant execute on function a1_case_visivel(text, text, text) to anon, authenticated;

-- =============================================================================
-- O RELATÓRIO — leia antes de rodar a parte 2
--
-- 1. Quem enxerga a carteira inteira, e POR QUÊ. A coluna `motivo` é a decisão:
--    'marcado' é escolha registrada do gestor; 'ausente' é o padrão antigo
--    valendo por omissão — é aqui que mora a decisão que só você pode tomar.
--
--    select t.name as cliente, p.name as pessoa, p.type,
--           case
--             when (p.permissions->>'gerente') = 'true'                       then 'gerente'
--             when coalesce(pf.permissions, p.permissions) ? 'ver_todos_analistas'
--               then case when (coalesce(pf.permissions, p.permissions)->>'ver_todos_analistas') = 'true'
--                         then 'marcado' else 'fechado' end
--             when p.perfil_id is not null                                    then 'perfil sem a chave (fechado)'
--             else 'ausente — ve tudo por omissao'
--           end as motivo,
--           pf.nome as perfil
--      from a1_partners p
--      join a1_tenants t on t.id = p.tenant_id
--      left join a1_perfis pf on pf.id = p.perfil_id and pf.ativo
--     where p.type in ('corretor','analista','coordenador','cca','despachante')
--       and p.is_active
--     order by t.name, motivo, p.name;
--
-- 2. Quantos processos cada pessoa passaria a ver, se a parte 2 estivesse no ar.
--    Roda a decisão de fora da sessão dela, então serve como simulação:
--
--    select p.name, p.type,
--           (select count(*) from a1_cases c where c.tenant_id = p.tenant_id) as ve_hoje,
--           (select count(*) from a1_cases c
--             where c.tenant_id = p.tenant_id
--               and (btrim(lower(coalesce(c.broker_name,'')))  = btrim(lower(p.name))
--                 or btrim(lower(coalesce(c.manager_name,''))) = btrim(lower(p.name))
--                 or btrim(lower(coalesce(c.payload->>'usuario_correspondente','')))
--                      = btrim(lower(p.name)))) as ve_por_vinculo
--      from a1_partners p
--     where p.type in ('corretor','analista','coordenador','cca')
--       and p.is_active
--     order by ve_por_vinculo, p.name;
--
--    Pessoa com `ve_por_vinculo` = 0 e que hoje trabalha no sistema é o sinal de
--    alerta: ou o processo dela está gravado com outro nome, ou ela depende da
--    visão ampla. Nos dois casos, resolver ANTES da parte 2.
-- =============================================================================
