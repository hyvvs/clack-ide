# Clack Real-World Functional Acceptance

Date: 2026-10-11. Tested base: `178b653 fix(ui): clarify agent tools and task outcomes`, plus the changes in this acceptance commit. Host: Windows x64. No push, Computer Use, native GUI interaction, public inference traffic, real credentials, or unrelated project mutation.

## Result and Evidence Boundaries

The representative composed workflow passed against real temporary Git repositories and a real loopback HTTP/SSE provider. It dispatched a Coder, created `README.acceptance.md` in an isolated checkout through the installed SDK and production file tool, returned an immutable patch artifact, sent that actual patch to a Reviewer, routed a correction to the Coder, applied it, resolved Open to the exact file, verified disk bytes, and restored persisted task records. Distinct same-Agent workers also overlapped without receiving the parent's private canary. Conflicting user content was retained and apply failed truthfully.

This is layered automated acceptance, not a claim that one native application session exercised every feature. Read the limitations with each row.

| Layer | Actual execution | Boundary / limitation |
| --- | --- | --- |
| F: composed filesystem/transport | `realWorldAcceptance.integration.test.ts`: Node temporary filesystem, real Git commands/worktrees, real ephemeral loopback HTTP/SSE, installed OpenAI-compatible SDK, production tool permission wrappers, coordinator, stores, immutable artifacts, review/apply/open actions | Tauri IPC is replaced by constrained Node filesystem/Git adapters. Chat dispatch is a deterministic SDK driver, not `chatRuntime`; handoff preparation is stubbed. Persistence uses real test-owned JSON/CAS files, not the native app store. Separate D/N tests cover those boundaries. |
| D: deterministic runtime | Installed SDK adapters, captured request serialization, production runtime/stores, fixture metadata, intercepted transports, controlled clocks/faults | Tauri and network boundaries are mocked/intercepted where named by owner tests. Does not demonstrate live-model intelligence or model obedience. |
| N: Windows native backend | Real Rust filesystem/Git/persistence, temporary native HTTP fixtures, WASI execution/adversaries, cancellation, endpoint admission, authorization and receipt recovery | No native GUI or whole-app IPC interaction. Scheduler tests use controlled transports/leases, not installed model throughput benchmarks. |
| B: headless Chromium | Production React components with fixture stores/native adapters, keyboard/focus, two panes, long content, narrow widths/themes/scaling | No native dialogs, native Stop, minimize/restore, window close, or OS focus verification. Browser dialogs in optimization fixtures are Chromium dialogs only. |
| P: packaging | Windows release/NSIS build in isolated `src-tauri/target/codex-test` | Build evidence only; no installer execution or packaged GUI launch. |
| Live provider | Not performed | No configured credential inspection, paid requests, public provider availability or actual LLM quality claim. |
| Native GUI / other hosts | Not performed, explicitly excluded by user | Windows GUI, Linux/macOS native, physical LAN/hardware, WSL and NVIDIA acceptance remain external. |

Source files: `src/modules/ai/lib/realWorldAcceptance.integration.test.ts`, `src/modules/ai/lib/peerReview.test.ts`, `src-tauri/tests/real_world_acceptance.rs`, `scripts/check-real-world-acceptance.mjs`, and the owner suites below. All temporary Git operations and cleanup are confined to directories created by the harness. Git is required by the new native tests; they do not silently skip.

Reproduce the composed/review/metadata group with `npm.cmd test -- src/modules/ai/lib/realWorldAcceptance.integration.test.ts src/modules/ai/lib/peerReview.test.ts src/modules/ai/lib/providerModelEvidence.test.ts`; native file/Git integration with `cargo test --locked --test real_world_acceptance` from `src-tauri`; browser matrix with `node scripts/check-real-world-acceptance.mjs` (installed Playwright required, or set `PLAYWRIGHT_MODULE` to its existing module path). The browser runner also accepts only named fixtures from its fixed list for focused continuation. The final gate commands are below.

## Functional Matrix

Expected behavior is listed with the observed assertion. A pass applies only to the stated environment. Artifact descriptions identify structured evidence, not model prose.

