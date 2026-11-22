-- Seleção do responsável e controle da ELIA por conversa.
alter table public.a1_atendimentos add column elia_ativa boolean not null default false;

create function public.a1_atend_finalizar_com_corretor(
  p_atendimento uuid, p_resultado text, p_versao int,
  p_motivo text, p_obs text, p_corretor uuid)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_a a1_atendimentos%rowtype;
  v_c a1_cases%rowtype;
  v_atual a1_stages%rowtype;
  v_alvo a1_stages%rowtype;
  v_ini a1_stages%rowtype;
  v_corretor a1_partners%rowtype;
  v_imob_id text;
  v_imob_nome text;
  v_nome text := a1_atend_nome_ator();
  v_texto text;
begin
  if not coalesce(a1_e_gestor(),false) then raise exception 'sem_permissao'; end if;
  if not a1_tem_modulo('ATENDIMENTO') or not a1_tem_modulo('crm') then raise exception 'modulo_desabilitado'; end if;
  if p_resultado not in ('qualificado', 'desqualificado') then raise exception 'resultado_invalido'; end if;

  -- Lock por cliente: a roleta não pode dar o mesmo "próximo" a dois leads
  -- finalizados ao mesmo tempo. Relê depois do lock.
  perform pg_advisory_xact_lock(hashtext('atend-roleta:' || a1_tenant()::text));
  select * into v_a from a1_atendimentos where id = p_atendimento and tenant_id = a1_tenant() for update;
  if v_a.id is null then raise exception 'conversa_nao_encontrada'; end if;
  if v_a.status <> 'aberta' and (v_a.status <> 'distribuida' or p_resultado <> 'qualificado') then
    raise exception 'ja_finalizada';
  end if;
  if p_versao is distinct from v_a.versao then raise exception 'versao_desatualizada'; end if;

  select * into strict v_c from a1_cases where id = v_a.case_id and tenant_id = v_a.tenant_id for update;
  select * into v_atual from a1_stages where id = v_c.stage_id;

  if p_resultado = 'qualificado' then
    if p_corretor is null then
      select * into v_corretor from a1_partners where id = a1_roleta_proximo(v_a.tenant_id);
      if v_corretor.id is null then raise exception 'roleta_vazia'; end if;
    else
      select * into v_corretor from a1_partners
        where id = p_corretor and tenant_id = v_a.tenant_id and type = 'corretor'
          and is_active is not false and approved is not false;
      if v_corretor.id is null then raise exception 'corretor_indisponivel'; end if;
    end if;

    select * into v_alvo from a1_stages
     where tenant_id = v_a.tenant_id and module_key = 'crm'
       and coalesce(group_key, 'geral') = coalesce(v_atual.group_key, 'geral')
       and selo = 'EM_ATENDIMENTO';
    if v_alvo.id is null then
      -- "se não tiver esse selo no workflow, crie": logo depois da etapa de
      -- início do funil, empurrando as seguintes uma posição.
      select * into v_ini from a1_stages
       where tenant_id = v_a.tenant_id and module_key = 'crm'
         and coalesce(group_key, 'geral') = coalesce(v_atual.group_key, 'geral')
       order by is_initial desc, position asc nulls last limit 1;
      update a1_stages set position = position + 1
       where tenant_id = v_a.tenant_id and module_key = 'crm' and position > coalesce(v_ini.position, 0);
      insert into a1_stages (tenant_id, module_key, group_key, name, color, position, is_initial, is_final, selo)
      values (v_a.tenant_id, 'crm', v_atual.group_key, 'Em atendimento', '#0e8c7f',
              coalesce(v_ini.position, 0) + 1, false, false, 'EM_ATENDIMENTO')
      returning * into v_alvo;
    end if;

    v_imob_id := nullif(v_corretor.extra->>'imobiliaria_id', '');
    if v_imob_id is not null then
      select name into v_imob_nome from a1_partners
       where id = v_imob_id::uuid and tenant_id = v_a.tenant_id;
    end if;

    update a1_cases
       set broker_name = v_corretor.name,
           real_estate_name = case when v_a.status = 'aberta' then coalesce(v_imob_nome,real_estate_name) else v_imob_nome end,
           stage_id = v_alvo.id, stage_name = v_alvo.name, stage_entered_at = now(),
           payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{crm_refs}',
                     (case when v_a.status = 'distribuida' then coalesce(payload->'crm_refs', '{}'::jsonb) - 'imobiliaria_id'
                             else coalesce(payload->'crm_refs', '{}'::jsonb) end)
                       || jsonb_build_object('corretor_id', v_corretor.id::text)
                       || case when v_imob_id is not null then jsonb_build_object('imobiliaria_id', v_imob_id) else '{}'::jsonb end)
     where id = v_c.id;

    if p_corretor is null then
      update a1_lead_roleta set ultimo = v_corretor.id, atualizado_em = now() where tenant_id = v_a.tenant_id;
    end if;

    v_texto := 'Lead qualificado por ' || v_nome || case when p_corretor is null then ' e distribuído pela roleta para ' else ' e vinculado a ' end || v_corretor.name
               || '. Etapa: ' || v_alvo.name || '.';
    update a1_atendimentos
       set elia_ativa = false, status = 'distribuida', resultado = 'qualificado', corretor_id = v_corretor.id,
           corretor_nome = v_corretor.name, finalizado_por = v_nome, finalizado_em = now(),
           versao = versao + 1, ultima_em = now(), pendente = false, ultima_previa = left(v_texto, 140)
     where id = v_a.id;
    insert into a1_events (tenant_id, case_id, type, description, actor_name)
    values (v_a.tenant_id, v_c.id, 'distribuicao', left(v_texto, 300), v_nome);
  else
    select * into v_alvo from a1_stages
     where tenant_id = v_a.tenant_id and module_key = 'crm'
       and coalesce(group_key, 'geral') = coalesce(v_atual.group_key, 'geral')
       and selo = 'PERDIDO';
    if v_alvo.id is null then raise exception 'sem_etapa_perdido'; end if;
    if nullif(btrim(coalesce(p_motivo, '')), '') is null and nullif(btrim(coalesce(p_obs, '')), '') is null then
      raise exception 'motivo_obrigatorio';
    end if;
    update a1_cases
       set stage_id = v_alvo.id, stage_name = v_alvo.name, stage_entered_at = now(),
           payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('perda', jsonb_build_object(
             'motivo', nullif(left(btrim(coalesce(p_motivo, '')), 200), ''),
             'obs', nullif(left(btrim(coalesce(p_obs, '')), 1000), ''),
             'em', now(), 'por', v_nome))
     where id = v_c.id;
    v_texto := 'Lead desqualificado por ' || v_nome || ': '
               || concat_ws(' · ', nullif(btrim(coalesce(p_motivo, '')), ''), nullif(btrim(coalesce(p_obs, '')), ''))
               || '. Etapa: ' || v_alvo.name || '.';
    update a1_atendimentos
       set elia_ativa = false, status = 'encerrada', resultado = 'desqualificado', finalizado_por = v_nome,
           finalizado_em = now(), versao = versao + 1, ultima_em = now(), pendente = false,
           ultima_previa = left(v_texto, 140)
     where id = v_a.id;
    insert into a1_events (tenant_id, case_id, type, description, actor_name)
    values (v_a.tenant_id, v_c.id, 'stage_change', left(v_texto, 300), v_nome);
  end if;

  insert into a1_stage_history (tenant_id, case_id, stage_id, stage_name, entered_at, actor_name)
  values (v_a.tenant_id, v_c.id, v_alvo.id, v_alvo.name, now(), v_nome);
  insert into a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, autor_nome, tipo, corpo)
  values (v_a.tenant_id, v_a.id, 'sistema', 'SIIMOB', 'evento', left(v_texto, 4000));

  return json_build_object('ok', true, 'resultado', p_resultado,
                           'corretor', v_corretor.name, 'etapa', v_alvo.name);
