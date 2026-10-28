-- =============================================================================
-- PERFIS DE ACESSO
--
-- POR QUE ESTE ARQUIVO EXISTE
-- Hoje cada pessoa carrega a própria lista de marcas em a1_partners.permissions.
-- Com um corretor isso funciona; com trinta, não: para mudar o que "corretor"
-- pode fazer, alguém tem de abrir trinta cadastros e marcar a mesma caixa trinta
-- vezes. Um esquecido vira o chamado da semana seguinte, e ninguém consegue
-- responder olhando a tela por que fulano consegue e beltrano não.
--
-- O perfil inverte isso: o gestor descreve UMA VEZ o que um corretor pode fazer,
-- e vincula as pessoas. Mudou o perfil, mudou todo mundo que está nele.
--
-- O PERFIL MANDA, QUANDO EXISTE
-- a1_perm() passa a ler o perfil da pessoa quando ela tem um, e as marcas soltas
-- só quando não tem. As duas fontes valendo ao mesmo tempo trariam de volta
-- exatamente o problema que o perfil veio resolver.
--
-- Quem não tem perfil continua funcionando igual — nenhum cadastro existente
-- muda de comportamento ao rodar este arquivo.
--
-- Depende de: 2026-09-04_identidade.sql e 2026-09-06_travas_sessao_e_parceiro.sql
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ─── A tabela ────────────────────────────────────────────────────────────────
create table if not exists a1_perfis (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references a1_tenants(id) on delete cascade,
  nome          text not null,
  descricao     text,
  -- As mesmas chaves que js/permissoes.js lista. Guardar como jsonb, e não como
  -- colunas, é o que deixa acrescentar permissão de módulo novo sem migração.
  permissions   jsonb not null default '{}'::jsonb,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists idx_perfis_nome on a1_perfis (tenant_id, lower(nome));
create index if not exists idx_perfis_tenant on a1_perfis (tenant_id, ativo);

-- ─── O vínculo ───────────────────────────────────────────────────────────────
-- on delete set null, e não cascade: apagar um perfil não pode apagar gente.
-- Sem perfil, a pessoa volta a valer pelas marcas soltas dela.
alter table a1_partners add column if not exists perfil_id uuid references a1_perfis(id) on delete set null;
create index if not exists idx_partners_perfil on a1_partners (perfil_id);

-- ─── a1_perm passa pelo perfil ───────────────────────────────────────────────
-- Mesma assinatura e mesmo comportamento de antes para quem não tem perfil.
-- A comparação continua textual: um ::boolean aqui explodiria diante de um valor
-- fora do padrão, e como isto roda DENTRO de política de RLS, o erro não
-- recusaria a linha — derrubaria a consulta inteira da tabela para o usuário.
create or replace function a1_perm(p_chave text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select case
    when a1_e_gestor() then true
    else coalesce((
      select
        -- Gerente continua valendo por cima de tudo, venha do perfil ou não.
        coalesce(pf.permissions, p.permissions)->>'gerente' in ('true','t','1')
        or coalesce(pf.permissions, p.permissions)->>p_chave in ('true','t','1')
      from a1_partners p
      left join a1_perfis pf on pf.id = p.perfil_id and pf.ativo
      where p.id = a1_ator()
      limit 1), false)
  end;
$$;
grant execute on function a1_perm(text) to anon, authenticated;

-- ─── Trocar o próprio perfil é trocar a própria permissão ────────────────────
-- O gatilho da trava já barra o parceiro que mexe em permissions, approved, cpf
-- e companhia. perfil_id entra na mesma lista pelo mesmo motivo: sem ele, bastava
-- apontar para o perfil mais generoso do cliente.
create or replace function a1_partners_trava_poder()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if coalesce(a1_papel(), '') <> 'partner' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'parceiro_nao_apaga_cadastro';
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.permissions, '{}'::jsonb) <> '{}'::jsonb or new.perfil_id is not null then
      raise exception 'parceiro_nao_define_permissao';
    end if;
    return new;
  end if;

  if new.permissions is distinct from old.permissions
     or new.perfil_id is distinct from old.perfil_id
     or new.approved  is distinct from old.approved
     or new.is_active is distinct from old.is_active
     or new.type      is distinct from old.type
     or new.cpf       is distinct from old.cpf
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'parceiro_nao_define_permissao';
  end if;

  return new;
end $$;

drop trigger if exists trg_a1_partners_poder on a1_partners;
create trigger trg_a1_partners_poder
  before insert or update or delete on a1_partners
  for each row execute function a1_partners_trava_poder();

-- ─── Quem lê e quem escreve os perfis ────────────────────────────────────────
-- Todo mundo do cliente LÊ: a tela precisa mostrar "Perfil: Corretor" ao lado da
-- pessoa, e a resolução de permissão passa por aqui. Só gestor ESCREVE — perfil
-- é a definição do poder, e quem define poder não é quem o recebe.
alter table a1_perfis enable row level security;
drop policy if exists a1_perfis_ler      on a1_perfis;
drop policy if exists a1_perfis_escrever on a1_perfis;
revoke all on a1_perfis from anon, authenticated;
grant select, insert, update, delete on a1_perfis to anon, authenticated;

create policy a1_perfis_ler on a1_perfis for select
  using (tenant_id = a1_tenant());
create policy a1_perfis_escrever on a1_perfis for all
  using (tenant_id = a1_tenant() and a1_e_gestor())
  with check (tenant_id = a1_tenant() and a1_e_gestor());

-- ─── Os módulos novos ganham permissão própria ───────────────────────────────
-- Até aqui Pré-análise e Comercial usavam as chaves do Repasse: quem podia
-- 'editar_repasses' podia editar pré-análise. Funcionava com um módulo só, e
-- deixa de fazer sentido no momento em que o cliente tem três — dar acesso ao
-- Repasse passava a dar acesso a tudo, de brinde.
--
-- As chaves novas são as de js/permissoes.js. Quem não as tiver simplesmente não
-- entra nos módulos novos, que é o lado seguro de errar enquanto os perfis não
-- estiverem montados.
drop policy if exists a1_pre_analises_ler    on a1_pre_analises;
drop policy if exists a1_pre_analises_criar  on a1_pre_analises;
drop policy if exists a1_pre_analises_editar on a1_pre_analises;

create policy a1_pre_analises_ler on a1_pre_analises for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_perm('pa_ver') and a1_pa_visivel(corretor_id, empresa_id));
create policy a1_pre_analises_criar on a1_pre_analises for insert
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
              and a1_perm('pa_criar'));