| Scenario | Environment and actions performed | Expected / observed assertions | Artifacts or files | Status, defect and limitation |
| --- | --- | --- | --- | --- |
| 1. Model routing / same-chat switching | D: `modelSwitchCapacity.integration`, `providerModelEvidence`, `chatModelSwitch`, `selfHostedRouting`; switch known, exact variant, unknown, small and compatible targets; inspect serialized request. B: model-switch fixture. | Exact target routing; conversation/history and Agent retained; future runs only; other chat unchanged; known metadata retained, unknown conservative, genuine small target blocks; B1/capabilities recalculated. Passed. | Captured installed-SDK request bodies and session profiles. | Pass D/B. No live OpenRouter or self-hosted model. Fixed a wall-clock-only test flake, not provider behavior. |
| 2. Agent behavior and precedence | D: Agent serialization/precedence and captured-run suites. F: unmistakable Architect/Coder/Reviewer instructions and distinct exact model IDs sent to loopback. | New Agent replaces old behavior, model change preserves binding, continuation/retry capture version, security outranks instructions. Reviewer wire contains its instructions, not Architect's. Passed. | Captured system/model fields; persisted profiles. | Pass F/D. Prefixes are deterministic fixture output, not LLM obedience evidence. |
| 3. Distinct-Agent delegation | F: Architect dispatches isolated Coder; dependent Reviewer consumes exact patch; follow-up Coder corrects. D: collaboration/H2 quality and dependency suites. | Distinct sessions, target Agent/model, parent/root/dependency linkage, explicit context only, artifacts and results returned, no private canary. Passed. | Three linked PeerTasks, patch/result content hashes and captured requests. | Pass F/D. F's handoff preparation is stubbed; D separately tests recipient-aware preparation/B1. |
| 4. Same-Agent worker and parallelism | F: parent Architect sends to two separate Architect worker sessions with overlapping loopback requests. N: endpoint admission capacities one/two and independent endpoints. | Distinct worker/task IDs, independent parent, maximum observed F in-flight two, canary absent. N enforces queue/cancel/release/isolation. Passed. | Two worker records and measured request overlap. | Pass F/N. Added truthful same-Agent clarification to delegation dialog; no claim of hardware throughput. |
| 5. Delegated file creation / Review / Apply / Open | F and new N Git integration: create flawed README in isolated checkout, capture/remove, review patch, correct in another checkout, apply and open. B: first-use result actions. | Main file absent before apply; immutable patch has `+Timeout: 900`; correction applies `750`; Open resolves exact file; seed unchanged; duplicate apply denied. Passed after fix. | `README.acceptance.md`, `seed.txt`, patch artifacts and task JSON. | Pass F/N/B. Fixed new-file review incorrectly requiring an unapplied file in the main workspace. Open assertion checks callback path, not native editor rendering. |
| 6. Stale/conflicting changes | F: create user README before apply. N: dirty conflict, then committed HEAD drift. D: stale review/immutable-source tests. | Apply rejects; user bytes untouched; patch inspectable; applyError truthful; later materialized file invalidates a prior patch-only review. Passed. | Retained changeSet and unchanged user file. | Pass F/N/D. No unrelated repository was used. |
| 7. Delegated context | F: workspace-only tasks and explicit prerequisite patch artifact. D: attachment transfer, peer artifacts/handoff and privacy suites. B: context/result surfaces. | Workspace/edit mode and explicit sources remain truthful; private parent history absent; content identity retained; no accidental attachment promotion. Passed. | Immutable content IDs, explicit recipient message parts, context chips. | Pass F/D/B. Explicit conversation evidence sharing is covered at authorized owner boundaries, not a new sharing mechanism. |
| 8. Clarification | D: `peerCommunicationCoordinator` dispatch/question/source receipt/reply/child continuation; busy source, capacity one, deleted source, cancellation, corrupt artifact and unanswered paths. B: communication/activity. | Correct source, single resume, bounded rounds, source permission required; impossible question blocks without guessing or private-history substitution. Passed. | Durable communication receipts and task states. | Pass D/N/B. Not a live-model clarification exchange; not combined into F's README scenario. |
| 9. Dispatcher | F: restored completed tasks feed production dispatcher filter. D: dispatcher navigation/task outcome suites. B: first-use grouping and exact task/result focus. | Needs attention/Active/Completed/Chats, exact owner/workspace and keyboard focus; failed actionable, completed retained. Passed. | Task list/grouping and focused IDs. | Pass F/D/B. Native focus not tested. |
| 10. Built-in capabilities | F: production `write_file` writes real isolated file. D: permissions/tool exposure/file-mutation safety; N: filesystem/search, spawn/workspace authorization and shell contracts. | Availability matches executors; Ask/denial and read-before-write guards enforced; Full Access does not override secrets/workspace boundaries; only exposed schemas sent. Passed at named layers. | Actual README bytes; captured tool schemas and denial results. | Layered pass F/D/N. No complete frontend-to-native shell-command/interactive PTY acceptance session was performed. |
| 11. Beginner tool presentation | B: production settings/chat controls show built-in vs optional custom integrations, human capability status, Agent management and technical Details. D: capability summaries. | Available/Ask/Denied/Unsupported and current owner remain accurate; ordinary coding does not require custom-tool setup. Passed. | Rendered accessible names/status and Agent tool assignment. | Pass D/B. First-time human comprehension remains subjective. |
| 12. Custom HTTP tools | D/N: definition, scoped assignment, exact argument/version approval, execution/history, output flood/timeouts, stale policy/schema/credentials. B: CustomToolTest states. | Only authorized exact version executes; secrets redacted; failed/error/unknown effects truthful; bounded output and no automatic replay. Passed. | Registry versions, native receipts and fixture responses. | Pass D/N/B. Controlled test server, not public destructive API or production TLS deployment validation. |
| 13. WASI functions | N: tiny modules, staging/hard-link/path/environment/network/process adversaries, JSON contract, cancellation/limits and restart receipts. D: assignment/exposure. | Staging-only access, no inherited credentials/network/host spawning, bounded memory/output/time, no direct real-workspace mutation; no replay. Passed. | Native execution receipts, staged output and test-owned sentinels. | Pass N/D on Windows. Linux/macOS not inferred from this host. |
| 14. MCP | N: controlled Streamable HTTP fixture discovery/invoke/schema revisions/cancellation/results; D: scoped assignment/approval; B: tool/MCP destination deep links. | Native consent, exact args/version, destination, `isError` failure, unknown effects, disconnect cleanup and no replay remain guarded. Passed. | Tool discovery snapshots and native history/receipts. | Pass N/D/B. No real service; local launchers/sampling/elicitation remain intentionally unsupported. |
| 15. Long conversation fidelity | D: Q1 memory corpus plus compaction/retrieval/target-context suites; N: durable lineage/content integrity. | Four mandatory facts retained, early prohibition/exact values/corrections sourced, attachment/tool relationships preserved, originals unchanged; omitted noncritical facts retrieved or safely blocked by B1. Passed. | Ten distinct revisions, source coverage/digests, retrieval references; measurements below. | Pass D/N. Deterministic extractor, not a real small-model summary quality score; retrieval uses larger allowance than compacted context. |
| 16. Attachments | D: text/image/binary/secret, model modality and existing-attachment switch, transfer/archive/session suites. N: immutable content leases/integrity and archive limits. B: pane/context targeting. | Unsupported media and sensitive paths block truthfully; sources stay immutable; pane ownership preserved. Passed. | Attachment content IDs/message parts and block reasons. | Pass D/N/B. No real visual model interpretation. |
| 17. Length continuation | D: answer provider/continuation suites use installed adapter fixtures. | Only confirmed length triggers; coherent single answer, bounded count, completed tool effects not replayed; captured Agent/model/effort maintained. Passed. | Serialized continuation requests and persisted answer state. | Pass D. No live upstream length response. |
| 18. Interruption/recovery | D: pre-output disconnect, partial text/tool, Retry-After, auth failure, Stop and restart runtime suites. N: atomic receipts, cancellation and no-replay. B: pane Stop/recovery states. | Retry before effects bounded; partial text retained; partial tool not executed; auth not looped; Stop authoritative; unknown effects not retried. Passed. | Partial transcript, failure classification, recovered receipts. | Pass D/N/B. Native Stop interaction explicitly untested. |
| 19. Watchdogs | D: actual agent/runtime watchdog fixtures for whitespace/repetition/tool/no-progress loops, legitimate code/JSON/CSV. B: controls/settings health. | Pathological output bounded, valid repetitive data survives, UI distinguishes cause and next action. Passed. | Watchdog counters/reasons and captured output. | Pass D/B. Controlled output, not pathological live-model traffic. |
| 20. Endpoint concurrency | N: admission capacities one/two, FIFO, cancellation, transport retention, independent endpoints, parent-child reacquisition; D: inferenceAdmission; F: parallel workers. | Excess queues; cancel frees only owned slot; endpoint A does not block B; delegated scheduling bounded. Passed. | Controlled slot/queue events; F overlap count. | Pass N/D/F. Native admission tests are controlled lifecycle tests, not GPU/model benchmarks. |
| 21. Self-hosted setup | N: temporary compatible HTTP probes/inventory/auth/route and body bounds. D: profiles, evidence, health and routing. B: localhost, LAN-shaped/private, HTTPS/generic, inventory/manual setup. | Manual usable, exact route/model, credential/private-access policy, stale/unknown context remains unknown, evidence cannot override pins. Passed. | Synthetic inventory/probe responses and configuration revisions. | Pass N/D/B. No physical LAN, Ollama/LM Studio/vLLM/MLX installation or downloaded model. |
| 22. Optional discovery | N: discovery deadline/cancel/restart/credential exclusion; B: idle opt-in, supplied candidates, no automatic trust/configuration, manual fallback. | Zero automatic traffic; explicit supplied-address probes credential-free and bounded; selection not authorization. Passed. | Candidate list and selected configuration draft. | Pass N/D/B. Supplied/synthetic addresses, no subnet scanning or physical-LAN discovery claim. |
| 23. Calibration | D: stable/outlier/load/cancel/missing usage samples and bounded optimization. B: manual capacity/reset, opt-in/cancel/progress/long labels. | Pins win; serial success does not raise concurrency; endpoint revisions isolated; recommendations bounded. Passed. | Synthetic sample history and manual pin revisions. | Pass D/B. No hardware timing/performance claim. |
| 24. Fallback privacy | D: intercepted primary/fallback canaries for Never/Ask/Trusted, revocation, config drift, partial text, completed/unknown effects and fallback failure. N: grant/revision persistence. B: exact destination and consent ownership. | No unauthorized canary delivery; Ask sends zero before approval; Trusted exact route only; changed consent inactive; effects never replayed. Passed. | Intercepted destination bodies, consent hashes and recovered policies. | Pass D/N/B. No external canary delivery performed. |
| 25. Restart/persistence | F: serialize real profiles/task/artifact files and reinitialize task store. D: realistic session/run/Agent/model/partial/tool/pin/fallback recovery. N: restart-safe stores, atomic CAS and interrupted receipts. | Completed/failed/partial retained; no automatic inference/tool/approval resurrection; ownership and previous valid revisions survive. Passed. | Test-owned JSON/CAS files, native temp stores. | Pass F/D/N. No operating-system restart or native app relaunch; F does not cover native session hydration by itself. |
| 26. Git/worktrees | F/new N and existing N Git suites: clean isolation, dirty workspace, independent workers, capture/remove, apply/conflict/stale HEAD, discard. D: shared write leases and stale reads/reviews. | No silent stash/user overwrite; isolation identity retained; shared write serialized; captured patch survives failure. Passed. | Real worktrees/patches, dirty seed sentinel. | Pass F/N/D. Only harness-owned repositories. |
| 27. Multi-pane isolation | B: production collaboration/chat controls with pane A/B draft, attachment, Agent/model, approval, task and Stop state. D: runtime/session isolation. | Stop/switch A not B; approvals/results/drafts/sources remain with owner; stale async reads cannot retarget. Passed. | Pane-bound state and keyboard/focus assertions. | Pass D/B. Stop uses browser fixture action, not native interaction. |
| 28. Failure actions | D/B: rate limit, auth/offline, dirty isolation, incompatible media, insufficient/unknown capacity, blocked task and unknown effect. | Human cause/action, expandable technical detail, no unsafe retry; still-safe model/context remains usable. Passed. | Structured errors and rendered actions. | Pass D/B. Browser labels updated to current product copy; no product behavior weakened. |
| 29. Source/result truth | F/N: compare returned task/change/artifact state against disk and Git, not response prose. D/B: completed without changes, immutable results and exact result actions. | Actual write/apply/changed paths prove file claims; model-only success is not proof. Passed. | README bytes, patch and Open path, source hashes. | Pass F/N/D/B. File-opening callback is evidence of routing, not native editor display. |
| 30. Workspace/explorer/terminal/Source Control regression | Full frontend owner suites (`workspace/root`, tabs cwd/workspaceTerminal, explorer/workspaceContext, terminal state/OSC/keymap, Source Control models/context); N filesystem/Git/shell parsing/PTY parsers. | Workspace/navigation state, terminal ownership and Git snapshots retain existing contracts. Passed. | Owner suite assertions and temporary native Git repos. | Automated regression pass. No real interactive PTY, native terminal window, manual Explorer or Source Control acceptance. No command palette promotion. |
| 31. Optional live-provider smoke | Not run. | No credential exposure or unnecessary paid/public traffic. | None. | Not tested; not a deterministic acceptance failure. |
| 32. Platforms/package | N Windows x64 full suite and P Windows NSIS build. | Native checks and package gate succeed without terminating user-owned Clack/Vite. | Isolated target logs/package. | Windows results in final gates below. Linux/macOS, WSL/Arch/NVIDIA and installer/native GUI remain external. |

