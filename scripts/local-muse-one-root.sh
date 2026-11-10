#!/usr/bin/env bash
# FUTURE ONLY: invoked by the human administrator's interactive SSH sudo shell.
# This script NEVER calls Ollama, runs inference, or changes a service/sysctl.
# It requires a root-owned byte-verified stage made by the reviewed operator.
set -Eeuo pipefail
umask 077

if (($# != 2)) || [[ $(id -u) != 0 ]]; then
  printf 'OPERATOR_EBPF_EXIT=1\n' >&2
  exit 1
fi
run_id=$1
expected_pid=$2
if [[ ! $run_id =~ ^muse-one-[a-f0-9]{24}$ ]] || [[ ! $expected_pid =~ ^[1-9][0-9]{1,9}$ ]]; then
  printf 'OPERATOR_EBPF_EXIT=1\n' >&2
  exit 1
fi
root=/run/local-muse-ebpf
dest=$root/$run_id
probe=$dest/local-muse-tcp.bt
support=$dest/local-muse-tcp-session.py
session=$dest/local-muse-one-ebpf.py
control=$dest/control.fifo
ready=$dest/ready.fifo
metadata=$dest/metadata.fifo
owned=0
cleanup() {
  local code=$? clean=PASS
  trap - EXIT INT TERM HUP
  if ((owned)); then
    if [[ -d $dest && ! -L $dest && $(stat -c '%u' -- "$dest") == 0 ]]; then
      /usr/bin/rm -f -- "$control" "$ready" "$metadata" "$probe" "$support" "$session" "$dest/local-muse-one-root.sh" || clean=FAIL
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
/usr/bin/timeout --signal=TERM --kill-after=2s 1806s \
  /usr/bin/bash -c '
    exec /usr/bin/python3 -B "$1" --pid "$2" --seconds 1800 \
      --ready-fd 3 --control-fd 0 0<>"$3" 1>"$4" 3>"$5"
  ' bash "$session" "$pid" "$control" "$metadata" "$ready"
status=$?
set -e
exit "$status"
