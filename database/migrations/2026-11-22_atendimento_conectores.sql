-- ════════════════════════════════════════════════════════════════════════════
-- CONECTORES DA CENTRAL DE ATENDIMENTO: OpenAI (IA da ELIA) e WhatsApp (Evolution)
--
-- POR QUE ESTE ARQUIVO EXISTE
--   "ja crie o ambiente, para integrar com a llm, por enquanto usarei da
--    openai, coloque dentro da configuraçao de integracoes, ao lado da meta."
--   "eu vou integrar o evolution por enquanto, entao eu preciso que conheça os
--    limites de envio de mensagem, para que, nao percamos o numero do cliente,
--    então se voce verificar que esta chegando no limite, pause, mostre um
--    aviso, e continue quando der"
--
-- O QUE ELE FAZ
--   1. a1_ia_conexoes: a chave da OpenAI de cada cliente (opcional: sem ela,
--      vale a chave da plataforma) e o modelo escolhido. Só o servidor (edge
--      function, chave de serviço) lê e grava. O navegador nunca vê a chave:
--      a tela recebe só os 4 últimos caracteres.
--   2. a1_whatsapp_conexoes: a instância do WhatsApp (Evolution) de cada
--      cliente, o estado (aguardando QR, conectado...), o número, quando
--      conectou pela primeira vez (é o que mede o "aquecimento" do número) e a
--      pausa automática. O token do aviso (webhook) fica só em hash.
--   3. a1_whatsapp_envios: um registro por mensagem que SAI pelo WhatsApp, com
--      o tipo (resposta a quem escreveu / conversa iniciada / campanha). É o
--      que conta o uso para os limites anti-bloqueio.
--   4. a1_atendimento_mensagens ganha "externo" (o id da mensagem no WhatsApp,
--      para não gravar a mesma duas vezes).
--   5. Funções (todas SECURITY DEFINER):
--      - a1_conector_contexto(token): quem está pedindo (para a edge function).
--      - a1_wa_webhook_tenant(instancia, token): de quem é o aviso que chegou.
--      - a1_wa_receber(...): mensagem que chegou no WhatsApp entra na Central
--        (acha o lead pelo telefone; sem lead, cria pela integração).
--      - a1_wa_estado(...): conectou/desconectou.
--      - a1_wa_uso(tenant): quanto já saiu no minuto, na hora e no dia.
--      - a1_wa_pausar(tenant, até, motivo).
--      - a1_atend_wa_alvo(atendimento): o atendente pode mandar nesta conversa?
--        (roda com a sessão de quem pede: mesmas regras de a1_atend_enviar).
--      - a1_wa_registrar_envio(...): grava a mensagem que saiu de verdade.
--      - a1_wa_ligado(): a tela da Central pergunta se o WhatsApp está ligado.
--
-- O QUE ELE NÃO MUDA
--   Nenhum lead, conversa, etapa ou configuração existente. As tabelas novas
--   nascem vazias. A coluna nova em a1_atendimento_mensagens é nula para tudo
--   o que já existe. Nada roda para quem não tem a licença ATENDIMENTO: toda
--   função confere a licença.
--
-- Idempotente: pode rodar de novo. Como conferir, no fim do arquivo.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. IA (OpenAI) ──────────────────────────────────────────────────────────
create table if not exists a1_ia_conexoes (
  tenant_id uuid primary key references a1_tenants(id),
  provedor text not null default 'openai' check (provedor in ('openai')),
  -- null: usa a chave da plataforma (segredo SIIMOB_OPENAI_API_KEY)
  chave text check (chave is null or length(chave) between 20 and 300),
  modelo text not null default 'gpt-4o-mini' check (modelo ~ '^[a-zA-Z0-9._:-]{2,60}$'),
  ativo boolean not null default true,
  teste_ok boolean,
  testado_em timestamptz,
  atualizado_por uuid references a1_users(id),
  atualizado_em timestamptz not null default now()
);
alter table a1_ia_conexoes enable row level security;
revoke all on a1_ia_conexoes from public, anon, authenticated;
grant select, insert, update, delete on a1_ia_conexoes to service_role;

