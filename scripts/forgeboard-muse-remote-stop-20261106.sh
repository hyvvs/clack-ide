#!/usr/bin/env bash
# Cleanup ONLY task-owned processes. Does not touch systemd or original Ollama.
set -euo pipefail
umask 077
root='/tmp/clack-forgeboard-muse-instrumented-20261106-01'
[[ "$(id -un)" == 'hylab' ]]
[[ -d "$root" && "$(stat -c %U "$root")" == 'hylab' ]]
for name in telemetry-full telemetry relay ollama; do
  pidfile="$root/$name.pid"
  [[ -f "$pidfile" ]] || continue
  pid="$(cat "$pidfile")"
  [[ "$pid" =~ ^[0-9]{2,8}$ ]]
  [[ "$pid" != '974' && "$pid" != '2016' ]]
  args="$(ps -p "$pid" -o args= || true)"
  [[ -n "$args" ]] || { printf '%s_ALREADY_STOPPED=%s\n' "$name" "$pid"; continue; }
  case "$name" in
    telemetry-full) [[ "$args" == *'forgeboard-muse-resource-full-20261104.py'* ]] ;;
    telemetry) [[ "$args" == *'muse-stream-resource-sample-20261104.py'* ]] ;;
    relay) [[ "$args" == *'forgeboard-muse-relay-instrumented-20261104.py'* ]] ;;
    ollama) [[ "$args" == *'ollama serve'* ]] ;;
  esac
  printf '%s_STOPPING=%s\n' "$name" "$pid"
  if [[ "$name" == 'ollama' ]]; then
    pgrep -P "$pid" > "$root/ollama-children-before-stop.txt" || true
  fi
  kill -TERM "$pid"
  for i in {1..30}; do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    # Only process-identity-checked, recorded task-owned process is eligible.
    check="$(ps -p "$pid" -o args= || true)"
    if [[ "$check" == "$args" ]]; then kill -KILL "$pid"; fi
  fi
  printf '%s_STOPPED=%s\n' "$name" "$pid"
done
# Inspect any runner the temporary daemon spawned without killing unrelated jobs.
if [[ -s "$root/ollama-children-before-stop.txt" ]]; then
  while read -r pid; do
    [[ "$pid" =~ ^[0-9]{2,8}$ ]] || continue
    if kill -0 "$pid" 2>/dev/null; then
      args="$(ps -p "$pid" -o args= || true)"
      owner="$(ps -p "$pid" -o user= | xargs || true)"
      if [[ "$owner" == 'hylab' && "$args" == *'ollama runner'* ]]; then
        kill -TERM "$pid"
        printf 'OWNED_RUNNER_TERMINATED=%s\n' "$pid"
      fi
    fi
  done < "$root/ollama-children-before-stop.txt"
fi
printf 'SYSTEM_OLLAMA_ACTIVE=%s\n' "$(systemctl is-active ollama)"
printf 'SYSTEM_OLLAMA_PID=%s\n' "$(systemctl show ollama -p MainPID --value)"
ss -ltnp
