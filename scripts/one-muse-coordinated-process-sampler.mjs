/** Non-privileged, read-only process lineage sampler for one root admission.
 * Never invokes sudo, BPF, bpftool, tracefs, inference, or a service change.
 * The remote awk only prints role/PID/PPID after matching exact argv fields.
 */
import assert from 'node:assert/strict';

const RUN=/^muse-one-[a-f0-9]{24}$/;
export function coordinatedProcessSamplerCommand(runId) {
  assert(RUN.test(runId),'run-scoped-process-identity-required');
  const script=String.raw`#!/usr/bin/bash
set -Eeuo pipefail
for i in $(/usr/bin/seq 1 70); do
  /usr/bin/ps -eo pid=,ppid=,comm=,args= | /usr/bin/awk -v run='${runId}' '
    $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {
      stage="/run/local-muse-ebpf/" run "/"
      if ($3=="python3" && $5=="-I" &&
          $6=="/usr/local/libexec/clack-one-muse-root" &&
          $7=="--run" && $8==run) print "root " $1 " " $2
      if ($3=="bash" && $5==stage "local-muse-one-root.sh" &&
          $6==run) print "root_shell " $1 " " $2
      if ($3=="python3" && $5=="-B" &&
          $6==stage "local-muse-one-ebpf.py") print "collector " $1 " " $2
      if ($3=="bpftrace" && $5=="-B" && $6=="line" &&
          $7==stage "local-muse-tcp.bt") print "tracer " $1 " " $2
    }'
  /usr/bin/sleep .1
done
`;
  const encoded=Buffer.from(script,'utf8').toString('base64');
  return `/usr/bin/bash -lc 'printf %s ${encoded} | /usr/bin/base64 -d | /usr/bin/timeout --signal=TERM --kill-after=1s 14s /usr/bin/bash -s'`;
}

export function parseCoordinatedProcessSamplerLine(line) {
  const match=/^(root|root_shell|collector|tracer) ([1-9][0-9]{0,9}) ([1-9][0-9]{0,9})$/.exec(line);
  if(!match)return null;
  const pid=Number(match[2]),parent=Number(match[3]);
  if(!Number.isSafeInteger(pid)||!Number.isSafeInteger(parent)||
    pid>2147483647||parent>2147483647)return null;
  return Object.freeze({role:match[1],pid,parent});
}
