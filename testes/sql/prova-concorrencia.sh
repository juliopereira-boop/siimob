#!/usr/bin/env bash
# Dois cliques, dois navegadores, dois retries. Aqui o teste é de verdade:
# várias conexões disparando a MESMA ação ao mesmo tempo, e não uma depois da
# outra. Foi assim que a primeira versão do gatilho foi pega criando três
# cartões de repasse para o mesmo comercial.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORTA="${PGPORT:-5473}"
BANCO="corrida_$(date +%s)"
Q() { psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -q -t -A -v ON_ERROR_STOP=1 "$@"; }

psql -h 127.0.0.1 -p "$PORTA" -U postgres -q -c "create database $BANCO"
trap 'psql -h 127.0.0.1 -p "$PORTA" -U postgres -q -c "drop database if exists $BANCO" >/dev/null' EXIT

for f in testes/sql/base-falsa.sql database/migrations/2026-09-04_identidade.sql \
         database/migrations/2026-09-04_pre_analise.sql database/migrations/2026-09-04_comercial.sql \
         database/migrations/2026-09-04_gatilhos.sql; do
  psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -q -v ON_ERROR_STOP=1 -f "$f"
done

T=11111111-1111-1111-1111-111111111111
Q <<SQL
insert into a1_tenants (id, name, slug) values ('$T','THE CRED','thecred');
insert into a1_modules (key,name) values ('repasse','R'),('PRE_ANALISE','P'),('COMERCIAL','C');
insert into a1_tenant_modules (tenant_id, module_key) values
  ('$T','repasse'),('$T','PRE_ANALISE'),('$T','COMERCIAL');
insert into a1_stages (id,tenant_id,module_key,name,position,is_initial)
  values ('c0000000-0000-0000-0000-000000000001','$T','repasse','Entrada',0,true);
insert into a1_users (id,tenant_id,name,role)
  values ('a0000000-0000-0000-0000-000000000001','$T','Gestor','owner');
insert into a1_sessions (token,tenant_id,user_id,role)
  values ('tk-gestor','$T','a0000000-0000-0000-0000-000000000001','owner');
insert into a1_pa_situacoes (id,tenant_id,nome,flag,ordem) values
  ('50000000-0000-0000-0000-000000000001','$T','Nova','INICIAL',0),
  ('50000000-0000-0000-0000-000000000002','$T','Aprovada','APROVADO',1);
insert into a1_co_situacoes (id,tenant_id,nome,flag,ordem)
  values ('60000000-0000-0000-0000-000000000001','$T','Proposta','INICIAL',0);
insert into a1_pa_transicoes (tenant_id,de_id,para_id,acao,acao_modo) values
  ('$T','50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002',
   'ENABLE_COMMERCIAL','AUTO');
insert into a1_pa_pessoas (id,tenant_id,nome,documento)
  values ('70000000-0000-0000-0000-000000000001','$T','Maria Cliente','52998224725');
insert into a1_pre_analises (id,tenant_id,empreendimento_id,unidade,situacao_id)
  values ('80000000-0000-0000-0000-000000000001','$T',
          'd0000000-0000-0000-0000-000000000001','101',
          '50000000-0000-0000-0000-000000000001');
insert into a1_pa_participantes (tenant_id,pre_analise_id,pessoa_id,papel)
  values ('$T','80000000-0000-0000-0000-000000000001',
          '70000000-0000-0000-0000-000000000001','TITULAR');
insert into a1_pa_analises_credito
  (tenant_id,pre_analise_id,status,valor_aprovado,valor_subsidio,valor_fgts,valor_total)
  values ('$T','80000000-0000-0000-0000-000000000001','APROVADO',20000000,0,0,20000000);
SQL

echo "== 8 tentativas SIMULTÂNEAS de criar o Comercial da mesma pré-análise =="
for i in $(seq 1 8); do
  Q -c "set role anon; select teste_entrar('tk-gestor');
        select a1_pa_executar_acao('80000000-0000-0000-0000-000000000001',
                                   'ENABLE_COMMERCIAL')" >/dev/null 2>&1 &
done
wait
N_CO=$(Q -c "select count(*) from a1_comerciais")
echo "comerciais criados: $N_CO  (esperado: 1)"

