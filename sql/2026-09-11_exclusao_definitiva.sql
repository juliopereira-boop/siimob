-- =============================================================================
-- EXCLUSÃO DEFINITIVA — achar o cartão pelo código, guardar o retrato, apagar
--
-- POR QUE ESTE ARQUIVO EXISTE
-- Hoje não há caminho para apagar um cartão de propósito. O que existe é o
-- "Arquivar" do Repasse, que manda um DELETE direto na tabela, não pergunta
-- nada, não guarda nada e some com o processo — e não existe equivalente
-- nenhum na Pré-análise nem no Comercial. O dono pediu o oposto disso: uma
-- área de perigo em Configurações onde se cola o código do cartão, o sistema
-- MOSTRA o que achou, e só então a exclusão acontece, com justificativa
-- gravada antes de o registro sumir.
--
-- A REGRA QUE MANDA AQUI: a autorização não é da tela.
-- Quem decide é o Postgres. a1_excluir_definitivo() é `security definer` e
-- confere, nesta ordem: sessão válida, gestor (a1_e_gestor()), cliente da
-- sessão (a1_tenant()), licença do módulo, justificativa escrita, registro
-- existente NESTE cliente e ausência de dependente em outro módulo. Só depois
-- grava a auditoria e apaga. Um parceiro que chame o RPC direto na API, com
-- token válido e a chave pública, leva recusa do banco — não da tela.
--
-- O QUE ESTE ARQUIVO **NÃO** MUDA
--  · Não mexe em nenhuma política de RLS existente, nem em grant existente.
--  · Não revoga o DELETE que `anon` já tem em a1_cases desde o schema.sql —
--    revogar quebraria o "Arquivar" que está publicado em repasse.html,
--    andamento.html, listagem.html e configuracoes.html. Fechar aquela porta
--    é decisão do dono e é outro arquivo; aqui só se abre uma porta melhor,
--    auditada, que também atende os dois módulos novos.
--  · Não apaga nada por conta própria: nenhum comando deste arquivo remove
--    linha de dado. Ele só cria tabela, funções e políticas.
--  · Não apaga pessoas (a1_pa_pessoas): a pessoa é cadastro compartilhado e
--    costuma aparecer em outras pré-análises.
--  · Não apaga a trilha de integração (a1_integra_eventos): é justamente o
--    registro de que algo aconteceu entre módulos, e precisa sobreviver ao
--    registro que sumiu.
--  · Não apaga arquivo do Storage. O banco não alcança o bucket. As chaves
--    (storage_key, attachment_name) ficam guardadas no retrato da auditoria
--    para que o arquivo possa ser achado e removido à mão depois.
--
-- Depende de: sql/2026-09-04_identidade.sql
--             sql/2026-09-04_pre_analise.sql
--             sql/2026-09-04_comercial.sql
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ─── A auditoria, que é imutável ─────────────────────────────────────────────
-- Grava ANTES de apagar. Se a linha da auditoria não entrar, a transação
-- inteira cai e o registro continua lá — a ordem é essa de propósito: um
-- sistema que apaga primeiro e audita depois perde exatamente o caso em que a
-- auditoria importa, que é quando algo deu errado no meio.
--
-- `retrato` guarda o conteúdo da linha apagada. É o que responde, meses
-- depois, "o que exatamente tinha nesse cartão" sem precisar de backup.
create table if not exists a1_exclusoes (
  id            bigserial primary key,
  tenant_id     uuid not null,
  modulo        text not null check (modulo in ('repasse','PRE_ANALISE','COMERCIAL')),
  registro_id   uuid not null,
  codigo        text,                      -- o código que aparecia no cartão
  rotulo        text,                      -- "Maria Silva · Residencial das Flores · un. 101"
  retrato       jsonb not null default '{}'::jsonb,
  filhos        jsonb not null default '{}'::jsonb,   -- o que foi junto, contado
  justificativa text not null,
  ator_id       uuid,                      -- a1_usuario(): o user_id da sessão
  ator_nome     text,
  ator_papel    text,
  excluido_em   timestamptz not null default now()
);
create index if not exists idx_exclusoes_tenant
  on a1_exclusoes (tenant_id, excluido_em desc);
create index if not exists idx_exclusoes_registro
  on a1_exclusoes (tenant_id, registro_id);

alter table a1_exclusoes enable row level security;

