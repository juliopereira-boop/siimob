-- ════════════════════════════════════════════════════════════════════════════
-- MÓDULO LOCAÇÃO (LOCACAO) · fase 1: cadastros, contrato, cobranças e repasse
--
-- POR QUE ESTE ARQUIVO EXISTE
--   "Agora vamos criar o módulo de locação". Fase 1 escolhida pelo dono:
--   cadastro próprio de imóveis + contrato + cobranças + repasse ao proprietário.
--
-- O QUE ELE FAZ
--   1. Cadastra o módulo LOCACAO em a1_modules. Ninguém recebe a licença: o
--      superadmin liga cliente por cliente (regra do sistema).
--   2. Tabelas do cliente (todas com tenant_id):
--      a1_lc_pessoas            proprietários, inquilinos e fiadores
--      a1_lc_imoveis            imóveis (cadastro próprio; vínculo opcional com
--                               uma unidade da Disposição)
--      a1_lc_imovel_donos       proprietários de cada imóvel e a parte de cada um
--      a1_lc_contratos          contrato de locação (prazo, vencimento, valor,
--                               índice e mês de reajuste, UMA garantia, multas,
--                               taxa de administração, encargos mensais)
--      a1_lc_cobrancas          cobrança mensal do inquilino
--      a1_lc_lancamentos        despesas/créditos do proprietário (descontados
--                               ou somados no próximo repasse)
--      a1_lc_repasses           repasse de cada cobrança paga a cada proprietário
--   3. Leitura e cadastro direto (RLS): só gestor do cliente com a licença.
--      Dinheiro passa por funções (SECURITY DEFINER, com trava por contrato):
--      a1_lc_ativar_contrato, a1_lc_encerrar_contrato, a1_lc_gerar_cobrancas,
--      a1_lc_baixar_cobranca, a1_lc_estornar_cobranca, a1_lc_cancelar_cobranca,
--      a1_lc_pagar_repasse.
--
-- REGRAS DA LEI QUE O BANCO GARANTE (Lei 8.245/91)
--   - Uma garantia só por contrato (art. 37, parágrafo único): um campo, um tipo.
--   - Caução em dinheiro até 3 aluguéis (art. 38, § 2º).
--   - Taxa de administração incide só sobre o aluguel (e multa/juros do aluguel);
--     encargos como condomínio e IPTU são valores de passagem.
--
-- O QUE ELE NÃO MUDA
--   Nada que exista: tabelas novas, vazias. Sem a licença LOCACAO, nenhum
--   cliente vê ou grava nada (políticas e funções conferem a licença).
--
-- Idempotente: pode rodar de novo. Como conferir, no fim do arquivo.
-- ════════════════════════════════════════════════════════════════════════════

insert into a1_modules (key, name, description) values
  ('LOCACAO', 'Locação',
   'Administração de aluguéis: imóveis, proprietários e inquilinos, contrato com garantia, cobrança mensal com multa e juros e repasse ao proprietário com taxa de administração.')
on conflict (key) do nothing;

-- Quem mexe na Locação: gestor do cliente com a licença.
create or replace function a1_lc_pode()
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select a1_tenant() is not null and a1_e_gestor() and a1_tem_modulo('LOCACAO');
$$;
revoke all on function a1_lc_pode() from public;
grant execute on function a1_lc_pode() to anon, authenticated;

-- ── Pessoas ─────────────────────────────────────────────────────────────────
create table if not exists a1_lc_pessoas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  tipo_pessoa text not null default 'pf' check (tipo_pessoa in ('pf', 'pj')),
  nome text not null check (length(btrim(nome)) between 2 and 160),
  documento text check (documento is null or documento ~ '^([0-9]{11}|[0-9]{14})$'),
  email text check (email is null or length(email) <= 160),
  telefone text check (telefone is null or length(telefone) <= 40),
  endereco text check (endereco is null or length(endereco) <= 300),
  -- para o repasse
  pix text check (pix is null or length(pix) <= 140),
  banco text check (banco is null or length(banco) <= 200),
  papeis text[] not null default '{}' check (papeis <@ array['proprietario', 'inquilino', 'fiador']::text[]),
  observacoes text check (observacoes is null or length(observacoes) <= 2000),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists a1_lc_pessoas_doc_uq on a1_lc_pessoas (tenant_id, documento) where documento is not null;
