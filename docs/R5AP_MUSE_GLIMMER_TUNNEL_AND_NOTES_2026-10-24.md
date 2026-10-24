# R5ap — Restore approved tunnel; one Muse Glimmer native qualification and notes acceptance

**Date:** 2026-10-24. **Baseline:** `3916954aa463629567df363eb67b3897636b3cc2`. **Final classification: MODEL UNSUITABLE / UNRELIABLE** for reliable local Agent eligibility and small-application delivery; **Muse NOT ACCEPTED FOR FORGEBOARD**. No generic Clack defect demonstrated and no operational provider outage during the attempted mission. Exactly **one selected model**, **one qualification-only run**, **one conditional unchanged mission**, **one independent frozen evaluation**. No production changes or reruns.

## Restored original previously approved manual SSH tunnel

- Confirmed there were **no** local `127.0.0.1:11435` listeners or other Windows `ssh.exe` processes; original PID 36768 was absent. Followed the documented original R5k route (no new credentials, identity, target, or remote configuration).
- Existing original identity `%USERPROFILE%\.ssh\clack_hylab_ed25519`, existing pinned `known_hosts` entry for `192.168.1.44` and SSH TCP/22 reachability all verified **before connecting**. Launched **one** hidden SSH process `hylab@192.168.1.44`, `-N -T -L 127.0.0.1:11435:127.0.0.1:11434`; original documented flags `BatchMode=yes`, `ExitOnForwardFailure=yes`, `StrictHostKeyChecking=yes`, `ConnectTimeout=8`, `ConnectionAttempts=1`, `ServerAliveInterval=30`, `ServerAliveCountMax=3`, `TCPKeepAlive=yes`. Sole listening PID **35272**. No shell commands executed on remote host; no remote Ollama/service/config changes.
- Live read-only `GET /api/version`, `/api/tags`, `/api/ps` returned Ollama **0.40.8**, **10 installed models**, and initially zero loaded models. `POST /api/show` on the already-installed Muse returned `completion,vision,tools,thinking`. Live model **`muse-glimmer:30b`**, digest **`de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`**.
- Original saved Clack profile under `src-tauri/target/real-qwen-product/qwen-smoke-r5af-20261024-01/data/terax-settings.json` exactly matches digest, endpoint `real-qwen` revision 1, `overrides={}`, normal Automatic. Original saved-settings SHA-256 **`2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb`** unmodified. Tunnel/PID remained present, `/api/version` returned 0.40.8 and live Muse digest still matched **after** the failed mission.

## Qualification-only — PASS

- Fresh isolated empty Git workspace `src-tauri/target/muse-r5ap-qualification-20261024-01/`, preserved runtime/evidence `src-tauri/target/real-qwen-product/muse-r5ap-qualification-20261024-01/`. Copied R5an isolated test-only Tauri/Agent harness with selected model/digest/unique root and run IDs only; reused same evaluator and task. No production Clack edits. Harness `npm.cmd run check-types` **PASS**, Rust host acceptance wire tests **6/6 PASS** (only Rust warning from a duplicate test-model alternative).
- Six **fresh** Clack production calibration requests at `num_ctx=4096,8192,16384,32768,49152,65536`, `num_predict=32`, no tools. Current runtime allocation/trusted context **65536**, matching persisted calibration runtime epoch `18384:1792865704151676900`. Seventh request exposed exactly one `get_probe_value` schema at `num_ctx=65536`, `num_predict=512`; Automatic `think` **absent** in all seven request bodies.
- **True native call verified**: `toolVerification.status=verified`, `outcome=native-call`, `calls=1`, `validArguments=true`, `finish=tool-calls`. Qualification runner `resultOk=true`, strict native final receipt `ok=true` with numeric trusted target 65536, host exit 0, `missionStarted=false`. This is Muse's **own fresh proof**, not reused other-model evidence.

## Exactly one original notes-API mission — FAILED AT OWN NATIVE VERIFICATION

