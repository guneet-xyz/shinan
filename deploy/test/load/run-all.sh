#!/bin/bash
# Every GC-11 scenario in order, each one's output in $OUT/<step>.log.
. /src/deploy/test/load/lib.sh
step() {
  local name=$1
  shift
  echo "$(date -u +%FT%TZ) $name"
  "$@" > "$OUT/$name.log" 2>&1 || echo "  $name failed: see $OUT/$name.log"
}
step 1-upgrade "$LOAD/rehearse-upgrade.sh"
step 2-post-checks "$LOAD/post-checks.sh"
sleep 61
step 3-idle bash -c ". $LOAD/lib.sh; watch idle web git worker postgres; sleep 30; unwatch idle"
step 4-load "$LOAD/load.sh"
step 5-long-history "$LOAD/long-history.sh"
step 6-rollback "$LOAD/rehearse-rollback.sh"
step 7-volume-backup "$LOAD/volume-backup.sh"
echo "$(date -u +%FT%TZ) done"
