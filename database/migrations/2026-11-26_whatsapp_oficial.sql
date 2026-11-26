-- ════════════════════════════════════════════════════════════════════════════
-- WHATSAPP OFICIAL (API da Meta pela Coexy) COM A EVOLUTION DE RESERVA
--
-- POR QUE ESTE ARQUIVO EXISTE
--   "quero manter com a evoluition, porem quero que o principal seja com a
--    meta ... toda a conexao que existe hoje do whatsapp, quero que seja via
--    whatsaap oficial, central de atendimento, integraçoes, e claro, é pra ter
--    atendimento virtual sim"
--   Decisões: uma conta Coexy da plataforma (cada cliente conecta o próprio
--   número por um link); oficial primeiro, Evolution de reserva automática.
--
-- O QUE ELE FAZ
--   1. a1_wa_oficial: o canal oficial de cada cliente (id do canal na Coexy,
--      status, phone_number_id, waba_id, número, saúde) e o token do canal.
--      Só a chave de serviço lê: o navegador nunca vê o token.
--   2. a1_wa_coexy: uma linha da plataforma com o webhook da Coexy e o segredo
--      HMAC que assina os avisos. Só a chave de serviço lê.
--   3. a1_whatsapp_envios ganha "canal" (evolution | oficial). As linhas que já
--      existem leem 'evolution' (o padrão), que é o que elas são.
--   4. a1_atendimento_mensagens ganha "canal" e "entrega" (enviada, entregue,
--      lida, falhou), nulos para tudo o que já existe.
--   5. Funções novas (SECURITY DEFINER, só a chave de serviço):
--      a1_wa_oficial_tenant, a1_wa_oficial_evento, a1_wa_oficial_saude,
--      a1_wa_receber_oficial, a1_wa_status, a1_wa_envio_ok, a1_wa_envio_falha,
--      a1_wa_tem_canal.
--   6. Funções redefinidas, com a mesma assinatura:
--      - a1_wa_uso: os limites anti-bloqueio contam só a Evolution (a API
--        oficial tem os limites da Meta, tratados no envio).
--      - a1_wa_ligado: a Central sabe se há canal, qual é e se tem reserva.
--      - a1_atend_elia (se a ELIA existir no banco): ativar a ELIA aceita o
--        canal oficial, não só a Evolution.
--   7. a1_elia_campaign ganha "modelo" (o modelo aprovado pela Meta para a
--      campanha sair pelo oficial), nulo para as campanhas que já existem.
--
-- O QUE ELE NÃO MUDA
--   Nenhum lead, conversa, mensagem, envio, conexão da Evolution ou
--   configuração existente. As tabelas novas nascem vazias. As funções antigas
--   (a1_wa_receber, a1_wa_registrar_envio, a1_wa_registrar_falha,
--   a1_elia_log_send) continuam iguais: as funções publicadas hoje seguem
--   funcionando até a nova versão subir.
--
-- Idempotente: pode rodar de novo. Como conferir, no fim do arquivo.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Canal oficial de cada cliente ────────────────────────────────────────
create table if not exists a1_wa_oficial (
  tenant_id uuid primary key references a1_tenants(id),
  channel_id text not null unique check (channel_id ~ '^[0-9a-f-]{36}$'),
  status text not null default 'pending' check (status in ('pending', 'active', 'disconnected', 'suspended')),
  phone_number_id text unique check (phone_number_id is null or phone_number_id ~ '^[0-9]{5,30}$'),
  waba_id text check (waba_id is null or waba_id ~ '^[0-9]{5,30}$'),
  numero text check (numero is null or numero ~ '^[0-9]{8,15}$'),
  channel_token text not null check (length(channel_token) between 10 and 600),
  connect_url text check (connect_url is null or (connect_url ~ '^https://' and length(connect_url) <= 600)),
  saude text check (saude is null or saude in ('healthy', 'warning', 'restricted', 'blocked', 'banned')),
  saude_motivo text check (saude_motivo is null or length(saude_motivo) <= 500),
  qualidade text check (qualidade is null or length(qualidade) <= 20),
  limite text check (limite is null or length(limite) <= 30),
  -- sem a Evolution, ou com o oficial fora do ar, a reserva entra sozinha
  reserva_auto boolean not null default true,
  criar_leads boolean not null default true,
  conectado_em timestamptz,
  criado_por uuid references a1_users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table a1_wa_oficial enable row level security;
revoke all on a1_wa_oficial from public, anon, authenticated;
grant select, insert, update, delete on a1_wa_oficial to service_role;

-- ── 2. Webhook da plataforma na Coexy ───────────────────────────────────────
create table if not exists a1_wa_coexy (
  id smallint primary key default 1 check (id = 1),
  webhook_id text check (webhook_id is null or webhook_id ~ '^[0-9a-f-]{36}$'),
  url text check (url is null or url ~ '^https://'),
  hmac_secret text check (hmac_secret is null or length(hmac_secret) between 16 and 300),
  criado_em timestamptz not null default now()
);
alter table a1_wa_coexy enable row level security;
revoke all on a1_wa_coexy from public, anon, authenticated;
grant select, insert, update, delete on a1_wa_coexy to service_role;

-- ── 3. Por onde saiu ────────────────────────────────────────────────────────
alter table a1_whatsapp_envios add column if not exists canal text not null default 'evolution';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'a1_whatsapp_envios_canal_ck') then
    alter table a1_whatsapp_envios add constraint a1_whatsapp_envios_canal_ck check (canal in ('evolution', 'oficial'));
  end if;
