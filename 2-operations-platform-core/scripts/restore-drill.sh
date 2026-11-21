#!/usr/bin/env bash
# Backup + restore drill: dumps the database, restores it into a scratch database, and compares row counts of every table.
set -euo pipefail
export PGPASSWORD="${PGPASSWORD:-seleven}"; H="${PGHOST:-localhost}"; U="${PGUSER:-seleven}"; SRC="${SRC_DB:-seleven_test}"; DST="${DST_DB:-seleven_restore_drill}"
pg_dump -h "$H" -U "$U" -Fc "$SRC" -f /tmp/seleven_drill.dump
dropdb -h "$H" -U "$U" --if-exists "$DST"; createdb -h "$H" -U "$U" "$DST"
pg_restore -h "$H" -U "$U" -d "$DST" --no-owner /tmp/seleven_drill.dump
bad=0; n=0
for t in $(psql -h "$H" -U "$U" -At "$SRC" -c "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"); do
  a=$(psql -h "$H" -U "$U" -At "$SRC" -c "select count(*) from \"$t\""); b=$(psql -h "$H" -U "$U" -At "$DST" -c "select count(*) from \"$t\""); n=$((n+1)); [ "$a" = "$b" ] || { echo "MISMATCH $t: $a vs $b"; bad=1; }
done
dropdb -h "$H" -U "$U" "$DST"; [ $bad = 0 ] && echo "RESTORE DRILL PASSED: $n tables restored with identical row counts" || { echo "RESTORE DRILL FAILED"; exit 1; }
