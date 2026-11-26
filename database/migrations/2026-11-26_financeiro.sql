-- ════════════════════════════════════════════════════════════════════════════
-- MÓDULO FINANCEIRO (financeiro) · fase 1: negócios, comissões, contas a pagar
-- e a receber, contas bancárias e fluxo de caixa, ligado aos demais módulos
--
-- POR QUE ESTE ARQUIVO EXISTE
--   "crie o modulo financeiro, de acordo com o descrito no superadmin
--    (Controle de comissões, repasse financeiro e fluxo de caixa) (...) ligado
--    aos demais modulos (...) um cliente meu assine só o crm, logo, vamos
--    precisar um selo de vendido, para que ai sim seja contabilizado (...)
--    principalmente comissao, calcular as regras de comissao certinho".
--   Escolhas do dono: núcleo agora (carteira da construtora, OFX e DRE depois);
--   o selo GANHO do CRM continua GANHO e passa a gerar o negócio; a comissão
--   de quem recebe libera AO RECEBER (padrão, mudável por regra); parceiro vê
--   só as próprias comissões.
--
-- COMO OS MÓDULOS ALIMENTAM O FINANCEIRO (só com a licença `financeiro`)
--   - Leads (CRM): lead entra na etapa com selo GANHO → nasce o negócio.
--     Sai da etapa → o negócio é cancelado (comissões não pagas caem).
--     Se o cliente tem o módulo Venda (COMERCIAL), quem gera é a venda, para
--     o mesmo negócio não contar duas vezes.
--   - Venda (COMERCIAL): venda entra na situação VENDIDO → nasce o negócio;
--     vai para FIM_NEGATIVO (distrato) → cancelado.
--   - Repasse: a etapa escolhida em Financeiro › Configurações (ex.: "Contrato
--     assinado") marca a assinatura: libera as comissões "na assinatura" do
--     negócio da venda; sem venda (correspondente), nasce o negócio do repasse.
--   - Registro: a etapa escolhida (ex.: "Registrado") gera o negócio do
--     despachante (honorários).
--   - Locação: cada repasse ao proprietário lança a taxa de administração como
--     receita recebida; o estorno da cobrança tira o lançamento.
--   Os gatilhos NUNCA travam o módulo de origem: erro no Financeiro vira aviso
--   no log e o card/venda/cobrança anda normalmente.
--
-- COMISSÃO
--   Regras (a1_fin_regras): direção (receber = o que a empresa ganha; pagar =
--   o que ela paga a corretor, captador, coordenador, imobiliária parceira,
--   correspondente/CCA, analista, indicador), base (valor do negócio, valor
--   financiado ou a comissão da empresa), percentual ou valor fixo, imposto
--   descontado antes, liberação (ao receber | na venda | na assinatura),
--   escopo (origem, empreendimento, parceiro) e prioridade. Para cada papel
--   vale UMA regra: a mais específica (parceiro > empreendimento > origem),
--   depois a de maior prioridade. Cada comissão guarda a regra que a gerou.
--   Ao receber: recebimento parcial libera a parte proporcional.
--
-- O QUE ELE NÃO MUDA
--   Nenhuma tabela existente ganha coluna. Nenhum dado existente é alterado:
--   negócios só nascem de movimentos FUTUROS (ou à mão). Os gatilhos novos em
--   a1_cases, a1_comerciais e a1_lc_repasses não fazem nada para quem não tem
--   a licença. A licença nasce desligada para todos.
--
-- Idempotente: pode rodar de novo.
-- ════════════════════════════════════════════════════════════════════════════

insert into a1_modules (key, name, description) values
  ('financeiro', 'Módulo Financeiro', 'Controle de comissões, repasse financeiro e fluxo de caixa.')
on conflict (key) do nothing;

-- ── Quem pode ───────────────────────────────────────────────────────────────
-- Gestor do cliente, ou parceiro com a permissão gerir_financeiro (ou gerente).
create or replace function a1_fin_pode()
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select a1_tenant() is not null and a1_tem_modulo('financeiro') and a1_perm('gerir_financeiro');
$$;
revoke all on function a1_fin_pode() from public;
grant execute on function a1_fin_pode() to anon, authenticated;

-- Licença sem sessão (para os gatilhos).
create or replace function a1_fin_licenca(p_tenant uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select exists (select 1 from a1_tenant_modules m where m.tenant_id = p_tenant and m.module_key = 'financeiro'
                  and (m.expires_at is null or m.expires_at > now()));
$$;
revoke all on function a1_fin_licenca(uuid) from public, anon, authenticated;

-- "1.234,56", "1234.56", "350000" → número; lixo → null.
create or replace function a1_fin_num(p text)
returns numeric language plpgsql immutable as $$
declare t text := btrim(coalesce(p, ''));
begin
  if t = '' then return null; end if;
  t := regexp_replace(t, '[^0-9,.-]', '', 'g');
  if t like '%,%' then t := replace(replace(t, '.', ''), ',', '.'); end if;
  return t::numeric;
exception when others then return null;
end $$;

-- ── Tabelas ─────────────────────────────────────────────────────────────────
create table if not exists a1_fin_config (
  tenant_id uuid primary key references a1_tenants(id) on delete cascade,
  etapa_repasse uuid,            -- etapa do Repasse que marca "contrato assinado"
  etapa_registro uuid,           -- etapa do Registro que marca "serviço concluído"
  prazo_receber_dias int not null default 30 check (prazo_receber_dias between 0 and 365),
  conta_padrao uuid,
  atualizado_em timestamptz not null default now()
);

create table if not exists a1_fin_contas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 2 and 80),
  tipo text not null default 'banco' check (tipo in ('banco', 'caixa', 'carteira', 'aplicacao')),
  banco text check (banco is null or length(banco) <= 80),
  agencia text check (agencia is null or length(agencia) <= 20),
  conta text check (conta is null or length(conta) <= 30),
  saldo_inicial numeric(14,2) not null default 0,
  saldo_inicial_em date not null default current_date,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists a1_fin_categorias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 2 and 80),
  tipo text not null check (tipo in ('receita', 'despesa')),
  chave text,                    -- categorias do sistema (comissao_venda, taxa_adm, ...)
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists a1_fin_categorias_chave_uq on a1_fin_categorias (tenant_id, chave) where chave is not null;

create table if not exists a1_fin_negocios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  seq int,
  origem text not null check (origem in ('crm', 'comercial', 'repasse', 'registro', 'manual')),
  origem_id uuid,
  descricao text check (descricao is null or length(descricao) <= 200),
  cliente_nome text check (cliente_nome is null or length(cliente_nome) <= 160),
  empreendimento text check (empreendimento is null or length(empreendimento) <= 160),
  unidade text check (unidade is null or length(unidade) <= 60),
  valor numeric(14,2) not null default 0 check (valor >= 0),
  valor_financiado numeric(14,2) check (valor_financiado is null or valor_financiado >= 0),
  data date not null default current_date,
  assinado_em date,
  status text not null default 'ativo' check (status in ('ativo', 'cancelado')),
  cancelado_em timestamptz,
  motivo_cancelamento text check (motivo_cancelamento is null or length(motivo_cancelamento) <= 300),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists a1_fin_negocios_origem_uq on a1_fin_negocios (tenant_id, origem, origem_id) where origem_id is not null;
create unique index if not exists a1_fin_negocios_seq_uq on a1_fin_negocios (tenant_id, seq);
create index if not exists a1_fin_negocios_idx on a1_fin_negocios (tenant_id, status, data);

