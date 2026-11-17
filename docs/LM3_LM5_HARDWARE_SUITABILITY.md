# LM3–LM5 — Hardware profile, workload suitability and context adaptation

## Status and authority

This layer **estimates resource suitability for an exact registered**
`ComputeHost → LocalRuntime → ModelArtifact → ModelDeployment`. It is a
read-only projection of the existing Compute Fabric, not an additional
registry, admission gate, benchmark, performance guarantee or permission
authority. It never downloads a model, starts inference, changes context,
sets GPU layers, switches runtimes or backends, installs CUDA, or changes
parallelism. Any suggested configuration change requires user action and
fresh qualification. The accepted LM2F procedure/receipt policy is untouched.

Ratings `Excellent | Good | Marginal | Poor | Unknown` describe estimated
compute fit and workload-specific qualification separately. **Can load ≠
will run well.** `Unknown` is not `Poor`. CPU/GPU memory capacity is not a
model-quality, tool-reliability, coding-accuracy, or latency measurement.

## Hardware evidence (LM3)

`hardwareProfile.ts` provides tagged `EvidenceValue<T>` observations:
`value | null`, `unit`, `provenance`, `source`, `observedAt | null`,
and explicit `assumptions`. Provenance is exactly `Measured`, `Derived`,
`Estimated`, or `Unknown`. Each profile is keyed to both Compute Fabric
`hostId` and `runtimeId`; installed runtime backend execution must not be
borrowed from another runtime on the same host.

The additive unprivileged native `local_hardware_observation` command uses
Windows `GlobalMemoryStatusEx`, Linux `/proc/meminfo`, and Rust
`available_parallelism`. It returns OS/architecture, total and currently
available RAM, allowed parallelism, timestamp and source. RAM older than 30
seconds or a malformed observation is **Unknown**, not zero. Pressure is
derived as `1 - available/total`, not observed process consumption.
`available_parallelism` can reflect process affinity or CPU quotas; its
figure must not be represented as verified physical core count.

The normalized schema can represent CPU identity/physical cores/instructions,
GPU identity/vendor/model, total/free usable VRAM, architecture/driver and
per-backend hardware support versus **installed runtime execution**. Current
safe native observation does **not** collect CPU model, physical cores or
trustworthy inference VRAM/driver/device inventory. These fields remain
`Unknown`; `gpus: []` with `gpuInventoryComplete: false` does **not**
mean the PC has no GPU. Windows display `AdapterRAM` is not evidence of
usable inference VRAM. Installed pinned llama.cpp b12248 is CPU-only:
`cpu=true`, GPU backends `false` **for this installed runtime only**,
while potential GPU hardware backend support remains Unknown.

Physical telemetry is never copied from This PC to Secondary PC/Ollama.
There is no SSH, privileged driver interrogation, new network probe or
fabricated CUDA/ROCm/Metal/DirectML/Vulkan support.

## Exact artifact/resource profile (LM4)

`modelResourceProfile.ts` combines the existing Fabric artifact, runtime,
deployment configuration revision/identity and, on demand, a private
GGUF-header read that **revalidates the full content digest** against the
content-addressed imported file. The additive native
`managed_local_runtime_model_metadata` command does not launch or load a
model. Its bounded scalar inspection extracts architecture, declared
context, block count, embedding width, attention heads, KV heads, and key/
value head widths when present. Its 2 MiB/512-key parser intentionally stops
at large tokenizer arrays; missing downstream fields stay Unknown.

Artifact bytes from native digest inspection are `Measured`, model-declared
context/configuration and parsed runtime inventory labels are `Derived`.
No parameter count or quantization is guessed from a display name such as
`0.5B` or `Q4_K_M`. The weight-budget heuristic is
`ceil(1.08 × artifact bytes)`, **Estimated** rather than resident RAM.
For the pinned managed llama.cpp CPU configuration only, the provisional
assumptions are 256 MiB process overhead, 64 MiB batch buffers, one configured
concurrent request and fp16 KV (2 bytes per cache element). They are labeled
`Estimated`, not observed allocations.

