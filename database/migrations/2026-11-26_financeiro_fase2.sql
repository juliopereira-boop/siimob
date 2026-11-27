-- ════════════════════════════════════════════════════════════════════════════
-- MÓDULO FINANCEIRO · fase 2: carteira de parcelas do cliente (construtora),
-- conciliação bancária (OFX) e DRE com centros de custo e orçamento
--
-- POR QUE ESTE ARQUIVO EXISTE
--   "agora vamos para fase 2 do financeiro". Escolhas do dono: correção INCC
--   até as chaves e IGP-M depois (configurável por empreendimento); lembrete
--   das parcelas pelo WhatsApp oficial. O escopo ficou com o desenvolvimento:
--   carteira, OFX e DRE. Nota fiscal fica para quando houver o emissor.
--
-- O QUE ELE FAZ
--   1. Índices: a1_lc_indices passa a aceitar INCC (INCC-DI, série 192 do
--      Banco Central) e INCCM (INCC-M, série 7456); a coleta automática da
--      Locação passa a buscar também esses dois. Nenhum índice existente muda.
--   2. Carteira (construtora): a venda que entra em VENDIDO gera a carteira do
--      cliente com as parcelas do fluxo de pagamento (ato, sinal, mensais,
--      intermediárias, chaves e as parcelas do banco/FGTS/subsídio). Só para
--      quem ligar "Gerar carteira das vendas" em Cadastros. Correção pelo índice
--      de obra até o mês das chaves e pelo índice pós-chaves (+ juros) depois;
--      atraso com multa e juros de mora pro rata; baixa (entra no caixa como
--      receita), estorno, renegociação e distrato (a venda saindo de VENDIDO).
--   3. Lembretes: a configuração do modelo aprovado do WhatsApp e o registro de
--      cada lembrete (D-3, no dia, D+1, D+7). Quem envia é a função
--      fin-lembretes (rota oficial, com a Evolution de reserva). Agenda no
--      pg_cron (job a1-fin-lembretes, de hora em hora das 12h13 às 20h13 UTC):
--      só chama a função se alguém ligou o lembrete e há lembrete devido, com
--      um código de uso único (a1_fin_lembrete_chamadas), sem segredo guardado.
--   4. Conciliação: extratos OFX importados por conta; cada linha casa com um
--      lançamento (aberto: baixa; pago: só liga) ou com uma parcela da
--      carteira, ou vira um lançamento novo, ou é ignorada.
--   5. DRE: centros de custo, grupo do DRE em cada categoria, centro de custo
--      no lançamento, orçamento por categoria/mês e o DRE por caixa ou por
--      competência.
--
-- O QUE ELE NÃO MUDA
--   Nenhum dado existente é alterado. As colunas novas nascem nulas (ou com
--   padrão que não muda nada: carteira desligada, lembrete desligado). A
--   restrição de origem de a1_fin_lancamentos e a de índice de a1_lc_indices
--   são ALARGADAS (aceitam mais valores; tudo o que existe continua válido).
--   As funções da fase 1 continuam iguais; a1_lc_indices_atualizar ganha as
--   duas séries novas.
--
-- Idempotente: pode rodar de novo. Como conferir, no fim do arquivo.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Índices INCC ─────────────────────────────────────────────────────────
do $$
declare v_nome text;
begin
  for v_nome in select conname from pg_constraint
                 where conrelid = 'a1_lc_indices'::regclass and contype = 'c'
                   and pg_get_constraintdef(oid) like '%IGPM%' and conname <> 'a1_lc_indices_indice_ck' loop
    execute format('alter table a1_lc_indices drop constraint %I', v_nome);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'a1_lc_indices_indice_ck') then
    alter table a1_lc_indices add constraint a1_lc_indices_indice_ck
      check (indice in ('IGPM', 'IPCA', 'INPC', 'INCC', 'INCCM'));
  end if;
end $$;

-- Igual à versão da Locação (2026-11-26_locacao_fase2.sql), com INCC e INCC-M.
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
    for p in select * from (values ('IGPM', 189), ('IPCA', 433), ('INPC', 188), ('INCC', 192), ('INCCM', 7456)) s(indice, serie) loop
      execute 'select net.http_get($1)' into v_id
        using format('https://api.bcb.gov.br/dados/serie/bcdata.sgs.%s/dados/ultimos/20?formato=json', p.serie);
      insert into a1_lc_indices_pedidos (id, indice) values (v_id, p.indice);
      v_pedidos := v_pedidos + 1;
    end loop;
  end if;
  return json_build_object('ok', true, 'colhidos', v_colhidos, 'pedidos', v_pedidos);
end $$;
revoke all on function a1_lc_indices_atualizar() from public, anon, authenticated;

-- Fator acumulado de um índice entre dois meses: meses depois de p_de até
-- p_ate (inclusive). Mês sem índice publicado conta como zero (corrige até o
-- último publicado). p_zera: variação negativa conta como zero.
create or replace function a1_fin_fator(p_indice text, p_de date, p_ate date, p_zera boolean default true)
returns numeric language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case when p_indice is null or p_indice = 'NENHUM' or p_de is null or p_ate is null then 1::numeric
    else coalesce((select exp(sum(ln(1 + (case when p_zera then greatest(i.valor, 0) else i.valor end) / 100)))
                     from a1_lc_indices i
                    where i.indice = p_indice
                      and i.mes > date_trunc('month', p_de)::date
                      and i.mes <= date_trunc('month', p_ate)::date), 1::numeric) end;
$$;
revoke all on function a1_fin_fator(text, date, date, boolean) from public;
grant execute on function a1_fin_fator(text, date, date, boolean) to anon, authenticated;

-- ── 2. Configuração nova (colunas nulas ou desligadas) ──────────────────────
alter table a1_fin_config add column if not exists carteira_ativa boolean not null default false;
alter table a1_fin_config add column if not exists lembrete_ativo boolean not null default false;
-- modelo aprovado da Meta: {nome, idioma, corpo}; variáveis {{1}} nome,
-- {{2}} valor, {{3}} vencimento, {{4}} empreendimento/unidade
alter table a1_fin_config add column if not exists lembrete_modelo jsonb;
alter table a1_fin_config add column if not exists lembrete_dias int[] not null default '{-3,0,1,7}';

-- origem dos lançamentos: carteira (baixa de parcela) e extrato (criado na conciliação)
do $$
declare v_nome text;
begin
  for v_nome in select conname from pg_constraint
                 where conrelid = 'a1_fin_lancamentos'::regclass and contype = 'c'
                   and pg_get_constraintdef(oid) like '%''locacao''%' and pg_get_constraintdef(oid) like '%origem%'
                   and conname <> 'a1_fin_lancamentos_origem_ck' loop
    execute format('alter table a1_fin_lancamentos drop constraint %I', v_nome);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'a1_fin_lancamentos_origem_ck') then
    alter table a1_fin_lancamentos add constraint a1_fin_lancamentos_origem_ck
      check (origem in ('manual', 'comissao', 'locacao', 'carteira', 'extrato'));
  end if;
end $$;
create unique index if not exists a1_fin_lancamentos_carteira_uq on a1_fin_lancamentos (origem_id) where origem = 'carteira';

-- ── 3. Centros de custo e grupo do DRE ──────────────────────────────────────
create table if not exists a1_fin_centros (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 2 and 80),
  tipo text not null default 'empreendimento' check (tipo in ('empreendimento', 'filial', 'projeto', 'outro')),
  empreendimento_id uuid,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists a1_fin_centros_emp_uq on a1_fin_centros (tenant_id, empreendimento_id) where empreendimento_id is not null;
alter table a1_fin_lancamentos add column if not exists centro_id uuid references a1_fin_centros(id) on delete set null;
alter table a1_fin_categorias add column if not exists grupo_dre text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'a1_fin_categorias_grupo_ck') then
    alter table a1_fin_categorias add constraint a1_fin_categorias_grupo_ck check (grupo_dre is null or grupo_dre in
      ('receita', 'deducao', 'custo', 'despesa', 'financeira_receita', 'financeira_despesa', 'nao_operacional'));
  end if;
end $$;

create table if not exists a1_fin_orcamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  categoria_id uuid not null references a1_fin_categorias(id) on delete cascade,
  centro_id uuid references a1_fin_centros(id) on delete cascade,
  mes date not null check (extract(day from mes) = 1),
  valor numeric(14,2) not null check (valor >= 0),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists a1_fin_orcamentos_uq
  on a1_fin_orcamentos (tenant_id, categoria_id, coalesce(centro_id, '00000000-0000-0000-0000-000000000000'::uuid), mes);

-- ── 4. Carteira ─────────────────────────────────────────────────────────────
-- Padrões por empreendimento (a carteira copia na criação; dá para mudar nela).
create table if not exists a1_fin_carteira_cfg (
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  empreendimento_id uuid not null,
  data_chaves date,
  indice_obra text not null default 'INCC' check (indice_obra in ('INCC', 'INCCM', 'IGPM', 'IPCA', 'INPC', 'NENHUM')),
  indice_pos text not null default 'IGPM' check (indice_pos in ('INCC', 'INCCM', 'IGPM', 'IPCA', 'INPC', 'NENHUM')),
  juros_pos_am numeric(6,3) not null default 0 check (juros_pos_am between 0 and 5),
  defasagem_meses int not null default 1 check (defasagem_meses between 0 and 3),
  negativo_zera boolean not null default true,
  multa_pct numeric(5,2) not null default 2 check (multa_pct between 0 and 10),
  juros_mora_am numeric(5,2) not null default 1 check (juros_mora_am between 0 and 10),
  atualizado_em timestamptz not null default now(),
  primary key (tenant_id, empreendimento_id)
);