create policy a1_pre_analises_editar on a1_pre_analises for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
         and a1_pa_visivel(corretor_id, empresa_id) and a1_perm('pa_editar'))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));

drop policy if exists a1_pa_pessoas_criar  on a1_pa_pessoas;
drop policy if exists a1_pa_pessoas_editar on a1_pa_pessoas;
create policy a1_pa_pessoas_criar on a1_pa_pessoas for insert
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE') and a1_perm('pa_criar'));
create policy a1_pa_pessoas_editar on a1_pa_pessoas for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE') and a1_perm('pa_criar')
         and (a1_e_gestor() or a1_perm('gerente')
              or exists (select 1 from a1_pa_participantes pp
                          join a1_pre_analises pa on pa.id = pp.pre_analise_id
                         where pp.pessoa_id = a1_pa_pessoas.id
                           and a1_pa_visivel(pa.corretor_id, pa.empresa_id))))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'));

do $$
declare t text;
begin
  foreach t in array array['a1_pa_participantes','a1_pa_documentos']
  loop
    execute format('drop policy if exists %I on %I', t || '_escrever', t);
    execute format($f$
      create policy %I on %I for all using (
        tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE')
        and a1_perm('pa_editar')
        and exists (select 1 from a1_pre_analises pa
                     where pa.id = %I.pre_analise_id
                       and a1_pa_visivel(pa.corretor_id, pa.empresa_id)))
      with check (tenant_id = a1_tenant() and a1_tem_modulo('PRE_ANALISE'))$f$,
      t || '_escrever', t, t);
  end loop;
end $$;

drop policy if exists a1_comerciais_ler    on a1_comerciais;
drop policy if exists a1_comerciais_editar on a1_comerciais;
create policy a1_comerciais_ler on a1_comerciais for select
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and a1_perm('co_ver') and a1_co_visivel(corretor_id, empresa_id));
create policy a1_comerciais_editar on a1_comerciais for update
  using (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL')
         and a1_co_visivel(corretor_id, empresa_id) and a1_perm('co_editar'))
  with check (tenant_id = a1_tenant() and a1_tem_modulo('COMERCIAL'));

-- Marcar contrato como assinado ganha marca própria: era 'analisar_credito',
-- emprestada da Pré-análise, o que obrigava a dar acesso a decisão de crédito
-- para alguém que só precisava confirmar uma assinatura.
create or replace function a1_co_guarda_contrato()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $$
begin
  if new.status = 'ASSINADO'
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and not (a1_e_gestor() or a1_perm('gerente') or a1_perm('co_contrato')) then
    raise exception 'sem_permissao_para_marcar_contrato_assinado';
  end if;
  return new;
