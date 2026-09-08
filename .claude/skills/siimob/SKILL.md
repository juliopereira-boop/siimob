---
name: siimob
description: Como trabalhar no SIIMOB — o sistema de repasse imobiliário deste repositório. Arquitetura, o modelo de segurança no banco, as armadilhas que já custaram sangue, como testar e como entregar. Use sempre que for ler, alterar, revisar ou depurar qualquer parte deste sistema, e antes de escrever SQL, mexer em permissão, licença de módulo ou qualquer coisa que chegue a cliente em produção.
---

# SIIMOB — o que um dev sênior daqui precisa saber

Sistema multi-inquilino de **repasse imobiliário** para construtoras,
correspondentes bancários e imobiliárias no Brasil. **Está em produção com
clientes reais usando agora** (THE CRED, S T Empreendimentos, Demonstração
Correspondente). Tudo aqui é escrito em **português do Brasil** — código,
comentários, mensagens de commit e conversa com o dono.

## As regras que não se quebram

Vieram do dono, repetidas, e valem acima de qualquer conveniência técnica:

1. **Não se mexe em dado de cliente em produção.** Nem para "corrigir".
2. **Nunca, em hipótese alguma, dado de um cliente aparece no painel de outro.**
   É o isolamento por `tenant_id`, e ele é verificado no banco, não na tela.
3. **Um login é de uma pessoa só.** Sessão única por usuário, com teto de
   simultâneos por plano. Compartilhar login é proibido por design.
4. **Módulo novo nasce desligado para todo mundo.** Quem liga é o superadmin,
   cliente por cliente. Um módulo que apareça sozinho para alguém é bug grave.
5. **Todo cadastro tem de refletir nos filtros.** Cadastrou coordenador, ele
   aparece no filtro do dashboard, da listagem e do relatório. Essa dependência
   já quebrou antes e é conferida por teste.
6. **Não invente escopo.** Se a tarefa é o módulo novo, o Repasse em produção
   não é tocado.

Antes de qualquer alteração que chegue a produção, a pergunta é: *se isto
estiver errado, quem é o cliente que descobre, e como?*

## Arquitetura em uma tela

- **HTML/JS estático. Sem build, sem bundler, sem servidor de aplicação, sem
  worker.** Cada página é um `.html` na raiz com o CSS e o JS embutidos.
  Editar o arquivo é publicar; não existe passo de compilação.
- **Banco: Supabase (Postgres + PostgREST + RLS + Storage).** O navegador fala
  direto com a API REST usando a chave `anon` pública e um cabeçalho
  `x-session-token`. **Toda a autorização real é RLS.** O que a tela esconde é
  conveniência; o que protege é a política.
- **Hospedagem: Vercel, servindo a branch `main`.** As rotas bonitas
  (`/:slug/repasse`) são `rewrites` em `vercel.json`.
- **Autenticação é própria**, não é o Auth do Supabase: `a1_login` /
  `a1_partner_login` gravam uma linha em `a1_sessions` e devolvem o token.

```
navegador → PostgREST (chave anon + x-session-token) → RLS → dados
                                      ↑
                        a1_tenant() lê o cabeçalho e diz de que cliente é a sessão
```

### Mapa dos arquivos

| Caminho | Papel |
|---|---|
| `js/config.js` | `A1` — `rest()`, `rpc()`, `headers()`, `upsertHeaders()`, `returnHeaders()`, `buscarTudo()`. Toda chamada passa por aqui. |
| `js/auth.js` | Login, sessão, `a1RequireAuth`, `a1RefreshPartnerPerms`, `a1HasModule`, heartbeat, teto de simultâneos. |
| `js/permissoes.js` | **O catálogo de permissões.** Fonte única do que existe e em que módulo vive. |
| `js/modulo-shell.js` | Cabeçalho e abas comuns aos módulos: `a1MontarShell`, `A1_ORDEM_PAINEIS`, `a1VistaDaURL`. |
| `js/paineis.js` | Dashboards de Pré-análise e Comercial. |
| `repasse.html` / `andamento.html` / `listagem.html` | Dashboard, quadro (kanban) e listagem do Repasse. **São três cópias com muito código repetido** — ver Dívidas. |
| `pre-analise.html` / `comercial.html` | Módulos novos (fila com SLA, assistente, dossiê). |
| `configuracoes.html` | O hub de configurações. **Tudo que configura o sistema mora aqui.** |
| `workflow.html` | Editor de esteira em quadro, com um botão por módulo licenciado. |
| `superadmin.html` | Painel do dono: clientes, planos, licenças de módulo, monitor de acessos, "Acessar como". |
| `sql/` | Migrações, uma por assunto, nomeadas `AAAA-MM-DD_assunto.sql`. |
| `testes/` | Suíte de navegador (Playwright) + `testes/sql/` (provas contra um Postgres descartável). |