create table if not exists a1_fin_carteiras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  seq int,
  comercial_id uuid,
  negocio_id uuid references a1_fin_negocios(id) on delete set null,
  cliente_nome text not null check (length(btrim(cliente_nome)) between 1 and 160),
  cliente_doc text check (cliente_doc is null or length(cliente_doc) <= 20),
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  empreendimento_id uuid,
  empreendimento text check (empreendimento is null or length(empreendimento) <= 160),
  unidade text check (unidade is null or length(unidade) <= 60),
  valor_total numeric(14,2) not null default 0,
  data_base date not null default current_date,
  data_chaves date,
  indice_obra text not null default 'INCC' check (indice_obra in ('INCC', 'INCCM', 'IGPM', 'IPCA', 'INPC', 'NENHUM')),
  indice_pos text not null default 'IGPM' check (indice_pos in ('INCC', 'INCCM', 'IGPM', 'IPCA', 'INPC', 'NENHUM')),
  juros_pos_am numeric(6,3) not null default 0 check (juros_pos_am between 0 and 5),
  defasagem_meses int not null default 1 check (defasagem_meses between 0 and 3),
  negativo_zera boolean not null default true,
  multa_pct numeric(5,2) not null default 2 check (multa_pct between 0 and 10),
  juros_mora_am numeric(5,2) not null default 1 check (juros_mora_am between 0 and 10),
  lembretes boolean not null default true,
  status text not null default 'ativa' check (status in ('ativa', 'quitada', 'distratada')),
  observacao text check (observacao is null or length(observacao) <= 1000),
  versao int not null default 1,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists a1_fin_carteiras_comercial_uq on a1_fin_carteiras (tenant_id, comercial_id) where comercial_id is not null;
create unique index if not exists a1_fin_carteiras_seq_uq on a1_fin_carteiras (tenant_id, seq);

create table if not exists a1_fin_parcelas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  carteira_id uuid not null references a1_fin_carteiras(id) on delete cascade,
  numero int not null,
  serie text not null check (length(serie) between 1 and 30),
  nome text check (nome is null or length(nome) <= 80),
  quem_paga text not null default 'CLIENTE' check (quem_paga in ('CLIENTE', 'BANCO', 'GOVERNO')),
  vencimento date not null,
  valor numeric(14,2) not null check (valor > 0),
  -- mês-base da correção (null = o da carteira); a renegociada nasce no mês da renegociação
  base_mes date,
  status text not null default 'aberta' check (status in ('aberta', 'paga', 'renegociada', 'cancelada')),
  motivo text check (motivo is null or length(motivo) <= 300),
  pago_em date,
  valor_pago numeric(14,2),
  correcao_paga numeric(14,2),
  multa_paga numeric(14,2),
  juros_pago numeric(14,2),
  desconto numeric(14,2),
  lancamento_id uuid references a1_fin_lancamentos(id) on delete set null,
  versao int not null default 1,
  criado_em timestamptz not null default now(),
  constraint a1_fin_parcela_paga_coerente check ((status = 'paga') = (pago_em is not null and valor_pago is not null))
);
create index if not exists a1_fin_parcelas_idx on a1_fin_parcelas (carteira_id, vencimento);
create index if not exists a1_fin_parcelas_venc_idx on a1_fin_parcelas (tenant_id, status, vencimento);

create table if not exists a1_fin_lembretes (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  parcela_id uuid not null references a1_fin_parcelas(id) on delete cascade,
  gatilho text not null check (gatilho ~ '^D[+-]?[0-9]{1,2}$'),
  canal text check (canal is null or canal in ('oficial', 'evolution')),
  ok boolean not null,
  detalhe text check (detalhe is null or length(detalhe) <= 300),
  criado_em timestamptz not null default now(),
  unique (parcela_id, gatilho)
);

-- ── 5. Conciliação (OFX) ────────────────────────────────────────────────────
create table if not exists a1_fin_extratos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  conta_id uuid not null references a1_fin_contas(id) on delete cascade,
  arquivo text check (arquivo is null or length(arquivo) <= 160),
  inicio date,
  fim date,
  itens int not null default 0,
  novos int not null default 0,
  importado_por uuid,
  criado_em timestamptz not null default now()
);
create table if not exists a1_fin_extrato_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  extrato_id uuid not null references a1_fin_extratos(id) on delete cascade,
  conta_id uuid not null references a1_fin_contas(id) on delete cascade,
  fitid text not null check (length(fitid) between 1 and 120),
  data date not null,
  valor numeric(14,2) not null check (valor <> 0),
  descricao text check (descricao is null or length(descricao) <= 255),
  status text not null default 'pendente' check (status in ('pendente', 'conciliado', 'ignorado')),
  lancamento_id uuid references a1_fin_lancamentos(id) on delete set null,
  parcela_id uuid references a1_fin_parcelas(id) on delete set null,
  conciliado_em timestamptz,
  unique (conta_id, fitid)
);
create index if not exists a1_fin_extrato_itens_idx on a1_fin_extrato_itens (tenant_id, conta_id, status, data);
create unique index if not exists a1_fin_extrato_itens_lanc_uq on a1_fin_extrato_itens (lancamento_id) where lancamento_id is not null;

