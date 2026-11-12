-- =============================================================================
-- PROVA DO LOGIN DO SUPERADMIN POR AUTENTICADOR
--
-- Quem chama as funções em produção é a Edge Function sa-proxy, com a chave de
-- serviço (papel service_role). A prova confere o código TOTP contra o vetor
-- do RFC 6238, a sessão, o anti-reuso, a trava de tentativas e, como anon, que
-- nada disso é alcançável pela chave pública.
-- =============================================================================
\set ON_ERROR_STOP on
truncate prova;
delete from a1_sa_totp;
delete from a1_sa_sessoes;
delete from a1_sa_tentativas;
create table if not exists sa_teste (k text primary key, v text);
truncate sa_teste;

-- O segredo de teste (20 bytes) e os códigos de agora e do próximo passo.
insert into sa_teste values
  ('seg', '3132333435363738393031323334353637383930'),
  ('agora', a1_sa_totp_codigo(decode('3132333435363738393031323334353637383930', 'hex'), a1_sa_passo_agora())),
  ('prox', a1_sa_totp_codigo(decode('3132333435363738393031323334353637383930', 'hex'), a1_sa_passo_agora() + 1));
create or replace function sa(k text) returns text language sql as $$ select v from sa_teste where sa_teste.k = sa.k $$;
grant select, insert on sa_teste to service_role;
-- No Supabase a service_role tem acesso às tabelas por padrão; aqui, de propósito.
grant all on a1_sa_totp, a1_sa_sessoes, a1_sa_tentativas to service_role;

\o /dev/null
-- ─── O algoritmo ─────────────────────────────────────────────────────────────
select checa('TOTP confere com o RFC 6238 (tempo 59)',
  a1_sa_totp_codigo(convert_to('12345678901234567890', 'UTF8'), 1) = '287082');
select checa('TOTP confere com o RFC 6238 (tempo 1111111109)',
  a1_sa_totp_codigo(convert_to('12345678901234567890', 'UTF8'), 37037036) = '081804');

-- ─── A chave pública não alcança nada ────────────────────────────────────────
set role anon;
select checa('anon não lê o segredo', tenta($$select * from a1_sa_totp$$) is not null);
select checa('anon não lê as sessões', tenta($$select * from a1_sa_sessoes$$) is not null);
select checa('anon não chama o login', tenta($$select a1_sa_login('000000')$$) is not null);
select checa('anon não valida sessão', tenta($$select a1_sa_sessao_valida(repeat('a', 64))$$) is not null);
select checa('anon não cadastra autenticador', tenta($$select a1_sa_totp_cadastrar(repeat('a', 40), '000000')$$) is not null);
select checa('anon não destrava o login', tenta($$select a1_sa_destravar()$$) is not null);
reset role;

set role service_role;
-- ─── Cadastro ────────────────────────────────────────────────────────────────
select checa('antes do cadastro, o login diz que falta configurar',
  (a1_sa_login('123456', '1.1.1.1')->>'erro') = 'nao_configurado');
select checa('cadastro com código errado não grava',
  (a1_sa_totp_cadastrar(sa('seg'), lpad(((sa('agora')::int + 1) % 1000000)::text, 6, '0'))->>'erro') = 'codigo_invalido'
  and not (a1_sa_totp_status()->>'configurado')::boolean);
select checa('cadastro com o código certo grava',
  (a1_sa_totp_cadastrar(sa('seg'), sa('agora'))->>'ok')::boolean
  and (a1_sa_totp_status()->>'configurado')::boolean);

-- ─── Login ───────────────────────────────────────────────────────────────────
select checa('o código usado no cadastro não abre sessão (anti-reuso)',
  (a1_sa_login(sa('agora'), '1.1.1.1')->>'erro') = 'codigo_invalido');
insert into sa_teste select 'login', a1_sa_login(sa('prox'), '1.1.1.1', 'Teste')::text;
select checa('o código seguinte abre a sessão',
  (sa('login')::json->>'ok')::boolean and (sa('login')::json->>'token') ~ '^[0-9a-f]{64}$', sa('login'));
select checa('o mesmo código não vale duas vezes',
  (a1_sa_login(sa('prox'), '1.1.1.1')->>'erro') = 'codigo_invalido');
