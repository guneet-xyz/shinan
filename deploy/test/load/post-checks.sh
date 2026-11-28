#!/bin/bash
# The checks after the upgrade (plan §4.3; security checklist 9.4 to 9.7,
# 10.9 and D11): the git container's isolation and hardening, the service
# token, the Git endpoint through Caddy, the first commit against the
# dump, and a push with a private key in it.
. /src/deploy/test/load/lib.sh
TRIAL=$(ws Trial)
G=$(cid git)
NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$G")

log "the git container"
docker inspect -f 'user {{.Config.User}}, read-only {{.HostConfig.ReadonlyRootfs}}, cap_drop {{.HostConfig.CapDrop}}, {{.HostConfig.SecurityOpt}}, memory {{.HostConfig.Memory}}, ports {{json .HostConfig.PortBindings}}' "$G"
echo "networks: $NET; internal: $(docker network inspect -f '{{.Internal}}' "$NET")"
echo "members of $NET: $(docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "$NET")"
echo "environment (names only): $(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$G" | cut -d= -f1 | sort | tr '\n' ' ')"

log "the service token"
curl_on() { docker run --rm --network "$1" -v "$OP/secrets/git_service_token:/token:ro" "$CURL" sh -c "$2"; }
echo "from the git network, no token: $(curl_on "$NET" 'curl -s -o /dev/null -w %{http_code} http://git:3000/repositories')"
echo "from the git network, a wrong token: $(curl_on "$NET" 'curl -s -o /dev/null -w %{http_code} -H "Authorization: Bearer wrong-token-wrong-token-wrong-token" http://git:3000/repositories')"
echo "from the git network, the token: $(curl_on "$NET" 'curl -s -o /dev/null -w %{http_code} -H "Authorization: Bearer $(cat /token)" http://git:3000/repositories')"
PROXY=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(cid caddy)" | awk '{print $1}')
echo "from Caddy's network ($PROXY): $(curl_on "$PROXY" 'curl -s -m 5 -o /dev/null -w %{http_code} http://git:3000/ || true')"

log "the Git endpoint through Caddy"
mkagent Trial checks
echo "without a token: $(curl -sk -o /dev/null -w '%{http_code} %header{www-authenticate}' "$URL/git/$TRIAL.git/info/refs?service=git-upload-pack")"
echo "a dumb path: $(curl -sk -o /dev/null -w '%{http_code}' "$URL/git/$TRIAL.git/HEAD")"
gitas checks ls-remote "$URL/git/$TRIAL.git"
rm -rf /work/run/checks && gitas checks clone -q "$URL/git/$TRIAL.git" /work/run/checks
git -C /work/run/checks log --format='%H %an <%ae> %s'

log "the first commit against the dump's latest texts (by SHA-256)"
dump=$(ls "$OP"/shinan-*.dump | head -1)
compose exec -T postgres dropdb -U shinan --if-exists dumpcheck
compose exec -T postgres createdb -U shinan dumpcheck
compose exec -T postgres pg_restore -U shinan -d dumpcheck --exit-on-error < "$dump"
compose exec -T postgres psql -U shinan -d dumpcheck -At < "$LOAD/compare.sql" > /work/run/dump-hashes
compose exec -T postgres dropdb -U shinan dumpcheck
(cd /work/run/checks && for f in $(git ls-files '*.md' | grep -v '^README.md$'); do
  printf '%s %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "${f%.md}"
done | sort -k2) > /work/run/clone-hashes
echo "$(wc -l < /work/run/dump-hashes) documents in the dump, $(wc -l < /work/run/clone-hashes) in the first commit"
diff /work/run/dump-hashes /work/run/clone-hashes && echo "identical, byte for byte"

log "a push with secrets in it, to a branch"
cd /work/run/checks
git config user.name checks && git config user.email checks@example.com
printf 'aws_secret_access_key = %s\n' "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" > notes-secret.md
printf -- '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACBm8b5k0hq3V6oW3o6m0t2uAxQwQv8E2pP8zO5d0b6nJwAAAJgYJ2b3GCdm\n-----END OPENSSH PRIVATE KEY-----\n' > machine/key.md
git add -A && git commit -qm "notes"
gitas checks push origin HEAD:refs/heads/secret-test 2>&1 || true
echo "the branch afterwards: '$(gitas checks ls-remote origin refs/heads/secret-test)' (empty: nothing kept)"
