# Clack production harness reconciliation — 18 November 2026

This is the source-backed reconciliation annex of the existing [master roadmap](COS_FULL_PLATFORM_AUDIT_2026-10-22.md), with status owned by [the shared tracker](AGENT_ENGINEERING_STATE.md). It supplies architecture inventory, requirement contracts, dependencies, gaps/risks, sequence, decisions and the next-task handoff. It creates no product registry, permission engine, memory database, deployment identity or replacement roadmap. The user-designated **20-page Master Project Handoff + Authoritative Roadmap Requirements (18 November 2026)** governs the separate H-series matrix. The earlier text attachment and its R-series remain preserved as historical inputs, not as a substitute for that handoff. The original DOCX bytes are not mounted in the resumed session, so its digest and mechanical word-for-word coverage cannot be independently attested here.

## Authority and preservation audit

The **earlier text attachment**, named Pasted text(20261118-025140).txt, was recovered from a referenced chat and preserved in [PRODUCTION_HARNESS_SOURCE_2026-11-18.txt](PRODUCTION_HARNESS_SOURCE_2026-11-18.txt), SHA-256 **0d4e23f0d107b2f44391790ad6e3d98e702f973c68aa4590571ae7f642d704d1**, 41,226 bytes. Its original /mnt/data location belongs to a prior chat environment. This text is provenance for the retained 940 R-series rows **only**. The newer 20-page Master Handoff DOCX governs the H-series, TF/AR definitions and architecture requirements. Historical claims in either source are not implementation evidence.

Read-only entry audit:

- Repository alias /clack resolves to C:/Users/Hayden/Documents/clack; branch main, HEAD **50fca4689692bc1e85f9ffd4ae644ff528cc056e**, direct parent **bb8dc47577e2339531b1710e591b0db67365f9c9**. Locally recorded origin/main is 272 commits behind; no fetch or push occurred, so this is not a fresh remote-state claim.
- Expanded porcelain-v2 status: **16 modified tracked files + 65 individual untracked paths = 81 pre-existing protected paths**. Index has no staged changes; raw index SHA-256 **5cd3574caaa8fc3ec4d01e79cbd8f6edb90573600df927e068a3d1b1c144f211**. No index write was requested.
- Both original stash objects remain **6a7bc6beef913a323052b277f766ae32be11bae1** and **b96fc46d783f1635acec2278deed7b43479f5f9a**; their recorded parents and messages were inspected without applying them.
- All **81/81 protected file SHA-256 values match**, zero missing/mismatched files, against src-tauri/target/lm2f-validation-20261117/reconstructed-protected-81.tsv. Manifest byte hash is **bc37fc8c8f824c2371c7f99a42cc9f09557ffc54c0685c988473a7c02eb86441**. Sorting paths with ordinal comparison and hashing lowercase path<TAB>sha256<LF> records yields the documented aggregate **339aba89d167b45a0cca1f663293fd3fa6197f63f0b2e4cab7f444b90670c104**. Hashing the unsorted manifest yields a different value; that ordering difference is explained, not lost data.
- The protected manifest includes docs/REAL_LOCAL_MODEL_ACCEPTANCE.md, the two untracked Muse documents and all 78 other source/script/test paths. None is a reconciliation edit target. autonomous_tracker/, settings, installed models/runtimes, historical ledgers, frozen workspaces and surviving ignored evidence remain outside the edit allowlist.
- The referenced chat explicitly explains deletion of src-tauri/target/debug and src-tauri/target/codex-test as intentional user cleanup. No recovery, rebuild, restoration or further deletion is part of this task. A historical link into a removed build directory is unavailable evidence, never current acceptance.
- Canonical entry document hashes were recorded for CLACK.md rules, the master roadmap, shared tracker, self-hosted plan, TF foundation and LM11–LM15 document. Historical tracked evidence is retained; relevant surviving ignored LM2F/LM3–LM6 evidence was inspected read-only. No claim is made to have hashed every ignored artifact, settings file or installed binary.
- No prior Chat On Steroids task-plan read API is available to this request. Its earlier app-only plan cannot be certified as recovered. Current blockers below are independently grounded in repository source; the new reconciliation progress plan is display coordination only.

### Accepted history verified as ancestry, not universal production sign-off

All following complete object IDs were checked with merge-base --is-ancestor against actual HEAD:

| Scope | Existing commit(s) |
| --- | --- |
| LM0–LM2/LM2A | 416677c677813fe0dd651774a2d572914b727471 |
| Compute Fabric / LM2B–LM2C | 4c3b2921b631dceffa23313dec621eafd546de18 |
| TF foundation | acd4583ce67df8bec6510930dab5e2b0d22bd1c8 |
| LM2D managed runtime / CPU acceptance | d167890838935e79e93f11f00d7c9a065bcfb233; 660343f0f819361c5f15a1679c043a93768abfbc |
| LM2E / LM2F | 18c755f30019f14bd44920e24d56f64219e2515a; 7e129897ce86bd57a8e0fcb4f1e15d334c857441 |
| LM3–LM5 / native telemetry | da81aa2bb8126dc0fba8d71c04e4682991193f78; e084572a49de11ad39904e628be59842ad0d67e7 |
| LM6 / live correlation closure | 976920e6f08c52793f9b2a3872b559a68bce9688; cc599da54fe57dd2a63d0931f14e842d47fc1e9c |
| LM7–LM10 / LM11–LM15 | bb8dc47577e2339531b1710e591b0db67365f9c9; 50fca4689692bc1e85f9ffd4ae644ff528cc056e |
| Existing AR-related runtime foundations, not numbered AR completion | 3dee53a3ba6e271a6f2507eab0042afdecfcb28a |
| Existing native MCP / WASI / durable PeerTask | 32bf73194f5f735967bb51e87d10c5c31f47af33; 3ce3bef1a19c583f4bb2b7406c076feb46a9164d; 61f03636af10424245ba2da7a0365eb9f433a28a |

**Numbering-source correction:** the earlier repository-only inspection did not find TF0–TF25/AR0–AR15 definitions, but the **now-governing uploaded 20-page master handoff does define all 42 identifiers** (TF pp. 7–8, AR pp. 9–10). Preserve those original identifiers and use the authoritative existing LM/TF/AR/P checkpoint owners below. Definition presence does not imply completed implementation, live acceptance or permission to create new databases/registries. D01 now tracks status/evidence mapping and not recovery of absent definitions.
### Governing handoff milestone definitions — TF0–TF25 and AR0–AR15

The **20-page `CLACK — Master Project Handoff + Authoritative Roadmap Requirements` (18 November 2026)** is the newly designated governing specification. Its pp. 7–8 explicitly define TF0–TF25; pp. 9–10 explicitly define AR0–AR15. These names were *missing from the prior repository-only source inspection*, not missing from the governing handoff. The names below are therefore canonical planning labels. The conservative status column reflects inspected foundation scope, **not individual milestone implementation or live acceptance**. Existing P2–P19 and historical LM/R milestones retain their ownership; no new registry, persistence, permission or identity authority is introduced.

| Governing ID | Canonical handoff milestone | Existing contract / subsystem owner | Scope status (not acceptance) |
| --- | --- | --- | --- |
| TF0 | Unified Tool Identity | Contract F (existing authoritative Tool Fabric registry/executor) | Partial |
| TF1 | Tool Capability Registry | Contract F (existing authoritative Tool Fabric registry/executor) | Partial |
| TF2 | Permission / Side-Effect Model | Contract G (existing authoritative permission/effect authority) | Partial |
| TF3 | Internet Search | Contract E (existing authoritative subsystem) | Missing |
| TF4 | Evidence-backed Web Research | Contract E (existing authoritative subsystem) | Partial |
| TF5 | Bounded Research Workflow | Contract E (existing authoritative subsystem) | Planned |
| TF6 | Developer/Package Research | Contract E (existing authoritative subsystem) | Planned |
| TF7 | MCP Client Foundation | Contract F (existing authoritative Tool Fabric registry/executor) | Partial |
| TF8 | MCP Security/Trust | Contract F (existing authoritative Tool Fabric registry/executor) | Partial |
| TF9 | Dynamic Tool Exposure | Contract F (existing authoritative Tool Fabric registry/executor) | Partial |
| TF10 | Tool Retrieval | Contract F (existing authoritative Tool Fabric registry/executor) | Partial |
| TF11 | Model-specific Tool Encoding | Contract F (existing authoritative Tool Fabric registry/executor) | Partial |
| TF12 | Tool Qualification | Contract L (existing authoritative subsystem) | Partial |
| TF13 | Tool Effect Receipts | Contract G (existing authoritative permission/effect authority) | Partial |
| TF14 | Browser / Computer Interaction | Contract E (existing authoritative subsystem) | Missing |
| TF15 | Filesystem / Repo Fabric | Contract C (existing authoritative subsystem) | Partial |
| TF16 | Command / Build / Test Fabric | Contract C (existing authoritative subsystem) | Partial |
| TF17 | DB / API / External Systems | Contract F (existing authoritative Tool Fabric registry/executor) | Unverified |
| TF18 | Secrets / Auth | Contract G (existing authoritative permission/effect authority) | Partial |
| TF19 | Failure Semantics | Contract R (existing authoritative subsystem) | Partial |
| TF20 | Research Memory Integration | Contract I (existing authoritative mission/persistence authority) | Planned |
| TF21 | Tool Budgeting | Contract R (existing authoritative subsystem) | Partial |
| TF22 | Tool Observability | Contract J (existing authoritative subsystem) | Partial |
| TF23 | Small-model Tool Optimization | Contract D (existing authoritative subsystem) | Partial |
| TF24 | Research/Tool Torture Suite | Contract L (existing authoritative subsystem) | Planned |
| TF25 | Production UX | Contract Y (existing authoritative subsystem) | Partial |
| AR0 | Canonical Mission State | Contract I (existing authoritative mission/persistence authority) | Partial |
| AR1 | Requirement Ledger | Contract I (existing authoritative mission/persistence authority) | Partial |
| AR2 | Structured Task Graph | Contract I (existing authoritative mission/persistence authority) | Partial |
| AR3 | Decision Ledger | Contract I (existing authoritative mission/persistence authority) | Partial |
| AR4 | Tool Effect Ledger | Contract G (existing authoritative permission/effect authority) | Partial |
| AR5 | Evidence-backed Durable Memory | Contract I (existing authoritative mission/persistence authority) | Partial |
| AR6 | Context Compiler | Contract D (existing authoritative subsystem) | Partial |
| AR7 | Relevance-based Hydration | Contract D (existing authoritative subsystem) | Partial |
| AR8 | Loss-resistant Continuation Packets | Contract D (existing authoritative subsystem) | Partial |
| AR9 | Two-phase Compaction + Coverage Proof | Contract D (existing authoritative subsystem) | Partial |
| AR10 | Fresh-Inference Reconstruction | Contract D (existing authoritative subsystem) | Partial |
| AR11 | Deterministic Verification | Contract L (existing authoritative subsystem) | Partial |
| AR12 | Milestone Reconciliation | Contract I (existing authoritative mission/persistence authority) | Partial |
| AR13 | Completion / Full-Answer Guardian | Contract L (existing authoritative subsystem) | Partial |
| AR14 | Small-Model Beast Qualification | Contract L (existing authoritative subsystem) | Planned |
| AR15 | Adaptive Routing + Torture Suite | Contract O (existing authoritative subsystem) | Planned |

