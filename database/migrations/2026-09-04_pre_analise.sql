-- =============================================================================
-- MÓDULO PRÉ-ANÁLISE — tabelas, esteira e autorização
--
-- Nasce DESLIGADO. Toda política aqui começa por a1_tem_modulo('PRE_ANALISE'):
-- enquanto o superadmin não liberar o módulo para o cliente, estas tabelas não
-- devolvem uma linha sequer para ele. Não é a tela que esconde — é o banco que
-- não entrega.
--
-- A DIFERENÇA PARA O RESTO DO SISTEMA
-- No Repasse, "cada um vê o que é seu" é decidido no navegador. Aqui a regra
-- está na política de RLS: gestor e gerente veem a carteira do cliente;
-- corretor vê o que é dele; correspondente vê o da própria empresa. Quem pedir
-- direto à API, com token válido e a chave pública, recebe só a própria fatia.
--
-- Depende de: sql/2026-09-04_identidade.sql
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;
create extension if not exists pgcrypto;

-- ─── Pessoas ─────────────────────────────────────────────────────────────────
-- Cadastro próprio do módulo, com CPF/CNPJ guardado só em dígitos e indexado
-- para a busca de duplicidade. Nome e documento são dado pessoal: quem lê é
-- controlado pela mesma política das pré-análises em que a pessoa aparece.
create table if not exists a1_pa_pessoas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  tipo          text not null default 'PF' check (tipo in ('PF','PJ')),
  documento     text,                       -- só dígitos; CPF ou CNPJ
  nome          text not null,
  nascimento    date,
  estado_civil  text,
  email         text,
  telefone      text,
  endereco      jsonb not null default '{}'::jsonb,
  estrangeiro   boolean not null default false,
  doc_estrangeiro text,
  criado_em     timestamptz not null default now(),
  criado_por    uuid,
  atualizado_em timestamptz not null default now()
);
create unique index if not exists idx_pa_pessoa_doc
  on a1_pa_pessoas (tenant_id, documento) where documento is not null and documento <> '';
create index if not exists idx_pa_pessoa_nome on a1_pa_pessoas (tenant_id, lower(nome));

-- ─── Esteira ─────────────────────────────────────────────────────────────────
-- Situações e transições por cliente. A flag classifica o estado; a AÇÃO é que
-- provoca efeito. Misturar as duas é como um "status" acabar criando registro
-- em outro módulo sem ninguém pedir.
create table if not exists a1_pa_situacoes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  nome       text not null,
  flag       text check (flag in ('INICIAL','APROVADO','REPROVADO','PENDENTE',
                                  'VENCIDO','CANCELADO','ENCERRADO')),
  ordem      int  not null default 0,
  cor        text,
  sla_horas  int,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
create index if not exists idx_pa_sit_tenant on a1_pa_situacoes (tenant_id, ordem);

create table if not exists a1_pa_transicoes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  de_id      uuid references a1_pa_situacoes(id) on delete cascade,   -- null = de qualquer
  para_id    uuid not null references a1_pa_situacoes(id) on delete cascade,
  papeis     text[] not null default '{}',   -- vazio = qualquer papel autorizado
  requisitos jsonb not null default '{}'::jsonb,
  acao       text check (acao in ('ENABLE_COMMERCIAL')),
  acao_modo  text not null default 'CONFIRMAR' check (acao_modo in ('AUTO','CONFIRMAR')),
  ativo      boolean not null default true
);
create index if not exists idx_pa_tr_tenant on a1_pa_transicoes (tenant_id, de_id);

