-- =============================================================================
-- INDICASII — PROGRAMA DE INDICAÇÃO
--
-- Alguém indica uma empresa que pode virar cliente do SIIMOB. Se o contrato
-- fechar, essa pessoa recebe 20% da PRIMEIRA PARCELA paga pela empresa — uma
-- única vez, e não 20% do valor total do contrato. Por isso a coluna se chama
-- valor_primeira_parcela: nome de coluna também é documentação, e "valor do
-- contrato" seria uma base de cálculo diferente.
--
-- O DESENHO E O PORQUÊ
-- A página de indicação é PÚBLICA: quem indica não tem login. Isso significa
-- que ninguém pode ler estas tabelas direto — senão bastaria abrir o endereço
-- da API para baixar a carteira de prospecção inteira, com telefone e e-mail
-- de cada empresa indicada. Então:
--   • nenhuma leitura pública nas tabelas (nem SELECT para anon);
--   • a página escreve por funções com privilégio próprio, que fazem só o que
--     está escrito aqui;
--   • quem indicou acompanha as próprias indicações por um token pessoal, e a
--     função devolve apenas as indicações daquele token.
-- O superadmin vê tudo pela chave de serviço, que passa por cima da RLS.
--
-- O percentual fica numa coluna, e não escondido no código: mudar a regra de
-- 20% para outro valor não pode exigir alterar sistema.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

create extension if not exists pgcrypto;
set search_path = public, extensions, pg_temp;

-- ─── Quem indica ─────────────────────────────────────────────────────────────
create table if not exists a1_indicadores (
  id           uuid        primary key default gen_random_uuid(),
  token        text        unique not null default encode(gen_random_bytes(18),'hex'),
  nome         text        not null,
  documento    text        not null,          -- CPF ou CNPJ, só dígitos
  email        text,
  telefone     text,
  chave_pix    text,                          -- para onde vai a comissão
  criado_em    timestamptz not null default now(),
  unique (documento)
);

-- ─── O que foi indicado ──────────────────────────────────────────────────────
create table if not exists a1_indicacoes (
  id             uuid        primary key default gen_random_uuid(),
  indicador_id   uuid        not null references a1_indicadores(id) on delete cascade,
  empresa        text        not null,
  contato_nome   text,
  contato_email  text,
  contato_fone   text,
  cidade         text,
  uf             char(2),
  porte          text,                        -- faixa de usuários, texto livre
  observacoes    text,
  status         text        not null default 'nova',
  -- nova | em_contato | proposta | fechado | perdido
  -- Base de cálculo: a PRIMEIRA parcela paga pela empresa indicada, não o
  -- contrato inteiro. Preenchida quando fecha.
  valor_primeira_parcela numeric(14,2),
  percentual     numeric(5,2) not null default 20.00,
  pago           boolean      not null default false,
  pago_em        timestamptz,
  criado_em      timestamptz  not null default now(),
  atualizado_em  timestamptz  not null default now()
);

create index if not exists idx_indicacoes_indicador on a1_indicacoes (indicador_id, criado_em desc);
create index if not exists idx_indicacoes_status    on a1_indicacoes (status, criado_em desc);

-- Se esta base já tinha a coluna com o nome antigo (valor_contrato), renomeia
-- em vez de criar uma segunda: o dado que já está lá é o mesmo, e ficar com as
-- duas colunas é o caminho mais curto para pagar comissão errada.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'a1_indicacoes'
                and column_name = 'valor_contrato')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'a1_indicacoes'
                and column_name = 'valor_primeira_parcela')
  then
    alter table a1_indicacoes rename column valor_contrato to valor_primeira_parcela;
  end if;
end $$;

-- A comissão é conta, não digitação: sai da primeira parcela e do percentual da
-- própria linha, e vale zero enquanto o contrato não fechar.
create or replace function a1_indica_comissao(p_status text, p_valor numeric, p_perc numeric)
returns numeric language sql immutable
set search_path = public, pg_temp as $$
  select case when p_status = 'fechado' and p_valor is not null
              then round(p_valor * coalesce(p_perc,20) / 100, 2)
              else 0 end;
$$;

alter table a1_indicadores enable row level security;
alter table a1_indicacoes  enable row level security;

-- Sem política de leitura: ninguém lê estas tabelas pela API pública. O acesso
-- de quem indicou passa pela função de painel; o do superadmin, pela chave de
-- serviço.
drop policy if exists "indicadores_nada" on a1_indicadores;
drop policy if exists "indicacoes_nada"  on a1_indicacoes;

revoke all on a1_indicadores, a1_indicacoes from anon, authenticated;

-- ─── 1. Enviar uma indicação (página pública) ────────────────────────────────
-- Cria a pessoa que indica na primeira vez e reaproveita nas seguintes, pelo
-- documento. Devolve o token pessoal, que é como ela acompanha depois.
create or replace function a1_indica_enviar(
  p_nome text, p_documento text, p_email text, p_telefone text, p_pix text,
  p_empresa text, p_contato_nome text, p_contato_email text, p_contato_fone text,
  p_cidade text, p_uf text, p_porte text, p_obs text
) returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_doc text;
  v_ind a1_indicadores%rowtype;