-- Leitura: só gestor, e só do próprio cliente. Escrita: ninguém pela API — a
-- única mão que escreve aqui é a da função de exclusão, com privilégio próprio.
-- Sem este revoke, o mesmo gestor que apaga poderia editar a justificativa
-- depois, e a trilha deixaria de valer como trilha.
drop policy if exists a1_exclusoes_ler on a1_exclusoes;
revoke all on a1_exclusoes from anon, authenticated;
grant select on a1_exclusoes to anon, authenticated;
create policy a1_exclusoes_ler on a1_exclusoes for select
  using (tenant_id = a1_tenant() and a1_e_gestor());

-- =============================================================================
-- PEÇAS INTERNAS
-- Não recebem grant para anon: só as duas funções públicas lá embaixo as
-- chamam, e elas rodam como dono. O que não é chamado pela tela não é exposto.
-- =============================================================================

-- Cada módulo tem a sua porta, e é a porta que o próprio módulo já usa:
-- a1_tem_modulo() para os módulos novos (é o que está dentro de cada política
-- deles) e a1_has_module() para o Repasse (é o que a tela do Repasse pergunta,
-- e o único que enxerga módulo vindo do plano, não só da liberação manual).
create or replace function a1_exc_licenciado(p_modulo text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case p_modulo
    when 'repasse'     then a1_has_module('repasse')
    when 'PRE_ANALISE' then a1_tem_modulo('PRE_ANALISE')
    when 'COMERCIAL'   then a1_tem_modulo('COMERCIAL')
    else false
  end;
$$;

-- O QUE VAI JUNTO, contado antes de sumir. Vira o texto "isto some junto" na
-- tela e a coluna `filhos` da auditoria. Contar depois de apagar não dá: a
-- resposta seria sempre zero.
create or replace function a1_exc_filhos(p_modulo text, p_id uuid, p_tenant uuid)
returns jsonb language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case p_modulo
    when 'repasse' then jsonb_build_object(
      'historico_de_etapas', (select count(*) from a1_stage_history h
                               where h.case_id = p_id and h.tenant_id = p_tenant),
      'eventos',             (select count(*) from a1_events e
                               where e.case_id = p_id and e.tenant_id = p_tenant),
      -- E-mail na fila não é apagado: o vínculo com o processo é que se perde
      -- (a coluna é ON DELETE SET NULL). Fica contado para ninguém descobrir
      -- isso depois, por acaso.
      'emails_sem_vinculo',  (select count(*) from a1_emails m
                               where m.case_id = p_id and m.tenant_id = p_tenant))
    when 'PRE_ANALISE' then jsonb_build_object(
      'participantes', (select count(*) from a1_pa_participantes x where x.pre_analise_id = p_id),
      'documentos',    (select count(*) from a1_pa_documentos x where x.pre_analise_id = p_id),
      'analises_de_credito', (select count(*) from a1_pa_analises_credito x where x.pre_analise_id = p_id),
      'eventos',       (select count(*) from a1_pa_eventos x where x.pre_analise_id = p_id))
    when 'COMERCIAL' then jsonb_build_object(
      'contratos', (select count(*) from a1_co_contratos x where x.comercial_id = p_id),
      'eventos',   (select count(*) from a1_co_eventos x where x.comercial_id = p_id))
    else '{}'::jsonb
  end;
$$;

-- O QUE A EXCLUSÃO RECUSA.
--
-- A regra é uma só, e é sobre o SENTIDO da referência: não se apaga um
-- registro para o qual OUTRO registro aponta. Quem aponta é sempre o
-- Comercial — ele guarda `pre_analise_id` (de onde veio) e `repasse_case_id`
-- (o que gerou). Então:
--   · pré-análise que já virou Comercial:  recusada;
--   · repasse que nasceu de um Comercial:  recusado;
--   · Comercial:                           ninguém aponta para ele, logo sai.
--
-- ESTA FUNÇÃO JÁ ESTEVE ERRADA, e a prova pegou. A primeira versão recusava
-- também o Comercial que tinha gerado repasse, "por simetria". O resultado era
-- um par que se trancava para sempre: o repasse pedia para apagar o Comercial
-- primeiro, e o Comercial pedia para apagar o repasse primeiro. Nenhum dos
-- dois saía nunca, e a mensagem mandava a pessoa fazer exatamente o que o
-- outro lado acabara de recusar. Simetria não é a regra — o sentido da seta é.
--
-- Apagado o Comercial, o repasse deixa de ter quem aponte para ele e a
-- pré-análise deixa de ter filho: os dois passam a poder sair, cada um com a
-- sua justificativa. Não existe cascata entre módulos aqui, e é de propósito:
-- três processos sumindo com uma justificativa só é pior trilha que três
-- exclusões escritas. Se o dono quiser o atalho, ele pede — e aí é outro
-- arquivo, não um parâmetro escondido neste.
--
-- Devolve null quando pode apagar, ou a frase que explica o que fazer antes.
create or replace function a1_exc_impedimento(p_modulo text, p_id uuid, p_tenant uuid)
returns text language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare v_lista text;
begin
  if p_modulo = 'PRE_ANALISE' then
    select string_agg(coalesce(co.codigo, left(co.id::text, 8)), ', ')
      into v_lista
      from a1_comerciais co
     where co.tenant_id = p_tenant and co.pre_analise_id = p_id;
    if v_lista is not null then
      return 'Esta pré-análise já gerou o Comercial ' || v_lista ||
             '. Apagá-la deixaria o Comercial apontando para o vazio. ' ||
             'Exclua o Comercial primeiro e volte aqui.';
    end if;

  elsif p_modulo = 'repasse' then
    select string_agg(coalesce(co.codigo, left(co.id::text, 8)), ', ')
      into v_lista
      from a1_comerciais co
     where co.tenant_id = p_tenant and co.repasse_case_id = p_id;
    if v_lista is not null then
      return 'Este repasse nasceu do Comercial ' || v_lista ||
             ', que continuaria apontando para ele. Exclua o Comercial primeiro.';
    end if;
  end if;
  return null;
end $$;

-- =============================================================================
-- 1) PROCURAR — o passo que existe para ninguém apagar às cegas
--
-- Recebe o que a pessoa colou e devolve a FICHA do que achou. A tela mostra
-- cliente, empreendimento, situação, módulo e data antes de liberar o botão.
-- Nunca se apaga aqui: esta função só lê.
--
-- Aceita três formas do "código", porque é o que as telas mostram hoje:
--   · o uuid inteiro;
--   · o pedaço curto que aparece no cartão (as telas imprimem id.slice(0,8));
--   · o campo `codigo` da Pré-análise e do Comercial (PA-001, CO-001).
-- Prefixo com menos de 6 caracteres é recusado: casaria com processo demais,
-- e "achei 40 registros" numa tela de exclusão é convite a acidente.
--
-- Devolve LISTA. Se o prefixo casar com mais de um registro, a tela mostra
-- todos e quem escolhe é a pessoa — não a sorte do `limit 1`.
-- =============================================================================
create or replace function a1_excluir_procurar(p_codigo text)
returns table (
  modulo         text,
  registro_id    uuid,
  codigo         text,
  titulo         text,
  empreendimento text,
  unidade        text,
  situacao       text,
  criado_em      timestamptz,
  filhos         jsonb,
  impedimento    text
)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_tenant uuid := a1_tenant();
  v_txt    text := lower(btrim(coalesce(p_codigo, '')));
  v_uuid   uuid;
