-- =============================================================================
-- CONFERIR A ESTEIRA DO COMERCIAL — por que um cartão pode não mover
--
-- POR QUE ESTE ARQUIVO EXISTE
--
-- O relato foi "no Comercial o cartão não se move". A causa estava na tela — o
-- quadro do Comercial nunca teve arrastar: o cartão não tinha `draggable`, a
-- coluna não tinha `ondrop`, e mover só existia enterrado no rodapé do dossiê.
-- Isso foi corrigido em comercial.html e NÃO depende de nenhum SQL.
--
-- Só que, com o arrasto ligado, aparece a segunda razão possível para um cartão
-- não andar, e essa é de CADASTRO, não de código: a esteira do cliente pode não
-- ter aresta nenhuma saindo da situação em que o cartão está. O banco recusa
-- com `transicao_nao_permitida`, e a tela agora diz isso com todas as letras —
-- inclusive listando para onde dá para ir. Se a lista vier vazia, é porque o
-- fluxo não foi desenhado, e quem desenha é um gestor em
-- Configurações › Workflow do Comercial.
--
-- Este arquivo serve para saber ANTES de abrir a tela em qual dos dois casos o
-- cliente está.
--
-- O QUE ELE **NÃO** MUDA
--
-- Nada. É só leitura: nenhum create, nenhum alter, nenhum update, nenhum grant,
-- nenhuma política. Roda quantas vezes quiser, em produção, a qualquer hora, e
-- não escreve uma linha. Não substitui nem depende de
-- `2026-09-10_chaves_dos_modulos.sql` (esse continua pendente e continua sendo
-- o que faz `co_editar` valer no banco; hoje a tela é mais restrita que a API,
-- que é o lado seguro da divergência).
--
-- COMO LER O RESULTADO
--
-- Rode como dono do banco, no editor do Supabase. As consultas devolvem uma
-- linha por cliente/situação. O que interessa é a coluna `diagnostico`.
-- =============================================================================

-- ── 1. A esteira existe? ─────────────────────────────────────────────────────
-- Cliente com licença do Comercial e ZERO situações não tem quadro nenhum: a
-- tela mostra "A esteira do Comercial ainda não foi configurada".
select t.id                                          as tenant_id,
       t.name                                        as cliente,
       count(distinct s.id) filter (where s.ativo)   as situacoes_ativas,
       count(distinct tr.id) filter (where tr.ativo) as arestas_ativas,
       case
         when count(distinct s.id) filter (where s.ativo) = 0
           then 'SEM ESTEIRA — nenhuma situação ativa; desenhar em Configurações > Workflow do Comercial'
         when count(distinct tr.id) filter (where tr.ativo) = 0
           then 'SEM ARESTAS — as colunas existem, mas nada liga uma na outra: nenhum cartão move'
         else 'ok'
       end                                           as diagnostico
  from a1_tenants t
  join a1_tenant_modules tm
       on tm.tenant_id = t.id and tm.module_key = 'COMERCIAL'
      and (tm.expires_at is null or tm.expires_at > now())
  left join a1_co_situacoes  s  on s.tenant_id  = t.id
  left join a1_co_transicoes tr on tr.tenant_id = t.id
 group by t.id, t.name
 order by t.name;

-- ── 2. Quais situações são beco sem saída ────────────────────────────────────
-- Uma situação sem aresta de saída (nem uma aresta com de_id nulo, que vale
-- "de qualquer situação") prende todo cartão que chegar nela. É esta a consulta
-- que responde "por que ESTE cartão não sai daqui".
select t.name                                as cliente,
       s.nome                                as situacao,
       s.ordem,
       count(c.id)                           as cartoes_parados_aqui,
       case when exists (select 1 from a1_co_transicoes tr
                          where tr.tenant_id = s.tenant_id and tr.ativo
                            and (tr.de_id is null or tr.de_id = s.id)
                            and tr.para_id <> s.id)
            then 'tem saída'
            else 'BECO SEM SAÍDA — nenhum cartão desta coluna pode ser movido'
       end                                   as diagnostico
  from a1_co_situacoes s
  join a1_tenants t on t.id = s.tenant_id
  left join a1_comerciais c on c.situacao_id = s.id
 where s.ativo
 group by t.name, s.tenant_id, s.id, s.nome, s.ordem
 order by t.name, s.ordem;

-- ── 3. Quem, hoje, passa em co_editar ────────────────────────────────────────
-- O falso positivo a descartar antes de culpar o código: mover no Comercial
-- exige `co_editar`. Gestores (a1_users) não aparecem aqui porque passam por
-- a1_e_gestor() e não dependem da chave. Parceiro com `gerente` vale por cima.
-- Chave AUSENTE é 'não pode' — é assim que a1_perm() termina (coalesce false).
select t.name                                             as cliente,
       p.name                                             as pessoa,
       p.type                                             as tipo,
       coalesce(pf.nome, '(sem perfil)')                  as perfil,
       coalesce(pf.permissions, p.permissions) ->> 'co_ver'    as co_ver,
       coalesce(pf.permissions, p.permissions) ->> 'co_editar'  as co_editar,
       case
         when (coalesce(pf.permissions, p.permissions) ->> 'gerente')   in ('true','t','1') then 'move (gerente vale por cima)'
         when (coalesce(pf.permissions, p.permissions) ->> 'co_editar') in ('true','t','1') then 'move'
         when (coalesce(pf.permissions, p.permissions) ->> 'co_ver')    in ('true','t','1') then 'só acompanha — NÃO mover está correto para esta pessoa'
         else 'nem abre o módulo (falta co_ver)'
       end                                                as diagnostico
  from a1_partners p
  join a1_tenants t on t.id = p.tenant_id
  left join a1_perfis pf on pf.id = p.perfil_id and pf.ativo
 where p.is_active
   and exists (select 1 from a1_tenant_modules tm
                where tm.tenant_id = p.tenant_id and tm.module_key = 'COMERCIAL'
                  and (tm.expires_at is null or tm.expires_at > now()))
 order by t.name, p.name;

-- =============================================================================
-- COMO CONFERIR QUE RODOU
--   As três consultas devolvem linhas e nada mais acontece. Para provar que o
--   arquivo não escreveu nada:
--
--     select xact_commit from pg_stat_database where datname = current_database();
--
--   antes e depois — a diferença é só das leituras acima, e
--
--     select count(*) from a1_comerciais;
--     select max(versao) from a1_comerciais;
--
--   não mudam.
--
-- O QUE FAZER COM O RESULTADO
--   · 'SEM ESTEIRA' ou 'SEM ARESTAS' na consulta 1 → desenhar o fluxo em
--     Configurações › Workflow do Comercial. Nenhum código resolve isso.
--   · 'BECO SEM SAÍDA' na consulta 2 → é a coluna onde os cartões param; ligar
--     uma seta saindo dela.
--   · 'só acompanha' na consulta 3 → é cadastro, e está certo: essa pessoa não
--     deve mover. O "Corretor teste" do cliente de demonstração é este caso.
-- =============================================================================
