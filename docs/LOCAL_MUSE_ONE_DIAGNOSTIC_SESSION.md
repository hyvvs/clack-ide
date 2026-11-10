# Coordinated one-Muse diagnostic: future operator-only workflow

## Safety checkpoint

**This task implemented and tested diagnostic-session infrastructure offline. It did not
launch Muse, ForgeBoard, Notes, an evaluator, model inference, an Ollama request,
a root process, SSH, or another eBPF attachment.** A separate, explicit live
authorization is required before using the future operator commands below.
Never paste a sudo password into chat or store it in a file.

The prior administrator-operated 20.650-second zero-event test remains
**REAL-HOST eBPF ATTACHMENT VALIDATED**: four native probes attached,
zero observed sends/returns/unmatched events, exact TCPSUMMARY 0 0 0,
zero loss and clean shutdown. It does not validate this new inference-length
collector under real traffic. Historical inference-27 is still unresolved.

## Exclusive future session lifecycle

The only future coordinator entrypoint is
scripts/local-muse-one-coordinator.mjs. It does not issue inference.
The source files and the original production provider/parser are not
replaced with a standalone HTTP harness.

1. Generate a cryptographically random muse-one-<24 hex digits> run ID.
   Create a new exclusive evidence directory under ignored
   src-tauri/target/local-muse-one-evidence/. Preserve historical roots.
2. Start an authenticated, loopback-only delivery journal and broker. The
   journal fsyncs each closed-vocabulary record and acknowledges it before
   a source can count as armed. Broker secrets and permits are not logged.
3. Confirm the frozen November 9 manifest SHA256 and the selected
   muse-glimmer:30b digest
   de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1.
4. Start one owned SSH forward 127.0.0.1:11435 to remote 127.0.0.1:11434
   with strict host-key checking. Refuse an existing listener. Make a
   metadata-only GET /api/tags for exact live model/digest confirmation.
   No /api/chat, inference, or model loading is required for this gate.
5. Record verified local SSH owner PID, remote Ollama service/listener PID,
   available endpoint mappings and explicit absence of a per-request socket
   join. Measure three or more paired local/remote monotonic and wall clock
   anchors with uncertainty. Refresh stale anchors before admission and
   sample clocks again at shutdown.
6. Start two bounded, read-only SSH FIFO readers and a run-bound kernel
   importer. Print exactly one operator-only PowerShell command. The human
   administrator executes it in their interactive terminal, entering any
   remote sudo password only at that terminal prompt.
7. The bounded, SHA256-verified Linux root collector uses the **unchanged**
   hardened local-muse-tcp.bt and local-muse-tcp-session.py. It requires the
   actual Ollama PID/UID/start-time/exe/listener, native completed
   "Attached 4 probes" (not "Attaching..." or BEGIN), matching newly loaded
   tcp_sendmsg kprobe program IDs, and one exact numeric
   TCPARMED <pid> 11434 4 <program count> 0 from its private readiness FIFO.
   An abort, unknown stderr/warning, event loss, missing END or failed
   identity check blocks admission. Probe startup and FIFO opens are bounded
   under GNU timeout; no permanent sudo/kernel/service changes are made.
8. Start the **isolated**, visible, production-native Clack Tauri host.
   Its real reqwest delivery, native semantic-progress observer, and actual
   WebView IPC receipt/enqueue listener register for this unique run ID.
   Their fsynced, run-bound readiness acknowledgments precede matching broker
   ready/heartbeat receipts. Code existing without active registration does
   not satisfy a gate.
9. Recheck every active source, loss/pending counter, identity and freshness.
   Only after all nine gates pass, write and fsync an exclusive
   one-muse-ready.claim containing the exact run ID and newline.
   The visible human-operated button is disabled until native verification
   of this file and its active observer registrations. The coordinator emits
   READY_FOR_ONE_INFERENCE only at this successful boundary.
10. The coordinator **never** auto-dispatches a request. A separately
    authorized future human must explicitly press the single-request button.
11. After request settlement, drain late native/WebView records, record
    terminal/loss receipts, send STOP to only the task-owned root tracer,
    await its bounded SIGINT/END/EOF and importer TCPSESSION, check root
    resource removal, close owned SSH/Tauri/Vite, and seal only when every
    mandatory numeric accounting and terminal acknowledgement passes.
    Otherwise preserve partial, unsealed evidence and report the failed gate.

## Nine mandatory current-run readiness gates

