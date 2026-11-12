# Arquitetura do SIIMOB

Este documento explica como o código está organizado, por que, e para onde ele vai. O "como rodar"
está no [README](../README.md).

## Visão geral

```
navegador ──► PostgREST (chave anon + x-session-token) ──► RLS ──► dados
                              ▲
              a1_tenant() lê o cabeçalho e diz de que cliente é a sessão
```

- Não existe servidor de aplicação. O navegador fala direto com a API REST do Supabase.
- **Toda autorização real é RLS.** O que a tela esconde é conveniência; o que protege é a política.
- Autenticação própria (não é o Auth do Supabase): `a1_login` / `a1_partner_login` gravam uma linha
  em `a1_sessions` e devolvem o token, mandado em todo pedido no cabeçalho `x-session-token`.
- A esteira (orquestrador) roda dentro do Postgres, em funções `security definer`.

## O front

### Uma pasta por tela

Cada tela é `src/pages/<tela>/`:

| Arquivo      | Papel                                                                 |
|--------------|-----------------------------------------------------------------------|
| `index.html` | Só a marcação da tela e a lista de scripts, na ordem em que carregam. |
| `main.js`    | O comportamento da tela.                                              |
| `style.css`  | O estilo próprio da tela.                                             |
| `index.css`  | Quando a tela usa estilo compartilhado: declara a ordem da cascata.   |

**A ordem da cascata é explícita.** O `index.css` importa as folhas na ordem em que devem valer: o
que vem depois ganha nos empates. Nas telas com o cabeçalho comum, o `siimob.css` vem **depois** do
CSS da tela. Era o efeito real de antes da reestruturação: o cabeçalho injetava uma segunda cópia
do `siimob.css` no fim do `<head>`. Um arquivo só por tela também impede o build de reordenar.

### Compartilhado

| Pasta                | Conteúdo                                                                    |
|----------------------|-----------------------------------------------------------------------------|
| `src/shared/api`     | `A1`: cliente REST/RPC do Supabase, cabeçalhos, `buscarTudo` (paginação além de 1.000 linhas), busca tolerante, preservação de filtros e rolagem. |
| `src/shared/auth`    | Sessão, `a1RequireAuth`, licença de módulo (`a1HasModule`), catálogo de permissões. |
| `src/shared/ui`      | Cabeçalho e abas comuns (`a1MontarShell`), mural de avisos, tarja de cobrança. |
| `src/shared/utils`   | Utilidades sem regra de negócio (leitor de planilha).                       |
| `src/modules/*`      | Regra de negócio por domínio, usada por mais de uma tela.                   |
| `src/styles`         | Estilos globais e tokens de cor.                                            |

### Build (Vite)

`vite.config.mjs` registra uma entrada por tela. O `dist/` sai assim:

- as páginas **na raiz, com os nomes de sempre** (`/repasse.html`), pelo plugin
  `tools/vite/paginas-na-raiz.mjs`. As rotas de `vercel.json` e os endereços salvos pelos clientes
  não mudaram;
- JS e CSS em `/static`, com hash no nome e cache de um ano (`vercel.json`). Um deploy novo gera
  nomes novos, então nenhum navegador fica com código velho.

**Módulos ES.** Cada arquivo de `src/` é um módulo: o que usa de outro arquivo vem por `import`, e
o que oferece sai por `export`. Cada tela tem um único `<script type="module">` (o `main.js` dela),
que importa os módulos compartilhados na mesma ordem em que antes eram carregados. O Vite empacota a
árvore de cada tela e separa o que é comum (`config`, `auth`...) em arquivos cacheados entre telas.
O lint roda com `no-undef` ligado: nome usado sem `import` é erro.

**Ações do HTML.** O HTML não chama função pelo nome; o elemento declara a ação e o módulo dono
diz o que ela faz (`src/shared/ui/acoes.js`):

