-- =============================================================================
-- SITE PÚBLICO: PÁGINA DE LINKS (BIO DO INSTAGRAM), CONTATO E BLOG
--
-- O superadmin monta a página /links (banners e botões), os dados de contato
-- que aparecem em /contato e /links, e escreve os posts de /blog. Quem visita
-- não tem login: lê com a chave pública.
--
-- O MESMO DESENHO DO MURAL DE AVISOS
--   1. Conteúdo é da plataforma, não de um cliente: as tabelas não têm
--      tenant_id e não tocam em nenhuma tabela de cliente.
--   2. A leitura pública vê só o que está ativo, dentro do prazo e publicado.
--      Rascunho de post e banner fora da campanha não vazam.
--   3. Ninguém escreve com a chave pública. O superadmin escreve com a chave
--      de serviço, que passa por cima da RLS. O único gesto público que grava
--      é contar o clique de um link, por uma função que só soma 1.
--   4. O formulário de /contato grava em a1_leads (source 'contato'), a tabela
--      que o formulário da LP já usa e que só o superadmin lê.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- =============================================================================
-- 1. CONFIGURAÇÃO DO SITE (uma linha só)
-- =============================================================================
-- O texto do topo da página de links e os canais de contato. Campo vazio não
-- aparece nas páginas: nada de botão para um WhatsApp que não existe.
create table if not exists a1_site_config (
  id            int primary key default 1 check (id = 1),
  links_titulo  text not null default 'SIIMOB',
  links_frase   text not null default 'Do primeiro contato ao registro em cartório, num sistema só.',
  whatsapp      text,          -- só dígitos, com DDI e DDD (5598999999999)
  whatsapp_msg  text,          -- mensagem que já vem escrita ao abrir a conversa
  email         text,
  telefone      text,
  horario       text,          -- "Segunda a sexta, das 9h às 18h"
  endereco      text,
  instagram     text,          -- endereço completo do perfil
  linkedin      text,
  youtube       text,
  facebook      text,
  tiktok        text,
  atualizado_em timestamptz not null default now()
);
insert into a1_site_config (id) values (1) on conflict (id) do nothing;

alter table a1_site_config enable row level security;
drop policy if exists site_config_leitura on a1_site_config;
create policy site_config_leitura on a1_site_config for select using (true);
revoke all on a1_site_config from anon, authenticated;
grant select on a1_site_config to anon, authenticated;

-- =============================================================================
-- 2. ITENS DA PÁGINA DE LINKS
-- =============================================================================
-- banner    imagem clicável (campanha, oferta). Pode ter início e fim.
-- destaque  botão cheio, o chamado principal ("Fale com um consultor").
-- link      botão comum.
-- secao     um título pequeno que separa grupos de botões.
create table if not exists a1_site_links (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null default 'link' check (tipo in ('banner', 'destaque', 'link', 'secao')),
  titulo     text not null,
  subtitulo  text,
  url        text,
  imagem_url text,
  icone      text,             -- chave de um ícone do site (whatsapp, instagram, blog...)
  nova_aba   boolean not null default true,
  ordem      int not null default 0,
  ativo      boolean not null default true,
  inicio_em  timestamptz,      -- campanha: aparece a partir de
  fim_em     timestamptz,      -- campanha: some depois de
  cliques    bigint not null default 0,
  criado_em  timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint a1_site_links_url_chk check (
    tipo = 'secao' or (url is not null and (url ~* '^https?://' or url ~ '^/' or url ~* '^(mailto|tel):'))
  ),
  constraint a1_site_links_banner_chk check (tipo <> 'banner' or imagem_url is not null)
);
create index if not exists idx_site_links_ordem on a1_site_links (ordem, criado_em);

alter table a1_site_links enable row level security;
drop policy if exists site_links_leitura on a1_site_links;
create policy site_links_leitura on a1_site_links for select using (
  ativo and (inicio_em is null or inicio_em <= now()) and (fim_em is null or fim_em > now())
);
revoke all on a1_site_links from anon, authenticated;
grant select on a1_site_links to anon, authenticated;

-- O clique conta pela função: a tabela não aceita escrita pública, e a função
-- só soma 1 num item que está no ar.
create or replace function a1_site_link_clique(p_id uuid)
returns void language sql security definer
set search_path = public, extensions, pg_temp as $$
  update a1_site_links set cliques = cliques + 1
   where id = p_id and ativo
     and (inicio_em is null or inicio_em <= now()) and (fim_em is null or fim_em > now());
$$;
revoke all on function a1_site_link_clique(uuid) from public;
grant execute on function a1_site_link_clique(uuid) to anon, authenticated;

-- Ponto de partida: os três caminhos que já existem no site. O resto (WhatsApp,
-- Instagram, banners) o superadmin cadastra com os endereços de verdade.
insert into a1_site_links (tipo, titulo, subtitulo, url, icone, nova_aba, ordem)
select * from (values
  ('destaque', 'Conheça o SIIMOB', 'CRM imobiliário do lead ao registro', '/conheca', 'site', false, 10),
  ('link', 'Blog', null, '/blog', 'blog', false, 20),
  ('link', 'Contato', null, '/contato', 'contato', false, 30)
) v(tipo, titulo, subtitulo, url, icone, nova_aba, ordem)
where not exists (select 1 from a1_site_links);

-- =============================================================================
-- 3. BLOG
-- =============================================================================
create table if not exists a1_blog_posts (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  titulo        text not null,
  resumo        text,
  conteudo      text not null default '',   -- Markdown simples (títulos, listas, negrito, links, imagens)
  capa_url      text,
  categoria     text not null default 'Dicas',
  autor         text,
  tempo_leitura int,                         -- minutos; calculado ao salvar
  destaque      boolean not null default false,
  publicado     boolean not null default false,
  publicado_em  timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_blog_publicados on a1_blog_posts (publicado, publicado_em desc);

alter table a1_blog_posts enable row level security;
drop policy if exists blog_leitura on a1_blog_posts;
create policy blog_leitura on a1_blog_posts for select using (
  publicado and publicado_em is not null and publicado_em <= now()
);
revoke all on a1_blog_posts from anon, authenticated;
grant select on a1_blog_posts to anon, authenticated;

-- atualizado_em anda sozinho nas três tabelas.
create or replace function a1_site_tocar()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;
revoke execute on function a1_site_tocar() from public, anon, authenticated;
drop trigger if exists trg_site_config_tocar on a1_site_config;
create trigger trg_site_config_tocar before update on a1_site_config
  for each row execute function a1_site_tocar();
drop trigger if exists trg_site_links_tocar on a1_site_links;
create trigger trg_site_links_tocar before update on a1_site_links
  for each row when (old.cliques is not distinct from new.cliques)
  execute function a1_site_tocar();
drop trigger if exists trg_blog_tocar on a1_blog_posts;
create trigger trg_blog_tocar before update on a1_blog_posts
  for each row execute function a1_site_tocar();

-- =============================================================================
-- 4. IMAGENS (bucket público "site")
-- =============================================================================
-- Banner, capa de post e imagem no meio do texto: conteúdo público por
-- definição. Só imagem, até 5 MB. Quem envia é o superadmin, com a chave de
-- serviço; a chave pública não tem política de escrita aqui.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site', 'site', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- =============================================================================
-- COMO CONFERIR
--   select * from a1_site_config;                       -- uma linha, canais vazios
--   select tipo, titulo, url from a1_site_links order by ordem;
--   select count(*) from a1_blog_posts;                 -- 0
--   select id, public from storage.buckets where id = 'site';
-- =============================================================================
