-- =============================================================================
-- DE QUEM É A PRÉ-ANÁLISE: O CORRETOR DO GESTOR E A IMOBILIÁRIA DO CORRETOR
--
-- POR QUE ESTE ARQUIVO EXISTE
--
-- Dois defeitos relatados na tela de Pré-análise têm a outra metade aqui.
--
-- 1) O GESTOR NÃO CONSEGUIA ESCOLHER O CORRETOR — e, pior, a pré-análise que
--    ele abria nascia com um corretor_id que não é de corretor nenhum.
--
--    a1_pa_guarda_insert fazia, para gestor e gerente:
--
--        elsif new.corretor_id is null then new.corretor_id := v_ator;
--
--    Só que a1_ator() devolve o id de a1_partners quando quem chama é parceiro
--    e o id de a1_users quando é gestor (owner/admin). Gestor não tem linha em
--    a1_partners. O resultado é um uuid de USUÁRIO gravado numa coluna que
--    aponta para PARCEIRO: nenhuma tela consegue resolver o nome, o filtro por
--    corretor nunca casa, e o processo fica sem dono de verdade.
--
--    Agora o preenchimento automático só acontece quando o ator É parceiro.
--    Gestor que não informar corretor deixa a coluna nula — que é a verdade
--    ("ainda sem corretor") e aparece como tal — e a tela passa a oferecer o
--    seletor para ele informar.
--
-- 2) A IMOBILIÁRIA DO CORRETOR vinha em branco. O vínculo existe no cadastro
--    (a1_partners.extra.imobiliaria_id) e a tela agora o preenche sozinha. Aqui
--    o banco fecha a porta de trás: quando quem cria é um parceiro COM vínculo,
--    a imobiliária gravada é a dele, venha o que vier no POST. É a mesma ideia
--    que já valia para corretor_id — quem não manda na carteira não escolhe de
--    quem é o negócio.
--
-- 3) DE QUEBRA, a regra nº 2 do sistema: corretor_id de OUTRO cliente passa a
--    ser recusado. Antes, um POST com o uuid de um parceiro de outro tenant era
--    aceito sem discussão. Nada vazava (as políticas filtram por a1_tenant()),
--    mas o dado ficava mentindo.
--
-- O QUE NÃO MUDA
--   · Nenhuma política de RLS é tocada. As chaves continuam as de
--     2026-09-10_chaves_dos_modulos.sql (pa_ver / pa_criar / pa_editar).
--   · Corretor continua sem poder escolher o dono do processo: para quem não é
--     gestor nem gerente, corretor_id continua sendo reescrito com a1_ator().
--   · Redistribuir carteira continua sendo do gestor
--     ('redistribuir_carteira_e_do_gestor'), e a situação continua só mudando
--     pelo orquestrador ('situacao_so_muda_por_transicao').
--   · Nenhuma linha existente é alterada. Os gatilhos valem para INSERT e
--     UPDATE dali em diante; pré-análises já gravadas com corretor_id inválido
--     continuam como estão — quem quiser arrumar usa o seletor novo no dossiê.
--   · Na UPDATE a imobiliária NÃO é forçada, de propósito: um gestor pode ter
--     colocado o processo numa imobiliária diferente da do corretor, e forçar
--     no PATCH desfaria essa decisão sem ninguém pedir.
--
-- ORDEM: depois de 2026-09-04_pre_analise.sql (é dele que estas duas funções
-- vêm). Independente de 2026-09-10_chaves_dos_modulos.sql — pode rodar antes ou
-- depois. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ─── INSERT ──────────────────────────────────────────────────────────────────
-- Vem inteira porque create or replace troca o corpo todo; um patch de texto
-- ninguém consegue revisar.
create or replace function a1_pa_guarda_insert()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
declare
  v_tenant uuid := a1_tenant();
  v_ator   uuid := a1_ator();
  v_partner boolean := (a1_papel() = 'partner');
  v_imob   text;
begin
  -- Sem sessão (importação pela chave de serviço, carga de migração) não há
  -- o que forçar: respeita o que veio. Toda chamada vinda do navegador TEM
  -- sessão, então para ela a regra abaixo vale sempre.
  if v_tenant is not null then new.tenant_id := v_tenant; end if;

  if v_ator is not null then
    new.criado_por := v_ator;

    if v_partner and not (a1_e_gestor() or a1_perm('gerente')) then
      -- O dono é quem criou. Se a tela pudesse escolher, bastava um corretor
      -- mandar o POST com o corretor_id de um colega para plantar processo na
      -- carteira alheia — ou deixar o campo em branco e criar um processo que
      -- ele mesmo não enxerga.
      new.corretor_id := v_ator;
      new.empresa_id  := coalesce(a1_empresa_ator(), new.empresa_id);

      -- E a imobiliária é a do cadastro dele, quando existe. O texto é
      -- conferido antes do cast: extra é jsonb livre, e um valor esquisito
      -- gravado por tela antiga derrubaria a inserção inteira em vez de ser
      -- ignorado. Cadastro sem vínculo (a maioria hoje) segue o que veio.
      select nullif(btrim(p.extra->>'imobiliaria_id'), '') into v_imob
        from a1_partners p where p.id = v_ator;
      if v_imob ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        new.imobiliaria_id := v_imob::uuid;
      end if;

    elsif v_partner and new.corretor_id is null then
      -- Gerente que é parceiro e não informou: o processo é dele.
      new.corretor_id := v_ator;
    end if;
    -- Gestor (owner/admin) NÃO entra em nenhum dos dois ramos: a1_ator() aqui é
    -- id de a1_users, e gravá-lo em corretor_id inventava um corretor que não
    -- existe. Sem informar, a coluna fica nula e a tela mostra "—".
  end if;

  -- Corretor tem de ser deste cliente. Vale só quando há sessão: importação por
  -- chave de serviço continua podendo semear o que precisar.
  if v_tenant is not null and new.corretor_id is not null
     and not exists (select 1 from a1_partners p
                      where p.id = new.corretor_id and p.tenant_id = new.tenant_id) then
    raise exception 'corretor_de_outro_cliente';
  end if;

  new.situacao_em := now();
  -- Situação inicial da esteira do cliente, se a tela não mandou nenhuma.
  if new.situacao_id is null then
    select id into new.situacao_id from a1_pa_situacoes
     where tenant_id = new.tenant_id and ativo and flag = 'INICIAL'
     order by ordem limit 1;
  end if;
  return new;