## O modelo de segurança no banco

Estas funções são a base de tudo. Estão em `sql/2026-09-04_identidade.sql`,
são `security definer` com `search_path` fixo, e são executáveis por `anon`
(porque toda chamada do sistema chega como `anon` com o token no cabeçalho).

| Função | Responde |
|---|---|
| `a1_sessao()` | A linha de `a1_sessions` de quem está chamando (já filtrando expiração). |
| `a1_tenant()` | De que cliente é a sessão. É o alicerce do isolamento. |
| `a1_ator()` | **Quem é a pessoa** — id de `a1_partners` quando é parceiro. |
| `a1_usuario()` | O `user_id` cru da sessão (auditoria, monitor). |
| `a1_papel()` | `owner` \| `admin` \| `partner` \| null. |
| `a1_e_gestor()` | Qualquer papel que não seja `partner`. |
| `a1_tipo_ator()` | `cca` \| `corretor` \| `analista` \| `despachante` \| `coordenador`. |
| `a1_perm(chave)` | Se a pessoa tem aquela permissão — resolvendo pelo perfil. |
| `a1_tem_modulo(chave)` | Se o cliente tem a licença **e ela não venceu**. |
| `a1_no_orquestrador()` | Se a transação veio da esteira ou de um PATCH direto. |

### A armadilha nº 1 do sistema: o usuário-sombra

**`a1_partner_login` não guarda o id do parceiro na sessão.** Ele cria (ou
reusa) um "usuário-sombra" em `a1_users` com o mesmo CPF do parceiro e guarda o
id **desse** usuário em `a1_sessions.user_id` — que tem chave estrangeira para
`a1_users`.

Consequências que já morderam:

- `a1_ator()` precisa **atravessar pelo CPF** para chegar ao `a1_partners.id`.
  A primeira versão comparava direto e falhava fechado: corretor nenhum
  enxergaria a própria carteira.
- Criar sessão para um parceiro com o id dele dá **409 Conflict** (violação de
  FK). Quem cria sessão em nome de alguém — o "Acessar" do superadmin — tem de
  resolver ou criar o sombra primeiro.
- Os sombras aparecem em `a1_users` com `role='partner'`. Listas de usuários
  precisam filtrá-los, e **excluir um sombra arrebenta o login do parceiro**.

Se algo em torno de sessão, permissão ou identidade estiver estranho, **suspeite
disto primeiro.**

### Padrões de política de RLS que valem aqui

- Uma política `for all` numa tabela de cadastro **vaza a agenda inteira do
  cliente**. Já aconteceu com `a1_pa_pessoas`. Separe em `_ler`, `_criar`,
  `_editar`, cada uma com a permissão certa.
- Toda política dos módulos novos combina **três** condições:
  `tenant_id = a1_tenant()` **e** `a1_tem_modulo('X')` **e** `a1_perm('chave')`
  — e, quando o registro é de alguém, a visibilidade (`a1_pa_visivel`,
  `a1_co_visivel`).
- `a1_perm` compara **texto**, não faz cast para boolean. Um valor esquisito
  gravado por tela antiga (`"sim"`, `""`) derrubaria a consulta inteira dentro
  de uma política, em vez de negar a linha. Texto desconhecido vira "não pode".
- Coluna de poder (`role`, `permissions`, `perfil_id`, `is_active`, `approved`)
  só muda por gestor. Isso é imposto por gatilho
  (`a1_partners_trava_poder`), não por tela.

## O orquestrador mora no Postgres

**Não existe worker.** A esteira dos módulos novos é executada dentro do banco:
`a1_pa_transicionar`, `a1_co_transicionar`, `a1_pa_executar_acao`,
`a1_co_executar_acao`. Cada uma valida a transição, grava o histórico e cria o
registro do módulo de destino **na mesma transação**.

Regras do padrão:

- **Idempotência**: `pg_advisory_xact_lock` + **reler o estado depois de pegar o
  lock** + índice único parcial como última linha de defesa. Ler antes do lock
  não protege de nada.
- **Versão esperada**: a tela manda `p_versao_esperada`; se outra pessoa moveu
  o processo no meio, a chamada falha em vez de escrever por cima.
- **A esteira não se move por edição direta.** Gatilhos de proteção recusam
  PATCH em `situacao_id`; eles se distinguem do orquestrador por
  `set_config('a1.orquestrador','1',true)`, que o navegador não tem como ligar.
- Ação entre módulos (uma pré-análise aprovada virando Comercial) registra o
  resultado em `a1_integra_eventos`, visível em Configurações › Registro de
  integrações. É lá que está escrito **por que** algo não passou.

## Licença de módulo

