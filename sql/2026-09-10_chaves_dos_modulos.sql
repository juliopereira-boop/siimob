-- =============================================================================
-- AS CHAVES DA PRÉ-ANÁLISE E DO COMERCIAL PASSAM A VALER
--
-- O DEFEITO, relatado em produção: o gestor marcou "Criar pré-análise" no
-- cadastro de um corretor e nenhum botão de criar pré-análise apareceu para
-- ele. A causa não é a tela nem o banco isoladamente — é que NINGUÉM lia a
-- chave.
--
-- O cadastro grava pa_ver, pa_criar, pa_editar, co_ver, co_editar,
-- co_contrato. A tela perguntava por criar_repasses e editar_repasses. As
-- políticas deste banco também. As seis chaves da Pré-análise e do Comercial
-- eram, na prática, decoração: seis caixas que o gestor marcava e desmarcava
-- sem que nada do outro lado mudasse.
--
-- Caixa que não faz nada é pior do que caixa ausente — quem marca acredita que
-- concedeu, e quem desmarca acredita que fechou. Este arquivo é o outro lado:
-- daqui em diante cada chave manda no que o nome dela diz.
--
--   pa_criar     cria pré-análise e cadastra pessoas
--   pa_editar    altera dados, anexa documento e move na esteira
--   co_editar    altera proposta, mexe em contrato e move na esteira
--   co_contrato  carimba ASSINADO
--
-- POR QUE É SEGURO AGORA: Pré-análise e Comercial estão licenciados para UM
-- cliente — o de demonstração. Nenhum cliente pagante usa estes módulos hoje,
-- então trocar a chave não tira acesso de ninguém que esteja trabalhando. Feito
-- depois de o primeiro cliente entrar, isto seria uma migração de cadastro, com
-- a conta de quem fica de fora — e não uma troca de nome.
--
-- ORDEM: rode DEPOIS de 2026-09-09_documento_obrigatorio.sql. Aquele arquivo
-- reescreve a1_pa_transicionar (com a trava de documento obrigatório, e já com
-- pa_editar); este não a redefine, para não desfazer aquela trava.
--
-- O QUE NÃO MUDA: analisar_credito continua sendo analisar_credito nos dois
-- lados, e gerente continua valendo por cima de tudo.
-- =============================================================================

-- ─── Pré-análise ─────────────────────────────────────────────────────────────
drop policy if exists a1_pre_analises_criar on a1_pre_analises;
create policy a1_pre_analises_criar on a1_pre_analises for insert
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
              and a1_perm('pa_criar'));

drop policy if exists a1_pre_analises_editar on a1_pre_analises;
create policy a1_pre_analises_editar on a1_pre_analises for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_pa_visivel(corretor_id, empresa_id) and a1_perm('pa_editar'))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));

-- As filhas (participantes e documentos) seguem a mãe. Anexar documento é
-- mexer no processo, então é pa_editar — não pa_criar, que é abrir um novo.
do $$
declare t text;
begin
  foreach t in array array['a1_pa_participantes','a1_pa_documentos']
  loop
    execute format('drop policy if exists %I on %I', t || '_escrever', t);
    execute format($f$
      create policy %I on %I for all using (
        tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
        and a1_perm('pa_editar')
        and exists (select 1 from a1_pre_analises pa
                     where pa.id = %I.pre_analise_id
                       and a1_pa_visivel(pa.corretor_id, pa.empresa_id)))
      with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'))$f$,
      t || '_escrever', t, t);
  end loop;
end $$;

-- Pessoas: cadastrar gente faz parte de abrir a pré-análise, então é pa_criar.
-- Ler e escrever continuam SEPARADOS: uma política `for all` também concede
-- SELECT, e uma só devolveria a agenda inteira do cliente a qualquer corretor
-- com permissão de criar — nome, CPF, telefone e endereço da carteira alheia.
drop policy if exists a1_pa_pessoas_criar on a1_pa_pessoas;
create policy a1_pa_pessoas_criar on a1_pa_pessoas for insert
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
              and a1_perm('pa_criar'));

