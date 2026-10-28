-- Base de acesso e dossiê da Pré-análise.
-- Pode ser executado com segurança após as migrações anteriores.

-- Analista/correspondente precisa enxergar titular e histórico do processo
-- atribuído a ele, não apenas o cartão.
alter policy a1_pa_pessoas_ler on public.a1_pa_pessoas
using (
  tenant_id = a1_tenant()
  and a1_tem_modulo('PRE_ANALISE')
  and (
    a1_e_gestor()
    or a1_perm('gerente')
    or (criado_por is not null and criado_por = a1_ator())
    or exists (
      select 1 from public.a1_pa_participantes pp
      join public.a1_pre_analises pa on pa.id = pp.pre_analise_id
      where pp.pessoa_id = a1_pa_pessoas.id
        and a1_pa_visivel(pa.corretor_id, pa.empresa_id, pa.analista_id, pa.correspondente_id)
    )
  )
);

alter policy a1_pa_eventos_ler on public.a1_pa_eventos
using (
  tenant_id = a1_tenant()
  and a1_tem_modulo('PRE_ANALISE')
  and exists (
    select 1 from public.a1_pre_analises pa
    where pa.id = a1_pa_eventos.pre_analise_id
      and a1_pa_visivel(pa.corretor_id, pa.empresa_id, pa.analista_id, pa.correspondente_id)
  )
);

-- Quem pode editar a pré-análise pode cadastrar e vincular mais uma pessoa.
alter policy a1_pa_pessoas_criar on public.a1_pa_pessoas
with check (
  tenant_id = a1_tenant()
  and a1_tem_modulo('PRE_ANALISE')
  and (a1_perm('pa_criar') or a1_perm('pa_editar'))
);

-- Separa editar de mover preservando as pessoas já autorizadas hoje.
update public.a1_partners
set permissions = jsonb_set(coalesce(permissions, '{}'::jsonb), '{pa_mover}', 'true'::jsonb)
where coalesce(permissions, '{}'::jsonb) ? 'pa_editar'
  and not coalesce(permissions, '{}'::jsonb) ? 'pa_mover';

update public.a1_partners
set permissions = jsonb_set(coalesce(permissions, '{}'::jsonb), '{co_mover}', 'true'::jsonb)
where coalesce(permissions, '{}'::jsonb) ? 'co_editar'
  and not coalesce(permissions, '{}'::jsonb) ? 'co_mover';

update public.a1_perfis
set permissions = jsonb_set(coalesce(permissions, '{}'::jsonb), '{pa_mover}', 'true'::jsonb)
where coalesce(permissions, '{}'::jsonb) ? 'pa_editar'
  and not coalesce(permissions, '{}'::jsonb) ? 'pa_mover';

update public.a1_perfis
set permissions = jsonb_set(coalesce(permissions, '{}'::jsonb), '{co_mover}', 'true'::jsonb)
where coalesce(permissions, '{}'::jsonb) ? 'co_editar'
  and not coalesce(permissions, '{}'::jsonb) ? 'co_mover';

do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'a1_pa_transicionar' limit 1;
  execute replace(v_def, $old$a1_perm('pa_editar')$old$, $new$a1_perm('pa_mover')$new$);

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'a1_co_transicionar' limit 1;
  execute replace(v_def, $old$a1_perm('co_editar')$old$, $new$a1_perm('co_mover')$new$);
end $do$;

-- Selos editáveis de workflow: a automação usa o significado da etapa,
-- não seu nome, que o gestor pode alterar.
alter table public.a1_pa_situacoes add column if not exists selo text null;
alter table public.a1_co_situacoes add column if not exists selo text null;

alter table public.a1_pa_situacoes drop constraint if exists a1_pa_situacoes_selo_check;
alter table public.a1_pa_situacoes add constraint a1_pa_situacoes_selo_check
  check (selo is null or selo in ('INICIO','FIM_POSITIVO','FIM_NEGATIVO'));

alter table public.a1_co_situacoes drop constraint if exists a1_co_situacoes_selo_check;
alter table public.a1_co_situacoes add constraint a1_co_situacoes_selo_check
  check (selo is null or selo in ('INICIO','VENDIDO','FIM_NEGATIVO'));


-- Ao registrar aprovação de crédito, avança para o fim positivo e deixa trilha.
-- A função não é endpoint público: só o trigger a executa.
create or replace function public.a1_pa_avancar_credito_aprovado()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_para uuid; v_de uuid;
begin
  if new.status <> 'APROVADO' then return new; end if;
  select situacao_id into v_de from public.a1_pre_analises
   where id = new.pre_analise_id and tenant_id = new.tenant_id;
  select id into v_para from public.a1_pa_situacoes
   where tenant_id = new.tenant_id and ativo and selo = 'FIM_POSITIVO'
   order by ordem limit 1;
  if v_para is null or v_de is null or v_para = v_de then return new; end if;
  perform set_config('a1.orquestrador', '1', true);
  update public.a1_pre_analises set situacao_id = v_para, versao = versao + 1,
    atualizado_em = now() where id = new.pre_analise_id and tenant_id = new.tenant_id;
  insert into public.a1_pa_eventos
    (tenant_id, pre_analise_id, evento, de_situacao, para_situacao, ator_id, detalhe)
  values (new.tenant_id, new.pre_analise_id, 'transicao_automatica_credito', v_de, v_para,
    a1_ator(), jsonb_build_object('motivo','Decisão de crédito aprovada','analise_credito_id',new.id));
  return new;
end;
$$;
revoke all on function public.a1_pa_avancar_credito_aprovado() from public;
drop trigger if exists a1_pa_avancar_credito_aprovado on public.a1_pa_analises_credito;
create trigger a1_pa_avancar_credito_aprovado after insert on public.a1_pa_analises_credito
for each row execute function public.a1_pa_avancar_credito_aprovado();
