# Plano de estabilização e reestruturação do SIIMOB

**Status:** preparado; nenhuma alteração de produção foi aplicada por este plano.  
**Janela inicial:** manutenção às 09:00 (horário a confirmar).  
**Objetivo:** parar a possibilidade de ações não autorizadas, tornar as permissões previsíveis e criar a base para o SIIMOB evoluir como produto multiusuário profissional.

> A janela de manutenção serve para estabilização e validação. Uma reescrita completa durante uma única parada seria arriscada. A plataforma só volta após os bloqueios P0 terem sido testados; a evolução arquitetural segue em entregas pequenas, reversíveis e por tenant.

## Princípios inegociáveis

1. **O banco é a autoridade.** Ocultar botão nunca será a única proteção.
2. **Falha fechada.** Enquanto identidade, tenant, módulo ou permissão estiverem carregando, a ação fica bloqueada.
3. **Uma regra por decisão.** Tela, API/RPC e RLS consultam a mesma capacidade, não interpretações diferentes.
4. **Menor privilégio.** Cada papel recebe apenas a ação e o escopo necessários.
5. **Mudança reversível.** Toda migration tem plano de rollback, teste de persona e commit rastreável.
6. **Sem perda de dados.** Nenhum script de correção pode apagar ou redistribuir processos automaticamente.

## Modelo de autorização de destino

Cada decisão deve responder à mesma pergunta:

`pode(ator, capacidade, recurso, escopo)`

| Elemento | Exemplos |
|---|---|
| Ator | owner, admin, gestor, analista, corretor, correspondente, cliente |
| Capacidade | `repasse.criar`, `repasse.editar`, `pre_analise.criar`, `pre_analise.ver`, `usuario.gerir` |
| Recurso | um repasse, pré-análise, usuário, documento ou configuração |
| Escopo | próprio, empresa, equipe, tenant, plataforma |

O corretor poderá criar e ver apenas o que estiver sob sua carteira. Gestores recebem escopo de tenant/equipe explicitamente. Exceções individuais complementam o perfil de forma determinística; nunca somem por causa de `coalesce`.

## Etapa 0 — Preparação da janela

**Dono:** operador da plataforma + desenvolvimento  
**Tempo estimado:** 20–30 min

1. Colocar a plataforma em manutenção no mecanismo de hospedagem, preservando uma página estática de aviso.
2. Registrar o SHA de produção e criar uma branch de estabilização a partir dele.
3. Criar backup/PITR point no Supabase e exportar esquema, funções, políticas e grants atuais.
4. Salvar contagens de referência: usuários ativos, sessões, repasses, pré-análises, comerciais e registros.
5. Definir canal de decisão e o critério de rollback: qualquer erro de login, leitura ou criação autorizada reverte a mudança daquela etapa.
6. Não revogar sessões, grants ou aplicar migrations antes da cópia de segurança e da validação em staging.

**Aceite:** backup verificável, SHA registrado e rollback conhecido.

## Etapa 1 — Fechar o vazamento visual e de ação

**Prioridade:** P0  
**Tempo estimado:** 1–2 h  
**Risco:** baixo, se limitado a interface e guardas de ação.

Problema conhecido: em `repasse.html`, o botão **Novo Repasse** nasce visível no HTML; a permissão chega depois de chamadas assíncronas. O usuário consegue ver o botão e abrir o modal no intervalo.

1. Marcar todo elemento privilegiado com uma convenção única, por exemplo `data-capability="repasse.criar"`.
2. Ocultar e desabilitar esses elementos no HTML/CSS inicial.
3. Exibir somente depois de identidade, módulo e permissões efetivas terminarem de carregar.
4. Colocar a mesma guarda no início de cada ação: abrir modal, salvar formulário, editar, excluir, transicionar e baixar documento.
5. Substituir mutações automáticas feitas durante carregamento por ação explícita ou job administrativo auditável.
6. Testar com rede lenta (throttling): botão não pode aparecer nem por um frame.

**Aceite:** corretor sem `repasse.criar` nunca enxerga nem abre o modal; uma chamada manual à função da tela é recusada pela guarda.

## Etapa 2 — Unificar entitlement de módulos

**Prioridade:** P0  
**Tempo estimado:** 30–60 min  
**Pré-requisito:** rodar o diagnóstico de divergência por tenant.