create table if not exists a1_fin_participantes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  negocio_id uuid not null references a1_fin_negocios(id) on delete cascade,
  papel text not null check (papel in ('corretor', 'captador', 'coordenador', 'imobiliaria', 'correspondente',
                                       'cca', 'analista', 'indicador', 'outro')),
  partner_id uuid,
  nome text not null check (length(btrim(nome)) between 1 and 160)
);
create index if not exists a1_fin_participantes_idx on a1_fin_participantes (negocio_id);

create table if not exists a1_fin_regras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 2 and 120),
  ativo boolean not null default true,
  direcao text not null check (direcao in ('receber', 'pagar')),
  papel text not null check (papel in ('empresa', 'corretor', 'captador', 'coordenador', 'imobiliaria', 'correspondente',
                                       'cca', 'analista', 'indicador', 'outro')),
  origem text not null default 'todas' check (origem in ('todas', 'crm', 'comercial', 'repasse', 'registro', 'manual')),
  empreendimento text check (empreendimento is null or length(empreendimento) <= 160),
  partner_id uuid,
  base text not null default 'valor' check (base in ('valor', 'valor_financiado', 'comissao_empresa')),
  tipo_calculo text not null default 'percentual' check (tipo_calculo in ('percentual', 'fixo')),
  percentual numeric(7,4) check (percentual is null or percentual between 0 and 100),
  valor_fixo numeric(14,2) check (valor_fixo is null or valor_fixo >= 0),
  imposto_pct numeric(6,3) not null default 0 check (imposto_pct between 0 and 100),
  liberacao text not null default 'recebimento' check (liberacao in ('recebimento', 'venda', 'assinatura')),
  pagador text check (pagador is null or length(pagador) <= 120),
  prioridade int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint a1_fin_regra_coerente check (
    (direcao = 'receber') = (papel = 'empresa')
    and (direcao = 'pagar' or base <> 'comissao_empresa')
    and ((tipo_calculo = 'percentual' and percentual is not null) or (tipo_calculo = 'fixo' and valor_fixo is not null))
  )
);

create table if not exists a1_fin_comissoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  negocio_id uuid not null references a1_fin_negocios(id) on delete cascade,
  regra_id uuid references a1_fin_regras(id) on delete set null,
  regra_nome text,
  direcao text not null check (direcao in ('receber', 'pagar')),
  papel text not null,
  partner_id uuid,
  beneficiario text not null,
  base_valor numeric(14,2) not null default 0,
  percentual numeric(7,4),
  imposto_pct numeric(6,3) not null default 0,
  valor numeric(14,2) not null check (valor >= 0),
  liberacao text not null,
  status text not null default 'prevista' check (status in ('prevista', 'liberada', 'paga', 'cancelada')),
  valor_liberado numeric(14,2) not null default 0,
  valor_pago numeric(14,2) not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists a1_fin_comissoes_idx on a1_fin_comissoes (negocio_id);
create index if not exists a1_fin_comissoes_partner_idx on a1_fin_comissoes (tenant_id, partner_id) where partner_id is not null;

create table if not exists a1_fin_lancamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references a1_tenants(id) on delete cascade,
  tipo text not null check (tipo in ('receber', 'pagar')),
  descricao text not null check (length(btrim(descricao)) between 2 and 200),
  categoria_id uuid references a1_fin_categorias(id) on delete set null,
  conta_id uuid references a1_fin_contas(id) on delete set null,
  valor numeric(14,2) not null check (valor > 0),
  vencimento date not null,
  competencia date,
  status text not null default 'aberto' check (status in ('aberto', 'pago', 'cancelado')),
  pago_em date,
  valor_pago numeric(14,2),
  forma text check (forma is null or forma in ('pix', 'boleto', 'transferencia', 'dinheiro', 'cartao', 'cheque', 'outro')),
  pessoa text check (pessoa is null or length(pessoa) <= 160),
  partner_id uuid,
  negocio_id uuid references a1_fin_negocios(id) on delete set null,
  comissao_id uuid references a1_fin_comissoes(id) on delete set null,
  origem text not null default 'manual' check (origem in ('manual', 'comissao', 'locacao')),
  origem_id uuid,
  grupo_id uuid,                 -- parcelas/recorrência
  parcela int,
  parcelas int,
  observacao text check (observacao is null or length(observacao) <= 1000),
  versao int not null default 1,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint a1_fin_lanc_pago_coerente check ((status = 'pago') = (pago_em is not null and valor_pago is not null))
);
create index if not exists a1_fin_lancamentos_idx on a1_fin_lancamentos (tenant_id, status, vencimento);
create index if not exists a1_fin_lancamentos_com_idx on a1_fin_lancamentos (comissao_id) where comissao_id is not null;
create unique index if not exists a1_fin_lancamentos_locacao_uq on a1_fin_lancamentos (origem_id) where origem = 'locacao';

