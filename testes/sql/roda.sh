#!/usr/bin/env bash
# Sobe um Postgres descartável, carrega os arquivos de database/migrations/ que os módulos novos
# precisam e roda a prova de segurança contra eles. Nada toca produção.
#
#   testes/sql/roda.sh              usa um Postgres já de pé em $PGPORT
#   PGPORT=5473 testes/sql/roda.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PORTA="${PGPORT:-5473}"
BANCO="prova_$(date +%s)"

psql -h 127.0.0.1 -p "$PORTA" -U postgres -q -c "create database $BANCO"
trap 'psql -h 127.0.0.1 -p "$PORTA" -U postgres -q -c "drop database if exists $BANCO" >/dev/null' EXIT

for f in testes/sql/base-falsa.sql \
         database/migrations/2026-09-04_identidade.sql \
         database/migrations/2026-09-04_pre_analise.sql \
         database/migrations/2026-09-04_comercial.sql \
         database/migrations/2026-09-04_gatilhos.sql \
         database/migrations/2026-09-06_travas_sessao_e_parceiro.sql \
         database/migrations/2026-09-08_suporte_nao_ocupa_vaga.sql \
         database/migrations/2026-09-08_perfis_de_acesso.sql \
         database/migrations/2026-09-09_documento_obrigatorio.sql \
         database/migrations/2026-09-09_visibilidade_repasse_1_conferir.sql \
         database/migrations/2026-09-09_visibilidade_repasse_2_ligar.sql \
         database/migrations/2026-09-10_corretor_analista_so_o_seu.sql \
         database/migrations/2026-09-10_modo_manutencao.sql \
         database/migrations/2026-09-10_criar_repasse_trava.sql \
         database/migrations/2026-09-10_chaves_dos_modulos.sql \
         database/migrations/2026-09-11_exclusao_definitiva.sql \
         database/migrations/2026-09-11_corretor_e_imobiliaria_da_pre_analise.sql \
         database/migrations/2026-09-11_quem_cadastra_pessoa_rele.sql \
         database/migrations/2026-09-11_partes_por_id.sql \
         database/migrations/2026-09-11_registro_arquivar.sql \
         database/migrations/2026-09-12_visibilidade_da_atribuicao_1_conferir.sql \
         database/migrations/2026-09-12_visibilidade_da_atribuicao_2_ligar.sql; do
  echo "carregando $f"
  psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -q -v ON_ERROR_STOP=1 -f "$f"
done

psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -v ON_ERROR_STOP=1 \
     -P pager=off -f testes/sql/prova-seguranca.sql

# Disposição de unidades: carrega depois de tudo (é o arquivo mais novo) e roda a
# prova dela no mesmo banco, aproveitando o cenário que a prova de segurança montou.
psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -q -v ON_ERROR_STOP=1 \
     -f database/migrations/2026-11-02_disposicao_unidades.sql
psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -v ON_ERROR_STOP=1 \
     -P pager=off -f testes/sql/prova-disposicao.sql

# Reserva pela pré-análise, regras da pré-análise, selos de Leads e visita.
# Precisa do que produção já tem e o andaime não carregava: a coluna selo das
# esteiras, a permissão de Iniciar venda, a agenda e a integridade dos fluxos.
for f in database/migrations/2026-09-12_valor_avaliacao_inicial.sql \
         database/migrations/2026-09-12_foundation_access_dossier.sql \
         database/migrations/2026-09-13_iniciar_venda_permissao.sql \
         database/migrations/2026-09-17_agenda.sql \
         database/migrations/2026-09-18_integridade_fluxos_e_auditoria.sql \
         database/migrations/2026-11-03_reserva_pre_analise_e_selos.sql; do
  echo "carregando $f"
  psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -q -v ON_ERROR_STOP=1 -f "$f"
done
psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -v ON_ERROR_STOP=1 \
     -P pager=off -f testes/sql/prova-reserva-pa.sql

# Site público (links, contato, blog). O andaime não tem o schema storage do
# Supabase: um esboço da tabela de buckets basta para o arquivo carregar. O SQL
# roda duas vezes para provar que pode rodar de novo.
psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -q -v ON_ERROR_STOP=1 -c "
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);"
for i in 1 2; do
  psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -q -v ON_ERROR_STOP=1 \
       -f database/migrations/2026-11-12_site_links_blog.sql
done
psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -v ON_ERROR_STOP=1 \
     -P pager=off -f testes/sql/prova-site.sql

# Login do superadmin por autenticador. Em produção quem chama é a Edge Function
# com a chave de serviço (papel service_role); o andaime cria o papel.
psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -q -v ON_ERROR_STOP=1 -c "
  do \$\$ begin
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin bypassrls;
    end if;
  end \$\$;
  grant usage on schema public to service_role;
  grant insert, select on prova to service_role;
  grant usage, select on sequence prova_n_seq to service_role;
  grant execute on function checa(text, boolean, text) to service_role;"
for i in 1 2; do
  psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -q -v ON_ERROR_STOP=1 \
       -f database/migrations/2026-11-12_superadmin_autenticador.sql
done
psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -v ON_ERROR_STOP=1 \
     -P pager=off -f testes/sql/prova-sa-autenticador.sql