## Measured Context Evidence

The initial Q1 run passed 975 frontend tests in 54 files and its measured oracle. Its Rust harness did not start; that failure is preserved in `REAL_WORLD_Q1_EVIDENCE.json`/`.md`, not rewritten as a successful combined run. The later Windows Rust gate passed all 640 tests, including the native owner suites used by Q1. The final full frontend gate also passed the Q1 suites. Counts overlap; they must not be added.

- A: four of four mandatory facts and four of four noncritical facts retained; original transcript hash unchanged; ten authorized references. Original/B1-elided conversation estimate 16,426 tokens does not fit 6,000; prepared estimate 5,758 fits. Four extraction calls.
- B: ten distinct committed compaction revisions, each retains four of four mandatory facts with valid source coverage and fits an 8,192 working target. Latest compacted noncritical recall is only one of four. Three omitted original facts retrieved, with three of three valid source links, using a **16,384 retrieval allowance**, not 8,192. Twenty extraction calls total. This is source recovery, not perfect summary recall.
- E: deterministic investigation/implementation/review/correction four of four stages; one of one required evidence/source; zero unauthorized deliveries. This coordinator fixture complements the new actual-file workflow; it is not autonomous LLM scoring.
- F: mission and required evidence retained, irrelevant evidence omitted; schema estimate 226 to 151 tokens (483 to 318 bytes); zero unauthorized deliveries. Fixed clocks are not performance benchmarks.

