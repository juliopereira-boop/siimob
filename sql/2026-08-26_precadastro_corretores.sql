-- =============================================================================
-- PRÉ-CADASTRO DE CORRETORES POR LINK
--
-- O corretor preenche o cadastro SEM estar logado. Como nenhuma tela sem sessão
-- pode escrever no banco (a segurança por linha bloqueia, e é isso que queremos),
-- o caminho é por funções com privilégio próprio, que só fazem exatamente o que
-- está escrito aqui — validar o link e criar o corretor AGUARDANDO APROVAÇÃO.
--
-- Nada de acesso é concedido no cadastro: o corretor entra com approved = false,
-- e a função de login já exige approved = true. Ou seja, ele só consegue entrar
-- depois que o gestor validar na tela "Validação de corretores".
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

create table if not exists a1_precad_links (
  token             text        primary key default encode(gen_random_bytes(18), 'hex'),
  tenant_id         uuid        not null references a1_tenants(id) on delete cascade,
  imobiliaria_id    uuid,
  imobiliaria_nome  text,
  criado_por        text,
  expires_at        timestamptz not null,
  revoked           boolean     not null default false,
  usos              int         not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists idx_precad_tenant on a1_precad_links (tenant_id, created_at desc);

alter table a1_precad_links enable row level security;

-- O gestor administra apenas os links da própria empresa. Um visitante sem
-- sessão não enxerga nada aqui — a validação do link passa pela função abaixo.
drop policy if exists "precad_links_tenant" on a1_precad_links;
create policy "precad_links_tenant" on a1_precad_links
  for all using (tenant_id = a1_tenant()) with check (tenant_id = a1_tenant());

grant select, insert, update, delete on a1_precad_links to anon, authenticated;

-- ─── 1. O que o link representa (para a página pública montar a tela) ────────
-- Devolve só o necessário: nome da empresa e imobiliária. Não expõe nenhum
-- outro dado do cliente nem permite listar links.
create or replace function a1_precad_info(p_token text)
returns json language plpgsql security definer as $$
declare
  l a1_precad_links%rowtype;
  t a1_tenants%rowtype;
begin
  select * into l from a1_precad_links where token = p_token;
  if not found     then return json_build_object('error','invalido');  end if;
  if l.revoked     then return json_build_object('error','revogado');  end if;
  if l.expires_at < now() then return json_build_object('error','expirado'); end if;

  select * into t from a1_tenants where id = l.tenant_id;
  if t.id is null or t.status = 'cancelled' then return json_build_object('error','invalido'); end if;

  return json_build_object(
    'ok', true,
    'empresa',     t.name,
    'imobiliaria', l.imobiliaria_nome,
    'expira_em',   l.expires_at
  );
end $$;

-- ─── 2. Envio do pré-cadastro ────────────────────────────────────────────────
-- Cria o corretor SEM acesso (approved = false). Só o gestor libera depois.
create or replace function a1_precad_enviar(
  p_token text, p_nome text, p_cpf text, p_email text, p_fone text, p_senha text
) returns json language plpgsql security definer as $$
declare
  l     a1_precad_links%rowtype;
  v_cpf text;
begin
  select * into l from a1_precad_links where token = p_token;
  if not found or l.revoked or l.expires_at < now() then
    return json_build_object('error','link_invalido');
  end if;

  if coalesce(btrim(p_nome),'') = '' then return json_build_object('error','nome_vazio'); end if;

  v_cpf := regexp_replace(coalesce(p_cpf,''), '\D', '', 'g');
  if length(v_cpf) <> 11 then return json_build_object('error','cpf_invalido'); end if;
  if length(coalesce(p_senha,'')) < 6 then return json_build_object('error','senha_curta'); end if;

  if exists (select 1 from a1_partners where tenant_id = l.tenant_id and cpf = v_cpf) then
    return json_build_object('error','cpf_duplicado');
  end if;

  insert into a1_partners
    (tenant_id, type, name, cpf, email, phone, password_hash, is_active, approved, permissions, extra)
  values
    (l.tenant_id, 'corretor', btrim(p_nome), v_cpf, nullif(btrim(coalesce(p_email,'')),''),
     nullif(btrim(coalesce(p_fone,'')),''),
     encode(digest(p_senha || '::a1', 'sha256'), 'hex'),
     true,
     false,                                   -- SEM acesso até o gestor validar
     '{}'::jsonb,
     jsonb_build_object(
       'origem','pre-cadastro',
       'imobiliaria_id',   l.imobiliaria_id,
       'imobiliaria_nome', l.imobiliaria_nome,
       'enviado_em',       now()
     ));

  update a1_precad_links set usos = usos + 1 where token = p_token;
  return json_build_object('ok', true);
end $$;

grant execute on function a1_precad_info(text)                              to anon, authenticated;
grant execute on function a1_precad_enviar(text,text,text,text,text,text)   to anon, authenticated;

-- =============================================================================
-- COMO CONFERIR
--   1. Em Configurações > Corretores, clique em "Gerar link de cadastro",
--      escolha a validade e a imobiliária e copie o link.
--   2. Abra o link numa janela anônima e faça um cadastro de teste.
--   3. Tente entrar com esse CPF: deve ser recusado, porque ainda não foi
--      validado.
--   4. Em Configurações > Validação de corretores, clique em Validar. Agora o
--      login funciona. Em Recusar, o registro é apagado.
-- =============================================================================