end $$;

alter table a1_atendimento_mensagens add column if not exists canal text;
alter table a1_atendimento_mensagens add column if not exists entrega text;
alter table a1_atendimento_mensagens add column if not exists entrega_em timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'a1_atendimento_mensagens_canal_ck') then
    alter table a1_atendimento_mensagens add constraint a1_atendimento_mensagens_canal_ck
      check (canal is null or canal in ('evolution', 'oficial'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'a1_atendimento_mensagens_entrega_ck') then
    alter table a1_atendimento_mensagens add constraint a1_atendimento_mensagens_entrega_ck
      check (entrega is null or entrega in ('enviada', 'entregue', 'lida', 'falhou'));
  end if;
end $$;

-- ── 4. Aviso da Coexy: de qual cliente é ────────────────────────────────────
create or replace function a1_wa_oficial_tenant(p_phone_number_id text)
returns uuid language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select o.tenant_id from a1_wa_oficial o
   where o.phone_number_id = p_phone_number_id
     and a1_tenant_tem_modulo(o.tenant_id, 'ATENDIMENTO')
   limit 1;
$$;
revoke all on function a1_wa_oficial_tenant(text) from public, anon, authenticated;
grant execute on function a1_wa_oficial_tenant(text) to service_role;

-- Status do canal (aviso channel_status_update ou consulta à Coexy).
create or replace function a1_wa_oficial_evento(
  p_channel text, p_status text, p_phone_number_id text default null, p_waba_id text default null,
  p_numero text default null)
returns text language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_num text := nullif(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), '');
begin
  if p_status not in ('pending', 'active', 'disconnected', 'suspended') then return 'status_invalido'; end if;
  update a1_wa_oficial
     set status = p_status,
         phone_number_id = case when p_phone_number_id ~ '^[0-9]{5,30}$' then p_phone_number_id else phone_number_id end,
         waba_id = case when p_waba_id ~ '^[0-9]{5,30}$' then p_waba_id else waba_id end,
         numero = case when v_num ~ '^[0-9]{8,15}$' then v_num else numero end,
         conectado_em = case when p_status = 'active' and status <> 'active' then now() else conectado_em end,
         atualizado_em = now()
   where channel_id = p_channel;
  return case when found then 'ok' else 'nao_encontrado' end;
end $$;
revoke all on function a1_wa_oficial_evento(text, text, text, text, text) from public, anon, authenticated;
grant execute on function a1_wa_oficial_evento(text, text, text, text, text) to service_role;

