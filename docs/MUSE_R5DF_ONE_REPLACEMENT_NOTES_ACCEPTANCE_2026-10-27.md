# R5df one new replacement Muse notes acceptance — final gate / audit

**Authorized starting HEAD:** `016667e8e6f8ba6a1e5df34a02738b5a4af9c146`. **One and only one live mission:** `node scripts/r5df-muse-notes.mjs mission-a 1`, new exclusive ignored root `src-tauri/target/real-qwen-product/museglimmer-r5df-notes-20261027-01/`. Original `src/test/r5dbMuseNotesAgent.tsx` hash equals its HEAD blob (`58bcd640d6d46c42f607a1eed1009484aac6c66d`). No application intervention, Agent restart/retry, other model or ForgeBoard.

## Final classification

**INCONCLUSIVE — NATIVE-TOOL QUALIFICATION CANCELLED BEFORE AGENT.** Fresh production context calibration passed, but a genuine 73,728/512 native-tool verification request was cancelled at the SDK/parser consumer before provider `done`/EOF, leaving persisted proof `status=incomplete`, `outcome=transport`, zero native calls. The normal production Agent fail-closed gate denied coding. Therefore this is **NOT `MUSE ACCEPTED`**, and **NOT `MUSE MODEL FAIL — FINAL`** (no fair uninterrupted Agent coding attempt). No *new generic Clack defect* is proven; the exact underlying SDK/parser error trigger cannot be reconstructed from content-free metadata. Do not classify this as the earlier R5de host guard defect, Ollama timeout, or compaction failure.

## Provider / preservation intake

- The previously approved sole SSH forwarding PID 34280 was absent at intake; no port 11435 listener existed. Read-only local key/known_hosts and TCP/22 check confirmed the original approved identity. Restored only the identical pinned strict-host-key route `hylab@192.168.1.44`, `%USERPROFILE%\.ssh\clack_hylab_ed25519`, Windows localhost `127.0.0.1:11435` to remote localhost `127.0.0.1:11434`, `-N -T`, BatchMode/ExitOnForwardFailure, keepalive 30s/3, TCPKeepAlive, ConnectTimeout 8, one attempt; sole listener **PID 12932**. No key/server/remote changes.
- Read-only `/api/version` **0.40.11**; `/api/tags` **15** installed models. Exactly selected `muse-glimmer:30b`; live digest **`de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`**.
- Unchanged original six dirty tracked files; both original Git stashes, tracker, saved operator settings/profile and seven protected SHA-256 hashes; all R5db/R5dd/R5de history and frozen evidence. Exclusive run root was created without reusing or mutating historical evidence.
- WebView2 software rendering retained: `--disable-gpu --disable-gpu-compositing`. All trust, context, reasoning, timeout, native-tool and production Agent policies unchanged.

## Exact live qualification and termination

Requests **`inference-1` to `inference-7`** used `num_ctx` **4096, 8192, 16384, 32768, 49152, 65536, 73728** respectively, each with `num_predict=32`, zero tool schemas, Automatic `think` omitted, matched **requested==loaded** and provider-done/EOF. Persisted fresh production calibration `status=verified`, highest 73728, `calibrationFresh=true`, `runtimeEpochMatches=true`, `loadedContextMatches=true`, `numericalRouteQualified=true`, both direct/snapshot trust and budget target 73728. Runtime epoch **`39148:1793139988474651900`** is terminated and never transferable.

`inference-8` was the actual production **`get_probe_value`** native schema at `73728/512`, Automatic unchanged. Native HTTP **did dispatch**, provider stream yielded **451 native body chunks, 67,871 bytes, 0 event drops**. Native dispatch at Unix epoch ms **1793140056298**; first headers **1793140057546**; first-cause cancellation **1793140109997**, and native observed cancellation at **1793140109998**. **53,700ms** native dispatch→terminal. No provider-done, no HTTP EOF. No 180,000ms stream idle or 600,000ms overall timeout. Independent client-visible WebView Channel summaries for all **8** requests: maximum *adjacent headers/chunk/settled* gap **5,695ms**, in verifier `inference-8`. This is truly JS-visible callback timing, not the earlier R5de native-forwarding proxy.

Recorded **first-cause cancellation provenance**, from `mission-a-1.cancellation-provenance.jsonl`:

| Field | Value |
|---|---|
| requestId | `inference-8` |
| at (Unix ms) | `1793140109997` |
| source | `webview-cancel-ipc` |
| reason | `sdk-stream-parser-failed` |
| initiatingLayer | `ollama-sdk-stream-parser` |
| category | `error-cleanup` |
| providerRequestInFlight | `true` |

Native IPC origin was **`sdk-stream-error`**. This is the first observed initiator of cancellation, not independent proof of what caused the SDK to enter its parser error path. `providerRequestInFlight=true` means Clack's HTTP stream was still owned, not that the remote decoder was necessarily still computing.

Native persisted `toolVerification`: `context=73728`, `output=512`, `status=incomplete`, `outcome=transport`, `validArguments=false`, `calls=0`, `proof=null`. The normal Agent denied startup with **`Agent tool verification: Incomplete. Use Chat Only or review tool evidence in model settings.`** Session `real-mission-a`: `run.state=failed`, 0 steps, 0 continuations, zero executed native Agent tools. Runner `ok=true`/exit code 0 refers to report persistence, **not** successful Agent completion.

No Agent generations; therefore no initial or continuation Agent `num_predict`, no context progression beyond qualification, no opportunity to exercise the corrected continuation guard live. No Agent requests exceeded 30s or 60s; longest Agent generation and Agent-only client stream gap **not applicable**. The verifier request exceeded 30s but not 60s. No Automatic stale-runtime continuation reinspection or compaction event; no valid compaction-budget inputs/margins to report. Live continuation was **not** established.

## Exactly one independent freeze / app acceptance

After native host PID 39148 exited cleanly, executed `node scripts/r5df-freeze-evaluate.mjs` **exactly once**. The exclusive `independent-evaluation.started` marker and `independent-evaluation.json` are durable. Original Agent workspace has only its empty `.git`; **zero authored app source files**. Frozen snapshot untouched. App verdict **`NOTES_APP_FAIL`**, with **0 authored test files / 0 tests discovered**. `tsc`, application build, `npm test` and backend `start` were **not executed** because there was no package, script or TypeScript project; health, CRUD, validation, missing IDs and real-backend restart/persistence were **not exercised**. README and `.gitignore` absent. Distinguish this *blocked-by-qualification* app evaluation from a model's ordinary coding failure.

Independent offline `scripts/r5df-native-audit.mjs` (executed once, no model/app requests) reconciled 8 exact wire bodies, all 8 native receive snapshots, 8 client callback timing summaries, 7 calibration successes, one live verifier cancellation, native persisted profile and failed session, zero real Agent tools, one frozen app evaluation; saved content-addressed SHA-256 receipts in `mission-a-1.offline-audit.json`. The corrected harness's 49152/6144 continuation output regression previously passed offline at baseline HEAD, but its *live* route was not reached in R5df.

**STOP:** One authorized new mission consumed. No second Muse mission, other model, production workaround, ForgeBoard, destructive cleanup, Git reset, Git clean or push. Another live experiment would need fresh explicit authorization and its own runtime qualification/evidence root.
