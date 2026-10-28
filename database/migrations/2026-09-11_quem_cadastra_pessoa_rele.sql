-- =============================================================================
-- QUEM CADASTRA A PESSOA PRECISA CONSEGUIR RELÊ-LA
--
-- O DEFEITO, relatado em produção: corretor com "Criar pré-análise" marcada
-- recebia 401 ao criar a pré-análise, em POST /rest/v1/a1_pa_pessoas. A tela
-- dizia que faltava a permissão pa_criar. NÃO FALTAVA. Medido na sessão real
-- dele, dentro da mesma transação:
--
--     a1_tenant() ..... 02b14b09-…      (certo)
--     a1_ator() ....... 7389fc63-…      (certo, é o parceiro dele)
--     a1_perm('pa_criar') ......... t
--     a1_tem_modulo('PRE_ANALISE')  t
--     with_check da política, à mão   true
--     INSERT .......................... RECUSADO
--
-- O que estava acontecendo:
--
--     INSERT sem RETURNING .................................. PASSA
--     reler a linha recém-criada ............................ NÃO
--     INSERT com RETURNING (o que o PostgREST faz) .......... FALHA
--
-- A política de INSERT sempre aceitou. Quem recusava era a de SELECT, no
-- RETURNING: o PostgREST manda `Prefer: return=representation` e precisa
-- devolver a linha gravada, e o Postgres aplica a política de leitura nesse
-- retorno. Recusada a leitura, o INSERT inteiro cai — e o erro que chega ao
-- navegador é um 401 seco, que parece falta de permissão e não é.
--
-- POR QUE A LEITURA RECUSAVA. a1_pa_pessoas_ler exige que a pessoa esteja
-- ligada a um participante de uma pré-análise que o ator enxerga. No assistente
-- a ordem é: cria a PESSOA → cria a PRÉ-ANÁLISE → liga as duas no PARTICIPANTE.
-- No instante do primeiro passo esse vínculo ainda não existe, e não existe
-- para ninguém: a linha nasce órfã por um instante, e quem acabou de criá-la é
-- justamente quem não consegue vê-la.
--
-- Gestor nunca esbarrou nisso porque a política de leitura começa com
-- a1_e_gestor(). Por isso o defeito só aparecia para corretor — e por isso
-- passou despercebido em todo teste feito como gestor.
--
-- A CORREÇÃO: quem criou a linha lê a linha. A tabela já guarda criado_por.
--
-- E POR QUE ISSO NÃO REABRE A AGENDA. O motivo de a1_pa_pessoas ter leitura
-- restrita é real e continua valendo: sem ela, qualquer corretor com permissão
-- de criar puxava nome, CPF, telefone e endereço de TODA a carteira do cliente
-- (foi um `for all` que causou isso, e está registrado em 2026-09-04). A regra
-- nova devolve a cada um apenas as pessoas que ELE MESMO cadastrou — não a
-- carteira alheia, não a agenda inteira. É o mínimo para o assistente
-- funcionar, e nada além.
--
-- O QUE NÃO MUDA
--   · a1_pa_pessoas_criar e a1_pa_pessoas_editar ficam como estão.
--   · Nenhuma outra tabela é tocada. Conferido uma a uma: a1_pre_analises
--     (o gatilho grava corretor_id = a1_ator(), então o criador relê),
--     a1_pa_participantes e a1_pa_documentos (a pré-análise já existe e já é
--     visível quando eles nascem). Só a1_pa_pessoas tinha o vão, porque só ela
--     nasce ANTES do vínculo que a torna visível.
--
-- ORDEM: depois de 2026-09-04_pre_analise.sql. Independente dos demais. Pode
-- rodar de novo sem problema.
-- =============================================================================

-- ─── Primeiro: alguém tem de PREENCHER criado_por ────────────────────────────
-- A coluna existe desde 2026-09-04 e nasce nula: nenhum gatilho a preenchia, e
-- a tela não a manda. Uma regra de leitura apoiada nela seria decorativa — foi
-- exatamente o que aconteceu na primeira tentativa desta correção, que não
-- destravou nada porque criado_por vinha null e `null = a1_ator()` é null.
--
-- Vai no banco, e não na tela, porque a tela não é o caminho único: o mesmo
-- POST feito direto na API tem de gravar a autoria do mesmo jeito. E é
-- forçado, não um default: quem manda o campo no corpo da requisição não
-- escolhe assinar em nome de outro.
create or replace function a1_pa_pessoas_guarda_insert()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if a1_tenant() is not null then new.tenant_id := a1_tenant(); end if;
  if a1_ator() is not null then new.criado_por := a1_ator(); end if;
  return new;
end $$;

drop trigger if exists trg_pa_pessoas_guarda_ins on a1_pa_pessoas;
create trigger trg_pa_pessoas_guarda_ins before insert on a1_pa_pessoas
  for each row execute function a1_pa_pessoas_guarda_insert();

-- ─── E então a leitura ───────────────────────────────────────────────────────
drop policy if exists a1_pa_pessoas_ler on a1_pa_pessoas;
create policy a1_pa_pessoas_ler on a1_pa_pessoas for select
  using (
    tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
    and (
      a1_e_gestor()
      or a1_perm('gerente')
      -- Quem cadastrou lê o que cadastrou. É esta linha que faz o assistente
      -- funcionar para corretor: sem ela, o RETURNING do primeiro passo é
      -- recusado e o cadastro inteiro morre com um 401 enganoso.
      or (criado_por is not null and criado_por = a1_ator())
      or exists (select 1 from a1_pa_participantes pp
                   join a1_pre_analises pa on pa.id = pp.pre_analise_id
                  where pp.pessoa_id = a1_pa_pessoas.id
                    and a1_pa_visivel(pa.corretor_id, pa.empresa_id)))
  );

-- =============================================================================
-- COMO CONFERIR
--
-- Com a sessão de um CORRETOR que tenha pa_criar (o caminho que estava quebrado):
--
--   insert into a1_pa_pessoas (tenant_id, tipo, nome, documento)
--   values (a1_tenant(), 'PF', 'Fulano de Teste', '00000000191')
--   returning id;                      -- antes: recusado; agora: devolve o id
--
-- E o que NÃO pode voltar: a agenda alheia. Com a mesma sessão,
--
--   select count(*) from a1_pa_pessoas;
--
-- tem de contar apenas as pessoas que esse corretor cadastrou, mais as dos
-- processos que ele já enxerga — nunca a carteira inteira do cliente.
-- =============================================================================