## Defects and Fixture Corrections

1. **Product: reviewing a new isolated file before Apply failed.** The focused test first failed because the main-workspace file did not exist. `capturePeerReview` now accepts missing main-file evidence only for captured, unapplied isolated dependency patches, without inventing a file hash. Explicit file attachments, applied files, permissions/security errors and mixed/non-isolated ownership still fail closed. Review binds the exact patch/result digest; later file creation or patch/result drift invalidates it. Focused review suite: 14/14 passed; composed creation/review/correction/apply also passed.
2. **Native test loader: Common Controls manifest absent.** `dumpbin` showed the library test imports `comctl32!TaskDialogIndirect`, and a read-only loader probe showed the default v5 DLL lacks that export; the executable had no manifest resource. Initial exit was `0xc0000139` before tests. MSVC builds now embed the same Common Controls v6 dependency through one linker-owned manifest, while disabling the duplicate Tauri RC manifest. Non-MSVC targets keep default Tauri behavior. Library `--list` then listed 587 tests; full native gate passed. Packaging separately validates the application link. No user process was killed.
3. **Test flake: variant metadata compared different wall-clock observations.** Full frontend initially had 2,440 pass/one fail: identical metadata differed by one millisecond. Both parsers now receive the same explicit `observedAt`; no metadata behavior/table/capacity policy changed. Focused suite and final full run passed.
4. **Browser fixture drift/races, not product regressions.** Model-switch disclosure changed from Preparation details to Technical details; disabled fallback's accessible label changed from `never` to `Disabled`. Selectors now assert the actual labels. Custom-tool assertions passed after a cold-run timeout; the bounded runner permits five minutes per script and supports a validated subset so already-passing fixtures need not repeat. Fixture shutdown also closes its own HTTP connections. Calibration was isolated from shared Vite cache/watchers after an initial load stall. Its success assertion exposed a stale mocked completion callback: it could resolve the earlier cancelled attempt before the new dynamic import started. Calibration and watchdog fixtures now wait for the actual optimization generation to start before completion/cancellation; all assertions passed. No security or UI behavior assertion was removed.
5. **Small truthful presentation change.** Delegation explains that the destination is another chat, which may be a separate worker using the same Agent. Production browser matrix explicitly asserts this text. No scheduling/permission redesign.