-- Saúde do número (aviso channel_health_update ou consulta à Coexy).
create or replace function a1_wa_oficial_saude(
  p_channel text, p_saude text, p_motivo text default null, p_qualidade text default null, p_limite text default null)
returns text language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if p_saude is not null and p_saude not in ('healthy', 'warning', 'restricted', 'blocked', 'banned') then
    return 'saude_invalida';
  end if;
  update a1_wa_oficial
     set saude = p_saude,
         saude_motivo = left(nullif(btrim(coalesce(p_motivo, '')), ''), 500),
         qualidade = left(nullif(btrim(coalesce(p_qualidade, '')), ''), 20),
         limite = left(nullif(btrim(coalesce(p_limite, '')), ''), 30),
         atualizado_em = now()
   where channel_id = p_channel;
  return case when found then 'ok' else 'nao_encontrado' end;
end $$;
revoke all on function a1_wa_oficial_saude(text, text, text, text, text) from public, anon, authenticated;
grant execute on function a1_wa_oficial_saude(text, text, text, text, text) to service_role;

-- ── 5. Mensagem que chegou pelo oficial ─────────────────────────────────────
-- Mesmas regras de a1_wa_receber (que segue igual), mais: "criar leads"
-- desligado no canal oficial também segura número novo, e a mensagem fica
-- marcada como do canal oficial.
create or replace function a1_wa_receber_oficial(
  p_tenant uuid, p_numero text, p_nome text, p_texto text, p_externo text, p_de_mim boolean default false)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_r json; v_chave text := a1_wa_chave(p_numero);
begin
  if not p_de_mim and v_chave is not null
     and not coalesce((select o.criar_leads from a1_wa_oficial o where o.tenant_id = p_tenant), true)
     and not exists (select 1 from a1_cases c
                      where c.tenant_id = p_tenant and c.module_key = 'crm' and not coalesce(c.archived, false)
                        and a1_wa_chave(c.client_phone) = v_chave) then
    return json_build_object('ok', true, 'ignorado', 'criar_leads_desligado');
  end if;
  v_r := a1_wa_receber(p_tenant, p_numero, p_nome, p_texto, p_externo, p_de_mim);
  if coalesce((v_r->>'ok')::boolean, false) and coalesce(p_externo, '') <> '' then
    update a1_atendimento_mensagens set canal = 'oficial'
     where tenant_id = p_tenant and externo = p_externo and canal is null;
  end if;
  return v_r;
