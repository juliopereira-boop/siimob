-- ════════════════════════════════════════════════════════════════════════════
-- MÓDULO LOCAÇÃO · fase 2: ID automático, modelos de documento, reajuste
-- automático, renovação, rescisão com multa proporcional e vistoria
--
-- POR QUE ESTE ARQUIVO EXISTE
--   "agora vamos para fase 2 com mais alguns ajustes: Geração de contrato mesmo
--    na aba contratos, o documento, preciso que esse 'codigo' vire ID, e ele
--    gere de forma automatica". Fase 2 escolhida: documento (modelo padrão +
--    editável por cliente), reajuste automático, renovação e rescisão, vistoria.
--
-- O QUE ELE FAZ
--   1. ID automático: coluna `seq` em a1_lc_contratos e a1_lc_imoveis,
--      sequencial por cliente, preenchido pelo banco (o navegador não escolhe e
--      não muda). Linhas que já existem recebem o número pela ordem de criação.
--      A coluna antiga `codigo` fica como está (nada é apagado).
--   2. a1_lc_modelos: o texto do modelo de cada documento por cliente (contrato
--      residencial, comercial, termo de entrega de chaves). Sem linha, a tela
--      usa o modelo padrão do sistema.
--   3. Reajuste: a1_lc_indices guarda o índice mensal (IGP-M, IPCA, INPC) lido
--      da API pública do Banco Central (SGS 189, 433, 188) pelo próprio banco
--      (pg_net + pg_cron). a1_lc_reajuste_previa mostra o devido; o gestor
--      aplica (a1_lc_aplicar_reajuste) ou o contrato com reajuste_auto é
--      reajustado sozinho no mês do aniversário. Deflação não reduz o aluguel.
--   4. a1_lc_aditivos: histórico de reajuste, renovação e rescisão.
--      a1_lc_renovar_contrato (prazo e valor novos) e a1_lc_rescindir_contrato
--      (multa rescisória proporcional ao tempo que falta, Lei 8.245 art. 4º, e
--      aluguel proporcional do mês, numa cobrança avulsa).
--   5. Cobrança avulsa: coluna `tipo` (mensal | avulsa). A trava de "uma por
--      mês" vale só para a mensal.
--   6. Vistoria: a1_lc_vistorias + a1_lc_vistoria_itens (cômodo, item, estado,
--      observação, fotos no bucket case-documents, pasta do cliente). Edita
--      enquanto rascunho; concluída, trava.
--
-- O QUE ELE NÃO MUDA
--   Nenhum valor de contrato, cobrança, repasse ou pessoa existente. O único
--   dado acrescentado em linha existente é o `seq` (ID novo). Contratos que
--   já existem nascem com reajuste_auto = false: ninguém é reajustado sozinho
--   sem o gestor ligar. Sem a licença LOCACAO nada aparece.
--
-- Idempotente: pode rodar de novo.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. ID automático ────────────────────────────────────────────────────────
alter table a1_lc_contratos add column if not exists seq int;
alter table a1_lc_imoveis add column if not exists seq int;

do $$
declare t text;
begin
  foreach t in array array['a1_lc_contratos', 'a1_lc_imoveis'] loop
    execute format($f$
      update %1$I x set seq = y.n
        from (select id, (select coalesce(max(seq), 0) from %1$I m where m.tenant_id = s.tenant_id)
                         + row_number() over (partition by tenant_id order by criado_em, id) as n
                from %1$I s where seq is null) y
       where x.id = y.id$f$, t);
  end loop;
end $$;
create unique index if not exists a1_lc_contratos_seq_uq on a1_lc_contratos (tenant_id, seq);
create unique index if not exists a1_lc_imoveis_seq_uq on a1_lc_imoveis (tenant_id, seq);

create or replace function a1_lc_numerar()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if old.seq is not null then new.seq := old.seq; end if;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lc-num:' || tg_table_name || ':' || new.tenant_id::text, 0));
  execute format('select coalesce(max(seq), 0) + 1 from %I where tenant_id = $1', tg_table_name)
    into new.seq using new.tenant_id;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['a1_lc_contratos', 'a1_lc_imoveis'] loop
    execute format('drop trigger if exists %I on %I', t || '_numerar', t);
    execute format('create trigger %I before insert or update on %I for each row execute function a1_lc_numerar()', t || '_numerar', t);
  end loop;
