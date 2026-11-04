#!/usr/bin/env bash
# Diagnostic-only, user-owned, no daemon/systemd/production changes.
set -euo pipefail
umask 077
root='/tmp/clack-forgeboard-muse-instrumented-20261104-02'
[[ "$(id -un)" == 'hylab' ]]
[[ -d "$root" && "$(stat -c %U "$root")" == 'hylab' ]]
[[ -f "$root/forgeboard-muse-relay-instrumented-20261104.py" ]]
[[ -f "$root/muse-stream-resource-sample-20261104.py" ]]
[[ ! -e "$root/ollama.pid" && ! -e "$root/relay.pid" && ! -e "$root/telemetry.pid" ]]
[[ "$(systemctl is-active ollama)" == 'active' ]]
[[ -x /usr/local/bin/ollama ]]
[[ -d /var/lib/ollama ]]
[[ ! -w /var/lib/ollama ]]
# Reject occupied task-only loopback ports without talking to any model.
python3 - <<'PY'
import socket
for port in (11436,11437):
    with socket.socket() as s:
        s.bind(('127.0.0.1',port))
PY
# Child process identity and lifecycle are managed ONLY by the diagnostic.
OLLAMA_HOST='127.0.0.1:11436' OLLAMA_MODELS='/var/lib/ollama' OLLAMA_DEBUG='2' \
  nohup /usr/local/bin/ollama serve >"$root/ollama-trace.log" 2>&1 </dev/null &
echo "$!" >"$root/ollama.pid"
for i in {1..45}; do
    if curl -fsS --max-time 1 'http://127.0.0.1:11436/api/version' >"$root/version.json" 2>/dev/null; then break; fi
    sleep 1
done
python3 - "$root/version.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['version'] == '0.40.11'
PY
nohup python3 -u "$root/forgeboard-muse-relay-instrumented-20261104.py" "$root" >"$root/relay.out" 2>&1 </dev/null &
echo "$!" >"$root/relay.pid"
nohup python3 -u "$root/muse-stream-resource-sample-20261104.py" "$root" >"$root/telemetry.out" 2>&1 </dev/null &
echo "$!" >"$root/telemetry.pid"
for i in {1..20}; do
    if grep -q '"event":"started"' "$root/relay-bytes.jsonl" 2>/dev/null; then break; fi
    sleep 0.25
done
grep -q '"event":"started"' "$root/relay-bytes.jsonl"
printf 'REMOTE_TEMP_OLLAMA_PID=%s\nRELAY_PID=%s\nTELEMETRY_PID=%s\n' \
    "$(cat "$root/ollama.pid")" "$(cat "$root/relay.pid")" "$(cat "$root/telemetry.pid")"
