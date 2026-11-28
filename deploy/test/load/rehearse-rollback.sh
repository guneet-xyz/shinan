#!/bin/bash
# The rollback to v0.3.0, following the operator guide's "To roll back to
# 0.3" exactly, after the load: the dump of the upgrade's step 1 restored
# with 0.4's Compose file still in place, then 0.3's files and image, the
# catalog volume removed. Then the upgrade again, from an empty volume.
. /src/deploy/test/load/lib.sh
: "${CANDIDATE:?Set CANDIDATE to the v0.4.0 image}"
cd "$OP"
dump=$(ls shinan-*.dump | head -1)

log "the guide's commands"
docker compose down 2>&1 | tail -1
docker compose up -d postgres --wait 2>&1 | tail -1
docker compose exec -T postgres dropdb -U shinan --force shinan
docker compose exec -T postgres createdb -U shinan shinan
docker compose exec -T postgres pg_restore -U shinan -d shinan --exit-on-error < "$dump" && echo "restored $dump"
docker compose down 2>&1 | tail -1
cp /work/v03/compose.yml /work/v03/compose.test.yml .
sed -i 's|^SHINAN_IMAGE=.*|SHINAN_IMAGE=shinan:v0.3.0|' .env
printf 'SHINAN_CATALOG_WORKERS=1\nSHINAN_CATALOG_WORKER_HEAP_MB=768\n' >> .env
docker volume rm shinanop_catalog
docker compose up -d 2>&1 | tail -1
sleep 15

log "v0.3.0 again"
docker compose ps -a --format '{{.Service}} {{.Status}}'
docker compose logs --no-color migrate | sed 's/^migrate-1  | //'
q "select w.name, (select count(*) from catalog_documents d where d.workspace_id = w.id) as documents,
     (select max(number) from catalog_revisions r where r.workspace_id = w.id) as revision,
     (select string_agg(number::text, ',' order by number) from catalog_proposals p where p.workspace_id = w.id and p.state::text = 'pending') as waiting
   from workspaces w order by w.name"
echo "the v0.3.0 agent's token at /mcp: $(node "$LOAD/mcp.mjs" "$OP/tokens/rehearsal03" get_entity '{"id":"machine/musashi"}' | cut -c1-90)"
echo "/git/ on v0.3.0: $(curl -sk -o /dev/null -w '%{http_code} %{content_type}' "$URL/git/$(ws Trial).git/info/refs?service=git-upload-pack")"
echo "workspaces made after the upgrade: $(q "select count(*) from workspaces where name in ('Big', 'Million')")"

log "the upgrade again, from an empty volume"
docker compose stop web worker 2>&1 | tail -1
cp /src/deploy/compose.yml /src/deploy/test/compose.test.yml .
sed -i "s|^SHINAN_IMAGE=.*|SHINAN_IMAGE=$CANDIDATE|; /^SHINAN_CATALOG_WORKER/d" .env
docker compose up -d 2>&1 | tail -1
sleep 15
docker compose ps -a --format '{{.Service}} {{.Status}}'
docker compose logs --no-color migrate | grep -c 'verified file by file' | sed 's/$/ workspaces moved again/'
setup=$(docker compose logs --no-color web | grep -o '/setup#[^ ]*' | tail -1 | sed 's|/setup#||')
node "$LOAD/sign-in.mjs" guneet@example.com "$setup"
