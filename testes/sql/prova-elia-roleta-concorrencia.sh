#!/usr/bin/env bash
set -euo pipefail
# Usa apenas um banco temporário isolado no container de testes informado.
container="${SIIMOB_PG_CONTAINER:?Informe SIIMOB_PG_CONTAINER para o Postgres de teste}"
banco="elia_roleta_corrida_$(date +%s)_$$"
docker exec "$container" createdb -U postgres "$banco"
run() { docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d "$banco" "$@"; }
run < testes/sql/elia-roleta-fixture.sql
run < supabase/migrations/20261122171900_elia_roleta_qualificacao.sql
run <<'SQL'
insert into a1_elia_config values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true,'[{"id":"roleta","type":"roulette","fields":["renda"]}]');
insert into a1_stages values ('44444444-4444-4444-4444-444444444444','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','crm','vendas','EM_ATENDIMENTO','Em atendimento');
insert into a1_partners values ('66666666-6666-6666-6666-666666666666','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','corretor',true,true,'Um','{}'),('77777777-7777-7777-7777-777777777777','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','corretor',true,true,'Dois','{}');
insert into a1_lead_roleta values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',array['66666666-6666-6666-6666-666666666666'::uuid,'77777777-7777-7777-7777-777777777777'::uuid],null,null);
insert into a1_cases(id,tenant_id,module_key,payload,client_name,stage_id) select ('11111111-1111-1111-1111-'||lpad(i::text,12,'0'))::uuid,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','crm','{"qualificacao":{"renda":"2500"}}','Teste','44444444-4444-4444-4444-444444444444' from generate_series(1,2) i;
insert into a1_atendimentos(id,tenant_id,case_id,elia_ativa,status,versao) select ('22222222-2222-2222-2222-'||lpad(i::text,12,'0'))::uuid,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',('11111111-1111-1111-1111-'||lpad(i::text,12,'0'))::uuid,true,'aberta',1 from generate_series(1,2) i;
insert into a1_atendimento_mensagens(id,tenant_id,atendimento_id,autor_tipo,tipo) select ('33333333-3333-3333-3333-'||lpad(i::text,12,'0'))::uuid,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',('22222222-2222-2222-2222-'||lpad(i::text,12,'0'))::uuid,'lead','mensagem' from generate_series(1,2) i;
SQL
for i in 1 2; do
  run -c "select public.a1_elia_roleta('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',('22222222-2222-2222-2222-'||lpad('$i',12,'0'))::uuid,1,('33333333-3333-3333-3333-'||lpad('$i',12,'0'))::uuid,'roleta');" &
done
wait
run <<'SQL'
do $$ begin if (select count(*) from a1_atendimentos where status='distribuida') <> 2 or (select count(distinct corretor_id) from a1_atendimentos) <> 2 then raise exception 'distribuição concorrente incorreta'; end if; end $$;
SQL
printf 'Duas conversas simultâneas distribuídas para corretores diferentes.\n'
