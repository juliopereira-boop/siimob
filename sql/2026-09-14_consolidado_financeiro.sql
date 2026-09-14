-- ══════════════════════════════════════════════════════════════════════════════
-- ver_consolidado_financeiro — o corte de AGREGADO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- POR QUE ESTE ARQUIVO EXISTE
-- O painel tinha um corte só. O de LINHA (quais processos entram na conta) é do
-- RLS e sempre esteve certo. O de AGREGADO (posso ver soma em R$ do cliente
-- inteiro e nome de terceiro num ranking) não existia: o painel somava em reais
-- tudo que o RLS entregasse, e `ver_todos_analistas` entrega a carteira INTEIRA.
--
-- Medido nesta base em 14/09, antes desta mudança:
--   · Ana Carolina (cca, S T Empreendimentos) tem ver_todos_analistas = true e
--     ver_dashboard_venda = true. Ela abre o painel e lê o VGV contratado e o
--     pipeline em reais da operação INTEIRA da S T. Papel operacional lendo
--     número de dono.
--   · Os 7 analistas da S T têm ver_todos_analistas = true e ainda carregam a
--     chave velha `ver_dashboard`. A migração 2026-09-13_migra_dashboard_por_modulo
--     AINDA NÃO FOI RODADA nesta base — e quando for, ela concede os cinco
--     dashboards a quem tinha a chave velha. Ou seja: rodar aquela migração,
--     sem este corte, daria a sete analistas com a carteira inteira aberta o
--     VGV consolidado da S T. Este arquivo tem de ser rodado ANTES.
--
-- O QUE A MARCA FAZ
-- Sem ela o painel NÃO some — some o dinheiro. Pipeline vira "negócios em
-- aberto", contratos assinados perdem o valor no rodapé, ticket médio sai da
-- grade, os rankings ordenam por contratos e a coluna Valor da fila sai inteira.
-- A pessoa continua trabalhando; o caixa é que para de aparecer.
--
-- QUEM NÃO PRECISA DELA
-- Gestor (owner/admin) e quem tem `gerente` = true. O painel resolve os dois em
-- código (pnEhGestor), porque `gerente` já significa "enxerga a carteira inteira
-- como o gestor". Conceder a marca a eles faria uma caixa que não muda nada — e
-- pior: desmarcar `gerente` depois deixaria a pessoa com o consolidado que
-- deveria ter perdido junto.
--
-- QUEM RECEBE AQUI
-- Coordenador. Ele responde por equipe, negocia prazo com correspondente e
-- precisa do número em reais para isso. Analista, correspondente comum e
-- corretor NÃO recebem: é exatamente a exposição que este corte fecha. O gestor
-- concede caso a caso em Configurações › Perfis, marcando
-- "Ver valores consolidados (R$)" — é uma caixa, não um chamado.
--
-- SEGURO DE RODAR DUAS VEZES: o `||` sobrescreve a mesma chave com o mesmo valor.
begin;

update public.a1_partners
set permissions = coalesce(permissions, '{}'::jsonb)
               || jsonb_build_object('ver_consolidado_financeiro', true)
where type = 'coordenador';

-- Perfis: hoje a tabela está VAZIA nesta base (nenhum parceiro usa perfil_id
-- ainda), então este comando não altera nada agora. Fica porque o dia em que o
-- primeiro perfil de coordenador for criado é o dia em que alguém esqueceria
-- desta marca — e chave ausente, neste sistema, significa "não pode".
update public.a1_perfis
set permissions = coalesce(permissions, '{}'::jsonb)
               || jsonb_build_object('ver_consolidado_financeiro', true)
where lower(coalesce(nome, '')) like '%coordenador%';

commit;

-- ── CONFERÊNCIA ──────────────────────────────────────────────────────────────
-- Quem passa a ver o consolidado, e por qual caminho. `gerente` aparece como
-- "por ser gerente" porque esses não dependem da marca.
--
-- select p.type, p.name, t.name as cliente,
--   case
--     when coalesce(p.permissions->>'gerente','false') in ('true','t','1') then 'por ser gerente'
--     when coalesce(p.permissions->>'ver_consolidado_financeiro','false') in ('true','t','1') then 'pela marca'
--     else 'NÃO vê valores consolidados'
--   end as consolidado
-- from public.a1_partners p
-- left join public.a1_tenants t on t.id = p.tenant_id
-- where coalesce(p.permissions->>'ver_dashboard_venda','false') in ('true','t','1')
--    or coalesce(p.permissions->>'ver_dashboard_pre_analise','false') in ('true','t','1')
-- order by t.name, p.type, p.name;