```html
<button data-acao="abrirCaso" data-id="${esc(c.id)}">Abrir</button>
<select data-acao-change="filtrar">...</select>
<input data-acao-enter="buscar">
```

```js
acoes({
  abrirCaso: el => abrirCaso(el.dataset.id),
  filtrar: el => filtrar(el.value),
  buscar: () => buscar()
});
```

Um ouvinte por tipo de evento, no `document`, atende a página inteira, inclusive o que é
desenhado depois por `innerHTML`. Os argumentos vão em `data-*` escapados com `esc()` e chegam à
função exatamente como saíram do banco (antes, dentro de `onclick="f('...')"`, o texto passava por
um parser de JavaScript e precisava de um segundo escape). A delegação reproduz o `onclick`: ações
aninhadas rodam de dentro para fora, `ev.stopPropagation()` cala as de fora, eventos que não sobem
(`focus`, `load`, `mouseenter`...) só disparam a ação do próprio alvo. O `t-acoes` prova isso no
navegador e confere, página por página, que toda ação declarada está registrada.

**O que ainda vai para o `window`.** Só o que a suíte de testes chama por dentro da página e o que
outro módulo sonda com `typeof` (`expor({...})` e `exporVariavel`, de `src/shared/utils/expor.js`).
Antes da fase 3a, todo nome de todo arquivo era global; depois da 3b, sobraram 160 (eram 534 na 3a).

**Rotas.** `tools/rotas.js` lê as reescritas de `vercel.json`. É usado pelo servidor de
desenvolvimento, pelo preview, pela suíte de testes e pelo servidor local, para que todos se
comportem como a Vercel.

## Testes

- `testes/t-*.js`: suítes de navegador (Playwright, Chromium real). Abrem a página **do build**
  (`dist/`) com o Supabase substituído por `testes/fake.js`. Nenhuma requisição sai para a internet.
- `testes/fonte.js`: para os testes que conferem o código escrito (sem navegador). `lerPagina(tela)`
  devolve o HTML e o JS da tela juntos.
- `testes/sql/`: provas de autorização contra um Postgres descartável.

Toda suíte termina conferindo `window.__XSS === 0`: a base falsa tem `<img onerror>` plantado em
nomes de cliente.

## Roteiro da reestruturação

| Fase | Escopo | Estado |
|------|--------|--------|
| 1 | Separação mecânica: CSS e JS fora do HTML, pastas, Vite, lint, testes contra o build. Comportamento idêntico, provado por captura de tela pixel a pixel e pela suíte. | **feita** |
| 2 | Fim das cópias: Repasse (Dashboard, Andamento e Listagem eram três arquivos 96% iguais) virou uma tela, e o Registro (Quadro e Listagem) outra; a rota decide a vista. Código morto do `configuracoes` removido (85 funções, provado por alcançabilidade). Escape único (`esc`/`escJs`) e `hojeISO` em `src/shared/utils`. | **feita** |
| 3a | Módulos de verdade: todo arquivo é módulo ES, com `import`/`export`; o global deixou de ser "tudo" e virou a lista explícita de `expor()`; lint com `no-undef`. | **feita** |
| 3b | Os 901 handlers inline viraram ações declaradas (`data-acao` com delegação); `escJs` saiu (não há mais texto dentro de string JS em atributo); `expor()` encolheu de 534 para 160 nomes. | **feita** |
| 4 | Tipos em JSDoc com checagem na CI, arquivo por arquivo (`// @ts-check` no topo). A base já está pronta: `jsconfig.json`, `npm run tipos` e o job da CI; hoje estão marcadas as ferramentas (`tools/`, `vite.config.mjs`, `testes/fonte.js`) e `src/shared/ui/acoes.js`. | base pronta |

### Uma tela, várias vistas