- Fresh independent empty Git workspace `src-tauri/target/muse-r5ap-notes-20261024-01/` and separate native evidence `src-tauri/target/real-qwen-product/muse-r5ap-notes-20261024-01/`. Full original notes specification is **byte-identical (1100 characters)** to R5an and previous candidates. Built-in Coder, ordinary tool permission/exposure, normal Automatic (no explicit thinking override), no cloud or model download, no mid-run coaching, manual source edit, forced continuation, change to settings or second run.
- **Fresh mission-runtime calibration passed 6/6** and its numeric/trusted runtime target again reached **65536**, new runtime epoch `17060:1792865855481824800`. The seventh request used one actual native `get_probe_value` schema with `num_ctx=65536`, `num_predict=512`, model ID/digest expected, `think` absent. Response headers and first body bytes arrived, but ~54 seconds after native verification request began the transport receipt was `channel-settled-cancelled`. No verified tool call on the mission runtime. Persisted profile `toolVerification.status=incomplete`, `outcome=transport`, `calls=0`, `validArguments=false`. No subsequent Agent generation requests.
- Clack persisted Agent run `state=failed` with exact terminal error **“Agent tool verification: Incomplete. Use Chat Only or review tool evidence in model settings.”** Although the checkpoint report has `missionStarted=true` (attempted Agent execution) and the runner exited 0 with an acknowledged `ok=true` *report*, this **does not imply successful Agent eligibility or application completion**. Actual **Agent coding tool calls = 0**, **generated application source files = 0**. Stop naturally; do not retry, fix, or infer a generic production defect from a cancelled model-specific native verification stream.
- The same original SSH tunnel and provider remained healthy immediately afterward, with the same installed digest, so this is **not OPERATIONALLY BLOCKED**. A separate qualification proof did succeed, but Muse failed to repeat native verification within the one allowed practical Agent mission: **MODEL UNSUITABLE / UNRELIABLE for this stage**, not a diagnosed generic Clack bug. Model reasoning for the cancellation is not independently known.

## One unchanged independent source-frozen evaluation

Ran `scripts/r5ap-independent-notes.mjs` **once** after the run ended on the separate app root. It wrote the same `frozen-source-manifest.json` and `independent-notes-check.json` as R5an. **`sourceUntouched=true`**; no app files existed except empty Git metadata.

| Acceptance check | Result | Evidence |
| --- | --- | --- |
| Genuine native tool qualification | **PASS** (qualification-only) | One verified genuine `get_probe_value` call |
| Genuine Agent coding tool use | **FAIL** | Mission runtime proof `incomplete/transport`; no Agent coding requests/calls |
| Generated complete application | **FAIL** | Zero application files |
| TypeScript compilation | **BLOCKED** | No package/source |
| Production build | **BLOCKED** | No package/build script |
| Server startup | **FAIL** | No startable server |
| Notes CRUD and input validation | **BLOCKED** | No running server |
| Persistence after restart | **BLOCKED** | No running server |
| Authored automated tests | **FAIL** | None |
| Automated test execution | **BLOCKED** | No package/test script |
| README/setup instructions | **FAIL** | None |
| Runtime-ignore behavior | **FAIL** | No `.gitignore` |
| Source frozen unchanged | **PASS** | `sourceUntouched=true` |

## Decision and protected scope

**MODEL UNSUITABLE / UNRELIABLE**, **NOT LOCAL MODEL ACCEPTED FOR FORGEBOARD**, **NO concrete generic CLACK DEFECT** demonstrated. The available installed candidates' completed application acceptances have not met the small-app standard; Muse also failed to establish repeatable native-tool Agent eligibility. **Do not evaluate a second model automatically.** A separately authorized next decision is whether to install a stronger local coding model or revisit system readiness; this checkpoint does neither.

The original six user-dirty files, both original stashes, `autonomous_tracker/`, saved model profiles, historical Qwen/Devstral/North Mini/Nemotron/Muse evidence, inactive Codex worktree and original tunnel are preserved. No reset, clean, push, model download, remote changes or unrelated production refactor. **R3d remains OPEN**, original ForgeBoard **UNACCEPTED**, full **P2–P19 roadmap MANDATORY / DEFERRED**. **STOP.**
