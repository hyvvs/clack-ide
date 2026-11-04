# Muse notes: one live Clack calibration-renewal acceptance — final

**Final classification: `MUSE ACCEPTED — LOCAL AGENT PROVEN`.**

**Starting HEAD:** `fe918e8569415e0b77f2c5e873d0e19554db3079`.
**Model:** `muse-glimmer:30b`, exact digest
`de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`.
**Execution:** November 4, 2026, approximately 03:42–04:03 CET, **one unchanged
notes Agent mission**, **one independent frozen evaluation**. No other local
model, hosted inference, mission retry, repair by operator or ForgeBoard task.

## 1. Protected baseline and isolated provider

Entry HEAD was the approved post-fix Clack revision. The six original dirty
tracked files, both stashes, `autonomous_tracker`, the original operator
`%APPDATA%/app.clack.dev/terax-settings.json` and the November 3 frozen
evidence were fingerprinted or enumerated. The operator settings SHA-256 at
entry was `E66F05DB23AD21ADC7F48E18228A50AA8C32D1C0AC6715FEE1BDDDAF784D3EEC`.
The older eight frozen sources matched their evaluator's hashes, and the
historical raw TRACE matched SHA-256
`AA937CDC3AD94BCD3992ABA8A76F1BC2D62A7C5E562E7E3196C1ACC17D27EBAC`.

The original pinned local SSH forward to the **system** Ollama service was
absent at entry, so only the previously approved route was restored:
Windows PID **32868**, `127.0.0.1:11435` → lab `127.0.0.1:11434`, with the
unchanged identity, pinned host key and strict forwarding flags. Original lab
system `ollama.service` was already active as PID **974**, user `ollama`.
Installed Ollama **0.40.11**, **15** models, **zero** loaded system models and
the exact required Muse digest were verified via its existing API. The
service's unit and override SHA-256 fingerprints were:

- `e65cda8b2426dc30e876899dce98ac4cf6d7ff138c529ef19692f39692142e06`
- `813fb1433d898cf01162e6b70ec8f10beb1e02575761737283b021bf0220a80a`

No service change, systemd reload, model download, provider setting change,
permissions change, timeout increase or trust relaxation occurred.

The **temporary** isolated diagnostic server was the *same installed* binary,
user `hylab`, PID **14873**, `OLLAMA_HOST=127.0.0.1:11436`,
`OLLAMA_MODELS=/var/lib/ollama`, and **process-scoped** `OLLAMA_DEBUG=2`.
The model store root was not writable by that user; no model-store mutation
was performed. The separate strict diagnostic Windows SSH tunnel was PID
**25268**, `11436 → 11436`. Remote read-only GPU/RAM/swap/runner sampling
ran as task-owned PID **15125**, typically every two seconds. The original
system endpoint and tunnel were not redirected or modified.

The exclusive run root
`src-tauri/target/real-qwen-product/muserenewalnotes-20261104-01/`
contained a new empty Git workspace and separate native/Clack acceptance
data. The host was a task-owned clone of the earlier one-shot mission host,
with only the new run ID and passive trust-evidence observation added; the
**original mission prompt, production Agent/tool logic, calibration,
reasoning policy and output limits** were unchanged. The task-only mission
host and evaluator scripts are retained in `scripts/` for audit, **not**
authorization to rerun them.

## 2. Exactly one live mission and qualification

| Fact | Observed |
| --- | --- |
| Mission and native host | One `mission-a 1`; WebView native PID **23216**, Node host PID **34004**, native exit **0** |
| Initial genuine context inference | **7** requests, `inference-1..7`, 4,096 → 73,728, each **32** output tokens, zero tools |
| Genuine exact-tier native-tool verification | **3** separate verifier requests: `inference-8` at 73,728, `inference-9` at 32,768, `inference-25` at 49,152, each with one real native schema |
| Genuine automatic renewal | **1** request, `inference-33`, 49,152 context / **32** output tokens / zero tools |
| Agent inference requests | **35**: 24 initial-batch, 11 logical-continuation |
| Total native requests | **46** = 7 initial calibration + 3 verifier + 1 renewal + 35 Agent |
| Agent tools actually executed | **34** native calls, all reported `output-available` |
| Logical Agent state | **35** steps; **one** automatic logical continuation; terminal `completed`, budget `complete`, no recorded run error |
| Cloud/hosted inference | **0** |

