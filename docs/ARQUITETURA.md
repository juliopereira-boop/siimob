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

**Scripts clássicos.** O código das telas ainda é script clássico, não módulo ES: as funções são
globais porque os `onclick="..."` do HTML as chamam pelo nome. O Vite só empacota módulos, então o
plugin `tools/vite/scripts-classicos.mjs` minifica e põe hash nesses scripts sem mudar a semântica.
O esbuild, sem formato de saída, não renomeia nada do nível de cima, e o alvo `esnext` não reescreve
sintaxe nenhuma.

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
| 3 | Módulos de verdade: trocar os `onclick` inline por eventos, `import`/`export` entre arquivos, fim dos globais. | |
| 4 | Tipos em JSDoc com checagem na CI, arquivo por arquivo (`// @ts-check` no topo). A base já está pronta: `jsconfig.json`, `npm run tipos` e o job da CI; hoje só as ferramentas (`tools/`, `vite.config.mjs`, `testes/fonte.js`) estão marcadas. | base pronta |

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

### Dívidas conhecidas

- ~1.350 handlers `onclick` inline dependem de funções globais (fase 3).
- `toast`, `openModal`/`closeModal` e as formatações de data e dinheiro ainda têm versões diferentes
  por tela (o visual de cada uma difere); viram componentes em `src/shared/ui` na fase 3.
- `a1_has_module` (a porta da tela) não honra `expires_at`; o RLS honra.
