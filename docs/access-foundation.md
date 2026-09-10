# Fundação de Acesso e Carteiras

## Objetivo

Preparar o SIIMOB para um modelo profissional de acesso, inspirado na operação do CV CRM: cada pessoa enxerga e atua apenas dentro da sua carteira, equipe, empresa e responsabilidades.

Esta fase não altera páginas em produção, não substitui as políticas atuais e não executa SQL no Supabase. Ela estabelece o contrato de acesso, o inventário a validar e o rollout em modo de observação.

## Estado atual mapeado

- A interface usa páginas HTML monolíticas conectadas diretamente ao Supabase.
- CRM, Repasse e Registro compartilham `a1_cases`, `a1_stages` e `a1_events`, separados por `module_key`.
- Há lógica de parceiros, empresas, analistas, correspondentes, módulos e transições no banco.
- O banco contém domínios mais recentes (`a1_pre_analises` e `a1_comerciais`) que ainda não aparecem neste repositório.
- A função atual `a1_e_gestor()` considera gestor todo usuário cujo papel não seja `partner`. Isso não deve ser usado como regra definitiva de autorização.

## Contrato de autorização

Toda decisão deve responder a três perguntas:

1. **Quem** é o ator? Papel, tenant, empresa, equipe e vínculo de carteira.
2. **O que** ele pode fazer? Uma capacidade explícita, como `lead.update` ou `repasse.transition`.
3. **Sobre qual dado**? Escopo próprio, equipe, empresa, tenant ou plataforma.

```
permitido = tenant compatível
         && capacidade concedida
         && escopo do recurso compatível
```

A interface pode ocultar ações indisponíveis, mas a API/RPC e o banco devem ser a fonte final da autorização.

## Papéis iniciais

| Papel | Escopo principal |
|---|---|
| superadmin | Plataforma inteira; fora de qualquer tenant |
| tenant_owner | Tenant inteiro |
| tenant_admin | Tenant, sujeito às capacidades administrativas concedidas |
| gestor | Equipes e carteiras sob sua gestão |
| analista | Carteira/equipe atribuída |
| imobiliaria_gestor | Imobiliária e corretores vinculados |
| corretor | Próprios leads, oportunidades, tarefas e propostas |
| correspondente | Processos e empresas atribuídos |
| cliente | Própria jornada no futuro portal |

Os nomes podem evoluir, mas `user` e `viewer` não podem receber implicitamente poderes de gestor.

## Capacidades

### CRM
- `lead.read.own`, `lead.read.team`, `lead.read.tenant`
- `lead.create`, `lead.update.own`, `lead.assign`, `lead.transition`
- `task.create`, `task.update.own`, `interaction.create`
- `proposal.create`, `proposal.submit`, `proposal.approve`

### Comercial
- `reservation.create`, `reservation.transition`
- `contract.create`, `contract.sign`
- `inventory.read`, `inventory.reserve`

### Operação
- `pre_analysis.read`, `pre_analysis.transition`
- `repasse.read`, `repasse.update`, `repasse.transition`
- `registro.read`, `registro.update`, `registro.transition`

### Administração
- `workflow.manage`, `catalog.manage`
- `team.manage`, `access.manage`
- `reports.read`, `billing.manage`

## Escopos

| Escopo | Regra |
|---|---|
| own | O ator é o responsável do recurso |
| team | O responsável pertence a uma equipe sob gestão do ator |
| company | O recurso pertence à empresa/imobiliária/correspondente do ator |
| tenant | O recurso pertence ao mesmo tenant |
| platform | Apenas superadmin |

## Implementação segura

1. Inventariar RLS, grants e RPCs com `supabase/sql/access-audit.sql`.
2. Corrigir a semântica de papel no banco em uma migration revisada.
3. Criar uma função central de autorização e políticas por recurso.
4. Registrar decisões em modo sombra: observar o que a nova regra permitiria ou bloquearia, sem bloquear usuários.
5. Validar com personas de teste: corretor, gestor, imobiliária, correspondente e tenant admin.
6. Ativar por módulo e por tenant por meio de feature flag.
7. Somente então tornar a nova política mandatória e remover a regra antiga.

## Critérios de aceite

- Um corretor não lê, edita ou movimenta recurso de outro corretor sem vínculo de equipe.
- Um gestor só acessa as equipes designadas.
- Um correspondente não acessa processos fora da empresa atribuída.
- A URL direta, REST e RPC obedecem a mesma regra da interface.
- Toda transição registra ator, origem, destino, data e justificativa quando exigida.
- Toda política possui testes de permissão e negação.

## Próxima decisão antes da migration

Não aplicar mudanças de RLS ou permissões até a auditoria registrar as políticas e grants reais do projeto. A migration deve ser aditiva, reversível e testada fora de produção.
