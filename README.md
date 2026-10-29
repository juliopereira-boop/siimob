# SIIMOB

Sistema multi-inquilino de **repasse imobiliário** para construtoras, correspondentes bancários e
imobiliárias. Em produção, com clientes reais.

- **Front:** HTML, CSS e JavaScript, organizados por tela e empacotados com [Vite](https://vite.dev) (multipágina).
- **Banco:** Supabase (Postgres + PostgREST + RLS + Storage). Toda autorização real está no banco.
- **Publicação:** Vercel, a partir da branch `main`.

## Começando

```bash
npm install
npm run dev        # http://localhost:3000/<apelido-do-cliente>/login
```

> **Atenção:** `src/shared/api/config.js` aponta para o Supabase de **produção**. O que você fizer no
> `npm run dev` acontece na base dos clientes. Para experimentar sem tocar em nada, use a suíte de
> testes, que finge ser o Supabase.

| Comando           | O que faz                                                              |
|-------------------|------------------------------------------------------------------------|
| `npm run dev`     | Servidor de desenvolvimento, com as rotas de `vercel.json`             |
| `npm run build`   | Gera `dist/`, que é o que a Vercel publica                             |
| `npm run preview` | Serve o `dist/` como a produção serviria                               |
| `npm test`        | Build + suíte de navegador (Chromium real, banco falso)                |
| `npm test -- t-x` | Só as suítes cujo nome contém `t-x`                                    |
| `npm run lint`    | ESLint                                                                 |
| `npm run format`  | Prettier em JS e CSS                                                   |
| `npm run tipos`   | Checagem de tipos (TypeScript sobre JSDoc) nos arquivos com `// @ts-check` |
| `npm run verificar` | Lint + formatação + tipos + suíte: o que a CI roda                   |

Provas de banco (Postgres descartável): `PGPORT=5473 testes/sql/roda.sh`.

## Estrutura

```
src/
  pages/<tela>/        uma pasta por tela (repasse e registro têm várias vistas; a rota decide)
    index.html         só marcação
    main.js            comportamento da tela
    style.css          estilo da tela
    index.css          ordem da cascata (quando a tela usa estilos compartilhados)
  shared/              o que mais de uma tela usa
    api/config.js      cliente do Supabase (A1.rest, A1.rpc, A1.headers, A1.buscarTudo)
    auth/              sessão, licença de módulo, catálogo de permissões
    ui/                cabeçalho e abas (modulo-shell), avisos, tarja de cobrança
    utils/             utilidades sem regra de negócio
  modules/             regra de negócio por domínio (painéis, documentos, leads, configurações…)
  styles/              estilos globais e tokens
public/                arquivos servidos como estão (ícones, imagens, banners)
database/
  migrations/          todo o SQL, um arquivo por assunto (AAAA-MM-DD_assunto.sql)
  schema.sql
testes/                suíte de navegador (t-*.js) e provas de banco (testes/sql)
tools/                 plugins do Vite e leitor das rotas
scripts/               utilitários (servidor local do build)
docs/                  arquitetura, coordenação, manuais
vercel.json            rotas, cabeçalhos e build da Vercel
```

Detalhes e decisões: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Banco de dados

**Nenhum SQL roda sozinho.** Cada arquivo em `database/migrations/` é executado à mão pelo dono no
editor do Supabase, quando ele decide. Existir no repositório não significa estar aplicado. Todo
arquivo novo:

1. tem nome `AAAA-MM-DD_assunto.sql`;
2. roda de novo sem problema (`if not exists`, `create or replace`, `drop policy if exists`);
3. explica no topo por que existe e o que **não** muda, e no fim como conferir.

Se uma tela depende de coluna nova, a tela **não** sobe antes do SQL.

## Regras que não se quebram

1. Não se mexe em dado de cliente em produção.
2. Dado de um cliente nunca aparece no painel de outro (isolamento por `tenant_id`, garantido no banco).
3. Um login é de uma pessoa só.
4. Módulo novo nasce desligado para todo mundo; quem liga é o superadmin, cliente por cliente.
5. Todo cadastro reflete nos filtros.

## Publicar

`main` é o que a Vercel serve. A Vercel roda `npm run build` e publica `dist/` (configurado em
`vercel.json`). Nada vai para `main` sem a suíte verde, e nada que dependa de SQL ainda não rodado.
