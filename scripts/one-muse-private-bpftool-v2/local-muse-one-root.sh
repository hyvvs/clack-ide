#!/usr/bin/env bash
# FUTURE ONLY: invoked by the human administrator's interactive SSH sudo shell.
# This script NEVER calls Ollama, runs inference, or changes a service/sysctl.
# It requires a root-owned byte-verified stage made by the reviewed operator.
set -Eeuo pipefail
umask 077

if (($# < 2 || $# > 5)) || [[ $(id -u) != 0 ]]; then
  printf 'OPERATOR_EBPF_EXIT=1\n' >&2
  exit 1
fi
run_id=$1
expected_pid=$2
seconds=${3:-1800}
operator_stage=${4:-}
crash_capture_mode=${5:-off}
if [[ ! $run_id =~ ^muse-one-[a-f0-9]{24}$ ]] || [[ ! $expected_pid =~ ^[1-9][0-9]{1,9}$ ]]; then
  printf 'OPERATOR_EBPF_EXIT=1\n' >&2
  exit 1
fi
if [[ ! $seconds =~ ^[1-9][0-9]{0,3}$ ]] || ((seconds > 1800)); then
  printf 'OPERATOR_EBPF_EXIT=1\n' >&2
  exit 1
fi
if [[ $crash_capture_mode != off && $crash_capture_mode != capture ]] || \
      [[ $crash_capture_mode == capture && $seconds -gt 20 ]]; then
  printf 'OPERATOR_EBPF_EXIT=1\n' >&2
  exit 1
fi
if ((seconds != 1800)); then
  # Short kernel-only validation exports only closed-vocabulary numeric
  # diagnostics to its own already-verified, hylab-owned ephemeral stage.
  if [[ $seconds -gt 20 || ! $operator_stage =~ ^/home/hylab/\.cache/clack-muse-one-stage\.[A-Za-z0-9]{8}$ ||
        ! -d $operator_stage || -L $operator_stage ||
        $(stat -c '%u:%a' -- "$operator_stage") != "$(id -u hylab):700" ]]; then
    printf 'OPERATOR_EBPF_EXIT=1\n' >&2
    exit 1
  fi
fi
root=/run/local-muse-ebpf
dest=$root/$run_id
probe=$dest/local-muse-tcp.bt
support=$dest/local-muse-tcp-session.py
session=$dest/local-muse-one-ebpf.py
control=$dest/control.fifo
ready=$dest/ready.fifo
metadata=$dest/metadata.fifo
inventory_audit=$dest/kernel-inventory-audit.jsonl
owned=0
cleanup() {
  local code=$? clean=PASS
  trap - EXIT INT TERM HUP
  if ((owned)); then
    if [[ -d $dest && ! -L $dest && $(stat -c '%u' -- "$dest") == 0 ]]; then
      /usr/bin/rm -f -- "$control" "$ready" "$metadata" "$probe" "$support" "$session" "$dest/local-muse-one-root.sh" "$dest/kernel-audit.stderr" "$dest/kernel-audit.numeric" "$inventory_audit" || clean=FAIL
      /usr/bin/rmdir -- "$dest" || clean=FAIL
      # The bootstrap refused any pre-existing /run/local-muse-ebpf root, so
      # this parent is also task-owned. A leftover parent blocks the next run.
      /usr/bin/rmdir -- "$root" 2>/dev/null || clean=FAIL
    else
      clean=FAIL
    fi
  fi
  printf 'OPERATOR_EBPF_EXIT=%d\nOPERATOR_EBPF_CLEANUP=%s\n' "$code" "$clean" >&2
  if [[ $clean != PASS ]]; then exit 1; fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
if [[ ! -d $root || -L $root || ! -d $dest || -L $dest ||
      $(stat -c '%u' -- "$root") != 0 ||
      $(stat -c '%u' -- "$dest") != 0 ||
      $(stat -c '%G' -- "$root") != hylab ||
      $(stat -c '%G' -- "$dest") != hylab ||
      $(stat -c '%a' -- "$root") != 710 ||
      $(stat -c '%a' -- "$dest") != 710 ]]; then
  exit 1
fi
owned=1
for source in "$probe" "$support" "$session" "$dest/local-muse-one-root.sh"; do
  if [[ ! -f $source || -L $source || $(stat -c '%u' -- "$source") != 0 ||
        $(stat -c '%a' -- "$source") != 600 ]]; then
    exit 1
  fi
done
if [[ $(/usr/bin/sha256sum -- "$probe" | /usr/bin/cut -d' ' -f1) != e21b5348e78820b432cdaec9dbf30ffaf4b68a22034f54f960d9d9d152d649f0 ||
      $(/usr/bin/sha256sum -- "$support" | /usr/bin/cut -d' ' -f1) != d22c0994402744a6a978d4a8d53b140d9d6c0780a316e54f9d8c7c7c85e014cf ]]; then
  exit 1
fi
pid=$(/usr/bin/systemctl show --value -p MainPID ollama.service)
if [[ $pid != "$expected_pid" ]]; then exit 1; fi
if ! command -v /usr/bin/pgrep >/dev/null 2>&1 || /usr/bin/pgrep -x bpftrace >/dev/null 2>&1; then
  # Another active tracer could satisfy an unrelated program-count delta.
  exit 1
fi
if [[ -e $control || -e $ready || -e $metadata ]]; then exit 1; fi
/usr/bin/mkfifo -m 0600 -- "$control" "$ready" "$metadata"
/usr/bin/chown root:hylab -- "$control" "$ready" "$metadata"
/usr/bin/chmod 0620 -- "$control"  # hylab may write STOP, never read
/usr/bin/chmod 0640 -- "$ready" "$metadata"  # only hylab may read
for pipe in "$control" "$ready" "$metadata"; do
  if [[ ! -p $pipe || -L $pipe || $(stat -c '%U:%G' -- "$pipe") != root:hylab ]]; then
    exit 1
  fi
done
# FIFO opens happen inside the timeout child. A missing SSH reader must not
# leave the administrator's root shell blocked before its watchdog starts.
set +e
# Production still runs exactly 1800 seconds with the original 1806-second
# outer limit. A separately authorized kernel-only check can use 20 seconds;
# it is never a shortcut to a coordinator readiness ACK.
seconds_plus_six=$((seconds + 6))
/usr/bin/touch -- "$dest/kernel-audit.stderr"
/usr/bin/chmod 0600 -- "$dest/kernel-audit.stderr"
/usr/bin/touch -- "$inventory_audit"
/usr/bin/chmod 0600 -- "$inventory_audit"
fixed_bpftool_mode=fixed
if ((seconds != 1800)); then
  # Short no-traffic diagnostic sessions on this affected host MUST use
  # the privately SHA-pinned and root-owned fixed tool. No PATH fallback.
  fixed_bpftool_mode=fixed
fi
/usr/bin/timeout --signal=TERM --kill-after=2s "${seconds_plus_six}s" \
  /usr/bin/bash -c '
    args=(--pid "$2" --seconds "$6" --ready-fd 3 --control-fd 0 --inventory-audit-fd 4)
    if [[ "$8" == fixed ]]; then args+=(--fixed-diagnostic-bpftool); fi
    if [[ "$9" == capture ]]; then args+=(--capture-live-link-abort); fi
    exec /usr/bin/python3 -B "$1" "${args[@]}" \
      0<>"$3" 1>"$4" 3>"$5" 4>"$7"
  ' bash "$session" "$pid" "$control" "$metadata" "$ready" "$seconds" "$inventory_audit" "$fixed_bpftool_mode" "$crash_capture_mode" \
    2>"$dest/kernel-audit.stderr"
status=$?
set -e
# The raw private stderr is never exported. A real kernel code path can emit
# only content-free closed-vocabulary KERNEL_AUDIT_* rows in the operator log.
# Capture source stdout/stderr by exact byte length and SHA256, never socket
# pointers. The numeric importer remains entirely untouched.
if (( $(stat -c '%s' -- "$dest/kernel-audit.stderr") <= 65536 )); then
  /usr/bin/grep -E '^KERNEL_AUDIT_[A-Z0-9_]+=[A-Za-z0-9_-]{1,96}$' \
    -- "$dest/kernel-audit.stderr" >"$dest/kernel-audit.numeric" || true
  printf 'KERNEL_AUDIT_OPERATOR_CHILD_EXIT=%d\n' "$status" >> "$dest/kernel-audit.numeric"
  # One JSONL line per invocation. Only bounded counts, hashes and strictly
  # allowlisted bpftool diagnostics are present; never export raw BPF JSON.
  if (( $(/usr/bin/stat -c '%s' -- "$inventory_audit") > 2097152 )); then
    printf 'KERNEL_AUDIT_INVENTORY_EXPORT=overflow\n' >> "$dest/kernel-audit.numeric"
    status=1
  else
    printf 'KERNEL_AUDIT_INVENTORY_FILE_BYTES=%s\n' "$(/usr/bin/stat -c '%s' -- "$inventory_audit")" >> "$dest/kernel-audit.numeric"
    printf 'KERNEL_AUDIT_INVENTORY_FILE_SHA256=%s\n' "$(/usr/bin/sha256sum -- "$inventory_audit" | /usr/bin/cut -d' ' -f1)" >> "$dest/kernel-audit.numeric"
    if ((seconds != 1800)); then
      /usr/bin/install -o hylab -g hylab -m 0600 \
        "$inventory_audit" "$operator_stage/operator-inventory-audit.jsonl"
    fi
  fi
  /usr/bin/cat -- "$dest/kernel-audit.numeric" >&2
  if ((seconds != 1800)); then
    /usr/bin/install -o hylab -g hylab -m 0600 \
      "$dest/kernel-audit.numeric" "$operator_stage/operator-audit.numeric"
  fi
else
  printf 'KERNEL_AUDIT_STREAM_OVERFLOW=1\n' >&2
  status=1
fi
exit "$status"
