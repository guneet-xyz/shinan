#!/bin/bash
# The memory measurements and limit checks of GC-11 (security checklist,
# v0.4.0 rerun), on the upgraded stack: load.sh <scenario>…, or all of them
# in order. Each scenario's memory goes to $OUT/mem-<scenario>.log.
. /src/deploy/test/load/lib.sh

# Three agents work on Trial at once, as in the trial: each fetches, changes
# a page on a branch, pushes it, rebases onto main and pushes main, deletes
# the branch, and thinks 15 seconds; a person reads the catalog every 10
# seconds meanwhile. All from one address, which has 300 requests a minute:
# a round of one agent is 10 to 12 requests. A refused request is counted,
# and the agent goes on.
realistic() {
  local trial
  trial=$(repo Trial)
  for m in a1 a2 a3; do mkagent Trial "$m"; done
  watch realistic web git worker postgres
  for m in a1 a2 a3; do (
    d=/work/run/$m && rm -rf "$d" && gitas "$m" clone -q "$trial" "$d" && cd "$d"
    git config user.name "$m" && git config user.email "$m@example.com"
    ok=0 refused=0
    for i in $(seq 1 10); do
      sleep 15
      gitas "$m" fetch -q origin 2>/dev/null || { refused=$((refused + 1)); continue; }
      git reset -q --hard origin/main
      f=$(ls machine/*.md | shuf -n1)
      printf '\nNote from %s, round %s.\n' "$m" "$i" >> "$f" && git commit -qam "$m round $i"
      gitas "$m" push -q origin "HEAD:refs/heads/$m-work" 2>/dev/null || true
      for try in 1 2 3 4 5; do
        gitas "$m" fetch -q origin 2>/dev/null || { refused=$((refused + 1)); sleep 5; continue; }
        git rebase -q origin/main >/dev/null 2>&1 || { git rebase --abort 2>/dev/null || true; git reset -q --hard origin/main; printf '\nNote from %s.\n' "$m" >> "$f"; git commit -qam "$m round $i again"; }
        gitas "$m" push -q origin HEAD:refs/heads/main 2>/dev/null && { ok=$((ok + 1)); break; }
      done
      gitas "$m" push -q origin ":refs/heads/$m-work" 2>/dev/null || true
    done
    echo "$m: $ok of 10 changes pushed to main; $refused fetches refused (429)"
  ) & done
  (for i in $(seq 1 20); do node "$LOAD/check-catalog.mjs" > /dev/null || echo "a reader's round failed"; sleep 10; done; echo "reader: 20 rounds") &
  wait $(jobs -p | grep -v "$WATCHER")
  unwatch realistic
}

# A catalog at its limits (20,000 pages, 48 MB) pushed to main at once.
bigpush() {
  node "$LOAD/mkws.mjs" Big
  sleep 5
  for m in b1 b2 b3 b4; do mkagent Big "$m"; done
  local big
  big=$(repo Big)
  rm -rf /work/run/big && gitas b1 clone -q "$big" /work/run/big
  node "$LOAD/mkbig.mjs" /work/run/big 20000
  cd /work/run/big && git config user.name b1 && git config user.email b1@example.com
  git add -A && git commit -qm "A catalog at its limits: 20,000 pages"
  echo "bytes of text: $(cat ./*/*.md | wc -c)"
  watch bigpush web git worker postgres
  start=$(date +%s)
  { gitas b1 push origin HEAD:refs/heads/main 2>&1 || true; } | grep -v 'owner-not-member' | tail -4 || true
  echo "push took $(($(date +%s) - start)) s"
  sleep 60
  compose logs --no-color --since 3m worker | grep 'Catalog index' | sed 's/^worker-1  | //' || true
  unwatch bigpush
  cd /work
}

# 12 clones of that catalog at once (4 agents, 3 each), and its heaviest
# pages read meanwhile. Past 2 Git processes per agent and 3 per person,
# Shinan answers 429.
clones() {
  local big
  big=$(repo Big)
  watch clones web git
  for m in b1 b2 b3 b4; do for k in 1 2 3; do (
    rm -rf "/work/run/c-$m-$k"
    if gitas "$m" clone -q "$big" "/work/run/c-$m-$k" 2> "/work/run/c-$m-$k.err"; then echo "clone $m-$k: ok"; else echo "clone $m-$k: refused, $(grep -o 'HTTP 429\|error: 429\|returned error: [0-9]*' "/work/run/c-$m-$k.err" | head -1)"; fi
  ) & done; done
  node "$LOAD/web-hostile.mjs" "$(ws Big)" &
  wait $(jobs -p | grep -v "$WATCHER")
  unwatch clones
}

# Four agents of one person push about 62 MiB of random files each, to
# their own branches, at once; then one push over 64 MiB.
pushes() {
  local trial
  trial=$(repo Trial)
  for m in a1 a2 a3 a4; do
    [ -e "$OP/tokens/$m" ] || mkagent Trial "$m"
    d=/work/run/hp-$m && rm -rf "$d" && gitas "$m" clone -q "$trial" "$d"
    (cd "$d" && git config user.name "$m" && git config user.email "$m@example.com" && mkdir blobs \
      && for i in $(seq 1 62); do head -c 1040000 /dev/urandom > "blobs/b$i.bin"; done \
      && git add -A && git commit -qm "big blobs" && git repack -qad)
  done
  watch pushes web git
  for m in a1 a2 a3 a4; do (
    cd "/work/run/hp-$m"
    if gitas "$m" push -q origin "HEAD:refs/heads/$m-big" > "/work/run/hp-$m.out" 2>&1; then echo "$m: accepted"; else echo "$m: refused, $(grep -m1 -o 'HTTP [0-9]*' "/work/run/hp-$m.out")"; fi
    gitas "$m" push -q origin ":refs/heads/$m-big" 2>/dev/null || true
  ) & done
  wait $(jobs -p | grep -v "$WATCHER")
  unwatch pushes
  cd /work/run/hp-a1 && for i in $(seq 63 70); do head -c 1040000 /dev/urandom > "blobs/b$i.bin"; done
  git add -A && git commit -qm "more" && git repack -qad
  echo "a push of $(du -m .git/objects/pack/*.pack | cut -f1) MiB: $(gitas a1 push origin HEAD:refs/heads/a1-too-big 2>&1 | grep -m1 -o 'HTTP [0-9]*')"
  cd /work
}

# The Git container's worst case within the limits: every page of the
# catalog at its limits changed in one push to main, beside three 62 MiB
# pushes by two people (ana's agents in Shapes).
worst() {
  PERSON=ana mkagent Shapes s1
  PERSON=ana mkagent Shapes s2
  q "insert into email_allowlist (email) values ('ana@example.com') on conflict do nothing" > /dev/null
  local shapes
  shapes=$(repo Shapes)
  for m in s1 s2; do
    d=/work/run/w-$m && rm -rf "$d" && gitas "$m" clone -q "$shapes" "$d"
    (cd "$d" && git config user.name "$m" && git config user.email "$m@example.com" && mkdir blobs \
      && for i in $(seq 1 62); do head -c 1040000 /dev/urandom > "blobs/b$i.bin"; done \
      && git add -A && git commit -qm "big blobs" && git repack -qad)
  done
  (cd /work/run/hp-a1 && git reset -q --hard HEAD~1)
  cd /work/run/big && gitas b1 fetch -q origin && git reset -q --hard origin/main
  for f in ./*/*.md; do printf '\nChecked again.\n' >> "$f"; done
  git commit -qam "Every page, again"
  local r=$RANDOM
  watch worst web git worker postgres
  run() { local s; s=$(date +%s); (cd "$2" && gitas "$1" push -q origin "HEAD:refs/heads/$3" > "/work/run/w-$1.out" 2>&1) && echo "$1 -> $3: accepted in $(($(date +%s) - s)) s" || echo "$1 -> $3: refused, $(grep -m1 . "/work/run/w-$1.out")"; }
  run b1 /work/run/big main & run a1 /work/run/hp-a1 "a1-big-$r" & run s1 /work/run/w-s1 "s1-big-$r" & run s2 /work/run/w-s2 "s2-big-$r" &
  wait $(jobs -p | grep -v "$WATCHER")
  sleep 60
  unwatch worst
  cd /work
}

# 250 of the heaviest catalog reads, 50 at a time, from one person.
reads() {
  watch reads web git postgres
  node "$LOAD/web-hostile.mjs" "$(ws Big)"
  unwatch reads
}

# A clone of the catalog at its limits read at 50 KB/s through Caddy: one
# answer held open for minutes.
slowclone() {
  node "$LOAD/slowproxy.mjs" 18559 18444 50000 &
  local proxy=$!
  sleep 1
  local start
  start=$(date +%s)
  rm -rf /work/run/slow
  if gitas b2 clone -q "https://localhost:18559/git/$(ws Big).git" /work/run/slow; then echo "clone at 50 KB/s: ok after $(($(date +%s) - start)) s"; else echo "clone at 50 KB/s: failed after $(($(date +%s) - start)) s"; fi
  kill "$proxy"
}

# A deleted branch on the catalog at its limits: fetches every half second
# while the pruner repacks the repository whole.
prune() {
  mkagent Big bro read-only
  cd /work/run/big && gitas b1 fetch -q origin && git checkout -q -B tmp origin/main
  printf '\nA branch to delete.\n' >> machine/m0.md && git commit -qam "A branch to delete"
  gitas b1 push -q origin HEAD:refs/heads/to-delete 2>/dev/null || echo "the branch's push failed"
  gitas b1 push -q origin :refs/heads/to-delete 2>/dev/null || echo "the deletion failed"
  local big max=0 n=0 start
  big=$(repo Big)
  start=$(date +%s)
  while [ $(($(date +%s) - start)) -lt 120 ]; do
    a=$(date +%s%N)
    gitas bro ls-remote "$big" > /dev/null 2>&1 || echo "a fetch of the refs failed at $(($(date +%s) - start)) s"
    d=$((($(date +%s%N) - a) / 1000000))
    n=$((n + 1))
    [ "$d" -gt "$max" ] && max=$d
    sleep 0.5
  done
  echo "$n fetches of the refs in the 2 minutes after the deletion; the slowest took $max ms"
  compose logs --no-color --since 3m git | grep -i prun || echo "(the git log has no line about pruning: it succeeded)"
  cd /work
}

scenarios=("$@")
[ ${#scenarios[@]} -eq 0 ] && scenarios=(realistic bigpush clones pushes worst reads slowclone prune)
for s in "${scenarios[@]}"; do
  log "$s"
  "$s"
  cooldown
done