| Gate | Required positive evidence |
| --- | --- |
| identity | Frozen manifest + exact live metadata-only Muse digest |
| tunnel | Live owned loopback SSH forward, owner PID and strict host key |
| mapping | Local/remote listener/process identity; no invented request/socket join |
| clocks | Three fresh cross-host clock samples and conservative uncertainty |
| kernel | Completed native attach, scoped kernel program delta, exact PID/socket, zero initial loss |
| native | Registered production reqwest capture, run-bound durable receipt, broker ACK |
| semantic | Registered native semantic-progress capture, durable receipt, broker ACK |
| webview | Actual installed IPC receipt/enqueue listener, durable receipt, broker ACK |
| journal | Exclusive append/fsync ACK, zero loss, zero in-flight observations |

Stale run IDs, changed source identities, missing or duplicated ACKs,
unacknowledged records, unproven kernel attachment or lost events always
produce INFERENCE_BLOCKED and cleanup. Native/WebView sources that already
fsynced their own first receipt are not double-counted by the coordinator.

## Structurally one production request

The coordinator starts with request allowance = 1 and synchronously spends
it before awaiting further gates. The authenticated broker permanently
rejects another claim, including after a rejected/failed first request.
It issues a random 256-bit one-time permit only after rechecking all nine
sources. The native host receives only its SHA256 in advance and checks
the actual permit without printing or storing it.

At the original Clack native ai_http_stream boundary, the diagnostic-only
guard checks the exact run ID, single main window, one POST to
http://127.0.0.1:11435/api/chat, model muse-glimmer:30b,
stream=true, Automatic think omitted, one user message, no tools,
context 32768, output 8192 and self-hosted transport. It rejects
calibration, tool qualification, retry, automatic continuation,
fallback/substitution and alternate legacy HTTP or discovery routes.
The first permitted invocation consumes an atomic process-local compare
and swap and permanently creates/fsyncs one-muse-dispatch.claim in the
unique run root. The claim prevents reuse after a process failure/relaunch.
Normal non-diagnostic Clack safeguards are not weakened.

The request uses the **real production** createOllamaModel plus
verifiedProviderFetch(createProxyFetch) through Tauri ai_http_open,
ai_http_stream, reqwest and the existing Ollama streaming parser.
The 180-second inactivity and 600-second native overall timeouts are
unchanged. No Agent, ForgeBoard, Notes, evaluator or app-state mutation
is involved.

## Journal semantics and known observational limits

Only allowlisted, content-free metadata is durable: run ID, opaque
request ID, local/remote ports/connection pseudonyms where justified,
per-host monotonic stamps and bounded wall-clock anchors, kernel
write-attempt/return counts, native body reads, semantic decisions,
WebView receipt/enqueue counts, observer loss and terminal reason.
No prompts, responses, HTTP payloads, raw socket pointers, SSH secrets or
request-body content enter terminal or journal records.

A complete seal requires all nine matching source-ready and source-terminal
receipts, exactly one native-dispatch, one native-terminal and one WebView
settlement for one opaque request ID, one clean bounded kernel END/EOF and
zero loss/pending observations. The receipt claims **collector flush only**:
it does not prove provider completion, remote HTTP receipt, equal native
and WebView byte streams, per-request SSH attribution, or product acceptance.
Kernel socket pointers are pseudonymized, and TCP return counts are not
interchangeable with HTTP response bytes. A zero-event session never proves
send/return correlation under inference.

## Future workflow (NOT run during implementation)

First obtain a separate approval for one live instrumented Muse request.
Build the isolated example **offline**, without starting it:

    cd src-tauri
    cargo build --offline --locked --example local_muse_one_diagnostic

Then, **only under the separate future authorization**, enter from the
repository root:

    node scripts/local-muse-one-coordinator.mjs --future-operator-authorized

The coordinator prints one fresh run ID and the exact interactive PowerShell
kernel-operator command when its readers are ready. The human personally
executes that single command and supplies sudo at the remote tty. Never
reuse the prior validated 20-second helper as an inference-length collector.
Only after all nine gates pass may the human explicitly click the visible
single-request button. If any source fails, stop; do not retry.

## Offline verification and remaining boundary

Affected deterministic tests cover nine-gate admission, source liveness,
cross-host anchor/mapping checks, authenticated broker permit and stale
run rejection, durable first dispatch and no retry, partial startup
cleanup, late WebView drain, kernel STOP/EOF/cleanup, and strict
content-free journal sealing. Native Rust, WebView/TypeScript, new
Python root supervisor, PowerShell syntax and Bash shell syntax are
validated separately. No model inference or privileged host run was
needed to execute those tests.

The **new** long-session root/FIFO behavior and actual Ollama kernel
event capture under inference remain live-unverified. Historical
inference-27 remains unresolved. Do not overstate this as new end-to-end
model or product acceptance.
