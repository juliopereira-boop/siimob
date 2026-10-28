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
| 2 | Fim das cópias: Repasse (Dashboard, Andamento e Listagem eram três arquivos 96% iguais) vira uma tela; Registro idem; funções repetidas vão para `src/shared`. | próxima |
| 3 | Módulos de verdade: trocar os `onclick` inline por eventos, `import`/`export` entre arquivos, fim dos globais. | |
| 4 | Tipos em JSDoc com checagem na CI, arquivo por arquivo (`// @ts-check` no topo). A base já está pronta: `jsconfig.json`, `npm run tipos` e o job da CI; hoje só as ferramentas (`tools/`, `vite.config.mjs`, `testes/fonte.js`) estão marcadas. | base pronta |

### Dívidas conhecidas

- `repasse`, `andamento` e `listagem` ainda são três cópias (fase 2). Uma correção numa precisa ir
  às outras duas.
- ~1.350 handlers `onclick` inline dependem de funções globais (fase 3).
- `configuracoes/main.js` carrega cópias antigas de funções do Repasse que não têm mais tela (código
  morto, a remover na fase 2).
- `a1_has_module` (a porta da tela) não honra `expires_at`; o RLS honra.
- **"Hoje" em UTC em 7 lugares das telas** (`new Date().toISOString().slice(0, 10)`): data padrão
  da Agenda (repasse, andamento, listagem, configurações), "este mês" do painel do Registro, data de
  contrato no Superadmin e nome do CSV de Leads. No Brasil, depois das 21h, eles usam o dia
  seguinte. A correção (um `hojeISO()` único em `src/shared/utils`) muda comportamento, por isso
  entra na fase 2 e não na 1.
