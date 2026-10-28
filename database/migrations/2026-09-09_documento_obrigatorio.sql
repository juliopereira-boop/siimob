-- =============================================================================
-- DOCUMENTO OBRIGATÓRIO — a trava no banco
--
-- POR QUE ESTE ARQUIVO EXISTE
-- O gestor passou a poder marcar um tipo de documento como OBRIGATÓRIO em
-- Configurações › Tipos de documento. A tela avisa quem tenta mover um processo
-- sem ele, mas aviso de tela é conveniência: quem chama a API direto passaria
-- por cima. Quem tranca é aqui.
--
-- O QUE ESTE ARQUIVO NÃO MUDA
-- Nada, enquanto nenhum tipo estiver marcado como obrigatório — e hoje nenhum
-- está, em cliente nenhum. A trava só existe a partir do primeiro tipo que o
-- gestor marcar, e vale só para o módulo em que ele marcou. Rodar isto num
-- cliente que não usa o recurso não muda uma linha de comportamento.
--
-- ONDE A REGRA VALE
--   · Pré-análise: dentro de a1_pa_transicionar, junto das outras validações da
--     esteira. Documento pendente barra a transição.
--   · Repasse: gatilho em a1_cases, e só no movimento PARA FRENTE (posição
--     maior). Voltar de etapa continua livre — corrigir engano não pode
--     depender de anexar documento que ainda não existe.
--   · Comercial: fora. Ele não tem documento tipado; guarda contrato, com fluxo
--     e permissão próprios (a1_co_guarda_contrato).
--
-- ORDEM DE PUBLICAÇÃO
-- Este arquivo pode subir ANTES da tela: sem a coluna "Obrigatório" ninguém
-- marca nada, e a trava fica inerte. A tela sem este arquivo também funciona,
-- mas só avisa — não tranca. O certo é este arquivo primeiro.
--
-- COMO CONFERIR: no fim do arquivo.
-- =============================================================================

-- ─── 1. Quais tipos são obrigatórios, neste cliente e neste módulo ───────────
--
-- Os tipos de documento moram num JSON dentro de a1_config (key = 'doc_types'),
-- numa coluna `value` do tipo TEXT. Isso significa que o conteúdo pode não ser
-- JSON válido — foi escrito por telas de épocas diferentes, e uma delas gravava
-- uma lista de strings simples (["RG","CPF"]) em vez de objetos.
--
-- Por isso a leitura é à prova de lixo: qualquer surpresa devolve lista vazia,
-- que significa "nada obrigatório". Uma exceção aqui derrubaria a transição
-- inteira em vez de negar um documento — o oposto do que se quer.
create or replace function a1_docs_obrigatorios(p_tenant uuid, p_modulo text)
returns text[] language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_json  jsonb;
  v_lista text[];
begin
  select case when c.value ~ '^\s*\[' then c.value::jsonb else null end
    into v_json
    from a1_config c
   where c.tenant_id = p_tenant and c.key = 'doc_types'
   limit 1;

  if v_json is null or jsonb_typeof(v_json) <> 'array' then
    return '{}'::text[];
  end if;

  select coalesce(array_agg(distinct d.value->>'name'), '{}')
    into v_lista
    from jsonb_array_elements(v_json) d
   where jsonb_typeof(d.value) = 'object'
     and d.value->>'name' is not null
     and btrim(d.value->>'name') <> ''
     and coalesce(d.value->>'module', 'repasse') = p_modulo
     -- Só o texto 'false' desliga. Valor esquisito de tela antiga conta como
     -- ativo, que é como o front sempre leu (active !== false).
     and coalesce(d.value->>'active', 'true') <> 'false'
     -- E só o texto 'true' obriga. Aqui a leitura é a oposta, e de propósito:
     -- na dúvida, NÃO obriga. Um valor estranho não pode travar a esteira de um
     -- cliente que nunca pediu esta regra.
     and coalesce(d.value->>'obrigatorio', 'false') = 'true';

  return coalesce(v_lista, '{}'::text[]);
exception when others then
  return '{}'::text[];
end $$;

grant execute on function a1_docs_obrigatorios(uuid, text) to anon, authenticated;

