-- Correções de produção: CPF configurável, autoria nas criações e permissão
-- da ação Pré-análise -> Venda no modelo de sessão próprio do SIIMOB.
-- Aditiva e idempotente. Não apaga pessoas nem reescreve histórico antigo.
begin;

set local search_path = public, extensions, pg_temp;

-- O navegador usa a chave pública (`anon`) e a identidade real vem de
-- a1_sessao()/a1_perm(). A migration de 13/09 havia retirado EXECUTE de anon,
-- portanto o PostgREST barrava com 401 antes de a função validar tenant,
-- carteira e pa_iniciar_venda. Restauramos só a entrada; as verificações
-- internas continuam sendo a autorização efetiva.
revoke all on function public.a1_pa_executar_acao(uuid,text) from public;
grant execute on function public.a1_pa_executar_acao(uuid,text) to anon, authenticated;

-- A configuração geral governa apenas o cadastro de PESSOAS da Pré-análise.
-- CPF de login em a1_users/a1_partners continua com as travas próprias.
create or replace function public.a1_pa_validar_documento_duplicado()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_geral jsonb := '{}'::jsonb;
  v_permite boolean := false;
begin
  if new.tenant_id is distinct from public.a1_tenant() then
    raise exception 'tenant_invalido';
  end if;

  new.documento := nullif(regexp_replace(coalesce(new.documento,''),'\D','','g'),'');
  if new.documento is null then return new; end if;

  select case
           when jsonb_typeof(value::jsonb) = 'object' then value::jsonb
           else '{}'::jsonb
         end
    into v_geral
    from public.a1_config
   where tenant_id = new.tenant_id and key = 'geral'
   limit 1;
  v_permite := coalesce((v_geral->>'permitir_cpf_duplicado')::boolean, false);

  if not v_permite then
    -- Serializa duas inclusões simultâneas do mesmo CPF sem manter um índice
    -- UNIQUE que impediria justamente o modo configurável.
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.documento, 0));
    if exists (
      select 1 from public.a1_pa_pessoas p
       where p.tenant_id = new.tenant_id
         and p.documento = new.documento
         and p.id is distinct from new.id
    ) then
      raise exception 'cpf_duplicado' using errcode = '23505';
    end if;
  end if;
  return new;
exception
  when invalid_text_representation then
    -- Configuração antiga ou corrompida nunca abre a trava por acidente.
    raise exception 'configuracao_cpf_invalida';
end;
$$;

revoke all on function public.a1_pa_validar_documento_duplicado() from public, anon, authenticated;
drop trigger if exists a1_pa_validar_documento_duplicado_t on public.a1_pa_pessoas;
create trigger a1_pa_validar_documento_duplicado_t
before insert or update of tenant_id, documento on public.a1_pa_pessoas
for each row execute function public.a1_pa_validar_documento_duplicado();

-- A unicidade passa a ser decidida pelo gatilho acima. O índice comum mantém
-- rápida a busca por CPF e a verificação de duplicidade.
drop index if exists public.idx_pa_pessoa_doc;
create index if not exists idx_pa_pessoa_doc_busca
  on public.a1_pa_pessoas (tenant_id, documento)
  where documento is not null and documento <> '';

-- Toda criação nos módulos genéricos ganha uma linha real de histórico com
-- snapshot de nome e papel pelo trigger instalado em 18/09. Isso substitui a
-- linha visual sem autoria que as telas precisavam inventar.
alter table public.a1_events add column if not exists actor_role text;

create or replace function public.a1_auditar_criacao_case()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  insert into public.a1_events (tenant_id, case_id, type, description)
  values (new.tenant_id, new.id, 'created',
    case new.module_key
      when 'crm' then 'Lead cadastrado'
      when 'repasse' then 'Processo de Repasse cadastrado'
      when 'registro' then 'Processo de Registro cadastrado'
      else 'Processo cadastrado'
    end);
  return new;
end;
$$;
revoke all on function public.a1_auditar_criacao_case() from public, anon, authenticated;
drop trigger if exists a1_cases_auditar_criacao_t on public.a1_cases;
create trigger a1_cases_auditar_criacao_t
after insert on public.a1_cases
for each row execute function public.a1_auditar_criacao_case();

-- A Pré-análise já audita participantes, crédito, documentos, alterações e
-- transições. Faltava somente a própria criação do processo.
create or replace function public.a1_pa_auditar_criacao()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  insert into public.a1_pa_eventos
    (tenant_id, pre_analise_id, evento, ator_id, ator_nome, detalhe)
  values
    (new.tenant_id, new.id, 'pre_analise_criada', public.a1_ator(),
     public.a1_auditoria_nome(), jsonb_build_object('codigo',new.codigo));
  return new;
end;
$$;
revoke all on function public.a1_pa_auditar_criacao() from public, anon, authenticated;
drop trigger if exists a1_pa_auditar_criacao_t on public.a1_pre_analises;
create trigger a1_pa_auditar_criacao_t
after insert on public.a1_pre_analises
for each row execute function public.a1_pa_auditar_criacao();

commit;

-- Conferência depois de executar:
-- 1) select has_function_privilege('anon','public.a1_pa_executar_acao(uuid,text)','execute'); -- true
-- 2) desligue permitir_cpf_duplicado e tente repetir um CPF: deve retornar cpf_duplicado.
-- 3) ligue a opção e repita: as duas pessoas devem existir no mesmo tenant.
-- 4) crie um Lead e confira actor_name + actor_role em a1_events.