begin
  -- Sem sessão ou sem ser gestor, esta função é uma parede: devolve vazio em
  -- vez de erro. A tela do gestor é que trata "não achei"; para quem não é
  -- gestor não existe diferença entre "não achei" e "não te conto".
  if v_tenant is null or not a1_e_gestor() then return; end if;
  if v_txt = '' then return; end if;

  begin v_uuid := v_txt::uuid; exception when others then v_uuid := null; end;
  if v_uuid is null and length(v_txt) < 6 then
    raise exception 'Cole o código inteiro do cartão. Com menos de 6 caracteres a busca casaria com processos demais.';
  end if;

  -- ── Repasse ────────────────────────────────────────────────────────────────
  if a1_exc_licenciado('repasse') then
    return query
      select 'repasse'::text,
             c.id,
             left(c.id::text, 8),
             c.client_name,
             c.development,
             nullif(btrim(coalesce(c.block, '') || ' ' || coalesce(c.unit, '')), ''),
             c.stage_name,
             c.created_at,
             a1_exc_filhos('repasse', c.id, v_tenant),
             a1_exc_impedimento('repasse', c.id, v_tenant)
        from a1_cases c
       where c.tenant_id = v_tenant
         and (case when v_uuid is not null then c.id = v_uuid
                   else c.id::text like v_txt || '%' end);
  end if;

  -- ── Pré-análise ────────────────────────────────────────────────────────────
  if a1_exc_licenciado('PRE_ANALISE') then
    return query
      select 'PRE_ANALISE'::text,
             pa.id,
             coalesce(pa.codigo, left(pa.id::text, 8)),
             -- O nome que a pessoa reconhece é o do titular, não o do corretor.
             (select pe.nome from a1_pa_participantes pp
                join a1_pa_pessoas pe on pe.id = pp.pessoa_id
               where pp.pre_analise_id = pa.id and pp.papel = 'TITULAR'
               limit 1),
             (select d.name from a1_developments d where d.id = pa.empreendimento_id),
             pa.unidade,
             (select s.nome from a1_pa_situacoes s where s.id = pa.situacao_id),
             pa.criado_em,
             a1_exc_filhos('PRE_ANALISE', pa.id, v_tenant),
             a1_exc_impedimento('PRE_ANALISE', pa.id, v_tenant)
        from a1_pre_analises pa
       where pa.tenant_id = v_tenant
         and (case when v_uuid is not null then pa.id = v_uuid
                   else pa.id::text like v_txt || '%'
                        or lower(coalesce(pa.codigo, '')) = v_txt end);
  end if;

  -- ── Comercial ──────────────────────────────────────────────────────────────
  if a1_exc_licenciado('COMERCIAL') then
    return query
      select 'COMERCIAL'::text,
             co.id,
             coalesce(co.codigo, left(co.id::text, 8)),
             -- O Comercial não guarda participante: o nome do titular está no
             -- retrato tirado quando ele nasceu da pré-análise.
             coalesce(
               co.origem_snapshot #>> '{participantes,0,nome}',
               (select pe.nome from a1_pa_participantes pp
                  join a1_pa_pessoas pe on pe.id = pp.pessoa_id
                 where pp.pre_analise_id = co.pre_analise_id and pp.papel = 'TITULAR'
                 limit 1)),
             (select d.name from a1_developments d where d.id = co.empreendimento_id),
             co.unidade,
             (select s.nome from a1_co_situacoes s where s.id = co.situacao_id),
             co.criado_em,
             a1_exc_filhos('COMERCIAL', co.id, v_tenant),
             a1_exc_impedimento('COMERCIAL', co.id, v_tenant)
        from a1_comerciais co
       where co.tenant_id = v_tenant
         and (case when v_uuid is not null then co.id = v_uuid
                   else co.id::text like v_txt || '%'
                        or lower(coalesce(co.codigo, '')) = v_txt end);
  end if;