-- ─── 2. Pré-análise: o que falta nesta pré-análise ───────────────────────────
--
-- Documento REPROVADO ou SUBSTITUIDO não conta como entregue: o tipo continua
-- faltando. PENDENTE_ENVIO também não — é a marca de "ainda vou mandar".
create or replace function a1_pa_docs_faltando(p_pre_analise uuid)
returns text[] language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select coalesce(array_agg(t.nome order by t.nome), '{}'::text[])
    from (
      select unnest(a1_docs_obrigatorios(pa.tenant_id, 'PRE_ANALISE')) as nome
        from a1_pre_analises pa
       where pa.id = p_pre_analise
    ) t
   where not exists (
     select 1 from a1_pa_documentos d
      where d.pre_analise_id = p_pre_analise
        and d.tipo = t.nome
        and d.status not in ('REPROVADO','SUBSTITUIDO','PENDENTE_ENVIO')
   );
$$;

grant execute on function a1_pa_docs_faltando(uuid) to anon, authenticated;

-- ─── 3. Repasse: o que falta neste processo ──────────────────────────────────
--
-- No Repasse os documentos são um array jsonb na própria a1_cases, e o tipo é
-- gravado como TEXTO em `type` — o mesmo nome que está no cadastro. Documento
-- antigo (base64 no payload, hoje em legacy_docs) não entra na conta: ele não
-- tem tipo confiável, e exigir dele seria travar processo que já andou.
create or replace function a1_case_docs_faltando(p_case uuid)
returns text[] language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select coalesce(array_agg(t.nome order by t.nome), '{}'::text[])
    from (
      select unnest(a1_docs_obrigatorios(c.tenant_id, 'repasse')) as nome
        from a1_cases c
       where c.id = p_case
    ) t
   where not exists (
     select 1
       from a1_cases c
       cross join lateral jsonb_array_elements(
              case when jsonb_typeof(coalesce(c.documents, '[]'::jsonb)) = 'array'
                   then coalesce(c.documents, '[]'::jsonb) else '[]'::jsonb end) d
      where c.id = p_case
        and d.value->>'type' = t.nome
   );
$$;

grant execute on function a1_case_docs_faltando(uuid) to anon, authenticated;

-- ─── 4. A trava do Repasse ───────────────────────────────────────────────────
--
-- Só no movimento PARA FRENTE. `position` é a ordem da etapa no workflow; etapa
-- sem posição (ou de outro módulo) não entra na comparação e não trava.
create or replace function a1_cases_guarda_documento()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_de   int;
  v_para int;
  v_falta text[];
begin
  if new.stage_id is not distinct from old.stage_id then return new; end if;

  select position into v_de   from a1_stages where id = old.stage_id;
  select position into v_para from a1_stages where id = new.stage_id;
  -- Voltar de etapa, ou mover entre etapas sem ordem definida, continua livre.
  if v_de is null or v_para is null or v_para <= v_de then return new; end if;

  v_falta := a1_case_docs_faltando(new.id);
  if array_length(v_falta, 1) is not null then
    raise exception 'documento_obrigatorio_faltando: %', array_to_string(v_falta, ', ');
  end if;
  return new;
end $$;

drop trigger if exists trg_a1_cases_guarda_documento on a1_cases;
create trigger trg_a1_cases_guarda_documento
  before update on a1_cases
  for each row execute function a1_cases_guarda_documento();