**Boundary:** this resolves the *definition-source* portion of prior D01/B06. It does not prove an AR/TF milestone accepted. All TF13 effects join existing native authorization/effect receipts, while AR4 references the same receipts; AR5 references existing durable memory and not a new database. TF0/TF1 use `capabilityIndex.ts` and the native custom-tool registry, not a second registry. AR6/AR7 use existing context-budget/memory authorities. The attached handoff and [H-series requirement matrix](PRODUCTION_HARNESS_TRACEABILITY_2026-11-18.md#governing-master-handoff-subrequirement-traceability) supply per-obligation exits.


## Architecture inventory and traceability contracts

The [integrated traceability matrix](PRODUCTION_HARNESS_TRACEABILITY_2026-11-18.md) preserves 940 R-series rows for every nonblank line of the earlier attachment and contains a separately numbered H-series for the governing 20-page handoff. R rows join to the existing architecture contract; H rows supply all 12 required traceability fields explicitly, including clause-specific acceptance and evidence. The original governing DOCX is not available in this resumed session for a mechanical line-by-line comparison, so do not claim that such a check was performed. Row status and scope override broad contract descriptions.

Use precisely these status values in new H rows: **Implemented + accepted**, **Implemented but not live-verified**, **Partial**, **Planned**, **Missing**, **Unverified**, **Unsupported**, **Stale evidence**. Older R rows and historical contract labels retain their original wording and must be interpreted with this normalization. Acceptance always states date/platform/deployment/procedure. Narrow historical CPU acceptance does not grant current deployment authorization. Source tests are not new passing results; a script is not a recorded execution. New domains remain Unverified/Partial until independent proof justifies promotion.

### Contract A — Universal compute and GPU orchestration

| Field | Contract |
| --- | --- |
| Existing owner | Compute Fabric, runtime adapters, hardware suitability and LM qualification |
| Roadmap owner | LM2B/LM2C; LM2D universal-backend extension; LM3–LM5 device/placement extension; LM6/LM10 acceptance |
| Dependencies | B, G, J, L; existing host/runtime/artifact/deployment identity |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/lib/localComputeFabric.ts; localRuntimeAdapters.ts; hardwareProfile.ts; deploymentSuitability.ts; src-tauri/src/modules/hardware_profile.rs; managed_local_runtime.rs |
| Offline evidence | localComputeFabric.test.ts; managedLocalModels.test.ts; hardwareProfileNative.test.tsx; deploymentSuitability.test.ts (under src/modules/ai/lib); source tests present, not rerun for this reconciliation |
| Live evidence | Historical Windows CPU b12248 Chat/LM6 only; no current universal GPU execution proof. LM3_LM5_NATIVE_HARDWARE_LIVE_ACCEPTANCE.md and LM6_BOUNDED_DEPLOYMENT_QUALIFICATION.md |
| Security | Verify runtime/dependency digests, private ACL, device/host ownership; backend/configuration change invalidates qualification; never grant support from vendor detection |
| Failure handling | Incompatible/Unknown backend blocks placement; resource pressure gives bounded rejection/backpressure; no silent backend, device, model or cloud fallback |
| Testable acceptance / definition of done | For each supported OS × vendor × backend × runtime cell, independently prove device discovery, compatibility, actual model offload/layer/tensor placement, RAM/VRAM and utilization, concurrency limits, cancellation and restart. Missing cells explicitly unverified. Compare CPU/hybrid/multi-GPU using exact deployment identity |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | All new GPU provisioning, backend execution and multi-GPU claims deferred until scoped authorization and hardware evidence |

### Contract B — Complete managed runtime lifecycle

| Field | Contract |
| --- | --- |
| Existing owner | Existing managed runtime and engine-specific adapters; Compute Fabric identity |
| Roadmap owner | LM2C/LM2D lifecycle extensions; P18/P19 platform/release gates |
| Dependencies | A device compatibility, G permissions/secrets, J traces, release provenance |
| Current classification | Partially implemented |
| Existing implementation | src-tauri/src/modules/managed_local_runtime.rs; managed_llama_cpu_b12248_manifest.rs; managed_llama_windows_acl.rs; src/modules/ai/lib/managedLocalRuntime.ts; localRuntimeAdapters.ts |
| Offline evidence | managedLocalModels.test.ts, managedLocalRouting.test.ts and managedLocalAcceptance.test.ts and native managed-runtime tests; compiled per-file manifest inspected through source/accepted provenance docs; no new build |
| Live evidence | CLACK_LM2D_MANAGED_CPU_ACCEPTANCE_2026-11-16.md; CLACK_MANAGED_LOCAL_LLAMA_B12248_PROVENANCE_2026-11-16.md; CPU fixture only, not all engines/platforms |
| Security | Signed artifacts and pinned provenance, per-file length/hash, licenses, dependency trust, private install permissions and validated process identity. Unsigned upstream artifacts require an explicit trust decision and cannot satisfy signed-artifact acceptance. |
| Failure handling | Atomic install/update or preserve previous generation; rollback safely; fail closed on tamper/unknown PID; no PID-reuse kills; release owned resources on stop/crash |
| Testable acceptance / definition of done | Install/verify/start/readiness/health/load/unload/stop/cleanup/update/rollback tested with interrupted install, stale epoch, crash, tampered dependency and concurrent deployments on every claimed OS; restart must stale old proof |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Universal installers and other engines are planned extensions; existing llama.cpp CPU acceptance remains narrow |

### Contract C — Secure execution sandbox

| Field | Contract |
| --- | --- |
| Existing owner | Existing Rust OS authority and confinement; existing permission/effect owners |
| Roadmap owner | T3a/T3b; TF execution boundary; P6/P7/P15/P18 |
| Dependencies | G policy, process supervision, resource controls, credential isolation; K workspace recovery |
| Current classification | Partially implemented |
| Existing implementation | src-tauri/src/modules/conversation_memory/custom_tools/confinement.rs; confinement/platform.rs; confinement/process.rs; confinement/wasi.rs; src/modules/ai/lib/permissions.ts |
| Offline evidence | confinement/tests.rs; confinement/wasi_tests.rs; platform-specific source evidence; no new adversarial execution |
| Live evidence | Historical confined/WASI Windows evidence in AI_SELF_HOSTED_INFERENCE_PLAN.md; no proof every terminal executes in a complete sandbox; Linux/macOS parity unverified |
| Security | Trusted control plane separate from filesystem/process/network/dependency/credential execution plane; no master key/permission-store access; platform mechanism evaluated explicitly |
| Failure handling | Unsupported isolation denies execution; quota breach/cancel terminates owned subtree; cleanup preserves persistent workspace and unrelated processes/files; partial effects remain unknown |
| Testable acceptance / definition of done | Windows/Linux/macOS threat-model review plus escape, symlink, child process, egress, secret/environment leak, dependency and CPU/RAM/GPU quota tests; prove ephemeral/persistent environment recovery through real authorized terminal use |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Choose OS mechanisms only after capability probes; ordinary shell and WASI confinement must not be conflated |

### Contract D — Context Compiler

| Field | Contract |
| --- | --- |
| Existing owner | Existing B1/F1 context budget, C1/C2 memory/retrieval and AR context orchestration |
| Roadmap owner | B1/C1a/C1b/C2/G1a/G1b/M1/M2/R4; AR context closure; P2/P3 |
| Dependencies | I durable mission/requirements/memory; model-specific accounting; source freshness; F tool schemas |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/lib/contextBudget.ts; providerContext.ts; conversationMemory.ts; targetContext.ts; toolObjective.ts; src/modules/ai/store/targetPreparation.ts; src-tauri/src/modules/conversation_memory |
| Offline evidence | contextBudget.test.ts; conversationMemory.test.ts; targetContext.test.ts; contextPreflight.integration.test.ts; protectedContextAudit.test.ts; preserved Q1 fixtures |
| Live evidence | R4_PROVIDER_BOUND_CONTEXT_2026-10-22.md is partial; later PROTECTED_CONTEXT_BUDGET_HARDENING_20261115.md and LONG_HORIZON_AGENT_RUNTIME_HARDENING_20261114.md do not certify universal context quality |
| Security | Source/owner/revision scope, untrusted-content labels, private memory isolation, no policy promotion from retrieved text; retain exact originals |
| Failure handling | Missing mandatory context/no-fit budget blocks honestly; stale/corrupt memory cannot replace originals; preserve requirements, decisions, corrections, effects and pending work across compaction/restart |
| Testable acceptance / definition of done | Measure actual serialized request including schemas/output reserve; independently test Count to 40, explain file, fix bug, 200-file continuation and interrupted resume. Rank/retrieve/prioritize/deduplicate/summarize while preserving mandatory requirements and reversible provenance; compare small model payload and task outcome |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | No second memory store or lossy summary authority; full Context Compiler remains planned closure |

### Contract E — Complete web research and browser automation

| Field | Contract |
| --- | --- |
| Existing owner | Tool Fabric catalog/executors and native research boundary; browser adapter |
| Roadmap owner | TF research/browser extension; P8/P9; TF13 receipts; P18 |
| Dependencies | F discovery, G exact authorization, C isolation/egress, J trace; restart-durable budgets |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/tools/research.ts; src/modules/ai/lib/webResearch.ts; src-tauri/src/modules/net/research.rs; src/modules/ai/lib/capabilityIndex.ts |
| Offline evidence | webResearch.test.ts and net/research.rs private-address/URL tests; source inspected |
| Live evidence | No actual query-search or controlled-browser live acceptance found; bounded HTTPS retrieval is not research completion |
| Security | Pages/tool outputs untrusted; injection cannot grant permission; DNS/SSRF/private/metadata protection, approved sessions, credentials, redirects, safe downloads/uploads and source hash/time |
| Failure handling | Bound attempts/bytes/time; preserve failed sources and contradictions; deny redirects/private destinations; provider/browser crash closes owned sessions and never repeats unknown form/upload effects |
| Testable acceptance / definition of done | Real multi-provider queries with reformulation, authoritative ranking, cross-source verification/contradiction and citations; controlled authenticated navigation/forms/download/upload/screenshot/inspection; restart/cleanup and hostile-page tests; independent search-to-conclusion outcome |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Query search and browser automation missing from inspected TF slice; no web/provider launch in this task |

### Contract F — Complete MCP and tool ecosystem

| Field | Contract |
| --- | --- |
| Existing owner | Existing capabilityIndex/F1, custom-tool registry and native MCP/T2 executor |
| Roadmap owner | T1/T2/T3c/F1; TF lifecycle extensions; P5/P6/P10; TF13 |
| Dependencies | G scoped policy/vault/OAuth; C integration isolation; J health/audit; versioned contracts |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/lib/capabilityIndex.ts; customTools.ts; customToolExecution.ts; src-tauri/src/modules/conversation_memory/custom_tools/mcp.rs; mcp/protocol.rs; execution.rs |
| Offline evidence | capabilityIndex.test.ts; customTools.test.ts; customToolExecution.test.ts; mcp/tests.rs; mcp/protocol/tests.rs; inspected historical contract evidence |
| Live evidence | P1_CAPABILITY_INDEX_2026-10-22.md and TOOL_RESEARCH_MCP_FABRIC_FOUNDATION.md record bounded foundation; OAuth/stdio/rotation/complete isolation live proof absent |
| Security | Per-server vault credentials and scopes; cryptographic schema fingerprint/version/provenance; changed definition invalidates approval; output validation; separate server trust/revocation |
| Failure handling | Health/offline state truthful; timeout/cancel closes owned call; reconnect does not replay uncertain effects; revoked/changed schemas denied at execution; rotate credentials without trust transfer |
| Testable acceptance / definition of done | Discovery/registration/authentication/authorization/execution/task completion separately tested; real MCP lifecycle with changed schema, hostile description/output, token expiry/rotation, server failure, restart/revocation and audited effects; local stdio only after secure process host |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | No duplicate registry or MCP stack; advanced OAuth/stdio/install lifecycle remains planned |

### Contract G — Central policy, permissions and approvals

| Field | Contract |
| --- | --- |
| Existing owner | Existing permissions, approvals, Rust native authority, keyring and effect records |
| Roadmap owner | AI_RUNTIME permission authority; T1/T2/TF13; P3/P5–P9/P12/P15 cross-cutting closure |
| Dependencies | Stable session/agent/workspace/action/argument identity; native effect receipts |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/lib/permissions.ts; src/modules/ai/lib/customToolExecution.ts; src-tauri/src/modules/conversation_memory/custom_tools/execution.rs; src/modules/ai/lib/keyring.ts; docs/AI_RUNTIME.md |
| Offline evidence | permissions.test.ts; customToolExecution.test.ts; native custom-tool tests; existing runtime doc has stale lifecycle text, current source wins |
| Live evidence | No complete cross-surface policy-boundary live audit; historical approval/tool evidence is scoped only |
| Security | Least privilege; exact args/action/revision/session/workspace-bound expiring revocable approval; execution-time recheck; credential scope; conflict resolution; no webpage or model can widen grants |
| Failure handling | Deny on conflict/unknown scope/revocation/expiration; suspend and resume same logical run; preserve user intent and effect record; no implicit related-action approval |
| Testable acceptance / definition of done | Cross Chat/Agent/terminal/browser/MCP tests distinguish read/modify/delete/execute/install/transmit/publish; TOCTOU, expiry/revoke, sensitive confirmation, policy precedence and same-run pause/restart/resume demonstrated with audit records |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Extend existing engine; do not replace it or silently change Full Access semantics |

### Contract H — Durable background execution

| Field | Contract |
| --- | --- |
| Existing owner | AR using existing session/chatRuntime, PeerTask, Todo and native persistence authorities |
| Roadmap owner | AR0–AR15 scope; existing P3/P4/P12/P13; named durability closure without invented AR ordinal |
| Dependencies | I persistent identity/state; L safety deadlines; G authorization; K checkpoints; J receipts; idempotency/cancellation |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/store/chatRuntime.ts; src/modules/ai/lib/peerTasks.ts; peerTaskDependencies.ts; sessions.ts; src/modules/ai/store/todoStore.ts |
| Offline evidence | agentRequestFailureRecovery.integration.test.ts; peerTasks.test.ts; existing session/recovery tests; no schedule engine acceptance |
| Live evidence | Historical multi-agent/coworking evidence is not days-long supervised background/scheduling acceptance; no complete scheduler proof |
| Security | Job/session/workspace ownership; quota and lease authority; approved schedule cannot widen privileges or reauthorize later side effects |
| Failure handling | Heartbeat expiry, shutdown, queue corruption/network loss produce truthful interrupted/unknown state; no duplicate dispatch; cancellation reaches admission, pre-dispatch, child process, inference and persistence |
| Testable acceptance / definition of done | Persistent queue executes only authorized ready jobs; close window/restart/crash/resume retains mission and completed effects; deadlines/heartbeats/resource quotas/concurrency and duplicate dispatch fault-injected; scheduling tests include timezone/DST/missed runs/disable |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | P12 before P13; full scheduler/background engine deferred; existing in-process background chat is not durable daemon proof |

### Contract I — Durable mission state and memory

| Field | Contract |
| --- | --- |
| Existing owner | AR on existing sessions/Todos/PeerTask/conversation_memory/project memory |
| Roadmap owner | C1/C2/M1/M2/G1/H1/H2; AR0–AR15 scope; P3/P9/P12 |
| Dependencies | Persistent source identity/revision, current requirements/corrections, G ownership, D context reconstruction |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/lib/conversationMemory.ts; peerTasks.ts; toolObjective.ts; src/modules/ai/store/todoStore.ts; src-tauri/src/modules/conversation_memory.rs; conversation_memory/project.rs; checkpoint.rs |
| Offline evidence | conversationMemory.test.ts; peerTasks.test.ts; native conversation_memory/project and checkpoint tests; no new semantic acceptance |
| Live evidence | R3A_TRUTHFUL_AGENT_COMPLETION_2026-10-22.md and later context/recovery docs show partial foundations; full mission graph/recovery not accepted |
| Security | Private versus shared sources scoped; verified facts/assumptions/estimates/user instructions/history kept distinct; provenance and deletion/conflict controls |
| Failure handling | CAS conflicts preserve originals and explicit contradictions; no stale source promoted; interrupted mission retains completed/pending obligations and decisions |
| Testable acceptance / definition of done | Persist mission ID, hierarchy, requirements, decisions, evidence relationships and lifecycle; reconstruct exact required context after cross-session/app restart; adversarial wrong-owner/stale/conflicting memory retrieval and independent requirement fidelity tests |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | No parallel mission or memory database; reconcile original AR ordinal definitions before numbered AR implementation |

### Contract J — Complete observability, tracing and replay

| Field | Contract |
| --- | --- |
| Existing owner | LM6 measurement ledger plus existing run/request/tool/effect authorities |
| Roadmap owner | LM6/LM7–LM12; TF13; AR/P3/P12 observability closure |
| Dependencies | Exact identity and correlation at every native/SDK/tool/persistence boundary; privacy/retention policy |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/lib/deploymentMeasurement.ts; deploymentMeasurementRuntime.ts; deploymentQualificationFlight.ts; src/modules/ai/lib/agentRequestRecovery.ts; src-tauri/src/modules/net/inference |
| Offline evidence | deploymentMeasurement.test.ts; deploymentQualificationFlight.test.ts; preserved phase-journal tests/docs; no new runtime measurement |
| Live evidence | LM6_BOUNDED_DEPLOYMENT_QUALIFICATION.md contains scoped CPU cold/warm/cancel evidence; remote residency, peak allocation and throughput gaps remain Unknown |
| Security | Redact secret/request content, constrain trace access/retention/export, protect immutable audit/effect references; privacy-aware optional payload capture |
| Failure handling | Missing native/SDK join is Incomplete/Unknown; retain failures/retries/cancel evidence; diagnostic replay never repeats irreversible effects |
| Testable acceptance / definition of done | Reconstruct user request→mission/task→compiled context→deployment/runtime/process→payload/tools/permissions→effects/output→terminal reason, with typed token/byte/frame/meaningful-output/latency/throughput/CPU/GPU/memory metrics only where authoritative; safe replay uses recorded/sandboxed effects |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | No universal trace/replay claim from LM6 timing or a captured UI transcript |

### Contract K — Workspace snapshots and rollback

| Field | Contract |
| --- | --- |
| Existing owner | Existing native Git/worktree leases, review/apply, mission/effect persistence |
| Roadmap owner | Multi-agent phases 3–7/H1/H2; AR/P3/P4/P12 recovery closure |
| Dependencies | G workspace permission; I effect/mission identity; process/lease ownership |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/lib/peerTasks.ts; src/modules/agents; src-tauri/src/modules/git/agent_worktree.rs; src-tauri/src/modules/conversation_memory/checkpoint.rs |
| Offline evidence | AI_MULTI_AGENT_BUILD_PLAN.md checkpoint records; writeCheckpoint.test.ts and checkpoint/tests.rs; full arbitrary snapshot rollback tests unverified |
| Live evidence | MULTI_AGENT_COWORKING_ACCEPTANCE.md is historical bounded evidence; no universal workspace rollback certification |
| Security | Preserve dirty tracked/untracked files, index, commits/stashes and other owners; approval/diff exact revision; conflicts block apply |
| Failure handling | Failed later task cannot erase completed work; uncertain effects reconciled before rollback/resume; crashes retain recoverable snapshots/worktrees |
| Testable acceptance / definition of done | Dirty/staged/untracked/conflict/subtask fixtures prove snapshot, patch preview, selective rollback and restart recovery without touching unrelated changes; ledger records recovered versus completed/unknown effects consistently |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Snapshot backend/storage policy decision open; no rollback or worktree mutation in this reconciliation |

### Contract L — Continuous evaluation and qualification

| Field | Contract |
| --- | --- |
| Existing owner | LM2F receipts, LM6 measurement, LM11–LM15 policies; Q1/Z/P18 platform acceptance |
| Roadmap owner | LM11 safety closure; LM12 fixtures; LM13 candidates; LM14 Agent policy; LM15 UX; Q1/Z/P18 |
| Dependencies | A/B exact deployment; G permissions; H deadlines/cancel; D/I context/memory; F tools; independent validators |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/lib/qualificationLabPlan.ts; historicalEvidenceFixtures.ts; candidateQualification.ts; deploymentProductStates.ts; src/modules/ai/components/DeploymentQualificationLab.tsx |
| Offline evidence | qualificationLabPlan.test.ts; historicalEvidenceFixtures.test.ts; candidateQualification.test.ts; deploymentProductStates.test.ts; DeploymentQualificationLab.test.tsx; 1,183 tests reported, original complete test-result receipt not located |
| Live evidence | Read-only Lab acceptance script and build log exist under src-tauri/target/lm3-lm5-native-live-20261117; script presence is not retained PASS receipt. No executable Lab or current Agent candidate acceptance |
| Security | Only verifier-owned current exact-scope evidence grants behavioral eligibility; synthetic/reconstructed/history inert; unknown protocol zero dispatch; no safety-gate bypass |
| Failure handling | Keep all Lab Run actions disabled until aggregate deadline and pre-registration cancellation closure independently proven; preserve failed/cancelled/incomplete denominators and old receipts; unknown persistence cannot certify success |
| Testable acceptance / definition of done | Absolute monotonic budget from admission through pre-dispatch/readiness/inference/quiescence/CAS, no later dispatch after cancellation; test every await, crash/restart/late completion, then separately authorized live UI/runtime verification. Independent Chat/adherence/coding/schema/tools/context/reliability/cancel/recovery/multimodal/Agent evaluations; every regression permanent |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | No candidate campaign, inference or ForgeBoard authorization; runnable Lab/production qualification remains blocked |

### Contract R — Reliability and resilience

| Field | Contract |
| --- | --- |
| Existing owner | Existing admission, provider retry/recovery, run budgets and AR queues |
| Roadmap owner | D1/D2/D3/E1/E2/F2; LM11 safety closure; AR/P12/P13 |
| Dependencies | G policy, H ownership/cancellation, J evidence, fixed budgets |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/lib/inferenceAdmission.ts; inferenceLifecycle.ts; providerRetry.ts; streamRecovery.ts; runBudget.ts; src-tauri/src/modules/net/inference/admission.rs |
| Offline evidence | inferenceAdmission.test.ts; agentRequestFailureRecovery.integration.test.ts; AGENT_COMPACTION_RETRY_DEADLINE_20261114.md; filenames beyond inspected owners must be checked before code work |
| Live evidence | No complete outage/resource-exhaustion/circuit-breaker live matrix; historical single recovery does not certify resilience |
| Security | Retries cannot reauthorize or replay unknown effects; bounded capacity and cost/output/time counters survive recovery |
| Failure handling | Circuit-breaker open, backpressure, unavailable provider/network interruption and resource exhaustion stop/degrade truthfully under explicit fallback policy |
| Testable acceptance / definition of done | Fault-inject provider outage, network loss, full queue, duplicate submission, exhausted memory/disk and crash; bounded retries/backoff/idempotency and queue recovery preserve terminal state and completed work |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Circuit breakers and durable backpressure design not established; planned closure, not assumed implemented |

### Contract O — Provider and model orchestration

| Field | Contract |
| --- | --- |
| Existing owner | Compute Fabric/runtime adapters and existing provider registry/model-switch authorities |
| Roadmap owner | A1–A3/E1/G2/G3/C2; LM2B–LM5/LM9/LM10; AR quotas |
| Dependencies | A hardware, B runtime identity, L capability proof, G explicit fallback and budgets |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/config.ts; src/modules/ai/lib/localComputeFabric.ts; localRuntimeAdapters.ts; deploymentEvidenceDecisions.ts; src/modules/ai/store/modelSwitch.ts |
| Offline evidence | localComputeFabric.test.ts; deploymentEvidenceDecisions.test.ts; providerContextVariants.test.ts; model-switch tests |
| Live evidence | Historical LM2E and LM6 CPU proof; no broad cost/latency/resource-aware routing acceptance |
| Security | Never silently move local work to cloud or change backend/configuration/credentials; manual pins persist; destination consent and budget accounting |
| Failure handling | Empty qualified candidate set remains empty; outage respects explicit fallback; state/epoch changes stale proof and block unsafe route |
| Testable acceptance / definition of done | Local/remote/hybrid providers selected using exact current compatibility, measured latency/resource/cost/usage limits; switching/failed route/restart and no-cloud-fallback tested with independent payload/effect receipts |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Automatic multi-provider placement/cost policy planned; no winner inferred from model name |

### Contract M — Multimodal architecture

| Field | Contract |
| --- | --- |
| Existing owner | Existing attachment/voice pipeline and runtime-specific modality qualification |
| Roadmap owner | AI_ATTACHMENTS contract; LM2C/LM2F/LM11–LM15; P16/P18 modality extensions |
| Dependencies | G upload permissions/privacy, B runtimes, D token/modality budget, L per-modality proof |
| Current classification | Unverified |
| Existing implementation | docs/AI_ATTACHMENTS.md; src/modules/ai/lib/pdfAttachments.ts; existing attachment rendering/provider capability owners; complete audio/video pipeline not audited here |
| Offline evidence | Existing attachment tests must be inventoried per modality; no complete image/audio/video/document matrix or new tests run |
| Live evidence | No current modality-specific real runtime acceptance established by this reconciliation |
| Security | Uploaded bytes untrusted; MIME/size/decompression/path/active-content protection; scoped transmission/retention; no metadata-based capability grant |
| Failure handling | Unsupported/corrupt/too-large media denied with useful explanation; no silent image/text substitution or privacy-expanding fallback |
| Testable acceptance / definition of done | Independently qualify image understanding, audio input/output, transcription, video and document/attachment handling per exact runtime/model; fidelity, context cost, malicious upload, persistence and supported platform tests |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Image/document contract retained; audio generation/video implementation deferred until product use case/runtime suitability decision; requirements remain explicitly tracked |

### Contract N — Data governance

| Field | Contract |
| --- | --- |
| Existing owner | Existing native keyring/settings/session/memory/evidence stores |
| Roadmap owner | C1/C2/M1/M2/T1/T2; AR retention/recovery; P19 |
| Dependencies | G data ownership/secret isolation; K consistent snapshots; J audit access |
| Current classification | Unverified |
| Existing implementation | src/modules/ai/lib/keyring.ts; src/modules/settings/store.ts; src/modules/ai/lib/sessions.ts; src-tauri/src/modules/conversation_memory |
| Offline evidence | Existing schema/CAS/ownership tests; whole-store encryption/deletion/backup coverage not verified |
| Live evidence | No end-to-end export/delete/backup/restore/encryption acceptance established |
| Security | Encryption and key lifecycle threat model; OS keyring secrets; privacy boundaries; redaction/access and audit-log integrity; user-controlled retention |
| Failure handling | Corrupt/partial backup/import leaves previous valid state; deletion cannot strand active references or erase required audit without explicit policy |
| Testable acceptance / definition of done | Document encryption-at-rest/in-transit scope, secret storage, retention/deletion, import/export and consistent backup/restore across transcript/memory/effects; restart/access-denial and failure injection with proof of retained/deleted data |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Do not claim all stores encrypted because keys use OS keychain; exact retention and audit deletion policies open |

### Contract S — Software supply-chain security

| Field | Contract |
| --- | --- |
| Existing owner | Existing release/packaging, native runtime provenance, plugin installation owners |
| Roadmap owner | LM2D provenance; P6/P19; Z release gate |
| Dependencies | B artifact integrity, G install permissions, F plugin trust, supported OS matrix |
| Current classification | Partially implemented |
| Existing implementation | docs/CLACK_MANAGED_LOCAL_LLAMA_B12248_PROVENANCE_2026-11-16.md; src-tauri/src/modules/managed_llama_cpu_b12248_manifest.rs; packaging; package-lock.json; src-tauri/Cargo.lock; SECURITY.md |
| Offline evidence | Pinned dependency/manifest source evidence; full SBOM/reproducibility/signing/vulnerability pipeline not verified |
| Live evidence | Historical exact CPU archive/native-file verification only; no signed multi-OS release acceptance |
| Security | Dependency provenance/SBOM/licenses/copyright, signed releases/updates, per-file runtime verification, vulnerability management and reproducibility |
| Failure handling | Unknown signer/hash/version/rollback image rejected; interrupted update preserves trusted prior install; compromised extension revoked |
| Testable acceptance / definition of done | Generate and inspect complete component/license inventory; verify signed release/update and runtime artifacts, reproduce build on clean recorded toolchain, test tamper/rollback/revocation and vulnerability response |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Do not install dependencies/runtimes or publish/sign releases during documentation work |

### Contract U — Identity and collaboration

| Field | Contract |
| --- | --- |
| Existing owner | Existing conversation/agent/workspace/PeerTask identity and permission stores |
| Roadmap owner | Multi-agent phases 0–7/H1/H2; AR/P3/P4/P11; team support decision |
| Dependencies | G authorization, I durable ownership, shared-resource isolation |
| Current classification | Partially implemented |
| Existing implementation | docs/AI_MULTI_AGENT_BUILD_PLAN.md; src/modules/ai/lib/sessions.ts; peerTasks.ts; permissions.ts; src/modules/ai/store/chatStore.ts |
| Offline evidence | Existing multi-agent identity/recovery/scope tests; no multi-user RBAC test acceptance |
| Live evidence | MULTI_AGENT_COWORKING_ACCEPTANCE.md is local multi-agent evidence, not authenticated multi-user/team support |
| Security | Stable user/session/agent/workspace/job identity; explicit sharing and shared-resource scope; no cross-owner credential/memory leakage |
| Failure handling | Identity mismatch/revoked membership denies access; owner loss interrupts safely and retains private records |
| Testable acceptance / definition of done | Test session/agent/workspace ownership and shared-resource authorization through restart/delegation; before multi-user support choose authentication/roles/invites/audit and demonstrate cross-user isolation |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Multi-user/team accounts and RBAC explicitly deferred: intended current scope is local-first personal app; no account service introduced for checklist completion |

### Contract V — Application lifecycle and release quality

| Field | Contract |
| --- | --- |
| Existing owner | Existing Tauri packaging/config migrations/settings/native platform owners |
| Roadmap owner | Z/P18/P19; LM2D update/rollback; AR restart recovery |
| Dependencies | S provenance, N migrations/backup, H recovery, OS capability matrix |
| Current classification | Partially implemented |
| Existing implementation | src-tauri/tauri.conf.json; packaging; docs/FINAL_ACCEPTANCE.md; docs/REAL_WORLD_ACCEPTANCE.md; src/modules/settings; CLACK_IMPLEMENTATION_PLAN.md |
| Offline evidence | Existing packaging/migration tests; old public shipped/updater claims conflict with disabled-channel implementation notes and require current source-specific release audit |
| Live evidence | Historical platform/installer checks remain dated; no current all-OS signed installer/upgrade/rollback/offline acceptance |
| Security | Signed update/channel trust; migration integrity; privacy-preserving diagnostics/crash reporting opt-in; no telemetry assumption changed |
| Failure handling | Interrupted install/upgrade/migration reopens valid previous state; app restart preserves authorized jobs and unknown effects; offline UI truthful |
| Testable acceptance / definition of done | Native install/upgrade/config migration/rollback/uninstall, diagnostics/crash recovery/offline workflows and packaging tested separately on Windows/Linux/macOS/WSL claimed configurations; performance/resource budgets measured |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Release channel and crash-report policy open; no installer/runtime/system modification authorized |

### Contract X — Extensibility and developer experience

| Field | Contract |
| --- | --- |
| Existing owner | Existing tool/Skill/plugin API contracts and native capability boundaries |
| Roadmap owner | T1/T2/T3c/F1; P5/P6/P10/P16/P19 |
| Dependencies | F tool lifecycle, G trust/scopes, S supply chain, stable version schemas |
| Current classification | Planned |
| Existing implementation | docs/TOOL_RESEARCH_MCP_FABRIC_FOUNDATION.md; src/modules/ai/lib/customTools.ts; capabilityIndex.ts; existing internal IPC is not public API |
| Offline evidence | Existing custom-tool contract tests; public API/SDK compatibility/certification coverage not established |
| Live evidence | No certified external extension ecosystem acceptance found |
| Security | Versioned scoped plugin interfaces; reviewed provenance; no exposing internal IPC or granting arbitrary trusted control-plane access |
| Failure handling | Incompatible plugin disabled with retained data; update rollback/revocation safe; errors bounded and inspectable |
| Testable acceptance / definition of done | Publish stable versioned integration contracts and developer docs; example extension passes compatibility/security/lifecycle/independent local-Agent end-to-end certification on claimed OSes |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Public general API and specialist catalog only where useful; no second executor or registry |

### Contract Y — User experience

| Field | Contract |
| --- | --- |
| Existing owner | Existing React chat/controls/approvals/activity/notifications/settings surfaces |
| Roadmap owner | U1/R3/LM8/LM11/LM15; P10/P17/P18 |
| Dependencies | Truthful H/I/J/L status, G approvals, current evidence and native lifecycle |
| Current classification | Partially implemented |
| Existing implementation | src/modules/ai/components/DeploymentQualificationLab.tsx; DeploymentEvidenceExplorer.tsx; ChatSecondaryControls.tsx; AgentPermissionControl.tsx; docs/CHAT_CONTROL_SURFACE.md; docs/UX_AUDIT.md |
| Offline evidence | DeploymentQualificationLab.test.tsx; DeploymentEvidenceExplorer.test.tsx; AgentPermissionControl.test.ts; existing responsive/keyboard tests; full localization/accessibility not certified |
| Live evidence | Historical passive deployment-guide acceptance; original LM11 output receipt not found; no current comprehensive accessibility/localization/native-user acceptance |
| Security | Sanitized errors and no secret disclosure; show exact action and approval target; hidden/disabled unavailable controls; read-only opening cannot infer authorization |
| Failure handling | Clear queued/running/waiting/blocked/cancelled/incomplete/failed/verified states and error reasons; cancellation remains reachable; notify only meaningful changes |
| Testable acceptance / definition of done | Real UI task/progress/activity/notification/approval/cancel/error journeys, keyboard/screen reader/focus/zoom/narrow pane and localization tested with native lifecycle; UI cannot claim readiness from preview |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | Localization and accessibility audit remain required planned work; no mock controls or architecture jargon in ordinary user flows |

### Contract W — Storage lifecycle, roots, integrity and safe relocation

| Field | Contract |
| --- | --- |
| Existing owner | Existing runtime/model/artifact install paths, Cargo/build caches, user settings, conversation/memory/evidence stores, native workspace/data governance and packaging owners; **no new central storage registry** |
| Roadmap owner | LM2C/LM2D runtime and model artifacts; AR memory/evidence; TF sandbox/research downloads; N data governance; S supply chain; V lifecycle; K snapshots; P18/P19 platform gates |
| Dependencies | N ownership/encryption/retention; K snapshots and owned rollback; B artifact manifests/epochs; G permission-scoped cleanup; S digests/licenses; V native migration/update; disk and volume identity |
| Current classification | Partial design/known historical cache inventory; configurable roots, safe relocation and whole-platform storage acceptance **Unverified** |
| Existing implementation | src-tauri/src/modules/managed_local_runtime.rs; src-tauri/src/modules/conversation_memory; src/modules/ai/lib/localComputeFabric.ts; src/modules/settings/store.ts; src-tauri/tauri.conf.json; docs/AI_SELF_HOSTED_INFERENCE_PLAN.md. Inspect exact file ownership before implementation; these are existing anchors, not a new storage service |
| Offline evidence | Historical four-Cargo-target audit and user-approved deletion exception; existing native managed-runtime hash/manifest and memory ownership tests. No safe-relocation/interrupt/reparse/volume migration test suite was run in this reconciliation |
| Live evidence | Historical C:/A: cache observations and intentional debug/codex-test deletion are **not** current platform storage acceptance. A: copies and an open administrator copy step cannot be treated as verified relocation; no live operation authorized |
| Security | Distinguish ephemeral generated caches from immutable acceptance evidence, managed model/runtime files, licensed assets and private user data. Root/volume identity, ACL, hashes, provenance and reference ownership must survive migration; no machine-specific portable config or unapproved delete |
| Failure handling | Disk exhaustion/permission loss/broken junction/volume detach/hash mismatch/interrupted copy leave originals untouched and expose recoverable partial state. Unknown equality or path identity denies cleanup; explicit human approval for any destructive archival |
| Testable acceptance / definition of done | Inventory ownership/class/bytes/retention; configurable separate roots and free-space preflight; copy-first metadata+SHA verification; atomic switch with rollback; path/identity/reference/manifest preservation; interrupted migration and broken-volume/junction tests; usage reporting, retention/archival policies and explicit safe cleanup. Independently verify restart and supported OS/path cases without changing unrelated index/stashes/data |
| Evidence location | Existing model/runtime provenance, workspace/storage plans and dated cache audit; future immutable migration/negative-test receipts linked from AGENT_ENGINEERING_STATE.md and existing native store/effect owners |
| Explicit deferral / limitation | Planning only. No cache move, junction, deletion, user-data archival, runtime/model relocation, background admin task or storage-root configuration change authorized by this roadmap update |

### Contract P — Reconciliation, preservation and completion contract

| Field | Contract |
| --- | --- |
| Existing owner | Canonical master roadmap and shared engineering-state tracker; current user instructions |
| Roadmap owner | P0 documentation reconciliation; all LM/TF/AR and P2–P19 acceptance gates |
| Dependencies | Exact source, current HEAD/index/stashes/81-file baseline, historical evidence and actual source |
| Current classification | Planned |
| Existing implementation | docs/COS_FULL_PLATFORM_AUDIT_2026-10-22.md; docs/AGENT_ENGINEERING_STATE.md; docs/PRODUCTION_HARNESS_RECONCILIATION_2026-11-18.md; docs/PRODUCTION_HARNESS_TRACEABILITY_2026-11-18.md |
| Offline evidence | Documentation coverage, links, patch scope and SHA-256 preservation checks; no product tests/inference required for documentation-only changes |
| Live evidence | Not applicable to reconciliation; future product live acceptance remains separately gated and is never implied by planning |
| Security | No product source/settings/evidence mutation; no reset/clean/stash/amend/rebase/push; no inference/download/runtime/GPU/system/Ollama/network/ForgeBoard changes; no unauthorized staging |
| Failure handling | Unexplained preservation discrepancy stops all edits; unavailable evidence remains Unverified; old task narrative cannot override current source or user scope |
| Testable acceptance / definition of done | Every source clause linked to owner/milestone/dependencies/status/source/offline/live/security/failure/exit/evidence; canonical roadmap and tracker updated in place, gaps/risks/decisions/deferrals explicit, exact file diff and preservation rechecked, one unsent next handoff delivered |
| Evidence location | Existing source/test paths above and dated acceptance documents; future proof must be stored as immutable checkpoint-owned records linked from AGENT_ENGINEERING_STATE.md and the existing qualification/effect ledger, never from a competing authority. |
| Explicit deferral / limitation | No product implementation, commit or push. TF0–TF25 and AR0–AR15 definitions are present in the governing handoff; exact per-milestone evidence and older app-only task-plan status remain distinct and unverified |

## Actual OS × vendor × backend × runtime support matrix

This is a repository-evidence matrix, not an assertion of upstream vendor/runtime compatibility. Each other OS/backend/runtime combination is **Unverified** until its own positive evidence exists. GPU detection does not certify an executable backend. Device discovery and measured available VRAM are separate from offloading and allocation.

| OS | Device/vendor | Backend | Runtime | Repository execution/acceptance evidence |
| --- | --- | --- | --- | --- |
| Windows | CPU | CPU, 0 GPU layers | Managed llama.cpp b12248 | Narrow historical Chat, streaming, terminal and LM6 cold/warm/cancel evidence; instruction adherence failed/stale and native tools unsupported. No current process observation in this reconciliation. |
| Windows | NVIDIA | CUDA | Managed llama.cpp or another adapter | Missing managed GPU executor/qualification in inspected implementation; telemetry does not prove CUDA execution. |
| Windows | AMD | ROCm/HIP / other viable backend | Adapter-specific | Unverified compatibility/provisioning/execution; integrated AMD detection alone is insufficient. |
| Windows | Intel | Intel acceleration / Vulkan as applicable | Adapter-specific | Unverified; no actual inference/offload/qualification evidence established. |
| Linux | NVIDIA | CUDA / Vulkan | Adapter-specific local or remote | Unverified exact cell; remote Ollama registration/history does not establish current GPU, driver, epoch or offload. |
| Linux | AMD | ROCm/HIP / Vulkan where supported | Adapter-specific | Unverified exact OS/device/runtime compatibility and real execution. |
| Linux | Intel | Intel acceleration / Vulkan where supported | Adapter-specific | Unverified exact cell. |
| macOS | Apple / supported devices | Metal / CPU | MLX, llama.cpp or adapter-specific | Existing provider transport is not managed runtime provisioning or hardware qualification; exact cells Unverified. |
| Any claimed OS | Any supported vendor | Hybrid CPU/GPU; layer/tensor offload | Adapter-specific | Planned universal extension; placement/allocation/throughput evidence required, no summed multi-GPU assumption. |
| Any claimed OS | Multiple devices | Multi-GPU, vendor-specific or cross-vendor where viable | Adapter-specific | Unverified; require explicit device topology and per-device placement/resource/security evidence. |
| Any claimed OS | Other viable devices | Other platform backend | Adapter-specific | Explicit decision and evidence required; unsupported must be explained, never silently fallback. |

The implementation must expand this table into independently identified exact OS/version, device/driver/toolkit/backend/runtime/version combinations before claiming support. Unsupported combinations may remain unsupported with reasons; universal architecture does not promise every theoretical combination works.

## Dependency graph and blocking gates

Arrows mean a prerequisite contract or scoped implementation before dependent acceptance; they do not authorize execution or require all future pillars to be implemented simultaneously. Base contracts are separated from end-to-end qualification to avoid a false cyclic dependency between hardware support and its eventual tests.

~~~mermaid
flowchart TD
    BASE["Existing identity, CAS persistence, source/effect ownership"] --> POLICY["G: policy, credentials, approvals"]
    BASE --> MISSION["I/P3: durable mission and requirement base"]
    BASE --> TELEMETRY["LM3–LM5: device and resource evidence"]
    POLICY --> SUPERVISE["Native process supervision and resource controls"]
    SUPERVISE --> SANDBOX["C/T3/P6: isolated execution boundary"]
    TELEMETRY --> RUNTIME["B/LM2C–LM2D: verified backend/runtime lifecycle"]
    RUNTIME --> PLACEMENT["A/LM5: device placement, hybrid and concurrency"]
    POLICY --> CANCEL["LM11 closure: absolute deadline and cancellation at admission/pre-dispatch"]
    BASE --> CANCEL
    CANCEL --> QUIET["Native terminal/quiescence and bounded persistence outcome"]
    QUIET --> LAB["LM11 runnable qualification safety acceptance"]
    RUNTIME --> LAB
    MISSION --> RETRIEVE["Existing C1/M1/M2/G1 source-linked retrieval"]
    RETRIEVE --> COMPILER["D/B1/F1/R4: compiled context and model token accounting"]
    POLICY --> TOOLS["F/T1/T2/T3c/P5: authorized versioned tools"]
    SANDBOX --> TOOLS
    TOOLS --> RESEARCH["E/P8/P9: browser, search, source provenance"]
    POLICY --> TRACE["J/LM6/TF13: redacted correlated trace/effects"]
    TOOLS --> TRACE
    MISSION --> SNAPSHOT["K: workspace checkpoints and effect reconciliation"]
    SNAPSHOT --> JOBS["H/P12: durable jobs, idempotency and recovery"]
    CANCEL --> JOBS
    JOBS --> SCHEDULE["P13: scheduling and conditional watches"]
    PLACEMENT --> QUALIFY["L/LM12–LM15: exact-deployment evaluations"]
    LAB --> QUALIFY
    COMPILER --> QUALIFY
    RESEARCH --> AGENT["Independent local Agent task/security/recovery acceptance"]
    QUALIFY --> AGENT
    TRACE --> AGENT
    JOBS --> AGENT
    AGENT --> RELEASE["P18/P19/Z: native platform and release acceptance"]
    GOVERN["N/S/U/V/X/Y/W: privacy, supply chain, identity, lifecycle, API, UX, storage gates"] --> RELEASE
    POLICY --> STORAGE["W: storage ownership, root/volume identity and permission-scoped cleanup"]
    STORAGE --> SNAPSHOT
    STORAGE --> RUNTIME
    STORAGE --> JOBS
    STORAGE --> GOVERN
~~~

LM11 safety closure is a prerequisite of Lab execution, not permission to run a model. Browser/MCP requires the relevant isolated executor, egress, policy and trace boundary. Context Compiler requires durable source/mission evidence, retrieval and model-specific complete serialized accounting. Durability requires native cancellation, persistent state/checkpoints, quotas, supervision and no duplicate/uncertain-effect replay. Agent qualification composes the relevant model/tool/security/recovery gates; none substitutes for the others.

## LM11–LM15 closure requirements and task-plan blockers

**B01 — aggregate wall deadline (critical, open):** qualificationLabPlan.ts declares aggregateWallDeadlineEnforced: false. Existing deploymentQualificationRuntime.ts and deploymentMeasurementRuntime.ts contain admission/readiness/session writes/preparation/dispatch/settlement/receipt/CAS awaits. Their per-request limits do not enforce one aggregate deadline. Use an immutable monotonic absolute deadline owned across the entire operation, with remaining-budget propagation into every cancellable boundary and authoritative terminal outcome. A timeout race that returns while a later continuation still dispatches or persists success fails this gate.

**B02 — pre-registration cancellation (critical, open):** stopping before inference registration must establish a durable/owned no-dispatch condition checked after every preparation/admission await and immediately before dispatch. A later registered native ID must be cancelled with its own identity. Independent tests must release every deliberately delayed await after cancel/deadline and prove zero new dispatch, no automatic continuation, no wrong-owner cancellation, no late success receipt and preserved existing effects. User-cancel, deadline, shutdown and identity change are separate terminal reasons.

**B03 — persistence and quiescence (critical, open):** terminal native settlement/quiescence must be separate from SDK promise settlement. CAS conflict, stalled writes, late completion and ambiguous commit outcomes must remain Incomplete/Unknown with reconciliation, not a second successful dispatch or false deadline guarantee. Define bounded durable finalization and what happens if storage cannot acknowledge within the remaining budget. Do not claim synchronous wall-bounded persistence from an uncancellable promise.

**Later authorized offline source checkpoint (18 November 2026), not a milestone closure:** B01 and B02 now have operation-scoped monotonic deadline and pre-registration/no-late-dispatch guards in the existing LM2F/LM6 flight, transport, native proxy, and cancellation owners. B03 now distinguishes SDK settlement, native terminal, finite quiescence, CAS acknowledgement and ambiguous persistence without ever treating a timed-out write as success. Offline regression results and exact implementation are in [the LM11 acceptance contract](LM11_LM15_LOCAL_MODEL_QUALIFICATION.md#authorized-lm11-offline-execution-safety-checkpoint--18-november-2026). **All three remain Partial in full acceptance status**: the native store's synchronous `self_hosted_profiles_compare_and_swap` may commit after the webview times out, and no operation-owned native CAS cancellation/fencing or restart-durable unknown-outcome reconciliation is yet proven. Do not enable Qualification Lab Run or launch inference. The next safe prerequisite is a separately authorized **offline native B03 atomic-commit/reconciliation** checkpoint rather than Live LM11 or LM16.

**B04 — unsupported qualification procedures (high, open):** eight of ten Lab procedure descriptors have null runners/zero dispatch allowance; Chat/LM6 descriptors also remain disabled by the aggregate gate. Current source is not a runnable coding, native-tool, long-context, reliability, standalone-cancel or Agent lab. Preserve exact fixture scope and extend protocols incrementally; no generic enable-all flag.

**B05 — independent candidate/Agent acceptance (high, open):** historical/synthetic fixtures cannot grant current eligibility. No fully accepted Agent candidate is established. Code/UI/benchmark fixtures and historical local-model success do not grant FORGEBOARD_CANDIDATE_READY or FORGEBOARD_PASS. Preserve negative and unavailable results and fixed denominators.

**B06 — numbered TF/AR evidence and app-plan provenance (medium, partially resolved):** the governing 20-page handoff **provides the complete TF0–TF25 and AR0–AR15 definition tables**. The definition-source gap is closed; per-ordinal implementation/acceptance proof and prior app-only task statuses are still Unverified unless backed by source/evidence. Preserve known TF13 and existing P checkpoints; do not invent milestone completion, a new registry or LM16.

**B07 — acceptance evidence availability (medium, open):** 1,183 tests and passive Lab desktop PASS were reported. This audit located current tests, the passive script and a successful historical frontend build log, but not the complete original 1,183-test receipt and passive execution output. Label those two reported PASS claims Unverified here. Never rerun a live procedure to reconstruct lost history. Deleted debug/codex-test directories are intentional cleanup and require no recovery.

**B08 — local-AI and platform gate (high, open):** older R-track summaries are stale and superseded only within the scope of later accepted source/evidence. Neither newer LM docs nor this reconciliation certifies complete long-horizon local Agent reliability or universal platform/GUI support. P2–P19 remain mandatory/deferred under the existing project order until its gate or an explicit user priority change.

## Gap and risk register

Every matrix row inherits the risk for its contract; Missing/Partial/Planned/Unverified rows remain outstanding obligations. Severity indicates implementation sequencing, not authorization. No unsupported platform is hidden behind an overall PASS.

| Risk | Severity | Gap / consequence | Closure owner / evidence gate |
| --- | --- | --- | --- |
| G-A | High | Vendor-neutral device/runtime compatibility, GPU/hybrid/multi-GPU placement not established; wrong support or memory claims | Contract A; OS × device × backend × runtime live matrix |
| G-B | High | CPU lifecycle does not establish universal signed/private/update/rollback/concurrency behavior | Contract B plus provenance and native fault injection |
| G-C | Critical | Confined tools do not prove every shell/terminal is isolated from trusted control plane | Contract C; platform threat model and real escape/egress/secret/resource tests |
| G-D | High | Context can omit requirements/decisions or overfeed small models | Contract D; exact payload and independent fidelity/compaction/restart corpus |
| G-E | High | Fetching pages mistaken for search/browser research; injection/external effect risks | Contract E; real sourced search/browser outcome with hostile content |
| G-F | Critical | OAuth/rotation/stdio isolation and changed-tool trust gaps | Contract F; version/revoke/auth/hostile output lifecycle evidence |
| G-G | Critical | Cross-surface approval expiry/arguments/TOCTOU/policy precedence not fully audited | Contract G; execution-time scoped authorization and same-run resumption |
| G-H | Critical | Lost/duplicate background work or cancellation races | Contract H and B01–B03; restart/double-dispatch/heartbeat/quota proof |
| G-I | High | Mission or memory facts, instructions and estimates confused | Contract I; durable provenance/requirements/conflict and recovery evidence |
| G-J | High | Incomplete correlation or guessed measurements appear authoritative | Contract J; exact joins, privacy and typed Unknown metrics |
| G-K | Critical | Rollback destroys unrelated or completed work / contradicts effect ledger | Contract K; dirty/index/stash/conflict/crash recovery matrix |
| G-L | Critical | Lab dispatch outlives deadline/cancel, or preview falsely certifies Agent | B01–B05 and Contract L; keep Run disabled |
| G-R | High | Outage/exhaustion/retry loops exceed budget or repeat uncertain effects | Contract R; bounded fault injection and idempotency |
| G-O | High | Routing changes privacy/deployment scope or uses stale ranking | Contract O; exact scope and explicit fallback/budget proof |
| G-M | High | Unsupported or hostile media crosses runtime/privacy boundaries | Contract M; per-modality qualification and attachment security |
| G-N | High | Encryption/retention/deletion/restore claims exceed actual data guarantees | Contract N; whole-store lifecycle audit |
| G-S | High | Untrusted dependency/runtime/update or missing notices | Contract S; SBOM/signatures/reproducibility/vulnerability response |
| G-U | High | Local multi-agent confused with multi-user authorization | Contract U; D08 scope decision; no team-support claim |
| G-V | High | Unsupported installer/upgrade/offline/restart behavior | Contract V; native OS/version/package evidence |
| G-X | Medium | Unstable plugin/public API exposed without version/certification | Contract X; useful scoped API and extension compatibility |
| G-Y | High | UI masks incomplete work or inaccessible Stop/approval | Contract Y; native workflows, accessibility/keyboard/localization |
| G-W | High | Storage roots, hashes, references, license/evidence separation, interrupted migration and volume/junction failures are not accepted; indiscriminate cache cleanup can destroy data | Contract W; non-destructive inventory, root/path identity, full copy-first verification, negative/restart/rollback acceptance |
| G-P | Medium | Unverified per-ordinal TF/AR proof, original governing DOCX bytes in resumed session, app plan and test receipts cause narrative drift | D01/B06/B07; retain honest definition, source-availability and acceptance boundaries |

## Prioritized implementation sequence

This is a recommendation for later authorization. No item below starts product implementation now.

| Order | Bounded work / owner | Prerequisites and exit |
| --- | --- | --- |
| 0 | Complete this documentation-only reconciliation and preservation closeout | Canonical roadmap/tracker links, every source line traced, all 81 hashes/index/stashes/HEAD preserved; user reviews map |
| 1 | **LM11 execution-safety closure, offline only** | B01–B03 independent regression first; preserve current fail-closed Lab Run gate; current request grants no code authorization |
| 2 | Independent bounded safety integration acceptance and then a separately authorized real UI/runtime procedure | Native cancellation/terminal/CAS evidence and current exact deployment; do not retry to pass or revive unsupported protocols |
| 3 | LM12–LM15 evidence/candidate procedure closure in small supported slices | Supported executor, scope identity and independent coding/context/tool/reliability validators; actual failed cohorts visible; no ForgeBoard by implication |
| 4 | Local-AI architecture foundations: runtime/backend support matrix, universal lifecycle, policy/sandbox/trace contracts, mission/context fidelity, storage-root/retention requirements | Reuse current LM/TF/AR and N/K/W/P owners; choose the next bounded high-risk slice after map review; each platform explicit; no user data migration implied |
| 5 | Complete relevant local Agent reliability and independent outcome/recovery acceptance | Applicable model/tool/security/context/effect/restart gates; no broad capability promotion from one task |
| 6 | Resume full P2–P19 / TF / AR program in existing dependency order | P2 adaptive exposure, P3 objectives, P4 workers; P5 auth before catalog; P6 host before process plugins; P8/P9 browser/research/memory; P12 durability before P13 scheduling; P18/P19 before release claims |

Read-only specifications, provenance/retention reviews, recovering missing numbered-plan definitions and independent documentation review can proceed alongside an authorized bounded code checkpoint. One code-writing owner per shared worktree/file remains the convention. This is a statement of safe sequencing, not an instruction to spawn agents or run parallel implementation. Product implementations that change overlapping policy/persistence/runtime owners must be serialized.

## Decision register and explicit scope deferrals

| Decision | State / default | Required resolution and owner |
| --- | --- | --- |
| D01 Numbered TF/AR status and evidence | **Definition-source gap resolved** by governing handoff TF0–TF25/AR0–AR15; milestone proof remains Open | Map each canonical ordinal to inspected existing owner, exact source/receipts and conservative status. Keep P checkpoints and original numbering; no new program authority or blanket acceptance. |
| D02 OS execution isolation | Open; fail closed where capability unavailable | Native confinement/permission owners evaluate Windows/Linux/macOS controls, child-tree cleanup, GPU/device access and secret/control-plane boundary. |
| D03 Compute support policy | Open per exact cell; CPU historical proof only | Compute Fabric/adapters decide supported OS/device/driver/backend/runtime combinations, provisioning and offload configurations; qualify each. |
| D04 Routing/fallback/resource/cost | Explicit user policy required; no silent cloud/backend switch | Existing model-switch/admission owners define caps, backpressure, placement and stale-evidence behavior. |
| D05 Durable job/scheduling architecture | Extend existing session/PeerTask/persistence authority; P12 before P13 | AR defines leases, idempotency, deadlines, crash/unknown effects, job ownership, closed-window behavior and timezone/DST/missed-run policy. |
| D06 Data encryption/retention/deletion/backup | Open beyond existing scoped keyring/CAS | Store/memory/security owners document encryption boundaries, key lifecycle, retention versus immutable audit, consistent export/import and restore. |
| D07 Modalities | Image/document contracts remain; audio output/video deferred pending useful scope and compatible runtime | Attachment/runtime/qualification owners define task, privacy, format/cost limits and per-modality live gates before enabling. |
| D08 Multi-user/team support | Explicitly deferred; local personal/multi-agent scope does not imply accounts/RBAC | Product owner must authorize teams/auth/roles/shared resources before implementation; existing local ownership/isolation remains mandatory. |
| D09 Release supply chain | Open current channel/signing/reproducibility/SBOM/response coverage | P19/Z/native packaging owners inspect actual updater state; historical ROADMAP shipped claims are not current release evidence. |
| D10 Trace payload/privacy/replay | Content minimization default; no irreversible-effect replay | Measurement/effect owners set redaction, access, retention/export and safe offline replay; missing metrics remain Unknown. |
| D11 Public APIs/extensions | Useful scoped contracts only, not raw IPC exposure | TF/P10/P19 decide API version lifecycle, docs/example and certification before public support claims. |
| D12 Historical test/desktop receipts | Unverified if missing; retain reported numbers as claims | Recover existing output if available without restoring deleted build trees, launching model inference or rewriting historical evidence. |
| D13 Storage root/retention/relocation policy | Open; separate ephemeral cache from immutable evidence, installed runtimes/models and private user data | Existing storage/LM/AR/N/K/V owners must decide configurable roots, disk preflight, retention/archival, manifests, copy-first integrity, rollback and disconnected volumes; explicit approval before any move or delete. User's earlier debug/codex-test deletion remains accepted and is not reversed. |
| D14 Governing-source attestation | Definitions and semantic subrequirements integrated; original 20-page DOCX not mounted in resumed session | Do not attribute an unverified DOCX SHA-256 or claim a mechanically lossless page/line comparison until the exact governing bytes are accessible. Retain older text-source SHA separately and treat DOCX-specific coverage as source-availability-limited. |

These are reasoned deferrals, not silent cancellations. GPU architecture, runtime lifecycle, policy/sandbox, durable missions, context, research/MCP, tracing, rollback, evaluation, privacy, storage lifecycle, release quality and accessibility remain required production obligations. Specialist modalities/team accounts/public APIs are gated by explicit product decisions rather than checklist-driven scope growth.

## Mandatory definition of done and proof packaging

For each capability, name exact requirement IDs from the matrix, owner files, current identity/revision, expected output/effects and independently testable outcome before implementation. Require appropriate unit/contract/integration/security/failure-injection/persistence/restart tests, real UI/runtime/hardware/platform acceptance and performance measurements. Document any not-applicable layer with a concrete reason; absent evidence is an outstanding gate.

Evidence must include source revision/diff, exact command and exit/result, fixture/task revision and fixed attempt denominator, time/budget/cancel semantics, supported platform/runtime/deployment/process/epoch/configuration, permission/scope, native versus SDK correlation, measured/derived/estimated/Unknown units, independent expected/actual outcome, retained failures and source-linked artifacts. Preserve original receipts and historical failures. A model completion, UI preview, successful isolated call or a few tests never closes essential unfinished dependencies.

Completion is conjunctive across required acceptance layers. Implemented and accepted only applies to the exact demonstrated scope. A partially accepted implementation, supported-but-untested backend, discoverable-but-unauthorized tool and historical-but-stale proof remain separately visible. Unsupported cells do not disappear into an overall green milestone.

## Next implementation handoff (prepared, not sent)

The full ready-to-paste prompt is maintained in [PRODUCTION_HARNESS_NEXT_HANDOFF_2026-11-18.md](PRODUCTION_HARNESS_NEXT_HANDOFF_2026-11-18.md). It recommends one bounded offline LM11 safety task after explicit implementation authorization. This reconciliation does not send it or grant a new live run, source edit, commit or push.

## Documentation verification closeout and governing-handoff continuation

The earlier validator matched **940/940 nonblank clauses of the earlier text source** and the original **22** architecture contract references. This continuation retains all R rows, adds cross-cutting **storage lifecycle Contract W (23 contracts total)** and extends the governing-handoff H-series to **430 individually numbered 14-field rows** for LM/TF/AR, twelve pillars, additional production/storage domains, §§9–14 operating and acceptance requirements. This is requirement-level coverage of the available handoff brief; original-DOCX digest and exhaustive original-page/line comparison remain **Unverified** because the bytes are not available in this resumed session. Never report 940/940 as governing-DOCX completeness.

**Final resumed-session read-only preservation recheck (18 November 2026): PASS.** Branch main, HEAD **50fca4689692bc1e85f9ffd4ae644ff528cc056e**, raw index SHA-256 **5cd3574caaa8fc3ec4d01e79cbd8f6edb90573600df927e068a3d1b1c144f211** and empty staged diff, original stash object IDs **6a7bc6beef913a323052b277f766ae32be11bae1** and **b96fc46d783f1635acec2278deed7b43479f5f9a**, plus **81/81 protected path hashes** and canonical aggregate **339aba89d167b45a0cca1f663293fd3fa6197f63f0b2e4cab7f444b90670c104**, all matched the recorded baseline. Expanded status remains **81 originally protected paths + 7 tracked roadmap-owned edits + 4 already-present untracked roadmap drafts = 92**. Only these 11 roadmap documents are in the authorized diff allowance; original 81 files, user data, stashes and managed runtimes/models were not changed. R-series **940/940**, H-series **430/430 valid 14-column contiguous IDs**, TF **26** and AR **16** definition rows, **23** contracts and internal document-link targets passed offline structural validation; `git diff --check` found no whitespace errors. No source tests/build, desktop action, inference, model/runtime installation, system/service/network change, ForgeBoard, commit or push was performed. Historical test/build/UI proof retains its original limits.

Unresolved product gates remain B01–B05/B07–B08 and the per-ordinal proof aspect of B06, G-A–G-Y/G-W/G-P and open decisions D01–D14. The definition-source portion of B06/D01 is resolved. Documentation coverage cannot close production or live-acceptance gates. The [single next LM11 safety handoff](PRODUCTION_HARNESS_NEXT_HANDOFF_2026-11-18.md) is prepared only, not sent or authorized.