-- ── RLS ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['a1_fin_config', 'a1_fin_contas', 'a1_fin_categorias', 'a1_fin_negocios', 'a1_fin_participantes',
                           'a1_fin_regras', 'a1_fin_comissoes', 'a1_fin_lancamentos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
    execute format('drop policy if exists %I on %I', t || '_ler', t);
    execute format('create policy %I on %I for select using (tenant_id = (select a1_tenant()) and (select a1_fin_pode()))', t || '_ler', t);
  end loop;
  -- cadastros: grava direto
  foreach t in array array['a1_fin_config', 'a1_fin_contas', 'a1_fin_categorias', 'a1_fin_regras'] loop
    execute format('grant insert, update, delete on %I to anon, authenticated', t);
    execute format('drop policy if exists %I on %I', t || '_gravar', t);
    execute format('create policy %I on %I for all using (tenant_id = (select a1_tenant()) and (select a1_fin_pode())) with check (tenant_id = (select a1_tenant()) and (select a1_fin_pode()))', t || '_gravar', t);
  end loop;
  -- lançamento manual em aberto: grava direto; o resto (baixa, estorno, os
  -- gerados por comissão e locação) só por função
  execute 'grant insert, update, delete on a1_fin_lancamentos to anon, authenticated';
  execute 'drop policy if exists a1_fin_lancamentos_gravar on a1_fin_lancamentos';
  execute $p$create policy a1_fin_lancamentos_gravar on a1_fin_lancamentos for all
    using (tenant_id = (select a1_tenant()) and (select a1_fin_pode()) and origem = 'manual' and status = 'aberto')
    with check (tenant_id = (select a1_tenant()) and (select a1_fin_pode()) and origem = 'manual' and status = 'aberto'
                and pago_em is null and valor_pago is null and negocio_id is null and comissao_id is null)$p$;
end $$;

-- Referências do mesmo cliente (conta, categoria, regra com parceiro).
create or replace function a1_fin_mesmo_cliente()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  -- Só confere o que mudou: o "set null" das chaves (ex.: ao excluir um
  -- cliente inteiro) não pode ser barrado por um parceiro já apagado.
  mudou_cat boolean; mudou_conta boolean; mudou_par boolean;
begin
  if tg_table_name = 'a1_fin_lancamentos' then
    mudou_cat := tg_op = 'INSERT' or new.categoria_id is distinct from old.categoria_id;
    mudou_conta := tg_op = 'INSERT' or new.conta_id is distinct from old.conta_id;
    mudou_par := tg_op = 'INSERT' or new.partner_id is distinct from old.partner_id;
    if (mudou_cat and new.categoria_id is not null and not exists (select 1 from a1_fin_categorias where id = new.categoria_id and tenant_id = new.tenant_id))
       or (mudou_conta and new.conta_id is not null and not exists (select 1 from a1_fin_contas where id = new.conta_id and tenant_id = new.tenant_id))
       or (mudou_par and new.partner_id is not null and not exists (select 1 from a1_partners where id = new.partner_id and tenant_id = new.tenant_id)) then
      raise exception 'referencia_de_outro_cliente';
    end if;
  elsif tg_table_name = 'a1_fin_regras' then
    if (tg_op = 'INSERT' or new.partner_id is distinct from old.partner_id)
       and new.partner_id is not null and not exists (select 1 from a1_partners where id = new.partner_id and tenant_id = new.tenant_id) then
      raise exception 'referencia_de_outro_cliente';
    end if;
  elsif tg_table_name = 'a1_fin_config' then
    if ((tg_op = 'INSERT' or new.conta_padrao is distinct from old.conta_padrao)
          and new.conta_padrao is not null and not exists (select 1 from a1_fin_contas where id = new.conta_padrao and tenant_id = new.tenant_id))
       or ((tg_op = 'INSERT' or new.etapa_repasse is distinct from old.etapa_repasse)
          and new.etapa_repasse is not null and not exists (select 1 from a1_stages where id = new.etapa_repasse and tenant_id = new.tenant_id and module_key = 'repasse'))
       or ((tg_op = 'INSERT' or new.etapa_registro is distinct from old.etapa_registro)
          and new.etapa_registro is not null and not exists (select 1 from a1_stages where id = new.etapa_registro and tenant_id = new.tenant_id and module_key = 'registro')) then
      raise exception 'referencia_de_outro_cliente';
    end if;
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['a1_fin_lancamentos', 'a1_fin_regras', 'a1_fin_config'] loop
    execute format('drop trigger if exists %I on %I', t || '_mesmo_cliente', t);
    execute format('create trigger %I before insert or update on %I for each row execute function a1_fin_mesmo_cliente()', t || '_mesmo_cliente', t);
  end loop;
end $$;

-- ID do negócio (NG-0001), sequencial por cliente.
create or replace function a1_fin_numerar()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    new.seq := old.seq;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fin-num:' || new.tenant_id::text, 0));
  select coalesce(max(seq), 0) + 1 into new.seq from a1_fin_negocios where tenant_id = new.tenant_id;
  return new;
end $$;
drop trigger if exists a1_fin_negocios_numerar on a1_fin_negocios;
create trigger a1_fin_negocios_numerar before insert or update on a1_fin_negocios
  for each row execute function a1_fin_numerar();

-- ── Preparação: categorias do sistema, caixa e configuração ────────────────
create or replace function a1_fin_preparar_tenant(p_tenant uuid)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_conta uuid;
begin
  insert into a1_fin_categorias (tenant_id, nome, tipo, chave)
  select p_tenant, c.nome, c.tipo, c.chave from (values
    ('comissao_venda', 'Comissão de venda', 'receita'),
    ('venda_unidade', 'Venda de unidade', 'receita'),
    ('comissao_banco', 'Comissão bancária', 'receita'),
    ('honorarios', 'Honorários', 'receita'),
    ('taxa_adm', 'Taxa de administração (Locação)', 'receita'),
    ('reembolso_custas', 'Reembolso de custas', 'receita'),
    ('outras_receitas', 'Outras receitas', 'receita'),
    ('comissao_paga', 'Comissões pagas', 'despesa'),
    ('impostos', 'Impostos', 'despesa'),
    ('pessoal', 'Pessoal', 'despesa'),
    ('ocupacao', 'Aluguel, condomínio e contas', 'despesa'),
    ('marketing', 'Marketing', 'despesa'),
    ('custas', 'Custas e taxas (cartório, ITBI)', 'despesa'),
    ('administrativas', 'Despesas administrativas', 'despesa'),
    ('outras_despesas', 'Outras despesas', 'despesa')) c(chave, nome, tipo)
  on conflict (tenant_id, chave) where chave is not null do nothing;
  if not exists (select 1 from a1_fin_contas where tenant_id = p_tenant) then
    insert into a1_fin_contas (tenant_id, nome, tipo) values (p_tenant, 'Caixa', 'caixa') returning id into v_conta;
  end if;
  insert into a1_fin_config (tenant_id, conta_padrao)
  values (p_tenant, coalesce(v_conta, (select id from a1_fin_contas where tenant_id = p_tenant and ativo order by criado_em limit 1)))
  on conflict (tenant_id) do nothing;
end $$;
revoke all on function a1_fin_preparar_tenant(uuid) from public, anon, authenticated;

create or replace function a1_fin_iniciar()
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  perform a1_fin_preparar_tenant(a1_tenant());
  return json_build_object('ok', true);
end $$;

create or replace function a1_fin_categoria(p_tenant uuid, p_chave text)
returns uuid language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select id from a1_fin_categorias where tenant_id = p_tenant and chave = p_chave;
$$;
revoke all on function a1_fin_categoria(uuid, text) from public, anon, authenticated;

-- ── Motor de comissão ───────────────────────────────────────────────────────
-- Melhor regra para (direção, papel, parceiro) num negócio.
create or replace function a1_fin_regra_para(p_neg a1_fin_negocios, p_direcao text, p_papel text, p_partner uuid)
returns a1_fin_regras language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select r.* from a1_fin_regras r
   where r.tenant_id = p_neg.tenant_id and r.ativo and r.direcao = p_direcao and r.papel = p_papel
     and r.origem in ('todas', p_neg.origem)
     and (r.empreendimento is null or lower(btrim(r.empreendimento)) = lower(btrim(coalesce(p_neg.empreendimento, ''))))
     and (r.partner_id is null or r.partner_id = p_partner)
   order by (r.partner_id is not null)::int * 4 + (r.empreendimento is not null)::int * 2 + (r.origem <> 'todas')::int desc,
            r.prioridade desc, r.criado_em, r.id
   limit 1;
$$;
revoke all on function a1_fin_regra_para(a1_fin_negocios, text, text, uuid) from public, anon, authenticated;

-- Calcula (ou recalcula) as comissões de um negócio sem nada pago.
create or replace function a1_fin_calcular(p_negocio uuid)
returns int language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  n a1_fin_negocios; r a1_fin_regras; p record; v_base numeric; v_valor numeric; v_emp numeric := 0;
  v_cfg a1_fin_config; v_com uuid; v_qtd int := 0; v_tipo text; v_cat text;
begin
  select * into n from a1_fin_negocios where id = p_negocio for update;
  if n.id is null or n.status <> 'ativo' then return 0; end if;
  if exists (select 1 from a1_fin_comissoes where negocio_id = n.id and valor_pago > 0)
     or exists (select 1 from a1_fin_lancamentos where negocio_id = n.id and status = 'pago') then
    raise exception 'negocio_com_pagamento';
  end if;
  perform a1_fin_preparar_tenant(n.tenant_id);
  select * into v_cfg from a1_fin_config where tenant_id = n.tenant_id;
  delete from a1_fin_lancamentos where negocio_id = n.id and status <> 'pago';
  delete from a1_fin_comissoes where negocio_id = n.id;
  select tipo_cliente into v_tipo from a1_tenants where id = n.tenant_id;

  -- 1. o que a empresa recebe
  r := a1_fin_regra_para(n, 'receber', 'empresa', null);
  if r.id is not null then
    v_base := case r.base when 'valor_financiado' then coalesce(n.valor_financiado, n.valor) else n.valor end;
    v_base := round(v_base * (1 - r.imposto_pct / 100), 2);
    v_valor := case r.tipo_calculo when 'fixo' then r.valor_fixo else round(v_base * r.percentual / 100, 2) end;
    if v_valor > 0 then
      insert into a1_fin_comissoes (tenant_id, negocio_id, regra_id, regra_nome, direcao, papel, beneficiario, base_valor,
                                    percentual, imposto_pct, valor, liberacao, status, valor_liberado)
      values (n.tenant_id, n.id, r.id, r.nome, 'receber', 'empresa', coalesce(r.pagador, 'Empresa'), v_base,
              case when r.tipo_calculo = 'percentual' then r.percentual end, r.imposto_pct, v_valor, r.liberacao, 'liberada', v_valor)
      returning id into v_com;
      v_cat := case n.origem when 'registro' then 'honorarios' when 'repasse' then 'comissao_banco'
                 else case when v_tipo = 'construtora' then 'venda_unidade' else 'comissao_venda' end end;
      insert into a1_fin_lancamentos (tenant_id, tipo, descricao, categoria_id, valor, vencimento, competencia, pessoa,
                                      negocio_id, comissao_id, origem)
      values (n.tenant_id, 'receber', left(format('Comissão NG-%s · %s', lpad(n.seq::text, 4, '0'), coalesce(n.descricao, n.cliente_nome, '')), 200),
              a1_fin_categoria(n.tenant_id, v_cat), v_valor, n.data + coalesce(v_cfg.prazo_receber_dias, 30),
              date_trunc('month', n.data)::date, r.pagador, n.id, v_com, 'comissao');
      v_emp := v_valor;
      v_qtd := v_qtd + 1;
    end if;
  end if;

  -- 2. o que a empresa paga, um por participante
  for p in select * from a1_fin_participantes where negocio_id = n.id order by papel, nome loop
    r := a1_fin_regra_para(n, 'pagar', p.papel, p.partner_id);
    continue when r.id is null;
    v_base := case r.base when 'valor_financiado' then coalesce(n.valor_financiado, n.valor)
                          when 'comissao_empresa' then v_emp else n.valor end;
    v_base := round(v_base * (1 - r.imposto_pct / 100), 2);
    v_valor := case r.tipo_calculo when 'fixo' then r.valor_fixo else round(v_base * r.percentual / 100, 2) end;
    continue when coalesce(v_valor, 0) <= 0;
    insert into a1_fin_comissoes (tenant_id, negocio_id, regra_id, regra_nome, direcao, papel, partner_id, beneficiario,
                                  base_valor, percentual, imposto_pct, valor, liberacao)
    values (n.tenant_id, n.id, r.id, r.nome, 'pagar', p.papel, p.partner_id, p.nome, v_base,
            case when r.tipo_calculo = 'percentual' then r.percentual end, r.imposto_pct, v_valor, r.liberacao);
    v_qtd := v_qtd + 1;
  end loop;
  perform a1_fin_liberar_negocio(n.id);
  return v_qtd;
end $$;
revoke all on function a1_fin_calcular(uuid) from public, anon, authenticated;

-- Libera o que já pode: "na venda" sempre; "ao receber" na proporção do que a
-- empresa já recebeu (sem nada a receber, libera como na venda); "na
-- assinatura" quando o negócio tem assinado_em. Cria o lançamento a pagar da
-- parte liberada. Se o recebido DIMINUIU (estorno), reduz o que está em
-- aberto; se já foi pago, recusa.
create or replace function a1_fin_liberar_negocio(p_negocio uuid)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  n a1_fin_negocios; c record; v_total numeric; v_recebido numeric; v_frac numeric; v_alvo numeric; v_dif numeric;
  v_aberto numeric; l record;
begin
  select * into n from a1_fin_negocios where id = p_negocio;
  if n.id is null or n.status <> 'ativo' then return; end if;
  select coalesce(sum(valor), 0) into v_total from a1_fin_comissoes
   where negocio_id = n.id and direcao = 'receber' and status <> 'cancelada';
  select coalesce(sum(l2.valor_pago), 0) into v_recebido from a1_fin_lancamentos l2
    join a1_fin_comissoes c2 on c2.id = l2.comissao_id
   where c2.negocio_id = n.id and c2.direcao = 'receber' and l2.status = 'pago';
  v_frac := case when v_total = 0 then 1 else least(1, v_recebido / v_total) end;
  for c in select * from a1_fin_comissoes where negocio_id = n.id and direcao = 'pagar' and status <> 'cancelada' loop
    v_alvo := case c.liberacao
                when 'venda' then c.valor
                when 'assinatura' then case when n.assinado_em is not null then c.valor else 0 end
                else round(c.valor * v_frac, 2) end;
    v_dif := v_alvo - c.valor_liberado;
    if v_dif > 0 then
      insert into a1_fin_lancamentos (tenant_id, tipo, descricao, categoria_id, valor, vencimento, competencia, pessoa, partner_id,
                                      negocio_id, comissao_id, origem)
      values (n.tenant_id, 'pagar', left(format('Comissão %s NG-%s · %s', c.papel, lpad(n.seq::text, 4, '0'), c.beneficiario), 200),
              a1_fin_categoria(n.tenant_id, 'comissao_paga'), v_dif, current_date, date_trunc('month', n.data)::date,
              c.beneficiario, c.partner_id, n.id, c.id, 'comissao');
      update a1_fin_comissoes set valor_liberado = v_alvo, status = case when status = 'paga' then status else 'liberada' end,
                                  atualizado_em = now() where id = c.id;
    elsif v_dif < 0 then
      -- tira do que ainda está em aberto, do mais novo para o mais antigo
      select coalesce(sum(valor), 0) into v_aberto from a1_fin_lancamentos where comissao_id = c.id and status = 'aberto';
      if v_aberto < -v_dif then raise exception 'comissao_ja_paga'; end if;
      v_dif := -v_dif;
      for l in select * from a1_fin_lancamentos where comissao_id = c.id and status = 'aberto' order by criado_em desc loop
        exit when v_dif <= 0;
        if l.valor <= v_dif then
          delete from a1_fin_lancamentos where id = l.id;
          v_dif := v_dif - l.valor;
        else
          update a1_fin_lancamentos set valor = valor - v_dif, versao = versao + 1, atualizado_em = now() where id = l.id;
          v_dif := 0;
        end if;
      end loop;
      update a1_fin_comissoes set valor_liberado = v_alvo, status = case when v_alvo > 0 then 'liberada' else 'prevista' end,
                                  atualizado_em = now() where id = c.id;
    end if;
  end loop;
end $$;
revoke all on function a1_fin_liberar_negocio(uuid) from public, anon, authenticated;

-- Cancela um negócio: comissões e lançamentos sem pagamento caem; o que já foi
-- pago fica (e o retorno diz quantos), para o gestor estornar à mão se quiser.
create or replace function a1_fin_cancelar_interno(p_negocio uuid, p_motivo text)
returns int language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_pagos int;
begin
  update a1_fin_negocios set status = 'cancelado', cancelado_em = now(), motivo_cancelamento = left(p_motivo, 300), atualizado_em = now()
   where id = p_negocio and status = 'ativo';
  if not found then return 0; end if;
  update a1_fin_lancamentos set status = 'cancelado', versao = versao + 1, atualizado_em = now()
   where negocio_id = p_negocio and status = 'aberto';
  update a1_fin_comissoes set status = 'cancelada', atualizado_em = now() where negocio_id = p_negocio and valor_pago = 0;
  select count(*) into v_pagos from a1_fin_comissoes where negocio_id = p_negocio and valor_pago > 0;
  return v_pagos;
end $$;
revoke all on function a1_fin_cancelar_interno(uuid, text) from public, anon, authenticated;

-- Cria (ou reativa) o negócio de uma origem e calcula as comissões.
create or replace function a1_fin_registrar(p_tenant uuid, p_origem text, p_origem_id uuid, p_dados jsonb, p_participantes jsonb)
returns uuid language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_id uuid; v_status text; p jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('fin-neg:' || p_origem || ':' || p_origem_id::text, 0));
  select id, status into v_id, v_status from a1_fin_negocios where tenant_id = p_tenant and origem = p_origem and origem_id = p_origem_id;
  if v_id is not null and v_status = 'ativo' then return v_id; end if;
  if v_id is not null then
    -- voltou para o selo: reativa com os dados de agora (só se nada foi pago)
    if exists (select 1 from a1_fin_comissoes where negocio_id = v_id and valor_pago > 0)
       or exists (select 1 from a1_fin_lancamentos where negocio_id = v_id and status = 'pago') then
      return v_id;
    end if;
    update a1_fin_negocios set status = 'ativo', cancelado_em = null, motivo_cancelamento = null, atualizado_em = now()
     where id = v_id;
    delete from a1_fin_participantes where negocio_id = v_id;
  else
    insert into a1_fin_negocios (tenant_id, origem, origem_id) values (p_tenant, p_origem, p_origem_id) returning id into v_id;
  end if;
  update a1_fin_negocios set
    descricao = left(p_dados->>'descricao', 200),
    cliente_nome = left(p_dados->>'cliente_nome', 160),
    empreendimento = left(p_dados->>'empreendimento', 160),
    unidade = left(p_dados->>'unidade', 60),
    valor = greatest(coalesce((p_dados->>'valor')::numeric, 0), 0),
    valor_financiado = (p_dados->>'valor_financiado')::numeric,
    data = coalesce((p_dados->>'data')::date, current_date),
    assinado_em = (p_dados->>'assinado_em')::date
   where id = v_id;
  for p in select * from jsonb_array_elements(coalesce(p_participantes, '[]'::jsonb)) loop
    continue when coalesce(btrim(p->>'nome'), '') = '';
    continue when (p->>'partner_id') is not null
              and not exists (select 1 from a1_partners where id = (p->>'partner_id')::uuid and tenant_id = p_tenant);
    insert into a1_fin_participantes (tenant_id, negocio_id, papel, partner_id, nome)
    select p_tenant, v_id, p->>'papel', (p->>'partner_id')::uuid, left(btrim(p->>'nome'), 160)
     where not exists (select 1 from a1_fin_participantes x where x.negocio_id = v_id and x.papel = p->>'papel'
                         and coalesce(x.partner_id::text, x.nome) = coalesce(p->>'partner_id', btrim(p->>'nome')));
  end loop;
  perform a1_fin_calcular(v_id);
  return v_id;