create index if not exists a1_lc_pessoas_nome_idx on a1_lc_pessoas (tenant_id, nome);

-- ── Imóveis ─────────────────────────────────────────────────────────────────
create table if not exists a1_lc_imoveis (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  codigo text check (codigo is null or length(codigo) <= 30),
  tipo text not null default 'apartamento'
    check (tipo in ('apartamento', 'casa', 'sala', 'loja', 'galpao', 'terreno', 'outro')),
  finalidade text not null default 'residencial' check (finalidade in ('residencial', 'comercial')),
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  logradouro text not null check (length(btrim(logradouro)) between 2 and 200),
  numero text check (numero is null or length(numero) <= 20),
  complemento text check (complemento is null or length(complemento) <= 80),
  bairro text check (bairro is null or length(bairro) <= 80),
  cidade text check (cidade is null or length(cidade) <= 80),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  area_m2 numeric(10,2) check (area_m2 is null or area_m2 >= 0),
  quartos int check (quartos is null or quartos between 0 and 99),
  vagas int check (vagas is null or vagas between 0 and 99),
  valor_aluguel numeric(12,2) check (valor_aluguel is null or valor_aluguel >= 0),
  valor_condominio numeric(12,2) check (valor_condominio is null or valor_condominio >= 0),
  valor_iptu numeric(12,2) check (valor_iptu is null or valor_iptu >= 0),
  situacao text not null default 'disponivel' check (situacao in ('disponivel', 'alugado', 'manutencao', 'inativo')),
  unidade_id uuid,
  observacoes text check (observacoes is null or length(observacoes) <= 2000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists a1_lc_imoveis_idx on a1_lc_imoveis (tenant_id, situacao);

create table if not exists a1_lc_imovel_donos (
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  imovel_id uuid not null references a1_lc_imoveis(id) on delete cascade,
  pessoa_id uuid not null references a1_lc_pessoas(id),
  percentual numeric(5,2) not null check (percentual > 0 and percentual <= 100),
  primary key (imovel_id, pessoa_id)
);

-- ── Contratos ───────────────────────────────────────────────────────────────
create table if not exists a1_lc_contratos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  codigo text check (codigo is null or length(codigo) <= 30),
  imovel_id uuid not null references a1_lc_imoveis(id),
  inquilino_id uuid not null references a1_lc_pessoas(id),
  finalidade text not null default 'residencial' check (finalidade in ('residencial', 'comercial')),
  data_inicio date not null,
  prazo_meses int not null default 30 check (prazo_meses between 1 and 240),
  dia_vencimento int not null default 10 check (dia_vencimento between 1 and 28),
  valor_aluguel numeric(12,2) not null check (valor_aluguel > 0),
  indice_reajuste text not null default 'IGPM' check (indice_reajuste in ('IGPM', 'IPCA', 'INPC', 'NENHUM')),
  mes_reajuste int check (mes_reajuste is null or mes_reajuste between 1 and 12),
  -- Lei 8.245, art. 37, parágrafo único: uma garantia só por contrato.
  garantia_tipo text not null default 'nenhuma'
    check (garantia_tipo in ('nenhuma', 'caucao', 'fiador', 'seguro_fianca', 'cessao_cotas')),
  garantia_valor numeric(12,2) check (garantia_valor is null or garantia_valor >= 0),
  fiador_id uuid references a1_lc_pessoas(id),
  garantia_detalhe text check (garantia_detalhe is null or length(garantia_detalhe) <= 500),
  multa_atraso_pct numeric(5,2) not null default 10 check (multa_atraso_pct between 0 and 20),
  juros_mes_pct numeric(5,2) not null default 1 check (juros_mes_pct between 0 and 10),
  multa_rescisao_alugueis numeric(4,1) not null default 3 check (multa_rescisao_alugueis between 0 and 12),
  taxa_adm_pct numeric(5,2) not null default 10 check (taxa_adm_pct between 0 and 100),
  repasse_dias int not null default 5 check (repasse_dias between 0 and 60),
  -- encargos mensais: [{descricao, valor, destino: 'proprietario'|'terceiro'}]
  --   proprietario: entra no repasse (sem taxa de administração)
  --   terceiro: a imobiliária paga a terceiros (condomínio, IPTU); fora do repasse
  encargos jsonb not null default '[]'::jsonb check (jsonb_typeof(encargos) = 'array'),
  status text not null default 'rascunho' check (status in ('rascunho', 'ativo', 'encerrado', 'rescindido')),
  encerrado_em date,
  observacoes text check (observacoes is null or length(observacoes) <= 4000),
  criado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint a1_lc_garantia_coerente check (
    (garantia_tipo = 'fiador') = (fiador_id is not null)
    and (garantia_tipo <> 'caucao' or (garantia_valor is not null and garantia_valor <= valor_aluguel * 3))
  )
);
create unique index if not exists a1_lc_um_ativo_por_imovel on a1_lc_contratos (imovel_id) where status = 'ativo';
create index if not exists a1_lc_contratos_idx on a1_lc_contratos (tenant_id, status);

-- ── Cobranças ───────────────────────────────────────────────────────────────
create table if not exists a1_lc_cobrancas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  contrato_id uuid not null references a1_lc_contratos(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  vencimento date not null,
  -- [{tipo: 'aluguel'|'encargo', descricao, valor, destino}]
  itens jsonb not null default '[]'::jsonb check (jsonb_typeof(itens) = 'array'),
  valor_total numeric(12,2) not null check (valor_total >= 0),
  status text not null default 'aberta' check (status in ('aberta', 'paga', 'cancelada')),
  pago_em date,
  valor_pago numeric(12,2),
  multa numeric(12,2) not null default 0,
  juros numeric(12,2) not null default 0,
  desconto numeric(12,2) not null default 0,
  forma_pagamento text check (forma_pagamento is null or forma_pagamento in ('pix', 'boleto', 'transferencia', 'dinheiro', 'outro')),
  observacao text check (observacao is null or length(observacao) <= 1000),
  versao int not null default 1,
  criado_em timestamptz not null default now()
);
create unique index if not exists a1_lc_cobranca_mes_uq on a1_lc_cobrancas (contrato_id, competencia) where status <> 'cancelada';
create index if not exists a1_lc_cobrancas_idx on a1_lc_cobrancas (tenant_id, status, vencimento);

-- ── Lançamentos do proprietário e repasses ──────────────────────────────────
create table if not exists a1_lc_repasses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  cobranca_id uuid not null references a1_lc_cobrancas(id) on delete cascade,
  contrato_id uuid not null references a1_lc_contratos(id) on delete cascade,
  proprietario_id uuid not null references a1_lc_pessoas(id),
  percentual numeric(5,2) not null,
  aluguel numeric(12,2) not null default 0,     -- parte do aluguel + multa/juros
  encargos numeric(12,2) not null default 0,    -- encargos com destino proprietário
  taxa_adm numeric(12,2) not null default 0,
  lancamentos numeric(12,2) not null default 0, -- despesas (+) e créditos (-) do proprietário
  valor_liquido numeric(12,2) not null,
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'cancelado')),
  previsto_para date,
  pago_em date,
  criado_em timestamptz not null default now()
);
create index if not exists a1_lc_repasses_idx on a1_lc_repasses (tenant_id, status, previsto_para);