-- ── 6. RLS ──────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['a1_fin_centros', 'a1_fin_orcamentos', 'a1_fin_carteira_cfg', 'a1_fin_carteiras',
                           'a1_fin_parcelas', 'a1_fin_lembretes', 'a1_fin_extratos', 'a1_fin_extrato_itens'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
    execute format('drop policy if exists %I on %I', t || '_ler', t);
    execute format('create policy %I on %I for select using (tenant_id = (select a1_tenant()) and (select a1_fin_pode()))', t || '_ler', t);
  end loop;
  -- cadastros: grava direto; carteira, parcelas, lembretes e extratos só por função
  foreach t in array array['a1_fin_centros', 'a1_fin_orcamentos', 'a1_fin_carteira_cfg'] loop
    execute format('grant insert, update, delete on %I to anon, authenticated', t);
    execute format('drop policy if exists %I on %I', t || '_gravar', t);
    execute format('create policy %I on %I for all using (tenant_id = (select a1_tenant()) and (select a1_fin_pode())) with check (tenant_id = (select a1_tenant()) and (select a1_fin_pode()))', t || '_gravar', t);
  end loop;
end $$;

-- Referências do mesmo cliente nas tabelas novas (e no centro do lançamento).
create or replace function a1_fin2_mesmo_cliente()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if tg_table_name = 'a1_fin_lancamentos' then
    if new.centro_id is not null and (tg_op = 'INSERT' or new.centro_id is distinct from old.centro_id)
       and not exists (select 1 from a1_fin_centros where id = new.centro_id and tenant_id = new.tenant_id) then
      raise exception 'referencia_de_outro_cliente';
    end if;
  elsif tg_table_name = 'a1_fin_orcamentos' then
    if not exists (select 1 from a1_fin_categorias where id = new.categoria_id and tenant_id = new.tenant_id)
       or (new.centro_id is not null and not exists (select 1 from a1_fin_centros where id = new.centro_id and tenant_id = new.tenant_id)) then
      raise exception 'referencia_de_outro_cliente';
    end if;
  elsif tg_table_name = 'a1_fin_centros' or tg_table_name = 'a1_fin_carteira_cfg' then
    if new.empreendimento_id is not null and (tg_op = 'INSERT' or new.empreendimento_id is distinct from old.empreendimento_id)
       and not exists (select 1 from a1_developments where id = new.empreendimento_id and tenant_id = new.tenant_id) then
      raise exception 'referencia_de_outro_cliente';
    end if;
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['a1_fin_orcamentos', 'a1_fin_centros', 'a1_fin_carteira_cfg'] loop
    execute format('drop trigger if exists %I on %I', t || '_mesmo_cliente2', t);
    execute format('create trigger %I before insert or update on %I for each row execute function a1_fin2_mesmo_cliente()', t || '_mesmo_cliente2', t);
  end loop;
  drop trigger if exists a1_fin_lancamentos_centro on a1_fin_lancamentos;
  create trigger a1_fin_lancamentos_centro before insert or update of centro_id on a1_fin_lancamentos
    for each row execute function a1_fin2_mesmo_cliente();
end $$;

-- ID da carteira (CR-0001), sequencial por cliente.
create or replace function a1_fin_cart_numerar()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    new.seq := old.seq;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fin-cart:' || new.tenant_id::text, 0));
  select coalesce(max(seq), 0) + 1 into new.seq from a1_fin_carteiras where tenant_id = new.tenant_id;
  return new;
end $$;
drop trigger if exists a1_fin_carteiras_numerar on a1_fin_carteiras;
create trigger a1_fin_carteiras_numerar before insert or update on a1_fin_carteiras
  for each row execute function a1_fin_cart_numerar();

-- ── 7. Valor da parcela numa data ───────────────────────────────────────────
-- Correção: do mês-base até (mês da data − defasagem). Até o mês das chaves
-- vale o índice de obra; depois, o pós-chaves + juros ao mês. Banco, FGTS e
-- subsídio não corrigem nem têm mora. Atraso: multa sobre o corrigido + juros
-- de mora pro rata die.
create or replace function a1_fin_parcela_calc(p_parcela uuid, p_data date default current_date)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare
  p a1_fin_parcelas; c a1_fin_carteiras;
  v_base date; v_ref date; v_ch date; v_fator numeric := 1; v_meses int := 0;
  v_corr numeric; v_dias int := 0; v_multa numeric := 0; v_juros numeric := 0;
begin
  select * into p from a1_fin_parcelas where id = p_parcela;
  if p.id is null then return null; end if;
  select * into c from a1_fin_carteiras where id = p.carteira_id;
  if p.status = 'paga' then
    return jsonb_build_object('original', p.valor, 'fator', 1, 'correcao', coalesce(p.correcao_paga, 0),
      'corrigido', p.valor + coalesce(p.correcao_paga, 0), 'dias_atraso', 0, 'multa', coalesce(p.multa_paga, 0),
      'juros', coalesce(p.juros_pago, 0), 'desconto', coalesce(p.desconto, 0), 'total', p.valor_pago);
  end if;
  if p.quem_paga = 'CLIENTE' then
    v_base := date_trunc('month', coalesce(p.base_mes, c.data_base))::date;
    v_ref := (date_trunc('month', p_data) - make_interval(months => c.defasagem_meses))::date;
    v_ch := date_trunc('month', c.data_chaves)::date;
    if v_ref > v_base then
      if v_ch is null or v_ref <= v_ch then
        v_fator := a1_fin_fator(c.indice_obra, v_base, v_ref, c.negativo_zera);
      else
        if v_ch > v_base then v_fator := a1_fin_fator(c.indice_obra, v_base, v_ch, c.negativo_zera); end if;
        v_fator := v_fator * a1_fin_fator(c.indice_pos, greatest(v_base, v_ch), v_ref, c.negativo_zera);
        v_meses := (extract(year from age(v_ref, greatest(v_base, v_ch))) * 12
                    + extract(month from age(v_ref, greatest(v_base, v_ch))))::int;
        if c.juros_pos_am > 0 and v_meses > 0 then v_fator := v_fator * power(1 + c.juros_pos_am / 100, v_meses); end if;
      end if;
    end if;
  end if;
  v_corr := round(p.valor * v_fator, 2);
  if p.quem_paga = 'CLIENTE' and p_data > p.vencimento then
    v_dias := p_data - p.vencimento;
    v_multa := round(v_corr * c.multa_pct / 100, 2);
    v_juros := round(v_corr * c.juros_mora_am / 100 / 30 * v_dias, 2);
  end if;
  return jsonb_build_object('original', p.valor, 'fator', round(v_fator, 6), 'correcao', v_corr - p.valor,
    'corrigido', v_corr, 'dias_atraso', v_dias, 'multa', v_multa, 'juros', v_juros, 'desconto', 0,
    'total', v_corr + v_multa + v_juros);
end $$;
revoke all on function a1_fin_parcela_calc(uuid, date) from public, anon, authenticated;

-- A tela: parcelas da carteira com o valor de hoje (ou de outra data).
create or replace function a1_fin_carteira_parcelas(p_carteira uuid, p_data date default current_date)
returns table (id uuid, numero int, serie text, nome text, quem_paga text, vencimento date, valor numeric,
               status text, motivo text, pago_em date, valor_pago numeric, versao int, calc jsonb)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  return query
    select p.id, p.numero, p.serie, p.nome, p.quem_paga, p.vencimento, p.valor, p.status, p.motivo, p.pago_em,
           p.valor_pago, p.versao, case when p.status in ('aberta', 'paga') then a1_fin_parcela_calc(p.id, coalesce(p_data, current_date)) end
      from a1_fin_parcelas p
      join a1_fin_carteiras c on c.id = p.carteira_id and c.tenant_id = a1_tenant()
     where p.carteira_id = p_carteira
     order by p.vencimento, p.numero;
end $$;
revoke all on function a1_fin_carteira_parcelas(uuid, date) from public;
grant execute on function a1_fin_carteira_parcelas(uuid, date) to anon, authenticated;

-- A lista: totais de cada carteira com a correção de hoje. Todas as parcelas
-- abertas do mesmo mês-base têm o mesmo fator hoje: um cálculo por base.
create or replace function a1_fin_carteiras_resumo(p_data date default current_date)
returns table (carteira_id uuid, valor_original numeric, recebido numeric, a_receber numeric, vencido numeric,
               parcelas_vencidas int, parcelas_abertas int, proximo_vencimento date, maior_atraso int)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v_data date := coalesce(p_data, current_date);
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  return query
  with abertas as (
    select p.id as pid, p.vencimento, p.valor, p.quem_paga,
           date_trunc('month', coalesce(p.base_mes, c.data_base))::date as bm, c.id as cid
      from a1_fin_parcelas p join a1_fin_carteiras c on c.id = p.carteira_id
     where c.tenant_id = a1_tenant() and p.status = 'aberta'
  ), fatores as (
    select a.cid, a.bm,
           (a1_fin_parcela_calc((array_agg(a.pid order by a.vencimento))[1], v_data)->>'fator')::numeric as fator
      from abertas a where a.quem_paga = 'CLIENTE' group by a.cid, a.bm
  )
  select c.id,
         coalesce((select sum(p.valor) from a1_fin_parcelas p where p.carteira_id = c.id and p.status in ('aberta', 'paga')), 0),
         coalesce((select sum(p.valor_pago) from a1_fin_parcelas p where p.carteira_id = c.id and p.status = 'paga'), 0),
         coalesce((select sum(round(a.valor * coalesce(f.fator, 1), 2)) from abertas a
                     left join fatores f on f.cid = a.cid and f.bm = a.bm and a.quem_paga = 'CLIENTE'
                    where a.cid = c.id), 0),
         coalesce((select sum(round(a.valor * coalesce(f.fator, 1), 2)) from abertas a
                     left join fatores f on f.cid = a.cid and f.bm = a.bm
                    where a.cid = c.id and a.vencimento < v_data and a.quem_paga = 'CLIENTE'), 0),
         (select count(*)::int from abertas a where a.cid = c.id and a.vencimento < v_data and a.quem_paga = 'CLIENTE'),
         (select count(*)::int from abertas a where a.cid = c.id),
         (select min(a.vencimento) from abertas a where a.cid = c.id and a.vencimento >= v_data),
         coalesce((select max(v_data - a.vencimento) from abertas a where a.cid = c.id and a.vencimento < v_data and a.quem_paga = 'CLIENTE'), 0)
    from a1_fin_carteiras c
   where c.tenant_id = a1_tenant();
end $$;
revoke all on function a1_fin_carteiras_resumo(date) from public;
grant execute on function a1_fin_carteiras_resumo(date) to anon, authenticated;

-- ── 8. Carteira a partir da venda ───────────────────────────────────────────
create or replace function a1_fin_periodo(p_tenant uuid, p_tipo text, p_nome text)
returns int language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case upper(coalesce(p_tipo, ''))
    when 'MENSAL' then 1 when 'BIMESTRAL' then 2 when 'TRIMESTRAL' then 3
    when 'SEMESTRAL' then 6 when 'ANUAL' then 12 when 'INTERMEDIARIA' then 6
    when 'ATO' then 0 when 'SINAL' then 0 when 'CHAVES' then 0 when 'A_VISTA' then 0
    else coalesce((select pp.periodicidade_meses from a1_parametros_pagamento pp
                    where pp.tenant_id = p_tenant and (pp.nome = p_nome or pp.serie = upper(p_tipo))
                    order by (pp.nome = p_nome) desc limit 1), 1) end;
$$;
revoke all on function a1_fin_periodo(uuid, text, text) from public, anon, authenticated;

create or replace function a1_fin_carteira_de_venda(p_comercial uuid)
returns uuid language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  co record; cfg a1_fin_carteira_cfg; v_id uuid; v_emp text; v_cli text; v_doc text; v_tel text;
  v_cond jsonb; e jsonb; v_q int; v_per int; v_v numeric; v_venc date; i int; v_ord int := 0;
  v_tem_credito boolean := false; v_chaves date; v_rows jsonb := '[]'::jsonb;
begin
  select * into co from a1_comerciais where id = p_comercial;
  if co.id is null then return null; end if;
  select id into v_id from a1_fin_carteiras where tenant_id = co.tenant_id and comercial_id = co.id;
  if v_id is not null then
    -- volta a VENDIDO depois de um distrato: reabre o que o distrato cancelou
    update a1_fin_carteiras set status = 'ativa', versao = versao + 1, atualizado_em = now()
     where id = v_id and status = 'distratada';
    update a1_fin_parcelas set status = 'aberta', motivo = null, versao = versao + 1
     where carteira_id = v_id and status = 'cancelada' and motivo = 'distrato';
    return v_id;
  end if;
  begin
    execute 'select name from a1_developments where id = $1' into v_emp using co.empreendimento_id;
  exception when others then v_emp := null;
  end;
  select * into cfg from a1_fin_carteira_cfg where tenant_id = co.tenant_id and empreendimento_id = co.empreendimento_id;
  v_chaves := cfg.data_chaves;
  v_cli := coalesce(nullif(btrim(co.origem_snapshot->'participantes'->0->>'nome'), ''),
                    nullif(btrim(co.origem_snapshot->>'cliente_nome'), ''),
                    nullif(btrim(co.origem_snapshot->'titular'->>'nome'), ''), co.codigo, 'Cliente');
  v_doc := left(regexp_replace(coalesce(co.origem_snapshot->'participantes'->0->>'documento', ''), '\D', '', 'g'), 20);
  if co.reserva_id is not null then
    select regexp_replace(coalesce(r.cliente->'titular'->>'telefone', ''), '\D', '', 'g') into v_tel
      from a1_reservas r where r.id = co.reserva_id;
  end if;
  if v_tel is not null and length(v_tel) in (10, 11) then v_tel := '55' || v_tel; end if;
  if v_tel !~ '^[0-9]{10,13}$' then v_tel := null; end if;

  insert into a1_fin_carteiras (tenant_id, comercial_id, negocio_id, cliente_nome, cliente_doc, telefone,
    empreendimento_id, empreendimento, unidade, data_base, data_chaves, indice_obra, indice_pos, juros_pos_am,
    defasagem_meses, negativo_zera, multa_pct, juros_mora_am)
  values (co.tenant_id, co.id,
    (select n.id from a1_fin_negocios n where n.tenant_id = co.tenant_id and n.origem = 'comercial' and n.origem_id = co.id),
    left(v_cli, 160), nullif(v_doc, ''), v_tel, co.empreendimento_id, left(v_emp, 160), left(co.unidade, 60),
    current_date, v_chaves, coalesce(cfg.indice_obra, 'INCC'), coalesce(cfg.indice_pos, 'IGPM'),
    coalesce(cfg.juros_pos_am, 0), coalesce(cfg.defasagem_meses, 1), coalesce(cfg.negativo_zera, true),
    coalesce(cfg.multa_pct, 2), coalesce(cfg.juros_mora_am, 1))
  returning id into v_id;

  -- recurso próprio: as condições de pagamento da proposta (valor em centavos)
  v_cond := case when jsonb_typeof(co.proposta->'condicoes_pagamento') = 'array' then co.proposta->'condicoes_pagamento' end;
  if v_cond is null and coalesce(a1_fin_num(co.proposta->>'valor_entrada'), 0) > 0 then
    v_cond := jsonb_build_array(jsonb_build_object('tipo', 'ATO', 'quantidade', 1, 'valor', co.proposta->>'valor_entrada'));
  end if;
  for e in select * from jsonb_array_elements(coalesce(v_cond, '[]'::jsonb)) loop
    v_q := greatest(1, least(600, coalesce(a1_fin_num(e->>'quantidade'), 1)::int));
    v_v := round(coalesce(a1_fin_num(e->>'valor'), 0) / 100, 2);
    continue when v_v <= 0;
    v_per := a1_fin_periodo(co.tenant_id, e->>'tipo', e->>'nome');
    if v_per = 0 and v_q > 1 then v_per := 1; end if;
    v_venc := coalesce(nullif(e->>'vencimento_inicial', '')::date, current_date);
    for i in 0 .. v_q - 1 loop
      v_ord := v_ord + 1;
      v_rows := v_rows || jsonb_build_object('ord', v_ord, 'serie', upper(coalesce(nullif(e->>'tipo', ''), 'OUTRO')),
        'nome', left(coalesce(nullif(e->>'nome', ''), initcap(replace(lower(coalesce(e->>'tipo', 'parcela')), '_', ' '))), 80),
        'quem_paga', 'CLIENTE', 'vencimento', (v_venc + make_interval(months => v_per * i))::date, 'valor', v_v);
    end loop;
  end loop;
  -- banco, FGTS e subsídio: do fluxo da reserva
  if jsonb_typeof(co.origem_snapshot->'fluxo') = 'array' then
    for e in select * from jsonb_array_elements(co.origem_snapshot->'fluxo') loop
      continue when coalesce(e->>'quem_paga', 'CLIENTE') = 'CLIENTE';
      v_v := round(coalesce(a1_fin_num(e->>'valor'), 0) * greatest(1, coalesce(a1_fin_num(e->>'quantidade'), 1)), 2);
      continue when v_v <= 0;
      v_tem_credito := true;
      v_ord := v_ord + 1;
      v_rows := v_rows || jsonb_build_object('ord', v_ord, 'serie', upper(coalesce(e->>'serie', 'FINANCIAMENTO')),
        'nome', left(coalesce(e->>'nome', 'Financiamento'), 80),
        'quem_paga', case when e->>'quem_paga' = 'GOVERNO' then 'GOVERNO' else 'BANCO' end,
        'vencimento', coalesce(nullif(e->>'primeiro_vencimento', '')::date, v_chaves, current_date), 'valor', v_v);
    end loop;
  end if;
  -- sem fluxo: o crédito aprovado da venda (centavos)
  if not v_tem_credito then
    for e in select jsonb_build_object('serie', s.serie, 'nome', s.nome, 'quem', s.quem, 'valor', s.valor) from (values
        ('FINANCIAMENTO', 'Financiamento', 'BANCO', co.origem_snapshot->'credito'->>'valor_aprovado'),
        ('FGTS', 'FGTS', 'BANCO', co.origem_snapshot->'credito'->>'valor_fgts'),
        ('SUBSIDIO', 'Subsídio', 'GOVERNO', co.origem_snapshot->'credito'->>'valor_subsidio')) s(serie, nome, quem, valor) loop
      v_v := round(coalesce(a1_fin_num(e->>'valor'), 0) / 100, 2);
      continue when v_v <= 0;
      v_ord := v_ord + 1;
      v_rows := v_rows || jsonb_build_object('ord', v_ord, 'serie', e->>'serie', 'nome', e->>'nome', 'quem_paga', e->>'quem',
        'vencimento', coalesce(v_chaves, current_date), 'valor', v_v);
    end loop;
  end if;
  insert into a1_fin_parcelas (tenant_id, carteira_id, numero, serie, nome, quem_paga, vencimento, valor)
  select co.tenant_id, v_id, row_number() over (order by t.vencimento, t.ord), t.serie, t.nome, t.quem_paga, t.vencimento, t.valor
    from jsonb_to_recordset(v_rows) as t(ord int, serie text, nome text, quem_paga text, vencimento date, valor numeric);
  update a1_fin_carteiras set valor_total = coalesce((select sum(valor) from a1_fin_parcelas where carteira_id = v_id), 0)
   where id = v_id;
  return v_id;
end $$;
revoke all on function a1_fin_carteira_de_venda(uuid) from public, anon, authenticated;

-- Distrato: a venda saiu de VENDIDO. O que não foi pago é cancelado.
create or replace function a1_fin_carteira_distrato(p_carteira uuid, p_motivo text)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  update a1_fin_parcelas set status = 'cancelada', motivo = left(coalesce(p_motivo, 'distrato'), 300), versao = versao + 1
   where carteira_id = p_carteira and status = 'aberta';
  update a1_fin_carteiras set status = 'distratada', versao = versao + 1, atualizado_em = now() where id = p_carteira;
end $$;
revoke all on function a1_fin_carteira_distrato(uuid, text) from public, anon, authenticated;

-- A tela: distrato da carteira lançada à mão (a da venda segue o distrato na Venda).
create or replace function a1_fin_carteira_encerrar(p_carteira uuid, p_motivo text, p_versao int)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare c a1_fin_carteiras;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'motivo_obrigatorio'; end if;
  select * into c from a1_fin_carteiras where id = p_carteira and tenant_id = a1_tenant() for update;
  if c.id is null then raise exception 'carteira_nao_encontrada'; end if;
  if c.versao <> p_versao then raise exception 'versao_desatualizada'; end if;
  if c.comercial_id is not null then raise exception 'carteira_da_venda'; end if;
  if c.status <> 'ativa' then raise exception 'carteira_nao_ativa'; end if;
  perform a1_fin_carteira_distrato(c.id, btrim(p_motivo));
  return json_build_object('ok', true);
end $$;
revoke all on function a1_fin_carteira_encerrar(uuid, text, int) from public;
grant execute on function a1_fin_carteira_encerrar(uuid, text, int) to anon, authenticated;

-- Gatilho na Venda: só com a licença e a carteira ligada. Nunca trava a venda.
create or replace function a1_fin_carteira_de_comercial()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_novo text; v_velho text; v_cart uuid;
begin
  if tg_op = 'UPDATE' and new.situacao_id is not distinct from old.situacao_id then return null; end if;
  if not a1_fin_licenca(new.tenant_id)
     or not coalesce((select carteira_ativa from a1_fin_config where tenant_id = new.tenant_id), false) then
    return null;
  end if;
  begin
    select selo into v_novo from a1_co_situacoes where id = new.situacao_id;
    if tg_op = 'UPDATE' then select selo into v_velho from a1_co_situacoes where id = old.situacao_id; end if;
    if v_novo = 'VENDIDO' and coalesce(v_velho, '') <> 'VENDIDO' then
      perform a1_fin_carteira_de_venda(new.id);
    elsif v_velho = 'VENDIDO' and coalesce(v_novo, '') <> 'VENDIDO' then
      select id into v_cart from a1_fin_carteiras where tenant_id = new.tenant_id and comercial_id = new.id and status = 'ativa';
      if v_cart is not null then perform a1_fin_carteira_distrato(v_cart, 'distrato'); end if;
    end if;
  exception when others then
    raise warning 'financeiro: não montou a carteira da venda %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
-- o nome começa depois de a1_fin_de_comercial_t: roda depois, com o negócio já criado
drop trigger if exists a1_fin_zz_carteira_t on a1_comerciais;
create trigger a1_fin_zz_carteira_t after insert or update of situacao_id on a1_comerciais
  for each row execute function a1_fin_carteira_de_comercial();

-- Vendas que já estavam em VENDIDO quando a carteira foi ligada.
create or replace function a1_fin_carteira_importar()
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare r record; n int := 0;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  if not coalesce((select carteira_ativa from a1_fin_config where tenant_id = a1_tenant()), false) then
    raise exception 'carteira_desligada';
  end if;
  for r in select co.id from a1_comerciais co join a1_co_situacoes s on s.id = co.situacao_id
            where co.tenant_id = a1_tenant() and s.selo = 'VENDIDO'
              and not exists (select 1 from a1_fin_carteiras c where c.tenant_id = co.tenant_id and c.comercial_id = co.id) loop
    perform a1_fin_carteira_de_venda(r.id);
    n := n + 1;
  end loop;
  return json_build_object('ok', true, 'carteiras', n);
end $$;
revoke all on function a1_fin_carteira_importar() from public;
grant execute on function a1_fin_carteira_importar() to anon, authenticated;

-- Carteira à mão (venda fora do sistema) e edição dos dados da carteira.
create or replace function a1_fin_carteira_salvar(p_id uuid, p_dados jsonb, p_parcelas jsonb default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_t uuid := a1_tenant(); c a1_fin_carteiras; v_id uuid; e jsonb; v_tel text; v_ord int := 0;
  v_ind_o text := upper(coalesce(p_dados->>'indice_obra', 'INCC')); v_ind_p text := upper(coalesce(p_dados->>'indice_pos', 'IGPM'));
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  if v_ind_o not in ('INCC', 'INCCM', 'IGPM', 'IPCA', 'INPC', 'NENHUM') or v_ind_p not in ('INCC', 'INCCM', 'IGPM', 'IPCA', 'INPC', 'NENHUM') then
    raise exception 'indice_invalido';
  end if;
  v_tel := regexp_replace(coalesce(p_dados->>'telefone', ''), '\D', '', 'g');
  if length(v_tel) in (10, 11) then v_tel := '55' || v_tel; end if;
  if v_tel = '' then v_tel := null; elsif v_tel !~ '^[0-9]{12,13}$' then raise exception 'telefone_invalido'; end if;
  if nullif(btrim(coalesce(p_dados->>'cliente_nome', '')), '') is null then raise exception 'cliente_obrigatorio'; end if;
  if p_dados ? 'empreendimento_id' and nullif(p_dados->>'empreendimento_id', '') is not null
     and not exists (select 1 from a1_developments where id = (p_dados->>'empreendimento_id')::uuid and tenant_id = v_t) then
    raise exception 'referencia_de_outro_cliente';
  end if;
  if p_id is null then
    if jsonb_typeof(p_parcelas) <> 'array' or jsonb_array_length(p_parcelas) = 0 or jsonb_array_length(p_parcelas) > 600 then
      raise exception 'parcelas_obrigatorias';
    end if;
    insert into a1_fin_carteiras (tenant_id, cliente_nome, cliente_doc, telefone, empreendimento_id, empreendimento, unidade,
      data_base, data_chaves, indice_obra, indice_pos, juros_pos_am, defasagem_meses, negativo_zera, multa_pct, juros_mora_am,
      lembretes, observacao)
    values (v_t, left(btrim(p_dados->>'cliente_nome'), 160), nullif(left(regexp_replace(coalesce(p_dados->>'cliente_doc', ''), '\D', '', 'g'), 20), ''),
      v_tel, nullif(p_dados->>'empreendimento_id', '')::uuid, nullif(left(btrim(coalesce(p_dados->>'empreendimento', '')), 160), ''),
      nullif(left(btrim(coalesce(p_dados->>'unidade', '')), 60), ''),
      coalesce(nullif(p_dados->>'data_base', '')::date, current_date), nullif(p_dados->>'data_chaves', '')::date,
      v_ind_o, v_ind_p, coalesce(a1_fin_num(p_dados->>'juros_pos_am'), 0), coalesce((p_dados->>'defasagem_meses')::int, 1),
      coalesce((p_dados->>'negativo_zera')::boolean, true), coalesce(a1_fin_num(p_dados->>'multa_pct'), 2),
      coalesce(a1_fin_num(p_dados->>'juros_mora_am'), 1), coalesce((p_dados->>'lembretes')::boolean, true),
      nullif(left(coalesce(p_dados->>'observacao', ''), 1000), ''))
    returning id into v_id;
    for e in select * from jsonb_array_elements(p_parcelas) loop
      v_ord := v_ord + 1;
      if coalesce(a1_fin_num(e->>'valor'), 0) <= 0 or nullif(e->>'vencimento', '') is null then raise exception 'parcela_invalida'; end if;
      insert into a1_fin_parcelas (tenant_id, carteira_id, numero, serie, nome, quem_paga, vencimento, valor)
      values (v_t, v_id, v_ord, upper(left(coalesce(nullif(e->>'serie', ''), 'MENSAL'), 30)), left(coalesce(e->>'nome', ''), 80),
              case when e->>'quem_paga' in ('BANCO', 'GOVERNO') then e->>'quem_paga' else 'CLIENTE' end,
              (e->>'vencimento')::date, round(a1_fin_num(e->>'valor'), 2));
    end loop;
    update a1_fin_carteiras set valor_total = (select sum(valor) from a1_fin_parcelas where carteira_id = v_id) where id = v_id;
    return json_build_object('ok', true, 'id', v_id);
  end if;
  select * into c from a1_fin_carteiras where id = p_id and tenant_id = v_t for update;
  if c.id is null then raise exception 'carteira_nao_encontrada'; end if;
  if (p_dados->>'versao')::int is distinct from c.versao then raise exception 'versao_desatualizada'; end if;
  update a1_fin_carteiras set
    cliente_nome = left(btrim(p_dados->>'cliente_nome'), 160),
    cliente_doc = nullif(left(regexp_replace(coalesce(p_dados->>'cliente_doc', ''), '\D', '', 'g'), 20), ''),
    telefone = v_tel,
    data_chaves = nullif(p_dados->>'data_chaves', '')::date,
    indice_obra = v_ind_o, indice_pos = v_ind_p,
    juros_pos_am = coalesce(a1_fin_num(p_dados->>'juros_pos_am'), juros_pos_am),
    defasagem_meses = coalesce((p_dados->>'defasagem_meses')::int, defasagem_meses),
    negativo_zera = coalesce((p_dados->>'negativo_zera')::boolean, negativo_zera),
    multa_pct = coalesce(a1_fin_num(p_dados->>'multa_pct'), multa_pct),
    juros_mora_am = coalesce(a1_fin_num(p_dados->>'juros_mora_am'), juros_mora_am),
    lembretes = coalesce((p_dados->>'lembretes')::boolean, lembretes),
    observacao = nullif(left(coalesce(p_dados->>'observacao', ''), 1000), ''),
    versao = versao + 1, atualizado_em = now()
  where id = c.id;
  return json_build_object('ok', true, 'id', c.id);
end $$;
revoke all on function a1_fin_carteira_salvar(uuid, jsonb, jsonb) from public;
grant execute on function a1_fin_carteira_salvar(uuid, jsonb, jsonb) to anon, authenticated;

-- ── 9. Baixa, estorno e renegociação de parcela ─────────────────────────────
-- Interna (também usada pela conciliação). A parcela entra no caixa como
-- receita recebida (origem carteira), no centro de custo do empreendimento.
create or replace function a1_fin_parcela_baixar_int(p_parcela uuid, p_pago_em date, p_valor numeric, p_conta uuid,
  p_forma text, p_desconto numeric)
returns uuid language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare p a1_fin_parcelas; c a1_fin_carteiras; v_calc jsonb; v_total numeric; v_lanc uuid; v_desc numeric := coalesce(p_desconto, 0);
begin
  select * into p from a1_fin_parcelas where id = p_parcela for update;
  select * into c from a1_fin_carteiras where id = p.carteira_id;
  if p.status <> 'aberta' then raise exception 'parcela_nao_aberta'; end if;
  if p_pago_em is null or p_pago_em > current_date + 1 then raise exception 'data_invalida'; end if;
  if v_desc < 0 then raise exception 'valor_invalido'; end if;
  if p_forma is not null and p_forma not in ('pix', 'boleto', 'transferencia', 'dinheiro', 'cartao', 'cheque', 'outro') then
    raise exception 'forma_invalida';
  end if;
  if p_conta is not null and not exists (select 1 from a1_fin_contas where id = p_conta and tenant_id = p.tenant_id) then
    raise exception 'referencia_de_outro_cliente';
  end if;
  v_calc := a1_fin_parcela_calc(p.id, p_pago_em);
  v_total := (v_calc->>'total')::numeric - v_desc;
  if v_total <= 0 or p_valor is null or abs(p_valor - v_total) > 0.01 then
    raise exception 'valor_diferente: esperado %', to_char(v_total, 'FM999999999990.00');
  end if;
  perform a1_fin_preparar_tenant(p.tenant_id);
  insert into a1_fin_lancamentos (tenant_id, tipo, descricao, categoria_id, conta_id, valor, vencimento, competencia, status,
                                  pago_em, valor_pago, forma, pessoa, origem, origem_id, centro_id, parcela, observacao)
  values (p.tenant_id, 'receber',
          left(format('Parcela %s · %s · %s', p.numero, coalesce(nullif(p.nome, ''), p.serie), c.cliente_nome), 200),
          a1_fin_categoria(p.tenant_id, 'venda_unidade'),
          coalesce(p_conta, (select conta_padrao from a1_fin_config where tenant_id = p.tenant_id)),
          p_valor, p.vencimento, date_trunc('month', p_pago_em)::date, 'pago', p_pago_em, p_valor, p_forma,
          left(c.cliente_nome, 160), 'carteira', p.id,
          (select id from a1_fin_centros where tenant_id = p.tenant_id and empreendimento_id = c.empreendimento_id and ativo limit 1),
          p.numero, left(concat_ws(' · ', c.empreendimento, c.unidade), 1000))
  returning id into v_lanc;
  update a1_fin_parcelas set status = 'paga', pago_em = p_pago_em, valor_pago = p_valor,
         correcao_paga = (v_calc->>'correcao')::numeric, multa_paga = (v_calc->>'multa')::numeric,
         juros_pago = (v_calc->>'juros')::numeric, desconto = nullif(v_desc, 0), lancamento_id = v_lanc, versao = versao + 1
   where id = p.id;
  if not exists (select 1 from a1_fin_parcelas where carteira_id = c.id and status = 'aberta') then
    update a1_fin_carteiras set status = 'quitada', versao = versao + 1, atualizado_em = now() where id = c.id and status = 'ativa';
  end if;
  return v_lanc;
end $$;
revoke all on function a1_fin_parcela_baixar_int(uuid, date, numeric, uuid, text, numeric) from public, anon, authenticated;

create or replace function a1_fin_parcela_baixar(p_parcela uuid, p_pago_em date, p_valor numeric, p_conta uuid,
  p_forma text, p_desconto numeric, p_versao int)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare p a1_fin_parcelas; v_lanc uuid;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  select * into p from a1_fin_parcelas where id = p_parcela and tenant_id = a1_tenant() for update;
  if p.id is null then raise exception 'parcela_nao_encontrada'; end if;
  if p.versao <> p_versao then raise exception 'versao_desatualizada'; end if;
  v_lanc := a1_fin_parcela_baixar_int(p.id, p_pago_em, p_valor, p_conta, p_forma, p_desconto);
  return json_build_object('ok', true, 'lancamento_id', v_lanc);
end $$;
revoke all on function a1_fin_parcela_baixar(uuid, date, numeric, uuid, text, numeric, int) from public;
grant execute on function a1_fin_parcela_baixar(uuid, date, numeric, uuid, text, numeric, int) to anon, authenticated;

create or replace function a1_fin_parcela_estornar(p_parcela uuid, p_versao int)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare p a1_fin_parcelas;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  select * into p from a1_fin_parcelas where id = p_parcela and tenant_id = a1_tenant() for update;
  if p.id is null then raise exception 'parcela_nao_encontrada'; end if;
  if p.status <> 'paga' then raise exception 'parcela_nao_paga'; end if;
  if p.versao <> p_versao then raise exception 'versao_desatualizada'; end if;
  -- a linha do extrato que casava com esta baixa volta a pendente
  update a1_fin_extrato_itens set status = 'pendente', lancamento_id = null, parcela_id = null, conciliado_em = null
   where tenant_id = p.tenant_id and (parcela_id = p.id or (p.lancamento_id is not null and lancamento_id = p.lancamento_id));
  update a1_fin_parcelas set status = 'aberta', pago_em = null, valor_pago = null, correcao_paga = null, multa_paga = null,
         juros_pago = null, desconto = null, lancamento_id = null, versao = versao + 1
   where id = p.id;
  delete from a1_fin_lancamentos where origem = 'carteira' and origem_id = p.id;
  update a1_fin_carteiras set status = 'ativa', versao = versao + 1, atualizado_em = now() where id = p.carteira_id and status = 'quitada';
  return json_build_object('ok', true);
end $$;
revoke all on function a1_fin_parcela_estornar(uuid, int) from public;
grant execute on function a1_fin_parcela_estornar(uuid, int) to anon, authenticated;

-- Renegociação: parcelas abertas do cliente viram "renegociadas" e entram as
-- novas (valor de hoje, corrigido a partir deste mês).
create or replace function a1_fin_renegociar(p_carteira uuid, p_parcelas uuid[], p_novas jsonb, p_motivo text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare c a1_fin_carteiras; e jsonb; v_num int; v_q int; i int; v_venc date; v_v numeric; v_n int := 0;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'motivo_obrigatorio'; end if;
  select * into c from a1_fin_carteiras where id = p_carteira and tenant_id = a1_tenant() for update;
  if c.id is null then raise exception 'carteira_nao_encontrada'; end if;
  if c.status = 'distratada' then raise exception 'carteira_distratada'; end if;
  if coalesce(cardinality(p_parcelas), 0) = 0 or exists (
       select 1 from unnest(p_parcelas) x(id)
        where not exists (select 1 from a1_fin_parcelas p where p.id = x.id and p.carteira_id = c.id
                            and p.status = 'aberta' and p.quem_paga = 'CLIENTE')) then
    raise exception 'parcelas_invalidas';
  end if;
  if jsonb_typeof(p_novas) <> 'array' or jsonb_array_length(p_novas) = 0 then raise exception 'parcelas_obrigatorias'; end if;
  update a1_fin_parcelas set status = 'renegociada', motivo = left(btrim(p_motivo), 300), versao = versao + 1
   where id = any(p_parcelas);
  select coalesce(max(numero), 0) into v_num from a1_fin_parcelas where carteira_id = c.id;
  for e in select * from jsonb_array_elements(p_novas) loop
    v_q := greatest(1, least(240, coalesce(a1_fin_num(e->>'quantidade'), 1)::int));
    v_v := round(coalesce(a1_fin_num(e->>'valor'), 0), 2);
    v_venc := nullif(e->>'vencimento', '')::date;
    if v_v <= 0 or v_venc is null then raise exception 'parcela_invalida'; end if;
    for i in 0 .. v_q - 1 loop
      v_num := v_num + 1;
      v_n := v_n + 1;
      insert into a1_fin_parcelas (tenant_id, carteira_id, numero, serie, nome, quem_paga, vencimento, valor, base_mes, motivo)
      values (c.tenant_id, c.id, v_num, 'RENEGOCIACAO', 'Renegociação', 'CLIENTE', (v_venc + make_interval(months => i))::date,
              v_v, date_trunc('month', current_date)::date, left(btrim(p_motivo), 300));
    end loop;
  end loop;
  update a1_fin_carteiras set status = 'ativa', versao = versao + 1, atualizado_em = now() where id = c.id;
  return json_build_object('ok', true, 'novas', v_n);
end $$;
revoke all on function a1_fin_renegociar(uuid, uuid[], jsonb, text) from public;
grant execute on function a1_fin_renegociar(uuid, uuid[], jsonb, text) to anon, authenticated;

-- ── 10. Lembretes (só a chave de serviço: a função fin-lembretes) ───────────
create or replace function a1_fin_lembretes_devidos(p_limite int default 200)
returns table (tenant_id uuid, parcela_id uuid, gatilho text, telefone text, cliente_nome text, empreendimento text,
               unidade text, vencimento date, total numeric, modelo jsonb, carteira_seq int)
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select c.tenant_id, p.id,
         case when current_date - p.vencimento = 0 then 'D0'
              when current_date - p.vencimento > 0 then 'D+' || (current_date - p.vencimento)
              else 'D' || (current_date - p.vencimento) end,
         c.telefone, c.cliente_nome, c.empreendimento, c.unidade, p.vencimento,
         (a1_fin_parcela_calc(p.id, current_date)->>'total')::numeric, cfg.lembrete_modelo, c.seq
    from a1_fin_parcelas p
    join a1_fin_carteiras c on c.id = p.carteira_id
    join a1_fin_config cfg on cfg.tenant_id = c.tenant_id
   where p.status = 'aberta' and p.quem_paga = 'CLIENTE' and c.status = 'ativa' and c.lembretes
     and c.telefone is not null and cfg.lembrete_ativo and cfg.lembrete_modelo is not null
     and a1_fin_licenca(c.tenant_id)
     and (current_date - p.vencimento) = any(cfg.lembrete_dias)
     and not exists (select 1 from a1_fin_lembretes l where l.parcela_id = p.id
                       and l.gatilho = case when current_date - p.vencimento = 0 then 'D0'
                                            when current_date - p.vencimento > 0 then 'D+' || (current_date - p.vencimento)
                                            else 'D' || (current_date - p.vencimento) end)
   order by p.vencimento
   limit greatest(1, least(coalesce(p_limite, 200), 1000));
$$;
revoke all on function a1_fin_lembretes_devidos(int) from public, anon, authenticated;
grant execute on function a1_fin_lembretes_devidos(int) to service_role;

create or replace function a1_fin_lembrete_registrar(p_tenant uuid, p_parcela uuid, p_gatilho text, p_canal text, p_ok boolean, p_detalhe text)
returns void language sql security definer
set search_path = public, extensions, pg_temp as $$
  insert into a1_fin_lembretes (tenant_id, parcela_id, gatilho, canal, ok, detalhe)
  select p_tenant, p_parcela, p_gatilho, case when p_canal in ('oficial', 'evolution') then p_canal end, coalesce(p_ok, false),
         left(p_detalhe, 300)
   where exists (select 1 from a1_fin_parcelas where id = p_parcela and tenant_id = p_tenant)
  on conflict (parcela_id, gatilho) do nothing;
$$;
revoke all on function a1_fin_lembrete_registrar(uuid, uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function a1_fin_lembrete_registrar(uuid, uuid, text, text, boolean, text) to service_role;

-- Disparo diário: o agendador do banco cria um código de uso único e chama a
-- função fin-lembretes com ele; a função confere e queima o código aqui. Sem
-- segredo guardado em lugar nenhum.
create table if not exists a1_fin_lembrete_chamadas (
  codigo text primary key,
  criado_em timestamptz not null default now()
);
alter table a1_fin_lembrete_chamadas enable row level security;
revoke all on a1_fin_lembrete_chamadas from public, anon, authenticated;
grant select, insert, delete on a1_fin_lembrete_chamadas to service_role;

create or replace function a1_fin_lembrete_codigo_valido(p_codigo text)
returns boolean language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  delete from a1_fin_lembrete_chamadas where criado_em < now() - interval '1 day';
  delete from a1_fin_lembrete_chamadas where codigo = p_codigo and criado_em > now() - interval '10 minutes';
  return found;
end $$;
revoke all on function a1_fin_lembrete_codigo_valido(text) from public, anon, authenticated;
grant execute on function a1_fin_lembrete_codigo_valido(text) to service_role;

create or replace function a1_fin_lembretes_disparar()
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_codigo text := encode(gen_random_bytes(24), 'hex'); v_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return json_build_object('ok', false, 'erro', 'pg_net_ausente');
  end if;
  if not exists (select 1 from a1_fin_config where lembrete_ativo) then
    return json_build_object('ok', true, 'ignorado', 'ninguem_ligou');
  end if;
  if not exists (select 1 from a1_fin_lembretes_devidos(1)) then
    return json_build_object('ok', true, 'ignorado', 'nada_devido');
  end if;
  insert into a1_fin_lembrete_chamadas (codigo) values (v_codigo);
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)' into v_id
    using 'https://hmedoyrxcqgkkasivbsn.supabase.co/functions/v1/fin-lembretes',
          jsonb_build_object('Content-Type', 'application/json', 'x-fin-codigo', v_codigo), '{}'::jsonb;
  return json_build_object('ok', true, 'pedido', v_id);
end $$;
revoke all on function a1_fin_lembretes_disparar() from public, anon, authenticated;

-- Agenda (só onde há pg_cron): de hora em hora, das 9h13 às 17h13 de Brasília
-- (12h13 a 20h13 UTC). Cada rodada envia por até ~100 s; o que sobrar vai na
-- próxima. Sem nada devido, a rodada nem chama a função.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'a1-fin-lembretes';
    perform cron.schedule('a1-fin-lembretes', '13 12-20 * * *', 'select public.a1_fin_lembretes_disparar()');
  end if;
end $$;

-- ── 11. Conciliação ─────────────────────────────────────────────────────────
create or replace function a1_fin_extrato_importar(p_conta uuid, p_arquivo text, p_itens jsonb)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_t uuid := a1_tenant(); v_ext uuid; e jsonb; v_n int := 0; v_novos int := 0; v_fit text; v_d date; v_v numeric;
        v_ini date; v_fim date; v_id uuid;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  if not exists (select 1 from a1_fin_contas where id = p_conta and tenant_id = v_t) then raise exception 'referencia_de_outro_cliente'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'extrato_vazio'; end if;
  if jsonb_array_length(p_itens) > 5000 then raise exception 'extrato_grande'; end if;
  insert into a1_fin_extratos (tenant_id, conta_id, arquivo, importado_por)
  values (v_t, p_conta, left(p_arquivo, 160), a1_ator()) returning id into v_ext;
  for e in select * from jsonb_array_elements(p_itens) loop
    v_d := nullif(e->>'data', '')::date;
    v_v := round(a1_fin_num(e->>'valor'), 2);
    continue when v_d is null or v_v is null or v_v = 0;
    v_n := v_n + 1;
    v_fit := left(coalesce(nullif(btrim(e->>'fitid'), ''),
                  'h' || md5(concat_ws('|', v_d::text, v_v::text, coalesce(e->>'descricao', ''), v_n::text))), 120);
    insert into a1_fin_extrato_itens (tenant_id, extrato_id, conta_id, fitid, data, valor, descricao)
    values (v_t, v_ext, p_conta, v_fit, v_d, v_v, nullif(left(btrim(coalesce(e->>'descricao', '')), 255), ''))
    on conflict (conta_id, fitid) do nothing
    returning id into v_id;
    if v_id is not null then v_novos := v_novos + 1; v_id := null; end if;
    v_ini := least(coalesce(v_ini, v_d), v_d);
    v_fim := greatest(coalesce(v_fim, v_d), v_d);
  end loop;
  update a1_fin_extratos set itens = v_n, novos = v_novos, inicio = v_ini, fim = v_fim where id = v_ext;
  return json_build_object('ok', true, 'extrato_id', v_ext, 'itens', v_n, 'novos', v_novos, 'repetidos', v_n - v_novos);
end $$;
revoke all on function a1_fin_extrato_importar(uuid, text, jsonb) from public;
grant execute on function a1_fin_extrato_importar(uuid, text, jsonb) to anon, authenticated;

-- Candidatos para uma linha do extrato: lançamento do mesmo sentido e valor
-- (aberto, ou pago ainda sem extrato) até 7 dias de distância, e parcela
-- aberta da carteira cujo valor na data bate (só entradas).
create or replace function a1_fin_extrato_sugestoes(p_item uuid)
returns table (tipo text, id uuid, descricao text, data date, valor numeric, status text, dias int, versao int)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare it a1_fin_extrato_itens;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  select * into it from a1_fin_extrato_itens where id = p_item and tenant_id = a1_tenant();
  if it.id is null then return; end if;
  return query
  select * from (
    select 'lancamento'::text, l.id, l.descricao, coalesce(l.pago_em, l.vencimento), coalesce(l.valor_pago, l.valor), l.status,
           abs(coalesce(l.pago_em, l.vencimento) - it.data)::int, l.versao
      from a1_fin_lancamentos l
     where l.tenant_id = it.tenant_id
       and l.tipo = case when it.valor > 0 then 'receber' else 'pagar' end
       and abs(coalesce(l.valor_pago, l.valor) - abs(it.valor)) < 0.01
       and abs(coalesce(l.pago_em, l.vencimento) - it.data) <= 7
       and (l.status = 'aberto' or (l.status = 'pago' and (l.conta_id is null or l.conta_id = it.conta_id)
                                    and not exists (select 1 from a1_fin_extrato_itens x where x.lancamento_id = l.id)))
    union all
    select 'parcela'::text, p.id, format('Parcela %s · %s · %s', p.numero, coalesce(nullif(p.nome, ''), p.serie), c.cliente_nome),
           p.vencimento, (a1_fin_parcela_calc(p.id, it.data)->>'total')::numeric, p.status, abs(p.vencimento - it.data)::int, p.versao
      from a1_fin_parcelas p join a1_fin_carteiras c on c.id = p.carteira_id
     where it.valor > 0 and c.tenant_id = it.tenant_id and p.status = 'aberta'
       and abs(p.vencimento - it.data) <= 40
       and abs((a1_fin_parcela_calc(p.id, it.data)->>'total')::numeric - it.valor) < 0.01
  ) s order by 7, 1 limit 10;
end $$;
revoke all on function a1_fin_extrato_sugestoes(uuid) from public;
grant execute on function a1_fin_extrato_sugestoes(uuid) to anon, authenticated;

create or replace function a1_fin_extrato_conciliar(p_item uuid, p_lancamento uuid, p_parcela uuid)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare it a1_fin_extrato_itens; l a1_fin_lancamentos; v_lanc uuid; v_resto uuid;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  select * into it from a1_fin_extrato_itens where id = p_item and tenant_id = a1_tenant() for update;
  if it.id is null then raise exception 'item_nao_encontrado'; end if;
  if it.status <> 'pendente' then raise exception 'item_ja_conciliado'; end if;
  if (p_lancamento is null) = (p_parcela is null) then raise exception 'escolha_um'; end if;
  if p_parcela is not null then
    if it.valor <= 0 then raise exception 'sentido_diferente'; end if;
    if not exists (select 1 from a1_fin_parcelas where id = p_parcela and tenant_id = it.tenant_id) then raise exception 'parcela_nao_encontrada'; end if;
    v_lanc := a1_fin_parcela_baixar_int(p_parcela, it.data, it.valor, it.conta_id, null, 0);
    update a1_fin_extrato_itens set status = 'conciliado', parcela_id = p_parcela, lancamento_id = v_lanc, conciliado_em = now() where id = it.id;
    return json_build_object('ok', true, 'lancamento_id', v_lanc);
  end if;
  select * into l from a1_fin_lancamentos where id = p_lancamento and tenant_id = it.tenant_id for update;
  if l.id is null then raise exception 'lancamento_nao_encontrado'; end if;
  if l.tipo <> (case when it.valor > 0 then 'receber' else 'pagar' end) then raise exception 'sentido_diferente'; end if;
  if exists (select 1 from a1_fin_extrato_itens x where x.lancamento_id = l.id) then raise exception 'lancamento_ja_conciliado'; end if;
  if l.status = 'aberto' then
    if abs(it.valor) > l.valor + 0.005 then raise exception 'valor_maior_que_o_lancamento'; end if;
    if l.origem = 'carteira' or l.origem = 'locacao' then raise exception 'lancamento_do_sistema'; end if;
    if abs(it.valor) < l.valor then
      insert into a1_fin_lancamentos (tenant_id, tipo, descricao, categoria_id, valor, vencimento, competencia, pessoa, partner_id,
                                      negocio_id, comissao_id, origem, origem_id, grupo_id, parcela, parcelas, observacao, centro_id)
      values (l.tenant_id, l.tipo, l.descricao, l.categoria_id, l.valor - abs(it.valor), l.vencimento, l.competencia, l.pessoa, l.partner_id,
              l.negocio_id, l.comissao_id, l.origem, l.origem_id, l.grupo_id, l.parcela, l.parcelas, l.observacao, l.centro_id)
      returning id into v_resto;
    end if;
    update a1_fin_lancamentos set status = 'pago', pago_em = it.data, valor_pago = abs(it.valor), valor = abs(it.valor),
           conta_id = it.conta_id, versao = versao + 1, atualizado_em = now()
     where id = l.id;
    perform a1_fin_apos_baixa(l.comissao_id);
  elsif l.status <> 'pago' then
    raise exception 'lancamento_cancelado';
  end if;
  update a1_fin_extrato_itens set status = 'conciliado', lancamento_id = l.id, conciliado_em = now() where id = it.id;
  return json_build_object('ok', true, 'lancamento_id', l.id, 'resto_id', v_resto);
end $$;
revoke all on function a1_fin_extrato_conciliar(uuid, uuid, uuid) from public;
grant execute on function a1_fin_extrato_conciliar(uuid, uuid, uuid) to anon, authenticated;

-- Concilia de uma vez as linhas que têm exatamente um candidato exato (valor
-- igual e até 3 dias).
create or replace function a1_fin_extrato_conciliar_auto(p_conta uuid)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare it record; s record; v_n int := 0; v_cand int;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  for it in select id from a1_fin_extrato_itens where tenant_id = a1_tenant() and conta_id = p_conta and status = 'pendente' order by data loop
    select count(*) into v_cand from a1_fin_extrato_sugestoes(it.id) x where x.dias <= 3;
    if v_cand = 1 then
      select * into s from a1_fin_extrato_sugestoes(it.id) x where x.dias <= 3 limit 1;
      begin
        perform a1_fin_extrato_conciliar(it.id, case when s.tipo = 'lancamento' then s.id end, case when s.tipo = 'parcela' then s.id end);
        v_n := v_n + 1;
      exception when others then null;
      end;
    end if;
  end loop;
  return json_build_object('ok', true, 'conciliados', v_n);
end $$;
revoke all on function a1_fin_extrato_conciliar_auto(uuid) from public;
grant execute on function a1_fin_extrato_conciliar_auto(uuid) to anon, authenticated;

-- Linha sem par: vira um lançamento pago (manual do extrato) e já concilia.
create or replace function a1_fin_extrato_criar_lancamento(p_item uuid, p_descricao text, p_categoria uuid, p_centro uuid)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare it a1_fin_extrato_itens; v_lanc uuid;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  select * into it from a1_fin_extrato_itens where id = p_item and tenant_id = a1_tenant() for update;
  if it.id is null then raise exception 'item_nao_encontrado'; end if;
  if it.status <> 'pendente' then raise exception 'item_ja_conciliado'; end if;
  if p_categoria is not null and not exists (select 1 from a1_fin_categorias where id = p_categoria and tenant_id = it.tenant_id) then
    raise exception 'referencia_de_outro_cliente';
  end if;
  insert into a1_fin_lancamentos (tenant_id, tipo, descricao, categoria_id, conta_id, valor, vencimento, competencia, status,
                                  pago_em, valor_pago, origem, origem_id, centro_id)
  values (it.tenant_id, case when it.valor > 0 then 'receber' else 'pagar' end,
          left(coalesce(nullif(btrim(coalesce(p_descricao, '')), ''), it.descricao, 'Lançamento do extrato'), 200),
          p_categoria, it.conta_id, abs(it.valor), it.data, date_trunc('month', it.data)::date, 'pago', it.data, abs(it.valor),
          'extrato', it.id, p_centro)
  returning id into v_lanc;
  update a1_fin_extrato_itens set status = 'conciliado', lancamento_id = v_lanc, conciliado_em = now() where id = it.id;
  return json_build_object('ok', true, 'lancamento_id', v_lanc);
end $$;
revoke all on function a1_fin_extrato_criar_lancamento(uuid, text, uuid, uuid) from public;
grant execute on function a1_fin_extrato_criar_lancamento(uuid, text, uuid, uuid) to anon, authenticated;

-- Ignorar (tarifa já lançada de outro jeito, transferência entre contas...) ou
-- desfazer: a linha volta a pendente. Desfazer não estorna a baixa feita; o
-- lançamento criado pelo próprio extrato é apagado.
create or replace function a1_fin_extrato_marcar(p_item uuid, p_acao text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare it a1_fin_extrato_itens;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  select * into it from a1_fin_extrato_itens where id = p_item and tenant_id = a1_tenant() for update;
  if it.id is null then raise exception 'item_nao_encontrado'; end if;
  if p_acao = 'ignorar' then
    if it.status <> 'pendente' then raise exception 'item_ja_conciliado'; end if;
    update a1_fin_extrato_itens set status = 'ignorado' where id = it.id;
  elsif p_acao = 'desfazer' then
    update a1_fin_extrato_itens set status = 'pendente', lancamento_id = null, parcela_id = null, conciliado_em = null where id = it.id;
    delete from a1_fin_lancamentos where origem = 'extrato' and origem_id = it.id;
  else
    raise exception 'acao_invalida';
  end if;
  return json_build_object('ok', true);
end $$;
revoke all on function a1_fin_extrato_marcar(uuid, text) from public;
grant execute on function a1_fin_extrato_marcar(uuid, text) to anon, authenticated;

-- ── 12. DRE ─────────────────────────────────────────────────────────────────
-- Grupo da categoria: o escolhido, ou o padrão pela chave do sistema/tipo.
create or replace function a1_fin_grupo_dre(p_grupo text, p_chave text, p_tipo text)
returns text language sql immutable as $$
  select coalesce(p_grupo, case
    when p_chave = 'impostos' then 'deducao'
    when p_chave in ('comissao_paga', 'custas') then 'custo'
    when p_tipo = 'receita' then 'receita'
    else 'despesa' end);
$$;

-- Orçamento de um ano (e centro) de uma vez: grava o que veio, apaga o zerado.
-- p_valores: [{categoria, mes (AAAA-MM-01), valor}]
create or replace function a1_fin_orcamento_salvar(p_ano int, p_centro uuid, p_valores jsonb)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_t uuid := a1_tenant(); e jsonb; v_m date; v_v numeric; v_c uuid; v_n int := 0;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  if p_ano is null or p_ano < 2000 or p_ano > 2100 then raise exception 'periodo_invalido'; end if;
  if jsonb_typeof(p_valores) <> 'array' or jsonb_array_length(p_valores) > 5000 then raise exception 'dados_invalidos'; end if;
  if p_centro is not null and not exists (select 1 from a1_fin_centros where id = p_centro and tenant_id = v_t) then
    raise exception 'referencia_de_outro_cliente';
  end if;
  for e in select * from jsonb_array_elements(p_valores) loop
    v_c := (e->>'categoria')::uuid;
    v_m := (e->>'mes')::date;
    v_v := round(coalesce(a1_fin_num(e->>'valor'), 0), 2);
    if v_m is null or extract(year from v_m) <> p_ano or extract(day from v_m) <> 1 or v_v < 0 then raise exception 'dados_invalidos'; end if;
    if not exists (select 1 from a1_fin_categorias where id = v_c and tenant_id = v_t) then raise exception 'referencia_de_outro_cliente'; end if;
    delete from a1_fin_orcamentos where tenant_id = v_t and categoria_id = v_c and mes = v_m
       and centro_id is not distinct from p_centro;
    if v_v > 0 then
      insert into a1_fin_orcamentos (tenant_id, categoria_id, centro_id, mes, valor) values (v_t, v_c, p_centro, v_m, v_v);
      v_n := v_n + 1;
    end if;
  end loop;
  return json_build_object('ok', true, 'valores', v_n);
end $$;
revoke all on function a1_fin_orcamento_salvar(int, uuid, jsonb) from public;
grant execute on function a1_fin_orcamento_salvar(int, uuid, jsonb) to anon, authenticated;

create or replace function a1_fin_dre(p_inicio date, p_fim date, p_centro uuid default null, p_regime text default 'caixa')
returns table (grupo text, categoria_id uuid, categoria text, mes date, realizado numeric, orcado numeric)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v_t uuid := a1_tenant();
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim > p_inicio + interval '3 years' then raise exception 'periodo_invalido'; end if;
  if p_regime not in ('caixa', 'competencia') then raise exception 'regime_invalido'; end if;
  return query
  with mov as (
    select l.categoria_id as cat, l.tipo as tp,
           date_trunc('month', case when p_regime = 'caixa' then l.pago_em else coalesce(l.competencia, l.vencimento) end)::date as m,
           case when p_regime = 'caixa' then l.valor_pago else l.valor end as v
      from a1_fin_lancamentos l
     where l.tenant_id = v_t
       and (p_centro is null or l.centro_id = p_centro)
       and case when p_regime = 'caixa' then l.status = 'pago' and l.pago_em between p_inicio and p_fim
                else l.status <> 'cancelado' and coalesce(l.competencia, l.vencimento) between date_trunc('month', p_inicio)::date and p_fim end
  ), rea as (
    select x.cat, x.tp, x.m, sum(x.v) as total from mov x group by 1, 2, 3
  ), orc as (
    select o.categoria_id as cat, case c.tipo when 'receita' then 'receber' else 'pagar' end as tp, o.mes as m, sum(o.valor) as total
      from a1_fin_orcamentos o join a1_fin_categorias c on c.id = o.categoria_id
     where o.tenant_id = v_t and o.mes between date_trunc('month', p_inicio)::date and p_fim
       and (p_centro is null or o.centro_id = p_centro)
     group by 1, 2, 3
  ), k as (
    select r.cat, r.tp, r.m from rea r union select o.cat, o.tp, o.m from orc o
  )
  select a1_fin_grupo_dre(c.grupo_dre, c.chave, case k.tp when 'receber' then 'receita' else 'despesa' end),
         k.cat, coalesce(c.nome, case k.tp when 'receber' then 'Receitas sem categoria' else 'Despesas sem categoria' end), k.m,
         coalesce(r.total, 0), coalesce(o.total, 0)
    from k
    left join a1_fin_categorias c on c.id = k.cat
    left join rea r on r.cat is not distinct from k.cat and r.tp = k.tp and r.m = k.m
    left join orc o on o.cat is not distinct from k.cat and o.tp = k.tp and o.m = k.m
   order by 1, 3, 4;
end $$;
revoke all on function a1_fin_dre(date, date, uuid, text) from public;
grant execute on function a1_fin_dre(date, date, uuid, text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- COMO CONFERIR (no SQL Editor, depois de rodar)
--   select count(*) from a1_fin_carteiras;                 -- 0
--   select count(*) from a1_fin_extrato_itens;             -- 0
--   select count(*) from a1_fin_config where carteira_ativa or lembrete_ativo;  -- 0
--   select count(*) from a1_fin_lancamentos where centro_id is not null;        -- 0
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'a1_lc_indices_indice_ck';
--   select jobname, schedule from cron.job where jobname = 'a1-fin-lembretes';   -- 13 12-20 * * *
--   select public.a1_fin_lembretes_disparar();   -- {"ok":true,"ignorado":"ninguem_ligou"}
-- ════════════════════════════════════════════════════════════════════════════