end $$;
revoke all on function a1_fin_registrar(uuid, text, uuid, jsonb, jsonb) from public, anon, authenticated;

-- Participante a partir de um parceiro (com o nome dele) ou de um nome solto.
create or replace function a1_fin_part(p_tenant uuid, p_papel text, p_partner uuid, p_nome text)
returns jsonb language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when p_partner is not null and exists (select 1 from a1_partners where id = p_partner and tenant_id = p_tenant)
      then (select jsonb_build_object('papel', p_papel, 'partner_id', id, 'nome', name) from a1_partners where id = p_partner)
    when nullif(btrim(coalesce(p_nome, '')), '') is not null
      then jsonb_build_object('papel', p_papel, 'nome', btrim(p_nome))
  end;
$$;
revoke all on function a1_fin_part(uuid, text, uuid, text) from public, anon, authenticated;

-- Coordenador do corretor (extra.coordenador_id), se houver.
create or replace function a1_fin_coord(p_tenant uuid, p_corretor uuid)
returns jsonb language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select a1_fin_part(p_tenant, 'coordenador', nullif(p.extra->>'coordenador_id', '')::uuid, null)
    from a1_partners p where p.id = p_corretor and p.tenant_id = p_tenant;
$$;
revoke all on function a1_fin_coord(uuid, uuid) from public, anon, authenticated;