end $$;
revoke all on function public.a1_atend_finalizar_com_corretor(uuid,text,int,text,text,uuid) from public;
grant execute on function public.a1_atend_finalizar_com_corretor(uuid,text,int,text,text,uuid) to anon, authenticated;

create or replace function public.a1_atend_finalizar(
  p_atendimento uuid, p_resultado text, p_versao int,
  p_motivo text default null, p_obs text default null)
returns json language sql security invoker set search_path = '' as $$
  select public.a1_atend_finalizar_com_corretor(p_atendimento, p_resultado, p_versao, p_motivo, p_obs, null);
$$;

create function public.a1_atend_corretores()
returns table(id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name from public.a1_partners p
  where public.a1_e_gestor() and public.a1_tem_modulo('ATENDIMENTO') and public.a1_tem_modulo('crm')
    and p.tenant_id = public.a1_tenant() and p.type = 'corretor'
    and p.is_active is not false and p.approved is not false
  order by p.name, p.id;
$$;
revoke all on function public.a1_atend_corretores() from public;
grant execute on function public.a1_atend_corretores() to anon, authenticated;

create function public.a1_atend_elia(p_atendimento uuid, p_versao int, p_ativa boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.a1_atendimentos;
begin
  if not coalesce(public.a1_e_gestor(),false) then raise exception 'sem_permissao'; end if;
  if not public.a1_tem_modulo('ATENDIMENTO') or not public.a1_tem_modulo('crm') then raise exception 'modulo_desabilitado'; end if;
  select * into v from public.a1_atendimentos where id = p_atendimento and tenant_id = public.a1_tenant() for update;
  if not found then raise exception 'conversa_nao_encontrada'; end if;
  if v.versao is distinct from p_versao then raise exception 'versao_desatualizada'; end if;
  if p_ativa is null then raise exception 'elia_canal_invalido'; end if;
  if p_ativa and not exists (
    select 1 from public.a1_cases c where c.id = v.case_id and c.tenant_id = v.tenant_id
      and nullif(public.a1_wa_chave(c.client_phone), '') is not null and not coalesce(c.archived,false)
  ) then raise exception 'sem_telefone'; end if;
  if p_ativa and not exists (
    select 1 from public.a1_whatsapp_conexoes w where w.tenant_id = v.tenant_id and w.estado = 'conectado'
  ) then raise exception 'elia_whatsapp_desconectado'; end if;
  if v.elia_ativa is not distinct from p_ativa then return; end if;
  if p_ativa and not exists (
    select 1 from public.a1_elia_config where tenant_id = v.tenant_id and enabled
      and config->'canais' ? 'whatsapp' and jsonb_array_length(flow) > 0
  ) then raise exception 'elia_nao_configurada'; end if;

  if p_ativa and v.corretor_id is not null then
    update public.a1_cases set broker_name = null, real_estate_name = null,
      payload = coalesce(payload, '{}'::jsonb) #- '{crm_refs,corretor_id}' #- '{crm_refs,imobiliaria_id}'
    where id = v.case_id and tenant_id = v.tenant_id;
  end if;
  update public.a1_atendimentos set elia_ativa = p_ativa, versao = versao + 1,
      status = case when p_ativa then 'aberta' else status end,
      corretor_id = case when p_ativa then null else corretor_id end,
      corretor_nome = case when p_ativa then null else corretor_nome end,
      resultado = case when p_ativa then null else resultado end,
      finalizado_por = case when p_ativa then null else finalizado_por end,
      finalizado_em = case when p_ativa then null else finalizado_em end,
      pendente = true where id = v.id;
  insert into public.a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, tipo, corpo)
    values (v.tenant_id,v.id,'sistema','evento',case when p_ativa then 'Atendimento ELIA ativado para qualificação.' else 'Atendimento retomado pela equipe.' end);
  if p_ativa then
    insert into public.a1_elia_job (tenant_id,case_id,atendimento_id,message_id)
      select v.tenant_id,v.case_id,v.id,m.id from public.a1_atendimento_mensagens m
      where m.atendimento_id = v.id and m.tenant_id = v.tenant_id and m.tipo = 'mensagem'
        and m.autor_tipo = 'lead' and m.externo is not null and m.criado_em > now()-interval '24 hours'
        and not exists (select 1 from public.a1_atendimento_mensagens r where r.atendimento_id = v.id
          and r.tipo = 'mensagem' and r.autor_tipo in ('atendente','ia') and r.criado_em >= m.criado_em)
      order by m.criado_em desc, m.id desc limit 1
      on conflict (message_id) do nothing;
  end if;
end $$;
revoke all on function public.a1_atend_elia(uuid,int,boolean) from public;
grant execute on function public.a1_atend_elia(uuid,int,boolean) to anon, authenticated;

create or replace function public.a1_elia_queue_inbound() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.autor_tipo = 'lead' and new.externo is not null and new.tipo = 'mensagem' then
    insert into public.a1_elia_job (tenant_id, case_id, atendimento_id, message_id)
      select a.tenant_id, a.case_id, a.id, new.id
      from public.a1_atendimentos a join public.a1_elia_config e on e.tenant_id = a.tenant_id
      where a.id = new.atendimento_id and a.tenant_id = new.tenant_id
        and a.status = 'aberta' and a.elia_ativa and e.enabled
        and e.config->'canais' ? 'whatsapp'
        and public.a1_tenant_tem_modulo(a.tenant_id, 'ATENDIMENTO')
      on conflict (message_id) do nothing;
  end if;
  return new;
end $$;

create or replace function public.a1_elia_handoff(p_tenant uuid, p_atendimento uuid, p_note text, p_stage uuid, p_partner uuid)
returns void language plpgsql set search_path = '' as $$
declare
  conversation public.a1_atendimentos;
  stage public.a1_stages;
  partner public.a1_partners;
begin
  select * into conversation from public.a1_atendimentos
    where id = p_atendimento and tenant_id = p_tenant and status = 'aberta' and corretor_id is null and elia_ativa for update;
  if not found then return; end if;
  if p_stage is not null then
    select * into strict stage from public.a1_stages where id = p_stage and tenant_id = p_tenant and module_key = 'crm';
    update public.a1_cases set stage_id = stage.id, stage_name = stage.name, stage_entered_at = now()
      where id = conversation.case_id and tenant_id = p_tenant and module_key = 'crm' and stage_id is distinct from stage.id;
  end if;
  if p_partner is not null then
    select * into strict partner from public.a1_partners where id = p_partner and tenant_id = p_tenant and type = 'corretor';
    update public.a1_cases set broker_name = partner.name,
      payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{crm_refs}',
        coalesce(payload->'crm_refs', '{}'::jsonb) || jsonb_build_object('corretor_id', partner.id))
      where id = conversation.case_id and tenant_id = p_tenant;
  end if;
  update public.a1_atendimentos set
    elia_ativa = false, status = case when partner.id is null then status else 'distribuida' end,
    corretor_id = partner.id, corretor_nome = partner.name, versao = versao + 1, pendente = true
    where id = p_atendimento;
  insert into public.a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, tipo, corpo)
    values (p_tenant, p_atendimento, 'sistema', 'nota', left(p_note,4000));
end $$;
