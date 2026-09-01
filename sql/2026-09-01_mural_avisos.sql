-- =============================================================================
-- MURAL DE AVISOS
--
-- O superadmin escreve um aviso, escolhe quem deve ver e publica. Quem entrar
-- no sistema vê o aviso uma vez, num pop-up, e ele não volta a incomodar.
--
-- DUAS COISAS QUE PRECISAM SER VERDADE AO MESMO TEMPO
--   1. TODO usuário de TODO cliente precisa LER os avisos publicados.
--   2. NENHUM usuário pode escrever, editar ou apagar aviso — isso é só do
--      superadmin, que trabalha com a chave de serviço e passa por cima da RLS.
-- Por isso a tabela não tem tenant_id: aviso é da plataforma, não de um
-- cliente. A leitura é liberada só para o que está publicado e dentro do prazo;
-- rascunho e aviso vencido não vazam para ninguém.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

create table if not exists a1_avisos (
  id           uuid        primary key default gen_random_uuid(),
  titulo       text        not null,
  corpo        text,                       -- texto do aviso
  imagem_url   text,                       -- arquivo no Storage (bucket avisos)
  video_url    text,                       -- link de vídeo ou arquivo no Storage
  publicos     text[]      not null default '{}',  -- vazio = todo mundo
  tenants      uuid[]      not null default '{}',  -- vazio = todos os clientes
  publicado    boolean     not null default false,
  fixado       boolean     not null default false, -- aparece sempre, não só uma vez
  publicado_em timestamptz,
  expira_em    timestamptz,
  criado_em    timestamptz not null default now()
);

create index if not exists idx_avisos_publicados
  on a1_avisos (publicado, publicado_em desc);

alter table a1_avisos enable row level security;

-- Só o que está no ar e dentro do prazo. Rascunho não vaza.
drop policy if exists "avisos_leitura" on a1_avisos;
create policy "avisos_leitura" on a1_avisos
  for select using (
    publicado = true
    and (expira_em is null or expira_em > now())
  );

revoke all on a1_avisos from anon, authenticated;
grant select on a1_avisos to anon, authenticated;

-- ─── Quem já viu o quê ───────────────────────────────────────────────────────
-- Guardado no banco, e não no navegador: a pessoa entra do celular e do
-- computador, e um aviso já lido não deve reaparecer no outro aparelho.
create table if not exists a1_avisos_lidos (
  aviso_id  uuid        not null references a1_avisos(id) on delete cascade,
  user_key  text        not null,           -- tenant::usuário, o mesmo de a1_presence
  lido_em   timestamptz not null default now(),
  primary key (aviso_id, user_key)
);

alter table a1_avisos_lidos enable row level security;

-- Marcar como lido é a única escrita que o usuário faz aqui. Vale como registro
-- de quem viu e quando; não decide mais se o aviso aparece. Não pode apagar nem
-- alterar linha de outro.
drop policy if exists "avisos_lidos_ler"    on a1_avisos_lidos;
drop policy if exists "avisos_lidos_marcar" on a1_avisos_lidos;
create policy "avisos_lidos_ler"    on a1_avisos_lidos for select using (true);
create policy "avisos_lidos_marcar" on a1_avisos_lidos for insert with check (true);

revoke all on a1_avisos_lidos from anon, authenticated;
grant select, insert on a1_avisos_lidos to anon, authenticated;

-- ─── O que este usuário tem para ver agora ───────────────────────────────────
-- Uma função só, para a tela não precisar montar a regra no navegador — regra
-- de quem vê o quê no cliente é regra que dá para burlar.
--
-- O aviso volta A CADA LOGIN, de propósito. A versão anterior escondia o que já
-- tinha sido lido uma vez, e na prática o recado passava despercebido: quem
-- fechou o pop-up correndo no primeiro dia nunca mais o via. Quem não repete
-- não avisa. A conta de "já mostrei nesta sessão" é feita no navegador, presa
-- ao token do login — trocou de login, o aviso aparece de novo.
--
-- a1_avisos_lidos continua sendo gravado, mas agora só como registro de quem
-- viu e quando; não filtra mais nada.
create or replace function a1_avisos_para_mim(p_publico text, p_user_key text)
returns setof a1_avisos
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select a.*
  from   a1_avisos a
  where  a.publicado = true
    and  (a.expira_em is null or a.expira_em > now())
    and  (cardinality(a.publicos) = 0 or p_publico = any(a.publicos))
    and  (cardinality(a.tenants)  = 0 or a1_tenant() = any(a.tenants))
  order by a.fixado desc, a.publicado_em desc nulls last
  limit 20;
$$;

grant execute on function a1_avisos_para_mim(text, text) to anon, authenticated;

-- =============================================================================
-- ARQUIVOS (imagem e vídeo)
-- Crie no painel do Supabase um bucket PÚBLICO chamado  avisos
--   Storage → New bucket → nome: avisos → marque "Public bucket" → Save
-- Aviso é conteúdo que todo mundo do sistema vê; não há motivo para link
-- assinado, e público simplifica a exibição no pop-up.
--
-- COMO CONFERIR
--   1. No superadmin, crie um aviso de teste, escolha "Gestores" e publique.
--   2. Entre com um gestor: o pop-up aparece. Feche e recarregue a página: não
--      volta (mesma sessão). Saia e entre de novo: volta a aparecer.
--   3. Entre com um corretor: não deve aparecer nada.
--   4. Despublique o aviso e recarregue: some para todos.
-- =============================================================================