When sufficient exact GGUF dimensions are present, the **derived**
KV elements per token are
`block_count × kv_heads × (key_head_width + value_head_width)`.
Head width can derive from `embedding_length / attention_heads` only when
that division is exact; otherwise KV remains Unknown. KV demand for a
context tier is `tokens × elements/token × assumed bytes/element ×
concurrency`. Other runtimes with unknown cache precision, concurrency or
overhead remain Unknown.

## Deterministic suitability and capacity (LM4–LM5)

`deploymentSuitability.ts` takes exact Fabric identity, hardware and model
resource profiles, workload and context tokens. Its pure functions make no
LLM request. They calculate weight + KV + runtime/batch buffers, CPU and
known GPU offload split, free memory, total physical capacity and headroom.
The safety reserve is `max(512 MiB, 20% of available budget)`; the
result can be `Fits`, `Tight`, `Insufficient` or `Unknown`.
Hybrid allocations approximate weight/cache split by GPU-layer fraction
and explicitly warn about unmeasured transfers and unequal layer sizes.
Multiple GPU memories are never silently summed without device placement
evidence. Missing available RAM/usable VRAM or unknown KV/cache type cannot
turn into a fabricated fit.

This distinguishes structural impossibility (total physical memory,
declared maximum context, or verified unavailable backend) from a temporary
shortage of free memory. The latter is `At Risk`, not `Cannot Fit`.
`Observed Loaded` additionally requires fresh exact runtime scope and an
independent affirmative native Ready observation. A generic epoch, old
performance sample or hypothetical larger context is not proof of loading.

Workloads are independently assessed: Chat, Coding, Native Tools, Structured
Output, Long-Context Coding and Automatic Agent. Chat/Coding use Chat
authorization; native tools require current LM2F native-tool proof; structured
output requires the relevant qualified JSON-schema protocol. Agent must meet
all current LM2F tool/argument/result/sequential/effect requirements **plus
exact instruction adherence**. Even excellent hardware never grants Agent.
Coding accuracy, contextual quality and useful latency are never inferred
from model size. The estimator exposes both a resource rating and the
qualification state/authorization; stale evidence is not reused.

Relative context targets derive from configured tokens (small, ×4, ×16)
and the declared artifact maximum, deduplicated and capped by that maximum.
The selected configuration is unchanged; all other tiers are hypothetical
and lose current runtime/LM2F authority. Capacity, limiting resource,
confidence, KV estimate and warnings are assessed per tier.

Confidence is `High` only with current exact-scope measured performance,
observed host memory and identified artifact/KV geometry; `Medium` for
measured RAM and digest-identified CPU artifact with estimated KV; otherwise
`Low`, especially when remote telemetry is absent. This is **confidence in
the evidence/estimate**, not demonstrated model quality. Explicit,
nonmutating recommendations include remaining CPU-only, reducing
context/concurrency, smaller artifact/quantization, different host, validated
GPU runtime, GPU residency/partial offload and avoiding Agent where proof is
missing. They are advice, not automatic settings.

## UI and future LM6 hook

The chat's advanced **Suitability** popover presents concise workload and
context selectors, capacity/load state, provenance and assumptions, per-tier
estimates, current LM2F qualification and informational suggestions. Only
explicitly opening it performs the local read-only native observation, GGUF
digest/header lookup and status check. Closing, switching selections or
aging past freshness removes current evidence. The picker, provider routing,
model admission and LM2F qualification control are unchanged.

`ScopedMeasuredPerformance` reserves fields for cold/warm first output,
prefill/generation tokens per second, peak RAM/VRAM, reliability, sample
count, source, deployment/runtime/epoch/config revision and timestamp.
Only current exact-scope measured data may inform a future LM6 rating.
No benchmark, remote inference or historical Muse-note ingestion is part
of LM3–LM5.

## Read-only calibration on 17 November 2026

**Current Windows PC:** One-time local OS/CIM observations identify an
AMD Ryzen 9 9900X (12 physical / 24 logical) and total RAM
`66,156,535,808` bytes (61.61 GiB), with `35,222,827,008` bytes
(32.80 GiB) available at the separate snapshot. These are calibration
observations, **not hardcoded into production hardware logic**. Display
adapters include NVIDIA RTX 5070 Ti and integrated AMD Radeon, but usable
inference VRAM, current free VRAM and installed CUDA execution are not
measured; the approved managed b12248 deployment is CPU-only, 0 GPU layers.