end $$;

-- ── 2. Contrato: reajuste automático e prazo maior (renovações somam) ──────
alter table a1_lc_contratos add column if not exists reajuste_auto boolean not null default false;
alter table a1_lc_contratos drop constraint if exists a1_lc_contratos_prazo_meses_check;
alter table a1_lc_contratos drop constraint if exists a1_lc_prazo_valido;
alter table a1_lc_contratos add constraint a1_lc_prazo_valido check (prazo_meses between 1 and 600);

-- ── 3. Cobrança avulsa ──────────────────────────────────────────────────────
alter table a1_lc_cobrancas add column if not exists tipo text not null default 'mensal';
alter table a1_lc_cobrancas drop constraint if exists a1_lc_cobranca_tipo;
alter table a1_lc_cobrancas add constraint a1_lc_cobranca_tipo check (tipo in ('mensal', 'avulsa'));
drop index if exists a1_lc_cobranca_mes_uq;
create unique index if not exists a1_lc_cobranca_mensal_uq on a1_lc_cobrancas (contrato_id, competencia)
  where status <> 'cancelada' and tipo = 'mensal';

-- ── 4. Modelos de documento ─────────────────────────────────────────────────
create table if not exists a1_lc_modelos (
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  tipo text not null check (tipo in ('contrato_residencial', 'contrato_comercial', 'entrega_chaves')),
  texto text not null check (length(texto) between 20 and 60000),
  atualizado_em timestamptz not null default now(),
  primary key (tenant_id, tipo)
);

-- ── 5. Aditivos (histórico) ─────────────────────────────────────────────────
create table if not exists a1_lc_aditivos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  contrato_id uuid not null references a1_lc_contratos(id) on delete cascade,
  tipo text not null check (tipo in ('reajuste', 'renovacao', 'rescisao')),
  data date not null default current_date,
  referencia date,                 -- reajuste: mês do aniversário a que se refere
  indice text,
  percentual numeric(8,4),
  valor_antes numeric(12,2),
  valor_depois numeric(12,2),
  prazo_antes int,
  prazo_depois int,
  origem text not null default 'manual' check (origem in ('manual', 'automatico')),
  detalhe jsonb not null default '{}'::jsonb,
  observacao text check (observacao is null or length(observacao) <= 1000),
  criado_em timestamptz not null default now()
);
create index if not exists a1_lc_aditivos_idx on a1_lc_aditivos (contrato_id, tipo, referencia);

-- ── 6. Índices econômicos (dado público, igual para todos) ─────────────────
create table if not exists a1_lc_indices (
  indice text not null check (indice in ('IGPM', 'IPCA', 'INPC')),
  mes date not null check (extract(day from mes) = 1),
  valor numeric(8,4) not null,     -- variação % do mês
  atualizado_em timestamptz not null default now(),
  primary key (indice, mes)
);
create table if not exists a1_lc_indices_pedidos (
  id bigint primary key,           -- id do pedido no pg_net
  indice text not null,
  criado_em timestamptz not null default now()
);

-- ── 7. Vistoria ─────────────────────────────────────────────────────────────
create table if not exists a1_lc_vistorias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  imovel_id uuid not null references a1_lc_imoveis(id) on delete cascade,
  contrato_id uuid references a1_lc_contratos(id) on delete set null,
  tipo text not null default 'entrada' check (tipo in ('entrada', 'saida', 'periodica')),
  data date not null default current_date,
  responsavel text check (responsavel is null or length(responsavel) <= 120),
  observacoes text check (observacoes is null or length(observacoes) <= 4000),
  status text not null default 'rascunho' check (status in ('rascunho', 'concluida')),
  concluida_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists a1_lc_vistorias_idx on a1_lc_vistorias (tenant_id, imovel_id, data);
create table if not exists a1_lc_vistoria_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  vistoria_id uuid not null references a1_lc_vistorias(id) on delete cascade,
  ordem int not null default 0,
  comodo text not null check (length(btrim(comodo)) between 1 and 80),
  item text not null check (length(btrim(item)) between 1 and 120),
  estado text not null default 'bom' check (estado in ('novo', 'bom', 'regular', 'ruim', 'inexistente')),
  observacao text check (observacao is null or length(observacao) <= 1000),
  fotos jsonb not null default '[]'::jsonb check (case when jsonb_typeof(fotos) = 'array' then jsonb_array_length(fotos) <= 12 else false end),
  criado_em timestamptz not null default now()
);
create index if not exists a1_lc_vistoria_itens_idx on a1_lc_vistoria_itens (vistoria_id, ordem);