begin
  if coalesce(btrim(p_nome),'')    = '' then return json_build_object('error','nome_vazio');    end if;
  if coalesce(btrim(p_empresa),'') = '' then return json_build_object('error','empresa_vazia'); end if;

  v_doc := regexp_replace(coalesce(p_documento,''), '\D', '', 'g');
  if length(v_doc) not in (11, 14) then return json_build_object('error','documento_invalido'); end if;

  select * into v_ind from a1_indicadores where documento = v_doc;
  if not found then
    insert into a1_indicadores (nome, documento, email, telefone, chave_pix)
    values (btrim(p_nome), v_doc,
            nullif(btrim(coalesce(p_email,'')),''),
            nullif(btrim(coalesce(p_telefone,'')),''),
            nullif(btrim(coalesce(p_pix,'')),''))
    returning * into v_ind;
  else
    -- Dado de contato mais novo vale, mas nunca apaga o que já havia.
    update a1_indicadores set
      email     = coalesce(nullif(btrim(coalesce(p_email,'')),''),    email),
      telefone  = coalesce(nullif(btrim(coalesce(p_telefone,'')),''), telefone),
      chave_pix = coalesce(nullif(btrim(coalesce(p_pix,'')),''),      chave_pix)
    where id = v_ind.id
    returning * into v_ind;
  end if;

  -- A mesma empresa indicada duas vezes pela mesma pessoa não vira duas linhas.
  if exists (select 1 from a1_indicacoes
              where indicador_id = v_ind.id
                and lower(btrim(empresa)) = lower(btrim(p_empresa))) then
    return json_build_object('error','ja_indicada', 'token', v_ind.token);
  end if;

  insert into a1_indicacoes
    (indicador_id, empresa, contato_nome, contato_email, contato_fone, cidade, uf, porte, observacoes)
  values
    (v_ind.id, btrim(p_empresa),
     nullif(btrim(coalesce(p_contato_nome,'')),''),
     nullif(btrim(coalesce(p_contato_email,'')),''),
     nullif(btrim(coalesce(p_contato_fone,'')),''),
     nullif(btrim(coalesce(p_cidade,'')),''),
     nullif(upper(btrim(coalesce(p_uf,''))),''),
     nullif(btrim(coalesce(p_porte,'')),''),
     nullif(btrim(coalesce(p_obs,'')),''));

  return json_build_object('ok', true, 'token', v_ind.token, 'nome', v_ind.nome);
end $$;

-- ─── 2. Painel de quem indicou ───────────────────────────────────────────────
-- Só as indicações daquele token. Não devolve nada de outra pessoa, e o
-- contato da empresa indicada não volta para a tela — quem trata disso é a
-- equipe comercial, não quem indicou.
create or replace function a1_indica_painel(p_token text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_ind a1_indicadores%rowtype;
  v_lista json;
  v_total numeric;
begin
  select * into v_ind from a1_indicadores where token = p_token;
  if not found then return json_build_object('error','token_invalido'); end if;

  select coalesce(json_agg(x order by x.criado_em desc), '[]'::json) into v_lista
  from (
    select i.id, i.empresa, i.cidade, i.uf, i.status, i.criado_em,
           i.valor_primeira_parcela, i.percentual, i.pago,
           a1_indica_comissao(i.status, i.valor_primeira_parcela, i.percentual) as comissao
    from a1_indicacoes i where i.indicador_id = v_ind.id
  ) x;

  select coalesce(sum(a1_indica_comissao(status, valor_primeira_parcela, percentual)), 0)
    into v_total from a1_indicacoes where indicador_id = v_ind.id;

  return json_build_object(
    'ok', true,
    'nome', v_ind.nome,
    'chave_pix', v_ind.chave_pix,
    'indicacoes', v_lista,
    'total_a_receber', (select coalesce(sum(a1_indica_comissao(status, valor_primeira_parcela, percentual)),0)
                          from a1_indicacoes where indicador_id = v_ind.id and pago = false),
    'total_geral', v_total
  );
end $$;

grant execute on function a1_indica_enviar(text,text,text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function a1_indica_painel(text)                                                             to anon, authenticated;
grant execute on function a1_indica_comissao(text,numeric,numeric)                                           to anon, authenticated;

-- =============================================================================
-- COMO CONFERIR
--   1. Abra /indica, preencha e envie uma indicação. Guarde o link do painel.
--   2. Envie a MESMA empresa de novo: deve recusar como já indicada.
--   3. No superadmin, aba IndicaSII, marque como "fechado" e informe o valor.
--      A comissão de 20% aparece sozinha.
--   4. Volte ao painel pelo link: o valor a receber tem que bater.
--   5. Tente ler a tabela pela API com a chave pública:
--      curl ".../rest/v1/a1_indicacoes?select=*" -H "apikey: <anon>"
--      -> tem que vir vazio ou negado. Nunca a lista.
-- =============================================================================
