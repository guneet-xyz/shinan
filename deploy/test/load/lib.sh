# Shared by GC-11's load scripts (README.md). Sourced, never run.
set -euo pipefail
LOAD=/src/deploy/test/load
OP=${OP:-/work/op}
OUT=${OUT:-/work/evidence}
URL=${SHINAN_URL:-https://localhost:18444}
CGROUP=${CGROUP:-/dind-cgroup/docker}
ALPINE=alpine:3.21@sha256:bc21487101ae47172509130ee1092cc273a831968d64b617776d1f69c81e42ab
CURL=curlimages/curl:8.11.1@sha256:c1fe1679c34d9784c1b0d1e5f62ac0a79fca01fb6377cdd33e90473c6f9f9a69
export GIT_SSL_NO_VERIFY=1 GIT_TERMINAL_PROMPT=0 NODE_TLS_REJECT_UNAUTHORIZED=0 NODE_NO_WARNINGS=1
mkdir -p "$OUT" /work/tmp /work/run

compose() { (cd "$OP" && docker compose "$@"); }
# A query on the stack's database, one row a line, columns separated by " | ".
q() { compose exec -T postgres psql -U shinan -d shinan -At -F' | ' -c "$1"; }
ws() { q "select id from workspaces where name = '$1'"; }
cid() { compose ps -q "$1"; }

# An agent with a token only this run knows (test only): the token's hash is
# written straight into the database, so no token is ever printed or sent
# by email. mkagent <workspace> <machine> [read-only] (PERSON=<handle>).
mkagent() {
  local workspace=$1 machine=$2 scopes="{catalog:read,catalog:write,tasks:read,tasks:write,presence}"
  [ "${3:-}" = read-only ] && scopes="{catalog:read,tasks:read}"
  local token hash
  token="shinan_agent_$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 43)"
  hash=$(printf %s "$token" | openssl dgst -sha256 -binary | base64 -w0 | tr '+/' '-_' | tr -d '=')
  q "with m as (select m.id, m.workspace_id, m.person_id from members m
        join workspaces w on w.id = m.workspace_id join people p on p.id = m.person_id
        where w.name = '$workspace' and p.handle = '${PERSON:-guneet}' and m.removed_at is null),
      a as (insert into agents (workspace_id, member_id, person_id, coding_tool, machine, handle, name)
        select workspace_id, id, person_id, 'opencode', '$machine', 'opencode-$machine', 'OpenCode on $machine' from m
        returning id, workspace_id)
    insert into agent_tokens (workspace_id, agent_id, token_hash, scopes, installation_url)
      select workspace_id, id, '$hash', '$scopes', '$URL' from a" >/dev/null
  install -d -m 700 "$OP/tokens"
  (umask 077 && printf %s "$token" > "$OP/tokens/$machine")
}
# A new token, only this run knows, for a workspace's existing agent (the
# dataset's v0.3.0 agent, whose scopes v0.3.0 named differently): its hash
# replaces the stored one. retoken <workspace> <file name>.
retoken() {
  local token hash id
  token="shinan_agent_$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 43)"
  hash=$(printf %s "$token" | openssl dgst -sha256 -binary | base64 -w0 | tr '+/' '-_' | tr -d '=')
  id=$(q "select t.id from agent_tokens t join agents a on a.id = t.agent_id join workspaces w on w.id = a.workspace_id
          where w.name = '$1' and t.revoked_at is null limit 1")
  q "update agent_tokens set token_hash = '$hash' where id = '$id'" > /dev/null
  install -d -m 700 "$OP/tokens"
  (umask 077 && printf %s "$token" > "$OP/tokens/$2")
}
# git as an agent: gitas <machine> <git arguments>
gitas() {
  local machine=$1
  shift
  git -c "http.extraHeader=Authorization: Bearer $(cat "$OP/tokens/$machine")" "$@"
}
repo() { echo "$URL/git/$(ws "$1").git"; }

# Memory of the stack's containers while a scenario runs: watch <name>
# <service>…, then unwatch. Peaks of memory.current (what the limit counts)
# and of anonymous memory, sampled every 200 ms, and one line a second.
watch() {
  local name=$1
  shift
  local pairs=()
  for service in "$@"; do
    local id
    id=$(cid "$service")
    [ -n "$id" ] || { echo "watch: $service is not running" >&2; return 1; }
    pairs+=("$service=$id")
  done
  rm -f /work/tmp/stopwatch
  "$LOAD/memwatch.sh" "$OUT/mem-$name.log" "${pairs[@]}" &
  WATCHER=$!
}
unwatch() {
  touch /work/tmp/stopwatch
  wait "$WATCHER"
  sed -n '/^peak/p' "$OUT/mem-$1.log"
}
# The rate limit of 300 requests a minute per address: wait it out.
cooldown() { sleep "${COOLDOWN:-61}"; }
log() { printf '\n== %s\n' "$*"; }