end $$;

drop trigger if exists trg_pa_guarda_ins on a1_pre_analises;
create trigger trg_pa_guarda_ins before insert on a1_pre_analises
  for each row execute function a1_pa_guarda_insert();

-- ─── UPDATE ──────────────────────────────────────────────────────────────────
-- Igual à de 2026-09-04_pre_analise.sql, com UMA adição: o corretor novo tem de
-- ser deste cliente. O resto — situação, versão, relógio do SLA e quem pode
-- redistribuir carteira — continua palavra por palavra.
create or replace function a1_pa_guarda_update()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_nao_muda';
  end if;
  if not a1_no_orquestrador() then
    if new.situacao_id is distinct from old.situacao_id then
      raise exception 'situacao_so_muda_por_transicao';
    end if;
    if new.versao is distinct from old.versao then
      raise exception 'versao_e_do_sistema';
    end if;
    if new.situacao_em is distinct from old.situacao_em then
      raise exception 'relogio_do_sla_e_do_sistema';
    end if;
    -- Passar o processo para outro corretor é ato de quem manda na carteira,
    -- não do corretor que quer se livrar dele nem de quem quer puxá-lo.
    if (new.corretor_id is distinct from old.corretor_id
        or new.empresa_id is distinct from old.empresa_id)
       and not (a1_e_gestor() or a1_perm('gerente')) then
      raise exception 'redistribuir_carteira_e_do_gestor';
    end if;
    -- E o corretor novo tem de ser deste cliente. Nada vazava sem isto (as
    -- políticas filtram por a1_tenant()), mas o processo ficava no nome de
    -- alguém que não existe para este cliente — e some dos filtros.
    if new.corretor_id is distinct from old.corretor_id and new.corretor_id is not null
       and not exists (select 1 from a1_partners p
                        where p.id = new.corretor_id and p.tenant_id = new.tenant_id) then
      raise exception 'corretor_de_outro_cliente';
    end if;
  end if;
  if new.situacao_id is distinct from old.situacao_id then
    new.situacao_em := now();
  end if;
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists trg_pa_guarda on a1_pre_analises;
create trigger trg_pa_guarda before update on a1_pre_analises
  for each row execute function a1_pa_guarda_update();

-- =============================================================================
-- COMO CONFERIR
--
-- 1. Quantas pré-análises já estão com corretor_id que não é parceiro nenhum —
--    é o estrago que o defeito deixou para trás (esperado: as criadas por
--    gestor antes deste arquivo). Não corrige nada, só mostra:
--
--      select pa.id, pa.codigo, pa.corretor_id, u.name as parece_ser_o_usuario
--        from a1_pre_analises pa
--        left join a1_users u on u.id = pa.corretor_id
--       where pa.corretor_id is not null
--         and not exists (select 1 from a1_partners p where p.id = pa.corretor_id);
--
--    Para arrumar, o caminho é a tela: abrir o dossiê e escolher o corretor no
--    campo novo. Assim fica registrado quem decidiu, e não um update solto.
--
-- 2. Com uma sessão de GESTOR, criando sem informar corretor: a coluna tem de
--    ficar nula, e não com o id do usuário.
--
--      insert into a1_pre_analises (tenant_id, empreendimento_id)
--      values (a1_tenant(), '<uuid de um empreendimento>')
--      returning corretor_id;          -- esperado: null
--
-- 3. Com uma sessão de CORRETOR que tenha extra.imobiliaria_id preenchido,
--    mandando outra imobiliária de propósito: o banco tem de reescrever com a
--    dele, e corretor_id tem de sair como o id DELE.
--
--      insert into a1_pre_analises (tenant_id, empreendimento_id, imobiliaria_id)
--      values (a1_tenant(), '<empreendimento>', '<imobiliária de outra pessoa>')
--      returning corretor_id, imobiliaria_id;
--
-- 4. Corretor de outro cliente tem de ser recusado com 'corretor_de_outro_cliente':
--
--      update a1_pre_analises set corretor_id = '<parceiro de outro tenant>'
--       where id = '<uma pré-análise sua>';
-- =============================================================================
