# Clack Self-Hosted Inference Plan

Status: Complete through R1; 16 of 32 ordered checkpoints complete. R2 is next and unstarted.
Status updated: 2026-09-27, implementation HEAD `ffd874d`
Audit date: 2026-09-06
Audited baseline: 5415e5d9d34ced7b32fe10095275b161ca6b4f2a
Baseline checkpoint: fix(ai): harden in-chat model switching

Advanced intelligence planning revision: 2026-09-19, audited at `460465a` on
`main`. That planning revision was documentation only: B1 was complete and C1
had not started at that time. Subsequent implementation is recorded in the
current status overview and checkpoint ledger below. The original audit remains
historical evidence, not a description of today's missing features.

This is the durable product and engineering plan for self-hosted inference.
It complements [the multi-agent build plan](AI_MULTI_AGENT_BUILD_PLAN.md) and
preserves [the attachment safety contract](AI_ATTACHMENTS.md). Those programs
are not to be repeated or replaced. All implementation checkpoints below are
tracked in the checkpoint ledger. The original planning commit implemented no
inference features; implementation records below describe subsequent checkpoints.
This document also owns the advanced context, memory, tools and multi-agent
intelligence program. The older multi-agent plan remains the completed-program
record; its old next-A2 pointer and the attachment document's older context
estimator description are superseded by this ledger and B1's record. Attachment
security/format limits and AI_RUNTIME.md permission semantics remain binding.

