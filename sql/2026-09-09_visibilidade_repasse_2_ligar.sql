-- =============================================================================
-- VISIBILIDADE NO REPASSE — parte 2 de 2: LIGAR A POLÍTICA
--
-- NÃO RODE ESTE ARQUIVO ANTES DE LER O RELATÓRIO DA PARTE 1.
--
-- Aqui a1_cases deixa de entregar a carteira inteira do cliente para qualquer
-- pessoa dele. A partir daqui vale, no BANCO, a mesma regra que a tela já
-- aplicava: gestor e gerente veem tudo; quem tem visão completa marcada vê
-- tudo; os demais veem o que está no nome deles, mais o que os colegas da
-- empresa compartilharam.
--
-- O QUE PODE DAR ERRADO, E É POR ISSO QUE SÃO DOIS ARQUIVOS
-- Quem hoje enxerga a carteira por OMISSÃO (sem a chave ver_todos_analistas no
-- cadastro) continua enxergando — a função espelha a tela de propósito, para
-- não haver tela e API discordando. Ou seja: esta política fecha a porta da API
-- para quem já estava fechado na tela, e NÃO fecha para quem estava aberto por
-- omissão. Fechar esses é decisão de cadastro, não de código: é marcar
-- "Visão completa" como desligada em Configurações › Corretores, pessoa por
-- pessoa, ou pelo UPDATE do fim deste arquivo — que muda dado de cliente e por
-- isso está comentado.
--
-- Escrever continua como estava: a política ALL antiga vira uma de SELECT, com
-- a regra, mais três de escrita (insert/update/delete) só por cliente. Assim
-- ninguém fica sem conseguir criar ou salvar processo por causa desta mudança.
--
-- COMO VOLTAR ATRÁS, se algo ficar estranho em produção:
--
--   drop policy if exists a1_cases_ler on a1_cases;
--   drop policy if exists a1_cases_criar on a1_cases;
--   drop policy if exists a1_cases_editar on a1_cases;
--   drop policy if exists a1_cases_apagar on a1_cases;
--   create policy cases_tenant_isolation on a1_cases
--     for all using (tenant_id = a1_tenant()) with check (tenant_id = a1_tenant());
--
-- Isso devolve exatamente o comportamento de antes, em uma linha.
-- =============================================================================

-- A política antiga fazia tudo numa só. Separar é o padrão dos módulos novos:
-- ler tem uma regra, escrever tem outra, e cada uma fica legível sozinha.
drop policy if exists cases_tenant_isolation on a1_cases;

drop policy if exists a1_cases_ler on a1_cases;
create policy a1_cases_ler on a1_cases
  for select using (
    tenant_id = a1_tenant()
    and a1_case_visivel(broker_name, manager_name, payload->>'usuario_correspondente')
  );

-- Escrever continua exigindo só o cliente, como antes. Quem cria um processo
-- ainda não é dono de nada, e exigir vínculo na hora do INSERT impediria o
-- cadastro de nascer. A trava de EDIÇÃO por dono já existe na tela
-- (podeEditarProcesso / liberarEdicao) e não muda aqui.
--
-- E são TRÊS políticas, uma por comando, nunca um `for all`: política `for all`
-- vale também para SELECT, e as políticas se somam por OU — uma única política
-- de escrita declarada como `for all` devolveria a leitura inteira e anularia
-- a de cima em silêncio. Foi o primeiro jeito que este arquivo teve, e quem
-- pegou foi a prova de segurança, não a revisão.
drop policy if exists a1_cases_escrever on a1_cases;
drop policy if exists a1_cases_criar on a1_cases;
create policy a1_cases_criar on a1_cases
  for insert with check (tenant_id = a1_tenant());

drop policy if exists a1_cases_editar on a1_cases;
create policy a1_cases_editar on a1_cases
  for update using (tenant_id = a1_tenant())
         with check (tenant_id = a1_tenant());

drop policy if exists a1_cases_apagar on a1_cases;
create policy a1_cases_apagar on a1_cases
  for delete using (tenant_id = a1_tenant());

-- =============================================================================
-- COMO CONFERIR, logo depois de rodar
--
-- 1. As quatro políticas no lugar da antiga (uma de leitura, três de escrita):
--
--    select policyname, cmd from pg_policies
--     where tablename = 'a1_cases' order by policyname;
--
-- 2. O gestor continua vendo tudo. Entre como gestor de um cliente e compare
--    com a contagem total daquele cliente:
--
--    select count(*) from a1_cases;   -- na sessão do gestor
--
-- 3. Um corretor com "Visão completa" DESLIGADA passa a ver só o que é dele.
--    Se ele passar a ver zero e isso for errado, o processo dele está gravado
--    com outro nome — corrija o cadastro do processo, não a política.
--
-- =============================================================================
-- OPCIONAL, E MUDA DADO DE CLIENTE — não rode sem querer.
--
-- Torna explícito o que hoje é omissão: todo corretor ativo sem a chave passa a
-- ter "Visão completa" DESLIGADA. É o que fecha de verdade a porta para os
-- cadastros antigos. Faça isso com a lista da parte 1 na mão, cliente por
-- cliente, e nunca em todos de uma vez.
--
--   update a1_partners
--      set permissions = coalesce(permissions,'{}'::jsonb)
--                        || '{"ver_todos_analistas": false}'::jsonb
--    where tenant_id = 'COLE-AQUI-O-ID-DO-CLIENTE'
--      and type = 'corretor'
--      and is_active
--      and not (permissions ? 'ver_todos_analistas');
--
-- Para conferir antes, troque o update por:
--
--   select id, name from a1_partners
--    where tenant_id = 'COLE-AQUI-O-ID-DO-CLIENTE'
--      and type = 'corretor' and is_active
--      and not (permissions ? 'ver_todos_analistas');
-- =============================================================================
