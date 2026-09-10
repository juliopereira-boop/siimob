# Coordenação entre agentes — SIIMOB

Este arquivo existe porque mais de um agente mexe neste repositório e nem todos
enxergam as mesmas coisas. O Claude tem acesso ao Supabase de produção; o Codex
trabalha só pelo GitHub. Um estado de banco que um vê e o outro não é a receita
de duas correções corretas que se anulam.

**Leia antes de abrir branch.** Atualize quando mudar algo que o outro precise
saber. Não é documentação do produto — é o mapa do que está em voo.

Última verificação contra produção: **10/09/2026, 10:53 BRT**, por Claude.

---

## 1. Há duas histórias git neste repositório, e elas não se falam

```
main                       raiz f23a6d9b    59 commits
codex/stabilize-p0         raiz e644aa83   110 commits
codex/access-foundation    raiz e644aa83   112 commits
claude/dropdown-hover-...  raiz e644aa83   172 commits
```

`git diff origin/main...origin/codex/stabilize-p0` responde **`fatal: no merge
base`**. Não existe ancestral comum. Não é divergência de branch: são dois
repositórios que por acidente moram no mesmo lugar.

**`main` é a verdade.** É o que está publicado na Vercel e o que o cliente usa.
A raiz `e644aa83` é a história antiga, e o snapshot dela é anterior aos módulos
novos:

| arquivo             |   main | e644aa83 |
|---------------------|-------:|---------:|
| configuracoes.html  | 352 KB |   210 KB |
| repasse.html        | 342 KB |   264 KB |
| listagem.html       | 348 KB |   269 KB |
| js/auth.js          |  22 KB |    11 KB |
| pre-analise.html    |  74 KB |  ausente |
| comercial.html      |  48 KB |  ausente |
| js/permissoes.js    |   8 KB |  ausente |
| sql/ (30 arquivos)  | existe |  ausente |
| testes/ (30 suítes) | existe |  ausente |

Um merge de `codex/stabilize-p0` em `main` remove **35.715 linhas**: apaga
Pré-análise, Comercial, Perfis de acesso, todos os arquivos SQL e toda a suíte
de testes. O git não vai avisar — do ponto de vista dele são só arquivos que
"não existem" do outro lado.

### Regra

- Toda branch nova sai de `origin/main`. Sem exceção.
- Nada que descenda de `e644aa83` entra em `main`.
- Para aproveitar trabalho feito na história antiga: **não faça merge**. Copie
  o conteúdo (`git checkout <branch> -- <arquivo>`), confira contra o arquivo
  do `main` e comite como mudança nova. Foi assim que o `js/permissoes.js`
  chegou aqui.
- `codex/stabilize-p0-main` já está ancorada em `main` — esse é o formato certo.

---

## 2. O banco tem estado que não está no repositório

Os arquivos em `sql/` **não** rodam sozinhos. Não há migração automática: o
Julio executa cada um à mão no editor do Supabase, quando decide. Existir no
repositório não significa estar aplicado, e a ordem em que foram aplicados não
é a ordem dos nomes.

Estado real conferido em **10/09/2026 10:53 BRT**:

| arquivo                                         | em produção | o que instala |
|-------------------------------------------------|-------------|---------------|
| `2026-09-10_modo_manutencao.sql`                 | **SIM**     | `a1_manutencao`, trava nos dois logins |
| `2026-09-10_corretor_analista_so_o_seu.sql`      | **SIM**     | `a1_ator_so_ve_o_seu` e a regra em `a1_pa_visivel` / `a1_co_visivel` / `a1_case_visao_completa` |
| `2026-09-09_visibilidade_repasse_1_conferir.sql` | não         | `a1_nome_ator`, `a1_case_visivel` (relatório, inerte) |
| `2026-09-09_visibilidade_repasse_2_ligar.sql`    | não         | troca `cases_tenant_isolation` por 4 políticas |
| `2026-09-09_documento_obrigatorio.sql`           | não         | `a1_docs_obrigatorios`, gatilho que barra avanço sem documento |
| `supabase/sql/p0/restrict-repasse-create.sql`    | **SIM**     | política RESTRICTIVE de INSERT (ver §3) |

Consequência prática: **documento obrigatório hoje só existe na tela.** O front
barra, a API não. Quem chamar o PostgREST direto move o processo sem o
documento. A trava de banco está escrita e esperando ser rodada.

### Antes de propor SQL, olhe o banco

Se você não tem acesso ao Supabase, peça o resultado disto ao Julio em vez de
supor:

```sql
select policyname, permissive, cmd, qual, with_check
  from pg_policies where schemaname='public' and tablename='<tabela>';

select p.proname, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname = '<funcao>';
```

---

## 3. A armadilha que já pegou duas vezes: chave ausente não é chave falsa

`a1_perm()` termina em `coalesce(..., false)`. **Permissão que não está no JSON
do cadastro vale `false`.** Toda regra nova escrita como `a1_perm('x')` é
fail-closed sobre uma chave que quase ninguém tem — e o cadastro de hoje foi
preenchido antes de a chave existir.

Os números de produção, hoje:

| cliente        | tipo        | ativos | passam em `criar_repasses` |
|----------------|-------------|-------:|---------------------------:|
| S T            | corretor    |     36 |                      **0** |
| S T            | coordenador |      7 |                      **0** |
| S T            | agencia     |      5 |                      **0** |
| S T            | modalidade  |      3 |                      **0** |
| Demonstração   | corretor    |      1 |                      **0** |
| Demonstração   | coordenador |      1 |                      **0** |

(Contagem já considera `gerente`, que vale por cima. Gestores em `a1_users`
passam por `a1_e_gestor()` e não são afetados.)

