#!/usr/bin/env bash
# Sobe um Postgres descartável, carrega os arquivos de sql/ que os módulos novos
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
         sql/2026-09-04_identidade.sql \
         sql/2026-09-04_pre_analise.sql \
         sql/2026-09-04_comercial.sql \
         sql/2026-09-04_gatilhos.sql \
         sql/2026-09-06_travas_sessao_e_parceiro.sql \
         sql/2026-09-08_suporte_nao_ocupa_vaga.sql \
         sql/2026-09-08_perfis_de_acesso.sql \
         sql/2026-09-09_documento_obrigatorio.sql \
         sql/2026-09-09_visibilidade_repasse_1_conferir.sql \
         sql/2026-09-09_visibilidade_repasse_2_ligar.sql \
         sql/2026-09-10_corretor_analista_so_o_seu.sql \
         sql/2026-09-10_modo_manutencao.sql \
         sql/2026-09-10_criar_repasse_trava.sql; do
  echo "carregando $f"
  psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -q -v ON_ERROR_STOP=1 -f "$f"
done

psql -h 127.0.0.1 -p "$PORTA" -U postgres -d "$BANCO" -v ON_ERROR_STOP=1 \
     -P pager=off -f testes/sql/prova-seguranca.sql