-- ─── A pré-análise ───────────────────────────────────────────────────────────
create table if not exists a1_pre_analises (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  codigo         text,
  empreendimento_id uuid not null,
  unidade        text,                       -- 0..1 e NÃO reserva estoque
  lead_id        uuid,
  corretor_id    uuid,                       -- a1_partners.id
  imobiliaria_id uuid,
  correspondente_id uuid,
  empresa_id     uuid,                       -- empresa correspondente, p/ escopo
  situacao_id    uuid references a1_pa_situacoes(id),
  -- Quando ENTROU na situação atual. O SLA da fila se mede a partir daqui, e
  -- não da criação: um processo pode estar há 40 dias na esteira e há 2 horas
  -- na etapa que está atrasando. Quem cuida da coluna é o orquestrador.
  situacao_em    timestamptz not null default now(),
  versao         int  not null default 1,
  vence_em       timestamptz,
  criado_por     uuid,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists idx_pa_tenant_sit on a1_pre_analises (tenant_id, situacao_id);
create index if not exists idx_pa_corretor   on a1_pre_analises (tenant_id, corretor_id);
create index if not exists idx_pa_empresa    on a1_pre_analises (tenant_id, empresa_id);
create index if not exists idx_pa_vence      on a1_pre_analises (tenant_id, vence_em);
-- Para quem já rodou a versão anterior deste arquivo.
alter table a1_pre_analises add column if not exists situacao_em timestamptz not null default now();

-- Titular e associados. O titular é único e a troca fica registrada.
create table if not exists a1_pa_participantes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  pre_analise_id  uuid not null references a1_pre_analises(id) on delete cascade,
  pessoa_id       uuid not null references a1_pa_pessoas(id),
  papel           text not null check (papel in ('TITULAR','ASSOCIADO')),
  participacao    numeric(5,2),
  renda_declarada bigint,                    -- centavos
  renda_analisada bigint,
  fonte_renda     text,
  criado_em       timestamptz not null default now()
);
-- Um titular por pré-análise. O índice é a garantia; a tela é conveniência.
create unique index if not exists idx_pa_um_titular
  on a1_pa_participantes (pre_analise_id) where papel = 'TITULAR';
create index if not exists idx_pa_part_pa on a1_pa_participantes (pre_analise_id);

-- Decisão de crédito, versionada. Decisão não se edita: cria-se outra versão.
create table if not exists a1_pa_analises_credito (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  pre_analise_id uuid not null references a1_pre_analises(id) on delete cascade,
  versao         int  not null default 1,
  status         text not null default 'EM_ANALISE'
                 check (status in ('EM_ANALISE','APROVADO','REPROVADO','PENDENTE','INVALIDADA')),
  decisor_id     uuid,
  motivo         text,
  justificativa  text,
  renda_familiar bigint,
  valor_fgts     bigint,
  valor_subsidio bigint,
  valor_aprovado bigint,
  valor_avaliacao bigint,
  valor_total    bigint,
  prestacao      bigint,
  prazo_meses    int,
  decidido_em    timestamptz,
  criado_em      timestamptz not null default now(),
  -- Regra publicada pelo CVCRM e que vale para qualquer financiamento: o total
  -- é a soma das três fontes. Só cobra quando as quatro estão preenchidas.
  constraint a1_pa_soma_credito check (
    valor_total is null or valor_aprovado is null
    or valor_subsidio is null or valor_fgts is null
    or valor_total = valor_aprovado + valor_subsidio + valor_fgts)
);
create unique index if not exists idx_pa_credito_versao
  on a1_pa_analises_credito (pre_analise_id, versao);

-- Dossiê. O arquivo mora no Storage; aqui ficam chave, hash e situação.
create table if not exists a1_pa_documentos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  pre_analise_id uuid not null references a1_pre_analises(id) on delete cascade,
  pessoa_id      uuid references a1_pa_pessoas(id),
  tipo           text not null,
  storage_key    text not null,
  nome_arquivo   text,
  mime           text,
  hash           text,
  versao         int  not null default 1,
  status         text not null default 'ENVIADO'
                 check (status in ('PENDENTE_ENVIO','ENVIADO','EM_VALIDACAO',
                                   'APROVADO','REPROVADO','SUBSTITUIDO')),
  motivo         text,
  enviado_por    uuid,
  analisado_por  uuid,
  analisado_em   timestamptz,
  criado_em      timestamptz not null default now()
);
create index if not exists idx_pa_doc_pa on a1_pa_documentos (pre_analise_id, status);

-- Histórico. Só acrescenta: sem update, sem delete, nem para o dono do banco
-- pela API. É a trilha que sustenta qualquer discussão sobre uma decisão.
create table if not exists a1_pa_eventos (
  id             bigserial primary key,
  tenant_id      uuid not null,
  pre_analise_id uuid not null references a1_pre_analises(id) on delete cascade,
  evento         text not null,
  de_situacao    uuid,
  para_situacao  uuid,
  ator_id        uuid,
  ator_nome      text,
  detalhe        jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now()
);
create index if not exists idx_pa_ev_pa on a1_pa_eventos (pre_analise_id, criado_em desc);