**Exact approved managed Qwen deployment:** SHA-256
`74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`
is a `491,400,032`-byte GGUF. The read-only real header reports
`qwen2`, 24 blocks, embedding 896, 14 attention heads, 2 KV heads and
declared 32,768 tokens. Its 64-element KV head width is *derived* from
896/14; this yields 6,144 KV elements per token, or **12,288 estimated
bytes/token** with assumed fp16. At the configured 2,048 tokens:

| Resource component | Estimate |
| --- | ---: |
| Resident weights (1.08×) | 530,712,035 bytes |
| KV cache (2,048 × 12,288) | 25,165,824 bytes |
| Runtime and batch assumptions | 335,544,320 bytes |
| Total CPU RAM demand | **891,422,179 bytes (~0.83 GiB)** |
| 8,192-token hypothetical demand | ~0.90 GiB |
| 32,768-token hypothetical demand | ~1.18 GiB |

With the captured host free-RAM snapshot this is computationally **Good
CPU memory fit, Medium estimate confidence**: enough host RAM is evident,
but runtime allocations, actual generation speed, coding performance and
instruction quality are **not measured**. The most recent LM2F Qwen
instruction-adherence outcome is a recorded **FAIL**; current process epoch
differs from the receipt epoch, so old receipts are stale. The CPU-only
deployment has no qualified native tools. **Automatic Agent is unavailable.**
This work did not repeat the previous one-time authorized qualification or
send any model inference.

**Secondary PC / Devstral on Ollama:** existing registered endpoint,
artifact/inventory and historical tool evidence are not current physical
RAM/VRAM, exact KV, load or throughput telemetry. Host memory, GPU
available VRAM, runtime backends and context capacity are therefore
`Unknown`; an expired LM2F/legacy receipt cannot qualify Agent.
No SSH, remote hardware read, new provider probe or inference occurred.

## Boundaries and verification

No LM6 benchmark execution, LM7 history, LM8 polish, LM12 Muse work,
kernel diagnostics, ForgeBoard, tooling escalation, CUDA installation or
automatic runtime switching. The existing 81 original protected dirty paths,
both original stashes, approved engine/model artifacts, LM2D–LM2F receipts
and original Git index are not part of the LM3–LM5 edit allowlist. Test
results and final commit/provenance audit must be reported from actual
post-edit runs; this document alone does not claim completion.

### Validation gates (17 November 2026)

- Deterministic estimator: 22 required synthetic capacity/qualification cases,
  plus 10 supplemental safety/identity/provenance cases (32 total). UI
  entry-point fixtures add three tests covering local and remote passive
  rendering, and no native calls before explicit popover opening.
- Existing accepted 50-suite Compute Fabric, LM2F, managed runtime, Ollama,
  provider-switching and recovery regression set is rerun together with the
  two new suites; archived source copies in `src-tauri/target` are excluded.
- Rust native library tests include unprivileged memory-observation invariant
  and synthetic bounded GGUF scalar geometry. A full offline Rust suite
  reported **730 passed, 2 ignored, 0 failed**.
- TypeScript `npm run check-types` and production `npm run build` passed.
  The ordinary native `cargo build --bin clack` encountered Windows
  `Access is denied` replacing the executable held by the user's running
  Clack process, so an **isolated ignored Cargo target/debug binary** was
  built successfully with the original pinned b12248 archive/executable
  SHA-256 compile-time values. The running Clack process was not restarted,
  and therefore a full new UI-to-native-command integration test is **not**
  claimed. Existing frontend source does not magically update the old
  running native binary.
- Git and binary preservation are independently checked before and after
  staging/commit. The baseline LM2F parent/HEAD and actual 23-file commit
  list, canonical SHA-256 of all 81 protected dirty paths, both original
  stashes, Qwen/engine and historical LM2E report digests form the audit
  evidence. No push is part of this phase.
