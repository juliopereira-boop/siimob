-- Restrição opcional por etapa de Leads. Cadastros sem crm_etapas conservam
-- o acesso anterior; o mapa pertence à pessoa, independentemente do perfil.
create function public.a1_crm_etapa_permitida(p_stage uuid, p_editar boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare permissoes jsonb; tipo text; ator uuid; tenant uuid;
begin
  tenant := public.a1_tenant();
  if tenant is null then return false; end if;
  if public.a1_e_gestor() then return true; end if;
  ator := public.a1_ator();
  if ator is null then return false; end if;
  select p.permissions, p.type into permissoes, tipo from public.a1_partners p where p.id=ator and p.tenant_id=tenant and coalesce(p.is_active,true) and coalesce(p.approved,true);
  if not found then return false; end if;
  if tipo <> 'corretor' then return true; end if;
  if not (coalesce(permissoes,'{}'::jsonb) ? 'crm_etapas') then return true; end if;
  if jsonb_typeof(permissoes->'crm_etapas') is distinct from 'object' then return false; end if;
  if p_editar then return coalesce(permissoes->'crm_etapas'->>p_stage::text='editar',false); end if;
  return coalesce(permissoes->'crm_etapas'->>p_stage::text in ('ver','editar'),false);
end $$;
revoke all on function public.a1_crm_etapa_permitida(uuid,boolean) from public;
grant execute on function public.a1_crm_etapa_permitida(uuid,boolean) to anon,authenticated;

create policy a1_crm_etapas_select on public.a1_cases as restrictive for select to anon,authenticated
using (module_key is distinct from 'crm' or public.a1_crm_etapa_permitida(stage_id,false));
create policy a1_crm_etapas_update on public.a1_cases as restrictive for update to anon,authenticated
using (module_key is distinct from 'crm' or public.a1_crm_etapa_permitida(stage_id,true))
with check (module_key is distinct from 'crm' or public.a1_crm_etapa_permitida(stage_id,true));
create policy a1_crm_etapas_insert on public.a1_cases as restrictive for insert to anon,authenticated
with check (module_key is distinct from 'crm' or public.a1_crm_etapa_permitida(stage_id,true));
create policy a1_crm_etapas_delete on public.a1_cases as restrictive for delete to anon,authenticated
using (module_key is distinct from 'crm' or public.a1_crm_etapa_permitida(stage_id,true));

-- Operações privilegiadas seguem a mesma restrição de edição dos leads.

create or replace function a1_atend_enviar(p_atendimento uuid, p_tipo text, p_corpo text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_a a1_atendimentos%rowtype;
  v_corpo text := btrim(coalesce(p_corpo, ''));
  v_nome text := a1_atend_nome_ator();
  v_id uuid;
begin
  if a1_tenant() is null then raise exception 'sem_sessao'; end if;
  if not a1_tem_modulo('ATENDIMENTO') then raise exception 'modulo_desabilitado'; end if;
  if p_tipo not in ('mensagem', 'nota') then raise exception 'tipo_invalido'; end if;
  if v_corpo = '' or length(v_corpo) > 4000 then raise exception 'mensagem_invalida'; end if;
  select * into v_a from a1_atendimentos where id = p_atendimento and tenant_id = a1_tenant();
  if v_a.id is null then raise exception 'conversa_nao_encontrada'; end if;
  if not a1_e_gestor() then
    if v_a.status <> 'distribuida' or not exists (
      select 1 from a1_cases c join a1_partners p on p.id = a1_ator()
       where c.id = v_a.case_id and p.tenant_id = c.tenant_id and p.type = 'corretor'
         and public.a1_crm_etapa_permitida(c.stage_id, true)
         and lower(btrim(p.name)) = lower(btrim(coalesce(c.broker_name, '')))) then
      raise exception 'sem_permissao';
    end if;
  end if;
  if v_a.status = 'encerrada' then raise exception 'conversa_encerrada'; end if;
  insert into a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, autor_nome, tipo, corpo)
  values (v_a.tenant_id, v_a.id, 'atendente', v_nome, p_tipo, v_corpo)
  returning id into v_id;
  update a1_atendimentos
     set ultima_em = now(), pendente = false,
         ultima_previa = left(case when p_tipo = 'nota' then 'Nota: ' else '' end || v_corpo, 140)
   where id = v_a.id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function a1_atend_wa_alvo(p_atendimento uuid)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare v_a a1_atendimentos%rowtype; v_tel text;
begin
  if a1_tenant() is null then raise exception 'sem_sessao'; end if;
  if not a1_tem_modulo('ATENDIMENTO') then raise exception 'modulo_desabilitado'; end if;
  select * into v_a from a1_atendimentos where id = p_atendimento and tenant_id = a1_tenant();
  if v_a.id is null then raise exception 'conversa_nao_encontrada'; end if;
  if not a1_e_gestor() then
    if v_a.status <> 'distribuida' or not exists (
      select 1 from a1_cases c join a1_partners p on p.id = a1_ator()
       where c.id = v_a.case_id and p.tenant_id = c.tenant_id and p.type = 'corretor'
         and public.a1_crm_etapa_permitida(c.stage_id, true)
         and lower(btrim(p.name)) = lower(btrim(coalesce(c.broker_name, '')))) then
      raise exception 'sem_permissao';
    end if;
  end if;
  if v_a.status = 'encerrada' then raise exception 'conversa_encerrada'; end if;
  select regexp_replace(coalesce(c.client_phone, ''), '\D', '', 'g') into v_tel from a1_cases c where c.id = v_a.case_id;
  if coalesce(length(v_tel), 0) < 10 then raise exception 'sem_telefone'; end if;
  return json_build_object(
    'tenant_id', v_a.tenant_id, 'atendimento_id', v_a.id,
    'telefone', case when length(v_tel) <= 11 then '55' || v_tel else v_tel end,
    'autor', a1_atend_nome_ator(),
    'lead_escreveu_24h', exists (select 1 from a1_atendimento_mensagens m
                                  where m.atendimento_id = v_a.id and m.autor_tipo = 'lead'
                                    and m.externo is not null and m.criado_em > now() - interval '24 hours'));
end $$;

create or replace function public.a1_atend_qualificacao_manual(p_atendimento uuid, p_versao int, p_dados jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.a1_atendimentos; item record; atual jsonb; fontes jsonb; fontes_novas jsonb := '{}'::jsonb;
begin
  if public.a1_tenant() is null then raise exception 'sem_sessao'; end if;
  if not coalesce(public.a1_tem_modulo('ATENDIMENTO'),false) or not coalesce(public.a1_tem_modulo('crm'),false) then raise exception 'modulo_desabilitado'; end if;
  if jsonb_typeof(p_dados) is distinct from 'object' then raise exception 'dados_invalidos'; end if;
  for item in select key,value from jsonb_each(p_dados) loop
    if item.key not in ('nome','telefone','email','cpf','empreendimento','renda','cidade','tipo_imovel','quartos','orcamento','prazo','observacoes')
      or jsonb_typeof(item.value) <> 'string' or length(item.value #>> '{}') > 500 then raise exception 'dados_invalidos'; end if;
    if item.key not in ('nome','telefone','email','cpf') then fontes_novas := fontes_novas || jsonb_build_object(item.key, 'humano'); end if;
  end loop;
  if p_dados ? 'nome' and (btrim(p_dados->>'nome') = '' or length(p_dados->>'nome') > 255) then raise exception 'nome_invalido'; end if;
  if p_dados ? 'email' and nullif(btrim(p_dados->>'email'),'') is not null and (length(p_dados->>'email') > 254 or p_dados->>'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'email_invalido'; end if;
  if p_dados ? 'cpf' and nullif(btrim(p_dados->>'cpf'),'') is not null and length(regexp_replace(p_dados->>'cpf','[^0-9]','','g')) <> 11 then raise exception 'cpf_invalido'; end if;
  if p_dados ? 'telefone' and nullif(btrim(p_dados->>'telefone'),'') is not null and length(regexp_replace(p_dados->>'telefone','[^0-9]','','g')) not between 10 and 15 then raise exception 'telefone_invalido'; end if;
  select * into a from public.a1_atendimentos where id=p_atendimento and tenant_id=public.a1_tenant() for update;
  if not found then raise exception 'conversa_nao_encontrada'; end if;
  if a.versao is distinct from p_versao then raise exception 'versao_desatualizada'; end if;
  if a.elia_ativa then raise exception 'elia_ativa'; end if;
  if not coalesce(public.a1_e_gestor(),false) and not coalesce(a.status='distribuida' and a.corretor_id=public.a1_ator(),false) then raise exception 'sem_permissao'; end if;
  select coalesce(payload->'qualificacao','{}'::jsonb), coalesce(payload->'qualificacao_fontes','{}'::jsonb)
    into atual, fontes from public.a1_cases where id=a.case_id and tenant_id=a.tenant_id for update;
  if not found then raise exception 'lead_nao_encontrado'; end if;
  if not exists (select 1 from public.a1_cases c where c.id=a.case_id and c.tenant_id=a.tenant_id and public.a1_crm_etapa_permitida(c.stage_id,true)) then raise exception 'sem_permissao'; end if;
  if jsonb_typeof(atual) <> 'object' or jsonb_typeof(fontes) <> 'object' then raise exception 'dados_invalidos'; end if;
  update public.a1_cases set
    client_name = case when p_dados ? 'nome' then btrim(p_dados->>'nome') else client_name end,
    client_phone = case when p_dados ? 'telefone' then nullif(btrim(p_dados->>'telefone'),'') else client_phone end,
    client_email = case when p_dados ? 'email' then nullif(btrim(p_dados->>'email'),'') else client_email end,
    client_cpf = case when p_dados ? 'cpf' then nullif(btrim(p_dados->>'cpf'),'') else client_cpf end,
    development = case when p_dados ? 'empreendimento' then nullif(btrim(p_dados->>'empreendimento'),'') else development end,
    payload=jsonb_set(jsonb_set(coalesce(payload,'{}'::jsonb),'{qualificacao}',atual || (p_dados - array['nome','telefone','email','cpf']),true),'{qualificacao_fontes}',fontes || fontes_novas,true)
    where id=a.case_id and tenant_id=a.tenant_id;
  update public.a1_atendimentos set versao=versao+1 where id=a.id and tenant_id=a.tenant_id;
end $$;