-- ─── 5. A trava da Pré-análise, dentro do orquestrador ───────────────────────
--
-- Reescrita inteira de a1_pa_transicionar. É a versão de
-- 2026-09-08_perfis_de_acesso.sql com UM bloco a mais — o de documento
-- obrigatório, logo depois da checagem de 'documentos_aprovados', que é uma
-- regra diferente: aquela exige APROVAÇÃO do que foi enviado, esta exige que o
-- tipo tenha sido enviado.
create or replace function a1_pa_transicionar(
  p_pre_analise uuid, p_para uuid, p_justificativa text default null,
  p_versao_esperada int default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_pa a1_pre_analises%rowtype;
  v_tr a1_pa_transicoes%rowtype;
  v_comercial uuid;
  v_erro text;
  v_falta text[];
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_pa from a1_pre_analises where id = p_pre_analise;
  if v_pa.id is null or v_pa.tenant_id <> a1_tenant() then
    raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('PRE_ANALISE') then raise exception 'modulo_desabilitado'; end if;
  if not a1_pa_visivel(v_pa.corretor_id, v_pa.empresa_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('pa_editar') then raise exception 'sem_permissao'; end if;

  if p_versao_esperada is not null and p_versao_esperada <> v_pa.versao then
    raise exception 'versao_desatualizada';
  end if;

  select * into v_tr from a1_pa_transicoes
   where tenant_id = v_pa.tenant_id and ativo and para_id = p_para
     and (de_id is null or de_id = v_pa.situacao_id)
   order by (de_id is not null) desc limit 1;
  if v_tr.id is null then raise exception 'transicao_nao_permitida'; end if;

  if array_length(v_tr.papeis,1) is not null
     and not (coalesce(a1_tipo_ator(), a1_papel()) = any (v_tr.papeis))
     and not a1_e_gestor() then
    raise exception 'papel_nao_autorizado';
  end if;

  if v_tr.acao = 'ENABLE_COMMERCIAL' and v_tr.acao_modo = 'AUTO' then
    v_erro := a1_pa_pode_criar_comercial(p_pre_analise);
    if v_erro is not null then
      perform a1_integra_registrar(v_pa.tenant_id,'ENABLE_COMMERCIAL','PRE_ANALISE',
        p_pre_analise,'COMERCIAL',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
      return json_build_object('ok', false, 'erro', v_erro);
    end if;
  end if;

  if coalesce((v_tr.requisitos->>'documentos_aprovados')::boolean, false)
     and exists (select 1 from a1_pa_documentos
                  where pre_analise_id = p_pre_analise and status <> 'APROVADO') then
    raise exception 'documentos_pendentes';
  end if;

  -- Documento obrigatório: vale para QUALQUER transição, sem depender de a
  -- esteira ter pedido nada. O gestor marcou o tipo como obrigatório uma vez, em
  -- Configurações, e não teria como repetir a marcação em cada seta do desenho.
  v_falta := a1_pa_docs_faltando(p_pre_analise);
  if array_length(v_falta, 1) is not null then
    raise exception 'documento_obrigatorio_faltando: %', array_to_string(v_falta, ', ');
  end if;

  insert into a1_pa_eventos (tenant_id, pre_analise_id, evento, de_situacao,
                             para_situacao, ator_id, detalhe)
  values (v_pa.tenant_id, p_pre_analise, 'transicao', v_pa.situacao_id, p_para,
          a1_ator(), jsonb_build_object('justificativa', p_justificativa));

  update a1_pre_analises
     set situacao_id = p_para, versao = versao + 1, atualizado_em = now()
   where id = p_pre_analise;

  if v_tr.acao = 'ENABLE_COMMERCIAL' and v_tr.acao_modo = 'AUTO' then
    v_comercial := a1_criar_comercial(p_pre_analise);
  end if;

  return json_build_object('ok', true, 'situacao_id', p_para,
                           'comercial_id', v_comercial);
end $$;
grant execute on function a1_pa_transicionar(uuid,uuid,text,int) to anon, authenticated;

-- =============================================================================
-- COMO CONFERIR
--
-- 1. As quatro funções e o gatilho existem:
--
--    select proname from pg_proc
--     where proname in ('a1_docs_obrigatorios','a1_pa_docs_faltando',
--                       'a1_case_docs_faltando','a1_cases_guarda_documento');
--    select tgname from pg_trigger where tgname = 'trg_a1_cases_guarda_documento';
--
-- 2. Nada é obrigatório hoje — a lista tem de vir vazia para todo cliente:
--
--    select t.name, a1_docs_obrigatorios(t.id,'repasse'),
--                   a1_docs_obrigatorios(t.id,'PRE_ANALISE')
--      from a1_tenants t;
--
-- 3. Depois que o gestor marcar um tipo como obrigatório em Configurações, a
--    mesma consulta passa a devolver o nome dele — e só então a trava age.
-- =============================================================================
