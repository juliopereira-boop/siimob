# Provas de SQL

As suítes de `testes/` abrem o sistema num navegador e conferem o que o usuário
vê. Estas aqui conferem outra coisa: **o que o banco entrega para quem pede
direto**, sem passar por tela nenhuma.

A distinção importa porque a chave pública do Supabase está no código do site —
é assim que ele funciona. Qualquer pessoa com um login válido pode conversar com
a API por fora do sistema. Uma regra que só existe em JavaScript não é uma regra;
é uma sugestão. Por isso todas as verificações daqui rodam como o papel `anon`
com um token no cabeçalho, que é exatamente como o PostgREST chega ao banco.
Nenhuma consulta é feita como dono do banco: o dono não é submetido a RLS, e um
teste feito assim aprovaria qualquer coisa.

## Como rodar

Precisa de um PostgreSQL de brincadeira em pé. Nada aqui toca produção — cada
execução cria e apaga o próprio banco.

```bash
# subir um Postgres descartável (uma vez por sessão)
mkdir -p /var/tmp/pg16 && chown postgres:postgres /var/tmp/pg16
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/tmp/pg16/data -U postgres --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/pg16/data -o '-p 5473' -l /var/tmp/pg16/log start"

PGPORT=5473 testes/sql/roda.sh              # 65 verificações de autorização
PGPORT=5473 testes/sql/prova-concorrencia.sh # cliques simultâneos
```

## Os arquivos

| arquivo | o que é |
|---|---|
| `base-falsa.sql` | O andaime: papéis `anon`/`authenticated`, as tabelas antigas do sistema e uma `a1_tenant()` igual à de produção. Só existe para os arquivos de `sql/` terem onde pousar. |
| `prova-seguranca.sql` | As 65 verificações. Cada uma existe por causa de um jeito concreto de burlar a regra. |
| `prova-concorrencia.sh` | Oito conexões disparando a mesma ação ao mesmo tempo. |

## O que cada bloco defende

1. **Módulo desligado** — nem o gestor do cliente lê ou escreve. É o que garante
   que os módulos novos não existem para nenhum cliente de hoje.
2. **Identidade** — token inventado não é ninguém; permissão gravada torta por
   tela antiga vira "não pode" em vez de derrubar a consulta.
3. **Cada um vê o seu** — inclusive pedindo pelo id do processo alheio, que é
   como um vazamento real acontece: o id circula em link e em relatório.
4. **Quem vende não aprova** — o corretor não insere a própria decisão de
   crédito nem carimba o próprio documento.
5. **A esteira não se pula** — `PATCH` direto não move situação, não mexe na
   versão e não redistribui carteira.
6. **A ação manual confere quem pediu** — não só se o cliente é o certo.
7. **O que foi aprovado não se reescreve** — a fotografia do crédito e o vínculo
   com o Repasse são do sistema, não do operador.
8. **Histórico é só de acrescentar** — não se apaga e não se forja.
9. **Licença vencida fecha o módulo** — `expires_at` vale no banco, não só no
   painel.
10. **Revogar não destrói** — o cartão de repasse já criado continua lá.

## Três coisas que estas provas pegaram antes de irem para produção

**O ator errado.** A identidade toda dependia de `a1_ator()`, e `a1_ator()`
devolvia o `user_id` da sessão supondo que, para um parceiro, esse fosse o id em
`a1_partners`. Não é: `a1_partner_login` cria um *usuário-sombra* em `a1_users`
com o mesmo CPF e guarda o id do sombra. Nenhum corretor enxergaria a própria
carteira, e nenhuma permissão seria reconhecida. Falhava fechado — seguro e
inútil. Pior: a primeira versão deste andaime gravava o id do parceiro direto na
sessão, então a prova passava em cima de uma premissa falsa. **O andaime tem de
reproduzir o login de verdade, ou não prova nada.**

**A agenda aberta.** A política de escrita do cadastro de pessoas estava escrita
como `FOR ALL`. No Postgres isso também vale para `SELECT`, e as políticas se
somam com OU — então a política de leitura, restrita com cuidado logo acima, era
contornada pela de escrita logo abaixo. Qualquer corretor com permissão de criar
via nome, CPF, telefone e endereço de todos os clientes da casa.

**A licença eterna.** `a1_tem_modulo()` só perguntava se a linha existia. Uma
licença com data de validade seguia valendo no banco depois de vencida, com o
painel do superadmin mostrando "expirado" enquanto a API continuava entregando.