`a1_cases_repasse_create_capability` **está aplicada em produção agora** e exige
`a1_perm('criar_repasses')`. Pela conta acima, 53 parceiros ativos não criam
mais repasse. A política em si está bem escrita — RESTRICTIVE, com pré-voo e
rollback. O problema não é a política, é o estado do cadastro.

**Antes de fechar uma chave, faça a conta de quem fica de fora.** Se der um
número grande, o caminho é um dos dois:

1. Popular a chave nos cadastros primeiro, e só depois fechar; ou
2. Tratar chave ausente como permitida, e fechar só o que está explicitamente
   marcado como `false`.

Foi por isso que `ver_repasses` nasceu com compatibilidade (ausente = pode ver)
e que `visibilidade_repasse` virou dois arquivos: `_1_conferir` só relata,
`_2_ligar` muda o comportamento. Separar as duas coisas permite medir o estrago
antes de causá-lo.

---

## 4. Ordem entre `_2_ligar.sql` e a política P0

As duas convivem — políticas RESTRICTIVE fazem `AND` com as PERMISSIVE — mas a
ordem importa para quem for conferir:

- `2026-09-09_visibilidade_repasse_2_ligar.sql` **derruba** `cases_tenant_isolation`
  e cria `a1_cases_ler`, `a1_cases_criar`, `a1_cases_editar`, `a1_cases_apagar`.
- O pré-voo do `restrict-repasse-create.sql` espera encontrar `cases_tenant_isolation`.

Rodando `_2_ligar` depois da P0, o pré-voo mostra outra coisa e parece quebrado
sem estar. Rode `_2_ligar` primeiro.

Detalhe que custou uma rodada de teste: as quatro políticas são **uma por
comando**, nunca um `for all`. Política `for all` de escrita também concede
SELECT, e uma delas anularia silenciosamente a política de leitura — a regra de
visibilidade sumiria sem nada falhar.

---

## 5. Como as duas camadas de acesso se dividem

Não são redundantes e não devem ser confundidas:

- **Banco (RLS)** é a autorização. É o que vale contra alguém chamando o
  PostgREST direto com o token da sessão. Funções: `a1_tenant()`, `a1_ator()`,
  `a1_papel()`, `a1_e_gestor()`, `a1_perm()`, `a1_tem_modulo()`,
  `a1_pa_visivel()`, `a1_co_visivel()`, `a1_case_visao_completa()`.
- **Tela** é conveniência: não mostrar botão que não vai funcionar. Nunca é
  garantia. Correção que só mexe na tela não fecha buraco de acesso.

Duas pegadinhas que já causaram defeito em produção:

- **Usuário-sombra.** `a1_partner_login` não guarda o id do parceiro na sessão.
  Cria um registro em `a1_users` com o mesmo CPF e guarda o id desse. `a1_ator()`
  volta ao parceiro pelo CPF. Teste que grava o id do parceiro direto na sessão
  passa em cima de premissa falsa.
- **Perfil não pode apagar o que é da pessoa.** `a1RefreshPartnerPerms` em
  `js/auth.js` aplica o perfil por cima das permissões, mas preserva
  `etapas` / `etapas_permitidas` do cadastro individual. Substituir o objeto
  inteiro fez um corretor aparecer como Correspondente e enxergar processos
  alheios.

---

## 6. Testes

Duas suítes, ambas rodam sem tocar produção:

```bash
npm test                          # 30 suítes Playwright contra um Supabase falso
PGPORT=5473 testes/sql/roda.sh    # 147 verificações num Postgres descartável
```

`npm test` sobe um servidor estático na porta 8099. Se der `EADDRINUSE`, sobrou
um processo: `pkill -f roda-tudo.js`.

A prova SQL roda **como `anon` com token no cabeçalho**, que é como o PostgREST
chega ao banco. Consulta feita como dono do banco não passa por RLS e não prova
nada. Use `set role anon`, não `set local role anon` — fora de transação o
`local` é ignorado silenciosamente e o teste passa como superusuário. Essa
armadilha já mascarou quatro verificações de segurança que estavam falhando.

Regra de ouro: **veja o teste falhar antes de escrever a correção.** Duas vezes
aqui um teste passou porque o dublê de Supabase respondia errado, não porque o
código estava certo.

Toda mudança de regra de acesso precisa de prova SQL, não só de teste de tela.

---

## 7. Estado no momento desta escrita

- **Manutenção LIGADA** desde 09:19 BRT, sem `ate` preenchido. Ninguém entra e
  o sistema **não volta sozinho** — depende de alguém clicar "Reativar" no
  superadmin, ou de `update a1_manutencao set ativa = false;`.
- `a1_cases_repasse_create_capability` ativa, com o impacto do §3 ainda não
  observado porque o sistema está fora do ar.
- Três analistas da S T (JANAILSON, ANDREIA, AMANDA) passaram a enxergar zero
  processos depois do `_so_o_seu.sql`. O Repasse liga parceiro ao processo por
  **texto** (`broker_name` / `manager_name`), não por id — a suspeita é
  divergência de grafia. Aguarda o Julio confirmar se estão em atividade.

---

## 8. Convivência

- **Só o Julio publica.** Nenhum agente faz merge em `main` por conta própria.
- **Nenhum agente roda SQL em produção.** Entregue o arquivo em `sql/` com
  pré-voo, verificação e rollback; quem executa é o Julio.
- Quem mexer em regra de acesso avisa aqui, porque `a1_perm`, `a1_pa_visivel`,
  `a1_co_visivel` e `a1_case_visao_completa` são usadas por vários módulos e uma
  redefinição sobrescreve a outra sem conflito de merge.
- Achou algo que o outro fez e parece errado: escreva o porquê com o número que
  sustenta, não só a opinião.