New fixture type/lifecycle corrections made while constructing the harness: supply required profile IDs, use the real `delegate` task kind for corrections, narrow nullable models, avoid unsupported `.at`, and release the test driver's session write lease in `finally`. These are not product regressions or weakened deadlines.

## Final Gates

| Gate | Actual final result |
| --- | --- |
| New composed workflow + review regressions | 17 passed in two files (3 composed + 14 review). |
| Final focused correction group | 37 passed in three files (3 composed + 14 review + 20 provider metadata). |
| Targeted routing/setup/calibration/watchdog/task/session/attachment group | 253 passed in 16 files; overlaps the groups above and full suite. |
| Q1 measured frontend corpus | 975 passed in 54 files; initial combined runner failed only because native test process did not start. Diagnostic report retained. |
| `npm.cmd run check-types` | Passed after correcting fixture types; final rerun passed. |
| `npm.cmd run lint` | Passed at unchanged baseline: 71 warnings, two informational notices. No new warning suppression. |
| `npm.cmd test` | 2,441 passed in 191 files, zero failures/skips in final run. Failed first run recorded above; rerun justified by concrete flake fix. |
| `npm.cmd run build` | Passed, including existing startup-budget guard. Existing ineffective-dynamic-import and plugin timing notices remain. |
| `cargo fmt --check` | Passed. Only changed Rust files formatted. |
| `cargo clippy --all-targets --locked -- -D warnings` | Passed. |
| `cargo test --locked` | Windows x64: 640 passed, zero failed/ignored. 587 library + 25 filesystem + 25 Git + 3 new integration. Windows-gated `shell_background` target contains zero tests; not represented as exercised shell execution. |
| Browser | All eleven named scripts passed, including the corrected fixture-only selectors/races. Results and widths below; native boundaries mocked. The first aggregate stopped at a timeout; passing subsets were reused rather than relabeled as a successful aggregate run. |
| `npm.cmd run tauri -- build --bundles nsis` | Passed: one Windows x64 NSIS bundle, release build 6m 13s. No installation/launch. |
| `git diff --check` | Passed; Git emitted existing LF-to-CRLF conversion notices, not whitespace errors. Staged check repeated before commit. |

