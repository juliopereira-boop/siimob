# Auditoria de acesso — 10/09/2026

Base: exportações de RLS, políticas, grants e funções do Supabase fornecidas pelo time.

## Conclusão prioritária

Há duas funções diferentes para responder à mesma pergunta: “este tenant tem o módulo?”.

| Camada | Função | Regra atual |
|---|---|---|
| Tela/autenticação | `a1_has_module` | plano ativo/trial **ou** liberação manual em `a1_tenant_modules` |
| RLS de pré-análises | `a1_tem_modulo` | somente liberação manual em `a1_tenant_modules` |

As políticas de `a1_pre_analises`, pessoas, documentos, participantes, análises e transições exigem `a1_tem_modulo('PRE_ANALISE')`. Assim, um tenant cujo plano inclua `PRE_ANALISE`, mas que não tenha a linha manual correspondente, pode enxergar uma rota liberada pela tela e receber bloqueio do banco ao ler/criar. Isso é uma causa concreta para a experiência “liberei, mas não funciona”.

A proposta segura está em `supabase/sql/proposed/align-preanalysis-module-check.sql`. Ela **não foi aplicada**.

## Achados críticos de autorização

1. `a1_e_gestor()` devolve verdadeiro para toda sessão cuja role não seja vazia nem `partner`. Portanto, roles como `user` e `viewer` são tratadas como gestor por `a1_perm()`, `a1_pa_visivel()` e outras funções. É elevação de privilégio potencial.
2. Para parceiros/corretores, `a1_perm()` usa `coalesce(perfil.permissions, parceiro.permissions)`. Quando há perfil, uma permissão concedida somente no cadastro individual do corretor é ignorada; os JSONs não são combinados. Isto é uma causa provável para uma permissão marcada no usuário não surtir efeito.
3. A política `user_permissions_tenant_isolation` permite `ALL` para qualquer registro de permissão pertencente ao mesmo tenant. Um usuário com sessão válida pode potencialmente ler, criar, editar ou apagar permissões de outros usuários, caso a tabela seja alcançável pela aplicação.
4. A política `users_update_admin_or_self` permite que o próprio usuário atualize sua linha, mas o `WITH CHECK` só confirma o tenant. Ela não impede a alteração de campos sensíveis como `role`, se esses campos forem atualizáveis pelo cliente.
5. `anon` e `authenticated` receberam INSERT/SELECT/UPDATE em praticamente todas as tabelas operacionais; a segurança depende integralmente de RLS e do token proprietário no header. RLS está ativo em todas as tabelas listadas, o que é positivo, mas os grants precisam ser reduzidos progressivamente após testes.
6. Onze funções `SECURITY DEFINER` continuam sem `search_path` fixo. Esse resultado é o bloco enviado anteriormente.

## O que ainda não sabemos sobre o corretor específico

A auditoria demonstra os caminhos possíveis, mas não identifica qual cadastro/sessão do corretor foi usado. Execute o diagnóstico por e-mail em `supabase/sql/diagnose-broker-preanalysis-access.sql`. O resultado deve mostrar:

- role da sessão e vínculo em `a1_partners`;
- perfil e permissões efetivas `pa_criar`, `pa_ver` e `pa_editar`;
- direito do plano e a existência de `PRE_ANALISE` em `a1_tenant_modules`;
- se a rota/tela é escondida antes mesmo de chegar ao RLS.

## Ordem segura de correção

1. Rodar a verificação de divergência de módulo e o diagnóstico do corretor.
2. Em staging, alinhar `a1_tem_modulo` com `a1_has_module` e testar um gestor, um corretor permitido e um corretor sem permissão.
3. Definir explicitamente quais roles são gestores; então corrigir `a1_e_gestor`.
4. Combinar permissões de perfil e exceções individuais com regra de negação explícita, em vez de `coalesce`.
5. Separar políticas por operação e restringir grants. Não fazer isso em produção sem testes de persona.
