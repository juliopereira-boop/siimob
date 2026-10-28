-- =============================================================================
-- A LANDING PAGE VOLTA A CAPTAR — sem reabrir o buraco que foi fechado
--
-- O DEFEITO: desde 2026-09-13_harden_direct_table_access.sql, o formulário do
-- site do SIIMOB (lp.html) recebe `permission denied for table a1_leads` em
-- todo envio. Aquele arquivo fez `revoke insert ... from anon` e derrubou a
-- policy `leads_public_insert`. Medido em produção, como navegador anônimo:
--
--     INSERT em a1_leads como anon  ->  42501: permission denied
--     a1_leads                      ->  0 registros
--
-- Todo interessado que preencheu o formulário desde então recebeu erro. Não há
-- como saber quantos foram: o que não entrou não deixou rastro.
--
-- O ENDURECIMENTO ESTAVA CERTO. a1_leads é a caixa de prospects do NOSSO
-- negócio, exposta à internet inteira pela chave pública: sem regra, qualquer
-- um insere lixo em massa, e pior, qualquer um LÊ a lista de quem se
-- interessou pelo produto — nome, empresa, telefone e volume de operação de
-- cada prospect. O erro não foi fechar; foi fechar sem ver quem legitimamente
-- escrevia ali.
--
-- A DIFERENÇA DESTE ARQUIVO para o estado anterior ao harden: a porta que
-- reabre é estreita.
--   · INSERT é concedido COLUNA A COLUNA, só as sete do formulário. `status`,
--     `notes` e `id` ficam de fora: quem posta do site não decide em que
--     estágio do funil o próprio lead nasce, nem escreve anotação interna.
--   · A política exige source = 'landing'. O formulário é a única origem
--     pública; importação e cadastro manual continuam sendo da service_role.
--   · SELECT, UPDATE e DELETE continuam NEGADOS para anon e authenticated. A
--     lista segue ilegível pela chave pública — é por isso que lp.html manda
--     `Prefer: return=minimal`, e ele não precisa de leitura nenhuma.
--
-- O QUE NÃO MUDA: as demais travas do harden (a1_acessos, a1_indicacoes,
-- a1_indicadores, a1_checklist_conclusoes) ficam como estão.
-- =============================================================================

alter table a1_leads enable row level security;

-- Sem SELECT: a lista de prospects não é legível pela chave pública, e é isso
-- que impede alguém de baixar a carteira comercial do SIIMOB inteira.
revoke all on a1_leads from anon, authenticated;
grant insert (name, company, email, phone, segment, volume, message, source)
  on a1_leads to anon, authenticated;

drop policy if exists leads_public_insert on a1_leads;
create policy leads_public_insert on a1_leads for insert
  to anon, authenticated
  with check (
    source = 'landing'
    and name  is not null and length(btrim(name))  between 2 and 200
    and email is not null and length(btrim(email)) between 5 and 200
    and email like '%@%.%'
    and coalesce(length(message), 0) <= 4000
  );

-- =============================================================================
-- COMO CONFERIR
--
--   set role anon;
--   insert into a1_leads (name, email, source)
--   values ('Fulano de Teste','fulano@exemplo.com','landing');   -- passa
--
--   select * from a1_leads;                                      -- recusado
--   insert into a1_leads (name, email, source, status)
--   values ('X','x@y.com','landing','ganho');                    -- recusado
--   reset role;
--
-- E no site: envie o formulário de lp.html e confirme que a linha entrou.
-- =============================================================================