Rust test/Clippy/package target: `src-tauri/target/codex-test`, preserving the user's running development process. Generated local logs are under that ignored target (`real-world-cargo-test.log`, `real-world-frontend.log`, `real-world-lint.log`, `real-world-build.log`, `real-world-package.log`). They are operational diagnostics, not portable committed proof. Reproduction uses the committed harness and commands.

## Browser Coverage

Headless fixtures use production components with explicit mocks; passing assertions never imply native GUI evidence.

- `check-product-ux.mjs`: ten combinations of 1280/390/320/280 CSS px and 640 physical/320 effective at 200% scaling, light/dark; current Agent/model/settings, same-Agent explanation, prompt focus and owner isolation passed.
- `check-chat-controls.mjs`: ten width/theme/scaling cases, per-pane Agent/context/tool/MCP/Dispatcher controls, private drafts, keyboard and long content passed.
- `check-first-use-ai-workflows.mjs`: ten width/theme/scaling cases, task grouping, exact focus, immutable results, Review/Apply/Open and failures passed.
- `check-collaboration-ux.mjs`: four cases (1280 dark, 640 light, 320 dark, 640 at 200% light), drafts/attachments/approvals/tools/Stop, source inspection and stale/corrupt/preparation failures passed.
- `check-peer-communication.mjs`: 1100/390, keyboard disclosure, provenance and long payload scrolling passed.
- `check-self-hosted-setup.mjs`: 1100/390/320/280, opt-in/no credential discovery, cancellation/stale selection, bounded inventory, manual localhost/LAN-shaped/HTTPS/generic setup and focused picker passed.
- `check-custom-tool-execution.mjs`: 1100/390/280, StrictMode, keyboard, invalid args, approval/running/denied/success/null/error/cancel/timeout/interrupted states, durable history and unknown effects passed.
- `check-model-switch.mjs`: 1100/390, preparation lock/cancel, review/Technical details keyboard loop, commit, blocked state and overflow passed.
- `check-inference-fallback.mjs`: 1280/390/320/160 CSS px light/dark, long destination/consent, exact chat ownership, keyboard approve/Escape passed. The 160px case is equivalent constrained layout evidence, not OS display scaling.
- `check-calibration.mjs`: 1280/390/280, keyboard details, manual pin/reset, explicit consent, actual fixture generation start, cancellation, progress/success and long-model bounds passed.
- `check-watchdog-controls.mjs`: 1280/390/280, health states, scoped pins/reset, invalid-setting recovery, keyboard/search/Escape, opt-in/cancel, retained offline inventory and long identities passed.

Built artifacts (not committed): `src-tauri/target/codex-test/release/clack.exe`, 18,578,432 bytes, SHA-256 `069186ecda6d3e009a27a549b3a334c99452ec7d018a2c86521eb82df9a70df1`; `release/bundle/nsis/Clack_0.8.0_x64-setup.exe`, 7,690,632 bytes, SHA-256 `551f137065e16f33bcc283035904f7431a1d2ae98786b35f63aecc3759dc3fb3`. The release executable has a resource section and linked successfully with the single-manifest correction. Neither artifact was installed, launched or uploaded.

## Delegation and Filesystem Truth

Distinct-Agent creation/review/correction passed, as did same-Agent distinct workers and two concurrent fixture requests. Clarification has composed coordinator/durable-receipt coverage, not a live LLM exchange. Explicit immutable patches and results pass source identity checks; Dispatcher retains the restored task chain. Shared-write serialization and endpoint capacity are tested separately at their production ownership boundaries.

