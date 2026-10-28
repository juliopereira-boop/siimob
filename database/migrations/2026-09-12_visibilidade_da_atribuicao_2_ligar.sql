-- =============================================================================
-- QUEM RECEBE A ATRIBUIÇÃO PRECISA ENXERGAR — parte 2 de 2: LIGAR
--
-- NÃO RODE ESTE ARQUIVO ANTES DE LER O RELATÓRIO DA PARTE 1
-- (sql/2026-09-12_visibilidade_da_atribuicao_1_conferir.sql).
--
-- O QUE ESTE ARQUIVO FAZ
-- Troca, em dezesseis políticas e quatro funções do orquestrador, a chamada de
-- dois argumentos pela de quatro. Nada mais. Cada linha alterada é a MESMA
-- expressão de hoje com `analista_id` e `correspondente_id` somados à chamada:
--
--     a1_pa_visivel(corretor_id, empresa_id)
--  →  a1_pa_visivel(corretor_id, empresa_id, analista_id, correspondente_id)
--
-- A regra em si já foi criada na parte 1 e está lá para ser lida. Aqui só se
-- liga o fio.
--
-- DEPOIS DISTO, o analista a quem uma pré-análise for atribuída:
--   · a vê na fila (a1_pre_analises_ler);
--   · abre o dossiê inteiro — participantes, documentos, decisões de crédito,
--     histórico e a pessoa do titular (as políticas das cinco filhas);
--   · consegue editar e mover na esteira, se tiver pa_editar
--     (a1_pre_analises_editar e a1_pa_transicionar).
-- Sem as filhas, o processo apareceria na fila e abriria vazio — que é pior que
-- não aparecer, porque parece defeito de dado.
--
-- O QUE **NÃO** MUDA
--  · Ninguém perde acesso: a regra nova só acrescenta ramos que respondem
--    "sim" (ver a garantia na parte 1). Corretor que enxerga a própria carteira
--    continua enxergando exatamente a mesma carteira.
--  · O isolamento por cliente continua na frente de tudo: toda política
--    começa por `tenant_id = a1_tenant()`, e atribuir alguém de outro cliente
--    não abre nada.
--  · As chaves continuam as mesmas (pa_ver / pa_criar / pa_editar / co_ver /
--    co_editar / analisar_credito). Nenhuma permissão foi acrescentada, tirada
--    ou trocada por outra.
--  · O REPASSE não é tocado. a1_cases continua decidindo por NOME
--    (a1_case_visivel, broker_name/manager_name/usuario_correspondente). As
--    colunas por id nasceram vazias lá, e ligar a visibilidade do Repasse nelas
--    esconderia os 330 processos de produção de todo mundo no mesmo instante.
--    Isso é outro arquivo, para quando houver id preenchido.
--  · Nenhuma linha de dado é alterada.
--
-- COMO VOLTAR ATRÁS: rode de novo, nesta ordem,
--   sql/2026-09-08_perfis_de_acesso.sql
--   sql/2026-09-09_documento_obrigatorio.sql
--   sql/2026-09-11_quem_cadastra_pessoa_rele.sql
--   sql/2026-09-10_chaves_dos_modulos.sql
-- que são os donos atuais destas dezesseis políticas e destas quatro funções.
-- Tudo volta a chamar a versão de dois argumentos, que continua existindo.
--
-- ORDEM: depois da parte 1 (que cria a função de quatro argumentos) e de
-- sql/2026-09-11_partes_por_id.sql (que cria as colunas). Pode rodar de novo
-- sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- =============================================================================
-- PRÉ-ANÁLISE
-- =============================================================================

drop policy if exists a1_pre_analises_ler on a1_pre_analises;
create policy a1_pre_analises_ler on a1_pre_analises for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_perm('pa_ver')
         and a1_pa_visivel(corretor_id, empresa_id, analista_id, correspondente_id));

drop policy if exists a1_pre_analises_editar on a1_pre_analises;
create policy a1_pre_analises_editar on a1_pre_analises for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_pa_visivel(corretor_id, empresa_id, analista_id, correspondente_id)
         and a1_perm('pa_editar'))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));