-- ── Gatilhos nos módulos de origem ──────────────────────────────────────────
-- Leads (GANHO), Repasse e Registro (etapa escolhida). Nunca trava o card.
create or replace function a1_fin_de_case()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_selo_novo text; v_selo_velho text; v_cfg a1_fin_config; v_corr uuid; v_imob uuid; v_partes jsonb; v_neg uuid;
  v_fin numeric; v_val numeric;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then return null; end if;
  if not a1_fin_licenca(new.tenant_id) then return null; end if;
  begin
    if new.module_key = 'crm' then
      -- com o módulo Venda, quem gera o negócio é a venda
      if exists (select 1 from a1_tenant_modules where tenant_id = new.tenant_id and module_key = 'COMERCIAL'
                  and (expires_at is null or expires_at > now())) then
        return null;
      end if;
      select selo into v_selo_novo from a1_stages where id = new.stage_id;
      if tg_op = 'UPDATE' then select selo into v_selo_velho from a1_stages where id = old.stage_id; end if;
      if v_selo_novo = 'GANHO' and coalesce(v_selo_velho, '') <> 'GANHO' then
        v_corr := nullif(new.payload->'crm_refs'->>'corretor_id', '')::uuid;
        v_imob := nullif(new.payload->'crm_refs'->>'imobiliaria_id', '')::uuid;
        select coalesce(jsonb_agg(x), '[]'::jsonb) into v_partes from (
          select a1_fin_part(new.tenant_id, 'corretor', v_corr, new.broker_name) x
          union all select a1_fin_part(new.tenant_id, 'imobiliaria', v_imob, new.real_estate_name)
          union all select a1_fin_coord(new.tenant_id, v_corr)) s where x is not null;
        perform a1_fin_registrar(new.tenant_id, 'crm', new.id, jsonb_build_object(
          'descricao', concat_ws(' · ', new.client_name, nullif(concat_ws(' ', new.development, new.unit), '')),
          'cliente_nome', new.client_name, 'empreendimento', new.development, 'unidade', new.unit,
          'valor', coalesce(new.contract_value, a1_fin_num(new.payload->'proposta'->>'valor'), 0),
          'data', current_date), v_partes);
      elsif v_selo_velho = 'GANHO' and coalesce(v_selo_novo, '') <> 'GANHO' then
        select id into v_neg from a1_fin_negocios where tenant_id = new.tenant_id and origem = 'crm' and origem_id = new.id;
        if v_neg is not null then perform a1_fin_cancelar_interno(v_neg, 'O lead saiu da etapa Ganho'); end if;
      end if;
    elsif new.module_key in ('repasse', 'registro') then
      select * into v_cfg from a1_fin_config where tenant_id = new.tenant_id;
      if new.module_key = 'repasse' and v_cfg.etapa_repasse is not null and new.stage_id = v_cfg.etapa_repasse then
        v_fin := coalesce(a1_fin_num(new.payload->'valores'->>'valor_financiado'), 0);
        v_val := coalesce(a1_fin_num(new.payload->'valores'->>'valor_contrato'), new.contract_value, v_fin, 0);
        -- veio de uma venda com negócio: só marca a assinatura
        select id into v_neg from a1_fin_negocios
         where tenant_id = new.tenant_id and origem = 'comercial' and status = 'ativo'
           and origem_id = nullif(new.payload->>'comercial_id', '')::uuid;
        if v_neg is not null then
          update a1_fin_negocios set assinado_em = coalesce(assinado_em, current_date),
                 valor_financiado = coalesce(valor_financiado, nullif(v_fin, 0)), atualizado_em = now() where id = v_neg;
          perform a1_fin_liberar_negocio(v_neg);
        else
          select coalesce(jsonb_agg(x), '[]'::jsonb) into v_partes from (
            select a1_fin_part(new.tenant_id, 'corretor', null, new.broker_name) x
            union all select a1_fin_part(new.tenant_id, 'imobiliaria', null, new.real_estate_name)
            union all select a1_fin_part(new.tenant_id, 'analista', nullif(to_jsonb(new)->>'analista_id', '')::uuid, null)
            union all select a1_fin_part(new.tenant_id, 'cca', nullif(to_jsonb(new)->>'correspondente_id', '')::uuid, new.partner_name)) s
          where x is not null;
          perform a1_fin_registrar(new.tenant_id, 'repasse', new.id, jsonb_build_object(
            'descricao', concat_ws(' · ', new.client_name, nullif(concat_ws(' ', new.development, new.unit), '')),
            'cliente_nome', new.client_name, 'empreendimento', new.development, 'unidade', new.unit,
            'valor', v_val, 'valor_financiado', nullif(v_fin, 0), 'data', current_date, 'assinado_em', current_date), v_partes);
        end if;
      elsif new.module_key = 'registro' and v_cfg.etapa_registro is not null and new.stage_id = v_cfg.etapa_registro then
        perform a1_fin_registrar(new.tenant_id, 'registro', new.id, jsonb_build_object(
          'descricao', concat_ws(' · ', new.client_name, nullif(concat_ws(' ', new.development, new.unit), '')),
          'cliente_nome', new.client_name, 'empreendimento', new.development, 'unidade', new.unit,
          'valor', coalesce(new.contract_value, 0), 'data', current_date),
          coalesce((select jsonb_agg(x) from (select a1_fin_part(new.tenant_id, 'outro', null, new.manager_name) x) s where x is not null), '[]'::jsonb));
      end if;
    end if;
  exception when others then
    raise warning 'financeiro: não registrou o movimento do processo %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists a1_fin_de_case_t on a1_cases;
