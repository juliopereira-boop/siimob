-- Distribuição exclusiva do serviço da ELIA. Revalida os dados sob bloqueio
-- e usa o mesmo lock da roleta manual para evitar atribuições simultâneas.
grant execute on function public.a1_roleta_proximo(uuid) to service_role;
create function public.a1_elia_roleta(p_tenant uuid, p_atendimento uuid, p_versao integer, p_mensagem uuid, p_no text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  a public.a1_atendimentos; c public.a1_cases; parceiro public.a1_partners;
  etapa public.a1_stages; atual public.a1_stages; node jsonb; campo text; valor text;
  campos text[] := array['nome','telefone','email','cpf','empreendimento','renda','cidade','tipo_imovel','quartos','orcamento','prazo','observacoes'];
  texto text; imob text;
begin
  perform pg_advisory_xact_lock(hashtext('atend-roleta:' || p_tenant::text));
  select * into a from public.a1_atendimentos where tenant_id=p_tenant and id=p_atendimento for update;
  if not found or a.status is distinct from 'aberta' or a.elia_ativa is not true or a.corretor_id is not null or a.versao is distinct from p_versao then return 'conversa_alterada'; end if;
  if not exists (select 1 from public.a1_atendimento_mensagens m where m.id=p_mensagem and m.tenant_id=p_tenant and m.atendimento_id=a.id and m.autor_tipo='lead' and m.tipo='mensagem' and not exists (select 1 from public.a1_atendimento_mensagens n where n.tenant_id=p_tenant and n.atendimento_id=a.id and n.tipo='mensagem' and n.autor_tipo in ('lead','atendente') and (n.criado_em,n.id) > (m.criado_em,m.id))) then return 'conversa_alterada'; end if;
  select e into node from public.a1_elia_config cfg cross join lateral jsonb_array_elements(cfg.flow) e where cfg.tenant_id=p_tenant and cfg.enabled and e->>'id'=p_no and e->>'type'='roulette' for share of cfg;
  if node is null or jsonb_typeof(node->'fields') <> 'array' or jsonb_array_length(node->'fields') = 0 then return 'configuracao_invalida'; end if;
  select * into c from public.a1_cases where tenant_id=p_tenant and id=a.case_id and module_key='crm' for update;
  if not found then return 'lead_nao_encontrado'; end if;
  for campo in select jsonb_array_elements_text(node->'fields') loop
    if not campo=any(campos) then return 'configuracao_invalida'; end if;
    valor := case campo when 'nome' then c.client_name when 'telefone' then c.client_phone when 'email' then c.client_email when 'cpf' then c.client_cpf else c.payload->'qualificacao'->>campo end;
    if nullif(btrim(valor),'') is null then return 'qualificacao_incompleta'; end if;
  end loop;
  select * into parceiro from public.a1_partners where tenant_id=p_tenant and id=public.a1_roleta_proximo(p_tenant) and type='corretor' and coalesce(is_active,true) and coalesce(approved,true);
  if not found then return 'roleta_vazia'; end if;
  select * into atual from public.a1_stages where tenant_id=p_tenant and id=c.stage_id and module_key='crm';
  select * into etapa from public.a1_stages where tenant_id=p_tenant and module_key='crm' and coalesce(group_key,'geral')=coalesce(atual.group_key,'geral') and selo='EM_ATENDIMENTO' limit 1;
  if etapa.id is null then return 'etapa_nao_configurada'; end if;
  imob := nullif(parceiro.extra->>'imobiliaria_id','');
  update public.a1_cases set broker_name=parceiro.name, stage_id=etapa.id, stage_name=etapa.name, stage_entered_at=now(),
    real_estate_name=coalesce((select name from public.a1_partners where tenant_id=p_tenant and id::text=imob),real_estate_name),
    payload=jsonb_set(coalesce(payload,'{}'::jsonb),'{crm_refs}',coalesce(payload->'crm_refs','{}'::jsonb) || jsonb_build_object('corretor_id',parceiro.id::text) || case when imob is not null then jsonb_build_object('imobiliaria_id',imob) else '{}'::jsonb end,true)
    where tenant_id=p_tenant and id=c.id;
  update public.a1_lead_roleta set ultimo=parceiro.id, atualizado_em=now() where tenant_id=p_tenant;
  texto := 'Lead qualificado pela ELIA e distribuído pela roleta para ' || parceiro.name || '. Etapa: ' || etapa.name || '.';
  update public.a1_atendimentos set status='distribuida',resultado='qualificado',elia_ativa=false,corretor_id=parceiro.id,corretor_nome=parceiro.name,finalizado_por='ELIA',finalizado_em=now(),versao=versao+1,ultima_em=now(),pendente=false,ultima_previa=left(texto,140) where tenant_id=p_tenant and id=a.id;
  insert into public.a1_events(tenant_id,case_id,type,description,actor_name) values (p_tenant,c.id,'distribuicao',left(texto,300),'ELIA');
  insert into public.a1_atendimento_mensagens(tenant_id,atendimento_id,autor_tipo,tipo,corpo) values (p_tenant,a.id,'sistema','nota',left(texto,4000));
  return 'distribuido';
end $$;
revoke all on function public.a1_elia_roleta(uuid,uuid,integer,uuid,text) from public, anon, authenticated;
grant execute on function public.a1_elia_roleta(uuid,uuid,integer,uuid,text) to service_role;
