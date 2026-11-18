# LM11–LM15: Local model qualification experience

This milestone builds on accepted LM2F/LM6 verifier-owned evidence and the
LM7–LM10 read-only deployment guide. Its purpose is to choose **exact
deployments using evidence**, not to rank model names or infer behavior from
published model claims. It is deliberately not an Agent or ForgeBoard campaign.

## Qualification Lab (LM11)

The `Qualification Lab` is an ordinary Chat Controls surface, alongside the
existing Deployment guide. The older Qualification, Measurement and Suitability
diagnostics remain available in an Advanced diagnostics disclosure. Simply
opening the Lab does not start a runtime, send model text, change a model or
edit preferences. Only local managed GGUF selections trigger the three
read-only native observations: hardware, digest-checked model metadata, and
runtime status. The status is requested last and expires after 30 seconds.
Remote registrations are displayed from the saved registry; Ollama endpoint
reachability is never used to invent a remote model process epoch.

`qualificationLabPlan.ts` defines ten immutable, generic procedures:

- Chat/Instruction, cold/warm/cancellation;
- Structured JSON Schema, native tools, working-context configuration;
- Coding task, long-context retrieval, reliability;
- Agent prerequisites and standalone cancellation.

The Lab previews the registered canonical ModelDeployment identity, host,
runtime/version, artifact/digest, configuration, current process/epoch if
genuinely known, backend/context, native/protocol/permission gates, expected
LM2F/LM6 evidence, attempts, output bounds, cancellation, retries and effects.
The existing managed Chat verifier has a 128-token output ceiling and one
request. The existing LM6 standard procedure has three distinct 128-token
requests, no retry-to-pass, per-request timeout and a separate cancellation
challenge. No hidden tool permissions are granted. Unimplemented protocols
have zero dispatch allowance and are visibly unavailable.

**Unresolved execution safety requirement.** The existing LM2F/LM6 executors
do **not** demonstrate an enforced *aggregate* wall deadline from native
admission through pre-dispatch, provider request, native quiescence and CAS
persistence. The displayed 120s/300s budgets are therefore **proposed**, not
enforced; all Lab Run buttons are fail-closed disabled. A fixed Promise.race
would be unsafe: pending async pre-dispatch work could later send a provider
request even if cancellation saw no registered inference. This is not a
finished runnable lab. The original accepted standalone verifier controls
remain separately available under Advanced diagnostics and have not been
silently modified. This blocker must be resolved before claiming LM11 PASS.

## Historical fixtures (LM12)

`historicalEvidenceFixtures.ts` defines a strict v1 schema bounded to 32
records/32 KiB serialized. Each record carries source reference, measured or
reconstructed or synthetic provenance, exact nullable deployment/runtime/
configuration identity, typed units and observation boundary, failure
classes, uncertainty and explicit `historical-only` authority. Arbitrary
caller-provided data is accepted only as synthetic. A curated historical
Muse delivery-boundary incident serves as a regression fixture **not** as a
model-specific production decision, and cannot authorize any current
deployment. This fixture contains no model output transcript.

## Candidate and Agent policy (LM13–LM14)

`candidateQualification.ts` projects registered current evidence into seven
separate workload statuses, preserving negative/Unknown evidence and current
references. An instruction receipt alone is not a passed Coding patch; a
configured 8192-token window alone is not demonstrated long-context recall.
No generation-throughput estimate is promoted to a measured metric.

The deterministic Agent shortlist is bounded to two exact deployment IDs and
requires current Chat, instruction, native-tool and Agent-effect prerequisites,
current structured output proof, adequate hardware/context and bounded
normal-Chat reliability. If none satisfy the gates, the shortlist is empty.
A separate pure acceptance policy describes nine deterministic checks, rejects
duplicate tool effects, failing or incomplete verification, identity mismatch,
unbounded attempts/time and missing independent test receipts. This policy
**does not run Agent tasks, persist a new authority or authorize tools**.
No current accepted fixture fulfills all Agent prerequisites. No ForgeBoard
task is launched; `FORGEBOARD_CANDIDATE_READY` is not established.

No unapproved model downloads, remote inference, CUDA changes or qualification
campaigns are performed. Evaluating saved historical Qwen and remote Devstral
evidence is not equivalent to new current behavioral qualification; real
Coding, tools, structured output and long-context candidate measurements
require future bounded user-authorized verifiers.

## Product UX (LM15)

`deploymentProductStates.ts` separates readiness (`Ready`, `Stopped`,
`Offline`, `Missing`, `Unknown`) from qualification (`Qualified`,
`Unqualified`, `Qualification Failed`, `Stale`, `Unsupported`, `Unknown`).
It renders actionable, sanitized errors instead of raw provider/native
objects. The guide adds an advanced per-workload candidate profile without
changing its current-evidence recommendation algorithm or the model picker.
Recommendations remain informational and cannot switch the selected model,
context, backend, GPU offload, runtime or permissions.

## Evidence and limitations

Existing LM2F receipt and LM6 run ledgers are unchanged. Historical success,
failure, cancellation, incomplete correlation and stale performance remain
separate. In particular, a process restart invalidates present readiness
scope even when an older successful receipt is visible. Small sample counts
are not statistically robust. The current managed runtime remains CPU-only;
a GPU being installed does not imply CUDA support. Remote runtime process
identity is not inferred from an Ollama version endpoint. Agent eligibility
and recommendation ranking remain fail-closed, and no ForgeBoard operation is
authorized by this implementation.

This milestone is **partial** until the end-to-end bounded execution, actual
newly evaluated candidate fixtures and bounded Agent tasks can be completed
with independent current-scoped evidence. Do not call it production-ready
merely because the preview and offline regression tests pass.
