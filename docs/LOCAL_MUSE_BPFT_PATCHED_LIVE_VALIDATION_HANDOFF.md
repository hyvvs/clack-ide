# Patched private bpftool: one-run validation prerequisite

Phase 1 installation has completed. The human root receipt reports
CLACK_JSON_REPLACE=PASS and CLACK_JSON_IDLE=PASS, including valid and
matching JSON for 49 programs and 3 links, owner/PID skeleton support,
and zero BPF attachment. Independent read-only SSH checks verified:

- private bpftool SHA-256: 0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0
- ELF Build ID: 7f530859f49ede16767f9f4eb8551a6ac85aa25d
- private executable: root:root, 0755, 2,479,576 bytes
- provenance manifest: exact schema 2, root:root, 0644
- no temporary root or upload stages, no active bpftrace or GDB process

## Separate root observer compatibility step, not yet executed

The existing GDB observer still pins the *old* private binary SHA and Build
ID. As a result it cannot be used as the required conditional fallback
after an ordinary patched-binary SIGABRT. Do not start the only live session
until its compatibility has been reviewed, explicitly human-approved,
installed and independently verified.

The reviewed scripts/Replace-ClackBpftoolCrashObserverForJsonFix.ps1
updates only the root-owned 0600 crash observer in the private diagnostic
tools directory. The new observer source changes just the exact private
binary SHA and Build ID; its GDB 18.1 pin, 4-second watchdog, strict
bounded redaction, symbol/source metadata and no-raw-core controls remain
unchanged. The installer requires the former installed observer hash,
the new private bpftool SHA and an exclusive 0700 same-directory root
stage, verifies staged bytes before atomic rename, keeps a verified old
backup until final validation, rolls back on failure and removes only
task-owned stages. It does not execute bpftool, GDB or BPF.

Operator command, requiring a separate interactive sudo approval:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Replace-ClackBpftoolCrashObserverForJsonFix.ps1

## After observer verification: exactly ONE ordinary live validation

The new scripts/local-muse-no-http-kernel-only-check.mjs combines the
unchanged readiness-capable real kernel bridge and import-kernel delivery
path with the previously reviewed no-Ollama-HTTP host-source adapter.
Its service/PID/comm/socket and SSH forward ownership checks are fresh,
the historical model manifest is verified without a model HTTP request,
and the root collector independently verifies executable/PID/socket,
program/link attachment and source lifecycle. It is a kernel-only gate,
not a claim that live model inventory was established.

The no-HTTP kernel listener prints a fresh run ID and operator command,
requiring one manual, <=20-second, interactive sudo root session.
Do not pass -CrashCapture: the collector must attempt ordinary live
-j link show first. An optional GDB fallback is armed only after a
negative SIGABRT return code from that ordinary live link inspection,
and only while the same tracer remains alive. A one-shot flag is consumed
before invocation. This never starts another BPF session; GDB output
never supplies link proof or readiness, and any fallback fails closed.
Ordinary inventories and STOP/importer flow are otherwise unchanged.
Kernel process core limits are scoped to the child collector only.

No live session was started during development of this handoff. The one
authorized Phase 2 run remains unused. No readiness condition or
protected user file was changed. TCPARMED and coordinated kernel readiness
remain false until positive, complete, independent live evidence exists.
