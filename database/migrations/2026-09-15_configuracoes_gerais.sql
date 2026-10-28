-- ══════════════════════════════════════════════════════════════════════════════
-- Configurações Gerais — as regras-mãe do cliente, e a venda avulsa
-- ══════════════════════════════════════════════════════════════════════════════
--
-- POR QUE ESTE ARQUIVO EXISTE
-- Até aqui, quem podia criar um processo era decidido só por permissão. Faltava
-- o andar de cima: a regra do CLIENTE, que vale antes de qualquer permissão. Um
-- cliente pode ter decidido que, na operação dele, venda não nasce solta — ela
-- sempre vem de uma pré-análise. Isso não é decisão de pessoa, é de processo, e
-- representá-la marcando caixa em quinze cadastros seria descrever uma regra de
-- empresa como coincidência de permissões.
--
-- A ORDEM, QUE VALE NA TELA E AQUI:
--     regra do cliente  →  permissão (perfil/pessoa)  →  RLS
-- Desligada a regra-mãe, NINGUÉM cria — nem o gestor. Ligada, ela não concede
-- nada: continua valendo a permissão de sempre.
--
-- As três regras moram em a1_config, chave 'geral', como o resto das
-- configurações do cliente. Ausente vale o PADRÃO DE HOJE, nunca o mais
-- restritivo: cliente que nunca abriu a tela não pode acordar com botão a menos.
--
-- O QUE ESTE ARQUIVO NÃO MUDA
-- Nenhuma permissão existente, nenhuma política de a1_cases ou a1_pre_analises.
-- A pré-análise e o repasse avulsos já funcionavam; para eles a regra-mãe é lida
-- só na tela, porque a criação deles já passa por política própria no banco. O
-- que nasce aqui é o caminho que NÃO existia: criar venda sem pré-análise.
--
-- SEGURO DE RODAR DUAS VEZES.
begin;

-- ── A regra-mãe, legível de dentro do banco ─────────────────────────────────
-- A tela lê a1_config direto. A função existe para o próprio banco poder
-- consultar a regra sem duplicar a interpretação do JSON — e é ela que
-- a1_criar_comercial_avulso consulta antes de criar.
create or replace function public.a1_geral(p_chave text)
returns boolean
language sql stable security definer
set search_path to 'public','extensions','pg_temp'
as $$
  select coalesce(
    (select case
       when (c.value::jsonb ? p_chave)
         then (c.value::jsonb->>p_chave) in ('true','t','1')
       else null
     end
     from a1_config c
     where c.tenant_id = (select a1_tenant()) and c.key = 'geral'
     limit 1),
    -- Ausente vale o padrão de HOJE. Venda avulsa nasce desligada porque não
    -- existia; as outras duas nascem ligadas porque sempre existiram.
    case p_chave when 'criar_venda_avulsa' then false else true end
  );
$$;

revoke all on function public.a1_geral(text) from public;
grant execute on function public.a1_geral(text) to anon, authenticated;

-- ── Criar venda sem pré-análise ─────────────────────────────────────────────
-- Por que RPC e não política de INSERT: a Venda nunca foi escrita pelo
-- navegador. Ela nasce dentro do banco, em a1_criar_comercial, que monta o
-- snapshot de origem, escolhe a situação inicial e grava o evento na MESMA
-- transação. Abrir um INSERT direto criaria uma segunda porta para o mesmo
-- registro, com regras próprias — e é exatamente isso que o orquestrador em
-- Postgres existe para evitar.
--
-- Esta função é a irmã avulsa daquela: mesma disciplina, origem diferente. O
-- snapshot diz `avulsa: true` e não carrega crédito nenhum, porque não há
-- pré-análise por trás — e quem ler o dossiê depois precisa saber disso.
create or replace function public.a1_criar_comercial_avulso(
  p_empreendimento uuid,
  p_unidade        text,
  p_valor_venda    bigint default null,
  p_corretor       uuid   default null,
  p_imobiliaria    uuid   default null
) returns uuid
language plpgsql security definer
set search_path to 'public','extensions','pg_temp'
as $$
declare
  v_tenant uuid;
  v_id  uuid;
  v_sit uuid;
begin
  perform set_config('a1.orquestrador', '1', true);

  v_tenant := a1_tenant();
  if v_tenant is null then raise exception 'sessao_invalida'; end if;

  if not a1_tem_modulo('COMERCIAL') then raise exception 'modulo_comercial_desabilitado'; end if;

  -- A REGRA-MÃE VEM ANTES DA PERMISSÃO, e vale para o gestor também. Uma regra
  -- que o gestor pudesse furar não seria regra, seria sugestão — e a tela, que
  -- esconde o botão para todos, estaria mentindo sobre o que o banco aceita.
  if not a1_geral('criar_venda_avulsa') then raise exception 'venda_avulsa_desligada'; end if;

  -- Só então a permissão da pessoa. co_editar é a chave de quem mexe na Venda;
  -- não se inventa chave nova para isto, porque chave que o gestor não sabe que
  -- existe é caixa que ele acredita e não confere.
  if not (a1_e_gestor() or a1_perm('co_editar')) then raise exception 'sem_permissao'; end if;

  if p_empreendimento is not null
     and not exists (select 1 from a1_developments d
                      where d.id = p_empreendimento and d.tenant_id = v_tenant) then
    raise exception 'empreendimento_fora_do_cliente';
  end if;

  select id into v_sit from a1_co_situacoes
   where tenant_id = v_tenant and ativo and flag = 'INICIAL'
   order by ordem limit 1;
  if v_sit is null then raise exception 'esteira_sem_situacao_inicial'; end if;

  insert into a1_comerciais (tenant_id, pre_analise_id, empreendimento_id, unidade,
      corretor_id, imobiliaria_id, situacao_id, proposta, origem_snapshot, criado_por)
  values (v_tenant, null, p_empreendimento, nullif(trim(coalesce(p_unidade,'')),''),
      p_corretor, p_imobiliaria, v_sit,
      case when p_valor_venda is not null then jsonb_build_object('valor_venda', p_valor_venda)
           else '{}'::jsonb end,
      jsonb_build_object('capturado_em', now(), 'avulsa', true),
      a1_ator())
  returning id into v_id;

  insert into a1_co_eventos (tenant_id, comercial_id, evento, para_situacao, ator_id, detalhe)
  values (v_tenant, v_id, 'criado_avulso', v_sit, a1_ator(), jsonb_build_object('avulsa', true));

  return v_id;
end
$$;

revoke all on function public.a1_criar_comercial_avulso(uuid,text,bigint,uuid,uuid) from public;
grant execute on function public.a1_criar_comercial_avulso(uuid,text,bigint,uuid,uuid) to anon, authenticated;

commit;

-- ── CONFERÊNCIA ──────────────────────────────────────────────────────────────
-- 1. O padrão, sem nada gravado: as duas primeiras true, a venda false.
--    select a1_geral('criar_pre_analise_avulsa'), a1_geral('criar_venda_avulsa'),
--           a1_geral('criar_repasse_avulso');
--
-- 2. Com a regra desligada, criar venda avulsa tem de FALHAR — inclusive para o
--    gestor. Se passar, a regra-mãe virou sugestão:
--    select a1_criar_comercial_avulso(null, '101');   -- venda_avulsa_desligada
--
-- 3. Depois de ligar em Configurações › Configurações Gerais, a mesma chamada
--    passa a criar, e o cartão nasce na situação com flag INICIAL da esteira.
