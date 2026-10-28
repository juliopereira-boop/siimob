-- Auditoria append-only de atividades de Pré-análise e Venda.
-- Funções sincronizadas com a migração aplicada em produção em 2026-09-12.

CREATE OR REPLACE FUNCTION public.a1_co_auditar_alteracao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_campos text[];
begin
  select coalesce(array_agg(k order by k),array[]::text[]) into v_campos
  from (
    select k from jsonb_object_keys(to_jsonb(new)) k
    where k not in ('situacao_id','situacao_em','versao','atualizado_em','repasse_case_id')
      and (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k)
  ) s;
  if cardinality(v_campos)>0 then
    insert into public.a1_co_eventos (tenant_id,comercial_id,evento,ator_id,ator_nome,detalhe)
    values (new.tenant_id,new.id,'dados_atualizados',a1_ator(),a1_evento_nome_ator(),
      jsonb_build_object('campos',to_jsonb(v_campos)));
  end if;
  return new;
end $function$

CREATE OR REPLACE FUNCTION public.a1_co_auditar_contrato()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if tg_op='INSERT' or new.status is distinct from old.status then
    insert into public.a1_co_eventos (tenant_id,comercial_id,evento,ator_id,ator_nome,detalhe)
    values (new.tenant_id,new.comercial_id,
      case when tg_op='INSERT' then 'contrato_registrado' else 'contrato_status_alterado' end,
      a1_ator(),a1_evento_nome_ator(),jsonb_build_object('versao',new.versao,'status',new.status,
        'status_anterior',case when tg_op='INSERT' then null else old.status end));
  end if;
  return new;
end $function$

CREATE OR REPLACE FUNCTION public.a1_evento_nome_ator()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_nome text;
begin
  select name into v_nome from public.a1_partners
   where id = a1_ator() and tenant_id = a1_tenant();
  return coalesce(v_nome, initcap(replace(coalesce(a1_tipo_ator(), 'sistema'),'_',' ')));
end
$function$

CREATE OR REPLACE FUNCTION public.a1_pa_auditar_alteracao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_campos text[];
begin
  select coalesce(array_agg(k order by k),array[]::text[]) into v_campos
  from (
    select k from jsonb_object_keys(to_jsonb(new)) k
    where k not in ('situacao_id','situacao_em','versao','atualizado_em')
      and (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k)
  ) s;
  if cardinality(v_campos)>0 then
    insert into public.a1_pa_eventos (tenant_id,pre_analise_id,evento,ator_id,ator_nome,detalhe)
    values (new.tenant_id,new.id,'dados_atualizados',a1_ator(),a1_evento_nome_ator(),
      jsonb_build_object('campos',to_jsonb(v_campos)));
  end if;
  return new;
end $function$

CREATE OR REPLACE FUNCTION public.a1_pa_auditar_credito()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  insert into public.a1_pa_eventos (tenant_id,pre_analise_id,evento,ator_id,ator_nome,detalhe)
  values (new.tenant_id,new.pre_analise_id,'decisao_credito_registrada',
    a1_ator(),a1_evento_nome_ator(),jsonb_build_object('status',new.status,'versao',new.versao,'valor_total',new.valor_total));
  return new;
end $function$

CREATE OR REPLACE FUNCTION public.a1_pa_auditar_documento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into public.a1_pa_eventos (tenant_id,pre_analise_id,evento,ator_id,ator_nome,detalhe)
    values (new.tenant_id,new.pre_analise_id,'documento_enviado',a1_ator(),a1_evento_nome_ator(),
      jsonb_build_object('tipo',new.tipo,'arquivo',new.nome_arquivo,'status',new.status));
  elsif new.status is distinct from old.status then
    insert into public.a1_pa_eventos (tenant_id,pre_analise_id,evento,ator_id,ator_nome,detalhe)
    values (new.tenant_id,new.pre_analise_id,'documento_status_alterado',a1_ator(),a1_evento_nome_ator(),
      jsonb_build_object('tipo',new.tipo,'de',old.status,'para',new.status,'arquivo',new.nome_arquivo));
  end if;
  return new;
end $function$

CREATE OR REPLACE FUNCTION public.a1_pa_auditar_participante()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into public.a1_pa_eventos (tenant_id,pre_analise_id,evento,ator_id,ator_nome,detalhe)
  values (r.tenant_id,r.pre_analise_id,
    case when tg_op='DELETE' then 'participante_removido' else 'participante_adicionado' end,
    a1_ator(),a1_evento_nome_ator(),jsonb_build_object('papel',r.papel,'pessoa_id',r.pessoa_id));
  return r;
end $function$


revoke all on function public.a1_evento_nome_ator() from public, anon, authenticated;
revoke all on function public.a1_pa_auditar_credito() from public, anon, authenticated;
revoke all on function public.a1_pa_auditar_documento() from public, anon, authenticated;
revoke all on function public.a1_pa_auditar_participante() from public, anon, authenticated;
revoke all on function public.a1_pa_auditar_alteracao() from public, anon, authenticated;
revoke all on function public.a1_co_auditar_alteracao() from public, anon, authenticated;
revoke all on function public.a1_co_auditar_contrato() from public, anon, authenticated;

drop trigger if exists trg_pa_auditar_credito on public.a1_pa_analises_credito;
create trigger trg_pa_auditar_credito after insert on public.a1_pa_analises_credito for each row execute function public.a1_pa_auditar_credito();
drop trigger if exists trg_pa_auditar_documento on public.a1_pa_documentos;
create trigger trg_pa_auditar_documento after insert or update on public.a1_pa_documentos for each row execute function public.a1_pa_auditar_documento();
drop trigger if exists trg_pa_auditar_participante on public.a1_pa_participantes;
create trigger trg_pa_auditar_participante after insert or delete on public.a1_pa_participantes for each row execute function public.a1_pa_auditar_participante();
drop trigger if exists trg_pa_auditar_alteracao on public.a1_pre_analises;
create trigger trg_pa_auditar_alteracao after update on public.a1_pre_analises for each row execute function public.a1_pa_auditar_alteracao();
drop trigger if exists trg_co_auditar_alteracao on public.a1_comerciais;
create trigger trg_co_auditar_alteracao after update on public.a1_comerciais for each row execute function public.a1_co_auditar_alteracao();
drop trigger if exists trg_co_auditar_contrato on public.a1_co_contratos;
create trigger trg_co_auditar_contrato after insert or update on public.a1_co_contratos for each row execute function public.a1_co_auditar_contrato();