Planning navigation: [current audit](#advanced-current-state-audit),
[upstream study](#upstream-reference-study),
[ownership](#advanced-ownership-and-integrity),
[memory](#conversation-memory-and-compaction),
[project freshness](#project-memory-and-freshness),
[retrieval](#automatic-evidence-retrieval),
[switching](#target-context-preparation),
[collaboration](#peer-communication-and-handoffs),
[reasoning](#reasoning-activity-and-effort),
[custom tools](#custom-tools-and-security),
[checkpoint order](#checkpoint-order-and-gates),
[A-L scenarios](#advanced-acceptance-scenarios), and
[expanded traceability](#advanced-requirement-traceability).

## Implementation Status: 2026-09-27

The latest completed implementation is `ffd874d feat(ai): clarify reasoning and
agent activity`. See the [detailed progress report](CLACK_PROGRESS_REPORT_2026-09-27.md)
for achievements, commit references, verification evidence and limitations.
The [checkpoint ledger](#checkpoint-order-and-gates) and individual implementation
records remain authoritative for scope, acceptance, dependencies and rollback.

### Completed

| Area | Completed checkpoints | Delivered capability |
| --- | --- | --- |
| Self-hosted inference | A1, A2, A3 | Endpoint profiles, bounded authenticated handshakes, setup and capability-aware routing |
| Request safety | D1, E1, B1 | Request lifecycle/cancellation, shared endpoint admission and actual request-budget preflight |
| Conversation context | C1a, C1b, G1a | Durable source-linked memory, bounded automatic compaction and same-conversation evidence retrieval |
| Project knowledge | M1, M2, G1b | Explicit authorized sharing, evidence freshness and scoped project/task retrieval |
| Model switching | C2 | Target-sized context preparation and atomic Optimize and switch |
| Collaboration | H1, H2 | Durable task-scoped clarification, recipient-aware handoffs and evidence-bound review |
| Activity presentation | R1 | Truthful provider-output distinctions and source-linked chronological activity |

The earlier multi-agent plan's phases 0-7 are complete separately. They are not
extra completed checkpoints in this plan's 16/32 count. Checkpoint counts are
not an estimate of remaining effort or a claim of final release readiness.

### Remaining, in Execution Order

| Order | Checkpoint | Still to implement and verify |
| --- | --- | --- |
| 17 | R2 | Evidenced reasoning-effort options mapped to actual provider requests and B1 reserves |
| 18 | T1 | Versioned custom-tool definitions, visible management and scoped authorization |
| 19 | T2 | Guarded native/HTTP tool execution, real safe testing and bounded lifecycle |
| 20 | T3a | Native execution confinement with adversarial tests and explicit platform support |
| 21 | T3b | Reviewed scripts/functions through the verified confinement boundary |
| 22 | T3c | Explicit scoped MCP connections, tool registration and lifecycle |
| 23 | F1 | Relevant tool schemas, compact prompt parity and scope-safe cache awareness |
| 24 | D2 | Safe length continuation, answer stitching and incomplete tool-call repair |
| 25 | D3 | Extended partial-stream/offline recovery without duplicate execution |
| 26 | E2 | Passive calibration and optional bounded optimization |
| 27 | F2 | Pathological-output watchdogs and polished health/Advanced controls |
| 28 | U1 | Integrated collaboration/context/tool UX with native accessibility and narrow-pane checks |
| 29 | G2 | Explicit opt-in bounded server discovery |
| 30 | G3 | Destination-specific consent and trusted fallback routing |
| 31 | Q1 | Integrated context-fidelity, freshness and collaboration quality corpus |
| 32 | Z | Final native, real-provider, hardware and platform acceptance/handoff |

**Next: R2, Functional reasoning effort.** R1 displays returned provider output;
it does not enable or configure reasoning effort. No R2 or later implementation
is included in this documentation update.

### Latest Verification Evidence

R1 recorded 130 focused tests in 9 files and 1,558 full-suite tests in 142 files,
passing types, lint, production build and whitespace checks. Lint remains at
71 warnings, 2 informational notices and 0 errors. Browser activity checks passed
at 1100px, 390px and 280px. These are recorded R1 results, not new runs for this
documentation update. R1 did not change Rust or rerun Rust gates; H1 recorded
504 passing Rust tests. Browser and mocked-provider checks do not establish
native restart, live-provider or final hardware acceptance. Q1 and Z remain pending.

## Purpose and Product Principles

Clack should be an intelligent client for same-PC models, Ollama on localhost
or another PC, local/remote LM Studio, vLLM, MLX where applicable, generic
OpenAI-compatible servers, authenticated remote HTTPS servers, private
VPN/Tailscale endpoints, and multi-GPU inference servers.

The target experience is appliance-like:

    Add self-hosted server -> Enter endpoint -> Probe -> Choose model
    -> Recommended configuration -> Done

**Automation first.** Normal users should not need to understand KV caches,
prefill, token reserves, prompt caching, parser flags, or concurrency tuning.
Clack should manage context, bounded continuation, scheduling, and recovery.

**Advanced remains available.** Important settings have Automatic, Manual,
and Reset to recommended semantics. Manual pins survive restart and tuning.

**Truth over guessing.** Separate theoretical model capability, backend/API
capability, deployed server configuration, and observed behavior. Unknown
means unknown, not a plausible model-name guess. Reachability is not proof of
authentication, successful inference, image support, or local-only processing.

**Privacy and bounded work.** No implicit cloud fallback, speculative network
scan, hidden benchmark, unlimited retry, or destructive transcript rewrite.
Stop and existing permissions remain authoritative throughout automation.

**Incremental delivery.** Keep current fields, provider branding, saved models,
chat profiles, split panes, and Dispatcher recognizable. Extend existing
identity and runtime boundaries, not another universal provider architecture.

## Current Architecture Audit

This audit describes source at the baseline above, not promises from older
TERAX documentation. Paths are repository-relative. ALREADY EXISTS means the
specified behavior exists, not that all self-hosted acceptance has passed.

| Area | Classification | Current evidence and remaining gap |
| --- | --- | --- |
| Provider selection | ALREADY EXISTS | src/modules/ai/config.ts and components/AiStatusBarControls.tsx under src/modules/ai retain the registry, local/freeform selections, compat endpoint selections, provider icons, and shared picker. Preserve cloud/OpenRouter behavior. |
| Saved models | ALREADY EXISTS | src/modules/ai/lib/savedProviderModels.ts provides stable saved-model selections under existing provider credentials. OpenRouter can have several saved model IDs; this is not several independent accounts. |
| Local adapters | NEEDS EXTENSION | src/modules/ai/lib/agent.ts builds LM Studio, MLX, and Ollama using createOpenAICompatible with localProxyFetch allowing private networks. Configured URL/manual model ID are supported; this is not discovery or runtime optimization. |
| Ollama | NEEDS EXTENSION | ollama-local, ollamaBaseURL, and ollamaModelId select the compatible chat route. No native model metadata, loaded-context handshake, or endpoint-specific runtime profile. |
| LM Studio | NEEDS EXTENSION | lmstudio-local has URL/model fields and a ping. Native model-instance metadata and runtime telemetry are not consumed. |
| MLX | NEEDS EXTENSION | mlx-local targets mlx_lm.server through the compatible API. It does not administer Apple hardware, establish tool-parser support, or discover configured context. |
| vLLM / generic compatible | NEEDS EXTENSION | CustomEndpoint already contains id, name, baseURL, modelId, contextLimit. `compat-<id>` selects it and its independent keyring account. No dedicated vLLM handshake or many-model endpoint runtime profile. |
| Local connection test | NEEDS EXTENSION | ModelsSection.tsx calls lm_ping; Rust GETs base/models with a five-second timeout and no credentials. UI treats status > 0 as success, including 401/404/500. Do not reuse that condition as healthy/authenticated. |
| Capability metadata | NEEDS EXTENSION | lib/modelCapabilities.ts uses registry tags; freeform, saved, and custom selections have unknown image/tools/native-file capabilities. Unknown raster vision blocks attachment sending. Server metadata is not consumed. |
| In-chat switching | ALREADY EXISTS | store/modelSwitch.ts, lib/modelSwitchEligibility.ts, hooks/useModelSwitch.ts and useModelSelectionLock.ts share preflight and locks between selectors. Actual next-request routing changes, not only the header. |
| Context estimate | NEEDS EXTENSION | Switch preflight includes current system/project/agent/environment text, message/tool overhead and delivered attachment representations. It is approximate, not tokenizer-exact; image cost is unknown. Runtime still uses config estimates and compat overrides. |
| Existing compaction | NEEDS EXTENSION | lib/compact.ts estimates history at characters/4; at 55% elides superseded file reads; at 70% elides older tool results toward 60%, retaining the last 24 model messages in that second stage. This is not structured rolling memory or a guaranteed fit. |
| Run budgets | ALREADY EXISTS | lib/runBudget.ts: 24-step batches, 240-step hard ceiling, nine automatic continuations, repeated identical failing-tool threshold three. Trusted Workspace/Full Access auto-continue step batches; other modes retain existing consent behavior. |
| Finish reasons / continuation | NEEDS EXTENSION | agent.ts records finishReason and recognizes step-cap tool-calls; runBudget.ts records lastFinishReason. Output-length continuation and single-answer stitching do not exist. Do not confuse these with autonomous tool-step continuation. |
| Streaming / retries | NEEDS EXTENSION | SDK streamText through lib/transport.ts and proxyFetch.ts receives Rust channel bytes. providerRetry.ts tracks up to two SDK retries around stream setup, not partial-stream resumption. There is no application-level resumable-generation protocol. |
| Structured errors | ALREADY EXISTS | lib/errors.ts normalizes auth, network, rate-limit, timeout, tool, cancellation, interruption and provider diagnostics with redaction and recoverable/retrying/terminal dispositions. Extend, do not flatten to generic offline errors. |
| Timeouts / native cancellation | NEEDS EXTENSION | src-tauri/src/modules/net.rs has a ten-second HTTP connect timeout; no distinct load/first-token/idle budgets. proxyFetch abort stops frontend consumption but sends no request-ID cancellation command to Rust. Rust stops when channel send fails, which is not proof of prompt backend cancellation. |
| PeerTask queue | ALREADY EXISTS | lib/peerTaskDependencies.ts selects dependency-ready work in creation order and avoids busy target sessions. lib/peerTasks.ts caps running PeerTasks at eight, active at 32, per-root tasks at eight, hops at three. PeerTaskQueueBridge dispatches after hydration/recovery. |
| Multi-agent capacity | NEEDS EXTENSION | Existing task limits are not GPU/endpoint capacity. agents/runSubagent.ts uses generateText with a 12-step cap separately from PeerTasks. All inference entry points must share future endpoint admission, including this path. |
| Background sessions / recovery | ALREADY EXISTS | store/chatStore.ts and chatRuntime.ts keep per-session runtime and captured run identity. lib/sessions.ts retains profiles/transcripts and marks interrupted runs on restart. PeerTask dependencies, cancellation, results/artifacts, and recovery are durable; no blind replay. |
| Settings / credentials | ALREADY EXISTS | src/modules/settings/store.ts uses LazyStore in terax-settings.json, with preferences.ts and cross-window change events. Sessions use terax-ai-sessions.json. lib/keyring.ts has provider and compat endpoint accounts with legacy secret migration. Persist references, never raw keys, in new metadata. |
| Endpoint runtime profiles | NEW SYSTEM REQUIRED | No unified endpoint+model evidence, recommendations, observation history, or per-field manual pins. Build additively on custom endpoints/local preferences. |
| Structured memory / retrieval | NEW SYSTEM REQUIRED | No durable structured working-memory revisions or relevance retrieval. Existing project CLACK.md/TERAX.md loading is separate from chat rolling memory. |
| Endpoint scheduler / calibration | NEW SYSTEM REQUIRED | Need an inference admission layer integrated with existing task semantics, plus bounded passive observations. Do not create a second PeerTask ledger. |

### Model-switch checkpoint contract

5415e5d changes the actual endpoint/provider adapter, transport model and
credentials on the next reply while preserving conversation identity. Tests
intercept real adapter requests across providers and verify historical text,
tools, system instructions, and attachment delivery. A run remains pinned to
its captured workspace, agent, permission profile, and model/endpoint identity.

Both selectors stay locked while the logical run is active or the cached SDK
Chat is submitted/streaming, including retry, approvals, step-limit pauses,
continuations and cancellation drainage. Changing chat B cannot mutate A.
Preflight blocks known incompatibility/known over-budget transfers and warns
for uncertain capabilities/context. Freeform display defaults are not verified
model context limits. Unknown image support is not bypassed by confirmation.

The estimator is not full context accounting: it does not measure image tokens
or the complete serialized tool schemas, and a configured compat limit has no
evidence that it matches the server. Older provider-specific reasoning may be
pruned by the existing request path. Preserve these caveats; do not promise
identical hidden reasoning or flawless recall across engines.

Recorded baseline verification: 879 tests in 105 files, types/build passed,
lint baseline 71 warnings and two informational diagnostics, isolated mocked
browser interaction smoke. Native/live-provider acceptance was not performed
for that checkpoint. This plan does not rerun or relabel those results.

### Network audit implications

The native proxy already checks HTTP(S), rejects URL userinfo and metadata
targets, classifies private/loopback addresses, sanitizes headers, and pins
initial resolved addresses against DNS rebinding. Tailscale's CGNAT range is
classified private. Preserve explicit private-network authorization.

Do not assume the proxy is already sufficient for discovery. Current private
redirect handling is not a complete revalidation/pinning of each destination;
ordinary response bodies are not discovery-size-bounded; DNS resolution has no
explicit probe deadline. New probes must have stricter bounded behavior and no
redirects by default. Request-ID native cancellation is a dependency for honest
in-flight accounting. These are planned fixes, not changes made in this task.

## Data Ownership and Extension Boundaries

Use one conceptual self-hosted endpoint with stable identity, an independent
friendly alias, address, backend hint/evidence, credential reference, transport
security, reachability/health, last successful probe, models, latency and
endpoint capacity recommendation. Aliases such as This PC or AI Server are not
identifiers. URLs and credentials may change without changing identity.

Reuse CustomEndpoint IDs/keyring accounts and the existing selection resolver.
Keep old `compat-<id>` and local selection IDs resolvable. Add endpoint-model
bindings only where needed for choosing several models on one self-hosted
server; do not replace ProviderId, saved OpenRouter models, cloud credentials,
or chat history storage. Do not merge endpoints solely because aliases match.
Canonicalize URL schemes/host/default port with URL APIs, but preserve proxy
path prefixes and distinguish different deployments behind the same origin.

Migration must be additive, versioned, idempotent and tested on old settings:
retain URLs, model IDs, explicit context overrides, selection references and
secrets. Do not overwrite the sole copy of legacy data during migration.
Existing default context numbers with no provenance are unverified, not
server-reported. Retain their value while making that uncertainty explicit.
Unknown fields/new profile data must not prevent an older build opening chats.

Runtime profile identity is endpoint + transport model + known instance/model
revision when exposed, not a universal profile for a model name. Conceptual
fields include theoretical context, actual configured context, working target,
output reserve, effective modalities/tool support, TTFT, tokens/sec, timeouts,
compaction/continuation policy, concurrency, and cache/server feature evidence.
Exact TypeScript/Rust field names are left to the owning checkpoint.

Every inferred/reported value records source, observation time, scope and
confidence: reported configuration, advertised capability, user assertion,
measured behavior, or conservative recommendation. Missing and zero differ.
Store recommendations separately from manual overrides. Capture an effective
profile revision for each admitted request; later tuning cannot mutate it.
An endpoint/credential edit invalidates only its evidence and adapter cache.
Renaming leaves them intact. Deletion must respect active-run pins and offer
an actionable missing-endpoint state rather than reroute an existing run.

Keep bounded metadata in existing settings persistence; durable working memory
belongs to the session. Secrets remain in the existing native secret store.
No prompt text or credentials in health telemetry. Use existing cross-window
events for settings and single-owner native request/capacity state where needed.

## Backend Handshake and Evidence

The following are documented upstream APIs inspected on the audit date, not
claims of hardware verification. Recheck the deployed version when implementing
each adapter. Generic compatibility does not prove a particular server family.
Only probe the explicitly selected endpoint, not an arbitrary address supplied
by a model or returned as a URL in metadata.

| Backend | Read-only probe strategy | Evidence limits |
| --- | --- | --- |
| Ollama | GET /api/tags for model inventory; POST /api/show with the selected model and verbose=false for advertised capabilities/details; GET /api/ps for loaded instances and context_length. | model_info context is model metadata; loaded context is instance-scoped evidence that expires when it unloads/reloads. Parameters may be defaults, not an active allocation. No model load, pull, create, or generation during handshake. [Inventory](https://docs.ollama.com/api/tags), [details](https://docs.ollama.com/api-reference/show-model-details), [loaded models](https://docs.ollama.com/api/ps). |
| LM Studio | Prefer GET /api/v1/models with configured auth; read model key/type and loaded instance config. Version-gated GET /api/v0/models fallback, then /v1/models for older compatible servers. | Distinguish max_context_length from loaded_instances config.context_length. parallel is reported instance capacity, not Clack's safe recommendation; trained_for_tool_use is not proof of parser correctness. Exclude embedding-only records from chat. [Native list](https://lmstudio.ai/docs/developer/rest/list), [v0](https://lmstudio.ai/docs/developer/rest/endpoints). |
| vLLM | GET /v1/models through the existing compatible base. Accept max_model_len only on the selected model record where present with compatible schema/backend evidence. | Upstream populates base model max_model_len from model configuration; LoRA cards may omit it. Do not generalize to every compatible server or guess parser/modality settings. Optional health/version probes require separately verified version-specific routes, not guessed paths. [Model-serving source](https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/openai/models/serving.py). |
| MLX | GET /v1/models on a configured mlx_lm.server endpoint. Preserve compatible chat transport. | Documented list supplies IDs/creation metadata, not a guaranteed configured context, tools, or live load state. Backend hint may remain user-selected; MLX format on another server does not prove mlx_lm.server. [Server contract](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md). |
| Generic compatible | GET models relative to the configured compatible API base, normally /v1/models, using its configured auth. | Validate JSON shape/status. Model IDs alone establish no context/modality/parser support. If listing is unavailable, manual model ID remains available, clearly unverified. No fake catalog or inference test just to display Connected. |

For automatic detection use a small allowlist of these probes and validated
response schemas, with the user able to choose a backend hint if ambiguous.
Do not remove a reverse-proxy prefix to try privileged root endpoints. A 401
means reachable but authentication failed; 404 may mean the optional API is
absent; 200 HTML is not a valid discovery result; 429/5xx stay structured errors.
Do not cycle through other users' keys or alternate hosts to make a probe pass.

Initial bounds to implement and test: six metadata requests per handshake,
at most two concurrently, five seconds per probe including DNS/body, twenty
seconds overall, 2 MiB decompressed per JSON response, 5,000 model records, and
1 KiB per model ID/name. Surface partial/truncated lists and manual entry.
Cache inventory for five minutes with stale-while-revalidate, single-flight
requests and explicit Refresh. Probe instance context before an affected run
when older than 30 seconds; invalidate after reload/mismatch/resource errors.
Use on-demand refresh, not permanent polling of idle endpoints. Failed refresh
does not erase useful cache but cannot silently renew its truth/freshness.

Advertised model support must be intersected with the selected API adapter's
payload support and endpoint configuration. Unknown parser support remains
unknown. Optional synthetic, no-side-effect capability checks require an
explicit user action and a small budget; a successful sample is evidence for
that route, not a universal reliability guarantee. Never use generated test
tool calls to execute shell/file/network actions.

Ollama's compatible API does not offer a general context-size setting. Keep
the compatible transport initially, budget below known server context, and do
not pretend a Clack slider reconfigures the engine. A future native adapter is
justified only by a separately tested payload/cancellation need; no silently
created Modelfile or server launch edits. [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility).

## Connection and Health UX

Add self-hosted server belongs in existing Models & Providers. Show a compact
endpoint row with local provider icon, alias, selected model, real status,
Refresh/Test, and a small Manage detail. Do not replace the cloud model picker.
The picker identifies both endpoint and model and uses bounded searchable
results, cached immediately; no giant flat catalog dump.

Default setup exposes endpoint, optional auth, discovered model and recommended
settings. The normal summary is AI Server / selected model / Connected, with
Optimization: Automatic, Context: Automatic, Concurrent agents: Automatic,
Auto compact: On, Auto continue: On where permitted by existing run policy.
Do not show backend configuration flags outside Advanced.

Use one small optimization selector: Automatic follows the runtime profile;
Fast favors a smaller working target/reserve and conservative concurrency;
Maximum quality uses a larger context/reserve only within supported resource
bounds. These are policies, not claims that sampling or model accuracy improves.
They never change model/provider, permissions, or manual pins automatically.

Advanced provides independently pinnable configured-context assertion, working
target, output reserve/max output, concurrent generations, load/prefill/idle
timeouts, auto-compaction, auto-continuation and continuation count. Explain
whether a field limits Clack or actually maps to a supported request option.
Automatic shows the effective recommendation and provenance; Manual persists
the user's value; Reset removes that field's pin and recomputes it. Reject
inconsistent budgets, infinities, and limits outside a confirmed server bound.
Do not let automatic tuning repeatedly fight the user's choice.

Network state must distinguish connecting, reachable, authentication failure,
queued at capacity, waiting for first output, generating, temporarily
disconnected and failed. Loading model and Processing context require real
backend phase signals; otherwise say Waiting for server or first output.
Retrospective timing is not proof of the current live phase. Show cached models
with Updating or refresh failure, not an empty list during every refresh.

Details may show alias/address, backend evidence, TLS/HTTP state, observed
latency, configured context, active/queued requests, last error and recent
speed. Never show zero tok/s as a measurement when usage is absent. Keep the
status compact, keyboard-accessible, and usable in narrow split panes, with
existing theme/background/focus behavior. No infrastructure dashboard.

## Context Budget Contract

Derive the effective request limit from current instance/server evidence,
explicit user assertion when evidence is unavailable, and applicable API/model
bounds. A theoretical maximum must never substitute for a smaller deployment
limit. Unknown deployment limits use a visibly unverified conservative policy,
not a fabricated discovered number or the old generic 128K assumption.

Proposed initial unknown-context policy is a 4,096-token planning ceiling,
capped further by any known smaller bound; it is not a guaranteed server size.
Ask for Advanced confirmation when the mandatory request cannot fit. Do not
silently issue progressively larger context probes or treat this as proof that
every unknown model supports 4K. Context errors may lower an unpinned policy,
but must not cause infinite resubmission.

One accounting path must serve normal sends, all subsequent tool steps,
continuations, subagents, compaction, and model-switch preflight:

    C = effective usable total context
    O = reserved output (including reasoning where the API counts it)
    S = current system / agent / project / plan / environment tokens
    T = serialized allowed tool schemas and framing
    M = safety margin and estimation uncertainty
    B = min(recommended conversation target, C - O - S - T - M)

Input includes rolling memory, recent messages, paired tool history, retrieved
content and actual attachment representations. Do not count raw PDF/ZIP bytes
when only derived text/manifest is sent, nor base64 characters as image tokens.
Use a documented matching tokenizer/count API when available on the same
authorized endpoint; never send content to another service for token counting.
Otherwise label estimates and use measured conservative margins; bytes/4 is
not a universal multilingual/code token guarantee. Unknown image costs remain
uncertain and may require blocking rather than a misleading green fit badge.

Illustrative arithmetic, not a default: 32,768 total - 6,144 output - 1,024
system - 1,024 tools - 1,024 margin = 23,552 conversation tokens, about 23K.
A 262K model card cannot increase this server's 32K usable context.

Start proactive compaction at 80% of B toward 60%, with hysteresis and bounded
attempts, then remeasure the actual assembled request. Tune only after evidence.
The newest user request, active requirements and unresolved tool-call/result
pairs must remain intact. Never send an over-budget request because compaction
returned something; if mandatory context alone exceeds B, explain and pause.
Respect separate input/output API caps and verify max-output request mapping
per adapter. Report attachment omissions/limits through existing detail UI.

## Structured Rolling Memory and Switching

Keep the durable UI transcript and content-addressed attachments unchanged.
Working memory is a derived, versioned per-session object referencing covered
message IDs/range/hash, source artifact IDs, policy version and token estimate.
It contains current objective, user requirements, decisions, completed work,
current files/artifacts, unresolved issues, important errors, agent/task
findings, constraints, and recent state. Keep a contiguous recent tail verbatim.

Deterministic code controls coverage, merging, provenance and validation. A
bounded model-assisted extractor may fill structured categories, but its prose
is not deterministic or guaranteed lossless. Preserve critical explicit user
constraints and source references independently; never elevate tool/retrieved
content into system instructions. Record contradictions/unresolved items rather
than inventing resolutions. Validate schema, size, coverage and source IDs.

Extract incrementally before overflow using the same permitted endpoint/model,
no tools and no hidden cloud summarizer. Split old history into bounded chunks;
do not send an already-overflowing transcript to a summarization request.
Cap extraction attempts/output/time, preserve the prior valid memory until the
new revision commits atomically, and pause with an actionable error if required
content cannot fit. Cancellation, crash, and invalid JSON leave raw history and
the previous revision intact. Capture these calls in cost/budget/health data.

Expose a small Context optimized detail with coverage, recent tail, preserved
requirements and omitted/limited material. Memory cannot claim to contain OCR,
archive entry contents, or visual understanding that Clack never processed.
Referenced bytes remain under existing GC/recovery ownership rules; derived
memory cannot delete original content or become a second transcript store.

Integrate Optimize and switch into the existing preflight, not a second picker
or direct set-model bypass. Prepare a target-sized working context at idle,
check current attachments/tools and target profile, then atomically commit the
selection plus validated derived-memory revision. Revalidate session/messages,
settings/credential generation, context and run lock after every await.
Cancel/failure leaves both selection and transcript untouched. A smaller target
does not excuse unsupported vision or orphan tool history. Use the existing
expiry/confirmation pattern; capability warnings still apply after optimization.

Future relevance retrieval is a separate checkpoint: first bounded local
keyword/metadata retrieval over this session's old message/artifact references,
with source links, stale/deleted-content checks and permission revalidation.
Keep recent tail and structured memory. No automatic cross-workspace searches,
new cloud embeddings, or vector database dependency in initial compaction.

## Request Lifecycle, Continuation and Recovery

### Native lifecycle before scheduling

Extend the native proxy with scoped request identities, explicit cancellation,
bounded state cleanup and deadline classification. Frontend abort must cancel
the actual pending/streaming HTTP operation, not only stop painting bytes.
Handle cancellation before headers, during DNS/load/prefill, mid-chunk, and
after finish. Remove listeners/timers and settle once; late events cannot revive
a cancelled generation or release another request's capacity token.

A closed client socket cannot prove every remote backend immediately stops
GPU work. Record cancellation as confirmed client transport termination, use
backend acknowledgement where available, and report uncertain remote drainage.
Back off admission after unconfirmed cancellation/resource errors; do not claim
Clack controls the server globally. Verify cancellation on real engines.

Initial bounded defaults to validate: connect including DNS 10 seconds;
explicitly reported load allowance 180 seconds; first meaningful output 120
seconds; stream idle 60 seconds; overall request safety ceiling 10 minutes.
Manual finite overrides and passive recommendations may adjust them within
documented caps. A backend with no phase signals has one waiting-first-output
deadline, not fabricated load/prefill clocks. Heartbeats are not text progress;
separate wire liveness from generation progress and bound whitespace loops.
Queue wait is not prefill and consumes no request timeout or tool step.

### Finish-aware output continuation

Normal stop completes normally. A verified length limit may continue with a
bounded, internal instruction to resume exactly at the prior end. Missing
finish/DONE, disconnect, content-filter/refusal, tool-calls and cancellation
are not normal length finishes. Normalize backend finish semantics explicitly.

Start with at most three output continuations per visible answer, additionally
bounded by total time/tokens and the existing logical run budget. Tool-step
continuations retain their existing permission policy and ceilings; output
continuation cannot reset those counters or grant autonomous tool privileges.
Record segment provenance/usage once and render one logical assistant answer;
do not add synthetic user messages to the saved transcript. Persist enough
segment mapping to reconstruct the same answer after restart.

Stitch only confirmed overlapping suffix/prefix boundaries within a bounded
window; preserve Unicode, code fences, lists and repeated intentional content.
Avoid fuzzy global deduplication that deletes legitimate text. Ambiguous joins
remain explicit segments or pause; never silently corrupt code to look smooth.

Incomplete tool JSON never executes. Keep call IDs, arguments and completion
state separate from visible prose. Permit at most one bounded repair attempt
for an incomplete call, with no execution during repair; validate against the
same schema and the current allowed tools. Reuse original permissions/approval
flow. A changed argument after approval requires reapproval. Keep completed
tool IDs/results immutable; neither stitching nor repair may replay side
effects. Unknown execution outcome must pause for reconciliation, not retry.

### Network recovery

Keep structured provider errors and distinguish zero meaningful output from
partial generation and from executed tools. Before-output transport failure
may use the existing two-retry budget with backoff/Retry-After and an overall
ceiling. Do not multiply SDK and application retry budgets. Even before text,
verify no tool side effect or unresolved request is outstanding.

After partial output, persist the partial response and error; do not silently
restart the original prompt. A validated backend resume protocol may be used;
otherwise expose Retry/Continue from partial with truthful limitations and
fresh preflight. Never claim exact deterministic resumption. Server restart,
auth failure, unavailable model and genuine terminal errors need distinct
actions. Retrying is shown only while an actual bounded retry is scheduled.

Offline does not erase a run or its transcript. Keep captured identity and
partial output, bounded recovery, Stop, and Retry. Restart reconciliation must
not blindly replay generation or writes. Endpoint fallback is absent until
the explicit privacy checkpoint below is implemented.

## Endpoint Capacity and Calibration

Inference admission is distinct from a logical agent being active. Reuse
PeerTask dependency/queue/recovery semantics and integrate one endpoint admission
service below both streamText and generateText paths. No duplicate task ledger.
Inventory any additional generation consumers before implementation so helpers,
subagents and compaction cannot bypass capacity. Single-owner admission must
cover relevant windows in one Clack instance, not independent React counters.

Apply a shared endpoint capacity ceiling across models on the same deployment,
plus a lower model/instance recommendation if appropriate. Default to one
concurrent generation until useful evidence/user configuration supports more.
Multi-GPU does not automatically imply one slot per GPU. Preserve existing
PeerTask/global caps in addition to capacity, not instead of them.

Acquire immediately before a provider attempt; release only on actual transport
completion/cancel acknowledgement, with conservative handling of uncertain
remote work. Release while waiting for tool approval, executing local tools,
or awaiting a child; reacquire for the next model step. A parent waiting on a
same-endpoint subagent must never retain the only inference slot. No inference
slot while waiting for a workspace write lease. Existing write leases retain
their correctness rules; test lock ordering, not ad hoc lease release.

Use deterministic FIFO with bounded fairness, cancellable queue entries, and
no head-of-line blocking across endpoints. Deduplicate admission by run/attempt
identity. The ready PeerTask may remain queued with AI Server at capacity;
it must not occupy a global running-task slot merely while waiting for local
inference capacity. Already-running tasks paused between steps retain their
logical status. Other endpoints and cloud work obey existing global limits
but do not acquire the busy local endpoint's capacity.

Clack can limit its own traffic, not other applications or another Clack
process. Observe server overload and back off; do not promise global server
scheduling. If two configured URLs are aliases for the same bottleneck, offer
an explicit shared-capacity grouping; do not merge credentials or trust based
on DNS/IP alone. Preserve endpoint identity across IP changes.

Passive observations include queue delay separately from TTFT, load/first-token
delay, output tokens/sec when usage is available, duration, context/stream
errors, resource/OOM-like failures and validated tool-call outcomes. Store a
bounded rolling window (initially last 100 samples or seven days per profile),
not transcript/headers. Backend changes expire comparisons.

Recommendations change between requests with hysteresis: initially require
five comparable successes, change concurrency by at most one, and cap numeric
adjustments to 10% per tuning interval. Severe resource errors can immediately
reduce an automatic admission recommendation, never a manual pin. Manual
overload produces a warning, not a hidden override. Do not increase concurrency
without concurrent evidence or explicit calibration; serial speed alone does
not establish headroom. Learn small context/timeout corrections gradually.

Optional Optimize for this server uses only synthetic non-secret prompts, no
tools, explicit consent, progress and cancellation. Proposed first-run cap:
three requests, 4,096 total input and 512 output tokens, 60 seconds of client
wall time, no model downloads. It may yield insufficient evidence on a slow
server; keep conservative recommendations rather than run a long benchmark.
Manual pins are never changed. Show Auto-tuned from recent usage only when
there are actual observations behind the recommendation.

## Efficiency and Watchdogs

Preserve current stable system assembly and Anthropic cache breakpoints.
Backend prompt/prefix/KV reuse is an optimization, not a correctness contract.
Avoid changing stable memory/system ordering unnecessarily; never remove fresh
workspace context or share private prompt caches across endpoints to improve
hit rates. Usage-reported cache hits are evidence; compatibility alone is not.

Detect or document server optimizations such as FP8 KV, speculative decoding,
reasoning/tool parsers and max-model-len only where exposed/version-verified.
Do not assume a model-name flag describes deployed settings. Clack may suggest
operator documentation but must not execute administration commands or edit
arbitrary launch configurations. vLLM exposes compatible inference but its
API-key coverage is not a security perimeter for every management route;
never assume an API key alone makes public exposure safe. [vLLM server docs](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/).

Task-aware tool exposure must intersect existing permission/agent/plan-mode
allowlists. Start from explicit agent role/task metadata, not an unreliable
classifier that drops required tools mid-call. Investigators get read/search,
reviewers appropriate read/diff, coders permitted editing/run tools. Preserve
required tool-result pairing and disallow omitted tools server-side too.
Tool schema changes trigger budgeting again. No weaker policy for local models.

A compact prompt variant is allowed only after semantic parity tests for all
critical safety/permission/approval/workspace rules. Make it reversible and
fall back to the original if parity cannot be demonstrated. Do not silently
strip user instructions to meet a budget.

Extend existing three-identical-tool-failure detection with bounded repeated
paragraph, whitespace/no-progress, and continuation-loop checks. Specify/test
thresholds and false-positive cases, especially generated repetitive code and
tables. Watchdogs cancel through the native lifecycle, retain partial output,
give a structured reason, and do not restart the run. Existing step/token/time
ceilings always apply even when pattern detection finds nothing.

## Security, Discovery and Optional Fallback

Only explicitly configured endpoints may receive prompts or authentication.
Plain HTTP on a user-trusted LAN is allowed with visible transport status;
prefer HTTPS/auth and VPN/Tailscale for untrusted remote links. Do not disable
certificate validation, open firewall ports, start listeners, or encourage
unauthenticated public Ollama/vLLM. A localhost/LAN URL can itself proxy to
cloud inference; label reported routing and avoid promising data stays local
without evidence. Endpoint selection is the user's trust decision.

Metadata is untrusted data: bound size/time, escape text, do not follow returned
URLs, execute templates, fetch logos, or import server instructions. Preserve
the secret-path denylist, native workspace validation and credential store.
No credentials in URLs, logs, profile JSON, chat history or diagnostic copies.
Do not grant private-network access globally to cloud adapters. All redirect
hops, if later supported, require fresh DNS/address validation/pinning and an
explicit credential-origin policy; reject metadata IPs even with private opt-in.

Optional Find servers on my network is a later, separate user-invoked action.
Prefer supported local service advertisements or user-supplied candidates; no
subnet-wide scan by default and no assumption that engines advertise services.
Show interface/range/method and bounds before a deliberate scan is ever added.
Require explicit selection and normal handshake for each result. Do not send
saved credentials during discovery. Manual endpoint entry always works.

Fallback policies: Never (default), Ask me, or Automatically use configured
trusted fallback. Consent names the destination and categories of context that
will be sent, including source files, attachments, memory and artifacts. No
dynamic routing from arbitrary server metadata, agent suggestion, or cheapest
cloud model. User-configured fallback still runs full compatibility/context
preflight and preserves permission/agent/workspace snapshots.

Fallback changes destination only at a safe settled request boundary with a
recorded routing event, never by mutating an in-flight run capture. Partial
tool execution/uncertain writes block automatic fallback. Revoke consent when
destination identity/trust changes. User must be able to disable fallback per
endpoint; unconfigured offline servers offer Retry/Stop, not cloud leakage.

## Protected Systems and Non-Goals

Preserve provider architecture, static/cloud picker behavior, saved OpenRouter
models, per-chat profiles, actual in-chat switching, run pins/locks, structured
errors, approvals, Chat Only/Ask/Trusted Workspace/Full Access/Custom, budgets,
Stop, continuation policy, background sessions, todo lifecycle and Ctrl+I.

Preserve attachment processing truth and the single content-addressed pipeline:
eight attachments/message, 8 MiB/file, 1 MiB text, 20 MiB aggregate, bounded
PDF extraction, ZIP/7z inspection/selective materialization and zero nested
archive depth. Raw bytes and derived text/manifest use content references,
not transcript base64 copies. No OCR claims, no RAR inspection, no new parser
or archive dependency here. AI_ATTACHMENTS.md remains the authoritative limits
and security document. Capability discovery must not bypass those limits.

Preserve immutable artifacts/provenance, delegation/dependencies/cancellation,
aggregation/restart recovery, workspace write leases and isolated worktrees.
Do not swap PeerTasks for hidden agents. Preserve Dispatcher, AI splits and
input routing, minimize/restore, custom backgrounds, terminal, explorer,
Markdown/images, Source Control, Tauri permissions and all platform packaging,
including the Arch NVIDIA/Wayland launcher. Leave autonomous_tracker/ untouched.

Non-goals: server administrator, GPU/driver manager, universal model downloader,
automatic public exposure, provider-account rewrite, Kubernetes dashboard, or
replacement inference-engine configuration. No new dependencies merely to
write this plan. Future tokenizer/discovery dependencies require a scoped
license, binary-size, security and platform review in their own checkpoint.

## Advanced Current-State Audit

Source audit at `460465a`, not a new runtime verification. Classifications mean
ALREADY IMPLEMENTED for the named existing primitive, NEEDS EXTENSION where
that primitive does not meet the new end-to-end requirement, and NOT IMPLEMENTED
for an absent capability. A completed primitive does not imply completed
advanced intelligence. Paths below are relative to the repository root.

| Area | Classification | Inspected implementation and remaining work |
| --- | --- | --- |
| Conversation identity and transcript persistence | NEEDS EXTENSION | `src/modules/ai/lib/sessions.ts` stores session IDs, UIMessage arrays, profile and latest run in `terax-ai-sessions.json`; `store/chatStore.ts` owns session-keyed Chat/runtime maps. Existing IDs and saved messages are reusable, but no source-coverage ledger, immutable revision history, durable model-selection history or transactional memory pointer exists. LazyStore autosave alone is not a multi-record transaction. |
| Per-chat model/agent/workspace, isolated runs | ALREADY IMPLEMENTED | `sessions.ts`, `store/chatStore.ts`, `store/chatRuntime.ts` capture identity, checkout/mutation mode and environment; background sessions, Stop and approvals are session-owned. Never replace these with a global agent configuration. |
| Actual model-switch routing and locks | NEEDS EXTENSION | `store/modelSwitch.ts`, `lib/modelSwitchEligibility.ts`, `hooks/useModelSwitch.ts` already prepare/revalidate/commit idle switches, expire confirmation and preserve history. Target-sized semantic preparation and reusable context snapshots are absent. |
| B1 request accounting | ALREADY IMPLEMENTED | `lib/contextBudget.ts`, `contextBudgetProfile.ts`, `requestPreflight.ts` account for serialized requests and output reserve across the shared builder. Exact tokenizer fit is not guaranteed. Raster/native-binary cost uncertainty currently blocks final send, even with confirmed vision; future memory work must not hide this limitation or drop images. |
| Compaction | NEEDS EXTENSION | `lib/compact.ts` only elides superseded reads/old tool output in outgoing context, using B1. It does not create semantic memory, validate requirement retention, retrieve evidence or rewrite saved history. |
| Existing project instructions | NEEDS EXTENSION | `lib/transport.ts:readProjectMemory` loads CLACK.md then TERAX.md, truncates at 32,768 string units and caches for 30 seconds. Its `mtime` is cache insertion time, not a file hash or filesystem modification proof. This is instruction loading, not verified project knowledge. |
| Structured conversation memory, freshness and automatic retrieval | NOT IMPLEMENTED | No durable source-linked memory revisions, claim supersession, task-aware history index or incremental project-evidence invalidation was found in the AI runtime. Reuse transcript/artifact owners rather than creating a replacement chat database. |
| Attachment and immutable content pipeline | ALREADY IMPLEMENTED | `attachmentMessages.ts`, `attachmentStore.ts`, `peerTaskArtifacts.ts` and native processors supply hash-checked representations, PDF/archive provenance and retention/recovery. Memory references must join their retention roots; no second attachment store or new parser. |
| PeerTask identity, DAG, queue, cancellation and results | ALREADY IMPLEMENTED | `peerTasks.ts`, `peerTaskDependencies.ts`, `peerTaskCancellation.ts`, `peerTaskAggregation.ts`, `peerTaskCoordinator.ts` and `store/peerTaskStore.ts`: schema v5, explicit agents/sessions/workspace/root/parent, 3 hops, 8 tasks/root, 8 dependencies/task, 8 dependency levels, 8 running, 32 active. Stored-history target is 256 with protected active roots. |
| Peer communication and context transfer | NEEDS EXTENSION | `tools/peer.ts` exposes delegate/review/question and cancellation. Coordinator sends bounded explicit prompt, snapshotted attachments and declared prerequisite aggregates; it does not copy source history. Aggregation bounds are 8 results, 800 chars/result, 8,000 total chars and 16 artifact references. Durable in-task clarification/reply acknowledgements, automatic source wake-up and recipient-sized evidence packaging are not implemented. |
| Ephemeral subagents | ALREADY IMPLEMENTED | `agents/runSubagent.ts` is a bounded read/search helper, distinct from persistent PeerTasks. It is not a replacement collaboration runtime or durable conversation. |
| Permissions, approvals and budgets | ALREADY IMPLEMENTED | `lib/permissions.ts`, `tools/context.ts`, native workspace/secret guards and `lib/runBudget.ts` enforce existing profiles, scoped grants and finite execution. New retrieval, sharing, tool registration and execution must intersect these policies. A model or tool definition never grants authority. |
| Concurrent writes and review | NEEDS EXTENSION | `lib/workspaceWriteLease.ts`, coordinator worktree/apply paths and read-before-edit snapshots serialize shared writers or isolate local Git worktrees. Stale edits/patch bases are rejected. Semantic finding freshness and post-review invalidation need extension; the frontend lease is not proof of exclusion against external editors or other processes. WSL/non-Git retain serialized shared edits. |
| Restart and interrupted work | NEEDS EXTENSION | `sessions.ts` interrupts dead runs; PeerTask recovery validates identities, dependencies, content and worktrees before dispatch. New memory transactions, communication delivery cursors and tool versions need explicit crash reconciliation, not stream resumption. |
| Tool registry and custom creation | NEEDS EXTENSION | `tools/tools.ts` composes static filesystem/edit/search/shell/subagent/terminal/todo/managed-agent/peer tools then applies permissions. No end-user executable-tool registry, definition editor, assigned version lifecycle or MCP client was found. Rendering an SDK `dynamic-tool` part in AiChat is not custom-tool creation support. |
| Reasoning and activity display | NEEDS EXTENSION | `components/AiChat.tsx:RenderedPart` already renders SDK reasoning parts, text and tool parts; approvals expire on restart. PeerTaskFeed, status controls and inference activity labels show real work. Unified chronological provenance, raw-versus-summary discrimination and durable activity correlation need extension. |
| Functional user reasoning effort | NOT IMPLEMENTED | AI runtime has reasoning tags and pruning behavior, but no per-chat supported-effort selector/mapping. `src/modules/editor/lib/autocomplete/provider.ts` hardcodes low for selected adapters only; this is not a chat effort feature. |
| Self-hosted evidence, cancellation and capacity | ALREADY IMPLEMENTED | A1-A3 profile/probe/setup modules, D1 native `src-tauri/src/modules/net/inference/` lifecycle and E1 FIFO admission already exist. Their immutable request scope, cancellation, deadlines, capacity and B1 gates remain authoritative for all new inference. Calibration/output continuation are still pending. |
| Persisted inference preferences versus runtime support | NEEDS EXTENSION | `selfHostedProfiles.ts` already persists fields such as autoCompaction, autoContinuation and continuationCount. Persistability is not implementation: semantic compaction, output-length continuation and functional chat effort remain owned by their pending checkpoints. |
| Collaboration surfaces | NEEDS EXTENSION | Split AI panes, Dispatcher, session actions, task cards and pane-owned composers already exist. Extend those views; no giant dashboard, new task store or command-palette-first workspace workflow. Uncommitted delegation-dialog work is excluded from this audit/edit. |

Completed checkpoint identities verified in history: A1 `1884e3b`, A2
`53a67d2`, A3 `48cba84`, D1 `aa7e125`, E1 `6d7285e`, B1 `460465a`.
Preserve all six detailed implementation records. Their earlier test results
are historical; this planning task does not rerun or upgrade those claims.

## Upstream Reference Study

Read-only source study on 2026-09-19. GitHub HEADs were resolved once and the
files below read at those immutable revisions: Hermes
`00570550f37e9082676955d50f65c7d9ba846cc9`; Codex
`c9d13e8c757cd330a572e9a39e365866069aef07`. These are references, not Clack
dependencies or guarantees about installed/provider versions. Refresh evidence
in the implementing checkpoint; no upstream code was imported or executed.

| Reference inspected | Mechanism observed | Clack adaptation or rejection |
| --- | --- | --- |
| Hermes [context_compressor.py](https://github.com/NousResearch/hermes-agent/blob/00570550f37e9082676955d50f65c7d9ba846cc9/agent/context_compressor.py) | Head/tail protection, token-budgeted compression, output pruning and auxiliary summary routing. | Adopt bounded preparation and protected tail. Do not inherit an auxiliary provider choice or repeated summary-of-summary as evidence; use authorized captured routing and original-source coverage. |
| Hermes [memory_manager.py](https://github.com/NousResearch/hermes-agent/blob/00570550f37e9082676955d50f65c7d9ba846cc9/agent/memory_manager.py) | Provider lifecycle hooks, pre-compression checkpoint contract, bounded external prefetch and schema normalization. | Keep a validation/commit boundary and bounded hooks. No external memory provider or data export by default; Clack's session/project owners remain authoritative. |
| Hermes [session_search_tool.py](https://github.com/NousResearch/hermes-agent/blob/00570550f37e9082676955d50f65c7d9ba846cc9/tools/session_search_tool.py) | SQLite/FTS discovery, lineage deduplication, anchored message windows and bounded original-message returns without LLM calls. | Start with local bounded lexical/source lookup and anchored expansion. Do not copy global cross-session search permissions or require SQLite merely to match the reference. |
| Hermes [registry.py](https://github.com/NousResearch/hermes-agent/blob/00570550f37e9082676955d50f65c7d9ba846cc9/tools/registry.py) and [mcp_tool.py](https://github.com/NousResearch/hermes-agent/blob/00570550f37e9082676955d50f65c7d9ba846cc9/tools/mcp_tool.py) | Registry owns schema/handler/toolset/availability; MCP discovers configured-server tools with lifecycle handling. | Adapt one validated registration boundary. Reject arbitrary import-time execution, automatic package installation and any fail-open behavior as a sandbox substitute. MCP annotations/descriptions are untrusted. |
| Hermes [delegate_tool.py](https://github.com/NousResearch/hermes-agent/blob/00570550f37e9082676955d50f65c7d9ba846cc9/tools/delegate_tool.py) | Focused child goal/context, separate task identity, bounded child settings and summary returns. | Useful handoff separation, but Clack extends durable PeerTasks instead of adopting a second child-agent system or transferring unrestricted parent authority. |
| Hermes [reasoning_effort.py](https://github.com/NousResearch/hermes-agent/blob/00570550f37e9082676955d50f65c7d9ba846cc9/agent/reasoning_effort.py) and [reasoning_params.py](https://github.com/NousResearch/hermes-agent/blob/00570550f37e9082676955d50f65c7d9ba846cc9/agent/reasoning_params.py) | Central effort vocabulary plus transport-specific parameter policy, probes and fallback rules. | Centralize mapping, but do not copy model-name heuristics, permanent capability assumptions or silent effort clamping. Clack exposes only evidenced support and shows effective values. |
| Codex [compact.rs](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/codex-rs/core/src/compact.rs) and [context/memory.rs](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/codex-rs/core/src/context/memory.rs) | Explicit compaction lifecycle/strategy events; typed bounded memory fragments separate instructions from extraction evidence. | Adopt typed trust levels, bounded fragments and observable compaction. Do not treat provider-native/opaque compacted state as portable memory across cloud and self-hosted adapters. |
| Codex [rollout.rs](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/codex-rs/core/src/rollout.rs) | Core delegates persistence/listing to rollout ownership using thread identity and recording APIs. | Reinforces separation of durable history and derived working context. Keep Clack's sessions owner; do not import Codex rollout storage as a parallel transcript. This inspected facade alone does not establish Codex's crash guarantees. |
| Codex [tools/registry.rs](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/codex-rs/core/src/tools/registry.rs), [handlers/dynamic.rs](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/codex-rs/core/src/tools/handlers/dynamic.rs) and [app-server dynamic_tools.rs](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/codex-rs/app-server/src/dynamic_tools.rs) | Typed exposure/execution, namespaced specs, call IDs, lifecycle events and decoded external results. | Separate definition, authorization, execution and result validation. Dynamic tool plumbing is not proof that arbitrary scripts are sandboxed; Clack must enforce its own native boundary. |
| Codex [send_message.rs](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/codex-rs/core/src/tools/handlers/multi_agents_v2/send_message.rs) and [message_tool.rs](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs) | Resolved recipient identity, common messaging path and distinct queued-message versus follow-up wake semantics. | Extend PeerTask events with addressed, acknowledged delivery at safe boundaries, not arbitrary writes into another chat or unconditional wake-up. |
| Codex [reasoning_effort.rs](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/codex-rs/protocol/src/openai_models/reasoning_effort.rs) | Model-owned normalization shared by requests and configuration updates. | Use one resolver for UI choices and actual serialized run parameters; capture selected and effective effort separately. Codex aliases are not a universal API enum. |
| Codex [reasoning summary delta](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/codex-rs/app-server-protocol/schema/typescript/v2/ReasoningSummaryTextDeltaNotification.ts) and [reasoning text delta](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/codex-rs/app-server-protocol/schema/typescript/v2/ReasoningTextDeltaNotification.ts) | Distinct event shapes carry thread, turn, item and part indexes. | Normalize only provider-exposed content into distinct display types and correlate it to the owning run. No inferred hidden chain of thought. |

Licensing/dependency decision: Clack declares Apache-2.0 in package.json.
Hermes' pinned [LICENSE](https://github.com/NousResearch/hermes-agent/blob/00570550f37e9082676955d50f65c7d9ba846cc9/LICENSE)
is MIT; Codex's pinned [LICENSE](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/LICENSE)
is Apache-2.0. These top-level licenses permit consideration of reuse with
applicable attribution/notice obligations; they do not clear every bundled
asset, dependency, patent issue or external service. No copied implementation
is proposed here. Hermes' [pyproject.toml](https://github.com/NousResearch/hermes-agent/blob/00570550f37e9082676955d50f65c7d9ba846cc9/pyproject.toml)
requires Python >=3.11,<3.14 and a substantial Python dependency graph; Codex's
[Cargo workspace](https://github.com/openai/codex/blob/c9d13e8c757cd330a572e9a39e365866069aef07/codex-rs/Cargo.toml)
contains many internal crates and shared Tokio/Serde/HTTP dependencies. Neither
runtime is a drop-in dependency for Clack's thin Tauri/AI SDK architecture.
Any later copied file or new MCP/sandbox/index package needs a version-pinned
transitive license, notices, security, binary-size and Windows/Linux/macOS review
in its owning checkpoint. No Python daemon, Codex server, embedding service or
new package is authorized by this plan.

## Advanced Ownership and Integrity

The durable conversation is the primary record; a model sees a bounded derived
view. Long-lived conversations must survive many model/agent changes, multiple
days, restarts and project edits. Retaining long durable history does not mean
unlimited model context, unbounded RAM or guaranteed recall.

| Entity | Owner and stable key | Required revision/provenance and boundary |
| --- | --- | --- |
| Conversation and original transcript | Existing sessions store, `sessionId` | Ordered message IDs and part/tool-call IDs; monotonic transcript revision. Preserve original text, tool inputs/results and attachment references. If a user edits/regenerates a branch, preserve referenced prior revisions rather than silently retargeting a source ID. |
| Selection and run history | Existing session profile/run ownership | Add bounded indexed selection/run events with agent, model selection, actual route, effort and workspace/checkout IDs; credentials never serialized. Current SessionMeta.run alone is not a full run-history ledger. |
| Conversation memory revision | Session-owned derived metadata | Version, revision ID, predecessor, source coverage/digests, claims, contradictions, producer run/model, policy version, size and validation outcome. Independent of currently selected model. |
| Working context snapshot | Derived session/task preparation | References memory/source revisions, protected tail, retrieval set, target profile/capabilities/output reserve/tools/policy/workspace evidence. A cache, never a new transcript. |
| Project knowledge | Canonical environment-aware workspace ID | Verified claims/requirements with source revisions, promotion authorization, visibility scope and supersession. Checkout-specific evidence includes checkout/base SHA; equal folder names and Local/WSL identities never merge. |
| Agent/task working context | Existing session run plus PeerTask/root ID | Bounded mission, authorized evidence and dependency versions; not another agent's private chat or global mutable persona memory. |
| Collaboration communication | Existing PeerTask ledger | Task event ID, reply-to, source/target session and agent, root/parent, workspace, policy revision, payload references, sequence and delivery acknowledgement. Models provide intent; runtime supplies authenticated routing identities. |
| Attachments/artifacts | Existing content-addressed store | Immutable hash/size/representation and original provenance, with memory/task references added to retention accounting. Missing originals stay explicitly unavailable. |
| Custom tool | Scoped registry metadata, not a second run engine | Stable tool ID, immutable version/content hash, schemas, execution kind, assigned scopes/agents, authorization revision and credential references. Runs capture versions; calls/results stay in existing run history. |

C1a must first prove a durable transaction mechanism within existing session
ownership. Add validated immutable derived records and a committed manifest
pointer with expected transcript/profile revision; use native atomic storage
if LazyStore cannot guarantee compare-and-swap across windows/crashes. Do not
assume several `set()` calls are atomic. A prepare record is never the active
revision until content, references and checksum validate and commit is durable.
Serialize commits per owner; late async work checks owner, generation, abort
state and expected revision before publication. Recover the last valid pointer
or expose corruption; do not silently accept partial memory. No whole-store
replacement or migration that overwrites the only legacy transcript copy.

Indexes are rebuildable and bounded/pageable; originals remain under existing
session retention/deletion policy. Memory GC roots retain referenced messages,
artifact representations and task-result evidence. PeerTask terminal-record
compaction must not strand a still-live memory reference: retain a referenced
result or its immutable evidence snapshot with provenance before ledger pruning.
User deletion/revocation invalidates dependent memory/indexes; retention is not
permission to undo deletion or promote private data. Quota/full-disk failures
preserve originals and block new derived commits with actionable status.

## Conversation Memory and Compaction

C1 is deliberately two checkpoints: C1a owns persistence/integrity and source
identity; C1b owns semantic extraction and automatic use. Neither owns project
sharing, retrieval, model-switch UI, agent messaging or custom tools.

Structured memory fields include objective, explicit user requirements,
constraints, architecture decisions, relevant files/components/interfaces,
completed work, current task state, pending work, unresolved errors, important
tool results, attachment/artifact refs, agent findings/reviews, uncertainties,
open questions, contradictions and recent state. Every important claim has
source IDs/ranges and source digests, scope, observed time and a typed status:
user requirement, verified observation, agent/model inference, unresolved,
superseded or stale. Preserve who asserted a claim and what verified it.
An agent saying tests passed is an assertion until tied to the actual test
result. Citations alone are not proof of semantic correctness.

Do not merge instructions, tool text and model interpretation into a single
authoritative paragraph. User requirements retain exact quoted source spans
where meaning is fragile (negation, numeric limits, filenames, prohibitions).
Only an explicit later user instruction can supersede a user requirement;
code drift or another agent's opinion cannot. Conflicting evidence remains
linked and unresolved until reconciled or explicitly escalated.

The protected set is assembled before optional summarization: latest user
instructions, active task/acceptance constraints, applicable architecture and
project requirements, unresolved failures/questions, necessary source refs and
a recent verbatim tail with complete tool-call/result groups. Tail selection
is token-budgeted and extends boundaries to avoid orphan calls. An unresolved
tool call or approval cannot be summarized away. Keep active tool schema and
exact approved arguments. If the protected set plus system/tools/output reserve
cannot fit B1, pause before HTTP with an honest reason. Never drop requirements,
attachments or permissions silently to make the request pass.

Automatic algorithm, all bounds provisional until checkpoint tests:

1. Before each next request, use B1 on assembled context. Prepare proactively
   when history reaches 70% of the available working-history budget or the
   expected next tool result would overflow; target at most 55% for headroom.
   These are initial policy thresholds, not replacements for final wire checks.
2. Select uncovered original message spans, not merely the prior summary.
   Carry forward verified claim IDs unchanged; re-read their original evidence
   when reconciling contradictions or regenerating a size-specific view.
   Coverage is a set of original ranges/digests with explicit gaps, not a
   misleading single high-water mark. Never mark truncated sources fully read.
3. Chunk only at valid message/tool boundaries. Each extraction request fits
   B1 on the authorized captured route, has no tools, and uses D1/E1. Initial
   preparation cap: 4 chunks, one validation retry total, 120 seconds wall time
   and 4,096 aggregate generated tokens, further reduced by target limits and
   the remaining logical run budget. No per-chunk reset of the cap.
4. Validate schema, source existence/hash/scope, requirement coverage, artifact
   references, supersession graph, contradiction preservation and B1 size.
   Untrusted text cannot modify policy or create tools. A schema-valid summary
   can still be wrong: deterministic checks and Q1 evidence probes are needed.
5. Commit a new revision transactionally against the captured source revision;
   expose the retained/summarized/omitted coverage and actual cost. Raw history
   and prior valid revision remain intact on failure, cancellation or restart.
6. Use memory plus recent original tail and, once G1 ships, retrieved originals.
   Retry at most within the preparation cap; if a huge legacy conversation
   needs more work, checkpoint coverage and offer a bounded next preparation
   batch. Do not secretly run hundreds of summary calls or send 239K to a 32K
   target. Routine fitting conversations require no manual message selection.

Large memory is paged by claim/source relevance; retained durable records do
not all enter every prompt. Never recursively compress the sole semantic copy.
Periodic quality checks regenerate selected claims from originals, not endless
summary rewording. Compaction is lossy; original recovery, honest coverage gaps
and measured task continuation quality are the product contract.

## Project Memory and Freshness

M1 establishes workspace ownership and promotion security before M2 shares
knowledge. Conversation memory remains private by default, project memory is
explicitly scoped shared knowledge, and agent/task memory is a temporary view.
CLACK.md/TERAX.md remain user-maintained project instructions, not files an
automatic extractor may rewrite to publish memory.

Promotable project records include architecture, verified interfaces and file
ownership, conventions, known bugs, completed milestones, test state and
user-approved requirements/decisions. Promotion must record specific claim and
evidence refs, sharing scope, author/agent, verifier, policy revision and consent.
Default is preview and authorization; a user may grant a bounded workspace
policy for verified findings, not blanket access to all private conversations.
Do not promote secrets, hidden reasoning, personal chat context or unsupported
agent assertions. Recipients receive only authorized evidence slices, never a
source-session browsing grant. A cross-workspace promotion is separately
authorized or refused; renaming/moving a folder cannot implicitly create one.
Users can inspect sources, correct, revoke or supersede a record. Corrections
create revisions; they do not falsify old evidence.

Freshness is a dependency problem, not a repository-wide reread on every turn:

- Index claim -> source dependencies: workspace/checkout/path, content hash,
  source span, Git base where relevant, artifact/task-result revision and test
  environment. Watcher/Git/tool-write events mark possible staleness; hashes
  of the relevant current content establish change. Mtime, filename and clean
  Git status alone are insufficient, including for untracked files.
- At use, reauthorize and compare relevant evidence with the correct checkout.
  Coalesce events and hash only the affected/dependency closure; after restart
  or missed events, lazily revalidate before trusting a claim. For non-Git use
  canonical paths plus content hashes. Deleted/renamed sources get explicit
  invalidation or validated relocation, not automatic filename matching.
- If a file/decision changes, preserve old evidence as historical, invalidate
  derived summaries/review/test claims, retrieve current content and produce a
  replacement or contradiction. Hash equality proves content identity, not
  that a test still applies to a changed dependency or environment.
- Another agent's edit updates only its actual checkout until reviewed/applied.
  A review carries reviewed hashes/base; after overlapping change, its approval
  is stale and must be refreshed. Existing leases, read-before-edit checks and
  explicit patch apply stay authoritative; project memory cannot authorize a
  stale overwrite or call an unmerged worktree change current main state.
- Bound invalidation batches and inference; unresolved external edits surface
  uncertainty and block unsafe mutation. Never overwrite an explicit user
  constraint because a summary or current file disagrees.

## Automatic Evidence Retrieval

G1a retrieves from the owning conversation and its authorized immutable
artifacts. G1b adds authorized project documents/current files, promoted project
knowledge, related PeerTask results and other agents' explicitly shared evidence
after M1/M2. No arbitrary private chat search, hidden cloud embeddings or new
vector database. First use source-ID lookup plus local lexical/metadata ranking;
indexes accelerate access but are not authoritative evidence.

Trigger retrieval automatically for uncovered history, missing citations,
stale/conflicting claims, references to earlier decisions/files, unresolved
task dependencies, a model's bounded request for detail, or failed context
sufficiency checks. Do not require the user to say 'read the old messages'.
Sufficiency is an imperfect heuristic, not a proof of understanding; an agent
can ask for a bounded expansion, and uncertain conclusions must stay qualified.

Filter authorization, workspace/checkout, session/task relation and secret
policy before ranking and again before reading/delivery. Rank exact source
refs, task/file relevance, verified current evidence and original user
requirements above generic semantic similarity. A recent summary is not better
evidence than the cited original. Search requests and excerpts are untrusted
data, never higher-priority instructions.

Initial hard limits: two retrieval/expansion rounds per preparation, at most
12 evidence chunks, 64 KiB decoded excerpt bytes and 10 seconds local work;
the smaller B1 remaining budget always wins. Preserve context around negations,
file revisions and complete tool groups. Deduplicate by content hash plus
source identity, record ranking reason, range, omitted counts and stale state.
Cache only with policy/source revisions; changing permission invalidates hits.
If evidence is missing, corrupted, deleted, unauthorized or cannot fit, return
that state rather than a fabricated answer. Mandatory evidence absence blocks
unsafe continuation; optional missing evidence is visible and qualified.

Retrieval results join the same working-context builder and final B1 check.
They never append synthetic user messages to the saved transcript or duplicate
whole artifacts. View source opens the original message/result or immutable
file revision; current-file navigation is labeled separately from historical
evidence. Deleting an index loses speed, not the original record.

## Target Context Preparation

C2 extends the existing switch coordinator; no second model picker, new chat
or direct set-model bypass. Required predecessors are C1a/C1b, G1a, M1/M2 and
G1b so an apparently fitting stale summary does not become the switch contract.

For a roughly 239K-token conversation moving to a smaller self-hosted model:
resolve the target's actual context/output/tools/modalities and effort policy;
capture conversation/profile/policy/workspace/source revisions; load validated
memory and relevant current evidence; reconcile important stale facts; build a
target-sized snapshot with protected instructions and recent paired history;
recheck B1, capabilities and run locks; then commit selection and context pointer
atomically. Preparation inference uses an already authorized route with its
own B1/D1/E1 checks; choosing a target is not consent for an unrelated cloud
summarizer. Any required transfer consent precedes target inference.

Reuse validated snapshots only when conversation revision/coverage, referenced
artifact hashes, memory revision, project evidence, policy/permissions, tool
versions, target model/deployment/configuration, effort/output reserve and
capabilities still match. Snapshot reuse is application-derived context reuse,
not a promise of portable KV cache, prompt-cache hits or hidden reasoning.
Changed metadata invalidates the affected view; untouched source extraction
can remain reusable if independently valid.

Before R2 and T1-T3 exist, C2 captures the current provider-default effort and
static permitted-tool schema fingerprint. Those later checkpoints extend the
same versioned snapshot key and rerun C2's invalidation tests; C2 must not
invent future controls or depend on an unimplemented custom-tool registry.

User flow: choose model in either existing selector -> 'Preparing this
conversation for Qwen...' -> switch when safe, or 'Optimize and switch' if
cost/privacy/unknown-capability confirmation is required. Advanced details show
retained requirements, summarized ranges, retrieved sources, omissions, output
reserve, estimated cost and nontransferable provider state. Routine preparation
is automatic; never require selecting 100 old messages by hand.

Cancellation, endpoint failure, missing evidence, unsupported modalities,
stale async completion or inability to fit leave the old selection, committed
memory pointer, task, transcript and attachment ownership unchanged. Candidate
records are uncommitted and recoverable/collectable, not partially active.
Revalidate after every await and immediately before durable commit; rollback
must restore the matching selection/context pair after restart. Actual next
adapter request, not the label alone, proves success. Unknown image accounting
remains a B1 blocker until separately supported and tested.

## Peer Communication and Handoffs

H1/H2 extend PeerTask schema/events, coordinator, permission checks and existing
queue. They do not introduce a second mailbox service, scheduler or agent run
engine. Independent conversations retain their own model, context and policy.

Supported intents: question, delegation, review request, clarification request
and reply, finding/artifact return, blocked status, completion notification and
authorized follow-up work. Every interaction carries runtime-verified source
and target agents/sessions, workspace, task/event ID, parent/root, reply-to,
context/artifact refs and authorization revision. Routing by display name alone
is forbidden. A task reply is attached to its owner, not injected as an unrelated
message in the currently visible conversation.

Task-specific handoff contains exact mission and acceptance criteria, relevant
user requirements/constraints, necessary architecture and files, authorized
attachments, prior findings with evidence status, prerequisite results, immutable
artifacts, source-linked memory and explicit missing/uncertain information.
Intersect sender's transfer authorization with recipient's read/tool/workspace
policy. No source transcript dump, credentials, private unrelated context or
hidden reasoning. An artifact reference is not blanket permission to browse
its originating chat. Delegation to another endpoint must respect data-transfer
policy and disclose the destination, including local-to-cloud changes.

H2 packages for recipient model/context, actual capabilities, allowed tools,
task type, output reserve, current project revisions and B1 budget. A cloud
Coder can send a small local Reviewer a precise requirement, immutable diff,
reviewed base and relevant evidence, with authorized retrieval/clarification
for omitted detail. No invented vision conversion or implicit archive expansion.

Communication lifecycle within the task ledger:

1. Validate intent, relation, payload, policy and finite root budget; persist
   an event with an idempotency key before dispatch. A completion notification
   does not by itself authorize another billed run.
2. If recipient is busy, queue for its next safe settled boundary. Never mutate
   active provider input or interrupt unrelated work. A waiting clarification
   must not reserve an E1 slot. Existing write leases cannot be casually dropped;
   a source holding a conflicting lease may answer a read-only clarification
   at a safe boundary, otherwise report blocked instead of deadlocking.
3. Clarification references the exact task, question and needed source/revision.
   Route to the source/coordinator or authorized evidence owner. Initial limit:
   two clarification round trips/task, four/root and 10 minutes unattended wait,
   all within existing task/run ceilings; count inference and follow-up work.
   Persist the deadline across restarts. Repeated no-progress questions block
   visibly; user escalation occurs when authority/evidence cannot resolve them.
4. Deliver each event once to the logical recipient using a durable receipt and
   payload digest. Distinguish queued, delivered, acknowledged and answered;
   acknowledgement is not task completion. Validate reply-to/owner/version
   before resuming the waiting task with fresh context and permissions.
5. Results and review artifacts update the existing durable result/aggregate
   path. Source notification and permitted continuation are visible and bounded.
   Dependency failures block downstream only; independent siblings continue.
   Existing cycle/hop/root/global limits also govern new follow-up edges.

Persist causal ordering and dedupe before continuation. Crash between receipt
and a tool effect leaves an ambiguous execution record requiring reconciliation,
not replay. Exactly-once external shell/API effects cannot be guaranteed. On
restart, dead runs remain interrupted/failed under current recovery rules;
pending communication is revalidated before a new explicitly authorized run.
Missing/deleted source/target, changed agent/model, revoked permission, offline
endpoint or missing artifact creates a durable actionable state, not rerouting
to a similar-looking chat. Cancelled/terminal task transitions win late replies.

H2 also enforces review freshness using M2. Shared edits keep workspace leases;
parallel local Git edits keep isolated worktrees and explicit review/apply.
Detect changed reviewed hashes, dirty/stale patch bases and overlapping edits.
Do not merge semantic conflicts automatically. Programmatic follow-up may ask
for correction; applying returned changes still uses the established approval
and native patch checks.

## Reasoning Activity and Effort

R1 extends existing message/tool/PeerTask/status views with a chronological
activity projection, not another execution log that competes with those owners.
Correlate session, agent/model, run, attempt, tool call, PeerTask/event and file
revision. Persist necessary event refs through existing owners and derive the
view; show ordering uncertainty honestly if a provider gives no timestamps.

Four separate content kinds are mandatory: provider-exposed displayable
reasoning, provider-supplied reasoning summary, normal assistant progress text,
and runtime/tool events. Hidden chain of thought is never reconstructed,
fabricated, requested for UI completeness or labeled as available when absent.
Do not parse arbitrary assistant prose into 'reasoning'. Opaque provider state
is not displayed or transferred as portable knowledge.

Compact expandable groups show objective/current progress, tool calls and
results, reads/searches/edits/commands, files, delegation/messages/dependencies,
approval state, actual retry attempts, recoverable/final failures and completion.
Source links and redacted effective parameters are inspectable. Sanitize secrets
before persistence/display/export; tool output remains untrusted even when
rendered beside reasoning. No full-prompt diagnostic logging. Preserve Clack
theme, custom backgrounds, blur, density, keyboard/focus and pane ownership.

R2 owns functional effort, separately from reasoning visibility. Default
Automatic preserves the provider/model's evidenced default without inventing
an effort value. Offer Low/Medium/High or other levels only when the exact
model, deployed API and installed adapter support them. Unknown support is
honestly unavailable; unsupported models have no decorative selector. A display
reasoning toggle cannot promise deeper inference.

One pure capability resolver returns supported levels, selected/effective
value, request mapping and evidence revision. Store idle choices per conversation
and model selection, capture them in immutable runs and keep controls locked
through retries/approvals/continuations/cancel drainage. Chat B cannot alter A.
On model change, revalidate a saved choice; never silently send an unsupported
level or claim that a label took effect. Do not mutate an active run's request.

Provider adapters own wire translation: Responses reasoning object versus
Chat Completions reasoning_effort, or an explicitly supported provider-specific
thinking budget/level. These are mapping candidates to verify against the
installed SDK and official contract, not universally supported fields. Self-hosted
thinking/effort requires route/deployment evidence, not a model-name substring.
No extra field is sent to strict APIs by guesswork. Intercept actual requests
for every supported mapping; show selected and effective parameters in Advanced.

Reasoning tokens may consume output/context without visible text. R2 feeds
actual output limits and evidenced reasoning reservations into B1, reports
unknown accounting, and uses E1/D1 for latency/capacity. Effort changes invalidate
prepared context if reserves change. Do not count reasoning twice or assume
high effort has a universal token multiplier. Usage-only hidden token counts
are metrics, not displayable reasoning content.

## Custom Tools and Security

T1/T2/T3 add user-created tools through visible agent/settings controls while
reusing the existing tool builder, permissions, approvals, run budgets,
execution history and native OS boundary. Skills/instructions are prompt
material, not executable tools and never permission grants.

Definition: stable ID/name/description, version/hash, bounded input/output JSON
schemas, execution kind, explicit executable/argument or API/MCP binding,
workspace/environment scope, allowed agents/conversations, required filesystem,
shell/network privileges, credential references, timeout/output limits and
enabled state. Reject reserved/built-in name collisions, recursive/unbounded
schemas, remote schema references, huge descriptions, unknown execution kinds
and hidden defaults that broaden access. JSON parsing/schema validation uses
structured libraries already present where suitable, not eval or string-built
shell commands. Output is bounded, validated and labeled untrusted.

Normal lifecycle: create draft -> validate -> review exact definition/permissions
-> authorize scoped registration -> safe test -> enable/assign -> execute through
the ordinary approval/runtime path. Test is a real potentially effectful run:
preview exact inputs and boundaries, require appropriate approval, and never
claim a dry-run for a script/API that cannot provide one. User can edit as a new
version, disable, remove, inspect calls/errors and restore after restart without
modifying Clack internals. No automatic package downloads or server startup.

Agents may propose definitions and test inputs but cannot authorize, enable,
assign broader scopes, install dependencies or elevate permissions themselves.
Registration approval and invocation approval are distinct. UI labels clearly
separate a proposal, validated definition, authorized registration and successful
test. Scope is explicit agent/conversation/workspace or separately user-approved
global availability; global availability never means global filesystem/network
authority. Defaults select the current agent and conversation/workspace only.

Security intersection on every call: definition grants, assigned agent/session,
captured workspace/checkout, current revocations, existing permission profile,
native workspace/secret policy, OS/Tauri capabilities and execution-kind limits.
Full Access skips eligible Clack prompts, not platform restrictions or tool
scope. Sender permissions never override recipient policy. Registry/schema/MCP
descriptions are untrusted data; instructions inside results cannot enable tools.

T2 initially supports declarative calls composed from existing guarded native
operations and explicitly configured bounded HTTP bindings where those guards
are sufficient. Generic local functions/scripts and local MCP servers cannot
be confined by a JSON permission declaration or a cwd alone: their child process
can read files and make network calls outside Clack's wrappers. T3 must provide
and verify an appropriate OS sandbox/process-tree/egress boundary on each
supported platform before enabling those execution kinds. If unavailable, show
unsupported/blocked, including in Full Access; never silently launch an
unconfined script. Remote MCP/API services also cannot be claimed to share the
local sandbox: consent names the external destination and transmitted data.

Native execution uses explicit argv/stdin, no argument interpolation into shell
source; explicit workspace-root/path validation including symlinks, minimal
environment, keyring-scoped secret injection, bounded time/output/process tree,
cancellation and egress restrictions. Filesystem mutations retain write leases,
read-before-edit and review/apply requirements. MCP sampling/elicitation, if
supported later, cannot bypass inference admission, provider consent or user
approval; unsupported requests are refused. Disabling/removing/revoking a tool
blocks new calls immediately; in-flight cancellation is attempted with truthful
unknown-effect reporting. Frozen run versions do not override revocation.

Active runs capture immutable tool definitions and schemas. Edits cannot change
already-approved arguments or executable bytes; changed bytes/hash require new
review. Old version metadata remains for history even after removal, but is
not executable by default. Restart never replays a completed or ambiguous tool
effect. Pending approvals expire under existing rules. Registry persistence
stores no raw credentials or automatically executed startup hooks. Chat links
to versioned proposals/results instead of becoming the executable registry.

F1 chooses task-relevant schemas only after assignment and permission filtering,
including custom tools. Keep the required active/unresolved tools and result
pairing, plus a bounded authorized discovery path for newly relevant tools.
Omission from the prompt is not authorization; executor rechecks the same
allowlist. Recompute B1 when schema versions/exposure change. No proliferation
of tools just because a large model can accept them.

## Integrated UX and Resource Policy

Normal workspace actions remain visible through the workspace chip, breadcrumb
and explorer folder context menu. The command palette is a backup/power-user
route. This program does not repurpose it as the primary workspace UI.

Use existing split panes, Dispatcher, chat headers, task cards and delegation
entry points. Actions include 'Ask another agent', 'Send for review' and a
scoped Tools entry. States include 'Waiting for Reviewer', 'Reviewer requested
more information', 'Coder received Reviewer's findings' and 'Changes ready for
review'. Show real agent names plus model/workspace when needed for ambiguity.
Inspect who owns work, transferred context/artifacts, approvals, dependency or
clarification waits, results, affected files and patch review without a new
dashboard. Context details show sources/coverage; effort uses supported options;
tools show version/scope/test status. Keep normal workflows automatic and
advanced details optional. Visible controls must do real work.

Bound dialogs to viewport with stable header/footer and independently scrolling
body; long names, JSON and paths wrap or scroll in their own region. No nested
floating cards or horizontal page overflow. Validate narrow split panes, 320px
viewport, 200% zoom, keyboard-only focus, screen-reader labels, backgrounds and
blur. Do not overwrite the unrelated delegation-dialog working-tree edits.

All extraction, repair, switch preparation, agent clarifications and tool-driven
inference share B1 accounting, E1 native admission and D1 cancellation/deadlines.
No inference permit while waiting for a human, tool, write lease or child.
Respect existing logical PeerTask/run ceilings in addition to endpoint slots.
E1 currently marks a dispatched PeerTask running even if its HTTP attempt waits
for capacity; do not present queued native inference as a new durable task state
or silently rewrite E1 semantics. Lock-order tests must cover capacity-one
parent/child/clarification and shared-write combinations.

Optimize by incremental coverage, hash-validated evidence caches, coalesced
project invalidation, source-ID retrieval before lexical expansion, deduplicated
artifacts and stable prompt sections. Avoid repeated transcript serialization,
full-repo scans, per-pane polling and every-turn summary calls. Measure cold and
warm preparation, bytes read/hashed, estimate/actual tokens, summary calls,
retrieval hits/misses, queue time and invalidation counts with redacted metadata.
Initial resource bounds in this plan are testable caps, not performance claims.
No optimization may change provider destination, drop protected context, weaken
permissions or rely on a provider cache for correctness.

## Advanced Recovery Contract

| Interruption | Recovery invariant and owning checkpoint |
| --- | --- |
| During transcript/memory persistence | C1a/C1b recover committed original revision and last valid memory; incomplete candidate stays inactive. Verify fault injection before and after each durable write. |
| During switch preparation/commit | C2 restores matching selection/context pair or old pair, never half a switch; stale async preparation cannot publish into another session/workspace. |
| During project promotion/invalidation | M1/M2 recheck authorization and source digests; pending proposal is not shared, unverifiable record is stale, correction never silently replaces user intent. |
| During queued/busy/clarifying PeerTask | H1/H2 replay no model stream; reconcile events/receipts/dependencies and expired waits before dispatch. Deleted identities/artifacts block with retained provenance. |
| After command/API may have executed | T2/T3 and existing runtime preserve call/effect IDs and partial result; unknown effect requires reconciliation, not an automatic retry or exactly-once claim. |
| During tool proposal, test, update or revoke | T1-T3 restore immutable versions and committed authorizations; no startup execution, no approval resurrection and no silent re-enable. |
| Workspace/model/agent changes while work is pending | Captured identity remains authoritative. Revalidate pending operations at safe boundaries; current visible pane cannot redirect another conversation's work. |
| Window close, disconnect or process crash | D1/D3 and existing sessions/PeerTask recovery retain partial output, stop client work and mark dead runs interrupted/failed. No claim that a dead provider stream resumed or remote GPU work certainly stopped. |

## Checkpoint Order and Gates

Checkpoint letters preserve the requested domains; execution order moves D1
and E1 forward because reliable native cancellation and shared admission must
precede automatic memory/continuation calls that consume GPU capacity. A is
split into small additive commits. Advanced pin semantics begin with profiles,
not a last-minute UI retrofit. G items are optional at runtime, but tracked
roadmap deliverables, not silently excluded from completion.

2026-09-19 ordering revision: C1 is an umbrella with two separately committed
gates so storage integrity precedes automatic lossy extraction. G1 moves from
late polish to the context-critical path and splits into same-conversation and
authorized-project retrieval. M1 establishes security/ownership before M2
shared knowledge and G1b retrieval. C2 follows these so small-target preparation
can recover original/current evidence rather than merely fit a stale summary.
H1/H2 build collaboration on those owners. R1 and R2 separate truthful activity
from functional effort. T1/T2 separate definition/consent and guarded execution;
T3a/T3b/T3c separate confinement, scripts/functions and MCP. F1 follows tool
versions/effort so efficiency cannot
invalidate their safety/accounting. Original D2/D3/E2/F2/G2/G3 obligations remain;
U1 and Q1 add integrated UX and quality gates before final Z hardware acceptance.
This order does not authorize any pending implementation in this planning task.

| Order | Checkpoint | Scope | Status | Commit / evidence |
| --- | --- | --- | --- | --- |
| 1 | A1 | Endpoint/profile identity, evidence and override persistence | Complete | `feat(ai): add self-hosted endpoint profiles`; [implementation record](#a1-implementation-record) |
| 2 | A2 | Bounded authenticated backend handshakes | Complete | `feat(ai): probe self-hosted inference endpoints`; [implementation record](#a2-implementation-record) |
| 3 | A3 | Add-server UX, endpoint-model bindings, capability routing | Complete | `feat(ai): add self-hosted server setup`; [implementation record](#a3-implementation-record) |
| 4 | D1 | Native cancellation, request lifecycle, truthful timed states | Complete | `fix(ai): harden inference request lifecycle`; [implementation record](#d1-implementation-record) |
| 5 | E1 | Shared inference admission and PeerTask integration | Complete | `feat(ai): add endpoint inference capacity`; [implementation record](#e1-implementation-record) |
| 6 | B1 | Actual context budgets and shared request preflight | Complete | `feat(ai): add shared context budget preflight`; implementation record below |
| 7 | C1a | Session source identity and transactional memory foundation | Complete | `feat(ai): add durable conversation memory foundations`; [implementation record](#c1a-implementation-record) |
| 8 | C1b | Bounded structured extraction and automatic compaction | Complete | Bounded captured-route extraction, native source validation/CAS, protected working context; implementation record below |
| 9 | G1a | Automatic same-conversation evidence retrieval | Complete | `feat(ai): retrieve original conversation evidence`; [implementation record](#g1a-implementation-record-2026-09-26) |
| 10 | M1 | Project memory ownership, promotion policy and inspection | Complete | `feat(ai): add scoped project memory ownership`; [implementation record](#m1-implementation-record-2026-09-26) |
| 11 | M2 | Verified project knowledge and incremental freshness | Complete | `feat(ai): track project evidence freshness`; [implementation record](#m2-implementation-record-2026-09-26) |
| 12 | G1b | Authorized project/task evidence retrieval | Complete | `feat(ai): retrieve scoped project and task evidence`; [implementation record](#g1b-implementation-record-2026-09-27) |
| 13 | C2 | Target-sized preparation and atomic Optimize and switch | Complete | `feat(ai): prepare context for safe model switching`; [implementation record](#c2-implementation-record-2026-09-27) |
| 14 | H1 | Durable task-scoped communication and clarification | Complete | PeerTask v6 events, atomic receipts, bounded clarification and guarded continuation; 1,437 frontend / 504 Rust tests pass |
| 15 | H2 | Recipient-aware handoffs and coordinated review | Complete | Recipient-sized PeerTask v7 handoffs, hash-bound review/correction and consent-gated promotion; 1,492 frontend tests pass |
| 16 | R1 | Truthful reasoning and chronological activity | Complete | Source-linked message activity receipts, provider distinctions and bounded timeline; 1,558 frontend tests pass; implementation record below |
| 17 | R2 | Supported effort controls and actual request mapping | Pending | None |
| 18 | T1 | Custom-tool definitions, validation and scoped authorization | Pending | None |
| 19 | T2 | Guarded tool execution, testing and lifecycle | Pending | None |
| 20 | T3a | Native confinement contract and tested platform support | Pending | None |
| 21 | T3b | Authorized confined scripts/functions | Pending | None |
| 22 | T3c | Explicit scoped MCP connections and tools | Pending | None |
| 23 | F1 | Relevant schemas, compact prompt parity and cache awareness | Pending | None |
| 24 | D2 | Length continuation, stitching and tool repair safety | Pending | None |
| 25 | D3 | Partial-stream/offline recovery | Pending | None |
| 26 | E2 | Passive calibration and optional bounded optimization | Pending | None |
| 27 | F2 | Watchdogs, compact health UX and advanced polish | Pending | None |
| 28 | U1 | Integrated collaboration/context/tool UX polish | Pending | None |
| 29 | G2 | Explicit optional network discovery | Pending | None |
| 30 | G3 | Consent-bound fallback routing | Pending | None |
| 31 | Q1 | Context fidelity, freshness and collaboration quality suite | Pending | None |
| 32 | Z | Integrated native/hardware validation and documentation | Pending | None |

### A1: Profiles and migration

Own the additions in config/selection helpers, settings persistence and keyring
reference plumbing. Define evidence and per-field Automatic/Manual overrides,
stable endpoint-model references and safe old-selection resolution. No probes
or adaptive runtime. Acceptance: repeat migration twice without duplicates,
lost keys or changed cloud selections; two aliases/models remain distinct;
rename/key rotation preserves identity; pins survive restart. Test malformed,
partial and legacy settings plus cross-window updates. Rollback leaves old
fields/readers usable and ignores additive profile metadata.

### A1 implementation record

Commit: the checkpoint commit containing this record, titled
`feat(ai): add self-hosted endpoint profiles`, directly after planning commit
`aba24d2`. This title identifies the commit without a self-referential hash.

Design and actual scope:

- Store version 1 metadata in the existing `terax-settings.json` under
  `selfHostedInference`. Keep every legacy key, ProviderId, saved cloud/OpenRouter
  model, chat profile and current transport reader unchanged.
- Endpoints have generated stable IDs for new records, independent aliases,
  canonical HTTP(S) URLs with proxy paths preserved, optional backend hints,
  existing credential references, timestamps, metadata/configuration revisions
  and optional deletion tombstones. HTTPS is unverified, not a health/TLS claim.
- Reuse existing CustomEndpoint IDs and `compat-<id>` bindings. The three local
  singleton sources get deterministic `legacy:ollama`, `legacy:lmstudio` and
  `legacy:mlx` IDs and retain their original local selection IDs. The oldest
  compatible singleton retains its own selection and provider credential reference.
- Profile identity is the JSON tuple of endpoint ID, transport model ID and
  optional deployed instance/revision ID. Aliases, address edits and credential
  references are not identity. Old profiles survive changes to a legacy model.
- Evidence records metric, value, source, nullable observation time, confidence,
  and endpoint/model/deployment/configuration-revision scope. A1 creates no
  discovered, measured or invented backend evidence. Zero/false differ from absent.
- Recommendations and manual pins are separate per-field maps. A manual pin
  wins; Reset deletes only that pin. Supported fields cover context, output,
  concurrency, phase timeouts, compaction and continuation policy. Their runtime
  behavior is NOT wired in A1. Configuration edits mark prior recommendations
  stale without deleting them or overriding user pins; alias edits do not.
- Migration is additive and snapshot-based. It imports configured local URLs
  and models, compatible endpoints and explicit positive context limits. Legacy
  context is an unverified user assertion with unknown observation time. Existing
  settings edits reconcile into this metadata without replacing newer pins or
  aliases. Repeating migration after JSON reload produces the identical state.
- Only credential references enter the new records. No keyring reads, key copies,
  inference requests, HTTP probes or new dependencies/permissions are introduced.
  URL userinfo/query/fragment and invalid URLs are rejected. Malformed legacy
  values remain untouched; corrupt/future new records are not overwritten on load.
- Metadata deletion retains endpoint tombstones and profiles and returns an actionable
  missing result, never a fallback provider. The deletion helper rejects supplied
  active-run endpoint references; existing captured transport objects are unchanged.
  New profile editing/deletion UI and runtime consumers belong to A3 and later,
  not this foundation. Existing settings and runtime continue using legacy readers.
- Native snapshot/compare-and-swap commands use the same plugin store, one lock
  for this metadata key, save-error rollback and an eight-attempt functional retry
  loop. Post-save preference events notify both windows; older revisions and
  speculative plugin-store writes cannot replace committed subscriber state.
  Different-field edits converge; conflicting same-field edits use commit order.
- Bounds: 256 endpoints, 2,048 profiles, 64 evidence observations per profile,
  and a 2 MiB native serialized-envelope limit. A full registry still resolves
  existing bindings; it does not remove legacy source settings.

Files: `src/modules/ai/lib/selfHostedProfiles.ts`,
`src/modules/ai/lib/selfHostedMigration.ts`,
`src/modules/ai/lib/selfHostedProfiles.test.ts`,
`src/modules/settings/selfHostedPersistence.ts`,
`src/modules/settings/selfHostedPersistence.test.ts`,
`src/modules/settings/store.ts`,
`src-tauri/src/modules/self_hosted_profiles.rs`,
`src-tauri/src/modules/mod.rs`, `src-tauri/src/lib.rs`, this ledger and the
program link in `docs/AI_MULTI_AGENT_BUILD_PLAN.md`.

Verification performed on Windows:

- Focused profile/migration/persistence tests: 58 passed in two files (44 + 14).
  Covers identity, pins/reset/restart, evidence, migrations, credential exclusion,
  old selections, deletion/captured identity, concurrent window edits, notifications,
  corruption, failure, registry bounds and JSON-expanded tuple identities.
- `npm.cmd run check-types`: passed.
- `npm.cmd run lint`: passed; baseline unchanged at 71 warnings and two infos.
- `npm.cmd test`: 937 passed in 107 files.
- `npm.cmd run build`: passed; Vite reports plugin timing information.
- `cargo fmt --check`: passed.
- `cargo clippy --all-targets --locked -- -D warnings`: passed.
- `cargo test --locked`: 251 passed (201 unit + 50 integration), including four
  new native persistence tests; no ignored tests.
- `git diff --check`: passed; staged documentation/code checked before commit.

No GUI/hardware smoke, live server handshake, inference, OS-keyring exercise,
NSIS build or Linux/macOS validation performed in A1. Cross-window/restart tests
use mocked native storage/events plus native CAS unit tests, not a claimed GUI
smoke. `autonomous_tracker/` was neither inspected nor changed nor staged.

Deviation: two small native persistence commands were necessary for an atomic
cross-webview update, instead of read-modify-write in JavaScript. They do not
change network/transport behavior. No A2 work was started.

Rollback: revert this checkpoint's code and ledger changes only. Retain the
additive metadata on disk; older builds ignore it and all original legacy values
remain available. Do not reset unrelated user work or rewrite chat history.

### A2: Safe backend handshake

Own thin native probe commands/helpers and pure result parsers, with the API
allowlist/bounds above and per-endpoint cache. No full transcript, generation,
download or scan. Acceptance: mock each engine, auth failure, 404 optional API,
HTML response, unknown metadata, mixed model types, malicious redirects/DNS,
oversized response, timeout/cancel and stale refresh. Configured context must
never be copied from theoretical context. Rollback disables probing and uses
existing manual endpoint fields; cached data does not alter older behavior.

### A2 implementation record

Implemented on Windows, 2026-09-06, after `1884e3b` (A1). Commit subject:
`feat(ai): probe self-hosted inference endpoints`. A3 is not started.

Ownership and entry points:

- Native `modules/inference_probe/` owns metadata HTTP, parsers, cancellation,
  generations and one bounded cache shared by all webviews. It accepts a saved
  A1 endpoint ID, optional explicitly selected model ID, and explicit
  `allowPrivateNetwork` (defaults false). It never accepts arbitrary request URLs,
  auth headers, probe paths or generation payloads from a caller.
- Commands: `self_hosted_probe_cache`, `self_hosted_probe`, and
  `self_hosted_probe_cancel`. The TypeScript `createSelfHostedProbeClient` exposes
  `inspect` (cached snapshot plus background refresh promise), `refresh`, and
  `cancel`. No component invokes these automatically yet; A3 owns that wiring.
- Requests use the A1 backend hint; no hint means generic compatible metadata.
  No backend-family inference from a model name or a URL returned by metadata.
  No scanning, inference, images, tools, benchmarks, loading, downloading or admin
  requests. Existing provider/model selection and chat transport are unchanged.
- Evidence uses A1's existing timestamp/source/confidence/scope schema and
  endpoint/model/deployment identities. Namespaced `probe.*` metrics keep ownership
  separate from recommendations/manual pins. Successful results update existing
  profiles and create only the explicitly selected model's profile and at most
  16 reported instance profiles, not a persisted profile per discovered model.
  Native evidence commits share A1's settings lock, validate the current endpoint
  and generation, save atomically, and emit the existing preference-change event.

Actual routes and evidence (schemas rechecked against the primary links in
[Backend Handshake and Evidence](#backend-handshake-and-evidence)):

| Backend | Routes | Evidence and limits |
| --- | --- | --- |
| Ollama | GET `api/tags`; POST `api/show` only for selected model with `verbose:false`; GET `api/ps` | Installed IDs, explicit advertised completion/vision/tool-training flags, architecture-specific theoretical context, reported loaded state and loaded context. Parameters are not deployed context. Ollama exposes no stable instance ID here; loaded context has no invented digest-based identity and expires after 30 seconds. |
| LM Studio | GET `api/v1/models`, fallback `api/v0/models`, then compatible `models` | Native model key/name/type, advertised max context and vision/tool-training flags, loaded instances with their IDs/context/parallel capacity. Embedding types have `chat:unsupported`. v0 loaded state/max context does not establish loaded context. Fallback is only on 404/405/501, never auth failure, HTML or malformed JSON. |
| vLLM | GET compatible `models` | Valid IDs/creation metadata. Only the selected record with `object:model`, an explicit vLLM hint and an actual `max_model_len` establishes reported configured context. Missing LoRA context stays unknown. No parser guess or admin probe. |
| MLX | GET compatible `models` | IDs, optional name and creation metadata. No assumed context, load state, vision or tools. |
| Generic compatible | GET compatible `models` | Valid IDs and available bounded names/creation timestamps. Listing failure preserves the selected manual ID as unverified, with no fabricated model. vLLM-shaped fields are ignored. |

Relative resolution preserves proxy prefixes. A compatible base `/proxy/v1`
uses `/proxy/v1/models`; a host-only compatible base defaults to `/v1/models`.
For native Ollama/LM routes, only a terminal compatible `/v1` is removed, then
the native suffix is appended: `/ollama/v1` becomes `/ollama/api/tags`.
A root `/api/...` is never tried to bypass a proxy prefix. Nonstandard base
paths are used as configured, not guessed through retries.

Safety and bounds:

- Six requests per handshake, two active HTTP probes globally, five seconds per
  probe including queue/DNS/body, twenty seconds for the handshake including
  credential lookup. Automatic HTTP retries and redirects are disabled.
- JSON body cap 2 MiB, including chunked/unknown-length bodies; 5,000 model records;
  1 KiB UTF-8 IDs/names; 16 loaded instances per native model; 8 MiB normalized
  evidence cap checked during parsing. Oversized responses fail explicitly.
- **Encoding policy:** request `Accept-Encoding: identity` and reject encoded
  responses instead of decompressing them. Thus compressed bombs cannot expand
  beyond the JSON limit. Gzip/brotli-only servers are intentionally unsupported by
  A2. Normal chat HTTP compression/dependencies are unchanged.
- HTTP(S) only, no URL userinfo/query/fragment/control characters, metadata names
  or addresses, including mapped IPv6 and transition-address bypasses. Private,
  loopback and CGNAT addresses require explicit opt-in. All resolved addresses
  must pass validation; exactly those addresses are pinned. No second DNS lookup,
  automatic forward proxy or credential forwarding to a redirect origin.
- Platform DNS and secret reads run in bounded blocking pools (two each). The
  waiting handshake is cancellable/time-bounded, but an OS call itself cannot
  always be forcibly interrupted. Its permit remains held until it really exits,
  preventing unbounded orphan lookups. No network request follows cancelled work.
- Credential references resolve through the existing `clack-ai` keychain account
  with the existing `terax-ai` legacy fallback. Missing referenced credentials
  fail closed, not anonymous. Only Rust sees the key; headers are sensitive,
  raw backend error bodies are discarded, and echoed literal/JSON-escaped
  credentials are rejected before metadata leaves Rust. No secret logging.
- Structured errors distinguish DNS, reachability, TLS, timeout, auth, unsupported
  route, invalid response, malformed/oversized metadata, cancellation and local
  limits/storage errors. The frontend maps them to existing AI error semantics.
  HTTP status alone is not Connected; a validated inventory is required. Even a
  credential-bearing valid response is not proof the server enforces auth or can
  successfully run inference. Optional route errors remain separately visible.

Cache and freshness:

- Inventory is a five-minute, on-demand stale-while-revalidate cache, with no idle
  polling. Ordinary concurrent refreshes join one native flight. Explicit
  `refresh(options, true)` supersedes it; endpoint/model selection changes also
  supersede the old probe. Late generations cannot persist or replace new data.
- Failed refresh retains useful prior models/evidence, marks them stale, records
  the new failure and does not advance the successful timestamp. Successful
  refresh replaces the old result. Missing optional metadata is unknown, never
  resurrected from the old result as fresh.
- Cache is in memory only: at most eight endpoint entries and 32 MiB serialized
  snapshots, with eviction; all-busy capacity returns a structured error.
  Inventory itself is not duplicated into another persistent endpoint store.
- URL, backend hint, credential reference, deletion and key rotation invalidate
  relevant cache/generations. Renaming does not. Key changes clear only owned
  probe evidence for affected references; manual overrides remain intact.
- `probeEvidenceIsFresh` requires current matching endpoint/configuration and a
  non-stale successful snapshot containing that exact observation. It applies
  30 seconds to loaded state/context/reported parallel evidence and five minutes
  to inventory/advertised evidence. Persisted evidence alone after restart is
  not fresh. B1/D1 must wire fresh-runtime requirements before affected runs;
  A2 does not change budgeting, capability routing or inference admission.
- Capability values remain supported/unsupported/unknown. Model names never
  establish capability. Advertised tool training is not effective parser proof;
  A3 must intersect model metadata with actual adapter support and permissions.

Files: five native `inference_probe` files; native module/command registration,
`net.rs` classifier visibility only, shared secret reading/invalidation,
`self_hosted_profiles.rs` invalidation/lock reuse, explicit existing Tokio feature
declarations, `selfHostedProbe.ts` and its test, and this ledger. No new dependency
package or lockfile change. No provider, PeerTask, UI, permission, terminal,
attachment or packaging change.

Verification performed on Windows:

- Focused native probe/parser/network/cache tests: **50 passed**. Includes real
  loopback HTTP fixture servers, sensitive auth header delivery, redirects to a
  second fixture origin, pinned fake-host routing, streamed response limits,
  timeouts, concurrency, request caps, partial metadata and stale generations.
- Focused frontend API/evidence/error tests: **11 passed** in one new file.
- `npm.cmd run check-types`: passed.
- `npm.cmd run lint`: passed, unchanged **71 warnings and two infos**.
- `npm.cmd test`: **948 passed in 108 files**.
- `npm.cmd run build`: passed; existing Vite plugin timing information only.
- `cargo fmt --check`: passed.
- `cargo clippy --all-targets --locked -- -D warnings`: passed.
- `cargo test --locked`: **301 passed (251 unit + 50 integration)**; none ignored.
- `git diff --check` and staged whitespace check: passed before commit.

The Windows loopback fixture initially inherited nonblocking sockets and closed
some requests too early; fixing the fixture's accepted socket mode resolved it.
Production checks were not weakened and no automatic retry was added.

Not performed: real-engine/hardware smoke, native GUI setup, real OS-keychain
credential exercise, TLS certificate deployment smoke, Linux/macOS validation,
inference, or packaging rebuilds. A3 must test actual server setup; synthetic
fixtures are not a claim of universal engine compatibility. No real endpoint
was scanned or probed. `autonomous_tracker/` remains untouched.
The pre-existing uncommitted delegation-modal work was safety-stashed separately
for A2 verification and restored after the A2 commit, not included in it.

Rollback: revert this checkpoint only. A1 and all legacy manual model/provider
fields remain valid; additive `probe.*` evidence is inert in older builds. Do
not remove credentials, profiles, chats or unrelated modal work.

### A3: Simple endpoint setup and routing

Extend existing Models & Providers and shared picker with a bounded server
flow, aliases, searched models, manual fallback and evidence-backed capability
routing. No provider-account redesign or autonomous tuning. Wire real selected
transport ID/auth, not just labels. Acceptance: add localhost/LAN/proxy-prefix
endpoint, choose two models without re-entering credentials, preserve old
selections, render loading/error/empty states and full keyboard flow. Prove
image/tool eligibility uses effective model+API evidence and still blocks
unknown vision. Mock request payloads and do a native setup smoke. Revert only
the new UI route while retaining backward-readable profiles.

### A3 implementation record

Status: Complete. Commit: the checkpoint containing this record, titled
`feat(ai): add self-hosted server setup`, directly after `53a67d2` (A2).
No D1 or later checkpoint is implemented by this commit.

Actual UI and routing:

- Settings -> Models & Providers -> Add self-hosted server -> name/address,
  optional server type/credential, explicit private-network authorization ->
  Connect -> search/check discovered models (or Manual model ID) -> Save models.
  Existing Add Provider also links to this inline flow. No separate dashboard.
- Server types: Ollama, LM Studio, vLLM, MLX and generic OpenAI-compatible.
  The selected type is labeled as such; an ambiguous backend is not presented
  as detected from its port, host or model name. Only A2 metadata routes run.
- Inventory renders at most 60 rows in a 240px scrolling area; search covers
  the bounded full A2 inventory. Several selected models save in one update.
  Manual IDs remain Unverified with metadata unavailable, not invented scores.
  Refresh retains cached inventory, including failed per-model refreshes, with
  stale/error labels. Display-only retention never changes native routing trust.
- A1 endpoint identity is reused; optional `saved` metadata on its existing
  base model profile produces a `self-hosted:<profile identity>` selection.
  No endpoint or credential is duplicated for each model. Equal model IDs on
  different endpoints remain distinct. Existing CAS persistence survives reload.
- The shared picker retains cloud/OpenRouter lists, provider icons, favorites,
  recents and the existing model-switch preflight/commit path. Self-hosted rows
  show the endpoint alias and omit fabricated cost/speed/intelligence ratings.
  Search/arrow keys/Enter/Escape remain usable with bounded popover geometry.
- Actual compatible chat requests resolve the saved endpoint URL, transport
  model ID and only its referenced credential. Reverse-proxy prefixes and the
  endpoint's private-network authorization are carried into the real adapter.
  No fallback to an unrelated global compatible key. Existing cloud routing is
  unchanged. Read-only built-in subagents inherit the captured selection.
- Existing logical-run snapshots retain endpoint/profile/configuration IDs,
  model and authorization. Required credentials/configuration are captured in
  ephemeral runtime memory, never session JSON, and released on finish/delete.
  Edits, key rotation, another chat's selection and endpoint deletion cannot
  mutate the captured request. Deletion is a missing-model state, not cloud
  fallback; between-reply switching retains chat identity/history and run locks.
- Migrated local/custom settings surface as servers without re-entry. Legacy
  selection IDs (including `compat-<id>`) still resolve. Their original fields
  and keyring entries are retained; duplicate editable legacy cards are hidden.

Capability, context and security rules:

- Fresh A2 model evidence is intersected with the existing compatible adapter.
  Vision true permits the existing normalized image payload; vision false
  blocks it; absent, expired, stale or mismatched evidence remains unknown and
  blocks image delivery. Text remains the manual compatible escape hatch,
  unless fresh evidence identifies a non-chat model. Native document/audio
  payloads are unsupported by this adapter; existing bounded text extraction
  and attachment truthfulness/security are reused, not bypassed.
- Negative tool-training evidence is unsupported. Positive training metadata
  does not certify the deployed parser; tool reliability stays unknown. There
  is no F1 tool optimization or generated capability catalog.
- Details distinguish loaded/reported server context from an advertised model
  maximum and Unknown. Loaded evidence expires after 30 seconds; inventory and
  ordinary metadata expire after five minutes. Labels expire without network
  polling. B1 budgeting is unchanged; displayed context is not a new budget.
- Settings, picker and sends read the native cache; only explicit Connect,
  Refresh or model Details performs the A2 bounded probe. No pull, load, chat
  completion, benchmark or automatic LAN discovery occurs during setup.
- Native cache reads reuse endpoint-wide inventory across saved models while
  retaining each evidence item's real scope. No per-model evidence is copied
  or invented; native single-flight, limits and private-authorization checks
  remain authoritative. Failed refresh display data cannot enable vision.
- Address/backend/private-access/credential changes invalidate configuration
  evidence; alias-only changes do not. Stale cross-window edits are rejected.
  Credentials use the existing OS keyring and profile references only. The
  password field is cleared on Connect; errors never display raw key material.
  Existing credentials are not destructively erased on metadata deletion.
- HTTP is identified as unencrypted with an HTTPS/auth recommendation for
  untrusted networks. Private access is endpoint-specific, never a global cloud
  exception or a promise that the server processes data only on this machine.

Implementation files:

- New `selfHostedModels.ts`, `selfHostedCapabilities.ts`, `selfHostedSetup.ts`
  and `useSelfHostedSnapshot.ts`; additive integration in `selfHostedProfiles`,
  `savedProviderModels`, `modelCapabilities`, `modelSwitchEligibility`,
  `providerRestore`, `keyring`, `sessions`, `agent`, `transport`, `composer`,
  `chatStore`, `chatRuntime`, `modelSwitch`, `useAiBootstrap` and `tools/subagent`.
- New `settings/components/SelfHostedServers.tsx` and `.css`; integrated into
  `ModelsSection`, `AiStatusBarControls`, `AiMiniWindow` and the unknown-score
  type in `ai/config.ts`. No global style or provider architecture replacement.
- Native changes limited to `inference_probe/cache.rs` and its regression test.
- New tests: `selfHostedModels.test.ts` (39), `selfHostedSetup.test.ts` (12),
  `store/selfHostedRouting.test.ts` (4), plus one native cache regression.
  `scripts/check-self-hosted-setup.mjs` is a repeatable isolated browser fixture.

Verification on Windows, 2026-09-07:

- Focused A3/profile/probe/model-switch/attachment suite: 199 tests, 11 files,
  passed. Full `npm.cmd test`: 1003 tests, 111 files, passed.
- `npm.cmd run check-types`, `npm.cmd run build`: passed. Build retains the
  informational Vite plugin-timing notice, not a build failure.
- `npm.cmd run lint`: passed at the unchanged 71-warning / 2-info baseline.
- `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`:
  passed. `cargo test --locked`: 302 passed (252 unit + 50 integration).
- `git diff --check` and staged diff whitespace check: passed.
- Intercepted real SDK/native-bridge requests prove cloud -> private server A
  -> server B -> cloud URL/model/auth changes with one chat and retained
  instructions/tool history. Active locks, captured credentials, deletion and
  normalized image_url routing versus unknown-vision rejection are covered.
- Browser fixture: 1500 discovered models, bounded search, multiple bindings,
  auth/private options, stale refresh, manual fallback and keyboard picker
  passed. Screenshots reviewed; 1100x950, 390x700, 320x480 and 640x320 viewport
  overflow checks passed. Browser dependencies are externally supplied through
  PLAYWRIGHT_MODULE; no runtime/package dependency was added.

Not performed / limits:

- Native GUI smoke was NOT performed. Browser fixtures are not native WebView,
  keyring or live-engine verification. No real Ollama/LM Studio/vLLM/MLX server
  was contacted; no hardware, Linux/macOS, TLS deployment or packaging smoke.
- Unproven backend/parser/capabilities remain unknown. After cache expiry or
  restart, vision requires fresh metadata; no persisted evidence is silently
  promoted to fresh. Generic/manual models are not automatically vision-capable.
- This is chat setup/routing, not a new autocomplete architecture, PeerTask
  scheduler, adaptive budget, cancellation lifecycle or automatic model loading.
  The separate delegation-modal files are intentionally not part of A3.
- Delegation-modal TSX/CSS/script remained byte-for-byte unchanged and unstaged.
  Both pre-existing safety stashes and `autonomous_tracker/` remained untouched.

Rollback: revert only A3. Retain A1/A2 profiles and legacy settings/credentials,
chat data and unrelated modal work. New saved-model references are not silently
retargeted to a different endpoint. Next checkpoint is D1 only after a new request.

### D1: Request lifecycle and timeouts

Own request IDs/cancellation/cleanup in net.rs, proxyFetch, transport and error
classification, retaining normal cloud defaults. Add load/first-token/idle
policies for opted-in self-hosted profiles. Acceptance: abort during every
phase settles once; native HTTP task actually terminates; no late output;
finite deadlines; no false loading/prefill claims; no leaked request entries.
Use fake timers and native local-server faults, including no chunks after
headers. Verify Stop and model locks throughout drainage. Rollback must never
leave an admission implementation depending on removed cancellation signals.

### D1 implementation record

Commit: the checkpoint commit containing this record, titled
`fix(ai): harden inference request lifecycle`, after A3 `48cba84`. This avoids
a self-referential commit hash. Only D1 is implemented here, not E1 or D2/D3.

Request identity and cancellation:

- Native `net/inference` owns the request registry. `ai_http_open` reserves a
  monotonically unique process-local attempt ID; `ai_http_stream` starts its
  single lease; `ai_http_cancel` signals that exact ID and waits for lease
  destruction. Reservations close the cancel-before-registration race, expire
  after 30 seconds if unused, and cannot be reused. Registry entries are scoped
  to the invoking native window, not a chat name, model ID or component mount.
- At most 128 native reservations/requests prevent unbounded registry growth.
  This is a defensive cap, NOT endpoint capacity scheduling. E1 remains pending.
- Cancellation selects against DNS waiting, HTTP send/header waiting and body
  streaming. Lease destruction removes the registry entry and acknowledges
  drainage before the single settled event. Cancel is idempotent, and stale
  IDs cannot stop newer requests. Native window destruction cancels only its
  requests; app exit/state destruction signals all remaining requests.
- Frontend `inferenceLifecycle` is an ephemeral per-attempt observable registry,
  not another persistent session ledger. It binds local/native attempt IDs to
  the captured logical session/run. Proxy handlers guard identity and stopped
  generations, ignore post-terminal events, and await both native completion
  and ordered terminal delivery before releasing controls. A missing terminal
  event after native completion becomes a transport error after five seconds.
- Stop, AbortSignal and stream-consumer cancellation send native cancellation.
  Model switching, new sends and automatic continuation remain blocked during
  drainage. Late Stop cleanup cannot overwrite a newer run. Other idle chats
  remain usable. Closing/minimizing an AI pane does not cancel background work.
- Logical runs may span multiple attempts and tools. Completed HTTP attempts
  do not remain active during local tool execution or approval waits. Read-only
  built-in subagents inherit session ownership and the tool's abort signal.
  Existing PeerTask orchestration and approval/permission semantics are retained.

Timeout policy and truthful UI:

- Self-hosted defaults: DNS/connect budget **10 seconds**, first meaningful
  output **120 seconds** from attempt start (including header wait), stream
  idle **60 seconds** from last meaningful progress, overall **600 seconds**.
  The earliest applicable deadline wins; cancellation wins a simultaneous
  ready timeout/completion race. There are no infinite waits in native HTTP.
- The generic status is Connecting, Waiting for server, Generating or Stopping,
  with captured model/endpoint labels where available. Terminal outcomes are
  completed, request cancelled, timed out, disconnected or failed. Structured
  errors distinguish connect/first-output/idle/overall timeouts, DNS, TLS,
  connection failure, disconnect, cancellation and provider rejection.
- No adapter currently proves an in-flight model-loading/prefill phase. Thus
  **no 180-second loading allowance is activated**, and no Loading model or
  Processing context claim is invented. A future evidence-backed adapter must
  explicitly add that phase/deadline, rather than infer it from elapsed time.
  A1 manual timeout pins are still metadata, not newly wired Advanced settings.
- The bounded progress observer reads SSE/JSON without changing delivered bytes.
  Text, reasoning and tool-call output count; whitespace, heartbeats, empty
  deltas and usage/role metadata do not. Inspection buffers are capped at
  256 KiB per line/event; larger unrecognized frames cannot keep an attempt
  alive indefinitely. `[DONE]` closes the client body even if the peer keeps
  its socket open. A self-hosted SSE EOF lacking a completion marker is a
  disconnect, not successful generation.
- Existing non-2xx bodies still reach SDK provider diagnostics. New native
  lifecycle failures use fixed, non-secret error codes and do not initiate
  retries or recovery. Cloud SDK adapters still using browser fetch keep
  their existing transport/timeouts/retries. Legacy native-proxy callers keep
  the ten-second connect timeout without the richer first/idle policy, plus
  the new finite ten-minute request ceiling. A2 probing/cache remains separate.

Files: new `src-tauri/src/modules/net/inference/{mod,registry,progress,tests}.rs`;
native net helper/command and app lifecycle registration; frontend
`inferenceLifecycle.ts`, `inferenceErrors.ts`, `useInferenceLifecycle.ts` and
`proxyFetch.test.ts`; scoped integration in proxyFetch, agent, transport,
chatStore/chatRuntime, composer, AiChat, model-selection lock and read-only
subagent path; `selfHostedRouting.test.ts` and this ledger. No dependency,
lockfile, Tauri permission, provider redesign, terminal or packaging change.

Verification performed on Windows:

- **26 new native lifecycle/progress tests passed.** Real loopback HTTP/TCP
  faults exercise accepted connection/no headers, headers/no body, output then
  stall, several chunks then disconnect, slow first output, ongoing progress,
  endless heartbeat/empty events, normal completion, malformed TLS, provider
  rejection and cancellation before headers/during body/after the final chunk.
  Fixtures assert native completion, registry release and client socket closure.
  Additional tests exercise resolver failure, guarded pending DNS/connect
  cancellation, deadline races, scoped reservations, caps and shutdown cleanup.
- **21 new proxy tests and five new runtime tests**, plus updated actual A3
  routing fixtures; focused transport/routing/model-switch/error/retry run:
  **75 passed in five files**. Tests cover delayed native acknowledgement and
  channel delivery, pre-dispatch cancellation, unique attempts, late events,
  per-chat isolation, Stop locks, background panes, real SDK tool/approval waits,
  cleanup, error redaction and cloud/self-hosted history/model/auth routing.
- `npm.cmd run check-types`: passed.
- `npm.cmd run lint`: passed at the existing **71 warnings and two infos**.
- `npm.cmd test`: **1,029 passed in 112 files**.
- `npm.cmd run build`: passed; existing Vite plugin timing advisory only.
- `cargo fmt --check`: passed.
- `cargo clippy --all-targets --locked -- -D warnings`: passed.
- `cargo test --locked`: **328 passed** (278 unit and 50 integration).
- `git diff --check` and staged whitespace check: passed before commit.

Limitations and protected work:

- Request cancelled means Clack's controlled HTTP task/body has terminated;
  it does **not** guarantee the remote GPU immediately stops. No backend
  cancellation acknowledgement, remote administrative call or replay is added.
- Portable OS DNS resolution cannot be forcibly killed. Initial inference
  resolver work is bounded to four OS threads holding permits until return;
  dropping the receiver stops waiting and cannot later start HTTP. These
  detached OS calls do not hold a Tokio blocking worker/shutdown hostage.
- No real Ollama, LM Studio, vLLM or MLX server/GPU, production TLS deployment,
  Tailscale/LAN installation, native GUI or OS shutdown smoke was performed.
  Local fault fixtures and existing A3 adapter tests are not hardware evidence.
  No Linux/macOS or installer build was performed for D1.
- The three unrelated delegation-modal TSX/CSS/script files remained
  byte-for-byte unchanged and unstaged. Safety stashes and autonomous_tracker/
  remained untouched. AI split panes/Dispatcher, attachments, permissions,
  budgets and existing provider diagnostics retain their original ownership.

Rollback: revert only this D1 commit before any later admission implementation
depends on its lease/settlement boundary. Do not revert A1-A3 or unrelated work.
Next is E1, only after a new explicit request.

### E1: Inference admission

Own one per-endpoint capacity service and integration at both SDK generation
boundaries, not a new task store. Extend dependency-ready queue decisions and
visible reasons without changing existing PeerTask limits. Acceptance: capacity
two admits two/queues third; separate cloud/endpoint proceeds; cancellation
removes queued work; native completion releases once; approval/child waits
release inference capacity; capacity-one parent/subagent cannot deadlock;
simultaneous split panes/windows cannot race admission. Include write-lease
ordering, restart and endpoint aliases. Revert E1 without changing task IDs or
deleting ledger entries; dependent automation must first be disabled/reverted.

### E1 Implementation Record

Complete, 2026-09-13, based on `aa7e125`. Commit title:
`feat(ai): add endpoint inference capacity`. This record is included in that
commit; use the title and E1-only diff as its non-self-referential evidence.

**Ownership and bounds**

- One native `AdmissionState` belongs to D1's managed `InferenceState`, shared
  by all webviews in this Clack process. No React queue, second PeerTask ledger,
  background scheduler task, persistent slot ownership, or cross-process claim.
- At most 128 registered entries, also subject to D1's existing total request
  bound. FIFO order is native registration order within each stable endpoint
  ID. Queue cancellation, dropped futures, errors and window closure remove
  entries through owned RAII guards. Duplicate acquisition cannot free the
  original owner's slot; unique D1 request IDs prevent stale release.
- Self-hosted default is one. Effective A1 `concurrentGenerations` manual pins
  win over valid, configuration-current recommendations; otherwise use one.
  All models/instances of an endpoint share that ceiling. Multiple pins (or,
  without pins, multiple recommendations) use their minimum, not their sum.
  Missing model-specific values do not negate another profile's explicit value.
- Valid capacity is an integer 1-8, consistent with the existing PeerTask
  running limit. Oversized historical values remain stored but cannot be used
  for admission. New oversized overrides/recommendations are rejected. No
  calibration or capacity-control UI was added; the A1 setting APIs are used.
- A run retains its captured configuration. Concurrent captured policies for
  the same endpoint use the lower registered ceiling until those attempts
  drain, rather than allowing one window to raise another's bound. Lowering a
  ceiling does not terminate active requests; new work waits. No live retuning.
- Alias or address changes retain the same stable pool ID. Address changes
  invalidate automatic evidence through A1; manual pins survive. Distinct
  configured IDs are not merged by URL, IP, DNS, model name or backend hint.
  Legacy provider fields use their existing `legacy:<provider>` migration ID;
  legacy custom endpoints use their custom endpoint ID.

**Attempt boundaries and generation inventory**

- `buildLanguageModel` / `buildConfiguredLanguageModel` capture admission
  metadata in the model's native fetch adapter. Every `ai_http_stream` fetch
  owns one D1 ID and one native queue entry, whether invoked by `streamText`
  or `generateText`. Native self-hosted-policy requests require admission data.
- Covered callers: normal chat transport, PeerTask `sendMessageToSession`,
  `runSubagent`, the callable editor autocomplete helper, and Source Control
  commit-message generation including its repair request. Future generation
  helpers can use the same configured builder. Direct cloud SDK adapters remain
  outside admission; no global cloud serialization or added retry loop.
- Acquire inside native transport immediately before D1's HTTP execution,
  after request preparation. D1 connect/first-output/idle/overall deadlines
  begin only there, never while waiting in the queue. Queueing does not add a
  model step, continuation or failed tool call. Existing logical limits remain.
- Release after the HTTP execution future has returned or been dropped, with
  its client/body stream gone. The permit drops before the D1 lease announces
  settlement. Stop only signals cancellation; it cannot release an active
  permit while native transport is draining. Each SDK retry is a new admitted
  fetch; no slot is retained during backoff and retry budgets are unchanged.
- Streamed tools' approval checks wait for their scoped native attempt's
  successful settlement. Local tools, human approval waits, workspace-write
  lease waits, and same-endpoint child/subagent waits hold no inference slot.
  The next model step reacquires normally. Existing write-lease ownership and
  permission checks were not changed or bypassed.

**PeerTask, presentation and recovery**

- Existing dependencies, eight running / 32 active task bounds, root/hop
  limits, dispatch claims, cancellation and aggregation remain authoritative.
  An already-dispatched PeerTask retains its durable logical `running` status
  while the transient inference snapshot reports `Queued: <server> at capacity`.
  This preserves task limits without claiming that logical running means GPU
  inference. The task card and activity surfaces use the transient status;
  the local-agent indicator reports waiting, not working, during admission.
- Chat, status pill, session list and delegation activity share D1 snapshots.
  Waiting for admission is distinct from Connecting/Waiting/Generating. Labels
  are bounded/truncated with full titles. Closing a pane leaves its background
  request owned by the native runtime; closing its webview uses D1 cleanup.
- Durable tasks not yet dispatched survive/reconcile through existing startup
  recovery and then re-enter admission. A process restart interrupts already
  started logical runs, including ones awaiting native admission, rather than
  replaying their requests. Fresh native state starts empty. No new schema.
- Admission events expose endpoint/profile identity, effective capacity,
  queue-enter/admission/attempt-start/settlement timestamps to the lifecycle
  observer. No request bodies, prompts, URLs or credentials are added to these
  observations. No performance samples are persisted and no tuning occurs.

**Evidence and verification**

- 19 new Rust tests; 45 focused native admission/lifecycle tests pass.
  Real loopback HTTP servers received five requests from distinct native window
  owners. Observed maximum simultaneous requests: exactly 1 at capacity 1,
  exactly 2 at capacity 2. Remaining requests were queued and subsequently
  completed. This exercises production `execute_admitted`, not UI counters.
- Native coverage includes FIFO, shared models, independent endpoints,
  cloud bypass, bounded/invalid admission, duplicate IDs, cancellation races,
  dropped waiters, restart, conservative conflicting policies and timestamps.
  A queued request waits longer than all fixture transport budgets and still
  succeeds once admitted. Existing first/idle/overall/provider/disconnect
  fault fixtures now run through admission and prove a successor can acquire.
- 34 new frontend tests; focused admission, lifecycle, actual routing, PeerTask,
  cancellation, aggregation, restart and write-lease selection: 194 tests in
  11 files. Actual SDK tests exercise parent streamText -> child generateText
  -> parent next step, autocomplete, same-endpoint chats, queue/run-budget
  locks, delayed native settlement before approval/tool execution, and retries.
  PeerTask presentation tests use rendered React markup, not GUI screenshots.
- Full frontend suite: 1,063 tests in 114 files. Type check, production frontend
  build, Rust formatting, strict Clippy, and working/staged whitespace checks
  pass. Lint remains at 71 warnings and two informational diagnostics. Full
  Rust suite: 347 tests (297 unit + 25 filesystem + 25 Git integration).
- Protected delegation files are byte-for-byte unchanged and unstaged:
  `PeerTaskDialog.tsx`, `PeerTaskDialog.css`, `scripts/check-delegation-dialog.mjs`.
  Safety stashes and `autonomous_tracker/` were not modified.

**Files and limitations**

Native changes are under `src-tauri/src/modules/net/inference/`: admission
core/tests plus registry, execution and lifecycle fixture integration.
Frontend changes are the AI admission resolver, profile capacity validation,
model builder, proxy/lifecycle, tool-start gate, compact activity labels and
their tests; autocomplete and Source Control pass the existing profile settings
into that shared builder. No dependency, provider protocol, packaging, terminal,
workspace permission, task persistence or attachment format changes.

This schedules only requests from this Clack process. It cannot account for
other applications or guarantee that a server stopped GPU work after client
cancellation. The hard limit is on Clack-owned in-flight HTTP attempts, not
physical GPUs. Endpoint offline/error handling remains D1/A2's responsibility;
there is no health polling, fallback, benchmark or automatic capacity increase.
Native fixtures used loopback HTTP; real inference servers, GPU drainage,
native GUI, packaging, Linux and macOS were not smoke-tested in E1.

Rollback: revert this checkpoint after disabling any future dependents. Keep
A1 profiles/pins and the existing PeerTask ledger intact; ephemeral admission
has nothing to migrate or restore. Do not revert unrelated delegation work.
Next is B1 only after a new explicit request. E2 calibration and all context/
memory/continuation checkpoints remain pending.

### B1: Shared budget preflight

Own a pure budget resolver and one fully assembled request-accounting path,
then adapt agent/subagent/switch calls to it. Include subsequent tool steps,
known API input/output caps and uncertainty. No semantic memory yet: existing
elision may help, otherwise pause when fit is not achievable. Acceptance: 262K
model on 32K server stays within 32K including output/tools; unknown stays
unverified; images/text/PDF/archive costs follow delivery; oversized mandatory
content blocks before network; pinned invalid settings rejected. Test actual
adapter max-output mapping and non-English/code estimates. Reversible runtime
integration leaves persisted profile evidence intact.

#### B1 Implementation Record (Complete)

Commit: this checkpoint, `feat(ai): add shared context budget preflight`,
following `6d7285e feat(ai): add endpoint inference capacity` on main.

**Budget contract and evidence**

- `contextBudget.ts` is the pure authority. `C` is fresh loaded/deployed context,
  otherwise an explicit configured-context pin, otherwise reliable reported
  model capacity, otherwise Clack's unverified 4096-token planning policy.
  Known smaller advertised/theoretical/reported bounds further constrain C.
  A2 advertised model maxima remain distinct from loaded/configured server
  context; a 262144-token model maximum never increases a 32768-token deployment.
- A1 per-field pins/recommendations supply working target, output reserve and
  max output. Impossible context/working/output settings fail explicitly, not
  by silently raising a server ceiling or rewriting a pin. Automatic configured
  context recommendations are not promoted to deployed evidence. Old generic
  display defaults are not reliable metadata. Manual assertions retain A1
  semantics; stale automatic recommendations do not override current scope.
- `O = max(actual serialized output limit, configured output reserve)`.
  Default output is `min(2048, max(256, floor(C * 0.15)))`; caller caps and
  valid profile max-output limits apply. A zero extra-reserve pin still gets
  meaningful output space. API output caps applied by the installed adapter
  are reflected in the final wire check. Separate input/output caps are distinct
  resolver fields; the input cap does not become a combined context limit.
- `M = max(128, ceil(0.10 * estimated input))` and
  `B = max(0, min(workingTarget, min(C - O, inputCap) - S - T - M))`.
  Without a separate input cap this is the roadmap formula. Negative available
  space blocks even an empty conversation. The conversation must fit B.

**Accounting and integration**

- All adapters built by `buildLanguageModel` receive a per-step SDK middleware
  output limit and a final serialized-JSON fetch preflight. This covers chat,
  subsequent tool steps, SDK retries, logical continuation batches, actual
  PeerTask targets and subagent `generateText`, autocomplete, and both Source
  Control commit-message generation/repair calls. No inference path uses the
  old generic `getModelContextLimit` to decide whether a request may be sent.
- Measure delivered system/agent/custom/project/mode instructions, environment
  blocks, permission-filtered tool schemas/descriptions, tool history, current
  task/prerequisite context, and text attachment representations. PDF extraction,
  archive manifests/selected entries and SVG source count as delivered text,
  not as original PDF/archive/image byte sizes. Raw saved history is unchanged.
- The deterministic text estimate uses three ASCII word characters per token,
  punctuation individually, ASCII whitespace runs at four characters per token,
  and conservative UTF-8 byte costs for non-ASCII characters. JSON/message
  framing is included, plus M. This is not a matching tokenizer or a guarantee
  of exact provider tokenization. No content is sent to a counting service.
- Existing bounded elision now uses the shared estimator and working budget.
  It preserves call/result IDs and the existing recent-tail policy. Only a
  completed newer read can supersede a previous read, and an earlier mutation
  cannot invalidate a later read. After the single existing preparation pass,
  final wire accounting still blocks overflow; no recursive shrink/retry loop.
- Model-switch assessment uses the same resolver/estimator, fresh cached A2
  evidence and actual allowed tool schemas. Its notice distinguishes estimated
  input, ceiling and working budget. Known too-small targets block; unknown
  targets retain warning/confirmation. Attachment-reference previews use
  delivered-representation byte upper bounds until materialization; this idle
  preview is not an exact serialized request or a guarantee of fit. Actual send
  always rechecks the fully materialized representation. No Optimize and switch.

**Admission, errors and limits**

- Optional A2 metadata refresh occurs before admission, with existing native
  authorization/cache/freshness rules and no generation, benchmark or model load.
  Failed metadata refresh uses only still-valid manual/reported evidence or the
  conservative unknown policy; it does not blanket-disable local inference.
- Native admitted attempts request a window/request-owned preflight verdict.
  A bounded five-second gate precedes DNS/HTTP and D1 transport deadlines.
  Revalidation compares captured endpoint configuration/model/profile/pins
  against the authoritative native settings snapshot, rereads native cached
  evidence, and reapplies the same arithmetic to the already-measured immutable
  request. No metadata HTTP or repeated text transformation holds the slot.
  Renames remain valid; changed/deleted targets or changed pins cannot send.
  Expired loaded evidence falls back and can cause refusal after queue wait.
- Refusal, missing acknowledgement, owner close and Stop release ownership
  through D1/E1 cleanup. No slot remains held while tools/approvals run. PeerTask
  dispatch propagates SDK-reported request errors instead of falsely completing.
  Provider context-overflow diagnostics remain structured and nonretryable;
  no E2 adjustment or automatic smaller-prompt resubmission is implemented.
- Multimodal limitation: no reliable image/native-binary token counter is
  implemented. These inputs are explicitly uncertain and blocked before
  inference on all adapters, even with confirmed vision support. Base64 is never
  counted as ordinary text or silently dropped. Use a text representation;
  matching local/same-destination counters remain future work. Text estimates
  and server reports can still differ from actual backend behavior.

**Verification and preservation**

- 81 new frontend tests; 1144 tests pass across 117 files. Focused budget,
  request, model-switch, attachment, PeerTask, admission and write-lease run:
  342 tests across 18 files. Actual intercepted SDK requests prove oversized
  chat/subagent/PeerTask requests make zero inference calls, fitting requests
  make one, and a grown tool step cannot send a second over-budget request.
- Installed-adapter payload assertions cover all 13 provider routes: OpenAI
  `max_output_tokens`, xAI `max_completion_tokens`, Google
  `generationConfig.maxOutputTokens`, and Anthropic/OpenRouter/compatible/
  Ollama/LM Studio/MLX/Groq/Cerebras/DeepSeek/Mistral `max_tokens`. Exactly one
  output field is present. Anthropic's installed 128000-token output cap is
  exercised against an excessive caller request before final wire accounting.
- Three new Rust tests; 48 focused native lifecycle/admission tests and 350 full
  Rust tests pass (300 unit, 25 filesystem, 25 git). Real loopback counters prove
  refusal sends zero HTTP requests and an approved successor sends exactly one.
  Wrong-window/duplicate/early verdicts, missing acknowledgements and owner
  closure fail closed. Existing E1 concurrency/queue-deadline tests still pass.
- `npm.cmd run check-types`, `npm.cmd run lint`, `npm.cmd test`,
  `npm.cmd run build`, `git diff --check`, `cargo fmt --check`,
  `cargo clippy --all-targets --locked -- -D warnings`, and
  `cargo test --locked` pass. Lint remains 71 warnings and two infos.
  Startup eager-import budget remains green. No new dependency or persistence
  schema. No real GPU/server, native GUI, packaging, Linux or macOS smoke test
  is claimed; provider mapping checks use installed adapters and fixtures.
- Delegation-modal TSX/CSS/check script, both safety stashes and
  `autonomous_tracker/` remain untouched and outside this commit.

B1 is complete. Stop here. Next is C1 only after a new explicit request:
structured rolling memory and automatic compaction. C1/C2/D2/E2 are not started.

### C1: Structured rolling memory

Umbrella only, complete only when C1a and C1b have separate verified commits.
Implement neither as part of this planning revision. Contract:
[Conversation Memory and Compaction](#conversation-memory-and-compaction).

#### C1a: Durable memory foundation

Depends on completed B1/D1/E1. Scope: additive session/message source revisions,
selection/run provenance, derived-memory schema/validation, original-coverage
references, retention roots and transactional commit/recovery. Own no automatic
summary calls, retrieval, project sharing, switch UX or agent communication.
Migration must be idempotent and preserve old transcripts and current profiles.

Acceptance: unchanged original-message hashes across migration; deterministic
source IDs; rejected cross-session/stale/missing refs; pending or corrupt
candidate never becomes active; crash before/after each write yields a valid
old or new committed revision, including two windows racing to commit. Preserve
referenced artifact/task-result evidence through GC and invalidate on explicit
deletion. Test full disk, interrupted migration, old-reader behavior, malformed
data and source branch edits. A/B/L storage assertions are the minimum gate.
Rollback disables derived reads/commits and retains additive data/originals.
Commit `feat(ai): add durable context memory revisions`, update ledger, STOP.

##### C1a implementation record

Implemented 2026-09-19, scoped to durable state, evidence and transactions.
No automatic memory generation, request-context changes or later checkpoint
implementation is included. The separately requested window-close correction
is not part of this checkpoint's commit or verification claims.

**Integration audit and ownership**

- `sessions.ts` remains the frontend session persistence boundary used by
  `chatStore.ts`, background message persistence, selection/run updates,
  attachment migration and restart recovery. Conversation identity remains the
  existing session ID; titles, panes, agents and models are not memory owners.
- The existing `terax-ai-sessions.json` file, `sessions`, `activeId` and
  `messages:<id>` keys are preserved. Original arrays, tool parts, IDs, attachment
  references, profiles and unknown legacy metadata retain their existing shape.
  There is no second chat database or transcript migration/replacement.
- Audit of tauri-plugin-store 2.4.3 found truncate-and-write saves and no public
  multi-key/CAS transaction API. Only this session file now uses a native cached
  adapter with staged, synced, atomic replacement, rather than LazyStore
  autosave. Failed writes keep the cache on the last valid old-or-new disk state. Other plugin stores are
  unchanged. The native adapter refuses malformed legacy JSON instead of
  replacing it with empty defaults. Legacy readers can still read the file.
- Native source writes and memory operations share per-session locks across
  windows. Frontend per-key queues preserve message-write order. The existing
  shared session-list key and physical session-file write have short exclusive
  ownership; unrelated memory publications do not share a global commit lock.
- Current B1 preparation/elision/preflight, captured active runs, switch locks,
  SDK messages, PeerTask scheduling/permissions and attachment processors are
  unchanged. PeerTask evidence comes from the existing task ledger, not a new
  communication store. These APIs are internal application persistence APIs,
  not new agent tools or permission grants.

**Schema and bounded records**

- Schema 1 manifests live under app-data
  `ai-conversation-memory/<sha256(sessionId)>/manifest.json`. They contain the
  session ID, monotonic transcript/profile revisions and canonical JSON hashes,
  cancellation generation, memory revision sequence, up to 128 selection/run
  observations, up to 32 committed revision hashes and an explicit deletion
  tombstone. Selection/run provenance uses allowlisted identity, actual
  provider/model/endpoint-profile revision and workspace/checkout fields;
  credentials and credential-bearing endpoint URLs are not copied.
- Each immutable `<sha256(record)>.json` revision contains schema version,
  preparation owner (`sessionId`, nullable environment-aware `workspaceId`),
  source revisions/hashes, process-generation ID, expected predecessor,
  cancellation generation, revision number, creation time, producer provenance,
  policy version, original coverage, evidence and typed claims.
- Claim sections cover objective, requirements, constraints, decisions,
  completed work, active tasks, files/artifacts, unresolved issues, errors,
  findings, project state and uncertainty. Status distinguishes user
  requirement, verified observation, inference, unresolved, superseded and
  stale. Claims carry source IDs, observation time and contradiction links;
  this checkpoint validates structure/provenance, not semantic truth.
- Bounds: 256 KiB per manifest/revision or archived evidence item, 128 evidence
  references per revision, 64 claims, 8 KiB per claim text, and 32 source or
  contradiction links per claim. Old revision metadata rolls out after 32
  committed revisions; evidence carried into a retained revision remains rooted.

**Provenance, coverage and lifecycle**

- Deterministic evidence IDs hash owner, original locator and content digest.
  Locators identify messages, exact message parts (including complete tool-call
  input/output parts), directly related PeerTask results and immutable artifacts.
  Evidence records retain their original transcript revision. Retained evidence
  can be carried forward without changing its original identity after a branch
  edit; it is never retargeted to a changed message or filesystem path.
- Coverage is a bounded half-open original-message range, range digest, latest
  covered message ID and original source message count. Appended messages remain
  uncovered. A changed/deleted covered branch is reported as `sourceChanged`,
  while archived evidence stays independently inspectable.
- Exact referenced evidence is archived in the existing hash-verified
  `ai-attachments` store. Binary attachment bytes are not copied into records.
  Attachment, PDF/archive representation and artifact roots join existing
  reconciliation. Referenced PeerTask result/artifact evidence survives ordinary
  ledger pruning; explicit source-session deletion revokes dependent memory.
- Owner/workspace mismatches, unrelated tasks, missing evidence, unsupported
  versions, invalid sizes/hashes/lineage, duplicate identities and malformed
  records fail closed. Workspace reads require the existing native workspace
  registry authorization; workspace files are represented only through existing
  captured artifacts. No arbitrary file-path resolver or project sharing exists.
- A shared collection barrier protects evidence from write through manifest
  publication. Collection also unions current native session/task roots to avoid
  using another window's stale frontend retention snapshot. Uncommitted/expired
  revision files and unreferenced content are collected through existing GC.
  Corrupt memory pauses deletion, but still validates ordinary attachments, so
  unrelated PeerTask restart recovery is not disabled by a damaged memory index.

**Transactions, restart and rollback**

- Native worker operations serialize by stable owner. Commit compares source
  revision/hashes, current owner, process generation, cancellation generation and
  predecessor, and requires the original session state to be durable first.
  Evidence is stored/validated, the immutable revision is synced, and only then
  is the manifest atomically published. Pending records are not active memory.
- Failure before manifest publication leaves the previous committed revision
  active. An interruption after publication may have committed successfully;
  callers reload to determine the durable outcome. Abort before publication
  invalidates the captured generation; an already completed atomic publication
  is not misreported as rolled back. Prior-process preparation tokens cannot
  publish after restart.
- Migration is additive and lazy/idempotent. Chats without memory remain valid.
  Recovery loads committed records or returns an explicit unavailable/corrupt
  error without overwriting originals. Existing run/PeerTask recovery still
  marks interrupted work rather than resuming dead requests.
- Rollback: disable derived memory load/source-inspection/evidence/commit command
  registration while retaining the atomic session adapter, additive source data
  and retention-root protection. Do not delete memory directories or rewrite
  original transcripts to remove this feature.

**Verification and remaining boundaries**

- New focused coverage: 52 native memory/session-file tests, one attachment-GC
  regression, and 16 frontend API/session integration-boundary tests. Native
  tests exercise real temporary files, the existing attachment collector and
  competing publisher threads. Frontend IPC/events are mocked, not native GUI.
- Focused frontend command selecting conversationMemory, sessions,
  restartRecovery, attachmentMessages, attachments, peerTaskArtifacts, peerTasks,
  contextBudget, requestPreflight, modelSwitch, chatModelSwitch and runLifecycle:
  207 tests across 12 files passed.
- Full `npm.cmd test`: 1,160 tests across 118 files passed. `npm.cmd run
  check-types`, `npm.cmd run lint`, `npm.cmd run build`, `git diff --check`,
  `cargo fmt --check` and `cargo clippy --all-targets --locked -- -D warnings`
  passed. Lint remains at the existing 71 warnings and two informational
  diagnostics. Build reports plugin-timing information. Cargo emits the existing
  environment warning about canonicalizing `C:\Users\Hayden`.
- Full `cargo test --locked`: 403 passed (353 unit, 25 filesystem integration,
  25 Git integration); no failures or ignored tests. Crash-boundary injection
  covers before/after evidence, immutable revision and manifest writes. Full-disk
  behavior is fault-injected, not an actual filled disk. A/B/L storage assertions
  include unchanged originals, ten revision cycles, 35-cycle retention,
  competing windows' backend publishers, source edits and repeated recovery.
- No native GUI close/relaunch, hardware power-loss, live-provider or separate
  application-process concurrency acceptance is claimed. Shared-window safety
  assumes one native application persistence owner; simultaneous old/new app
  binaries writing the same app-data directory are not supported. Errors remain
  available to internal callers; this foundation adds no placeholder UI.
- Source inspection is explicit, not automatic historical retrieval. Automatic
  extraction/compaction is deferred to **C1b: Bounded automatic compaction**.
- Startup compatibility follow-up: an early schema-1 source-only manifest may
  omit `revision`. The reader accepts revision zero only when its revision list
  is empty and no immutable revision files exist. Reads do not rewrite legacy
  bytes; the next ordinary atomic write persists the counter. Committed history,
  duplicate fields, invalid owners, unsupported versions and malformed records
  still fail closed. Original chat data is unchanged. Four additional native
  regressions cover this boundary; the follow-up full Rust suite passes 407
  tests (357 unit and 50 integration). No later checkpoint is implemented.
  Retrieval, project promotion/sharing, Optimize and switch, reasoning controls,
  custom tools and new agent communication remain at their later checkpoints.
  No subsequent checkpoint has been started.

#### C1b: Bounded automatic compaction

Depends on C1a. Scope: protected-set assembly, incremental original-source
extraction, typed claims/contradictions, coverage validation and automatic
working-memory use through the existing agent preparation path. All summary
calls use captured authorized identity and B1/D1/E1. No hidden cloud route.

Acceptance: A/B fixtures retain all mandatory requirements, decisions, unresolved
issues and paired recent history; transcript hashes unchanged; missing evidence
reported; source text cannot promote itself into instructions. Repeated cycles
read original uncovered spans and preserve claim/source identity. Enforce
aggregate calls/tokens/time limits and block when protected content cannot fit.
Test invalid JSON, invented citations, contradicted requirements, 239K legacy
history, Unicode, cancellation, capacity-one operation and restart. No claim of
semantic perfection from schema validation. G1 retrieval and C2 remain deferred.
Rollback returns to existing elision/preflight and keeps valid memory/history.
Commit `feat(ai): add bounded automatic context compaction`, update ledger, STOP.

#### C1b implementation record (2026-09-20)

- Baseline: `main` at `7371f7c80c601f6d93954cee3459ad51af2e50d6`;
  recovery ref `codex/c1b-safety-7371f7c` retains that committed state. The
  unrelated delegation TSX/CSS/check script remain unchanged and excluded.
  Safety stashes and `autonomous_tracker/` were not touched. This record
  supersedes the temporary partial-implementation handoff.
- Integration: `chatRuntime` captures the conversation/run owner and original
  UI messages before transport attachment/environment materialization.
  `persistCompactionSource` flushes the current raw transcript through the
  existing awaited session writer, clears its old debounce and rejects stale
  frontend sources. `awaitSessionWrites` settles metadata/message writes before
  native preparation. No derived messages are written to transcript history;
  IDs, tool relationships, attachment and PeerTask content refs stay intact.
- `conversationCompaction` joins the existing `agent.ts` SDK `prepareStep`
  path for each conversation response and subsequent tool step. Original and
  materialized message IDs must agree. System/agent/plan instructions, actual
  tool schemas, attachment expansion and live tool suffixes use existing
  provider conversion, reasoning pruning, cache breakpoints and final B1 wire
  preflight. Ephemeral non-conversation subagents keep existing elision/B1.
  Model switching, PeerTask scheduling/permissions and background-pane lifetime
  are unchanged; memory remains private to the stable session/workspace owner.
- Policy `c1b-extraction-v1` uses the newer detailed algorithm's 70% trigger
  and 55% target, rather than the older general 80%/60% guidance. B1 remains
  the only budget resolver, including output reserve and safety margin.
  Small fitting chats make no memory-read or extraction-model calls. After
  successful extraction, target convergence stops at 55% or when only fitting
  protected/recent content remains; the target never licenses dropping it.
- Protected context includes every original user/system message, selected
  attachment/data-reference message, unresolved or failed tool group and
  approval. A contiguous recent tail uses approximately 20% of B1's working
  history budget, always retaining its final group and extending across tool
  pairs. Duplicate/orphan tool identities fail closed. Current in-flight
  response/tool messages remain verbatim outside durable coverage. Oversized
  protected content blocks the next request with an actionable preflight error.
- Durable schema is unchanged C1a schema 1: immutable `MemoryRevision` with
  preparation/producer identity, revision/time, policyVersion, coverage,
  evidence and typed claims. C1b extends one gap-free original prefix `[0,end)`
  at whole message/tool boundaries. Its digest, latestMessageId and
  sourceMessageCount identify exactly the processed range; all later messages
  remain explicitly uncovered. This is the single-range subset of the roadmap
  coverage design, not a sparse high-water mark that hides unprocessed gaps.
- New native `conversation_memory_extract_sources` returns decoded original
  JSON together with native evidence IDs/digests under existing owner,
  workspace authorization, source/profile revision, generation and process
  checks. It deduplicates locators and enforces an aggregate 256 KiB read cap.
  The coordinator also compares native originals with its captured raw source
  before extraction. It never reconstructs evidence from a filename or a
  materialized attachment, or reads unrelated workspace paths.
- Extraction reads newly uncovered originals, not just the previous summary.
  User passages become exact deterministic `user-requirement` claims without
  model rewriting. Strict JSON output must cite supplied evidence with exact
  contiguous source quotes and represent every nonempty non-user source.
  Generated claims can only be `inference` or `unresolved`; contradictions link
  unchanged prior claim IDs and remain unresolved. The model cannot mark an
  assertion verified or supersede user requirements. Claim identities hash
  evidence/text/quote/section/contradictions; duplicates preserve timestamps.
- Existing claims and retained original evidence are carried forward, never
  recursively rewritten as the only semantic copy. The working view omits
  duplicate user-requirement claims because their originals remain verbatim.
  Only completed, non-conflicting claims unrelated to significant current
  request terms are optional: newest-first lexical paging gives these a 20%
  working-budget allowance. Decisions, constraints, unresolved and linked
  contradictory claims are not silently evicted. Durable records are unchanged
  by paging. No embeddings or historical retrieval are introduced.
- Per preparation batch: at most four chunks, normally up to four original
  messages per chunk (larger indivisible tool groups only when bounded), one
  validation retry total, 120 seconds and 4,096 aggregate generated tokens.
  Per-call output is at most 1,024 tokens, reduced by B1 and remaining tokens.
  Generated-token accounting takes the larger of provider usage and B1's text
  estimate. Calls use the captured authorized configured model/endpoint with
  no tools, no provider retries and no cloud fallback, through existing B1/D1/E1
  admission and cancellation. Internal calls charge the captured logical run
  before HTTP and reserve room for its response; usage joins existing counters.
  Preparation and response requests settle sequentially, avoiding a nested
  capacity-one lease. No global conversation lock was added.
- Each candidate validates coverage, exact evidence, record size and protected
  context fit before existing native C1a transactional commit. Native CAS
  rechecks source/profile/generation/previous revision and cancellation;
  reloading the committed revision must return the expected ID. Failed/stale
  candidates cannot replace the prior valid revision. Earlier valid chunks
  in a bounded legacy batch may remain committed when a later chunk fails;
  the uncovered suffix is explicit and the user can retry another bounded
  batch. A failed final B1 check sends no next response request.
- Cancellation, deadline and current-run checks surround asynchronous work;
  abort is passed to extraction and native publication, and stale adapter
  completions are unusable. Pane closure still does not cancel an independent
  background run. Restart reuses only committed native revisions; no model
  operation pretends to resume. Existing C1a atomic activation, original
  evidence CAS, reference roots, reconciliation and bounded revision retention
  remain the storage/recovery authority. No new database, raw attachment blobs
  or destructive migration were added.
- The existing malformed-memory report is covered by the prior `7371f7c`
  strict early source-only manifest compatibility fix. C1b neither edits app
  data nor broadens that exception. Corrupt, unsupported, changed-source or
  inaccessible memory blocks preparation for its owner, preserves history and
  presents a recoverable context-preflight error; other conversations remain
  independent. Unknown extraction policies require explicit migration.
- Presentation stays in the current chat: preparation activity and a compact,
  dismissible success notice report processed original coverage, retained
  originals, optional omitted completed claims and conservative token cost.
  Failed preparation never displays successful optimization. No memory
  dashboard, synthetic chat messages or fake controls were added.
- Verification: `npm.cmd exec vitest run compaction Compaction conversationMemory
  contextBudget requestPreflight chatRuntime modelSwitch attachment peerTask
  inferenceLifecycle inferenceAdmission runBudget` passes **492 tests across
  29 files**. `npm.cmd test` passes **1,268 tests across 126 files**. The five
  compaction-specific files contain **94 passing tests**; chat runtime adds
  four persistence/run-budget boundary regressions. Coverage includes A/B
  ASCII/Unicode fixtures, exact requirements/decisions/unresolved evidence,
  original immutability, repeated original-source extension, invalid JSON,
  invented quotes/citations, contradictions, aggregate bounds, cancellation,
  stale CAS, restart, unknown policy, malformed native reads/publication,
  protected attachment overflow and a roughly 239K estimated-token legacy
  fixture that checkpoints four chunks without sending an oversized request.
- Actual installed SDK/model/proxy integration exercises extraction followed
  by a two-step tool response, final preflight, captured private route,
  sequential capacity-one-shaped requests, zero response HTTP after stale
  extraction, and blocking oversized subsequent tool output. Native IPC and
  provider responses are mocked in frontend integration tests; they do not
  establish real-model semantic fidelity or a live server's behavior.
- Native `cargo test --locked conversation_memory` passes **61 tests**,
  including five new extraction source/integrity/quota/staleness regressions.
  Full `cargo test --locked` passes **412 tests** (362 unit, 25 filesystem and
  25 git integration). `cargo fmt --check` and
  `cargo clippy --all-targets --locked -- -D warnings` pass using isolated
  `$env:TEMP\clack-c1a-final-target`; no user processes were stopped.
  `npm.cmd run check-types`, `npm.cmd run lint`, `npm.cmd run build` and
  whitespace checks pass. Lint stays at **71 warnings and 2 infos**; Cargo
  retains the nonfatal home-path canonicalization warning, and Vite reports
  its plugin-timing advisory. No native GUI or live-provider smoke is claimed.
- Limits: compaction is lossy and exact citations/schema checks cannot prove
  semantic completeness. C1a's 64 claims, 128 evidence records, 256 KiB record,
  8 KiB claim and 32 retained revisions remain bounded. An indivisible source,
  exact user passage or mandatory retained record exceeding those limits
  pauses safely instead of truncating it; a larger verified context or new
  conversation may be necessary. The 239K test proves bounded partial progress,
  not unrestricted completion of arbitrarily large histories. Current tool
  suffixes are not compacted until they become persisted originals in another
  batch. Routine small histories still use the original context unchanged.
- Rollback: disconnect the conversation compactor from agent preparation to
  restore legacy elision/B1; keep original sessions and valid native memory.
  Deferred: G1 retrieval, M1/M2 project memory/sharing/freshness, C2 Optimize and
  switch, reasoning controls, custom tools and new agent communication. Next
  is **G1a: Automatic same-conversation evidence retrieval**. No subsequent
  checkpoint has been started.

### M1: Project memory ownership

Depends on C1a/C1b/G1a. Scope: canonical workspace/checkout keys, promotion
proposal/authorization schema, visibility policy, provenance, revoke/correct
actions and bounded source inspection. Reuse existing workspace/permission and
content-store owners; do not create a global private-chat index.

Acceptance: equal names/different roots and Local/WSL remain distinct; an
unauthorized private claim never reaches another chat or index result; explicit
promotion shares only selected evidence; corrected/revoked records invalidate
derived views; restart does not publish a pending proposal. Test agent/user
authority distinction, malicious citations, deleted sources and changed grants.
E/K/L scope assertions apply. Automated knowledge extraction is deferred to M2.
Rollback disables sharing, preserves private originals and promotion history.
Commit `feat(ai): add scoped project memory ownership`, update ledger, STOP.

#### M1 implementation record (2026-09-26)

- Ownership: native `conversation_memory::project` derives canonical workspace
  and checkout keys from existing persisted session profiles, WorkspaceRegistry
  authorization and PeerTask worktree provenance. Local and each WSL distro are
  distinct; labels, model, agent, chat title and pane position are not owners.
  Separate checkouts require matching task checkout/base SHA and never become
  main-checkout facts implicitly. Aliases resolving to the same authorized root
  retain identity. Missing/deleted/moved roots fail closed; no implicit relocation
  or cross-workspace transfer is implemented. Main checkout has no asserted Git
  freshness stamp; M2 owns current project-state validation.
- Privacy/authority: project metadata is separate from private C1 memory, not a
  second transcript database or a global conversation index. Native load,
  propose, decide and inspect commands bind to an existing session/workspace and
  recheck authorization; knowing a record ID is insufficient. Pending proposals
  are visible only to their source conversation. Publishing, correcting and
  revoking require an actual native user confirmation, never an agent-supplied
  approval Boolean. No agent tool or automatic context injection was added.
  Published slices are available to authorized sessions in the exact checkout;
  source-session browsing permissions are not granted. Revoked/superseded entries
  disappear from recipient views while the source owner retains history.
- Schema v1: workspace snapshot has revision, predecessor hash and at most 64
  entries. Each entry carries stable ID, workspace/checkout/base scope, category,
  bounded statement, author agent, publication status, timestamps, provenance,
  policy-stamped consent actions, optional supersedes and up to eight conflict
  IDs. Categories cover requirements, architecture, interfaces, bugs, milestones,
  constraints, findings, verification and uncertainty. Qualifications distinguish
  user requirement, tool observation, agent finding, user correction and dispute;
  unsupported assistant assertions and private reasoning cannot be proposed.
  Source status separately distinguishes verified historical evidence, changed
  evidence/scope and unavailable evidence/content. Historical integrity is not
  a claim of present project freshness or independent verification of task prose.
- Provenance: source session/workspace, exact message part or related PeerTask
  result/artifact locator, private original-value checksum, UTF-8 byte span and
  selected-slice hash. Original user text, completed tool outputs and completed
  related task summaries/immutable text artifacts are validated through existing
  C1 source resolvers and artifact hashes. Worktree metadata is rechecked before
  consent publication. Secret-path rules and conservative credential markers
  reject known unsafe sources; these are not exhaustive secret detection, so the
  native confirmation also requires review for secrets/personal context. Missing
  originals remain explicitly unavailable; there is no changed-path reread or
  fabricated citation. Original transcripts, tool relationships and blobs remain
  untouched. Only the selected slice, not adjacent private context, is shared.
- Storage: bounded 256 KiB native metadata under app-data `ai-project-memory`,
  SHA-256 workspace directory, immutable hashed revisions and atomic manifest.
  Statements/slices are at most 4 KiB each; slices reuse the existing attachment
  CAS. Current and previous revisions survive, entry history remains bounded,
  orphan revisions are cleaned, and CAS reconciliation retains only referenced
  selected evidence. Quotas fail closed and reserve consent space so capacity
  exhaustion cannot prevent approval/revocation. Unreferenced failed-write blobs
  remain collectible. No binary/base64 attachment payload is added to metadata.
- Transactions/recovery: existing per-owner native mutexes and expected-revision
  CAS serialize one project without locking unrelated projects. Immutable write
  precedes atomic pointer publication; failed/stale/cancelled consent leaves the
  current revision active. Confirmation occurs outside locks, then session/scope,
  revision and source are revalidated. Window events refresh projected views;
  stale UI responses and revision-bound inspection cannot restore old views.
  Absent stores load as empty without writes; repeated loading is idempotent and
  pending proposals never auto-publish on restart. Invalid schema, hash, consent,
  identity or predecessor fails closed for that workspace, preserving originals
  and previous files. Corruption never silently restores revoked consent; it
  pauses CAS collection rather than risking deletion of unknown retained roots.
  Recovery does not offer automatic repair or resume an interrupted approval.
- UI: a collapsed Project memory section in existing chat supports exact excerpt
  proposals, native approval, correction/revocation and bounded slice inspection.
  The picker offers the latest 128 eligible user/string-tool parts; native task,
  artifact and structured-tool provenance primitives are tested but have no new
  dedicated picker. No placeholders imply automatic extraction or retrieval.
- Compatibility: C1a/C1b, G1a's same-conversation boundary, model-switch locks,
  B1 preflight and PeerTask scheduling/cancellation/permissions remain unchanged.
  The only existing memory lifecycle change adds project CAS retention roots.
  Future authorized agent consumers can use these scoped records without copying
  histories, but still need their own permissions, task routing and B1 budget.
- Tests: 13 new frontend client tests; 26 new Rust tests, including real temporary
  workspace authorization, CAS/artifact integrity, restart storage, competing
  writers, injected write failures and quota-safe revocation. Focused frontend
  `vitest run projectMemory conversationMemory compaction retrieval modelSwitch
  attachment peerTask contextBudget`: 476 passed / 27 files. Focused native memory
  regression: 97 passed before the final quota test; final M1 group: 26 passed.
  Full `npm.cmd test`: 1,331 passed / 128 files. Final `cargo test --locked`:
  449 passed (399 library, 25 filesystem, 25 Git; other targets have zero tests).
- Gates: `npm.cmd run check-types`, `npm.cmd run lint`, `npm.cmd run build`,
  `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings` and
  `git diff --check` passed. Lint remains at 71 warnings / 2 infos; new frontend
  files lint clean. Existing Cargo user-profile canonicalization warning and
  Vite plugin-timing advisory remain. Native checks used isolated temporary
  `clack-c1a-final-target`, without terminating a user process. Native GUI/native
  dialog clicks, browser visual checks, live WSL and live-provider tests were not
  performed; automated persistence/authorization tests are not GUI verification.
- Rollback: disconnect the M1 commands/panel to disable sharing, retaining private
  originals and promotion history; keep project CAS retention until an explicit
  data-retirement policy exists. Deferred: automated extraction, semantic/project
  retrieval, project-state watchers, automatic contradiction resolution, implicit
  promotion, Optimize and switch, and agent communication. Next checkpoint is
  **M2: Project knowledge and freshness**. No subsequent checkpoint was started.

### M2: Project knowledge and freshness

Depends on M1. Scope: authorized verified project knowledge, source dependency
map, event-driven dirty marking, hash revalidation, contradiction/supersession
and incremental refresh. Do not rewrite CLACK.md/TERAX.md automatically.

Acceptance: D/H changed-file and changed-decision scenarios mark stale claims,
retrieve/reconcile current evidence and preserve explicit user constraints.
Tests cover same-mtime changed bytes, untracked/renamed/deleted files, branch and
checkout changes, test-environment dependencies, missed watcher events/restart
and another agent's unapplied worktree. Count reads/hashes to prove unchanged
unrelated files are not scanned each turn. No automatic semantic conflict merge.
Rollback disables derived shared knowledge; keep revisions/provenance and demand
fresh direct evidence when required. Commit `feat(ai): track project evidence
freshness`, update ledger, STOP.

#### M2 implementation record (2026-09-26)

- Representation: additive project snapshot schema v2, retaining M1's workspace,
  checkout, qualification, source, consent, revision and supersession ownership.
  Optional knowledge schema v1 holds declared relative file dependencies with
  canonical identity, full-content SHA-256, bounded immutable excerpt hash/span,
  test-environment role, related project-record IDs, Git root/HEAD/branch evidence,
  host OS/architecture, verifying session/time, creation revision and
  `m2-user-evidence-v1` policy. No duplicate session store or private-chat index.
  A correction clears inherited verification instead of blessing changed prose.
- Creation: an approved M1 record can be validated against explicitly selected
  current files/environment inputs and related approved records. The existing
  project-memory panel provides evidence review; native confirmation shows exactly
  the excerpt bytes to be retained/shared. Capture is deterministic and bounded,
  not an LLM repository/conversation summary. Confirmation attests to the claim
  and dependency set; hashes prove evidence identity, not semantic truth or test
  execution. Unsupported agent assertions do not acquire verified authority by
  running a hash check. M1's original claim/evidence remain intact; a user-reviewed
  replacement gets a new ID, verifier and supersedes link through the existing
  native consent/CAS path. No CLACK.md/TERAX.md editing or silent promotion.
- Freshness: explicit current, potentially-stale, invalidated, source-missing,
  needs-revalidation, conflicting and superseded states. Revalidation hashes
  declared current content, including untracked files and same-mtime edits, and
  compares canonical identity, checkout/branch, declared environment and source
  provenance. HEAD is retained as provenance; an unrelated commit on the same
  branch does not invalidate unchanged dependencies. Detached-HEAD movement and
  branch changes remain conservative invalidations. Renames/deletions do not
  retarget evidence by filename. Changed current excerpts are returned separately
  from retained historical evidence; no automatic semantic reconciliation occurs.
  User correction/review, rather than a model guess, resolves changed claims.
- Incremental behavior: existing debounced native filesystem events and explicit
  file writes mark only indexed affected dependency closures; a successful Git
  pull conservatively dirties known evidence under that checkout. Unknown watcher
  errors invalidate advisory cache state. The panel leases existing directory
  watchers while open and automatically rechecks a bounded dirty group. No idle
  repository scan, per-message file read, model call, embedding index or new watcher
  implementation. Reopening/explicit use hashes the selected dependencies even
  after missed events. A batch memoizes file reads and record-closure evaluation;
  unchanged/unrelated event refreshes do not repeatedly hash current records.
- Dependencies/conflicts: linked approved requirements and knowledge records
  propagate invalidation through a bounded graph; superseding/revoking a source
  cannot leave dependent knowledge silently current. Conflicts are symmetric,
  explicit and unresolved until an authorized user action, not overwritten or
  semantically merged. Unknown/inaccessible dependency provenance fails closed.
  Different workspaces/checkouts remain independent, including unmerged PeerTask
  worktrees. Existing write leases, task permissions, artifact identities and
  patch-apply authority are unchanged; freshness never authorizes an overwrite.
- Authorization: existing session-derived M1 access is checked before reading
  and again before publishing/delivering. Paths must be relative, contained in
  the canonical authorized checkout and pass secret-path checks at both spellings.
  Source parts, task results and artifact content retain M1's provenance checks.
  Known credential markers are rejected; token-boundary checking avoids falsely
  rejecting ordinary `task-scoped` prose. This remains conservative filtering,
  not exhaustive secret detection. Native human review is still mandatory.
  No model-facing tool or cross-conversation browsing permission was introduced.
- Persistence/recovery: schema v1 reads without mutation and upgrades only on an
  explicit atomic write. Unknown versions, invalid dependencies and malformed
  knowledge fail closed, preserving original chats and prior revisions. New
  immutable excerpts reuse the attachment CAS and join current/previous revision
  retention; orphan writes remain collectible. Freshness cache is advisory and
  process-local: restart requires revalidation, never resumes approval. Per-owner
  M1 locks/revision checks preserve failed-write rollback; monotonic cache tickets
  reject overlapping late checks, events and eviction/recreation ABA races.
  Cancelling native consent does not publish. Closing the panel discards late UI
  delivery; bounded read-only native work can finish without a durable mutation.
- Runtime limits: eight file dependencies and eight related record IDs per
  knowledge record; eight requested records per revalidation, sixteen graph
  nodes, 128 advisory cache entries. UTF-8 regular files only, 256 KiB/file and
  4 MiB actual read bytes per batch. Each distinct file is read twice to detect
  in-flight mutation; shared dependencies reuse that observation within a batch.
  Excerpts are at most 256 UTF-8 bytes from offset zero and are separately hashed.
  Existing M1 bounds remain 64 entries, 256 KiB metadata and reserved revocation
  capacity. File batches check a cooperative ten-second deadline. Git uses the
  existing process owner with two seconds per command, up to three commands per
  stamp and two stamps around a check/approval. Native user wait is outside these
  budgets; synchronous OS file I/O is not forcibly preempted by the soft deadline.
- Compatibility/scope: G1a stays same-conversation-only; C1a/C1b original history,
  model switching, B1 and PeerTask scheduling/cancellation are unchanged. M2 adds
  no outgoing model context; G1b owns authorized project/task retrieval and must
  use fresh scoped evidence plus B1. No new agent communication protocol.
- Tests on Windows: 22 new native M2 tests (plus a Unix-only symlink test not run
  on Windows), 11 new frontend tests. Native project group: 48 passed, including
  existing M1 privacy/authorization/worktree/concurrency tests. Focused frontend
  project/memory/compaction/retrieval/model-switch/attachment/PeerTask/budget group:
  487 passed / 28 files. Actual temporary filesystem and Git fixtures cover
  same-mtime changes, unchanged shared read counts, untracked/renamed sources,
  environment changes, branch movement versus unrelated commits, missing grants,
  source mutation, cyclic dependencies, stale callbacks/eviction, v1 disk loading,
  CAS retention, native-consent cancellation and injected atomic-write failure.
- Final gates passed: `npm.cmd run check-types`; `npm.cmd run lint` (unchanged
  71 warnings / 2 infos); `npm.cmd test` (1,342 tests / 129 files);
  `npm.cmd run build`; `cargo fmt --check`;
  `cargo clippy --all-targets --locked -- -D warnings`; `cargo test --locked`
  (471: 421 library + 25 filesystem + 25 Git); `git diff --check`. The isolated
  temporary Cargo target was reused without stopping user processes. Existing
  user-profile canonicalization warning and Vite plugin-timing advisory remain.
- Limitations/manual: freshness covers declared dependencies, not proof that the
  dependency set or claim is complete. Whole-file hashes conservatively invalidate
  even edits outside the retained prefix. Environment evidence is declared files
  and host identity, not automatic detection of every tool/runtime variable; tests
  are not rerun. Verification records without an environment input stay qualified.
  Missing Git, inaccessible/unborn repositories and unsupported file types fail
  closed rather than inventing currentness. Automatic UI work stops at eight
  records; other records can be checked explicitly. Native GUI/dialog interactions,
  visual layout checks, live WSL/providers and Unix symlink execution were not
  performed. They remain manual/platform verification, not inferred passes.
- Rollback: disable M2 verification/revalidation and derived freshness views;
  preserve v2 metadata, historical sources and CAS retention. A pre-M2 reader
  rejects v2 safely rather than silently dropping knowledge; do not downgrade
  records or resurrect old consent automatically. No subsequent checkpoint was
  started. Next by the authoritative ledger is **G1b: Project and task evidence**.

### C2: Optimize and switch

Depends on C1a/C1b, G1a/G1b and M1/M2. Extend the shared modelSwitch coordinator
and notice UI with [Target Context Preparation](#target-context-preparation).
Acceptance: C plus A/D shows a large conversation prepared for a smaller target
without manual history reconstruction; real next-request routing, source-aware
context and full capability gates pass. Test cache hit and invalidation for
every snapshot key, cancellation at each await, partial durable commit/restart,
unsupported images, no-fit mandatory content and stale project evidence.
Both pane/status-bar selectors stay locked through active runs and drainage.
No failed switch changes committed selection, memory, task or attachments;
transcript hashes remain unchanged. No automatic fallback/provider-cache transfer.
Rollback restores existing block/warn preflight and ignores target snapshots.
Commit `feat(ai): prepare context for safe model switching`, update ledger, STOP.

#### C2 implementation record (2026-09-27)

- Lifecycle: the existing shared model-switch coordinator captures conversation,
  selection, original messages, agent/workspace, settings, credentials and live
  context. It resolves target capabilities and B1 limits, materializes authorized
  attachments, prepares/revalidates context, then atomically commits the model
  and matching target view. Both existing selectors use the same hook and gate.
  Preparation remains lazy-loaded, shows the target and Cancel, and does not
  unlock another selector or an active/draining run. A bounded details disclosure
  reports retained user messages, memory coverage, retrieved source identities,
  omissions/qualifications, reserve, call count and unavailable monetary cost.
- Context: reuses C1b's protected-message/tool-pair planner and structured source
  extraction, G1a original evidence and G1b authorized project/task evidence with
  M2 freshness. No private-chat search, whole-project dump or new compaction
  engine. User messages, system instructions, current task/recent tail and
  required tool relationships stay protected. Deterministic fitting runs first.
  When new extraction is necessary, explicit Optimize-and-switch confirmation
  authorizes the conversation's current configured model, not an unrelated
  summarizer or implicit target transfer. Its SDK/adapter retains B1/D1/E1 and
  normal credentials; target working-context limits are checked independently.
- Durable representation: additive optional SessionMeta `modelRevision` and
  `targetContext` in the existing atomic session file. Snapshot schema 1 contains
  modelId, SHA-256 key, sourceCount/sourceHash, memoryId, optional validated C1
  Revision and integrity hash. The Revision retains original evidence locators,
  claims, coverage and source/target selection provenance. One current target
  snapshot per conversation, at most 256 KiB, never a duplicate transcript or
  attachment payload. Conversation memory's committed revision remains untouched.
  Staged C1 validation has a non-retaining mode; no new revision/evidence blobs
  or GC roots are created. Original transcript/attachment/PeerTask owners retain
  content as before; missing or changed evidence fails closed without path fallback.
  Session deletion naturally removes the embedded target view.
- Transactions: native begin/preview/commit/load/cancel commands reuse existing
  session/workspace authorization, per-session locks and atomic SessionFile.
  Commit compares captured session metadata, source preparation/generation,
  previous memory revision, persisted settings and the issued idle preparation
  receipt. Model and snapshot are replaced together. Failure before replacement
  preserves the old pair; a write error after successful replacement recognizes
  the committed pair rather than claiming rollback. Ordinary stale session saves
  cannot erase/forge the revision or snapshot. Monotonic native events and commit
  responses converge other windows without older responses reverting new state.
  Original message keys and attachment ownership are not rewritten.
- Cancellation/recovery: disposable frontend preparation and D1 cancellation
  invalidate the issued native receipt. Native receipts are per conversation,
  superseded by a newer preparation, bounded to 128 live entries and expire in
  180 seconds. Review expires after 30 seconds. Restart drops all candidates and
  loads only the old or new atomic committed pair; it never resumes extraction.
  Corrupt/unsupported snapshots or changed evidence cannot become trusted context.
  Existing sessions with no target fields need no migration or eager rewrite.
- Reuse: the actual next agent request recomputes a canonical key over target
  route/profile/endpoint configuration, limits/reserve, provider-default effort,
  instructions, static permitted tools, capabilities, agent/workspace, permissions
  and credential digests. Native load independently validates original prefix,
  committed memory pointer and evidence identities. New messages remain outside
  coverage and are budgeted normally; changed covered messages invalidate reuse.
  Source-valid extraction is reused without another model call. Project/task
  context is not persisted as timeless snapshot text: G1b revalidates it before
  commit and each request, including permission/revision/freshness changes.
  No provider KV/prompt-cache or hidden-reasoning transfer is claimed.
- Limits: existing C1b four source chunks, 256 KiB per chunk, one validation retry
  per batch, 4,096 generated tokens, 120-second extraction deadline, 64 claims and
  128 evidence references. Source requests and final target requests each pass
  their actual B1 checks. Existing G1 shared retrieval allowance/byte/chunk/time
  limits remain authoritative. Required unfit context, unsupported required tools,
  inaccessible evidence and unknown image token accounting block the switch;
  tool uncertainty remains a warning, not a false overflow blocker. No silent
  fallback, mandatory-source truncation or completed tool execution replay.
- Tests: focused frontend C2/routing/notice/startup group passed 118 tests in
  eight files (`targetContext`, `modelSwitch`, `modelSwitchSync`, `chatModelSwitch`,
  `selfHostedRouting`, `agentCompaction.integration`, `AiStatusBarControls`,
  `eager-budget`). Native conversation-memory group passed 149 tests. New tests
  cover canonical keys and invalidations, staged preservation, cancellation and
  stale settings/credentials/history, monotonic window delivery, idle retrieval
  authorization, atomic write faults/restart and invalid/corrupt source views.
  The intercepted SDK integration prepares roughly 239K estimated source tokens
  on the current cloud route after consent, then sends a smaller fitting request
  to the actual selected 20K private endpoint/model. It asserts preserved user
  requirements/transcript/memory and no repeated extraction on the next request.
- Final Windows gates passed: `npm.cmd run check-types`; `npm.cmd run lint`
  (unchanged 71 warnings / 2 infos / zero errors); `npm.cmd test` (1,391 tests /
  132 files); `npm.cmd run build`; `git diff --check`; `cargo fmt --check`;
  `cargo clippy --all-targets --locked -- -D warnings`; `cargo test --locked`
  (500: 450 library + 25 filesystem + 25 Git). Isolated Cargo target reused;
  no user process terminated. Existing Cargo user-directory canonicalization,
  Git CRLF notices and Vite plugin-timing advisory remain. Initial frontend gates
  caught and fixed eager SDK loading and the old confirmation-label assertion;
  the large lazy-loaded integration has a 15-second test allowance for full-suite
  contention, with unchanged production timeouts.
- Browser verification: `scripts/check-model-switch.mjs` passed using the real
  selector/hook with an isolated coordinator fixture at 1100x900 and 390x900.
  Preparation-owned lock, Cancel, consent, keyboard details access, commit,
  blocked state and horizontal overflow were checked; screenshots inspected.
  Native Tauri GUI and live providers/WSL/Unix were not exercised. SDK requests
  were intercepted and native durability used real temporary filesystem tests.
- Limitations/rollback: monetary estimates are unavailable, not fabricated.
  Snapshot invalidation is conservative for unrelated configuration/credential
  collection changes. Oversized intact sources or mandatory context still fail;
  the source model must remain available when new extraction is required. Disable
  target preparation/consumption to restore the prior block/warn switch gate,
  preserving session fields and original history. No reasoning controls, adaptive
  tool selection or communication/handoff feature was added. Protected delegation
  files, safety stashes and autonomous_tracker were untouched. Next checkpoint is
  **H1: Task-scoped communication**; it has not been started.

### H1: Task-scoped communication

Depends on C2 and existing PeerTask lifecycle. Scope: additive typed communication
events, authenticated explicit routing, reply-to/receipt/dedupe, safe-boundary
delivery, clarification waits and permitted result follow-up in the same ledger.
Do not implement a second scheduler or mutate another Chat directly.

Acceptance: E/G/L route a question and reply to the right task/session, queue
busy recipients, resume authorized work once and stop bounded no-progress loops.
Test spoofed source IDs, cross-workspace roots, target deletion/profile change,
source busy, cancellation races, expired waits, offline endpoints, corrupt
artifacts and restart between receipt and continuation. Side-effect ambiguity
must pause. Verify capacity-one and lease-holder clarification cannot deadlock.
Recipient-sized semantic handoffs are H2, not hidden extra work in H1.
Rollback disables new sends/automatic wake-up, keeps readable events and existing
task results. Commit `feat(ai): add scoped peer clarification`, update ledger, STOP.

Implementation record (2026-09-27):

- **Ownership and representation:** PeerTask schema 6 adds an optional bounded
  `communication` array to the existing task record. There is no separate task,
  conversation or message database. The eight kinds are clarification request /
  response, finding, blocker, review request / response, dependency update and
  note. Each event carries a UUID, task/recipient-task/root/parent/workspace IDs,
  captured session/agent/model endpoints and policy fingerprints, sender run
  generation, tool-call identity, sequence, SHA-256 payload digest, creation and
  deadline timestamps, reply-to and delivery state. Automatic replies also retain
  the actual new source message ID after flushing the original session history.
- **Routing and privacy:** Runtime-owned session/run/tool-call IDs authenticate
  sends; the model cannot select its sender. Only assigned task endpoints,
  parent/child target edges and producer-to-dependent target edges are accepted.
  Same-workspace membership alone is insufficient. Endpoint identities, agent
  definitions, model transports, workspace and permission fingerprints are
  revalidated. Explicit evidence references identify existing task artifacts by
  ID and content hash; native inspection verifies bytes without path fallback.
  No transcript dump, project-memory promotion or cross-conversation retrieval
  was added. Earlier private assistant text cannot substitute for an empty reply.
- **Execution:** `communicate_peer_task` uses the existing delegation permission
  category. Provider delegation now queues without awaiting its child inside a
  provider tool call. A clarification yields at a tool boundary, retaining the
  child run and write lease while releasing its inference request. The existing
  queue bridge waits for the source's settled boundary, validates authorization,
  commits delivery/acknowledgement, and requests one tool-free source answer.
  The reply is persisted before the original child resumes. Used steps and
  continuation counts carry forward; cancelled, replaced, busy, approval-paused
  or exhausted runs cannot resume. B1 and existing context preparation remain
  on the normal transport path. Source task result capture precedes a reply run.
- **Bounds and visibility:** Payload text is at most 4,096 UTF-8 bytes, eight
  existing artifact references and 32 events/task; clarification is limited to
  one outstanding question, two rounds/task and four/root, with a persisted
  ten-minute deadline. Existing graph, active-task and run ceilings still apply.
  Duplicate tool calls are idempotent; conflicting reuse, repeated questions and
  exhausted rounds fail closed. Deadlines and unsafe source/write-lease cycles
  block visibly. The existing task card shows clarification waiting and an
  expandable, height-bounded communication/provenance disclosure.
- **Durability and recovery:** The existing `clack-ai-peer-tasks.json` now has a
  native atomic owner reusing `SessionFile`, with a root revision CAS and the
  existing `tasks` key. Writes preserve legacy keys, serialize through the same
  owner and reject stale windows. Dispatch and receipts await durable writes;
  errors pause dispatch. Other windows receive invalidation and must reload,
  rather than overwriting an unseen revision. Task evidence and content retention
  read this same owner. Version 1-5 tasks migrate additively; malformed event
  metadata/digests pause loading without rewriting the source file. Interrupted
  requests/receipts remain readable but are blocked, not replayed; existing dead
  runs still recover as interrupted/failed. Cancellation wins late replies.
  Communication failure preserves an isolated worktree for reconciliation.
  No new content blobs or leases were introduced. The native ledger is bounded
  to 256 tasks / 32 MiB; original sessions and artifact content remain separate.
- **Verification:** Focused frontend command covering `peerCommunication`,
  `peerCommunicationCoordinator`, `peerTasks`, `peerTaskCoordinator`,
  `peerTaskDependencies`, `restartRecovery`, `chatRuntime` and
  `workspaceWriteLease`: **163 tests / 8 files passed**. This includes mocked
  dispatch -> child question -> source answer -> same-child continuation,
  route spoofing, ownership, receipts, duplicate/round/deadline bounds, busy
  source, inference drainage, lease-cycle refusal, missing source, changed
  profile/generation, offline endpoint, corrupt evidence, storage failure,
  worktree preservation and empty-response privacy. Four new native atomic
  ledger tests cover legacy migration, competing windows, failed writes and
  post-replacement ambiguity; focused `cargo test --locked peer_` passed 10 tests.
  Full `npm.cmd test`: **1,437 tests / 134 files passed**. Full
  `cargo test --locked`: **504 passed** (454 library, 25 filesystem, 25 Git).
  `npm.cmd run check-types`, `npm.cmd run lint`, `npm.cmd run build`,
  `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings` and
  `git diff --check` passed. Lint remains at **71 warnings / 2 infos / 0 errors**.
  Existing Cargo home canonicalization, Vite plugin-timing and Git CRLF notices
  remain. Rust used the isolated `clack-c1a-final-target` temporary target.
  `scripts/check-peer-communication.mjs` passed real-component browser checks
  for keyboard disclosure, provenance, bounded scrolling and long-text overflow
  at **1100px / 390px**; screenshot output was inspected. Native GUI and live
  provider runs were **not** performed.
- **Limits and rollback:** Automatic answers require a configured, authorized
  source with an available safe run boundary and remaining budget; other cases
  block for user reconciliation. Plain findings/review/dependency notes remain
  source-linked task activity and can accompany queued task dispatch; they do
  not independently authorize a billed wake-up. H2 owns richer recipient-sized
  delivery and hash-bound review/correction. No exactly-once shell/API effects
  are claimed; crash ambiguity never auto-replays. Setting
  `PEER_COMMUNICATION_ENABLED` false disables sends and automatic reply dispatch
  while keeping persisted events/results readable. Protected delegation files
  retain their pre-checkpoint hashes; safety stashes and `autonomous_tracker/`
  were not touched. **H2: Recipient-aware collaboration** remains unstarted.

### H2: Recipient-aware collaboration

Depends on H1 and M2/G1b/C2. Scope: task-specific target-budget packaging,
authorized evidence retrieval, verified findings promotion, dependency/result
delivery and hash-bound review/correction flow. Reuse immutable artifacts and
existing shared-write/worktree/review-apply lanes.

Acceptance: E/F/H cloud Coder, small local Investigator/Reviewer and returned
correction retain identities, critical requirements and immutable provenance;
no full private transcript leaks. Missing context triggers bounded retrieval
or clarification. Changed reviewed files invalidate findings/apply eligibility;
dependent failures block downstream, siblings continue, completed tools are
not repeated. Test unavailable small targets and refusal of unauthorized
tool/artifact access. U1 owns final visual polish, not a new orchestration engine.
Rollback uses explicit task prompt/artifact packaging and preserves all events.
Commit `feat(ai): prepare evidence-aware peer handoffs`, update ledger, STOP.

Implementation record (2026-09-27):

- **Architecture:** Existing PeerTask schema 7 adds optional version-1 `handoff`
  and `review` metadata. Versions 1-6 remain loadable; malformed new metadata
  fails validation. No new database, scheduler, conversation owner or model
  route was introduced. H1's native atomic ledger persists receipts before
  dispatch. Interrupted running tasks still recover as failed, never replayed.
- **Recipient preparation:** `peerHandoff` selects deterministic structured
  context for the captured receiving session, agent, model and workspace.
  `peerHandoffRuntime` resolves the real model adapter, endpoint policy, input
  capabilities, system instructions, tool schemas, existing recipient history
  and materialized attachments through the established B1 helpers. The complete
  explicit objective/requirements/constraints, clarification text and required
  project requirements survive. Review results used for corrections are required
  evidence. Optional dependency findings are selected only while B1 fits, with
  fresh evidence prioritized and omitted source identities retained. Oversized
  required context fails without truncation, model substitution or hidden
  summarization. Final serialized transport preflight remains authoritative.
- **Evidence and privacy:** Only explicit task payloads, immutable attachments,
  authorized prerequisite results and approved project records enter the package.
  M2 revalidation preserves source state, revision, checkout, conflicts and current
  evidence; historical agent findings never become current verified facts.
  Worktree-bound packages qualify project observations as needing checkout
  revalidation. G1b's existing bounded evidence tool and normal request-time
  retrieval remain available for missing details. Duplicate evidence/content
  delivery is removed without dropping artifact identities. Receiver read
  permissions, secret paths, content hashes and workspace boundaries are checked.
  An empty peer response no longer substitutes an older private assistant message.
- **Lifecycle and reuse:** A receipt records policy version, preparation key,
  payload digest, recipient session, timestamp, selected source IDs and omission
  count, not a second transcript. Preparation rechecks task/dependency identity,
  model/profile/permission fingerprints, source generation, cancellation,
  recipient history and project revision/freshness before delivery. Unrelated
  task graphs remain independent. An ephemeral cache holds at most 32 prepared
  packages / 524,288 text characters and requires freshly validated inputs before
  reuse; nothing is replayed from it after restart. Preparation has a 15-second
  deadline. Up to 16 evidence records include at most eight selected project
  records. Too many required project records fail explicitly.
- **H1 integration:** Clarification answers receive recipient-budget checks before
  acknowledgement. Previously acknowledged immutable evidence references are not
  repeated, while the original event/digest remains durable. H1's one outstanding
  question, two rounds/task, four/root, ten-minute lifetime and existing run/graph
  ceilings are unchanged. Ordinary findings do not create new independent paid
  wake-ups; dependency dispatch and explicit bounded follow-ups consume them.
- **Review/correction:** `request_peer_task.followUpTo` permits only an endpoint
  owner of a completed same-workspace task to create a review or correction in
  that existing graph. It adds a prerequisite edge and retains hop/task budgets.
  Reviews capture hashes of original prerequisite results, patches and readable
  text-file observations. Canonical paths and receiver permissions are checked;
  current files must match any supplied immutable text snapshot. Review inputs
  are rechecked at provider preflight, completion, correction packaging and the
  existing lease-protected apply path. Changed inputs invalidate findings/apply;
  a newer completed review supersedes older apply gating. File verification is
  bounded to 32 files / 1 MiB. Existing worktree creation/capture, shared-write
  leases, dependency failure propagation and cancellation remain the owners.
- **Project promotion:** `promote_peer_finding` selects a bounded excerpt from an
  endpoint-owned completed task, preserving its task-result locator. It reuses
  M1 proposal/publication and M2 verification, including mandatory native user
  sharing consent and evidence confirmation even in Full Access. Declined or
  failed verification cannot report a verified result. A separately approved
  publication may remain an explicitly qualified agent finding if verification
  is declined; no automatic private-memory promotion or truth assertion exists.
- **Verification:** Focused handoff/runtime/review/promotion, H1 communication,
  task/dependency/persistence, G1b, project-memory and B1 tests: **200 passed /
  11 files**. New H2 files contain **55 tests**, including mocked large-source to
  small-target dispatch and Coder -> Reviewer -> returned correction without
  manual transfer. Actual installed-adapter routing plus compaction integration:
  **27 passed / 2 files**. Final full `npm.cmd test`: **1,492 passed / 138 files**.
  `npm.cmd run check-types`, `npm.cmd run lint`, `npm.cmd run build` and
  `git diff --check` passed. Lint remains **71 warnings / 2 infos / 0 errors**.
  Vite reports mixed static/dynamic import and plugin-timing notices; Git reports
  normal CRLF conversion notices. No Rust implementation changed, so Rust gates
  were not rerun. No native GUI, native consent interaction or live-provider
  verification was performed; native/provider boundaries in tests are mocked.
- **Limitations and rollback:** Preparation conservatively includes the receiving
  conversation's existing history and mandatory attachments; it can refuse a
  large existing conversation instead of generating another summary. Unsupported,
  missing, binary or oversized review-file evidence blocks rather than fabricating
  a current observation. Hashes prove identity, not semantic correctness, and
  do not claim transactional protection against arbitrary external filesystem
  edits after validation. Rich activity/visual polish is deferred to R1/U1.
  `PEER_HANDOFF_ENABLED = false` restores explicit prompt/artifact packaging and
  ordinary H1 reply formatting, preserving receipts, review records and events.
  Protected delegation files retain their original hashes; safety stashes and
  `autonomous_tracker/` were untouched. **R1: Truthful activity presentation**
  remains unstarted.

### R1: Truthful activity presentation

Depends on H2. Scope: correlated chronological view over existing message/tool,
inference and task events; distinct provider reasoning/summary/progress/runtime
kinds and compact source-aware details. No synthetic reasoning or new run owner.

Acceptance: I fixtures for exposed reasoning, summary-only and none render the
correct labels and ordering; inspect files, tools, attempts, approvals, messages,
errors and completion live and after restart. Test cross-chat isolation,
redaction, provider event duplication, missing timestamps, long content and
collapsed/narrow views. Effort changes remain R2. Rollback restores existing
message/tool rendering without deleting history. Commit `feat(ai): clarify
reasoning and agent activity`, update ledger, STOP.

#### R1 implementation record (2026-09-27)

- **Architecture and ownership:** `activity.ts` derives presentation events from
  the original UI messages, existing `SessionRun`, and authorized PeerTask v7
  records. No new execution owner, activity database, model call, prompt text or
  provider stack. `activityStream.ts` observes the existing SDK UI stream, D1
  phase callbacks and retry callbacks. Session-owned transport captures session,
  workspace, agent, model, provider, optional task and run-start identity before
  asynchronous preparation. Later UI selections never relabel existing receipts.
- **Durable representation:** Additive `UIMessage.metadata.clackActivity` v1 has
  `{version, owner, receipts, omitted}`. Receipts contain stable boundary IDs,
  observation timestamps, kind/label, optional source part index and reasoning
  format; an optional receipt owner preserves an older run when a later run
  appends to the same assistant message. Validation rejects unsupported versions,
  duplicate IDs, nonexistent parts, foreign ownership and oversized metadata.
  Bounds are 512 receipts and 128 KiB of UTF-8 JSON per assistant message. Extra
  boundaries are explicitly counted, not silently presented as retained history;
  original tool/message content is not truncated or replaced. Repeated phase
  observations do not produce token-by-token persistence updates, including at
  the retention cap. SDK source/file parts preserve subsequent part correlation.
- **Provider truthfulness:** Actual SDK reasoning parts alone qualify. The APIs
  selected by the installed adapters are audited: OpenAI Responses summary deltas
  and Google thought text receive `Provider reasoning summary`; xAI Chat, Groq,
  Cerebras and DeepSeek returned reasoning fields receive `Provider reasoning
  content`. This does not claim access to complete internal chain-of-thought.
  Anthropic thinking blocks, arbitrary compatible/self-hosted endpoints and
  legacy unqualified parts use `Provider reasoning (format unspecified)` because
  these adapter outputs do not unambiguously distinguish full from summarized
  text. No model-name support guesses, no enabling reasoning settings, no
  extraction from ordinary prose or token counts. Encrypted/redacted Anthropic
  blocks and provider signatures are not displayed. Primary semantic references:
  [Google thinking](https://ai.google.dev/gemini-api/docs/thinking) and
  [Anthropic extended thinking](https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking),
  alongside the installed adapter source. Real adapter HTTP fixtures verify
  OpenAI, Google, Groq and compatible routes; this is not live-provider approval
  or an assertion that every model/backend supports reasoning output.
- **Runtime and collaboration:** Distinct reasoning, summary, assistant progress
  and runtime categories. Actual tool selection, input, approval request,
  approval decision, returned result/failure/denial, file references, command
  requests, provider artifacts, retries/recovery, cancellation and response/run
  terminal state are inspectable. Requested execution is never described as a
  successful write or command. H1/H2 events reuse task creation, dependency
  satisfaction, handoff receipts, directed communication/delivery/acknowledgment,
  review results, artifact hashes and interruption/cancellation/block state.
  Task prompts and private peer conversation bodies are not copied. Native
  execution and PeerTask scheduling, authorization and handoff contents remain
  unchanged. Unpersisted resume moments or missing approval timestamps are not
  invented.
- **Streaming, recovery and privacy:** Incremental text uses the SDK's existing
  part assembly rather than an additional text buffer; receipts are emitted at
  boundaries, not per token. Original start IDs and submitted/streaming timing
  remain intact, including Stop/model-switch locks until requests settle.
  Cancellation forwards stream cancellation and stale phase callbacks cannot
  update another run. Existing session persistence stores message metadata with
  the transcript; restart reconstruction is deterministic and interrupted states
  remain interrupted. Invalid activity metadata leaves the original transcript
  readable with unqualified provenance. Activity-only failed responses and
  metadata add no model messages/tokens in SDK conversion tests. Credential-like
  values, URL credentials, private keys and protected paths are redacted in
  activity; raw command arguments/tool payloads and signatures are withheld.
  Session and workspace ownership are checked before rendering shared events.
- **UI:** A compact collapsed timeline is composed into the existing chat. Only
  an open timeline builds rows; deferred message updates and 40-event pages keep
  long runs bounded without dropping the transcript. Event details show agent,
  model, run, workspace, task/tool IDs, evidence and original-message anchors.
  Timeline previews are bounded to 4,000 characters, with scrollable full returned
  provider text available in a separate collapsed transcript disclosure. Final
  answers and existing actionable approval/tool cards remain visible. Missing
  times stay explicitly unavailable in transcript order after timed events.
- **Verification:** Focused activity, installed adapters, real SDK stream,
  session persistence/recovery, chat presentation, transport errors and model
  switching: **130 tests / 9 files passed**. Full `npm.cmd test`: **1,558 tests /
  142 files passed**. `npm.cmd run check-types`, `npm.cmd run lint`,
  `npm.cmd run build` and `git diff --check` pass. Lint remains at the established
  **71 warnings / 2 informational notices / 0 errors**. Build retains the existing
  mixed static/dynamic import and plugin-timing notices; Git reports normal CRLF
  conversion notices. No Rust implementation changed, so Rust gates were not
  rerun. `scripts/check-agent-activity.mjs` passes real browser interaction at
  **1100px, 390px and 280px**: keyboard disclosure, 122-event pagination, source
  navigation, redacted full provider output, bounded scrolling, final-answer
  visibility, no horizontal overflow or page errors; screenshots inspected.
  Native persistence is mocked at IPC in the integration fixture. No native GUI,
  real restart of Clack or live-provider inference was performed.
- **Limitations and rollback:** Older history has no retroactively invented run
  identity, attempt timestamps or reasoning format. Current logical-run terminal
  state comes from the existing latest `SessionRun`; prior response-end receipts
  are not assertions of whole-run success. Pre-output request observations are
  buffered until output or failure so UI metadata cannot advance SDK lifecycle;
  a crash before that boundary retains the existing interrupted run, not a
  fabricated attempt history. Free-form sensitive text cannot be classified
  perfectly; the activity view redacts known patterns and withholds raw execution
  payloads. `ACTIVITY_ENABLED = false` restores the existing message/tool route
  without deleting stored receipts. Delegation-file hashes remain unchanged;
  safety stashes and `autonomous_tracker/` were untouched. **R2: Functional
  reasoning effort** is the exact next checkpoint and remains unstarted.

### R2: Functional reasoning effort

Depends on R1 and B1. Scope: evidenced supported-level resolver, per-chat/model
selection, immutable run capture, actual adapter mapping, output accounting
and Advanced effective parameters. Automatic is the default, not a fake level.

Acceptance: J intercepts each supported provider's serialized request for each
exposed option and asserts exact wire fields plus B1 reserves. Unsupported or
unknown models cannot submit guessed parameters. Test two chats, model switch,
retry/continuation, old preferences, revocation/config changes, capacity-one
latency and no active-run mutation. Display visibility is independent of effort.
Do not promise levels across all self-hosted engines. Rollback ignores idle
effort overrides, preserves their history and uses evidenced provider defaults.
Commit `feat(ai): map supported reasoning effort`, update ledger, STOP.

### T1: Tool definitions and authorization

Depends on R2 and M1. Scope: bounded versioned definitions, schema validation,
visible create/propose/review/assign/disable/remove controls, authorization and
persistence within the existing tool ownership boundary. No executable kind
becomes active until its T2/T3 runtime exists; unsupported controls are truthful.

Acceptance: K creates a draft without editing app internals; validation rejects
unsafe schemas/collisions; one agent can be assigned, another cannot; agent
proposals require user authorization; scope cannot expand through a description.
Test migration, edit-as-new-version, active-run version freeze, revocation,
restart and secret-free storage. Executing a safe test is T2, not simulated
success. Rollback disables custom registrations, retains definitions/history.
Commit `feat(ai): add scoped custom tool definitions`, update ledger, STOP.

### T2: Guarded tool execution

Depends on T1. Scope: reviewed declarative native-operation/HTTP bindings,
approval-aware safe testing, bounded output/schema validation, execution records
and lifecycle through existing tool/native/run controls. No arbitrary script,
function plugin or MCP process is launched without T3 confinement.

Acceptance: K/L run a scoped tool, show real result, deny another agent, reject
secret/outside-workspace/unauthorized-network access and prevent changes to
approved version/arguments. Test actual timeout/cancel, output floods, denied
approval, native error, symlink/path traversal, environment/credential leakage,
disable mid-run and crash with unknown effect. No automatic effect replay.
Rollback disables execution while preserving results/definitions and marking
unfinished calls interrupted. Commit `feat(ai): execute authorized custom tools`,
update ledger, STOP.

### T3: Confined scripts and MCP

Umbrella only. T3a/T3b/T3c are separate commits and stop boundaries; no bundled
agent runtime, automatic package installer or marketplace. Preserve existing
shell behavior; these are new custom-execution boundaries, not an unrelated
rewrite of Clack's ordinary terminal or shell tools.

#### T3a: Native confinement boundary

Depends on T2. Scope: version-pinned dependency/license review, execution policy
contract, native process/filesystem/secret/egress enforcement and a truthful
platform support matrix. Implement/test the available host first; other hosts
remain blocked unless independently verified in explicit platform subcommits.
No user script registration or MCP transport in this checkpoint.
Acceptance: native adversarial fixtures cannot escape declared roots, read
denied secrets, inherit unsafe environment, bypass egress or leave descendants
after cancellation. OS limits and unavailable capabilities are explicit, not
mocked support or Full Access bypasses. K/L confinement assertions are required.
Rollback disables the new boundary/unsupported execution kinds, preserves
records, and does not weaken existing shell policy. Commit `feat(ai): enforce
custom execution confinement`, update ledger, STOP.

#### T3b: Confined scripts and functions

Depends on T3a. Scope: explicit interpreter/executable selection, immutable
reviewed code/argv/schema versions, scoped registration, approved testing and
bounded execution through T3a and existing run history. No in-process arbitrary
plugin evaluation, dependency installation or MCP connection.
Acceptance: K/L real scripts use only authorized resources; changed code/hash
requires renewed review; output flooding, child processes, timeout, cancellation,
revocation and crash produce truthful bounded states with no effect replay.
Unsupported platforms cannot enable the tool. Rollback disables these bindings
and preserves definitions/results/unknown-effect records. Commit `feat(ai): run
authorized confined scripts`, update ledger, STOP.

#### T3c: Scoped MCP tools

Depends on T3a/T3b. Scope: explicitly configured local/remote MCP transports,
bounded discovery/schema registration, credential references, lifecycle and
external-data consent through T1/T2. Local processes require T3a confinement;
remote services are not described as locally sandboxed.
Acceptance: K/L test lying annotations, malicious descriptions/results, schema
changes, scoped agent assignment, reconnect duplicates, revoked credentials,
response size/time limits and process cleanup. No automatic server installation,
sampling inference, elicitation approval or startup tool execution. Unsupported
protocol actions fail explicitly. Rollback disconnects owned connections,
disables bindings and preserves definitions/history; ambiguous remote effects
remain unresolved. Commit `feat(ai): connect scoped MCP tools`, update ledger,
STOP. T3 is complete only with separate supported-kind/platform evidence.

### D2: Safe length continuation

Own finish normalization, logical answer segments, bounded stitching and
incomplete tool-call validation. Acceptance: stop does not continue; length
does within shared budgets; missing finish/disconnect does not masquerade as
length; code/Unicode survive stitching; partial JSON never executes; repaired
arguments get normal approval; completed tool IDs are not replayed. Include
restart/render reconstruction, loop cap and cancellation. Rollback renders
persisted segments without starting further automatic continuation.

### D3: Partial stream and offline recovery

Extend existing retry/error/run recovery ownership, not a second retry loop.
Acceptance: before-output bounded retry; partial output persists; backend
restart/cancel/auth/model-load/prefill distinguishable; no duplicate text or
tool execution; exhausted attempts become terminal/actionable. No fallback
destination before G3. Test disconnect on token/tool boundaries, delayed
headers, Retry-After, crash persistence and user Retry/Stop. Rollback preserves
partial segments and uses existing explicit interrupted-run handling.

### E2: Calibration

Own bounded metadata observations/recommendation functions, then optional
synthetic optimization through the same scheduler. Acceptance: stable sampled
TTFT/speed provenance, no permanent benchmark, bounded adjustments, no increase
from serial-only evidence, pins untouched, endpoint revisions isolated, errors
reduce only automatic recommendations, cancellation honors GPU/time budget.
Test outliers, cold loads, missing usage, reset and over-capacity manual values.
Rollback freezes recommendations and disables sampling without losing pins.

### F1: Efficiency with policy parity

Depends on R2 and T1-T3, as well as context/handoff preparation. Relevant
schema exposure includes versioned custom tools; a bounded authorized discovery
path may supply additional permitted tools only at safe request boundaries.
Never omit an active/unresolved call's required schema or silently invalidate
an approval. Repeat B1 after exposure changes, test deterministic selection and
measure small-target schema cost/quality before and after selection. Cache keys
include source, target, policy and tool revisions; privacy/permission scopes
never widen for cache reuse.

Own permission-intersected tool selection, prompt variant experiments and
stable-prefix composition. Acceptance: same security rules and required user
constraints; denied tools remain denied; no omitted unresolved tool results;
no correctness reliance on cache; realistic small-model tool payload tests.
Validate proposed server-specific hints against versioned upstream contracts.
Roll back independently to full permitted schemas and original prompts if
quality/parity evidence is insufficient. Do not ship unproven compact policy.

### F2: Watchdogs and polished controls

Own bounded pathological-output detection and small health/Advanced surfaces.
Acceptance: whitespace/repetition/tool/continuation loops stop with preserved
output and structured reason; legitimate repetitive code survives; search,
keyboard, narrow panes, real loading/offline states, pins and reset are usable.
Test snapshots of effective values behaviorally, not UI snapshot spam. Native
visual smoke must preserve effects/dispatcher/input focus. Rollback disables
new detectors/UI without clearing profiles or altering existing run ceilings.

### G1: Relevant history retrieval

Umbrella, complete only after separately verified G1a/G1b. Both implement
[Automatic Evidence Retrieval](#automatic-evidence-retrieval), not a global
search grant or extra transcript store.

#### G1a: Same-conversation evidence

Depends on C1b. Scope: bounded source-ID/lexical lookup over original owning-chat
messages/tool results and authorized immutable attachments, automatic missing-
evidence triggers, anchored expansion and B1 integration. Acceptance: A/B query
historical facts absent from memory and recover the correct original evidence
with valid links; never return invented, deleted or another chat's private
content. Test relevance/negation, call pairing, corrupt blobs, huge results,
permission changes, byte/time/round caps and index rebuild after restart.
No shared project search yet. Rollback removes rebuildable indexes and uses
memory/tail with an explicit insufficiency state, not guessed recall.
Commit `feat(ai): retrieve original conversation evidence`, update ledger, STOP.

##### G1a implementation record (2026-09-26)

- Baseline: clean `main` at `3b451e4`, after C1b `a90221f`. The delegation
  dialog files and `autonomous_tracker/` were already committed in the baseline;
  they remain unchanged. No safety stash was applied, modified or removed.
- Architecture: `conversationRetrieval.ts` builds a lazy, bounded in-memory
  lexical/metadata index over captured original UI messages, using C1b's intact
  message/tool groups and covered-prefix boundary. Explicit message/evidence,
  tool-call and owned content-reference IDs bypass lexical indexing. No second
  conversation store, persistent search database, embeddings or new provider.
- Automatic use: when C1b omits covered original groups, the latest user request
  ranks relevant originals before the response. Relevant unresolved claims boost
  source ranking; stale claims and linked contradictions require their original
  citations. Explicit source references are mandatory. Already-visible originals
  are not re-fetched unless explicitly anchored. Small, uncompacted chats keep
  the existing no-memory-read fast path.
- `request_conversation_evidence` is an existing-runtime, read-only tool for a
  bounded follow-up query or adjacent-group expansion. It returns a small queue
  receipt, not a duplicate artifact in the saved transcript. The next SDK
  `prepareStep` reads and validates the evidence before the next model response.
  It is only offered with conversation-owned preparation and passes through the
  existing permission and D1 tool gates. Automatic lexical retrieval does not
  depend on an additional model call or tool-call capability.
- Native ownership: `conversation_memory_retrieve` uses C1a's session store,
  per-owner lock, preparation token and existing workspace authorization. It
  verifies owner/profile/source/generation before reading and re-reads original
  state and authorization before delivery. It resolves only message IDs in the
  owning transcript, never arbitrary paths, another chat or a PeerTask lookup.
  Existing frontend secret-path policy filters before ranking and delivery;
  the native archive secret-path guard also filters structured source paths.
- Provenance: complete original JSON messages retain role, order, tool call IDs
  and paired results. Each chunk carries its C1a evidence ID, source revision,
  digest, original message ID/index, immutable content ID where applicable,
  ranking reason and end-exclusive intact message-group range. Source identity
  plus content hash deduplicates results. Negations and revisions are not
  excerpted away. Historical assistant assertions remain assertions, not
  independently verified project facts.
- Content: selected text/selection attachments, existing extracted document text
  and archive manifests resolve through the existing hash-verified CAS, with
  content-hash/size/UTF-8 validation. No filesystem-path fallback, new extraction,
  image interpretation, binary-to-JSON copy or blob write is introduced. Existing
  transcript/memory leases and reconciliation retain ownership; retrieval creates
  no additional durable roots requiring cleanup.
- Context: source-linked evidence is an untrusted assistant data envelope in
  the temporary working context, never a synthetic persisted user message.
  Every intact candidate group and the complete cached/delivered request are
  measured with B1, including current tool schemas. Final wire preflight remains
  authoritative. Model-switch preflight includes the new tool schema and keeps
  all existing selection locks and captured route/model/agent behavior.
- Bounds per preparation batch: two total retrieval/expansion rounds across
  SDK steps, twelve returned chunks and 65,536 decoded UTF-8 excerpt bytes
  cumulatively, ten seconds cumulative local work/wait, and the smaller B1
  allowance. At most six intact groups are selected per round. Lexical index
  input is capped at 16 MiB; query/anchor inputs at 4,096/256 code units. Native
  calls independently enforce twelve requested messages/chunks, 64 KiB output,
  twelve content references per message and a ten-second checked deadline.
  Oversized sources are reported, not truncated into incomplete tool groups.
- Failure/recovery: missing, corrupt, unauthorized, stale, malformed and oversized
  evidence cannot masquerade as successful recall. Mandatory missing/no-fit
  sources stop preparation; optional failures expose omission/insufficiency and
  request clarification. Cache keys include policy and C1a preparation revisions.
  Revision changes invalidate hits; exhausted rounds require retry rather than
  reuse of stale evidence. Abort/run changes discard late results, and teardown
  clears the transient index/cache. Native reads are bounded/cooperatively timed;
  frontend cancellation stops waiting but cannot interrupt an in-flight OS read.
- Persistence: no schema migration is required. Original sessions, attachments,
  valid C1a revisions and C1b coverage remain untouched. Normal C1a source-version
  synchronization is reused. After restart, the index is rebuilt from originals;
  no pending search/model request is treated as resumed. Repeated retrieval does
  not publish a memory revision or alter the transcript.
- Source inspection: an expandable status in the existing chat shows selected
  sources and omissions. View source scrolls to the original message/tool result
  and its existing immutable attachment card. A changed/deleted message disables
  the link explicitly. Notices are transient and clear on a new run; current
  filesystem navigation is never presented as historical evidence.
- Verification: focused frontend command
  `npm.cmd exec vitest run conversationRetrieval conversationMemory conversationCompaction compactionExtraction compactionPlan agentCompaction chatRuntime modelSwitch attachment peerTask`
  passed **438 tests / 25 files**. This includes **48 retrieval tests** and
  **5 real-SDK-path compaction/retrieval integration tests**. The latter use a
  mocked native/provider boundary: an exact early numeric decision absent from
  committed claims reaches the response request automatically; a model-issued
  anchored request also supplies it on the next step. No cloud fallback occurs.
  Ten transient-index/revision cycles preserve original evidence. Additional
  coverage includes negation, contradictions, paired groups, source IDs, secret
  paths, missing/corrupt/foreign evidence, profile changes, byte/chunk/time/round
  and B1 caps, abort/late delivery, independent chats, direct lookup beyond the
  indexing bound and changed-source navigation.
- Native focused `cargo test --locked conversation_memory::retrieval` passed
  **11 tests**, using actual temporary C1a metadata and immutable content files.
  Full `cargo test --locked --quiet` passed **423 tests**: 373 library, 25 file
  search and 25 Git integration tests; zero failures/ignored tests. The isolated
  `%TEMP%/clack-c1a-final-target` avoided interfering with any running executable.
- Full frontend `npm.cmd test` passed **1,318 tests / 127 files**.
  `npm.cmd run check-types`, `npm.cmd run build`, `cargo fmt --check`, strict
  `cargo clippy --all-targets --locked -- -D warnings` and `git diff --check`
  passed. Lint passed at the existing **71 warnings / 2 infos**, no new warnings.
  Existing environment/build notices remain: Cargo could not canonicalize the
  user-profile path, Git LF-to-CRLF notices and Vite plugin-timing diagnostics.
- Limitations: lexical sufficiency is heuristic, not semantic understanding.
  Attachment selection uses source IDs/metadata, not exhaustive full-blob search.
  Whole-source selection can honestly decline evidence that a later bounded
  passage index could fit. Repeated source changes can exhaust the two-round
  batch allowance and require retry. No native GUI interaction, live-provider
  small-model run or semantic-quality/hardware acceptance is claimed. Those
  remain distinct from deterministic integration evidence.
- Rollback: remove G1a runtime/tool/native/UI wiring and discard ephemeral indexes;
  preserve C1a/C1b originals and revisions, with explicit insufficiency rather
  than guessed historical recall. No database migration or blob deletion needed.
- Deferred: cross-chat/agent/project search, promoted knowledge, current-file
  freshness, PeerTask evidence expansion, semantic search, model-switch
  optimization and broader collaboration UI. The exact next checkpoint is
  **M1: Project memory ownership**, followed by M2 before G1b. None was started.

#### G1b: Project and task evidence

Depends on G1a/M1/M2. Scope: add current project files/documents, authorized
promoted knowledge and related PeerTask results/artifacts to the same retrieval
path with freshness and recipient-specific scopes. Acceptance: D/E/F retrieve
current relevant evidence, retain historical provenance and reject private or
cross-workspace content. Test checkout confusion, revoked promotion, dependency
revision changes, stale indexes and automatic insufficiency recovery without a
user reread command. No external embedding service. Rollback disables additional
sources while retaining G1a and all originals. Commit `feat(ai): retrieve scoped
project and task evidence`, update ledger, STOP.

##### G1b implementation record (2026-09-27)

- Implemented automatic, recipient-scoped evidence preparation through the
  existing conversation compactor and real agent `prepareStep` path. The native
  `scoped_evidence_retrieve` boundary reads the existing project store, M2 file
  observations, PeerTask ledger and immutable attachment content. No database,
  transcript migration, extraction model, embedding service or durable retrieval
  index was added. Normal small chats can receive shared evidence without first
  compacting or issuing a user reread command.
- Ownership/security: approved records must match the bound canonical workspace
  and checkout/base identity; pending, revoked, superseded and other-workspace
  records never enter shared ranking. Only already-consented slices and their
  source locators are returned, never the source chat's surrounding history or
  reasoning. G1a remains an independent same-conversation source lane. Native
  session binding, workspace registry, canonical containment and secret-path
  checks remain authoritative. Recipient Chat Only policy is checked in both
  frontend and native settings. Knowing a record/task ID does not widen scope.
- Project evidence includes record/revision, qualification, source session and
  message/tool/artifact locator, original approved slice hash/range, supersession
  and conflict links, and current file comparisons. M2 dependency closure is
  revalidated at consumption, not trusted from watcher/cache labels. Unchanged
  hashes can establish current declared evidence; changed bytes, missing sources,
  conflicting decisions and revoked dependencies remain explicitly qualified.
  User requirements are distinct from verified implementation facts. File hints
  in the request resolve only inside the recipient's authorized checkout; no
  recursive repository or global search occurs.
- Task evidence is limited to tasks involving the recipient session and the
  actual running target task's direct, completed, same-root dependencies. Active
  target agent/session identity, workspace, task state, live session ownership and
  bounded dependency membership are checked. Immutable text/selection artifacts
  retain content hashes, byte ranges and task/worktree provenance. Worktree
  findings remain historical task evidence, never main-checkout current truth.
  Missing/corrupt blobs have no filesystem-path fallback. Task scheduling,
  delegation approval, write leases, worktree application and cancellation
  coordination were not changed.
- Recovery requests reuse the existing evidence tool: unscoped anchors still
  address only private conversation evidence; `workspace` requests bounded shared
  lexical lookup, and `project:`, `task:`, `artifact:` and `file:` select scoped
  sources. This is a model insufficiency escape hatch, not a required user flow.
- Bounds: G1a/G1b share two lookup rounds, 12 returned chunks, 64 KiB of evidence
  (G1b charges serialized chunk metadata too), and ten seconds of local work per
  logical run. Both lanes may participate in one preparation round. Internal SDK
  batches retain the allowance and shared receipt. Native ranking examines at
  most the existing 64 project records/256 tasks, selects eight project records,
  twelve task/artifact candidates and eight explicit file hints. M2's sixteen-node
  dependency closure and eight dependencies/record remain in force. Passages are
  at most 4 KiB of complete UTF-8 lines, files at most 256 KiB, artifact input text
  at most 64 KiB. Each M2 read batch remains at most 4 MiB; final selected-file
  rechecking is a second bounded batch. No full-repository reread.
- Required anchors/dependencies are selected before optional matches. Duplicate
  source identities are suppressed; conflicting artifact identities fail closed.
  Already-present source/hash/text evidence is not injected again. Every assembled
  request, including provenance/omission reporting and tools, is measured by B1;
  required no-fit evidence blocks rather than dropping a constraint. No model
  switch, routing change or context-budget bypass was introduced.
- Stale delivery: each result carries a fingerprint of recipient/run/profile,
  project revision, scoped task ledger, Git revision and selected evidence. Native
  reads recheck authorization, files and revision state before returning. Cached
  evidence is revalidated for every reuse and again at transport preflight,
  including after local capacity admission. Revocation, source changes, cancelled
  tasks, stale runs, permission loss and late callbacks block delivery. Read-only
  validation does not consume another lookup round or duplicate byte allowance,
  but does consume the same local-time allowance. Receipts are process-local,
  never resurrected after restart; existing interrupted-run recovery is unchanged.
- Tests: 18 new frontend scoped-evidence/allowance tests, two added real-SDK
  integration scenarios, and 18 new native retrieval tests. Focused frontend:
  `scopedEvidence`, `conversationRetrieval`, `agentCompaction.integration` and
  `requestPreflight`: **92 tests / 4 files passed**. Focused native
  `conversation_memory::project`: **66 passed**, including all M1/M2 regressions.
  Native cases exercise real filesystem hashes/CAS and project persistence,
  publication/reload, missed-watcher same-mtime changes, dependency revocation,
  conflicts, consent boundaries, task identities, corruption and bounded reads.
- Integration evidence: installed AI SDK/provider serialization with intercepted
  native transport, simulated `private-model` at an asserted 8192-token context.
  A target receives approved project and dependency evidence absent from its own
  transcript and returns the fixture's original numeric requirement/negation;
  originals remain unchanged and final B1 fits. A second scenario revokes sharing
  during inference admission and confirms zero response bodies are delivered.
  This is deterministic integration evidence, not live-model intelligence scoring
  or completion of the full multi-agent D/E/F provider/GUI scenarios.
- Full gates on Windows: `npm.cmd run check-types`, `npm.cmd run lint` (**71
  existing warnings, 2 infos, 0 errors**), `npm.cmd test` (**1362 tests / 130
  files**), `npm.cmd run build`, `cargo fmt --check`,
  `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked`
  (**489: 439 library + 25 filesystem + 25 Git**) and `git diff --check` passed.
  Rust used `%TEMP%/clack-c1a-final-target`; no user process was terminated.
  Existing Cargo home canonicalization, Vite plugin-timing and Git CRLF notices
  remain. No dependency/lockfile or protected delegation-file changes.
- Limitations: bounded lexical matching is not semantic recall; large indivisible
  lines, binary/media artifacts and unsupported document representations require
  the existing attachment/tool path or an explicit unavailable result. Truncated
  passages retain ranges but cannot guarantee all surrounding semantic context.
  M2 hashes prove identity of declared dependencies, not completeness or semantic
  truth; no tests are automatically rerun. Synchronous filesystem work is
  cooperatively bounded, not hard-preempted; cancellation discards late results.
  Receipt changes conservatively require retry, not automatic conflict resolution.
  Native GUI, live provider, real small-model quality scoring, WSL, Linux and macOS
  were **not tested**; those D/E/F manual/provider checks remain with Q1/Z and
  require the relevant platform/server and explicit fixture execution.
- Rollback: remove/disable the scoped retrieval wiring and preflight guard while
  keeping G1a, M1/M2 records, private transcripts and attachment retention intact.
  There is no G1b durable format to downgrade or delete. Only this implementation
  record and G1b ledger row were updated. Next checkpoint is **C2: Optimize and
  switch**. No subsequent checkpoint was started.

### U1: Collaboration UX integration

Depends on H1/H2, R1/R2, T1-T3 and F1/F2. Scope: integrated context/source detail,
model preparation, collaboration/task status, scoped tool management and effort
controls in existing surfaces. No dashboard or command-palette workspace rewrite.

Acceptance: E-L native Tauri GUI flows are discoverable through visible actions,
status is truthful, approvals/results stay with their pane, and large content
does not overflow at narrow split widths/320px/200% zoom. Verify keyboard focus,
screen-reader names, Stop/minimize/restore, theme/background/blur and the normal
workspace chip/breadcrumb/explorer flow. Browser fixtures are supplementary,
not native evidence. Preserve terminal, Source Control and unrelated dialog
work. Rollback switches to existing views without deleting runtime records.
Commit `feat(ai): integrate collaboration and context controls`, update ledger,
STOP.

### Q1: Integrated intelligence quality

Depends on all functional checkpoints above and G2/G3. Scope: reproducible
quality corpus, adversarial A-L suites, metrics and evidence report, not a late
unscoped feature rewrite. Tests are built in each owning checkpoint; Q1 combines
them and measures cross-feature behavior. Gate details are in Advanced Quality
and Verification below.

Acceptance: critical retention/source/scope/no-duplicate-effect assertions pass;
repeated compaction, freshness and target switching are compared with original
evidence, not only compression ratio. Agent investigation -> implementation ->
review -> correction succeeds in bounded deterministic fixtures; injected
contradictions, missing sources and provider/tool failure yield honest blocking.
Record actual small-model results where available separately from unit/mock
results; failures or missing hardware are explicit, never 'flawless'. Rollback
retains corpus/results and disables the failing optimization at its owner;
do not relax correctness thresholds to mark Q1 green. Commit `test(ai): verify
context and collaboration quality`, update ledger, STOP.

### G2: Optional server discovery

Own an explicit bounded discovery action, beginning with supported service
advertisements/user candidates. Acceptance: no network action before opt-in,
no credentials on probes, results need selection, cancellation/deadline works,
manual entry remains complete. Native network permission changes, if necessary,
require explicit scoped review, not a blanket permission expansion. Rollback
removes the discovery action; configured endpoints continue working.

### G3: Explicit trusted fallback

Own destination-specific consent and safe request-boundary routing records.
Acceptance: Never sends no fallback traffic; Ask waits; configured automatic
mode sends only to the approved destination after compatibility and budget
checks; changing endpoint invalidates consent; partial/unknown side effects
block unsafe reroute. Test traffic captures containing private fixture data
and revocation/restart. Rollback defaults to Never without deleting history.

### Z: Final integration and handoff

Depends on Q1 and every preceding ledger item. Include advanced A-L as well as
original S1-S13, with separate unit/integration/native GUI/real-provider/manual
evidence. No completed old checkpoint is relabeled as advanced acceptance.

Run the scenarios below on real localhost, LAN and compatible hardware where
available; record backend/version/model/context/OS and observed limitations,
not just a green mocked suite. Validate cloud/saved-model/attachment/PeerTask
regressions and platform gates. A hardware-dependent scenario cannot be marked
Complete without its actual evidence or explicit user-approved deferral. No
automatic release/publish. Commit acceptance documentation separately and stop.

### Gate for every implementation checkpoint

Inspect git status/log first and confirm the previous checkpoint commit. Do
not touch autonomous_tracker/ or unrelated user work. Use npm only. Keep new
logic pure/testable and React/Tauri shells thin; no opportunistic refactors.

Run focused behavioral tests, npm.cmd run check-types, npm.cmd run lint,
npm.cmd test, npm.cmd run build, and git diff --check. On non-Windows use npm
instead of npm.cmd. Compare lint to the baseline; introduce no new warnings.
For Rust changes run cargo fmt --check, cargo clippy --all-targets --locked --
-D warnings, and cargo test --locked from src-tauri. Run NSIS and relevant
Linux/macOS build/acceptance gates when native/runtime integration warrants
them and at Z; never report a platform not actually exercised as verified.

Each checkpoint must have its own commit, acceptance evidence, rollback note
and updated ledger here. Stop before the next checkpoint. A pending gate is
not Complete. Revert dependent checkpoints newest-first, preserving additive
data and old readers; never reset the entire worktree to undo one checkpoint.
If a checkpoint grows beyond reviewable scope, document smaller substeps here
before coding, preserving its acceptance contract and ordering.

## End-State Acceptance Scenarios

| ID | Setup and actions | Required result / evidence |
| --- | --- | --- |
| S1 | Add http://localhost:11434; select an installed Ollama model; accept Automatic; send text and a compatible tool task. | Real inventory and bounded profile, no manual tuning; actual request uses selected model; unknown metadata honestly labeled. Mock wire assertions plus native Ollama transcript. |
| S2 | Add http://AI-SERVER:11434 over LAN/private DNS; use a cold model, introduce delay, disconnect and reconnect. | Alias/address preserved, latency distinguished from observed load or unknown first-output wait, bounded recovery and partial-output preservation. Real LAN timing/cancellation record. |
| S3 | Add vLLM behind authenticated HTTPS/private proxy with known 32K deployed limit and larger theoretical model maximum. | Correct proxy path/auth, reported limit where exposed, working budget below deployed limit, unsupported metadata stays unknown. Compare request accounting against actual server settings. |
| S4 | Grow a small-context chat beyond its working target with changed decisions, requirements, tools, PDFs and artifact references. | Automatic structured compaction before overflow, durable transcript unchanged, recent messages verbatim and requirements/open issues verifiably retained; retrieval links recover original evidence. |
| S5 | Force a low output-token limit while requesting long prose/code. | Length triggers bounded continuation; one coherent visible answer; no overlap loss, duplicate usage, unlimited loops or accidental continuation after normal stop. Fault fixtures and real engine result. |
| S6 | Drop the network after visible text, and separately after partial/complete tool calls. | Partial answer preserved; no blind prompt restart, malformed tool execution or repeated side effects; explicit safe recovery and truthful terminal state when exhausted. |
| S7 | Configure endpoint capacity two; start three independent conversation agents simultaneously. | Two real in-flight generations, one visibly queued; cancellation releases a slot safely. Verify native request counts, not only UI counters. Test capacity one with parent/subagent too. |
| S8 | Run two agents on constrained local capacity and one on a different cloud endpoint. | Local admission does not block eligible cloud work or consume its capacity; existing global task limits still apply. No implicit fallback/cloud transmission. |
| S9 | At idle switch a large chat to a smaller endpoint/model with sufficient capabilities. | Optimize and switch prepares target-sized working context, actual next request changes model/endpoint, transcript untouched; running switch and incompatible images stay blocked. |
| S10 | Pin context, concurrency and timeout in Advanced; produce new samples; restart; reset only context. | All pins survive tuning/restart; only context returns to Automatic. Invalid pins get precise validation, not silent changes. |
| S11 | Exercise LM Studio local/LAN and MLX on an Apple-hosted server, plus a generic server without metadata/list API. | Version-specific probes or honest manual path, no invented parser/context capabilities; same request/attachment/cancellation safeguards. Record real versions tested. |
| S12 | Invoke discovery and configure Never/Ask/trusted fallback policies with private fixtures. | No discovery before opt-in; no credential leakage; no external fallback traffic without correct consent; revocation works. Packet/request logs are redacted. |
| S13 | Restart with queued PeerTasks, dependency failures, artifacts and partially generated replies; use Dispatcher/split panes. | Existing recovery, dependency/cancel/aggregate behavior, write leases/worktrees and input/focus behavior remain correct; no automatic duplicate execution. |

## Advanced Acceptance Scenarios

These A-L scenarios are mandatory in addition to S1-S13, not replacements.
All are Pending for advanced behavior. Each owning checkpoint supplies focused
tests; Q1 composes them and Z supplies native/real-server evidence. U = unit,
I = integration with real serialization/storage and controlled fixtures,
N = native Tauri GUI, P = real provider/server. N/P must not be inferred from I.

| ID | Setup and actions | Required observable acceptance and fault variant | Owners / evidence |
| --- | --- | --- | --- |
| A | A very long original conversation has early prohibitions/numeric requirements, architecture decisions, failed tools, attachments, current unfinished work and a recent tool exchange. Prepare for a small context. | All critical requirements/decisions/current task and paired recent history survive; valid citations reopen original evidence; final B1 fits or blocks before HTTP. Compare raw transcript hashes before/after. Missing mandatory source or oversized protected set must block, not drop it. | C1a/C1b, G1a, Q1; U source/coverage oracle, I intercepted body, N source inspection, P small-model task continuation. |
| B | Run at least ten compaction cycles, introduce new facts/corrections each cycle, then ask for facts omitted from the latest summary. | Recover correct original messages through automatic retrieval; no summary-of-summary lineage replacing originals, no lost unresolved requirement. Track retention/source validity after every cycle; injected misleading summary is rejected or corrected from evidence. | C1b/G1a, Q1; U/I repeated-cycle traces and corpus scorecard, P repeated-compaction answers. |
| C | Switch roughly 239K of large-cloud history to a smaller authorized self-hosted target; repeat to cloud, then cancel/change settings during preparation. | Same conversation ID and durable originals; actual next provider/model routing changes only on successful commit; target-specific budget/tools/attachments validated. Snapshot cache invalidates correctly. Failure/cancel preserves old committed model/context/task/artifacts. | C2/R2, Q1; I adapter interception/transaction fault points, N both selectors, P actual small target. |
| D | Create memory from files/decisions; another agent changes a relevant file, a user supersedes a decision, and an unrelated file changes. | Relevant claim/review/test evidence becomes stale, current source is compared and memory reconciled; superseded decision not presented as current. Unrelated file does not trigger a full-repo reread. Same-mtime byte change and missed watcher/restart are detected at use. | M1/M2/G1b; U/I hashes and invalidation/read counts, N inspect old/current sources, P continuation using changed state. |
| E | Coder delegates research to Investigator, receives verified findings, implements, requests Reviewer review, then corrects a reported defect. Give each an independent chat/model. | Explicit source/target/root identity, dependencies, immutable artifacts, verified shared knowledge and inspectable status throughout. Private unrelated chat data never appears in intercepted payloads. Correction returns to proper owner; failed prerequisite blocks only downstream. | H1/H2/M2/U1; I three-session causal trace and privacy canaries, N complete workflow, P mixed cloud/local team. |
| F | A large-context cloud source delegates a focused review to a small local target with relevant and irrelevant artifacts. | Target-sized handoff preserves mission/critical requirements and authorized evidence; excludes unrelated source history. Missing detail triggers bounded retrieval/clarification. Unsupported image or mandatory no-fit context blocks with explanation. | H2/G1b/B1/F1; I target body/cost/scope assertions, P small-model reviewer with known deployed limit. |
| G | Delegate an ambiguous API-contract task whose source has the answer; make source busy, then available. Also create an unanswerable question. | Target asks appropriate source/coordinator, receives task-linked answer and continues once at a safe boundary, without needless user intervention. Unanswerable/repeated questions hit wait/round caps and show blocked; no chatter loop or lease/capacity deadlock. | H1/H2; U/I receipt, routing, fake-clock caps and capacity-one faults, N clarification views, P resolved task. |
| H | Two agents edit related files in shared mode, then in isolated Git worktrees; user edits reviewed content before apply. | Shared writes serialize; isolated checkout identity stays distinct; existing read-snapshot and explicit patch checks prevent overwrites. Stale review invalidated, worktree artifacts remain immutable, dirty/conflicting patch stays unapplied. | M2/H2; I/native filesystem and Git tests, N review/conflict flow, P bounded collaboration; WSL/non-Git serialized-lane checks. |
| I | Exercise provider-exposed reasoning, explicit summary-only and no-reasoning fixtures alongside tools, delegation, approvals and errors. | Distinct truthful labels/order/provenance; no fabricated hidden reasoning. File access, tool result, attempt, agent/task and terminal error can be inspected live and after restart. Secret canaries never reach display/export. | R1/U1; U/I event fixtures/redaction, N narrow/expanded activity, P supported providers with observed content kinds. |
| J | Change each supported effort level in two chats, run, retry, continue and switch model; also use unknown/unsupported endpoint. | Actual outgoing backend field/value matches selected effective policy and B1 reserve; no fake unsupported control/parameter; active run pinned, other chat isolated. Reasoning visibility toggle does not alter effort. | R2; I installed SDK/wire assertions for every supported mapping, N controls/locks, P provider acceptance and usage where exposed. |
| K | Create, validate, authorize, test and assign a tool to one agent; execute and inspect result; another agent attempts it. Repeat with agent-proposed tool, definition update and denial. | Only authorized agent/version/scope executes through native guards; registration/test/invocation approval semantics are real. Secret/network/outside-workspace attacks fail; no startup execution or silent self-authorization. Unsupported sandbox blocks scripts/MCP honestly. | T1-T3/F1/U1; U schemas/policy, I version/routing, native confinement fault tests, N authoring/assignment, real bounded tool/MCP fixture. |
| L | Restart at memory commit, switch commit, queued clarification, dependency completion, artifact capture and tool-effect boundaries. Change workspace and revoke a grant before recovery. | Last valid originals/memory and consistent selection recover; correct IDs/receipts/versions/artifacts survive; dead runs stay interrupted/failed. No completed effect replay, stale async publication, approval resurrection or cross-workspace delivery. Unknown external effects explicitly await reconciliation. | C1a/C2/M1/H1/T2-T3/D3; I crash-point matrix, N process restart and durable state inspection, P disconnect/restart where available. |

## Advanced Quality and Verification

The fidelity corpus has original-source oracles, not just expected summaries.
Include code, prose, non-English text, numeric constraints and negation, similar
filenames in different workspaces, misleading tool output, fabricated citations,
stale agent findings, reversed decisions, missing artifacts and edits by another
agent. For A/B/C record requirements/decision retention, file/source correctness,
unresolved-task continuation and unsupported claims after each preparation.
For D/H measure stale-evidence detection and correct supersession. For E-G
measure scope leakage, useful handoff content, bounded clarification and
completed dependency/correction work. Compression ratio is secondary.

Deterministic gates: 100% critical fixture requirements retained or explicitly
blocked, 100% emitted source references valid and authorized, zero orphan tool
pairs, zero unauthorized data/tool delivery, zero replay of a known completed
effect, and all injected stale critical evidence reconciled or blocked. A test
cannot pass merely by refusing every request: fitting healthy scenarios must
complete and source-retrieval fixtures must retrieve their expected evidence.
Include a separately scored noncritical recall/relevance/task-success corpus;
record per-model results and regression deltas against uncompressed original
context and current B1 elision, including where the full baseline cannot fit.
Do not set a universal model-intelligence guarantee or hide failures behind an
average score. A critical loss or unsafe action blocks its checkpoint.

| Verification layer | Required evidence |
| --- | --- |
| Unit | Pure ownership/coverage/provenance/schema/permission/effort/budget functions, contradiction and invalidation graphs, retrieval ranking/scope, tool pairing, loop/round caps and migration/recovery state machines. Deterministic clocks and adversarial fixtures. |
| Integration | Real installed SDK serialization; intercepted provider bodies and selected route/effort; actual session/content persistence and fault points; native request lifecycle/capacity; queue/receipt/dedupe/dependency/cancel races; filesystem/hash/worktree conflicts; bounded tool processes and API/MCP fixtures. No unapproved real provider billing. |
| Native GUI | Actual Tauri windows, split panes, workspace chip/breadcrumb/explorer actions, both model selectors, context sources, scoped tools, reasoning/activity, approvals, Stop/minimize/restore and restart. Screenshots/interaction assertions at normal and narrow sizes/zoom with theme/backgrounds. Browser mocks do not establish native behavior. |
| Real provider/server | Small self-hosted model with recorded deployed limit, cloud-to-local switch, reasoning shapes/effort acceptance, capacity-one handoff/clarification, cancel/disconnect and bounded quality corpus. Record endpoint trust without exposing credentials. Hardware absence is Not tested, not passed. |
| Manual/platform outstanding | Explicit named owner/checkpoint, missing hardware/credentials/platform, scenario IDs and required next action. Preserve Windows NSIS, Linux/Arch/NVIDIA Wayland and macOS packaging gates; no inferred cross-platform success. |

Each result records commit, scenario/fixture version, OS, backend/version, model
ID/revision/quantization, deployed context, tool/permission versions, manual
pins, source coverage, estimate/usage, preparation calls/time, actual result,
limitations and sanitized evidence paths. Mock/native/real evidence columns
are separate. Do not store prompts/secrets in general diagnostics. Use user-
authorized test fixtures for real model evaluations, not private project export.

Rollback is checkpoint-local: stop new automatic work, retain original records,
show unavailable derived features, revert dependent code newest-first without
deleting additive data. Migrations require old-reader tests and a safe disabled
state. Never repair a failure by resetting user changes, weakening policy,
silently routing to cloud or deleting the sole source evidence. Q1/Z cannot
mark a failed or untested mandatory scenario complete without an explicit
recorded user-approved deferral; report that deferral as a limitation.

## Testing and Evidence Strategy

Unit: evidence precedence, idempotent profile migration, pins/reset, URL base
handling, cache freshness, capability intersection, complete budget arithmetic,
multimodal uncertainty, source-linked memory validation/coverage, continuation
stitching, admission fairness/cancel, calibration hysteresis, watchdog false
positives and timeout classification. Deterministic clocks and fixtures; no
brittle snapshot-only tests.

Integration: fake Ollama, LM Studio, vLLM, MLX and generic compatible servers
with actual adapter serialization, auth assertions and bounded responses. Faults
include malicious metadata, DNS/redirect/rebinding, private/public address
changes, 401/403/404/429/5xx, model-loading delay, long prefill, stream-idle,
missing finish, length, disconnect, backend restart and malformed tool JSON.
Verify native transport cleanup and cross-window capacity, not only fetch mocks.

Multi-agent: dependency-ready ordering, target busy, endpoint cap two/third
queued, independent endpoints/cloud, same-capacity parent/subagent, cancelled
queued item, stopped-but-draining request, approval wait, write lease ordering,
immutable artifacts, aggregation, recovery and no duplicate tool side effects.

Native: run actual same-PC and LAN servers, endpoint offline/reconnect, reverse
proxy/HTTPS/private DNS/Tailscale where available, Windows/macOS/Linux client
smokes, terminal/Markdown/image/source-control regressions and UI screenshots.
Verify first-token/load status against observable server events; capture actual
model/provider routing and keep test credentials out of reports.

Hardware evidence: record model ID/revision/quantization, backend/version,
configured context, hardware, network, OS, manual pins and observed timings.
Do not call mocked S1/S3 success actual Ollama/vLLM acceptance. Use a real
multi-GPU server for multi-GPU claims; otherwise explicitly Not tested.

## Risks, Limits and Deferred Decisions

- Derived memory can preserve source links while misunderstanding the source.
  Protected exact requirements, evidence retrieval and quality gates mitigate,
  not eliminate, semantic loss. Do not claim lossless compression or perfect
  multi-day recall; weak-model extraction may need to block rather than guess.
- Project knowledge can race external editors, Git operations and other agent
  worktrees. Hash checks detect content changes, not every semantic dependency;
  missing dependency evidence stays uncertain. Preserve user requirements when
  facts and instructions disagree.
- Cross-agent communication adds permission, routing, chatter and deadlock risks.
  One ledger, bounded causal events, safe-boundary delivery and explicit wait
  limits reduce them; no promise of autonomous conflict-free coordination.
- Custom tools enlarge the native attack surface. Schema validation and approval
  are not a sandbox; platform confinement/egress differences may block some
  execution kinds. Do not weaken boundaries to claim universal tool support.
- Reasoning content and effort APIs vary by model, adapter and deployment.
  Displayable summaries are not hidden reasoning, and identical effort labels
  do not imply identical behavior, quality or token consumption across models.
- Durable history and derived evidence consume disk and need paging, reference
  retention, corruption handling and explicit deletion semantics. Existing
  autosave is not sufficient evidence of atomic multi-record commits. Full disk
  or crash may block progress; original evidence must not be silently replaced.
- Upstream patterns are architectural references, not audited Clack dependencies.
  Their current contracts/licenses must be rechecked before implementation or
  copying. Do not transplant a broad external runtime into this product.
- Context accuracy is limited without the matching tokenizer, chat template,
  multimodal accounting and deployed configuration. Unknown must stay visible;
  fail safely rather than equate a UI estimate with a hard guarantee.
- Structured memory is lossy interpretation, not perfect recall. Preserve raw
  evidence, explicit constraints, source links and recent context; measure
  long-chat retention with adversarial fixtures and real small models.
- Engine API/version differences, reverse proxies and model reloads invalidate
  assumptions. Probe versioned schemas and keep backend/parser states unknown
  where there is no reliable API; do not add guessed detection routes.
- Client cancellation cannot guarantee immediate remote GPU stop. Native task
  cleanup and real engine drainage must be separately tested before concurrency
  recommendations claim safe performance. External clients are not scheduled.
- Partial output/tool execution makes automatic replay unsafe. Exactly-once
  arbitrary shell effects cannot be guaranteed across crashes; ambiguous cases
  require explicit reconciliation and preserved logs/results.
- Summarization and subagents can deadlock capacity-one servers unless slots
  are per inference attempt, not held by a parent logical run. Write leases
  and global PeerTask capacity are distinct constraints.
- Native backend adapters, tokenizer dependencies, scanner implementation and
  optional server optimizations require evidence before adoption. Default to
  compatible transport, manual entry and bounded local retrieval initially.
- Do not promise output quality, zero hallucinations, infinite context, perfect
  throughput or local-only server processing based solely on address/branding.

## Continuation Instructions and Verification Record

Next implementation checkpoint: C1a only, durable memory/source identity and
transactional revision foundation, after an explicit implementation request.
This is the narrowed first half of the former C1, not permission to implement
the full advanced program. C1b semantic extraction and all later work remain
Pending. The 2026-09-19 task expands this plan only and stops after its docs commit.
A1-A3, D1, E1 and B1 are complete; do not redo migration/probing/setup/lifecycle/admission/budgeting or replace the additive
identity model. Preserve A2's native ownership, bounded request policy, freshness
checks, explicit private-network authorization, and no-inference handshake rule.
Future sessions must read this plan, the current git log/status, CLACK.md,
AI_MULTI_AGENT_BUILD_PLAN.md and AI_ATTACHMENTS.md. Confirm the model-switch
baseline remains present; preserve changes made since this audit. Refresh API
evidence when implementing, then record exact files/tests/commit and pending
native checks in the ledger. Do not infer later completion from A1-A3/D1's foundation.

Next-task instructions:

1. Read this plan's advanced audit, ownership, memory, C1a and A/B/L gates plus
   CLACK.md, AI_RUNTIME.md, the completed multi-agent plan and attachment contract.
   Run git status and git log --oneline --decorate -12; confirm B1 `460465a`
   and this planning commit are present. Do not repeat completed checkpoints.
2. Preserve the unrelated PeerTaskDialog.tsx/CSS, delegation-check script,
   safety stashes and autonomous_tracker/ exactly. Implement only the C1a
   source/revision/transaction foundation in its owning session modules.
3. Resolve actual persistence/atomicity constraints with focused fault tests
   before connecting derived records. No model calls, automatic compaction,
   retrieval, project promotion, communication or custom-tool runtime in C1a.
4. Run its focused tests and the normal checkpoint gates; record exact changed
   files, migration/rollback evidence and native tests still pending. Commit
   only C1a and its plan record, then stop. Do not proceed to C1b automatically.

Advanced planning verification scope: only this roadmap is edited. Public
Hermes/Codex source was read at pinned revisions without code imports or new
dependencies. Verify the complete documentation diff, internal links, checkpoint
IDs, both traceability matrices and preserved completion records before staging.
Run git diff --check and git diff --cached --check. Runtime test suites, native
GUI, provider calls, sandbox execution and hardware scenarios are not run for
documentation-only changes and cannot be claimed as newly verified.

2026-09-19 documentation checks: complete diff reviewed; all 49 numbered request
headings, 24 persistent outputs, 12 A-L scenarios and 32 ledger specifications
accounted for; internal anchors and checkpoint dependency order checked. The
entire A1-through-B1 specification/record section and original 44-row traceability
matrix are unchanged after newline normalization. The three protected delegation
file hashes match the pre-edit baseline. Working-tree whitespace check passed.

Planning-only verification: source audit and primary-source API review;
git diff --check passed. The staged documentation must also pass
git diff --cached --check before commit. No feature tests were run because
no code is touched. No self-hosted hardware, native GUI,
inference request, network scan or benchmark was run for this plan.

## Requirement Traceability

Numbers correspond to the 44 requirements in the planning request. A1's persistent
foundation and A2's bounded probes have implementation evidence above; full runtime and UI
acceptance remains pending for the owning checkpoints.

| Requirement | Checkpoint / location | Acceptance evidence |
| --- | --- | --- |
| 1 Persistent plan | This document and build-plan link | Docs-only diff/commit |
| 2 Current-state audit | Current Architecture Audit | Source paths at 5415e5d |
| 3 Automation / advanced / truth | A1, A3, F2 | S1, S10, unknown-evidence tests |
| 4 Endpoint identity and alias | A1 | Migration/identity/credential tests |
| 5 Backend detection / handshake | A2 | Engine fixtures, S1, S3, S11 |
| 6 LAN / VPN / remote states | A2, D1, D3 | S2, S3 and native network evidence |
| 7 Optional discovery | G2 | S12, no unsolicited traffic |
| 8 Endpoint + model profile | A1, E2 | Isolated profile/revision tests |
| 9 Theoretical vs actual context | A2, B1 | S3, mismatched-limit tests |
| 10 Automatic setup | A3 | S1, bounded UI/manual escape |
| 11 Optimization modes | A1, E2, F2 | Policy/pin tests, S10 |
| 12 Advanced overrides | A1, A3, F2 | S10, invalid/reset settings tests |
| 13 Adaptive budgeting | B1, C1 | S3, S4, serialized request budgets |
| 14 Structured rolling memory | C1 | S4, transcript hashes/provenance |
| 15 Context retrieval | G1 | S4, scope/source/relevance tests |
| 16 Model switching integration | B1, C2 | S9, existing shared lock/gate tests |
| 17 Length auto-continuation | D2 | S5, bounded segments and usage |
| 18 Tool safety on continuation | D2 | S6, zero partial-JSON execution |
| 19 Stream/network recovery | D1, D3 | S2, S6, native fault tests |
| 20 Prefill-aware timeouts | D1 | Slow first-output vs idle fixtures |
| 21 Real load / busy states | A2, D1, E1, F2 | S2, S7, no fabricated phases |
| 22 Endpoint concurrency | E1 | S7, native in-flight counts |
| 23 Capacity recommendations | E2 | Hysteresis/evidence/pin tests |
| 24 Passive calibration | E2 | Bounded samples/no prompt logs |
| 25 Optional optimization | E2 | Explicit consent/time/token caps |
| 26 Prefix / prompt caching | F1 | Stable composition/correctness tests |
| 27 Server optimization awareness | A2, F1 | Versioned evidence; no admin calls |
| 28 Small-model tools | F1 | Permission-subset and history tests |
| 29 Compact system prompt | F1 | Policy parity or explicit deferral |
| 30 Generation watchdog | F2 | Loop and legitimate repetition tests |
| 31 Compact health UX | F2 | Native visuals/real metrics, S11 |
| 32 Remote security | A2, D1, G2, G3 | SSRF/auth/TLS/redaction fixtures |
| 33 Explicit fallback | G3 | S12, consent-bound traffic assertions |
| 34 Offline UX | D3, G3 | S2, S6, preserve partial/Retry/Stop |
| 35 Mixed-agent scheduling | E1 | S8, no local head-of-line blocking |
| 36 Simple default UX | A3, F2 | S1, S10, narrow-pane keyboard smoke |
| 37 Small reversible checkpoints | Checkpoint Order and Gates | Separate commit/evidence per row |
| 38 End-state scenarios | S1-S13, Z | Actual results with platform/server |
| 39 Unit/integration/native tests | Testing and Evidence Strategy | Per-checkpoint gate logs, Z |
| 40 Non-goals | Protected Systems and Non-Goals | Scoped diffs and no admin APIs |
| 41 Preserve existing systems | All checkpoints | S13 and existing regression suites |
| 42 Model-switch relationship | Audit contract, C2 | Existing routing tests plus S9 |
| 43 Traceability | This matrix | No unmapped requirement |
| 44 Planning output only | This documentation commit | Whitespace check; no runtime edits |

## Advanced Requirement Traceability

This matrix covers the 2026-09-19 advanced-intelligence request independently
of the original 44-row matrix, which is preserved above. Classifications refer
to runtime at `460465a`; planning/process rows explicitly say so. 'NEEDS
EXTENSION' preserves existing primitives but does not claim the full requirement
works. Each row names an authoritative design location, owning gate and concrete
acceptance. A-L are specified in [Advanced Acceptance Scenarios](#advanced-acceptance-scenarios).

| Request | Current classification | Roadmap location / checkpoints | Acceptance |
| --- | --- | --- | --- |
| 0 Repository safeguards and authoritative plan | ALREADY IMPLEMENTED (verified process baseline) | Advanced Current-State Audit; Continuation Instructions and Verification Record | B1 SHA/log/status checked; only roadmap staged; protected fingerprints/stashes unchanged; completed records retained. |
| 1 Cohesive automatic long-lived agent environment | NEEDS EXTENSION | Advanced Ownership and Integrity; Integrated UX and Resource Policy; C1a through Q1/Z | A-L complete with per-layer evidence; healthy fitting workflows need no manual context reconstruction or infrastructure management. |
| 2 Existing-system audit and reuse | ALREADY IMPLEMENTED (planning audit in this revision) | Advanced Current-State Audit | Every audited area has actual source evidence and gap classification; no duplicate session, provider, PeerTask or attachment owner. |
| 3 Hermes/Codex source, licenses and compatibility | ALREADY IMPLEMENTED (read-only study in this revision) | Upstream Reference Study | Pinned files/licenses/dependency manifests, observed mechanisms and adaptation/rejection decisions; no imported code/dependencies. |
| 4 Context and conversation memory overall | NEEDS EXTENSION | Conversation Memory and Compaction; C1a/C1b/G1a | A/B: useful small-context continuation, original transcript intact, missing evidence not guessed. |
| 4.1 Stable conversation, full history and memory identities | NEEDS EXTENSION | Advanced Ownership and Integrity; C1a | A/C/L: stable session/message/tool/source IDs, complete durable originals and selection/run provenance, additive crash-safe revision recovery. |
| 4.2 Structured source-linked working memory | NOT IMPLEMENTED | Conversation Memory and Compaction; C1b | A/B: objective/requirements/decisions/files/work/errors/results/artifacts/reviews/questions/uncertainty fields retained with typed evidence and valid refs. |
| 4.3 Critical information and paired recent context | NEEDS EXTENSION | Conversation Memory and Compaction; C1b/B1 | A: exact critical constraints and recent call/result groups retained; protected-set overflow blocks before HTTP, no silent omission. |
| 4.4 Proactive bounded incremental compaction | NEEDS EXTENSION | Conversation Memory and Compaction; C1b | B/L: ten cycles track original coverage, bounded calls/tokens/time, validated atomic revision, cancel/crash leaves previous memory/originals. |
| 4.5 Automatic insufficiency-driven original retrieval | NOT IMPLEMENTED | Automatic Evidence Retrieval; G1a/G1b | A/B/D: automatic scoped original/history/tool/attachment/project/task lookup, relevant source links and truthful missing/no-fit results. |
| 5 Separate conversation/project/task memory | NEEDS EXTENSION | Advanced Ownership and Integrity; Project Memory and Freshness; M1/M2 | D/E/L: stable workspace/checkout identity, authorized verified shared architecture/requirements/tests, inspection/correction, no private-chat promotion leak. |
| 6 Project comparison and incremental updates | NOT IMPLEMENTED | Project Memory and Freshness; M2/G1b | D/H: changed bytes/superseded decisions detected, current evidence reconciled, stale reviews blocked, no every-turn full-repo scan. |
| 7 Small-target switching with preserved conversation | NEEDS EXTENSION | Target Context Preparation; C2 | C: roughly 239K source prepares bounded target context, current requirements/evidence/recent tail retained, actual route changes only after validation. |
| 7.1 Validated context reuse and cache invalidation | NOT IMPLEMENTED | Target Context Preparation; C2/F1 | C/D: source/artifact/policy/project/target changes invalidate snapshots; reusable extraction remains source-valid; no cross-provider hidden-state/cache claim. |
| 7.2 Automatic switch UX and advanced inspection | NEEDS EXTENSION | Target Context Preparation; C2/U1 | C/N: both selectors show preparation/Optimize and switch when required, source/cost/omission details, no 100-message manual selection. |
| 7.3 Cancel/failure preserves old state | NEEDS EXTENSION | Advanced Recovery Contract; C2 | C/L: every await/commit fault leaves consistent old pair and intact transcript/task/attachments; unsupported target cannot partially switch. |
| 8 Fidelity over compression ratio | NOT IMPLEMENTED | Advanced Quality and Verification; Q1/Z | A-D: critical requirements/decisions/files/original facts/unresolved work retained or blocked, adversarial and real-small-model results recorded without perfect-recall claims. |
| 9 Coordinated agents on existing PeerTasks | NEEDS EXTENSION | Peer Communication and Handoffs; H1/H2 | E-H/L: coordinated research/code/review/correction, independent conversations, one ledger/scheduler and bounded work. |
| 9.1 Questions, delegation, review, findings, blocked/completion and follow-up | NEEDS EXTENSION | Peer Communication and Handoffs; H1 | E/G: task-linked intents delivered and acknowledged without manual copy/paste; new billed work still authorized. |
| 9.2 Explicit authenticated identity/routing | NEEDS EXTENSION | Advanced Ownership and Integrity; H1 | E/G/L: source/target agent/session/workspace/root/task/reply-to/policy recorded and validated; spoofed/cross-chat delivery rejected. |
| 9.3 Bounded evidence-rich handoffs | NEEDS EXTENSION | Peer Communication and Handoffs; H2 | E/F: exact mission, relevant constraints/files/dependencies/artifacts/findings/source memory and uncertainty arrive; entire source history does not. |
| 9.4 Recipient model/context/capability adaptation | NOT IMPLEMENTED | Peer Communication and Handoffs; H2/B1 | F: cloud coder to small local reviewer fits target budget/tools/modalities or blocks; missing evidence retrieved/clarified within scope. |
| 9.5 Verified shared project knowledge | NOT IMPLEMENTED | Project Memory and Freshness; M1/M2/H2 | D/E: authorized source-linked promotion and current evidence, no all-agents-read-all-chats access. |
| 9.6 Task-scoped bounded clarification | NOT IMPLEMENTED | Peer Communication and Handoffs; H1 | G: ambiguous API/revision resolved through appropriate source; bounded no-progress/wait handling, no needless user intervention for answerable questions. |
| 9.7 Dependencies and orchestration | NEEDS EXTENSION | Existing PeerTask audit; H1/H2 | E/G/L: existing DAG/limits respected, independent tasks continue, prereq failure blocks descendants, results return to parent and authorized follow-up runs once. |
| 9.8 Concurrent edits and stale review handling | NEEDS EXTENSION | Project Memory and Freshness; H2/M2 | H: leases/worktrees/read snapshots/explicit patch review prevent overwrites, changed review evidence invalidates approval, no auto-merge. |
| 9.9 Busy/offline/cancel/deleted identity/restart behavior | NEEDS EXTENSION | Advanced Recovery Contract; H1/H2/D3 | G/L: durable receipts and statuses, no duplicate completed effects, unavailable source/target/artifact blocks instead of rerouting; ambiguous effects reconciled. |
| 9.10 Integrated collaboration UX | NEEDS EXTENSION | Integrated UX and Resource Policy; U1 | E-L/N: visible actor/task/context/artifacts/waits/approvals/results/files/review through splits/Dispatcher/task cards, no new dashboard. |
| 10 Chronological reasoning and execution visibility | NEEDS EXTENSION | Reasoning Activity and Effort; R1 | I: objective/progress/tool/file/command/delegation/dependency/approval/retry/error/completion events correlated and inspectable. |
| 10.1 Reasoning truthfulness | NEEDS EXTENSION | Reasoning Activity and Effort; R1 | I: exposed reasoning, explicit provider summary, normal progress and runtime events distinct; none means none, never fabricated hidden thought. |
| 10.2 Compact expandable controls and styling | NEEDS EXTENSION | Integrated UX and Resource Policy; R1/U1 | I/N: collapsed/expanded/narrow/zoom behavior works with background/blur/theme, focus and pane ownership preserved. |
| 10.3 Activity provenance and redaction | NEEDS EXTENSION | Reasoning Activity and Effort; R1 | I/L: agent/model/run/task/file/tool/attempt/result/approval/failure links survive restart; secret canaries absent from UI/log/export. |
| 11 Functional supported reasoning effort | NOT IMPLEMENTED | Reasoning Activity and Effort; R2/B1 | J: supported-only options, Automatic default, exact wire mappings, effective parameters, immutable per-chat/model/run isolation and reasoning reserve accounting. |
| 12 Custom tool management overall | NOT IMPLEMENTED | Custom Tools and Security; T1-T3 | K: visible authoring and actual authorized execution, no app-internal edits, no self-granted authority. |
| 12.1 Tools versus skills, functions/scripts/APIs/MCP | NOT IMPLEMENTED | Custom Tools and Security; T1-T3 | K: execution kinds distinguishable from prompt skills; each supported kind validated/guarded, missing confinement explicitly blocked. |
| 12.2 Creation/validation/test/error UX | NOT IMPLEMENTED | Custom Tools and Security; T1/T2/U1 | K/N: define name/description/input/output/kind/scope/permissions/agents, validate, approve a real safe test and inspect success/failure. |
| 12.3 Agent proposals require user authorization | NOT IMPLEMENTED | Custom Tools and Security; T1/T2 | K: proposed definition cannot register/enable/execute itself; registration and invocation policy independently enforced. |
| 12.4 Explicit agent/chat/workspace/global scope | NOT IMPLEMENTED | Advanced Ownership and Integrity; T1/T2/M1 | K: assigned agent succeeds, another denied; global availability does not grant global access or transfer sender permissions. |
| 12.5 Native security, sandboxing and untrusted content | NEEDS EXTENSION | Custom Tools and Security; T2/T3 | K/L: native filesystem/secret/network/process guards hold, malicious schemas/results cannot elevate, unsupported sandbox fails closed even in Full Access. |
| 12.6 Versioned lifecycle and durable history | NOT IMPLEMENTED | Advanced Recovery Contract; T1-T3 | K/L: create/test/enable/assign/update/disable/remove/restart/error records, immutable active-run versions, revocation honored, no startup or effect replay. |
| 12.7 Relevant schemas for small models | NEEDS EXTENSION | Custom Tools and Security; F1 | F/K: only permitted task-relevant schemas exposed, active/unresolved tool requirements preserved, B1 recounts version/exposure changes. |
| 13 Automatic defaults and bounded efficient inference | NEEDS EXTENSION | Integrated UX and Resource Policy; C1b/G1/C2/H2/R2/F1/E2 | A-G/J: no manual reconstruction, incremental caches/reads, bounded summary/retrieval/chatter, B1/D1/E1 authoritative, no provider/privacy/security optimization changes. |
| 14 Durability and stale-async isolation | NEEDS EXTENSION | Advanced Recovery Contract; C1a/C2/M1/H1/T2/D3 | L: restart/window close/disconnect/workspace/model/agent changes recover owners and valid revisions, no cross-chat mutation/dead-stream resumption/duplicate effects. |
| 15 Ordered small reversible checkpoints | NEEDS EXTENSION (plan expanded here) | Checkpoint Order and Gates; individual specifications | C1/G1 split, M security before sharing, strengthened C2/F1, dedicated H/R/T/U/Q gates; separate commits/rollback/STOP, no pending item marked complete. |
| 16 Mandatory A-L scenarios | NOT IMPLEMENTED (advanced acceptance pending) | Advanced Acceptance Scenarios; Q1/Z | Each A-L row has setup, observable invariants/faults, owners and distinct U/I/N/P evidence. |
| 17 Unit/integration/native/provider/manual quality gates | NEEDS EXTENSION | Advanced Quality and Verification; Gate for every implementation checkpoint | Provenance/retention/freshness/scope/effort/tools/recovery suites plus actual native/real-model evidence; mocks never relabeled, missing verification explicit. |
| 18 Preserve architecture and all existing surfaces | ALREADY IMPLEMENTED (preservation baseline; regression duty continues) | Protected Systems and Non-Goals; Advanced Current-State Audit; all gates | Existing provider/OpenRouter/A1-A3/D1/E1/B1/switch/attachments/PeerTask/permission/lease/worktree/runtime/UX/packaging regression suites stay green, no duplicate owners. |
| 19 Persistent complete integrated plan | ALREADY IMPLEMENTED (documentation deliverable in this revision) | Deliverable location index below | All 24 deliverables mapped, completed records unchanged, pending runtime claims explicit and source audit verifiable. |
| 20 Docs-only verification/commit/stop | ALREADY IMPLEMENTED only when planning commit succeeds | Continuation Instructions and Verification Record | Complete doc diff and whitespace reviewed, only roadmap staged/committed; runtime files/stashes/untracked work preserved; no C1 started. |

### Deliverable Location Index

The numbered entries below correspond to section 19's 24 persistent outputs.
Acceptance for each is the mapped checkpoint/specification/scenario rather
than an untestable statement of intent.

| Output | Explicit location | Acceptance link |
| --- | --- | --- |
| 19.1 Current architecture audit | Advanced Current-State Audit | Source evidence/classifications at verified B1 SHA. |
| 19.2 Consolidated product requirements | Advanced design sections and Advanced Requirement Traceability | Request sections 0-20 and numbered subrequirements mapped above; A-L below original S scenarios. |
| 19.3 Existing systems to reuse | Advanced Current-State Audit | No duplicate owners; baseline regressions in all gates. |
| 19.4 Ownership/memory identities | Advanced Ownership and Integrity | C1a/M1/H1/T1 identity and atomicity tests, L. |
| 19.5 Conversation memory | Conversation Memory and Compaction | C1a/C1b; A/B. |
| 19.6 Project memory | Project Memory and Freshness | M1/M2; D/E. |
| 19.7 Project comparison/freshness | Project Memory and Freshness | M2/G1b; D/H. |
| 19.8 Automatic retrieval | Automatic Evidence Retrieval | G1a/G1b; A/B/D/F. |
| 19.9 Model-specific switch preparation | Target Context Preparation | C2; C. |
| 19.10 Agent communication/collaboration | Peer Communication and Handoffs | H1/H2; E/G/L. |
| 19.11 Agent-specific context handoff | Peer Communication and Handoffs | H2; E/F. |
| 19.12 Reasoning/activity display | Reasoning Activity and Effort | R1; I. |
| 19.13 Effort/API mapping | Reasoning Activity and Effort | R2; J. |
| 19.14 Custom tools/security | Custom Tools and Security | T1-T3; K/L. |
| 19.15 UX | Integrated UX and Resource Policy | U1 and owning UI checkpoints; E-L native GUI. |
| 19.16 Performance/inference integration | Integrated UX and Resource Policy | B1/D1/E1 regressions, bounded-call/read metrics, F1/E2. |
| 19.17 Failure/restart | Advanced Recovery Contract | Per-owner crash matrix; L. |
| 19.18 Ordered checkpoints | Checkpoint Order and Gates | Dependency/order audit; no circular prerequisites. |
| 19.19 Per-checkpoint acceptance | Individual C1a through Z specifications | Explicit acceptance and owning A-L/S1-S13 scenarios. |
| 19.20 Testing/rollback | Advanced Quality and Verification; individual specs | Focused/full/native gates, additive-data-preserving rollback evidence. |
| 19.21 End-to-end scenarios | Advanced Acceptance Scenarios; End-State Acceptance Scenarios | A-L plus original S1-S13, separate verification layers. |
| 19.22 Traceability | Both requirement matrices | No unmapped main/subrequirement or persistent output. |
| 19.23 Risks/non-goals | Risks, Limits and Deferred Decisions; Protected Systems and Non-Goals | Honest fidelity/freshness/model/security/coordination/recovery limits, no scope expansion. |
| 19.24 Next checkpoint/continuation | Continuation Instructions and Verification Record | Explicit-request C1a only, own commit and STOP; this task remains docs-only. |

Additional exclusions for this advanced program: no universal unlimited-context
abstraction, hidden cloud summarizer/embedding service, automatic private-chat
sharing, implicit cross-workspace access, second PeerTask ledger/session store,
external agent-runtime replacement, provider-account redesign, fabricated
reasoning, universal effort enum, unconfined custom-code fallback or promised
exactly-once arbitrary effects. Advanced configuration remains optional, but
security, source fidelity and truthful incomplete states are never optional.