-- =============================================================================
-- AUTORIZAÇÃO
--
-- Uma função só decide quem enxerga o quê, e todas as políticas a chamam. Fica
-- num lugar só: mudar a regra é mudar aqui, e não em sete políticas parecidas.
-- =============================================================================
create or replace function a1_pa_visivel(p_corretor uuid, p_empresa uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    -- Gestor e gerente enxergam a carteira inteira do próprio cliente.
    when a1_e_gestor() then true
    when a1_perm('gerente') then true
    -- Visão completa marcada no cadastro — é como o coordenador enxerga a
    -- equipe. Repare que o sistema antigo trata a AUSÊNCIA desta chave como
    -- "vê tudo"; aqui, ausente é "não vê". Módulo novo não herda um padrão
    -- aberto: quem precisa de visão ampla recebe a marca explicitamente.
    when a1_perm('ver_todos_analistas') then true
    -- Correspondente enxerga o da própria empresa.
    when a1_tipo_ator() = 'cca' and p_empresa is not null
         and p_empresa = a1_empresa_ator() then true
    -- Os demais enxergam o que é deles. Sem "ausente = vê tudo": aqui, o que
    -- não está explicitamente liberado fica fechado.
    when p_corretor is not null and p_corretor = a1_ator() then true
    else false
  end;
$$;
grant execute on function a1_pa_visivel(uuid, uuid) to anon, authenticated;

alter table a1_pa_pessoas           enable row level security;
alter table a1_pa_situacoes         enable row level security;
alter table a1_pa_transicoes        enable row level security;
alter table a1_pre_analises         enable row level security;
alter table a1_pa_participantes     enable row level security;
alter table a1_pa_analises_credito  enable row level security;
alter table a1_pa_documentos        enable row level security;
alter table a1_pa_eventos           enable row level security;

do $$
declare t text;
begin
  foreach t in array array['a1_pa_pessoas','a1_pa_situacoes','a1_pa_transicoes',
                           'a1_pre_analises','a1_pa_participantes',
                           'a1_pa_analises_credito','a1_pa_documentos','a1_pa_eventos']
  loop
    execute format('drop policy if exists %I on %I', t || '_rls', t);
    execute format('drop policy if exists %I on %I', t || '_ler', t);
    execute format('drop policy if exists %I on %I', t || '_escrever', t);
    execute format('drop policy if exists %I on %I', t || '_criar', t);
    execute format('drop policy if exists %I on %I', t || '_editar', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select, insert, update on %I to anon, authenticated', t);
  end loop;
end $$;

-- Configuração da esteira: todo mundo do cliente lê (a tela precisa dos nomes),
-- só gestor escreve.
create policy a1_pa_situacoes_ler on a1_pa_situacoes for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));
create policy a1_pa_situacoes_escrever on a1_pa_situacoes for all
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE') and a1_e_gestor())
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE') and a1_e_gestor());

create policy a1_pa_transicoes_ler on a1_pa_transicoes for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));
create policy a1_pa_transicoes_escrever on a1_pa_transicoes for all
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE') and a1_e_gestor())
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE') and a1_e_gestor());

-- A pré-análise: o filtro por pessoa mora aqui.
create policy a1_pre_analises_ler on a1_pre_analises for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_pa_visivel(corretor_id, empresa_id));
create policy a1_pre_analises_criar on a1_pre_analises for insert
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
              and a1_perm('criar_repasses'));
create policy a1_pre_analises_editar on a1_pre_analises for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_pa_visivel(corretor_id, empresa_id) and a1_perm('editar_repasses'))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));

-- Filhas: enxergam-se pela pré-análise a que pertencem. Sem repetir a regra.
do $$
declare t text;
begin
  foreach t in array array['a1_pa_participantes','a1_pa_documentos']
  loop
    execute format($f$
      create policy %I on %I for select using (
        tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
        and exists (select 1 from a1_pre_analises pa
                     where pa.id = %I.pre_analise_id
                       and a1_pa_visivel(pa.corretor_id, pa.empresa_id)))$f$,
      t || '_ler', t, t);
    execute format($f$
      create policy %I on %I for all using (
        tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
        and a1_perm('editar_repasses')
        and exists (select 1 from a1_pre_analises pa
                     where pa.id = %I.pre_analise_id
                       and a1_pa_visivel(pa.corretor_id, pa.empresa_id)))
      with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'))$f$,
      t || '_escrever', t, t);
  end loop;