end $$;
revoke all on function a1_wa_receber_oficial(uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function a1_wa_receber_oficial(uuid, text, text, text, text, boolean) to service_role;

-- Status da mensagem enviada (sent/delivered/read/failed). Só anda para a
-- frente: "entregue" que chega depois de "lida" (retentativa) não volta.
create or replace function a1_wa_status(p_tenant uuid, p_externo text, p_status text, p_em timestamptz default null)
returns text language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_novo text := case p_status when 'sent' then 'enviada' when 'delivered' then 'entregue'
                               when 'read' then 'lida' when 'failed' then 'falhou' end;
  v_ordem int := case v_novo when 'enviada' then 1 when 'entregue' then 2 when 'lida' then 3 when 'falhou' then 1 end;
begin
  if v_novo is null or coalesce(p_externo, '') = '' then return 'status_invalido'; end if;
  update a1_atendimento_mensagens m
     set entrega = v_novo, entrega_em = coalesce(p_em, now())
   where m.tenant_id = p_tenant and m.externo = p_externo
     and (m.entrega is null
          or (case m.entrega when 'enviada' then 1 when 'entregue' then 2 when 'lida' then 3 else 9 end) < v_ordem
          or (v_novo = 'falhou' and m.entrega = 'enviada'));
  return case when found then 'ok' else 'sem_mudanca' end;
end $$;
revoke all on function a1_wa_status(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function a1_wa_status(uuid, text, text, timestamptz) to service_role;

-- ── 6. Envio (com o canal) ──────────────────────────────────────────────────
create or replace function a1_wa_envio_ok(
  p_tenant uuid, p_atendimento uuid, p_corpo text, p_autor text, p_externo text, p_tipo text,
  p_autor_tipo text default 'atendente', p_canal text default 'evolution')
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_id uuid; v_corpo text := left(btrim(coalesce(p_corpo, '')), 4000);
begin
  if p_tipo not in ('resposta', 'iniciado', 'campanha') or p_autor_tipo not in ('atendente', 'ia')
     or p_canal not in ('evolution', 'oficial') then
    return json_build_object('ok', false, 'erro', 'dados_invalidos');
  end if;
  insert into a1_whatsapp_envios (tenant_id, tipo, atendimento_id, canal) values (p_tenant, p_tipo, p_atendimento, p_canal);
  if p_atendimento is null or v_corpo = '' then return json_build_object('ok', true); end if;
  insert into a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, autor_nome, tipo, corpo, externo, canal, entrega, entrega_em)
  select a.tenant_id, a.id, p_autor_tipo, left(coalesce(p_autor, 'Atendente'), 120), 'mensagem', v_corpo,
         nullif(left(coalesce(p_externo, ''), 120), ''), p_canal,
         case when p_canal = 'oficial' and coalesce(p_externo, '') <> '' then 'enviada' end,
         case when p_canal = 'oficial' and coalesce(p_externo, '') <> '' then now() end
    from a1_atendimentos a where a.id = p_atendimento and a.tenant_id = p_tenant
  on conflict do nothing
  returning id into v_id;
  update a1_atendimentos set ultima_em = now(), pendente = false, ultima_previa = left(v_corpo, 140)
   where id = p_atendimento and tenant_id = p_tenant;
  return json_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function a1_wa_envio_ok(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function a1_wa_envio_ok(uuid, uuid, text, text, text, text, text, text) to service_role;

create or replace function a1_wa_envio_falha(p_tenant uuid, p_tipo text, p_atendimento uuid default null, p_canal text default 'evolution')
returns void language sql security definer
set search_path = public, extensions, pg_temp as $$
  insert into a1_whatsapp_envios (tenant_id, tipo, atendimento_id, ok, canal)
  select p_tenant, p_tipo, p_atendimento, false, p_canal
   where p_tipo in ('resposta', 'iniciado', 'campanha') and p_canal in ('evolution', 'oficial');
$$;
revoke all on function a1_wa_envio_falha(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function a1_wa_envio_falha(uuid, text, uuid, text) to service_role;

-- ── 7. Limites anti-bloqueio: só a Evolution conta ──────────────────────────
create or replace function a1_wa_uso(p_tenant uuid)
returns json language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select json_build_object(
    'minuto', count(*) filter (where e.criado_em > now() - interval '1 minute'),
    'hora', count(*) filter (where e.criado_em > now() - interval '1 hour'),
    'dia', count(*) filter (where e.criado_em > now() - interval '24 hours'),
    'hora_frio', count(*) filter (where e.criado_em > now() - interval '1 hour' and e.tipo <> 'resposta'),
    'dia_frio', count(*) filter (where e.criado_em > now() - interval '24 hours' and e.tipo <> 'resposta'),
    'falhas_hora', count(*) filter (where e.criado_em > now() - interval '1 hour' and not e.ok),
    'ultimo_em', max(e.criado_em),
    -- o mais antigo de cada janela: quando ele sai da janela, abre uma vaga
    'antigo_minuto', min(e.criado_em) filter (where e.criado_em > now() - interval '1 minute'),
    'antigo_hora', min(e.criado_em) filter (where e.criado_em > now() - interval '1 hour'),
    'antigo_dia', min(e.criado_em),
    'antigo_hora_frio', min(e.criado_em) filter (where e.criado_em > now() - interval '1 hour' and e.tipo <> 'resposta'),
    'antigo_dia_frio', min(e.criado_em) filter (where e.tipo <> 'resposta'),
    'agora', now(),
    'primeira_conexao_em', (select w.primeira_conexao_em from a1_whatsapp_conexoes w where w.tenant_id = p_tenant),
    'pausado_ate', (select w.pausado_ate from a1_whatsapp_conexoes w where w.tenant_id = p_tenant),
    'pausa_motivo', (select w.pausa_motivo from a1_whatsapp_conexoes w where w.tenant_id = p_tenant))
  from a1_whatsapp_envios e
  where e.tenant_id = p_tenant and e.criado_em > now() - interval '24 hours' and e.canal = 'evolution';
$$;
revoke all on function a1_wa_uso(uuid) from public, anon, authenticated;
grant execute on function a1_wa_uso(uuid) to service_role;

-- ── 8. Há canal para falar com o lead? ──────────────────────────────────────
create or replace function a1_wa_tem_canal(p_tenant uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select exists (select 1 from a1_wa_oficial o where o.tenant_id = p_tenant and o.status = 'active')
      or exists (select 1 from a1_whatsapp_conexoes w where w.tenant_id = p_tenant and w.estado = 'conectado');
$$;
revoke all on function a1_wa_tem_canal(uuid) from public, anon, authenticated;
grant execute on function a1_wa_tem_canal(uuid) to service_role;

-- A tela da Central: o WhatsApp está ligado? Por qual canal? Tem reserva?
create or replace function a1_wa_ligado()
returns json language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case when a1_tenant() is null or not a1_tem_modulo('ATENDIMENTO') then json_build_object('ligado', false)
    else (select json_build_object(
                   'ligado', coalesce(o.status = 'active', false) or coalesce(w.estado = 'conectado', false),
                   'canal', case when o.status = 'active' then 'oficial' when w.estado = 'conectado' then 'evolution' end,
                   'oficial', coalesce(o.status = 'active', false),
                   'reserva', coalesce(o.reserva_auto, true) and coalesce(w.estado = 'conectado', false),
                   'pausado_ate', case when w.pausado_ate > now() then w.pausado_ate end,
                   'pausa_motivo', case when w.pausado_ate > now() then w.pausa_motivo end)
            from (select a1_tenant() as t) x
            left join a1_wa_oficial o on o.tenant_id = x.t
            left join a1_whatsapp_conexoes w on w.tenant_id = x.t) end;
$$;
revoke all on function a1_wa_ligado() from public;
grant execute on function a1_wa_ligado() to anon, authenticated;

-- ── 9. ELIA (só se ela existir neste banco) ─────────────────────────────────
-- Igual à versão de 2026-11-22_elia_acoes_conversa.sql; muda só a conferência
-- do WhatsApp conectado, que passa a aceitar o canal oficial.
do $do$ begin
  if to_regclass('public.a1_elia_config') is null then return; end if;
  alter table public.a1_elia_campaign add column if not exists modelo jsonb;
  execute $fn$
create or replace function public.a1_atend_elia(p_atendimento uuid, p_versao int, p_ativa boolean)
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
  if p_ativa and not public.a1_wa_tem_canal(v.tenant_id) then raise exception 'elia_whatsapp_desconectado'; end if;
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
end $$
  $fn$;
  revoke all on function public.a1_atend_elia(uuid,int,boolean) from public;
  grant execute on function public.a1_atend_elia(uuid,int,boolean) to anon, authenticated;
end $do$;

-- ════════════════════════════════════════════════════════════════════════════
-- COMO CONFERIR (no SQL Editor, depois de rodar)
--   select count(*) from a1_wa_oficial;                                    -- 0
--   select count(*) from a1_wa_coexy;                                      -- 0
--   select count(*) from a1_whatsapp_envios where canal <> 'evolution';    -- 0
--   select count(*) from a1_atendimento_mensagens where canal is not null or entrega is not null; -- 0
--   select proname from pg_proc where proname in ('a1_wa_oficial_tenant','a1_wa_oficial_evento',
--     'a1_wa_oficial_saude','a1_wa_receber_oficial','a1_wa_status','a1_wa_envio_ok',
--     'a1_wa_envio_falha','a1_wa_tem_canal') order by 1;                   -- 8 linhas
-- ════════════════════════════════════════════════════════════════════════════