`src/pages/repasse` atende `/cliente/repasse` (Dashboard), `/cliente/andamento` (quadro) e
`/cliente/listagem` (lista); `src/pages/registro` atende `/cliente/registro` (quadro) e
`/cliente/registro-listagem` (lista). As rotas de `vercel.json` levam todos esses endereços (e os
antigos `/andamento.html`, `/listagem.html`, `/registro-listagem.html`) para a mesma página, e a
constante `VISTA` no topo do `main.js` lê o caminho e decide o que aparece. Uma correção vale para
todas as vistas de uma vez.

Ao juntar as cópias, as correções que existiam em só uma delas foram preservadas e passaram a valer
para todas: o histórico do processo com o autor (Andamento), o espaço não separável no importador
do CV (Andamento), a seleção em lote e a planilha (Listagem), o seletor de painel (Dashboard) e, no
Registro, telefone e vínculos ao criar processo, conferência da resposta ao salvar e arquivar, e
cores e ids escapados (que a cópia da Listagem não tinha).

## Disposição de unidades (módulo DISPOSICAO)

O estoque da construtora. Desligado para todo cliente; o superadmin só oferece para construtora.
O SQL é `database/migrations/2026-11-02_disposicao_unidades.sql` e precisa estar aplicado antes de
ligar a licença para alguém (sem a linha em `a1_modules`, ligar falha pela chave estrangeira).

**Tudo por identificador.** Cada unidade é uma linha de `a1_unidades` com `id`, `status`, `versao`
e histórico em `a1_unidade_eventos` (criação, edição campo a campo, situação, preço, exclusão). A
lista de códigos em `a1_developments.units`, que os outros módulos leem, passa a ser mantida pelo
banco a partir das fichas (`a1_unidades_refaz_lista`).

| Peça | Onde | Regra |
|------|------|-------|
| Situação da unidade | `a1_unidade_definir_status`, `a1_unidade_reservar`, gatilho da venda | Só muda pelo orquestrador; a escrita direta é recusada pela guarda. Motivo obrigatório para bloqueio e distrato. |
| Reserva | `a1_unidade_reservar` | Trava a unidade, confere a versão que a tela leu, valida o fluxo contra os parâmetros, cria a venda quando o cliente tem COMERCIAL. Índice único: uma reserva ATIVA por unidade. |
| Venda e unidade | gatilho `a1_co_unidade_acompanha` | Venda com selo VENDIDO marca a unidade vendida e a reserva CONVERTIDA; FIM_NEGATIVO devolve a unidade. |
| Vencimento | `a1_disposicao_atualizar` | Preguiçoso: roda quando a tela abre e a cada 20 s. Vence a reserva cuja venda não andou e libera bloqueio com data passada. |
| Preço | `a1_mapas_preco`, `a1_mapa_preco_itens` | Um mapa ativo por empreendimento; reajuste cria mapa novo (`a1_mapa_preco_duplicar`). |
| Pagamento | `a1_parametros_pagamento` | Série, periodicidade, mínimo e máximo de parcelas, parcela mínima, quem paga. |

"Tempo real" é consulta a cada 20 segundos: a autenticação própria do SIIMOB não usa o Realtime do
Supabase.

Front: `src/pages/disposicao` (planta, ficha, reserva em três passos, lista de reservas, painel) e
`src/modules/disposicao` (`dados.js`, compartilhado; `config-disposicao.js`, as quatro sub-telas de
Configurações). Provas: `testes/sql/prova-disposicao.sql`, `testes/sql/prova-concorrencia.sh` e
`testes/t-disposicao.js`.

### Reserva pela pré-análise, regras da pré-análise e selos de Leads

SQL: `database/migrations/2026-11-03_reserva_pre_analise_e_selos.sql` (depende da 2026-11-02). Até
ele rodar em produção, nada desta seção vai para a `main`.

