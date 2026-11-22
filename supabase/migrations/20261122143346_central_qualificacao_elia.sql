-- Dados adicionais de qualificação ficam sob payload.qualificacao; os demais
-- dados do lead e das integrações são preservados.
create function public.a1_atend_qualificacao_manual(p_atendimento uuid, p_versao int, p_dados jsonb)
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
revoke all on function public.a1_atend_qualificacao_manual(uuid,int,jsonb) from public;
grant execute on function public.a1_atend_qualificacao_manual(uuid,int,jsonb) to anon, authenticated;

-- Serviço da ELIA: preserva dados humanos e nunca grava após retomada humana.
create function public.a1_elia_qualificacao(p_tenant uuid, p_atendimento uuid, p_versao int, p_mensagem uuid, p_dados jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare a public.a1_atendimentos; item record; atual jsonb; fontes jsonb; novos jsonb := '{}'::jsonb; fontes_novas jsonb := '{}'::jsonb; v_nome text; v_email text; v_cpf text;
begin
  if jsonb_typeof(p_dados) is distinct from 'object' then return false; end if;
  for item in select key,value from jsonb_each(p_dados) loop
    if item.key not in ('nome','email','cpf','empreendimento','renda','cidade','tipo_imovel','quartos','orcamento','prazo','observacoes')
      or jsonb_typeof(item.value) <> 'string' or length(item.value #>> '{}') > 500 then return false; end if;
  end loop;
  if p_dados ? 'nome' and length(p_dados->>'nome') > 255 then return false; end if;
  if p_dados ? 'email' and (length(p_dados->>'email') > 254 or p_dados->>'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then return false; end if;
  if p_dados ? 'cpf' and length(regexp_replace(p_dados->>'cpf','[^0-9]','','g')) <> 11 then return false; end if;
  select * into a from public.a1_atendimentos where id=p_atendimento and tenant_id=p_tenant for update;
  if not found or not a.elia_ativa or a.status <> 'aberta' or a.corretor_id is not null or a.versao is distinct from p_versao then return false; end if;
  if not exists (select 1 from public.a1_atendimento_mensagens m
    where m.id=p_mensagem and m.tenant_id=p_tenant and m.atendimento_id=a.id and m.autor_tipo='lead' and m.tipo='mensagem'
      and not exists (select 1 from public.a1_atendimento_mensagens newer
        where newer.tenant_id=p_tenant and newer.atendimento_id=a.id and newer.tipo='mensagem'
          and newer.autor_tipo in ('lead','atendente') and (newer.criado_em,newer.id) > (m.criado_em,m.id))) then return false; end if;
  select coalesce(payload->'qualificacao','{}'::jsonb), coalesce(payload->'qualificacao_fontes','{}'::jsonb), client_name, client_email, client_cpf
    into atual, fontes, v_nome, v_email, v_cpf from public.a1_cases where id=a.case_id and tenant_id=p_tenant for update;
  if not found then return false; end if;
  if jsonb_typeof(atual) <> 'object' or jsonb_typeof(fontes) <> 'object' then return false; end if;
  for item in select key,value from jsonb_each(p_dados) loop
    if item.key in ('nome','email','cpf') then
      if (item.key='nome' and nullif(btrim(v_nome),'') is null) or (item.key='email' and nullif(btrim(v_email),'') is null) or (item.key='cpf' and nullif(btrim(v_cpf),'') is null) then
        novos := novos || jsonb_build_object(item.key, item.value);
      end if;
      continue;
    end if;
    if (fontes->>item.key = 'elia' or (not fontes ? item.key and nullif(btrim(atual->>item.key),'') is null))
       and nullif(btrim(item.value #>> '{}'),'') is not null then
      novos := novos || jsonb_build_object(item.key, item.value);
      fontes_novas := fontes_novas || jsonb_build_object(item.key, 'elia');
    end if;
  end loop;
  if novos <> '{}'::jsonb then
    update public.a1_cases set
      client_name = case when novos ? 'nome' then nullif(btrim(novos->>'nome'),'') else client_name end,
      client_email = case when novos ? 'email' then nullif(btrim(novos->>'email'),'') else client_email end,
      client_cpf = case when novos ? 'cpf' then nullif(btrim(novos->>'cpf'),'') else client_cpf end,
      payload=jsonb_set(jsonb_set(coalesce(payload,'{}'::jsonb),'{qualificacao}',atual || (novos - array['nome','email','cpf']),true),'{qualificacao_fontes}',fontes || fontes_novas,true)
      where id=a.case_id and tenant_id=p_tenant;
  end if;
  return true;
end $$;
revoke all on function public.a1_elia_qualificacao(uuid,uuid,int,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.a1_elia_qualificacao(uuid,uuid,int,uuid,jsonb) to service_role;