end $$;
drop trigger if exists trg_co_contrato_guarda on a1_co_contratos;
create trigger trg_co_contrato_guarda before insert or update on a1_co_contratos
  for each row execute function a1_co_guarda_contrato();

-- As transições passam a exigir a marca do módulo, e não a do Repasse.
create or replace function a1_pa_transicionar(
  p_pre_analise uuid, p_para uuid, p_justificativa text default null,
  p_versao_esperada int default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_pa a1_pre_analises%rowtype;
  v_tr a1_pa_transicoes%rowtype;
  v_comercial uuid;
  v_erro text;
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_pa from a1_pre_analises where id = p_pre_analise;
  if v_pa.id is null or v_pa.tenant_id <> a1_tenant() then
    raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('PRE_ANALISE') then raise exception 'modulo_desabilitado'; end if;
  if not a1_pa_visivel(v_pa.corretor_id, v_pa.empresa_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('pa_editar') then raise exception 'sem_permissao'; end if;

  if p_versao_esperada is not null and p_versao_esperada <> v_pa.versao then
    raise exception 'versao_desatualizada';
  end if;

  select * into v_tr from a1_pa_transicoes
   where tenant_id = v_pa.tenant_id and ativo and para_id = p_para
     and (de_id is null or de_id = v_pa.situacao_id)
   order by (de_id is not null) desc limit 1;
  if v_tr.id is null then raise exception 'transicao_nao_permitida'; end if;

  if array_length(v_tr.papeis,1) is not null
     and not (coalesce(a1_tipo_ator(), a1_papel()) = any (v_tr.papeis))
     and not a1_e_gestor() then
    raise exception 'papel_nao_autorizado';
  end if;

  if v_tr.acao = 'ENABLE_COMMERCIAL' and v_tr.acao_modo = 'AUTO' then
    v_erro := a1_pa_pode_criar_comercial(p_pre_analise);
    if v_erro is not null then
      perform a1_integra_registrar(v_pa.tenant_id,'ENABLE_COMMERCIAL','PRE_ANALISE',
        p_pre_analise,'COMERCIAL',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
      return json_build_object('ok', false, 'erro', v_erro);
    end if;
  end if;

  if coalesce((v_tr.requisitos->>'documentos_aprovados')::boolean, false)
     and exists (select 1 from a1_pa_documentos
                  where pre_analise_id = p_pre_analise and status <> 'APROVADO') then
    raise exception 'documentos_pendentes';
  end if;

  insert into a1_pa_eventos (tenant_id, pre_analise_id, evento, de_situacao,
                             para_situacao, ator_id, detalhe)
  values (v_pa.tenant_id, p_pre_analise, 'transicao', v_pa.situacao_id, p_para,
          a1_ator(), jsonb_build_object('justificativa', p_justificativa));

  update a1_pre_analises
     set situacao_id = p_para, versao = versao + 1, atualizado_em = now()
   where id = p_pre_analise;

  if v_tr.acao = 'ENABLE_COMMERCIAL' and v_tr.acao_modo = 'AUTO' then
    v_comercial := a1_criar_comercial(p_pre_analise);
  end if;

  return json_build_object('ok', true, 'situacao_id', p_para,
                           'comercial_id', v_comercial);
end $$;
grant execute on function a1_pa_transicionar(uuid,uuid,text,int) to anon, authenticated;

create or replace function a1_co_transicionar(
  p_comercial uuid, p_para uuid, p_justificativa text default null,
  p_versao_esperada int default null)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_co a1_comerciais%rowtype;
  v_tr a1_co_transicoes%rowtype;
  v_case uuid;
  v_erro text;
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_co from a1_comerciais where id = p_comercial;
  if v_co.id is null or v_co.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('COMERCIAL') then raise exception 'modulo_desabilitado'; end if;
  if not a1_co_visivel(v_co.corretor_id, v_co.empresa_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('co_editar') then raise exception 'sem_permissao'; end if;
  if p_versao_esperada is not null and p_versao_esperada <> v_co.versao then
    raise exception 'versao_desatualizada'; end if;

  select * into v_tr from a1_co_transicoes
   where tenant_id = v_co.tenant_id and ativo and para_id = p_para
     and (de_id is null or de_id = v_co.situacao_id)
   order by (de_id is not null) desc limit 1;
  if v_tr.id is null then raise exception 'transicao_nao_permitida'; end if;

  if array_length(v_tr.papeis,1) is not null
     and not (coalesce(a1_tipo_ator(), a1_papel()) = any (v_tr.papeis))
     and not a1_e_gestor() then
    raise exception 'papel_nao_autorizado';
  end if;

  if coalesce((v_tr.requisitos->>'contrato_assinado')::boolean, false)
     and not exists (select 1 from a1_co_contratos
                      where comercial_id = p_comercial and status = 'ASSINADO') then
    raise exception 'contrato_nao_assinado';
  end if;

  if v_tr.acao = 'CREATE_REPASS' and v_tr.acao_modo = 'AUTO' then
    v_erro := a1_co_pode_criar_repasse(p_comercial);
    if v_erro is not null then
      perform a1_integra_registrar(v_co.tenant_id,'CREATE_REPASS','COMERCIAL',
        p_comercial,'REPASSE',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
      return json_build_object('ok', false, 'erro', v_erro);
    end if;
  end if;

  insert into a1_co_eventos (tenant_id, comercial_id, evento, de_situacao,
                             para_situacao, ator_id, detalhe)
  values (v_co.tenant_id, p_comercial, 'transicao', v_co.situacao_id, p_para,
          a1_ator(), jsonb_build_object('justificativa', p_justificativa));

  update a1_comerciais set situacao_id = p_para, versao = versao + 1,
                           atualizado_em = now()
   where id = p_comercial;

  if v_tr.acao = 'CREATE_REPASS' and v_tr.acao_modo = 'AUTO' then
    v_case := a1_criar_repasse_do_comercial(p_comercial);
  end if;

  return json_build_object('ok', true, 'situacao_id', p_para, 'repasse_case_id', v_case);
end $$;
grant execute on function a1_co_transicionar(uuid,uuid,text,int) to anon, authenticated;

-- As ações manuais seguem as mesmas marcas das transições.
create or replace function a1_pa_executar_acao(p_pre_analise uuid, p_acao text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_erro text; v_pa a1_pre_analises%rowtype;
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_pa from a1_pre_analises where id = p_pre_analise;
  if v_pa.id is null or v_pa.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('PRE_ANALISE') then raise exception 'modulo_desabilitado'; end if;
  if not a1_pa_visivel(v_pa.corretor_id, v_pa.empresa_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('pa_editar') then raise exception 'sem_permissao'; end if;
  if p_acao <> 'ENABLE_COMMERCIAL' then raise exception 'acao_desconhecida'; end if;
  v_erro := a1_pa_pode_criar_comercial(p_pre_analise);
  if v_erro is not null then
    perform a1_integra_registrar(a1_tenant(),'ENABLE_COMMERCIAL','PRE_ANALISE',
      p_pre_analise,'COMERCIAL',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
    return json_build_object('ok', false, 'erro', v_erro);
  end if;
  return json_build_object('ok', true, 'comercial_id', a1_criar_comercial(p_pre_analise));
end $$;
grant execute on function a1_pa_executar_acao(uuid,text) to anon, authenticated;

create or replace function a1_co_executar_acao(p_comercial uuid, p_acao text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_erro text; v_co a1_comerciais%rowtype;
begin
  perform set_config('a1.orquestrador', '1', true);

  select * into v_co from a1_comerciais where id = p_comercial;
  if v_co.id is null or v_co.tenant_id <> a1_tenant() then raise exception 'nao_encontrado'; end if;
  if not a1_tem_modulo('COMERCIAL') then raise exception 'modulo_desabilitado'; end if;
  if not a1_co_visivel(v_co.corretor_id, v_co.empresa_id) then raise exception 'sem_acesso'; end if;
  if not a1_perm('co_editar') then raise exception 'sem_permissao'; end if;
  if p_acao <> 'CREATE_REPASS' then raise exception 'acao_desconhecida'; end if;
  v_erro := a1_co_pode_criar_repasse(p_comercial);
  if v_erro is not null then
    perform a1_integra_registrar(a1_tenant(),'CREATE_REPASS','COMERCIAL',
      p_comercial,'REPASSE',null,'BLOQUEADO',v_erro,null,'{}'::jsonb);
    return json_build_object('ok', false, 'erro', v_erro);
  end if;
  return json_build_object('ok', true,
    'repasse_case_id', a1_criar_repasse_do_comercial(p_comercial));
end $$;
grant execute on function a1_co_executar_acao(uuid,text) to anon, authenticated;

-- =============================================================================
-- COMO CONFERIR
--   1. select count(*) from a1_perfis;                 -- 0, até você criar
--   2. Crie um perfil em Configurações › Perfis, vincule um corretor e peça a
--      ele para recarregar: as marcas dele passam a ser as do perfil.
--   3. Com o token desse corretor no cabeçalho:
--        update a1_partners set perfil_id = '<outro perfil>' where id = a1_ator();
--      -- parceiro_nao_define_permissao
--   4. Quem NÃO tem perfil continua exatamente como estava: a1_perm cai nas
--      marcas soltas da própria linha.
-- =============================================================================