| Peça | Onde | Regra |
|------|------|-------|
| Origem da reserva | `a1_disposicao_config.origem_reserva` (Configurações › Regras da reserva) | `LIVRE`: reserva direto pelo mapa (com pré-análise opcional). `PRE_ANALISE`: `a1_unidade_reservar` recusa sem pré-análise (`reserva_exige_pre_analise`). |
| Pré-análise pronta | `a1_pa_pronta_para_reserva` | Selo `FIM_POSITIVO`, sem venda, sem reserva ativa e, com COMERCIAL, o que `a1_pa_pode_criar_comercial` exige. Uma reserva ativa por pré-análise (índice único). |
| Reserva → venda | `a1_reserva_criar_venda` (interna) | Toda reserva cria a venda na esteira, na situação inicial (`flag INICIAL` ou selo `INICIO`). Sem situação inicial a reserva é recusada antes (`venda_sem_situacao_inicial`). Com pré-análise, a venda nasce por `a1_criar_comercial`, com a unidade, o fluxo como proposta e a foto da reserva. |
| Reserva antiga sem venda | `a1_reserva_abrir_venda` | Botão "Abrir a venda agora" na ficha e "criar a venda" na lista. Idempotente. |
| Avaliação | `a1_mapa_preco_itens.valor_avaliacao` | Coluna no mapa de preço; entra no rastro de preço e na duplicação do mapa. |
| Unidade na pré-análise | `a1_pre_analises.unidade_id`, `a1_pa_unidades_para_cadastro` | Com a Disposição, bloco e unidade saem das fichas e a avaliação vem do mapa. O gatilho `zzz_a1_pa_regras` confere empreendimento e mantém o texto igual ao código da ficha. |
| Regras da pré-análise | `a1_pa_regras` (Configurações › Regras da pré-análise) | Corretor, imobiliária, analista, empresa, correspondente, unidade, avaliação e cônjuge, cada um obrigatório ou não. O banco exige na criação; na alteração só barra apagar o exigido. Cônjuge é conferido no assistente (vira participante `ASSOCIADO` com `parentesco`). Padrão sem regra gravada: cônjuge obrigatório só para construtora. |
| Selos de Leads | `a1_stages.selo` + `a1_crm_definir_selo` | `AGENDAMENTO` (popup da visita), `PRE_ANALISE` (só nesta etapa o lead vira pré-análise, quando o funil tem a etapa), `GANHO` e `PERDIDO` (pede o motivo, grava em `payload.perda`). Um por funil (`group_key`). |
| Visita | `a1_crm_agendar_visita` | Uma linha de `a1_agenda` (tipo `visita`, `lead_id`) para o corretor (com quem agendou como convidado) e uma para a imobiliária; evento no histórico do lead. |

Front: `src/pages/disposicao` (faixa da pré-análise, `?pa=`, seletor de pré-análise no passo do
cliente, aviso de crédito sem parâmetro), `src/pages/pre-analise` (unidade da ficha, cônjuge ou segundo
associado, botão "Reservar unidade"), `src/modules/pre-analise/regras-pa.js`, `src/pages/crm`
(popup da etapa com selo, chip da visita) e `src/pages/workflow` (seletor de selo em Leads). Provas:
`testes/sql/prova-reserva-pa.sql`, `testes/t-reserva-pa.js` e `testes/t-leads-selos.js`.

## Site público: `/links`, `/contato`, `/blog`

Páginas sem login, na identidade da LP. SQL: `database/migrations/2026-11-12_site_links_blog.sql`.

| Peça | Onde | Regra |
|------|------|-------|
| Página da bio do Instagram | `src/pages/links`, `a1_site_links` | Banners, botão de destaque, botões e títulos de seção, na ordem do superadmin. Banner pode ter início e fim. Sem banco, mostra Conheça, Blog e Contato. Cliques contados por `a1_site_link_clique`. |
| Canais de contato | `a1_site_config` (uma linha) | WhatsApp, e-mail, telefone, horário, endereço e redes. Campo vazio não aparece em nenhuma página. |
| Contato | `src/pages/contato` | O formulário grava em `a1_leads` com `source = 'contato'`; aparece na aba Interessados do superadmin com a origem marcada. |
| Blog | `src/pages/blog`, `a1_blog_posts` | `/blog` (categorias, busca, paginação de 9, destaque) e `/blog/:post`. O texto é Markdown renderizado por `src/modules/site/markdown.js`, que escapa tudo antes e só aceita link e imagem com endereço seguro. Data futura agenda o post. |
| Gestão | Superadmin › Site (`src/modules/site/admin-site.js`) | Escreve com a chave de serviço; as tabelas não têm política de escrita pública. Imagens no bucket público `site` (só imagem, até 5 MB). |