end $$;

-- ─── Decisão de crédito: quem vende não aprova ───────────────────────────────
-- Esta tabela ficava na regra geral, e a regra geral é "quem edita a pré-análise
-- edita as filhas". O efeito era que o corretor dono do processo podia inserir
-- ele mesmo uma linha APROVADO e, com ela, destravar o Comercial — a aprovação
-- de crédito, que é o portão do fluxo inteiro, ficava do lado de dentro do
-- portão. Agora exige 'analisar_credito', que gestor e gerente já têm por
-- definição e que o cliente concede a quem de fato analisa.
create policy a1_pa_analises_credito_ler on a1_pa_analises_credito for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and exists (select 1 from a1_pre_analises pa
                      where pa.id = a1_pa_analises_credito.pre_analise_id
                        and a1_pa_visivel(pa.corretor_id, pa.empresa_id)));
create policy a1_pa_analises_credito_escrever on a1_pa_analises_credito for all
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_perm('analisar_credito')
         and exists (select 1 from a1_pre_analises pa
                      where pa.id = a1_pa_analises_credito.pre_analise_id
                        and a1_pa_visivel(pa.corretor_id, pa.empresa_id)))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
              and a1_perm('analisar_credito'));

-- Mesma lógica no dossiê: qualquer um envia o documento, só quem analisa dá o
-- veredito. Sem isto, uma transição que exige "documentos aprovados" seria
-- satisfeita por quem enviou os documentos.
create or replace function a1_pa_guarda_documento()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if new.status in ('APROVADO','REPROVADO')
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and not a1_perm('analisar_credito') then
    raise exception 'sem_permissao_para_analisar_documento';
  end if;
  return new;
end $$;
drop trigger if exists trg_pa_doc_guarda on a1_pa_documentos;
create trigger trg_pa_doc_guarda before insert or update on a1_pa_documentos
  for each row execute function a1_pa_guarda_documento();

-- ─── O que o navegador pode reescrever numa pré-análise ──────────────────────
-- A política de UPDATE dizia apenas "é do seu cliente e é seu". Isso deixava o
-- PATCH direto reescrever situacao_id — ou seja, pular a esteira inteira:
-- sem checar a aresta, sem checar o papel, sem gravar histórico e sem disparar
-- (nem barrar) a ação ligada à transição. Mover situação é ato do orquestrador.
create or replace function a1_pa_guarda_update()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_nao_muda';
  end if;
  if not a1_no_orquestrador() then
    if new.situacao_id is distinct from old.situacao_id then
      raise exception 'situacao_so_muda_por_transicao';
    end if;
    if new.versao is distinct from old.versao then
      raise exception 'versao_e_do_sistema';
    end if;
    if new.situacao_em is distinct from old.situacao_em then
      raise exception 'relogio_do_sla_e_do_sistema';
    end if;
    -- Passar o processo para outro corretor é ato de quem manda na carteira,
    -- não do corretor que quer se livrar dele nem de quem quer puxá-lo.
    if (new.corretor_id is distinct from old.corretor_id
        or new.empresa_id is distinct from old.empresa_id)
       and not (a1_e_gestor() or a1_perm('gerente')) then
      raise exception 'redistribuir_carteira_e_do_gestor';
    end if;
  end if;
  if new.situacao_id is distinct from old.situacao_id then
    new.situacao_em := now();
  end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists trg_pa_guarda on a1_pre_analises;
create trigger trg_pa_guarda before update on a1_pre_analises
  for each row execute function a1_pa_guarda_update();