Disk assertion after correction/apply: `README.acceptance.md` equals `# Acceptance\nTimeout: 750\n`; seed equals `Original user file\n`. Before apply the file was absent from main; the first patch contained timeout 900. Conflicting main-workspace text remained exactly the user's version. Native tests additionally reject changed HEAD and dirty isolation without stashing. Worktrees/temp state were removed only by their owning harness. Response prose alone did not satisfy any effect assertion.

## Security and Remaining Acceptance

No unauthorized private canary transmission, secret-path bypass, cross-workspace read/write, unapproved exact-version execution, automatic inference replay or completed effect replay was observed in the enumerated assertions. This is bounded test evidence, not a universal security guarantee. Original conversations, B1, consent/revision checks and WASI staging semantics were not redesigned.

Still untested: native GUI split panes/Stop/dialogs/focus/minimize/restore/window close/relaunch; installer execution; real interactive terminal process lifecycle; physical LAN/GPU performance; real providers/models; Linux/macOS/WSL/Arch/NVIDIA. Those are external acceptance, not silently marked green.

Remaining human UX questions: whether first-time users understand the separate-worker destination, workspace access versus explicit evidence sharing, immutable Review versus Apply, and unknown-effect recovery. Browser named-control/focus/layout evidence cannot establish subjective comprehension.

The implementation roadmap was not reopened and no new checkpoint was started. Only this bounded sweep, concrete defect fixes, test fixtures and acceptance documentation belong to the commit. Safety stashes, delegation user work and `autonomous_tracker/` were not touched. Stop after commit; do not push.

## Live handoff preparation reliability

Scoped follow-up to `e223059`: repeated delegated tasks could fail before the
recipient started with `peer_handoff_preparation_stale`, previously collapsed to
`peer_run_failed`. The new regression holds the actual production handoff at a
controlled project-load boundary, reconstructs stores and releases it. Before the
fix the actual coordinator reported Failed and did not send; afterwards it completes
with one dispatch. Previous acceptance evidence above is unchanged.

### False-stale predicates and material snapshots

The previous validator compared the target session object (`owner !== session`),
the complete preferences-store object, and dependency object references. Zustand
metadata reconciliation and an appearance update recreated those objects without
changing their meaning. Its whole-task digest also included `createdAt`/`updatedAt`
and visibility metadata. All of those could incorrectly invalidate setup.

Validation now uses the existing canonical `communicationDigest` for material
snapshots, captured together before asynchronous preparation:

- Task ownership, status, intent, source/target identities, workspace/environment,
  execution mode, artifacts, review, communication and dependency relationships
  remain protected. Creation/update timestamps, archive visibility and the handoff
  receipt written by preparation itself are excluded from the task/cache identity.
- Recipient ID/profile/model revision remain protected, not its title or UI update
  time. A new active recipient run still blocks preparation. Source generation and
  cancellation/failure/interruption guards remain strict.
- Request policy includes custom instructions, exact selected source/target routes,
  selected custom-endpoint configuration, selected saved-model capability evidence,
  relevant legacy URL/context settings, recipient effort and fallback policy. Hosted
  profiles use the existing `budgetIdentity` plus transport configuration identity.
  Unrelated appearance and unselected-server settings are not request policy.
- The existing endpoint-policy digest still binds Agent configuration, profile,
  transport/model revision and applicable permission rules. No consent, permission,
  fallback, private-history or destination check was removed.
- Dependencies retain material identity/result/artifact/review/change-set evidence,
  not JavaScript reference equality or display timestamps. Recipient messages retain
  the existing full content digest; identical reconstruction passes, changed messages
  reject. No private source conversation is copied.
- Tool definitions are captured before evidence preparation and revalidated through
  current permitted exposure, schemas and existing `toolRevisionIdentity` metadata.
  Preparation uses the task's captured workspace/mutation lane, not the previous
  recipient run's lane. Only informational descriptions of the two known builtins
  `request_peer_task` and `cancel_peer_task` are excluded from exposure comparison:
  they list live chat titles/graph status. Callable names, schemas, ownership and
  revisions remain protected; custom/MCP definitions are not exempted.
- Current capability support and B1 limits, project revision, selected record IDs,
  revalidated freshness and evidence hashes remain checked. Genuine project drift
  retains `peer_handoff_project_changed`.

The existing cache remains capped at 32 entries / 512 KiB of prepared text. Its key
now includes material policy, owner, dependency, history and source-generation
identities alongside the original request/evidence inputs. Equivalent reconstruction
can reuse a receipt, but every hit performs fresh validation, including immediately
before dispatch. The 15-second preparation deadline also bounds returned validators;
expiry cannot turn an old preparation into an unchecked send.