Ligada por cliente no superadmin, em `a1_tenant_modules` (com `expires_at`
opcional). Duas portas, e as duas importam:

- **No banco**: `a1_tem_modulo()` dentro de cada política. Sem licença a tabela
  devolve lista vazia.
- **Na tela**: `a1HasModule()`. **Sem licença o elemento não pode nem existir no
  DOM** — nada de nascer escondido. O que não está no DOM ninguém acha com a
  busca do hub nem com o inspetor. Em `configuracoes.html` os cartões e
  sub-telas dos módulos novos são montados por JS (`cfgModsCartao`,
  `cfgModsVista`, `cfgModsLiberar`) só depois de `a1HasModule` responder
  exatamente `true`.
- `a1HasModule` devolve `null` quando o servidor não respondeu. **"Não consegui
  perguntar" não pode virar "não tem"** — por isso os testes de `ok !== true`
  são literais.

Quando um módulo é licenciado, **as configurações dele aparecem sozinhas** em
Configurações: é regra do dono, "tudo que for de configuração vai estar em um
único lugar". O workflow dos módulos **não** ganha cartão próprio — vira mais um
ícone dentro do Editor de Workflow.

## Permissões e Perfis

`js/permissoes.js` é o catálogo. Cada entrada declara `chave`, `modulo`,
`rotulo`, `ajuda` e `lida_em` (onde a chave é consumida de verdade).

**A regra que sustenta o arquivo:** só entra chave que alguma tela ou alguma
política de fato **lê**. Caixa que não faz nada é pior que caixa ausente — a
ausente o gestor percebe, a que não faz nada ele acredita. Três chaves
(`ver_repasses`, `baixar_documentos`, `editar_perfil`) viveram anos no
formulário sem leitor nenhum, e foram removidas. `testes/t-perfis.js` lê o
projeto inteiro e reprova se alguma chave do catálogo ficar órfã.

Os formulários de gente (corretor, analista, correspondente) **montam as caixas
na hora de abrir**, a partir do catálogo, agrupadas por módulo e filtradas pela
licença do cliente. Liberou o módulo, as permissões dele aparecem sozinhas.

**Perfis** (`a1_perfis`): descrevem uma vez o que um tipo de gente pode fazer, e
as pessoas são vinculadas por `a1_partners.perfil_id`. Quem tem perfil segue
**só** o que o perfil diz — as marcas soltas do cadastro deixam de valer:

- No banco: `a1_perm` usa `coalesce(perfil.permissions, pessoa.permissions)`,
  com `left join ... and pf.ativo`.
- Na tela: `a1RefreshPartnerPerms()` faz a mesma resolução **num ponto só**, e
  por isso nenhum `hasPerm()` do sistema precisou mudar.
- **As duas precisam concordar.** Uma decide o que a tela mostra, a outra o que
  a API entrega — e é a segunda que protege. Perfil inativo devolve a pessoa às
  marcas próprias, nos dois lados.
- Salvar uma pessoa com perfil **preserva as marcas próprias dela por baixo**:
  se o perfil sair, ela volta ao que o gestor tinha marcado, não a uma cópia
  congelada do perfil.

## Convenções do front

- `esc()` em **tudo** que vem do banco e entra em `innerHTML`. Inclusive aspas
  simples, quando o texto cai dentro de um `onclick="...'...'"`.
- Funções chamadas por `onclick` precisam estar no **escopo global**. Definir
  dentro de `init()` faz o atributo não enxergar — já quebrou o seletor de
  painel.
- `A1.buscarTudo()` para qualquer leitura que possa passar de 1.000 linhas. O
  PostgREST corta em 206 e quem só olha o corpo não percebe: o sistema mostra
  mil processos achando que são todos.
- Erro de banco não vira "Tente novamente". Traduza a mensagem (há
  `motivoDoErro(res)` como referência) — o gestor precisa saber **o que** fazer.
- Modais: `openModal`/`closeModal` por id, rodapé `.modal-ftr`. Cada página tem
  a sua cópia dessas funções; siga a da página em que está mexendo.
- Configurações é um roteador de sub-telas: `CFG_VIEWS` + `openCfgView(nome)` +
  `closeCfgView()`. Cartão novo entra no grupo certo do hub e na busca.
- A paleta atual é azul `#3D5CC8`. (A marca é verde-azulada; ver Dívidas.)

## Testar — e por que os testes daqui são assim

Duas frentes, e **as duas rodam antes de qualquer entrega**:

```bash
npm test                    # 22 suítes de navegador (Chromium de verdade)
npm test -- t-perfis        # só as que casarem com o filtro

# Provas de banco, num Postgres descartável (rodar como usuário postgres):
PGPORT=5473 testes/sql/roda.sh      # hoje: 99 verificações
```