Hoje `a1_has_module` (tela) considera plano ou liberação manual, enquanto `a1_tem_modulo` (RLS) considera apenas liberação manual. Isto cria tela e banco discordando sobre `PRE_ANALISE`.

1. Executar o SELECT de divergência em `supabase/sql/proposed/align-preanalysis-module-check.sql`.
2. Em staging, fazer `a1_tem_modulo` delegar à mesma regra canônica usada pela tela.
3. Fixar `search_path` nessas funções enquanto elas forem regravadas.
4. Testar tenant com módulo via plano, via liberação manual e sem entitlement.
5. Aplicar em produção somente após os três cenários passarem.

**Aceite:** UI e RLS dão a mesma resposta para cada módulo e tenant.

## Etapa 3 — Corrigir papéis, perfis e exceções

**Prioridade:** P0  
**Tempo estimado:** 2–4 h para a base e testes; expansão gradual depois.

1. Substituir `a1_e_gestor()` por uma lista explícita de roles autorizadas. `user` e `viewer` não podem herdar poder de gestor.
2. Definir a matriz oficial de capacidades por role. Decisões pendentes devem ser documentadas, não inferidas no código.
3. Trocar a lógica de `coalesce(perfil.permissions, parceiro.permissions)` por composição previsível: perfil-base + permissões individuais + negações explícitas, quando houver.
4. Criar uma função canônica de decisão para o banco, com saída de motivo apropriada para auditoria.
5. Invalidar/renovar sessões depois da mudança, pois a role atual está armazenada na sessão customizada.
6. Rodar o diagnóstico do corretor real e testar: permitido, negado e gestor.

**Aceite:** uma alteração de permissão se reflete em uma nova sessão do usuário e produz o mesmo resultado na tela e no banco.

## Etapa 4 — Fazer o banco bloquear ações não autorizadas

**Prioridade:** P0  
**Tempo estimado:** 1 dia de implementação/testes, por módulo.

A política atual de `a1_cases` isola tenant, mas não distingue criação de repasse, registro ou CRM. Assim, uma trava só na tela não é suficiente.

1. Mapear cada escrita direta atual em tabelas expostas.
2. Para operações de negócio, preferir RPCs específicas e auditáveis: criar repasse, editar repasse, transicionar, criar pré-análise, anexar documento.
3. Em cada RPC, validar sessão, tenant, capacidade e escopo antes de escrever.
4. Ajustar RLS por operação (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) como defesa adicional; evitar política única `FOR ALL`.
5. Restringir `a1_user_permissions`: usuário comum não pode administrar permissões de outros usuários.
6. Restringir atualização do próprio `a1_users` para campos de perfil seguros; role, tenant, situação e permissões só podem mudar por caminho administrativo protegido.
7. Não revogar grants de `anon`/ `authenticated` em lote: o SIIMOB usa sessão customizada no navegador. Migrar cada fluxo com testes antes de reduzir grants.

**Aceite:** chamada REST manual, botão reativado pelo navegador ou request forjado não criam nem alteram recurso fora da capacidade/escopo do ator.

## Etapa 5 — Endurecer funções e sessões

**Prioridade:** P1  
**Tempo estimado:** 1–2 dias com testes.

1. Corrigir as 11 funções `SECURITY DEFINER` sem `search_path` fixo.
2. Revisar todas as funções `SECURITY DEFINER` públicas: funções internas vão para schema não exposto ou perdem `EXECUTE` público.
3. Revisar `a1_indica_enviar` e `a1_indica_painel`, que expõem dados sensíveis por token/documento.
4. Definir expiração, renovação e invalidação de sessões customizadas; logout e mudança de papel devem invalidar a sessão.
5. Preparar migração futura para Supabase Auth ou backend próprio com tokens assinados. Não será feita durante a estabilização P0.

**Aceite:** não há função administrativa executável pelo público; alteração de papel invalida acesso anterior.

## Etapa 6 — Fluxo de negócio e dados canônicos

**Prioridade:** P1  
**Tempo estimado:** incremental, por domínio.

Fluxo alvo:

`Lead → Interesse/unidade → Oportunidade → Proposta/reserva → Contrato → Pré-análise → Comercial → Repasse → Registro → Pós-venda`

