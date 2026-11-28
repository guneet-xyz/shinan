#!/bin/bash
# The upgrade from v0.3.0 to v0.4.0, following the operator guide's
# "Upgrading from 0.3 to 0.4" exactly, on the reference Compose stack with
# its test additions (Caddy with HTTPS, Mailpit). Needs /work/v03 (v0.3.0's
# deploy/compose.yml and deploy/test/compose.test.yml) and the images
# shinan:v0.3.0 and $CANDIDATE. Ends with the 0.4 stack running and the
# owner signed in.
. /src/deploy/test/load/lib.sh
: "${CANDIDATE:?Set CANDIDATE to the v0.4.0 image}"

log "v0.3.0's reference stack, with a dataset shaped like Musashi's"
# A stack left by an earlier run goes first, with its volumes.
if [ -f "$OP/compose.yml" ]; then compose down -v --remove-orphans 2>&1 | tail -1; fi
rm -rf "$OP" && install -d -m 0700 "$OP/secrets"
cp /work/v03/compose.yml /work/v03/compose.test.yml "$OP/"
(
  cd "$OP"
  umask 022
  password=$(openssl rand -hex 32)
  printf '%s' "$password" > secrets/postgres_password
  printf 'postgres://shinan:%s@postgres:5432/shinan' "$password" > secrets/database_url
  openssl rand -base64 48 > secrets/session_secret
  printf test > secrets/ses_access_key_id
  printf test > secrets/ses_secret_access_key
  cat > .env <<ENV
SHINAN_IMAGE=shinan:v0.3.0
SHINAN_URL=$URL
SHINAN_OPERATORS=guneet@example.com
SHINAN_TRUSTED_PROXIES=10.247.249.10
SHINAN_PORT=18501
SHINAN_CATALOG_WORKERS=1
SHINAN_CATALOG_WORKER_HEAP_MB=768
EMAIL_FROM=shinan@example.com
SES_REGION=us-east-1
COMPOSE_FILE=compose.yml:compose.test.yml
COMPOSE_PROJECT_NAME=shinanop
TEST_HTTPS_PORT=18444
TEST_MAILPIT_PORT=18526
TEST_PROXY_ADDRESS=10.247.249.10
TEST_PROXY_SUBNET=10.247.249.0/24
ENV
)
compose up -d --quiet-pull --wait 2>&1 | tail -1 || true
compose stop web worker 2>&1 | tail -1
compose exec -T postgres dropdb -U shinan --force shinan
compose exec -T postgres createdb -U shinan shinan
compose exec -T postgres psql -q -U shinan -d shinan -v ON_ERROR_STOP=1 < /src/deploy/test/v0.3.0-dataset.sql > /dev/null
compose up -d --wait 2>&1 | tail -1 || true
q "select w.name, (select count(*) from catalog_documents d where d.workspace_id = w.id) as documents,
     (select max(number) from catalog_revisions r where r.workspace_id = w.id) as revision,
     (select string_agg(number::text, ',' order by number) from catalog_proposals p where p.workspace_id = w.id and p.state::text = 'pending') as waiting
   from workspaces w order by w.name"

log "one more proposal through v0.3.0's MCP, left waiting"
retoken Trial rehearsal03
node "$LOAD/mcp.mjs" "$OP/tokens/rehearsal03" propose_catalog_change '{"explanation":"Rehearsal: a change made on 0.3 before the upgrade.","idempotency_key":"rehearsal-1","operations":[{"op":"set-field","document":"machine/musashi","field":"summary","value":"A public-stacks machine, changed on 0.3 before the upgrade.","expect":{"value":"A public-stacks machine for the dataset."}}]}' | cut -c1-120

log "1. stop web and worker, then take a database dump (the guide's commands)"
cd "$OP"
docker compose stop web worker 2>&1 | tail -1
(umask 077 && docker compose exec -T postgres pg_dump -U shinan -Fc shinan > shinan-$(date -u +%Y%m%dT%H%M%SZ).dump)
ls -l shinan-*.dump | awk '{print $1, $5, $9}'

log "2. what the git container needs: 0.4's Compose files and secrets/git_service_token"
cp /src/deploy/compose.yml /src/deploy/test/compose.test.yml .
(umask 022 && openssl rand -base64 32 | tr -d '\n' > secrets/git_service_token)

log "3. SHINAN_IMAGE set to 0.4's image, then docker compose up -d"
sed -i "s|^SHINAN_IMAGE=.*|SHINAN_IMAGE=$CANDIDATE|; /^SHINAN_CATALOG_WORKER/d" .env
docker compose config --quiet
start=$(date +%s)
docker compose up -d 2>&1 | tail -1
echo "up took $(($(date +%s) - start)) s"

log "4. docker compose logs migrate, and docker compose ps"
sleep 10
docker compose logs --no-color migrate | sed 's/^migrate-1  | //'
docker compose ps -a --format '{{.Service}} {{.Status}}'
docker compose logs --no-color worker | grep 'Catalog index' | sed 's/^worker-1  | //'

log "5. the catalog in the browser: Recent changes, machine/musashi, the index"
sleep 30
setup=$(docker compose logs --no-color web | grep -o '/setup#[^ ]*' | tail -1 | sed 's|/setup#||')
node "$LOAD/sign-in.mjs" guneet@example.com "$setup"
node "$LOAD/check-catalog.mjs"