create trigger a1_fin_de_case_t after insert or update of stage_id on a1_cases
  for each row execute function a1_fin_de_case();

-- Venda (COMERCIAL): VENDIDO gera; FIM_NEGATIVO cancela.
create or replace function a1_fin_de_comercial()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_selo_novo text; v_selo_velho text; v_partes jsonb; v_neg uuid; v_emp text;
begin
  if tg_op = 'UPDATE' and new.situacao_id is not distinct from old.situacao_id then return null; end if;
  if not a1_fin_licenca(new.tenant_id) then return null; end if;
  begin
    select selo into v_selo_novo from a1_co_situacoes where id = new.situacao_id;
    if tg_op = 'UPDATE' then select selo into v_selo_velho from a1_co_situacoes where id = old.situacao_id; end if;
    if v_selo_novo = 'VENDIDO' and coalesce(v_selo_velho, '') <> 'VENDIDO' then
      begin
        execute 'select name from a1_developments where id = $1' into v_emp using new.empreendimento_id;
      exception when others then v_emp := null;
      end;
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_partes from (
        select a1_fin_part(new.tenant_id, 'corretor', new.corretor_id, null) x
        union all select a1_fin_part(new.tenant_id, 'imobiliaria', new.imobiliaria_id, null)
        union all select a1_fin_part(new.tenant_id, 'analista', new.analista_id, null)
        union all select a1_fin_part(new.tenant_id, 'cca', new.correspondente_id, null)
        union all select a1_fin_coord(new.tenant_id, new.corretor_id)) s where x is not null;
      perform a1_fin_registrar(new.tenant_id, 'comercial', new.id, jsonb_build_object(
        'descricao', concat_ws(' · ', coalesce(new.origem_snapshot->>'cliente_nome', new.origem_snapshot->'titular'->>'nome', new.codigo),
                               nullif(concat_ws(' ', v_emp, new.unidade), '')),
        'cliente_nome', coalesce(new.origem_snapshot->>'cliente_nome', new.origem_snapshot->'titular'->>'nome'),
        'empreendimento', v_emp, 'unidade', new.unidade,
        'valor', coalesce(a1_fin_num(new.proposta->>'valor_venda') / 100, 0),
        'valor_financiado', nullif(coalesce(a1_fin_num(new.origem_snapshot->'credito'->>'valor_aprovado'), 0), 0) / 100,
        'data', current_date), v_partes);
    elsif v_selo_velho = 'VENDIDO' and coalesce(v_selo_novo, '') <> 'VENDIDO' then
      select id into v_neg from a1_fin_negocios where tenant_id = new.tenant_id and origem = 'comercial' and origem_id = new.id;
      if v_neg is not null then perform a1_fin_cancelar_interno(v_neg, 'A venda saiu de Vendido'); end if;
    end if;
  exception when others then
    raise warning 'financeiro: não registrou a venda %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists a1_fin_de_comercial_t on a1_comerciais;
create trigger a1_fin_de_comercial_t after insert or update of situacao_id on a1_comerciais
  for each row execute function a1_fin_de_comercial();

-- Locação: taxa de administração de cada repasse ao proprietário vira receita
-- recebida (na data do pagamento da cobrança). Estorno da cobrança apaga.
create or replace function a1_fin_de_locacao()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_pago date; v_cfg a1_fin_config; v_desc text;
begin
  if tg_op = 'DELETE' then
    delete from a1_fin_lancamentos where origem = 'locacao' and origem_id = old.id;
    return null;
  end if;
  if not a1_fin_licenca(new.tenant_id) or coalesce(new.taxa_adm, 0) <= 0 then return null; end if;
  begin
    perform a1_fin_preparar_tenant(new.tenant_id);
    select * into v_cfg from a1_fin_config where tenant_id = new.tenant_id;
    select b.pago_em into v_pago from a1_lc_cobrancas b where b.id = new.cobranca_id;
    select left(format('Taxa de administração · %s', coalesce(p.nome, '')), 200) into v_desc
      from a1_lc_pessoas p where p.id = new.proprietario_id;
    insert into a1_fin_lancamentos (tenant_id, tipo, descricao, categoria_id, conta_id, valor, vencimento, competencia, status,
                                    pago_em, valor_pago, origem, origem_id)
    values (new.tenant_id, 'receber', coalesce(v_desc, 'Taxa de administração'), a1_fin_categoria(new.tenant_id, 'taxa_adm'),
            v_cfg.conta_padrao, new.taxa_adm, coalesce(v_pago, current_date), date_trunc('month', coalesce(v_pago, current_date))::date,
            'pago', coalesce(v_pago, current_date), new.taxa_adm, 'locacao', new.id)
    on conflict (origem_id) where origem = 'locacao' do nothing;
  exception when others then
    raise warning 'financeiro: não lançou a taxa de administração do repasse %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists a1_fin_de_locacao_t on a1_lc_repasses;
create trigger a1_fin_de_locacao_t after insert or delete on a1_lc_repasses
  for each row execute function a1_fin_de_locacao();