-- ── 2. WhatsApp (Evolution) ─────────────────────────────────────────────────
create table if not exists a1_whatsapp_conexoes (
  tenant_id uuid primary key references a1_tenants(id),
  instancia text not null unique check (instancia ~ '^[a-z0-9-]{3,60}$'),
  estado text not null default 'aguardando_qr'
    check (estado in ('aguardando_qr', 'conectando', 'conectado', 'desconectado')),
  numero text check (numero is null or numero ~ '^[0-9]{8,15}$'),
  perfil_nome text check (perfil_nome is null or length(perfil_nome) <= 120),
  webhook_token_hash text not null check (webhook_token_hash ~ '^[0-9a-f]{64}$'),
  -- lead novo quando um número desconhecido escreve
  criar_leads boolean not null default true,
  primeira_conexao_em timestamptz,
  conectado_em timestamptz,
  pausado_ate timestamptz,
  pausa_motivo text check (pausa_motivo is null or length(pausa_motivo) <= 200),
  criado_por uuid references a1_users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table a1_whatsapp_conexoes enable row level security;
revoke all on a1_whatsapp_conexoes from public, anon, authenticated;
grant select, insert, update, delete on a1_whatsapp_conexoes to service_role;

create table if not exists a1_whatsapp_envios (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references a1_tenants(id),
  -- resposta: o lead escreveu nas últimas 24 h (risco baixo)
  -- iniciado: conversa que nós começamos (risco alto)
  -- campanha: disparo em massa (risco mais alto)
  tipo text not null check (tipo in ('resposta', 'iniciado', 'campanha')),
  atendimento_id uuid references a1_atendimentos(id) on delete set null,
  ok boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists a1_whatsapp_envios_uso_idx on a1_whatsapp_envios (tenant_id, criado_em desc);
alter table a1_whatsapp_envios enable row level security;
revoke all on a1_whatsapp_envios from public, anon, authenticated;
grant select, insert, delete on a1_whatsapp_envios to service_role;

-- ── 3. Id da mensagem no WhatsApp ───────────────────────────────────────────
alter table a1_atendimento_mensagens add column if not exists externo text
  check (externo is null or length(externo) <= 120);
create unique index if not exists a1_atendimento_mensagens_externo_uq
  on a1_atendimento_mensagens (tenant_id, externo) where externo is not null;

-- ── 4. Licença conferida sem sessão (para a chave de serviço) ───────────────
create or replace function a1_tenant_tem_modulo(p_tenant uuid, p_modulo text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select exists (select 1 from a1_tenant_modules m
                  where m.tenant_id = p_tenant and m.module_key = p_modulo
                    and (m.expires_at is null or m.expires_at > now()))
     and exists (select 1 from a1_tenants t where t.id = p_tenant
                    and coalesce(t.status, 'active') in ('active', 'trial'));
$$;
revoke all on function a1_tenant_tem_modulo(uuid, text) from public, anon, authenticated;
grant execute on function a1_tenant_tem_modulo(uuid, text) to service_role;

-- ── 5. Quem está pedindo (edge function) ────────────────────────────────────
-- Qualquer sessão válida de um cliente com a licença. "gestor" diz se pode
-- mexer nas integrações; o envio pela Central confere a posse da conversa à
-- parte (a1_atend_wa_alvo).
create or replace function a1_conector_contexto(p_token text)
returns table (tenant_id uuid, user_id uuid, slug text, gestor boolean)
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select s.tenant_id, s.user_id, t.slug, coalesce(s.role, '') not in ('', 'partner')
    from a1_sessions s
    join a1_users u on u.id = s.user_id and u.tenant_id = s.tenant_id
    join a1_tenants t on t.id = s.tenant_id
   where s.token = p_token and (s.expires_at is null or s.expires_at > now())
     and coalesce(u.is_active, true)
     and a1_tenant_tem_modulo(s.tenant_id, 'ATENDIMENTO')
   limit 1;
$$;
revoke all on function a1_conector_contexto(text) from public, anon, authenticated;
grant execute on function a1_conector_contexto(text) to service_role;

-- ── 6. Aviso do WhatsApp: de qual cliente é ─────────────────────────────────
create or replace function a1_wa_webhook_tenant(p_instancia text, p_token text)
returns uuid language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select w.tenant_id from a1_whatsapp_conexoes w
   where w.instancia = p_instancia
     and w.webhook_token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and a1_tenant_tem_modulo(w.tenant_id, 'ATENDIMENTO')
   limit 1;
$$;
revoke all on function a1_wa_webhook_tenant(text, text) from public, anon, authenticated;
grant execute on function a1_wa_webhook_tenant(text, text) to service_role;

-- DDD + 8 últimos dígitos: casa o número do WhatsApp (que às vezes vem sem o
-- nono dígito) com o telefone cadastrado no lead, com ou sem 55, máscara etc.
create or replace function a1_wa_chave(p_tel text)
returns text language sql immutable
set search_path = public, extensions, pg_temp as $$
  select case
    when length(d) < 10 then null
    else left(case when length(d) >= 12 and left(d, 2) = '55' then substr(d, 3) else d end, 2) || right(d, 8)
  end
  from (select regexp_replace(coalesce(p_tel, ''), '\D', '', 'g') as d) x;
$$;
revoke all on function a1_wa_chave(text) from public;
grant execute on function a1_wa_chave(text) to service_role;

-- ── 7. Mensagem que chegou no WhatsApp ──────────────────────────────────────
-- p_de_mim: a mensagem saiu do celular da empresa (alguém respondeu direto no
-- aparelho). Só entra se a conversa já existe; nunca cria lead.
create or replace function a1_wa_receber(
  p_tenant uuid, p_numero text, p_nome text, p_texto text, p_externo text,
  p_de_mim boolean default false)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_num text := regexp_replace(coalesce(p_numero, ''), '\D', '', 'g');
  v_chave text := a1_wa_chave(p_numero);
  v_texto text := left(btrim(coalesce(p_texto, '')), 4000);
  v_nome text := left(nullif(btrim(coalesce(p_nome, '')), ''), 120);
  v_case uuid;
  v_a a1_atendimentos%rowtype;
  v_r json;
  v_criou boolean := false;
begin
  if p_tenant is null or v_chave is null or v_texto = '' or coalesce(p_externo, '') = '' or length(p_externo) > 120 then
    return json_build_object('ok', false, 'erro', 'dados_invalidos');
  end if;
  if not a1_tenant_tem_modulo(p_tenant, 'ATENDIMENTO') then
    return json_build_object('ok', false, 'erro', 'modulo_desabilitado');
  end if;
  if exists (select 1 from a1_atendimento_mensagens m where m.tenant_id = p_tenant and m.externo = p_externo) then
    return json_build_object('ok', true, 'duplicado', true);
  end if;
  -- Uma mensagem por vez por número: duas chegando juntas não criam dois leads.
  perform pg_advisory_xact_lock(hashtextextended('wa:' || p_tenant::text || ':' || v_chave, 0));

  -- O lead mais recente com este telefone (não arquivado).
  select c.id into v_case from a1_cases c
   where c.tenant_id = p_tenant and c.module_key = 'crm' and not coalesce(c.archived, false)
     and a1_wa_chave(c.client_phone) = v_chave
   order by c.created_at desc limit 1;

  if v_case is null then
    if p_de_mim then return json_build_object('ok', true, 'ignorado', 'sem_conversa'); end if;
    if not coalesce((select w.criar_leads from a1_whatsapp_conexoes w where w.tenant_id = p_tenant), true) then
      return json_build_object('ok', true, 'ignorado', 'criar_leads_desligado');
    end if;
    v_r := a1_integracao_criar_lead(p_tenant, 'whatsapp', 'wa-' || v_chave || '-' || to_char(now(), 'YYYYMMDDHH24MISS'),
             null, v_nome, '+' || v_num, null,
             jsonb_build_object('rotulo', 'WhatsApp',
                                'observacoes', 'Primeira mensagem: ' || v_texto,
                                'evento', 'Lead recebido pelo WhatsApp',
                                'dados', jsonb_build_object('numero', v_num, 'nome_no_whatsapp', v_nome)));
    if not coalesce((v_r->>'ok')::boolean, false) then
      return json_build_object('ok', false, 'erro', coalesce(v_r->>'erro', 'falha_ao_criar'));
    end if;
    v_case := (v_r->>'case_id')::uuid;
    v_criou := true;
  end if;

  select * into v_a from a1_atendimentos where case_id = v_case;
  if v_a.id is null then
    if p_de_mim then return json_build_object('ok', true, 'ignorado', 'sem_conversa'); end if;
    insert into a1_atendimentos (tenant_id, case_id, canal, ultima_previa)
    values (p_tenant, v_case, 'whatsapp', left(v_texto, 140))
    on conflict (case_id) do nothing;
    select * into v_a from a1_atendimentos where case_id = v_case;
  end if;

  -- Desqualificado que volta a escrever: a conversa reabre na fila.
  if v_a.status = 'encerrada' and not p_de_mim then
    update a1_atendimentos set status = 'aberta', resultado = null, versao = versao + 1 where id = v_a.id;
    insert into a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, autor_nome, tipo, corpo)
    values (p_tenant, v_a.id, 'sistema', 'SIIMOB', 'evento', 'O lead voltou a escrever. A conversa voltou para a fila.');
  end if;

  insert into a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, autor_nome, tipo, corpo, externo)
  values (p_tenant, v_a.id,
          case when p_de_mim then 'atendente' else 'lead' end,
          case when p_de_mim then 'Celular da empresa' else v_nome end,
          'mensagem', v_texto, p_externo)
  on conflict do nothing;
  update a1_atendimentos
     set ultima_em = now(), ultima_previa = left(v_texto, 140),
         pendente = case when p_de_mim then false else true end
   where id = v_a.id;
  return json_build_object('ok', true, 'atendimento_id', v_a.id, 'case_id', v_case, 'lead_novo', v_criou);
end $$;
revoke all on function a1_wa_receber(uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function a1_wa_receber(uuid, text, text, text, text, boolean) to service_role;

-- ── 8. Estado da conexão ────────────────────────────────────────────────────
create or replace function a1_wa_estado(p_tenant uuid, p_estado text, p_numero text default null, p_nome text default null)
returns text language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_num text := nullif(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), '');
begin
  if p_estado not in ('aguardando_qr', 'conectando', 'conectado', 'desconectado') then return 'estado_invalido'; end if;
  update a1_whatsapp_conexoes
     set estado = p_estado,
         numero = case when v_num ~ '^[0-9]{8,15}$' then v_num else numero end,
         perfil_nome = coalesce(left(nullif(btrim(coalesce(p_nome, '')), ''), 120), perfil_nome),
         conectado_em = case when p_estado = 'conectado' and estado <> 'conectado' then now() else conectado_em end,
         primeira_conexao_em = case when p_estado = 'conectado' then coalesce(primeira_conexao_em, now()) else primeira_conexao_em end,
         atualizado_em = now()
   where tenant_id = p_tenant;
  return case when found then 'ok' else 'nao_encontrado' end;
end $$;
revoke all on function a1_wa_estado(uuid, text, text, text) from public, anon, authenticated;
grant execute on function a1_wa_estado(uuid, text, text, text) to service_role;

-- ── 9. Uso para os limites ──────────────────────────────────────────────────
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
  where e.tenant_id = p_tenant and e.criado_em > now() - interval '24 hours';
$$;
revoke all on function a1_wa_uso(uuid) from public, anon, authenticated;
grant execute on function a1_wa_uso(uuid) to service_role;

create or replace function a1_wa_pausar(p_tenant uuid, p_ate timestamptz, p_motivo text)
returns text language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  update a1_whatsapp_conexoes
     set pausado_ate = p_ate, pausa_motivo = left(nullif(btrim(coalesce(p_motivo, '')), ''), 200), atualizado_em = now()
   where tenant_id = p_tenant;
  return case when found then 'ok' else 'nao_encontrado' end;
end $$;
revoke all on function a1_wa_pausar(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function a1_wa_pausar(uuid, timestamptz, text) to service_role;

-- ── 10. Envio pela Central ──────────────────────────────────────────────────
-- Roda com a sessão de quem pede (a edge function chama com o token dele):
-- mesmas regras de a1_atend_enviar. Não grava nada; devolve o telefone, o
-- nome de quem escreve e se o lead escreveu nas últimas 24 h.
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
revoke all on function a1_atend_wa_alvo(uuid) from public;
grant execute on function a1_atend_wa_alvo(uuid) to anon, authenticated;

-- A mensagem saiu de verdade: grava na conversa e conta no uso.
create or replace function a1_wa_registrar_envio(
  p_tenant uuid, p_atendimento uuid, p_corpo text, p_autor text, p_externo text, p_tipo text,
  p_autor_tipo text default 'atendente')
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_id uuid; v_corpo text := left(btrim(coalesce(p_corpo, '')), 4000);
begin
  if p_tipo not in ('resposta', 'iniciado', 'campanha') or p_autor_tipo not in ('atendente', 'ia') then
    return json_build_object('ok', false, 'erro', 'dados_invalidos');
  end if;
  insert into a1_whatsapp_envios (tenant_id, tipo, atendimento_id) values (p_tenant, p_tipo, p_atendimento);
  if p_atendimento is null or v_corpo = '' then return json_build_object('ok', true); end if;
  insert into a1_atendimento_mensagens (tenant_id, atendimento_id, autor_tipo, autor_nome, tipo, corpo, externo)
  select a.tenant_id, a.id, p_autor_tipo, left(coalesce(p_autor, 'Atendente'), 120), 'mensagem', v_corpo,
         nullif(left(coalesce(p_externo, ''), 120), '')
    from a1_atendimentos a where a.id = p_atendimento and a.tenant_id = p_tenant
  on conflict do nothing
  returning id into v_id;
  update a1_atendimentos set ultima_em = now(), pendente = false, ultima_previa = left(v_corpo, 140)
   where id = p_atendimento and tenant_id = p_tenant;
  return json_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function a1_wa_registrar_envio(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function a1_wa_registrar_envio(uuid, uuid, text, text, text, text, text) to service_role;

-- Falha no envio também conta (muitas falhas seguidas = sinal de bloqueio).
create or replace function a1_wa_registrar_falha(p_tenant uuid, p_tipo text, p_atendimento uuid default null)
returns void language sql security definer
set search_path = public, extensions, pg_temp as $$
  insert into a1_whatsapp_envios (tenant_id, tipo, atendimento_id, ok)
  select p_tenant, p_tipo, p_atendimento, false where p_tipo in ('resposta', 'iniciado', 'campanha');
$$;
revoke all on function a1_wa_registrar_falha(uuid, text, uuid) from public, anon, authenticated;
grant execute on function a1_wa_registrar_falha(uuid, text, uuid) to service_role;

-- A tela da Central: o WhatsApp está ligado para este cliente?
create or replace function a1_wa_ligado()
returns json language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case when a1_tenant() is null or not a1_tem_modulo('ATENDIMENTO') then json_build_object('ligado', false)
    else coalesce((select json_build_object('ligado', w.estado = 'conectado',
                                            'pausado_ate', case when w.pausado_ate > now() then w.pausado_ate end,
                                            'pausa_motivo', case when w.pausado_ate > now() then w.pausa_motivo end)
                     from a1_whatsapp_conexoes w where w.tenant_id = a1_tenant()),
                  json_build_object('ligado', false)) end;
$$;
revoke all on function a1_wa_ligado() from public;
grant execute on function a1_wa_ligado() to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- COMO CONFERIR (no SQL Editor, depois de rodar)
--   select count(*) from a1_ia_conexoes;          -- 0
--   select count(*) from a1_whatsapp_conexoes;    -- 0
--   select count(*) from a1_whatsapp_envios;      -- 0
--   select count(*) from a1_atendimento_mensagens where externo is not null; -- 0
--   select proname from pg_proc where proname in ('a1_conector_contexto','a1_wa_receber',
--     'a1_wa_estado','a1_wa_uso','a1_wa_pausar','a1_atend_wa_alvo','a1_wa_registrar_envio',
--     'a1_wa_registrar_falha','a1_wa_ligado','a1_wa_webhook_tenant','a1_wa_chave',
--     'a1_tenant_tem_modulo') order by 1;       -- 12 linhas
-- ════════════════════════════════════════════════════════════════════════════