Genuine tool calls by name: `list_directory` **3**, `todo_write` **4**,
`bash_run` **10**, `read_file` **4**, `create_directory` **3** and
`write_file` **10**. No operator authored or repaired the notes app.

## 3. The live calibration-renewal lifecycle

| Item | Old calibration | New calibration |
| --- | --- | --- |
| Record ID | `1802225c-6b35-4757-9624-c8dda879966f` | `95f765ee-286a-4b08-b9b5-bf0c5bfc2ec0` |
| Status | `verified` | `verified` |
| Measured tiers | Seven successful tiers, highest **73,728** | **One actual new inference at 49,152** |
| Last measurement | **03:44:14.597 CET** | **03:58:54.353 CET** |
| Expiration | **03:59:14.597 CET** | **04:13:54.353 CET** |
| Digest / provider version | Same required SHA-256 / `0.40.11` | Same |
| Persisted runtime epoch | `23216:1793760178143946200` | **Same** |

The selected exact-tier native-tool proof before and after was the **same,
still-valid** ID `7ea15ab4-d812-42db-9cbb-b5468dd51904`, context
**49,152**, expiry **November 5, 2026, 03:53:08.165 CET**. Its ID,
scope and expiry were not extended. Other independently successful tool
proofs included 73,728 and 32,768.

**Causal event order from actual Unix-millisecond native receipts:**

1. `inference-32` was admitted on the original calibration and completed at
   approximately **03:58:47.991 CET**. Production entered a safe Agent step
   boundary, within the ordinary 30-second pre-expiry lead period.
2. Native `self_hosted_context_runtime` inspections were invoked at
   **1793761128965** and **1793761129833**; a live provider refresh occurred
   before the new calibration. (These logs save invocation times, **not** the
   IPC response bodies, so the persisted epoch is the independently grounded
   scope evidence.)
3. **`inference-33`** genuinely dispatched at **1793761130170**, with
   `num_ctx=49152`, `num_predict=32`, no tools, and original Automatic
   reasoning wire omission. Headers at **1793761130958**, provider completion
   and EOF at **1793761133723**, HTTP **200**. This was **not** an allocation
   metadata read and **not** an altered old TTL.
4. A new calibration ID appeared as `verifying`, then `verified` at
   **1793761134353** with a successful requested-and-loaded **49,152**
   measurement, fresh live allocation observation at **1793761134300** and
   the actual new 900,000 ms expiry.
5. Runtime identity inspection was invoked again at **1793761134324** and
   **1793761134458**; native probe-cache reads occurred immediately before
   the next Agent inference. The original 49,152 tool proof remained eligible.
6. **`inference-34`** dispatched at **1793761134709** using the **new**
   calibration and original exact-tier proof; HTTP **200**, provider done
   and EOF. `inference-35` began *before* the old expiry but was allowed to
   finish *after* it. It was **not cancelled** for mid-flight expiry.
7. **`inference-36`** began at **1793761164948**, **after** the old expiry,
   on the fresh lease with context **49,152** / output **6,144** and the
   existing logical run's 13 native-tool schemas. `inference-37` also
   returned **HTTP 200/done/EOF**. The original `real-mission-a` Agent
   continued with retained tool history, one logical continuation, and
   ultimately `completed`.

**Renewal trigger count: ONE.** Exact-tier proof refresh count at that
boundary: **zero**, because the existing genuine proof remained valid.
Model identity, runtime epoch, measured loaded context/allocation and final
native pre-dispatch checks stayed in force. The original calibration did not
magically become valid again; a new record was persisted. The live run
continued naturally after the first original 15-minute lease expired.

The passive 650 ms trust snapshots document record/proof/allocation identities
near request times; they are **not** evidence of the native IPC response body
and should not be mistaken for a per-request atomic preflight capture. The
native HTTP dispatch, headers, provider done and EOF are separately captured.
No hidden retry or infinite qualification loop occurred.

## 4. Correlated TRACE, long requests and resource pressure