-- ─── As filhas ───────────────────────────────────────────────────────────────
-- Todas com a mesma forma: a linha filha é visível se a MÃE for. Trocar só a
-- mãe deixaria o dossiê do analista abrindo vazio.

drop policy if exists a1_pa_participantes_ler on a1_pa_participantes;
create policy a1_pa_participantes_ler on a1_pa_participantes for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and exists (select 1 from a1_pre_analises pa
                      where pa.id = a1_pa_participantes.pre_analise_id
                        and a1_pa_visivel(pa.corretor_id, pa.empresa_id,
                                          pa.analista_id, pa.correspondente_id)));

-- Continua `for all` como está hoje: quem aperta o INSERT desta tabela é
-- sql/2026-09-12_escrita_no_dossie.sql, e misturar as duas mudanças num arquivo
-- só faria a volta atrás de uma exigir desfazer a outra.
drop policy if exists a1_pa_participantes_escrever on a1_pa_participantes;
create policy a1_pa_participantes_escrever on a1_pa_participantes for all
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_perm('pa_editar')
         and exists (select 1 from a1_pre_analises pa
                      where pa.id = a1_pa_participantes.pre_analise_id
                        and a1_pa_visivel(pa.corretor_id, pa.empresa_id,
                                          pa.analista_id, pa.correspondente_id)))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));

drop policy if exists a1_pa_documentos_ler on a1_pa_documentos;
create policy a1_pa_documentos_ler on a1_pa_documentos for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and exists (select 1 from a1_pre_analises pa
                      where pa.id = a1_pa_documentos.pre_analise_id
                        and a1_pa_visivel(pa.corretor_id, pa.empresa_id,
                                          pa.analista_id, pa.correspondente_id)));

drop policy if exists a1_pa_documentos_escrever on a1_pa_documentos;
create policy a1_pa_documentos_escrever on a1_pa_documentos for all
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_perm('pa_editar')
         and exists (select 1 from a1_pre_analises pa
                      where pa.id = a1_pa_documentos.pre_analise_id
                        and a1_pa_visivel(pa.corretor_id, pa.empresa_id,
                                          pa.analista_id, pa.correspondente_id)))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));

drop policy if exists a1_pa_analises_credito_ler on a1_pa_analises_credito;
create policy a1_pa_analises_credito_ler on a1_pa_analises_credito for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and exists (select 1 from a1_pre_analises pa
                      where pa.id = a1_pa_analises_credito.pre_analise_id
                        and a1_pa_visivel(pa.corretor_id, pa.empresa_id,
                                          pa.analista_id, pa.correspondente_id)));

-- A chave continua sendo analisar_credito, e continua no `with check`: quem
-- vende não aprova, e isso não tem nada a ver com atribuição.
drop policy if exists a1_pa_analises_credito_escrever on a1_pa_analises_credito;
create policy a1_pa_analises_credito_escrever on a1_pa_analises_credito for all
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_perm('analisar_credito')
         and exists (select 1 from a1_pre_analises pa
                      where pa.id = a1_pa_analises_credito.pre_analise_id
                        and a1_pa_visivel(pa.corretor_id, pa.empresa_id,
                                          pa.analista_id, pa.correspondente_id)))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
              and a1_perm('analisar_credito'));

drop policy if exists a1_pa_eventos_ler on a1_pa_eventos;
create policy a1_pa_eventos_ler on a1_pa_eventos for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and exists (select 1 from a1_pre_analises pa
                      where pa.id = a1_pa_eventos.pre_analise_id
                        and a1_pa_visivel(pa.corretor_id, pa.empresa_id,
                                          pa.analista_id, pa.correspondente_id)));

