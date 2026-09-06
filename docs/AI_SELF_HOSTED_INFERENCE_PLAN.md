# Clack Self-Hosted Inference Plan

Status: Planning complete; implementation NOT STARTED
Audit date: 2026-09-06
Audited baseline: 5415e5d9d34ced7b32fe10095275b161ca6b4f2a
Baseline checkpoint: fix(ai): harden in-chat model switching

This is the durable product and engineering plan for self-hosted inference.
It complements [the multi-agent build plan](AI_MULTI_AGENT_BUILD_PLAN.md) and
preserves [the attachment safety contract](AI_ATTACHMENTS.md). Those programs
are not to be repeated or replaced. All implementation checkpoints below are
pending. This documentation change implements no inference features.

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

## Checkpoint Order and Gates

Checkpoint letters preserve the requested domains; execution order moves D1
and E1 forward because reliable native cancellation and shared admission must
precede automatic memory/continuation calls that consume GPU capacity. A is
split into small additive commits. Advanced pin semantics begin with profiles,
not a last-minute UI retrofit. G items are optional at runtime, but tracked
roadmap deliverables, not silently excluded from completion.

| Order | Checkpoint | Scope | Status | Commit / evidence |
| --- | --- | --- | --- | --- |
| 1 | A1 | Endpoint/profile identity, evidence and override persistence | Pending | None |
| 2 | A2 | Bounded authenticated backend handshakes | Pending | None |
| 3 | A3 | Add-server UX, endpoint-model bindings, capability routing | Pending | None |
| 4 | D1 | Native cancellation, request lifecycle, truthful timed states | Pending | None |
| 5 | E1 | Shared inference admission and PeerTask integration | Pending | None |
| 6 | B1 | Actual context budgets and shared request preflight | Pending | None |
| 7 | C1 | Structured rolling memory and automatic compaction | Pending | None |
| 8 | C2 | Optimize and switch integration | Pending | None |
| 9 | D2 | Length continuation, stitching and tool repair safety | Pending | None |
| 10 | D3 | Partial-stream/offline recovery | Pending | None |
| 11 | E2 | Passive calibration and optional bounded optimization | Pending | None |
| 12 | F1 | Relevant tools, compact prompt parity and cache awareness | Pending | None |
| 13 | F2 | Watchdogs, compact health UX and advanced polish | Pending | None |
| 14 | G1 | Bounded session-context retrieval | Pending | None |
| 15 | G2 | Explicit optional network discovery | Pending | None |
| 16 | G3 | Consent-bound fallback routing | Pending | None |
| 17 | Z | Integrated native/hardware validation and documentation | Pending | None |

### A1: Profiles and migration

Own the additions in config/selection helpers, settings persistence and keyring
reference plumbing. Define evidence and per-field Automatic/Manual overrides,
stable endpoint-model references and safe old-selection resolution. No probes
or adaptive runtime. Acceptance: repeat migration twice without duplicates,
lost keys or changed cloud selections; two aliases/models remain distinct;
rename/key rotation preserves identity; pins survive restart. Test malformed,
partial and legacy settings plus cross-window updates. Rollback leaves old
fields/readers usable and ignores additive profile metadata.

### A2: Safe backend handshake

Own thin native probe commands/helpers and pure result parsers, with the API
allowlist/bounds above and per-endpoint cache. No full transcript, generation,
download or scan. Acceptance: mock each engine, auth failure, 404 optional API,
HTML response, unknown metadata, mixed model types, malicious redirects/DNS,
oversized response, timeout/cancel and stale refresh. Configured context must
never be copied from theoretical context. Rollback disables probing and uses
existing manual endpoint fields; cached data does not alter older behavior.

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

### D1: Request lifecycle and timeouts

Own request IDs/cancellation/cleanup in net.rs, proxyFetch, transport and error
classification, retaining normal cloud defaults. Add load/first-token/idle
policies for opted-in self-hosted profiles. Acceptance: abort during every
phase settles once; native HTTP task actually terminates; no late output;
finite deadlines; no false loading/prefill claims; no leaked request entries.
Use fake timers and native local-server faults, including no chunks after
headers. Verify Stop and model locks throughout drainage. Rollback must never
leave an admission implementation depending on removed cancellation signals.

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

### C1: Structured rolling memory

Own derived session-memory revisions, bounded extraction/validation and
transactional compaction. Use E1/D1 for all extraction requests and B1 to fit
them. Acceptance: long chats retain requirements/decisions/open issues and
recent verbatim tail, raw transcript hashes remain unchanged, no orphan calls,
lost artifact refs or unbounded recursive summaries. Test crash/cancel,
malicious source instructions, malformed memory, superseded decisions and
missing content. Rollback discards only derived memory use, never raw history.

### C2: Optimize and switch

Extend the shared modelSwitch coordinator and existing notice UI. Acceptance:
prepare smaller target safely, prove real next-request routing and full
capability gate; abort/message/settings/run changes invalidate preparation;
no premature selection, no transcript rewrite, no unsupported images hidden.
Test both pane and status-bar selectors and active-run locks. Rollback restores
the existing block/warn preflight and ignores derived target memory.

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

Own local bounded retrieval over authorized session/artifact references with
B1 accounting. Acceptance: long-history query finds original evidence, follows
source links, respects deletion/security/scope, does not rewrite transcript or
leak another workspace. No new external embedding service. Rollback removes
only rebuildable indexes and falls back to structured memory/recent tail.

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

Next implementation checkpoint: A1 only, after explicit implementation request.
Future sessions must read this plan, the current git log/status, CLACK.md,
AI_MULTI_AGENT_BUILD_PLAN.md and AI_ATTACHMENTS.md. Confirm the model-switch
baseline remains present; preserve changes made since this audit. Refresh API
evidence when implementing, then record exact files/tests/commit and pending
native checks in the ledger. Do not infer completion from this planning commit.

Planning-only verification: source audit and primary-source API review;
git diff --check passed. The staged documentation must also pass
git diff --cached --check before commit. No feature tests were run because
no code is touched. No self-hosted hardware, native GUI,
inference request, network scan or benchmark was run for this plan.

## Requirement Traceability

Numbers correspond to the 44 requirements in the planning request. All
implementation evidence remains pending unless explicitly marked audit/docs.

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