-- ── RLS ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['a1_lc_modelos', 'a1_lc_aditivos', 'a1_lc_vistorias', 'a1_lc_vistoria_itens'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
    execute format('drop policy if exists %I on %I', t || '_ler', t);
    execute format('create policy %I on %I for select using (tenant_id = (select a1_tenant()) and (select a1_lc_pode()))', t || '_ler', t);
  end loop;
  -- modelos: o gestor grava direto
  execute 'grant insert, update, delete on a1_lc_modelos to anon, authenticated';
  execute 'drop policy if exists a1_lc_modelos_gravar on a1_lc_modelos';
  execute $p$create policy a1_lc_modelos_gravar on a1_lc_modelos for all
    using (tenant_id = (select a1_tenant()) and (select a1_lc_pode()))
    with check (tenant_id = (select a1_tenant()) and (select a1_lc_pode()))$p$;
  -- vistoria: grava direto enquanto rascunho; concluir é por função
  execute 'grant insert, update, delete on a1_lc_vistorias, a1_lc_vistoria_itens to anon, authenticated';
  execute 'drop policy if exists a1_lc_vistorias_gravar on a1_lc_vistorias';
  execute $p$create policy a1_lc_vistorias_gravar on a1_lc_vistorias for all
    using (tenant_id = (select a1_tenant()) and (select a1_lc_pode()) and status = 'rascunho')
    with check (tenant_id = (select a1_tenant()) and (select a1_lc_pode()) and status = 'rascunho')$p$;
  execute 'drop policy if exists a1_lc_vistoria_itens_gravar on a1_lc_vistoria_itens';
  execute $p$create policy a1_lc_vistoria_itens_gravar on a1_lc_vistoria_itens for all
    using (tenant_id = (select a1_tenant()) and (select a1_lc_pode())
           and exists (select 1 from a1_lc_vistorias v where v.id = vistoria_id and v.status = 'rascunho'))
    with check (tenant_id = (select a1_tenant()) and (select a1_lc_pode())
           and exists (select 1 from a1_lc_vistorias v where v.id = vistoria_id and v.status = 'rascunho'))$p$;
  -- índices: dado público, só leitura
  execute 'alter table a1_lc_indices enable row level security';
  execute 'revoke all on a1_lc_indices from public, anon, authenticated';
  execute 'grant select on a1_lc_indices to anon, authenticated';
  execute 'drop policy if exists a1_lc_indices_ler on a1_lc_indices';
  execute 'create policy a1_lc_indices_ler on a1_lc_indices for select using (true)';
  execute 'alter table a1_lc_indices_pedidos enable row level security';
  execute 'revoke all on a1_lc_indices_pedidos from public, anon, authenticated';
end $$;

-- Mesmo cliente em toda referência (refaz a função da fase 1 com as tabelas novas).
create or replace function a1_lc_mesmo_cliente()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if tg_table_name = 'a1_lc_imovel_donos' then
    if not exists (select 1 from a1_lc_imoveis where id = new.imovel_id and tenant_id = new.tenant_id)
       or not exists (select 1 from a1_lc_pessoas where id = new.pessoa_id and tenant_id = new.tenant_id) then
      raise exception 'referencia_de_outro_cliente';
    end if;
  elsif tg_table_name = 'a1_lc_contratos' then
    if not exists (select 1 from a1_lc_imoveis where id = new.imovel_id and tenant_id = new.tenant_id)
       or not exists (select 1 from a1_lc_pessoas where id = new.inquilino_id and tenant_id = new.tenant_id)
       or (new.fiador_id is not null and not exists (select 1 from a1_lc_pessoas where id = new.fiador_id and tenant_id = new.tenant_id)) then
      raise exception 'referencia_de_outro_cliente';
    end if;
  elsif tg_table_name = 'a1_lc_lancamentos' then
    if not exists (select 1 from a1_lc_contratos where id = new.contrato_id and tenant_id = new.tenant_id)
       or (new.proprietario_id is not null and not exists (select 1 from a1_lc_pessoas where id = new.proprietario_id and tenant_id = new.tenant_id)) then
      raise exception 'referencia_de_outro_cliente';
    end if;
  elsif tg_table_name = 'a1_lc_vistorias' then
    if not exists (select 1 from a1_lc_imoveis where id = new.imovel_id and tenant_id = new.tenant_id)
       or (new.contrato_id is not null and not exists (
             select 1 from a1_lc_contratos where id = new.contrato_id and tenant_id = new.tenant_id and imovel_id = new.imovel_id)) then
      raise exception 'referencia_de_outro_cliente';
    end if;
  elsif tg_table_name = 'a1_lc_vistoria_itens' then
    if not exists (select 1 from a1_lc_vistorias where id = new.vistoria_id and tenant_id = new.tenant_id) then
      raise exception 'referencia_de_outro_cliente';
    end if;
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['a1_lc_vistorias', 'a1_lc_vistoria_itens'] loop
    execute format('drop trigger if exists %I on %I', t || '_mesmo_cliente', t);
    execute format('create trigger %I before insert or update on %I for each row execute function a1_lc_mesmo_cliente()', t || '_mesmo_cliente', t);
  end loop;
end $$;

-- ── Gerar cobranças: a trava de "uma por mês" vale só para a mensal ────────
create or replace function a1_lc_gerar_cobrancas(p_competencia date, p_contrato uuid default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_mes date := date_trunc('month', p_competencia)::date;
  c record; v_itens jsonb; v_total numeric; v_venc date; v_criadas int := 0; v_ultimo int;
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  if p_competencia is null then raise exception 'competencia_invalida'; end if;
  for c in
    select * from a1_lc_contratos
     where tenant_id = a1_tenant() and status = 'ativo'
       and (p_contrato is null or id = p_contrato)
       and date_trunc('month', data_inicio)::date <= v_mes
       and (data_inicio + make_interval(months => prazo_meses))::date > v_mes
  loop
    perform pg_advisory_xact_lock(hashtextextended('lc-contrato:' || c.id::text, 0));
    continue when exists (select 1 from a1_lc_cobrancas where contrato_id = c.id and competencia = v_mes
                           and status <> 'cancelada' and tipo = 'mensal');
    v_itens := jsonb_build_array(jsonb_build_object('tipo', 'aluguel', 'descricao', 'Aluguel', 'valor', c.valor_aluguel, 'destino', 'proprietario'));
    select v_itens || coalesce(jsonb_agg(jsonb_build_object(
             'tipo', 'encargo', 'descricao', left(coalesce(e->>'descricao', 'Encargo'), 80),
             'valor', round((e->>'valor')::numeric, 2),
             'destino', case when e->>'destino' = 'proprietario' then 'proprietario' else 'terceiro' end)), '[]'::jsonb)
      into v_itens
      from jsonb_array_elements(c.encargos) e
     where (e->>'valor') ~ '^[0-9]+(\.[0-9]{1,2})?$' and (e->>'valor')::numeric > 0;
    select sum((i->>'valor')::numeric) into v_total from jsonb_array_elements(v_itens) i;
    v_ultimo := extract(day from (v_mes + interval '1 month - 1 day'))::int;
    v_venc := make_date(extract(year from v_mes)::int, extract(month from v_mes)::int, least(c.dia_vencimento, v_ultimo));
    insert into a1_lc_cobrancas (tenant_id, contrato_id, competencia, vencimento, itens, valor_total, tipo)
    values (c.tenant_id, c.id, v_mes, v_venc, v_itens, round(v_total, 2), 'mensal');
    v_criadas := v_criadas + 1;
  end loop;
  return json_build_object('ok', true, 'criadas', v_criadas);
end $$;

-- ── Reajuste ────────────────────────────────────────────────────────────────
-- Variação acumulada (%) dos 12 meses que terminam em p_ate. Null se faltar mês.
create or replace function a1_lc_indice_acumulado(p_indice text, p_ate date)
returns numeric language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case when count(*) = 12 then round((exp(sum(ln(1 + valor / 100))) - 1) * 100, 4) end
    from a1_lc_indices
   where indice = p_indice
     and mes between (date_trunc('month', p_ate) - interval '11 months')::date and date_trunc('month', p_ate)::date;
$$;
revoke all on function a1_lc_indice_acumulado(text, date) from public;
grant execute on function a1_lc_indice_acumulado(text, date) to anon, authenticated;

-- O reajuste devido de um contrato (sem conferir sessão: uso interno).
--   devido: o mês de reajuste mais recente que já chegou, desde que o contrato
--           tenha 12 meses naquele mês e ainda esteja vigente;
--   referência: 12 meses do índice até o mês anterior ao devido (ou, se o
--           índice daquele mês ainda não saiu, até dois meses antes).
create or replace function a1_lc_reajuste_calculo(p_contrato uuid)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare
  c a1_lc_contratos%rowtype; v_mes int; v_devido date; v_ref date; v_pct numeric; v_fim date; v_hoje date := date_trunc('month', current_date)::date;
begin
  select * into c from a1_lc_contratos where id = p_contrato;
  if c.id is null or c.status <> 'ativo' or c.indice_reajuste = 'NENHUM' then
    return json_build_object('devido', null);
  end if;
  v_mes := coalesce(c.mes_reajuste, extract(month from c.data_inicio)::int);
  v_devido := make_date(extract(year from current_date)::int, v_mes, 1);
  if v_devido > v_hoje then v_devido := (v_devido - interval '1 year')::date; end if;
  v_fim := (c.data_inicio + make_interval(months => c.prazo_meses))::date;
  if v_devido < (date_trunc('month', c.data_inicio) + interval '12 months')::date or v_devido >= v_fim then
    return json_build_object('devido', null);
  end if;
  v_ref := (v_devido - interval '1 month')::date;
  v_pct := a1_lc_indice_acumulado(c.indice_reajuste, v_ref);
  if v_pct is null then
    v_ref := (v_devido - interval '2 months')::date;
    v_pct := a1_lc_indice_acumulado(c.indice_reajuste, v_ref);
  end if;
  return json_build_object(
    'devido', v_devido,
    'aplicado', exists (select 1 from a1_lc_aditivos where contrato_id = c.id and tipo = 'reajuste' and referencia = v_devido),
    'indice', c.indice_reajuste,
    'referencia_ate', case when v_pct is not null then v_ref end,
    'acumulado', v_pct,
    'percentual', case when v_pct is not null then greatest(v_pct, 0) end,
    'valor_antes', c.valor_aluguel,
    'valor_depois', case when v_pct is not null then round(c.valor_aluguel * (1 + greatest(v_pct, 0) / 100), 2) end);
end $$;
revoke all on function a1_lc_reajuste_calculo(uuid) from public, anon, authenticated;

create or replace function a1_lc_reajuste_previa(p_contrato uuid)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  if not exists (select 1 from a1_lc_contratos where id = p_contrato and tenant_id = a1_tenant()) then
    raise exception 'contrato_nao_encontrado';
  end if;
  return a1_lc_reajuste_calculo(p_contrato);
end $$;

-- Aplica (uso interno): grava o aditivo e muda o aluguel.
create or replace function a1_lc_reajustar(p_contrato uuid, p_percentual numeric, p_origem text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare c a1_lc_contratos%rowtype; v jsonb; v_novo numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('lc-contrato:' || p_contrato::text, 0));
  select * into c from a1_lc_contratos where id = p_contrato for update;
  v := a1_lc_reajuste_calculo(p_contrato)::jsonb;
  if v->>'devido' is null then raise exception 'reajuste_nao_devido'; end if;
  if (v->>'aplicado')::boolean then raise exception 'reajuste_ja_aplicado'; end if;
  if p_percentual is null then raise exception 'indice_indisponivel'; end if;
  if p_percentual < -50 or p_percentual > 100 then raise exception 'percentual_invalido'; end if;
  v_novo := round(c.valor_aluguel * (1 + p_percentual / 100), 2);
  if v_novo <= 0 then raise exception 'percentual_invalido'; end if;
  insert into a1_lc_aditivos (tenant_id, contrato_id, tipo, referencia, indice, percentual, valor_antes, valor_depois, origem, detalhe)
  values (c.tenant_id, c.id, 'reajuste', (v->>'devido')::date, c.indice_reajuste, p_percentual, c.valor_aluguel, v_novo, p_origem,
          jsonb_build_object('acumulado', v->'acumulado', 'referencia_ate', v->'referencia_ate'));
  update a1_lc_contratos set valor_aluguel = v_novo, atualizado_em = now() where id = c.id;
  return json_build_object('ok', true, 'percentual', p_percentual, 'valor_antes', c.valor_aluguel, 'valor_depois', v_novo);
end $$;
revoke all on function a1_lc_reajustar(uuid, numeric, text) from public, anon, authenticated;

-- Gestor aplica. Sem percentual, usa o índice acumulado (deflação = 0%).
create or replace function a1_lc_aplicar_reajuste(p_contrato uuid, p_percentual numeric default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v json;
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  if not exists (select 1 from a1_lc_contratos where id = p_contrato and tenant_id = a1_tenant()) then
    raise exception 'contrato_nao_encontrado';
  end if;
  v := a1_lc_reajuste_calculo(p_contrato);
  return a1_lc_reajustar(p_contrato, coalesce(p_percentual, (v->>'percentual')::numeric), 'manual');
end $$;

-- Rotina diária: reajusta os contratos com reajuste_auto cujo mês chegou e
-- cujo índice já saiu. Só o banco (pg_cron) chama.
create or replace function a1_lc_reajustes_automaticos()
returns int language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare r record; v json; n int := 0;
begin
  for r in select id from a1_lc_contratos where status = 'ativo' and reajuste_auto and indice_reajuste <> 'NENHUM' loop
    v := a1_lc_reajuste_calculo(r.id);
    if v->>'devido' is not null and not (v->>'aplicado')::boolean and v->>'percentual' is not null then
      begin
        perform a1_lc_reajustar(r.id, (v->>'percentual')::numeric, 'automatico');
        n := n + 1;
      exception when others then
        raise warning 'reajuste automático falhou no contrato %: %', r.id, sqlerrm;
      end;
    end if;
  end loop;
  return n;
end $$;
revoke all on function a1_lc_reajustes_automaticos() from public, anon, authenticated;

-- Índices do Banco Central (SGS): pede (pg_net) e colhe na volta seguinte.
create or replace function a1_lc_indices_atualizar()
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare p record; r record; e jsonb; v_colhidos int := 0; v_pedidos int := 0; v_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return json_build_object('ok', false, 'erro', 'pg_net_ausente');
  end if;
  -- colhe as respostas dos pedidos anteriores
  for p in select * from a1_lc_indices_pedidos loop
    execute 'select status_code, content from net._http_response where id = $1' into r using p.id;
    if r.status_code = 200 then
      begin
        for e in select * from jsonb_array_elements(r.content::jsonb) loop
          insert into a1_lc_indices (indice, mes, valor)
          values (p.indice, to_date(e->>'data', 'DD/MM/YYYY'), (e->>'valor')::numeric)
          on conflict (indice, mes) do update set valor = excluded.valor, atualizado_em = now()
            where a1_lc_indices.valor is distinct from excluded.valor;
          v_colhidos := v_colhidos + 1;
        end loop;
      exception when others then
        raise warning 'índice % com resposta inválida: %', p.indice, sqlerrm;
      end;
      delete from a1_lc_indices_pedidos where id = p.id;
    elsif r.status_code is not null or p.criado_em < now() - interval '1 hour' then
      delete from a1_lc_indices_pedidos where id = p.id;
    end if;
  end loop;
  -- pede de novo (os últimos 20 meses de cada índice: a API do BCB recusa mais de 20)
  if not exists (select 1 from a1_lc_indices_pedidos) then
    for p in select * from (values ('IGPM', 189), ('IPCA', 433), ('INPC', 188)) s(indice, serie) loop
      execute 'select net.http_get($1)' into v_id
        using format('https://api.bcb.gov.br/dados/serie/bcdata.sgs.%s/dados/ultimos/20?formato=json', p.serie);
      insert into a1_lc_indices_pedidos (id, indice) values (v_id, p.indice);
      v_pedidos := v_pedidos + 1;
    end loop;
  end if;
  return json_build_object('ok', true, 'colhidos', v_colhidos, 'pedidos', v_pedidos);
end $$;
revoke all on function a1_lc_indices_atualizar() from public, anon, authenticated;

-- Agenda (só onde há pg_cron): índices a cada 6 h; reajustes 1x por dia.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('a1-lc-indices', 'a1-lc-reajustes');
    perform cron.schedule('a1-lc-indices', '17 */6 * * *', 'select public.a1_lc_indices_atualizar()');
    perform cron.schedule('a1-lc-reajustes', '43 10 * * *', 'select public.a1_lc_reajustes_automaticos()');
  end if;
end $$;

-- ── Renovação ───────────────────────────────────────────────────────────────
create or replace function a1_lc_renovar_contrato(p_contrato uuid, p_meses int,
  p_novo_valor numeric default null, p_observacao text default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare c a1_lc_contratos%rowtype;
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  if p_meses is null or p_meses < 1 or p_meses > 120 then raise exception 'prazo_invalido'; end if;
  if p_novo_valor is not null and p_novo_valor <= 0 then raise exception 'valor_invalido'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lc-contrato:' || p_contrato::text, 0));
  select * into c from a1_lc_contratos where id = p_contrato and tenant_id = a1_tenant() for update;
  if c.id is null then raise exception 'contrato_nao_encontrado'; end if;
  if c.status <> 'ativo' then raise exception 'contrato_nao_ativo'; end if;
  if c.prazo_meses + p_meses > 600 then raise exception 'prazo_invalido'; end if;
  update a1_lc_contratos
     set prazo_meses = prazo_meses + p_meses, valor_aluguel = coalesce(p_novo_valor, valor_aluguel), atualizado_em = now()
   where id = c.id;
  insert into a1_lc_aditivos (tenant_id, contrato_id, tipo, valor_antes, valor_depois, prazo_antes, prazo_depois, observacao)
  values (c.tenant_id, c.id, 'renovacao', c.valor_aluguel, coalesce(p_novo_valor, c.valor_aluguel),
          c.prazo_meses, c.prazo_meses + p_meses, left(nullif(btrim(p_observacao), ''), 1000));
  return json_build_object('ok', true, 'prazo_meses', c.prazo_meses + p_meses);
end $$;

-- ── Rescisão antecipada ─────────────────────────────────────────────────────
-- Multa: aluguéis de multa × meses que faltam ÷ prazo (art. 4º). O gestor pode
-- informar outro valor (ex.: 0 na transferência do inquilino pelo empregador,
-- art. 4º parágrafo único). Aluguel proporcional: dias usados do mês, se a
-- cobrança mensal daquele mês ainda não existe. As duas vão numa cobrança
-- avulsa, que segue o caminho normal (baixa, multa por atraso, repasse).
create or replace function a1_lc_rescisao_calculo(p_contrato uuid, p_data date)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare c a1_lc_contratos%rowtype; v_fim date; v_rest int; v_dias_mes int; v_dias int; v_prop numeric := 0;
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  select * into c from a1_lc_contratos where id = p_contrato and tenant_id = a1_tenant();
  if c.id is null then raise exception 'contrato_nao_encontrado'; end if;
  if p_data is null or p_data < c.data_inicio then raise exception 'data_invalida'; end if;
  v_fim := (c.data_inicio + make_interval(months => c.prazo_meses))::date;
  v_rest := least(c.prazo_meses, greatest(0, ceil((v_fim - p_data) / 30.4375)::int));
  v_dias_mes := extract(day from (date_trunc('month', p_data) + interval '1 month - 1 day'))::int;
  v_dias := extract(day from p_data)::int;
  if not exists (select 1 from a1_lc_cobrancas where contrato_id = c.id and tipo = 'mensal' and status <> 'cancelada'
                  and competencia = date_trunc('month', p_data)::date) then
    v_prop := round(c.valor_aluguel * v_dias / v_dias_mes, 2);
  end if;
  return json_build_object('fim', v_fim, 'meses_restantes', v_rest, 'prazo', c.prazo_meses,
    'multa', round(c.valor_aluguel * c.multa_rescisao_alugueis * v_rest / c.prazo_meses, 2),
    'dias', v_dias, 'proporcional', v_prop);
end $$;

create or replace function a1_lc_rescindir_contrato(p_contrato uuid, p_data date,
  p_multa numeric default null, p_proporcional boolean default true,
  p_vencimento date default null, p_observacao text default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare c a1_lc_contratos%rowtype; v jsonb; v_multa numeric; v_prop numeric; v_itens jsonb := '[]'::jsonb; v_cob uuid;
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  if p_multa is not null and p_multa < 0 then raise exception 'valor_invalido'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lc-contrato:' || p_contrato::text, 0));
  select * into c from a1_lc_contratos where id = p_contrato and tenant_id = a1_tenant() for update;
  if c.id is null then raise exception 'contrato_nao_encontrado'; end if;
  if c.status <> 'ativo' then raise exception 'contrato_nao_ativo'; end if;
  v := a1_lc_rescisao_calculo(p_contrato, p_data)::jsonb;
  v_multa := round(coalesce(p_multa, (v->>'multa')::numeric), 2);
  v_prop := case when p_proporcional then (v->>'proporcional')::numeric else 0 end;
  if v_prop > 0 then
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('tipo', 'aluguel',
      'descricao', format('Aluguel proporcional (%s dias)', v->>'dias'), 'valor', v_prop, 'destino', 'proprietario'));
  end if;
  if v_multa > 0 then
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('tipo', 'aluguel',
      'descricao', 'Multa rescisória', 'valor', v_multa, 'destino', 'proprietario'));
  end if;
  if jsonb_array_length(v_itens) > 0 then
    insert into a1_lc_cobrancas (tenant_id, contrato_id, competencia, vencimento, itens, valor_total, tipo, observacao)
    values (c.tenant_id, c.id, date_trunc('month', p_data)::date, coalesce(p_vencimento, p_data + 10), v_itens,
            v_prop + v_multa, 'avulsa', 'Rescisão do contrato')
    returning id into v_cob;
  end if;
  update a1_lc_contratos set status = 'rescindido', encerrado_em = p_data, atualizado_em = now() where id = c.id;
  update a1_lc_imoveis set situacao = 'disponivel', atualizado_em = now() where id = c.imovel_id and situacao = 'alugado';
  update a1_lc_cobrancas set status = 'cancelada', observacao = 'Contrato rescindido', versao = versao + 1
   where contrato_id = c.id and status = 'aberta' and tipo = 'mensal' and competencia > date_trunc('month', p_data)::date;
  insert into a1_lc_aditivos (tenant_id, contrato_id, tipo, data, valor_antes, prazo_antes, detalhe, observacao)
  values (c.tenant_id, c.id, 'rescisao', p_data, c.valor_aluguel, c.prazo_meses,
          v || jsonb_build_object('multa_cobrada', v_multa, 'proporcional_cobrado', v_prop, 'cobranca_id', v_cob),
          left(nullif(btrim(p_observacao), ''), 1000));
  return json_build_object('ok', true, 'multa', v_multa, 'proporcional', v_prop, 'cobranca_id', v_cob);
end $$;

-- ── Vistoria: concluir trava a edição ───────────────────────────────────────
create or replace function a1_lc_concluir_vistoria(p_vistoria uuid)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v a1_lc_vistorias%rowtype;
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  select * into v from a1_lc_vistorias where id = p_vistoria and tenant_id = a1_tenant() for update;
  if v.id is null then raise exception 'vistoria_nao_encontrada'; end if;
  if v.status <> 'rascunho' then raise exception 'vistoria_concluida'; end if;
  if not exists (select 1 from a1_lc_vistoria_itens where vistoria_id = v.id) then raise exception 'vistoria_sem_itens'; end if;
  update a1_lc_vistorias set status = 'concluida', concluida_em = now(), atualizado_em = now() where id = v.id;
  return json_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['a1_lc_reajuste_previa(uuid)', 'a1_lc_aplicar_reajuste(uuid, numeric)',
    'a1_lc_renovar_contrato(uuid, int, numeric, text)', 'a1_lc_rescisao_calculo(uuid, date)',
    'a1_lc_rescindir_contrato(uuid, date, numeric, boolean, date, text)', 'a1_lc_concluir_vistoria(uuid)',
    'a1_lc_gerar_cobrancas(date, uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- COMO CONFERIR
--   select count(*) from a1_lc_contratos where seq is null;                    -- 0
--   select jobname, schedule from cron.job where jobname like 'a1-lc-%';       -- 2 linhas
--   select indice, max(mes) from a1_lc_indices group by 1;                     -- depois da 1ª volta
--   select count(*) from a1_lc_contratos where reajuste_auto;                  -- 0 até o gestor ligar
-- ════════════════════════════════════════════════════════════════════════════
