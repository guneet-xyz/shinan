#!/bin/bash
# A history of 1,000,000 commits on main (security checklist, v0.4.0 rerun,
# "very long histories"; plan §2.10): deep history reads straight from the
# Git container, 12 History reads at once of a page changed once, and the
# pruner after a deleted branch, whose whole repack does not fit in the Git
# container's memory (it must fail safely, #208).
. /src/deploy/test/load/lib.sh
COMMITS=${COMMITS:-1000000}
# The workspace's name: give another to run this again on the same stack.
NAME=${NAME:-Million}

log "a workspace whose main has $COMMITS commits"
node "$LOAD/mkws.mjs" "$NAME"
sleep 10
M=$(ws "$NAME")
rm -rf /work/run/long && git init -q --bare /work/run/long
node "$LOAD/mklong.mjs" "$COMMITS" | git -C /work/run/long fast-import --quiet
git -C /work/run/long repack -qad
echo "commits: $(git -C /work/run/long rev-list --count main); packed: $(du -sh /work/run/long/objects/pack | cut -f1)"
main=$(git -C /work/run/long rev-parse main)
compose stop git 2>&1 | tail -1
docker run --rm -v shinanop_catalog:/catalog -v /work/run/long:/long:ro "$ALPINE" sh -c \
  "cp /long/objects/pack/* /catalog/$M.git/objects/pack/ && printf '%s\n' $main > /catalog/$M.git/refs/heads/main && chown -R 65532:65532 /catalog/$M.git"
log "the start: the pruner looks at every repository once, and this one's whole repack runs out of memory"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
compose up -d git 2>&1 | tail -1
watch prune1m git
for i in $(seq 1 60); do
  [ "$(compose logs --no-color --since "$started" git | grep -c "Pruning the repository of workspace $M" || true)" -gt 0 ] && break
  sleep 5
done
unwatch prune1m
compose logs --no-color --since "$started" git | grep -i prun | sed 's/^git-1  | //' || echo "(no pruning line in 5 minutes)"
echo "git restarts: $(docker inspect -f '{{.RestartCount}}' "$(cid git)")"
docker run --rm -v shinanop_catalog:/catalog:ro "$ALPINE" sh -c "echo 'pack folder:'; ls /catalog/$M.git/objects/pack/; echo \"failure kept: \$(ls /catalog/$M.git | grep shinan-prune-failed || echo none)\""

NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(cid git)")
history() { docker run --rm --network "$NET" -v "$OP/secrets/git_service_token:/token:ro" "$CURL" sh -c "$1"; }

log "history pages straight from the Git container, one at a time"
history "for query in 'limit=51' 'limit=51&skip=1000' 'limit=51&skip=100000' 'limit=51&skip=299900' 'limit=51&skip=999999' 'limit=11&path=machine/rare.md' 'limit=11&path=machine/m7.md&skip=2900'; do
  curl -s -o /dev/null -w \"%{http_code} in %{time_total} s: \$query\n\" -H \"Authorization: Bearer \$(cat /token)\" \"http://git:3000/repositories/$M/history?\$query\"
done"

log "12 History reads at once of machine/rare.md, changed only in the first commit"
watch history12 git
history "for i in 1 2 3 4 5 6 7 8 9 10 11 12; do curl -s -o /dev/null -w '%{http_code} in %{time_total} s\n' -H \"Authorization: Bearer \$(cat /token)\" 'http://git:3000/repositories/$M/history?limit=11&path=machine/rare.md&skip=1' & done; wait" | sort | uniq -c
unwatch history12
echo "git restarts: $(docker inspect -f '{{.RestartCount}}' "$(cid git)")"

log "a deleted branch meanwhile: no new attempt within the hour"
mkagent "$NAME" m1
tree=$(git -C /work/run/long rev-parse 'main^{tree}')
branch=$(echo "A branch to delete" | GIT_AUTHOR_NAME=m1 GIT_AUTHOR_EMAIL=m1@example.com GIT_COMMITTER_NAME=m1 GIT_COMMITTER_EMAIL=m1@example.com git -C /work/run/long commit-tree "$tree" -p main)
gitas m1 -C /work/run/long push -q "$URL/git/$M.git" "$branch:refs/heads/to-delete" 2>&1 | grep -v '^remote: *$' || echo "the branch: pushed"
gitas m1 -C /work/run/long push -q "$URL/git/$M.git" :refs/heads/to-delete 2>&1 || true
echo "the branch deleted: '$(gitas m1 ls-remote "$URL/git/$M.git" refs/heads/to-delete)'"
sleep 120
echo "pruning lines in the 2 minutes since: $(compose logs --no-color --since 2m git | grep -ci prun || true)"

mkagent "$NAME" mro read-only
log "after a restart, the wait still holds: no new attempt in 3 minutes"
compose restart git 2>&1 | tail -1
sleep 180
echo "pruning lines since the restart: $(compose logs --no-color --since 3m git | grep -ci prun || true)"
start=$(date +%s%N)
gitas mro ls-remote "$URL/git/$M.git" > /dev/null
echo "a fetch of its refs meanwhile: $((($(date +%s%N) - start) / 1000000)) ms"