### Setup effects, root causes and Retry

Creating Clack's own worktree is tracked as unresolved reversible setup, separately
from possible external effects. Before inference, successful native removal clears
the worktree record and permits a durable `preRunFailure` receipt. The shared guarded
Retry path can create a fresh linked attempt/worktree without altering the failure.
Ambiguous creation responses, failed cleanup, preserved worktrees, recovery and
possible inference/tool effects remain conservative.

After transmission may have begun, failure no longer automatically removes a
potentially modified worktree. Its real changes remain available for inspection and
the existing explicit discard/review path; blind Retry stays blocked. Successful
completion still captures an immutable patch and retains existing Review/Apply
checks. No effect ledger, task store, approval or exactly-once mechanism was replaced.

Known preparation/deadline/unavailable/capability/project/artifact/context-overflow
codes now survive coordinator failure normalization. A finite `HandoffStaleReason`
is retained as optional existing error metadata and shown in Error details; loading
drops unknown reason values. Diagnostics contain no prompt contents or credentials.
Effect-free races show `Task setup changed before the Agent started` and `Nothing
was sent or changed. Retry the task using the latest configuration.` Preserved or
uncertain setup does not make that claim. Archive/Previous/Next are unchanged.

Automatic re-preparation was intentionally **not** added. The false predicates are
fixed; a real race requires the existing explicit Retry and current configuration/
authorization checks. There is no hidden retry loop or automatic external replay.

### Actual verification

- Final focused group: **350 tests / 12 files passed**, covering actual handoff and
  dispatch, guarded retry, PeerTask persistence/recovery, project/dependency/review
  boundaries, tool exposure, communication, Archive/navigation and startup budget.
- Production-handoff reliability suite: **52 tests**. Material model/Agent/workspace,
  permission, instruction/Agent policy, task intent, recipient history, dependency
  result/review, source generation/cancellation, competing recipient run, tool
  assignment/schema/revision, capacity/effort, project revision/freshness and expiry
  changes reject. Task cancellation stops without sending. Changed dependency
  evidence invalidates its consumer, not an independent prepared task. Known causes
  and bounded serialized diagnostic reasons are verified.
- Real-file/Git/loopback integration suite: **8 tests**, including five new live-
  handoff scenarios. Its **25 sequential delegations** across same-Agent workers and
  distinct Agents had **zero false stale failures, zero duplicate dispatches and
  zero private-canary leakage**. There were 25 task sends and 31 HTTP requests: six
  Coder reads legitimately require a second tool-result request, not another task.
  Session titles/profiles, appearance, task timestamps/record reconstruction and
  equivalent message reconstruction churn during actual handoff validation.
- Three independent preparations wait at explicit barriers simultaneously, survive
  cross-task churn, then dispatch once each with distinct identities. Real isolated
  `acceptance.txt` creation captures `+hello`; the main file stays absent until
  authorized Apply, then contains exactly `hello`. Pre-send stale + successful
  cleanup allows a fresh linked Retry with no orphan checkout. Failed cleanup keeps
  the real checkout, blocks Retry, and permits explicit inspection/discard. A failure
  after transmission retains the real created file and blocks Retry.
- `npm.cmd run check-types`, `npm.cmd run lint`, `npm.cmd test`,
  `npm.cmd run build` and `git diff --check` passed. Full frontend:
  **2,556 tests / 192 files**, no failures/skips. Lint remains **71 warnings / two
  informational notices**; new fixture-only type/null-assertion diagnostics were
  corrected, not suppressed. Existing mixed-import/plugin-timing build notices
  remain. No Rust changes; Rust gates were not rerun.

These tests use the actual `preparePeerTaskHandoff`, handoff formatter/B1 measurement,
coordinator, store, schema selection and production file tools. Temporary Git/repos,
worktrees, files and the HTTP/SSE transport are real and owned by the fixture.
Tauri IPC, project-memory I/O, model-construction/capacity metadata and credential
boundaries are controlled; the composed fixture supplies a 64,000-token capacity.
It is not an end-to-end native Tauri or live-provider claim. The prior three composed
acceptance scenarios still stub handoff; the five added scenarios explicitly run it.

Native GUI/Computer Use and real-provider verification were not performed, as
requested. Linux/macOS/WSL native validation and subjective human recovery UX remain
external acceptance. Setup is bounded by the existing deadline and can still fail
for real changes/unavailable evidence; retries with unknown effects remain blocked.
No subsequent feature checkpoint was started. No push.