**Every one of 46 native requests** has final native HTTP **200**, provider
`done`, EOF and completed settlement. Correlated provider TRACE contains
**46** successful `POST /api/chat` completion access records, **46**
`llama-server completion request` entries and **46** `context for request
finished` entries, with **0 WARN/ERROR** lines. There are **9** explicitly
observable scheduler incoming-request trace markers and **18**
`llama-server started in ...` log lines, including duplicate line emissions;
these are not claimed as 46 individual ingress/start markers. The resource
sampler observed actual runner PIDs **17516** (32,768 working context) and
**20581** (49,152 working context), among transitional startup PIDs. Cross
host native/TRACEs are correlated by timestamps and observed order, **not**
by a shared provider-side native request ID; no millisecond-accurate
cross-host clock synchronization is claimed.

All **11 Agent generations over 30 seconds** (send-await-start → native EOF):

| Native ID | Runtime | Headers from send | Total to EOF | Maximum browser-visible chunk gap |
| --- | ---: | ---: | ---: | ---: |
| `inference-10` | 32,768 | 9.189 s | **45.616 s** | 7.886 s |
| `inference-11` | 32,768 | 0.976 s | **55.127 s** | 23.181 s |
| `inference-20` | 32,768 | 1.145 s | **30.818 s** | 29.025 s |
| `inference-23` | 32,768 | 1.001 s | **30.939 s** | 29.821 s |
| **`inference-24`** | 32,768 | 0.978 s | **96.585 s** | 95.401 s |
| **`inference-28`** | 49,152 | 0.932 s | **101.652 s** | 100.409 s |
| **`inference-29`** | 49,152 | 1.077 s | **120.275 s** | **104.394 s** |
| `inference-36` | 49,152 | 23.120 s | **39.017 s** | 5.196 s |
| `inference-41` | 49,152 | 1.112 s | **31.723 s** | 29.955 s |
| `inference-45` | 49,152 | 1.376 s | **34.102 s** | 23.870 s |
| `inference-46` | 49,152 | 1.279 s | **38.332 s** | 0.752 s |

There are exactly **three** generations over 60 seconds:
`inference-24`, `inference-28`, `inference-29`. **Longest**
generation: **120.275 s** (`inference-29`). **Maximum client stream gap:**
**104.394 s** (`inference-29`). **Largest send-to-headers gap:**
**23.120 s** (`inference-36`), below 30 seconds; the previous long
**no-header** stall did **not** recur. The three >60 s requests all had
response headers within about one second, a native done marker and EOF.
Their long browser-visible gaps were after headers. The native and client
stream traces should not be conflated with runner scheduling gaps.

The **710 complete** read-only samples, including actual loaded-runner
observations, showed:

| Resource | Observation |
| --- | ---: |
| Peak GPU utilization | **100%** |
| Peak VRAM used | **15,207 MiB** |
| Minimum VRAM free | **802 MiB** |
| Minimum Linux `MemAvailable` | **24,937,684 KiB** (~23.78 GiB) |
| Peak swap used | **393,632 KiB** |
| Swap used, first → last | 144 → 393,596 KiB, **+393,452 KiB** |
| `pswpin`, first → last | 0 → 28, **+28 pages** |
| `pswpout`, first → last | 36 → 97,891, **+97,855 pages** |
| Long 32K generations, sampled runner | PID **17516**, peak **14,999 MiB** VRAM, minimum **1,010 MiB** free in those windows |
| Long 49K generations, sampled runner | PID **20581**, peak around **15,207 MiB**, minimum **802 MiB** free |

Swap activity was **measured**; it is not independently proof that swap caused
any particular stream gap. All three long generations completed successfully
with normal HTTP and provider termination. The native client/scheduler
correlation observed **zero** native cancellation, **zero** failed settled
event, **zero** provider retry/recovery events and parser diagnostic
`failureCount=0`. No stall was classified as model failure.

The **full 46-row per-request CSV** preserves every request ID, context,
output allowance, native dispatch/send/headers/first body/done/EOF timestamps,
correlated client gap, sampled calibration/proof identity and expiry,
allocation observation timestamp and *hash only* of the allocation value,
and sampled GPU/VRAM/RAM/swap/runner metrics:
`docs/MUSE_LIVE_CALIBRATION_RENEWAL_NOTES_2026-11-04.requests.csv`.
The original bounded native event JSONL and complete raw provider TRACE
remain preserved in exclusive ignored evidence roots.

## 5. Independent immutable notes acceptance — **one evaluation**

