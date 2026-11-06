#!/usr/bin/env bash
# Task-owned resource observation only; no model, relay or Agent interaction.
set -euo pipefail
umask 077
root='/tmp/clack-forgeboard-muse-instrumented-20261106-01'
[[ "$(id -un)" == 'hylab' ]]
[[ -d "$root" && "$(stat -c %U "$root")" == 'hylab' ]]
[[ ! -e "$root/telemetry-full.pid" && ! -e "$root/resources-full.jsonl" ]]
[[ -f "$root/forgeboard-muse-resource-full-20261104.py" ]]
[[ -f "$root/relay.pid" && -f "$root/ollama.pid" ]]
nohup python3 -u "$root/forgeboard-muse-resource-full-20261104.py" "$root" >"$root/telemetry-full.out" 2>&1 </dev/null &
pid="$!"
echo "$pid" > "$root/telemetry-full.pid"
sleep 2
kill -0 "$pid"
[[ -s "$root/resources-full.jsonl" ]]
printf 'EXTENDED_READ_ONLY_TELEMETRY_PID=%s\n' "$pid"