select checa('a sessão vale', a1_sa_sessao_valida(sa('login')::json->>'token'));
select checa('token inventado não vale', not a1_sa_sessao_valida(repeat('b', 64)));
select checa('o banco guarda só o hash da sessão',
  not exists (select 1 from a1_sa_sessoes where token_hash = sa('login')::json->>'token'));
select a1_sa_sair(sa('login')::json->>'token');
select checa('sair encerra a sessão', not a1_sa_sessao_valida(sa('login')::json->>'token'));

-- ─── Trava de tentativas ─────────────────────────────────────────────────────
-- Os códigos de agora e do próximo passo já foram usados acima; o cenário volta
-- o anti-reuso para liberá-los, para a trava ser a única coisa testada aqui.
reset role;
update a1_sa_totp set ultimo_passo = a1_sa_passo_agora() - 2;
set role service_role;
select a1_sa_login('000001', '9.9.9.9'), a1_sa_login('000002', '9.9.9.9'), a1_sa_login('000003', '9.9.9.9'),
       a1_sa_login('000004', '9.9.9.9');
select checa('a quinta tentativa errada avisa quantas restam',
  (a1_sa_login('000005', '9.9.9.9')->>'restantes') = '0');
select checa('depois de 5 erros o IP fica travado, mesmo com o código certo',
  (a1_sa_login(sa('agora'), '9.9.9.9')->>'erro') = 'bloqueado');
select checa('outro IP continua entrando',
  (a1_sa_login(sa('agora'), '2.2.2.2')->>'ok')::boolean);

-- ─── Recadastro derruba as sessões ───────────────────────────────────────────
select checa('há sessão aberta antes do recadastro', exists (select 1 from a1_sa_sessoes));
select a1_sa_totp_cadastrar('6162636465666768696a6b6c6d6e6f7071727374',
  a1_sa_totp_codigo(decode('6162636465666768696a6b6c6d6e6f7071727374', 'hex'), a1_sa_passo_agora()));
select checa('recadastrar o autenticador encerra todas as sessões', not exists (select 1 from a1_sa_sessoes));
select checa('sair de todas devolve quantas encerrou', a1_sa_sair_todas() = 0);

-- ─── Trava geral (IP forjado no cabeçalho não escapa) ────────────────────────
reset role;
update a1_sa_totp set segredo = decode(sa('seg'), 'hex'), ultimo_passo = a1_sa_passo_agora() - 2;
set role service_role;
select checa('antes dos erros, o login não está travado', not (a1_sa_totp_status()->>'travado')::boolean);
select a1_sa_login('000000', '10.0.0.' || i) from generate_series(1, 10) i;
select checa('10 erros de IPs diferentes travam o login inteiro',
  (a1_sa_login(sa('agora'), '10.9.9.9')->>'erro') = 'bloqueado');
select checa('o status mostra que travou', (a1_sa_totp_status()->>'travado')::boolean);
select a1_sa_destravar();
select checa('liberar destrava', not (a1_sa_totp_status()->>'travado')::boolean);
select checa('e o código certo volta a entrar', (a1_sa_login(sa('agora'), '10.9.9.9')->>'ok')::boolean);
reset role;
-- 30 erros em 24 h, um a cada 40 minutos: nenhum cai na regra dos 15 minutos.
update a1_sa_totp set ultimo_passo = a1_sa_passo_agora() - 2;
delete from a1_sa_tentativas;
insert into a1_sa_tentativas (em, ip, ok)
  select now() - make_interval(mins => 40 * i), '11.0.0.' || i, false from generate_series(1, 30) i;
set role service_role;
select checa('30 erros em 24 h travam, mesmo espaçados',
  (a1_sa_login(sa('agora'), '12.0.0.1')->>'erro') = 'bloqueado');
reset role;

-- =============================================================================
\o
\echo ''
select n, case when passou then 'ok  ' else 'FALHOU' end as r, descr,
       coalesce(detalhe,'') as detalhe
  from prova order by n;
select count(*) filter (where passou) as passaram,
       count(*) filter (where not passou) as falharam,
       count(*) as total from prova;
do $$
declare f int;
begin
  select count(*) into f from prova where not passou;
  if f > 0 then raise exception 'PROVA DO AUTENTICADOR REPROVADA: % verificações falharam', f; end if;
  raise notice 'PROVA DO AUTENTICADOR APROVADA';
end $$;
drop function sa(text);
drop table sa_teste;