-- ─── A agenda de pessoas ─────────────────────────────────────────────────────
-- a1_pa_pessoas é cadastro COMPARTILHADO, e já teve a agenda inteira do cliente
-- aberta uma vez por uma política `for all` (a lição está em
-- testes/sql/LEIA-ME.md). A forma fica palavra por palavra como está em
-- sql/2026-09-11_quem_cadastra_pessoa_rele.sql; só a chamada de visibilidade
-- muda. O analista designado passa a ler a pessoa do processo que recebeu —
-- que é o nome do cliente na fila dele, sem o qual o dossiê não tem título.
drop policy if exists a1_pa_pessoas_ler on a1_pa_pessoas;
create policy a1_pa_pessoas_ler on a1_pa_pessoas for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and (a1_e_gestor()
           or a1_perm('gerente')
           or (criado_por is not null and criado_por = a1_ator())
           or exists (select 1
                        from a1_pa_participantes pp
                        join a1_pre_analises pa on pa.id = pp.pre_analise_id
                       where pp.pessoa_id = a1_pa_pessoas.id
                         and a1_pa_visivel(pa.corretor_id, pa.empresa_id,
                                           pa.analista_id, pa.correspondente_id))));

drop policy if exists a1_pa_pessoas_editar on a1_pa_pessoas;
create policy a1_pa_pessoas_editar on a1_pa_pessoas for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_perm('pa_criar')
         and (a1_e_gestor()
           or a1_perm('gerente')
           or exists (select 1
                        from a1_pa_participantes pp
                        join a1_pre_analises pa on pa.id = pp.pre_analise_id
                       where pp.pessoa_id = a1_pa_pessoas.id
                         and a1_pa_visivel(pa.corretor_id, pa.empresa_id,
                                           pa.analista_id, pa.correspondente_id))))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));

-- =============================================================================
-- COMERCIAL
-- =============================================================================

drop policy if exists a1_comerciais_ler on a1_comerciais;
create policy a1_comerciais_ler on a1_comerciais for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and a1_perm('co_ver')
         and a1_co_visivel(corretor_id, empresa_id, analista_id, correspondente_id));

drop policy if exists a1_comerciais_editar on a1_comerciais;
create policy a1_comerciais_editar on a1_comerciais for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and a1_co_visivel(corretor_id, empresa_id, analista_id, correspondente_id)
         and a1_perm('co_editar'))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL'));

drop policy if exists a1_co_contratos_ler on a1_co_contratos;
create policy a1_co_contratos_ler on a1_co_contratos for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and exists (select 1 from a1_comerciais c
                      where c.id = a1_co_contratos.comercial_id
                        and a1_co_visivel(c.corretor_id, c.empresa_id,
                                          c.analista_id, c.correspondente_id)));

drop policy if exists a1_co_contratos_escrever on a1_co_contratos;
create policy a1_co_contratos_escrever on a1_co_contratos for all
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and a1_perm('co_editar')
         and exists (select 1 from a1_comerciais c
                      where c.id = a1_co_contratos.comercial_id
                        and a1_co_visivel(c.corretor_id, c.empresa_id,
                                          c.analista_id, c.correspondente_id)))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL'));

drop policy if exists a1_co_eventos_ler on a1_co_eventos;
create policy a1_co_eventos_ler on a1_co_eventos for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and exists (select 1 from a1_comerciais c
                      where c.id = a1_co_eventos.comercial_id
                        and a1_co_visivel(c.corretor_id, c.empresa_id,
                                          c.analista_id, c.correspondente_id)));

-- =============================================================================
-- O ORQUESTRADOR
--
-- As quatro funções da esteira conferem a visibilidade ANTES de mover o
-- processo, e é essa conferência que devolve 'sem_acesso'. Sem trocá-las, o
-- analista designado veria o processo na fila e não conseguiria movê-lo — a
-- metade mais irritante do defeito.
--
-- Vêm INTEIRAS porque `create or replace` substitui o corpo todo; a
-- alternativa seria um patch de texto, que ninguém consegue revisar. Cada uma é
-- cópia exata da versão em vigor (a1_pa_transicionar de
-- sql/2026-09-09_documento_obrigatorio.sql; as outras três de
-- sql/2026-09-10_chaves_dos_modulos.sql) com UMA linha diferente: a da
-- visibilidade.
-- =============================================================================