-- E na criação: o dono é quem criou, decidido aqui e não pelo formulário.
-- Se a tela pudesse escolher, bastava um corretor mandar o POST com o
-- corretor_id de um colega para plantar processo na carteira alheia — ou
-- deixar o campo em branco e criar um processo que ele mesmo não enxerga.
create or replace function a1_pa_guarda_insert()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
declare v_tenant uuid := a1_tenant(); v_ator uuid := a1_ator();
begin
  -- Sem sessão (importação pela chave de serviço, carga de migração) não há
  -- o que forçar: respeita o que veio. Toda chamada vinda do navegador TEM
  -- sessão, então para ela a regra abaixo vale sempre.
  if v_tenant is not null then new.tenant_id := v_tenant; end if;
  if v_ator   is not null then
    new.criado_por := v_ator;
    if not (a1_e_gestor() or a1_perm('gerente')) then
      new.corretor_id := v_ator;
      new.empresa_id  := coalesce(a1_empresa_ator(), new.empresa_id);
    elsif new.corretor_id is null then
      new.corretor_id := v_ator;
    end if;
  end if;
  new.situacao_em := now();
  -- Situação inicial da esteira do cliente, se a tela não mandou nenhuma.
  if new.situacao_id is null then
    select id into new.situacao_id from a1_pa_situacoes
     where tenant_id = new.tenant_id and ativo and flag = 'INICIAL'
     order by ordem limit 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_pa_guarda_ins on a1_pre_analises;
create trigger trg_pa_guarda_ins before insert on a1_pre_analises
  for each row execute function a1_pa_guarda_insert();

-- Pessoas: só aparecem para quem enxerga alguma pré-análise em que ela entra.
-- Sem isso, a lista de pessoas seria uma agenda da empresa inteira aberta a
-- qualquer corretor.
create policy a1_pa_pessoas_ler on a1_pa_pessoas for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and (a1_e_gestor() or a1_perm('gerente')
              or exists (select 1 from a1_pa_participantes pp
                          join a1_pre_analises pa on pa.id = pp.pre_analise_id
                         where pp.pessoa_id = a1_pa_pessoas.id
                           and a1_pa_visivel(pa.corretor_id, pa.empresa_id))));
-- E a escrita é declarada por comando, NÃO com um FOR ALL.
--
-- Aqui estava o furo que a prova pegou: um "for all using (…criar_repasses…)"
-- parece falar só de escrita, mas no Postgres FOR ALL também vale para SELECT, e
-- as políticas se somam com OU. O resultado era que a política de leitura acima,
-- cuidadosamente restrita, era contornada pela de escrita logo abaixo dela:
-- qualquer corretor com permissão de criar via a agenda inteira do cliente —
-- nome, CPF, telefone e endereço de todo cliente da concorrência interna.
-- Escrever e ler são autorizações diferentes e agora estão escritas separadas.
create policy a1_pa_pessoas_criar on a1_pa_pessoas for insert
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
              and a1_perm('criar_repasses'));
create policy a1_pa_pessoas_editar on a1_pa_pessoas for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_perm('criar_repasses')
         and (a1_e_gestor() or a1_perm('gerente')
              or exists (select 1 from a1_pa_participantes pp
                          join a1_pre_analises pa on pa.id = pp.pre_analise_id
                         where pp.pessoa_id = a1_pa_pessoas.id
                           and a1_pa_visivel(pa.corretor_id, pa.empresa_id))))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));

-- Histórico: lê quem enxerga a pré-análise; ninguém altera nem apaga.
create policy a1_pa_eventos_ler on a1_pa_eventos for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and exists (select 1 from a1_pre_analises pa
                      where pa.id = a1_pa_eventos.pre_analise_id
                        and a1_pa_visivel(pa.corretor_id, pa.empresa_id)));
revoke update, delete on a1_pa_eventos from anon, authenticated;

-- Escrever no histórico é papel do servidor, não do navegador: quem grava é a
-- função de transição, com privilégio próprio. Assim ninguém forja um evento.
revoke insert on a1_pa_eventos from anon, authenticated;

-- =============================================================================
-- COMO CONFERIR
--   1. Sem liberar o módulo:  select count(*) from a1_pre_analises;  → 0 linhas
--      para qualquer sessão, inclusive de gestor. O módulo está inerte.
--   2. Libere PRE_ANALISE para um cliente de teste no superadmin e repita.
--   3. Com sessão de corretor, peça a lista: só devem vir as dele.
--   4. select * from a1_pa_eventos; devolve; update/delete devem falhar.
--
-- Tudo isso está automatizado em testes/sql/ — 65 verificações rodando como
-- 'anon' com token no cabeçalho, que é como o PostgREST chega ao banco.
-- =============================================================================
