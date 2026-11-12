-- =============================================================================
-- PROVA DO SITE PÚBLICO (links, contato, blog)
--
-- Quem visita /links, /contato e /blog chega como 'anon', sem token. A prova
-- confere, como anon, o que ele lê e, principalmente, o que ele NÃO consegue
-- escrever. O cenário é montado como dono do banco (o papel do superadmin, que
-- usa a chave de serviço) e conferido como anon.
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;

-- ─── Cenário (como o superadmin) ─────────────────────────────────────────────
update a1_site_config set whatsapp = '5598999990000', email = 'contato@siimob.com.br' where id = 1;
delete from a1_site_links;
insert into a1_site_links (id, tipo, titulo, url, imagem_url, ativo, inicio_em, fim_em, ordem) values
  ('5e000000-0000-0000-0000-000000000001', 'destaque', 'Fale com a gente', 'https://wa.me/5598999990000', null, true, null, null, 1),
  ('5e000000-0000-0000-0000-000000000002', 'banner', 'Campanha no ar', '/conheca', 'https://x/banner.png', true, now() - interval '1 day', now() + interval '1 day', 2),
  ('5e000000-0000-0000-0000-000000000003', 'link', 'Desligado', '/blog', null, false, null, null, 3),
  ('5e000000-0000-0000-0000-000000000004', 'banner', 'Campanha que acabou', '/conheca', 'https://x/b.png', true, null, now() - interval '1 hour', 4),
  ('5e000000-0000-0000-0000-000000000005', 'banner', 'Campanha futura', '/conheca', 'https://x/c.png', true, now() + interval '1 day', null, 5),
  ('5e000000-0000-0000-0000-000000000006', 'secao', 'Redes', null, null, true, null, null, 6);
delete from a1_blog_posts;
insert into a1_blog_posts (slug, titulo, conteudo, publicado, publicado_em) values
  ('no-ar', 'Post no ar', 'texto', true, now() - interval '1 day'),
  ('rascunho', 'Rascunho', 'texto', false, null),
  ('agendado', 'Agendado', 'texto', true, now() + interval '2 days');

\o /dev/null
set role anon;

-- ─── Leitura ─────────────────────────────────────────────────────────────────
select checa('a chave pública lê a configuração do site (uma linha)',
  (select count(*) from a1_site_config) = 1);
select checa('e lê só os itens de link ativos e dentro da campanha',
  (select string_agg(titulo, '|' order by ordem) from a1_site_links) = 'Fale com a gente|Campanha no ar|Redes',
  (select string_agg(titulo, '|' order by ordem) from a1_site_links));
select checa('do blog, só o post publicado e com a data já chegada',
  (select string_agg(slug, '|') from a1_blog_posts) = 'no-ar',
  (select string_agg(slug, '|') from a1_blog_posts));

-- ─── Escrita: nenhuma ────────────────────────────────────────────────────────
select checa('a chave pública não altera a configuração',
  tenta($$update a1_site_config set whatsapp = '0' where id = 1$$) is not null);
select checa('não cria item de link',
  tenta($$insert into a1_site_links (tipo, titulo, url) values ('link', 'golpe', 'https://golpe')$$) is not null);
select checa('não altera item de link',
  tenta($$update a1_site_links set url = 'https://golpe'$$) is not null);
select checa('não apaga item de link',
  tenta($$delete from a1_site_links$$) is not null);
select checa('não cria post',
  tenta($$insert into a1_blog_posts (slug, titulo) values ('golpe', 'golpe')$$) is not null);
select checa('não publica rascunho',
  tenta($$update a1_blog_posts set publicado = true, publicado_em = now() where slug = 'rascunho'$$) is not null);

-- ─── Clique ──────────────────────────────────────────────────────────────────
select a1_site_link_clique('5e000000-0000-0000-0000-000000000001');
select a1_site_link_clique('5e000000-0000-0000-0000-000000000001');
select a1_site_link_clique('5e000000-0000-0000-0000-000000000003');
select a1_site_link_clique('5e000000-0000-0000-0000-000000000004');
reset role;
select checa('o clique conta no item que está no ar',
  (select cliques from a1_site_links where id = '5e000000-0000-0000-0000-000000000001') = 2);
select checa('e não conta em item desligado nem em campanha encerrada',
  (select sum(cliques) from a1_site_links where id in ('5e000000-0000-0000-0000-000000000003',
                                                       '5e000000-0000-0000-0000-000000000004')) = 0);
select checa('contar clique não mexe no atualizado_em do item',
  (select atualizado_em = criado_em from a1_site_links where id = '5e000000-0000-0000-0000-000000000001'));

-- ─── Regras de formato (valem até para o superadmin) ─────────────────────────
select checa('link com javascript: é recusado',
  tenta($$insert into a1_site_links (tipo, titulo, url) values ('link', 'x', 'javascript:alert(1)')$$)
  like '%a1_site_links_url_chk%');
select checa('botão sem endereço é recusado',
  tenta($$insert into a1_site_links (tipo, titulo) values ('link', 'x')$$) like '%a1_site_links_url_chk%');
select checa('título de seção não precisa de endereço',
  tenta($$insert into a1_site_links (tipo, titulo) values ('secao', 'Outra seção')$$) is null);
select checa('banner sem imagem é recusado',
  tenta($$insert into a1_site_links (tipo, titulo, url) values ('banner', 'x', '/conheca')$$)
  like '%a1_site_links_banner_chk%');
select checa('endereço do post só com letras minúsculas, números e hífen',
  tenta($$insert into a1_blog_posts (slug, titulo) values ('Olá Mundo', 'x')$$) is not null);
select checa('dois posts não dividem o mesmo endereço',
  tenta($$insert into a1_blog_posts (slug, titulo) values ('no-ar', 'x')$$) like '%duplicate%');
select checa('a configuração tem uma linha só',
  tenta($$insert into a1_site_config (id) values (2)$$) is not null);
select checa('o bucket de imagens do site é público e só aceita imagem',
  (select public and not ('image/svg+xml' = any(allowed_mime_types)) from storage.buckets where id = 'site'));

-- =============================================================================
\o
\echo ''
\echo '───────────────────────────────────────────────────────────────'
select n, case when passou then 'ok  ' else 'FALHOU' end as r, descr,
       coalesce(detalhe,'') as detalhe
  from prova order by n;
\echo '───────────────────────────────────────────────────────────────'
select count(*) filter (where passou) as passaram,
       count(*) filter (where not passou) as falharam,
       count(*) as total from prova;

do $$
declare f int;
begin
  select count(*) into f from prova where not passou;
  if f > 0 then raise exception 'PROVA DO SITE REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DO SITE APROVADA';
end $$;