CO=$(Q -c "select id from a1_comerciais limit 1")
echo "== 8 tentativas SIMULTÂNEAS de criar o Repasse do mesmo comercial =="
for i in $(seq 1 8); do
  Q -c "set role anon; select teste_entrar('tk-gestor');
        select a1_co_executar_acao('$CO','CREATE_REPASS')" >/dev/null 2>&1 &
done
wait
N_CASE=$(Q -c "select count(*) from a1_cases where payload->>'origem' = 'comercial'")
N_VINC=$(Q -c "select count(distinct repasse_case_id) from a1_comerciais
                where repasse_case_id is not null")
echo "cartões de repasse criados: $N_CASE  (esperado: 1)"
echo "vínculos distintos: $N_VINC  (esperado: 1)"

# ─── Disposição: a mesma unidade, oito corretores, o mesmo segundo ───────────
psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -q -v ON_ERROR_STOP=1 \
     -c "alter table a1_co_situacoes add column if not exists selo text" \
     -f database/migrations/2026-11-02_disposicao_unidades.sql 2>/dev/null
Q <<SQL
insert into a1_modules (key,name) values ('DISPOSICAO','D') on conflict do nothing;
insert into a1_tenant_modules (tenant_id, module_key) values ('$T','DISPOSICAO');
insert into a1_developments (id, tenant_id, name, units)
  values ('d1000000-0000-0000-0000-000000000001','$T','Residencial','["B1-101"]');
set role anon;
select teste_entrar('tk-gestor');
select a1_unidades_materializar('d1000000-0000-0000-0000-000000000001');
insert into a1_parametros_pagamento (id, tenant_id, nome, serie)
  values ('9a000000-0000-0000-0000-000000000001','$T','Ato','ATO');
insert into a1_mapas_preco (id, tenant_id, empreendimento_id, nome)
  values ('3a000000-0000-0000-0000-000000000001','$T','d1000000-0000-0000-0000-000000000001','Lançamento');
insert into a1_mapa_preco_itens (tenant_id, mapa_id, unidade_id, valor)
  select '$T','3a000000-0000-0000-0000-000000000001', id, 200000 from a1_unidades;
select a1_mapa_preco_ativar('3a000000-0000-0000-0000-000000000001');
SQL
UN=$(Q -c "select id from a1_unidades where codigo = 'B1-101'")

echo "== 8 reservas SIMULTÂNEAS da mesma unidade =="
for i in $(seq 1 8); do
  Q -c "set role anon; select teste_entrar('tk-gestor');
        select a1_unidade_reservar('$UN',
          '{\"titular\":{\"nome\":\"Cliente $i\",\"cpf\":\"5299822472$((i % 10))\"}}',
          '[{\"parametro_id\":\"9a000000-0000-0000-0000-000000000001\",\"valor\":200000,\"quantidade\":1,\"primeiro_vencimento\":\"2026-12-01\"}]')" >/dev/null 2>&1 &
done
wait
N_RS=$(Q -c "select count(*) from a1_reservas where unidade_id = '$UN' and status = 'ATIVA'")
N_RS_TOT=$(Q -c "select count(*) from a1_reservas where unidade_id = '$UN'")
N_CO_UN=$(Q -c "select count(*) from a1_comerciais where unidade_id = '$UN'")
ST_UN=$(Q -c "select status || '/' || versao from a1_unidades where id = '$UN'")
echo "reservas da unidade: $N_RS_TOT, ativas: $N_RS  (esperado: 1 e 1)"
echo "vendas abertas para a unidade: $N_CO_UN  (esperado: 1)"
echo "situação da unidade: $ST_UN  (esperado: reservado/2)"

if [ "$N_CO" = "1" ] && [ "$N_CASE" = "1" ] && [ "$N_VINC" = "1" ] \
   && [ "$N_RS" = "1" ] && [ "$N_RS_TOT" = "1" ] && [ "$N_CO_UN" = "1" ] && [ "$ST_UN" = "reservado/2" ]; then
  echo "PROVA DE CONCORRÊNCIA APROVADA"
else
  echo "PROVA DE CONCORRÊNCIA REPROVADA"; exit 1
fi
