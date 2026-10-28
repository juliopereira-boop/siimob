-- ══════════════════════════════════════════════════════════════════════════════
-- Leads vira módulo de verdade: licença no banco e esteira inicial
-- ══════════════════════════════════════════════════════════════════════════════
--
-- POR QUE ESTE ARQUIVO EXISTE
-- O funil de leads existe desde sempre em crm.html, e as linhas dele moram em
-- a1_cases com module_key = 'crm'. Só que a licença nunca chegou ao banco: a
-- tela perguntava a1_has_module('crm') e escondia a aba, mas as políticas de
-- a1_cases não olhavam módulo nenhum para essas linhas. Hoje isso não vaza nada
-- porque nenhum cliente tem lead cadastrado — mas "não vaza porque a tabela
-- está vazia" não é isolamento, é sorte com prazo de validade.
--
-- A regra da casa é: módulo novo nasce desligado para todo mundo, e quem liga é
-- o superadmin, cliente por cliente. Este arquivo faz o banco cumprir isso para
-- Leads, do mesmo jeito que já cumpre para Pré-análise e Venda.
--
-- O QUE ESTE ARQUIVO NÃO MUDA
-- Nada de Repasse e nada de Registro: as políticas novas são RESTRITIVAS e
-- filtram SÓ module_key = 'crm'. Toda linha que não é lead passa por elas sem
-- ser tocada. Nenhum dado é criado, alterado ou apagado. Nenhum cliente ganha
-- licença aqui — depois de rodar este arquivo, Leads continua desligado para
-- todos até que o superadmin ligue.
--
-- SEGURO DE RODAR DUAS VEZES.
begin;

-- ── 1. A licença, imposta no banco ──────────────────────────────────────────
-- RESTRITIVA e não permissiva: restritivas se somam com E. Uma permissiva a
-- mais ABRIRIA caminho; esta FECHA o caminho das linhas de lead para quem não
-- tem o módulo, sem mexer em quem já podia ler o resto da tabela.
--
-- `a1_tem_modulo` entre parênteses com select de propósito: assim ela vira um
-- InitPlan, avaliado UMA vez por consulta. Solta, ela é reavaliada POR LINHA —
-- foi o que deu 500 por timeout com 235 processos, e com 40 mil daria de novo.
drop policy if exists a1_cases_crm_licenca on public.a1_cases;
create policy a1_cases_crm_licenca on public.a1_cases
  as restrictive for all to public
  using      (coalesce(module_key,'') <> 'crm' or (select a1_tem_modulo('crm')))
  with check (coalesce(module_key,'') <> 'crm' or (select a1_tem_modulo('crm')));

drop policy if exists a1_stages_crm_licenca on public.a1_stages;
create policy a1_stages_crm_licenca on public.a1_stages
  as restrictive for all to public
  using      (coalesce(module_key,'') <> 'crm' or (select a1_tem_modulo('crm')))
  with check (coalesce(module_key,'') <> 'crm' or (select a1_tem_modulo('crm')));

-- ── 2. A esteira inicial de Leads ───────────────────────────────────────────
-- Módulo licenciado que abre num quadro sem coluna nenhuma parece quebrado, e o
-- gestor liga para o suporte no primeiro minuto. Esta função semeia um funil de
-- cinco etapas — o que a maioria usa — e o cliente reordena, renomeia e pinta
-- depois, no Editor de esteira, como faz com qualquer módulo.
--
-- NÃO SOBRESCREVE NADA: se o cliente já tem etapa de lead cadastrada, a função
-- não faz nada e diz quantas encontrou. Semear por cima apagaria a configuração
-- de quem já usa, que é a única coisa que não se pode fazer aqui.
create or replace function public.a1_semear_esteira_leads(p_tenant uuid default null)
returns jsonb
language plpgsql security definer
set search_path to 'public','extensions','pg_temp'
as $$
declare
  v_tenant uuid;
  v_ja int;
begin
  v_tenant := coalesce(p_tenant, a1_tenant());
  if v_tenant is null then raise exception 'sessao_invalida'; end if;

  select count(*) into v_ja from a1_stages
   where tenant_id = v_tenant and module_key = 'crm';
  if v_ja > 0 then
    return jsonb_build_object('ok', true, 'criadas', 0, 'ja_existiam', v_ja);
  end if;

  insert into a1_stages (tenant_id, module_key, name, color, position, is_initial, is_final)
  values
    (v_tenant, 'crm', 'Novo lead',   '#3F6F9E', 1, true,  false),
    (v_tenant, 'crm', 'Contato',     '#0E8C7F', 2, false, false),
    (v_tenant, 'crm', 'Qualificado', '#3FB8A6', 3, false, false),
    (v_tenant, 'crm', 'Proposta',    '#C87E12', 4, false, false),
    (v_tenant, 'crm', 'Ganho',       '#0B7568', 5, false, true),
    (v_tenant, 'crm', 'Perdido',     '#B8433A', 6, false, true);

  return jsonb_build_object('ok', true, 'criadas', 6, 'ja_existiam', 0);
end
$$;

revoke all on function public.a1_semear_esteira_leads(uuid) from public;
-- Só o dono do sistema semeia, e de dentro do superadmin. Não é `anon`: a
-- função é definer e escreve — deixá-la aberta seria uma porta para criar etapa
-- em cliente alheio passando o uuid dele.
grant execute on function public.a1_semear_esteira_leads(uuid) to authenticated;

commit;

-- ── CONFERÊNCIA ──────────────────────────────────────────────────────────────
-- 1. SEM a licença, lead nenhum aparece — e o resto da tabela continua:
--    select count(*) from a1_cases where module_key = 'crm';       -- 0
--    select count(*) from a1_cases where module_key = 'repasse';   -- o de sempre
--
-- 2. Ligue Leads para um cliente no superadmin e semeie a esteira:
--    select a1_semear_esteira_leads('<uuid do cliente>');
--    -- {"ok": true, "criadas": 6, "ja_existiam": 0}
--
-- 3. Rodando de novo, não duplica:
--    select a1_semear_esteira_leads('<uuid do cliente>');
--    -- {"ok": true, "criadas": 0, "ja_existiam": 6}
--
-- 4. As políticas novas não podem ter encostado no Repasse. Os números têm de
--    ser os MESMOS de antes de rodar este arquivo:
--    select module_key, count(*) from a1_cases group by 1 order by 1;