-- ── Funções da tela ─────────────────────────────────────────────────────────
-- Negócio à mão (ou edição de um existente): dados + participantes; recalcula.
create or replace function a1_fin_salvar_negocio(p_id uuid, p_dados jsonb, p_participantes jsonb)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_t uuid := a1_tenant(); v_id uuid := p_id; p jsonb; v_qtd int;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  if coalesce((p_dados->>'valor')::numeric, -1) < 0 then raise exception 'valor_invalido'; end if;
  if v_id is null then
    insert into a1_fin_negocios (tenant_id, origem) values (v_t, 'manual') returning id into v_id;
  else
    perform 1 from a1_fin_negocios where id = v_id and tenant_id = v_t and status = 'ativo' for update;
    if not found then raise exception 'negocio_nao_encontrado'; end if;
    if exists (select 1 from a1_fin_comissoes where negocio_id = v_id and valor_pago > 0)
       or exists (select 1 from a1_fin_lancamentos where negocio_id = v_id and status = 'pago') then
      raise exception 'negocio_com_pagamento';
    end if;
  end if;
  update a1_fin_negocios set
    descricao = left(nullif(btrim(p_dados->>'descricao'), ''), 200),
    cliente_nome = left(nullif(btrim(p_dados->>'cliente_nome'), ''), 160),
    empreendimento = left(nullif(btrim(p_dados->>'empreendimento'), ''), 160),
    unidade = left(nullif(btrim(p_dados->>'unidade'), ''), 60),
    valor = (p_dados->>'valor')::numeric,
    valor_financiado = nullif(p_dados->>'valor_financiado', '')::numeric,
    data = coalesce(nullif(p_dados->>'data', '')::date, data),
    atualizado_em = now()
   where id = v_id;
  delete from a1_fin_participantes where negocio_id = v_id;
  for p in select * from jsonb_array_elements(coalesce(p_participantes, '[]'::jsonb)) loop
    continue when coalesce(btrim(p->>'nome'), '') = '' and (p->>'partner_id') is null;
    if (p->>'partner_id') is not null and not exists (select 1 from a1_partners where id = (p->>'partner_id')::uuid and tenant_id = v_t) then
      raise exception 'referencia_de_outro_cliente';
    end if;
    insert into a1_fin_participantes (tenant_id, negocio_id, papel, partner_id, nome)
    values (v_t, v_id, p->>'papel', nullif(p->>'partner_id', '')::uuid,
            left(coalesce(nullif(btrim(p->>'nome'), ''), (select name from a1_partners where id = (p->>'partner_id')::uuid)), 160));
  end loop;
  v_qtd := a1_fin_calcular(v_id);
  return json_build_object('ok', true, 'id', v_id, 'comissoes', v_qtd);
end $$;

create or replace function a1_fin_recalcular(p_negocio uuid)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  if not exists (select 1 from a1_fin_negocios where id = p_negocio and tenant_id = a1_tenant() and status = 'ativo') then
    raise exception 'negocio_nao_encontrado';
  end if;
  return json_build_object('ok', true, 'comissoes', a1_fin_calcular(p_negocio));
end $$;