The only evaluation invocation froze the 9 authored source/manifest/doc files
and independently checked the project. Its saved verdict:
**`NOTES_APP_PASS`**, all **17** evaluator checks true, with zero
evaluator errors. Frozen-source SHA-256s were rechecked after evaluation.

| Requirement | Frozen result |
| --- | --- |
| TypeScript check | **PASS**, exit 0 |
| Production build | **PASS**, exit 0 |
| Authored executable tests and real discovery | **PASS**, `src/tests/api.test.ts` discovered |
| Actual `npm test` | **PASS**, exit 0; its output reports 11 executed API/restart tests |
| Startup and `GET /health` | **PASS** |
| Notes create/list/get/update/delete | **PASS** |
| Empty/oversized title, bad input, missing ID behavior | **PASS** |
| Persistence after actual backend restart | **PASS** |
| Useful `README.md`, `.gitignore` | **PRESENT/PASS** |
| No external-model use | **PASS** |
| Actual Agent terminal state | `completed`, not manufactured by evaluator |

Frozen files: `.gitignore`, `package-lock.json`, `package.json`,
`README.md`, `src/server.ts`, `src/store.ts`,
`src/tests/api.test.ts`, `src/types.ts`, `tsconfig.json`.

No follow-up repair, restart of the notes mission or second independent
evaluation occurred.

## 6. Cleanup, evidence integrity and next work

Cleanup was performed only after the run completed and the two raw remote
files were SHA-verified against copied local bytes:

| Raw resource | SHA-256 |
| --- | --- |
| `ollama-trace.raw.log` (3,843,456 bytes) | `c425c4df127590afb2b69d362b99831f39e07516b6803bcee3944aca7b1ee2af` |
| `resources-foreground.txt` (585,732 bytes) | `f349c53e9ad2dd9b3ff462521b3834cd8f3a2a047b773b96b8013c75fd34a5b0` |

Task-only sampler **15125** stopped. The unprivileged diagnostic Ollama
**14873** was owner/command-line checked, given SIGTERM and confirmed absent.
Temporary lab and Windows port **11436** closed; separately verified
diagnostic SSH **25268** was stopped. After hashes matched, precisely the
**eight** known task-owned files in
`/tmp/clack-muse-renewal-notes-20261104-01` were removed and its now-empty
directory removed; no historical scratch or other files were touched.
Read-only checks found **no remaining diagnostic runner**.

The original **system Ollama PID 974** remains active, its two unit hashes
unchanged, service `OLLAMA_MODELS=/var/lib/ollama` and no configured DEBUG,
0.40.11, 15 installed models, 0 loaded system models, same Muse digest,
system port **11434** healthy. The original pinned SSH forwarding PID
**32868** remains healthy on Windows local port **11435**. A post-cleanup
`find -writable` found no writable accessible model-store entries (one
private `.nv` directory returned permission-denied, not proof of every
unreadable entry's attributes). No systemd, operator-settings, network
policy, model blob, GPU or native trust setting changed.

The original six dirty tracked files and fingerprints, both stashes,
`autonomous_tracker`, operator settings, historical eight frozen-source
hashes and original raw TRACE remain protected. No reset, clean or push.
Task-only metadata receipts and full raw telemetry remain under:

- `src-tauri/target/real-qwen-product/muserenewalnotes-20261104-01/`
- `src-tauri/target/real-qwen-product/muserenewalnotes-telemetry-20261104-01/`

Notable task-owned receipts: `mission-a-1.correlated-audit.json`,
`mission-a-1.trust-timeline.jsonl`,
`mission-a-1.receive.jsonl`, `mission-a-1.requests.jsonl`,
`independent-evaluation.json`,
`remote-files.sha256.txt` and `post-cleanup.json`.
They include the underlying timestamps and SHA-256 provenance. Raw TRACE is
**not** added to the Git report commit because it can contain sensitive
provider/internal content; the audit CSV carries only anonymized metadata,
context sizes, proof IDs and allocation **hash**, not prompt, answer or tool
contents.

**Final decision: `MUSE ACCEPTED — LOCAL AGENT PROVEN`.**
The live-safe calibration lifecycle and the unchanged single notes mission
both succeeded, independently passing full frozen application evaluation.
Notes-model qualification ends. **ForgeBoard was NOT run**; any ForgeBoard
task requires a separate authorization.