1. Formalizar IDs e relações entre as entidades; o processo não pode depender só de campos de texto em `a1_cases`.
2. Manter `a1_cases` como compatibilidade temporária, mas criar/usar tabelas específicas para cada domínio.
3. Cada transição terá origem, destino, ator, data, versão e justificativa.
4. Aplicar visibilidade por carteira: próprio, empresa, equipe ou tenant.
5. Criar trilha de auditoria para criação, alteração de responsável, transição, documento e decisão de crédito.
6. Migrar primeiro Pré-análises e Repasse, pois já possuem estruturas específicas e são os pontos de autorização mais sensíveis.

**Aceite:** é possível responder “quem criou, quem alterou, por que mudou e quem pode ver” para qualquer processo.

## Etapa 7 — Arquitetura de aplicação profissional

**Prioridade:** P1  
**Tempo estimado:** 2–6 semanas, sem big bang.

1. Extrair o código repetido de HTML para módulos ES/TypeScript: autenticação, cliente API, navegação, permissões, notificações e componentes de formulário.
2. Organizar por domínio: `crm/`, `pre-analises/`, `comercial/`, `repasse/`, `registro/`, `admin/`.
3. Criar um único cliente de dados; páginas não fazem `fetch` livre para tabelas operacionais.
4. Migrar gradualmente para React + TypeScript + Vite, começando por uma área nova ou por Pré-análises. As páginas atuais permanecem estáveis durante a transição.
5. Introduzir contratos de API, validação de entrada e erros padronizados.
6. Adicionar documentação de execução, variáveis de ambiente, decisões arquiteturais e convenção de migrations.

**Aceite:** uma nova regra de permissão é implementada uma vez no módulo de autorização e consumida por todas as telas.

## Etapa 8 — Testes, observabilidade e implantação segura

**Prioridade:** P1 contínua

1. Criar matriz de personas: owner, admin, gestor, analista, corretor permitido, corretor negado, correspondente e cliente.
2. Para cada capacidade, testar permitir e negar em UI, RPC e RLS.
3. Adicionar testes SQL de políticas e testes de fluxo no navegador.
4. Registrar decisões de acesso em modo sombra antes de endurecer políticas antigas.
5. Ativar mudanças por feature flag e tenant-piloto.
6. Monitorar erros de autorização, latência, tentativas negadas e mutações por ator.
7. Só expandir após um período sem regressões no tenant-piloto.

**Aceite:** cada correção possui evidência de teste e pode ser desligada sem rollback de dados.

## Ordem da manutenção das 09:00

1. Etapa 0: backup e freeze.
2. Confirmar, no corretor real, role, perfil, permissão efetiva e entitlement de `PRE_ANALISE`.
3. Etapa 1: eliminar flashes e guardas de interface do Repasse.
4. Etapa 2: alinhar regra de módulo em staging e produção, se os testes passarem.
5. Etapa 3: corrigir a lógica de permissão do corretor e renovar sessão.
6. Etapa 4: bloquear no banco pelo menos **criar repasse** e **criar pré-análise**.
7. Testar a matriz mínima de personas.
8. Reabrir a plataforma apenas quando os testes críticos passarem.
9. Deixar Etapas 5–8 em entregas controladas, não durante a mesma parada.

## Critérios para reabrir a plataforma

- Login funciona para owner, gestor e corretor.
- Corretor sem permissão não vê, não abre e não cria repasse/pré-análise.
- Corretor autorizado cria apenas dentro de sua carteira.
- Gestor mantém a visão e as ações esperadas.
- Tenant sem módulo é bloqueado em tela e banco.
- Nenhuma alteração automática inesperada foi executada nos dados.
- Backup e SHA de rollback continuam disponíveis.

## Materiais já preparados

- `docs/access-foundation.md`: contrato de acesso e escopos.
- `docs/access-audit-2026-09-10.md`: achados da auditoria.
- `supabase/sql/access-audit.sql`: auditoria somente leitura.
- `supabase/sql/diagnose-broker-preanalysis-access.sql`: diagnóstico por corretor.
- `supabase/sql/proposed/align-preanalysis-module-check.sql`: proposta de alinhamento de módulo; ainda não aplicada.