create or replace function a1_fin_cancelar_negocio(p_negocio uuid, p_motivo text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'motivo_obrigatorio'; end if;
  if not exists (select 1 from a1_fin_negocios where id = p_negocio and tenant_id = a1_tenant() and status = 'ativo') then
    raise exception 'negocio_nao_encontrado';
  end if;
  return json_build_object('ok', true, 'comissoes_pagas', a1_fin_cancelar_interno(p_negocio, btrim(p_motivo)));
end $$;

-- Libera manualmente o restante de uma comissão a pagar.
create or replace function a1_fin_liberar_comissao(p_comissao uuid)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare c a1_fin_comissoes; n a1_fin_negocios; v_dif numeric;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  select * into c from a1_fin_comissoes where id = p_comissao and tenant_id = a1_tenant() for update;
  if c.id is null or c.direcao <> 'pagar' or c.status = 'cancelada' then raise exception 'comissao_invalida'; end if;
  select * into n from a1_fin_negocios where id = c.negocio_id;
  v_dif := c.valor - c.valor_liberado;
  if v_dif <= 0 then raise exception 'comissao_ja_liberada'; end if;
  insert into a1_fin_lancamentos (tenant_id, tipo, descricao, categoria_id, valor, vencimento, competencia, pessoa, partner_id,
                                  negocio_id, comissao_id, origem)
  values (c.tenant_id, 'pagar', left(format('Comissão %s NG-%s · %s', c.papel, lpad(n.seq::text, 4, '0'), c.beneficiario), 200),
          a1_fin_categoria(c.tenant_id, 'comissao_paga'), v_dif, current_date, date_trunc('month', n.data)::date,
          c.beneficiario, c.partner_id, n.id, c.id, 'comissao');
  -- liberação manual vira "na venda" para o recálculo de liberação não desfazer
  update a1_fin_comissoes set valor_liberado = valor, liberacao = 'venda', status = 'liberada', atualizado_em = now() where id = c.id;
  return json_build_object('ok', true, 'valor', v_dif);
end $$;

-- Baixa (paga/recebe). Valor menor que o do lançamento: baixa parcial, o resto
-- vira um lançamento novo em aberto.
create or replace function a1_fin_baixar(p_lancamento uuid, p_pago_em date, p_valor numeric, p_conta uuid, p_forma text, p_versao int)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare l a1_fin_lancamentos; v_resto uuid;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  if p_pago_em is null or p_pago_em > current_date + 1 then raise exception 'data_invalida'; end if;
  select * into l from a1_fin_lancamentos where id = p_lancamento and tenant_id = a1_tenant() for update;
  if l.id is null then raise exception 'lancamento_nao_encontrado'; end if;
  if l.status <> 'aberto' then raise exception 'lancamento_nao_aberto'; end if;
  if l.versao <> p_versao then raise exception 'versao_desatualizada'; end if;
  if p_valor is null or p_valor <= 0 or p_valor > l.valor then raise exception 'valor_invalido'; end if;
  if p_conta is not null and not exists (select 1 from a1_fin_contas where id = p_conta and tenant_id = l.tenant_id) then
    raise exception 'referencia_de_outro_cliente';
  end if;
  if p_forma is not null and p_forma not in ('pix', 'boleto', 'transferencia', 'dinheiro', 'cartao', 'cheque', 'outro') then
    raise exception 'forma_invalida';
  end if;
  if p_valor < l.valor then
    insert into a1_fin_lancamentos (tenant_id, tipo, descricao, categoria_id, valor, vencimento, competencia, pessoa, partner_id,
                                    negocio_id, comissao_id, origem, origem_id, grupo_id, parcela, parcelas, observacao)
    values (l.tenant_id, l.tipo, l.descricao, l.categoria_id, l.valor - p_valor, l.vencimento, l.competencia, l.pessoa, l.partner_id,
            l.negocio_id, l.comissao_id, l.origem, l.origem_id, l.grupo_id, l.parcela, l.parcelas, l.observacao)
    returning id into v_resto;
  end if;
  update a1_fin_lancamentos set status = 'pago', pago_em = p_pago_em, valor_pago = p_valor, valor = p_valor,
         conta_id = coalesce(p_conta, conta_id, (select conta_padrao from a1_fin_config where tenant_id = l.tenant_id)),
         forma = p_forma, versao = versao + 1, atualizado_em = now()
   where id = l.id;
  perform a1_fin_apos_baixa(l.comissao_id);
  return json_build_object('ok', true, 'resto_id', v_resto);
end $$;

-- Atualiza a comissão depois de mexer num pagamento dela.
create or replace function a1_fin_apos_baixa(p_comissao uuid)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare c a1_fin_comissoes; v_pago numeric;
begin
  if p_comissao is null then return; end if;
  select * into c from a1_fin_comissoes where id = p_comissao for update;
  if c.id is null then return; end if;
  select coalesce(sum(valor_pago), 0) into v_pago from a1_fin_lancamentos where comissao_id = c.id and status = 'pago';
  update a1_fin_comissoes set valor_pago = v_pago,
         status = case when c.status = 'cancelada' then 'cancelada'
                       when v_pago >= c.valor then 'paga'
                       when c.valor_liberado > 0 then 'liberada' else 'prevista' end,
         atualizado_em = now()
   where id = c.id;
  -- recebimento da empresa libera (ou recolhe) o que é "ao receber"
  if c.direcao = 'receber' then perform a1_fin_liberar_negocio(c.negocio_id); end if;
end $$;
revoke all on function a1_fin_apos_baixa(uuid) from public, anon, authenticated;

create or replace function a1_fin_estornar(p_lancamento uuid, p_versao int)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare l a1_fin_lancamentos;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  select * into l from a1_fin_lancamentos where id = p_lancamento and tenant_id = a1_tenant() for update;
  if l.id is null then raise exception 'lancamento_nao_encontrado'; end if;
  if l.status <> 'pago' then raise exception 'lancamento_nao_pago'; end if;
  if l.versao <> p_versao then raise exception 'versao_desatualizada'; end if;
  if l.origem = 'locacao' then raise exception 'estorne_na_locacao'; end if;
  update a1_fin_lancamentos set status = 'aberto', pago_em = null, valor_pago = null, versao = versao + 1, atualizado_em = now()
   where id = l.id;
  perform a1_fin_apos_baixa(l.comissao_id);
  return json_build_object('ok', true);
end $$;

create or replace function a1_fin_cancelar_lancamento(p_lancamento uuid, p_versao int)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare l a1_fin_lancamentos;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  select * into l from a1_fin_lancamentos where id = p_lancamento and tenant_id = a1_tenant() for update;
  if l.id is null then raise exception 'lancamento_nao_encontrado'; end if;
  if l.status <> 'aberto' then raise exception 'lancamento_nao_aberto'; end if;
  if l.versao <> p_versao then raise exception 'versao_desatualizada'; end if;
  if l.origem <> 'manual' then raise exception 'lancamento_do_sistema'; end if;
  update a1_fin_lancamentos set status = 'cancelado', versao = versao + 1, atualizado_em = now() where id = l.id;
  return json_build_object('ok', true);
end $$;

-- Regras-modelo pelo tipo do cliente (só quando ainda não há regra).
create or replace function a1_fin_regras_modelo()
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_t uuid := a1_tenant(); v_tipo text; v_n int;
begin
  if not a1_fin_pode() then raise exception 'sem_permissao'; end if;
  if exists (select 1 from a1_fin_regras where tenant_id = v_t) then raise exception 'ja_tem_regras'; end if;
  select tipo_cliente into v_tipo from a1_tenants where id = v_t;
  insert into a1_fin_regras (tenant_id, nome, direcao, papel, base, tipo_calculo, percentual, valor_fixo, liberacao, pagador, origem)
  select v_t, r.nome, r.direcao, r.papel, r.base, r.tipo, r.pct, r.fixo, r.lib, r.pagador, r.origem from (values
    -- imobiliária: recebe da construtora/vendedor e divide com o time
    ('imobiliaria', 'Comissão da imobiliária (5% da venda)', 'receber', 'empresa', 'valor', 'percentual', 5::numeric, null::numeric, 'recebimento', 'Construtora / vendedor', 'todas'),
    ('imobiliaria', 'Corretor: 40% da comissão da imobiliária', 'pagar', 'corretor', 'comissao_empresa', 'percentual', 40, null, 'recebimento', null, 'todas'),
    ('imobiliaria', 'Captador: 10% da comissão da imobiliária', 'pagar', 'captador', 'comissao_empresa', 'percentual', 10, null, 'recebimento', null, 'todas'),
    ('imobiliaria', 'Coordenador: 5% da comissão da imobiliária', 'pagar', 'coordenador', 'comissao_empresa', 'percentual', 5, null, 'recebimento', null, 'todas'),
    -- construtora: paga imobiliária e corretor parceiros sobre a venda
    ('construtora', 'Imobiliária parceira: 4% da venda', 'pagar', 'imobiliaria', 'valor', 'percentual', 4, null, 'assinatura', null, 'todas'),
    ('construtora', 'Corretor: 1,5% da venda', 'pagar', 'corretor', 'valor', 'percentual', 1.5, null, 'assinatura', null, 'todas'),
    -- correspondente: recebe do banco sobre o financiado
    ('correspondente_bancario', 'Comissão bancária (1% do financiado)', 'receber', 'empresa', 'valor_financiado', 'percentual', 1, null, 'recebimento', 'Banco', 'todas'),
    ('correspondente_bancario', 'CCA: 30% da comissão bancária', 'pagar', 'cca', 'comissao_empresa', 'percentual', 30, null, 'recebimento', null, 'todas'),
    ('correspondente_bancario', 'Corretor/indicação: 20% da comissão bancária', 'pagar', 'corretor', 'comissao_empresa', 'percentual', 20, null, 'recebimento', null, 'todas'),
    ('correspondente_bancario', 'Analista: R$ 150 por contrato', 'pagar', 'analista', 'valor', 'fixo', null, 150, 'recebimento', null, 'todas'),
    -- despachante: honorários por processo
    ('despachante', 'Honorários do registro (R$ 1.500)', 'receber', 'empresa', 'valor', 'fixo', null, 1500, 'recebimento', 'Cliente', 'todas'),
    ('despachante', 'Indicador: 10% dos honorários', 'pagar', 'indicador', 'comissao_empresa', 'percentual', 10, null, 'recebimento', null, 'todas')
  ) r(tipo_cliente, nome, direcao, papel, base, tipo, pct, fixo, lib, pagador, origem)
  where r.tipo_cliente = coalesce(v_tipo, 'imobiliaria');
  get diagnostics v_n = row_count;
  return json_build_object('ok', true, 'regras', v_n, 'tipo', coalesce(v_tipo, 'imobiliaria'));
end $$;

-- Extrato do parceiro: só as comissões a pagar dele.
create or replace function a1_fin_minhas_comissoes()
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare v_ator uuid := a1_ator();
begin
  if a1_tenant() is null or v_ator is null or not a1_tem_modulo('financeiro') then raise exception 'sem_permissao'; end if;
  return coalesce((select json_agg(json_build_object(
      'id', c.id, 'negocio', 'NG-' || lpad(n.seq::text, 4, '0'), 'descricao', n.descricao, 'data', n.data,
      'papel', c.papel, 'regra', c.regra_nome, 'base_valor', c.base_valor, 'percentual', c.percentual, 'valor', c.valor,
      'liberacao', c.liberacao, 'status', c.status, 'valor_liberado', c.valor_liberado, 'valor_pago', c.valor_pago,
      'negocio_status', n.status) order by n.data desc, n.seq desc)
    from a1_fin_comissoes c join a1_fin_negocios n on n.id = c.negocio_id
   where c.tenant_id = a1_tenant() and c.direcao = 'pagar' and c.partner_id = v_ator), '[]'::json);
end $$;

do $$
declare f text;
begin
  foreach f in array array['a1_fin_iniciar()', 'a1_fin_salvar_negocio(uuid, jsonb, jsonb)', 'a1_fin_recalcular(uuid)',
    'a1_fin_cancelar_negocio(uuid, text)', 'a1_fin_liberar_comissao(uuid)',
    'a1_fin_baixar(uuid, date, numeric, uuid, text, int)', 'a1_fin_estornar(uuid, int)', 'a1_fin_cancelar_lancamento(uuid, int)',
    'a1_fin_regras_modelo()', 'a1_fin_minhas_comissoes()'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- COMO CONFERIR
--   select key from a1_modules where key = 'financeiro';                       -- 1 linha
--   select count(*) from a1_tenant_modules where module_key = 'financeiro';    -- 0 até liberar
--   select tgname from pg_trigger where tgname like 'a1_fin_%';               -- gatilhos
-- ════════════════════════════════════════════════════════════════════════════