drop policy if exists a1_pa_pessoas_editar on a1_pa_pessoas;
create policy a1_pa_pessoas_editar on a1_pa_pessoas for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_perm('pa_criar')
         and (a1_e_gestor() or a1_perm('gerente')
              or exists (select 1 from a1_pa_participantes pp
                          join a1_pre_analises pa on pa.id = pp.pre_analise_id
                         where pp.pessoa_id = a1_pa_pessoas.id
                           and a1_pa_visivel(pa.corretor_id, pa.empresa_id))))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));

-- A porta do módulo. Sem pa_ver, a pessoa não lê pré-análise nenhuma — nem a
-- que está no nome dela. É o degrau mais básico e era o mais decorativo de
-- todos: a política de leitura nunca perguntou por ele.
--
-- As filhas (participantes, documentos) não precisam da chave repetida: elas
-- se enxergam por um exists sobre a mãe, e a mãe já não devolve linha.
drop policy if exists a1_pre_analises_ler on a1_pre_analises;
create policy a1_pre_analises_ler on a1_pre_analises for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_perm('pa_ver')
         and a1_pa_visivel(corretor_id, empresa_id));

-- ─── Comercial ───────────────────────────────────────────────────────────────
drop policy if exists a1_comerciais_ler on a1_comerciais;
create policy a1_comerciais_ler on a1_comerciais for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and a1_perm('co_ver')
         and a1_co_visivel(corretor_id, empresa_id));

drop policy if exists a1_comerciais_editar on a1_comerciais;
create policy a1_comerciais_editar on a1_comerciais for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and a1_co_visivel(corretor_id, empresa_id) and a1_perm('co_editar'))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL'));

drop policy if exists a1_co_contratos_escrever on a1_co_contratos;
create policy a1_co_contratos_escrever on a1_co_contratos for all
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL') and a1_perm('co_editar')
         and exists (select 1 from a1_comerciais c where c.id = a1_co_contratos.comercial_id
                      and a1_co_visivel(c.corretor_id, c.empresa_id)))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL'));

-- ─── As funções, com a chave trocada ─────────────────────────────────────────
-- Copiadas de 2026-09-04_gatilhos.sql e 2026-09-04_comercial.sql com UMA linha
-- diferente em cada. Vêm inteiras porque create or replace substitui o corpo
-- todo; a alternativa seria um patch de texto, que ninguém consegue revisar.

