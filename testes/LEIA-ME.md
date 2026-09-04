# Suíte de testes do SIIMOB

Testes de navegador de verdade: cada suíte sobe o Chromium, abre a página real,
**finge ser o Supabase** e confere o que aparece na tela. Não é teste de unidade
de função solta — é o sistema funcionando, que é o que quebra na vida real.

## Rodar

```bash
npm install                 # uma vez
npx playwright install chromium

npm test                    # tudo
npm test -- t-gerente       # só as suítes cujo nome casar
```

O corredor (`roda-tudo.js`) sobe sozinho um servidor estático na porta 8099 —
não precisa deixar nada rodando antes. Saída `APROVADO`/`REPROVADO`, e código de
saída != 0 quando falha, que é o que a CI lê.

## Como funciona

| Arquivo | Papel |
|---|---|
| `fake.js` | O banco de mentira. Uma função `responder(url)` que devolve o mesmo formato que o PostgREST devolveria. |
| `comum.js` | `abrir(pagina, opcoes)` — sobe o navegador, planta a sessão no `localStorage`, intercepta tudo que iria para o Supabase e devolve a página pronta. |
| `roda-tudo.js` | Servidor + corredor de todas as suítes. |
| `fixtures/` | Arquivos de entrada. `base-exemplo.xlsx` é a planilha do importador, gerada por `gerar-planilha.py` — mesmas 11 colunas da base real, dados inventados. |
| `t-*.js` | As suítes. Uma por assunto. |

Nenhuma requisição sai para a internet: fontes do Google e Supabase são
interceptadas. Os testes rodam offline e não encostam em dado de cliente.

### A base de teste

`fake.js` tem 4 processos de propósito — número pequeno o bastante para as
contagens dos testes serem legíveis. Existe um lote extra de 23 processos para
o KPI de gargalo (muitos recentes numa etapa, poucos e parados em outra), e ele
fica **desligado por padrão**:

```js
await abrir('repasse.html', { extras: true });   // só quem precisa liga
```

Isso é resultado de cicatriz: quando os 23 entraram ligados por padrão, cinco
suítes passaram a falhar porque contavam cartões, e as falhas ficaram meses no
vermelho até virarem ruído que ninguém mais lia.

### Nada de arquivo de fora

A suíte só pode depender do que está no repositório. `t-import` apontava para a
planilha que o cliente enviou uma vez, guardada num diretório temporário; no dia
em que aquele diretório sumiu, o teste passou a falhar por falta de arquivo — e
na CI nunca teria funcionado. Hoje a planilha é gerada e versionada, com dados
inventados: nome ou CPF de pessoa real não entra no repositório.

### Regra ao escrever asserção

**Confira conteúdo, não quantidade**, sempre que der. `count() === 2` apodrece no
dia em que alguém cadastra mais uma linha na base de teste; `inclui('Imob Alfa')`
continua dizendo a verdade.

## As suítes

| Suíte | O que protege |
|---|---|
| `t-board` | Pipeline, dashboard, filtros, criação de repasse |
| `t-list` | Listagem e o relatório em planilha |
| `t-novo` | Formulário de novo repasse |
| `t-config` | Todas as telas de Configurações e seus modais |
| `t-hub` | Navegação do hub de configurações |
| `t-dep` | Despachantes, bancos, cartórios e os IDs visíveis |
| `t-coord` | Filtro de coordenador no dashboard, pipeline e relatório |
| `t-coordform` | Vínculo corretor ↔ coordenador nos formulários |
| `t-gerente` | **Permissões.** Gestor sem restrição, gerente, tarja de somente leitura |
| `t-mural` | Mural de avisos: quem vê o quê, imagem, expandir texto |
| `t-indica` | Página do IndicaSII, simulador, FAQ, cadastro |
| `t-import` | Importador de planilha (usa `fixtures/base-exemplo.xlsx`) |
| `t-cobranca` | Giro Pendente→Pago→Em atraso e a tarja de cobrança no cliente |
| `t-monitor` | Monitor de acessos e "Acessar" por usuário no superadmin |
| `t-modulos-novos` | Pré-análise e Comercial: que não aparecem para cliente nenhum |
| `t-resto` | As telas menores — só que montam e não têm XSS |

## E as provas de banco

`testes/sql/` é outra coisa: em vez de abrir o navegador, conversa direto com o
PostgREST-equivalente e confere o que o banco entrega para quem pede por fora do
sistema. Rodam num Postgres descartável e não passam nem perto de produção.
Veja `testes/sql/LEIA-ME.md`.

## XSS

Quase toda suíte termina conferindo `window.__XSS === 0`. A base de teste tem
nome de cliente e de cadastro com `<img src=x onerror=...>` plantado dentro. Se
alguém escrever texto do banco em `innerHTML` sem escapar, o contador sobe e a
suíte reprova. Já pegou seis casos reais.
