#!/bin/sh
# Nightly backup:  0 2 * * * /path/to/backup.sh     (keeps 14 days; copy the folder off the server too)
set -e; mkdir -p /var/backups/seleven; f=/var/backups/seleven/seleven-$(date +%F).sql.gz
docker compose -f "$(dirname "$0")/../docker-compose.yml" exec -T db pg_dump -U seleven seleven | gzip > "$f"; find /var/backups/seleven -name '*.sql.gz' -mtime +14 -delete; echo "backup written: $f"
