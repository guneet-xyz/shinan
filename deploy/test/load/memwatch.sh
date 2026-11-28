#!/bin/bash
# memwatch.sh <out> <name>=<container ID>… : samples each container's cgroup
# every 200 ms until /work/tmp/stopwatch exists. Writes one line a second
# (seconds, then per container memory.current and anonymous memory in MiB)
# and, at the end, each container's peaks.
set -u
out=$1
shift
cgroup=${CGROUP:-/dind-cgroup/docker}
declare -A dir peak anon
for pair in "$@"; do
  name=${pair%%=*}
  dir[$name]=$(echo "$cgroup/${pair#*=}"*)
  peak[$name]=0
  anon[$name]=0
done
start=$(date +%s%N)
tick=0
echo "# seconds, then name current_MiB anon_MiB for each container" > "$out"
while [ ! -e /work/tmp/stopwatch ]; do
  line=""
  for name in "${!dir[@]}"; do
    c=$(cat "${dir[$name]}/memory.current" 2>/dev/null || echo 0)
    a=$(sed -n 's/^anon //p' "${dir[$name]}/memory.stat" 2>/dev/null || echo 0)
    [ "$c" -gt "${peak[$name]}" ] && peak[$name]=$c
    [ "${a:-0}" -gt "${anon[$name]}" ] && anon[$name]=$a
    line+=" $name $((c / 1048576)) $((${a:-0} / 1048576))"
  done
  if [ $((tick % 5)) -eq 0 ]; then
    printf '%s%s\n' "$(( ($(date +%s%N) - start) / 1000000000 ))" "$line" >> "$out"
  fi
  tick=$((tick + 1))
  sleep 0.2
done
for name in "${!dir[@]}"; do
  events=$(tr '\n' ' ' < "${dir[$name]}/memory.events" 2>/dev/null)
  echo "peak $name $((peak[$name] / 1048576)) MiB (anonymous $((anon[$name] / 1048576)) MiB); memory.events: $events" >> "$out"
done
rm -f /work/tmp/stopwatch