A suíte de navegador **finge ser o Supabase** (`testes/fake.js`) e abre a página
real. Nenhuma requisição sai para a internet; nada encosta em dado de cliente.
A CI (`.github/workflows/ci.yml`) roda a suíte em todo push.

### A lição mais cara deste repositório: o teste é que mentia

Três vezes, um teste passava **codificando o comportamento errado como certo**:

1. O andaime gravava o id do parceiro direto na sessão — escondeu o defeito do
   `a1_ator()` que teria deixado todo corretor sem ver a própria carteira.
2. O banco de mentira não tinha a chave estrangeira — escondeu o 409 do
   "Acessar como".
3. O POST devolvia sempre `{id:'novo-1'}` — escondeu todo código que insere em
   lote e usa os ids de volta. A semeadura da esteira não ligava nada, **sem
   quebrar nada**, que é o pior jeito de falhar.

**Disciplina:** quando um defeito real aparece e o teste está verde, conserte o
andaime primeiro e veja o defeito surgir. Só então conserte o código.

E ao escrever asserção:

- **Confira conteúdo, não quantidade**, sempre que der. `count() === 2` apodrece;
  `inclui('Imob Alfa')` continua dizendo a verdade.
- **Prova fraca não é prova.** "Quem só tem Repasse não vê pré-análise" passava
  trivialmente porque a corretora do teste não tinha processo nenhum. Monte o
  cenário em que o teste *falharia* se o código estivesse errado.
- Toda suíte termina conferindo `window.__XSS === 0`. A base de teste tem
  `<img src=x onerror=...>` plantado em nome de cliente. Já pegou seis casos.
- Módulos novos nascem **sem licença** nos testes — é a situação de todo cliente
  hoje, e é isso que faz "nenhum cliente foi afetado" significar alguma coisa.
  Quem testa as telas novas pede: `abrir('pre-analise.html', {modulos:['PRE_ANALISE']})`.

### Revisor também erra

Achado de agente revisor (ou de qualquer um) **se reproduz antes de agir**. O
caminho que funciona: escrever a prova que falha sem a correção, aplicar a
correção, ver a prova passar. Duas brechas reais de RLS em produção foram
encontradas assim — e um "problema" apontado pela conferência não era problema
nenhum, era decisão do dono.

## Entregar

**O SQL é rodado à mão pelo dono, no editor do Supabase.** Não existe migração
automática. Então:

1. Um arquivo por assunto em `sql/`, nomeado `AAAA-MM-DD_assunto.sql`.
2. Escrito para **rodar de novo sem problema** (`if not exists`,
   `create or replace`, `drop policy if exists`).
3. No topo, um bloco explicando **por que o arquivo existe** e o que ele
   **não** muda. No fim, como conferir.
4. Ao entregar, diga a **ordem exata** dos arquivos e o que cada um implica.

**Ordem de publicação importa.** Se a tela nova depende de coluna nova, a tela
**não sobe antes do SQL** — senão o salvamento quebra em produção. Segure a
publicação e avise.

Git:

- Desenvolva na branch designada da tarefa.
- **`main` é o que a Vercel serve** — publicar é levar o commit para `main`.
  Nunca leve para `main` o que ainda depende de SQL não rodado.
- Mensagem de commit em português, primeira linha curta e concreta, corpo
  explicando **por que** e o que foi provado. Nada de identificador de modelo em
  nada que vá para o repositório.

## Como escrever aqui

O código deste repositório é comentado em português explicando **o motivo**, não
o mecanismo. Comentário bom é o que registra a cicatriz: *"esta lista fica
desligada por padrão porque, quando entrou ligada, cinco suítes passaram a
falhar e as falhas viraram ruído"*. Comentário ruim repete o que a linha já diz.

Ao mexer num trecho, siga a densidade e o tom do que está em volta. E, quando
descobrir uma armadilha nova, **escreva-a onde a próxima pessoa vai tropeçar**,
não num documento separado.

## Dívidas conhecidas (não são bugs novos — são o mapa)

- **`repasse.html` / `andamento.html` / `listagem.html` são triplicadas.** Muita
  lógica repetida três vezes, e correção em uma esquece as outras. Duas decisões
  pendentes do dono: (a) juntar numa página com parâmetro de vista; (b) adotar
  um passo de build (Vite + TypeScript) ou continuar em JS puro.
- **`a1_has_module` (a porta da tela) não honra `expires_at`.** O RLS honra. Uma
  licença vencida ainda desenha a aba, mas não entrega dado.
- **A paleta é azul `#3D5CC8`**, não a verde-azulada da marca.
- **`docs/Manual-SIIMOB.pdf` está desatualizado** em relação aos módulos novos e
  aos Perfis.