create table if not exists a1_lc_lancamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  contrato_id uuid not null references a1_lc_contratos(id) on delete cascade,
  proprietario_id uuid references a1_lc_pessoas(id),   -- null: todos, pela parte de cada um
  descricao text not null check (length(btrim(descricao)) between 2 and 200),
  -- positivo: despesa descontada do proprietário; negativo: crédito a ele
  valor numeric(12,2) not null check (valor <> 0),
  data date not null default current_date,
  repasse_id uuid references a1_lc_repasses(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists a1_lc_lancamentos_idx on a1_lc_lancamentos (contrato_id) where repasse_id is null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['a1_lc_pessoas','a1_lc_imoveis','a1_lc_imovel_donos','a1_lc_contratos',
                           'a1_lc_cobrancas','a1_lc_repasses','a1_lc_lancamentos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
    execute format('drop policy if exists %I on %I', t || '_ler', t);
    execute format('create policy %I on %I for select using (tenant_id = (select a1_tenant()) and (select a1_lc_pode()))', t || '_ler', t);
  end loop;
  -- cadastros: o gestor grava direto (insert/update; excluir só pelo app, sem uso)
  foreach t in array array['a1_lc_pessoas','a1_lc_imoveis','a1_lc_imovel_donos','a1_lc_lancamentos'] loop
    execute format('grant insert, update, delete on %I to anon, authenticated', t);
    execute format('drop policy if exists %I on %I', t || '_gravar', t);
    execute format('create policy %I on %I for all using (tenant_id = (select a1_tenant()) and (select a1_lc_pode())) with check (tenant_id = (select a1_tenant()) and (select a1_lc_pode()))', t || '_gravar', t);
  end loop;
  -- contrato: cria e edita direto só enquanto é rascunho; ativar/encerrar por função
  execute 'grant insert, update on a1_lc_contratos to anon, authenticated';
  execute 'drop policy if exists a1_lc_contratos_gravar on a1_lc_contratos';
  execute 'drop policy if exists a1_lc_contratos_editar on a1_lc_contratos';
  execute $p$create policy a1_lc_contratos_gravar on a1_lc_contratos for insert
    with check (tenant_id = (select a1_tenant()) and (select a1_lc_pode()) and status = 'rascunho')$p$;
  execute $p$create policy a1_lc_contratos_editar on a1_lc_contratos for update
    using (tenant_id = (select a1_tenant()) and (select a1_lc_pode()) and status = 'rascunho')
    with check (tenant_id = (select a1_tenant()) and (select a1_lc_pode()) and status = 'rascunho')$p$;
end $$;

-- Tudo o que um registro aponta (imóvel, pessoa, contrato) tem de ser do MESMO
-- cliente. A chave estrangeira sozinha aceitaria o id de outro cliente.
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
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['a1_lc_imovel_donos', 'a1_lc_contratos', 'a1_lc_lancamentos'] loop
    execute format('drop trigger if exists %I on %I', t || '_mesmo_cliente', t);
    execute format('create trigger %I before insert or update on %I for each row execute function a1_lc_mesmo_cliente()', t || '_mesmo_cliente', t);
  end loop;
end $$;

-- O lançamento já usado num repasse não muda mais.
create or replace function a1_lc_lancamento_trava()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.repasse_id is not null and current_user not in ('postgres', 'service_role') then raise exception 'lancamento_ja_repassado'; end if;
    return old;
  end if;
  if old.repasse_id is not null and current_user not in ('postgres', 'service_role') then raise exception 'lancamento_ja_repassado'; end if;
  return new;
end $$;
drop trigger if exists a1_lc_lancamento_trava_t on a1_lc_lancamentos;
create trigger a1_lc_lancamento_trava_t before update or delete on a1_lc_lancamentos
  for each row execute function a1_lc_lancamento_trava();

-- ── Funções ─────────────────────────────────────────────────────────────────
create or replace function a1_lc_ativar_contrato(p_contrato uuid)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare c a1_lc_contratos%rowtype; v_soma numeric;
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  select * into c from a1_lc_contratos where id = p_contrato and tenant_id = a1_tenant() for update;
  if c.id is null then raise exception 'contrato_nao_encontrado'; end if;
  if c.status <> 'rascunho' then raise exception 'contrato_nao_e_rascunho'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lc-imovel:' || c.imovel_id::text, 0));
  select coalesce(sum(percentual), 0) into v_soma from a1_lc_imovel_donos where imovel_id = c.imovel_id;
  if v_soma <> 100 then raise exception 'proprietarios_nao_somam_100'; end if;
  if exists (select 1 from a1_lc_contratos where imovel_id = c.imovel_id and status = 'ativo') then
    raise exception 'imovel_ja_alugado';
  end if;
  update a1_lc_contratos set status = 'ativo', atualizado_em = now() where id = c.id;
  update a1_lc_imoveis set situacao = 'alugado', atualizado_em = now() where id = c.imovel_id;
  return json_build_object('ok', true);
end $$;

create or replace function a1_lc_encerrar_contrato(p_contrato uuid, p_data date, p_motivo text default 'encerrado')
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare c a1_lc_contratos%rowtype;
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  if p_motivo not in ('encerrado', 'rescindido') then raise exception 'motivo_invalido'; end if;
  select * into c from a1_lc_contratos where id = p_contrato and tenant_id = a1_tenant() for update;
  if c.id is null then raise exception 'contrato_nao_encontrado'; end if;
  if c.status <> 'ativo' then raise exception 'contrato_nao_ativo'; end if;
  update a1_lc_contratos set status = p_motivo, encerrado_em = coalesce(p_data, current_date), atualizado_em = now() where id = c.id;
  update a1_lc_imoveis set situacao = 'disponivel', atualizado_em = now() where id = c.imovel_id and situacao = 'alugado';
  -- cobranças futuras em aberto deixam de valer
  update a1_lc_cobrancas set status = 'cancelada', observacao = 'Contrato ' || p_motivo
   where contrato_id = c.id and status = 'aberta' and competencia > date_trunc('month', coalesce(p_data, current_date))::date;
  return json_build_object('ok', true);
end $$;

-- Gera a cobrança do mês para cada contrato ativo (ou só para um contrato).
-- Não duplica: já existe, pula. Contrato que ainda não começou, ou já acabou
-- naquele mês, pula.
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
    continue when exists (select 1 from a1_lc_cobrancas where contrato_id = c.id and competencia = v_mes and status <> 'cancelada');
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
    insert into a1_lc_cobrancas (tenant_id, contrato_id, competencia, vencimento, itens, valor_total)
    values (c.tenant_id, c.id, v_mes, v_venc, v_itens, round(v_total, 2));
    v_criadas := v_criadas + 1;
  end loop;
  return json_build_object('ok', true, 'criadas', v_criadas);
end $$;

-- Baixa do pagamento: calcula multa (uma vez) e juros (pro rata dia) se pago
-- depois do vencimento, e gera o repasse de cada proprietário.
create or replace function a1_lc_baixar_cobranca(
  p_cobranca uuid, p_pago_em date, p_forma text, p_versao int,
  p_desconto numeric default 0, p_isentar_multa boolean default false)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  b a1_lc_cobrancas%rowtype; c a1_lc_contratos%rowtype;
  v_dias int; v_aluguel numeric; v_enc_prop numeric; v_multa numeric := 0; v_juros numeric := 0;
  v_pago numeric; d record; v_base numeric; v_taxa numeric; v_lanc numeric; v_rep uuid; v_n int := 0;
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  if p_pago_em is null or p_pago_em > current_date + 1 then raise exception 'data_invalida'; end if;
  if p_forma not in ('pix', 'boleto', 'transferencia', 'dinheiro', 'outro') then raise exception 'forma_invalida'; end if;
  if coalesce(p_desconto, 0) < 0 then raise exception 'desconto_invalido'; end if;
  select * into b from a1_lc_cobrancas where id = p_cobranca and tenant_id = a1_tenant();
  if b.id is null then raise exception 'cobranca_nao_encontrada'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lc-contrato:' || b.contrato_id::text, 0));
  select * into b from a1_lc_cobrancas where id = p_cobranca for update;
  if b.status <> 'aberta' then raise exception 'cobranca_nao_aberta'; end if;
  if b.versao <> p_versao then raise exception 'versao_desatualizada'; end if;
  select * into c from a1_lc_contratos where id = b.contrato_id;

  select coalesce(sum((i->>'valor')::numeric) filter (where i->>'tipo' = 'aluguel'), 0),
         coalesce(sum((i->>'valor')::numeric) filter (where i->>'tipo' <> 'aluguel' and i->>'destino' = 'proprietario'), 0)
    into v_aluguel, v_enc_prop
    from jsonb_array_elements(b.itens) i;
  v_dias := greatest(0, p_pago_em - b.vencimento);
  if v_dias > 0 and not p_isentar_multa then
    v_multa := round(b.valor_total * c.multa_atraso_pct / 100, 2);
    v_juros := round(b.valor_total * c.juros_mes_pct / 100 / 30 * v_dias, 2);
  end if;
  v_pago := round(b.valor_total + v_multa + v_juros - coalesce(p_desconto, 0), 2);
  if v_pago < 0 then raise exception 'desconto_invalido'; end if;
  update a1_lc_cobrancas
     set status = 'paga', pago_em = p_pago_em, forma_pagamento = p_forma, multa = v_multa, juros = v_juros,
         desconto = coalesce(p_desconto, 0), valor_pago = v_pago, versao = versao + 1
   where id = b.id;

  -- Repasse por proprietário. Base da taxa: aluguel + multa + juros − desconto
  -- (o desconto sai do aluguel). Encargos do proprietário entram sem taxa.
  for d in select o.pessoa_id, o.percentual from a1_lc_imovel_donos o where o.imovel_id = c.imovel_id loop
    v_base := round((v_aluguel + v_multa + v_juros - coalesce(p_desconto, 0)) * d.percentual / 100, 2);
    v_taxa := round(v_base * c.taxa_adm_pct / 100, 2);
    insert into a1_lc_repasses (tenant_id, cobranca_id, contrato_id, proprietario_id, percentual,
                                aluguel, encargos, taxa_adm, lancamentos, valor_liquido, previsto_para)
    values (b.tenant_id, b.id, c.id, d.pessoa_id, d.percentual, v_base,
            round(v_enc_prop * d.percentual / 100, 2), v_taxa, 0, 0, p_pago_em + c.repasse_dias)
    returning id into v_rep;
    -- lançamentos pendentes: os dele e a parte dele nos lançamentos de todos
    update a1_lc_lancamentos set repasse_id = v_rep
     where contrato_id = c.id and repasse_id is null and proprietario_id = d.pessoa_id;
    select coalesce(sum(valor), 0) into v_lanc from a1_lc_lancamentos where repasse_id = v_rep;
    v_lanc := v_lanc + coalesce((select round(sum(valor) * d.percentual / 100, 2) from a1_lc_lancamentos
                                  where contrato_id = c.id and repasse_id is null and proprietario_id is null), 0);
    update a1_lc_repasses
       set lancamentos = v_lanc,
           valor_liquido = round(aluguel + encargos - taxa_adm - v_lanc, 2)
     where id = v_rep;
    v_n := v_n + 1;
  end loop;
  -- os lançamentos "de todos" foram rateados: ficam presos ao primeiro repasse desta cobrança
  update a1_lc_lancamentos set repasse_id = (select id from a1_lc_repasses where cobranca_id = b.id order by criado_em, id limit 1)
   where contrato_id = c.id and repasse_id is null and proprietario_id is null and v_n > 0;
  return json_build_object('ok', true, 'valor_pago', v_pago, 'multa', v_multa, 'juros', v_juros, 'repasses', v_n);
end $$;

-- Desfaz uma baixa feita por engano, se nenhum repasse dela foi pago.
create or replace function a1_lc_estornar_cobranca(p_cobranca uuid, p_versao int)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare b a1_lc_cobrancas%rowtype;
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  select * into b from a1_lc_cobrancas where id = p_cobranca and tenant_id = a1_tenant();
  if b.id is null then raise exception 'cobranca_nao_encontrada'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lc-contrato:' || b.contrato_id::text, 0));
  select * into b from a1_lc_cobrancas where id = p_cobranca for update;
  if b.status <> 'paga' then raise exception 'cobranca_nao_paga'; end if;
  if b.versao <> p_versao then raise exception 'versao_desatualizada'; end if;
  if exists (select 1 from a1_lc_repasses where cobranca_id = b.id and status = 'pago') then
    raise exception 'repasse_ja_pago';
  end if;
  update a1_lc_lancamentos set repasse_id = null where repasse_id in (select id from a1_lc_repasses where cobranca_id = b.id);
  delete from a1_lc_repasses where cobranca_id = b.id;
  update a1_lc_cobrancas
     set status = 'aberta', pago_em = null, forma_pagamento = null, multa = 0, juros = 0, desconto = 0,
         valor_pago = null, versao = versao + 1
   where id = b.id;
  return json_build_object('ok', true);
end $$;

create or replace function a1_lc_cancelar_cobranca(p_cobranca uuid, p_versao int, p_motivo text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare b a1_lc_cobrancas%rowtype;
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  select * into b from a1_lc_cobrancas where id = p_cobranca and tenant_id = a1_tenant() for update;
  if b.id is null then raise exception 'cobranca_nao_encontrada'; end if;
  if b.status <> 'aberta' then raise exception 'cobranca_nao_aberta'; end if;
  if b.versao <> p_versao then raise exception 'versao_desatualizada'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'motivo_obrigatorio'; end if;
  update a1_lc_cobrancas set status = 'cancelada', observacao = left(btrim(p_motivo), 1000), versao = versao + 1 where id = b.id;
  return json_build_object('ok', true);
end $$;

create or replace function a1_lc_pagar_repasse(p_repasse uuid, p_pago_em date)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare r a1_lc_repasses%rowtype;
begin
  if not a1_lc_pode() then raise exception 'sem_permissao'; end if;
  if p_pago_em is null or p_pago_em > current_date + 1 then raise exception 'data_invalida'; end if;
  select * into r from a1_lc_repasses where id = p_repasse and tenant_id = a1_tenant() for update;
  if r.id is null then raise exception 'repasse_nao_encontrado'; end if;
  if r.status <> 'pendente' then raise exception 'repasse_nao_pendente'; end if;
  update a1_lc_repasses set status = 'pago', pago_em = p_pago_em where id = r.id;
  return json_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['a1_lc_ativar_contrato(uuid)', 'a1_lc_encerrar_contrato(uuid, date, text)',
    'a1_lc_gerar_cobrancas(date, uuid)', 'a1_lc_baixar_cobranca(uuid, date, text, int, numeric, boolean)',
    'a1_lc_estornar_cobranca(uuid, int)', 'a1_lc_cancelar_cobranca(uuid, int, text)',
    'a1_lc_pagar_repasse(uuid, date)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- COMO CONFERIR
--   select key from a1_modules where key = 'LOCACAO';                          -- 1 linha
--   select count(*) from a1_tenant_modules where module_key = 'LOCACAO';       -- 0
--   select count(*) from information_schema.tables where table_name like 'a1_lc_%';  -- 7
-- ════════════════════════════════════════════════════════════════════════════