Código compartilhado em `src/modules/site/` (`site.css`, `casca.js` com cabeçalho e rodapé, `dados.js`, `marca.js`,
`markdown.js`). Rotas novas em `vercel.json` e `public/_redirects`, antes das rotas de cliente. Provas:
`testes/sql/prova-site.sql` e `testes/t-site.js`.

## Login do superadmin (autenticador)

O superadmin entra com o código de 6 dígitos de um app autenticador (TOTP, RFC 6238). A Service Role Key não passa
mais pelo navegador no dia a dia: mora só na Edge Function `sa-proxy`.

| Peça | Onde | O que faz |
|---|---|---|
| Banco | `database/migrations/2026-11-12_superadmin_autenticador.sql` | Segredo (`a1_sa_totp`), sessões como hash sha256 (`a1_sa_sessoes`, 12 h), tentativas (`a1_sa_tentativas`). Confere o código, anti-reuso, trava 5 erros por IP em 15 min e o login inteiro com 10 erros em 15 min ou 30 em 24 h (o IP vem de cabeçalho e pode ser forjado); `a1_sa_destravar` libera. Funções só para `service_role`. |
| Edge Function | `supabase/functions/sa-proxy/` (`nucleo.mjs` + `index.ts`, `verify_jwt = false`) | `/status`, `/login`, `/sair`; repassa `/rest/v1/*` e `/storage/v1/*` com a chave de serviço para quem tem sessão. Lista fechada de cabeçalhos nos dois sentidos, CORS por lista (`SA_ORIGENS` troca). |
| Navegador | `src/modules/sa/acesso.js` | Troca o código pela sessão (sessionStorage da aba) e intercepta o `fetch`: pedido ao REST e ao Storage não público vai para a função com `x-sa-sessao`. Endereço público do Storage não é desviado (é o que fica gravado no banco). |
| Tela | `src/pages/superadmin` | Código por padrão; a chave fica como primeiro acesso e emergência. Entrar com a chave sem autenticador abre o cadastro com QR. Plataforma › Acesso do superadmin: trocar autenticador, liberar login travado, encerrar todas as sessões. |

Sem a função publicada, a tela cai sozinha no formulário da chave, como antes. Provas: `testes/sql/prova-sa-autenticador.sql`,
`testes/t-sa-proxy.js` (a função em Node) e `testes/t-sa-autenticador.js` (a tela).

## LP comercial (`/conheca`)

`src/pages/lp`: página isolada (sem casco, sem sessão), na identidade do sistema. Fala do SIIMOB
inteiro: jornada do lead ao registro, os quatro perfis, a Disposição, os módulos e o ecossistema de
conexões. O que ainda não existe (conexão entre contas) aparece marcado como "em lançamento". O
formulário grava em `a1_leads` com a chave pública, sem leitura.

### Dívidas conhecidas

- Três botões declaram ações que nunca tiveram função (já não faziam nada antes da fase 3b):
  "+ Nova Venda" e "Criar venda" na Venda (`abrirVendaAvulsa`, `criarVendaAvulsa`) e "Apagar"
  transição no Superadmin (`apagarTransicao`). Listados em `testes/t-acoes.js`.
- `toast`, `openModal`/`closeModal` e as formatações de data e dinheiro ainda têm versões diferentes
  por tela (o visual de cada uma difere); viram componentes em `src/shared/ui` na fase 3.
- `a1_has_module` (a porta da tela) não honra `expires_at`; o RLS honra.