create or replace function a1_co_transicionar(
  p_comercial uuid, p_para uuid, p_justificativa text default null,
  p_versao_esperada int default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_co a1_comerciais%rowtype;
  v_tr a1_co_transicoes%rowtype;
  v_case uuid;
  v_erro text;
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_co from a1_comerciais where id = p_comercial;
  if v_co.id is null or v_co.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('COMERCIAL') then raise exception 'modulo_desabilitado'; end if;
  if not a1_co_visivel(v_co.corretor_id, v_co.empresa_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('co_editar') then raise exception 'sem_permissao'; end if;
  if p_versao_esperada is not null and p_versao_esperada <> v_co.versao then
    raise exception 'versao_desatualizada'; end if;

  select * into v_tr from a1_co_transicoes
   where tenant_id = v_co.tenant_id and ativo and para_id = p_para
     and (de_id is null or de_id = v_co.situacao_id)
   order by (de_id is not null) desc limit 1;
  if v_tr.id is null then raise exception 'transicao_nao_permitida'; end if;

  if array_length(v_tr.papeis,1) is not null
     and not (coalesce(a1_tipo_ator(), a1_papel()) = any (v_tr.papeis))
     and not a1_e_gestor() then
    raise exception 'papel_nao_autorizado';
  end if;

  -- Exigir contrato assinado é OPÇÃO do cliente, marcada na transição — e não
  -- uma regra fixa do sistema. CREATE_REPASS pode estar em qualquer etapa.
  if coalesce((v_tr.requisitos->>'contrato_assinado')::boolean, false)
     and not exists (select 1 from a1_co_contratos
                      where comercial_id = p_comercial and status = 'ASSINADO') then
    raise exception 'contrato_nao_assinado';
  end if;

  if v_tr.acao = 'CREATE_REPASS' and v_tr.acao_modo = 'AUTO' then
    v_erro := a1_co_pode_criar_repasse(p_comercial);
    if v_erro is not null then
      perform a1_integra_registrar(v_co.tenant_id,'CREATE_REPASS','COMERCIAL',
        p_comercial,'REPASSE',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
      return json_build_object('ok', false, 'erro', v_erro);
    end if;
  end if;

  insert into a1_co_eventos (tenant_id, comercial_id, evento, de_situacao,
                             para_situacao, ator_id, detalhe)
  values (v_co.tenant_id, p_comercial, 'transicao', v_co.situacao_id, p_para,
          a1_ator(), jsonb_build_object('justificativa', p_justificativa));

  update a1_comerciais set situacao_id = p_para, versao = versao + 1,
                           atualizado_em = now()
   where id = p_comercial;

  if v_tr.acao = 'CREATE_REPASS' and v_tr.acao_modo = 'AUTO' then
    v_case := a1_criar_repasse_do_comercial(p_comercial);
  end if;

  return json_build_object('ok', true, 'situacao_id', p_para, 'repasse_case_id', v_case);
end $$;

create or replace function a1_pa_executar_acao(p_pre_analise uuid, p_acao text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_erro text; v_pa a1_pre_analises%rowtype;
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_pa from a1_pre_analises where id = p_pre_analise;
  if v_pa.id is null or v_pa.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('PRE_ANALISE') then raise exception 'modulo_desabilitado'; end if;
  if not a1_pa_visivel(v_pa.corretor_id, v_pa.empresa_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('pa_editar') then raise exception 'sem_permissao'; end if;
  if p_acao <> 'ENABLE_COMMERCIAL' then raise exception 'acao_desconhecida'; end if;
  v_erro := a1_pa_pode_criar_comercial(p_pre_analise);
  if v_erro is not null then
    perform a1_integra_registrar(a1_tenant(),'ENABLE_COMMERCIAL','PRE_ANALISE',
      p_pre_analise,'COMERCIAL',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
    return json_build_object('ok', false, 'erro', v_erro);
  end if;
  return json_build_object('ok', true, 'comercial_id', a1_criar_comercial(p_pre_analise));
end $$;

create or replace function a1_co_executar_acao(p_comercial uuid, p_acao text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_erro text; v_co a1_comerciais%rowtype;
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_co from a1_comerciais where id = p_comercial;
  if v_co.id is null or v_co.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('COMERCIAL') then raise exception 'modulo_desabilitado'; end if;
  if not a1_co_visivel(v_co.corretor_id, v_co.empresa_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('co_editar') then raise exception 'sem_permissao'; end if;
  if p_acao <> 'CREATE_REPASS' then raise exception 'acao_desconhecida'; end if;
  v_erro := a1_co_pode_criar_repasse(p_comercial);
  if v_erro is not null then
    perform a1_integra_registrar(a1_tenant(),'CREATE_REPASS','COMERCIAL',
      p_comercial,'REPASSE',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
    return json_build_object('ok', false, 'erro', v_erro);
  end if;
  return json_build_object('ok', true,
    'repasse_case_id', a1_criar_repasse_do_comercial(p_comercial));
end $$;

create or replace function a1_co_guarda_contrato()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if new.status = 'ASSINADO'
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and not (a1_e_gestor() or a1_perm('gerente') or a1_perm('co_contrato')) then
    raise exception 'sem_permissao_para_marcar_contrato_assinado';
  end if;
  return new;
end $$;

-- =============================================================================
-- COMO CONFERIR
--
--   select policyname, cmd,
--          case when qual||coalesce(with_check,'') like '%pa_%' then 'pa_*'
--               when qual||coalesce(with_check,'') like '%co_%' then 'co_*'
--               else 'AINDA NO REPASSE' end as chave
--     from pg_policies
--    where tablename in ('a1_pre_analises','a1_pa_pessoas','a1_pa_documentos',
--                        'a1_pa_participantes','a1_comerciais','a1_co_contratos')
--    order by tablename, policyname;
--
-- Nenhuma linha pode vir como "AINDA NO REPASSE".
--
-- Depois, com um corretor que tenha pa_criar e NÃO tenha criar_repasses:
--   a) o botão "+ Nova Pré-análise" aparece para ele;
--   b) ele cria;
--   c) sem pa_editar, não move o processo de situação.
-- =============================================================================
