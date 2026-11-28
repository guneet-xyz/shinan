#!/bin/bash
# The backup of the database and the catalog volume together, and their
# restore, exactly as the operator guide's "Backups" gives them. A change
# pushed between the backup and the restore must be gone afterwards, and
# the push log and the repositories must agree (no catalog.unlogged-update).
. /src/deploy/test/load/lib.sh
cd "$OP"
mkagent Trial backup
TRIAL=$(ws Trial)

log "the backup (the guide's commands)"
docker compose stop web worker git 2>&1 | tail -1
(umask 077 && docker compose exec -T postgres pg_dump -U shinan -Fc shinan > backup.dump)
docker run --rm -v shinanop_catalog:/catalog:ro -v "$PWD:/backup" "$ALPINE" \
  sh -c 'umask 077 && tar -C /catalog -czf /backup/catalog-backup.tar.gz .'
docker compose up -d 2>&1 | tail -1
ls -l backup.dump catalog-backup.tar.gz | awk '{print $1, $5, $9}'
sleep 15
before=$(gitas backup ls-remote "$URL/git/$TRIAL.git" refs/heads/main | cut -f1)
echo "Trial's main at the backup: $before"

log "a change after the backup"
rm -rf /work/run/backup && gitas backup clone -q "$URL/git/$TRIAL.git" /work/run/backup
cd /work/run/backup && git config user.name backup && git config user.email backup@example.com
printf '\nAfter the backup.\n' >> machine/musashi.md && git commit -qam "After the backup"
gitas backup push -q origin HEAD:main 2>&1 | grep -v '^remote:' || true
echo "Trial's main now: $(gitas backup ls-remote origin refs/heads/main | cut -f1)"
cd "$OP"

log "the restore (the guide's commands, in its order)"
restored_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker compose stop web worker git 2>&1 | tail -1
docker compose exec -T postgres dropdb -U shinan --force shinan
docker compose exec -T postgres createdb -U shinan shinan
docker compose exec -T postgres pg_restore -U shinan -d shinan --exit-on-error < backup.dump
docker run --rm -v shinanop_catalog:/catalog "$ALPINE" sh -c 'rm -rf /catalog/* /catalog/.[!.]*'
docker run --rm -v shinanop_catalog:/catalog -v "$PWD:/backup:ro" "$ALPINE" tar -C /catalog -xzpf /backup/catalog-backup.tar.gz
docker compose up -d 2>&1 | tail -1
sleep 90

log "after the restore"
docker compose ps --format '{{.Service}} {{.Status}}'
after=$(gitas backup ls-remote "$URL/git/$TRIAL.git" refs/heads/main | cut -f1)
echo "Trial's main: $after ($([ "$after" = "$before" ] && echo "as at the backup" || echo "NOT as at the backup"))"
echo "the volume's root: $(docker run --rm -v shinanop_catalog:/catalog:ro "$ALPINE" stat -c '%u %a' /catalog)"
echo "catalog.unlogged-update since the restore: $(q "select count(*) from security_log where action = 'catalog.unlogged-update' and occurred_at >= '$restored_at'")"
node "$LOAD/check-catalog.mjs" | grep Trial
rm -f backup.dump catalog-backup.tar.gz
