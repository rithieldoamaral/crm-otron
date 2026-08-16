#!/bin/bash
BACKUP_DIR=/opt/backups
mkdir -p $BACKUP_DIR
# SEGURANÇA: dump contém hashes de senha e dados de todos os clientes —
# restringe leitura só ao dono (root) desde a criação do arquivo.
umask 077
DATE=$(date +%Y%m%d_%H%M%S)
docker compose -f /opt/crm-otron/docker-compose.prod.yml exec -T postgres \
  pg_dump -U otron_user otron_db | gzip > $BACKUP_DIR/otron_$DATE.sql.gz
chmod 600 "$BACKUP_DIR/otron_$DATE.sql.gz"

# Mantém só os últimos 30 dias
find $BACKUP_DIR -name "otron_*.sql.gz" -mtime +30 -delete