end $$;

-- =============================================================================
-- 2) EXCLUIR — não tem volta, e por isso confere tudo de novo
--
-- A tela já perguntou tudo isto antes de habilitar o botão. Perguntar de novo
-- aqui não é desconfiança da tela: é que a tela não é o caminho único. Quem
-- chamar este RPC direto na API chega exatamente no mesmo lugar.
-- =============================================================================
create or replace function a1_excluir_definitivo(
  p_modulo text, p_id uuid, p_justificativa text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_tenant uuid := a1_tenant();
  v_just   text := btrim(coalesce(p_justificativa, ''));
  v_retrato jsonb;
  v_filhos  jsonb;
  v_codigo  text;
  v_rotulo  text;
  v_impede  text;
  v_nome    text;
begin
  if v_tenant is null then
    raise exception 'Sessão inválida ou expirada. Entre de novo e repita.';
  end if;
  if not a1_e_gestor() then
    raise exception 'Exclusão definitiva é coisa de gestor. Peça a quem administra o sistema.';
  end if;
  if p_modulo not in ('repasse','PRE_ANALISE','COMERCIAL') then
    raise exception 'Módulo desconhecido: %', p_modulo;
  end if;
  if not a1_exc_licenciado(p_modulo) then
    raise exception 'Este cliente não tem o módulo % licenciado.', p_modulo;
  end if;
  -- A justificativa não é formalidade: é o único texto que sobra explicando
  -- por que o processo sumiu. "ok" e "teste" não explicam nada.
  if length(v_just) < 10 then
    raise exception 'Escreva a justificativa (pelo menos 10 caracteres). Ela fica gravada para sempre junto com a exclusão.';
  end if;
  if p_id is null then
    raise exception 'Faltou o código do registro.';
  end if;

  -- ── Retrato, antes de qualquer delete ─────────────────────────────────────
  if p_modulo = 'repasse' then
    -- Os anexos em base64 saem do retrato: um PDF inteiro por linha inchava a
    -- auditoria sem contar nada que o nome do arquivo já não conte. O nome
    -- fica, e é por ele que o arquivo se acha no Storage depois.
    select to_jsonb(c) - array['attachment_pdf','attachment_doc2','documents','legacy_docs'],
           left(c.id::text, 8),
           concat_ws(' · ', nullif(c.client_name,''), nullif(c.development,''),
                     nullif(nullif(btrim(coalesce(c.block,'')||' '||coalesce(c.unit,'')),''),''))
      into v_retrato, v_codigo, v_rotulo
      from a1_cases c
     where c.id = p_id and c.tenant_id = v_tenant;

  elsif p_modulo = 'PRE_ANALISE' then
    select to_jsonb(pa), coalesce(pa.codigo, left(pa.id::text, 8))
      into v_retrato, v_codigo
      from a1_pre_analises pa
     where pa.id = p_id and pa.tenant_id = v_tenant;
    if v_retrato is not null then
      select pe.nome into v_nome
        from a1_pa_participantes pp join a1_pa_pessoas pe on pe.id = pp.pessoa_id
       where pp.pre_analise_id = p_id and pp.papel = 'TITULAR' limit 1;
      -- Participantes, documentos e decisões de crédito entram no retrato: sem
      -- eles a auditoria diria "apaguei a pré-análise 3f2a" e nada mais.
      v_retrato := v_retrato
        || jsonb_build_object(
             'participantes', coalesce((select jsonb_agg(to_jsonb(pp)) from a1_pa_participantes pp
                                         where pp.pre_analise_id = p_id), '[]'::jsonb),
             'documentos',    coalesce((select jsonb_agg(to_jsonb(pd)) from a1_pa_documentos pd
                                         where pd.pre_analise_id = p_id), '[]'::jsonb),
             'analises_de_credito', coalesce((select jsonb_agg(to_jsonb(ac)) from a1_pa_analises_credito ac
                                               where ac.pre_analise_id = p_id), '[]'::jsonb));
      select concat_ws(' · ', nullif(v_nome,''),
                       (select d.name from a1_developments d
                         where d.id = (v_retrato->>'empreendimento_id')::uuid),
                       nullif(v_retrato->>'unidade',''))
        into v_rotulo;
    end if;

  else -- COMERCIAL
    select to_jsonb(co), coalesce(co.codigo, left(co.id::text, 8))
      into v_retrato, v_codigo
      from a1_comerciais co
     where co.id = p_id and co.tenant_id = v_tenant;
    if v_retrato is not null then
      v_retrato := v_retrato
        || jsonb_build_object(
             'contratos', coalesce((select jsonb_agg(to_jsonb(ct)) from a1_co_contratos ct
                                     where ct.comercial_id = p_id), '[]'::jsonb));
      select concat_ws(' · ', nullif(v_retrato #>> '{origem_snapshot,participantes,0,nome}',''),
                       (select d.name from a1_developments d
                         where d.id = (v_retrato->>'empreendimento_id')::uuid),
                       nullif(v_retrato->>'unidade',''))
        into v_rotulo;
    end if;
  end if;

  -- Registro de outro cliente cai exatamente aqui, e com a MESMA frase de um
  -- id inexistente. Dizer "existe, mas não é seu" já seria contar do vizinho.
  if v_retrato is null then
    raise exception 'Não achei esse código neste cliente. Confira e cole de novo.';
  end if;

  v_impede := a1_exc_impedimento(p_modulo, p_id, v_tenant);
  if v_impede is not null then
    raise exception '%', v_impede;
  end if;

  v_filhos := a1_exc_filhos(p_modulo, p_id, v_tenant);

  -- ── A auditoria entra ANTES ───────────────────────────────────────────────
  insert into a1_exclusoes (tenant_id, modulo, registro_id, codigo, rotulo,
                            retrato, filhos, justificativa,
                            ator_id, ator_nome, ator_papel)
  values (v_tenant, p_modulo, p_id, v_codigo, nullif(v_rotulo,''),
          v_retrato, v_filhos, v_just,
          a1_usuario(),
          (select u.name from a1_users u where u.id = a1_usuario()),
          a1_papel());

  -- ── E só então some ───────────────────────────────────────────────────────
  -- As filhas são apagadas na mão mesmo tendo `on delete cascade`: o cascade
  -- existe e continua valendo como última linha de defesa, mas escrever aqui
  -- deixa à vista, para quem ler este arquivo, exatamente o que vai junto.
  if p_modulo = 'repasse' then
    delete from a1_stage_history where case_id = p_id and tenant_id = v_tenant;
    delete from a1_events         where case_id = p_id and tenant_id = v_tenant;
    delete from a1_cases          where id = p_id and tenant_id = v_tenant;

  elsif p_modulo = 'PRE_ANALISE' then
    delete from a1_pa_participantes    where pre_analise_id = p_id;
    delete from a1_pa_documentos       where pre_analise_id = p_id;
    delete from a1_pa_analises_credito where pre_analise_id = p_id;
    delete from a1_pa_eventos          where pre_analise_id = p_id;
    delete from a1_pre_analises        where id = p_id and tenant_id = v_tenant;

  else
    delete from a1_co_contratos where comercial_id = p_id;
    delete from a1_co_eventos   where comercial_id = p_id;
    delete from a1_comerciais   where id = p_id and tenant_id = v_tenant;
  end if;

  return jsonb_build_object('ok', true, 'modulo', p_modulo, 'registro_id', p_id,
                            'codigo', v_codigo, 'rotulo', v_rotulo, 'filhos', v_filhos);
end $$;

-- Toda chamada do sistema chega como anon com o token no cabeçalho; sem este
-- grant a tela não alcança a função. Quem autoriza é o corpo dela.
grant execute on function a1_excluir_procurar(text)             to anon, authenticated;
grant execute on function a1_excluir_definitivo(text, uuid, text) to anon, authenticated;

-- As internas NÃO são expostas. a1_exc_impedimento e a1_exc_filhos leem por
-- tenant recebido como PARÂMETRO — expostas, seriam uma janela para contar
-- registro do cliente vizinho: bastaria passar o tenant dele.
--
-- O revoke é de `public`, não só de anon. No Postgres toda função nasce com
-- EXECUTE para PUBLIC; revogar de anon e deixar PUBLIC de pé não revoga nada,
-- e é o engano que faz alguém achar que fechou a porta. As duas funções de
-- cima ficam alcançáveis porque o grant explícito vem depois.
revoke all on function a1_exc_licenciado(text)              from public, anon, authenticated;
revoke all on function a1_exc_filhos(text, uuid, uuid)      from public, anon, authenticated;
revoke all on function a1_exc_impedimento(text, uuid, uuid)  from public, anon, authenticated;

-- =============================================================================
-- COMO CONFERIR
--
--  1. Com sessão de GESTOR, cole um id de cartão:
--       select * from a1_excluir_procurar('<id ou os 8 primeiros caracteres>');
--     Deve vir uma linha com módulo, titular, empreendimento e situação.
--
--  2. Com sessão de CORRETOR (mesmo gestor do próprio processo), repita:
--       select * from a1_excluir_procurar('<o mesmo id>');   → 0 linhas
--       select a1_excluir_definitivo('repasse','<id>','motivo qualquer');
--     → erro "Exclusão definitiva é coisa de gestor."
--
--  3. Com sessão de gestor de OUTRO cliente, tente o mesmo id:
--     → erro "Não achei esse código neste cliente."
--
--  4. Apague de verdade um registro de teste e confira a trilha:
--       select modulo, codigo, rotulo, justificativa, ator_nome, excluido_em,
--              filhos, jsonb_pretty(retrato)
--         from a1_exclusoes order by excluido_em desc limit 5;
--
--  5. Tente apagar uma pré-análise que já virou Comercial:
--     → erro nomeando o código do Comercial que precisa sair antes.
--
--  6. A auditoria não se edita:
--       update a1_exclusoes set justificativa = 'outro';  → 0 linhas / recusa
--       delete from a1_exclusoes;                         → recusa
--
-- Tudo isso está automatizado em testes/sql/prova-seguranca.sql, rodando como
-- 'anon' com token no cabeçalho, que é como o PostgREST chega ao banco.
-- =============================================================================
